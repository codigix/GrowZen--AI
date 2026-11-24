import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Download, History, Loader2, RefreshCw, Search, Send, Wand2, X } from 'lucide-react';
import { SeoShell, Card, Button, ErrorNote, useAction, useToast } from './SeoUi';
import { usePager, Pager, downloadCsv } from './DataTable';
import { api, useApi, fmt } from './seoApi';

const INTENT = { informational: ['I', '#4338ca', '#e0e7ff', 'Informational'], commercial: ['C', '#b45309', '#fef3c7', 'Commercial'], transactional: ['T', '#047857', '#d1fae5', 'Transactional'], navigational: ['N', '#7e22ce', '#f3e8ff', 'Navigational'], local: ['L', '#0369a1', '#e0f2fe', 'Local'] };
const QUESTION = /^(what|how|why|when|where|which|who|can|does|do|is|are|should|will)\b/;
const NOISE = new Set(['a', 'an', 'the', 'and', 'for', 'to', 'of', 'in', 'on', 'at', 'with', 'is', 'are', 'my', 'me', 'you', 'your', 'how', 'what', 'near']);
const RECENT_KEY = 'bevisibe.magic.recent';
const kfmt = (n) => (n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K` : Number(n).toLocaleString('en-US'));
const INR = (v) => (v == null ? '—' : `₹${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
const idxColor = (v) => (v < 34 ? '#059669' : v < 67 ? '#d97706' : '#dc2626');
const kdColor = (v) => (v < 15 ? '#059669' : v < 30 ? '#65a30d' : v < 50 ? '#d97706' : v < 70 ? '#ea580c' : '#dc2626');
const wordsOf = (k) => k.split(/\s+/).filter(Boolean);
const readRecent = () => { try { return JSON.parse(window.localStorage.getItem(RECENT_KEY) || '[]').filter(x => typeof x === 'string').slice(0, 8); } catch { return []; } };
const saveRecent = (k) => { try { window.localStorage.setItem(RECENT_KEY, JSON.stringify([k, ...readRecent().filter(x => x !== k)].slice(0, 8))); } catch { /* the list is a convenience: without storage it is simply not kept */ } };

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
  const countries = useApi('/discover/countries');
  const [typed, setTyped] = useState(keyword);
  const [recent, setRecent] = useState(readRecent);
  const [data, setData] = useState(null); // { state, ...overview }
  const [type, setType] = useState(view === 'questions' ? 'questions' : 'all');
  const [match, setMatch] = useState(view === 'related' ? 'related' : view === 'similar' ? 'broad' : 'all');
  const [minVol, setMinVol] = useState('');
  const [idx, setIdx] = useState('');
  const [intent, setIntent] = useState('');
  const [minCpc, setMinCpc] = useState('');
  const [wordCount, setWordCount] = useState('');
  const [inc, setInc] = useState('');
  const [exc, setExc] = useState('');
  const [word, setWord] = useState('');
  const [word2, setWord2] = useState('');
  const [open, setOpen] = useState(() => new Set());
  const [wordBy, setWordBy] = useState('number');
  const [sort, setSort] = useState({ key: 'volume', dir: 'desc' });
  const [sel, setSel] = useState(() => new Set());
  const [kdMap, setKdMap] = useState({});
  const [reload, setReload] = useState(0);
  const [busy, , run] = useAction();
  const [toast, toastNode] = useToast();
  const mine = useRef(0);
  useEffect(() => setTyped(keyword), [keyword]);
  useEffect(() => { setType(view === 'questions' ? 'questions' : 'all'); setMatch(view === 'related' ? 'related' : view === 'similar' ? 'broad' : 'all'); }, [view, keyword]);

  useEffect(() => {
    if (keyword.length < 2) return undefined;
    const token = ++mine.current;
    setData({ state: 'loading' }); setKdMap({}); setSel(new Set()); setWord(''); setWord2(''); setOpen(new Set());
    api(`/businesses/${b.id}/seo/keyword-overview`, { method: 'POST', body: { keyword, country: country || null, places: areas, lite: true }, timeout: 180000 })
      .then(r => { if (mine.current === token) { setData({ state: 'ready', ...r }); saveRecent(keyword); setRecent(readRecent()); } }).catch(e => { if (mine.current === token) setData({ state: 'error', message: e.message }); });
    return () => { mine.current += 1; };
  }, [keyword, country, params.get('a'), reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const seed = data?.keyword || keyword;
  const seedWords = useMemo(() => wordsOf(seed), [seed]);
  const everything = useMemo(() => { const m = new Map(); for (const k of ['similar', 'related', 'questions']) for (const r of data?.groups?.[k]?.all || []) if (!m.has(r.keyword)) m.set(r.keyword, r); return [...m.values()]; }, [data]);
  const hasAll = (k) => seedWords.every(w => wordsOf(k).includes(w));
  const base = useMemo(() => everything.filter(r => (type === 'all' || QUESTION.test(r.keyword)) && (match === 'all' ? true : match === 'broad' ? hasAll(r.keyword) : match === 'phrase' ? r.keyword.includes(seed) : match === 'exact' ? r.keyword === seed : !hasAll(r.keyword))), [everything, type, match, seed]); // eslint-disable-line react-hooks/exhaustive-deps
  const words = useMemo(() => {
    const m = {};
    for (const r of base) for (const w of new Set(wordsOf(r.keyword))) if (w.length > 2 && !seedWords.includes(w) && !NOISE.has(w)) { const x = (m[w] ||= { w, n: 0, v: 0 }); x.n += 1; x.v += r.volume || 0; }
    return Object.values(m).sort((a, c) => (wordBy === 'number' ? c.n - a.n : c.v - a.v)).slice(0, 60);
  }, [base, seedWords, wordBy]);
  const subWords = (w) => {
    const m = {};
    for (const r of base) { const ws = new Set(wordsOf(r.keyword)); if (!ws.has(w)) continue; for (const x of ws) if (x !== w && x.length > 2 && !seedWords.includes(x) && !NOISE.has(x)) { const e = (m[x] ||= { w: x, n: 0, v: 0 }); e.n += 1; e.v += r.volume || 0; } }
    return Object.values(m).sort((a, c) => (wordBy === 'number' ? c.n - a.n : c.v - a.v)).slice(0, 8);
  };
  const filtered = useMemo(() => base.filter(r => {
    const ws = wordsOf(r.keyword);
    const n = ws.length;
    return (!minVol || (r.volume || 0) >= Number(minVol)) && (!idx || (r.index != null && (idx === 'low' ? r.index < 34 : idx === 'medium' ? r.index >= 34 && r.index < 67 : r.index >= 67)))
      && (!intent || r.intent === intent) && (!minCpc || (r.cpc || 0) >= Number(minCpc)) && (!word || ws.includes(word)) && (!word2 || ws.includes(word2))
      && (!wordCount || (wordCount === 'short' ? n <= 2 : wordCount === 'mid' ? n >= 3 && n <= 4 : n >= 5))
      && (!inc.trim() || inc.toLowerCase().split(/[,\s]+/).filter(Boolean).every(x => r.keyword.includes(x))) && (!exc.trim() || !exc.toLowerCase().split(/[,\s]+/).filter(Boolean).some(x => r.keyword.includes(x)));
  }), [base, minVol, idx, intent, minCpc, word, word2, wordCount, inc, exc]);
  const rows = useMemo(() => {
    const v = (r) => (sort.key === 'keyword' ? r.keyword : sort.key === 'kd' ? (typeof kdMap[r.keyword] === 'number' ? kdMap[r.keyword] : null) : r[sort.key]);
    return [...filtered].sort((a, c) => { const x = v(a), y = v(c); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; const o = typeof x === 'string' ? x.localeCompare(y) : x - y; return sort.dir === 'asc' ? o : -o; });
  }, [filtered, sort, kdMap]);
  const pager = usePager(rows, { size: 50, resetKey: `${type}|${match}|${minVol}|${idx}|${intent}|${minCpc}|${wordCount}|${inc}|${exc}|${word}|${word2}|${sort.key}|${sort.dir}|${seed}` });
  const total = filtered.reduce((a, r) => a + (r.volume || 0), 0);
  const avgIdx = (() => { const l = filtered.filter(r => r.index != null); return l.length ? Math.round(l.reduce((a, r) => a + r.index, 0) / l.length) : null; })();
  const kdKnown = filtered.map(r => kdMap[r.keyword]).filter(v => typeof v === 'number');
  const topVol = Math.max(1, ...pager.rows.map(r => r.volume || 0));
  const anyFilter = minVol || idx || intent || minCpc || wordCount || inc || exc || word;
  const clearAll = () => { setMinVol(''); setIdx(''); setIntent(''); setMinCpc(''); setWordCount(''); setInc(''); setExc(''); setWord(''); setWord2(''); };
  const sortBy = (k, first = 'desc') => setSort(s => ({ key: k, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : first }));
  const Sorter = ({ id, children, right, first }) => <th className={`px-3 py-2.5 font-medium ${right ? 'text-right' : 'text-left'}`} aria-sort={sort.key === id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}><button type="button" onClick={() => sortBy(id, first)} className="inline-flex items-center gap-1 cursor-pointer hover:text-slate-900">{children}{sort.key === id && (sort.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}</button></th>;

  const askKd = async (k) => {
    setKdMap(m => ({ ...m, [k]: 'loading' }));
    try { const r = await api(`/businesses/${b.id}/seo/keyword-difficulty/batch`, { method: 'POST', body: { keywords: [k], country: data?.country || null, places: areas }, timeout: 240000 }); setKdMap(m => ({ ...m, [k]: r.results?.[0]?.score ?? null })); } catch { setKdMap(m => ({ ...m, [k]: null })); }
  };
  const askShown = async () => { const todo = pager.rows.filter(r => kdMap[r.keyword] === undefined).slice(0, 10).map(r => r.keyword); for (let n = 0; n < todo.length; n += 3) await Promise.all(todo.slice(n, n + 3).map(askKd)); };
  const sendKeywords = (list) => run('ws', async () => {
    const r = await api(`/businesses/${b.id}/keyword-workspace/add`, { method: 'POST', body: { ideas: list.slice(0, 500).map(i => ({ keyword: i.keyword, volume: i.volume, detail: `Keyword Magic Tool: ${seed}` })), label: 'Keyword Magic Tool' } });
    toast(r.added ? `${r.added} keyword${r.added === 1 ? '' : 's'} sent to the Keyword Workspace` : 'Already in the Keyword Workspace');
  });
  const goTo = (k, c = country) => { const q = k.trim(); if (q.length > 1) navigate(`/keyword-management/magic?q=${encodeURIComponent(q)}${c ? `&c=${c}` : ''}${areas.length && c === country ? `&a=${encodeURIComponent(areas.join('|'))}` : ''}`); };
  const toggle = (k) => setSel(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggleOpen = (w) => setOpen(s => { const n = new Set(s); n.has(w) ? n.delete(w) : n.add(w); return n; });
  const pageAll = pager.rows.length > 0 && pager.rows.every(r => sel.has(r.keyword));
  const loading = data?.state === 'loading';
  const countryName = (countries.data || []).find(c => c.code === (data?.country || country))?.name || data?.country || country || 'your country';

  return (
    <div className="space-y-4 pb-20">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[260px] max-w-2xl relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={typed} onChange={e => setTyped(e.target.value)} onKeyDown={e => e.key === 'Enter' && goTo(typed)} placeholder="Enter a keyword, e.g. digital marketing" aria-label="Keyword" className="h-10 w-full pl-9 pr-9 text-13.5 rounded-lg ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none" />
            {typed && <button type="button" onClick={() => setTyped('')} aria-label="Clear" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 cursor-pointer"><X size={14} /></button>}</div>
          <Button variant="primary" icon={Wand2} disabled={typed.trim().length < 2} onClick={() => goTo(typed)}>Find keywords</Button>
          <label className="text-12.5 font-medium text-slate-500 flex items-center gap-1.5">Database
            <select value={data?.country || country || ''} onChange={e => goTo(keyword || typed, e.target.value)} className="h-10 rounded-lg ring-1 ring-inset ring-slate-300 bg-white px-2 text-13 text-slate-800" aria-label="Database (country)">{!(data?.country || country) && <option value="">Your country</option>}{(countries.data || []).map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
          <span className="text-12.5 text-slate-500">Currency: <b className="text-slate-700">INR</b></span>
        </div>
        {recent.length > 0 && <div className="mt-2.5 flex flex-wrap items-center gap-1.5"><span className="inline-flex items-center gap-1 text-12 font-medium text-slate-500"><History size={13} />Recent</span>{recent.map(k => <button key={k} type="button" onClick={() => goTo(k)} className="rounded-full bg-slate-100 hover:bg-indigo-50 px-2.5 py-0.5 text-12 text-slate-700 cursor-pointer">{k}</button>)}</div>}
      </Card>

      {keyword.length < 2 && (
        <Card><div className="py-10 text-center max-w-xl mx-auto"><Wand2 size={28} className="mx-auto text-indigo-500" /><h3 className="mt-3 text-16 font-semibold text-slate-900">Find every keyword for a topic</h3>
          <p className="mt-1 text-13 text-slate-500">Type a keyword above. You get every idea Google Keyword Planner has for it: variations, questions and related searches, with searches a month, competition and cost per click. Narrow them with the match types, the filters and the words they share, then send the best to your Keyword Workspace.</p></div></Card>
      )}
      {data?.state === 'error' && <ErrorNote>{data.message}</ErrorNote>}
      {loading && <Card><p className="py-10 text-center text-13 text-slate-500 inline-flex items-center justify-center gap-2 w-full"><Loader2 size={16} className="animate-spin" />Asking Google Keyword Planner for ideas…</p></Card>}

      {data?.state === 'ready' && (
        <>
          <div className="flex flex-wrap items-baseline gap-x-3"><h2 className="text-20 font-semibold text-slate-900">Keyword Magic Tool: <span className="text-slate-500">{seed}</span></h2><span className="text-12.5 text-slate-500">{data.place ? `Figures for ${data.place}` : `Figures for ${countryName}`} · Google Ads Keyword Planner</span></div>
          {data.ideas_from && <p className="text-13 text-amber-800 bg-amber-50 rounded-lg px-3 py-2">Google has no ideas for the exact keyword. The ideas are for its main words, <b>{data.ideas_from}</b>.</p>}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="All keywords" value={fmt(filtered.length)} sub={anyFilter || match !== 'all' || type !== 'all' ? `of ${fmt(everything.length)} ideas` : 'every idea Google gave'} />
            <Stat label="Total volume" value={kfmt(total)} sub="searches a month" />
            <Stat label="Average" value={kdKnown.length ? `KD ${Math.round(kdKnown.reduce((a, v) => a + v, 0) / kdKnown.length)}%` : `Index ${avgIdx ?? '—'}`} sub={kdKnown.length ? `of ${kdKnown.length} keywords checked` : "Google's competition index"} />
            <Stat label="Questions" value={fmt(everything.filter(r => QUESTION.test(r.keyword)).length)} sub="people ask in Google" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[270px_minmax(0,1fr)] gap-4 items-start">
            <aside className="rounded-xl bg-white ring-1 ring-slate-200 lg:sticky lg:top-4">
              <div className="px-4 pt-3 pb-2 border-b border-slate-100">
                <div className="text-13 font-semibold text-slate-900">Groups</div>
                <div className="mt-2 inline-flex rounded-lg ring-1 ring-inset ring-slate-300 overflow-hidden">{[['number', 'By number'], ['volume', 'By volume']].map(([k, l], n) => <button key={k} type="button" onClick={() => setWordBy(k)} className={`px-3 h-7 text-12 font-medium cursor-pointer ${n ? 'border-l border-slate-200' : ''} ${wordBy === k ? 'bg-indigo-600 text-white' : 'text-slate-700 hover:bg-slate-50'}`}>{l}</button>)}</div>
              </div>
              <button type="button" onClick={() => { setWord(''); setWord2(''); }} className={`w-full flex justify-between px-4 py-2 text-12.5 cursor-pointer ${word ? 'text-slate-600 hover:bg-slate-50' : 'bg-indigo-50 text-indigo-800 font-semibold'}`}><span>All keywords</span><span className="tabular-nums">{fmt(base.length)}</span></button>
              <ul className="max-h-[62vh] overflow-auto pb-2">{words.length === 0 ? <li className="px-4 py-3 text-12 text-slate-400">No shared words.</li> : words.map(x => (
                <li key={x.w}>
                  <div className={`flex items-center ${word === x.w && !word2 ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
                    <button type="button" onClick={() => toggleOpen(x.w)} aria-label={`${open.has(x.w) ? 'Hide' : 'Show'} the words that go with ${x.w}`} className="pl-3 pr-1 py-1.5 text-slate-400 hover:text-slate-700 cursor-pointer">{open.has(x.w) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
                    <button type="button" onClick={() => { setWord(word === x.w && !word2 ? '' : x.w); setWord2(''); }} className={`flex-1 flex justify-between gap-2 pr-4 py-1.5 text-12.5 cursor-pointer ${word === x.w && !word2 ? 'text-indigo-800 font-semibold' : 'text-slate-700'}`}><span className="truncate">{x.w}</span><span className="tabular-nums text-slate-500">{wordBy === 'number' ? fmt(x.n) : kfmt(x.v)}</span></button>
                  </div>
                  {open.has(x.w) && <ul className="pl-8 pb-1">{subWords(x.w).map(s => <li key={s.w}><button type="button" onClick={() => { setWord(x.w); setWord2(word2 === s.w ? '' : s.w); }} className={`w-full flex justify-between gap-2 pr-4 py-1 text-12 cursor-pointer ${word === x.w && word2 === s.w ? 'text-indigo-800 font-semibold' : 'text-slate-600 hover:text-slate-900'}`}><span className="truncate">{s.w}</span><span className="tabular-nums text-slate-400">{wordBy === 'number' ? fmt(s.n) : kfmt(s.v)}</span></button></li>)}</ul>}
                </li>))}</ul>
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
                  <Pill label="Words" value={wordCount} onChange={setWordCount} options={[['short', '1 to 2 words', '1-2'], ['mid', '3 to 4 words', '3-4'], ['long', '5 or more', '5+']]} />
                  <input value={inc} onChange={e => setInc(e.target.value)} placeholder="Include words" aria-label="Include words" className="h-8 w-36 px-3 text-12.5 rounded-full ring-1 ring-inset ring-slate-300 outline-none focus:ring-2 focus:ring-indigo-400" />
                  <input value={exc} onChange={e => setExc(e.target.value)} placeholder="Exclude words" aria-label="Exclude words" className="h-8 w-36 px-3 text-12.5 rounded-full ring-1 ring-inset ring-slate-300 outline-none focus:ring-2 focus:ring-indigo-400" />
                  {anyFilter && <button type="button" onClick={clearAll} className="text-12.5 font-semibold text-indigo-700 hover:underline inline-flex items-center gap-1 cursor-pointer"><X size={12} />Clear filters</button>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" icon={Wand2} disabled={!sel.size} onClick={() => navigate(`/keyword-management/prepare?k=${[...sel].slice(0, 12).map(encodeURIComponent).join('|')}`)}>Prepare</Button>
                  <Button size="sm" variant="primary" icon={Send} busy={busy === 'ws'} disabled={!rows.length} onClick={() => sendKeywords(sel.size ? rows.filter(r => sel.has(r.keyword)) : rows)}>{sel.size ? `Send ${sel.size} selected` : `Send ${Math.min(rows.length, 500)} keywords`}</Button>
                  <Button size="sm" onClick={askShown} disabled={!pager.rows.some(r => kdMap[r.keyword] === undefined)} title="Read the top 10 on Google for the first 10 keywords shown without a KD and work out their difficulty (about 15 seconds each)">Check KD for 10 shown</Button>
                  <Button size="sm" icon={RefreshCw} onClick={() => setReload(x => x + 1)} title="Ask Google again">Update</Button>
                  <Button size="sm" icon={Download} disabled={!rows.length} onClick={() => downloadCsv(`keyword-magic-${seed}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'), ['Keyword', 'Intent', 'Volume', 'KD %', 'Index', 'CPC'], rows.map(r => [r.keyword, r.intent, r.volume ?? '', typeof kdMap[r.keyword] === 'number' ? kdMap[r.keyword] : '', r.index ?? '', r.cpc ?? '']))}>Export CSV</Button>
                  <span className="ml-auto text-12.5 text-slate-500 tabular-nums">All keywords: <b className="text-slate-900">{fmt(filtered.length)}</b> · Total volume: <b className="text-slate-900">{kfmt(total)}</b></span>
                </div>
              </div>

              {rows.length === 0 ? <p className="py-14 text-center text-13 text-slate-500">No keyword matches these filters. <button type="button" onClick={() => { clearAll(); setType('all'); setMatch('all'); }} className="font-semibold text-indigo-700 hover:underline cursor-pointer">Show everything</button></p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-13 min-w-[700px]">
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
                          <td className="px-3 py-2.5 max-w-[380px]"><span className="inline-flex items-center gap-2"><Link to={`/keyword-overview?q=${encodeURIComponent(r.keyword)}`} className="text-indigo-700 hover:underline" title="Open its overview">{r.keyword}</Link>
                            <button type="button" onClick={() => goTo(r.keyword)} aria-label={`Find ideas for ${r.keyword}`} title="Find keywords for this phrase" className="text-slate-300 hover:text-indigo-600 cursor-pointer"><Wand2 size={13} /></button></span></td>
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

export function KeywordMagicToolPage() {
  return <SeoShell title="Keyword Magic Tool" subtitle="Every keyword idea for a topic: variations, questions and related searches, narrowed by match, filters and shared words, then sent to your Keyword Workspace">{(b) => <Body key={b.id} b={b} />}</SeoShell>;
}
