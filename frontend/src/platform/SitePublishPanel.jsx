import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, Loader2, RefreshCw, ExternalLink, Globe, KeyRound, Unplug, Send, Copy, Clock, Trash2, AlertTriangle } from 'lucide-react';
import { Badge, Button, Field, Modal, inputCls, useDoubleConfirm } from './SeoUi';
import { api, fmtDateTime } from './seoApi';

/** The article's post on the website: label + badge tone per stored wp_status. */
export const POST_STATUS = {
  publish: ['Published', 'green'], draft: ['Draft', 'gray'], pending: ['Draft', 'gray'], private: ['Private', 'gray'],
  future: ['Scheduled', 'amber'], scheduled: ['Scheduled', 'amber'], deleted: ['Deleted', 'red']
};
export const postStatusOf = (a) => (a?.wp_status ? POST_STATUS[a.wp_status] || [a.wp_status, 'gray'] : a?.wp_url ? POST_STATUS.publish : null);
/** A post GrowZen can delete: it is on a WordPress site, has its post id, and is not deleted yet. */
export const canDeletePost = (a) => Boolean(a?.wp_post_id && a.wp_status !== 'deleted' && a.wp_status !== 'scheduled' && (a.publish_method || 'wordpress') === 'wordpress');

/**
 * Permanently delete an article's WordPress post, after an explicit confirmation.
 * Returns [askDelete(article), node]; node holds the confirmation dialog (render it once).
 * On success onDeleted(updatedArticle) runs; on failure the dialog shows WordPress's error and nothing changes.
 */
export function useDeleteWebsitePost(b, onDeleted) {
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => { if (!busy) { setTarget(null); setError(''); } };
  const confirm = () => {
    setBusy(true); setError('');
    api(`/businesses/${b.id}/articles/${target.id}/website-post`, { method: 'DELETE' })
      .then(r => { setTarget(null); if (onDeleted) onDeleted(r.article, r); })
      .catch(e => setError(e.message || String(e)))
      .finally(() => setBusy(false));
  };
  const node = (
    <Modal open={Boolean(target)} onClose={close} width="max-w-md" title="Delete post from your website"
      footer={<><Button onClick={close} disabled={busy}>Cancel</Button>
        <Button busy={busy} onClick={confirm} className="!bg-rose-600 !text-white !border-rose-600 hover:!bg-rose-700">Permanently Delete</Button></>}>
      <div className="space-y-3 text-13 text-slate-700">
        <p className="font-semibold text-slate-900">Are you sure you want to permanently delete this article from your WordPress website?</p>
        <div className="rounded bg-slate-50 ring-1 ring-inset ring-slate-200 px-3 py-2 text-12">
          <div className="font-semibold text-slate-800">{target?.title || target?.keyword}</div>
          <div className="text-slate-500">WordPress post #{target?.wp_post_id}{target?.wp_url ? ` · ${target.wp_url}` : ''}</div>
        </div>
        <div className="flex items-start gap-2 rounded bg-rose-50 ring-1 ring-inset ring-rose-200 px-3 py-2 text-12 text-rose-800">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>Only this post is removed, and it skips the WordPress Trash, so it cannot be restored there. The article stays in GrowZen.</span>
        </div>
        {error && <p className="text-12 text-rose-700">Not deleted: {error}</p>}
      </div>
    </Modal>
  );
  return [(a) => { setError(''); setTarget(a); }, node];
}

const METHODS = {
  wordpress: { label: 'WordPress', short: 'WordPress REST API', expect: ['Reach the website', 'Find the WordPress REST API', 'Sign in with the application password', 'Check permission to write posts'] },
  github: { label: 'GitHub repository', short: 'GitHub', expect: ['Sign in with the access token', 'Find the repository', 'Check permission to write', 'Check the branch', 'Check the posts folder'] },
  ghost: { label: 'Ghost', short: 'Ghost Admin API', expect: ['Read the Admin API key', 'Find the Ghost Admin API', 'Sign in with the Admin API key'] },
  shopify: { label: 'Shopify', short: 'Shopify Admin API', expect: ['Read the store address', 'Sign in with the access token', 'Find the blog'] },
  webhook: { label: 'Signed webhook', short: 'Signed webhook', expect: ['Reach the webhook endpoint', 'Signature accepted'] }
};
const CATEGORY = { framework: 'Framework', language: 'Language', libraries: 'Libraries', theme: 'Theme', plugins: 'Plugins', ecommerce: 'Shop', hosting: 'Hosting', cdn: 'CDN', server: 'Server', analytics: 'Analytics' };
const PUBLISH_EXPECT = ['Prepare the article', 'Send to the website', 'Confirm the post status'];
const toneFor = (c) => (c === 'high' ? 'green' : c === 'medium' ? 'amber' : 'gray');
const randomSecret = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), x => x.toString(16).padStart(2, '0')).join('');
const EMPTY_FORM = { url: '', username: '', secret: '', repo: '', branch: '', directory: 'content/blog', body_format: 'markdown', public_url: '' };

/** Reveals real step results one after another, with a spinner on the step still running. */
function Checklist({ steps, expect, busy }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (busy) { setShown(0); return undefined; }
    setShown(0);
    let n = 0;
    const t = setInterval(() => { n += 1; setShown(n); if (n >= steps.length) clearInterval(t); }, 280);
    return () => clearInterval(t);
  }, [busy, steps]);
  if (!busy && !steps.length) return null;
  const rows = busy ? expect.map((s, i) => ({ step: s, state: i === 0 ? 'run' : 'wait' })) : steps.map((s, i) => ({ ...s, state: i < shown ? (s.ok ? 'ok' : 'fail') : i === shown ? 'run' : 'wait' }));
  return (
    <ul className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
      {rows.map(r => (
        <li key={r.step} className="flex items-start gap-2.5 px-3 py-2">
          <span className="mt-0.5 shrink-0">
            {r.state === 'ok' ? <CheckCircle2 size={15} className="text-emerald-600" />
              : r.state === 'fail' ? <XCircle size={15} className="text-rose-600" />
                : r.state === 'run' ? <Loader2 size={15} className="animate-spin text-indigo-500" />
                  : <span className="block w-[15px] h-[15px] rounded-full border border-slate-300" />}
          </span>
          <span className="min-w-0">
            <span className={`block font-semibold ${r.state === 'wait' ? 'text-slate-400' : 'text-slate-800'}`}>{r.step}</span>
            {r.state !== 'wait' && r.state !== 'run' && r.detail && <span className={`block text-[11px] ${r.ok ? 'text-slate-500' : 'text-rose-700'}`}>{r.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Num({ n, children, done }) {
  return (
    <div className="flex items-center gap-2 text-slate-800 font-bold">
      <span className={`w-5 h-5 rounded-full text-[11px] grid place-items-center ${done ? 'bg-emerald-500 text-white' : 'bg-indigo-500 text-white'}`}>{done ? '✓' : n}</span>
      {children}
    </div>
  );
}

const Help = ({ children }) => <div className="text-slate-600 space-y-1.5">{children}</div>;

function ConnectFields({ method, form, setForm, website, toast }) {
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const site = (form.url || website || '').replace(/\/$/, '');
  if (method === 'wordpress') {
    return (
      <>
        <ol className="list-decimal pl-4 text-slate-600 space-y-0.5">
          <li>Open <a href={`${site}/wp-admin/profile.php#application-passwords-section`} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline inline-flex items-center gap-0.5">your WordPress profile <ExternalLink size={10} /></a> and sign in.</li>
          <li>Under <b>Application Passwords</b> type <b>GrowZen</b> and click <b>Add New Application Password</b>.</li>
          <li>Copy the password WordPress shows (it appears only once) and paste it below.</li>
        </ol>
        <Field label="WordPress site address"><input className={inputCls} value={form.url} onChange={set('url')} placeholder="https://yoursite.com" /></Field>
        <Field label="WordPress username"><input className={inputCls} value={form.username} onChange={set('username')} autoComplete="off" /></Field>
        <Field label="Application password" hint="Stored encrypted. It is never shown again."><input className={inputCls} type="password" value={form.secret} onChange={set('secret')} autoComplete="new-password" /></Field>
      </>
    );
  }
  if (method === 'github') {
    return (
      <>
        <Help>
          <p>Each post is added as a Markdown file (with title, date, description and keywords at the top) in your site's repository. Your host (Vercel, Netlify, GitHub Pages…) then rebuilds the site by itself.</p>
          <ol className="list-decimal pl-4 space-y-0.5">
            <li>On GitHub open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline inline-flex items-center gap-0.5">Settings → Fine-grained tokens <ExternalLink size={10} /></a>.</li>
            <li>Choose only your website's repository and give it <b>Contents: Read and write</b>.</li>
            <li>Paste the token below. It is stored encrypted and never shown again.</li>
          </ol>
        </Help>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Repository" hint="owner/name"><input className={inputCls} value={form.repo} onChange={set('repo')} placeholder="acme/website" /></Field>
          <Field label="Branch" hint="blank = the default branch"><input className={inputCls} value={form.branch} onChange={set('branch')} placeholder="main" /></Field>
          <Field label="Posts folder" hint="where your blog files live"><input className={inputCls} value={form.directory} onChange={set('directory')} placeholder="content/blog" /></Field>
          <Field label="File format">
            <select className={inputCls} value={form.body_format} onChange={set('body_format')}><option value="markdown">Markdown (.md)</option><option value="html">HTML (.html)</option></select>
          </Field>
        </div>
        <Field label="Your site's address" hint="used to open published posts"><input className={inputCls} value={form.url} onChange={set('url')} placeholder="https://yoursite.com" /></Field>
        <Field label="Post address pattern (optional)" hint="{slug} is replaced with the post's slug"><input className={inputCls} value={form.public_url} onChange={set('public_url')} placeholder="https://yoursite.com/blog/{slug}" /></Field>
        <Field label="GitHub access token"><input className={inputCls} type="password" value={form.secret} onChange={set('secret')} autoComplete="new-password" /></Field>
      </>
    );
  }
  if (method === 'ghost') {
    return (
      <>
        <ol className="list-decimal pl-4 text-slate-600 space-y-0.5">
          <li>In Ghost open <b>Settings → Integrations → Add custom integration</b> and name it GrowZen.</li>
          <li>Copy its <b>Admin API key</b> (two parts: <code className="font-mono">id:secret</code>), not the Content API key.</li>
        </ol>
        <Field label="Ghost site address"><input className={inputCls} value={form.url} onChange={set('url')} placeholder="https://blog.yoursite.com" /></Field>
        <Field label="Admin API key"><input className={inputCls} type="password" value={form.secret} onChange={set('secret')} autoComplete="new-password" /></Field>
      </>
    );
  }
  if (method === 'shopify') {
    return (
      <>
        <ol className="list-decimal pl-4 text-slate-600 space-y-0.5">
          <li>In Shopify open <b>Settings → Apps and sales channels → Develop apps</b> and create an app named GrowZen.</li>
          <li>Under <b>Configuration</b> give it <b>read_content</b> and <b>write_content</b>, install it, and copy the <b>Admin API access token</b> (shown once).</li>
          <li>Use your store's <b>.myshopify.com</b> address (Settings → Domains), not your custom domain.</li>
        </ol>
        <Field label="Store address"><input className={inputCls} value={form.url} onChange={set('url')} placeholder="yourstore.myshopify.com" /></Field>
        <Field label="Admin API access token"><input className={inputCls} type="password" value={form.secret} onChange={set('secret')} autoComplete="new-password" /></Field>
      </>
    );
  }
  return (
    <>
      <Help>
        <p>GrowZen sends a signed POST to an endpoint you control (a small script, or a tool like Zapier or Make that creates the post). The <code className="font-mono">X-GrowZen-Signature</code> header is an HMAC-SHA256 of the body using the secret below.</p>
      </Help>
      <Field label="Webhook endpoint URL"><input className={inputCls} value={form.url} onChange={set('url')} placeholder="https://yoursite.com/api/growzen" /></Field>
      <Field label="Signing secret" hint="Share it with whoever builds the endpoint.">
        <div className="flex gap-2">
          <input className={inputCls} value={form.secret} onChange={set('secret')} autoComplete="off" />
          <Button size="sm" icon={KeyRound} onClick={() => setForm(f => ({ ...f, secret: randomSecret() }))}>Generate</Button>
          <Button size="sm" icon={Copy} disabled={!form.secret} onClick={() => navigator.clipboard?.writeText(form.secret).then(() => toast('Secret copied'))}>Copy</Button>
        </div>
      </Field>
    </>
  );
}

const canConnect = (method, f) => Boolean(f.secret && (method === 'github' ? f.repo : f.url) && (method !== 'wordpress' || f.username));

export default function SitePublishPanel({ b, article, toast, onPublished, onChanged, defaultWhen }) {
  const [integ, setInteg] = useState(null);
  // The article's post on the website (id, url, status), updated from publish/delete answers without a page reload
  const [post, setPost] = useState(article);
  useEffect(() => { setPost(article); }, [article?.id, article?.wp_status, article?.wp_post_id, article?.wp_url]); // eslint-disable-line react-hooks/exhaustive-deps
  const [askDelete, deleteNode] = useDeleteWebsitePost(b, (updated, r) => {
    setPost(updated); setResult(null); setPubSteps(r.steps || []);
    toast(r.already_gone ? 'The post was already removed from your website; marked as deleted.' : 'Post permanently deleted from your website.');
    if (onChanged) onChanged(updated);
  });
  const [ask, confirmNode] = useDoubleConfirm();
  const [loadError, setLoadError] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [method, setMethod] = useState('wordpress');
  const [form, setForm] = useState(EMPTY_FORM);
  const [connSteps, setConnSteps] = useState([]);
  const [connecting, setConnecting] = useState(false);
  const [mode, setMode] = useState('draft');
  const [when, setWhen] = useState(defaultWhen);
  const [pubSteps, setPubSteps] = useState([]);
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState(null);
  const [scheduled, setScheduled] = useState([]);
  const started = useRef(false);

  const loadScheduled = () => api(`/businesses/${b.id}/site-integration/scheduled`).then(setScheduled).catch(() => { });

  const apply = (d) => {
    setInteg(d);
    const m = d.method || d.publishing?.method || d.detected?.method;
    if (m && METHODS[m]) setMethod(m);
    setForm(f => ({ ...f, url: f.url || d.base_url || d.detected?.url || d.website || '', username: f.username || d.username || '' }));
  };

  const detect = () => {
    setDetecting(true); setLoadError('');
    return api(`/businesses/${b.id}/site-integration/detect`, { method: 'POST', body: {} })
      .then(apply).catch(e => setLoadError(e.message || String(e))).finally(() => setDetecting(false));
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api(`/businesses/${b.id}/site-integration`)
      .then(d => { apply(d); if (!d.detected && b.website) detect(); })
      .catch(e => setLoadError(e.message || String(e)));
    loadScheduled();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = () => {
    setConnecting(true); setConnSteps([]);
    const config = method === 'github' ? { repo: form.repo, branch: form.branch || null, directory: form.directory || 'content/blog', body_format: form.body_format, public_url: form.public_url || null } : {};
    api(`/businesses/${b.id}/site-integration/connect`, { method: 'POST', body: { method, url: form.url || b.website || `https://github.com/${form.repo}`, username: form.username || null, secret: form.secret, config } })
      .then(r => {
        setConnSteps(r.steps);
        apply(r.integration);
        if (r.ok) { setForm(f => ({ ...f, secret: '' })); toast('Website connected.'); }
      })
      .catch(e => setConnSteps([{ step: 'Connect', ok: false, detail: e.message || String(e) }]))
      .finally(() => setConnecting(false));
  };

  const recheck = () => {
    setConnecting(true); setConnSteps([]);
    api(`/businesses/${b.id}/site-integration/check`, { method: 'POST' })
      .then(r => { setConnSteps(r.steps); apply(r.integration); })
      .catch(e => setConnSteps([{ step: 'Check', ok: false, detail: e.message || String(e) }]))
      .finally(() => setConnecting(false));
  };

  const disconnect = () => ask({
    what: 'the website connection', effect: 'Publishing to your website stops until you connect it again. Posts already on the site stay.',
    onConfirm: () => api(`/businesses/${b.id}/site-integration`, { method: 'DELETE' })
      .then(() => { setConnSteps([]); setResult(null); setPubSteps([]); return api(`/businesses/${b.id}/site-integration`).then(apply); })
      .catch(e => toast(e.message))
  });

  const publish = () => {
    if (!article) { toast('Generate or open an article first.'); return; }
    setPublishing(true); setPubSteps([]); setResult(null);
    const body = { mode, scheduled_at: mode === 'schedule' ? new Date(when).toISOString() : null };
    api(`/businesses/${b.id}/articles/${article.id}/publish`, { method: 'POST', body })
      .then(r => {
        setPubSteps(r.steps); setResult(r); loadScheduled();
        if (r.article) setPost(r.article);
        toast(mode === 'draft' ? 'Saved as a draft on your website.' : mode === 'publish' ? 'Published on your website.' : 'Scheduled.');
        if (onPublished) onPublished(r, mode, when);
      })
      .catch(e => setPubSteps([{ step: 'Publish', ok: false, detail: e.message || String(e) }]))
      .finally(() => setPublishing(false));
  };

  const cancel = (id) => ask({ what: 'this scheduled post', effect: 'It will not be published to your website.', onConfirm: () => api(`/businesses/${b.id}/site-integration/scheduled/${id}`, { method: 'DELETE' }).then(() => { loadScheduled(); toast('Scheduled post cancelled.'); }).catch(e => toast(e.message)) });

  const connected = integ?.status === 'connected';
  const det = integ?.detected;
  const pub = integ?.publishing || det?.publishing;
  const rec = pub?.method;
  const site = integ?.base_url || form.url || b.website;
  const heldByUs = integ?.method === 'github';
  const modes = [
    { id: 'draft', title: 'Save as draft', hint: 'Review it on your website before it goes live' },
    { id: 'publish', title: 'Publish now', hint: heldByUs ? 'Committed now; your site rebuilds in a minute or two' : 'Goes live immediately' },
    { id: 'schedule', title: 'Schedule', hint: heldByUs ? 'GrowZen publishes it at the chosen time' : 'The website publishes it at the chosen time' }
  ];
  const pending = scheduled.filter(s => s.status === 'pending');
  const postStatus = postStatusOf(post);
  const onSite = Boolean(post?.wp_post_id && post.wp_status !== 'deleted' && (post.publish_method || 'wordpress') === 'wordpress');
  const order = [...new Set([rec, ...(pub?.alternatives || []), 'wordpress', 'github', 'ghost', 'shopify', 'webhook'].filter(m => METHODS[m]))];

  return (
    <div className="max-w-2xl space-y-5 text-[12px]">
      {confirmNode}
      {deleteNode}
      {/* 1 Detect */}
      <section className="space-y-2">
        <Num n={1} done={Boolean(det?.reachable)}>Your website&apos;s technology</Num>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Globe size={14} className="text-slate-500" />
            <span className="font-mono text-slate-700">{b.website || 'No website on this business'}</span>
            <Button size="sm" icon={RefreshCw} busy={detecting} onClick={detect} disabled={!b.website} className="ml-auto">{det ? 'Detect again' : 'Detect'}</Button>
          </div>
          {detecting && !det && <p className="text-slate-500 flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Reading your homepage, headers and API…</p>}
          {loadError && <p className="text-rose-700">{loadError}</p>}
          {det && !det.reachable && <p className="text-rose-700">{det.error}</p>}
          {det?.reachable && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-500">Detected</span>
                <Badge tone={toneFor(det.confidence)}>{det.version ? `${det.label} ${det.version}` : det.label}</Badge>
                <span className="text-slate-500">({det.confidence === 'none' ? 'could not tell' : `${det.confidence} confidence`})</span>
                {det.blog_url && <a href={det.blog_url} target="_blank" rel="noreferrer" className="ml-auto text-indigo-700 hover:underline inline-flex items-center gap-1">Your blog <ExternalLink size={10} /></a>}
              </div>
              {det.details && Object.keys(det.details).length > 0 ? (
                <dl className="grid grid-cols-[84px_1fr] gap-x-2 gap-y-1">
                  {Object.entries(CATEGORY).filter(([k]) => det.details[k]?.length).map(([k, label]) => (
                    <React.Fragment key={k}><dt className="text-slate-500">{label}</dt><dd className="flex flex-wrap gap-1">{det.details[k].map(x => <Badge key={x}>{x}</Badge>)}</dd></React.Fragment>
                  ))}
                </dl>
              ) : det.stack?.length > 0 && <div className="flex flex-wrap gap-1.5">{det.stack.map(s => <Badge key={s}>{s}</Badge>)}</div>}
              <details className="text-slate-600"><summary className="cursor-pointer text-slate-500">How we know ({det.evidence.length} sign{det.evidence.length === 1 ? '' : 's'})</summary><ul className="list-disc pl-4 mt-1 space-y-0.5">{det.evidence.map(e => <li key={e}>{e}</li>)}</ul></details>
              {pub?.note && (
                <p className={`flex gap-1.5 ${pub.method ? 'text-slate-700' : 'text-amber-800'}`}>
                  {!pub.method && <AlertTriangle size={13} className="shrink-0 mt-0.5" />}<span>{pub.note}</span>
                </p>
              )}
            </>
          )}
        </div>
      </section>

      {/* 2 Connect */}
      <section className="space-y-2">
        <Num n={2} done={connected}>Connect it</Num>
        {connected ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 flex flex-wrap items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-700" />
            <span className="text-emerald-800 font-semibold">Connected via {METHODS[integ.method]?.short}{integ.username ? ` as ${integ.username}` : ''}</span>
            <span className="text-slate-500 font-mono truncate">{integ.method === 'github' ? `${integ.config?.repo} · ${integ.config?.branch} · ${integ.config?.directory}/` : integ.base_url}</span>
            <span className="ml-auto flex gap-2">
              <Button size="sm" icon={RefreshCw} busy={connecting} onClick={recheck}>Re-check</Button>
              <Button size="sm" icon={Unplug} onClick={disconnect}>Disconnect</Button>
            </span>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 p-3.5 space-y-3">
            <div className="flex flex-wrap gap-2">
              {order.map(id => (
                <button key={id} type="button" onClick={() => { setMethod(id); setConnSteps([]); }}
                  className={`h-8 px-3 rounded-lg border text-[11px] font-bold cursor-pointer ${method === id ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'}`}>
                  {METHODS[id].label}{rec === id ? ' · recommended' : ''}
                </button>
              ))}
            </div>
            <ConnectFields method={method} form={form} setForm={setForm} website={b.website} toast={toast} />
            <div className="flex items-center gap-2">
              <Button variant="primary" icon={Send} busy={connecting} disabled={!canConnect(method, form)} onClick={connect}>Test and connect</Button>
              {integ?.status === 'error' && integ.last_error && <span className="text-rose-700">{integ.last_error}</span>}
            </div>
          </div>
        )}
        <Checklist steps={connSteps} expect={METHODS[method].expect} busy={connecting} />
      </section>

      {/* 3 Publish */}
      <section className={`space-y-2 ${connected ? '' : 'opacity-50 pointer-events-none'}`}>
        <Num n={3} done={Boolean(result) || post?.wp_status === 'publish'}>Publish this article</Num>
        <div className="grid grid-cols-3 gap-2">
          {modes.map(m => (
            <button key={m.id} type="button" onClick={() => setMode(m.id)}
              className={`text-left p-2.5 rounded-xl border cursor-pointer ${mode === m.id ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-200 bg-slate-50'}`}>
              <span className="block font-bold text-slate-800">{m.title}</span>
              <span className="block text-[11px] text-slate-500">{m.hint}</span>
            </button>
          ))}
        </div>
        {mode === 'schedule' && (
          <Field label="Publish at" hint={heldByUs ? 'GrowZen holds the post and publishes it at this time (your computer\'s time zone).' : undefined}>
            <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} className={inputCls} />
          </Field>
        )}
        {onSite && integ?.method === 'wordpress' && (
          <p className="text-slate-600">This article is already on your website as post #{post.wp_post_id}. Publishing again updates that post instead of creating a duplicate.</p>
        )}
        <div className="flex items-center gap-2">
          <Button variant="primary" icon={Send} busy={publishing} disabled={!article || (mode === 'schedule' && !when)} onClick={publish}>
            {onSite && integ?.method === 'wordpress'
              ? (mode === 'draft' ? 'Update post as draft' : mode === 'publish' ? 'Update and publish' : 'Update and schedule')
              : (mode === 'draft' ? 'Save draft to website' : mode === 'publish' ? 'Publish to website' : 'Schedule')}
          </Button>
          {!article && <span className="text-slate-500">Generate an article in the earlier steps first.</span>}
        </div>
        <Checklist steps={pubSteps} expect={PUBLISH_EXPECT} busy={publishing} />
        {postStatus && (() => {
          const [label, tone] = postStatus;
          const deleted = post.wp_status === 'deleted';
          const live = post.wp_status === 'publish' || (!post.wp_status && post.wp_url);
          const where = (post.publish_method || integ?.method) === 'wordpress' ? 'WordPress' : 'your website';
          const box = deleted ? 'bg-slate-50 border-slate-200 text-slate-700' : live ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-800' : 'bg-amber-500/10 border-amber-500/25 text-amber-900';
          return (
            <div className={`p-3.5 rounded-xl border space-y-2 ${box}`}>
              <div className="flex flex-wrap items-center gap-2">
                {deleted ? <Trash2 size={15} /> : <CheckCircle2 size={16} />}
                <Badge tone={tone}>{label}</Badge>
                <span className="font-semibold text-slate-900 truncate max-w-[340px]">{post.title || post.keyword}</span>
              </div>
              <div className="text-[11.5px]">
                {deleted ? <>Permanently deleted from {where}{post.wp_deleted_at ? ` on ${fmtDateTime(post.wp_deleted_at)}` : ''} · post #{post.wp_post_id} · kept here in your history</>
                  : live ? <>Live on {where}{result && result.status === 'publish' ? ' · Published successfully' : ''}{post.wp_post_id ? ` · post #${post.wp_post_id}` : ''}</>
                    : post.wp_status === 'scheduled' ? <>Held by GrowZen and published at the chosen time</>
                      : <>{label} on {where}{post.wp_post_id ? ` · post #${post.wp_post_id}` : ''}{post.wp_status === 'future' ? ' · WordPress publishes it at the chosen time' : ''}</>}
              </div>
              {!deleted && (post.wp_url || canDeletePost(post)) && (
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  {post.wp_url && <a href={post.wp_url} target="_blank" rel="noreferrer" className="h-8 px-3 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 font-semibold"><ExternalLink size={12} /> View website</a>}
                  {canDeletePost(post) && <button type="button" onClick={() => askDelete(post)} className="h-8 px-3 rounded-lg border border-rose-200 bg-white text-rose-700 hover:bg-rose-50 inline-flex items-center gap-1.5 font-semibold cursor-pointer"><Trash2 size={12} /> Delete post</button>}
                </div>
              )}
            </div>
          );
        })()}
        {scheduled.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
            <div className="px-3 py-2 font-bold text-slate-700 flex items-center gap-1.5"><Clock size={13} /> Held by GrowZen for later</div>
            {scheduled.slice(0, 6).map(s => (
              <div key={s.id} className="px-3 py-2 flex flex-wrap items-center gap-2">
                <span className="text-slate-800 font-semibold truncate max-w-[220px]">{s.title || `Article ${s.article_id}`}</span>
                <Badge tone={s.status === 'published' ? 'green' : s.status === 'failed' ? 'red' : s.status === 'cancelled' ? 'gray' : 'amber'}>{s.status}</Badge>
                <span className="text-slate-500">{s.status === 'pending' ? `at ${fmtDateTime(s.due_at)}` : fmtDateTime(s.finished_at || s.due_at)}</span>
                {s.error && <span className="text-rose-700 truncate max-w-[240px]" title={s.error}>{s.error}</span>}
                {s.url && <a href={s.url} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline inline-flex items-center gap-1">Open <ExternalLink size={10} /></a>}
                {s.status === 'pending' && <button type="button" onClick={() => cancel(s.id)} className="ml-auto text-slate-400 hover:text-rose-600 cursor-pointer" aria-label="Cancel scheduled post"><Trash2 size={13} /></button>}
              </div>
            ))}
            {pending.length === 0 && <div className="px-3 py-2 text-slate-500">Nothing waiting.</div>}
          </div>
        )}
      </section>
    </div>
  );
}
