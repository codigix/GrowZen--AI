import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { ExternalLink, X, Plus, Download, Settings2, Sparkles, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, Button, useModulePath, useAction } from './SeoUi';
import { api, fmt } from './seoApi';
import { AXIS, PALETTE, Th, Chg, Empty, Filter, usePager, path } from './PositionUi';
import Select from '../components/Select';

const METRICS = [['visibility', 'Visibility', '%', false], ['traffic', 'Est. Traffic', '', false], ['avg_position', 'Avg. Position', '', true]];
const INTENT = { informational: ['I', 'bg-indigo-100 text-indigo-700'], navigational: ['N', 'bg-violet-100 text-violet-700'], commercial: ['C', 'bg-amber-100 text-amber-700'], transactional: ['T', 'bg-emerald-100 text-emerald-700'], local: ['L', 'bg-sky-100 text-sky-700'] };
const TABS = [['positions', 'Positions'], ['traffic', 'Est. Traffic'], ['visibility', 'Visibility'], ['all', 'All']];
const sel = 'h-9 px-2.5 text-13 rounded border border-slate-200 bg-white text-slate-700 cursor-pointer';
const dash = <span className="text-slate-300">—</span>;
const kdColor = (v) => (v == null ? '#cbd5e1' : v < 30 ? '#10b981' : v < 60 ? '#f59e0b' : '#ef4444');
const short = (d) => String(d).slice(5);
const longDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' });

/** The tag under a keyword: its name, or a small "add tag" box that saves the cluster. */
function TagPill({ r, b, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(r.tag || '');
  const [busy, error, run] = useAction();
  const save = () => run('tag', async () => { await api(`/businesses/${b.id}/keywords/${r.id}`, { method: 'PATCH', body: { keyword: r.keyword, cluster: text.trim() || null }, repeat: true }); setEditing(false); onChanged?.(); });
  if (!r.id) return r.tag ? <span className="mt-1 inline-block px-2 py-0.5 rounded-full border border-slate-200 text-11.5 text-slate-600">{r.tag}</span> : null;
  if (editing) {
    return (
      <span className="mt-1 inline-flex items-center gap-1">
        <input autoFocus value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }} placeholder="Tag name" aria-label="Tag name" className="h-7 w-32 px-2 text-12 rounded border border-slate-300" />
        <Button size="sm" variant="primary" busy={busy === 'tag'} onClick={save}>Save</Button>{error && <span className="text-11 text-rose-600">{error}</span>}
      </span>
    );
  }
  return (
    <button type="button" onClick={() => setEditing(true)} className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-slate-200 text-11.5 text-slate-600 hover:bg-slate-100 cursor-pointer">
      {r.tag ? r.tag : <><Plus size={11} />add tag</>}
    </button>
  );
}

/** The expanded row: this keyword's position over time for your domain and the domains picked above. */
function PositionChart({ r, domains, colorOf, me }) {
  const [smart, setSmart] = useState(true);
  const [hidden, setHidden] = useState(() => new Set());
  const dates = r.history || [];
  const shown = domains.filter(x => !hidden.has(x));
  const data = dates.map(h => ({ date: short(h.date), ...Object.fromEntries(domains.map(x => [x, h.ranks[x] ?? null])) }));
  const lastDate = dates.length ? dates[dates.length - 1].date : null;
  return (
    <div className="px-6 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-15 font-bold text-slate-900">Positions <span className="text-slate-500 font-normal">{lastDate ? longDate(lastDate) : ''}</span></div>
        <label className="inline-flex items-center gap-2 text-13 text-slate-800 cursor-pointer"><input type="checkbox" checked={smart} onChange={e => setSmart(e.target.checked)} />Smart zoom</label>
      </div>
      <div className="h-56 mt-2">
        {dates.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 16, left: -6, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" vertical={false} />
              <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} width={40} reversed domain={smart ? [(min) => Math.max(1, Math.floor(min) - 1), (max) => Math.ceil(max) + 1] : [1, 20]} allowDecimals />
              <Tooltip formatter={(v, n) => [v == null ? 'no impressions' : v, n]} />
              {shown.map(x => <Line key={x} type="monotone" dataKey={x} stroke={colorOf(x)} strokeWidth={2} dot={{ r: 4 }} connectNulls isAnimationActive={false} />)}
            </LineChart>
          </ResponsiveContainer>
        ) : <p className="text-13 text-slate-500 py-8 text-center">No check is saved for this keyword in the period.</p>}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1.5 mt-1">
        {domains.map(x => {
          const ps = dates.map(h => h.ranks[x]).filter(v => v != null);
          return (
            <label key={x} className="inline-flex items-center gap-2 text-13 text-slate-800 cursor-pointer">
              <input type="checkbox" checked={!hidden.has(x)} style={{ accentColor: colorOf(x) }} onChange={() => setHidden(s => { const n = new Set(s); n.has(x) ? n.delete(x) : n.add(x); return n; })} />{x}
              <span className="text-slate-500 tabular-nums">{ps.length ? <>{ps[0]} <span className="mx-0.5">→</span> <b className="text-slate-800">{ps[ps.length - 1]}</b></> : 'not in top 20'}</span>
            </label>);
        })}
      </div>
    </div>
  );
}

function download(name, rows) {
  const head = ['Keyword', 'Intent', 'KD %', 'Position first', 'Position last', 'Diff', 'Visibility %', 'Est. traffic', 'Volume', 'CPC', 'URL'];
  const body = rows.map(r => [r.keyword, r.intent || '', r.kd ?? '', r.was ?? '', r.rank ?? '', r.change ?? '', r.visibility, r.traffic ?? '', r.volume ?? '', r.cpc ?? '', r.url || '']);
  const csv = [head, ...body].map(l => l.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = name;
  a.click();
}

/** Overview: one figure over time for your domain and up to four others from the results, and the Rankings Overview table. */
export default function PositionOverview({ d, b, onChanged }) {
  const path_ = useModulePath();
  const me = d.domain;
  const [metric, setMetric] = useState('visibility');
  const [extra, setExtra] = useState(['', '', '', '']);
  const [hidden, setHidden] = useState(() => new Set());
  const [smart, setSmart] = useState(true);
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState({ intent: '', band: '', tag: '' });
  const [showFilter, setShowFilter] = useState(false);
  const [tab, setTab] = useState('all');
  const [cols, setCols] = useState(() => new Set(['intent', 'kd', 'vol', 'cpc', 'url']));
  const [showCols, setShowCols] = useState(false);
  const [sort, setSort] = useState({ key: 'rank', dir: 1 });
  const [open, setOpen] = useState(() => new Set());
  const toggleRow = (k) => setOpen(o => { const n = new Set(o); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const series = d.domain_series || {};
  const chosen = [me, ...extra.filter(Boolean)];
  const pickable = Object.keys(series).filter(x => x !== me);
  const m = METRICS.find(x => x[0] === metric);
  const colorOf = (dom) => PALETTE[chosen.indexOf(dom) % PALETTE.length];
  const dates = (series[me] || []).map(x => x.date);
  const data = dates.map((date, i) => ({ date: short(date), ...Object.fromEntries(chosen.map(dom => [dom, series[dom]?.[i]?.[metric] ?? null])) }));
  const shown = chosen.filter(x => !hidden.has(x));
  const lastOf = (dom) => { const v = series[dom]?.map(x => x[metric]).filter(x => x != null); return v?.length ? v[v.length - 1] : null; };
  const firstOf = (dom) => { const v = series[dom]?.map(x => x[metric]).filter(x => x != null); return v?.length ? v[0] : null; };
  const big = lastOf(me);
  const change = big != null && firstOf(me) != null && dates.length > 1 ? Math.round((big - firstOf(me)) * 100) / 100 : null;

  const tags = [...new Set(d.all_keywords.map(r => r.tag).filter(Boolean))];
  const intents = [...new Set(d.all_keywords.map(r => r.intent).filter(Boolean))];
  const rows = useMemo(() => {
    const f = d.all_keywords.filter(r => (!q || r.keyword.toLowerCase().includes(q.toLowerCase())) && (!filters.intent || r.intent === filters.intent) && (!filters.tag || r.tag === filters.tag)
      && (!filters.band || (filters.band === 'top3' ? r.rank && r.rank <= 3 : filters.band === 'top10' ? r.rank && r.rank <= 10 : filters.band === 'out' ? !r.rank : r.rank > 10)));
    const val = (r) => (sort.key === 'rank' ? (r.rank ?? 999) : sort.key === 'keyword' ? r.keyword : sort.key === 'visibility' ? -(r.visibility || 0) : sort.key === 'traffic' ? -(r.traffic || 0) : sort.key === 'volume' ? -(r.volume || 0) : r[sort.key] ?? 0);
    return [...f].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir);
  }, [d.all_keywords, q, filters, sort]);
  const [slice, footer] = usePager(rows, 100);
  const active = Object.values(filters).filter(Boolean).length;
  const sortBy = (key) => setSort(s => ({ key, dir: s.key === key ? -s.dir : 1 }));
  const th = (key, label, right = true) => <th className={`px-3 py-2.5 font-semibold whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}><button type="button" onClick={() => sortBy(key)} className="cursor-pointer hover:text-slate-900">{label}{sort.key === key ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}</button></th>;
  const first = d.period.start.slice(5), last = d.period.end.slice(5);
  const show = (group) => tab === 'all' || tab === group;
  const toggleCol = (c) => setCols(s => { const n = new Set(s); n.has(c) ? n.delete(c) : n.add(c); return n; });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="h-9 pl-3 pr-1.5 inline-flex items-center gap-2 rounded border border-indigo-300 bg-indigo-50 text-13 text-slate-800">{me}<span className="w-6 h-6 inline-flex items-center justify-center text-slate-500"><X size={13} className="opacity-30" /></span></span>
        {extra.map((v, i) => (
          <Select key={i} className={sel} value={v} aria-label={`Add domain ${i + 1}`} onChange={e => setExtra(x => x.map((y, j) => (j === i ? e.target.value : y)))}>
            <option value="">Add domain</option>
            {pickable.filter(x => x === v || !extra.includes(x)).map(x => <option key={x} value={x}>{x}</option>)}
          </Select>))}
        <span className="ml-auto text-12.5 text-slate-500">{d.period.start} → {d.period.end}</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Filter value={q} onChange={setQ} placeholder="Filter by keyword" />
        <button type="button" onClick={() => setShowFilter(o => !o)} className="h-9 px-2 inline-flex items-center gap-1.5 text-13 font-semibold text-indigo-600 hover:underline cursor-pointer"><Plus size={14} />Add filter{active ? ` (${active})` : ''}</button>
        {showFilter && (
          <>
            <Select className={sel} value={filters.band} onChange={e => setFilters(f => ({ ...f, band: e.target.value }))} aria-label="Positions"><option value="">Positions</option><option value="top3">Top 3</option><option value="top10">Top 10</option><option value="11-20">11-20</option><option value="out">Not ranking</option></Select>
            <Select className={sel} value={filters.intent} onChange={e => setFilters(f => ({ ...f, intent: e.target.value }))} aria-label="Intent"><option value="">Intent</option>{intents.map(i => <option key={i}>{i}</option>)}</Select>
            {tags.length > 0 && <Select className={sel} value={filters.tag} onChange={e => setFilters(f => ({ ...f, tag: e.target.value }))} aria-label="Tag"><option value="">Tag</option>{tags.map(t => <option key={t}>{t}</option>)}</Select>}
            {active > 0 && <button type="button" onClick={() => setFilters({ intent: '', band: '', tag: '' })} className="text-13 text-slate-500 hover:text-slate-800 cursor-pointer">Clear</button>}
          </>
        )}
      </div>

      <Card pad={false}>
        <div className="px-5 pt-4 pb-3 border-b border-slate-100">
          <div className="inline-flex rounded border border-slate-200 overflow-hidden">
            {METRICS.map(([id, label]) => <button key={id} type="button" onClick={() => setMetric(id)} className={`h-9 px-3 text-13 border-r last:border-r-0 border-slate-200 cursor-pointer ${metric === id ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>{label}</button>)}
          </div>
        </div>
        <div className="px-5 py-4">
          <div className="text-13 text-slate-600">{me}</div>
          <div className="flex items-baseline gap-2"><span className="text-28 font-bold tabular-nums text-slate-900">{big == null ? '—' : `${metric === 'traffic' ? fmt(Math.round(big)) : big}${m[2]}`}</span>{change != null && <Chg v={change} better={m[3] ? 'down' : 'up'} />}{change == null && big != null && <span className="text-12 text-slate-400">0</span>}</div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
            {chosen.map(dom => (
              <label key={dom} className="inline-flex items-center gap-2 text-13 text-slate-800 cursor-pointer">
                <input type="checkbox" checked={!hidden.has(dom)} style={{ accentColor: colorOf(dom) }} onChange={() => setHidden(s => { const n = new Set(s); n.has(dom) ? n.delete(dom) : n.add(dom); return n; })} />{dom}
                {dom !== me && lastOf(dom) != null && <span className="text-slate-400 tabular-nums">{metric === 'traffic' ? fmt(Math.round(lastOf(dom))) : lastOf(dom)}{m[2]}</span>}
              </label>))}
            <label className="ml-auto inline-flex items-center gap-2 text-13 text-slate-800 cursor-pointer"><input type="checkbox" checked={smart} onChange={e => setSmart(e.target.checked)} />Smart zoom</label>
          </div>
          <div className="h-72 mt-2">
            {dates.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 8, right: 16, left: -6, bottom: 0 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" vertical={false} />
                  <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} reversed={m[3]} domain={m[3] ? [1, 'dataMax + 2'] : smart ? ['auto', 'auto'] : [0, 'auto']} />
                  <Tooltip formatter={(v, n) => [v == null ? 'no data' : `${v}${m[2]}`, n]} />
                  {shown.map(dom => <Line key={dom} type="monotone" dataKey={dom} stroke={colorOf(dom)} strokeWidth={2} dot={{ r: 4 }} connectNulls isAnimationActive={false} />)}
                </LineChart>
              </ResponsiveContainer>
            ) : <Empty>No position has been checked in this period yet.</Empty>}
          </div>
          {dates.length === 1 && <p className="text-12 text-slate-400">One check so far: the lines draw as more checks are saved.</p>}
        </div>
      </Card>

      <Card title={<span>Rankings Overview <span className="text-slate-500 font-normal">1-{Math.min(rows.length, 100)} ({rows.length})</span></span>} pad={false}
        action={<div className="relative">
          <Button size="sm" icon={Settings2} onClick={() => setShowCols(o => !o)}>Table settings</Button>
          {showCols && (
            <div className="absolute right-0 top-full mt-1 z-20 w-48 rounded bg-white shadow-lg ring-1 ring-slate-200 p-2 text-13">
              {[['intent', 'Intent'], ['kd', 'KD %'], ['vol', 'Volume'], ['cpc', 'CPC'], ['url', 'URL']].map(([c, l]) => <label key={c} className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-slate-50 rounded"><input type="checkbox" checked={cols.has(c)} onChange={() => toggleCol(c)} />{l}</label>)}
            </div>)}
        </div>}>
        <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
          <Link to={path_('keyword-management')} className="h-9 px-3 rounded inline-flex items-center text-13 font-semibold bg-indigo-600 text-white hover:bg-indigo-700">Add keywords</Link>
          <Button size="sm" icon={Download} onClick={() => download(`${me}-rankings.csv`, rows)}>Export</Button>
          <div className="inline-flex rounded border border-slate-200 overflow-hidden ml-1">
            {TABS.map(([id, l]) => <button key={id} type="button" onClick={() => setTab(id)} className={`h-9 px-3 text-13 border-r last:border-r-0 border-slate-200 cursor-pointer ${tab === id ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>{id === 'all' ? `All for ${me}` : l}</button>)}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-13 min-w-[1180px]">
            <thead className="bg-slate-50 text-11.5 text-slate-500">
              <tr>
                <Th> </Th>{th('keyword', 'Keyword', false)}
                {cols.has('intent') && <Th>Intent</Th>}{cols.has('sf') && <Th c="text-right">SF</Th>}{cols.has('kd') && <Th c="text-right">KD %</Th>}
                {show('positions') && <><Th c="text-right">Pos. {first}</Th>{th('rank', `Pos. ${last}`)}<Th c="text-right">Diff</Th></>}
                {show('visibility') && <>{th('visibility', 'Visibility')}<Th c="text-right">Diff</Th></>}
                {show('traffic') && <>{th('traffic', 'Est. Traffic')}<Th c="text-right">Diff</Th></>}
                {cols.has('vol') && th('volume', 'Vol.')}{cols.has('cpc') && <Th c="text-right">CPC</Th>}{cols.has('url') && <Th>URL</Th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {slice.map(r => {
                const vd = r.visibility_was != null ? Math.round((r.visibility - r.visibility_was) * 1000) / 1000 : null;
                const td = r.traffic != null && r.traffic_was != null ? Math.round((r.traffic - r.traffic_was) * 100) / 100 : null;
                return (
                  <React.Fragment key={r.keyword}>
                  <tr className={open.has(r.keyword) ? 'bg-slate-50' : 'hover:bg-slate-50'}>
                    <td className="pl-3 pt-3 w-8 align-top"><button type="button" aria-label={open.has(r.keyword) ? 'Hide the position chart' : 'Show the position chart'} onClick={() => toggleRow(r.keyword)} className="p-1 text-slate-500 hover:text-slate-900 cursor-pointer"><ChevronRight size={15} className={`transition-transform ${open.has(r.keyword) ? 'rotate-90' : ''}`} /></button></td>
                    <td className="px-3 py-3 max-w-[260px] align-top"><button type="button" onClick={() => toggleRow(r.keyword)} className="font-medium text-indigo-700 hover:underline text-left cursor-pointer">{r.keyword}</button><div><TagPill r={r} b={b} onChanged={onChanged} /></div></td>
                    {cols.has('intent') && <td className="px-3 py-3">{r.intent && INTENT[r.intent] ? <span title={r.intent} className={`inline-flex w-5 h-5 rounded text-[11px] font-bold items-center justify-center ${INTENT[r.intent][1]}`}>{INTENT[r.intent][0]}</span> : <span className="text-slate-400">n/a</span>}</td>}
                    {cols.has('sf') && <td className="px-3 py-3 text-right tabular-nums">{r.sf ? <span className="inline-flex items-center gap-1" title="SERP features on this results page"><Sparkles size={12} className="text-slate-400" />{r.sf}</span> : dash}</td>}
                    {cols.has('kd') && <td className="px-3 py-3 text-right tabular-nums">{r.kd != null ? <span className="inline-flex items-center gap-1.5">{r.kd}<span className="w-2.5 h-2.5 rounded-full" style={{ background: kdColor(r.kd) }} /></span> : dash}</td>}
                    {show('positions') && <>
                      <td className="px-3 py-3 text-right tabular-nums">{r.was ?? dash}</td>
                      <td className="px-3 py-3 text-right tabular-nums font-semibold bg-slate-50/60">{r.rank ?? dash}</td>
                      <td className="px-3 py-3 text-right">{r.change == null ? dash : r.change ? <Chg v={r.change} d={0} /> : <span className="text-slate-500">0</span>}</td></>}
                    {show('visibility') && <>
                      <td className="px-3 py-3 text-right tabular-nums">{r.visibility}%</td>
                      <td className="px-3 py-3 text-right tabular-nums">{vd == null ? dash : vd ? <Chg v={vd} d={3} /> : <span className="text-slate-500">0</span>}</td></>}
                    {show('traffic') && <>
                      <td className="px-3 py-3 text-right tabular-nums">{r.traffic ?? dash}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{td == null ? dash : td ? <Chg v={td} /> : <span className="text-slate-500">0</span>}</td></>}
                    {cols.has('vol') && <td className="px-3 py-3 text-right tabular-nums">{r.volume != null ? fmt(r.volume) : dash}</td>}
                    {cols.has('cpc') && <td className="px-3 py-3 text-right tabular-nums">{r.cpc != null ? r.cpc : dash}</td>}
                    {cols.has('url') && <td className="px-3 py-3 max-w-[260px] truncate">{r.url ? <a href={r.url} target="_blank" rel="noreferrer" title={r.url} className="text-indigo-700 hover:underline inline-flex items-center gap-1">{path(r.url)}<ExternalLink size={10} className="shrink-0" /></a> : dash}</td>}
                  </tr>
                  {open.has(r.keyword) && <tr><td colSpan={16} className="p-0 border-y-2 border-indigo-200 bg-white"><PositionChart r={r} domains={chosen} colorOf={colorOf} me={me} /></td></tr>}
                  </React.Fragment>);
              })}
              {!slice.length && <tr><td colSpan={16} className="px-5 py-10 text-center text-slate-500">No keyword matches these filters.</td></tr>}
            </tbody>
          </table>
        </div>
        {footer || <div className="px-5 py-3 border-t border-slate-100 text-12.5 text-slate-500">Page: 1 of 1</div>}
      </Card>
      <p className="text-11.5 text-slate-400">Positions are Google Search Console's average positions from your saved checks. Visibility and traffic are modelled with a standard click-through curve and the keyword volumes you track.</p>
    </div>
  );
}
