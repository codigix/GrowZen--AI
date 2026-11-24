import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowLeft, ArrowUp, ChevronDown, Download, Loader2, Plus, Search, X } from 'lucide-react';
import { SeoShell, Card, Button, ErrorNote, useAction, useToast } from './SeoUi';
import { usePager, Pager, downloadCsv } from './DataTable';
import { api, fmt } from './seoApi';

const INTENT = { informational: ['I', '#4338ca', '#e0e7ff', 'Informational'], commercial: ['C', '#b45309', '#fef3c7', 'Commercial'], transactional: ['T', '#047857', '#d1fae5', 'Transactional'], navigational: ['N', '#7e22ce', '#f3e8ff', 'Navigational'], local: ['L', '#0369a1', '#e0f2fe', 'Local'] };
const QUESTION = /^(what|how|why|when|where|which|who|can|does|do|is|are|should|will)\b/;
const NOISE = new Set(['a', 'an', 'the', 'and', 'for', 'to', 'of', 'in', 'on', 'at', 'with', 'is', 'are', 'my', 'me', 'you', 'your', 'how', 'what', 'near']);
const kfmt = (n) => (n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K` : Number(n).toLocaleString('en-US'));
const INR = (v) => (v == null ? '—' : `₹${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
const idxColor = (v) => (v < 34 ? '#059669' : v < 67 ? '#d97706' : '#dc2626');
const kdColor = (v) => (v < 15 ? '#059669' : v < 30 ? '#65a30d' : v < 50 ? '#d97706' : v < 70 ? '#ea580c' : '#dc2626');

/** A filter as a pill: grey while it is off, indigo with its choice once it is on. The real <select> sits invisibly over it, so it works with the keyboard and on a phone. */
function Pill({ label, value, onChange, options }) {
  const on = value !== '';
  const cur = options.find(o => o[0] === value);
  return (
    <label className={`relative inline-flex items-center h-8 rounded-full text-12.5 font-medium cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-indigo-400 ${on ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50'}`}>
      <span className="pl-3 pointer-events-none">{label}{on ? ':' : ''}</span>
      <span className="pl-1 pr-7 pointer-events-none font-semibold">{on ? (cur?.[2] || cur?.[1]) : ''}</span>
      <ChevronDown size={13} className="absolute right-2.5 pointer-events-none opacity-70" />
      <select aria-label={label} value={value} onChange={e => onChange(e.target.value)} className="absolute inset-0 w-full opacity-0 cursor-pointer">
        <option value="">Any</option>{options.map(o => <option key={o[0]} value={o[0]}>{o[1]}</option>)}
      </select>
    </label>
  );
}

function Seg({ value, onChange, options }) {
  return (
    <div className="inline-flex rounded-lg ring-1 ring-inset ring-slate-300 overflow-hidden bg-white" role="tablist">
      {options.map(([k, l], n) => <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)} className={`px-3.5 h-8 text-12.5 font-medium cursor-pointer transition-colors ${n ? 'border-l border-slate-200' : ''} ${value === k ? 'bg-indigo-600 text-white' : 'text-slate-700 hover:bg-slate-50'}`}>{l}</button>)}
    </div>
  );
}

function Stat({ label, value, sub }) {
  return <div className="rounded-xl bg-white ring-1 ring-slate-200 px-4 py-3"><div className="text-12 text-slate-500">{label}</div><div className="text-24 font-bold tabular-nums text-slate-900 leading-tight">{value}</div>{sub && <div className="text-11.5 text-slate-500 mt-0.5">{sub}</div>}</div>;
}

function Body({ b }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const keyword = (params.get('q') || '').trim();
  const view = params.get('view') || 'all';
  const country = params.get('c') || '';
  const areas = (params.get('a') || '').split('|').filter(Boolean);
  const [typed, setTyped] = useState(keyword);
  const [data, setData] = useState(null); // { state, ...overview }
  const [type, setType] = useState(view === 'questions' ? 'questions' : 'all');
  const [match, setMatch] = useState(view === 'related' ? 'related' : view === 'similar' ? 'broad' : 'all');
  const [minVol, setMinVol] = useState('');
  const [idx, setIdx] = useState('');
  const [intent, setIntent] = useState('');
  const [minCpc, setMinCpc] = useState('');
  const [inc, setInc] = useState('');
  const [exc, setExc] = useState('');
  const [word, setWord] = useState('');
  const [wordBy, setWordBy] = useState('number');
  const [sort, setSort] = useState({ key: 'volume', dir: 'desc' });
  const [sel, setSel] = useState(() => new Set());
  const [kdMap, setKdMap] = useState({});
  const [busy, , run] = useAction();
  const [toast, toastNode] = useToast();
  const mine = useRef(0);
  useEffect(() => setTyped(keyword), [keyword]);
  useEffect(() => { setType(view === 'questions' ? 'questions' : 'all'); setMatch(view === 'related' ? 'related' : view === 'similar' ? 'broad' : 'all'); }, [view, keyword]);

  useEffect(() => {
    if (keyword.length < 2) return undefined;
    const run_ = ++mine.current;
    setData({ state: 'loading' }); setKdMap({}); setSel(new Set()); setWord('');
    api(`/businesses/${b.id}/seo/keyword-overview`, { method: 'POST', body: { keyword, country: country || null, places: areas, lite: true }, timeout: 180000 })
      .then(r => { if (mine.current === run_) setData({ state: 'ready', ...r }); }).catch(e => { if (mine.current === run_) setData({ state: 'error', message: e.message }); });
    return () => { mine.current += 1; };
  }, [keyword, country, params.get('a')]); // eslint-disable-line react-hooks/exhaustive-deps

  const seed = data?.keyword || keyword;
  const seedWords = useMemo(() => seed.split(/\s+/).filter(Boolean), [seed]);
  const everything = useMemo(() => { const m = new Map(); for (const k of ['similar', 'related', 'questions']) for (const r of data?.groups?.[k]?.all || []) if (!m.has(r.keyword)) m.set(r.keyword, r); return [...m.values()]; }, [data]);
  const hasAll = (k) => seedWords.every(w => k.split(/\s+/).includes(w));
  const base = useMemo(() => everything.filter(r => (type === 'all' || QUESTION.test(r.keyword)) && (match === 'all' ? true : match === 'broad' ? hasAll(r.keyword) : match === 'phrase' ? r.keyword.includes(seed) : match === 'exact' ? r.keyword === seed : !hasAll(r.keyword))), [everything, type, match, seed]); // eslint-disable-line react-hooks/exhaustive-deps
  const words = useMemo(() => {
    const m = {};
    for (const r of base) for (const w of new Set(r.keyword.split(/\s+/))) if (w.length > 2 && !seedWords.includes(w) && !NOISE.has(w)) { const x = (m[w] ||= { w, n: 0, v: 0 }); x.n += 1; x.v += r.volume || 0; }
    return Object.values(m).sort((a, c) => (wordBy === 'number' ? c.n - a.n : c.v - a.v)).slice(0, 60);
  }, [base, seedWords, wordBy]);
  const filtered = useMemo(() => base.filter(r => (!minVol || (r.volume || 0) >= Number(minVol)) && (!idx || (r.index != null && (idx === 'low' ? r.index < 34 : idx === 'medium' ? r.index >= 34 && r.index < 67 : r.index >= 67)))
    && (!intent || r.intent === intent) && (!minCpc || (r.cpc || 0) >= Number(minCpc)) && (!word || r.keyword.split(/\s+/).includes(word))
    && (!inc.trim() || inc.toLowerCase().split(/[,\s]+/).filter(Boolean).every(w => r.keyword.includes(w))) && (!exc.trim() || !exc.toLowerCase().split(/[,\s]+/).filter(Boolean).some(w => r.keyword.includes(w)))), [base, minVol, idx, intent, minCpc, word, inc, exc]);
  const rows = useMemo(() => {
    const v = (r) => (sort.key === 'keyword' ? r.keyword : sort.key === 'kd' ? (typeof kdMap[r.keyword] === 'number' ? kdMap[r.keyword] : null) : r[sort.key]);
    return [...filtered].sort((a, c) => { const x = v(a), y = v(c); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; const o = typeof x === 'string' ? x.localeCompare(y) : x - y; return sort.dir === 'asc' ? o : -o; });
  }, [filtered, sort, kdMap]);
  const pager = usePager(rows, { size: 50, resetKey: `${type}|${match}|${minVol}|${idx}|${intent}|${minCpc}|${inc}|${exc}|${word}|${sort.key}|${sort.dir}|${seed}` });
  const total = filtered.reduce((a, r) => a + (r.volume || 0), 0);
  const avgIdx = (() => { const l = filtered.filter(r => r.index != null); return l.length ? Math.round(l.reduce((a, r) => a + r.index, 0) / l.length) : null; })();
  const topVol = Math.max(1, ...pager.rows.map(r => r.volume || 0));
  const anyFilter = minVol || idx || intent || minCpc || inc || exc || word;
  const back = `/keyword-overview?q=${encodeURIComponent(seed)}${country ? '' : ''}`;
  const sortBy = (k, first = 'desc') => setSort(s => ({ key: k, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : first }));
  const Sorter = ({ id, children, right, first }) => <th className={`px-3 py-2.5 font-medium ${right ? 'text-right' : 'text-left'}`} aria-sort={sort.key === id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}><button type="button" onClick={() => sortBy(id, first)} className="inline-flex items-center gap-1 cursor-pointer hover:text-slate-900">{children}{sort.key === id && (sort.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}</button></th>;

  const askKd = async (k) => {
    setKdMap(m => ({ ...m, [k]: 'loading' }));
    try { const r = await api(`/businesses/${b.id}/seo/keyword-difficulty/batch`, { method: 'POST', body: { keywords: [k], country: data?.country || null, places: areas }, timeout: 240000 }); setKdMap(m => ({ ...m, [k]: r.results?.[0]?.score ?? null })); } catch { setKdMap(m => ({ ...m, [k]: null })); }
  };
  const addToWorkspace = (list) => run('ws', async () => {
    const r = await api(`/businesses/${b.id}/keyword-workspace/add`, { method: 'POST', body: { ideas: list.slice(0, 500).map(i => ({ keyword: i.keyword, volume: i.volume, detail: `Idea for ${seed}` })), label: 'Keyword ideas' } });
    toast(r.added ? `${r.added} added to the Keyword Workspace` : 'Already in the Keyword Workspace');
  });
  const submit = () => { const k = typed.trim(); if (k.length > 1) navigate(`/keyword-overview/ideas?q=${encodeURIComponent(k)}${country ? `&c=${country}` : ''}${areas.length ? `&a=${encodeURIComponent(areas.join('|'))}` : ''}`); };
  const toggle = (k) => setSel(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const pageAll = pager.rows.length > 0 && pager.rows.every(r => sel.has(r.keyword));
  const loading = data?.state === 'loading';

  return (
    <div className="space-y-4 pb-20">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <Link to={back} className="inline-flex items-center gap-1 text-13 font-semibold text-indigo-700 hover:underline"><ArrowLeft size={14} />Keyword Overview</Link>
          <div className="flex-1 min-w-[260px] max-w-xl relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={typed} onChange={e => setTyped(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder="Enter a keyword" aria-label="Keyword" className="h-10 w-full pl-9 pr-3 text-13.5 rounded-lg ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none" /></div>
          <Button variant="primary" icon={Search} disabled={typed.trim().length < 2} onClick={submit}>Find ideas</Button>
          <span className="text-12.5 text-slate-500">{data?.place ? `Figures for ${data.place}` : data?.country ? `Figures for ${data.country}` : ''} · Google Ads Keyword Planner</span>
        </div>
      </Card>

      {keyword.length < 2 && <Card><p className="py-8 text-center text-13 text-slate-500">Enter a keyword to see every idea Google has for it.</p></Card>}
      {data?.state === 'error' && <ErrorNote>{data.message}</ErrorNote>}
      {loading && <Card><p className="py-10 text-center text-13 text-slate-500 inline-flex items-center justify-center gap-2 w-full"><Loader2 size={16} className="animate-spin" />Asking Google Keyword Planner for ideas…</p></Card>}

      {data?.state === 'ready' && (
        <>
          {data.ideas_from && <p className="text-13 text-amber-800 bg-amber-50 rounded-lg px-3 py-2">Google has no ideas for the exact keyword. The ideas are for its main words, <b>{data.ideas_from}</b>.</p>}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Keywords" value={fmt(filtered.length)} sub={anyFilter || match !== 'all' || type !== 'all' ? `of ${fmt(everything.length)} ideas` : 'every idea Google gave'} />
            <Stat label="Total volume" value={kfmt(total)} sub="searches a month" />
            <Stat label="Average index" value={avgIdx ?? '—'} sub="Google's competition index" />
            <Stat label="Questions" value={fmt(everything.filter(r => QUESTION.test(r.keyword)).length)} sub="people ask in Google" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-4 items-start">
            <aside className="rounded-xl bg-white ring-1 ring-slate-200 lg:sticky lg:top-4">
              <div className="px-4 pt-3 pb-2 border-b border-slate-100">
                <div className="text-13 font-semibold text-slate-900">Words in the ideas</div>
                <div className="mt-2 inline-flex rounded-lg ring-1 ring-inset ring-slate-300 overflow-hidden">{[['number', 'By number'], ['volume', 'By volume']].map(([k, l], n) => <button key={k} type="button" onClick={() => setWordBy(k)} className={`px-3 h-7 text-12 font-medium cursor-pointer ${n ? 'border-l border-slate-200' : ''} ${wordBy === k ? 'bg-indigo-600 text-white' : 'text-slate-700 hover:bg-slate-50'}`}>{l}</button>)}</div>
              </div>
              <button type="button" onClick={() => setWord('')} className={`w-full flex justify-between px-4 py-2 text-12.5 cursor-pointer ${word ? 'text-slate-600 hover:bg-slate-50' : 'bg-indigo-50 text-indigo-800 font-semibold'}`}><span>All keywords</span><span className="tabular-nums">{fmt(base.length)}</span></button>
              <ul className="max-h-[60vh] overflow-auto pb-2">{words.length === 0 ? <li className="px-4 py-3 text-12 text-slate-400">No shared words.</li> : words.map(x => (
                <li key={x.w}><button type="button" onClick={() => setWord(word === x.w ? '' : x.w)} className={`w-full flex justify-between gap-2 px-4 py-1.5 text-12.5 cursor-pointer ${word === x.w ? 'bg-indigo-50 text-indigo-800 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}><span className="truncate">{x.w}</span><span className="tabular-nums text-slate-500">{wordBy === 'number' ? fmt(x.n) : kfmt(x.v)}</span></button></li>))}</ul>
            </aside>

            <section className="min-w-0 rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden">
              <div className="px-4 py-3 space-y-3 border-b border-slate-100">
                <div className="flex flex-wrap items-center gap-3">
                  <Seg value={type} onChange={setType} options={[['all', 'All'], ['questions', 'Questions']]} />
                  <Seg value={match} onChange={setMatch} options={[['all', 'All keywords'], ['broad', 'Broad match'], ['phrase', 'Phrase match'], ['exact', 'Exact match'], ['related', 'Related']]} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Pill label="Volume" value={minVol} onChange={setMinVol} options={[['100', '100+ a month', '100+'], ['500', '500+ a month', '500+'], ['1000', '1,000+ a month', '1,000+'], ['5000', '5,000+ a month', '5,000+'], ['10000', '10,000+ a month', '10,000+']]} />
                  <Pill label="Index" value={idx} onChange={setIdx} options={[['low', 'Low (under 34)', 'Low'], ['medium', 'Medium (34 to 66)', 'Medium'], ['high', 'High (67+)', 'High']]} />
                  <Pill label="Intent" value={intent} onChange={setIntent} options={Object.entries(INTENT).map(([k, v]) => [k, v[3]])} />
                  <Pill label="CPC" value={minCpc} onChange={setMinCpc} options={[['10', '₹10+', '₹10+'], ['50', '₹50+', '₹50+'], ['100', '₹100+', '₹100+'], ['300', '₹300+', '₹300+']]} />
                  <input value={inc} onChange={e => setInc(e.target.value)} placeholder="Include words" aria-label="Include words" className="h-8 w-36 px-3 text-12.5 rounded-full ring-1 ring-inset ring-slate-300 outline-none focus:ring-2 focus:ring-indigo-400" />
                  <input value={exc} onChange={e => setExc(e.target.value)} placeholder="Exclude words" aria-label="Exclude words" className="h-8 w-36 px-3 text-12.5 rounded-full ring-1 ring-inset ring-slate-300 outline-none focus:ring-2 focus:ring-indigo-400" />
                  {anyFilter && <button type="button" onClick={() => { setMinVol(''); setIdx(''); setIntent(''); setMinCpc(''); setInc(''); setExc(''); setWord(''); }} className="text-12.5 font-semibold text-indigo-700 hover:underline inline-flex items-center gap-1 cursor-pointer"><X size={12} />Clear filters</button>}
                  <span className="ml-auto flex items-center gap-2">
                    <Button size="sm" icon={Download} disabled={!rows.length} onClick={() => downloadCsv(`keyword-ideas-${seed}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'), ['Keyword', 'Intent', 'Volume', 'Index', 'CPC'], rows.map(r => [r.keyword, r.intent, r.volume ?? '', r.index ?? '', r.cpc ?? '']))}>Export CSV</Button>
                    <Button size="sm" variant="primary" icon={Plus} busy={busy === 'ws'} disabled={!rows.length} onClick={() => addToWorkspace(sel.size ? rows.filter(r => sel.has(r.keyword)) : rows)}>{sel.size ? `Add ${sel.size} selected` : `Add all ${Math.min(rows.length, 500)}`} to the Keyword Workspace</Button>
                  </span>
                </div>
              </div>

              {rows.length === 0 ? <p className="py-14 text-center text-13 text-slate-500">No keyword matches these filters. <button type="button" onClick={() => { setMinVol(''); setIdx(''); setIntent(''); setMinCpc(''); setInc(''); setExc(''); setWord(''); setType('all'); setMatch('all'); }} className="font-semibold text-indigo-700 hover:underline cursor-pointer">Show everything</button></p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-13 min-w-[680px]">
                    <thead className="bg-slate-50 text-11.5 uppercase tracking-wide text-slate-500"><tr>
                      <th className="w-10 px-3 py-2.5"><input type="checkbox" aria-label="Select this page" checked={pageAll} onChange={() => setSel(s => { const n = new Set(s); pager.rows.forEach(r => (pageAll ? n.delete(r.keyword) : n.add(r.keyword))); return n; })} /></th>
                      <Sorter id="keyword" first="asc">Keyword</Sorter><th className="px-3 py-2.5 font-medium text-left">Intent</th>
                      <Sorter id="volume" right>Volume</Sorter><Sorter id="kd" right>KD %</Sorter><Sorter id="index" right>Index</Sorter><Sorter id="cpc" right>CPC</Sorter></tr></thead>
                    <tbody className="divide-y divide-slate-100">{pager.rows.map(r => {
                      const l = INTENT[r.intent];
                      const kd = kdMap[r.keyword];
                      return (
                        <tr key={r.keyword} className={sel.has(r.keyword) ? 'bg-indigo-50/60' : 'hover:bg-slate-50'}>
                          <td className="px-3 py-2.5"><input type="checkbox" aria-label={`Select ${r.keyword}`} checked={sel.has(r.keyword)} onChange={() => toggle(r.keyword)} /></td>
                          <td className="px-3 py-2.5 max-w-[360px]"><Link to={`/keyword-overview?q=${encodeURIComponent(r.keyword)}`} className="text-indigo-700 hover:underline" title="Open its overview">{r.keyword}</Link></td>
                          <td className="px-3 py-2.5">{l ? <span className="inline-flex w-5 h-5 items-center justify-center rounded text-11 font-bold" style={{ color: l[1], backgroundColor: l[2] }} title={l[3]}>{l[0]}</span> : <span className="text-slate-300">—</span>}</td>
                          <td className="px-3 py-2.5 text-right"><div className="tabular-nums font-medium text-slate-900">{r.volume != null ? fmt(r.volume) : '—'}</div>{r.volume > 0 && <div className="mt-1 h-1 w-16 ml-auto rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-indigo-400" style={{ width: `${Math.max(4, (r.volume / topVol) * 100)}%` }} /></div>}</td>
                          <td className="px-3 py-2.5 text-right">{kd === undefined ? <button type="button" onClick={() => askKd(r.keyword)} className="text-12 font-semibold text-indigo-700 hover:underline cursor-pointer" title="Read the top 10 on Google for this keyword and work out its difficulty (about 15 seconds)">Check</button> : kd === 'loading' ? <Loader2 size={13} className="animate-spin text-slate-400 ml-auto" /> : kd == null ? <span className="text-slate-300" title="Google's results could not be read">—</span> : <span className="inline-flex items-center gap-1.5 tabular-nums">{kd}<span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: kdColor(kd) }} /></span>}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{r.index == null ? '—' : <span className="inline-flex items-center gap-1.5">{r.index}<span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: idxColor(r.index) }} /></span>}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{INR(r.cpc)}</td>
                        </tr>);
                    })}</tbody>
                  </table>
                </div>
              )}
              <div className="border-t border-slate-100"><Pager p={pager} label="keywords" /></div>
            </section>
          </div>
        </>
      )}
      {toastNode}
    </div>
  );
}

export function KeywordIdeasPage() {
  return <SeoShell title="Keyword ideas" subtitle="Every idea Google Keyword Planner has for a keyword: variations, questions and related searches, with filters and the words they share">{(b) => <Body key={b.id} b={b} />}</SeoShell>;
}
