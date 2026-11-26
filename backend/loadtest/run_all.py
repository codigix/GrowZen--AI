"""Runs the load scenarios against the backend (one version of the code at a time) on a dedicated test database and writes the measurements to a JSON file.

    python loadtest/run_all.py --python <python> --server loadtest/server.py --backend <backend_dir> --label current --out results.json [--scenarios browse10,browse25,...]

Measured per scenario: requests, requests per second, average / p50 / p95 / p99 latency, error rate, PostgreSQL connections (total, active, idle in transaction), server CPU and memory,
thread count, connection pool and the fan-out / job limits. The load generator, the server and PostgreSQL share this machine, so numbers are for comparing versions, not absolute capacity.
"""
import argparse
import json
import os
import random
import subprocess
import sys
import threading
import time

import httpx
import psycopg

PG_ADMIN = "postgresql://seo@localhost:55434/postgres"
DB_NAME, TEMPLATE = "seo_load", "seo_load_seed"
PORT = 8765
ERR_SAMPLES = []  # the first few failed answers (name, status, start of the body), to see what an error was
WORKERS = 1  # backend processes sharing the database (--workers); a request goes to a random one of them, as a load balancer would send it
PASSWORD = "load-password-123456"


def pct(values, p):
    if not values:
        return None
    v = sorted(values)
    return v[min(len(v) - 1, int(round(p / 100 * (len(v) - 1))))]


def by_endpoint(rows):
    out = {}
    for name in sorted({r[0] for r in rows}):
        lat = sorted(r[3] for r in rows if r[0] == name)
        out[name] = {"n": len(lat), "avg_ms": round(1000 * sum(lat) / len(lat), 1), "p95_ms": round(1000 * lat[min(len(lat) - 1, int(0.95 * (len(lat) - 1)))], 1),
                     "errors": sum(1 for r in rows if r[0] == name and not (200 <= r[2] < 400))}
    return out


def summarize(rows, duration):
    lat = [r[3] for r in rows]
    errors = [r for r in rows if not (200 <= r[2] < 400)]
    return {"requests": len(rows), "rps": round(len(rows) / duration, 1) if duration else None, "avg_ms": round(1000 * sum(lat) / len(lat), 1) if lat else None,
            "p50_ms": round(1000 * pct(lat, 50), 1) if lat else None, "p95_ms": round(1000 * pct(lat, 95), 1) if lat else None, "p99_ms": round(1000 * pct(lat, 99), 1) if lat else None,
            "max_ms": round(1000 * max(lat), 1) if lat else None, "errors": len(errors), "error_pct": round(100 * len(errors) / len(rows), 2) if rows else None,
            "error_codes": {str(c): sum(1 for r in errors if r[2] == c) for c in {r[2] for r in errors}}, "endpoints": by_endpoint(rows)}


class Sampler(threading.Thread):
    """PostgreSQL connections, the server's CPU / memory / threads and its pool, sampled while a scenario runs."""

    def __init__(self, procs):
        super().__init__(daemon=True)
        self.pids = []
        for i, proc in enumerate(procs):
            pid = proc.pid
            try:  # on Windows the process started is a launcher: the server is the one that listens on the port
                out = subprocess.run(["powershell", "-NoProfile", "-Command", f"(Get-NetTCPConnection -LocalPort {PORT + i} -State Listen | Select-Object -First 1).OwningProcess"], capture_output=True, text=True, timeout=20).stdout.strip()
                pid = int(out) if out.isdigit() else pid
            except Exception:  # noqa: BLE001
                pass
            self.pids.append(pid)
        self.stop_ev = threading.Event()
        self.pg, self.proc, self.stats = [], [], []

    def run(self):
        conn = psycopg.connect(PG_ADMIN, autocommit=True)
        clients = [httpx.Client(base_url=f"http://127.0.0.1:{PORT + i}", timeout=5) for i in range(len(self.pids))]
        last_proc = 0.0
        while not self.stop_ev.is_set():
            try:
                row = conn.execute("select count(*), count(*) filter (where state='active'), count(*) filter (where state='idle in transaction') from pg_stat_activity where datname=%s", (DB_NAME,)).fetchone()
                self.pg.append(row)
            except Exception:  # noqa: BLE001
                pass
            one = []
            for client in clients:
                try:
                    one.append(client.get("/__load/stats").json())
                except Exception:  # noqa: BLE001
                    pass
            if one:  # all workers together: threads and checked-out connections add up, the peaks of fan-out are per process
                self.stats.append({"threads": sum(x["threads"] for x in one), "checked_out": sum(x["checked_out"] for x in one), "fanout": max(one, key=lambda x: ((x.get("fanout") or {}).get("peak_running", 0))).get("fanout"),
                                   "job_places_free": min((x["job_places_free"] for x in one if x.get("job_places_free") is not None), default=None), "per_worker_checked_out": [x["checked_out"] for x in one]})
            if time.time() - last_proc >= 1.0:
                last_proc = time.time()
                try:
                    cpu_total, rss_total = 0.0, 0
                    for pid in self.pids:
                        out = subprocess.run(["powershell", "-NoProfile", "-Command", f"$p=Get-Process -Id {pid}; \"$($p.CPU) $($p.WorkingSet64)\""], capture_output=True, text=True, timeout=10).stdout.split()
                        cpu_total += float(out[0])
                        rss_total += int(out[1])
                    self.proc.append((time.time(), cpu_total, rss_total))
                except Exception:  # noqa: BLE001
                    pass
            time.sleep(0.2)
        conn.close()

    def report(self, duration):
        pg = self.pg or [(0, 0, 0)]
        cpu = None
        if len(self.proc) >= 2:
            cpu = round((self.proc[-1][1] - self.proc[0][1]) / max(0.001, self.proc[-1][0] - self.proc[0][0]), 2)  # processor-seconds per second: 1.0 = one core fully busy
        st = [s for s in self.stats if isinstance(s, dict)]
        return {"pg_connections_max": max(r[0] for r in pg), "pg_connections_mean": round(sum(r[0] for r in pg) / len(pg), 1), "pg_active_max": max(r[1] for r in pg),
                "pg_idle_in_transaction_max": max(r[2] for r in pg), "pg_idle_in_transaction_mean": round(sum(r[2] for r in pg) / len(pg), 1),
                "server_cpu_cores_avg": cpu, "server_rss_mb_max": round(max((p[2] for p in self.proc), default=0) / 1e6), "server_threads_max": max((s["threads"] for s in st), default=None),
                "pool_checked_out_max": max((s["checked_out"] for s in st), default=None), "fanout_peak_running": max(((s.get("fanout") or {}).get("peak_running", 0) for s in st), default=None),
                "job_places_min_free": min((s["job_places_free"] for s in st if s.get("job_places_free") is not None), default=None)}


class User:
    def __init__(self, n):
        self.n = n
        self.clients = [httpx.Client(base_url=f"http://127.0.0.1:{PORT + i}", timeout=httpx.Timeout(120.0, connect=30.0), limits=httpx.Limits(max_connections=4), transport=httpx.HTTPTransport(retries=3))
                        for i in range(WORKERS)]
        self.c = self.clients[0]  # setup calls
        self.bid = self.aid = None
        self.rows = []
        self.logged_in = False

    def login(self):
        for attempt in range(6):  # a login under a rush of other logins can be slow or find its connection closed: try again before giving up
            try:
                r = self.c.post("/api/v1/auth/login", json={"email": f"u{self.n}@load.test", "password": PASSWORD})
                r.raise_for_status()
                self.bid = self.c.get("/api/v1/businesses").json()[0]["id"]
                self.aid = self.c.get(f"/api/v1/businesses/{self.bid}/articles").json()["articles"][0]["id"]
                for other in self.clients[1:]:  # the same session works on every worker (it is signed with the shared secret)
                    other.cookies.update(self.c.cookies)
                self.logged_in = True
                return
            except Exception:  # noqa: BLE001
                time.sleep(1.0 + attempt)

    def call(self, name, method, path, body=None):
        t0 = time.perf_counter()
        try:
            r = random.choice(self.clients).request(method, path, json=body)
            status, size = r.status_code, len(r.content)
        except Exception:  # noqa: BLE001 - a timeout or a refused connection counts as an error
            status, size = 599, 0
        if not (200 <= status < 400) and status != 409 and len(ERR_SAMPLES) < 12:
            ERR_SAMPLES.append((name, status, (r.text[:160] if "r" in dir() else "no answer")))
        self.rows.append((name, t0, status, time.perf_counter() - t0, size))
        return status


BROWSE = [("me", "GET", "/api/v1/me", 2), ("businesses", "GET", "/api/v1/businesses", 3), ("portfolio", "GET", "/api/v1/businesses/portfolio", 3),
          ("flow", "GET", "/api/v1/businesses/{b}/flow", 4), ("flow_projects", "GET", "/api/v1/flow/projects", 2), ("articles", "GET", "/api/v1/businesses/{b}/articles", 3),
          ("article", "GET", "/api/v1/businesses/{b}/articles/{a}", 2), ("keywords", "GET", "/api/v1/businesses/{b}/keywords", 2), ("notifications", "GET", "/api/v1/notifications?limit=10", 1)]
SLOW = [("assistant", "POST", "/api/v1/businesses/{b}/assistant", {"message": "Suggest blog topics for this month"}),
        ("ai_description", "POST", "/api/v1/businesses/{b}/ai/description", None),
        ("keyword_overview", "POST", "/api/v1/businesses/{b}/seo/keyword-overview", {"keyword": "dentist pune", "lite": True})]


def browse_loop(u, stop):
    names = [x for x in BROWSE for _ in range(x[3])]
    while not stop.is_set():
        name, method, path, _ = random.choice(names)
        u.call(name, method, path.format(b=u.bid, a=u.aid))
        time.sleep(random.uniform(0.05, 0.15))


def slow_loop(u, stop):
    i = 0
    while not stop.is_set():
        name, method, path, body = SLOW[i % len(SLOW)]
        i += 1
        u.call(name, method, path.format(b=u.bid), body)


def editor_loop(u, stop, version):
    """What Content Studio asks while an article is written: once a second, and the list every two seconds (before), or the small progress answer once a second (after)."""
    n = 0
    while not stop.is_set():
        t = time.time()
        if version == "current":
            u.call("editor_progress", "GET", f"/api/v1/businesses/{u.bid}/articles/{u.aid}/progress?known_len=999999")
        else:
            u.call("editor_article", "GET", f"/api/v1/businesses/{u.bid}/articles/{u.aid}")
            if n % 2 == 0:
                u.call("editor_list", "GET", f"/api/v1/businesses/{u.bid}/articles")
        n += 1
        time.sleep(max(0.0, 1.0 - (time.time() - t)))


def run_group(users, target, duration, *args):
    stop = threading.Event()
    threads = [threading.Thread(target=target, args=(u, stop, *args), daemon=True) for u in users]
    for t in threads:
        t.start()
    return stop, threads


def pg_admin(sql):
    with psycopg.connect(PG_ADMIN, autocommit=True) as c:
        c.execute(sql)


def start_server(python, server, backend, extra_env=None, fresh=True):
    """Starts WORKERS backend processes (ports PORT, PORT+1, ...) on one fresh copy of the seeded database. Returns the list of processes."""
    if fresh:
        pg_admin(f"drop database if exists {DB_NAME} with (force)")
        pg_admin(f"create database {DB_NAME} template {TEMPLATE}")
        with psycopg.connect(PG_ADMIN.replace("/postgres", f"/{DB_NAME}"), autocommit=True) as c:  # made once here: several workers creating it at the same moment can collide
            c.execute("create table if not exists load_probe (id serial primary key, kind text, key text, pid int, at timestamptz default now())")
    env = {**os.environ, "LOAD_DB_URL": f"postgresql+psycopg://seo@localhost:55434/{DB_NAME}", **(extra_env or {})}
    procs = [start_one(python, server, backend, PORT + i, env) for i in range(WORKERS)]
    for i, p in enumerate(procs):
        wait_healthy(p, PORT + i)
    return procs


def start_one(python, server, backend, port, env):
    log = open(os.path.join(os.environ.get("TEMP", "."), f"loadserver_{port}.log"), "w")  # a file, never a pipe: nobody reads a pipe, and a full one stops the server in the middle of a log line
    p = subprocess.Popen([python, server, backend, str(port)], cwd=backend, env=env, stdout=log, stderr=subprocess.STDOUT)
    p.log_path = log.name
    return p


def wait_healthy(p, port):
    for _ in range(240):
        try:
            if httpx.get(f"http://127.0.0.1:{port}/api/v1/health", timeout=5).status_code == 200:
                return
        except Exception:  # noqa: BLE001
            time.sleep(0.5)
    p.kill()
    raise SystemExit("the server did not start: " + open(p.log_path, errors="ignore").read()[-800:])


def kill_all(procs):
    for p in procs:
        try:
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(p.pid)], capture_output=True, timeout=20)  # the launcher and the server it started
        except Exception:  # noqa: BLE001
            p.kill()
        try:
            p.wait(10)
        except Exception:  # noqa: BLE001
            pass


def logged_in(n_users, offset=0):
    users = [User(offset + i) for i in range(n_users)]
    ts = [threading.Thread(target=u.login) for u in users]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    failed = [u.n for u in users if not u.logged_in]
    if failed:
        raise RuntimeError(f"{len(failed)} users could not sign in: the scenario would measure missing sessions, not the server")
    return users


def scenario(name, label, python, server, backend):
    duration = 25.0
    if name in ("dupjobs", "crash"):
        return job_scenario(name, label, python, server, backend)
    srv = start_server(python, server, backend)
    try:
        sam = Sampler(srv)
        extra = {}
        if name.startswith("browse"):
            n = int(name[6:])
            users = logged_in(n)
            sam.start()
            t0 = time.time()
            stop, ths = run_group(users, browse_loop, duration)
            time.sleep(duration)
            stop.set()
            [t.join(30) for t in ths]
            took = time.time() - t0
            res = {"browse": summarize([(r[0], r[1], r[2], r[3]) for u in users for r in u.rows], took)}
        elif name == "editor10":
            users = logged_in(10)
            sam.start()
            t0 = time.time()
            stop, ths = run_group(users, editor_loop, duration, label)
            time.sleep(duration)
            stop.set()
            [t.join(30) for t in ths]
            took = time.time() - t0
            rows = [r for u in users for r in u.rows]
            res = {"editor": {**summarize([(r[0], r[1], r[2], r[3]) for r in rows], took), "kb_per_second_per_user": round(sum(r[4] for r in rows) / 1024 / took / len(users), 1)}}
        elif name in ("slow30_browse10", "pressure60_browse20"):
            slow_n, browse_n = (30, 10) if name.startswith("slow30") else (60, 20)
            users = logged_in(slow_n + browse_n)
            slow_u, browse_u = users[:slow_n], users[slow_n:]
            sam.start()
            t0 = time.time()
            s1, t1 = run_group(slow_u, slow_loop, duration)
            time.sleep(1.0)
            s2, t2 = run_group(browse_u, browse_loop, duration)
            time.sleep(duration)
            s1.set(), s2.set()
            [t.join(150) for t in t1 + t2]
            took = time.time() - t0
            res = {"browse_while_slow": summarize([(r[0], r[1], r[2], r[3]) for u in browse_u for r in u.rows], took), "slow_calls": summarize([(r[0], r[1], r[2], r[3]) for u in slow_u for r in u.rows], took)}
        elif name in ("lighthouse15_browse10", "articles15_browse10"):
            heavy_n, browse_n = 15, 10
            users = logged_in(heavy_n + browse_n)
            heavy_u, browse_u = users[:heavy_n], users[heavy_n:]
            sam.start()
            t0 = time.time()
            s2, t2 = run_group(browse_u, browse_loop, duration + 15)
            time.sleep(1.0)
            before = {}
            if name.startswith("lighthouse"):  # the newest technical audit each project already has: a finished one with a higher id is the new one
                for u in heavy_u:
                    items = u.c.get(f"/api/v1/businesses/{u.bid}/audits?kind=technical&limit=1&slim=true").json()
                    before[u.bid] = items[0]["id"] if items else 0
            for i, u in enumerate(heavy_u):  # all at the same moment
                if name.startswith("lighthouse"):
                    u.call("start_audit", "POST", f"/api/v1/businesses/{u.bid}/audits", {"kinds": ["technical"]})
                else:
                    u.call("start_article", "POST", f"/api/v1/businesses/{u.bid}/articles/generate", {"keywords": [{"keyword": f"load keyword {i}"}], "length": "short"})
            started = time.time()
            done = 0
            while time.time() - started < 90 and done < heavy_n:
                time.sleep(1.0)
                done = 0
                for u in heavy_u:
                    try:
                        if name.startswith("lighthouse"):
                            items = u.c.get(f"/api/v1/businesses/{u.bid}/audits?kind=technical&limit=1&slim=true").json()
                            done += 1 if items and items[0]["id"] > before[u.bid] and items[0]["status"] in ("done", "failed") else 0
                        else:
                            arts = u.c.get(f"/api/v1/businesses/{u.bid}/articles").json().get("articles", [])
                            done += 1 if any(a["keyword"].startswith("load keyword") and a["status"] in ("completed", "failed") for a in arts) else 0
                    except Exception:  # noqa: BLE001 - the poll is not what is being measured
                        pass
            extra = {"heavy_started": heavy_n, "heavy_finished": done, "heavy_seconds_to_finish": round(time.time() - started, 1)}
            s2.set()
            [t.join(30) for t in t2]
            took = time.time() - t0
            res = {"browse_while_heavy": summarize([(r[0], r[1], r[2], r[3]) for u in browse_u for r in u.rows], took), "heavy": extra}
        elif name in ("competitors20_browse10", "sameproject20"):
            heavy_n, browse_n = (20, 10) if name.startswith("competitors") else (20, 0)
            users = logged_in(heavy_n + browse_n)
            heavy_u, browse_u = users[:heavy_n], users[heavy_n:]
            for u in heavy_u:  # one competitor with a Google listing (no website) per project, made through the API
                u.comp = u.c.post("/api/v1/competitors/maps", json={"business_id": u.bid, "name": f"Rival {u.n}", "cid": f"place{u.n}"}).json()["id"]
            if name == "sameproject20":  # everybody works on ONE project and ONE competitor: the admin account opens project 1's competitor from every worker at once
                first = heavy_u[0]
                for u in heavy_u:
                    u.bid, u.comp = first.bid, first.comp
                    for cl in u.clients:
                        cl.cookies.update(first.clients[0].cookies)  # one person's session, used from many browsers
            sam.start()
            t0 = time.time()
            s2 = t2 = None
            if browse_u:
                s2, t2 = run_group(browse_u, browse_loop, duration)
            time.sleep(0.5)

            def competitor_loop(u, stop):
                i = 0
                while not stop.is_set():
                    if name == "sameproject20":
                        u.call("listing_audit", "POST", f"/api/v1/competitors/{u.comp}/listing-audit")  # an audit always reads Google: every run that is not refused is one real read
                        time.sleep(random.uniform(0.0, 0.3))
                    else:
                        step = i % 4
                        if step == 0:
                            u.call("competitor_find", "POST", "/api/v1/competitors", {"business_type": "Dentist", "location": "Pune", "own_firm_name": "x", "top_n": 5, "business_id": u.bid})
                        elif step == 1:
                            u.call("listing_audit", "POST", f"/api/v1/competitors/{u.comp}/listing-audit")
                        elif step == 2:
                            u.call("listing_compare", "POST", f"/api/v1/competitors/{u.comp}/listing-compare")
                        else:
                            u.call("competitor_list", "GET", f"/api/v1/competitors?business_id={u.bid}")
                    i += 1
            s1, t1 = run_group(heavy_u, competitor_loop, duration)
            time.sleep(duration)
            s1.set()
            if s2:
                s2.set()
            [t.join(150) for t in t1 + (t2 or [])]
            took = time.time() - t0
            rows = [r for u in heavy_u for r in u.rows]
            res = {"competitor_calls": summarize([(r[0], r[1], r[2], r[3]) for r in rows], took)}
            if browse_u:
                res["browse_while_competitors"] = summarize([(r[0], r[1], r[2], r[3]) for u in browse_u for r in u.rows], took)
            if name == "sameproject20":  # duplicate protection across workers: the answers are 200 (it ran) or 409 (someone else is already running it); every 200 reads Google once (theirs)
                ok = sum(1 for r in rows if r[2] == 200)
                with psycopg.connect(PG_ADMIN.replace("/postgres", f"/{DB_NAME}"), autocommit=True) as c:
                    reads = c.execute("select count(*) from load_probe where kind='maps_read'").fetchone()[0]
                res["same_project"] = {"requests": len(rows), "ran": ok, "refused_409": sum(1 for r in rows if r[2] == 409), "other": sum(1 for r in rows if r[2] not in (200, 409)), "google_reads": reads,
                                       "reads_per_run": round(reads / ok, 2) if ok else None}
        else:
            raise SystemExit("unknown scenario " + name)
        sam.stop_ev.set()
        sam.join(5)
        res["server"] = sam.report(duration)
        res["error_samples"] = list(ERR_SAMPLES)
        res["scenario"], res["version"] = name, label
        return res
    finally:
        kill_all(srv)


def probe_rows(sql, *params):
    with psycopg.connect(PG_ADMIN.replace("/postgres", f"/{DB_NAME}"), autocommit=True) as c:
        return c.execute(sql, params).fetchall()


def job_scenario(name, label, python, server, backend):
    """Background jobs across worker processes. Short heartbeat and take-over times are set so a crash is recovered within a minute of testing.
    dupjobs: many abandoned jobs (their owner is dead) and some alive ones are in the table when the workers start together: every abandoned job must run exactly once and no alive one may run.
    crash:   a job is started through one worker, that worker is killed in the middle of it, and the job must be finished by another worker, once."""
    env = {"JOB_HEARTBEAT_SECONDS": "3", "JOB_ABANDONED_SECONDS": "15", "PROBE_SECONDS": "6" if name == "dupjobs" else "14", "DUMP_STACKS_AFTER": "90", "DUMP_STACKS_FILE": os.path.join(os.environ.get("TEMP", "."), "p5stacks")}
    pg_admin(f"drop database if exists {DB_NAME} with (force)")
    pg_admin(f"create database {DB_NAME} template {TEMPLATE}")
    res: dict = {"scenario": name, "version": label, "workers": WORKERS}
    with psycopg.connect(PG_ADMIN.replace("/postgres", f"/{DB_NAME}"), autocommit=True) as c:
        c.execute("create table if not exists load_probe (id serial primary key, kind text, key text, pid int, at timestamptz default now())")
        c.execute("alter table durable_jobs add column if not exists owner varchar(80)")  # the original code has no such columns: the table is the same for both versions
        c.execute("alter table durable_jobs add column if not exists heartbeat_at timestamptz")
        if name == "dupjobs":
            for i in range(40):  # owner dead: heartbeat five minutes old
                c.execute("insert into durable_jobs (fn, args, refs, status, attempts, owner, heartbeat_at, created_at, updated_at) values ('loadprobe:probe', %s, %s, 'running', 1, 'dead:1:x', now() - interval '5 minutes', now(), now())",
                          (json.dumps([f"dead{i}"]), json.dumps([f"probe:dead{i}"])))
            for i in range(10):  # owner alive: the test itself keeps their heartbeat fresh below
                c.execute("insert into durable_jobs (fn, args, refs, status, attempts, owner, heartbeat_at, created_at, updated_at) values ('loadprobe:probe', %s, %s, 'running', 1, 'ghost:1:x', now(), now(), now())",
                          (json.dumps([f"alive{i}"]), json.dumps([f"probe:alive{i}"])))
    srv = []
    try:
        t0 = time.time()
        if name == "dupjobs":
            stop = threading.Event()

            def keep_ghosts_alive():  # the owners of the "alive" jobs: running from before the workers start, so they are never quiet
                with psycopg.connect(PG_ADMIN.replace("/postgres", f"/{DB_NAME}"), autocommit=True) as c2:
                    while not stop.is_set():
                        c2.execute("update durable_jobs set heartbeat_at = now() where owner = 'ghost:1:x'")
                        time.sleep(2)
            gt = threading.Thread(target=keep_ghosts_alive, daemon=True)
            gt.start()
            srv = start_server(python, server, backend, env, fresh=False)  # the workers start one after the other and each looks for abandoned jobs at start-up
            with psycopg.connect(PG_ADMIN.replace("/postgres", f"/{DB_NAME}"), autocommit=True) as c3:
                for i in range(40):  # a second batch, abandoned while ALL workers are already running: the workers' own periodic searches race for them
                    c3.execute("insert into durable_jobs (fn, args, refs, status, attempts, owner, heartbeat_at, created_at, updated_at) values ('loadprobe:probe', %s, %s, 'running', 1, 'dead:2:y', now() - interval '5 minutes', now(), now())",
                               (json.dumps([f"late{i}"]), json.dumps([f"probe:late{i}"])))
            deadline = time.time() + 240
            while time.time() < deadline:
                left = probe_rows("select count(*) from durable_jobs where owner <> 'ghost:1:x' or owner is null")[0][0]
                if left == 0:
                    break
                time.sleep(1)
            took = time.time() - t0
            time.sleep(8)  # a duplicate would show up in this time
            stop.set()
            starts = dict(probe_rows("select key, count(*) from load_probe where kind='start' group by key"))
            fins = dict(probe_rows("select key, count(*) from load_probe where kind='finish' group by key"))
            for group, prefix in (("at_start", "dead"), ("while_running", "late")):
                keys = [f"{prefix}{i}" for i in range(40)]
                res[f"abandoned_{group}"] = {"jobs": 40, "started_once": sum(1 for k in keys if starts.get(k) == 1), "started_more_than_once": sum(1 for k in keys if (starts.get(k) or 0) > 1),
                                             "never_started": sum(1 for k in keys if not starts.get(k)), "finished_once": sum(1 for k in keys if fins.get(k) == 1),
                                             "finished_more_than_once": sum(1 for k in keys if (fins.get(k) or 0) > 1)}
            res["alive_jobs_that_ran"] = sum(1 for k in starts if k.startswith("alive"))
            res["seconds_until_all_finished"] = round(took, 1)
            res["workers_that_ran_jobs"] = len({r[0] for r in probe_rows("select distinct pid from load_probe where kind='start'")})
            res["jobs_by_worker"] = {str(p): n for p, n in probe_rows("select pid, count(*) from load_probe where kind='start' group by pid")}
        else:
            srv = start_server(python, server, backend, env, fresh=False)
            keys = [f"crash{i}" for i in range(6)]
            owners = {}
            victim_i = 0
            victim_pid = int(Sampler(srv).pids[victim_i])  # found BEFORE the jobs start (looking it up takes seconds), so the kill comes while they are still running
            for i, k in enumerate(keys):  # jobs are started on every worker
                r = httpx.post(f"http://127.0.0.1:{PORT + i % WORKERS}/__load/probe/{k}", timeout=20).json()
                owners[k] = r["pid"]
            time.sleep(1.5)
            killed = [k for k, pid in owners.items() if pid == victim_pid]
            kill = subprocess.run(["taskkill", "/F", "/T", "/PID", str(victim_pid)], capture_output=True, text=True, timeout=20)  # a crash: no clean shutdown
            time.sleep(1)
            try:
                httpx.get(f"http://127.0.0.1:{PORT + victim_i}/api/v1/health", timeout=3)
                alive_after = True
            except Exception:  # noqa: BLE001
                alive_after = False
            res["killed_worker_pid"], res["jobs_running_on_killed_worker"], res["victim_still_answering"], res["taskkill"] = victim_pid, killed, alive_after, (kill.stdout + kill.stderr).strip()[:160]
            deadline = time.time() + 150
            while time.time() < deadline:
                fin = {k for k, in probe_rows("select distinct key from load_probe where kind='finish'")}
                if set(keys) <= fin:
                    break
                time.sleep(1)
            time.sleep(6)
            starts = dict(probe_rows("select key, count(*) from load_probe where kind='start' group by key"))
            fins = dict(probe_rows("select key, count(*) from load_probe where kind='finish' group by key"))
            res["jobs"] = len(keys)
            res["finished_exactly_once"] = sum(1 for k in keys if fins.get(k) == 1)
            res["finished_more_than_once"] = sum(1 for k in keys if (fins.get(k) or 0) > 1)
            res["never_finished"] = sum(1 for k in keys if not fins.get(k))
            res["started_twice_after_the_crash"] = sum(1 for k in killed if starts.get(k) == 2)
            res["starts_of_the_killed_jobs"] = {k: starts.get(k) for k in killed}
            res["finishes_of_the_killed_jobs"] = {k: fins.get(k) for k in killed}
            res["seconds_to_recover"] = round(time.time() - t0, 1)
            res["jobs_left_in_table"] = probe_rows("select count(*) from durable_jobs where status='running'")[0][0]
        return res
    except BaseException as exc:  # noqa: BLE001
        return {"scenario": name, "version": label, "error": f"{type(exc).__name__}: {exc}"}
    finally:
        kill_all(srv)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--python", required=True)
    ap.add_argument("--server", required=True)
    ap.add_argument("--backend", required=True)
    ap.add_argument("--label", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--scenarios", default="browse10,browse25,browse50,editor10,slow30_browse10,pressure60_browse20,lighthouse15_browse10,articles15_browse10")
    a = ap.parse_args()
    WORKERS = a.workers
    results = json.load(open(a.out)) if os.path.exists(a.out) else []
    for name in a.scenarios.split(","):
        print(f"[{a.label}] {name} ...", flush=True)
        try:
            one = scenario(name, a.label, a.python, a.server, a.backend)
        except BaseException as exc:  # noqa: BLE001 - one failing scenario is recorded and the others still run
            one = {"scenario": name, "version": a.label, "error": f"{type(exc).__name__}: {exc}"}
        one["workers"] = WORKERS
        results = [r for r in results if not (r["scenario"] == name and r["version"] == a.label and r.get("workers", 1) == WORKERS)] + [one]
        json.dump(results, open(a.out, "w"), indent=1)
        print(json.dumps(results[-1])[:300], flush=True)
