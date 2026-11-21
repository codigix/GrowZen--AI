import React, { createContext, useContext, useState } from 'react';
import { ExternalLink, RefreshCw, Gauge, ClipboardCheck, Plus, Check } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { SeoShell, Card, Button, Badge, ErrorNote, SkList, Modal } from './SeoUi';
import { Act } from './TableBits';
import { api, useApi, usePoll } from './seoApi';

const TAB_CLS = (on) => `h-8 px-3 text-12.5 font-semibold rounded-md cursor-pointer whitespace-nowrap ${on ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800'}`;
const TH = 'px-3 py-2 text-left font-semibold text-11.5 text-slate-500 whitespace-nowrap';
const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN'));
const secs = (s) => (s == null ? '—' : s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);
const RATING = { GOOD: ['Good', 'green'], NEEDS_IMPROVEMENT: ['Needs improvement', 'amber'], POOR: ['Poor', 'red'] };

const ago = (iso) => {
  if (!iso) return 'not read yet';
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

/** When the stored data was read, and that a refresh is running in the background. The page shows the stored data at once and swaps in the new data when it arrives. */
function Freshness({ snap, onRefresh }) {
  const busy = Boolean(snap?.refreshing);
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-12 text-slate-500">
      <span title={snap?.fetched_at ? new Date(snap.fetched_at).toLocaleString('en-GB') : ''}>Updated {ago(snap?.fetched_at)}{snap?.every_hours ? ` · refreshes itself every ${snap.every_hours} h` : ''}</span>
      {snap?.error && !busy && <span className="text-amber-700" title={snap.error}>last refresh failed</span>}
      <Button size="sm" variant="secondary" icon={RefreshCw} busy={busy} disabled={busy} onClick={onRefresh}>{busy ? 'Refreshing…' : 'Refresh now'}</Button>
    </span>
  );
}

/** Nothing is stored yet: the first read of Google is running in the background. */
function FirstRead({ what }) {
  return <Card><div className="flex items-center gap-3"><RefreshCw size={16} className="animate-spin text-indigo-600 shrink-0" /><p className="text-13 text-slate-700">Reading {what} for the first time. This takes up to a minute; it is stored, so the next time this page opens at once. It appears here by itself.</p></div></Card>;
}

const G = { blue: '#4285f4', purple: '#7e57c2', green: '#0f9d58', orange: '#f4811f' };
const shortDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** One metric tile, in the style of Google's own reports: coloured when switched on, with the change against the period before. */
function MetricTile({ label, value, change, color, on, onClick, sub }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} disabled={!onClick}
      className={`text-left rounded-xl px-4 py-3 min-w-[150px] flex-1 transition-colors ${onClick ? 'cursor-pointer' : 'cursor-default'} ${on ? 'text-white shadow-sm' : 'bg-white ring-1 ring-slate-200 text-slate-900 hover:ring-slate-300'}`}
      style={on ? { background: color } : undefined}>
      <div className={`text-12 font-medium ${on ? 'text-white/90' : 'text-slate-500'}`}>{label}</div>
      <div className="text-26 font-bold tabular-nums leading-tight mt-0.5">{value}</div>
      <div className={`text-11.5 mt-0.5 ${on ? 'text-white/85' : change == null ? 'text-slate-500' : change > 0 ? 'text-emerald-700' : change === 0 ? 'text-slate-500' : 'text-red-600'}`}>{sub ?? (change == null ? 'no change figure' : `${change > 0 ? '+' : ''}${change}% vs the period before`)}</div>
    </button>
  );
}

/** Clicks, impressions, click rate and position with a daily line chart: the look of Google Search Console's Performance report. */
function Performance({ o }) {
  const [on, setOn] = useState({ clicks: true, impressions: true, ctr: false, position: false });
  const [view, setView] = useState('queries');
  if (!o || o.state !== 'ok') return o ? <Card><p className="text-13 text-amber-800">{o.message}</p></Card> : null;
  const t = o.totals, pv = o.previous, ch = o.change;
  const dpp = (a, b) => Math.round((a - b) * 10) / 10;
  const signed = (n) => `${n > 0 ? '+' : ''}${n}`;
  const tiles = [
    { k: 'clicks', label: 'Total clicks', value: num(t.clicks), change: ch.clicks, color: G.blue, sub: ch.clicks == null ? `${num(pv.clicks)} in the period before` : undefined },
    { k: 'impressions', label: 'Total impressions', value: num(t.impressions), change: ch.impressions, color: G.purple },
    { k: 'ctr', label: 'Average click rate', value: `${t.ctr}%`, color: G.green, sub: pv.ctr ? `${signed(dpp(t.ctr, pv.ctr))} points vs before` : 'no figure before' },
    { k: 'position', label: 'Average position', value: t.position ?? '—', color: G.orange, sub: pv.position && t.position ? `${signed(dpp(t.position, pv.position))} vs before (lower is better)` : 'no figure before' },
  ];
  const lines = tiles.filter(x => on[x.k]);
  const views = [['queries', 'Searches'], ['pages', 'Pages'], ['devices', 'Devices'], ['countries', 'Countries']];
  const rows = o[view] || [];
  const key = { queries: 'query', pages: 'page', devices: 'device', countries: 'code' }[view];
  const maxImp = Math.max(1, ...rows.map(r => r.impressions));
  return (
    <section className="rounded-xl bg-white ring-1 ring-slate-200 shadow-sm overflow-hidden">
      <div className="flex flex-wrap gap-2.5 p-4">{tiles.map(x => <MetricTile key={x.k} {...x} on={on[x.k]} onClick={() => setOn(v => ({ ...v, [x.k]: !v[x.k] }))} />)}</div>
      <div className="px-2 pb-2 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={o.series} margin={{ top: 8, right: 14, left: 6, bottom: 0 }}>
            <CartesianGrid stroke="#eef0f3" vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11, fill: '#64748b' }} minTickGap={36} axisLine={false} tickLine={false} />
            {tiles.map(x => <YAxis key={x.k} yAxisId={x.k} hide reversed={x.k === 'position'} domain={x.k === 'position' ? [1, 'auto'] : [0, 'auto']} />)}
            <Tooltip labelFormatter={shortDate} formatter={(v, n) => [n === 'Average click rate' ? `${v}%` : v, n]} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
            {lines.map(x => <Line key={x.k} yAxisId={x.k} type="monotone" dataKey={x.k} name={x.label} stroke={x.color} strokeWidth={2} dot={false} connectNulls />)}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="border-t border-slate-200">
        <div className="flex gap-1 px-3 pt-2 border-b border-slate-200">{views.map(([id, label]) => <button key={id} type="button" onClick={() => setView(id)} className={`px-3 py-2 text-13 font-medium cursor-pointer border-b-2 -mb-px ${view === id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{label}</button>)}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-13">
            <thead><tr className="text-11.5 text-slate-500"><th className={TH}>{{ queries: 'Top searches', pages: 'Top pages', devices: 'Device', countries: 'Country' }[view]}</th><th className={`${TH} text-right`} style={{ color: G.blue }}>Clicks</th><th className={`${TH} text-right`} style={{ color: G.purple }}>Impressions</th><th className={`${TH} text-right`}>Click rate</th><th className={`${TH} text-right`}>Position</th><th className={`${TH} text-right`}>Actions</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => (
                <tr key={r[key]} className="hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-900 max-w-[420px]">{view === 'pages' ? <Path p={r.page} /> : <span className={view === 'devices' ? 'capitalize' : ''}>{r[key]}</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{num(r.clicks)}</td>
                  <td className="px-3 py-2 text-right tabular-nums"><span className="inline-flex items-center gap-2 justify-end"><span className="hidden sm:block h-1.5 rounded-full" style={{ width: Math.max(2, (r.impressions / maxImp) * 70), background: `${G.purple}55` }} />{num(r.impressions)}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.ctr}%</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.position}</td>
                  <td className={ACT_TD}>{view === 'queries' ? <KeywordAction q={r.query} /> : view === 'pages' ? <PageActions url={r.page} /> : null}</td>
                </tr>))}
              {!rows.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">Nothing to show for this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/** The same overview for Analytics 4: visitors, visits, engagement and conversions. */
function VisitorsOverview({ a }) {
  const [on, setOn] = useState({ sessions: true, users: true, key_events: false });
  const t = a.totals;
  const tiles = [
    { k: 'users', label: 'Visitors', value: num(t.users), color: G.blue }, { k: 'sessions', label: 'Visits', value: num(t.sessions), color: G.purple },
    { k: 'engagement', label: 'Engaged visits', value: `${t.engagement_rate}%`, color: G.green, sub: `${secs(t.avg_engagement_seconds)} average time per visit` },
    { k: 'key_events', label: 'Key events', value: num(t.key_events), color: G.orange, sub: t.key_events ? 'conversions counted' : 'none marked yet' },
  ];
  const lines = tiles.filter(x => on[x.k] && x.k !== 'engagement');
  return (
    <section className="rounded-xl bg-white ring-1 ring-slate-200 shadow-sm overflow-hidden">
      <div className="flex flex-wrap gap-2.5 p-4">{tiles.map(x => <MetricTile key={x.k} {...x} sub={x.sub ?? 'in this period'} on={on[x.k]} onClick={x.k === 'engagement' ? undefined : () => setOn(v => ({ ...v, [x.k]: !v[x.k] }))} />)}</div>
      <div className="px-2 pb-2 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={a.series} margin={{ top: 8, right: 14, left: 6, bottom: 0 }}>
            <CartesianGrid stroke="#eef0f3" vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11, fill: '#64748b' }} minTickGap={36} axisLine={false} tickLine={false} />
            {tiles.map(x => <YAxis key={x.k} yAxisId={x.k} hide domain={[0, 'auto']} />)}
            <Tooltip labelFormatter={shortDate} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
            {lines.map(x => <Line key={x.k} yAxisId={x.k} type="monotone" dataKey={x.k} name={x.label} stroke={x.color} strokeWidth={2} dot={false} />)}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

const Ctx = createContext(null);
const ACT_TD = 'px-3 py-2 text-right whitespace-nowrap';
const LEVEL = { critical: ['Fix now', 'red'], warning: ['Improve', 'amber'], info: ['Consider', 'blue'], good: ['Good', 'green'] };

/** What a row can do with a page of the site: open it, or read it and list what to fix. */
function PageActions({ url }) {
  const c = useContext(Ctx);
  const abs = /^https?:/.test(url) ? url : `${(c.site || '').replace(/\/$/, '')}${url.startsWith('/') ? url : `/${url}`}`;
  return (
    <span className="inline-flex gap-1.5">
      <Act icon={ClipboardCheck} tone="indigo" tip="Check page: read this page of your website and list what to fix" onClick={() => c.check(url)}>Check</Act>
      <a href={abs} target="_blank" rel="noreferrer noopener"><Act icon={ExternalLink} tone="slate" tip="Open: show the page in a new tab">Open</Act></a>
    </span>
  );
}

/** Put a search that already shows your site on Google into My Keywords. */
function KeywordAction({ q }) {
  const c = useContext(Ctx);
  const done = c.added.has(q.toLowerCase());
  return <Act icon={done ? Check : Plus} tone={done ? 'green' : 'teal'} busy={c.adding === q} disabled={done} tip={done ? 'Added to My Keywords' : 'Add keyword: put this search in My Keywords'} onClick={() => c.addKeywords([q])}>{done ? 'Added' : 'Add keyword'}</Act>;
}

function CheckModal({ s, onClose }) {
  const r = s?.res;
  return (
    <Modal open={Boolean(s)} onClose={onClose} width="max-w-3xl" title={s ? `Check page: ${(s.url || '').replace(/^https?:\/\/[^/]+/, '') || '/'}` : ''}>
      {s?.loading && <p className="text-13 text-slate-500">Reading the page on your website…</p>}
      {s?.error && <ErrorNote>{s.error}</ErrorNote>}
      {r && (
        <div className="max-h-[70vh] overflow-y-auto pr-1 space-y-4">
          <div className="flex flex-wrap gap-2 items-center"><Badge tone={r.summary.problems ? 'amber' : 'green'}>{r.summary.problems} to fix</Badge><Badge tone="green">{r.summary.good} good</Badge><a href={r.url} target="_blank" rel="noreferrer" className="text-12.5 text-indigo-700 hover:underline inline-flex items-center gap-1">{r.url}<ExternalLink size={11} /></a></div>
          {r.google && !r.google.error && <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">{[['Clicks', r.google.clicks, G.blue], ['Impressions', num(r.google.impressions), G.purple], ['Click rate', `${r.google.ctr}%`, G.green], ['Position', r.google.position ?? '—', G.orange]].map(([l, v, col]) => <div key={l} className="rounded-lg ring-1 ring-slate-200 px-3 py-2"><div className="text-11.5 text-slate-500">{l} (Google, 90 days)</div><div className="text-20 font-bold tabular-nums" style={{ color: col }}>{v}</div></div>)}</div>}
          {r.google?.queries?.length > 0 && <div><div className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Searches that show this page</div><div className="flex flex-wrap gap-1.5">{r.google.queries.map(q => <span key={q.query} className="px-2.5 py-1 rounded-full bg-slate-100 text-12.5 text-slate-800">{q.query} <b className="tabular-nums">{q.impressions}</b></span>)}</div></div>}
          <ul className="space-y-2">{r.findings.map((f, i) => { const [w, tone] = LEVEL[f.level] || LEVEL.info; return <li key={i} className="rounded-lg ring-1 ring-slate-200 px-4 py-2.5 flex gap-3 items-start"><Badge tone={tone}>{w}</Badge><div><div className="text-13 font-semibold text-slate-900">{f.title}</div>{f.fix && <div className="text-12.5 text-slate-600 mt-0.5">{f.fix}</div>}</div></li>; })}</ul>
          <details className="text-12.5 text-slate-600"><summary className="cursor-pointer font-semibold">What the page says now</summary>
            <div className="mt-2 space-y-1"><div><b>Title:</b> {r.facts.title || '—'}</div><div><b>Description:</b> {r.facts.description || '—'}</div><div><b>Main heading:</b> {r.facts.h1.join(' | ') || '—'}</div></div></details>
          <p className="text-11.5 text-slate-500">Read from your own website the way a crawler first sees it, before JavaScript runs. Only pages of this project's website can be checked.</p>
        </div>)}
    </Modal>
  );
}

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
  const todo = (part.steps || []).filter(x => x.action || x.detail);
  return (
    <Card title={`${name} is not available yet`} subtitle="What is missing, and what to do">
      {!todo.length && <p className="text-13 text-amber-900">{part.message}</p>}
      {todo.length > 0 && <ul className="space-y-2">{todo.map((x, i) => <li key={i} className="rounded-lg ring-1 ring-amber-200 bg-amber-50/60 px-4 py-2.5"><div className="text-13 font-semibold text-slate-900">{x.label}</div><div className="text-12.5 text-slate-700 mt-0.5">{x.detail}</div>{x.url && <a href={x.url} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-12.5 font-semibold text-indigo-700 hover:underline">{x.button || 'Open'}<ExternalLink size={12} /></a>}</li>)}</ul>}
      {part.site_tag && <p className="mt-3 text-12.5 text-slate-700 rounded-lg bg-slate-50 ring-1 ring-slate-200 px-3 py-2">Your website sends its visitors to the Google Analytics tag <b className="font-mono">{part.site_tag}</b>. In Google Analytics, open the property that has this measurement ID (Admin &gt; Data streams) and add the linked Google account there as a Viewer. If that property is in another Google account, link that account to this project instead.</p>}
      <p className="mt-2 text-11.5 text-slate-500">Business Profile access does not include website visitors: Analytics is a separate Google permission and a separate property. Search Console data above works without it.</p>
    </Card>
  );
}

function SearchConsole({ d, site }) {
  const s = d.search_console;
  if (s.state !== 'ok') return <Gate part={s} name="Search Console" />;
  const ix = s.index;
  return (
    <div className="space-y-4">
      <p className="text-12.5 text-slate-500">Search Console · <b className="text-slate-700">{s.property}</b> · last {s.period.days} days to {s.period.end} · read with {s.account}</p>
      <Performance o={s.overview} />
      <Section title="Searches you do not track yet" subtitle="What people really typed before seeing your site, that is not in your keywords" part={s.untracked}
        why="Add the ones that fit your business to My Keywords: they already bring impressions, so they are the cheapest keywords to win.">
        {s.untracked.state === 'ok' && <>
          <p className="text-13 text-slate-600 mb-2"><b>{num(s.untracked.untracked)}</b> of the {num(s.untracked.total)} searches that showed your site are not tracked.</p>
          <Table head={['Search', 'Impressions', 'Clicks', 'Click rate', 'Position', 'Actions']} empty="Every search that showed your site is already in your keywords.">
            {s.untracked.rows.map(r => <tr key={r.query}><td className="px-3 py-2 font-medium text-slate-900">{r.query}</td><td className="px-3 py-2 tabular-nums">{num(r.impressions)}</td><td className="px-3 py-2 tabular-nums">{num(r.clicks)}</td><td className="px-3 py-2 tabular-nums">{r.ctr}%</td><td className="px-3 py-2 tabular-nums">{r.position}</td><td className={ACT_TD}><KeywordAction q={r.query} /></td></tr>)}
          </Table>
          {s.untracked.rows.length > 1 && <div className="mt-2"><AddAll list={s.untracked.rows.map(r => r.query)} /></div>}</>}
      </Section>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Section title="Pages that show but are not clicked" subtitle="Position 3 to 12, clicked clearly less than usual for that position" part={s.low_ctr_pages} why="The usual click rate by position is an industry average: it only points to pages worth a better title and description.">
          <Table head={['Page', 'Position', 'Click rate', 'Usual', 'Clicks missing', 'Actions']} empty="No page with enough impressions earns clearly less than usual.">
            {s.low_ctr_pages.rows.map(r => <tr key={r.page}><td className="px-3 py-2"><Path p={r.page} site={d.website} /></td><td className="px-3 py-2 tabular-nums">{r.position}</td><td className="px-3 py-2 tabular-nums">{r.ctr}%</td><td className="px-3 py-2 tabular-nums">{r.expected_ctr}%</td><td className="px-3 py-2 tabular-nums font-semibold text-amber-700">~{num(r.clicks_missing)}</td><td className={ACT_TD}><PageActions url={r.page} /></td></tr>)}
          </Table>
        </Section>
        <Section title="Searches that show but are not clicked" subtitle="The same check for the searches" part={s.low_ctr_queries}>
          <Table head={['Search', 'Position', 'Click rate', 'Usual', 'Clicks missing', 'Actions']} empty="No search with enough impressions earns clearly less than usual.">
            {s.low_ctr_queries.rows.map(r => <tr key={r.query}><td className="px-3 py-2 font-medium text-slate-900">{r.query}</td><td className="px-3 py-2 tabular-nums">{r.position}</td><td className="px-3 py-2 tabular-nums">{r.ctr}%</td><td className="px-3 py-2 tabular-nums">{r.expected_ctr}%</td><td className="px-3 py-2 tabular-nums font-semibold text-amber-700">~{num(r.clicks_missing)}</td><td className={ACT_TD}><KeywordAction q={r.query} /></td></tr>)}
          </Table>
        </Section>
      </div>
      <Section title="Which pages Google indexed, and why not" subtitle="Google's own reason for each page it was asked about" part={ix} why="Pages are checked from Page Indexing. Press Check there to refresh Google's answers.">
        {ix.state === 'ok' && (ix.total === 0 ? <p className="text-13 text-slate-500">{ix.message}</p> : <>
          <div className="flex flex-wrap gap-2 mb-3">
            <Badge tone="green">{ix.states.indexed || 0} indexed</Badge><Badge tone="amber">{ix.states.not_indexed || 0} not indexed</Badge>{ix.states.blocked ? <Badge tone="red">{ix.states.blocked} blocked</Badge> : null}{ix.unchecked ? <Badge tone="gray">{ix.unchecked} not asked yet</Badge> : null}
          </div>
          <Table head={['Google says', 'Pages', 'Example', 'Actions']} empty="Google has not been asked about any page yet.">
            {ix.reasons.map(r => <tr key={r.reason}><td className="px-3 py-2 text-slate-900">{r.reason}</td><td className="px-3 py-2 tabular-nums">{r.pages}</td><td className="px-3 py-2">{r.example ? <Path p={r.example} site={d.website} /> : '—'}</td><td className={ACT_TD}>{r.example ? <PageActions url={r.example} /> : null}</td></tr>)}
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
  const r = useApi(`/businesses/${b.id}/search-insights/speed`);
  usePoll(() => r.reload(true), Boolean(r.data?.refreshing), 4000);
  const snap = r.data;
  const data = snap?.data;
  const refreshSpeed = async () => { await api(`/businesses/${b.id}/search-insights/refresh?kind=speed`, { method: 'POST' }); await r.reload(true); };
  const cell = (m) => { if (!m) return <span className="text-slate-400">—</span>; const [w, tone] = RATING[m.rating] || ['—', 'gray']; return <span className="inline-flex items-center gap-1.5"><Badge tone={tone}>{w}</Badge><span className="text-12 text-slate-500 tabular-nums">{m.p75 ?? ''}</span></span>; };
  return (
    <Card title="Speed for real visitors" subtitle="Core Web Vitals from real Chrome users (28 days), not a single test" action={<Freshness snap={snap} onRefresh={refreshSpeed} />}>
      {snap && !data && <p className="text-13 text-slate-500">{snap.refreshing ? "Reading Google's speed data for the first time (about a minute). It appears here by itself." : snap.error || 'No speed data yet.'}</p>}
      {r.error && <ErrorNote>{r.error.message}</ErrorNote>}
      {data?.state === 'error' && <p className="text-13 text-amber-800">{data.message}</p>}
      {data?.state === 'ok' && (data.message ? (
        <div className="space-y-3">
          <p className="text-13 text-slate-600">{data.message} This is normal for a site with little traffic: Google only publishes the figures once enough real Chrome visitors have loaded the site.</p>
          <div className="text-12 font-semibold uppercase tracking-wide text-slate-500">A test instead (not real visitors)</div>
          <Table head={['Test device', 'Speed score', 'Largest Contentful Paint', 'Layout Shift', 'Total Blocking Time (stands in for interaction)']} empty="">
            {['mobile', 'desktop'].map(dev => { const l = data[dev]?.lab || {}; const c = (m) => (m ? <span className="inline-flex items-center gap-1.5"><Badge tone={(RATING[m.rating] || [])[1] || 'gray'}>{(RATING[m.rating] || ['—'])[0]}</Badge><span className="text-12 text-slate-500 tabular-nums">{m.display || m.value}</span></span> : <span className="text-slate-400">—</span>); return <tr key={dev}><td className="px-3 py-2 capitalize font-medium">{dev}</td><td className="px-3 py-2 tabular-nums font-semibold">{l.score ?? '—'}</td><td className="px-3 py-2">{c(l.lcp)}</td><td className="px-3 py-2">{c(l.cls)}</td><td className="px-3 py-2">{c(l.tbt)}</td></tr>; })}
          </Table>
          <div className="rounded-lg bg-slate-50 ring-1 ring-slate-200 px-4 py-3 text-12.5 text-slate-700"><b>What to do:</b> keep the test scores in the green, and bring more real visitors to the site (Google ranking, your Business Profile, posts). Once enough Chrome users visit over 28 days, the real figures appear here by themselves. You can also measure your own visitors' speed in Google Analytics once it measures this site.</div>
        </div>) : (
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
      <p className="text-12.5 text-slate-500">Analytics 4 · <b className="text-slate-700">{a.property_name || a.property}</b> · last {a.period.days} days to {a.period.end}</p>
      <VisitorsOverview a={a} />
      <Section title="Organic landing pages" subtitle="Visitors who arrived from Google search: do they stay and act?" part={{ state: 'ok' }} why="Engaged = a visit longer than 10 seconds, with a key event or 2+ pages. Bounce is the opposite.">
        <Table head={['Landing page', ...H, 'Conversion', 'Actions']} empty="No organic landing-page visits were recorded in this period.">
          {a.landing_pages.rows.map(r => <tr key={r.path}><td className="px-3 py-2"><Path p={r.path} site={d.website} /></td>{eng(r)}<td className="px-3 py-2 tabular-nums">{r.conversion_rate}%</td><td className={ACT_TD}><PageActions url={r.path} /></td></tr>)}
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
        <Table head={['Page', 'Organic visits', 'Engaged', 'Key events', 'Why', 'What to check', 'Actions']} empty="No busy organic page has a weak engagement or conversion.">
          {(j.engagement_gaps?.rows || []).map(r => <tr key={r.path}><td className="px-3 py-2"><Path p={r.path} site={d.website} /></td><td className="px-3 py-2 tabular-nums">{num(r.organic_sessions)}</td><td className="px-3 py-2 tabular-nums">{r.engagement_rate}%</td><td className="px-3 py-2 tabular-nums">{r.key_events}</td><td className="px-3 py-2 text-12.5">{r.why}</td><td className="px-3 py-2 text-12.5 text-slate-600">{r.fix}</td><td className={ACT_TD}><PageActions url={r.path} /></td></tr>)}
        </Table>
      </Section>
      <Section title="Indexed but unseen pages" subtitle="Google has them, nobody sees or visits them" part={none(j.zombies) ? j.zombies : { state: 'ok' }} why={j.zombies?.basis}>
        {j.zombies?.state === 'ok' && <>
          <p className="text-13 text-slate-600 mb-2"><b>{j.zombies.count}</b> of {j.zombies.of} indexed pages. {j.zombies.fix}</p>
          <Table head={['Page', 'Last crawled by Google', 'Actions']} empty="Every indexed page shows in search results.">{j.zombies.rows.map(r => <tr key={r.url}><td className="px-3 py-2"><Path p={r.url} /></td><td className="px-3 py-2">{r.last_crawl ? new Date(r.last_crawl).toLocaleDateString('en-GB') : '—'}</td><td className={ACT_TD}><PageActions url={r.url} /></td></tr>)}</Table></>}
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

/** The llmstxt.org format, checked on the text as it is edited: the first line is the title, then a short summary, then link lists. */
function llmsChecks(text, file) {
  const lines = (text || '').split('\n');
  const first = lines.find(l => l.trim());
  const links = lines.filter(l => /^\s*[-*]\s+\[[^\]]+\]\([^)\s]+\)/.test(l));
  const bad = links.filter(l => !/\]\(https?:\/\//.test(l));
  const checks = [
    [Boolean(first && /^# \S/.test(first)), 'The first line is a title (# Name): the one thing the format requires'],
    [lines.filter(l => /^# \S/.test(l)).length === 1 || file === 'llms-full.txt', 'Exactly one # title'],
    [lines.some(l => l.startsWith('>')), 'A short summary in a quote line (> what the site is)'],
    [!/<\/?[a-z][^>]*>/i.test(text || ''), 'Plain Markdown: no HTML tags'],
  ];
  if (file === 'llms.txt') checks.push([lines.some(l => /^## \S/.test(l)), 'Sections with ## headings'], [links.length > 0, `Links as - [Name](https://…): ${links.length} found`], [!bad.length, 'Every link is a full web address']);
  else checks.push([lines.some(l => /^Source: https?:\/\//.test(l)), 'Each page names its Source address']);
  checks.push([(text || '').length < 200000, 'Under 200,000 characters']);
  return checks;
}

/** Writes llms.txt and llms-full.txt from what the software knows about the business and its pages, to review, edit, download and upload to the site's root. */
function LlmsMaker({ b, missing }) {
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [file, setFile] = useState('llms.txt');
  const [text, setText] = useState({});
  const [copied, setCopied] = useState(false);
  const make = async () => {
    setBusy(true); setErr('');
    try { const r = await api(`/businesses/${b.id}/search-insights/llms`, { method: 'POST', timeout: 120000 }); setRes(r); setText({ 'llms.txt': r.llms_txt, 'llms-full.txt': r.llms_full_txt }); }
    catch (e) { setErr(e.message || 'The files could not be written.'); } finally { setBusy(false); }
  };
  const download = () => { const url = URL.createObjectURL(new Blob([text[file]], { type: 'text/plain;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = file; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); };
  const copy = async () => { try { await navigator.clipboard.writeText(text[file]); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the text is in the box */ } };
  return (
    <div className="rounded-xl ring-1 ring-indigo-200 bg-indigo-50/40 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1"><div className="text-13 font-semibold text-slate-900">{missing ? 'Create the files for your site' : 'Create fresh files'}</div><div className="text-12.5 text-slate-600">Written from your business profile, business summary and what each page of the site says. Nothing is invented, and nothing is published: you review and download.</div></div>
        <Button variant="primary" size="sm" icon={ClipboardCheck} busy={busy} onClick={make}>{res ? 'Write again' : 'Create llms.txt and llms-full.txt'}</Button>
      </div>
      {err && <p className="mt-2 text-13 text-red-600" role="alert">{err}</p>}
      {res && (
        <div className="mt-3 space-y-3">
          {res.notes.map(n => <p key={n} className="text-12.5 text-amber-900 bg-amber-50 rounded px-3 py-1.5">{n}</p>)}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-0.5 p-0.5 bg-slate-100 rounded-lg">{['llms.txt', 'llms-full.txt'].map(f => <button key={f} type="button" onClick={() => setFile(f)} className={TAB_CLS(file === f)}>{f}</button>)}</div>
            <span className="text-12 text-slate-500">{(text[file] || '').length.toLocaleString('en-IN')} characters · {res.pages.length} pages · you can edit the text</span>
            <span className="ml-auto flex gap-2"><Button size="sm" variant="secondary" icon={copied ? Check : Plus} onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button><Button size="sm" variant="primary" icon={Gauge} onClick={download}>Download {file}</Button></span>
          </div>
          <textarea value={text[file] || ''} onChange={e => setText(v => ({ ...v, [file]: e.target.value }))} spellCheck={false} aria-label={file} className="w-full h-72 rounded-lg ring-1 ring-slate-300 bg-white p-3 text-12.5 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          <div className="rounded-lg bg-white ring-1 ring-slate-200 px-4 py-3">
            <div className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Format check (llmstxt.org), live as you edit</div>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1">{llmsChecks(text[file], file).map(([ok, label]) => <li key={label} className="text-12.5 flex items-center gap-2"><Badge tone={ok ? 'green' : 'red'}>{ok ? 'OK' : 'Fix'}</Badge>{label}</li>)}</ul>
            <p className="mt-2 text-12 text-slate-600">Before you upload, you can also run the file through an outside checker such as <a className="text-indigo-700 hover:underline" href="https://llmstxtvalidator.dev" target="_blank" rel="noreferrer">llmstxtvalidator.dev</a>, <a className="text-indigo-700 hover:underline" href="https://www.seoptimer.com/llms-txt-validator" target="_blank" rel="noreferrer">SEOptimer</a> or <a className="text-indigo-700 hover:underline" href="https://www.rankability.com/tools/llms-txt-checker" target="_blank" rel="noreferrer">Rankability</a>. Most of them read the file from your live site, so upload it first, or paste the text where they allow it. There is no official approval: the format is a proposal at <a className="text-indigo-700 hover:underline" href="https://llmstxt.org" target="_blank" rel="noreferrer">llmstxt.org</a>.</p>
          </div>
          <div className="text-12.5 text-slate-700 rounded-lg bg-white ring-1 ring-slate-200 px-4 py-3"><b>To put it on your site:</b> upload the file to the root of your website so it opens at <span className="font-mono">{res.upload_to.replace('llms.txt', file)}</span> (the same folder as robots.txt). Then press Read again above to check it.</div>
        </div>)}
    </div>
  );
}

/** The site's own files, read live: the sitemap against the pages the audits found, robots.txt, and the llms.txt files for AI assistants. */
function SiteFiles({ b }) {
  const r = useApi(`/businesses/${b.id}/search-insights/site-files`);
  usePoll(() => r.reload(true), Boolean(r.data?.refreshing), 4000);
  const [copied, setCopied] = useState(false);
  if (r.error && !r.data) return <Card><ErrorNote>{r.error.message}</ErrorNote></Card>;
  if (!r.data) return <SkList rows={5} />;
  const snap = r.data;
  const d = snap.data;
  if (!d) return <FirstRead what="your sitemap, robots.txt and llms.txt" />;
  const refreshFiles = async () => { await api(`/businesses/${b.id}/search-insights/refresh?kind=files`, { method: 'POST' }); await r.reload(true); };
  if (d.state !== 'ok') return <Card><p className="text-13 text-amber-800">{d.message}</p></Card>;
  const sm = d.sitemap, rb = d.robots;
  const copy = async () => { try { await navigator.clipboard.writeText(d.missing_xml); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { /* the text is shown below */ } };
  const tile = (label, value, tone, sub) => <div className="rounded-xl bg-white ring-1 ring-slate-200 px-4 py-3 min-w-[150px] flex-1"><div className="text-12 text-slate-500">{label}</div><div className={`text-26 font-bold tabular-nums ${tone}`}>{value}</div>{sub && <div className="text-11.5 text-slate-500">{sub}</div>}</div>;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3"><p className="text-12.5 text-slate-500">Read live from <b className="text-slate-700">{d.host}</b></p><span className="ml-auto"><Freshness snap={snap} onRefresh={refreshFiles} /></span></div>

      <Card title="Sitemap" subtitle="Read from your website now, against every page the audits and scans have seen">
        {!sm.found ? <p className="text-13 text-amber-800 bg-amber-50 rounded px-3 py-2">{sm.message} Publish a sitemap.xml and list it in robots.txt.</p> : <>
          <div className="flex flex-wrap gap-2.5 mb-3">
            {tile('Pages in the sitemap', sm.count, 'text-slate-900')}
            {tile('Pages the software has seen', d.audited, 'text-slate-900', 'audit crawl, scans, indexing')}
            {tile('Seen but not in the sitemap', d.missing_from_sitemap.length, d.missing_from_sitemap.length ? 'text-amber-700' : 'text-emerald-700', d.missing_from_sitemap.length ? 'add them' : 'nothing missing')}
            {tile('In the sitemap, never audited', d.sitemap_not_audited.length, d.sitemap_not_audited.length ? 'text-slate-900' : 'text-emerald-700')}
          </div>
          <div className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Seen on the site but missing from the sitemap</div>
          <Table head={['Page', 'Seen by', 'Actions']} empty="Every page the software has seen is in the sitemap.">
            {d.missing_from_sitemap.map(m => <tr key={m.url}><td className="px-3 py-2"><Path p={m.url} /></td><td className="px-3 py-2 text-12.5 text-slate-600">{m.sources.join(', ')}</td><td className={ACT_TD}><PageActions url={m.url} /></td></tr>)}
          </Table>
          {d.missing_from_sitemap.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-2"><Button size="sm" icon={copied ? Check : Plus} onClick={copy}>{copied ? 'Copied' : 'Copy the XML for these pages'}</Button><span className="text-12 text-slate-500">Paste it inside the sitemap's &lt;urlset&gt;, then submit the sitemap in Search Console. Leave out pages that should not be found (thank-you pages, tests).</span></div>}
          {d.sitemap_not_audited.length > 0 && <details className="mt-3 text-13"><summary className="cursor-pointer font-semibold text-slate-700">{d.sitemap_not_audited.length} sitemap pages the audits have not seen</summary><ul className="mt-2 space-y-1">{d.sitemap_not_audited.map(u => <li key={u} className="flex items-center gap-2"><Path p={u} /><PageActions url={u} /></li>)}</ul></details>}
          <details className="mt-3 text-13"><summary className="cursor-pointer font-semibold text-slate-700">All {sm.count} pages in the sitemap</summary><ul className="mt-2 space-y-1">{sm.urls.map(x => <li key={x.url} className="flex flex-wrap items-center gap-x-3"><Path p={x.url} />{x.lastmod && <span className="text-11.5 text-slate-500">updated {x.lastmod}</span>}</li>)}</ul></details></>}
      </Card>

      <Card title="robots.txt" subtitle="What search engines and AI crawlers may read">
        {!rb.found ? <p className="text-13 text-amber-800 bg-amber-50 rounded px-3 py-2">{rb.message}</p> : <div className="space-y-3">
          <div className="flex flex-wrap gap-2"><Badge tone={rb.blocks_google ? 'red' : 'green'}>{rb.blocks_google ? 'Google is blocked from the site' : 'Google may read the site'}</Badge><Badge tone={rb.sitemaps.length ? 'green' : 'amber'}>{rb.sitemaps.length ? `${rb.sitemaps.length} sitemap line${rb.sitemaps.length === 1 ? '' : 's'}` : 'No Sitemap line'}</Badge><Badge tone="gray">{rb.lines} lines</Badge></div>
          {!rb.sitemaps.length && <p className="text-12.5 text-amber-800">Add <code>Sitemap: https://{d.host}/sitemap.xml</code> so every search engine finds the sitemap.</p>}
          {rb.sitemaps.length > 0 && <div className="text-12.5 text-slate-600">{rb.sitemaps.map(x => <div key={x}><Path p={x} /></div>)}</div>}
          {rb.blocked_pages.length > 0 && <div><div className="text-12 font-semibold uppercase tracking-wide text-red-700 mb-1">Pages in your sitemap or audits that robots.txt blocks for Google</div><ul className="space-y-1">{rb.blocked_pages.map(u => <li key={u}><Path p={u} /></li>)}</ul></div>}
          <div><div className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1.5">AI assistants</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">{rb.ai_bots.map(x => <div key={x.bot} className="rounded-lg ring-1 ring-slate-200 px-3 py-2 flex items-center justify-between gap-2"><div><div className="text-13 font-medium text-slate-900">{x.bot}</div><div className="text-11.5 text-slate-500">{x.purpose}</div></div><Badge tone={x.allowed ? 'green' : 'red'}>{x.allowed ? 'Allowed' : 'Blocked'}</Badge></div>)}</div>
            <p className="mt-1.5 text-11.5 text-slate-500">Blocking an AI crawler keeps your site out of that assistant's answers. Allow the ones you want to appear in.</p></div>
          {rb.rules.length > 0 && <Table head={['For', 'Blocked paths', 'Allowed paths']} empty="">{rb.rules.map((g, i) => <tr key={i}><td className="px-3 py-2 text-12.5">{g.agents.join(', ')}</td><td className="px-3 py-2 text-12.5 font-mono">{g.disallow.join('  ') || '—'}</td><td className="px-3 py-2 text-12.5 font-mono">{g.allow.join('  ') || '—'}</td></tr>)}</Table>}
          <details className="text-12.5"><summary className="cursor-pointer font-semibold text-slate-700">The file</summary><pre className="mt-2 p-3 rounded-lg bg-slate-50 ring-1 ring-slate-200 overflow-x-auto text-12 whitespace-pre-wrap">{rb.text}</pre></details>
        </div>}
      </Card>

      <Card title="llms.txt" subtitle="The files that tell AI assistants what your site is and which pages matter">
        <div className="space-y-4">
          <LlmsMaker b={b} missing={d.llms.some(f => !f.found)} />
          {d.llms.map(f => (
          <div key={f.name}>
            <div className="flex flex-wrap items-center gap-2 mb-1.5"><span className="text-13 font-semibold text-slate-900">/{f.name}</span><Badge tone={f.found ? 'green' : f.name === 'llms.txt' ? 'amber' : 'gray'}>{f.found ? 'Found' : 'Not found'}</Badge>{f.found && <span className="text-12 text-slate-500">{f.lines} lines · {f.links} links</span>}</div>
            {!f.found ? <p className="text-12.5 text-slate-600">{f.name === 'llms.txt' ? 'Publish /llms.txt: a short Markdown file with your name, a one-line summary and links to your main pages and services, so AI assistants describe you correctly.' : 'Optional: the full text of your key pages in one file.'}</p> : <>
              <ul className="space-y-1 mb-2">{f.checks.map(c => <li key={c.text} className="text-12.5 flex items-center gap-2"><Badge tone={c.ok ? 'green' : 'amber'}>{c.ok ? 'OK' : 'Missing'}</Badge>{c.text}</li>)}</ul>
              {f.links_not_in_sitemap.length > 0 && <div className="mb-2"><div className="text-12 font-semibold text-amber-800 mb-1">Linked here but not in the sitemap</div><ul className="space-y-1">{f.links_not_in_sitemap.map(u => <li key={u}><Path p={u} /></li>)}</ul></div>}
              <details className="text-12.5"><summary className="cursor-pointer font-semibold text-slate-700">The file</summary><pre className="mt-2 p-3 rounded-lg bg-slate-50 ring-1 ring-slate-200 overflow-x-auto text-12 whitespace-pre-wrap">{f.preview}{f.chars > 1200 ? '\n…' : ''}</pre></details></>}
          </div>))}</div>
      </Card>
    </div>
  );
}

function AddAll({ list }) {
  const c = useContext(Ctx);
  const todo = list.filter(k => !c.added.has(k.toLowerCase()));
  return <Button size="sm" variant="secondary" icon={Plus} busy={c.adding === '*'} disabled={!todo.length} onClick={() => c.addKeywords(todo)}>{todo.length ? `Add all ${todo.length} to My Keywords` : 'All added'}</Button>;
}

function Insights({ b }) {
  const [tab, setTab] = useState('search');
  const [chk, setChk] = useState(null);
  const [added, setAdded] = useState(() => new Set());
  const [adding, setAdding] = useState('');
  const [note, setNote] = useState('');
  const r = useApi(`/businesses/${b.id}/search-insights`);
  usePoll(() => r.reload(true), Boolean(r.data?.refreshing), 4000);
  if (r.error && !r.data) return <Card><ErrorNote>{r.error.message}</ErrorNote></Card>;
  if (!r.data) return <SkList rows={6} />;
  const snap = r.data;
  const d = snap.data;
  if (!d) return <FirstRead what="Search Console and Analytics" />;
  const refresh = async () => { await api(`/businesses/${b.id}/search-insights/refresh?kind=all`, { method: 'POST' }); await r.reload(true); };
  const ctx = {
    site: b.website || '', added, adding,
    check: async (url) => { setChk({ url, loading: true }); try { setChk({ url, res: await api(`/businesses/${b.id}/search-insights/check-page`, { method: 'POST', body: { url }, timeout: 60000 }) }); } catch (e) { setChk({ url, error: e.message }); } },
    addKeywords: async (list) => {
      setAdding(list.length === 1 ? list[0] : '*'); setNote('');
      try {
        const out = await api(`/businesses/${b.id}/search-insights/add-keywords`, { method: 'POST', body: { keywords: list } });
        setAdded(s => new Set([...s, ...list.map(k => k.toLowerCase())]));
        setNote(out.added ? `${out.added} keyword${out.added === 1 ? '' : 's'} added to My Keywords.` : 'Already in My Keywords.');
      } catch (e) { setNote(`Could not add: ${e.message}`); } finally { setAdding(''); }
    },
  };
  const tabs = [['search', 'Search Console'], ['files', 'Site files'], ['speed', 'Speed'], ['analytics', 'Analytics'], ['together', 'Together'], ['na', 'Not available']];
  return (
    <Ctx.Provider value={ctx}>
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-0.5 p-0.5 bg-slate-100 rounded-lg overflow-x-auto" role="tablist">{tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={TAB_CLS(tab === id)}>{label}</button>)}</div>
        <span className="ml-auto"><Freshness snap={snap} onRefresh={refresh} /></span>
      </div>
      {note && <p role="status" className="text-12.5 text-emerald-800 bg-emerald-50 rounded px-3 py-1.5">{note}</p>}
      {tab === 'search' && <SearchConsole d={d} />}
      {tab === 'files' && <SiteFiles b={b} />}
      {tab === 'speed' && <Speed b={b} />}
      {tab === 'analytics' && <Analytics d={d} />}
      {tab === 'together' && <Together d={d} />}
      {tab === 'na' && <NotAvailable d={d} />}
      <CheckModal s={chk} onClose={() => setChk(null)} />
    </div>
    </Ctx.Provider>
  );
}

export default function SearchInsightsPage() {
  return (
    <SeoShell step="track" title="Search & Visitor Insights" subtitle="What Google Search Console and Google Analytics 4 know about your site that a crawl and a rank tracker cannot see.">
      {(b) => <Insights key={b.id} b={b} />}
    </SeoShell>
  );
}
