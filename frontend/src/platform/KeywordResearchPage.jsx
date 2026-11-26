import KeywordWorkspace from './KeywordWorkspace';
import DataTable, { usePager, Pager, useSorted, SortTh, downloadCsv } from './DataTable';
import KeywordMappingTab from './KeywordMappingTab';
import { UseKeywordsModal } from './KeywordPlacement';
import KeywordRowActions, { indexProblem } from './KeywordRowActions';
import { Act, Head } from './TableBits';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AutopilotPanel } from './AutopilotPanels';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search, Plus, Sparkles, FileText, Trash2, Loader2, MapPin, Globe, Users, X, Star, CheckCircle2, CircleDashed, AlertTriangle, Copy, Check, BarChart2,
  Pencil, PenLine, Eye, TrendingUp, TrendingDown, Download, Flame, HelpCircle, Navigation, Tag, Wrench, ExternalLink, ArrowLeft, ArrowRight
} from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { SeoShell, Card, Tabs, Badge, Button, inputCls, Meter, ErrorNote, useToast, useAction, useUrlTab, useDoubleConfirm, SkTable, SkCard } from './SeoUi';
import { api, useApi, usePoll, fmtDateTime, fmt, SEO_API } from './seoApi';
import { pathOnly as pathOf } from './siteUtils';
import Select from '../components/Select';
import KeywordStatus from './KeywordStatus';

/**
 * Keyword intelligence for the selected business. Discovery starts from what the platform knows
 * (category, services, area + nearby localities, the website audit, competitors) and pulls real
 * searches from Google Autocomplete; volumes need the Google Ads Keyword Planner API.
 */

const INTENT_TONE = { local: 'blue', transactional: 'green', commercial: 'orange', informational: 'violet' };
const GROUPS = {
  local: { label: 'Local', icon: MapPin, tone: 'bg-sky-50 text-sky-700 ring-sky-200', hint: 'Searches naming your area or nearby localities' },
  near_me: { label: 'Near me', icon: Navigation, tone: 'bg-indigo-50 text-indigo-700 ring-indigo-200', hint: '"Near me" searches: people ready to visit' },
  service: { label: 'Services', icon: Wrench, tone: 'bg-slate-50 text-slate-700 ring-slate-200', hint: 'Searches for what you offer' },
  question: { label: 'Questions', icon: HelpCircle, tone: 'bg-violet-50 text-violet-700 ring-violet-200', hint: 'Questions to answer in FAQs and blog posts' },
  fresh: { label: 'Fresh & seasonal', icon: Flame, tone: 'bg-orange-50 text-orange-700 ring-orange-200', hint: 'What people are searching this year: offers, latest, new' },
  competitor: { label: 'From competitors', icon: Users, tone: 'bg-rose-50 text-rose-700 ring-rose-200', hint: 'Keywords competitors rank or build pages for (from competitor research)' },
  suggested: { label: 'Suggested', icon: Sparkles, tone: 'bg-violet-50 text-violet-700 ring-violet-200', hint: 'Weekly Autopilot suggestions waiting for you: track one or reject it' },
  brand: { label: 'Your brand', icon: Tag, tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200', hint: 'People searching for you by name' }
};
const ORDER = ['competitor', 'local', 'near_me', 'service', 'question', 'fresh', 'brand'];
const kd = (d) => (d == null ? ['—', 'gray'] : d < 30 ? ['Easy', 'green'] : d < 55 ? ['Medium', 'amber'] : ['Hard', 'red']);

function Chip({ on, children, onClick, onRemove, title }) {
  return (
    <span className={`inline-flex items-center rounded-lg ring-1 ring-inset text-12.5 font-medium transition-colors ${on ? 'bg-indigo-50 text-indigo-900 ring-indigo-300' : 'bg-white text-slate-500 ring-slate-200 hover:ring-slate-300'}`} title={title}>
      <button type="button" onClick={onClick} aria-pressed={Boolean(on)} className="pl-2 pr-2.5 py-1 cursor-pointer inline-flex items-center gap-1.5">
        <span className={`w-3.5 h-3.5 rounded-full inline-flex items-center justify-center shrink-0 ${on ? 'bg-indigo-600 text-white' : 'ring-1 ring-inset ring-slate-300'}`}>{on && <Check size={9} strokeWidth={3} />}</span>{children}
      </button>
      {onRemove && <button type="button" onClick={onRemove} className="pr-2 text-slate-400 hover:text-slate-700 cursor-pointer" aria-label="Remove"><X size={11} /></button>}
    </span>
  );
}

function Stars({ n }) {
  return <span className="inline-flex gap-px" title={`Google suggests this strongly (${n}/5)`}>{[1, 2, 3, 4, 5].map(i => <Star key={i} size={11} className={i <= n ? 'fill-amber-400 text-amber-400' : 'text-slate-200'} />)}</span>;
}

function Coverage({ c }) {
  if (!c) return <span className="text-11.5 text-slate-400">Not audited</span>;
  if (c.status === 'covered') return <span className="inline-flex items-center gap-1 text-11.5 text-emerald-700" title="A page's title or main heading targets this"><CheckCircle2 size={12} /> <span className=" truncate max-w-[140px]">{pathOf(c.page)}</span></span>;
  if (c.status === 'partial') return <span className="inline-flex items-center gap-1 text-11.5 text-amber-700" title="A page is close, but doesn't target every word"><CircleDashed size={12} /> <span className=" truncate max-w-[140px]">{pathOf(c.page)}</span></span>;
  return <span className="inline-flex items-center gap-1 text-11.5 text-red-600 font-medium" title="No page on the site targets this: a content gap"><AlertTriangle size={12} /> Gap</span>;
}

/* ── Discover ─────────────────────────────────────────────────────────── */

function Discover({ b, tracked, onTracked, seedSearch }) {
  const ctx = useApi(`/businesses/${b.id}/keywords/context`);
  const c = ctx.data;
  const [seeds, setSeeds] = useState(null); // [{text, on}]
  const [areas, setAreas] = useState(null);
  const [custom, setCustom] = useState('');
  const [adding, setAdding] = useState(false); // the "Add a service" box is open
  const [result, setResult] = useState(null);
  const ap = useApi(`/businesses/${b.id}/autopilot`); // keywords the weekly Autopilot suggests: rows of the table below, waiting for you
  const [selected, setSelected] = useState([]);
  const discRows = React.useRef({}); // the rows each table shows now (after its search and filters), by table
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();

  // Start from the business: its services on (up to 4) and its own area, city and the two nearest localities.
  useEffect(() => {
    if (!c || seeds) return;
    setSeeds(c.seeds.map((s, i) => ({ text: s, on: i < 4 })));
    setAreas([...c.areas.map(a => ({ text: a, on: true })), ...c.nearby.map((a, i) => ({ text: a, on: i < 2 }))]);
  }, [c]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeSeeds = (seeds || []).filter(s => s.on).map(s => s.text);
  const activeAreas = (areas || []).filter(a => a.on).map(a => a.text);
  const find = (extra) => run('find', async () => {
    const list = extra && !activeSeeds.includes(extra) ? [extra, ...activeSeeds] : activeSeeds;
    const r = await api(`/businesses/${b.id}/keywords/discover`, { method: 'POST', body: { seeds: list, areas: activeAreas } });
    setResult(r); setSelected([]);
  });
  // Run once the starting point is ready, so the page opens with results. A keyword typed in the shared search box becomes one of the starting words.
  useEffect(() => {
    if (!seeds || result || busy) return;
    const t = (seedSearch?.text || '').trim().toLowerCase();
    if (t) { setSeeds(list => (list.some(x => x.text === t) ? list.map(x => (x.text === t ? { ...x, on: true } : x)) : [{ text: t, on: true }, ...list])); find(t); } else if (activeSeeds.length) find();
  }, [seeds]); // eslint-disable-line react-hooks/exhaustive-deps
  const seededN = React.useRef(seedSearch?.n || 0);
  useEffect(() => {
    if (!seedSearch?.n || seedSearch.n === seededN.current || !seeds) return;
    seededN.current = seedSearch.n;
    const t = seedSearch.text.trim().toLowerCase();
    setSeeds(list => (list.some(x => x.text === t) ? list.map(x => (x.text === t ? { ...x, on: true } : x)) : [{ text: t, on: true }, ...list]));
    find(t);
  }, [seedSearch?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  const addSeed = () => {
    const t = custom.trim().toLowerCase();
    if (!t) return;
    setSeeds(s => (s.some(x => x.text === t) ? s.map(x => (x.text === t ? { ...x, on: true } : x)) : [...s, { text: t, on: true }]));
    setCustom('');
  };
  const toggle = (setter, text) => setter(list => list.map(x => (x.text === text ? { ...x, on: !x.on } : x)));

  const trackedSet = new Set(tracked.map(k => k.keyword));
  const all = result?.keywords || [];
  const live = result?.data_source?.includes('keyword_planner');
  const track = (all_rows) => run('track', async () => {
    const fromAp = all_rows.filter(k => k.apId);
    const rows = all_rows.filter(k => !k.apId);
    for (const k of fromAp) await api(`/businesses/${b.id}/autopilot/items/${k.apId}/approve`, { method: 'POST', body: {} });
    if (fromAp.length) { ap.reload(true); onTracked(fromAp.map(k => k.keyword), fromAp.length); }
    if (!rows.length) { setSelected([]); return; }
    const body = rows.map(k => ({ keyword: k.keyword, volume: k.volume ?? null, difficulty: k.difficulty ?? null, cpc: k.cpc ?? null, intent: k.intent, target_url: k.coverage?.page ? pathOf(k.coverage.page) : null, priority: k.group === 'near_me' || k.group === 'local' ? 'High' : 'Medium' }));
    const r = await api(`/businesses/${b.id}/keywords`, { method: 'POST', body });
    setSelected([]); onTracked(rows.map(k => k.keyword), r.added);
    setResult(res => res && { ...res, keywords: res.keywords.map(k => (rows.some(x => x.keyword === k.keyword) ? { ...k, tracked: true } : k)) });
  });
  const reject = (k) => run('reject', async () => { await api(`/businesses/${b.id}/autopilot/items/${k.apId}/reject`, { method: 'POST', body: {} }); setSelected(s => s.filter(x => x !== k.keyword)); ap.reload(true); });
  if (ctx.error) return <ErrorNote>{ctx.error.message}</ErrorNote>;
  if (!c || !seeds) return <Card><div className="py-12 flex items-center justify-center gap-2 text-13 text-slate-500"><Loader2 size={16} className="animate-spin" /> Reading {b.name}'s profile and audits…</div></Card>;

  const waiting = (ap.data?.inbox || []).filter(i => i.kind === 'keyword_add');
  const waitBy = Object.fromEntries(waiting.map(i => [i.keyword, i]));
  const have = new Set(all.map(k => k.keyword));
  const suggestedRows = waiting.filter(i => !have.has(i.keyword)).map(i => ({ keyword: i.keyword, group: 'suggested', intent: null, stars: null, volume: null, difficulty: null, coverage: null, reason: i.reason, apId: i.id }));
  const marked = all.map(k => (waitBy[k.keyword] ? { ...k, reason: waitBy[k.keyword].reason, apId: waitBy[k.keyword].id } : k));
  const searches = [...suggestedRows, ...marked.filter(k => k.group !== 'question')];
  const questions = marked.filter(k => k.group === 'question');
  const isTracked = (k) => k.tracked || trackedSet.has(k.keyword);
  const pickCol = (id, list) => ({ id: 'pick', label: 'Select', csv: false, className: 'pl-4 pr-1 py-2 w-8', thClass: 'pl-4 pr-1 py-2.5 w-8',
    header: (() => { const sel = list.filter(k => !isTracked(k)); const shownNow = (discRows.current[id] || sel).filter(k => !isTracked(k)); return <input type="checkbox" className="accent-indigo-600" aria-label="Select all shown" checked={shownNow.length > 0 && shownNow.every(k => selected.includes(k.keyword))} onChange={e => setSelected(s => (e.target.checked ? [...new Set([...s, ...shownNow.map(k => k.keyword)])] : s.filter(x => !shownNow.some(k => k.keyword === x))))} />; })(),
    cell: k => <input type="checkbox" className="accent-indigo-600" disabled={isTracked(k)} checked={selected.includes(k.keyword)} onChange={() => setSelected(s => (s.includes(k.keyword) ? s.filter(x => x !== k.keyword) : [...s, k.keyword]))} aria-label={`Select ${k.keyword}`} /> });
  const keywordCol = (tag) => ({ id: 'keyword', header: tag ? 'Question' : 'Keyword', value: k => k.keyword, className: 'px-2 py-2',
    cell: k => { const G = GROUPS[k.group]; return <>
      <div className="text-slate-900" title={k.from_competitors || undefined}>{k.keyword}</div>{k.from_competitors && <div className="text-11 text-rose-700">{k.from_competitors}</div>}
      {k.reason && <div className="text-11.5 text-slate-500 mt-0.5">{k.reason}</div>}
      {!tag && <div className="mt-0.5 flex items-center gap-1.5"><span className={`text-10.5 font-semibold px-1.5 py-px rounded ring-1 ring-inset inline-flex items-center gap-1 ${G.tone}`}><G.icon size={10} /> {G.label}</span><span className="text-10.5 text-slate-400">{k.intent}</span></div>}</>; } });
  const demandCol = { id: 'demand', header: live ? 'Searches / mo' : 'Demand', first: 'desc', value: k => (live && k.volume != null ? k.volume : k.stars ?? null), className: 'px-2 py-2 whitespace-nowrap',
    cell: k => (live && k.volume != null ? <span className="tabular-nums text-slate-900">{fmt(k.volume)}{k.trend != null && k.trend !== 0 && <span className={`ml-1.5 text-11 font-semibold inline-flex items-center ${k.trend > 0 ? 'text-emerald-700' : 'text-red-600'}`}>{k.trend > 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}{Math.abs(k.trend)}%</span>}</span> : <Stars n={k.stars} />) };
  const difficultyCol = { id: 'difficulty', header: 'Difficulty', value: k => k.difficulty ?? null, className: 'px-2 py-2 whitespace-nowrap', cell: k => { const [dl, dt] = kd(k.difficulty); return k.difficulty != null ? <Badge tone={dt}>{dl} · {k.difficulty}</Badge> : '—'; } };
  const websiteCol = { id: 'website', header: 'Your website', value: k => k.coverage?.status || null, className: 'px-2 py-2', cell: k => <Coverage c={k.coverage} /> };
  const statusCol = { id: 'status', header: 'Status', right: true, value: k => (isTracked(k) ? (k.rank ? `Rank ${k.rank}` : 'Tracked') : 'Not tracked'), className: 'px-2 pr-4 py-2 text-right whitespace-nowrap',
    cell: k => (isTracked(k) ? <span className="text-11.5 text-emerald-700 font-medium">{k.rank ? `Rank ${k.rank}` : 'Tracked'}</span> : <span className="inline-flex items-center gap-3"><button type="button" onClick={() => track([k])} className="text-11.5 font-semibold text-indigo-700 hover:underline cursor-pointer">Track</button>{k.apId && <button type="button" onClick={() => reject(k)} title="Not for me: do not suggest it again" className="text-11.5 font-semibold text-slate-500 hover:text-red-600 hover:underline cursor-pointer">Reject</button>}</span>) };
  const statusFilter = { id: 'status', label: 'Status', options: [['new', 'Not tracked yet'], ['tracked', 'Tracked']], test: (k, v) => (isTracked(k) ? v === 'tracked' : v === 'new') };
  const siteFilter = result?.website_checked ? [{ id: 'site', label: 'Website', options: [['gap', 'Content gaps'], ['covered', 'Covered']], test: (k, v) => (v === 'gap' ? k.coverage?.status === 'gap' : Boolean(k.coverage?.status) && k.coverage.status !== 'gap') }] : [];

  return (
    <div className="space-y-3">
      {/* The weekly suggestions' switch: one slim bar at the top; the suggestions themselves are rows of the table below */}
      <AutopilotPanel key={b.id} bid={b.id} feature="keywords" hideItems onChanged={() => ap.reload(true)} />
      {/* What we search from, the one button, and where the keywords come from: one card, three lines */}
      <Card pad={false}>
        <div className="px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="flex-1 min-w-[300px] grid grid-cols-[4.75rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2.5">
            <div className="pt-1 text-11.5 font-semibold uppercase tracking-wide text-slate-500" title="Built from the profile and the website audit. Tick the ones to search from (up to 6)">Services
              <span className={`block font-normal normal-case tracking-normal ${activeSeeds.length ? 'text-slate-400' : 'text-amber-700 font-medium'}`}>{activeSeeds.length} of 6 chosen</span>
              <span className="block font-normal normal-case tracking-normal mt-0.5"><button type="button" onClick={() => setSeeds(l => l.map((x, i) => ({ ...x, on: i < 6 })))} className="text-indigo-700 hover:underline cursor-pointer">First 6</button>{activeSeeds.length > 0 && <> · <button type="button" onClick={() => setSeeds(l => l.map(x => ({ ...x, on: false })))} className="text-slate-500 hover:underline cursor-pointer">Clear</button></>}</span></div>
            <div className="flex flex-wrap items-center gap-1.5">
              {seeds.map(s => <Chip key={s.text} on={s.on} onClick={() => (s.on || activeSeeds.length < 6) && toggle(setSeeds, s.text)} onRemove={c.seeds.includes(s.text) ? null : () => setSeeds(list => list.filter(x => x.text !== s.text))}>{s.text}</Chip>)}
              {adding
                ? <form onSubmit={e => { e.preventDefault(); addSeed(); setAdding(false); }} className="inline-flex items-center gap-1">
                  <input autoFocus className="h-8 w-44 px-2.5 text-12.5 rounded-lg bg-white ring-1 ring-inset ring-indigo-300 outline-none focus:ring-2 focus:ring-indigo-500" placeholder="A service you offer" aria-label="Add a service" value={custom} onChange={e => setCustom(e.target.value)} onBlur={() => { if (!custom.trim()) setAdding(false); }} onKeyDown={e => e.key === 'Escape' && (setCustom(''), setAdding(false))} />
                  <Button size="sm" type="submit" disabled={!custom.trim()}>Add</Button>
                </form>
                : <button type="button" onClick={() => setAdding(true)} className="h-8 px-2.5 rounded-lg ring-1 ring-inset ring-dashed ring-slate-300 text-12 font-medium text-slate-500 hover:text-slate-900 hover:ring-slate-400 inline-flex items-center gap-1 cursor-pointer"><Plus size={12} />Add a service</button>}
            </div>
            <div className="pt-1 text-11.5 font-semibold uppercase tracking-wide text-slate-500" title="Where people search from: tick the places to include">Areas<span className="block font-normal normal-case tracking-normal text-slate-400">{activeAreas.length} chosen</span></div>
            <div className="flex flex-wrap items-center gap-1.5">
              {areas.map((a, i) => <Chip key={a.text} on={a.on} onClick={() => toggle(setAreas, a.text)} title={i < c.areas.length ? 'From the business profile' : 'Nearby, from OpenStreetMap'}>{i < c.areas.length && <MapPin size={11} className="inline -mt-0.5 mr-1" />}{a.text}</Chip>)}
              {!c.business.has_location && <span className="text-12 text-slate-500">Set the map pin in Business Onboarding to add nearby localities.</span>}
            </div>
            {!c.seeds.length && <div className="col-span-2 text-12 text-amber-700">No category or services on the profile yet. Add one above, or fill them in GBP Manager.</div>}
          </div>
          <div className="flex flex-col items-stretch gap-1.5 sm:ml-auto">
            <Button variant="primary" icon={Search} busy={busy === 'find'} disabled={!activeSeeds.length} onClick={() => find()}>{result ? 'Find again' : 'Find keywords'}</Button>
            <span className={`text-11.5 text-center ${activeSeeds.length ? 'text-slate-500' : 'text-amber-700 font-medium'}`}>{activeSeeds.length ? `${activeSeeds.length} service${activeSeeds.length === 1 ? '' : 's'} · ${activeAreas.length} area${activeAreas.length === 1 ? '' : 's'}` : 'Choose a service first'}</span>
          </div>
        </div>
        <div className="px-4 py-2 border-t border-slate-100 bg-slate-50/60 rounded-b-xl flex flex-wrap items-center gap-x-6 gap-y-1 text-12 text-slate-600">
          {c.competitor_research
            ? <span className="inline-flex items-center gap-1.5 text-emerald-800"><CheckCircle2 size={13} className="text-emerald-600" />Built on competitor research ({c.competitor_research.ideas} ideas from {c.competitor_research.competitors} competitors, marked "From competitors") <Link to="/competitor-finder" className="font-semibold hover:underline">Open</Link></span>
            : <span className="inline-flex items-center gap-1.5 text-amber-800"><AlertTriangle size={13} className="text-amber-600" />No competitor research yet: it shows what your rivals win. <Link to="/competitor-finder" className="font-semibold hover:underline">Do it first</Link></span>}
          <span className="inline-flex items-center gap-1.5"><Globe size={13} className="text-slate-400" />{c.website ? <>Website audit {c.website.score}/100, {c.website.pages} pages</> : <>Website not audited, so gaps can't be checked. <Link to="/website-audit" className="font-semibold text-indigo-700 hover:underline">Audit it</Link></>}</span>
          {c.competitors.length > 0 && <span className="inline-flex items-center gap-1.5"><Users size={13} className="text-slate-400" />{c.competitors.slice(0, 3).join(', ')}{c.competitors.length > 3 ? ` +${c.competitors.length - 3}` : ''}</span>}
        </div>
      </Card>
      <ErrorNote>{error}</ErrorNote>

      {busy === 'find' && !result && <Card><div className="py-12 flex items-center justify-center gap-2 text-13 text-slate-500"><Loader2 size={16} className="animate-spin" /> Asking Google what people search for…</div></Card>}

      {result && (
        <>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-1 text-13 text-slate-500">
            <span><b className="text-slate-900 tabular-nums">{all.length}</b> keywords <span className="text-slate-400">from {result.queries} Google lookups</span></span>
            <span><b className="text-slate-900 tabular-nums">{(result.counts.local || 0) + (result.counts.near_me || 0)}</b> local and near me</span>
            <span><b className="text-slate-900 tabular-nums">{result.counts.question || 0}</b> questions</span>
            <span><b className={`tabular-nums ${result.website_checked && result.gaps ? 'text-red-600' : 'text-slate-900'}`}>{result.website_checked ? result.gaps : '—'}</b> content gaps</span>
            {result.trending_today.length > 0 && <span className="inline-flex flex-wrap items-center gap-1.5" title="Today's trending searches in India that mention your topics"><Flame size={13} className="text-orange-500" />Trending: {result.trending_today.slice(0, 5).map(x => <span key={x.keyword} className="px-1.5 py-0.5 rounded bg-orange-50 text-orange-800 text-12">{x.keyword}</span>)}</span>}
          </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
        <Card pad={false} title={`Search keywords (${searches.length})`}
          action={<Button size="sm" variant="primary" icon={Plus} busy={busy === 'track'} disabled={!selected.length} onClick={() => track(all.filter(k => selected.includes(k.keyword) && !isTracked(k)))}>Track {selected.length || ''}</Button>}>
          <DataTable bare rows={searches} rowKey={k => k.keyword} pageSize={15} exportName="keyword-ideas" label="keywords" searchPlaceholder="Search keywords" minWidth={520} sizes={[10, 15, 25, 50]}
            onState={st => { discRows.current.main = st.rows; }}
            rowClass={k => (selected.includes(k.keyword) ? 'bg-indigo-50/50' : 'hover:bg-slate-50')}
            empty={all.length ? 'No keywords match these filters.' : 'Google had no suggestions for these services. Try broader service names.'}
            filters={[
              { id: 'group', label: 'Type', options: [...(suggestedRows.length ? [['suggested', `Suggested (${suggestedRows.length})`]] : []), ...ORDER.filter(g => g !== 'question' && result.counts[g]).map(g => [g, `${GROUPS[g].label} (${result.counts[g]})`])], test: (k, v) => k.group === v },
              ...siteFilter,
              { id: 'intent', label: 'Intent', options: [...new Set(searches.map(k => k.intent).filter(Boolean))].sort().map(x => [x, x]), test: (k, v) => k.intent === v },
              ...(live ? [{ id: 'kd', label: 'Difficulty', options: [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']], test: (k, v) => k.difficulty != null && kd(k.difficulty)[0].toLowerCase() === v }] : []),
              statusFilter
            ]}
            columns={[pickCol('main', searches), keywordCol(false), demandCol, ...(live ? [difficultyCol] : []), { ...websiteCol, hide: true }, statusCol]} />
        </Card>
        <Card pad={false} title={`Questions to answer (${questions.length})`}
          action={<span className="text-12 text-slate-500 hidden sm:inline">People ask these before they buy: answer them on your site</span>}>
          <DataTable bare rows={questions} rowKey={k => k.keyword} pageSize={15} exportName="keyword-questions" label="questions" searchPlaceholder="Search questions" minWidth={520} sizes={[10, 15, 25, 50]}
            onState={st => { discRows.current.q = st.rows; }}
            rowClass={k => (selected.includes(k.keyword) ? 'bg-indigo-50/50' : 'hover:bg-slate-50')}
            empty="Google had no questions for these services."
            filters={[...siteFilter, statusFilter]}
            columns={[
              pickCol('q', questions),
              { ...keywordCol(true), cell: k => <><div className="text-slate-900 font-medium">{k.keyword}?</div><div className="text-10.5 text-slate-400">{k.intent}</div></> },
              { ...websiteCol, header: 'Answered on your site?', cell: k => (k.coverage?.status === 'gap' ? <span className="text-12 font-semibold text-red-600">Not answered yet</span> : k.coverage?.status ? <Coverage c={k.coverage} /> : <span className="text-12 text-slate-400">Not checked</span>) },
              { id: 'answer', header: 'Answer it in', className: 'px-2 py-2',
                cell: k => <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-12"><span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800">FAQ</span><span className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-800">Google Q&amp;A</span><Link to={`/ai-content-generation/blog?keyword=${encodeURIComponent(k.keyword)}`} className="font-semibold text-indigo-700 hover:underline">Write a post</Link></span> },
              statusCol
            ]} />
        </Card>
      </div>
        </>
      )}
      {toastNode}
    </div>
  );
}

/* ── Google Keyword Planner ───────────────────────────────────────────── */

const COMPETITION = {
  LOW: { label: 'Low', tone: 'green', bar: '#10b981' },
  MEDIUM: { label: 'Medium', tone: 'amber', bar: '#f59e0b' },
  HIGH: { label: 'High', tone: 'red', bar: '#f43f5e' },
  UNSPECIFIED: { label: 'Unknown', tone: 'gray', bar: '#94a3b8' }
};
const compOf = (c) => COMPETITION[c] || COMPETITION.UNSPECIFIED;
const MONTH_SHORT = { JANUARY: 'Jan', FEBRUARY: 'Feb', MARCH: 'Mar', APRIL: 'Apr', MAY: 'May', JUNE: 'Jun', JULY: 'Jul', AUGUST: 'Aug', SEPTEMBER: 'Sep', OCTOBER: 'Oct', NOVEMBER: 'Nov', DECEMBER: 'Dec' };
const PLANNER_LIMITS = [25, 50, 100, 200];
// Bids come back in the Google Ads account's currency.
const money = (v) => (v ? `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—');
const bidRange = (k) => (k.low_top_of_page_bid || k.high_top_of_page_bid ? `${money(k.low_top_of_page_bid)} – ${money(k.high_top_of_page_bid)}` : '—');
const monthLabel = (m) => `${MONTH_SHORT[m.month] || String(m.month).slice(0, 3)} '${String(m.year).slice(2)}`;

function Change({ v }) {
  if (v == null) return <span className="text-slate-300">—</span>;
  if (v === 0) return <span className="text-11.5 tabular-nums text-slate-500">0%</span>;
  const up = v > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-11.5 font-semibold tabular-nums ${up ? 'text-emerald-700' : 'text-red-600'}`}>
      {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}{Math.abs(Math.round(v))}%
    </span>
  );
}

function Sparkline({ points }) {
  if (!points || points.length < 2) return <span className="text-slate-300">—</span>;
  const vals = points.map(p => p.monthly_searches || 0);
  const max = Math.max(...vals), min = Math.min(...vals), span = max - min || 1;
  const w = 72, h = 22;
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${((i / (vals.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`).join(' ');
  const up = vals[vals.length - 1] >= vals[0];
  return <svg width={w} height={h} className="block" aria-hidden="true"><path d={d} fill="none" stroke={up ? '#10b981' : '#f43f5e'} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

const plannerValue = (r, key) => (key === 'keyword' ? r.keyword : r[key] ?? null);
const PLANNER_COLS = [
  { id: 'keyword', label: 'Keyword', align: 'left' },
  { id: 'avg_monthly_searches', label: 'Searches / mo', align: 'right' },
  { id: 'trend', label: '12-mo trend', align: 'left', sortable: false },
  { id: 'three_month_change', label: '3-mo', align: 'right' },
  { id: 'yoy_change', label: 'YoY', align: 'right' },
  { id: 'competition_index', label: 'Competition', align: 'left' },
  { id: 'high_top_of_page_bid', label: 'Top-of-page bid', align: 'right' }
];

function GooglePlanner({ b, tracked, onTracked, seedSearch }) {
  const serviceSeeds = useMemo(() => [...new Set((b.services || []).map(s => String(s?.name || s || '').trim().toLowerCase()).filter(Boolean))].slice(0, 6), [b.services]);
  const [keyword, setKeyword] = useState(serviceSeeds[0] || '');
  const [limit, setLimit] = useState(50);
  const [includeMonthly, setIncludeMonthly] = useState(true);
  const [data, setData] = useState(null);
  const [notFound, setNotFound] = useState('');
  const [focus, setFocus] = useState(null);
  const [q, setQ] = useState('');
  const [comp, setComp] = useState('all');
  const [selected, setSelected] = useState([]);
  const [busy, error, run, setError] = useAction();
  const [toast, toastNode] = useToast();

  const search = (seed = keyword, monthly = includeMonthly) => run('search', async () => {
    const k = seed.trim().toLowerCase();
    if (!k) return;
    setKeyword(k); setNotFound('');
    try {
      const r = await api(`/keyword-planner/metrics?keyword=${encodeURIComponent(k)}&limit=${limit}&include_monthly=${monthly}`);
      setData({ ...r, include_monthly: monthly }); setSelected([]); setQ(''); setComp('all');
      const seedRow = r.keywords.find(x => x.keyword.toLowerCase() === k);
      setFocus((seedRow || [...r.keywords].sort((a, c) => (c.avg_monthly_searches || 0) - (a.avg_monthly_searches || 0))[0])?.keyword || null);
    } catch (e) {
      if (e.status === 404) { setData(null); setNotFound(k); return; }
      if (e.status === 503) throw new Error(`Google Ads Keyword Planner isn't set up on the server yet. ${e.message}`);
      throw e;
    }
  });

  const searchedN = React.useRef(0);
  useEffect(() => { // the shared search box: this source answers the same keyword
    if (!seedSearch?.n || searchedN.current === seedSearch.n) return;
    searchedN.current = seedSearch.n;
    search(seedSearch.text);
  }, [seedSearch?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // one click on the source shows its numbers: it opens with the business's own first service
    if (!seedSearch?.n) search((b.services || []).map(x => String(x?.name || x || '').trim()).filter(Boolean)[0] || b.category || b.name || '');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const trackedSet = new Set(tracked.map(k => k.keyword));
  const rows = data?.keywords || [];
  const seed = data?.seed_keyword?.toLowerCase();
  const seedRow = rows.find(r => r.keyword.toLowerCase() === seed);
  const focusRow = rows.find(r => r.keyword === focus) || seedRow || rows[0];

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(r => (comp === 'all' || (COMPETITION[r.competition] ? r.competition : 'UNSPECIFIED') === comp) && (!needle || r.keyword.toLowerCase().includes(needle)));
  }, [rows, q, comp]);
  const { sorted: shown, sort, onSort } = useSorted(filtered, plannerValue, { key: 'avg_monthly_searches', dir: 'desc' });
  const pager = usePager(shown, { size: 25, resetKey: `${q}|${comp}|${rows.length}` });

  const totalVolume = rows.reduce((s, r) => s + (r.avg_monthly_searches || 0), 0);
  const bidRows = rows.filter(r => r.high_top_of_page_bid > 0);
  const avgLow = bidRows.length ? bidRows.reduce((s, r) => s + r.low_top_of_page_bid, 0) / bidRows.length : 0;
  const avgHigh = bidRows.length ? bidRows.reduce((s, r) => s + r.high_top_of_page_bid, 0) / bidRows.length : 0;
  const compCounts = rows.reduce((acc, r) => { const c = COMPETITION[r.competition] ? r.competition : 'UNSPECIFIED'; acc[c] = (acc[c] || 0) + 1; return acc; }, {});
  const easyWins = rows.filter(r => r.competition === 'LOW' && r.avg_monthly_searches > 0).sort((a, c) => c.avg_monthly_searches - a.avg_monthly_searches).slice(0, 6);
  const rising = rows.filter(r => (r.three_month_change ?? 0) > 0 && r.avg_monthly_searches >= 10).sort((a, c) => c.three_month_change - a.three_month_change).slice(0, 6);

  const chartData = (focusRow?.monthly_search_volumes || []).map(m => ({ month: monthLabel(m), searches: m.monthly_searches || 0 }));
  const peak = chartData.reduce((p, m) => (!p || m.searches > p.searches ? m : p), null);
  const low = chartData.reduce((p, m) => (!p || m.searches < p.searches ? m : p), null);

  const selectable = shown.filter(r => !trackedSet.has(r.keyword));

  const track = (list) => run('track', async () => {
    const body = list.map(r => ({ keyword: r.keyword, volume: r.avg_monthly_searches ?? null, cpc: r.high_top_of_page_bid || null, priority: r.competition === 'LOW' ? 'High' : 'Medium' }));
    const res = await api(`/businesses/${b.id}/keywords`, { method: 'POST', body });
    setSelected([]); onTracked(list.map(r => r.keyword), res?.added ?? list.length);
  });

  const exportCsv = () => downloadCsv(`keyword-planner-${(data?.seed_keyword || 'ideas').replace(/[^a-z0-9]+/gi, '-')}`,
    ['Keyword', 'Avg monthly searches', 'Competition', 'Competition index', 'Top-of-page bid (low)', 'Top-of-page bid (high)', '3-month change %', 'YoY change %'],
    shown.map(r => [r.keyword, r.avg_monthly_searches, compOf(r.competition).label, r.competition_index, r.low_top_of_page_bid, r.high_top_of_page_bid, r.three_month_change, r.yoy_change]));

  return (
    <div className="space-y-5">
      <Card title="Google Keyword Planner" subtitle="Monthly search volume, competition, top-of-page bids and 12-month trend for a keyword and related ideas, from Google Ads.">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-[220px]">
            <div className="text-11 font-semibold text-slate-500 mb-1">Seed keyword</div>
            <input className={inputCls} placeholder="e.g. dentist in pimpri" value={keyword} onChange={e => { setKeyword(e.target.value); setError(''); }} onKeyDown={e => e.key === 'Enter' && search()} />
          </label>
          <label>
            <div className="text-11 font-semibold text-slate-500 mb-1">Ideas</div>
            <Select className="h-9 px-2.5 text-12.5 rounded-lg bg-white ring-1 ring-inset ring-slate-200 outline-none focus:ring-indigo-400" value={limit} onChange={e => setLimit(Number(e.target.value))}>
              {PLANNER_LIMITS.map(n => <option key={n} value={n}>Up to {n}</option>)}
            </Select>
          </label>
          <label className="h-9 px-3 inline-flex items-center gap-2 rounded-lg ring-1 ring-inset ring-slate-200 bg-white text-12.5 text-slate-700 cursor-pointer select-none" title="Include per-month search volume history (larger payload). Needed for the 12-month chart and trend lines.">
            <input type="checkbox" className="accent-indigo-600" checked={includeMonthly} onChange={e => setIncludeMonthly(e.target.checked)} />
            Monthly history
          </label>
          <Button variant="primary" icon={Search} busy={busy === 'search'} disabled={!keyword.trim()} onClick={() => search()}>Get metrics</Button>
        </div>
        <div className="mt-1.5 text-11.5 text-slate-500">Monthly history adds the per-month search volume for the last 12 months (larger response). On by default; turn it off for faster results.</div>
        {serviceSeeds.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-11.5 text-slate-500 mr-1">From {b.name}'s services:</span>
            {serviceSeeds.map(s => <Chip key={s} on={data?.seed_keyword?.toLowerCase() === s} onClick={() => search(s)}>{s}</Chip>)}
          </div>
        )}
        <ErrorNote>{error}</ErrorNote>
      </Card>

      {busy === 'search' && !data && <Card><div className="py-12 flex items-center justify-center gap-2 text-13 text-slate-500"><Loader2 size={16} className="animate-spin" /> Asking Google Keyword Planner…</div></Card>}

      {notFound && !busy && (
        <Card><div className="py-10 text-center text-13 text-slate-500">Keyword Planner has no data for <b className="text-slate-800">"{notFound}"</b>. Try a broader or more common phrase.</div></Card>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[[Search, 'Keyword ideas', fmt(data.returned), `for "${data.seed_keyword}"`],
            [BarChart2, 'Seed searches / mo', seedRow ? fmt(seedRow.avg_monthly_searches) : '—', seedRow ? `${compOf(seedRow.competition).label} competition` : 'seed not in results'],
            [TrendingUp, 'Total searches / mo', fmt(totalVolume), 'across all ideas'],
            [Tag, 'Avg top-of-page bid', bidRows.length ? `${money(avgLow)} – ${money(avgHigh)}` : '—', bidRows.length ? `from ${bidRows.length} keywords with bids` : 'no bid data']
            ].map(([I, l, v, h]) => (
              <div key={l} className="ai-glass-card rounded px-4 py-3.5 min-w-0">
                <div className="text-12 font-semibold text-slate-500 flex items-center gap-1.5"><I size={13} /> {l}</div>
                <div className="text-22 font-bold text-slate-900 tabular-nums mt-0.5 truncate">{v}</div>
                <div className="text-11.5 text-slate-500 truncate">{h}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            <Card className="xl:col-span-2 min-w-0" title={focusRow ? `Monthly searches: "${focusRow.keyword}"` : 'Monthly searches'} subtitle={data.include_monthly ? 'Last 12 months from Google Ads. Click any keyword in the table to chart it.' : 'Turn on "Monthly history" to see the 12-month trend.'}>
              {!data.include_monthly && focusRow && (
                <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-12 text-slate-600">
                  <span>Avg: <b className="text-slate-900 tabular-nums">{fmt(focusRow.avg_monthly_searches)}</b>/mo</span>
                  <span className="inline-flex items-center gap-1">3-month: <Change v={focusRow.three_month_change} /></span>
                  <span className="inline-flex items-center gap-1">YoY: <Change v={focusRow.yoy_change} /></span>
                  <span className="inline-flex items-center gap-1">Competition: <Badge tone={compOf(focusRow.competition).tone}>{compOf(focusRow.competition).label}{focusRow.competition_index != null && ` · ${focusRow.competition_index}`}</Badge></span>
                  <span>Bid: <b className="text-slate-900 tabular-nums">{bidRange(focusRow)}</b></span>
                </div>
              )}
              {chartData.length > 1 ? (
                <>
                  <div className="h-60">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} minTickGap={12} />
                        <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} width={48} tickFormatter={v => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : v)} />
                        <Tooltip formatter={(v) => [fmt(v), 'Searches']} />
                        <Line type="monotone" dataKey="searches" name="Searches" stroke="#4f46e5" strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 4 }} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-12 text-slate-600">
                    <span>Avg: <b className="text-slate-900 tabular-nums">{fmt(focusRow.avg_monthly_searches)}</b>/mo</span>
                    {peak && <span>Peak: <b className="text-slate-900 tabular-nums">{fmt(peak.searches)}</b> ({peak.month})</span>}
                    {low && <span>Lowest: <b className="text-slate-900 tabular-nums">{fmt(low.searches)}</b> ({low.month})</span>}
                    <span className="inline-flex items-center gap-1">3-month: <Change v={focusRow.three_month_change} /></span>
                    <span className="inline-flex items-center gap-1">YoY: <Change v={focusRow.yoy_change} /></span>
                    <span className="inline-flex items-center gap-1">Competition: <Badge tone={compOf(focusRow.competition).tone}>{compOf(focusRow.competition).label}{focusRow.competition_index != null && ` · ${focusRow.competition_index}`}</Badge></span>
                  </div>
                </>
              ) : !data.include_monthly ? (
                <div className="py-10 flex flex-col items-center gap-3 text-center text-13 text-slate-500">
                  <span>Monthly history wasn't requested, so the 12-month chart and trend lines are hidden.</span>
                  <Button size="sm" icon={BarChart2} busy={busy === 'search'} onClick={() => { setIncludeMonthly(true); search(data.seed_keyword, true); }}>Load monthly history</Button>
                </div>
              ) : <div className="py-10 text-center text-13 text-slate-500">No monthly history for this keyword.</div>}
            </Card>

            <div className="space-y-5 min-w-0">
              <Card title="Competition mix" subtitle="How hard advertisers compete for these ideas">
                <div className="space-y-2.5">
                  {['LOW', 'MEDIUM', 'HIGH', 'UNSPECIFIED'].filter(c => compCounts[c]).map(c => (
                    <button key={c} type="button" onClick={() => setComp(comp === c ? 'all' : c)} className={`w-full flex items-center gap-3 text-12.5 rounded px-1.5 py-1 cursor-pointer ${comp === c ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>
                      <span className="w-16 text-left text-slate-700">{COMPETITION[c].label}</span>
                      <span className="flex-1"><Meter value={compCounts[c]} max={rows.length} color={COMPETITION[c].bar} /></span>
                      <span className="w-8 text-right tabular-nums text-slate-600">{compCounts[c]}</span>
                    </button>
                  ))}
                </div>
              </Card>
              {easyWins.length > 0 && (
                <Card title="Easy wins" subtitle="Low competition, highest search volume">
                  <ul className="space-y-1.5">
                    {easyWins.map(r => (
                      <li key={r.keyword} className="flex items-center gap-2 text-12.5">
                        <button type="button" onClick={() => setFocus(r.keyword)} className="flex-1 text-left text-slate-800 hover:text-indigo-700 truncate cursor-pointer">{r.keyword}</button>
                        <span className="tabular-nums text-slate-600">{fmt(r.avg_monthly_searches)}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              {rising.length > 0 && (
                <Card title="Rising now" subtitle="Biggest growth over the last 3 months">
                  <ul className="space-y-1.5">
                    {rising.map(r => (
                      <li key={r.keyword} className="flex items-center gap-2 text-12.5">
                        <button type="button" onClick={() => setFocus(r.keyword)} className="flex-1 text-left text-slate-800 hover:text-indigo-700 truncate cursor-pointer">{r.keyword}</button>
                        <Change v={r.three_month_change} />
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          </div>

          <Card pad={false} title={`Keyword ideas (${shown.length})`} subtitle="Click a keyword to chart it. Click a column header to sort."
            action={<div className="flex gap-2"><Button size="sm" icon={Download} onClick={exportCsv} disabled={!shown.length} title="Download all the keyword ideas shown (with the search and filters applied) as a CSV file">Export CSV</Button><Button size="sm" variant="primary" icon={Plus} busy={busy === 'track'} disabled={!selected.length} onClick={() => track(rows.filter(r => selected.includes(r.keyword)))}>Track {selected.length || ''}</Button></div>}>
            <div className="px-6 py-3 border-b border-slate-100 flex flex-wrap items-center gap-3">
              <label className="relative flex-1 min-w-[180px] max-w-xs"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" /><input className="w-full h-8 pl-8 pr-3 text-12.5 rounded-lg bg-white ring-1 ring-inset ring-slate-200 outline-none focus:ring-indigo-400" placeholder="Filter keywords" value={q} onChange={e => setQ(e.target.value)} /></label>
              <div className="flex flex-wrap gap-1.5">
                {['all', 'LOW', 'MEDIUM', 'HIGH'].map(c => (
                  <button key={c} type="button" onClick={() => setComp(c)} className={`h-8 px-3 rounded-lg text-12 font-semibold ring-1 ring-inset cursor-pointer ${comp === c ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'}`}>
                    {c === 'all' ? `All ${rows.length}` : `${COMPETITION[c].label} ${compCounts[c] || 0}`}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-13 min-w-[860px]">
                <thead className="bg-slate-50 text-11 text-slate-500">
                  <tr>
                    <th className="pl-6 pr-2 py-2.5 w-8"><input type="checkbox" className="accent-indigo-600" aria-label="Select all" checked={selectable.length > 0 && selectable.every(r => selected.includes(r.keyword))} onChange={e => setSelected(e.target.checked ? selectable.map(r => r.keyword) : [])} /></th>
                    {PLANNER_COLS.filter(col => col.id !== 'trend' || data.include_monthly).map(col => (col.sortable === false
                      ? <th key={col.id} className={`px-2 py-2.5 font-semibold whitespace-nowrap text-${col.align}`}>{col.label}</th>
                      : <SortTh key={col.id} id={col.id} sort={sort} onSort={onSort} right={col.align === 'right'} first={col.id === 'keyword' ? 'asc' : 'desc'} className="px-2 py-2.5 whitespace-nowrap">{col.label}</SortTh>))}
                    <th className="px-2 pr-6 py-2.5 text-right font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pager.rows.map(r => {
                    const isTracked = trackedSet.has(r.keyword);
                    const c = compOf(r.competition);
                    const isFocus = focusRow?.keyword === r.keyword;
                    return (
                      <tr key={r.keyword} className={isFocus ? 'bg-indigo-50/60' : selected.includes(r.keyword) ? 'bg-indigo-50/30' : 'hover:bg-slate-50'}>
                        <td className="pl-6 pr-2 py-2"><input type="checkbox" className="accent-indigo-600" disabled={isTracked} checked={selected.includes(r.keyword)} onChange={() => setSelected(s => (s.includes(r.keyword) ? s.filter(x => x !== r.keyword) : [...s, r.keyword]))} aria-label={`Select ${r.keyword}`} /></td>
                        <td className="px-2 py-2">
                          <button type="button" onClick={() => setFocus(r.keyword)} className="text-left text-slate-900 hover:text-indigo-700 cursor-pointer">{r.keyword}</button>
                          {r.keyword.toLowerCase() === seed && <span className="ml-1.5 text-10.5 font-semibold px-1.5 py-px rounded bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200">Seed</span>}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-slate-900 font-medium">{fmt(r.avg_monthly_searches)}</td>
                        {data.include_monthly && <td className="px-2 py-2"><Sparkline points={r.monthly_search_volumes} /></td>}
                        <td className="px-2 py-2 text-right"><Change v={r.three_month_change} /></td>
                        <td className="px-2 py-2 text-right"><Change v={r.yoy_change} /></td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-2">
                            <Badge tone={c.tone}>{c.label}</Badge>
                            {r.competition_index != null && <span className="w-12"><Meter value={r.competition_index} max={100} color={c.bar} height={5} /></span>}
                            {r.competition_index != null && <span className="text-11 tabular-nums text-slate-500">{r.competition_index}</span>}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-slate-700 whitespace-nowrap">{bidRange(r)}</td>
                        <td className="px-2 pr-6 py-2 text-right whitespace-nowrap">
                          {isTracked ? <span className="text-11.5 text-emerald-700 font-medium">Tracked</span>
                            : <button type="button" onClick={() => track([r])} disabled={busy === 'track'} className="text-11.5 font-semibold text-indigo-700 hover:underline cursor-pointer">Track</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!shown.length && <div className="py-10 text-center text-13 text-slate-500">No keywords match these filters.</div>}
            </div>
            <Pager p={pager} label="keywords" />
          </Card>
        </>
      )}
      {toastNode}
    </div>
  );
}

/* ── Tracked & topics ─────────────────────────────────────────────────── */

function JustAdded({ names, added, total, mapped }) {
  if (!names.length) return null;
  const word = (n) => `${n} keyword${n === 1 ? '' : 's'}`;
  return (
    <div className="rounded-xl bg-emerald-50 ring-1 ring-inset ring-emerald-200 px-4 py-3 flex flex-wrap items-center gap-3 text-13 text-emerald-950" role="status">
      <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
      <div className="flex-1 min-w-[240px]">
        <b>{added > 0 ? `${word(added)} saved and now tracked.` : `${word(names.length)} already on your list.`}</b>{' '}
        They are marked <b>Just added</b> below. Your list now has {total}. Google positions are checked for every keyword on this list{mapped < total ? `; next, give each one a page (${total - mapped} still without)` : ''}.
      </div>
      <Link to="/keyword-management/discover" className="h-9 px-3.5 rounded-lg inline-flex items-center gap-1.5 text-13 font-semibold bg-white ring-1 ring-inset ring-emerald-300 text-emerald-900 hover:bg-emerald-100"><Plus size={14} />Find more keywords</Link>
    </div>
  );
}

/** The website pages that use a keyword (page title, heading or description), from the last site crawl. */
function UsedOn({ info, keyword }) {
  if (!info) return null;
  if (!info.crawled) return <span className="block mt-1 text-11 text-slate-400">Run a site audit to see which pages use it.</span>;
  const list = info.pages?.[keyword] || [];
  if (!list.length) return <span className="block mt-1 text-11 text-amber-700">No page uses it yet (title, heading or description).</span>;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1">
      <span className="text-11 text-slate-400">Used on:</span>
      {list.slice(0, 4).map(x => <a key={x.url} href={x.url} target="_blank" rel="noreferrer" title={`In the page ${x.in.join(', ')}`} className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-100 px-2 py-0.5 text-11">{x.path}</a>)}
      {list.length > 4 && <span title={list.slice(4).map(x => x.path).join(', ')} className="text-11 text-slate-500">+{list.length - 4} more</span>}
    </span>
  );
}

/** Choose the page a keyword should rank on: every page of the website as a real link (its address, and a button to open it), with a search box. It floats over the table (a layer above the page, placed under the cell, or above it near the bottom of the screen) and closes on a click outside. */
function PagePicker({ b, pages: fallback, value, onPick, onCancel, listId }) {
  const r = useApi(`/businesses/${b.id}/keywords/site-pages`);
  const anchor = useRef(null);
  const panel = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    const place = () => {
      if (!anchor.current) return;
      const a = anchor.current.getBoundingClientRect();
      const h = Math.min(420, panel.current?.offsetHeight || 420);
      const below = window.innerHeight - a.bottom - 8;
      const top = below >= h || below >= a.top ? a.bottom + 4 : Math.max(8, a.top - h - 4);
      const left = Math.max(8, Math.min(a.left, window.innerWidth - 376));
      setPos(prev => (prev && Math.abs(prev.top - top) < 1 && Math.abs(prev.left - left) < 1 ? prev : { top, left }));
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [r.data]);
  useEffect(() => {
    const away = (e) => { if (panel.current && !panel.current.contains(e.target) && !anchor.current?.contains(e.target)) onCancel(); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [onCancel]);
  const [typing, setTyping] = useState(false);
  const [q, setQ] = useState('');
  const known = r.data?.pages?.length ? r.data.pages : fallback;
  const list = !value || known.some(p => p.url === value || p.path === value) ? known : [{ url: value, path: value.replace(/^https?:\/\/[^/]+/, '') || '/', title: '' }, ...known];
  if (typing) {
    return <input autoFocus list={listId} className={`${inputCls} max-w-[260px]`} defaultValue={value} placeholder="/page-address"
      onBlur={e => onPick(e.target.value.trim())} onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') onCancel(); }} />;
  }
  const dup = (p) => p.title && list.filter(x => x.title === p.title).length > 1; // a title every page shares says nothing about this one
  const needle = q.trim().toLowerCase();
  const shown = list.filter(p => !needle || `${p.path} ${p.url} ${p.title}`.toLowerCase().includes(needle));
  const current = (p) => p.url === value || p.path === value;
  return (
    <>
      <span ref={anchor} className="block h-8 text-12 text-slate-400">{value ? value.replace(/^https?:\/\/[^/]+/, '') || '/' : 'Choosing a page…'}</span>
      {createPortal(
    <div ref={panel} style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: 360, zIndex: 80 }} className="max-w-[calc(100vw-16px)] rounded-lg bg-white ring-1 ring-slate-300 shadow-xl" onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}>
      <div className="p-2 border-b border-slate-100"><input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${list.length} page${list.length === 1 ? '' : 's'}`} aria-label="Search the pages of your website" className={`${inputCls} w-full`} /></div>
      <ul role="listbox" aria-label="Pages of your website" className="max-h-64 overflow-y-auto divide-y divide-slate-100">
        <li><button type="button" role="option" aria-selected={!value} onClick={() => onPick('')} className="w-full text-left px-3 py-2 text-13 text-slate-600 hover:bg-slate-50 cursor-pointer">No page yet</button></li>
        {shown.map(p => (
          <li key={p.url} className={`flex items-center ${current(p) ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
            <button type="button" role="option" aria-selected={current(p)} onClick={() => onPick(p.url)} className="flex-1 min-w-0 text-left px-3 py-2 cursor-pointer">
              <span className="flex items-center gap-1.5 text-13 font-semibold text-slate-900">{p.path}{current(p) && <Check size={13} className="text-indigo-600" />}</span>
              <span className="block text-11.5 text-slate-500 truncate" title={p.url}>{p.url}</span>
              {p.title && !dup(p) && <span className="block text-11.5 text-slate-400 truncate">{p.title}</span>}
            </button>
            <a href={p.url} target="_blank" rel="noreferrer noopener" title="Open this page in a new tab" aria-label={`Open ${p.path}`} className="px-2.5 py-2 text-slate-400 hover:text-indigo-700"><ExternalLink size={14} /></a>
          </li>))}
        {!shown.length && <li className="px-3 py-4 text-12.5 text-slate-500">{r.data ? 'No page matches. Use "Type another address".' : 'Reading your pages…'}</li>}
      </ul>
      <div className="flex gap-3 px-3 py-2 border-t border-slate-100 text-12"><button type="button" onClick={() => setTyping(true)} className="font-semibold text-indigo-700 hover:underline cursor-pointer">Type another address</button><button type="button" onClick={onCancel} className="text-slate-500 hover:underline cursor-pointer">Cancel</button></div>
    </div>, document.body)}
    </>
  );
}

function Tracked({ b, kw }) {
  const [busy, error, run] = useAction();
  const pagesInfo = useApi(`/businesses/${b.id}/keywords/pages`).data;
  const statusData = useApi(`/businesses/${b.id}/keywords/status`).data;
  const tbl = useApi(`/businesses/${b.id}/keywords/table`); // the slow figures are stored and refreshed in the background: the table opens at once
  usePoll(() => tbl.reload(true), Boolean(tbl.data?.refreshing), 4000);
  const T = useMemo(() => Object.fromEntries((tbl.data?.rows || []).map(r => [r.id, r])), [tbl.data]);
  const how = useMemo(() => Object.fromEntries((statusData?.items || []).map(x => [x.keyword, x])), [statusData]); // how each keyword is doing: a plain verdict
  const tracked = kw.data?.keywords || [];
  const location = useLocation();
  const fresh = useMemo(() => new Set((location.state?.added || []).map(x => String(x).toLowerCase())), [location.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const [useIds, setUseIds] = useState(null); // the keywords the "Where to use" window is open for
  const NO_FILTER = { role: '', page: '', google: '', kd: '', intent: '', status: '', topic: '' };
  // Saved Keywords holds the keyword's own figures; the mapped page belongs to Keyword Mapping and the verdict to Keyword Status, so those two columns start hidden (the Columns menu brings them back)
  const [hidden, setHidden] = useState(() => { try { const v = localStorage.getItem('kw-hidden-cols'); return new Set(v === null ? ['page', 'status'] : JSON.parse(v)); } catch { return new Set(['page', 'status']); } });
  const show = (c) => !hidden.has(c);
  const toggleCol = (c) => setHidden(h => { const x = new Set(h); x.has(c) ? x.delete(c) : x.add(c); try { localStorage.setItem('kw-hidden-cols', JSON.stringify([...x])); } catch { /* not remembered */ } return x; });
  const [f, setF] = useState(NO_FILTER); // the filters of the table: one box for each column worth filtering
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ key: 'volume', dir: 'desc' });
  const [limit, setLimit] = useState(30);
  const [typed, setTyped] = useState('');
  const [editing, setEditing] = useState(null); // the keyword whose page is being chosen
  const [sel, setSel] = useState(() => new Set());
  useEffect(() => {
    if (!fresh.size || !kw.data) return;
    const el = document.querySelector('[data-just-added="1"]');
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [fresh, kw.data]);
  const update = (k, patch) => run(`u${k.id}`, async () => {
    const out = await api(`/businesses/${b.id}/keywords/${k.id}`, { method: 'PATCH', body: { keyword: k.keyword, ...patch } });
    kw.setData(d => ({ ...d, keywords: d.keywords.map(x => (x.id === k.id ? out : x)) }));
    tbl.reload(true); // the page, its index status and its visits follow the page just chosen
    if ('role' in patch) kw.reload(true); // a page has one primary keyword: the one that had it before is secondary now
  });
  const askAi = (k) => run(`g${k.id}`, async () => { // track the question this keyword makes in AI search, then read the table again
    await api(`/businesses/${b.id}/keywords/${k.id}/geo-prompt`, { method: 'POST', body: {} });
    await api(`/businesses/${b.id}/search-insights/refresh?kind=kwtable`, { method: 'POST' });
    tbl.reload(true);
  });
  const [ask, confirmNode] = useDoubleConfirm();
  const remove = (k) => ask({ what: `the keyword “${k.keyword}”`, effect: 'It stops being tracked, and its rank history is no longer shown.', onConfirm: () => run(`d${k.id}`, async () => { await api(`/businesses/${b.id}/keywords/${k.id}`, { method: 'DELETE' }); kw.reload(true); }) });
  const add = () => {
    const t = typed.trim().toLowerCase();
    if (t.length < 2) return undefined;
    return run('add', async () => { await api(`/businesses/${b.id}/keywords`, { method: 'POST', body: [{ keyword: t }] }); setTyped(''); kw.reload(true); });
  };
  // "Do it for me": give every keyword the page it already appears on (a page you chose yourself is never changed)
  const autoPages = () => run('auto', async () => { await api(`/businesses/${b.id}/keyword-mapping/apply`, { method: 'POST' }); kw.reload(true); });
  const bulk = (label, fn) => run(label, async () => { for (const k of tracked.filter(x => sel.has(x.id))) await fn(k); setSel(new Set()); kw.reload(true); });
  const bulkDelete = () => ask({ what: `${sel.size} keyword${sel.size === 1 ? '' : 's'}`, effect: 'They stop being tracked, and their rank history is no longer shown.', onConfirm: () => bulk('bulkdel', (k) => api(`/businesses/${b.id}/keywords/${k.id}`, { method: 'DELETE' })) });
  const toggleSel = (id) => setSel(s => { const x = new Set(s); x.has(id) ? x.delete(id) : x.add(id); return x; });
  const sitePages = pagesInfo?.site_pages || [];
  const pages = sitePages.length ? sitePages.map(p => p.path) : [...new Set(['/', '/services', '/contact', ...(b.services || []).map(s => `/services/${String(s.name || s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')}`), ...tracked.map(k => k.target_url).filter(Boolean)])];
  const mapped = tracked.filter(k => k.target_url).length;
  const onGoogle = tracked.filter(k => k.rank).length;
  const same = (a, c) => { const p = (u) => ((u || '').replace(/^https?:\/\/[^/]+/, '').replace(/\/+$/, '')) || '/'; return p(a) === p(c); };
  const setFilter = (key, v) => { setF(x => ({ ...x, [key]: v })); setLimit(30); setSel(new Set()); };
  const clearAll = () => { setF(NO_FILTER); setQ(''); setLimit(30); setSel(new Set()); };
  const active = Object.values(f).filter(Boolean).length + (q.trim() ? 1 : 0);
  const kdBand = (d) => (d == null ? 'none' : d <= 30 ? 'easy' : d <= 60 ? 'medium' : 'hard');
  const topics = [...new Set(tracked.map(k => k.cluster).filter(Boolean))].sort();
  const intents = [...new Set(tracked.map(k => k.intent).filter(Boolean))].sort();
  const cnt = (fn) => tracked.filter(fn).length;
  const FILTERS = [
    ['role', 'Role', [['', 'Any role'], ['primary', `Primary (${cnt(k => k.role === 'primary')})`], ['secondary', `Secondary (${cnt(k => k.role === 'secondary')})`], ['none', `No role yet (${cnt(k => !k.role)})`]]],
    ['page', 'Page', [['', 'Any page status'], ['mapped', `Has a page (${mapped})`], ['none', `No page yet (${tracked.length - mapped})`]]],
    ['google', 'Google', [['', 'On Google or not'], ['yes', `Ranks on Google (${onGoogle})`], ['top10', `Top 10 (${cnt(k => k.rank && k.rank <= 10)})`], ['no', `Not on Google yet (${tracked.length - onGoogle})`]]],
    ['kd', 'Difficulty', [['', 'Any difficulty'], ['easy', `Easy, up to 30 (${cnt(k => kdBand(k.difficulty) === 'easy')})`], ['medium', `Medium, 31 to 60 (${cnt(k => kdBand(k.difficulty) === 'medium')})`], ['hard', `Hard, over 60 (${cnt(k => kdBand(k.difficulty) === 'hard')})`], ['none', `No figure (${cnt(k => kdBand(k.difficulty) === 'none')})`]]],
    ['status', 'Status', [['', 'Any status'], ['working', 'Working'], ['climbing', 'Climbing'], ['weak', 'Weak'], ['invisible', 'Not seen'], ['unchecked', 'Not checked']]],
    ...(intents.length ? [['intent', 'Intent', [['', 'Any intent'], ...intents.map(i => [i, i])]]] : []),
    ...(topics.length ? [['topic', 'Topic', [['', 'Any topic'], ['__none', 'No topic yet'], ...topics.map(i => [i, i])]]] : [])
  ];
  const COLS = [['rank', 'Rank / AI'], ['volume', 'Searches'], ['difficulty', 'KD'], ['impressions', 'Impr / clicks / CTR'], ['page', 'Mapped page'], ['status', 'Status']];
  const exportCsv = () => {
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Keyword', 'Role', 'Topic', 'Intent', 'Rank', 'Searches per month', 'Difficulty', 'Impressions', 'Clicks', 'CTR %', 'Page', 'Status'];
    const body = rows.map(k => { const t = T[k.id]; return [k.keyword, k.role || '', k.cluster || '', k.intent || '', k.rank || '', k.volume ?? '', k.difficulty ?? '', t?.impressions ?? '', t?.clicks ?? '', t?.ctr ?? '', k.target_url || '', t?.label || ''].map(cell).join(','); });
    const url = URL.createObjectURL(new Blob([`\ufeff${[head.map(cell).join(','), ...body].join('\r\n')}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `my-keywords-${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  // Click a value in a row (its role, intent, topic, rank, difficulty, page or status) to show only the rows that have it; click it again to stop.
  const rowFilter = (e) => {
    const el = e.target.closest?.('[data-f]');
    if (!el) return;
    const [key, ...rest] = el.dataset.f.split(':');
    const v = rest.join(':');
    setFilter(key, f[key] === v ? '' : v);
  };
  // what is filtered now, as chips that can each be removed
  const chips = Object.entries(f).filter(([, v]) => v).map(([key, v]) => { const row = FILTERS.find(x => x[0] === key); return { key, label: row ? ((row[2].find(o => o[0] === v) || [])[1] || v) : v }; });
  const STATUS_ORDER = { working: 0, climbing: 1, weak: 2, invisible: 3, unchecked: 4 };
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = tracked.filter(k => {
      const t = T[k.id];
      return (!needle || k.keyword.includes(needle) || (k.cluster || '').toLowerCase().includes(needle))
        && (!f.role || (f.role === 'none' ? !k.role : k.role === f.role))
        && (!f.page || (f.page === 'mapped' ? k.target_url : !k.target_url))
        && (!f.google || (f.google === 'yes' ? k.rank : f.google === 'top10' ? k.rank && k.rank <= 10 : !k.rank))
        && (!f.kd || kdBand(k.difficulty) === f.kd)
        && (!f.intent || k.intent === f.intent)
        && (!f.topic || (f.topic === '__none' ? !k.cluster : k.cluster === f.topic))
        && (!f.status || (t?.status || 'unchecked') === f.status);
    });
    const v = (k) => {
      const t = T[k.id];
      switch (sort.key) {
        case 'keyword': return k.keyword;
        case 'rank': return k.rank ?? 999;
        case 'impressions': return t?.impressions ?? -1;
        case 'clicks': return t?.clicks ?? -1;
        case 'page': return (k.target_url || '~').toLowerCase();
        case 'status': return STATUS_ORDER[t?.status || 'unchecked'] ?? 5;
        default: return k[sort.key] ?? -1;
      }
    };
    return list.sort((a, c) => { const x = v(a); const y = v(c); const o = typeof x === 'string' ? x.localeCompare(y) : x - y; return (sort.dir === 'asc' ? o : -o) || a.keyword.localeCompare(c.keyword); });
  }, [tracked, f, q, sort, T]);
  const googleNote = !tbl.data?.fetched_at ? '' : `Google figures: Search Console${tbl.data.window ? `, ${tbl.data.window.days} days (${tbl.data.window.start} to ${tbl.data.window.end}), searches from ${tbl.data.window.country || 'your country'}` : ''}${tbl.data.google_total ? `. ${fmt(tbl.data.google_total.impressions)} impressions and ${fmt(tbl.data.google_total.clicks)} clicks from ${tbl.data.google_total.searches} of your ${(tbl.data.rows || []).length} keywords` : ''}. Read ${new Date(tbl.data.fetched_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}, refreshed every ${tbl.data.every_minutes} min. Click a heading to sort.`;
  const pager = usePager(rows, { size: 25, resetKey: `${JSON.stringify(f)}|${q}|${sort.key}|${sort.dir}` });
  const shown = pager.rows;
  const allOn = shown.length > 0 && shown.every(k => sel.has(k.id));
  const Th = ({ id, children, right, ...tip }) => (
    <th className={`px-4 py-3 font-semibold whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}>
      <button type="button" onClick={() => setSort(s => ({ key: id, dir: s.key === id ? (s.dir === 'desc' ? 'asc' : 'desc') : ['keyword', 'rank', 'page', 'status'].includes(id) ? 'asc' : 'desc' }))} className={`inline-flex items-center gap-1 cursor-pointer hover:text-slate-800 ${sort.key === id ? 'text-slate-900' : ''}`}><Head right={right} {...tip}>{children}</Head>{sort.key === id && (sort.dir === 'asc' ? '▲' : '▼')}</button>
    </th>
  );

  const nopage = tracked.length - mapped;

  return (
    <div className="space-y-5">
      {confirmNode}
      <JustAdded names={[...fresh]} added={location.state?.newCount ?? 0} total={tracked.length} mapped={mapped} />
      <ErrorNote>{error}</ErrorNote>

      {!kw.data ? <SkTable cols={['w-1/3', 'w-12', 'w-12', 'w-12', 'w-16']} rows={8} /> : !tracked.length ? (
        <Card><div className="py-14 text-center">
          <h3 className="text-16 font-semibold text-slate-900">You have not saved any keywords yet</h3>
          <p className="mt-1 text-13 text-slate-500">Collect them from your website, Google and competitors, then pick the ones worth working on.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link to="/keyword-management/workspace"><Button variant="primary" icon={ArrowRight}>Open the Keyword Workspace</Button></Link>
            <Link to="/keyword-management/ai"><Button>Find Keywords</Button></Link>
          </div>
        </div></Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative flex-1 min-w-[220px] max-w-md"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={q} onChange={e => { setQ(e.target.value); setLimit(30); }} placeholder="Search my keywords or topics" aria-label="Search my keywords" className="h-8 w-full pl-9 pr-3 text-13 rounded-lg ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none bg-white" /></label>
            <div className="ml-auto flex flex-wrap items-center gap-2">
            {nopage > 0 && <Button size="sm" variant="primary" icon={Sparkles} busy={busy === 'auto'} onClick={autoPages} title={`${nopage} keyword${nopage === 1 ? ' has' : 's have'} no page yet: give each the page where it already appears (a page you chose yourself is never changed)`}>Match {nopage} to my pages</Button>}
            <form onSubmit={(e) => { e.preventDefault(); add(); }} className="flex gap-1.5">
              <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="Add a keyword" aria-label="Add a keyword" className="h-8 w-40 px-2.5 text-13 rounded-lg ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none bg-white" />
              <Button size="sm" type="submit" icon={Plus} busy={busy === 'add'} disabled={typed.trim().length < 2}>Add</Button>
            </form>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-11.5 text-slate-500 px-1 -mt-1 -mb-1">
            {tbl.data?.refreshing && <span className="inline-flex items-center gap-1.5 text-indigo-700"><Loader2 size={12} className="animate-spin" />Reading positions and Search Console figures… they appear here by themselves.</span>}
            {!tbl.data?.refreshing && tbl.data?.google === 'saved' && <span className="text-amber-700" title={tbl.data.google_error || ''}>Search Console could not be read just now: showing the last saved position check{tbl.data.google_error ? ` (${tbl.data.google_error})` : ''}</span>}
            {tbl.data?.error && !tbl.data?.refreshing && <span className="text-amber-700" title={tbl.data.error}>last refresh failed</span>}
          </div>
          <Card pad={false}>
            <div role="group" aria-label="Filter the table" className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
              {chips.map(c => <button key={c.key} type="button" onClick={() => setFilter(c.key, '')} title="Remove this filter" className="h-7 px-2.5 rounded-full bg-indigo-50 ring-1 ring-inset ring-indigo-200 text-12 font-semibold text-indigo-800 inline-flex items-center gap-1 cursor-pointer hover:bg-indigo-100">{c.label}<X size={11} /></button>)}
              <details className="relative ml-auto">
                <summary className="h-8 px-3 inline-flex items-center rounded-md border border-slate-200 bg-white text-12.5 font-semibold text-slate-700 cursor-pointer list-none hover:bg-slate-50" title="Choose which columns to show">Columns{hidden.size ? ` (${COLS.length - hidden.size} of ${COLS.length})` : ''}</summary>
                <div className="absolute right-0 z-20 mt-1 w-60 rounded-lg bg-white shadow-lg ring-1 ring-slate-200 p-2">
                  {COLS.map(([c, label]) => <label key={c} className="flex items-center gap-2 px-2 py-1.5 text-13 text-slate-700 rounded hover:bg-slate-50 cursor-pointer"><input type="checkbox" checked={show(c)} onChange={() => toggleCol(c)} />{label}</label>)}
                </div>
              </details>
              <Button size="sm" icon={Download} onClick={exportCsv} title="Download the keywords shown in the table (with the filters applied) as a CSV file">Export CSV</Button>
              <span className="text-12.5 text-slate-500" role="status" title={googleNote}>{active ? <>Showing <b className="text-slate-800">{rows.length}</b> of {tracked.length} · <button type="button" onClick={clearAll} className="font-semibold text-indigo-700 hover:underline cursor-pointer">Clear filters</button></> : <><b className="text-slate-800">{tracked.length}</b> keywords · click a value in a row to filter</>}{tbl.data?.fetched_at && !active ? <span className="text-slate-400"> · Google data from {tbl.data.window ? `${new Date(`${tbl.data.window.end}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Search Console'}</span> : null}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-14 min-w-[1010px]">
                <thead className="bg-slate-50 text-12 uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="w-12 pl-4 py-3"><input type="checkbox" aria-label="Select all shown" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(shown.map(k => k.id)))} /></th>
                    <Th id="keyword" what="A keyword you saved and are tracking, and where it was found." why="Click the name to check its searches, cost and related ideas. Click the heading to sort." from="the ones you picked in the Keyword Workspace, Find Keywords or typed in.">Keyword &amp; source</Th>
                    {show('rank') && <Th id="rank" right what="Where your website shows on Google for it (average, last 28 days; #1 is the top), whether it moved, and whether AI assistants mention your business for it." why="Shows what is working and what can climb." from="Google Search Console for the position; the AI answers you track for AI search.">Rank / AI</Th>}
                    {show('volume') && <Th id="volume" right what="How many times a month people search it in your country." why="Shows which keywords can bring the most visitors." from="Google Ads Keyword Planner. Blank when Google gave no figure.">Searches</Th>}
                    {show('difficulty') && <Th id="difficulty" right what="Keyword difficulty, 0 to 100: how hard it is to rank on Google for this keyword. Green is easier (up to 30), amber is a fair fight (up to 60), red is hard." why="Start with the easier keywords that still have searches: they rank sooner." from="Google Ads Keyword Planner (its competition level). Blank when Google gave no figure.">KD</Th>}
                    {show('impressions') && <Th id="impressions" right what="Impressions: how many times your site appeared in Google for exactly this search. Clicks: how many of those people clicked. CTR (click rate) = clicks divided by impressions. Last 28 days, searches from your target country." why="Many impressions and few clicks means the title and description need work. No impressions means Google is not showing your site for it." from="Google Search Console, the same numbers as Search Console > Performance > Queries (read for this table about every 30 minutes; Google's data is two days behind).">Impr / clicks / CTR</Th>}
                    {show('page') && <Th id="page" what="The page of your website this keyword is mapped to, and the pages where the keyword is already used." why="Mapped means a page was chosen for the keyword (by you, or from the site scan's suggestion). It is a plan, not proof: a solid green dot means the page also says the keyword; a hollow amber dot means it does not yet, so add it there." from="your choice (or the suggestion from the site scan) and the last website scan: the keyword in a page address, title, heading or description.">Mapped page</Th>}
                    {show('status') && <Th id="status" what="How this keyword is doing, in plain words." why="It tells you the next thing to do." from="its position and clicks in Google Search Console.">Status</Th>}
                    <th className="px-3 py-3 text-right font-semibold"><Head right what="Map the keyword to a page (or see the page it is mapped to), check it, write for it, or remove it." why="Every keyword needs one page to rank on.">Actions</Head></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 [&_[data-f]]:cursor-pointer [&_[data-f]:hover]:opacity-75" onClick={rowFilter}>
                  {shown.map(k => {
                    const used = pagesInfo?.pages?.[k.keyword] || [];
                    const guess = !k.target_url && used[0];
                    const isNew = fresh.has(k.keyword.toLowerCase());
                    const h = how[k.keyword];
                    const verdict = h && ['working', 'climbing', 'weak'].includes(h.status) ? h : null;
                    const t = T[k.id];
                    return (
                      <tr key={k.id} data-just-added={isNew ? '1' : undefined} className={sel.has(k.id) ? 'bg-indigo-50/60' : isNew ? 'bg-emerald-50/70' : 'hover:bg-slate-50'}>
                        <td className="pl-4 py-2"><input type="checkbox" aria-label={`Select ${k.keyword}`} checked={sel.has(k.id)} onChange={() => toggleSel(k.id)} /></td>
                        <td className="px-4 py-2 min-w-[230px]">
                          <Link to={`/keyword-overview?q=${encodeURIComponent(k.keyword)}`} title="Check its searches, cost and related ideas" className="font-semibold text-slate-900 hover:text-indigo-700 hover:underline">{k.keyword}</Link>
                          {isNew && <span className="ml-2 rounded-full bg-emerald-600 text-white text-11 font-semibold px-2 py-0.5">Just added</span>}
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-12 text-slate-400">
                            {k.role === 'primary' ? <span data-f="role:primary" title="The main keyword of its page: the one the page is built to rank for" className="inline-flex items-center gap-1 rounded-full bg-indigo-600 text-white text-11 font-semibold px-2 py-px"><Star size={10} />Primary</span>
                              : k.role === 'secondary' ? <span data-f="role:secondary" title="A supporting keyword: the page also covers it, but it is not the page's main one" className="inline-flex items-center rounded-full bg-slate-200 text-slate-700 text-11 font-semibold px-2 py-px">Secondary</span>
                                : t?.role_suggested ? <span data-f="role:none" title="The mapping suggests this role. Map the keyword and save the mapping to keep it." className="inline-flex items-center rounded-full ring-1 ring-dashed ring-slate-300 text-slate-500 text-11 font-semibold px-2 py-px">{t.role_suggested === 'primary' ? 'Primary' : 'Secondary'}?</span>
                                  : <span data-f="role:none" title="Not decided yet: map the keyword to a page first" className="inline-flex items-center rounded-full ring-1 ring-slate-200 text-slate-400 text-11 px-2 py-px">No role yet</span>}
                            {k.intent && <span data-f={`intent:${k.intent}`} title={{ local: 'Someone looking for a business near them', commercial: 'Someone comparing or ready to buy or hire', informational: 'Someone looking for an answer or a guide', transactional: 'Someone ready to buy now', navigational: 'Someone looking for a particular site' }[k.intent] || 'What the searcher wants'} className={`inline-flex items-center rounded-full text-11 font-semibold px-2 py-px ${{ local: 'bg-teal-50 text-teal-700', commercial: 'bg-emerald-50 text-emerald-700', informational: 'bg-sky-50 text-sky-700', transactional: 'bg-amber-50 text-amber-700', navigational: 'bg-violet-50 text-violet-700' }[k.intent] || 'bg-slate-100 text-slate-600'}`}>{k.intent}</span>}
                            {t?.branded && <span title="It contains your brand name: people who already know you" className="inline-flex items-center rounded-full bg-fuchsia-50 text-fuchsia-700 text-11 font-semibold px-2 py-px">Brand</span>}
                          </span>
                          <span className="flex flex-wrap items-center gap-x-2 text-11 text-slate-400 leading-tight">
                            {t?.source?.label && <span title="Where this keyword was found" className="truncate max-w-[170px]">From {t.source.label}</span>}
                            {k.cluster && <span data-f={`topic:${k.cluster}`} title="Its topic group">{k.cluster}</span>}
                          </span>
                        </td>
                        {show('rank') && (<td className="px-3 py-2 text-right whitespace-nowrap">
                          {(t?.rank ?? k.rank) ? <span data-f="google:yes" className="inline-flex items-center justify-end gap-1.5" title="Average position on Google, last 28 days (Search Console). Click to show only keywords that rank">
                            <span className={`font-semibold tabular-nums ${(t?.rank ?? k.rank) <= 10 ? 'text-emerald-700' : 'text-slate-800'}`}>#{t?.rank ?? k.rank}</span>
                            {t?.change ? <span className={`inline-flex items-center text-12 ${t.change > 0 ? 'text-emerald-700' : 'text-red-600'}`}>{t.change > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}{Math.abs(t.change)}</span> : null}
                          </span> : <span data-f="google:no" className="text-slate-400 text-13" title="Google has not shown your site for this keyword yet, or positions have not been checked. Click to show only these">Not seen yet</span>}
                          <span className="block mt-0.5">{!t ? null : t.ai?.mentioned ? <span title="AI assistants mention your business for this question" className="text-11.5 font-semibold text-emerald-700">AI ✓ mentioned</span>
                            : t.ai?.tracked ? <span title="You track the question this keyword makes; no assistant names your business yet" className="text-11.5 text-slate-500">AI asked, not named</span> : <span title="Not tracked as an AI search question yet" className="text-11.5 text-slate-300">AI not tracked</span>}</span>
                        </td>)}
                        {show('volume') && (<td className="px-3 py-2 text-right tabular-nums whitespace-nowrap" title="Searches per month in your country (Google Ads Keyword Planner)">{fmt(k.volume)}</td>)}
                        {show('difficulty') && (<td className="px-3 py-2 text-right whitespace-nowrap" title={k.difficulty != null ? `${k.difficulty_real ? 'SEO difficulty, read from the real top 10 on Google' : 'Google Ads competition (the real SEO difficulty is not read yet: open Find Keywords and read it)'} ${k.difficulty} of 100: ${k.difficulty <= 30 ? 'easier to rank for' : k.difficulty <= 60 ? 'a fair fight' : 'hard to rank for'}` : 'No difficulty figure for this keyword yet'}>
                          {k.difficulty != null ? <span data-f={`kd:${kdBand(k.difficulty)}`} className={`inline-flex items-center justify-center min-w-[36px] rounded-md px-2 py-0.5 text-13 font-semibold tabular-nums ${k.difficulty <= 30 ? 'bg-emerald-50 text-emerald-700' : k.difficulty <= 60 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>{k.difficulty}</span> : <span className="text-slate-300">—</span>}
                        </td>)}
                        {show('impressions') && (<td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-13" title="Google Search Console, last 28 days">
                          {t && t.impressions > 0 ? <><span className="text-slate-700">{fmt(t.impressions)}</span> <span className="text-slate-300">/</span> <span className="font-semibold text-slate-900">{fmt(t.clicks || 0)}</span> <span className="text-slate-300">/</span> <span className="text-slate-700">{t.ctr != null ? `${t.ctr}%` : '—'}</span></>
                            : t && t.impressions === 0 ? <span className="text-slate-400" title="Google showed your site 0 times for this exact search in the last 28 days">0 shown</span>
                              : <span className="text-slate-300" title={!t ? '' : tbl.data?.google_error ? `Search Console could not be read: ${tbl.data.google_error}` : 'Not read yet'}>{!t ? '…' : '—'}</span>}
                        </td>)}
                        {show('page') && (<td className="px-3 py-2 min-w-[190px]">
                          {editing === k.id ? (
                            <PagePicker b={b} pages={sitePages} value={k.target_url || ''} listId={`pages-${b.id}`} onCancel={() => setEditing(null)}
                              onPick={v => { setEditing(null); if (v !== (k.target_url || '')) update(k, { target_url: v || null }); }} />
                          ) : (
                            <div className="text-13 leading-tight">
                              {k.target_url ? (() => {
                                const onIt = used.some(u => same(u.path, k.target_url));
                                const bad = indexProblem(t?.index);
                                return (
                                  <>
                                    <div className="flex items-center gap-1.5">
                                      <span data-f="page:mapped" className={`w-2 h-2 rounded-full shrink-0 ${onIt ? 'bg-emerald-500' : 'border-2 border-amber-500'}`} title={onIt ? 'Mapped, and the page says the keyword' : 'A page was chosen for this keyword, but the page does not say it yet'} aria-hidden="true" />
                                      <a href={k.target_url.startsWith('http') ? k.target_url : `${(b.website || '').replace(/\/$/, '')}${k.target_url}`} target="_blank" rel="noreferrer" title={onIt ? 'Open the mapped page' : 'Open the page chosen for this keyword'} className="font-semibold text-slate-800 hover:text-indigo-700 truncate max-w-[170px]">{k.target_url.replace(/^https?:\/\/[^/]+/, '') || '/'}</a>
                                      {bad && <span className={`cursor-help ${bad.level === 'blocked' ? 'text-red-600' : 'text-amber-600'}`} title={`${t.index.page}: ${bad.text}${t.index.reason ? ` (${t.index.reason})` : ''}`}>⚠</span>}
                                    </div>
                                    <div className={`mt-0.5 text-12 pl-3.5 ${onIt ? 'text-emerald-700' : 'text-amber-700 font-medium'}`} title={onIt ? 'The website scan found the keyword on this page' : `Mapped only by choice: this page was chosen for the keyword, but the scan does not find it there. ${used.length ? `It is used on: ${used.map(u => u.path).join(', ')}.` : 'It is not on any page yet.'} Add it to the page, or choose the page that already uses it.`}>{onIt ? 'Keyword is on this page' : 'Planned: keyword not on it yet'}</div>
                                  </>);
                              })() : (
                                <>
                                  <div data-f="page:none" className="flex items-center gap-1.5 font-semibold text-amber-700" title="Click to show only keywords without a page"><span className="w-2 h-2 rounded-full border-2 border-amber-500 shrink-0" aria-hidden="true" />Not mapped yet</div>
                                  <div className="mt-0.5 text-12 pl-3.5 text-slate-500 truncate max-w-[200px]" title={used.length ? `The keyword is used on: ${used.map(u => u.path).join(', ')}` : 'The scan did not find the keyword on any page'}>{used.length ? `Used on ${used[0].path}${used.length > 1 ? ` +${used.length - 1}` : ''}` : 'Not used on the site yet'}</div>
                                </>)}
                            </div>
                          )}
                        </td>)}
                        {show('status') && (<td className="px-3 py-2 whitespace-nowrap">
                          {t?.label ? <span data-f={`status:${t.status}`} title={t.why || ''}><Badge tone={{ working: 'green', climbing: 'amber', weak: 'red', invisible: 'gray', unchecked: 'gray' }[t.status] || 'gray'}>{t.label}</Badge></span> : <span className="text-slate-300">{!t ? '…' : '—'}</span>}
                        </td>)}
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <KeywordRowActions b={b} k={k} t={t} usedOn={used} busy={busy} onMap={(url) => update(k, { target_url: url })} onChoose={() => setEditing(k.id)} onAskAi={() => askAi(k)} onRemove={() => remove(k)} onRole={(role) => update(k, { role })} onUse={() => setUseIds([k.id])} />
                        </td>
                      </tr>);
                  })}
                  {!rows.length && <tr><td colSpan={9} className="px-5 py-12 text-center text-14 text-slate-500">No keyword matches. <button type="button" onClick={clearAll} className="font-semibold text-indigo-700 hover:underline cursor-pointer">Clear filters</button></td></tr>}
                </tbody>
              </table>
              <datalist id={`pages-${b.id}`}>{pages.map(p => <option key={p} value={p} />)}</datalist>
            </div>
            <Pager p={pager} label="keywords" />
          </Card>
        </>
      )}
      <UseKeywordsModal b={b} ids={useIds} onClose={() => setUseIds(null)} />
      {sel.size > 0 && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-30 max-w-[calc(100vw-32px)]">
          <div role="toolbar" aria-label="Selected keywords" className="bg-slate-900 text-white rounded-xl shadow-xl px-4 py-2.5 flex flex-wrap items-center gap-3">
            <span className="text-13 font-semibold">{sel.size} selected</span>
            <Button size="sm" variant="primary" icon={Sparkles} onClick={() => setUseIds([...sel])} title="Where each selected keyword can be used: your pages, blog, FAQ, Google posts and more, with text ready to copy">Where to use</Button>
            <span className="text-12 text-slate-300">Importance</span>
            {['High', 'Medium', 'Low'].map(p => <Button key={p} size="sm" busy={busy === `bulk${p}`} onClick={() => bulk(`bulk${p}`, (k) => api(`/businesses/${b.id}/keywords/${k.id}`, { method: 'PATCH', body: { keyword: k.keyword, priority: p } }))}>{p}</Button>)}
            <Button size="sm" variant="danger" icon={Trash2} busy={busy === 'bulkdel'} onClick={bulkDelete}>Delete</Button>
            <button type="button" onClick={() => setSel(new Set())} className="text-12.5 text-slate-300 hover:text-white underline cursor-pointer">Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}

const NOT_GROUPED = 'Not grouped';

/** Topics: the saved keywords grouped by what they are about, one page per topic. Each card shows the topic's lead keyword, its searches, where it ranks and the page it is on, with the next step for it. */
function Topics({ b, kw }) {
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const [q, setQ] = useState('');
  const [view, setView] = useState('all');
  const [useIds, setUseIds] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [name, setName] = useState('');
  const tracked = kw.data?.keywords || [];
  const cluster = () => run('cluster', async () => { const r = await api(`/businesses/${b.id}/keywords/cluster`, { method: 'POST' }); kw.reload(true); toast(`${r.updated} keywords grouped into topics`); });
  const topics = useMemo(() => {
    const m = new Map();
    for (const k of tracked) {
      const key = k.cluster || NOT_GROUPED;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(k);
    }
    return [...m.entries()].map(([topic, list]) => {
      const sorted = [...list].sort((x, y) => (y.volume || 0) - (x.volume || 0) || x.keyword.localeCompare(y.keyword));
      const ranks = list.map(k => k.rank).filter(Boolean);
      const pages = [...new Set(list.map(k => k.target_url).filter(Boolean))];
      return {
        topic, list: sorted, lead: sorted.find(k => k.role === 'primary') || sorted[0], volume: list.reduce((n, k) => n + (k.volume || 0), 0),
        best: ranks.length ? Math.min(...ranks) : null, ranking: ranks.length, pages, mapped: list.filter(k => k.target_url).length
      };
    }).sort((x, y) => (x.topic === NOT_GROUPED) - (y.topic === NOT_GROUPED) || y.volume - x.volume);
  }, [tracked]);
  const names = topics.map(x => x.topic).filter(x => x !== NOT_GROUPED);
  const needle = q.trim().toLowerCase();
  const shown = topics.filter(x => (!needle || x.topic.toLowerCase().includes(needle) || x.list.some(k => k.keyword.includes(needle)))
    && (view === 'all' || (view === 'nopage' && x.mapped < x.list.length) || (view === 'split' && x.pages.length > 1) || (view === 'ungrouped' && x.topic === NOT_GROUPED) || (view === 'ranking' && x.ranking)));
  const stats = {
    topics: names.length, keywords: tracked.length, loose: topics.find(x => x.topic === NOT_GROUPED)?.list.length || 0,
    nopage: topics.filter(x => x.topic !== NOT_GROUPED && x.mapped < x.list.length).length, volume: tracked.reduce((n, k) => n + (k.volume || 0), 0)
  };
  const move = (k, to) => run(`m${k.id}`, async () => {
    const out = await api(`/businesses/${b.id}/keywords/${k.id}`, { method: 'PATCH', body: { keyword: k.keyword, cluster: to === NOT_GROUPED ? '' : to } });
    kw.setData(d => ({ ...d, keywords: d.keywords.map(x => (x.id === k.id ? out : x)) }));
    kw.reload(true);
    toast(`"${k.keyword}" moved to ${to}`);
  });
  const rename = (x) => {
    const to = name.trim();
    setRenaming(null);
    if (!to || to === x.topic) return undefined;
    return run(`r${x.topic}`, async () => { for (const k of x.list) await api(`/businesses/${b.id}/keywords/${k.id}`, { method: 'PATCH', body: { keyword: k.keyword, cluster: to } }); kw.reload(true); toast(`Topic renamed to ${to}`); });
  };
  const pageOf = (u) => pathOf(u) || u;
  const Stat = ({ label, value, tone = 'text-slate-900', hint }) => <div className="rounded-xl bg-white ring-1 ring-slate-200 px-4 py-3" title={hint}><div className="text-11.5 font-semibold uppercase tracking-wide text-slate-500">{label}</div><div className={`text-22 font-semibold tabular-nums ${tone}`}>{value}</div></div>;
  const VIEWS = [['all', 'All topics'], ['nopage', 'Missing a page'], ['split', 'On more than one page'], ['ranking', 'Ranking on Google'], ['ungrouped', 'Not grouped']];
  return (
    <div className="space-y-4">
      {kw.data && tracked.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Topics" value={stats.topics} hint="Groups of keywords about the same thing: each should get one page" />
          <Stat label="Keywords" value={stats.keywords} hint="Saved keywords" />
          <Stat label="Searches / month" value={fmt(stats.volume)} hint="All the saved keywords together, from Google Ads" />
          <Stat label="Topics missing a page" value={stats.nopage} tone={stats.nopage ? 'text-amber-700' : 'text-emerald-700'} hint="A topic with a keyword that has no page chosen yet" />
        </div>)}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a topic or keyword" className={`${inputCls} pl-8 w-64`} aria-label="Find a topic or keyword" /></div>
        <div role="tablist" className="inline-flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">{VIEWS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)} className={`h-8 px-3 rounded-md text-12.5 font-semibold cursor-pointer ${view === id ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-800'}`}>{label}{id === 'ungrouped' && stats.loose ? ` ${stats.loose}` : ''}</button>)}</div>
        <div className="ml-auto flex items-center gap-2">
          <Button icon={Download} disabled={!shown.length} onClick={() => downloadCsv(`keyword-topics-${b.name}`, ['Topic', 'Keyword', 'Searches per month', 'Google rank', 'Page'],
            shown.flatMap(x => x.list.map(k => [x.topic === NOT_GROUPED ? 'Not grouped' : x.topic, k.keyword, k.volume ?? '', k.rank ?? '', k.target_url || ''])))} title="Download every keyword of the topics shown, with its topic, searches, rank and page, as a CSV file">Export CSV</Button>
          <Link to="/keyword-management/mapping"><Button icon={FileText}>Choose pages</Button></Link>
          <Button variant="ai" icon={Sparkles} busy={busy === 'cluster'} disabled={!tracked.length} onClick={cluster} title="Let AI put all the saved keywords into topics again. Topics you renamed or moved by hand are replaced.">{stats.topics ? 'Group again with AI' : 'Group into topics with AI'}</Button>
        </div>
      </div>
      <ErrorNote>{error}</ErrorNote>
      {!kw.data ? <SkCard title="Topics" subtitle="Keywords grouped into topics, one page per topic"><SkTable headers={["Keyword", "Volume", "Difficulty", "Rank"]} rows={5} bare /></SkCard>
        : !tracked.length ? <Card><div className="py-10 text-center text-13 text-slate-500">Save some keywords first: they are grouped into topics here.<div className="mt-3"><Link to="/keyword-management/workspace"><Button variant="primary" icon={Search}>Find keywords</Button></Link></div></div></Card>
        : !shown.length ? <Card><div className="py-8 text-center text-13 text-slate-500">No topic matches this.</div></Card> : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {shown.map(x => {
              const loose = x.topic === NOT_GROUPED;
              const full = x.mapped === x.list.length;
              return (
                <section key={x.topic} className={`rounded-xl bg-white ring-1 ${loose ? 'ring-amber-200' : 'ring-slate-200'} overflow-hidden flex flex-col`}>
                  <header className="px-4 pt-3.5 pb-3">
                    <div className="flex items-start gap-2">
                      {renaming === x.topic
                        ? <input autoFocus value={name} onChange={e => setName(e.target.value)} onBlur={() => rename(x)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setRenaming(null); } }} className={`${inputCls} h-8 flex-1`} aria-label="Topic name" />
                        : <h3 className="flex-1 text-15 font-semibold text-slate-900 capitalize">{x.topic}</h3>}
                      {!loose && renaming !== x.topic && <button type="button" onClick={() => { setName(x.topic); setRenaming(x.topic); }} title="Rename this topic" className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"><Pencil size={14} /></button>}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-12.5 text-slate-600">
                      <span><b className="text-slate-900">{x.list.length}</b> keywords</span>
                      <span><b className="text-slate-900 tabular-nums">{x.volume ? fmt(x.volume) : '—'}</b> searches/mo</span>
                      <span>{x.best ? <>Best rank <b className="text-slate-900">#{x.best}</b> · {x.ranking} of {x.list.length} on Google</> : 'Not on Google yet'}</span>
                    </div>
                    {loose && <p className="mt-2 text-12.5 text-amber-800 bg-amber-50 rounded px-2.5 py-1.5">These have no topic yet. Use "Group again with AI", or move each one with the list beside it.</p>}
                    {!loose && x.lead && <p className="mt-2 text-12.5 text-slate-600">Lead keyword: <b className="text-slate-900">{x.lead.keyword}</b>{x.lead.role === 'primary' ? ' (main keyword of its page)' : ''}</p>}
                  </header>
                  <ul className="px-4 divide-y divide-slate-100 border-t border-slate-100">
                    {x.list.slice(0, 8).map(k => (
                      <li key={k.id} className="py-1.5 flex items-center gap-2 text-12.5">
                        <span className="flex-1 min-w-0 truncate text-slate-800" title={k.keyword}>{k.keyword}</span>
                        {k.volume ? <span className="tabular-nums text-slate-500 w-14 text-right" title="Searches a month">{fmt(k.volume)}</span> : null}
                        <span className={`tabular-nums w-10 text-right ${k.rank ? 'text-slate-800 font-semibold' : 'text-slate-300'}`} title="Where it ranks on Google">{k.rank ? `#${k.rank}` : '—'}</span>
                        <Select value={loose ? '' : x.topic} disabled={busy === `m${k.id}`} onChange={e => e.target.value && move(k, e.target.value)} aria-label={`Move ${k.keyword} to another topic`} title="Move to another topic" className="h-7 max-w-[8.5rem] rounded border border-slate-200 bg-white text-12 text-slate-600 cursor-pointer">
                          <option value="">{loose ? 'Choose a topic' : 'Move to…'}</option>
                          {names.filter(n => n !== x.topic).map(n => <option key={n} value={n}>{n}</option>)}
                          {!loose && <option value={NOT_GROUPED}>Not grouped</option>}
                        </Select>
                      </li>))}
                  </ul>
                  {x.list.length > 8 && <p className="px-4 pb-1 text-12 text-slate-500">and {x.list.length - 8} more</p>}
                  <footer className="mt-auto px-4 py-3 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center gap-2">
                    <div className="flex-1 min-w-[10rem] text-12.5">
                      {!x.pages.length ? <span className="inline-flex items-center gap-1.5 text-amber-800"><AlertTriangle size={13} />No page chosen yet</span>
                        : <span className="inline-flex items-center gap-1.5 text-slate-700 min-w-0"><FileText size={13} className="text-slate-400 shrink-0" /><span className="truncate" title={x.pages.join('\n')}>{x.pages.length === 1 ? pageOf(x.pages[0]) : `${x.pages.length} different pages`}</span></span>}
                      {x.pages.length > 0 && !full && <span className="block text-11.5 text-amber-700">{x.list.length - x.mapped} of {x.list.length} keywords have no page</span>}
                      {x.pages.length > 1 && <span className="block text-11.5 text-amber-700">One topic should be one page: pick a single page for it.</span>}
                    </div>
                    {!loose && <Act icon={Eye} tone="indigo" tip="Where each keyword of this topic can be used: pages, FAQ, blog, Google posts" onClick={() => setUseIds(x.list.map(k => k.id))}>Where to use</Act>}
                    {!loose && x.lead && <Link to={`/ai-content-generation/blog?keyword=${encodeURIComponent(x.lead.keyword)}`}><Act icon={PenLine} tone="primary" tip={`Write a blog post for "${x.lead.keyword}"`}>Write</Act></Link>}
                    <Link to={`/keyword-management/mapping${x.lead ? `?keyword=${encodeURIComponent(x.lead.keyword)}` : ''}`}><Act icon={FileText} tone="slate" tip="Choose the page for this topic">{x.pages.length ? 'Change page' : 'Choose page'}</Act></Link>
                  </footer>
                </section>
              );
            })}
          </div>)}
      <UseKeywordsModal b={b} ids={useIds} onClose={() => setUseIds(null)} />
      {toastNode}
    </div>
  );
}


const EXPLORER_PLATFORMS = [
  { id: 'google', label: 'Google' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'bing', label: 'Bing' },
  { id: 'amazon', label: 'Amazon' },
  { id: 'duckduckgo', label: 'DuckDuckGo' },
  { id: 'ebay', label: 'eBay' },
  { id: 'app_stores', label: 'App Stores' }
];

const COMP_ORDER = { LOW: 0, MEDIUM: 1, HIGH: 2 };
const explorerValue = (k, key) => (key === 'keyword' ? k.keyword : key === 'volume' ? k.search_volume ?? null : key === 'intent' ? k.intent || null : key === 'competition' ? (COMP_ORDER[k.competition] ?? null) : key === 'cpc' ? k.cpc ?? null : key === 'difficulty' ? k.difficulty ?? null : null);

function SparkTrend({ values = [] }) {
  if (!values || !values.length) return <span className="text-slate-300 font-mono text-[11px]">—</span>;
  const max = Math.max(...values, 1);
  return (
    <div className="flex items-end gap-0.5 h-4 w-16" title={values.map(v => fmt(v)).join(', ')}>
      {values.map((v, idx) => (
        <div
          key={idx}
          className="w-1 bg-indigo-500 rounded-t-xs transition-all hover:bg-indigo-700"
          style={{ height: `${Math.max(15, Math.round((v / max) * 100))}%` }}
        />
      ))}
    </div>
  );
}

function KeywordExplorer({ b, tracked = [], onTracked, seedSearch }) {
  const [keyword, setKeyword] = useState('');
  const [country, setCountry] = useState('IN');
  const [platforms, setPlatforms] = useState(['google', 'youtube', 'bing', 'amazon', 'duckduckgo']);
  const [limit, setLimit] = useState(100);
  const [results, setResults] = useState([]);
  const [filterText, setFilterText] = useState('');
  const [filterIntent, setFilterIntent] = useState('ALL');
  const [filterComp, setFilterComp] = useState('ALL');
  const [selectedKws, setSelectedKws] = useState([]);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const [copiedKw, setCopiedKw] = useState(null);

  const trackedSet = useMemo(() => new Set((tracked || []).map(k => (k.keyword || '').toLowerCase())), [tracked]);

  const togglePlatform = (pid) => {
    setPlatforms(prev =>
      prev.includes(pid)
        ? (prev.length > 1 ? prev.filter(x => x !== pid) : prev)
        : [...prev, pid]
    );
  };

  const search = (seed) => run('search', async () => {
    const q = (typeof seed === 'string' ? seed : keyword).trim();
    if (!q) return;
    setKeyword(q);
    // Same host as the rest of the API (SEO_API ends in /api/v1; the Keyword Explorer lives at /api/keywords), signed in with the session cookie.
    const r = await fetch(`${SEO_API.replace(/\/v1$/, '')}/keywords`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keyword: q,
        country: country.trim().toUpperCase() || 'IN',
        platforms,
        limit: Number(limit) || 100,
        include_expansions: true
      })
    });
    if (!r.ok) {
      const errData = await r.json().catch(() => ({}));
      throw new Error(errData.detail || `Keyword Explorer failed (${r.status})`);
    }
    const data = await r.json();
    setResults(data || []);
    setSelectedKws([]);
  });

  const searchedN = React.useRef(0);
  useEffect(() => { // the shared search box: this source answers the same keyword
    if (!seedSearch?.n || searchedN.current === seedSearch.n) return;
    searchedN.current = seedSearch.n;
    search(seedSearch.text);
  }, [seedSearch?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // one click on the source shows its results: it opens with the business's own first service
    if (!seedSearch?.n) search((b.services || []).map(x => String(x?.name || x || '').trim()).filter(Boolean)[0] || b.category || b.name || '');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const trackSingle = (kw) => run(`t-${kw}`, async () => {
    await api(`/businesses/${b.id}/keywords`, { method: 'POST', body: [{ keyword: kw }] });
    if (onTracked) onTracked([kw], 1);
  });

  const trackSelected = () => run('bulk-track', async () => {
    if (!selectedKws.length) return;
    await api(`/businesses/${b.id}/keywords`, {
      method: 'POST',
      body: selectedKws.map(k => ({ keyword: k }))
    });
    const names = selectedKws;
    setSelectedKws([]);
    if (onTracked) onTracked(names, names.length);
  });

  const copyText = (kw) => {
    navigator.clipboard?.writeText(kw);
    setCopiedKw(kw);
    setTimeout(() => setCopiedKw(null), 1500);
  };

  const filteredResults = useMemo(() => {
    return results.filter(item => {
      if (filterText && !item.keyword.toLowerCase().includes(filterText.toLowerCase())) return false;
      if (filterIntent !== 'ALL' && item.intent !== filterIntent) return false;
      if (filterComp !== 'ALL' && item.competition !== filterComp) return false;
      return true;
    });
  }, [results, filterText, filterIntent, filterComp]);

  const { sorted: sortedResults, sort: exSort, onSort: onExSort } = useSorted(filteredResults, explorerValue);
  const exPager = usePager(sortedResults, { size: 25, resetKey: `${filterText}|${filterIntent}|${filterComp}|${results.length}` });

  const toggleSelectAll = () => {
    if (selectedKws.length === filteredResults.length) {
      setSelectedKws([]);
    } else {
      setSelectedKws(filteredResults.map(x => x.keyword));
    }
  };

  const exportCsv = () => {
    if (!filteredResults.length) return;
    downloadCsv(`keywords-${keyword.trim().replace(/\s+/g, '-')}-${country}`, ['Keyword', 'Search volume', 'Intent', 'Competition', 'CPC', 'Difficulty'],
      sortedResults.map(k => [k.keyword || '', k.search_volume ?? '', k.intent || '', k.competition || '', k.cpc ?? '', k.difficulty ?? '']));
  };

  const avgVol = results.length ? Math.round(results.reduce((s, x) => s + (x.search_volume || 0), 0) / results.length) : 0;
  const avgCpc = results.length ? (results.reduce((s, x) => s + (x.cpc || 0), 0) / results.length).toFixed(2) : '0.00';
  const avgDiff = results.length ? Math.round(results.reduce((s, x) => s + (x.difficulty || 0), 0) / results.length) : 0;

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-white ring-1 ring-slate-200 px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2" title="Suggestions from Google, YouTube, Bing, Amazon, DuckDuckGo, eBay and App Stores, with volume, competition, CPC and intent">
        <span className="text-13 text-slate-600">Seed <b className="text-slate-900">{keyword || 'none yet'}</b></span>
        <div role="group" aria-label="Platforms to query" className="flex flex-wrap items-center gap-1.5">
          {EXPLORER_PLATFORMS.map(p => {
            const active = platforms.includes(p.id);
            return <button key={p.id} type="button" onClick={() => togglePlatform(p.id)} aria-pressed={active} className={`h-7 px-2.5 rounded-md text-12 font-semibold cursor-pointer ring-1 ring-inset ${active ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'}`}>{p.label}</button>;
          })}
        </div>
        <label className="inline-flex items-center gap-1.5 text-12 font-semibold text-slate-500">Country<input aria-label="Country" className="h-8 w-14 px-2 text-13 rounded-md border border-slate-200 uppercase font-mono text-slate-800" maxLength={2} value={country} onChange={e => setCountry(e.target.value.toUpperCase())} /></label>
        <label className="inline-flex items-center gap-1.5 text-12 font-semibold text-slate-500">Limit
          <Select aria-label="Limit" className="h-8 px-2 text-13 rounded-md border border-slate-200 bg-white text-slate-800 cursor-pointer" value={limit} onChange={e => setLimit(Number(e.target.value))}><option value={50}>50</option><option value={100}>100</option><option value={200}>200</option></Select>
        </label>
        <Button size="sm" variant="primary" icon={Search} busy={busy === 'search'} disabled={!keyword.trim()} onClick={() => search()} className="ml-auto">Explore again</Button>
      </div>
      <ErrorNote>{error}</ErrorNote>

      {results.length > 0 && (
        <div className="space-y-4">
          {/* Summary: one slim line */}
          <div className="rounded-xl bg-white ring-1 ring-slate-200 px-4 py-2.5 flex flex-wrap items-center gap-x-8 gap-y-1 text-13 text-slate-500">
            <span><b className="text-slate-900 tabular-nums">{results.length}</b> keywords</span>
            <span>Avg searches <b className="text-indigo-600 tabular-nums">{fmt(avgVol)}</b>/mo</span>
            <span>Avg CPC <b className="text-emerald-600 tabular-nums">${avgCpc}</b></span>
            <span>Avg difficulty <b className="text-amber-600 tabular-nums">{avgDiff}</b>/100</span>
          </div>

          {/* Results Table Card */}
          <Card
            pad={false}
            title={`Keywords (${filteredResults.length} of ${results.length})`}
            subtitle="Multi-platform search suggestions with competitive and cost metrics."
            action={
              <div className="flex items-center gap-2">
                <Button size="sm" icon={Download} onClick={exportCsv} disabled={!filteredResults.length}>
                  CSV
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  icon={Plus}
                  busy={busy === 'bulk-track'}
                  disabled={!selectedKws.length}
                  onClick={trackSelected}
                >
                  Track {selectedKws.length ? `(${selectedKws.length})` : ''}
                </Button>
              </div>
            }
          >
            {/* Filter Toolbar */}
            <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-slate-50/60">
              <div className="flex flex-wrap items-center gap-2">
                <label className="relative min-w-[180px] max-w-xs">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    className="w-full h-8 pl-8 pr-3 text-12 rounded-lg bg-white ring-1 ring-inset ring-slate-200 outline-none focus:ring-indigo-400"
                    placeholder="Filter results..."
                    value={filterText}
                    onChange={e => setFilterText(e.target.value)}
                  />
                </label>
                <Select
                  className="h-8 px-2.5 text-11.5 rounded-lg bg-white ring-1 ring-inset ring-slate-200 outline-none focus:ring-indigo-400"
                  value={filterIntent}
                  onChange={e => setFilterIntent(e.target.value)}
                >
                  <option value="ALL">All Intents</option>
                  <option value="INFORMATIONAL">Informational</option>
                  <option value="COMMERCIAL">Commercial</option>
                  <option value="TRANSACTIONAL">Transactional</option>
                  <option value="NAVIGATIONAL">Navigational</option>
                </Select>
                <Select
                  className="h-8 px-2.5 text-11.5 rounded-lg bg-white ring-1 ring-inset ring-slate-200 outline-none focus:ring-indigo-400"
                  value={filterComp}
                  onChange={e => setFilterComp(e.target.value)}
                >
                  <option value="ALL">All Competition</option>
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                </Select>
              </div>
              <div className="text-11.5 text-slate-500 font-mono">
                {selectedKws.length} selected
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-12">
                <thead className="bg-white text-slate-500 border-b border-slate-200 text-11 font-semibold uppercase tracking-wider">
                  <tr>
                    <th className="p-3 w-8 text-center">
                      <input
                        type="checkbox"
                        className="accent-indigo-600 rounded cursor-pointer"
                        checked={selectedKws.length === filteredResults.length && filteredResults.length > 0}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <SortTh id="keyword" sort={exSort} onSort={onExSort} className="p-3">Keyword</SortTh>
                    <th className="p-3 text-left">12m Trend</th>
                    <SortTh id="volume" sort={exSort} onSort={onExSort} right first="desc" className="p-3">Volume</SortTh>
                    <SortTh id="intent" sort={exSort} onSort={onExSort} className="p-3" style={{ textAlign: 'center' }}>Intent</SortTh>
                    <SortTh id="competition" sort={exSort} onSort={onExSort} className="p-3" style={{ textAlign: 'center' }}>Competition</SortTh>
                    <SortTh id="cpc" sort={exSort} onSort={onExSort} right first="desc" className="p-3">CPC</SortTh>
                    <SortTh id="difficulty" sort={exSort} onSort={onExSort} className="p-3" style={{ textAlign: 'center' }}>Difficulty</SortTh>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {exPager.rows.map((item, idx) => {
                    const isTracked = trackedSet.has((item.keyword || '').toLowerCase());
                    const isSelected = selectedKws.includes(item.keyword);
                    const intentKey = (item.intent || '').toLowerCase();
                    return (
                      <tr key={`${exPager.from + idx}-${item.keyword}`} className={`hover:bg-slate-50/80 transition-colors ${isSelected ? 'bg-indigo-50/40' : ''}`}>
                        <td className="p-3 text-center">
                          <input
                            type="checkbox"
                            className="accent-indigo-600 rounded cursor-pointer"
                            checked={isSelected}
                            onChange={() => {
                              setSelectedKws(prev =>
                                prev.includes(item.keyword)
                                  ? prev.filter(k => k !== item.keyword)
                                  : [...prev, item.keyword]
                              );
                            }}
                          />
                        </td>
                        <td className="p-3 font-semibold text-slate-800">
                          <div className="flex items-center gap-1.5">
                            <span>{item.keyword}</span>
                            <button
                              type="button"
                              onClick={() => copyText(item.keyword)}
                              className="text-slate-300 hover:text-slate-600 p-0.5 cursor-pointer"
                              title="Copy keyword"
                            >
                              {copiedKw === item.keyword ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                            </button>
                          </div>
                        </td>
                        <td className="p-3">
                          <SparkTrend values={item.trend} />
                        </td>
                        <td className="p-3 text-right font-mono font-bold text-slate-900">
                          {fmt(item.search_volume)}
                        </td>
                        <td className="p-3 text-center">
                          <Badge tone={INTENT_TONE[intentKey] || 'gray'}>
                            {item.intent}
                          </Badge>
                        </td>
                        <td className="p-3 text-center">
                          <Badge tone={item.competition === 'LOW' ? 'green' : item.competition === 'MEDIUM' ? 'amber' : 'red'}>
                            {item.competition}
                          </Badge>
                        </td>
                        <td className="p-3 text-right font-mono text-slate-700">
                          ${(item.cpc || 0).toFixed(2)}
                        </td>
                        <td className="p-3 text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-11 font-bold ${
                            item.difficulty < 30
                              ? 'bg-emerald-50 text-emerald-700'
                              : item.difficulty < 60
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-rose-50 text-rose-700'
                          }`}>
                            {item.difficulty}
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          {isTracked ? (
                            <span className="inline-flex items-center gap-1 text-11 font-semibold text-emerald-700">
                              <CheckCircle2 size={12} /> Tracked
                            </span>
                          ) : (
                            <Button
                              size="sm"
                              variant="secondary"
                              icon={Plus}
                              busy={busy === `t-${item.keyword}`}
                              onClick={() => trackSingle(item.keyword)}
                            >
                              Track
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager p={exPager} label="keywords" />
          </Card>
        </div>
      )}
      {toastNode}
    </div>
  );
}


/* ── AI suggestions and "where to use them" ───────────────────────────── */

const USE_LABEL = { blog: 'Blog', gmb_post: 'Google posts', aeo: 'AEO answers', geo: 'AI search (GEO)', chatgpt: 'ChatGPT', website: 'Website' };
const USE_TONE = { blog: 'bg-violet-50 text-violet-700 ring-violet-200', gmb_post: 'bg-sky-50 text-sky-700 ring-sky-200', aeo: 'bg-amber-50 text-amber-800 ring-amber-200', geo: 'bg-emerald-50 text-emerald-700 ring-emerald-200', chatgpt: 'bg-teal-50 text-teal-700 ring-teal-200', website: 'bg-slate-50 text-slate-700 ring-slate-200' };
const HORIZONS = [['done', 'Builds on what you already do', 'Based on your services, saved keywords, posts and articles'], ['next', 'Where you can grow next', 'A realistic direction for the next 3 to 6 months']];
const UseChip = ({ u }) => <span className={`inline-flex items-center rounded-full ring-1 ring-inset px-2 py-0.5 text-11 font-semibold whitespace-nowrap ${USE_TONE[u] || USE_TONE.website}`}>{USE_LABEL[u] || u}</span>;

function AiSuggestions({ b, tracked, onTracked, seedSearch }) {
  const cacheKey = `kwai:${b.id}`;
  const [data, setData] = useState(() => { try { return JSON.parse(sessionStorage.getItem(cacheKey) || 'null'); } catch { return null; } });
  const [picked, setPicked] = useState([]);
  const [busy, error, run] = useAction();
  const have = useMemo(() => new Set((tracked || []).map(k => k.keyword)), [tracked]);
  const items = (data?.items || []).filter(i => !have.has(i.keyword));
  const suggest = (topic = '') => run('suggest', async () => {
    const r = await api(`/businesses/${b.id}/keywords/ai-suggestions`, { method: 'POST', body: topic ? { topic } : {}, timeout: 120000 });
    setData(r); setPicked([]);
    try { sessionStorage.setItem(cacheKey, JSON.stringify(r)); } catch { /* optional */ }
  });
  const aiRows = React.useRef([]); // the rows the table shows now (after its search and filters), for "Pick all shown"
  const ranFor = React.useRef(0);
  useEffect(() => { // a topic typed in the search box above: the AI writes its suggestions around it
    if (!seedSearch?.n || ranFor.current === seedSearch.n) return;
    ranFor.current = seedSearch.n;
    suggest(seedSearch.text);
  }, [seedSearch?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!data && !seedSearch?.n) suggest(''); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- one click on the source shows its suggestions: nothing else to press
  const toggle = (k) => setPicked(p => (p.includes(k) ? p.filter(x => x !== k) : [...p, k]));
  const save = () => run('save', async () => {
    const chosen = items.filter(i => picked.includes(i.keyword));
    const r = await api(`/businesses/${b.id}/keywords`, { method: 'POST', body: chosen.map(i => ({ keyword: i.keyword, intent: i.intent || undefined, priority: i.priority, cluster: i.topic || undefined, uses: i.uses })) });
    onTracked(chosen.map(i => i.keyword), r.added);
  });
  const ev = data?.evidence;
  const facts = ev ? [[ev.services, 'services'], [ev.saved, 'saved keywords'], [ev.posts, 'Google posts'], [ev.articles, 'articles'], [ev.competitor_gaps, 'competitor gaps'], [ev.geo_prompts, 'AI-search questions'], [ev.failing_ai_checks, 'failing AI checks']].filter(([n]) => n > 0) : [];
  return (
    <div className="space-y-5">
      <Card title={`AI suggestions for ${b.name}`} subtitle="Keywords and questions to go after, written from what your business has really done and could grow into. Nothing is saved until you pick."
        action={<Button variant="ai" icon={Sparkles} busy={busy === 'suggest'} onClick={() => suggest(data?.topic || '')}>{data ? 'Suggest again' : 'Suggest keywords'}</Button>}>
        <ErrorNote>{error}</ErrorNote>
        {!data && busy !== 'suggest' && (
          <div className="py-8 text-center text-13 text-slate-500 max-w-xl mx-auto">
            Press <b>Suggest keywords</b>. The AI reads your services, the keywords you already track, your recent Google posts and blog articles, what competitors win, and what is missing for AI search, then proposes keywords and questions. Each one says why, and where to use it: blog, Google posts, AEO, GEO, ChatGPT or the website.
          </div>
        )}
        {busy === 'suggest' && <div className="py-10 flex items-center justify-center gap-2 text-13 text-slate-500"><Loader2 size={16} className="animate-spin" /> Reading your business and writing suggestions…</div>}
        {data && busy !== 'suggest' && (
          <>
            {facts.length > 0 && <p className="text-12.5 text-slate-500">Built from {facts.map(([n, l]) => `${n} ${l}`).join(' · ')}{ev.researched ? ' · competitor research' : ''}.</p>}
          </>
        )}
      </Card>
      {data && busy !== 'suggest' && items.length > 0 && (
        <Card pad={false}>
          <DataTable bare rows={items} rowKey={i => i.keyword} pageSize={25} exportName="ai-keyword-suggestions" label="suggestions" searchPlaceholder="Search suggestions" minWidth={900}
            onState={s => { aiRows.current = s.rows; }}
            rowClass={i => (picked.includes(i.keyword) ? 'bg-indigo-50/60' : 'hover:bg-slate-50')}
            filters={[
              { id: 'when', label: 'When', options: HORIZONS.map(([id, label]) => [id, label]), test: (i, v) => i.horizon === v },
              { id: 'intent', label: 'Intent', options: [...new Set(items.map(i => i.intent).filter(Boolean))].sort().map(x => [x, x]), test: (i, v) => i.intent === v },
              { id: 'priority', label: 'Priority', options: ['High', 'Medium', 'Low'].map(x => [x, x]), test: (i, v) => i.priority === v },
              { id: 'use', label: 'Use it for', options: Object.entries(USE_LABEL), test: (i, v) => (i.uses || []).includes(v) },
              { id: 'topic', label: 'Topic', options: [...new Set(items.map(i => i.topic).filter(Boolean))].sort().map(x => [x, x]), test: (i, v) => i.topic === v }
            ].filter(f => f.options.length > 1)}
            columns={[
              { id: 'pick', label: 'Pick', csv: false, className: 'pl-4 pr-1 py-3 w-10', thClass: 'pl-4 pr-1 py-3 w-10',
                header: <input type="checkbox" aria-label="Pick all shown" checked={aiRows.current.length > 0 && aiRows.current.every(i => picked.includes(i.keyword))} onChange={() => { const every = aiRows.current.every(i => picked.includes(i.keyword)); setPicked(p => (every ? p.filter(k => !aiRows.current.some(i => i.keyword === k)) : [...new Set([...p, ...aiRows.current.map(i => i.keyword)])])); }} />,
                cell: i => <input type="checkbox" checked={picked.includes(i.keyword)} onChange={() => toggle(i.keyword)} aria-label={`Pick ${i.keyword}`} /> },
              { id: 'keyword', header: 'Keyword and why', value: i => i.keyword, className: 'px-3 py-3 min-w-[260px]', cell: i => <><div className="text-14 font-semibold text-slate-900">{i.keyword}</div>{i.why && <div className="text-12.5 text-slate-600 mt-0.5">{i.why}</div>}</> },
              { id: 'topic', header: 'Topic', value: i => i.topic || null, cell: i => (i.topic ? <Badge tone="gray">{i.topic}</Badge> : <span className="text-slate-300">—</span>) },
              { id: 'intent', header: 'Intent', value: i => i.intent || null, cell: i => (i.intent ? <Badge tone={INTENT_TONE[i.intent] || 'gray'}>{i.intent}</Badge> : <span className="text-slate-300">—</span>) },
              { id: 'priority', header: 'Priority', csv: false, value: i => ({ High: 0, Medium: 1, Low: 2 })[i.priority] ?? 1, cell: i => <Badge tone={{ High: 'red', Medium: 'amber', Low: 'gray' }[i.priority] || 'gray'}>{i.priority || 'Medium'}</Badge> },
              { id: 'priority_name', header: 'Priority name', hide: true, value: i => i.priority || 'Medium' },
              { id: 'horizon', header: 'When', value: i => (i.horizon === 'next' ? 'Grow next' : 'Builds on what you do'), cell: i => <span className="text-12.5 text-slate-600 whitespace-nowrap">{i.horizon === 'next' ? 'Grow next' : 'Builds on what you do'}</span> },
              { id: 'uses', header: 'Use it for', value: i => (i.uses || []).map(u => USE_LABEL[u] || u).join(', '), className: 'px-3 py-3', cell: i => <span className="flex flex-wrap gap-1">{(i.uses || []).map(u => <UseChip key={u} u={u} />)}</span> }
            ]} />
        </Card>)}
      {data && busy !== 'suggest' && items.length === 0 && <Card><p className="py-8 text-center text-13 text-slate-500">{items.length ? 'Nothing in this filter. Choose All.' : 'Every suggestion is already saved. Press Suggest again for new ones.'}</p></Card>}
      {picked.length > 0 && (
        <div className="sticky bottom-3 z-10 rounded-xl bg-white border border-indigo-200 shadow-lg px-4 py-3 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[200px] text-13 text-slate-800"><b>{picked.length}</b> picked. They are saved with the topic and the areas shown, then you group and use them on the next page.</div>
          <Button size="sm" onClick={() => setPicked([])}>Clear</Button>
          <Button variant="primary" icon={Plus} busy={busy === 'save'} onClick={save}>Save {picked.length} keyword{picked.length === 1 ? '' : 's'}</Button>
        </div>
      )}
    </div>
  );
}

const AREA_ORDER = ['website', 'blog', 'gmb_post', 'aeo', 'geo', 'chatgpt'];
const AREA_HELP = {
  website: 'The keyword appears in your page titles, headings or services.',
  blog: 'A blog article uses the keyword.',
  gmb_post: 'A published Google Business Profile post uses it.',
  aeo: 'A question heading on your site or in a blog article answers it (answer engines quote these).',
  geo: 'It is asked to the AI engines in the GEO tracker.',
  chatgpt: 'Your ChatGPT business profile, policies or feed mention it.'
};

const useItValue = (i, key) => {
  if (key === 'keyword') return i.keyword;
  if (key === 'plan') return i.planned.length;
  const a = key.slice(2);
  return i.used[a] === true ? 2 : i.planned.includes(a) ? 1 : i.used[a] === null ? null : 0;
};

function UseIt({ b, kw }) {
  const usage = useApi(`/businesses/${b.id}/keywords/usage`);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [useQ, setUseQ] = useState('');
  const d = usage.data;
  const useRows = useMemo(() => {
    const needle = useQ.trim().toLowerCase();
    return (d?.items || []).filter(i => (!onlyOpen || AREA_ORDER.some(a => i.planned.includes(a) && i.used[a] === false)) && (!needle || String(i.keyword).toLowerCase().includes(needle) || String(i.cluster || '').toLowerCase().includes(needle)));
  }, [d, onlyOpen, useQ]);
  const { sorted: useSortedRows, sort: useSort, onSort: onUseSort } = useSorted(useRows, useItValue);
  const usePage = usePager(useSortedRows, { size: 25, resetKey: `${onlyOpen}|${useQ}` });
  const addQuestion = (k) => run(`g${k.id}`, async () => { const r = await api(`/businesses/${b.id}/keywords/${k.id}/geo-prompt`, { method: 'POST', body: {} }); usage.reload(true); kw.reload(true); toast(r.added ? `Added to AI search: “${r.prompt}”` : 'That question is already tracked in AI search.'); });
  const setUses = (k, uses) => run(`u${k.id}`, async () => { await api(`/businesses/${b.id}/keywords/${k.id}`, { method: 'PATCH', body: { keyword: k.keyword, uses } }); usage.reload(true); kw.reload(true); });
  if (!d) return usage.error ? <ErrorNote>{usage.error.message}</ErrorNote> : <SkCard title="Keyword Usage" pad={false}><SkTable headers={['Keyword', 'Website', 'Blog', 'Google posts', 'AEO', 'AI search', 'ChatGPT']} rows={6} bare /></SkCard>;
  if (!d.total) return <Card><p className="py-10 text-center text-13 text-slate-500">Save some keywords first: find them in <Link to="/keyword-management/ai" className="font-semibold text-indigo-600 hover:underline">Find Keywords</Link>, then come back to put them to work.</p></Card>;
  const rows = usePage.rows;
  const link = (a, i) => ({
    blog: `/ai-content-generation/blog?topic=${encodeURIComponent(i.keyword)}`, gmb_post: `/google-posts?topic=${encodeURIComponent(i.keyword)}`,
    aeo: '/website-audit?tab=schema', chatgpt: '/chatgpt-business/profile', website: '/website-audit?tab=report'
  }[a]);
  const Cell = ({ a, i }) => {
    const used = i.used[a], planned = i.planned.includes(a);
    if (used === true) return <span className="inline-flex items-center gap-1 text-12 font-semibold text-emerald-700"><CheckCircle2 size={14} /> Used</span>;
    const action = a === 'geo'
      ? <button type="button" onClick={() => addQuestion(i)} disabled={busy === `g${i.id}`} className="text-12 font-semibold text-indigo-700 hover:underline cursor-pointer">{busy === `g${i.id}` ? 'Adding…' : 'Ask AI engines'}</button>
      : <Link to={link(a, i)} className="text-12 font-semibold text-indigo-700 hover:underline">{a === 'blog' ? 'Write article' : a === 'gmb_post' ? 'Write post' : a === 'aeo' ? 'Add answer' : a === 'chatgpt' ? 'Open profile' : 'See pages'}</Link>;
    return (
      <span className="flex flex-col items-start gap-0.5">
        <span className={`text-11 font-semibold ${planned ? 'text-indigo-700' : 'text-slate-400'}`}>{planned ? 'Planned' : used === null ? '—' : 'Not yet'}</span>
        {(planned || a === 'geo') && action}
      </span>
    );
  };
  return (
    <div className="space-y-5">
      {toastNode}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {AREA_ORDER.map(a => (
          <div key={a} className="ai-glass-card rounded px-4 py-3.5" title={AREA_HELP[a]}>
            <div className="text-12 font-semibold text-slate-500">{USE_LABEL[a]}</div>
            <div className="text-22 font-bold text-slate-900 tabular-nums mt-0.5">{d.areas[a].used}<span className="text-13 font-medium text-slate-400"> of {d.total} used</span></div>
            <div className="text-11.5 text-indigo-700">{d.areas[a].planned} planned</div>
          </div>
        ))}
      </div>
      <ErrorNote>{error}</ErrorNote>
      <Card pad={false} title="Put your keywords to work" subtitle="For every saved keyword: where it already appears, and where it is meant to be used. Each button opens the right place with the keyword ready."
        action={<span className="inline-flex flex-wrap items-center gap-3"><label className="inline-flex items-center gap-2 text-12.5 text-slate-600 cursor-pointer"><input type="checkbox" checked={onlyOpen} onChange={e => setOnlyOpen(e.target.checked)} />Only what is planned but not done</label>
          <Button size="sm" icon={Download} disabled={!useSortedRows.length} title="Download all the keywords listed, with where each is used or planned, as a CSV file"
            onClick={() => downloadCsv(`keyword-usage-${b.name}`, ['Keyword', 'Topic', 'Google rank', ...AREA_ORDER.map(a => USE_LABEL[a]), 'Planned areas'],
              useSortedRows.map(i => [i.keyword, i.cluster || '', i.rank ?? '', ...AREA_ORDER.map(a => (i.used[a] === true ? 'Used' : i.planned.includes(a) ? 'Planned' : i.used[a] === null ? 'Not checked' : 'Not yet')), i.planned.map(a => USE_LABEL[a] || a).join(', ')]))}>Export CSV</Button></span>}>
        {d.items.length > 10 && <div className="px-4 py-3 border-b border-slate-100"><input value={useQ} onChange={e => setUseQ(e.target.value)} placeholder="Search keywords" aria-label="Search keywords" className="h-8 w-full max-w-xs px-3 text-13 rounded-md border border-slate-200 bg-white focus:border-indigo-400 outline-none" /></div>}
        <div className="overflow-x-auto">
          <table className="w-full text-13 min-w-[860px]">
            <thead className="bg-slate-50 text-11.5 text-slate-500"><tr><SortTh id="keyword" sort={useSort} onSort={onUseSort} className="p-3">Keyword</SortTh>{AREA_ORDER.map(a => <SortTh key={a} id={`a:${a}`} sort={useSort} onSort={onUseSort} first="desc" className="p-3" title={AREA_HELP[a]}>{USE_LABEL[a]}</SortTh>)}<SortTh id="plan" sort={useSort} onSort={onUseSort} first="desc" className="p-3">Plan</SortTh></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(i => (
                <tr key={i.id} className="align-top hover:bg-slate-50">
                  <td className="p-3"><div className="font-semibold text-slate-900">{i.keyword}</div><div className="text-11.5 text-slate-500">{i.cluster || 'No topic yet'}{i.rank ? ` · ranks #${i.rank}` : ''}</div></td>
                  {AREA_ORDER.map(a => <td key={a} className="p-3"><Cell a={a} i={i} /></td>)}
                  <td className="p-3">
                    <Select className="h-8 px-2 text-12 rounded-lg bg-white ring-1 ring-inset ring-slate-200" value="" onChange={e => { const v = e.target.value; if (v) setUses(i, i.planned.includes(v) ? i.planned.filter(x => x !== v) : [...i.planned, v]); }} aria-label={`Plan where to use ${i.keyword}`}>
                      <option value="">{i.planned.length ? `${i.planned.length} planned` : 'Choose areas'}</option>
                      {AREA_ORDER.map(a => <option key={a} value={a}>{i.planned.includes(a) ? '✓ ' : ''}{USE_LABEL[a]}</option>)}
                    </Select>
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} className="p-8 text-center text-slate-500">Nothing planned is left to do.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager p={usePage} label="keywords" />
      </Card>
      <p className="text-11.5 text-slate-400">“Used” is read from your real content: the website crawl and profile, published posts, blog articles, question headings (AEO), tracked AI questions (GEO) and the ChatGPT profile and feed. A keyword counts as used only when all its words appear together.</p>
    </div>
  );
}

const FIND_TABS = ['ai', 'discover', 'planner', 'explorer'];
const SAVE_TABS = ['tracked', 'topics', 'use', 'status'];
const SOURCES = [['ai', 'AI suggestions', 'Keywords and questions written from what your business has really done and could grow into'], ['discover', 'Ideas for my business', 'Built from your services, area, website and competitors'], ['planner', 'Google numbers', 'Search volume, competition and bids from the Google Keyword Planner'], ['explorer', 'Other platforms', 'Suggestions from YouTube, Bing, Amazon and more']];

function Keywords({ b, tab, kw, onSaved, seedSearch }) {
  const tracked = kw.data?.keywords || [];
  // a source that was opened stays in the page (hidden) while another is on screen: its results are still there when you come back
  const [opened, setOpened] = useState(() => new Set([tab]));
  useEffect(() => { setOpened(o => (o.has(tab) ? o : new Set([...o, tab]))); }, [tab]);
  const live = (id) => opened.has(id) || tab === id;
  // a source that is hidden keeps the search it last ran: it answers a new one when it is opened, so one search does not ask all four sources at once
  const last = React.useRef({});
  if (FIND_TABS.includes(tab)) last.current[tab] = seedSearch;
  const seedOf = (id) => last.current[id] || seedSearch;
  const keep = (id, node) => live(id) && <div key={id} hidden={tab !== id}>{node}</div>;
  return (
    <>
      {keep('ai', <AiSuggestions b={b} tracked={tracked} onTracked={onSaved} seedSearch={seedOf('ai')} />)}
      {keep('discover', <Discover b={b} tracked={tracked} onTracked={onSaved} seedSearch={seedOf('discover')} />)}
      {keep('planner', <GooglePlanner b={b} tracked={tracked} onTracked={onSaved} seedSearch={seedOf('planner')} />)}
      {keep('explorer', <KeywordExplorer b={b} tracked={tracked} onTracked={onSaved} seedSearch={seedOf('explorer')} />)}
      {tab === 'tracked' && <Tracked b={b} kw={kw} />}
      {tab === 'topics' && <Topics b={b} kw={kw} />}
      {tab === 'use' && <UseIt b={b} kw={kw} />}
      {tab === 'status' && <KeywordStatus b={b} />}
    </>
  );
}

const FLOW_AT = { workspace: 'workspace', ai: 'find', discover: 'find', planner: 'find', explorer: 'find', tracked: 'mine', topics: 'topics', use: 'use', mapping: 'mapping', status: 'status' };

const FIND_ICON = { ai: Sparkles, discover: MapPin, planner: BarChart2, explorer: Globe };
const FIND_CARDS = [
  ['ai', 'AI suggestions', 'Written from your business: what it does, what competitors win, what is missing'],
  ['discover', 'Ideas for my business', 'Real Google searches around your services and your areas'],
  ['planner', 'Google numbers', 'Searches per month and cost for a keyword'],
  ['explorer', 'Other platforms', 'YouTube, Bing, Amazon and more'],
];
const FIND_HINT = {
  ai: 'Type a topic to focus the suggestions, or leave it empty to use your whole business.',
  discover: 'Type a word to start from it, or leave it empty to start from your services.',
  planner: 'Type a keyword to see its searches, cost and related ideas.',
  explorer: 'Type a keyword to see what people search for on other platforms.',
};

/** The top of Find Keywords: the four places to look (one click shows that source's results) and one search box that asks the one you are on. */
function FindHeader({ tab, setTab, typed, setTyped, onSearch, seedText }) {
  return (
    <div className="bg-white rounded-xl ring-1 ring-slate-200 shadow-sm mb-3 overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-3 pt-2 pb-2">
        <div role="tablist" aria-label="Where the ideas come from" className="flex flex-wrap gap-1">
          {FIND_CARDS.map(([id, label, text]) => {
            const Icon = FIND_ICON[id];
            const on = tab === id;
            return (
              <button key={id} type="button" role="tab" aria-selected={on} onClick={() => setTab(id)} title={text}
                className={`h-9 px-3 rounded-lg text-13.5 font-semibold cursor-pointer inline-flex items-center gap-2 transition-colors ${on ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                <Icon size={15} />{label}
              </button>);
          })}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onSearch(); }} role="search" className="flex flex-1 min-w-[260px] gap-2 lg:ml-auto lg:max-w-xl">
          <label className="relative flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="Search a keyword or topic" aria-label="Search keywords" className="w-full h-9 pl-9 pr-3 text-13.5 rounded-lg bg-white ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none" /></label>
          <Button type="submit" variant="primary" icon={Search} disabled={typed.trim().length < 2}>Search</Button>
        </form>
      </div>
      <p className="px-4 py-1.5 border-t border-slate-100 bg-slate-50/60 text-12 text-slate-500">{FIND_HINT[tab]}{seedText ? <> Showing results for <b className="text-slate-700">{seedText}</b>.</> : null}</p>
    </div>
  );
}

function KeywordPath({ b, tab, setTab }) {
  const kw = useApi(`/businesses/${b.id}/keywords`);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const fromUrl = (params.get('q') || '').trim();
  const [typed, setTyped] = useState(fromUrl);
  const [seedSearch, setSeedSearch] = useState({ n: fromUrl ? 1 : 0, text: fromUrl }); // one search for every source: the source on screen runs it now, the others when opened
  // The searched word lives in the address (?q=), so it survives moving from one source to another.
  const startSearch = () => {
    const t = typed.trim();
    if (t.length < 2) return;
    setSeedSearch(x => ({ n: x.n + 1, text: t }));
    navigate(`/keyword-management/${tab}?q=${encodeURIComponent(t)}`, { replace: true });
  };
  const refresh = { ...kw, reload: (q) => { kw.reload(q); } };
  // Saving a keyword from any source ends on My Keywords, with what was just saved marked.
  const saved = (names, added) => {
    kw.reload(true);
    navigate('/keyword-management/tracked', { state: { added: names || [], newCount: added ?? (names || []).length } });
  };
  if (tab === 'mapping') {
    return (
      <>
        <KeywordMappingTab b={b} />
      </>
    );
  }
  if (tab === 'workspace') {
    return (
      <>
        <KeywordWorkspace b={b} onUse={setTab} />
      </>
    );
  }
  return (
    <>

      {FIND_TABS.includes(tab) && <FindHeader tab={tab} setTab={setTab} typed={typed} setTyped={setTyped} onSearch={startSearch} seedText={seedSearch.text} />}
      <Keywords b={b} tab={tab} kw={refresh} onSaved={saved} seedSearch={seedSearch} />
    </>
  );
}

export default function KeywordResearchPage() {
  const [tab, setTab] = useUrlTab('workspace', ['workspace', 'mapping', 'ai', 'discover', 'planner', 'explorer', 'tracked', 'topics', 'use', 'status']);
  const HEAD = {
    workspace: ['Find Keywords', 'One list of keywords from Google Keyword Planner, your website, Search Console, your Google listing and competitors; AI suggestions on request. Compare them, then pick'],
    tracked: ['Saved Keywords', 'The keywords you keep: primary or secondary, priority, searches, difficulty, the page that targets each and where it ranks'],
    topics: ['Keyword Strategy Builder', 'Group your saved keywords into topics, see the lead keyword of each topic and which page it still needs'],
    use: ['Where to Use Keywords', 'Put each saved keyword into your blog, posts, website and AI answers'],
    mapping: ['Keyword Mapping', 'Choose the page that targets each keyword and fix keywords that compete for one page'],
    status: ['Keyword Status', 'How each saved keyword is doing and what to do next'],
    ai: ['AI Keyword Suggestions', 'Keywords written from what your business has done and could grow into'],
    discover: ['Ideas for My Business', 'Real Google searches around your services and areas'],
    planner: ['Google Numbers', 'Searches per month and cost for a keyword'],
    explorer: ['Other Platforms', 'What people search on YouTube, Bing, Amazon and more'],
  }[tab] || ['Keywords', 'Find, choose, use and track your keywords'];
  return (
    <SeoShell step="keywords" title={HEAD[0]} subtitle={HEAD[1]}>
      {(b) => <KeywordPath key={b.id} b={b} tab={tab} setTab={setTab} />}
    </SeoShell>
  );
}
