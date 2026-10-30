import React, { useEffect, useMemo, useState } from 'react';
import { Download, Loader2, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, XCircle, Gauge, Play, Info } from 'lucide-react';
import { Card, Button, Tabs, ErrorNote, useToast, useAction } from './SeoUi';
import { api, useApi, usePoll } from './seoApi';
import { pathOf, hostOf } from './siteUtils';

/**
 * The full Google Lighthouse report inside the audit report: every category's audits (failed,
 * opportunities, diagnostics, manual, passed) with affected items, the original HTML/JSON downloads,
 * and Lighthouse for any other crawled page. Data comes from /lighthouse/audits/{id}: the scan links
 * the Lighthouse audit it ran; other pages are run on demand.
 */

const CATEGORIES = [
  ['performance', 'Performance', 'performance'],
  ['accessibility', 'Accessibility', 'accessibility'],
  ['best-practices', 'Best practices', 'best_practices'],
  ['seo', 'SEO', 'seo']
];
const BUCKETS = [
  ['failed', 'Failed'],
  ['opportunities', 'Opportunities'],
  ['diagnostics', 'Diagnostics'],
  ['manual', 'Check by hand'],
  ['informational', 'Informational'],
  ['passed', 'Passed']
];
const ACTIVE = ['queued', 'running'];
const plain = (md) => String(md || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`/g, '');
const ms = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
const kb = (v) => `${Math.round(v / 1024)} KiB`;
const itemText = (it) => it?.url || it?.node?.snippet || it?.source?.url || it?.label || it?.groupLabel || it?.entity || JSON.stringify(it).slice(0, 160);
const scoreTone = (s) => (s == null ? 'text-slate-400' : s >= 90 ? 'text-emerald-700' : s >= 50 ? 'text-amber-700' : 'text-red-600');

function AuditRow({ a }) {
  const [open, setOpen] = useState(false);
  const savings = [a.savings_ms ? `−${ms(a.savings_ms)}` : null, a.savings_bytes ? `−${kb(a.savings_bytes)}` : null].filter(Boolean).join(' · ');
  const icon = a.score === 1
    ? <CheckCircle2 size={15} className="text-emerald-600 shrink-0 mt-0.5" />
    : a.score_display_mode === 'manual' || a.score == null
      ? <Info size={15} className="text-slate-400 shrink-0 mt-0.5" />
      : a.score >= 0.5
        ? <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />
        : <XCircle size={15} className="text-red-600 shrink-0 mt-0.5" />;
  return (
    <div className="py-2.5">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-start gap-2.5 text-left cursor-pointer group">
        {icon}
        <span className="flex-1 min-w-0 text-13 text-slate-900 group-hover:text-indigo-700">
          {a.title}{a.display_value ? <span className="text-slate-500 text-12"> · {a.display_value}</span> : null}
        </span>
        {savings && <span className="text-12 text-emerald-700 font-semibold shrink-0 tabular-nums">{savings}</span>}
        {open ? <ChevronDown size={14} className="text-slate-400 shrink-0 mt-0.5" /> : <ChevronRight size={14} className="text-slate-400 shrink-0 mt-0.5" />}
      </button>
      {open && (
        <div className="ml-6 mt-2 space-y-2">
          <p className="text-12 text-slate-600 leading-relaxed">{plain(a.description)}</p>
          {a.items?.length > 0 && (
            <ul className="text-11 font-mono text-slate-700 bg-slate-50 ring-1 ring-inset ring-slate-200 rounded p-3 space-y-1 max-h-48 overflow-auto">
              {a.items.map((it, n) => <li key={n} className="truncate" title={itemText(it)}>{itemText(it)}</li>)}
              {a.item_count > a.items.length && <li className="text-slate-500">…and {a.item_count - a.items.length} more (full list in the JSON report)</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function CategoryAudits({ report }) {
  const metricIds = useMemo(() => new Set(Object.keys(report?.metrics || {})), [report]);
  const by = useMemo(() => Object.fromEntries(Object.entries(report?.audits_by_category || {}).map(([c, buckets]) => [c,
    Object.fromEntries(Object.entries(buckets).map(([b, list]) => [b, list.filter(a => !metricIds.has(a.id))]))])), [report, metricIds]);
  const toFix = (c) => ['failed', 'opportunities', 'diagnostics'].reduce((n, b) => n + (by[c]?.[b]?.length || 0), 0);
  const first = CATEGORIES.find(([id]) => toFix(id))?.[0] || 'performance';
  const [cat, setCat] = useState(first);
  const [showPassed, setShowPassed] = useState(false);
  const buckets = by[cat] || {};
  return (
    <div>
      <Tabs value={cat} onChange={setCat} tabs={CATEGORIES.filter(([id]) => by[id]).map(([id, label]) => ({ id, label, count: toFix(id) }))} />
      <div className="space-y-4 mt-4">
        {BUCKETS.filter(([b]) => b !== 'passed' || showPassed).map(([b, label]) => (buckets[b]?.length ? (
          <div key={b}>
            <div className="text-11 uppercase tracking-wider text-slate-500 font-semibold mb-1">{label} ({buckets[b].length})</div>
            <div className="divide-y divide-slate-100">{buckets[b].map(a => <AuditRow key={a.id} a={a} />)}</div>
          </div>
        ) : null))}
        {toFix(cat) === 0 && <div className="text-13 text-emerald-700 flex items-center gap-1.5"><CheckCircle2 size={14} /> Nothing to fix in this category.</div>}
        {buckets.passed?.length > 0 && (
          <button type="button" onClick={() => setShowPassed(s => !s)} className="text-12 font-semibold text-indigo-700 hover:underline cursor-pointer">
            {showPassed ? 'Hide' : 'Show'} {buckets.passed.length} passed audits
          </button>
        )}
      </div>
    </div>
  );
}

export default function LighthouseDetails({ auditId, target, pages = [], strategy = 'mobile', fallbackReason }) {
  const [toast, toastNode] = useToast();
  const [busy, error, run] = useAction();
  const [byUrl, setByUrl] = useState(() => (auditId ? { [target]: auditId } : {}));
  const [url, setUrl] = useState(target);
  useEffect(() => { setByUrl(auditId ? { [target]: auditId } : {}); setUrl(target); }, [auditId, target]);
  const id = byUrl[url];

  const summary = useApi(id ? `/lighthouse/audits/${id}` : null);
  // Only data for the selected page's audit (useApi keeps the last response while a new one loads).
  const s = id && summary.data?.id === id ? summary.data : null;
  const running = Boolean(s && ACTIVE.includes(s.status));
  usePoll(() => summary.reload(true), running, 2500);
  const full = useApi(s && !running && s.status === 'completed' ? `/lighthouse/audits/${id}/report?v=${s.status}` : null);
  const r = s && full.data?.id === id ? full.data : null;

  const choices = [...new Set([target, ...pages.filter(p => p.status < 400 && !p.noindex).map(p => p.url)])].slice(0, 50);
  const runFor = () => run('run', async () => {
    const res = await api('/lighthouse/audits', { method: 'POST', body: { url, strategy, engine: 'pagespeed' } });
    setByUrl(m => ({ ...m, [url]: res.id }));
  });
  const download = (kind) => run(kind, async () => {
    const res = await api(`/lighthouse/audits/${id}/download/${kind}`, { raw: true });
    const href = URL.createObjectURL(await res.blob());
    const link = Object.assign(document.createElement('a'), { href, download: `lighthouse-${hostOf(url)}-${id}.${kind === 'html' && !r?.html_report_is_original ? 'summary' : 'report'}.${kind}` });
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    toast(`Downloaded the ${kind.toUpperCase()} report`);
  });

  return (
    <Card title="Full Google Lighthouse report" subtitle="Every Lighthouse audit across Performance, Accessibility, Best practices and SEO. Click one for the details and affected files."
      action={r && <div className="flex gap-2">
        <Button size="sm" icon={Download} busy={busy === 'html'} disabled={!r.has_html_report} onClick={() => download('html')}>HTML</Button>
        <Button size="sm" icon={Download} busy={busy === 'json'} disabled={!r.has_raw_json} onClick={() => download('json')}>JSON</Button>
      </div>}>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <label className="text-12 font-semibold text-slate-600" htmlFor="lh-page">Page</label>
        <select id="lh-page" value={url} onChange={e => setUrl(e.target.value)} className="h-9 flex-1 min-w-[200px] max-w-md px-2.5 rounded text-12.5 font-mono text-slate-800 bg-white ring-1 ring-inset ring-slate-200 outline-none cursor-pointer">
          {choices.map(u => <option key={u} value={u}>{pathOf(u)}{byUrl[u] ? '' : ' (not run yet)'}</option>)}
        </select>
        {!id && <Button size="sm" variant="primary" icon={Play} busy={busy === 'run'} onClick={runFor}>Run Lighthouse on this page</Button>}
        {s && !running && <span className="text-11.5 text-slate-500">{s.engine_used === 'lighthouse' ? 'Local Chrome' : 'PageSpeed Insights'} · {s.strategy}</span>}
      </div>
      <ErrorNote>{error}</ErrorNote>
      {(s?.fallback_reason || (url === target && fallbackReason)) && (
        <div className="mb-4 text-12 text-slate-600 bg-slate-50 ring-1 ring-inset ring-slate-200 rounded px-3 py-2">{s?.fallback_reason || fallbackReason}</div>
      )}

      {!id ? (
        <div className="py-6 text-center text-13 text-slate-500"><Gauge size={22} className="mx-auto mb-2 text-slate-400" />{url === target ? 'This report was made before full Lighthouse details were saved. Run Lighthouse on this page, or re-run the audit.' : 'Run Lighthouse on this page to see its full report.'}</div>
      ) : running || (s && !r && s.status === 'completed') || !s ? (
        <div className="py-10 flex items-center justify-center gap-2 text-13 text-slate-500"><Loader2 size={16} className="animate-spin" /> Running Google Lighthouse on {pathOf(url)}… this takes up to a minute.</div>
      ) : s.status === 'failed' ? (
        <ErrorNote>Lighthouse couldn't finish for this page: {s.error_message || 'unknown error'}</ErrorNote>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            {CATEGORIES.map(([, label, key]) => (
              <div key={key} className="rounded ring-1 ring-inset ring-slate-200 px-3 py-2">
                <div className="text-11 font-semibold text-slate-500">{label}</div>
                <div className={`text-20 font-bold tabular-nums ${scoreTone(r.scores[key])}`}>{r.scores[key] == null ? '—' : Math.round(r.scores[key])}</div>
              </div>
            ))}
          </div>
          <CategoryAudits key={id} report={r.report} />
          {r.report?.lighthouse_version && <div className="mt-4 text-11 text-slate-400">Lighthouse {r.report.lighthouse_version}{r.report.fetch_time ? ` · run ${new Date(r.report.fetch_time).toLocaleString()}` : ''}</div>}
        </>
      )}
      {toastNode}
    </Card>
  );
}
