"""robots.txt per RFC 9309: longest-match rule precedence (Allow wins ties), `*` and `$` wildcards, group selection by the
most specific matching user-agent token, and the status-code semantics (4xx = no rules, 5xx/unreachable = assume disallow)."""
import re
from dataclasses import dataclass, field
from urllib.parse import urlsplit

CRAWLER_TOKEN = "codigixbacklinkbot"
USER_AGENT = "CodigixBacklinkBot/1.0 (+https://codigixinfotech.com/bot)"
MAX_ROBOTS_BYTES = 500 * 1024  # RFC 9309 2.5: parse at least 500 KiB


@dataclass
class RobotsRules:
    groups: list[tuple[list[str], list[tuple[bool, str]]]] = field(default_factory=list)  # ([agents], [(allow, pattern)])
    sitemaps: list[str] = field(default_factory=list)
    crawl_delay: dict[str, float] = field(default_factory=dict)
    disallow_all: bool = False  # server error / unreachable: RFC says treat as complete disallow

    def _rules_for(self, agent: str) -> list[tuple[bool, str]]:
        agent = agent.lower()
        best_len, rules = -1, []
        for agents, grp in self.groups:
            for a in agents:
                if a == "*":
                    score = 0
                elif a and a in agent:
                    score = len(a)
                else:
                    continue
                if score > best_len:
                    best_len, rules = score, list(grp)
                elif score == best_len:
                    rules += grp  # multiple groups for the same agent are merged
        return rules

    def allowed(self, url: str, agent: str = CRAWLER_TOKEN) -> bool:
        if self.disallow_all:
            return False
        p = urlsplit(url)
        path = (p.path or "/") + (f"?{p.query}" if p.query else "")
        if path == "/robots.txt":
            return True
        best_len, verdict = -1, True
        for allow, pattern in self._rules_for(agent):
            if not pattern:  # empty Disallow = allow all; empty Allow is ignored
                continue
            if _matches(pattern, path):
                n = len(pattern)
                if n > best_len or (n == best_len and allow):
                    best_len, verdict = n, allow
        return verdict

    def delay(self, agent: str = CRAWLER_TOKEN) -> float | None:
        agent = agent.lower()
        specific = [d for a, d in self.crawl_delay.items() if a != "*" and a in agent]
        return max(specific) if specific else self.crawl_delay.get("*")


def _matches(pattern: str, path: str) -> bool:
    anchored = pattern.endswith("$")
    body = pattern[:-1] if anchored else pattern
    rx = "".join(".*" if ch == "*" else re.escape(ch) for ch in body)
    return re.match(rx + ("$" if anchored else ""), path) is not None


def parse(text: str) -> RobotsRules:
    rules = RobotsRules()
    agents: list[str] = []
    grp: list[tuple[bool, str]] = []
    in_rules = False
    for raw in (text or "")[:MAX_ROBOTS_BYTES].splitlines():
        line = raw.split("#", 1)[0].strip()
        if ":" not in line:
            continue
        key, _, val = line.partition(":")
        key, val = key.strip().lower(), val.strip()
        if key == "user-agent":
            if in_rules:
                rules.groups.append((agents, grp))
                agents, grp, in_rules = [], [], False
            agents.append(val.lower())
        elif key in ("allow", "disallow"):
            in_rules = True
            grp.append((key == "allow", val))
        elif key == "sitemap":
            rules.sitemaps.append(val)
        elif key == "crawl-delay":
            try:
                for a in agents:
                    rules.crawl_delay[a] = float(val)
            except ValueError:
                pass
    if agents:
        rules.groups.append((agents, grp))
    return rules


def from_response(status: int | None, body: str | None) -> tuple[RobotsRules, str]:
    """RFC 9309 2.3.1: 2xx parse; 4xx = no restrictions; 5xx or no response = disallow all. Returns (rules, status label)."""
    if status is None:
        return RobotsRules(disallow_all=True), "unreachable"
    if 200 <= status < 300:
        return parse(body or ""), "ok"
    if 400 <= status < 500:
        return RobotsRules(), "missing"
    return RobotsRules(disallow_all=True), "unreachable"
