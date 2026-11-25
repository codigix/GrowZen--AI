import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, BarChart3, Crosshair, Download, Loader2, MoreHorizontal, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { SeoShell, Button, ErrorNote, Modal, useAction, useToast } from './SeoUi';
import { usePager, Pager, downloadCsv } from './DataTable';
import { api, useApi } from './seoApi';

const kfmt = (n) => (n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K` : String(Math.round(n)));
const INTENT = { informational: ['I', '#4338ca', '#e0e7ff', 'Informational'], commercial: ['C', '#b45309', '#fef3c7', 'Commercial'], transactional: ['T', '#047857', '#d1fae5', 'Transactional'], navigational: ['N', '#9d174d', '#fce7f3', 'Navigational'], local: ['L', '#0e7490', '#cffafe', 'Local'] };
const LIST = { 'My List': 'bg-blue-50 text-blue-700', 'Blog Ideas': 'bg-violet-50 text-violet-700', Competitors: 'bg-emerald-50 text-emerald-700' };
const kdColor = (v) => (v < 30 ? '#059669' : v < 60 ? '#f59e0b' : '#dc2626');
const kdWord = (v) => (v < 15 ? 'Very easy' : v < 30 ? 'Easy' : v < 50 ? 'Possible' : v < 70 ? 'Difficult' : v < 85 ? 'Hard' : 'Very hard');
const DAYS = { '7': 7, '30': 30, '90': 90, '365': 365 };

function Spark({ v }) {
  if (!v || v.length < 2) return <span className="text-slate-300">—</span>;
  const max = Math.max(...v, 1), min = Math.min(...v), w = 92, h = 26;
  const pts = v.map((x, i) => `${(i * w) / (v.length - 1)},${h - 2 - ((x - min) / Math.max(1, max - min)) * (h - 4)}`).join(' ');
  const up = v[v.length - 1] >= v[0];
  return <svg width={w} height={h} role="img" aria-label={`Searches over ${v.length} months: ${v[0]} to ${v[v.length - 1]}`}><title>{`Last ${v.length} months: ${v[0]} → ${v[v.length - 1]}`}</title><polygon points={`0,${h} ${pts} ${w},${h}`} fill={up ? '#dbeafe' : '#fee2e2'} opacity=".7" /><polyline points={pts} fill="none" stroke={up ? '#2563eb' : '#dc2626'} strokeWidth="1.5" /></svg>;
}

const Sel = ({ label, value, onChange, children }) => <select aria-label={label} value={value} onChange={e => onChange(e.target.value)} className="h-10 rounded-lg ring-1 ring-inset ring-slate-300 bg-white px-3 text-13 text-slate-700 cursor-pointer">{children}</select>;

function Body({ b }) {
  const r = useApi(`/businesses/${b.id}/keyword-workspace/saved`);
  const navigate = useNavigate();
  const loc = useLocation();
  const fresh = useMemo(() => new Set((loc.state?.added || []).map(x => String(x).toLowerCase())), [loc.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const [tab, setTab] = useState('All');
  const [q, setQ] = useState('');
  const [kd, setKd] = useState('');
  const [intent, setIntent] = useState('');
  const [vol, setVol] = useState('');
  const [days, setDays] = useState('');
  const [sort, setSort] = useState({ key: 'added', dir: 'desc' });
  const [sel, setSel] = useState(() => new Set());
  const [menu, setMenu] = useState(null);
  const [adding, setAdding] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();

  const all = r.data?.rows || [];
  const [checking, setChecking] = useState(false);
  const [checkNote, setCheckNote] = useState('');
  const auto = useRef(false);
  // Track one keyword: read its position on Google now (Search Console) and keep it in position tracking
  const track = (x) => { setMenu(null); navigate(`/rank-tracking/landscape?kw=${encodeURIComponent(x.keyword)}`); };
  const lastChecked = all.map(x => x.checked).filter(Boolean).sort().pop();
  // Positions come from Google Search Console: read them for every saved keyword, on arrival when none was read yet and on request
  const check = async () => {
    setChecking(true); setCheckNote('');
    try { await api(`/businesses/${b.id}/seo/check-ranks`, { method: 'POST', body: { keywords: all.slice(0, 25).map(x => x.keyword) }, timeout: 120000 }); r.reload(true); }
    catch (e) { setCheckNote(e.message || 'Positions could not be read.'); } finally { setChecking(false); }
  };
  useEffect(() => { if (!auto.current && all.length && all.some(x => !x.checked)) { auto.current = true; check(); } }, [all.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const lists = r.data?.lists || {};
  const cutoff = days ? new Date(Date.now() - DAYS[days] * 864e5).toISOString().slice(0, 10) : '';
  const rows = useMemo(() => {
    const f = all.filter(x => (tab === 'All' || x.list === tab) && (!q || x.keyword.includes(q.toLowerCase())) && (!intent || x.intent === intent) && (!vol || (x.volume || 0) >= Number(vol))
      && (!kd || (x.kd != null && (kd === 'easy' ? x.kd < 30 : kd === 'mid' ? x.kd >= 30 && x.kd < 60 : x.kd >= 60))) && (!cutoff || (x.added || '') >= cutoff));
    const g = (x) => (sort.key === 'keyword' ? x.keyword : sort.key === 'list' ? x.list : x[sort.key]);
    return [...f].sort((a, c) => { const p = g(a), s = g(c); if (p == null) return 1; if (s == null) return -1; const o = typeof p === 'string' ? p.localeCompare(s) : p - s; return sort.dir === 'asc' ? o : -o; });
  }, [all, tab, q, kd, intent, vol, cutoff, sort]);
  const pager = usePager(rows, { size: 25, resetKey: `${tab}|${q}|${kd}|${intent}|${vol}|${days}|${sort.key}|${sort.dir}` });
  const sortBy = (k, first = 'desc') => setSort(s => ({ key: k, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : first }));
  const Th = ({ id, children, right, first }) => <th className={`px-3 py-3 font-semibold ${right ? 'text-right' : 'text-left'}`}><button type="button" onClick={() => sortBy(id, first)} className="cursor-pointer hover:text-slate-900 whitespace-nowrap">{children}{sort.key === id ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>;
  const toggle = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const pageAll = pager.rows.length > 0 && pager.rows.every(x => sel.has(x.id));
  const remove = (ids) => run('rm', async () => { for (const id of ids) await api(`/businesses/${b.id}/keywords/${id}`, { method: 'DELETE' }); setSel(new Set()); setMenu(null); r.reload(true); toast(`${ids.length} keyword${ids.length === 1 ? '' : 's'} removed`); });
  const exportRows = (list) => downloadCsv('saved-keywords', ['Keyword', 'List', 'Volume', 'KD %', 'Intent', 'CPC', 'Role', 'Priority', 'Topic', 'Position', 'Added'], list.map(x => [x.keyword, x.list, x.volume ?? '', x.kd ?? '', x.intent ?? '', x.cpc ?? '', x.role ?? '', x.priority ?? '', x.topic ?? '', x.rank ?? '', x.added ?? '']));
  const startSave = () => { const l = [...new Set(typed.split(/[,\n]/).map(x => x.trim().toLowerCase()).filter(Boolean))].slice(0, 12); if (l.length) navigate(`/keyword-management/prepare?k=${l.map(encodeURIComponent).join('|')}`); };
  const clear = q || kd || intent || vol || days;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <p className="text-14 text-slate-600 flex-1 min-w-[260px]">Manage your saved keywords and track their performance. Add keywords from any keyword tool; each one is prepared first so it has a role and a priority.</p>
        <div className="flex gap-2"><Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Save keywords</Button><Button icon={Download} disabled={!rows.length} onClick={() => exportRows(sel.size ? rows.filter(x => sel.has(x.id)) : rows)}>Export</Button></div>
      </div>

      <div className="flex gap-6 border-b border-slate-200" role="tablist">
        {[['All', all.length], ['My List', lists['My List']], ['Blog Ideas', lists['Blog Ideas']], ['Competitors', lists.Competitors]].map(([k, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px pb-2.5 text-14 font-medium border-b-2 cursor-pointer ${tab === k ? 'border-indigo-600 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{k} <span className={tab === k ? 'text-indigo-600' : 'text-slate-400'}>({n || 0})</span></button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-sm"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search for keywords…" aria-label="Search saved keywords" className="h-10 w-full rounded-lg ring-1 ring-inset ring-slate-300 bg-white pl-9 pr-3 text-13" /></div>
        <Sel label="Difficulty" value={kd} onChange={setKd}><option value="">Any difficulty</option><option value="easy">Easy (under 30)</option><option value="mid">Possible (30 to 59)</option><option value="hard">Hard (60 and over)</option></Sel>
        <Sel label="Intent" value={intent} onChange={setIntent}><option value="">Any intent</option>{Object.entries(INTENT).map(([k, m]) => <option key={k} value={k}>{m[3]}</option>)}</Sel>
        <Sel label="Volume" value={vol} onChange={setVol}><option value="">Any volume</option><option value="10">10+</option><option value="100">100+</option><option value="1000">1K+</option><option value="10000">10K+</option></Sel>
        <Sel label="Added" value={days} onChange={setDays}><option value="">Any time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 3 months</option><option value="365">Last 12 months</option></Sel>
        <button type="button" onClick={check} disabled={checking || !all.length} title="Read each keyword's average position on Google from Search Console (last 28 days)" className="ml-auto inline-flex items-center gap-1.5 h-10 px-3 rounded-lg ring-1 ring-inset ring-slate-300 bg-white text-13 text-slate-700 cursor-pointer hover:bg-slate-50 disabled:opacity-60"><RefreshCw size={14} className={checking ? 'animate-spin' : ''} />Check positions{lastChecked ? <span className="text-slate-400">· {lastChecked}</span> : null}</button>
        {clear && <button type="button" onClick={() => { setQ(''); setKd(''); setIntent(''); setVol(''); setDays(''); }} className="text-13 text-indigo-600 hover:underline cursor-pointer">Clear</button>}
      </div>

      {checkNote && <ErrorNote>{checkNote}</ErrorNote>}
      {r.error && <ErrorNote>{r.error.message}</ErrorNote>}
      <div className="rounded-xl bg-white ring-1 ring-slate-200">
        <div className="overflow-x-auto">
          <table className="w-full text-13">
            <thead className="bg-slate-50 text-12.5 text-slate-700">
              <tr>
                <th className="pl-4 py-3 w-10"><input type="checkbox" aria-label="Select this page" checked={pageAll} onChange={e => setSel(s => { const n = new Set(s); pager.rows.forEach(x => (e.target.checked ? n.add(x.id) : n.delete(x.id))); return n; })} className="accent-indigo-600" /></th>
                <Th id="keyword" first="asc">Keyword</Th><Th id="list" first="asc">List</Th><Th id="volume" right>Volume</Th><Th id="kd" right>KD %</Th><th className="px-3 py-3 text-center font-semibold">Intent</th><Th id="cpc" right>CPC</Th>
                <th className="px-3 py-3 text-left font-semibold">Trend</th><Th id="rank" right>Position</Th><Th id="added">Added</Th><th className="px-3 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {r.loading && !r.data && Array.from({ length: 6 }).map((_, i) => <tr key={i}><td colSpan={11} className="px-4 py-4"><div className="h-4 rounded bg-slate-100 animate-pulse" /></td></tr>)}
              {pager.rows.map(x => (
                <tr key={x.id} data-just-added={fresh.has(x.keyword) ? '1' : undefined} className={sel.has(x.id) ? 'bg-indigo-50/50' : fresh.has(x.keyword) ? 'bg-emerald-50/50' : 'hover:bg-slate-50/60'}>
                  <td className="pl-4 py-3"><input type="checkbox" aria-label={`Select ${x.keyword}`} checked={sel.has(x.id)} onChange={() => toggle(x.id)} className="accent-indigo-600" /></td>
                  <td className="px-3 py-3 max-w-[300px]">
                    <Link to={`/keyword-management/magic?q=${encodeURIComponent(x.keyword)}`} className="font-medium text-blue-700 hover:underline" title="Open this keyword in the Keyword Magic Tool">{x.keyword}</Link>
                    <div className="mt-0.5 flex flex-wrap gap-1.5">{x.role && <span className={`px-1.5 rounded text-11 font-semibold ${x.role === 'primary' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>{x.role === 'primary' ? 'Primary' : 'Secondary'}</span>}{x.priority === 'High' && <span className="px-1.5 rounded text-11 font-semibold bg-rose-50 text-rose-700">High priority</span>}{x.topic && <span className="text-11 text-slate-400 self-center capitalize">{x.topic}</span>}</div>
                  </td>
                  <td className="px-3 py-3"><span className={`px-2.5 py-0.5 rounded-md text-12 font-medium whitespace-nowrap ${LIST[x.list]}`}>{x.list}</span></td>
                  <td className="px-3 py-3 text-right tabular-nums font-medium">{kfmt(x.volume)}</td>
                  <td className="px-3 py-3 text-right">{x.kd == null ? <span className="text-slate-300" title="Not read yet: Find Keywords reads difficulty from Google's top 10">—</span> : <span className="inline-flex items-center gap-1.5 tabular-nums font-medium" title={`${x.kd} of 100: ${kdWord(x.kd)}`}>{x.kd}<span className="w-2.5 h-2.5 rounded-full" style={{ background: kdColor(x.kd) }} /></span>}</td>
                  <td className="px-3 py-3 text-center">{INTENT[x.intent] ? <span title={INTENT[x.intent][3]} className="inline-flex items-center justify-center w-6 h-6 rounded text-12 font-bold" style={{ color: INTENT[x.intent][1], background: INTENT[x.intent][2] }}>{INTENT[x.intent][0]}</span> : <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{x.cpc != null ? `₹${Number(x.cpc).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—'}</td>
                  <td className="px-3 py-3"><Spark v={x.trend} /></td>
                  <td className="px-3 py-3 text-right tabular-nums">{x.rank ? <span className="inline-flex items-center gap-1 font-medium">#{x.rank}{x.prev_rank && x.prev_rank !== x.rank && (x.rank < x.prev_rank ? <ArrowUp size={12} className="text-emerald-600" /> : <ArrowDown size={12} className="text-rose-600" />)}</span> : x.checked ? <span className="text-slate-400 text-12" title="Search Console shows no impressions for it in the last 28 days: it is not ranking yet">Not ranking</span> : <span className="text-slate-300" title="Not checked yet">{checking ? <Loader2 size={12} className="animate-spin inline" /> : '—'}</span>}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-slate-600">{x.added ? new Date(x.added).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                  <td className="px-3 py-3 text-right relative whitespace-nowrap">
                    <button type="button" onClick={() => track(x)} aria-label={`Track position of ${x.keyword}`} title="Track position: open Position Tracking for this keyword" className="inline-flex p-1.5 text-slate-500 hover:text-indigo-700 cursor-pointer disabled:opacity-60"><Crosshair size={16} /></button>
                    <Link to={`/keyword-management/magic?q=${encodeURIComponent(x.keyword)}`} aria-label={`View trend of ${x.keyword}`} title="View keyword trend" className="inline-flex p-1.5 text-slate-500 hover:text-indigo-700"><BarChart3 size={16} /></Link>
                    <button type="button" aria-label={`More actions for ${x.keyword}`} aria-expanded={menu === x.id} onClick={() => setMenu(menu === x.id ? null : x.id)} className="inline-flex p-1.5 text-slate-500 hover:text-slate-900 cursor-pointer"><MoreHorizontal size={16} /></button>
                    {menu === x.id && (
                      <div role="menu" className="absolute right-3 top-full z-20 mt-0.5 w-52 rounded-lg bg-white shadow-lg ring-1 ring-slate-200 py-1 text-left">
                        <button role="menuitem" type="button" onClick={() => track(x)} className="block w-full text-left px-3 py-2 text-13 hover:bg-slate-50 cursor-pointer">Track in Position Tracking</button>
                        <Link role="menuitem" to="/rank-tracking/landscape" className="block px-3 py-2 text-13 hover:bg-slate-50">Open Position Tracking</Link>
                        <Link role="menuitem" to={`/keyword-management/prepare?k=${encodeURIComponent(x.keyword)}`} className="block px-3 py-2 text-13 hover:bg-slate-50">Prepare variations</Link>
                        <Link role="menuitem" to="/keyword-management/mapping" className="block px-3 py-2 text-13 hover:bg-slate-50">Map to a page</Link>
                        <Link role="menuitem" to="/keyword-management/status" className="block px-3 py-2 text-13 hover:bg-slate-50">Status and next step</Link>
                        <button role="menuitem" type="button" onClick={() => exportRows([x])} className="block w-full text-left px-3 py-2 text-13 hover:bg-slate-50 cursor-pointer">Export this keyword</button>
                        <button role="menuitem" type="button" onClick={() => remove([x.id])} className="block w-full text-left px-3 py-2 text-13 text-rose-700 hover:bg-rose-50 cursor-pointer">Remove from list</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {!r.loading && !pager.rows.length && <tr><td colSpan={11} className="px-4 py-12 text-center text-slate-500">{all.length ? 'No saved keywords match these filters.' : <>You have not saved any keywords yet. <Link className="text-indigo-600 underline" to="/keyword-management/workspace">Find keywords</Link> and choose Pick and prepare.</>}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center border-t border-slate-100"><div className="px-4 text-13 text-slate-600">Total: {rows.length} keyword{rows.length === 1 ? '' : 's'}</div><div className="ml-auto"><Pager p={pager} label="keywords" /></div></div>
      </div>

      {sel.size > 0 && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-30"><div role="toolbar" aria-label="Selected keywords" className="bg-slate-900 text-white rounded-xl shadow-xl px-4 py-2.5 flex items-center gap-3">
          <span className="text-13 font-semibold">{sel.size} selected</span>
          <Button size="sm" icon={Download} onClick={() => exportRows(rows.filter(x => sel.has(x.id)))}>Export</Button>
          <Button size="sm" icon={Trash2} busy={busy === 'rm'} onClick={() => remove([...sel])}>Remove</Button>
          <button type="button" onClick={() => setSel(new Set())} className="text-12.5 text-slate-300 hover:text-white underline cursor-pointer">Clear</button>
        </div></div>
      )}
      <Modal open={adding} onClose={() => setAdding(false)} title="Save keywords" width="max-w-md" footer={<><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" disabled={!typed.trim()} onClick={startSave}>Prepare and save</Button></>}>
        <p className="text-13 text-slate-600 mb-2">Type keywords, one per line (up to 12). They open in Prepare Keywords first, where each gets its wordings, a role and a priority. To find keywords, use <Link className="text-indigo-600 underline" to="/keyword-management/workspace">Find Keywords</Link> or the <Link className="text-indigo-600 underline" to="/keyword-management/magic">Keyword Magic Tool</Link>.</p>
        <textarea value={typed} onChange={e => setTyped(e.target.value)} rows={5} aria-label="Keywords to save" className="ai-glass-input w-full p-3 text-13 rounded" placeholder={'digital marketing\nseo services'} />
      </Modal>
      {error && <ErrorNote>{error}</ErrorNote>}
      {toastNode}
    </div>
  );
}

export function SavedKeywordsPage() {
  return <SeoShell title="Saved Keywords" subtitle="Manage your saved keyword lists and track their performance">{(b) => <Body key={b.id} b={b} />}</SeoShell>;
}
