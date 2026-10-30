import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, MapPin, Star, Globe, ExternalLink, Loader2, AlertTriangle, Lightbulb, Plus, X, Link2, FileText, Gauge, Settings2, Play,
  CheckCircle2, Minus, Layers, ArrowRight, BookOpen, Code2, ListChecks, HelpCircle, Sparkles, ShieldCheck, Smartphone, Monitor, RotateCcw, Eye
} from 'lucide-react';
import { SeoShell, Card, Badge, Button, Field, Tabs, Modal, inputCls, ErrorNote, useToast, useAction } from './SeoUi';
import { api, usePoll, fmt, fmtDateTime } from './seoApi';
import { ComparisonResult } from './CompetitorAuditCompare';

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

const Label = ({ icon: Icon, children }) => <div className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-2 flex items-center gap-1.5">{Icon && <Icon size={13} />}{children}</div>;

/** A table that scrolls inside the page instead of making the page long. */
const Table = ({ head, children, className = '' }) => (
  <div className={`overflow-auto max-h-[calc(100vh-390px)] min-h-[200px] ${className}`}>
    <table className="w-full text-13">
      <thead className="sticky top-0 z-10 bg-slate-50 text-left text-11.5 uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_theme(colors.slate.200)]"><tr>{head}</tr></thead>
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
      {!setupInfo.google_results && (
        <div className="text-13 text-amber-800 bg-amber-50 border border-amber-200 rounded px-4 py-3">
          Competitor research needs Google results. Add <code className="font-mono">SERPER_API_KEY</code> (from serper.dev) to the SEO backend's <code className="font-mono">.env</code> and restart it.
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
      <p className="text-11.5 text-slate-500">About a minute. Uses about {keywords.length * 2 + 5} Google searches from your Serper credits. Competitors found on Google Maps are also registered for site audits.</p>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}

function Tile({ label, value, sub, tone = 'text-slate-900' }) {
  return (
    <div className="ai-glass-card rounded px-4 py-3 min-w-0">
      <div className="text-11 font-semibold uppercase tracking-wide text-slate-500 truncate">{label}</div>
      <div className={`text-22 font-bold tabular-nums leading-tight ${tone}`}>{value}</div>
      <div className="text-11.5 text-slate-500 truncate" title={sub}>{sub}</div>
    </div>
  );
}

/* ── Tabs ─────────────────────────────────────────────────────────────── */

function Overview({ r, goto }) {
  const s = r.summary;
  const business = r.organic_competitors.filter(d => d.type === 'business').slice(0, 6);
  const bars = [{ label: `${r.business.name} (you)`, value: s.visibility, mine: true, sub: `${s.keywords_ranked} of ${s.keywords_total} keywords on page 1` },
    ...business.map(d => ({ label: d.domain, value: d.visibility, sub: `${d.keywords_top10} keywords on page 1` }))].sort((a, b) => b.value - a.value);
  const maps = [{ label: `${r.business.name} (you)`, value: s.local_visibility, mine: true }, ...r.local_competitors.slice(0, 5).map(e => ({ label: e.name, value: e.visibility }))].sort((a, b) => b.value - a.value);
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <Card title="Google visibility" subtitle="Expected share of clicks from these keywords" action={<button type="button" onClick={() => goto('competitors')} className="text-12.5 font-semibold text-indigo-700 hover:underline cursor-pointer">All →</button>}><VisibilityBars rows={bars} /></Card>
      <Card title="Google Maps visibility" subtitle="Who Maps shows first" action={<button type="button" onClick={() => goto('maps')} className="text-12.5 font-semibold text-indigo-700 hover:underline cursor-pointer">Details →</button>}><VisibilityBars rows={maps} /></Card>
      <Card title="Do first" subtitle="Biggest gaps to close" action={<button type="button" onClick={() => goto('plan')} className="text-12.5 font-semibold text-indigo-700 hover:underline cursor-pointer">Full plan →</button>}>
        {r.actions.length ? (
          <ol className="space-y-2">
            {r.actions.slice(0, 4).map((a, i) => (
              <li key={i} className="flex gap-2.5 text-13">
                <span className="w-5 h-5 rounded-full bg-indigo-50 text-indigo-700 text-11 font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                <span className="min-w-0"><span className="font-semibold text-slate-900">{a.title}</span><span className="block text-12 text-slate-500 line-clamp-2">{a.why}</span></span>
              </li>
            ))}
          </ol>
        ) : <p className="text-13 text-slate-500">No gaps found for these keywords.</p>}
      </Card>
    </div>
  );
}

function CompetitorsTable({ rows, r, strategy, setStrategy, auditMap, ourAudit, onAuditOur, hasSite, onDetail, onAudit, onCompare, comparing, onFindMaps, findBusy }) {
  return (
    <Card pad={false}>
      <div className="px-5 py-3 border-b border-slate-200 flex flex-wrap items-center gap-3">
        <div className="text-13 font-semibold text-slate-900">{rows.length} competitors <span className="font-normal text-slate-500">· click a name for the full profile</span></div>
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
        </div>
      </div>
      <Table head={<><Th>Competitor</Th><Th c="text-right">Google visibility</Th><Th c="text-right">Page-1 keywords</Th><Th c="text-center">Maps</Th><Th>Site audit</Th><Th c="text-right">Actions</Th></>}>
        {rows.map(c => {
          const a = auditMap[c.reg?.id];
          return (
            <tr key={c.host} className="hover:bg-slate-50">
              <td className="px-4 py-2.5 min-w-[200px]">
                <button type="button" onClick={() => onDetail(c)} className="text-left cursor-pointer group max-w-[280px]">
                  <span className="block font-semibold text-slate-900 group-hover:text-indigo-700 truncate">{c.name}</span>
                  <span className="block text-12 text-slate-500 truncate">{c.host}</span>
                </button>
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{c.profile ? `${c.profile.visibility}%` : '—'}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{c.profile ? `${Object.keys(c.profile.positions).length}/${r.keywords.length}` : '—'}</td>
              <td className="px-4 py-2.5 text-center">{c.profile?.local ? <span className="inline-flex items-center gap-1.5"><Pos value={c.profile.local.best} maps /><Stars rating={c.profile.local.rating} /></span> : (c.reg?.rating ? <Stars rating={c.reg.rating} reviews={c.reg.reviews} /> : <span className="text-slate-400">—</span>)}</td>
              <td className="px-4 py-2.5 whitespace-nowrap text-12.5">
                {!c.reg ? <span className="text-slate-400" title="Found by Google results only; use Find more on Maps to register it for audits">Not registered</span>
                  : a ? <span className={`inline-flex items-center gap-1.5 ${a.status === 'failed' ? 'text-red-600' : a.status === 'done' ? 'text-emerald-700' : 'text-slate-500'}`}>{running(a.status) && <Loader2 size={12} className="animate-spin" />}{AUDIT_LABEL[a.status] || a.status}</span>
                    : <span className="text-slate-400">Not audited</span>}
              </td>
              <td className="px-4 py-2.5 text-right whitespace-nowrap">
                <div className="inline-flex gap-1.5">
                  <Button size="sm" icon={Eye} onClick={() => onDetail(c)}>Profile</Button>
                  <Button size="sm" icon={Gauge} disabled={!c.reg || !c.reg.website || running(a?.status)} onClick={() => onAudit(c.reg)} title={c.reg ? 'Run PageSpeed + crawl on their site' : 'Register it first with Find more on Maps'}>{a ? 'Re-audit' : 'Audit'}</Button>
                  <Button size="sm" variant="primary" icon={ShieldCheck} busy={comparing === c.reg?.id} disabled={!c.reg} onClick={() => onCompare(c.reg)}>Compare</Button>
                </div>
              </td>
            </tr>
          );
        })}
        {!rows.length && <tr><td colSpan={6} className="px-5 py-10 text-center text-13 text-slate-500">No competitors yet.</td></tr>}
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

function MapsTab({ r }) {
  const maxReviews = Math.max(1, ...r.local_competitors.map(e => e.reviews || 0), r.business.reviews || 0);
  const you = { name: `${r.business.name} (you)`, rating: r.business.rating, reviews: r.business.reviews || 0, appearances: r.summary.local_ranked, best: Math.min(...Object.values(r.you.local), Infinity), visibility: r.summary.local_visibility, mine: true };
  const rows = [you, ...r.local_competitors].sort((a, b) => b.visibility - a.visibility);
  return (
    <Card pad={false}>
      <Table head={<><Th>Business</Th><Th c="text-right">Visibility</Th><Th c="text-center">Best</Th><Th c="text-right">In results</Th><Th>Rating</Th><Th cls="w-44">Reviews</Th><Th>Website</Th></>}>
        {rows.map(e => (
          <tr key={e.name} className={e.mine ? 'bg-emerald-50/50' : 'hover:bg-slate-50'}>
            <td className="px-4 py-2.5"><div className={`font-medium ${e.mine ? 'text-emerald-800' : 'text-slate-900'}`}>{e.name}</div>{e.category && <div className="text-12 text-slate-500">{e.category}</div>}</td>
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
        {setupInfo.backlinks ? 'Backlink totals come from DataForSEO; the table shows the listings Google surfaces for each name.' : 'Links and listings Google shows for each name, not a full backlink index. Connect DataForSEO for total backlinks.'}
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
        {r.gaps.keywords.length > 0 && <tr className="bg-slate-50"><td colSpan={5} className="px-4 py-2 text-11.5 font-semibold uppercase tracking-wide text-slate-500"><span className="inline-flex items-center gap-1.5"><ListChecks size={13} /> Keywords where competitors are on page 1 and you are not</span></td></tr>}
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
      <div className="px-5 py-2.5 border-t border-slate-200 text-11.5 text-slate-500 flex items-center gap-1.5"><Sparkles size={12} /> Based on live Google results ({r.sources.credits} searches) and a scan of the top competitors' websites.</div>
    </Card>
  );
}

/** What the research has found so far, filling in while it runs: competitors, Maps businesses and sites appear one by one. */
function LiveResults({ progress }) {
  const f = progress?.found;
  if (!f) return <div className="ai-glass-card rounded px-5 py-4 text-13 text-slate-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin text-indigo-600" /> Asking Google for the first keyword…</div>;
  return (
    <Card title="Live results" subtitle={`${f.keywords.length} keyword${f.keywords.length === 1 ? '' : 's'} searched so far. New competitors appear as they are found.`} pad={false}>
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] divide-y xl:divide-y-0 xl:divide-x divide-slate-200">
        <div className="overflow-auto max-h-64">
          <table className="w-full text-13">
            <thead className="sticky top-0 bg-slate-50 text-left text-11.5 uppercase tracking-wide text-slate-500"><tr><Th>Competitor on Google</Th><Th c="text-right">Visibility</Th><Th c="text-right">Page 1</Th><Th c="text-right">Top 3</Th><Th>Site</Th></tr></thead>
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
        <Button variant="primary" icon={ShieldCheck} disabled={!c.reg} onClick={() => { onClose(); onCompare(c.reg); }}>Compare with my site</Button>
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
              {p.backlinks && <p className="text-12.5 text-slate-600">Backlinks: <b>{fmt(p.backlinks.backlinks)}</b> from <b>{fmt(p.backlinks.referring_domains)}</b> sites (DataForSEO).</p>}
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

function CompareModal({ state, onClose }) {
  return (
    <Modal open={Boolean(state)} onClose={onClose} width="max-w-5xl" title={state ? `Compare with ${state.competitor.name}` : ''}>
      {state?.loading && <div className="py-12 flex items-center justify-center gap-2 text-13 text-slate-500"><Loader2 size={16} className="animate-spin" /> Comparing the latest audits…</div>}
      {state?.error && <ErrorNote>{state.error}</ErrorNote>}
      {state?.result && <div className="max-h-[72vh] overflow-y-auto pr-1"><ComparisonResult c={state.result} bare /></div>}
    </Modal>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */

function Research({ b }) {
  const [toast, toastNode] = useToast();
  const [busy, error, run] = useAction();
  const [mapsBusy, mapsError, runMaps] = useAction();
  const [state, setState] = useState(null); // { run, defaults, setup }
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState('overview');
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

  const load = async () => {
    try { setState(await api(`/businesses/${b.id}/competitor-research`)); setLoadError(''); } catch (e) { setLoadError(e.message); }
  };
  const loadRegistered = async () => {
    const list = await api(`/competitors?business_id=${b.id}`).catch(() => []);
    setRegistered(list);
    const hist = await api(`/audit/competitors?business_id=${b.id}&limit=200`).catch(() => []);
    const by = {};
    for (const a of hist) if (a.competitor_id && !by[a.competitor_id]) by[a.competitor_id] = { id: a.id, status: a.status };
    setAuditMap(m => ({ ...by, ...m }));
    return list;
  };
  useEffect(() => { load(); loadRegistered(); }, [b.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = state?.run;
  usePoll(async () => {
    const r = await api(`/competitor-research/${current.id}`).catch(() => null);
    if (r) setState(s => ({ ...s, run: r }));
    if (r?.status === 'done') toast('Competitor research is ready.');
  }, isRunning(current), 2500);

  const pending = Object.entries(auditMap).filter(([, v]) => running(v.status));
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

  const start = (keywords, location) => run('start', async () => {
    const r = await api(`/businesses/${b.id}/competitor-research`, { method: 'POST', body: { keywords, location } });
    setState(s => ({ ...s, run: r }));
    setSettings(false);
    if (!registered.length) findOnMaps().catch(() => {}); // the first run also registers the Maps competitors for audits
  });

  const doCompare = async (c) => {
    if (!c) return;
    setComparing(c.id); setCompare({ competitor: c, loading: true });
    try {
      const r = await api('/audit/competitors/compare', { method: 'POST', body: { business_id: b.id, competitor_ids: [c.id], strategy } });
      setCompare({ competitor: c, result: r.comparisons?.[0] || null, error: r.comparisons?.[0] ? '' : 'Nothing to compare yet. Audit your site and this competitor first.' });
    } catch (e) { setCompare({ competitor: c, error: e.message }); } finally { setComparing(null); }
  };

  const result = current?.status === 'done' ? current.result : state?.last_done?.status === 'done' ? state.last_done.result : null;
  const defaults = useMemo(() => (current?.result?.keywords && !result ? { ...state?.defaults, keywords: current.result.keywords }
    : result ? { keywords: result.keywords, location: result.location || state?.defaults?.location } : state?.defaults || { keywords: [], location: '' }), [current, result, state?.defaults]);

  // One row per competitor: what the research found merged with what is registered for audits.
  const rows = useMemo(() => {
    const byHost = new Map();
    for (const p of result?.profiles || []) byHost.set(baseSite(p.domain), { host: baseSite(p.domain), name: p.local?.name || p.domain, website: `https://${p.domain}`, profile: p, reg: null });
    for (const c of registered) {
      const host = hostOf(c.website);
      if (!host) continue;
      const row = byHost.get(host) || { host, name: c.name, website: c.website, profile: null, reg: null };
      row.reg = c; row.name = row.profile ? row.name : c.name; byHost.set(host, row);
    }
    return [...byHost.values()].sort((x, y) => (y.profile?.visibility ?? -1) - (x.profile?.visibility ?? -1));
  }, [result, registered]);

  if (!state) return loadError ? <ErrorNote>{loadError}</ErrorNote> : <div className="flex items-center gap-2 text-13 text-slate-500"><Loader2 size={15} className="animate-spin" /> Loading…</div>;
  const p = current?.result?.progress;
  const s = result?.summary;

  return (
    <div className="space-y-4">
      {toastNode}

      {/* One compact bar: status, settings, run */}
      <div className="ai-glass-card rounded px-5 py-3 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          {isRunning(current) ? (
            <div className="flex items-center gap-3">
              <Loader2 size={16} className="animate-spin text-indigo-600 shrink-0" />
              <div className="flex-1 min-w-0"><div className="text-13 font-semibold text-slate-900">Researching competitors… <span className="font-normal text-slate-500 truncate">{p?.step || 'Starting'}</span></div>
                <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${p ? Math.round((p.done / p.total) * 100) : 4}%` }} /></div></div>
            </div>
          ) : result ? (
            <div className="text-13 text-slate-700"><b className="text-slate-900">Researched {fmtDateTime(result.analysed_at)}</b> · {result.location || 'India'} · {result.keywords.length} keyword{result.keywords.length === 1 ? '' : 's'} · {result.ideas?.competitor_keywords?.length || 0} competitor keywords, {result.gaps?.keywords?.length || 0} gaps</div>
          ) : <div className="text-13 text-slate-600">Research who outranks you on Google and Maps, then find keywords from it.</div>}
        </div>
        {result && <Link to="/keyword-management" className="h-9 px-3.5 rounded inline-flex items-center gap-1.5 text-13 font-semibold bg-indigo-50 text-indigo-800 ring-1 ring-inset ring-indigo-200 hover:bg-indigo-100">Step 2: find keywords <ArrowRight size={14} /></Link>}
        <Button icon={Settings2} onClick={() => setSettings(true)}>Keywords & settings</Button>
        {result && <Button variant="primary" icon={Play} busy={busy === 'start' || isRunning(current)} disabled={!state.setup.google_results} onClick={() => start(defaults.keywords, defaults.location)}>Run again</Button>}
      </div>
      {current?.status === 'failed' && <ErrorNote>{current.error || 'The research failed.'}</ErrorNote>}
      {isRunning(current) && <LiveResults progress={p} />}

      {!result && !isRunning(current) && <Card title="Research your competitors" subtitle="Add the searches your customers type, then run it. The Maps competitors are registered for site audits at the same time."><SetupForm b={b} defaults={defaults} onStart={start} busy={busy === 'start'} error={error} setupInfo={state.setup} hasRun={false} /></Card>}

      {result && (
        <div className={isRunning(current) ? 'space-y-4 opacity-60 pointer-events-none select-none' : 'space-y-4'} aria-busy={isRunning(current)}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label="Google visibility" value={`${s.visibility}%`} sub={s.leader ? `leader ${s.leader.domain}: ${s.leader.visibility}%` : ''} tone={s.visibility >= (s.leader?.visibility || 0) ? 'text-emerald-600' : 'text-amber-600'} />
            <Tile label="Keywords on page 1" value={`${s.keywords_ranked}/${s.keywords_total}`} sub={`${s.keywords_top3} in the top 3`} />
            <Tile label="Maps visibility" value={`${s.local_visibility}%`} sub={`in Maps for ${s.local_ranked} of ${s.keywords_total}`} />
            <Tile label="Competing businesses" value={s.competitors} sub={s.local_leader ? `Maps leader: ${s.local_leader.name}` : ''} />
          </div>
          <div>
            <Tabs value={tab} onChange={setTab} tabs={[
              { id: 'overview', label: 'Overview' },
              { id: 'competitors', label: 'Competitors', count: rows.length },
              { id: 'keywords', label: 'Keywords', count: result.keywords.length },
              { id: 'maps', label: 'Google Maps', count: result.local_competitors.length },
              { id: 'links', label: 'Listings' },
              { id: 'plan', label: 'Action plan', count: result.actions.length }
            ]} />
            {tab === 'overview' && <Overview r={result} goto={setTab} />}
            {tab === 'competitors' && <>
              <CompetitorsTable rows={rows} r={result} strategy={strategy} setStrategy={setStrategy} auditMap={auditMap} ourAudit={ourAudit} onAuditOur={auditOurSite} hasSite={Boolean(b.website)}
                onDetail={setDetail} onAudit={auditCompetitor} onCompare={doCompare} comparing={comparing} onFindMaps={findOnMaps} findBusy={mapsBusy === 'maps'} />
              <ErrorNote>{mapsError}</ErrorNote>
            </>}
            {tab === 'keywords' && <KeywordsTab r={result} onKeyword={setSerp} onIdeas={() => setIdeas(true)} />}
            {tab === 'maps' && <MapsTab r={result} />}
            {tab === 'links' && <ListingsTab r={result} setupInfo={state.setup} />}
            {tab === 'plan' && <PlanTab r={result} />}
          </div>
        </div>
      )}

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

export default function CompetitorFinderPage() {
  return (
    <SeoShell title="Competitor Research" subtitle="Who outranks you on Google and Google Maps, the keywords and pages they win with, how their sites compare to yours, and what to do">
      {(b) => <Research key={b.id} b={b} />}
    </SeoShell>
  );
}
