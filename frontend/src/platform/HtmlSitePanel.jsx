import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, Loader2, RefreshCw, ExternalLink, Globe, KeyRound, Unplug, Send, Server, AlertTriangle, PlugZap } from 'lucide-react';
import { Badge, Button, Field, inputCls } from './SeoUi';
import { api, fmtDateTime } from './seoApi';
import Select from '../components/Select';

/**
 * HTML Website destination (plain HTML sites on FTP / FTPS / SFTP hosting).
 * 1 Website settings (site check)  →  2 Deployment settings  →  3 Test connection  →  4 Run test deployment  →  Publish now.
 * Talks only to /businesses/{id}/html-site; the WordPress and React.js panels are separate and unaffected.
 */

const hostOf = (u) => { try { return new URL(/^https?:\/\//i.test(u || '') ? u : `https://${u}`).hostname.replace(/^www\./, ''); } catch { return ''; } };

const Num = ({ n, done, children }) => (
  <div className="flex items-center gap-2 font-semibold text-slate-900 text-13">
    <span className={`w-6 h-6 rounded-full grid place-items-center text-11 ${done ? 'bg-emerald-500 text-white' : 'bg-indigo-600 text-white'}`}>{done ? <CheckCircle2 size={13} /> : n}</span>
    {children}
  </div>
);

const Steps = ({ steps }) => !steps?.length ? null : (
  <ul className="space-y-1 text-12">
    {steps.map((s, i) => (
      <li key={i} className="flex items-start gap-2">
        {s.ok ? (s.warning ? <AlertTriangle size={13} className="text-amber-500 mt-0.5 shrink-0" /> : <CheckCircle2 size={13} className="text-emerald-600 mt-0.5 shrink-0" />)
          : <XCircle size={13} className="text-rose-600 mt-0.5 shrink-0" />}
        <span><b className="text-slate-800">{s.step}</b> <span className="text-slate-600">{s.detail}</span></span>
      </li>
    ))}
  </ul>
);

const box = 'p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-3';

export default function HtmlSitePanel({ b, article = null, toast = console.log, onConnection }) {
  const [site, setSite] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [connSteps, setConnSteps] = useState(null);
  const [form, setForm] = useState({ website_name: '', website_url: '', listing_file: 'blog.html', articles_folder: 'blog' });
  const [dep, setDep] = useState({ adapter: 'ftp', host: '', port: '21', user: '', password: '', tls: true, root: '' });
  const [post, setPost] = useState(null);
  const filled = useRef(false);

  const apply = (s) => {
    setSite(s);
    if (onConnection) onConnection(s);
    if (!filled.current) {
      filled.current = true;
      const url = s.website_url || b.website || '';
      setForm({ website_name: s.website_name || b.name || '', website_url: url, listing_file: s.listing_file || 'blog.html', articles_folder: s.articles_folder || 'blog' });
      const d = s.deploy?.source === 'app' ? s.deploy : null;
      const h = hostOf(url);
      setDep({ adapter: d?.adapter || 'ftp', host: d?.host || h, port: String(d?.port || 21), user: d?.user || '', password: '',
        tls: d ? Boolean(d.tls) : true, root: d?.root || '' });
    }
  };

  const load = () => api(`/businesses/${b.id}/html-site`).then(apply).catch(e => setLoadErr(e.message || String(e)));
  useEffect(() => { filled.current = false; load(); }, [b.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // the test deployment runs in the background: follow it until it ends
  const running = site?.deploy_test?.status === 'running';
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => api(`/businesses/${b.id}/html-site`).then(apply).catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [running, b.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // the article's publish status on the HTML website
  const postBusy = ['publishing', 'uploading', 'deploying'].includes(post?.status);
  useEffect(() => {
    if (!article?.id) { setPost(null); return undefined; }
    let stop = false;
    const get = () => api(`/businesses/${b.id}/html-site/articles/${article.id}`).then(p => { if (!stop) setPost(p); }).catch(() => {});
    get();
    const t = postBusy ? setInterval(get, 4000) : null;
    return () => { stop = true; if (t) clearInterval(t); };
  }, [article?.id, b.id, postBusy]);

  const run = (key, fn) => { setBusy(key); setErr(''); return fn().catch(e => setErr(e.message || String(e))).finally(() => setBusy('')); };
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const setD = (k) => (e) => setDep(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const saveSite = () => run('site', () => api(`/businesses/${b.id}/html-site`, { method: 'PUT', body: form }).then(s => {
    apply(s); toast(s.status === 'connected' ? 'Website checked: the blog page was found.' : 'Saved, but the blog page could not be read.');
  }));
  const saveDeploy = () => run('deploy', () => api(`/businesses/${b.id}/html-site/deploy`, {
    method: 'PUT', body: { ...dep, port: Number(dep.port) || null, password: dep.password || null, root: dep.root || null }
  }).then(s => { apply(s); setDep(d => ({ ...d, password: '' })); setConnSteps(null); toast('Deployment settings saved. Now run Test connection.'); }));
  const testConn = () => run('conn', () => api(`/businesses/${b.id}/html-site/deploy/test-connection`, { method: 'POST' }).then(r => {
    setConnSteps(r.steps); apply(r.site); toast(r.ok ? 'Connection works.' : 'Connection test failed.');
  }));
  const testDeploy = () => run('test', () => api(`/businesses/${b.id}/html-site/deploy/test`, { method: 'POST' }).then(apply));
  const publish = () => run('publish', () => api(`/businesses/${b.id}/html-site/articles/${article.id}/publish`, { method: 'POST' }).then(p => { setPost(p); toast('Publishing to the HTML website…'); }));
  const disconnect = () => {
    if (!window.confirm('Remove the HTML website settings (including the saved FTP password)? Files already on the website stay.')) return;
    run('off', () => api(`/businesses/${b.id}/html-site`, { method: 'DELETE' }).then(() => { filled.current = false; setConnSteps(null); return load(); }));
  };

  if (loadErr) return <p className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-12 text-rose-800">{loadErr}</p>;
  if (!site) return <div className="flex items-center gap-2 text-12 text-slate-500"><Loader2 size={13} className="animate-spin" /> Loading the HTML website settings…</div>;

  const d = site.deploy;
  const ct = d?.connection_test;
  const dt = site.deploy_test;
  const siteOk = site.status === 'connected';

  return (
    <div className="space-y-5 text-13 max-w-4xl">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold text-slate-900">HTML Website</span>
        <Badge tone={site.ready ? 'green' : site.status === 'error' ? 'red' : 'gray'}>{site.ready ? 'Connected' : site.status === 'error' ? 'Check failed' : site.configured ? 'Setup not finished' : 'Not connected'}</Badge>
        {site.website_url && <a href={site.website_url} target="_blank" rel="noreferrer" className="text-12 text-indigo-700 hover:underline inline-flex items-center gap-1">{site.website_url.replace(/^https?:\/\//, '')} <ExternalLink size={11} /></a>}
        {site.configured && <Button size="sm" variant="ghost" icon={Unplug} busy={busy === 'off'} onClick={disconnect} className="ml-auto">Disconnect</Button>}
      </div>

      {/* 1 Website */}
      <div className="space-y-2">
        <Num n={1} done={siteOk}>Website and blog page</Num>
        <div className={box}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Website name"><input className={inputCls} value={form.website_name} onChange={set('website_name')} placeholder={b.name} /></Field>
            <Field label="Website URL"><input className={`${inputCls} font-mono`} value={form.website_url} onChange={set('website_url')} placeholder="https://yourwebsite.com" /></Field>
            <Field label="Blog listing HTML file"><input className={`${inputCls} font-mono`} value={form.listing_file} onChange={set('listing_file')} placeholder="blog.html" /></Field>
            <Field label="Blog articles folder"><input className={`${inputCls} font-mono`} value={form.articles_folder} onChange={set('articles_folder')} placeholder="blog" /></Field>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="primary" icon={Globe} busy={busy === 'site'} onClick={saveSite} disabled={!form.website_url.trim() || !form.listing_file.trim()}>Save &amp; check website</Button>
            <span className="text-11 text-slate-500">Reads the live blog page to learn how the site keeps its articles. Nothing is changed on the website.</span>
          </div>
          {site.site_check && (
            <p className={`text-12 flex items-start gap-2 ${site.site_check.ok ? 'text-emerald-800' : 'text-rose-700'}`}>
              {site.site_check.ok ? <CheckCircle2 size={13} className="mt-0.5 shrink-0" /> : <XCircle size={13} className="mt-0.5 shrink-0" />}
              <span>{site.site_check.detail}</span>
            </p>
          )}
        </div>
      </div>

      {/* 2 Deployment */}
      <div className="space-y-2">
        <Num n={2} done={Boolean(d)}>How files reach the website (FTP / FTPS / SFTP)</Num>
        <div className={box}>
          {d?.source === 'server' && <p className="text-12 text-slate-600">The server already has a deployment for this website ({d.label}{d.target ? `: ${d.target}` : ''}). Settings saved here replace it.</p>}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Method">
              <Select className={inputCls} value={dep.adapter} onChange={e => setDep(f => ({ ...f, adapter: e.target.value, port: e.target.value === 'sftp' ? '22' : '21' }))}>
                <option value="ftp">FTP / FTPS</option><option value="sftp">SFTP (SSH)</option>
              </Select>
            </Field>
            <Field label={dep.adapter === 'sftp' ? 'SFTP server' : 'FTP server'}><input className={`${inputCls} font-mono`} value={dep.host} onChange={setD('host')} placeholder="ftp.yourwebsite.com" /></Field>
            <Field label="Port"><input className={`${inputCls} font-mono`} value={dep.port} onChange={setD('port')} inputMode="numeric" placeholder={dep.adapter === 'sftp' ? '22' : '21'} /></Field>
            <Field label={dep.adapter === 'sftp' ? 'Username' : 'FTP username'}><input className={`${inputCls} font-mono`} value={dep.user} onChange={setD('user')} autoComplete="off" placeholder={`user@${hostOf(form.website_url) || 'yourwebsite.com'}`} /></Field>
            <Field label={d?.has_password ? 'Password (leave empty to keep the saved one)' : 'Password'}><input className={inputCls} type="password" value={dep.password} onChange={setD('password')} autoComplete="new-password" placeholder={d?.has_password ? '••••••••' : ''} /></Field>
            <Field label="Website folder (optional)"><input className={`${inputCls} font-mono`} value={dep.root} onChange={setD('root')} placeholder="detect (e.g. public_html)" /></Field>
          </div>
          {dep.adapter === 'ftp' && (
            <label className="flex items-center gap-2 text-12 text-slate-700 cursor-pointer">
              <input type="checkbox" checked={dep.tls} onChange={setD('tls')} /> Use explicit FTPS (encrypted, recommended; same port 21)
            </label>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" icon={KeyRound} busy={busy === 'deploy'} onClick={saveDeploy}
              disabled={!site.configured || !dep.host.trim() || !dep.user.trim() || (!dep.password && !d?.has_password)}>Save settings</Button>
            {!site.configured && <span className="text-11 text-amber-700">Save the website (step 1) first.</span>}
            <span className="text-11 text-slate-500 inline-flex items-center gap-1"><Server size={11} /> The password is stored encrypted on the server and is never shown again.</span>
          </div>
        </div>
      </div>

      {/* 3 Test connection */}
      <div className="space-y-2">
        <Num n={3} done={Boolean(ct?.ok)}>Test connection</Num>
        <div className={box}>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" icon={PlugZap} busy={busy === 'conn'} onClick={testConn} disabled={d?.source !== 'app' && d?.source !== 'server'}>Test connection</Button>
            <span className="text-11 text-slate-500">Signs in and finds the folder that contains {form.listing_file || 'the blog page'}. Writes nothing.</span>
          </div>
          {connSteps ? <Steps steps={connSteps} /> : ct && (
            <p className={`text-12 ${ct.ok ? 'text-emerald-800' : 'text-rose-700'}`}>{ct.ok ? 'Last test passed' : 'Last test failed'} ({fmtDateTime ? fmtDateTime(ct.at) : ct.at}): {ct.detail}</p>
          )}
        </div>
      </div>

      {/* 4 Test deployment */}
      <div className="space-y-2">
        <Num n={4} done={site.ready}>Run test deployment</Num>
        <div className={box}>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" icon={running ? Loader2 : RefreshCw} busy={busy === 'test'} onClick={testDeploy} disabled={running || !d}>
              {running ? 'Testing…' : 'Run test deployment'}
            </Button>
            <span className="text-11 text-slate-500">Uploads a small check file, confirms the live website serves it, then removes it. Publishing unlocks after this passes.</span>
          </div>
          {dt && (
            <p className={`text-12 flex items-start gap-2 ${dt.status === 'ok' ? 'text-emerald-800' : dt.status === 'running' ? 'text-slate-600' : 'text-rose-700'}`}>
              {dt.status === 'running' ? <Loader2 size={13} className="animate-spin mt-0.5 shrink-0" /> : dt.status === 'ok' ? <CheckCircle2 size={13} className="mt-0.5 shrink-0" /> : <XCircle size={13} className="mt-0.5 shrink-0" />}
              <span>{dt.detail}</span>
            </p>
          )}
        </div>
      </div>

      {err && <p className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-12 text-rose-800">{err}</p>}

      {/* Publish (inside an article only) */}
      {article && (
        <div className={`${box} bg-white`}>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" icon={Send} busy={busy === 'publish' || postBusy} onClick={publish} disabled={!site.ready || postBusy}>
              {post?.status === 'published' ? 'Update on the website' : 'Publish now'}
            </Button>
            {!site.ready && <span className="text-12 text-amber-700">Finish steps 1–4 to publish to this website.</span>}
            {post?.status && <Badge tone={post.status === 'published' ? 'green' : post.status === 'failed' ? 'red' : 'amber'}>{post.status}</Badge>}
            {post?.url && post.status === 'published' && <a href={post.url} target="_blank" rel="noreferrer" className="text-12 text-indigo-700 hover:underline inline-flex items-center gap-1">View article <ExternalLink size={11} /></a>}
          </div>
          {post?.detail && post.status !== 'published' && <p className="text-12 text-slate-600">{post.detail}</p>}
          <Steps steps={post?.steps} />
          <p className="text-11 text-slate-500">To publish later, use Schedule: “HTML Website” is listed as a destination once connected.</p>
        </div>
      )}

      {site.log?.length > 0 && (
        <details className="text-12">
          <summary className="cursor-pointer text-slate-600">Deployment log ({site.log.length})</summary>
          <ul className="mt-2 space-y-1">
            {site.log.map((l, i) => (
              <li key={i} className="flex items-start gap-2">
                {l.ok ? <CheckCircle2 size={12} className="text-emerald-600 mt-0.5 shrink-0" /> : <XCircle size={12} className="text-rose-600 mt-0.5 shrink-0" />}
                <span className="text-slate-500 whitespace-nowrap">{fmtDateTime ? fmtDateTime(l.at) : l.at}</span>
                <span><b className="text-slate-700">{l.action}</b> {l.detail}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
