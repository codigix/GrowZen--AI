import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Loader2, ArrowUp, ArrowDown, ExternalLink, Search, Inbox, Info, Sparkles, FileText, Download, AlertTriangle, ChevronLeft, ChevronRight, ScanSearch } from 'lucide-react';
import { SeoShell, Card, Badge, Button, ErrorNote, useModulePath } from './SeoUi';
import { useApi, fmt } from './seoApi';
import { IntelBar } from './DomainIntel';

/**
 * Top Pages: every page of the site that a real source knows, one row each.
 * crawl = the site's own crawl; google = ranks for a tracked keyword (saved Google checks) or, with the data provider, estimated traffic;
 * ai = cited in an AI answer. A column a source cannot fill shows "—", never an estimate. Server: GET .../seo/top-pages-report.
 */

const AXIS = { fontSize: 11, fill: '#64748b' };
const PAGE = 25;
const INTENT = { informational: ['I', '#6658dd'], navigational: ['N', '#a855f7'], commercial: ['C', '#f59e0b'], transactional: ['T', '#1abc9c'] };
const Th = ({ children, c = 'text-left', hint }) => <th title={hint} className={`px-3 py-2.5 font-semibold whitespace-nowrap ${c}`}>{children}</th>;
const dash = <span className="text-slate-300">—</span>;
const short = (u) => u.replace(/^https?:\/\/(www\.)?/, '');

function Source({ sources }) {
  return (
    <span className="inline-flex items-center gap-1">
      {sources.includes('google') && <span title="Ranks on Google" className="w-5 h-5 rounded-full border border-slate-200 bg-white text-[11px] font-bold flex items-center justify-center" style={{ color: '#4285f4' }}>G</span>}
      {sources.includes('ai') && <span title="Cited by AI answers" className="w-5 h-5 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center"><Sparkles size={11} /></span>}
      {sources.length === 1 && sources[0] === 'crawl' && <span title="Found by the site crawl only" className="w-5 h-5 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center"><FileText size={11} /></span>}
    </span>
  );
}

function Pct({ v }) {
  if (v == null) return null;
  return <span className={`inline-flex items-center text-11.5 font-semibold ${v > 0 ? 'text-emerald-600' : 'text-red-500'}`}>{v > 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}{Math.abs(v)}%</span>;
}

function Stat({ label, value, change, why }) {
  return (
    <div className="px-5 py-3 min-w-0" title={why}>
      <div className="text-12.5 font-semibold text-slate-500">{label}</div>
      <div className="flex items-baseline gap-2"><span className={`text-26 font-bold tabular-nums ${value == null ? 'text-slate-300' : 'text-slate-900'}`}>{value ?? '—'}</span><Pct v={change} /></div>
      {value == null && why && <div className="text-11.5 text-slate-400 leading-snug max-w-[220px]">{why}</div>}
    </div>
  );
}

function Empty({ children, icon: Icon = Inbox }) {
  return <div className="py-8 flex flex-col items-center text-center gap-2 text-13 text-slate-500"><Icon size={22} className="text-slate-300" /><span className="max-w-sm">{children}</span></div>;
}

function Summary({ d }) {
  const s = d.summary;
  const [range, setRange] = useState(12);
  const hist = (d.traffic_history || []).slice(-range);
  const series = d.tracked_series || [];
  const [show, setShow] = useState({ ranking_pages: true, cited_pages: true });
  return (
    <Card title="Summary" pad={false}>
      <div className="grid grid-cols-1 sm:grid-cols-3 divide-x divide-slate-100 border-b border-slate-100">
        <Stat label="Organic traffic" value={s.traffic != null ? fmt(Math.round(s.traffic)) : null} change={s.traffic_change} why="Clicks come from Google Search Console: connect it to see them." />
        <Stat label={d.has.index ? 'Organic pages' : 'Pages ranking in Google'} value={s.organic_pages} why="No page ranks yet, or no position has been checked." />
        <Stat label="Cited pages" value={s.cited_pages} why={s.prompts ? 'No AI answer cites a page of this site yet.' : 'Run the AI check in the AI tracker to see which pages AI cites.'} />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 p-5">
        <div>
          <div className="flex items-center justify-between mb-2"><div className="text-13 font-semibold text-slate-800">Estimated organic traffic</div>
            {hist.length > 0 && <div className="flex gap-0.5 p-0.5 bg-slate-100 rounded">{[[6, '6M'], [12, '1Y'], [24, '2Y']].map(([n, l]) => <button key={n} type="button" onClick={() => setRange(n)} className={`h-6 px-2 text-11.5 font-semibold rounded cursor-pointer ${range === n ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>{l}</button>)}</div>}</div>
          {hist.length ? (
            <div className="h-48"><ResponsiveContainer width="100%" height="100%"><AreaChart data={hist} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
              <defs><linearGradient id="tp-t" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6658dd" stopOpacity={0.3} /><stop offset="100%" stopColor="#6658dd" stopOpacity={0.02} /></linearGradient></defs>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" vertical={false} /><XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} /><YAxis tick={AXIS} tickLine={false} axisLine={false} width={40} allowDecimals={false} /><Tooltip />
              <Area type="monotone" dataKey="traffic" name="Traffic" stroke="#6658dd" strokeWidth={2.2} fill="url(#tp-t)" dot={false} />
            </AreaChart></ResponsiveContainer></div>
          ) : <Empty>Traffic history comes from Google Search Console. Connect an account that can see this site.</Empty>}
        </div>
        <div>
          <div className="flex items-center justify-between mb-2"><div className="text-13 font-semibold text-slate-800">Pages over time</div>
            <div className="flex gap-3 text-12">{[['ranking_pages', 'Ranking pages', '#10b981'], ['cited_pages', 'Cited pages', '#a855f7']].map(([k, l, c]) => <label key={k} className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700"><input type="checkbox" checked={show[k]} onChange={e => setShow(x => ({ ...x, [k]: e.target.checked }))} style={{ accentColor: c }} />{l}</label>)}</div></div>
          {series.length ? (
            <div className="h-48"><ResponsiveContainer width="100%" height="100%"><LineChart data={series.map(x => ({ ...x, label: x.date.slice(5) }))} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" vertical={false} /><XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={20} /><YAxis tick={AXIS} tickLine={false} axisLine={false} width={30} allowDecimals={false} /><Tooltip />
              {show.ranking_pages && <Line type="monotone" dataKey="ranking_pages" name="Ranking pages" stroke="#10b981" strokeWidth={2.2} dot={series.length < 4} connectNulls />}
              {show.cited_pages && <Line type="monotone" dataKey="cited_pages" name="Cited pages" stroke="#a855f7" strokeWidth={2.2} dot={series.length < 4} connectNulls />}
            </LineChart></ResponsiveContainer></div>
          ) : <Empty>Appears after the first position check or AI check. Both grow with every run.</Empty>}
        </div>
      </div>
    </Card>
  );
}

const csv = (name, rows) => {
  const head = ['url', 'sources', 'traffic', 'traffic %', 'keywords', 'ai prompts', 'ref domains', 'avg position', 'top keyword', 'intent', 'words', 'issues', 'status'];
  const text = [head, ...rows.map(r => [r.url, r.sources.join('+'), r.traffic, r.traffic_share, r.keywords, r.llm_prompts, r.ref_domains, r.avg_position, r.top_keyword, r.intent, r.words, r.issues, r.status])]
    .map(l => l.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  Object.assign(document.createElement('a'), { href, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
};

function AllPages({ d }) {
  const [q, setQ] = useState('');
  const [view, setView] = useState('all');
  const [source, setSource] = useState('');
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [page, setPage] = useState(1);
  const rows = useMemo(() => d.rows.filter(r => (!q || r.url.toLowerCase().includes(q.toLowerCase())) && (view === 'all' || r.status === view)
    && (!source || (source === 'crawl' ? r.sources.length === 1 && r.sources[0] === 'crawl' : r.sources.includes(source))) && (!issuesOnly || r.issues)), [d.rows, q, view, source, issuesOnly]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const cur = Math.min(page, pages);
  const shown = rows.slice((cur - 1) * PAGE, cur * PAGE);
  const reset = (fn) => (e) => { fn(e); setPage(1); };
  const chip = (id, l, n) => <button key={id} type="button" onClick={() => { setView(id); setPage(1); }} className={`h-8 px-3 text-12.5 font-semibold rounded border cursor-pointer ${view === id ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 bg-white hover:bg-slate-50'}`}>{l}{n != null && <span className="ml-1 opacity-60">{n}</span>}</button>;
  const has = d.has;
  return (
    <Card title={<span>All pages <span className="text-slate-400 font-normal">{d.total}</span></span>} pad={false} action={<Button size="sm" icon={Download} onClick={() => csv(`${d.domain}-top-pages.csv`, rows)}>Export</Button>}>
      <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
        <label className="relative"><Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={q} onChange={reset(e => setQ(e.target.value))} placeholder="Filter by URL" className="h-8 pl-8 pr-3 w-52 text-13 rounded border border-slate-200 bg-white outline-none focus:border-indigo-400" /></label>
        <div className="flex gap-1">{chip('all', 'All URLs')}{chip('new', 'New', d.comparable ? d.new : null)}{chip('lost', 'Lost', d.comparable ? d.lost : null)}</div>
        <select value={source} onChange={reset(e => setSource(e.target.value))} className="h-8 px-2 text-12.5 rounded border border-slate-200 bg-white cursor-pointer" aria-label="Source"><option value="">Source: all</option><option value="google">Google</option><option value="ai">AI answers</option><option value="crawl">Crawl only</option></select>
        <label className="inline-flex items-center gap-1.5 text-12.5 text-slate-600 cursor-pointer"><input type="checkbox" checked={issuesOnly} onChange={reset(e => setIssuesOnly(e.target.checked))} />With issues</label>
        {!d.comparable && <span className="text-11.5 text-slate-400 ml-auto">New / Lost need two position checks.</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-13 min-w-[1180px]">
          <thead className="bg-slate-50 text-11.5 text-slate-500">
            <tr><Th>Source</Th><Th>URL</Th><Th c="text-right" hint="Estimated monthly visits (data provider)">Traffic</Th><Th c="text-right">Traffic %</Th><Th c="text-right" hint="Keywords the page ranks for: the provider's count, else your tracked keywords that rank">Keywords</Th>
              <Th c="text-right" hint="Saved AI answers that cite the page">AI prompts</Th><Th c="text-right" hint="Referring domains (data provider)">Ref. domains</Th><Th c="text-right" hint="Average Google position of your tracked keywords on this page">Avg. pos.</Th><Th>Top keyword</Th><Th>Intent</Th><Th c="text-right">Words</Th><Th c="text-right">Issues</Th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map(r => (
              <tr key={r.key} className="hover:bg-slate-50 align-top">
                <td className="px-3 py-3"><Source sources={r.sources} /></td>
                <td className="px-3 py-3 max-w-[340px]">
                  <a href={r.url} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline inline-flex items-center gap-1 break-all" title={r.url}>{short(r.url)}<ExternalLink size={10} className="shrink-0" /></a>
                  {r.status === 'new' && <span className="ml-2 align-middle"><Badge tone="green">new</Badge></span>}{r.status === 'lost' && <span className="ml-2 align-middle"><Badge tone="red">lost</Badge></span>}
                  {r.noindex && <span className="ml-2 align-middle"><Badge tone="amber">noindex</Badge></span>}{r.http >= 400 && <span className="ml-2 align-middle"><Badge tone="red">{r.http}</Badge></span>}
                  {r.title && <div className="text-12 text-slate-500 truncate" title={r.title}>{r.title}</div>}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{r.traffic != null ? (r.traffic >= 100 ? fmt(Math.round(r.traffic)) : r.traffic) : dash}</td>
                <td className="px-3 py-3 text-right tabular-nums">{r.traffic_share != null ? (r.traffic_share < 0.01 ? '< 0.01' : r.traffic_share.toFixed(2)) : dash}</td>
                <td className="px-3 py-3 text-right tabular-nums text-indigo-700">{r.keywords || (r.keywords === 0 && (has.ranks || has.index) ? 0 : dash)}</td>
                <td className="px-3 py-3 text-right tabular-nums" title={r.ai_engines.join(', ')}>{r.llm_prompts || (has.ai ? 0 : dash)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{r.ref_domains != null ? fmt(r.ref_domains) : dash}</td>
                <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{r.avg_position != null ? <>{r.avg_position}{r.position_change ? <span className={`ml-1 text-11.5 font-semibold ${r.position_change > 0 ? 'text-emerald-600' : 'text-red-500'}`}>{r.position_change > 0 ? '↑' : '↓'}{Math.abs(r.position_change)}</span> : null}</> : dash}</td>
                <td className="px-3 py-3 max-w-[180px]">{r.top_keyword ? <span className="text-indigo-700">{r.top_keyword}</span> : <span className="text-slate-400">n/a</span>}</td>
                <td className="px-3 py-3">{r.intent && INTENT[r.intent] ? <span title={r.intent} className="inline-flex w-5 h-5 rounded text-[11px] font-bold items-center justify-center text-white" style={{ background: INTENT[r.intent][1] }}>{INTENT[r.intent][0]}</span> : r.intent ? <Badge tone="gray">{r.intent}</Badge> : <span className="text-slate-400">n/a</span>}</td>
                <td className="px-3 py-3 text-right tabular-nums">{r.words != null ? fmt(r.words) : dash}</td>
                <td className="px-3 py-3 text-right">{r.issues == null ? dash : r.issues ? <Badge tone="amber">{r.issues}</Badge> : <span className="text-emerald-600">0</span>}</td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={12} className="px-5 py-10 text-center text-slate-500">No page matches these filters.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="px-5 py-3 border-t border-slate-100 flex items-center gap-2 text-12.5 text-slate-500">
        <span>{rows.length ? `${(cur - 1) * PAGE + 1}–${Math.min(cur * PAGE, rows.length)} of ${rows.length}` : '0 pages'}</span>
        <span className="ml-auto flex items-center gap-1"><Button size="sm" icon={ChevronLeft} disabled={cur <= 1} onClick={() => setPage(cur - 1)}>Prev</Button><span className="px-2">Page {cur} of {pages}</span><Button size="sm" disabled={cur >= pages} onClick={() => setPage(cur + 1)}>Next<ChevronRight size={13} /></Button></span>
      </div>
    </Card>
  );
}

function Sources({ d }) {
  const items = [
    ['Site crawl', d.has.crawl, d.audited_at ? `Crawled ${new Date(d.audited_at).toLocaleDateString()}` : 'No crawl yet: run a website audit.', 'Words, issues, links and structured data'],
    ['Google positions', d.has.ranks, d.has.ranks ? 'From your saved rank checks' : 'No position checked yet: use “Check positions now” in Organic Rankings.', 'Position, keywords, new and lost'],
    ['Google Search Console', d.has.index, d.has.index ? 'Connected' : 'Not connected: connect a Google account that can see this site.', 'Clicks per page, traffic history'],
    ['AI answers', d.has.ai, d.has.ai ? `${d.summary.prompts} prompts checked` : 'No AI check yet: run it in the AI tracker.', 'Cited pages and AI prompts'],
  ];
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
      {items.map(([name, ok, note, gives]) => (
        <div key={name} className="ai-glass-card rounded p-3.5">
          <div className="flex items-center gap-2 text-13 font-semibold text-slate-800"><span className={`w-2 h-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-slate-300'}`} />{name}</div>
          <div className="text-12 text-slate-500 mt-1">{note}</div><div className="text-11.5 text-slate-400 mt-0.5">Fills: {gives}</div>
        </div>
      ))}
    </div>
  );
}

function Page({ b }) {
  const path = useModulePath();
  const [days, setDays] = useState(30);
  const data = useApi(`/businesses/${b.id}/seo/top-pages-report?days=${days}`);
  const d = data.data;
  const sel = 'h-9 px-2.5 text-13 rounded border border-slate-200 bg-white text-slate-700 cursor-pointer';
  if (!d) return data.error ? <ErrorNote>{data.error.message}</ErrorNote> : <div className="py-16 flex justify-center text-slate-400"><Loader2 size={18} className="animate-spin" /></div>;
  if (d.state === 'no_website') return <Card><Empty icon={Info}>Add the business&apos;s website first: pages are matched by its domain.</Empty></Card>;
  const nothing = !d.total;
  return (
    <div className="space-y-4">
      <div className="ai-glass-card rounded px-5 py-3.5 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1"><div className="text-16 font-semibold text-slate-900 flex items-center gap-2 flex-wrap">{d.domain}{d.internal != null && <Badge tone={d.internal ? 'violet' : 'gray'}>{d.internal ? 'Internal' : 'Client'}</Badge>}{d.mock && <Badge tone="amber"><AlertTriangle size={11} />Sample data: not real</Badge>}</div>
          <div className="text-12 text-slate-500">{b.name}</div></div>
        <select className={sel} value={days} onChange={e => setDays(Number(e.target.value))} aria-label="Period for new and lost pages"><option value={30}>Last 30 days</option><option value={60}>Last 60 days</option><option value={90}>Last 90 days</option></select>
      </div>
      <Sources d={d} />
      {nothing ? (
        <Card><Empty icon={ScanSearch}>No page is known yet. Audit the website to list its pages, then check positions to see which rank.<Link to={path('website-audit')} className="mt-2 h-9 px-4 rounded inline-flex items-center text-13 font-semibold bg-indigo-500 text-white hover:bg-indigo-600">Audit the website</Link></Empty></Card>
      ) : (
        <>
          <Summary d={d} />
          <AllPages d={d} />
        </>
      )}
      <p className="text-11.5 text-slate-400 flex items-start gap-1.5"><Info size={12} className="mt-0.5 shrink-0" />Each column comes from the source named above it; a dash means that source has nothing for the page, not zero. Traffic is estimated by the data provider. Pages ranked below Google&apos;s top 10 are not recorded by the position checks.</p>
    </div>
  );
}

export const TopPagesPage = function TopPagesPage() {
  return <SeoShell title="Top Pages" subtitle="Every page of the site with where it ranks, what it earns, whether AI cites it, and what is wrong with it">{(b) => <Page key={b.id} b={b} />}</SeoShell>;
};
