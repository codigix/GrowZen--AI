import React, { useEffect, useState } from 'react';
import { ResponsiveContainer, ComposedChart, Area, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { Phone, Navigation, MousePointerClick, Eye, Star, FileText, Printer, TrendingUp } from 'lucide-react';
import { Spark, Delta } from './StatBits';
import DataTable from './DataTable';
import Select from '../components/Select';

const monthName = (m) => { const [y, mo] = String(m).split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); };
const short = (m) => { const [y, mo] = String(m).split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('en-GB', { month: 'short' }) + (mo === 1 ? ` ${String(y).slice(2)}` : ''); };
const fmt = (n) => Number(n || 0).toLocaleString('en-IN');
const pct = (n) => (n == null ? '' : `${n > 0 ? '+' : ''}${n}%`);

/** One number: its value this month, how it moved against the month before, and a graph of the months. */
export function Tile({ icon: Icon, label, color, rows, k }) {
  const cur = rows[rows.length - 1], prev = rows[rows.length - 2];
  return (
    <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4 min-w-0">
      <div className="flex items-center gap-2 text-12 font-semibold text-slate-500"><span className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: `${color}1a`, color }}><Icon size={14} /></span>{label}</div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="min-w-0"><div className="text-28 leading-none font-bold text-slate-900 tabular-nums">{fmt(cur?.[k])}</div><div className="mt-1.5"><Delta now={cur?.[k] || 0} before={prev ? prev[k] : null} since="vs last month" /></div></div>
        <Spark values={rows.map(r => r[k] || 0)} tone={color} width={96} height={40} />
      </div>
    </div>
  );
}

/** The growth, month by month: the chart of how customers found and contacted the profile, and the table with each change against the month before. */
export function Growth({ rows, current }) {
  const data = rows.map(r => ({ ...r, name: short(r.month) }));
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4">
        <div className="flex items-center gap-2 mb-1"><TrendingUp size={16} className="text-indigo-500" /><h3 className="text-14 font-semibold text-slate-900">Growth, month by month</h3></div>
        <p className="text-12 text-slate-500 mb-2">Profile views (area) and the actions customers took: calls, directions and website clicks (bars).</p>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <defs><linearGradient id="gv" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#6366f1" stopOpacity="0.28" /><stop offset="100%" stopColor="#6366f1" stopOpacity="0" /></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="views" name="Profile views" stroke="#6366f1" strokeWidth={2} fill="url(#gv)" />
              <Bar dataKey="calls" name="Calls" stackId="a" fill="#10b981" />
              <Bar dataKey="directions" name="Directions" stackId="a" fill="#f59e0b" />
              <Bar dataKey="website_clicks" name="Website clicks" stackId="a" fill="#0ea5e9" radius={[3, 3, 0, 0]} />
              <Line type="monotone" dataKey="new_reviews" name="New reviews" stroke="#ec4899" strokeWidth={2} dot={{ r: 2.5 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden">
        <div className="px-4 pt-3 pb-1"><h3 className="text-14 font-semibold text-slate-900">Month by month</h3><p className="text-12 text-slate-500">The change is against the month before.</p></div>
        <DataTable bare rows={[...rows].reverse()} rowKey={r => r.month} pageSize={12} sizes={[12]} search={false} columnsMenu={false} exportName="monthly-growth" label="months" headClass="bg-slate-100 text-slate-700" serial={false}
          rowClass={r => (r.month === current ? 'bg-indigo-50/60' : '')}
          columns={[
            { id: 'month', header: 'Month', value: r => r.month, className: 'px-3 py-2 whitespace-nowrap font-medium text-slate-900', cell: r => monthName(r.month) },
            ...[['views', 'Profile views'], ['calls', 'Calls'], ['directions', 'Directions'], ['website_clicks', 'Website clicks'], ['actions', 'All actions']].map(([k, label]) => ({
              id: k, header: label, right: true, value: r => r[k], className: 'px-3 py-2 text-right tabular-nums', cell: r => (
                <span>{fmt(r[k])}{r.change && <span className={`ml-1.5 text-11.5 font-semibold ${r.change[k] > 0 ? 'text-emerald-600' : r.change[k] < 0 ? 'text-rose-600' : 'text-slate-400'}`}>{r.change[k] > 0 ? '▲' : r.change[k] < 0 ? '▼' : '–'} {pct(Math.abs(r.change[k]))}</span>}</span>) })),
            { id: 'new_reviews', header: 'New reviews', right: true, value: r => r.new_reviews, className: 'px-3 py-2 text-right tabular-nums', cell: r => r.new_reviews },
            { id: 'rating', header: 'Rating', right: true, value: r => r.rating ?? null, className: 'px-3 py-2 text-right tabular-nums', cell: r => (r.rating ? `${r.rating} ★` : '—') },
            { id: 'posts', header: 'Posts', right: true, value: r => r.posts, className: 'px-3 py-2 text-right tabular-nums', cell: r => r.posts },
          ]} />
      </div>
    </div>
  );
}

const DID = { post: 'Google posts published', review: 'Review actions', photo: 'Photo changes', profile: 'Profile updates', sync: 'Data refreshes from Google' };

/** The whole client report for one month. */
export function ReportBody({ d }) {
  const rows = d.months || [];
  const cur = d.current;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile icon={Eye} label="Profile views" color="#6366f1" rows={rows} k="views" />
        <Tile icon={Phone} label="Calls" color="#10b981" rows={rows} k="calls" />
        <Tile icon={Navigation} label="Directions" color="#f59e0b" rows={rows} k="directions" />
        <Tile icon={MousePointerClick} label="Website clicks" color="#0ea5e9" rows={rows} k="website_clicks" />
      </div>
      <div className="grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3">
        <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4"><h3 className="text-14 font-semibold text-slate-900 mb-1">{monthName(d.month)} in plain words</h3><p className="text-14 text-slate-700 leading-relaxed">{d.plain_words}</p></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4"><div className="flex items-center gap-1.5 text-12 font-semibold text-slate-500"><Star size={13} className="text-amber-400" />Rating</div><div className="text-28 leading-none font-bold text-slate-900 mt-2 tabular-nums">{cur?.rating ?? '—'}</div><div className="text-12 text-slate-500 mt-1">{fmt(cur?.reviews_total)} reviews in all</div></div>
          <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4"><div className="flex items-center gap-1.5 text-12 font-semibold text-slate-500"><FileText size={13} className="text-indigo-500" />This month</div><div className="text-12.5 text-slate-700 mt-2 space-y-0.5"><div><b className="tabular-nums">{cur?.new_reviews ?? 0}</b> new reviews</div><div><b className="tabular-nums">{cur?.posts ?? 0}</b> posts published</div><div><b className="tabular-nums">{cur?.leads ?? 0}</b> leads</div></div></div>
        </div>
      </div>
      <Growth rows={rows} current={d.month} />
      <div className="grid lg:grid-cols-2 gap-3">
        <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4">
          <h3 className="text-14 font-semibold text-slate-900 mb-2">What we did in {monthName(d.month)}</h3>
          {Object.keys(d.did || {}).length === 0 ? <p className="text-13 text-slate-500">No work was recorded this month.</p> : (
            <ul className="divide-y divide-slate-100">{Object.entries(d.did).map(([k, n]) => <li key={k} className="py-1.5 flex items-center justify-between text-13"><span className="text-slate-700">{DID[k] || k}</span><b className="tabular-nums text-slate-900">{n}</b></li>)}</ul>)}
        </div>
        <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden">
          <div className="px-4 pt-3 pb-1"><h3 className="text-14 font-semibold text-slate-900">Search positions</h3><p className="text-12 text-slate-500">Where the tracked searches stand on Google.</p></div>
          {(d.keywords || []).length === 0 ? <p className="px-4 pb-4 text-13 text-slate-500">No search positions have been measured yet.</p> : (
            <DataTable bare rows={d.keywords} rowKey={k => k.keyword} pageSize={6} sizes={[6]} search={false} columnsMenu={false} serial={false} headClass="bg-slate-100 text-slate-700"
              columns={[
                { id: 'kw', header: 'Search', value: k => k.keyword, className: 'px-3 py-2 text-13 text-slate-900', cell: k => k.keyword },
                { id: 'rank', header: 'Position', right: true, value: k => k.rank, className: 'px-3 py-2 text-right tabular-nums font-semibold', cell: k => k.rank },
                { id: 'move', header: 'Moved', right: true, value: k => (k.prev_rank ? k.prev_rank - k.rank : 0), className: 'px-3 py-2 text-right tabular-nums text-12', cell: k => (!k.prev_rank ? <span className="text-slate-400">new</span> : k.prev_rank === k.rank ? <span className="text-slate-400">–</span> : <span className={k.prev_rank > k.rank ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-semibold'}>{k.prev_rank > k.rank ? '▲' : '▼'} {Math.abs(k.prev_rank - k.rank)}</span>) },
              ]} />)}
        </div>
      </div>
    </div>
  );
}

const lastMonths = (n = 12) => Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });

/** The page a client opens from the link: no sign-in. It reads the numbers when it opens and again every minute, so it is always current. */
export default function ClientReportPage({ token }) {
  const [month, setMonth] = useState(lastMonths(1)[0]);
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const base = import.meta.env.VITE_API_URL || '/api/v1';
  useEffect(() => {
    let stop = false;
    const load = () => fetch(`${base}/public/client-report/${encodeURIComponent(token)}?month=${month}`)
      .then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'This report link is not valid.'); return r.json(); })
      .then(j => { if (!stop) { setD(j); setError(''); } }).catch(e => { if (!stop) setError(e.message); });
    load();
    const t = setInterval(load, 60000);
    return () => { stop = true; clearInterval(t); };
  }, [token, month, base]);
  useEffect(() => { if (d?.business?.name) document.title = `${d.business.name}: Google profile report`; }, [d]);
  if (error && !d) return <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6"><div className="max-w-sm text-center"><h1 className="text-18 font-semibold text-slate-900">Report not available</h1><p className="text-14 text-slate-600 mt-2">{error}</p></div></div>;
  if (!d) return <div className="min-h-screen bg-slate-50 flex items-center justify-center text-14 text-slate-500">Loading the report…</div>;
  return (
    <div className="min-h-screen bg-slate-50 print:bg-white">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3">
          {d.business.logo && <img src={d.business.logo} alt="" referrerPolicy="no-referrer" className="w-10 h-10 rounded-lg object-cover ring-1 ring-slate-200" />}
          <div className="min-w-0 mr-auto"><h1 className="text-18 font-semibold text-slate-900 truncate">{d.business.name}</h1><p className="text-12 text-slate-500">Google profile report{d.business.city ? ` · ${d.business.city}` : ''} · live, updated {new Date(d.generated_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p></div>
          <Select value={month} onChange={e => { setD(null); setMonth(e.target.value); }} aria-label="Month" className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-13">{lastMonths().map(m => <option key={m} value={m}>{monthName(m)}</option>)}</Select>
          <button type="button" onClick={() => window.print()} className="h-9 px-3 rounded-lg border border-slate-300 bg-white text-13 font-medium inline-flex items-center gap-1.5 cursor-pointer print:hidden"><Printer size={14} />Print / PDF</button>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-4"><ReportBody d={d} /></main>
      <footer className="max-w-6xl mx-auto px-4 sm:px-6 pb-6 text-11.5 text-slate-400">Numbers come from Google Business Profile and are read each time this page opens.</footer>
    </div>
  );
}
