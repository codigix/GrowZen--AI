import React, { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Loader2, Send, Save, Unplug, ExternalLink, Trash2, Settings2, KeyRound, AlertTriangle, Code2, Eye, EyeOff, Upload, Globe, Lock } from 'lucide-react';
import { Badge, Button, Field, Modal, inputCls, useDoubleConfirm } from './SeoUi';
import { api, fmtDateTime } from './seoApi';

export const REACT_STATUS = { connected: ['Connected', 'green'], failed: ['Authentication Failed', 'red'], not_connected: ['Not connected', 'gray'] };
const POST_LABEL = { publish: ['Published', 'green'], draft: ['Draft', 'gray'], scheduled: ['Scheduled', 'amber'], deleted: ['Deleted', 'red'] };

const emptyForm = (b) => {
  const site = (b.website || '').replace(/\/$/, '');
  return {
    website_name: b.name || '', website_url: site, blog_url: site ? `${site}/blog` : '', api_base_url: site,
    auth_scheme: 'login', login_username: '', login_password: '', auth_endpoint: '/api/integrations/login',
    health_endpoint: '', publish_endpoint: '/api/blogs', image_endpoint: '/api/uploads', default_status: 'draft',
    mapping: { ...DEFAULT_MAPPING }
  };
};
// Mirrors services/react_site.DEFAULT_MAPPING (the server validates and applies it)
const DEFAULT_MAPPING = { image_delivery: 'upload', upload_format: 'multipart', upload_field: 'image', alt_field: 'alt', response_url_path: '', image_field: 'image', image_alt_field: 'image_alt', max_upload_mb: 5 };
// The password is never sent back by the server: the field stays empty and an empty value keeps the saved one.
const fromConn = (c, b) => ({
  ...emptyForm(b), ...Object.fromEntries(Object.entries(c || {}).filter(([k, v]) => k in emptyForm(b) && v != null)), login_password: '',
  mapping: { ...DEFAULT_MAPPING, ...(c?.mapping || {}) }
});

function Num({ n, done, children }) {
  return (
    <div className="flex items-center gap-2 text-[12.5px] font-bold text-slate-800">
      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] ${done ? 'bg-emerald-500 text-white' : 'bg-indigo-600 text-white'}`}>{done ? <CheckCircle2 size={14} /> : n}</span>
      {children}
    </div>
  );
}

function Steps({ steps, busy }) {
  if (busy) return <div className="flex items-center gap-2 text-slate-500 text-[12px]"><Loader2 size={13} className="animate-spin" /> Contacting the website…</div>;
  if (!steps?.length) return null;
  return (
    <ul className="rounded-xl border border-slate-200 divide-y divide-slate-100 bg-white">
      {steps.map((s, i) => (
        <li key={i} className="px-3 py-2 flex items-start gap-2 text-[12px]">
          {s.ok ? <CheckCircle2 size={14} className="text-emerald-600 shrink-0 mt-0.5" /> : <XCircle size={14} className="text-rose-600 shrink-0 mt-0.5" />}
          <span><b className="text-slate-800">{s.step}</b><span className="block text-slate-500 break-all">{s.detail}</span></span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Publishing destination: a custom React.js website with its own blog API.
 * 1) the connection (settings saved on the server; the API key is never sent back), 2) publish / update / delete the article.
 */
export default function ReactSitePanel({ b, article, featured, toast, onChanged, onConnection, defaultWhen }) {
  const [conn, setConnState] = useState(null);
  // every connection change (load, save, test, disconnect) is also reported up, so the destination cards stay current
  const setConn = (c) => { setConnState(c); if (onConnection) onConnection(c); };
  const [form, setForm] = useState(() => emptyForm(b));
  const [editing, setEditing] = useState(false);
  const [steps, setSteps] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [ask, confirmNode] = useDoubleConfirm();
  const [mode, setMode] = useState('draft');
  const [when, setWhen] = useState(defaultWhen);
  const [pubSteps, setPubSteps] = useState([]);
  const [post, setPost] = useState(article);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { setPost(article); }, [article?.id, article?.react_status, article?.react_post_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const bizRef = React.useRef(b.id);
  bizRef.current = b.id;
  const load = () => {
    const forBiz = b.id;
    return api(`/businesses/${forBiz}/react-site`).then(c => {
      if (bizRef.current !== forBiz) return;  // the account was switched meanwhile: never show another account's connection
      setConn(c); setForm(fromConn(c, b)); setMode(c.default_status || 'draft'); setEditing(c.status !== 'connected');
    }).catch(e => { if (bizRef.current === forBiz) setError(e.message); });
  };
  useEffect(() => {
    // switching accounts: drop everything shown for the previous one before loading this account's own connection
    setConn(null); setForm(emptyForm(b)); setEditing(false); setSteps([]); setPubSteps([]); setUploadSteps([]); setError('');
    load();
  }, [b.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const setMap = (k) => (e) => setForm(f => ({ ...f, mapping: { ...f.mapping, [k]: e.target.value } }));
  const [uploadSteps, setUploadSteps] = useState([]);
  const testUpload = () => {
    setBusy('upload'); setUploadSteps([]); setError('');
    api(`/businesses/${b.id}/react-site/test-upload`, { method: 'POST' })
      .then(r => { setUploadSteps(r.steps); toast(r.ok ? 'Image upload works.' : 'Image upload failed: see the steps.'); })
      .catch(e => setUploadSteps([{ step: 'Test image upload', ok: false, detail: e.message || String(e) }])).finally(() => setBusy(''));
  };
  const [showPassword, setShowPassword] = useState(false);
  const [testedOk, setTestedOk] = useState(false);  // Test Login passed for the form as it is now (not saved yet)
  useEffect(() => { setTestedOk(false); }, [form]);
  const body = () => ({
    ...form, auth_scheme: 'login', login_username: form.login_username.trim(), login_password: form.login_password || null,
    health_endpoint: form.health_endpoint || null, image_endpoint: form.image_endpoint || null,
    mapping: { ...form.mapping, max_upload_mb: Number(form.mapping.max_upload_mb) || 5 }
  });
  const testNow = () => {
    setBusy('test'); setError(''); setSteps([]);
    api(`/businesses/${b.id}/react-site/test`, { method: 'POST', body: body() })
      .then(r => { setSteps(r.steps); setTestedOk(r.ok); toast(r.ok ? 'Login works. Click Save Configuration to connect.' : 'Authentication failed: see the steps.'); })
      .catch(e => setError(e.message)).finally(() => setBusy(''));
  };
  const save = () => {
    setBusy('save'); setError(''); setSteps([]);
    api(`/businesses/${b.id}/react-site`, { method: 'PUT', body: body() })
      .then(r => {
        setSteps(r.steps); setConn(r.connection); setForm(fromConn(r.connection, b));
        if (r.ok) { setEditing(false); toast('React.js website connected.'); } else toast('Saved, but authentication failed: see the steps.');
      })
      .catch(e => setError(e.message)).finally(() => setBusy(''));
  };
  const disconnect = () => ask({
    what: 'the React.js website connection', effect: 'The saved login password and access token are removed and publishing to this website stops. Posts already on the website stay.',
    onConfirm: () => api(`/businesses/${b.id}/react-site`, { method: 'DELETE' }).then(() => { setSteps([]); load(); toast('React.js website disconnected.'); }).catch(e => toast(e.message))
  });

  const publish = () => {
    if (!article) return;
    setBusy('publish'); setPubSteps([]); setError('');
    api(`/businesses/${b.id}/articles/${article.id}/publish-react`, { method: 'POST', body: { mode, scheduled_at: mode === 'schedule' ? new Date(when).toISOString() : null } })
      .then(r => { setPubSteps(r.steps); setPost(r.article); toast(mode === 'draft' ? 'Saved as a draft on the React.js website.' : mode === 'publish' ? 'Published on the React.js website.' : 'Scheduled on the React.js website.'); if (onChanged) onChanged(r.article); })
      .catch(e => setPubSteps([{ step: 'Publish', ok: false, detail: e.message || String(e) }])).finally(() => setBusy(''));
  };
  const removePost = () => {
    setBusy('delete'); setError('');
    api(`/businesses/${b.id}/articles/${article.id}/react-post`, { method: 'DELETE' })
      .then(r => { setConfirmDelete(false); setPubSteps(r.steps); setPost(r.article); toast(r.already_gone ? 'The post was already gone; marked as deleted.' : 'Post deleted from the React.js website.'); if (onChanged) onChanged(r.article); })
      .catch(e => setError(e.message)).finally(() => setBusy(''));
  };

  const connected = conn?.status === 'connected';
  const ready = Boolean(form.api_base_url && form.publish_endpoint && form.auth_endpoint && form.login_username.trim() && (form.login_password || conn?.has_password));
  const [stLabel, stTone] = REACT_STATUS[conn?.status] || REACT_STATUS.not_connected;
  const onSite = Boolean(post?.react_post_id && post.react_status !== 'deleted');
  const [pLabel, pTone] = POST_LABEL[post?.react_status] || [];
  const modes = [
    { id: 'draft', title: 'Save as draft', hint: 'Review it on the website before it goes live' },
    { id: 'publish', title: 'Publish now', hint: 'Goes live immediately' },
    { id: 'schedule', title: 'Schedule', hint: 'The website publishes it at the chosen time' }
  ];

  if (!conn) return <div className="py-8 flex items-center gap-2 text-[12px] text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading the React.js website connection…</div>;

  return (
    <div className="max-w-2xl space-y-5 text-[12px]">
      {confirmNode}
      {/* 1 Connection */}
      <section className="space-y-2">
        <Num n={1} done={connected}>React.js Website Connection</Num>
        <div className={`rounded-xl border p-3.5 space-y-2 ${connected ? 'border-emerald-500/30 bg-emerald-500/10' : conn.status === 'failed' ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-slate-50'}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Code2 size={15} className="text-slate-600" />
            <span className="font-semibold text-slate-900">{conn.website_name || 'React.js website'}</span>
            <Badge tone={stTone}>{stLabel}</Badge>
            {conn.blog_url && <a href={conn.blog_url} target="_blank" rel="noreferrer" className="font-mono text-indigo-700 hover:underline truncate max-w-[260px]">{conn.blog_url.replace(/^https?:\/\//, '')}</a>}
            {!editing && (
              <span className="ml-auto flex gap-2">
                <Button size="sm" icon={Send} busy={busy === 'retest'} onClick={() => { setBusy('retest'); setSteps([]); api(`/businesses/${b.id}/react-site/test`, { method: 'POST' }).then(r => { setSteps(r.steps); setConn(r.connection); }).catch(e => setError(e.message)).finally(() => setBusy('')); }}>Test Login</Button>
                {(conn.image_endpoint || conn.mapping?.image_delivery === 'inline') && conn.mapping?.image_delivery !== 'inline' && <Button size="sm" icon={Upload} busy={busy === 'upload'} onClick={testUpload}>Test image upload</Button>}
                <Button size="sm" icon={Settings2} onClick={() => setEditing(true)}>Edit settings</Button>
                {(conn.has_password || conn.has_key) && <Button size="sm" icon={Unplug} onClick={disconnect}>Disconnect</Button>}
              </span>
            )}
          </div>
          <div className="text-[11.5px] text-slate-600">
            {conn.last_success_at ? <>Last successful connection: <b>{fmtDateTime(conn.last_success_at)}</b></> : 'Never connected yet'}
            {conn.last_checked_at && conn.last_checked_at !== conn.last_success_at && <> · last check {fmtDateTime(conn.last_checked_at)}</>}
            {conn.status === 'failed' && conn.last_error && <span className="block text-rose-700 mt-0.5">{conn.last_error}</span>}
          </div>
        </div>

        {editing && (
          <div className="rounded-xl border border-slate-200 p-3.5 space-y-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Website details</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <Field label="Website name"><input className={inputCls} value={form.website_name} onChange={set('website_name')} placeholder="My Company" /></Field>
                <Field label="Website URL" hint="This account's registered website">
                  <div className="w-full h-9 flex items-center gap-2 px-3 rounded border border-indigo-200 bg-gradient-to-r from-indigo-50 to-white cursor-not-allowed select-text"
                    title="The website URL comes from this account's business profile and cannot be changed here" aria-readonly="true">
                    <Globe size={14} className="text-indigo-500 shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-[13px] font-medium text-slate-800">{form.website_url || 'No website on this account'}</span>
                    <Lock size={12} className="text-slate-400 shrink-0" />
                  </div>
                </Field>
                <Field label="Blog URL"><input className={inputCls} value={form.blog_url} onChange={set('blog_url')} placeholder="https://example.com/blog" /></Field>
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Login authentication</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <Field label="Login username / email" hint="The website's integration user (not the main admin)">
                  <input className={inputCls} autoComplete="off" value={form.login_username} onChange={set('login_username')} placeholder="erp-integration@example.com" />
                </Field>
                <Field label="Login password" hint={conn.has_password ? 'Saved (encrypted); leave empty to keep it' : 'Stored encrypted on the ERP server, never shown again'}>
                  <div className="relative">
                    <KeyRound size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type={showPassword ? 'text' : 'password'} autoComplete="new-password" className={`${inputCls} pl-8 pr-9`} value={form.login_password}
                      onChange={set('login_password')} placeholder={conn.has_password ? '••••••••  (saved)' : 'Integration user password'} />
                    <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                      {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </Field>
                <Field label="Authentication endpoint" hint="POST username/email + password → access token"><input className={inputCls} value={form.auth_endpoint} onChange={set('auth_endpoint')} placeholder="/api/integrations/login" /></Field>
                {conn.token_valid_until && conn.status === 'connected' && <div className="self-end pb-2 text-[11px] text-emerald-700">Access token valid until {fmtDateTime(conn.token_valid_until)} · renewed automatically</div>}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">API endpoints</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <Field label="Backend API base URL"><input className={inputCls} value={form.api_base_url} onChange={set('api_base_url')} placeholder="https://example.com" /></Field>
                <Field label="Publishing endpoint" hint="POST create, PUT/DELETE …/{id}"><input className={inputCls} value={form.publish_endpoint} onChange={set('publish_endpoint')} placeholder="/api/blogs" /></Field>
                <Field label="Health endpoint (optional)" hint="GET with the token; checked by Test Login when set"><input className={inputCls} value={form.health_endpoint} onChange={set('health_endpoint')} placeholder="/api/integrations/health" /></Field>
              </div>
            </div>
            {/* Featured image upload settings are hidden: the Blog Content Editor is the single place to manage the
                featured image. The mapping values stay in the form state and are still saved and used when publishing. */}
            <div className="hidden" aria-hidden="true">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Featured image upload</div>
              <p className="text-[11px] text-slate-500 mb-2">
                {form.mapping.image_delivery === 'inline'
                  ? 'The optimized WebP is sent inside the blog post itself, into the blog field below (as a data URL). No separate upload API is used and nothing is created on the website.'
                  : 'GrowZen sends the optimized WebP to this website\'s own upload API (signed in), reads the image URL from the answer and stores it in the blog field below. Nothing is created on the website.'}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <Field label="Image delivery" hint="How the image reaches the website">
                  <select className={inputCls} value={form.mapping.image_delivery} onChange={setMap('image_delivery')}>
                    <option value="upload">Upload endpoint (stores the image address)</option>
                    <option value="inline">Inside the blog post (image field)</option>
                  </select>
                </Field>
                <Field label="Blog image field" hint="Blog record field for the image"><input className={inputCls} value={form.mapping.image_field} onChange={setMap('image_field')} placeholder="image" /></Field>
                <Field label="Blog image ALT field" hint="Empty = don't send"><input className={inputCls} value={form.mapping.image_alt_field} onChange={setMap('image_alt_field')} placeholder="image_alt" /></Field>
                <Field label={form.mapping.image_delivery === 'inline' ? 'Maximum image size (MB)' : 'Maximum upload size (MB)'}
                  hint={form.mapping.image_delivery === 'inline' ? 'Every blog read returns the image: keep it small (0.2–0.5)' : 'Larger images are re-compressed to fit'}>
                  <input type="number" min="0.1" max="100" step="0.1" className={inputCls} value={form.mapping.max_upload_mb} onChange={setMap('max_upload_mb')} />
                </Field>
                {form.mapping.image_delivery !== 'inline' && (<>
                  <Field label="Image upload endpoint" hint="POST on the API base URL"><input className={inputCls} value={form.image_endpoint} onChange={set('image_endpoint')} placeholder="/api/uploads" /></Field>
                  <Field label="Request format">
                    <select className={inputCls} value={form.mapping.upload_format} onChange={setMap('upload_format')}>
                      <option value="multipart">multipart/form-data (file)</option>
                      <option value="json_base64">JSON with base64 image</option>
                    </select>
                  </Field>
                  <Field label="File field name" hint="The field the upload API reads"><input className={inputCls} value={form.mapping.upload_field} onChange={setMap('upload_field')} placeholder="image" /></Field>
                  <Field label="ALT text field" hint="Sent with the upload; empty = none"><input className={inputCls} value={form.mapping.alt_field} onChange={setMap('alt_field')} placeholder="alt" /></Field>
                  <Field label="Response URL path" hint="e.g. url or data.file.url; empty = detect"><input className={inputCls} value={form.mapping.response_url_path} onChange={setMap('response_url_path')} placeholder="(auto)" /></Field>
                </>)}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Publishing settings</div>
              <div className="flex flex-wrap gap-2">
                {[['draft', 'Save as draft'], ['publish', 'Publish immediately'], ['schedule', 'Schedule publishing']].map(([id, label]) => (
                  <button key={id} type="button" onClick={() => setForm(f => ({ ...f, default_status: id }))}
                    className={`h-8 px-3 rounded-lg border text-[11.5px] font-semibold cursor-pointer ${form.default_status === id ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>{label}</button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button icon={Send} busy={busy === 'test'} disabled={!ready} onClick={testNow}>Test Login</Button>
              <Button variant="primary" icon={Save} busy={busy === 'save'} disabled={!ready} onClick={save}>Save Configuration</Button>
              {connected && <Button onClick={() => { setEditing(false); setForm(fromConn(conn, b)); setSteps([]); }}>Cancel</Button>}
              {(conn.has_password || conn.has_key) && <Button icon={Unplug} onClick={disconnect}>Disconnect</Button>}
            </div>
            <p className="flex items-start gap-1.5 text-[11px] text-slate-500"><AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span>The website&apos;s backend must provide the login and blog endpoints for its integration user. GrowZen signs in, keeps the access token on the server and renews it automatically, then sends the article as JSON (title, slug, body, SEO fields, image, status) — see docs/react-site-blog-api.md.</span></p>
          </div>
        )}
        <Steps steps={steps} busy={busy === 'test' || busy === 'save' || busy === 'retest'} />
        <Steps steps={uploadSteps} busy={busy === 'upload'} />
        {testedOk && editing && !busy && (
          <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900">
            <CheckCircle2 size={15} className="text-emerald-600" />
            <span className="flex-1 min-w-[200px]"><b>Login works.</b> Test Login does not save anything: click <b>Save Configuration</b> to connect and unlock publishing.</span>
            <Button size="sm" variant="primary" icon={Save} onClick={save}>Save Configuration</Button>
          </div>
        )}
        {error && <p className="text-rose-700">{error}</p>}
      </section>

      {/* 2 Publish */}
      {!connected && (
        <p className="flex items-start gap-1.5 text-[12px] text-amber-800"><AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>Publishing unlocks after the connection is <b>saved</b> and shows <b>Connected</b> (Save Configuration in step 1).</span></p>
      )}
      <section className={`space-y-2 ${connected ? '' : 'opacity-50 pointer-events-none'}`}>
        <Num n={2} done={post?.react_status === 'publish'}>Publish this article</Num>
        <div className="grid grid-cols-3 gap-2">
          {modes.map(m => (
            <button key={m.id} type="button" onClick={() => setMode(m.id)}
              className={`text-left p-2.5 rounded-xl border cursor-pointer ${mode === m.id ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-200 bg-slate-50'}`}>
              <span className="block font-bold text-slate-800">{m.title}</span>
              <span className="block text-[11px] text-slate-500">{m.hint}</span>
            </button>
          ))}
        </div>
        {mode === 'schedule' && <Field label="Publish at"><input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} className={inputCls} /></Field>}
        {article && !featured?.path && <p className="flex items-start gap-1.5 text-amber-800"><AlertTriangle size={13} className="shrink-0 mt-0.5" /><span>No featured image: the post is sent without one.</span></p>}
        {onSite && <p className="text-slate-600">Already on the website as post {post.react_post_id}. Publishing again updates that post instead of creating a duplicate.</p>}
        <div className="flex items-center gap-2">
          <Button variant="primary" icon={Send} busy={busy === 'publish'} disabled={!article || (mode === 'schedule' && !when)} onClick={publish}>
            {onSite ? (mode === 'draft' ? 'Update as draft' : mode === 'publish' ? 'Update and publish' : 'Update and schedule') : (mode === 'draft' ? 'Save draft to website' : mode === 'publish' ? 'Publish to website' : 'Schedule')}
          </Button>
          {!article && <span className="text-slate-500">Generate an article in the earlier steps first.</span>}
        </div>
        <Steps steps={pubSteps} busy={busy === 'publish'} />
        {pLabel && (
          <div className={`p-3.5 rounded-xl border space-y-2 ${post.react_status === 'deleted' ? 'bg-slate-50 border-slate-200' : post.react_status === 'publish' ? 'bg-emerald-500/10 border-emerald-500/25' : 'bg-amber-500/10 border-amber-500/25'}`}>
            <div className="flex flex-wrap items-center gap-2"><Badge tone={pTone}>{pLabel}</Badge><span className="font-semibold text-slate-900 truncate max-w-[340px]">{post.title || post.keyword}</span></div>
            <div className="text-[11.5px] text-slate-600">{post.react_status === 'deleted' ? `Deleted from the React.js website · post ${post.react_post_id} · kept here in your history` : `On the React.js website · post ${post.react_post_id}`}</div>
            {post.react_status !== 'deleted' && (
              <div className="flex flex-wrap gap-2">
                {post.react_url && <a href={post.react_url} target="_blank" rel="noreferrer" className="h-8 px-3 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 font-semibold"><ExternalLink size={12} /> View website</a>}
                <button type="button" onClick={() => { setError(''); setConfirmDelete(true); }} className="h-8 px-3 rounded-lg border border-rose-200 bg-white text-rose-700 hover:bg-rose-50 inline-flex items-center gap-1.5 font-semibold cursor-pointer"><Trash2 size={12} /> Delete post</button>
              </div>
            )}
          </div>
        )}
      </section>

      <Modal open={confirmDelete} onClose={() => busy !== 'delete' && setConfirmDelete(false)} width="max-w-md" title="Delete post from your website"
        footer={<><Button onClick={() => setConfirmDelete(false)} disabled={busy === 'delete'}>Cancel</Button>
          <Button busy={busy === 'delete'} onClick={removePost} className="!bg-rose-600 !text-white !border-rose-600 hover:!bg-rose-700">Permanently Delete</Button></>}>
        <div className="space-y-3 text-13 text-slate-700">
          <p className="font-semibold text-slate-900">Are you sure you want to permanently delete this article from your React.js website?</p>
          <div className="rounded bg-slate-50 ring-1 ring-inset ring-slate-200 px-3 py-2 text-12"><div className="font-semibold">{post?.title || post?.keyword}</div><div className="text-slate-500">Post {post?.react_post_id}{post?.react_url ? ` · ${post.react_url}` : ''}</div></div>
          <p className="text-12 text-slate-500">Only this post is removed. The article stays in GrowZen.</p>
          {error && <p className="text-12 text-rose-700">Not deleted: {error}</p>}
        </div>
      </Modal>
    </div>
  );
}
