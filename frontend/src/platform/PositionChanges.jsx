import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { ChevronRight, ExternalLink, Download, Settings2, ArrowUp, ArrowDown, Sparkles, X, CalendarDays, Gauge } from 'lucide-react';
import { Card, Button, Badge } from './SeoUi';
import { fmt } from './seoApi';
import { AXIS, Th, Chg, Empty, usePager, path } from './PositionUi';
import { RankedUrls } from './OrganicPositions';

const dash = <span className="text-slate-300">—</span>;
const KINDS = [['all', 'All Changes', 'View all position changes', null], ['improved', 'Improved', 'Grown traffic positions', ArrowUp], ['declined', 'Declined', 'Decreased traffic positions', ArrowDown], ['serp', 'Changes on SERP', 'Significant SERP changes', null]];
const COLS = [['intent', 'Intent'], ['prev', 'Previous'], ['traffic', 'Traffic'], ['share', 'Traffic %'], ['serp', 'Changes on SERP'], ['vol', 'Volume'], ['kd', 'KD %'], ['cpc', 'CPC'], ['url', 'URL'], ['updated', 'Updated']];
const INTENT = { informational: 'I', navigational: 'N', commercial: 'C', transactional: 'T' };
const INTENT_STYLE = { informational: 'bg-indigo-100 text-indigo-700', navigational: 'bg-violet-100 text-violet-700', commercial: 'bg-amber-100 text-amber-700', transactional: 'bg-emerald-100 text-emerald-700' };
const monthOf = (iso) => iso.slice(0, 7);
const when = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const ago = (iso) => { if (!iso) return null; const d = Math.round((Date.now() - new Date(`${iso}T00:00:00`).getTime()) / 86400000); return d <= 0 ? 'today' : d === 1 ? '1 day' : `${d} days`; };

function download(name, rows) {
  const head = ['Keyword', 'Previous', 'Current', 'Diff', 'Traffic change', 'Volume', 'KD %', 'CPC', 'URL'];
  const csv = [head, ...rows.map(r => [r.keyword, r.was ?? '', r.rank ?? '', r.change ?? '', r.traffic_diff ?? '', r.volume ?? '', r.kd ?? '', r.cpc ?? '', r.url || ''])].map(l => l.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = name;
  a.click();
}

/** Position Changes: how many keywords moved up or down on each check, the pages that moved, and every keyword that changed with the cause. */
export default function PositionChanges({ research }) {
  const r = research?.state === 'ok' ? research : null;
  const [view, setView] = useState('daily');
  const [show, setShow] = useState({ traffic: true, improved: true, declined: true });
  const [kind, setKind] = useState('all');
  const [cols, setCols] = useState(() => new Set(COLS.map(c => c[0])));
  const [showCols, setShowCols] = useState(false);
  const [banner, setBanner] = useState(true);
  const [open, setOpen] = useState(() => new Set());
  const toggleRow = (k) => setOpen(o => { const n = new Set(o); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const by = useMemo(() => Object.fromEntries((r?.tracked_rows || []).map(x => [x.keyword, x])), [r]);
  const serpFor = useMemo(() => {
    const m = {};
    for (const [k, list] of Object.entries(r?.features?.changes || {})) for (const x of list) (m[x.keyword] = m[x.keyword] || []).push({ feature: x.feature, kind: k });
    return m;
  }, [r]);
  const totalTraffic = (r?.tracked_rows || []).reduce((a, x) => a + (x.traffic || 0), 0);

  // every keyword whose position changed, with where it was, where it is now, and what that did to its traffic
  const changed = useMemo(() => {
    if (!r) return [];
    const out = [];
    for (const [type, list] of Object.entries(r.changes || {})) {
      for (const c of list) {
        const t = by[c.keyword] || {};
        out.push({ ...t, ...c, type, traffic_diff: t.traffic != null && t.traffic_was != null ? Math.round((t.traffic - t.traffic_was) * 100) / 100 : null, share: totalTraffic && t.traffic != null ? t.traffic / totalTraffic * 100 : null, serp: serpFor[c.keyword] || [] });
      }
    }
    return out.sort((a, z) => Math.abs(z.traffic_diff || 0) - Math.abs(a.traffic_diff || 0) || Math.abs(z.change || 0) - Math.abs(a.change || 0));
  }, [r, by, serpFor, totalTraffic]);
  const improved = changed.filter(x => x.type === 'improved' || x.type === 'new');
  const declined = changed.filter(x => x.type === 'declined' || x.type === 'lost');
  const withSerp = Object.keys(serpFor).map(k => by[k] && { ...by[k], ...changed.find(c => c.keyword === k), serp: serpFor[k], keyword: k, type: 'serp' }).filter(Boolean);
  const rows = kind === 'improved' ? improved : kind === 'declined' ? declined : kind === 'serp' ? withSerp : changed;
  const [slice, footer] = usePager(rows, 25);

  // the trend: on each check, how many keywords moved up or down against the check before, and the modelled traffic
  const trend = useMemo(() => {
    if (!r) return [];
    const dates = r.distribution.map(x => x.date);
    return dates.map((date, i) => {
      let up = 0, down = 0;
      if (i > 0) {
        for (const t of r.tracked_rows) {
          const now = t.history.find(h => h.date === date);
          const before = [...t.history].reverse().find(h => h.date < date);
          if (!now || !before) continue;
          const a = before.rank ?? 99, z = now.rank ?? 99;
          if (z < a) up += 1; else if (z > a) down += 1;
        }
      }
      return { date, traffic: r.distribution[i].traffic ?? 0, improved: up, declined: down };
    });
  }, [r]);
  const chart = useMemo(() => {
    if (view === 'daily') return trend.map(x => ({ ...x, label: when(x.date) }));
    const m = {};
    for (const x of trend) { const k = monthOf(x.date); m[k] = m[k] || { date: k, traffic: 0, improved: 0, declined: 0, n: 0 }; m[k].improved += x.improved; m[k].declined += x.declined; m[k].traffic = x.traffic; m[k].n += 1; }
    return Object.values(m).map(x => ({ ...x, label: new Date(`${x.date}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }) }));
  }, [trend, view]);

  // pages that moved: the site's pages whose average position or traffic changed over the period
  const pageChanges = useMemo(() => {
    const p = r?.own_pages;
    if (!p) return [];
    const seen = new Set();
    return [...(p.improved || []), ...(p.declined || [])].filter(x => (seen.has(x.url) ? false : seen.add(x.url))).sort((a, z) => Math.abs(z.traffic_change || 0) - Math.abs(a.traffic_change || 0)).slice(0, 6);
  }, [r]);

  if (!r) return <Card><Empty>{research?.state === 'no_keywords' ? 'No keyword is tracked yet. Add keywords, then check positions.' : 'No position has been checked in this period yet. Press "Check positions now" in Position Tracking.'}</Empty></Card>;
  const counts = { all: changed.length, improved: improved.length, declined: declined.length, serp: withSerp.length };
  const toggleCol = (c) => setCols(s => { const n = new Set(s); n.has(c) ? n.delete(c) : n.add(c); return n; });
  const legend = (id, label, color) => <label key={id} className="inline-flex items-center gap-1.5 text-13 text-slate-800 cursor-pointer"><input type="checkbox" checked={show[id]} style={{ accentColor: color }} onChange={() => setShow(s => ({ ...s, [id]: !s[id] }))} /><span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />{label}</label>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_1fr] gap-4 items-stretch">
        <Card title="Position Changes Trend" pad={false}>
          <div className="px-5 py-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100">
            <div className="flex flex-wrap items-center gap-4">{legend('traffic', 'Traffic', '#6366f1')}{legend('improved', 'Improved', '#10b981')}{legend('declined', 'Declined', '#ef4444')}</div>
            <div className="flex gap-4">{[['daily', 'Daily'], ['monthly', 'Monthly']].map(([id, l]) => <button key={id} type="button" onClick={() => setView(id)} className={`text-14 pb-0.5 border-b-2 cursor-pointer ${view === id ? 'text-slate-900 border-indigo-500' : 'text-slate-600 border-transparent hover:text-slate-900'}`}>{l}</button>)}</div>
          </div>
          <div className="px-3 pb-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart} margin={{ top: 8, right: 16, left: -6, bottom: 0 }}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis yAxisId="n" tick={AXIS} tickLine={false} axisLine={false} width={36} allowDecimals={false} />
                <YAxis yAxisId="t" orientation="right" tick={AXIS} tickLine={false} axisLine={false} width={40} hide={!show.traffic} />
                <Tooltip />
                {show.traffic && <Line yAxisId="t" type="monotone" dataKey="traffic" name="Traffic" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />}
                {show.improved && <Line yAxisId="n" type="monotone" dataKey="improved" name="Improved" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />}
                {show.declined && <Line yAxisId="n" type="monotone" dataKey="declined" name="Declined" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Top Page Changes" action={<span className="text-13 text-slate-500">This period</span>} pad={false}>
          {pageChanges.length ? (
            <ul className="divide-y divide-slate-100 border-t border-slate-100">{pageChanges.map(p => (
              <li key={p.url} className="px-5 py-3 flex items-center gap-3 text-13">
                <a href={p.url} target="_blank" rel="noreferrer" title={p.url} className="flex-1 min-w-0 truncate text-indigo-700 hover:underline inline-flex items-center gap-1">{path(p.url)}<ExternalLink size={10} className="shrink-0" /></a>
                <span className="tabular-nums text-slate-500">avg. {p.avg_position}</span>
                {p.avg_position_change != null && <Chg v={p.avg_position_change} better="down" d={1} />}
                {p.traffic_change != null && p.traffic_change !== 0 && <span className="tabular-nums"><Chg v={p.traffic_change} /></span>}
              </li>))}</ul>
          ) : (
            <div className="py-16 flex flex-col items-center text-center border-t border-slate-100">
              <CalendarDays size={44} className="text-slate-300" />
              <div className="mt-3 text-16 font-bold text-slate-600">Nothing found</div>
              <div className="text-13 text-slate-500">No page moved in this period. Pages show here after a second position check.</div>
            </div>
          )}
        </Card>
      </div>

      {banner && (
        <div className="relative rounded border border-indigo-200 bg-indigo-50/70 px-5 py-4 flex flex-wrap items-center gap-4">
          <span className="w-12 h-12 rounded-full bg-white text-indigo-500 flex items-center justify-center shrink-0"><Gauge size={22} /></span>
          <div className="flex-1 min-w-[260px] pr-6">
            <p className="text-14 text-slate-800">Track positions for your specific keywords on a daily basis. Target different devices and locations. Monitor how your competitors are ranking for your target keywords.</p>
            <Link to="/rank-tracking" className="mt-2 h-9 px-3.5 rounded inline-flex items-center text-13 font-semibold bg-indigo-600 text-white hover:bg-indigo-700">Set up the Position Tracking tool</Link>
          </div>
          <button type="button" aria-label="Dismiss" onClick={() => setBanner(false)} className="absolute top-3 right-3 text-slate-500 hover:text-slate-800 cursor-pointer"><X size={16} /></button>
        </div>
      )}

      <div className="flex justify-end"><span className="h-10 px-3.5 inline-flex items-center gap-2 rounded border border-slate-300 bg-white text-14 text-slate-800"><CalendarDays size={16} />{when(r.period.start)} – {when(r.period.end)}, {r.period.end.slice(0, 4)}</span></div>

      <div className="grid grid-cols-2 xl:grid-cols-4 rounded border border-slate-200 bg-white overflow-hidden">
        {KINDS.map(([id, label, hint, Icon]) => (
          <button key={id} type="button" onClick={() => { setKind(id); }} className={`text-left px-5 py-4 border-r last:border-r-0 border-slate-200 cursor-pointer ${kind === id ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
            <div className="flex items-center justify-between text-16 text-slate-900"><span className="inline-flex items-center gap-1.5">{Icon && <Icon size={15} className={id === 'improved' ? 'text-emerald-600' : 'text-red-500'} />}{label}</span><span className="tabular-nums text-slate-700">{counts[id]}</span></div>
            <div className="text-13 text-slate-500 mt-0.5">{hint}</div>
          </button>))}
      </div>

      <Card pad={false} title={<span>All Position Changes: <b>{rows.length}</b></span>}
        action={<div className="relative flex items-center gap-2">
          <Button size="sm" icon={Settings2} onClick={() => setShowCols(o => !o)}>Manage columns <span className="ml-1 text-slate-500">{cols.size + 3}/{COLS.length + 3}</span></Button>
          <Button size="sm" icon={Download} onClick={() => download(`${r.domain}-position-changes.csv`, rows)}>Export</Button>
          {showCols && (
            <div className="absolute right-0 top-full mt-1 z-20 w-52 rounded bg-white shadow-lg ring-1 ring-slate-200 p-2 text-13">
              {COLS.map(([c, l]) => <label key={c} className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-slate-50 rounded"><input type="checkbox" checked={cols.has(c)} onChange={() => toggleCol(c)} />{l}</label>)}
            </div>)}
        </div>}>
        <div className="overflow-x-auto border-t border-slate-100">
          <table className="w-full text-14 min-w-[1180px]">
            <thead className="bg-slate-50 text-12 text-slate-600">
              <tr><Th> </Th><Th>Keyword</Th>{cols.has('intent') && <Th>Intent</Th>}{cols.has('prev') && <Th c="text-right">Previous</Th>}<Th c="text-right">Current</Th><Th c="text-right">Diff.</Th>
                {cols.has('traffic') && <Th c="text-right">Traffic</Th>}{cols.has('share') && <Th c="text-right">Traffic %</Th>}{cols.has('serp') && <Th>Changes on SERP</Th>}{cols.has('vol') && <Th c="text-right">Volume</Th>}
                {cols.has('kd') && <Th c="text-right">KD %</Th>}{cols.has('cpc') && <Th c="text-right">CPC</Th>}{cols.has('url') && <Th>URL</Th>}{cols.has('updated') && <Th c="text-right">Updated</Th>}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {slice.map(x => (
                <React.Fragment key={`${x.type}-${x.keyword}`}>
                  <tr className="hover:bg-slate-50 align-top">
                    <td className="pl-3 pt-3 w-8"><button type="button" aria-label="Show the position chart" onClick={() => toggleRow(x.keyword)} className="p-1 text-slate-500 hover:text-slate-900 cursor-pointer"><ChevronRight size={15} className={`transition-transform ${open.has(x.keyword) ? 'rotate-90' : ''}`} /></button></td>
                    <td className="px-4 py-3 max-w-[260px]"><button type="button" onClick={() => toggleRow(x.keyword)} className="text-indigo-700 hover:underline text-left cursor-pointer">{x.keyword}</button></td>
                    {cols.has('intent') && <td className="px-4 py-3">{x.intent && INTENT[x.intent] ? <span title={x.intent} className={`inline-flex w-5 h-5 rounded text-[11px] font-bold items-center justify-center ${INTENT_STYLE[x.intent]}`}>{INTENT[x.intent]}</span> : dash}</td>}
                    {cols.has('prev') && <td className="px-4 py-3 text-right tabular-nums">{x.was ?? dash}</td>}
                    <td className="px-4 py-3 text-right tabular-nums">{x.rank ?? dash}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{x.type === 'new' ? <span className="text-emerald-600 font-medium">new</span> : x.type === 'lost' ? <span className="text-red-500 font-medium">lost</span> : x.change ? <Chg v={x.change} d={0} /> : <span className="text-slate-500">0</span>}</td>
                    {cols.has('traffic') && <td className="px-4 py-3 text-right tabular-nums">{x.traffic_diff == null ? dash : x.traffic_diff ? <Chg v={x.traffic_diff} /> : <span className="text-slate-500">0</span>}</td>}
                    {cols.has('share') && <td className="px-4 py-3 text-right tabular-nums">{x.share == null ? dash : x.share < 0.01 ? '< 0.01' : x.share.toFixed(2)}</td>}
                    {cols.has('serp') && <td className="px-4 py-3">{x.serp?.length ? <span className="inline-flex flex-wrap gap-1">{x.serp.slice(0, 3).map(s => <Badge key={s.feature + s.kind} tone={s.kind === 'new' ? 'green' : 'red'}><Sparkles size={10} /> {s.kind === 'new' ? '+' : '−'} {s.feature}</Badge>)}</span> : dash}</td>}
                    {cols.has('vol') && <td className="px-4 py-3 text-right tabular-nums">{x.volume != null ? fmt(x.volume) : dash}</td>}
                    {cols.has('kd') && <td className="px-4 py-3 text-right tabular-nums">{x.kd ?? dash}</td>}
                    {cols.has('cpc') && <td className="px-4 py-3 text-right tabular-nums">{x.cpc ?? dash}</td>}
                    {cols.has('url') && <td className="px-4 py-3 max-w-[260px]">{x.url ? <a href={x.url} target="_blank" rel="noreferrer" title={x.url} className="text-indigo-700 hover:underline inline-flex items-start gap-1 break-all">{path(x.url)}<ExternalLink size={10} className="shrink-0 mt-1.5" /></a> : dash}</td>}
                    {cols.has('updated') && <td className="px-4 py-3 text-right text-slate-700 whitespace-nowrap">{ago(x.checked) || dash}</td>}
                  </tr>
                  {open.has(x.keyword) && by[x.keyword] && <tr className="bg-slate-50/60"><td /><td colSpan={13} className="px-4 py-3"><RankedUrls r={by[x.keyword]} /></td></tr>}
                </React.Fragment>))}
              {!slice.length && <tr><td colSpan={14} className="px-5 py-10 text-center text-slate-500">{r.comparable ? 'No keyword changed position in this view.' : 'Only one check so far: position changes appear after the next check.'}</td></tr>}
            </tbody>
          </table>
        </div>
        {footer}
      </Card>
    </div>
  );
}
