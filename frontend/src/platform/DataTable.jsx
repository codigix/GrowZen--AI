import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronDown, ChevronUp, ChevronsUpDown, Download, Search } from 'lucide-react';
import { Head } from './TableBits';
import Select from '../components/Select';

/**
 * The one way a table works in this app: search, filters, a sortable heading on every column that has a value to sort by,
 * page size and page numbers, a Columns menu and a CSV export. Use <DataTable> for a table described by columns, or the
 * pieces (usePager / Pager, useSorted / SortTh) to keep a table's own markup and still get real paging and sorting.
 */

const SIZES = [10, 25, 50, 100];

/** Pages of a list. The page goes back to 1 when `resetKey` changes (a filter, a search) and never points past the end. */
export function usePager(rows, { size = 25, resetKey = '' } = {}) {
  const [page, setPage] = useState(1);
  const [per, setPer] = useState(size);
  useEffect(() => { setPage(1); }, [resetKey, per]);
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / per));
  const at = Math.min(page, pages);
  const from = total ? (at - 1) * per : 0;
  return { page: at, setPage, size: per, setSize: setPer, pages, total, from, to: Math.min(total, from + per), rows: useMemo(() => rows.slice(from, from + per), [rows, from, per]) };
}

function windowOf(page, pages) {
  const set = new Set([1, pages, page, page - 1, page + 1]);
  if (page <= 3) { set.add(2); set.add(3); }
  if (page >= pages - 2) { set.add(pages - 1); set.add(pages - 2); }
  const list = [...set].filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out = [];
  list.forEach((n, i) => { if (i && n - list[i - 1] > 1) out.push('…'); out.push(n); });
  return out;
}

/** "Showing 1 to 25 of 140", the page size and the page numbers. Draws nothing for a list that fits one small page. */
export function Pager({ p, sizes = SIZES, label = 'rows' }) {
  if (p.total <= Math.min(...sizes) && p.pages === 1) return null;
  const btn = 'h-8 min-w-[2rem] px-2 rounded-md text-13 font-semibold inline-flex items-center justify-center cursor-pointer ring-1 ring-inset ring-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed';
  return (
    <nav aria-label="Pages of the table" className="px-4 py-3 border-t border-slate-100 flex flex-wrap items-center gap-x-4 gap-y-2 text-13 text-slate-600">
      <span role="status">Showing <b className="text-slate-900 tabular-nums">{p.total ? p.from + 1 : 0}</b> to <b className="text-slate-900 tabular-nums">{p.to}</b> of <b className="text-slate-900 tabular-nums">{p.total}</b> {label}</span>
      <label className="inline-flex items-center gap-1.5">Rows per page
        <Select value={p.size} onChange={e => p.setSize(Number(e.target.value))} aria-label="Rows per page" className="h-8 rounded-md border border-slate-200 bg-white text-13 cursor-pointer">{sizes.map(s => <option key={s} value={s}>{s}</option>)}</Select>
      </label>
      <div className="ml-auto flex items-center gap-1">
        <button type="button" className={btn} disabled={p.page <= 1} onClick={() => p.setPage(1)} aria-label="First page"><ChevronsLeft size={15} /></button>
        <button type="button" className={btn} disabled={p.page <= 1} onClick={() => p.setPage(p.page - 1)} aria-label="Previous page"><ChevronLeft size={15} /></button>
        {windowOf(p.page, p.pages).map((n, i) => (n === '…' ? <span key={`g${i}`} className="px-1 text-slate-400">…</span>
          : <button key={n} type="button" aria-current={n === p.page ? 'page' : undefined} onClick={() => p.setPage(n)} className={`${btn} ${n === p.page ? '!bg-slate-900 !text-white !ring-slate-900' : ''}`}>{n}</button>))}
        <button type="button" className={btn} disabled={p.page >= p.pages} onClick={() => p.setPage(p.page + 1)} aria-label="Next page"><ChevronRight size={15} /></button>
        <button type="button" className={btn} disabled={p.page >= p.pages} onClick={() => p.setPage(p.pages)} aria-label="Last page"><ChevronsRight size={15} /></button>
      </div>
    </nav>
  );
}

const cmp = (a, b) => {
  const na = a == null || a === '' || (typeof a === 'number' && Number.isNaN(a));
  const nb = b == null || b === '' || (typeof b === 'number' && Number.isNaN(b));
  if (na || nb) return na === nb ? 0 : na ? 1 : -1; // nothing to compare always sorts last
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
};

/** Sorting a list: `valueOf(row, key)` says what to compare for a column. Empty values stay at the bottom whichever way it sorts. */
export function useSorted(rows, valueOf, initial = null) {
  const [sort, setSort] = useState(initial);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return rows.map((r, i) => [r, i]).sort(([a, ai], [b, bi]) => {
      const x = valueOf(a, sort.key); const y = valueOf(b, sort.key);
      const empty = (v) => v == null || v === '' || (typeof v === 'number' && Number.isNaN(v));
      if (empty(x) || empty(y)) return (empty(x) ? 1 : 0) - (empty(y) ? 1 : 0) || ai - bi;
      return dir * cmp(x, y) || ai - bi;
    }).map(([r]) => r);
  }, [rows, sort, valueOf]);
  const onSort = (key, first = 'asc') => setSort(s => ({ key, dir: s?.key === key ? (s.dir === 'asc' ? 'desc' : 'asc') : first }));
  return { sorted, sort, onSort };
}

/** A heading that sorts when pressed, with the arrow of the current order. `tip` carries what/why/from for the hover text. */
export function SortTh({ id, sort, onSort, right = false, first, children, className = 'px-3 py-3', tip = {}, ...rest }) {
  const on = sort?.key === id;
  return (
    <th scope="col" aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={`${className} font-semibold ${right ? 'text-right' : 'text-left'}`} {...rest}>
      <button type="button" onClick={() => onSort(id, first)} className={`inline-flex items-center gap-1 cursor-pointer hover:text-slate-900 ${on ? 'text-slate-900' : ''}`}>
        <Head right={right} {...tip}>{children}</Head>
        {on ? (sort.dir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />) : <ChevronsUpDown size={12} className="text-slate-300" />}
      </button>
    </th>
  );
}

/** Save any text as a file (a report, a brief, a JSON or llms.txt): `name` with its extension, `mime` such as text/markdown or application/json. */
export function downloadFile(name, content, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadCsv(name, head, body) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const url = URL.createObjectURL(new Blob([`﻿${[head, ...body].map(r => r.map(cell).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * columns: [{ id, header, value?(row) for sorting, search and export, cell?(row) to draw it, right?, first?: 'asc'|'desc', tip?: {what, why, from}, className?, hide?: false to start hidden, csv?: false }]
 * filters: [{ id, label, options: [[value, label]], test(row, value) }]
 */
export default function DataTable({
  columns, rows, rowKey = (r, i) => r.id ?? i, initialSort = null, pageSize = 25, search = true, searchPlaceholder = 'Search this table', filters = [], exportName = '',
  empty = 'Nothing to show.', minWidth = 640, rowClass, toolbar = null, label = 'rows', columnsMenu = true, bare = false, sizes = SIZES, serial = true, headClass = 'bg-slate-50 text-slate-500', onState, initialSearch = '', initialFilters = {}, collapseFilters = false, filtersExtra = null, columnsKey = '', dense = false
}) {
  const [q, setQ] = useState(initialSearch);
  const [fv, setFv] = useState(initialFilters);
  const [showF, setShowF] = useState(() => Object.values(initialFilters).some(Boolean)); // with collapseFilters the filters (and filtersExtra) sit behind one button
  const defaultHidden = () => new Set(columns.filter(c => c.hide === true).map(c => c.id));
  // the columns a person ticks are remembered on this device for tables that pass columnsKey, and come back after a reload
  const [hidden, setHidden] = useState(() => {
    if (columnsKey) { try { const v = JSON.parse(localStorage.getItem(`dt.columns.${columnsKey}`)); if (Array.isArray(v)) { const ids = new Set(columns.map(c => c.id)); return new Set(v.filter(x => ids.has(x))); } } catch { /* not remembered */ } }
    return defaultHidden();
  });
  useEffect(() => { if (columnsKey) { try { localStorage.setItem(`dt.columns.${columnsKey}`, JSON.stringify([...hidden])); } catch { /* private window */ } } }, [hidden, columnsKey]);
  const colsMenu = useRef(null);
  useEffect(() => { // the Columns menu closes when you click anywhere else
    const away = (e) => { const d = colsMenu.current; if (d && d.open && !d.contains(e.target)) d.open = false; };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);
  const cols = columns.filter(c => !hidden.has(c.id));
  const byId = useMemo(() => Object.fromEntries(columns.map(c => [c.id, c])), [columns]);
  const valueOf = useMemo(() => (r, key) => { const c = byId[key]; return c?.value ? c.value(r) : undefined; }, [byId]);
  const text = (r) => columns.map(c => { const v = c.value ? c.value(r) : undefined; return v == null ? '' : String(v); }).join(' ').toLowerCase();
  const needle = q.trim().toLowerCase();
  const kept = useMemo(() => rows.filter(r => (!needle || text(r).includes(needle)) && filters.every(f => !fv[f.id] || f.test(r, fv[f.id]))), [rows, needle, fv]); // eslint-disable-line react-hooks/exhaustive-deps
  const { sorted, sort, onSort } = useSorted(kept, valueOf, initialSort);
  const pager = usePager(sorted, { size: pageSize, resetKey: `${needle}|${JSON.stringify(fv)}|${sort?.key}|${sort?.dir}` });
  useEffect(() => { onState?.({ rows: sorted, pager }); }, [sorted, pager.page, pager.size]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = Object.values(fv).filter(Boolean).length + (needle ? 1 : 0);
  const exportable = columns.filter(c => c.csv !== false && c.value);
  const bar = search || filters.length > 0 || exportName || columnsMenu || toolbar;
  const filterEls = filters.map(f => (
<label key={f.id} className="inline-flex items-center gap-1.5 text-12 font-semibold text-slate-500">{f.label}
              <Select value={fv[f.id] || ''} onChange={e => setFv(x => ({ ...x, [f.id]: e.target.value }))} aria-label={`Filter by ${f.label.toLowerCase()}`} className={`h-8 rounded-md border text-12.5 font-medium cursor-pointer max-w-[11rem] ${fv[f.id] ? 'border-indigo-400 bg-indigo-50 text-indigo-800' : 'border-slate-200 bg-white text-slate-700'}`}>
                <option value="">All</option>{f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </label>));
  const box = (
    <>
      {bar && (
        <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
          {search && <label className="relative"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} className="h-8 w-56 pl-8 pr-2 text-13 rounded-md border border-slate-200 bg-white focus:border-indigo-400 outline-none" /></label>}
          {collapseFilters && (filters.length > 0 || filtersExtra) && <button type="button" aria-expanded={showF} onClick={() => setShowF(v => !v)} className={`h-8 px-3 inline-flex items-center gap-1.5 rounded-md border text-12.5 font-semibold cursor-pointer ${showF || Object.values(fv).some(Boolean) ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>Filters{Object.values(fv).filter(Boolean).length ? ` (${Object.values(fv).filter(Boolean).length})` : ''}<ChevronDown size={13} className={showF ? 'rotate-180' : ''} /></button>}
          {!collapseFilters && filterEls}
          {toolbar}
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {active > 0 && <span className="text-12.5 text-slate-500" role="status">{sorted.length} of {rows.length} · <button type="button" onClick={() => { setQ(''); setFv({}); }} className="font-semibold text-indigo-700 hover:underline cursor-pointer">Clear filters</button></span>}
            {columnsMenu && columns.length > 3 && (
              <details ref={colsMenu} className="relative">
                <summary className="h-8 px-3 inline-flex items-center rounded-md border border-slate-200 bg-white text-12.5 font-semibold text-slate-700 cursor-pointer list-none hover:bg-slate-50">Columns{hidden.size ? ` (${columns.length - hidden.size} of ${columns.length})` : ''}</summary>
                <div className="absolute right-0 z-20 mt-1 w-60 max-h-80 overflow-y-auto rounded-lg bg-white shadow-lg ring-1 ring-slate-200 p-2">
                  <div className="flex items-center justify-between px-2 pb-1.5 mb-1 border-b border-slate-100 text-12.5"><button type="button" onClick={() => setHidden(new Set())} className="font-semibold text-indigo-700 hover:underline cursor-pointer">Show all</button><button type="button" onClick={() => setHidden(defaultHidden())} className="font-semibold text-slate-600 hover:underline cursor-pointer">Reset</button></div>
                  {columns.map(c => <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 text-13 text-slate-700 rounded hover:bg-slate-50 cursor-pointer"><input type="checkbox" checked={!hidden.has(c.id)} onChange={() => setHidden(h => { const x = new Set(h); x.has(c.id) ? x.delete(c.id) : x.add(c.id); return x; })} />{typeof c.header === 'string' ? c.header : c.label || c.id}</label>)}
                </div>
              </details>)}
            {exportName && exportable.length > 0 && <button type="button" onClick={() => downloadCsv(exportName, exportable.map(c => (typeof c.header === 'string' ? c.header : c.label || c.id)), sorted.map(r => exportable.map(c => c.value(r))))} className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white text-12.5 font-semibold text-slate-700 cursor-pointer hover:bg-slate-50" title="Download the rows shown (with the search and filters applied) as a CSV file"><Download size={13} />Export CSV</button>}
          </span>
        </div>)}
      {collapseFilters && showF && (filters.length > 0 || filtersExtra) && <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/60 flex flex-wrap items-center gap-x-4 gap-y-2">{filterEls}{filtersExtra}</div>}
      <div className="overflow-x-auto">
        <table className={`w-full text-13 ${dense ? '[&_td]:!px-2 [&_th]:!px-2' : ''}`} style={{ minWidth }}>
          <thead className={`${headClass} text-12 uppercase tracking-wide`}>
            <tr>{serial && <th scope="col" className="pl-4 pr-1 py-3 w-10 text-left font-semibold" title="Row number">#</th>}{cols.map(c => (c.value
              ? <SortTh key={c.id} id={c.id} sort={sort} onSort={onSort} right={c.right} first={c.first} tip={c.tip} className={c.thClass || 'px-3 py-3'}>{c.header}</SortTh>
              : <th key={c.id} scope="col" className={`${c.thClass || 'px-3 py-3'} font-semibold ${c.right ? 'text-right' : 'text-left'}`}><Head right={c.right} {...(c.tip || {})}>{c.header}</Head></th>))}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pager.rows.map((r, i) => (
              <tr key={rowKey(r, pager.from + i)} className={rowClass ? rowClass(r) : 'hover:bg-slate-50'}>
                {serial && <td className="pl-4 pr-1 py-2.5 text-12 text-slate-400 tabular-nums">{pager.from + i + 1}</td>}
                {cols.map(c => <td key={c.id} className={c.className || `px-3 py-2.5 ${c.right ? 'text-right tabular-nums' : ''}`}>{c.cell ? c.cell(r) : (c.value ? (c.value(r) ?? '—') : '')}</td>)}
              </tr>))}
            {!pager.rows.length && <tr><td colSpan={Math.max(1, cols.length + (serial ? 1 : 0))} className="px-5 py-10 text-center text-13 text-slate-500">{active ? <>Nothing matches. <button type="button" onClick={() => { setQ(''); setFv({}); }} className="font-semibold text-indigo-700 hover:underline cursor-pointer">Clear filters</button></> : empty}</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager p={pager} sizes={sizes} label={label} />
    </>
  );
  return bare ? box : <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden">{box}</div>;
}
