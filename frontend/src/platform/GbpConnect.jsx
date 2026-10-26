import React, { useEffect, useState } from 'react';
import { Mail, ShieldCheck, Loader2, Store, RefreshCw, Plug, X, MapPin, Plus, CheckCircle2, ArrowRight, Search, Globe, Star, AtSign } from 'lucide-react';
import { Modal, Button, StatusPill, Badge, Card, Field, inputCls, areaCls, ErrorNote, useAction, refreshBusinesses } from './SeoUi';
import { api, useApi, fmtDateTime } from './seoApi';

/**
 * Adding businesses (SEO backend):
 *  - Connect Google account: Google sign-in with business.manage, then pick which of the
 *    account's Business Profiles to import (GET /connections/{id}/locations, POST .../import).
 *  - Onboarding email: paste it; the backend pipeline extracts, audits and schedules.
 *  - By hand: create the business directly.
 */

export function LocationPicker({ connectionId, onImported }) {
  const locs = useApi(`/connections/${connectionId}/locations`);
  const [selected, setSelected] = useState([]);
  const [busy, error, run] = useAction();
  useEffect(() => { if (locs.data) setSelected(locs.data.filter(l => !l.imported).map(l => l.gbp_location)); }, [locs.data]);
  if (locs.loading) return <div className="py-8 flex items-center justify-center gap-2 text-[13px] text-gray-600"><Loader2 size={15} className="animate-spin text-blue-600" /> Fetching the businesses this account manages…</div>;
  if (locs.error) return <ErrorNote>{locs.error.message}</ErrorNote>;
  if (!locs.data?.length) return <div className="py-6 text-center text-[13px] text-gray-600">This account doesn't own or manage any Business Profile. Ask the owner to add it as a manager, or sign in with the owner's account.</div>;
  const importNow = () => run('import', async () => {
    const out = await api(`/connections/${connectionId}/import`, { method: 'POST', body: { locations: selected } });
    await refreshBusinesses();
    onImported(out);
  });
  return (
    <div>
      <div className="text-[13px] text-gray-700 mb-3">Found <b>{locs.data.length}</b> business{locs.data.length === 1 ? '' : 'es'}. Pick the ones to add:</div>
      <div className="border border-gray-200 rounded divide-y divide-gray-100">
        {locs.data.map(l => (
          <label key={l.gbp_location} className={`flex items-center gap-3 px-3 py-2.5 ${l.imported ? 'opacity-60' : 'cursor-pointer hover:bg-gray-50'}`}>
            <input type="checkbox" disabled={l.imported} checked={selected.includes(l.gbp_location)} onChange={() => setSelected(s => s.includes(l.gbp_location) ? s.filter(x => x !== l.gbp_location) : [...s, l.gbp_location])} />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] text-gray-900">{l.name}</div>
              <div className="text-[12px] text-gray-500 truncate flex items-center gap-1"><MapPin size={10} /> {l.address || 'Service-area business'}{l.primary_category ? ` · ${l.primary_category}` : ''}</div>
            </div>
            {l.duplicate_listing && <StatusPill level="warning">Duplicate</StatusPill>}
            {l.verification === 'verified' ? <StatusPill level="good">Verified</StatusPill> : <StatusPill level="critical">Not verified</StatusPill>}
            {l.imported && <Badge tone="gray">Already added</Badge>}
          </label>
        ))}
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="mt-4 flex justify-end"><Button variant="primary" busy={busy === 'import'} disabled={!selected.length} onClick={importNow}>Add {selected.length} and audit</Button></div>
    </div>
  );
}

// What Google Cloud needs before "Sign in with Google" can work (from GET /connections/google/setup).
function GoogleSetup({ s, open: startOpen }) {
  const [open, setOpen] = useState(startOpen);
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard?.writeText(s.redirect_uri).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  return (
    <div className={`mt-4 rounded border ${s.configured ? 'border-gray-200' : 'border-amber-300 bg-amber-50/40'}`}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-3 py-2 text-left text-[13px] font-medium text-gray-900 cursor-pointer">
        <span>{s.configured ? 'Google Cloud setup checklist' : 'Google sign-in is not set up on the SEO backend yet'}</span>
        <span className="text-[12px] text-blue-700">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <ol className="px-4 pb-3 space-y-2.5 text-[12px] text-gray-700 list-decimal list-outside ml-4">
          {!s.configured && <li>Set <code className="bg-gray-100 px-1 rounded">GOOGLE_CLIENT_ID</code> and <code className="bg-gray-100 px-1 rounded">GOOGLE_CLIENT_SECRET</code> in <code className="bg-gray-100 px-1 rounded">seo-platform/backend/.env</code> (an OAuth client of type “Web application”), then restart the backend.</li>}
          <li>
            In Google Cloud → APIs &amp; Services → Credentials → your OAuth client{s.client_id ? <> (<code className="bg-gray-100 px-1 rounded">{s.client_id}</code>)</> : null}, add this <b>Authorized redirect URI</b>:
            <div className="mt-1 flex items-center gap-2"><code className="flex-1 bg-white border border-gray-200 rounded px-2 py-1 text-[11px] break-all">{s.redirect_uri}</code><button onClick={copy} className="h-7 px-2 text-[11px] border border-gray-300 rounded bg-white hover:bg-gray-50 cursor-pointer">{copied ? 'Copied' : 'Copy'}</button></div>
            <div className="text-gray-500 mt-0.5">Without it Google shows “redirect_uri_mismatch”.</div>
          </li>
          <li>Enable these APIs (APIs &amp; Services → Library): {s.apis.join(', ')}.</li>
          <li>Request Business Profile API access for the project: <a className="text-blue-700 hover:underline" href={s.access_form} target="_blank" rel="noreferrer">access request form</a>. Until Google approves it, sign-in works but listing businesses fails (quota 0).</li>
          <li>OAuth consent screen: add the scope <code className="bg-gray-100 px-1 rounded">business.manage</code>, and while the app is in “Testing”, add the business owner's Google account as a test user.</li>
        </ol>
      )}
    </div>
  );
}

// Find a business from an email address: its website + Google Maps (POST /discover), then add it.
function FindByEmail({ onAdded }) {
  const [q, setQ] = useState({ email: '', name: '', city: '', plan: 'Starter' });
  const [res, setRes] = useState(null);
  const [busy, error, run] = useAction();
  const free = /@(gmail|googlemail|yahoo|outlook|hotmail|live|icloud|rediffmail|rediff|aol|proton|zoho)\./i.test(q.email);
  const find = () => run('find', async () => setRes(await api('/discover', { method: 'POST', body: { email: q.email.trim(), name: q.name, city: q.city } })));
  const add = (c, i) => run(`add${i}`, async () => {
    const b = await api('/discover/import', { method: 'POST', body: { email: q.email.trim(), candidate: c, plan: q.plan } });
    await refreshBusinesses();
    onAdded([b], `${b.name} ${b.created ? 'added' : 'updated'}${b.imported_reviews ? `, ${b.imported_reviews} reviews imported` : ''}: the full audit is running`);
  });
  return (
    <div>
      <p className="text-[13px] text-gray-600 mb-3">Enter the business's email. Its website is read for the name, phone, address and map pin, and Google Maps is searched for the real listing (rating, reviews, category, hours). You pick the match; it's added and audited automatically.</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="md:col-span-3"><Field label="Business email"><input className={inputCls} placeholder="info@yourbusiness.in" value={q.email} onChange={e => setQ({ ...q, email: e.target.value })} onKeyDown={e => e.key === 'Enter' && q.email.includes('@') && find()} /></Field></div>
        <Field label={free ? 'Business name (needed for Gmail-type addresses)' : 'Business name (optional)'}><input className={inputCls} value={q.name} onChange={e => setQ({ ...q, name: e.target.value })} /></Field>
        <Field label="City (optional)"><input className={inputCls} value={q.city} onChange={e => setQ({ ...q, city: e.target.value })} placeholder="Pune" /></Field>
        <Field label="Plan"><select className={inputCls} value={q.plan} onChange={e => setQ({ ...q, plan: e.target.value })}>{['Starter', 'Growth', 'Pro', 'Agency'].map(p => <option key={p}>{p}</option>)}</select></Field>
      </div>
      <Button className="mt-3" variant="primary" icon={Search} busy={busy === 'find'} disabled={!q.email.includes('@') || (free && !q.name.trim())} onClick={find}>Find business</Button>
      <ErrorNote>{error}</ErrorNote>
      {res && (
        <div className="mt-4">
          {(res.notes || []).map(n => <div key={n} className="mb-2 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">{n}</div>)}
          {res.candidates.length === 0 ? <div className="py-4 text-center text-[13px] text-gray-500">No business found. Add the business name and city, or use “Add by hand”.</div> : (
            <div className="border border-gray-200 rounded divide-y divide-gray-100">
              {res.candidates.map((c, i) => (
                <div key={`${c.source}-${c.place_id || i}`} className="flex items-start gap-3 px-3 py-2.5">
                  <span className={`w-8 h-8 rounded flex items-center justify-center shrink-0 ${c.source === 'google_maps' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{c.source === 'google_maps' ? <MapPin size={15} /> : <Globe size={15} />}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><span className="text-[13px] font-medium text-gray-900">{c.name}</span>{c.confidence === 'high' && <StatusPill level="good">Best match</StatusPill>}<Badge tone="gray">{c.source === 'google_maps' ? 'Google Maps' : 'Website'}</Badge></div>
                    <div className="text-[12px] text-gray-600 mt-0.5">{[c.category, c.address].filter(Boolean).join(' · ') || 'No address found'}</div>
                    <div className="text-[12px] text-gray-500 mt-0.5 flex flex-wrap gap-x-3">
                      {c.phone && <span>{c.phone}</span>}
                      {c.website && <span>{c.website.replace(/^https?:\/\//, '')}</span>}
                      {c.rating != null && <span className="inline-flex items-center gap-0.5"><Star size={11} className="text-amber-500 fill-amber-500" /> {c.rating}{c.review_count != null ? ` (${c.review_count})` : ''}</span>}
                      <span className="text-gray-400">matched by {c.match}</span>
                    </div>
                  </div>
                  <Button size="sm" variant="primary" busy={busy === `add${i}`} onClick={() => add(c, i)}>Add & audit</Button>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-gray-500 mt-2 flex items-center gap-1"><ShieldCheck size={12} /> Public data, read-only. To post and reply on Google, also connect the owner's Google account.</p>
        </div>
      )}
    </div>
  );
}

export function ConnectModal({ open, onClose, onAdded, initialMode = 'find' }) {
  const [mode, setMode] = useState(initialMode);
  const [pickFor, setPickFor] = useState(null);
  const conns = useApi(open ? '/connections' : null);
  const setup = useApi(open ? '/connections/google/setup' : null);
  const [busy, error, run, setError] = useAction();
  const [form, setForm] = useState({ name: '', primary_category: '', phone: '', website: '', address: '', area: '', city: '' });
  const [mail, setMail] = useState({ from_addr: '', subject: '', body: '' });
  useEffect(() => { if (open) { setMode(initialMode); setPickFor(null); setError(''); } }, [open, initialMode, setError]);

  const startGoogle = () => run('google', async () => {
    const { url } = await api('/connections/google/start');
    window.location.href = url;
  });
  const create = () => run('create', async () => {
    const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim()));
    const b = await api('/businesses', { method: 'POST', body });
    await refreshBusinesses();
    onAdded([b]);
  });
  const sendMail = () => run('mail', async () => {
    await api('/intake/emails', { method: 'POST', body: mail });
    onAdded([], 'The email is being processed: watch it on the Automation Pipeline page.');
  });

  return (
    <Modal open={open} onClose={onClose} width="max-w-2xl" title="Add businesses">
      {!pickFor && (
        <div className="flex gap-1 mb-4">
          {[['find', 'Business email', AtSign], ['google', 'Google account', Plug], ['email', 'Onboarding email', Mail], ['manual', 'Add by hand', Plus]].map(([m, l, I]) => (
            <button key={m} onClick={() => { setMode(m); setError(''); }} className={`flex-1 h-9 flex items-center justify-center gap-1.5 text-[13px] rounded border cursor-pointer ${mode === m ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-300 text-gray-700'}`}><I size={14} />{l}</button>
          ))}
        </div>
      )}

      {pickFor && <LocationPicker connectionId={pickFor} onImported={(out) => onAdded(out)} />}

      {!pickFor && mode === 'find' && <FindByEmail onAdded={onAdded} />}

      {!pickFor && mode === 'google' && (
        <div>
          <p className="text-[13px] text-gray-600 mb-3">Sign in with the Google account that owns or manages the Business Profile. Every business under it is listed, and you pick which to add; each is synced and audited.</p>
          <Button variant="primary" icon={Plug} busy={busy === 'google'} disabled={setup.data && !setup.data.configured} onClick={startGoogle}>Sign in with Google</Button>
          <p className="text-[11px] text-gray-500 mt-2 flex items-center gap-1"><ShieldCheck size={12} /> Sign-in happens on Google's page; we never see the password. Nothing changes on Google without approval.</p>
          {/* Open until the first account connects: Google rejects sign-in until the redirect URI is registered. */}
          {setup.data && <GoogleSetup s={setup.data} open={!setup.data.configured || !(conns.data || []).some(c => c.status === 'active')} />}
          {(conns.data || []).filter(c => c.status === 'active').length > 0 && (
            <div className="mt-5">
              <div className="text-[12px] text-gray-500 mb-1.5">Already connected</div>
              <div className="border border-gray-200 rounded divide-y divide-gray-100">
                {conns.data.filter(c => c.status === 'active').map(c => (
                  <div key={c.id} className="flex items-center gap-3 px-3 py-2">
                    <Mail size={14} className="text-gray-400" />
                    <span className="flex-1 text-[13px] text-gray-900">{c.email} <span className="text-gray-500 text-[12px]">· {c.businesses} added</span></span>
                    <Button size="sm" onClick={() => setPickFor(c.id)}>Choose businesses</Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!pickFor && mode === 'email' && (
        <div className="space-y-3">
          <p className="text-[13px] text-gray-600">Paste a new client's onboarding email. The AI extracts the business, and the pipeline audits it and creates its schedule. (Emails forwarded to the onboarding mailbox are picked up automatically.)</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="From (your team's address)"><input className={inputCls} value={mail.from_addr} onChange={e => setMail({ ...mail, from_addr: e.target.value })} placeholder="sales@codigixinfotech.com" /></Field>
            <Field label="Subject"><input className={inputCls} value={mail.subject} onChange={e => setMail({ ...mail, subject: e.target.value })} placeholder="New client onboarding: …" /></Field>
          </div>
          <Field label="Email text"><textarea rows={8} className={areaCls} value={mail.body} onChange={e => setMail({ ...mail, body: e.target.value })} placeholder={'Business: …\nWebsite: …\nPhone: …\nAddress: …\nPackage: Growth'} /></Field>
          <Button variant="primary" icon={ArrowRight} busy={busy === 'mail'} disabled={!mail.from_addr || !mail.body.trim()} onClick={sendMail}>Process email</Button>
        </div>
      )}

      {!pickFor && mode === 'manual' && (
        <div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[['name', 'Business name *'], ['primary_category', 'Primary category'], ['phone', 'Phone'], ['website', 'Website'], ['address', 'Address'], ['area', 'Area'], ['city', 'City']].map(([k, l]) => (
              <Field key={k} label={l}><input className={inputCls} value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} /></Field>
            ))}
          </div>
          <Button className="mt-3" variant="primary" icon={Plus} busy={busy === 'create'} disabled={!form.name.trim()} onClick={create}>Add business</Button>
        </div>
      )}
      <ErrorNote>{error}</ErrorNote>
    </Modal>
  );
}

// Connected accounts across the top of GBP Manager.
export function ConnectionsBar({ onConnect, toast }) {
  const conns = useApi('/connections');
  const [busy, error, run] = useAction();
  const active = (conns.data || []).filter(c => c.status === 'active');
  if (!active.length) return null;
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2 bg-white border border-gray-200 rounded px-3 py-2">
        <span className="text-[12px] text-gray-500 mr-1">Connected:</span>
        {active.map(c => (
          <span key={c.id} className="inline-flex items-center gap-1.5 h-7 pl-2 pr-1 rounded border border-gray-200 bg-gray-50 text-[12px] text-gray-800">
            <Mail size={12} className="text-gray-500" /> {c.email}
            <span className="text-gray-500">· {c.businesses} business{c.businesses === 1 ? '' : 'es'} · synced {c.last_sync_at ? fmtDateTime(c.last_sync_at) : 'never'}</span>
            {c.last_error && <span title={c.last_error} className="text-red-600">⚠</span>}
            <button title="Sync now" onClick={() => run(`s${c.id}`, async () => { const r = await api(`/connections/${c.id}/sync`, { method: 'POST' }); toast(`Synced ${r.synced} business${r.synced === 1 ? '' : 'es'}${r.failed.length ? `, ${r.failed.length} failed` : ''}`); conns.reload(true); })} className="p-1 rounded hover:bg-gray-200 text-gray-500 cursor-pointer">
              <RefreshCw size={12} className={busy === `s${c.id}` ? 'animate-spin' : ''} />
            </button>
            <button title="Disconnect" onClick={() => { if (window.confirm(`Disconnect ${c.email}? Its businesses stay, but stop syncing.`)) run(`d${c.id}`, async () => { await api(`/connections/${c.id}`, { method: 'DELETE' }); conns.reload(true); }); }} className="p-1 rounded hover:bg-gray-200 text-gray-500 cursor-pointer"><X size={12} /></button>
          </span>
        ))}
        <Button size="sm" icon={Plug} className="ml-auto" onClick={onConnect}>Add businesses</Button>
      </div>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}

export function ConnectEmptyState({ onConnect }) {
  return (
    <Card>
      <div className="py-8 text-center max-w-xl mx-auto">
        <span className="w-12 h-12 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center mx-auto mb-3"><Store size={22} /></span>
        <h2 className="text-lg font-semibold text-gray-900">Link this business to its Google profile</h2>
        <p className="text-[13px] text-gray-600 mt-1">Sign in with the email that owns or manages the Business Profile. Reviews, photos and daily insights then sync automatically, and approved posts and replies go live on Google.</p>
        <div className="mt-5"><Button variant="primary" icon={Plug} onClick={onConnect}>Connect Google account</Button></div>
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
          {[['1', 'Sign in with Google', 'The account that owns the profile'], ['2', 'Pick the businesses', 'All its locations are listed'], ['3', 'Automatic sync + audit', 'Reviews, insights, score']].map(([n, t, d]) => (
            <div key={n} className="p-3 rounded border border-gray-200"><div className="w-6 h-6 rounded-full bg-gray-900 text-white text-[12px] flex items-center justify-center mb-2">{n}</div><div className="text-[13px] font-medium text-gray-900">{t}</div><div className="text-[12px] text-gray-500">{d}</div></div>
          ))}
        </div>
      </div>
    </Card>
  );
}

export function ImportDone({ businesses }) {
  return (
    <div className="flex items-center gap-2 text-[13px] text-emerald-800"><CheckCircle2 size={16} /> Added {businesses.length}: {businesses.map(b => b.name).join(', ')}</div>
  );
}
