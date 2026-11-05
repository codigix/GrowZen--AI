import re
from urllib.parse import unquote, urlsplit


class RobotsRules:
    """robots.txt evaluation per RFC 9309: the most specific (longest) matching rule wins, Allow wins ties.

    Python's urllib.robotparser applies the first matching rule in file order, which wrongly allows
    pages for files like "Allow: /" followed by "Disallow: /private".
    """

    def __init__(self, rules: list[tuple[bool, str]] | None = None, crawl_delay: float | None = None,
                 disallow_all: bool = False):
        self.disallow_all = disallow_all
        self.crawl_delay = crawl_delay
        self._rules = [(allow, self._compile(pattern), len(pattern)) for allow, pattern in (rules or [])]

    @staticmethod
    def _compile(pattern: str) -> re.Pattern:
        end = pattern.endswith("$")
        body = pattern[:-1] if end else pattern
        regex = ".*".join(re.escape(part) for part in unquote(body).split("*"))
        return re.compile(regex + ("$" if end else ""))

    @classmethod
    def parse(cls, text: str, user_agent: str) -> "RobotsRules":
        token = user_agent.split("/")[0].split()[0].lower() if user_agent.strip() else ""
        groups: list[tuple[list[str], list[tuple[bool, str]], list[float]]] = []
        agents: list[str] = []
        in_rules = False
        for raw in text.splitlines():
            line = raw.split("#", 1)[0].strip()
            if ":" not in line:
                continue
            field, value = (p.strip() for p in line.split(":", 1))
            field = field.lower()
            if field == "user-agent":
                if in_rules:
                    agents, in_rules = [], False
                agents.append(value.lower())
                if not groups or groups[-1][0] is not agents:
                    groups.append((agents, [], []))
            elif field in ("allow", "disallow") and groups:
                in_rules = True
                if value:  # an empty Disallow allows everything
                    groups[-1][1].append((field == "allow", value))
            elif field == "crawl-delay" and groups:
                in_rules = True
                try:
                    groups[-1][2].append(float(value))
                except ValueError:
                    pass
        specific = [g for g in groups if any(a != "*" and token.startswith(a) for a in g[0])]
        chosen = specific or [g for g in groups if "*" in g[0]]
        rules = [r for g in chosen for r in g[1]]
        delays = [d for g in chosen for d in g[2]]
        return cls(rules, max(delays) if delays else None)

    @classmethod
    def allow_all(cls) -> "RobotsRules":
        return cls()

    @classmethod
    def block_all(cls) -> "RobotsRules":
        return cls(disallow_all=True)

    def can_fetch(self, url: str) -> bool:
        if self.disallow_all:
            return False
        parts = urlsplit(url)
        path = unquote(parts.path or "/") + (f"?{parts.query}" if parts.query else "")
        best_len, allowed = -1, True
        for allow, regex, length in self._rules:
            if regex.match(path) and (length > best_len or (length == best_len and allow)):
                best_len, allowed = length, allow
        return allowed
