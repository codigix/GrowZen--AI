# HTML website publishing (server setup)

The **HTML Website** destination has four settings in the app: Website Name, Website URL, Blog Listing HTML File and
Blog Articles Folder. Everything else is detected from the website or configured here, on the server.

## 1. How the site keeps its articles (detected, nothing to configure)

| The site… | GrowZen detects | One publish writes |
|---|---|---|
| shows articles with JavaScript from a list in a script file, with addresses like `blog.html?post=<slug>` (e.g. sachspune.com: `js/data.js` → `blog: [ … ]`) | the script file, the list, its fields and formats, the page and the URL parameter (read from the site's own scripts) | the script file with **one new entry at the top** (same fields and formats as the existing articles; existing articles unchanged), the featured image, and the listing page with only its `data.js?v=` number raised so visitors get the new list |
| has one page per article (`/blog/<slug>/` or `/blog/<slug>.html`) | the folder style from the listing's links | the article page built from one of the site's own article pages (same header, footer, CSS), its image, and the listing with a copy of an existing card |

Publishing the same article again updates GrowZen's own entry/page. An article or page GrowZen did not make is never
overwritten (the new one gets `-2`, `-3`, …). No other file of the site is touched.

## 2. How files reach the site (server-side configuration)

`backend/html_deploy.json` (git-ignored; another path: `HTML_DEPLOY_CONFIG` in `.env`), one entry per website host
(without `www.`). Secrets can be written directly or read from the environment with a `_env` suffix. Credentials are
never sent to the browser. Without an entry the website uses **manual export** (Download files → upload yourself).

```json
{
  "sachspune.com": {
    "adapter": "ftp",
    "host": "ftp.sachspune.com",
    "tls": true,
    "user": "growzen@sachspune.com",
    "password_env": "SACHSPUNE_FTP_PASSWORD",
    "root": "public_html"
  },
  "example-site.netlify.app": { "adapter": "github", "repo": "owner/website", "branch": "main", "token_env": "GROWZEN_GITHUB_TOKEN" },
  "drop-site.netlify.app":    { "adapter": "netlify", "token_env": "GROWZEN_NETLIFY_TOKEN" },
  "blog.example.org":         { "adapter": "gitlab", "project": "group/website", "token_env": "GROWZEN_GITLAB_TOKEN" },
  "static.example.net":       { "adapter": "sftp", "host": "ssh.example.net", "user": "deploy", "key_file": "C:/keys/deploy_rsa", "root": "var/www/html" }
}
```

| Adapter | Use when | Credentials |
|---|---|---|
| `ftp` (`tls: true` = FTPS) | cPanel / classic hosting (GoDaddy, Hostinger, …) | an FTP account limited to the site folder |
| `sftp` | SSH hosting (needs `pip install paramiko`) | password or key file |
| `github` / `gitlab` | the site is built from a repository (Netlify, Vercel, Cloudflare Pages, GitHub Pages rebuild on each commit) | a token that can write the repository |
| `netlify` | deployed straight to Netlify (drag-and-drop/CLI) | Netlify personal access token |

`root` is the folder served as the website (`public_html`, `dist`, …). Git and Netlify adapters find it themselves; for
FTP/SFTP GrowZen tries `/`, `public_html`, `www`, `htdocs`, `httpdocs`, `html`, `web` when it is not set.

### In the app: Deployment settings (SFTP / FTPS)

The HTML Website card has a separate **Deployment settings** form (not part of the four connection fields). Host, port,
username and password or SSH private key are encrypted at rest (`crypto.seal`), never returned to the page and never
written to the deployment log. Settings saved in the app win over `backend/html_deploy.json`.

1. **Save settings** → 2. **Test connection** (signs in, pins the server's SSH host key, finds the website folder such as
`public_html`; writes nothing) → 3. **Run test deployment** (uploads the check file and confirms the live site serves it).
Only then are *Publish now* and *Schedule* available. Changing the settings requires steps 2–3 again.

Before a publish replaces a file, GrowZen keeps the old version under `backend/uploads/html_backups/<business>/<time>/`.
Each SFTP file is uploaded under a temporary name and renamed, so visitors never see a half-written file.

### sachspune.com (GoDaddy cPanel)
1. cPanel → **SSH Access** must be enabled for the account (GoDaddy: Hosting → Settings → SSH). SFTP uses the cPanel
   username and password (or an SSH key from cPanel → SSH Access → Manage SSH Keys), host `sachspune.com`, port 22.
2. GrowZen → HTML Website → **Deployment settings** → Method SFTP, Host, Username, Password (or key) → **Save settings**.
3. **Test connection** → the folder `public_html` is detected → **Run test deployment** → **Publish now** or **Schedule**.

## 3. Test deployment

*Run test deployment* uploads `.well-known/growzen-deploy-check.txt` and waits until the live website serves it. Only
then is publishing shown as connected. Changing the server entry for the site requires a new test.
