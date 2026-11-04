import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Loader2, Globe, FileCode2, FolderOpen, Settings2, Unplug, RefreshCw, Link2, Info, Rocket, Send, Download, ExternalLink, Server, KeyRound, Plug, ScrollText, CalendarDays, Save, Trash2 } from 'lucide-react';
import { Badge, Button, Field, inputCls, areaCls, useDoubleConfirm } from './SeoUi';
import { api, fmtDateTime, usePoll } from './seoApi';
import { ScheduleModal, scheduleText } from './ArticleScheduling';

const emptyDeploy = { adapter: 'sftp', host: '', port: '', username: '', auth: 'password', password: '', private_key: '', key_passphrase: '', root: '', tls: true };
const fromDeploy = (d) => (d ? { ...emptyDeploy, adapter: d.adapter || 'sftp', host: d.host || '', port: d.port ? String(d.port) : '', username: d.username || '',
  auth: d.auth || 'password', root: d.root || '', tls: d.tls !== false } : emptyDeploy);

const empty = (b) => ({ website_name: b.name || '', website_url: (b.website || '').replace(/\/$/, ''), listing_file: 'blog.html', articles_folder: 'blog' });
const fromConn = (c, b) => (c && c.website_url ? { website_name: c.website_name || '', website_url: c.website_url, listing_file: c.listing_file, articles_folder: c.articles_folder } : empty(b));

// one article on the HTML website (server: GET /html-site/articles/{id})
const POST = {
  draft: ['Draft', 'gray'], publishing: ['Publishing', 'blue'], uploading: ['Uploading files', 'blue'], deploying: ['Deployment in progress', 'amber'],
  published: ['Published', 'green'], failed: ['Failed', 'red'], exported: ['Exported for manual upload', 'gray']
};
const PUBLISHING = {
  connected: ['Publishing connected', 'green'], test_needed: ['Test deployment needed', 'amber'], testing: ['Test deployment running…', 'blue'],
  manual: ['Deployment not set up', 'gray'], not_configured: ['Not set up', 'gray']
};
const RUNNING = ['publishing', 'uploading', 'deploying'];

function Steps({ steps }) {
  if (!steps?.length) return null;
  return (
    <ul className="rounded-xl border border-slate-200 divide-y divide-slate-100 bg-white">
      {steps.map((s, i) => (
        <li key={i} className="px-3 py-2 flex items-start gap-2 text-[12px]">
          {!s.ok ? <XCircle size={14} className="text-rose-600 shrink-0 mt-0.5" /> : s.warning ? <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" /> : <CheckCircle2 size={14} className="text-emerald-600 shrink-0 mt-0.5" />}
          <span><b className="text-slate-800">{s.step}</b><span className="block text-slate-500 break-all">{s.detail}</span></span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Publishing destination: a website made of plain HTML files, on any host. Four settings only. How the site keeps its
 * articles (a list in a script file with ?post= addresses, or one page per article) is detected; how files reach the
 * server is configured on the server and shown here without credentials. Publishing is connected only after a real
 * test deployment succeeded.
 */
export default function HtmlSitePanel({ b, article, toast, onConnection }) {
  const [conn, setConnState] = useState(null);
  const setConn = (c) => { setConnState(c); onConnection?.(c); };
  const [form, setForm] = useState(() => empty(b));
  const [editing, setEditing] = useState(false);
  const [steps, setSteps] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [ask, confirmNode] = useDoubleConfirm();
  const bizRef = useRef(b.id);
  bizRef.current = b.id;

  const load = () => {
    const forBiz = b.id;
    return api(`/businesses/${forBiz}/html-site`).then(c => {
      if (bizRef.current !== forBiz) return;  // account switched meanwhile
      setConn(c); setForm(fromConn(c, b)); setEditing(c.status !== 'connected'); setSteps(c.checks || []);
    }).catch(e => { if (bizRef.current === forBiz) setError(e.message); });
  };
  useEffect(() => { setConn(null); setForm(empty(b)); setSteps([]); setError(''); load(); }, [b.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const ready = form.website_name.trim() && form.website_url.trim() && form.listing_file.trim() && form.articles_folder.trim();
  const save = () => {
    setBusy('save'); setError(''); setSteps([]);
    api(`/businesses/${b.id}/html-site`, { method: 'PUT', body: form })
      .then(r => {
        setSteps(r.steps); setConn(r.connection); setForm(fromConn(r.connection, b));
        if (r.ok) { setEditing(false); toast?.('HTML website connected.'); } else toast?.('Saved, but a check failed: see the steps.');
      })
      .catch(e => setError(e.message)).finally(() => setBusy(''));
  };
  const recheck = () => {
    setBusy('check'); setError('');
    api(`/businesses/${b.id}/html-site/check`, { method: 'POST' })
      .then(r => { setSteps(r.steps); setConn(r.connection); toast?.(r.ok ? 'The HTML website checks passed.' : 'A check failed: see the steps.'); })
      .catch(e => setError(e.message)).finally(() => setBusy(''));
  };
  const disconnect = () => ask({
    what: 'the HTML website connection', effect: 'Its four settings are removed from GrowZen. Nothing on your website changes.',
    onConfirm: () => api(`/businesses/${b.id}/html-site`, { method: 'DELETE' }).then(() => { setSteps([]); load(); toast?.('HTML website disconnected.'); }).catch(e => toast?.(e.message))
  });

  const connected = conn?.status === 'connected';
  const failed = conn?.status === 'failed';
  const dep = conn?.deployment;
  const pubState = conn?.publishing || 'not_configured';
  const dataMode = conn?.article_mode === 'data';

  // test deployment (runs on the server; this only shows its progress)
  const testDeploy = () => {
    setBusy('test'); setError('');
    api(`/businesses/${b.id}/html-site/test-deploy`, { method: 'POST' })
      .then(c => { setConn(c); toast?.('Test deployment started: GrowZen uploads a small check file and waits for your website to show it.'); })
      .catch(e => setError(e.message)).finally(() => setBusy(''));
  };
  usePoll(() => api(`/businesses/${b.id}/html-site`).then(c => { if (bizRef.current === b.id) { setConn(c); setSteps(c.checks || []); } }).catch(() => { }), pubState === 'testing', 5000);

  // this article on the HTML website
  const [post, setPost] = useState(null);
  const loadPost = () => article && api(`/businesses/${b.id}/html-site/articles/${article.id}`).then(p => { if (bizRef.current === b.id) setPost(p); }).catch(() => { });
  useEffect(() => { setPost(null); if (connected) loadPost(); }, [article?.id, connected]); // eslint-disable-line react-hooks/exhaustive-deps
  usePoll(loadPost, Boolean(post && RUNNING.includes(post.status)), 4000);
  const publish = () => {
    setBusy('publish'); setError('');
    api(`/businesses/${b.id}/html-site/articles/${article.id}/publish`, { method: 'POST' })
      .then(() => { setPost(p => ({ ...(p || {}), status: 'publishing', detail: 'Preparing the article' })); toast?.('Publishing started.'); })
      .catch(e => setError(e.message)).finally(() => setBusy(''));
  };
  // deployment settings (kept apart from the four connection fields; secrets are never shown again)
  const saved = dep?.settings;
  const [dform, setDform] = useState(emptyDeploy);
  const [editDeploy, setEditDeploy] = useState(false);
  const [connSteps, setConnSteps] = useState([]);
  useEffect(() => { setDform(fromDeploy(saved)); }, [saved?.host, saved?.username, saved?.adapter, saved?.root, saved?.port]); // eslint-disable-line react-hooks/exhaustive-deps
  const setD = (k) => (e) => setDform(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const saveDeploy = () => {
    setBusy('dsave'); setError(''); setConnSteps([]);
    const body = { adapter: dform.adapter, host: dform.host.trim(), port: dform.port ? Number(dform.port) : null, username: dform.username.trim(),
      auth: dform.adapter === 'sftp' ? dform.auth : 'password', password: dform.password || null, private_key: dform.private_key || null,
      key_passphrase: dform.key_passphrase || null, root: dform.root.trim() || null, tls: dform.tls };
    api(`/businesses/${b.id}/html-site/deployment`, { method: 'PUT', body })
      .then(c => { setConn(c); setEditDeploy(false); setDform(f => ({ ...f, password: '', private_key: '', key_passphrase: '' })); toast?.('Deployment settings saved (encrypted). Next: Test connection.'); })
      .catch(e => setError(e.message)).finally(() => setBusy(''));
  };
  const testConnection = () => {
    setBusy('dtest'); setError(''); setConnSteps([]);
    api(`/businesses/${b.id}/html-site/deployment/test-connection`, { method: 'POST' })
      .then(r => {
        setConnSteps(r.steps); setConn(r.connection);
        toast?.(r.ok ? 'Connection works. Next: Run test deployment.' : 'The connection failed: see the steps.');
        if (r.ok) api(`/businesses/${b.id}/html-site/check`, { method: 'POST' }).then(x => { setSteps(x.steps); setConn(x.connection); }).catch(() => { });  // refresh the six checks
      })
      .catch(e => setError(e.message)).finally(() => setBusy(''));
  };
  const removeDeploy = () => ask({
    what: 'the deployment settings', effect: 'GrowZen forgets the server address and credentials and stops publishing to this website. Nothing on the website changes.',
    onConfirm: () => api(`/businesses/${b.id}/html-site/deployment`, { method: 'DELETE' }).then(() => { setConnSteps([]); load(); toast?.('Deployment settings removed.'); }).catch(e => toast?.(e.message))
  });
  const [mode, setMode] = useState('publish');
  const [scheduling, setScheduling] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const htmlSchedule = article?.schedule && article.schedule.destination === 'html' && ['scheduled', 'publishing', 'failed'].includes(article.publishing_status) ? article.schedule : null;
  const rootIsFile = /\.(html?|php|js|css|json|txt|xml)$/i.test(dform.root.trim());  // e.g. "blog.html": a file, not the website folder

  // fallback: the files a publish would write, as a ZIP to upload by hand
  const download = async () => {
    setBusy('export'); setError('');
    try {
      const r = await api(`/businesses/${b.id}/html-site/articles/${article.id}/export`, { raw: true });
      const blob = await r.blob();
      const name = (r.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'article-html.zip';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast?.('Files downloaded. Upload them to your website folder, keeping the same folders.');
      loadPost();
    } catch (e) { setError(e.message || String(e)); } finally { setBusy(''); }
  };


  return (
    <section className="space-y-3 text-[12.5px]">
      {confirmNode}
      <div className="flex items-center gap-2 text-[12.5px] font-bold text-slate-800">
        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] ${connected ? 'bg-emerald-500 text-white' : 'bg-indigo-600 text-white'}`}>{connected ? <CheckCircle2 size={14} /> : 1}</span>
        {editing || !connected ? 'Connect HTML Website' : 'HTML Website Connection'}
      </div>

      {conn === null && !error && <div className="flex items-center gap-2 text-slate-500"><Loader2 size={13} className="animate-spin" /> Loading…</div>}

      {/* connected summary */}
      {conn && (connected || failed) && !editing && (
        <div className={`p-3 rounded-xl border space-y-2 ${connected ? 'bg-emerald-50/60 border-emerald-200' : 'bg-rose-50/60 border-rose-200'}`}>
          <div className="flex flex-wrap items-center gap-2">
            <FileCode2 size={14} className="text-slate-500" />
            <span className="font-semibold text-slate-900">{conn.website_name}</span>
            <Badge tone={connected ? 'green' : 'red'}>{connected ? 'Connected' : 'Check failed'}</Badge>
            <a href={conn.website_url} target="_blank" rel="noreferrer" className="font-mono text-[11.5px] text-indigo-700 hover:underline">{conn.website_url.replace(/^https?:\/\//, '')}</a>
            <span className="ml-auto flex flex-wrap gap-2">
              <Button size="sm" icon={RefreshCw} busy={busy === 'check'} onClick={recheck}>Check again</Button>
              <Button size="sm" icon={Settings2} onClick={() => { setEditing(true); setForm(fromConn(conn, b)); }}>Edit settings</Button>
              <Button size="sm" icon={Unplug} onClick={disconnect}>Disconnect</Button>
            </span>
          </div>
          <dl className="grid grid-cols-1 sm:grid-cols-[150px_1fr] gap-x-3 gap-y-1 text-[12px]">
            <dt className="text-slate-500">Blog listing page</dt>
            <dd><a href={conn.listing_url} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline break-all inline-flex items-center gap-1">{conn.listing_url} <Link2 size={10} /></a>{conn.listing_title ? <span className="text-slate-500"> · “{conn.listing_title}”</span> : null}</dd>
            <dt className="text-slate-500">Articles are stored</dt>
            <dd className="text-slate-800">{dataMode
              ? <>in <span className="font-mono text-[11.5px]">{conn.article_store}</span> <span className="text-slate-500">· {conn.article_count} article{conn.article_count === 1 ? '' : 's'} · shown by the site's own script</span></>
              : <>as pages in /{conn.articles_folder}/ {conn.article_count != null && <span className="text-slate-500">· {conn.article_count} found on the listing page</span>}</>}</dd>
            <dt className="text-slate-500">Article address</dt>
            <dd className="font-mono text-[11.5px] text-slate-700 break-all">{conn.article_url_pattern}</dd>
            {conn.checked_at && <><dt className="text-slate-500">Last checked</dt><dd className="text-slate-800">{fmtDateTime(conn.checked_at)}</dd></>}
          </dl>
          {failed && conn.last_error && <p className="text-rose-700">{conn.last_error}</p>}
        </div>
      )}

      {/* the form: exactly four fields */}
      {conn && (editing || !connected) && (
        <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Website name"><input className={inputCls} value={form.website_name} onChange={set('website_name')} placeholder="Acme Clinic" /></Field>
            <Field label="Website URL" hint="The site's address, without a page path"><input className={inputCls} value={form.website_url} onChange={set('website_url')} placeholder="https://example.com" /></Field>
            <Field label="Blog listing HTML file" hint="The page that lists your blog posts, e.g. blog.html or blog/index.html"><input className={inputCls} value={form.listing_file} onChange={set('listing_file')} placeholder="blog.html" /></Field>
            <Field label="Blog articles folder" hint="Where each article's HTML file lives, e.g. blog or blog/posts"><input className={inputCls} value={form.articles_folder} onChange={set('articles_folder')} placeholder="blog" /></Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" icon={Globe} busy={busy === 'save'} disabled={!ready} onClick={save}>Connect HTML Website</Button>
            {connected && <Button onClick={() => { setEditing(false); setForm(fromConn(conn, b)); }}>Cancel</Button>}
          </div>
        </div>
      )}

      {busy === 'save' && <div className="flex items-center gap-2 text-slate-500"><Loader2 size={13} className="animate-spin" /> Checking the website…</div>}
      {busy !== 'save' && <Steps steps={steps} />}
      {error && <p className="text-rose-700">{error}</p>}

      {/* deployment: chosen on the server for this website; credentials never come to the page */}
      {connected && dep && (
        <div className="p-3 rounded-xl border border-slate-200 bg-white space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Server size={14} className="text-slate-500" />
            <span className="font-semibold text-slate-900">Deployment</span>
            <Badge tone={(PUBLISHING[pubState] || PUBLISHING.not_configured)[1]}>{pubState === 'testing' && <Loader2 size={11} className="animate-spin" />}{(PUBLISHING[pubState] || PUBLISHING.not_configured)[0]}</Badge>
            <span className="text-[12px] text-slate-600">{dep.label}{dep.target ? ` · ${dep.target}` : ''}</span>
            {dep.configured && (
              <span className="ml-auto"><Button size="sm" icon={Rocket} busy={busy === 'test' || pubState === 'testing'} onClick={testDeploy}>
                {pubState === 'connected' ? 'Test again' : 'Run test deployment'}</Button></span>
            )}
          </div>
          {dep.error && <p className="text-rose-700 text-[12px]">{dep.error}</p>}
          {dep.test?.detail && <p className={`text-[12px] ${dep.test.status === 'ok' ? 'text-emerald-700' : dep.test.status === 'failed' ? 'text-rose-700' : 'text-slate-600'}`}>
            {dep.test.status === 'ok' ? '✓ ' : dep.test.status === 'failed' ? '✕ ' : ''}{dep.test.detail}{dep.test.at ? ` (${fmtDateTime(dep.test.at)})` : ''}</p>}
          {!dep.configured && !dep.error && !editDeploy && (
            <p className="flex items-start gap-1.5 text-[12px] text-slate-600"><Info size={13} className="shrink-0 mt-0.5" />
              <span>No deployment is set up yet. Add the website&apos;s SFTP access (e.g. GoDaddy cPanel) in <b>Deployment settings</b>;
                after Test connection and a successful test deployment, one-click publishing is on.</span></p>
          )}
          {dep.configured && pubState !== 'connected' && pubState !== 'testing' && (
            <p className="text-[12px] text-amber-800">Publishing stays off until a test deployment succeeds: GrowZen uploads a small check file and confirms your live website serves it.</p>
          )}

          {/* saved settings (no secrets) */}
          {saved && !editDeploy && (
            <dl className="grid grid-cols-1 sm:grid-cols-[150px_1fr] gap-x-3 gap-y-1 text-[12px] pt-1 border-t border-slate-100">
              <dt className="text-slate-500">Server</dt><dd className="font-mono text-[11.5px] text-slate-800">{saved.adapter.toUpperCase()}{saved.adapter === 'ftp' && saved.tls ? 'S' : ''} · {saved.username}@{saved.host}:{saved.port}</dd>
              <dt className="text-slate-500">Sign-in</dt><dd className="text-slate-800">{saved.auth === 'key' ? 'Private key' : 'Password'} <span className="text-slate-500">(saved encrypted)</span></dd>
              <dt className="text-slate-500">Website folder</dt><dd className="font-mono text-[11.5px] text-slate-800">{saved.root ? `/${saved.root.replace(/^\/+/, '')}` : <span className="font-sans text-slate-500">detected on Test connection</span>}</dd>
              <dt className="text-slate-500">Blog listing file</dt><dd className="font-mono text-[11.5px] text-slate-800">{saved.root ? `/${saved.root.replace(/^\/+/, '')}/` : '…/'}{conn.listing_file}</dd>
              {saved.host_key && <><dt className="text-slate-500">Server identity</dt><dd className="font-mono text-[11px] text-slate-600 break-all">{saved.host_key}</dd></>}
              {saved.connection_test && <><dt className="text-slate-500">Last connection test</dt><dd className={saved.connection_test.ok ? 'text-emerald-700' : 'text-rose-700'}>{saved.connection_test.ok ? '✓ ' : '✕ '}{saved.connection_test.detail} ({fmtDateTime(saved.connection_test.at)})</dd></>}
            </dl>
          )}
          <div className="flex flex-wrap gap-2">
            {!editDeploy && dep.source !== 'server' && <Button size="sm" icon={Settings2} onClick={() => { setEditDeploy(true); setDform(fromDeploy(saved)); }}>{saved ? 'Edit deployment settings' : 'Deployment settings'}</Button>}
            {saved && !editDeploy && <Button size="sm" icon={Plug} busy={busy === 'dtest'} onClick={testConnection}>Test connection</Button>}
            {saved && !editDeploy && <Button size="sm" variant="ghost" icon={Trash2} onClick={removeDeploy}>Remove</Button>}
            {dep.source === 'server' && <span className="text-[11.5px] text-slate-500">Configured on the server (backend/html_deploy.json).</span>}
          </div>
          {connSteps.length > 0 && <Steps steps={connSteps} />}

          {/* the settings form: separate from the four connection fields */}
          {editDeploy && (
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-slate-800"><KeyRound size={13} /> Deployment settings <span className="font-normal text-slate-500">· stored encrypted on the server, never shown again</span></div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label="Method">
                  <select className={inputCls} value={dform.adapter} onChange={setD('adapter')}>
                    <option value="sftp">SFTP (SSH) · recommended for GoDaddy cPanel</option>
                    <option value="ftp">FTP / FTPS</option>
                  </select>
                </Field>
                <Field label="Host" hint="e.g. sachspune.com or the server name from cPanel"><input className={inputCls} value={dform.host} onChange={setD('host')} placeholder="sachspune.com" /></Field>
                <Field label="Port" hint={dform.adapter === 'sftp' ? 'Empty = 22' : 'Empty = 21'}><input className={inputCls} value={dform.port} onChange={setD('port')} placeholder={dform.adapter === 'sftp' ? '22' : '21'} inputMode="numeric" /></Field>
                <Field label="Username" hint="Your cPanel / SSH user"><input className={inputCls} value={dform.username} onChange={setD('username')} autoComplete="off" /></Field>
                {dform.adapter === 'sftp' && (
                  <Field label="Sign in with">
                    <select className={inputCls} value={dform.auth} onChange={setD('auth')}>
                      <option value="password">Password</option>
                      <option value="key">SSH private key</option>
                    </select>
                  </Field>
                )}
                {dform.auth === 'password' || dform.adapter === 'ftp' ? (
                  <Field label="Password" hint={saved?.has_password ? 'Saved. Leave empty to keep it.' : 'Stored encrypted'}>
                    <input type="password" className={inputCls} value={dform.password} onChange={setD('password')} autoComplete="new-password" placeholder={saved?.has_password ? '•••••••• (saved)' : ''} />
                  </Field>
                ) : (
                  <Field label="Key passphrase" hint="Only if the key has one"><input type="password" className={inputCls} value={dform.key_passphrase} onChange={setD('key_passphrase')} autoComplete="new-password" /></Field>
                )}
                {dform.adapter === 'ftp' && (
                  <label className="flex items-center gap-2 text-[12px] text-slate-700 md:mt-6"><input type="checkbox" checked={dform.tls} onChange={setD('tls')} /> Encrypted (FTPS)</label>
                )}
              </div>
              {dform.adapter === 'sftp' && dform.auth === 'key' && (
                <Field label="SSH private key" hint={saved?.has_key ? 'Saved. Leave empty to keep it.' : 'Paste the whole key, including the BEGIN/END lines (cPanel → SSH Access → Manage keys)'}>
                  <textarea rows={4} className={`${areaCls} font-mono text-[11px]`} value={dform.private_key} onChange={setD('private_key')} placeholder={saved?.has_key ? '(saved)' : '-----BEGIN OPENSSH PRIVATE KEY-----'} />
                </Field>
              )}
              <Field label="Website folder on the server (optional)"
                hint={`The server folder that contains ${conn?.listing_file || 'blog.html'}, e.g. public_html. Not the file itself. Empty = detected on Test connection.`}>
                <input className={`${inputCls} ${rootIsFile ? '!border-rose-400' : ''}`} value={dform.root} onChange={setD('root')} placeholder="public_html" />
              </Field>
              {rootIsFile && <p className="-mt-2 text-[11.5px] text-rose-700">“{dform.root.trim()}” is a file name. Enter the folder that contains it (e.g. public_html), or leave this empty.</p>}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="primary" icon={Save} busy={busy === 'dsave'} disabled={!dform.host.trim() || !dform.username.trim() || rootIsFile} onClick={saveDeploy}>Save settings</Button>
                <Button size="sm" onClick={() => { setEditDeploy(false); setDform(fromDeploy(saved)); }}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* this article */}
      {connected && article && (
        <div className="p-3 rounded-xl border border-slate-200 bg-white space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <FileCode2 size={14} className="text-slate-500" />
            <span className="font-semibold text-slate-900">Publish this article</span>
            {post && <Badge tone={(POST[post.status] || POST.draft)[1]}>{RUNNING.includes(post.status) && <Loader2 size={11} className="animate-spin" />}{(POST[post.status] || POST.draft)[0]}</Badge>}
            {htmlSchedule && <Badge tone="amber"><CalendarDays size={11} /> Scheduled · {scheduleText(htmlSchedule)}</Badge>}
            <span className="ml-auto flex flex-wrap gap-2">
              {post?.status === 'published' && post.url && <a href={post.url} target="_blank" rel="noreferrer" className="h-[30px] px-3 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 text-xs font-semibold inline-flex items-center gap-1.5"><ExternalLink size={12} /> View on website</a>}
              {post?.status === 'deploying' && <Button size="sm" icon={RefreshCw} onClick={loadPost}>Check status</Button>}
              <Button size="sm" variant="ghost" icon={Download} busy={busy === 'export'} onClick={download} title="Fallback: the files to upload by hand">Download files</Button>
            </span>
          </div>
          {pubState === 'connected' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {[['draft', 'Save as draft', 'Stays in GrowZen only: this website has no drafts'], ['publish', 'Publish now', 'Uploads by SFTP and checks the live page'],
                  ['schedule', 'Schedule', 'GrowZen publishes it at the chosen time']].map(([id, t, h]) => (
                  <button key={id} type="button" onClick={() => setMode(id)}
                    className={`text-left p-2.5 rounded-xl border cursor-pointer ${mode === id ? 'border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/30' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                    <span className="block font-semibold text-slate-900 text-[12.5px]">{t}</span><span className="block text-[11px] text-slate-500">{h}</span>
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {mode === 'draft' && <span className="text-[12px] text-slate-600">The article is saved in GrowZen (Save changes in the editor) and is not on the website. Publish or schedule it when it is ready.</span>}
                {mode === 'publish' && (
                  <Button size="sm" variant="primary" icon={Send} busy={busy === 'publish'} disabled={RUNNING.includes(post?.status)} onClick={publish}>
                    {post?.status === 'failed' ? 'Retry publishing' : post && ['published', 'deploying'].includes(post.status) ? 'Update on website' : 'Publish now'}</Button>
                )}
                {mode === 'schedule' && (
                  <Button size="sm" variant="primary" icon={CalendarDays} onClick={() => setScheduling(true)}>{htmlSchedule ? 'Reschedule' : 'Choose date & time'}</Button>
                )}
              </div>
            </>
          )}
          {scheduling && <ScheduleModal b={b} article={{ ...article, schedule: htmlSchedule || null, publishing_status: htmlSchedule ? 'scheduled' : article.publishing_status }}
            mode="schedule" toast={toast} onClose={() => setScheduling(false)} onDone={() => { setScheduling(false); toast?.('Scheduled. GrowZen will publish it to the HTML website at that time.'); }} />}
          {post?.detail && <p className="text-[12px] text-slate-600 break-all">{post.detail}</p>}
          {post?.steps?.length > 0 && <Steps steps={post.steps} />}
          <p className="text-[11px] text-slate-500">{dataMode
            ? `The article is added to ${conn.article_store} (existing articles stay), and its address is ${conn.article_url_pattern}. Your site's own design shows it.`
            : `Only the article page, its image and ${conn.listing_file} are written.`} Every other file of your website stays as it is. Publishing again updates the same article.</p>
        </div>
      )}
      {/* deployment log (no credentials are ever written to it) */}
      {connected && conn.log?.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white">
          <button type="button" onClick={() => setShowLog(v => !v)} className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer">
            <ScrollText size={13} className="text-slate-500" /><span className="font-semibold text-slate-800 text-[12px]">Deployment log</span>
            <span className="text-[11px] text-slate-500">({conn.log.length})</span><span className="ml-auto text-[11px] text-indigo-700">{showLog ? 'Hide' : 'Show'}</span>
          </button>
          {showLog && (
            <ul className="border-t border-slate-100 divide-y divide-slate-100 max-h-64 overflow-y-auto">
              {conn.log.map((e, i) => (
                <li key={i} className="px-3 py-1.5 flex items-start gap-2 text-[11.5px]">
                  {e.ok ? <CheckCircle2 size={12} className="text-emerald-600 shrink-0 mt-0.5" /> : <XCircle size={12} className="text-rose-600 shrink-0 mt-0.5" />}
                  <span className="text-slate-400 font-mono shrink-0">{fmtDateTime(e.at)}</span>
                  <span className="text-slate-700"><b className="font-semibold">{e.action}</b> · {e.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <p className="flex items-start gap-1.5 text-[11px] text-slate-500"><FolderOpen size={12} className="shrink-0 mt-0.5" />
        <span>Checks only read your public pages. Files are written only when you publish or run a test deployment, and only the files named above.</span></p>
    </section>
  );
}
