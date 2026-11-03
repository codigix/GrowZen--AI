import React from 'react';
import { Link } from 'react-router-dom';
import {
  LayoutDashboard, Store, BarChart3, Star, Newspaper, Image as ImageIcon, MapPinned, MessageCircleQuestion, Sparkles, Swords, Bot, FileText,
  ListTodo, History, Settings2, ArrowRight, Phone, Navigation, MousePointerClick, Search, Eye, CalendarCheck, CheckCircle2, Clock, PlugZap, Globe
} from 'lucide-react';
import { Card, Badge, Button, ErrorNote, ScoreRing, scoreWord, StatusPill, areaCls, useAction, useDoubleConfirm, Sk, SkStats, SkTable, SkList, SkScore, SkCard } from './SeoUi';
import { api, useApi, fmt, fmtDateTime } from './seoApi';
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
  { group: 'Optimization', items: [
    { id: 'local-seo', label: 'Local SEO', icon: MapPinned },
    { id: 'aeo', label: 'AEO', icon: MessageCircleQuestion },
    { id: 'geo', label: 'GEO', icon: Sparkles },
    { id: 'competitors', label: 'Competitor Analysis', icon: Swords },
    { id: 'ai', label: 'AI Recommendations', icon: Bot },
  ] },
  { group: 'Manage', items: [
    { id: 'reports', label: 'Reports', icon: FileText },
    { id: 'tasks', label: 'Tasks & Activities', icon: ListTodo },
    { id: 'sync', label: 'Sync History', icon: History },
    { id: 'settings', label: 'Settings & Integrations', icon: Settings2 },
  ] },
];
export const SECTION_IDS = SECTIONS.flatMap(g => g.items.map(i => i.id));
// Older ?tab= links still land in the right place.
export const TAB_ALIAS = { live: 'profile', hours: 'profile', faq: 'profile', audit: 'ai', insights: 'performance' };

/** Website traffic (Google Analytics 4) views, shown as an inner sidebar under the Performance item. */
export const TRAFFIC_VIEWS = [
  { id: 'snap', label: 'Reports snapshot' },
  { id: 'overview', label: 'Overview' },
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
export function ClientBar({ b, onConnect, onSync }) {
  const live = useApi(`/businesses/${b.id}/gbp/live`);
  const d = live.data;
  const connected = Boolean(d?.linked && d?.connection?.status === 'active');
  return (
    <div className="ai-glass-card rounded px-5 py-3.5 flex flex-wrap items-center gap-x-5 gap-y-2">
      <BusinessAvatar name={b.name} src={d?.profile?.logo || b.logo} size="w-12 h-12" />
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
      {d?.linked ? <Button size="sm" onClick={onSync}>Sync now</Button> : <Button size="sm" variant="primary" icon={PlugZap} onClick={() => onConnect?.('google')}>Connect Google account</Button>}
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

export function OverviewSection({ b, go, onOpen }) {
  const live = useApi(`/businesses/${b.id}/gbp/live`);
  const score = useApi(`/businesses/${b.id}/gbp/score`);
  const d = live.data;
  const m = d?.metrics;
  const linked = Boolean(d?.linked);
  const missing = score.data ? [...score.data.items].filter(i => !i.ok).sort((a, c) => (c.weight * (1 - c.score)) - (a.weight * (1 - a.score))).slice(0, 5) : [];
  return (
    <div className="space-y-4">
      <SectionHead title="Overview" subtitle="This client's Google Business Profile at a glance" sources={['google', 'calc']} />
      {!d ? <div className="space-y-4"><SkStats labels={["Average rating", "Search views · 30 days", "Calls · 30 days", "Website clicks · 30 days"]} /><div className="grid grid-cols-1 xl:grid-cols-3 gap-4"><SkCard title="Profile health score" subtitle="Calculated by Codigix from the profile; not a Google score"><SkScore /></SkCard><SkCard title="Fix next" subtitle="Highest-impact gaps first" className="xl:col-span-2"><SkList rows={4} avatar={false} /></SkCard></div></div> : (
        <>
          {!linked && <div className="rounded bg-amber-50 ring-1 ring-inset ring-amber-200 px-4 py-3 text-13 text-amber-900">This client has no Google account connected, so the numbers below are empty. Use <b>Connect Google account</b> above.</div>}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi icon={Star} label="Average rating" value={m.rating ? `${m.rating}★` : '—'} sub={`${fmt(m.review_count || 0)} reviews`} />
            <Kpi icon={Search} label="Search views · 30 days" value={fmt(m.views_search_30)} />
            <Kpi icon={Phone} label="Calls · 30 days" value={fmt(m.calls_30)} />
            <Kpi icon={MousePointerClick} label="Website clicks · 30 days" value={fmt(m.website_clicks_30)} />
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
            <Card title="Profile health score" subtitle="Calculated by Codigix from the profile; not a Google score" action={<SourceBadge type="calc" />}>
              {!score.data ? <SkScore /> : <div className="flex items-center gap-5"><ScoreRing score={score.data.score} label={scoreWord(score.data.score)} /><div className="text-13 text-slate-600">{score.data.alerts.length ? `${score.data.alerts.length} alert${score.data.alerts.length > 1 ? 's' : ''} need attention.` : 'No alerts.'}<button type="button" onClick={() => go('ai')} className="block mt-1 text-12.5 font-semibold text-indigo-600 hover:underline cursor-pointer">See all recommendations</button></div></div>}
            </Card>
            <Card title="Fix next" subtitle="Highest-impact gaps first" className="xl:col-span-2" action={<SourceBadge type="calc" />}>
              {!score.data ? <SkList rows={4} avatar={false} /> : missing.length === 0 ? <p className="text-13 text-slate-500 py-3">Nothing missing. The profile checklist is complete.</p> : (
                <ul className="divide-y divide-slate-100">{missing.map(i => <li key={i.key} className="py-2 flex items-start gap-3"><div className="flex-1 min-w-0"><div className="text-13 text-slate-900">{i.label}</div><div className="text-12 text-slate-500">{i.fix}</div></div><Badge tone="gray">{i.factor}</Badge></li>)}</ul>
              )}
            </Card>
          </div>
          <Card title="Quick actions" subtitle="Edits open here and are sent straight to your Google profile" pad>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[['profile', 'Edit profile and hours', true], ['reviews', `Reply to reviews${m.unreplied_reviews ? ` (${m.unreplied_reviews} unreplied)` : ''}`, true], ['posts', 'Create a post', true], ['photos', 'Photos and media', true], ['performance', 'Performance trends'], ['tasks', 'Tasks and activity'], ['reports', 'Reports'], ['settings', 'Connection settings']].map(([id, l, panel]) => (
                <button key={id} type="button" onClick={() => (panel && onOpen ? onOpen(id) : go(id))} className="flex items-center justify-between gap-2 px-3 py-2.5 rounded border border-slate-200 text-13 text-slate-700 hover:border-indigo-300 hover:bg-indigo-50/40 cursor-pointer text-left">{l}<ArrowRight size={13} className="text-slate-400 shrink-0" /></button>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

/** Every Google performance metric Google returns for the profile. Anything it does not return is said so, never faked. */
export function PerformanceMetrics({ b }) {
  const live = useApi(`/businesses/${b.id}/gbp/live`);
  const d = live.data;
  const m = d?.metrics;
  const kws = d?.live?.search_keywords || [];
  if (!d) return <div className="space-y-4"><SkStats cols="grid-cols-2 lg:grid-cols-4" labels={["Google Search impressions", "Google Maps impressions", "Website clicks", "Phone call clicks", "Direction requests", "Booking interactions", "Total profile views"]} /><SkCard title="Monthly search keywords" subtitle="Searches that showed the profile, by monthly impressions" pad={false}><SkTable headers={["Keyword", "Impressions"]} rows={6} bare /></SkCard></div>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={Search} label="Google Search impressions" value={fmt(m.views_search_30)} sub="30 days" />
        <Kpi icon={MapPinned} label="Google Maps impressions" value={fmt(m.views_maps_30)} sub="30 days" />
        <Kpi icon={MousePointerClick} label="Website clicks" value={fmt(m.website_clicks_30)} sub="30 days" />
        <Kpi icon={Phone} label="Phone call clicks" value={fmt(m.calls_30)} sub="30 days" />
        <Kpi icon={Navigation} label="Direction requests" value={fmt(m.directions_30)} sub="30 days" />
        <Kpi icon={CalendarCheck} label="Booking interactions" value={fmt(m.bookings_30)} sub="Only where the category is eligible" />
        <Kpi icon={Eye} label="Total profile views" value={fmt((m.views_search_30 || 0) + (m.views_maps_30 || 0))} sub="Search + Maps" />
      </div>
      <Card title="Monthly search keywords" subtitle="Searches that showed the profile, by monthly impressions (Google rounds low values to “< n”)" pad={false} action={<SourceBadge type="google" />}>
        {kws.length ? (
          <div className="max-h-96 overflow-auto"><table className="w-full text-13"><thead className="sticky top-0 bg-slate-50 text-11.5 text-slate-500"><tr><th className="px-5 py-2 text-left font-semibold">Keyword</th><th className="px-5 py-2 text-right font-semibold">Impressions</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{kws.slice(0, 100).map(k => <tr key={k.keyword}><td className="px-5 py-2 text-slate-800">{k.keyword}</td><td className="px-5 py-2 text-right tabular-nums">{k.impressions != null ? fmt(k.impressions) : <span className="text-slate-400">&lt; {k.below}</span>}</td></tr>)}</tbody></table></div>
        ) : <p className="text-13 text-slate-500 px-5 py-8 text-center">No keyword data from Google yet.</p>}
      </Card>
      <p className="text-12 text-slate-500">Desktop vs. mobile split, food-menu clicks and messaging clicks are shown only when Google returns them for this profile category; none were returned here, so none are shown.</p>
    </div>
  );
}

/** One review with its reply written, edited and posted right here (the reply goes to Google when posted). */
function ReviewRow({ b, r, toast, onChanged }) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState(r.reply || '');
  const [busy, error, run] = useAction();
  const draft = () => run('ai', async () => { const x = await api(`/businesses/${b.id}/reviews/${r.id}/draft`, { method: 'POST', body: { language: 'English' } }); setText(x.reply_text || ''); });
  const post = () => run('post', async () => {
    const out = await api(`/businesses/${b.id}/reviews/${r.id}/approve`, { method: 'POST', body: { text } });
    toast(out.task?.result?.posted ? 'Reply posted on your Google Business Profile' : "Reply saved, but this client isn't linked to Google, so post it from Google");
    setOpen(false); onChanged();
  });
  const [ask, confirmNode] = useDoubleConfirm();
  const remove = () => ask({ what: `your reply to ${r.author || 'this reviewer'}`, effect: 'The reply is removed from your Google Business Profile. The review itself stays.', onConfirm: () => run('del', async () => { await api(`/businesses/${b.id}/gbp/reviews/${r.id}/reply`, { method: 'DELETE' }); toast('Reply deleted from Google'); setText(''); setOpen(false); onChanged(); }) });
  return (
    <li className="text-13">
      {confirmNode}
      <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-slate-900">{r.author || 'Google user'}</span><span className="text-amber-500">{'★'.repeat(r.rating)}</span><span className="text-11.5 text-slate-400">{r.date}</span>{!r.replied && <Badge tone="amber">No reply</Badge>}</div>
      {r.body && <p className="text-slate-600 mt-0.5">{r.body}</p>}
      {r.reply && !open && <p className="mt-1 pl-3 border-l-2 border-slate-200 text-12.5 text-slate-500">{r.reply}</p>}
      {open ? (
        <div className="mt-2 space-y-2">
          <textarea rows={4} className={areaCls} value={text} onChange={e => setText(e.target.value)} placeholder="Write a reply, or let AI draft one and edit it" />
          <ErrorNote>{error}</ErrorNote>
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
  const rows = all.data.reviews.map(r => ({ id: r.id, author: r.author, rating: r.rating, body: r.body, date: r.review_date, replied: r.reply_status === 'posted', reply: r.reply_text }));
  const shown = onlyOpen ? rows.filter(r => !r.replied) : rows;
  const positive = [4, 5].reduce((s2, n) => s2 + (split[String(n)] || 0), 0);
  const negative = [1, 2].reduce((s2, n) => s2 + (split[String(n)] || 0), 0);
  const changed = () => { all.reload(true); live.reload(true); };
  const fetchNew = () => run('sync', async () => { const x = await api(`/businesses/${b.id}/sync`, { method: 'POST' }); toast(x.new_reviews ? `${x.new_reviews} new review${x.new_reviews === 1 ? '' : 's'} from Google` : 'No new reviews on Google'); changed(); });
  return (
    <div className="space-y-4">
      <SectionHead title="Reviews & Reputation" subtitle="Rating, distribution, and replies you write here go to Google" sources={['google', 'calc', 'ai']} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={Star} label="Average rating" value={m.rating ? `${m.rating}★` : '—'} sub="Google API" />
        <Kpi icon={Star} label="Total reviews" value={fmt(m.review_count || 0)} sub="Google API" />
        <Kpi icon={Star} label="Unanswered" value={fmt(sum.awaiting_reply)} sub="Codigix calculated" />
        <Kpi icon={Star} label="Response rate" value={sum.count ? `${sum.reply_rate}%` : '—'} sub={`Of ${sum.count} reviews · Codigix calculated`} />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
        <Card title="Rating distribution" action={<SourceBadge type="google" />}>
          <ul className="space-y-1.5">{[5, 4, 3, 2, 1].map(n => <li key={n} className="flex items-center gap-2 text-12"><span className="w-3 text-slate-500">{n}</span><span className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><span className="block h-full rounded-full bg-amber-400" style={{ width: `${total ? ((split[String(n)] || 0) / total) * 100 : 0}%` }} /></span><span className="w-8 text-right tabular-nums text-slate-500">{split[String(n)] || 0}</span></li>)}</ul>
          <div className="mt-3 flex flex-wrap gap-2 text-12"><StatusPill level="good">{positive} positive (4-5★)</StatusPill><StatusPill level={negative ? 'critical' : 'good'}>{negative} negative (1-2★)</StatusPill></div>
          <p className="text-11.5 text-slate-500 mt-2">Positive / negative is counted from star ratings. AI only drafts a reply: you edit it and choose to post.</p>
        </Card>
        <Card title="Reviews" className="xl:col-span-2" action={<Button size="sm" busy={syncing === 'sync'} onClick={fetchNew}>Fetch new reviews from Google</Button>}>
          <ErrorNote>{syncError}</ErrorNote>
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
    ['Backlink intelligence', 'Citation and authority analysis.', '/backlink-intelligence', 'external'],
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

export function TasksSection({ b }) {
  const pending = useApi(`/tasks?status=pending&business_id=${b.id}`);
  const activity = useApi(`/activity?business_id=${b.id}&limit=40`);
  return (
    <div className="space-y-4">
      <SectionHead title="Tasks & Activities" subtitle="Work waiting for approval and everything done on this client" sources={['calc', 'manual']}>
        <Link to="/automation"><Button>Open approvals</Button></Link>
      </SectionHead>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <Card title="Waiting for approval" subtitle={pending.data ? `${pending.data.length} task${pending.data.length === 1 ? '' : 's'}` : ''}>
          {!pending.data ? <Loading /> : pending.data.length === 0 ? <p className="text-13 text-slate-500 py-4 text-center">Nothing waiting.</p> : (
            <ul className="divide-y divide-slate-100 max-h-96 overflow-y-auto">{pending.data.map(t => <li key={t.id} className="py-2.5"><div className="text-13 text-slate-900">{t.title}</div><div className="text-11.5 text-slate-500">{t.kind || t.type} · created {fmtDateTime(t.created_at)}</div></li>)}</ul>
          )}
        </Card>
        <Card title="Activity history" subtitle="Latest changes, newest first">
          {!activity.data ? <Loading /> : activity.data.length === 0 ? <p className="text-13 text-slate-500 py-4 text-center">No activity yet.</p> : (
            <ul className="divide-y divide-slate-100 max-h-96 overflow-y-auto">{activity.data.map(a => <li key={a.id} className="py-2 flex gap-3"><span className="text-11.5 text-slate-400 w-24 shrink-0">{fmtDateTime(a.created_at)}</span><span className="text-13 text-slate-700 min-w-0"><b className="font-medium">{String(a.action || a.kind || '').replace(/_/g, ' ')}</b>{a.actor ? <span className="text-slate-500"> · {a.actor}</span> : null}</span></li>)}</ul>
          )}
        </Card>
      </div>
      <ErrorNote>{pending.error?.message || activity.error?.message}</ErrorNote>
    </div>
  );
}

export function SyncSection({ b, onSync, syncing }) {
  const live = useApi(`/businesses/${b.id}/gbp/live`);
  const activity = useApi(`/activity?business_id=${b.id}&limit=200`);
  const d = live.data;
  const events = (activity.data || []).filter(a => /sync|connect|import/i.test(String(a.action || a.kind || '')));
  return (
    <div className="space-y-4">
      <SectionHead title="Sync History" subtitle="When this client's data was last pulled from Google" sources={['google']}>
        {d?.linked && <Button variant="primary" busy={syncing} onClick={onSync}>Sync now</Button>}
      </SectionHead>
      <Card title="Last synchronisation">
        {!d ? <Loading /> : <div className="text-13 text-slate-700">{d.linked ? <>Last synced <b>{ago(d.live?.synced_at || d.connection?.last_sync_at)}</b> ({fmtDateTime(d.live?.synced_at || d.connection?.last_sync_at)}). Data refreshes automatically on a schedule and while this page is open.</> : 'Not connected to Google, so nothing has been synced.'}{d.connection?.last_error && <div className="text-red-600 mt-1">{d.connection.last_error}</div>}</div>}
      </Card>
      <Card title="Sync and connection events">
        {!activity.data ? <Loading /> : events.length === 0 ? <p className="text-13 text-slate-500 py-4 text-center">No sync events recorded for this client yet.</p> : (
          <ul className="divide-y divide-slate-100">{events.map(a => <li key={a.id} className="py-2 flex gap-3 text-13"><span className="text-11.5 text-slate-400 w-24 shrink-0">{fmtDateTime(a.created_at)}</span><span className="text-slate-700">{String(a.action || a.kind).replace(/_/g, ' ')}{a.actor ? <span className="text-slate-500"> · {a.actor}</span> : null}</span></li>)}</ul>
        )}
      </Card>
    </div>
  );
}

export function SettingsSection({ b, onConnect }) {
  const live = useApi(`/businesses/${b.id}/gbp/live`);
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
        </div>
      )}
    </div>
  );
}
