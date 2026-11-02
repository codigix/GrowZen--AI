import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, Loader2, RefreshCw, ExternalLink, Globe, KeyRound, Unplug, Send, Copy } from 'lucide-react';
import { Badge, Button, Field, inputCls } from './SeoUi';
import { api } from './seoApi';

const METHODS = {
  wordpress: { label: 'WordPress REST API', expect: ['Reach the website', 'Find the WordPress REST API', 'Sign in with the application password', 'Check permission to write posts'] },
  webhook: { label: 'Signed webhook', expect: ['Reach the webhook endpoint', 'Signature accepted'] }
};
const PUBLISH_EXPECT = ['Prepare the article', 'Send to the website', 'Confirm the post status'];
const MODES = [
  { id: 'draft', title: 'Save as draft', hint: 'Review it on your website before it goes live' },
  { id: 'publish', title: 'Publish now', hint: 'Goes live immediately' },
  { id: 'schedule', title: 'Schedule', hint: 'The website publishes it at the chosen time' }
];
const toneFor = (c) => (c === 'high' ? 'green' : c === 'medium' ? 'amber' : 'gray');

const randomSecret = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), x => x.toString(16).padStart(2, '0')).join('');

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

export default function SitePublishPanel({ b, article, toast, onPublished, defaultWhen }) {
  const [integ, setInteg] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [method, setMethod] = useState('wordpress');
  const [form, setForm] = useState({ url: '', username: '', secret: '' });
  const [connSteps, setConnSteps] = useState([]);
  const [connecting, setConnecting] = useState(false);
  const [mode, setMode] = useState('draft');
  const [when, setWhen] = useState(defaultWhen);
  const [pubSteps, setPubSteps] = useState([]);
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState(null);
  const started = useRef(false);

  const apply = (d) => {
    setInteg(d);
    const m = d.method || d.detected?.method;
    if (m) setMethod(m);
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
      .then(d => { apply(d); if (!d.detected) detect(); })
      .catch(e => setLoadError(e.message || String(e)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = () => {
    setConnecting(true); setConnSteps([]);
    api(`/businesses/${b.id}/site-integration/connect`, { method: 'POST', body: { method, url: form.url, username: form.username || null, secret: form.secret } })
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

  const disconnect = () => {
    api(`/businesses/${b.id}/site-integration`, { method: 'DELETE' })
      .then(() => { setConnSteps([]); setResult(null); setPubSteps([]); return api(`/businesses/${b.id}/site-integration`).then(apply); })
      .catch(e => toast(e.message));
  };

  const publish = () => {
    if (!article) { toast('Generate or open an article first.'); return; }
    setPublishing(true); setPubSteps([]); setResult(null);
    const body = { mode, scheduled_at: mode === 'schedule' ? new Date(when).toISOString() : null };
    api(`/businesses/${b.id}/articles/${article.id}/publish`, { method: 'POST', body })
      .then(r => {
        setPubSteps(r.steps); setResult(r);
        toast(mode === 'draft' ? 'Saved as a draft on your website.' : mode === 'publish' ? 'Published on your website.' : 'Scheduled on your website.');
        if (onPublished) onPublished(r, mode, when);
      })
      .catch(e => setPubSteps([{ step: 'Publish', ok: false, detail: e.message || String(e) }]))
      .finally(() => setPublishing(false));
  };

  const connected = integ?.status === 'connected';
  const det = integ?.detected;
  const site = integ?.base_url || form.url || b.website;
  const wpHelp = `${(form.url || b.website || '').replace(/\/$/, '')}/wp-admin/profile.php#application-passwords-section`;

  return (
    <div className="max-w-2xl space-y-5 text-[12px]">
      {/* 1 Detect */}
      <section className="space-y-2">
        <Num n={1} done={Boolean(det?.reachable)}>Your website&apos;s technology</Num>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Globe size={14} className="text-slate-500" />
            <span className="font-mono text-slate-700">{b.website || 'No website on this business'}</span>
            <Button size="sm" icon={RefreshCw} busy={detecting} onClick={detect} className="ml-auto">{det ? 'Detect again' : 'Detect'}</Button>
          </div>
          {detecting && !det && <p className="text-slate-500 flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Reading your homepage, headers and API…</p>}
          {loadError && <p className="text-rose-700">{loadError}</p>}
          {det && !det.reachable && <p className="text-rose-700">{det.error}</p>}
          {det?.reachable && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-500">Detected</span>
                <Badge tone={toneFor(det.confidence)}>{det.label}</Badge>
                <span className="text-slate-500">({det.confidence} confidence)</span>
              </div>
              <ul className="list-disc pl-4 text-slate-600 space-y-0.5">{det.evidence.map(e => <li key={e}>{e}</li>)}</ul>
              {det.stack?.length > 0 && <div className="flex flex-wrap gap-1.5">{det.stack.map(s => <Badge key={s}>{s}</Badge>)}</div>}
              <p className="text-slate-700">
                {det.platform === 'wordpress' && 'WordPress accepts posts through its REST API. You only need an Application Password.'}
                {det.platform === 'nextjs' && 'Next.js has no admin to post to. Your developer adds a small endpoint that receives the signed article (shown below).'}
                {det.platform === 'static' && 'This looks hand-built, so it needs a small endpoint that receives the signed article (shown below).'}
                {['shopify', 'wix', 'squarespace', 'webflow'].includes(det.platform) && `${det.label} blogs cannot be written to from here yet. Use the webhook with a developer, or copy the article from the Draft step.`}
              </p>
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
            <span className="text-emerald-800 font-semibold">Connected via {METHODS[integ.method]?.label}{integ.username ? ` as ${integ.username}` : ''}</span>
            <span className="text-slate-500 font-mono truncate">{integ.base_url}</span>
            <span className="ml-auto flex gap-2">
              <Button size="sm" icon={RefreshCw} busy={connecting} onClick={recheck}>Re-check</Button>
              <Button size="sm" icon={Unplug} onClick={disconnect}>Disconnect</Button>
            </span>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 p-3.5 space-y-3">
            <div className="flex gap-2">
              {Object.entries(METHODS).map(([id, m]) => (
                <button key={id} type="button" onClick={() => { setMethod(id); setConnSteps([]); }}
                  className={`h-8 px-3 rounded-lg border text-[11px] font-bold cursor-pointer ${method === id ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                  {m.label}{det?.method === id ? ' · recommended' : ''}
                </button>
              ))}
            </div>

            {method === 'wordpress' ? (
              <ol className="list-decimal pl-4 text-slate-600 space-y-0.5">
                <li>Open <a href={wpHelp} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline inline-flex items-center gap-0.5">your WordPress profile <ExternalLink size={11} /></a> and sign in as an Editor or Administrator.</li>
                <li>Under <b>Application Passwords</b> type <b>GrowZen</b> and click <b>Add New Application Password</b>.</li>
                <li>Copy the password WordPress shows (it appears only once) and paste it below.</li>
              </ol>
            ) : (
              <div className="text-slate-600 space-y-1.5">
                <p>GrowZen sends a signed POST to an endpoint on your site. Your developer verifies the <code className="font-mono">X-GrowZen-Signature</code> header (HMAC-SHA256 of the raw body with the secret below), saves the post, and answers 200 with <code className="font-mono">{'{"id": "...", "url": "..."}'}</code>.</p>
              </div>
            )}

            <Field label={method === 'wordpress' ? 'WordPress site address' : 'Webhook endpoint URL'}>
              <input className={inputCls} value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder={method === 'wordpress' ? 'https://yoursite.com' : 'https://yoursite.com/api/growzen/posts'} />
            </Field>
            {method === 'wordpress' && (
              <Field label="WordPress username">
                <input className={inputCls} value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} autoComplete="off" />
              </Field>
            )}
            <Field label={method === 'wordpress' ? 'Application password' : 'Signing secret'} hint={method === 'wordpress' ? 'Stored encrypted. It is never shown again.' : 'Share this with your developer. Stored encrypted.'}>
              <div className="flex gap-2">
                <input className={inputCls} type={method === 'wordpress' ? 'password' : 'text'} value={form.secret} onChange={e => setForm({ ...form, secret: e.target.value })} autoComplete="new-password" placeholder={method === 'wordpress' ? 'xxxx xxxx xxxx xxxx xxxx xxxx' : ''} />
                {method === 'webhook' && (
                  <>
                    <Button size="sm" icon={KeyRound} onClick={() => setForm(f => ({ ...f, secret: randomSecret() }))}>Generate</Button>
                    <Button size="sm" icon={Copy} disabled={!form.secret} onClick={() => navigator.clipboard?.writeText(form.secret).then(() => toast('Secret copied'))}>Copy</Button>
                  </>
                )}
              </div>
            </Field>
            <div className="flex items-center gap-2">
              <Button variant="primary" icon={Send} busy={connecting} disabled={!form.url || !form.secret || (method === 'wordpress' && !form.username)} onClick={connect}>Test &amp; connect</Button>
              {integ?.status === 'error' && integ.last_error && <span className="text-rose-700">{integ.last_error}</span>}
            </div>
          </div>
        )}
        <Checklist steps={connSteps} expect={METHODS[method].expect} busy={connecting} />
      </section>

      {/* 3 Publish */}
      <section className={`space-y-2 ${connected ? '' : 'opacity-50 pointer-events-none'}`}>
        <Num n={3} done={Boolean(result)}>Publish this article</Num>
        <div className="grid grid-cols-3 gap-2">
          {MODES.map(m => (
            <button key={m.id} type="button" onClick={() => setMode(m.id)}
              className={`text-left p-2.5 rounded-xl border cursor-pointer ${mode === m.id ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-200 bg-slate-50'}`}>
              <span className="block font-bold text-slate-800">{m.title}</span>
              <span className="block text-[11px] text-slate-500">{m.hint}</span>
            </button>
          ))}
        </div>
        {mode === 'schedule' && (
          <Field label="Publish at">
            <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} className={inputCls} />
          </Field>
        )}
        <div className="flex items-center gap-2">
          <Button variant="primary" icon={Send} busy={publishing} disabled={!article || (mode === 'schedule' && !when)} onClick={publish}>
            {mode === 'draft' ? 'Save draft to website' : mode === 'publish' ? 'Publish to website' : 'Schedule on website'}
          </Button>
          {!article && <span className="text-slate-500">Generate an article in the earlier steps first.</span>}
        </div>
        <Checklist steps={pubSteps} expect={PUBLISH_EXPECT} busy={publishing} />
        {result && (
          <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-800 flex flex-wrap items-center gap-2">
            <CheckCircle2 size={16} />
            <span className="font-semibold">{result.status === 'publish' ? 'Live' : result.status === 'future' ? 'Scheduled' : 'Draft saved'} on {site}</span>
            {result.url && <a href={result.url} target="_blank" rel="noreferrer" className="ml-auto text-indigo-700 hover:underline inline-flex items-center gap-1">Open the post <ExternalLink size={12} /></a>}
          </div>
        )}
      </section>
    </div>
  );
}
