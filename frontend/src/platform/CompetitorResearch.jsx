import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Plus, Search, X } from 'lucide-react';
import { Button, Badge, ErrorNote, useAction, useToast } from './SeoUi';
import DataTable from './DataTable';
import Select from '../components/Select';
import { api } from './seoApi';
import { CompetitorKeywordsTab, useCompetitorGap } from './CompetitorKeywordTabs';

const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const QUESTION = /^(who|what|when|where|why|how|which|can|does|do|is|are|should|will)\b/i;
const GROUP = { service: 'Service', near_me: 'Near me', local: 'Local', question: 'Question', fresh: 'Fresh', competitor: 'From competitors', brand: 'Brand' };
const INTENTS = [['informational', 'Informational'], ['commercial', 'Commercial'], ['transactional', 'Transactional'], ['navigational', 'Navigational'], ['local', 'Local']];
const norm = (k) => String(k || '').toLowerCase().split(/\s+/).filter(Boolean).join(' ');
const SECTIONS = [['discovery', 'Keyword Discovery'], ['competitors', 'Competitor Research'], ['location', 'Location-Based Keywords'], ['opportunities', 'Keyword Opportunities']];

/** Save keywords to My Keywords. The same keyword from another place is not duplicated: it keeps every place it came from, and the message says how many already existed. */
export async function saveToMy(b, list, toast, label, kind = 'google_ideas', extra = {}) {
  if (!list.length) { toast('Nothing to add: tick some rows first.'); return false; }
  try {
    const body = list.slice(0, 300).map(r => ({ keyword: r.keyword, volume: r.volume ?? undefined, difficulty: r.difficulty ?? r.kd ?? undefined, cpc: r.cpc ?? undefined, intent: r.intent || undefined,
      source: { kind, label: r.sourceLabel || label, from: 'research', at: new Date().toISOString().slice(0, 10), ...(r.competitor ? { competitor: r.competitor } : {}), ...(r.place ? { location: r.place } : {}), ...extra } }));
    const res = await api(`/businesses/${b.id}/keywords`, { method: 'POST', body, timeout: 120000 });
    toast(`${res.added} new keyword${res.added === 1 ? '' : 's'} added to My Keywords${res.existing?.length ? `. ${res.existing.length} already there${res.updated ? `, ${res.updated} got a new source` : ''}: not duplicated` : ''}${list.length > 300 ? '. Only the first 300 were sent.' : ''}`);
    return true;
  } catch (e) { toast(e.message || 'The keywords could not be added.'); return false; }
}

function Chips({ items, onRemove }) {
  return <div className="flex flex-wrap gap-1.5">{items.map(k => <span key={k} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200 text-12.5">{k}<button type="button" onClick={() => onRemove(k)} aria-label={`Remove ${k}`} className="p-0.5 rounded-full hover:bg-indigo-100 cursor-pointer"><X size={12} /></button></span>)}</div>;
}

function AddInput({ placeholder, onAdd, disabled }) {
  const [v, setV] = useState('');
  const go = () => { const t = v.trim(); if (t) { onAdd(t); setV(''); } };
  return <div className="flex gap-2"><input value={v} onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); go(); } }} placeholder={placeholder} disabled={disabled} className="h-9 flex-1 min-w-[200px] rounded-lg ring-1 ring-inset ring-slate-300 px-3 text-13" /><Button icon={Plus} onClick={go} disabled={disabled || !v.trim()}>Add</Button></div>;
}

/** A table with ticked rows and the two ways to save: the ticked ones, or everything the table shows now. */
function SaveTable({ b, rows, cols, filters, label, kind, exportName, initialSort, empty, toolbarExtra }) {
  const [toast, toastNode] = useToast();
  const [sel, setSel] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const view = useRef([]);
  const withSel = [{ id: 'sel', header: <input type="checkbox" aria-label="Select every row shown" onChange={e => setSel(s => { const n = new Set(s); view.current.forEach(r => (e.target.checked ? n.add(r.id) : n.delete(r.id))); return n; })} className="accent-indigo-600" />, csv: false,
    cell: r => <input type="checkbox" aria-label={`Select ${r.keyword}`} checked={sel.has(r.id)} onChange={() => setSel(s => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })} className="accent-indigo-600" />, className: 'pl-3 pr-1 py-2.5 w-8', thClass: 'pl-3 pr-1 py-3 w-8' },
  ...cols,
  { id: 'add', header: '', csv: false, right: true, className: 'px-2 py-1.5 text-right', cell: r => <button type="button" aria-label={`Add ${r.keyword} to My Keywords`} title="Add to My Keywords" onClick={async () => { setBusy(true); await saveToMy(b, [r], toast, label, kind); setBusy(false); }} className="p-1.5 text-slate-500 hover:text-emerald-700 cursor-pointer"><Plus size={16} /></button> }];
  const picked = rows.filter(r => sel.has(r.id));
  const run = async (list) => { setBusy(true); const ok = await saveToMy(b, list, toast, label, kind); setBusy(false); if (ok) setSel(new Set()); };
  return (
    <>
      <DataTable columns={withSel} rows={rows} rowKey={r => r.id} filters={filters} initialSort={initialSort} exportName={exportName} searchPlaceholder="Search keywords" label="keywords" empty={empty} onState={s => { view.current = s.rows; }}
        toolbar={<>{toolbarExtra}<Button size="sm" variant="primary" icon={Plus} busy={busy} disabled={!picked.length} onClick={() => run(picked)}>Add {picked.length || ''} ticked</Button><Button size="sm" icon={Plus} busy={busy} disabled={!rows.length} onClick={() => run(view.current.length ? view.current : rows)} title="Add every keyword the table shows now (up to 300 at a time)">Add all filtered</Button></>} />
      {toastNode}
    </>
  );
}

// ----------------------------------------------------------------------------------------------------------------------------- 1. keyword discovery
function Discovery({ b, ctx, disc, setDisc }) {
  const [seeds, setSeeds] = useState(null);
  const [areas, setAreas] = useState([]);
  const [busy, error, run] = useAction();
  useEffect(() => { if (ctx && seeds == null) { setSeeds((ctx.seeds || []).slice(0, 3)); setAreas([]); } }, [ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ctx || seeds == null) return <div className="flex items-center gap-2 py-8 text-13 text-slate-500"><Loader2 size={16} className="animate-spin" />Loading what the project offers…</div>;
  const services = (ctx.business?.services || []).filter(x => x && !seeds.includes(String(x).toLowerCase()));
  const places = [...new Set([...(ctx.areas || []), ...(ctx.nearby || [])])];
  const find = () => run('f', async () => setDisc(await api(`/businesses/${b.id}/keywords/discover`, { method: 'POST', body: { seeds, areas }, timeout: 150000 })));
  const rows = (disc?.keywords || []).map(k => ({ ...k, id: k.keyword, kd: k.difficulty }));
  const cols = [
    { id: 'keyword', header: 'Keyword', first: 'asc', value: r => r.keyword, cell: r => <span className="font-medium text-slate-900">{r.keyword}</span>, className: 'px-3 py-2.5 min-w-[220px]' },
    { id: 'group', header: 'Type', value: r => GROUP[r.group] || r.group, cell: r => <Badge tone={r.group === 'question' ? 'blue' : r.group === 'competitor' ? 'amber' : 'gray'}>{GROUP[r.group] || r.group}</Badge>, tip: { what: 'How the keyword was found: a service search, a near-me search, a place search, a question, a fresh topic, or one the competitors use.' } },
    { id: 'volume', header: 'Searches / mo', right: true, first: 'desc', value: r => r.volume ?? null, cell: r => (r.volume == null ? <span className="text-slate-300">Not available</span> : num(r.volume)), tip: { what: 'Monthly searches from Google Keyword Planner. Not available when Keyword Planner is not connected or has no figure.' } },
    { id: 'kd', header: 'KD', right: true, value: r => r.kd ?? null, cell: r => r.kd ?? <span className="text-slate-300">—</span> },
    { id: 'cpc', header: 'CPC', right: true, value: r => r.cpc ?? null, cell: r => (r.cpc == null ? '—' : `$${Number(r.cpc).toFixed(2)}`) },
    { id: 'intent', header: 'Intent', value: r => r.intent || '', cell: r => (r.intent ? <span className="text-12 capitalize text-slate-600">{r.intent}</span> : '—') },
    { id: 'site', header: 'On your site?', value: r => r.coverage?.status || '', hide: true, cell: r => (r.coverage ? (r.coverage.status === 'covered' ? 'Covered' : r.coverage.status === 'partial' ? 'Partly' : 'Not yet') : '—') },
    { id: 'tracked', header: 'In My Keywords', value: r => (r.tracked ? 'Yes' : 'No'), cell: r => (r.tracked ? <Badge tone="green">Saved</Badge> : <span className="text-slate-300">—</span>) },
  ];
  const filters = [
    { id: 'group', label: 'Type', options: Object.entries(GROUP), test: (r, v) => r.group === v },
    { id: 'intent', label: 'Intent', options: INTENTS, test: (r, v) => r.intent === v },
    { id: 'vol', label: 'Searches', options: [['1', 'Has searches'], ['100', '100+ a month'], ['1000', '1,000+ a month']], test: (r, v) => (r.volume || 0) >= Number(v) },
    { id: 'saved', label: 'Saved', options: [['no', 'Not in My Keywords yet'], ['yes', 'Already saved']], test: (r, v) => (v === 'yes' ? r.tracked : !r.tracked) },
  ];
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4 space-y-3">
        <div><div className="text-13 font-semibold text-slate-900">Seed keywords <span className="font-normal text-slate-500">(up to 6)</span></div>
          <p className="text-12 text-slate-500 mb-1.5">Business category: <b>{ctx.business?.category || 'not set'}</b>. Add the services you sell or the words customers use.</p>
          <Chips items={seeds} onRemove={k => setSeeds(s => s.filter(x => x !== k))} />
          <div className="mt-2"><AddInput placeholder="e.g. saree rental" disabled={seeds.length >= 6} onAdd={t => setSeeds(s => [...new Set([...s, norm(t)])].slice(0, 6))} /></div>
          {services.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-1.5 text-12 text-slate-500">Your services: {services.slice(0, 8).map(x => <button key={x} type="button" disabled={seeds.length >= 6} onClick={() => setSeeds(s => [...new Set([...s, norm(x)])].slice(0, 6))} className="px-2 py-0.5 rounded-full border border-slate-200 hover:bg-slate-50 cursor-pointer disabled:opacity-40">+ {x}</button>)}</div>}
        </div>
        {places.length > 0 && <div><div className="text-13 font-semibold text-slate-900">Target locations <span className="font-normal text-slate-500">(optional)</span></div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">{places.slice(0, 14).map(p => <button key={p} type="button" aria-pressed={areas.includes(p)} onClick={() => setAreas(a => (a.includes(p) ? a.filter(x => x !== p) : [...a, p].slice(0, 10)))} className={`h-8 px-3 rounded-full text-12.5 font-semibold cursor-pointer ring-1 ring-inset ${areas.includes(p) ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}>{p}</button>)}</div></div>}
        <div className="flex flex-wrap items-center gap-3"><Button variant="primary" icon={Search} busy={busy === 'f'} disabled={!seeds.length} onClick={find}>Find keywords</Button>
          <span className="text-12 text-slate-500">Reads Google's own suggestions for your seeds, places, questions and the competitors' ideas, then adds searches, CPC and difficulty from Keyword Planner when it is connected.</span></div>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
      {disc && <>
        <p className="text-12.5 text-slate-600">{rows.length} keywords from {disc.queries} Google suggestions. {disc.metrics_note ? <span className="text-amber-700">{disc.metrics_note}</span> : 'Searches, CPC and difficulty are from Google Keyword Planner.'}</p>
        <SaveTable b={b} rows={rows} cols={cols} filters={filters} label="Keyword research" kind="google_ideas" exportName="keyword-discovery" initialSort={{ key: 'volume', dir: 'desc' }} empty="No keyword matches these filters." />
      </>}
    </div>
  );
}

// ----------------------------------------------------------------------------------------------------------------------------- 3. location-based keywords
const PATTERNS = [['{s} {p}', 'service place'], ['{s} in {p}', 'service in place'], ['{s} near {p}', 'service near place'], ['best {s} in {p}', 'best service in place']];

function Location({ b, ctx }) {
  const [services, setServices] = useState(null);
  const [places, setPlaces] = useState([]);
  const [custom, setCustom] = useState([]);
  const [pats, setPats] = useState([0, 1]);
  const [rows, setRows] = useState(null);
  const [note, setNote] = useState('');
  const [busy, error, run] = useAction();
  useEffect(() => { if (ctx && services == null) setServices([...new Set([...(ctx.seeds || []).slice(0, 3), ...(ctx.business?.services || []).slice(0, 2).map(x => norm(x))])].slice(0, 5)); }, [ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ctx || services == null) return <div className="flex items-center gap-2 py-8 text-13 text-slate-500"><Loader2 size={16} className="animate-spin" />Loading…</div>;
  const options = [...new Set([...(ctx.areas || []), ...(ctx.nearby || []), ...custom])];
  const combos = () => services.flatMap(s => places.flatMap(p => pats.map(i => ({ keyword: norm(PATTERNS[i][0].replace('{s}', s).replace('{p}', p.split(',')[0])), place: p, service: s })))).filter((x, i, a) => a.findIndex(y => y.keyword === x.keyword) === i).slice(0, 100);
  const make = () => run('g', async () => {
    const list = combos();
    const r = await api(`/businesses/${b.id}/keyword-workspace/bulk-metrics`, { method: 'POST', body: { keywords: list.map(x => x.keyword) }, timeout: 120000 });
    const by = new Map((r.rows || []).map(x => [x.keyword, x]));
    setNote(r.note || '');
    setRows(list.map(x => ({ ...x, id: x.keyword, volume: by.get(x.keyword)?.volume ?? null, cpc: by.get(x.keyword)?.cpc ?? null, intent: 'local', sourceLabel: `Location keywords: ${x.place}` })));
  });
  const cols = [
    { id: 'keyword', header: 'Keyword', first: 'asc', value: r => r.keyword, cell: r => <span className="font-medium text-slate-900">{r.keyword}</span>, className: 'px-3 py-2.5 min-w-[220px]' },
    { id: 'place', header: 'Location', value: r => r.place, cell: r => <span className="text-slate-600">{r.place.split(',')[0]}</span> },
    { id: 'service', header: 'Service', value: r => r.service },
    { id: 'volume', header: 'Searches / mo', right: true, first: 'desc', value: r => r.volume ?? null, cell: r => (r.volume == null ? <span className="text-slate-300">Not available</span> : num(r.volume)), tip: { what: 'Monthly searches from Google Keyword Planner. A phrase nobody searches shows Not available.' } },
    { id: 'cpc', header: 'CPC', right: true, value: r => r.cpc ?? null, cell: r => (r.cpc == null ? '—' : `$${Number(r.cpc).toFixed(2)}`) },
  ];
  const filters = [
    { id: 'place', label: 'Location', options: places.map(p => [p, p.split(',')[0]]), test: (r, v) => r.place === v },
    { id: 'vol', label: 'Searches', options: [['1', 'Has searches'], ['100', '100+ a month']], test: (r, v) => (r.volume || 0) >= Number(v) },
  ];
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4 space-y-3">
        <div><div className="text-13 font-semibold text-slate-900">Services</div><div className="mt-1.5"><Chips items={services} onRemove={k => setServices(s => s.filter(x => x !== k))} /></div><div className="mt-2"><AddInput placeholder="e.g. seo agency" disabled={services.length >= 5} onAdd={t => setServices(s => [...new Set([...s, norm(t)])].slice(0, 5))} /></div></div>
        <div><div className="text-13 font-semibold text-slate-900">Which places are worth targeting? <span className="font-normal text-slate-500">Tick only the ones where your customers really are.</span></div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">{options.map(p => <button key={p} type="button" aria-pressed={places.includes(p)} onClick={() => setPlaces(a => (a.includes(p) ? a.filter(x => x !== p) : [...a, p].slice(0, 12)))} className={`h-8 px-3 rounded-full text-12.5 font-semibold cursor-pointer ring-1 ring-inset ${places.includes(p) ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}>{p.split(',')[0]}</button>)}{!options.length && <span className="text-12.5 text-slate-500">No area is set on the project yet. Add one below.</span>}</div>
          <div className="mt-2"><AddInput placeholder="Add a place, e.g. Wakad" onAdd={t => { setCustom(c => [...new Set([...c, t])]); setPlaces(a => [...new Set([...a, t])]); }} /></div></div>
        <div className="flex flex-wrap items-center gap-3 text-12.5 text-slate-700">Phrase shapes:{PATTERNS.map(([, l], i) => <label key={l} className="inline-flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={pats.includes(i)} onChange={e => setPats(p => (e.target.checked ? [...p, i] : p.filter(x => x !== i)))} className="accent-indigo-600" />{l}</label>)}</div>
        <div className="flex flex-wrap items-center gap-3"><Button variant="primary" icon={Search} busy={busy === 'g'} disabled={!services.length || !places.length || !pats.length} onClick={make}>Generate and check searches</Button>
          <span className="text-12 text-slate-500">{services.length && places.length && pats.length ? `${Math.min(100, services.length * places.length * pats.length)} phrases` : 'Pick a service, a place and a phrase shape.'} Each is looked up in Google Keyword Planner; phrases with no searches are shown as Not available.</span></div>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
      {rows && <>{note && <p className="text-12.5 text-amber-700">{note}</p>}<SaveTable b={b} rows={rows} cols={cols} filters={filters} label="Location keywords" kind="google_ideas" exportName="location-keywords" initialSort={{ key: 'volume', dir: 'desc' }} empty="No phrase matches." /></>}
    </div>
  );
}

// ----------------------------------------------------------------------------------------------------------------------------- 4. keyword opportunities
const OPP = [
  ['missing', 'Missing competitor keywords', 'A competitor ranks and you do not', r => r.gap === 'missing'],
  ['easy', 'Low difficulty, relevant', 'Difficulty under 30 and useful for your business', r => r.kd != null && r.kd < 30 && r.fit],
  ['volume', 'High volume, relevant', '1,000+ searches a month and useful for your business', r => (r.volume || 0) >= 1000 && r.fit],
  ['commercial', 'Commercial intent', 'People looking to buy or hire', r => r.intent === 'commercial' || r.intent === 'transactional'],
  ['long', 'Long-tail', 'Four words or more', r => r.keyword.split(' ').length >= 4],
  ['question', 'Question-based', 'Starts with who, what, how, why…', r => QUESTION.test(r.keyword)],
];

function Opportunities({ b, disc }) {
  const gap = useCompetitorGap(b);
  const [which, setWhich] = useState('missing');
  const g = gap.data;
  const pool = useMemo(() => {
    const by = new Map();
    for (const r of g?.rows || []) {
      if (r.status === 'only_you') continue;
      by.set(r.keyword, { id: r.keyword, keyword: r.keyword, volume: r.volume, kd: r.difficulty, cpc: r.cpc, intent: r.intent, fit: r.fit === 'yes' || r.fit === 'maybe', gap: r.status, score: r.score, from: 'Competitor gap', competitor: r.best?.domain, sourceLabel: `Competitor gap: ${r.best?.domain || 'competitors'}` });
    }
    for (const r of disc?.keywords || []) if (!by.has(r.keyword) && !r.tracked) by.set(r.keyword, { id: r.keyword, keyword: r.keyword, volume: r.volume, kd: r.difficulty, cpc: r.cpc, intent: r.intent, fit: r.stars >= 3, gap: null, score: null, from: 'Keyword discovery', sourceLabel: 'Keyword research' });
    return [...by.values()];
  }, [g, disc]);
  if (!g) return <div className="flex items-center gap-2 py-8 text-13 text-slate-500"><Loader2 size={16} className="animate-spin" />Loading…</div>;
  const cur = OPP.find(o => o[0] === which);
  const counts = Object.fromEntries(OPP.map(o => [o[0], pool.filter(o[3]).length]));
  const rows = pool.filter(cur[3]);
  const cols = [
    { id: 'keyword', header: 'Keyword', first: 'asc', value: r => r.keyword, cell: r => <span className="font-medium text-slate-900">{r.keyword}</span>, className: 'px-3 py-2.5 min-w-[220px]' },
    { id: 'score', header: 'Opportunity', right: true, first: 'desc', value: r => r.score ?? null, cell: r => (r.score == null ? <span className="text-slate-300">—</span> : <b>{r.score}</b>), tip: { what: 'Our own 0 to 100 score for competitor gap keywords: searches, ease, intent, distance from the competitor and fit. Not a Google ranking factor. Keywords from discovery have no score.' } },
    { id: 'volume', header: 'Searches / mo', right: true, first: 'desc', value: r => r.volume ?? null, cell: r => num(r.volume) },
    { id: 'kd', header: 'KD', right: true, value: r => r.kd ?? null, cell: r => r.kd ?? '—' },
    { id: 'intent', header: 'Intent', value: r => r.intent || '', cell: r => (r.intent ? <span className="text-12 capitalize text-slate-600">{r.intent}</span> : '—') },
    { id: 'from', header: 'Found in', value: r => r.from, cell: r => <span className="text-12 text-slate-600">{r.from}{r.competitor ? `: ${r.competitor}` : ''}</span> },
  ];
  return (
    <div className="space-y-3">
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
        {OPP.map(o => <button key={o[0]} type="button" aria-pressed={which === o[0]} onClick={() => setWhich(o[0])} className={`text-left rounded-xl bg-white ring-1 px-3.5 py-2.5 cursor-pointer ${which === o[0] ? 'ring-2 ring-indigo-500' : 'ring-slate-200 hover:bg-slate-50'}`}><div className="text-12.5 text-slate-600">{o[1]}</div><div className="text-22 font-bold text-slate-900 tabular-nums leading-tight">{counts[o[0]]}</div><div className="text-11.5 text-slate-500">{o[2]}</div></button>)}
      </div>
      <p className="text-12 text-slate-500">Built from your kept competitor rankings{disc ? ' and the keyword discovery you just ran' : ''}. Keywords you already have in My Keywords are left out of discovery results. {!g.competitors?.some(c => c.keywords) && 'No competitor rankings are kept yet: analyze competitors on the Competitors tab for the missing-keyword list.'}</p>
      <SaveTable b={b} rows={rows} cols={cols} label="Keyword opportunities" kind="competitors" exportName={`opportunities-${which}`} initialSort={{ key: 'volume', dir: 'desc' }} empty="No keyword fits this list yet." />
    </div>
  );
}

// ----------------------------------------------------------------------------------------------------------------------------- the tab
export default function ResearchTab({ b, legacy = null, section: forced = null, hideNav = false }) {
  const [sec, setSection] = useState('discovery');
  const section = forced || sec;
  const [ctx, setCtx] = useState(null);
  const [disc, setDisc] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api(`/businesses/${b.id}/keywords/context`, { timeout: 90000 }).then(setCtx).catch(e => setErr(e.message)); }, [b.id]);
  const secs = legacy ? [...SECTIONS, ['run', 'Research run']] : SECTIONS;
  return (
    <div className="space-y-3">
      {!hideNav && <div className="inline-flex flex-wrap rounded-lg ring-1 ring-inset ring-slate-300 overflow-hidden bg-white" role="group" aria-label="Research sections">
        {secs.map(([k, l]) => <button key={k} type="button" aria-pressed={section === k} onClick={() => setSection(k)} className={`h-9 px-3.5 text-13 font-medium cursor-pointer ${section === k ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}
      </div>}
      {err && <ErrorNote>{err}</ErrorNote>}
      {section === 'discovery' && <Discovery b={b} ctx={ctx} disc={disc} setDisc={setDisc} />}
      {section === 'competitors' && <div className="space-y-2"><p className="text-12.5 text-slate-600">Pick one or several competitors, read their ranked keywords, narrow them by position, searches, difficulty, intent or page, and save the ones you want. Rankings are for the project's market.</p><CompetitorKeywordsTab b={b} /></div>}
      {section === 'location' && <Location b={b} ctx={ctx} />}
      {section === 'opportunities' && <Opportunities b={b} disc={disc} />}
      {section === 'run' && legacy}
    </div>
  );
}
