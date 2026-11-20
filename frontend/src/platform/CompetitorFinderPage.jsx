import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { KeywordGap, CompareDomains } from './SeoToolkit';
import {
  Users, Search, MapPin, Star, Globe, ExternalLink, Loader2, AlertTriangle, Lightbulb, Plus, X, Link2, FileText, Gauge, Settings2, Play,
  CheckCircle2, Minus, Layers, ArrowRight, BookOpen, Code2, ListChecks, HelpCircle, Sparkles, ShieldCheck, Smartphone, Monitor, RotateCcw, Eye
} from 'lucide-react';
import { SeoShell, Card, Badge, Button, Drawer, Field, Tabs, Modal, inputCls, ErrorNote, useToast, useAction, Sk, SkStats, SkTable, SkCard } from './SeoUi';
import { api, useApi, usePoll, fmt, fmtDateTime } from './seoApi';
import { ComparisonResult } from './CompetitorAuditCompare';
import CompetitorPagesTab from './CompetitorPagesTab';
import MyCompetitors from './MyCompetitors';
import { Act, Head } from './TableBits';

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
const canCompare = (c, a) => Boolean(c?.reg && a && !running(a.status));
const compareHint = (c, a) => !c?.reg ? 'Register it first with Find more on Maps or Add a competitor'
  : !a ? 'Audit this competitor first' : running(a.status) ? 'Wait for the audit to finish' : 'Compare its audit with your site';
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

/** A table that scrolls inside the page instead of making the page long. */
const Table = ({ head, children, className = '' }) => (
  <div className={`overflow-auto max-h-[calc(100vh-270px)] min-h-[320px] ${className}`}>
    <table className="w-full text-13">
      <thead className="sticky top-0 z-10 bg-slate-50 text-left text-11.5  tracking-wide text-slate-500 shadow-[0_1px_0_0_theme(colors.slate.200)]"><tr>{head}</tr></thead>
      <tbody className="divide-y divide-slate-100">{children}</tbody>
    </table>
  </div>
);
const Th = ({ children, c = 'text-left', cls = '' }) => <th className={`px-4 py-2.5 font-semibold whitespace-nowrap ${c} ${cls}`}>{children}</th>;

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
        <Field label="Search from" hint="City Google searches from"><input className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Pune, India" /></Field>
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

export function CompetitorsTable({ rows, r, strategy, setStrategy, auditMap, ourAudit, onAuditOur, hasSite, onDetail, onAudit, onCompare, comparing, onFindMaps, findBusy, onAddManual, addBusy, addError, onChoose }) {
  const isChosen = (c) => Boolean(c.reg) && c.reg.selected !== false;
  const chosenCount = rows.filter(isChosen).length;
  const [view, setView] = useState('all'); // all | chosen | others
  const [adding, setAdding] = useState(false);
  const ordered = [...rows].sort((x, y) => Number(isChosen(y)) - Number(isChosen(x))); // chosen competitors on top (the order inside each group is kept)
  const shown = view === 'chosen' ? ordered.filter(isChosen) : view === 'others' ? ordered.filter(c => !isChosen(c)) : ordered;
  return (
    <Card pad={false}>
      <div className="px-4 py-2 border-b border-slate-200 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="text-13 font-semibold text-slate-900">{rows.length} found, {chosenCount} chosen <span className="font-normal text-slate-500 hidden xl:inline">· tick 3 to 5 that really compete with you</span></div>
        <div className="flex gap-0.5 p-0.5 bg-slate-100 rounded-lg" role="tablist" aria-label="Show">
          {[['all', `All ${rows.length}`], ['chosen', `Chosen ${chosenCount}`], ['others', `Not chosen ${rows.length - chosenCount}`]].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)} className={`h-7 px-2.5 text-11.5 font-semibold rounded-md cursor-pointer ${view === id ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800'}`}>{label}</button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex gap-0.5 p-0.5 bg-slate-100 rounded-lg">
            {[['mobile', Smartphone], ['desktop', Monitor]].map(([s, I]) => (
              <button key={s} type="button" onClick={() => setStrategy(s)} className={`h-7 px-2.5 flex items-center gap-1 text-11.5 font-semibold rounded-md cursor-pointer transition-colors ${strategy === s ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500'}`}><I size={12} />{s}</button>
            ))}
          </div>
          <span className="text-12 text-slate-500 inline-flex items-center gap-1.5" title="Your own site's audit, used for every comparison">
            {ourAudit && running(ourAudit.status) && <Loader2 size={12} className="animate-spin" />}Your site: {ourAudit ? AUDIT_LABEL[ourAudit.status] || '—' : 'not audited'}
          </span>
          <Button size="sm" variant="secondary" icon={RotateCcw} disabled={!hasSite || running(ourAudit?.status)} onClick={onAuditOur}>Audit our site</Button>
          <Button size="sm" variant="secondary" icon={MapPin} busy={findBusy} onClick={onFindMaps}>Find more on Maps</Button>
          <Button size="sm" variant="secondary" icon={Plus} onClick={() => setAdding(v => !v)} aria-expanded={adding}>{adding ? 'Hide add form' : 'Add a competitor'}</Button>
        </div>
      </div>
      {adding && <AddCompetitorForm onAdd={onAddManual} busy={addBusy} error={addError} />}
      <Table head={<>
        <Th c="text-center"><Head what="Tick the competitors that really compete with you (3 to 5)." why="Only the chosen ones are watched and used by Competitor Watch, the keyword workspace and the backlink gap.">Choose</Head></Th>
        <Th><Head what="A business that ranks for your keywords on Google Maps or Google." why="Click the name for its full profile." from="Google Maps (Places) results and the competitors you added.">Competitor</Head></Th>
        <Th><Head what="How well it matches your business on similar services, area, keywords, Google presence, intent and authority." from="the competitor research (Google Maps data and AI).">Match</Head></Th>
        <Th c="text-right"><Head right what="The share of Google clicks it could expect for your keywords, based on where it ranks." from="the competitor research (Google results). Your own figure comes from Search Console.">Google visibility</Head></Th>
        <Th c="text-right"><Head right what="How many of your researched keywords it shows on page 1 of Google for." from="the competitor research.">Page-1 keywords</Head></Th>
        <Th c="text-center"><Head what="Its best position in the Google Maps results and its rating." from="Google Maps (Places).">Maps</Head></Th>
        <Th><Head what="Whether its website has been audited (speed and a page crawl)." why="Needed before you can compare it with your site." from="the site audit run from this page.">Site audit</Head></Th>
        <Th c="text-right"><Head right what="Audit runs the site audit on its website. Compare shows it side by side with yours." from="the audits of its site and yours.">Actions</Head></Th></>}>
        {shown.map(c => {
          const a = auditMap[c.reg?.id];
          return (
            <tr key={c.host} className={isChosen(c) ? 'bg-emerald-50/40 hover:bg-emerald-50/70' : 'hover:bg-slate-50'}>
              <td className="px-3 py-2.5 text-center"><input type="checkbox" aria-label={`Choose ${c.name}`} checked={isChosen(c)} onChange={() => onChoose({ ...(c.reg || {}), id: c.reg?.id, name: c.name, website: c.website }, !isChosen(c))} className="w-4 h-4 cursor-pointer accent-indigo-600" /></td>
              <td className="px-3 py-2.5 min-w-[200px]">
                <button type="button" onClick={() => onDetail(c)} className="text-left cursor-pointer group max-w-[280px]">
                  <span className="block font-semibold text-slate-900 group-hover:text-indigo-700 truncate">{c.name}</span>
                  <span className="block text-12 text-slate-500 truncate">{c.host}</span>
                </button>
              </td>
              <td className="px-3 py-2.5">{c.maps?.relevance ? <MatchCell rel={c.maps.relevance} /> : <span className="text-slate-400 text-12" title="Added by hand, or found before the match rating existed">—</span>}</td>
              <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{c.profile ? `${c.profile.visibility}%` : c.maps ? `${c.maps.visibility}%` : '—'}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{c.profile ? `${Object.keys(c.profile.positions).length}/${r.keywords.length}` : c.maps ? `${c.maps.appearances}/${r.keywords.length} Maps` : '—'}</td>
              <td className="px-3 py-2.5 text-center">{c.profile?.local ? <span className="inline-flex items-center gap-1.5"><Pos value={c.profile.local.best} maps /><Stars rating={c.profile.local.rating} /></span> : c.maps ? <span className="inline-flex items-center gap-1.5"><Pos value={c.maps.best} maps /><Stars rating={c.maps.rating} /></span> : (c.reg?.rating ? <Stars rating={c.reg.rating} reviews={c.reg.reviews} /> : <span className="text-slate-400">—</span>)}</td>
              <td className="px-3 py-2.5 whitespace-nowrap text-12.5">
                {!c.reg ? <span className="text-slate-400" title={c.website ? 'Press Audit: it is saved as a competitor and its site is audited' : 'No website: Audit reads its Google Maps listing instead'}>Not audited{!c.website && c.maps ? ' · no website' : ''}</span>
                  : a ? <span className={`inline-flex items-center gap-1.5 ${a.status === 'failed' ? 'text-red-600' : a.status === 'done' ? 'text-emerald-700' : 'text-slate-500'}`}>{running(a.status) && <Loader2 size={12} className="animate-spin" />}{AUDIT_LABEL[a.status] || a.status}{a.listing && a.score != null ? ` · ${a.score}/100` : ''}{a.listing && <span className="font-normal text-slate-400" title="No website: read from its Google Maps listing">Google listing</span>}</span>
                    : <span className="text-slate-400">Not audited</span>}
              </td>
              <td className="px-3 py-2.5 text-right whitespace-nowrap">
                <div className="inline-flex gap-1.5">
                  <Act icon={Gauge} tone="teal" disabled={(!c.website && !c.maps) || running(a?.status)} onClick={() => onAudit(c.reg || c)} tip={c.reg ? `${a ? 'Re-audit' : 'Audit'}: run PageSpeed and a page crawl on their site.` : 'Audit: save it as a competitor first (choose it), then audit its site.'} />
                  <Act icon={ShieldCheck} tone="indigo" busy={comparing === c.reg?.id} disabled={!canCompare(c, a)} onClick={() => onCompare(c.reg)} tip={`Compare: ${compareHint(c, a) || 'show its site next to yours.'}`} />
                </div>
              </td>
            </tr>
          );
        })}
        {!shown.length && <tr><td colSpan={8} className="px-5 py-10 text-center text-13 text-slate-500">{rows.length ? (view === 'chosen' ? 'None chosen yet: tick the competitors that really compete with you.' : 'Nothing here.') : 'No competitors yet.'}</td></tr>}
      </Table>
    </Card>
  );
}

function KeywordsTab({ r, onKeyword, onIdeas }) {
  const cols = r.profiles.slice(0, 3);
  return (
    <Card pad={false}>
      <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-3">
        <div className="text-13 font-semibold text-slate-900">{r.keywords.length} keywords <span className="font-normal text-slate-500">· click a row for the full Google and Maps results</span></div>
        <Button size="sm" className="ml-auto" icon={Lightbulb} onClick={onIdeas}>Keyword ideas ({r.ideas.competitor_keywords.length + r.ideas.questions.length + r.ideas.related.length})</Button>
      </div>
      <Table head={<><Th>Keyword</Th><Th c="text-center">You · Google</Th><Th c="text-center">You · Maps</Th>{cols.map(p => <Th key={p.domain} c="text-center" cls="normal-case max-w-[120px] truncate">{p.domain}</Th>)}<Th>#1 on Google</Th></>}>
        {r.serps.map(s => (
          <tr key={s.keyword} className={`cursor-pointer hover:bg-slate-50 ${!s.you_organic ? 'bg-rose-50/30' : ''}`} onClick={() => onKeyword(s)}>
            <td className="px-4 py-2.5 font-semibold text-slate-900">{s.keyword}</td>
            <td className="px-4 py-2.5 text-center"><Pos value={s.you_organic} /></td>
            <td className="px-4 py-2.5 text-center"><Pos value={s.you_local} maps /></td>
            {cols.map(p => <td key={p.domain} className="px-4 py-2.5 text-center"><Pos value={p.positions?.[s.keyword]} /></td>)}
            <td className="px-4 py-2.5 text-slate-600 truncate max-w-[200px]">{s.organic[0]?.domain || '—'}</td>
          </tr>
        ))}
      </Table>
      <div className="px-5 py-2.5 border-t border-slate-200 flex flex-wrap gap-3 text-11.5 text-slate-500">
        <span className="inline-flex items-center gap-1.5"><Pos value={1} /> top 3</span><span className="inline-flex items-center gap-1.5"><Pos value={7} /> page 1</span><span className="inline-flex items-center gap-1.5"><Pos /> not in the results</span>
      </div>
    </Card>
  );
}

const CRITERIA = [
  ['services', 'Similar services', 'Very high', 'Do they sell what you sell (a clothes rental is not a clothes shop)'],
  ['area', 'Target area', 'Very high', 'The same customers: distance from your pin'],
  ['keywords', 'Keyword overlap', 'Very high', 'Do they appear for the same searches'],
  ['serp', 'Google presence', 'Very high', 'How high they rank on Google Maps for those searches'],
  ['intent', 'Search intent', 'High', 'Would a customer be happy with either (rent versus buy)'],
  ['authority', 'Domain authority', 'Medium', 'Strength of their website: never decides relevance alone']
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
export function ListingComparison({ c }) {
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
          <div><div className="text-11.5 font-semibold text-rose-700 mb-1">Only they target (a gap for you)</div><Chips items={c.keywords.only_them} tone="rose" empty="No gap found." /></div>
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
      <p className="mt-1 text-11.5 text-slate-500">{kit.ourAudit?.status === 'done' ? 'Your site is audited.' : kit.hasSite ? 'Your own site is audited too, so there is something to compare with.' : 'Add your website to the project to compare site audits.'}{noSite > 0 ? ` ${noSite} without a website ${noSite === 1 ? 'is' : 'are'} read from the Google Maps listing.` : ''}</p>
      {sc?.error && <p className="mt-2 text-13 text-red-600" role="alert">{sc.error}</p>}
      {metrics.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
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
  return (
    <div className="space-y-4">
    <HowChosen r={r} />
    {kit && <MapsAudit r={r} kit={kit} />}
    {r.local_competitors.length === 0 && <Card><p className="text-13 text-slate-600">No real competitor was found on Google Maps for these searches. {r.other_places?.length ? 'The businesses that came up sell something different: see the list below.' : ''}</p></Card>}
    <Card pad={false}>
      {nearOnly && <p className="px-4 py-2.5 border-b border-slate-100 text-12.5 text-slate-600">Only businesses within about 4 km of {r.business.name} are counted: the ones its customers can actually choose between.</p>}
      <Table head={<><Th>Business</Th><Th>Match</Th>{kit && <Th>Site audit</Th>}<Th c="text-right">Distance</Th><Th c="text-right">Visibility</Th><Th c="text-center">Best</Th><Th c="text-right">In results</Th><Th>Rating</Th><Th cls="w-44">Reviews</Th><Th>Website</Th></>}>
        {rows.map(e => (
          <tr key={e.name} className={e.mine ? 'bg-emerald-50/50' : 'hover:bg-slate-50'}>
            <td className="px-4 py-2.5"><div className={`font-medium ${e.mine ? 'text-emerald-800' : 'text-slate-900'}`}>{e.name}</div>{e.category && <div className="text-12 text-slate-500">{e.category}</div>}{e.relevance?.reason && <div className="text-11.5 text-slate-400 max-w-[320px]">{e.relevance.reason}</div>}</td>
            <td className="px-4 py-2.5">{e.mine ? <Badge tone="green">You</Badge> : <MatchCell rel={e.relevance} />}</td>
            {kit && <td className="px-4 py-2.5">{e.mine ? <span className="text-slate-400">—</span> : (() => {
              const reg = kit.registered.find(c => (e.website ? hostOf(c.website) === (e.domain || hostOf(e.website)) : (c.place_id && c.place_id === e.cid) || (!c.website && c.name === e.name)));
              const a = reg && kit.auditMap[reg.id];
              if (!reg) return <Button size="sm" icon={Gauge} onClick={() => kit.onAudit(e)} title={e.website ? 'Saves it as a competitor and audits its site' : 'No website: reads its Google listing and works out its services and keywords'}>Audit</Button>;
              return (
                <div className="flex flex-col gap-1 min-w-[120px]">
                  <span className={`text-12 font-semibold ${a?.status === 'done' ? 'text-emerald-700' : a?.status === 'failed' ? 'text-red-600' : running(a?.status) ? 'text-indigo-600' : 'text-slate-400'}`}>{a ? (SCORE_WORD[a.status] || a.status) + (a.listing && a.score != null ? ` · ${a.score}/100` : '') : 'Not audited'}{a?.listing ? <span className="font-normal text-slate-400"> · Google listing</span> : null}</span>
                  <span className="flex gap-1.5">
                    <Button size="sm" icon={Gauge} disabled={running(a?.status)} onClick={() => kit.onAudit(reg)}>{a ? 'Re-audit' : 'Audit'}</Button>
                    <Button size="sm" icon={ShieldCheck} busy={kit.comparing === reg.id} disabled={a?.status !== 'done' || (!a?.listing && kit.ourAudit?.status !== 'done')} onClick={() => kit.onCompare(reg)} title={a?.status !== 'done' ? 'Audit this competitor first' : !a?.listing && kit.ourAudit?.status !== 'done' ? 'Audit your own site first' : 'Compare it with your business'}>Compare</Button>
                  </span>
                </div>
              );
            })()}</td>}
            <td className="px-4 py-2.5 text-right tabular-nums text-slate-600" title="Straight-line distance from your business">{e.mine ? '' : e.distance_m == null ? '—' : e.distance_m < 1000 ? `${e.distance_m} m` : `${(e.distance_m / 1000).toFixed(1)} km`}</td>
            <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{e.visibility}%</td>
            <td className="px-4 py-2.5 text-center"><Pos value={Number.isFinite(e.best) ? e.best : null} maps /></td>
            <td className="px-4 py-2.5 text-right tabular-nums">{e.appearances}/{r.keywords.length}</td>
            <td className="px-4 py-2.5"><Stars rating={e.rating} /></td>
            <td className="px-4 py-2.5"><div className="flex items-center gap-2" title={`${fmt(e.reviews)} reviews`}><span className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><span className={`block h-full rounded-full ${e.mine ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${((e.reviews || 0) / maxReviews) * 100}%` }} /></span><span className="w-12 text-right tabular-nums text-slate-700">{fmt(e.reviews)}</span></div></td>
            <td className="px-4 py-2.5">{e.website ? <a href={e.website} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline inline-flex items-center gap-1"><Globe size={12} />{e.domain || 'site'}</a> : <span className="text-slate-400">{e.mine ? '' : 'None'}</span>}</td>
          </tr>
        ))}
      </Table>
    </Card>
    <OtherPlaces r={r} />
    </div>
  );
}

function ListingsTab({ r, setupInfo }) {
  const cols = [{ key: 'you', label: 'You', sources: r.you.link_sources }, ...r.profiles.map(p => ({ key: p.domain, label: p.domain, sources: p.link_sources }))];
  const sites = [...new Set(cols.flatMap(c => c.sources.map(s => baseSite(s.domain))))];
  const count = (site) => cols.slice(1).filter(c => c.sources.some(s => baseSite(s.domain) === site)).length;
  sites.sort((a, b) => count(b) - count(a));
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
        <Table head={<><Th>Site</Th>{cols.map(c => <Th key={c.key} c="text-center" cls={`normal-case max-w-[120px] truncate ${c.key === 'you' ? 'text-emerald-700' : ''}`}>{c.label}</Th>)}</>}>
          {sites.map(site => {
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
      <Table head={<><Th cls="w-10">#</Th><Th>Action</Th><Th>Priority</Th><Th>Why</Th><Th c="text-right"> </Th></>}>
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
        <Button icon={Gauge} disabled={!c.reg || running(a?.status)} onClick={() => onAudit(c.reg)}>{a ? 'Re-audit site' : 'Audit site'}</Button>
        <Button variant="primary" icon={ShieldCheck} disabled={!canCompare(c, a)} title={compareHint(c, a)} onClick={() => { onClose(); onCompare(c.reg); }}>Compare with my site</Button>
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
    <Modal open={Boolean(s)} onClose={onClose} width="max-w-4xl" title={s ? `“${s.keyword}”` : ''}>
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
      footer={<Link to="/keyword-management" className="inline-flex items-center gap-1.5 text-13 font-semibold text-indigo-700 hover:underline">Step 2: find keywords <ArrowRight size={14} /></Link>}>
      <div className="max-h-[66vh] overflow-y-auto pr-1 space-y-5">
        <div><Label icon={Search}>Keywords competitors target</Label><Chips items={r.ideas.competitor_keywords} empty="None found." /></div>
        <div><Label icon={HelpCircle}>Questions people ask</Label>{r.ideas.questions.length ? <ul className="space-y-1.5">{r.ideas.questions.map(q => <li key={q} className="flex gap-2 text-13 text-slate-700"><HelpCircle size={14} className="text-violet-500 mt-0.5 shrink-0" />{q}</li>)}</ul> : <p className="text-13 text-slate-500">Google showed no questions for these searches.</p>}</div>
        <div><Label icon={Sparkles}>Related searches</Label><Chips items={r.ideas.related} empty="Google showed no related searches." /></div>
      </div>
    </Modal>
  );
}

export function CompareModal({ state, onClose }) {
  return (
    <Modal open={Boolean(state)} onClose={onClose} width="max-w-5xl" title={state ? `Compare with ${state.competitor.name}` : ''}>
      {state?.loading && <div className="space-y-4"><SkStats n={3} cols="grid-cols-3" /><SkTable cols={4} rows={5} /></div>}
      {state?.error && <ErrorNote>{state.error}</ErrorNote>}
      {state?.result && <div className="max-h-[72vh] overflow-y-auto pr-1"><ComparisonResult c={state.result} bare onGo={onClose} /></div>}
      {state?.listing && <div className="max-h-[72vh] overflow-y-auto pr-1"><ListingComparison c={state.listing} /></div>}
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
  const [tab, setTab] = useState(() => (['overview', 'competitors', 'pages', 'compare', 'gap', 'keywords', 'maps', 'links', 'plan'].includes(params.get('tab')) ? params.get('tab') : 'overview'));
  const [settings, setSettings] = useState(false);
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

  // Google Maps finder: registers competitors that have a website, then audits our site and each of them.
  const findOnMaps = () => runMaps('maps', async () => {
    const type = b.primaryCategory || (state?.defaults?.keywords?.[0] || '').split(' in ')[0] || 'business';
    const where = [b.area, b.city].filter(Boolean).join(', ') || state?.defaults?.location || '';
    const r = await api('/competitors', { method: 'POST', body: { business_type: type, location: where, business_id: b.id, top_n: 10 } });
    const list = await loadRegistered();
    toast(`${r.registered?.length || 0} competitors with a website registered for audits.`);
    auditOurSite();
    (r.registered || list).filter(c => c.website && !running(auditMap[c.id]?.status) && auditMap[c.id]?.status !== 'done').forEach(auditCompetitor);
    return r;
  });

  const addManual = (url, name) => runAdd('add', async () => {
    const c = await api('/competitors/manual', { method: 'POST', body: { business_id: b.id, url, name } });
    await loadRegistered();
    if (!running(auditMap[c.id]?.status)) auditCompetitor(c);
    if (!ourAudit && b.website) auditOurSite(); // Compare needs our own audit too
    toast(`${c.name} added. Auditing its site…`);
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
  const auditRow = async (c) => { // a saved competitor, or a business found on Maps that is saved first; with a website its site is audited, without one its Google listing is
    if (c?.id) return c.website ? auditCompetitor(c) : auditListing(c);
    const m = c?.maps || c;
    if (!m?.name) return;
    try {
      let made;
      if (m.website) made = await api('/competitors/manual', { method: 'POST', body: { business_id: b.id, url: m.website, name: m.name } });
      else made = await api('/competitors/maps', { method: 'POST', body: { business_id: b.id, name: m.name, address: m.address, cid: m.cid, phone: m.phone, rating: m.rating, reviews: m.reviews } });
      await loadRegistered();
      if (m.website) { if (!ourAudit && b.website) auditOurSite(); await auditCompetitor(made); } else await auditListing(made);
    } catch (e) { toast(`Could not audit ${m.name}: ${e.message}`); }
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
      else if (on) await api('/competitors/manual', { method: 'POST', body: { business_id: b.id, url: c.website, name: c.name } });
      await loadRegistered();
      toast(on ? `${c.name} chosen: Competitor Watch will follow it` : `${c.name} left out`);
    } catch (e) { toast(e.message); }
  };

  const removeCompetitor = async (c) => {
    try { await api(`/competitors/${c.id}`, { method: 'DELETE' }); await loadRegistered(); toast(`${c.name} removed`); } catch (e) { toast(`Could not remove it: ${e.message}`); }
  };

  const start = (keywords, location) => run('start', async () => {
    const r = await api(`/businesses/${b.id}/competitor-research`, { method: 'POST', body: { keywords, location } });
    setState(s => ({ ...s, run: r }));
    setSettings(false);
    if (!registered.length) findOnMaps().catch(() => { }); // the first run also registers the Maps competitors for audits
  });

  const doCompare = async (c) => {
    if (!c) return;
    setComparing(c.id); setCompare({ competitor: c, loading: true });
    if (!c.website) {
      try { setCompare({ competitor: c, listing: await api(`/competitors/${c.id}/listing-compare`, { method: 'POST' }) }); } catch (e) { setCompare({ competitor: c, error: e.message }); } finally { setComparing(null); }
      return;
    }
    try {
      const r = await api('/audit/competitors/compare', { method: 'POST', body: { business_id: b.id, competitor_ids: [c.id], strategy } });
      setCompare({ competitor: c, result: r.comparisons?.[0] || null, error: r.comparisons?.[0] ? '' : 'Nothing to compare yet. Audit your site and this competitor first.' });
    } catch (e) { setCompare({ competitor: c, error: e.message }); } finally { setComparing(null); }
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
    if (!a) { auditCompetitor(c); if (!ourAudit && b.website) auditOurSite(); }
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

  if (!state) return loadError ? <ErrorNote>{loadError}</ErrorNote> : <div className="space-y-4"><SkCard title="Competitor research" subtitle="Who ranks for your keywords on Google and Maps"><Sk h="h-9" w="w-2/3" /></SkCard><SkCard title="Competitors found" pad={false}><SkTable headers={["Competitor", "Type", "Keywords", "Best position"]} rows={6} bare /></SkCard></div>;
  const p = current?.result?.progress;
  const s = result?.summary;

  return (
    <div className="space-y-3">
      {toastNode}


      {/* One compact bar: status, settings, run */}
      <div className={`ai-glass-card rounded px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 ${result || isRunning(current) ? '' : 'hidden'}`}>
        <div className="min-w-0 flex-1">
          {isRunning(current) ? (
            <div className="flex items-center gap-3">
              <Loader2 size={16} className="animate-spin text-indigo-600 shrink-0" />
              <div className="flex-1 min-w-0"><div className="text-13 font-semibold text-slate-900">Researching competitors… <span className="font-normal text-slate-500 truncate">{p?.step || 'Starting'}</span></div>
                <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${p ? Math.round((p.done / p.total) * 100) : 4}%` }} /></div></div>
            </div>
          ) : result ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-12.5 text-slate-600">
              <span title={`${result.keywords.length} keywords · ${result.ideas?.competitor_keywords?.length || 0} competitor keywords · ${result.gaps?.keywords?.length || 0} gaps`}><b className="text-slate-900">Researched {fmtDateTime(result.analysed_at)}</b> · {result.location || 'India'} · {result.keywords.length} keyword{result.keywords.length === 1 ? '' : 's'}</span>
              <span title={s.keywords_ranked ? 'from Google Search Console' : 'link Search Console to see it'}>Google <b className={`tabular-nums ${s.keywords_ranked ? (s.visibility >= (s.leader?.visibility || 0) ? 'text-emerald-600' : 'text-amber-600') : 'text-slate-400'}`}>{s.keywords_ranked ? `${s.visibility}%` : '—'}</b> · {s.keywords_ranked}/{s.keywords_total} keywords</span>
              <span title={`in Maps for ${s.local_ranked} of ${s.keywords_total}`}>Maps <b className="text-slate-900 tabular-nums">{s.local_visibility}%</b></span>
              <span title={s.local_leader ? `Maps leader: ${s.local_leader.name}` : ''}>Competitors <b className="text-slate-900 tabular-nums">{s.competitors}</b>{s.local_leader ? <span className="text-slate-400"> · leader {s.local_leader.name}</span> : null}</span>
            </div>
          ) : <div className="text-13 text-slate-600">Research who outranks you on Google and Maps, then find keywords from it.</div>}
        </div>
        {result && <Button size="sm" icon={Settings2} onClick={() => setSettings(true)}>Keywords & settings</Button>}
        {result && <Button size="sm" variant="primary" icon={Play} busy={busy === 'start' || isRunning(current)} disabled={!state.setup.google_results} onClick={() => start(defaults.keywords, defaults.location)}>Run again</Button>}
        {result && <Button size="sm" icon={Users} onClick={() => setPanel(true)} title="Add, choose and remove competitors">My competitors · <b className="tabular-nums">{chosenTotal}</b> chosen</Button>}
      </div>
      {current?.status === 'failed' && <ErrorNote>{current.error || 'The research failed.'}</ErrorNote>}
      {isRunning(current) && <LiveResults progress={p} />}

      {!result && !isRunning(current) && <div className="flex justify-end -mb-2"><Button size="sm" icon={Users} onClick={() => setPanel(true)} title="Add, choose and remove competitors">My competitors · <b className="tabular-nums">{chosenTotal}</b> chosen</Button></div>}
      <div className="grid gap-5 items-start">
      <div className="min-w-0 space-y-3">
      {!result && !isRunning(current) && <Card title="Research your competitors" subtitle="Add the searches your customers type, then run it. The Maps competitors are registered for site audits at the same time."><SetupForm b={b} defaults={defaults} onStart={start} busy={busy === 'start'} error={error} setupInfo={state.setup} hasRun={false} /></Card>}

      {result && (
        <div className={isRunning(current) ? 'space-y-3 opacity-60 pointer-events-none select-none' : 'space-y-3'} aria-busy={isRunning(current)}>
          <div>
            <Tabs value={tab} onChange={setTab} tabs={[
              { id: 'overview', label: 'Overview' },
              { id: 'competitors', label: 'All competitors', count: rows.length },
              { id: 'pages', label: 'Traffic and pages' },
              { id: 'gap', label: 'Keyword gap' },
              { id: 'keywords', label: 'Keywords', count: result.keywords.length },
              { id: 'compare', label: 'Side by side' },
              { id: 'maps', label: 'Google Maps', count: result.local_competitors.length },
              { id: 'links', label: 'Listings' },
              { id: 'plan', label: 'Action plan', count: result.actions.length }
            ]} />
            {tab === 'overview' && <Overview r={result} goto={setTab} />}
            {tab === 'competitors' && <>
              <MapsAudit r={result} kit={mapsKit} />
              <CompetitorsTable rows={rows} r={result} strategy={strategy} setStrategy={setStrategy} auditMap={auditMap} ourAudit={ourAudit} onAuditOur={auditOurSite} hasSite={Boolean(b.website)}
                onDetail={setDetail} onAudit={auditRow} onCompare={doCompare} comparing={comparing} onFindMaps={findOnMaps} findBusy={mapsBusy === 'maps'}
                onAddManual={addManual} addBusy={addBusy === 'add'} addError={addError} onChoose={chooseCompetitor} />
              <ErrorNote>{mapsError}</ErrorNote>
            </>}
            {tab === 'pages' && <CompetitorPagesTab b={b} />}
            {tab === 'compare' && <CompareDomains b={b} result={result} />}
            {tab === 'gap' && <KeywordGap b={b} result={result} />}
            {tab === 'keywords' && <KeywordsTab r={result} onKeyword={setSerp} onIdeas={() => setIdeas(true)} />}
            {tab === 'maps' && <MapsTab r={result} kit={mapsKit} />}
            {tab === 'links' && <ListingsTab r={result} setupInfo={state.setup} />}
            {tab === 'plan' && <PlanTab r={result} />}
          </div>
        </div>
      )}
      </div>
      <Drawer open={panel} onClose={() => setPanel(false)} width="max-w-md" title="My competitors" subtitle="Choose 3 to 5 that really compete with you. Only the chosen ones are watched.">
        <MyCompetitors list={registered} auditMap={auditMap} onAdd={addManual} onFind={findOnMaps} onAudit={auditCompetitor} onRemove={removeCompetitor} onChoose={chooseCompetitor} addBusy={addBusy} addError={addError} findBusy={mapsBusy} findError={mapsError} running={isRunning(current)} />
      </Drawer>
      </div>

      <Modal open={settings} onClose={() => setSettings(false)} width="max-w-2xl" title="Keywords & research settings">
        <SetupForm b={b} defaults={defaults} onStart={start} busy={busy === 'start' || isRunning(current)} error={error} setupInfo={state.setup} hasRun={Boolean(result)} />
      </Modal>
      {result && <ProfileModal c={detail} r={result} onClose={() => setDetail(null)} onAudit={auditCompetitor} onCompare={doCompare} auditMap={auditMap} />}
      {result && <KeywordModal s={serp} onClose={() => setSerp(null)} />}
      {result && <IdeasModal open={ideas} r={result} onClose={() => setIdeas(false)} />}
      <CompareModal state={compare} onClose={() => setCompare(null)} />
    </div>
  );
}

/** What the research starts from: the business understanding (kind of business, area, the words customers search with). Without it the page asks for the summary to be built first. */
function Basis({ b }) {
  const r = useApi(`/businesses/${b.id}/business-brief`);
  const [open, setOpen] = useState(false);
  const br = r.data?.brief;
  if (r.error || !r.data) return null;
  if (!br) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 flex flex-wrap items-center gap-3 text-12.5 text-amber-900">
        <span className="flex-1 min-w-[220px]"><b>Build the business summary first:</b> competitors and keywords are found from what the business is and how customers search.</span>
        <Link to="/website-audit" className="font-semibold underline">Open the website audit</Link>
      </div>
    );
  }
  const terms = br.customer_search_terms || [];
  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-1.5">
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 text-left cursor-pointer">
        <span className="text-12.5 font-bold text-indigo-900">Based on your business understanding</span>
        {br.business_model && <span className="px-2 py-0.5 rounded bg-white ring-1 ring-indigo-200 text-12 font-bold text-slate-900 capitalize">{br.business_model}</span>}
        <span className="text-12 text-indigo-800 truncate max-w-[60%]">{terms.slice(0, 3).join(' · ')}{terms.length > 3 ? ` +${terms.length - 3} more` : ''}</span>
        <span className="ml-auto text-12 font-semibold text-indigo-700">{open ? 'Hide' : 'Details'}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2 pb-1">
          <div className="flex flex-wrap items-center gap-1.5">{terms.map(x => <span key={x} className="px-2.5 py-1 rounded-full bg-indigo-600 text-white text-12 font-semibold">{x}</span>)}</div>
          {(br.competitors_are || br.competitors_are_not) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-12.5">
              {br.competitors_are && <div className="rounded-lg bg-emerald-50 ring-1 ring-emerald-200 px-3 py-2 text-slate-800"><b className="text-emerald-800">Counts: </b>{br.competitors_are}</div>}
              {br.competitors_are_not && <div className="rounded-lg bg-rose-50 ring-1 ring-rose-200 px-3 py-2 text-slate-800"><b className="text-rose-800">Does not count: </b>{br.competitors_are_not}</div>}
            </div>
          )}
          <Link to="/website-audit" className="inline-block text-12.5 font-semibold text-indigo-700 hover:underline">View or refresh the business understanding</Link>
        </div>
      )}
    </div>
  );
}

export default function CompetitorFinderPage() {
  return (
    <SeoShell step="competitors" title="Competitors" subtitle="Who outranks you on Google and Maps, side by side with you, the keywords you are missing, and what to do about it: one research, one place">
      {(b) => <div className="space-y-3"><Basis key={`basis-${b.id}`} b={b} /><Research key={b.id} b={b} /></div>}
    </SeoShell>
  );
}
