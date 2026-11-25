import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Check, CheckCircle2, ExternalLink, Eye, Layers, Loader2, MapPin, MoreHorizontal, Plus, Search, Trash2, Users, X } from 'lucide-react';
import { Button, Badge, ErrorNote, Modal, useToast } from './SeoUi';
import { usePager, Pager, downloadCsv } from './DataTable';
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
export function CompetitorsPanel({ b, auto, rows, scope, setScope, nearCount, allCount, radius, placeName, isChosen, metrics, reload, onChoose, onRemove, onAdd, onDetail, onKeywords, addBusy, addError, onFindMaps, findBusy }) {
  const [toast, toastNode] = useToast();
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState('');
  const [sortBy, setSortBy] = useState('match');
  const [sel, setSel] = useState(() => new Set());
  const [running, setRunning] = useState({}); // host -> 'running' | 'failed'
  const [menu, setMenu] = useState(null);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const box = useRef(null);

  useEffect(() => {
    if (menu == null) return undefined;
    const on = (e) => { if (!e.target.closest?.('[data-menu]')) setMenu(null); };
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, [menu]);

  const queue = auto?.prog?.queue || [];
  const failedBy = auto?.prog?.failed || {};
  const st = (c) => running[c.host] || (auto?.prog?.running && auto.prog.current === c.host ? 'running' : auto?.prog?.running && queue.includes(c.host) ? 'queued' : metrics[c.host]?.status || 'pending');
  const m = (c) => metrics[c.host] || {};
  const value = {
    match: (c) => c.maps?.relevance?.score ?? -1, da: (c) => m(c).da ?? -1, keywords: (c) => m(c).keywords ?? -1, traffic: (c) => m(c).traffic ?? -1,
    distance: (c) => (c.maps?.distance_m == null ? 1e9 : -c.maps.distance_m), name: (c) => c.name.toLowerCase(),
  };
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const f = rows.filter(c => (!needle || `${c.name} ${c.host}`.toLowerCase().includes(needle)) && (!statusF || (statusF === 'chosen' ? isChosen(c) : statusF === 'notchosen' ? !isChosen(c) : st(c) === statusF)));
    const v = value[sortBy];
    return [...f].sort((a, c2) => (sortBy === 'name' ? v(a).localeCompare(v(c2)) : v(c2) - v(a)));
  }, [rows, q, statusF, sortBy, metrics, running]); // eslint-disable-line react-hooks/exhaustive-deps
  const pager = usePager(shown, { size: 10, resetKey: `${q}|${statusF}|${sortBy}|${scope}` });
  const toggle = (h) => setSel(s => { const n = new Set(s); n.has(h) ? n.delete(h) : n.add(h); return n; });
  const pageAll = pager.rows.length > 0 && pager.rows.every(c => sel.has(c.key));
  const picked = rows.filter(c => sel.has(c.key));

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
  const exportCsv = () => downloadCsv('competitors', ['Competitor', 'Domain', 'Location', 'Distance (m)', 'Match score', 'Domain Authority', 'Organic keywords', 'Organic traffic (est.)', 'Referring domains', 'Selected', 'Status'],
    shown.map(c => [c.name, c.host, c.maps?.address || '', c.maps?.distance_m ?? '', c.maps?.relevance?.score ?? '', m(c).da ?? '', m(c).keywords ?? '', m(c).traffic ?? '', m(c).rd ?? '', isChosen(c) ? 'yes' : 'no', STATUS[st(c)]?.[0] || st(c)]));
  const city = (c) => (c.maps?.address || '').split(',').slice(-3, -1).map(x => x.trim()).filter(Boolean).join(', ') || (c.maps?.address || '').split(',')[0];

  return (
    <div className="space-y-3" ref={box}>
      <div className="rounded-xl bg-white ring-1 ring-slate-200">
        <div className="px-4 py-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px] max-w-md"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search competitor by name or domain…" aria-label="Search competitors" className="h-10 w-full rounded-lg ring-1 ring-inset ring-slate-300 pl-9 pr-8 text-13 focus:ring-2 focus:ring-indigo-500 outline-none" />{q && <button type="button" aria-label="Clear" onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 cursor-pointer"><X size={13} /></button>}</div>
          <div className="inline-flex rounded-lg ring-1 ring-inset ring-slate-300 overflow-hidden" role="group" aria-label="Where">
            {[['near', `Within ${radius >= 1000 ? `${Math.round(radius / 100) / 10} km` : `${radius} m`} of ${placeName || 'the place'} (${nearCount})`], ['all', `Everywhere (${allCount})`]].map(([k, l]) => <button key={k} type="button" aria-pressed={scope === k} onClick={() => setScope(k)} className={`h-10 px-3 text-12.5 font-medium cursor-pointer ${scope === k ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Select value={statusF} onChange={e => setStatusF(e.target.value)} aria-label="Status" className="h-10 w-40 rounded-lg ring-1 ring-inset ring-slate-300 bg-white px-3 text-13 text-left"><option value="">All status</option><option value="analyzed">Analyzed</option><option value="partial">Partly read</option><option value="pending">Pending</option><option value="chosen">Selected</option><option value="notchosen">Not selected</option></Select>
            <Select value={sortBy} onChange={e => setSortBy(e.target.value)} aria-label="Sort by" className="h-10 w-52 rounded-lg ring-1 ring-inset ring-slate-300 bg-white px-3 text-13 text-left">{[['match', 'Sort by: Match score'], ['da', 'Sort by: Domain Authority'], ['keywords', 'Sort by: Organic keywords'], ['traffic', 'Sort by: Organic traffic'], ['distance', 'Sort by: Distance'], ['name', 'Sort by: Name']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
            <Button icon={MapPin} busy={findBusy} onClick={onFindMaps} title="Find more competitors on Google Maps around the place">Find more</Button>
            <Button icon={Plus} variant="primary" onClick={() => setAdding(a => !a)} aria-expanded={adding}>Add competitor</Button>
            <Button icon={BarChartIcon} disabled={!shown.length} onClick={exportCsv}>Export</Button>
          </div>
        </div>
        {adding && (
          <form onSubmit={submitAdd} className="px-4 pb-3 flex flex-wrap items-center gap-2">
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="Website or domain, e.g. competitor.com" aria-label="Competitor website" className="h-10 flex-1 min-w-[220px] rounded-lg ring-1 ring-inset ring-slate-300 px-3 text-13 focus:ring-2 focus:ring-indigo-500 outline-none" />
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Name (optional)" aria-label="Competitor name" className="h-10 w-52 rounded-lg ring-1 ring-inset ring-slate-300 px-3 text-13 focus:ring-2 focus:ring-indigo-500 outline-none" />
            <Button type="submit" variant="primary" busy={addBusy} disabled={url.trim().length < 3}>Add</Button>
            <Button type="button" onClick={() => setAdding(false)}>Cancel</Button>
            {addError && <div className="w-full"><ErrorNote>{addError}</ErrorNote></div>}
          </form>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-13">
            <thead className="bg-slate-50 text-12.5 text-slate-700 border-y border-slate-200">
              <tr>
                <th className="pl-4 py-3 w-10"><input type="checkbox" aria-label="Select this page" checked={pageAll} onChange={e => setSel(s => { const n = new Set(s); pager.rows.forEach(c => (e.target.checked ? n.add(c.key) : n.delete(c.key))); return n; })} className="accent-indigo-600" /></th>
                <th className="px-2 py-3 text-left font-semibold w-8">#</th><th className="px-3 py-3 text-left font-semibold">Competitor name</th><th className="px-3 py-3 text-left font-semibold">Domain</th><th className="px-3 py-3 text-left font-semibold">Location</th>
                <th className="px-3 py-3 text-center font-semibold" title="Domain Authority (Moz)">DA</th><th className="px-3 py-3 text-right font-semibold" title="Keywords it ranks for in a ranked-keywords read">Organic keywords</th><th className="px-3 py-3 text-right font-semibold" title="Estimated organic visits a month from those keywords">Organic traffic</th><th className="px-3 py-3 text-right font-semibold" title="Websites linking to it (Moz)">Ref. domains</th>
                <th className="px-3 py-3 text-left font-semibold">Match</th><th className="px-3 py-3 text-left font-semibold">Status</th><th className="px-3 py-3 text-right font-semibold pr-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pager.rows.map((c, i) => {
                const s = st(c), x = m(c), [sl, tone] = STATUS[s] || STATUS.pending;
                return (
                  <tr key={c.key} className={sel.has(c.key) ? 'bg-indigo-50/50' : isChosen(c) ? 'bg-emerald-50/30 hover:bg-emerald-50/60' : 'hover:bg-slate-50'}>
                    <td className="pl-4 py-3"><input type="checkbox" aria-label={`Select ${c.name}`} checked={sel.has(c.key)} onChange={() => toggle(c.key)} className="accent-indigo-600" /></td>
                    <td className="px-2 py-3 tabular-nums text-slate-500">{(pager.page - 1) * pager.size + i + 1}</td>
                    <td className="px-3 py-3 min-w-[210px]"><button type="button" onClick={() => onDetail(c)} className="flex items-center gap-2.5 text-left cursor-pointer group max-w-[280px]"><Logo host={c.host} name={c.name} /><span className="min-w-0"><span className="block font-semibold text-slate-900 group-hover:text-indigo-700 truncate">{c.name}</span>{isChosen(c) && <span className="text-11 font-semibold text-emerald-700">Selected</span>}</span></button></td>
                    <td className="px-3 py-3">{c.host ? <a href={`https://${c.host}`} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline inline-flex items-center gap-1">{c.host}<ExternalLink size={11} /></a> : <span className="text-slate-300">no website</span>}</td>
                    <td className="px-3 py-3 text-slate-600 max-w-[200px]"><span className="inline-flex items-center gap-1"><MapPin size={12} className="text-slate-400 shrink-0" /><span className="truncate" title={c.maps?.address || ''}>{city(c) || '—'}</span></span>{c.maps?.distance_m != null && <span className="block text-11.5 text-slate-400">{c.maps.distance_m < 1000 ? `${c.maps.distance_m} m` : `${(c.maps.distance_m / 1000).toFixed(1)} km`} away</span>}</td>
                    <td className="px-3 py-3 text-center"><span className={`inline-flex items-center justify-center min-w-[34px] h-7 px-2 rounded-md text-13 font-bold ${daTone(x.da)}`}>{x.da ?? '—'}</span></td>
                    <td className="px-3 py-3 text-right tabular-nums">{num(x.keywords)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{kfmt(x.traffic)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{kfmt(x.rd)}</td>
                    <td className="px-3 py-3">{c.maps?.relevance ? <span className="inline-flex items-center gap-1.5" title={c.maps.relevance.label_text}><span className="font-semibold tabular-nums">{c.maps.relevance.score}</span><span className={`w-2 h-2 rounded-full ${c.maps.relevance.label === 'direct' ? 'bg-emerald-500' : c.maps.relevance.label === 'related' ? 'bg-amber-400' : 'bg-slate-300'}`} /></span> : <span className="text-slate-300">—</span>}</td>
                    <td className="px-3 py-3 whitespace-nowrap" title={failedBy[c.host] || undefined}><Badge tone={failedBy[c.host] && s !== 'analyzed' ? 'amber' : tone}>{s === 'running' && <Loader2 size={11} className="animate-spin" />}{sl}</Badge></td>
                    <td className="px-3 py-3 pr-4 text-right whitespace-nowrap relative" data-menu>
                      <button type="button" aria-label={`View ${c.name}`} title="View its profile" onClick={() => onDetail(c)} className="p-1.5 text-slate-500 hover:text-indigo-700 cursor-pointer"><Eye size={16} /></button>
                      <button type="button" aria-label={`More actions for ${c.name}`} aria-expanded={menu === c.key} onClick={() => setMenu(menu === c.key ? null : c.key)} className="p-1.5 text-slate-500 hover:text-slate-900 cursor-pointer"><MoreHorizontal size={16} /></button>
                      {menu === c.key && (
                        <div role="menu" className="absolute right-3 top-full z-20 mt-0.5 w-52 rounded-lg bg-white shadow-lg ring-1 ring-slate-200 py-1 text-left">
                          <button role="menuitem" type="button" disabled={!c.host || s === 'running'} onClick={() => { setMenu(null); analyze([c]); }} className="block w-full text-left px-3 py-2 text-13 hover:bg-slate-50 disabled:text-slate-300 cursor-pointer">Analyze now</button>
                          <button role="menuitem" type="button" onClick={() => { setMenu(null); onKeywords(c); }} className="block w-full text-left px-3 py-2 text-13 hover:bg-slate-50 cursor-pointer">Its keywords</button>
                          <button role="menuitem" type="button" onClick={() => { setMenu(null); choose([c], !isChosen(c)); }} className="block w-full text-left px-3 py-2 text-13 hover:bg-slate-50 cursor-pointer">{isChosen(c) ? 'Remove from selected' : 'Select it'}</button>
                          {c.host && <a role="menuitem" href={`https://${c.host}`} target="_blank" rel="noreferrer" onClick={() => setMenu(null)} className="block px-3 py-2 text-13 hover:bg-slate-50">Open website</a>}
                          {c.reg && <button role="menuitem" type="button" onClick={() => { setMenu(null); onRemove(c.reg); }} className="block w-full text-left px-3 py-2 text-13 text-rose-700 hover:bg-rose-50 cursor-pointer">Remove competitor</button>}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!pager.rows.length && <tr><td colSpan={12} className="px-5 py-12 text-center text-13 text-slate-500">{rows.length ? 'No competitor matches these filters.' : scope === 'near' ? `No competitor found within ${radius >= 1000 ? `${radius / 1000} km` : `${radius} m`} of ${placeName || 'this place'}. Try “Everywhere”, a larger distance or Find more.` : 'No competitors yet. Find them on Google Maps or add one by its website.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center px-4 py-2 border-t border-slate-100"><div className="text-13 text-slate-600">Showing {shown.length ? `${(pager.page - 1) * pager.size + 1} – ${Math.min(pager.page * pager.size, shown.length)}` : 0} of {shown.length} competitors</div><div className="ml-auto"><Pager p={pager} label="competitors" /></div></div>
      </div>

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
  const n = unread(analysis, rows);
  return (
    <div className="space-y-4">
      {n > 0 && <div className="rounded-lg bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-12.5 text-amber-900">{n} competitor{n === 1 ? ' has' : 's have'} not been analyzed yet, so {n === 1 ? 'its' : 'their'} traffic is “not read”. Select them on the Competitors tab and press Analyze selected.</div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Estimated organic traffic" sub="Visits a month from the keywords each competitor ranks for (an estimate from its ranked-keywords read). Yours is Google clicks in the last 28 days from Search Console."><Bars rows={mk('traffic')} /></Panel>
        <Panel title="Organic keywords" sub="How many keywords each one ranks for (yours: your tracked keywords that rank)."><Bars rows={mk('keywords')} fmt={num} color="#0ea5e9" /></Panel>
        <Panel title="Keywords in the top 3" sub="Keywords where it holds one of the first three positions."><Bars rows={mk('top3')} fmt={num} color="#10b981" /></Panel>
        <Panel title="Keywords in the top 10" sub="Keywords on page 1 of Google."><Bars rows={mk('top10')} fmt={num} color="#f59e0b" /></Panel>
      </div>
    </div>
  );
}

export function BacklinkTab({ rows, analysis }) {
  const own = analysis.own;
  const data = [...(own ? [{ host: own.domain, name: own.domain, you: true, ...own }] : []), ...rows.filter(c => c.host).map(c => ({ host: c.host, name: c.name, ...(analysis.metrics[c.host] || {}) }))];
  const bar = (key) => data.map(r => ({ host: r.host, name: r.name, you: r.you, v: r[key] ?? null })).sort((a, c) => (c.v ?? -1) - (a.v ?? -1));
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Domain Authority" sub="How strong each site is, 0 to 100 (Moz, through Apify)."><Bars rows={bar('da')} fmt={num} color="#8b5cf6" /></Panel>
        <Panel title="Referring domains" sub="How many different websites link to each site (Moz)."><Bars rows={bar('rd')} fmt={num} color="#6366f1" /></Panel>
      </div>
      <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-x-auto">
        <table className="w-full text-13"><thead className="bg-slate-50 text-12.5 text-slate-600"><tr><th className="px-4 py-2.5 text-left font-semibold">Site</th><th className="px-3 py-2.5 text-center font-semibold">DA</th><th className="px-3 py-2.5 text-center font-semibold">Page Authority</th><th className="px-3 py-2.5 text-right font-semibold">Referring domains</th><th className="px-3 py-2.5 text-center font-semibold">Spam score</th><th className="px-3 py-2.5 text-left font-semibold">Read</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{data.map(r => <tr key={r.host} className={r.you ? 'bg-emerald-50/50' : ''}><td className="px-4 py-2.5 font-medium">{r.host}{r.you && <span className="ml-2 text-11 font-semibold text-emerald-700">You</span>}</td><td className="px-3 py-2.5 text-center"><span className={`inline-flex min-w-[34px] h-6 items-center justify-center rounded-md px-2 font-bold ${daTone(r.da)}`}>{r.da ?? '—'}</span></td><td className="px-3 py-2.5 text-center tabular-nums">{r.pa ?? '—'}</td><td className="px-3 py-2.5 text-right tabular-nums">{num(r.rd)}</td><td className="px-3 py-2.5 text-center tabular-nums">{r.spam == null ? '—' : `${r.spam}%`}</td><td className="px-3 py-2.5 text-12 text-slate-500">{r.site_read_at ? new Date(r.site_read_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'not read'}</td></tr>)}</tbody></table>
      </div>
      <p className="text-12 text-slate-500">The links themselves, the sites that link to a competitor and not to you, are on the <Link className="text-indigo-600 underline" to="/backlinks/overview">Backlinks</Link> page (Compare).</p>
    </div>
  );
}

export function TopPagesTab({ b, rows }) {
  const [list, setList] = useState(null);
  const [dom, setDom] = useState('');
  const domains = rows.map(c => c.host).filter(Boolean);
  useEffect(() => { let on = true; api(`/businesses/${b.id}/keyword-workspace/competitor-analysis/pages`, { method: 'POST', body: { domains } }).then(r => on && setList(r.pages)).catch(() => on && setList([])); return () => { on = false; }; }, [b.id, domains.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = (list || []).filter(p => !dom || p.domain === dom);
  const pager = usePager(shown, { size: 20, resetKey: dom });
  if (!list) return <div className="flex items-center justify-center gap-2 py-14 text-13 text-slate-500"><Loader2 size={16} className="animate-spin" />Loading…</div>;
  return (
    <div className="rounded-xl bg-white ring-1 ring-slate-200">
      <div className="px-4 pt-4 flex flex-wrap items-center gap-3"><div><h3 className="text-15 font-semibold text-slate-900">Top pages</h3><p className="text-12.5 text-slate-500">The pages that bring each competitor its organic traffic, from its ranked-keywords read.</p></div>
        <Select value={dom} onChange={e => setDom(e.target.value)} aria-label="Competitor" className="ml-auto h-9 w-52 rounded-lg ring-1 ring-inset ring-slate-300 bg-white px-3 text-13 text-left"><option value="">All competitors</option>{[...new Set(list.map(p => p.domain))].map(d => <option key={d} value={d}>{d}</option>)}</Select>
        <Button icon={BarChartIcon} disabled={!shown.length} onClick={() => downloadCsv('competitor-top-pages', ['Competitor', 'Page', 'Keywords', 'Est. traffic', 'Best position', 'Top keyword'], shown.map(p => [p.domain, p.url, p.keywords, p.traffic, p.best ?? '', p.top_keyword || '']))}>Export</Button></div>
      <div className="overflow-x-auto mt-3"><table className="w-full text-13"><thead className="bg-slate-50 text-12.5 text-slate-600"><tr><th className="px-4 py-2.5 text-left font-semibold">Page</th><th className="px-3 py-2.5 text-left font-semibold">Competitor</th><th className="px-3 py-2.5 text-right font-semibold">Keywords</th><th className="px-3 py-2.5 text-right font-semibold">Est. traffic</th><th className="px-3 py-2.5 text-right font-semibold">Best position</th><th className="px-3 py-2.5 text-left font-semibold">Top keyword</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{pager.rows.map(p => <tr key={p.url}><td className="px-4 py-2.5 max-w-[360px]"><a href={p.url} target="_blank" rel="noreferrer" title={p.url} className="text-blue-700 hover:underline inline-flex items-center gap-1 max-w-full"><span className="truncate">{p.url.replace(/^https?:\/\/(www\.)?/, '')}</span><ExternalLink size={11} className="shrink-0" /></a></td><td className="px-3 py-2.5 text-slate-600">{p.domain}</td><td className="px-3 py-2.5 text-right tabular-nums">{num(p.keywords)}</td><td className="px-3 py-2.5 text-right tabular-nums">{kfmt(p.traffic)}</td><td className="px-3 py-2.5 text-right tabular-nums">#{p.best ?? '—'}</td><td className="px-3 py-2.5 text-slate-700">{p.top_keyword || '—'}</td></tr>)}
          {!pager.rows.length && <tr><td colSpan={6} className="px-4 py-12 text-center text-13 text-slate-500">No pages yet. Analyze a competitor on the Competitors tab: the pages its keywords rank with appear here.</td></tr>}</tbody></table></div>
      <div className="border-t border-slate-100"><Pager p={pager} label="pages" /></div>
    </div>
  );
}

export { hostOf };
