import React, { useState } from 'react';
import { ResponsiveContainer, AreaChart, Area } from 'recharts';
import { ArrowUp, ArrowDown, Inbox, Search } from 'lucide-react';
import Select from '../components/Select';

export const AXIS = { fontSize: 11, fill: '#64748b' };
export const PALETTE = ['#6658dd', '#1abc9c', '#a855f7', '#f59e0b', '#ef4444', '#0ea5e9', '#84cc16', '#ec4899', '#14b8a6', '#64748b'];
export const Th = ({ children, c = 'text-left' }) => <th className={`px-4 py-2.5 font-semibold whitespace-nowrap ${c}`}>{children}</th>;
export const path = (u) => { try { const x = new URL(u); return x.pathname + x.search || '/'; } catch (e) { return u; } };
export const sign = (v, d = 2) => (v == null ? '' : `${v > 0 ? '+' : ''}${Number(v.toFixed(d))}`);

/** A change: green when it is good. better = which direction is good. */
export function Chg({ v, better = 'up', unit = '', d = 2 }) {
  if (v == null) return null;
  if (!v) return <span className="text-11.5 text-slate-400">no change</span>;
  const good = (v > 0) === (better === 'up');
  return <span className={`inline-flex items-center gap-0.5 text-11.5 font-semibold ${good ? 'text-emerald-600' : 'text-red-500'}`}>{v > 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}{Math.abs(Number(v.toFixed(d)))}{unit}</span>;
}

export function Spark({ values, color = '#6658dd', h = 44 }) {
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

export function Empty({ icon: Icon = Inbox, children }) {
  return <div className="py-10 flex flex-col items-center text-center gap-2 text-13 text-slate-500"><Icon size={22} className="text-slate-300" /><span className="max-w-sm">{children}</span></div>;
}

/** Text filter box. */
export function Filter({ value, onChange, placeholder }) {
  return (
    <div className="relative">
      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder}
        className="h-9 pl-8 pr-3 w-56 text-13 rounded border border-slate-200 bg-white text-slate-700 placeholder:text-slate-400" />
    </div>
  );
}

/** Pill switch between a few views; each option is [id, label, count?]. */
export function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex gap-0.5 p-0.5 bg-slate-100 rounded flex-wrap">
      {options.map(([id, l, n]) => (
        <button key={id} type="button" onClick={() => onChange(id)} className={`h-8 px-3 text-12.5 font-semibold rounded cursor-pointer ${value === id ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-800'}`}>
          {l}{n != null && <span className="ml-1.5 text-slate-400 font-normal tabular-nums">{n}</span>}
        </button>
      ))}
    </div>
  );
}

/** Client-side paging: returns the current slice and the footer. */
export function usePager(rows, size = 10) {
  const [page, setPage] = useState(1);
  const [per, setPer] = useState(size);
  const pages = Math.max(1, Math.ceil(rows.length / per));
  const cur = Math.min(page, pages);
  const slice = rows.slice((cur - 1) * per, cur * per);
  const footer = rows.length > 10 ? (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-t border-slate-100 text-12.5 text-slate-600">
      <button type="button" disabled={cur <= 1} onClick={() => setPage(cur - 1)} className="px-2.5 py-1 rounded border border-slate-200 disabled:opacity-40 cursor-pointer">Prev</button>
      <button type="button" disabled={cur >= pages} onClick={() => setPage(cur + 1)} className="px-2.5 py-1 rounded border border-slate-200 disabled:opacity-40 cursor-pointer">Next</button>
      <span>Page {cur} of {pages}</span>
      <Select value={per} onChange={e => { setPer(Number(e.target.value)); setPage(1); }} className="h-8 px-2 rounded border border-slate-200 bg-white" aria-label="Rows per page">{[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}</Select>
      <span className="text-slate-400">{rows.length} rows</span>
    </div>
  ) : null;
  return [slice, footer, (cur - 1) * per];
}
