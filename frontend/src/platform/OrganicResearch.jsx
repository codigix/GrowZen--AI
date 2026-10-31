import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import {
  Loader2, ArrowUp, ArrowDown, ExternalLink, Search, Inbox, Info, Bot, FileText, BookOpen, HelpCircle, MapPin, Video, Image as ImageIcon, Newspaper, ShoppingCart, Sparkles, AlertTriangle
} from 'lucide-react';
import { SeoShell, Card, Badge, Button, ErrorNote, Tabs, useUrlTab, useModulePath } from './SeoUi';
import { api, useApi, fmt } from './seoApi';
import { IntelBar, section } from './DomainIntel';
import { TrackedPositions, Th } from './SeoToolkit';

/**
 * Organic Rankings, laid out like an organic research report.
 * - Domain-wide figures (keywords, traffic, trend, top keywords, intent, pages, subdomains, competitors): the data provider (GET .../seo/domain-intel).
 * - Position changes and SERP features: the tracked keywords' saved Google rank checks (GET .../seo/organic-research).
 * Each card says which of the two it reads, and never fills a gap with an estimate.
 */

const AXIS = { fontSize: 11, fill: '#64748b' };
const BUCKETS = [['top3', 'Top 3', '#f59e0b'], ['p4_10', '4-10', '#4338ca'], ['p11_20', '11-20', '#6366f1'], ['p21_50', '21-50', '#a5b4fc'], ['p51_100', '51-100', '#c7d2fe']];
const INTENT = { informational: ['Informational', '#6658dd'], navigational: ['Navigational', '#a855f7'], commercial: ['Commercial', '#f59e0b'], transactional: ['Transactional', '#1abc9c'], unknown: ['Unclassified', '#94a3b8'] };
const FEATURE_ICON = { 'Featured snippet': FileText, 'Knowledge panel': BookOpen, 'People also ask': HelpCircle, 'Local pack': MapPin, Videos: Video, Images: ImageIcon, 'Top stories': Newspaper, Shopping: ShoppingCart, 'Related searches': Search };
const FEATURE_COLORS = ['#6658dd', '#1abc9c', '#f59e0b', '#ef4444', '#0ea5e9', '#a855f7', '#84cc16', '#ec4899', '#64748b'];
const live = (research) => (research?.state === 'ok' ? research : null);
const NO_FEATURES = 'Your Google results source returned only the organic list for these searches, so SERP features (people also ask, snippets, video, local pack…) are not available. The Search Console API does not report them.';
const FromTracked = ({ children }) => <p className="text-11.5 text-slate-400 mt-2 px-1">{children}</p>;
const path = (u) => { try { const x = new URL(u); return x.pathname + x.search || '/'; } catch (e) { return u || '—'; } };
const money = (n) => (n == null ? '—' : `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const compact = (n) => (n == null ? '—' : n >= 100 ? fmt(Math.round(n)) : String(Math.round(n * 10) / 10));

function Pct({ v }) {
  if (v == null) return null;
  if (!v) return <span className="text-11.5 text-slate-400">0%</span>;
  return <span className={`inline-flex items-center gap-0.5 text-11.5 font-semibold ${v > 0 ? 'text-emerald-600' : 'text-red-500'}`}>{v > 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}{Math.abs(v).toLocaleString()}%</span>;
}

function Empty({ children, icon: Icon = Inbox }) {
  return <div className="py-10 flex flex-col items-center text-center gap-2 text-13 text-slate-500"><Icon size={22} className="text-slate-300" /><span className="max-w-sm">{children}</span></div>;
}

/** Why a section has no data: provider not connected, a failed call, or an honest "nothing found". */
const whyIntel = (intel, s, noun) => (intel?.state === 'not_connected' || intel?.state === 'no_property' ? 'Connect Search Console (see the note at the top).' : intel?.state === 'no_website' ? 'Needs a real website address.' : intel?.state === 'needs_approval' ? 'Approve this client first.'
  : !intel ? 'Loading…' : s.why ? s.why : `No ${noun} found for this domain in ${intel.country_name}.`);

function Spark({ values, color = '#6658dd', h = 34 }) {
  const data = (values || []).map((v, i) => ({ i, v })).filter(x => x.v != null);
  if (data.length < 2) return <div style={{ height: h }} />;
  return (
    <div style={{ height: h }}><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
      <defs><linearGradient id={`os-${color.slice(1)}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.35} /><stop offset="100%" stopColor={color} stopOpacity={0.02} /></linearGradient></defs>
      <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.8} fill={`url(#os-${color.slice(1)})`} dot={false} isAnimationActive={false} />
    </AreaChart></ResponsiveContainer></div>
  );
}

function Stat({ label, hint, value, change, spark, tone = 'text-indigo-700' }) {
  return (
    <div className="px-5 py-4 min-w-0" title={hint}>
      <div className="text-12.5 font-semibold text-slate-600 flex items-center gap-1">{label}<Info size={11} className="text-slate-300" /></div>
      <div className="flex items-baseline gap-2 flex-wrap"><span className={`text-26 font-bold tabular-nums ${value == null ? 'text-slate-300' : tone}`}>{value ?? '—'}</span><Pct v={change} /></div>
      {spark ? <Spark values={spark} /> : <div className="h-[34px]" />}
    </div>
  );
}

/* ── Overview sections ─────────────────────────────────────────────────── */

function Headline({ intel, research }) {
  const o = section(intel, 'organic');
  const h = section(intel, 'history').data || [];
  const d = o.data;
  const r = live(research);
  if (!d && r) {
    const t = r.tracked_summary;
    return (
      <Card pad={false}>
        <div className="grid grid-cols-2 xl:grid-cols-5 divide-x divide-slate-100">
          <Stat label="Tracked keywords" hint="Keywords you track. Each one is checked on Google and its top 10 results are saved." value={fmt(t.keywords)} tone="text-slate-900" />
          <Stat label="Ranking in top 10" hint="Tracked keywords where your site is in Google's top 10." value={`${t.top10} / ${t.keywords}`} spark={r.distribution.map(x => x.top10)} />
          <Stat label="Visibility" hint="Share of the clicks your tracked keywords could win, from the position of each (a standard click-through curve)." value={`${t.visibility}%`} spark={r.distribution.map(x => x.visibility)} />
          <Stat label="Average position" hint="Average of the positions where your site ranks in the top 10." value={t.avg_position ?? 'Not ranking'} tone="text-slate-900" />
          <Stat label="Competing domains" hint="Different domains seen in the top 10 results of your tracked keywords." value={fmt(t.domains)} tone="text-slate-900" />
        </div>
        <FromTracked>Real Google results for your tracked keywords ({t.checks} check{t.checks !== 1 ? 's' : ''}). Domain-wide keywords, traffic and traffic cost need Google Search Console connected.</FromTracked>
      </Card>
    );
  }
  const none = !d;
  return (
    <Card pad={false}>
      <div className="grid grid-cols-2 xl:grid-cols-5 divide-x divide-slate-100">
        <Stat label="Keywords" hint="Keywords the domain ranks for in Google's top 100 in this market (estimated by the data provider)." value={none ? null : fmt(d.keywords)} change={d?.keywords_change} spark={h.map(x => x.keywords)} />
        <Stat label="Traffic" hint="Estimated monthly organic visits from those keywords." value={none ? null : compact(d.traffic)} change={d?.traffic_change} spark={h.map(x => x.traffic)} />
        <Stat label="Traffic cost" hint="What the same traffic would cost to buy through Google Ads (estimated, USD per month)." value={none ? null : money(d.traffic_cost)} tone="text-slate-900" />
        <Stat label="Branded traffic" hint={d?.branded == null ? 'Needs the keyword list.' : `Traffic from keywords that contain the brand, measured on the top ${d.sample} keywords.`} value={d?.branded == null ? null : compact(d.branded)} tone="text-slate-900" />
        <Stat label="Non-branded traffic" hint="All other organic traffic." value={d?.non_branded == null ? null : compact(d.non_branded)} />
      </div>
      {none && <p className="px-5 pb-4 text-12.5 text-slate-500 -mt-1">{whyIntel(intel, o, 'organic data')}</p>}
    </Card>
  );
}

function KeywordsTrend({ intel, research }) {
  const s = section(intel, 'history');
  const [range, setRange] = useState(24);
  const [off, setOff] = useState({});
  const r = live(research);
  const fallback = !(s.data || []).length && r;
  const rows = fallback ? r.distribution.map(x => ({ ...x, date: x.date.slice(5) })) : (s.data || []).slice(-range);
  const buckets = fallback ? [['top3', 'Top 3', '#f59e0b'], ['p4_10', '4-10', '#4338ca'], ['out', 'Not in top 10', '#cbd5e1']] : BUCKETS;
  return (
    <Card title={fallback ? 'Tracked keywords by position' : 'Organic keywords trend'} subtitle={fallback ? 'Your tracked keywords on every saved Google check (the chart grows with each check)' : 'Keywords by position, month by month (estimated by the data provider)'}
      action={!fallback && <div className="flex gap-0.5 p-0.5 bg-slate-100 rounded">{[[6, '6M'], [12, '1Y'], [24, '2Y'], [999, 'All time']].map(([n, l]) => <button key={n} type="button" onClick={() => setRange(n)} className={`h-7 px-2.5 text-12 font-semibold rounded cursor-pointer ${range === n ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>{l}</button>)}</div>}>
      {rows.length ? (
        <>
          <div className="flex flex-wrap gap-4 mb-2 text-12.5">{buckets.map(([k, l, c]) => <label key={k} className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700"><input type="checkbox" checked={!off[k]} onChange={e => setOff(o => ({ ...o, [k]: !e.target.checked }))} style={{ accentColor: c }} />{l}</label>)}</div>
          <div className="h-64"><ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" vertical={false} />
              <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
              <Tooltip />
              {buckets.filter(([k]) => !off[k]).map(([k, l, c]) => <Bar key={k} dataKey={k} name={l} stackId="k" fill={c} />)}
            </BarChart>
          </ResponsiveContainer></div>
        </>
      ) : <Empty>{whyIntel(intel, s, 'keyword history')}</Empty>}
    </Card>
  );
}

function TopKeywords({ intel, research, onAll }) {
  const s = section(intel, 'keywords');
  const [tab, setTab] = useState('all');
  const total = section(intel, 'organic').data?.traffic || 0;
  const terms = (intel?.brand || []).map(t => t.toLowerCase());
  const all = s.data?.rows || [];
  const r = live(research);
  const chip = (id, l) => <button key={id} type="button" onClick={() => setTab(id)} className={`h-7 px-3 text-12 font-semibold rounded border cursor-pointer ${tab === id ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 bg-white'}`}>{l}</button>;
  if (!all.length && r) {
    const rows = [...r.tracked_rows].sort((a, c) => (a.rank || 99) - (c.rank || 99) || a.keyword.localeCompare(c.keyword));
    return (
      <Card title="Your tracked keywords" subtitle="Where your site stands on Google, and who is first" pad={false}>
        <table className="w-full text-13">
          <thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>Keyword</Th><Th c="text-right">Position</Th><Th>Ranks first</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.slice(0, 6).map(x => (
              <tr key={x.keyword} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 max-w-[250px] truncate text-indigo-700 font-medium" title={x.keyword}>{x.keyword}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{x.rank ?? <span className="text-slate-400" title="Not in Google's top 10">&gt;10</span>}</td>
                <td className="px-4 py-2.5 text-slate-600 max-w-[170px] truncate" title={x.leader}>{x.leader || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="p-4"><Button size="sm" onClick={onAll}>View all {rows.length} keywords</Button></div>
      </Card>
    );
  }
  const rows = (tab === 'top10' ? all.filter(x => x.position && x.position <= 10) : tab === 'branded' ? all.filter(x => terms.some(t => x.keyword.toLowerCase().includes(t))) : all);
  return (
    <Card title="Top keywords" pad={false}>
      <div className="px-5 py-3 flex gap-2 border-b border-slate-100">{chip('all', 'All positions')}{chip('top10', 'Top 10')}{chip('branded', 'Branded')}</div>
      {all.length ? (
        <>
          <table className="w-full text-13">
            <thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>Keyword</Th><Th c="text-right">Position</Th><Th c="text-right">Volume</Th><Th c="text-right">Traffic %</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.slice(0, 5).map(x => (
                <tr key={x.keyword + x.position} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 max-w-[260px] truncate text-indigo-700 font-medium" title={x.keyword}>{x.keyword}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{x.position ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{x.volume != null ? fmt(x.volume) : '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{total ? (x.traffic / total * 100).toFixed(2) : '—'}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={4} className="px-5 py-8 text-center text-slate-500">No keyword in this view.</td></tr>}
            </tbody>
          </table>
          <div className="p-4"><Button size="sm" onClick={onAll}>View all {fmt(s.data.total)} keywords</Button></div>
        </>
      ) : <Empty>{whyIntel(intel, s, 'organic keywords')}</Empty>}
    </Card>
  );
}

function Intent({ intel, research }) {
  const s = section(intel, 'keywords');
  const r = live(research);
  const fallback = !(s.data?.intents || []).length && r;
  const list = fallback ? r.intents.map(i => ({ intent: i.intent, keywords: i.keywords, traffic: 0 })) : s.data?.intents || [];
  const kTotal = list.reduce((a, i) => a + i.keywords, 0) || 1;
  const tTotal = list.reduce((a, i) => a + i.traffic, 0);
  const meta = (k) => INTENT[k] || [k === 'unknown' ? 'Unclassified' : k.charAt(0).toUpperCase() + k.slice(1), '#94a3b8'];
  return (
    <Card title="Keywords by intent" subtitle={fallback ? 'Your tracked keywords, classified from their wording' : s.data ? `The top ${s.data.rows.length} keywords by traffic` : undefined} pad={false}>
      {list.length ? (
        <div className="p-5">
          <div className="flex h-3 rounded-full overflow-hidden bg-slate-100 mb-4">{list.map(i => <span key={i.intent} style={{ width: `${(i.keywords / kTotal) * 100}%`, background: meta(i.intent)[1] }} />)}</div>
          <table className="w-full text-13">
            <thead className="text-11.5 text-slate-500"><tr><Th>Intent</Th><Th c="text-right">Keywords</Th>{!fallback && <Th c="text-right">Traffic</Th>}</tr></thead>
            <tbody className="divide-y divide-slate-100">{list.map(i => (
              <tr key={i.intent}><td className="px-4 py-2"><span className="inline-block w-2.5 h-2.5 rounded-full mr-2" style={{ background: meta(i.intent)[1] }} />{meta(i.intent)[0]}</td>
                <td className="px-4 py-2 text-right tabular-nums text-indigo-700">{i.keywords} <span className="text-slate-400">({Math.round((i.keywords / kTotal) * 1000) / 10}%)</span></td>
                {!fallback && <td className="px-4 py-2 text-right tabular-nums">{tTotal ? `${Math.round((i.traffic / tTotal) * 100)}%` : '—'}</td>}</tr>))}</tbody>
          </table>
        </div>
      ) : <Empty>{whyIntel(intel, s, 'keywords')}</Empty>}
    </Card>
  );
}

/** New / lost / improved / declined, from the tracked keywords' saved checks. */
function Changes({ research, kinds, title, limit = 6, render, noun = 'tracked keywords' }) {
  const [tab, setTab] = useState(kinds[0][0]);
  const rows = research?.state === 'ok' ? research.changes?.[tab] || [] : [];
  const none = research?.state !== 'ok';
  return (
    <Card title={title} subtitle={`From your ${noun}: the first check against the latest in the period`} pad={false}>
      <div className="px-5 py-3 flex gap-1.5 border-b border-slate-100">{kinds.map(([id, l]) => <button key={id} type="button" onClick={() => setTab(id)} className={`h-7 px-3 text-12 font-semibold rounded border cursor-pointer ${tab === id ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 bg-white'}`}>{l}{research?.counts ? <span className="ml-1 opacity-60">{research.counts[id] ?? ''}</span> : null}</button>)}</div>
      {none ? <Empty>{researchWhy(research)}</Empty> : rows.length ? (
        <table className="w-full text-13">
          <thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>Keyword</Th><Th c="text-right">Was</Th><Th c="text-right">Now</Th><Th c="text-right">Volume</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.slice(0, limit).map(r => render ? render(r) : (
            <tr key={r.keyword} className="hover:bg-slate-50"><td className="px-4 py-2.5 text-indigo-700 font-medium max-w-[260px] truncate" title={r.keyword}>{r.keyword}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{r.was ?? '—'}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{r.rank ?? '—'} <span className={`text-11.5 font-semibold ${r.change > 0 ? 'text-emerald-600' : 'text-red-500'}`}>{r.change > 0 ? '↑' : '↓'}{Math.abs(r.change)}</span></td>
              <td className="px-4 py-2.5 text-right tabular-nums">{r.volume != null ? fmt(r.volume) : '—'}</td></tr>))}</tbody>
        </table>
      ) : <Empty>Nothing found. {research.comparable ? 'No tracked keyword changed in this way in this period.' : 'Changes appear after a second position check.'}</Empty>}
      {rows.length > limit && <p className="px-4 py-3 text-12 text-slate-400">Showing {limit} of {rows.length}.</p>}
    </Card>
  );
}

function researchWhy(r) {
  if (!r) return 'Loading…';
  return { no_website: 'Add the business website first: positions are matched by its domain.', no_keywords: 'No keyword is tracked yet. Add keywords in the Positions tab or the Keyword Magic Tool.',
    no_data: r.serper ? 'No position has been checked in this period. Press “Check positions now” in the Positions tab.' : 'No position has been checked yet, and Google results are not connected (SERPER_API_KEY).' }[r.state] || 'Not available.';
}

function FeatureChanges({ research, limit = 6 }) {
  const f = research?.state === 'ok' ? research.features : null;
  if (f && !research.features_reported) return <Card title="Top position changes in SERP features"><Empty>{NO_FEATURES}</Empty></Card>;
  const [tab, setTab] = useState('new');
  const rows = f ? f.changes[tab] : [];
  return (
    <Card title="Top position changes in SERP features" subtitle="Features that appeared on, or left, the results of your tracked keywords" pad={false}>
      <div className="px-5 py-3 flex gap-1.5 border-b border-slate-100">{[['new', 'New'], ['lost', 'Lost']].map(([id, l]) => <button key={id} type="button" onClick={() => setTab(id)} className={`h-7 px-3 text-12 font-semibold rounded border cursor-pointer ${tab === id ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 bg-white'}`}>{l}{f ? <span className="ml-1 opacity-60">{f.changes[id].length}</span> : null}</button>)}</div>
      {!f ? <Empty>{researchWhy(research)}</Empty> : rows.length ? (
        <table className="w-full text-13"><thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>Keyword</Th><Th>Feature</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.slice(0, limit).map(r => <tr key={r.keyword + r.feature}><td className="px-4 py-2.5 text-indigo-700 font-medium max-w-[260px] truncate">{r.keyword}</td><td className="px-4 py-2.5">{r.feature}</td></tr>)}</tbody></table>
      ) : <Empty>Nothing found. {research.comparable ? 'No SERP feature appeared or left in this period.' : 'Changes appear after a second position check.'}</Empty>}
    </Card>
  );
}

function AiBrand({ ai }) {
  return (
    <div className="rounded bg-violet-50 ring-1 ring-inset ring-violet-200 px-5 py-4">
      <div className="flex items-center gap-2 text-14 font-semibold text-violet-900 mb-3"><Sparkles size={15} className="text-violet-500" />Brand presence in AI platforms</div>
      {ai?.measured ? (
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 text-13">
          <div><div className="text-12 text-slate-500">AI visibility</div><div className="text-22 font-bold text-violet-700 tabular-nums">{ai.visibility}%</div></div>
          <div><div className="text-12 text-slate-500">Mentions</div><div className="text-22 font-bold text-violet-700 tabular-nums">{ai.mentions}</div></div>
          <div><div className="text-12 text-slate-500">Cited pages</div><div className="text-22 font-bold text-violet-700 tabular-nums">{ai.cited_pages}</div></div>
          <div className="flex flex-wrap gap-1.5 items-center"><span className="text-12 text-slate-500 mr-1">By engine</span>{ai.engines.slice(0, 4).map(e => <Badge key={e.engine} tone="violet"><Bot size={11} />{e.engine} {e.visibility}%</Badge>)}</div>
          <Link to="/geo-optimization" className="ml-auto h-8 px-3 rounded inline-flex items-center text-12.5 font-semibold bg-violet-600 text-white hover:bg-violet-700">Open AI tracker</Link>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 text-13 text-violet-900"><span className="flex-1 min-w-[240px]">{ai ? `AI visibility has not been measured yet (${ai.prompts} prompts saved).` : 'Loading…'}</span><Link to="/geo-optimization" className="h-8 px-3 rounded inline-flex items-center text-12.5 font-semibold bg-violet-600 text-white hover:bg-violet-700">Run the AI check</Link></div>
      )}
    </div>
  );
}

function FeatureTrend({ research, days, setDays }) {
  const f = research?.state === 'ok' ? research.features : null;
  if (f && !research.features_reported) return <Card title="SERP features trend"><Empty>{NO_FEATURES}</Empty></Card>;
  const present = f ? f.names.filter(n => f.trend[n].some(v => v > 0)) : [];
  const [sel, setSel] = useState(null);
  const chosen = (sel || present.slice(0, 3)).filter(n => present.includes(n));
  const data = f ? f.dates.map((d, i) => ({ label: d.slice(5), ...Object.fromEntries(chosen.map(n => [n, f.trend[n][i]])) })) : [];
  return (
    <Card title="SERP features trend" subtitle="How many tracked keywords show each feature, per check"
      action={<div className="flex gap-0.5 p-0.5 bg-slate-100 rounded">{[[30, '1M'], [60, '2M'], [90, '3M']].map(([n, l]) => <button key={n} type="button" onClick={() => setDays(n)} className={`h-7 px-2.5 text-12 font-semibold rounded cursor-pointer ${days === n ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>{l}</button>)}</div>}>
      {f && present.length ? (
        <>
          <div className="flex flex-wrap gap-3 mb-2 text-12.5">{present.map((n, i) => <label key={n} className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700"><input type="checkbox" checked={chosen.includes(n)} onChange={e => setSel(e.target.checked ? [...chosen, n] : chosen.filter(x => x !== n))} style={{ accentColor: FEATURE_COLORS[f.names.indexOf(n) % FEATURE_COLORS.length] }} />{n}</label>)}</div>
          <div className="h-60"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" vertical={false} /><XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={20} /><YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={36} /><Tooltip />
            {chosen.map(n => <Bar key={n} dataKey={n} fill={FEATURE_COLORS[f.names.indexOf(n) % FEATURE_COLORS.length]} />)}
          </BarChart></ResponsiveContainer></div>
        </>
      ) : <Empty>{f ? 'No SERP feature was recorded on the checks in this period.' : researchWhy(research)}</Empty>}
    </Card>
  );
}

function FeatureGrid({ research }) {
  const f = research?.state === 'ok' ? research.features : null;
  if (f && !research.features_reported) return <Card title="SERP features"><Empty>{NO_FEATURES}</Empty></Card>;
  const group = (title, rows) => (
    <div>
      <div className="text-13 font-semibold text-slate-800 mb-2">{title}</div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-x-4 gap-y-3">
        {rows.map(r => { const I = FEATURE_ICON[r.feature] || Sparkles; const on = r.keywords > 0; return (
          <div key={r.feature} className={`flex items-center gap-2.5 ${on ? '' : 'opacity-40'}`}>
            <span className={`w-7 h-7 rounded flex items-center justify-center shrink-0 ${on ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-400'}`}><I size={14} /></span>
            <div className="min-w-0 leading-tight"><div className="text-12.5 font-medium text-slate-800 truncate">{r.feature}</div><div className="text-11.5 text-slate-500">{r.keywords} keyword{r.keywords !== 1 ? 's' : ''}</div></div>
          </div>); })}
      </div>
    </div>
  );
  return (
    <Card title="SERP features" subtitle="On the latest check of each tracked keyword">
      {f ? <div className="space-y-6">{group('Linking to domain', f.linking)}{group('Not linking to domain', f.not_linking)}</div> : <Empty>{researchWhy(research)}</Empty>}
    </Card>
  );
}

function PagesCard({ intel, research, onAll }) {
  const s = section(intel, 'pages');
  const rows = s.data || [];
  const total = rows.reduce((a, p) => a + p.traffic, 0) || 1;
  const r = live(research);
  if (!rows.length && r) {
    const own = r.own_pages.top;
    return (
      <Card title="Your pages in Google's top 10" subtitle="Pages of your site that rank for a tracked keyword" pad={false}>
        {own.length ? (
          <table className="w-full text-13"><thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>URL</Th><Th c="text-right">Keywords</Th><Th c="text-right">Avg. position</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">{own.slice(0, 5).map(p => <tr key={p.url} className="hover:bg-slate-50"><td className="px-4 py-2.5 max-w-[320px] truncate"><a href={p.url} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline inline-flex items-center gap-1" title={p.url}>{path(p.url)}<ExternalLink size={10} /></a></td><td className="px-4 py-2.5 text-right tabular-nums">{p.keywords}</td><td className="px-4 py-2.5 text-right tabular-nums">{p.avg_position}</td></tr>)}</tbody></table>
        ) : <Empty>None of your pages is in Google&apos;s top 10 for a tracked keyword yet. Pages appear here as soon as one ranks.</Empty>}
      </Card>
    );
  }
  return (
    <Card title="Top pages" pad={false}>
      {rows.length ? (
        <>
          <table className="w-full text-13"><thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>URL</Th><Th c="text-right">Traffic %</Th><Th c="text-right">Keywords</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">{rows.slice(0, 5).map(p => <tr key={p.url} className="hover:bg-slate-50"><td className="px-4 py-2.5 max-w-[320px] truncate"><a href={p.url} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline inline-flex items-center gap-1" title={p.url}>{path(p.url)}<ExternalLink size={10} /></a></td><td className="px-4 py-2.5 text-right tabular-nums">{p.traffic / total < 0.0001 ? '< 0.01' : (p.traffic / total * 100).toFixed(2)}</td><td className="px-4 py-2.5 text-right tabular-nums">{p.keywords}</td></tr>)}</tbody></table>
          <div className="p-4"><Button size="sm" onClick={onAll}>View all {rows.length} pages</Button></div>
        </>
      ) : <Empty>{whyIntel(intel, s, 'pages')}</Empty>}
    </Card>
  );
}

function SubdomainsCard({ intel, research, full }) {
  const s = section(intel, 'subdomains');
  const rows = s.data || [];
  const r = live(research);
  if (!rows.length && r) {
    return (
      <Card title="Your subdomains in Google's top 10" pad={false}>
        {r.own_hosts.length ? (
          <table className="w-full text-13"><thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>Subdomain</Th><Th c="text-right">Ranking keywords</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">{r.own_hosts.map(h => <tr key={h.subdomain}><td className="px-4 py-2.5 text-indigo-700">{h.subdomain}</td><td className="px-4 py-2.5 text-right tabular-nums">{h.keywords}</td></tr>)}</tbody></table>
        ) : <Empty>No subdomain of your site is in Google&apos;s top 10 for a tracked keyword yet.</Empty>}
      </Card>
    );
  }
  return (
    <Card title="Top subdomains" pad={false}>
      {rows.length ? (
        <table className="w-full text-13"><thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>Subdomain</Th><Th c="text-right">Traffic %</Th><Th c="text-right">Keywords</Th>{full && <Th c="text-right">Traffic</Th>}</tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map(x => <tr key={x.subdomain} className="hover:bg-slate-50"><td className="px-4 py-2.5"><a href={`https://${x.subdomain}`} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline inline-flex items-center gap-1">{x.subdomain}<ExternalLink size={10} /></a></td><td className="px-4 py-2.5 text-right tabular-nums">{x.share.toFixed(2)}</td><td className="px-4 py-2.5 text-right tabular-nums">{fmt(x.keywords)}</td>{full && <td className="px-4 py-2.5 text-right tabular-nums">{compact(x.traffic)}</td>}</tr>)}</tbody></table>
      ) : <Empty>{whyIntel(intel, s, 'subdomains')}</Empty>}
    </Card>
  );
}

/* ── Tabs ──────────────────────────────────────────────────────────────── */

function Overview({ intel, research, ai, days, setDays, go }) {
  return (
    <div className="space-y-4">
      <Headline intel={intel} research={research} />
      <KeywordsTrend intel={intel} research={research} />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start"><TopKeywords intel={intel} research={research} onAll={() => go('positions')} /><Intent intel={intel} research={research} /></div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <Changes research={research} title="Top position changes in organic" kinds={[['new', 'New'], ['lost', 'Lost'], ['improved', 'Improved'], ['declined', 'Declined']]} />
        <FeatureChanges research={research} />
      </div>
      <AiBrand ai={ai} />
      <FeatureTrend research={research} days={days} setDays={setDays} />
      <FeatureGrid research={research} />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start"><PagesCard intel={intel} research={research} onAll={() => go('pages')} /><SubdomainsCard intel={intel} research={research} /></div>
    </div>
  );
}

function Positions({ b, intel }) {
  const s = section(intel, 'keywords');
  const [q, setQ] = useState('');
  const [intent, setIntent] = useState('');
  const total = section(intel, 'organic').data?.traffic || 0;
  const rows = (s.data?.rows || []).filter(r => (!q || r.keyword.toLowerCase().includes(q.toLowerCase())) && (!intent || r.intent === intent));
  return (
    <div className="space-y-4">
      <TrackedPositions b={b} />
      <Card title={`Organic keywords ${s.data ? `(${fmt(s.data.total)})` : ''}`} subtitle="Every keyword the domain ranks for, from the data provider (the highest-traffic ones are listed)" pad={false}
        action={<div className="flex gap-2"><select value={intent} onChange={e => setIntent(e.target.value)} className="h-8 px-2 text-12.5 rounded border border-slate-200 bg-white cursor-pointer" aria-label="Intent"><option value="">All intents</option>{Object.entries(INTENT).filter(([k]) => k !== 'unknown').map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
          <label className="relative"><Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter" className="h-8 pl-8 pr-3 text-13 rounded border border-slate-200 bg-white outline-none focus:border-indigo-400" /></label></div>}>
        {s.data?.rows?.length ? (
          <div className="overflow-auto max-h-[520px]"><table className="w-full text-13">
            <thead className="sticky top-0 bg-slate-50 text-11.5 text-slate-500"><tr><Th>Keyword</Th><Th>Intent</Th><Th c="text-right">Position</Th><Th c="text-right">Volume</Th><Th c="text-right">CPC (USD)</Th><Th c="text-right">Traffic %</Th><Th>Page</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">{rows.map(r => (
              <tr key={r.keyword + r.position} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 font-medium text-indigo-700 max-w-[260px] truncate" title={r.keyword}>{r.keyword}</td>
                <td className="px-4 py-2.5"><Badge tone="gray">{(INTENT[r.intent] || INTENT.unknown)[0]}</Badge></td>
                <td className="px-4 py-2.5 text-right tabular-nums">{r.position ?? '—'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{r.volume != null ? fmt(r.volume) : '—'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{r.cpc != null ? r.cpc.toFixed(2) : '—'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{total ? (r.traffic / total * 100).toFixed(2) : '—'}</td>
                <td className="px-4 py-2.5 max-w-[220px] truncate text-slate-500" title={r.url}>{path(r.url)}</td>
              </tr>))}
              {!rows.length && <tr><td colSpan={7} className="px-5 py-8 text-center text-slate-500">No keyword matches.</td></tr>}
            </tbody></table></div>
        ) : <Empty>{whyIntel(intel, s, 'organic keywords')}</Empty>}
      </Card>
    </div>
  );
}

function ChangesTab({ research }) {
  return (
    <div className="space-y-4">
      <Changes research={research} title="Position changes in organic" kinds={[['new', 'New'], ['lost', 'Lost'], ['improved', 'Improved'], ['declined', 'Declined']]} limit={50} />
      <FeatureChanges research={research} limit={50} />
    </div>
  );
}

function Competitors({ intel, research }) {
  const s = section(intel, 'competitors');
  const rows = s.data || [];
  const max = Math.max(1, ...rows.map(r => r.common));
  const path_ = useModulePath();
  const r = live(research);
  const links = (
    <div className="flex gap-2"><Link to={path_('keyword-gap')} className="h-8 px-3 rounded inline-flex items-center text-12.5 font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50">Keyword gap</Link><Link to={path_('compare-domains')} className="h-8 px-3 rounded inline-flex items-center text-12.5 font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50">Compare domains</Link></div>
  );
  if (!rows.length && r) {
    return (
      <Card title={`Domains in the results (${r.competitor_total})`} subtitle="Who appears in Google's top 10 for your tracked keywords, from your saved checks" pad={false} action={links}>
        <table className="w-full text-13"><thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>#</Th><Th>Domain</Th><Th c="text-right">Keywords</Th><Th c="text-right">Avg. position</Th><Th c="text-right">Visibility</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">{r.competitors.map(c => (
            <tr key={c.domain} className={c.you ? 'bg-indigo-50/50' : 'hover:bg-slate-50'}>
              <td className="px-4 py-2.5 text-slate-500 tabular-nums">{c.rank}</td>
              <td className="px-4 py-2.5"><a href={`https://${c.domain}`} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline inline-flex items-center gap-1">{c.domain}<ExternalLink size={10} /></a>{c.you && <span className="ml-2 text-11 text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">You</span>}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{c.keywords}</td><td className="px-4 py-2.5 text-right tabular-nums">{c.avg_position}</td><td className="px-4 py-2.5 text-right tabular-nums">{c.visibility}%</td>
            </tr>))}</tbody></table>
        {!r.competitors.some(c => c.you) && <p className="px-4 py-3 text-12 text-slate-500 border-t border-slate-100">Your site is not in the top 10 for any tracked keyword yet, so it is not listed.</p>}
      </Card>
    );
  }
  return (
    <Card title={`Main organic competitors ${rows.length ? `(${rows.length})` : ''}`} subtitle="Domains that rank for the same keywords (data provider)" pad={false} action={links}>
      {rows.length ? (
        <table className="w-full text-13"><thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>Competitor</Th><Th>Com. level</Th><Th c="text-right">Common keywords</Th><Th c="text-right">Organic keywords</Th><Th c="text-right">Traffic</Th><Th c="text-right">Avg. position</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map(x => <tr key={x.domain} className="hover:bg-slate-50"><td className="px-4 py-2.5"><a href={`https://${x.domain}`} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline inline-flex items-center gap-1">{x.domain}<ExternalLink size={10} /></a></td>
            <td className="px-4 py-2.5 w-32"><span className="block h-1.5 rounded-full bg-slate-100 overflow-hidden"><span className="block h-full bg-indigo-400" style={{ width: `${(x.common / max) * 100}%` }} /></span></td>
            <td className="px-4 py-2.5 text-right tabular-nums">{fmt(x.common)}</td><td className="px-4 py-2.5 text-right tabular-nums text-indigo-700">{fmt(x.keywords)}</td><td className="px-4 py-2.5 text-right tabular-nums">{compact(x.traffic)}</td><td className="px-4 py-2.5 text-right tabular-nums">{x.avg_position ?? '—'}</td></tr>)}</tbody></table>
      ) : <Empty>{whyIntel(intel, s, 'competitors')}</Empty>}
    </Card>
  );
}

function Topics({ b }) {
  const kw = useApi(`/businesses/${b.id}/keywords`);
  if (!kw.data) return kw.error ? <ErrorNote>{kw.error.message}</ErrorNote> : <div className="py-12 flex justify-center text-slate-400"><Loader2 size={18} className="animate-spin" /></div>;
  const tracked = kw.data.keywords.filter(k => k.tracked);
  const rows = kw.data.clusters.map(c => {
    const ks = tracked.filter(k => (k.cluster || 'Not grouped') === c.name);
    const ranked = ks.filter(k => k.rank);
    return { ...c, tracked: ks.length, ranking: ranked.length, avg: ranked.length ? Math.round(ranked.reduce((a, k) => a + k.rank, 0) / ranked.length * 10) / 10 : null };
  });
  return (
    <Card title={`Topics (${rows.length})`} subtitle="Your keywords grouped by topic (cluster), with how they rank" pad={false}>
      {rows.length ? (
        <table className="w-full text-13"><thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>Topic</Th><Th c="text-right">Keywords</Th><Th c="text-right">Tracked</Th><Th c="text-right">Ranking</Th><Th c="text-right">Avg. position</Th><Th c="text-right">Volume</Th><Th c="text-right">Pages mapped</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map(r => <tr key={r.name} className="hover:bg-slate-50"><td className="px-4 py-2.5 font-medium text-slate-900">{r.name}</td><td className="px-4 py-2.5 text-right tabular-nums">{r.keywords}</td><td className="px-4 py-2.5 text-right tabular-nums">{r.tracked}</td><td className="px-4 py-2.5 text-right tabular-nums text-indigo-700">{r.ranking}</td><td className="px-4 py-2.5 text-right tabular-nums">{r.avg ?? '—'}</td><td className="px-4 py-2.5 text-right tabular-nums">{r.volume ? fmt(r.volume) : '—'}</td><td className="px-4 py-2.5 text-right tabular-nums">{r.mapped}</td></tr>)}</tbody></table>
      ) : <Empty>No keywords yet. Add some in the Keyword Magic Tool; group them in the Keyword Strategy Builder to see topics here.</Empty>}
    </Card>
  );
}

function PagesTab({ intel, research }) {
  const s = section(intel, 'pages');
  const rows = s.data || [];
  const r = live(research);
  if (!rows.length && r) {
    const own = [...r.own_pages.top];
    return (
      <Card title={`Your ranking pages (${own.length})`} subtitle="Pages of your site in Google's top 10 for a tracked keyword (saved checks)" pad={false}>
        {own.length ? (
          <table className="w-full text-13"><thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>URL</Th><Th c="text-right">Keywords</Th><Th c="text-right">Avg. position</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">{own.map(p => <tr key={p.url} className="hover:bg-slate-50"><td className="px-4 py-2.5 max-w-[520px] truncate"><a href={p.url} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline" title={p.url}>{p.url.replace(/^https?:\/\//, '')}</a></td><td className="px-4 py-2.5 text-right tabular-nums">{p.keywords}</td><td className="px-4 py-2.5 text-right tabular-nums">{p.avg_position}</td></tr>)}</tbody></table>
        ) : <Empty>None of your pages is in Google&apos;s top 10 for a tracked keyword yet.</Empty>}
      </Card>
    );
  }
  const total = rows.reduce((a, p) => a + p.traffic, 0) || 1;
  return (
    <Card title={`Top pages ${rows.length ? `(${rows.length})` : ''}`} subtitle="Pages with the most estimated organic traffic (data provider)" pad={false}>
      {rows.length ? (
        <table className="w-full text-13"><thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>URL</Th><Th c="text-right">Traffic %</Th><Th c="text-right">Traffic</Th><Th c="text-right">Keywords</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map(p => <tr key={p.url} className="hover:bg-slate-50"><td className="px-4 py-2.5 max-w-[520px] truncate"><a href={p.url} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline inline-flex items-center gap-1" title={p.url}>{p.url.replace(/^https?:\/\//, '')}<ExternalLink size={10} /></a></td><td className="px-4 py-2.5 text-right tabular-nums">{(p.traffic / total * 100).toFixed(2)}</td><td className="px-4 py-2.5 text-right tabular-nums">{compact(p.traffic)}</td><td className="px-4 py-2.5 text-right tabular-nums">{p.keywords}</td></tr>)}</tbody></table>
      ) : <Empty>{whyIntel(intel, s, 'pages')}</Empty>}
    </Card>
  );
}

const TABS = [['overview', 'Overview'], ['positions', 'Positions'], ['changes', 'Position changes'], ['competitors', 'Competitors'], ['topics', 'Topics'], ['pages', 'Pages'], ['subdomains', 'Subdomains']];

function Page({ b }) {
  const [tab, setTab] = useUrlTab('overview', TABS.map(t => t[0]));
  const [market, setMarket] = useState('');
  const [days, setDays] = useState(30);
  const [refreshing, setRefreshing] = useState(false);
  const intel = useApi(`/businesses/${b.id}/seo/domain-intel${market ? `?country=${market}` : ''}`);
  const research = useApi(`/businesses/${b.id}/seo/organic-research?days=${days}`);
  const domain = useApi(`/businesses/${b.id}/seo/domain`);
  const [err, setErr] = useState('');
  const refresh = () => {
    setRefreshing(true); setErr('');
    api(`/businesses/${b.id}/seo/domain-intel?refresh=true${market ? `&country=${market}` : ''}`).then(() => intel.reload(true)).catch(e => setErr(e.message)).finally(() => setRefreshing(false));
  };
  const d = intel.data;
  const mockNote = research.data?.mock && !d?.mock;
  return (
    <div className="space-y-4">
      <div className="ai-glass-card rounded px-5 py-3.5 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-16 font-semibold text-slate-900 truncate flex items-center gap-2 flex-wrap">{d?.domain || b.name}{d && <Badge tone={d.internal ? 'violet' : 'gray'}>{d.internal ? 'Internal' : 'Client'}</Badge>}{research.data?.mock && <Badge tone="amber"><AlertTriangle size={11} />Sample rank checks</Badge>}</div>
          <div className="text-12 text-slate-500">{b.name}{d ? ` · ${d.country_name}` : ''}</div>
        </div>
      </div>
      <IntelBar intel={d} loading={intel.loading} market={market} setMarket={setMarket} onRefresh={refresh} refreshing={refreshing} />
      {mockNote && <p className="text-12 text-amber-700">Position changes and SERP features are sample rank checks (RANK_LANDSCAPE_MOCK); the domain figures above are not.</p>}
      <ErrorNote>{err || (intel.error && intel.error.message)}</ErrorNote>
      <Tabs value={tab} onChange={setTab} tabs={TABS.map(([id, label]) => ({ id, label }))} />
      {tab === 'overview' && <Overview intel={d} research={research.data} ai={domain.data?.ai} days={days} setDays={setDays} go={setTab} />}
      {tab === 'positions' && <Positions b={b} intel={d} />}
      {tab === 'changes' && <ChangesTab research={research.data} />}
      {tab === 'competitors' && <Competitors intel={d} research={research.data} />}
      {tab === 'topics' && <Topics b={b} />}
      {tab === 'pages' && <PagesTab intel={d} research={research.data} />}
      {tab === 'subdomains' && <SubdomainsCard intel={d} research={research.data} full />}
      <p className="text-11.5 text-slate-400 flex items-start gap-1.5"><Info size={12} className="mt-0.5 shrink-0" />Domain-wide figures (keywords, traffic, trend, pages, subdomains, competitors) are estimates from the data provider. Position changes and SERP features come from the Google rank checks of your tracked keywords (top 10 results). Nothing is filled in where a source has no data.</p>
    </div>
  );
}

export const OrganicRankingsPage = function OrganicRankingsPage() {
  return <SeoShell title="Organic Rankings" subtitle="Keywords, traffic, positions, SERP features, pages and competitors for the site on Google">{(b) => <Page key={b.id} b={b} />}</SeoShell>;
};

export { Overview, Positions, ChangesTab, Competitors, PagesTab, SubdomainsCard, Changes, FeatureGrid, FeatureTrend, FeatureChanges, Headline };
