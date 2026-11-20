import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, Loader2, Send, Save, Unplug, ExternalLink, Settings2, KeyRound, AlertTriangle, FileCode2, Eye, EyeOff, PlugZap, RefreshCw } from 'lucide-react';
import { Badge, Button, Field, inputCls, useDoubleConfirm } from './SeoUi';
import { api, fmtDateTime } from './seoApi';
import Select from '../components/Select';

/**
 * Publishing destination: a plain HTML website on FTP / FTPS / SFTP hosting (same layout as the React.js panel).
 * 1) the connection: website details + server login (saved on the server; the password is never sent back),
 *    checked by Test connection and a test deployment, 2) publish or schedule the article.
 * Talks only to /businesses/{id}/html-site (and the shared schedule endpoint with destination "html").
 */

export const HTML_STATUS = { connected: ['Connected', 'green'], failed: ['Check failed', 'red'], setup: ['Setup not finished', 'amber'], not_connected: ['Not connected', 'gray'] };
const POST_LABEL = { published: ['Published', 'green'], failed: ['Failed', 'red'], publishing: ['Publishing', 'amber'], uploading: ['Uploading', 'amber'], deploying: ['Checking live site', 'amber'] };

const hostOf = (u) => { try { return new URL(/^https?:\/\//i.test(u || '') ? u : `https://${u}`).hostname.replace(/^www\./, ''); } catch { return ''; } };

const emptyForm = (b) => {
  const site = (b.website || '').replace(/\/$/, '');
  return {
    website_name: b.name || '', website_url: site, listing_file: 'blog.html', articles_folder: 'blog',
    adapter: 'ftp', host: hostOf(site), port: '21', user: '', password: '', tls: true, root: ''
  };
};
// The password is never sent back by the server: the field stays empty and an empty value keeps the saved one.
const fromSite = (s, b) => {
  const f = emptyForm(b);
  const d = s?.deploy?.source === 'app' ? s.deploy : null;
  return {
    ...f, website_name: s?.website_name || f.website_name, website_url: s?.website_url || f.website_url,
    listing_file: s?.listing_file || f.listing_file, articles_folder: s?.articles_folder || f.articles_folder,
    adapter: d?.adapter || 'ftp', host: d?.host || hostOf(s?.website_url || f.website_url), port: String(d?.port || 21),
    user: d?.user || '', password: '', tls: d ? Boolean(d.tls) : true, root: d?.root || ''
  };
};
const statusOf = (s) => (s?.ready ? 'connected' : s?.status === 'error' || s?.deploy_test?.status === 'failed' || s?.deploy?.connection_test?.ok === false ? 'failed' : s?.configured ? 'setup' : 'not_connected');

function Num({ n, done, children }) {
  return (
    <div className="flex items-center gap-2 text-[12.5px] font-bold text-slate-800">
      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] ${done ? 'bg-emerald-500 text-white' : 'bg-indigo-600 text-white'}`}>{done ? <CheckCircle2 size={14} /> : n}</span>
      {children}
    </div>
  );
}

function Steps({ steps, busy, label = 'Contacting the website…' }) {
  if (busy) return <div className="flex items-center gap-2 text-slate-500 text-[12px]"><Loader2 size={13} className="animate-spin" /> {label}</div>;
  if (!steps?.length) return null;
  return (
    <ul className="rounded-xl border border-slate-200 divide-y divide-slate-100 bg-white">
      {steps.map((s, i) => (
        <li key={i} className="px-3 py-2 flex items-start gap-2 text-[12px]">
          {s.running ? <Loader2 size={14} className="text-slate-500 animate-spin shrink-0 mt-0.5" />
            : s.ok ? (s.warning ? <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" /> : <CheckCircle2 size={14} className="text-emerald-600 shrink-0 mt-0.5" />)
              : <XCircle size={14} className="text-rose-600 shrink-0 mt-0.5" />}
          <span><b className="text-slate-800">{s.step}</b><span className="block text-slate-500 break-all">{s.detail}</span></span>
        </li>
      ))}
    </ul>
  );
}

const sectionTitle = 'text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2';

export default function HtmlSitePanel({ b, article = null, toast = console.log, onChanged, onConnection, defaultWhen }) {
  const [site, setSiteState] = useState(null);
  // every change (load, save, test, disconnect) is also reported up, so the destination cards stay current
  const setSite = (s) => { setSiteState(s); if (onConnection) onConnection(s); };
  const [form, setForm] = useState(() => emptyForm(b));
  const [editing, setEditing] = useState(false);
  const [steps, setSteps] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [ask, confirmNode] = useDoubleConfirm();
  const [mode, setMode] = useState('publish');
  const [when, setWhen] = useState(defaultWhen || '');
  const [pubSteps, setPubSteps] = useState([]);
  const [post, setPost] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  const bizRef = useRef(b.id);
  bizRef.current = b.id;
  const load = () => {
    const forBiz = b.id;
    return api(`/businesses/${forBiz}/html-site`).then(s => {
      if (bizRef.current !== forBiz) return;  // the account was switched meanwhile
      setSite(s); setForm(fromSite(s, b)); setEditing(!s.ready);
    }).catch(e => { if (bizRef.current === forBiz) setError(e.message); });
  };
  useEffect(() => {
    setSiteState(null); setForm(emptyForm(b)); setEditing(false); setSteps([]); setPubSteps([]); setError('');
    load();
  }, [b.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // the test deployment runs on the server in the background: follow it until it ends
  const testing = site?.deploy_test?.status === 'running';
  useEffect(() => {
    if (!testing) return undefined;
    const t = setInterval(() => api(`/businesses/${b.id}/html-site`).then(s => {
      setSite(s);
      if (s.deploy_test?.status !== 'running') {
        const ok = s.deploy_test?.status === 'ok';
        setSteps(st => [...st.filter(x => x.step !== 'Test deployment'), { step: 'Test deployment', ok, detail: s.deploy_test?.detail }]);
        if (ok) { setEditing(false); toast('HTML website connected.'); }
      }
    }).catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [testing, b.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // the article's publish status on the HTML website (followed while it is being published)
  const postBusy = ['publishing', 'uploading', 'deploying'].includes(post?.status);
  useEffect(() => {
    if (!article?.id) { setPost(null); return undefined; }
    let stop = false;
    const get = () => api(`/businesses/${b.id}/html-site/articles/${article.id}`).then(p => { if (!stop) { setPost(p); if (p.steps?.length) setPubSteps(p.steps); } }).catch(() => {});
    get();
    const t = postBusy ? setInterval(get, 4000) : null;
    return () => { stop = true; if (t) clearInterval(t); };
  }, [article?.id, b.id, postBusy]);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const hasPassword = Boolean(site?.deploy?.has_password);

  /** Save Configuration: website details (site check) → server login → Test connection → test deployment. */
  const save = async () => {
    setBusy('save'); setError(''); setSteps([]);
    const out = [];
    try {
      let s = await api(`/businesses/${b.id}/html-site`, { method: 'PUT', body: {
        website_name: form.website_name, website_url: form.website_url, listing_file: form.listing_file, articles_folder: form.articles_folder } });
      out.push({ step: 'Read the blog page', ok: Boolean(s.site_check?.ok), detail: s.site_check?.detail });
      s = await api(`/businesses/${b.id}/html-site/deploy`, { method: 'PUT', body: {
        adapter: form.adapter, host: form.host.trim(), port: Number(form.port) || null, user: form.user.trim(),
        password: form.password || null, tls: form.adapter === 'ftp' && form.tls, root: form.root.trim() || null } });
      out.push({ step: 'Save the server login', ok: true, detail: `${form.adapter === 'sftp' ? 'SFTP' : form.tls ? 'FTPS' : 'FTP'} ${form.user.trim()}@${form.host.trim()}:${Number(form.port) || (form.adapter === 'sftp' ? 22 : 21)} (password stored encrypted)` });
      setSite(s); setSteps([...out]);
      const r = await api(`/businesses/${b.id}/html-site/deploy/test-connection`, { method: 'POST' });
      out.push(...r.steps);
      setSite(r.site); setForm(fromSite(r.site, b));
      if (r.ok) {
        const t = await api(`/businesses/${b.id}/html-site/deploy/test`, { method: 'POST' });
        out.push({ step: 'Test deployment', ok: true, running: true, detail: 'Uploading a small check file and waiting for the live website to serve it…' });
        setSite(t);
      } else toast('Saved, but the connection check failed: see the steps.');
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSteps(out); setBusy('');
    }
  };
  const testConnection = () => {
    setBusy('retest'); setSteps([]); setError('');
    api(`/businesses/${b.id}/html-site/deploy/test-connection`, { method: 'POST' })
      .then(r => { setSteps(r.steps); setSite(r.site); toast(r.ok ? 'Connection works.' : 'Connection check failed: see the steps.'); })
      .catch(e => setError(e.message)).finally(() => setBusy(''));
  };
  const testDeploy = () => {
    setBusy('deploytest'); setError('');
    api(`/businesses/${b.id}/html-site/deploy/test`, { method: 'POST' })
      .then(s => { setSite(s); setSteps([{ step: 'Test deployment', ok: true, running: true, detail: 'Uploading a small check file and waiting for the live website to serve it…' }]); })
      .catch(e => setError(e.message)).finally(() => setBusy(''));
  };
  const disconnect = () => ask({
    what: 'the HTML website connection', effect: 'The saved website settings and server password are removed and publishing to this website stops. Files already on the website stay.',
    onConfirm: () => api(`/businesses/${b.id}/html-site`, { method: 'DELETE' }).then(() => { setSteps([]); load(); toast('HTML website disconnected.'); }).catch(e => toast(e.message))
  });

  const publish = () => {
    if (!article) return;
    setBusy('publish'); setPubSteps([]); setError('');
    if (mode === 'schedule') {
      const [date, time] = String(when).split('T');
      api(`/businesses/${b.id}/articles/${article.id}/schedule`, { method: 'PUT', body: { date, time: (time || '').slice(0, 5), destination: 'html' } })
        .then(r => { setPubSteps([{ step: 'Schedule', ok: true, detail: `GrowZen will publish it to the HTML website on ${date} at ${(time || '').slice(0, 5)}.` }]); toast('Scheduled: GrowZen will publish it at that time.'); if (onChanged) onChanged(r.article); })
        .catch(e => setPubSteps([{ step: 'Schedule', ok: false, detail: e.message || String(e) }])).finally(() => setBusy(''));
      return;
    }
    api(`/businesses/${b.id}/html-site/articles/${article.id}/publish`, { method: 'POST' })
      .then(p => { setPost(p); toast('Publishing to the HTML website…'); if (onChanged) onChanged(); })
      .catch(e => setPubSteps([{ step: 'Publish', ok: false, detail: e.message || String(e) }])).finally(() => setBusy(''));
  };

  if (!site) {
    return error ? <p className="text-[12px] text-rose-700">{error}</p>
      : <div className="py-8 flex items-center gap-2 text-[12px] text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading the HTML website connection…</div>;
  }

  const status = statusOf(site);
  const connected = status === 'connected';
  const [stLabel, stTone] = HTML_STATUS[status];
  const ready = Boolean(form.website_url.trim() && form.listing_file.trim() && form.host.trim() && form.user.trim() && (form.password || hasPassword));
  const lastOk = site.deploy_test?.status === 'ok' ? site.deploy_test.at : null;
  const lastIssue = !connected && (site.deploy_test?.status === 'failed' ? site.deploy_test.detail
    : site.deploy?.connection_test?.ok === false ? site.deploy.connection_test.detail : site.site_check?.ok === false ? site.site_check.detail : null);
  const onSite = post?.status === 'published';
  const [pLabel, pTone] = POST_LABEL[post?.status] || [];
  const modes = [
    { id: 'publish', title: 'Publish now', hint: 'Uploaded to the website and checked live' },
    { id: 'schedule', title: 'Schedule', hint: 'Published automatically at the chosen time' }
  ];

  return (
    <div className="max-w-2xl space-y-5 text-[12px]">
      {confirmNode}
      {/* 1 Connection */}
      <section className="space-y-2">
        <Num n={1} done={connected}>HTML Website Connection</Num>
        <div className={`rounded-xl border p-3.5 space-y-2 ${connected ? 'border-emerald-500/30 bg-emerald-500/10' : status === 'failed' ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-slate-50'}`}>
          <div className="flex flex-wrap items-center gap-2">
            <FileCode2 size={15} className="text-slate-600" />
            <span className="font-semibold text-slate-900">{site.website_name || 'HTML website'}</span>
            <Badge tone={stTone}>{stLabel}</Badge>
            {site.website_url && <a href={`${site.website_url}/${site.listing_file || ''}`} target="_blank" rel="noreferrer" className="font-mono text-indigo-700 hover:underline truncate max-w-[260px]">{`${site.website_url.replace(/^https?:\/\//, '')}/${site.listing_file || ''}`}</a>}
            {!editing && (
              <span className="ml-auto flex flex-wrap gap-2">
                <Button size="sm" icon={PlugZap} busy={busy === 'retest'} onClick={testConnection}>Test connection</Button>
                <Button size="sm" icon={RefreshCw} busy={busy === 'deploytest' || testing} onClick={testDeploy}>Test deployment</Button>
                <Button size="sm" icon={Settings2} onClick={() => setEditing(true)}>Edit settings</Button>
                {site.configured && <Button size="sm" icon={Unplug} onClick={disconnect}>Disconnect</Button>}
              </span>
            )}
          </div>
          <div className="text-[11.5px] text-slate-600">
            {lastOk ? <>Last successful test deployment: <b>{fmtDateTime(lastOk)}</b></> : 'Never connected yet'}
            {site.deploy?.source === 'app' && <> · {site.deploy.adapter === 'sftp' ? 'SFTP' : site.deploy.tls ? 'FTPS' : 'FTP'} {site.deploy.user}@{site.deploy.host}{site.deploy.root ? ` (/${site.deploy.root})` : ''}</>}
            {site.shape && <span className="block mt-0.5">New articles appear at <span className="font-mono">{site.shape.url_pattern}</span></span>}
            {lastIssue && <span className="block text-rose-700 mt-0.5">{lastIssue}</span>}
          </div>
        </div>

        {editing && (
          <div className="rounded-xl border border-slate-200 p-3.5 space-y-4">
            <div>
              <div className={sectionTitle}>Website details</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <Field label="Website name"><input className={inputCls} value={form.website_name} onChange={set('website_name')} placeholder="My Company" /></Field>
                <Field label="Website URL"><input className={inputCls} value={form.website_url} onChange={set('website_url')} placeholder="https://example.com" /></Field>
                <Field label="Blog listing HTML file" hint="The page that lists the articles"><input className={inputCls} value={form.listing_file} onChange={set('listing_file')} placeholder="blog.html" /></Field>
                <Field label="Blog articles folder" hint="Article pages and images go here"><input className={inputCls} value={form.articles_folder} onChange={set('articles_folder')} placeholder="blog" /></Field>
              </div>
            </div>
            <div>
              <div className={sectionTitle}>Server login (FTP / FTPS / SFTP)</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <Field label="Method">
                  <Select className={inputCls} value={form.adapter} onChange={e => setForm(f => ({ ...f, adapter: e.target.value, port: e.target.value === 'sftp' ? '22' : '21' }))}>
                    <option value="ftp">FTP / FTPS</option>
                    <option value="sftp">SFTP (SSH)</option>
                  </Select>
                </Field>
                <Field label={form.adapter === 'sftp' ? 'SFTP server' : 'FTP server'} hint="cPanel: usually the domain itself"><input className={inputCls} value={form.host} onChange={set('host')} placeholder="example.com" /></Field>
                <Field label="Port"><input className={inputCls} inputMode="numeric" value={form.port} onChange={set('port')} placeholder={form.adapter === 'sftp' ? '22' : '21'} /></Field>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                <Field label={form.adapter === 'sftp' ? 'Username' : 'FTP username'} hint="An account limited to the website folder">
                  <input className={inputCls} autoComplete="off" value={form.user} onChange={set('user')} placeholder={`user@${hostOf(form.website_url) || 'example.com'}`} />
                </Field>
                <Field label="Password" hint={hasPassword ? 'Saved (encrypted); leave empty to keep it' : 'Stored encrypted on the server, never shown again'}>
                  <div className="relative">
                    <KeyRound size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type={showPassword ? 'text' : 'password'} autoComplete="new-password" className={`${inputCls} pl-8 pr-9`} value={form.password}
                      onChange={set('password')} placeholder={hasPassword ? '••••••••  (saved)' : 'FTP account password'} />
                    <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                      {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </Field>
                <Field label="Website folder (optional)" hint="Empty = detect (e.g. public_html)"><input className={inputCls} value={form.root} onChange={set('root')} placeholder="(auto)" /></Field>
                {form.adapter === 'ftp' && (
                  <label className="self-end pb-2 flex items-center gap-2 text-[12px] text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={form.tls} onChange={set('tls')} /> Use explicit FTPS (encrypted, same port)
                  </label>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" icon={Save} busy={busy === 'save'} disabled={!ready || testing} onClick={save}>Save Configuration</Button>
              {site.configured && <Button icon={PlugZap} busy={busy === 'retest'} disabled={!site.deploy} onClick={testConnection}>Test connection</Button>}
              {connected && <Button onClick={() => { setEditing(false); setForm(fromSite(site, b)); setSteps([]); }}>Cancel</Button>}
              {site.configured && <Button icon={Unplug} onClick={disconnect}>Disconnect</Button>}
            </div>
            <p className="flex items-start gap-1.5 text-[11px] text-slate-500"><AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span>Save Configuration reads the live blog page, signs in to the server, finds the website folder and uploads a small check file to confirm the live website serves it (then removes it). Publishing unlocks after that passes. Only the article&apos;s own files and the blog listing are ever changed.</span></p>
          </div>
        )}
        <Steps steps={steps} busy={busy === 'save' && !steps.length || busy === 'retest'} />
        {error && <p className="text-rose-700">{error}</p>}
      </section>

      {/* 2 Publish */}
      {!connected && (
        <p className="flex items-start gap-1.5 text-[12px] text-amber-800"><AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>Publishing unlocks after the connection is <b>saved</b> and shows <b>Connected</b> (Save Configuration in step 1).</span></p>
      )}
      <section className={`space-y-2 ${connected ? '' : 'opacity-50 pointer-events-none'}`}>
        <Num n={2} done={onSite}>Publish this article</Num>
        <div className="grid grid-cols-2 gap-2">
          {modes.map(m => (
            <button key={m.id} type="button" onClick={() => setMode(m.id)}
              className={`text-left p-2.5 rounded-xl border cursor-pointer ${mode === m.id ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-200 bg-slate-50'}`}>
              <span className="block font-bold text-slate-800">{m.title}</span>
              <span className="block text-[11px] text-slate-500">{m.hint}</span>
            </button>
          ))}
        </div>
        {mode === 'schedule' && <Field label="Publish at"><input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} className={inputCls} /></Field>}
        {onSite && <p className="text-slate-600">Already on the website. Publishing again updates the same article instead of creating a duplicate.</p>}
        <div className="flex items-center gap-2">
          <Button variant="primary" icon={Send} busy={busy === 'publish' || postBusy} disabled={!article || postBusy || (mode === 'schedule' && !when)} onClick={publish}>
            {mode === 'schedule' ? 'Schedule' : onSite ? 'Update and publish' : 'Publish to website'}
          </Button>
          {!article && <span className="text-slate-500">Generate an article in the earlier steps first.</span>}
        </div>
        <Steps steps={pubSteps} busy={busy === 'publish' && mode === 'schedule'} />
        {pLabel && (
          <div className={`p-3.5 rounded-xl border space-y-2 ${post.status === 'published' ? 'bg-emerald-500/10 border-emerald-500/25' : post.status === 'failed' ? 'bg-rose-50 border-rose-200' : 'bg-amber-500/10 border-amber-500/25'}`}>
            <div className="flex flex-wrap items-center gap-2"><Badge tone={pTone}>{pLabel}</Badge><span className="font-semibold text-slate-900 truncate max-w-[340px]">{article?.title || article?.keyword}</span></div>
            <div className="text-[11.5px] text-slate-600">{post.status === 'published' ? `On the HTML website${post.published_at ? ` · ${fmtDateTime(post.published_at)}` : ''}` : post.detail}</div>
            {post.url && post.status === 'published' && (
              <a href={post.url} target="_blank" rel="noreferrer" className="h-8 px-3 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 font-semibold"><ExternalLink size={12} /> View website</a>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
