import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import {
  Loader2, Globe, Sparkles, ArrowUp, ArrowDown, Download, PlugZap, ExternalLink, Info, Monitor, Smartphone, Tablet, Search, Bot, Link2, MousePointerClick, Eye, KeyRound, FileText, Gauge
} from 'lucide-react';
import { SeoShell, Card, Badge, Button, ErrorNote, Tabs, useAction, useToast } from './SeoUi';
import { api, useApi, fmt } from './seoApi';

/**
 * Domain Overview from real sources only: Google traffic (clicks, impressions, position, keywords, pages, countries,
 * devices, history) from Search Console through the connected Google account; AI visibility from the stored AI checks.
 * Authority score, backlinks, referring domains and paid figures need a link index or Google Ads: shown as
 * unavailable with the reason, never estimated. Server: GET /businesses/{id}/seo/domain (routers/seo.py, services/gsc.py).
 */

const RANGES = [['28d', 'Last 28 days'], ['3m', 'Last 3 months'], ['6m', 'Last 6 months'], ['12m', 'Last 12 months'], ['16m', 'Last 16 months']];
const ENGINES = { chatgpt: 'ChatGPT', gemini: 'Gemini', perplexity: 'Perplexity', claude: 'Claude', anthropic: 'Claude', aio: 'AI Overview', google: 'AI Overview', copilot: 'Copilot', grok: 'Grok' };
const flag = (code) => (/^[A-Z]{2}$/.test(code || '') ? String.fromCodePoint(...[...code].map(c => 127397 + c.charCodeAt(0))) : '🌐');
let names; try { names = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (e) { names = null; }
const country = (code) => { try { return names?.of(code) || code; } catch (e) { return code; } };
const pct = (now, before) => (before ? Math.round(((now - before) / before) * 100) : null);

function Change({ now, before, unit = '%' }) {
  const d = pct(now, before);
  if (d == null) return <span className="text-11.5 text-slate-400">no earlier data</span>;
  if (d === 0) return <span className="text-11.5 text-slate-400">no change</span>;
  return <span className={`inline-flex items-center gap-0.5 text-11.5 font-semibold ${d > 0 ? 'text-emerald-600' : 'text-red-500'}`}>{d > 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}{Math.abs(d)}{unit}</span>;
}

/** One figure: label, value, change; or an honest "not available" with the reason on hover. */
function Metric({ label, value, change, icon: Icon, why, tone = 'text-slate-900' }) {
  return (
    <div className="min-w-0" title={why || undefined}>
      <div className="text-12 font-semibold text-slate-500 flex items-center gap-1.5 truncate">{Icon && <Icon size={12} className="text-slate-400" />}{label}{why && <Info size={11} className="text-slate-300" />}</div>
      <div className="flex items-baseline gap-2 mt-0.5">
        <span className={`text-26 leading-tight font-bold tabular-nums ${value == null ? 'text-slate-300' : tone}`}>{value ?? '—'}</span>
        {change}
      </div>
      {value == null && why && <div className="text-11 text-slate-400 leading-snug">{why}</div>}
    </div>
  );
}

const Th = ({ children, c = 'text-left' }) => <th className={`px-4 py-2.5 font-semibold whitespace-nowrap ${c}`}>{children}</th>;

function Overview({ d, r, setFilter, filters }) {
  const t = r?.totals;
  const p = r?.previous;
  const ai = d.ai;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        {/* AI Search */}
        <Card className="xl:col-span-2" title={<span className="inline-flex items-center gap-2"><Sparkles size={15} className="text-violet-500" />AI Search</span>}
          action={<Link to="/geo-optimization" className="text-12.5 font-semibold text-indigo-600 hover:underline">Open →</Link>}>
          {ai.measured ? (
            <>
              <div className="grid grid-cols-3 gap-4">
                <Metric label="AI visibility" value={`${ai.visibility}%`} tone="text-indigo-600" />
                <Metric label="Mentions" value={fmt(ai.mentions)} tone="text-indigo-600" />
                <Metric label="Cited pages" value={fmt(ai.cited_pages)} tone="text-indigo-600" />
              </div>
              <table className="w-full text-13 mt-4"><thead className="text-11.5 uppercase tracking-wide text-slate-400"><tr><th className="py-1 text-left font-semibold">Engine</th><th className="py-1 text-right font-semibold">Visibility</th><th className="py-1 text-right font-semibold">Mentions</th><th className="py-1 text-right font-semibold">Cited pages</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{ai.engines.map(e => <tr key={e.engine}><td className="py-2 flex items-center gap-2 text-slate-800"><Bot size={13} className="text-slate-400" />{ENGINES[e.engine] || e.engine}</td><td className="py-2 text-right tabular-nums">{e.visibility}%</td><td className="py-2 text-right tabular-nums text-indigo-600">{e.mentions}</td><td className="py-2 text-right tabular-nums text-indigo-600">{e.cited}</td></tr>)}</tbody></table>
              <p className="text-11 text-slate-400 mt-2">From the latest AI checks ({ai.data_source}): the share of questions where the AI names the business, and the pages of this domain it cites.</p>
            </>
          ) : (
            <div className="py-4 text-center text-13 text-slate-500">AI visibility hasn't been measured for this project ({ai.prompts} prompts saved). <Link to="/geo-optimization" className="text-indigo-600 font-semibold hover:underline">Run the AI check</Link> to see mentions and cited pages per engine.</div>
          )}
        </Card>

        {/* SEO */}
        <Card className="xl:col-span-3" title={<span className="inline-flex items-center gap-2"><Search size={15} className="text-indigo-500" />SEO</span>}
          action={r && <span className="text-11.5 text-slate-400">{r.period.start} → {r.period.end}</span>}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-5">
            <Metric label="Authority score" value={d.links.authority ?? null} why={d.links.authority == null ? 'Needs a link index (DataForSEO)' : null} />
            <Metric label="Organic traffic" icon={MousePointerClick} value={t ? fmt(t.clicks) : null} change={t && <Change now={t.clicks} before={p.clicks} />} why={!t ? 'Needs Search Console' : null} tone="text-indigo-600" />
            <Metric label="Paid traffic" value={null} why="Needs Google Ads or a paid index" />
            <Metric label="Ref. domains" icon={Link2} value={d.links.referring_domains != null ? fmt(d.links.referring_domains) : null} why={d.links.referring_domains == null ? 'Needs a link index (DataForSEO)' : null} />
            <Metric label="Impressions" icon={Eye} value={t ? fmt(t.impressions) : null} change={t && <Change now={t.impressions} before={p.impressions} />} why={!t ? 'Needs Search Console' : null} tone="text-indigo-600" />
            <Metric label="Organic keywords" icon={KeyRound} value={t ? `${fmt(t.keywords)}${r.keywords_capped ? '+' : ''}` : null} change={t && <Change now={t.keywords} before={p.keywords} />} why={!t ? 'Needs Search Console' : null} tone="text-indigo-600" />
            <Metric label="Paid keywords" value={null} why="Needs Google Ads or a paid index" />
            <Metric label="Backlinks" icon={Link2} value={d.links.backlinks != null ? fmt(d.links.backlinks) : null} why={d.links.backlinks == null ? 'Needs a link index (DataForSEO)' : null} />
          </div>
          {t && (
            <div className="mt-5 pt-4 border-t border-slate-100 grid grid-cols-3 gap-4 text-center">
              <div><div className="text-18 font-bold tabular-nums text-slate-900">{t.ctr}%</div><div className="text-11.5 text-slate-500">Click-through rate</div></div>
              <div><div className="text-18 font-bold tabular-nums text-slate-900">{t.position ?? '—'}</div><div className="text-11.5 text-slate-500">Average position</div></div>
              <div><div className="text-18 font-bold tabular-nums text-slate-900">{fmt(t.pages)}{r.keywords_capped ? '+' : ''}</div><div className="text-11.5 text-slate-500">Pages with traffic</div></div>
            </div>
          )}
        </Card>
      </div>

      {r && <TrafficPanel d={d} r={r} filters={filters} setFilter={setFilter} />}
      {r && <KeywordsPanel r={r} />}
    </div>
  );
}

function TrafficPanel({ d, r, filters, setFilter }) {
  const [months, setMonths] = useState(false);
  const [show, setShow] = useState({ clicks: true, impressions: true });
  const data = useMemo(() => {
    if (!months) return r.timeline.map(x => ({ ...x, label: x.date.slice(5) }));
    const by = {};
    r.timeline.forEach(x => { const k = x.date.slice(0, 7); by[k] = by[k] || { date: k, label: k, clicks: 0, impressions: 0 }; by[k].clicks += x.clicks; by[k].impressions += x.impressions; });
    return Object.values(by);
  }, [r, months]);
  const exportCsv = () => {
    const lines = [['date', 'clicks', 'impressions'], ...r.timeline.map(x => [x.date, x.clicks, x.impressions])].map(l => l.join(',')).join('\n');
    const href = URL.createObjectURL(new Blob([lines], { type: 'text/csv' }));
    Object.assign(document.createElement('a'), { href, download: `${d.domain || 'domain'}-traffic.csv` }).click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };
  const maxClicks = Math.max(1, ...r.countries.map(c => c.clicks));
  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 items-start">
      <Card className="xl:col-span-2" title="Distribution by country" subtitle="Google Search clicks by the searcher's country" pad={false}>
        <div className="overflow-auto max-h-[430px]">
          <table className="w-full text-13">
            <thead className="sticky top-0 bg-slate-50 text-11.5 uppercase tracking-wide text-slate-500"><tr><Th>Country</Th><Th c="text-right">Clicks</Th><Th c="text-right">Impr.</Th><Th c="text-right">Pos.</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              <tr onClick={() => setFilter({ country: '' })} className={`cursor-pointer hover:bg-slate-50 ${!filters.country ? 'bg-indigo-50/50 font-semibold' : ''}`}><td className="px-4 py-2.5">🌐 Worldwide</td><td className="px-4 py-2.5 text-right tabular-nums text-indigo-600">{fmt(r.totals.clicks)}</td><td className="px-4 py-2.5 text-right tabular-nums">{fmt(r.totals.impressions)}</td><td className="px-4 py-2.5 text-right tabular-nums">{r.totals.position ?? '—'}</td></tr>
              {r.countries.map(c => (
                <tr key={c.code} onClick={() => setFilter({ country: c.code })} className={`cursor-pointer hover:bg-slate-50 ${filters.country === c.code ? 'bg-indigo-50/50 font-semibold' : ''}`}>
                  <td className="px-4 py-2.5"><span className="mr-1.5">{flag(c.code)}</span>{country(c.code)}<span className="block h-1 mt-1 rounded-full bg-slate-100 overflow-hidden"><span className="block h-full bg-indigo-400" style={{ width: `${(c.clicks / maxClicks) * 100}%` }} /></span></td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-indigo-600">{fmt(c.clicks)}</td><td className="px-4 py-2.5 text-right tabular-nums">{fmt(c.impressions)}</td><td className="px-4 py-2.5 text-right tabular-nums">{c.position}</td>
                </tr>
              ))}
              {!r.countries.length && <tr><td colSpan={4} className="px-5 py-8 text-center text-slate-500">No country data for this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="xl:col-span-3" title="Traffic" subtitle={`Google Search, ${r.period.start} → ${r.period.end}`}
        action={<div className="flex items-center gap-2"><div className="flex gap-0.5 p-0.5 bg-slate-100 rounded">{[['Days', false], ['Months', true]].map(([l, v]) => <button key={l} type="button" onClick={() => setMonths(v)} className={`h-7 px-2.5 text-12 font-semibold rounded cursor-pointer ${months === v ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>{l}</button>)}</div><Button size="sm" icon={Download} onClick={exportCsv}>Export</Button></div>}>
        <div className="flex flex-wrap gap-4 mb-2 text-12.5">
          {[['clicks', 'Organic traffic (clicks)', '#6658dd'], ['impressions', 'Impressions', '#1abc9c']].map(([k, l, c]) => (
            <label key={k} className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700"><input type="checkbox" checked={show[k]} onChange={e => setShow(s => ({ ...s, [k]: e.target.checked }))} className="accent-indigo-600" style={{ accentColor: c }} />{l}</label>
          ))}
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <defs>{[['clicks', '#6658dd'], ['impressions', '#1abc9c']].map(([k, c]) => <linearGradient key={k} id={`do-${k}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={c} stopOpacity={0.25} /><stop offset="100%" stopColor={c} stopOpacity={0.02} /></linearGradient>)}</defs>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} minTickGap={28} />
              <YAxis yAxisId="c" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
              <YAxis yAxisId="i" orientation="right" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} allowDecimals={false} width={44} hide={!show.impressions} />
              <Tooltip />
              {show.impressions && <Area yAxisId="i" type="monotone" dataKey="impressions" name="Impressions" stroke="#1abc9c" strokeWidth={2} fill="url(#do-impressions)" dot={false} />}
              {show.clicks && <Area yAxisId="c" type="monotone" dataKey="clicks" name="Clicks" stroke="#6658dd" strokeWidth={2.5} fill="url(#do-clicks)" dot={false} />}
            </AreaChart>
          </ResponsiveContainer>
        </div>
        {r.devices.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-4 text-12.5 text-slate-600">
            {r.devices.map(x => { const I = x.device === 'mobile' ? Smartphone : x.device === 'tablet' ? Tablet : Monitor; const tot = r.devices.reduce((s, y) => s + y.clicks, 0) || 1; return <span key={x.device} className="inline-flex items-center gap-1.5"><I size={13} className="text-slate-400" /><span className="capitalize">{x.device}</span><b className="text-slate-900 tabular-nums">{Math.round((x.clicks / tot) * 100)}%</b><span className="text-slate-400">of clicks</span></span>; })}
          </div>
        )}
      </Card>
    </div>
  );
}

function KeywordsPanel({ r }) {
  const [tab, setTab] = useState('keywords');
  const [q, setQ] = useState('');
  const rows = (tab === 'keywords' ? r.keywords : r.pages).filter(x => !q || (x.query || x.page).toLowerCase().includes(q.toLowerCase()));
  return (
    <Card pad={false} title="Keywords & pages" subtitle="From Google Search: what people searched and which pages they landed on">
      <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
        <div className="flex gap-0.5 p-0.5 bg-slate-100 rounded">{[['keywords', `Organic keywords (${r.keywords.length}${r.keywords_capped ? '+' : ''})`], ['pages', `Top pages (${r.pages.length})`]].map(([id, l]) => <button key={id} type="button" onClick={() => setTab(id)} className={`h-8 px-3 text-12.5 font-semibold rounded cursor-pointer ${tab === id ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>{l}</button>)}<span title="Paid keywords need Google Ads or a paid index" className="h-8 px-3 text-12.5 font-semibold text-slate-300 inline-flex items-center cursor-not-allowed">Paid</span></div>
        <label className="relative ml-auto"><Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter" className="h-8 pl-8 pr-3 text-13 rounded border border-slate-200 bg-white focus:border-indigo-400 outline-none" /></label>
      </div>
      <div className="overflow-auto max-h-[460px]">
        <table className="w-full text-13">
          <thead className="sticky top-0 bg-slate-50 text-11.5 uppercase tracking-wide text-slate-500"><tr><Th>{tab === 'keywords' ? 'Keyword' : 'Page'}</Th><Th c="text-right">Clicks</Th><Th c="text-right">Impressions</Th><Th c="text-right">CTR</Th><Th c="text-right">Position</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(x => (
              <tr key={x.query || x.page} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 max-w-[420px] truncate font-medium text-slate-900">{x.query || <a href={x.page} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline inline-flex items-center gap-1">{x.page.replace(/^https?:\/\/[^/]+/, '') || '/'}<ExternalLink size={10} /></a>}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-indigo-600">{fmt(x.clicks)}</td><td className="px-4 py-2.5 text-right tabular-nums">{fmt(x.impressions)}</td><td className="px-4 py-2.5 text-right tabular-nums">{x.ctr}%</td>
                <td className="px-4 py-2.5 text-right tabular-nums"><Badge tone={x.position <= 3 ? 'green' : x.position <= 10 ? 'amber' : 'gray'}>{x.position}</Badge></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-500">Nothing matches.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Growth({ r }) {
  const months = useMemo(() => {
    const by = {};
    r.timeline.forEach(x => { const k = x.date.slice(0, 7); by[k] = by[k] || { month: k, clicks: 0, impressions: 0 }; by[k].clicks += x.clicks; by[k].impressions += x.impressions; });
    return Object.values(by).map((m, i, a) => ({ ...m, ctr: m.impressions ? Math.round((m.clicks / m.impressions) * 1000) / 10 : 0, change: i ? pct(m.clicks, a[i - 1].clicks) : null }));
  }, [r]);
  const t = r.totals, p = r.previous;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {[['Clicks', t.clicks, p.clicks, MousePointerClick], ['Impressions', t.impressions, p.impressions, Eye], ['Organic keywords', t.keywords, p.keywords, KeyRound], ['Pages with traffic', t.pages, p.pages, FileText]].map(([l, a, b, I]) => (
          <div key={l} className="ai-glass-card rounded p-4"><div className="text-12 font-semibold text-slate-500 flex items-center gap-1.5"><I size={13} className="text-slate-400" />{l}</div><div className="text-26 font-bold tabular-nums text-slate-900">{fmt(a)}</div><div className="text-11.5 text-slate-500 flex items-center gap-2">vs {fmt(b)} before <Change now={a} before={b} /></div></div>
        ))}
      </div>
      <Card title="Clicks by month" subtitle="The current period against its own growth month by month">
        <div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={months} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}><CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" vertical={false} /><XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} /><YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} allowDecimals={false} /><Tooltip /><Bar dataKey="clicks" name="Clicks" fill="#6658dd" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
      </Card>
      <Card pad={false} title="Month by month">
        <table className="w-full text-13"><thead className="bg-slate-50 text-11.5 uppercase tracking-wide text-slate-500"><tr><Th>Month</Th><Th c="text-right">Clicks</Th><Th c="text-right">Change</Th><Th c="text-right">Impressions</Th><Th c="text-right">CTR</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">{[...months].reverse().map(m => <tr key={m.month} className="hover:bg-slate-50"><td className="px-4 py-2.5 font-medium text-slate-900">{m.month}</td><td className="px-4 py-2.5 text-right tabular-nums text-indigo-600">{fmt(m.clicks)}</td><td className="px-4 py-2.5 text-right">{m.change != null ? <Change now={1 + (m.change / 100)} before={1} /> : '—'}</td><td className="px-4 py-2.5 text-right tabular-nums">{fmt(m.impressions)}</td><td className="px-4 py-2.5 text-right tabular-nums">{m.ctr}%</td></tr>)}</tbody></table>
      </Card>
    </div>
  );
}

function Compare({ r, setFilter }) {
  const total = r.countries.reduce((s, c) => s + c.clicks, 0) || 1;
  return (
    <Card pad={false} title="Compare by countries" subtitle="Where the clicks come from and how the site ranks there. Click a country to filter the whole page.">
      <div className="overflow-auto">
        <table className="w-full text-13">
          <thead className="bg-slate-50 text-11.5 uppercase tracking-wide text-slate-500"><tr><Th>Country</Th><Th c="text-right">Clicks</Th><Th c="text-right">Share</Th><Th c="text-right">Impressions</Th><Th c="text-right">CTR</Th><Th c="text-right">Avg position</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {r.countries.map(c => (
              <tr key={c.code} onClick={() => setFilter({ country: c.code })} className="cursor-pointer hover:bg-slate-50">
                <td className="px-4 py-2.5 font-medium text-slate-900"><span className="mr-1.5">{flag(c.code)}</span>{country(c.code)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-indigo-600">{fmt(c.clicks)}</td>
                <td className="px-4 py-2.5 w-44"><span className="flex items-center gap-2"><span className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><span className="block h-full bg-indigo-400 rounded-full" style={{ width: `${(c.clicks / total) * 100}%` }} /></span><span className="w-10 text-right tabular-nums text-slate-600">{Math.round((c.clicks / total) * 100)}%</span></span></td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmt(c.impressions)}</td><td className="px-4 py-2.5 text-right tabular-nums">{c.ctr}%</td><td className="px-4 py-2.5 text-right tabular-nums">{c.position}</td>
              </tr>
            ))}
            {!r.countries.length && <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-500">No country data for this period.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Connect({ t, busy, onConnect }) {
  const needs = ['not_connected', 'scope_missing'].includes(t.state);
  const title = { not_connected: 'Connect Google Search Console to see real traffic', scope_missing: 'Allow Search Console access', no_property: 'This site isn\'t in the connected Search Console', error: 'Google didn\'t return the traffic', no_website: 'Add the website first' }[t.state];
  return (
    <div className="rounded bg-indigo-50 ring-1 ring-inset ring-indigo-200 px-5 py-4 flex flex-wrap items-center gap-4">
      <span className="w-10 h-10 rounded-full bg-white text-indigo-500 flex items-center justify-center shrink-0"><PlugZap size={18} /></span>
      <div className="flex-1 min-w-[260px]">
        <div className="text-14 font-semibold text-indigo-900">{title}</div>
        <p className="text-12.5 text-indigo-800 mt-0.5">{t.message} Organic traffic, impressions, keywords, pages, countries and the history all come from Search Console: nothing is estimated.</p>
      </div>
      {needs ? <Button variant="primary" icon={PlugZap} busy={busy} onClick={onConnect}>{t.state === 'scope_missing' ? 'Reconnect with Search Console' : 'Connect Search Console'}</Button>
        : <a href="https://search.google.com/search-console" target="_blank" rel="noreferrer" className="h-9 px-4 rounded inline-flex items-center gap-1.5 text-13 font-semibold bg-white ring-1 ring-inset ring-indigo-200 text-indigo-700 hover:bg-indigo-100">Open Search Console <ExternalLink size={12} /></a>}
    </div>
  );
}

function Page({ b }) {
  const [filters, setFilters] = useState({ range: '3m', country: '', device: '' });
  const [tab, setTab] = useState('overview');
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const set = (patch) => setFilters(f => ({ ...f, ...patch }));
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const data = useApi(`/businesses/${b.id}/seo/domain?${qs}`);
  const connect = () => run('connect', async () => { const { url } = await api('/connections/google/start?purpose=gsc'); window.location.href = url; });
  const d = data.data;
  const r = d?.traffic?.state === 'ok' ? d.traffic.report : null;
  const top = (r?.countries || []).slice(0, 3);
  React.useEffect(() => { if (new URLSearchParams(window.location.search).get('gsc') === 'connected') { toast('Google Search Console connected'); window.history.replaceState({}, '', window.location.pathname); data.reload(true); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return data.error ? <ErrorNote>{data.error.message}</ErrorNote> : <div className="py-16 flex justify-center text-slate-400"><Loader2 size={18} className="animate-spin" /></div>;
  const sel = 'h-9 px-2.5 text-13 rounded border border-slate-200 bg-white text-slate-700 cursor-pointer';
  return (
    <div className="space-y-4">
      <div className="ai-glass-card rounded px-5 py-3.5 flex flex-wrap items-center gap-3">
        <span className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-500 flex items-center justify-center shrink-0"><Globe size={18} /></span>
        <div className="min-w-0 flex-1"><div className="text-16 font-semibold text-slate-900 truncate">{d.domain || 'No website yet'}</div><div className="text-12 text-slate-500">{d.name} · {d.market.label}{d.traffic.account ? ` · Search Console: ${d.traffic.account}` : ''}</div></div>
        {r && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-0.5 p-0.5 bg-slate-100 rounded">
              <button type="button" onClick={() => set({ country: '' })} className={`h-8 px-3 text-12.5 font-semibold rounded cursor-pointer ${!filters.country ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>🌐 Worldwide</button>
              {top.map(c => <button key={c.code} type="button" onClick={() => set({ country: c.code })} className={`h-8 px-3 text-12.5 font-semibold rounded cursor-pointer ${filters.country === c.code ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>{flag(c.code)} {c.code}</button>)}
              {filters.country && !top.some(c => c.code === filters.country) && <span className="h-8 px-3 text-12.5 font-semibold rounded bg-white shadow-sm text-slate-900 inline-flex items-center">{flag(filters.country)} {filters.country}</span>}
            </div>
            <select className={sel} value={filters.device} onChange={e => set({ device: e.target.value })} aria-label="Device"><option value="">All devices</option><option value="desktop">Desktop</option><option value="mobile">Mobile</option><option value="tablet">Tablet</option></select>
            <select className={sel} value={filters.range} onChange={e => set({ range: e.target.value })} aria-label="Period">{RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </div>
        )}
      </div>
      <ErrorNote>{error}</ErrorNote>
      {d.traffic.state !== 'ok' && <Connect t={d.traffic} busy={busy === 'connect'} onConnect={connect} />}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'overview', label: 'Overview' }, ...(r ? [{ id: 'growth', label: 'Growth report' }, { id: 'countries', label: 'Compare by countries' }] : [])]} />
      {tab === 'overview' && <Overview d={d} r={r} setFilter={set} filters={filters} />}
      {tab === 'growth' && r && <Growth r={r} />}
      {tab === 'countries' && r && <Compare r={r} setFilter={(p) => { set(p); setTab('overview'); }} />}
      <p className="text-11.5 text-slate-400 flex items-start gap-1.5"><Info size={12} className="mt-0.5 shrink-0" />{r ? `Traffic is from Google Search Console (${r.property}), ${r.period.days} days. ` : ''}Authority score, backlinks and referring domains need a link index (DataForSEO); paid traffic and keywords need Google Ads. They show as “—” instead of an estimate.</p>
      {toastNode}
    </div>
  );
}

export const DomainOverviewPage = function DomainOverviewPage() {
  return <SeoShell title="Domain Overview" subtitle="The site's real Google traffic, keywords, countries and AI visibility">{(b) => <Page key={b.id} b={b} />}</SeoShell>;
};
