import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Loader2 } from 'lucide-react';
import { useApi } from './seoApi';
import { Change, Tile } from './TrackingInsightsTab';

const PALETTE = ['#2563eb', '#f97316', '#22c55e', '#a855f7', '#ec4899', '#14b8a6'];
const METRICS = [['visibility', 'Visibility', '%'], ['average', 'Average Position', ''], ['traffic', 'Traffic', '']];
const shortDay = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));

function Mini({ data, color }) {
  if (!data || data.length < 2) return <span className="text-11.5 text-slate-400">1 day</span>;
  return <div className="w-24 h-7"><ResponsiveContainer width="100%" height="100%"><LineChart data={data}><Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>;
}

const Card = ({ title, subtitle, action, children, className = '' }) => <div className={`rounded-xl bg-white ring-1 ring-slate-200 ${className}`}><div className="flex flex-wrap items-start gap-3 px-4 pt-4"><div><h3 className="text-15 font-semibold text-slate-900">{title}</h3>{subtitle && <p className="text-12.5 text-slate-500 mt-0.5">{subtitle}</p>}</div>{action && <div className="ml-auto">{action}</div>}</div>{children}</div>;

export default function CompetitorsTab({ b, keyword }) {
  const [scope, setScope] = useState('all');
  const [metric, setMetric] = useState('visibility');
  const q = scope === 'keyword' ? `&keyword=${encodeURIComponent(keyword)}` : '';
  const ins = useApi(`/businesses/${b.id}/seo/tracking-insights?keyword=${encodeURIComponent(keyword)}`).data;
  const rep = useApi(`/businesses/${b.id}/seo/position-competitors?days=90${q}`);
  const d = rep.data;
  const color = (dom) => PALETTE[Math.max(0, (d?.domains || []).indexOf(dom)) % PALETTE.length];
  const many = scope === 'all';
  const rows = (d?.series || []).map(s => ({ day: s.day, ...Object.fromEntries((d.domains || []).map(dom => [dom, s[dom]?.[metric] ?? null])) }));
  const m = METRICS.find(x => x[0] === metric);
  const you = d?.table?.find(x => x.you);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg ring-1 ring-inset ring-slate-300 overflow-hidden bg-white" role="group" aria-label="Scope">
          {[['all', 'All tracked keywords'], ['keyword', 'This keyword']].map(([k, l]) => <button key={k} type="button" aria-pressed={scope === k} onClick={() => setScope(k)} className={`px-3.5 h-9 text-13 font-medium cursor-pointer ${scope === k ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}
        </div>
        {d && <span className="text-13 text-slate-500">{d.read} search{d.read === 1 ? '' : 'es'} read from Google{d.days_read ? `, on ${d.days_read} day${d.days_read === 1 ? '' : 's'}` : ''}</span>}
      </div>

      {ins && (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          <Tile label="Visibility" value={ins.visibility != null ? `${ins.visibility}%` : '—'} change={<Change now={ins.visibility} before={ins.visibility_prev} unit="%" />} />
          <Tile label="Keywords" value={ins.tracked} change={<span className="text-12 text-slate-500">tracked</span>} />
          <Tile label="Top 3" value={ins.top3} change={<Change now={ins.top3} before={ins.top3_prev} />} />
          <Tile label="Top 10" value={ins.top10} change={<Change now={ins.top10} before={ins.top10_prev} />} />
          <Tile label="Top 100" value={ins.top100} change={<Change now={ins.top100} before={ins.top100_prev} />} />
        </div>
      )}

      {!d ? <div className="flex items-center justify-center gap-2 py-14 text-13 text-slate-500"><Loader2 size={16} className="animate-spin" />Loading…</div> : !d.read ? (
        <div className="rounded-xl bg-white ring-1 ring-slate-200 p-8 text-center text-13 text-slate-500">Google's results have not been read yet, so there are no competitors to compare. Open the <b>SERP Features</b> tab and press Read Google now.</div>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <Card title="Competitors" subtitle={`Who ranks on ${many ? 'your tracked searches' : 'this search'} and how you compare`}
              action={<div className="inline-flex rounded-lg ring-1 ring-inset ring-slate-300 overflow-hidden">{METRICS.map(([k, l]) => <button key={k} type="button" aria-pressed={metric === k} onClick={() => setMetric(k)} className={`px-3 h-8 text-12.5 font-medium cursor-pointer ${metric === k ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}</div>}>
              <div className="px-2 pb-3 pt-2 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rows} margin={{ left: 0, right: 14, top: 8 }}>
                    <CartesianGrid stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fontSize: 11, fill: '#64748b' }} minTickGap={30} padding={{ left: 24, right: 24 }} />
                    <YAxis reversed={metric === 'average'} unit={m[2]} tick={{ fontSize: 11, fill: '#64748b' }} width={metric === 'traffic' ? 52 : 40} allowDecimals={false} domain={metric === 'average' ? [1, 'auto'] : [0, 'auto']} />
                    <Tooltip formatter={(v, n) => [v == null ? '—' : metric === 'average' ? `#${v}` : metric === 'traffic' ? num(v) : `${v}%`, n]} labelFormatter={shortDay} />
                    <Legend verticalAlign="top" height={30} iconType="circle" wrapperStyle={{ fontSize: 12 }} formatter={v => (v === d.own ? 'Your site' : v)} />
                    {d.domains.map(dom => <Line key={dom} type="monotone" dataKey={dom} stroke={color(dom)} strokeWidth={dom === d.own ? 2.5 : 2} dot={{ r: 4, fill: color(dom), stroke: '#fff', strokeWidth: 1.5 }} connectNulls isAnimationActive={false} />)}
                  </LineChart>
                </ResponsiveContainer>
                {d.days_read < 2 && <p className="-mt-1 text-center text-12 text-slate-400">Google has been read on {d.days_read} day so far: each dot is that day. Lines appear after reads on more days.</p>}
              </div>
            </Card>

            <Card title="Competitive Landscape" subtitle="Share of the estimated clicks on these searches">
              <div className="p-4 flex flex-wrap items-center justify-center gap-4">
                <div className="relative w-44 h-44 shrink-0">
                  <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={d.share} dataKey="share" innerRadius={56} outerRadius={80} stroke="#fff" strokeWidth={2} isAnimationActive={false}>{d.share.map((x, i) => <Cell key={x.domain} fill={x.domain === 'Others' ? '#e5e7eb' : color(x.domain)} />)}</Pie></PieChart></ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center"><div className="text-22 font-bold tabular-nums">{you ? `${d.share.find(x => x.you)?.share ?? 0}%` : '0%'}</div><div className="text-12 text-slate-500">Your share</div></div>
                </div>
                <ul className="flex-1 min-w-[170px] space-y-1.5 text-13">{d.share.map(x => <li key={x.domain} className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: x.domain === 'Others' ? '#d1d5db' : color(x.domain) }} /><span className="truncate">{x.you ? 'Your site' : x.domain}</span><span className="ml-auto tabular-nums font-semibold">{x.share}%</span></li>)}</ul>
              </div>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
            <Card title="Competitor Rankings" subtitle="Estimated visibility, and how many searches each site has in the top 3 and top 10">
              <div className="overflow-x-auto mt-2">
                <table className="w-full text-13">
                  <thead><tr className="text-12 text-slate-500 bg-slate-50/70"><th className="px-4 py-2 text-left font-medium">Domain</th><th className="px-3 py-2 text-right font-medium">Visibility</th><th className="px-3 py-2 text-right font-medium">Avg pos.</th><th className="px-3 py-2 text-right font-medium">Top 3</th><th className="px-3 py-2 text-right font-medium">Top 10</th><th className="px-3 py-2 text-right font-medium">Keywords</th><th className="px-3 py-2 text-left font-medium">Trend</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {d.table.map(r => (
                      <tr key={r.domain} className={r.you ? 'bg-blue-50/50' : ''}>
                        <td className="px-4 py-2.5"><span className="inline-flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.domains.includes(r.domain) ? color(r.domain) : '#cbd5e1' }} />{r.you ? <span className="font-semibold text-slate-900">{r.domain} <span className="text-11 text-blue-700">You</span></span> : <a href={`https://${r.domain}`} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">{r.domain}</a>}{r.competitor && <span className="text-11 font-semibold text-rose-700">Competitor</span>}</span></td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{r.visibility}%</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{r.average != null ? `#${r.average}` : '—'}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{r.top3}</td><td className="px-3 py-2.5 text-right tabular-nums">{r.top10}</td><td className="px-3 py-2.5 text-right tabular-nums">{r.keywords}</td>
                        <td className="px-3 py-2.5"><Mini data={r.trend} color={d.domains.includes(r.domain) ? color(r.domain) : '#94a3b8'} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Top Competitors by Keyword" subtitle="Sites that most often rank in the top 10 next to you">
              <div className="overflow-x-auto mt-2">
                <table className="w-full text-13">
                  <thead><tr className="text-12 text-slate-500 bg-slate-50/70"><th className="px-4 py-2 text-left font-medium">Domain</th><th className="px-3 py-2 text-right font-medium">Keywords in top 10</th><th className="px-3 py-2 text-left font-medium w-40">Share of voice</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {d.voice.map(r => (
                      <tr key={r.domain}><td className="px-4 py-2.5"><span className="inline-flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: d.domains.includes(r.domain) ? color(r.domain) : '#cbd5e1' }} /><a href={`https://${r.domain}`} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">{r.domain}</a></span></td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{r.keywords}</td>
                        <td className="px-3 py-2.5"><div className="flex items-center gap-2"><span className="tabular-nums font-semibold w-12">{r.share}%</span><div className="flex-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full" style={{ width: `${Math.min(100, r.share * 2)}%`, background: d.domains.includes(r.domain) ? color(r.domain) : '#94a3b8' }} /></div></div></td></tr>
                    ))}
                    {!d.voice.length && <tr><td colSpan={3} className="px-4 py-6 text-center text-slate-500">No other site in the top 10 yet.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-3"><Link to="/competitor-finder" className="text-13 font-semibold text-indigo-600 hover:underline">View all competitors →</Link></div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
