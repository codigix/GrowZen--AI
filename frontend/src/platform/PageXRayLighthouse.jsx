import React, { useEffect, useRef, useState } from 'react';
import { Gauge, Loader2, Play, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react';
import { Button } from './SeoUi';
import { api } from './seoApi';
import Select from '../components/Select';

const fmtSize = (kb) => (kb == null ? '—' : kb >= 1024 ? `${(kb / 1024).toFixed(2)} MB` : `${Math.round(kb)} KB`);
const TYPE_TINT = { HTML: 'bg-sky-400', JavaScript: 'bg-amber-400', CSS: 'bg-violet-400', Images: 'bg-emerald-400', Fonts: 'bg-pink-400', Media: 'bg-cyan-400', Other: 'bg-slate-400' };
const short = (u) => { try { const x = new URL(u); return `${x.hostname}${x.pathname}`.slice(0, 70); } catch { return String(u || '').slice(0, 70); } };
const weightTone = (kb) => (kb == null ? 'text-slate-400' : kb <= 1500 ? 'text-emerald-600' : kb <= 3000 ? 'text-amber-600' : 'text-red-600');

/**
 * Full page weight and colour contrast: a real Lighthouse run (Google PageSpeed Insights), started by a button because it takes up to a minute.
 * The X-Ray itself reads the HTML only, so this is where images, scripts, styles and fonts are counted and where text colours are tested.
 */
export default function FullPageCard({ b, url }) {
  const [state, setState] = useState({ phase: 'idle' }); // idle | loading | done | error
  const [strategy, setStrategy] = useState('mobile');
  const [secs, setSecs] = useState(0);
  const seq = useRef(0);
  useEffect(() => { seq.current += 1; setState({ phase: 'idle' }); }, [url]); // a new page: the old numbers no longer belong to it
  useEffect(() => {
    if (state.phase !== 'loading') return undefined;
    setSecs(0);
    const t = setInterval(() => setSecs(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [state.phase]);

  const measure = async () => {
    const mine = ++seq.current;
    setState({ phase: 'loading' });
    try {
      const data = await api(`/businesses/${b.id}/page-xray/lighthouse`, { method: 'POST', body: { url, strategy } });
      if (mine === seq.current) setState({ phase: 'done', data });
    } catch (e) {
      if (mine === seq.current) setState({ phase: 'error', error: e.message || 'Lighthouse could not measure this page.' });
    }
  };
  const d = state.data;
  const w = d?.weight, c = d?.contrast;
  const maxKb = Math.max(1, ...(w?.by_type || []).map(t => t.kb));

  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 min-w-0">
      <h3 className="flex flex-wrap items-center gap-3 mb-4">
        <span className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0"><Gauge size={16} aria-hidden="true" /></span><span className="text-16 font-semibold text-slate-900">Full page weight &amp; colour contrast</span>
        <span className="ml-auto text-12 font-normal text-slate-500">Real Lighthouse run · Google PageSpeed Insights</span>
      </h3>

      {state.phase === 'idle' && (
        <div className="flex flex-wrap items-center gap-3 py-1">
          <p className="text-13 text-slate-600 flex-1 min-w-[240px]">The report above counts the HTML document only. Measure the whole page (images, scripts, styles, fonts, third-party files) and test the colour contrast of its text.</p>
          <label className="text-12 text-slate-500 inline-flex items-center gap-1.5">Device
            <Select value={strategy} onChange={e => setStrategy(e.target.value)} className="h-8 w-28 rounded ring-1 ring-slate-300 bg-white px-2 text-12.5 text-slate-800" aria-label="Device">
              <option value="mobile">Mobile</option><option value="desktop">Desktop</option>
            </Select>
          </label>
          <Button variant="primary" icon={Play} onClick={measure}>Measure full page</Button>
        </div>
      )}

      {state.phase === 'loading' && (
        <div className="flex items-center gap-3 py-3 text-13 text-slate-600" role="status" aria-live="polite">
          <Loader2 size={18} className="animate-spin text-indigo-500" />
          <span>Lighthouse is loading the page in Chrome and testing every file and colour. This takes 20 to 60 seconds. <b className="tabular-nums">{secs}s</b></span>
        </div>
      )}

      {state.phase === 'error' && (
        <div className="py-1">
          <p className="text-13 text-red-700 bg-red-50 rounded px-3 py-2">{state.error}</p>
          <Button className="mt-2" size="sm" icon={Play} onClick={measure}>Try again</Button>
        </div>
      )}

      {state.phase === 'done' && d && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-12 text-slate-500">
            <span>{d.strategy === 'mobile' ? 'Mobile' : 'Desktop'} test of <b className="text-slate-700">{short(d.final_url || d.url)}</b></span>
            {d.accessibility_score != null && <span>Accessibility score <b className="text-slate-800">{d.accessibility_score}</b></span>}
            {d.performance_score != null && <span>Performance score <b className="text-slate-800">{d.performance_score}</b></span>}
            {d.metrics?.lcp && <span>LCP <b className="text-slate-800">{d.metrics.lcp}</b></span>}
            {d.metrics?.tbt && <span>TBT <b className="text-slate-800">{d.metrics.tbt}</b></span>}
            {d.metrics?.cls && <span>CLS <b className="text-slate-800">{d.metrics.cls}</b></span>}
            <button type="button" onClick={measure} className="ml-auto text-indigo-600 font-semibold hover:underline cursor-pointer">Measure again</button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="min-w-0">
              <div className="flex items-end gap-3 mb-2">
                <div><div className="text-11 text-slate-500">Total page weight</div><div className={`text-24 font-bold tabular-nums leading-tight ${weightTone(w.total_kb)}`}>{fmtSize(w.total_kb)}</div></div>
                <div><div className="text-11 text-slate-500">Requests</div><div className="text-18 font-bold text-slate-800 tabular-nums leading-tight">{w.requests}</div></div>
                <div><div className="text-11 text-slate-500">Third-party</div><div className="text-18 font-bold text-slate-800 tabular-nums leading-tight">{w.third_party.requests} <span className="text-12 font-medium text-slate-500">· {fmtSize(w.third_party.kb)}</span></div></div>
              </div>
              <ul className="space-y-1.5">
                {w.by_type.map(t => (
                  <li key={t.key} className="flex items-center gap-2 text-12.5">
                    <span className="w-20 shrink-0 text-slate-600">{t.type}</span>
                    <span className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><span className={`block h-full rounded-full ${TYPE_TINT[t.type] || 'bg-slate-400'}`} style={{ width: `${Math.max(2, (t.kb / maxKb) * 100)}%` }} /></span>
                    <span className="w-24 shrink-0 text-right tabular-nums text-slate-700">{fmtSize(t.kb)} <span className="text-slate-400">· {t.requests}</span></span>
                  </li>
                ))}
              </ul>
              {w.heaviest.length > 0 && (
                <div className="mt-3">
                  <div className="text-11 font-semibold uppercase tracking-wide text-slate-500 mb-1">Heaviest files</div>
                  <ul className="divide-y divide-slate-100">{w.heaviest.slice(0, 5).map((h, i) => <li key={i} className="py-1 flex gap-2 text-12"><a href={h.url} target="_blank" rel="noreferrer" className="flex-1 min-w-0 truncate text-slate-700 hover:text-indigo-600" title={h.url}>{short(h.url)}</a><span className="tabular-nums text-slate-600 shrink-0">{fmtSize(h.kb)}</span></li>)}</ul>
                </div>
              )}
              {w.savings.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">{w.savings.map(s => <span key={s.id} className="text-11.5 rounded bg-amber-50 text-amber-800 px-2 py-0.5">{s.title}: save about {fmtSize(s.kb)}</span>)}</div>
              )}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-2">
                {!c.checked ? <AlertTriangle size={18} className="text-amber-500" /> : c.passed ? <CheckCircle2 size={18} className="text-emerald-600" /> : <AlertTriangle size={18} className="text-red-500" />}
                <div className="text-14 font-semibold text-slate-900">Colour contrast: {!c.checked ? 'not tested' : c.passed ? 'all text passes' : `${c.failing_count} element${c.failing_count === 1 ? '' : 's'} fail`}</div>
              </div>
              {!c.checked && <p className="text-12.5 text-slate-500">{(d.notes || []).find(n => /contrast/i.test(n)) || 'Lighthouse could not test the contrast on this page.'}</p>}
              {c.checked && c.passed && <p className="text-12.5 text-slate-500">Every piece of visible text that Lighthouse could test meets the WCAG contrast minimum (4.5:1 for normal text, 3:1 for large text).</p>}
              {c.failing.length > 0 && (
                <ul className="divide-y divide-slate-100">
                  {c.failing.slice(0, 12).map((f, i) => (
                    <li key={i} className="py-2 flex gap-3 items-start">
                      <span className="shrink-0 flex rounded overflow-hidden ring-1 ring-slate-200" aria-hidden="true" title={`Text ${f.fg} on ${f.bg}`}>
                        <span className="w-6 h-8" style={{ background: f.fg || '#ddd' }} /><span className="w-6 h-8" style={{ background: f.bg || '#fff' }} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-12.5 text-slate-800"><b className="tabular-nums text-red-600">{f.ratio ?? '—'}:1</b> <span className="text-slate-500">needs {f.expected ?? 4.5}:1</span> · <span className="font-mono text-11.5">{f.fg || '—'}</span> on <span className="font-mono text-11.5">{f.bg || '—'}</span>{f.font_size ? <span className="text-slate-500"> · {f.font_size}</span> : null}</div>
                        <div className="text-11.5 text-slate-500 truncate" title={f.snippet}>{f.selector || f.label || f.snippet}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {c.failing_count > 12 && <p className="text-11.5 text-slate-400 mt-1">Showing 12 of {c.failing_count}. Download the JSON report for the full list.</p>}
              {(d.notes || []).filter(n => !/contrast/i.test(n)).map((n, i) => <p key={i} className="text-11.5 text-slate-400 mt-2">{n}</p>)}
              <a href={`https://pagespeed.web.dev/analysis?url=${encodeURIComponent(d.final_url || d.url)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-12 text-indigo-600 hover:underline mt-3"><ExternalLink size={11} />Open the full Lighthouse report</a>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
