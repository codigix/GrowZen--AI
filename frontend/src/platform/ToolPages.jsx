import React, { useState } from 'react';
import { Link, useParams, Navigate } from 'react-router-dom';
import { Copy, Check, Plus, Sparkles, ArrowRight, PlugZap } from 'lucide-react';
import { SeoShell, Card, Badge, Button, ErrorNote, Field, inputCls, areaCls, useAction, useToast, Empty } from './SeoUi';
import { api } from './seoApi';
import { FEATURES } from '../components/featureCatalog';
import Select from '../components/Select';

const sel = 'h-10 px-3 text-13 rounded border border-slate-200 bg-white text-slate-700 cursor-pointer';

function CopyBtn({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  const copy = () => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); });
  return <Button size="sm" icon={done ? Check : Copy} onClick={copy}>{done ? 'Copied' : label}</Button>;
}

const List = ({ items, empty }) => (items?.length ? <ul className="space-y-1.5 text-13 text-slate-700 list-disc pl-5 marker:text-indigo-300">{items.map((x, i) => <li key={i}>{typeof x === 'string' ? x : JSON.stringify(x)}</li>)}</ul> : <p className="text-13 text-slate-400">{empty || 'None.'}</p>);

// ---------------------------------------------------------------- SEO brief
function Brief({ b }) {
  const [keyword, setKeyword] = useState('');
  const [busy, error, run] = useAction();
  const [res, setRes] = useState(null);
  const go = (e) => { e.preventDefault(); run('brief', async () => setRes(await api(`/businesses/${b.id}/tools/seo-brief`, { method: 'POST', body: { keyword } }))); };
  const x = res?.brief;
  const asText = x ? [`SEO brief: ${res.keyword}`, `Title: ${x.title_tag}`, `Meta: ${x.meta_description}`, `Intent: ${x.search_intent}`, `Target words: ${x.target_words}`, '', ...(x.outline || []).flatMap(o => [`## ${o.h2}`, ...(o.points || []).map(p => `- ${p}`), ...(o.h3 || []).map(h => `### ${h}`)]), '', 'Questions to answer:', ...(x.questions_to_answer || []).map(q => `- ${q}`)].join('\n') : '';
  return (
    <div className="space-y-4">
      <Card title="Write a brief for a keyword" subtitle="Reads what ranks on Google now, the questions people ask, and builds an outline to beat it">
        <form onSubmit={go} className="flex flex-col sm:flex-row gap-2.5">
          <input className={inputCls} value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="e.g. best dental clinic in Pune" aria-label="Keyword" />
          <Button type="submit" variant="primary" icon={Sparkles} busy={busy === 'brief'} disabled={keyword.trim().length < 2}>Generate brief</Button>
        </form>
        <ErrorNote>{error}</ErrorNote>
      </Card>
      {x && (
        <>
          <div className="flex justify-end"><CopyBtn text={asText} label="Copy brief" /></div>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
            <div className="xl:col-span-2 space-y-4">
              <Card title="Title and description" subtitle={res.live_results ? 'Based on live Google results' : 'Written by the AI model from your business details and the questions Google Keyword Planner shows'}>
                <Field label={`Title tag (${x.title_tag.length}/60)`}><div className="text-14 text-slate-900 font-semibold">{x.title_tag}</div></Field>
                <div className="mt-3"><Field label={`Meta description (${x.meta_description.length}/155)`}><div className="text-13 text-slate-700">{x.meta_description}</div></Field></div>
                <div className="mt-3 flex flex-wrap gap-2 text-12"><Badge tone="violet">{x.search_intent}</Badge>{x.target_words && <Badge>{x.target_words} words</Badge>}</div>
              </Card>
              <Card title="Outline">
                <div className="space-y-4">{(x.outline || []).map((o, i) => (
                  <div key={i}><div className="text-14 font-semibold text-slate-900">H2: {o.h2}</div><List items={o.points} />{o.h3?.length > 0 && <div className="mt-1.5 text-12.5 text-slate-500">H3: {o.h3.join(' · ')}</div>}</div>))}</div>
              </Card>
              <Card title="How to beat the pages that rank"><List items={x.how_to_beat_the_top_results} /></Card>
            </div>
            <div className="space-y-4">
              <Card title="Questions to answer"><List items={x.questions_to_answer} /></Card>
              <Card title="Terms to include">{x.terms_to_include?.length ? <div className="flex flex-wrap gap-1.5">{x.terms_to_include.map(t => <Badge key={t}>{t}</Badge>)}</div> : <p className="text-13 text-slate-400">None.</p>}</Card>
              <Card title="Internal link ideas"><List items={x.internal_link_ideas} /></Card>
              <Card title="Ranking now" subtitle="The top results this brief was built from">
                {res.ranking_now.length ? <ol className="space-y-2 text-12.5">{res.ranking_now.map(r => <li key={r.url}><a href={r.url} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline font-medium">{r.position}. {r.title}</a></li>)}</ol> : <p className="text-13 text-slate-400">Not available.</p>}
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Social poster
const PLATFORMS = [['facebook', 'Facebook'], ['instagram', 'Instagram'], ['x', 'X'], ['linkedin', 'LinkedIn'], ['gbp', 'Google Business post']];
function Social({ b }) {
  const [topic, setTopic] = useState('');
  const [tone, setTone] = useState('friendly');
  const [picked, setPicked] = useState(['facebook', 'instagram', 'x']);
  const [busy, error, run] = useAction();
  const [res, setRes] = useState(null);
  const go = (e) => { e.preventDefault(); run('posts', async () => setRes(await api(`/businesses/${b.id}/tools/social-posts`, { method: 'POST', body: { topic, tone, platforms: picked } }))); };
  const toggle = (id) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));
  return (
    <div className="space-y-4">
      <Card title="Draft posts for your networks" subtitle="One draft per network, within its length limit. Nothing is posted: copy a draft and publish it yourself">
        <form onSubmit={go} className="grid gap-3">
          <Field label="What is the post about?"><textarea className={areaCls} rows={2} value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Free dental check-up camp this Saturday in Pimpri" /></Field>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex flex-wrap gap-3">{PLATFORMS.map(([id, l]) => <label key={id} className="inline-flex items-center gap-1.5 text-13 text-slate-700 cursor-pointer"><input type="checkbox" checked={picked.includes(id)} onChange={() => toggle(id)} />{l}</label>)}</div>
            <Select className={sel} value={tone} onChange={e => setTone(e.target.value)} aria-label="Tone">{['friendly', 'professional', 'playful', 'urgent'].map(t => <option key={t}>{t}</option>)}</Select>
            <Button type="submit" variant="primary" icon={Sparkles} busy={busy === 'posts'} disabled={topic.trim().length < 3 || !picked.length}>Write posts</Button>
          </div>
        </form>
        <ErrorNote>{error}</ErrorNote>
      </Card>
      {res && <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 items-start">{res.posts.map(p => (
        <Card key={p.platform} title={PLATFORMS.find(x => x[0] === p.platform)?.[1] || p.platform} action={<CopyBtn text={p.text} />}>
          <p className="text-13 text-slate-800 whitespace-pre-line">{p.text}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-12"><Badge tone={p.trimmed ? 'amber' : 'gray'}>{p.length}/{p.limit} characters{p.trimmed ? ' (trimmed)' : ''}</Badge>{p.call_to_action && <Badge tone="green">CTA: {p.call_to_action}</Badge>}</div>
          {p.image_idea && <p className="mt-2 text-12 text-slate-500"><b>Image idea:</b> {p.image_idea}</p>}
        </Card>))}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Ads plan
function Ads({ b }) {
  const [goal, setGoal] = useState('leads');
  const [budget, setBudget] = useState('');
  const [busy, error, run] = useAction();
  const [res, setRes] = useState(null);
  const go = (e) => { e.preventDefault(); run('ads', async () => setRes(await api(`/businesses/${b.id}/tools/ads-plan`, { method: 'POST', body: { goal, daily_budget: budget ? Number(budget) : null } }))); };
  const p = res?.plan;
  return (
    <div className="space-y-4">
      <Card title="Plan a Google Ads search campaign" subtitle="Ad groups, keywords and responsive search ads for your business, within Google's character limits. Nothing is created or spent: you build it in Google Ads">
        <form onSubmit={go} className="flex flex-wrap items-end gap-3">
          <Field label="Goal"><Select className={sel} value={goal} onChange={e => setGoal(e.target.value)}>{[['leads', 'Leads'], ['calls', 'Phone calls'], ['bookings', 'Bookings'], ['visits', 'Website visits']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field label="Daily budget (optional)"><input className={`${inputCls} w-40`} type="number" min="1" value={budget} onChange={e => setBudget(e.target.value)} placeholder="e.g. 500" /></Field>
          <Button type="submit" variant="primary" icon={Sparkles} busy={busy === 'ads'}>Plan campaign</Button>
        </form>
        <ErrorNote>{error}</ErrorNote>
      </Card>
      {p && (
        <>
          <Card title={p.campaign_name || 'Campaign'} subtitle={p.bidding}>
            {res.dropped_over_limit > 0 && <p className="text-12 text-amber-700 mb-2">{res.dropped_over_limit} headline{res.dropped_over_limit !== 1 ? 's' : ''} or description{res.dropped_over_limit !== 1 ? 's' : ''} were longer than Google allows ({res.limits.headline} and {res.limits.description} characters) and were left out.</p>}
            <p className="text-12 text-slate-500">Built from your tracked keywords: {res.seeded_from.slice(0, 6).join(', ')}{res.seeded_from.length > 6 ? '…' : ''}</p>
          </Card>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
            {(p.ad_groups || []).map((g, i) => (
              <Card key={i} title={g.name} action={<CopyBtn text={[`Ad group: ${g.name}`, 'Keywords:', ...(g.keywords || []).map(k => `${k.match === 'exact' ? '[' : '"'}${k.text}${k.match === 'exact' ? ']' : '"'}`), 'Headlines:', ...g.headlines, 'Descriptions:', ...g.descriptions].join('\n')} label="Copy group" />}>
                <div className="text-12 font-semibold text-slate-500 mb-1">Keywords</div>
                <div className="flex flex-wrap gap-1.5 mb-3">{(g.keywords || []).map((k, j) => <Badge key={j}>{k.match === 'exact' ? `[${k.text}]` : `"${k.text}"`}</Badge>)}</div>
                {g.negative_keywords?.length > 0 && <><div className="text-12 font-semibold text-slate-500 mb-1">Negative keywords</div><div className="flex flex-wrap gap-1.5 mb-3">{g.negative_keywords.map(k => <Badge key={k} tone="red">{k}</Badge>)}</div></>}
                <div className="text-12 font-semibold text-slate-500 mb-1">Headlines ({g.headlines.length}/15)</div>
                <ul className="text-13 text-slate-800 mb-3 space-y-0.5">{g.headlines.map(h => <li key={h} className="flex justify-between gap-3"><span>{h}</span><span className="text-11 text-slate-400 tabular-nums">{h.length}/30</span></li>)}</ul>
                <div className="text-12 font-semibold text-slate-500 mb-1">Descriptions ({g.descriptions.length}/4)</div>
                <ul className="text-13 text-slate-800 space-y-1">{g.descriptions.map(d => <li key={d} className="flex justify-between gap-3"><span>{d}</span><span className="text-11 text-slate-400 tabular-nums">{d.length}/90</span></li>)}</ul>
              </Card>))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card title="Extensions to add"><List items={p.extensions} /></Card>
            <Card title="Before you launch"><List items={p.checklist} /></Card>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Questions / prompt research
function Questions({ b }) {
  const [busy, error, run] = useAction();
  const [res, setRes] = useState(null);
  const [added, setAdded] = useState(() => new Set());
  const [toast, toastNode] = useToast();
  const go = () => run('q', async () => setRes(await api(`/businesses/${b.id}/tools/questions`, { method: 'POST', body: {} })));
  const track = (q) => run(`t${q}`, async () => { await api(`/businesses/${b.id}/geo/prompts`, { method: 'POST', body: { prompt: q } }); setAdded(s => new Set(s).add(q)); toast('Added to AI Search Visibility prompts'); });
  return (
    <div className="space-y-4">
      <Card title="What people ask about your business" subtitle="Questions and related searches Google shows for your tracked keywords. Answer them on your site, and track them as prompts in AI answers"
        action={<Button variant="primary" icon={Sparkles} busy={busy === 'q'} onClick={go}>{res ? 'Search again' : 'Find questions'}</Button>}>
        <p className="text-12.5 text-slate-500">Uses one Google search credit per keyword (up to five keywords).</p>
        <ErrorNote>{error}</ErrorNote>
      </Card>
      {res && (
        <Card title={`${res.items.length} questions and searches`} subtitle={`From: ${res.keywords.join(', ')}`} pad={false}>
          {res.items.length ? (
            <ul className="divide-y divide-slate-100">{res.items.map(i => (
              <li key={i.question} className="px-5 py-3 flex flex-wrap items-center gap-3 text-13">
                <span className="flex-1 min-w-[240px] text-slate-900">{i.question}<span className="block text-11.5 text-slate-400">{i.kind} · for “{i.keyword}”</span></span>
                {added.has(i.question) ? <Badge tone="green"><Check size={11} /> Tracking</Badge> : <Button size="sm" icon={Plus} busy={busy === `t${i.question}`} onClick={() => track(i.question)}>Track in AI answers</Button>}
              </li>))}</ul>
          ) : <Empty>Google showed no questions for these keywords.</Empty>}
        </Card>
      )}
      {toastNode}
    </div>
  );
}

const shell = (title, subtitle, Body) => function ToolPage() { return <SeoShell title={title} subtitle={subtitle}>{(b) => <Body key={b.id} b={b} />}</SeoShell>; };
export const SeoBriefPage = shell('SEO Brief Generator', 'A content brief for any keyword: what ranks, what people ask, and an outline to beat it', Brief);
export const SocialPosterPage = shell('Social Poster', 'Draft posts for each network from one idea, kept inside every network\'s length limit', Social);
export const AdsAssistantPage = shell('Ads Launch Assistant', 'A Google Ads search campaign plan for your business: ad groups, keywords and ads to review and build', Ads);
export const AiQuestionsPage = shell('Prompt Research', 'The questions people ask Google about your business, to answer on your site and track in AI assistants', Questions);

/** A page the layout lists that needs an outside data source: says what it will do, what it needs, and where to go meanwhile. */
export function FeaturePage() {
  const { slug } = useParams();
  const f = FEATURES[slug];
  if (!f) return <Navigate to="/dashboard" replace />;
  return (
    <SeoShell title={f.title} subtitle={f.does} needsBusiness={false}>
      <Card>
        <div className="flex items-start gap-4">
          <span className="w-11 h-11 rounded-full bg-indigo-50 text-indigo-500 flex items-center justify-center shrink-0"><PlugZap size={20} /></span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><h2 className="text-16 font-semibold text-slate-900">Not connected yet</h2><Badge tone="amber">Needs a data source</Badge></div>
            <p className="text-13 text-slate-600 mt-1">{f.does}</p>
            <div className="mt-4 rounded bg-slate-50 px-4 py-3 text-13 text-slate-700"><b className="text-slate-900">What it needs: </b>{f.needs}</div>
            <p className="text-12.5 text-slate-500 mt-3">Nothing is estimated here: a figure appears only when a real source supplies it.</p>
            <Link to={f.alt.to} className="mt-4 h-10 px-4 rounded inline-flex items-center gap-2 text-13 font-semibold bg-indigo-500 text-white hover:bg-indigo-600">Use {f.alt.label} meanwhile <ArrowRight size={14} /></Link>
          </div>
        </div>
      </Card>
    </SeoShell>
  );
}
