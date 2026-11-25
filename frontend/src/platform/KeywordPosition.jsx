import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDown, ArrowRight, ArrowUp, Check, CheckCircle2, XCircle, ChevronDown, ExternalLink, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { Button, ErrorNote, useAction, useToast } from './SeoUi';
import { api, useApi } from './seoApi';

const kfmt = (n) => (n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K` : String(Math.round(n)));
const RANGES = [['28 days', 28], ['3 months', 90], ['6 months', 180]];
const TABS = ['Overview', 'SERP Features', 'Competitors', 'Pages', 'Progress'];
const METRICS = [['position', 'Position', '#2563eb'], ['clicks', 'Clicks', '#059669'], ['impressions', 'Impressions', '#7c3aed'], ['ctr', 'Click rate', '#d97706']];
const Card = ({ title, subtitle, children, className = '', action, pad = true }) => (
  <div className={`rounded-xl bg-white ring-1 ring-slate-200 ${className}`}>
    {(title || action) && <div className={`flex items-start gap-3 ${pad ? 'px-4 pt-4' : 'px-4 pt-4 pb-3'}`}><div className="min-w-0"><h3 className="text-15 font-semibold text-slate-900">{title}</h3>{subtitle && <p className="text-12 text-slate-500 mt-0.5">{subtitle}</p>}</div><div className="ml-auto shrink-0">{action}</div></div>}
    <div className={pad ? 'p-4' : ''}>{children}</div>
  </div>
);
const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const pct = (n) => (n == null ? '—' : `${n}%`);
const shortDay = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const dayName = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const cc = { IND: 'India', USA: 'United States', GBR: 'United Kingdom', CAN: 'Canada', AUS: 'Australia', ARE: 'United Arab Emirates', SGP: 'Singapore', DEU: 'Germany', FRA: 'France', PAK: 'Pakistan', BGD: 'Bangladesh', NPL: 'Nepal', LKA: 'Sri Lanka', SAU: 'Saudi Arabia' };

function Delta({ now, before }) {
  if (!now || !before || now === before) return null;
  const up = now < before; // a lower number is a better position
  return <span className={`inline-flex items-center text-13 font-semibold ${up ? 'text-emerald-600' : 'text-rose-600'}`}>{up ? <ArrowUp size={13} /> : <ArrowDown size={13} />}{Math.abs(now - before)}</span>;
}

/** A change against the period before: `good` says which direction is better (a lower position is better, more clicks is better). */
function Change({ now, before, kind = 'pct', good = 'up', unit = '' }) {
  if (now == null || before == null || before === 0 && kind === 'pct') return <span className="text-12 text-slate-400">{before == null || before === 0 ? 'no data in the period before' : ''}</span>;
  const diff = kind === 'pct' ? Math.round(((now - before) * 1000) / before) / 10 : Math.round((now - before) * 10) / 10;
  if (diff === 0) return <span className="text-12 text-slate-500">no change</span>;
  const better = good === 'up' ? diff > 0 : diff < 0;
  return <span className={`inline-flex items-center gap-0.5 text-12.5 font-semibold ${better ? 'text-emerald-600' : 'text-rose-600'}`}>{diff > 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}{Math.abs(diff)}{kind === 'pct' ? '%' : unit}<span className="font-normal text-slate-500 ml-1">vs before</span></span>;
}

function Growth({ label, value, change, series, color, tip, hint }) {
  const data = (series || []).map((v, i) => ({ i, v }));
  return (
    <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4 min-w-0 flex flex-col" title={tip}>
      <div className="text-13 text-slate-500">{label}</div>
      <div className="mt-0.5 text-28 font-bold text-slate-900 tabular-nums leading-tight">{value}</div>
      <div className="mt-0.5 min-h-[18px]">{change}</div>
      <div className="h-9 -mx-1 mt-2">{data.filter(x => x.v != null).length > 1 ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={data}><Area type="monotone" dataKey="v" stroke={color} fill={color} fillOpacity={0.12} strokeWidth={1.5} isAnimationActive={false} connectNulls /></AreaChart></ResponsiveContainer> : <div className="text-11.5 text-slate-400 pt-2">{hint || 'Too few days with data for a trend'}</div>}</div>
    </div>
  );
}

function Table({ head, rows, empty }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-13">
        <thead><tr className="text-12 text-slate-500 bg-slate-50/70">{head.map(([h, right], i) => <th key={h} className={`px-4 py-2 font-medium whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">{rows.length ? rows : <tr><td colSpan={head.length} className="px-4 py-8 text-center text-slate-500">{empty}</td></tr>}</tbody>
      </table>
    </div>
  );
}

/** Search Console's own daily figures for this search over the chosen period, one metric at a time. Days without a figure are left out of the position line. */
function Performance({ days, metric, setMetric, range, setRange, from, to }) {
  const m = METRICS.find(x => x[0] === metric);
  const data = useMemo(() => {
    const by = new Map(days.map(x => [x.day, x]));
    const out = [];
    for (let d = new Date(`${from}T00:00:00`); d <= new Date(`${to}T00:00:00`); d.setDate(d.getDate() + 1)) {
      const k = d.toISOString().slice(0, 10), r = by.get(k);
      out.push({ day: k, position: r && r.impressions ? r.position : null, clicks: r ? r.clicks : 0, impressions: r ? r.impressions : 0, ctr: r && r.impressions ? r.ctr : null });
    }
    return out;
  }, [days, from, to]);
  const has = data.some(x => x.impressions > 0);
  const maxPos = Math.max(10, ...data.map(x => x.position || 0));
  const top = Math.ceil((maxPos + 1) / 5) * 5;
  const ticks = [1, ...Array.from({ length: top / 5 }, (_, i) => (i + 1) * 5)];
  return (
    <Card title="Performance on Google" subtitle={`Search Console, ${dayName(from)} to ${dayName(to)}. Position is the average on the days the site was shown.`}
      action={<div className="flex gap-1">{RANGES.map(([l, d]) => <button key={l} type="button" aria-pressed={range === d} onClick={() => setRange(d)} className={`px-2.5 h-7 rounded text-12.5 font-medium cursor-pointer ${range === d ? 'bg-indigo-50 text-indigo-700 underline underline-offset-4' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}</div>}>
      <div className="flex flex-wrap gap-1.5 mb-3">{METRICS.map(([k, l, c]) => <button key={k} type="button" aria-pressed={metric === k} onClick={() => setMetric(k)} className={`h-8 px-3 rounded-full text-12.5 font-semibold cursor-pointer ring-1 ring-inset ${metric === k ? 'text-white ring-transparent' : 'text-slate-600 ring-slate-300 hover:bg-slate-50'}`} style={metric === k ? { background: c } : undefined}>{l}</button>)}</div>
      {!has ? <p className="text-13 text-slate-500 py-12 text-center">Search Console has no impressions for this search in this period. It appears here as soon as Google shows your site for it.</p> : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ left: 0, right: 12, top: 8 }}>
              <defs><linearGradient id="kpg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={m[2]} stopOpacity={0.25} /><stop offset="100%" stopColor={m[2]} stopOpacity={0.02} /></linearGradient></defs>
              <CartesianGrid stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={shortDay} minTickGap={36} />
              {metric === 'position' ? <YAxis reversed domain={[1, top]} ticks={ticks} interval={0} tick={{ fontSize: 11, fill: '#64748b' }} width={32} allowDecimals={false} /> : <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} width={36} domain={[0, (mx) => Math.max(mx, metric === 'ctr' ? 5 : 3)]} />}
              <Tooltip formatter={(v) => [v == null ? 'not shown that day' : metric === 'position' ? `#${v}` : metric === 'ctr' ? `${v}%` : v, m[1]]} labelFormatter={dayName} />
              <Area type="monotone" dataKey={metric} stroke={m[2]} strokeWidth={2} fill="url(#kpg)" connectNulls dot={{ r: 3.5, fill: m[2], stroke: '#fff', strokeWidth: 1.5 }} activeDot={{ r: 5.5 }} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

const DEVICES = [['desktop', 'Desktop'], ['mobile', 'Mobile'], ['tablet', 'Tablet']];
const Lbl = ({ children }) => <div className="text-13 font-semibold text-slate-800 mb-1">{children}</div>;
const selCls = 'h-10 rounded-lg ring-1 ring-inset ring-slate-300 bg-white px-3 text-13 text-slate-800 cursor-pointer';

/** The place Google is asked from: search Google Maps places inside the project's country, or go back to the project's own area. */
function LocationPick({ b, value, country, custom, onPick }) {
  const [typed, setTyped] = useState('');
  const [found, setFound] = useState([]);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  const search = (v) => {
    setTyped(v); setErr('');
    if (v.trim().length < 2) { setFound([]); return; }
    api(`/businesses/${b.id}/keyword-workspace/area-search?q=${encodeURIComponent(v.trim())}&country=${country || 'IN'}`).then(r => setFound(r.results || [])).catch(e => setErr(e.message || 'The map service did not answer.'));
  };
  const choose = (v) => { setOpen(false); setTyped(''); setFound([]); onPick(v); };
  return (
    <div className="relative">
      <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(o => !o)} className={`${selCls} w-full min-w-[220px] max-w-[320px] flex items-center gap-2 text-left`}><span className="truncate flex-1">{value || 'Choose a location'}</span><ChevronDown size={14} className="text-slate-400 shrink-0" /></button>
      {open && (
        <div className="absolute z-30 mt-1 w-[340px] rounded-lg bg-white shadow-lg ring-1 ring-slate-200 p-2">
          <div className="relative"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" /><input autoFocus value={typed} onChange={e => search(e.target.value)} placeholder="Search a city or area" aria-label="Search a location" className="h-9 w-full rounded ring-1 ring-inset ring-slate-300 pl-8 pr-2 text-13" /></div>
          {err && <div className="mt-1 text-12 text-rose-600">{err}</div>}
          <ul role="listbox" className="mt-1 max-h-60 overflow-y-auto">
            {found.map(x => <li key={x.label}><button type="button" role="option" onClick={() => choose(x.label)} className="w-full text-left px-2 py-1.5 rounded text-13 hover:bg-slate-50 cursor-pointer">{x.label}</button></li>)}
            {typed.trim().length >= 2 && !found.length && !err && <li className="px-2 py-1.5 text-12.5 text-slate-500">No place found.</li>}
          </ul>
          {custom && <button type="button" onClick={() => choose('')} className="mt-1 w-full text-left px-2 py-1.5 rounded text-13 text-indigo-600 hover:bg-indigo-50 cursor-pointer">Use the project's own area again</button>}
        </div>
      )}
    </div>
  );
}

export default function KeywordPosition({ b, keyword }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState('Overview');
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const q = encodeURIComponent(keyword);
  const rep = useApi(`/businesses/${b.id}/seo/keyword-position?keyword=${q}&days=365`);
  const serp = useApi(`/businesses/${b.id}/seo/keyword-position/serp?keyword=${q}`);
  const tracked = useApi(`/businesses/${b.id}/keywords`);
  const [range, setRange] = useState(90);
  const [metric, setMetric] = useState('position');
  const [showAllPages, setShowAllPages] = useState(false);
  const gsc = useApi(`/businesses/${b.id}/seo/keyword-position/search-console?keyword=${q}&days=${range}`);
  const list = (tracked.data?.keywords || []).map(k => k.keyword);
  const d = rep.data;
  const s = d?.summary || {};
  const series = d?.series || [];

  const T = d?.targeting || {};
  const setTarget = (patch) => run('target', async () => {
    await api(`/businesses/${b.id}/seo/track-targeting`, { method: 'PUT', body: { location: 'location' in patch ? patch.location : (T.custom ? T.location : ''), device: patch.device || T.device || 'desktop', language: patch.language || T.language || 'en' } });
    await rep.reload(true); serp.reload(true);
    toast('Targeting saved: the competitors and SERP features are read for it');
  });
  const update = () => run('update', async () => {
    await api(`/businesses/${b.id}/seo/check-ranks`, { method: 'POST', body: { keywords: [keyword] }, timeout: 120000 });
    await rep.reload(true); serp.reload(true); gsc.reload(true);
    toast(`Position of “${keyword}” updated from Google Search Console`);
  });
  const go = (k) => navigate(k ? `/rank-tracking/landscape?kw=${encodeURIComponent(k)}` : '/rank-tracking/landscape');
  const organic = serp.data?.organic || [];
  const mine = organic.find(o => o.mine);
  const features = Object.entries(serp.data?.features || {});
  const P = d?.project || {};
  const devPos = (d?.devices || {})[T.device || 'desktop']?.position;
  const st = P.status;
  const cur = series[series.length - 1] || {};
  const onFeatures = features.filter(([, on]) => on).length;
  const G = gsc.data?.state === 'ok' ? gsc.data : null;
  const gdays = (G?.series || []).filter(x => x.impressions > 0);
  const now = G?.now || {}, before = G?.before || {};
  const imp = G ? now.impressions : st?.impressions, clk = G ? now.clicks : st?.clicks;
  const ctr = G ? now.ctr : (imp ? Math.round(((clk || 0) * 1000) / imp) / 10 : null);
  const daily = (key) => (G?.series || []).map(x => (key === 'position' || key === 'ctr' ? (x.impressions ? x[key] : null) : x[key]));
  const counts = { 'SERP Features': serp.data?.state === 'ok' ? onFeatures : null, Competitors: serp.data?.state === 'ok' ? organic.length : null, Pages: G ? G.pages.length : null, Progress: G ? gdays.length : series.length };
  const rivals = (P.competitors || []).map(x => x.replace(/^www\./, ''));
  const rivalRows = rivals.map(dom => ({ dom, hit: organic.find(o => (o.site || '').replace(/^www\./, '') === dom) }));
  const TONE = { working: 'bg-emerald-50 text-emerald-800 ring-emerald-200', climbing: 'bg-sky-50 text-sky-800 ring-sky-200', weak: 'bg-amber-50 text-amber-800 ring-amber-200', invisible: 'bg-rose-50 text-rose-800 ring-rose-200', unchecked: 'bg-slate-50 text-slate-700 ring-slate-200' };
  const AREA = { website: 'Website pages', meta: 'Titles and descriptions', gbp_profile: 'Google Business Profile', blog: 'Blog', gmb_post: 'Google posts', aeo: 'AI answers (AEO)', geo: 'GEO', chatgpt: 'ChatGPT' };
  const used = st?.used_in || [];
  const checks = st ? [
    { label: 'Ranking on Google', ok: !!s.current, note: s.current ? `Average position ${now.position ?? s.current} (page ${Math.ceil((now.position ?? s.current) / 10)}), ${num(imp)} impression${imp === 1 ? '' : 's'} and ${num(clk)} click${clk === 1 ? '' : 's'} in ${range} days` : 'Google has not shown your site for this search yet', to: '/keyword-management/use', act: 'Use it' },
    { label: 'Target page chosen', ok: !!st.target_url, note: st.target_url || 'No page is set to rank for it, so it can compete with your other pages', to: '/keyword-management/mapping', act: 'Map it' },
    { label: 'Website pages carry it', ok: (P.pages || []).length > 0 || used.includes('website'), note: (P.pages || []).length ? `${P.pages.length} page${P.pages.length === 1 ? '' : 's'} with it in the title, heading or description` : 'No page has it yet', to: '/keyword-management/use', act: 'Add it' },
    { label: 'Titles and descriptions', ok: used.includes('meta'), note: used.includes('meta') ? 'Used in page titles or descriptions' : 'Not used in any title or description', to: '/website-audit?tab=report', act: 'Check' },
    { label: 'Google Business Profile', ok: used.includes('gbp_profile'), note: used.includes('gbp_profile') ? 'Used in your Business Profile' : 'Not in your Business Profile text', to: '/gmb-profile/profile', act: 'Add it' },
    { label: 'Blog article', ok: (st.articles || 0) > 0, note: st.articles ? `${st.articles} article${st.articles === 1 ? '' : 's'} written for it` : 'No article written for it yet', to: '/ai-content-generation/blog', act: 'Write one' },
    { label: 'Google posts', ok: used.includes('gmb_post'), note: used.includes('gmb_post') ? 'Used in your Google posts' : 'Not used in a Google post', to: '/google-posts', act: 'Post' },
    { label: 'AI answers', ok: ['aeo', 'geo', 'chatgpt'].some(a => used.includes(a)), note: ['aeo', 'geo', 'chatgpt'].some(a => used.includes(a)) ? 'Planned or used for AI answer engines' : 'Not planned for AI answers (AEO, GEO, ChatGPT)', to: '/keyword-management/use', act: 'Plan it' },
  ] : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-13 text-slate-600">
        <span>Targeting: <b className="text-blue-700">{T.location || '—'}</b> · <b className="text-slate-800">{(DEVICES.find(x => x[0] === T.device) || DEVICES[0])[1]}</b> · <b className="text-slate-800">{(T.languages || {})[(T.language || 'en').slice(0, 2)] || 'English'}</b></span><span>Search engine: <b className="text-slate-800">Google</b></span>
        <span>Last update: <b className="text-slate-800">{d?.last_update ? new Date(d.last_update).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'not read yet'}</b></span>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl bg-white ring-1 ring-slate-200 p-3">
        <label className="flex-1 min-w-[240px]"><div className="text-13 font-semibold text-slate-800 mb-1">Keyword</div>
          <div className="flex items-center gap-2 h-10 rounded-lg ring-1 ring-inset ring-slate-300 px-2">
            <span className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1 rounded bg-slate-100 text-13 font-medium">{keyword}<button type="button" aria-label="Back to all keywords" onClick={() => go('')} className="p-0.5 hover:bg-slate-200 rounded cursor-pointer"><X size={12} /></button></span>
            <select aria-label="Choose another tracked keyword" value="" onChange={e => e.target.value && go(e.target.value)} className="ml-auto h-8 text-13 bg-transparent text-slate-500 cursor-pointer max-w-[40%]"><option value="">Switch keyword…</option>{list.filter(k => k !== keyword).map(k => <option key={k} value={k}>{k}</option>)}</select>
          </div>
        </label>
        <div><div className="text-13 font-semibold text-slate-800 mb-1">Search engine</div><div className="h-10 px-3 inline-flex items-center rounded-lg ring-1 ring-inset ring-slate-300 text-13">Google</div></div>
        <div><Lbl>Location</Lbl><LocationPick b={b} value={T.location} country={T.country} custom={T.custom} onPick={(v) => setTarget({ location: v })} /></div>
        <div><Lbl>Device</Lbl><select aria-label="Device" value={T.device || 'desktop'} onChange={e => setTarget({ device: e.target.value })} className={selCls}>{DEVICES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div><Lbl>Language</Lbl><select aria-label="Language" value={(T.language || 'en').slice(0, 2)} onChange={e => setTarget({ language: e.target.value })} className={selCls}>{Object.entries(T.languages || { en: 'English' }).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <Button variant="primary" icon={RefreshCw} busy={busy === 'update'} onClick={update}>Update report</Button>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {serp.data?.location && serp.data.location_applied === false && <p className="text-12.5 text-amber-700">Google's results could not be read for “{serp.data.location}” right now, so the competitors shown are for the whole country.</p>}
      <p className="text-12 text-slate-500">Your own position comes from Search Console (your whole country, split by device). The location and language change the competitors and SERP features read from Google.</p>
      {rep.error && <ErrorNote>{rep.error.message}</ErrorNote>}

      <div className="flex gap-6 border-b border-slate-200" role="tablist">{TABS.map(t => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`-mb-px pb-2.5 text-14 font-medium border-b-2 cursor-pointer ${tab === t ? 'border-indigo-600 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{t}{counts[t] != null && <span className={`ml-1.5 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-11 font-semibold ${tab === t ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>{counts[t]}</span>}</button>)}</div>

      {!d ? <div className="flex items-center justify-center gap-2 py-14 text-13 text-slate-500"><Loader2 size={16} className="animate-spin" />Reading the position history…</div> : !d.tracked ? (
        <Card>
          <p className="text-13 text-slate-600">“{keyword}” is not in your saved keywords, so there is no position history for it yet.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" busy={busy === 'track'} onClick={() => run('track', async () => {
              await api(`/businesses/${b.id}/keywords`, { method: 'POST', body: [{ keyword, source: { type: 'position_tracking' } }] });
              await api(`/businesses/${b.id}/seo/check-ranks`, { method: 'POST', body: { keywords: [keyword] }, timeout: 120000 }).catch(() => null);
              await rep.reload(true);
              toast(`“${keyword}” is now tracked`);
            })}>Track this keyword now</Button>
            <Link to={`/keyword-management/prepare?k=${q}`}><Button>Prepare it first (role, priority, wordings)</Button></Link>
          </div>
        </Card>
      ) : (
        <>
          {tab === 'Overview' && (
            <>
              <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden">
                {st ? (
                  <>
                    <div className={`px-5 py-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b ${TONE[st.status] || TONE.unchecked}`}>
                      <div className="min-w-0 flex-1">
                        <div className="text-12 font-semibold uppercase tracking-wide opacity-75">Status for your project</div>
                        <div className="text-20 font-bold leading-tight">{st.label}</div>
                        <p className="text-13 mt-0.5 opacity-90">{st.why}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {[st.cluster, P.role === 'primary' ? 'Primary' : P.role === 'secondary' ? 'Secondary' : null, P.priority && `${P.priority} priority`].filter(Boolean).map(c => <span key={c} className="px-2.5 py-1 rounded-full bg-white/70 text-12 font-semibold capitalize">{c}</span>)}
                        {st.next && <Link to={st.next.to} className="inline-flex items-center gap-1 h-9 px-3.5 rounded-lg bg-slate-900 text-white text-13 font-semibold hover:bg-slate-800">{st.next.text} <ArrowRight size={14} /></Link>}
                      </div>
                    </div>
                    <div className="grid lg:grid-cols-2 lg:divide-x divide-slate-100">
                      <div className="p-5">
                        <div className="text-13 font-semibold text-slate-800 mb-2">Is this keyword working for you?</div>
                        <ul className="space-y-2.5">
                          {checks.map(c => (
                            <li key={c.label} className="flex items-start gap-2.5">
                              {c.ok ? <CheckCircle2 size={18} className="text-emerald-500 shrink-0 mt-px" /> : <XCircle size={18} className="text-slate-300 shrink-0 mt-px" />}
                              <div className="min-w-0 flex-1"><div className={`text-13.5 font-medium ${c.ok ? 'text-slate-900' : 'text-slate-500'}`}>{c.label}</div><div className="text-12.5 text-slate-500 break-words">{c.note}</div></div>
                              {!c.ok && c.to && <Link to={c.to} className="shrink-0 text-12.5 font-semibold text-indigo-600 hover:underline">{c.act}</Link>}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="p-5">
                        <div className="flex items-baseline gap-2 mb-2"><div className="text-13 font-semibold text-slate-800">Pages of your website that carry it</div><span className="text-12 text-slate-500">{(P.pages || []).length} found</span></div>
                        {P.crawled === false ? <p className="text-13 text-slate-500">Your website has not been crawled yet, so pages cannot be listed. <Link className="text-indigo-600 underline" to="/website-audit">Run the website audit</Link>.</p>
                          : !(P.pages || []).length ? <p className="text-13 text-amber-700">No page has this keyword in its title, heading or description. Add it to the page you want to rank.</p> : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-13">
                                <thead><tr className="text-12 text-slate-500"><th className="text-left font-medium pb-1.5">Page</th>{['Title', 'Heading', 'Description'].map(h => <th key={h} className="font-medium pb-1.5 px-2 text-center">{h}</th>)}</tr></thead>
                                <tbody className="divide-y divide-slate-100">
                                  {(showAllPages ? P.pages : P.pages.slice(0, 5)).map(pg => (
                                    <tr key={pg.url}>
                                      <td className="py-2 pr-2 max-w-[260px]"><a href={pg.url} target="_blank" rel="noreferrer" title={pg.url} className="text-blue-700 hover:underline break-all">{pg.path}</a></td>
                                      {['title', 'heading', 'description'].map(w => <td key={w} className="py-2 px-2 text-center">{pg.in.includes(w) ? <Check size={15} className="inline text-emerald-600" /> : <span className="text-slate-300">–</span>}</td>)}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {P.pages.length > 5 && <button type="button" onClick={() => setShowAllPages(v => !v)} className="mt-2 text-12.5 font-semibold text-indigo-600 hover:underline cursor-pointer">{showAllPages ? 'Show fewer' : `Show all ${P.pages.length}`}</button>}
                            </div>
                          )}
                      </div>
                    </div>
                  </>
                ) : <p className="p-5 text-13 text-slate-500">No status yet: press Update report to read the position.</p>}
              </div>
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                <Growth label="Average position" value={now.position != null ? `#${now.position}` : s.current ? `#${s.current}` : '—'} color="#2563eb" series={daily('position')} change={<Change now={now.position} before={before.position} kind="abs" good="down" />} tip={`Search Console average position over the last ${range} days, weighted by impressions`} />
                <Growth label="Clicks" value={num(clk)} color="#059669" series={daily('clicks')} change={<Change now={now.clicks} before={before.clicks} />} tip={`Clicks from Google to your site for this search in the last ${range} days`} />
                <Growth label="Impressions" value={num(imp)} color="#7c3aed" series={daily('impressions')} change={<Change now={now.impressions} before={before.impressions} />} tip={`Times your site was shown for this search in the last ${range} days`} />
                <Growth label="Click rate" value={pct(ctr)} color="#d97706" series={daily('ctr')} change={<Change now={now.ctr} before={before.ctr} kind="abs" good="up" unit=" pts" />} tip="Clicks divided by impressions" />
                <Growth label="Searches a month" value={kfmt(d.volume)} color="#64748b" series={[]} hint={d.cpc != null ? `Cost per click ₹${d.cpc}${d.intent ? ` · ${d.intent} intent` : ''}` : 'Google Keyword Planner'} change={<span className="text-12 text-slate-500">Google Keyword Planner</span>} tip="Average monthly searches in your country" />
              </div>
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                {[['Maps position', cur.maps_rank ? `#${cur.maps_rank}` : '—', cur.maps_rank ? 'in the local pack results' : 'not in the Maps results'],
                  ['Desktop position', (d.devices || {}).desktop?.position ? `#${Math.round(d.devices.desktop.position)}` : '—', (d.devices || {}).desktop ? `${num(d.devices.desktop.impressions)} impression${d.devices.desktop.impressions === 1 ? '' : 's'}` : 'no impressions'],
                  ['Mobile position', (d.devices || {}).mobile?.position ? `#${Math.round(d.devices.mobile.position)}` : '—', (d.devices || {}).mobile ? `${num(d.devices.mobile.impressions)} impression${d.devices.mobile.impressions === 1 ? '' : 's'}` : 'no impressions'],
                  ['Visibility', d.visibility != null ? `${d.visibility}%` : '—', 'estimate from the average click curve'],
                  ['Estimated traffic', d.traffic != null ? `${num(d.traffic)} / mo` : '—', 'estimate: searches × click share at this position']].map(([l, v, sub]) => (
                  <div key={l} className="rounded-xl bg-white ring-1 ring-slate-200 px-4 py-3"><div className="text-12.5 text-slate-500">{l}</div><div className="text-22 font-bold text-slate-900 tabular-nums leading-tight">{v}</div><div className="text-12 text-slate-500 mt-0.5">{sub}</div></div>
                ))}
                <div className="rounded-xl bg-white ring-1 ring-slate-200 px-4 py-3"><div className="text-12.5 text-slate-500">SERP features{serp.data?.state === 'ok' && <span className="ml-1.5 font-semibold text-slate-800">{onFeatures} of {features.length}</span>}</div>
                  {serp.data?.state === 'ok' ? <div className="mt-1.5 flex flex-wrap gap-1.5">{features.filter(([, on]) => on).map(([n]) => <span key={n} className="px-2 py-0.5 rounded bg-indigo-50 text-12 text-indigo-800">{n}</span>)}{!onFeatures && <span className="text-13 text-slate-400">None on this search</span>}</div> : serp.data?.state === 'error' ? <div className="mt-1 text-12 text-slate-400">Not read</div> : <Loader2 size={14} className="animate-spin text-slate-400 mt-2" />}
                </div>
              </div>
              {gsc.data?.state === 'error' && <ErrorNote>{gsc.data.message}</ErrorNote>}
              {G ? <Performance days={G.series} metric={metric} setMetric={setMetric} range={range} setRange={setRange} from={G.from} to={G.to} /> : <Card><div className="flex items-center justify-center gap-2 py-12 text-13 text-slate-500"><Loader2 size={16} className="animate-spin" />Reading Search Console…</div></Card>}
              {G && (
                <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
                  <Card pad={false} title="Pages ranking for it" subtitle="Your pages Google showed for this search" action={<button type="button" onClick={() => setTab('Pages')} className="text-12.5 text-indigo-600 hover:underline cursor-pointer">All</button>}>
                    <Table head={[['Page'], ['Clicks', 1], ['Impressions', 1], ['Click rate', 1], ['Avg position', 1]]} empty="No page of your site was shown for this search in this period."
                      rows={G.pages.slice(0, 6).map(r => <tr key={r.page}><td className="px-4 py-2.5 max-w-[360px]"><a href={r.page} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline break-all">{r.page.replace(/^https?:\/\/(www\.)?/, '')}</a></td><td className="px-4 py-2.5 text-right tabular-nums">{num(r.clicks)}</td><td className="px-4 py-2.5 text-right tabular-nums">{num(r.impressions)}</td><td className="px-4 py-2.5 text-right tabular-nums">{pct(r.ctr)}</td><td className="px-4 py-2.5 text-right tabular-nums font-medium">#{r.position}</td></tr>)} />
                  </Card>
                  <div className="space-y-4">
                    <Card pad={false} title="By device">
                      <Table head={[['Device'], ['Clicks', 1], ['Impr.', 1], ['Pos.', 1]]} empty="No device data."
                        rows={G.devices.map(r => <tr key={r.device}><td className="px-4 py-2.5 capitalize">{r.device}</td><td className="px-4 py-2.5 text-right tabular-nums">{num(r.clicks)}</td><td className="px-4 py-2.5 text-right tabular-nums">{num(r.impressions)}</td><td className="px-4 py-2.5 text-right tabular-nums font-medium">#{r.position}</td></tr>)} />
                    </Card>
                    <Card pad={false} title="By country">
                      <Table head={[['Country'], ['Clicks', 1], ['Impr.', 1], ['Pos.', 1]]} empty="No country data."
                        rows={G.countries.slice(0, 5).map(r => <tr key={r.country}><td className="px-4 py-2.5">{cc[r.country] || r.country}</td><td className="px-4 py-2.5 text-right tabular-nums">{num(r.clicks)}</td><td className="px-4 py-2.5 text-right tabular-nums">{num(r.impressions)}</td><td className="px-4 py-2.5 text-right tabular-nums font-medium">#{r.position}</td></tr>)} />
                    </Card>
                  </div>
                </div>
              )}
              <div className="grid gap-4 lg:grid-cols-3">
                <Card title="Keyword Position Summary"><table className="w-full text-13"><tbody className="divide-y divide-slate-100">
                  {[['Current Position', s.current, <Delta key="d" now={s.current} before={s.previous} />], ['Previous Position', s.previous], ['Best Position', s.best], ['Worst Position', s.worst], ['Average Position', s.average]].map(([l, v, x]) => <tr key={l}><td className="py-2 text-slate-600">{l}</td><td className="py-2 text-right font-semibold tabular-nums">{v ?? '—'} {x}</td></tr>)}
                </tbody></table>{s.checks < 2 && <p className="mt-2 text-12 text-slate-400">Only {s.checks} check so far: previous, best and worst fill in as positions are read over time.</p>}</Card>
                <Card title="You and your competitors" action={<button type="button" onClick={() => setTab('Competitors')} className="text-12.5 text-indigo-600 hover:underline cursor-pointer">Top 10</button>}>
                  {serp.data?.state === 'ok' ? <table className="w-full text-13"><thead><tr className="text-12 text-slate-500"><th className="text-left font-medium pb-1">Domain</th><th className="text-right font-medium pb-1">Position</th></tr></thead><tbody className="divide-y divide-slate-100">
                    <tr className="bg-emerald-50/60"><td className="py-1.5 font-medium">{(b.website || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') || 'Your site'} <span className="text-11 font-semibold text-emerald-700">You</span></td><td className="py-1.5 text-right tabular-nums">{mine ? mine.position : s.current ? `#${s.current} (28-day avg)` : 'Not in top 10'}</td></tr>
                    {rivalRows.map(r => <tr key={r.dom}><td className="py-1.5">{r.hit ? <a href={r.hit.url} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">{r.dom}</a> : r.dom}</td><td className="py-1.5 text-right tabular-nums">{r.hit ? r.hit.position : <span className="text-slate-400">Not in top 10</span>}</td></tr>)}
                    {!rivalRows.length && <tr><td colSpan={2} className="py-2 text-slate-500">No competitors saved. <Link className="text-indigo-600 underline" to="/competitor-finder">Find them</Link></td></tr>}</tbody></table>
                    : serp.data?.state === 'error' ? <p className="text-13 text-slate-500">{serp.data.message}</p> : <div className="flex items-center gap-2 text-13 text-slate-400"><Loader2 size={14} className="animate-spin" />Reading Google's results…</div>}
                </Card>
                <Card title="SERP Result Preview">
                  {d.url ? <div><div className="text-12 text-slate-500 truncate">{d.url}</div><a href={d.url} target="_blank" rel="noreferrer" className="text-16 text-blue-700 hover:underline">{(mine && mine.title) || d.url.replace(/^https?:\/\//, '')}</a>{mine?.description && <p className="text-13 text-slate-600 mt-1">{mine.description}</p>}
                    {s.current ? <div className="mt-3 inline-flex items-center gap-1.5 rounded bg-emerald-50 text-emerald-800 text-13 px-2.5 py-1.5 ring-1 ring-emerald-200"><CheckCircle2 size={14} />Your page is ranking at position {s.current}</div> : <div className="mt-3 text-13 text-slate-500">Not ranking yet.</div>}</div>
                    : <p className="text-13 text-slate-500">No page of your site has shown for this keyword in Search Console yet.</p>}
                </Card>
              </div>
            </>
          )}
          {tab === 'SERP Features' && <Card title="SERP Features on this search" action={<span className="text-12 text-slate-400">Read live from Google</span>}>{serp.data?.state === 'ok' ? <ul className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">{features.map(([n, on]) => <li key={n} className={`rounded-lg px-3 py-2 text-13 ring-1 ${on ? 'bg-indigo-50 ring-indigo-200 text-indigo-900' : 'bg-white ring-slate-200 text-slate-400'}`}>{n}<div className="text-11.5">{on ? 'On this search' : 'Not shown'}</div></li>)}</ul> : <p className="text-13 text-slate-500">{serp.data?.message || 'Reading Google…'}</p>}{serp.data?.state === 'ok' && <p className="mt-3 text-13 text-slate-600">Ads: {serp.data.ads} · People also ask: {serp.data.questions}</p>}</Card>}
          {tab === 'Competitors' && <Card title="Top 10 on Google right now" action={<span className="text-12 text-slate-400">Your competitors are marked</span>}>{serp.data?.state === 'ok' ? <table className="w-full text-13"><thead><tr className="text-12 text-slate-500"><th className="text-left py-1.5 w-14">Position</th><th className="text-left">Page</th><th className="text-left">Domain</th></tr></thead><tbody className="divide-y divide-slate-100">{organic.map(o => <tr key={o.url} className={o.mine ? 'bg-emerald-50/60' : ''}><td className="py-2 tabular-nums">{o.position}</td><td className="py-2 max-w-[420px]"><a href={o.url} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline inline-flex items-center gap-1 truncate">{o.title || o.url}<ExternalLink size={11} /></a></td><td className="py-2">{o.site}{o.mine && <span className="ml-2 text-11 font-semibold text-emerald-700">You</span>}{rivals.includes((o.site || '').replace(/^www\./, '')) && <span className="ml-2 text-11 font-semibold text-rose-700">Your competitor</span>}</td></tr>)}</tbody></table> : <p className="text-13 text-slate-500">{serp.data?.message || 'Reading Google…'}</p>}{serp.data?.state === 'ok' && !mine && <p className="mt-3 text-13 text-slate-500">Your site is not in Google's top 10 for this search.</p>}</Card>}
          {tab === 'Pages' && (
            <div className="space-y-4">
              <Card pad={false} title="Pages that ranked for this search" subtitle={G ? `Search Console, ${dayName(G.from)} to ${dayName(G.to)}` : ''}>
                {G ? <Table head={[['Page'], ['Clicks', 1], ['Impressions', 1], ['Click rate', 1], ['Avg position', 1]]} empty="No page of your site was shown for this search in this period."
                  rows={G.pages.map(r => <tr key={r.page}><td className="px-4 py-2.5 max-w-[520px]"><a href={r.page} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline break-all">{r.page}</a></td><td className="px-4 py-2.5 text-right tabular-nums">{num(r.clicks)}</td><td className="px-4 py-2.5 text-right tabular-nums">{num(r.impressions)}</td><td className="px-4 py-2.5 text-right tabular-nums">{pct(r.ctr)}</td><td className="px-4 py-2.5 text-right tabular-nums font-medium">#{r.position}</td></tr>)} /> : <div className="px-4 pb-4 text-13 text-slate-500">{gsc.data?.message || 'Reading Search Console…'}</div>}
              </Card>
              <Card pad={false} title="Pages of your website that carry the keyword" subtitle="From the last website crawl: the keyword is in the page's title, heading or description">
                <Table head={[['Page'], ['Where it appears']]} empty={P.crawled === false ? 'Your website has not been crawled yet.' : 'No page carries this keyword yet. Add it to the page you want to rank.'}
                  rows={(P.pages || []).map(pg => <tr key={pg.url}><td className="px-4 py-2.5"><a href={pg.url} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline break-all">{pg.url}</a></td><td className="px-4 py-2.5 text-slate-600 capitalize">{pg.in.join(', ')}</td></tr>)} />
              </Card>
            </div>
          )}
          {tab === 'Progress' && (
            <Card pad={false} title="Day by day" subtitle={G ? `Search Console, the days Google showed your site for this search (${gdays.length} of ${G.series.length || 0} days)` : ''}>
              {G ? <Table head={[['Date'], ['Position', 1], ['Impressions', 1], ['Clicks', 1], ['Click rate', 1]]} empty="No impressions for this search in this period."
                rows={[...gdays].reverse().map(x => <tr key={x.day}><td className="px-4 py-2.5">{dayName(x.day)}</td><td className="px-4 py-2.5 text-right tabular-nums font-medium">#{x.position}</td><td className="px-4 py-2.5 text-right tabular-nums">{num(x.impressions)}</td><td className="px-4 py-2.5 text-right tabular-nums">{num(x.clicks)}</td><td className="px-4 py-2.5 text-right tabular-nums">{pct(x.ctr)}</td></tr>)} /> : <div className="px-4 pb-4 text-13 text-slate-500">{gsc.data?.message || 'Reading Search Console…'}</div>}
            </Card>
          )}
        </>
      )}
      {toastNode}
    </div>
  );
}
