import React, { useEffect, useMemo, useState } from 'react';
import {
  Mail, Plug, RefreshCw, X, MapPin, Loader2, CheckCircle2, XCircle, AlertTriangle, Clock, ShieldAlert, ShieldCheck, Ban, UserX, ExternalLink,
  Copy, Check, Store, Search, PencilLine, Plus, Star, Globe, ChevronDown, ChevronRight, Info
} from 'lucide-react';
import { Card, Button, ErrorNote, useAction, refreshBusinesses } from './SeoUi';
import { api, useApi, fmtDateTime } from './seoApi';

/**
 * Finding a business's Google listings from its email (no setup): the email's website and Google
 * Maps give every listing with its public status (open / closed, rating, reviews). Signing in with
 * the owner's Google account is optional and adds what only the owner can see (verification, replies).
 */

export const VERIFY = {
  verified: { label: 'Verified', icon: ShieldCheck, tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  pending: { label: 'Verification pending', icon: Clock, tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
  unverified: { label: 'Not verified', icon: AlertTriangle, tone: 'bg-orange-50 text-orange-700 ring-orange-200' },
  suspended: { label: 'Suspended', icon: Ban, tone: 'bg-red-50 text-red-700 ring-red-200' },
  disabled: { label: 'Disabled', icon: XCircle, tone: 'bg-red-50 text-red-700 ring-red-200' },
  conflict: { label: 'Ownership conflict', icon: UserX, tone: 'bg-red-50 text-red-700 ring-red-200' },
  unknown: { label: 'Status unknown', icon: ShieldAlert, tone: 'bg-slate-50 text-slate-600 ring-slate-200' }
};
const OPEN = {
  open: { label: 'Open', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  closed_temporarily: { label: 'Temporarily closed', tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
  closed_permanently: { label: 'Permanently closed', tone: 'bg-red-50 text-red-700 ring-red-200' }
};
const ROLE = { PRIMARY_OWNER: 'Primary owner', OWNER: 'Owner', MANAGER: 'Manager', SITE_MANAGER: 'Site manager' };
const NEEDS_ACTION = new Set(['pending', 'unverified', 'suspended', 'disabled', 'conflict']);
const FREE_MAIL = /@(gmail|googlemail|yahoo|outlook|hotmail|live|icloud|rediffmail|rediff|aol|proton|zoho)\./i;

export function VerifyPill({ state }) {
  const v = VERIFY[state] || VERIFY.unknown;
  return <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md ring-1 ring-inset whitespace-nowrap ${v.tone}`}><v.icon size={11} /> {v.label}</span>;
}
function OpenPill({ status }) {
  const o = OPEN[status];
  return o ? <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ring-1 ring-inset whitespace-nowrap ${o.tone}`}>{o.label}</span> : null;
}
function Flag({ children, tone = 'bg-slate-50 text-slate-600 ring-slate-200', title }) {
  return <span title={title} className={`text-[11px] font-medium px-1.5 py-0.5 rounded ring-1 ring-inset whitespace-nowrap ${tone}`}>{children}</span>;
}
function Rating({ rating, count }) {
  if (rating == null) return null;
  return <span className="inline-flex items-center gap-0.5 text-[12px] text-slate-700"><Star size={11} className="text-amber-500 fill-amber-500" /> {rating}{count != null && <span className="text-slate-400">({count.toLocaleString('en-IN')})</span>}</span>;
}
function CopyLink({ url, label }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={() => navigator.clipboard?.writeText(url).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}
      className="inline-flex items-center gap-1 text-[11.5px] font-medium text-indigo-700 hover:underline cursor-pointer">{done ? <Check size={11} /> : <Copy size={11} />}{done ? 'Copied' : label}</button>
  );
}
const needsAction = (l) => NEEDS_ACTION.has(l.verification) || (l.gbp_status?.open_status || '').startsWith('closed') || l.duplicate_listing;

/* ── Find by email (no setup) ─────────────────────────────────────────── */

function FindByEmail({ business, onOpenBusiness, toast }) {
  const [q, setQ] = useState({ email: business?.contact_email || '', name: '', city: '' });
  const [res, setRes] = useState(null);
  const [busy, error, run] = useAction();
  const free = FREE_MAIL.test(q.email);
  const ready = q.email.includes('@') && (!free || q.name.trim());
  useEffect(() => { setQ(x => ({ ...x, email: x.email || business?.contact_email || '' })); }, [business?.contact_email]);

  const find = () => run('find', async () => setRes(await api('/discover', { method: 'POST', body: { email: q.email.trim(), name: q.name.trim(), city: q.city.trim() } })));
  const add = (c, i) => run(`add${i}`, async () => {
    const b = await api('/discover/import', { method: 'POST', body: { email: q.email.trim(), candidate: c } });
    await refreshBusinesses();
    setRes(r => ({ ...r, candidates: r.candidates.map((x, n) => (n === i ? { ...x, business_id: b.id } : x)) }));
    toast(`${b.name} ${b.created ? 'added' : 'updated'}${b.imported_reviews ? ` with ${b.imported_reviews} recent reviews` : ''}: the full audit is running`);
  });

  const maps = (res?.candidates || []).filter(c => c.source === 'google_maps');
  const open = maps.filter(c => c.open_status === 'open').length;
  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-end">
        <label className={`${free ? 'md:col-span-5' : 'md:col-span-7'} text-[12px] font-medium text-slate-700`}>Business email
          <div className="relative mt-1"><Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="w-full h-10 pl-9 pr-3 text-[13px] rounded-xl bg-white ring-1 ring-inset ring-slate-200 outline-none focus:ring-indigo-400" placeholder="info@yourbusiness.in" value={q.email} onChange={e => setQ({ ...q, email: e.target.value })} onKeyDown={e => e.key === 'Enter' && ready && find()} aria-label="Business email" /></div>
        </label>
        {free && <label className="md:col-span-3 text-[12px] font-medium text-slate-700">Business name<input className="mt-1 w-full h-10 px-3 text-[13px] rounded-xl bg-white ring-1 ring-inset ring-amber-300 outline-none focus:ring-indigo-400" placeholder="Needed for Gmail-type emails" value={q.name} onChange={e => setQ({ ...q, name: e.target.value })} onKeyDown={e => e.key === 'Enter' && ready && find()} aria-label="Business name" /></label>}
        <label className="md:col-span-2 text-[12px] font-medium text-slate-700">City <span className="text-slate-400 font-normal">(optional)</span><input className="mt-1 w-full h-10 px-3 text-[13px] rounded-xl bg-white ring-1 ring-inset ring-slate-200 outline-none focus:ring-indigo-400" placeholder="Pune" value={q.city} onChange={e => setQ({ ...q, city: e.target.value })} onKeyDown={e => e.key === 'Enter' && ready && find()} aria-label="City" /></label>
        <div className={free ? 'md:col-span-2' : 'md:col-span-3'}><Button className="w-full h-10" variant="primary" icon={Search} busy={busy === 'find'} disabled={!ready} onClick={find}>Find businesses</Button></div>
      </div>
      <ErrorNote>{error}</ErrorNote>

      {res && (
        <div className="mt-4">
          {(res.notes || []).map(n => <div key={n} className="mb-2 text-[12px] text-amber-800 bg-amber-50 ring-1 ring-inset ring-amber-200 rounded-lg px-3 py-1.5">{n}</div>)}
          {res.candidates.length === 0 ? <div className="py-6 text-center text-[13px] text-slate-500">No listing found for {q.email}. Add the business name and city, then search again.</div> : (
            <>
              <div className="text-[12.5px] text-slate-600 mb-2">{maps.length ? <>Found <b>{maps.length}</b> listing{maps.length === 1 ? '' : 's'} on Google Maps for <b>{q.email}</b>: {open} open{maps.length - open ? `, ${maps.length - open} closed or unknown` : ''}.</> : 'Nothing on Google Maps yet; the website gave these details.'}</div>
              <div className="rounded-xl ring-1 ring-inset ring-slate-200 divide-y divide-slate-100 bg-white">
                {res.candidates.map((c, i) => (
                  <div key={`${c.source}-${c.place_id || i}`} className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3 px-4 py-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ring-1 ring-inset ${c.source === 'google_maps' ? 'bg-indigo-50 text-indigo-600 ring-indigo-100' : 'bg-slate-50 text-slate-500 ring-slate-200'}`}>{c.source === 'google_maps' ? <MapPin size={16} /> : <Globe size={16} />}</span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5"><span className="text-[13.5px] font-semibold text-slate-900">{c.name}</span>{c.confidence === 'high' && <Flag tone="bg-emerald-50 text-emerald-700 ring-emerald-200" title={c.match}>Matches this email's business</Flag>}</div>
                        <div className="text-[12px] text-slate-500 truncate">{[c.category, c.address].filter(Boolean).join(' · ') || 'No address found'}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-slate-500"><Rating rating={c.rating} count={c.review_count} />{c.phone && <span>{c.phone}</span>}{c.website && <span className="truncate max-w-[220px]">{c.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>}</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pl-12 md:pl-0">
                      {c.source === 'google_maps' ? <OpenPill status={c.open_status} /> : <Flag>From the website</Flag>}
                      {c.maps_url && <a href={c.maps_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11.5px] font-medium text-indigo-700 hover:underline">Maps <ExternalLink size={10} /></a>}
                      {c.review_url && <CopyLink url={c.review_url} label="Review link" />}
                      {c.business_id ? <Button size="sm" onClick={() => onOpenBusiness(c.business_id)}>Manage</Button>
                        : <Button size="sm" variant="primary" icon={Plus} busy={busy === `add${i}`} onClick={() => add(c, i)}>Add &amp; audit</Button>}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11.5px] text-slate-500 flex items-center gap-1"><Info size={12} /> Public Google Maps data. Verification status, review replies and posting need the owner's Google sign-in below.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Optional: signed-in Google accounts ──────────────────────────────── */

function SetupGuide({ s }) {
  const code = 'bg-slate-100 px-1 rounded font-mono text-[11px]';
  return (
    <ol className="mt-2 space-y-1.5 text-[12px] text-slate-600 list-decimal ml-5">
      <li>Google Cloud → Credentials → OAuth client ID (Web application); add <code className={code}>GOOGLE_CLIENT_ID</code>, <code className={code}>GOOGLE_CLIENT_SECRET</code>{!s.token_key && <> and <code className={code}>TOKEN_ENCRYPTION_KEY</code></>} to <code className={code}>backend/.env</code>.</li>
      <li>Authorized redirect URI: <code className={`${code} break-all`}>{s.redirect_uri}</code></li>
      <li>Enable: {s.apis.join(', ')}; request access with the <a className="text-indigo-700 hover:underline" href={s.access_form} target="_blank" rel="noreferrer">Business Profile API form</a>.</li>
    </ol>
  );
}

function Listings({ connection, onOpenBusiness, toast, onChanged }) {
  const locs = useApi(`/connections/${connection.id}/locations`);
  const [filter, setFilter] = useState('all');
  const [busy, error, run] = useAction();
  const all = locs.data || [];
  const counts = useMemo(() => ({ all: all.length, verified: all.filter(l => l.verification === 'verified').length, attention: all.filter(needsAction).length }), [all]);
  const shown = all.filter(l => filter === 'all' || (filter === 'verified' ? l.verification === 'verified' : needsAction(l)));
  const add = (l) => run(`i${l.gbp_location}`, async () => {
    const out = await api(`/connections/${connection.id}/import`, { method: 'POST', body: { locations: [l.gbp_location] } });
    await refreshBusinesses(); locs.reload(true); onChanged(); toast(`${out[0]?.name || 'Business'} added: synced and audited`);
  });
  if (locs.loading && !locs.data) return <div className="py-6 flex items-center justify-center gap-2 text-[13px] text-slate-500"><Loader2 size={15} className="animate-spin" /> Reading every business on {connection.email}…</div>;
  if (locs.error) return <div className="rounded-xl bg-red-50 ring-1 ring-inset ring-red-200 px-4 py-3 text-[13px] text-red-800">{locs.error.message} <Button size="sm" className="ml-2" icon={RefreshCw} onClick={() => locs.reload(true)}>Try again</Button></div>;
  if (!all.length) return <div className="py-5 text-center text-[13px] text-slate-600">{connection.email} doesn't own or manage any Business Profile.</div>;
  const chip = (id, label, n) => <button key={id} type="button" onClick={() => setFilter(id)} className={`h-8 px-3 rounded-lg text-[12px] font-semibold ring-1 ring-inset cursor-pointer ${filter === id ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'}`}>{label} <span className="opacity-60">{n}</span></button>;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-2">{chip('all', 'All', counts.all)}{chip('verified', 'Verified', counts.verified)}{chip('attention', 'Needs attention', counts.attention)}<Button size="sm" className="ml-auto" icon={RefreshCw} busy={locs.loading} onClick={() => locs.reload(true)}>Refresh</Button></div>
      <div className="rounded-xl ring-1 ring-inset ring-slate-200 divide-y divide-slate-100 bg-white">
        {shown.map(l => {
          const st = l.gbp_status || {};
          return (
            <div key={l.gbp_location} className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-semibold text-slate-900">{l.name}</div>
                <div className="text-[12px] text-slate-500 truncate">{l.address || 'Service-area business'}</div>
                <div className="text-[11.5px] text-slate-400">{[l.primary_category, ROLE[l.account_role] || l.account_role, st.account_name].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span title={st.verification_text}><VerifyPill state={l.verification} /></span><OpenPill status={st.open_status} />
                {l.duplicate_listing && <Flag tone="bg-amber-50 text-amber-700 ring-amber-200">Duplicate</Flag>}{st.pending_edits && <Flag>Edits pending</Flag>}{st.google_updated && <Flag tone="bg-sky-50 text-sky-700 ring-sky-200">Google updates</Flag>}
                {st.maps_url && <a href={st.maps_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11.5px] font-medium text-indigo-700 hover:underline">Maps <ExternalLink size={10} /></a>}
                {l.imported ? <Button size="sm" onClick={() => onOpenBusiness(l.business_id)}>Manage</Button> : <Button size="sm" variant="primary" icon={Plus} busy={busy === `i${l.gbp_location}`} onClick={() => add(l)}>Add</Button>}
              </div>
            </div>
          );
        })}
      </div>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}

function GoogleSignIn({ onOpenBusiness, toast, initialAccount }) {
  const setup = useApi('/connections/google/setup');
  const conns = useApi('/connections');
  const [current, setCurrent] = useState(initialAccount);
  const [showSetup, setShowSetup] = useState(false);
  const [busy, error, run] = useAction();
  const active = (conns.data || []).filter(c => c.status === 'active');
  const conn = active.find(c => c.id === current) || active[0];
  const s = setup.data;
  const connect = () => {
    if (!s?.configured) { setShowSetup(true); return; }
    run('connect', async () => { const { url } = await api('/connections/google/start'); window.location.href = url; });
  };
  const sync = (c) => run(`s${c.id}`, async () => { const r = await api(`/connections/${c.id}/sync`, { method: 'POST' }); toast(`Synced ${r.synced} business${r.synced === 1 ? '' : 'es'} from Google`); conns.reload(true); await refreshBusinesses(); });
  const disconnect = (c) => { if (window.confirm(`Disconnect ${c.email}? Its businesses stay here but stop syncing with Google.`)) run(`d${c.id}`, async () => { await api(`/connections/${c.id}`, { method: 'DELETE' }); conns.reload(true); }); };
  if (!s || !conns.data) return null;
  return (
    <div className="mt-5 pt-4 border-t border-slate-100">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[240px]">
          <div className="text-[13px] font-semibold text-slate-900">{active.length ? 'Signed-in Google accounts' : 'Owner sign-in (optional)'}</div>
          <div className="text-[12px] text-slate-500">{active.length ? 'Every listing on these accounts, with verification status from Google.' : 'The owner signs in with the same Google account to unlock verification status, review replies and posting.'}</div>
        </div>
        <Button size="sm" icon={Plug} busy={busy === 'connect'} onClick={connect}>{active.length ? 'Sign in another account' : 'Sign in with Google'}</Button>
      </div>
      {showSetup && !s.configured && (
        <div className="mt-3 rounded-xl bg-slate-50 ring-1 ring-inset ring-slate-200 px-4 py-3">
          <div className="flex items-start justify-between gap-2"><div className="text-[12.5px] text-slate-700"><b>Google sign-in isn't switched on for this platform yet.</b> Finding businesses by email above works without it. Turning it on is a one-time task for whoever runs the platform:</div><button type="button" onClick={() => setShowSetup(false)} className="text-slate-400 hover:text-slate-700 cursor-pointer" aria-label="Close"><X size={14} /></button></div>
          <SetupGuide s={s} />
        </div>
      )}
      <ErrorNote>{error}</ErrorNote>
      {active.length > 0 && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            {active.map(c => (
              <div key={c.id} role="button" tabIndex={0} onClick={() => setCurrent(c.id)} onKeyDown={e => e.key === 'Enter' && setCurrent(c.id)} className={`flex items-center gap-2 rounded-xl px-3 py-2 ring-1 ring-inset cursor-pointer ${conn?.id === c.id ? 'bg-indigo-50 ring-indigo-200' : 'bg-white ring-slate-200 hover:bg-slate-50'}`}>
                <Mail size={13} className="text-slate-400" />
                <div><div className="text-[12.5px] font-semibold text-slate-900">{c.email}{c.last_error && <AlertTriangle size={12} className="inline ml-1 text-red-500" />}</div><div className="text-[11px] text-slate-500">{c.businesses} added · synced {c.last_sync_at ? fmtDateTime(c.last_sync_at) : 'never'}</div></div>
                <button type="button" title="Sync" onClick={e => { e.stopPropagation(); sync(c); }} className="p-1.5 rounded-lg hover:bg-white text-slate-500 cursor-pointer" aria-label={`Sync ${c.email}`}><RefreshCw size={13} className={busy === `s${c.id}` ? 'animate-spin' : ''} /></button>
                <button type="button" title="Disconnect" onClick={e => { e.stopPropagation(); disconnect(c); }} className="p-1.5 rounded-lg hover:bg-white text-slate-400 hover:text-red-600 cursor-pointer" aria-label={`Disconnect ${c.email}`}><X size={13} /></button>
              </div>
            ))}
          </div>
          {conn && <Listings key={conn.id} connection={conn} onOpenBusiness={onOpenBusiness} toast={toast} onChanged={() => conns.reload(true)} />}
        </div>
      )}
    </div>
  );
}

/** Top of GBP Manager: find the business's listings by email; optional owner sign-in. */
export function GbpAccounts({ business, onOpenBusiness, onOtherWays, toast, initialAccount = null }) {
  return (
    <Card title="Find businesses on Google" subtitle="Type the email registered on the Business Profile. Its listings on Google Maps appear with their live status: no setup needed."
      action={<Button size="sm" onClick={onOtherWays}>Other ways to add</Button>}>
      <FindByEmail business={business} onOpenBusiness={onOpenBusiness} toast={toast} />
      <GoogleSignIn onOpenBusiness={onOpenBusiness} toast={toast} initialAccount={initialAccount} />
    </Card>
  );
}

/** The selected business's live state on Google, at the top of its tabs. */
export function ListingStatus({ b, toast, onFind }) {
  const [busy, error, run] = useAction();
  const st = b.gbp_status || {};
  const signedIn = Boolean(b.gbp_location && b.connection_id);
  const refreshOwner = () => run('sync', async () => {
    const r = await api(`/businesses/${b.id}/sync`, { method: 'POST' });
    await refreshBusinesses();
    toast(`Refreshed from Google: ${(VERIFY[r.verification] || VERIFY.unknown).label.toLowerCase()}, ${r.reviews} reviews, ${r.photos} photos`);
  });
  const refreshMaps = () => run('maps', async () => {
    const r = await api(`/businesses/${b.id}/maps-refresh`, { method: 'POST' });
    await refreshBusinesses();
    toast(`Refreshed from Google Maps: ${(OPEN[r.open_status] || { label: 'status unknown' }).label.toLowerCase()}${r.rating ? `, ${r.rating}★ from ${r.review_count} reviews` : ''}`);
  });

  if (!signedIn && !b.place_id) {
    return (
      <div className="ai-glass-card rounded-2xl px-5 py-4 flex flex-wrap items-center gap-4">
        <span className="w-10 h-10 rounded-xl bg-slate-50 ring-1 ring-inset ring-slate-200 text-slate-500 flex items-center justify-center"><Store size={18} /></span>
        <div className="flex-1 min-w-[220px]">
          <div className="text-[14px] font-semibold text-slate-900">{b.name} isn't matched to a Google listing yet</div>
          <div className="text-[12.5px] text-slate-500">Find it by its email above to pull its Google Maps listing, rating, reviews and open status.</div>
        </div>
        <Button variant="primary" icon={Search} onClick={onFind}>Find by email</Button>
      </div>
    );
  }
  const v = signedIn ? (VERIFY[b.verification] || VERIFY.unknown) : null;
  return (
    <div className="ai-glass-card rounded-2xl px-5 py-4">
      <div className="flex flex-wrap items-center gap-4">
        <span className={`w-10 h-10 rounded-xl flex items-center justify-center ring-1 ring-inset ${v ? v.tone : 'bg-indigo-50 text-indigo-600 ring-indigo-100'}`}>{v ? <v.icon size={18} /> : <MapPin size={18} />}</span>
        <div className="flex-1 min-w-[240px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold text-slate-900">{signedIn ? 'On Google' : 'On Google Maps'}</span>
            {signedIn && <VerifyPill state={b.verification} />}
            <OpenPill status={st.open_status} />
            <Rating rating={b.rating} count={b.review_count} />
            {b.duplicate_listing && <Flag tone="bg-amber-50 text-amber-700 ring-amber-200">Duplicate</Flag>}{st.pending_edits && <Flag>Edits pending</Flag>}{st.google_updated && <Flag tone="bg-sky-50 text-sky-700 ring-sky-200">Google updates</Flag>}
          </div>
          <div className="text-[12.5px] text-slate-600 mt-0.5">{signedIn ? (st.verification_text || 'Refresh to read the latest status from Google.') : 'Public listing data from Google Maps. The owner can sign in with Google (optional) to show verification status and reply to reviews.'}</div>
          <div className="text-[11.5px] text-slate-400 mt-0.5">{[st.account_name, ROLE[st.account_role] || st.account_role, st.checked_at ? `checked ${fmtDateTime(st.checked_at)}` : null].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {st.maps_url && <a href={st.maps_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-indigo-700 hover:underline">View on Maps <ExternalLink size={11} /></a>}
          {st.review_url && <CopyLink url={st.review_url} label="Copy review link" />}
          {signedIn && <a href="https://business.google.com/locations" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-slate-600 hover:underline"><PencilLine size={11} /> Business Profile</a>}
          {signedIn ? <Button size="sm" icon={RefreshCw} busy={busy === 'sync'} onClick={refreshOwner}>Refresh from Google</Button>
            : <Button size="sm" icon={RefreshCw} busy={busy === 'maps'} onClick={refreshMaps}>Refresh from Google Maps</Button>}
        </div>
      </div>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}
