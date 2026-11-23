import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DataTable, { downloadCsv } from './DataTable';
import { Link } from 'react-router-dom';
import {
  Sparkles, Check, ChevronRight, Globe, ShieldCheck, AlertTriangle, RefreshCw,
  FileText, MapPin, Instagram, Facebook, Linkedin, Copy, Plus, CalendarDays,
  Flame, TrendingUp, TrendingDown, Search, Clock, ArrowUpRight, CheckCircle2, Lock, Sliders,
  Send, ExternalLink, Link2, Share2, Layers, Award, Tag, BarChart3, Code, Eye, Download
} from 'lucide-react';
import {
  SeoShell, Card, Tabs, Badge, StatusPill, Button, Field, inputCls, areaCls,
  useToast, useAction, useUrlTab, useDoubleConfirm, ErrorNote
} from './SeoUi';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts';
import { api, fmt, useApi, usePoll } from './seoApi';
import SitePublishPanel, { postStatusOf, canDeletePost, useDeleteWebsitePost } from './SitePublishPanel';
import FeaturedImageField, { featuredOf } from './FeaturedImageField';
import BlogImageAnalysis from './BlogImageAnalysis';
import ReactSitePanel from './ReactSitePanel';
import HtmlSitePanel from './HtmlSitePanel';
import RegenerateContent, { SeoField } from './RegenerateContent';
import { PUB_STATUS, PublishingCalendar, ScheduleModal, cancelSchedule, retrySchedule, scheduleText } from './ArticleScheduling';
import { KeywordTopicPlanner, LayoutCheckCard, PromoteCard, ResumeCard, ArticleDownloads } from './BlogFlow';
import { slugify, highlightHtml, splitKeywords, crumb, MARK_STYLE, paragraphCoverage, brandOf } from './keywordHighlight';


const STEPS = ['Topic & Intent', 'AI Draft', 'Images & Analysis', 'Real Details', 'Quality Checks', 'Publish & Schedule'];
const PUBLISH_STEP = STEPS.length - 1;

const stripTags = (html) => String(html || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const wordsOf = (t) => (String(t).match(/[\p{L}\p{N}'’-]+/gu) || []);
const digitsOnly = (t) => String(t || '').replace(/\D/g, '');

/**
 * Checks computed from the draft itself (no scores are invented): each one passes or fails on what is in the text right now.
 * `bench` is the real word count of the top Google results (median), when it was fetched.
 */
function qualityChecks({ draft, title, metaDescription, keyword, benchMedian }) {
  const text = stripTags(draft);
  const words = wordsOf(text);
  const kw = String(keyword || '').trim().toLowerCase();
  const has = (hay) => Boolean(kw) && norm(hay).includes(norm(kw));
  const headings = [...String(draft || '').matchAll(/<h[2-3]\b[^>]*>([\s\S]*?)<\/h[2-3]>/gi)].map(m => stripTags(m[1]));
  const mdHeadings = [...String(draft || '').matchAll(/^#{2,3}\s+(.+)$/gm)].map(m => m[1]);
  const heads = [...headings, ...mdHeadings];
  const first100 = words.slice(0, 100).join(' ');
  const sentences = text.split(/(?<=[.!?])\s+/).filter(x => wordsOf(x).length > 2);
  const avgSentence = sentences.length ? Math.round(words.length / sentences.length) : 0;
  const target = benchMedian || 0;
  const lo = target ? Math.round(target * 0.8) : 800;
  const out = [
    { id: 'title-kw', label: 'The keyword is in the SEO title', ok: has(title), fix: 'Put the main keyword in the title, near the start.' },
    { id: 'title-len', label: 'The SEO title is 30 to 60 characters', ok: String(title || '').trim().length >= 30 && String(title || '').trim().length <= 60, detail: `${String(title || '').trim().length} characters`, fix: 'Shorter titles are not cut off in Google results.' },
    { id: 'meta', label: 'The meta description is 70 to 160 characters and has the keyword', ok: String(metaDescription || '').trim().length >= 70 && String(metaDescription || '').trim().length <= 160 && has(metaDescription), detail: `${String(metaDescription || '').trim().length} characters`, fix: 'It is the text under the title in Google.' },
    { id: 'intro-kw', label: 'The keyword is in the first 100 words', ok: has(first100), fix: 'Say what the page is about, using the keyword, in the opening paragraph.' },
    { id: 'head-kw', label: 'The keyword is in at least one heading', ok: heads.some(h => has(h)), fix: 'Use the keyword in one H2 or H3.' },
    { id: 'heads', label: 'There are at least 3 sub-headings', ok: heads.length >= 3, detail: `${heads.length} found`, fix: 'Break the article into sections with H2/H3 headings.' },
    { id: 'length', label: target ? `Length is close to the top Google results (about ${target} words)` : 'The article is at least 800 words', ok: words.length >= lo, detail: `${words.length} words${target ? `, top results: ${target}` : ''}`, fix: target ? 'The pages that rank are about this long.' : 'Longer, useful articles tend to rank better.' },
    { id: 'faq', label: 'There is a FAQ section', ok: /faq|frequently asked|common questions/i.test(`${heads.join(' ')} ${text.slice(0, 4000)}`) || heads.some(h => /\?$/.test(h.trim())), fix: 'Add 3 to 5 real customer questions with short answers.' },
    { id: 'links', label: 'There is a link or a call to action', ok: /<a\s[^>]*href=|\]\(https?:|https?:\/\/|call |contact|book |visit /i.test(draft || ''), fix: 'Tell the reader what to do next: call, book or visit.' },
    { id: 'read', label: 'Sentences are short enough to read easily (about 22 words or fewer on average)', ok: Boolean(avgSentence) && avgSentence <= 22, detail: avgSentence ? `${avgSentence} words per sentence` : 'no text yet', fix: 'Split long sentences.' },
    { id: 'todo', label: 'No unfinished placeholders are left in the text', ok: !/\[(write|add|insert|todo|tbd)[^\]]*\]|lorem ipsum/i.test(draft || ''), fix: 'Replace every [Write about…] or [Add…] note with real details.' }
  ];
  return out;
}

/** The facts the article should use come from the business's own profile: nothing is made up here. */
function realDetailChecks(b, draft) {
  const flat = norm(stripTags(draft));
  const body = digitsOnly(stripTags(draft));
  const inText = (t) => Boolean(t) && flat.includes(norm(t));
  const services = (b.services || []).map(x => x?.name).filter(Boolean);
  const phone = digitsOnly(b.phone).slice(-9);
  const rows = [
    { id: 'name', label: 'The business name is mentioned', value: b.name, ok: inText(b.name) },
    { id: 'place', label: 'The city or area is mentioned', value: [b.area, b.city].filter(Boolean).join(', '), ok: Boolean(b.city) && (inText(b.city) || inText(b.area)) },
    { id: 'phone', label: 'The phone number is in the text', value: b.phone, ok: phone.length >= 7 && body.includes(phone) },
    { id: 'site', label: 'The website address is in the text', value: b.website, ok: Boolean(b.website) && flat.includes(norm(String(b.website).replace(/^https?:\/\//, '').replace(/\/$/, ''))) },
    { id: 'service', label: 'At least one of your services is named', value: services.slice(0, 4).join(', '), ok: services.some(inText) }
  ];
  return rows.filter(r => r.value);
}

// How many times a keyword appears (as a phrase, ignoring case and punctuation) in the title, meta description and body.
const norm = (t) => ` ${(String(t).toLowerCase().match(/\w+/g) || []).join(' ')} `;
const countIn = (text, kw) => { const k = norm(kw); return k.trim() ? norm(text).split(k).length - 1 : 0; };

const ratio = (g) => (/^\+\d+%$/.test(g || '') ? parseInt(g, 10) : null);
const intentOf = (kw, b) => {
  const k = kw.toLowerCase();
  const place = [b.city, b.area].filter(Boolean).map(p => p.toLowerCase());
  if (/near me/.test(k) || place.some(p => k.includes(p))) return 'Local';
  if (/\b(cost|price|book|appointment|insurance|buy|best)\b/.test(k)) return 'Transactional';
  return 'Informational';
};

/**
 * 1. Trending Topics Discovery Module: Google Ads Keyword Planner ideas, top by volume and rising by 3-month change
 *    (same API as Keyword Intelligence → Google Planner)
 */
function TrendingTopicsTab({ b, onSelectTopic }) {
  const [selected, setSelected] = useState({});  // keyword -> { keyword, rising }
  const pickedCount = Object.keys(selected).length;
  const toggle = (t) => setSelected(m => {
    const n = { ...m };
    if (n[t.title]) delete n[t.title];
    else if (Object.keys(n).length < 10) n[t.title] = { keyword: t.title, rising: t.category === 'rising' || t.category === 'breakout' };
    return n;
  });
  const [typed, setTyped] = useState('');
  const tracked = useApi(`/businesses/${b.id}/keywords`);
  const seeds = useMemo(
    () => [...new Set([...(tracked.data?.keywords || []).map(k => k.keyword), ...(b.seeds || [])])].slice(0, 6),
    [tracked.data, b.seeds]
  );
  const [picked, setPicked] = useState('');
  const seed = picked || seeds[0] || '';
  const doSearch = () => { const q = typed.trim().toLowerCase(); if (q) setPicked(q); };
  // Google Ads Keyword Planner: keyword ideas for the seed with monthly volume, 3-month change and 12-month history.
  const trend = useApi(seed ? `/keyword-planner/metrics?keyword=${encodeURIComponent(seed)}&limit=50&include_monthly=true` : null);
  const noData = trend.error?.status === 404; // Planner has no ideas for this seed: an empty result, not a failure
  const ideas = (!noData && trend.data?.keywords) || [];
  const seedIdea = ideas.find(r => r.keyword.toLowerCase() === String(trend.data?.seed_keyword || '').toLowerCase());

  const pctLabel = (v) => (v == null ? null : `${v >= 0 ? '+' : '-'}${Math.abs(Math.round(v))}%`);
  const toTopic = (r, category) => ({ id: `${category}-${r.keyword}`, title: r.keyword, category, velocity: pctLabel(r.three_month_change), score: r.avg_monthly_searches, competition: r.competition, intent: intentOf(r.keyword, b), source: 'Google Keyword Planner' });
  // Top = most-searched ideas; Rising = ideas whose searches grew most over the last 3 months.
  const topQueries = useMemo(() => [...ideas].sort((a, c) => (c.avg_monthly_searches || 0) - (a.avg_monthly_searches || 0)).slice(0, 20).map(r => toTopic(r, 'top')), [ideas, b]); // eslint-disable-line react-hooks/exhaustive-deps
  const risingQueries = useMemo(() => ideas.filter(r => (r.three_month_change ?? 0) > 0).sort((a, c) => c.three_month_change - a.three_month_change).slice(0, 20).map(r => toTopic(r, 'rising')), [ideas, b]); // eslint-disable-line react-hooks/exhaustive-deps
  const topics = [...risingQueries, ...topQueries];

  // Opening the writer: the topic becomes the first target keyword; the Keyword Planner ideas feed the keyword generator.
  const relatedAll = [...new Set(topics.map(t => t.title))];
  const openWriter = (t, others = []) => onSelectTopic({ ...t, related: relatedAll, selected: others });
  const createFromSelection = () => {
    const [first, ...rest] = Object.keys(selected);
    openWriter(topics.find(t => t.title === first) || { title: first }, rest);
  };


  const MON = { JANUARY: 'Jan', FEBRUARY: 'Feb', MARCH: 'Mar', APRIL: 'Apr', MAY: 'May', JUNE: 'Jun', JULY: 'Jul', AUGUST: 'Aug', SEPTEMBER: 'Sep', OCTOBER: 'Oct', NOVEMBER: 'Nov', DECEMBER: 'Dec' };
  const hist = seedIdea?.monthly_search_volumes || [];
  const pts = hist.map(m => ({ date: `${MON[m.month] || String(m.month).slice(0, 3)} '${String(m.year).slice(2)}`, value: m.monthly_searches || 0 }));
  const ch = seedIdea?.three_month_change;
  const classification = ch == null ? null : ch >= 10 ? 'rising' : ch <= -10 ? 'declining' : 'stable';
  const pctOf = (t) => (t.velocity === 'Breakout' ? 9999 : /^[+-]\d+%$/.test(t.velocity || '') ? parseInt(t.velocity, 10) : null);
  const COMP = { LOW: ['Low', 'green'], MEDIUM: ['Medium', 'amber'], HIGH: ['High', 'red'] };
  const tableFor = (rows, id) => (
    <DataTable bare rows={rows} rowKey={x => x.id} pageSize={10} sizes={[10, 20, 50]} exportName={`${id}-queries-${siteStem(b)}`} label="queries" searchPlaceholder="Search queries" minWidth={520} columnsMenu={false}
      rowClass={x => (selected[x.title] ? 'bg-indigo-50/60' : 'hover:bg-slate-50')}
      empty="Nothing found."
      filters={[
        { id: 'intent', label: 'Intent', options: [...new Set(rows.map(x => x.intent).filter(Boolean))].sort().map(x => [x, x]), test: (x, v) => x.intent === v },
        { id: 'change', label: 'Change', options: [['up', 'Growing'], ['30', 'Over +30%']], test: (x, v) => { const c = pctOf(x); return v === 'up' ? c != null && c > 0 : c != null && c >= 30; } },
        { id: 'comp', label: 'Competition', options: [['LOW', 'Low'], ['MEDIUM', 'Medium'], ['HIGH', 'High']], test: (x, v) => x.competition === v }
      ].filter(f => f.options.length > 1)}
      columns={[
        { id: 'pick', label: 'Select', csv: false, className: 'pl-4 pr-1 py-2 w-8', thClass: 'pl-4 pr-1 py-2.5 w-8', header: <span className="sr-only">Select</span>,
          cell: x => <input type="checkbox" className="w-4 rounded text-indigo-600 focus:ring-0 cursor-pointer" checked={Boolean(selected[x.title])} onChange={() => toggle(x)} aria-label={`Select ${x.title}`} title="Select to write an article (up to 10)" /> },
        { id: 'query', header: 'Query', value: x => x.title, className: 'px-2 py-2 text-slate-800' },
        { id: 'searches', header: 'Searches / mo', right: true, first: 'desc', value: x => x.score ?? null, className: 'px-2 py-2 text-right tabular-nums text-slate-600', cell: x => (x.score != null ? fmt(x.score) : <span className="text-slate-300">—</span>) },
        { id: 'change', header: 'Change', csv: false, right: true, first: 'desc', value: x => pctOf(x), className: 'px-2 py-2 text-right whitespace-nowrap',
          cell: x => { const c = pctOf(x); return x.velocity === 'Breakout' ? <Badge tone="blue">Breakout</Badge> : c != null ? <span className={`inline-flex items-center gap-0.5 text-12 font-semibold tabular-nums ${c >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{c >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}{Math.abs(c)}%</span> : <span className="text-slate-300">—</span>; } },
        { id: 'comp', header: 'Competition', csv: false, value: x => ({ LOW: 0, MEDIUM: 1, HIGH: 2 })[x.competition] ?? null, className: 'px-2 py-2', cell: x => (COMP[x.competition] ? <Badge tone={COMP[x.competition][1]}>{COMP[x.competition][0]}</Badge> : <span className="text-slate-300">—</span>) },
        { id: 'x_intent', header: 'Intent', hide: true, value: x => x.intent || '' }, // not shown, but part of the CSV so the file has the same facts as the filters
        { id: 'x_change', header: 'Change over 3 months (%)', hide: true, value: x => (x.velocity === 'Breakout' ? 'Breakout' : pctOf(x) ?? '') },
        { id: 'x_comp', header: 'Competition', hide: true, value: x => (COMP[x.competition] ? COMP[x.competition][0] : '') },
        { id: 'draft', header: 'Action', right: true, className: 'px-3 py-2 text-right whitespace-nowrap', thClass: 'px-3 py-2.5', cell: x => <button type="button" onClick={() => openWriter(x)} title="Create the brief and a draft for this query" className="text-12 font-semibold text-indigo-700 hover:underline cursor-pointer">Write it</button> }
      ]} />
  );
  return (
    <div className="space-y-3">
      {/* One toolbar: search, the seed keywords, and where the numbers come from */}
      <div className="rounded-xl bg-white ring-1 ring-slate-200 px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <form onSubmit={e => { e.preventDefault(); doSearch(); }} role="search" className="flex gap-2 flex-1 min-w-[260px] max-w-xl">
          <label className="relative flex-1"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="A keyword to find topics for (e.g. wedding dress rental)" aria-label="Keyword to find topics for" value={typed} onChange={e => setTyped(e.target.value)} className="w-full h-9 pl-9 pr-3 text-13 bg-white ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 rounded-lg outline-none" /></label>
          <Button type="submit" variant="primary" icon={Search} disabled={!typed.trim()}>Search</Button>
        </form>
        {seeds.length > 0 && <div className="flex flex-wrap items-center gap-1.5 text-12"><span className="text-slate-500">Topics for</span>{seeds.map(x => <button key={x} type="button" onClick={() => setPicked(x)} aria-pressed={x === seed} className={`h-7 px-2.5 rounded-full font-semibold cursor-pointer ring-1 ring-inset ${x === seed ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50'}`}>{x}</button>)}</div>}
        <span className="ml-auto inline-flex items-center gap-1.5 text-11.5 text-slate-500"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />Google Keyword Planner · India · last 12 months</span>
      </div>

      {pickedCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-indigo-50 ring-1 ring-indigo-200 text-12.5">
          <span className="text-indigo-900 font-semibold">{pickedCount} selected{pickedCount >= 10 ? ' (the most)' : ''} · starts with “{Object.keys(selected)[0]}”{pickedCount > 1 ? `, also: ${Object.keys(selected).slice(1).join(', ')}` : ''}</span>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setSelected({})}>Clear</Button>
            <Button size="sm" variant="ai" icon={Sparkles} onClick={createFromSelection}>Write an article</Button>
          </div>
        </div>
      )}

      {trend.error && !noData && !trend.loading && <ErrorNote>Google Keyword Planner is not answering right now ({trend.error.message}). Try again in a minute.</ErrorNote>}

      {trend.data && !noData && !trend.loading && (
        <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4 grid grid-cols-1 md:grid-cols-[minmax(220px,300px)_minmax(0,1fr)] gap-x-6 gap-y-3 items-center">
          <div>
            <div className="flex items-center gap-2 text-14 font-semibold text-slate-900">“{trend.data.seed_keyword}”{classification && <span className={`text-11.5 font-semibold capitalize px-2 py-0.5 rounded-full ${classification === 'rising' ? 'bg-emerald-50 text-emerald-700' : classification === 'declining' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{classification}</span>}</div>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-12">
              {[['Latest month', pts.length ? fmt(pts[pts.length - 1].value) : null], ['Average a month', seedIdea ? fmt(seedIdea.avg_monthly_searches) : null], ['3-month change', pctLabel(ch)], ['Topics found', relatedAll.length]].map(([l, v]) => (
                <div key={l}><dt className="text-slate-500">{l}</dt><dd className="text-16 font-semibold tabular-nums text-slate-900">{v ?? '—'}</dd></div>))}
            </dl>
          </div>
          {pts.length > 1 ? (
            <div className="h-36 min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={pts} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} minTickGap={24} />
                  <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} width={48} tickFormatter={v => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : v)} />
                  <Tooltip formatter={(v) => [fmt(v), 'Searches']} />
                  <Line type="monotone" dataKey="value" name="Searches" stroke="#4f46e5" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="text-12.5 text-slate-500">No month-by-month figures for this keyword.</p>}
        </div>
      )}

      {trend.error && !noData ? (
        <div className="py-10 text-center text-13 text-red-600">{trend.error.message}</div>
      ) : !seed ? (
        <div className="py-10 text-center text-13 text-slate-500">Add a primary category, a service or a tracked keyword to this business to load topics.</div>
      ) : trend.loading ? (
        <div className="py-10 text-center text-13 text-slate-500">Fetching Google Keyword Planner ideas for “{seed}”…</div>
      ) : !topics.length ? (
        <div className="py-10 text-center text-13 text-slate-500">No topics found for “{seed}”.</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
          <Card pad={false} title={`Top queries (${topQueries.length})`} subtitle="Most searched, by average searches a month">{tableFor(topQueries, 'top')}</Card>
          <Card pad={false} title={`Rising queries (${risingQueries.length})`} subtitle="Searches grew most in the last 3 months">{tableFor(risingQueries, 'rising')}</Card>
        </div>
      )}
    </div>
  );
}

const siteStem = (b) => String(b?.website || b?.name || 'site').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '') || 'site';
const ARTICLE_LENGTHS = [
  { id: 'short', label: 'Short', words: '~850 words', time: '~4 min' },
  { id: 'standard', label: 'Standard', words: '~2,000 words', time: '~12–13 min' },
  { id: 'long', label: 'Long', words: '~2,500 words', time: '~15–22 min' }
];
const mins = (sec) => (sec >= 60 ? `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s` : `${Math.round(sec)}s`);

const ARTICLE_STATUS = { pending: ['Pending', 'gray'], generating: ['Generating', 'blue'], completed: ['Completed', 'green'], failed: ['Failed', 'red'] };
// Generated articles list: the filter an article falls under, its accent colour, and the filter chips
const listKey = (x) => (x.status === 'completed' ? (x.publishing_status === 'publishing' ? 'scheduled' : x.publishing_status || 'draft') : x.status === 'failed' ? 'failed' : 'writing');
const ACCENT = { draft: 'bg-slate-300', scheduled: 'bg-amber-400', published: 'bg-emerald-500', failed: 'bg-rose-500', writing: 'bg-indigo-400' };
const LIST_FILTERS = [['all', 'All'], ['draft', 'Drafts'], ['scheduled', 'Scheduled'], ['published', 'Published'], ['failed', 'Failed'], ['writing', 'Writing']];
const DEST_NAME = { wordpress: 'WordPress', ghost: 'Ghost', shopify: 'Shopify', github: 'GitHub', webhook: 'Website' };

/**
 * 1b. Articles generated from the selected Google Trends keywords: one Ollama draft per keyword, each saved
 * separately. Opening one loads it into the E-E-A-T pipeline below.
 */
function ArticlesList({ b, articles, reload, openId, onOpen, toast = () => { } }) {
  const working = articles.some(a => a.status === 'pending' || a.status === 'generating');
  const handleOpen = (id) => {
    onOpen(id);
    setTimeout(() => {
      const el = document.getElementById('eeat-pipeline-workspace');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 350);  // the writer tab opens first, then the article loads
  };
  usePoll(() => reload(true), working, 3000);
  const [busy, error, run] = useAction();
  const [ask, confirmNode] = useDoubleConfirm();
  const retry = (id) => run(`r-${id}`, async () => { await api(`/businesses/${b.id}/articles/${id}/retry`, { method: 'POST' }); reload(true); });
  // A post on the React.js website (the WordPress one has its own Delete post below). Only this post is removed there; the article stays in GrowZen.
  const canDeleteReactPost = (x) => Boolean(x.react_post_id && x.react_status && x.react_status !== 'deleted');
  const delReactPost = (x) => ask({
    what: `the post "${x.title || x.keyword}" on your React.js website`,
    effect: 'Only this post is permanently removed from your website. The article stays in GrowZen, so you can publish it again later.',
    onConfirm: () => run(`p-${x.id}`, async () => {
      const r = await api(`/businesses/${b.id}/articles/${x.id}/react-post`, { method: 'DELETE' });
      setDeletedNote(r.already_gone ? `"${x.title || x.keyword}" was already gone from your website; marked as deleted.` : `"${x.title || x.keyword}" was permanently deleted from your website.`);
      reload(true);
    })
  });
  const del = (x) => ask({
    what: 'this article',
    effect: canDeletePost(x) || canDeleteReactPost(x)
      ? 'The article and its generated content are deleted from GrowZen. Its post stays on your website: use "Delete post" first to remove it there.'
      : 'The article and its generated content are deleted.',
    onConfirm: () => run(`d-${x.id}`, async () => { await api(`/businesses/${b.id}/articles/${x.id}`, { method: 'DELETE' }); if (openId === x.id) onOpen(null); reload(true); })
  });
  const [deletedNote, setDeletedNote] = useState('');
  const [askDeletePost, deletePostNode] = useDeleteWebsitePost(b, (updated, r) => {
    setDeletedNote(r.already_gone ? `"${updated.title || updated.keyword}" was already gone from your website; marked as deleted.` : `"${updated.title || updated.keyword}" was permanently deleted from your website.`);
    reload(true);
  });
  const done = articles.filter(a => a.status === 'completed').length;
  const [scheduling, setScheduling] = useState(null);  // { article, mode: 'schedule' | 'publish' }
  // the backend scheduler publishes; this only refreshes the list so a status change shows up
  usePoll(() => reload(true), articles.some(a => a.publishing_status === 'publishing' || a.publishing_status === 'scheduled'), 30000);
  const cancelSched = (x) => ask({
    what: 'this schedule', effect: 'The article goes back to Draft and will not be published automatically. Nothing on the website changes.',
    onConfirm: () => run(`c-${x.id}`, async () => { await cancelSchedule(b, x.id); toast('Schedule cancelled: the article is a draft again.'); reload(true); })
  });
  const retrySched = (x) => run(`t-${x.id}`, async () => {
    const r = await retrySchedule(b, x.id);
    reload(true);
    if (r.article.publishing_status !== 'published') throw new Error(r.error || 'Publishing failed again: see the error on the article.');
    toast('Published.');
  });

  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const counts = articles.reduce((acc, x) => ({ ...acc, [listKey(x)]: (acc[listKey(x)] || 0) + 1 }), {});
  const q = query.trim().toLowerCase();
  const shown = articles.filter(x => (filter === 'all' || listKey(x) === filter)
    && (!q || [x.title, x.keyword, ...(x.secondary_keywords || [])].some(s => (s || '').toLowerCase().includes(q))));

  return (
    <Card title="Generated articles" subtitle={`${done} of ${articles.length} written by Claude AI. Each article covers all the keywords you selected and is saved separately.`}>
      {confirmNode}
      {deletePostNode}
      {scheduling && <ScheduleModal b={b} article={scheduling.article} mode={scheduling.mode} toast={toast} onClose={() => setScheduling(null)} onDone={() => reload(true)} />}
      {deletedNote && <div className="mb-3 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-[12px] text-emerald-800 flex items-center gap-2"><CheckCircle2 size={13} /> {deletedNote}<button type="button" className="ml-auto text-emerald-700 hover:underline cursor-pointer" onClick={() => setDeletedNote('')}>Dismiss</button></div>}

      {/* status filters (with counts) + search */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex flex-wrap gap-1.5">
          {LIST_FILTERS.filter(([id]) => id === 'all' || counts[id] || filter === id).map(([id, lbl]) => (
            <button key={id} type="button" onClick={() => setFilter(id)}
              className={`h-8 px-3 rounded-full border text-[12px] font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${filter === id ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-700'}`}>
              {id !== 'all' && <span className={`w-1.5 h-1.5 rounded-full ${filter === id ? 'bg-white' : ACCENT[id]}`} />}
              {lbl}
              <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10.5px] inline-flex items-center justify-center ${filter === id ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}`}>{id === 'all' ? articles.length : counts[id] || 0}</span>
            </button>
          ))}
        </div>
        <label className="relative ml-auto w-full sm:w-64">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={`${inputCls} pl-8`} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search title or keyword" />
        </label>
        <Button size="sm" icon={Download} disabled={!shown.length} title={`Download the ${shown.length} article${shown.length === 1 ? '' : 's'} in this list (with the filter and search applied) as a CSV file`}
          onClick={() => downloadCsv(`generated-articles-${siteStem(b)}`, ['Title', 'Primary keyword', 'Other keywords', 'Status', 'Web address slug', 'Words', 'Length', 'Written in (minutes)', 'Created', 'Scheduled for', 'Published address'],
            shown.map(x => { const ps = x.status === 'completed' ? x.publishing_status : null; const views = [x.react_url && x.react_status !== 'deleted' && x.react_url, x.wp_url && x.wp_status !== 'deleted' && x.wp_url].filter(Boolean);
              return [x.title || '', x.keyword || '', (x.secondary_keywords || []).join(', '), (ps ? (PUB_STATUS[ps] || PUB_STATUS.draft)[0] : x.status === 'failed' ? 'Writing failed' : (ARTICLE_STATUS[x.status] || ARTICLE_STATUS.pending)[0]), x.slug || '', x.stats?.words ?? '', x.stats ? (ARTICLE_LENGTHS.find(l => l.id === x.stats.length)?.label || 'Standard') : '', x.stats?.total_seconds != null ? Math.round(x.stats.total_seconds / 6) / 10 : '', x.created_at || '', x.schedule?.planned_for || '', views.join('; ')]; }))}>Export CSV</Button>
      </div>

      <div className="space-y-3">
        {shown.map(x => {
          const key = listKey(x);
          const ps = x.status === 'completed' ? x.publishing_status : null;  // draft | scheduled | publishing | published | failed
          const [label, tone] = ps ? PUB_STATUS[ps] || PUB_STATUS.draft : x.status === 'failed' ? ['Writing failed', 'red'] : ARTICLE_STATUS[x.status] || ARTICLE_STATUS.pending;
          const site = postStatusOf(x);
          const isOpen = openId === x.id;
          const kws = x.secondary_keywords || [];
          const views = [
            x.react_url && x.react_status !== 'deleted' && ['React.js website', x.react_url],
            x.wp_url && x.wp_status !== 'deleted' && [DEST_NAME[x.publish_method] || 'Website', x.wp_url]
          ].filter(Boolean);
          return (
            <article key={x.id} className={`relative rounded-2xl border bg-white overflow-hidden transition-shadow hover:shadow-md ${isOpen ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-slate-200'}`}>
              <span className={`absolute left-0 inset-y-0 w-1 ${ACCENT[key]}`} aria-hidden="true" />
              <div className="pl-5 pr-4 pt-3.5 pb-3">
                {/* badges + date */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={tone} title={ps ? 'Publishing status in GrowZen' : 'Writing status'}>
                    {(ps === 'publishing' || x.status === 'generating') && <RefreshCw size={11} className="animate-spin" />}{label}
                  </Badge>
                  {site && <Badge tone={site[1]} title={x.wp_post_id ? `Post #${x.wp_post_id}` : undefined}><Globe size={10} /> {DEST_NAME[x.publish_method] || 'WordPress'} · {site[0]}</Badge>}
                  {x.react_status && (() => {
                    const [l, t] = { publish: ['Published', 'green'], draft: ['Draft', 'gray'], scheduled: ['Scheduled', 'amber'], deleted: ['Deleted', 'red'] }[x.react_status] || [x.react_status, 'gray'];
                    return <Badge tone={t} title={`React.js website post ${x.react_post_id}`}><Code size={10} /> React · {l}</Badge>;
                  })()}
                  {isOpen && <Badge tone="blue">Open in the writer</Badge>}
                  <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-slate-400"><CalendarDays size={11} /> {x.created_at ? new Date(x.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</span>
                </div>

                {/* title + facts */}
                <h3 className="mt-2 text-[14.5px] font-bold text-slate-900 leading-snug">
                  {x.status === 'completed'
                    ? <button type="button" className="text-left hover:text-indigo-700 cursor-pointer" onClick={() => handleOpen(x.id)}>{x.title || x.keyword}</button>
                    : x.title || x.keyword}
                </h3>
                {x.status === 'completed' && x.stats && (
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-slate-500" title={(x.stats.steps || []).map(st => `${st.step}: ${mins(st.seconds)}, ${st.calls} call${st.calls === 1 ? '' : 's'}`).join('\n')}>
                    <span className="inline-flex items-center gap-1"><FileText size={12} /> {fmt(x.stats.words)} words</span>
                    <span className="inline-flex items-center gap-1"><Layers size={12} /> {ARTICLE_LENGTHS.find(l => l.id === x.stats.length)?.label || 'Standard'}</span>
                    <span className="inline-flex items-center gap-1"><Clock size={12} /> written in {mins(x.stats.total_seconds)}</span>
                    <span className="inline-flex items-center gap-1"><Sparkles size={12} /> {x.stats.ollama_calls || x.stats.calls || 1} Claude AI calls</span>
                  </div>
                )}

                {/* keywords */}
                <div className="mt-2.5 flex flex-wrap gap-1.5" title={[x.keyword, ...kws].join(', ')}>
                  <span className="px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-[11px] font-semibold text-indigo-800">{x.keyword}</span>
                  {kws.slice(0, 5).map(k => <span key={k} className="px-2 py-0.5 rounded-md bg-slate-50 border border-slate-200 text-[11px] text-slate-600">{k}</span>)}
                  {kws.length > 5 && <span className="px-2 py-0.5 rounded-md text-[11px] text-slate-500">+{kws.length - 5} more</span>}
                </div>

                {/* what is happening with it */}
                {x.status === 'generating' && (
                  <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-50 border border-indigo-100 text-[12px] text-indigo-800">
                    <RefreshCw size={12} className="animate-spin shrink-0" /> {x.progress ? `${x.progress}…` : 'Claude AI is writing this article…'}
                  </div>
                )}
                {x.status === 'pending' && <div className="mt-3 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-[12px] text-slate-600">Waiting to start writing…</div>}
                {x.status === 'failed' && x.error && <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-[12px] text-rose-800"><AlertTriangle size={13} className="shrink-0 mt-0.5" /> {x.error}</div>}
                {x.schedule?.attempts > 0 && x.schedule?.error && ps === 'scheduled' && (
                  <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-[12px] text-rose-800">
                    <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                    <span>The scheduled time came{x.schedule.planned_for ? ` (${new Date(x.schedule.planned_for).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })})` : ''} but publishing failed ({x.schedule.attempts} {x.schedule.attempts === 1 ? 'try' : 'tries'}). It tries again at <b>{scheduleText(x.schedule)}</b>.<span className="block mt-0.5 text-rose-700/90">{x.schedule.error}</span></span>
                  </div>
                )}
                {x.schedule && (ps === 'scheduled' || ps === 'publishing') && !(x.schedule.attempts > 0 && x.schedule.error) && (
                  <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[12px] text-amber-900">
                    <Clock size={13} className="shrink-0" /> <span>{ps === 'publishing' ? 'Publishing now to ' : 'Publishes automatically: '}<b>{scheduleText(x.schedule)}</b></span>
                  </div>
                )}
                {ps === 'failed' && (
                  <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-[12px] text-rose-800">
                    <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                    <span>Scheduled publishing failed{x.schedule ? ` (was due ${scheduleText(x.schedule)})` : ''}.{x.schedule?.error ? <span className="block text-rose-700/90 mt-0.5">{x.schedule.error}</span> : null}</span>
                  </div>
                )}
                {ps === 'draft' && <div className="mt-3 text-[11.5px] text-slate-500">Saved in GrowZen only: schedule it or publish it now when it is ready.</div>}
              </div>

              {/* actions */}
              <div className="pl-5 pr-3 py-2.5 border-t border-slate-100 bg-slate-50/60 flex flex-wrap items-center gap-2">
                {x.status === 'completed' && (isOpen
                  ? <span className="h-[30px] px-3 inline-flex items-center gap-1.5 text-[12px] font-semibold text-emerald-700"><CheckCircle2 size={13} /> Open in the writer</span>
                  : <Button size="sm" icon={Eye} onClick={() => handleOpen(x.id)}>Review &amp; edit</Button>)}
                {x.status === 'completed' && <ArticleDownloads b={b} article={x} />}
                {ps === 'draft' && <Button size="sm" icon={CalendarDays} onClick={() => setScheduling({ article: x, mode: 'schedule' })}>Schedule</Button>}
                {ps === 'draft' && <Button size="sm" variant="primary" icon={Send} onClick={() => setScheduling({ article: x, mode: 'publish' })}>Publish now</Button>}
                {ps === 'failed' && <Button size="sm" variant="primary" icon={RefreshCw} busy={busy === `t-${x.id}`} onClick={() => retrySched(x)}>Retry now</Button>}
                {(ps === 'scheduled' || ps === 'failed') && <Button size="sm" icon={CalendarDays} onClick={() => setScheduling({ article: x, mode: 'schedule' })}>Reschedule</Button>}
                {(ps === 'scheduled' || ps === 'failed') && <Button size="sm" variant="ghost" busy={busy === `c-${x.id}`} onClick={() => cancelSched(x)}>Cancel schedule</Button>}
                {x.status === 'failed' && <Button size="sm" variant="primary" icon={RefreshCw} busy={busy === `r-${x.id}`} onClick={() => retry(x.id)}>Retry writing</Button>}
                {views.map(([where, url]) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer" title={url}
                    className="h-[30px] px-3 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 text-xs font-semibold inline-flex items-center gap-1.5">
                    <ExternalLink size={12} /> View on {views.length > 1 ? where : 'website'}
                  </a>
                ))}
                <span className="ml-auto flex items-center gap-1">
                  {canDeletePost(x) && <Button size="sm" variant="ghost" className="!text-rose-600" onClick={() => askDeletePost(x)}>Delete post</Button>}
                  {canDeleteReactPost(x) && <Button size="sm" variant="ghost" className="!text-rose-600" busy={busy === `p-${x.id}`} title="Delete this post from the React.js website" onClick={() => delReactPost(x)}>Delete post</Button>}
                  <Button size="sm" variant="ghost" className="!text-slate-500 hover:!text-rose-600" busy={busy === `d-${x.id}`} title="Remove from GrowZen" onClick={() => del(x)}>Delete</Button>
                </span>
              </div>
            </article>
          );
        })}
        {!shown.length && (
          <div className="py-10 text-center rounded-2xl border border-dashed border-slate-200 text-[12.5px] text-slate-500">
            No {filter === 'all' ? '' : `${(LIST_FILTERS.find(([id]) => id === filter) || [])[1]?.toLowerCase()} `}articles{q ? ` match "${query.trim()}"` : ''}.
            {(filter !== 'all' || q) && <button type="button" className="ml-1 font-semibold text-indigo-700 hover:underline cursor-pointer" onClick={() => { setFilter('all'); setQuery(''); }}>Show all</button>}
          </div>
        )}
      </div>
      <ErrorNote>{error}</ErrorNote>
    </Card>
  );
}

/** "Generated Articles" tab: every article of this account, with its status and actions. */
function GeneratedArticlesTab({ b, openId, onOpen, onWrite, toast }) {
  const list = useApi(`/businesses/${b.id}/articles`);
  const articles = list.data?.articles || [];
  if (!list.data && !list.error) return <div className="py-10 text-center text-[13px] text-slate-500"><RefreshCw size={14} className="inline animate-spin mr-1.5" />Loading articles…</div>;
  if (list.error) return <ErrorNote>{list.error.message || String(list.error)}</ErrorNote>;
  if (!articles.length) {
    return (
      <Card title="Generated articles">
        <div className="py-10 text-center">
          <FileText size={28} className="mx-auto text-slate-300" />
          <p className="mt-2 text-[13px] text-slate-600">No articles yet. Write your first blog with Claude AI.</p>
          <div className="mt-3"><Button variant="primary" icon={Sparkles} onClick={onWrite}>Write an article</Button></div>
        </div>
      </Card>
    );
  }
  return <ArticlesList b={b} articles={articles} reload={list.reload} openId={openId} onOpen={onOpen} toast={toast} />;
}

/** The single "AI Blog & Article Writer" tab: the generated articles on top, the E-E-A-T pipeline for the open one below. */
function BlogStudioTab({ b, activeTopic, openId, setOpenId, onPickTopic, onScheduled, onShowArticles, toast }) {
  const list = useApi(`/businesses/${b.id}/articles`);
  const articles = list.data?.articles || [];
  const full = useApi(openId ? `/businesses/${b.id}/articles/${openId}` : null);
  const article = openId && full.data?.id === openId ? full.data : null;
  const [pendingId, setPendingId] = useState(null);  // an article started from the writer: opened as soon as it is written
  const pending = pendingId ? articles.find(x => x.id === pendingId) : null;
  const pendingFull = useApi(pendingId ? `/businesses/${b.id}/articles/${pendingId}` : null);  // the text written so far
  usePoll(() => pendingFull.reload(true), Boolean(pendingId), 1000);
  usePoll(() => list.reload(true), Boolean(pendingId), 2000);
  // a scheduled article is published by the server at its time: refresh on our own so the page shows it without F5
  const waiting = s => s === 'scheduled' || s === 'publishing';
  const anyWaiting = articles.some(x => waiting(x.publishing_status)) || waiting(article?.publishing_status);
  usePoll(() => {
    if (document.visibilityState !== 'visible') return;
    list.reload(true);
    if (openId) full.reload(true);
  }, anyWaiting && !pendingId, 30000);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!pendingId) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pendingId]);
  const pendingLength = ARTICLE_LENGTHS.find(l => l.id === pending?.length) || ARTICLE_LENGTHS[1];
  const elapsed = pending?.created_at ? Math.max(0, (now - new Date(pending.created_at).getTime()) / 1000) : 0;
  const preview = pendingFull.data?.id === pendingId ? pendingFull.data.body : '';

  const generate = async ({ topic, keywords, length }) => {
    const r = await api(`/businesses/${b.id}/articles/generate`, { method: 'POST', body: { topic, length, keywords: keywords.map(k => ({ keyword: k })) } });
    setPendingId(r.articles[0].id);
    setOpenId(null);
    list.reload(true);
  };
  useEffect(() => {
    const a = pendingId && articles.find(x => x.id === pendingId);
    if (!a) return;
    if (a.status === 'completed') { setOpenId(a.id); setPendingId(null); }
    else if (a.status === 'failed') setPendingId(null);
  }, [articles, pendingId, setOpenId]);

  const done = article && article.status === 'completed';
  const showStart = !openId && !pendingId && !activeTopic;
  return (
    <div className="space-y-4">
      {pendingId && (
        <div className="flex items-center gap-2.5 p-3 rounded-xl bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 text-[12.5px] text-indigo-900 shadow-xs">
          <RefreshCw size={14} className="animate-spin text-indigo-600 shrink-0" />
          <span className="font-bold">AI is writing your blog live with Claude ({pendingLength.label})</span>
          <span className="text-indigo-700 truncate hidden sm:inline">— {pending?.progress || 'Streaming line by line below…'}</span>
          <span className="ml-auto font-mono text-[11px] font-semibold text-slate-500 shrink-0">Elapsed {mins(elapsed)}</span>
        </div>
      )}
      {!showStart && !pendingId && <div><button type="button" onClick={() => { setOpenId(null); onPickTopic(null); }} className="text-12.5 font-semibold text-indigo-600 hover:underline cursor-pointer">← Back to my blogs and a new topic</button></div>}
      {/* on "Keywords & topic" the Topic & Intent form is always shown */}
      {openId && !article
        ? <div className="py-10 text-center text-[13px] text-slate-500">Loading the article…</div>
        : <BlogWriterTab key={article ? `a${article.id}` : `t${activeTopic?.title || ''}`} b={b} selectedTopic={activeTopic} selectedArticle={article} pendingArticle={pendingId ? (pendingFull.data?.id === pendingId ? pendingFull.data : pending) : null} pendingLength={pendingLength} elapsed={elapsed} onGenerate={generate} generating={Boolean(pendingId)}
          onSaved={() => { full.reload(true); list.reload(true); }} onScheduled={onScheduled} toast={toast} />}

      {done && <LayoutCheckCard b={b} article={article} />}
      {done && <PromoteCard b={b} article={article} />}

      {/* the full list lives on the Generated Articles tab; here only a summary with a shortcut */}
      {articles.length > 0 && (() => {
        const c = articles.reduce((acc, x) => ({ ...acc, [listKey(x)]: (acc[listKey(x)] || 0) + 1 }), {});
        return (
          <div className="flex flex-wrap items-center gap-3 p-4 rounded-2xl border border-slate-200 bg-white">
            <span className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center"><FileText size={17} /></span>
            <div className="flex-1 min-w-[200px]">
              <div className="text-[13px] font-bold text-slate-900">{articles.length} generated article{articles.length === 1 ? '' : 's'}</div>
              <div className="flex flex-wrap gap-x-3 text-[11.5px] text-slate-500 mt-0.5">
                {LIST_FILTERS.filter(([id]) => id !== 'all' && c[id]).map(([id, lbl]) => (
                  <span key={id} className="inline-flex items-center gap-1"><span className={`w-1.5 h-1.5 rounded-full ${ACCENT[id]}`} />{c[id]} {lbl.toLowerCase()}</span>
                ))}
              </div>
            </div>
            {onShowArticles && <Button size="sm" icon={ArrowUpRight} onClick={onShowArticles}>View all articles</Button>}
          </div>
        );
      })()}

      {/* last section: the drafts to carry on with, under the generated-articles summary */}
      {showStart && <ResumeCard articles={articles} onOpen={setOpenId} />}
    </div>
  );
}
/**
 * 2. 7-Step AI Blog Writer & E-E-A-T Quality Gate
 */
/** Every blog should have its own title and its own image: say so when another article of this project has the same. */
function DuplicateNotice({ b, article, title, image }) {
  const d = useApi(`/businesses/${b.id}/articles/${article.id}/duplicates`);
  useEffect(() => { d.reload(true); }, [image?.path, image?.url, article.featured_image_path]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = d.data?.same_title || [], im = d.data?.same_image || [];
  const typed = String(title || '').trim().toLowerCase();
  const titleDup = t.length > 0 && typed === String(article.title || '').trim().toLowerCase();
  if (!titleDup && !im.length) return null;
  const names = (l) => l.slice(0, 3).map(x => `#${x.id}`).join(', ');
  return (
    <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-[12.5px] text-amber-900">
      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
      <div className="space-y-0.5">
        {titleDup && <p><b>Same title as another article</b> ({names(t)}). Two posts with one title compete with each other in Google: give this one its own SEO title.</p>}
        {im.length > 0 && <p><b>Same image as another article</b> ({names(im)}). Use a picture that shows this blog's topic.</p>}
      </div>
    </div>
  );
}

/** The keywords this project saved (My Keywords), on the Topic & Intent step: tick some and add them to this blog's keywords. */
function SavedKeywordPicker({ b, inUse, onAdd }) {
  const kws = useApi(`/businesses/${b.id}/blog-flow/keywords`);
  const [picked, setPicked] = useState([]);
  const shownRows = useRef([]); // the keywords the table shows now, for "select all shown"
  const list = kws.data?.keywords || [];
  const used = new Set(inUse.map(k => String(k || '').trim().toLowerCase()).filter(Boolean));
  const toggle = (k) => setPicked(p => (p.includes(k) ? p.filter(x => x !== k) : [...p, k]));
  const add = () => { onAdd(list.filter(k => picked.includes(k.keyword))); setPicked([]); };
  return (
    <div className="p-3.5 rounded-xl bg-white border border-slate-200 space-y-2.5">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2"><span className="text-[13px] font-bold text-slate-900">My saved keywords</span>{list.length > 0 && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-slate-100 text-slate-600 tabular-nums">{list.length}</span>}</div>
          <div className="text-[11.5px] text-slate-500 mt-0.5">Tick the keywords this blog is for, then add them. The first becomes the primary keyword.</div>
        </div>
        {list.length > 0 && (
          <div className="flex items-center gap-2 shrink-0">
            {picked.length > 0 && <><span className="text-[12px] font-semibold text-indigo-700 tabular-nums">{picked.length} ticked</span><button type="button" onClick={() => setPicked([])} className="text-[12px] font-semibold text-slate-500 hover:underline cursor-pointer">Clear</button></>}
            <Button size="sm" variant="primary" icon={Plus} disabled={!picked.length} onClick={add}>Add to this blog</Button>
          </div>
        )}
      </div>
      {!kws.data && !kws.error && <div className="text-[11.5px] text-slate-500"><RefreshCw size={12} className="inline animate-spin mr-1" />Loading your keywords…</div>}
      {kws.error && <ErrorNote>{kws.error.message}</ErrorNote>}
      {kws.data && !list.length && <p className="text-[12px] text-slate-500">No keywords are saved yet. Save some on <Link to="/keyword-management/ai" className="text-indigo-600 hover:underline">Find Keywords</Link>, or type the topic above and click Generate Keywords.</p>}
      {list.length > 0 && (
        <div className="rounded-lg ring-1 ring-inset ring-slate-200 overflow-hidden">
          <DataTable bare rows={list} rowKey={k => k.keyword} pageSize={10} sizes={[10, 25, 50]} label="keywords" search={false} exportName={`saved-keywords-${siteStem(b)}`} minWidth={520} columnsMenu={false}
            onState={st => { shownRows.current = st.rows; }}
            rowClass={k => (picked.includes(k.keyword) ? 'bg-indigo-50' : used.has(k.keyword.toLowerCase()) ? 'opacity-50' : 'hover:bg-slate-50')}
            columns={[
              { id: 'pick', label: 'Select', csv: false, className: 'pl-3 pr-1 py-2 w-8', thClass: 'pl-3 pr-1 py-2.5 w-8',
                header: <input type="checkbox" aria-label="Select all shown" checked={shownRows.current.length > 0 && shownRows.current.filter(k => !used.has(k.keyword.toLowerCase())).every(k => picked.includes(k.keyword))} onChange={() => { const free = shownRows.current.filter(k => !used.has(k.keyword.toLowerCase())).map(k => k.keyword); const every = free.every(k => picked.includes(k)); setPicked(pk => (every ? pk.filter(k => !free.includes(k)) : [...new Set([...pk, ...free])])); }} />,
                cell: k => <input type="checkbox" disabled={used.has(k.keyword.toLowerCase())} checked={picked.includes(k.keyword) || used.has(k.keyword.toLowerCase())} onChange={() => toggle(k.keyword)} aria-label={`Pick ${k.keyword}`} /> },
              { id: 'keyword', header: 'Keyword', value: k => k.keyword, className: 'px-2 py-2',
                cell: k => <span className="min-w-0"><span className="font-semibold text-slate-900 break-words">{k.keyword}</span>
                  {used.has(k.keyword.toLowerCase()) && <span className="ml-2 text-[11px] rounded-full px-1.5 py-0.5 bg-indigo-50 text-indigo-700">added</span>}
                  {k.for_blog && <span className="ml-2 text-[11px] rounded-full px-1.5 py-0.5 bg-emerald-50 text-emerald-700">meant for blogs</span>}
                  {k.used > 0 && <span className="ml-2 text-[11px] rounded-full px-1.5 py-0.5 bg-amber-50 text-amber-700">used in {k.used} article{k.used > 1 ? 's' : ''}</span>}</span> },
              { id: 'volume', header: 'Searches / mo', right: true, first: 'desc', value: k => k.volume ?? null, className: 'px-2 py-2 text-right tabular-nums text-slate-700', cell: k => (k.volume != null ? fmt(k.volume) : <span className="text-slate-300">—</span>) },
              { id: 'difficulty', header: 'Difficulty', right: true, value: k => k.difficulty ?? null, className: 'px-2 py-2 text-right tabular-nums text-slate-700', cell: k => (k.difficulty != null ? k.difficulty : <span className="text-slate-300">—</span>) },
              { id: 'rank', header: 'Rank', right: true, value: k => k.rank ?? null, className: 'px-3 py-2 text-right tabular-nums text-slate-700', cell: k => (k.rank != null ? `#${k.rank}` : <span className="text-slate-300">—</span>) }
            ]} />
        </div>
      )}
    </div>
  );
}

function BlogWriterTab({ b, selectedTopic, selectedArticle, pendingArticle, pendingLength, elapsed = 0, onGenerate, generating, onSaved, onScheduled, toast }) {
  const [step, setStep] = useState(selectedArticle ? 1 : 0);
  const urlTopic = React.useMemo(() => (selectedArticle || selectedTopic ? '' : (() => { const q = new URLSearchParams(window.location.search); return (q.get('topic') || q.get('keyword') || '').slice(0, 200); })()), []); // a keyword sent from My Keywords, Keyword Mapping or the usage grid (?keyword= or ?topic=): the writer opens with it ready
  const [kw, setKw] = useState(selectedArticle ? selectedArticle.keyword : selectedTopic ? selectedTopic.title : urlTopic);  // the primary keyword
  const [topicText, setTopicText] = useState(selectedArticle ? selectedArticle.topic || selectedArticle.keyword : selectedTopic ? selectedTopic.title : urlTopic);
  const [secondaryList, setSecondaryList] = useState(selectedArticle ? selectedArticle.secondary_keywords || [] : selectedTopic?.selected || []);
  const [kwReady, setKwReady] = useState(Boolean(selectedArticle));  // the full blog is only started once there is a keyword set
  const [kwBusy, setKwBusy] = useState(false);
  const [kwError, setKwError] = useState('');
  const [kwNote, setKwNote] = useState('');
  const [kwVolumes, setKwVolumes] = useState({}); // keyword -> avg monthly searches (Google Keyword Planner)
  const volOf = (k) => kwVolumes[String(k || '').trim().toLowerCase()];
  const VolTag = ({ k }) => {
    const v = volOf(k);
    if (v === undefined) return null;
    return (
      <span title="Average monthly searches · Google Keyword Planner" className={`shrink-0 h-9 px-2 inline-flex items-center rounded-lg border text-[11px] font-semibold tabular-nums whitespace-nowrap ${v ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>
        {v == null ? '— /mo' : `${fmt(v)}/mo`}
      </span>
    );
  };
  const [intent, setIntent] = useState('');
  const [related, setRelated] = useState(selectedTopic?.related || []);
  const bench = null; // Google gives no list of other sites' rankings, so there is no top-results benchmark


  const [draft, setDraft] = useState(selectedArticle ? selectedArticle.body || '' : '');
  const [bodyTab, setBodyTab] = useState(selectedArticle ? 'preview' : 'editor'); // 'editor' | 'preview': an article opens on its preview
  const caretRef = useRef(null); // the last cursor position in the HTML editor: article images can be placed there
  const [meta, setMeta] = useState({
    keyword: selectedArticle?.keyword || '',
    slug: selectedArticle?.slug || '', // empty = the address follows the primary keyword
    secondary: (selectedArticle?.secondary_keywords || []).join(', '),
    title: selectedArticle?.title || '',
    meta_description: selectedArticle?.meta_description || ''
  });
  const urlBase = useApi(selectedArticle ? `/businesses/${b.id}/articles/url-base` : null).data; // where this site's posts live, learned from the ones already published
  const mark = false; // the preview shows the article as it is: no keyword colouring
  const [previewView, setPreviewView] = useState('post'); // standard | post (the site's blog details page, the default) | list (the site's blog page)
  const [device, setDevice] = useState('desktop');
  const [site, setSite] = useState({ busy: false, html: '', error: '', notes: [], ref: '' });
  const siteSeq = useRef(0);
  const refKey = `growzen.layoutpost.${b.id}`;
  const [refUrl, setRefUrl] = useState(() => { try { return localStorage.getItem(refKey) || ''; } catch { return ''; } }); // a post of the site whose design the preview copies ('' = chosen automatically)
  const [refDraft, setRefDraft] = useState('');
  const useRef2 = (v) => { const clean = v.trim(); setRefUrl(clean); try { if (clean) localStorage.setItem(refKey, clean); else localStorage.removeItem(refKey); } catch { /* kept for this page only */ } };
  const [kwBusyP, setKwBusyP] = useState(false);
  const [chunkBusy, setChunkBusy] = useState(false);
  useEffect(() => {
    if (selectedArticle) {
      setDraft(selectedArticle.body || '');
      setMeta({
        keyword: selectedArticle.keyword || '',
        slug: selectedArticle.slug || '',
        secondary: (selectedArticle.secondary_keywords || []).join(', '),
        title: selectedArticle.title || '',
        meta_description: selectedArticle.meta_description || ''
      });
    }
  }, [selectedArticle]);
  // edits not saved yet are kept in this browser, so leaving the page does not lose them
  const bk = selectedArticle ? `growzen.blogedit.${b.id}.${selectedArticle.id}` : null;
  const [restore, setRestore] = useState(null);
  useEffect(() => {
    if (!bk) return;
    try {
      const v = JSON.parse(localStorage.getItem(bk) || 'null');
      if (v && (v.draft !== (selectedArticle.body || '') || v.meta?.title !== (selectedArticle.title || '') || v.meta?.meta_description !== (selectedArticle.meta_description || ''))) setRestore(v);
    } catch { /* nothing kept */ }
  }, [bk]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!bk || restore) return;
    const same = draft === (selectedArticle.body || '') && meta.title === (selectedArticle.title || '') && meta.meta_description === (selectedArticle.meta_description || '');
    try { if (!same) localStorage.setItem(bk, JSON.stringify({ draft, meta, at: Date.now() })); } catch { /* not kept */ }
  }, [draft, meta, bk, restore, selectedArticle]);
  const isGenerating = Boolean(generating || (pendingArticle && pendingArticle.status === 'generating'));
  const activeArt = selectedArticle || pendingArticle;
  const liveBody = isGenerating ? (activeArt?.body || '') : (draft || activeArt?.body || '');
  const liveTitle = isGenerating ? (activeArt?.title || '') : (meta?.title || activeArt?.title || '');
  const liveMetaDesc = isGenerating ? (activeArt?.meta_description || '') : (meta?.meta_description || activeArt?.meta_description || '');
  const liveProgress = pendingArticle?.progress || (generating ? 'Connecting to Claude AI…' : '');
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState('');
  const [articleLength, setArticleLength] = useState(() => { try { return localStorage.getItem('growzen.articleLength') || 'standard'; } catch { return 'standard'; } });
  const pickLength = (id) => { setArticleLength(id); try { localStorage.setItem('growzen.articleLength', id); } catch { /* remembered for this page only */ } };

  // Primary + secondary keywords written by Claude AI from Google Keyword Planner ideas; the backend returns each keyword's monthly searches.
  // Manual edits stay until this runs again.
  const kwSeq = useRef(0); // only the latest keyword request may update the form (no races between overlapping calls)
  const suggestKeywords = async (regen) => {
    const mine = ++kwSeq.current;
    setKwBusy(true); setKwError(''); setKwNote('');
    const keep = regen ? [] : selectedTopic?.selected || [];
    try {
      const r = await api(`/businesses/${b.id}/articles/keywords`, {
        method: 'POST',
        body: { topic: topicText.trim(), related: [...(selectedTopic?.selected || []), ...related], avoid: regen ? [kw, ...secondaryList].filter(Boolean) : [] }
      });
      if (mine !== kwSeq.current) return;
      setKw(r.primary);
      setSecondaryList([...new Set([...keep, ...r.secondary])].slice(0, 10));
      setIntent(r.intent || '');
      const vols = Object.fromEntries(Object.entries(r.volumes || {}).map(([k, v]) => [k.toLowerCase(), v]));
      setKwVolumes(vols);
      const withVol = Object.values(vols).filter(v => v != null).length;
      setKwNote(r.keywords_by === 'planner_fallback'
        ? `Claude AI didn't answer usably this time, so these keywords are the most-searched Google Keyword Planner ideas for the topic.${withVol ? ` Monthly searches are shown for ${withVol} of them.` : ''} Edit them or click Regenerate Keywords.`
        : r.trends === 'ok' || r.trends === 'cached' || r.trends === 'provided'
          ? `Keywords were written by Claude AI from Google Keyword Planner ideas.${withVol ? ` Monthly searches from Keyword Planner are shown for ${withVol} of them ("— /mo" = no volume data).` : ' Keyword Planner returned no search volumes for these keywords.'}`
          : r.trends === 'not_configured'
            ? 'Google Keyword Planner is not set up on the server, so Claude AI wrote these keywords on its own. They have no verified search volumes.'
            : 'Google Keyword Planner is not available right now, so Claude AI wrote these keywords on its own. They have no verified search volumes.');
    } catch (e) {
      if (mine !== kwSeq.current) return;
      setKwError(`${e.message || e} You can type the keywords yourself below.`);
      if (!kw.trim()) setKw(topicText.trim().toLowerCase());
      if (!secondaryList.length) setSecondaryList(related.slice(0, 6));
    } finally {
      if (mine === kwSeq.current) { setKwReady(true); setKwBusy(false); }
    }
  };
  // Auto-generate once when a topic arrives from the Radar (the ref stops React StrictMode's double effect from sending two requests).
  const autoKw = useRef(false);
  useEffect(() => { if (selectedTopic && !selectedArticle && !autoKw.current) { autoKw.current = true; suggestKeywords(false); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // saved keywords (My Keywords) picked on this step: the first fills the primary keyword (and the topic) when empty, the rest become secondary
  const [showSaved, setShowSaved] = useState(true);
  const addSaved = (items) => {
    if (!items.length) return;
    kwSeq.current++; // a keyword request still running must not overwrite what was just added
    setKwBusy(false);
    setKwVolumes(v => ({ ...v, ...Object.fromEntries(items.filter(k => k.volume != null).map(k => [k.keyword.toLowerCase(), k.volume])) }));
    const words = items.map(k => k.keyword);
    if (!topicText.trim()) setTopicText(words[0]);
    let rest = words;
    if (!kw.trim()) { setKw(words[0]); rest = words.slice(1); }
    const have = new Set([kw, ...secondaryList].map(k => k.trim().toLowerCase()).filter(Boolean));
    setSecondaryList(l => [...l.filter(k => k.trim()), ...rest.filter(k => !have.has(k.toLowerCase()))].slice(0, 10));
    setKwReady(true);
    toast(`${words.length} keyword${words.length > 1 ? 's' : ''} added to this blog`);
  };

  const generateBlog = () => {
    const keywords = [kw, ...secondaryList].map(k => k.trim().toLowerCase()).filter(Boolean);
    setGenBusy(true); setGenError('');
    // once writing starts, go on to the Write step (AI Draft) and show it from the top
    return onGenerate({ topic: topicText.trim() || kw.trim(), keywords, length: articleLength })
      .then(() => { setStep(1); setTimeout(() => document.getElementById('eeat-pipeline-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); })
      .catch(e => setGenError(e.message || String(e))).finally(() => setGenBusy(false));
  };

  const articleFields = () => ({
    keyword: meta.keyword, slug: slugify(meta.slug, 100), secondary_keywords: meta.secondary.split(',').map(k => k.trim()).filter(Boolean),
    title: meta.title, meta_description: meta.meta_description, body: draft
  });
  // SEO title / meta description: typed by hand or written by AI (✨); every regeneration uses what is in the boxes now
  const regenRef = useRef(null);
  const [fieldBusy, setFieldBusy] = useState('');
  const h1Raw = (draft.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1];
  const h1Text = h1Raw ? (() => { const t = document.createElement('textarea'); t.innerHTML = h1Raw.replace(/<[^>]+>/g, ''); return t.value.trim(); })() : '';
  const titleNow = meta.title.trim();
  const h1Differs = Boolean(selectedArticle && h1Text && titleNow && h1Text !== titleNow);
  const updateH1 = () => {
    const esc = titleNow.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    setDraft(d => d.replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/i, `<h1>${esc}</h1>`));
    toast('The article heading now matches the SEO title. Click "Save changes" to keep it.');
  };
  // Featured image: its own state, saved on its own (uploading never reloads or overwrites the unsaved title/meta/body)
  const [featured, setFeatured] = useState(() => featuredOf(selectedArticle));
  useEffect(() => { setFeatured(featuredOf(selectedArticle)); }, [selectedArticle?.id, selectedArticle?.featured_image_path, selectedArticle?.wp_media_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [saveBusy, setSaveBusy] = useState(false);
  const secondaryNow = meta.secondary.split(',').map(k => k.trim()).filter(Boolean);
  const brand = brandOf(b.name); // the short name readers know: it is written into the article and highlighted like the keywords
  const slugNow = slugify(meta.slug, 100) || slugify(meta.keyword);
  const fullUrl = urlBase?.base ? `${urlBase.base}${slugNow}${urlBase.trailing_slash ? '/' : ''}` : '';
  const keywordWords = slugify(meta.keyword).split('-').filter(Boolean);
  const slugHasKeyword = keywordWords.length > 0 && keywordWords.every(w => slugNow.split('-').includes(w));
  const previewHtml = React.useMemo(() => (mark ? highlightHtml(draft, meta.keyword, secondaryNow, { flag: true, brand }) : draft), [draft, mark, meta.keyword, meta.secondary, brand]); // eslint-disable-line react-hooks/exhaustive-deps
  const Marked = ({ text }) => (mark ? splitKeywords(text, meta.keyword, secondaryNow, brand).map((x, i) => (x.kind ? <mark key={i} data-kw={x.kind} style={Object.fromEntries(MARK_STYLE[x.kind].split(';').map(d => d.split(':')).map(([k, v]) => [k.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v]))}>{x.text}</mark> : <React.Fragment key={i}>{x.text}</React.Fragment>)) : text);
  const bodyText = draft.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
  const renderPreviewHeader = () => (
    <div className="space-y-2.5 mb-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">How it will look in Google</div>
        <div className="text-[12.5px] text-[#4d5156] truncate" title={fullUrl}>{fullUrl ? crumb(fullUrl) : 'Connect the website to see the address'}</div>
        <div className="text-[18px] leading-snug text-[#1a0dab] mt-0.5"><Marked text={meta.title || 'Your SEO title appears here'} /></div>
        <div className="text-[13px] leading-snug text-[#4d5156] mt-1"><Marked text={meta.meta_description || 'Your meta description appears here.'} /></div>
        <div className="mt-3 pt-2.5 border-t border-slate-100 grid gap-1.5 text-[12px]">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="font-semibold text-slate-700">Web address:</span>
            {fullUrl ? <a href={fullUrl} target="_blank" rel="noreferrer noopener" className="font-mono text-[11.5px] text-indigo-700 hover:underline break-all"><span className="text-slate-500">{fullUrl.slice(0, fullUrl.length - slugNow.length - (urlBase?.trailing_slash ? 1 : 0))}</span><b>{slugNow}</b>{urlBase?.trailing_slash ? '/' : ''}</a> : <span className="font-mono text-slate-500">/{slugNow}</span>}</div>
          <div className="flex flex-wrap gap-1.5">
            {[[slugHasKeyword, 'The address has the primary keyword', 'The address is missing the primary keyword'], [slugNow.length > 0 && slugNow.length <= 75, `Short enough (${slugNow.length} characters)`, `Too long (${slugNow.length} characters): keep it under 75`], [countIn(meta.title, meta.keyword) > 0, 'The title has the primary keyword', 'The title is missing the primary keyword'],
            [countIn(meta.meta_description, meta.keyword) > 0, 'The description has the primary keyword', 'The description is missing the primary keyword']].map(([ok, yes, no]) => (
              <span key={yes} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold ${ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'}`}>{ok ? <Check size={11} strokeWidth={3} /> : <AlertTriangle size={11} />}{ok ? yes : no}</span>))}
          </div>
          {urlBase && !urlBase.learned && <div className="text-[11px] text-slate-500">Shown as {urlBase.base}: your site may place posts in another folder. It is learned from the first post you publish.</div>}
        </div>
      </div>
    </div>
  );
  const coverage = React.useMemo(() => paragraphCoverage(draft, meta.keyword, secondaryNow), [draft, meta.keyword, meta.secondary]); // eslint-disable-line react-hooks/exhaustive-deps
  const addKeywordsToParagraphs = () => {
    setKwBusyP(true);
    return api(`/businesses/${b.id}/articles/${selectedArticle.id}/keyword-paragraphs`, { method: 'POST', body: { body: draft, keyword: meta.keyword, secondary_keywords: secondaryNow }, timeout: 170000 })
      .then(r => {
        if (r.changed) setDraft(r.body);
        toast(r.changed ? `${r.changed} paragraph${r.changed === 1 ? '' : 's'} rewritten to carry a keyword${r.missing_after ? `; ${r.missing_after} could not be rewritten faithfully` : ''}. Read them, then Save changes.` : 'No paragraph could be rewritten without changing its meaning: add the keyword by hand.');
      })
      .catch(e => toast(e.message))
      .finally(() => setKwBusyP(false));
  };
  const longParas = React.useMemo(() => { // paragraphs of more than 75 words: they read better in short chunks
    try { const doc = new DOMParser().parseFromString(`<body>${draft || ''}</body>`, 'text/html'); doc.querySelectorAll('script,style').forEach(n => n.remove()); return [...doc.querySelectorAll('p')].filter(p => p.textContent.trim().split(/\s+/).length > 75).length; } catch { return 0; }
  }, [draft]);
  const chunkParagraphs = () => {
    setChunkBusy(true);
    return api(`/businesses/${b.id}/articles/${selectedArticle.id}/chunk-paragraphs`, { method: 'POST', body: { body: draft, keyword: meta.keyword, secondary_keywords: secondaryNow } })
      .then(r => { setDraft(r.body); toast(r.split ? `${r.split} long paragraph${r.split === 1 ? '' : 's'} broken into short chunks. Read them, then Save changes.` : 'Nothing could be split cleanly: the long paragraphs have no sentence breaks to cut at.'); })
      .catch(e => toast(e.message))
      .finally(() => setChunkBusy(false));
  };
  const loadSitePreview = (view) => {
    const mine = ++siteSeq.current;
    setSite(x => ({ ...x, busy: true, error: '' }));
    return api(`/businesses/${b.id}/articles/${selectedArticle.id}/site-preview`, {
      method: 'POST', timeout: 90000,
      body: { view, title: meta.title, meta_description: meta.meta_description, body: draft, slug: slugify(meta.slug, 100), keyword: meta.keyword, secondary_keywords: secondaryNow, highlight: mark, reference_url: refUrl || null }
    })
      .then(r => { if (mine === siteSeq.current) setSite({ busy: false, html: r.html, error: '', notes: r.notes || [], ref: r.reference_url || '', source: r.source || 'copy', info: r.site || null }); })
      .catch(e => { if (mine === siteSeq.current) setSite(x => ({ ...x, busy: false, html: '', error: e.message || 'The preview could not be built.' })); });
  };
  useEffect(() => {
    if (selectedArticle && bodyTab === 'preview' && previewView !== 'standard') loadSitePreview(previewView);
  }, [previewView, bodyTab, mark, refUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  const renderViewSwitch = () => (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 border border-slate-200">
        {[['standard', 'Article'], ['post', 'Blog details page'], ['list', 'Blog list']].map(([id, label]) => (
          <button key={id} type="button" onClick={() => setPreviewView(id)} className={`px-3 py-1.5 rounded-md text-[12px] font-semibold cursor-pointer ${previewView === id ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}>{label}</button>))}
      </div>
      {previewView !== 'standard' && (<>
        <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 border border-slate-200">
          {[['desktop', 'Desktop'], ['mobile', 'Mobile']].map(([id, label]) => <button key={id} type="button" onClick={() => setDevice(id)} className={`px-3 py-1.5 rounded-md text-[12px] font-semibold cursor-pointer ${device === id ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}>{label}</button>)}
        </div>
        <Button size="sm" icon={RefreshCw} busy={site.busy} onClick={() => loadSitePreview(previewView)}>Refresh with my edits</Button>
      </>)}
      {previewView === 'post' && site.source !== 'brand' && (
        <details className="basis-full text-[12px] text-slate-600">
          <summary className="cursor-pointer font-semibold text-slate-700">Design copied from: {site.ref ? <a href={site.ref} target="_blank" rel="noreferrer noopener" className="text-indigo-700 hover:underline font-mono break-all" onClick={e => e.stopPropagation()}>{site.ref}</a> : 'a post chosen automatically'}{refUrl ? ' (your choice)' : ''}. Use another post</summary>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input className={`${inputCls} flex-1 min-w-[260px]`} value={refDraft} onChange={e => setRefDraft(e.target.value)} placeholder={`A post of your site, e.g. ${(b.website || 'https://yoursite.com').replace(/\/$/, '')}/a-post/`} aria-label="Post whose layout to copy" />
            <Button size="sm" variant="primary" disabled={!/^https?:\/\//i.test(refDraft.trim())} onClick={() => useRef2(refDraft)}>Use this post</Button>
            {refUrl && <Button size="sm" onClick={() => { useRef2(''); setRefDraft(''); }}>Choose automatically</Button>}
          </div>
          <div className="mt-1 text-[11.5px] text-slate-500">The preview copies this post's design: header, title and date, the picture, the sidebar, the FAQ and the blocks below it. Pick the post you like best.</div>
        </details>
      )}
    </div>
  );
  const renderSitePreview = () => (
    <div className="space-y-2">
      {site.error && <div className="flex gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-[12.5px] text-amber-900"><AlertTriangle size={14} className="mt-0.5 shrink-0" /><div>{site.error} <button type="button" className="underline font-semibold cursor-pointer" onClick={() => setPreviewView('standard')}>Show the standard preview</button></div></div>}
      {site.busy && !site.html && <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-[13px] text-slate-500"><RefreshCw size={20} className="animate-spin text-indigo-500 mx-auto mb-2" />Reading your website's {previewView === 'list' ? 'blog page' : 'post design'}…</div>}
      {site.html && (
        <>
          {site.info?.host && (
            <div className="flex flex-wrap items-center gap-2 mb-1.5 text-[12px]">
              <span className="font-semibold text-slate-700">Preview of</span>
              <a href={site.info.site} target="_blank" rel="noreferrer noopener" className="font-mono text-indigo-700 hover:underline">{site.info.host}</a>
              <span className="inline-block px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 font-semibold">{site.info.from_setup ? `Publishing Setup: ${site.info.label || 'connected website'}` : 'Project website (no publishing website is set up yet)'}</span>
            </div>
          )}
          <div className="text-[11.5px] text-slate-500">{site.source === 'brand' &&<span className="inline-block mr-1.5 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-semibold">Your site’s brand</span>}{site.notes.join(' ')}{site.source === 'brand' ? '' : ' Scripts on your site are switched off, so menus and sliders will not move.'}</div>
          <div className="rounded-xl border border-slate-200 bg-slate-100 p-3 flex justify-center overflow-x-auto relative">
            {site.busy && <div className="absolute inset-0 bg-white/60 z-10 flex items-center justify-center"><RefreshCw size={20} className="animate-spin text-indigo-500" /></div>}
            <iframe title="Preview in your website's design" sandbox="" referrerPolicy="no-referrer" srcDoc={site.html}
              style={{ width: device === 'mobile' ? 390 : '100%', height: 700, background: '#fff' }} className="rounded-lg border border-slate-300 shadow-sm" />
          </div>
        </>
      )}
    </div>
  );
  const saveArticle = () => {
    setSaveBusy(true);
    return api(`/businesses/${b.id}/articles/${selectedArticle.id}`, { method: 'PATCH', body: articleFields() })
      .then(() => { try { localStorage.removeItem(bk); } catch { /* nothing */ } toast('Draft saved'); if (onSaved) onSaved(); })
      .catch(e => toast(e.message))
      .finally(() => setSaveBusy(false));
  };
  // article images placed on the Images & Analysis step: the article is saved with them at once (publishing sends the saved article)
  const saveWithBody = (body) => api(`/businesses/${b.id}/articles/${selectedArticle.id}`, { method: 'PATCH', body: { ...articleFields(), body } })
    .then(() => { try { localStorage.removeItem(bk); } catch { /* nothing */ } if (onSaved) onSaved(); });
  const [scheduledDate] = useState(() => { const d = new Date(Date.now() + 864e5); d.setHours(10, 0, 0, 0); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); });  // tomorrow 10:00, local

  const next = () => {
    if (step === 0) {
      // Topic & Intent -> write the article for real, then go to the AI Draft
      if (kwReady && kw.trim()) generateBlog().then(() => setStep(1));
      else setGenError('Generate the keywords first: the article is written from them.');
      return;
    }
    if (step === PUBLISH_STEP) return undefined;
    return setStep(s => Math.min(STEPS.length - 1, s + 1));
  };

  return (
    <div id="eeat-pipeline-workspace" className="grid grid-cols-1 xl:grid-cols-4 gap-4 scroll-mt-6">
      {/* Step Navigator: Topic & Intent belongs to "Keywords & topic", so it is shown on its own, full width, without this list */}
      {step > 0 && <Card title="E-E-A-T Content Pipeline" className="xl:col-span-1">
        <ol className="space-y-1.5">
          {STEPS.map((s, i) => i === 0 ? null : (
            <li key={s}>
              <button
                onClick={() => (selectedArticle || i <= step) && setStep(i)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[12px] font-semibold text-left transition-colors cursor-pointer ${i === step
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                    : i < step
                      ? 'text-slate-800 hover:bg-slate-50'
                      : 'text-slate-500'
                  }`}
              >
                <span className={`w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-bold ${i < step ? 'bg-emerald-500 text-white' : i === step ? 'bg-white text-blue-600' : 'bg-slate-100 text-slate-500'
                  }`}>
                  {i < step ? <Check size={11} strokeWidth={3} /> : i}
                </span>
                <span className="truncate">{s}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="mt-4 p-3 rounded-xl bg-white border border-slate-200 text-[11px] text-slate-500 leading-relaxed">
          <ShieldCheck size={13} className="text-emerald-700 inline mr-1" />
          The checks on the next steps are computed from your own draft and your business profile. Nothing is assumed or invented.
        </div>
      </Card>}

      {/* Main Step Workspace */}
      <Card
        className={step === 0 ? 'xl:col-span-4' : 'xl:col-span-3'}
        title={STEPS[step]}
        action={step === PUBLISH_STEP ? null : (
          <div className="flex items-center gap-2">
            {step === 0 && <Button onClick={() => setShowSaved(s => !s)}>{showSaved ? 'Hide My Keywords' : 'My Keywords'}</Button>}
            {step !== 0 && <Button variant="secondary" busy={genBusy} onClick={next}>
              Next Step
              <ChevronRight size={13} />
            </Button>}
          </div>
        )}
      >
        {/* Step 0: Keyword & Intent */}
        {step === 0 && (
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_390px] gap-4 items-start">
            <div className="space-y-4 min-w-0">
              <Field label="Topic" hint="Picked from Trending Topics Radar, or type your own topic">
                <input className={inputCls} placeholder="e.g. social media marketing" value={topicText} onChange={e => setTopicText(e.target.value)} />
              </Field>
              {onGenerate && showSaved && <SavedKeywordPicker b={b} inUse={[kw, ...secondaryList]} onAdd={addSaved} />}
            </div>
            <aside className="space-y-3 xl:sticky xl:top-4" aria-label="This article">
            {onGenerate && (
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[12px] font-bold text-slate-800">Keywords for this article</div>
                  <Button size="sm" icon={RefreshCw} busy={kwBusy} disabled={topicText.trim().length < 2} onClick={() => suggestKeywords(kwReady)}>
                    {kwReady ? 'Regenerate Keywords' : 'Generate Keywords'}
                  </Button>
                </div>
                {kwBusy && <div className="text-[11.5px] text-indigo-700 flex items-center gap-1.5"><RefreshCw size={12} className="animate-spin" />Writing keywords for “{topicText}” with Claude AI…</div>}
                {kwError && <div className="text-[11.5px] text-amber-800">{kwError}</div>}
                {kwReady && !kwBusy && kwNote && <div className="text-[11px] text-slate-500">{kwNote}</div>}
                {!kwReady && !kwBusy && <div className="text-[11.5px] text-slate-500">Enter a topic and click Generate Keywords. The blog is written after you confirm the keywords.</div>}
                {kwReady && (
                  <>
                    {intent && <div className="text-[11.5px] text-slate-600">Search intent: <span className="inline-block px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-800 font-semibold capitalize">{intent}</span></div>}
                    <Field label="Primary keyword" hint="Appears in the title, meta description and introduction">
                      <div className="flex items-center gap-1.5">
                        <input className={inputCls} value={kw} onChange={e => setKw(e.target.value)} />
                        <VolTag k={kw} />
                      </div>
                      {slugify(kw) && <div className="mt-1 text-[11.5px] text-slate-500 break-all">The article's web address ends with <span className="font-mono font-semibold text-slate-700">/{slugify(kw)}</span> (you can change it after the article is written).</div>}
                    </Field>
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Secondary keywords <span className="normal-case tracking-normal font-normal text-slate-400">({secondaryList.filter(k => k.trim()).length}, 5 to 10 works best; edit, add or remove)</span></div>
                      <div className="grid grid-cols-1 gap-2">
                        {secondaryList.map((k, i) => (
                          <div key={i} className="flex items-center gap-1.5">
                            <input className={inputCls} value={k} onChange={e => setSecondaryList(l => l.map((x, j) => (j === i ? e.target.value : x)))} />
                            <VolTag k={k} />
                            <button type="button" title="Remove" className="h-9 w-9 shrink-0 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer" onClick={() => setSecondaryList(l => l.filter((_, j) => j !== i))}>×</button>
                          </div>
                        ))}
                      </div>
                      <Button size="sm" icon={Plus} className="mt-2" onClick={() => setSecondaryList(l => [...l, ''])}>Add keyword</Button>
                    </div>
                  </>
                )}
              </div>
            )}
            {onGenerate && (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Article length</div>
                <div className="grid grid-cols-1 gap-1.5">
                  {ARTICLE_LENGTHS.map(l => (
                    <button key={l.id} type="button" onClick={() => pickLength(l.id)} aria-pressed={articleLength === l.id}
                      className={`px-3 py-2 rounded-xl border flex items-center justify-between gap-3 text-left cursor-pointer transition-all ${articleLength === l.id ? 'bg-indigo-600 border-indigo-600 text-white shadow-md' : 'bg-white border-slate-200 text-slate-700 hover:border-indigo-300'}`}>
                      <span className="text-[12.5px] font-bold">{l.label}</span>
                      <span className={`text-[11px] ${articleLength === l.id ? 'text-indigo-100' : 'text-slate-500'}`}>{l.words} · {l.time}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {onGenerate && (
              <div className="space-y-1.5">
                <Button variant="ai" icon={Sparkles} className="w-full justify-center" busy={genBusy} disabled={!kwReady || kwBusy || !kw.trim() || generating} onClick={generateBlog}>Generate Blog</Button>
                {generating && <div className="text-[11.5px] text-amber-700 font-semibold">An article is being written; wait for it to finish.</div>}
                {!kwReady && !kwBusy && <div className="text-[11.5px] text-amber-700">Generate the keywords first.</div>}
                <div className="text-[11.5px] text-slate-500">Writes a complete blog (SEO title, meta description, introduction, H2/H3 sections, FAQs, conclusion) using the keywords above, then opens it for review.</div>
              </div>
            )}
            {genError && <div className="text-[12px] text-red-600">{genError}</div>}
            </aside>
          </div>
        )}

        {/* Step 1: AI Draft */}
        {step === 1 && (
          <div className="space-y-4">
            {restore && (
              <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-[12.5px] text-amber-900">
                <span className="flex-1 min-w-[220px]"><b>Unsaved edits found</b> from {new Date(restore.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}: you changed this article and did not press Save.</span>
                <button type="button" className="h-8 px-3 rounded-lg bg-amber-600 text-white font-semibold cursor-pointer" onClick={() => { setDraft(restore.draft); setMeta(restore.meta); setRestore(null); }}>Restore my edits</button>
                <button type="button" className="h-8 px-3 rounded-lg bg-white ring-1 ring-inset ring-amber-300 font-semibold cursor-pointer" onClick={() => { try { localStorage.removeItem(bk); } catch { /* nothing */ } setRestore(null); }}>Discard</button>
              </div>
            )}
            {/* Status indicator bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-gradient-to-r from-indigo-50 via-purple-50 to-pink-50 border border-indigo-200">
              <div className="flex items-center gap-2.5">
                {isGenerating ? (
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                  </span>
                ) : (
                  <Check size={15} className="text-emerald-600" />
                )}
                <div>
                  <div className="text-[12.5px] font-bold text-indigo-950 flex items-center gap-2">
                    {isGenerating ? 'AI is writing your blog live…' : 'AI Blog Draft Ready'}
                    <span className="text-[10px] uppercase tracking-wider bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-semibold">
                      Claude Haiku 5.5
                    </span>
                  </div>
                  <div className="text-[11.5px] text-indigo-700 font-medium">
                    {isGenerating ? (liveProgress || 'Streaming line by line…') : 'Completed and validated. Review and edit below.'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 text-[11px] font-mono text-slate-500">
                <span>{liveBody.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length} words</span>
                {isGenerating && pendingLength && <span>• {mins(elapsed)}</span>}
              </div>
            </div>

            {/* If article completed and selected: show full editor */}
            {selectedArticle && !isGenerating ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field label="Primary keyword" hint="Must appear in the title, meta description and introduction"><input className={inputCls} value={meta.keyword} onChange={e => setMeta(m => ({ ...m, keyword: e.target.value }))} /></Field>
                  <Field label="Secondary keywords" hint="Comma separated; each should appear in the article"><input className={inputCls} value={meta.secondary} onChange={e => setMeta(m => ({ ...m, secondary: e.target.value }))} /></Field>
                </div>
                <Field label="Web address (slug)" hint={meta.slug.trim() ? 'Your own words. Click “Use the primary keyword” to follow the keyword again.' : 'Follows the primary keyword: change the keyword and this changes with it. Type here to set your own.'}>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center min-w-0 flex-1 rounded-lg border border-slate-300 bg-white overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500">
                      <span className="px-2.5 py-2 bg-slate-50 text-[12px] text-slate-500 border-r border-slate-200 whitespace-nowrap max-w-[55%] truncate" title={urlBase?.base}>{urlBase?.base ? urlBase.base.replace(/^https?:\/\//, '') : '/'}</span>
                      <input className="flex-1 min-w-0 px-2.5 py-2 text-[13px] font-mono outline-none" value={meta.slug.trim() ? meta.slug : slugify(meta.keyword)} aria-label="Web address slug" maxLength={100}
                        onChange={e => setMeta(m => ({ ...m, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-\s]+/g, '').replace(/\s+/g, '-') }))}
                        onBlur={() => setMeta(m => ({ ...m, slug: slugify(m.slug, 100) === slugify(m.keyword) ? '' : slugify(m.slug, 100) }))} />
                    </div>
                    {meta.slug.trim() && slugify(meta.slug, 100) !== slugify(meta.keyword) && <Button size="sm" onClick={() => setMeta(m => ({ ...m, slug: '' }))}>Use the primary keyword</Button>}
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold ${slugHasKeyword ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>{slugHasKeyword ? <Check size={11} strokeWidth={3} /> : <AlertTriangle size={11} />}{slugHasKeyword ? 'Has the primary keyword' : 'Without the primary keyword'}</span>
                  </div>
                  {fullUrl && <div className="mt-1 text-[11.5px] text-slate-500 break-all">Full address: <span className="font-mono">{fullUrl}</span></div>}
                </Field>
                {(() => {
                  const text = `${meta.title} ${meta.meta_description} ${draft.replace(/<[^>]+>/g, ' ')}`;
                  const secondary = meta.secondary.split(',').map(k => k.trim()).filter(Boolean);
                  const chip = (k, primary) => {
                    const n = countIn(text, k);
                    return (
                      <span key={k} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11.5px] font-semibold ${n ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'}`}
                        title={n ? `Used ${n} time${n > 1 ? 's' : ''} in the title, meta description and article` : 'Not used yet: add it to the article'}>
                        {n ? <Check size={11} strokeWidth={3} /> : <AlertTriangle size={11} />}
                        {primary && <span className="text-[10px] uppercase tracking-wide opacity-70">Primary</span>}
                        {k}<span className="font-mono opacity-70">{n ? `×${n}` : 'missing'}</span>
                      </span>
                    );
                  };
                  return (
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                      <div className="text-[11px] font-semibold text-slate-600">Keyword use in this article (updates as you edit)</div>
                      <div className="flex flex-wrap items-center gap-2 text-[12px]">
                        {longParas > 0 && (<>
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border bg-amber-50 border-amber-200 text-amber-900 font-semibold"><AlertTriangle size={12} />{longParas} long paragraph{longParas === 1 ? '' : 's'}</span>
                          <Button size="sm" busy={chunkBusy} onClick={chunkParagraphs}>Break into short chunks</Button>
                        </>)}
                        {coverage.total > 0 && (coverage.missing.length === 0
                          ? <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border bg-emerald-50 border-emerald-200 text-emerald-800 font-semibold"><Check size={12} strokeWidth={3} />Every paragraph ({coverage.total}) has a keyword</span>
                          : <>
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border bg-amber-50 border-amber-200 text-amber-900 font-semibold" title={`Paragraphs without a keyword: ${coverage.missing.join(', ')}`}><AlertTriangle size={12} />{coverage.missing.length} of {coverage.total} paragraphs have no keyword</span>
                            <Button size="sm" variant="ai" icon={Sparkles} busy={kwBusyP} onClick={addKeywordsToParagraphs}>Add a keyword to those paragraphs</Button>
                          </>)}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {meta.keyword.trim() && chip(meta.keyword.trim(), true)}
                        {secondary.map(k => chip(k, false))}
                        {brand && (() => {
                          const n = countIn(text, brand); return (
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11.5px] font-semibold ${n >= 2 ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'}`} title={n >= 2 ? `Your brand name is used ${n} times` : 'Mention your brand name a few times'}>
                              {n >= 2 ? <Check size={11} strokeWidth={3} /> : <AlertTriangle size={11} />}<span className="text-[10px] uppercase tracking-wide opacity-70">Brand</span>{brand}<span className="font-mono opacity-70">×{n}</span>
                            </span>);
                        })()}
                        {!secondary.length && <span className="text-[11.5px] text-slate-500">No secondary keywords. Add some above, separated by commas.</span>}
                      </div>
                    </div>
                  );
                })()}
                <SeoField kind="title" value={meta.title} onChange={v => setMeta(m => ({ ...m, title: v }))}
                  onRegenerate={selectedArticle ? () => regenRef.current?.run('title') : null} busy={fieldBusy === 'title'} disabled={Boolean(fieldBusy)} />
                {h1Differs && (
                  <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 rounded-xl bg-indigo-50 border border-indigo-200 text-[12px] text-indigo-900">
                    <Sparkles size={13} className="text-indigo-500 shrink-0" />
                    <span className="flex-1 min-w-[220px]">The SEO title changed. The article heading still says <b>“{h1Text}”</b>.</span>
                    <Button size="sm" onClick={updateH1}>Update heading only</Button>
                    <Button size="sm" variant="ai" icon={Sparkles} onClick={() => regenRef.current?.run('full')}>Regenerate article for this title</Button>
                  </div>
                )}
                <SeoField kind="meta" value={meta.meta_description} onChange={v => setMeta(m => ({ ...m, meta_description: v }))}
                  onRegenerate={selectedArticle ? () => regenRef.current?.run('meta') : null} busy={fieldBusy === 'meta'} disabled={Boolean(fieldBusy)} />
                {selectedArticle && <DuplicateNotice b={b} article={selectedArticle} title={meta.title} image={featured} />}
                {selectedArticle && <FeaturedImageField b={b} article={selectedArticle} value={featured} onChange={setFeatured} toast={toast} />}
                {/* Article Body: HTML Editor & Live Preview */}
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-700">Article Body</div>
                      <div className="text-[11px] text-slate-500">Edit raw HTML or switch to Preview to inspect the formatted blog layout</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {selectedArticle && <ArticleDownloads b={b} article={{ ...selectedArticle, body: draft, title: meta.title, meta_description: meta.meta_description, keyword: meta.keyword, slug: meta.slug.trim() || slugify(meta.keyword), secondary_keywords: secondaryNow }} />}
                      {selectedArticle && <RegenerateContent ref={regenRef} b={b} article={selectedArticle} body={draft} onAccept={setDraft} toast={toast} onFieldBusy={setFieldBusy}
                        fields={{ title: meta.title, meta_description: meta.meta_description, keyword: meta.keyword, secondary_keywords: meta.secondary.split(',').map(k => k.trim()).filter(Boolean) }}
                        onField={(field, value) => setMeta(m => ({ ...m, [field]: value }))} />}
                      <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 border border-slate-200">
                        <button
                          type="button"
                          onClick={() => setBodyTab('editor')}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold transition-all cursor-pointer ${bodyTab === 'editor'
                              ? 'bg-white text-indigo-700 shadow-xs'
                              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                            }`}
                        >
                          <Code size={13} />
                          HTML Editor
                        </button>
                        <button
                          type="button"
                          onClick={() => setBodyTab('preview')}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold transition-all cursor-pointer ${bodyTab === 'preview'
                              ? 'bg-white text-indigo-700 shadow-xs'
                              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                            }`}
                        >
                          <Eye size={13} />
                          Preview
                        </button>
                      </div>
                    </div>
                  </div>

                  {bodyTab === 'editor' ? (
                    <div>
                      <textarea
                        rows={18}
                        className={`${areaCls} font-mono text-[12px] leading-relaxed`}
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onSelect={e => { caretRef.current = e.target.selectionStart; }}
                        placeholder="<h2>Introduction</h2><p>Article body HTML content...</p>"
                      />
                      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
                        <span>Direct HTML edit mode: preserves &lt;h1&gt;, &lt;h2&gt;, &lt;h3&gt;, &lt;p&gt;, lists, FAQs, schema, and links.</span>
                        <span>{draft.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length} words</span>
                      </div>
                    </div>
                  ) : (
                    <>
                      {renderViewSwitch()}
                      {previewView !== 'standard' ? renderSitePreview() : (<>
                        {renderPreviewHeader()}
                        <div className="rounded-xl border border-slate-200 bg-white p-6 min-h-[380px] max-h-[640px] overflow-y-auto shadow-xs">
                          {draft && draft.trim() ? (
                            <article
                              className="blog-preview-article text-[13.5px] text-slate-800 leading-relaxed space-y-4
                            [&_h1]:text-[22px] [&_h1]:font-extrabold [&_h1]:text-slate-900 [&_h1]:mt-2 [&_h1]:mb-3 [&_h1]:leading-tight
                            [&_h2]:text-[17px] [&_h2]:font-bold [&_h2]:text-slate-900 [&_h2]:mt-6 [&_h2]:mb-2.5 [&_h2]:border-b [&_h2]:border-slate-100 [&_h2]:pb-1.5
                            [&_h3]:text-[14.5px] [&_h3]:font-semibold [&_h3]:text-slate-800 [&_h3]:mt-4 [&_h3]:mb-2
                            [&_h4]:text-[13px] [&_h4]:font-semibold [&_h4]:text-slate-800 [&_h4]:mt-3 [&_h4]:mb-1
                            [&_p]:text-slate-700 [&_p]:leading-relaxed [&_p]:my-2.5
                            [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_ul]:my-3
                            [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1.5 [&_ol]:my-3
                            [&_li]:text-slate-700 [&_li]:leading-relaxed
                            [&_strong]:font-semibold [&_strong]:text-slate-900
                            [&_em]:italic [&_em]:text-slate-700
                            [&_blockquote]:border-l-4 [&_blockquote]:border-indigo-500 [&_blockquote]:bg-slate-50/60 [&_blockquote]:p-3.5 [&_blockquote]:my-3.5 [&_blockquote]:italic [&_blockquote]:text-slate-700 [&_blockquote]:rounded-r-lg
                            [&_a]:text-indigo-600 [&_a]:underline [&_a]:hover:text-indigo-800
                            [&_table]:w-full [&_table]:border-collapse [&_table]:my-4 [&_table]:text-[12.5px]
                            [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:p-2.5 [&_th]:text-left [&_th]:font-semibold
                            [&_td]:border [&_td]:border-slate-200 [&_td]:p-2.5
                            [&_figure]:my-4 [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-lg
                            [&_.faq]:p-4 [&_.faq]:rounded-xl [&_.faq]:bg-slate-50 [&_.faq]:border [&_.faq]:border-slate-200 [&_.faq]:my-3
                            [&_.cta]:p-5 [&_.cta]:rounded-xl [&_.cta]:bg-gradient-to-r [&_.cta]:from-indigo-50 [&_.cta]:to-purple-50 [&_.cta]:border [&_.cta]:border-indigo-100 [&_.cta]:text-center [&_.cta]:my-4"
                              dangerouslySetInnerHTML={{ __html: previewHtml }}
                            />
                          ) : (
                            <div className="flex flex-col items-center justify-center py-16 text-center text-slate-400">
                              <Eye size={28} className="opacity-40 mb-2" />
                              <div className="text-[13px] font-semibold text-slate-600">Draft is empty</div>
                              <div className="text-[11.5px] text-slate-400">Switch to the HTML Editor tab to add content or generate a new article.</div>
                            </div>
                          )}
                        </div>
                      </>)}
                    </>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-slate-600">
                  <span>{(selectedArticle.suggested_keywords || []).length > 0 && <><span className="text-slate-500">Suggested tags:</span> {selectedArticle.suggested_keywords.join(', ')}</>}</span>
                  <Button size="sm" busy={saveBusy} onClick={saveArticle}>Save changes</Button>
                </div>
                {(selectedArticle.warnings || []).length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-slate-600">Checks (updated each time you save)</div>
                    {selectedArticle.warnings.map((w, i) => <div key={i} className="flex gap-1.5 p-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{w}</div>)}
                  </div>
                )}
              </div>
            ) : (isGenerating || liveBody) ? (
              /* ChatGPT-Style Live Streaming View */
              <div className="space-y-3">
                {(liveTitle || liveMetaDesc) && (
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                    {liveTitle && (
                      <div>
                        <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">SEO Title</span>
                        <div className="text-[13.5px] font-bold text-slate-900">{liveTitle}</div>
                      </div>
                    )}
                    {liveMetaDesc && (
                      <div>
                        <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">Meta Description</span>
                        <div className="text-[12px] text-slate-600 leading-normal">{liveMetaDesc}</div>
                      </div>
                    )}
                  </div>
                )}
                <div className="rounded-xl border border-slate-200 bg-white p-5 min-h-[300px] max-h-[500px] overflow-auto shadow-xs">
                  {liveBody ? (
                    <div>
                      <div
                        className="text-[13px] text-slate-800 leading-relaxed space-y-3 [&_h2]:text-[15px] [&_h2]:font-bold [&_h2]:text-slate-900 [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:border-b [&_h2]:border-slate-100 [&_h2]:pb-1 [&_h3]:text-[13.5px] [&_h3]:font-semibold [&_h3]:text-slate-800 [&_h3]:mt-3 [&_p]:mt-2 [&_p]:text-slate-700 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mt-1 [&_figure]:hidden [&_img]:hidden"
                        dangerouslySetInnerHTML={{ __html: liveBody }}
                      />
                      {isGenerating && (
                        <div className="mt-3 flex items-center gap-1.5 text-indigo-600 font-mono text-[11.5px]">
                          <span className="inline-block w-2 h-4 bg-indigo-600 animate-pulse rounded-xs" />
                          <span className="text-[11px] text-slate-400">writing next line…</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
                      <RefreshCw size={22} className="animate-spin text-indigo-500 opacity-60" />
                      <div className="text-[13px] font-bold text-slate-700">Connecting to Claude AI…</div>
                      <div className="text-[11.5px] text-slate-400 max-w-sm">
                        Title, meta description and introductory paragraphs will begin streaming here in a few moments.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Idle state: no article and not generating */
              <div className="rounded-xl border border-dashed border-indigo-200 bg-indigo-50/40 p-8 text-center space-y-2">
                <Sparkles size={24} className="text-indigo-400 mx-auto" />
                <div className="text-[13.5px] font-bold text-indigo-900">No draft yet</div>
                <div className="text-[12px] text-indigo-600 max-w-md mx-auto">
                  Click <strong>Generate Blog</strong> on the <strong>Topic &amp; Intent</strong> tab to start writing. You will see the AI write your article line by line in real time.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Images & Analysis (article images + analysis; the featured image upload stays on the AI Draft step) */}
        {step === 2 && (selectedArticle && !isGenerating ? (
          <BlogImageAnalysis b={b} article={selectedArticle} featured={featured} onFeaturedChange={setFeatured}
            draft={draft} onDraftChange={setDraft} saved={selectedArticle.body} onSave={saveArticle} onInsertSave={saveWithBody} saveBusy={saveBusy} caret={caretRef.current} toast={toast} />
        ) : (
          <div className="text-[12px] text-slate-500 p-3 rounded-xl bg-slate-50 border border-slate-200">The images are listed once the article is written.</div>
        ))}

        {step === 3 && (() => {
          const rows = realDetailChecks(b, liveBody);
          return (
            <div className="space-y-3 max-w-2xl">
              <p className="text-[12px] text-slate-700">Real details make an article trustworthy to readers and to Google. These come from your business profile, and each is checked against the draft. Add what is missing by editing the draft, never by guessing.</p>
              {rows.length === 0 ? <div className="text-[12px] text-slate-500 p-3 rounded-xl bg-slate-50 border border-slate-200">The business profile has no name, city, phone, website or services yet. Add them under GBP Optimization, then they are checked here.</div> : rows.map(r => (
                <div key={r.id} className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200 text-[12px]">
                  {r.ok ? <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" /> : <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />}
                  <div className="min-w-0"><div className="font-semibold text-slate-800">{r.label}</div><div className="text-slate-500 break-words">{r.value}</div></div>
                  <span className={`ml-auto shrink-0 font-semibold ${r.ok ? 'text-emerald-700' : 'text-amber-700'}`}>{r.ok ? 'Included' : 'Not in the draft'}</span>
                </div>
              ))}
              {(b.services || []).some(x => x?.price) && <div className="text-[11.5px] text-slate-500">Prices in your services list: {(b.services || []).filter(x => x?.price).map(x => `${x.name} ${x.price}`).join(' · ')}. Only quote prices you have listed.</div>}
            </div>
          );
        })()}

        {step === 4 && (() => {
          const list = qualityChecks({ draft: liveBody, title: liveTitle, metaDescription: liveMetaDesc, keyword: kw || activeArt?.keyword, benchMedian: bench?.median_words });
          const passed = list.filter(c => c.ok).length;
          return (
            <div className="space-y-3 max-w-2xl">
              <div className="flex items-center gap-3"><span className="text-[22px] font-bold text-slate-900 tabular-nums">{passed} of {list.length}</span><span className="text-[12px] text-slate-500">checks passed on the draft as it is now. Each one is computed from the text, not estimated.</span></div>
              {!liveBody.trim() && <div className="text-[12px] text-amber-800 bg-amber-50 rounded-lg px-3 py-2">There is no draft to check yet. Generate the article first.</div>}
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {list.map(c => (
                  <li key={c.id} className="flex items-start gap-3 px-3 py-2.5 text-[12px]">
                    {c.ok ? <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" /> : <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />}
                    <div className="min-w-0"><div className="font-semibold text-slate-800">{c.label}</div>{(c.detail || !c.ok) && <div className="text-slate-500">{c.detail}{c.detail && !c.ok ? ' · ' : ''}{!c.ok ? c.fix : ''}</div>}</div>
                  </li>
                ))}
              </ul>
              {false && <div className="text-[11.5px] text-slate-500">Tip: on the Topic & Intent step, “Check top results” gives the real target length from Google.</div>}
            </div>
          );
        })()}

        {/* Step 4: Publish & Schedule */}
        {step === PUBLISH_STEP && selectedArticle && draft !== (selectedArticle.body || '') && (
          <div className="mb-3 flex flex-wrap items-center gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-[12.5px] text-amber-900">
            <AlertTriangle size={14} className="shrink-0" />
            <span className="flex-1 min-w-[220px]"><b>The article has changes that are not saved</b> (for example images you placed). Publishing sends the saved article, so save first.</span>
            <Button size="sm" busy={saveBusy} onClick={saveArticle}>Save changes</Button>
          </div>
        )}
        {step === PUBLISH_STEP && (
          <PublishDestinations key={b.id} b={b}>
            {(dest, setReactConn, setHtmlConn) => dest === 'html' ? (
              <HtmlSitePanel b={b} article={selectedArticle} toast={toast} defaultWhen={scheduledDate}
                onChanged={() => { if (onSaved) onSaved(); }} onConnection={setHtmlConn} />
            ) : dest === 'react' ? (
              <ReactSitePanel b={b} article={selectedArticle} featured={featured} toast={toast} defaultWhen={scheduledDate}
                onChanged={() => { if (onSaved) onSaved(); }} onConnection={setReactConn} />
            ) : (
              <SitePublishPanel
                b={b}
                article={selectedArticle}
                featured={featured}
                toast={toast}
                defaultWhen={scheduledDate}
                onChanged={() => { if (onSaved) onSaved(); }}
                onPublished={(r, mode, when) => {
                  if (mode === 'schedule' && onScheduled) {
                    onScheduled({
                      title: kw,
                      slug: kw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
                      cms: 'Your website',
                      date: when,
                      status: 'Scheduled'
                    });
                  }
                  if (onSaved) onSaved();
                }}
              />
            )}
          </PublishDestinations>
        )}
      </Card>
    </div>
  );
}

/** "Select Blog Publishing Destination": WordPress (the existing flow, unchanged) or the React.js website. */
function PublishDestinations({ b, children }) {
  const wp = useApi(`/businesses/${b.id}/site-integration`);
  const react = useApi(`/businesses/${b.id}/react-site`);
  const html = useApi(`/businesses/${b.id}/html-site`);
  const setReactConn = useCallback((c) => { if (c) react.setData(c); }, [react.setData]); // eslint-disable-line react-hooks/exhaustive-deps
  const setHtmlConn = useCallback((c) => { if (c) html.setData(c); }, [html.setData]); // eslint-disable-line react-hooks/exhaustive-deps
  const [dest, setDest] = useState(() => { try { return localStorage.getItem(`growzen.dest.${b.id}`) || ''; } catch { return ''; } });
  const wpOn = wp.data?.status === 'connected';
  const reactOn = react.data?.status === 'connected';
  const chosen = dest || (!wpOn && reactOn ? 'react' : 'wordpress');
  const pick = (d) => { setDest(d); try { localStorage.setItem(`growzen.dest.${b.id}`, d); } catch { /* this page only */ } };
  const cards = [
    { id: 'wordpress', title: 'WordPress', on: wpOn, loading: !wp.data && !wp.error, target: wp.data?.base_url || b.website },
    { id: 'react', title: 'React.js Website', on: reactOn, loading: !react.data && !react.error, failed: react.data?.status === 'failed', target: react.data?.blog_url || react.data?.website_url },
    { id: 'html', title: 'HTML Website', on: Boolean(html.data?.ready), loading: !html.data && !html.error, failed: html.data?.status === 'error', target: html.data?.website_url }
  ];
  return (
    <div className="space-y-4">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Select blog publishing destination</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-w-5xl">
          {cards.map(c => (
            <button key={c.id} type="button" onClick={() => pick(c.id)}
              className={`text-left p-3 rounded-xl border cursor-pointer transition-colors ${chosen === c.id ? 'border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/30' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
              <span className="flex items-center gap-2">
                <span className="font-bold text-slate-900 text-[13px]">{c.title}</span>
                {c.loading ? <RefreshCw size={11} className="animate-spin text-slate-400" />
                  : <Badge tone={c.on ? 'green' : c.failed ? 'red' : 'gray'}>{c.on ? 'Connected' : c.failed ? (c.id === 'react' ? 'Authentication Failed' : c.id === 'html' ? 'Check failed' : 'Failed') : 'Not connected'}</Badge>}
              </span>
              <span className="block text-[11px] text-slate-500 font-mono truncate mt-0.5">{c.target ? `Target: ${c.target.replace(/^https?:\/\//, '')}` : 'Not set up yet'}</span>
            </button>
          ))}
        </div>
      </div>
      {children(chosen, setReactConn, setHtmlConn)}
    </div>
  );
}

/** Blog publishing setup, on its own: connect the website (WordPress, React or HTML) once, any time after the business is added. */
function PublishingSetup({ b }) {
  const toast = window.__seoToast || console.log;
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-18 font-semibold text-slate-900">Blog publishing setup</h2>
        <p className="text-13 text-slate-600 mt-1 max-w-2xl">Choose where articles for <b>{b.name}</b> are published and connect it once. After that, every article you write can be sent to the website as a draft, published now or scheduled. You can change or disconnect this at any time.</p>
      </Card>
      <Card>
        <PublishDestinations key={b.id} b={b}>
          {(dest, setReactConn, setHtmlConn) => dest === 'html' ? (
            <HtmlSitePanel b={b} article={null} toast={toast} onConnection={setHtmlConn} />
          ) : dest === 'react' ? (
            <ReactSitePanel b={b} article={null} featured={null} toast={toast} onConnection={setReactConn} />
          ) : (
            <SitePublishPanel b={b} article={null} featured={null} toast={toast} />
          )}
        </PublishDestinations>
      </Card>
    </div>
  );
}

const TOPIC_HANDOFF = 'growzen.writerTopic';

/**
 * Main AI Content Studio Component
 */
export default function ContentStudioPage() {
  const [tab, setTab] = useUrlTab('trends', ['trends', 'blog', 'articles', 'calendar', 'publishing']);
  const openInWriter = (id) => { if (!id) { setOpenArticleId(null); return; } setActiveTopic(null); setOpenArticleId(id); setTab('blog'); };
  // Moving from /trends to /blog remounts this page (the layout resets on every address), so a topic picked in
  // Topic Finder is handed over through sessionStorage and taken once here.
  const [activeTopic, setActiveTopic] = useState(() => {
    try {
      const raw = sessionStorage.getItem(TOPIC_HANDOFF);
      sessionStorage.removeItem(TOPIC_HANDOFF);
      return raw && tab === 'blog' ? JSON.parse(raw) : null;
    } catch { return null; }
  });
  const [openArticleId, setOpenArticleId] = useState(() => { const n = Number(new URLSearchParams(window.location.search).get('article')); return Number.isInteger(n) && n > 0 ? n : null; }); // a Growth task links to one article

  const handleSelectTopic = (topic) => {
    try { if (topic && tab !== 'blog') sessionStorage.setItem(TOPIC_HANDOFF, JSON.stringify(topic)); } catch { /* storage blocked: the topic is still set below */ }
    setActiveTopic(topic);
    setOpenArticleId(null);
    setTab('blog');
  };

  return (
    <SeoShell step="publish"
      title="AI Blog Studio & Autonomous Content Engine"
      subtitle="Find topics people search for, write articles from real keywords, check them against the top Google results, and publish them to your website"
    >
      {(b) => (
        <div className="space-y-5 animate-in fade-in duration-200">
          <Tabs
            value={tab}
            onChange={Object.assign((t) => { if (t === 'blog' && tab !== 'blog') { setOpenArticleId(null); setActiveTopic(null); } setTab(t); }, { locked: setTab.locked })}
            tabs={[
              { id: 'trends', label: 'Trending Topics Radar' },
              { id: 'blog', label: 'AI Blog & Article Writer' },
              { id: 'articles', label: 'Generated Articles' },
              { id: 'calendar', label: 'Publishing Calendar & CMS Queue' }
            ]}
          />

          {tab === 'trends' && <TrendingTopicsTab b={b} onSelectTopic={handleSelectTopic} />}
          {tab === 'blog' && <BlogStudioTab b={b} activeTopic={activeTopic} openId={openArticleId} setOpenId={setOpenArticleId} onPickTopic={handleSelectTopic} onShowArticles={() => setTab('articles')} toast={window.__seoToast || console.log} />}
          {tab === 'articles' && <GeneratedArticlesTab b={b} openId={openArticleId} onOpen={openInWriter} toast={window.__seoToast || console.log}
            onWrite={() => { setOpenArticleId(null); setActiveTopic(null); setTab('blog'); }} />}
          {tab === 'calendar' && <PublishingCalendar b={b} toast={window.__seoToast || console.log} onOpenArticle={openInWriter} />}
          {tab === 'publishing' && <PublishingSetup b={b} />}
        </div>
      )}
    </SeoShell>
  );
}
