import React, { useMemo, useState } from 'react';
import { MapPin, Plus, Loader2, Globe, FileText, HelpCircle, Megaphone, ExternalLink, PenLine } from 'lucide-react';
import { Link } from 'react-router-dom';
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
  const [where, setWhere] = useState('all'); // location filter: every place, or one
  const [period, setPeriod] = useState('12'); // time filter: the average of the last 12, 6 or 3 months, or one month
  const [mode, setMode] = useState('summary'); // summary: one row per place for the chosen time | months: every month side by side
  const q = keyword ? `/businesses/${b.id}/keyword-workspace/locations?keyword=${encodeURIComponent(keyword)}${extra.length ? `&extra=${encodeURIComponent(extra.join(','))}` : ''}` : null;
  const r = useApi(q);
  const use = useApi(keyword ? `/businesses/${b.id}/keyword-workspace/usage?keyword=${encodeURIComponent(keyword)}` : null);
  const u = use.data;
  const d = r.data;
  const rows = d?.locations || [];
  const city = rows.find(x => x.kind === 'City' && x.monthly?.length) || rows.find(x => x.monthly?.length);
  const place = rows.find(x => x.name === chart && x.monthly?.length) || city;
  const months = (place?.monthly || []).map(m => ({ name: `${MONTH(m.month)} ${String(m.year).slice(2)}`, Searches: m.searches }));
  const monthList = (rows.find(x => x.monthly?.length)?.monthly || []).map(m => ({ key: `${m.year}-${m.month}`, label: `${MONTH(m.month)} ${String(m.year).slice(2)}` }));
  // searches per month for the chosen time: the average of the last n months, or one month; the 12-month figure is Google's own average
  const searchesOf = (x) => {
    if (period === '12') return x.volume;
    const ms = x.monthly || [];
    if (!ms.length) return null;
    if (period === '6' || period === '3') { const last = ms.slice(-Number(period)); return Math.round(last.reduce((a, m) => a + m.searches, 0) / last.length); }
    const one = ms.find(m => `${m.year}-${m.month}` === period);
    return one ? one.searches : null;
  };
  const shownRows = rows.filter(x => where === 'all' || x.name === where);
  const top = Math.max(1, ...shownRows.map(x => searchesOf(x) || 0));
  const periodLabel = period === '12' ? 'average of the last 12 months' : period === '6' ? 'average of the last 6 months' : period === '3' ? 'average of the last 3 months' : monthList.find(m => m.key === period)?.label;
  const add = () => { const v = typed.trim(); if (v && extra.length < 3 && !extra.includes(v)) setExtra([...extra, v]); setTyped(''); };

  return (
    <Drawer open={Boolean(keyword)} onClose={onClose} width="max-w-4xl" title={keyword || ''} subtitle="Searches per month, competition index and difficulty, place by place (Google Ads Keyword Planner)">
      <div className="space-y-4">
        <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 text-14 font-semibold text-slate-900">Where this keyword is used</div>
          {!u ? <p className="px-4 py-4 text-13 text-slate-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" />Reading your pages, blogs, FAQs and posts…</p> : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-slate-100">
              {[
                ['Website pages', Globe, u.pages.length, u.pages.map(p => <li key={p.url} className="truncate"><a href={p.url} target="_blank" rel="noreferrer noopener" className="text-indigo-600 hover:underline" title={p.url}>{p.path}</a> <span className="text-slate-500">in the {p.places.join(', ')}</span></li>), <Link to="/keyword-management/mapping" className="text-indigo-600 hover:underline">Map it to a page</Link>],
                ['Blogs', FileText, u.blogs.length, u.blogs.map(x => <li key={x.id} className="truncate">{x.url ? <a href={x.url} target="_blank" rel="noreferrer noopener" className="text-indigo-600 hover:underline">{x.title}</a> : x.title} <span className="text-slate-500">· {x.state}{x.in_title ? ', in the title' : ''}</span></li>), <Link to={`/ai-content-generation/blog?keyword=${encodeURIComponent(keyword)}`} className="text-indigo-600 hover:underline inline-flex items-center gap-1"><PenLine size={11} />Write a blog on it</Link>],
                ['FAQs', HelpCircle, u.faqs.length, u.faqs.map((f, i) => <li key={i} className="truncate" title={f.q}>{f.q}</li>), <Link to="/gmb-profile/profile?sub=faq" className="text-indigo-600 hover:underline">Add it to an FAQ</Link>],
                ['Google posts', Megaphone, u.posts.length, u.posts.map(p => <li key={p.id} className="truncate" title={p.text}>{p.text} <span className="text-slate-500">· {p.state}</span></li>), <Link to="/google-posts" className="text-indigo-600 hover:underline">Post about it</Link>],
              ].map(([label, Icon, n, items, action]) => (
                <div key={label} className="p-3 min-w-0">
                  <div className="flex items-center gap-1.5 text-12 font-semibold text-slate-500"><Icon size={13} className={n ? 'text-emerald-600' : 'text-slate-400'} />{label}</div>
                  <div className={`text-24 font-bold tabular-nums ${n ? 'text-slate-900' : 'text-slate-300'}`}>{n}</div>
                  {n > 0 ? <ul className="mt-1 space-y-0.5 text-12 text-slate-700 max-h-28 overflow-auto">{items.slice(0, 6)}</ul> : <p className="mt-1 text-12 text-slate-500">Not used here yet. {action}</p>}
                </div>))}
            </div>)}
          {u && (u.profile.description || u.profile.services) && <p className="px-4 py-2 text-12 text-slate-600 border-t border-slate-100">Also in your Google profile: {[u.profile.description && 'the description', u.profile.services && 'the services'].filter(Boolean).join(' and ')}.</p>}
        </div>
        {!d ? (r.error ? <ErrorNote>{r.error.message}</ErrorNote> : <p className="py-6 text-center text-13 text-slate-500 flex items-center justify-center gap-2"><Loader2 size={15} className="animate-spin" />Asking Google for each location…</p>) : (
        <div className="space-y-4">
          {d.reason && <ErrorNote>{d.reason}</ErrorNote>}
          <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden">
            <div className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-100">
              <div className="text-14 font-semibold text-slate-900 mr-auto flex items-center gap-1.5"><MapPin size={14} className="text-indigo-500" />Searches, competition and cost by location</div>
              <label className="text-12 font-medium text-slate-500 flex items-center gap-1.5">Location
                <select value={where} onChange={e => setWhere(e.target.value)} className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-12.5 text-slate-800" aria-label="Location"><option value="all">All locations</option>{rows.map(x => <option key={x.name} value={x.name}>{x.name}</option>)}</select></label>
              <label className="text-12 font-medium text-slate-500 flex items-center gap-1.5">Time
                <select value={period} onChange={e => { setPeriod(e.target.value); setMode('summary'); }} className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-12.5 text-slate-800" aria-label="Time"><option value="12">Last 12 months</option><option value="6">Last 6 months</option><option value="3">Last 3 months</option>{[...monthList].reverse().map(m => <option key={m.key} value={m.key}>{m.label}</option>)}</select></label>
              <div className="flex gap-1" role="tablist" aria-label="Table view">{[['summary', 'Summary'], ['months', 'Month by month']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)} className={`h-8 px-3 rounded-full text-12.5 font-semibold cursor-pointer ${mode === k ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{l}</button>)}</div>
              <input value={typed} onChange={e => setTyped(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} placeholder="Add a place, e.g. Mumbai" aria-label="Add a place" className={`${inputCls} !h-8 w-44 text-12.5`} />
              <Button size="sm" icon={Plus} onClick={add} disabled={!typed.trim() || extra.length >= 3}>Add</Button>
            </div>
            {mode === 'summary' ? (
              <DataTable bare rows={shownRows} rowKey={x => x.name} pageSize={10} sizes={[10]} search={false} columnsMenu={false} exportName={`keyword-locations-${keyword}`} label="locations" headClass="bg-slate-100 text-slate-700" minWidth={720}
                rowClass={x => (place && x.name === place.name ? 'bg-indigo-50/60' : '')}
                columns={[
                  { id: 'name', header: 'Location', value: x => x.name, className: 'px-3 py-2', cell: x => <button type="button" onClick={() => x.monthly?.length && setChart(x.name)} className="text-left cursor-pointer" title={x.found_as || x.note}><span className="font-semibold text-slate-900">{x.name}</span><span className="block text-11.5 text-slate-500">{x.kind}{x.found_as ? ` · ${x.found_as}` : ''}</span></button> },
                  { id: 'volume', header: 'Searches / month', right: true, first: 'desc', value: x => searchesOf(x), className: 'px-3 py-2 text-right', cell: x => { const v = searchesOf(x); return v == null ? <span className="text-slate-300" title={x.note || 'Google has no figure for this place or time'}>—</span> : <div><div className="tabular-nums font-semibold text-slate-900">{n0(v)}</div><div className="mt-1 h-1 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-indigo-400" style={{ width: `${Math.max(3, (v / top) * 100)}%` }} /></div></div>; } },
                  { id: 'difficulty', header: 'Difficulty', right: true, value: x => x.index, className: 'px-3 py-2 text-right', cell: x => (x.index == null ? '—' : <span className="inline-flex items-center gap-1.5"><span className="tabular-nums font-semibold text-slate-900">{x.index}</span><Badge tone={kd(x.index)[1]}>{kd(x.index)[0]}</Badge></span>) },
                  { id: 'index', header: 'Competition index', right: true, first: 'desc', value: x => x.index, className: 'px-3 py-2 text-right tabular-nums', cell: x => (x.index == null ? '—' : `${x.index}${x.competition ? ` · ${x.competition.toLowerCase()}` : ''}`) },
                  { id: 'cpc', header: 'Cost / click (top of page)', right: true, value: x => x.cpc, className: 'px-3 py-2 text-right tabular-nums', cell: x => (x.cpc != null ? `₹${x.cpc}` : '—') },
                ]} />
            ) : (
              <DataTable bare rows={shownRows} rowKey={x => x.name} pageSize={10} sizes={[10]} search={false} columnsMenu={false} exportName={`keyword-months-${keyword}`} label="locations" headClass="bg-slate-100 text-slate-700" minWidth={Math.max(720, 200 + monthList.length * 70)}
                columns={[
                  { id: 'name', header: 'Location', value: x => x.name, className: 'px-3 py-2 font-semibold text-slate-900 whitespace-nowrap', cell: x => x.name },
                  ...monthList.map(m => ({ id: m.key, header: m.label, right: true, value: x => (x.monthly || []).find(v => `${v.year}-${v.month}` === m.key)?.searches ?? null, className: 'px-2 py-2 text-right tabular-nums text-12.5', cell: x => n0((x.monthly || []).find(v => `${v.year}-${v.month}` === m.key)?.searches) })),
                ]} />
            )}
            <p className="px-4 py-2 text-11.5 text-slate-500 border-t border-slate-100">{mode === 'summary' ? `Searches per month: ${periodLabel}. ` : ''}Click a location to draw its last 12 months. A dash means Google has no figure for that place (small areas often have none): nothing is estimated.</p>
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
      </div>
    </Drawer>
  );
}
