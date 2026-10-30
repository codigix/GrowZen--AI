import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, Plus, Sparkles, FileText, Trash2, Loader2, MapPin, Globe, Users, X, Star, CheckCircle2, CircleDashed, AlertTriangle, Copy, Check, BarChart2,
  TrendingUp, TrendingDown, Download, Flame, HelpCircle, Navigation, Tag, Wrench, ExternalLink, ArrowLeft
} from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { SeoShell, Card, Tabs, Badge, Button, inputCls, Meter, ErrorNote, useToast, useAction, useUrlTab } from './SeoUi';
import { api, useApi, fmtDateTime, fmt, SEO_API } from './seoApi';
import { pathOnly as pathOf } from './siteUtils';

/**
 * Keyword intelligence for the selected business. Discovery starts from what the platform knows
 * (category, services, area + nearby localities, the website audit, competitors) and pulls real
 * searches from Google Autocomplete; DataForSEO adds volumes and trends when it is connected.
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
  const live = result?.data_source?.includes('dataforseo');
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
                subtitle={live ? 'Real searches from Google Autocomplete, with monthly volume and 12-month trend from Google Ads (DataForSEO).' : 'Real searches from Google Autocomplete. Stars show how strongly Google suggests each one. Connect DataForSEO for monthly volumes.'}
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

/* ── Google Trends ────────────────────────────────────────────────────── */

const TREND_TIMEFRAMES = [
  { id: 'past_day', label: 'Past day' },
  { id: 'past_7_days', label: 'Past 7 days' },
  { id: 'past_30_days', label: 'Past 30 days' },
  { id: 'past_90_days', label: 'Past 90 days' },
  { id: 'past_12_months', label: 'Past 12 months' }
];

function GoogleTrends({ b, tracked, onTracked }) {
  const [keyword, setKeyword] = useState('');
  const [country, setCountry] = useState('IN');
  const [timeframe, setTimeframe] = useState('past_30_days');
  const [trend, setTrend] = useState(null);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();

  const trackedSet = new Set(tracked.map(k => k.keyword));

  const search = () => run('search', async () => {
    const q = keyword.trim().toLowerCase();
    if (!q) return;
    const qs = `keyword=${encodeURIComponent(q)}&country=${encodeURIComponent(country)}&timeframe=${timeframe}`;
    const t = await api(`/keyword-trends/planner?${qs}&limit=20&regional_limit=10`);
    setTrend(t);
  });

  const track = (kw) => run(`t-${kw}`, async () => {
    await api(`/businesses/${b.id}/keywords`, { method: 'POST', body: [{ keyword: kw }] });
    onTracked(); toast(`"${kw}" added to tracking`);
  });

  const chartData = (trend?.interest_over_time || []).map(p => ({ date: p.date, value: p.value }));
  const avg = chartData.length ? Math.round(chartData.reduce((s, p) => s + p.value, 0) / chartData.length) : null;
  const peak = chartData.length ? Math.max(...chartData.map(p => p.value)) : null;

  return (
    <div className="space-y-5">
      <Card title="Google Trends" subtitle="Live search interest and related queries from Google Trends.">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-[220px]">
            <div className="text-11 font-semibold   text-slate-500 mb-1">Keyword</div>
            <input className={inputCls} placeholder="e.g. seo services" value={keyword} onChange={e => setKeyword(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} />
          </label>
          <label>
            <div className="text-11 font-semibold   text-slate-500 mb-1">Country</div>
            <input className={`${inputCls} w-20 `} maxLength={2} value={country} onChange={e => setCountry(e.target.value.toUpperCase())} />
          </label>
          <label>
            <div className="text-11 font-semibold   text-slate-500 mb-1">Timeframe</div>
            <select className="h-9 px-2.5 text-12.5 rounded-lg bg-white ring-1 ring-inset ring-slate-200 outline-none focus:ring-indigo-400" value={timeframe} onChange={e => setTimeframe(e.target.value)}>
              {TREND_TIMEFRAMES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <Button variant="primary" icon={Search} busy={busy === 'search'} disabled={!keyword.trim()} onClick={search}>Search</Button>
        </div>
        <ErrorNote>{error}</ErrorNote>
      </Card>

      {trend && (
        <div className="space-y-5">
          <Card title={`Interest over time: "${trend.seed_keyword}"`} subtitle={`${trend.country} · ${TREND_TIMEFRAMES.find(t => t.id === timeframe)?.label}`}>
            {chartData.length > 1 ? (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} minTickGap={24} />
                    <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} domain={[0, 100]} />
                    <Tooltip />
                    <Line type="monotone" dataKey="value" name="Interest" stroke="#4f46e5" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : <div className="py-10 text-center text-13 text-slate-500">Not enough data for this keyword.</div>}
            <div className="mt-3 flex gap-4 text-12 text-slate-600">
              {avg != null && <span>Average interest: <span className="font-semibold text-slate-900">{avg}</span></span>}
              {peak != null && <span>Peak: <span className="font-semibold text-slate-900">{peak}</span></span>}
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card title="Top queries" subtitle="Most-searched related queries, scored 0-100 relative to the top one">
              {trend.related_keywords?.length ? (
                <>
                  <div className="flex items-center gap-2 pb-2 mb-1 border-b border-slate-100 text-10.5 font-semibold   text-slate-400">
                    <span className="flex-1">Query</span>
                    <span className="w-8 text-right">Interest</span>
                    <span className="w-16 text-right">Change</span>
                    <span className="w-14 text-right"> </span>
                  </div>
                  <ul className="space-y-2">
                    {trend.related_keywords.map(r => {
                      const isTracked = trackedSet.has(r.keyword);
                      const pct = /^[+-]\d+%$/.test(r.growth_indicator || '') ? parseInt(r.growth_indicator, 10) : null;
                      return (
                        <li key={r.keyword} className="flex items-center gap-2 text-12.5">
                          <span className="flex-1 text-slate-800">{r.keyword}</span>
                          <span className="tabular-nums text-slate-500 w-8 text-right">{r.score}</span>
                          <span className="w-16 text-right">
                            {r.growth_indicator === 'Breakout' ? <Badge tone="blue">Breakout</Badge>
                              : pct != null ? (
                                <span className={`inline-flex items-center gap-0.5 text-11 font-semibold tabular-nums ${pct >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                                  {pct >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}{Math.abs(pct)}%
                                </span>
                              ) : <span className="text-slate-300">—</span>}
                          </span>
                          <span className="w-14 text-right">
                            {isTracked ? <span className="text-11 text-emerald-700 font-medium">Tracked</span>
                              : <button type="button" onClick={() => track(r.keyword)} disabled={busy === `t-${r.keyword}`} className="text-11.5 font-semibold text-indigo-700 hover:underline cursor-pointer">Track</button>}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : <div className="py-6 text-center text-13 text-slate-500">No top queries found.</div>}
            </Card>

            <Card title="Rising queries" subtitle="Queries with the biggest increase in search interest">
              {trend.rising_keywords?.length ? (
                <>
                  <div className="flex items-center gap-2 pb-2 mb-1 border-b border-slate-100 text-10.5 font-semibold   text-slate-400">
                    <span className="flex-1">Query</span>
                    <span className="w-8 text-right" title="Google Trends doesn't provide a 0-100 interest score for rising queries, only the % change">Interest</span>
                    <span className="w-16 text-right">Change</span>
                    <span className="w-14 text-right"> </span>
                  </div>
                  <ul className="space-y-2">
                    {trend.rising_keywords.map(r => {
                      const isTracked = trackedSet.has(r.keyword);
                      const isBreakout = r.growth_indicator === 'Breakout';
                      return (
                        <li key={r.keyword} className="flex items-center gap-2 text-12.5">
                          <span className="flex-1 text-slate-800">{r.keyword}</span>
                          <span className="tabular-nums text-slate-300 w-8 text-right">—</span>
                          <span className="w-16 text-right">
                            {isBreakout ? <Badge tone="blue">Breakout</Badge>
                              : r.growth_indicator ? (
                                <span className="inline-flex items-center gap-0.5 text-11 font-semibold tabular-nums text-emerald-700">
                                  <TrendingUp size={11} />{r.growth_indicator}
                                </span>
                              ) : <span className="text-slate-300">—</span>}
                          </span>
                          <span className="w-14 text-right">
                            {isTracked ? <span className="text-11 text-emerald-700 font-medium">Tracked</span>
                              : <button type="button" onClick={() => track(r.keyword)} disabled={busy === `t-${r.keyword}`} className="text-11.5 font-semibold text-indigo-700 hover:underline cursor-pointer">Track</button>}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : <div className="py-6 text-center text-13 text-slate-500">No rising queries found.</div>}
            </Card>
          </div>

          <Card title="Interest by region" subtitle={`Where "${trend.seed_keyword}" is searched most, relative to its top region (100)`}>
            {trend.regional_interest?.length ? (
              <div className="divide-y divide-slate-100">
                <div className="flex items-center gap-3 pb-2 text-10.5 font-semibold   text-slate-400">
                  <span className="w-5" />
                  <span className="w-44 shrink-0">Region</span>
                  <span className="flex-1">Search interest</span>
                  <span className="w-8" />
                </div>
                {trend.regional_interest.map((r, i) => (
                  <div key={r.region} className={`flex items-center gap-3 py-2.5 ${i % 2 ? '' : 'bg-slate-50/60 -mx-2 px-2 rounded'}`}>
                    <span className="w-5 text-12 text-slate-400 tabular-nums">{i + 1}</span>
                    <span className="w-44 shrink-0 text-13 text-slate-800">{r.region}</span>
                    <div className="flex-1 h-2.5 rounded-full bg-indigo-100 overflow-hidden">
                      <div className="h-full rounded-full bg-indigo-600" style={{ width: `${r.score}%` }} />
                    </div>
                    <span className="w-8 text-right text-12 tabular-nums text-slate-600">{r.score}</span>
                  </div>
                ))}
              </div>
            ) : <div className="py-6 text-center text-13 text-slate-500">No regional data found.</div>}
          </Card>
        </div>
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
  const remove = (k) => run(`d${k.id}`, async () => { await api(`/businesses/${b.id}/keywords/${k.id}`, { method: 'DELETE' }); kw.reload(true); });
  const pages = [...new Set(['/', '/services', '/contact', ...(b.services || []).map(s => `/services/${String(s.name || s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')}`), ...tracked.map(k => k.target_url).filter(Boolean)])];
  const mapped = tracked.filter(k => k.target_url).length;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[['Tracked keywords', tracked.length], ['Ranking top 10', tracked.filter(k => k.rank && k.rank <= 10).length], ['Mapped to a page', `${mapped}/${tracked.length}`], ['Monthly searches', tracked.some(k => k.volume) ? fmt(tracked.reduce((s, k) => s + (k.volume || 0), 0)) : '—']].map(([l, v]) => (
          <div key={l} className="ai-glass-card rounded px-4 py-3.5"><div className="text-12 font-semibold text-slate-500">{l}</div><div className="text-24 font-bold text-slate-900 tabular-nums mt-0.5">{v}</div></div>
        ))}
      </div>
      <ErrorNote>{error}</ErrorNote>
      <Card title="Tracked keywords and their pages" subtitle="Give each keyword one target page, so your pages don't compete with each other. Ranks update with each rank scan.">
        {!kw.data ? <div className="py-10 flex justify-center text-slate-400"><Loader2 size={16} className="animate-spin" /></div> : !tracked.length ? <div className="py-10 text-center text-13 text-slate-500">No tracked keywords yet. Pick some in Discover.</div> : (
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
                    <td className="p-2"><select className="h-8 px-2 text-12 rounded-lg bg-white ring-1 ring-inset ring-slate-200" value={k.priority} onChange={e => update(k, { priority: e.target.value })}>{['High', 'Medium', 'Low'].map(p => <option key={p}>{p}</option>)}</select></td>
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
      {!kw.data ? <div className="py-10 flex justify-center text-slate-400"><Loader2 size={16} className="animate-spin" /></div> : !kw.data.clusters.length ? <Card><div className="py-10 text-center text-13 text-slate-500">Track some keywords first.</div></Card> : (
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
              <select
                className="h-9 px-2.5 text-12.5 rounded-lg bg-white ring-1 ring-inset ring-slate-200 outline-none focus:ring-indigo-400"
                value={limit}
                onChange={e => setLimit(Number(e.target.value))}
              >
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
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
                <select
                  className="h-8 px-2.5 text-11.5 rounded-lg bg-white ring-1 ring-inset ring-slate-200 outline-none focus:ring-indigo-400"
                  value={filterIntent}
                  onChange={e => setFilterIntent(e.target.value)}
                >
                  <option value="ALL">All Intents</option>
                  <option value="INFORMATIONAL">Informational</option>
                  <option value="COMMERCIAL">Commercial</option>
                  <option value="TRANSACTIONAL">Transactional</option>
                  <option value="NAVIGATIONAL">Navigational</option>
                </select>
                <select
                  className="h-8 px-2.5 text-11.5 rounded-lg bg-white ring-1 ring-inset ring-slate-200 outline-none focus:ring-indigo-400"
                  value={filterComp}
                  onChange={e => setFilterComp(e.target.value)}
                >
                  <option value="ALL">All Competition</option>
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                </select>
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
      {tab === 'trends' && <GoogleTrends b={b} tracked={tracked} onTracked={() => kw.reload(true)} />}
      {tab === 'explorer' && <KeywordExplorer b={b} tracked={tracked} onTracked={() => kw.reload(true)} />}
      {tab === 'tracked' && <Tracked b={b} kw={kw} />}
      {tab === 'topics' && <Topics b={b} kw={kw} />}
    </>
  );
}

export default function KeywordResearchPage() {
  const [tab, setTab] = useUrlTab('discover', ['discover', 'trends', 'explorer', 'tracked', 'topics']);
  return (
    <SeoShell title="Keyword Intelligence" subtitle="Real searches for this business's services and area: local, near me, questions and fresh searches, checked against the website">
      {(b) => (
        <>
          <Tabs value={tab} onChange={setTab} tabs={[{ id: 'discover', label: 'Discover' }, { id: 'trends', label: 'Google Trends' }, { id: 'explorer', label: 'Keyword Explorer' }, { id: 'tracked', label: 'Tracked & pages' }, { id: 'topics', label: 'Topics' }]} />
          <Keywords key={b.id} b={b} tab={tab} />
        </>
      )}
    </SeoShell>
  );
}
