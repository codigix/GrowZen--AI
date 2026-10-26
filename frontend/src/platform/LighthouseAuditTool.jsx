import React, { useEffect, useMemo, useState } from 'react';
import { Gauge, Smartphone, Monitor, FileText, Globe, Download, RotateCw, History, Loader2, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, XCircle, Cloud, Cpu } from 'lucide-react';
import { Card, Button, StatusPill, Badge, ScoreRing, Meter, Tabs, inputCls, ErrorNote, useToast, useAction, SERIES } from './SeoUi';
import { api, useApi, usePoll, fmtDateTime } from './seoApi';

/**
 * Full Google Lighthouse reports through the SEO backend (/lighthouse/...): one page, or every page in
 * a site's sitemap. Engines: PageSpeed Insights (key on the backend) or the backend's local Lighthouse
 * CLI; a failed PageSpeed run falls back to local. Audits run in the background on the server, so
 * this screen polls until they finish. Scores are only ever what Lighthouse returned (null = N/A).
 */

const CATEGORIES = [['performance', 'Performance', 'performance'], ['accessibility', 'Accessibility', 'accessibility'], ['best-practices', 'Best practices', 'best_practices'], ['seo', 'SEO', 'seo']];
const BUCKETS = [['failed', 'Failed audits'], ['opportunities', 'Opportunities'], ['diagnostics', 'Diagnostics'], ['manual', 'Manual checks'], ['informational', 'Informational'], ['passed', 'Passed audits']];
const FIELD = { FAST: ['good', 'Good'], AVERAGE: ['warning', 'Needs work'], SLOW: ['critical', 'Poor'] };
const ACTIVE = ['queued', 'running'];

// Lighthouse's own thresholds: 90+ good, 50-89 needs work, under 50 poor.
const lhLevel = (s) => (s >= 90 ? 'good' : s >= 50 ? 'warning' : 'critical');
const lhWord = (s) => (s >= 90 ? 'Good' : s >= 50 ? 'Needs work' : 'Poor');
const metricLevel = (score) => (score == null ? 'info' : score >= 0.9 ? 'good' : score >= 0.5 ? 'warning' : 'critical');
const plain = (md) => String(md || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`/g, '');
const normalise = (raw) => { const s = String(raw || '').trim(); if (!s) return ''; try { return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).toString(); } catch (e) { return ''; } };
const hostOf = (u) => { try { return new URL(u).hostname; } catch (e) { return u; } };
const pathOf = (u) => { try { const p = new URL(u); return p.pathname + p.search; } catch (e) { return u; } };
const ms = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
const kb = (v) => `${Math.round(v / 1024)} KiB`;
const itemText = (it) => it?.url || it?.node?.snippet || it?.source?.url || it?.label || it?.groupLabel || it?.entity || JSON.stringify(it).slice(0, 160);

const ScoreCell = ({ s }) => (s == null ? <span className="text-gray-400">—</span> : <span className={`tabular-nums font-medium ${s >= 90 ? 'text-[#006300]' : s >= 50 ? 'text-[#b07800]' : 'text-[#d03b3b]'}`}>{s}</span>);

// N/A must never look like a 0 score.
const Ring = ({ score, label }) => (score == null ? (
  <div className="flex flex-col items-center gap-1 p-2">
    <div className="w-[112px] h-[112px] rounded-full border-8 border-gray-100 flex flex-col items-center justify-center"><span className="text-2xl font-semibold text-gray-400 leading-none">—</span><span className="text-[11px] text-gray-500 mt-1">{label}</span></div>
    <Badge>N/A</Badge>
  </div>
) : (
  <div className="flex flex-col items-center gap-1 p-2"><ScoreRing score={score} label={label} size={112} level={lhLevel(score)} /><StatusPill level={lhLevel(score)}>{lhWord(score)}</StatusPill></div>
));

const statusTone = (s) => (s === 'completed' ? 'green' : s === 'failed' ? 'red' : 'blue');
const engineLabel = (e) => (e === 'pagespeed' ? 'PageSpeed' : e === 'lighthouse' ? 'Local Lighthouse' : '—');

function EnginePicker({ health, engine, setEngine }) {
  const opts = [
    ['pagespeed', Cloud, 'PageSpeed Insights', health?.pagespeed_configured, 'Runs on Google. Needs PAGESPEED_API_KEY on the backend.'],
    ['lighthouse', Cpu, 'Local Lighthouse', health?.local_lighthouse_available && health?.local_lighthouse_enabled, 'Runs Chrome on the server. Original Lighthouse HTML report.']
  ];
  return (
    <div className="flex flex-wrap gap-1">
      {opts.map(([id, I, label, ok, tip]) => (
        <button key={id} title={`${tip}${health ? (ok ? ' (ready)' : ' (not set up)') : ''}`} onClick={() => setEngine(id)}
          className={`h-8 px-3 flex items-center gap-1.5 text-[13px] whitespace-nowrap rounded border cursor-pointer ${engine === id ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-300 text-gray-700'}`}>
          <I size={13} />{label}{health && <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-gray-300'}`} />}
        </button>
      ))}
    </div>
  );
}

function AuditRow({ a }) {
  const [open, setOpen] = useState(false);
  const savings = [a.savings_ms ? `−${ms(a.savings_ms)}` : null, a.savings_bytes ? `−${kb(a.savings_bytes)}` : null].filter(Boolean).join(' · ');
  const icon = a.score === 1 ? <CheckCircle2 size={15} className="text-emerald-600 shrink-0 mt-0.5" /> : a.score_display_mode === 'manual' || a.score == null ? <AlertTriangle size={15} className="text-gray-400 shrink-0 mt-0.5" /> : a.score >= 0.5 ? <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" /> : <XCircle size={15} className="text-[#d03b3b] shrink-0 mt-0.5" />;
  return (
    <div className="py-2">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-start gap-2.5 text-left cursor-pointer">
        {icon}
        <span className="flex-1 min-w-0 text-[13px] text-gray-900">{a.title}{a.display_value ? <span className="text-gray-500"> · {a.display_value}</span> : null}</span>
        {savings && <span className="text-[12px] text-gray-500 shrink-0 tabular-nums">{savings}</span>}
        {open ? <ChevronDown size={14} className="text-gray-400 shrink-0 mt-0.5" /> : <ChevronRight size={14} className="text-gray-400 shrink-0 mt-0.5" />}
      </button>
      {open && (
        <div className="ml-6 mt-1.5 space-y-1.5">
          <p className="text-[12px] text-gray-600">{plain(a.description)}</p>
          {a.items?.length > 0 && (
            <ul className="text-[11px] font-mono text-gray-700 bg-gray-50 border border-gray-100 rounded p-2 space-y-0.5 max-h-48 overflow-auto">
              {a.items.map((it, n) => <li key={n} className="truncate" title={itemText(it)}>{itemText(it)}</li>)}
              {a.item_count > a.items.length && <li className="text-gray-500 font-sans">…and {a.item_count - a.items.length} more (full list in the JSON report)</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function CategoryAudits({ report, metricIds }) {
  const [cat, setCat] = useState('performance');
  const [showPassed, setShowPassed] = useState(false);
  // Metric audits (FCP, LCP, TBT...) are shown under Lab metrics; a 0.95 metric is not a failed audit.
  const by = useMemo(() => Object.fromEntries(Object.entries(report?.audits_by_category || {}).map(([c, buckets]) => [c,
    Object.fromEntries(Object.entries(buckets).map(([b, list]) => [b, list.filter(a => !metricIds.has(a.id))]))])), [report, metricIds]);
  const toFix = (c) => ['failed', 'opportunities', 'diagnostics'].reduce((n, b) => n + (by[c]?.[b]?.length || 0), 0);
  const buckets = by[cat] || {};
  return (
    <Card title="Audits by category" subtitle="Click an audit for the explanation and affected items">
      <Tabs value={cat} onChange={setCat} tabs={CATEGORIES.filter(([id]) => by[id]).map(([id, label]) => ({ id, label, count: toFix(id) }))} />
      <div className="space-y-4">
        {BUCKETS.filter(([b]) => b !== 'passed' || showPassed).map(([b, label]) => (buckets[b]?.length ? (
          <div key={b}>
            <div className="text-[12px] font-medium text-gray-500 uppercase tracking-wide">{label} ({buckets[b].length})</div>
            <div className="divide-y divide-gray-100">{buckets[b].map(a => <AuditRow key={a.id} a={a} />)}</div>
          </div>
        ) : null))}
        {toFix(cat) === 0 && <div className="text-[13px] text-gray-600">Nothing to fix in this category.</div>}
        {buckets.passed?.length > 0 && <button onClick={() => setShowPassed(s => !s)} className="text-[12px] text-blue-700 hover:underline cursor-pointer">{showPassed ? 'Hide' : 'Show'} {buckets.passed.length} passed audits</button>}
      </div>
    </Card>
  );
}

function Report({ id, onRerun, rerunning, onSettled }) {
  const summary = useApi(`/lighthouse/audits/${id}`);
  const s = summary.data;
  const running = s && ACTIVE.includes(s.status);
  usePoll(() => summary.reload(true), Boolean(running), 2500);
  const full = useApi(s && !running ? `/lighthouse/audits/${id}/report?v=${s.status}` : null);
  useEffect(() => { if (s && !running) onSettled(); }, [s?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const r = full.data;
  const metricIds = useMemo(() => new Set(Object.keys(r?.metrics || {})), [r]);

  const download = (kind) => run(kind, async () => {
    const res = await api(`/lighthouse/audits/${id}/download/${kind}`, { raw: true });
    const href = URL.createObjectURL(await res.blob());
    const link = Object.assign(document.createElement('a'), { href, download: `lighthouse-${hostOf(r.submitted_url)}-${id}.${kind === 'html' && !r.html_report_is_original ? 'summary' : 'report'}.${kind}` });
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    toast(`${kind.toUpperCase()} report downloaded`);
  });

  if (summary.error) return <Card><ErrorNote>{summary.error.message}</ErrorNote></Card>;
  if (!s || (!running && !r)) return <Card><div className="py-10 flex justify-center text-gray-400"><Loader2 size={16} className="animate-spin" /></div></Card>;
  if (running) {
    return (
      <Card>
        <div className="py-10 flex flex-col items-center gap-2 text-[13px] text-gray-600">
          <div className="flex items-center gap-2"><Loader2 size={16} className="animate-spin text-blue-600" /> {s.status === 'queued' ? 'Waiting for a free Lighthouse slot' : 'Running Lighthouse'} on {s.submitted_url}…</div>
          <div className="text-[12px] text-gray-500">{s.engine === 'pagespeed' ? 'PageSpeed usually takes 15–60 s.' : 'Local Lighthouse can take 1–3 minutes.'} You can leave this page; the audit keeps running and appears in the history.</div>
        </div>
      </Card>
    );
  }
  if (r.status === 'failed') {
    return (
      <Card title="The audit failed" subtitle={`${r.submitted_url} · ${fmtDateTime(r.completed_at || r.created_at)}`} action={<Button icon={RotateCw} busy={rerunning} onClick={() => onRerun(id)}>Re-run</Button>}>
        <div className="text-[13px] text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 whitespace-pre-wrap">{r.error_message}</div>
      </Card>
    );
  }

  const report = r.report || {};
  const field = report.field_data?.metrics || {};
  return (
    <div className="space-y-4">
      <Card title={hostOf(r.final_url || r.submitted_url)} subtitle={`${pathOf(r.final_url || r.submitted_url)} · ${r.strategy} · ${engineLabel(r.engine_used || r.engine)} · ${fmtDateTime(r.completed_at)}${report.lighthouse_version ? ` · Lighthouse ${report.lighthouse_version}` : ''}`}
        action={<div className="flex gap-2 flex-wrap justify-end">
          <Button icon={RotateCw} busy={rerunning} onClick={() => onRerun(id)}>Re-run</Button>
          {r.has_html_report && <Button icon={FileText} busy={busy === 'html'} onClick={() => download('html')}>{r.html_report_is_original ? 'HTML report' : 'HTML summary'}</Button>}
          {r.has_raw_json && <Button icon={Download} busy={busy === 'json'} onClick={() => download('json')}>JSON</Button>}
        </div>}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{CATEGORIES.map(([, label, key]) => <Ring key={key} score={r.scores[key]} label={label} />)}</div>
        {r.fallback_reason && <div className="mt-3 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">{r.fallback_reason}</div>}
        {report.runtime_error && <div className="mt-3 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">Lighthouse warning: {report.runtime_error}</div>}
        <ErrorNote>{error}</ErrorNote>
      </Card>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2"><CategoryAudits report={report} metricIds={metricIds} /></div>
        <div className="space-y-4">
          <Card title="Lab metrics" subtitle="Measured in this Lighthouse run">
            <div className="divide-y divide-gray-100 text-[13px]">
              {Object.entries(r.metrics || {}).map(([k, m]) => <div key={k} className="flex items-center justify-between gap-2 py-1.5"><span className="text-gray-600">{m.title}</span><StatusPill level={metricLevel(m.score)}>{m.display_value || '—'}</StatusPill></div>)}
              {!Object.keys(r.metrics || {}).length && <div className="py-2 text-gray-500">No metrics returned.</div>}
            </div>
          </Card>
          <Card title="Real users (Chrome UX Report)" subtitle={report.field_data ? `Last 28 days · overall ${FIELD[report.field_data.overall_category]?.[1] || report.field_data.overall_category || '—'}` : 'Field data comes with PageSpeed runs'}>
            {Object.keys(field).length ? (
              <div className="divide-y divide-gray-100 text-[13px]">
                {Object.entries(field).map(([k, m]) => <div key={k} className="flex items-center justify-between gap-2 py-1.5"><span className="text-gray-600">{k.replace(/-/g, ' ')}</span><span className="flex items-center gap-2"><span className="tabular-nums text-gray-800">{k === 'cumulative-layout-shift' ? (m.percentile / 100).toFixed(2) : ms(m.percentile)}</span>{FIELD[m.category] && <StatusPill level={FIELD[m.category][0]}>{FIELD[m.category][1]}</StatusPill>}</span></div>)}
              </div>
            ) : <div className="text-[13px] text-gray-500">{report.field_data ? 'Not enough real-user traffic for this page.' : 'Not available for this run.'}</div>}
          </Card>
        </div>
      </div>
      {toastNode}
    </div>
  );
}

function SiteAudit({ id, current, onOpenPage, onRerun, rerunning, onSettled }) {
  const site = useApi(`/lighthouse/site-audits/${id}`);
  const s = site.data;
  usePoll(() => site.reload(true), Boolean(s && s.status === 'running'), 3000);
  useEffect(() => { if (s && s.status !== 'running') onSettled(); }, [s?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  if (site.error) return <Card><ErrorNote>{site.error.message}</ErrorNote></Card>;
  if (!s) return <Card><div className="py-10 flex justify-center text-gray-400"><Loader2 size={16} className="animate-spin" /></div></Card>;
  const done = s.completed_count + s.failed_count;
  const ok = s.pages.filter(p => p.status === 'completed');
  const avg = (k) => { const v = ok.map(p => p[k]).filter(x => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
  return (
    <Card title={`Site audit: ${hostOf(s.base_url)}`} subtitle={`${s.page_count} pages from the sitemap · ${s.strategy} · ${engineLabel(s.engine)} · ${fmtDateTime(s.created_at)}`}
      action={<Button icon={RotateCw} busy={rerunning} disabled={s.status === 'running'} onClick={() => onRerun(s)}>Re-run site</Button>}>
      {s.discovery_error ? <div className="text-[13px] text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{s.discovery_error}</div> : (
        <>
          <div className="flex items-center gap-3 mb-3">
            <div className="flex-1"><Meter value={done} max={Math.max(1, s.page_count)} color={s.failed_count ? SERIES[1] : SERIES[0]} /></div>
            <span className="text-[12px] text-gray-600 tabular-nums whitespace-nowrap">{done}/{s.page_count} done{s.failed_count ? ` · ${s.failed_count} failed` : ''}</span>
            <Badge tone={statusTone(s.status)}>{s.status === 'running' ? <><Loader2 size={10} className="animate-spin" /> running</> : s.status}</Badge>
          </div>
          {ok.length > 0 && (
            <>
              <div className="text-[12px] text-gray-500">Average of {ok.length} completed page{ok.length > 1 ? 's' : ''}</div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-2">{CATEGORIES.map(([, label, key]) => <Ring key={key} score={avg(`${key}_score`)} label={label} />)}</div>
            </>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="text-[12px] text-gray-500 border-b border-gray-200"><tr><th className="p-2 text-left font-medium">Page</th><th className="p-2 text-right font-medium">Perf.</th><th className="p-2 text-right font-medium">A11y</th><th className="p-2 text-right font-medium">Best pr.</th><th className="p-2 text-right font-medium">SEO</th><th className="p-2 text-left font-medium">Status</th><th className="p-2" /></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {s.pages.map(p => (
                  <tr key={p.id} className={p.id === current ? 'bg-blue-50/50' : ''}>
                    <td className="p-2 font-mono text-[12px] text-gray-800 max-w-[320px] truncate" title={p.submitted_url}>{pathOf(p.submitted_url)}</td>
                    <td className="p-2 text-right"><ScoreCell s={p.performance_score} /></td>
                    <td className="p-2 text-right"><ScoreCell s={p.accessibility_score} /></td>
                    <td className="p-2 text-right"><ScoreCell s={p.best_practices_score} /></td>
                    <td className="p-2 text-right"><ScoreCell s={p.seo_score} /></td>
                    <td className="p-2"><Badge tone={statusTone(p.status)} title={p.error_message || undefined}>{p.status}</Badge></td>
                    <td className="p-2 text-right"><Button size="sm" variant="ghost" disabled={ACTIVE.includes(p.status)} onClick={() => onOpenPage(p.id)}>View</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

function HistoryCard({ mode, current, currentSite, refresh, onOpen, onOpenSite, onRerun, rerunning }) {
  const pages = useApi('/lighthouse/audits/history?page_size=20&include_site_pages=false');
  const sites = useApi('/lighthouse/site-audits/history?page_size=20');
  const list = mode === 'site' ? sites : pages;
  const anyRunning = (list.data?.items || []).some(i => ACTIVE.includes(i.status));
  usePoll(() => list.reload(true), anyRunning, 4000);
  useEffect(() => { pages.reload(true); sites.reload(true); }, [current, currentSite, refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = list.data?.items || [];
  return (
    <Card title={mode === 'site' ? 'Site audit history' : 'Page audit history'} subtitle={list.data ? `${list.data.total} in total · shared by the team` : 'Shared by the team'} action={<History size={15} className="text-gray-400" />}>
      {list.error ? <ErrorNote>{list.error.message}</ErrorNote> : !list.data ? <div className="py-6 flex justify-center text-gray-400"><Loader2 size={16} className="animate-spin" /></div> : items.length === 0 ? <div className="py-6 text-center text-[13px] text-gray-500">No {mode === 'site' ? 'site' : 'page'} audits yet.</div> : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            {mode === 'site' ? (
              <>
                <thead className="text-[12px] text-gray-500 border-b border-gray-200"><tr><th className="p-2 text-left font-medium">Site</th><th className="p-2 text-left font-medium">Date</th><th className="p-2 text-left font-medium">Device</th><th className="p-2 text-right font-medium">Pages</th><th className="p-2 text-left font-medium">Status</th><th className="p-2" /></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map(h => (
                    <tr key={h.id} className={h.id === currentSite ? 'bg-blue-50/50' : ''}>
                      <td className="p-2 text-gray-900">{hostOf(h.base_url)}</td>
                      <td className="p-2 text-gray-600">{fmtDateTime(h.created_at)}</td>
                      <td className="p-2 text-gray-600 capitalize">{h.strategy}</td>
                      <td className="p-2 text-right tabular-nums">{h.completed_count}/{h.page_count}{h.failed_count ? <span className="text-[#d03b3b]"> ({h.failed_count} failed)</span> : null}</td>
                      <td className="p-2"><Badge tone={statusTone(h.status)} title={h.discovery_error || undefined}>{h.status}</Badge></td>
                      <td className="p-2 text-right whitespace-nowrap"><Button size="sm" variant="ghost" onClick={() => onOpenSite(h.id)}>View</Button><Button size="sm" variant="ghost" disabled={rerunning || h.status === 'running'} onClick={() => onRerun(h)}>Re-run</Button></td>
                    </tr>
                  ))}
                </tbody>
              </>
            ) : (
              <>
                <thead className="text-[12px] text-gray-500 border-b border-gray-200"><tr><th className="p-2 text-left font-medium">Page</th><th className="p-2 text-left font-medium">Date</th><th className="p-2 text-left font-medium">Device</th><th className="p-2 text-right font-medium">Perf.</th><th className="p-2 text-right font-medium">A11y</th><th className="p-2 text-right font-medium">Best pr.</th><th className="p-2 text-right font-medium">SEO</th><th className="p-2 text-left font-medium">Status</th><th className="p-2" /></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map(h => (
                    <tr key={h.id} className={h.id === current ? 'bg-blue-50/50' : ''}>
                      <td className="p-2 text-gray-900 max-w-[260px] truncate" title={h.submitted_url}>{hostOf(h.submitted_url)}<span className="text-gray-500">{pathOf(h.submitted_url) === '/' ? '' : pathOf(h.submitted_url)}</span></td>
                      <td className="p-2 text-gray-600">{fmtDateTime(h.completed_at || h.created_at)}</td>
                      <td className="p-2 text-gray-600 capitalize">{h.strategy}</td>
                      <td className="p-2 text-right"><ScoreCell s={h.performance_score} /></td>
                      <td className="p-2 text-right"><ScoreCell s={h.accessibility_score} /></td>
                      <td className="p-2 text-right"><ScoreCell s={h.best_practices_score} /></td>
                      <td className="p-2 text-right"><ScoreCell s={h.seo_score} /></td>
                      <td className="p-2"><Badge tone={statusTone(h.status)} title={h.error_message || undefined}>{h.status}</Badge></td>
                      <td className="p-2 text-right whitespace-nowrap"><Button size="sm" variant="ghost" onClick={() => onOpen(h.id)}>View</Button><Button size="sm" variant="ghost" disabled={rerunning} onClick={() => onRerun(h.id)}>Re-run</Button></td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
          </table>
        </div>
      )}
    </Card>
  );
}

export default function LighthouseAuditTool({ defaultUrl = '' }) {
  const health = useApi('/lighthouse/health');
  const h = health.data;
  const [url, setUrl] = useState(defaultUrl);
  const [mode, setMode] = useState('page'); // page | site
  const [strategy, setStrategy] = useState('mobile');
  const [engine, setEngine] = useState(null); // chosen from what the server has, below
  const [maxPages, setMaxPages] = useState(10);
  const [current, setCurrent] = useState(null); // page audit id shown
  const [currentSite, setCurrentSite] = useState(null); // site audit id shown
  const [refresh, setRefresh] = useState(0); // bumped when the open audit finishes, so history updates at once
  const settled = () => setRefresh(n => n + 1);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  useEffect(() => { setUrl(defaultUrl); }, [defaultUrl]);

  const pagespeedReady = Boolean(h?.pagespeed_configured);
  const localReady = Boolean(h?.local_lighthouse_enabled && h?.local_lighthouse_available);
  const noEngine = Boolean(h) && !pagespeedReady && !localReady;
  // Default to an engine that works: PageSpeed if it has a key, else local.
  useEffect(() => { if (h && engine === null) setEngine(pagespeedReady || !localReady ? 'pagespeed' : 'lighthouse'); }, [h]); // eslint-disable-line react-hooks/exhaustive-deps
  const engineNote = useMemo(() => {
    if (!h || noEngine) return null;
    if (engine === 'pagespeed' && !pagespeedReady) return 'PageSpeed has no API key on the server, so this audit will run on local Lighthouse instead.';
    if (engine === 'lighthouse' && !localReady) return 'Local Lighthouse is not installed on the server; choose PageSpeed Insights.';
    return null;
  }, [h, engine, pagespeedReady, localReady, noEngine]);

  const start = () => run('start', async () => {
    const target = normalise(url);
    if (!target) throw new Error('Enter a website address, e.g. https://example.com');
    const body = { url: target, strategy, engine: engine || 'pagespeed' };
    if (mode === 'site') {
      const r = await api('/lighthouse/site-audits', { method: 'POST', body: { ...body, max_pages: Number(maxPages) || 10 } });
      setCurrentSite(r.id); setCurrent(null);
      toast(`Site audit started: ${r.page_count} pages from the sitemap`);
    } else {
      const r = await api('/lighthouse/audits', { method: 'POST', body });
      setCurrent(r.id); setCurrentSite(null);
    }
  });
  const rerunPage = (id) => run('rerun', async () => { const r = await api(`/lighthouse/audits/${id}/rerun`, { method: 'POST' }); setCurrent(r.id); setCurrentSite(null); toast('Audit started again'); });
  const rerunSite = (s) => run('rerun', async () => {
    const r = await api('/lighthouse/site-audits', { method: 'POST', body: { url: s.base_url, strategy: s.strategy, engine: s.engine, max_pages: s.max_pages } });
    setCurrentSite(r.id); setCurrent(null); toast('Site audit started again');
  });

  return (
    <div className="space-y-4">
      <Card title="Lighthouse report" subtitle="Google Lighthouse: performance, accessibility, best practices and SEO, with Core Web Vitals and every audit, for one page or a whole site">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex gap-1">{[['page', FileText, 'One page'], ['site', Globe, 'Whole site']].map(([m, I, l]) => <button key={m} onClick={() => setMode(m)} className={`h-8 px-3 flex items-center gap-1.5 text-[13px] rounded border cursor-pointer ${mode === m ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-300 text-gray-700'}`}><I size={13} />{l}</button>)}</div>
          <label className="flex-1 min-w-[240px] text-[12px] text-gray-600">{mode === 'site' ? 'Website (its sitemap.xml lists the pages)' : 'Page address'}<input className={`${inputCls} mt-1`} placeholder="https://yourwebsite.com" value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && !noEngine && start()} /></label>
          {mode === 'site' && <label className="w-24 text-[12px] text-gray-600">Max pages<input type="number" min={1} max={50} className={`${inputCls} mt-1`} value={maxPages} onChange={e => setMaxPages(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} /></label>}
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <div className="flex gap-1">{[['mobile', Smartphone, 'Mobile'], ['desktop', Monitor, 'Desktop']].map(([s, I, l]) => <button key={s} onClick={() => setStrategy(s)} className={`h-8 px-3 flex items-center gap-1.5 text-[13px] rounded border cursor-pointer ${strategy === s ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-300 text-gray-700'}`}><I size={13} />{l}</button>)}</div>
          <EnginePicker health={h} engine={engine} setEngine={setEngine} />
          <Button variant="primary" icon={Gauge} busy={busy === 'start'} disabled={noEngine || !h} onClick={start}>{mode === 'site' ? 'Audit site' : 'Run Lighthouse'}</Button>
          {h && <span className="text-[12px] text-gray-500">{h.active_audits ? `${h.active_audits} audit${h.active_audits > 1 ? 's' : ''} running on the server` : ''}</span>}
        </div>
        {noEngine && (
          <div className="mt-3 text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            <div className="font-medium">No Lighthouse engine is set up on the backend yet.</div>
            Either add <code className="font-mono">PAGESPEED_API_KEY</code> to <code className="font-mono">backend/.env</code> (free key from Google Cloud: enable "PageSpeed Insights API"), or install Node.js, run <code className="font-mono">npm install -g lighthouse</code> and have Chrome or Edge on the server. Then restart the backend.
          </div>
        )}
        {engineNote && <div className="mt-2 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">{engineNote}</div>}
        <ErrorNote>{error || health.error?.message}</ErrorNote>
      </Card>

      {currentSite && <SiteAudit key={currentSite} id={currentSite} current={current} onOpenPage={setCurrent} onRerun={rerunSite} rerunning={busy === 'rerun'} onSettled={settled} />}
      {current && <Report key={current} id={current} onRerun={rerunPage} rerunning={busy === 'rerun'} onSettled={settled} />}

      <HistoryCard mode={mode} current={current} currentSite={currentSite} refresh={refresh} rerunning={busy === 'rerun'}
        onOpen={(id) => { setCurrent(id); setCurrentSite(null); }} onOpenSite={(id) => { setCurrentSite(id); setCurrent(null); }}
        onRerun={mode === 'site' ? rerunSite : rerunPage} />
      {toastNode}
    </div>
  );
}
