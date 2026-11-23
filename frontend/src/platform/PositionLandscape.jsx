import { KeywordActs } from './TableBits';
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, ScatterChart, Scatter, PieChart, Pie, Cell, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { ArrowUp, ArrowDown, RefreshCw, ExternalLink, AlertTriangle, Search, Inbox, Info } from 'lucide-react';
import { Card, Badge, Button, ErrorNote, useAction, useToast, useModulePath, SkPage } from './SeoUi';
import { api, useApi, fmt } from './seoApi';
import { TrackingHeader, ExportButtons, DevicesLocations, TabBar, CsvButton } from './PositionExtras';
import PositionOverview from './PositionOverview';
import CurrentPositions from './CurrentPositions';
import PositionCompetitors from './PositionCompetitors';
import { Distribution, PagesTab, Cannibalization, Snippets } from './PositionTabs';
import { AXIS, PALETTE, Th, path, sign, Chg, Spark, Empty } from './PositionUi';
import { usePager, Pager, useSorted, SortTh, downloadCsv } from './DataTable';
import Select from '../components/Select';

/**
 * Position Tracking "Landscape": visibility, estimated traffic, average position, distribution, movers, tags, competitors,
 * SERP features, pages and cannibalization of the tracked keywords. Every figure is computed on the server from the saved
 * Google rank checks (GET /businesses/{id}/seo/position-landscape, services/landscape.py).
 */

const BUCKETS = [['top3', '1-3', '#f59e0b'], ['p4_10', '4-10', '#4338ca'], ['p11_20', '11-20', '#818cf8'], ['out', 'Page 3+ or none', '#e2e8f0']];
const RANGES = [[30, 'Last 30 days'], [60, 'Last 60 days'], [90, 'Last 90 days']];


function Metric({ label, hint, value, unit = '', change, better, series, d = 2 }) {
  return (
    <div className="px-5 py-4 border-b border-slate-100 last:border-0" title={hint}>
      <div className="text-12.5 font-semibold text-slate-500 flex items-center gap-1">{label}<Info size={11} className="text-slate-300" /></div>
      <div className="flex items-baseline gap-2"><span className="text-26 font-bold tabular-nums text-indigo-700">{value == null ? '—' : `${value}${unit}`}</span><Chg v={change} better={better} d={d} /></div>
      <Spark values={series} />
    </div>
  );
}

function Gauge({ improved, declined }) {
  const data = [{ n: 'Improved', v: improved, c: '#10b981' }, { n: 'Declined', v: declined, c: '#ef4444' }];
  const none = !improved && !declined;
  return (
    <div className="flex items-center gap-3">
      <span className="text-18 font-bold text-emerald-600 tabular-nums w-8 text-right">{improved}</span>
      <div className="w-24 h-14">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart><Pie data={none ? [{ n: '', v: 1, c: '#e2e8f0' }] : data} dataKey="v" startAngle={180} endAngle={0} cy="100%" innerRadius={30} outerRadius={46} stroke="none" isAnimationActive={false}>{(none ? [{ c: '#e2e8f0' }] : data).map((x, i) => <Cell key={i} fill={x.c} />)}</Pie></PieChart>
        </ResponsiveContainer>
      </div>
      <span className="text-18 font-bold text-red-500 tabular-nums w-8">{declined}</span>
    </div>
  );
}

const TC = 'px-4 py-2.5 whitespace-nowrap';
const numOf = (v) => (v == null || v === '' ? null : Number(v));
const kwValue = (r, k) => ({ keyword: r.keyword, pos: numOf(r.rank), change: numOf(r.change), volume: numOf(r.volume), visibility: numOf(r.visibility), tag: r.tag })[k];
const tagValue = (t, k) => ({ tag: t.tag, keywords: numOf(t.keywords), visibility: numOf(t.visibility), traffic: numOf(t.traffic), pos: numOf(t.avg_position), volume: numOf(t.volume) })[k];
function KeywordTable({ rows: all, empty = 'No keywords.', resetKey = '', name = 'tracked-keywords' }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const kept = useMemo(() => (needle ? all.filter(r => `${r.keyword} ${r.tag || ''}`.toLowerCase().includes(needle)) : all), [all, needle]);
  const { sorted, sort, onSort } = useSorted(kept, kwValue);
  const pg = usePager(sorted, { size: 25, resetKey: `${resetKey}|${needle}` });
  const rows = pg.rows;
  return (
    <>
      {all.length > 0 && <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">{all.length > 10 && <label className="relative inline-block"><Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search keywords" aria-label="Search keywords" className="h-8 w-56 pl-8 pr-3 text-13 rounded border border-slate-200 bg-white focus:border-indigo-400 outline-none" /></label>}
        <CsvButton className="ml-auto" onClick={() => downloadCsv(name, ['Keyword', 'Position', 'Change in position', 'Searches per month', 'Visibility (%)', 'Tag', 'Ranking page'], sorted.map(r => [r.keyword, r.rank ?? '', r.change ?? '', r.volume ?? '', r.visibility ?? '', r.tag || '', r.url || '']))} /></div>}
      <div className="overflow-auto max-h-[420px]">
        <table className="w-full text-13">
          <thead className="sticky top-0 bg-slate-50 text-11.5 text-slate-500"><tr><SortTh id="keyword" sort={sort} onSort={onSort} className={TC}>Keyword</SortTh><SortTh id="pos" sort={sort} onSort={onSort} right className={TC}>Pos.</SortTh><SortTh id="change" sort={sort} onSort={onSort} right first="desc" className={TC}>Change</SortTh><SortTh id="volume" sort={sort} onSort={onSort} right first="desc" className={TC}>Volume</SortTh><SortTh id="visibility" sort={sort} onSort={onSort} right first="desc" className={TC}>Visibility</SortTh><SortTh id="tag" sort={sort} onSort={onSort} className={TC}>Tag</SortTh><Th c="text-right">Actions</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(r => (
              <tr key={r.keyword} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 font-medium text-indigo-700 max-w-[280px] truncate" title={r.keyword}>{r.keyword}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{r.rank ?? <span className="text-slate-400">&gt;10</span>}</td>
                <td className="px-4 py-2.5 text-right"><Chg v={r.change} d={0} /></td>
                <td className="px-4 py-2.5 text-right tabular-nums">{r.volume != null ? fmt(r.volume) : '—'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{r.visibility}%</td>
                <td className="px-4 py-2.5 text-slate-500">{r.tag || '—'}</td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap"><KeywordActs keyword={r.keyword} url={r.url} /></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="px-5 py-8 text-center text-slate-500">{all.length ? 'No keyword matches the search.' : empty}</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager p={pg} label="keywords" />
    </>
  );
}

function Impact({ title, tone, block, onAll, allLabel }) {
  return (
    <Card title={title} action={<span className={`text-13 font-bold ${tone === 'pos' ? 'text-emerald-600' : 'text-red-500'}`}>{block.count ? `${sign(block.total)}%` : ''}</span>} pad={false}>
      {block.rows.length ? (
        <table className="w-full text-13">
          <thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>Keyword</Th><Th c="text-right">{tone === 'pos' ? 'Visibility gain' : 'Visibility loss'}</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">{block.rows.map(r => <tr key={r.keyword}><td className="px-4 py-2.5 text-indigo-700 max-w-[200px] truncate" title={r.keyword}>{r.keyword}</td><td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${tone === 'pos' ? 'text-emerald-600' : 'text-red-500'}`}>{sign(r.gain)}%</td></tr>)}</tbody>
        </table>
      ) : <Empty>{tone === 'pos' ? 'No keyword gained visibility in this period.' : 'No keyword lost visibility in this period.'}</Empty>}
      <div className="p-4"><Button size="sm" onClick={onAll} disabled={!block.count}>{allLabel}</Button></div>
    </Card>
  );
}

export function Landscape({ d, onTab, b }) {
  const path_ = useModulePath();
  const [kwView, setKwView] = useState(null);
  const [showOut, setShowOut] = useState(false);
  const [pagesTab, setPagesTab] = useState('top');
  const [picked, setPicked] = useState(() => new Set());
  const k = d.keywords;
  const chosen = d.competitors.filter(c => !picked.size || picked.has(c.domain) || c.you);
  const allRows = d.all_keywords;
  const shownRows = kwView === 'improved' ? allRows.filter(r => r.change > 0) : kwView === 'declined' ? allRows.filter(r => r.change < 0) : allRows;
  const dist = d.distribution.map(x => ({ ...x, label: x.date.slice(5) }));
  const features = d.serp_features.map(f => ({ ...f, other: f.keywords - f.yours }));
  const togglePick = (dom) => setPicked(p => { const n = new Set(p.size ? p : d.competitors.map(c => c.domain)); n.has(dom) ? n.delete(dom) : n.add(dom); return n; });
  const isOn = (c) => !picked.size || picked.has(c.domain);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 items-stretch">
        <Card className="xl:col-span-2" pad={false}>
          <Metric label="Visibility" hint="Share of the clicks your tracked keywords could win: expected click-through rate at each position, over keywords × the click rate of position 1." value={d.cards.visibility.value} unit="%" change={d.cards.visibility.change} better="up" series={d.cards.visibility.series} />
          <Metric label="Estimated traffic" hint={d.has_volume ? 'Search volume × expected click-through rate at the position, summed over tracked keywords.' : 'No tracked keyword has a search volume yet.'} value={d.cards.traffic.value != null ? fmt(Math.round(d.cards.traffic.value)) : null} change={d.cards.traffic.change} better="up" series={d.cards.traffic.series} />
          <Metric label="Average position" hint="Average of the Search Console positions of the keywords shown on Google. Lower is better." value={d.cards.avg_position.value} change={d.cards.avg_position.change} better="down" series={d.cards.avg_position.series} />
        </Card>
        <Card className="xl:col-span-3" title="Summary" subtitle={`${d.domain} · ${d.period.start} → ${d.period.end} · ${d.period.checks} check${d.period.checks !== 1 ? 's' : ''}`}>
          <ul className="space-y-2.5 text-13 text-slate-700 list-disc pl-5 marker:text-indigo-400">{d.summary.map(s => <li key={s}>{s}</li>)}</ul>
          {!d.comparable && <p className="mt-3 text-12 text-slate-400">Only one check so far: changes appear after the next check.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 items-start">
        <Card className="xl:col-span-3" title="Rankings distribution" subtitle="Tracked keywords by Search Console average position, per check">
          <div className="flex flex-wrap items-center gap-4 mb-2 text-12.5">
            {BUCKETS.map(([key, l, c]) => key === 'out'
              ? <label key={key} className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700"><input type="checkbox" checked={showOut} onChange={e => setShowOut(e.target.checked)} />{l}</label>
              : <span key={key} className="inline-flex items-center gap-1.5 text-slate-700"><span className="w-3 h-3 rounded-sm" style={{ background: c }} />{l}</span>)}
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dist} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={20} />
                <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={36} />
                <Tooltip />
                {[...BUCKETS].reverse().filter(([key]) => key !== 'out' || showOut).map(([key, l, c]) => <Bar key={key} dataKey={key} name={l} stackId="d" fill={c} isAnimationActive={false} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Keywords" pad={false}>
          <div className="divide-y divide-slate-100">
            {[['Top 3', k.top3], ['Top 10', k.top10], ['Top 20', k.top20]].map(([l, x]) => (
              <div key={l} className="px-5 py-3 grid grid-cols-[auto_1fr_auto] items-center gap-3">
                <div><div className="text-12 text-slate-500">{l}</div><div className="text-22 font-bold tabular-nums text-indigo-700">{x.count}</div></div>
                <Spark values={x.series} h={34} />
                <div className="text-11.5 text-slate-500 text-right leading-tight">{x.new != null && <><div>New <b className="text-indigo-700">{x.new}</b></div><div>Lost <b className="text-red-500">{x.lost}</b></div></>}</div>
              </div>
            ))}
            <div className="px-5 py-3"><div className="text-12 text-slate-500 mb-1">Improved vs. declined</div><Gauge improved={d.movers.improved} declined={d.movers.declined} /></div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
        <Card title="Top keywords" pad={false}>
          <table className="w-full text-13">
            <thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>Keyword</Th><Th c="text-right">Pos.</Th><Th c="text-right">Visibility</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">{d.top.map(r => <tr key={r.keyword}><td className="px-4 py-2.5 text-indigo-700 max-w-[190px] truncate" title={r.keyword}>{r.keyword}</td><td className="px-4 py-2.5 text-right tabular-nums">{r.rank ?? '—'} <Chg v={r.change} d={0} /></td><td className="px-4 py-2.5 text-right tabular-nums">{r.visibility}%</td></tr>)}</tbody>
          </table>
          <div className="p-4"><Button size="sm" onClick={() => setKwView('all')}>View all {d.tracked} keywords</Button></div>
        </Card>
        <Impact title="Positive impact" tone="pos" block={d.positive} onAll={() => setKwView('improved')} allLabel={`View all ${d.movers.improved} improved keywords`} />
        <Impact title="Negative impact" tone="neg" block={d.negative} onAll={() => setKwView('declined')} allLabel={`View all ${d.movers.declined} declined keywords`} />
      </div>

      {kwView && (
        <Card title={kwView === 'all' ? `All keywords (${shownRows.length})` : kwView === 'improved' ? `Improved keywords (${shownRows.length})` : `Declined keywords (${shownRows.length})`} pad={false}
          action={<Button size="sm" onClick={() => setKwView(null)}>Close</Button>}>
          <KeywordTable rows={shownRows} empty="No keywords in this view." resetKey={kwView} name={`${kwView}-keywords-${d.domain}`} />
        </Card>
      )}


      <Card title="Tags" subtitle="Keywords grouped by their cluster" pad={false}
        action={d.tags.length > 0 && <Button size="sm" onClick={() => onTab?.('tags')}>View all {d.tags.length} tags</Button>}>
        {d.tags.length ? (
          <table className="w-full text-13">
            <thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>Tag</Th><Th c="text-right">Keywords</Th><Th c="text-right">Visibility</Th><Th c="text-right">Avg. pos.</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">{d.tags.slice(0, 5).map(t => (
              <tr key={t.tag}><td className="px-4 py-2.5"><span className="px-2.5 py-0.5 rounded-full border border-slate-200 text-12 text-slate-700">{t.tag}</span></td>
                <td className="px-4 py-2.5 text-right tabular-nums text-indigo-700">{t.keywords}</td><td className="px-4 py-2.5 text-right tabular-nums">{t.visibility}% <Chg v={t.visibility_change} /></td>
                <td className="px-4 py-2.5 text-right tabular-nums">{t.avg_position ?? '—'}</td></tr>))}</tbody>
          </table>
        ) : (
          <div className="py-10 flex flex-col items-center text-center gap-2">
            <div className="text-15 font-semibold text-slate-900">Add your first tag</div>
            <p className="max-w-sm text-13 text-slate-500">Tags help you track the performance of any keyword group.</p>
            <Link to={path_('keyword-management')} className="mt-2 h-9 px-4 rounded inline-flex items-center text-13 font-semibold bg-indigo-600 text-white hover:bg-indigo-700">Tag keywords</Link>
          </div>
        )}
      </Card>

      <Card title="Pages" subtitle="Your pages that rank for the tracked keywords" pad={false}
        action={<div className="flex gap-0.5 p-0.5 bg-slate-100 rounded">{[['top', 'Top'], ['improved', 'Improved'], ['declined', 'Declined']].map(([id, l]) => <button key={id} type="button" onClick={() => setPagesTab(id)} className={`h-7 px-2.5 text-12 font-semibold rounded cursor-pointer ${pagesTab === id ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>{l}</button>)}</div>}>
        {d.pages[pagesTab].length ? (
          <table className="w-full text-13">
            <thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>URL</Th><Th c="text-right">Keywords</Th><Th c="text-right">Avg. position</Th><Th c="text-right">Est. traffic</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">{d.pages[pagesTab].map(p => (
              <tr key={p.url} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 max-w-[420px] truncate"><a href={p.url} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline inline-flex items-center gap-1" title={p.url}>{path(p.url)}<ExternalLink size={10} /></a></td>
                <td className="px-4 py-2.5 text-right tabular-nums">{p.keywords}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{p.avg_position} <Chg v={p.avg_position_change} better="down" /></td>
                <td className="px-4 py-2.5 text-right tabular-nums">{d.has_volume ? <>{p.traffic} <Chg v={p.traffic_change} /></> : '—'}</td>
              </tr>))}</tbody>
          </table>
        ) : <Empty>{pagesTab === 'top' ? 'No page of this site is shown on Google for a tracked keyword yet.' : `No ${pagesTab} pages in this period.`}</Empty>}
        <div className="p-4 border-t border-slate-100"><Button size="sm" onClick={() => onTab?.('pages')}>View all {d.pages.total || 'landing'} {d.pages.total === 1 ? 'landing page' : 'landing pages'}</Button></div>
      </Card>

      <Card title="Visibility by locations" subtitle="How visible the site is in each place and on each device it is checked">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded border border-slate-200 p-4"><div className="text-12 text-slate-500">Location</div><div className="text-15 font-semibold text-slate-900">{d.location || 'Google'}{d.country ? ` · ${d.country}` : ''}</div></div>
          <div className="rounded border border-slate-200 p-4"><div className="text-12 text-slate-500">Device</div><div className="text-15 font-semibold text-slate-900">Desktop</div></div>
          <div className="rounded border border-slate-200 p-4"><div className="text-12 text-slate-500">Visibility</div><div className="text-15 font-semibold text-indigo-700 tabular-nums">{d.cards.visibility.value}%</div></div>
        </div>
        <p className="text-12 text-slate-500 mt-3">Positions are read for one location and the desktop device. Other locations and mobile are not tracked yet.</p>
        <div className="mt-3"><Button size="sm" onClick={() => onTab?.('devices')}>View devices &amp; locations</Button></div>
      </Card>

      <Card title="Cannibalization health" subtitle="Keywords where more than one page of your site shows in the results">
        <div className="grid grid-cols-1 md:grid-cols-[auto_auto_1fr] gap-6 items-center">
          <div><div className="text-12 text-slate-500">Affected keywords</div><div className="text-22 font-bold tabular-nums">{d.cannibal.affected} <span className="text-14 text-slate-400 font-normal">/ {d.cannibal.keywords}</span></div></div>
          <div><div className="text-12 text-slate-500">Cannibal pages</div><div className="text-22 font-bold tabular-nums">{d.cannibal.pages}</div></div>
          <div className="flex items-center gap-4">
            <div className="text-center shrink-0"><div className="text-26 font-bold tabular-nums" style={{ color: d.cannibal.health >= 80 ? '#10b981' : d.cannibal.health >= 60 ? '#f59e0b' : '#ef4444' }}>{d.cannibal.health}%</div><div className="text-11.5 text-slate-500">healthy <Chg v={d.cannibal.health_change} d={0} /></div></div>
            <div className="flex-1 h-28"><Spark values={d.cannibal.series.map(x => x.health)} h={110} color="#6658dd" /></div>
          </div>
        </div>
        <div className="mt-4"><Button size="sm" onClick={() => onTab?.('cannibal')}>View Cannibalization report</Button></div>
        {d.cannibal.affected > 0 && <div className="mt-4 text-12.5 text-slate-600">Merge or differentiate the competing pages so one page owns each keyword. Open the affected keywords in <b>All keywords</b> to see which URLs rank.</div>}
      </Card>
      <p className="text-11.5 text-slate-400 flex items-start gap-1.5"><Info size={12} className="mt-0.5 shrink-0" />Visibility and estimated traffic are modelled from your saved Google Search Console positions with a standard click-through curve and the keyword volumes you track. They will not match another tool exactly.</p>
    </div>
  );
}

function TagsTab({ d }) {
  const { sorted, sort, onSort } = useSorted(d.tags, tagValue);
  const pg = usePager(sorted, { size: 25 });
  return (
      <Card title={`Tags (${d.tags.length})`} subtitle="Keywords grouped by their cluster" pad={false}>
        {d.tags.length ? (
          <table className="w-full text-13">
            <thead className="bg-slate-50 text-11.5 text-slate-500"><tr><SortTh id="tag" sort={sort} onSort={onSort} className={TC}>Tag</SortTh><SortTh id="keywords" sort={sort} onSort={onSort} right first="desc" className={TC}>Keywords</SortTh><SortTh id="visibility" sort={sort} onSort={onSort} right first="desc" className={TC}>Visibility</SortTh><SortTh id="traffic" sort={sort} onSort={onSort} right first="desc" className={TC}>Est. traffic</SortTh><SortTh id="pos" sort={sort} onSort={onSort} right className={TC}>Avg. pos.</SortTh><SortTh id="volume" sort={sort} onSort={onSort} right first="desc" className={TC}>Volume</SortTh></tr></thead>
            <tbody className="divide-y divide-slate-100">{pg.rows.map(t => (
              <tr key={t.tag} className="hover:bg-slate-50">
                <td className="px-4 py-2.5"><span className="px-2.5 py-0.5 rounded-full border border-slate-200 text-12 text-slate-700">{t.tag}</span></td>
                <td className="px-4 py-2.5 text-right tabular-nums text-indigo-700">{t.keywords}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{t.visibility}% <Chg v={t.visibility_change} /></td>
                <td className="px-4 py-2.5 text-right tabular-nums">{d.has_volume ? <>{t.traffic} <Chg v={t.traffic_change} /></> : '—'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{t.avg_position ?? '—'} <Chg v={t.avg_position_change} better="down" d={1} /></td>
                <td className="px-4 py-2.5 text-right tabular-nums">{t.volume != null ? fmt(t.volume) : '—'}</td>
              </tr>))}</tbody>
          </table>
        ) : <Empty>No keyword has a tag yet. Group keywords into clusters in Keyword Strategy Builder and they show up here.</Empty>}
        {d.tags.length > 0 && <div className="px-4 py-3 border-t border-slate-100"><CsvButton onClick={() => downloadCsv(`keyword-tags-${d.domain}`, ['Tag', 'Keywords', 'Visibility (%)', 'Estimated traffic', 'Average position', 'Searches per month'], sorted.map(t => [t.tag, t.keywords, t.visibility ?? '', d.has_volume ? (t.traffic ?? '') : '', t.avg_position ?? '', t.volume ?? '']))} /></div>}
        {d.tags.length > 0 && <Pager p={pg} label="tags" />}
      </Card>
  );
}

/** `tab` lets the page that hosts it own the tab row (Position Tracking lists these views among its own tabs); without it the component shows its own. */
export default function PositionLandscape({ b, tab: forced, onTab }) {
  const path_ = useModulePath();
  const [days, setDays] = useState(30);
  const [own, setTab] = useState('landscape');
  const tab = forced || own;
  const data = useApi(`/businesses/${b.id}/seo/position-landscape?days=${days}`);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const [tick, setTick] = useState(0);
  const d = data.data;
  const check = () => run('check', async () => {
    const r = await api(`/businesses/${b.id}/seo/check-ranks`, { method: 'POST', body: {} });
    toast(`Read ${r.checked} keyword${r.checked !== 1 ? 's' : ''} from Google Search Console`);
    data.reload(true);
    setTick(t => t + 1); // the table of current positions reads the new check too
  });
  const sel = 'h-9 px-2.5 text-13 rounded border border-slate-200 bg-white text-slate-700 cursor-pointer';
  return (
    <div className="space-y-4">
      <div className="ai-glass-card rounded px-5 py-3.5 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-16 font-semibold text-slate-900 flex items-center gap-2 flex-wrap">{b.name}{d?.mock && <Badge tone="amber" title="RANK_LANDSCAPE_MOCK is on in backend/.env"><AlertTriangle size={11} />Sample data: not real</Badge>}</div>
          <div className="text-12 text-slate-500">{d?.domain ? <>Tracking <b>{d.domain}</b> · {d.tracked} keyword{d.tracked !== 1 ? 's' : ''}</> : 'Google organic positions of the tracked keywords'}</div>
        </div>
        <Select className={sel} value={days} onChange={e => setDays(Number(e.target.value))} aria-label="Period">{RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        <Button variant="primary" icon={RefreshCw} busy={busy === 'check'} disabled={d && !d.rank_ready} onClick={check} title={d && !d.rank_ready ? 'Link the Google account that owns this site (Search Console) first' : 'Read every tracked keyword from Google Search Console (last 28 days average)'}>Check positions now</Button>
      </div>
      <ErrorNote>{error}</ErrorNote>
      {tab === 'landscape' && <CurrentPositions key={`${b.id}-${tick}`} b={b} onChecked={() => data.reload(true)} />}
      {!d ? (data.error ? <ErrorNote>{data.error.message}</ErrorNote> : <SkPage statLabels={["Visibility", "Estimated traffic", "Average position"]} chartTitle="Rankings distribution" tableTitle="Top keywords" tableHeaders={["Keyword", "Position", "Change", "Volume"]} />)
        : d.state === 'ok' ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><TrackingHeader d={d} /><ExportButtons d={d} toast={toast} /></div>
            {!forced && <TabBar value={tab} onChange={setTab} />}
            {tab === 'landscape' && <Landscape d={d} b={b} onTab={onTab || setTab} />}
            {tab === 'overview' && <PositionOverview d={d} b={b} onChanged={() => data.reload(true)} />}
            {tab === 'distribution' && <Distribution d={d} />}
            {tab === 'tags' && <TagsTab d={d} />}
            {tab === 'pages' && <PagesTab b={b} />}
            {tab === 'cannibal' && <Cannibalization d={d} b={b} />}
            {tab === 'competitors' && <PositionCompetitors d={d} b={b} onChanged={() => data.reload(true)} />}
            {tab === 'devices' && <DevicesLocations d={d} b={b} />}
            {tab === 'snippets' && <Snippets d={d} />}
          </div>)
          : (
            <Card>
              <Empty icon={Search}>
                {d.state === 'no_website' && 'Add the business\'s website first: positions are matched by its domain.'}
                {d.state === 'no_keywords' && <>No keyword is tracked yet. Add keywords in <Link to={path_('organic-rankings')} className="text-indigo-600 font-semibold hover:underline">Organic Rankings</Link>, then check their positions.</>}
                {d.state === 'no_data' && (d.rank_ready ? 'No position has been checked in this period. Press “Check positions now”; the charts grow with every check (the scheduled job also runs one daily).' : 'No position has been checked yet. Link the Google account that owns this website to the project (Search Console), then press “Check positions now”.')}
              </Empty>
            </Card>
          )}
      {toastNode}
    </div>
  );
}
