import React, { useEffect, useRef, useState } from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { ArrowLeft, AlertTriangle, XCircle, Info, Smartphone, Monitor, Printer, RefreshCw, ChevronDown, Calendar } from 'lucide-react';
import { Card, Button, Badge, SkList, useAction, useToast } from './SeoUi';
import { api, useApi } from './seoApi';
import { IssuesTab, CrawledPagesTab, StatisticsTab, CompareTab, ProgressTab, JsTab } from './SiteAuditTabs';
import { AXIS } from './PositionUi';

const host = (u) => String(u || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
const path = (u) => { try { const x = new URL(u); return x.hostname.replace(/^www\./, '') + (x.pathname + x.search); } catch (e) { return u; } };
const tone = (v) => (v >= 80 ? '#10b981' : v >= 50 ? '#f59e0b' : '#ef4444');
/** A dropdown styled like the reference: white button with a chevron, and a list with the chosen option marked by a bar on its left. */
function Pick({ value, onChange, options, label }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const current = options.find(o => o.id === value) || options[0];
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => setOpen(o => !o)}
        className={`h-9 pl-3 pr-2.5 inline-flex items-center gap-2 rounded border bg-white text-14 text-slate-800 cursor-pointer ${open ? 'border-indigo-500 ring-1 ring-indigo-200' : 'border-slate-300 hover:border-slate-400'}`}>
        {current.label}<ChevronDown size={15} className="text-slate-700" />
      </button>
      {open && (
        <ul role="listbox" className="absolute left-0 top-full mt-1 z-30 min-w-[190px] rounded bg-white shadow-lg ring-1 ring-slate-200 py-1">
          {options.map(o => (
            <li key={o.id} role="option" aria-selected={o.id === value}>
              <button type="button" onClick={() => { onChange(o.id); setOpen(false); }}
                className={`w-full text-left px-3 py-2.5 text-14 border-l-[3px] cursor-pointer ${o.id === value ? 'border-slate-900 bg-indigo-50 text-slate-900' : 'border-transparent text-slate-700 hover:bg-slate-50'}`}>{o.label}</button>
            </li>))}
        </ul>
      )}
    </div>
  );
}

const KIND = { error: ['#ef4444', XCircle], warning: ['#f59e0b', AlertTriangle], notice: ['#6366f1', Info] };

/** Semicircle score with the change underneath. */
function Gauge({ v, change }) {
  if (v == null) return <div className="h-28 flex items-center text-13 text-slate-500">Not enough data yet</div>;
  const data = [{ v, c: tone(v) }, { v: 100 - v, c: '#e2e8f0' }];
  return (
    <div className="relative h-32">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart><Pie data={data} dataKey="v" startAngle={180} endAngle={0} cy="88%" innerRadius="68%" outerRadius="100%" stroke="none" isAnimationActive={false}>{data.map((x, i) => <Cell key={i} fill={x.c} />)}</Pie></PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-x-0 bottom-0 text-center"><div className="text-26 font-bold tabular-nums text-slate-900">{v}%</div><div className="text-12 text-slate-500">{change ? `${change > 0 ? '+' : ''}${change}%` : 'no changes'}</div></div>
    </div>
  );
}

const Stat = ({ title, hint, children, badge }) => (
  <div className="px-5 py-4">
    <div className="flex items-center justify-between"><div className="text-15 font-semibold text-slate-900 flex items-center gap-1.5">{title}<Info size={12} className="text-slate-300" title={hint} /></div>{badge}</div>
    {children}
  </div>
);

function Theme({ title, value, note, change }) {
  return (
    <div className="rounded border border-slate-200 bg-white px-4 py-3 min-h-[92px]">
      <div className="text-13.5 text-slate-800">{title}</div>
      {value != null ? <div className="text-24 font-bold tabular-nums mt-1" style={{ color: '#5b50d6' }}>{value}%{change ? <span className={`ml-2 text-12 font-semibold ${change > 0 ? 'text-emerald-600' : 'text-red-500'}`}>{change > 0 ? '+' : ''}{change}%</span> : null}</div> : null}
      {note && <div className="text-12 text-slate-500 mt-1">{note}</div>}
    </div>
  );
}

/** One audited website: health, issues by type, pages with the most issues, the trend and the thematic scores. */
const TABS = [['overview', 'Overview'], ['issues', 'Issues'], ['pages', 'Crawled Pages'], ['stats', 'Statistics'], ['compare', 'Compare Crawls'], ['progress', 'Progress'], ['js', 'JS Impact']];

export default function SiteAuditOverview({ projectId, onBack, initial }) {
  const data = useApi(`/businesses/${projectId}/audit-overview`);
  const [tabId, setTabId] = useState(initial?.tab || 'overview');
  const report = useApi(tabId !== 'overview' ? `/businesses/${projectId}/audit-report` : null);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const d = data.data;
  const [series, setSeries] = useState('health');
  const [upTo, setUpTo] = useState('');
  const rerun = () => run('rerun', async () => { await api(`/businesses/${projectId}/audits`, { method: 'POST', body: { kinds: ['technical', 'onpage'] } }); toast('Audit started: the figures update when it finishes'); });
  if (data.error) return <Card><p className="text-13 text-rose-600">{data.error.message}</p><Button className="mt-3" size="sm" icon={ArrowLeft} onClick={onBack}>Back</Button></Card>;
  if (!d) return <SkList rows={6} />;
  const p = d.previous || {};
  const diff = (k) => (d.previous && d[k] != null && p[k] != null ? d[k] - p[k] : null);
  const dated = d.trend.filter(x => x.date);
  const days = [...new Set(dated.map(x => x.date))].reverse().map(iso => ({ iso, label: new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }));
  const last = days[0]?.iso || '';
  const shown = dated.filter(x => x.date <= (upTo || last) && (series !== 'ai' || x.ai != null)).map(x => ({ ...x, date: x.date.slice(5) }));
  const okPages = Math.max(0, d.crawled - d.with_issues - d.broken);
  const bar = d.crawled ? [[okPages, '#34d399'], [d.with_issues, '#fbbf24'], [d.broken, '#ef4444']] : [];
  const updated = d.finished_at ? new Date(d.finished_at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  const tab = (id, label, on) => <button key={id} type="button" onClick={on} className={`px-3 py-2.5 text-14 font-semibold whitespace-nowrap border-b-2 -mb-px cursor-pointer ${id === 'overview' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-700 hover:text-slate-900'}`}>{label}</button>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-20 font-bold text-slate-900">Site Audit: <span className="text-indigo-600">{host(d.target)}</span></div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-13 text-slate-600">
            <span>{host(d.target)}</span><span>Updated: {updated}</span>
            <span className="inline-flex items-center gap-1">{d.strategy === 'desktop' ? <Monitor size={13} /> : <Smartphone size={13} />}{d.strategy === 'desktop' ? 'Desktop' : 'Mobile'}</span>
            <span>JS rendering: Disabled</span><span>Pages crawled: {d.pages}{d.limit ? `/${d.limit}` : ''}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="primary" icon={RefreshCw} busy={busy === 'rerun'} onClick={rerun}>Rerun campaign</Button><Button size="sm" icon={Printer} onClick={() => window.print()}>PDF</Button><Button size="sm" icon={ArrowLeft} onClick={onBack}>All projects</Button></div>
      </div>

      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tabId === id} onClick={() => setTabId(id)} className={`px-3 py-2.5 text-14 font-semibold whitespace-nowrap border-b-2 -mb-px cursor-pointer ${tabId === id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-700 hover:text-slate-900'}`}>{label}</button>)}
      </div>
      {error && <p className="text-12.5 text-rose-600">{error}</p>}
      {tabId !== 'overview' && (report.error ? <Card><p className="text-13 text-rose-600">{report.error.message}</p></Card> : !report.data ? <SkList rows={6} /> : (
        <>
          {tabId === 'issues' && <IssuesTab r={report.data} initial={initial} />}
          {tabId === 'pages' && <CrawledPagesTab r={report.data} />}
          {tabId === 'stats' && <StatisticsTab r={report.data} />}
          {tabId === 'compare' && <CompareTab r={report.data} />}
          {tabId === 'progress' && <ProgressTab r={report.data} />}
          {tabId === 'js' && <JsTab r={report.data} />}
        </>))}
      {toastNode}


      {tabId === 'overview' && <>
      <Card pad={false}>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 divide-y md:divide-y-0 xl:divide-x divide-slate-100">
          <Stat title="Site Health" hint="The audit's overall score from the crawl and Lighthouse"><Gauge v={d.health} change={diff('health')} /></Stat>
          <Stat title="AI Search Health" hint="The on-page facts answer engines rely on: title, description, one H1, structured data, canonical and crawl access" badge={d.ai != null && <Badge tone={d.ai >= 80 ? 'green' : d.ai >= 50 ? 'amber' : 'red'}>{d.ai >= 80 ? 'Good' : d.ai >= 50 ? 'Fair' : 'Poor'}</Badge>}>
            <Gauge v={d.ai} change={diff('ai')} />
          </Stat>
          <Stat title="Errors" hint="Issues that most hurt crawling, indexing and ranking">
            <div className="text-26 font-bold text-red-600 tabular-nums mt-2">{d.errors}</div>
            <div className="mt-3 pt-3 border-t border-slate-100"><div className="text-15 font-semibold text-slate-900">Warnings</div><div className="text-26 font-bold text-amber-600 tabular-nums mt-1">{d.warnings}</div></div>
          </Stat>
          <Stat title="Crawled Pages" hint="Pages the audit fetched">
            <div className="text-26 font-bold tabular-nums mt-2">{d.crawled}</div>
            <div className="text-13 text-slate-600 mt-2">Broken: <b>{d.broken}</b> &nbsp; Have issues: <b>{d.with_issues}</b></div>
            {bar.length > 0 && <div className="flex h-3 rounded overflow-hidden mt-2 bg-slate-100">{bar.map(([n, c], i) => n > 0 && <div key={i} style={{ width: `${n / d.crawled * 100}%`, background: c }} />)}</div>}
          </Stat>
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <div className="space-y-4">
          <Card title="Top Issues" action={<Button size="sm" onClick={() => setTabId('issues')}>View all</Button>} pad={false}>
            {d.top_issues.length ? (
              <table className="w-full text-13">
                <thead className="bg-slate-50 text-11.5 text-slate-500"><tr><th className="px-5 py-2 text-left font-semibold">Description</th><th className="px-5 py-2 text-right font-semibold">Issues</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{d.top_issues.slice(0, 5).map(g => { const [c, I] = KIND[g.kind]; return (
                  <tr key={g.code}><td className="px-5 py-3 flex gap-3"><I size={16} className="mt-0.5 shrink-0" style={{ color: c }} /><div><div className="font-semibold text-slate-900">{g.title}</div><div className="text-slate-600">{g.fix}</div></div></td><td className="px-5 py-3 text-right tabular-nums text-indigo-600 align-top">{g.count}</td></tr>); })}</tbody>
              </table>
            ) : <p className="px-5 py-8 text-center text-13 text-slate-500">No issues found.</p>}
          </Card>
          <Card title="Pages to Improve" action={<Button size="sm" onClick={() => setTabId('pages')}>View all</Button>} pad={false}>
            {d.pages_to_improve.length ? (
              <>
                <table className="w-full text-13">
                  <thead className="bg-slate-50 text-11.5 text-slate-500"><tr><th className="px-5 py-2 text-left font-semibold">Page</th><th className="px-5 py-2 text-right font-semibold">Issues</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">{d.pages_to_improve.slice(0, 5).map(r => (
                    <tr key={r.url}><td className="px-5 py-3"><a href={r.url} target="_blank" rel="noreferrer" className="font-semibold text-slate-900 hover:underline break-all">{path(r.url)}</a>
                      <div className="text-12 text-slate-600 mt-0.5">{r.items.slice(0, 4).map((x, i) => <span key={i} className="mr-3 whitespace-nowrap"><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: KIND[x.kind][0] }} />{x.title}</span>)}{r.items.length > 4 && `+${r.items.length - 4} more`}</div></td>
                      <td className="px-5 py-3 text-right tabular-nums text-indigo-600 align-top">{r.issues}</td></tr>))}</tbody>
                </table>
                <button type="button" onClick={() => setTabId('pages')} className="px-5 py-3 text-13 text-indigo-600 hover:underline cursor-pointer">View all crawled pages</button>
              </>
            ) : <p className="px-5 py-8 text-center text-13 text-slate-500">Every crawled page is clean.</p>}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Issue Trend" action={(
            <div className="flex flex-wrap items-center gap-2">
              <Pick label="Trend of" value={series} onChange={setSeries} options={[{ id: 'health', label: 'Site Health' }, { id: 'ai', label: 'AI Search Health' }]} />
              <label className="h-9 pl-3 pr-2 inline-flex items-center gap-2 rounded border border-slate-300 bg-white text-14 text-slate-800 hover:border-slate-400">
                <Calendar size={15} className="text-slate-600" />
                <select aria-label="Show the trend up to" value={upTo} onChange={e => setUpTo(e.target.value)} className="bg-transparent outline-none cursor-pointer appearance-none pr-1">
                  {days.map(x => <option key={x.iso} value={x.iso}>{x.label}</option>)}
                </select>
              </label>
            </div>
          )}>
            {shown.length ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={shown} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" vertical={false} />
                    <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis tick={AXIS} tickLine={false} axisLine={false} width={40} domain={[0, 100]} unit="%" allowDecimals={false} />
                    <Tooltip formatter={(v) => [v == null ? 'no data' : `${v}%`, series === 'ai' ? 'AI Search Health' : 'Site Health']} />
                    <Line type="monotone" dataKey={series} stroke="#6658dd" strokeWidth={2} dot={{ r: 4 }} connectNulls isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : <p className="py-8 text-center text-13 text-slate-500">{series === 'ai' ? 'AI Search Health appears once AI visibility checks have run.' : 'The trend draws as more audits are run.'}</p>}
          </Card>
          <Card title="Thematic Reports">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Theme title="Robots.txt" note={d.robots.blocks_all ? 'robots.txt blocks the whole site' : d.robots.found ? (d.previous ? 'No changes' : 'Found and not blocking crawlers') : 'No robots.txt found'} />
              <Theme title="Crawlability" value={d.crawlability} change={diff('crawlability')} />
              <Theme title="HTTPS" value={d.https} change={diff('https')} />
              <Theme title="International SEO" value={d.intl} note={d.intl == null ? 'International SEO is not implemented on this site.' : null} />
              <Theme title="Core Web Vitals" note={d.vitals ? `${d.vitals.pass} of ${d.vitals.of} pass · LCP ${d.vitals.lcp || '—'} · CLS ${d.vitals.cls || '—'} · TBT ${d.vitals.tbt || '—'}` : 'No Lighthouse data for this audit.'} />
              <Theme title="Site Performance" value={d.performance} change={diff('performance')} note={d.performance == null ? 'No Lighthouse data for this audit.' : null} />
              <Theme title="Internal Linking" value={d.linking} change={diff('linking')} />
              <Theme title="Markup" value={d.markups} note={d.markups == null ? "It seems that your website doesn't use any markup" : null} />
            </div>
          </Card>
        </div>
      </div>
      </>}
    </div>
  );
}
