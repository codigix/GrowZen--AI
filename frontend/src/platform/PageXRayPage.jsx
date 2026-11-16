import React, { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { Check, X, Plus, Search, Globe, Copy, Download, RefreshCw, ChevronDown, ExternalLink, Loader2, AlertTriangle, ShieldCheck, Lock, FileText, History, Wrench, Share2, Braces, Cpu, Bot, Layers, Columns3, Gauge as GaugeIcon } from 'lucide-react';
import { SeoShell, Card, Button, Badge, Modal } from './SeoUi';
import { api, useApi } from './seoApi';
import { HistoryPanel, RenderingCard, SiteScan } from './PageXRayHistory';
import FullPageCard from './PageXRayLighthouse';

const MAX_URLS = 3;
// The fix tasks of the page on screen (own website only): { 'seo.title': {id, status, severity, how, ...} }, and the project id.
const FixCtx = createContext({ tasks: {}, bid: null, reason: null });
const FIX_STATUS = {
  todo: ['Pending', 'bg-amber-50 text-amber-800 ring-amber-200'], unverified: ['Not confirmed', 'bg-orange-50 text-orange-800 ring-orange-200'], failed: ['Overdue', 'bg-red-50 text-red-700 ring-red-200'],
  done: ['Done, not checked', 'bg-indigo-50 text-indigo-700 ring-indigo-200'], verified: ['Fixed', 'bg-emerald-50 text-emerald-700 ring-emerald-200'], skipped: ['Skipped', 'bg-slate-100 text-slate-600 ring-slate-200'], blocked: ['Blocked', 'bg-slate-100 text-slate-600 ring-slate-200']
};
const SEC_HEADERS = [['hsts', 'HSTS'], ['csp', 'CSP'], ['x_frame_options', 'X-Frame-Options'], ['x_content_type_options', 'X-Content-Type-Options'], ['referrer_policy', 'Referrer-Policy'], ['permissions_policy', 'Permissions-Policy']];
const SCORE_AREAS = [['seo', 'SEO'], ['aeo', 'AEO'], ['geo', 'GEO']];

const empty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);
const dash = (v) => (empty(v) ? '—' : v);
const arr = (v) => (Array.isArray(v) ? v : []);
const normaliseUrl = (u) => { const s = String(u || '').trim(); if (!s) return ''; return /^https?:\/\//i.test(s) ? s : `https://${s}`; };
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return String(u || ''); } };
const tone = (s) => (s == null ? 'text-slate-400' : s >= 75 ? 'text-emerald-600' : s >= 45 ? 'text-amber-500' : 'text-red-500');
const ringColor = (s) => (s == null ? '#cbd5e1' : s >= 75 ? '#10b981' : s >= 45 ? '#f59e0b' : '#ef4444');
const fmtDate = (iso) => { if (!iso) return '—'; const t = new Date(iso); return Number.isNaN(t.getTime()) ? '—' : t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); };
const age = (days) => { if (days == null) return '—'; const y = Math.floor(days / 365), m = Math.floor((days % 365) / 30); return y ? `${y} yr${y > 1 ? 's' : ''}${m ? ` ${m} mo` : ''}` : `${m} mo`; };
const secCount = (d) => SEC_HEADERS.filter(([k]) => d?.tech?.security_headers?.[k]).length;
const aiAllowed = (d) => arr(d?.robots?.ai_crawlers).filter(x => x.allowed).length;
const aiTotal = (d) => arr(d?.robots?.ai_crawlers).length;
const analyticsCount = (d) => arr(d?.tech?.analytics).length + arr(d?.tech?.tag_managers).length;

/** CSV cell: quoted, quotes doubled, and a leading = + - @ neutralised so a spreadsheet never runs it as a formula. */
const csvCell = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
const toCsv = (rows) => rows.map(r => r.map(csvCell).join(',')).join('\r\n');
const download = (name, text, mime) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name; a.click(); URL.revokeObjectURL(a.href); };
const copyText = async (text) => { try { await navigator.clipboard.writeText(text); } catch { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch { /* ignore */ } t.remove(); } };
const slug = (u) => hostOf(u).replace(/[^a-z0-9]+/gi, '-');

function checksCsv(d) {
  const rows = [['area', 'key', 'label', 'passed', 'weight', 'detail', 'fix']];
  for (const [k] of SCORE_AREAS) for (const c of arr(d.scores?.[k]?.checks)) rows.push([k.toUpperCase(), c.key, c.label, c.passed ? 'yes' : 'no', c.weight, c.detail, c.passed ? '' : c.fix]);
  return toCsv(rows);
}

function reportText(d) {
  const lines = [`Page X-Ray: ${d.final_url || d.url}`, `Checked ${d.fetched_at || ''} · status ${dash(d.status)} · ${dash(d.response_ms)} ms`, ''];
  for (const [k, label] of SCORE_AREAS) { const s = d.scores?.[k]; lines.push(`${label}: ${s ? `${s.score}/100 (${s.passed} of ${s.total} checks)` : '—'}`); }
  const fixes = arr(d.summary);
  if (fixes.length) { lines.push('', 'Top fixes:'); fixes.forEach(f => lines.push(`- [${f.area}] ${f.label}${f.fix ? `: ${f.fix}` : ''}`)); }
  for (const [k, label] of SCORE_AREAS) { const bad = arr(d.scores?.[k]?.checks).filter(c => !c.passed); if (bad.length) { lines.push('', `${label} to fix:`); bad.forEach(c => lines.push(`- ${c.label}: ${c.fix || c.detail || ''}`)); } }
  return lines.join('\n');
}

function Gauge({ score, size = 104, stroke = 10, label, sub, compact = false }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, s = score == null ? 0 : score;
  return (
    <div className={`flex ${compact ? 'items-center gap-2.5' : 'flex-col items-center text-center'}`} style={{ minWidth: compact ? undefined : size }} role="img" aria-label={`${label || 'Score'} ${score == null ? 'not available' : `${score} out of 100`}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="shrink-0">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={ringColor(score)} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(s / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        <text x="50%" y="56%" textAnchor="middle" className="fill-slate-900" style={{ fontSize: compact ? 20 : size * 0.34, fontWeight: 600 }}>{score == null ? '—' : score}</text>
      </svg>
      {(label || sub) && (
        <div className={compact ? 'leading-tight' : ''}>
          {label && <div className={`${compact ? 'text-11 uppercase' : 'mt-1.5 text-13'} font-bold tracking-wide text-slate-800`}>{label}</div>}
          {sub && <div className={`${compact ? 'text-11' : 'text-12'} tabular-nums whitespace-nowrap ${tone(score)}`}>{sub}</div>}
        </div>
      )}
    </div>
  );
}
const MiniRing = ({ score, label }) => <Gauge score={score} size={36} stroke={5} label={null} sub={null} aria-label={label} />;

/** Every report card: white, rounded, a hairline border, a soft shadow, a title with an icon in a pale indigo circle. */
function Card2({ icon: Icon, title, aside, children, className = '', hint }) {
  return (
    <section className={`bg-white rounded-xl border border-slate-200 shadow-sm p-5 min-w-0 ${className}`}>
      <header className="flex items-center gap-3 mb-4">
        {Icon && <span className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0"><Icon size={16} aria-hidden="true" /></span>}
        <div className="min-w-0 flex-1"><h3 className="text-16 font-semibold text-slate-900 leading-tight truncate">{title}</h3>{hint && <p className="text-12 text-slate-500 mt-0.5">{hint}</p>}</div>
        {aside != null && <div className="shrink-0">{aside}</div>}
      </header>
      {children}
    </section>
  );
}

const Pill = ({ children, tint = 'bg-slate-100 text-slate-700', title }) => <span title={title} className={`inline-flex items-center gap-1 text-12 rounded-full px-2.5 py-1 leading-none ${tint}`}>{children}</span>;
const Pills = ({ items, tint = 'bg-slate-100 text-slate-700' }) => (arr(items).length ? <div className="flex flex-wrap gap-1.5">{arr(items).map((x, i) => <Pill key={`${x}-${i}`} tint={tint}>{x}</Pill>)}</div> : <span className="text-slate-400">—</span>);
/** A definition row: label on the left, value beside it on wide cards, stacked on narrow ones, a thin divider between rows. */
const Def = ({ label, children }) => <div className="grid grid-cols-1 sm:grid-cols-[148px_minmax(0,1fr)] gap-x-4 gap-y-0.5 py-2.5 border-b border-slate-100 last:border-0"><dt className="text-12 text-slate-500 pt-0.5">{label}</dt><dd className="text-14 text-slate-800 break-words min-w-0">{children}</dd></div>;
const Tick = ({ ok, children }) => <span className={`inline-flex items-center gap-2 text-14 ${ok ? 'text-slate-800' : 'text-slate-400'}`}><span className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${ok ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>{ok ? <Check size={12} /> : <X size={12} />}</span>{children}</span>;

/** A slim bar with the ideal range shaded behind it. */
function RangeMeter({ value, min, max, unit = 'characters' }) {
  if (value == null) return <span className="text-slate-400">—</span>;
  const scale = Math.max(value, max * 1.25);
  const pct = (n) => `${Math.min(100, (n / scale) * 100)}%`;
  const ok = value >= min && value <= max, over = value > max;
  return (
    <div className="mt-1.5">
      <div className="relative h-2 rounded-full bg-slate-100 overflow-hidden" role="img" aria-label={`${value} ${unit}, ideal ${min} to ${max}`}>
        <div className="absolute inset-y-0 bg-emerald-100" style={{ left: pct(min), width: `calc(${pct(max)} - ${pct(min)})` }} />
        <div className={`absolute inset-y-0 left-0 rounded-full ${ok ? 'bg-emerald-500' : over ? 'bg-red-400' : 'bg-amber-400'}`} style={{ width: pct(value) }} />
      </div>
      <div className="mt-1 text-12 text-slate-500 tabular-nums">{value} {unit} · ideal {min}–{max}{ok ? '' : over ? ' · too long' : ' · too short'}</div>
    </div>
  );
}

function FixBox({ t, bad }) {
  const { reason } = useContext(FixCtx);
  if (!t) return bad && reason === null ? null : null;
  const st = FIX_STATUS[t.status] || FIX_STATUS.todo;
  const fixed = t.status === 'verified';
  if (!bad && !fixed) return null;
  return (
    <div className={`mt-2 rounded-lg border px-3 py-2.5 text-13 ${fixed ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-slate-50'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded-full ring-1 ring-inset px-2.5 py-0.5 text-12 font-semibold ${st[1]}`}>{fixed ? <Check size={12} /> : <AlertTriangle size={12} />}{fixed ? 'Fixed: this scan passes it' : st[0]}</span>
        {!fixed && <span className="text-12 text-slate-500">{t.overdue ? 'Overdue' : 'Due'} {t.due_on}</span>}
        {!fixed && <span className="text-12 font-semibold text-slate-600 capitalize">{t.severity}</span>}
        {t.fix_mode_label && <span className="text-12 rounded-full bg-indigo-50 text-indigo-700 px-2.5 py-0.5 font-medium">{t.fix_mode_label}</span>}
        <Link to={`/growth/fix/${t.id}`} className="ml-auto"><Button size="sm" variant={fixed ? undefined : 'primary'} icon={Wrench}>{fixed ? 'See the fix' : 'Fix guide'}</Button></Link>
      </div>
      {!fixed && (
        <>
          {t.how?.length > 0 && <ol className="mt-2 list-decimal pl-5 space-y-0.5 text-13 text-slate-700">{t.how.map((h, i) => <li key={i}>{h}</li>)}</ol>}
          <p className="mt-2 text-12 text-slate-500"><b>Fixed when:</b> {t.closes_when} Scan again after the change: if the check passes, this turns to Fixed; if not, it stays Pending.</p>
          {t.last_check && t.status !== 'todo' && <p className="mt-1 text-12 text-amber-800">Last result: {t.last_check}</p>}
        </>
      )}
    </div>
  );
}

function CheckCard2({ label, hint, area, filter, areaKey }) {
  const { tasks } = useContext(FixCtx);
  const checks = arr(area?.checks);
  const failed = checks.filter(c => !c.passed), passed = checks.filter(c => c.passed);
  const row = (c, bad) => (
    <li key={c.key} className="flex gap-3">
      <span className={`mt-0.5 w-[18px] h-[18px] rounded-full flex items-center justify-center shrink-0 ${bad ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-600'}`}>{bad ? <X size={12} /> : <Check size={12} />}</span>
      <div className="min-w-0 flex-1">
        <div className="text-14 font-medium text-slate-900 leading-snug">{c.label}{c.weight != null && <span className="ml-2 text-11 text-slate-400 font-normal">weight {c.weight}</span>}</div>
        {c.detail && <div className="text-13 text-slate-500 mt-0.5 break-words">{c.detail}</div>}
        {bad && c.fix && <div className="mt-2 rounded-lg bg-indigo-50 text-indigo-900 text-13 px-3 py-2 leading-snug"><b className="font-semibold">Fix: </b>{c.fix}</div>}
        <FixBox t={tasks[`${areaKey}.${c.key}`]} bad={bad} />
      </div>
    </li>
  );
  return (
    <Card2 icon={ShieldCheck} title={`${label} checks`} hint={hint} aside={area ? <Pill tint={area.score >= 75 ? 'bg-emerald-50 text-emerald-700' : area.score >= 45 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}>{area.score} · {area.passed}/{area.total}</Pill> : <span className="text-slate-400">—</span>}>
      {!checks.length ? <p className="text-14 text-slate-400">No checks were returned.</p> : (
        <>
          {filter !== 'passed' && (failed.length === 0 ? <p className="text-14 text-emerald-700 flex items-center gap-2"><Check size={16} />Nothing failed.</p> : <ul className="space-y-4">{failed.map(c => row(c, true))}</ul>)}
          {filter === 'all' && passed.length > 0 && (
            <details className="mt-4 pt-4 border-t border-slate-100 group">
              <summary className="text-13 font-semibold text-emerald-700 cursor-pointer select-none list-none flex items-center gap-1.5"><ChevronDown size={15} className="group-open:rotate-180 transition-transform" />{passed.length} passed</summary>
              <ul className="mt-3 space-y-3">{passed.map(c => row(c, false))}</ul>
            </details>
          )}
          {filter === 'passed' && (passed.length ? <ul className="space-y-3">{passed.map(c => row(c, false))}</ul> : <p className="text-14 text-slate-400">No check passed yet.</p>)}
        </>
      )}
    </Card2>
  );
}

const AREA_TINT = { seo: 'bg-indigo-50 text-indigo-700', aeo: 'bg-violet-50 text-violet-700', geo: 'bg-sky-50 text-sky-700' };
const AREA_NAME = { seo: 'SEO', aeo: 'AEO: answer engines', geo: 'GEO: AI search' };

// Which part of the page a check is about (the "subcontent"): the same grouping the website health view uses.
const CHECK_GROUP = {
  title: 'Titles', descriptive_title: 'Titles', description: 'Descriptions', description_unique: 'Descriptions', one_h1: 'Headings', outline: 'Headings', words: 'Content', short_paragraphs: 'Content', lists_tables: 'Content', numbers: 'Content',
  alt: 'Images', a11y_img_alt: 'Images', internal_links: 'Links', outbound: 'Links', redirects: 'Links', status_200: 'Links', canonical: 'Indexing', single_canonical: 'Indexing', indexable: 'Indexing', not_noindex: 'Indexing',
  sitemap: 'Indexing', https: 'Security', no_mixed_content: 'Security', cert: 'Security', page_weight: 'Speed', response_time: 'Speed', viewport: 'Mobile', lang: 'Mobile', favicon: 'Mobile', og: 'Social sharing', twitter_card: 'Social sharing',
  faq_schema: 'Structured data', org_schema: 'Structured data', entity_consistent: 'Structured data', question_headings: 'AI answers', direct_answer: 'AI answers', date: 'AI answers', author: 'AI answers', eeat: 'AI answers',
  ai_crawlers: 'AI access', llms_txt: 'AI access'
};
const groupOf = (key) => (key.startsWith('a11y_') && key !== 'a11y_img_alt' ? 'Accessibility' : CHECK_GROUP[key] || 'Content');

/** A short hover / focus bubble: the full text of a shortened cell, or a plain-words explanation of a column. Drawn on the page body so a scrolling table never clips it. */
function Tip({ text, children, wide = false, align = 'left' }) {
  const [pos, setPos] = useState(null);
  if (!text) return children;
  const show = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const w = wide ? 320 : 240;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, align === 'right' ? r.right - w : r.left));
    const below = r.bottom + 8 + 120 < window.innerHeight;
    setPos({ left, width: w, ...(below ? { top: r.bottom + 6 } : { bottom: window.innerHeight - r.top + 6 }) });
  };
  return (
    <span className="inline-flex max-w-full" tabIndex={0} onMouseEnter={show} onMouseLeave={() => setPos(null)} onFocus={show} onBlur={() => setPos(null)}>
      {children}
      {pos && createPortal(<span role="tooltip" style={{ position: 'fixed', zIndex: 80, ...pos }} className="pointer-events-none rounded-lg bg-slate-900 text-white text-12 leading-snug font-normal normal-case tracking-normal text-left px-3 py-2 shadow-xl">{text}</span>, document.body)}
    </span>
  );
}
const Clip = ({ text, lines = 2 }) => (text ? <Tip text={String(text).length > 70 ? text : null} wide><span className={`block text-slate-600 ${lines === 1 ? 'truncate' : 'line-clamp-2'}`}>{text}</span></Tip> : <span className="text-slate-400">—</span>);

/** The whole check in one window: what it is, what was found, why it counts, the fix, the fix task and its status. */
function CheckModal({ r, onClose }) {
  const t = r?.task;
  const fixed = t?.status === 'verified';
  const st = t ? (FIX_STATUS[t.status] || FIX_STATUS.todo) : null;
  return (
    <Modal open={Boolean(r)} onClose={onClose} width="max-w-2xl" title={r ? r.label : ''}
      footer={r && t ? <><Button onClick={onClose}>Close</Button><Link to={`/growth/fix/${t.id}`}><Button variant="primary" icon={Wrench}>{fixed ? 'See the fix' : 'Open the fix guide'}</Button></Link></> : <Button onClick={onClose}>Close</Button>}>
      {r && (
        <div className="space-y-4 text-13 text-slate-700">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-12 font-semibold ${r.passed ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{r.passed ? <Check size={12} /> : <X size={12} />}{r.passed ? 'Passed' : 'Failed'}</span>
            <span className={`rounded px-2 py-1 text-11 font-bold uppercase ${AREA_TINT[r.area] || ''}`}>{AREA_NAME[r.area] || r.area}</span>
            <span className="rounded-full bg-slate-100 text-slate-700 px-2.5 py-1 text-12 font-medium">{groupOf(r.key)}</span>
            <span className="rounded-full bg-slate-100 text-slate-700 px-2.5 py-1 text-12 font-medium">Weight {r.weight ?? '—'}</span>
            {r.impact > 0 && <span className="rounded-full bg-amber-50 text-amber-800 px-2.5 py-1 text-12 font-semibold">{r.passed ? `Worth ${r.impact} points of the ${r.area.toUpperCase()} score` : `Fixing it adds about ${r.impact} points to the ${r.area.toUpperCase()} score`}</span>}
          </div>
          <section><h4 className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1">What was found</h4><p className="break-words">{r.detail || 'The check ran and returned no extra detail.'}</p></section>
          {!r.passed && (
            <section><h4 className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1">How to fix it</h4>
              {r.fix && <p className="rounded-lg bg-indigo-50 text-indigo-900 px-3 py-2 leading-snug">{r.fix}</p>}
              {t?.how?.length > 0 && !fixed && <ol className="mt-2 list-decimal pl-5 space-y-1">{t.how.map((h, i) => <li key={i}>{h}</li>)}</ol>}
              {t?.closes_when && !fixed && <p className="mt-2 text-12.5 text-slate-500"><b>Fixed when:</b> {t.closes_when}</p>}
            </section>
          )}
          <section><h4 className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1">Fix task</h4>
            {t ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center gap-1 rounded-full ring-1 ring-inset px-2.5 py-0.5 text-12 font-semibold ${st[1]}`}>{fixed ? <Check size={12} /> : <AlertTriangle size={12} />}{fixed ? 'Fixed: this scan passes it' : st[0]}</span>
                {!fixed && t.due_on && <span className="text-12.5 text-slate-500">{t.overdue ? 'Overdue' : 'Due'} {t.due_on}</span>}
                {!fixed && t.severity && <span className="text-12.5 font-semibold capitalize">{t.severity}</span>}
                {t.fix_mode_label && <span className="text-12 rounded-full bg-indigo-50 text-indigo-700 px-2.5 py-0.5 font-medium">{t.fix_mode_label}</span>}
                {t.last_check && t.status !== 'todo' && <span className="w-full text-12 text-amber-800">Last result: {t.last_check}</span>}
              </div>
            ) : <p className="text-slate-500">{r.passed ? 'Nothing to fix.' : 'No fix task has been created for this check yet. Scan again, or open the Growth Plan.'}</p>}
          </section>
        </div>
      )}
    </Modal>
  );
}

/** Every check of SEO, AEO and GEO in one compact table. Long text is shortened and shows in full on hover; a click on a row opens the whole check in a window. Failed checks first. */
function ChecksTable({ d, filter }) {
  const { tasks } = useContext(FixCtx);
  const [q, setQ] = useState('');
  const [area, setArea] = useState('all');
  const [grp, setGrp] = useState('all');
  const [open, setOpen] = useState(null);
  let rows = [];
  for (const [k] of SCORE_AREAS) {
    const checks = arr(d.scores?.[k]?.checks);
    const total = checks.reduce((x, c) => x + (Number(c.weight) || 0), 0);
    checks.forEach(c => rows.push({ ...c, area: k, group: groupOf(c.key), impact: total ? Math.round(((Number(c.weight) || 0) / total) * 100 * 10) / 10 : 0, task: tasks[`${k}.${c.key}`] }));
  }
  const groups = [...new Set(rows.map(r => r.group))].sort();
  rows = rows.filter(r => (filter === 'failed' ? !r.passed : filter === 'passed' ? r.passed : true) && (area === 'all' || r.area === area) && (grp === 'all' || r.group === grp)
    && (!q.trim() || `${r.label} ${r.detail || ''} ${r.fix || ''} ${r.group}`.toLowerCase().includes(q.trim().toLowerCase())));
  rows.sort((a, b) => (a.passed === b.passed ? (b.weight || 0) - (a.weight || 0) : a.passed ? 1 : -1));
  const pill = (on) => `h-8 px-3 rounded-full text-12 font-semibold cursor-pointer ring-1 ring-inset ${on ? 'bg-indigo-600 text-white ring-indigo-600' : 'text-slate-600 ring-slate-300 hover:bg-slate-50'}`;
  const th = 'px-3 py-2.5 font-semibold whitespace-nowrap';
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-100">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search checks…" aria-label="Search checks" className="h-9 w-52 max-w-full px-3 text-13 rounded-lg ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none" />
        {[['all', 'All areas'], ...SCORE_AREAS.map(([k, l]) => [k, l])].map(([k, l]) => <button key={k} type="button" onClick={() => setArea(k)} aria-pressed={area === k} className={pill(area === k)}>{l}</button>)}
        <select value={grp} onChange={e => setGrp(e.target.value)} aria-label="Filter by part of the page" className="h-8 px-2 rounded-lg text-12 font-semibold text-slate-700 ring-1 ring-inset ring-slate-300 bg-white cursor-pointer">
          <option value="all">All parts of the page</option>{groups.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <span className="ml-auto text-12 text-slate-500">{rows.length} check{rows.length === 1 ? '' : 's'} · click a row for everything about it</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] table-fixed text-13 text-left">
          <colgroup><col style={{ width: 96 }} /><col style={{ width: 64 }} /><col style={{ width: 116 }} /><col style={{ width: '24%' }} /><col style={{ width: 70 }} /><col style={{ width: '18%' }} /><col style={{ width: '22%' }} /><col style={{ width: 124 }} /><col style={{ width: 84 }} /></colgroup>
          <thead className="bg-slate-50 text-12 uppercase tracking-wide text-slate-500">
            <tr>
              <th className={`${th} w-24`}>Result</th><th className={`${th} w-16`}>Area</th>
              <th className={`${th} w-28`}><Tip text="The part of the page this check is about: titles, headings, images, links, security, speed and so on." align="left">Part of page</Tip></th>
              <th className={`${th} w-[22%]`}>Check</th>
              <th className={`${th} w-20 text-right`}><Tip text="How many points of the area's score this check is worth. Fixing a failed check adds this many points." align="right">Points</Tip></th>
              <th className={`${th} w-[20%]`}>What was found</th><th className={`${th} w-[24%]`}>How to fix it</th>
              <th className={`${th} w-28`}>Fix status</th><th className={`${th} w-24 text-right`}>Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500">No checks match.</td></tr>}
            {rows.map(r => {
              const t = r.task, fixed = t?.status === 'verified', st = t ? (FIX_STATUS[t.status] || FIX_STATUS.todo) : null;
              return (
                <tr key={`${r.area}.${r.key}`} onClick={() => setOpen(r)} className={`align-middle cursor-pointer hover:bg-indigo-50/40 ${r.passed ? '' : 'bg-red-50/30'}`}>
                  <td className="px-3 py-2.5"><span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-12 font-semibold ${r.passed ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{r.passed ? <Check size={12} /> : <X size={12} />}{r.passed ? 'Passed' : 'Failed'}</span></td>
                  <td className="px-3 py-2.5"><Tip text={AREA_NAME[r.area]}><span className={`rounded px-1.5 py-0.5 text-11 font-bold uppercase ${AREA_TINT[r.area] || ''}`}>{r.area}</span></Tip></td>
                  <td className="px-3 py-2.5 text-slate-600 truncate">{r.group}</td>
                  <td className="px-3 py-2.5"><Tip text={r.label.length > 38 ? r.label : null}><span className="block font-medium text-slate-900 truncate">{r.label}</span></Tip></td>
                  <td className="px-3 py-2.5 text-right tabular-nums"><Tip text={`Weight ${r.weight ?? '—'}: worth ${r.impact} points of the ${r.area.toUpperCase()} score.`} align="right"><span className={r.passed ? 'text-slate-400' : 'font-semibold text-amber-700'}>{r.passed ? '' : '+'}{r.impact}</span></Tip></td>
                  <td className="px-3 py-2.5"><Clip text={r.detail} /></td>
                  <td className="px-3 py-2.5">{r.passed ? <span className="text-slate-400">Nothing to fix</span> : <Clip text={r.fix} />}</td>
                  <td className="px-3 py-2.5">{t ? <Tip text={fixed ? 'This scan passes the check.' : `${st[0]}${t.due_on ? `, due ${t.due_on}` : ''}${t.fix_mode_label ? `. ${t.fix_mode_label}.` : ''}`}><span className={`inline-flex items-center gap-1 rounded-full ring-1 ring-inset px-2.5 py-0.5 text-12 font-semibold whitespace-nowrap ${st[1]}`}>{fixed ? <Check size={12} /> : <AlertTriangle size={12} />}{fixed ? 'Fixed' : st[0]}</span></Tip> : <span className="text-slate-400">{r.passed ? '—' : 'No task yet'}</span>}</td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(r); }} className="text-12 font-semibold text-indigo-700 hover:underline cursor-pointer">Details</button>
                    {t && <Link to={`/growth/fix/${t.id}`} onClick={e => e.stopPropagation()} title="Open the exact fix" className="ml-2 inline-flex align-middle text-slate-500 hover:text-indigo-700"><Wrench size={14} /></Link>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <CheckModal r={open} onClose={() => setOpen(null)} />
    </section>
  );
}

function Previews2({ d }) {
  const og = d.social?.og || {}, tw = d.social?.twitter || {};
  const title = og.title || tw.title || d.meta?.title, desc = og.description || tw.description || d.meta?.description, img = og.image || tw.image;
  const t = d.meta?.title ? String(d.meta.title) : '', ds = d.meta?.description ? String(d.meta.description) : '';
  return (
    <Card2 icon={Share2} title="Previews" hint="How the page looks in Google and when someone shares it">
      <div className="text-12 font-semibold text-slate-500 mb-1.5">Google result</div>
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="text-12 text-slate-600 truncate">{d.final_url || d.url}</div>
        <div className="text-18 text-blue-700 leading-snug mt-0.5 line-clamp-2">{t ? t.slice(0, 60) + (t.length > 60 ? '…' : '') : <span className="text-slate-400">No title tag</span>}</div>
        <div className="text-14 text-slate-600 mt-1 line-clamp-3">{ds ? ds.slice(0, 160) + (ds.length > 160 ? '…' : '') : <span className="text-slate-400">No meta description: Google writes its own snippet.</span>}</div>
      </div>
      <div className="text-12 font-semibold text-slate-500 mt-4 mb-1.5">Shared link (Open Graph / {tw.card || 'Twitter'})</div>
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        {img ? <img src={img} alt="" className="w-full h-40 object-cover bg-slate-100" loading="lazy" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none'; }} /> : <div className="h-24 bg-slate-50 flex items-center justify-center text-13 text-slate-400">No og:image: shared links show no picture</div>}
        <div className="p-4"><div className="text-11 uppercase tracking-wide text-slate-400 truncate">{og.site_name || hostOf(d.final_url || d.url)}</div><div className="text-15 font-semibold text-slate-900 line-clamp-2">{title || <span className="text-slate-400 font-normal">No share title</span>}</div><div className="text-13 text-slate-600 line-clamp-2 mt-0.5">{desc || ''}</div></div>
      </div>
      <dl className="mt-4">
        {[['og:title', og.title], ['og:description', og.description], ['og:image', og.image], ['og:type', og.type], ['og:url', og.url], ['og:site_name', og.site_name], ['twitter:card', tw.card], ['twitter:title', tw.title], ['twitter:description', tw.description], ['twitter:image', tw.image]].map(([k, v]) => (
          <div key={k} className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 py-1.5 border-b border-slate-100 last:border-0 text-13"><dt className="text-slate-500">{k}</dt><dd className="text-slate-800 truncate" title={v || ''}>{dash(v)}</dd></div>
        ))}
      </dl>
    </Card2>
  );
}

const NAV = [
  ['overview', 'Overview', GaugeIcon], ['checks', 'Checks', ShieldCheck], ['page', 'Page & content', FileText], ['tech', 'Tech & security', Cpu], ['full', 'Full page', Layers], ['history', 'History & site scan', History]
];
const GROUP_KEYS = NAV.map(n => n[0]);
const readHash = () => { try { const h = window.location.hash.replace('#', ''); return GROUP_KEYS.includes(h) ? h : 'overview'; } catch { return 'overview'; } };

function FixSummary({ failedTotal }) {
  const { tasks, reason } = useContext(FixCtx);
  const list = Object.values(tasks);
  if (!list.length) return <span className="text-13 text-slate-500">{reason && reason !== 'Scan the page first.' ? reason : 'Failed checks come first, each with the fix.'}</span>;
  const fixed = list.filter(t => t.status === 'verified').length;
  return <span className="text-13 text-slate-600"><b className="text-emerald-700">{fixed} fixed</b> · <b className="text-amber-700">{list.length - fixed} pending</b> · {failedTotal} check{failedTotal === 1 ? '' : 's'} failing now. Open a Fix guide, apply it, then scan again.</span>;
}

function Report({ d, onRerun, busy, extra, deep, history, siteScan }) {
  const [copied, setCopied] = useState(false);
  const [group, setGroupState] = useState(readHash);
  const [filter, setFilter] = useState('all');
  const [stuck, setStuck] = useState(false);
  const sentinel = useRef(null);
  useEffect(() => {
    const el = sentinel.current; if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting), { rootMargin: '-8px 0px 0px 0px' });
    io.observe(el); return () => io.disconnect();
  }, []);
  useEffect(() => { try { document.getElementById(`xray-tab-${group}`)?.scrollIntoView({ inline: 'center', block: 'nearest' }); } catch { /* older browsers */ } }, [group]); // the chosen tab is never left off-screen on a phone
  const setGroup = (g) => { setGroupState(g); try { window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#${g}`); } catch { /* the address bar is optional */ } };
  useEffect(() => { const on = () => setGroupState(readHash()); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
  const m = d.meta || {}, c = d.content || {}, s = d.schema || {}, t = d.tech || {}, dom = d.domain || {}, ssl = d.ssl || {}, rb = d.robots || {};
  const techGroups = [['CMS', t.cms], ['Frameworks', t.frameworks], ['JS libraries', t.js_libraries], ['Analytics', t.analytics], ['Tag managers', t.tag_managers], ['Ads & pixels', t.ads_pixels], ['CDN', t.cdn], ['Server', [t.server, t.powered_by].flatMap(x => (x ? [x] : []))]];
  const doCopy = async () => { await copyText(reportText(d)); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const fixes = arr(d.summary), shownFixes = fixes.slice(0, 6);
  const warnings = [...arr(d.notes), ...(dom.error ? [`The domain lookup did not finish: ${dom.error}`] : []), ...(ssl.error ? [`The SSL check did not finish: ${ssl.error}`] : [])];
  const outline = arr(c.outline).slice(0, 80);
  const failedBy = Object.fromEntries(SCORE_AREAS.map(([k]) => [k, arr(d.scores?.[k]?.checks).filter(x => !x.passed).length]));
  const failedTotal = Object.values(failedBy).reduce((a, b) => a + b, 0);
  const techProblems = (6 - secCount(d)) + (ssl.valid === false || (ssl.days_left != null && ssl.days_left < 30) ? 1 : 0) + (rb.allows_page === false ? 1 : 0);
  const metaBad = !m.title || !m.description;
  const info = {
    overview: { dot: fixes.length ? 'bg-amber-400' : 'bg-emerald-500', count: fixes.length || null },
    checks: { dot: failedTotal ? 'bg-red-500' : 'bg-emerald-500', count: failedTotal || null, red: true },
    page: { dot: metaBad ? 'bg-amber-400' : 'bg-emerald-500', count: null },
    tech: { dot: techProblems ? 'bg-red-500' : 'bg-emerald-500', count: techProblems || null, red: true },
    full: { dot: 'bg-slate-300', count: null },
    history: { dot: 'bg-slate-300', count: null }
  };
  const avgScore = (() => { const v = SCORE_AREAS.map(([k]) => d.scores?.[k]?.score).filter(x => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; })();
  info.overview.dot = avgScore == null ? 'bg-slate-300' : avgScore >= 75 ? 'bg-emerald-500' : avgScore >= 45 ? 'bg-amber-400' : 'bg-red-500';

  const finalDiffers = d.final_url && d.url && d.final_url.replace(/\/$/, '') !== d.url.replace(/\/$/, '');
  const hero = (
    <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50/60 to-white shadow-sm p-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="min-w-0 flex-1 basis-72">
          <div className="text-11 font-semibold uppercase tracking-wide text-indigo-600 leading-none">Page X-Ray</div>
          <h2 className="text-20 font-semibold text-slate-900 leading-tight mt-1 truncate" title={d.final_url || d.url}>{hostOf(d.final_url || d.url)}</h2>
          <a href={d.final_url || d.url} target="_blank" rel="noreferrer" className="text-12 text-slate-500 hover:text-indigo-600 inline-flex items-center gap-1 max-w-full"><span className="truncate">{d.final_url || d.url}</span><ExternalLink size={11} className="shrink-0" /></a>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <Pill tint={Number(d.status) >= 400 ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-700'}>HTTP {dash(d.status)}</Pill>
            <Pill>{dash(d.response_ms)} ms</Pill><Pill>{dash(d.size_kb)} KB</Pill>
            <Pill tint={d.https ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}>{d.https ? 'https' : 'not https'}</Pill>
            {arr(d.redirects).length > 0 && <Pill tint="bg-amber-50 text-amber-800" title={d.redirects.map(r => `${r.status} ${r.url}`).join('\n')}>{d.redirects.length} redirect{d.redirects.length > 1 ? 's' : ''}</Pill>}
            {finalDiffers && <Pill tint="bg-indigo-50 text-indigo-700" title={d.url}>was {hostOf(d.url)}</Pill>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          {SCORE_AREAS.map(([k, label]) => { const sc = d.scores?.[k]; return <Gauge key={k} compact score={sc?.score} size={68} stroke={6} label={label} sub={sc ? `${sc.passed} of ${sc.total} checks` : '—'} />; })}
        </div>
        <div className="grid grid-cols-2 gap-1.5 w-full sm:w-auto">
          <Button size="sm" icon={copied ? Check : Copy} onClick={doCopy}>{copied ? 'Copied' : 'Copy report'}</Button>
          <Button size="sm" variant="primary" icon={RefreshCw} busy={busy} onClick={onRerun}>Re-run</Button>
          <Button size="sm" icon={Download} onClick={() => download(`page-xray-${slug(d.final_url || d.url)}.json`, JSON.stringify(d, null, 2), 'application/json')}>JSON</Button>
          <Button size="sm" icon={Download} onClick={() => download(`page-xray-${slug(d.final_url || d.url)}.csv`, checksCsv(d), 'text/csv;charset=utf-8')}>CSV</Button>
        </div>
      </div>
    </div>
  );
  const warn = warnings.length > 0 && (
    <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-14 text-amber-900" role="status">
      <div className="flex items-start gap-2.5"><AlertTriangle size={17} className="mt-0.5 shrink-0 text-amber-600" /><ul className="space-y-0.5">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>
    </div>
  );

  const tile = (go, Icon, label, value, sub, tint = 'text-slate-900') => (
    <button type="button" key={label} onClick={() => setGroup(go)} className="text-left bg-white rounded-xl border border-slate-200 shadow-sm p-5 hover:border-indigo-300 hover:shadow-md transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
      <span className="flex items-center gap-2 text-12 font-medium text-slate-500"><span className="w-7 h-7 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center"><Icon size={14} /></span>{label}</span>
      <span className={`block text-20 font-semibold mt-3 leading-tight truncate ${tint}`}>{value}</span>
      <span className="block text-13 text-slate-500 mt-1 truncate">{sub}</span>
    </button>
  );

  const views = {
    overview: (
      <div className="space-y-6">
        <Card2 icon={Wrench} title="What to fix first" hint={fixes.length ? `The ${shownFixes.length} biggest wins${fixes.length > 6 ? `, of ${fixes.length}` : ''}` : undefined}>
          {fixes.length === 0 ? <p className="text-14 text-emerald-700 flex items-center gap-2"><Check size={16} />Nothing urgent. Every check that matters passed.</p> : (
            <ol className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {shownFixes.map((f, i) => (
                <li key={i} className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4 min-w-0">
                  <span className="w-7 h-7 rounded-full bg-indigo-600 text-white text-13 font-semibold flex items-center justify-center shrink-0">{i + 1}</span>
                  <div className="min-w-0"><Badge tone={String(f.area).toLowerCase() === 'seo' ? 'blue' : String(f.area).toLowerCase() === 'aeo' ? 'violet' : 'green'}>{String(f.area || '').toUpperCase()}</Badge><div className="text-14 font-semibold text-slate-900 leading-snug mt-1.5">{f.label}</div>{f.fix && <div className="text-13 text-slate-600 mt-1 leading-snug">{f.fix}</div>}</div>
                </li>
              ))}
            </ol>
          )}
          {fixes.length > 6 && <button type="button" onClick={() => setGroup('checks')} className="mt-4 text-13 font-semibold text-indigo-600 hover:underline cursor-pointer">See all {failedTotal} failed checks →</button>}
        </Card2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {tile('page', FileText, 'Meta tags', metaBad ? 'Needs work' : 'Looks good', `Title ${m.title_len ?? '—'} · Description ${m.description_len ?? '—'} characters`, metaBad ? 'text-amber-600' : 'text-emerald-600')}
          {tile('page', FileText, 'Content', `${dash(c.word_count)} words`, `Reading ease ${dash(c.reading_ease)} · ${dash(c.images?.missing_alt)} images without alt`)}
          {tile('tech', Cpu, 'Tech stack', t.cms ? `${t.cms}${t.cms_version ? ` ${t.cms_version}` : ''}` : (arr(t.frameworks)[0] || (arr(t.detected).length ? `${arr(t.detected).length} found` : '—')), `${analyticsCount(d)} analytics or tag tools · ${secCount(d)} of 6 security headers`)}
          {tile('tech', Lock, 'Domain age', age(dom.age_days), dom.registrar ? `Registrar ${dom.registrar}` : 'Registrar unknown')}
          {tile('tech', ShieldCheck, 'SSL certificate', ssl.days_left == null ? '—' : `${ssl.days_left} days`, ssl.issuer ? `Issued by ${ssl.issuer}` : 'Issuer unknown', ssl.days_left != null && ssl.days_left < 30 ? 'text-red-600' : 'text-slate-900')}
          {tile('tech', Bot, 'AI crawlers allowed', aiTotal(d) ? `${aiAllowed(d)} of ${aiTotal(d)}` : '—', d.llms_txt?.found == null ? 'llms.txt unknown' : d.llms_txt.found ? 'llms.txt found' : 'No llms.txt')}
        </div>
      </div>
    ),
    checks: (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <div role="tablist" aria-label="Filter checks" className="inline-flex rounded-lg bg-slate-100 p-1">
            {[['all', 'All'], ['failed', `Failed (${failedTotal})`], ['passed', 'Passed']].map(([id, l]) => <button key={id} type="button" role="tab" aria-selected={filter === id} onClick={() => setFilter(id)} className={`h-8 px-4 rounded-md text-13 font-medium cursor-pointer ${filter === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>{l}</button>)}
          </div>
          <FixSummary failedTotal={failedTotal} />
        </div>
        <ChecksTable d={d} filter={filter} />
      </div>
    ),
    page: (
      <div className="space-y-6">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
          <Card2 icon={FileText} title="Meta & indexing">
            <dl>
              <Def label="Title"><div>{dash(m.title)}</div><RangeMeter value={m.title_len} min={30} max={60} /></Def>
              <Def label="Description"><div>{dash(m.description)}</div><RangeMeter value={m.description_len} min={70} max={160} /></Def>
              <Def label="Canonical">{m.canonical ? <div className="flex flex-wrap items-center gap-2"><span className="break-all">{m.canonical}</span>{m.canonical_self != null && <Pill tint={m.canonical_self ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}>{m.canonical_self ? 'points to itself' : 'points elsewhere'}</Pill>}</div> : '—'}</Def>
              <Def label="Robots meta">{dash(m.robots_meta)}</Def>
              <Def label="X-Robots-Tag">{dash(m.x_robots_tag)}</Def>
              <Def label="Language">{dash(m.lang)}</Def>
              <Def label="Charset">{dash(m.charset)}</Def>
              <Def label="Viewport">{dash(m.viewport)}</Def>
              <Def label="Generator">{dash(m.generator)}</Def>
              <Def label="Favicon">{m.favicon ? <span className="break-all">{m.favicon}</span> : '—'}</Def>
              <Def label="hreflang">{arr(m.hreflang).length ? <div className="flex flex-wrap gap-1.5">{m.hreflang.map((h, i) => <Pill key={i} title={h.url}>{h.lang}</Pill>)}</div> : '—'}</Def>
              {arr(d.redirects).length > 0 && <Def label="Redirects"><ul className="space-y-1">{d.redirects.map((r, i) => <li key={i} className="text-13 break-all"><b>{r.status}</b> {r.url}</li>)}</ul></Def>}
            </dl>
          </Card2>
          <Previews2 d={d} />
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
          <Card2 icon={FileText} title="Content">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {[['Words', c.word_count], ['Reading ease', c.reading_ease], ['Images', c.images?.total], ['Missing alt', c.images?.missing_alt], ['Internal links', c.links?.internal], ['External links', c.links?.external], ['Nofollow', c.links?.nofollow], ['Lazy images', c.images?.lazy]].map(([l, v]) => <div key={l} className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5 min-w-0"><div className="text-12 text-slate-500 truncate">{l}</div><div className="text-20 font-semibold text-slate-900 tabular-nums leading-tight">{dash(v)}</div></div>)}
            </div>
            <dl>
              <Def label="Headings"><div className="flex flex-wrap gap-1.5">{['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map(h => <Pill key={h}>{h.toUpperCase()} <b className="tabular-nums">{c.headings?.[h] ?? '—'}</b></Pill>)}</div></Def>
              <Def label="H1 text">{arr(c.h1_texts).length ? c.h1_texts.join(' · ') : '—'}</Def>
            </dl>
            {outline.length > 0 && (
              <details className="mt-3 group">
                <summary className="text-13 font-semibold text-indigo-700 cursor-pointer select-none list-none flex items-center gap-1.5"><ChevronDown size={15} className="group-open:rotate-180 transition-transform" />Heading outline ({arr(c.outline).length})</summary>
                <ul className="mt-2 text-13 space-y-1">{outline.map((h, i) => <li key={i} style={{ paddingLeft: `${Math.max(0, (h.level || 1) - 1) * 16}px` }} className="text-slate-700 truncate" title={h.text}><span className="text-slate-400 mr-1.5">H{h.level}</span>{h.text}</li>)}</ul>
              </details>
            )}
          </Card2>
          <Card2 icon={Braces} title="Structured data">
            <dl>
              <Def label="Types"><Pills items={arr(s.types)} tint="bg-indigo-50 text-indigo-700" /></Def>
              <Def label="JSON-LD blocks">{arr(s.json_ld).length ? <div className="flex flex-wrap gap-1.5">{s.json_ld.map((j, i) => <Pill key={i} tint={j.valid ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}>{j.valid ? <Check size={12} /> : <X size={12} />}{j.type || 'unknown'}</Pill>)}</div> : '—'}</Def>
              <Def label="Microdata">{s.microdata == null ? '—' : <Tick ok={Boolean(s.microdata)}>{String(s.microdata)}</Tick>}</Def>
              <Def label="RDFa">{s.rdfa == null ? '—' : <Tick ok={Boolean(s.rdfa)}>{String(s.rdfa)}</Tick>}</Def>
              {arr(s.errors).length > 0 && <Def label="Problems"><ul className="list-disc pl-5 text-13 text-red-700 space-y-1">{s.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></Def>}
            </dl>
          </Card2>
        </div>
      </div>
    ),
    tech: (
      <div className="space-y-6">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
          <Card2 icon={Cpu} title="Tech stack">
            <dl>
              {arr(t.groups).length
                ? arr(t.groups).map(g => <Def key={g.key} label={g.label}>
                    <div className="flex flex-wrap gap-1.5">{arr(g.items).map(i => <Pill key={i.name} tint={g.key === 'cms' || g.key === 'page_builder' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-700'} title={i.via}>{i.name}{i.version ? <span className="text-slate-500"> {i.version}</span> : null}</Pill>)}</div>
                  </Def>)
                : techGroups.map(([label, items]) => <Def key={label} label={label}><Pills items={items} /></Def>)}
              {t.theme && <Def label="WordPress theme"><Pill tint="bg-indigo-50 text-indigo-700">{t.theme.name}{t.theme.version ? <span className="text-indigo-500"> {t.theme.version}</span> : null}</Pill></Def>}
              {arr(t.plugins).length > 0 && <Def label={`WordPress plugins (${arr(t.plugins).length})`}><div className="flex flex-wrap gap-1.5">{arr(t.plugins).map(p => <Pill key={p.slug} title={p.slug}>{p.name}{p.version ? <span className="text-slate-500"> {p.version}</span> : null}</Pill>)}</div></Def>}
              {!arr(t.groups).length && <Def label="Server"><Pills items={[t.server, t.powered_by].filter(Boolean)} /></Def>}
              {arr(t.groups).length > 0 && (t.server || t.powered_by) && <Def label="Server header"><span className="text-13 break-all">{[t.server, t.powered_by].filter(Boolean).join(' · ')}</span></Def>}
              <Def label="Compression">{dash(t.compression)}</Def>
              <Def label="Cache-Control"><span className="break-all text-13">{dash(t.cache_control)}</span></Def>
            </dl>
            {arr(t.groups).length === 0 && <p className="text-12 text-slate-400 mt-2">No technology could be identified from this page's headers and code. A page built by JavaScript can show more when you tick “Render JavaScript (Chrome)”.</p>}
          </Card2>
          <Card2 icon={ShieldCheck} title="Security headers" aside={<Pill tint={secCount(d) >= 5 ? 'bg-emerald-50 text-emerald-700' : secCount(d) >= 3 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}>{secCount(d)} of 6</Pill>}>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">{SEC_HEADERS.map(([k, l]) => <li key={k} className="rounded-xl border border-slate-200 px-3 py-2.5"><Tick ok={Boolean(t.security_headers?.[k])}>{l}</Tick></li>)}</ul>
          </Card2>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
          <Card2 icon={Lock} title="Domain & SSL">
            <dl>
              <Def label="Domain">{dash(dom.domain)}</Def>
              <Def label="Domain age">{age(dom.age_days)}</Def>
              <Def label="Registered">{fmtDate(dom.registered_at)}</Def>
              <Def label="Expires">{fmtDate(dom.expires_at)}</Def>
              <Def label="Registrar">{dash(dom.registrar)}</Def>
              <Def label="Nameservers"><Pills items={dom.nameservers} /></Def>
              <Def label="Lookup">{dom.error ? <span className="text-amber-700">{dom.error}</span> : <span>{dom.source ? `via ${dom.source}` : dom.registered_at || dom.registrar ? 'found' : '—'}</span>}</Def>
              <Def label="SSL certificate">{ssl.valid == null ? '—' : <Tick ok={Boolean(ssl.valid)}>{ssl.valid ? 'Valid' : 'Not valid'}</Tick>}</Def>
              <Def label="Issuer">{dash(ssl.issuer)}</Def>
              <Def label="SSL expires">{fmtDate(ssl.expires_at)}</Def>
              <Def label="Days left">{ssl.days_left == null ? '—' : <span className={ssl.days_left < 30 ? 'text-red-600 font-semibold' : ''}>{ssl.days_left}{ssl.days_left < 30 ? ' · renew soon' : ''}</span>}</Def>
              {ssl.error && <Def label="SSL check"><span className="text-amber-700">{ssl.error}</span></Def>}
            </dl>
          </Card2>
          <Card2 icon={Bot} title="Crawlers & AI access" aside={aiTotal(d) ? <Pill tint="bg-slate-100 text-slate-700">{aiAllowed(d)} of {aiTotal(d)} AI bots allowed</Pill> : null}>
            <dl>
              <Def label="robots.txt">{rb.found == null ? '—' : <span className="inline-flex items-center gap-2"><Tick ok={Boolean(rb.found)}>{rb.found ? 'Found' : 'Not found'}</Tick>{rb.url && <a href={rb.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline text-13">open</a>}</span>}</Def>
              <Def label="This page is">{rb.allows_page == null ? '—' : <Pill tint={rb.allows_page ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}>{rb.allows_page ? 'allowed to crawl' : 'blocked by robots.txt'}</Pill>}</Def>
              <Def label="Sitemaps">{arr(rb.sitemaps).length ? <ul className="space-y-1">{rb.sitemaps.map((x, i) => <li key={i} className="text-13 break-all">{x}</li>)}</ul> : '—'}</Def>
              <Def label="llms.txt">{d.llms_txt?.found == null ? '—' : <span className="inline-flex items-center gap-2"><Tick ok={Boolean(d.llms_txt.found)}>{d.llms_txt.found ? 'Found' : 'Not found'}</Tick>{d.llms_txt.url && d.llms_txt.found && <a href={d.llms_txt.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline text-13">open</a>}</span>}</Def>
            </dl>
            <div className="mt-3 pt-3 border-t border-slate-100">
              <div className="text-12 text-slate-500 mb-2">AI crawlers</div>
              {arr(rb.ai_crawlers).length ? <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">{rb.ai_crawlers.map(x => <span key={x.bot} className={`text-13 rounded-lg px-2.5 py-2 inline-flex items-center gap-1.5 min-w-0 ${x.allowed ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`} title={`${x.bot} ${x.allowed ? 'allowed' : 'blocked'}`}>{x.allowed ? <Check size={13} className="shrink-0" /> : <X size={13} className="shrink-0" />}<span className="truncate">{x.bot}</span></span>)}</div> : <span className="text-slate-400">—</span>}
            </div>
          </Card2>
        </div>
      </div>
    ),
    full: (
      <div className="space-y-6">
        {deep}
        {extra}
        {!deep && !extra && <Card2 icon={Layers} title="Full page"><p className="text-14 text-slate-500">Nothing to show for this page.</p></Card2>}
      </div>
    ),
    history: (
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        {history}
        {siteScan}
        {!history && !siteScan && <Card2 icon={History} title="History & site scan"><p className="text-14 text-slate-500">Inspect a page to see its history.</p></Card2>}
      </div>
    )
  };

  const onTabKey = (e) => {
    const i = GROUP_KEYS.indexOf(group);
    let next = null;
    if (e.key === 'ArrowRight') next = GROUP_KEYS[(i + 1) % GROUP_KEYS.length];
    else if (e.key === 'ArrowLeft') next = GROUP_KEYS[(i - 1 + GROUP_KEYS.length) % GROUP_KEYS.length];
    else if (e.key === 'Home') next = GROUP_KEYS[0];
    else if (e.key === 'End') next = GROUP_KEYS[GROUP_KEYS.length - 1];
    if (next) { e.preventDefault(); setGroup(next); requestAnimationFrame(() => document.getElementById(`xray-tab-${next}`)?.focus()); }
  };
  return (
    <div className="min-w-0 space-y-4">
      {hero}
      {warn}
      <div ref={sentinel} aria-hidden="true" className="h-px -mb-4" />
      <div className={`sticky top-2 z-20 bg-white rounded-xl border border-slate-200 transition-shadow ${stuck ? 'shadow-md' : 'shadow-sm'}`}>
        <div role="tablist" aria-label="Report sections" onKeyDown={onTabKey} className="flex flex-nowrap overflow-x-auto px-2" style={{ scrollbarWidth: 'none' }}>
          {NAV.map(([key, label, Icon]) => { const i = info[key]; const on = group === key; return (
            <button key={key} id={`xray-tab-${key}`} type="button" role="tab" aria-selected={on} aria-controls="xray-panel" tabIndex={on ? 0 : -1} onClick={() => setGroup(key)}
              className={`shrink-0 h-12 px-4 inline-flex items-center gap-2 text-14 whitespace-nowrap border-b-2 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${on ? 'border-indigo-600 text-indigo-700 font-semibold' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>
              <span className={`w-2 h-2 rounded-full shrink-0 ${i.dot}`} aria-hidden="true" />
              <Icon size={15} className="shrink-0 opacity-70" aria-hidden="true" />
              {label}
              {i.count != null && <span className={`text-12 font-semibold tabular-nums rounded-full px-1.5 py-0.5 leading-none ${i.red ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{i.count}</span>}
            </button>
          ); })}
        </div>
      </div>
      <div key={group} id="xray-panel" role="tabpanel" aria-labelledby={`xray-tab-${group}`} className="min-w-0">{views[group]}</div>
    </div>
  );
}

// Rows of the comparison table. dir: 'high' = bigger is better, 'low' = smaller is better, null = no ranking.
const COMPARE = [
  ['SEO score', d => d.scores?.seo?.score, 'high'], ['AEO score', d => d.scores?.aeo?.score, 'high'], ['GEO score', d => d.scores?.geo?.score, 'high'],
  ['Title length', d => d.meta?.title_len, null], ['Description length', d => d.meta?.description_len, null], ['Word count', d => d.content?.word_count, 'high'],
  ['H1 count', d => d.content?.headings?.h1, null], ['Images missing alt', d => d.content?.images?.missing_alt, 'low'],
  ['Schema types', d => arr(d.schema?.types).join(', ') || null, null, 'text'], ['CMS', d => arr(d.tech?.cms).join(', ') || null, null, 'text'],
  ['Analytics tools', d => analyticsCount(d), 'high'], ['Security headers (of 6)', d => secCount(d), 'high'],
  ['Domain age (days)', d => d.domain?.age_days, 'high', 'age'], ['SSL days left', d => d.ssl?.days_left, null],
  ['AI crawlers allowed', d => (aiTotal(d) ? aiAllowed(d) : null), 'high', 'ai'], ['llms.txt', d => (d.llms_txt?.found == null ? null : d.llms_txt.found ? 'Yes' : 'No'), null, 'text'],
  ['Response time (ms)', d => d.response_ms, 'low']
];

function Compare({ items, onOpen, active }) {
  const cols = items.filter(i => i.data);
  const cell = (d, def) => { const [, get, , kind] = def; const v = get(d); if (v == null || v === '') return '—'; if (kind === 'age') return age(v); if (kind === 'ai') return `${v} of ${aiTotal(d)}`; if (typeof v === 'number' && def[0].includes('Security')) return `${v}/6`; return String(v); };
  const rank = (def) => {
    const [, get, dir] = def; if (!dir) return {};
    const vals = cols.map(c => get(c.data)).map(v => (typeof v === 'number' ? v : null));
    const nums = vals.filter(v => v != null); if (nums.length < 2 || Math.min(...nums) === Math.max(...nums)) return {};
    const best = dir === 'high' ? Math.max(...nums) : Math.min(...nums), worst = dir === 'high' ? Math.min(...nums) : Math.max(...nums);
    return { best, worst };
  };
  const exportCsv = () => download('page-xray-comparison.csv', toCsv([['Metric', ...cols.map(c => c.data.final_url || c.url)], ...COMPARE.map(def => [def[0], ...cols.map(c => cell(c.data, def))])]), 'text/csv;charset=utf-8');
  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 min-w-0">
      <header className="flex flex-wrap items-center gap-3 mb-4">
        <span className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0"><Columns3 size={16} aria-hidden="true" /></span>
        <div className="min-w-0 flex-1"><h3 className="text-16 font-semibold text-slate-900 leading-tight">Comparison</h3><p className="text-12 text-slate-500 mt-0.5">The best value in each row is green, the weakest is red. Choose a page to open its full report below.</p></div>
        <Button size="sm" icon={Download} onClick={exportCsv}>Download comparison CSV</Button>
      </header>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-14 border-separate border-spacing-0 min-w-[620px]">
          <thead>
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-12 font-medium text-slate-500 w-52 sticky left-0 z-[1] bg-slate-50 border-b border-slate-200">Metric</th>
              {cols.map(c => (
                <th scope="col" key={c.url} className="px-4 py-3 text-left min-w-[170px] bg-slate-50 border-b border-slate-200 font-normal">
                  <button type="button" onClick={() => onOpen(c.url)} aria-current={active === c.url ? 'true' : undefined} className="text-left cursor-pointer group focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded">
                    <span className={`block text-14 font-semibold break-all group-hover:text-indigo-600 ${active === c.url ? 'text-indigo-700' : 'text-slate-900'}`}>{hostOf(c.data.final_url || c.url)}</span>
                    <span className="flex items-center gap-2 mt-1.5">{SCORE_AREAS.map(([k, label]) => <span key={k} className="flex flex-col items-center"><MiniRing score={c.data.scores?.[k]?.score} /><span className="text-10.5 text-slate-500 mt-0.5">{label}</span></span>)}</span>
                    <span className="block text-11.5 text-slate-400 mt-1">{active === c.url ? 'shown below' : 'open report'}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARE.map(def => { const r = rank(def); return (
              <tr key={def[0]} className="h-11 odd:bg-white even:bg-slate-50/70">
                <td className="px-4 text-slate-600 sticky left-0 z-[1] bg-inherit border-b border-slate-100">{def[0]}</td>
                {cols.map(c => { const raw = def[1](c.data); const num = typeof raw === 'number' ? raw : null; const cls = num != null && r.best != null ? (num === r.best ? 'bg-emerald-50 text-emerald-800 font-semibold' : num === r.worst ? 'bg-red-50 text-red-700' : '') : ''; return <td key={c.url} className={`px-4 tabular-nums text-slate-800 border-b border-slate-100 ${cls}`}>{cell(c.data, def)}</td>; })}
              </tr>
            ); })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function XRay({ b, embedded = false, trigger = null, onBusy = null, onSaved = null }) {
  const [input, setInput] = useState('');
  const [urls, setUrls] = useState([]);
  const [results, setResults] = useState({}); // url -> {state, data, error}
  const [active, setActive] = useState(null);
  const [formError, setFormError] = useState('');
  const [renderJs, setRenderJs] = useState(false); // read the page after its JavaScript ran (own website only)
  const [saved, setSaved] = useState(null); // a past run opened from the history: {data, at}
  const [tick, setTick] = useState(0); // bumped after a save so the history reloads
  const [notice, setNotice] = useState('');
  const seq = useRef(0);
  const [saveDone, setSaveDone] = useState(false); // the scan on screen has been saved: only then may its result close or open fix tasks
  const [fixes, setFixes] = useState({ tasks: {}, reason: null });
  const touched = useRef(false); // a scan was started in this visit: the saved one must not come back over it
  const own = hostOf(b.website || '');
  const comps = useApi(`/businesses/${b.id}/gbp/competitors`);
  const comps2 = useApi(`/competitors?business_id=${b.id}`);

  const suggestions = useMemo(() => {
    const out = [];
    for (const c of [...arr(comps.data?.competitors), ...(Array.isArray(comps2.data) ? comps2.data : [])]) {
      if (c?.website && !out.some(o => hostOf(o.url) === hostOf(c.website))) out.push({ url: c.website, name: c.name || hostOf(c.website) });
    }
    return out.slice(0, 6);
  }, [comps.data, comps2.data]);

  const run = useCallback(async (list, forceRender = false) => {
    const mine = ++seq.current;
    touched.current = true;
    setSaveDone(false);
    setResults(r => ({ ...r, ...Object.fromEntries(list.map(u => [u, { state: 'loading' }])) }));
    const settled = await Promise.allSettled(list.map(u => api(`/businesses/${b.id}/page-xray`, { method: 'POST', body: { url: u, ...((renderJs || forceRender) && own && hostOf(u) === own ? { render: true } : {}) } })));
    if (mine !== seq.current && list.length > 1) { /* a newer run started: keep the latest answers per url anyway */ }
    setResults(r => {
      const next = { ...r };
      settled.forEach((s, i) => { next[list[i]] = s.status === 'fulfilled' ? { state: 'done', data: s.value } : { state: 'error', error: s.reason?.message || 'The page could not be inspected.' }; });
      return next;
    });
    // Every successful X-Ray is saved to the page's history. Quietly: a failed save never breaks the view.
    Promise.allSettled(settled.map(x => (x.status === 'fulfilled' ? api(`/businesses/${b.id}/page-xray/save`, { method: 'POST', body: { report: x.value } }) : null))).then(() => { setTick(t => t + 1); setSaveDone(true); });
    const ok = settled.some(s => s.status === 'fulfilled');
    if (ok) setSaved(null); // the new scan replaces the previous one only once it has really arrived; a failed scan leaves the previous one on screen
    return ok;
  }, [b.id, renderJs, own]);

  // Until the next scan is done, the last one stays on screen: the latest saved X-Ray of this project opens by itself.
  const [lastShown, setLastShown] = useState(null);
  useEffect(() => {
    let live = true;
    setSaved(null); setLastShown(null);
    api(`/businesses/${b.id}/page-xray/history?limit=1`).then(async list => {
      const row = Array.isArray(list) ? list[0] : null;
      if (!row || !live) return;
      const full = await api(`/businesses/${b.id}/page-xray/history/${row.id}`);
      if (live && !touched.current && full?.report) setSaved(s => s || { data: full.report, at: full.created_at || row.created_at });
    }).catch(() => { /* no saved scan, or it could not be read: the page simply starts empty */ });
    return () => { live = false; };
  }, [b.id]);

  const add = (raw) => {
    const u = normaliseUrl(raw);
    if (!u || !/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(u)) { setFormError('Enter a full web address, for example https://example.com/page'); return null; }
    setFormError('');
    if (urls.includes(u)) return u;
    if (urls.length >= MAX_URLS) { setFormError(`You can compare up to ${MAX_URLS} pages. Remove one first.`); return null; }
    setUrls(x => [...x, u]);
    return u;
  };
  const remove = (u) => { setUrls(x => x.filter(i => i !== u)); setResults(r => { const n = { ...r }; delete n[u]; return n; }); if (active === u) setActive(null); };
  const addOnly = (raw) => { const u = add(raw); if (u) setInput(''); };
  const inspect = async () => {
    let list = urls;
    if (input.trim()) { const u = add(input); if (!u) return; list = urls.includes(u) ? urls : [...urls, u]; setInput(''); }
    if (!list.length) { setFormError('Enter a page address to inspect.'); return; }
    setNotice('');
    setActive(list[0]);
    await run(list);
  };
  const useSite = () => { if (b.website) { const u = add(b.website); if (u) { setNotice(''); setActive(u); run(urls.includes(u) ? urls : [...urls, u]); } } };
  // A link from SERP X-Ray (or anywhere) can carry the page to inspect: /page-xray?url=https://example.com/page. It is read once, then removed from the address.
  const [params, setParams] = useSearchParams();
  const wanted = params.get('url');
  const handedOver = useRef(false);
  useEffect(() => {
    if (!wanted || handedOver.current) return;
    handedOver.current = true;
    const u = add(wanted);
    const keepHash = window.location.hash; // the chosen report group (#checks) survives the address clean-up
    setParams(p => { const n = new URLSearchParams(p); n.delete('url'); return n; }, { replace: true });
    if (keepHash) setTimeout(() => { try { window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${keepHash}`); } catch { /* optional */ } }, 0);
    if (u) { setNotice(''); setActive(u); run([u]); }
  }, [wanted]); // eslint-disable-line react-hooks/exhaustive-deps
  // Embedded in the website page: one click there runs this too (the homepage, read as a browser shows it when it is the own site).
  const lastTrigger = useRef(0);
  useEffect(() => {
    if (!trigger?.n || trigger.n === lastTrigger.current) return;
    lastTrigger.current = trigger.n;
    const u = normaliseUrl(trigger.url || '');
    if (!u || !/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(u)) return;
    setUrls([u]); setResults({}); setActive(u); setNotice(''); setFormError('');
    run([u], true);
  }, [trigger?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = urls.map(u => ({ url: u, ...(results[u] || { state: 'idle' }) }));
  const loading = items.some(i => i.state === 'loading');
  const done = items.filter(i => i.state === 'done');
  const shown = items.find(i => i.url === active && i.state === 'done') || (done.length === 1 ? done[0] : null);
  useEffect(() => { if (shown?.data) setLastShown(shown.data); }, [shown?.data]);
  useEffect(() => { if (onBusy) onBusy(loading); }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (saveDone && onSaved) onSaved(); }, [saveDone]); // eslint-disable-line react-hooks/exhaustive-deps
  const fixUrl = (saved?.data || shown?.data || {}).url || null;
  const fixFresh = !saved && !!shown?.data && saveDone;
  useEffect(() => {
    if (!fixUrl) { setFixes({ tasks: {}, reason: null }); return undefined; }
    let live = true;
    const t = setTimeout(() => { // the tasks follow the saved copy of this scan
      api(`/businesses/${b.id}/growth/xray-fixes`, { method: 'POST', body: { url: fixUrl, apply: fixFresh }, timeout: 60000 }).then(r => { if (live) setFixes({ tasks: r.tasks || {}, reason: r.reason || null }); }).catch(() => { if (live) setFixes({ tasks: {}, reason: null }); });
    }, 700);
    return () => { live = false; clearTimeout(t); };
  }, [fixUrl, fixFresh, b.id]);

  return (
    <FixCtx.Provider value={{ tasks: fixes.tasks, reason: fixes.reason, bid: b.id }}>
    <div className="space-y-6 min-w-0 w-full" style={{ contain: 'inline-size' }}>{/* the page never grows wider than the screen because of a long row of tabs or a wide table */}
      {!embedded && <Card>
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[240px]">
            <Globe size={15} className="absolute left-3 top-3 text-slate-400" aria-hidden="true" />
            <input value={input} onChange={e => { setInput(e.target.value); setFormError(''); }} onKeyDown={e => { if (e.key === 'Enter') inspect(); }} placeholder="https://… any page" aria-label="Page address to inspect" inputMode="url"
              className="w-full h-10 pl-9 pr-3 text-13 rounded-lg bg-white ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none text-slate-900 placeholder-slate-400" />
          </div>
          <Button variant="primary" icon={Search} busy={loading} onClick={inspect} className="h-10 px-5">Inspect</Button>
          <Button icon={Plus} disabled={!input.trim() || urls.length >= MAX_URLS} onClick={() => addOnly(input)} title="Keep this page and add another to compare">Add to compare</Button>
        </div>
        {formError && <p className="text-12.5 text-red-600 mt-2" role="alert">{formError}</p>}
        {own && (hostOf(input) === own || urls.some(u => hostOf(u) === own) || (!input.trim() && !urls.length)) && (
          <label className="mt-2 inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-12.5 text-slate-600 cursor-pointer">
            <input type="checkbox" checked={renderJs} onChange={e => setRenderJs(e.target.checked)} />
            <span className="font-medium">Render JavaScript (Chrome)</span>
            <span className="text-slate-400">your own website only: reads the page after its JavaScript ran, like a browser</span>
          </label>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {b.website && <button type="button" onClick={useSite} className="h-7 px-3 rounded-full text-12 font-semibold ring-1 ring-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 cursor-pointer">Use my website · {hostOf(b.website)}</button>}
          {suggestions.length > 0 && <span className="text-11.5 text-slate-400 ml-1">Competitors:</span>}
          {suggestions.map(s => <button key={s.url} type="button" onClick={() => addOnly(s.url)} disabled={urls.length >= MAX_URLS} title={s.url} className="h-7 px-3 rounded-full text-12 ring-1 ring-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer inline-flex items-center gap-1"><Plus size={11} />{s.name.length > 24 ? `${s.name.slice(0, 22)}…` : s.name}</button>)}
        </div>
        {urls.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2" aria-live="polite">
            {items.map(i => (
              <span key={i.url} className={`inline-flex items-center gap-2 rounded-lg ring-1 px-3 py-1.5 text-12.5 ${i.state === 'error' ? 'ring-red-200 bg-red-50 text-red-800' : i.state === 'done' ? 'ring-emerald-200 bg-emerald-50 text-emerald-900' : 'ring-slate-200 bg-white text-slate-700'}`}>
                {i.state === 'loading' ? <Loader2 size={13} className="animate-spin" /> : i.state === 'done' ? <Check size={13} /> : i.state === 'error' ? <AlertTriangle size={13} /> : <FileText size={13} />}
                <span className="max-w-[260px] truncate" title={i.url}>{hostOf(i.url)}{(() => { try { const p = new URL(i.url).pathname; return p && p !== '/' ? p : ''; } catch { return ''; } })()}</span>
                <button type="button" onClick={() => remove(i.url)} aria-label={`Remove ${i.url}`} className="text-slate-400 hover:text-red-600 cursor-pointer"><X size={13} /></button>
              </span>
            ))}
          </div>
        )}
        {items.filter(i => i.state === 'error').map(i => <p key={i.url} className="text-12.5 text-red-600 mt-2" role="alert"><b>{hostOf(i.url)}:</b> {i.error}</p>)}
        <div className="sr-only" aria-live="polite">{loading ? 'Inspecting pages…' : done.length ? `${done.length} page${done.length > 1 ? 's' : ''} inspected` : ''}</div>
      </Card>}

      {loading && done.length === 0 && !saved && !lastShown && <Card><div className="py-10 flex flex-col items-center gap-2 text-slate-500"><Loader2 className="animate-spin" /><div className="text-13">Opening the page and reading its HTML, headers, certificate, domain record and robots.txt…</div></div></Card>}

      {!embedded && done.length === 0 && !loading && urls.length === 0 && !saved && !lastShown && (
        <Card><div className="py-8 text-center max-w-xl mx-auto">
          <span className="inline-flex w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 items-center justify-center"><ShieldCheck size={22} /></span>
          <div className="text-16 font-semibold text-slate-900 mt-3">Inspect any page in one click</div>
          <p className="text-13 text-slate-500 mt-1">Type a page address, or press <b>Use my website</b>. You get SEO, AEO and GEO checks, the tech stack, domain age, SSL, security headers and AI-crawler access, all read live from the page. Add up to three pages to compare them side by side.</p>
        </div></Card>
      )}

      {done.length >= 2 && <Compare items={items} onOpen={setActive} active={shown?.url} />}
      {done.length >= 2 && !shown && <p className="text-13 text-slate-500 text-center">Click a page name in the table to open its full report.</p>}
      {notice && <p className="text-13 text-amber-700 bg-amber-50 rounded-lg px-3 py-2" role="alert">{notice}</p>}
      {saved && (
        <div className="rounded-lg bg-indigo-50 ring-1 ring-inset ring-indigo-200 px-4 py-2.5 flex flex-wrap items-center gap-3 text-13 text-indigo-900">
          <History size={15} className="shrink-0" />
          {loading ? <Loader2 size={14} className="animate-spin shrink-0" /> : null}
          <span className="flex-1 min-w-[200px]">{loading ? 'Scanning now… the previous X-Ray stays here until the new one arrives. ' : ''}Showing the X-Ray saved on <b>{new Date(saved.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}</b>{saved.data?.url ? <> for <b className="break-all">{saved.data.url}</b></> : null}. It is a saved copy, not a new check.</span>
          <Button size="sm" disabled={loading} onClick={() => { const u = saved.data.url; setActive(u); setUrls(x => (x.includes(u) ? x : [...x, u])); run([u]); }}>Check it again now</Button>
          <Button size="sm" onClick={() => setSaved(null)}>Close</Button>
        </div>
      )}
      {(() => {
        const cur = saved?.data || shown?.data || (loading ? lastShown : null);
        const rendering = cur?.rendering && typeof cur.rendering === 'object' ? <RenderingCard r={cur.rendering} /> : null;
        const history = cur ? <HistoryPanel b={b} url={cur.url} tick={tick} onOpen={(report, at) => setSaved({ data: report, at })} onError={setNotice} /> : null;
        const siteScan = b.website ? <SiteScan b={b} onOpen={(report, at) => { setNotice(''); setSaved({ data: report, at }); window.scrollTo({ top: 0, behavior: 'smooth' }); }} onDone={() => setTick(t => t + 1)} /> : null;
        const full = cur ? <FullPageCard b={b} url={cur.final_url || cur.url} /> : null;
        if (!cur) return siteScan;
        if (!saved && !shown) return <Report key={`last-${cur.fetched_at || cur.url}`} d={cur} busy extra={rendering} deep={full} history={history} siteScan={siteScan} onRerun={() => {}} />;
        return saved
          ? <Report key={`saved-${saved.at}`} d={saved.data} busy={false} extra={rendering} deep={full} history={history} siteScan={siteScan} onRerun={() => { const u = saved.data.url; setSaved(null); run([u]); }} />
          : <Report key={shown.url + (shown.data?.fetched_at || '')} d={shown.data} busy={shown.state === 'loading'} extra={rendering} deep={full} history={history} siteScan={siteScan} onRerun={() => run([shown.url])} />;
      })()}
    </div>
    </FixCtx.Provider>
  );
}

export default function PageXRayPage() {
  return (
    <SeoShell step="website" title="Page X-Ray" subtitle="Inspect any page in one click: SEO, answer-engine (AEO) and AI-search (GEO) readiness, tech stack, domain and security. Real data from the live page.">
      {(b) => <XRay key={b.id} b={b} />}
    </SeoShell>
  );
}
