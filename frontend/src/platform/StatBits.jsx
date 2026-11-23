import React from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';

/**
 * The pieces of a Google-style number: the count, an arrow that says how it moved, a small graph of its days, and a bar for its share.
 * Used where the page has real daily history for a number (page indexing): a number with no history shows no arrow and no graph, and says so.
 */

/** A small graph of one number over its days: the line, a soft fill and a dot on the last day. */
export function Spark({ values, tone = '#4f46e5', width = 120, height = 36 }) {
  const id = React.useId();
  const n = values.length;
  if (n < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(max - min, 1);
  const x = (i) => 2 + (i / (n - 1)) * (width - 4);
  const y = (v) => height - 3 - ((v - min) / span) * (height - 8);
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(n - 1).toFixed(1)},${height} L${x(0).toFixed(1)},${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Daily values over ${n} days, from ${values[0]} to ${values[n - 1]}`} className="shrink-0 overflow-visible">
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={tone} stopOpacity="0.22" /><stop offset="100%" stopColor={tone} stopOpacity="0" /></linearGradient></defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={tone} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(n - 1)} cy={y(values[n - 1])} r="2.6" fill={tone} />
    </svg>
  );
}

/** "▲ 12 (+8.3%)": green when it moved the good way, red the bad way (`lowerIsBetter` flips it), grey when it did not move. */
export function Delta({ now, before, lowerIsBetter = false, since }) {
  if (before == null) return <span className="text-11.5 text-slate-400" title="The numbers are kept from the first time this page was opened: a change appears from the second day">tracking from today</span>;
  const diff = now - before;
  if (diff === 0) return <span className="inline-flex items-center gap-0.5 text-12 font-semibold text-slate-500"><Minus size={13} />no change{since ? <span className="font-normal text-slate-400 ml-1">{since}</span> : null}</span>;
  const up = diff > 0;
  const good = lowerIsBetter ? !up : up;
  const pct = before > 0 ? ` (${up ? '+' : '-'}${Math.abs(Math.round((diff / before) * 1000) / 10)}%)` : '';
  return (
    <span className={`inline-flex items-center gap-0.5 text-12 font-semibold tabular-nums ${good ? 'text-emerald-600' : 'text-rose-600'}`}>
      {up ? <ArrowUpRight size={14} strokeWidth={2.5} /> : <ArrowDownRight size={14} strokeWidth={2.5} />}{up ? '+' : '-'}{Math.abs(diff).toLocaleString('en-IN')}{pct}
      {since ? <span className="font-normal text-slate-400 ml-1">{since}</span> : null}
    </span>
  );
}

/** A ring with the share inside: `value` of `total` (the progress of one thing, such as pages indexed). */
export function Ring({ value, total, tone = '#10b981', size = 92, stroke = 9, label }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${pct}% ${label || ''}`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(pct / 100) * c} ${c}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-20 font-bold tabular-nums text-slate-900 leading-none">{pct}%</span>{label && <span className="text-10 text-slate-500 mt-0.5">{label}</span>}</div>
    </div>
  );
}

/** A bar cut into the parts of a whole (indexed, not indexed, not checked): each part in its colour, widths by count. */
export function Segments({ parts, total }) {
  const sum = total || parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div className="flex h-2.5 rounded-full overflow-hidden bg-slate-100" role="img" aria-label={parts.map(p => `${p.value} ${p.label}`).join(', ')}>
      {parts.filter(p => p.value > 0).map(p => <div key={p.label} style={{ width: `${(p.value / sum) * 100}%`, background: p.color }} title={`${p.label}: ${p.value}`} />)}
    </div>
  );
}

/** One number the way Google's reports show it: label, the count, how it moved, its graph, and (when given) its share of the pages as a bar. */
export function StatCard({ label, value, hint, series, before, since, lowerIsBetter = false, tone = '#4f46e5', share, valueTone = 'text-slate-900' }) {
  return (
    <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4 min-w-0" title={hint}>
      <div className="text-12.5 font-semibold text-slate-500 truncate">{label}</div>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className={`text-[28px] leading-none font-bold tabular-nums ${valueTone}`}>{value == null ? '—' : Number(value).toLocaleString('en-IN')}</div>
          <div className="mt-1.5"><Delta now={value ?? 0} before={before} lowerIsBetter={lowerIsBetter} since={since} /></div>
        </div>
        {series && series.length > 1 ? <Spark values={series} tone={tone} width={104} /> : null}
      </div>
      {share != null && (
        <div className="mt-3" title={`${share}% of the pages`}>
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.min(100, share)}%`, background: tone }} /></div>
          <div className="mt-1 text-11 text-slate-400 tabular-nums">{share}% of the pages</div>
        </div>
      )}
    </div>
  );
}

/** From the daily history (oldest first): the value of `key` on each day, and the value about a week ago to compare with (null when there is only today). */
export function trendOf(history, key, days = 7) {
  const rows = history || [];
  const series = rows.map(r => Number(r[key] ?? 0));
  if (rows.length < 2) return { series, before: null, since: '' };
  const last = rows[rows.length - 1];
  const cutoff = new Date(`${last.day}T00:00:00`).getTime() - days * 86400000;
  const base = [...rows].reverse().find(r => new Date(`${r.day}T00:00:00`).getTime() <= cutoff) || rows[0];
  const gap = Math.round((new Date(`${last.day}T00:00:00`).getTime() - new Date(`${base.day}T00:00:00`).getTime()) / 86400000);
  return { series, before: Number(base[key] ?? 0), since: gap >= days ? `vs ${days} days ago` : `vs ${gap} day${gap === 1 ? '' : 's'} ago` };
}
