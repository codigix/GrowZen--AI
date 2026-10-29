import React, { useMemo, useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, ChevronDown, ChevronRight, ExternalLink, Download, Search, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { Card, Button, Badge, useToast } from './SeoUi';
import { pathOf, LEVEL_ORDER, SEVERITY_TONE } from './siteUtils';

/** Every crawled page with its checks: sortable, searchable, expandable rows, CSV export. */

const worst = (issues) => issues.reduce((w, i) => (LEVEL_ORDER[i.level] < LEVEL_ORDER[w] ? i.level : w), 'info');

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


function Check({ ok, soft }) {
  if (ok) return <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />;
  return soft ? <AlertTriangle size={16} className="text-amber-500 shrink-0" /> : <XCircle size={16} className="text-red-600 shrink-0" />;
}

const COLUMNS = [
  ['path', 'Page'], ['issues', 'Issues'], ['title_length', 'Title'], ['meta_description_length', 'Meta'], ['h1_count', 'H1'], ['word_count', 'Words'], ['images_missing_alt', 'No alt'], ['schema', 'Schema']
];

export function PagesCard({ pages, siteIssues }) {
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
    Object.assign(document.createElement('a'), { href, download: 'site-pages.csv' }).click();
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
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search URL or title" className="w-full h-8 pl-8 pr-3 text-13 rounded-lg bg-white ring-1 ring-inset ring-slate-200 focus:ring-indigo-400 outline-none text-slate-900 placeholder-slate-400" />
        </label>
        <label className="flex items-center gap-2 text-12 font-medium text-slate-700 cursor-pointer select-none">
          <input type="checkbox" checked={onlyIssues} onChange={e => setOnlyIssues(e.target.checked)} className="accent-indigo-600" /> Only pages with issues
        </label>
        <span className="ml-auto text-12 text-slate-500">{shown.length} shown</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-13">
          <thead className="bg-slate-50 text-11 uppercase tracking-wider text-slate-500">
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
                      <div className="font-mono text-12 text-slate-900 truncate" title={r.url}>{r.path}</div>
                      <div className="text-12 text-slate-500 truncate">{r.title || <span className="text-red-600">No title</span>}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {r.status >= 400 ? <Badge tone="red">HTTP {r.status}</Badge>
                        : r.issues.length ? <span className={`text-11 font-bold px-2 py-0.5 rounded-full ring-1 ring-inset ${SEVERITY_TONE[worst(r.issues)]}`}>{r.issues.length}</span>
                          : <CheckCircle2 size={16} className="inline text-emerald-600" />}
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${bad(r.title_length >= 25 && r.title_length <= 60)}`}>{r.title_length || '—'}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${bad(r.meta_description_length > 0)}`}>{r.meta_description_length || '—'}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${bad(r.h1_count === 1)}`}>{r.h1_count}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${bad(r.word_count >= 300)}`}>{r.word_count}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${bad(!r.images_missing_alt)}`}>{r.images_missing_alt}</td>
                    <td className="px-3 py-2.5 text-right">{r.schema ? <span className="text-12 text-slate-700">{r.schema_types.length}</span> : <span className="text-slate-300">—</span>}</td>
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
                                  <div className="text-12 font-semibold text-slate-900">{c.label}</div>
                                  <div className="text-12 text-slate-600 truncate" title={c.value}>{c.value} <span className="text-slate-400">· {c.target}</span></div>
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="lg:col-span-2">
                            <div className="text-12 font-semibold uppercase tracking-wider text-slate-500 mb-1.5">What to fix on this page</div>
                            {r.issues.length ? (
                              <ul className="space-y-2">
                                {[...r.issues].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]).map((i, n) => (
                                  <li key={n} className="rounded-lg bg-white ring-1 ring-inset ring-slate-200 px-3 py-2">
                                    <div className="flex items-center gap-2"><span className={`text-10 font-bold uppercase px-1.5 py-0.5 rounded ring-1 ring-inset ${SEVERITY_TONE[i.level]}`}>{i.level}</span><span className="text-12 font-medium text-slate-900">{i.title}</span></div>
                                    <div className="text-12 text-slate-500 mt-1">{i.fix}</div>
                                  </li>
                                ))}
                              </ul>
                            ) : <div className="text-12 text-emerald-700 flex items-center gap-1.5"><CheckCircle2 size={14} /> Nothing to fix on this page.</div>}
                            <a href={r.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="mt-3 inline-flex items-center gap-1 text-12 font-medium text-indigo-700 hover:underline">Open page <ExternalLink size={12} /></a>
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
        {!shown.length && <div className="py-10 text-center text-13 text-slate-500">{rows.length ? 'No pages match.' : 'No pages were crawled.'}</div>}
      </div>
      {toastNode}
    </Card>
  );
}
