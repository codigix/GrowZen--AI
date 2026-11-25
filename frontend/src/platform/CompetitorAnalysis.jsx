import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Check, CheckCircle2, ExternalLink, Eye, Layers, Loader2, MapPin, MoreHorizontal, Plus, Search, Trash2, Users, X } from 'lucide-react';
import { Button, Badge, ErrorNote, Modal, useToast } from './SeoUi';
import DataTable from './DataTable';
import { BANDS, DISTANCE, band } from './CompetitorTables';
import Select from '../components/Select';
import { api } from './seoApi';

const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const kfmt = (n) => (n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : num(n));
const hostOf = (u) => { try { return new URL(/^https?:\/\//.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const STATUS = { analyzed: ['Analyzed', 'green'], partial: ['Partly read', 'amber'], pending: ['Pending', 'gray'], queued: ['Waiting', 'gray'], running: ['Analyzing…', 'blue'], failed: ['Failed', 'red'] };
const daTone = (v) => (v == null ? 'bg-slate-100 text-slate-400' : v >= 60 ? 'bg-emerald-100 text-emerald-800' : v >= 30 ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800');
const COST = (n) => (0.021 + 0.003 * n).toFixed(2);

/** What was last read for each competitor domain (and for your own site), kept on the server. */
export function useAnalysis(b, domains) {
  const [data, setData] = useState({ metrics: {}, own: null });
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const key = domains.slice().sort().join('|');
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api(`/businesses/${b.id}/keyword-workspace/competitor-analysis`, { method: 'POST', body: { domains } })); } catch { /* the table still shows without the figures */ } finally { setLoading(false); setLoaded(true); }
  }, [b.id, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return { ...data, loading, loaded, reload: load };
}

/** Distance from the chosen place and the match score of every saved competitor, worked out from the saved list (no research run needed). Read again when the place or the list changes. */
export function useRatings(b, location, ids) {
  const [data, setData] = useState({ by_id: {} });
  const [loading, setLoading] = useState(false);
  const key = `${location || ''}|${ids.slice().sort().join(',')}`;
  useEffect(() => {
    if (!ids.length) return undefined;
    let on = true;
    setLoading(true);
    api(`/businesses/${b.id}/keyword-workspace/competitor-analysis/ratings`, { method: 'POST', body: { location: location || null }, timeout: 180000 })
      .then(r => on && setData(r)).catch(() => {}).finally(() => on && setLoading(false));
    return () => { on = false; };
  }, [b.id, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...data, loading };
}

const AUTO_KEY = 'bevisibe.auto-analyze';
const readAuto = () => { try { return localStorage.getItem(AUTO_KEY) !== 'off'; } catch { return true; } };

/** Analyze the competitors that were not analyzed yet, by itself: the server reads them one after another in the background, and the table refreshes as each finishes.
 *  A competitor tried in the last day is not tried again, and at most ten start at once. */
export function useAutoAnalysis(b, analysis, pending) {
  const [on, setOn] = useState(readAuto);
  const [prog, setProg] = useState({ running: false, total: 0, done: 0, current: null, queue: [], failed: {} });
  const tried = useRef(new Set());
  const done = useRef(0);
  const key = pending.join('|');
  const base = `/businesses/${b.id}/keyword-workspace/competitor-analysis`;
  const toggle = (v) => { setOn(v); try { localStorage.setItem(AUTO_KEY, v ? 'on' : 'off'); } catch { /* not remembered */ } };

  // pick up a run that is already going (another visit, another tab)
  useEffect(() => { api(`${base}/progress`).then(setProg).catch(() => {}); }, [base]);
  // start one when something is pending
  useEffect(() => {
    if (!on || !analysis.loaded || !pending.length || prog.running) return;
    const fresh = pending.filter(d => !tried.current.has(d));
    if (!fresh.length) return;
    fresh.forEach(d => tried.current.add(d));
    api(`${base}/auto`, { method: 'POST', body: { domains: fresh } }).then(setProg).catch(() => {});
  }, [on, analysis.loaded, key, prog.running]); // eslint-disable-line react-hooks/exhaustive-deps
  // follow it, and show each result as it arrives
  useEffect(() => {
    if (!prog.running) { if (done.current) { done.current = 0; analysis.reload(); } return undefined; }
    const t = setInterval(async () => {
      const p = await api(`${base}/progress`).catch(() => null);
      if (!p) return;
      if (p.done !== done.current) { done.current = p.done; analysis.reload(); }
      setProg(p);
    }, 2500);
    return () => clearInterval(t);
  }, [prog.running, base]); // eslint-disable-line react-hooks/exhaustive-deps
  const stop = () => api(`${base}/stop`, { method: 'POST' }).then(setProg).catch(() => {});
  return { on, toggle, prog, stop };
}

/** The line above the table: what the automatic analysis is doing. */
export function AutoBar({ auto }) {
  const { on, toggle, prog, stop } = auto;
  const failed = Object.entries(prog.failed || {});
  return (
    <div className="rounded-xl bg-white ring-1 ring-slate-200 px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
      {prog.running ? (
        <div className="flex items-center gap-3 flex-1 min-w-[260px]">
          <Loader2 size={16} className="animate-spin text-indigo-600 shrink-0" />
          <div className="flex-1 min-w-0"><div className="text-13 font-semibold text-slate-900">Analyzing competitors <span className="font-normal text-slate-500">{prog.done} of {prog.total} · now {prog.current}</span></div>
            <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${Math.max(4, (prog.done / Math.max(1, prog.total)) * 100)}%` }} /></div></div>
          <Button size="sm" onClick={stop}>Stop</Button>
        </div>
      ) : (
        <div className="flex-1 min-w-[260px] text-12.5 text-slate-600">{on ? 'Competitors that were not analyzed are analyzed automatically: their Domain Authority and the keywords they rank for. Nothing about their websites is audited.' : 'Automatic analysis is off. Use “Analyze selected” on the rows you want.'}
          {failed.length > 0 && <span className="block text-amber-700 mt-0.5" title={failed.map(([d, m]) => `${d}: ${m}`).join('\n')}>{failed.length} could not be fully read: {failed[0][0]}: {failed[0][1]}{failed.length > 1 ? ` (+${failed.length - 1})` : ''}</span>}</div>
      )}
      <label className="inline-flex items-center gap-2 text-12.5 text-slate-700 cursor-pointer select-none" title="Each competitor read costs about $0.04 at Apify">
        <button type="button" role="switch" aria-checked={on} onClick={() => toggle(!on)} className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${on ? 'bg-indigo-600' : 'bg-slate-300'}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} /></button>
        Auto-analyze
      </label>
    </div>
  );
}

function Logo({ host, name }) {
  const [bad, setBad] = useState(false);
  return bad || !host ? <span className="w-8 h-8 rounded-md bg-indigo-50 text-indigo-700 inline-flex items-center justify-center text-13 font-bold shrink-0">{(name || host || '?').trim().charAt(0).toUpperCase()}</span>
    : <img src={`https://${host}/favicon.ico`} alt="" width={32} height={32} loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} className="w-8 h-8 rounded-md object-contain bg-white ring-1 ring-slate-200 p-1 shrink-0" />;
}

function Stat({ icon: Icon, label, value, sub, tone }) {
  return (
    <div className={`rounded-xl ring-1 px-4 py-3.5 flex items-center gap-3.5 ${tone}`}>
      <span className="w-11 h-11 rounded-xl bg-white/80 inline-flex items-center justify-center shrink-0"><Icon size={22} className="opacity-80" /></span>
      <div className="min-w-0"><div className="text-13 text-slate-600">{label}</div><div className="text-28 font-bold text-slate-900 tabular-nums leading-tight">{value}</div>{sub && <div className="text-11.5 text-slate-500 truncate">{sub}</div>}</div>
    </div>
  );
}

/** The four figures above the table. */
export function AnalysisStats({ rows, status, isChosen, metrics }) {
  const das = rows.map(c => metrics[c.host]?.da).filter(v => v != null);
  const analyzed = rows.filter(c => status(c) === 'analyzed').length;
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
      <Stat icon={Users} label="Total competitors" value={rows.length} sub="found around the place" tone="bg-indigo-50/60 ring-indigo-100" />
      <Stat icon={CheckCircle2} label="Selected" value={rows.filter(isChosen).length} sub="watched and compared" tone="bg-emerald-50/60 ring-emerald-100" />
      <Stat icon={BarChart3} label="Analyzed" value={analyzed} sub={`${rows.length - analyzed} still to read`} tone="bg-sky-50/60 ring-sky-100" />
      <Stat icon={Layers} label="Avg. Domain Authority" value={das.length ? Math.round(das.reduce((a, v) => a + v, 0) / das.length) : '—'} sub={das.length ? `from ${das.length} site${das.length === 1 ? '' : 's'}` : 'analyze a competitor to read it'} tone="bg-violet-50/60 ring-violet-100" />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------- the table
export function CompetitorsPanel({ b, auto, rating, rows, scope, setScope, nearCount, allCount, radius, placeName, isChosen, metrics, reload, onChoose, onRemove, onAdd, onDetail, onKeywords, addBusy, addError, onFindMaps, findBusy }) {
  const [toast, toastNode] = useToast();
  const [sel, setSel] = useState(() => new Set());
  const [running, setRunning] = useState({}); // host -> 'running' | 'failed'
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const viewRef = useRef([]); // the rows the table shows now (filtered, sorted): the header checkbox selects these
  const view = viewRef.current;

  const queue = auto?.prog?.queue || [];
  const failedBy = auto?.prog?.failed || {};
  const st = (c) => running[c.host] || (auto?.prog?.running && auto.prog.current === c.host ? 'running' : auto?.prog?.running && queue.includes(c.host) ? 'queued' : metrics[c.host]?.status || 'pending');
  const data = useMemo(() => rows.map(c => ({ ...c, m: metrics[c.host] || {}, status: st(c), chosen: isChosen(c) })), [rows, metrics, running, auto?.prog, isChosen]); // eslint-disable-line react-hooks/exhaustive-deps
  const picked = data.filter(c => sel.has(c.key));
  const toggle = (k) => setSel(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const allOn = view.length > 0 && view.every(c => sel.has(c.key));

  const analyze = async (list) => {
    const todo = list.filter(c => c.host && running[c.host] !== 'running');
    if (!todo.length) { toast('Nothing to analyze: these have no website.'); return; }
    let ok = 0;
    for (const c of todo) { // one competitor at a time, each row shows its own state
      setRunning(r => ({ ...r, [c.host]: 'running' }));
      try {
        const r = await api(`/businesses/${b.id}/keyword-workspace/competitor-analysis/analyze`, { method: 'POST', body: { domain: c.host, limit: 100 }, timeout: 240000 });
        setRunning(x => { const n = { ...x }; delete n[c.host]; return n; });
        await reload();
        if (r.notes?.length) toast(`${c.name}: ${r.notes[0]}`); else ok += 1;
      } catch (e) { setRunning(x => ({ ...x, [c.host]: 'failed' })); toast(`${c.name}: ${e.message}`); }
    }
    if (ok) toast(`${ok} competitor${ok === 1 ? '' : 's'} analyzed`);
  };
  const choose = async (list, on) => { for (const c of list) await onChoose({ ...(c.reg || {}), id: c.reg?.id, name: c.name, website: c.website, maps: c.maps }, on); setSel(new Set()); };
  const remove = async () => { for (const c of picked.filter(x => x.reg)) await onRemove(c.reg); setSel(new Set()); setConfirm(false); };
  const submitAdd = async (e) => { e.preventDefault(); if (await onAdd(url.trim(), name.trim())) { setUrl(''); setName(''); setAdding(false); } };
  const city = (c) => (c.maps?.address || '').split(',').slice(-3, -1).map(x => x.trim()).filter(Boolean).join(', ') || (c.maps?.address || '').split(',')[0];
  const Icon = ({ label, onClick, children, disabled, tone = 'text-slate-500 hover:text-indigo-700' }) => <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className={`p-1.5 cursor-pointer disabled:opacity-30 disabled:cursor-default ${tone}`}>{children}</button>;

  const cols = [
    { id: 'sel', header: <input type="checkbox" aria-label="Select every row shown" checked={allOn} onChange={e => setSel(s => { const n = new Set(s); view.forEach(c => (e.target.checked ? n.add(c.key) : n.delete(c.key))); return n; })} className="accent-indigo-600" />, csv: false,
      cell: c => <input type="checkbox" aria-label={`Select ${c.name}`} checked={sel.has(c.key)} onChange={() => toggle(c.key)} className="accent-indigo-600" />, className: 'pl-3 pr-1 py-2.5 w-8', thClass: 'pl-3 pr-1 py-3 w-8' },
    { id: 'name', header: 'Competitor', first: 'asc', value: c => c.name, className: 'px-3 py-2.5 min-w-[210px]',
      cell: c => <button type="button" onClick={() => onDetail(c)} className="flex items-center gap-2.5 text-left cursor-pointer group max-w-[280px]"><Logo host={c.host} name={c.name} /><span className="min-w-0"><span className="block font-semibold text-slate-900 group-hover:text-indigo-700 truncate">{c.name}</span>{c.chosen && <span className="text-11 font-semibold text-emerald-700">Selected</span>}</span></button> },
    { id: 'domain', header: 'Domain', value: c => c.host, cell: c => (c.host ? <a href={`https://${c.host}`} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline inline-flex items-center gap-1">{c.host}<ExternalLink size={11} /></a> : <span className="text-slate-300">no website</span>) },
    { id: 'location', header: 'Location', value: c => city(c), className: 'px-3 py-2.5 max-w-[200px]', tip: { what: 'Where the business is, from its Google Maps address.' }, cell: c => <span className="inline-flex items-center gap-1"><MapPin size={12} className="text-slate-400 shrink-0" /><span className="truncate" title={c.maps?.address || ''}>{city(c) || '—'}</span></span> },
    { id: 'dist', header: 'Distance', right: true, value: c => c.maps?.distance_m ?? null, tip: { what: 'How far its Google Maps pin is from the place you are searching.' }, cell: c => (c.maps?.distance_m == null ? <span className="text-slate-300">—</span> : c.maps.distance_m < 1000 ? `${c.maps.distance_m} m` : `${(c.maps.distance_m / 1000).toFixed(1)} km`) },
    { id: 'da', header: 'DA', value: c => c.m.da ?? null, first: 'desc', tip: { what: 'Domain Authority, 0 to 100 (Moz).' }, className: 'px-3 py-2.5 text-center', thClass: 'px-3 py-3', cell: c => <span className={`inline-flex items-center justify-center min-w-[34px] h-7 px-2 rounded-md text-13 font-bold ${daTone(c.m.da)}`}>{c.m.da ?? '—'}</span> },
    { id: 'kw', header: 'Ranking keywords', right: true, first: 'desc', value: c => c.m.keywords ?? null, tip: { what: 'How many keywords it ranks for in a ranked-keywords read, for the market below.' } },
    { id: 'top3', header: 'Top 3', right: true, first: 'desc', value: c => c.m.top3 ?? null, tip: { what: 'Keywords where it holds one of the first three positions.' } },
    { id: 'top10', header: 'Top 10', right: true, first: 'desc', value: c => c.m.top10 ?? null, tip: { what: 'Keywords on page 1 of Google.' } },
    { id: 'avg', header: 'Avg position', right: true, value: c => c.m.avg_position ?? null, cell: c => (c.m.avg_position == null ? '—' : `#${c.m.avg_position}`) },
    { id: 'traffic', header: 'Organic traffic', right: true, first: 'desc', value: c => c.m.traffic ?? null, tip: { what: 'Estimated organic visits a month from the keywords it ranks for.' }, cell: c => kfmt(c.m.traffic) },
    { id: 'rd', header: 'Ref. domains', right: true, first: 'desc', value: c => c.m.rd ?? null, cell: c => kfmt(c.m.rd), tip: { what: 'Websites linking to it (Moz).' } },
    { id: 'match', header: 'Match', first: 'desc', value: c => c.maps?.relevance?.score ?? null, tip: { what: 'How well it matches your business on nine factors. Open the profile for the breakdown.' },
      cell: c => (!c.maps?.relevance && rating?.loading ? <span className="inline-flex items-center gap-1 text-12 text-slate-400"><Loader2 size={12} className="animate-spin" />rating…</span> : c.maps?.relevance ? <span className="inline-flex items-center gap-1.5" title={c.maps.relevance.label_text}><b className="tabular-nums">{c.maps.relevance.score}</b><span className={`w-2 h-2 rounded-full ${c.maps.relevance.label === 'direct' ? 'bg-emerald-500' : c.maps.relevance.label === 'related' ? 'bg-amber-400' : 'bg-slate-300'}`} /></span> : <span className="text-slate-300">—</span>) },
    { id: 'status', header: 'Status', value: c => (STATUS[c.status] || STATUS.pending)[0], className: 'px-3 py-2.5 whitespace-nowrap',
      cell: c => <span title={failedBy[c.host] || undefined}><Badge tone={failedBy[c.host] && c.status !== 'analyzed' ? 'amber' : (STATUS[c.status] || STATUS.pending)[1]}>{c.status === 'running' && <Loader2 size={11} className="animate-spin" />}{(STATUS[c.status] || STATUS.pending)[0]}</Badge></span> },
    { id: 'chosen', header: 'Selected', value: c => (c.chosen ? 'Yes' : 'No'), hide: true },
    { id: 'actions', header: 'Actions', right: true, csv: false, className: 'px-2 py-1.5 text-right whitespace-nowrap',
      cell: c => (
        <span className="inline-flex items-center">
          <Icon label={`View ${c.name}`} onClick={() => onDetail(c)}><Eye size={16} /></Icon>
          <Icon label="Analyze now: Domain Authority and ranked keywords" disabled={!c.host || c.status === 'running'} onClick={() => analyze([c])}><BarChart3 size={16} /></Icon>
          <Icon label="Its keywords" onClick={() => onKeywords(c)}><Layers size={16} /></Icon>
          <Icon label={c.chosen ? 'Remove from selected competitors' : 'Select as a competitor'} onClick={() => choose([c], !c.chosen)} tone={c.chosen ? 'text-emerald-600 hover:text-emerald-800' : 'text-slate-500 hover:text-emerald-700'}><CheckCircle2 size={16} /></Icon>
          {c.reg && <Icon label="Remove this competitor" onClick={() => { setSel(new Set([c.key])); setConfirm(true); }} tone="text-slate-400 hover:text-rose-600"><Trash2 size={16} /></Icon>}
        </span>) },
  ];
  const filters = [
    { id: 'status', label: 'Status', options: [['analyzed', 'Analyzed'], ['partial', 'Partly read'], ['pending', 'Pending'], ['running', 'Analyzing'], ['queued', 'Waiting']], test: (c, v) => c.status === v },
    { id: 'chosen', label: 'Selection', options: [['yes', 'Selected'], ['no', 'Not selected']], test: (c, v) => (v === 'yes' ? c.chosen : !c.chosen) },
    { id: 'match', label: 'Match', options: [['direct', 'Direct competitor'], ['related', 'Related business'], ['unrelated', 'Not a competitor']], test: (c, v) => c.maps?.relevance?.label === v },
    { id: 'dist', label: 'Distance', options: DISTANCE, test: (c, v) => c.maps?.distance_m != null && c.maps.distance_m <= Number(v) },
    { id: 'da', label: 'Authority', options: [['strong', 'Strong (60+)'], ['mid', 'Medium (30 to 59)'], ['weak', 'Weak (under 30)'], ['unread', 'Not read']], test: (c, v) => (v === 'unread' ? c.m.da == null : c.m.da != null && (v === 'strong' ? c.m.da >= 60 : v === 'mid' ? c.m.da >= 30 && c.m.da < 60 : c.m.da < 30)) },
    { id: 'rank', label: 'Rankings', options: [['top3', 'Has top 3 keywords'], ['top10', 'Has page 1 keywords'], ['none', 'No ranking keywords read']], test: (c, v) => (v === 'none' ? !c.m.keywords : v === 'top3' ? (c.m.top3 || 0) > 0 : (c.m.top10 || 0) > 0) },
  ];
  const toolbar = (
    <>
      <div className="inline-flex rounded-lg ring-1 ring-inset ring-slate-300 overflow-hidden" role="group" aria-label="Where">
        {[['near', `Within ${radius >= 1000 ? `${Math.round(radius / 100) / 10} km` : `${radius} m`} of ${placeName || 'the place'} (${nearCount})`], ['all', `Everywhere (${allCount})`]].map(([k, l]) => <button key={k} type="button" aria-pressed={scope === k} onClick={() => setScope(k)} className={`h-8 px-3 text-12 font-medium cursor-pointer ${scope === k ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}
      </div>
      <Button size="sm" icon={MapPin} busy={findBusy} onClick={onFindMaps} title="Find more competitors on Google Maps around the place">Find more</Button>
      <Button size="sm" icon={Plus} variant="primary" onClick={() => setAdding(a => !a)} aria-expanded={adding}>Add competitor</Button>
    </>
  );

  return (
    <div className="space-y-3">
      {adding && (
        <form onSubmit={submitAdd} className="rounded-xl bg-white ring-1 ring-slate-200 px-4 py-3 flex flex-wrap items-center gap-2">
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="Website or domain, e.g. competitor.com" aria-label="Competitor website" className="h-10 flex-1 min-w-[220px] rounded-lg ring-1 ring-inset ring-slate-300 px-3 text-13 focus:ring-2 focus:ring-indigo-500 outline-none" />
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name (optional)" aria-label="Competitor name" className="h-10 w-52 rounded-lg ring-1 ring-inset ring-slate-300 px-3 text-13 focus:ring-2 focus:ring-indigo-500 outline-none" />
          <Button type="submit" variant="primary" busy={addBusy} disabled={url.trim().length < 3}>Add</Button>
          <Button type="button" onClick={() => setAdding(false)}>Cancel</Button>
          {addError && <div className="w-full"><ErrorNote>{addError}</ErrorNote></div>}
        </form>
      )}
      <DataTable columns={cols} rows={data} rowKey={c => c.key} filters={filters} toolbar={toolbar} initialSort={{ key: 'match', dir: 'desc' }} pageSize={10} serial minWidth={1250} label="competitors"
        exportName="competitors" searchPlaceholder="Search competitor by name or domain" onState={s => { viewRef.current = s.rows; }}
        rowClass={c => (sel.has(c.key) ? 'bg-indigo-50/50' : c.chosen ? 'bg-emerald-50/30 hover:bg-emerald-50/60' : 'hover:bg-slate-50')}
        empty={rows.length ? 'No competitor matches these filters.' : scope === 'near' ? `No competitor found within ${radius >= 1000 ? `${radius / 1000} km` : `${radius} m`} of ${placeName || 'this place'}. Try Everywhere, a larger distance or Find more.` : 'No competitors yet. Find them on Google Maps or add one by its website.'} />
      <p className="text-12 text-slate-500">Ranking keywords, Top 3, Top 10, average position and traffic are for the market of this project{rating?.market ? ` (${rating.market})` : ''}, read from each competitor's ranked keywords. Distance and Match are for {placeName || 'the chosen place'}.</p>

      {sel.size > 0 && (
        <div className="sticky bottom-3 z-20"><div role="toolbar" aria-label="Selected competitors" className="rounded-xl bg-white shadow-xl ring-1 ring-slate-200 px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-800 text-13.5 font-semibold">{sel.size} competitor{sel.size === 1 ? '' : 's'} selected</span>
          <button type="button" onClick={() => setSel(new Set())} className="text-12.5 text-slate-500 hover:text-slate-800 underline cursor-pointer">Clear</button>
          <span className="text-12 text-slate-400 hidden md:inline">Analyze reads Domain Authority and up to 100 keywords: about ${COST(100)} each at Apify.</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button icon={Check} onClick={() => choose(picked, true)}>Select as competitors</Button>
            <Button variant="primary" icon={BarChart3} disabled={!picked.some(c => c.host)} onClick={() => analyze(picked)}>Analyze selected</Button>
            <Button icon={Trash2} disabled={!picked.some(c => c.reg)} onClick={() => setConfirm(true)} className="text-rose-700">Remove</Button>
          </div>
        </div></div>
      )}
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Remove competitors?" width="max-w-md" footer={<><Button onClick={() => setConfirm(false)}>Cancel</Button><Button variant="danger" onClick={remove}>Remove {picked.filter(c => c.reg).length}</Button></>}>
        <p className="text-13 text-slate-600">These saved competitors are deleted from your list, with their kept keywords: {picked.filter(c => c.reg).map(c => c.name).join(', ')}. Businesses only found on Google Maps are not saved and stay as they are.</p>
      </Modal>
      {toastNode}
    </div>
  );
}
const BarChartIcon = ({ size = 14, ...p }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 3v12" /><path d="m7 11 5 5 5-5" /><path d="M5 21h14" /></svg>;

// ---------------------------------------------------------------------------------------------------------------------------------- comparison tabs
function Bars({ rows, value, fmt = kfmt, color = '#6366f1' }) {
  const max = Math.max(1, ...rows.map(r => r.v || 0));
  return (
    <ul className="space-y-2.5">{rows.map(r => (
      <li key={r.host} className="flex items-center gap-3"><span className={`w-44 truncate text-13 ${r.you ? 'font-semibold text-slate-900' : 'text-slate-700'}`} title={r.host}>{r.you ? `${r.host} (you)` : r.name}</span>
        <div className="flex-1 h-3 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.max(r.v ? 2 : 0, ((r.v || 0) / max) * 100)}%`, background: r.you ? '#059669' : color }} /></div>
        <span className="w-20 text-right tabular-nums text-13 font-semibold">{r.v == null ? <span className="text-slate-300 font-normal">not read</span> : fmt(r.v)}</span></li>
    ))}</ul>
  );
}

const Panel = ({ title, sub, children, action }) => <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4"><div className="flex items-start gap-3 mb-3"><div><h3 className="text-15 font-semibold text-slate-900">{title}</h3>{sub && <p className="text-12.5 text-slate-500">{sub}</p>}</div>{action && <div className="ml-auto">{action}</div>}</div>{children}</div>;
const unread = (analysis, rows) => rows.filter(c => c.host && !analysis.metrics[c.host]?.keywords).length;

export function TrafficTab({ rows, analysis }) {
  const own = analysis.own;
  const list = rows.filter(c => c.host);
  const mk = (key) => [...(own ? [{ host: own.domain, name: own.domain, you: true, v: own[key] }] : []), ...list.map(c => ({ host: c.host, name: c.name, v: analysis.metrics[c.host]?.[key] ?? null }))].sort((a, c) => (c.v ?? -1) - (a.v ?? -1));
  const data = useMemo(() => [...(own ? [{ host: own.domain, name: own.domain, you: true, ...own }] : []), ...list.map(c => ({ host: c.host, name: c.name, ...(analysis.metrics[c.host] || {}) }))], [own, rows, analysis.metrics]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = unread(analysis, rows);
  const cols = [
    { id: 'site', header: 'Site', first: 'asc', value: r => r.host, cell: r => <span className="font-medium">{r.host}{r.you && <span className="ml-2 text-11 font-semibold text-emerald-700">You</span>}</span> },
    { id: 'traffic', header: 'Organic traffic', right: true, first: 'desc', value: r => r.traffic ?? null, cell: r => kfmt(r.traffic), tip: { what: 'Estimated visits a month from its ranked keywords. Yours: Google clicks in the last 28 days.' } },
    { id: 'keywords', header: 'Ranking keywords', right: true, first: 'desc', value: r => r.keywords ?? null, cell: r => num(r.keywords) },
    { id: 'top3', header: 'Top 3', right: true, first: 'desc', value: r => r.top3 ?? null },
    { id: 'top10', header: 'Top 10', right: true, first: 'desc', value: r => r.top10 ?? null },
    { id: 'avg', header: 'Avg position', right: true, value: r => r.avg_position ?? null, cell: r => (r.avg_position == null ? '—' : `#${r.avg_position}`) },
    { id: 'da', header: 'DA', right: true, first: 'desc', value: r => r.da ?? null },
    { id: 'read', header: 'Keywords read', value: r => r.kw_read_at || '', cell: r => (r.kw_read_at ? new Date(r.kw_read_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : r.you ? 'Search Console' : <span className="text-slate-400">not read</span>) },
  ];
  const filters = [
    { id: 'read', label: 'Keywords', options: [['read', 'Read'], ['unread', 'Not read']], test: (r, v) => (v === 'read' ? r.keywords != null : r.keywords == null) },
    { id: 'rank', label: 'Rankings', options: [['top3', 'Has top 3'], ['top10', 'Has page 1']], test: (r, v) => (v === 'top3' ? (r.top3 || 0) > 0 : (r.top10 || 0) > 0) },
  ];
  return (
    <div className="space-y-4">
      {n > 0 && <div className="rounded-lg bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-12.5 text-amber-900">{n} competitor{n === 1 ? ' has' : 's have'} not been analyzed yet, so {n === 1 ? 'its' : 'their'} traffic is “not read”. They are analyzed automatically; you can also select them on the Competitors tab and press Analyze selected.</div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Estimated organic traffic" sub="Visits a month from the keywords each competitor ranks for. Yours is Google clicks in the last 28 days from Search Console."><Bars rows={mk('traffic')} /></Panel>
        <Panel title="Ranking keywords" sub="How many keywords each one ranks for (yours: your tracked keywords that rank)."><Bars rows={mk('keywords')} fmt={num} color="#0ea5e9" /></Panel>
        <Panel title="Keywords in the top 3" sub="Keywords where it holds one of the first three positions."><Bars rows={mk('top3')} fmt={num} color="#10b981" /></Panel>
        <Panel title="Keywords in the top 10" sub="Keywords on page 1 of Google."><Bars rows={mk('top10')} fmt={num} color="#f59e0b" /></Panel>
      </div>
      <DataTable columns={cols} rows={data} rowKey={r => r.host} filters={filters} initialSort={{ key: 'traffic', dir: 'desc' }} exportName="traffic-comparison" searchPlaceholder="Search sites" label="sites" rowClass={r => (r.you ? 'bg-emerald-50/50' : 'hover:bg-slate-50')} />
    </div>
  );
}

export function BacklinkTab({ rows, analysis }) {
  const own = analysis.own;
  const data = useMemo(() => [...(own ? [{ host: own.domain, name: own.domain, you: true, ...own }] : []), ...rows.filter(c => c.host).map(c => ({ host: c.host, name: c.name, ...(analysis.metrics[c.host] || {}) }))], [own, rows, analysis.metrics]);
  const bar = (key) => data.map(r => ({ host: r.host, name: r.name, you: r.you, v: r[key] ?? null })).sort((a, c) => (c.v ?? -1) - (a.v ?? -1));
  const cols = [
    { id: 'site', header: 'Site', first: 'asc', value: r => r.host, cell: r => <span className="font-medium">{r.host}{r.you && <span className="ml-2 text-11 font-semibold text-emerald-700">You</span>}</span> },
    { id: 'name', header: 'Name', value: r => r.name, hide: true },
    { id: 'da', header: 'Domain Authority', first: 'desc', value: r => r.da ?? null, className: 'px-3 py-2.5 text-center', cell: r => <span className={`inline-flex min-w-[34px] h-6 items-center justify-center rounded-md px-2 font-bold ${daTone(r.da)}`}>{r.da ?? '—'}</span> },
    { id: 'pa', header: 'Page Authority', right: true, first: 'desc', value: r => r.pa ?? null },
    { id: 'rd', header: 'Referring domains', right: true, first: 'desc', value: r => r.rd ?? null, cell: r => num(r.rd) },
    { id: 'spam', header: 'Spam score', right: true, value: r => r.spam ?? null, cell: r => (r.spam == null ? '—' : `${r.spam}%`) },
    { id: 'read', header: 'Last read', value: r => r.site_read_at || '', cell: r => (r.site_read_at ? new Date(r.site_read_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : <span className="text-slate-400">not read</span>) },
  ];
  const filters = [
    { id: 'da', label: 'Authority', options: [['strong', 'Strong (60+)'], ['mid', 'Medium (30 to 59)'], ['weak', 'Weak (under 30)'], ['unread', 'Not read']], test: (r, v) => (v === 'unread' ? r.da == null : r.da != null && (v === 'strong' ? r.da >= 60 : v === 'mid' ? r.da >= 30 && r.da < 60 : r.da < 30)) },
    { id: 'spam', label: 'Spam score', options: [['high', '10% and over'], ['low', 'Under 10%']], test: (r, v) => r.spam != null && (v === 'high' ? r.spam >= 10 : r.spam < 10) },
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Domain Authority" sub="How strong each site is, 0 to 100 (Moz, through Apify)."><Bars rows={bar('da')} fmt={num} color="#8b5cf6" /></Panel>
        <Panel title="Referring domains" sub="How many different websites link to each site (Moz)."><Bars rows={bar('rd')} fmt={num} color="#6366f1" /></Panel>
      </div>
      <DataTable columns={cols} rows={data} rowKey={r => r.host} filters={filters} initialSort={{ key: 'da', dir: 'desc' }} exportName="backlink-comparison" searchPlaceholder="Search sites" label="sites" rowClass={r => (r.you ? 'bg-emerald-50/50' : 'hover:bg-slate-50')} />
      <p className="text-12 text-slate-500">The links themselves, the sites that link to a competitor and not to you, are on the <Link className="text-indigo-600 underline" to="/backlinks/overview">Backlinks</Link> page (Compare).</p>
    </div>
  );
}

export function TopPagesTab({ b, rows }) {
  const [list, setList] = useState(null);
  const domains = rows.map(c => c.host).filter(Boolean);
  useEffect(() => { let on = true; api(`/businesses/${b.id}/keyword-workspace/competitor-analysis/pages`, { method: 'POST', body: { domains } }).then(r => on && setList(r.pages || [])).catch(() => on && setList([])); return () => { on = false; }; }, [b.id, domains.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!list) return <div className="flex items-center justify-center gap-2 py-14 text-13 text-slate-500"><Loader2 size={16} className="animate-spin" />Loading…</div>;
  const cols = [
    { id: 'url', header: 'Page', first: 'asc', value: p => p.url, className: 'px-3 py-2.5 max-w-[360px]', cell: p => <a href={p.url} target="_blank" rel="noreferrer" title={p.url} className="text-blue-700 hover:underline inline-flex items-center gap-1 max-w-full"><span className="truncate">{p.url.replace(/^https?:\/\/(www\.)?/, '')}</span><ExternalLink size={11} className="shrink-0" /></a> },
    { id: 'domain', header: 'Competitor', value: p => p.domain },
    { id: 'keywords', header: 'Keywords', right: true, first: 'desc', value: p => p.keywords },
    { id: 'traffic', header: 'Est. traffic', right: true, first: 'desc', value: p => p.traffic, cell: p => kfmt(p.traffic) },
    { id: 'best', header: 'Best position', right: true, value: p => p.best ?? null, cell: p => (p.best ? `#${p.best}` : '—') },
    { id: 'top', header: 'Top keyword', value: p => p.top_keyword || '' },
  ];
  const filters = [
    { id: 'domain', label: 'Competitor', options: [...new Set(list.map(p => p.domain))].map(d => [d, d]), test: (p, v) => p.domain === v },
    { id: 'best', label: 'Best position', options: BANDS.filter(x => x[0] !== 'none'), test: (p, v) => band(p.best) === v },
    { id: 'traffic', label: 'Traffic', options: [['100', '100+ a month'], ['1000', '1,000+ a month']], test: (p, v) => p.traffic >= Number(v) },
  ];
  return <DataTable columns={cols} rows={list} rowKey={p => `${p.domain}|${p.url}`} filters={filters} initialSort={{ key: 'traffic', dir: 'desc' }} exportName="competitor-top-pages" searchPlaceholder="Search pages or keywords" label="pages" empty="No pages yet. Analyze a competitor on the Competitors tab: the pages its keywords rank with appear here." />;
}

export { hostOf };
