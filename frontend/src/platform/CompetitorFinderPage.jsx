import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { KeywordGap, CompareDomains } from './SeoToolkit';
import {
  Users, Search, MapPin, Star, Globe, ExternalLink, Loader2, AlertTriangle, Lightbulb, Plus, X, Link2, FileText, Gauge, Settings2, Play,
  CheckCircle2, Minus, Layers, ArrowRight, BookOpen, Code2, ListChecks, HelpCircle, Sparkles, ShieldCheck, Smartphone, Monitor, RotateCcw, Eye, Download
} from 'lucide-react';
import { SeoShell, Card, Badge, Button, Drawer, Field, Tabs, Modal, inputCls, ErrorNote, useToast, useAction, Sk, SkStats, SkTable, SkCard } from './SeoUi';
import { api, useApi, usePoll, fmt, fmtDateTime } from './seoApi';
import { ComparisonResult } from './CompetitorAuditCompare';
import CompetitorPagesTab from './CompetitorPagesTab';
import MyCompetitors from './MyCompetitors';
import { MapsTable, Pos as RankPos, RankingsTable } from './CompetitorTables';
import { AnalysisStats, AutoBar, BacklinkTab, CompetitorsPanel, TopPagesTab, TrafficTab, useAnalysis, useAutoAnalysis, useRatings } from './CompetitorAnalysis';
import PlacePicker from './PlacePicker';
import Select from '../components/Select';
import { CompetitorKeywordsTab, KeywordGapTab } from './CompetitorKeywordTabs';
import { Act, Head } from './TableBits';
import { usePager, Pager, useSorted, SortTh, downloadCsv, downloadFile } from './DataTable';

const slugOf = (t) => String(t || 'project').toLowerCase().replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const today = () => new Date().toISOString().slice(0, 10);
const csvBtn = (onClick, label = 'Export CSV') => <Button size="sm" icon={Download} onClick={onClick}>{label}</Button>;
/** The whole research as one readable document: what was found, who competes, where you stand and what to do. */
function researchMd(r) {
  const s = r.summary || {};
  const list = (items) => (items && items.length ? items.map(x => `- ${x}`) : ['- None.']);
  return [`# Competitor research: ${r.business?.name || 'project'}`, '', `Researched ${r.analysed_at ? String(r.analysed_at).slice(0, 10) : today()} · ${r.location || ''} · ${r.keywords.length} keywords`, '',
    '## Where you stand', '', `- Google visibility: ${s.keywords_ranked ? `${s.visibility}%` : 'not available (link Search Console)'}`, `- Google Maps visibility: ${s.local_visibility}%`, `- Competitors found: ${s.competitors}`, '',
    '## What to do first', '', ...(r.actions.length ? r.actions.map((a, i) => `${i + 1}. **${a.title}** (${(PRIORITY[a.priority] || PRIORITY.low)[1]}): ${a.why}`) : ['No gaps found for these keywords.']), '',
    '## Keywords where competitors are on page 1 and you are not', '', ...(r.gaps.keywords.length ? r.gaps.keywords.map(g => `- ${g.keyword}: ${g.competitors.map(c => `${c.domain} (#${c.position})`).join(', ')}`) : ['None.']), '',
    '## Competitors on Google', '', ...(r.organic_competitors.length ? r.organic_competitors.map(d => `- ${d.domain}${d.type === 'directory' ? ' (listing site)' : ''}: ${d.visibility}% visibility, ${d.keywords_top10} keywords on page 1`) : ['None.']), '',
    '## Competitors on Google Maps', '', ...(r.local_competitors.length ? r.local_competitors.map(e => `- ${e.name}: ${e.visibility}% visibility, rating ${e.rating ?? 'n/a'} (${e.reviews ?? 0} reviews)${e.website ? `, ${e.website}` : ''}`) : ['None.']), '',
    '## Keywords researched', '', ...list(r.keywords), '',
    '## Keyword ideas', '', '### Keywords competitors target', ...list(r.ideas?.competitor_keywords), '', '### Questions people ask', ...list(r.ideas?.questions), '', '### Related searches', ...list(r.ideas?.related), ''].join('\n');
}

/**
 * Competitor research for the selected business, from live Google data, in one place: who ranks on Google
 * and in Google Maps for its keywords, each competitor's visibility, what they do on their sites, where
 * they are listed, the business's own gaps with a plan, and a website-vs-competitor audit (PageSpeed,
 * Lighthouse SEO, on-page content) per competitor. Tables hold the data; details open in modals.
 * Server: /businesses/{id}/competitor-research, /competitor-research/{run}, /competitors, /audit/competitors.
 */

const MAX_KEYWORDS = 10;
const isRunning = (r) => r && (r.status === 'queued' || r.status === 'running');
const running = (s) => s === 'queued' || s === 'running';
const baseSite = (d) => String(d || '').replace(/^(www|in|en|m)\./, '');
const hostOf = (u) => { try { return baseSite(new URL(/^https?:\/\//.test(u) ? u : `https://${u}`).hostname); } catch (e) { return ''; } };
const AUDIT_LABEL = { queued: 'Queued…', running: 'Auditing…', done: 'Audited', failed: 'Failed' };
// Compare always works: it reads what the competitor has (website, Google listing, or both) and compares each with yours.
const compareHint = (c) => c?.website ? 'Compare its website and its Google listing with yours' : 'No website: compare its Google listing with yours';
const PRIORITY = { high: ['red', 'Do first'], medium: ['amber', 'Next'], low: ['gray', 'Later'] };

/** A Google position as a chip: the number is always shown, colour only backs it up. */
const Pos = ({ value, maps }) => {
  if (!value) return <span className="inline-flex items-center justify-center w-9 h-6 rounded-md text-12 text-slate-400 bg-slate-50 border border-slate-200" title="Not in the results">—</span>;
  const cls = value <= 3 ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : value <= 10 ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-slate-50 text-slate-600 border-slate-200';
  return <span className={`inline-flex items-center justify-center min-w-9 h-6 px-1.5 rounded-md text-12 font-bold tabular-nums border ${cls}`} title={`${maps ? 'Google Maps' : 'Google'} position ${value}`}>#{value}</span>;
};

const Stars = ({ rating, reviews }) => (
  <span className="inline-flex items-center gap-1 text-12.5 text-slate-700 whitespace-nowrap">
    <Star size={12} className={rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'} />
    <b className="text-slate-900">{rating ? Number(rating).toFixed(1) : '—'}</b>
    {reviews != null && <span className="text-slate-500">({fmt(reviews)})</span>}
  </span>
);

const Chips = ({ items, empty, tone = 'slate' }) => (
  items && items.length ? (
    <div className="flex flex-wrap gap-1.5">
      {items.map(k => <span key={k} className={`px-2.5 py-1 rounded-full text-12.5 border ${tone === 'rose' ? 'bg-rose-50 text-rose-800 border-rose-200' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>{k}</span>)}
    </div>
  ) : <p className="text-13 text-slate-500">{empty}</p>
);

const Label = ({ icon: Icon, children }) => <div className="text-12 font-semibold  tracking-wide text-slate-500 mb-2 flex items-center gap-1.5">{Icon && <Icon size={13} />}{children}</div>;

/** A table that scrolls inside the page instead of making the page long. Give it `pager` (from usePager) for page numbers below it, `bar` for a search row above. */
const Table = ({ head, children, className = '', pager = null, bar = null, exportCsv = null }) => (
  <>
    {exportCsv && <div className="px-4 py-2 border-b border-slate-100 flex justify-end">{csvBtn(exportCsv)}</div>}
    {bar}
    <div className={`overflow-auto max-h-[calc(100vh-270px)] min-h-[320px] ${className}`}>
      <table className="w-full text-13">
        <thead className="sticky top-0 z-10 bg-slate-50 text-left text-11.5  tracking-wide text-slate-500 shadow-[0_1px_0_0_theme(colors.slate.200)]"><tr>{head}</tr></thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
    {pager && <Pager p={pager} label="rows" />}
  </>
);
/** A heading cell. With an `id` (and the sort state from useSorted) it sorts when pressed. */
const Th = ({ children, c = 'text-left', cls = '', id, sort, onSort, first }) => {
  if (!id) return <th className={`px-4 py-2.5 font-semibold whitespace-nowrap ${c} ${cls}`}>{children}</th>;
  const hd = React.isValidElement(children) && children.type === Head ? children : null;
  const { what, why, from } = hd ? hd.props : {};
  return <SortTh id={id} sort={sort} onSort={onSort} first={first} right={c === 'text-right'} tip={{ what, why, from }} className={`px-4 py-2.5 whitespace-nowrap ${c === 'text-center' ? 'text-center' : ''} ${cls}`}>{hd ? hd.props.children : children}</SortTh>;
};
/** The search row above a table. */
const SearchBar = ({ q, setQ, placeholder }) => <div className="px-4 py-2 border-b border-slate-100"><input value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="h-8 w-60 px-2 text-13 rounded-md border border-slate-200 bg-white focus:border-indigo-400 outline-none" /></div>;

/** Horizontal visibility bars: one hue, the business itself picked out, value labelled on every bar. */
function VisibilityBars({ rows }) {
  const top = Math.max(1, ...rows.map(r => r.value));
  return (
    <ul className="space-y-2">
      {rows.map(r => (
        <li key={r.label} className="grid grid-cols-[minmax(0,150px)_1fr_44px] items-center gap-3" title={`${r.label}: ${r.value}% visibility${r.sub ? ` · ${r.sub}` : ''}`}>
          <span className={`text-12.5 truncate ${r.mine ? 'font-bold text-emerald-800' : 'text-slate-700'}`}>{r.label}</span>
          <span className="h-2.5 rounded-full bg-slate-100 overflow-hidden"><span className={`block h-full rounded-full ${r.mine ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${Math.max(r.value > 0 ? 2 : 0, (r.value / top) * 100)}%` }} /></span>
          <span className="text-right text-12.5 font-semibold text-slate-800 tabular-nums">{r.value}%</span>
        </li>
      ))}
    </ul>
  );
}

/** Keywords + location + run. Inline when there is no research yet, in a modal afterwards. */
function SetupForm({ b, defaults, onStart, busy, error, setupInfo, hasRun }) {
  const [keywords, setKeywords] = useState(defaults.keywords || []);
  const [draft, setDraft] = useState('');
  const [location, setLocation] = useState(defaults.location || '');
  useEffect(() => { setKeywords(defaults.keywords || []); setLocation(defaults.location || ''); }, [defaults.keywords, defaults.location]);
  const add = () => {
    const parts = draft.split(',').map(s => s.trim()).filter(s => s.length >= 2);
    if (!parts.length) return;
    setKeywords(k => [...new Set([...k, ...parts])].slice(0, MAX_KEYWORDS));
    setDraft('');
  };
  return (
    <div className="space-y-4">
      {setupInfo.maps_only && (
        <div className="text-13 text-sky-900 bg-sky-50 border border-sky-200 rounded px-4 py-3">Competitors are the businesses <b>Google Maps</b> shows for your keywords (Google Places API), with their ratings, reviews and a scan of their websites. Your own organic position is Google Search Console's figure. Google gives no data on other websites' rankings or listing sites, so those are not shown.</div>
      )}
      {!setupInfo.google_results && (
        <div className="text-13 text-amber-800 bg-amber-50 border border-amber-200 rounded px-4 py-3">
          Competitor research uses the Google Places API. Add <code className="">GOOGLE_PLACES_API_KEY</code> to the SEO backend's <code className="">.env</code> and restart it.
        </div>
      )}
      <Field label={`Keywords (${keywords.length}/${MAX_KEYWORDS})`} hint="The searches your customers type. Put the area in, as customers do.">
        <div className="flex flex-wrap gap-1.5 mb-2">
          {keywords.map(k => (
            <span key={k} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200 text-12.5">
              {k}<button type="button" onClick={() => setKeywords(ks => ks.filter(x => x !== k))} className="p-0.5 rounded-full hover:bg-indigo-100 cursor-pointer" aria-label={`Remove ${k}`}><X size={12} /></button>
            </span>
          ))}
          {!keywords.length && <span className="text-12.5 text-slate-500">Add at least one keyword.</span>}
        </div>
        <div className="flex gap-2">
          <input className={inputCls} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            placeholder={`e.g. ${b.primaryCategory ? `${b.primaryCategory.toLowerCase()} in ${b.area || b.city || 'your area'}` : 'dentist in Baner'}`} disabled={keywords.length >= MAX_KEYWORDS} />
          <Button icon={Plus} onClick={add} disabled={!draft.trim() || keywords.length >= MAX_KEYWORDS}>Add</Button>
        </div>
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
        <Field label="Search from" hint="Competitors are found for this place: search any place or click the map"><PlacePicker b={b} value={location} onChange={(v) => setLocation(v)} width={300} canSave={false} places={[{ name: defaults.location || [b.area, b.city].filter(Boolean).join(', ') || 'Project area', kind: 'project area' }, ...(b.target_areas || []).map(n => ({ name: n, kind: 'area' }))]} /></Field>
        <Button variant="primary" icon={Play} busy={busy} disabled={!keywords.length || !setupInfo.google_results} onClick={() => onStart(keywords, location)}>{hasRun ? 'Run research again' : 'Research competitors'}</Button>
      </div>
      <p className="text-11.5 text-slate-500">About a minute. Makes {keywords.length} Google Places request{keywords.length === 1 ? '' : 's'}. Competitors found on Google Maps are also registered for site audits.</p>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}

function Tile({ label, value, sub, tone = 'text-slate-900' }) {
  return (
    <div className="ai-glass-card rounded px-4 py-3 min-w-0">
      <div className="text-11 font-semibold  tracking-wide text-slate-500 truncate">{label}</div>
      <div className={`text-22 font-bold tabular-nums leading-tight ${tone}`}>{value}</div>
      <div className="text-11.5 text-slate-500 truncate" title={sub}>{sub}</div>
    </div>
  );
}

/* ── Tabs ─────────────────────────────────────────────────────────────── */

function Overview({ r, goto }) {
  const s = r.summary;
  const business = r.organic_competitors.filter(d => d.type === 'business').slice(0, 6);
  const bars = [{ label: `${r.business.name} (you)`, value: s.visibility, mine: true, sub: `${s.keywords_ranked} of ${s.keywords_total} keywords shown on Google (Search Console)` },
  ...business.map(d => ({ label: d.domain, value: d.visibility, sub: `${d.keywords_top10} keywords on page 1` }))].sort((a, b) => b.value - a.value);
  const maps = [{ label: `${r.business.name} (you)`, value: s.local_visibility, mine: true }, ...r.local_competitors.slice(0, 5).map(e => ({ label: e.name, value: e.visibility }))].sort((a, b) => b.value - a.value);
  const link = (to, text) => <button type="button" onClick={() => goto(to)} className="text-12.5 font-semibold text-indigo-700 hover:underline cursor-pointer whitespace-nowrap">{text}</button>;
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="On Google" subtitle="Share of clicks you could expect for these keywords" action={link('competitors', 'All competitors →')}><VisibilityBars rows={bars} /></Card>
        <Card title="On Google Maps" subtitle="Who Maps shows first" action={link('maps', 'Details →')}><VisibilityBars rows={maps} /></Card>
      </div>
      <Card title="What to do first" subtitle="The biggest gaps to close" action={link('plan', 'Full plan →')}>
        {r.actions.length ? (
          <ol className="grid gap-x-8 gap-y-4 md:grid-cols-2">
            {r.actions.slice(0, 4).map((a, i) => (
              <li key={i} className="flex gap-3 text-13">
                <span className="w-6 h-6 rounded-full bg-indigo-50 text-indigo-700 text-12 font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                <span className="min-w-0"><span className="block font-semibold text-slate-900">{a.title}</span><span className="block text-12.5 text-slate-500 line-clamp-3">{a.why}</span></span>
              </li>
            ))}
          </ol>
        ) : <p className="text-13 text-slate-500">No gaps found for these keywords.</p>}
      </Card>
    </div>
  );
}

/** Register a competitor by its website and audit it straight away. */
function AddCompetitorForm({ onAdd, busy, error }) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (await onAdd(url.trim(), name.trim())) { setUrl(''); setName(''); }
  };
  return (
    <form onSubmit={submit} className="px-5 py-3 border-b border-slate-200 bg-slate-50/60">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-12.5 font-semibold text-slate-700 inline-flex items-center gap-1.5 mr-1"><Plus size={13} className="text-indigo-500" />Add a competitor</span>
        <input className={`${inputCls} flex-1 min-w-[200px]`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Website or domain, e.g. competitor.com" aria-label="Competitor website or domain" />
        <input className={`${inputCls} w-full sm:w-52`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" aria-label="Competitor name" />
        <Button type="submit" variant="primary" icon={Gauge} busy={busy} disabled={url.trim().length < 3}>Add & audit</Button>
      </div>
      {error && <div className="mt-2"><ErrorNote>{error}</ErrorNote></div>}
    </form>
  );
}

export function CompetitorsTable({ rows, r, onDetail, onKeywords, onGap, onFindMaps, findBusy, onAddManual, addBusy, addError, onChoose, placeName }) {
  const isChosen = (c) => Boolean(c.reg) && c.reg.selected !== false;
  const chosenCount = rows.filter(isChosen).length;
  const [view, setView] = useState('all'); // all | chosen | others
  const [scope, setScope] = useState('near'); // near: only the businesses around the place searched | all: also the ones found further away or only online
  const [open, setOpen] = useState(() => new Set());
  const radius = r.radius_m || 5000;
  const isNear = (c) => isChosen(c) || (c.maps ? (c.maps.distance_m == null || c.maps.distance_m <= radius) : false);
  const [adding, setAdding] = useState(false);
  const near = rows.filter(isNear);
  const pool = scope === 'near' ? near : rows;
  const ordered = [...pool].sort((x, y) => Number(isChosen(y)) - Number(isChosen(x))); // chosen competitors on top (the order inside each group is kept)
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = (view === 'chosen' ? ordered.filter(isChosen) : view === 'others' ? ordered.filter(c => !isChosen(c)) : ordered).filter(c => !needle || `${c.name} ${c.host}`.toLowerCase().includes(needle));
  const compVal = (c, k) => (k === 'choose' ? Number(isChosen(c)) : k === 'name' ? c.name : k === 'dist' ? (c.maps?.distance_m ?? null) : k === 'match' ? c.maps?.relevance?.score : k === 'vis' ? (c.profile ? c.profile.visibility : c.maps?.visibility) : k === 'p1' ? (c.profile ? Object.keys(c.profile.positions).length : c.maps?.appearances) : k === 'best' ? (c.profile?.local ? c.profile.local.best : c.maps?.best) : k === 'audit' ? (!c.reg ? 'Not audited' : (AUDIT_LABEL[auditMap[c.reg.id]?.status] || auditMap[c.reg.id]?.status || 'Not audited')) : undefined);
  const { sorted, sort, onSort } = useSorted(shown, compVal);
  const pager = usePager(sorted, { size: 25, resetKey: `${view}|${needle}|${sort?.key}|${sort?.dir}` });
  return (
    <Card pad={false}>
      <div className="px-4 py-2 border-b border-slate-200 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="text-13 font-semibold text-slate-900 whitespace-nowrap">{pool.length} {scope === 'near' ? 'near ' + (placeName || 'this place') : 'found'} <span className="font-normal text-slate-500">· {chosenCount} chosen</span></div>
        <div className="flex gap-0.5 p-0.5 bg-slate-100 rounded-lg" role="tablist" aria-label="Where">
          {[['near', `Within ${radius >= 1000 ? `${Math.round(radius / 100) / 10} km` : `${radius} m`} (${near.length})`], ['all', `Everywhere (${rows.length})`]].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={scope === id} onClick={() => setScope(id)} className={`h-7 px-2.5 text-11.5 font-semibold rounded-md cursor-pointer ${scope === id ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:text-slate-900'}`}>{label}</button>
          ))}
        </div>
        <div className="flex gap-0.5 p-0.5 bg-slate-100 rounded-lg" role="tablist" aria-label="Show">
          {[['all', `All ${pool.length}`], ['chosen', `Chosen ${chosenCount}`], ['others', `Not chosen ${pool.length - chosenCount}`]].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)} className={`h-7 px-2.5 text-11.5 font-semibold rounded-md cursor-pointer ${view === id ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800'}`}>{label}</button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-2 gap-y-1.5">
          <Button size="sm" variant="secondary" icon={MapPin} busy={findBusy} onClick={onFindMaps} title="Find more competitors on Google Maps">Find more</Button>
          <Button size="sm" variant="secondary" icon={Plus} onClick={() => setAdding(v => !v)} aria-expanded={adding} title="Add a competitor by its website">{adding ? 'Hide form' : 'Add'}</Button>
        </div>
      </div>
      {adding && <AddCompetitorForm onAdd={onAddManual} busy={addBusy} error={addError} />}
      <Table pager={pager} exportCsv={() => downloadCsv(`competitors-${slugOf(r.business?.name)}`, ['Chosen', 'Competitor', 'Website', 'Match score', 'Match', 'Google visibility (%)', 'Keywords on page 1 or Maps result lists', 'Best Maps position', 'Rating', 'Reviews', 'Site audit'],
        sorted.map(c => { const loc = c.profile?.local || c.maps; return [isChosen(c) ? 'yes' : 'no', c.name, c.website || c.host || '', c.maps?.relevance?.score ?? '', c.maps?.relevance?.label_text || '', c.profile ? c.profile.visibility : (c.maps?.visibility ?? ''), c.profile ? Object.keys(c.profile.positions).length : (c.maps?.appearances ?? ''), loc?.best ?? '', loc?.rating ?? c.reg?.rating ?? '', loc?.reviews ?? c.reg?.reviews ?? '', !c.reg ? 'Not audited' : a ? `${AUDIT_LABEL[a.status] || a.status}${a.listing && a.score != null ? ` (${a.score}/100)` : ''}` : 'Not audited']; }))} bar={rows.length > 10 ? <SearchBar q={q} setQ={setQ} placeholder="Search competitors" /> : null} head={<>
        <Th id="choose" sort={sort} onSort={onSort} first="desc" c="text-center"><Head what="Tick the competitors that really compete with you (3 to 5)." why="Only the chosen ones are watched and used by Competitor Watch, the keyword workspace and the backlink gap.">Choose</Head></Th>
        <Th id="name" sort={sort} onSort={onSort}><Head what="A business that ranks for your keywords on Google Maps or Google." why="Click the name for its full profile." from="Google Maps (Places) results and the competitors you added.">Competitor</Head></Th>
        <Th id="match" sort={sort} onSort={onSort} first="desc"><Head what="How well it matches your business on similar services, area, keywords, Google presence, intent and authority." from="the competitor research (Google Maps data and AI).">Match</Head></Th>
        <Th id="dist" sort={sort} onSort={onSort} c="text-right"><Head right what="How far its Google Maps pin is from the place you are searching." from="Google Maps (Places).">Distance</Head></Th>
        <Th id="vis" sort={sort} onSort={onSort} first="desc" c="text-right"><Head right what="The share of Google clicks it could expect for your keywords, based on where it ranks." from="the competitor research (Google results). Your own figure comes from Search Console.">Google visibility</Head></Th>
        <Th id="p1" sort={sort} onSort={onSort} first="desc" c="text-right"><Head right what="How many of your researched keywords it shows on page 1 of Google for." from="the competitor research.">Page-1 keywords</Head></Th>
        <Th id="best" sort={sort} onSort={onSort} c="text-center"><Head what="Its best position in the Google Maps results and its rating." from="Google Maps (Places).">Maps</Head></Th>
<Th c="text-right"><Head right what="Open the keywords this competitor ranks for, and where you stand against it." from="the competitor keywords and the keyword gap.">Keywords</Head></Th></>}>
        {pager.rows.map(c => {
          return (
            <React.Fragment key={c.host}><tr className={isChosen(c) ? 'bg-emerald-50/40 hover:bg-emerald-50/70' : 'hover:bg-slate-50'}>
              <td className="px-3 py-2.5 text-center"><input type="checkbox" aria-label={`Choose ${c.name}`} checked={isChosen(c)} onChange={() => onChoose({ ...(c.reg || {}), id: c.reg?.id, name: c.name, website: c.website, maps: c.maps }, !isChosen(c))} className="w-4 h-4 cursor-pointer accent-indigo-600" /></td>
              <td className="px-3 py-2.5 min-w-[200px]">
                <button type="button" onClick={() => onDetail(c)} className="text-left cursor-pointer group max-w-[280px]">
                  <span className="block font-semibold text-slate-900 group-hover:text-indigo-700 truncate">{c.name}</span>
                  <span className="block text-12 text-slate-500 truncate">{c.host}</span>
                </button>
              </td>
              <td className="px-3 py-2.5">{c.maps?.relevance ? <button type="button" aria-expanded={open.has(c.host)} onClick={() => setOpen(s => { const n = new Set(s); n.has(c.host) ? n.delete(c.host) : n.add(c.host); return n; })} title="Show how the match is made" className="text-left cursor-pointer"><MatchCell rel={c.maps.relevance} /></button> : <span className="text-slate-400 text-12" title="Added by hand, or found before the match rating existed">—</span>}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{c.maps?.distance_m == null ? <span className="text-slate-300">—</span> : c.maps.distance_m < 1000 ? `${c.maps.distance_m} m` : `${(c.maps.distance_m / 1000).toFixed(1)} km`}</td>
              <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{c.profile ? `${c.profile.visibility}%` : c.maps ? `${c.maps.visibility}%` : '—'}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{c.profile ? `${Object.keys(c.profile.positions).length}/${r.keywords.length}` : c.maps ? `${c.maps.appearances}/${r.keywords.length} Maps` : '—'}</td>
              <td className="px-3 py-2.5 text-center">{c.profile?.local ? <span className="inline-flex items-center gap-1.5"><Pos value={c.profile.local.best} maps /><Stars rating={c.profile.local.rating} /></span> : c.maps ? <span className="inline-flex items-center gap-1.5"><Pos value={c.maps.best} maps /><Stars rating={c.maps.rating} /></span> : (c.reg?.rating ? <Stars rating={c.reg.rating} reviews={c.reg.reviews} /> : <span className="text-slate-400">—</span>)}</td>
              <td className="px-3 py-2.5 text-right whitespace-nowrap">
                <div className="inline-flex gap-1.5">
                  <Button size="sm" onClick={() => onKeywords(c)} title="Its keywords and where it ranks">Keywords</Button>
                  <Button size="sm" variant="ghost" onClick={() => onGap(c)} title="The keyword gap between you and it">Gap</Button>
                </div>
              </td>
            </tr>
            {open.has(c.host) && c.maps?.relevance && <tr className="bg-slate-50/80"><td /><td colSpan={8} className="px-4 py-3"><div className="text-12.5 text-slate-700 mb-2"><b>{c.maps.relevance.label_text}</b> · score {c.maps.relevance.score}{c.maps.relevance.reason ? ` · ${c.maps.relevance.reason}` : ''}</div><FactorBars rel={c.maps.relevance} /></td></tr>}
            </React.Fragment>
          );
        })}
        {!shown.length && <tr><td colSpan={9} className="px-5 py-10 text-center text-13 text-slate-500">{rows.length ? (view === 'chosen' ? 'None chosen yet: tick the competitors that really compete with you.' : 'Nothing here.') : 'No competitors yet.'}</td></tr>}
      </Table>
    </Card>
  );
}

function KeywordsTab({ r, onKeyword, onIdeas }) {
  return (
    <div className="space-y-2">
      <p className="text-12.5 text-slate-500">Your {r.keywords.length} researched keywords: where you and the main competitors rank on Google. Click a keyword for the full Google and Maps results.</p>
      <RankingsTable r={r} onKeyword={onKeyword} onIdeas={onIdeas} />
      <div className="flex flex-wrap gap-3 text-11.5 text-slate-500"><span className="inline-flex items-center gap-1.5"><Pos value={1} /> top 3</span><span className="inline-flex items-center gap-1.5"><Pos value={7} /> page 1</span><span className="inline-flex items-center gap-1.5"><Pos /> not in the results</span></div>
    </div>
  );
}

const CRITERIA = [
  ['services', 'Product relevance', 'Very high', 'Do they sell what you sell (a clothes rental is not a clothes shop)'],
  ['area', 'Location relevance', 'Very high', 'The same customers: how near they are to the place searched'],
  ['keywords', 'Keyword overlap', 'High', 'The share of your searches they show up for'],
  ['serp', 'SERP overlap', 'High', 'How high they rank on the same results pages (Google Maps)'],
  ['category', 'Category relevance', 'High', 'Their Google category against your categories'],
  ['intent', 'Search intent match', 'High', 'Would a customer be happy with either (rent versus buy)'],
  ['page', 'Top-page relevance', 'Medium', 'What their home page says against your services and searches'],
  ['opportunity', 'Missing keyword opportunity', 'Medium', 'Searches they rank for that you do not (needs their keywords read)'],
  ['traffic', 'Organic traffic strength', 'Medium', 'Estimated organic visits from their keywords, else the strength of their site']
];
const MATCH_TONE = { direct: 'green', related: 'amber', unrelated: 'gray' };

function HowChosen({ r }) {
  const [open, setOpen] = useState(false);
  const rel = r.relevance;
  if (!rel) return null;
  const n = rel.counts || {};
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5">
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} className="w-full flex flex-wrap items-center gap-x-3 text-left cursor-pointer">
        <span className="text-12.5 font-semibold text-slate-900">How these were chosen</span>
        <span className="text-12 text-slate-500">{n.direct || 0} direct · {n.related || 0} related · {rel.other || 0} left out{rel.ai ? ' · judged by AI' : ''}{rel.rental ? ' · rental business: shops that only sell are left out' : ''}</span>
        <span className="ml-auto text-12 font-semibold text-indigo-700">{open ? 'Hide' : 'Details'}</span>
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 pb-1">
          {CRITERIA.map(([k, label, level, hint]) => (
            <div key={k} className="rounded bg-slate-50 px-3 py-2"><div className="flex items-center justify-between gap-2"><span className="text-13 font-semibold text-slate-900">{label}</span><span className="text-11 font-semibold text-indigo-700">{level}</span></div><div className="text-12 text-slate-500 mt-0.5">{hint}{k === 'authority' ? ' (read when already known)' : ''}</div></div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The nine factors of a match, each as a bar; a factor that could not be measured says so. */
function FactorBars({ rel }) {
  const f = rel?.factors || {};
  return (
    <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3">
      {CRITERIA.map(([k, label, level, hint]) => (
        <div key={k} title={hint}>
          <div className="flex items-center justify-between text-12"><span className="text-slate-700">{label}</span><span className="tabular-nums font-semibold text-slate-900">{f[k] != null ? f[k] : <span className="font-normal text-slate-400">not measured</span>}</span></div>
          <div className="mt-0.5 h-1.5 rounded-full bg-slate-200 overflow-hidden"><span className={`block h-full rounded-full ${f[k] == null ? '' : f[k] >= 65 ? 'bg-emerald-500' : f[k] >= 40 ? 'bg-amber-400' : 'bg-slate-400'}`} style={{ width: `${f[k] ?? 0}%` }} /></div>
        </div>
      ))}
      {rel?.traffic_from && <div className="sm:col-span-2 xl:col-span-3 text-11.5 text-slate-500">Organic traffic strength is from {rel.traffic_from === 'keywords' ? "this competitor's kept keyword read" : "the strength of its website (read its keywords for a better figure)"}.</div>}
    </div>
  );
}

function MatchCell({ rel }) {
  if (!rel) return <span className="text-slate-400">—</span>;
  const tip = Object.entries(rel.factors || {}).map(([k, v]) => `${(CRITERIA.find(c => c[0] === k) || [k, k])[1]}: ${v}`).join('\n');
  return (
    <div title={tip} className="min-w-[110px]">
      <div className="flex items-center gap-2"><span className="font-semibold tabular-nums">{rel.score}</span><Badge tone={MATCH_TONE[rel.label] || 'gray'}>{rel.label_text}</Badge></div>
      <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden"><span className={`block h-full rounded-full ${rel.label === 'direct' ? 'bg-emerald-500' : rel.label === 'related' ? 'bg-amber-400' : 'bg-slate-300'}`} style={{ width: `${rel.score}%` }} /></div>
    </div>
  );
}

function OtherPlaces({ r }) {
  const [open, setOpen] = React.useState(false);
  const list = r.other_places || [];
  if (!list.length) return null;
  return (
    <Card pad={false}>
      <button type="button" onClick={() => setOpen(v => !v)} className="w-full px-4 py-3 flex items-center justify-between text-left cursor-pointer">
        <span className="text-13.5 font-semibold text-slate-900">{list.length} other business{list.length === 1 ? '' : 'es'} on Google Maps, left out as not real competitors</span>
        <span className="text-12.5 font-semibold text-indigo-700">{open ? 'Hide' : 'Show why'}</span>
      </button>
      {open && (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {list.map(e => (
            <li key={e.name} className="px-4 py-2.5 flex items-start gap-3">
              <div className="flex-1 min-w-0"><div className="text-13 font-medium text-slate-800">{e.name}</div><div className="text-12 text-slate-500">{e.relevance?.kind ? `${e.relevance.kind} · ` : ''}{e.relevance?.reason}</div></div>
              <MatchCell rel={e.relevance} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const SCORE_WORD = { queued: 'Queued…', running: 'Auditing…', done: 'Audited', failed: 'Failed' };

const DOT = { ok: ['bg-emerald-500', 'Good'], warn: ['bg-amber-400', 'Could be better'], bad: ['bg-red-500', 'Missing or weak'] };

/** The Google-listing comparison, inside the same Compare window as a website comparison: the listing checks, then the services and keywords you share and the ones you do not. */
export function ListingComparison({ c, bid }) {
  const [pick, setPick] = useState([]);
  const [added, setAdded] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const toggle = (k) => setPick(p => (p.includes(k) ? p.filter(x => x !== k) : [...p, k]));
  const gaps = c.keywords.only_them.filter(k => !added.includes(k));
  const save = async () => {
    if (!pick.length || !bid) return;
    setSaving(true); setSaveError('');
    try {
      const res = await api(`/businesses/${bid}/keywords`, { method: 'POST', body: pick.map(k => ({ keyword: k, source: { kind: 'competitor_compare', label: `${c.competitor.name} Google listing`, side: 'competitor', from: c.competitor.name, pages: [], searches: null, at: new Date().toISOString().slice(0, 10) } })) });
      setAdded(a => [...a, ...pick]); setPick([]);
      if (res?.existing?.length) setSaveError(`${res.existing.length} of them were already in My keywords, so they were not saved twice${res.updated ? `; ${res.updated} got this competitor as a new source` : ''}.`);
    } catch (e) { setSaveError(e.message || 'The keywords could not be added.'); } finally { setSaving(false); }
  };
  const Chips = ({ items, tone, empty }) => (items && items.length ? <div className="flex flex-wrap gap-1.5">{items.map(x => <span key={x} className={`px-2.5 py-1 rounded-full text-12.5 border ${tone === 'rose' ? 'bg-rose-50 text-rose-800 border-rose-200' : tone === 'green' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-slate-50 text-slate-700 border-slate-200'}`}>{x}</span>)}</div> : <p className="text-13 text-slate-500">{empty}</p>);
  const dot = (row) => { const [col, word] = DOT[row?.status] || ['bg-slate-200', '']; return row ? <span className="inline-flex items-start gap-2 text-left"><span className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${col}`} title={word} /><span className="text-12.5 text-slate-700">{row.detail}</span></span> : <span className="text-slate-400">—</span>; };
  return (
    <div className="space-y-5">
      <div className="rounded-lg bg-slate-50 px-4 py-3">
        <div className="text-12 font-semibold uppercase tracking-wide text-slate-500">Read from its Google Maps listing (it has no website)</div>
        <p className="mt-1 text-13.5 text-slate-800"><b>{c.competitor.name}</b>{c.competitor.kind ? <> is a <b>{c.competitor.kind}</b>.</> : '.'} {c.competitor.summary}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 max-w-md">
        <div className="rounded-lg ring-1 ring-emerald-200 bg-emerald-50 px-4 py-3 text-center"><div className="text-11.5 text-emerald-800">Your listing</div><div className="text-24 font-bold text-emerald-700 tabular-nums">{c.scores.ours ?? '—'}</div></div>
        <div className="rounded-lg ring-1 ring-slate-200 px-4 py-3 text-center"><div className="text-11.5 text-slate-500">{c.competitor.name}</div><div className="text-24 font-bold text-slate-800 tabular-nums">{c.scores.theirs ?? '—'}</div></div>
      </div>
      <div className="flex flex-wrap gap-2">
        {csvBtn(() => downloadCsv(`google-listing-comparison-${slugOf(c.competitor.name)}`, ['Google listing check', 'You: result', 'You: detail', `${c.competitor.name}: result`, `${c.competitor.name}: detail`], c.checks.map(x => [x.label, x.ours?.status || '', x.ours?.detail || '', x.theirs?.status || '', x.theirs?.detail || ''])), 'Checks CSV')}
        {csvBtn(() => downloadFile(`google-listing-comparison-${slugOf(c.competitor.name)}-${today()}.md`, [`# Google listing comparison: ${c.competitor.name}`, '', c.competitor.summary || '', '', `Listing score: you ${c.scores.ours ?? 'n/a'}, ${c.competitor.name} ${c.scores.theirs ?? 'n/a'}`, '', '## Services', '', `Both offer: ${c.services.shared.join(', ') || 'none'}`, `Only they offer: ${c.services.only_them.join(', ') || 'none'}`, `Only you offer: ${c.services.only_us.join(', ') || 'none'}`, '', '## Keywords', '', `Both target: ${c.keywords.shared.join(', ') || 'none'}`, `Only they target (gap): ${c.keywords.only_them.join(', ') || 'none'}`, `Only you target: ${c.keywords.only_us.join(', ') || 'none'}`, '', '## Listing checks', '', ...c.checks.map(x => `- ${x.label}: you ${x.ours?.detail || 'n/a'}; ${c.competitor.name} ${x.theirs?.detail || 'n/a'}`), ''].join('\n'), 'text/markdown'), 'Download comparison')}
      </div>
      {!c.you.listing_read && <p className="text-12 text-amber-800 bg-amber-50 rounded px-3 py-1.5">Your own Google listing could not be read (no Google place is linked to this project), so only the services and keywords are compared.</p>}
      <div>
        <div className="text-13 font-semibold text-slate-900 mb-1.5">Services</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><div className="text-11.5 font-semibold text-emerald-700 mb-1">Both offer</div><Chips items={c.services.shared} tone="green" empty="None in common." /></div>
          <div><div className="text-11.5 font-semibold text-rose-700 mb-1">Only they offer (you could add)</div><Chips items={c.services.only_them} tone="rose" empty="Nothing they offer that you do not." /></div>
          <div><div className="text-11.5 font-semibold text-slate-600 mb-1">Only you offer</div><Chips items={c.services.only_us} empty="Nothing only you offer." /></div>
        </div>
      </div>
      <div>
        <div className="text-13 font-semibold text-slate-900 mb-1.5">Keywords</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><div className="text-11.5 font-semibold text-emerald-700 mb-1">Both target</div><Chips items={c.keywords.shared} tone="green" empty="None in common." /></div>
          <div>
            <div className="text-11.5 font-semibold text-rose-700 mb-1">Only they target (a gap for you)</div>
            {c.keywords.only_them.length === 0 ? <p className="text-13 text-slate-500">No gap found.</p> : (
              <div className="flex flex-wrap gap-1.5">
                {c.keywords.only_them.map(k => {
                  const done = added.includes(k), on = pick.includes(k);
                  return <button key={k} type="button" disabled={done} onClick={() => toggle(k)} aria-pressed={on} className={`px-2.5 py-1 rounded-full text-12.5 border inline-flex items-center gap-1.5 ${done ? 'bg-emerald-50 text-emerald-800 border-emerald-200 cursor-default' : on ? 'bg-indigo-600 text-white border-indigo-600 cursor-pointer' : 'bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100 cursor-pointer'}`}>{done ? <CheckCircle2 size={12} /> : <input type="checkbox" readOnly checked={on} tabIndex={-1} className="pointer-events-none" />}{k}</button>;
                })}
              </div>
            )}
            {c.keywords.only_them.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="primary" icon={Plus} busy={saving} disabled={!pick.length} onClick={save}>Add {pick.length ? pick.length : ''} to my keywords</Button>
                {gaps.length > 0 && <Button size="sm" onClick={() => setPick(pick.length === gaps.length ? [] : gaps)}>{pick.length === gaps.length ? 'Clear' : `Select all ${gaps.length}`}</Button>}
                {added.length > 0 && <span className="text-12 text-emerald-700">{added.length} added to My keywords</span>}
              </div>
            )}
            {saveError && <p className="mt-1.5 text-12 text-red-600" role="alert">{saveError}</p>}
          </div>
          <div><div className="text-11.5 font-semibold text-slate-600 mb-1">Only you target</div><Chips items={c.keywords.only_us} empty="Nothing only you target." /></div>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-13 min-w-[520px]">
          <thead className="bg-slate-50 text-11.5 text-slate-500"><tr><th className="px-3 py-2 text-left font-semibold">Google listing</th><th className="px-3 py-2 text-left font-semibold text-emerald-700">You</th><th className="px-3 py-2 text-left font-semibold">{c.competitor.name}</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{c.checks.map(r => <tr key={r.key}><td className="px-3 py-2 font-medium text-slate-900 align-top">{r.label}</td><td className="px-3 py-2 align-top">{dot(r.ours)}</td><td className="px-3 py-2 align-top">{dot(r.theirs)}</td></tr>)}</tbody>
        </table>
        <p className="px-3 py-2 text-11.5 text-slate-500 border-t border-slate-100">Maps shows at most 10 photos and 5 reviews, and no posts, services list or owner replies.</p>
      </div>
    </div>
  );
}

/** Audit your site and every Maps competitor in one go, then see them side by side: the scores of each audited site against yours. */
export function MapsAudit({ r, kit }) {
  const sites = r.local_competitors; // every one: a site audit when it has a website, its Google listing when it has none
  const regOf = (e) => kit.registered.find(c => (e.website ? hostOf(c.website) === (e.domain || hostOf(e.website)) : (c.place_id && c.place_id === e.cid) || (!c.website && c.name === e.name)));
  const regs = sites.map(regOf).filter(Boolean);
  const done = regs.filter(c => kit.auditMap[c.id]?.status === 'done');
  const busy = regs.filter(c => running(kit.auditMap[c.id]?.status)).length + (running(kit.ourAudit?.status) ? 1 : 0);
  const sc = kit.scorecard;
  const noSite = r.local_competitors.filter(e => !e.website).length;
  const rowsByKey = {};
  for (const cmp of sc?.items || []) for (const m of cmp.overall?.scores || []) {
    rowsByKey[m.key] = rowsByKey[m.key] || { key: m.key, label: m.label, ours: m.ours, theirs: [] };
    rowsByKey[m.key].theirs.push({ name: cmp.competitor?.name || cmp.competitor?.target, value: m.competitor });
  }
  const metrics = Object.values(rowsByKey);
  return (
    <section className="ai-glass-card rounded px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1"><span className="text-13.5 font-semibold text-slate-900">Audit and compare</span> <span className="text-12 text-slate-500">· {`${sites.length} Maps competitor${sites.length === 1 ? '' : 's'} · ${done.length} audited${busy ? ` · ${busy} running now` : ''}`}</span></div>
        <div className="flex flex-wrap gap-2">
<Button size="sm" variant="primary" icon={Gauge} busy={busy > 0} disabled={!sites.length || busy > 0} onClick={kit.onAuditAll} title="Audits each competitor (its website, or its Google listing when it has none) and your own website">Audit your site and all {sites.length}</Button>
        <Button size="sm" icon={ShieldCheck} busy={sc?.loading} disabled={!done.length || kit.ourAudit?.status !== 'done' || busy > 0} onClick={kit.onScorecard} title="Compares the website audits with yours. A competitor with no website is compared on its own row">Compare all side by side</Button>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5 text-11.5">
        <span className={`px-2 py-0.5 rounded-full ${kit.ourAudit?.status === 'done' ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{kit.ourAudit?.status === 'done' ? 'Your site is audited' : kit.hasSite ? 'Your site is audited with the first audit' : 'Add your website to compare site audits'}</span>
        {noSite > 0 && <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-800">{noSite} without a website: read from Google Maps</span>}
      </div>
      {sc?.error && <p className="mt-2 text-13 text-red-600" role="alert">{sc.error}</p>}
      {metrics.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
          <div className="px-3 py-2 border-b border-slate-100 flex justify-end">{csvBtn(() => downloadCsv(`competitor-site-scores-${slugOf(r.business?.name)}`, ['Score (0-100)', 'You', ...sc.items.map(i => i.competitor?.name || i.competitor?.target)], metrics.map(m => [m.label, m.ours ?? '', ...m.theirs.map(x => x.value ?? '')])))}</div>
          <table className="w-full text-13 min-w-[560px]">
            <thead className="bg-slate-50 text-11.5 text-slate-500"><tr><th className="px-3 py-2 text-left font-semibold">Score (0-100)</th><th className="px-3 py-2 text-center font-semibold text-emerald-700">You</th>{sc.items.map(i => <th key={i.competitor?.audit_id} className="px-3 py-2 text-center font-semibold max-w-[140px] truncate" title={i.competitor?.name}>{i.competitor?.name || i.competitor?.target}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {metrics.map(m => {
                const best = Math.max(m.ours ?? -1, ...m.theirs.map(x => x.value ?? -1));
                const cell = (v, you) => <td key={`${m.key}-${you ? 'you' : v?.name}`} className={`px-3 py-2 text-center tabular-nums ${(you ? m.ours : v.value) === best && best >= 0 ? 'font-bold text-emerald-700 bg-emerald-50/60' : 'text-slate-700'}`}>{(you ? m.ours : v.value) ?? '—'}</td>;
                return <tr key={m.key}><td className="px-3 py-2 font-medium text-slate-900">{m.label}</td>{cell(null, true)}{m.theirs.map(x => cell(x, false))}</tr>;
              })}
            </tbody>
          </table>
          <p className="px-3 py-2 text-11.5 text-slate-500 border-t border-slate-100">The best score in each row is highlighted. Press Compare on a single competitor below for the full side by side: speed measures, matched pages and keyword gaps.</p>
        </div>
      )}
    </section>
  );
}

export function MapsTab({ r, kit }) {
  const maxReviews = Math.max(1, ...r.local_competitors.map(e => e.reviews || 0), r.business.reviews || 0);
  const you = { name: `${r.business.name} (you)`, rating: r.business.rating, reviews: r.business.reviews || 0, appearances: r.summary.local_ranked, best: Math.min(...Object.values(r.you.local), Infinity), visibility: r.summary.local_visibility, mine: true };
  const rows = [you, ...r.local_competitors].sort((a, b) => (a.mine ? -1 : b.mine ? 1 : (b.relevance?.score ?? 0) - (a.relevance?.score ?? 0) || b.visibility - a.visibility));
  const nearOnly = r.local_competitors.some(e => e.distance_m != null);
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shownRows = rows.filter(e => !needle || e.mine || `${e.name} ${e.category || ''}`.toLowerCase().includes(needle));
  const mapVal = (e, k) => (k === 'name' ? e.name : k === 'match' ? (e.mine ? null : e.relevance?.score) : k === 'dist' ? e.distance_m : k === 'vis' ? e.visibility : k === 'best' ? (Number.isFinite(e.best) ? e.best : null) : k === 'res' ? e.appearances : k === 'rating' ? e.rating : k === 'rev' ? e.reviews : k === 'site' ? (e.domain || e.website) : k === 'audit' ? (e.mine || !kit ? null : (() => { const reg = kit.registered.find(c => (e.website ? hostOf(c.website) === (e.domain || hostOf(e.website)) : (c.place_id && c.place_id === e.cid) || (!c.website && c.name === e.name))); const a = reg && kit.auditMap[reg.id]; return a ? (SCORE_WORD[a.status] || a.status) : 'Not audited'; })()) : undefined);
  const { sorted, sort, onSort } = useSorted(shownRows, mapVal);
  const pager = usePager(sorted, { size: 25, resetKey: `${needle}|${sort?.key}|${sort?.dir}` });
  return (
    <div className="space-y-4">
    <HowChosen r={r} />
    {kit && <MapsAudit r={r} kit={kit} />}
    {r.local_competitors.length === 0 && <Card><p className="text-13 text-slate-600">No real competitor was found on Google Maps for these searches. {r.other_places?.length ? 'The businesses that came up sell something different: see the list below.' : ''}</p></Card>}
    {nearOnly && <p className="text-12.5 text-slate-600">Only businesses within about {Math.round((r.radius_m || 4000) / 100) / 10} km of {r.center?.chosen ? 'the chosen place' : r.business.name} are counted: the ones its customers can actually choose between.</p>}
    <MapsTable r={r} />
    <OtherPlaces r={r} />
    </div>
  );
}

function ListingsTab({ r, setupInfo }) {
  const cols = [{ key: 'you', label: 'You', sources: r.you.link_sources }, ...r.profiles.map(p => ({ key: p.domain, label: p.domain, sources: p.link_sources }))];
  const sites = [...new Set(cols.flatMap(c => c.sources.map(s => baseSite(s.domain))))];
  const count = (site) => cols.slice(1).filter(c => c.sources.some(s => baseSite(s.domain) === site)).length;
  sites.sort((a, b) => count(b) - count(a));
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const siteRows = sites.filter(x => !needle || x.toLowerCase().includes(needle));
  const hasAt = (c, site) => c.sources.some(x => baseSite(x.domain) === site);
  const siteVal = (site, k) => (k === 'site' ? site : k.startsWith('c:') ? Number(hasAt(cols.find(c => c.key === k.slice(2)), site)) : undefined);
  const { sorted, sort, onSort } = useSorted(siteRows, siteVal);
  const pager = usePager(sorted, { size: 25, resetKey: `${needle}|${sort?.key}|${sort?.dir}|${sites.length}` });
  return (
    <Card pad={false}>
      {r.gaps.listings.length > 0 && (
        <div className="px-5 py-3 border-b border-slate-200 flex flex-wrap items-center gap-2 text-12.5">
          <span className="font-semibold text-slate-700 inline-flex items-center gap-1.5"><Link2 size={13} className="text-indigo-500" /> Listings to get:</span>
          {r.gaps.listings.map(g => <span key={g.domain} className="px-2 py-0.5 rounded-full bg-white border border-slate-200"><b className="text-slate-900">{g.domain}</b> <span className="text-slate-500">{g.seen}×</span></span>)}
          <Link to="/off-page-seo" className="ml-auto font-semibold text-indigo-700 hover:underline">Manage citations →</Link>
          <Link to="/backlinks/opportunities" className="font-semibold text-indigo-700 hover:underline ml-3">See who links to these competitors →</Link>
        </div>
      )}
      {sites.length === 0 ? <p className="px-6 py-10 text-center text-13 text-slate-500">No listings or mentions found.</p> : (
        <Table pager={pager} exportCsv={() => downloadCsv(`listings-and-mentions-${slugOf(r.business?.name)}`, ['Site', ...cols.map(c => `${c.label}: page where listed`), 'You are missing'],
          sorted.map(site => { const mineHas = cols[0].sources.some(x => baseSite(x.domain) === site); const listing = cols.some(c => c.sources.some(x => baseSite(x.domain) === site && x.type === 'directory')); return [site, ...cols.map(c => c.sources.find(x => baseSite(x.domain) === site)?.url || ''), !mineHas && (listing || count(site) >= 2) ? 'yes' : 'no']; }))} bar={sites.length > 10 ? <SearchBar q={q} setQ={setQ} placeholder="Search sites" /> : null} head={<><Th id="site" sort={sort} onSort={onSort}>Site</Th>{cols.map(c => <Th key={c.key} id={`c:${c.key}`} sort={sort} onSort={onSort} first="desc" c="text-center" cls={`normal-case max-w-[120px] truncate ${c.key === 'you' ? 'text-emerald-700' : ''}`}>{c.label}</Th>)}</>}>
          {pager.rows.map(site => {
            const mineHas = cols[0].sources.some(s => baseSite(s.domain) === site);
            const listing = cols.some(c => c.sources.some(x => baseSite(x.domain) === site && x.type === 'directory'));
            const missing = !mineHas && (listing || count(site) >= 2);
            return (
              <tr key={site} className={missing ? 'bg-rose-50/40' : ''}>
                <td className="px-4 py-2.5 font-medium text-slate-900">{site}{missing && <span className="ml-2"><Badge tone="red">You're missing</Badge></span>}</td>
                {cols.map(c => {
                  const hit = c.sources.find(s => baseSite(s.domain) === site);
                  return <td key={c.key} className="px-4 py-2.5 text-center">{hit ? <a href={hit.url} target="_blank" rel="noreferrer" title={hit.title} className="inline-flex text-emerald-600 hover:text-emerald-800"><CheckCircle2 size={16} /></a> : <Minus size={16} className="inline text-slate-300" />}</td>;
                })}
              </tr>
            );
          })}
        </Table>
      )}
      <div className="px-5 py-2.5 border-t border-slate-200 text-11.5 text-slate-500">
        Links and listings Google shows for each name, not a full backlink index: Google has no API for backlink totals.
      </div>
    </Card>
  );
}

function PlanTab({ r }) {
  return (
    <Card pad={false}>
      <Table bar={<div className="px-4 py-2 border-b border-slate-100 flex flex-wrap justify-end gap-2">{csvBtn(() => downloadCsv(`competitor-action-plan-${slugOf(r.business?.name)}`, ['Type', 'Action or keyword', 'Priority', 'Why or competitors on page 1', 'Link'],
        [...r.actions.map(a => ['Action', a.title, (PRIORITY[a.priority] || PRIORITY.low)[1], a.why || '', a.to || '']), ...r.gaps.keywords.map(g => ['Keyword gap', g.keyword, '', g.competitors.map(c => `${c.domain} (#${c.position})`).join('; '), ''])]))}{csvBtn(() => downloadFile(`competitor-research-${slugOf(r.business?.name)}-${today()}.md`, researchMd(r), 'text/markdown'), 'Download plan')}</div>} head={<><Th cls="w-10">#</Th><Th>Action</Th><Th>Priority</Th><Th>Why</Th><Th c="text-right"> </Th></>}>
        {r.actions.map((a, i) => {
          const [tone, label] = PRIORITY[a.priority] || PRIORITY.low;
          return (
            <tr key={i} className="hover:bg-slate-50 align-top">
              <td className="px-4 py-2.5 text-slate-500 tabular-nums">{i + 1}</td>
              <td className="px-4 py-2.5 font-semibold text-slate-900 min-w-[200px]">{a.title}</td>
              <td className="px-4 py-2.5"><Badge tone={tone}>{label}</Badge></td>
              <td className="px-4 py-2.5 text-slate-600 min-w-[260px]">{a.why}</td>
              <td className="px-4 py-2.5 text-right whitespace-nowrap">{a.to && <Link to={a.to} className="text-12.5 font-semibold text-indigo-700 hover:underline">Open →</Link>}</td>
            </tr>
          );
        })}
        {r.gaps.keywords.length > 0 && <tr className="bg-slate-50"><td colSpan={5} className="px-4 py-2 text-11.5 font-semibold  tracking-wide text-slate-500"><span className="inline-flex items-center gap-1.5"><ListChecks size={13} /> Keywords where competitors are on page 1 and you are not</span></td></tr>}
        {r.gaps.keywords.map(g => (
          <tr key={g.keyword} className="hover:bg-slate-50">
            <td className="px-4 py-2.5" />
            <td className="px-4 py-2.5 font-semibold text-slate-900">{g.keyword}</td>
            <td className="px-4 py-2.5" colSpan={2}><span className="inline-flex flex-wrap gap-x-3 gap-y-1">{g.competitors.map(c => <span key={c.domain} className="inline-flex items-center gap-1 text-slate-600">{c.domain}<Pos value={c.position} /></span>)}</span></td>
            <td className="px-4 py-2.5 text-right text-12 text-emerald-700">{g.you_local && <span className="inline-flex items-center gap-1"><MapPin size={12} /> #{g.you_local} in Maps</span>}</td>
          </tr>
        ))}
        {!r.actions.length && !r.gaps.keywords.length && <tr><td colSpan={5} className="px-5 py-10 text-center text-13 text-slate-500">No gaps found for these keywords. Try more keywords or another area.</td></tr>}
      </Table>
      <div className="px-5 py-2.5 border-t border-slate-200 text-11.5 text-slate-500 flex items-center gap-1.5"><Sparkles size={12} /> {r.sources.maps_only ? (r.sources.note || "Based on the Google Places API (Maps businesses) and a scan of the top competitors' websites.") : `Based on live Google results (${r.sources.credits} searches) and a scan of the top competitors' websites.`}</div>
    </Card>
  );
}

/** What the research has found so far, filling in while it runs: competitors, Maps businesses and sites appear one by one. */
function LiveResults({ progress }) {
  const f = progress?.found;
  if (!f) return <SkCard title="Live results" subtitle="Keywords searched so far. New competitors appear as they are found." pad={false}><SkTable headers={["Competitor", "Keywords", "Best position"]} rows={4} bare /></SkCard>;
  return (
    <Card title="Live results" subtitle={`${f.keywords.length} keyword${f.keywords.length === 1 ? '' : 's'} searched so far. New competitors appear as they are found.`} pad={false}>
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] divide-y xl:divide-y-0 xl:divide-x divide-slate-200">
        <div className="overflow-auto max-h-64">
          <table className="w-full text-13">
            <thead className="sticky top-0 bg-slate-50 text-left text-11.5  tracking-wide text-slate-500"><tr><Th>Competitor on Google</Th><Th c="text-right">Visibility</Th><Th c="text-right">Page 1</Th><Th c="text-right">Top 3</Th><Th>Site</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {f.competitors.map(d => {
                const site = f.sites?.[d.domain];
                return (
                  <tr key={d.domain} className="animate-in fade-in duration-300">
                    <td className="px-4 py-2 font-medium text-slate-900">{d.domain}{d.type === 'directory' && <span className="ml-2"><Badge tone="violet">Listing</Badge></span>}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold">{d.visibility}%</td>
                    <td className="px-4 py-2 text-right tabular-nums">{d.keywords_top10}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{d.keywords_top3}</td>
                    <td className="px-4 py-2 text-12 text-slate-500">{site ? (site.scanned ? `${site.services?.length || 0} services · ${fmt(site.avg_words)} words` : 'unreadable') : d.type === 'business' ? <Loader2 size={12} className="animate-spin text-slate-400" /> : ''}</td>
                  </tr>
                );
              })}
              {!f.competitors.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-12.5 text-slate-500">None yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="p-4 space-y-4 overflow-auto max-h-64">
          <div>
            <Label icon={MapPin}>On Google Maps</Label>
            <ul className="space-y-1.5">
              {f.maps.slice(0, 6).map(e => <li key={e.name} className="flex items-center gap-2 text-13 animate-in fade-in duration-300"><Pos value={e.best} maps /><span className="flex-1 min-w-0 truncate text-slate-900">{e.name}</span><Stars rating={e.rating} reviews={e.reviews} /></li>)}
              {!f.maps.length && <li className="text-12.5 text-slate-500">None yet.</li>}
            </ul>
          </div>
          <div>
            <Label icon={Search}>Keywords done</Label>
            <div className="flex flex-wrap gap-1.5">{f.keywords.map(k => <span key={k.keyword} className="inline-flex items-center gap-1.5 text-12 bg-slate-50 border border-slate-200 rounded-lg pl-2 pr-1 py-0.5 animate-in fade-in duration-300">{k.keyword}<Pos value={k.you_organic} /></span>)}</div>
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ── Modals ───────────────────────────────────────────────────────────── */

function ProfileModal({ c, r, onClose, onAudit, onCompare, auditMap }) {
  const p = c?.profile;
  const site = p?.site || {};
  const mine = r.you.site;
  const myServices = [...(mine?.services || [])].map(s => s.toLowerCase());
  const hasService = (s) => myServices.some(m => m.includes(s.toLowerCase()) || s.toLowerCase().includes(m));
  const a = auditMap[c?.reg?.id];
  return (
    <Modal open={Boolean(c)} onClose={onClose} width="max-w-5xl" title={c ? <span className="inline-flex items-center gap-2">{c.name}<span className="text-12 font-normal text-slate-500">{c.host}</span></span> : ''}
      footer={c && <>
        {c.website && <a href={c.website} target="_blank" rel="noreferrer" className="mr-auto inline-flex items-center gap-1 text-12.5 font-semibold text-indigo-700 hover:underline"><ExternalLink size={13} /> Visit site</a>}
        {p && <Button icon={Download} onClick={() => downloadFile(`competitor-profile-${slugOf(c.name)}-${today()}.md`, [`# Competitor profile: ${c.name}`, '', c.website || c.host || '', '', `- Google visibility: ${p.visibility}%`, `- Keywords on page 1: ${Object.keys(p.positions).length} of ${r.keywords.length}`, p.local ? `- Google Maps: best position #${p.local.best}, rating ${p.local.rating ?? 'n/a'} (${p.local.reviews ?? 0} reviews)` : '- Google Maps: not in the results', site.scanned ? `- Words per page: ${site.avg_words}` : '- Its site could not be read', '', '## Their strategy', '', ...p.strategy.map(x => `- ${x}`), '', '## Rankings', '', ...r.keywords.map(k => `- ${k}: ${p.positions[k] ? `#${p.positions[k]}` : 'not in the results'}`), '', '## Service pages', '', ...((site.services || []).length ? site.services.map(x => `- ${x}`) : ['- None found.']), '', '## Listed or linked on', '', ...(p.link_sources.length ? p.link_sources.map(x => `- ${baseSite(x.domain)}: ${x.url}`) : ['- None found.']), ''].join('\n'), 'text/markdown')}>Download profile</Button>}
      </>}>
      {c && !p && <p className="text-13 text-slate-600">This business was found on Google Maps but did not appear in the research results, so there is no ranking data yet. Run the research again to include it.</p>}
      {c && p && (
        <div className="max-h-[68vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-5">
            <Tile label="Google visibility" value={`${p.visibility}%`} sub={`${Object.keys(p.positions).length} of ${r.keywords.length} keywords on page 1`} />
            <Tile label="Maps" value={p.local ? `#${p.local.best}` : '—'} sub={p.local ? `${p.local.appearances} result list${p.local.appearances === 1 ? '' : 's'} · ${p.local.rating ?? '—'}★ (${fmt(p.local.reviews)})` : 'Not in Maps results'} />
            <Tile label="Words / page" value={site.scanned ? fmt(site.avg_words) : '—'} sub={mine?.scanned ? `you: ${fmt(mine.avg_words)}` : ''} />
            <Tile label="Blog · Schema" value={site.scanned ? `${site.blog ? 'Yes' : 'No'} · ${(site.schema || []).length}` : '—'} sub={mine?.scanned ? `you: ${mine.blog ? 'yes' : 'no'} · ${(mine.schema || []).length}` : ''} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-5">
              <div>
                <Label icon={Lightbulb}>Their strategy</Label>
                <ul className="space-y-1.5">{p.strategy.map((line, k) => <li key={k} className="flex gap-2 text-13 leading-relaxed text-slate-700"><CheckCircle2 size={14} className="text-indigo-500 mt-0.5 shrink-0" />{line}</li>)}</ul>
                {!site.scanned && <p className="mt-3 text-12.5 text-amber-700 flex items-center gap-1.5"><AlertTriangle size={13} /> Their site could not be read: {site.error || 'it did not load'}.</p>}
              </div>
              <div>
                <Label>Rankings</Label>
                <div className="flex flex-wrap gap-1.5">{r.keywords.map(k => <span key={k} className="inline-flex items-center gap-1.5 text-12 text-slate-700 bg-slate-50 border border-slate-200 rounded-lg pl-2 pr-1 py-0.5">{k}<Pos value={p.positions[k]} /></span>)}</div>
              </div>
            </div>
            <div className="space-y-5">
              {site.services?.length > 0 && (
                <div>
                  <Label icon={Layers}>Service pages {mine?.scanned && <span className="normal-case font-normal">(red = you have no page)</span>}</Label>
                  <div className="flex flex-wrap gap-1.5">{site.services.map(s => <span key={s} className={`px-2 py-0.5 rounded-md text-12 border ${mine?.scanned && !hasService(s) ? 'bg-rose-50 text-rose-800 border-rose-200' : 'bg-slate-50 text-slate-700 border-slate-200'}`}>{s}</span>)}</div>
                </div>
              )}
              {site.location_pages?.length > 0 && <div><Label icon={MapPin}>Area pages</Label><Chips items={site.location_pages} /></div>}
              {p.link_sources.length > 0 && (
                <div>
                  <Label icon={Link2}>Listed / linked on</Label>
                  <div className="flex flex-wrap gap-1.5">{p.link_sources.map(s => <a key={s.domain} href={s.url} target="_blank" rel="noreferrer" className="px-2 py-0.5 rounded-md text-12 border bg-white text-slate-700 border-slate-200 hover:border-indigo-300 hover:text-indigo-700">{baseSite(s.domain)}</a>)}</div>
                </div>
              )}
              {p.backlinks && <p className="text-12.5 text-slate-600">Backlinks: <b>{fmt(p.backlinks.backlinks)}</b> from <b>{fmt(p.backlinks.referring_domains)}</b> sites.</p>}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function KeywordModal({ s, onClose }) {
  return (
    <Modal open={Boolean(s)} onClose={onClose} width="max-w-4xl" title={s ? `“${s.keyword}”` : ''}
      footer={s && csvBtn(() => downloadCsv(`google-results-${slugOf(s.keyword)}`, ['Source', 'Position', 'Title or business', 'Address', 'Rating', 'Reviews', 'You'], [...s.organic.map(o => ['Google', o.position, o.title || o.domain, o.url, '', '', o.mine ? 'yes' : 'no']), ...s.local.map(x => ['Google Maps', x.position, x.name, '', x.rating ?? '', x.reviews ?? '', x.mine ? 'yes' : 'no']), ...(s.questions || []).map(q => ['People also ask', '', q, '', '', '', ''])]))}>
      {s && (
        <div className="max-h-[68vh] overflow-y-auto pr-1 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <Label>Google top 10</Label>
            <ol className="space-y-1.5">
              {s.organic.map(o => (
                <li key={`${o.position}-${o.url}`} className={`flex items-start gap-2 rounded-lg px-2 py-1.5 ${o.mine ? 'bg-emerald-50' : ''}`}>
                  <Pos value={o.position} />
                  <div className="min-w-0">
                    <a href={o.url} target="_blank" rel="noreferrer" className="block text-13 font-medium text-slate-900 hover:text-indigo-700 truncate">{o.title || o.domain}</a>
                    <span className="text-12 text-slate-500">{o.domain}{o.type === 'directory' ? ' · listing site' : ''}{o.mine ? ' · you' : ''}</span>
                  </div>
                </li>
              ))}
              {!s.organic.length && <li className="text-12.5 text-slate-500">No results.</li>}
            </ol>
          </div>
          <div>
            <Label>Google Maps</Label>
            <ol className="space-y-1.5">
              {s.local.slice(0, 10).map(p => (
                <li key={`${p.position}-${p.name}`} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${p.mine ? 'bg-emerald-50' : ''}`}>
                  <Pos value={p.position} maps /><span className="flex-1 min-w-0 text-13 text-slate-900 truncate">{p.name}{p.mine ? ' (you)' : ''}</span><Stars rating={p.rating} reviews={p.reviews} />
                </li>
              ))}
              {!s.local.length && <li className="text-12.5 text-slate-500">No Maps results.</li>}
            </ol>
            {s.questions?.length > 0 && <div className="mt-5"><Label icon={HelpCircle}>People also ask</Label><ul className="space-y-1.5">{s.questions.map(q => <li key={q} className="text-13 text-slate-700 flex gap-2"><HelpCircle size={13} className="text-violet-500 mt-0.5 shrink-0" />{q}</li>)}</ul></div>}
          </div>
        </div>
      )}
    </Modal>
  );
}

function IdeasModal({ open, r, onClose }) {
  return (
    <Modal open={open} onClose={onClose} width="max-w-3xl" title="Keyword ideas from the research"
      footer={<>{csvBtn(() => downloadCsv(`keyword-ideas-${slugOf(r.business?.name)}`, ['Type', 'Idea'], [...r.ideas.competitor_keywords.map(x => ['Keyword competitors target', x]), ...r.ideas.questions.map(x => ['Question people ask', x]), ...r.ideas.related.map(x => ['Related search', x])]))}<Link to="/keyword-management" className="inline-flex items-center gap-1.5 text-13 font-semibold text-indigo-700 hover:underline">Step 2: find keywords <ArrowRight size={14} /></Link></>}>
      <div className="max-h-[66vh] overflow-y-auto pr-1 space-y-5">
        <div><Label icon={Search}>Keywords competitors target</Label><Chips items={r.ideas.competitor_keywords} empty="None found." /></div>
        <div><Label icon={HelpCircle}>Questions people ask</Label>{r.ideas.questions.length ? <ul className="space-y-1.5">{r.ideas.questions.map(q => <li key={q} className="flex gap-2 text-13 text-slate-700"><HelpCircle size={14} className="text-violet-500 mt-0.5 shrink-0" />{q}</li>)}</ul> : <p className="text-13 text-slate-500">Google showed no questions for these searches.</p>}</div>
        <div><Label icon={Sparkles}>Related searches</Label><Chips items={r.ideas.related} empty="Google showed no related searches." /></div>
      </div>
    </Modal>
  );
}

export function CompareModal({ state, onClose, bid }) {
  const c = state?.competitor;
  const has = (k) => Boolean(state?.[k]);
  // what was compared: the website, the Google listing, or both; they are tabs of one window, not two long sections one under the other
  const listing = has('listing') ? [{ id: 'listing', label: 'Google listing', node: <ListingComparison key={c?.id} c={state.listing} bid={bid} /> }] : [];
  return (
    <Modal open={Boolean(state)} onClose={onClose} width="max-w-5xl" title={c ? <span className="inline-flex flex-wrap items-center gap-x-3">Compare with {c.name}<span className="text-12 font-normal text-slate-500">{[has('result') && 'website', has('listing') && 'Google listing'].filter(Boolean).join(' + ')}</span></span> : ''}>
      {state?.loading && <div className="space-y-4"><SkStats n={3} cols="grid-cols-3" /><SkTable cols={4} rows={5} /></div>}
      {state?.notes?.length > 0 && <div className="mb-3 space-y-1">{state.notes.map(n => <p key={n} className="text-12.5 text-amber-900 bg-amber-50 rounded px-3 py-1.5">{n}</p>)}</div>}
      {state?.error && <ErrorNote>{state.error}</ErrorNote>}
      {state?.result && <div className="max-h-[74vh] overflow-y-auto pr-1"><ComparisonResult key={c?.id} c={state.result} bare onGo={onClose} extraTabs={listing} /></div>}
      {!state?.result && state?.listing && <div className="max-h-[74vh] overflow-y-auto pr-1"><ListingComparison key={c?.id} c={state.listing} bid={bid} /></div>}
    </Modal>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */

function Research({ b }) {
  const [toast, toastNode] = useToast();
  const [busy, error, run] = useAction();
  const [mapsBusy, mapsError, runMaps] = useAction();
  const [addBusy, addError, runAdd] = useAction();
  const [state, setState] = useState(null); // { run, defaults, setup }
  const [loadError, setLoadError] = useState('');
  const [params] = useSearchParams();
  const [tab, setTab] = useState(() => (['competitors', 'gap', 'keywords', 'traffic', 'pages', 'backlinks', 'maps', 'research'].includes(params.get('tab')) ? params.get('tab') : ['overview', 'rankings'].includes(params.get('tab')) ? 'research' : 'competitors'));
  const [focus, setFocus] = useState({ host: '', band: '' }); // the competitor (and ranking band) a table cell sent you to
  const goTo = (t, host = '', band = '') => { setFocus({ host, band }); setTab(t); };
  const [settings, setSettings] = useState(false);
  const [place, setPlace] = useState(''); // where competitors are found: '' = the project's own area
  const [radiusKm, setRadiusKm] = useState('5'); // how far around the place a competitor may be
  const optKey = `discovery.${b.id}`;
  const [opts, setOptsState] = useState(() => { try { return { category: '', services: '', seeds: '', country: '', language: 'en', ...(JSON.parse(localStorage.getItem(optKey)) || {}) }; } catch { return { category: '', services: '', seeds: '', country: '', language: 'en' }; } }); // what to look for: business type, services, seed keywords, country, language
  const setOpts = (patch) => setOptsState(o => { const n = { ...o, ...patch }; try { localStorage.setItem(optKey, JSON.stringify(n)); } catch { /* not remembered */ } return n; });
  const listOf = (t) => [...new Set(String(t || '').split(/[,\n]/).map(x => x.trim()).filter(Boolean))];
  const [scope, setScope] = useState('near'); // near: the businesses around the place | all: also the ones further away or only online
  const [researchView, setResearchView] = useState('overview');
  const [detail, setDetail] = useState(null);
  const [serp, setSerp] = useState(null);
  const [ideas, setIdeas] = useState(false);
  const [compare, setCompare] = useState(null); // { competitor, loading, result, error }
  const [registered, setRegistered] = useState([]); // competitors registered for audits (Google Maps)
  const [auditMap, setAuditMap] = useState({}); // { [competitorId]: { id, status } }
  const [ourAudit, setOurAudit] = useState(null);
  const [strategy, setStrategy] = useState('mobile');
  const [comparing, setComparing] = useState(null);
  const [panel, setPanel] = useState(false); // the My competitors sidebar
  const [auditsLoaded, setAuditsLoaded] = useState(false);

  const load = async () => {
    try { setState(await api(`/businesses/${b.id}/competitor-research`)); setLoadError(''); } catch (e) { setLoadError(e.message); }
  };
  const loadRegistered = async () => {
    const list = await api(`/competitors?business_id=${b.id}`).catch(() => []);
    setRegistered(list);
    const hist = await api(`/audit/competitors?business_id=${b.id}&limit=200&slim=true`).catch(() => []);
    const by = {};
    for (const a of hist) if (a.competitor_id && !by[a.competitor_id]) by[a.competitor_id] = { id: a.id, status: a.status };
    for (const c of list) if (c.listing_done && !c.website && !by[c.id]) by[c.id] = { id: null, status: 'done', listing: true, score: c.listing_score };
    setAuditMap(m => ({ ...by, ...m }));
    setAuditsLoaded(true);
    return list;
  };
  const loadOurAudit = async () => {
    if (!b.website) return;
    const [latest] = await api(`/website-audits?url=${encodeURIComponent(b.website)}&limit=1&slim=true`).catch(() => []);
    if (latest) setOurAudit({ id: latest.id, status: latest.status });
  };
  useEffect(() => { load(); loadRegistered(); loadOurAudit(); }, [b.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // A finished research run saves every competitor it found, so the saved list is read again then (not only when the page opens).
  const doneRun = state?.run?.status === 'done' ? state.run.id : state?.last_done?.id;
  useEffect(() => { if (doneRun) loadRegistered(); }, [doneRun]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = state?.run;
  usePoll(async () => {
    const r = await api(`/competitor-research/${current.id}`).catch(() => null);
    if (r) setState(s => ({ ...s, run: r }));
    if (r?.status === 'done') toast('Competitor research is ready.');
  }, isRunning(current), 2500);

  const pending = Object.entries(auditMap).filter(([, v]) => running(v.status) && v.id);
  usePoll(async () => {
    const ups = await Promise.all(pending.map(([cid, v]) => api(`/audit/competitors/${v.id}`).then(a => [cid, a]).catch(() => null)));
    setAuditMap(m => { const n = { ...m }; for (const u of ups) if (u) n[u[0]] = { id: u[1].id, status: u[1].status }; return n; });
  }, pending.length > 0, 2500);
  usePoll(async () => {
    const a = await api(`/website-audits/${ourAudit.id}`).catch(() => null);
    if (a) setOurAudit({ id: a.id, status: a.status });
  }, running(ourAudit?.status), 2500);

  const auditCompetitor = async (c) => {
    if (!c?.website) return;
    try {
      const [{ id, status }] = await api('/audit/competitors', { method: 'POST', body: { urls: [c.website], business_id: b.id, competitor_id: c.id, strategy } });
      setAuditMap(m => ({ ...m, [c.id]: { id, status } }));
    } catch (e) { setAuditMap(m => ({ ...m, [c.id]: { id: null, status: 'failed' } })); toast(`Audit failed: ${e.message}`); }
  };
  const auditOurSite = async () => {
    if (!b.website) return;
    try { const r = await api('/website-audits', { method: 'POST', body: { url: b.website, business_id: b.id, strategy } }); setOurAudit({ id: r.id, status: 'queued' }); } catch { /* shown when Compare fails */ }
  };

  // Google Maps finder: registers the competitors that have a website. Nothing about their sites is audited.
  const findOnMaps = () => runMaps('maps', async () => {
    const type = opts.category.trim() || b.primaryCategory || (state?.defaults?.keywords?.[0] || '').split(' in ')[0] || 'business';
    const where = place || [b.area, b.city].filter(Boolean).join(', ') || state?.defaults?.location || '';
    const r = await api('/competitors', { method: 'POST', body: { business_type: type, location: where, business_id: b.id, top_n: 15, services: listOf(opts.services).slice(0, 3), country: opts.country || undefined, language: opts.language || undefined, radius_km: Number(radiusKm) || undefined } });
    const list = await loadRegistered();
    toast(`${r.registered?.length || 0} competitor${r.registered?.length === 1 ? '' : 's'} with a website found or updated on Google Maps (${r.requests} Google request${r.requests === 1 ? '' : 's'}).`);
    return r;
  });

  const addManual = (url, name) => runAdd('add', async () => {
    const c = await api('/competitors/manual', { method: 'POST', body: { business_id: b.id, url, name } });
    await loadRegistered();
    toast(`${c.name} added as a competitor.`);
    return c;
  });

  // A competitor with no website: its Google Maps listing is read, scored, and the AI works out its services and keywords (one request, nothing to wait for)
  const auditListing = async (c) => {
    setAuditMap(m => ({ ...m, [c.id]: { id: null, status: 'running', listing: true } }));
    try {
      const r = await api(`/competitors/${c.id}/listing-audit`, { method: 'POST' });
      setAuditMap(m => ({ ...m, [c.id]: { id: null, status: 'done', listing: true, score: r.score } }));
      await loadRegistered();
    } catch (e) { setAuditMap(m => ({ ...m, [c.id]: { id: null, status: 'failed', listing: true } })); toast(`Could not read ${c.name}'s Google listing: ${e.message}`); }
  };
  // A business found on Maps is saved through its Google listing: used when it has no website, and when the "website" is an Instagram or Google business page (the server refuses those as a competitor's own site).
  const saveFromMaps = (m) => api('/competitors/maps', { method: 'POST', body: { business_id: b.id, name: m.name, address: m.address, cid: m.cid, phone: m.phone, rating: m.rating, reviews: m.reviews } });
  const notItsOwnSite = (e) => /social network or directory/i.test(e?.message || '');
  // A business found on Maps or in the Google results is saved as a competitor first (by its website, else through its Google listing); a saved one is used as it is.
  const ensureSaved = async (c) => {
    if (c?.id) { // an audited or compared business is a competitor you are working with: a saved one that was left unchosen is chosen now
      if (c.selected === false) {
        try { await api(`/competitors/${c.id}`, { method: 'PATCH', body: { selected: true } }); await loadRegistered(); } catch (e) { toast(e.message); }
      }
      return c;
    }
    const m = c?.maps || c;
    if (!m?.name) return null;
    let made;
    if (m.website) {
      try { made = await api('/competitors/manual', { method: 'POST', body: { business_id: b.id, url: m.website, name: m.name } }); }
      catch (e) { if (!(m.cid && notItsOwnSite(e))) throw e; made = await saveFromMaps(m); }
    } else made = await saveFromMaps(m);
    await loadRegistered();
    return made;
  };
  // Audit reads every source the competitor has: its website (speed and a crawl) and its Google listing. With no website, the listing alone.
  const auditRow = async (c) => {
    const name = (c?.maps || c)?.name;
    try {
      const made = await ensureSaved(c);
      if (!made) return;
      if (made.website) {
        await auditCompetitor(made);
        api(`/competitors/${made.id}/listing-audit`, { method: 'POST' }).then(loadRegistered).catch(() => { }); // its Google listing too, when Google has one
      } else await auditListing(made);
    } catch (e) { toast(`Could not audit ${name}: ${e.message}`); }
  };
  // The Maps competitors: audit your own site and each of them in one go, then compare every finished audit with yours at once.
  const [scorecard, setScorecard] = useState(null); // { loading, items, error }
  const auditAllMaps = () => {
    const sites = result?.local_competitors || [];
    if (b.website && (!ourAudit || ourAudit.status === 'failed')) auditOurSite();
    let n = 0;
    for (const e of sites) {
      const reg = registered.find(c => (e.website ? hostOf(c.website) === (e.domain || hostOf(e.website)) : (c.place_id && c.place_id === e.cid) || (!c.website && c.name === e.name)));
      if (reg && (running(auditMap[reg.id]?.status) || auditMap[reg.id]?.status === 'done')) continue;
      n += 1;
      auditRow(reg || e);
    }
    toast(n ? `Auditing ${b.website ? 'your site and ' : ''}${n} competitor${n === 1 ? '' : 's'}. Website audits take a few minutes; Google listings are read straight away.` : 'Every competitor is already audited or being audited.');
  };
  const compareAllMaps = async () => {
    const regs = (result?.local_competitors || []).map(e => registered.find(c => hostOf(c.website) === (e.domain || hostOf(e.website)))).filter(c => c && auditMap[c.id]?.status === 'done');
    if (!regs.length) return;
    setScorecard({ loading: true });
    try {
      const out = await api('/audit/competitors/compare', { method: 'POST', body: { business_id: b.id, competitor_ids: regs.map(c => c.id), strategy } });
      const items = (out.comparisons || []).filter(x => !x.error);
      setScorecard(items.length ? { items } : { error: 'Nothing to compare yet: audit your site and the competitors first.' });
    } catch (e) { setScorecard({ error: e.message }); }
  };

  // Choosing: a found competitor is used by nothing until it is chosen. One found only by the Google results (not saved yet) is saved as chosen.
  const chooseCompetitor = async (c, on) => {
    try {
      if (c.id) await api(`/competitors/${c.id}`, { method: 'PATCH', body: { selected: on } });
      else if (on && c.website) {
        try { await api('/competitors/manual', { method: 'POST', body: { business_id: b.id, url: c.website, name: c.name || '' } }); }
        catch (e) { if (!(c.maps && notItsOwnSite(e))) throw e; await saveFromMaps({ ...c.maps, name: c.maps.name || c.name }); } // its "website" is an Instagram or Google page: saved through its Google listing
      } else if (on) { // a business found on Google Maps that has no website: it is saved through its Google listing instead
        const m = c.maps || c;
        await saveFromMaps({ ...m, name: m.name || c.name || 'Competitor' });
      }
      await loadRegistered();
      toast(on ? `${c.name} chosen: Competitor Watch will follow it` : `${c.name} left out`);
    } catch (e) { toast(e.message); }
  };

  const removeCompetitor = async (c) => {
    try { await api(`/competitors/${c.id}`, { method: 'DELETE' }); await loadRegistered(); toast(`${c.name} removed`); } catch (e) { toast(`Could not remove it: ${e.message}`); }
  };

  const start = (keywords, location) => run('start', async () => {
    const r = await api(`/businesses/${b.id}/competitor-research`, { method: 'POST', body: { keywords, location: place || location, radius_km: Number(radiusKm) } });
    setState(s => ({ ...s, run: r }));
    setSettings(false);
    if (!registered.length) findOnMaps().catch(() => { }); // the first run also registers the Maps competitors for audits
  });

  // Compare reads what the competitor has and compares each source with yours: its website against yours, its Google listing against yours, or both.
  // Nothing has to be audited first: what is missing is read now (a Google listing takes seconds) or started (a website audit takes a few minutes).
  const doCompare = async (row) => {
    if (!row) return;
    setComparing(row.id ?? `new:${(row.maps || row).name}`);
    setCompare({ competitor: { name: (row.maps || row).name || row.name }, loading: true });
    const notes = [];
    let comp = row, result = null, listing = null, error = '';
    try {
      comp = await ensureSaved(row);
      if (!comp) throw new Error('This competitor has no name to look up.');
      setCompare({ competitor: comp, loading: true });
      try {
        listing = await api(`/competitors/${comp.id}/listing-compare`, { method: 'POST' });
        loadRegistered();
      } catch (e) { notes.push(comp.website ? 'Its Google listing could not be read, so only the websites are compared.' : `Its Google listing could not be read: ${e.message}`); }
      if (comp.website) {
        if (!b.website) notes.push('Your business has no website yet, so the websites cannot be compared. Your Google listing is compared instead.');
        else {
          const a = auditMap[comp.id];
          const mine = ourAudit?.status === 'done';
          if (a?.status === 'done' && mine) {
            try { const r = await api('/audit/competitors/compare', { method: 'POST', body: { business_id: b.id, competitor_ids: [comp.id], strategy } }); result = r.comparisons?.[0] || null; } catch (e) { notes.push(`The website comparison failed: ${e.message}`); }
            if (!result) notes.push('The website comparison has no data yet.');
          } else {
            if (!running(a?.status) && a?.status !== 'done') auditCompetitor(comp);
            if (!mine && !running(ourAudit?.status)) auditOurSite();
            notes.push('The websites are being audited now (a few minutes). Press Compare again when it finishes to add the website comparison.');
          }
        }
      }
      if (!result && !listing) error = 'There is no data to compare yet: ' + (comp.website ? 'its website audit is running and its Google listing could not be read.' : 'this business has no website and Google has no readable listing for it.');
    } catch (e) { error = e.message; }
    setCompare({ competitor: comp, result, listing, notes, error });
    setComparing(null);
  };

  // Opened from Competitor Watch with ?compare=domain: open that competitor's comparison straight away.
  const compareHost = (params.get('compare') || '').replace(/^www\./, '').toLowerCase();
  const compareDone = useRef('');
  useEffect(() => {
    if (!compareHost || compareDone.current === compareHost || !auditsLoaded) return;
    compareDone.current = compareHost;
    const c = registered.find(x => hostOf(x.website) === compareHost);
    if (!c) { toast(`${compareHost} is not saved as a competitor yet. Add it in the list on the right, then compare.`); return; }
    const a = auditMap[c.id];
    if (a?.status === 'done') { doCompare(c); return; }
    setTab('competitors');
    if (!a) auditCompetitor(c);
    toast(`${c.name}'s site is being audited first. When it finishes, press Compare on its row.`);
  }, [registered, auditsLoaded, compareHost]); // eslint-disable-line react-hooks/exhaustive-deps

  const mapsKit = { registered, auditMap, ourAudit, hasSite: Boolean(b.website), onAudit: auditRow, onAuditAll: auditAllMaps, onCompare: doCompare, comparing, scorecard, onScorecard: compareAllMaps };
  const chosenTotal = registered.filter(c => c.selected !== false).length;
  const result = current?.status === 'done' ? current.result : state?.last_done?.status === 'done' ? state.last_done.result : null;
  const defaults = useMemo(() => (current?.result?.keywords && !result ? { ...state?.defaults, keywords: current.result.keywords }
    : result ? { keywords: result.keywords, location: result.location || state?.defaults?.location } : state?.defaults || { keywords: [], location: '' }), [current, result, state?.defaults]);

  // One row per competitor: what the research found merged with what is registered for audits.
  const rows = useMemo(() => {
    const byHost = new Map();
    for (const p of result?.profiles || []) byHost.set(baseSite(p.domain), { host: baseSite(p.domain), name: p.local?.name || p.domain, website: `https://${p.domain}`, profile: p, reg: null });
    for (const e of result?.local_competitors || []) { // everything found on Google Maps is a row too, with its match rating
      const host = e.domain ? baseSite(e.domain) : hostOf(e.website) || `maps:${e.name}`;
      const row = byHost.get(host) || { host, name: e.name, website: e.website || null, profile: null, reg: null };
      row.maps = e; row.website = row.website || e.website || null; byHost.set(host, row);
    }
    for (const c of registered) {
      const host = hostOf(c.website) || (c.place_id && [...byHost.values()].find(x => x.maps?.cid === c.place_id)?.host) || `maps:${c.name}`;
      if (!host) continue;
      const row = byHost.get(host) || { host, name: c.name, website: c.website, profile: null, reg: null };
      row.reg = c; row.name = row.profile ? row.name : c.name; byHost.set(host, row);
    }
    const rank = (r_) => (r_.profile?.visibility ?? r_.maps?.visibility ?? -1) + (r_.maps?.relevance?.score ?? 0) / 1000;
    return [...byHost.values()].sort((x, y) => rank(y) - rank(x));
  }, [result, registered]);

  const rating = useRatings(b, place || state?.defaults?.location || '', registered.map(c => c.id));
  const tableRows = useMemo(() => rows.map(c => {
    const r = c.reg ? rating.by_id?.[String(c.reg.id)] : null;
    const maps = (c.maps || c.reg || r) ? { ...(c.maps || {}), address: r?.address || c.maps?.address || c.reg?.address, distance_m: r?.distance_m ?? c.maps?.distance_m, relevance: r?.relevance || c.maps?.relevance } : undefined;
    return { ...c, maps, key: c.host, host: /^maps:/.test(c.host) ? '' : c.host };
  }), [rows, rating.by_id]);
  const isChosenRow = (c) => Boolean(c.reg) && c.reg.selected !== false;
  const radius = Number(radiusKm) * 1000 || 5000; // the distance chosen next to the place
  const isNearRow = (c) => isChosenRow(c) || (c.maps ? (c.maps.distance_m == null || c.maps.distance_m <= radius) : false);
  const nearRows = useMemo(() => tableRows.filter(isNearRow), [tableRows, radius]); // eslint-disable-line react-hooks/exhaustive-deps
  const poolRows = scope === 'near' ? nearRows : tableRows;
  const analysis = useAnalysis(b, tableRows.map(c => c.host).filter(Boolean));
  const statusOf = (c) => analysis.metrics[c.host]?.status || 'pending';
  // the competitors around the place that are not analyzed yet are analyzed by themselves
  const pendingHosts = poolRows.filter(c => c.host && statusOf(c) !== 'analyzed').map(c => c.host);
  const auto = useAutoAnalysis(b, analysis, pendingHosts);

  if (!state) return loadError ? <ErrorNote>{loadError}</ErrorNote> : <div className="space-y-4"><SkCard title="Competitor research" subtitle="Who ranks for your keywords on Google and Maps"><Sk h="h-9" w="w-2/3" /></SkCard><SkCard title="Competitors found" pad={false}><SkTable headers={["Competitor", "Type", "Keywords", "Best position"]} rows={6} bare /></SkCard></div>;
  const p = current?.result?.progress;
  const s = result?.summary;

  return (
    <div className="space-y-3">
      {toastNode}


      {/* one section: where to look, what to run, and what the last run found */}
      <div className="rounded-xl bg-white ring-1 ring-slate-200">
        <div className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="inline-flex items-center gap-1.5 text-13 font-semibold text-slate-800"><MapPin size={15} className="text-indigo-500" />Find competitors in</span>
          <PlacePicker b={b} value={place} onChange={(v) => setPlace(v)} width={300} canSave={false} places={[{ name: state?.defaults?.location || [b.area, b.city].filter(Boolean).join(', ') || 'Project area', kind: 'project area' }, ...(b.target_areas || []).map(n => ({ name: n, kind: 'area' }))]} />
          <label className="inline-flex items-center gap-1.5 text-12.5 text-slate-600">within
            <Select value={radiusKm} onChange={e => setRadiusKm(e.target.value)} aria-label="Distance around the place" className="h-9 w-24 rounded-lg ring-1 ring-inset ring-slate-300 bg-white px-2.5 text-13 text-left">{['2', '5', '10', '20', '30'].map(k => <option key={k} value={k}>{k} km</option>)}</Select></label>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button icon={MapPin} busy={mapsBusy === 'maps'} disabled={isRunning(current)} onClick={findOnMaps} title="Looks up the businesses Google Maps shows for your type of business around this place">Find or refresh on Google Maps</Button>
            <Button variant="primary" icon={Play} busy={busy === 'start' || isRunning(current)} disabled={!state.setup?.google_results} onClick={() => start(listOf(opts.seeds).length ? listOf(opts.seeds) : defaults.keywords, place || defaults.location)} title="Reads Google's results for your keywords, searched from this place">{result ? 'Run research again' : 'Research this place'}</Button>
          </div>
        </div>
        <details className="border-t border-slate-100 px-4 py-2 text-13 group">
          <summary className="cursor-pointer text-slate-700 font-semibold select-none">Discovery options <span className="font-normal text-slate-500">{[opts.category && `category: ${opts.category}`, listOf(opts.services).length && `${listOf(opts.services).length} service${listOf(opts.services).length === 1 ? '' : 's'}`, listOf(opts.seeds).length && `${listOf(opts.seeds).length} seed keyword${listOf(opts.seeds).length === 1 ? '' : 's'}`, opts.country && `country ${opts.country}`, opts.language !== 'en' && `language ${opts.language}`].filter(Boolean).join(' · ') || 'business type, services, seed keywords, country, language'}</span></summary>
          <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            <label className="block text-12.5 text-slate-600">Business category<input value={opts.category} onChange={e => setOpts({ category: e.target.value })} placeholder={b.primaryCategory || 'e.g. clothing rental'} className="mt-1 h-9 w-full rounded-lg ring-1 ring-inset ring-slate-300 px-2.5 text-13" /><span className="text-11.5 text-slate-400">What Google Maps is asked for. Empty = the project's category.</span></label>
            <label className="block text-12.5 text-slate-600">Primary services (up to 3, comma separated)<input value={opts.services} onChange={e => setOpts({ services: e.target.value })} placeholder="e.g. saree rental, lehenga rental" className="mt-1 h-9 w-full rounded-lg ring-1 ring-inset ring-slate-300 px-2.5 text-13" /><span className="text-11.5 text-slate-400">Each one is searched too: one extra Google request each.</span></label>
            <label className="block text-12.5 text-slate-600">Seed keywords for the research run<input value={opts.seeds} onChange={e => setOpts({ seeds: e.target.value })} placeholder={(defaults.keywords || []).slice(0, 2).join(', ') || 'comma separated'} className="mt-1 h-9 w-full rounded-lg ring-1 ring-inset ring-slate-300 px-2.5 text-13" /><span className="text-11.5 text-slate-400">Empty = the project's keywords.</span></label>
            <label className="block text-12.5 text-slate-600">Country
              <Select value={opts.country} onChange={e => setOpts({ country: e.target.value })} aria-label="Country" className="mt-1 h-9 w-full rounded-lg ring-1 ring-inset ring-slate-300 bg-white px-2.5 text-13 text-left"><option value="">Project's country</option>{Object.entries({ IN: 'India', US: 'United States', GB: 'United Kingdom', CA: 'Canada', AU: 'Australia', AE: 'United Arab Emirates', DE: 'Germany', FR: 'France', SG: 'Singapore' }).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></label>
            <label className="block text-12.5 text-slate-600">Language of the Google results
              <Select value={opts.language} onChange={e => setOpts({ language: e.target.value })} aria-label="Language" className="mt-1 h-9 w-full rounded-lg ring-1 ring-inset ring-slate-300 bg-white px-2.5 text-13 text-left">{Object.entries({ en: 'English', hi: 'Hindi', mr: 'Marathi', gu: 'Gujarati', ta: 'Tamil', te: 'Telugu', bn: 'Bengali', es: 'Spanish', fr: 'French', de: 'German', ar: 'Arabic' }).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></label>
          </div>
          <p className="mt-2 text-11.5 text-slate-500">Distance (above) limits the Maps search to that circle. Maps discovery finds local businesses; whether one is a competitor for organic search is for you to judge: mark it Direct or Indirect in the table. Saved on this device for this project.</p>
        </details>
        <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/60 rounded-b-xl flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="min-w-0 flex-1">
            {isRunning(current) ? (
              <div className="flex items-center gap-3">
                <Loader2 size={16} className="animate-spin text-indigo-600 shrink-0" />
                <div className="flex-1 min-w-0"><div className="text-13 font-semibold text-slate-900">Researching competitors… <span className="font-normal text-slate-500 truncate">{p?.step || 'Starting'}</span></div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-slate-200 overflow-hidden"><div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${p ? Math.round((p.done / p.total) * 100) : 4}%` }} /></div></div>
              </div>
            ) : result ? (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
                <div className="text-12.5 text-slate-600" title={`${result.keywords.length} keywords · ${result.ideas?.competitor_keywords?.length || 0} competitor keywords · ${result.gaps?.keywords?.length || 0} gaps`}><b className="text-slate-900">Researched {fmtDateTime(result.analysed_at)}</b><br />{result.location || 'India'} · {result.keywords.length} keyword{result.keywords.length === 1 ? '' : 's'}</div>
                {[
                  ['Google visibility', s.keywords_ranked ? `${s.visibility}%` : '—', s.keywords_ranked ? `${s.keywords_ranked} of ${s.keywords_total} keywords shown` : 'link Search Console to see it', s.keywords_ranked ? (s.visibility >= (s.leader?.visibility || 0) ? 'text-emerald-600' : 'text-amber-600') : 'text-slate-400'],
                  ['Maps visibility', `${s.local_visibility}%`, `in Maps for ${s.local_ranked} of ${s.keywords_total}`, 'text-slate-900'],
                  ['Competitors', s.competitors, s.local_leader ? `leader ${s.local_leader.name}` : 'found', 'text-slate-900'],
                ].map(([l, v, sub, cls]) => <div key={l} className="min-w-[110px]"><div className="text-11.5 text-slate-500">{l}</div><div className={`text-18 font-bold tabular-nums leading-tight ${cls}`}>{v}</div><div className="text-11.5 text-slate-500 max-w-[200px] truncate" title={sub}>{sub}</div></div>)}
              </div>
            ) : <div className="text-13 text-slate-600">Research who outranks you on Google and Maps for this place, then see their keywords and the gap.</div>}
            {!isRunning(current) && result && place && result.location && !String(result.location).toLowerCase().includes(String(place).split(',')[0].toLowerCase()) && (
              <div className="mt-1.5 text-12 text-amber-700">The results above are for {result.location}. Press “Run research again” to read {place.split(',')[0]}.</div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" icon={Users} onClick={() => setPanel(true)} title="Add, choose and remove competitors">My competitors · <b className="tabular-nums">{chosenTotal}</b> chosen</Button>
            {result && <Button size="sm" icon={Settings2} onClick={() => setSettings(true)}>Keywords & settings</Button>}
            {result && <Button size="sm" icon={Download} onClick={() => downloadFile(`competitor-research-${slugOf(b.name)}-${today()}.md`, researchMd(result), 'text/markdown')}>Download</Button>}
          </div>
        </div>
      </div>
      {current?.status === 'failed' && <ErrorNote>{current.error || 'The research failed.'}</ErrorNote>}
      {isRunning(current) && <LiveResults progress={p} />}

      <div className="grid gap-5 items-start">
      <div className="min-w-0 space-y-3">
      {!result && !isRunning(current) && <Card title="Research your competitors" subtitle="Add the searches your customers type, then run it. The Maps competitors are registered for site audits at the same time."><SetupForm b={b} defaults={defaults} onStart={start} busy={busy === 'start'} error={error} setupInfo={state.setup} hasRun={false} /></Card>}

      <AnalysisStats rows={poolRows} status={statusOf} isChosen={isChosenRow} metrics={analysis.metrics} />
      <AutoBar auto={auto} />
      {(result || registered.length > 0) && (
        <div className={isRunning(current) ? 'space-y-3 opacity-60 pointer-events-none select-none' : 'space-y-3'} aria-busy={isRunning(current)}>
          <div>
            <Tabs value={tab} onChange={(t) => goTo(t)} tabs={[
              { id: 'competitors', label: 'Competitors', count: poolRows.length },
              { id: 'gap', label: 'Keyword gap' },
              { id: 'keywords', label: 'Competitor keywords' },
              { id: 'traffic', label: 'Traffic comparison' },
              { id: 'pages', label: 'Top pages' },
              { id: 'backlinks', label: 'Backlink comparison' },
              ...(result ? [{ id: 'maps', label: 'Google Maps', count: result.local_competitors.length }, { id: 'research', label: 'Research' }] : [])
            ]} />
            {tab === 'competitors' && <>
              <CompetitorsPanel b={b} auto={auto} rating={rating} rows={poolRows} scope={scope} setScope={setScope} nearCount={nearRows.length} allCount={tableRows.length} radius={radius} placeName={(result?.location || place || state?.defaults?.location || '').split(',')[0]}
                isChosen={isChosenRow} metrics={analysis.metrics} reload={analysis.reload} onChoose={chooseCompetitor} onRemove={removeCompetitor} onAdd={addManual} onDetail={setDetail} onGo={goTo}
                addBusy={addBusy === 'add'} addError={addError} onFindMaps={findOnMaps} findBusy={mapsBusy === 'maps'} />
              <ErrorNote>{mapsError}</ErrorNote>
            </>}
            {tab === 'gap' && <KeywordGapTab key={focus.host} b={b} focus={focus.host} />}
            {tab === 'keywords' && <CompetitorKeywordsTab key={`${focus.host}|${focus.band}`} b={b} focus={focus.host} band={focus.band} />}
            {tab === 'traffic' && <TrafficTab key={focus.host} b={b} rows={poolRows} analysis={analysis} focus={focus.host} />}
            {tab === 'pages' && <TopPagesTab key={focus.host} b={b} rows={poolRows} focus={focus.host} />}
            {tab === 'backlinks' && <BacklinkTab key={focus.host} rows={poolRows} analysis={analysis} focus={focus.host} />}
            {tab === 'maps' && result && <MapsTab r={result} kit={null} />}
            {tab === 'research' && result && (
              <div className="space-y-3">
                <div className="inline-flex rounded-lg ring-1 ring-inset ring-slate-300 overflow-hidden bg-white" role="group" aria-label="Research">{[['overview', 'Overview'], ['rankings', 'Rankings on your keywords']].map(([k, l]) => <button key={k} type="button" aria-pressed={researchView === k} onClick={() => setResearchView(k)} className={`h-9 px-3.5 text-13 font-medium cursor-pointer ${researchView === k ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}</div>
                {researchView === 'overview' ? <Overview r={result} goto={(id) => (id === 'keywords' ? setResearchView('rankings') : setTab(id === 'competitors' ? 'competitors' : id))} /> : <KeywordsTab r={result} onKeyword={setSerp} onIdeas={() => setIdeas(true)} />}
              </div>
            )}
          </div>
        </div>
      )}
      </div>
      <Drawer open={panel} onClose={() => setPanel(false)} width="max-w-md" title="My competitors" subtitle="Choose 3 to 5 that really compete with you. Only the chosen ones are watched.">
        <MyCompetitors list={registered} auditMap={{}} onAdd={addManual} onFind={findOnMaps} onAudit={() => {}} onRemove={removeCompetitor} onChoose={chooseCompetitor} addBusy={addBusy} addError={addError} findBusy={mapsBusy} findError={mapsError} running={isRunning(current)} />
      </Drawer>
      </div>

      <Modal open={settings} onClose={() => setSettings(false)} width="max-w-2xl" title="Keywords & research settings">
        <SetupForm b={b} defaults={defaults} onStart={start} busy={busy === 'start' || isRunning(current)} error={error} setupInfo={state.setup} hasRun={Boolean(result)} />
      </Modal>
      {result && <ProfileModal c={detail} r={result} onClose={() => setDetail(null)} onAudit={() => {}} onCompare={() => {}} auditMap={{}} />}
      {result && <KeywordModal s={serp} onClose={() => setSerp(null)} />}
      {result && <IdeasModal open={ideas} r={result} onClose={() => setIdeas(false)} />}
    </div>
  );
}

export default function CompetitorFinderPage() {
  return (
    <SeoShell step="competitors" title="Competitors" subtitle="Who outranks you on Google and Maps, side by side with you, the keywords you are missing, and what to do about it: one research, one place">
      {(b) => <Research key={b.id} b={b} />}
    </SeoShell>
  );
}
