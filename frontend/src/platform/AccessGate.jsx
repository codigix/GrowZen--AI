import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, Lock, PlugZap, RefreshCw, ExternalLink, Link2, ShieldCheck } from 'lucide-react';
import { Card, Button, Badge, ErrorNote, Sk, useModulePath, refreshBusinesses } from './SeoUi';
import { api, useApi } from './seoApi';

/**
 * The access checklist of a project (GET /businesses/{id}/access-status): what must be in place before its website traffic (kind 'website')
 * or its Google Business Profile data (kind 'gmb') is shown. <AccessGate> shows the data only when every step is done, otherwise the
 * checklist with a button for each open step. The server refuses the same data with a 409 until then, so this is never the only guard.
 */

const inflight = new Map(); // one request per project and kind at a time, however many components ask

function fetchAccess(id, kind, force) {
  const key = `${id}:${kind}`;
  if (!force && inflight.has(key)) return inflight.get(key);
  const p = api(`/businesses/${id}/access-status?kind=${kind}${force ? '&refresh=true' : ''}`).finally(() => setTimeout(() => inflight.delete(key), 1500));
  inflight.set(key, p);
  return p;
}

/** { data, loading, error, recheck }: the checklist of one project for one kind, re-read when the tab gets focus again while it is incomplete. */
export function useAccess(b, kind) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const seq = useRef(0);
  const load = useCallback(async (force = false) => {
    if (!b?.id) return;
    const mine = ++seq.current;
    if (force) setState(s => ({ ...s, loading: true }));
    try {
      const data = await fetchAccess(b.id, kind, force);
      if (mine === seq.current) setState({ data, loading: false, error: null });
    } catch (e) {
      if (mine === seq.current) setState(s => ({ ...s, loading: false, error: e }));
    }
  }, [b?.id, kind]);
  useEffect(() => { setState({ data: null, loading: true, error: null }); load(); }, [load, b?.gbp_location, b?.connection_id, b?.website]);
  const incomplete = state.data && !state.data[kind]?.complete;
  useEffect(() => {
    if (!incomplete) return undefined;
    const on = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [incomplete, load]);
  return { ...state, recheck: () => load(true), complete: Boolean(state.data?.[kind]?.complete) };
}

/** The project's Google Business Profile data (GET /gbp/live) once its access is complete; until then only what the checklist knows about the account. */
export function useGbpLive(b) {
  const access = useAccess(b, 'gmb');
  const live = useApi(access.complete ? `/businesses/${b.id}/gbp/live` : null);
  if (access.complete) return live;
  const c = access.data?.connection;
  const data = access.data ? { linked: Boolean(b.gbp_location && c), connection: c ? { ...c, name: null, last_sync_at: null, last_error: null } : null, verification: b.verification, status: {}, profile: { logo: b.logo, account: null }, metrics: {}, live: null, locked: true } : null;
  return { data, error: access.error, loading: access.loading, reload: () => access.recheck(), setData: () => {} };
}

const TONE = { ok: 'text-emerald-600', missing: 'text-amber-600', blocked: 'text-slate-300' };

function StepRow({ s, n, b, onChanged }) {
  const navigate = useNavigate();
  const path = useModulePath();
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState('');
  const go = async (fn, tag = 'x') => { setBusy(tag); setErr(''); try { await fn(); } catch (e) { setErr(e.message || 'That did not work.'); } finally { setBusy(null); } };
  const redirect = (url) => { window.location.href = url; };
  const fix = s.fix;
  const act = {
    edit_project: () => navigate(`${path('gmb-profile')}?tab=profile&sub=edit`),
    connect_gbp: () => navigate(`${path('gmb-profile')}?connect=1`),
    reconnect_google: () => go(async () => redirect((await api('/connections/google/start?purpose=gbp')).url), 'go'),
    grant_business: () => go(async () => redirect((await api('/connections/google/start?purpose=gbp')).url), 'go'),
    grant_search_console: () => go(async () => redirect((await api('/connections/google/start?purpose=gsc')).url), 'go'),
    grant_analytics: () => go(async () => redirect((await api(`/analytics/ga4/start${fix?.email ? `?email=${encodeURIComponent(fix.email)}` : ''}`)).url), 'go'),
    open_ga4: () => window.open(fix.url, '_blank', 'noopener'),
    open_search_console: () => window.open(fix.url, '_blank', 'noopener'),
    recheck: () => onChanged(true),
    link_account: () => go(async () => redirect((await api('/connections/google/start?purpose=gbp')).url), 'go')
  }[fix?.action];
  const link = (c) => go(async () => { await api(`/businesses/${b.id}/seo/link-account`, { method: 'POST', body: { connection_id: c.id } }); await refreshBusinesses(); onChanged(true); }, `l${c.id}`);
  const options = (fix?.options || []).filter(o => o.status === 'active' || fix.action === 'link_account');
  const Icon = s.status === 'ok' ? CheckCircle2 : s.status === 'blocked' ? Lock : Circle;
  return (
    <li className={`flex gap-3 py-3.5 ${s.status === 'blocked' ? 'opacity-60' : ''}`}>
      <span className={`mt-0.5 shrink-0 ${TONE[s.status]}`}><Icon size={19} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-13.5 font-semibold text-slate-900">{n}. {s.label}</span>
          <Badge tone={s.status === 'ok' ? 'green' : s.status === 'missing' ? 'amber' : 'gray'}>{s.status === 'ok' ? 'Done' : s.status === 'missing' ? 'To do' : 'Waiting'}</Badge>
          {s.warning && s.status === 'ok' && <Badge tone="amber">Check the listing</Badge>}
        </div>
        <p className="text-12.5 text-slate-600 mt-0.5 leading-relaxed">{s.detail}</p>
        {s.status === 'missing' && fix && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {fix.action === 'link_account' && options.map(o => (
              <Button key={o.id} size="sm" icon={Link2} busy={busy === `l${o.id}`} onClick={() => link(o)} title={o.status !== 'active' ? 'This account is disconnected: reconnect it first' : undefined} disabled={o.status !== 'active'}>Link {o.email}</Button>
            ))}
            {fix.action !== 'link_account' && fix.action !== 'recheck' && options.length > 0 && fix.action !== 'reconnect_google' && options.filter(o => o.email !== fix.email).map(o => (
              <Button key={o.id} size="sm" icon={Link2} busy={busy === `l${o.id}`} onClick={() => link(o)}>Use {o.email}</Button>
            ))}
            {act && <Button size="sm" variant={fix.action === 'link_account' && options.length ? undefined : 'primary'} icon={fix.url ? ExternalLink : fix.action === 'recheck' ? RefreshCw : PlugZap} busy={busy === 'go'} onClick={act}>{fix.action === 'link_account' ? 'Connect another Google account' : fix.label}</Button>}
          </div>
        )}
        {err && <p className="text-12 text-rose-600 mt-1.5">{err}</p>}
      </div>
    </li>
  );
}

export function AccessChecklist({ b, kind, access, title }) {
  const d = access.data;
  const steps = (d?.steps || []).filter(s => s.needs.includes(kind));
  const done = steps.filter(s => s.status === 'ok').length;
  const label = kind === 'website' ? 'website traffic' : 'Google Business Profile data';
  return (
    <Card title={title || `Finish the access steps for ${b.name}`}
      subtitle={`${label[0].toUpperCase()}${label.slice(1)} is shown only after every step below is done, and only for this project${b.website ? ` (${b.website.replace(/^https?:\/\//, '').replace(/\/$/, '')})` : ''}.`}
      action={<Button size="sm" icon={RefreshCw} busy={access.loading} onClick={access.recheck}>Check again</Button>}>
      <div className="flex items-center gap-3 mb-1">
        <div className="h-1.5 flex-1 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${steps.length ? (done / steps.length) * 100 : 0}%` }} /></div>
        <span className="text-12 font-semibold text-slate-600 tabular-nums">{done} of {steps.length} done</span>
      </div>
      <ul className="divide-y divide-slate-100">{steps.map((s, i) => <StepRow key={s.id} s={s} n={i + 1} b={b} onChanged={access.recheck} />)}</ul>
      <p className="text-12 text-slate-500 mt-2 flex items-center gap-1.5"><ShieldCheck size={14} className="text-slate-400" />Read-only access. Nothing is changed on Google, and no other project's data is mixed in.</p>
    </Card>
  );
}

/** Shows `children` (the data) only when the project's access for `kind` ('website' | 'gmb') is complete; otherwise the checklist. */
export default function AccessGate({ b, kind, title, children }) {
  const access = useAccess(b, kind);
  if (access.error && !access.data) return <ErrorNote>{access.error.message}</ErrorNote>;
  if (!access.data) return <div className="ai-glass-card rounded p-5 space-y-3"><Sk w="w-56" h="h-5" /><Sk w="w-full" h="h-4" /><Sk w="w-3/4" h="h-4" /><Sk w="w-2/3" h="h-4" /></div>;
  if (!access.complete) return <AccessChecklist b={b} kind={kind} access={access} title={title} />;
  return <>{typeof children === 'function' ? children(access) : children}</>;
}
