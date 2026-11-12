import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, Plus, Sparkles, FileText, Trash2, Loader2, MapPin, Globe, Users, X, Star, CheckCircle2, CircleDashed, AlertTriangle, Copy, Check, BarChart2,
  TrendingUp, TrendingDown, Download, Flame, HelpCircle, Navigation, Tag, Wrench, ExternalLink, ArrowLeft
} from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { SeoShell, Card, Tabs, Badge, Button, inputCls, Meter, ErrorNote, useToast, useAction, useUrlTab, useDoubleConfirm, SkTable, SkCard } from './SeoUi';
import { api, useApi, fmtDateTime, fmt, SEO_API } from './seoApi';
import { pathOnly as pathOf } from './siteUtils';
import Select from '../components/Select';

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
  brand: { label: 'Your brand', icon: Tag, tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200', hint: 'People searching for you by name' }
};
const ORDER = ['competitor', 'local', 'near_me', 'service', 'question', 'fresh', 'brand'];
const kd = (d) => (d == null ? ['—', 'gray'] : d < 30 ? ['Easy', 'green'] : d < 55 ? ['Medium', 'amber'] : ['Hard', 'red']);

function Chip({ on, children, onClick, onRemove, title }) {
  return (
    <span className={`inline-flex items-center rounded-lg ring-1 ring-inset text-12 font-medium transition-colors ${on ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'}`} title={title}>
      <button type="button" onClick={onClick} className="px-2.5 py-1 cursor-pointer">{children}</button>
      {onRemove && <button type="button" onClick={onRemove} className={`pr-2 cursor-pointer ${on ? 'text-indigo-200 hover:text-white' : 'text-slate-400 hover:text-slate-700'}`} aria-label="Remove"><X size={12} /></button>}
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

function Discover({ b, tracked, onTracked }) {
  const ctx = useApi(`/businesses/${b.id}/keywords/context`);
  const c = ctx.data;
  const [seeds, setSeeds] = useState(null); // [{text, on}]
  const [areas, setAreas] = useState(null);
  const [custom, setCustom] = useState('');
  const [result, setResult] = useState(null);
  const [group, setGroup] = useState('all');
  const [q, setQ] = useState('');
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [selected, setSelected] = useState([]);
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
  const find = () => run('find', async () => {
    const r = await api(`/businesses/${b.id}/keywords/discover`, { method: 'POST', body: { seeds: activeSeeds, areas: activeAreas } });
    setResult(r); setSelected([]); setGroup('all');
  });
  // Run once the starting point is ready, so the page opens with results.
  useEffect(() => { if (seeds && !result && activeSeeds.length && !busy) find(); }, [seeds]); // eslint-disable-line react-hooks/exhaustive-deps

  const addSeed = () => {
    const t = custom.trim().toLowerCase();
    if (!t) return;
    setSeeds(s => (s.some(x => x.text === t) ? s.map(x => (x.text === t ? { ...x, on: true } : x)) : [...s, { text: t, on: true }]));
    setCustom('');
  };
  const toggle = (setter, text) => setter(list => list.map(x => (x.text === text ? { ...x, on: !x.on } : x)));

  const trackedSet = new Set(tracked.map(k => k.keyword));
  const all = result?.keywords || [];
  const shown = all.filter(k => (group === 'all' || k.group === group) && (!onlyGaps || k.coverage?.status === 'gap') && (!q || k.keyword.includes(q.toLowerCase())));
  const live = result?.data_source?.includes('keyword_planner');
  const gaps = all.filter(k => k.coverage?.status === 'gap' && ['service', 'local'].includes(k.group)).slice(0, 8);
  const questions = all.filter(k => k.group === 'question').slice(0, 8);

  const track = (rows) => run('track', async () => {
    const body = rows.map(k => ({ keyword: k.keyword, volume: k.volume ?? null, difficulty: k.difficulty ?? null, cpc: k.cpc ?? null, intent: k.intent, target_url: k.coverage?.page ? pathOf(k.coverage.page) : null, priority: k.group === 'near_me' || k.group === 'local' ? 'High' : 'Medium' }));
    const r = await api(`/businesses/${b.id}/keywords`, { method: 'POST', body });
    setSelected([]); onTracked(); toast(`${r.added} keyword${r.added === 1 ? '' : 's'} added to tracking`);
    setResult(res => res && { ...res, keywords: res.keywords.map(k => (rows.some(x => x.keyword === k.keyword) ? { ...k, tracked: true } : k)) });
  });
  const exportCsv = () => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Keyword', 'Group', 'Intent', 'Suggest strength (1-5)', 'Volume', 'Trend %', 'Website', 'Page'], ...shown.map(k => [k.keyword, GROUPS[k.group]?.label, k.intent, k.stars, k.volume, k.trend, k.coverage?.status || 'not audited', k.coverage?.page || ''])].map(l => l.map(esc).join(','));
    const href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    Object.assign(document.createElement('a'), { href, download: `keywords-${b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv` }).click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  if (ctx.error) return <ErrorNote>{ctx.error.message}</ErrorNote>;
  if (!c || !seeds) return <Card><div className="py-12 flex items-center justify-center gap-2 text-13 text-slate-500"><Loader2 size={16} className="animate-spin" /> Reading {b.name}'s profile and audits…</div></Card>;

  const selectable = shown.filter(k => !k.tracked && !trackedSet.has(k.keyword));
  return (
    <div className="space-y-5">
      {/* Step 1 is competitor research: the keywords below start from it. */}
      {c.competitor_research ? (
        <div className="rounded bg-emerald-50 ring-1 ring-inset ring-emerald-200 px-4 py-3 flex flex-wrap items-center gap-3 text-13 text-emerald-900">
          <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
          <span className="flex-1 min-w-[220px]"><b>Built on your competitor research</b> ({fmtDateTime(c.competitor_research.analysed_at)}): {c.competitor_research.ideas} keyword ideas from {c.competitor_research.competitors} competitors are mixed in, marked "From competitors".</span>
          <Link to="/competitor-finder" className="text-12.5 font-semibold text-emerald-800 hover:underline">Open research</Link>
        </div>
      ) : (
        <div className="rounded bg-amber-50 ring-1 ring-inset ring-amber-200 px-4 py-3 flex flex-wrap items-center gap-3 text-13 text-amber-900">
          <AlertTriangle size={16} className="text-amber-600 shrink-0" />
          <span className="flex-1 min-w-[220px]"><b>Do competitor research first.</b> It shows which searches your rivals win on Google, so keyword discovery can start from what already works. You can still search without it.</span>
          <Link to="/competitor-finder" className="h-9 px-3.5 rounded inline-flex items-center gap-1.5 text-13 font-semibold bg-amber-500 text-white hover:bg-amber-600"><ArrowLeft size={14} /> Step 1: competitor research</Link>
        </div>
      )}

      {/* Starting point */}
      <Card title="What we search from" subtitle={`Built from ${b.name}'s profile and website audit. Switch items on or off, then find keywords.`}
        action={<Button variant="primary" icon={Search} busy={busy === 'find'} disabled={!activeSeeds.length} onClick={find}>Find keywords</Button>}>
        <div className="space-y-4">
          <div>
            <div className="text-11 font-semibold   text-slate-500 mb-1.5">Services & category <span className="normal-case font-normal tracking-normal">({activeSeeds.length}/6 on)</span></div>
            <div className="flex flex-wrap items-center gap-1.5">
              {seeds.map(s => <Chip key={s.text} on={s.on} onClick={() => (s.on || activeSeeds.length < 6) && toggle(setSeeds, s.text)} onRemove={c.seeds.includes(s.text) ? null : () => setSeeds(list => list.filter(x => x.text !== s.text))}>{s.text}</Chip>)}
              <span className="inline-flex items-center gap-1">
                <input className="h-7 w-44 px-2.5 text-12 rounded-lg bg-white ring-1 ring-inset ring-slate-200 outline-none focus:ring-indigo-400" placeholder="Add a service…" value={custom} onChange={e => setCustom(e.target.value)} onKeyDown={e => e.key === 'Enter' && addSeed()} />
                <button type="button" onClick={addSeed} className="h-7 w-7 rounded-lg ring-1 ring-inset ring-slate-200 text-slate-500 hover:text-slate-900 flex items-center justify-center cursor-pointer" aria-label="Add service"><Plus size={13} /></button>
              </span>
            </div>
            {!c.seeds.length && <div className="mt-1.5 text-12 text-amber-700">No category or services on the profile yet. Add one above, or fill them in GBP Manager.</div>}
          </div>
          <div>
            <div className="text-11 font-semibold   text-slate-500 mb-1.5">Area & nearby localities</div>
            <div className="flex flex-wrap gap-1.5">
              {areas.map((a, i) => <Chip key={a.text} on={a.on} onClick={() => toggle(setAreas, a.text)} title={i < c.areas.length ? 'From the business profile' : 'Nearby, from OpenStreetMap'}>{i < c.areas.length && <MapPin size={11} className="inline -mt-0.5 mr-1" />}{a.text}</Chip>)}
            </div>
            {!c.business.has_location && <div className="mt-1.5 text-12 text-slate-500">Set the map pin in Business Onboarding to add nearby localities automatically.</div>}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded bg-slate-50 ring-1 ring-inset ring-slate-200 px-3.5 py-3">
              <div className="text-12 font-semibold text-slate-800 flex items-center gap-1.5"><Globe size={13} /> Website audit</div>
              {c.website ? (
                <>
                  <div className="text-12 text-slate-600 mt-0.5">Score {c.website.score}/100 · {c.website.pages} pages · {fmtDateTime(c.website.finished_at)}. Each keyword is checked against these pages.</div>
                  {c.website.topics.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{c.website.topics.map(t => <span key={t} className="text-11 px-1.5 py-0.5 rounded bg-white ring-1 ring-inset ring-slate-200 text-slate-600">{t}</span>)}</div>}
                </>
              ) : <div className="text-12 text-slate-600 mt-0.5">Not audited yet, so content gaps can't be checked. <Link to="/website-audit" className="font-medium text-indigo-700 hover:underline">Audit the website</Link></div>}
            </div>
            <div className="rounded bg-slate-50 ring-1 ring-inset ring-slate-200 px-3.5 py-3">
              <div className="text-12 font-semibold text-slate-800 flex items-center gap-1.5"><Users size={13} /> Competitors</div>
              {c.competitors.length ? <div className="mt-1.5 flex flex-wrap gap-1">{c.competitors.map(n => <span key={n} className="text-11 px-1.5 py-0.5 rounded bg-white ring-1 ring-inset ring-slate-200 text-slate-600">{n}</span>)}</div>
                : <div className="text-12 text-slate-600 mt-0.5">None yet. <Link to="/competitor-finder" className="font-medium text-indigo-700 hover:underline">Run competitor research</Link> to find who outranks you.</div>}
            </div>
          </div>
        </div>
        <ErrorNote>{error}</ErrorNote>
      </Card>

      {busy === 'find' && !result && <Card><div className="py-12 flex items-center justify-center gap-2 text-13 text-slate-500"><Loader2 size={16} className="animate-spin" /> Asking Google what people search for…</div></Card>}

      {result && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[[Search, 'Keywords found', all.length, `from ${result.queries} Google lookups`],
            [MapPin, 'Local & near me', (result.counts.local || 0) + (result.counts.near_me || 0), 'ready-to-visit searches'],
            [HelpCircle, 'Questions', result.counts.question || 0, 'for FAQs and blog posts'],
            [AlertTriangle, 'Content gaps', result.website_checked ? result.gaps : '—', result.website_checked ? 'no page targets them yet' : 'audit the website to check']
            ].map(([I, l, v, h]) => (
              <div key={l} className="ai-glass-card rounded px-4 py-3.5">
                <div className="text-12 font-semibold text-slate-500 flex items-center gap-1.5"><I size={13} /> {l}</div>
                <div className="text-24 font-bold text-slate-900 tabular-nums mt-0.5">{v}</div>
                <div className="text-11.5 text-slate-500">{h}</div>
              </div>
            ))}
          </div>

          {result.trending_today.length > 0 && (
            <Card title="In Google Trends today" subtitle="Today's trending searches in India that mention your topics">
              <div className="flex flex-wrap gap-2">{result.trending_today.map(t => <span key={t.keyword} className="inline-flex items-center gap-1.5 text-12.5 px-2.5 py-1 rounded-lg bg-orange-50 ring-1 ring-inset ring-orange-200 text-orange-800"><Flame size={12} /> {t.keyword}{t.traffic && <span className="text-orange-600/70">{t.traffic}</span>}</span>)}</div>
            </Card>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            <div className="xl:col-span-2 min-w-0">
              <Card pad={false} title={`Keywords (${shown.length})`}
                subtitle={live ? 'Real searches from Google Autocomplete, with monthly volume and 12-month trend from the Google Ads Keyword Planner.' : 'Real searches from Google Autocomplete. Stars show how strongly Google suggests each one. Monthly volumes need the Google Ads Keyword Planner API.'}
                action={<div className="flex gap-2"><Button size="sm" icon={Download} onClick={exportCsv} disabled={!shown.length}>CSV</Button><Button size="sm" variant="primary" icon={Plus} busy={busy === 'track'} disabled={!selected.length} onClick={() => track(all.filter(k => selected.includes(k.keyword)))}>Track {selected.length || ''}</Button></div>}>
                <div className="px-6 py-3 border-b border-slate-100 space-y-2.5">
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => setGroup('all')} className={`h-8 px-3 rounded-lg text-12 font-semibold ring-1 ring-inset cursor-pointer ${group === 'all' ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'}`}>All {all.length}</button>
                    {ORDER.filter(g => result.counts[g]).map(g => {
                      const G = GROUPS[g]; return (
                        <button key={g} type="button" onClick={() => setGroup(g)} title={G.hint} className={`h-8 px-3 rounded-lg text-12 font-semibold ring-1 ring-inset cursor-pointer inline-flex items-center gap-1.5 ${group === g ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'}`}><G.icon size={12} /> {G.label} <span className="opacity-60">{result.counts[g]}</span></button>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="relative flex-1 min-w-[180px] max-w-xs"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" /><input className="w-full h-8 pl-8 pr-3 text-12.5 rounded-lg bg-white ring-1 ring-inset ring-slate-200 outline-none focus:ring-indigo-400" placeholder="Filter keywords" value={q} onChange={e => setQ(e.target.value)} /></label>
                    {result.website_checked && <label className="text-12 text-slate-700 flex items-center gap-1.5 cursor-pointer"><input type="checkbox" className="accent-indigo-600" checked={onlyGaps} onChange={e => setOnlyGaps(e.target.checked)} /> Only content gaps</label>}
                    {group !== 'all' && <span className="text-11.5 text-slate-500">{GROUPS[group].hint}</span>}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-13 min-w-[640px]">
                    <thead className="bg-slate-50 text-11   text-slate-500">
                      <tr>
                        <th className="pl-6 pr-2 py-2.5 w-8"><input type="checkbox" className="accent-indigo-600" aria-label="Select all" checked={selectable.length > 0 && selectable.every(k => selected.includes(k.keyword))} onChange={e => setSelected(e.target.checked ? selectable.map(k => k.keyword) : [])} /></th>
                        <th className="px-2 py-2.5 text-left font-semibold">Keyword</th>
                        <th className="px-2 py-2.5 text-left font-semibold">{live ? 'Searches / mo' : 'Demand'}</th>
                        {live && <th className="px-2 py-2.5 text-left font-semibold">Difficulty</th>}
                        <th className="px-2 py-2.5 text-left font-semibold">Your website</th>
                        <th className="px-2 pr-6 py-2.5 text-right font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {shown.slice(0, 300).map(k => {
                        const G = GROUPS[k.group];
                        const isTracked = k.tracked || trackedSet.has(k.keyword);
                        const [dl, dt] = kd(k.difficulty);
                        return (
                          <tr key={k.keyword} className={selected.includes(k.keyword) ? 'bg-indigo-50/50' : 'hover:bg-slate-50'}>
                            <td className="pl-6 pr-2 py-2"><input type="checkbox" className="accent-indigo-600" disabled={isTracked} checked={selected.includes(k.keyword)} onChange={() => setSelected(s => (s.includes(k.keyword) ? s.filter(x => x !== k.keyword) : [...s, k.keyword]))} aria-label={`Select ${k.keyword}`} /></td>
                            <td className="px-2 py-2">
                              <div className="text-slate-900" title={k.from_competitors || undefined}>{k.keyword}</div>{k.from_competitors && <div className="text-11 text-rose-700">{k.from_competitors}</div>}
                              <div className="mt-0.5 flex items-center gap-1.5"><span className={`text-10.5 font-semibold px-1.5 py-px rounded ring-1 ring-inset inline-flex items-center gap-1 ${G.tone}`}><G.icon size={10} /> {G.label}</span><span className="text-10.5 text-slate-400">{k.intent}</span></div>
                            </td>
                            <td className="px-2 py-2">
                              {live && k.volume != null ? (
                                <span className="tabular-nums text-slate-900">{fmt(k.volume)}{k.trend != null && k.trend !== 0 && <span className={`ml-1.5 text-11 font-semibold inline-flex items-center ${k.trend > 0 ? 'text-emerald-700' : 'text-red-600'}`}>{k.trend > 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}{Math.abs(k.trend)}%</span>}</span>
                              ) : <Stars n={k.stars} />}
                            </td>
                            {live && <td className="px-2 py-2">{k.difficulty != null ? <Badge tone={dt}>{dl} · {k.difficulty}</Badge> : '—'}</td>}
                            <td className="px-2 py-2"><Coverage c={k.coverage} /></td>
                            <td className="px-2 pr-6 py-2 text-right whitespace-nowrap">
                              {isTracked ? <span className="text-11.5 text-emerald-700 font-medium">{k.rank ? `Rank ${k.rank}` : 'Tracked'}</span>
                                : <button type="button" onClick={() => track([k])} className="text-11.5 font-semibold text-indigo-700 hover:underline cursor-pointer">Track</button>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {!shown.length && <div className="py-10 text-center text-13 text-slate-500">{all.length ? 'No keywords match these filters.' : 'Google had no suggestions for these services. Try broader service names.'}</div>}
                </div>
              </Card>
            </div>

            <div className="space-y-5 min-w-0">
              {result.website_checked && (
                <Card title="Pages to create" subtitle="Searches with no page on the site yet">
                  {gaps.length ? (
                    <ul className="space-y-2">
                      {gaps.map(k => <li key={k.keyword} className="flex items-start gap-2 text-12.5"><AlertTriangle size={13} className="text-red-500 mt-0.5 shrink-0" /><span className="flex-1 text-slate-800">{k.keyword}</span><Stars n={k.stars} /></li>)}
                    </ul>
                  ) : <div className="text-12.5 text-emerald-700 flex items-center gap-1.5"><CheckCircle2 size={14} /> The site covers the main service and local searches.</div>}
                  {gaps.length > 0 && <Link to="/website-builder" className="mt-3 inline-flex items-center gap-1 text-12 font-semibold text-indigo-700 hover:underline">Build pages in Website Builder <ExternalLink size={11} /></Link>}
                </Card>
              )}
              {questions.length > 0 && (
                <Card title="Questions customers ask" subtitle="Answer them in FAQs, Google Q&A and blog posts">
                  <ul className="space-y-2">{questions.map(k => <li key={k.keyword} className="flex items-start gap-2 text-12.5"><HelpCircle size={13} className="text-violet-500 mt-0.5 shrink-0" /><span className="flex-1 text-slate-800">{k.keyword}?</span></li>)}</ul>
                  <Link to="/ai-content-generation" className="mt-3 inline-flex items-center gap-1 text-12 font-semibold text-indigo-700 hover:underline">Write answers in AI Content Studio <ExternalLink size={11} /></Link>
                </Card>
              )}
            </div>
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

const PLANNER_COLS = [
  { id: 'keyword', label: 'Keyword', align: 'left' },
  { id: 'avg_monthly_searches', label: 'Searches / mo', align: 'right' },
  { id: 'trend', label: '12-mo trend', align: 'left', sortable: false },
  { id: 'three_month_change', label: '3-mo', align: 'right' },
  { id: 'yoy_change', label: 'YoY', align: 'right' },
  { id: 'competition_index', label: 'Competition', align: 'left' },
  { id: 'high_top_of_page_bid', label: 'Top-of-page bid', align: 'right' }
];

function GooglePlanner({ b, tracked, onTracked }) {
  const serviceSeeds = useMemo(() => [...new Set((b.services || []).map(s => String(s?.name || s || '').trim().toLowerCase()).filter(Boolean))].slice(0, 6), [b.services]);
  const [keyword, setKeyword] = useState(serviceSeeds[0] || '');
  const [limit, setLimit] = useState(50);
  const [includeMonthly, setIncludeMonthly] = useState(true);
  const [data, setData] = useState(null);
  const [notFound, setNotFound] = useState('');
  const [focus, setFocus] = useState(null);
  const [q, setQ] = useState('');
  const [comp, setComp] = useState('all');
  const [sort, setSort] = useState({ key: 'avg_monthly_searches', dir: 'desc' });
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

  const trackedSet = new Set(tracked.map(k => k.keyword));
  const rows = data?.keywords || [];
  const seed = data?.seed_keyword?.toLowerCase();
  const seedRow = rows.find(r => r.keyword.toLowerCase() === seed);
  const focusRow = rows.find(r => r.keyword === focus) || seedRow || rows[0];

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter(r => (comp === 'all' || (COMPETITION[r.competition] ? r.competition : 'UNSPECIFIED') === comp) && (!needle || r.keyword.toLowerCase().includes(needle)));
    const { key, dir } = sort;
    const m = dir === 'asc' ? 1 : -1;
    return [...list].sort((a, c) => {
      const x = a[key], y = c[key];
      if (key === 'keyword') return m * String(x).localeCompare(String(y));
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return m * (x - y);
    });
  }, [rows, q, comp, sort]);

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

  const toggleSort = (key) => setSort(s => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: key === 'keyword' ? 'asc' : 'desc' }));
  const selectable = shown.filter(r => !trackedSet.has(r.keyword));

  const track = (list) => run('track', async () => {
    const body = list.map(r => ({ keyword: r.keyword, volume: r.avg_monthly_searches ?? null, cpc: r.high_top_of_page_bid || null, priority: r.competition === 'LOW' ? 'High' : 'Medium' }));
    const res = await api(`/businesses/${b.id}/keywords`, { method: 'POST', body });
    setSelected([]); onTracked();
    const n = res?.added ?? list.length;
    toast(`${n} keyword${n === 1 ? '' : 's'} added to tracking`);
  });

  const exportCsv = () => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Keyword', 'Avg monthly searches', 'Competition', 'Competition index', 'Top-of-page bid (low)', 'Top-of-page bid (high)', '3-month change %', 'YoY change %'],
      ...shown.map(r => [r.keyword, r.avg_monthly_searches, compOf(r.competition).label, r.competition_index, r.low_top_of_page_bid, r.high_top_of_page_bid, r.three_month_change, r.yoy_change])].map(l => l.map(esc).join(','));
    const href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    Object.assign(document.createElement('a'), { href, download: `keyword-planner-${(data?.seed_keyword || 'ideas').replace(/[^a-z0-9]+/gi, '-')}.csv` }).click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

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
            action={<div className="flex gap-2"><Button size="sm" icon={Download} onClick={exportCsv} disabled={!shown.length}>CSV</Button><Button size="sm" variant="primary" icon={Plus} busy={busy === 'track'} disabled={!selected.length} onClick={() => track(rows.filter(r => selected.includes(r.keyword)))}>Track {selected.length || ''}</Button></div>}>
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
                    {PLANNER_COLS.filter(col => col.id !== 'trend' || data.include_monthly).map(col => (
                      <th key={col.id} className={`px-2 py-2.5 font-semibold whitespace-nowrap text-${col.align}`}>
                        {col.sortable === false ? col.label : (
                          <button type="button" onClick={() => toggleSort(col.id)} className={`inline-flex items-center gap-1 cursor-pointer hover:text-slate-900 ${sort.key === col.id ? 'text-slate-900' : ''}`}>
                            {col.label}{sort.key === col.id && <span aria-hidden="true">{sort.dir === 'desc' ? '↓' : '↑'}</span>}
                          </button>
                        )}
                      </th>
                    ))}
                    <th className="px-2 pr-6 py-2.5 text-right font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shown.map(r => {
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
          </Card>
        </>
      )}
      {toastNode}
    </div>
  );
}

/* ── Tracked & topics ─────────────────────────────────────────────────── */

function Tracked({ b, kw }) {
  const [busy, error, run] = useAction();
  const tracked = kw.data?.keywords || [];
  const update = (k, patch) => run(`u${k.id}`, async () => {
    const out = await api(`/businesses/${b.id}/keywords/${k.id}`, { method: 'PATCH', body: { keyword: k.keyword, ...patch } });
    kw.setData(d => ({ ...d, keywords: d.keywords.map(x => (x.id === k.id ? out : x)) }));
  });
  const [ask, confirmNode] = useDoubleConfirm();
  const remove = (k) => ask({ what: `the keyword “${k.keyword}”`, effect: 'It stops being tracked, and its rank history is no longer shown.', onConfirm: () => run(`d${k.id}`, async () => { await api(`/businesses/${b.id}/keywords/${k.id}`, { method: 'DELETE' }); kw.reload(true); }) });
  const pages = [...new Set(['/', '/services', '/contact', ...(b.services || []).map(s => `/services/${String(s.name || s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')}`), ...tracked.map(k => k.target_url).filter(Boolean)])];
  const mapped = tracked.filter(k => k.target_url).length;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[['Tracked keywords', tracked.length], ['Ranking top 10', tracked.filter(k => k.rank && k.rank <= 10).length], ['Mapped to a page', `${mapped}/${tracked.length}`], ['Monthly searches', tracked.some(k => k.volume) ? fmt(tracked.reduce((s, k) => s + (k.volume || 0), 0)) : '—']].map(([l, v]) => (
          <div key={l} className="ai-glass-card rounded px-4 py-3.5"><div className="text-12 font-semibold text-slate-500">{l}</div><div className="text-24 font-bold text-slate-900 tabular-nums mt-0.5">{v}</div></div>
        ))}
      </div>
      {confirmNode}
      <ErrorNote>{error}</ErrorNote>
      <Card title="Tracked keywords and their pages" subtitle="Give each keyword one target page, so your pages don't compete with each other. Ranks update with each rank scan.">
        {!kw.data ? <SkTable cols={['w-1/3','w-12','w-12','w-12','w-16']} rows={8} /> : !tracked.length ? <div className="py-10 text-center text-13 text-slate-500">No tracked keywords yet. Pick some in Discover.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-13 min-w-[640px]">
              <thead className="text-11   text-slate-500 border-b border-slate-200"><tr><th className="p-2 text-left font-semibold">Keyword</th><th className="p-2 text-right font-semibold">Searches</th><th className="p-2 text-left font-semibold">Target page</th><th className="p-2 text-right font-semibold">Rank</th><th className="p-2 text-left font-semibold">Priority</th><th className="p-2" /></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {tracked.map(k => (
                  <tr key={k.id} className="hover:bg-slate-50">
                    <td className="p-2 text-slate-900">{k.keyword}<div>{k.intent && <Badge tone={INTENT_TONE[k.intent] || 'gray'}>{k.intent}</Badge>}</div></td>
                    <td className="p-2 text-right tabular-nums">{fmt(k.volume)}</td>
                    <td className="p-2"><input list={`pages-${b.id}`} className={`${inputCls} max-w-[260px] ${!k.target_url ? 'ring-1 ring-amber-300' : ''}`} defaultValue={k.target_url || ''} placeholder="— not mapped —" onBlur={e => e.target.value !== (k.target_url || '') && update(k, { target_url: e.target.value || null })} /></td>
                    <td className="p-2 text-right tabular-nums">{k.rank ?? <span className="text-slate-400">—</span>}{k.rank && k.prev_rank && k.prev_rank !== k.rank && <span className={`ml-1 text-11 ${k.prev_rank > k.rank ? 'text-emerald-700' : 'text-red-600'}`}>{k.prev_rank > k.rank ? '▲' : '▼'}{Math.abs(k.prev_rank - k.rank)}</span>}</td>
                    <td className="p-2"><Select className="h-8 px-2 text-12 rounded-lg bg-white ring-1 ring-inset ring-slate-200" value={k.priority} onChange={e => update(k, { priority: e.target.value })}>{['High', 'Medium', 'Low'].map(p => <option key={p}>{p}</option>)}</Select></td>
                    <td className="p-2 text-right"><button type="button" onClick={() => remove(k)} disabled={busy === `d${k.id}`} className="text-slate-400 hover:text-red-600 cursor-pointer" aria-label={`Stop tracking ${k.keyword}`}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id={`pages-${b.id}`}>{pages.map(p => <option key={p} value={p} />)}</datalist>
            <div className="mt-3 flex items-center gap-3 text-12 text-slate-600">{mapped} of {tracked.length} mapped <div className="w-40"><Meter value={mapped} max={Math.max(1, tracked.length)} /></div></div>
          </div>
        )}
      </Card>
    </div>
  );
}

function Topics({ b, kw }) {
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const tracked = kw.data?.keywords || [];
  const cluster = () => run('cluster', async () => { const r = await api(`/businesses/${b.id}/keywords/cluster`, { method: 'POST' }); kw.reload(true); toast(`${r.updated} keywords grouped into topics`); });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-13 text-slate-600">Group tracked keywords into topics; each topic should get one page.</div>
        <Button variant="ai" icon={Sparkles} busy={busy === 'cluster'} disabled={!tracked.length} onClick={cluster}>Group into topics with AI</Button>
      </div>
      <ErrorNote>{error}</ErrorNote>
      {!kw.data ? <SkCard title="Topic clusters" subtitle="Keywords grouped into topics, one page per topic"><SkTable headers={["Keyword", "Volume", "Difficulty", "Rank"]} rows={5} bare /></SkCard> : !kw.data.clusters.length ? <Card><div className="py-10 text-center text-13 text-slate-500">Track some keywords first.</div></Card> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {kw.data.clusters.map(cl => {
            const list = tracked.filter(k => (k.cluster || 'Not grouped') === cl.name);
            const page = list.find(k => k.target_url)?.target_url;
            return (
              <Card key={cl.name} title={cl.name} subtitle={`${cl.keywords} keywords${cl.volume ? ` · ${fmt(cl.volume)} searches / month` : ''}`}>
                <div className="space-y-1.5">{list.slice(0, 8).map(k => <div key={k.id} className="flex items-center gap-2 text-12"><span className="flex-1 truncate text-slate-800">{k.keyword}</span>{k.rank && <span className="tabular-nums text-slate-500">#{k.rank}</span>}</div>)}</div>
                <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2 text-12"><FileText size={13} className="text-slate-400" />{page ? <span className=" text-slate-700 truncate">{page}</span> : <span className="text-amber-700">No page yet</span>}</div>
              </Card>
            );
          })}
        </div>
      )}
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

function KeywordExplorer({ b, tracked = [], onTracked }) {
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

  const search = () => run('search', async () => {
    const q = keyword.trim();
    if (!q) return;
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

  const trackSingle = (kw) => run(`t-${kw}`, async () => {
    await api(`/businesses/${b.id}/keywords`, { method: 'POST', body: [{ keyword: kw }] });
    if (onTracked) onTracked();
    toast(`"${kw}" added to tracking`);
  });

  const trackSelected = () => run('bulk-track', async () => {
    if (!selectedKws.length) return;
    await api(`/businesses/${b.id}/keywords`, {
      method: 'POST',
      body: selectedKws.map(k => ({ keyword: k }))
    });
    if (onTracked) onTracked();
    toast(`${selectedKws.length} keywords added to tracking`);
    setSelectedKws([]);
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

  const toggleSelectAll = () => {
    if (selectedKws.length === filteredResults.length) {
      setSelectedKws([]);
    } else {
      setSelectedKws(filteredResults.map(x => x.keyword));
    }
  };

  const exportCsv = () => {
    if (!filteredResults.length) return;
    const header = ['Keyword', 'Search Volume', 'Intent', 'Competition', 'CPC', 'Difficulty'];
    const rows = filteredResults.map(k => [
      `"${(k.keyword || '').replace(/"/g, '""')}"`,
      k.search_volume || 0,
      k.intent || '',
      k.competition || '',
      k.cpc || 0,
      k.difficulty || 0
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [header.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encoded = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encoded);
    link.setAttribute('download', `keywords_${keyword.trim().replace(/\s+/g, '_')}_${country}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const avgVol = results.length ? Math.round(results.reduce((s, x) => s + (x.search_volume || 0), 0) / results.length) : 0;
  const avgCpc = results.length ? (results.reduce((s, x) => s + (x.cpc || 0), 0) / results.length).toFixed(2) : '0.00';
  const avgDiff = results.length ? Math.round(results.reduce((s, x) => s + (x.difficulty || 0), 0) / results.length) : 0;

  return (
    <div className="space-y-5">
      <Card
        title="Keyword Explorer"
        subtitle="Multi-platform search suggestion engine across Google, YouTube, Bing, Amazon, DuckDuckGo, eBay, and App Stores with volume, competition, CPC, and intent."
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex-1 min-w-[240px]">
              <div className="text-11 font-semibold text-slate-500 mb-1">Seed Keyword</div>
              <input
                className={inputCls}
                placeholder="e.g. digital marketing, dental clinic, travel agency..."
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && search()}
              />
            </label>
            <label>
              <div className="text-11 font-semibold text-slate-500 mb-1">Country</div>
              <input
                className={`${inputCls} w-20 uppercase font-mono`}
                maxLength={2}
                value={country}
                onChange={e => setCountry(e.target.value.toUpperCase())}
              />
            </label>
            <label>
              <div className="text-11 font-semibold text-slate-500 mb-1">Limit</div>
              <Select
                className="h-9 px-2.5 text-12.5 rounded-lg bg-white ring-1 ring-inset ring-slate-200 outline-none focus:ring-indigo-400"
                value={limit}
                onChange={e => setLimit(Number(e.target.value))}
              >
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </Select>
            </label>
            <Button
              variant="primary"
              icon={Search}
              busy={busy === 'search'}
              disabled={!keyword.trim()}
              onClick={search}
            >
              Explore Keywords
            </Button>
          </div>

          <div>
            <div className="text-11 font-semibold text-slate-500 mb-1.5">Platforms to Query:</div>
            <div className="flex flex-wrap gap-1.5">
              {EXPLORER_PLATFORMS.map(p => {
                const active = platforms.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => togglePlatform(p.id)}
                    className={`px-2.5 py-1 rounded-lg text-11.5 font-semibold transition-all cursor-pointer ring-1 ring-inset ${
                      active
                        ? 'bg-indigo-600 text-white ring-indigo-600 shadow-xs'
                        : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <ErrorNote>{error}</ErrorNote>
      </Card>

      {results.length > 0 && (
        <div className="space-y-4">
          {/* Summary KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl bg-white border border-slate-200">
              <div className="text-11 text-slate-500 font-semibold uppercase tracking-wider">Discovered</div>
              <div className="text-18 font-bold text-slate-900 mt-0.5">{results.length} keywords</div>
            </div>
            <div className="p-3.5 rounded-xl bg-white border border-slate-200">
              <div className="text-11 text-slate-500 font-semibold uppercase tracking-wider">Avg Search Volume</div>
              <div className="text-18 font-bold text-indigo-600 mt-0.5">{fmt(avgVol)} /mo</div>
            </div>
            <div className="p-3.5 rounded-xl bg-white border border-slate-200">
              <div className="text-11 text-slate-500 font-semibold uppercase tracking-wider">Avg CPC</div>
              <div className="text-18 font-bold text-emerald-600 mt-0.5">${avgCpc}</div>
            </div>
            <div className="p-3.5 rounded-xl bg-white border border-slate-200">
              <div className="text-11 text-slate-500 font-semibold uppercase tracking-wider">Avg Difficulty</div>
              <div className="text-18 font-bold text-amber-600 mt-0.5">{avgDiff} / 100</div>
            </div>
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
                    <th className="p-3 text-left">Keyword</th>
                    <th className="p-3 text-left">12m Trend</th>
                    <th className="p-3 text-right">Volume</th>
                    <th className="p-3 text-center">Intent</th>
                    <th className="p-3 text-center">Competition</th>
                    <th className="p-3 text-right">CPC</th>
                    <th className="p-3 text-center">Difficulty</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredResults.map((item, idx) => {
                    const isTracked = trackedSet.has((item.keyword || '').toLowerCase());
                    const isSelected = selectedKws.includes(item.keyword);
                    const intentKey = (item.intent || '').toLowerCase();
                    return (
                      <tr key={idx} className={`hover:bg-slate-50/80 transition-colors ${isSelected ? 'bg-indigo-50/40' : ''}`}>
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
          </Card>
        </div>
      )}
      {toastNode}
    </div>
  );
}

function Keywords({ b, tab }) {
  const kw = useApi(`/businesses/${b.id}/keywords`);
  const tracked = kw.data?.keywords || [];
  return (
    <>
      {tab === 'discover' && <Discover b={b} tracked={tracked} onTracked={() => kw.reload(true)} />}
      {tab === 'planner' && <GooglePlanner b={b} tracked={tracked} onTracked={() => kw.reload(true)} />}
      {tab === 'explorer' && <KeywordExplorer b={b} tracked={tracked} onTracked={() => kw.reload(true)} />}
      {tab === 'tracked' && <Tracked b={b} kw={kw} />}
      {tab === 'topics' && <Topics b={b} kw={kw} />}
    </>
  );
}

export default function KeywordResearchPage() {
  const [tab, setTab] = useUrlTab('discover', ['discover', 'planner', 'explorer', 'tracked', 'topics']);
  return (
    <SeoShell title="Keyword Intelligence" subtitle="Real searches for this business's services and area: local, near me, questions and fresh searches, checked against the website">
      {(b) => (
        <>
          <Tabs value={tab} onChange={setTab} tabs={[{ id: 'discover', label: 'Discover' }, { id: 'planner', label: 'Google Planner' }, { id: 'explorer', label: 'Keyword Explorer' }, { id: 'tracked', label: 'Tracked & pages' }, { id: 'topics', label: 'Topics' }]} />
          <Keywords key={b.id} b={b} tab={tab} />
        </>
      )}
    </SeoShell>
  );
}
