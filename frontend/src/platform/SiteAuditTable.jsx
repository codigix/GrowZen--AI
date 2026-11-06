import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Sparkles, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Card, ErrorNote, useModulePath, useSeoBusiness, SkTable } from './SeoUi';
import { useApi } from './seoApi';
import SiteAuditOverview from './SiteAuditOverview';

/**
 * Site Audit overview: one row per project with its site health broken into the parameters an SEO tool
 * reports, and the change since the audit before. Data: GET /businesses/site-audit (services/site_health.py).
 * A "—" is a figure the stored audit cannot support yet (it fills in after the next audit), never a guess.
 */

const COLUMNS = [
  { key: 'site_health', label: 'Site health', tip: 'Average of the Lighthouse SEO score and the on-page crawl score' },
  { key: 'ai_search', label: 'AI search health', icon: Sparkles, tip: 'Share of AI answers (ChatGPT, Gemini…) that name the business' },
  { key: 'errors', label: 'Errors', count: true, tip: 'Critical and serious issues' },
  { key: 'warnings', label: 'Warnings', count: true, tip: 'Warning-level issues' },
  { key: 'crawlability', label: 'Crawlability', tip: 'Pages that load, can be indexed and show content, less a missing sitemap; 0 if robots.txt blocks all' },
  { key: 'https', label: 'HTTPS', tip: 'Crawled pages served over HTTPS' },
  { key: 'int_seo', label: 'Int. SEO', tip: 'Pages that declare their language (html lang)' },
  { key: 'performance', label: 'Site performance', tip: 'Lighthouse performance score' },
  { key: 'internal_linking', label: 'Internal linking', tip: 'Inner pages that other pages link to (not orphans) and that link onward' },
  { key: 'markups', label: 'Markups', tip: 'Pages with structured data (schema.org)' },
  { key: 'core_web_vitals', label: 'Core Web Vitals', tip: 'Lab LCP, CLS and TBT that pass Google’s “good” limits' }
];

// Where a click on each figure leads: the Overview, or the Issues tab filtered to what that figure measures
const GO = {
  site_health: { tab: 'overview' }, ai_search: { tab: 'overview' }, performance: { tab: 'overview' }, core_web_vitals: { tab: 'overview' },
  errors: { tab: 'issues', severity: 'error' }, warnings: { tab: 'issues', severity: 'warning' }, crawlability: { tab: 'issues', category: 'Crawlability' },
  https: { tab: 'issues', category: 'HTTPS' }, int_seo: { tab: 'issues', category: 'Meta tags' }, internal_linking: { tab: 'issues', category: 'Links' }, markups: { tab: 'issues', category: 'Markup' },
  pages_crawled: { tab: 'pages' }, last_update: { tab: 'progress' }, name: { tab: 'overview' }
};

const ago = (iso) => {
  if (!iso) return 'never';
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m || 1}m ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};
const tone = (v) => (v == null ? 'text-slate-400' : v >= 90 ? 'text-emerald-600' : v >= 50 ? 'text-amber-600' : 'text-red-500');

/** The figure with its change underneath: green when it improved, red when it got worse. */
function Metric({ m, count }) {
  if (!m || m.value == null) return <span className="text-slate-300">—</span>;
  const d = m.delta;
  const good = d == null || d === 0 ? null : count ? d < 0 : d > 0;
  return (
    <div className="text-right leading-tight">
      <div className={`text-14 font-semibold tabular-nums ${count ? (m.value ? 'text-slate-900' : 'text-emerald-600') : tone(m.value)}`}>{m.value}{count ? '' : '%'}</div>
      <div className={`text-12 tabular-nums ${good == null ? 'text-slate-400' : good ? 'text-emerald-600' : 'text-red-500'}`}>{d == null ? '' : d > 0 ? `+${d}` : d}{d == null ? '' : count ? '' : '%'}</div>
    </div>
  );
}

export default function SiteAuditTable({ onNew, onOverview, projectId }) { // projectId: show only that project's row
  const data = useApi('/businesses/site-audit');
  const [, choose] = useSeoBusiness();
  const navigate = useNavigate();
  const path = useModulePath();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ key: 'last_update', dir: -1 });
  const [size, setSize] = useState(10);
  const [page, setPage] = useState(1);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = (data.data || []).filter(r => (projectId == null || r.id === projectId) && (!term || `${r.name} ${r.domain || ''}`.toLowerCase().includes(term)));
    const val = (r) => (sort.key === 'last_update' ? r.last_update || '' : sort.key === 'pages_crawled' ? r.pages_crawled : sort.key === 'name' ? r.name.toLowerCase() : r.metrics[sort.key]?.value ?? -1);
    return [...list].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir);
  }, [data.data, q, sort, projectId]);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const shown = rows.slice((page - 1) * size, page * size);
  const open = (id) => { choose(id).then(ok => ok && navigate(`${path('website-audit')}?tab=report`)); };
  const [overviewOf, setOverviewOf] = useState(null); // {id, initial}: that project's audit Overview replaces the table until closed
  const go = (id, key) => { const initial = GO[key]; choose(id).then(ok => { if (!ok) return; if (onOverview) onOverview(id, initial); else setOverviewOf({ id, initial }); }); };
  const th = (key, label, extra = {}) => (
    <th key={key} className={`px-4 py-3 font-semibold whitespace-nowrap ${extra.right ? 'text-right' : 'text-left'}`} title={extra.tip}>
      <button type="button" onClick={() => { setSort(s => ({ key, dir: s.key === key ? -s.dir : -1 })); setPage(1); }} className="inline-flex items-center gap-1 cursor-pointer hover:text-slate-900">
        {extra.icon && <extra.icon size={13} className="text-violet-500" />}{label}{sort.key === key && (sort.dir < 0 ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
      </button>
    </th>
  );

  if (overviewOf) return <SiteAuditOverview key={`${overviewOf.id}-${overviewOf.initial?.tab}-${overviewOf.initial?.category || overviewOf.initial?.severity || ''}`} projectId={overviewOf.id} initial={overviewOf.initial} onBack={() => setOverviewOf(null)} />;
  return (
    <Card pad={false}>
      <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-3">
        <label className="relative w-full max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder="Project name or domain" aria-label="Search projects" className="w-full h-9 pl-9 pr-3 text-13 rounded bg-white border border-slate-200 focus:border-indigo-400 outline-none" />
        </label>
        {onNew && <button type="button" onClick={onNew} className="h-9 px-3.5 rounded inline-flex items-center gap-1.5 text-13 font-semibold bg-slate-900 text-white hover:bg-slate-800 cursor-pointer"><Plus size={14} /> Create project</button>}
      </div>
      <ErrorNote>{data.error?.message}</ErrorNote>
      {!data.data && !data.error ? <SkTable cols={['w-1/3', 'w-20', 'w-16', 'w-16', 'w-16', 'w-16']} headers={['Project', 'Last update', 'Pages crawled', ...COLUMNS.slice(0, 3).map(c => c.label)]} rows={6} /> : (
        <div className="overflow-x-auto border-t border-slate-100">
          <table className="w-full min-w-[1280px] text-13">
            <thead className="bg-slate-50 text-12 text-slate-500">
              <tr>
                {th('name', 'Project')}
                {th('last_update', 'Last update')}
                {th('pages_crawled', 'Pages crawled', { right: true })}
                {COLUMNS.map(c => th(c.key, c.label, { right: true, tip: c.tip, icon: c.icon }))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map(r => (
                <tr key={r.id} className="hover:bg-slate-50/70 align-top">
                  <td className="px-4 py-3 min-w-[210px]">
                    <button type="button" onClick={() => (r.last_update ? go(r.id, 'name') : open(r.id))} className="text-left cursor-pointer group">
                      <span className="block font-semibold text-indigo-600 group-hover:underline">{r.name}</span>
                      <span className="block text-12 text-slate-500">{r.domain || 'No website'}{r.market && <span className="ml-1.5 text-slate-400">· {r.market.scope}</span>}</span>
                    </button>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-700">{r.last_update ? <button type="button" onClick={() => go(r.id, 'last_update')} title="See how the audits progressed" className="cursor-pointer hover:text-indigo-600 hover:underline">{ago(r.last_update)}</button> : ago(r.last_update)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">{r.pages_crawled ? <button type="button" onClick={() => go(r.id, 'pages_crawled')} title="Open the crawled pages" className="cursor-pointer rounded px-1 hover:bg-indigo-50 hover:underline"><span className="text-14 font-semibold text-slate-900">{r.pages_crawled}</span><span className="text-slate-400"> pages</span></button> : <span className="text-slate-300">—</span>}</td>
                  {COLUMNS.map(c => <td key={c.key} className="px-4 py-3 whitespace-nowrap">{r.metrics[c.key]?.value != null
                    ? <button type="button" onClick={() => go(r.id, c.key)} title={`Open ${c.label.toLowerCase()} details`} className="block w-full cursor-pointer rounded hover:bg-indigo-50"><Metric m={r.metrics[c.key]} count={c.count} /></button>
                    : <Metric m={r.metrics[c.key]} count={c.count} />}</td>)}
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={COLUMNS.length + 3} className="px-5 py-12 text-center text-13 text-slate-500">{q ? 'No project matches.' : 'No projects yet.'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <div className="px-5 py-3 border-t border-slate-100 flex flex-wrap items-center gap-3 text-13 text-slate-600">
        <span>Page <b className="text-slate-900">{page}</b> of {pages}</span>
        <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="p-1.5 rounded border border-slate-200 disabled:opacity-40 cursor-pointer" aria-label="Previous page"><ChevronLeft size={14} /></button>
        <button type="button" disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="p-1.5 rounded border border-slate-200 disabled:opacity-40 cursor-pointer" aria-label="Next page"><ChevronRight size={14} /></button>
        <select value={size} onChange={e => { setSize(Number(e.target.value)); setPage(1); }} className="h-8 px-2 rounded border border-slate-200 bg-white text-13" aria-label="Rows per page">{[10, 25, 50].map(n => <option key={n} value={n}>{n}</option>)}</select>
        <span className="ml-auto text-11.5 text-slate-400">— = not measured yet; it fills in after the next audit</span>
      </div>
    </Card>
  );
}

