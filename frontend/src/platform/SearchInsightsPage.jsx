import React, { useState } from 'react';
import { ExternalLink, RefreshCw, Gauge } from 'lucide-react';
import { SeoShell, Card, Button, Badge, ErrorNote, SkList } from './SeoUi';
import { api, useApi } from './seoApi';

const TAB_CLS = (on) => `h-8 px-3 text-12.5 font-semibold rounded-md cursor-pointer whitespace-nowrap ${on ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800'}`;
const TH = 'px-3 py-2 text-left font-semibold text-11.5 text-slate-500 whitespace-nowrap';
const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN'));
const secs = (s) => (s == null ? '—' : s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);
const RATING = { GOOD: ['Good', 'green'], NEEDS_IMPROVEMENT: ['Needs improvement', 'amber'], POOR: ['Poor', 'red'] };

function Table({ head, children, empty }) {
  const rows = React.Children.toArray(children);
  if (!rows.length) return <p className="text-13 text-slate-500 px-1 py-2">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-13"><thead className="bg-slate-50"><tr>{head.map((h, i) => <th key={h} className={`${TH} ${i && !String(h).startsWith('_') ? '' : ''}`}>{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">{rows}</tbody></table>
    </div>
  );
}

const Path = ({ p, site }) => {
  const url = /^https?:/.test(p) ? p : `${(site || '').replace(/\/$/, '')}${p}`;
  return <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-700 hover:underline max-w-[340px] truncate" title={url}><span className="truncate">{p.replace(/^https?:\/\/[^/]+/, '') || '/'}</span><ExternalLink size={11} className="shrink-0" /></a>;
};

/** A section that could not be read says so, with Google's reason; one that has no rows says what that means. */
function Section({ title, subtitle, part, children, why }) {
  if (!part) return null;
  return (
    <Card title={title} subtitle={subtitle}>
      {part.state && part.state !== 'ok' ? <p className="text-13 text-amber-800 bg-amber-50 rounded px-3 py-2">{part.message || 'Not available right now.'}</p> : children}
      {why && <p className="mt-2 text-11.5 text-slate-500">{why}</p>}
    </Card>
  );
}

function Gate({ part, name }) {
  if (!part || part.state === 'ok') return null;
  return <Card><p className="text-13 text-amber-900">{name} is not available for this project: {part.message}</p></Card>;
}

function SearchConsole({ d, site }) {
  const s = d.search_console;
  if (s.state !== 'ok') return <Gate part={s} name="Search Console" />;
  const ix = s.index;
  return (
    <div className="space-y-4">
      <p className="text-12.5 text-slate-500">Search Console data for {s.property}, the last {s.period.days} days (to {s.period.end}). Read with {s.account}.</p>
      <Section title="Searches you do not track yet" subtitle="What people really typed before seeing your site, that is not in your keywords" part={s.untracked}
        why="Add the ones that fit your business to My Keywords: they already bring impressions, so they are the cheapest keywords to win.">
        {s.untracked.state === 'ok' && <>
          <p className="text-13 text-slate-600 mb-2"><b>{num(s.untracked.untracked)}</b> of the {num(s.untracked.total)} searches that showed your site are not tracked.</p>
          <Table head={['Search', 'Impressions', 'Clicks', 'Click rate', 'Position']} empty="Every search that showed your site is already in your keywords.">
            {s.untracked.rows.map(r => <tr key={r.query}><td className="px-3 py-2 font-medium text-slate-900">{r.query}</td><td className="px-3 py-2 tabular-nums">{num(r.impressions)}</td><td className="px-3 py-2 tabular-nums">{num(r.clicks)}</td><td className="px-3 py-2 tabular-nums">{r.ctr}%</td><td className="px-3 py-2 tabular-nums">{r.position}</td></tr>)}
          </Table></>}
      </Section>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Section title="Pages that show but are not clicked" subtitle="Position 3 to 12, clicked clearly less than usual for that position" part={s.low_ctr_pages} why="The usual click rate by position is an industry average: it only points to pages worth a better title and description.">
          <Table head={['Page', 'Position', 'Click rate', 'Usual', 'Clicks missing']} empty="No page with enough impressions earns clearly less than usual.">
            {s.low_ctr_pages.rows.map(r => <tr key={r.page}><td className="px-3 py-2"><Path p={r.page} site={d.website} /></td><td className="px-3 py-2 tabular-nums">{r.position}</td><td className="px-3 py-2 tabular-nums">{r.ctr}%</td><td className="px-3 py-2 tabular-nums">{r.expected_ctr}%</td><td className="px-3 py-2 tabular-nums font-semibold text-amber-700">~{num(r.clicks_missing)}</td></tr>)}
          </Table>
        </Section>
        <Section title="Searches that show but are not clicked" subtitle="The same check for the searches" part={s.low_ctr_queries}>
          <Table head={['Search', 'Position', 'Click rate', 'Usual', 'Clicks missing']} empty="No search with enough impressions earns clearly less than usual.">
            {s.low_ctr_queries.rows.map(r => <tr key={r.query}><td className="px-3 py-2 font-medium text-slate-900">{r.query}</td><td className="px-3 py-2 tabular-nums">{r.position}</td><td className="px-3 py-2 tabular-nums">{r.ctr}%</td><td className="px-3 py-2 tabular-nums">{r.expected_ctr}%</td><td className="px-3 py-2 tabular-nums font-semibold text-amber-700">~{num(r.clicks_missing)}</td></tr>)}
          </Table>
        </Section>
      </div>
      <Section title="Which pages Google indexed, and why not" subtitle="Google's own reason for each page it was asked about" part={ix} why="Pages are checked from Page Indexing. Press Check there to refresh Google's answers.">
        {ix.state === 'ok' && (ix.total === 0 ? <p className="text-13 text-slate-500">{ix.message}</p> : <>
          <div className="flex flex-wrap gap-2 mb-3">
            <Badge tone="green">{ix.states.indexed || 0} indexed</Badge><Badge tone="amber">{ix.states.not_indexed || 0} not indexed</Badge>{ix.states.blocked ? <Badge tone="red">{ix.states.blocked} blocked</Badge> : null}{ix.unchecked ? <Badge tone="gray">{ix.unchecked} not asked yet</Badge> : null}
          </div>
          <Table head={['Google says', 'Pages', 'Example']} empty="Google has not been asked about any page yet.">
            {ix.reasons.map(r => <tr key={r.reason}><td className="px-3 py-2 text-slate-900">{r.reason}</td><td className="px-3 py-2 tabular-nums">{r.pages}</td><td className="px-3 py-2">{r.example ? <Path p={r.example} site={d.website} /> : '—'}</td></tr>)}
          </Table></>)}
      </Section>
      <Section title="Sitemaps" subtitle="What Google read from each sitemap" part={s.sitemaps}>
        {s.sitemaps.state === 'ok' && (s.sitemaps.sitemaps.length ? <Table head={['Sitemap', 'Pages submitted', 'Errors', 'Warnings', 'Last read by Google']} empty="">
          {s.sitemaps.sitemaps.map(m => <tr key={m.path}><td className="px-3 py-2"><Path p={m.path} /></td><td className="px-3 py-2 tabular-nums">{m.submitted}</td><td className={`px-3 py-2 tabular-nums ${m.errors ? 'text-red-600 font-semibold' : ''}`}>{m.errors}</td><td className={`px-3 py-2 tabular-nums ${m.warnings ? 'text-amber-700 font-semibold' : ''}`}>{m.warnings}</td><td className="px-3 py-2">{m.last_read ? new Date(m.last_read).toLocaleDateString('en-GB') : 'Not read yet'}</td></tr>)}
        </Table> : <p className="text-13 text-amber-800">{s.sitemaps.message}</p>)}
      </Section>
      <Section title="Rich results Google found" subtitle="Structured data Google itself detected on your busiest pages" part={s.rich_results}>
        {s.rich_results.state === 'ok' && <Table head={['Page', 'Google found', 'Problems']} empty="">
          {s.rich_results.pages.map(p => <tr key={p.url}><td className="px-3 py-2"><Path p={p.url} /></td>
            <td className="px-3 py-2">{p.error ? <span className="text-slate-500">{p.error}</span> : p.types.length ? p.types.map(t => <Badge key={t.type} tone={t.errors ? 'red' : t.warnings ? 'amber' : 'green'}>{t.type}</Badge>) : <span className="text-slate-500">Nothing detected</span>}</td>
            <td className="px-3 py-2 text-12.5">{(p.types || []).filter(t => t.errors || t.warnings).map(t => <div key={t.type}>{t.type}: {t.errors} errors, {t.warnings} warnings{t.message ? ` (${t.message})` : ''}</div>)}</td></tr>)}
        </Table>}
      </Section>
    </div>
  );
}

function Speed({ b }) {
  const [on, setOn] = useState(false);
  const r = useApi(on ? `/businesses/${b.id}/search-insights/speed` : null);
  const data = r.data;
  const cell = (m) => { if (!m) return <span className="text-slate-400">—</span>; const [w, tone] = RATING[m.rating] || ['—', 'gray']; return <span className="inline-flex items-center gap-1.5"><Badge tone={tone}>{w}</Badge><span className="text-12 text-slate-500 tabular-nums">{m.p75 ?? ''}</span></span>; };
  return (
    <Card title="Speed for real visitors" subtitle="Core Web Vitals from real Chrome users (28 days), not a single test" action={!on && <Button size="sm" icon={Gauge} onClick={() => setOn(true)}>Read it</Button>}>
      {!on && <p className="text-13 text-slate-600">Reads Google's real-visitor speed data for the site. It takes about a minute.</p>}
      {on && !data && !r.error && <p className="text-13 text-slate-500">Reading Google's speed data…</p>}
      {r.error && <ErrorNote>{r.error.message}</ErrorNote>}
      {data?.state === 'error' && <p className="text-13 text-amber-800">{data.message}</p>}
      {data?.state === 'ok' && (data.message ? <p className="text-13 text-slate-600">{data.message}</p> : (
        <Table head={['Device', 'Largest Contentful Paint', 'Interaction to Next Paint', 'Layout Shift']} empty="">
          {['mobile', 'desktop'].map(dev => { const m = data[dev].page || data[dev].site; return <tr key={dev}><td className="px-3 py-2 capitalize font-medium">{dev}{!data[dev].page && data[dev].site ? <span className="text-11 text-slate-400"> (whole site)</span> : ''}</td><td className="px-3 py-2">{cell(m?.lcp)}</td><td className="px-3 py-2">{cell(m?.inp)}</td><td className="px-3 py-2">{cell(m?.cls)}</td></tr>; })}
        </Table>))}
    </Card>
  );
}

function Analytics({ d }) {
  const a = d.analytics;
  if (a.state !== 'ok') return <Gate part={a} name="Google Analytics 4" />;
  const eng = (r) => <><td className="px-3 py-2 tabular-nums">{num(r.sessions)}</td><td className="px-3 py-2 tabular-nums">{r.engagement_rate}%</td><td className="px-3 py-2 tabular-nums">{r.bounce_rate}%</td><td className="px-3 py-2 tabular-nums">{secs(r.avg_engagement_seconds)}</td><td className="px-3 py-2 tabular-nums">{num(r.key_events)}</td></>;
  const H = ['Sessions', 'Engaged', 'Bounce', 'Time per visit', 'Key events'];
  return (
    <div className="space-y-4">
      <p className="text-12.5 text-slate-500">Analytics 4 property {a.property_name || a.property}, the last {a.period.days} days (to {a.period.end}).</p>
      <Section title="Organic landing pages" subtitle="Visitors who arrived from Google search: do they stay and act?" part={{ state: 'ok' }} why="Engaged = a visit longer than 10 seconds, with a key event or 2+ pages. Bounce is the opposite.">
        <Table head={['Landing page', ...H, 'Conversion']} empty="No organic landing-page visits were recorded in this period.">
          {a.landing_pages.rows.map(r => <tr key={r.path}><td className="px-3 py-2"><Path p={r.path} site={d.website} /></td>{eng(r)}<td className="px-3 py-2 tabular-nums">{r.conversion_rate}%</td></tr>)}
        </Table>
      </Section>
      <Section title="Where each landing page's visitors come from" subtitle="Organic search apart from social, referral, direct and paid" part={{ state: 'ok' }}>
        <Table head={['Landing page', 'Sessions', 'Channels']} empty="No visits were recorded.">
          {a.landing_channels.rows.map(r => <tr key={r.path}><td className="px-3 py-2"><Path p={r.path} site={d.website} /></td><td className="px-3 py-2 tabular-nums">{num(r.total)}</td><td className="px-3 py-2"><div className="flex flex-wrap gap-1.5">{r.channels.map(c => <span key={c.channel} className="px-2 py-0.5 rounded-full bg-slate-100 text-12 text-slate-700">{c.channel} <b className="tabular-nums">{c.share}%</b></span>)}</div></td></tr>)}
        </Table>
      </Section>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Section title="Conversions and actions" subtitle="Key events your property counts, and other events visitors trigger" part={{ state: 'ok' }}>
          {a.events.message && <p className="text-13 text-amber-800 bg-amber-50 rounded px-3 py-2 mb-2">{a.events.message}</p>}
          {a.events.key.length > 0 && <Table head={['Key event', 'Times']} empty=""> {a.events.key.map(e => <tr key={e.event}><td className="px-3 py-2 font-medium">{e.event}</td><td className="px-3 py-2 tabular-nums">{num(e.count)}</td></tr>)}</Table>}
          {a.events.other.length > 0 && <div className="mt-3"><div className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Other events (not marked as key)</div><div className="flex flex-wrap gap-1.5">{a.events.other.map(e => <span key={e.event} className="px-2.5 py-1 rounded-full bg-slate-100 text-12.5 text-slate-800">{e.event} <b className="tabular-nums">{num(e.count)}</b></span>)}</div></div>}
        </Section>
        <Section title="New and returning visitors" subtitle="Whether visitors come back" part={{ state: 'ok' }}>
          <Table head={['Visitors', 'People', 'Engaged', 'Key events']} empty="No data.">
            {a.returning.rows.map(r => <tr key={r.kind}><td className="px-3 py-2 font-medium capitalize">{r.kind}</td><td className="px-3 py-2 tabular-nums">{num(r.users)}</td><td className="px-3 py-2 tabular-nums">{r.engagement_rate}%</td><td className="px-3 py-2 tabular-nums">{num(r.key_events)}</td></tr>)}
          </Table>
        </Section>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Section title="Phones against computers" subtitle="How each device engages and converts" part={{ state: 'ok' }}>
          <Table head={['Device', ...H]} empty="No data.">{a.devices.rows.map(r => <tr key={r.device}><td className="px-3 py-2 font-medium capitalize">{r.device}</td>{eng(r)}</tr>)}</Table>
        </Section>
        <Section title="Cities" subtitle="Where engaged visitors are" part={{ state: 'ok' }}>
          <Table head={['City', ...H]} empty="No city data.">{a.cities.rows.map(r => <tr key={r.city}><td className="px-3 py-2 font-medium">{r.city}</td>{eng(r)}</tr>)}</Table>
        </Section>
      </div>
      {Object.keys(a.errors || {}).length > 0 && <p className="text-12 text-amber-800">Google refused {Object.keys(a.errors).length} report(s): {Object.values(a.errors)[0]}</p>}
    </div>
  );
}

function Together({ d }) {
  const j = d.joined || {};
  const ch = j.changes;
  const none = (p) => p && p.state !== 'ok';
  return (
    <div className="space-y-4">
      <Section title="Did the AI changes move clicks?" subtitle="Google clicks in the 14 days before the latest applied changes, against the 14 days after" part={ch && { state: 'ok' }}>
        {ch?.state === 'ok' ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[['Before', ch.before], ['After', ch.after]].map(([l, x]) => <div key={l} className="rounded-lg ring-1 ring-slate-200 p-3"><div className="text-12 text-slate-500">{l} ({ch.batch} changes on {ch.anchor})</div><div className="text-22 font-bold tabular-nums">{num(x.clicks)} clicks</div><div className="text-12 text-slate-500">{num(x.impressions)} impressions · position {x.position ?? '—'}</div></div>)}
            <div className="rounded-lg ring-1 ring-slate-200 p-3"><div className="text-12 text-slate-500">Change in clicks</div><div className={`text-22 font-bold tabular-nums ${(ch.change.clicks || 0) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{ch.change.clicks == null ? '—' : `${ch.change.clicks > 0 ? '+' : ''}${ch.change.clicks}%`}</div><div className="text-12 text-slate-500">{ch.note}</div></div>
          </div>) : <p className="text-13 text-slate-600">{ch?.message}</p>}
      </Section>
      <Section title="Visitors arrive but do not engage or act" subtitle="Organic landing pages with many visits and a weak result" part={none(j.engagement_gaps) ? j.engagement_gaps : { state: 'ok' }}>
        <Table head={['Page', 'Organic visits', 'Engaged', 'Key events', 'Why', 'What to check']} empty="No busy organic page has a weak engagement or conversion.">
          {(j.engagement_gaps?.rows || []).map(r => <tr key={r.path}><td className="px-3 py-2"><Path p={r.path} site={d.website} /></td><td className="px-3 py-2 tabular-nums">{num(r.organic_sessions)}</td><td className="px-3 py-2 tabular-nums">{r.engagement_rate}%</td><td className="px-3 py-2 tabular-nums">{r.key_events}</td><td className="px-3 py-2 text-12.5">{r.why}</td><td className="px-3 py-2 text-12.5 text-slate-600">{r.fix}</td></tr>)}
        </Table>
      </Section>
      <Section title="Indexed but unseen pages" subtitle="Google has them, nobody sees or visits them" part={none(j.zombies) ? j.zombies : { state: 'ok' }} why={j.zombies?.basis}>
        {j.zombies?.state === 'ok' && <>
          <p className="text-13 text-slate-600 mb-2"><b>{j.zombies.count}</b> of {j.zombies.of} indexed pages. {j.zombies.fix}</p>
          <Table head={['Page', 'Last crawled by Google']} empty="Every indexed page shows in search results.">{j.zombies.rows.map(r => <tr key={r.url}><td className="px-3 py-2"><Path p={r.url} /></td><td className="px-3 py-2">{r.last_crawl ? new Date(r.last_crawl).toLocaleDateString('en-GB') : '—'}</td></tr>)}</Table></>}
      </Section>
    </div>
  );
}

function NotAvailable({ d }) {
  return (
    <Card title="What Google does not give through an API" subtitle="These are real signals, but they can only be seen in Google's own screens">
      <ul className="space-y-2">{d.not_available.map(n => <li key={n.item} className="rounded-lg ring-1 ring-slate-200 px-4 py-2.5"><div className="text-13 font-semibold text-slate-900">{n.item}</div><div className="text-12.5 text-slate-600 mt-0.5">{n.why} <span className="text-slate-500">Look in: {n.where}</span></div></li>)}</ul>
    </Card>
  );
}

function Insights({ b }) {
  const [tab, setTab] = useState('search');
  const [busy, setBusy] = useState(false);
  const r = useApi(`/businesses/${b.id}/search-insights`);
  if (r.error) return <Card><ErrorNote>{r.error.message}</ErrorNote></Card>;
  if (!r.data) return <SkList rows={6} />;
  const d = r.data;
  const refresh = async () => { setBusy(true); try { await api(`/businesses/${b.id}/search-insights?refresh=true`, { timeout: 170000 }); await r.reload(true); } finally { setBusy(false); } };
  const tabs = [['search', 'Search Console'], ['speed', 'Speed'], ['analytics', 'Analytics'], ['together', 'Together'], ['na', 'Not available']];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-0.5 p-0.5 bg-slate-100 rounded-lg overflow-x-auto" role="tablist">{tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={TAB_CLS(tab === id)}>{label}</button>)}</div>
        <Button size="sm" variant="secondary" icon={RefreshCw} busy={busy} onClick={refresh} className="ml-auto">Refresh</Button>
      </div>
      {tab === 'search' && <SearchConsole d={d} />}
      {tab === 'speed' && <Speed b={b} />}
      {tab === 'analytics' && <Analytics d={d} />}
      {tab === 'together' && <Together d={d} />}
      {tab === 'na' && <NotAvailable d={d} />}
    </div>
  );
}

export default function SearchInsightsPage() {
  return (
    <SeoShell step="track" title="Search & Visitor Insights" subtitle="What Google Search Console and Google Analytics 4 know about your site that a crawl and a rank tracker cannot see.">
      {(b) => <Insights key={b.id} b={b} />}
    </SeoShell>
  );
}
