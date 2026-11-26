import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePager, Pager, downloadCsv } from './DataTable';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowRight, ArrowUp, CalendarDays, Check, CheckCircle2, ChevronDown, Download, EyeOff, Loader2, MapPin, RefreshCw, Search, Sparkles, Star, Undo2, X } from 'lucide-react';
import { Card, Button, Badge, ErrorNote, Modal, SkList, useAction, useToast } from './SeoUi';
import { api, useApi } from './seoApi';
import { Act, Head } from './TableBits';
import PlacePicker from './PlacePicker';
import Select from '../components/Select';

const TAG_HELP = { gap: 'Competitors use it, you do not', win: 'You already rank in the top 3', almost: 'You are on page 2 of Google', shared: 'You and a competitor both use it', yours: 'Only your own places mention it', idea: 'Suggested by Google or AI' };
// one plain line for what kind of opportunity it is, and under it where it was found
const KIND_LINE = { gap: ['Competitors only', '#dc2626'], shared: ['You and competitors', '#2563eb'], yours: ['Only you', '#64748b'], idea: ['New idea', '#7c3aed'], win: ['Top 3 win', '#059669'], almost: ['Almost: page 2', '#d97706'] };
function Origin({ i }) {
  const [word, c] = KIND_LINE[i.tag] || KIND_LINE.idea;
  const own = [...new Set(i.sources.filter(s => s.kind !== 'competitors').map(s => SRC_SHORT[s.kind] || s.kind))];
  const them = i.competitors || [];
  const parts = [own.length ? `${own.slice(0, 2).join(', ')}${own.length > 2 ? ` +${own.length - 2}` : ''}` : '', them.length ? `${them[0]}${them.length > 1 ? ` +${them.length - 1}` : ''}` : (i.sources.some(s => s.kind === 'competitors') && !own.length ? 'Competitor sites' : '')].filter(Boolean);
  const tip = [TAG_HELP[i.tag], ...i.sources.map(s => `${s.label}${s.detail ? ': ' + s.detail : ''}`)].filter(Boolean).join('\n');
  return (
    <div className="min-w-0 max-w-[210px]" title={tip}>
      <div className="flex items-center gap-1.5 text-12.5 font-semibold" style={{ color: c }}><span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c }} />{word}</div>
      <div className="mt-0.5 text-11.5 text-slate-500 truncate">{parts.join(' · ') || 'No source saved'}</div>
    </div>
  );
}
const SRC_SHORT = { website: 'Website', search_console: 'Search Console', profile: 'Profile', competitors: 'Competitor', google_ideas: 'Google', planner: 'Planner', area: 'Area', brief: 'Summary', ai: 'AI' };
const n0 = (v) => (v == null ? '—' : v.toLocaleString('en-US'));
const PAGE = 50;
/** A filter as a pill: grey while it is off ("Searches"), indigo with its choice once it is on ("Searches: 500+"). The real <Select> sits invisibly over it, so it works with the keyboard and on a phone. */
function Pill({ label, value, onChange, options }) {
  const on = value !== '';
  const cur = options.find(o => o[0] === value);
  return (
    <label className={`relative inline-flex items-center h-9 rounded-full text-12.5 font-medium cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-indigo-400 ${on ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50'}`}>
      <span className="pl-3 pointer-events-none">{label}{on ? ':' : ''}</span>
      <span className="pl-1 pr-7 pointer-events-none font-semibold">{on ? (cur?.[2] || cur?.[1]) : ''}</span>
      <ChevronDown size={13} className="absolute right-2.5 pointer-events-none opacity-70" />
      <Select aria-label={label} value={value} onChange={e => onChange(e.target.value)} className="absolute inset-0 w-full opacity-0 cursor-pointer">
        <option value="">Any</option>{options.map(o => <option key={o[0]} value={o[0]}>{o[1]}</option>)}
      </Select>
    </label>
  );
}
const SHORT = (n) => (n == null ? '' : n >= 10000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));
const IDX_WORD = (v) => (v < 34 ? 'low' : v < 67 ? 'medium' : 'high');
const IDX_COLOR = (v) => (v < 34 ? '#059669' : v < 67 ? '#d97706' : '#dc2626');

/** The keyword's index value (Google's competition index, 0 to 100) and, under it, how the keyword performs in Google Search Console (views, clicks, average position, last 90 days). */
function IndexCell({ i }) {
  const g = i.gsc || {};
  const has = g.views != null;
  const perf = has ? `${SHORT(g.views)} views · ${g.clicks ?? 0} click${g.clicks === 1 ? '' : 's'}` : '';
  const tip = [i.index != null ? `Index value ${i.index} out of 100: ${IDX_WORD(i.index)} competition (Google Keyword Planner)` : 'No index value from Google for this keyword',
    has ? `Search Console, last 90 days: ${g.views} views, ${g.clicks ?? 0} clicks${g.ctr != null ? `, click rate ${g.ctr}%` : ''}${g.position != null ? `, average position ${Math.round(g.position * 10) / 10}` : ''}` : 'No Search Console data: your site has not shown for this keyword'].join('\n');
  return (
    <div className="inline-flex flex-col items-end gap-0.5" title={tip}>
      {i.index == null ? <span className="text-slate-300">—</span> : <span className="inline-flex items-center gap-1.5"><span className="tabular-nums font-semibold" style={{ color: IDX_COLOR(i.index) }}>{i.index}</span><span className="text-11.5 text-slate-500">{IDX_WORD(i.index)}</span></span>}
      <span className="text-11 text-slate-500 tabular-nums">{perf || 'no Search Console data'}</span>
    </div>
  );
}
const KD_BAND = { easy: (v) => v < 30, medium: (v) => v >= 30 && v < 50, hard: (v) => v >= 50 && v < 70, very: (v) => v >= 70 };
const MON = (m) => `${String(m).slice(0, 1)}${String(m).slice(1, 3).toLowerCase()}`;

/** An arrow for how the searches moved in the last 12 months (the last 3 months against the first 3): up when rising by 10% or more, down when falling by 10% or more, nothing when steady. */
function Arrow({ change, months }) {
  if (change == null || Math.abs(change) < 10) return null;
  const up = change > 0;
  const tip = ['Searches a month, last 12 months:', ...(months || []).map(m => `${MON(m.month)} ${String(m.year).slice(2)}: ${(m.searches || 0).toLocaleString('en-US')}`), `${up ? 'Rising' : 'Falling'}: ${change > 0 ? '+' : ''}${change}% (last 3 months against the first 3)`].join('\n');
  return <span title={tip} className="inline-flex" style={{ color: up ? '#059669' : '#dc2626' }}>{up ? <ArrowUp size={15} strokeWidth={2.5} /> : <ArrowDown size={15} strokeWidth={2.5} />}</span>;
}

// the keyword difficulty score in five colours, from very easy (green) to very hard (red)
const KD_COLOR = (v) => (v < 15 ? '#059669' : v < 30 ? '#65a30d' : v < 50 ? '#d97706' : v < 70 ? '#ea580c' : '#dc2626');
const KD_WORD = (v) => (v < 15 ? 'Very easy' : v < 30 ? 'Easy' : v < 50 ? 'Medium' : v < 70 ? 'Challenging' : 'Very hard');
function KdChip({ v, detail }) {
  const tip = [`${v} out of 100: ${KD_WORD(v)}`, ...(detail?.parts || []).map(p => `${p.name} (${p.weight}%): ${p.used ? p.value : 'no data'}`), detail?.sites != null ? `Read from ${detail.sites} of ${detail.of} top sites` : ''].filter(Boolean).join('\n');
  return <span className="tabular-nums font-semibold" style={{ color: KD_COLOR(v) }} title={tip}>{v}</span>;
}

/** Where your site stands on Google for a keyword: the average position as a whole place, and which page of Google that is. */
const BANDS = [['top3', 'Top 3', (n) => n <= 3, 'bg-emerald-100 text-emerald-800'], ['page1', 'Page 1', (n) => n > 3 && n <= 10, 'bg-green-50 text-green-800'], ['page2', 'Page 2', (n) => n > 10 && n <= 20, 'bg-amber-50 text-amber-800'],
  ['page3', 'Page 3+', (n) => n > 20, 'bg-slate-100 text-slate-600']];
const bandOf = (rank) => (rank == null ? null : BANDS.find(b => b[2](Math.max(1, Math.round(rank)))) || null);
const FIRST = { keyword: 'asc', rank: 'asc', difficulty: 'asc' }; // the first click on these puts the best first: A to Z, position 1 first, easiest first

function SortTh({ id, sort, setSort, children, right, what, why, from }) {
  const on = sort.key === id;
  return (
    <th className={`px-3 py-2 ${right ? 'text-right' : 'text-left'}`} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => setSort(s => ({ key: id, dir: s.key === id ? (s.dir === 'asc' ? 'desc' : 'asc') : (FIRST[id] || 'desc') }))} className={`inline-flex items-center gap-1 cursor-pointer hover:text-slate-800 ${on ? 'text-slate-900' : ''}`}>
        <Head what={what} why={why} from={from} right={right}>{children}</Head>{on && (sort.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    </th>
  );
}

/** One chip: a way to look at the list, with how many keywords it holds. */
function View({ on, onClick, children, count, tone = 'slate' }) {
  const pill = { slate: 'bg-slate-100 text-slate-600', red: 'bg-rose-50 text-rose-700', green: 'bg-emerald-50 text-emerald-700', indigo: 'bg-indigo-50 text-indigo-700', amber: 'bg-amber-50 text-amber-700' }[tone];
  return (
    <button type="button" role="tab" aria-selected={on} onClick={onClick} className={`-mb-px h-11 px-4 text-13.5 font-semibold cursor-pointer inline-flex items-center gap-2 whitespace-nowrap border-b-2 transition-colors ${on ? 'border-indigo-600 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'}`}>
      {children}<span className={`min-w-[1.5rem] px-1.5 py-0.5 rounded-full text-11.5 text-center tabular-nums ${on ? 'bg-slate-900 text-white' : pill}`}>{count}</span>
    </button>
  );
}

/** Collect keywords: choose the places, run them one after another, see each result. */
function CollectModal({ d, open, onClose, onDone }) {
  const [chosen, setChosen] = useState(null);
  const [progress, setProgress] = useState({});
  const [info, setInfo] = useState('');
  const [busy, error, run] = useAction();
  const kinds = d.sources.map(s => s.kind);
  const on = chosen || kinds.filter(k => k !== 'ai'); // AI suggestions cost a request, so they are read only when you tick them
  const toggle = (k) => setChosen(on.includes(k) ? on.filter(x => x !== k) : [...on, k]);
  const go = () => run('go', async () => {
    setProgress(Object.fromEntries(on.map(k => [k, 'running'])));
    let added = 0;
    for (const k of on) { // one place at a time, so each shows its own result as it finishes
      const out = await api(`/businesses/${d.bid}/keyword-workspace/collect`, { method: 'POST', body: { sources: [k] }, timeout: 240000 });
      setProgress(p => ({ ...p, [k]: out.report[k] }));
      if (out.report.summary?.note) setInfo(out.report.summary.note); // the business summary was missing and was built first
      added += out.report[k].new;
      onDone(false);
    }
    onDone(true, added);
  });
  return (
    <Modal open={open} onClose={onClose} width="max-w-xl" title="Collect keywords"
      footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" icon={RefreshCw} busy={busy === 'go'} disabled={!on.length} onClick={go}>{d.totals.all ? 'Collect again' : 'Collect'} ({on.length})</Button></>}>
      <p className="text-13 text-slate-600 mb-3">Each place adds to one list. A keyword found in several places stays one row with every place shown.</p>
      <ErrorNote>{error}</ErrorNote>
      {info && <p role="status" className="mb-3 text-12.5 text-emerald-800 bg-emerald-50 rounded px-3 py-1.5">{info}</p>}
      <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-inset ring-slate-200">
        {d.sources.map(s => {
          const p = progress[s.kind];
          return (
            <li key={s.kind} className="px-3 py-2.5 flex items-center gap-3">
              <input type="checkbox" aria-label={s.label} checked={on.includes(s.kind)} onChange={() => toggle(s.kind)} disabled={busy === 'go'} className="w-4 h-4 accent-indigo-600" />
              <div className="min-w-0 flex-1">
                <div className="text-13 font-semibold text-slate-900">{s.label}{s.kind === 'ai' && <span className="ml-2 text-11 font-medium text-slate-500">on request</span>}</div>
                <div className="text-12 text-slate-500">{s.count ? `${s.count} in the list` : 'Not collected yet'}</div>
              </div>
              {p === 'running' ? <span className="text-12 text-indigo-700 inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" />Reading…</span>
                : p ? <span className={`text-12 text-right max-w-[220px] ${p.note ? 'text-amber-700' : 'text-emerald-700'}`}>{p.note || `${p.found} found, ${p.new} new`}</span> : null}
            </li>);
        })}
      </ul>
      <p className="mt-3 text-12.5 text-slate-600">Competitors: {d.competitors.done ? d.competitors.domains.join(', ') : <>none saved. <Link to="/competitor-finder" className="font-semibold text-indigo-700 underline">Choose them first</Link> for gaps and competitor keywords.</>}</p>
      {!d.volumes && <p className="mt-2 text-12 text-slate-500">Google Ads is not connected, so there are no search volumes.</p>}
    </Modal>
  );
}

export default function KeywordWorkspace({ b, onUse }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [view, setView] = useState(params.get('tag') === 'gap' ? 'gap' : 'open');
  const [source, setSource] = useState(params.get('source') || '');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ key: 'volume', dir: 'desc' }); // ranked by monthly searches, highest first; the other headings re-sort it
  const [band, setBand] = useState(''); // rank filter: top3 | page1 | page2 | page3 | none
  const [limit, setLimit] = useState(PAGE);
  const [sel, setSel] = useState(() => new Set());
  const [collecting, setCollecting] = useState(false);
  const [place, setPlace] = useState(''); // location filter: '' = the country (Google's own figures), or one of the project's places
  const [period, setPeriod] = useState('12'); // time filter: the average of the last 12, 6 or 3 months, or one month
  const [fig, setFig] = useState(null); // the table's keywords in the chosen place: { place, metrics }
  const [figBusy, setFigBusy] = useState(false);
  const [figError, setFigError] = useState('');
  const [kdLocal, setKdLocal] = useState({}); // difficulty scores just worked out: { id: { kd, detail } }
  const [kdBusy, setKdBusy] = useState(() => new Set()); // keyword ids being read now
  const [kdNote, setKdNote] = useState('');
  const [kdTick, setKdTick] = useState(0); // goes up when a round of scoring ends, so the next unscored keywords are taken
  const kdTried = useRef(new Set()); // ids already asked for: a failure is not asked again by itself
  const kdRunning = useRef(false);
  const trendsAsked = useRef('');
  const [fMin, setFMin] = useState(''); // filters: searches a month at least, difficulty band, 12-month trend, intent
  const [fKd, setFKd] = useState('');
  const [fTrend, setFTrend] = useState('');
  const [fIntent, setFIntent] = useState('');
  const [fIndex, setFIndex] = useState(''); // Search Console: has data / has none
  const indexAsked = useRef('');
  const [plannerQ, setPlannerQ] = useState('');
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const show = view === 'picked' ? 'picked' : view === 'dismissed' ? 'dismissed' : 'open';
  const tag = view === 'gap' || view === 'almost' ? view : '';
  const qs = new URLSearchParams({ show, ...(source && { source }), ...(tag && { tag }), ...(q.trim() && { q: q.trim() }) }).toString();
  const r = useApi(`/businesses/${b.id}/keyword-workspace?${qs}`);
  const d = r.data;
  const placesApi = useApi(`/businesses/${b.id}/keyword-workspace/places`);
  const places = placesApi.data?.places || [];
  const wantsFigures = place !== '' || period !== '12'; // the country over 12 months is what the list already holds; anything else is asked of Google Ads
  const wordsKey = (d?.items || []).map(i => i.keyword).join('|');
  useEffect(() => {
    if (!wantsFigures || !d?.items?.length) { setFig(null); setFigError(''); return undefined; }
    let live = true;
    const name = place || places[0]?.name || '';
    if (!name) return undefined;
    setFigBusy(true); setFigError('');
    api(`/businesses/${b.id}/keyword-workspace/metrics`, { method: 'POST', body: { place: name, keywords: d.items.map(i => i.keyword).slice(0, 500) }, timeout: 120000 })
      .then(res => { if (live) { setFig(res); setFigError(res.reason || res.note || ''); } }).catch(e => { if (live) setFigError(e.message || 'Google Ads did not answer.'); }).finally(() => { if (live) setFigBusy(false); });
    return () => { live = false; };
  }, [place, wantsFigures, wordsKey, places.length]); // eslint-disable-line react-hooks/exhaustive-deps -- when the place or the list changes
  // Search Console is asked by itself: each keyword's views, clicks and average position
  useEffect(() => {
    if (!d?.items?.length || indexAsked.current === wordsKey) return;
    indexAsked.current = wordsKey;
    api(`/businesses/${b.id}/keyword-workspace/search-console`, { method: 'POST', timeout: 120000 }).then(res => { if (res.performance) r.reload(true); }).catch(() => {});
  }, [wordsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // the last 12 months of searches are asked of Google Ads by themselves for the keywords that have none (one request for hundreds)
  useEffect(() => {
    if (!d?.items?.length || !d.items.some(i => i.trend == null) || trendsAsked.current === wordsKey) return;
    trendsAsked.current = wordsKey;
    api(`/businesses/${b.id}/keyword-workspace/trends`, { method: 'POST', timeout: 120000 }).then(res => { if (res.filled) r.reload(true); }).catch(() => {});
  }, [wordsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Only keywords that belong to this project stay in the list: the ones not checked yet are checked against the business by themselves (another company's brand, another service or place is set aside with the reason)
  const [fit, setFit] = useState({ busy: false, hidden: 0 });
  const fitAsked = useRef('');
  useEffect(() => {
    const left = d?.unchecked || 0;
    if (!left || !d?.fit_check || fitAsked.current === `${b.id}|${left}`) return undefined;
    fitAsked.current = `${b.id}|${left}`;
    let live = true;
    (async () => {
      setFit(f => ({ ...f, busy: true }));
      let hidden = 0;
      try {
        for (let round = 0; round < 8; round += 1) {
          const out = await api(`/businesses/${b.id}/keyword-workspace/relevance`, { method: 'POST', timeout: 180000 });
          hidden += out.hidden || 0;
          if (!live || !out.checked || !out.remaining) break;
        }
      } catch { /* the list stays as it is */ }
      if (live) { setFit({ busy: false, hidden }); r.reload(true); }
    })();
    return () => { live = false; };
  }, [d?.unchecked, b.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // searches per month for the chosen time: the 12-month figure is Google's own average; 6 and 3 are the average of those last months; or one month
  const searchesIn = (m) => {
    if (period === '12') return m.volume;
    const ms = m.monthly || [];
    if (!ms.length) return null;
    if (period === '6' || period === '3') { const last = ms.slice(-Number(period)); return Math.round(last.reduce((a, x) => a + x.searches, 0) / last.length); }
    const one = ms.find(x => `${x.year}-${x.month}` === period);
    return one ? one.searches : null;
  };
  const monthChoices = (() => { // the last 12 full months, the ones Google Ads reports (its month names are upper case)
    const NAMES = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
    const now = new Date();
    return Array.from({ length: 12 }, (_, n) => { const dt = new Date(now.getFullYear(), now.getMonth() - 12 + n, 1); return { key: `${dt.getFullYear()}-${NAMES[dt.getMonth()]}`, label: `${NAMES[dt.getMonth()].slice(0, 1)}${NAMES[dt.getMonth()].slice(1, 3).toLowerCase()} ${String(dt.getFullYear()).slice(2)}` }; });
  })();
  // reads the real top 10 on Google for each keyword and scores it with the full difficulty formula: a few at a time, about 15 seconds each
  const measure = async (idList) => {
    const todo = idList.slice(0, PAGE);
    if (!todo.length) return;
    setKdNote(''); setKdBusy(new Set(todo));
    let ok = 0, failed = 0, why = '';
    for (let n = 0; n < todo.length; n += 3) {
      const chunk = todo.slice(n, n + 3);
      try {
        const res = await api(`/businesses/${b.id}/keyword-workspace/difficulty`, { method: 'POST', body: { ids: chunk }, timeout: 240000 });
        setKdLocal(m => { const next = { ...m }; for (const x of res.results) if (x.kd != null) next[x.id] = { kd: x.kd, detail: x.detail }; return next; });
        for (const x of res.results) { if (x.kd != null) ok += 1; else { failed += 1; why = x.error || why; } }
      } catch (e) { failed += chunk.length; why = e.message || why; }
      setKdBusy(cur => { const next = new Set(cur); chunk.forEach(id => next.delete(id)); return next; });
    }
    setKdNote(failed ? `${ok} scored, ${failed} not: ${why}` : `${ok} scored`);
  };
  const rows = useMemo(() => {
    let list = [...(d?.items || [])];
    if (wantsFigures) list = list.map(i => { const m = fig?.metrics?.[i.keyword.toLowerCase().trim()]; return m ? { ...i, volume: searchesIn(m), index: m.index, comp: m.competition, cpc: m.cpc } : { ...i, volume: null, index: null, comp: null, cpc: null }; });
    list = list.map(i => (kdLocal[i.id] ? { ...i, difficulty: kdLocal[i.id].kd, kd_detail: kdLocal[i.id].detail } : i)); // the difficulty is the keyword's own score (not the location's)
    if (fMin) list = list.filter(i => (i.volume || 0) >= Number(fMin));
    if (fKd) list = list.filter(i => i.difficulty != null && KD_BAND[fKd](i.difficulty));
    if (fTrend) list = list.filter(i => i.change != null && (fTrend === 'up' ? i.change >= 10 : fTrend === 'down' ? i.change <= -10 : Math.abs(i.change) < 10));
    if (fIntent) list = list.filter(i => i.intent === fIntent);
    if (fIndex) list = list.filter(i => (fIndex === 'data' ? i.gsc?.views != null : i.gsc?.views == null));
    if (view === 'suggested') list = list.filter(i => i.suggested);
    if (band) list = list.filter(i => (band === 'none' ? i.rank == null : i.rank != null && bandOf(i.rank)?.[0] === band));
    const v = (i) => (sort.key === 'keyword' ? i.keyword : i[sort.key]);
    list.sort((a, c) => {
      const x = v(a), y = v(c);
      if (x == null && y == null) return 0;
      if (x == null) return 1; // no figure (not ranking, no volume...) always at the end, not at the top
      if (y == null) return -1;
      const o = typeof x === 'string' ? x.localeCompare(y) : x - y;
      if (o === 0) return (c.score ?? 0) - (a.score ?? 0) || a.keyword.localeCompare(c.keyword); // the same figure: the better opportunity first, then A to Z
      return sort.dir === 'asc' ? o : -o;
    });
    return list;
  }, [d, sort, view, band, fig, period, kdLocal, fMin, fKd, fTrend, fIntent, fIndex]); // eslint-disable-line react-hooks/exhaustive-deps
  const pager = usePager(rows, { size: PAGE, resetKey: `${view}|${band}|${q}|${source}|${sort.key}|${sort.dir}|${fMin}|${fKd}|${fTrend}|${fIntent}|${fIndex}` });
  useEffect(() => {
    if (kdRunning.current || view === 'dismissed') return;
    const todo = pager.rows.filter(i => i.difficulty == null && !kdTried.current.has(i.id)).map(i => i.id);
    if (!todo.length) return;
    kdRunning.current = true;
    todo.forEach(id => kdTried.current.add(id));
    measure(todo).finally(() => { kdRunning.current = false; setKdTick(x => x + 1); });
  }, [pager.rows, kdTick, view]); // eslint-disable-line react-hooks/exhaustive-deps -- the keywords on the page that have no score yet are scored by themselves
  const topVolume = useMemo(() => Math.max(1, ...rows.map(i => i.volume || 0)), [rows]);
  if (r.error) return <Card><ErrorNote>{r.error.message}</ErrorNote></Card>;
  if (!d) return <SkList rows={6} />;

  const base = `/businesses/${b.id}/keyword-workspace`;
  const count = (t) => d.tags.find(x => x.tag === t)?.count || 0;
  const suggestedAll = rows.filter(i => i.suggested && !i.picked);
  const shown = pager.rows;
  const allOn = shown.length > 0 && shown.every(i => sel.has(i.id));
  const toggle = (id) => setSel(s => { const x = new Set(s); x.has(id) ? x.delete(id) : x.add(id); return x; });
  const ids = [...sel];
  const act = (kind, list, msg) => run(kind, async () => { await api(`${base}/${kind}`, { method: 'POST', body: { ids: list } }); setSel(new Set()); r.reload(true); toast(msg); });
  const searchPlanner = () => run('planner', async () => {
    const res = await api(`${base}/planner-search`, { method: 'POST', body: { q: plannerQ.trim() }, timeout: 120000 });
    if (res.reason) { toast(res.reason); return; }
    setQ(plannerQ.trim()); setLimit(PAGE); r.reload(true);
    toast(`Google gave ${res.found} ideas: ${res.added} new added${res.left_out ? `, ${res.left_out} left out as not about your business` : ''}`);
  });
  // Picking opens Prepare Keywords, so every saved keyword is worded the way customers search it and has a role and a priority before it reaches My Keywords
  const pick = (list) => { const names = rows.filter(i => list.includes(i.id)).map(i => i.keyword).slice(0, 12); if (names.length) navigate(`/keyword-management/prepare?k=${names.map(encodeURIComponent).join('|')}`); };
  const go = (v) => { setView(v); setLimit(PAGE); setSel(new Set()); };
  const empty = d.totals.all === 0;
  const sourcesWith = d.sources.filter(s => s.count);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 pb-20">
      <ErrorNote>{error}</ErrorNote>
      {fit.busy && <div className="flex items-center gap-2 rounded-lg bg-indigo-50 ring-1 ring-indigo-200 px-3 py-2 text-13 text-indigo-900"><Loader2 size={14} className="animate-spin" />Checking which keywords belong to {b.name || 'this project'}…</div>}
      {!fit.busy && fit.hidden > 0 && <div className="rounded-lg bg-slate-50 ring-1 ring-slate-200 px-3 py-2 text-13 text-slate-700">{fit.hidden} keyword{fit.hidden === 1 ? '' : 's'} did not belong to this project (another company's brand, service or place) and {fit.hidden === 1 ? 'was' : 'were'} put under Set aside, with the reason. You can put any back.</div>}
      {!fit.busy && (d.unchecked || 0) > 0 && !d.fit_check && <div className="rounded-lg bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-13 text-amber-900">{d.unchecked} keyword{d.unchecked === 1 ? ' has' : 's have'} not been checked against this project, because no AI is set up for the relevance check. Unrelated keywords may show here.</div>}

      {/* What is in the list, the one thing to do first, and the way out of the page; the views of the list are the tabs under it */}
      <div className="rounded-xl bg-white ring-1 ring-slate-200 shadow-sm">
        <div className="px-5 py-4 flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="min-w-0">
            <div className="text-18 font-semibold text-slate-900 leading-tight">{empty ? 'No keywords yet' : <><span className="tabular-nums">{d.totals.all}</span> keywords</>}</div>
            <div className="mt-0.5 text-13 text-slate-500">{empty ? 'Collect them from your website, Google and your competitors.' : `Collected from ${sourcesWith.length} place${sourcesWith.length === 1 ? '' : 's'}. ${d.totals.picked} picked, ${d.totals.open} still to look at.`}</div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Link to="/keyword-management/ai"><Button>Find more ideas</Button></Link>
            {!empty && <Button icon={Download} onClick={() => exportCsv(rows, b.name)} disabled={!rows.length} title="Download every keyword in this list (all pages, with the search and view applied) as a CSV file">Export CSV</Button>}
            <Button variant="primary" icon={RefreshCw} onClick={() => setCollecting(true)}>{empty ? 'Collect keywords' : 'Collect again'}</Button>
          </div>
        </div>
        {!empty && (
      <div role="tablist" aria-label="Which keywords" className="flex overflow-x-auto px-2 border-t border-slate-200">
        <View on={view === 'open'} onClick={() => go('open')} count={d.totals.open}>To look at</View>
        <View on={view === 'suggested'} onClick={() => go('suggested')} count={d.totals.suggested || 0} tone="indigo"><Sparkles size={13} className="text-amber-500" />Suggested</View>
        <View on={view === 'gap'} onClick={() => go('gap')} count={count('gap')} tone="red">Gaps</View>
        <View on={view === 'almost'} onClick={() => go('almost')} count={count('almost')} tone="amber">Almost there</View>
        <View on={view === 'picked'} onClick={() => go('picked')} count={d.totals.picked} tone="green">Picked</View>
        {d.totals.dismissed > 0 && <View on={view === 'dismissed'} onClick={() => go('dismissed')} count={d.totals.dismissed}>Set aside</View>}
      </div>
        )}
      </div>

      {empty ? (
        <Card><div className="py-12 text-center">
          <Sparkles size={28} className="mx-auto text-indigo-500" />
          <h3 className="mt-3 text-16 font-semibold text-slate-900">Your keyword list is empty</h3>
          <p className="mt-1 text-13 text-slate-500 max-w-md mx-auto">Press <b>Collect keywords</b>. We read your website, your Google searches, your services, your competitors and Google, and put everything in one list with where each came from.</p>
        </div></Card>
      ) : (
        <>

          <Card pad={false}>
            <div className="border-b border-slate-100">
              {/* row 1: find. Search the list, search the Keyword Planner for new ones, pick the best */}
              <div className="px-4 pt-4 pb-3 flex flex-wrap items-center gap-3">
                <label className="relative flex-1 min-w-[240px] max-w-md">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input value={q} onChange={e => { setQ(e.target.value); setLimit(PAGE); }} placeholder="Search your keywords" aria-label="Search keywords" className="h-10 w-full pl-9 pr-8 text-13 rounded-lg bg-white ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none placeholder:text-slate-400" />
                  {q && <button type="button" onClick={() => setQ('')} aria-label="Clear the search" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 cursor-pointer"><X size={13} /></button>}
                </label>
                <div className="flex items-stretch h-10 flex-1 min-w-[300px] max-w-xl rounded-lg bg-white ring-1 ring-inset ring-slate-300 overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500">
                  <Sparkles size={15} className="self-center ml-3 text-indigo-500 shrink-0" />
                  <input value={plannerQ} onChange={e => setPlannerQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') searchPlanner(); }} placeholder="Find new keywords in Google Keyword Planner" aria-label="Search the Keyword Planner" className="flex-1 min-w-0 px-2.5 text-13 outline-none bg-transparent placeholder:text-slate-400" />
                  <button type="button" disabled={plannerQ.trim().length < 2 || busy === 'planner'} onClick={searchPlanner} className="px-4 inline-flex items-center gap-1.5 text-13 font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed cursor-pointer transition-colors">
                    {busy === 'planner' ? <Loader2 size={14} className="animate-spin" /> : null}Find</button>
                </div>
                {(view === 'open' || view === 'suggested') && suggestedAll.length > 0 && (
                  <Button className="ml-auto h-10" icon={Star} busy={busy === 'pick'} onClick={() => pick(suggestedAll.map(i => i.id))} title="The best-looking keywords: searches, ease, gaps and how many places agree">Pick {suggestedAll.length} suggested</Button>
                )}
              </div>
              {/* row 2: the figures are for this place and this time, then the filters */}
              <div className="px-4 pb-4 flex flex-wrap items-center gap-x-3 gap-y-2.5">
                <PlacePicker b={b} value={place} places={places} onChange={setPlace} onSaved={() => placesApi.reload(true)} />
                <label className="relative inline-flex items-center"><CalendarDays size={14} className="absolute left-3 text-slate-400 pointer-events-none z-10" />
                  <Select value={period} onChange={e => setPeriod(e.target.value)} aria-label="Time" className="h-9 w-[170px] appearance-none rounded-lg ring-1 ring-inset ring-slate-300 bg-white pl-9 pr-8 text-13 font-medium text-slate-800 cursor-pointer hover:bg-slate-50 text-left">
                    <option value="12">Last 12 months</option><option value="6">Last 6 months</option><option value="3">Last 3 months</option>{[...monthChoices].reverse().map(m => <option key={m.key} value={m.key}>{m.label}</option>)}</Select>
                </label>
                <span className="hidden lg:block h-6 w-px bg-slate-200" aria-hidden="true" />
                <span className="text-11.5 font-semibold uppercase tracking-wide text-slate-400">Filters</span>
                <Pill label="Searches" value={fMin} onChange={setFMin} options={[['100', '100+ a month', '100+'], ['500', '500+ a month', '500+'], ['1000', '1,000+ a month', '1,000+'], ['5000', '5,000+ a month', '5,000+']]} />
                <Pill label="Difficulty" value={fKd} onChange={setFKd} options={[['easy', 'Easy (under 30)', 'Easy'], ['medium', 'Medium (30 to 49)', 'Medium'], ['hard', 'Challenging (50 to 69)', 'Challenging'], ['very', 'Very hard (70+)', 'Very hard']]} />
                <Pill label="Trend" value={fTrend} onChange={setFTrend} options={[['up', 'Rising', 'Rising'], ['steady', 'Steady', 'Steady'], ['down', 'Falling', 'Falling']]} />
                <Pill label="Intent" value={fIntent} onChange={setFIntent} options={[['informational', 'Informational'], ['commercial', 'Commercial'], ['transactional', 'Transactional'], ['local', 'Local'], ['navigational', 'Navigational']]} />
                <Pill label="Search Console" value={fIndex} onChange={setFIndex} options={[['data', 'Has data', 'Has data'], ['none', 'No data', 'No data']]} />
                {(fMin || fKd || fTrend || fIntent || fIndex) && <button type="button" onClick={() => { setFMin(''); setFKd(''); setFTrend(''); setFIntent(''); setFIndex(''); }} className="text-12.5 font-semibold text-indigo-700 hover:underline inline-flex items-center gap-1 cursor-pointer"><X size={12} />Clear filters</button>}
                <span className="ml-auto text-12.5 text-slate-500 tabular-nums inline-flex items-center gap-2">
                  {figBusy && <span className="inline-flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" />Asking Google Ads…</span>}
                  {!figBusy && figError && <span className="text-amber-700" title={figError}>{String(figError).slice(0, 60)}</span>}
                  <span>Showing <b className="text-slate-800">{rows.length}</b> of {d.items.length}</span>
                </span>
              </div>
            </div>

            {rows.length === 0 ? (
              <div className="py-12 text-center text-13 text-slate-500">Nothing here. <button type="button" onClick={() => { setSource(''); setQ(''); go('open'); }} className="font-semibold text-indigo-700 hover:underline cursor-pointer">Show everything to look at</button></div>
            ) : (
              <div className="overflow-auto max-h-[74vh]">
                <table className="w-full text-13 min-w-[760px]">
                  <thead className="text-11.5 uppercase tracking-wide text-slate-500 [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50 [&_th]:shadow-[inset_0_-1px_0_rgb(226_232_240)]">
                    <tr>
                      <th className="w-10 px-3 py-2"><input type="checkbox" aria-label="Select all shown" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(shown.map(i => i.id)))} /></th>
                      <SortTh id="keyword" sort={sort} setSort={setSort} what="A search people type into Google." why="Click the name to check its searches, cost and related ideas. Click the heading to sort A to Z." from="your website, Search Console, your profile, competitor sites, Google suggestions and AI.">Keyword</SortTh>
                      <SortTh id="volume" sort={sort} setSort={setSort} right what="How many times a month people search it in the chosen location and time, and under it what advertisers bid at the top of the page per click." why="Shows which keywords are worth the effort, and what they are worth." from="Google Ads Keyword Planner (needs Google Ads connected). Blank when Google gave no figure for that place.">Searches / mo</SortTh>
                      <SortTh id="difficulty" sort={sort} setSort={setSort} right what="How hard it is to rank for it, 0 to 100, worked out from the real top 10 on Google for the keyword: their authority, backlinks, content, the features on the page and the intent. Higher is harder. The arrow beside it shows how the searches moved in the last 12 months: green up when rising by 10% or more, red down when falling by 10% or more." why="Pick easier ones first." from="Google's results page (through Apify), Moz authority, the Google Ads search volume and our saved backlinks. It is worked out by itself, a page at a time.">Difficulty</SortTh>
                      <SortTh id="index" sort={sort} setSort={setSort} right what="The keyword's index value: Google's competition index, 0 to 100 (higher means more advertisers compete for it). Under it, how the keyword performs in Google Search Console: views, clicks and average position in the last 90 days." why="A high index means a crowded, costly keyword; many views and few clicks mean the title needs work." from="Google Keyword Planner (index value) and Google Search Console (views, clicks, position).">Index</SortTh>
                      <th className="px-3 py-2 text-left"><Head what="Where it stands: Competitors only (a gap: they use it, you do not), You and competitors, Only you, a New idea from Google or AI, a Top 3 win, or Almost (page 2). Under it, the places it was found." why="Start with the competitors-only gaps and the page-2 keywords." from="comparing your own places (website, profile, Search Console) with the competitor sites, Google and AI. Hover for the detail.">Where it stands</Head></th>
                      <SortTh id="rank" sort={sort} setSort={setSort} right what="Your average position on Google for it, last 90 days." why="Shows where you already show up." from="Google Search Console. Blank when Google has not shown your site for it.">Your rank</SortTh>
                      <th className="px-3 py-2 text-right"><Head right what="Things you can do with this keyword right here." why="Pick saves it to your list; Set aside hides it; Check opens its numbers.">Actions</Head></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {shown.map(i => (
                      <tr key={i.id} onClick={() => toggle(i.id)} className={`cursor-pointer transition-colors ${sel.has(i.id) ? 'bg-indigo-50/70 shadow-[inset_3px_0_0_#6366f1]' : i.picked ? 'bg-emerald-50/40 hover:bg-emerald-50/70' : 'hover:bg-slate-50'}`}>
                        <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${i.keyword}`} checked={sel.has(i.id)} onChange={() => toggle(i.id)} /></td>
                        <td className="px-3 py-2.5 min-w-[220px]">
                          <span className="inline-flex items-center gap-1.5">
                            {i.suggested && <Sparkles size={12} className="text-amber-500 shrink-0" aria-label="Suggested" />}
                            <Link to={`/keyword-overview?q=${encodeURIComponent(i.keyword)}`} onClick={e => e.stopPropagation()} title="Check its searches, cost and related ideas" className="font-semibold text-slate-900 hover:text-indigo-700 hover:underline">{i.keyword}</Link>
                            {i.picked && <Badge tone="green">Picked</Badge>}
                          </span>
                          {i.fit?.why && <span className={`block text-11.5 ${i.fit.fit === 'no' ? 'text-amber-700' : 'text-slate-500'}`}>{i.fit.fit === 'no' ? 'Hidden: ' : i.fit.fit === 'maybe' ? 'Check: ' : i.fit.for ? `Fits ${i.fit.for}: ` : 'Fits: '}{i.fit.why}</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right" title="Searches per month in your country (Google Ads Keyword Planner)"><div className="tabular-nums font-medium text-slate-900">{n0(i.volume)}</div>{i.volume > 0 && <div className="mt-1 h-1 rounded-full bg-slate-100 ml-auto w-16"><div className="h-1 rounded-full bg-indigo-300" style={{ width: `${Math.max(5, (i.volume / topVolume) * 100)}%` }} /></div>}{i.cpc != null && <div className="mt-0.5 text-11 text-slate-500 tabular-nums">₹{i.cpc} / click</div>}</td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                          <span className="inline-flex items-center justify-end gap-1.5">
                            {i.difficulty != null ? <KdChip v={i.difficulty} detail={i.kd_detail} />
                              : kdBusy.has(i.id) || !kdTried.current.has(i.id) ? <span className="inline-flex items-center gap-1.5 text-12 text-slate-500" title="Reading the top 10 on Google for this keyword; the score appears by itself"><Loader2 size={13} className="animate-spin" />Scoring…</span>
                                : <button type="button" onClick={() => measure([i.id])} className="text-12 font-semibold text-amber-700 hover:underline cursor-pointer" title="Google's results could not be read for it. Try again.">Retry</button>}
                            <Arrow change={i.change} months={i.trend} />
                          </span></td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap"><IndexCell i={i} /></td>
                        <td className="px-3 py-2.5"><Origin i={i} /></td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap" title={i.rank != null ? `Average position ${i.rank.toFixed(1)} on Google over the last 90 days${i.impressions ? `: ${i.impressions.toLocaleString('en-IN')} impressions, ${(i.clicks || 0).toLocaleString('en-IN')} clicks` : ''} (Search Console)` : 'Google has not shown your site for this keyword in the last 90 days'}>
                          {i.rank != null ? (() => { const n = Math.max(1, Math.round(i.rank)); const bd = bandOf(i.rank); return <span className="inline-flex items-center justify-end gap-1.5"><span className={`font-semibold tabular-nums ${n <= 10 ? 'text-emerald-700' : 'text-slate-800'}`}>#{n}</span>{bd && <span className={`rounded-full px-1.5 py-px text-11 font-semibold ${bd[3]}`}>{bd[1]}</span>}</span>; })() : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                          <span className="inline-flex gap-1.5">
                            {!i.picked && show !== 'dismissed' && <Act icon={Check} tone="green" tip="Pick and prepare: word it the way customers search (near me, in your areas), set primary or secondary and a priority, then save it to My Keywords." onClick={() => pick([i.id])} />}
                            {show === 'dismissed' ? <Act icon={Undo2} tone="slate" tip="Put back: return it to the list to look at." onClick={() => act('restore', [i.id], 'Put back in the list')} />
                              : !i.picked && <Act icon={EyeOff} tone="amber" tip="Set aside: hide it from this list. It stays under Set aside if you change your mind." onClick={() => act('dismiss', [i.id], 'Set aside')} />}
                            <Link to={`/keyword-overview?q=${encodeURIComponent(i.keyword)}`}><Act icon={Search} tone="sky" tip="Check: open its searches per month, cost and related ideas." /></Link>
                          </span>
                        </td>
                      </tr>))}
                  </tbody>
                </table>
              </div>
            )}
            <Pager p={pager} label="keywords" />
          </Card>

          {/* What to do next */}
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[220px] text-13 text-indigo-950">
              {d.totals.picked ? <><b>{d.totals.picked} keyword{d.totals.picked === 1 ? '' : 's'} picked.</b> Next, give each one a page on your website.</> : <><b>Pick the keywords worth working on.</b> Tick the rows you want, or pick the suggested ones.</>}
            </div>
            <Button variant="primary" icon={ArrowRight} disabled={!d.totals.picked} onClick={() => onUse('mapping')}>Map them to pages</Button>
          </div>
        </>
      )}

      {ids.length > 0 && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-30 max-w-[calc(100vw-32px)]">
          <div role="toolbar" aria-label="Selected keywords" className="bg-slate-900 text-white rounded-xl shadow-xl px-4 py-2.5 flex flex-wrap items-center gap-3">
            <span className="text-13 font-semibold">{ids.length} selected</span>
            {view !== 'picked' && <Button size="sm" variant="primary" icon={ArrowRight} onClick={() => pick(ids)}>Pick and prepare</Button>}

            {view === 'dismissed' ? <Button size="sm" icon={Undo2} onClick={() => act('restore', ids, 'Put back in the list')}>Put back</Button>
              : <Button size="sm" icon={EyeOff} busy={busy === 'dismiss'} onClick={() => act('dismiss', ids, `${ids.length} set aside`)}>Set aside</Button>}
            <button type="button" onClick={() => setSel(new Set())} className="text-12.5 text-slate-300 hover:text-white underline cursor-pointer">Clear</button>
          </div>
        </div>
      )}
      <CollectModal d={{ ...d, bid: b.id }} open={collecting} onClose={() => setCollecting(false)} onDone={(final, added) => { r.reload(true); if (final) toast(`${added} new keyword${added === 1 ? '' : 's'} collected`); }} />
      {toastNode}
    </div>
  );
}

function exportCsv(items, name) {
  downloadCsv(`keywords-${name || 'site'}`, ['Keyword', 'Searches per month', 'Difficulty', 'Change in 12 months (%)', 'Index', 'Search Console views', 'Search Console clicks', 'Your rank', 'Kind', 'Score', 'Sources', 'Competitors'],
    items.map(i => [i.keyword, i.volume ?? '', i.difficulty ?? '', i.change ?? '', i.index ?? '', i.gsc?.views ?? '', i.gsc?.clicks ?? '', i.rank ?? '', i.tag || '', i.score ?? '', i.sources.map(s => s.label).join('; '), i.competitors.join('; ')]));
}
