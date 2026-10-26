import React, { useEffect, useState } from 'react';
import { jsPDF } from 'jspdf';
import { Search, Smartphone, Monitor, Download, CheckCircle2, XCircle, CircleDashed, History, ArrowUp, ArrowDown, Loader2 } from 'lucide-react';
import { Card, Button, StatusPill, Badge, ScoreRing, inputCls, ErrorNote, useToast, useAction } from './SeoUi';
import { api, useApi, usePoll, fmtDateTime } from './seoApi';

/**
 * Audit any website through the SEO backend: Google PageSpeed (Lighthouse) for SEO, speed,
 * accessibility and best practices, plus the backend's crawler for on-page checks on every page.
 * The PageSpeed key lives on the backend. History is shared (stored in the backend).
 */

const lhLevel = (s) => (s >= 90 ? 'good' : s >= 50 ? 'warning' : 'critical');
const lhWord = (s) => (s >= 90 ? 'Good' : s >= 50 ? 'Needs work' : 'Poor');
const LEVEL = { critical: 'critical', serious: 'serious', warning: 'warning', info: 'info' };
const ICON = { pass: <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />, fail: <XCircle size={16} className="text-[#d03b3b] shrink-0" />, manual: <CircleDashed size={16} className="text-amber-600 shrink-0" />, na: <CircleDashed size={16} className="text-gray-300 shrink-0" /> };
const normalise = (raw) => { const s = String(raw || '').trim(); if (!s) return ''; try { return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).toString(); } catch (e) { return ''; } };
const hostOf = (u) => { try { return new URL(u).hostname; } catch (e) { return u; } };

export default function WebsiteAuditTool({ defaultUrl = '' }) {
  const [url, setUrl] = useState(defaultUrl);
  const [strategy, setStrategy] = useState('mobile');
  const [current, setCurrent] = useState(null); // audit id being shown
  const audit = useApi(current ? `/website-audits/${current}` : null);
  const history = useApi('/website-audits');
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const [showPassed, setShowPassed] = useState(false);
  useEffect(() => { setUrl(defaultUrl); }, [defaultUrl]);
  const running = audit.data && ['queued', 'running'].includes(audit.data.status);
  usePoll(() => audit.reload(true), Boolean(running), 2500);
  useEffect(() => { if (audit.data && !running) history.reload(true); }, [audit.data?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => run('start', async () => {
    const target = normalise(url);
    if (!target) throw new Error('Enter a website address, e.g. https://example.com');
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
    const W = doc.internal.pageSize.getWidth(); const H = doc.internal.pageSize.getHeight();
    let y = 50;
    const ensure = (n = 20) => { if (y > H - n - 40) { doc.addPage(); y = 50; } };
    doc.setFontSize(17); doc.text('Website SEO audit', 40, y); y += 18;
    doc.setFontSize(10); doc.setTextColor(82, 81, 78); doc.text(`${a.target} · ${fmtDateTime(a.finished_at)}`, 40, y); y += 24;
    doc.setTextColor(17, 24, 39); doc.setFontSize(12);
    if (ps) Object.entries(ps.scores).forEach(([k, v]) => { doc.text(`${k.replace('_', ' ')}: ${v ?? '—'}/100`, 40, y); y += 16; });
    if (crawl) { doc.text(`On-page crawl: ${crawl.score}/100 (${crawl.crawled} pages)`, 40, y); y += 16; }
    y += 8; doc.setFontSize(13); doc.text(`Issues (${a.issues.length})`, 40, y); y += 18; doc.setFontSize(10);
    a.issues.forEach(i => { ensure(30); doc.setTextColor(17, 24, 39); doc.text(`[${i.level}] ${i.title}`.slice(0, 110), 40, y); y += 12; if (i.fix) { doc.setTextColor(82, 81, 78); doc.splitTextToSize(i.fix, W - 100).forEach(l => { ensure(); doc.text(l, 52, y); y += 11; }); } y += 3; });
    doc.save(`seo-audit-${hostOf(a.target)}-${(a.finished_at || '').slice(0, 10)}.pdf`);
    toast('Audit report downloaded');
  };

  return (
    <div className="space-y-4">
      <Card title="Check any website" subtitle="Google's Lighthouse checks (SEO, speed, accessibility, best practices) plus an on-page crawl of up to 10 pages">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1 min-w-[260px] text-[12px] text-gray-600">Website address<input className={`${inputCls} mt-1`} placeholder="https://yourwebsite.com" value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && start()} /></label>
          <div className="flex gap-1">{[['mobile', Smartphone, 'Mobile'], ['desktop', Monitor, 'Desktop']].map(([s, I, l]) => <button key={s} onClick={() => setStrategy(s)} className={`h-8 px-3 flex items-center gap-1.5 text-[13px] rounded border cursor-pointer ${strategy === s ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-300 text-gray-700'}`}><I size={13} />{l}</button>)}</div>
          <Button variant="primary" icon={Search} busy={busy === 'start' || running} onClick={start}>{running ? 'Auditing… (30–60 s)' : 'Run audit'}</Button>
        </div>
        <ErrorNote>{error || audit.error?.message}</ErrorNote>
        {a?.error && <div className="mt-2 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">{a.error}</div>}
      </Card>

      {running && <Card><div className="py-10 flex items-center justify-center gap-2 text-[13px] text-gray-600"><Loader2 size={16} className="animate-spin text-blue-600" /> Running Lighthouse and crawling {hostOf(audit.data.target)}…</div></Card>}

      {a && a.status === 'done' && (
        <>
          <Card title={hostOf(a.target)} subtitle={`Audited ${fmtDateTime(a.finished_at)}${prev ? ` · previous audit ${fmtDateTime(prev.finished_at)} (score ${prev.score ?? '—'})` : ''}`} action={<Button icon={Download} onClick={downloadPdf}>Download PDF</Button>}>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              {ps && [['seo', 'SEO'], ['performance', 'Performance'], ['accessibility', 'Accessibility'], ['best_practices', 'Best practices']].map(([k, l]) => (
                <div key={k} className="flex flex-col items-center gap-1 p-2"><ScoreRing score={ps.scores[k] ?? 0} label={l} size={100} level={lhLevel(ps.scores[k] ?? 0)} /><StatusPill level={lhLevel(ps.scores[k] ?? 0)}>{lhWord(ps.scores[k] ?? 0)}</StatusPill></div>
              ))}
              {crawl && <div className="flex flex-col items-center gap-1 p-2"><ScoreRing score={crawl.score} label="On-page" size={100} level={lhLevel(crawl.score)} /><StatusPill level={lhLevel(crawl.score)}>{crawl.crawled} pages</StatusPill></div>}
            </div>
            {prev && a.score != null && prev.score != null && a.score !== prev.score && (
              <div className={`mt-2 text-center text-[13px] font-medium ${a.score > prev.score ? 'text-[#006300]' : 'text-[#d03b3b]'}`}>{a.score > prev.score ? <ArrowUp size={12} className="inline" /> : <ArrowDown size={12} className="inline" />} {Math.abs(a.score - prev.score)} points since the previous audit</div>
            )}
          </Card>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="xl:col-span-2 space-y-4">
              {ps && (
                <Card title="Google SEO checks" action={<button onClick={() => setShowPassed(s => !s)} className="text-[12px] text-blue-700 hover:underline cursor-pointer">{showPassed ? 'Hide' : 'Show'} {passed.length} passed</button>}>
                  <div className="divide-y divide-gray-100">
                    {[...failed, ...checks.filter(c => c.status === 'manual'), ...(showPassed ? passed : [])].map(c => (
                      <div key={c.id} className="flex items-start gap-3 py-2.5">{ICON[c.status]}<div className="flex-1 min-w-0"><div className="text-[13px] text-gray-900">{c.title}{c.display_value ? <span className="text-gray-500"> · {c.display_value}</span> : null}</div>{c.status !== 'pass' && <div className="text-[12px] text-gray-600 mt-0.5">{c.description}</div>}</div></div>
                    ))}
                    {failed.length === 0 && !showPassed && <div className="py-4 text-[13px] text-gray-600">Every automatic SEO check passed.</div>}
                  </div>
                </Card>
              )}
              {crawl && (
                <Card title={`On-page issues (${crawlIssues.length})`} subtitle="From crawling the site">
                  <div className="divide-y divide-gray-100">
                    {crawlIssues.map((i, n) => <div key={n} className="flex items-start gap-3 py-2"><span className="w-24 shrink-0"><StatusPill level={LEVEL[i.level] || 'info'}>{i.level}</StatusPill></span><div className="flex-1 min-w-0"><div className="text-[13px] text-gray-900">{i.title}</div><div className="text-[12px] text-gray-500">{i.fix}</div></div></div>)}
                    {crawlIssues.length === 0 && <div className="py-4 text-[13px] text-gray-600">No on-page issues found.</div>}
                  </div>
                </Card>
              )}
            </div>
            <div className="space-y-4">
              {ps && (
                <Card title="Speed (lab test)">
                  <div className="divide-y divide-gray-100 text-[13px]">
                    {[['Largest Contentful Paint', ps.metrics.lcp], ['Total Blocking Time', ps.metrics.tbt], ['Cumulative Layout Shift', ps.metrics.cls], ['First Contentful Paint', ps.metrics.fcp], ['Speed Index', ps.metrics.si]].map(([n, v]) => <div key={n} className="flex justify-between py-1.5"><span className="text-gray-600">{n}</span><span className="font-medium tabular-nums">{v || '—'}</span></div>)}
                  </div>
                  {ps.opportunities.length > 0 && <div className="mt-3 space-y-1.5">{ps.opportunities.map(o => <div key={o.title} className="flex justify-between text-[12px] gap-2"><span className="text-gray-800">{o.title}</span><span className="text-gray-500 shrink-0">−{(o.savings_ms / 1000).toFixed(1)} s</span></div>)}</div>}
                </Card>
              )}
              {crawl && (
                <Card title="Site basics">
                  <div className="space-y-1.5 text-[13px]">
                    {[['HTTPS', crawl.https], ['robots.txt found', crawl.robots_txt], ['XML sitemap', crawl.sitemap], ['Crawlers allowed', !crawl.robots_blocks_all]].map(([l, ok]) => <div key={l} className="flex items-center gap-2">{ok ? <CheckCircle2 size={15} className="text-emerald-600" /> : <XCircle size={15} className="text-[#d03b3b]" />}<span>{l}</span></div>)}
                  </div>
                </Card>
              )}
            </div>
          </div>
          {crawl?.pages?.length > 0 && (
            <Card title="Pages checked">
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="text-[12px] text-gray-500 border-b border-gray-200"><tr><th className="p-2 text-left font-medium">Page</th><th className="p-2 text-left font-medium">Status</th><th className="p-2 text-right font-medium">Title</th><th className="p-2 text-right font-medium">Meta</th><th className="p-2 text-right font-medium">H1</th><th className="p-2 text-right font-medium">Words</th><th className="p-2 text-right font-medium">No alt</th><th className="p-2 text-left font-medium">Schema</th></tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {crawl.pages.map(p => {
                      const bad = (ok) => (ok ? 'text-gray-800' : 'text-[#d03b3b] font-medium');
                      return (
                        <tr key={p.url}>
                          <td className="p-2 font-mono text-[12px] text-gray-800 max-w-[280px] truncate" title={p.url}>{new URL(p.url).pathname}</td>
                          <td className="p-2">{p.status < 400 ? <Badge tone="green">{p.status}</Badge> : <Badge tone="red">{p.status}</Badge>}</td>
                          <td className={`p-2 text-right tabular-nums ${bad(p.title_length >= 25 && p.title_length <= 60)}`}>{p.title_length}</td>
                          <td className={`p-2 text-right tabular-nums ${bad(p.meta_description_length > 0)}`}>{p.meta_description_length || 'none'}</td>
                          <td className={`p-2 text-right tabular-nums ${bad(p.h1_count === 1)}`}>{p.h1_count}</td>
                          <td className={`p-2 text-right tabular-nums ${bad(p.word_count >= 300)}`}>{p.word_count}</td>
                          <td className={`p-2 text-right tabular-nums ${bad(!p.images_missing_alt)}`}>{p.images_missing_alt}</td>
                          <td className="p-2 text-[12px] text-gray-600">{p.schema_types.join(', ') || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-gray-500 mt-2">Red = needs fixing.</p>
            </Card>
          )}
        </>
      )}
      {a && a.status === 'failed' && <Card><div className="py-6 text-[13px] text-red-700">The audit failed: {a.error}</div></Card>}

      <Card title="Audit history" subtitle="Every website audit run by the team" action={<History size={15} className="text-gray-400" />}>
        {!history.data ? <div className="py-6 flex justify-center text-gray-400"><Loader2 size={16} className="animate-spin" /></div> : history.data.length === 0 ? <div className="py-6 text-center text-[13px] text-gray-500">No audits yet.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="text-[12px] text-gray-500 border-b border-gray-200"><tr><th className="p-2 text-left font-medium">Website</th><th className="p-2 text-left font-medium">Date</th><th className="p-2 text-right font-medium">Score</th><th className="p-2 text-right font-medium">Issues</th><th className="p-2 text-left font-medium">Status</th><th className="p-2" /></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {history.data.slice(0, 20).map(h => (
                  <tr key={h.id} className={h.id === current ? 'bg-blue-50/50' : ''}>
                    <td className="p-2 text-gray-900">{hostOf(h.target)}</td>
                    <td className="p-2 text-gray-600">{fmtDateTime(h.finished_at || h.created_at)}</td>
                    <td className="p-2 text-right tabular-nums">{h.score ?? '—'}</td>
                    <td className="p-2 text-right tabular-nums">{(h.issues || []).length}</td>
                    <td className="p-2"><Badge tone={h.status === 'done' ? 'green' : h.status === 'failed' ? 'red' : 'blue'}>{h.status}</Badge></td>
                    <td className="p-2 text-right whitespace-nowrap"><Button size="sm" variant="ghost" onClick={() => setCurrent(h.id)}>View</Button><Button size="sm" variant="ghost" disabled={running} onClick={() => { setUrl(h.target); run('start', async () => { const r = await api('/website-audits', { method: 'POST', body: { url: h.target, strategy, crawl_pages: 10 } }); setCurrent(r.id); }); }}>Re-run</Button></td>
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
