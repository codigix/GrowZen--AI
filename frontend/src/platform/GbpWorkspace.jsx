import ProcessTasks from './ProcessTasks';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LayoutDashboard, Store, BarChart3, Star, Newspaper, Image as ImageIcon, MapPinned, MessageCircleQuestion, Sparkles, Swords, Bot, FileText,
  ListTodo, History, Settings2, ArrowRight, ArrowUpRight, Copy, Plus, ArrowDownRight, Minus, Phone, Navigation, MousePointerClick, Search, Eye, CalendarCheck, CheckCircle2, Clock, PlugZap, Globe
} from 'lucide-react';
import { ReviewLinkCard } from './ReviewLink';
import { ProfileStrength, QuickTiles, MissingInfoCard, ShareProfileCard, NewReviewBanner, interactions } from './GbpOverviewExtras';
import { VerificationCard, ManagersCard, AdvertiseCard, DangerCard } from './GbpAdmin';
import { refreshBusinesses, Card, Badge, Button, ErrorNote, ScoreRing, scoreWord, StatusPill, areaCls, useAction, useDoubleConfirm, Sk, SkStats, SkTable, SkList, SkScore, SkCard } from './SeoUi';
import { api, useApi, fmt, fmtDateTime } from './seoApi';
import { Growth, Tile as GrowthTile } from './ClientReportPage';
import DataTable, { usePager, Pager, useSorted, SortTh, downloadCsv } from './DataTable';
import { useGbpLive } from './AccessGate';
import { VerifyPill } from './GbpAccounts';

/** Where every number on this page comes from, so a calculated or AI figure is never mistaken for Google's own. */
export const SOURCES = {
  google: { label: 'Google API', tone: 'green', hint: 'Supplied by Google Business Profile APIs' },
  calc: { label: 'Codigix calculated', tone: 'blue', hint: 'Calculated by Codigix from the data we hold; not supplied by Google' },
  ai: { label: 'AI generated', tone: 'violet', hint: 'Drafted by AI: review before use' },
  external: { label: 'External API', tone: 'orange', hint: 'From a third-party data provider' },
  crawler: { label: 'Website crawler', tone: 'gray', hint: 'Read from the client website by the Codigix crawler' },
  manual: { label: 'Manual input', tone: 'amber', hint: 'Entered by the team' },
};

export const SourceBadge = ({ type }) => {
  const s = SOURCES[type];
  return s ? <Badge tone={s.tone} title={s.hint}>{s.label}</Badge> : null;
};

export const Sources = ({ types }) => (
  <div className="flex flex-wrap items-center gap-1.5 text-11.5 text-slate-500"><span>Data source:</span>{types.map(t => <SourceBadge key={t} type={t} />)}</div>
);

/** Section header: title, one line, and where the data comes from. */
export const SectionHead = ({ title, subtitle, sources = [], children }) => (
  <div className="flex flex-wrap items-end gap-3 mb-4">
    <div className="flex-1 min-w-[240px]">
      <h2 className="text-18 font-semibold text-slate-900">{title}</h2>
      {subtitle && <p className="text-13 text-slate-500 mt-0.5">{subtitle}</p>}
      {sources.length > 0 && <div className="mt-1.5"><Sources types={sources} /></div>}
    </div>
    {children}
  </div>
);

export const SECTIONS = [
  { group: 'Workspace', items: [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'profile', label: 'Business Profile', icon: Store },
    { id: 'performance', label: 'Performance', icon: BarChart3 },
    { id: 'traffic', label: 'Website traffic', icon: Globe },
    { id: 'reviews', label: 'Reviews & Reputation', icon: Star },
    { id: 'posts', label: 'Posts & Content', icon: Newspaper },
    { id: 'photos', label: 'Photos & Media', icon: ImageIcon },
  ] },
];
// These pages live under their own sidebars now (GMB, AI Visibility, Reports, Settings). They are still opened as /gmb-profile?tab=<id>.
export const SIDEBAR_SECTION_IDS = ['local-seo', 'aeo', 'geo', 'competitors', 'ai', 'reports', 'tasks', 'sync', 'settings'];
export const SECTION_IDS = [...SECTIONS.flatMap(g => g.items.map(i => i.id)), ...SIDEBAR_SECTION_IDS];
// Older ?tab= links still land in the right place.
export const TAB_ALIAS = { project: 'overview', live: 'profile', hours: 'profile', faq: 'profile', audit: 'ai', insights: 'performance' };

/** Website traffic (Google Analytics 4) views, shown as an inner sidebar under the Performance item. */
export const TRAFFIC_VIEWS = [
  { id: 'overview', label: 'Overview' },
  { id: 'snap', label: 'Reports snapshot' },
  { id: 'rt', label: 'Realtime overview' },
  { id: 'rtp', label: 'Realtime pages' },
];

export function SectionNav({ value, onChange }) {
  return (
    <nav aria-label="Client workspace" className="lg:sticky lg:top-24 lg:self-start">
      <div className="bg-white shadow-card rounded p-2 flex lg:block gap-1 overflow-x-auto no-scrollbar">
        {SECTIONS.map(g => (
          <div key={g.group} className="flex lg:block gap-1 lg:mb-2 lg:last:mb-0">
            <div className="hidden lg:block px-3 pt-2 pb-1 text-11 font-semibold uppercase tracking-wide text-slate-400">{g.group}</div>
            {g.items.map(i => {
              const active = value === i.id;
              const Icon = i.icon;
              return (
                <div key={i.id} className="flex lg:block gap-1">
                  <button type="button" onClick={() => onChange(i.id)} aria-current={active ? 'page' : undefined}
                    className={`w-full shrink-0 flex items-center gap-2.5 px-3 py-2 rounded text-13 font-medium whitespace-nowrap text-left cursor-pointer transition-colors ${active ? 'bg-indigo-500 text-white' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}>
                    <Icon size={15} className="shrink-0" />{i.label}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}

/** The website's own icon, for a project whose Google profile has no logo (yet). */
export function siteIcon(website) {
  if (!website) return null;
  try {
    const host = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).hostname;
    return host ? `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(host)}` : null;
  } catch { return null; }
}

/** The business logo from its Google profile, or its first letter when the profile has none. */
export function BusinessAvatar({ name, src, size = 'w-11 h-11', className = '' }) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [src]);
  return (
    <span className={`${size} shrink-0 rounded-full bg-white ring-1 ring-slate-200 overflow-hidden flex items-center justify-center text-slate-500 font-bold ${className}`}>
      {src && !failed ? <img src={src} alt={`${name || 'Business'} logo`} className="w-full h-full object-cover" onError={() => setFailed(true)} /> : <span>{(name || '?').trim().charAt(0).toUpperCase()}</span>}
    </span>
  );
}

const ago = (iso) => {
  if (!iso) return 'never';
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

const Loading = () => <SkList rows={3} />;

/** Client header: who this workspace is for and the state of its Google connection. */
export function ClientBar({ b, onConnect, onSync, syncing = false, version = 0, onCreate }) {
  const live = useGbpLive(b);  // the Business Profile data once the project's access steps are done; until then only what the checklist knows
  const d = live.data;
  const reload = live.reload;
  const seen = useRef(version);
  useEffect(() => { if (seen.current !== version) { seen.current = version; reload?.(); } }, [version]); // eslint-disable-line react-hooks/exhaustive-deps -- a sync finished: re-read the header's data
  const connected = Boolean(d?.linked && d?.connection?.status === 'active');
  return (
    <div className="ai-glass-card rounded px-5 py-3.5 flex flex-wrap items-center gap-x-5 gap-y-2">
      <BusinessAvatar name={b.name} src={d?.profile?.logo || b.logo || (d?.live?.media || []).find(m => m.type !== 'VIDEO' && m.url)?.url || siteIcon(b.website)} size="w-12 h-12" />
      <div className="min-w-[200px] flex-1">
        <div className="text-16 font-semibold text-slate-900">{b.name}</div>
        <div className="text-12 text-slate-500">{[b.primaryCategory || b.primary_category, [b.area, b.city].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || 'No category or address yet'}</div>
      </div>
      {!d ? <Sk w="w-40" h="h-4" /> : (
        <>
          <div className="text-12 text-slate-600">
            <div className="flex items-center gap-1.5">{connected ? <CheckCircle2 size={13} className="text-emerald-500" /> : <PlugZap size={13} className="text-amber-500" />}<b className="font-semibold text-slate-800">{connected ? 'Connected' : d.linked ? 'Needs attention' : 'Not connected'}</b>{d.connection?.email && <span className="text-slate-500">· {d.connection.email}</span>}</div>
            <div className="flex items-center gap-1.5 text-slate-500 mt-0.5"><Clock size={12} />Last synced {ago(d.live?.synced_at || d.connection?.last_sync_at)}</div>
          </div>
          {d.linked && <VerifyPill state={d.verification} />}
        </>
      )}
      {d?.linked && onCreate && <Button size="sm" icon={Plus} onClick={onCreate} title="Create a new Google Business Profile from this project's details">New profile</Button>}
      {d?.linked ? <Button size="sm" busy={syncing} disabled={syncing} onClick={onSync}>{syncing ? 'Syncing…' : 'Sync now'}</Button> : <Button size="sm" variant="primary" icon={PlugZap} onClick={() => onConnect?.('google')}>Connect Google account</Button>}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub }) {
  return (
    <div className="ai-glass-card rounded p-3.5 flex items-center gap-3 min-w-0">
      <span className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-500 flex items-center justify-center shrink-0"><Icon size={17} /></span>
      <div className="min-w-0"><div className="text-11.5 font-semibold text-slate-400 truncate">{label}</div><div className="text-20 leading-tight font-bold text-slate-900 tabular-nums">{value ?? '—'}</div>{sub && <div className="text-11.5 text-slate-500 truncate">{sub}</div>}</div>
    </div>
  );
}

/** The project's progress, month by month: this month's numbers against last month, the 12-month growth chart and the table of changes. */
function ProgressByMonth({ b, go }) {
  const g = useApi(`/businesses/${b.id}/gbp/reports/growth`);
  const rows = g.data?.months || [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto"><h3 className="text-16 font-semibold text-slate-900">Progress month by month</h3><p className="text-12 text-slate-500">What customers did on the Google profile each month, and how it changed.</p></div>
        <Button size="sm" onClick={() => go('reports')}>Reports and client link</Button>
      </div>
      {!g.data ? <Card><SkList rows={4} avatar={false} /></Card> : rows.length === 0 ? null : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[['Profile views', '#6366f1', 'views'], ['Calls', '#10b981', 'calls'], ['Directions', '#f59e0b', 'directions'], ['Website clicks', '#0ea5e9', 'website_clicks']].map(([label, color, k]) => <GrowthTile key={k} icon={BarChart3} label={label} color={color} rows={rows} k={k} />)}
          </div>
          <Growth rows={rows} current={g.data.month} />
        </>
      )}
    </div>
  );
}

export function OverviewSection({ b, go, onOpen }) {
  const live = useApi(`/businesses/${b.id}/gbp/live`);
  const score = useApi(`/businesses/${b.id}/gbp/score`);
  const d = live.data;
  const m = d?.metrics;
  const linked = Boolean(d?.linked);
  const missing = score.data ? [...score.data.items].filter(i => !i.ok).sort((a, c) => (c.weight * (1 - c.score)) - (a.weight * (1 - a.score))).slice(0, 5) : [];
  return (
    <div className="space-y-3">
      {!d ? <div className="space-y-4"><SkStats labels={["Average rating", "Search views · 30 days", "Calls · 30 days", "Website clicks · 30 days"]} /><div className="grid grid-cols-1 xl:grid-cols-3 gap-4"><SkCard title="Profile health score" subtitle="Calculated by Codigix from the profile; not a Google score"><SkScore /></SkCard><SkCard title="Fix next" subtitle="Highest-impact gaps first" className="xl:col-span-2"><SkList rows={4} avatar={false} /></SkCard></div></div> : (
        <>
          {!linked && <div className="rounded bg-amber-50 ring-1 ring-inset ring-amber-200 px-4 py-3 text-13 text-amber-900">This client has no Google account connected, so the numbers below are empty. Use <b>Connect Google account</b> above.</div>}

          <div className="rounded-2xl bg-sky-50/70 ring-1 ring-sky-100 p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <BusinessAvatar name={b.name} src={d?.profile?.logo || b.logo || siteIcon(b.website)} size="w-10 h-10" />
              <div className="flex-1 min-w-[200px]">
                <div className="text-16 font-medium text-slate-900" title="Only managers of this profile can see this. Profile strength is our check of what Google rewards; Google does not share its own number.">Your business on Google</div>
                <div className="text-12.5 text-sky-700 flex items-center gap-1.5"><BarChart3 size={13} />{interactions(m)} customer interactions · last 30 days</div>
              </div>
              {score.data && <ProfileStrength score={score.data.score} />}
            </div>
            <div className="rounded-xl bg-white ring-1 ring-sky-100 grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-slate-100 overflow-hidden">
              {[[Star, 'text-amber-500', 'Average rating', m.rating ? `${m.rating}★` : '—', `${fmt(m.review_count || 0)} reviews`], [Search, 'text-violet-500', 'Search views', fmt(m.views_search_30), '30 days'],
                [Phone, 'text-emerald-500', 'Calls', fmt(m.calls_30), '30 days'], [MousePointerClick, 'text-indigo-500', 'Website clicks', fmt(m.website_clicks_30), '30 days']].map(([Ic, tone, label, value, sub]) => (
                <div key={label} className="px-3.5 py-2.5 min-w-0">
                  <div className="flex items-center gap-1.5 text-11.5 font-semibold text-slate-500 truncate"><Ic size={13} className={tone} />{label}</div>
                  <div className="text-18 leading-tight font-bold text-slate-900 tabular-nums">{value ?? '—'}</div>
                  <div className="text-11 text-slate-400 truncate">{sub}</div>
                </div>))}
            </div>
            <QuickTiles b={b} unreplied={m.unreplied_reviews || 0} />
            <NewReviewBanner b={b} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 items-start">
            <MissingInfoCard b={b} d={d} />
            <ShareProfileCard b={b} />
            <Card title="Fix next" subtitle="Highest-impact gaps from the profile check">
              {!score.data ? <SkList rows={4} avatar={false} /> : missing.length === 0 ? <p className="text-13 text-slate-500 py-3">Nothing missing. The profile checklist is complete.</p> : (
                <ul className="divide-y divide-slate-100">{missing.map(i => <li key={i.key} className="py-2 flex items-start gap-3"><div className="flex-1 min-w-0"><div className="text-13 text-slate-900">{i.label}</div><div className="text-12 text-slate-500">{i.fix}</div></div><Badge tone="gray">{i.factor}</Badge></li>)}</ul>
              )}
              {score.data && <button type="button" onClick={() => go('ai')} className="mt-2 text-12.5 font-semibold text-indigo-600 hover:underline cursor-pointer">See all recommendations</button>}
            </Card>
          </div>
        </>
      )}
      <ProgressByMonth b={b} go={go} />
    </div>
  );
}

const kwImpr = (k, key) => (key === 'keyword' ? k.keyword : k.impressions ?? (k.below != null ? k.below - 0.5 : null));

/** The searches that showed the profile: sortable, searchable and paged (Google rounds low values to "< n"). */
function SearchKeywordsTable({ keywords, pad }) {
  const [q, setQ] = useState('');
  const kept = useMemo(() => { const n = q.trim().toLowerCase(); return n ? keywords.filter(k => String(k.keyword).toLowerCase().includes(n)) : keywords; }, [keywords, q]);
  const { sorted, sort, onSort } = useSorted(kept, kwImpr);
  const pager = usePager(sorted, { size: 10, resetKey: q });
  return (
    <>
      {keywords.length > 10 && <div className={`${pad} py-2 border-b border-slate-100`}><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search these keywords" aria-label="Search these keywords" className="h-8 w-full max-w-xs px-3 text-13 rounded-md border border-slate-200 bg-white focus:border-indigo-400 outline-none" /></div>}
      <div className="max-h-96 overflow-auto"><table className="w-full text-13"><thead className="sticky top-0 bg-slate-50 text-11.5 text-slate-500"><tr><SortTh id="keyword" sort={sort} onSort={onSort} className={`${pad} py-2`}>Keyword</SortTh><SortTh id="impressions" sort={sort} onSort={onSort} right first="desc" className={`${pad} py-2`}>Impressions</SortTh></tr></thead>
        <tbody className="divide-y divide-slate-100">{pager.rows.map(k => <tr key={k.keyword}><td className={`${pad} py-2 text-slate-800`}>{k.keyword}</td><td className={`${pad} py-2 text-right tabular-nums`}>{k.impressions != null ? fmt(k.impressions) : <span className="text-slate-400">&lt; {k.below}</span>}</td></tr>)}
          {!pager.rows.length && <tr><td colSpan={2} className="px-5 py-6 text-center text-slate-500">No keyword matches.</td></tr>}</tbody></table></div>
      <Pager p={pager} label="keywords" />
    </>
  );
}

/** Every Google performance metric Google returns for the profile. Anything it does not return is said so, never faked. */
/** A small graph of one number over the period: the line, a soft fill under it, and a dot on the last day. */
function Spark({ values, tone = '#4f46e5', width = 132, height = 40, fluid = false }) {
  const id = React.useId();
  const max = Math.max(...values, 1);
  const n = values.length;
  if (!n) return null;
  const x = (i) => (n === 1 ? width / 2 : 2 + (i / (n - 1)) * (width - 4));
  const y = (v) => height - 3 - (v / max) * (height - 8);
  const flat = max === 1 && values.every(v => v === 0);
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(n - 1).toFixed(1)},${height} L${x(0).toFixed(1)},${height} Z`;
  return (
    <svg width={fluid ? '100%' : width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio={fluid ? 'none' : undefined} role="img" aria-label={`Daily values over ${n} days, highest ${max}`} className={fluid ? 'block' : 'shrink-0 overflow-visible'}>
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={tone} stopOpacity="0.22" /><stop offset="100%" stopColor={tone} stopOpacity="0" /></linearGradient></defs>
      {!flat && <path d={area} fill={`url(#${id})`} />}
      <path d={line} fill="none" stroke={flat ? '#cbd5e1' : tone} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect={fluid ? 'non-scaling-stroke' : undefined} />
      {!flat && !fluid && <circle cx={x(n - 1)} cy={y(values[n - 1])} r="2.6" fill={tone} />}
    </svg>
  );
}

/** "+12.4%" with an arrow: green up, red down, grey when it did not move or there is nothing before to compare with. */
function Change({ pct, has }) {
  if (!has) return <span className="inline-flex items-center gap-1 text-11.5 text-slate-400" title="Google data from the earlier period has not been read yet">no earlier data</span>;
  if (pct == null || pct === 0) return <span className="inline-flex items-center gap-0.5 text-12 font-semibold text-slate-500"><Minus size={13} />{pct === 0 ? '0%' : '–'}</span>;
  const up = pct > 0;
  const big = Math.abs(pct) >= 1000 ? `${Math.round(Math.abs(pct) / 100) / 10}k` : Math.abs(pct).toLocaleString('en-IN', { maximumFractionDigits: 1 });
  return <span className={`inline-flex items-center gap-0.5 text-12 font-semibold tabular-nums ${up ? 'text-emerald-600' : 'text-rose-600'}`}>{up ? <ArrowUpRight size={14} strokeWidth={2.5} /> : <ArrowDownRight size={14} strokeWidth={2.5} />}{up ? '+' : '-'}{big}%</span>;
}

const PERF_LOOK = {
  views: [Eye, '#4f46e5', 'bg-indigo-50 text-indigo-600'], interactions: [MousePointerClick, '#0ea5e9', 'bg-sky-50 text-sky-600'],
  views_search: [Search, '#6366f1', 'bg-indigo-50 text-indigo-600'], views_maps: [MapPinned, '#10b981', 'bg-emerald-50 text-emerald-600'],
  website_clicks: [Globe, '#0ea5e9', 'bg-sky-50 text-sky-600'], calls: [Phone, '#f59e0b', 'bg-amber-50 text-amber-600'],
  directions: [Navigation, '#8b5cf6', 'bg-violet-50 text-violet-600'], bookings: [CalendarCheck, '#ec4899', 'bg-pink-50 text-pink-600']
};
const shortDay = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** One number the way Google's own reports show it: the count, how it moved against the period before, and its daily graph. */
function StatCard({ m, days, hasPrev }) {
  const [Icon, tone, chip] = PERF_LOOK[m.key] || PERF_LOOK.views;
  return (
    <div className="rounded-xl bg-white ring-1 ring-slate-200 p-3.5 min-w-0 flex flex-col" title={m.hint}>
      <div className="flex items-center gap-2 text-12.5 font-semibold text-slate-500"><span className={`w-6 h-6 rounded-md inline-flex items-center justify-center shrink-0 ${chip}`}><Icon size={13} /></span><span className="truncate">{m.label}</span></div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <div className="text-[26px] leading-none font-bold text-slate-900 tabular-nums">{Number(m.total).toLocaleString('en-IN')}</div>
        <div className="flex items-center gap-1.5 shrink-0"><Change pct={m.change_pct} has={hasPrev} /></div>
      </div>
      <div className="mt-0.5 h-4 text-11.5 text-slate-400 tabular-nums">{hasPrev && m.previous != null ? `vs ${Number(m.previous).toLocaleString('en-IN')} before` : ''}</div>
      <div className="mt-1"><Spark values={m.series} tone={tone} width={240} height={36} fluid /></div>
      <div className="mt-1.5 text-11.5 text-slate-400">{m.best_day ? <>Best day {shortDay(m.best_day.day)}: <b className="text-slate-600 tabular-nums">{m.best_day.value}</b></> : 'Nothing in this period'}</div>
    </div>
  );
}

export function PerformanceMetrics({ b, children }) {
  const [days, setDays] = useState(28);
  const perf = useApi(`/businesses/${b.id}/gbp/performance?days=${days}`);
  const live = useApi(`/businesses/${b.id}/gbp/live`);
  const d = live.data;
  const kws = d?.live?.search_keywords || [];
  const p = perf.data;
  const header = (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex gap-0.5 p-0.5 bg-slate-100 rounded-lg" role="tablist" aria-label="Period">
        {[[7, 'Last 7 days'], [28, 'Last 28 days']].map(([n, label]) => (
          <button key={n} type="button" role="tab" aria-selected={days === n} onClick={() => setDays(n)} className={`h-8 px-3 text-12.5 font-semibold rounded-md cursor-pointer ${days === n ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800'}`}>{label}</button>))}
      </div>
      {p?.has_data && <span className="text-12.5 text-slate-500">{shortDay(p.start)} to {shortDay(p.end)}{p.has_previous ? <span className="text-slate-400"> · compared with {shortDay(p.previous_start)} to {shortDay(new Date(new Date(`${p.start}T00:00:00`).getTime() - 86400000).toISOString().slice(0, 10))}</span> : null}</span>}
      <span className="ml-auto"><SourceBadge type="google" /></span>
    </div>
  );
  if (!p) return <div className="space-y-4">{header}<SkStats cols="grid-cols-2 lg:grid-cols-4" labels={["Total profile views", "Customer actions", "Google Search impressions", "Google Maps impressions"]} /></div>;
  const by = Object.fromEntries(p.metrics.map(m => [m.key, m]));
  return (
    <div className="space-y-3">
      {header}
      {!p.has_data ? (
        <Card><p className="py-8 text-center text-13 text-slate-500">No daily numbers from Google have been read for this profile yet. Press <b>Sync</b> on the Google profile to read them (Google reports each day two days late).</p></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {['views', 'interactions', 'views_search', 'views_maps', 'website_clicks', 'calls', 'directions', 'bookings'].map(k => by[k] && <StatCard key={k} m={by[k]} days={days} hasPrev={p.has_previous} />)}
          </div>
          <p className="text-12 text-slate-500">Each number is the total for the period, the arrow is the change against the same number of days just before, and the small graph is one value per day. Google reports the newest days late, so the period ends on {shortDay(p.end)}. Booking interactions show only where the category has a Book button.</p>
        </>
      )}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 items-start">
        <div className="xl:col-span-2 min-w-0">{children}</div>
        <Card title="Monthly search keywords" subtitle="What showed the profile, by monthly impressions (low values are rounded to “< n”)" pad={false}>
          {kws.length ? (
            <SearchKeywordsTable keywords={kws} pad="px-4" />
          ) : <p className="text-13 text-slate-500 px-5 py-8 text-center">No keyword data from Google yet.</p>}
        </Card>
      </div>
    </div>
  );
}

/** "12 Nov 2026, 3:45 PM": the date and the time (in the viewer's time zone) a review or reply was posted on Google. A date without a time (older rows) shows the date only. */
const stamp = (v) => {
  if (!v) return '';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(v));
  const t = new Date(dateOnly ? `${v}T00:00:00` : v);
  if (Number.isNaN(t.getTime())) return String(v);
  const d = t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  return dateOnly ? d : `${d}, ${t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
};

/** One review with its reply written, edited and posted right here (the reply goes to Google when posted). */
function ReviewRow({ b, r, toast, onChanged }) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState(r.reply || '');
  const [busy, error, run] = useAction();
  const draft = () => run('ai', async () => { const x = await api(`/businesses/${b.id}/reviews/${r.id}/draft`, { method: 'POST', body: { language: 'English' } }); setText(x.reply_text || ''); });
  const post = () => run('post', async () => {
    const out = await api(`/businesses/${b.id}/reviews/${r.id}/approve`, { method: 'POST', body: { text } });
    const res = out.task?.result;
    toast(res?.posted ? (res.confirmed === true ? 'Reply posted: Google has it on your Business Profile. Google Maps and Search can take from a few minutes to a few hours to show it.' : res.confirmed === false ? 'Reply sent to Google, but the review does not show it yet. Press Sync from Google in a minute to check.' : 'Reply sent to Google. Maps and Search can take a while to show it.') : "Reply saved, but this client isn't linked to Google, so post it from Google");
    setOpen(false); onChanged();
  });
  const [ask, confirmNode] = useDoubleConfirm();
  const remove = () => ask({ what: `your reply to ${r.author || 'this reviewer'}`, effect: 'The reply is removed from your Google Business Profile. The review itself stays.', onConfirm: () => run('del', async () => { await api(`/businesses/${b.id}/gbp/reviews/${r.id}/reply`, { method: 'DELETE' }); toast('Reply deleted from Google'); setText(''); setOpen(false); onChanged(); }) });
  return (
    <li className="text-13">
      {confirmNode}
      <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-slate-900">{r.author || 'Google user'}</span><span className="text-amber-500">{'★'.repeat(r.rating)}</span><span className="text-11.5 text-slate-400" title="When the customer posted this on Google">{stamp(r.at || r.date)}</span>{!r.replied && <Badge tone="amber">No reply</Badge>}</div>
      {r.body && <p className="text-slate-600 mt-0.5">{r.body}</p>}
      {r.reply && !open && <div className="mt-1 pl-3 border-l-2 border-slate-200"><div className="text-11.5 font-semibold text-slate-600">Your reply{r.repliedAt ? <span className="font-normal text-slate-400"> · {stamp(r.repliedAt)}</span> : null}</div><p className="text-12.5 text-slate-500">{r.reply}</p></div>}
      {open ? (
        <div className="mt-2 space-y-2">
          <textarea rows={4} className={areaCls} value={text} onChange={e => setText(e.target.value)} placeholder="Write a reply, or let AI draft one and edit it" />
          <ErrorNote>{error}</ErrorNote>
          {String(error || '').startsWith('This review') && (
            <div className="flex flex-wrap items-center gap-2 text-12.5">
              <Button size="sm" icon={Copy} onClick={() => { try { navigator.clipboard.writeText(text); toast('Reply copied: paste it under the review on Google Maps'); } catch { toast('Select the reply text and copy it'); } }}>Copy the reply</Button>
              {(b.gbp_status?.maps_url || b.gbp_status?.review_url) && <a href={b.gbp_status.maps_url || b.gbp_status.review_url} target="_blank" rel="noreferrer noopener"><Button size="sm" icon={ArrowUpRight}>Open on Google Maps</Button></a>}
            </div>)}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ai" busy={busy === 'ai'} onClick={draft}>Write with AI</Button>
            <Button size="sm" variant="primary" busy={busy === 'post'} disabled={!text.trim()} onClick={post}>{r.replied ? 'Update reply on Google' : 'Post reply to Google'}</Button>
            <Button size="sm" onClick={() => { setOpen(false); setText(r.reply || ''); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="mt-1.5 flex gap-3 text-12.5 font-semibold">
          <button type="button" onClick={() => setOpen(true)} className="text-indigo-600 hover:underline cursor-pointer">{r.replied ? 'Edit reply' : 'Reply'}</button>
          {r.replied && <button type="button" onClick={remove} className="text-slate-400 hover:text-red-600 cursor-pointer">Delete reply</button>}
        </div>
      )}
    </li>
  );
}

export function ReviewsSection({ b, toast = () => {} }) {
  const live = useApi(`/businesses/${b.id}/gbp/live`);
  const all = useApi(`/businesses/${b.id}/reviews`);
  const [onlyOpen, setOnlyOpen] = React.useState(true);
  const [syncing, syncError, run] = useAction();
  const d = live.data;
  if (!d || !all.data) return all.error ? <ErrorNote>{all.error.message}</ErrorNote> : <div className="space-y-4"><SkStats labels={["Average rating", "Total reviews", "Unanswered", "Response rate"]} /><SkCard title="Reviews"><SkList rows={4} /></SkCard></div>;
  const m = d.metrics;
  const sum = all.data.summary;
  const split = d.rating_split || {};
  const total = Object.values(split).reduce((a, v) => a + v, 0) || 0;
  const rows = all.data.reviews.filter(r => !r.gone_at).map(r => ({ id: r.id, author: r.author, rating: r.rating, body: r.body, date: r.review_date, at: r.review_at, repliedAt: r.replied_at, replied: r.reply_status === 'posted', reply: r.reply_text }));
  const shown = onlyOpen ? rows.filter(r => !r.replied) : rows;
  const positive = [4, 5].reduce((s2, n) => s2 + (split[String(n)] || 0), 0);
  const negative = [1, 2].reduce((s2, n) => s2 + (split[String(n)] || 0), 0);
  const changed = () => { all.reload(true); live.reload(true); };
  const fetchNew = () => run('sync', async () => { const x = await api(`/businesses/${b.id}/sync`, { method: 'POST' }); toast(x.new_reviews ? `${x.new_reviews} new review${x.new_reviews === 1 ? '' : 's'} from Google` : x.reviews === 0 ? 'Google has not published any review for this profile yet' : 'No new reviews on Google'); changed(); });
  return (
    <div className="space-y-4">
      <SectionHead title="Reviews & Reputation" subtitle="Rating, distribution, and replies you write here go to Google" sources={['google', 'calc', 'ai']} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={Star} label="Average rating" value={m.rating ? `${m.rating}★` : '—'} sub="Google API" />
        <Kpi icon={Star} label="Total reviews" value={fmt(m.review_count || 0)} sub="Google API" />
        <Kpi icon={Star} label="Unanswered" value={fmt(sum.awaiting_reply)} sub="Codigix calculated" />
        <Kpi icon={Star} label="Response rate" value={sum.count ? `${sum.reply_rate}%` : '—'} sub={`Of ${sum.count} reviews · Codigix calculated`} />
      </div>
      <ReviewLinkCard b={b} />
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
        <Card title="Rating distribution" action={<SourceBadge type="google" />}>
          <ul className="space-y-1.5">{[5, 4, 3, 2, 1].map(n => <li key={n} className="flex items-center gap-2 text-12"><span className="w-3 text-slate-500">{n}</span><span className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><span className="block h-full rounded-full bg-amber-400" style={{ width: `${total ? ((split[String(n)] || 0) / total) * 100 : 0}%` }} /></span><span className="w-8 text-right tabular-nums text-slate-500">{split[String(n)] || 0}</span></li>)}</ul>
          <div className="mt-3 flex flex-wrap gap-2 text-12"><StatusPill level="good">{positive} positive (4-5★)</StatusPill><StatusPill level={negative ? 'critical' : 'good'}>{negative} negative (1-2★)</StatusPill></div>
          <p className="text-11.5 text-slate-500 mt-2">Positive / negative is counted from star ratings. AI only drafts a reply: you edit it and choose to post.</p>
        </Card>
        <Card title="Reviews" className="xl:col-span-2" action={<Button size="sm" busy={syncing === 'sync'} onClick={fetchNew}>Fetch new reviews from Google</Button>}>
          <ErrorNote>{syncError}</ErrorNote>
          {sum.count === 0 && d.linked && (b.review_count || 0) > 0 && (
            <div className="mb-3 rounded-lg bg-sky-50 ring-1 ring-sky-200 px-4 py-3 text-13 text-sky-900">
              <div className="font-semibold">Google counts {b.review_count} review{b.review_count === 1 ? '' : 's'}{b.rating ? ` (${b.rating}★)` : ''}, but has not released the text yet</div>
              <p className="mt-1 text-12.5 text-sky-800">The total is already on Google. The review itself (name, text, date) usually follows within hours. Press <b>Fetch new reviews from Google</b> again later and it will appear here, with a bell alert.</p>
            </div>
          )}
          {sum.count === 0 && d.linked && !((b.review_count || 0) > 0) && (
            <div className="mb-3 rounded-lg bg-amber-50 ring-1 ring-amber-200 px-4 py-3 text-13 text-amber-900">
              <div className="font-semibold">Google has not published a review for this profile yet</div>
              <p className="mt-1 text-12.5 text-amber-800">This page shows exactly what Google returns, and it returned none. A review you just posted can take from a few minutes to a couple of days to appear, and Google holds back some: reviews from the account that manages the profile, from brand-new accounts, or ones flagged by its spam filter. Also check it was posted on this exact listing (open the review link above and look for the same address). Press <b>Fetch new reviews from Google</b> again later.</p>
            </div>
          )}
          <div className="flex gap-1 mb-3">
            {[[true, `Unanswered (${sum.awaiting_reply})`], [false, `All (${sum.count})`]].map(([v, l]) => (
              <button key={String(v)} type="button" onClick={() => setOnlyOpen(v)} className={`h-8 px-3 rounded text-12.5 font-semibold cursor-pointer ${onlyOpen === v ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{l}</button>
            ))}
          </div>
          {shown.length === 0 ? <p className="text-13 text-slate-500 py-6 text-center">{onlyOpen ? 'Every review has a reply.' : 'No reviews yet.'}</p> : (
            <ul className="space-y-4 max-h-[32rem] overflow-y-auto pr-1">
              {shown.map(r => <ReviewRow key={`${r.id}-${r.reply || ''}`} b={b} r={r} toast={toast} onChanged={changed} />)}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

/** Sections whose work happens in a dedicated tool: say what is there and where it comes from, then open it. */
const TOOLS = {
  'local-seo': { title: 'Local SEO', subtitle: 'Rankings, keywords, NAP and citations for this client', sources: ['external', 'crawler', 'calc'], cards: [
    ['Local rank tracking', 'Google Maps and local search rank, geo-grid ranking by location pin.', '/rank-tracking', 'external'],
    ['Keyword research & tracking', 'Local keyword ideas, volume and tracked positions.', '/keyword-management', 'external'],
    ['Website & location page audit', 'Technical errors, meta tags, LocalBusiness schema validation.', '/website-audit', 'crawler'],
    ['Citations & NAP consistency', 'Listings, backlinks and name-address-phone matching.', '/off-page-seo', 'crawler'],
  ] },
  aeo: { title: 'AEO: Answer Engine Optimization', subtitle: 'Questions and answers that answer engines can use', sources: ['crawler', 'ai', 'calc'], cards: [
    ['FAQs, answers and FAQ schema', 'Manage Q&A for this client; copy ready-made FAQ schema.', 'profile:faq', 'manual'],
    ['Schema studio', 'Generate and validate structured data.', '/website-audit', 'crawler'],
    ['AI content & FAQ generation', 'Draft answers from the profile, with nothing invented.', '/ai-content-generation', 'ai'],
  ] },
  geo: { title: 'GEO: Generative Engine Optimization', subtitle: 'Visibility in AI search such as ChatGPT, Gemini and Perplexity', sources: ['external', 'ai', 'calc'], cards: [
    ['AI search visibility tracking', 'Whether and where this brand is cited by AI answers.', '/geo-optimization', 'external'],
    ['Domain overview', 'Brand authority and traffic for the client website.', '/domain-overview', 'external'],
    ['Backlink intelligence', 'Citation and authority analysis.', '/backlinks/links', 'external'],
  ] },
  competitors: { title: 'Competitor Analysis', subtitle: 'Find, add and compare competitors', sources: ['external', 'manual'], cards: [
    ['Competitor finder', 'Discover competitors by keyword and add them.', '/competitor-finder', 'external'],
    ['Competitor watch', 'Ratings, review growth and changes over time.', '/competitor-watch', 'external'],
    ['Compare domains', 'Side-by-side website and keyword comparison.', '/compare-domains', 'external'],
    ['Keyword gap', 'Keywords competitors rank for and this client does not.', '/keyword-gap', 'external'],
  ] },
  reports: { title: 'Reports', subtitle: 'Client-wise reports, exports and history', sources: ['calc'], cards: [
    ['Reports & report history', 'Audit, local SEO, review, performance and ranking reports; PDF export.', '/reports', 'calc'],
    ['Leads', 'Leads attributed to this client.', '/leads', 'manual'],
  ] },
};

export function ToolSection({ id, go }) {
  const t = TOOLS[id];
  return (
    <div>
      <SectionHead title={t.title} subtitle={t.subtitle} sources={t.sources} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {t.cards.map(([title, text, to, src]) => (
          <Card key={title} title={title} action={<SourceBadge type={src} />}>
            <p className="text-13 text-slate-600">{text}</p>
            {to.startsWith('profile:') ? <Button className="mt-3" size="sm" onClick={() => go('profile', to.split(':')[1])}>Open <ArrowRight size={13} className="ml-1" /></Button>
              : <Link to={to}><Button className="mt-3" size="sm">Open <ArrowRight size={13} className="ml-1" /></Button></Link>}
          </Card>
        ))}
      </div>
    </div>
  );
}

const nice = (v) => String(v || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

export function TasksSection({ b }) {
  const pending = useApi(`/tasks?status=pending&business_id=${b.id}`);
  const activity = useApi(`/activity?business_id=${b.id}&limit=200`);
  const waiting = pending.data || [];
  const done = (activity.data || []).filter(a => Date.now() - Date.parse(a.created_at) < 7 * 86400000).length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 mr-auto"><h2 className="text-16 font-semibold text-slate-900">Tasks &amp; Activities</h2><p className="text-12 text-slate-500">Work waiting for approval, this week's tasks, and everything done on this client</p></div>
        <div className="flex gap-2">
          {[[waiting.length, 'Waiting for approval', waiting.length ? '#f59e0b' : '#10b981'], [done, 'Actions this week', '#6366f1']].map(([n, l, c]) => (
            <div key={l} className="rounded-lg bg-white ring-1 ring-slate-200 px-3.5 py-1.5 min-w-[120px]"><span className="block text-20 leading-tight font-bold tabular-nums" style={{ color: c }}>{pending.data || l !== 'Waiting for approval' ? n : '—'}</span><span className="block text-11.5 text-slate-500">{l}</span></div>))}
        </div>
        <Link to="/automation"><Button variant="primary">Open approvals</Button></Link>
      </div>
      <ErrorNote>{pending.error?.message || activity.error?.message}</ErrorNote>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
        <Card pad={false} title={`Waiting for approval (${waiting.length})`} subtitle="Review each one in Approvals before it is applied">
          {!pending.data ? <div className="px-5 pb-4"><SkList rows={3} avatar={false} /></div> : (
            <DataTable bare rows={waiting} rowKey={t => t.id} pageSize={8} sizes={[8, 25, 50]} exportName="tasks-waiting" label="tasks" searchPlaceholder="Search tasks" columnsMenu={false} headClass="bg-slate-100 text-slate-700"
              empty="Nothing is waiting for you."
              columns={[
                { id: 'task', header: 'Task', value: t => t.title, className: 'px-3 py-2 min-w-[220px]', cell: t => <span className="text-13 font-medium text-slate-900">{t.title}</span> },
                { id: 'kind', header: 'Type', value: t => nice(t.kind || t.type), className: 'px-3 py-2 whitespace-nowrap', cell: t => <Badge tone="blue">{nice(t.kind || t.type)}</Badge> },
                { id: 'when', header: 'Created', first: 'desc', value: t => Date.parse(t.created_at) || null, className: 'px-3 py-2 whitespace-nowrap text-12 text-slate-500', cell: t => fmtDateTime(t.created_at) },
                { id: 'go', header: '', csv: false, right: true, className: 'px-3 py-2 text-right', cell: () => <Link to="/automation"><Button size="sm">Review</Button></Link> },
              ]} />
          )}
        </Card>
        <Card pad={false} title="Activity history" subtitle="Latest changes, newest first">
          {!activity.data ? <div className="px-5 pb-4"><SkList rows={3} avatar={false} /></div> : (
            <DataTable bare rows={activity.data} rowKey={a => a.id} pageSize={8} sizes={[8, 25, 50]} exportName="activity-history" label="actions" searchPlaceholder="Search activity" columnsMenu={false} headClass="bg-slate-100 text-slate-700"
              empty="No activity yet."
              columns={[
                { id: 'when', header: 'When', first: 'desc', value: a => Date.parse(a.created_at) || null, className: 'px-3 py-2 whitespace-nowrap text-12 text-slate-500', cell: a => fmtDateTime(a.created_at) },
                { id: 'what', header: 'What happened', value: a => nice(a.action || a.kind), className: 'px-3 py-2 text-13 text-slate-800', cell: a => nice(a.action || a.kind) },
                { id: 'who', header: 'By', value: a => a.actor || '', className: 'px-3 py-2 whitespace-nowrap text-12 text-slate-500', cell: a => a.actor || '—' },
              ]} />
          )}
        </Card>
      </div>
      <ProcessTasks b={b} areas={['gmb']} />
    </div>
  );
}

/** One log entry in plain words: what it was, which part of the profile it touched, and the proof the log holds (what was sent, what came back, the link). */
const AREAS = { post: 'Posts', review: 'Reviews', profile: 'Profile', photo: 'Photos', sync: 'Sync', task: 'Tasks', other: 'Other' };
const FIELD = { phoneNumbers: 'phone numbers', phone: 'phone', title: 'name', name: 'name', websiteUri: 'website', website: 'website', profile: 'description', description: 'description', regularHours: 'opening hours', serviceItems: 'services', services: 'services', labels: 'labels', categories: 'categories', storefrontAddress: 'address', placeActionLinks: 'booking links', booking_url: 'booking link', action_links: 'booking links', attributes: 'attributes', additional_phones: 'extra phones' };
const fieldList = (l) => [...new Set((l || []).map(f => FIELD[f] || String(f).replace(/_/g, ' ')))].join(', ');
function explain(a) {
  const d = a.detail || {};
  const act = String(a.action || '');
  const area = /post/.test(act) ? 'post' : /review|reply/.test(act) ? 'review' : /media|photo|logo/.test(act) ? 'photo' : /gbp_synced|sync/.test(act) ? 'sync' : /task|autopilot/.test(act) ? 'task' : /business_updated|profile|category|address|hours|attribute|link|special|verification/.test(act) ? 'profile' : 'other';
  let what = nice(act), proof = '', link = d.url || null;
  if (act === 'gbp_synced') { what = 'Pulled the profile from Google'; proof = `${d.reviews ?? 0} reviews (${d.new_reviews ?? 0} new), ${d.photos ?? 0} photos, ${d.posts ?? 0} posts, ${d.keywords ?? 0} search keywords${d.verification ? ` · ${String(d.verification).toLowerCase()}` : ''}`; }
  else if (act === 'business_updated') { const sent = fieldList(d.pushed_to_google); what = sent ? 'Changed the profile and sent it to Google' : 'Saved profile details here'; proof = `${sent ? `Sent to Google: ${sent}. ` : ''}Fields in the form: ${fieldList(d.fields).slice(0, 140)}`; }
  else if (act === 'task_applied') { what = 'Applied an approved item on Google'; const r = d.result || {}; proof = r.note || (r.published ? 'Published on Google' : r.posted ? 'Posted on Google' : Object.keys(r).length ? JSON.stringify(r).slice(0, 140) : ''); }
  else if (act === 'task_failed') { what = 'An approved item failed on Google'; proof = d.error || ''; }
  else if (act === 'autopilot_scheduled') { what = 'Approved a post for a time'; proof = d.at ? `It goes live ${fmtDateTime(d.at)}` : ''; }
  else if (act === 'autopilot_unscheduled' || act === 'post_unscheduled') { what = 'Took a scheduled post back to a draft'; }
  else if (act === 'post_published') { what = 'Published a post'; proof = d.url ? String(d.url) : ''; }
  else if (/gbp_media/.test(act)) { what = /deleted/.test(act) ? 'Deleted a photo from Google' : 'Added a photo to Google'; }
  else if (d && typeof d === 'object') { proof = Object.entries(d).filter(([, v]) => v != null && typeof v !== 'object').slice(0, 4).map(([k, v]) => `${String(k).replace(/_/g, ' ')}: ${String(v).slice(0, 60)}`).join(' · '); }
  return { area, what, proof, link };
}

const monthStart = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}-01`;

/** Month by month: everything done on this profile, grouped by day, with the proof the log keeps for each. */
function MonthHistory({ b }) {
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [area, setArea] = useState('all');
  const next = ym.m === 11 ? { y: ym.y + 1, m: 0 } : { y: ym.y, m: ym.m + 1 };
  const log = useApi(`/activity?business_id=${b.id}&limit=1000&since=${monthStart(ym.y, ym.m)}&until=${monthStart(next.y, next.m)}`);
  const items = useMemo(() => (log.data || []).map(a => ({ ...a, ...explain(a) })).filter(a => !/^(login|audit_started|indexing_)/.test(String(a.action))), [log.data]);
  const counts = useMemo(() => Object.fromEntries(Object.keys(AREAS).map(k => [k, items.filter(a => a.area === k).length])), [items]);
  const shown = area === 'all' ? items : items.filter(a => a.area === area);
  const days = useMemo(() => { const g = new Map(); for (const a of shown) { const k = String(a.created_at).slice(0, 10); (g.get(k) || g.set(k, []).get(k)).push(a); } return [...g.entries()]; }, [shown]);
  const label = new Date(ym.y, ym.m, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const step = (n) => setYm(v => { const d = new Date(v.y, v.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const atNow = ym.y === now.getFullYear() && ym.m === now.getMonth();
  const exportCsv = () => downloadCsv(`profile-history-${ym.y}-${String(ym.m + 1).padStart(2, '0')}`, ['Date', 'Area', 'What was done', 'Proof', 'By', 'Link'], shown.map(a => [fmtDateTime(a.created_at), AREAS[a.area], a.what, a.proof, a.actor || '', a.link || '']));
  return (
    <Card pad={false} title={`What we did in ${label}`} subtitle="Every change and action on this profile, with the proof the log keeps: what was sent to Google and what came back."
      action={<div className="flex items-center gap-1.5">
        <button type="button" onClick={() => step(-1)} aria-label="Previous month" className="h-8 w-8 rounded-lg ring-1 ring-slate-200 bg-white hover:bg-slate-50 cursor-pointer text-slate-600">‹</button>
        <span className="text-13 font-semibold text-slate-800 min-w-[110px] text-center">{label}</span>
        <button type="button" onClick={() => step(1)} disabled={atNow} aria-label="Next month" className="h-8 w-8 rounded-lg ring-1 ring-slate-200 bg-white hover:bg-slate-50 cursor-pointer text-slate-600 disabled:opacity-40 disabled:cursor-default">›</button>
        <Button size="sm" onClick={exportCsv} disabled={!shown.length}>Export CSV</Button></div>}>
      <div className="px-5 pb-3 flex flex-wrap gap-2">
        {[['all', 'All', items.length], ...Object.keys(AREAS).filter(k => counts[k]).map(k => [k, AREAS[k], counts[k]])].map(([k, l, n]) => (
          <button key={k} type="button" onClick={() => setArea(k)} className={`h-8 px-3 rounded-full text-12.5 font-semibold cursor-pointer ${area === k ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{l} <span className="tabular-nums opacity-80">{n}</span></button>))}
      </div>
      {!log.data ? <div className="px-5 pb-4"><SkList rows={4} avatar={false} /></div> : days.length === 0 ? <p className="text-13 text-slate-500 py-8 text-center border-t border-slate-100">Nothing was recorded in {label}.</p> : (
        <div className="border-t border-slate-100 max-h-[560px] overflow-y-auto">
          {days.map(([day, list]) => (
            <div key={day}>
              <div className="sticky top-0 bg-slate-100 px-5 py-1.5 text-12 font-semibold text-slate-700 flex items-center justify-between"><span>{new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</span><span className="text-slate-500 font-medium">{list.length} action{list.length === 1 ? '' : 's'}</span></div>
              <ul className="divide-y divide-slate-100">
                {list.map(a => (
                  <li key={a.id} className="px-5 py-2 flex gap-3 items-start">
                    <span className="text-11.5 text-slate-400 w-11 shrink-0 pt-0.5 tabular-nums">{new Date(a.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                    <Badge tone={a.area === 'post' ? 'blue' : a.area === 'review' ? 'orange' : a.area === 'profile' ? 'violet' : a.area === 'photo' ? 'green' : 'gray'}>{AREAS[a.area]}</Badge>
                    <div className="min-w-0 flex-1"><div className="text-13 text-slate-900">{a.what}{a.actor ? <span className="text-slate-400"> · {a.actor}</span> : null}</div>
                      {(a.proof || a.link) && <div className="text-12 text-slate-500 break-words">{a.proof}{a.link && !String(a.proof).includes(a.link) ? <> <a href={a.link} target="_blank" rel="noreferrer noopener" className="text-indigo-600 hover:underline">Open</a></> : null}</div>}</div>
                  </li>))}
              </ul>
            </div>))}
        </div>
      )}
    </Card>
  );
}

export function SyncSection({ b, onSync, syncing }) {
  const live = useGbpLive(b);
  const d = live.data;
  return (
    <div className="space-y-3">
      <SectionHead title="Sync & History" subtitle="When this client's data was last pulled from Google, and what was done on the profile month by month" sources={['google']}>
        {d?.linked && <Button variant="primary" busy={syncing} onClick={onSync}>Sync now</Button>}
      </SectionHead>
      <Card title="Last synchronisation">
        {!d ? <Loading /> : <div className="text-13 text-slate-700">{d.linked ? <>Last synced <b>{ago(d.live?.synced_at || d.connection?.last_sync_at)}</b> ({fmtDateTime(d.live?.synced_at || d.connection?.last_sync_at)}). Data refreshes automatically on a schedule and while this page is open.</> : 'Not connected to Google, so nothing has been synced.'}{d.connection?.last_error && <div className="text-red-600 mt-1">{d.connection.last_error}</div>}</div>}
      </Card>
      <MonthHistory b={b} />
    </div>
  );
}

export function SettingsSection({ b, onConnect, toast = () => {} }) {
  const live = useGbpLive(b);
  const d = live.data;
  return (
    <div className="space-y-4">
      <SectionHead title="Settings & Integrations" subtitle="Google account, permissions and mapped location for this client" sources={['google', 'manual']} />
      {!d ? <SkList rows={4} avatar={false} /> : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
          <Card title="Connected Google account">
            {d.linked ? (
              <dl className="text-13 grid grid-cols-[140px_1fr] gap-y-2">
                <dt className="text-slate-500">Account</dt><dd className="text-slate-900">{d.connection?.email || '—'}</dd>
                <dt className="text-slate-500">Status</dt><dd><Badge tone={d.connection?.status === 'active' ? 'green' : 'amber'}>{d.connection?.status || 'unknown'}</Badge></dd>
                <dt className="text-slate-500">Account access role</dt><dd className="text-slate-900">{d.profile?.account || '—'}</dd>
                <dt className="text-slate-500">Mapped location</dt><dd className="text-slate-900 break-all">{b.gbp_location || '—'}</dd>
                <dt className="text-slate-500">Verification</dt><dd><VerifyPill state={d.verification} /></dd>
              </dl>
            ) : <p className="text-13 text-slate-600">No Google account is connected to this client.</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="primary" icon={PlugZap} onClick={() => onConnect?.('google')}>{d.linked ? 'Connect another account / add locations' : 'Connect Google account'}</Button>
              <Link to="/google-integrations"><Button>All connected accounts</Button></Link>
            </div>
          </Card>
          <Card title="Integrations">
            <p className="text-13 text-slate-600">Search Console, WordPress publishing and other connections are managed on the integrations page. Disconnecting a Google account is done there (admin only).</p>
            <Link to="/google-integrations"><Button className="mt-3">Open integrations</Button></Link>
          </Card>
          {d.linked && <VerificationCard b={b} state={d.verification} onChanged={() => live.reload(true)} toast={toast} />}
          {d.linked && <ManagersCard b={b} toast={toast} />}
          <AdvertiseCard />
          {d.linked && <div className="xl:col-span-2"><DangerCard b={b} onChanged={async () => { await refreshBusinesses(); live.reload(true); }} toast={toast} /></div>}
        </div>
      )}
    </div>
  );
}
