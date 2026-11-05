# Fortress (Ahrefs backlink lookup)

`ahrefs_backlinks.py` reads the Ahrefs free Backlink Checker through Fortress, a Chromium build that gets past Ahrefs' Cloudflare check.
The backend runs it for `POST /backlinks/ahrefs` and the daily refresh (see `backend/app/backlink_service/ahrefs.py`).

The browser (about 250 MB) and `.venv/` are not in git. **You don't need to do anything after pulling:** before the first lookup, the backend runs
`setup_fortress.py`, which builds `.venv/` with Playwright and downloads the official Fortress build for your OS from
[GitHub releases](https://github.com/tiliondev/fortress/releases), checking its SHA-256. The first lookup on a machine takes a few minutes longer.

To set it up ahead of time, or if the automatic setup is off (`AHREFS_AUTO_SETUP=0`), run from the repo root:

```
python fortress-repo/setup_fortress.py
```

Supported: Windows x64, Linux x64, macOS Apple Silicon. Needs Python 3.10+ and internet access to github.com and pypi.org.

On Windows, the first launch of a new, unrecognized `.exe` that uses the network normally pops up a "allow this app through the
firewall" dialog — fine on your own laptop, but nobody is there to click it on a server. If `setup_fortress.py` runs as
Administrator, it pre-approves the exact Fortress binary with a Windows Firewall rule so that popup never appears; run it as
Administrator once (`python fortress-repo/setup_fortress.py`) on a server before anything else uses it. Linux and macOS have no
such prompt, so this only matters on Windows.

Test one lookup by hand: `fortress-repo/.venv/Scripts/python fortress-repo/ahrefs_backlinks.py codigix.co` (Linux/macOS: `.venv/bin/python`).

Production use by organizations above Fortress' free limits needs a Tilion subscription; see `LICENSE` and `SUBSCRIPTION-TERMS.md`.
