import React, { useMemo, useState } from 'react';
import { MapPin, Plus, Loader2 } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Drawer, Button, Badge, ErrorNote, inputCls } from './SeoUi';
import { useApi } from './seoApi';
import DataTable from './DataTable';

const n0 = (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN'));
const MONTH = (m) => String(m || '').slice(0, 3).replace(/^./, c => c.toUpperCase()).replace(/(?<=.)./g, c => c.toLowerCase());
const kd = (v) => (v == null ? ['No figure', 'gray'] : v <= 30 ? ['Easy', 'green'] : v <= 60 ? ['Medium', 'amber'] : ['Hard', 'red']);

/** One keyword place by place: searches per month and the competition index in each location, its difficulty, the cost, and the last twelve months. */
export default function KeywordLocations({ b, keyword, onClose }) {
  const [extra, setExtra] = useState([]);
  const [typed, setTyped] = useState('');
  const [chart, setChart] = useState(null); // the place whose months are drawn
  const q = keyword ? `/businesses/${b.id}/keyword-workspace/locations?keyword=${encodeURIComponent(keyword)}${extra.length ? `&extra=${encodeURIComponent(extra.join(','))}` : ''}` : null;
  const r = useApi(q);
  const d = r.data;
  const rows = d?.locations || [];
  const city = rows.find(x => x.kind === 'City' && x.monthly?.length) || rows.find(x => x.monthly?.length);
  const place = rows.find(x => x.name === chart && x.monthly?.length) || city;
  const months = (place?.monthly || []).map(m => ({ name: `${MONTH(m.month)} ${String(m.year).slice(2)}`, Searches: m.searches }));
  const country = rows.find(x => x.kind === 'Country');
  const top = Math.max(1, ...rows.map(x => x.volume || 0));
  const [lab, tn] = kd(d?.difficulty);
  const add = () => { const v = typed.trim(); if (v && extra.length < 3 && !extra.includes(v)) setExtra([...extra, v]); setTyped(''); };

  return (
    <Drawer open={Boolean(keyword)} onClose={onClose} width="max-w-4xl" title={keyword || ''} subtitle="Searches per month, competition index and difficulty, place by place (Google Ads Keyword Planner)">
      {!d ? (r.error ? <ErrorNote>{r.error.message}</ErrorNote> : <p className="py-10 text-center text-13 text-slate-500 flex items-center justify-center gap-2"><Loader2 size={15} className="animate-spin" />Asking Google for each location…</p>) : (
        <div className="space-y-4">
          {d.reason && <ErrorNote>{d.reason}</ErrorNote>}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl bg-white ring-1 ring-slate-200 p-3"><div className="text-12 font-semibold text-slate-500">Difficulty</div><div className="mt-1 flex items-baseline gap-2"><span className="text-24 font-bold tabular-nums text-slate-900">{d.difficulty ?? '—'}</span><Badge tone={tn}>{lab}</Badge></div><div className="text-11.5 text-slate-500">0 to 100, higher is harder</div></div>
            <div className="rounded-xl bg-white ring-1 ring-slate-200 p-3"><div className="text-12 font-semibold text-slate-500">Searches / month</div><div className="mt-1 text-24 font-bold tabular-nums text-slate-900">{n0(country?.volume)}</div><div className="text-11.5 text-slate-500">{country?.name || 'country'}</div></div>
            <div className="rounded-xl bg-white ring-1 ring-slate-200 p-3"><div className="text-12 font-semibold text-slate-500">Competition index</div><div className="mt-1 text-24 font-bold tabular-nums text-slate-900">{country?.index ?? '—'}</div><div className="text-11.5 text-slate-500">{country?.competition ? country.competition.toLowerCase() : 'advertiser competition'}</div></div>
            <div className="rounded-xl bg-white ring-1 ring-slate-200 p-3"><div className="text-12 font-semibold text-slate-500">Cost per click (top of page)</div><div className="mt-1 text-24 font-bold tabular-nums text-slate-900">{country?.cpc != null ? `₹${country.cpc}` : '—'}</div><div className="text-11.5 text-slate-500">what advertisers bid</div></div>
          </div>

          <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden">
            <div className="px-4 py-2.5 flex flex-wrap items-center gap-2 border-b border-slate-100">
              <div className="text-14 font-semibold text-slate-900 mr-auto flex items-center gap-1.5"><MapPin size={14} className="text-indigo-500" />By location</div>
              <input value={typed} onChange={e => setTyped(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} placeholder="Add a place, e.g. Mumbai" aria-label="Add a place" className={`${inputCls} !h-8 w-52 text-12.5`} />
              <Button size="sm" icon={Plus} onClick={add} disabled={!typed.trim() || extra.length >= 3}>Add</Button>
            </div>
            <DataTable bare rows={rows} rowKey={x => x.name} pageSize={10} sizes={[10]} search={false} columnsMenu={false} exportName={`keyword-locations-${keyword}`} label="locations" headClass="bg-slate-100 text-slate-700" minWidth={640}
              rowClass={x => (place && x.name === place.name ? 'bg-indigo-50/60' : '')}
              columns={[
                { id: 'name', header: 'Location', value: x => x.name, className: 'px-3 py-2', cell: x => <button type="button" onClick={() => x.monthly?.length && setChart(x.name)} className="text-left cursor-pointer" title={x.found_as || x.note}><span className="font-semibold text-slate-900">{x.name}</span><span className="block text-11.5 text-slate-500">{x.kind}{x.found_as ? ` · ${x.found_as}` : ''}</span></button> },
                { id: 'volume', header: 'Searches / month', right: true, first: 'desc', value: x => x.volume, className: 'px-3 py-2 text-right', cell: x => (x.volume == null ? <span className="text-slate-300" title={x.note || 'Google has no figure for this place'}>—</span> : <div><div className="tabular-nums font-semibold text-slate-900">{n0(x.volume)}</div><div className="mt-1 h-1 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-indigo-400" style={{ width: `${Math.max(3, (x.volume / top) * 100)}%` }} /></div></div>) },
                { id: 'index', header: 'Competition index', right: true, first: 'desc', value: x => x.index, className: 'px-3 py-2 text-right tabular-nums', cell: x => (x.index == null ? '—' : `${x.index}${x.competition ? ` · ${x.competition.toLowerCase()}` : ''}`) },
                { id: 'difficulty', header: 'Difficulty', right: true, value: x => x.index, className: 'px-3 py-2 text-right', cell: x => (x.index == null ? '—' : <Badge tone={kd(x.index)[1]}>{kd(x.index)[0]}</Badge>) },
                { id: 'cpc', header: 'Cost / click', right: true, value: x => x.cpc, className: 'px-3 py-2 text-right tabular-nums', cell: x => (x.cpc != null ? `₹${x.cpc}` : '—') },
              ]} />
            <p className="px-4 py-2 text-11.5 text-slate-500 border-t border-slate-100">Click a location to see its last 12 months. A dash means Google has no figure for that place (small areas often have none): nothing is estimated.</p>
          </div>

          {months.length > 0 && (
            <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4">
              <div className="text-14 font-semibold text-slate-900 mb-1">Searches per month in {place.name}</div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={months} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
                    <Tooltip cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
                    <Bar dataKey="Searches" fill="#6366f1" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>)}
        </div>)}
    </Drawer>
  );
}
