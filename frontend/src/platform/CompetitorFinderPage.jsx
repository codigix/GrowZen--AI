import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, MapPin, Star, Globe, ExternalLink, Trophy, Loader2, AlertTriangle, Lightbulb, Plus, X, RotateCcw, Link2, FileText,
  CheckCircle2, Minus, Layers, BookOpen, Code2, ListChecks, ChevronDown, ChevronRight, HelpCircle, Sparkles
} from 'lucide-react';
import { SeoShell, Card, Badge, Button, Field, Tabs, inputCls, ErrorNote, useToast, useAction } from './SeoUi';
import { api, usePoll, fmt, fmtDateTime } from './seoApi';

/**
 * Competitor research for the selected business, Semrush-style, from live Google data: who ranks
 * on Google and in Google Maps for its keywords, each competitor's visibility and positions, what the
 * top competitors do on their sites (keywords, service and area pages, blog, schema, content depth),
 * where they are listed and linked, and the business's own gaps with a plan.
 * Server: GET/POST /businesses/{id}/competitor-research, GET /competitor-research/{run} (app/competitors/intel.py).
 */

const MAX_KEYWORDS = 10;
const isRunning = (r) => r && (r.status === 'queued' || r.status === 'running');
const baseSite = (d) => String(d || '').replace(/^(www|in|en|m)\./, '');

/** A Google position as a chip: the number is always shown, colour only backs it up. */
const Pos = ({ value, maps }) => {
  if (!value) return <span className="inline-flex items-center justify-center w-9 h-6 rounded-md text-[12px] text-slate-400 bg-slate-50 border border-slate-200" title="Not in the results">—</span>;
  const cls = value <= 3 ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : value <= 10 ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-slate-50 text-slate-600 border-slate-200';
  return <span className={`inline-flex items-center justify-center min-w-9 h-6 px-1.5 rounded-md text-[12px] font-bold tabular-nums border ${cls}`} title={`${maps ? 'Google Maps' : 'Google'} position ${value}`}>#{value}</span>;
};

const Stars = ({ rating, reviews }) => (
  <span className="inline-flex items-center gap-1 text-[12.5px] text-slate-700 whitespace-nowrap">
    <Star size={12} className={rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'} />
    <b className="text-slate-900">{rating ? Number(rating).toFixed(1) : '—'}</b>
    {reviews != null && <span className="text-slate-500">({fmt(reviews)})</span>}
  </span>
);

const PRIORITY = { high: ['red', 'Do first'], medium: ['amber', 'Next'], low: ['gray', 'Later'] };

/** Horizontal visibility bars: one hue, the business itself picked out, value labelled on every bar. */
function VisibilityBars({ rows, max }) {
  const top = Math.max(1, max ?? Math.max(...rows.map(r => r.value)));
  return (
    <ul className="space-y-2.5">
      {rows.map(r => (
        <li key={r.label} className="grid grid-cols-[minmax(0,180px)_1fr_48px] items-center gap-3" title={`${r.label}: ${r.value}% visibility${r.sub ? ` · ${r.sub}` : ''}`}>
          <span className={`text-[13px] truncate ${r.mine ? 'font-bold text-emerald-800' : 'text-slate-700'}`}>{r.label}</span>
          <span className="h-3 rounded-full bg-slate-100 overflow-hidden">
            <span className={`block h-full rounded-full ${r.mine ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${Math.max(r.value > 0 ? 2 : 0, (r.value / top) * 100)}%` }} />
          </span>
          <span className="text-right text-[12.5px] font-semibold text-slate-800 tabular-nums">{r.value}%</span>
        </li>
      ))}
    </ul>
  );
}

function Setup({ b, defaults, onStart, busy, error, setupInfo, hasRun }) {
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
  const searches = keywords.length * 2 + 5;
  return (
    <Card title={hasRun ? 'Research settings' : 'Research your competitors'} subtitle="The searches your customers type. We check who Google shows for each one, then study the top competitors.">
      {!setupInfo.google_results && (
        <div className="mb-4 text-[13px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          Competitor research needs Google results. Add <code className="font-mono">SERPER_API_KEY</code> (from serper.dev) to the SEO backend's <code className="font-mono">.env</code> and restart it.
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_260px] gap-5">
        <div>
          <Field label={`Keywords (${keywords.length}/${MAX_KEYWORDS})`} hint="Put the area in the search, as customers do">
            <div className="flex flex-wrap gap-1.5 mb-2">
              {keywords.map(k => (
                <span key={k} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200 text-[12.5px]">
                  {k}
                  <button type="button" onClick={() => setKeywords(ks => ks.filter(x => x !== k))} className="p-0.5 rounded-full hover:bg-indigo-100 cursor-pointer" aria-label={`Remove ${k}`}><X size={12} /></button>
                </span>
              ))}
              {!keywords.length && <span className="text-[12.5px] text-slate-500">Add at least one keyword.</span>}
            </div>
            <div className="flex gap-2">
              <input className={inputCls} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
                placeholder={`e.g. ${b.primaryCategory ? `${b.primaryCategory.toLowerCase()} in ${b.area || b.city || 'your area'}` : 'dentist in Baner'}`} disabled={keywords.length >= MAX_KEYWORDS} />
              <Button icon={Plus} onClick={add} disabled={!draft.trim() || keywords.length >= MAX_KEYWORDS}>Add</Button>
            </div>
          </Field>
        </div>
        <div className="space-y-3">
          <Field label="Search from" hint="City Google searches from">
            <input className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Pune, India" />
          </Field>
          <Button variant="primary" icon={Search} className="w-full justify-center" busy={busy} disabled={!keywords.length || !setupInfo.google_results} onClick={() => onStart(keywords, location)}>
            {hasRun ? 'Run research again' : 'Research competitors'}
          </Button>
          <p className="text-[11.5px] text-slate-500">About a minute. Uses about {searches} Google searches from your Serper credits.</p>
        </div>
      </div>
      <ErrorNote>{error}</ErrorNote>
    </Card>
  );
}

function Overview({ r, goto }) {
  const s = r.summary;
  const business = r.organic_competitors.filter(d => d.type === 'business').slice(0, 8);
  const bars = [{ label: `${r.business.name} (you)`, value: s.visibility, mine: true, sub: `${s.keywords_ranked} of ${s.keywords_total} keywords on page 1` },
    ...business.map(d => ({ label: d.domain, value: d.visibility, sub: `${d.keywords_top10} keywords on page 1` }))].sort((a, b) => b.value - a.value);
  const maps = [{ label: `${r.business.name} (you)`, value: s.local_visibility, mine: true },
    ...r.local_competitors.slice(0, 6).map(e => ({ label: e.name, value: e.visibility }))].sort((a, b) => b.value - a.value);
  const tiles = [
    ['Google visibility', `${s.visibility}%`, s.leader ? `leader ${s.leader.domain}: ${s.leader.visibility}%` : '', s.visibility >= (s.leader?.visibility || 0) ? 'text-emerald-600' : 'text-amber-600'],
    ['Keywords on page 1', `${s.keywords_ranked}/${s.keywords_total}`, `${s.keywords_top3} in the top 3`, 'text-slate-900'],
    ['Google Maps visibility', `${s.local_visibility}%`, `in Maps for ${s.local_ranked} of ${s.keywords_total}`, 'text-slate-900'],
    ['Competing businesses', s.competitors, s.local_leader ? `Maps leader: ${s.local_leader.name}` : '', 'text-slate-900']
  ];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tiles.map(([label, value, sub, cls]) => (
          <div key={label} className="ai-glass-card rounded-2xl px-5 py-4 min-w-0">
            <div className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
            <div className={`mt-1 text-[26px] font-bold tabular-nums ${cls}`}>{value}</div>
            <div className="text-[12px] text-slate-500 truncate" title={sub}>{sub}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Card title="Google visibility" subtitle="Share of clicks you can expect from these keywords, from each site's positions" action={<button type="button" onClick={() => goto('competitors')} className="text-[12.5px] font-semibold text-indigo-700 hover:underline cursor-pointer">All competitors →</button>}>
          <VisibilityBars rows={bars} />
          <p className="mt-3 text-[11.5px] text-slate-500">Listing sites (Practo, Justdial…) are left out here; see <button type="button" onClick={() => goto('links')} className="text-indigo-700 hover:underline cursor-pointer">Links & listings</button>.</p>
        </Card>
        <Card title="Google Maps visibility" subtitle="Who Google Maps shows first for these keywords" action={<button type="button" onClick={() => goto('maps')} className="text-[12.5px] font-semibold text-indigo-700 hover:underline cursor-pointer">Maps details →</button>}>
          <VisibilityBars rows={maps} />
        </Card>
      </div>
      <Card title="What to do first" subtitle="From the gaps between you and the businesses that outrank you" action={<button type="button" onClick={() => goto('plan')} className="text-[12.5px] font-semibold text-indigo-700 hover:underline cursor-pointer">Full plan →</button>}>
        <ActionList actions={r.actions.slice(0, 4)} />
      </Card>
    </div>
  );
}

function ActionList({ actions }) {
  if (!actions.length) return <p className="text-[13px] text-slate-500">No gaps found for these keywords. Try more keywords or another area.</p>;
  return (
    <ol className="space-y-3">
      {actions.map((a, i) => {
        const [tone, label] = PRIORITY[a.priority] || PRIORITY.low;
        return (
          <li key={i} className="flex gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <span className="w-6 h-6 rounded-full bg-indigo-50 text-indigo-700 text-[12px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><span className="text-[14px] font-semibold text-slate-900">{a.title}</span><Badge tone={tone}>{label}</Badge></div>
              <p className="mt-0.5 text-[13px] leading-relaxed text-slate-600">{a.why}</p>
            </div>
            {a.to && <Link to={a.to} className="self-center shrink-0 text-[12.5px] font-semibold text-indigo-700 hover:underline whitespace-nowrap">Open →</Link>}
          </li>
        );
      })}
    </ol>
  );
}

function KeywordPositions({ r }) {
  const [open, setOpen] = useState(null);
  const cols = r.profiles.slice(0, 4).map(p => p.domain);
  return (
    <div className="space-y-5">
      <Card title="Keyword positions" subtitle="Your Google and Maps position for each keyword next to the top competitors'. Click a keyword to see the full Google results." pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 text-left text-[11.5px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2.5 font-semibold">Keyword</th>
                <th className="px-3 py-2.5 font-semibold text-center">You · Google</th>
                <th className="px-3 py-2.5 font-semibold text-center">You · Maps</th>
                {cols.map(c => <th key={c} className="px-3 py-2.5 font-semibold text-center normal-case max-w-[130px] truncate" title={c}>{c}</th>)}
                <th className="px-3 py-2.5 font-semibold">#1 on Google</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {r.serps.map(s => {
                const first = s.organic[0];
                const isOpen = open === s.keyword;
                return (
                  <React.Fragment key={s.keyword}>
                    <tr className={`cursor-pointer hover:bg-slate-50 ${!s.you_organic ? 'bg-rose-50/30' : ''}`} onClick={() => setOpen(isOpen ? null : s.keyword)}>
                      <td className="px-5 py-3 font-semibold text-slate-900"><span className="inline-flex items-center gap-1.5">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{s.keyword}</span></td>
                      <td className="px-3 py-3 text-center"><Pos value={s.you_organic} /></td>
                      <td className="px-3 py-3 text-center"><Pos value={s.you_local} maps /></td>
                      {cols.map(c => <td key={c} className="px-3 py-3 text-center"><Pos value={r.profiles.find(p => p.domain === c)?.positions?.[s.keyword]} /></td>)}
                      <td className="px-3 py-3 text-slate-600 truncate max-w-[200px]" title={first?.domain}>{first ? first.domain : '—'}</td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50/60">
                        <td colSpan={4 + cols.length} className="px-5 py-4">
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                            <div>
                              <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500 mb-2">Google top 10</div>
                              <ol className="space-y-1.5">
                                {s.organic.map(o => (
                                  <li key={`${o.position}-${o.url}`} className={`flex items-start gap-2 rounded-lg px-2 py-1.5 ${o.mine ? 'bg-emerald-50' : ''}`}>
                                    <Pos value={o.position} />
                                    <div className="min-w-0">
                                      <a href={o.url} target="_blank" rel="noreferrer" className="block text-[13px] font-medium text-slate-900 hover:text-indigo-700 truncate">{o.title || o.domain}</a>
                                      <span className="text-[12px] text-slate-500">{o.domain}{o.type === 'directory' ? ' · listing site' : ''}{o.mine ? ' · you' : ''}</span>
                                    </div>
                                  </li>
                                ))}
                                {!s.organic.length && <li className="text-[12.5px] text-slate-500">No results.</li>}
                              </ol>
                            </div>
                            <div>
                              <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500 mb-2">Google Maps</div>
                              <ol className="space-y-1.5">
                                {s.local.slice(0, 8).map(p => (
                                  <li key={`${p.position}-${p.name}`} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${p.mine ? 'bg-emerald-50' : ''}`}>
                                    <Pos value={p.position} maps />
                                    <span className="flex-1 min-w-0 text-[13px] text-slate-900 truncate">{p.name}{p.mine ? ' (you)' : ''}</span>
                                    <Stars rating={p.rating} reviews={p.reviews} />
                                  </li>
                                ))}
                                {!s.local.length && <li className="text-[12.5px] text-slate-500">No Maps results.</li>}
                              </ol>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex flex-wrap gap-3 text-[11.5px] text-slate-500">
          <span className="inline-flex items-center gap-1.5"><Pos value={1} /> top 3</span>
          <span className="inline-flex items-center gap-1.5"><Pos value={7} /> page 1</span>
          <span className="inline-flex items-center gap-1.5"><Pos /> not in the results</span>
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card title="Keywords competitors target" subtitle="From their page titles and headings">
          <Chips items={r.ideas.competitor_keywords} empty="None found." />
        </Card>
        <Card title="Questions people ask" subtitle="Google's 'People also ask': answer them in FAQs and posts">
          {r.ideas.questions.length ? <ul className="space-y-2">{r.ideas.questions.map(q => <li key={q} className="flex gap-2 text-[13px] text-slate-700"><HelpCircle size={14} className="text-violet-500 mt-0.5 shrink-0" />{q}</li>)}</ul>
            : <p className="text-[13px] text-slate-500">Google showed no questions for these searches.</p>}
        </Card>
        <Card title="Related searches" subtitle="More searches to consider adding">
          <Chips items={r.ideas.related} empty="Google showed no related searches." />
        </Card>
      </div>
    </div>
  );
}

const Chips = ({ items, empty, tone = 'slate' }) => (
  items && items.length ? (
    <div className="flex flex-wrap gap-1.5">
      {items.map(k => <span key={k} className={`px-2.5 py-1 rounded-full text-[12.5px] border ${tone === 'rose' ? 'bg-rose-50 text-rose-800 border-rose-200' : tone === 'green' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>{k}</span>)}
    </div>
  ) : <p className="text-[13px] text-slate-500">{empty}</p>
);

function Competitors({ r }) {
  const mine = r.you.site;
  const myServices = new Set([...(mine?.services || [])].map(s => s.toLowerCase()));
  const hasService = (s) => [...myServices].some(m => m.includes(s.toLowerCase()) || s.toLowerCase().includes(m));
  return (
    <div className="space-y-5">
      {r.profiles.map((p, i) => {
        const site = p.site || {};
        return (
          <Card key={p.domain} title={<span className="inline-flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-[12px] font-bold flex items-center justify-center">{i + 1}</span>{p.domain}</span>}
            subtitle={`${p.visibility}% Google visibility · on page 1 for ${Object.keys(p.positions).length} of ${r.keywords.length} keywords`}
            action={<a href={`https://${p.domain}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-indigo-700 hover:underline"><ExternalLink size={13} /> Visit</a>}>
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-6">
              <div>
                <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500 mb-2 flex items-center gap-1.5"><Lightbulb size={13} className="text-amber-500" /> Their strategy</div>
                <ul className="space-y-1.5">{p.strategy.map((line, k) => <li key={k} className="flex gap-2 text-[13px] leading-relaxed text-slate-700"><CheckCircle2 size={14} className="text-indigo-500 mt-0.5 shrink-0" />{line}</li>)}</ul>
                {!site.scanned && <p className="mt-3 text-[12.5px] text-amber-700 flex items-center gap-1.5"><AlertTriangle size={13} /> Their site could not be read: {site.error || 'it did not load'}.</p>}
              </div>
              <div className="space-y-4">
                <div>
                  <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500 mb-2">Rankings</div>
                  <div className="flex flex-wrap gap-1.5">
                    {r.keywords.map(k => <span key={k} className="inline-flex items-center gap-1.5 text-[12px] text-slate-700 bg-slate-50 border border-slate-200 rounded-lg pl-2 pr-1 py-0.5">{k}<Pos value={p.positions[k]} /></span>)}
                  </div>
                  {p.local && <div className="mt-2 text-[12.5px] text-slate-600 flex items-center gap-2"><MapPin size={13} /> Maps: in {p.local.appearances} result list{p.local.appearances === 1 ? '' : 's'}, best #{p.local.best} · <Stars rating={p.local.rating} reviews={p.local.reviews} /></div>}
                </div>
                {site.scanned && (
                  <>
                    {site.services?.length > 0 && (
                      <div>
                        <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500 mb-2 flex items-center gap-1.5"><Layers size={13} /> Service pages {mine?.scanned ? <span className="normal-case font-normal">(red = you have no page)</span> : null}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {site.services.map(s => <span key={s} className={`px-2 py-0.5 rounded-md text-[12px] border ${mine?.scanned && !hasService(s) ? 'bg-rose-50 text-rose-800 border-rose-200' : 'bg-slate-50 text-slate-700 border-slate-200'}`}>{s}</span>)}
                        </div>
                      </div>
                    )}
                    {site.location_pages?.length > 0 && (
                      <div>
                        <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500 mb-2 flex items-center gap-1.5"><MapPin size={13} /> Area pages</div>
                        <Chips items={site.location_pages} />
                      </div>
                    )}
                    <div className="grid grid-cols-3 gap-2 text-center">
                      {[[FileText, 'Words per page', fmt(site.avg_words), mine?.scanned ? `you: ${fmt(mine.avg_words)}` : ''],
                        [BookOpen, 'Blog', site.blog ? 'Yes' : 'No', mine?.scanned ? `you: ${mine.blog ? 'yes' : 'no'}` : ''],
                        [Code2, 'Schema', (site.schema || []).length, (site.schema || []).slice(0, 2).join(', ')]].map(([Icon, label, value, sub]) => (
                        <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2">
                          <div className="text-[10.5px] uppercase tracking-wide text-slate-500 flex items-center justify-center gap-1"><Icon size={11} />{label}</div>
                          <div className="text-[15px] font-bold text-slate-900">{value}</div>
                          <div className="text-[10.5px] text-slate-500 truncate" title={sub}>{sub}</div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {p.link_sources.length > 0 && (
                  <div>
                    <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500 mb-2 flex items-center gap-1.5"><Link2 size={13} /> Listed / linked on</div>
                    <div className="flex flex-wrap gap-1.5">{p.link_sources.map(s => <a key={s.domain} href={s.url} target="_blank" rel="noreferrer" className="px-2 py-0.5 rounded-md text-[12px] border bg-white text-slate-700 border-slate-200 hover:border-indigo-300 hover:text-indigo-700">{baseSite(s.domain)}</a>)}</div>
                  </div>
                )}
                {p.backlinks && <p className="text-[12.5px] text-slate-600">Backlinks: <b>{fmt(p.backlinks.backlinks)}</b> from <b>{fmt(p.backlinks.referring_domains)}</b> sites (DataForSEO).</p>}
              </div>
            </div>
          </Card>
        );
      })}

      <Card title="Every site on page 1" subtitle="All sites in Google's top 10 for your keywords, by visibility" pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 text-left text-[11.5px] uppercase tracking-wide text-slate-500">
              <tr><th className="px-5 py-2.5 font-semibold">Site</th><th className="px-3 py-2.5 font-semibold">Type</th><th className="px-3 py-2.5 font-semibold text-right">Visibility</th><th className="px-3 py-2.5 font-semibold text-right">Keywords on page 1</th><th className="px-3 py-2.5 font-semibold text-right">Top 3</th><th className="px-3 py-2.5 font-semibold text-right">Avg position</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {r.organic_competitors.map(d => (
                <tr key={d.domain}>
                  <td className="px-5 py-2.5 font-medium text-slate-900">{d.domain}</td>
                  <td className="px-3 py-2.5">{d.type === 'directory' ? <Badge tone="violet">Listing site</Badge> : <Badge tone="blue">Business</Badge>}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{d.visibility}%</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{d.keywords_top10}/{r.keywords.length}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{d.keywords_top3}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{d.avg_position}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function MapsTab({ r }) {
  const maxReviews = Math.max(1, ...r.local_competitors.map(e => e.reviews || 0), r.business.reviews || 0);
  const you = { name: `${r.business.name} (you)`, rating: r.business.rating, reviews: r.business.reviews || 0, appearances: r.summary.local_ranked,
    best: Math.min(...Object.values(r.you.local), Infinity), visibility: r.summary.local_visibility, mine: true };
  const rows = [you, ...r.local_competitors].sort((a, b) => b.visibility - a.visibility);
  return (
    <Card title="Google Maps competitors" subtitle="Businesses Google Maps shows for your keywords, by how often and how high they appear" pad={false}>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50 text-left text-[11.5px] uppercase tracking-wide text-slate-500">
            <tr><th className="px-5 py-2.5 font-semibold">Business</th><th className="px-3 py-2.5 font-semibold text-right">Visibility</th><th className="px-3 py-2.5 font-semibold text-center">Best</th><th className="px-3 py-2.5 font-semibold text-right">In results</th><th className="px-3 py-2.5 font-semibold">Rating</th><th className="px-3 py-2.5 font-semibold w-44">Reviews</th><th className="px-5 py-2.5 font-semibold">Website</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(e => (
              <tr key={e.name} className={e.mine ? 'bg-emerald-50/50' : ''}>
                <td className="px-5 py-2.5"><div className={`font-medium ${e.mine ? 'text-emerald-800' : 'text-slate-900'}`}>{e.name}</div>{e.category && <div className="text-[12px] text-slate-500">{e.category}</div>}</td>
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{e.visibility}%</td>
                <td className="px-3 py-2.5 text-center"><Pos value={Number.isFinite(e.best) ? e.best : null} maps /></td>
                <td className="px-3 py-2.5 text-right tabular-nums">{e.appearances}/{r.keywords.length}</td>
                <td className="px-3 py-2.5"><Stars rating={e.rating} /></td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2" title={`${fmt(e.reviews)} reviews`}>
                    <span className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><span className={`block h-full rounded-full ${e.mine ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${((e.reviews || 0) / maxReviews) * 100}%` }} /></span>
                    <span className="w-12 text-right tabular-nums text-slate-700">{fmt(e.reviews)}</span>
                  </div>
                </td>
                <td className="px-5 py-2.5">{e.website ? <a href={e.website} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline inline-flex items-center gap-1"><Globe size={12} />{e.domain || 'site'}</a> : <span className="text-slate-400">{e.mine ? '' : 'None'}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function LinksTab({ r, setupInfo }) {
  const cols = [{ key: 'you', label: 'You', sources: r.you.link_sources }, ...r.profiles.map(p => ({ key: p.domain, label: p.domain, sources: p.link_sources }))];
  const sites = [...new Set(cols.flatMap(c => c.sources.map(s => baseSite(s.domain))))];
  const count = (site) => cols.slice(1).filter(c => c.sources.some(s => baseSite(s.domain) === site)).length;
  sites.sort((a, b) => count(b) - count(a));
  const gaps = r.gaps.listings;
  return (
    <div className="space-y-5">
      <Card title="Where you and your competitors are listed and linked" subtitle="Sites Google shows for each business's name: listings, social profiles, articles and other sites that mention them" pad={false}>
        {sites.length === 0 ? <p className="px-6 py-8 text-center text-[13px] text-slate-500">No listings or mentions found.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-slate-50 text-left text-[11.5px] uppercase tracking-wide text-slate-500">
                <tr><th className="px-5 py-2.5 font-semibold">Site</th>{cols.map(c => <th key={c.key} className={`px-3 py-2.5 font-semibold text-center normal-case max-w-[120px] truncate ${c.key === 'you' ? 'text-emerald-700' : ''}`} title={c.label}>{c.label}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sites.map(site => {
                  const mineHas = cols[0].sources.some(s => baseSite(s.domain) === site);
                  // A gap worth closing: a listing site, or a site several competitors share.
                  const listing = cols.some(c => c.sources.some(x => baseSite(x.domain) === site && x.type === 'directory'));
                  const missing = !mineHas && (listing || count(site) >= 2);
                  return (
                    <tr key={site} className={missing ? 'bg-rose-50/40' : ''}>
                      <td className="px-5 py-2.5 font-medium text-slate-900">{site}{missing && <span className="ml-2"><Badge tone="red">You're missing</Badge></span>}</td>
                      {cols.map(c => {
                        const hit = c.sources.find(s => baseSite(s.domain) === site);
                        return <td key={c.key} className="px-3 py-2.5 text-center">{hit ? <a href={hit.url} target="_blank" rel="noreferrer" title={hit.title} className="inline-flex text-emerald-600 hover:text-emerald-800"><CheckCircle2 size={16} /></a> : <Minus size={16} className="inline text-slate-300" />}</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-5 py-3 border-t border-slate-200 text-[12px] text-slate-500">
          {setupInfo.backlinks
            ? 'Backlink totals come from DataForSEO; the table shows the listings Google surfaces for each name.'
            : <>These are the links and listings Google shows for each name, not a full backlink index. Connect DataForSEO (<code className="font-mono">DATAFORSEO_LOGIN</code> / <code className="font-mono">DATAFORSEO_PASSWORD</code>) for total backlinks and referring domains.</>}
        </div>
      </Card>
      {gaps.length > 0 && (
        <Card title="Listings to get" subtitle="Listing sites your competitors use, or that rank for your keywords, where you were not found">
          <div className="flex flex-wrap gap-2">
            {gaps.map(g => <span key={g.domain} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-[13px]"><Link2 size={13} className="text-indigo-500" /><b className="text-slate-900">{g.domain}</b><span className="text-slate-500">seen {g.seen}×</span></span>)}
          </div>
          <Link to="/off-page-seo" className="mt-3 inline-block text-[12.5px] font-semibold text-indigo-700 hover:underline">Manage citations →</Link>
        </Card>
      )}
    </div>
  );
}

function Research({ b }) {
  const [toast, toastNode] = useToast();
  const [busy, error, run] = useAction();
  const [state, setState] = useState(null); // { run, defaults, setup }
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState('overview');

  const load = async () => {
    try { setState(await api(`/businesses/${b.id}/competitor-research`)); setLoadError(''); } catch (e) { setLoadError(e.message); }
  };
  useEffect(() => { load(); }, [b.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = state?.run;
  usePoll(async () => {
    const r = await api(`/competitor-research/${current.id}`).catch(() => null);
    if (r) setState(s => ({ ...s, run: r }));
    if (r?.status === 'done') toast('Competitor research is ready.');
  }, isRunning(current), 2500);

  const start = (keywords, location) => run('start', async () => {
    const r = await api(`/businesses/${b.id}/competitor-research`, { method: 'POST', body: { keywords, location } });
    setState(s => ({ ...s, run: r }));
    setTab('overview');
  });

  const result = current?.status === 'done' ? current.result : null;
  // While a new run is going, keep showing nothing stale: the progress card takes the space.
  const defaults = useMemo(() => (current?.result?.keywords && !result ? { ...state?.defaults, keywords: current.result.keywords }
    : result ? { keywords: result.keywords, location: result.location || state?.defaults?.location } : state?.defaults || { keywords: [], location: '' }), [current, result, state?.defaults]);

  if (!state) return loadError ? <ErrorNote>{loadError}</ErrorNote> : <div className="flex items-center gap-2 text-[13px] text-slate-500"><Loader2 size={15} className="animate-spin" /> Loading…</div>;
  const p = current?.result?.progress;

  return (
    <div className="space-y-5">
      {toastNode}
      <Setup b={b} defaults={defaults} onStart={start} busy={busy === 'start' || isRunning(current)} error={error} setupInfo={state.setup} hasRun={Boolean(result)} />

      {isRunning(current) && (
        <Card>
          <div className="flex items-center gap-3">
            <Loader2 size={18} className="animate-spin text-indigo-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-semibold text-slate-900">Researching competitors…</div>
              <div className="text-[12.5px] text-slate-500 truncate">{p?.step || 'Starting'}</div>
              <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${p ? Math.round((p.done / p.total) * 100) : 4}%` }} /></div>
            </div>
          </div>
        </Card>
      )}
      {current?.status === 'failed' && <ErrorNote>{current.error || 'The research failed.'}</ErrorNote>}

      {result && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Tabs value={tab} onChange={setTab} tabs={[
              { id: 'overview', label: 'Overview' },
              { id: 'keywords', label: 'Keyword positions', count: result.keywords.length },
              { id: 'competitors', label: 'Competitors', count: result.profiles.length },
              { id: 'maps', label: 'Google Maps', count: result.local_competitors.length },
              { id: 'links', label: 'Links & listings' },
              { id: 'plan', label: 'Action plan', count: result.actions.length }
            ]} />
            <span className="text-[12px] text-slate-500 mb-5 inline-flex items-center gap-1.5"><RotateCcw size={12} /> Researched {fmtDateTime(result.analysed_at)} · {result.location || 'India'}</span>
          </div>
          {tab === 'overview' && <Overview r={result} goto={setTab} />}
          {tab === 'keywords' && <KeywordPositions r={result} />}
          {tab === 'competitors' && <Competitors r={result} />}
          {tab === 'maps' && <MapsTab r={result} />}
          {tab === 'links' && <LinksTab r={result} setupInfo={state.setup} />}
          {tab === 'plan' && (
            <Card title="Action plan" subtitle="What to change to outrank these competitors, most important first">
              <ActionList actions={result.actions} />
              {result.gaps.keywords.length > 0 && (
                <div className="mt-5">
                  <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500 mb-2 flex items-center gap-1.5"><ListChecks size={13} /> Keywords where competitors are on page 1 and you are not</div>
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {result.gaps.keywords.map(g => (
                      <li key={g.keyword} className="px-4 py-2.5 flex flex-wrap items-center gap-2 text-[13px]">
                        <b className="text-slate-900">{g.keyword}</b>
                        <span className="text-slate-500">·</span>
                        {g.competitors.map(c => <span key={c.domain} className="inline-flex items-center gap-1 text-slate-600">{c.domain}<Pos value={c.position} /></span>)}
                        {g.you_local && <span className="ml-auto text-[12px] text-emerald-700 inline-flex items-center gap-1"><MapPin size={12} /> you are #{g.you_local} in Maps</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="mt-4 text-[11.5px] text-slate-500 flex items-center gap-1.5"><Sparkles size={12} /> Based on live Google results ({result.sources.credits} searches) and a scan of the top competitors' websites.</p>
            </Card>
          )}
        </>
      )}

      {!result && !isRunning(current) && current?.status !== 'failed' && state.setup.google_results && (
        <Card>
          <div className="flex items-start gap-3 text-[13px] text-slate-600">
            <Trophy size={18} className="text-amber-500 shrink-0 mt-0.5" />
            <p>Check the keywords above and press <b>Research competitors</b>. You'll see who ranks on Google and in Google Maps for each one, where you stand, what the top competitors do on their sites, where they are listed, and a plan to catch up.</p>
          </div>
        </Card>
      )}
    </div>
  );
}

export default function CompetitorFinderPage() {
  return (
    <SeoShell title="Competitor Research" subtitle="Who outranks you on Google and Google Maps, the keywords and pages they win with, where they are listed, and what to do">
      {(b) => <Research key={b.id} b={b} />}
    </SeoShell>
  );
}
