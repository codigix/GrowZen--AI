import React, { useEffect, useState } from 'react';
import { jsPDF } from 'jspdf';
import { Search, Smartphone, Monitor, Download, CheckCircle2, XCircle, CircleDashed, History, ArrowUp, ArrowDown, Loader2, Sparkles, Globe, Zap } from 'lucide-react';
import { Card, Button, StatusPill, Badge, ScoreRing, inputCls, ErrorNote, useToast, useAction } from './SeoUi';
import { api, useApi, usePoll, fmtDateTime } from './seoApi';

/**
 * Audit any website through the SEO backend: Google PageSpeed (Lighthouse) for SEO, speed,
 * accessibility and best practices, plus the backend's crawler for on-page checks on every page.
 */

const lhLevel = (s) => (s >= 90 ? 'good' : s >= 50 ? 'warning' : 'critical');
const lhWord = (s) => (s >= 90 ? 'Good' : s >= 50 ? 'Needs work' : 'Poor');
const LEVEL = { critical: 'critical', serious: 'serious', warning: 'warning', info: 'info' };
const ICON = {
  pass: <CheckCircle2 size={16} className="text-emerald-700 shrink-0" />,
  fail: <XCircle size={16} className="text-rose-600 shrink-0" />,
  manual: <CircleDashed size={16} className="text-amber-700 shrink-0" />,
  na: <CircleDashed size={16} className="text-slate-600 shrink-0" />
};

const normalise = (raw) => {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).toString();
  } catch (e) {
    return '';
  }
};

const hostOf = (u) => {
  try {
    return new URL(u).hostname;
  } catch (e) {
    return u;
  }
};

export default function WebsiteAuditTool({ defaultUrl = 'https://morayamultispecialitycharitablehospital.com/cataract-surgery-in-pcmc' }) {
  const [url, setUrl] = useState(defaultUrl);
  const [strategy, setStrategy] = useState('mobile');
  const [current, setCurrent] = useState(null);
  const audit = useApi(current ? `/website-audits/${current}` : null);
  const history = useApi('/website-audits');
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const [showPassed, setShowPassed] = useState(false);

  useEffect(() => {
    if (defaultUrl) setUrl(defaultUrl);
  }, [defaultUrl]);

  const running = audit.data && ['queued', 'running'].includes(audit.data.status);
  usePoll(() => audit.reload(true), Boolean(running), 2500);
  useEffect(() => {
    if (audit.data && !running) history.reload(true);
  }, [audit.data?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => run('start', async () => {
    const target = normalise(url);
    if (!target) throw new Error('Enter a website address, e.g. https://morayamultispecialitycharitablehospital.com/cataract-surgery-in-pcmc');
    const r = await api('/website-audits', { method: 'POST', body: { url: target, strategy, crawl_pages: 10 } });
    setCurrent(r.id);
  });

  const a = audit.data && !running ? audit.data : null;
  const ps = a?.result?.pagespeed;
  const crawl = a?.result?.crawl;
  const checks = ps?.seo_checks || [];
  const failed = checks.filter(c => c.status === 'fail');
  const passed = checks.filter(c => c.status === 'pass');
  const crawlIssues = (a?.issues || []).filter(i => !['Technical', 'Speed'].includes(i.area));
  const prev = a ? (history.data || []).find(h => h.target === a.target && h.id !== a.id && h.status === 'done') : null;

  const downloadPdf = () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    let y = 50;
    const ensure = (n = 20) => { if (y > H - n - 40) { doc.addPage(); y = 50; } };
    doc.setFontSize(17); doc.text('Website SEO audit', 40, y); y += 18;
    doc.setFontSize(10); doc.setTextColor(82, 81, 78); doc.text(`${a.target} · ${fmtDateTime(a.finished_at)}`, 40, y); y += 24;
    doc.setTextColor(17, 24, 39); doc.setFontSize(12);
    if (ps) Object.entries(ps.scores).forEach(([k, v]) => { doc.text(`${k.replace('_', ' ')}: ${v ?? '—'}/100`, 40, y); y += 16; });
    if (crawl) { doc.text(`On-page crawl: ${crawl.score}/100 (${crawl.crawled} pages)`, 40, y); y += 16; }
    y += 8; doc.setFontSize(13); doc.text(`Issues (${a.issues.length})`, 40, y); y += 18; doc.setFontSize(10);
    a.issues.forEach(i => {
      ensure(30);
      doc.setTextColor(17, 24, 39);
      doc.text(`[${i.level}] ${i.title}`.slice(0, 110), 40, y);
      y += 12;
      if (i.fix) {
        doc.setTextColor(82, 81, 78);
        doc.splitTextToSize(i.fix, W - 100).forEach(l => { ensure(); doc.text(l, 52, y); y += 11; });
      }
      y += 3;
    });
    doc.save(`seo-audit-${hostOf(a.target)}-${(a.finished_at || '').slice(0, 10)}.pdf`);
    toast('Audit report downloaded');
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      <Card
        title="Neural Website & Core Web Vitals Audit"
        subtitle="Full Google Lighthouse evaluation (SEO, Performance, Accessibility, Best Practices) & on-page crawler"
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-[280px] text-[12px] text-slate-700 font-medium">
            Target Page URL
            <input
              className={`${inputCls} mt-1`}
              placeholder="https://morayamultispecialitycharitablehospital.com/cataract-surgery-in-pcmc"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && start()}
            />
          </label>
          <div className="flex gap-1.5 p-1 bg-slate-50 rounded-xl border border-slate-200">
            {[
              ['mobile', Smartphone, 'Mobile'],
              ['desktop', Monitor, 'Desktop']
            ].map(([s, I, l]) => (
              <button
                key={s}
                onClick={() => setStrategy(s)}
                className={`h-9 px-3.5 flex items-center gap-1.5 text-[12px] font-semibold rounded-lg cursor-pointer transition-all ${
                  strategy === s
                    ? 'bg-gradient-to-tr from-indigo-600 to-cyan-500 text-white shadow-md'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <I size={14} />
                <span>{l}</span>
              </button>
            ))}
          </div>
          <Button
            variant="primary"
            icon={Search}
            busy={busy === 'start' || running}
            onClick={start}
          >
            {running ? 'Analyzing (30–60 s)…' : 'Run Audit'}
          </Button>
        </div>
        <ErrorNote>{error || audit.error?.message}</ErrorNote>
        {a?.error && (
          <div className="mt-3 text-[12px] text-amber-800 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2 font-mono">
            {a.error}
          </div>
        )}
      </Card>

      {running && (
        <Card>
          <div className="py-12 flex flex-col items-center justify-center gap-3 text-[13px] text-slate-700">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-700">
              <Loader2 size={20} className="animate-spin" />
            </div>
            <span>Executing headless Chrome Lighthouse audit for {hostOf(audit.data.target)}…</span>
            <span className="text-[11px] text-slate-500 font-mono">Measuring LCP, TBT, CLS, and crawling subpages</span>
          </div>
        </Card>
      )}

      {a && a.status === 'done' && (
        <>
          <Card
            title={hostOf(a.target)}
            subtitle={`Audited ${fmtDateTime(a.finished_at)}${prev ? ` · previous audit ${fmtDateTime(prev.finished_at)} (score ${prev.score ?? '—'})` : ''}`}
            action={
              <Button icon={Download} variant="secondary" size="sm" onClick={downloadPdf}>
                Download PDF
              </Button>
            }
          >
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              {ps && [
                ['seo', 'SEO'],
                ['performance', 'Performance'],
                ['accessibility', 'Accessibility'],
                ['best_practices', 'Best Practices']
              ].map(([k, l]) => (
                <div key={k} className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <ScoreRing score={ps.scores[k] ?? 0} label={l} size={96} level={lhLevel(ps.scores[k] ?? 0)} />
                  <StatusPill level={lhLevel(ps.scores[k] ?? 0)}>{lhWord(ps.scores[k] ?? 0)}</StatusPill>
                </div>
              ))}
              {crawl && (
                <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <ScoreRing score={crawl.score} label="On-page" size={96} level={lhLevel(crawl.score)} />
                  <StatusPill level={lhLevel(crawl.score)}>{crawl.crawled} pages</StatusPill>
                </div>
              )}
            </div>
            {prev && a.score != null && prev.score != null && a.score !== prev.score && (
              <div className={`mt-3 text-center text-[12px] font-mono font-bold ${a.score > prev.score ? 'text-emerald-700' : 'text-rose-600'}`}>
                {a.score > prev.score ? <ArrowUp size={12} className="inline mr-1" /> : <ArrowDown size={12} className="inline mr-1" />}
                {Math.abs(a.score - prev.score)} points since previous audit
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            <div className="xl:col-span-2 space-y-5">
              {ps && (
                <Card
                  title="Google Lighthouse Audit Criteria"
                  action={
                    <button
                      onClick={() => setShowPassed(s => !s)}
                      className="text-[12px] text-cyan-700 hover:text-cyan-700 font-medium cursor-pointer"
                    >
                      {showPassed ? 'Hide' : 'Show'} {passed.length} passed
                    </button>
                  }
                >
                  <div className="divide-y divide-slate-200">
                    {[...failed, ...checks.filter(c => c.status === 'manual'), ...(showPassed ? passed : [])].map(c => (
                      <div key={c.id} className="flex items-start gap-3 py-3">
                        {ICON[c.status]}
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-semibold text-slate-900">
                            {c.title}{c.display_value ? <span className="text-slate-500 font-mono text-[11px]"> · {c.display_value}</span> : null}
                          </div>
                          {c.status !== 'pass' && (
                            <div className="text-[12px] text-slate-500 mt-0.5 leading-relaxed">{c.description}</div>
                          )}
                        </div>
                      </div>
                    ))}
                    {failed.length === 0 && !showPassed && (
                      <div className="py-4 text-[13px] text-emerald-700">Every automatic SEO check passed.</div>
                    )}
                  </div>
                </Card>
              )}

              {crawl && (
                <Card title={`On-Page Crawl Issues (${crawlIssues.length})`} subtitle="Deep crawler findings">
                  <div className="divide-y divide-slate-200">
                    {crawlIssues.map((i, n) => (
                      <div key={n} className="flex items-start gap-3 py-3">
                        <span className="w-24 shrink-0">
                          <StatusPill level={LEVEL[i.level] || 'info'}>{i.level}</StatusPill>
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-bold text-slate-900">{i.title}</div>
                          <div className="text-[12px] text-slate-500 mt-0.5">{i.fix}</div>
                        </div>
                      </div>
                    ))}
                    {crawlIssues.length === 0 && (
                      <div className="py-4 text-[13px] text-slate-500">No on-page issues found.</div>
                    )}
                  </div>
                </Card>
              )}
            </div>

            <div className="space-y-5">
              {ps && (
                <Card title="Lab Speed Metrics">
                  <div className="divide-y divide-slate-200 text-[13px]">
                    {[
                      ['Largest Contentful Paint (LCP)', ps.metrics.lcp],
                      ['Total Blocking Time (TBT)', ps.metrics.tbt],
                      ['Cumulative Layout Shift (CLS)', ps.metrics.cls],
                      ['First Contentful Paint (FCP)', ps.metrics.fcp],
                      ['Speed Index (SI)', ps.metrics.si]
                    ].map(([n, v]) => (
                      <div key={n} className="flex justify-between py-2">
                        <span className="text-slate-500">{n}</span>
                        <span className="font-mono font-bold text-slate-900">{v || '—'}</span>
                      </div>
                    ))}
                  </div>
                  {ps.opportunities.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-slate-200 space-y-2">
                      <span className="text-[11px] font-mono text-slate-500 uppercase tracking-wider">Speed Opportunities</span>
                      {ps.opportunities.map(o => (
                        <div key={o.title} className="flex justify-between text-[12px] gap-2">
                          <span className="text-slate-700">{o.title}</span>
                          <span className="text-emerald-700 font-mono font-semibold shrink-0">−{(o.savings_ms / 1000).toFixed(1)} s</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              )}

              {crawl && (
                <Card title="Core Standards">
                  <div className="space-y-2 text-[13px]">
                    {[
                      ['HTTPS Encryption', crawl.https],
                      ['robots.txt Active', crawl.robots_txt],
                      ['XML Sitemap Index', crawl.sitemap],
                      ['Crawlers Unblocked', !crawl.robots_blocks_all]
                    ].map(([l, ok]) => (
                      <div key={l} className="flex items-center gap-2 text-slate-700">
                        {ok ? <CheckCircle2 size={15} className="text-emerald-700" /> : <XCircle size={15} className="text-rose-600" />}
                        <span>{l}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          </div>

          {crawl?.pages?.length > 0 && (
            <Card title="Crawled URLs Index">
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="text-[11px] font-mono uppercase tracking-wider text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="p-2.5 text-left font-semibold">Page Permalink</th>
                      <th className="p-2.5 text-left font-semibold">Status</th>
                      <th className="p-2.5 text-right font-semibold">Title</th>
                      <th className="p-2.5 text-right font-semibold">Meta</th>
                      <th className="p-2.5 text-right font-semibold">H1</th>
                      <th className="p-2.5 text-right font-semibold">Words</th>
                      <th className="p-2.5 text-right font-semibold">Alt Missing</th>
                      <th className="p-2.5 text-left font-semibold">Schema</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 font-mono text-[12px]">
                    {crawl.pages.map(p => {
                      const bad = (ok) => (ok ? 'text-slate-700' : 'text-rose-600 font-bold');
                      return (
                        <tr key={p.url} className="hover:bg-slate-50 transition-colors">
                          <td className="p-2.5 text-cyan-700 max-w-[280px] truncate" title={p.url}>
                            {new URL(p.url).pathname}
                          </td>
                          <td className="p-2.5">
                            {p.status < 400 ? <Badge tone="green">{p.status}</Badge> : <Badge tone="red">{p.status}</Badge>}
                          </td>
                          <td className={`p-2.5 text-right ${bad(p.title_length >= 25 && p.title_length <= 60)}`}>{p.title_length}</td>
                          <td className={`p-2.5 text-right ${bad(p.meta_description_length > 0)}`}>{p.meta_description_length || 'none'}</td>
                          <td className={`p-2.5 text-right ${bad(p.h1_count === 1)}`}>{p.h1_count}</td>
                          <td className={`p-2.5 text-right ${bad(p.word_count >= 300)}`}>{p.word_count}</td>
                          <td className={`p-2.5 text-right ${bad(!p.images_missing_alt)}`}>{p.images_missing_alt}</td>
                          <td className="p-2.5 text-slate-500">{p.schema_types.join(', ') || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {a && a.status === 'failed' && (
        <Card>
          <div className="py-6 text-[13px] text-rose-700 bg-rose-500/10 border border-rose-500/20 rounded-xl p-4">
            The audit failed: {a.error}
          </div>
        </Card>
      )}

      <Card
        title="Audit Telemetry History"
        subtitle="Historical passes logged across managed client websites"
        action={<History size={15} className="text-slate-500" />}
      >
        {!history.data ? (
          <div className="py-6 flex justify-center text-slate-500">
            <Loader2 size={16} className="animate-spin text-cyan-700" />
          </div>
        ) : history.data.length === 0 ? (
          <div className="py-6 text-center text-[13px] text-slate-500">No audits yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="text-[11px] font-mono uppercase tracking-wider text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="p-2.5 text-left font-semibold">Website</th>
                  <th className="p-2.5 text-left font-semibold">Date</th>
                  <th className="p-2.5 text-right font-semibold">Score</th>
                  <th className="p-2.5 text-right font-semibold">Issues</th>
                  <th className="p-2.5 text-left font-semibold">Status</th>
                  <th className="p-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {history.data.slice(0, 20).map(h => (
                  <tr key={h.id} className={`hover:bg-slate-50 transition-colors ${h.id === current ? 'bg-indigo-600/15' : ''}`}>
                    <td className="p-2.5 text-slate-900 font-medium">{hostOf(h.target)}</td>
                    <td className="p-2.5 text-slate-500 font-mono text-[12px]">{fmtDateTime(h.finished_at || h.created_at)}</td>
                    <td className="p-2.5 text-right tabular-nums font-mono font-bold text-slate-900">{h.score ?? '—'}</td>
                    <td className="p-2.5 text-right tabular-nums font-mono text-slate-700">{(h.issues || []).length}</td>
                    <td className="p-2.5">
                      <Badge tone={h.status === 'done' ? 'green' : h.status === 'failed' ? 'red' : 'blue'}>{h.status}</Badge>
                    </td>
                    <td className="p-2.5 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => setCurrent(h.id)}>View</Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={running}
                        onClick={() => {
                          setUrl(h.target);
                          run('start', async () => {
                            const r = await api('/website-audits', { method: 'POST', body: { url: h.target, strategy, crawl_pages: 10 } });
                            setCurrent(r.id);
                          });
                        }}
                      >
                        Re-run
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {toastNode}
    </div>
  );
}
