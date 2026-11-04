import React, { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, Legend, AreaChart, Area, PieChart, Pie, Cell, ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip } from 'recharts';
import { ExternalLink, Plus, Check, Info, RefreshCw, ChevronRight } from 'lucide-react';
import { Card, Badge, Button, useAction, SkList } from './SeoUi';
import { api, useApi, fmt, fmtDate } from './seoApi';
import { AllPages } from './TopPagesReport';
import { AXIS, PALETTE, Th, Chg, Empty, Filter, Segmented, usePager, path } from './PositionUi';

const host = (u) => String(u || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '');
const Bar = ({ v, max, color = '#6658dd' }) => <div className="h-2 w-24 rounded-full bg-slate-100 overflow-hidden"><div className="h-full" style={{ width: `${max ? Math.min(100, (v / max) * 100) : 0}%`, background: color }} /></div>;
/** The competitors to show: businesses only, or with the directories and social sites that also rank. */
function PlatformToggle({ d, on, set }) {
  if (!d.platform_total) return null;
  return <label className="inline-flex items-center gap-1.5 text-12.5 text-slate-600 cursor-pointer"><input type="checkbox" checked={on} onChange={e => set(e.target.checked)} />Include directories &amp; social sites ({d.platform_total})</label>;
}
const withPlatforms = (d, on) => (on ? [...(d.competitors_all || []), ...(d.platforms || []).map(p => ({ ...p, platform: true }))] : (d.competitors_all || []));
const Dash = <span className="text-slate-300">—</span>;
const Url = ({ u }) => u ? <a href={u} target="_blank" rel="noreferrer" title={u} className="text-indigo-700 hover:underline inline-flex items-center gap-1 max-w-[360px] truncate">{path(u)}<ExternalLink size={10} /></a> : Dash;

/** Overview: one metric over time, and every tracked keyword with where it stood and where it is now. */
export function Overview({ d }) {
  const [metric, setMetric] = useState('visibility');
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const defs = {
    visibility: { label: 'Visibility', unit: '%', card: d.cards.visibility, rev: false },
    traffic: { label: 'Est. Traffic', unit: '', card: d.cards.traffic, rev: false },
    avg_position: { label: 'Avg. Position', unit: '', card: d.cards.avg_position, rev: true },
  };
  const m = defs[metric];
  const chart = d.distribution.map(x => ({ date: x.date.slice(5), v: x[metric] })).filter(x => x.v != null);
  const tags = [...new Set(d.all_keywords.map(r => r.tag).filter(Boolean))];
  const rows = useMemo(() => d.all_keywords.filter(r => (!q || r.keyword.toLowerCase().includes(q.toLowerCase())) && (!tag || r.tag === tag)), [d, q, tag]);
  const [slice, footer] = usePager(rows, 25);
  const sel = 'h-9 px-2.5 text-13 rounded border border-slate-200 bg-white text-slate-700 cursor-pointer';
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <Segmented value={metric} onChange={setMetric} options={[['visibility', 'Visibility'], ['traffic', 'Est. Traffic'], ['avg_position', 'Avg. Position']]} />
          <span className="text-12 text-slate-500">{d.domain} · {d.period.start} → {d.period.end}</span>
        </div>
        <div className="flex items-baseline gap-2 mb-2"><span className="text-26 font-bold tabular-nums text-slate-900">{m.card.value == null ? '—' : `${metric === 'traffic' ? fmt(Math.round(m.card.value)) : m.card.value}${m.unit}`}</span><Chg v={m.card.change} better={m.rev ? 'down' : 'up'} /></div>
        {chart.length > 1 ? (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart} margin={{ top: 8, right: 12, left: -6, bottom: 0 }}>
                <defs><linearGradient id="ov-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6658dd" stopOpacity={0.25} /><stop offset="100%" stopColor="#6658dd" stopOpacity={0.02} /></linearGradient></defs>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis tick={AXIS} tickLine={false} axisLine={false} width={40} reversed={m.rev} domain={m.rev ? [1, 'dataMax + 1'] : [0, 'auto']} />
                <Tooltip />
                <Area type="monotone" dataKey="v" name={m.label} stroke="#6658dd" strokeWidth={2} fill="url(#ov-g)" dot={{ r: 3 }} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : <Empty>One check so far. The chart draws a line once there are two or more checks.</Empty>}
      </Card>

      <Card title={`Rankings overview (${rows.length})`} subtitle="Every tracked keyword: position at the start and end of the period, and what that is worth" pad={false}
        action={<div className="flex flex-wrap gap-2"><Filter value={q} onChange={setQ} placeholder="Filter by keyword" />{tags.length > 0 && <select className={sel} value={tag} onChange={e => setTag(e.target.value)} aria-label="Tag"><option value="">All tags</option>{tags.map(t => <option key={t}>{t}</option>)}</select>}</div>}>
        <div className="overflow-auto">
          <table className="w-full text-13">
            <thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>Keyword</Th><Th>Tag</Th><Th c="text-right">Pos. {d.period.start.slice(5)}</Th><Th c="text-right">Pos. {d.period.end.slice(5)}</Th><Th c="text-right">Diff</Th><Th c="text-right">Visibility</Th><Th c="text-right">Est. traffic</Th><Th c="text-right">Volume</Th><Th>URL</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {slice.map(r => (
                <tr key={r.keyword} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium text-indigo-700 max-w-[260px] truncate" title={r.keyword}>{r.keyword}</td>
                  <td className="px-4 py-2.5 text-slate-500">{r.tag || Dash}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.was ?? <span className="text-slate-400">&gt;20</span>}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{r.rank ?? <span className="text-slate-400 font-normal">&gt;20</span>}</td>
                  <td className="px-4 py-2.5 text-right"><Chg v={r.change} d={0} />{r.change == null && Dash}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.visibility}%</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.traffic != null ? r.traffic : Dash}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.volume != null ? fmt(r.volume) : Dash}</td>
                  <td className="px-4 py-2.5"><Url u={r.url} /></td>
                </tr>))}
              {!slice.length && <tr><td colSpan={9} className="px-5 py-8 text-center text-slate-500">No keyword matches this filter.</td></tr>}
            </tbody>
          </table>
        </div>
        {footer}
      </Card>
    </div>
  );
}

/** Rankings distribution: visibility, and how many keywords each domain has in the top 3 / 10 / 20, with what changed. */
export function Distribution({ d }) {
  const [scope, setScope] = useState('all');
  const [plat, setPlat] = useState(false);
  const everyone = withPlatforms(d, plat);
  const mine = everyone.find(c => c.you);
  const top = everyone.filter(c => !c.you).slice(0, 9);
  const list = scope === 'me' ? (mine ? [mine] : []) : [...top, ...(mine ? [mine] : [])].sort((a, b) => (b.visibility || 0) - (a.visibility || 0));
  const link = (c) => <a href={`https://${c.domain}`} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline inline-flex items-center gap-1">{c.domain}<ExternalLink size={10} />{c.you && <span className="ml-1 text-11 text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">You</span>}</a>;
  const maxVis = Math.max(1, ...list.map(c => c.visibility || 0));
  const num = (v, better = 'up') => v == null ? Dash : <Chg v={v} better={better} d={0} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4"><Segmented value={scope} onChange={setScope} options={[['all', 'All competitors'], ['me', 'My domain only']]} /><PlatformToggle d={d} on={plat} set={setPlat} /></div>
      <Card title="Rankings overview" pad={false}>
        <table className="w-full text-13">
          <thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>Domain</Th><Th c="text-right">Visibility</Th><Th> </Th><Th c="text-right">Diff</Th><Th c="text-right">Est. traffic</Th><Th c="text-right">Diff</Th><Th c="text-right">Top 3</Th><Th c="text-right">Top 10</Th><Th c="text-right">Top 20</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">{list.map(c => (
            <tr key={c.domain} className={c.you ? 'bg-indigo-50/40' : ''}>
              <td className="px-4 py-2.5">{link(c)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{c.visibility}%</td><td className="px-2"><Bar v={c.visibility || 0} max={maxVis} /></td>
              <td className="px-4 py-2.5 text-right">{num(c.change)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{d.has_volume ? c.traffic : Dash}</td>
              <td className="px-4 py-2.5 text-right">{d.has_volume ? num(c.traffic_change) : Dash}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{c.top3.count}</td><td className="px-4 py-2.5 text-right tabular-nums">{c.top10.count}</td><td className="px-4 py-2.5 text-right tabular-nums">{c.top20.count}</td>
            </tr>))}</tbody>
        </table>
      </Card>
      {[[3, 'top3'], [10, 'top10'], [20, 'top20']].map(([n, key]) => {
        const rows = [...list].sort((a, b) => b[key].count - a[key].count);
        const max = Math.max(1, ...rows.map(c => c[key].count));
        return (
          <Card key={key} title={`Rankings in TOP ${n}`} subtitle={`Keywords where the domain is in Google's first ${n} results`} pad={false}>
            <table className="w-full text-13">
              <thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>Domain</Th><Th c="text-right"># keywords in top {n}</Th><Th> </Th><Th c="text-right">Diff</Th><Th c="text-right">New</Th><Th c="text-right">Improved</Th><Th c="text-right">Lost</Th><Th c="text-right">Declined</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">{rows.map(c => (
                <tr key={c.domain} className={c.you ? 'bg-indigo-50/40' : ''}>
                  <td className="px-4 py-2.5">{link(c)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{c[key].count}</td><td className="px-2"><Bar v={c[key].count} max={max} color="#f59e0b" /></td>
                  <td className="px-4 py-2.5 text-right">{num(c[key].diff)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c[key].new ?? Dash}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c.improved ?? Dash}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c[key].lost ?? Dash}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c.declined ?? Dash}</td>
                </tr>))}</tbody>
            </table>
          </Card>
        );
      })}
      {mine?.not_ranking && <p className="text-12.5 text-amber-700 bg-amber-50 rounded px-3 py-2">{d.domain} is not in Google's top 20 for any of the {d.tracked} tracked keyword{d.tracked !== 1 ? 's' : ''} yet, so its figures are 0. The Page positions tab lists what to change to get ranking.</p>}
      {!d.comparable && <p className="text-11.5 text-slate-400">New, Improved, Lost and Declined appear after a second position check.</p>}
    </div>
  );
}

/** Pages: every page of the site (from the crawl) with where it ranks, what it carries and what is wrong with it. */
export function PagesTab({ b }) {
  const data = useApi(`/businesses/${b.id}/seo/top-pages-report?days=30`);
  const [busy, error, run] = useAction();
  const d = data.data;
  const crawling = Boolean(d?.crawling);
  useEffect(() => {
    if (!crawling) return undefined;
    const t = setInterval(() => data.reload(true), 5000);
    return () => clearInterval(t);
  }, [crawling]); // eslint-disable-line react-hooks/exhaustive-deps
  const crawl = () => run('crawl', async () => { await api(`/businesses/${b.id}/seo/crawl-pages?pages=150`, { method: 'POST' }); data.reload(true); });
  if (data.error) return <Card><p className="text-13 text-rose-600">{data.error.message}</p></Card>;
  if (!d) return <SkList rows={6} />;
  const foreign = d.rows.some(r => !r.key.startsWith(d.domain.replace(/^www\./, '')));
  return (
    <div className="space-y-4">
      <Card title="Pages of your website" subtitle={d.audited_at ? `Crawled ${fmtDate(d.audited_at)} · ${d.total} page${d.total !== 1 ? 's' : ''} found` : 'The site has not been crawled yet'}
        action={<Button size="sm" variant="primary" icon={RefreshCw} busy={busy === 'crawl' || crawling} onClick={crawl}>{crawling ? 'Crawling…' : d.total ? 'Re-crawl all pages' : 'Crawl all pages'}</Button>}>
        <p className="text-13 text-slate-600">The crawl follows the sitemap and the links on every page (up to 150 pages), then adds each page's Google position, keywords, words, schema and issues.{(d.total <= 5 || foreign) && !crawling ? ' Only a few pages are known, or an older crawl used the wrong address: press Crawl all pages to list the whole site.' : ''}</p>
        {error && <p className="text-12 text-rose-600 mt-2">{error}</p>}
      </Card>
      {d.total ? <AllPages d={d} /> : <Card><Empty>{crawling ? 'Crawling the website: pages appear here as soon as it finishes.' : 'No page is known yet. Press Crawl all pages.'}</Empty></Card>}
    </div>
  );
}

/** Position of a page's affected keywords over time (lower is better). */
function KeywordTrend({ keywords }) {
  const top = keywords.slice(0, 5);
  const dates = [...new Set(top.flatMap(k => (k.history || []).map(h => h.date)))].sort();
  if (dates.length < 2) return <p className="text-12 text-slate-500 mb-3">The position chart draws after the second position check.</p>;
  const data = dates.map(dt => Object.fromEntries([['date', dt.slice(5)], ...top.map(k => [k.keyword, (k.history || []).find(h => h.date === dt)?.position ?? null])]));
  return (
    <div className="mb-3 rounded border border-slate-200 bg-white p-3">
      <div className="text-13 font-semibold text-slate-800 mb-1">Top affected keywords</div>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" vertical={false} />
            <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={36} reversed domain={[1, 'dataMax + 2']} allowDecimals={false} />
            <Tooltip /><Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            {top.map((k, i) => <Line key={k.keyword} type="monotone" dataKey={k.keyword} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />)}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Cannibalization: keywords where more than one page of the site competes in Google, by page and by keyword, as in Semrush. */
export function Cannibalization({ d, b }) {
  const c = d.cannibal;
  const site = useApi(`/businesses/${b.id}/seo/top-pages-report?days=30`);
  const [only, setOnly] = useState(false);
  const [view, setView] = useState('pages');
  const [kq, setKq] = useState('');
  const [uq, setUq] = useState('');
  const [open, setOpen] = useState(() => new Set());
  const toggle = (key) => setOpen(o => { const n = new Set(o); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const col = c.health >= 80 ? '#10b981' : c.health >= 60 ? '#f59e0b' : '#ef4444';
  // Every page of the site (crawl + Google), the competing ones carrying their keyword detail.
  const allPages = useMemo(() => {
    const byKey = new Map();
    (c.page_rows || []).forEach(p => byKey.set(host(p.url) + path(p.url).replace(/\/$/, ''), { ...p, competing: true }));
    (site.data?.rows || []).filter(r => r.status !== 'lost').forEach(r => {
      const k = host(r.url) + path(r.url).replace(/\/$/, '');
      if (!byKey.has(k)) byKey.set(k, { url: r.url, affected: 0, avg_position: r.avg_position, avg_position_change: r.position_change ? -r.position_change : null, traffic: r.traffic, traffic_change: null, volume: null, keywords: [], competing: false, ranking: r.avg_position != null });
    });
    return [...byKey.values()].sort((a, z) => z.affected - a.affected || (a.avg_position ?? 999) - (z.avg_position ?? 999) || a.url.localeCompare(z.url));
  }, [c.page_rows, site.data]);
  const allKeywords = useMemo(() => {
    const comp = new Map((c.rows || []).map(r => [r.keyword, r]));
    return d.all_keywords.map(k => comp.get(k.keyword) || { keyword: k.keyword, rank: k.rank, volume: k.volume, pages: k.url ? [{ url: k.url, position: k.rank, traffic: k.traffic }] : [], competing: false }).map(r => ({ ...r, competing: comp.has(r.keyword) }));
  }, [c.rows, d.all_keywords]);
  const kwPages = useMemo(() => new Map(allKeywords.map(r => [r.keyword, r.pages || []])), [allKeywords]);
  const pageRows = allPages.filter(p => (!only || p.competing) && (!uq || p.url.toLowerCase().includes(uq.toLowerCase())) && (!kq || p.keywords.some(k => k.keyword.toLowerCase().includes(kq.toLowerCase()))));
  const kwRows = allKeywords.filter(r => (!only || r.competing) && (!kq || r.keyword.toLowerCase().includes(kq.toLowerCase())) && (!uq || r.pages.some(p => p.url.toLowerCase().includes(uq.toLowerCase()))));
  const list = view === 'pages' ? pageRows : kwRows;
  const [slice, footer] = usePager(list, 25);
  const gauge = [{ v: c.health, c: col }, { v: 100 - c.health, c: '#e2e8f0' }];
  const series = c.series.filter(x => x.health != null).map(x => ({ date: x.date.slice(5), health: x.health, affected: x.affected }));
  const caret = (key) => <button type="button" onClick={() => toggle(key)} aria-label="Show details" className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"><ChevronRight size={14} className={`transition-transform ${open.has(key) ? 'rotate-90' : ''}`} /></button>;
  return (
    <div className="space-y-4">
      <Card title="Cannibalization health">
        <div className="flex flex-wrap gap-8 pb-4 mb-4 border-b border-slate-100">
          <div><div className="text-13 text-slate-600">Affected keywords</div><div className="text-26 font-bold tabular-nums text-slate-900">{c.affected} <span className="text-14 text-slate-400 font-normal">/ {c.keywords}</span></div></div>
          <div className="border-l border-slate-200 pl-8"><div className="text-13 text-slate-600">Cannibal pages</div><div className="text-26 font-bold tabular-nums text-slate-900">{c.pages} <span className="text-14 text-slate-400 font-normal">/ {c.pages_total}</span></div></div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6 items-center">
          <div className="relative h-36">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart><Pie data={gauge} dataKey="v" startAngle={180} endAngle={0} cy="85%" innerRadius="68%" outerRadius="100%" stroke="none" isAnimationActive={false}>{gauge.map((x, i) => <Cell key={i} fill={x.c} />)}</Pie></PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-x-0 bottom-0 text-center"><span className="text-22 font-bold tabular-nums" style={{ color: col }}>{c.health}%</span>{c.health_change != null && <span className="ml-1.5 text-12 font-semibold"><Chg v={c.health_change} d={0} unit="%" /></span>}<div className="text-12 text-slate-500">{c.rate} rate</div></div>
          </div>
          {series.length > 1 ? (
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                  <defs><linearGradient id="cn-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6658dd" stopOpacity={0.25} /><stop offset="100%" stopColor="#6658dd" stopOpacity={0.03} /></linearGradient></defs>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" vertical={false} />
                  <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis tick={AXIS} tickLine={false} axisLine={false} width={40} domain={[0, 100]} unit="%" />
                  <Tooltip formatter={(v, n) => [n === 'health' ? `${v}%` : v, n === 'health' ? 'Healthy keywords' : 'Affected keywords']} />
                  <Area type="monotone" dataKey="health" stroke="#6658dd" strokeWidth={2} fill="url(#cn-g)" dot={{ r: 3 }} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : <div className="text-13 text-slate-500">The health line draws after the second position check.</div>}
        </div>
      </Card>

      <Card title={`Cannibalization (${list.length})`} pad={false}
        action={<div className="flex flex-wrap gap-2 items-center"><Filter value={kq} onChange={setKq} placeholder="Filter by keyword" /><Filter value={uq} onChange={setUq} placeholder="Filter by URL" /></div>}>
        <div className="px-5 pt-3 pb-3"><Segmented value={view} onChange={setView} options={[['pages', 'Pages', allPages.length], ['keywords', 'Keywords', allKeywords.length]]} />
          <label className="ml-4 inline-flex items-center gap-1.5 text-12.5 text-slate-600 cursor-pointer align-middle"><input type="checkbox" checked={only} onChange={e => setOnly(e.target.checked)} />Competing only ({c.page_rows?.length || 0} pages)</label></div>
        {slice.length ? (view === 'pages' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-13 min-w-[960px]">
              <thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th> </Th><Th>Page</Th><Th>Status</Th><Th c="text-right">Affected keywords</Th><Th c="text-right">Avg. pos.</Th><Th c="text-right">Diff</Th><Th c="text-right">Total est. traffic</Th><Th c="text-right">Diff</Th><Th c="text-right">Total volume</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">{slice.map(p => (
                <React.Fragment key={p.url}>
                  <tr className="hover:bg-slate-50">
                    <td className="pl-3 w-8">{caret(p.url)}</td>
                    <td className="px-4 py-2.5"><Url u={p.url} /></td>
                    <td className="px-4 py-2.5">{p.competing ? <Badge tone="amber">Competing</Badge> : p.ranking ? <Badge tone="green">OK</Badge> : <Badge>Not ranking</Badge>}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{p.affected}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{p.avg_position ?? Dash}</td>
                    <td className="px-4 py-2.5 text-right"><Chg v={p.avg_position_change} better="down" d={1} />{p.avg_position_change == null && Dash}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{d.has_volume ? p.traffic : Dash}</td>
                    <td className="px-4 py-2.5 text-right">{d.has_volume && p.traffic_change != null ? <Chg v={p.traffic_change} /> : Dash}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{p.volume != null ? fmt(p.volume) : Dash}</td>
                  </tr>
                  {open.has(p.url) && (
                    <tr className="bg-slate-50/60"><td /><td colSpan={8} className="px-4 py-3">
                      <div className="text-11.5 font-semibold text-slate-500 mb-1.5">Keywords this page competes for, and every page of yours that Google shows for each</div>
                      {!p.keywords.length && <p className="text-13 text-slate-500">{p.ranking ? 'This page is the only one of yours in the results for its keywords.' : "This page does not rank in Google's top 20 for a tracked keyword yet."}</p>}
                      <KeywordTrend keywords={p.keywords} />
                      <div className="space-y-3">{p.keywords.map(k => {
                        const serp = kwPages.get(k.keyword) || [];
                        return (
                          <div key={k.keyword} className="rounded border border-slate-200 bg-white">
                            <div className="flex gap-3 text-13 px-3 py-2 border-b border-slate-100"><span className="text-indigo-700 font-medium flex-1">{k.keyword}</span><span className="tabular-nums text-slate-400">{k.volume != null ? `${fmt(k.volume)} /mo` : ''}</span></div>
                            <ul className="divide-y divide-slate-100">{serp.map(x => <li key={x.url} className={`flex gap-3 text-13 items-center px-3 py-1.5 ${x.url === p.url ? 'bg-indigo-50/50' : ''}`}><span className="flex-1 min-w-0"><Url u={x.url} />{x.url === p.url && <span className="ml-2 text-11 text-slate-500">this page</span>}</span><span className="tabular-nums text-slate-600 w-16 text-right">pos. {x.position || '—'}</span></li>)}</ul>
                            {!serp.length && <p className="px-3 py-2 text-12 text-slate-500">No page of yours in the saved results.</p>}
                          </div>);
                      })}</div>
                    </td></tr>
                  )}
                </React.Fragment>))}</tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-13 min-w-[760px]">
              <thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th> </Th><Th>Keyword</Th><Th>Status</Th><Th c="text-right">Best pos.</Th><Th c="text-right">Pages in results</Th><Th c="text-right">Volume</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">{slice.map(r => (
                <React.Fragment key={r.keyword}>
                  <tr className="hover:bg-slate-50">
                    <td className="pl-3 w-8">{caret(r.keyword)}</td>
                    <td className="px-4 py-2.5 font-medium text-indigo-700">{r.keyword}</td>
                    <td className="px-4 py-2.5">{r.competing ? <Badge tone="amber">Competing</Badge> : r.rank ? <Badge tone="green">OK</Badge> : <Badge>Not ranking</Badge>}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.rank ?? Dash}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.pages.length}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.volume != null ? fmt(r.volume) : Dash}</td>
                  </tr>
                  {open.has(r.keyword) && (
                    <tr className="bg-slate-50/60"><td /><td colSpan={5} className="px-4 py-3">
                      <ul className="space-y-1">{r.pages.map(p => <li key={p.url} className="flex gap-3 text-13 items-center"><span className="flex-1"><Url u={p.url} /></span><span className="tabular-nums text-slate-600">pos. {p.position || '—'}</span>{d.has_volume && <span className="tabular-nums text-slate-400 w-24 text-right">{p.traffic} traffic</span>}</li>)}</ul>
                      {!r.pages.length && <p className="text-13 text-slate-500">None of your pages is in Google's top 20 for this keyword yet.</p>}
                      {r.competing && <p className="text-12 text-slate-500 mt-2">Keep the page with the best position, then merge or redirect the others into it.</p>}
                    </td></tr>
                  )}
                </React.Fragment>))}</tbody>
            </table>
          </div>
        )) : <Empty>{c.affected ? 'Nothing matches these filters.' : 'No keyword has two of your pages competing in Google. Nothing to merge.'}</Empty>}
        {footer}
      </Card>
    </div>
  );
}

/** Competitors discovery: the domains in the results of your keywords, with a depth, a map and one-click tracking. */
export function Competitors({ d, b, onChanged }) {
  const [depth, setDepth] = useState('top20');
  const [q, setQ] = useState('');
  const [busy, error, run] = useAction();
  const tracked = new Set((d.tracked_competitors || []).map(host));
  const [plat, setPlat] = useState(false);
  const all = withPlatforms(d, plat);
  const rows = all.filter(c => (!q || c.domain.includes(q.toLowerCase())) && (c[depth].count > 0 || c.you)).sort((a, z) => z[depth].count - a[depth].count || (z.visibility || 0) - (a.visibility || 0));
  const [slice, footer, off] = usePager(rows, 10);
  const maxVis = Math.max(1, ...rows.map(c => c.visibility || 0));
  const add = (domain) => run(domain, async () => { await api(`/businesses/${b.id}/seo/track-competitor`, { method: 'POST', body: { domain } }); onChanged(); });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-12.5 text-slate-500 font-semibold">Depth</span>
        <Segmented value={depth} onChange={setDepth} options={[['top20', 'Top 20'], ['top10', 'Top 10'], ['top3', 'Top 3']]} />
        <Filter value={q} onChange={setQ} placeholder="Filter by domain" />
        <PlatformToggle d={d} on={plat} set={setPlat} />
      </div>
      <Card title="Competition map" subtitle="Across: keywords the domain appears for. Up: better average position. Size: visibility.">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 10, right: 16, left: -4, bottom: 8 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" />
              <XAxis type="number" dataKey="keywords" name="Keywords" tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} domain={[0, 'dataMax + 2']} />
              <YAxis type="number" dataKey="avg_position" name="Avg. position" reversed tick={AXIS} tickLine={false} axisLine={false} width={40} domain={[1, 'dataMax + 1']} />
              <ZAxis type="number" dataKey="visibility" range={[160, 1400]} />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ payload }) => payload?.[0] ? <div className="bg-white border border-slate-200 rounded px-2.5 py-1.5 text-12"><b>{payload[0].payload.domain}{payload[0].payload.you ? ' (you)' : ''}</b><div>{payload[0].payload.keywords} keywords · avg position {payload[0].payload.avg_position}</div><div>Visibility {payload[0].payload.visibility}%</div></div> : null} />
              {rows.filter(c => c.avg_position != null).slice(0, 15).map((c, i) => <Scatter key={c.domain} name={c.domain} data={[c]} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.55} />)}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card title={`Competitors (${rows.length})`} subtitle={`${d.competitor_total} competing business${d.competitor_total !== 1 ? 'es' : ''} appear in the results of your tracked keywords${d.platform_total ? ` (${d.platform_total} directories and social sites left out)` : ''}`} pad={false}>
        <div className="overflow-auto">
          <table className="w-full text-13">
            <thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>#</Th><Th>Domain</Th><Th c="text-right">Visibility</Th><Th> </Th><Th c="text-right">Diff</Th><Th c="text-right">Est. traffic</Th><Th c="text-right">Keywords</Th><Th c="text-right">Avg. pos.</Th><Th> </Th></tr></thead>
            <tbody className="divide-y divide-slate-100">{slice.map((c, i) => (
              <tr key={c.domain} className={c.you ? 'bg-indigo-50/40' : 'hover:bg-slate-50'}>
                <td className="px-4 py-2.5 text-slate-500 tabular-nums">{off + i + 1}</td>
                <td className="px-4 py-2.5"><a href={`https://${c.domain}`} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline inline-flex items-center gap-1">{c.domain}<ExternalLink size={10} /></a>{c.you && <span className="ml-2 text-11 text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">You</span>}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{c.visibility}%</td><td className="px-2"><Bar v={c.visibility || 0} max={maxVis} /></td>
                <td className="px-4 py-2.5 text-right"><Chg v={c.change} />{c.change == null && Dash}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{d.has_volume ? c.traffic : Dash}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{c.keywords}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{c.avg_position ?? Dash} {c.avg_position_change != null && <span className="text-11 text-slate-400">±{Math.abs(c.avg_position_change)}</span>}</td>
                <td className="px-4 py-2.5 text-right">{c.you ? null : tracked.has(c.domain) ? <Badge tone="green"><Check size={11} /> Tracked</Badge> : <Button size="sm" icon={Plus} busy={busy === c.domain} onClick={() => add(c.domain)}>Track</Button>}</td>
              </tr>))}
              {!slice.length && <tr><td colSpan={9} className="px-5 py-8 text-center text-slate-500">No domain matches. Competitors appear after the first position check.</td></tr>}
            </tbody>
          </table>
        </div>
        {footer}
        {error && <p className="px-4 pb-3 text-12 text-rose-600">{error}</p>}
      </Card>
    </div>
  );
}

/** Featured snippets: where Google shows an answer box, and which of them you hold. */
export function Snippets({ d }) {
  const [view, setView] = useState('opp');
  const all = d.snippets || [];
  const has = all.filter(s => s.yours);
  const opp = all.filter(s => !s.yours);
  const fresh = all.filter(s => !s.was);
  const rows = view === 'has' ? has : view === 'new' ? fresh : opp;
  const pct = (n) => all.length ? Math.round(n / all.length * 100) : 0;
  const [slice, footer] = usePager(rows, 25);
  return (
    <div className="space-y-4">
      <Card title={`${all.length} keyword${all.length !== 1 ? 's' : ''} with featured snippets on the results page`}>
        <div className="grid sm:grid-cols-2 gap-4 max-w-2xl">
          {[['Already featured', has.length, '#10b981'], ['Opportunities', opp.length, '#6658dd']].map(([l, n, c]) => (
            <div key={l}><div className="flex justify-between text-13"><span className="font-semibold text-slate-700">{l}</span><span className="tabular-nums"><b style={{ color: c }}>{n}</b> <span className="text-slate-400">{pct(n)}%</span></span></div><div className="h-2 mt-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full" style={{ width: `${pct(n)}%`, background: c }} /></div></div>
          ))}
        </div>
      </Card>
      <Card title="Featured snippets" subtitle="Answer boxes, featured snippets and People-also-ask seen on the latest check" pad={false}
        action={<Segmented value={view} onChange={setView} options={[['opp', 'Opportunities', opp.length], ['has', 'Already featured', has.length], ['new', 'New on SERP', fresh.length]]} />}>
        {slice.length ? (
          <table className="w-full text-13">
            <thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>Keyword</Th><Th>Feature</Th><Th c="text-right">Volume</Th><Th c="text-right">Est. traffic potential</Th><Th c="text-right">You</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">{slice.map(s => (
              <tr key={s.keyword}><td className="px-4 py-2.5 font-medium text-indigo-700">{s.keyword}</td><td className="px-4 py-2.5 text-slate-600">{s.feature}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{s.volume != null ? fmt(s.volume) : Dash}</td><td className="px-4 py-2.5 text-right tabular-nums">{s.potential ?? Dash}</td>
                <td className="px-4 py-2.5 text-right">{s.yours ? <Badge tone="green"><Check size={11} /> Yours</Badge> : s.rank ? <span className="tabular-nums">#{s.rank}</span> : Dash}</td></tr>))}</tbody>
          </table>
        ) : <Empty>{all.length ? 'Nothing in this view. Try another tab above the table.' : 'No snippet or answer box was seen on the latest checks.'}</Empty>}
        {footer}
        {opp.length > 0 && <p className="px-4 py-3 text-12 text-slate-500 border-t border-slate-100 flex gap-1.5"><Info size={12} className="mt-0.5 shrink-0" />To win one: add a 40-60 word direct answer under a question heading, plus FAQ schema, on the page that ranks.</p>}
      </Card>
    </div>
  );
}
