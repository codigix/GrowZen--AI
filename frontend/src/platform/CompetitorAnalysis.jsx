import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Check, Clock, Settings, CheckCircle2, ExternalLink, Eye, Layers, Loader2, MapPin, MoreHorizontal, Plus, Search, Trash2, Users, X } from 'lucide-react';
import { Button, Badge, ErrorNote, Modal, useToast } from './SeoUi';
import DataTable from './DataTable';
import { BANDS, DISTANCE, band } from './CompetitorTables';
import Select from '../components/Select';
import Tip from './Tip';
import { FocusBar, sameSite } from './TableBits';
import { api } from './seoApi';

const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const kfmt = (n) => (n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : num(n));
const hostOf = (u) => { if (!u) return ''; try { return new URL(/^https?:\/\//.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const STATUS = { analyzed: ['Analyzed', 'green'], partial: ['Partly read', 'amber'], pending: ['Pending', 'gray'], queued: ['Queued', 'gray'], running: ['Analyzing…', 'blue'], failed: ['Failed', 'red'], retry: ['Needs retry', 'amber'] };
const SOURCE = { google_places: 'Google Maps', organic_serp: 'Organic search', manual: 'Added by hand', backlinks: 'Backlinks tool' };
const KIND = { direct: ['Direct', 'text-emerald-700 bg-emerald-50 ring-emerald-200'], indirect: ['Indirect', 'text-amber-700 bg-amber-50 ring-amber-200'] };
const fdate = (t) => (t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const daTone = (v) => (v == null ? 'bg-slate-100 text-slate-400' : v >= 60 ? 'bg-emerald-100 text-emerald-800' : v >= 30 ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800');
const COST = (n) => (0.021 + 0.003 * n).toFixed(2);

/** What was last read for each competitor domain (and for your own site), kept on the server. */
export function useAnalysis(b, domains) {
  const [data, setData] = useState({ metrics: {}, own: null });
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const key = domains.slice().sort().join('|');
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api(`/businesses/${b.id}/keyword-workspace/competitor-analysis`, { method: 'POST', body: { domains } })); } catch { /* the table still shows without the figures */ } finally { setLoading(false); setLoaded(true); }
  }, [b.id, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return { ...data, loading, loaded, reload: load };
}

/** Distance from the chosen place and the match score of every saved competitor, worked out from the saved list (no research run needed). Read again when the place or the list changes. */
export function useRatings(b, location, ids) {
  const [data, setData] = useState({ by_id: {} });
  const [loading, setLoading] = useState(false);
  const key = `${location || ''}|${ids.slice().sort().join(',')}`;
  useEffect(() => {
    if (!ids.length) return undefined;
    let on = true;
    setLoading(true);
    api(`/businesses/${b.id}/keyword-workspace/competitor-analysis/ratings`, { method: 'POST', body: { location: location || null }, timeout: 180000 })
      .then(r => on && setData(r)).catch(() => { }).finally(() => on && setLoading(false));
    return () => { on = false; };
  }, [b.id, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...data, loading };
}

const AUTO_KEY = 'bevisibe.auto-analyze';
const readAuto = () => { try { return localStorage.getItem(AUTO_KEY) !== 'off'; } catch { return true; } };

/** Analyze the competitors that were not analyzed yet, by itself: the server reads them one after another in the background, and the table refreshes as each finishes.
 *  A competitor tried in the last day is not tried again, and at most ten start at once. */
export function useAutoAnalysis(b, analysis, pending) {
  const [on, setOn] = useState(readAuto);
  const [prog, setProg] = useState({ running: false, total: 0, done: 0, current: null, queue: [], failed: {} });
  const tried = useRef(new Set());
  const done = useRef(0);
  const key = pending.join('|');
  const base = `/businesses/${b.id}/keyword-workspace/competitor-analysis`;
  const toggle = (v) => { setOn(v); try { localStorage.setItem(AUTO_KEY, v ? 'on' : 'off'); } catch { /* not remembered */ } api(`${base}/config`, { method: 'PUT', body: { auto_analyze: v } }).catch(() => { }); };
  useEffect(() => { api(`${base}/config`).then(c => setOn(c.auto_analyze !== false)).catch(() => { }); }, [base]);

  // pick up a run that is already going (another visit, another tab)
  useEffect(() => { api(`${base}/progress`).then(setProg).catch(() => { }); }, [base]);
  // start one when something is pending
  useEffect(() => {
    if (!on || !analysis.loaded || !pending.length || prog.running) return;
    const fresh = pending.filter(d => !tried.current.has(d));
    if (!fresh.length) return;
    fresh.forEach(d => tried.current.add(d));
    api(`${base}/auto`, { method: 'POST', body: { domains: fresh } }).then(setProg).catch(() => { });
  }, [on, analysis.loaded, key, prog.running]); // eslint-disable-line react-hooks/exhaustive-deps
  // follow it, and show each result as it arrives
  useEffect(() => {
    if (!prog.running) { if (done.current) { done.current = 0; analysis.reload(); } return undefined; }
    const t = setInterval(async () => {
      const p = await api(`${base}/progress`).catch(() => null);
      if (!p) return;
      if (p.done !== done.current) { done.current = p.done; analysis.reload(); }
      setProg(p);
    }, 2500);
    return () => clearInterval(t);
  }, [prog.running, base]); // eslint-disable-line react-hooks/exhaustive-deps
  const stop = () => api(`${base}/stop`, { method: 'POST' }).then(setProg).catch(() => { });
  return { on, toggle, prog, stop, b, base, setOn };
}

/** The line above the table: what the automatic analysis is doing. */
/** The two controls of the automatic analysis, small enough for a slim row: the switch and the button for its settings and usage. */
export function AutoControls({ auto }) {
  const { on, toggle } = auto;
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-3">
      <label className="inline-flex items-center gap-2 text-13 font-medium text-slate-800 cursor-pointer select-none" title={on ? 'Competitors that were not analyzed yet are read by themselves: their Domain Authority and the keywords they rank for. Their websites are not audited. Each read costs about $0.04 at Apify.' : 'Switched off. Use Analyze on a row to read a competitor.'}>
        <button type="button" role="switch" aria-checked={on} onClick={() => toggle(!on)} className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${on ? 'bg-indigo-600' : 'bg-slate-300'}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} /></button>
        Auto-analyze
      </label>
      <Button size="sm" icon={Settings} onClick={() => setOpen(true)} title="What is read by itself, retries, refresh, the daily limit, and the calls made so far">Settings and usage</Button>
      {open && <AutoSettings auto={auto} onClose={() => setOpen(false)} />}
    </div>
  );
}

/** Shown only when there is something to say: the progress of a running analysis, the daily limit, and the competitors that could not be read. One slim line each. */
export function AutoNotices({ auto }) {
  const { prog, stop } = auto;
  const failed = Object.entries(prog.failed || {});
  if (!prog.running && !prog.limit_reached && !failed.length) return null;
  return (
    <div className="space-y-1.5">
      {prog.running && (
        <div className="flex items-center gap-3 rounded-lg bg-indigo-50/70 ring-1 ring-indigo-100 px-3 py-2">
          <Loader2 size={15} className="animate-spin text-indigo-600 shrink-0" />
          <span className="text-13 text-slate-800 shrink-0"><b>Analyzing competitors</b> {prog.done} of {prog.total}{prog.current ? ` · now ${prog.current}` : ''}</span>
          <div className="flex-1 h-1.5 rounded-full bg-white overflow-hidden min-w-[60px]"><div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${Math.max(4, (prog.done / Math.max(1, prog.total)) * 100)}%` }} /></div>
          <Button size="sm" onClick={stop}>Stop</Button>
        </div>
      )}
      {!prog.running && prog.limit_reached && <div role="status" className="rounded-lg bg-amber-50 ring-1 ring-amber-200 px-3 py-1.5 text-12.5 text-amber-900"><b>Today's automatic limit is reached.</b> The rest waits until tomorrow, or raise the limit in Settings and usage.</div>}
      {!prog.running && failed.length > 0 && <div role="status" className="rounded-lg bg-amber-50 ring-1 ring-amber-200 px-3 py-1.5 text-12.5 text-amber-900 truncate" title={failed.map(([d, m]) => `${d}: ${m}`).join('\n')}><b>{failed.length} competitor{failed.length === 1 ? '' : 's'} could not be fully read.</b> {failed[0][0]}: {failed[0][1]}{failed.length > 1 ? ` (and ${failed.length - 1} more)` : ''}</div>}
    </div>
  );
}

/** How a competitor's Match score was worked out: every factor that was measured, its weight and how much it added. A factor that could not be measured is named and left out, the rest count for more. */
function MatchDrawer({ c, rating, onClose, onProfile }) {
  const r = c.maps?.relevance;
  const W = rating?.weights || {};
  const L = rating?.labels || {};
  const f = r?.factors || {};
  const used = Object.keys(f).filter(k => W[k]);
  const total = used.reduce((a, k) => a + W[k], 0) || 1;
  const missing = Object.keys(W).filter(k => !(k in f));
  const capped = f.services != null && f.intent != null && Math.min(f.services, f.intent) < 40;
  return (
    <Modal open onClose={onClose} width="max-w-xl" title={`Match score: ${c.name}`} footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" onClick={onProfile}>Open full profile</Button></>}>
      <div className="flex items-center gap-4">
        <span className="text-26 font-bold tabular-nums text-slate-900">{r.score}<span className="text-14 font-medium text-slate-400"> / 100</span></span>
        <div><Badge tone={r.label === 'direct' ? 'green' : r.label === 'related' ? 'amber' : 'gray'}>{r.label_text}</Badge>
          <div className="text-12 text-slate-500 mt-0.5">Direct from {rating?.direct_at ?? 65}, related from {rating?.related_at ?? 40}. This is how closely it competes with your business. It is not Domain Authority.</div></div>
      </div>
      {r.reason && <p className="mt-3 text-13 text-slate-700">{r.reason} <span className="text-slate-400">({r.judged_by === 'ai' ? 'judged by AI' : 'judged from the words on its listing and site'})</span></p>}
      <table className="mt-3 w-full text-12.5">
        <thead><tr className="text-left text-slate-500"><th className="py-1 font-medium">Factor</th><th className="font-medium text-right">Score</th><th className="font-medium text-right">Weight</th><th className="font-medium text-right">Adds</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {used.sort((a, b2) => W[b2] * f[b2] - W[a] * f[a]).map(k => (
            <tr key={k}><td className="py-1.5"><div className="text-slate-900">{L[k] || k}</div><div className="h-1.5 w-40 rounded-full bg-slate-100 mt-1 overflow-hidden"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.max(0, Math.min(100, f[k]))}%` }} /></div></td>
              <td className=" tabular-nums">{f[k]}</td><td className=" tabular-nums text-slate-500">{Math.round((W[k] / total) * 100)}%</td><td className=" tabular-nums font-semibold">{((f[k] * W[k]) / total).toFixed(1)}</td></tr>))}
        </tbody>
      </table>
      {missing.length > 0 && <p className="mt-2 text-12 text-slate-500">Not measured, so left out (the others count for more): {missing.map(k => L[k] || k).join(', ')}.</p>}
      {capped && <p className="mt-2 text-12.5 text-amber-700">Capped: its services or the need it serves score under 40, so it cannot count as a direct competitor however near or visible it is.</p>}
      {r.traffic_from && <p className="mt-2 text-12 text-slate-500">Organic traffic strength comes from {r.traffic_from === 'keywords' ? 'its kept ranked keywords' : 'the strength of its site (Domain Authority), as no keyword read exists yet'}.</p>}
    </Modal>
  );
}

const REFRESH = [[0, 'Never by itself'], [7, 'Every 7 days'], [14, 'Every 14 days'], [30, 'Every 30 days']];
const PROVIDER = { apify_moz: 'Domain Authority (Moz via Apify)', apify_ranked: 'Ranked keywords (Apify)', google_places: 'Google Places' };

/** What is read by itself and how often, plus the calls made so far for this project. Every change is saved at once. */
function AutoSettings({ auto, onClose }) {
  const [cfg, setCfg] = useState(null);
  const [use, setUse] = useState(null);
  const [err, setErr] = useState('');
  const cfgUrl = `${auto.base}/config`;
  const loadUse = () => api(`${auto.base}/usage`).then(setUse).catch(e => setErr(e.message));
  useEffect(() => { api(cfgUrl).then(setCfg).catch(e => setErr(e.message)); loadUse(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (patch) => {
    setCfg(c => ({ ...c, ...patch }));
    try { const r = await api(cfgUrl, { method: 'PUT', body: patch }); setCfg(r); if ('auto_analyze' in patch) auto.setOn(r.auto_analyze); loadUse(); } catch (e) { setErr(e.message); }
  };
  const Check1 = ({ k, label, hint }) => <label className="flex items-start gap-2.5 py-1.5 cursor-pointer"><input type="checkbox" checked={!!cfg[k]} onChange={e => save({ [k]: e.target.checked })} className="mt-1 accent-indigo-600" /><span><span className="block text-13 text-slate-900">{label}</span>{hint && <span className="block text-12 text-slate-500">{hint}</span>}</span></label>;
  const Num = ({ k, label, min, max, hint }) => <label className="flex items-center gap-3 py-1.5 text-13 text-slate-900"><span className="flex-1">{label}{hint && <span className="block text-12 text-slate-500">{hint}</span>}</span><input type="number" min={min} max={max} defaultValue={cfg[k]} onBlur={e => e.target.value !== '' && Number(e.target.value) !== cfg[k] && save({ [k]: Number(e.target.value) })} aria-label={label} className="h-8 w-20 rounded-lg ring-1 ring-inset ring-slate-300 px-2 text-13 text-right" /></label>;
  return (
    <Modal open onClose={onClose} title="Automatic analysis: settings and usage" width="max-w-2xl" footer={<Button onClick={onClose}>Close</Button>}>
      {err && <ErrorNote>{err}</ErrorNote>}
      {!cfg ? <p className="text-13 text-slate-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" />Loading…</p> : (
        <div className="space-y-4">
          <div className="divide-y divide-slate-100">
            <Check1 k="auto_analyze" label="Analyze newly found competitors automatically" hint="Also decides whether the scheduler reads competitors on its own." />
            <Check1 k="authority" label="Fetch Domain Authority" hint="Moz, read through Apify." />
            <Check1 k="keywords" label="Fetch the keywords each competitor ranks for" hint="Apify ranked-keywords actor. Paid per keyword." />
            <Check1 k="retry_failed" label="Try again when a read failed or only half worked" hint="Waits 30 minutes between tries, up to the number below." />
            <Num k="max_retries" label="Tries in a row" min={1} max={10} />
            <label className="flex items-center gap-3 py-1.5 text-13 text-slate-900"><span className="flex-1">Read analyzed competitors again</span>
              <Select value={cfg.refresh_days} onChange={e => save({ refresh_days: Number(e.target.value) })} aria-label="Refresh period" className="h-8 rounded-lg ring-1 ring-inset ring-slate-300 bg-white px-2 text-13">{REFRESH.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></label>
            <Num k="cache_hours" label="Keep a read as fresh for (hours)" min={0} max={720} hint="A competitor read more recently is not requested again; its saved figures are shown instead. Only Refresh on its row reads it again. Default 168 (7 days)." />
            <Num k="daily_limit" label="Most automatic reads a day" min={1} max={500} hint="Each read is paid at Apify (about $0.04 plus $0.003 a keyword)." />
          </div>
          {use && (
            <div>
              <h4 className="text-13 font-semibold text-slate-900">Usage</h4>
              <p className="text-12.5 text-slate-600 mt-0.5">Today: {use.today.automatic} automatic read{use.today.automatic === 1 ? '' : 's'} of {use.today.daily_limit} allowed · {use.today.all} in all.</p>
              {Object.keys(use.paused || {}).length > 0 && <p className="mt-1 text-12.5 text-amber-700">Paused after a quota or rate-limit answer: {Object.entries(use.paused).map(([k, v]) => `${PROVIDER[k] || k} until ${v}`).join(', ')}. Reads in that time are skipped, not failed.</p>}
              {use.providers.length ? (
                <table className="mt-2 w-full text-12.5"><thead><tr className="text-left text-slate-500"><th className="py-1 font-medium">Provider</th><th className="font-medium text-right">Calls</th><th className="font-medium text-right">Failed</th><th className="font-medium text-right">Cost</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">{use.providers.map(p => <tr key={p.provider}><td className="py-1">{PROVIDER[p.provider] || p.provider}</td><td className=" tabular-nums">{p.calls}</td><td className={` tabular-nums ${p.failed ? 'text-rose-600 font-semibold' : ''}`}>{p.failed}</td><td className=" tabular-nums">{p.cost ? `$${p.cost.toFixed(2)}` : '—'}</td></tr>)}</tbody></table>
              ) : <p className="mt-2 text-12.5 text-slate-500">No calls made yet for this project.</p>}
              {use.latest.length > 0 && <details className="mt-2"><summary className="text-12.5 text-indigo-700 cursor-pointer">Latest {Math.min(10, use.latest.length)} calls</summary>
                <ul className="mt-1 text-12 text-slate-600 space-y-0.5">{use.latest.slice(0, 10).map((c, i) => <li key={i}><span className={c.ok ? 'text-emerald-700' : 'text-rose-600'}>{c.ok ? 'ok' : 'failed'}</span> · {PROVIDER[c.provider] || c.provider} · {c.target} · {fdate(c.at)}{c.detail ? ` · ${c.detail}` : ''}</li>)}</ul></details>}
            </div>
          )}
        </div>)}
    </Modal>
  );
}

function Logo({ host, name }) {
  // A letter, not the site's own icon: loading icons from the web logs a 404 in the console for every competitor site that is down or unknown.
  return <span className="w-8 h-8 rounded-md bg-indigo-50 text-indigo-700 inline-flex items-center justify-center text-13 font-bold shrink-0">{(name || host || '?').trim().charAt(0).toUpperCase()}</span>;
}

function Stat({ icon: Icon, label, value, sub, tone, help }) {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm px-4 py-4 flex items-center gap-4 min-w-0">
      <span className={`w-12 h-12 rounded-xl inline-flex items-center justify-center shrink-0 ${tone}`}><Icon size={23} /></span>
      <div className="min-w-0">
        <div className="text-26 font-bold text-slate-900 tabular-nums leading-none">{value}</div>
        <div className="mt-1.5 text-13 font-medium text-slate-700 flex items-center gap-1">{label}{help && <Tip text={help} align="left"><span tabIndex={0} aria-label={help} className="cursor-help text-slate-400 text-11 font-bold rounded-full ring-1 ring-slate-300 w-4 h-4 inline-flex items-center justify-center">?</span></Tip>}</div>
        {sub && <div className="text-12 text-slate-500 truncate" title={sub}>{sub}</div>}
      </div>
    </div>
  );
}

/** The four figures above the table, as one slim line. Each is counted on its own: discovered (unique domains found), selected (confirmed by you), analyzed (every part read), Avg DA (only the sites that have one). The note under each is its tooltip. */
export function AnalysisStats({ rows, status, isChosen, metrics }) {
  const uniq = (list) => new Set(list.map(c => c.host || `name:${(c.name || '').toLowerCase()}`)).size;
  const das = [...new Map(rows.filter(c => c.host).map(c => [c.host, metrics[c.host]?.da])).values()].filter(v => v != null);
  const discovered = uniq(rows);
  const selected = uniq(rows.filter(isChosen));
  const analyzed = uniq(rows.filter(c => status(c) === 'analyzed'));
  const items = [
    [Users, discovered, 'discovered', `${discovered} unique domains found`, 'Unique competitor websites found on Google Maps or added by hand. A business seen twice counts once. Found does not mean selected.', 'text-indigo-600'],
    [CheckCircle2, selected, 'selected', 'confirmed by you', 'Competitors you confirmed. Only these are watched and compared in the other tabs.', 'text-emerald-600'],
    [BarChart3, analyzed, 'analyzed', `${discovered - analyzed} not fully read`, 'Competitors whose Domain Authority and ranked keywords were both read. Reading only one of them is Partly read and does not count here.', 'text-sky-600'],
    [Layers, das.length ? Math.round(das.reduce((x, v) => x + v, 0) / das.length) : '—', 'avg. authority', das.length ? `from ${das.length} of ${discovered} sites` : 'analyze a competitor to read it', 'Average Domain Authority of the sites that have one. Sites without a figure are left out, not counted as zero.', 'text-violet-600'],
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5">
      {items.map(([Icon, v, label, sub, help, tone]) => (
        <Tip key={label} text={`${sub}. ${help}`} align="left">
          <span tabIndex={0} className="inline-flex items-center gap-2 cursor-help">
            <Icon size={16} className={tone} />
            <b className="text-16 text-slate-900 tabular-nums leading-none">{v}</b>
            <span className="text-12.5 text-slate-600">{label}</span>
          </span>
        </Tip>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------- the table
export function CompetitorsPanel({ b, auto, rating, rows, scope, setScope, nearCount, allCount, radius, placeName, isChosen, metrics, reload, onChoose, onRemove, onAdd, onDetail, onGo, addBusy, addError, onFindMaps, findBusy }) {
  const [toast, toastNode] = useToast();
  const [sel, setSel] = useState(() => new Set());
  const [running, setRunning] = useState({}); // host -> 'running' | 'failed'
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [kinds, setKinds] = useState({}); // competitor id -> direct | indirect | '' (just set)
  const [hist, setHist] = useState(null); // {c, runs, loading}
  const [why, setWhy] = useState(null); // the competitor whose Match score is open
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const viewRef = useRef([]); // the rows the table shows now (filtered, sorted): the header checkbox selects these
  const view = viewRef.current;

  const queue = auto?.prog?.queue || [];
  const failedBy = auto?.prog?.failed || {};
  const st = (c) => running[c.host] || (auto?.prog?.running && auto.prog.current === c.host ? 'running' : auto?.prog?.running && queue.includes(c.host) ? 'queued' : metrics[c.host]?.status || 'pending');
  const data = useMemo(() => rows.map(c => ({ ...c, m: metrics[c.host] || {}, status: st(c), chosen: isChosen(c) })), [rows, metrics, running, auto?.prog, isChosen]); // eslint-disable-line react-hooks/exhaustive-deps
  const [onlyChosen, setOnlyChosen] = useState(false); // show every competitor found, or only the ones you chose
  const shown = onlyChosen ? data.filter(c => c.chosen) : data;
  const picked = data.filter(c => sel.has(c.key));
  const toggle = (k) => setSel(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const allOn = view.length > 0 && view.every(c => c.chosen);
  const chosenRows = data.filter(c => c.chosen);

  const setKind = async (c, kind) => {
    if (!c.reg?.id) { toast('Save this competitor first (select it), then mark it direct or indirect.'); return; }
    try { await api(`/competitors/${c.reg.id}/kind`, { method: 'PATCH', body: { kind: kind || null } }); setKinds(k => ({ ...k, [c.reg.id]: kind || '' })); } catch (e) { toast(e.message); }
  };
  const kindOf = (c) => (c.reg?.id != null && kinds[c.reg.id] !== undefined ? kinds[c.reg.id] : c.reg?.kind) || '';
  const openHistory = async (c) => {
    setHist({ c, runs: [], loading: true });
    try { const r = await api(`/businesses/${b.id}/keyword-workspace/competitor-analysis/history?domain=${encodeURIComponent(c.host)}`); setHist({ c, runs: r.runs || [], loading: false }); } catch (e) { setHist({ c, runs: [], loading: false, error: e.message }); }
  };
  const analyze = async (list, force = false) => {
    const todo = list.filter(c => c.host && running[c.host] !== 'running');
    if (!todo.length) { toast('Nothing to analyze: these have no website.'); return; }
    let ok = 0;
    for (const c of todo) { // one competitor at a time, each row shows its own state
      setRunning(r => ({ ...r, [c.host]: 'running' }));
      try {
        const r = await api(`/businesses/${b.id}/keyword-workspace/competitor-analysis/analyze`, { method: 'POST', body: { domain: c.host, limit: 100, force }, timeout: 240000 });
        setRunning(x => { const n = { ...x }; delete n[c.host]; return n; });
        await reload();
        if (r.cached) toast(`${c.name}: ${r.notes[0]}`); else if (r.notes?.length) toast(`${c.name}: ${r.notes[0]}`); else ok += 1;
      } catch (e) { setRunning(x => ({ ...x, [c.host]: 'failed' })); toast(`${c.name}: ${e.message}`); }
    }
    if (ok) toast(`${ok} competitor${ok === 1 ? '' : 's'} analyzed`);
  };
  const choose = async (list, on) => {
    for (const c of list) await onChoose({ ...(c.reg || {}), id: c.reg?.id, name: c.name, website: c.website, maps: c.maps }, on);
    setSel(new Set());
    toast(on ? `${list.length === 1 ? list[0].name : `${list.length} competitors`} chosen: now followed in Competitor Watch.` : `${list.length === 1 ? list[0].name : `${list.length} competitors`} taken out of Competitor Watch.`);
  };
  const remove = async () => { for (const c of picked.filter(x => x.reg)) await onRemove(c.reg); setSel(new Set()); setConfirm(false); };
  const submitAdd = async (e) => { e.preventDefault(); if (await onAdd(url.trim(), name.trim())) { setUrl(''); setName(''); setAdding(false); } };
  const city = (c) => (c.maps?.address || '').split(',').slice(-3, -1).map(x => x.trim()).filter(Boolean).join(', ') || (c.maps?.address || '').split(',')[0];
  // A figure that is a link: pressing it lands on the page that explains it, and a sentence says where.
  const Go = ({ tip, onClick, children }) => (
    <Tip text={tip} align="left"><button type="button" onClick={onClick} aria-label={tip} className="rounded px-1 -mx-1 cursor-pointer hover:bg-indigo-50 hover:text-indigo-700 hover:underline decoration-dotted underline-offset-2 focus-visible:ring-2 focus-visible:ring-indigo-400/60 outline-none">{children}</button></Tip>
  );
  const num0 = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US'));
  const Icon = ({ label, onClick, children, disabled, tone = 'text-slate-500 hover:text-indigo-700' }) => <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className={`p-1 cursor-pointer disabled:opacity-30 disabled:cursor-default ${tone}`}>{children}</button>;

  const cols = [
    {
      id: 'sel', header: <input type="checkbox" aria-label="Choose every competitor shown" title="Tick to choose every competitor shown: they are followed in Competitor Watch" checked={allOn} onChange={e => choose(view.filter(c => c.chosen !== e.target.checked), e.target.checked)} className="accent-indigo-600" />, csv: false,
      cell: c => <input type="checkbox" aria-label={`Choose ${c.name} for Competitor Watch`} title={c.chosen ? 'Chosen: followed in Competitor Watch. Untick to take it out.' : 'Tick to choose it: it is then followed in Competitor Watch'} checked={c.chosen} onChange={() => choose([c], !c.chosen)} className="accent-indigo-600" />, className: 'pl-3 pr-1 py-2.5 w-8', thClass: 'pl-3 pr-1 py-3 w-8'
    },
    {
      id: 'name', header: 'Competitor', first: 'asc', value: c => [c.name, c.host, city(c), c.maps?.distance_m != null ? `${(c.maps.distance_m / 1000).toFixed(1)} km` : ''].filter(Boolean).join(' · '), className: 'px-3 py-2.5 min-w-[220px] max-w-[280px]',
      tip: { what: 'The competitor, its website and where it is. The distance is from the place you are searching. Press the name for its full profile.', from: 'Google Places' },
      cell: c => (
        <div className="flex items-center gap-2.5">
          <Logo host={c.host} name={c.name} />
          <div className="min-w-0">
            <button type="button" onClick={() => onDetail(c)} className="block max-w-full text-left font-semibold text-slate-900 hover:text-indigo-700 hover:underline truncate cursor-pointer" title={`Open the full profile of ${c.name}: rankings, strategy, Google Maps listing, site and links`}>{c.name}{c.chosen && <span className="ml-2 text-11 font-semibold text-emerald-700">Selected</span>}</button>
            {c.host ? <a href={`https://${c.host}`} target="_blank" rel="noreferrer" title={`Open ${c.host} in a new tab`} className="text-12.5 text-blue-700 hover:underline inline-flex items-center gap-1 max-w-full"><span className="truncate">{c.host}</span><ExternalLink size={10} className="shrink-0" /></a> : <span className="block text-12 text-slate-400">no website</span>}
            <span className="flex items-center gap-1 text-12 text-slate-500 min-w-0"><MapPin size={11} className="text-slate-400 shrink-0" />{c.maps?.address ? <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${c.name} ${c.maps.address}`)}`} target="_blank" rel="noreferrer" title={`${c.maps.address}. Open it on Google Maps in a new tab`} className="truncate hover:text-indigo-700 hover:underline">{city(c)}</a> : <span className="truncate text-slate-400">location not available</span>}{c.maps?.distance_m != null && <span className="shrink-0 text-slate-400">· {c.maps.distance_m < 1000 ? `${c.maps.distance_m} m` : `${(c.maps.distance_m / 1000).toFixed(1)} km`}</span>}</span>
          </div>
        </div>)
    },
    {
      id: 'source', header: 'Found by', value: c => (c.reg?.discovery?.length ? c.reg.discovery : [c.reg?.source || (c.maps ? 'google_places' : '')]).filter(Boolean).map(x => SOURCE[x] || x).join(', '), className: 'px-3 py-2.5 text-12.5 text-slate-600', hide: true,
      tip: { what: 'How it was found. A business found on Google Maps is a local competitor; it is not automatically a competitor for organic search.', from: 'Google Places, organic search or added by hand' },
      cell: c => <span>{(c.reg?.discovery?.length ? c.reg.discovery : [c.reg?.source || (c.maps ? 'google_places' : '')]).filter(Boolean).map(x => SOURCE[x] || x).join(', ') || <span className="text-slate-300">Not available</span>}</span>
    },
    {
      id: 'kind', header: 'Type', value: c => (KIND[kindOf(c)] || ['Not judged'])[0], className: 'px-3 py-2.5 whitespace-nowrap',
      tip: { what: 'Your own judgement: a direct competitor sells what you sell to the same customers; an indirect one overlaps only in part. Press to change it.' },
      cell: c => { const k = kindOf(c); const next = k === 'direct' ? 'indirect' : k === 'indirect' ? '' : 'direct'; return <button type="button" onClick={() => setKind(c, next)} title={`Press to set: ${next ? KIND[next][0] : 'not judged'}`} className={`text-12 font-semibold px-2 py-0.5 rounded-full ring-1 cursor-pointer ${k ? KIND[k][1] : 'text-slate-400 ring-slate-200 bg-white'}`}>{k ? KIND[k][0] : 'Not judged'}</button>; }
    },
    { id: 'da', header: 'DA', value: c => c.m.da ?? null, first: 'desc', tip: { what: 'Domain Authority, 0 to 100: how strongly a site is likely to rank. It is not the Match score.', from: 'Moz, read through Apify' }, className: 'px-3 py-2.5 text-center', thClass: 'px-3 py-3', cell: c => <Go tip={`Domain Authority of ${c.host || c.name}: ${c.m.da ?? 'not read yet'}. Open the backlink comparison for it`} onClick={() => onGo('backlinks', c.host)}><span className={`inline-flex items-center justify-center min-w-[34px] h-7 px-2 rounded-md text-13 font-bold ${daTone(c.m.da)}`}>{c.m.da ?? '—'}</span></Go> },
    { id: 'kw', header: 'Keywords', right: true, first: 'desc', value: c => c.m.keywords ?? null, tip: { what: 'How many keywords it ranks for in a ranked-keywords read, for the market below. Not available until analyzed.', from: 'Ranked-keywords read (Apify)' }, cell: c => <Go tip={`See the ${num0(c.m.keywords)} keywords ${c.name} ranks for, and where you stand against it`} onClick={() => onGo('keywords', c.host)}>{num0(c.m.keywords)}</Go> },
    { id: 'top3', hide: true, header: 'Top 3', right: true, first: 'desc', value: c => c.m.top3 ?? null, tip: { what: 'Keywords where it holds one of the first three positions.', from: 'Counted from its ranked keywords' }, cell: c => <Go tip={`See the keywords where ${c.name} is in the top 3`} onClick={() => onGo('keywords', c.host, 'top3')}>{num0(c.m.top3)}</Go> },
    { id: 'top10', hide: true, header: 'Top 10', right: true, first: 'desc', value: c => c.m.top10 ?? null, tip: { what: 'Keywords on page 1 of Google.', from: 'Counted from its ranked keywords' }, cell: c => <Go tip={`See the keywords where ${c.name} is on page 1`} onClick={() => onGo('keywords', c.host, 'top10')}>{num0(c.m.top10)}</Go> },
    { id: 'avg', hide: true, header: 'Avg position', right: true, value: c => c.m.avg_position ?? null, tip: { what: 'Average position across its ranked keywords. Lower is better.', from: 'Counted from its ranked keywords' }, cell: c => <Go tip={`Average position of ${c.name} across its ranked keywords. Open them`} onClick={() => onGo('keywords', c.host)}>{c.m.avg_position == null ? '—' : `#${c.m.avg_position}`}</Go> },
    { id: 'traffic', header: 'Traffic', right: true, first: 'desc', value: c => c.m.traffic ?? null, tip: { what: 'Estimated organic visits a month. An estimate, not verified traffic.', from: 'Estimated from ranked keywords' }, cell: c => <Go tip={`Estimated monthly visits to ${c.name}. Open the traffic comparison`} onClick={() => onGo('traffic', c.host)}>{kfmt(c.m.traffic)}</Go> },
    { id: 'rd', hide: true, header: 'Ref. domains', right: true, first: 'desc', value: c => c.m.rd ?? null, cell: c => <Go tip={`Websites linking to ${c.name}. Open the backlink comparison`} onClick={() => onGo('backlinks', c.host)}>{kfmt(c.m.rd)}</Go>, tip: { what: 'Websites linking to it. Not available until analyzed.', from: 'Moz' } },
    {
      id: 'match', header: 'Match', first: 'desc', value: c => c.maps?.relevance?.score ?? null, tip: { what: 'Match score, 0 to 100: how closely it competes with your business. Press the score for the factors. It is not Domain Authority.', from: 'Calculated here from its Maps listing and site' },
      cell: c => (!c.maps?.relevance && rating?.loading ? <span className="inline-flex items-center gap-1 text-12 text-slate-400"><Loader2 size={12} className="animate-spin" />rating…</span> : c.maps?.relevance ? <Go tip={`${c.maps.relevance.label_text || 'Match'}, score ${c.maps.relevance.score}/100. Press to see which factors make it up`} onClick={() => setWhy(c)}><span className="inline-flex items-center gap-1.5"><b className="tabular-nums">{c.maps.relevance.score}</b><span className={`w-2 h-2 rounded-full ${c.maps.relevance.label === 'direct' ? 'bg-emerald-500' : c.maps.relevance.label === 'related' ? 'bg-amber-400' : 'bg-slate-300'}`} /></span></Go> : <span className="text-slate-300">—</span>)
    },
    {
      id: 'last', hide: true, header: 'Last analyzed', first: 'desc', value: c => c.m.kw_read_at || c.m.site_read_at || null, className: 'px-3 py-2.5 whitespace-nowrap text-12.5 text-slate-600', tip: { what: 'When its figures were last read. Not available until it has been analyzed.' },
      cell: c => { const t = c.m.kw_read_at || c.m.site_read_at; return t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : <span className="text-slate-300">Not available</span>; }
    },
    {
      id: 'status', header: 'Status', value: c => (STATUS[c.status] || STATUS.pending)[0], className: 'px-3 py-2.5 whitespace-nowrap',
      cell: c => {
        const done = c.status === 'analyzed' || c.status === 'partial';
        const busy = c.status === 'running' || c.status === 'queued';
        const tip = failedBy[c.host] && !done ? `Last try failed: ${failedBy[c.host]}. Press to analyze again` : done ? `${c.name} is analyzed. Open its traffic comparison` : busy ? 'It is being read now' : c.host ? 'Not analyzed yet. Press to read its Domain Authority and ranked keywords now' : 'It has no website to analyze';
        return <Go tip={tip} onClick={() => (done ? onGo('traffic', c.host) : busy || !c.host ? null : analyze([c], true))}><Badge tone={failedBy[c.host] && c.status !== 'analyzed' ? 'amber' : (STATUS[c.status] || STATUS.pending)[1]}>{c.status === 'running' && <Loader2 size={11} className="animate-spin" />}{(STATUS[c.status] || STATUS.pending)[0]}</Badge></Go>;
      }
    },
    { id: 'chosen', header: 'Selected', value: c => (c.chosen ? 'Yes' : 'No'), hide: true },
    {
      id: 'actions', header: 'Actions', right: true, csv: false, className: 'px-2 py-1.5 text-right whitespace-nowrap',
      cell: c => (
        <span className="inline-flex items-center">
          <Icon label={`View ${c.name}`} onClick={() => onDetail(c)}><Eye size={16} /></Icon>
          <Icon label={c.status === 'analyzed' ? 'Refresh: read it again (uses Apify credit). Its figures are already saved and shown.' : 'Analyze now: Domain Authority and ranked keywords'} disabled={!c.host || c.status === 'running'} onClick={() => analyze([c], true)}><BarChart3 size={16} /></Icon>
          <Icon label="Its keywords" onClick={() => onGo('keywords', c.host)}><Layers size={16} /></Icon>
          <Icon label="Analysis history: every earlier read of this competitor" disabled={!c.host} onClick={() => openHistory(c)}><Clock size={16} /></Icon>
          <Icon label={c.chosen ? 'Remove from selected competitors' : 'Select as a competitor'} onClick={() => choose([c], !c.chosen)} tone={c.chosen ? 'text-emerald-600 hover:text-emerald-800' : 'text-slate-500 hover:text-emerald-700'}><CheckCircle2 size={16} /></Icon>
          {c.reg && <Icon label="Remove this competitor" onClick={() => { setSel(new Set([c.key])); setConfirm(true); }} tone="text-slate-400 hover:text-rose-600"><Trash2 size={16} /></Icon>}
        </span>)
    },
  ];
  const toolbar = (
    <>
      <div className="inline-flex rounded-lg ring-1 ring-inset ring-slate-300 overflow-hidden" role="group" aria-label="Which competitors">
        {[[false, `All found (${data.length})`], [true, `Chosen (${data.filter(c => c.chosen).length})`]].map(([v, l]) => <button key={String(v)} type="button" aria-pressed={onlyChosen === v} onClick={() => setOnlyChosen(v)} className={`h-8 px-3 text-12 font-medium cursor-pointer ${onlyChosen === v ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}
      </div>
      <div className="inline-flex rounded-lg ring-1 ring-inset ring-slate-300 overflow-hidden" role="group" aria-label="Where">
        {[['near', `Within ${radius >= 1000 ? `${Math.round(radius / 100) / 10} km` : `${radius} m`} of ${placeName || 'the place'} (${nearCount})`], ['all', `Everywhere (${allCount})`]].map(([k, l]) => <button key={k} type="button" aria-pressed={scope === k} onClick={() => setScope(k)} className={`h-8 px-3 text-12 font-medium cursor-pointer ${scope === k ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}
      </div>
      <Button size="sm" icon={MapPin} busy={findBusy} onClick={onFindMaps} title="Find more competitors on Google Maps around the place">Find more</Button>
      <Button size="sm" icon={Plus} variant="primary" onClick={() => setAdding(a => !a)} aria-expanded={adding}>Add competitor</Button>
    </>
  );

  return (
    <div className="space-y-3">
      {adding && (
        <form onSubmit={submitAdd} className="rounded-xl bg-white ring-1 ring-slate-200 px-4 py-3 flex flex-wrap items-center gap-2">
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="Website or domain, e.g. competitor.com" aria-label="Competitor website" className="h-10 flex-1 min-w-[220px] rounded-lg ring-1 ring-inset ring-slate-300 px-3 text-13 focus:ring-2 focus:ring-indigo-500 outline-none" />
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name (optional)" aria-label="Competitor name" className="h-10 w-52 rounded-lg ring-1 ring-inset ring-slate-300 px-3 text-13 focus:ring-2 focus:ring-indigo-500 outline-none" />
          <Button type="submit" variant="primary" busy={addBusy} disabled={url.trim().length < 3}>Add</Button>
          <Button type="button" onClick={() => setAdding(false)}>Cancel</Button>
          {addError && <div className="w-full"><ErrorNote>{addError}</ErrorNote></div>}
        </form>
      )}
      <DataTable columnsKey="competitors" dense columns={cols} rows={shown} rowKey={c => c.key} toolbar={toolbar} initialSort={{ key: 'match', dir: 'desc' }} pageSize={10} serial minWidth={860} label="competitors"
        exportName="competitors" searchPlaceholder="Search competitor by name or domain" onState={s => { viewRef.current = s.rows; }}
        rowClass={c => (sel.has(c.key) ? 'bg-indigo-50/50' : c.chosen ? 'bg-emerald-50/30 hover:bg-emerald-50/60' : 'hover:bg-slate-50')}
        empty={rows.length ? 'No competitor matches these filters.' : scope === 'near' ? `No competitor found within ${radius >= 1000 ? `${radius / 1000} km` : `${radius} m`} of ${placeName || 'this place'}. Try Everywhere, a larger distance or Find more.` : 'No competitors yet. Find them on Google Maps or add one by its website.'} />
      <p className="text-12 text-slate-500">Ranking keywords, Top 3, Top 10, average position and traffic are for the market of this project{rating?.market ? ` (${rating.market})` : ''}, read from each competitor's ranked keywords. Distance and Match are for {placeName || 'the chosen place'}.</p>

      {chosenRows.length > 0 && (
        <div className="sticky bottom-3 z-20"><div role="toolbar" aria-label="Chosen competitors" className="rounded-xl bg-white shadow-xl ring-1 ring-slate-200 px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-800 text-13.5 font-semibold">{chosenRows.length} chosen</span>
          <span className="text-12.5 text-slate-500">Followed in Competitor Watch. Untick a row to take it out.</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Link to="/competitor-watch"><Button icon={Eye}>Open Competitor Watch</Button></Link>
            <Button variant="primary" icon={BarChart3} disabled={!chosenRows.some(c => c.host)} onClick={() => analyze(chosenRows)} title={`Analyze reads Domain Authority and up to 100 keywords: about $${COST(100)} each at Apify.`}>Analyze chosen</Button>
          </div>
        </div></div>
      )}
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Remove competitors?" width="max-w-md" footer={<><Button onClick={() => setConfirm(false)}>Cancel</Button><Button variant="danger" onClick={remove}>Remove {picked.filter(c => c.reg).length}</Button></>}>
        <p className="text-13 text-slate-600">These saved competitors are deleted from your list, with their kept keywords: {picked.filter(c => c.reg).map(c => c.name).join(', ')}. Businesses only found on Google Maps are not saved and stay as they are.</p>
      </Modal>
      {why && <MatchDrawer c={why} rating={rating} onClose={() => setWhy(null)} onProfile={() => { const c = why; setWhy(null); onDetail(c); }} />}
      <Modal open={!!hist} onClose={() => setHist(null)} title={hist ? `Analysis history: ${hist.c.name}` : ''} width="max-w-2xl" footer={<Button onClick={() => setHist(null)}>Close</Button>}>
        {hist?.loading ? <p className="text-13 text-slate-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" />Loading…</p>
          : hist?.error ? <ErrorNote>{hist.error}</ErrorNote>
            : !hist?.runs.length ? <p className="text-13 text-slate-500">Not analyzed yet. Each analysis is kept here; a refresh adds a new line and never replaces an old one.</p>
              : <ul className="space-y-2">{hist.runs.map(r => (
                <li key={r.id ?? 'earlier'} className="rounded-lg ring-1 ring-slate-200 px-3 py-2 text-12.5">
                  <div className="flex flex-wrap items-center gap-2"><Badge tone={(STATUS[r.status] || STATUS.pending)[1]}>{(STATUS[r.status] || [r.status])[0]}</Badge><span className="text-slate-600">{fdate(r.finished_at || r.started_at)}</span><span className="text-slate-400">{r.earlier ? 'read before history was kept' : r.trigger === 'auto' ? 'automatic' : 'by hand'}</span></div>
                  <div className="mt-1 text-slate-600">{Object.entries(r.parts || {}).map(([k, v]) => `${k === 'authority' ? 'Domain Authority' : 'Ranked keywords'}: ${v.status === 'ok' ? 'read' : 'not read'} (${v.provider})`).join(' · ') || '—'}</div>
                  {r.error && <div className="mt-1 text-amber-700">{r.error}</div>}
                  {r.snapshot && Object.values(r.snapshot).some(v => v != null) && <div className="mt-1 text-slate-500">DA {r.snapshot.da ?? '—'} · keywords {num(r.snapshot.keywords)} · top 10 {num(r.snapshot.top10)} · traffic {kfmt(r.snapshot.traffic)} · ref. domains {kfmt(r.snapshot.rd)}</div>}
                </li>))}</ul>}
      </Modal>
      {toastNode}
    </div>
  );
}
const BarChartIcon = ({ size = 14, ...p }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 3v12" /><path d="m7 11 5 5 5-5" /><path d="M5 21h14" /></svg>;

// ---------------------------------------------------------------------------------------------------------------------------------- comparison tabs
function Bars({ rows, value, fmt = kfmt, color = '#6366f1' }) {
  const max = Math.max(1, ...rows.map(r => r.v || 0));
  return (
    <ul className="space-y-2.5">{rows.map(r => (
      <li key={r.host} className="flex items-center gap-3"><span className={`w-44 truncate text-13 ${r.you ? 'font-semibold text-slate-900' : 'text-slate-700'}`} title={r.host}>{r.you ? `${r.host} (you)` : r.name}</span>
        <div className="flex-1 h-3 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.max(r.v ? 2 : 0, ((r.v || 0) / max) * 100)}%`, background: r.you ? '#059669' : color }} /></div>
        <span className="w-20  tabular-nums text-13 font-semibold">{r.v == null ? <span className="text-slate-300 font-normal">not read</span> : fmt(r.v)}</span></li>
    ))}</ul>
  );
}

const Panel = ({ title, sub, children, action }) => <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4"><div className="flex items-start gap-3 mb-3"><div><h3 className="text-15 font-semibold text-slate-900">{title}</h3>{sub && <p className="text-12.5 text-slate-500">{sub}</p>}</div>{action && <div className="ml-auto">{action}</div>}</div>{children}</div>;
const unread = (analysis, rows) => rows.filter(c => c.host && !analysis.metrics[c.host]?.keywords).length;

const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#ef4444'];

/** One line per competitor: its estimated traffic at the end of each analysis run. Only real runs are points. */
function TrendChart({ trend, hosts }) {
  const series = hosts.map((h, i) => ({ h, color: PALETTE[i % PALETTE.length], pts: (trend[h] || []).filter(p => p.traffic != null) })).filter(x => x.pts.length);
  const many = series.filter(x => x.pts.length >= 2);
  if (!many.length) return <p className="text-13 text-slate-500">{series.length ? 'Each competitor has been analyzed once, so there is no trend yet. A line appears after its second analysis.' : 'No traffic has been read yet.'} Nothing is filled in between analyses.</p>;
  const all = many.flatMap(x => x.pts);
  const t0 = Math.min(...all.map(p => +new Date(p.at))), t1 = Math.max(...all.map(p => +new Date(p.at))), vmax = Math.max(1, ...all.map(p => p.traffic));
  const X = (t) => 40 + (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0)) * 540, Y = (v) => 150 - (v / vmax) * 130;
  return (
    <div>
      <svg viewBox="0 0 600 175" className="w-full h-44" role="img" aria-label="Estimated organic traffic at each analysis">
        <line x1="40" y1="150" x2="580" y2="150" stroke="#e2e8f0" /><line x1="40" y1="20" x2="40" y2="150" stroke="#e2e8f0" />
        <text x="36" y="24" fontSize="10" textAnchor="end" fill="#64748b">{kfmt(vmax)}</text><text x="36" y="150" fontSize="10" textAnchor="end" fill="#64748b">0</text>
        <text x="40" y="168" fontSize="10" fill="#64748b">{new Date(t0).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</text><text x="580" y="168" fontSize="10" textAnchor="end" fill="#64748b">{new Date(t1).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</text>
        {many.map(x => <g key={x.h}><polyline fill="none" stroke={x.color} strokeWidth="2" points={x.pts.map(p => `${X(+new Date(p.at))},${Y(p.traffic)}`).join(' ')} />{x.pts.map((p, i) => <circle key={i} cx={X(+new Date(p.at))} cy={Y(p.traffic)} r="3" fill={x.color}><title>{`${x.h}: ${kfmt(p.traffic)} on ${fdate(p.at)}`}</title></circle>)}</g>)}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-12 text-slate-600">{many.map(x => <span key={x.h} className="inline-flex items-center gap-1.5"><span className="w-3 h-0.5 rounded" style={{ background: x.color }} />{x.h}</span>)}</div>
    </div>
  );
}

export function TrafficTab({ b, rows, analysis, focus = '' }) {
  const [fh, setFh] = useState(focus);
  const [topKw, setTopKw] = useState(null);
  const [trend, setTrend] = useState(null);
  const [kwOf, setKwOf] = useState('');
  const doms = rows.filter(c => c.host && (!focus || sameSite(c.host, focus))).map(c => c.host);
  useEffect(() => {
    if (!b || !doms.length) return undefined;
    let on = true;
    const base = `/businesses/${b.id}/keyword-workspace/competitor-analysis`;
    api(`${base}/top-keywords`, { method: 'POST', body: { domains: doms } }).then(r => on && setTopKw(r.keywords || {})).catch(() => on && setTopKw({}));
    api(`${base}/trend`, { method: 'POST', body: { domains: doms } }).then(r => on && setTrend(r.trend || {})).catch(() => on && setTrend({}));
    return () => { on = false; };
  }, [b?.id, doms.join('|'), analysis.metrics]); // eslint-disable-line react-hooks/exhaustive-deps
  const own = fh ? null : analysis.own;
  const list = rows.filter(c => c.host && (!fh || sameSite(c.host, fh)));
  const mk = (key) => [...(own ? [{ host: own.domain, name: own.domain, you: true, v: own[key] }] : []), ...list.map(c => ({ host: c.host, name: c.name, v: analysis.metrics[c.host]?.[key] ?? null }))].sort((a, c) => (c.v ?? -1) - (a.v ?? -1));
  const data = useMemo(() => [...(own ? [{ host: own.domain, name: own.domain, you: true, ...own }] : []), ...list.map(c => ({ host: c.host, name: c.name, ...(analysis.metrics[c.host] || {}) }))], [own, rows, analysis.metrics]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = unread(analysis, rows);
  const compTotal = list.reduce((a, c) => a + (analysis.metrics[c.host]?.traffic || 0), 0);
  const cols = [
    { id: 'site', header: 'Site', first: 'asc', value: r => r.host, cell: r => <span className="font-medium">{r.host}{r.you && <span className="ml-2 text-11 font-semibold text-emerald-700">You</span>}</span> },
    { id: 'traffic', header: 'Organic traffic', right: true, first: 'desc', value: r => r.traffic ?? null, cell: r => (r.traffic == null ? <span className="text-slate-300">Not available</span> : kfmt(r.traffic)), tip: { what: 'Competitors: estimated visits a month from their ranked keywords (an estimate). Yours: Google clicks in the last 28 days (verified).' } },
    { id: 'basis', header: 'Traffic basis', value: r => (r.you ? 'Verified' : r.traffic != null ? 'Estimated' : ''), cell: r => (r.you ? <Badge tone="green">Verified</Badge> : r.traffic != null ? <Badge tone="gray">Estimated</Badge> : <span className="text-slate-300">—</span>), tip: { what: 'Verified = measured by Google for your own site (Search Console). Estimated = worked out from the keywords a competitor ranks for and their positions; it is not their real analytics.', from: 'Search Console / ranked keywords (Apify)' } },
    { id: 'share', header: 'Share of competitors', right: true, first: 'desc', value: r => (r.you || r.traffic == null || !compTotal ? null : r.traffic / compTotal), cell: r => (r.you || r.traffic == null || !compTotal ? <span className="text-slate-300">—</span> : `${Math.round((r.traffic / compTotal) * 100)}%`), tip: { what: 'Its part of all the estimated competitor traffic shown. Your own figure is not included: it is measured another way.' } },
    { id: 'keywords', header: 'Ranking keywords', right: true, first: 'desc', value: r => r.keywords ?? null, cell: r => num(r.keywords) },
    { id: 'top3', header: 'Top 3', right: true, first: 'desc', value: r => r.top3 ?? null },
    { id: 'top10', header: 'Top 10', right: true, first: 'desc', value: r => r.top10 ?? null },
    { id: 'avg', header: 'Avg position', right: true, value: r => r.avg_position ?? null, cell: r => (r.avg_position == null ? '—' : `#${r.avg_position}`) },
    { id: 'da', header: 'DA', right: true, first: 'desc', value: r => r.da ?? null },
    { id: 'read', header: 'Keywords read', value: r => r.kw_read_at || '', cell: r => (r.kw_read_at ? new Date(r.kw_read_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : r.you ? 'Search Console' : <span className="text-slate-400">not read</span>) },
  ];
  const filters = [
    { id: 'read', label: 'Keywords', options: [['read', 'Read'], ['unread', 'Not read']], test: (r, v) => (v === 'read' ? r.keywords != null : r.keywords == null) },
    { id: 'rank', label: 'Rankings', options: [['top3', 'Has top 3'], ['top10', 'Has page 1']], test: (r, v) => (v === 'top3' ? (r.top3 || 0) > 0 : (r.top10 || 0) > 0) },
  ];
  return (
    <div className="space-y-4">
      <FocusBar name={fh} what="its traffic, rankings and authority" onAll={() => setFh('')} />
      {n > 0 && <div className="rounded-lg bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-12.5 text-amber-900">{n} competitor{n === 1 ? ' has' : 's have'} not been analyzed yet, so {n === 1 ? 'its' : 'their'} traffic is “not read”. They are analyzed automatically; you can also select them on the Competitors tab and press Analyze selected.</div>}
      <DataTable columnsKey="traffic" columns={cols} rows={data} rowKey={r => r.host} filters={filters} collapseFilters initialSort={{ key: 'traffic', dir: 'desc' }} exportName="traffic-comparison" searchPlaceholder="Search sites" label="sites" rowClass={r => (r.you ? 'bg-emerald-50/50' : 'hover:bg-slate-50')} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Organic traffic: estimated vs verified" sub="Competitors are estimated; you (green) are verified Google clicks, last 28 days."><Bars rows={mk('traffic')} /></Panel>
        <Panel title="Ranking keywords" sub="Keywords each one ranks for (yours: tracked keywords that rank)."><Bars rows={mk('keywords')} fmt={num} color="#0ea5e9" /></Panel>
        <Panel title="Where the competitors' traffic is" sub="Each competitor's share of the estimated competitor traffic.">
          {compTotal ? <><div className="flex h-5 rounded-full overflow-hidden bg-slate-100" role="img" aria-label="Share of estimated competitor traffic">{list.filter(c => analysis.metrics[c.host]?.traffic).map((c, i) => <div key={c.host} title={`${c.host}: ${Math.round((analysis.metrics[c.host].traffic / compTotal) * 100)}%`} style={{ width: `${(analysis.metrics[c.host].traffic / compTotal) * 100}%`, background: PALETTE[i % PALETTE.length] }} />)}</div>
            <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-12.5">{list.filter(c => analysis.metrics[c.host]?.traffic).map((c, i) => <li key={c.host} className="flex items-center gap-1.5 min-w-0"><span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} /><span className="truncate">{c.host}</span><b className="ml-auto tabular-nums">{Math.round((analysis.metrics[c.host].traffic / compTotal) * 100)}%</b></li>)}</ul></> : <p className="text-13 text-slate-500">No competitor traffic has been read yet.</p>}
        </Panel>
        <Panel title="Keywords in the top 3" sub="Keywords in the first three positions."><Bars rows={mk('top3')} fmt={num} color="#10b981" /></Panel>
        <Panel title="Keywords in the top 10" sub="Keywords on page 1 of Google."><Bars rows={mk('top10')} fmt={num} color="#f59e0b" /></Panel>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Traffic over time" sub="At the end of each analysis. Nothing is filled in between.">{trend ? <TrendChart trend={trend} hosts={list.map(c => c.host)} /> : <Loader2 size={16} className="animate-spin text-slate-400" />}</Panel>
        <Panel title="Keywords that bring the most traffic" sub="Estimated visits a month for each keyword." action={<Select value={kwOf || list.find(c => topKw?.[c.host])?.host || ''} onChange={e => setKwOf(e.target.value)} aria-label="Competitor" className="h-8 rounded-lg ring-1 ring-inset ring-slate-300 bg-white px-2 text-13">{list.filter(c => topKw?.[c.host]).map(c => <option key={c.host} value={c.host}>{c.host}</option>)}</Select>}>
          {!topKw ? <Loader2 size={16} className="animate-spin text-slate-400" /> : (() => {
            const h = kwOf || list.find(c => topKw[c.host])?.host; const ks = h ? topKw[h] || [] : []; return ks.length ? (
              <table className="w-full text-12.5"><thead><tr className="text-left text-slate-500"><th className="py-1 font-medium">Keyword</th><th className="font-medium text-right">Position</th><th className="font-medium text-right">Searches</th><th className="font-medium text-right">Est. visits</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{ks.map(k => <tr key={k.keyword}><td className="py-1 text-slate-900">{k.keyword}</td><td className=" tabular-nums">{k.position ? `#${k.position}` : '—'}</td><td className=" tabular-nums">{num(k.volume)}</td><td className=" tabular-nums font-semibold">{kfmt(Math.round(k.traffic))}</td></tr>)}</tbody></table>
            ) : <p className="text-13 text-slate-500">No keywords read yet. Analyze a competitor on the Competitors tab.</p>;
          })()}
        </Panel>
      </div>
    </div>
  );
}

export function BacklinkTab({ rows, analysis, focus = '' }) {
  const [fh, setFh] = useState(focus);
  const own = fh ? null : analysis.own;
  const data = useMemo(() => [...(own ? [{ host: own.domain, name: own.domain, you: true, ...own }] : []), ...rows.filter(c => c.host && (!fh || sameSite(c.host, fh))).map(c => ({ host: c.host, name: c.name, ...(analysis.metrics[c.host] || {}) }))], [own, rows, analysis.metrics, fh]);
  const bar = (key) => data.map(r => ({ host: r.host, name: r.name, you: r.you, v: r[key] ?? null })).sort((a, c) => (c.v ?? -1) - (a.v ?? -1));
  const cols = [
    { id: 'site', header: 'Site', first: 'asc', value: r => r.host, cell: r => <span className="font-medium">{r.host}{r.you && <span className="ml-2 text-11 font-semibold text-emerald-700">You</span>}</span> },
    { id: 'name', header: 'Name', value: r => r.name, hide: true },
    { id: 'da', header: 'Domain Authority', first: 'desc', value: r => r.da ?? null, className: 'px-3 py-2.5 text-center', cell: r => <span className={`inline-flex min-w-[34px] h-6 items-center justify-center rounded-md px-2 font-bold ${daTone(r.da)}`}>{r.da ?? '—'}</span> },
    { id: 'pa', header: 'Page Authority', right: true, first: 'desc', value: r => r.pa ?? null },
    { id: 'rd', header: 'Referring domains', right: true, first: 'desc', value: r => r.rd ?? null, cell: r => num(r.rd) },
    { id: 'spam', header: 'Spam score', right: true, value: r => r.spam ?? null, cell: r => (r.spam == null ? '—' : `${r.spam}%`) },
    { id: 'read', header: 'Last read', value: r => r.site_read_at || '', cell: r => (r.site_read_at ? new Date(r.site_read_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : <span className="text-slate-400">not read</span>) },
  ];
  const filters = [
    { id: 'da', label: 'Authority', options: [['strong', 'Strong (60+)'], ['mid', 'Medium (30 to 59)'], ['weak', 'Weak (under 30)'], ['unread', 'Not read']], test: (r, v) => (v === 'unread' ? r.da == null : r.da != null && (v === 'strong' ? r.da >= 60 : v === 'mid' ? r.da >= 30 && r.da < 60 : r.da < 30)) },
    { id: 'spam', label: 'Spam score', options: [['high', '10% and over'], ['low', 'Under 10%']], test: (r, v) => r.spam != null && (v === 'high' ? r.spam >= 10 : r.spam < 10) },
  ];
  return (
    <div className="space-y-4">
      <FocusBar name={fh} what="its authority and backlinks" onAll={() => setFh('')} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Domain Authority" sub="How strong each site is, 0 to 100 (Moz, through Apify)."><Bars rows={bar('da')} fmt={num} color="#8b5cf6" /></Panel>
        <Panel title="Referring domains" sub="How many different websites link to each site (Moz)."><Bars rows={bar('rd')} fmt={num} color="#6366f1" /></Panel>
      </div>
      <DataTable columnsKey="backlinks" columns={cols} rows={data} rowKey={r => r.host} filters={filters} collapseFilters initialSort={{ key: 'da', dir: 'desc' }} exportName="backlink-comparison" searchPlaceholder="Search sites" label="sites" rowClass={r => (r.you ? 'bg-emerald-50/50' : 'hover:bg-slate-50')} />
      <p className="text-12 text-slate-500">The links themselves, the sites that link to a competitor and not to you, are on the <Link className="text-indigo-600 underline" to="/backlinks/overview">Backlinks</Link> page (Compare).</p>
    </div>
  );
}

function PageDrawer({ b, pg, all, onClose }) {
  const [toast, toastNode] = useToast();
  const [busy, setBusy] = useState(false);
  const [kdOf, setKdOf] = useState({});
  const [kdBusy, setKdBusy] = useState(false);
  const list = pg.list || [];
  const readKd = async () => {
    setKdBusy(true);
    try {
      const r = await api(`/businesses/${b.id}/keyword-workspace/competitor-gap/kd`, { method: 'POST', body: { limit: 10, keywords: list.filter(k => k.kd == null && kdOf[k.keyword] == null).map(k => k.keyword).slice(0, 10) }, timeout: 600000 });
      const got = {}; for (const row of r.gap?.rows || []) if (row.kd != null) got[row.keyword] = row.kd;
      setKdOf(m => ({ ...m, ...got }));
      toast(r.read ? `Difficulty read for ${r.read} keyword${r.read === 1 ? '' : 's'}${r.failed ? `, ${r.failed} could not be read` : ''}.` : r.failed ? `Could not read: ${(r.errors || [])[0] || 'no figures'}` : 'These keywords already have their difficulty.');
    } catch (e) { toast(e.message || 'The difficulty could not be read.'); } finally { setKdBusy(false); }
  };
  const onPage = new Set(list.map(k => k.keyword));
  const near = list.filter(k => k.position >= 4 && k.position <= 20).sort((x, y) => (y.volume || 0) - (x.volume || 0));
  const opps = list.filter(k => !k.yours).sort((x, y) => (y.volume || 0) - (x.volume || 0));
  const words = (pg.top_keyword || '').split(' ').filter(w => w.length > 3);
  const related = [...new Map(all.filter(p => p.domain === pg.domain && p.url !== pg.url).flatMap(p => p.list || []).filter(k => !onPage.has(k.keyword) && words.some(w => k.keyword.split(' ').includes(w))).map(k => [k.keyword, k])).values()].sort((x, y) => (y.volume || 0) - (x.volume || 0)).slice(0, 8);
  const add = async (ks) => {
    if (!ks.length) return;
    setBusy(true);
    try {
      const res = await api(`/businesses/${b.id}/keywords`, { method: 'POST', body: ks.map(k => ({ keyword: k.keyword, volume: k.volume ?? undefined, difficulty: k.difficulty ?? undefined, cpc: k.cpc ?? undefined, intent: k.intent || undefined, source: { kind: 'competitors', label: `Competitor keywords: ${pg.domain}`, competitor: pg.domain, from: 'competitor_top_pages', at: new Date().toISOString().slice(0, 10) } })), timeout: 120000 });
      toast(`${res.added} new keyword${res.added === 1 ? '' : 's'} added to My Keywords${res.existing?.length ? `. ${res.existing.length} already there, not duplicated` : ''}`);
    } catch (e) { toast(e.message || 'The keywords could not be added.'); } finally { setBusy(false); }
  };
  const Kw = ({ k }) => <tr><td className="py-1 text-slate-900">{k.keyword}</td><td className=" tabular-nums">{k.position ? `#${k.position}` : '—'}</td><td className=" tabular-nums">{num(k.volume)}</td><td className=" tabular-nums" title={k.kd != null ? 'SEO difficulty from the real top 10 on Google' : 'Not read yet. Use Read KD above.'}>{kdOf[k.keyword] ?? k.kd ?? '—'}</td><td className=" tabular-nums">{k.yours ? `#${k.yours}` : <span className="text-slate-400">Not ranking</span>}</td><td className="text-right"><button type="button" onClick={() => add([k])} title="Add to My Keywords" aria-label={`Add ${k.keyword} to My Keywords`} className="p-1 text-slate-400 hover:text-emerald-700 cursor-pointer"><Plus size={14} /></button></td></tr>;
  return (
    <Modal open onClose={onClose} width="max-w-3xl" title={pg.url.replace(/^https?:\/\/(www\.)?/, '')} footer={<Button onClick={onClose}>Close</Button>}>
      {pg.live === false && <div role="alert" className="mb-2 rounded-lg bg-rose-50 ring-1 ring-rose-200 px-3 py-2 text-13 text-rose-900"><b>This page no longer exists</b> (it answered {pg.page_status}). The rankings below were read {pg.read_at ? `on ${fdate(pg.read_at)}` : 'earlier'}, when Google still showed it, so they are out of date and its traffic is not counted.</div>}
      {pg.live !== false && pg.read_at && <p className="mb-2 text-12 text-slate-500">Rankings read on {fdate(pg.read_at)}.</p>}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
        {[['Est. traffic', kfmt(pg.traffic)], ['Ranking keywords', num(pg.keywords)], ['Best position', pg.best ? `#${pg.best}` : '—'], ['Backlinks to the page', 'Not available']].map(([k, v]) => <div key={k} className="rounded-lg bg-slate-50 px-3 py-2"><div className="text-11.5 text-slate-500">{k}</div><div className="text-14 font-semibold text-slate-900">{v}</div></div>)}
      </div>
      <p className="mt-2 text-13"><a href={pg.url} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline break-all inline-flex items-center gap-1">{pg.url}<ExternalLink size={11} /></a><span className="block text-12 text-slate-500">The page title and its backlinks are not read by any data source connected here, so they are not shown. The traffic is an estimate from its ranked keywords.</span></p>
      <div className="mt-4 flex items-center justify-between gap-2"><h4 className="text-13 font-semibold text-slate-900">Keywords this page ranks for <span className="font-normal text-slate-400">(top {list.length} by traffic)</span></h4><Button size="sm" busy={kdBusy} disabled={!list.some(k => k.kd == null && kdOf[k.keyword] == null)} onClick={readKd} title="Reads the SEO difficulty (top 10 on Google) of up to 10 of these keywords that have none yet. Costs Apify credit for each; the result is kept.">Read KD</Button></div>
      <table className="mt-1 w-full text-12.5"><thead><tr className="text-left text-slate-500"><th className="py-1 font-medium">Keyword</th><th className="font-medium text-right">Their position</th><th className="font-medium text-right">Searches</th><th className="font-medium text-right">KD</th><th className="font-medium text-right">You</th><th /></tr></thead><tbody className="divide-y divide-slate-100">{list.map(k => <Kw key={k.keyword} k={k} />)}</tbody></table>
      <h4 className="mt-4 text-13 font-semibold text-slate-900">Page-level opportunities</h4>
      {near.length ? <><p className="text-12 text-slate-500">Keywords where this page is on page 2 or low on page 1 (position 4 to 20): the ones a competitor could lose, or you could take.</p><div className="mt-1 flex flex-wrap gap-1.5">{near.map(k => <span key={k.keyword} className="px-2.5 py-1 rounded-full text-12.5 bg-amber-50 border border-amber-200 text-amber-900">{k.keyword} <b>#{k.position}</b></span>)}</div></> : <p className="text-13 text-slate-500">None of its keywords sit between position 4 and 20.</p>}
      <h4 className="mt-4 text-13 font-semibold text-slate-900">Related search terms</h4>
      {related.length ? <div className="mt-1 flex flex-wrap gap-1.5">{related.map(k => <span key={k.keyword} className="px-2.5 py-1 rounded-full text-12.5 bg-slate-50 border border-slate-200 text-slate-700">{k.keyword}{k.volume != null && <span className="ml-1 text-slate-400">{num(k.volume)}</span>}</span>)}</div> : <p className="text-13 text-slate-500">No other kept keyword of this competitor shares a word with this page's top keyword ({pg.top_keyword || '—'}).</p>}
      <div className="mt-4 rounded-lg bg-emerald-50 ring-1 ring-emerald-200 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2"><h4 className="text-13 font-semibold text-emerald-900">Content opportunities for your website</h4>
          <Button size="sm" variant="primary" icon={Plus} busy={busy} disabled={!opps.length} className="ml-auto" onClick={() => add(opps)}>Add {opps.length} to My Keywords</Button></div>
        {opps.length ? <p className="mt-1 text-12.5 text-emerald-900">This page ranks for {opps.length} keyword{opps.length === 1 ? '' : 's'} where your site does not show: {opps.slice(0, 5).map(k => k.keyword).join(', ')}{opps.length > 5 ? '…' : ''}. A page of yours on this topic could compete for them.</p> : <p className="mt-1 text-12.5 text-emerald-900">You already rank for every keyword listed above.</p>}
      </div>
      {toastNode}
    </Modal>
  );
}

export function TopPagesTab({ b, rows, focus = '' }) {
  const [all, setList] = useState(null);
  const [fh, setFh] = useState(focus);
  const [open, setOpen] = useState(null);
  const list = all && (fh ? all.filter(p => sameSite(p.domain, fh)) : all);
  const domains = rows.map(c => c.host).filter(Boolean);
  useEffect(() => { let on = true; api(`/businesses/${b.id}/keyword-workspace/competitor-analysis/pages`, { method: 'POST', body: { domains }, timeout: 120000 }).then(r => on && setList(r.pages || [])).catch(() => on && setList([])); return () => { on = false; }; }, [b.id, domains.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState('');
  const checkPages = async (force = false, quiet = false) => {
    setChecking(true);
    try {
      const r = await api(`/businesses/${b.id}/keyword-workspace/competitor-analysis/pages/check${force ? '?force=true' : ''}`, { method: 'POST', body: { domains }, timeout: 180000 });
      setList(r.pages || []);
      if (!quiet || r.gone) setNote(r.checked ? `${r.checked} page${r.checked === 1 ? '' : 's'} checked${r.gone ? `: ${r.gone} no longer exist${r.gone === 1 ? 's' : ''} and ${r.gone === 1 ? 'its' : 'their'} traffic is not counted` : ': all still exist'}${r.unreachable ? `, ${r.unreachable} could not be reached` : ''}.` : 'Every page was already checked today.');
    } catch { if (!quiet) setNote('The pages could not be checked just now.'); } finally { setChecking(false); }
  };
  const autoChecked = useRef('');
  useEffect(() => { // the first time the pages are shown, the ones never checked are checked once
    const key = domains.join('|');
    if (list && list.length && autoChecked.current !== key && list.some(p => p.live === undefined || (p.page_status == null))) { autoChecked.current = key; checkPages(false, true); }
  }, [list && list.length, domains.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!list) return <div className="flex items-center justify-center gap-2 py-14 text-13 text-slate-500"><Loader2 size={16} className="animate-spin" />Loading…</div>;
  const NA = <span className="text-slate-300">Not available</span>;
  const cols = [
    { id: 'url', header: 'Page URL', first: 'asc', value: p => p.url, className: 'px-3 py-2.5 max-w-[340px]', cell: p => <button type="button" onClick={() => setOpen(p)} title={`Open the details of ${p.url}`} className="text-left text-blue-700 hover:underline max-w-full truncate cursor-pointer block">{p.url.replace(/^https?:\/\/(www\.)?/, '')}</button> },
    { id: 'title', header: 'Page title', value: p => p.title || '', cell: p => p.title || NA, hide: true, tip: { what: 'The page title is not read by any data source connected here.' } },
    { id: 'domain', header: 'Competitor', value: p => p.domain },
    { id: 'live', header: 'Page', value: p => (p.live === false ? 'Gone' : p.live ? 'Live' : 'Not checked'), cell: p => (p.live === false ? <Badge tone="red" title={`The page answered ${p.page_status}: it no longer exists, so its traffic is not counted`}>Gone</Badge> : p.live ? <Badge tone="green" title="The page answers">Live</Badge> : <span className="text-slate-300" title={p.checked_at ? 'It could not be reached when asked' : 'Not checked yet'}>—</span>), tip: { what: 'Whether the page still exists, asked directly (a plain page request). A page that answers 404 or 410 is gone: its ranking is out of date and its traffic is not counted.' } },
    { id: 'read', header: 'Rankings read', value: p => p.read_at || '', cell: p => (p.read_at ? fdate(p.read_at) : '—'), hide: true, tip: { what: 'When the ranked keywords of this page were read from the data provider. Rankings change, and a page can disappear after that day.' } },
    { id: 'traffic', header: 'Est. organic traffic', right: true, first: 'desc', value: p => p.traffic, cell: p => (p.live === false ? <span title={`It was credited with about ${kfmt(p.traffic_was)} before the page was found gone`} className="text-slate-400">0 <span className="text-11 line-through">{kfmt(p.traffic_was)}</span></span> : kfmt(p.traffic)), tip: { what: 'Estimated visits a month to the page from the keywords it ranks for. An estimate, not verified traffic.', from: 'Ranked keywords (Apify)' } },
    { id: 'keywords', header: 'Ranking keywords', right: true, first: 'desc', value: p => p.keywords },
    { id: 'top', header: 'Top keyword', value: p => p.top_keyword || '', tip: { what: 'The most searched keyword the page ranks for.' } },
    { id: 'topkd', header: 'Top keyword KD', right: true, value: p => p.top_kd ?? null, cell: p => (p.top_kd == null ? <span className="text-slate-300" title="Not read yet. Open the page and use Read KD.">—</span> : p.top_kd), tip: { what: 'SEO difficulty (0 to 100) of its top keyword, from the real top 10 on Google. Read on demand (open the page, then Read KD) because each read costs Apify credit.' } },
    { id: 'toppos', header: 'Top keyword position', right: true, value: p => p.top_position ?? null, cell: p => (p.top_position ? `#${p.top_position}` : '—') },
    { id: 'best', header: 'Best position', right: true, value: p => p.best ?? null, cell: p => (p.best ? `#${p.best}` : '—'), hide: true },
    { id: 'backlinks', header: 'Backlinks', right: true, value: p => p.backlinks ?? null, cell: () => NA, tip: { what: 'Backlinks to a single page are not read by any data source connected here.' } },
    { id: 'act', header: 'Actions', csv: false, right: true, className: 'px-2 py-1.5 text-right whitespace-nowrap', cell: p => <span className="inline-flex"><button type="button" onClick={() => setOpen(p)} aria-label="Page details" title="Details and content opportunities" className="p-1.5 text-slate-500 hover:text-indigo-700 cursor-pointer"><Eye size={16} /></button><a href={p.url} target="_blank" rel="noreferrer" aria-label="Open the page" title="Open the page" className="p-1.5 text-slate-500 hover:text-indigo-700"><ExternalLink size={16} /></a></span> },
  ];
  const filters = [
    { id: 'domain', label: 'Competitor', options: [...new Set(list.map(p => p.domain))].map(d => [d, d]), test: (p, v) => p.domain === v },
    { id: 'best', label: 'Best position', options: BANDS.filter(x => x[0] !== 'none'), test: (p, v) => band(p.best) === v },
    { id: 'traffic', label: 'Traffic', options: [['100', '100+ a month'], ['1000', '1,000+ a month']], test: (p, v) => p.traffic >= Number(v) },
    { id: 'opp', label: 'Opportunity', options: [['yes', 'Has keywords you do not rank for']], test: (p, v) => (p.list || []).some(k => !k.yours) },
  ];
  return <><FocusBar name={fh} what="its best pages" onAll={() => setFh('')} />{note && <p className="mb-2 rounded-lg bg-slate-50 ring-1 ring-slate-200 px-3 py-2 text-13 text-slate-700">{note}</p>}<DataTable columnsKey="pages" key={fh} toolbar={<Button size="sm" icon={Eye} busy={checking} onClick={() => checkPages(true)} title="Asks each page whether it still exists. Pages that are gone stop counting toward traffic.">Check pages are live</Button>} columns={cols} rows={list} rowKey={p => `${p.domain}|${p.url}`} filters={filters} collapseFilters initialSort={{ key: 'traffic', dir: 'desc' }} exportName="competitor-top-pages" searchPlaceholder="Search pages or keywords" label="pages" empty="No pages yet. Analyze a competitor on the Competitors tab: the pages its keywords rank with appear here." />
    {open && <PageDrawer b={b} pg={open} all={all} onClose={() => setOpen(null)} />}</>;
}

export { hostOf };
