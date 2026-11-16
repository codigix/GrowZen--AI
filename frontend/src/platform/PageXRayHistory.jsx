import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, History, Loader2, Minus, ScanSearch, Trash2, TrendingDown, TrendingUp, Cpu, AlertTriangle } from 'lucide-react';
import { Button, Card, useDoubleConfirm } from './SeoUi';
import { api } from './seoApi';

const arr = (v) => (Array.isArray(v) ? v : []);
const tone = (s) => (s == null ? 'text-slate-400' : s >= 75 ? 'text-emerald-600' : s >= 45 ? 'text-amber-500' : 'text-red-500');
const when = (iso) => { if (!iso) return '—'; const t = new Date(iso); return Number.isNaN(t.getTime()) ? '—' : t.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }); };
const short = (iso) => { const t = new Date(iso); return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }); };
const pathOf = (u) => { try { const x = new URL(u); return `${x.pathname}${x.search}` || '/'; } catch { return u; } };
/** CSV cell: quoted, quotes doubled, a leading = + - @ neutralised so a spreadsheet never runs it as a formula. */
const csvCell = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
const toCsv = (rows) => rows.map(r => r.map(csvCell).join(',')).join('\r\n');
const saveFile = (name, text) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })); a.download = name; a.click(); URL.revokeObjectURL(a.href); };

const Delta = ({ v }) => (v == null ? <span className="text-slate-300" title="No earlier run of this page">—</span>
  : v === 0 ? <span className="text-slate-400 inline-flex items-center"><Minus size={11} /></span>
    : v > 0 ? <span className="text-emerald-600 text-11.5 font-semibold inline-flex items-center"><TrendingUp size={11} className="mr-0.5" />+{v}</span>
      : <span className="text-red-600 text-11.5 font-semibold inline-flex items-center"><TrendingDown size={11} className="mr-0.5" />{v}</span>);

/** Past X-Rays of one page: the scores over time, what changed since the run before, and the full saved report one click away. */
export function HistoryPanel({ b, url, tick, onOpen, onError }) {
  const [rows, setRows] = useState(null);
  const [trend, setTrend] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [ask, confirmNode] = useDoubleConfirm();
  const load = useCallback(async () => {
    if (!url) return;
    try {
      const q = encodeURIComponent(url);
      const [h, t] = await Promise.all([api(`/businesses/${b.id}/page-xray/history?url=${q}&limit=30`), api(`/businesses/${b.id}/page-xray/history/trend?url=${q}`)]);
      setRows(arr(h)); setTrend(arr(t)); setError('');
    } catch (e) { setError(e.message || 'The history could not be loaded.'); setRows([]); }
  }, [b.id, url]);
  useEffect(() => { setRows(null); load(); }, [load, tick]);
  const open = async (r) => {
    setBusy(`o${r.id}`);
    try {
      const full = await api(`/businesses/${b.id}/page-xray/history/${r.id}`);
      if (!full.report) { (onError || setError)('Only the scores of this run were kept (its full report was too large to store).'); return; }
      onOpen(full.report, full.created_at);
    } catch (e) { (onError || setError)(e.message || 'The saved report could not be opened.'); } finally { setBusy(''); }
  };
  const remove = (r) => ask({ what: `the X-Ray from ${when(r.created_at)}`, effect: 'This saved run is removed from the history. The page itself is not touched.', onConfirm: async () => { try { await api(`/businesses/${b.id}/page-xray/history/${r.id}`, { method: 'DELETE' }); load(); } catch (e) { setError(e.message || 'Could not delete it.'); } } });
  const chart = trend.map(t => ({ ...t, name: short(t.at) }));
  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 min-w-0">
      {confirmNode}
      <div className="flex items-center gap-3 mb-1"><span className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0"><History size={16} aria-hidden="true" /></span><h3 className="text-16 font-semibold text-slate-900">History of this page</h3></div>
      <p className="text-12.5 text-slate-500 mb-3">Every X-Ray you run is saved here, so you can see whether the scores go up after a fix.</p>
      {error && <p className="text-12.5 text-red-600 mb-2" role="alert">{error}</p>}
      {!rows ? <div className="py-6 flex justify-center text-slate-400"><Loader2 className="animate-spin" size={18} /></div> : rows.length === 0 ? <p className="text-13 text-slate-500 py-3">No saved runs of this page yet. The one you just ran is being saved.</p> : (
        <>
          {chart.length >= 2 ? (
            <div className="h-48 mb-3">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="seo" name="SEO" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="aeo" name="AEO" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="geo" name="GEO" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="text-12 text-slate-400 mb-2">The chart appears after two runs.</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-13">
              <thead className="text-12 text-slate-500 border-b border-slate-200"><tr><th className="p-2 text-left font-medium">Checked</th><th className="p-2 text-left font-medium">SEO</th><th className="p-2 text-left font-medium">AEO</th><th className="p-2 text-left font-medium">GEO</th><th className="p-2 text-left font-medium">Words</th><th className="p-2" /></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(r => (
                  <tr key={r.id}>
                    <td className="p-2 whitespace-nowrap text-slate-700">{when(r.created_at)}{r.render && <span className="ml-1.5 text-10 font-semibold bg-sky-50 text-sky-700 rounded px-1.5 py-0.5">Chrome</span>}{r.source === 'site' && <span className="ml-1.5 text-10 font-semibold bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">site scan</span>}</td>
                    {[['seo', r.seo], ['aeo', r.aeo], ['geo', r.geo]].map(([k, v]) => <td key={k} className="p-2 whitespace-nowrap"><span className={`font-semibold tabular-nums ${tone(v)}`}>{v ?? '—'}</span> <Delta v={r.change ? r.change[k] : null} /></td>)}
                    <td className="p-2 tabular-nums text-slate-500">{r.word_count ?? '—'}</td>
                    <td className="p-2 text-right whitespace-nowrap">
                      <Button size="sm" busy={busy === `o${r.id}`} onClick={() => open(r)}>Open</Button>
                      <button type="button" onClick={() => remove(r)} aria-label={`Delete the X-Ray from ${when(r.created_at)}`} className="ml-1 p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

const RENDER_LABELS = {
  raw_word_count: 'Words in the raw HTML', rendered_word_count: 'Words after JavaScript', words_added: 'Words added by JavaScript',
  raw_words: 'Words in the raw HTML', rendered_words: 'Words after JavaScript', raw_links: 'Links in the raw HTML', rendered_links: 'Links after JavaScript', links_added: 'Links added by JavaScript',
  raw_images: 'Images in the raw HTML', rendered_images: 'Images after JavaScript', images_added: 'Images added by JavaScript', raw_headings: 'Headings in the raw HTML', rendered_headings: 'Headings after JavaScript', headings_added: 'Headings added by JavaScript',
  render_ms: 'Time to render (ms)', js_added_links: 'Links added by JavaScript', js_added_images: 'Images added by JavaScript'
};
const humanise = (k) => RENDER_LABELS[k] || k.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

/** "Raw HTML vs rendered page": what the server sees without JavaScript against what a browser shows after it ran. */
export function RenderingCard({ r }) {
  if (!r || typeof r !== 'object') return null;
  const jsRequired = r.js_required;
  const nums = Object.entries(r).filter(([k, v]) => typeof v === 'number' && k !== 'js_required');
  const note = r.note || r.message;
  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 min-w-0">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <span className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0"><Cpu size={16} aria-hidden="true" /></span>
        <h3 className="text-16 font-semibold text-slate-900">Raw HTML vs rendered page</h3>
        {jsRequired != null && <span className={`text-11 font-semibold rounded-full px-2 py-0.5 ${jsRequired ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{jsRequired ? 'JavaScript required for the content' : 'Content is in the HTML'}</span>}
      </div>
      {note && <p className="text-14 text-slate-600 mb-4">{String(note)}</p>}
      {nums.length > 0 ? (
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {nums.map(([k, v]) => <div key={k} className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5 min-w-0"><dt className="text-12 text-slate-500 truncate">{humanise(k)}</dt><dd className="text-20 font-semibold text-slate-900 tabular-nums">{v.toLocaleString('en-IN')}</dd></div>)}
        </dl>
      ) : <p className="text-12.5 text-slate-500">The server did not send any counts to compare.</p>}
    </section>
  );
}

const SORTS = { page: (a, b) => a.url.localeCompare(b.url), seo: (a, b) => (a.seo ?? 999) - (b.seo ?? 999), aeo: (a, b) => (a.aeo ?? 999) - (b.aeo ?? 999), geo: (a, b) => (a.geo ?? 999) - (b.geo ?? 999),
  avg: (a, b) => avg(a) - avg(b) };
function avg(p) { const v = [p.seo, p.aeo, p.geo].filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 999; } // a page with no score sorts last when worst-first

/** Scan the project's whole website: every page X-Rayed in the background, shown worst-first, each saved to history. */
export function SiteScan({ b, onOpen, onDone }) {
  const [max, setMax] = useState(25);
  const [job, setJob] = useState(undefined); // undefined = loading, null = never scanned
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [sort, setSort] = useState({ key: 'avg', dir: 1 });
  const [busy, setBusy] = useState('');
  const timer = useRef(null);
  const running = job?.status === 'running';

  const refresh = useCallback(async () => {
    try { const j = await api(`/businesses/${b.id}/page-xray/site`); setJob(j || null); return j; } catch (e) { setError(e.message || 'The scan could not be read.'); setJob(prev => (prev === undefined ? null : prev)); return null; }
  }, [b.id]);
  useEffect(() => { setJob(undefined); refresh(); }, [refresh]);
  useEffect(() => {
    if (!running) return undefined;
    timer.current = setInterval(async () => { const j = await refresh(); if (j && j.status !== 'running') { clearInterval(timer.current); onDone?.(); } }, 3000);
    return () => clearInterval(timer.current);
  }, [running, refresh, onDone]);

  const start = async () => {
    setStarting(true); setError('');
    try { const j = await api(`/businesses/${b.id}/page-xray/site`, { method: 'POST', body: { max_pages: max } }); setJob(j); } catch (e) { setError(e.message || 'The scan could not be started.'); } finally { setStarting(false); }
  };
  const rows = useMemo(() => {
    const list = [...arr(job?.pages)].sort(SORTS[sort.key] || SORTS.avg);
    return sort.dir === 1 ? list : list.reverse();
  }, [job, sort]);
  const th = (key, label) => <th className="p-2 text-left font-medium"><button type="button" onClick={() => setSort(s => ({ key, dir: s.key === key ? -s.dir : 1 }))} className="hover:text-slate-900 cursor-pointer" aria-label={`Sort by ${label}`}>{label}{sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</button></th>;
  const open = async (p) => {
    if (!p.run_id) return;
    setBusy(p.url);
    try { const full = await api(`/businesses/${b.id}/page-xray/history/${p.run_id}`); if (!full.report) setError('Only the scores of this page were kept (its full report was too large to store).'); else onOpen(full.report, full.created_at); }
    catch (e) { setError(e.message || 'The saved report could not be opened.'); } finally { setBusy(''); }
  };
  const csv = () => saveFile(`${(b.name || 'site').replace(/\W+/g, '-')}-page-xray.csv`, toCsv([['url', 'seo', 'aeo', 'geo', 'top_fix', 'error'], ...rows.map(p => [p.url, p.seo, p.aeo, p.geo, p.top_fix, p.error])]));
  const pct = job?.total ? Math.round((job.done / job.total) * 100) : 0;
  const scored = arr(job?.pages).filter(p => p.seo != null);
  const mean = (k) => (scored.length ? Math.round(scored.reduce((s, p) => s + (p[k] || 0), 0) / scored.length) : null);

  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 min-w-0">
      <div className="flex items-center gap-3 mb-1"><span className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0"><ScanSearch size={16} aria-hidden="true" /></span><h3 className="text-16 font-semibold text-slate-900">Scan my whole website</h3></div>
      <p className="text-12.5 text-slate-500 mb-3">X-Rays every page of {b.website || 'the project website'} (only this website, never other sites), three at a time, and shows the weakest pages first. Each page is saved to its history.</p>
      {error && <p className="text-12.5 text-red-600 mb-2" role="alert">{error}</p>}
      <div className="flex flex-wrap items-end gap-4 mb-3">
        <label className="text-12 font-medium text-slate-500 flex-1 min-w-[220px] max-w-sm">Pages to scan: <b className="text-slate-800 tabular-nums">{max}</b>
          <input type="range" min={5} max={100} step={5} value={max} onChange={e => setMax(Number(e.target.value))} disabled={running} className="w-full mt-1.5 accent-indigo-600" aria-label="Number of pages to scan" />
        </label>
        <Button variant="primary" icon={ScanSearch} busy={starting || running} disabled={!b.website || running} onClick={start}>{running ? 'Scanning…' : job ? 'Scan again' : 'Scan my whole website'}</Button>
        {job && job.status === 'done' && job.pages?.length > 0 && <Button icon={Download} onClick={csv}>Download CSV</Button>}
      </div>
      {!b.website && <p className="text-12.5 text-amber-700 bg-amber-50 rounded-lg px-3 py-2">Add the project's website first (Edit profile, Contact step).</p>}
      {job === undefined && <div className="py-4 flex justify-center text-slate-400"><Loader2 className="animate-spin" size={18} /></div>}
      {job && (running || job.status === 'failed' || job.phase) && (
        <div className="mb-3" aria-live="polite">
          {running && (
            <>
              <div className="flex justify-between text-12.5 text-slate-600 mb-1"><span>{job.phase === 'discovering' ? 'Finding the pages of the website…' : `Scanning page ${Math.min(job.done + 1, job.total)} of ${job.total}…`}</span><span className="tabular-nums">{pct}%</span></div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-indigo-500 transition-all" style={{ width: `${job.phase === 'discovering' ? 5 : pct}%` }} /></div>
            </>
          )}
          {job.status === 'failed' && <p className="text-13 text-red-600 flex gap-1.5 items-start"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{job.error || 'The scan failed.'}</p>}
          {job.status === 'done' && job.error && <p className="text-13 text-amber-700">{job.error}</p>}
        </div>
      )}
      {job && scored.length > 0 && (
        <div className="grid grid-cols-3 gap-2.5 mb-3">{[['seo', 'SEO'], ['aeo', 'AEO'], ['geo', 'GEO']].map(([k, l]) => <div key={k} className="rounded-lg bg-slate-50 px-3 py-2"><div className="text-11.5 text-slate-500">Average {l}</div><div className={`text-20 font-bold tabular-nums ${tone(mean(k))}`}>{mean(k)}</div></div>)}</div>
      )}
      {job && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-13">
            <thead className="text-12 text-slate-500 border-b border-slate-200"><tr>{th('page', 'Page')}{th('seo', 'SEO')}{th('aeo', 'AEO')}{th('geo', 'GEO')}{th('avg', 'Top fix (worst first)')}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(p => (
                <tr key={p.url} className={p.run_id ? 'hover:bg-slate-50 cursor-pointer' : ''} onClick={() => open(p)} tabIndex={p.run_id ? 0 : -1} onKeyDown={e => { if (e.key === 'Enter') open(p); }} aria-label={p.run_id ? `Open the report of ${p.url}` : undefined}>
                  <td className="p-2 max-w-[280px]"><div className="truncate text-slate-900 font-medium" title={p.url}>{busy === p.url && <Loader2 size={12} className="inline animate-spin mr-1" />}{pathOf(p.url)}</div></td>
                  {['seo', 'aeo', 'geo'].map(k => <td key={k} className={`p-2 font-semibold tabular-nums ${tone(p[k])}`}>{p[k] ?? '—'}</td>)}
                  <td className="p-2 text-12.5 text-slate-600 max-w-[320px]"><div className="truncate" title={p.error || p.top_fix || ''}>{p.error ? <span className="text-red-600">{p.error}</span> : p.top_fix || '—'}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {job === null && <p className="text-13 text-slate-500 py-2">Not scanned yet.</p>}
    </section>
  );
}
