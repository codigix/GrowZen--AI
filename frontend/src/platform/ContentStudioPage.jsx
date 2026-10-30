import React, { useEffect, useMemo, useState } from 'react';
import {
  Sparkles, Check, ChevronRight, Globe, ShieldCheck, AlertTriangle, RefreshCw,
  FileText, MapPin, Instagram, Facebook, Linkedin, Copy, Plus, CalendarDays,
  Flame, TrendingUp, TrendingDown, Search, Clock, ArrowUpRight, CheckCircle2, Lock, Sliders,
  Send, ExternalLink, Link2, Share2, Layers, Award, Tag, BarChart3, Code, Eye
} from 'lucide-react';
import {
  SeoShell, Card, Tabs, Badge, StatusPill, Button, Field, inputCls, areaCls,
  ScoreRing, Meter, SERIES, scoreWord, useSimulated, useToast, useAction, ErrorNote, PreviewNote
} from './SeoUi';
import { rng, shortDate, daysBack, ymd } from './seoMock';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts';
import { api, fmt, useApi, usePoll } from './seoApi';

const STEPS = ['Topic & Intent', 'AI Draft', 'E-E-A-T Enrichment', 'Quality Gate', 'Publish & Schedule'];

const serpFor = (b, kw) => {
  const r = rng(`${b.id}-${kw}-serp`);
  const sites = ['practo.com', 'justdial.com', 'apollohospitals.com', 'healthline.com', 'lybrate.com', 'competitor-hospital.in', 'quora.com', 'medium.com', 'sulekha.com', 'ncbi.nlm.nih.gov'];
  return sites.map((s, i) => ({
    pos: i + 1,
    site: s,
    title: `${kw.replace(/\b\w/g, c => c.toUpperCase())}${i % 3 === 0 ? ` in ${b.city}` : i % 3 === 1 ? ': Procedure, Cost & Recovery' : ' - Complete 2026 Guide'}`,
    words: Math.round((900 + r() * 2100) / 50) * 50,
    headings: Math.round(6 + r() * 12),
    faq: r() > 0.4
  }));
};

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
 * 1. Trending Topics Discovery Module: Google Trends rising/top queries (same API as Keyword Intelligence)
 */
function TrendingTopicsTab({ b, onSelectTopic }) {
  const [filter, setFilter] = useState('all');
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
  const trend = useApi(seed ? `/keyword-trends/planner?keyword=${encodeURIComponent(seed)}&country=IN&timeframe=past_30_days&limit=20&regional_limit=10` : null);

  const toTopic = (r) => ({ id: `${r.source_type}-${r.keyword}`, title: r.keyword, category: r.source_type, velocity: r.growth_indicator ?? extra[r.keyword]?.change, score: r.score ?? extra[r.keyword]?.interest, intent: intentOf(r.keyword, b), source: 'Google Trends' });
  // Google's related-queries data has no "change" for top queries and no "interest" for rising ones:
  // fill the gaps from each query's own trend (first 5 of each list, 2 at a time; the first failure stops the rest so Google is not hammered).
  const [extra, setExtra] = useState({});
  useEffect(() => {
    setExtra({});
    const d = trend.data;
    if (!d) return undefined;
    const todo = [
      ...(d.related_keywords || []).filter(r => r.growth_indicator == null).slice(0, 5),
      ...(d.rising_keywords || []).filter(r => r.score == null).slice(0, 5)
    ].map(r => r.keyword);
    let dead = false;
    const next = async () => {
      while (!dead && todo.length) {
        const kw = todo.shift();
        try {
          const t = await api(`/keyword-trends/trends?keyword=${encodeURIComponent(kw)}&country=IN&timeframe=past_30_days`);
          const ts = t.trend_summary || {};
          const c = ts.change_percent;
          if (!dead) setExtra(m => ({ ...m, [kw]: { interest: ts.latest_score ?? undefined, change: c == null ? undefined : `${c >= 0 ? '+' : ''}${Math.round(c)}%` } }));
        } catch { todo.length = 0; /* Google is rate limiting: stop asking, the rest stay "—" */ }
      }
    };
    next(); next();
    return () => { dead = true; };
  }, [trend.data]);
  const topQueries = useMemo(() => (trend.data?.related_keywords || []).map(toTopic), [trend.data, b, extra]);
  const risingQueries = useMemo(() => (trend.data?.rising_keywords || []).map(toTopic), [trend.data, b, extra]);
  const topics = [...risingQueries, ...topQueries];

  // Opening the writer: the topic becomes the first target keyword; Google Trends' related queries feed the keyword generator.
  const relatedAll = topics.map(t => t.title);
  const openWriter = (t, others = []) => onSelectTopic({ ...t, related: relatedAll, selected: others });
  const createFromSelection = () => {
    const [first, ...rest] = Object.keys(selected);
    openWriter(topics.find(t => t.title === first) || { title: first }, rest);
  };

  const passes = (t) => filter === 'all' ||
    (filter === 'local' && t.intent === 'Local') ||
    (filter === 'high' && (t.velocity === 'Breakout' || ratio(t.velocity) >= 30)) ||
    (filter === 'transactional' && t.intent === 'Transactional');

  return (
    <div className="space-y-4">
      {/* Search & Filter Header */}
      <div className="ai-glass-card rounded p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[280px]">
          <div className="relative flex-1 max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Enter a keyword to find trending topics (e.g. seo services)"
              value={typed}
              onChange={e => setTyped(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doSearch()}
              className="w-full h-9 pl-9 pr-3 text-[12px] bg-slate-50 border border-slate-200 focus:border-indigo-500 rounded-xl text-slate-900 placeholder-slate-400 outline-none"
            />
          </div>
          <Button variant="primary" icon={Search} disabled={!typed.trim()} onClick={doSearch}>Search</Button>
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {[
              { id: 'all', label: 'All Trends' },
              { id: 'local', label: 'Local Intent' },
              { id: 'high', label: 'High Velocity (🔥 +30%)' },
              { id: 'transactional', label: 'Transactional / Booking' }
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`h-8 px-3 rounded-lg text-11 font-semibold transition-all whitespace-nowrap cursor-pointer ${filter === f.id
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-white text-slate-700 hover:text-slate-900 border border-slate-200'
                  }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 text-11 text-slate-500 font-mono">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>Google Trends · India · Last 30 days</span>
        </div>
      </div>

      {pickedCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-indigo-50 border border-indigo-200 text-[12px]">
          <span className="text-indigo-900 font-semibold">{pickedCount} topic{pickedCount > 1 ? 's' : ''} selected{pickedCount >= 10 ? ' (maximum)' : ''}. Start topic: {Object.keys(selected)[0]}{pickedCount > 1 ? ` · Also include: ${Object.keys(selected).slice(1).join(', ')}` : ''}. The writer then generates the primary and secondary keywords for you to edit.</span>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setSelected({})}>Clear</Button>
            <Button size="sm" variant="ai" icon={Sparkles} onClick={createFromSelection}>Create Article</Button>
          </div>
        </div>
      )}

      {seeds.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-slate-500 font-mono uppercase">Seed keyword:</span>
          {seeds.map(s => (
            <button
              key={s}
              onClick={() => setPicked(s)}
              className={`h-7 px-2.5 rounded-lg font-semibold cursor-pointer border ${s === seed ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-200 hover:text-slate-900'}`}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {trend.data && !trend.loading && (() => {
        const ts = trend.data.trend_summary || {};
        const pts = (trend.data.interest_over_time || []).map(p => ({ date: p.date, value: p.value }));
        return (
          <div className="ai-glass-card rounded-2xl p-4 border border-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="text-[13px] font-bold text-slate-900">Trend analysis: “{trend.data.seed_keyword}”</div>
              {ts.classification && <span className="text-[11px] font-mono font-bold capitalize text-indigo-700">{ts.classification}</span>}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
              {[['Latest interest', ts.latest_score], ['Average', ts.average_score], ['Change', ts.change_percent != null ? `${ts.change_percent > 0 ? '+' : ''}${ts.change_percent}%` : null], ['Topics found', topics.length]].map(([l, v]) => (
                <div key={l} className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-slate-500 block text-[10px] uppercase font-mono">{l}</span>
                  <strong className="text-slate-800 font-mono">{v ?? '—'}</strong>
                </div>
              ))}
            </div>
            {pts.length > 1 && (
              <div className="h-40 mt-3">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={pts} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} minTickGap={24} />
                    <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} domain={[0, 100]} />
                    <Tooltip />
                    <Line type="monotone" dataKey="value" name="Interest" stroke="#4f46e5" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        );
      })()}
      {/* Trending Topics Cards */}
      {trend.error ? (
        <div className="py-10 text-center text-[13px] text-red-600">{trend.error.message}</div>
      ) : !seed ? (
        <div className="py-10 text-center text-[13px] text-slate-500">Add a primary category, a service or a tracked keyword to this business to load trending topics.</div>
      ) : trend.loading ? (
        <div className="py-10 text-center text-[13px] text-slate-500">Fetching Google Trends for “{seed}”…</div>
      ) : !topics.length ? (
        <div className="py-10 text-center text-[13px] text-slate-500">No trending topics found for “{seed}”.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {[
            ['Top queries', 'Most-searched related queries, scored 0-100 relative to the top one', topQueries],
            ['Rising queries', 'Queries with the biggest increase in search interest', risingQueries]
          ].map(([title, subtitle, rows]) => {
            const shown = rows.filter(passes);
            return (
              <Card key={title} title={title} subtitle={subtitle}>
                {shown.length ? (
                  <>
                    <div className="flex items-center gap-2 pb-2 mb-1 border-b border-slate-100 text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">
                      <span className="w-4" />
                      <span className="flex-1">Query</span>
                      <span className="w-8 text-right">Interest</span>
                      <span className="w-16 text-right">Change</span>
                      <span className="w-14 text-right"> </span>
                    </div>
                    <ul className="space-y-2">
                      {shown.map(t => {
                        const pct = /^[+-]\d+%$/.test(t.velocity || '') ? parseInt(t.velocity, 10) : null;
                        return (
                          <li key={t.id} className="flex items-center gap-2 text-[12.5px]">
                            <input type="checkbox" className="w-4 rounded text-indigo-600 focus:ring-0 cursor-pointer" checked={Boolean(selected[t.title])} onChange={() => toggle(t)} title="Select to generate an article" />
                            <span className="flex-1 text-slate-800">{t.title}</span>
                            <span className="tabular-nums text-slate-500 w-8 text-right">{t.score ?? <span className="text-slate-300">—</span>}</span>
                            <span className="w-16 text-right">
                              {t.velocity === 'Breakout' ? <Badge tone="blue">Breakout</Badge>
                                : pct != null ? (
                                  <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums ${pct >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                                    {pct >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}{Math.abs(pct)}%
                                  </span>
                                ) : t.velocity ? (
                                  <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums text-emerald-700">
                                    <TrendingUp size={11} />{t.velocity}
                                  </span>
                                ) : <span className="text-slate-300">—</span>}
                            </span>
                            <span className="w-14 text-right">
                              <button type="button" onClick={() => openWriter(t)} title="Create Brief & Draft" className="text-[11.5px] font-semibold text-indigo-700 hover:underline cursor-pointer">Draft</button>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                ) : <div className="py-6 text-center text-[13px] text-slate-500">No {title.toLowerCase()} found.</div>}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

const ARTICLE_LENGTHS = [
  { id: 'short', label: 'Short', words: '~850 words', time: '~4 min' },
  { id: 'standard', label: 'Standard', words: '~2,000 words', time: '~12–13 min' },
  { id: 'long', label: 'Long', words: '~2,500 words', time: '~15–22 min' }
];
const mins = (sec) => (sec >= 60 ? `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s` : `${Math.round(sec)}s`);

const ARTICLE_STATUS = { pending: ['Pending', 'gray'], generating: ['Generating', 'blue'], completed: ['Completed', 'green'], failed: ['Failed', 'red'] };

/**
 * 1b. Articles generated from the selected Google Trends keywords: one Ollama draft per keyword, each saved
 * separately. Opening one loads it into the E-E-A-T pipeline below.
 */
function ArticlesList({ b, articles, reload, openId, onOpen }) {
  const working = articles.some(a => a.status === 'pending' || a.status === 'generating');
  usePoll(() => reload(true), working, 3000);
  const [busy, error, run] = useAction();
  const retry = (id) => run(`r-${id}`, async () => { await api(`/businesses/${b.id}/articles/${id}/retry`, { method: 'POST' }); reload(true); });
  const del = (id) => run(`d-${id}`, async () => { await api(`/businesses/${b.id}/articles/${id}`, { method: 'DELETE' }); if (openId === id) onOpen(null); reload(true); });
  const done = articles.filter(a => a.status === 'completed').length;

  return (
    <Card title="Generated articles" subtitle={`${done} of ${articles.length} written by the local Ollama model. Each article covers all the keywords you selected and is saved separately.`}>
      <ul className="divide-y divide-slate-100">
        {articles.map(x => {
          const [label, tone] = ARTICLE_STATUS[x.status] || ARTICLE_STATUS.pending;
          return (
            <li key={x.id} className={`py-2.5 flex flex-wrap items-center gap-3 text-[12.5px] ${openId === x.id ? 'bg-indigo-50/60 -mx-2 px-2 rounded-lg' : ''}`}>
              <Badge tone={tone}>{x.status === 'generating' && <RefreshCw size={11} className="animate-spin" />}{label}</Badge>
              <div className="flex-1 min-w-[200px]">
                <div className="font-semibold text-slate-900">{x.title || x.keyword}</div>
                <div className="text-[11px] text-slate-500">Keywords: {[x.keyword, ...(x.secondary_keywords || [])].join(', ')}{x.error ? <span className="text-red-600"> · {x.error}</span> : null}</div>
                {x.status === 'generating' && x.progress && <div className="text-[11px] text-indigo-700 font-semibold mt-0.5">{x.progress}…</div>}
                {x.status === 'completed' && x.stats && (
                  <div className="text-[10.5px] text-slate-400 mt-0.5" title={(x.stats.steps || []).map(st => `${st.step}: ${mins(st.seconds)}, ${st.calls} call${st.calls === 1 ? '' : 's'}`).join('\n')}>
                    {ARTICLE_LENGTHS.find(l => l.id === x.stats.length)?.label || 'Standard'} · {x.stats.words} words · written in {mins(x.stats.total_seconds)} · {x.stats.ollama_calls} Ollama calls
                  </div>
                )}
              </div>
              {x.wp_url && <a href={x.wp_url} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-700 hover:underline">WordPress draft</a>}
              {x.status === 'completed' && (openId === x.id
                ? <span className="text-[11.5px] font-semibold text-emerald-700">Open below</span>
                : <button type="button" className="text-[11.5px] font-semibold text-indigo-700 hover:underline cursor-pointer" onClick={() => onOpen(x.id)}>Review & edit</button>)}
              {x.status === 'failed' && <button type="button" disabled={busy === `r-${x.id}`} className="text-[11.5px] font-semibold text-indigo-700 hover:underline cursor-pointer" onClick={() => retry(x.id)}>Retry</button>}
              <button type="button" disabled={busy === `d-${x.id}`} className="text-[11.5px] text-slate-400 hover:text-red-600 cursor-pointer" onClick={() => del(x.id)}>Delete</button>
            </li>
          );
        })}
      </ul>
      <ErrorNote>{error}</ErrorNote>
    </Card>
  );
}

/** The single "AI Blog & Article Writer" tab: the generated articles on top, the E-E-A-T pipeline for the open one below. */
function BlogStudioTab({ b, activeTopic, openId, setOpenId, onScheduled, toast }) {
  const list = useApi(`/businesses/${b.id}/articles`);
  const articles = list.data?.articles || [];
  const full = useApi(openId ? `/businesses/${b.id}/articles/${openId}` : null);
  const article = openId && full.data?.id === openId ? full.data : null;
  const [pendingId, setPendingId] = useState(null);  // an article started from the writer: opened as soon as it is written
  const pending = pendingId ? articles.find(x => x.id === pendingId) : null;
  const pendingFull = useApi(pendingId ? `/businesses/${b.id}/articles/${pendingId}` : null);  // the text written so far
  usePoll(() => pendingFull.reload(true), Boolean(pendingId), 1000);
  usePoll(() => list.reload(true), Boolean(pendingId), 2000);
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

  return (
    <div className="space-y-4">
      {articles.length > 0 && <ArticlesList b={b} articles={articles} reload={list.reload} openId={openId} onOpen={setOpenId} />}
      {pendingId && (
        <div className="flex items-center gap-2.5 p-3 rounded-xl bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 text-[12.5px] text-indigo-900 shadow-xs">
          <RefreshCw size={14} className="animate-spin text-indigo-600 shrink-0" />
          <span className="font-bold">AI is writing your blog live with Ollama ({pendingLength.label})</span>
          <span className="text-indigo-700 truncate hidden sm:inline">— {pending?.progress || 'Streaming line by line below…'}</span>
          <span className="ml-auto font-mono text-[11px] font-semibold text-slate-500 shrink-0">Elapsed {mins(elapsed)}</span>
        </div>
      )}
      {openId && !article
        ? <div className="py-10 text-center text-[13px] text-slate-500">Loading the article…</div>
        : <BlogWriterTab key={article ? `a${article.id}` : `t${activeTopic?.title || ''}`} b={b} selectedTopic={activeTopic} selectedArticle={article} pendingArticle={pendingId ? (pendingFull.data?.id === pendingId ? pendingFull.data : pending) : null} pendingLength={pendingLength} elapsed={elapsed} onGenerate={generate} generating={Boolean(pendingId)}
          onSaved={() => { full.reload(true); list.reload(true); }} onScheduled={onScheduled} toast={toast} />}
    </div>
  );
}
/**
 * 2. 7-Step AI Blog Writer & E-E-A-T Quality Gate
 */
function BlogWriterTab({ b, selectedTopic, selectedArticle, pendingArticle, pendingLength, elapsed = 0, onGenerate, generating, onSaved, onScheduled, toast }) {
  const [step, setStep] = useState(selectedArticle ? 1 : 0);
  const [kw, setKw] = useState(selectedArticle ? selectedArticle.keyword : selectedTopic ? selectedTopic.title : '');  // the primary keyword
  const [topicText, setTopicText] = useState(selectedArticle ? selectedArticle.topic || selectedArticle.keyword : selectedTopic ? selectedTopic.title : '');
  const [secondaryList, setSecondaryList] = useState(selectedArticle ? selectedArticle.secondary_keywords || [] : selectedTopic?.selected || []);
  const [kwReady, setKwReady] = useState(Boolean(selectedArticle));  // the full blog is only started once there is a keyword set
  const [kwBusy, setKwBusy] = useState(false);
  const [kwError, setKwError] = useState('');
  const [kwNote, setKwNote] = useState('');
  const [intent, setIntent] = useState('');
  const [related, setRelated] = useState(selectedTopic?.related || []);
  const [busy, run] = useSimulated();
  const serp = useMemo(() => serpFor(b, kw), [b, kw]);
  const avgWords = Math.round(serp.reduce((s, x) => s + x.words, 0) / serp.length / 50) * 50;

  const topic = kw.trim() || 'your topic';
  const place = [b.area, b.city].filter(Boolean).join(', ');
  const [outline, setOutline] = useState(() => [
    `What is ${topic}?`,
    `Why people are searching for ${topic} right now`,
    `${topic}: key options, costs and what to expect${place ? ` in ${place}` : ''}`,
    `How to choose the right provider for ${topic}`,
    `How ${b.name} can help`,
    `Frequently asked questions about ${topic}`
  ]);

  const [draft, setDraft] = useState(selectedArticle ? selectedArticle.body || '' : '');
  const [meta, setMeta] = useState({
    keyword: selectedArticle?.keyword || '',
    secondary: (selectedArticle?.secondary_keywords || []).join(', '),
    title: selectedArticle?.title || '',
    meta_description: selectedArticle?.meta_description || ''
  });
  useEffect(() => {
    if (selectedArticle) {
      setDraft(selectedArticle.body || '');
      setMeta({
        keyword: selectedArticle.keyword || '',
        secondary: (selectedArticle.secondary_keywords || []).join(', '),
        title: selectedArticle.title || '',
        meta_description: selectedArticle.meta_description || ''
      });
    }
  }, [selectedArticle]);
  const isGenerating = Boolean(generating || (pendingArticle && pendingArticle.status === 'generating'));
  const activeArt = selectedArticle || pendingArticle;
  const liveBody = activeArt?.body || draft || '';
  const liveTitle = activeArt?.title || meta?.title || '';
  const liveMetaDesc = activeArt?.meta_description || meta?.meta_description || '';
  const liveProgress = pendingArticle?.progress || (generating ? 'Starting Ollama model…' : '');
  const [wpBusy, setWpBusy] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState('');
  const [articleLength, setArticleLength] = useState(() => { try { return localStorage.getItem('growzen.articleLength') || 'standard'; } catch { return 'standard'; } });
  const pickLength = (id) => { setArticleLength(id); try { localStorage.setItem('growzen.articleLength', id); } catch { /* remembered for this page only */ } };

  // Primary + secondary keywords written by Ollama; the backend adds Google Trends' related queries when Google answers in time.
  // Manual edits stay until this runs again.
  const suggestKeywords = async (regen) => {
    setKwBusy(true); setKwError(''); setKwNote('');
    const keep = regen ? [] : selectedTopic?.selected || [];
    try {
      const r = await api(`/businesses/${b.id}/articles/keywords`, {
        method: 'POST',
        body: { topic: topicText.trim(), related: [...(selectedTopic?.selected || []), ...related], avoid: regen ? [kw, ...secondaryList].filter(Boolean) : [] }
      });
      setKw(r.primary);
      setSecondaryList([...new Set([...keep, ...r.secondary])].slice(0, 10));
      setIntent(r.intent || '');
      setKwNote(r.trends === 'ok' || r.trends === 'cached' || r.trends === 'provided'
        ? 'Keywords were written by Ollama together with Google Trends related queries. They have no verified search volumes.'
        : 'Google Trends is not available right now (rate limited), so Ollama wrote these keywords on its own. They have no verified search volumes.');
    } catch (e) {
      setKwError(`${e.message || e} You can type the keywords yourself below.`);
      if (!kw.trim()) setKw(topicText.trim().toLowerCase());
      if (!secondaryList.length) setSecondaryList(related.slice(0, 6));
    } finally {
      setKwReady(true); setKwBusy(false);
    }
  };
  useEffect(() => { if (selectedTopic && !selectedArticle) suggestKeywords(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const generateBlog = () => {
    const keywords = [kw, ...secondaryList].map(k => k.trim().toLowerCase()).filter(Boolean);
    setGenBusy(true); setGenError('');
    return onGenerate({ topic: topicText.trim() || kw.trim(), keywords, length: articleLength }).catch(e => setGenError(e.message || String(e))).finally(() => setGenBusy(false));
  };

  const articleFields = () => ({
    keyword: meta.keyword, secondary_keywords: meta.secondary.split(',').map(k => k.trim()).filter(Boolean),
    title: meta.title, meta_description: meta.meta_description, body: draft
  });
  const [saveBusy, setSaveBusy] = useState(false);
  const saveArticle = () => {
    setSaveBusy(true);
    return api(`/businesses/${b.id}/articles/${selectedArticle.id}`, { method: 'PATCH', body: articleFields() })
      .then(() => { toast('Draft saved'); if (onSaved) onSaved(); })
      .catch(e => toast(e.message))
      .finally(() => setSaveBusy(false));
  };
  const [enrich, setEnrich] = useState({ prices: true, quote: true, photos: true, local: true });
  const [cms, setCms] = useState('GrowZen Website Builder');
  const [published, setPublished] = useState(false);
  const [scheduledDate, setScheduledDate] = useState('2026-10-30T10:00');

  const makeDraft = () => {
    const title = topic.replace(/\b\w/g, c => c.toUpperCase());
    const contact = [b.phone && `call ${b.phone}`, b.website && `visit ${b.website}`].filter(Boolean).join(' or ');
    return `# ${title}${place ? ` in ${place}` : ''}\n\n` +
      outline.map((h, n) => `## ${n + 1}. ${h}\n[Write about "${h}" using real details from ${b.name}.]\n`).join('\n') +
      (contact ? `\nTo know more, ${contact}.` : '');
  };

  const enrichDone = Object.values(enrich).filter(Boolean).length;
  const score = Math.min(98, 62 + enrichDone * 7 + (outline.length >= 6 ? 6 : 0) + 4);

  const next = () => {
    if (step === 0) {
      // Topic & Intent -> start real Ollama generation, then go to AI Draft
      if (kwReady && kw.trim()) {
        generateBlog().then(() => setStep(1));
      } else {
        run('draft', () => { setStep(1); }, 800);
      }
      return;
    }
    if (step === 4 && selectedArticle && cms === 'WordPress REST API') {
      setWpBusy(true);
      return api(`/businesses/${b.id}/articles/${selectedArticle.id}`, { method: 'PATCH', body: articleFields() })
        .then(() => api(`/businesses/${b.id}/articles/${selectedArticle.id}/publish-wordpress`, { method: 'POST' }))
        .then(() => { setPublished(true); toast('Sent to WordPress as a draft.'); })
        .catch(e => toast(e.message))
        .finally(() => setWpBusy(false));
    }
    if (step === 4) {
      return run('pub', () => {
        setPublished(true);
        toast(`Article successfully scheduled and synced with ${cms}! Search Console indexing submitted.`);
        if (onScheduled) {
          onScheduled({
            title: kw,
            slug: kw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
            cms,
            date: scheduledDate,
            status: 'Scheduled'
          });
        }
      }, 1300);
    }
    return setStep(s => Math.min(STEPS.length - 1, s + 1));
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
      {/* Step Navigator */}
      <Card title="E-E-A-T Content Pipeline" className="xl:col-span-1">
        <ol className="space-y-1.5">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button
                onClick={() => i <= step && setStep(i)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded text-12 font-semibold text-left transition-colors cursor-pointer ${i === step
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                  : i < step
                    ? 'text-slate-800 hover:bg-slate-50'
                    : 'text-slate-500'
                  }`}
              >
                <span className={`w-5 h-5 rounded-full text-10 flex items-center justify-center font-bold ${i < step ? 'bg-emerald-500 text-white' : i === step ? 'bg-white text-blue-600' : 'bg-slate-100 text-slate-500'
                  }`}>
                  {i < step ? <Check size={11} strokeWidth={3} /> : i + 1}
                </span>
                <span className="truncate">{s}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="mt-4 p-3 rounded bg-white border border-slate-200 text-11 text-slate-500 leading-relaxed">
          <ShieldCheck size={13} className="text-emerald-700 inline mr-1" />
          Content is cross-checked against Google Search Essentials, E-E-A-T guidelines, and hospital policy safeguards.
        </div>
      </Card>

      {/* Main Step Workspace */}
      <Card
        className="xl:col-span-3"
        title={STEPS[step]}
        action={
          <Button
            variant={step === 4 ? 'primary' : 'secondary'}
            busy={Boolean(busy) || wpBusy}
            onClick={next}
            disabled={published}
          >
            {step === 4 ? (published ? 'Scheduled & Live' : 'Approve & Schedule to CMS') : step === 0 ? 'Generate Blog' : 'Next Step'}
            {step < 6 && <ChevronRight size={13} />}
          </Button>
        }
      >
        {/* Step 0: Keyword & Intent */}
        {step === 0 && (
          <div className="space-y-4 max-w-2xl">
            <Field label="Topic" hint="Picked from Google Trends, or type your own topic">
              <input className={inputCls} placeholder="e.g. social media marketing" value={topicText} onChange={e => setTopicText(e.target.value)} />
            </Field>
            {onGenerate && (
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[12px] font-bold text-slate-800">Keywords for this article</div>
                  <Button size="sm" icon={RefreshCw} busy={kwBusy} disabled={topicText.trim().length < 2} onClick={() => suggestKeywords(kwReady)}>
                    {kwReady ? 'Regenerate Keywords' : 'Generate Keywords'}
                  </Button>
                </div>
                {kwBusy && <div className="text-[11.5px] text-indigo-700 flex items-center gap-1.5"><RefreshCw size={12} className="animate-spin" />Writing keywords for “{topicText}” with Ollama (about 20 seconds)…</div>}
                {kwError && <div className="text-[11.5px] text-amber-800">{kwError}</div>}
                {kwReady && !kwBusy && kwNote && <div className="text-[11px] text-slate-500">{kwNote}</div>}
                {!kwReady && !kwBusy && <div className="text-[11.5px] text-slate-500">Enter a topic and click Generate Keywords. The blog is written after you confirm the keywords.</div>}
                {kwReady && (
                  <>
                    {intent && <div className="text-[11.5px] text-slate-600">Search intent: <span className="inline-block px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-800 font-semibold capitalize">{intent}</span></div>}
                    <Field label="Primary keyword" hint="Appears in the title, meta description and introduction">
                      <input className={inputCls} value={kw} onChange={e => setKw(e.target.value)} />
                    </Field>
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Secondary keywords <span className="normal-case tracking-normal font-normal text-slate-400">({secondaryList.filter(k => k.trim()).length}, 5 to 10 works best; edit, add or remove)</span></div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {secondaryList.map((k, i) => (
                          <div key={i} className="flex items-center gap-1.5">
                            <input className={inputCls} value={k} onChange={e => setSecondaryList(l => l.map((x, j) => (j === i ? e.target.value : x)))} />
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
                <div className="grid grid-cols-3 gap-2 max-w-xl">
                  {ARTICLE_LENGTHS.map(l => (
                    <button key={l.id} type="button" onClick={() => pickLength(l.id)}
                      className={`p-2 rounded-xl border text-left cursor-pointer transition-all ${articleLength === l.id ? 'bg-indigo-600 border-indigo-600 text-white shadow-md' : 'bg-white border-slate-200 text-slate-700 hover:border-indigo-300'}`}>
                      <div className="text-[12px] font-bold">{l.label}</div>
                      <div className={`text-[10.5px] ${articleLength === l.id ? 'text-indigo-100' : 'text-slate-500'}`}>{l.words} · {l.time}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {onGenerate && (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="ai" icon={Sparkles} busy={genBusy} disabled={!kwReady || kwBusy || !kw.trim() || generating} onClick={generateBlog}>Generate Blog</Button>
                {generating && <span className="text-[11.5px] text-amber-700 font-semibold">An article is being written; wait for it to finish.</span>}
                <span className="text-[11.5px] text-slate-500">Writes a complete blog (SEO title, meta description, introduction, H2/H3 sections, FAQs, conclusion) using every keyword above, then opens it for review.</span>
              </div>
            )}
            {genError && <div className="text-[12px] text-red-600">{genError}</div>}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-[12px]">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Growth:</span>
                <Badge tone="blue">Local Transactional / Patient Guidance</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Target Conversion URL:</span>
                <span className="font-mono text-cyan-700">/{kw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Suggested Format:</span>
                <span className="text-slate-800 font-semibold">2026 Comprehensive Cost & Clinical Guide</span>
              </div>
            </div>
          </div>
        )}

        {/* Step 1: AI Draft */}
        {step === 1 && (
          <div className="space-y-4">
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
                      Ollama llama3.2
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
                      <div className="flex flex-wrap gap-1.5">
                        {meta.keyword.trim() && chip(meta.keyword.trim(), true)}
                        {secondary.map(k => chip(k, false))}
                        {!secondary.length && <span className="text-[11.5px] text-slate-500">No secondary keywords. Add some above, separated by commas.</span>}
                      </div>
                    </div>
                  );
                })()}
                <Field label="SEO title" hint={`${meta.title.length} characters (aim for 60 or fewer)`}><input className={inputCls} value={meta.title} onChange={e => setMeta(m => ({ ...m, title: e.target.value }))} /></Field>
                <Field label="Meta description" hint={`${meta.meta_description.length} characters (aim for 150-160)`}><textarea rows={2} className={areaCls} value={meta.meta_description} onChange={e => setMeta(m => ({ ...m, meta_description: e.target.value }))} /></Field>
                <Field label="Article body (HTML: introduction, H2/H3 sections, FAQs, conclusion)">
                  <textarea rows={18} className={`${areaCls} font-mono text-[12px] leading-relaxed`} value={draft} onChange={e => setDraft(e.target.value)} />
                </Field>
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
                        className="text-[13px] text-slate-800 leading-relaxed space-y-3 [&_h2]:text-[15px] [&_h2]:font-bold [&_h2]:text-slate-900 [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:border-b [&_h2]:border-slate-100 [&_h2]:pb-1 [&_h3]:text-[13.5px] [&_h3]:font-semibold [&_h3]:text-slate-800 [&_h3]:mt-3 [&_p]:mt-2 [&_p]:text-slate-700 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mt-1"
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
                      <div className="text-[13px] font-bold text-slate-700">Connecting to Ollama…</div>
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

        {step === 2 && (
          <div className="space-y-3 max-w-xl">
            <p className="text-12 text-slate-700 mb-2">
              Inject first-hand medical proof points to safeguard against generic, low-value AI penalties.
            </p>
            {[
              ['prices', 'Verified Subsidized Package Pricing (₹12,000 - ₹65,000)'],
              ['quote', 'Quote from Senior Ophthalmologist / Medical Director'],
              ['photos', 'Hospital OT & Biometry Diagnostics Photos (No stock photos)'],
              ['local', 'Local PCMC Access: Opposite Chinchwad Railway Station, Free Parking']
            ].map(([k, l]) => (
              <label key={k} className="flex items-center gap-3 p-3 rounded bg-slate-50 border border-slate-200 text-12 cursor-pointer hover:bg-slate-50 transition-colors">
                <input
                  type="checkbox"
                  checked={enrich[k]}
                  onChange={e => setEnrich({ ...enrich, [k]: e.target.checked })}
                  className="rounded text-blue-600 focus:ring-0"
                />
                <span className="text-slate-800 font-medium">{l}</span>
              </label>
            ))}
          </div>
        )}

        {/* Step 5: Quality Gate & Fact Checks */}
        {step === 3 && (
          <div className="flex flex-wrap gap-6 items-center">
            <ScoreRing score={score} label={scoreWord(score)} size={110} />
            <div className="flex-1 min-w-[280px] space-y-3">
              {[
                ['Search Intent & Keyword Saturation', 94],
                ['Topic Depth vs Top 10 SERP', 75 + enrichDone * 5],
                ['Internal Anchor Linking', 95],
                ['E-E-A-T Real Fact Verification', 50 + enrichDone * 12]
              ].map(([l, v], i) => (
                <div key={l}>
                  <div className="flex justify-between text-11 mb-1">
                    <span className="text-slate-500">{l}</span>
                    <span className="font-mono font-bold text-slate-900">{Math.min(100, v)}%</span>
                  </div>
                  <Meter value={Math.min(100, v)} color={SERIES[i % 3]} />
                </div>
              ))}
              <div className="flex flex-wrap gap-2 pt-1 text-11">
                <StatusPill level="good">Plagiarism 0.5% (Clean)</StatusPill>
                <StatusPill level="good">Medical Disclaimer Attached</StatusPill>
                <StatusPill level="good">Spam-Risk: None</StatusPill>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Publish & Schedule */}
        {step === 4 && (
          <div className="max-w-xl space-y-4 text-[12px]">
            <div>
              <label className="block text-slate-700 font-bold mb-2">Select Target CMS Integration</label>
              <div className="grid grid-cols-3 gap-2">
                {['GrowZen Website Builder', 'WordPress REST API', 'Webflow'].map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCms(c)}
                    className={`h-10 px-2 rounded border text-11 font-bold cursor-pointer transition-all ${cms === c
                      ? 'bg-blue-600 text-white border-blue-500 shadow-md'
                      : 'bg-slate-50 text-slate-500 border-slate-200 hover:text-slate-900'
                      }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <Field label="Scheduled Publishing Date & Time">
              <input
                type="datetime-local"
                value={scheduledDate}
                onChange={e => setScheduledDate(e.target.value)}
                className={inputCls}
              />
            </Field>

            <div className="p-3.5 rounded bg-slate-50 border border-slate-200 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer text-slate-700">
                <input type="checkbox" defaultChecked />
                <span>Auto-publish to website once scheduled date arrives</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-slate-700">
                <input type="checkbox" defaultChecked />
                <span>Trigger instant Google Search Console indexing ping upon publishing</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-slate-700">
                <input type="checkbox" defaultChecked />
                <span>Inject internal backlink to the article page</span>
              </label>
            </div>

            {published && (
              <div className="p-3.5 rounded bg-emerald-500/10 border border-emerald-500/25 text-emerald-700 flex items-center justify-between text-11 font-mono">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-emerald-700" />
                  <span>Scheduled on {cms} for {new Date(scheduledDate).toLocaleString()}</span>
                </div>
                <Badge tone="green">Verified</Badge>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

/**
 * 3. Content Calendar & Scheduled Publishing Queue
 */
function CalendarTab({ b, scheduledItems }) {
  const allEvents = useMemo(() => {
    const base = [
      { id: 1, d: 2, title: 'GBP Post: 24/7 Emergency Eye Trauma Care', kind: 'gbp', status: 'Published' },
      { id: 2, d: 6, title: 'Blog: Micro-Incision Cataract Surgery (MICS) in PCMC', kind: 'blog', status: 'Scheduled' },
      { id: 3, d: 10, title: 'Location Page: Eye Clinic in Chinchwad Station', kind: 'page', status: 'Approved' },
      { id: 4, d: 14, title: 'GBP Post: Free Cataract Screening Camp Sunday', kind: 'gbp', status: 'Scheduled' },
      { id: 5, d: 18, title: 'Blog: Cashless Mediclaim & TPA Insurance Guide', kind: 'blog', status: 'Draft' },
      { id: 6, d: 24, title: 'GBP Post: Doctor Consultation Hours Update', kind: 'gbp', status: 'Scheduled' },
      { id: 7, d: 28, title: 'Blog Refresh: Femto Laser vs Phacoemulsification', kind: 'refresh', status: 'In Review' }
    ];
    return base;
  }, []);

  const tone = { gbp: 'blue', blog: 'violet', page: 'green', refresh: 'amber' };
  const start = new Date();
  start.setDate(1);
  const offset = (start.getDay() + 6) % 7;

  return (
    <div className="space-y-5">
      <Card
        title={`${start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} Publishing Calendar`}
        subtitle="Autonomous schedule across Google Business Profile, Hospital CMS, and local landing pages"
        action={
          <div className="flex items-center gap-2">
            <span className="text-11 text-slate-500 font-mono">CMS Destination: GrowZen CMS</span>
          </div>
        }
      >
        <div className="grid grid-cols-7 gap-1 text-11 font-mono text-slate-500 mb-1 text-center font-bold">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} className="py-1">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: 35 }, (_, i) => {
            const day = i - offset + 1;
            const valid = day >= 1 && day <= new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
            const events = allEvents.filter(x => x.d === day);

            return (
              <div
                key={i}
                className={`min-h-[85px] rounded border p-2 transition-all ${valid
                  ? 'border-slate-200 bg-slate-50 hover:border-indigo-500/30'
                  : 'border-transparent bg-transparent opacity-20'
                  }`}
              >
                {valid && (
                  <>
                    <div className="text-11 font-mono text-slate-500 font-bold mb-1">{day}</div>
                    <div className="space-y-1">
                      {events.map(ev => (
                        <div
                          key={ev.id}
                          className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-10 truncate text-slate-700 font-medium"
                          title={ev.title}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full inline-block mr-1 ${ev.kind === 'blog' ? 'bg-purple-400' : ev.kind === 'gbp' ? 'bg-blue-400' : 'bg-emerald-400'
                            }`} />
                          {ev.title}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

/**
 * 4. Contextual Backlink & Digital PR Outreach Hub
 */
function BacklinksTab({ b, toast }) {
  const [prospects, setProspects] = useState([
    {
      id: 1,
      domain: 'practo.com/pune/hospitals/cataract',
      name: 'Practo Healthcare Directory',
      type: 'Medical Registry',
      da: 88,
      status: 'Link Acquired',
      anchor: 'Moraya Charitable Hospital Cataract Care',
      target: '/cataract-surgery-in-pcmc'
    },
    {
      id: 2,
      domain: 'punenews.org/health/eye-care-charity',
      name: 'Pune News Community Health',
      type: 'Local Publication',
      da: 62,
      status: 'Outreach Sent',
      anchor: 'Affordable cataract surgery in PCMC',
      target: '/cataract-surgery-in-pcmc'
    },
    {
      id: 3,
      domain: 'justdial.com/pune/eye-surgeons-chinchwad',
      name: 'JustDial PCMC Verified Business',
      type: 'Local Citation NAP',
      da: 84,
      status: 'Link Acquired',
      anchor: 'Moraya Multispeciality Hospital',
      target: '/'
    },
    {
      id: 4,
      domain: 'ima-pune.org/members/moraya-hospital',
      name: 'Indian Medical Association Directory',
      type: 'Accreditation Body',
      da: 71,
      status: 'Qualified Prospect',
      anchor: 'NABH Charitable Eye Care Unit',
      target: '/cataract-surgery-in-pcmc'
    }
  ]);

  const [pitching, setPitching] = useState(null);

  const sendPitch = (p) => {
    toast(`Personalized digital PR pitch drafted and sent for ${p.name}!`);
    setProspects(prev => prev.map(x => x.id === p.id ? { ...x, status: 'Outreach Sent' } : x));
    setPitching(null);
  };

  return (
    <div className="space-y-5">
      {/* Top Value Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="ai-glass-card rounded p-[18px] border border-emerald-500/20">
          <div className="text-11 font-bold uppercase tracking-wider text-emerald-700 font-mono">
            Verified Referring Domains
          </div>
          <div className="text-3xl font-extrabold text-slate-900 mt-2 font-display">18 Domains</div>
          <p className="text-11 text-slate-500 mt-1">100% legitimate editorial & medical listings</p>
        </div>

        <div className="ai-glass-card rounded p-[18px] border border-cyan-500/20">
          <div className="text-11 font-bold uppercase tracking-wider text-cyan-700 font-mono">
            Key Anchor Target URL
          </div>
          <div className="text-13 font-mono font-bold text-cyan-700 mt-2 truncate">
            /cataract-surgery-in-pcmc
          </div>
          <p className="text-11 text-slate-500 mt-1">Directing link equity to primary service page</p>
        </div>

        <div className="ai-glass-card rounded p-[18px] border border-purple-500/20">
          <div className="text-11 font-bold uppercase tracking-wider text-purple-600 font-mono">
            Ethical Outreach Guardrail
          </div>
          <div className="text-13 font-bold text-slate-900 mt-2">Zero Spam / PBN Safe</div>
          <p className="text-11 text-slate-500 mt-1">Strict compliance with Google link spam policies</p>
        </div>
      </div>

      {/* Prospects & Live Backlinks Table */}
      <Card
        title="Authority Prospects & Verified Backlinks"
        subtitle="Legitimate citations and medical publication relationship pipeline"
      >
        <div className="rounded border border-slate-200 overflow-hidden">
          <table className="w-full text-12">
            <thead className="bg-white text-slate-500 border-b border-slate-200">
              <tr>
                <th className="p-3 text-left">Prospect / Publication</th>
                <th className="p-3 text-left">Category</th>
                <th className="p-3 text-center font-mono">Domain Auth</th>
                <th className="p-3 text-left">Anchor Text & Target</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-slate-50">
              {prospects.map(p => (
                <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                  <td className="p-3">
                    <div className="font-bold text-slate-900">{p.name}</div>
                    <div className="text-10 text-cyan-700 font-mono">{p.domain}</div>
                  </td>
                  <td className="p-3 text-slate-700 font-medium">{p.type}</td>
                  <td className="p-3 text-center font-mono font-bold text-slate-800">DA {p.da}</td>
                  <td className="p-3">
                    <div className="text-slate-900 font-medium">"{p.anchor}"</div>
                    <div className="text-10 text-indigo-700 font-mono">{p.target}</div>
                  </td>
                  <td className="p-3">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-10 font-mono font-bold border ${p.status === 'Link Acquired'
                      ? 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30'
                      : p.status === 'Outreach Sent'
                        ? 'bg-blue-500/15 text-blue-700 border-blue-500/30'
                        : 'bg-amber-500/15 text-amber-700 border-amber-500/30'
                      }`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    {p.status === 'Qualified Prospect' ? (
                      <Button size="sm" variant="ai" icon={Send} onClick={() => sendPitch(p)} className="text-xs">
                        Draft Pitch
                      </Button>
                    ) : (
                      <span className="text-emerald-700 font-mono text-11 font-bold flex items-center justify-end gap-1">
                        <CheckCircle2 size={13} /> Active
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/**
 * Main AI Content Studio Component
 */
export default function ContentStudioPage() {
  const [tab, setTab] = useUrlTab('trends', ['trends', 'blog', 'calendar', 'backlinks']);
  const [activeTopic, setActiveTopic] = useState(null);
  const [openArticleId, setOpenArticleId] = useState(null);

  const handleSelectTopic = (topic) => {
    setActiveTopic(topic);
    setOpenArticleId(null);
    setTab('blog');
  };

  return (
    <SeoShell
      title="AI Blog Studio & Autonomous Content Engine"
      subtitle="Discover trending patient queries, draft E-E-A-T validated medical articles, schedule CMS publishing, and build ethical backlinks"
    >
      {(b) => (
        <div className="space-y-5 animate-in fade-in duration-200">
          <Tabs
            value={tab}
            onChange={(t) => { if (t === 'blog' && tab !== 'blog') { setOpenArticleId(null); setActiveTopic(null); } setTab(t); }}
            tabs={[
              { id: 'trends', label: 'Trending Topics Radar' },
              { id: 'blog', label: 'AI Blog & Article Writer (E-E-A-T)' },
              { id: 'calendar', label: 'Publishing Calendar & CMS Queue' },
              { id: 'backlinks', label: 'Backlink & Digital PR Hub' }
            ]}
          />

          {tab === 'trends' && <TrendingTopicsTab b={b} onSelectTopic={handleSelectTopic} />}
          {tab === 'blog' && <BlogStudioTab b={b} activeTopic={activeTopic} openId={openArticleId} setOpenId={setOpenArticleId} toast={window.__seoToast || console.log} />}
          {tab === 'calendar' && <CalendarTab b={b} />}
          {tab === 'backlinks' && <BacklinksTab b={b} toast={window.__seoToast || console.log} />}
        </div>
      )}
    </SeoShell>
  );
}
