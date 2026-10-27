import React, { useEffect, useMemo, useState } from 'react';
import { jsPDF } from 'jspdf';
import {
  Search, Smartphone, Monitor, Download, CheckCircle2, XCircle, CircleDashed, History, ArrowUp, ArrowDown, Loader2, Globe, Gauge,
  FileText, ShieldCheck, RotateCw, ExternalLink, Accessibility, BadgeCheck, Sparkles, Clock, ArrowRight
} from 'lucide-react';
import { Card, Button, Badge, ScoreRing, inputCls, ErrorNote, useToast, useAction } from './SeoUi';
import { api, useApi, usePoll, fmtDateTime } from './seoApi';
import Improvements from './OnPageImprovements';
import { PagesCard } from './SitePages';
import { pathOnly as pathOf, hostOf, LEVEL_ORDER, SEVERITY_TONE as TONE } from './siteUtils';
import LighthouseDetails from './LighthouseDetails';

/**
 * Audit any website through the SEO backend: Google PageSpeed (Lighthouse) for SEO, speed,
 * accessibility and best practices, plus the backend's crawler for on-page checks on every page.
 * Results are ranked into improvements with step-by-step fixes (OnPageImprovements).
 */

const LEVELS = ['critical', 'serious', 'warning', 'info'];
const lhLevel = (s) => (s >= 90 ? 'good' : s >= 50 ? 'warning' : 'critical');
const lhWord = (s) => (s >= 90 ? 'Good' : s >= 50 ? 'Needs work' : 'Poor');
const LH_TEXT = { good: 'text-emerald-700', warning: 'text-amber-700', critical: 'text-red-600' };
const CATEGORIES = [['seo', 'SEO', Search], ['performance', 'Performance', Gauge], ['accessibility', 'Accessibility', Accessibility], ['best_practices', 'Best practices', BadgeCheck]];

/** Google's Core Web Vitals thresholds (good / poor) per lab metric, in seconds except CLS. */
const VITALS = [
  ['lcp', 'Largest Contentful Paint', 'Main content visible', 2.5, 4],
  ['tbt', 'Total Blocking Time', 'Page responds to taps', 0.2, 0.6],
  ['cls', 'Cumulative Layout Shift', 'Layout stays still', 0.1, 0.25],
  ['fcp', 'First Contentful Paint', 'First text or image', 1.8, 3],
  ['si', 'Speed Index', 'How fast it fills in', 3.4, 5.8]
];
const toSeconds = (v) => {
  const m = String(v || '').replace(/,/g, '').match(/([\d.]+)\s*(ms|s)?/);
  if (!m) return null;
  return m[2] === 'ms' ? Number(m[1]) / 1000 : Number(m[1]);
};
const vitalLevel = (v, good, poor) => (v == null ? null : v <= good ? 'good' : v <= poor ? 'warning' : 'critical');
const FIELD_WORD = { FAST: ['Good', 'good'], AVERAGE: ['Needs work', 'warning'], SLOW: ['Poor', 'critical'] };

const normalise = (raw) => {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).toString();
  } catch (e) {
    return '';
  }
};

/** A name for suggestions on sites that aren't a saved business: the home page title's brand part, else the domain. */
function siteBrand(target, pages) {
  const home = pages.find(p => pathOf(p.url) === '/') || pages[0];
  const parts = (home?.title || '').split(/\s[|–—-]\s/).map(s => s.trim()).filter(Boolean);
  if (parts.length > 1) return parts[parts.length - 1].slice(0, 60);
  const label = hostOf(target).split('.')[0];
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : hostOf(target);
}

function verdict(a, issues) {
  const crit = issues.filter(i => i.level === 'critical').length;
  const ser = issues.filter(i => i.level === 'serious').length;
  if (a.score == null) return 'Partial result: see the notes above.';
  if (crit) return `${crit} critical problem${crit === 1 ? '' : 's'} can stop this site ranking. Fix ${crit === 1 ? 'it' : 'them'} first.`;
  if (a.score >= 90 && !ser) return 'Strong SEO foundations. Keep content fresh and re-check after big changes.';
  if (ser) return `Solid base, but ${ser} serious issue${ser === 1 ? '' : 's'} ${ser === 1 ? 'is' : 'are'} holding rankings back.`;
  return 'Good shape overall. A few smaller fixes will polish it.';
}

function Elapsed({ since }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.round((now - since) / 1000));
  return <span className="tabular-nums">{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>;
}

/** Live view while an audit runs: the page being scanned in a browser frame, and a log of every page checked. */
function LiveScan({ audit, startedAt, strategy }) {
  const prog = audit.result?.progress || {};
  const pages = prog.pages || [];
  const latest = pages[pages.length - 1];
  const shown = [...pages].reverse().find(p => p.frameable && p.status < 400);
  const max = prog.max_pages || 10;
  const done = prog.crawl === 'done';
  const pct = done ? 100 : Math.min(95, Math.round((pages.length / Math.max(1, Math.min(max, pages.length + (prog.queued || 0)))) * 100));
  const worst = (list) => list.reduce((w, i) => (LEVEL_ORDER[i.level] < LEVEL_ORDER[w] ? i.level : w), 'info');
  const Step = ({ state, label, detail }) => (
    <div className="flex items-center gap-2.5 text-[12.5px]">
      {state === 'running' ? <Loader2 size={14} className="animate-spin text-indigo-600 shrink-0" /> : state === true || state === 'done' ? <CheckCircle2 size={14} className="text-emerald-600 shrink-0" /> : state === false || state === 'failed' ? <XCircle size={14} className="text-red-600 shrink-0" /> : <CircleDashed size={14} className="text-slate-300 shrink-0" />}
      <span className="text-slate-800">{label}</span>{detail && <span className="text-slate-500 truncate">· {detail}</span>}
    </div>
  );
  return (
    <Card>
      <style>{'@keyframes ga-scan{0%{top:0}100%{top:calc(100% - 3px)}}'}</style>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-slate-900 flex items-center gap-2"><span className="relative flex w-2.5 h-2.5"><span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" /><span className="relative inline-flex rounded-full w-2.5 h-2.5 bg-emerald-500" /></span>Scanning {hostOf(audit.target)} live</div>
          <div className="text-[12px] text-slate-500">{pages.length} of up to {max} pages checked · Lighthouse on {strategy}</div>
        </div>
        {startedAt && <span className="text-[12px] text-slate-500 inline-flex items-center gap-1"><Clock size={12} /> <Elapsed since={startedAt} /></span>}
      </div>
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden mb-4"><div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-500 transition-all duration-700" style={{ width: `${pct}%` }} /></div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Browser frame */}
        <div className="lg:col-span-3 rounded-xl ring-1 ring-slate-200 overflow-hidden bg-white flex flex-col min-w-0">
          <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
            <span className="flex gap-1"><i className="w-2.5 h-2.5 rounded-full bg-red-300" /><i className="w-2.5 h-2.5 rounded-full bg-amber-300" /><i className="w-2.5 h-2.5 rounded-full bg-emerald-300" /></span>
            <div className="flex-1 min-w-0 h-7 px-2.5 rounded-md bg-white ring-1 ring-inset ring-slate-200 flex items-center gap-1.5 text-[11.5px] text-slate-600">
              {prog.current ? <Loader2 size={11} className="animate-spin text-indigo-500 shrink-0" /> : <Globe size={11} className="text-slate-400 shrink-0" />}
              <span className="truncate font-mono">{prog.current || shown?.url || latest?.url || audit.target}</span>
            </div>
          </div>
          <div className="relative h-[340px] bg-slate-50 overflow-hidden">
            {shown ? (
              <iframe key={shown.url} title={`Preview of ${shown.url}`} src={shown.url} referrerPolicy="no-referrer"
                // The site keeps its own origin (so its module scripts load); that is still isolated from this app,
                // except when the scanned page is on this app's origin, which gets the strict sandbox instead.
                sandbox={new URL(shown.url).origin === window.location.origin ? 'allow-scripts' : 'allow-scripts allow-same-origin'}
                className="absolute top-0 left-0 border-0 pointer-events-none origin-top-left" style={{ width: '200%', height: '200%', transform: 'scale(0.5)' }} />
            ) : latest ? (
              <div className="p-5">
                <div className="text-[11px] text-slate-500">This site blocks being shown inside other pages, so here is what the scanner read:</div>
                <div className="mt-3 rounded-lg bg-white ring-1 ring-slate-200 p-4">
                  <div className="text-[12px] text-emerald-700 font-mono truncate">{latest.url}</div>
                  <div className="text-[17px] text-indigo-700 font-medium leading-snug mt-0.5">{latest.title || 'No title'}</div>
                  <div className="text-[12.5px] text-slate-600 mt-1 line-clamp-2">{latest.meta_description || 'No meta description. Google will pick text from the page.'}</div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  {[['H1', latest.h1 || '—'], ['Words', latest.word_count], ['Images', `${latest.images - latest.images_missing_alt}/${latest.images} with alt`]].map(([k, v]) => <div key={k} className="rounded-lg bg-white ring-1 ring-slate-200 px-2 py-2"><div className="text-[10.5px] uppercase tracking-wider text-slate-500">{k}</div><div className="text-[12.5px] font-semibold text-slate-900 truncate">{v}</div></div>)}
                </div>
              </div>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[12.5px] text-slate-500"><Loader2 size={20} className="animate-spin text-indigo-500" />Opening {hostOf(audit.target)}…</div>
            )}
            {shown && <div className="absolute bottom-2 left-2 text-[10.5px] font-medium text-white bg-slate-900/75 rounded-md px-2 py-1 max-w-[90%] truncate">Preview of {pathOf(shown.url)} · last page scanned</div>}
            {!done && <div className="absolute left-0 right-0 h-[3px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_2px_rgba(34,211,238,0.6)]" style={{ animation: 'ga-scan 2.2s ease-in-out infinite alternate' }} />}
          </div>
        </div>

        {/* Live log */}
        <div className="lg:col-span-2 min-w-0 flex flex-col">
          <div className="space-y-1.5 mb-3">
            <Step state={prog.robots ?? (pages.length ? null : 'running')} label="robots.txt" detail={prog.robots === false ? 'not found' : null} />
            <Step state={prog.sitemap ?? (prog.robots !== undefined ? 'running' : null)} label="XML sitemap" detail={prog.sitemap === false ? 'not found' : null} />
            <Step state={done ? 'done' : prog.robots !== undefined ? 'running' : null} label="Crawling pages" detail={`${pages.length} checked${prog.queued ? `, ${prog.queued} queued` : ''}`} />
            <Step state={prog.lighthouse || 'running'} label="Google Lighthouse" detail={prog.lighthouse === 'done' ? 'scores ready' : prog.lighthouse === 'failed' ? 'unavailable' : 'measuring speed & SEO'} />
          </div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Pages scanned</div>
          <div className="flex-1 max-h-[262px] overflow-y-auto rounded-xl ring-1 ring-inset ring-slate-200 divide-y divide-slate-100">
            {prog.current && (
              <div className="px-3 py-2 flex items-center gap-2 bg-indigo-50/60"><Loader2 size={13} className="animate-spin text-indigo-600 shrink-0" /><span className="font-mono text-[11.5px] text-indigo-800 truncate">{pathOf(prog.current)}</span></div>
            )}
            {[...pages].reverse().map(p => (
              <div key={p.url} className="px-3 py-2">
                <div className="flex items-center gap-2">
                  {p.status >= 400 ? <XCircle size={13} className="text-red-600 shrink-0" /> : p.issues.length ? <span className={`text-[10px] font-bold px-1.5 rounded-full ring-1 ring-inset shrink-0 ${TONE[worst(p.issues)]}`}>{p.issues.length}</span> : <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />}
                  <span className="font-mono text-[11.5px] text-slate-800 truncate">{pathOf(p.url)}</span>
                  <span className="ml-auto text-[10.5px] text-slate-400 shrink-0 tabular-nums">{p.status >= 400 ? `HTTP ${p.status}` : `${p.word_count} words`}</span>
                </div>
                {p.issues[0] && <div className="text-[11px] text-slate-500 truncate pl-5 mt-0.5">{p.issues[0].title.replace(/^\/\S*:?\s/, '')}{p.issues.length > 1 ? ` +${p.issues.length - 1} more` : ''}</div>}
              </div>
            ))}
            {!pages.length && !prog.current && <div className="px-3 py-6 text-center text-[12px] text-slate-400">Waiting for the first page…</div>}
          </div>
        </div>
      </div>
    </Card>
  );
}

function CategoryTile({ label, icon: Icon, score, sub }) {
  const lvl = score == null ? null : lhLevel(score);
  return (
    <div className="rounded-xl ring-1 ring-inset ring-slate-200 bg-white p-3.5">
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500"><Icon size={13} /> {label}</div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className={`text-[26px] font-bold tabular-nums leading-none ${lvl ? LH_TEXT[lvl] : 'text-slate-400'}`}>{score ?? '—'}</span>
        <span className="text-[12px] text-slate-400">/100</span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full rounded-full ${lvl === 'good' ? 'bg-emerald-500' : lvl === 'warning' ? 'bg-amber-400' : 'bg-red-500'}`} style={{ width: `${score ?? 0}%` }} /></div>
      <div className="mt-1.5 text-[11px] text-slate-500">{sub || (score == null ? 'Not measured' : lhWord(score))}</div>
    </div>
  );
}

function Vitals({ ps }) {
  const field = ps.field || {};
  const hasField = Object.values(field).some(Boolean);
  return (
    <Card title="Core Web Vitals" subtitle={`Google Lighthouse lab test · ${ps.strategy === 'desktop' ? 'desktop' : 'mobile'}`}>
      {ps.filmstrip?.length > 0 && (
        <div className="mb-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">How the page loaded</div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {ps.filmstrip.map(f => (
              <figure key={f.ms} className="shrink-0 w-[58px]">
                <img src={f.data} alt={`Page at ${(f.ms / 1000).toFixed(1)} s`} className="w-full rounded ring-1 ring-slate-200 bg-white" />
                <figcaption className="text-[10px] text-slate-500 text-center tabular-nums mt-0.5">{(f.ms / 1000).toFixed(1)} s</figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-3">
        {VITALS.map(([k, name, hint, good, poor]) => {
          const raw = ps.metrics?.[k];
          const v = toSeconds(raw);
          const lvl = vitalLevel(v, good, poor);
          const pct = v == null ? 0 : Math.min(100, (v / (poor * 1.5)) * 100);
          return (
            <div key={k}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] text-slate-800">{name} <span className="text-[11px] text-slate-400">· {hint}</span></span>
                <span className={`text-[13px] font-bold tabular-nums ${lvl ? LH_TEXT[lvl] : 'text-slate-400'}`}>{raw || '—'}</span>
              </div>
              <div className="mt-1 relative h-1.5 rounded-full overflow-hidden flex">
                <div className="h-full bg-emerald-100" style={{ width: `${(good / (poor * 1.5)) * 100}%` }} />
                <div className="h-full bg-amber-100" style={{ width: `${((poor - good) / (poor * 1.5)) * 100}%` }} />
                <div className="h-full bg-red-100 flex-1" />
                {v != null && <div className={`absolute top-0 h-full w-1 rounded-full ${lvl === 'good' ? 'bg-emerald-600' : lvl === 'warning' ? 'bg-amber-500' : 'bg-red-600'}`} style={{ left: `calc(${pct}% - 2px)` }} />}
              </div>
            </div>
          );
        })}
      </div>
      {hasField && (
        <div className="mt-4 pt-3 border-t border-slate-100">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Real visitors (Chrome UX Report)</div>
          <div className="flex flex-wrap gap-1.5">
            {[['lcp', 'LCP'], ['inp', 'INP'], ['cls', 'CLS']].map(([k, l]) => field[k] && (
              <span key={k} className={`text-[11px] font-semibold px-2 py-1 rounded-lg ring-1 ring-inset ${FIELD_WORD[field[k]]?.[1] === 'good' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : FIELD_WORD[field[k]]?.[1] === 'warning' ? 'bg-amber-50 text-amber-700 ring-amber-200' : 'bg-red-50 text-red-700 ring-red-200'}`}>{l}: {FIELD_WORD[field[k]]?.[0] || field[k]}</span>
            ))}
          </div>
        </div>
      )}
      {ps.opportunities?.length > 0 && (
        <div className="mt-4 pt-3 border-t border-slate-100">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Biggest speed wins</div>
          {ps.opportunities.map(o => (
            <div key={o.title} className="flex justify-between gap-3 py-1 text-[12.5px]">
              <span className="text-slate-700">{o.title}</span>
              <span className="text-emerald-700 font-semibold tabular-nums shrink-0">−{(o.savings_ms / 1000).toFixed(1)} s</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Foundations({ crawl }) {
  const pages = crawl.pages || [];
  const live = pages.filter(p => p.status < 400);
  const titles = live.map(p => p.title).filter(Boolean);
  const rows = [
    ['Served over HTTPS', crawl.https, 'Install SSL and redirect HTTP to HTTPS.'],
    ['robots.txt found', crawl.robots_txt, 'Add a robots.txt with a Sitemap line.'],
    ['Search engines allowed', !crawl.robots_blocks_all, 'robots.txt blocks every crawler.'],
    ['XML sitemap', crawl.sitemap, 'Publish /sitemap.xml and submit it in Search Console.'],
    ['Business structured data', live.some(p => (p.schema_types || []).some(t => /LocalBusiness|Organization|Dentist|Clinic|Restaurant|Store|Hospital/.test(t))), 'Add LocalBusiness JSON-LD.'],
    ['Mobile viewport on every page', live.every(p => p.has_viewport), `${live.filter(p => !p.has_viewport).length} page(s) missing it.`],
    ['No broken pages', !(crawl.broken || []).length, `${(crawl.broken || []).length} broken URL(s) found.`],
    ['All pages indexable', !live.some(p => p.noindex), `${live.filter(p => p.noindex).length} page(s) set to noindex.`],
    ['Unique page titles', new Set(titles).size === titles.length, 'Some pages share the same title.']
  ];
  const ok = rows.filter(r => r[1]).length;
  return (
    <Card title="Site foundations" subtitle={`${ok} of ${rows.length} in place`}>
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden mb-3"><div className={`h-full rounded-full ${ok === rows.length ? 'bg-emerald-500' : ok >= rows.length - 2 ? 'bg-amber-400' : 'bg-red-500'}`} style={{ width: `${(ok / rows.length) * 100}%` }} /></div>
      <div className="space-y-2">
        {rows.map(([l, good, hint]) => (
          <div key={l} className="flex items-start gap-2">
            {good ? <CheckCircle2 size={15} className="text-emerald-600 shrink-0 mt-px" /> : <XCircle size={15} className="text-red-600 shrink-0 mt-px" />}
            <div className="min-w-0"><div className="text-[13px] text-slate-800">{l}</div>{!good && <div className="text-[11.5px] text-slate-500">{hint}</div>}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function LighthouseChecks({ checks }) {
  const [showPassed, setShowPassed] = useState(false);
  const failed = checks.filter(c => c.status === 'fail');
  const manual = checks.filter(c => c.status === 'manual');
  const passed = checks.filter(c => c.status === 'pass');
  const ICON = { pass: <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />, fail: <XCircle size={16} className="text-red-600 shrink-0 mt-0.5" />, manual: <CircleDashed size={16} className="text-slate-400 shrink-0 mt-0.5" /> };
  return (
    <Card title="Google's SEO checks" subtitle={`Lighthouse · ${passed.length} passed, ${failed.length} failed${manual.length ? `, ${manual.length} to check by hand` : ''}`}
      action={passed.length > 0 && <button type="button" onClick={() => setShowPassed(s => !s)} className="text-[12px] font-semibold text-indigo-700 hover:underline cursor-pointer">{showPassed ? 'Hide passed' : 'Show passed'}</button>}>
      <div className="divide-y divide-slate-100">
        {[...failed, ...manual, ...(showPassed ? passed : [])].map(c => (
          <div key={c.id} className="flex items-start gap-3 py-2.5">
            {ICON[c.status]}
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-slate-900">{c.title}{c.display_value ? <span className="text-slate-500 font-normal"> · {c.display_value}</span> : null}</div>
              {c.status !== 'pass' && c.description && <div className="text-[12px] text-slate-500 mt-0.5 leading-relaxed">{c.description}</div>}
            </div>
          </div>
        ))}
        {failed.length === 0 && !showPassed && <div className="py-3 text-[13px] text-emerald-700 flex items-center gap-1.5"><CheckCircle2 size={15} /> Every automatic SEO check passed.</div>}
      </div>
    </Card>
  );
}

function HistoryCard({ history, current, running, onView, onRerun }) {
  const [q, setQ] = useState('');
  const list = (history.data || []).filter(h => !q || h.target.toLowerCase().includes(q.toLowerCase())).slice(0, 20);
  return (
    <Card title="Recent audits" subtitle="Every website checked by your team" action={<History size={15} className="text-slate-400" />}>
      {!history.data ? (
        <div className="py-6 flex justify-center text-slate-500"><Loader2 size={16} className="animate-spin" /></div>
      ) : history.data.length === 0 ? (
        <div className="py-6 text-center text-[13px] text-slate-500">No audits yet. Run your first one above.</div>
      ) : (
        <>
          {history.data.length > 6 && <input className={`${inputCls} mb-3`} placeholder="Filter by website" value={q} onChange={e => setQ(e.target.value)} />}
          <div className="divide-y divide-slate-100">
            {list.map(h => {
              const lvl = h.score == null ? null : lhLevel(h.score);
              return (
                <div key={h.id} className={`flex items-center gap-3 py-2.5 px-2 -mx-2 rounded-lg ${h.id === current ? 'bg-indigo-50' : ''}`}>
                  <span className={`w-10 h-10 rounded-xl flex items-center justify-center text-[14px] font-bold tabular-nums shrink-0 ${lvl === 'good' ? 'bg-emerald-50 text-emerald-700' : lvl === 'warning' ? 'bg-amber-50 text-amber-700' : lvl ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-400'}`}>
                    {h.status === 'done' ? h.score ?? '—' : ['queued', 'running'].includes(h.status) ? <Loader2 size={14} className="animate-spin" /> : '!'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-slate-900 truncate" title={h.target}>{hostOf(h.target)}<span className="text-slate-400 font-normal">{pathOf(h.target) !== '/' ? pathOf(h.target) : ''}</span></div>
                    <div className="text-[11.5px] text-slate-500">{fmtDateTime(h.finished_at || h.created_at)} · {h.status === 'failed' ? 'failed' : `${(h.issues || []).length} issues`}</div>
                  </div>
                  <div className="flex gap-1 shrink-0">
<Button size="sm" variant="ghost" onClick={() => onView(h)}>{['queued', 'running'].includes(h.status) ? 'Watch' : 'View'}</Button>
                    <Button size="sm" variant="ghost" icon={RotateCw} disabled={running} onClick={() => onRerun(h)} aria-label="Re-run audit" />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * One scan drives the whole flow: the Audit step runs it (live), the Report step shows it.
 * The report is the chosen scan, else the latest scan of the business's site, else the business's
 * own latest technical + on-page audits (e.g. from scheduled runs) shown in the same shape.
 */
export function useSiteAudit(business) {
  const site = business?.website || '';
  const [url, setUrl] = useState(site);
  const [strategy, setStrategy] = useState('mobile');
  const [crawlPages, setCrawlPages] = useState(10);
  const [current, setCurrent] = useState(null);
  const [startedAt, setStartedAt] = useState(null);
  const audit = useApi(current ? `/website-audits/${current}` : null);
  const history = useApi('/website-audits');
  const [busy, error, run] = useAction();
  const techList = useApi(business ? `/businesses/${business.id}/audits?kind=technical&limit=1` : null);
  const onpageList = useApi(business ? `/businesses/${business.id}/audits?kind=onpage&limit=1` : null);
  const tech = useApi(techList.data?.[0]?.status === 'done' ? `/businesses/${business.id}/audits/${techList.data[0].id}` : null);
  const onpage = useApi(onpageList.data?.[0]?.status === 'done' ? `/businesses/${business.id}/audits/${onpageList.data[0].id}` : null);

  useEffect(() => { setUrl(site); }, [site]);
  // Start on the latest finished scan of the business's site.
  useEffect(() => {
    if (current || !history.data || !site) return;
    const last = history.data.find(h => h.status === 'done' && hostOf(h.target) === hostOf(normalise(site)));
    if (last) setCurrent(last.id);
  }, [history.data, site]); // eslint-disable-line react-hooks/exhaustive-deps

  const running = Boolean(audit.data && ['queued', 'running'].includes(audit.data.status));
  usePoll(() => audit.reload(true), running, 1500);
  useEffect(() => {
    if (audit.data && !running) { history.reload(true); techList.reload(true); onpageList.reload(true); }
  }, [audit.data?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const launch = (target, pages = crawlPages) => run('start', async () => {
    const own = site && hostOf(target) === hostOf(site);
    const r = await api('/website-audits', { method: 'POST', body: { url: target, strategy, crawl_pages: pages, ...(own ? { business_id: business.id } : {}) } });
    setStartedAt(Date.now());
    setCurrent(r.id);
    history.reload(true);
  });
  const start = () => {
    const target = normalise(url);
    if (!target) return run('start', async () => { throw new Error('Enter a website address, e.g. https://yourbusiness.com'); });
    return launch(target);
  };

  let report = audit.data && audit.data.status === 'done' ? audit.data : null;
  if (!report && !running && !current && tech.data && onpage.data) {
    const seo = tech.data.result?.scores?.seo;
    const parts = [seo, onpage.data.score].filter(v => v != null);
    report = {
      id: `business-${onpage.data.id}`, target: site, status: 'done', fromBusiness: true,
      finished_at: [tech.data.finished_at, onpage.data.finished_at].sort().pop(),
      score: parts.length ? Math.round(parts.reduce((s, v) => s + v, 0) / parts.length) : null,
      issues: [...(tech.data.issues || []), ...(onpage.data.issues || [])],
      result: { pagespeed: tech.data.result, crawl: { ...onpage.data.result, score: onpage.data.score, crawled: (onpage.data.result?.pages || []).length } }
    };
  }
  return { url, setUrl, strategy, setStrategy, crawlPages, setCrawlPages, current, setCurrent, audit, history, busy, error, running, startedAt, launch, start, report };
}

/** Step 1: choose the site, run the scan and watch it live. */
export function AuditStep({ sa, business, onOpenReport }) {
  const { url, setUrl, strategy, setStrategy, crawlPages, setCrawlPages, busy, error, running, audit, report } = sa;
  const chip = (on) => `h-9 px-3 flex items-center gap-1.5 text-[12px] font-semibold rounded-lg cursor-pointer transition-colors ${on ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-900'}`;
  const own = business?.website && hostOf(normalise(url)) === hostOf(business.website);
  return (
    <div className="space-y-5">
      <Card>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 ring-1 ring-inset ring-indigo-100 flex items-center justify-center text-indigo-600 shrink-0"><Globe size={18} /></div>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-slate-900">Audit a website</div>
            <div className="text-[12px] text-slate-500">Google Lighthouse (SEO, speed, accessibility, best practices) plus a crawl of every page. Watch it scan live, then get the report.</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[240px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className={`${inputCls} pl-9 h-10`} placeholder="https://yourbusiness.com" value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && sa.start()} aria-label="Website address" />
          </div>
          <div className="flex gap-0.5 p-0.5 bg-slate-100 rounded-xl">
            {[['mobile', Smartphone, 'Mobile'], ['desktop', Monitor, 'Desktop']].map(([s, I, l]) => (
              <button key={s} type="button" onClick={() => setStrategy(s)} className={chip(strategy === s)}><I size={14} /> {l}</button>
            ))}
          </div>
          <select value={crawlPages} onChange={e => setCrawlPages(Number(e.target.value))} className="h-10 px-2.5 rounded-xl text-[12px] font-semibold text-slate-700 bg-white ring-1 ring-inset ring-slate-200 outline-none cursor-pointer" aria-label="Pages to crawl">
            {[5, 10, 25, 50].map(n => <option key={n} value={n}>Crawl {n} pages</option>)}
          </select>
          <Button variant="primary" icon={Search} busy={busy === 'start' || running} onClick={sa.start}>{running ? 'Auditing…' : 'Run audit'}</Button>
        </div>
        <div className="mt-2.5 text-[12px] text-slate-500">
          {own ? <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={13} className="text-emerald-600" /> {business.name}'s website: results also update its scores, dashboard and AI agent tasks.</span>
            : business?.website ? <>Checking another site (results aren't saved to {business.name}). <button type="button" onClick={() => setUrl(business.website)} className="font-medium text-indigo-700 hover:underline cursor-pointer">Use {hostOf(business.website)}</button></>
              : `${business?.name || 'This business'} has no website on file yet; you can still check any site.`}
        </div>
        <ErrorNote>{error || audit.error?.message}</ErrorNote>
      </Card>

      {running && <LiveScan audit={audit.data} startedAt={sa.startedAt} strategy={strategy} />}

      {!running && audit.data?.status === 'failed' && (
        <Card>
          <div className="flex items-start gap-3">
            <XCircle size={18} className="text-red-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-slate-900">The audit of {hostOf(audit.data.target)} couldn't finish</div>
              <div className="text-[12.5px] text-slate-600 mt-0.5 break-words">{audit.data.error || 'The site could not be reached.'}</div>
              <div className="text-[12px] text-slate-500 mt-1">Check the address opens in a browser, then run it again.</div>
            </div>
          </div>
        </Card>
      )}

      {!running && report && (
        <Card>
          <div className="flex flex-wrap items-center gap-4">
            <span className={`w-14 h-14 rounded-2xl flex items-center justify-center text-[20px] font-bold tabular-nums shrink-0 ${report.score == null ? 'bg-slate-100 text-slate-400' : lhLevel(report.score) === 'good' ? 'bg-emerald-50 text-emerald-700' : lhLevel(report.score) === 'warning' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>{report.score ?? '—'}</span>
            <div className="flex-1 min-w-[200px]">
              <div className="text-[14px] font-semibold text-slate-900">Latest report · {hostOf(report.target)}</div>
              <div className="text-[12px] text-slate-500">{fmtDateTime(report.finished_at)} · {(report.issues || []).length} issues · {verdict(report, report.issues || [])}</div>
            </div>
            <Button variant="primary" icon={ArrowRight} onClick={onOpenReport}>View report</Button>
          </div>
        </Card>
      )}

      {!running && !report && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[[ShieldCheck, 'Technical health', 'HTTPS, robots.txt, sitemap, indexing, broken pages and structured data.'], [FileText, 'Every page checked', 'Titles, meta descriptions, headings, content depth and image alt text.'], [Sparkles, 'Fixes, not just scores', 'Problems ranked by impact, with ready-to-paste code and copy.']].map(([I, t, d]) => (
            <Card key={t}><div className="flex items-start gap-3"><div className="w-9 h-9 rounded-xl bg-slate-50 ring-1 ring-inset ring-slate-200 flex items-center justify-center text-slate-600 shrink-0"><I size={16} /></div><div><div className="text-[14px] font-semibold text-slate-900">{t}</div><div className="text-[12.5px] text-slate-500 mt-0.5">{d}</div></div></div></Card>
          ))}
        </div>
      )}

      <HistoryCard history={sa.history} current={sa.current} running={running || busy === 'start'}
        onView={h => { sa.setCurrent(h.id); if (h.status === 'done') onOpenReport(); }} onRerun={h => { setUrl(h.target); sa.launch(h.target); }} />
    </div>
  );
}

/** Step 2: the report for the scan: summary, ranked improvements, Google checks, vitals, foundations, pages. */
export function ReportStep({ sa, business, onNext }) {
  const [toast, toastNode] = useToast();
  const a = sa.report;
  const ps = a?.result?.pagespeed;
  const crawl = a?.result?.crawl;
  const pages = crawl?.pages || [];
  const issues = useMemo(() => [...(a?.issues || [])].sort((x, y) => (LEVEL_ORDER[x.level] ?? 9) - (LEVEL_ORDER[y.level] ?? 9)), [a]);
  const counts = Object.fromEntries(LEVELS.map(l => [l, issues.filter(i => i.level === l).length]));
  const prev = a && !a.fromBusiness ? (sa.history.data || []).find(h => h.target === a.target && h.id !== a.id && h.status === 'done' && new Date(h.finished_at) < new Date(a.finished_at)) : null;
  const delta = prev && a?.score != null && prev.score != null ? a.score - prev.score : null;
  // Suggestions use the saved business when the audited site is its website, else the site's own brand.
  const subject = useMemo(() => {
    if (!a) return null;
    if (business?.website && hostOf(business.website) === hostOf(a.target)) return business;
    return { name: siteBrand(a.target, pages), website: a.target };
  }, [a, business, pages]);

  if (!a) return <Card><div className="py-12 text-center text-[13px] text-slate-500">{sa.running ? 'The audit is still running. The report opens here when it finishes.' : 'Run an audit first to get the report.'}</div></Card>;
  if (a.status === 'failed') return <Card><ErrorNote>The audit failed: {a.error || 'the site could not be reached.'}</ErrorNote></Card>;

  const downloadPdf = () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    let y = 50;
    const ensure = (n = 20) => { if (y > H - n - 40) { doc.addPage(); y = 50; } };
    doc.setFontSize(18); doc.setTextColor(17, 24, 39); doc.text('Website SEO audit', 40, y); y += 18;
    doc.setFontSize(10); doc.setTextColor(100, 116, 139); doc.text(`${a.target} · ${fmtDateTime(a.finished_at)}`, 40, y); y += 26;
    doc.setTextColor(17, 24, 39); doc.setFontSize(13); doc.text(`Overall score: ${a.score ?? '—'}/100${delta ? ` (${delta > 0 ? '+' : ''}${delta} since last audit)` : ''}`, 40, y); y += 16;
    doc.setFontSize(10); doc.setTextColor(71, 85, 105);
    doc.splitTextToSize(verdict(a, issues), W - 80).forEach(l => { doc.text(l, 40, y); y += 12; }); y += 8;
    doc.setTextColor(17, 24, 39); doc.setFontSize(11);
    if (ps) CATEGORIES.forEach(([k, l]) => { doc.text(`${l}: ${ps.scores[k] ?? '—'}/100`, 40, y); y += 15; });
    if (crawl) { doc.text(`On-page: ${crawl.score}/100 (${pages.length} pages crawled)`, 40, y); y += 15; }
    if (ps) { y += 4; doc.text(`LCP ${ps.metrics.lcp || '—'} · TBT ${ps.metrics.tbt || '—'} · CLS ${ps.metrics.cls || '—'}`, 40, y); y += 15; }
    y += 10; doc.setFontSize(13); doc.text(`Issues to fix (${issues.length})`, 40, y); y += 18; doc.setFontSize(10);
    issues.forEach(i => {
      ensure(30);
      doc.setTextColor(i.level === 'critical' ? 185 : i.level === 'serious' ? 194 : 17, i.level === 'critical' ? 28 : i.level === 'serious' ? 65 : 24, i.level === 'critical' ? 28 : i.level === 'serious' ? 12 : 39);
      doc.text(`[${i.level.toUpperCase()}] ${i.title}`.slice(0, 110), 40, y);
      y += 12;
      if (i.fix) {
        doc.setTextColor(82, 81, 78);
        doc.splitTextToSize(`Fix: ${i.fix}`, W - 100).forEach(l => { ensure(); doc.text(l, 52, y); y += 11; });
      }
      y += 4;
    });
    doc.save(`seo-audit-${hostOf(a.target)}-${(a.finished_at || '').slice(0, 10)}.pdf`);
    toast('Audit report downloaded');
  };
  const rerun = () => sa.launch(normalise(a.target));

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <a href={a.target} target="_blank" rel="noreferrer" className="text-[16px] font-semibold text-slate-900 hover:text-indigo-700 inline-flex items-center gap-1.5 max-w-full"><span className="truncate">{a.target.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span><ExternalLink size={13} className="text-slate-400 shrink-0" /></a>
            <div className="text-[12px] text-slate-500">Audited {fmtDateTime(a.finished_at)}{ps?.strategy ? ` · ${ps.strategy}` : ''}{crawl ? ` · ${pages.length} page${pages.length === 1 ? '' : 's'} crawled` : ''}{a.fromBusiness ? ' · from the scheduled audit' : ''}</div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" icon={RotateCw} busy={sa.busy === 'start' || sa.running} onClick={rerun}>Re-run audit</Button>
            <Button size="sm" icon={Download} onClick={downloadPdf}>PDF report</Button>
          </div>
        </div>
        {a.error && <div className="mb-4 text-[12px] text-amber-800 bg-amber-50 ring-1 ring-inset ring-amber-200 rounded-xl px-3 py-2">Part of the audit didn't finish, so some scores are missing: {a.error}</div>}
        <div className={`grid grid-cols-1 gap-5 items-center ${ps?.screenshot ? 'lg:grid-cols-[auto_1fr_auto]' : 'lg:grid-cols-[auto_1fr]'}`}>
          <div className="flex items-center gap-4">
            <ScoreRing score={a.score ?? 0} label="Overall" size={118} level={lhLevel(a.score ?? 0)} />
            <div className="max-w-[260px]">
              <div className={`text-[15px] font-semibold ${LH_TEXT[lhLevel(a.score ?? 0)]}`}>{lhWord(a.score ?? 0)}</div>
              <div className="text-[12.5px] text-slate-600 mt-0.5">{verdict(a, issues)}</div>
              {delta !== null && delta !== 0 && <div className={`mt-1.5 text-[12px] font-semibold inline-flex items-center gap-1 ${delta > 0 ? 'text-emerald-700' : 'text-red-600'}`}>{delta > 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}{Math.abs(delta)} since {fmtDateTime(prev.finished_at)}</div>}
              <div className="mt-2 flex flex-wrap gap-1">{LEVELS.map(l => counts[l] > 0 && <span key={l} className={`text-[10.5px] font-bold uppercase px-1.5 py-0.5 rounded ring-1 ring-inset ${TONE[l]}`}>{counts[l]} {l}</span>)}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {CATEGORIES.map(([k, l, I]) => <CategoryTile key={k} label={l} icon={I} score={ps?.scores?.[k] ?? null} />)}
            <CategoryTile label="On-page" icon={FileText} score={crawl?.score ?? null} sub={crawl ? `${pages.length} pages checked` : null} />
          </div>
          {ps?.screenshot && (
            <a href={a.target} target="_blank" rel="noreferrer" className="hidden lg:block w-[120px] rounded-xl overflow-hidden ring-1 ring-slate-200 bg-white shadow-sm hover:ring-indigo-300" title="What Google's Chrome saw">
              <img src={ps.screenshot} alt={`Screenshot of ${hostOf(a.target)}`} className="w-full max-h-[200px] object-cover object-top" />
            </a>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5 min-w-0">
          <Improvements issues={issues} pages={pages} business={subject} score={crawl?.score} technical={ps} onRecheck={rerun} rechecking={sa.busy === 'start' || sa.running} />
          {ps && <LighthouseChecks checks={ps.seo_checks || []} />}
        </div>
        <div className="space-y-5 min-w-0">
          {ps && <Vitals ps={ps} />}
          {crawl && <Foundations crawl={crawl} />}
        </div>
      </div>

      {pages.length > 0 && <PagesCard pages={pages} siteIssues={issues} />}

      <LighthouseDetails auditId={ps?.lighthouse_audit_id} target={normalise(a.target)} pages={pages} strategy={ps?.strategy || 'mobile'} fallbackReason={ps?.fallback_reason} />

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="primary" icon={ArrowRight} onClick={() => onNext('schema')}>Next: schema</Button>
      </div>
      {toastNode}
    </div>
  );
}
