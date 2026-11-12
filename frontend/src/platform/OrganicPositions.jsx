import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { ChevronRight, ExternalLink, Download, Sparkles } from 'lucide-react';
import { Card, Badge, Button } from './SeoUi';
import { fmt } from './seoApi';
import { AXIS, Th, Chg, Empty, Filter, Segmented, usePager, path, Spark } from './PositionUi';
import Select from '../components/Select';

const SERIES = [['top3', 'Top 3', '#f59e0b'], ['p4_10', '4-10', '#4338ca'], ['p11_20', '11-20', '#818cf8'], ['features', 'SERP Features', '#22c55e']];
const RANGES = [[30, '1M'], [180, '6M'], [365, '1Y']];
const INTENT = { informational: 'I', navigational: 'N', commercial: 'C', transactional: 'T' };
const sel = 'h-9 px-2.5 text-13 rounded border border-slate-200 bg-white text-slate-700 cursor-pointer';
const dash = <span className="text-slate-300">—</span>;
const Url = ({ u }) => u ? <a href={u} target="_blank" rel="noreferrer" title={u} className="text-indigo-700 hover:underline inline-flex items-center gap-1 break-all">{u.replace(/^https?:\/\/(www\.)?/, '')}<ExternalLink size={10} className="shrink-0" /></a> : dash;

function download(name, rows) {
  const head = ['Keyword', 'Intent', 'Position', 'Previous', 'Change', 'SERP features', 'Est. traffic', 'Volume', 'URL', 'Checked'];
  const body = rows.map(r => [r.keyword, r.intent || '', r.rank ?? '', r.was ?? '', r.change ?? '', (r.feature_list || []).join('; '), r.traffic ?? '', r.volume ?? '', r.url || '', r.checked || '']);
  const csv = [head, ...body].map(l => l.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = name;
  a.click();
}

/** Position of one keyword over time, with the page that ranked on each check. */
export function RankedUrls({ r }) {
  const data = r.history.map(h => ({ date: h.date.slice(5), rank: h.rank }));
  const urls = r.history.reduce((acc, h) => (h.url && acc[acc.length - 1]?.url !== h.url ? [...acc, h] : acc), []);
  return (
    <div className="rounded border border-slate-200 bg-white p-4">
      <div className="flex justify-between gap-3 mb-2"><div className="text-14 font-semibold text-slate-900">Ranked URLs</div><div className="text-12 text-slate-500">Filter by: <b className="text-indigo-700">{r.keyword}</b></div></div>
      {r.history.length > 1 ? (
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" vertical={false} />
              <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} width={36} reversed domain={[1, 20]} ticks={[1, 5, 10, 15, 20]} />
              <Tooltip formatter={(v) => [v ?? 'not in top 20', 'Position']} />
              <Line type="stepAfter" dataKey="rank" stroke="#6658dd" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : <p className="text-12.5 text-slate-500 py-3">One check so far: the position line draws after the next check.</p>}
      <ul className="mt-2 space-y-1 text-13">
        {urls.map(h => <li key={h.date + h.url} className="flex gap-3 items-center"><span className="tabular-nums text-slate-500 w-12">{h.date.slice(5)}</span><span className="tabular-nums font-semibold w-8">{h.rank ?? '—'}</span><Url u={h.url} /></li>)}
        {!urls.length && <li className="text-slate-500">None of your pages was in the top 20 on these checks.</li>}
      </ul>
      <div className="mt-3 pt-3 border-t border-slate-100 text-13">
        <span className="text-slate-500">SERP features on this SERP: </span>
        {r.feature_list.length ? r.feature_list.map(f => <Badge key={f} tone={r.own_feature_list.includes(f) ? 'green' : 'gray'} className="mr-1.5">{f}{r.own_feature_list.includes(f) ? ' (you)' : ''}</Badge>) : <span className="text-slate-400">none seen</span>}
      </div>
      {r.serp_top?.length > 0 && <div className="mt-2 text-12 text-slate-500">Top results: {r.serp_top.map(x => `${x.p}. ${x.d}`).join('  ·  ')}</div>}
    </div>
  );
}

/** Organic Positions: a trend of how many keywords sit in each position band, and every tracked keyword with its details. */
export default function OrganicPositions({ research, days, setDays }) {
  const r = research?.state === 'ok' ? research : null;
  const [mode, setMode] = useState('all');
  const [q, setQ] = useState('');
  const [band, setBand] = useState('');
  const [intent, setIntent] = useState('');
  const [feat, setFeat] = useState('');
  const [shown, setShown] = useState(() => new Set(['top3', 'p4_10', 'p11_20', 'features']));
  const [open, setOpen] = useState(() => new Set());
  const toggle = (k) => setOpen(o => { const n = new Set(o); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const rows = useMemo(() => (r?.tracked_rows || []).filter(x =>
    (mode !== 'serp' || x.feature_list.length) && (!q || x.keyword.toLowerCase().includes(q.toLowerCase())) && (!intent || x.intent === intent) && (!feat || x.feature_list.includes(feat))
    && (!band || (band === 'top3' ? x.rank && x.rank <= 3 : band === 'top10' ? x.rank && x.rank <= 10 : band === '11-20' ? x.rank > 10 : !x.rank))), [r, mode, q, band, intent, feat]);
  const [slice, footer] = usePager(rows, 25);
  if (!r) return <Card><Empty>{research?.state === 'no_keywords' ? 'No keyword is tracked yet. Add keywords, then check positions.' : 'No position has been checked in this period yet. Press "Check positions now" in Position Tracking.'}</Empty></Card>;

  const feats = r.features;
  const trend = r.distribution.map((x, i) => ({ date: x.date.slice(5), ...x, features: feats.names.reduce((a, n) => Math.max(a, feats.trend[n][i] || 0), 0) }));
  const all = r.tracked_rows;
  const ranking = all.filter(x => x.rank);
  const traffic = all.reduce((a, x) => a + (x.traffic || 0), 0);
  const hasVol = all.some(x => x.volume);
  const intents = [...new Set(all.map(x => x.intent).filter(Boolean))];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={mode} onChange={setMode} options={[['all', 'All Positions'], ['organic', 'Organic'], ['serp', 'SERP Features']]} />
        <Filter value={q} onChange={setQ} placeholder="Filter by keyword" />
        <Select className={sel} value={band} onChange={e => setBand(e.target.value)} aria-label="Positions"><option value="">Positions</option><option value="top3">Top 3</option><option value="top10">Top 10</option><option value="11-20">11-20</option><option value="none">Not ranking</option></Select>
        <Select className={sel} value={intent} onChange={e => setIntent(e.target.value)} aria-label="Intent"><option value="">Intent</option>{intents.map(i => <option key={i} value={i}>{i}</option>)}</Select>
        <Select className={sel} value={feat} onChange={e => setFeat(e.target.value)} aria-label="SERP features"><option value="">SERP Features</option>{feats.names.filter(n => all.some(x => x.feature_list.includes(n))).map(n => <option key={n}>{n}</option>)}</Select>
      </div>

      <Card pad={false}>
        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-100">
          <div className="px-5 py-4"><div className="text-13 text-slate-600">Keywords</div><div className="flex items-end gap-3"><span className="text-26 font-bold tabular-nums">{all.length}</span><span className="text-12 text-slate-500 pb-1">{ranking.length} in the top 20</span></div><Spark values={r.distribution.map(x => x.top20)} h={36} /></div>
          <div className="px-5 py-4"><div className="text-13 text-slate-600">Traffic</div><div className="text-26 font-bold tabular-nums">{hasVol ? Math.round(traffic * 10) / 10 : '—'}</div><Spark values={r.distribution.map(x => x.traffic)} h={36} />{!hasVol && <div className="text-11.5 text-slate-400">Needs keyword search volumes.</div>}</div>
          <div className="px-5 py-4"><div className="text-13 text-slate-600">Traffic cost</div><div className="text-26 font-bold tabular-nums text-slate-400">—</div><div className="text-11.5 text-slate-400">Needs keyword CPC data (Google Ads).</div></div>
        </div>
      </Card>

      <Card title="Organic Keywords Trend" subtitle="Tracked keywords by position, on every check">
        <div className="flex flex-wrap items-center gap-4 mb-2 text-12.5">
          {SERIES.map(([k, l, c]) => <label key={k} className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700"><input type="checkbox" style={{ accentColor: c }} checked={shown.has(k)} onChange={() => setShown(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; })} />{l}</label>)}
          <span className="ml-auto flex gap-3">{RANGES.map(([v, l]) => <button key={v} type="button" onClick={() => setDays(v)} className={`text-13 font-semibold cursor-pointer pb-0.5 border-b-2 ${days === v ? 'text-slate-900 border-indigo-500' : 'text-slate-500 border-transparent hover:text-slate-800'}`}>{l}</button>)}</span>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trend} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" vertical={false} />
              <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} minTickGap={20} />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={36} />
              <Tooltip />
              {SERIES.filter(([k]) => k !== 'features' && shown.has(k)).reverse().map(([k, l, c]) => <Bar key={k} dataKey={k} name={l} stackId="p" fill={c} />)}
              {shown.has('features') && <Bar dataKey="features" name="SERP Features" fill="#22c55e" fillOpacity={0.6} barSize={6} />}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="text-11.5 text-slate-400 mt-1">Google results are read to the top 20, so there are no 21-50 or 51-100 bands.</p>
      </Card>

      <Card title={<span>Organic Search Positions: <b>{rows.length}</b></span>} pad={false} action={<Button size="sm" icon={Download} onClick={() => download(`${r.domain}-positions.csv`, rows)}>Export</Button>}>
        <div className="overflow-x-auto">
          <table className="w-full text-13 min-w-[1300px]">
            <thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th> </Th><Th>Keyword</Th><Th c="text-right">KD, %</Th><Th c="text-right">Vol.</Th><Th c="text-right">Traffic Change</Th><Th c="text-right">Comp.</Th><Th c="text-right">CPC</Th><Th>Crawled Time</Th><Th c="text-right">Position</Th><Th c="text-right">Results</Th><Th c="text-right">SF</Th><Th>Intent</Th><Th>URL</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">{slice.map(x => (
              <React.Fragment key={x.keyword}>
                <tr className="hover:bg-slate-50 align-top">
                  <td className="pl-3 w-8 pt-2.5"><button type="button" aria-label="Show details" onClick={() => toggle(x.keyword)} className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"><ChevronRight size={14} className={`transition-transform ${open.has(x.keyword) ? 'rotate-90' : ''}`} /></button></td>
                  <td className="px-4 py-2.5 font-medium text-indigo-700">{x.keyword}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{x.kd ?? dash}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{x.volume != null ? fmt(x.volume) : dash}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{x.traffic != null && x.traffic_was != null ? (() => { const d = Math.round((x.traffic - x.traffic_was) * 100) / 100; return d ? <Chg v={d} /> : <span className="text-slate-500">0</span>; })() : dash}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums" title="Competition needs Google Keyword Planner data, which is not connected">{dash}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{x.cpc ?? dash}</td>
                  <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{x.checked ? new Date(`${x.checked}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' }) : dash}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums"><b>{x.rank ?? <span className="text-slate-400 font-normal">&gt;20</span>}</b> <Chg v={x.change} d={0} /></td>
                  <td className="px-4 py-2.5 text-right tabular-nums" title="Google's total result count is not reported by our results source">{dash}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{x.feature_list.length ? <span className="inline-flex items-center gap-1 text-slate-700" title={x.feature_list.join(', ')}><Sparkles size={12} className="text-emerald-500" />{x.feature_list.length}</span> : dash}</td>
                  <td className="px-4 py-2.5">{x.intent ? <span title={x.intent} className="inline-flex w-5 h-5 rounded text-[11px] font-bold items-center justify-center bg-indigo-100 text-indigo-700">{INTENT[x.intent] || '?'}</span> : dash}</td>
                  <td className="px-4 py-2.5 max-w-[300px]">{x.url ? <a href={x.url} target="_blank" rel="noreferrer" title={x.url} className="text-indigo-700 hover:underline inline-flex items-center gap-1 break-all">{path(x.url)}<ExternalLink size={10} className="shrink-0" /></a> : dash}</td>
                </tr>
                {open.has(x.keyword) && <tr className="bg-slate-50/60"><td /><td colSpan={12} className="px-4 py-3"><RankedUrls r={x} /></td></tr>}
              </React.Fragment>))}
              {!slice.length && <tr><td colSpan={13} className="px-5 py-10 text-center text-slate-500">No keyword matches these filters.</td></tr>}
            </tbody>
          </table>
        </div>
        {footer}
      </Card>
    </div>
  );
}
