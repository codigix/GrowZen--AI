import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, Download, ExternalLink, Loader2, Search, Send, X } from 'lucide-react';
import { SeoShell, Button, ErrorNote, useAction, useToast } from './SeoUi';
import { usePager, Pager, downloadCsv } from './DataTable';
import { api, useApi } from './seoApi';

const kfmt = (n) => (n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K` : String(Math.round(n)));
const kdColor = (v) => (v < 15 ? '#059669' : v < 30 ? '#65a30d' : v < 50 ? '#d97706' : v < 70 ? '#ea580c' : '#dc2626');
const kdWord = (v) => (v < 15 ? 'Very easy' : v < 30 ? 'Easy' : v < 50 ? 'Possible' : v < 70 ? 'Difficult' : v < 85 ? 'Hard' : 'Very hard');
const INTENT = { informational: ['I', '#4338ca', '#e0e7ff', 'Informational'], commercial: ['C', '#b45309', '#fef3c7', 'Commercial'], transactional: ['T', '#047857', '#d1fae5', 'Transactional'], navigational: ['N', '#9d174d', '#fce7f3', 'Navigational'] };
const QUESTION = /^(what|how|why|when|where|which|who|can|does|do|is|are|should|will)\b/;

const IntentTag = ({ v }) => { const m = INTENT[v]; return m ? <span title={m[3]} className="inline-flex items-center justify-center w-5 h-5 rounded text-11 font-bold" style={{ color: m[1], background: m[2] }}>{m[0]}</span> : <span className="text-slate-300">—</span>; };
const KdCell = ({ v }) => (v === undefined || v === 'loading' ? <Loader2 size={12} className="animate-spin text-slate-400 inline" /> : v == null ? <span className="text-slate-300" title="Google's results could not be read for it">—</span>
  : <span className="inline-flex items-center gap-1.5 tabular-nums" title={`${v} of 100: ${kdWord(v)}`}>{v}<span className="w-2.5 h-2.5 rounded-full" style={{ background: kdColor(v) }} /></span>);

function Ring({ value }) {
  const r = 20, c = 2 * Math.PI * r, v = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" role="img" aria-label={`Difficulty ${value ?? 'not available'} of 100`}>
      <circle cx="26" cy="26" r={r} fill="none" stroke="#e5e7eb" strokeWidth="6" />
      {value != null && <circle cx="26" cy="26" r={r} fill="none" stroke={kdColor(v)} strokeWidth="6" strokeDasharray={`${(c * v) / 100} ${c}`} strokeLinecap="round" transform="rotate(-90 26 26)" />}
    </svg>
  );
}

function Card({ children, className = '' }) { return <div className={`rounded-xl bg-white ring-1 ring-slate-200 p-5 ${className}`}>{children}</div>; }
const Label = ({ children }) => <div className="text-13 text-slate-500">{children}</div>;
const Big = ({ children }) => <div className="text-28 font-bold text-slate-900 tabular-nums leading-tight">{children}</div>;

function Overview({ b, keyword, country, data, kd, kdMap, askKd, send, busy, hub = '' }) {
  const [tab, setTab] = useState('keywords');
  const [topic, setTopic] = useState('');
  const [q, setQ] = useState('');
  const [type, setType] = useState('all');
  const [minVol, setMinVol] = useState('');
  const [kdBand, setKdBand] = useState('');
  const [sort, setSort] = useState({ key: 'volume', dir: 'desc' });
  const [sel, setSel] = useState(() => new Set());
  const topicsRef = useRef(null);

  const all = useMemo(() => { const m = new Map(); for (const k of ['similar', 'related', 'questions']) for (const r of data.groups?.[k]?.all || []) if (!m.has(r.keyword)) m.set(r.keyword, r); return [...m.values()]; }, [data]);
  const clusters = data.clusters || [];
  const active = clusters.find(c => c.topic === topic);
  const inTopic = useMemo(() => (active ? new Set(active.keywords.map(k => k.keyword)) : null), [active]);
  const rows0 = useMemo(() => all.filter(r => (!inTopic || inTopic.has(r.keyword)) && (type === 'all' || QUESTION.test(r.keyword)) && (!q || r.keyword.includes(q.toLowerCase())) && (!minVol || (r.volume || 0) >= Number(minVol))
    && (!kdBand || (typeof kdMap[r.keyword] === 'number' && (kdBand === 'easy' ? kdMap[r.keyword] < 30 : kdBand === 'mid' ? kdMap[r.keyword] >= 30 && kdMap[r.keyword] < 60 : kdMap[r.keyword] >= 60)))), [all, inTopic, type, q, minVol, kdBand, kdMap]);
  const rows = useMemo(() => [...rows0].sort((a, c) => { const g = (r) => (sort.key === 'keyword' ? r.keyword : sort.key === 'kd' ? (typeof kdMap[r.keyword] === 'number' ? kdMap[r.keyword] : null) : r[sort.key]); const x = g(a), y = g(c); if (x == null) return 1; if (y == null) return -1; const o = typeof x === 'string' ? x.localeCompare(y) : x - y; return sort.dir === 'asc' ? o : -o; }), [rows0, sort, kdMap]);
  const pager = usePager(rows, { size: 50, resetKey: `${topic}|${type}|${q}|${minVol}|${kdBand}|${sort.key}|${sort.dir}|${keyword}` });
  const totalVol = all.reduce((a, r) => a + (r.volume || 0), 0) + (data.metrics?.volume || 0);
  const questions = all.filter(r => QUESTION.test(r.keyword)).length;
  const intents = useMemo(() => { const m = {}; for (const r of all) m[r.intent] = (m[r.intent] || 0) + (r.volume || 0); const t = Object.values(m).reduce((a, x) => a + x, 0) || 1; return Object.entries(m).filter(([k]) => INTENT[k]).map(([k, v]) => ({ k, share: (v * 100) / t })); }, [all]);
  const world = (data.countries || []).filter(c => c.volume).sort((a, c) => c.volume - a.volume);
  const worldTotal = data.world_volume ?? world.reduce((a, c) => a + c.volume, 0);
  const shownWorld = world.slice(0, 4), other = Math.max(0, worldTotal - shownWorld.reduce((a, c) => a + c.volume, 0));
  const topW = Math.max(1, ...shownWorld.map(c => c.volume), other);
  const sortBy = (k, first = 'desc') => setSort(s => ({ key: k, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : first }));
  const Th = ({ id, children, right, first }) => <th className={`px-3 py-2.5 font-medium ${right ? 'text-right' : 'text-left'}`}><button type="button" onClick={() => sortBy(id, first)} className="cursor-pointer hover:text-slate-900">{children}{sort.key === id ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>;
  const toggle = (k) => setSel(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const comps = (kd?.organic || []).slice(0, 3);
  const m = data.metrics || {};

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="text-13 text-slate-500 flex items-center gap-1">{active ? <><span>{keyword}</span><ChevronRight size={13} /><span className="text-slate-700">{active.label || active.topic}</span></> : <span>Keyword</span>}</div>
          <h2 className="text-24 font-bold text-slate-900 mt-0.5">{data.keyword}</h2>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-[1fr_1.4fr_1fr] gap-5">
            <div>
              <Label>Volume ({data.country})</Label><Big>{m.volume != null ? kfmt(m.volume) : '—'}</Big>
              <div className="mt-4"><Label>Keyword Difficulty</Label>
                {kd?.state === 'loading' || !kd ? <div className="mt-1 text-13 text-slate-400 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" />Reading Google's top 10…</div>
                  : <div className="flex items-center gap-3 mt-1"><div><div className="text-24 font-bold tabular-nums" style={{ color: kd.score != null ? kdColor(kd.score) : '#94a3b8' }}>{kd.score != null ? `${kd.score}%` : '—'}</div><div className="text-12 text-slate-500">{kd.score != null ? kdWord(kd.score) : 'Not read'}</div></div><Ring value={kd.score} /></div>}
              </div>
            </div>
            <div className="sm:border-l sm:pl-5 border-slate-200">
              <Label>Global Volume</Label><Big>{worldTotal ? kfmt(worldTotal) : '—'}</Big>
              <div className="mt-2 space-y-1.5">
                {shownWorld.map(c => <div key={c.code} className="flex items-center gap-2 text-13"><span className="w-7 font-medium text-slate-700">{c.code}</span><div className="flex-1 h-1.5 rounded bg-slate-100"><div className="h-1.5 rounded bg-indigo-500" style={{ width: `${Math.max(3, (c.volume / topW) * 100)}%` }} /></div><span className="w-12 text-right tabular-nums text-slate-600">{kfmt(c.volume)}</span></div>)}
                {other > 0 && <div className="flex items-center gap-2 text-13 border-t border-slate-200 pt-1.5"><span className="w-7 text-slate-500">Other</span><div className="flex-1 h-1.5 rounded bg-slate-100"><div className="h-1.5 rounded bg-indigo-300" style={{ width: `${Math.max(3, (other / topW) * 100)}%` }} /></div><span className="w-12 text-right tabular-nums text-slate-600">{kfmt(other)}</span></div>}
                {!shownWorld.length && <div className="text-12.5 text-slate-400">Google has no per-country figures for it.</div>}
              </div>
            </div>
            <div className="sm:border-l sm:pl-5 border-slate-200">
              <Label>Intent</Label>
              <span className="inline-flex mt-1 px-3 h-8 items-center rounded-full text-13 font-medium" style={{ background: INTENT[data.intent]?.[2], color: INTENT[data.intent]?.[1] }}>{INTENT[data.intent]?.[3] || '—'}</span>
              <div className="mt-4 text-12.5 text-slate-500">CPC <b className="text-slate-800">{m.cpc_high != null ? `₹${m.cpc_high}` : '—'}</b></div>
              <div className="text-12.5 text-slate-500">Competition <b className="text-slate-800">{m.competition_index ?? '—'}</b></div>
            </div>
          </div>
          <div className="mt-5"><Button size="sm" onClick={() => topicsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>View topics</Button></div>
        </Card>

        <Card>
          <Label>Topic</Label>
          <h3 className="text-16 font-bold text-slate-900">{data.keyword}</h3>
          <div className="mt-3 grid grid-cols-3 gap-4">
            <div><Label>Total Volume</Label><Big>{kfmt(totalVol)}</Big></div>
            <div className="border-l border-slate-200 pl-4"><Label>Keywords</Label><Big>{kfmt(all.length + 1)}</Big><div className="text-12.5 text-slate-500">Questions <b className="text-indigo-600">{questions}</b></div></div>
            <div className="border-l border-slate-200 pl-4"><Label>Topics</Label><Big>{clusters.length}</Big><div className="text-12.5 text-slate-500">grouped by shared word</div></div>
          </div>
          <div className="mt-4"><Label>Intent</Label>
            <div className="mt-1.5 flex h-2 rounded overflow-hidden bg-slate-100" title={intents.map(i => `${INTENT[i.k][3]} ${Math.round(i.share)}%`).join(' · ')}>{intents.map(i => <div key={i.k} style={{ width: `${i.share}%`, background: INTENT[i.k][1] }} />)}</div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 text-12 text-slate-500">{intents.map(i => <span key={i.k}><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: INTENT[i.k][1] }} />{INTENT[i.k][3]} {Math.round(i.share)}%</span>)}</div>
          </div>
          <div className="mt-4"><Label>Top SEO Competitors <span className="text-slate-400">(first results on Google now)</span></Label>
            <ul className="mt-1.5 space-y-1">
              {kd?.state === 'loading' || !kd ? <li className="text-13 text-slate-400">Reading Google…</li> : comps.length ? comps.map(o => <li key={o.url}><a href={o.url} target="_blank" rel="noreferrer" className="text-13 text-slate-700 hover:text-indigo-700 hover:underline inline-flex items-center gap-1.5 max-w-full"><span className="text-slate-400 w-4">{o.position}</span><span className="truncate">{o.url.replace(/^https?:\/\//, '')}</span><ExternalLink size={11} className="shrink-0 text-slate-400" /></a></li>) : <li className="text-13 text-slate-400">Google's results could not be read.</li>}
            </ul>
          </div>
        </Card>
      </div>

      <div ref={topicsRef} className="pt-2"><h2 className="text-20 font-bold text-slate-900">Research topic ideas</h2></div>
      <div className="grid sm:grid-cols-2 gap-0 max-w-3xl rounded-lg ring-1 ring-slate-200 overflow-hidden bg-white" role="tablist">
        {[['keywords', 'Keywords', all.length + 1, 'Including synonyms and questions'], ['topics', 'Topics', clusters.length, 'Groups of ideas that share a word']].map(([id, l, n, s]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`text-left px-5 py-3.5 cursor-pointer border-l first:border-l-0 border-slate-200 ${tab === id ? 'bg-indigo-50/70 ring-1 ring-inset ring-indigo-300' : 'hover:bg-slate-50'}`}>
            <div className="text-16 font-semibold text-slate-900">{l} <span className="font-normal text-slate-500">{kfmt(n)}</span></div><div className="text-13 text-slate-500">{s}</div>
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-[260px_1fr] gap-4 items-start">
        <Card className="!p-3">
          <div className="text-13 font-semibold text-slate-700 px-2 pb-2">Topics</div>
          <button type="button" onClick={() => setTopic('')} className={`w-full text-left px-2 py-1.5 rounded text-13 cursor-pointer ${!topic ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'hover:bg-slate-50 text-slate-700'}`}>All keywords <span className="text-slate-400">{all.length}</span></button>
          <div className="max-h-[520px] overflow-y-auto">
            {clusters.map(c => <button key={c.topic} type="button" onClick={() => { setTopic(c.topic); setTab('keywords'); }} className={`w-full text-left px-2 py-1.5 rounded text-13 cursor-pointer flex items-center justify-between gap-2 ${topic === c.topic ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'hover:bg-slate-50 text-slate-700'}`}><span className="truncate">{c.label || c.topic}</span><span className="text-12 text-slate-400 shrink-0">{c.count}</span></button>)}
            {!clusters.length && <div className="px-2 text-12.5 text-slate-400">No topics found.</div>}
          </div>
        </Card>

        <div className="rounded-xl bg-white ring-1 ring-slate-200 min-w-0">
          <div className="px-4 pt-4 flex flex-wrap items-center gap-2">
            <div className="font-semibold text-slate-900">{active ? (active.label || active.topic) : 'All keywords'} <span className="font-normal text-slate-500">{kfmt(rows.length)}</span></div>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="primary" icon={Send} busy={busy === 'ws'} disabled={!rows.length} onClick={() => send(sel.size ? rows.filter(r => sel.has(r.keyword)) : rows.slice(0, 200))}>{sel.size ? `Save ${sel.size} keywords` : 'Save keywords'}</Button>
              <Button size="sm" icon={Download} disabled={!rows.length} onClick={() => downloadCsv(`magic-tool-${keyword}`.replace(/[^a-z0-9]+/gi, '-').toLowerCase(), ['Keyword', 'Volume', 'Intent', 'KD %', 'CPC'], rows.map(r => [r.keyword, r.volume ?? '', r.intent ?? '', kdMap[r.keyword] ?? '', r.cpc ?? '']))}>Export</Button>
            </div>
          </div>
          <div className="px-4 py-3 flex flex-wrap items-center gap-2">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter" aria-label="Filter keywords" className="ai-glass-input h-8 w-44 px-3 text-13 rounded" />
            <div className="inline-flex rounded ring-1 ring-inset ring-slate-300 overflow-hidden">{[['all', 'All'], ['questions', 'Questions']].map(([k, l]) => <button key={k} type="button" aria-pressed={type === k} onClick={() => setType(k)} className={`px-3 h-8 text-13 cursor-pointer ${type === k ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-600'}`}>{l}</button>)}</div>
            <select value={minVol} onChange={e => setMinVol(e.target.value)} aria-label="Minimum volume" className="h-8 rounded ring-1 ring-inset ring-slate-300 bg-white px-2 text-13"><option value="">Volume</option>{[10, 100, 1000, 10000].map(v => <option key={v} value={v}>{kfmt(v)}+</option>)}</select>
            <select value={kdBand} onChange={e => setKdBand(e.target.value)} aria-label="KD band" className="h-8 rounded ring-1 ring-inset ring-slate-300 bg-white px-2 text-13"><option value="">KD %</option><option value="easy">Under 30 (read ones)</option><option value="mid">30 to 59</option><option value="hard">60 and over</option></select>
            {(q || minVol || kdBand || type !== 'all' || topic) && <button type="button" onClick={() => { setQ(''); setMinVol(''); setKdBand(''); setType('all'); setTopic(''); }} className="text-13 text-indigo-600 hover:underline cursor-pointer inline-flex items-center gap-1"><X size={12} />Clear</button>}
          </div>
          <div className="overflow-x-auto border-t border-slate-100">
            <table className="w-full text-13">
              <thead className="text-12 text-slate-500 bg-slate-50/60"><tr>
                <th className="px-4 py-2.5 w-8"><input type="checkbox" aria-label="Select this page" checked={pager.rows.length > 0 && pager.rows.every(r => sel.has(r.keyword))} onChange={e => setSel(s => { const n = new Set(s); pager.rows.forEach(r => (e.target.checked ? n.add(r.keyword) : n.delete(r.keyword))); return n; })} className="accent-indigo-600" /></th>
                <Th id="keyword" first="asc">Keywords</Th><Th id="volume" right>Volume</Th><th className="px-3 py-2.5 text-center font-medium">Intent</th><Th id="kd" right>KD %</Th><Th id="cpc" right>CPC</Th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {pager.rows.map(r => (
                  <tr key={r.keyword} className={sel.has(r.keyword) ? 'bg-indigo-50/50' : 'hover:bg-slate-50/60'}>
                    <td className="px-4 py-2"><input type="checkbox" aria-label={`Select ${r.keyword}`} checked={sel.has(r.keyword)} onChange={() => toggle(r.keyword)} className="accent-indigo-600" /></td>
                    <td className="px-3 py-2 font-medium text-slate-900"><Link to={`${hub ? '/keyword-management/magic?tab=topics' : '/keyword-management/magic2?'}${hub ? '&' : ''}q=${encodeURIComponent(r.keyword)}${country ? `&c=${country}` : ''}`} className="hover:text-indigo-700 hover:underline">{r.keyword}</Link></td>
                    <td className="px-3 py-2 text-right tabular-nums">{kfmt(r.volume)}</td>
                    <td className="px-3 py-2 text-center"><IntentTag v={r.intent} /></td>
                    <td className="px-3 py-2 text-right">{kdMap[r.keyword] === undefined ? <button type="button" onClick={() => askKd(r.keyword)} className="text-12 text-indigo-600 hover:underline cursor-pointer">Check</button> : <KdCell v={kdMap[r.keyword]} />}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.cpc != null ? `₹${r.cpc}` : '—'}</td>
                  </tr>
                ))}
                {!pager.rows.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">No keywords match.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="border-t border-slate-100"><Pager p={pager} label="keywords" /></div>
        </div>
      </div>
    </div>
  );
}

function Bulk({ b, country }) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState(null);
  const [busy, error, run] = useAction();
  const list = useMemo(() => [...new Set(text.split(/[\n,]/).map(x => x.trim().toLowerCase()).filter(Boolean))].slice(0, 100), [text]);
  const go = () => run('bulk', async () => {
    const m = await api(`/businesses/${b.id}/keyword-workspace/bulk-metrics`, { method: 'POST', body: { keywords: list, country: country || null } });
    const base = new Map((m.rows || []).map(r => [r.keyword, r]));
    setRows(list.map(k => ({ keyword: k, ...(base.get(k) || {}) })));
    const out = {};
    for (let i = 0; i < list.length; i += 3) {
      const chunk = list.slice(i, i + 3);
      const r = await api(`/businesses/${b.id}/seo/keyword-difficulty/batch`, { method: 'POST', body: { keywords: chunk, country: country || null }, timeout: 240000 }).catch(() => null);
      chunk.forEach((k, n) => { out[k] = r?.results?.find(x => x.keyword === k)?.score ?? r?.results?.[n]?.score ?? null; });
      setRows(prev => (prev || []).map(x => (x.keyword in out ? { ...x, kd: out[x.keyword] } : x)));
    }
  });
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-16 font-bold text-slate-900">Bulk Analysis</h2>
        <p className="text-13 text-slate-500 mt-1">Paste up to 100 keywords, one per line. Each gets its real monthly searches from Google Keyword Planner and its difficulty from the real top 10 on Google.</p>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={6} aria-label="Keywords to analyse" placeholder={'digital marketing near me\nseo services in pune'} className="ai-glass-input mt-3 w-full p-3 text-13 rounded" />
        <div className="mt-3 flex items-center gap-3"><Button variant="primary" busy={busy === 'bulk'} disabled={!list.length} onClick={go}>Analyse {list.length || ''} keywords</Button>{error && <ErrorNote>{error}</ErrorNote>}</div>
      </Card>
      {rows && (
        <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-x-auto">
          <table className="w-full text-13">
            <thead className="text-12 text-slate-500 bg-slate-50/60"><tr><th className="px-4 py-2.5 text-left">Keyword</th><th className="px-3 py-2.5 text-right">Volume</th><th className="px-3 py-2.5 text-right">KD %</th><th className="px-3 py-2.5 text-right">CPC</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{rows.map(r => <tr key={r.keyword}><td className="px-4 py-2 font-medium">{r.keyword}</td><td className="px-3 py-2 text-right tabular-nums">{kfmt(r.volume)}</td><td className="px-3 py-2 text-right"><KdCell v={r.kd} /></td><td className="px-3 py-2 text-right tabular-nums">{r.cpc != null ? `₹${r.cpc}` : '—'}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Body({ b, hub = '' }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const keyword = (params.get('q') || '').trim();
  const country = params.get('c') || '';
  const tab = hub ? (hub === 'bulk' ? 'bulk' : 'overview') : params.get('tab') === 'bulk' ? 'bulk' : 'overview';
  const countries = useApi('/discover/countries');
  const [typed, setTyped] = useState(keyword);
  const [data, setData] = useState(null);
  const [kd, setKd] = useState(null);
  const [kdMap, setKdMap] = useState({});
  const [busy, , run] = useAction();
  const [toast, toastNode] = useToast();
  const mine = useRef(0);
  useEffect(() => setTyped(keyword), [keyword]);

  useEffect(() => {
    if (keyword.length < 2 || tab !== 'overview') return undefined;
    const token = ++mine.current;
    setData({ state: 'loading' }); setKd(null); setKdMap({});
    api(`/businesses/${b.id}/seo/keyword-overview`, { method: 'POST', body: { keyword, country: country || null }, timeout: 180000 })
      .then(r => { if (mine.current === token) setData({ state: 'ready', ...r }); }).catch(e => { if (mine.current === token) setData({ state: 'error', message: e.message }); });
    api(`/businesses/${b.id}/seo/keyword-difficulty`, { method: 'POST', body: { keyword, country: country || null }, timeout: 330000 })
      .then(r => { if (mine.current === token) setKd({ state: 'ready', ...r }); }).catch(e => { if (mine.current === token) setKd({ state: 'error', message: e.message }); });
    return () => { mine.current += 1; };
  }, [b.id, keyword, country, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const askKd = (k) => {
    setKdMap(m => ({ ...m, [k]: 'loading' }));
    api(`/businesses/${b.id}/seo/keyword-difficulty/batch`, { method: 'POST', body: { keywords: [k], country: data?.country || country || null }, timeout: 240000 })
      .then(r => setKdMap(m => ({ ...m, [k]: r.results?.[0]?.score ?? null }))).catch(() => setKdMap(m => ({ ...m, [k]: null })));
  };
  const send = (list) => run('ws', async () => {
    const r = await api(`/businesses/${b.id}/keyword-workspace/add`, { method: 'POST', body: { ideas: list.slice(0, 500).map(i => ({ keyword: i.keyword, volume: i.volume, detail: `Keyword Magic Tool 2.0: ${keyword}` })), label: 'Keyword Magic Tool 2.0' } });
    toast(r.added ? `${r.added} keyword${r.added === 1 ? '' : 's'} saved to the Keyword Workspace` : 'Already in the Keyword Workspace');
  });
  const url = (over) => { const p = new URLSearchParams({ ...(keyword && { q: keyword }), ...(country && { c: country }), ...(hub && { tab: hub }), ...over }); return `${hub ? '/keyword-management/magic' : '/keyword-management/magic2'}?${p}`; };
  const submit = (e) => { e.preventDefault(); const t = typed.trim(); if (t.length > 1) navigate(url({ q: t })); };
  const countryName = (countries.data || []).find(c => c.code === (data?.country || country))?.name;

  return (
    <div className="space-y-5">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg ring-1 ring-inset ring-slate-300 bg-white overflow-hidden"><input value={typed} onChange={e => setTyped(e.target.value)} aria-label="Keyword" placeholder="Enter a keyword, e.g. ai automation" className="h-10 w-72 sm:w-96 px-3 text-14 outline-none" />{typed && <button type="button" aria-label="Clear" onClick={() => setTyped('')} className="px-2 text-slate-400 hover:text-slate-700 cursor-pointer"><X size={14} /></button>}<button type="submit" aria-label="Search" className="h-10 px-3 bg-slate-50 border-l border-slate-300 text-slate-600 hover:bg-slate-100 cursor-pointer"><Search size={16} /></button></div>
        <label className="inline-flex items-center gap-1 text-13 text-slate-600">Database
          <select value={data?.country || country || ''} onChange={e => navigate(url({ c: e.target.value }))} aria-label="Database (country)" className="h-10 rounded-lg ring-1 ring-inset ring-slate-300 bg-white px-2 text-13 text-slate-800">{!(data?.country || country) && <option value="">Your country</option>}{(countries.data || []).map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select>
        </label>
      </form>
      {!hub && <div className="flex gap-6 border-b border-slate-200" role="tablist">
        {[['overview', 'Overview and Research'], ['bulk', 'Bulk Analysis']].map(([id, l]) => <Link key={id} role="tab" aria-selected={tab === id} to={url({ tab: id === 'bulk' ? 'bulk' : '' })} className={`-mb-px pb-2.5 text-14 font-medium border-b-2 ${tab === id ? 'border-indigo-600 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{l}</Link>)}
      </div>}
      {tab === 'bulk' ? <Bulk b={b} country={country} />
        : keyword.length < 2 ? <div className="rounded-xl bg-white ring-1 ring-slate-200 p-10 text-center text-slate-500">Enter a keyword to see its volume, difficulty, global volume, intent, the first results on Google and every related keyword grouped into topics.</div>
          : data?.state === 'loading' || !data ? <div className="flex items-center justify-center gap-2 py-16 text-13 text-slate-500"><Loader2 className="animate-spin" size={16} /> Reading Google Keyword Planner for “{keyword}”… {countryName || ''}</div>
            : data.state === 'error' ? <ErrorNote>{data.message}</ErrorNote>
              : !data.found && !(data.groups?.similar?.total || data.groups?.related?.total) ? <div className="rounded-xl bg-white ring-1 ring-slate-200 p-10 text-center text-slate-500">Google has no searches for “{keyword}” in this database.</div>
                : <Overview hub={hub} b={b} keyword={keyword} country={country} data={data} kd={kd} kdMap={kdMap} askKd={askKd} send={send} busy={busy} />}
      {toastNode}
    </div>
  );
}

export function KeywordMagicTool2Page() {
  return <SeoShell title="Keyword Magic Tool 2.0" subtitle="One keyword: volume, difficulty, global volume, intent and the first results on Google, then every related keyword grouped into topics">{(b) => <Body key={b.id} b={b} />}</SeoShell>;
}
export { Body as KeywordMagic2Body };
