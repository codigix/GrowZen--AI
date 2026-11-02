import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, ScatterChart, Scatter, PieChart, Pie, Cell, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { Loader2, ArrowUp, ArrowDown, RefreshCw, ExternalLink, AlertTriangle, Search, Inbox, Info } from 'lucide-react';
import { Card, Badge, Button, ErrorNote, useAction, useToast, useModulePath } from './SeoUi';
import { api, useApi, fmt } from './seoApi';

/**
 * Position Tracking "Landscape": visibility, estimated traffic, average position, distribution, movers, tags, competitors,
 * SERP features, pages and cannibalization of the tracked keywords. Every figure is computed on the server from the saved
 * Google rank checks (GET /businesses/{id}/seo/position-landscape, services/landscape.py).
 */

const AXIS = { fontSize: 11, fill: '#64748b' };
const BUCKETS = [['top3', '1-3', '#f59e0b'], ['p4_10', '4-10', '#4338ca'], ['p11_20', '11-20', '#818cf8'], ['out', 'Not in top 10', '#e2e8f0']];
const PALETTE = ['#6658dd', '#1abc9c', '#a855f7', '#f59e0b', '#ef4444', '#0ea5e9', '#84cc16', '#ec4899', '#14b8a6', '#64748b'];
const RANGES = [[30, 'Last 30 days'], [60, 'Last 60 days'], [90, 'Last 90 days']];
const Th = ({ children, c = 'text-left' }) => <th className={`px-4 py-2.5 font-semibold whitespace-nowrap ${c}`}>{children}</th>;
const path = (u) => { try { const x = new URL(u); return x.pathname + x.search || '/'; } catch (e) { return u; } };
const sign = (v, d = 2) => (v == null ? '' : `${v > 0 ? '+' : ''}${Number(v.toFixed(d))}`);

/** A change: green when it is good. better = which direction is good. */
function Chg({ v, better = 'up', unit = '', d = 2 }) {
  if (v == null) return null;
  if (!v) return <span className="text-11.5 text-slate-400">no change</span>;
  const good = (v > 0) === (better === 'up');
  return <span className={`inline-flex items-center gap-0.5 text-11.5 font-semibold ${good ? 'text-emerald-600' : 'text-red-500'}`}>{v > 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}{Math.abs(Number(v.toFixed(d)))}{unit}</span>;
}

function Spark({ values, color = '#6658dd', h = 44 }) {
  const data = values.map((v, i) => ({ i, v })).filter(x => x.v != null);
  if (data.length < 2) return <div style={{ height: h }} />;
  return (
    <div style={{ height: h }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
          <defs><linearGradient id={`sp-${color.slice(1)}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.3} /><stop offset="100%" stopColor={color} stopOpacity={0.02} /></linearGradient></defs>
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#sp-${color.slice(1)})`} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function Empty({ icon: Icon = Inbox, children }) {
  return <div className="py-10 flex flex-col items-center text-center gap-2 text-13 text-slate-500"><Icon size={22} className="text-slate-300" /><span className="max-w-sm">{children}</span></div>;
}

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

const KeywordTable = ({ rows, empty = 'No keywords.' }) => (
  <div className="overflow-auto max-h-[420px]">
    <table className="w-full text-13">
      <thead className="sticky top-0 bg-slate-50 text-11.5 text-slate-500"><tr><Th>Keyword</Th><Th c="text-right">Pos.</Th><Th c="text-right">Change</Th><Th c="text-right">Volume</Th><Th c="text-right">Visibility</Th><Th>Tag</Th></tr></thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map(r => (
          <tr key={r.keyword} className="hover:bg-slate-50">
            <td className="px-4 py-2.5 font-medium text-indigo-700 max-w-[280px] truncate" title={r.keyword}>{r.keyword}</td>
            <td className="px-4 py-2.5 text-right tabular-nums">{r.rank ?? <span className="text-slate-400">&gt;10</span>}</td>
            <td className="px-4 py-2.5 text-right"><Chg v={r.change} d={0} /></td>
            <td className="px-4 py-2.5 text-right tabular-nums">{r.volume != null ? fmt(r.volume) : '—'}</td>
            <td className="px-4 py-2.5 text-right tabular-nums">{r.visibility}%</td>
            <td className="px-4 py-2.5 text-slate-500">{r.tag || '—'}</td>
          </tr>
        ))}
        {!rows.length && <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-500">{empty}</td></tr>}
      </tbody>
    </table>
  </div>
);

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

export function Landscape({ d }) {
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
          <Metric label="Average position" hint="Average of the positions of the keywords that rank in the top 10. Lower is better." value={d.cards.avg_position.value} change={d.cards.avg_position.change} better="down" series={d.cards.avg_position.series} />
        </Card>
        <Card className="xl:col-span-3" title="Summary" subtitle={`${d.domain} · ${d.period.start} → ${d.period.end} · ${d.period.checks} check${d.period.checks !== 1 ? 's' : ''}`}>
          <ul className="space-y-2.5 text-13 text-slate-700 list-disc pl-5 marker:text-indigo-400">{d.summary.map(s => <li key={s}>{s}</li>)}</ul>
          {!d.comparable && <p className="mt-3 text-12 text-slate-400">Only one check so far: changes appear after the next check.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 items-start">
        <Card className="xl:col-span-3" title="Rankings distribution" subtitle="Tracked keywords by position, per check (Google results are read to the top 10)">
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
                {[...BUCKETS].reverse().filter(([key]) => key !== 'out' || showOut).map(([key, l, c]) => <Bar key={key} dataKey={key} name={l} stackId="d" fill={c} />)}
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
          <KeywordTable rows={shownRows} empty="No keywords in this view." />
        </Card>
      )}

      <Card title={`Tags (${d.tags.length})`} subtitle="Keywords grouped by their cluster" pad={false}>
        {d.tags.length ? (
          <table className="w-full text-13">
            <thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>Tag</Th><Th c="text-right">Keywords</Th><Th c="text-right">Visibility</Th><Th c="text-right">Est. traffic</Th><Th c="text-right">Avg. pos.</Th><Th c="text-right">Volume</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">{d.tags.map(t => (
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
      </Card>

      <Card title="Market traffic vs. selected domains" subtitle="Domains in the Google results of your tracked keywords. Across: keywords they appear for. Up: better average position. Size: visibility.">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 16, left: -4, bottom: 8 }}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" />
                <XAxis type="number" dataKey="keywords" name="Keywords" tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} domain={[0, 'dataMax + 2']} />
                <YAxis type="number" dataKey="avg_position" name="Avg. position" reversed tick={AXIS} tickLine={false} axisLine={false} width={40} domain={[1, 'dataMax + 1']} />
                <ZAxis type="number" dataKey="visibility" range={[160, 1400]} />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ payload }) => payload?.[0] ? <div className="bg-white border border-slate-200 rounded px-2.5 py-1.5 text-12"><b>{payload[0].payload.domain}{payload[0].payload.you ? ' (you)' : ''}</b><div>{payload[0].payload.keywords} keywords · avg position {payload[0].payload.avg_position}</div><div>Visibility {payload[0].payload.visibility}%</div></div> : null} />
                {d.competitors.filter(isOn).map(c => <Scatter key={c.domain} name={c.domain} data={[c]} fill={PALETTE[(c.rank - 1) % PALETTE.length]} fillOpacity={0.55} />)}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div>
            <table className="w-full text-13">
              <thead className="text-11.5 text-slate-500"><tr><Th> </Th><Th>#</Th><Th>Competitor</Th><Th c="text-right">Visibility</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">{d.competitors.map(c => (
                <tr key={c.domain} className={c.you ? 'bg-indigo-50/50' : ''}>
                  <td className="px-4 py-2"><input type="checkbox" checked={isOn(c)} onChange={() => togglePick(c.domain)} style={{ accentColor: PALETTE[(c.rank - 1) % PALETTE.length] }} aria-label={`Show ${c.domain}`} /></td>
                  <td className="px-2 py-2 tabular-nums text-slate-500">{c.rank}</td>
                  <td className="px-4 py-2 max-w-[220px] truncate"><a href={`https://${c.domain}`} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">{c.domain}</a>{c.you && <span className="ml-2 text-11 text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">You</span>}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{c.visibility}% <Chg v={c.change} /></td>
                </tr>))}</tbody>
            </table>
            <p className="text-11.5 text-slate-400 mt-2">{d.competitor_total} domains appear in the results.</p>
          </div>
        </div>
      </Card>

      <Card title="SERP features" subtitle="On how many tracked keywords each feature appears on Google">
        {features.length ? (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={features} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="feature" tick={AXIS} tickLine={false} axisLine={false} interval={0} />
                <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={36} />
                <Tooltip /><Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="yours" name={`${d.domain} appears`} stackId="f" fill="#4338ca" />
                <Bar dataKey="other" name="Present, you are not in it" stackId="f" fill="#c7d2fe" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <Empty>No SERP features were recorded on the latest checks.</Empty>}
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
        ) : <Empty>{pagesTab === 'top' ? 'No page of this site ranked in the top 10 for a tracked keyword.' : `No ${pagesTab} pages in this period.`}</Empty>}
        {d.pages.total > 8 && <p className="px-4 py-3 text-12 text-slate-400">Showing 8 of {d.pages.total} ranking pages.</p>}
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
        {d.cannibal.affected > 0 && <div className="mt-4 text-12.5 text-slate-600">Merge or differentiate the competing pages so one page owns each keyword. Open the affected keywords in <b>All keywords</b> to see which URLs rank.</div>}
      </Card>
      <p className="text-11.5 text-slate-400 flex items-start gap-1.5"><Info size={12} className="mt-0.5 shrink-0" />Visibility and estimated traffic are modelled from your saved Google rank checks (top 10 results) with a standard click-through curve and the keyword volumes you track. They will not match another tool exactly.</p>
    </div>
  );
}

export default function PositionLandscape({ b }) {
  const path_ = useModulePath();
  const [days, setDays] = useState(30);
  const data = useApi(`/businesses/${b.id}/seo/position-landscape?days=${days}`);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const d = data.data;
  const check = () => run('check', async () => {
    const r = await api(`/businesses/${b.id}/seo/check-ranks`, { method: 'POST', body: {} });
    toast(`Checked ${r.checked} keyword${r.checked !== 1 ? 's' : ''} (${r.credits} Serper credit${r.credits !== 1 ? 's' : ''})`);
    data.reload(true);
  });
  const sel = 'h-9 px-2.5 text-13 rounded border border-slate-200 bg-white text-slate-700 cursor-pointer';
  return (
    <div className="space-y-4">
      <div className="ai-glass-card rounded px-5 py-3.5 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-16 font-semibold text-slate-900 flex items-center gap-2 flex-wrap">{b.name}{d?.mock && <Badge tone="amber" title="RANK_LANDSCAPE_MOCK is on in backend/.env"><AlertTriangle size={11} />Sample data: not real</Badge>}</div>
          <div className="text-12 text-slate-500">{d?.domain ? <>Tracking <b>{d.domain}</b> · {d.tracked} keyword{d.tracked !== 1 ? 's' : ''}</> : 'Google organic positions of the tracked keywords'}</div>
        </div>
        <select className={sel} value={days} onChange={e => setDays(Number(e.target.value))} aria-label="Period">{RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <Button variant="primary" icon={RefreshCw} busy={busy === 'check'} disabled={d && !d.serper} onClick={check} title={d && !d.serper ? 'Set SERPER_API_KEY to check positions' : 'Check Google now for every tracked keyword'}>Check positions now</Button>
      </div>
      <ErrorNote>{error}</ErrorNote>
      {!d ? (data.error ? <ErrorNote>{data.error.message}</ErrorNote> : <div className="py-16 flex justify-center text-slate-400"><Loader2 size={18} className="animate-spin" /></div>)
        : d.state === 'ok' ? <Landscape d={d} />
          : (
            <Card>
              <Empty icon={Search}>
                {d.state === 'no_website' && 'Add the business\'s website first: positions are matched by its domain.'}
                {d.state === 'no_keywords' && <>No keyword is tracked yet. Add keywords in <Link to={path_('organic-rankings')} className="text-indigo-600 font-semibold hover:underline">Organic Rankings</Link>, then check their positions.</>}
                {d.state === 'no_data' && (d.serper ? 'No position has been checked in this period. Press “Check positions now”; the charts grow with every check (the scheduled job also runs one daily).' : 'No position has been checked yet, and Google results are not connected: set SERPER_API_KEY in backend/.env.')}
              </Empty>
            </Card>
          )}
      {toastNode}
    </div>
  );
}
