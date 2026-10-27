import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Play, CheckCircle2, XCircle, AlertTriangle, ChevronDown, ChevronRight, ExternalLink, Download, Search, Globe,
  FileText, ShieldCheck, Gauge, Loader2, ArrowUp, ArrowDown, ArrowUpDown, Info
} from 'lucide-react';
import { SeoShell, Card, Button, Badge, StatusPill, ScoreRing, ErrorNote, scoreWord, scoreLevel, useToast, useAction, useModulePath } from './SeoUi';
import { api, useApi, usePoll, fmtDateTime } from './seoApi';
import Improvements from './OnPageImprovements';

/**
 * Technical & on-page SEO for the selected business's website. Data comes from the business's
 * audits: `onpage` (the backend crawler: up to 25 pages, robots.txt, sitemap, per-page checks) and
 * `technical` (Google PageSpeed / Lighthouse: SEO checks, Core Web Vitals).
 */

const LEVELS = ['critical', 'serious', 'warning', 'info'];
const LEVEL_ORDER = { critical: 0, serious: 1, warning: 2, info: 3 };
const LEVEL_WORD = { critical: 'Critical', serious: 'Serious', warning: 'Warning', info: 'Info' };
const ACTIVE = ['queued', 'running'];

const pathOf = (u) => { try { const p = new URL(u); return (p.pathname || '/') + p.search; } catch (e) { return u; } };
const worst = (issues) => issues.reduce((w, i) => (LEVEL_ORDER[i.level] < LEVEL_ORDER[w] ? i.level : w), 'info');

/** The business's audits of one kind: history, the run in progress, and the newest finished result. */
function useAudits(businessId, kind) {
  const list = useApi(`/businesses/${businessId}/audits?kind=${kind}&limit=12`);
  const items = list.data || [];
  const latestDone = items.find(a => a.status === 'done');
  const detail = useApi(latestDone ? `/businesses/${businessId}/audits/${latestDone.id}` : null);
  return {
    list,
    items,
    newest: items[0],
    running: items.some(a => ACTIVE.includes(a.status)),
    done: detail.data,
    previous: items.filter(a => a.status === 'done')[1],
    reload: () => list.reload(true)
  };
}

/** Each check the crawler applies to a page, with the same thresholds as the backend. */
function pageChecks(p) {
  return [
    { id: 'status', label: 'Page loads', ok: p.status < 400, value: `HTTP ${p.status}`, target: '200 OK' },
    { id: 'js', label: 'Content visible without JavaScript', ok: !p.javascript_only, value: p.javascript_only ? 'Empty HTML shell' : 'Server-rendered', target: 'Text in the HTML' },
    { id: 'index', label: 'Indexable', ok: !p.noindex, value: p.noindex ? 'noindex' : 'Allowed', target: 'No noindex' },
    { id: 'title', label: 'Title length', ok: p.title_length >= 25 && p.title_length <= 60, value: p.title_length ? `${p.title_length} chars` : 'Missing', target: '25–60 chars' },
    { id: 'meta', label: 'Meta description', ok: p.meta_description_length > 0, value: p.meta_description_length ? `${p.meta_description_length} chars` : 'Missing', target: '150–160 chars' },
    { id: 'h1', label: 'One H1 heading', ok: p.h1_count === 1, value: `${p.h1_count} H1`, target: 'Exactly 1' },
    { id: 'words', label: 'Content depth', ok: p.word_count >= 300, value: `${p.word_count} words`, target: '300+ words' },
    { id: 'alt', label: 'Image alt text', ok: !p.images_missing_alt, value: p.images ? `${p.images - p.images_missing_alt}/${p.images} have alt` : 'No images', target: 'All images' },
    { id: 'viewport', label: 'Mobile viewport', ok: p.has_viewport, value: p.has_viewport ? 'Set' : 'Missing', target: 'width=device-width' },
    { id: 'canonical', label: 'Canonical URL', ok: Boolean(p.canonical), soft: true, value: p.canonical ? pathOf(p.canonical) : 'Not set', target: 'Recommended' },
    { id: 'schema', label: 'Structured data', ok: (p.schema_types || []).length > 0, soft: true, value: (p.schema_types || []).join(', ') || 'None', target: 'Recommended' },
    { id: 'links', label: 'Descriptive link text', ok: !p.generic_link_text, soft: true, value: p.generic_link_text ? `${p.generic_link_text} "click here"-style links` : 'Good', target: 'No generic text' }
  ];
}

const SEVERITY_TONE = { critical: 'text-red-700 bg-red-50 ring-red-200', serious: 'text-orange-700 bg-orange-50 ring-orange-200', warning: 'text-amber-700 bg-amber-50 ring-amber-200', info: 'text-slate-600 bg-slate-50 ring-slate-200' };

function Check({ ok, soft }) {
  if (ok) return <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />;
  return soft ? <AlertTriangle size={16} className="text-amber-500 shrink-0" /> : <XCircle size={16} className="text-red-600 shrink-0" />;
}

function ScoreTile({ label, score, sub, delta, error, stale, icon: Icon }) {
  return (
    <Card className="h-full">
      <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-slate-500 mb-3"><Icon size={13} /> {label}</div>
      <div className="flex items-center gap-4">
        {score == null
          ? <div className="w-[88px] h-[88px] rounded-full border-8 border-slate-100 flex items-center justify-center text-2xl font-bold text-slate-300 shrink-0">—</div>
          : <ScoreRing score={score} size={88} label="/ 100" />}
        <div className="min-w-0">
          {score != null && <div className="text-[16px] font-semibold text-slate-900">{scoreWord(score)}</div>}
          {delta != null && delta !== 0 && (
            <div className={`mt-0.5 inline-flex items-center gap-0.5 text-[12px] font-semibold ${delta > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
              {delta > 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />} {Math.abs(delta)} since last audit
            </div>
          )}
          {error ? <div className="mt-1 text-[12px] text-red-700 line-clamp-3" title={error}>{error}</div> : sub && <div className="mt-1 text-[12px] text-slate-500">{sub}</div>}
          {stale && <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-amber-800 bg-amber-50 ring-1 ring-inset ring-amber-200 rounded-md px-2 py-1 cursor-help" title={stale}><AlertTriangle size={11} /> Latest run failed · showing previous</div>}
        </div>
      </div>
    </Card>
  );
}

function Trend({ items }) {
  const points = items.filter(a => a.status === 'done' && a.score != null).slice(0, 8).reverse();
  if (points.length < 2) return <div className="text-[12px] text-slate-500">The trend appears after two audits.</div>;
  return (
    <div className="flex items-end gap-1.5 h-14" aria-label="On-page score over the last audits">
      {points.map(a => (
        <div key={a.id} className="flex-1 flex flex-col items-center justify-end h-full" title={`${a.score} · ${fmtDateTime(a.finished_at)}`}>
          <div className={`w-full rounded-t ${scoreLevel(a.score) === 'good' ? 'bg-emerald-500' : scoreLevel(a.score) === 'warning' ? 'bg-amber-400' : 'bg-red-400'}`} style={{ height: `${Math.max(6, a.score)}%` }} />
        </div>
      ))}
    </div>
  );
}

function Foundations({ crawl, pages, technical }) {
  const localSchema = pages.some(p => (p.schema_types || []).some(t => /LocalBusiness|Dentist|Clinic|Hospital|Restaurant|Store|Physician|MedicalBusiness/i.test(t)));
  const titles = pages.map(p => p.title).filter(Boolean);
  const dupes = new Set(titles.filter((t, i) => titles.indexOf(t) !== i)).size;
  const items = [
    { label: 'Served over HTTPS', ok: crawl.https, why: 'Browsers flag HTTP sites as "Not secure".' },
    { label: 'robots.txt found', ok: crawl.robots_txt, soft: true, why: 'Tells crawlers what to skip and where the sitemap is.' },
    { label: 'Crawlers allowed', ok: !crawl.robots_blocks_all, why: 'robots.txt must not block the whole site.' },
    { label: 'XML sitemap', ok: crawl.sitemap, why: 'Helps Google find every page; submit it in Search Console.' },
    { label: 'LocalBusiness schema', ok: localSchema, why: 'Structured data that ties the site to the Google profile.' },
    { label: 'Mobile viewport on every page', ok: pages.every(p => p.has_viewport), why: `${pages.filter(p => !p.has_viewport).length} page(s) missing it.` },
    { label: 'No broken pages', ok: !(crawl.broken || []).length, why: `${(crawl.broken || []).length} broken URL(s) found while crawling.` },
    { label: 'All pages indexable', ok: !pages.some(p => p.noindex), why: `${pages.filter(p => p.noindex).length} page(s) set to noindex.` },
    { label: 'Unique page titles', ok: !dupes, why: `${dupes} title(s) used on more than one page.` }
  ];
  const vitals = technical?.metrics || {};
  return (
    <div className="space-y-4">
      <Card title="Site foundations" subtitle={`${items.filter(i => i.ok).length} of ${items.length} in place`}>
        <ul className="space-y-2.5">
          {items.map(i => (
            <li key={i.label} className="flex items-start gap-2.5">
              <Check ok={i.ok} soft={i.soft} />
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-slate-900">{i.label}</div>
                {!i.ok && <div className="text-[12px] text-slate-500">{i.why}</div>}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      {technical && (
        <Card title="Speed & Core Web Vitals" subtitle={`Google Lighthouse · ${technical.strategy || 'mobile'}`}>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {[['performance', 'Performance'], ['seo', 'SEO'], ['accessibility', 'Accessibility'], ['best_practices', 'Best practices']].map(([k, l]) => {
              const v = technical.scores?.[k];
              return (
                <div key={k} className="rounded-xl bg-slate-50 ring-1 ring-inset ring-slate-200 px-3 py-2">
                  <div className="text-[11px] text-slate-500">{l}</div>
                  <div className={`text-lg font-bold tabular-nums ${v == null ? 'text-slate-300' : v >= 90 ? 'text-emerald-700' : v >= 50 ? 'text-amber-700' : 'text-red-600'}`}>{v ?? '—'}</div>
                </div>
              );
            })}
          </div>
          <div className="divide-y divide-slate-100 text-[13px]">
            {[['lcp', 'Largest Contentful Paint'], ['cls', 'Cumulative Layout Shift'], ['tbt', 'Total Blocking Time'], ['fcp', 'First Contentful Paint'], ['si', 'Speed Index']].map(([k, l]) => (
              <div key={k} className="flex justify-between gap-2 py-1.5"><span className="text-slate-600">{l}</span><span className="font-semibold tabular-nums text-slate-900">{vitals[k] || '—'}</span></div>
            ))}
          </div>
          {Object.values(technical.field || {}).some(Boolean) && (
            <div className="mt-3 pt-3 border-t border-slate-100 text-[12px] text-slate-600">
              Real users (Chrome UX Report): {Object.entries(technical.field).filter(([, v]) => v).map(([k, v]) => `${k.toUpperCase()} ${v.toLowerCase()}`).join(' · ')}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

const COLUMNS = [
  ['path', 'Page'], ['issues', 'Issues'], ['title_length', 'Title'], ['meta_description_length', 'Meta'], ['h1_count', 'H1'], ['word_count', 'Words'], ['images_missing_alt', 'No alt'], ['schema', 'Schema']
];

function PagesCard({ pages, siteIssues }) {
  const [query, setQuery] = useState('');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [sort, setSort] = useState({ key: 'issues', dir: -1 });
  const [open, setOpen] = useState(null);
  const [toast, toastNode] = useToast();

  // Pages audited before per-page issues were stored: match the page's path in the issue titles.
  const rows = useMemo(() => pages.map(p => {
    const path = pathOf(p.url);
    const issues = p.issues || siteIssues.filter(i => i.title.startsWith(`${path} `) || i.title.startsWith(`${path}:`));
    return { ...p, path, issues, schema: (p.schema_types || []).length };
  }), [pages, siteIssues]);

  const shown = rows
    .filter(r => (!onlyIssues || r.issues.length) && (!query || `${r.path} ${r.title}`.toLowerCase().includes(query.toLowerCase())))
    .sort((a, b) => {
      const va = sort.key === 'issues' ? a.issues.length * 10 + (3 - LEVEL_ORDER[worst(a.issues)]) : a[sort.key];
      const vb = sort.key === 'issues' ? b.issues.length * 10 + (3 - LEVEL_ORDER[worst(b.issues)]) : b[sort.key];
      return (typeof va === 'string' ? va.localeCompare(vb) : (va ?? 0) - (vb ?? 0)) * sort.dir;
    });

  const exportCsv = () => {
    const head = ['URL', 'HTTP status', 'Title', 'Title length', 'Meta description length', 'H1 count', 'Words', 'Images', 'Images without alt', 'Canonical', 'Noindex', 'Schema types', 'Issues'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [head, ...rows.map(r => [r.url, r.status, r.title, r.title_length, r.meta_description_length, r.h1_count, r.word_count, r.images, r.images_missing_alt, r.canonical, r.noindex ? 'yes' : 'no', (r.schema_types || []).join(' '), r.issues.map(i => i.title).join('; ')])].map(l => l.map(esc).join(','));
    const href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    Object.assign(document.createElement('a'), { href, download: 'on-page-seo-pages.csv' }).click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    toast('Page report downloaded');
  };

  const sortBy = (key) => setSort(s => ({ key, dir: s.key === key ? -s.dir : key === 'path' ? 1 : -1 }));
  const bad = (ok) => (ok ? 'text-slate-700' : 'text-red-600 font-semibold');

  return (
    <Card title={`Pages (${rows.length})`} subtitle="Every page the crawler checked. Click a row for all of its checks." pad={false}
      action={<Button size="sm" icon={Download} onClick={exportCsv} disabled={!rows.length}>Export CSV</Button>}>
      <div className="px-6 py-3 flex flex-wrap items-center gap-2 border-b border-slate-100">
        <label className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search URL or title" className="w-full h-8 pl-8 pr-3 text-[13px] rounded-lg bg-white ring-1 ring-inset ring-slate-200 focus:ring-indigo-400 outline-none text-slate-900 placeholder-slate-400" />
        </label>
        <label className="flex items-center gap-2 text-[12px] font-medium text-slate-700 cursor-pointer select-none">
          <input type="checkbox" checked={onlyIssues} onChange={e => setOnlyIssues(e.target.checked)} className="accent-indigo-600" /> Only pages with issues
        </label>
        <span className="ml-auto text-[12px] text-slate-500">{shown.length} shown</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="w-8" />
              {COLUMNS.map(([key, label]) => (
                <th key={key} className={`px-3 py-2.5 font-semibold ${key === 'path' ? 'text-left' : 'text-right'}`}>
                  <button onClick={() => sortBy(key)} className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-slate-900 cursor-pointer">
                    {label}{sort.key === key ? (sort.dir > 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : <ArrowUpDown size={11} className="opacity-40" />}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map(r => {
              const isOpen = open === r.url;
              return (
                <React.Fragment key={r.url}>
                  <tr onClick={() => setOpen(isOpen ? null : r.url)} className={`cursor-pointer ${isOpen ? 'bg-indigo-50/50' : 'hover:bg-slate-50'}`}>
                    <td className="pl-4 text-slate-400">{isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
                    <td className="px-3 py-2.5 max-w-[340px]">
                      <div className="font-mono text-[12px] text-slate-900 truncate" title={r.url}>{r.path}</div>
                      <div className="text-[12px] text-slate-500 truncate">{r.title || <span className="text-red-600">No title</span>}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {r.status >= 400 ? <Badge tone="red">HTTP {r.status}</Badge>
                        : r.issues.length ? <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ring-1 ring-inset ${SEVERITY_TONE[worst(r.issues)]}`}>{r.issues.length}</span>
                          : <CheckCircle2 size={16} className="inline text-emerald-600" />}
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${bad(r.title_length >= 25 && r.title_length <= 60)}`}>{r.title_length || '—'}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${bad(r.meta_description_length > 0)}`}>{r.meta_description_length || '—'}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${bad(r.h1_count === 1)}`}>{r.h1_count}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${bad(r.word_count >= 300)}`}>{r.word_count}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${bad(!r.images_missing_alt)}`}>{r.images_missing_alt}</td>
                    <td className="px-3 py-2.5 text-right">{r.schema ? <span className="text-[12px] text-slate-700">{r.schema_types.length}</span> : <span className="text-slate-300">—</span>}</td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-slate-50/60">
                      <td />
                      <td colSpan={COLUMNS.length} className="px-3 pt-2 pb-4">
                        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                          <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {pageChecks(r).map(c => (
                              <div key={c.id} className="flex items-start gap-2 rounded-lg bg-white ring-1 ring-inset ring-slate-200 px-3 py-2">
                                <Check ok={c.ok} soft={c.soft} />
                                <div className="min-w-0">
                                  <div className="text-[12px] font-semibold text-slate-900">{c.label}</div>
                                  <div className="text-[12px] text-slate-600 truncate" title={c.value}>{c.value} <span className="text-slate-400">· {c.target}</span></div>
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="lg:col-span-2">
                            <div className="text-[12px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">What to fix on this page</div>
                            {r.issues.length ? (
                              <ul className="space-y-2">
                                {[...r.issues].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]).map((i, n) => (
                                  <li key={n} className="rounded-lg bg-white ring-1 ring-inset ring-slate-200 px-3 py-2">
                                    <div className="flex items-center gap-2"><span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ring-1 ring-inset ${SEVERITY_TONE[i.level]}`}>{i.level}</span><span className="text-[12px] font-medium text-slate-900">{i.title}</span></div>
                                    <div className="text-[12px] text-slate-500 mt-1">{i.fix}</div>
                                  </li>
                                ))}
                              </ul>
                            ) : <div className="text-[12px] text-emerald-700 flex items-center gap-1.5"><CheckCircle2 size={14} /> Nothing to fix on this page.</div>}
                            <a href={r.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-indigo-700 hover:underline">Open page <ExternalLink size={12} /></a>
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
        {!shown.length && <div className="py-10 text-center text-[13px] text-slate-500">{rows.length ? 'No pages match.' : 'No pages were crawled.'}</div>}
      </div>
      {toastNode}
    </Card>
  );
}

function GoogleChecks({ technical }) {
  const [showPassed, setShowPassed] = useState(false);
  const checks = technical?.seo_checks || [];
  if (!checks.length) return null;
  const failed = checks.filter(c => c.status === 'fail');
  const manual = checks.filter(c => c.status === 'manual');
  const passed = checks.filter(c => c.status === 'pass');
  return (
    <Card title="Google's SEO checks" subtitle={`Lighthouse · ${passed.length} passed, ${failed.length} failed`}
      action={passed.length > 0 && <button onClick={() => setShowPassed(s => !s)} className="text-[12px] font-medium text-indigo-700 hover:underline cursor-pointer">{showPassed ? 'Hide' : 'Show'} passed</button>}>
      <div className="divide-y divide-slate-100">
        {[...failed, ...manual, ...(showPassed ? passed : [])].map(c => (
          <div key={c.id} className="flex items-start gap-2.5 py-2.5">
            {c.status === 'pass' ? <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" /> : c.status === 'manual' ? <Info size={16} className="text-slate-400 shrink-0 mt-0.5" /> : <XCircle size={16} className="text-red-600 shrink-0 mt-0.5" />}
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-slate-900">{c.title}{c.display_value ? <span className="text-slate-500 font-normal"> · {c.display_value}</span> : null}</div>
              {c.status !== 'pass' && c.description && <div className="text-[12px] text-slate-500 mt-0.5">{c.description}</div>}
            </div>
          </div>
        ))}
        {!failed.length && !manual.length && !showPassed && <div className="py-3 text-[13px] text-emerald-700 flex items-center gap-1.5"><CheckCircle2 size={15} /> Every automatic check passed.</div>}
      </div>
      {technical.opportunities?.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="text-[12px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Speed opportunities</div>
          {technical.opportunities.map(o => <div key={o.title} className="flex justify-between gap-3 text-[13px] py-1"><span className="text-slate-700">{o.title}</span><span className="text-slate-500 tabular-nums shrink-0">−{(o.savings_ms / 1000).toFixed(1)} s</span></div>)}
        </div>
      )}
    </Card>
  );
}

function OnPageSeo({ b }) {
  const onpage = useAudits(b.id, 'onpage');
  const tech = useAudits(b.id, 'technical');
  const [startedAfter, setStartedAfter] = useState(null); // newest audit id when a run was requested
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const path = useModulePath();

  // A run counts as finished once both kinds have a newer audit that is no longer queued/running.
  const settled = (a) => a && a.id > startedAfter && !ACTIVE.includes(a.status);
  const waiting = startedAfter !== null && !(settled(onpage.newest) && settled(tech.newest));
  const running = waiting || onpage.running || tech.running;
  usePoll(() => { onpage.reload(); tech.reload(); }, running, 3000);
  useEffect(() => { if (startedAfter !== null && !running) setStartedAfter(null); }, [startedAfter, running]);

  const start = () => run('run', async () => {
    setStartedAfter(Math.max(onpage.newest?.id || 0, tech.newest?.id || 0));
    await api(`/businesses/${b.id}/audits`, { method: 'POST', body: { kinds: ['technical', 'onpage'] } });
    toast('Audit started: crawling the site and running Google Lighthouse');
    setTimeout(() => { onpage.reload(); tech.reload(); }, 1200);
  });

  const o = onpage.done;
  const t = tech.done;
  const crawl = o?.result || {};
  const pages = crawl.pages || [];
  const issues = useMemo(() => [...(o?.issues || []), ...(t?.issues || [])].sort((x, y) => (LEVEL_ORDER[x.level] ?? 9) - (LEVEL_ORDER[y.level] ?? 9)), [o, t]);
  const counts = Object.fromEntries(LEVELS.map(l => [l, issues.filter(i => i.level === l).length]));
  const techFailed = tech.newest?.status === 'failed' ? tech.newest.error : null;
  const onpageFailed = onpage.newest?.status === 'failed' ? onpage.newest.error : null;

  const runButton = <Button variant="primary" icon={running ? undefined : Play} busy={busy === 'run' || running} onClick={start}>{running ? 'Auditing…' : o ? 'Re-audit site' : 'Run first audit'}</Button>;

  if (!b.website) {
    return (
      <Card>
        <div className="py-12 text-center max-w-md mx-auto">
          <Globe size={30} className="mx-auto text-slate-400" />
          <div className="mt-3 text-[15px] font-semibold text-slate-900">No website on file for {b.name}</div>
          <p className="mt-1 text-[13px] text-slate-500">Add the website in GBP Manager → Profile, or build one with the Website Builder. Then audit it here.</p>
          <div className="mt-4 flex justify-center gap-2">
            <Link to={path('gmb-profile')} className="h-9 px-4 inline-flex items-center rounded-xl text-[13px] font-semibold bg-white ring-1 ring-slate-200 text-slate-800 hover:bg-slate-50">Open GBP Manager</Link>
            <Link to={path('website-builder')} className="h-9 px-4 inline-flex items-center rounded-xl text-[13px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700">Website Builder</Link>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* Site bar */}
      <Card>
        <div className="flex flex-wrap items-center gap-4 justify-between">
          <div className="min-w-0 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 ring-1 ring-inset ring-indigo-100 flex items-center justify-center text-indigo-600 shrink-0"><Globe size={18} /></div>
            <div className="min-w-0">
              <a href={b.website} target="_blank" rel="noreferrer" className="text-[15px] font-semibold text-slate-900 hover:text-indigo-700 inline-flex items-center gap-1.5 truncate">{b.website} <ExternalLink size={13} className="text-slate-400" /></a>
              <div className="text-[12px] text-slate-500">
                {running ? <span className="inline-flex items-center gap-1.5 text-indigo-700"><Loader2 size={12} className="animate-spin" /> Crawling up to 25 pages and running Google Lighthouse. This takes 1–2 minutes.</span>
                  : o ? `Last audited ${fmtDateTime(o.finished_at)} · ${pages.length} page${pages.length === 1 ? '' : 's'} crawled` : 'Not audited yet'}
              </div>
            </div>
          </div>
          {runButton}
        </div>
        <ErrorNote>{error}</ErrorNote>
        {onpageFailed && !running && <div className="mt-3"><ErrorNote>The last crawl failed: {onpageFailed}</ErrorNote></div>}
      </Card>

      {!o && !onpage.list.loading && !running ? (
        <Card>
          <div className="py-12 text-center max-w-lg mx-auto">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 ring-1 ring-inset ring-indigo-100 flex items-center justify-center text-indigo-600 mx-auto"><ShieldCheck size={22} /></div>
            <div className="mt-3 text-[16px] font-semibold text-slate-900">Audit {b.name}'s website</div>
            <p className="mt-1 text-[13px] text-slate-500">The crawler checks every page for titles, meta descriptions, headings, content depth, image alt text, structured data, indexing and broken links. Google Lighthouse adds its SEO checks and Core Web Vitals.</p>
            <div className="mt-4">{runButton}</div>
          </div>
        </Card>
      ) : !o ? (
        <Card><div className="py-16 flex items-center justify-center gap-2 text-[13px] text-slate-500"><Loader2 size={16} className="animate-spin" /> Loading the latest audit…</div></Card>
      ) : (
        <>
          {/* Health summary */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <ScoreTile label="On-page score" icon={FileText} score={o.score} delta={onpage.previous ? o.score - onpage.previous.score : null} sub={`${pages.length} page${pages.length === 1 ? '' : 's'} checked`} />
            <ScoreTile label="Technical score" icon={Gauge} score={t?.score ?? null} delta={t && tech.previous ? t.score - tech.previous.score : null} error={!t ? techFailed || 'No Lighthouse result yet.' : null} stale={t ? techFailed : null} sub="Google Lighthouse average" />
            <Card className="h-full">
              <div className="text-[12px] font-semibold uppercase tracking-wider text-slate-500">Issues by severity</div>
              <div className="mt-3 space-y-2">
                {LEVELS.map(l => (
                  <div key={l} className="flex items-center gap-2">
                    <span className="w-20"><StatusPill level={l === 'info' ? 'info' : l}>{LEVEL_WORD[l]}</StatusPill></span>
                    <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div className={`h-full rounded-full ${l === 'critical' ? 'bg-red-500' : l === 'serious' ? 'bg-orange-500' : l === 'warning' ? 'bg-amber-400' : 'bg-slate-300'}`} style={{ width: `${issues.length ? (counts[l] / issues.length) * 100 : 0}%` }} />
                    </div>
                    <span className="w-7 text-right text-[13px] font-semibold tabular-nums text-slate-900">{counts[l]}</span>
                  </div>
                ))}
              </div>
            </Card>
            <Card className="h-full">
              <div className="text-[12px] font-semibold uppercase tracking-wider text-slate-500">On-page score trend</div>
              <div className="mt-3"><Trend items={onpage.items} /></div>
              <div className="mt-2 text-[12px] text-slate-500">{onpage.items.filter(a => a.status === 'done').length} audits so far{(crawl.broken || []).length ? ` · ${crawl.broken.length} broken URL(s)` : ''}</div>
            </Card>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            <div className="xl:col-span-2 space-y-5">
              <Improvements issues={issues} pages={pages} business={b} score={o.score} technical={t?.result} onRecheck={start} rechecking={busy === 'run' || running} />
              <GoogleChecks technical={t?.result} />
            </div>
            <Foundations crawl={crawl} pages={pages} technical={t?.result} />
          </div>

          <PagesCard pages={pages} siteIssues={o.issues || []} />
        </>
      )}
      {toastNode}
    </div>
  );
}

export default function OnPageSeoPage() {
  return (
    <SeoShell title="Technical & On-Page SEO" subtitle="Crawl the business's website, find what holds rankings back, and fix it page by page.">
      {(b) => <OnPageSeo key={b.id} b={b} />}
    </SeoShell>
  );
}
