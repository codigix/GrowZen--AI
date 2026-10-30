import React, { useEffect, useMemo, useState } from 'react';
import { Gauge, Smartphone, Monitor, FileText, Globe, Download, RotateCw, History, Loader2, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, XCircle, Cloud, Cpu, Sparkles } from 'lucide-react';
import { Card, Button, StatusPill, Badge, ScoreRing, Meter, Tabs, inputCls, ErrorNote, useToast, useAction, SERIES } from './SeoUi';
import { api, useApi, usePoll, fmtDateTime } from './seoApi';

/**
 * Full Google Lighthouse reports through the SEO backend (/lighthouse/...): one page, or every page in
 * a site's sitemap. Engines: PageSpeed Insights (key on the backend) or the backend's local Lighthouse
 * CLI; a failed PageSpeed run falls back to local.
 */

const CATEGORIES = [
  ['performance', 'Performance', 'performance'],
  ['accessibility', 'Accessibility', 'accessibility'],
  ['best-practices', 'Best Practices', 'best_practices'],
  ['seo', 'SEO', 'seo']
];
const BUCKETS = [
  ['failed', 'Failed Audits'],
  ['opportunities', 'Opportunities'],
  ['diagnostics', 'Diagnostics'],
  ['manual', 'Manual Checks'],
  ['informational', 'Informational'],
  ['passed', 'Passed Audits']
];
const FIELD = { FAST: ['good', 'Good'], AVERAGE: ['warning', 'Needs work'], SLOW: ['critical', 'Poor'] };
const ACTIVE = ['queued', 'running'];

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

const ScoreCell = ({ s }) => (
  s == null ? <span className="text-slate-600">—</span> :
    <span className={`tabular-nums  font-bold ${s >= 90 ? 'text-emerald-700' : s >= 50 ? 'text-amber-700' : 'text-rose-600'}`}>{s}</span>
);

const Ring = ({ score, label }) => (score == null ? (
  <div className="flex flex-col items-center gap-1.5 p-3 rounded bg-slate-50 border border-slate-200">
    <div className="w-[100px] h-[100px] rounded-full border-8 border-slate-200 flex flex-col items-center justify-center">
      <span className="text-2xl  font-semibold text-slate-500 leading-none">—</span>
      <span className="text-11 text-slate-500 mt-1">{label}</span>
    </div>
    <Badge>N/A</Badge>
  </div>
) : (
  <div className="flex flex-col items-center gap-1.5 p-3 rounded bg-slate-50 border border-slate-200">
    <ScoreRing score={score} label={label} size={100} level={lhLevel(score)} />
    <StatusPill level={lhLevel(score)}>{lhWord(score)}</StatusPill>
  </div>
));

const statusTone = (s) => (s === 'completed' ? 'green' : s === 'failed' ? 'red' : 'blue');
const engineLabel = (e) => (e === 'pagespeed' ? 'PageSpeed' : e === 'lighthouse' ? 'Local Lighthouse' : '—');

function EnginePicker({ health, engine, setEngine }) {
  const opts = [
    ['pagespeed', Cloud, 'PageSpeed Insights', health?.pagespeed_configured, 'Runs on Google cloud API.'],
    ['lighthouse', Cpu, 'Local Lighthouse', health?.local_lighthouse_available && health?.local_lighthouse_enabled, 'Headless Chrome CLI on host machine.']
  ];
  return (
    <div className="flex flex-wrap gap-1.5 p-1 bg-slate-50 rounded border border-slate-200">
      {opts.map(([id, I, label, ok, tip]) => (
        <button
          key={id}
          title={`${tip}${health ? (ok ? ' (ready)' : ' (not configured)') : ''}`}
          onClick={() => setEngine(id)}
          className={`h-9 px-3 flex items-center gap-2 text-12 font-semibold whitespace-nowrap rounded-lg cursor-pointer transition-all ${engine === id
            ? 'bg-gradient-to-tr from-indigo-600 to-cyan-500 text-white shadow-md'
            : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
            }`}
        >
          <I size={14} />
          <span>{label}</span>
          {health && <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-400' : 'bg-slate-300'}`} />}
        </button>
      ))}
    </div>
  );
}

function AuditRow({ a }) {
  const [open, setOpen] = useState(false);
  const savings = [a.savings_ms ? `−${ms(a.savings_ms)}` : null, a.savings_bytes ? `−${kb(a.savings_bytes)}` : null].filter(Boolean).join(' · ');
  const icon = a.score === 1
    ? <CheckCircle2 size={15} className="text-emerald-700 shrink-0 mt-0.5" />
    : a.score_display_mode === 'manual' || a.score == null
      ? <AlertTriangle size={15} className="text-slate-500 shrink-0 mt-0.5" />
      : a.score >= 0.5
        ? <AlertTriangle size={15} className="text-amber-700 shrink-0 mt-0.5" />
        : <XCircle size={15} className="text-rose-600 shrink-0 mt-0.5" />;

  return (
    <div className="py-2.5">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-start gap-2.5 text-left cursor-pointer group">
        {icon}
        <span className="flex-1 min-w-0 text-13 text-slate-900 group-hover:text-cyan-700 transition-colors">
          {a.title}
          {a.display_value ? <span className="text-slate-500  text-11"> · {a.display_value}</span> : null}
        </span>
        {savings && <span className="text-12 text-emerald-700  font-medium shrink-0 tabular-nums">{savings}</span>}
        {open ? <ChevronDown size={14} className="text-slate-500 shrink-0 mt-0.5" /> : <ChevronRight size={14} className="text-slate-500 shrink-0 mt-0.5" />}
      </button>
      {open && (
        <div className="ml-6 mt-2 space-y-2 animate-in fade-in duration-150">
          <p className="text-12 text-slate-500 leading-relaxed">{plain(a.description)}</p>
          {a.items?.length > 0 && (
            <ul className="text-11  text-slate-700 bg-slate-50 border border-slate-200 rounded p-3 space-y-1 max-h-48 overflow-auto">
              {a.items.map((it, n) => <li key={n} className="truncate text-cyan-700" title={itemText(it)}>{itemText(it)}</li>)}
              {a.item_count > a.items.length && <li className="text-slate-500 ">…and {a.item_count - a.items.length} more (full list in JSON report)</li>}
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
  const by = useMemo(() => Object.fromEntries(Object.entries(report?.audits_by_category || {}).map(([c, buckets]) => [c,
    Object.fromEntries(Object.entries(buckets).map(([b, list]) => [b, list.filter(a => !metricIds.has(a.id))]))])), [report, metricIds]);
  const toFix = (c) => ['failed', 'opportunities', 'diagnostics'].reduce((n, b) => n + (by[c]?.[b]?.length || 0), 0);
  const buckets = by[cat] || {};

  return (
    <Card title="Audits by Category" subtitle="Click an audit for full explanation, affected code snippets & resource payloads">
      <Tabs value={cat} onChange={setCat} tabs={CATEGORIES.filter(([id]) => by[id]).map(([id, label]) => ({ id, label, count: toFix(id) }))} />
      <div className="space-y-4 mt-4">
        {BUCKETS.filter(([b]) => b !== 'passed' || showPassed).map(([b, label]) => (buckets[b]?.length ? (
          <div key={b}>
            <div className="text-11    text-slate-500 font-semibold mb-1">{label} ({buckets[b].length})</div>
            <div className="divide-y divide-slate-200">{buckets[b].map(a => <AuditRow key={a.id} a={a} />)}</div>
          </div>
        ) : null))}
        {toFix(cat) === 0 && <div className="text-13 text-emerald-700">Nothing to fix in this category.</div>}
        {buckets.passed?.length > 0 && (
          <button onClick={() => setShowPassed(s => !s)} className="text-12 text-cyan-700 hover:text-cyan-700 font-medium cursor-pointer">
            {showPassed ? 'Hide' : 'Show'} {buckets.passed.length} passed audits
          </button>
        )}
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
    toast(`Downloaded ${kind.toUpperCase()}`);
  });

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {running && (
        <Card>
          <div className="py-12 flex flex-col items-center justify-center gap-3 text-13 text-slate-700">
            <div className="w-10 h-10 rounded bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-700">
              <Loader2 size={20} className="animate-spin" />
            </div>
            <span>Running Google Lighthouse audit for {hostOf(s.submitted_url)}…</span>
            <span className="text-11 text-slate-500 ">Engine: {engineLabel(s.engine)} · Strategy: {s.strategy}</span>
          </div>
        </Card>
      )}

      {s && !running && s.status === 'failed' && (
        <Card>
          <div className="py-6 text-13 text-rose-700 bg-rose-500/10 border border-rose-500/20 rounded p-4">
            Audit failed: {s.error_message || 'Internal error'}
          </div>
        </Card>
      )}

      {r && (
        <>
          <Card
            title={hostOf(r.submitted_url)}
            subtitle={`${r.submitted_url} · ${r.strategy} · ${engineLabel(r.engine)} · ${fmtDateTime(r.completed_at)}`}
            action={
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" icon={Download} busy={busy === 'json'} onClick={() => download('json')}>JSON</Button>
                <Button size="sm" variant="secondary" icon={Download} busy={busy === 'html'} onClick={() => download('html')}>HTML</Button>
                <Button size="sm" variant="primary" icon={RotateCw} busy={rerunning} onClick={() => onRerun(id)}>Re-run</Button>
              </div>
            }
          >
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              {CATEGORIES.map(([, label, key]) => (
                <Ring key={key} score={r.scores[key]} label={label} />
              ))}
            </div>
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            <div className="xl:col-span-2 space-y-5">
              <CategoryAudits report={r.report} metricIds={metricIds} />
            </div>

            <div className="space-y-5">
              <Card title="Lab Core Web Vitals">
                <div className="divide-y divide-slate-200 text-13">
                  {Object.entries(r.metrics || {}).map(([k, m]) => (
                    <div key={k} className="flex justify-between py-2.5">
                      <span className="text-slate-500">{m.title || k}</span>
                      <span className=" font-bold text-slate-900">{m.display_value || (m.numeric_value ? `${Math.round(m.numeric_value)} ms` : '—')}</span>
                    </div>
                  ))}
                </div>
              </Card>

              {r.report && (
                <Card title="Environment Telemetry">
                  <div className="space-y-2 text-12  text-slate-500">
                    <div>User Agent: <span className="text-slate-800 truncate block">{r.report.user_agent || 'Headless'}</span></div>
                    <div>Lighthouse Version: <span className="text-cyan-700">{r.report.lighthouse_version || '13.x'}</span></div>
                  </div>
                </Card>
              )}
            </div>
          </div>
        </>
      )}
      {toastNode}
    </div>
  );
}

function SiteAudit({ id, current, onOpenPage, onRerun, rerunning, onSettled }) {
  const summary = useApi(`/lighthouse/site-audits/${id}`);
  const s = summary.data;
  const running = s && ACTIVE.includes(s.status);
  usePoll(() => summary.reload(true), Boolean(running), 3000);
  useEffect(() => { if (s && !running) onSettled(); }, [s?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!s) return <Card><div className="py-8 flex justify-center text-slate-500"><Loader2 size={18} className="animate-spin text-cyan-700" /></div></Card>;

  const done = s.completed_count + s.failed_count;
  const ok = s.pages.filter(p => p.status === 'completed');
  const avg = (k) => { const v = ok.map(p => p[k]).filter(x => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };

  return (
    <Card
      title={`Site Multi-Page Audit: ${hostOf(s.base_url)}`}
      subtitle={`${s.page_count} pages from sitemap · ${s.strategy} · ${engineLabel(s.engine)} · ${fmtDateTime(s.created_at)}`}
      action={<Button icon={RotateCw} busy={rerunning} disabled={s.status === 'running'} onClick={() => onRerun(s)}>Re-run Site</Button>}
    >
      {s.discovery_error ? (
        <div className="text-13 text-rose-700 bg-rose-500/10 border border-rose-500/20 rounded px-3.5 py-2">{s.discovery_error}</div>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1">
              <Meter value={done} max={Math.max(1, s.page_count)} color={s.failed_count ? SERIES[1] : SERIES[0]} />
            </div>
            <span className="text-12  text-slate-500 whitespace-nowrap">
              {done}/{s.page_count} done{s.failed_count ? ` · ${s.failed_count} failed` : ''}
            </span>
            <Badge tone={statusTone(s.status)}>
              {s.status === 'running' ? <><Loader2 size={10} className="animate-spin" /> running</> : s.status}
            </Badge>
          </div>

          {ok.length > 0 && (
            <>
              <div className="text-12 text-slate-500 font-medium mb-2">Average across {ok.length} completed pages:</div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                {CATEGORIES.map(([, label, key]) => <Ring key={key} score={avg(`${key}_score`)} label={label} />)}
              </div>
            </>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-13">
              <thead className="text-11    text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="p-2.5 text-left font-semibold">Page Permalink</th>
                  <th className="p-2.5 text-right font-semibold">Perf.</th>
                  <th className="p-2.5 text-right font-semibold">A11y</th>
                  <th className="p-2.5 text-right font-semibold">Best Pr.</th>
                  <th className="p-2.5 text-right font-semibold">SEO</th>
                  <th className="p-2.5 text-left font-semibold">Status</th>
                  <th className="p-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {s.pages.map(p => (
                  <tr key={p.id} className={`hover:bg-slate-50 transition-colors ${p.id === current ? 'bg-indigo-600/15' : ''}`}>
                    <td className="p-2.5  text-12 text-cyan-700 max-w-[320px] truncate" title={p.submitted_url}>
                      {pathOf(p.submitted_url)}
                    </td>
                    <td className="p-2.5 text-right"><ScoreCell s={p.performance_score} /></td>
                    <td className="p-2.5 text-right"><ScoreCell s={p.accessibility_score} /></td>
                    <td className="p-2.5 text-right"><ScoreCell s={p.best_practices_score} /></td>
                    <td className="p-2.5 text-right"><ScoreCell s={p.seo_score} /></td>
                    <td className="p-2.5"><Badge tone={statusTone(p.status)}>{p.status}</Badge></td>
                    <td className="p-2.5 text-right">
                      <Button size="sm" variant="ghost" disabled={ACTIVE.includes(p.status)} onClick={() => onOpenPage(p.id)}>View</Button>
                    </td>
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
    <Card
      title={mode === 'site' ? 'Site Audit Telemetry History' : 'Page Audit Telemetry History'}
      subtitle={list.data ? `${list.data.total} audits logged across clients` : 'Shared history'}
      action={<History size={15} className="text-slate-500" />}
    >
      {list.error ? <ErrorNote>{list.error.message}</ErrorNote> : !list.data ? (
        <div className="py-6 flex justify-center text-slate-500"><Loader2 size={16} className="animate-spin text-cyan-700" /></div>
      ) : items.length === 0 ? (
        <div className="py-6 text-center text-13 text-slate-500">No {mode === 'site' ? 'site' : 'page'} audits yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-13">
            {mode === 'site' ? (
              <>
                <thead className="text-11    text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="p-2.5 text-left font-semibold">Site</th>
                    <th className="p-2.5 text-left font-semibold">Date</th>
                    <th className="p-2.5 text-left font-semibold">Device</th>
                    <th className="p-2.5 text-right font-semibold">Pages</th>
                    <th className="p-2.5 text-left font-semibold">Status</th>
                    <th className="p-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {items.map(h => (
                    <tr key={h.id} className={`hover:bg-slate-50 transition-colors ${h.id === currentSite ? 'bg-indigo-600/15' : ''}`}>
                      <td className="p-2.5 text-slate-900 font-medium">{hostOf(h.base_url)}</td>
                      <td className="p-2.5 text-slate-500  text-12">{fmtDateTime(h.created_at)}</td>
                      <td className="p-2.5 text-slate-500 capitalize">{h.strategy}</td>
                      <td className="p-2.5 text-right  text-slate-700 tabular-nums">
                        {h.completed_count}/{h.page_count}{h.failed_count ? <span className="text-rose-600"> ({h.failed_count} failed)</span> : null}
                      </td>
                      <td className="p-2.5"><Badge tone={statusTone(h.status)}>{h.status}</Badge></td>
                      <td className="p-2.5 text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" onClick={() => onOpenSite(h.id)}>View</Button>
                        <Button size="sm" variant="ghost" disabled={rerunning || h.status === 'running'} onClick={() => onRerun(h)}>Re-run</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </>
            ) : (
              <>
                <thead className="text-11    text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="p-2.5 text-left font-semibold">Page Permalink</th>
                    <th className="p-2.5 text-left font-semibold">Date</th>
                    <th className="p-2.5 text-left font-semibold">Device</th>
                    <th className="p-2.5 text-right font-semibold">Perf.</th>
                    <th className="p-2.5 text-right font-semibold">A11y</th>
                    <th className="p-2.5 text-right font-semibold">Best Pr.</th>
                    <th className="p-2.5 text-right font-semibold">SEO</th>
                    <th className="p-2.5 text-left font-semibold">Status</th>
                    <th className="p-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {items.map(h => (
                    <tr key={h.id} className={`hover:bg-slate-50 transition-colors ${h.id === current ? 'bg-indigo-600/15' : ''}`}>
                      <td className="p-2.5 text-cyan-700 max-w-[260px] truncate  text-12" title={h.submitted_url}>
                        {hostOf(h.submitted_url)}<span className="text-slate-500">{pathOf(h.submitted_url) === '/' ? '' : pathOf(h.submitted_url)}</span>
                      </td>
                      <td className="p-2.5 text-slate-500  text-12">{fmtDateTime(h.completed_at || h.created_at)}</td>
                      <td className="p-2.5 text-slate-500 capitalize">{h.strategy}</td>
                      <td className="p-2.5 text-right"><ScoreCell s={h.performance_score} /></td>
                      <td className="p-2.5 text-right"><ScoreCell s={h.accessibility_score} /></td>
                      <td className="p-2.5 text-right"><ScoreCell s={h.best_practices_score} /></td>
                      <td className="p-2.5 text-right"><ScoreCell s={h.seo_score} /></td>
                      <td className="p-2.5"><Badge tone={statusTone(h.status)}>{h.status}</Badge></td>
                      <td className="p-2.5 text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" onClick={() => onOpen(h.id)}>View</Button>
                        <Button size="sm" variant="ghost" disabled={rerunning} onClick={() => onRerun(h.id)}>Re-run</Button>
                      </td>
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

export default function LighthouseAuditTool({ defaultUrl = 'https://morayamultispecialitycharitablehospital.com/cataract-surgery-in-pcmc' }) {
  const health = useApi('/lighthouse/health');
  const h = health.data;
  const [url, setUrl] = useState(defaultUrl);
  const [mode, setMode] = useState('page');
  const [strategy, setStrategy] = useState('mobile');
  const [engine, setEngine] = useState(null);
  const [maxPages, setMaxPages] = useState(10);
  const [current, setCurrent] = useState(null);
  const [currentSite, setCurrentSite] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const settled = () => setRefresh(n => n + 1);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();

  useEffect(() => {
    if (defaultUrl) setUrl(defaultUrl);
  }, [defaultUrl]);

  const pagespeedReady = Boolean(h?.pagespeed_configured);
  const localReady = Boolean(h?.local_lighthouse_enabled && h?.local_lighthouse_available);
  const noEngine = Boolean(h) && !pagespeedReady && !localReady;

  useEffect(() => {
    if (h && engine === null) setEngine(pagespeedReady || !localReady ? 'pagespeed' : 'lighthouse');
  }, [h]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => run('start', async () => {
    const target = normalise(url);
    if (!target) throw new Error('Enter a website address, e.g. https://morayamultispecialitycharitablehospital.com/cataract-surgery-in-pcmc');
    const body = { url: target, strategy, engine: engine || 'pagespeed' };
    if (mode === 'site') {
      const r = await api('/lighthouse/site-audits', { method: 'POST', body: { ...body, max_pages: Number(maxPages) || 10 } });
      setCurrentSite(r.id);
      setCurrent(null);
      toast(`Site audit started: ${r.page_count} pages from sitemap`);
    } else {
      const r = await api('/lighthouse/audits', { method: 'POST', body });
      setCurrent(r.id);
      setCurrentSite(null);
    }
  });

  const rerunPage = (id) => run('rerun', async () => {
    const r = await api(`/lighthouse/audits/${id}/rerun`, { method: 'POST' });
    setCurrent(r.id);
    setCurrentSite(null);
    toast('Audit started again');
  });

  const rerunSite = (s) => run('rerun', async () => {
    const r = await api('/lighthouse/site-audits', { method: 'POST', body: { url: s.base_url, strategy: s.strategy, engine: s.engine, max_pages: s.max_pages } });
    setCurrentSite(r.id);
    setCurrent(null);
    toast('Site audit started again');
  });

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      <Card
        title="Google Lighthouse Neural Audit"
        subtitle="Performance, Accessibility, Best Practices & SEO with raw Core Web Vitals telemetry"
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex gap-1.5 p-1 bg-slate-50 rounded border border-slate-200">
            {[
              ['page', FileText, 'One Page'],
              ['site', Globe, 'Whole Site']
            ].map(([m, I, l]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`h-9 px-3.5 flex items-center gap-1.5 text-12 font-semibold rounded-lg cursor-pointer transition-all ${mode === m
                  ? 'bg-gradient-to-tr from-indigo-600 to-cyan-500 text-white shadow-md'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                  }`}
              >
                <I size={14} />
                <span>{l}</span>
              </button>
            ))}
          </div>

          <label className="flex-1 min-w-[260px] text-12 text-slate-700 font-medium">
            {mode === 'site' ? 'Website URL (crawls sitemap.xml)' : 'Target Page Permalink'}
            <input
              className={`${inputCls} mt-1`}
              placeholder="https://morayamultispecialitycharitablehospital.com/cataract-surgery-in-pcmc"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !noEngine && start()}
            />
          </label>

          {mode === 'site' && (
            <label className="w-28 text-12 text-slate-700 font-medium">
              Max Pages
              <input
                type="number"
                min={1}
                max={100}
                className={`${inputCls} mt-1`}
                value={maxPages}
                onChange={e => setMaxPages(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
              />
            </label>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-3">
          <div className="flex gap-1.5 p-1 bg-slate-50 rounded border border-slate-200">
            {[
              ['mobile', Smartphone, 'Mobile'],
              ['desktop', Monitor, 'Desktop']
            ].map(([s, I, l]) => (
              <button
                key={s}
                onClick={() => setStrategy(s)}
                className={`h-9 px-3.5 flex items-center gap-1.5 text-12 font-semibold rounded-lg cursor-pointer transition-all ${strategy === s
                  ? 'bg-gradient-to-tr from-indigo-600 to-cyan-500 text-white shadow-md'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                  }`}
              >
                <I size={14} />
                <span>{l}</span>
              </button>
            ))}
          </div>

          <EnginePicker health={h} engine={engine} setEngine={setEngine} />

          <Button
            variant="primary"
            icon={Gauge}
            busy={busy === 'start'}
            disabled={noEngine || !h}
            onClick={start}
          >
            {mode === 'site' ? 'Audit Entire Site' : 'Run Lighthouse'}
          </Button>

          {h && (
            <span className="text-12 text-slate-500 ">
              {h.active_audits ? `${h.active_audits} active on host` : ''}
            </span>
          )}
        </div>

        <ErrorNote>{error || health.error?.message}</ErrorNote>
      </Card>

      {currentSite && (
        <SiteAudit
          key={currentSite}
          id={currentSite}
          current={current}
          onOpenPage={setCurrent}
          onRerun={rerunSite}
          rerunning={busy === 'rerun'}
          onSettled={settled}
        />
      )}

      {current && (
        <Report
          key={current}
          id={current}
          onRerun={rerunPage}
          rerunning={busy === 'rerun'}
          onSettled={settled}
        />
      )}

      <HistoryCard
        mode={mode}
        current={current}
        currentSite={currentSite}
        refresh={refresh}
        rerunning={busy === 'rerun'}
        onOpen={(id) => { setCurrent(id); setCurrentSite(null); }}
        onOpenSite={(id) => { setCurrentSite(id); setCurrent(null); }}
        onRerun={mode === 'site' ? rerunSite : rerunPage}
      />

      {toastNode}
    </div>
  );
}
