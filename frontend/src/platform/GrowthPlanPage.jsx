import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  AlertTriangle, Ban, Bot, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronUp, Clock, ExternalLink, Globe, History as HistoryIcon, Layers, ListChecks, Loader2, Lock, MapPinned,
  MessageSquare, RefreshCw, ShieldCheck, Sparkles, Store, Sun, Target, TrendingDown, TrendingUp, Users, Wrench, X, XCircle, FileText
} from 'lucide-react';
import { SeoShell, Button, Drawer, useSeoBusiness } from './SeoUi';
import { api } from './seoApi';
import { ContentPlanView, IssuesView, ReportsView, StartCard } from './GrowthIssuesReports';

// ---------------------------------------------------------------------------------------------------------------- helpers
const arr = (v) => (Array.isArray(v) ? v : []);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const dash = (v) => (v == null || v === '' ? '—' : v);
const tone = (s) => (!isNum(s) ? 'text-slate-400' : s >= 75 ? 'text-emerald-600' : s >= 45 ? 'text-amber-600' : 'text-red-600');
const ring = (s) => (!isNum(s) ? '#cbd5e1' : s >= 75 ? '#10b981' : s >= 45 ? '#f59e0b' : '#ef4444');
const meterBg = (s) => (!isNum(s) ? 'bg-slate-300' : s >= 75 ? 'bg-emerald-500' : s >= 45 ? 'bg-amber-400' : 'bg-red-400');
const fmtDay = (d) => { if (!d) return '—'; const t = new Date(`${String(d).slice(0, 10)}T00:00:00`); return Number.isNaN(t.getTime()) ? String(d) : t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }); };
const fmtWhen = (iso) => { if (!iso) return '—'; const t = new Date(iso); return Number.isNaN(t.getTime()) ? '—' : t.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }); };
const fmtVal = (v, unit) => {
  if (v == null || v === '') return '—';
  const n = isNum(v) ? (Number.isInteger(v) ? v.toLocaleString('en-IN') : String(Math.round(v * 10) / 10)) : String(v);
  if (!unit) return n;
  const one = Number(v) === 1 && /s$/.test(unit) && !/^(points|score)$/.test(unit); // "1 review", not "1 reviews"
  return unit === '%' ? `${n}%` : `${n} ${one ? unit.slice(0, -1) : unit}`;
};

const AREAS = {
  gmb: { label: 'Google Business Profile', icon: Store, chip: 'bg-emerald-50 text-emerald-600' },
  local: { label: 'Local SEO', icon: MapPinned, chip: 'bg-sky-50 text-sky-600' },
  local_seo: { label: 'Local SEO', icon: MapPinned, chip: 'bg-sky-50 text-sky-600' },
  seo: { label: 'Website SEO & security', icon: Globe, chip: 'bg-indigo-50 text-indigo-600' },
  aeo: { label: 'Answer engines (AEO)', icon: MessageSquare, chip: 'bg-violet-50 text-violet-600' },
  geo: { label: 'AI search (GEO)', icon: Sparkles, chip: 'bg-fuchsia-50 text-fuchsia-600' },
  chatgpt: { label: 'ChatGPT presence', icon: Bot, chip: 'bg-teal-50 text-teal-600' }
};
const areaOf = (k, fallback) => ({ ...(AREAS[k] || { label: fallback || String(k || 'Other'), icon: Layers, chip: 'bg-slate-100 text-slate-600' }), ...(fallback && !AREAS[k] ? { label: fallback } : {}) });
const AREA_ORDER = ['gmb', 'local', 'local_seo', 'seo', 'aeo', 'geo', 'chatgpt'];
const byArea = (items) => {
  const m = new Map();
  for (const it of arr(items)) { const k = it.area || 'other'; if (!m.has(k)) m.set(k, []); m.get(k).push(it); }
  return [...m.entries()].sort((a, b) => { const ia = AREA_ORDER.indexOf(a[0]), ib = AREA_ORDER.indexOf(b[0]); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
};

const TARGET_STATUS = {
  met: ['Met', 'bg-emerald-50 text-emerald-700 ring-emerald-200'], on_track: ['On track', 'bg-indigo-50 text-indigo-700 ring-indigo-200'], at_risk: ['At risk', 'bg-amber-50 text-amber-700 ring-amber-200'],
  missed: ['Missed', 'bg-red-50 text-red-700 ring-red-200'], blocked: ['Blocked', 'bg-slate-100 text-slate-600 ring-slate-200'], open: ['Open', 'bg-slate-50 text-slate-600 ring-slate-200']
};
const MODES = { manual: ['Manual', 'bg-slate-100 text-slate-700'], assisted: ['AI-assisted · needs your approval', 'bg-violet-50 text-violet-700'], auto: ['Automatic', 'bg-emerald-50 text-emerald-700'] };
const PERIODS = [['today', 'daily', 'Today'], ['week', 'weekly', 'This week'], ['month', 'monthly', 'This month']];
const TABS = [['today', 'Today', Sun], ['week', 'This week', CalendarDays], ['month', 'This month', CalendarDays], ['issues', 'Issues', Wrench], ['content', 'Content plan', Layers], ['reports', 'Reports', FileText], ['reality', 'Reality checks', ShieldCheck], ['history', 'History', HistoryIcon]];

function targetProgress(t) {
  if (isNum(t.baseline) && isNum(t.current) && isNum(t.target) && t.target !== t.baseline) {
    const p = t.direction === 'down' ? (t.baseline - t.current) / (t.baseline - t.target) : (t.current - t.baseline) / (t.target - t.baseline);
    return Math.max(0, Math.min(100, Math.round(p * 100)));
  }
  if (isNum(t.progress)) return Math.max(0, Math.min(100, Math.round(t.progress <= 1 && t.progress > 0 ? t.progress * 100 : t.progress)));
  return t.status === 'met' ? 100 : 0;
}

// ---------------------------------------------------------------------------------------------------------------- small parts
const Card = ({ children, className = '' }) => <section className={`bg-white rounded-xl border border-slate-200 shadow-sm min-w-0 ${className}`}>{children}</section>;
const Chip = ({ children, cls = 'bg-slate-100 text-slate-700', title }) => <span title={title} className={`inline-flex items-center gap-1 text-12 rounded-full px-2.5 py-1 leading-none font-medium ${cls}`}>{children}</span>;
const IconChip = ({ icon: Icon, cls }) => <span className={`w-9 h-9 rounded-full inline-flex items-center justify-center shrink-0 ${cls}`} aria-hidden="true"><Icon size={17} /></span>;
const Skeleton = ({ h = 'h-24', className = '' }) => <div className={`rounded-xl bg-slate-100 animate-pulse ${h} ${className}`} />;

function Gauge({ score, size = 132 }) {
  const r = (size - 16) / 2, c = 2 * Math.PI * r, s = isNum(score) ? Math.max(0, Math.min(100, score)) : 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={isNum(score) ? `Presence strength ${Math.round(score)} out of 100` : 'Presence strength not measured yet'} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth="11" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={ring(score)} strokeWidth="11" strokeLinecap="round" strokeDasharray={`${(s / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fill="#0f172a" style={{ fontSize: size * 0.3, fontWeight: 700 }}>{isNum(score) ? Math.round(score) : '—'}</text>
    </svg>
  );
}

function Delta({ v }) {
  if (!isNum(v)) return <Chip cls="bg-slate-100 text-slate-500">No 30-day change yet</Chip>;
  const up = v > 0, down = v < 0;
  const Arrow = up ? TrendingUp : down ? TrendingDown : null;
  return <Chip cls={up ? 'bg-emerald-50 text-emerald-700' : down ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}>{Arrow && <Arrow size={13} />}{up ? '+' : ''}{v} in 30 days</Chip>;
}

// ---------------------------------------------------------------------------------------------------------------- hero
function Hero({ g, onRefresh, refreshing, secs, onAll }) {
  const p = g.presence || {};
  const trend = arr(p.trend).filter(x => isNum(x.score)).map(x => ({ day: x.day, score: x.score }));
  const building = g.mode !== 'maintain';
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start gap-x-8 gap-y-5">
        <div className="flex items-center gap-5">
          <Gauge score={p.score} />
          <div className="space-y-2">
            <div className="text-12 font-semibold uppercase tracking-wide text-slate-500">Presence strength</div>
            <div className="flex flex-wrap gap-2"><Delta v={p.delta_30d} /><Chip cls={building ? 'bg-indigo-50 text-indigo-700' : 'bg-emerald-50 text-emerald-700'}>{building ? <TrendingUp size={13} /> : <ShieldCheck size={13} />}{building ? 'Building' : 'Maintaining'}</Chip>{g.plan && <Chip>{g.plan} plan</Chip>}</div>
            <div className="text-12 text-slate-500">Updated {fmtWhen(g.generated_at)}</div>
          </div>
        </div>

        <div className="flex-1 min-w-[260px] h-[120px]" aria-label="Presence strength over the last 90 days">
          {trend.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
                <defs><linearGradient id="gpFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6366f1" stopOpacity={0.25} /><stop offset="100%" stopColor="#6366f1" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" tickFormatter={fmtDay} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} minTickGap={28} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={40} />
                <Tooltip labelFormatter={fmtDay} formatter={(v) => [v, 'Presence']} contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12 }} />
                <Area type="monotone" dataKey="score" stroke="#6366f1" strokeWidth={2} fill="url(#gpFill)" dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : <div className="h-full rounded-xl bg-slate-50 border border-dashed border-slate-200 flex items-center justify-center text-13 text-slate-500 text-center px-4">The trend appears after the second daily measurement.</div>}
        </div>

        <div className="flex flex-wrap lg:flex-col gap-2 min-w-0 lg:shrink-0">
          <Button variant="primary" icon={refreshing ? Loader2 : RefreshCw} disabled={refreshing} onClick={onRefresh}>{refreshing ? `Measuring… ${secs}s` : 'Refresh plan'}</Button>
          <Link to="/work-plan"><Button icon={ListChecks} className="w-full">Open work plan</Button></Link>
          <Button icon={Users} onClick={onAll}>All projects</Button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-8 gap-y-4">
        {arr(p.areas).map(a => {
          const meta = areaOf(a.key, a.label);
          const Icon = meta.icon;
          const blocked = a.state === 'blocked', notStarted = a.state === 'not_started';
          return (
            <div key={a.key} className="min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`w-7 h-7 rounded-full inline-flex items-center justify-center shrink-0 ${meta.chip}`} aria-hidden="true"><Icon size={14} /></span>
                <span className="text-13 font-medium text-slate-800 truncate">{a.label || meta.label}</span>
                <span className="text-11 text-slate-400 shrink-0">{isNum(a.weight) ? `${a.weight}%` : ''}</span>
                <span className={`ml-auto text-14 font-semibold tabular-nums ${blocked || notStarted ? 'text-slate-400' : tone(a.score)}`}>{blocked || notStarted ? '—' : isNum(a.score) ? Math.round(a.score) : '—'}</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full rounded-full ${blocked || notStarted ? 'bg-slate-200' : meterBg(a.score)}`} style={{ width: `${blocked || notStarted ? 0 : Math.max(2, Math.min(100, a.score || 0))}%` }} /></div>
              {blocked && <p className="mt-1.5 text-12 text-slate-500 flex gap-1.5"><Lock size={12} className="mt-0.5 shrink-0 text-slate-400" /><span>{arr(a.blockers)[0] || 'Waiting for a requirement to be met.'}</span></p>}
              {notStarted && <p className="mt-1.5 text-12 text-slate-500">Not started yet: no measurement for this area.</p>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------- targets
const TASK_STATUS = {
  todo: ['To do', 'bg-slate-100 text-slate-700'], done: ['Done: awaiting check', 'bg-sky-50 text-sky-700'], verified: ['Verified', 'bg-emerald-50 text-emerald-700'],
  unverified: ['Not confirmed', 'bg-amber-50 text-amber-800'], failed: ['Failed check', 'bg-red-50 text-red-700'], blocked: ['Blocked', 'bg-slate-100 text-slate-600'], skipped: ['Skipped', 'bg-slate-50 text-slate-500']
};
const TASK_FILTERS = [
  ['all', 'All', () => true], ['todo', 'To do', a => a.status === 'todo'], ['check', 'Needs a check', a => ['done', 'unverified', 'failed'].includes(a.status)],
  ['verified', 'Verified', a => a.status === 'verified'], ['other', 'Skipped or blocked', a => ['skipped', 'blocked'].includes(a.status)]
];
const WHO = { manual: ['You do it', 'bg-slate-400'], assisted: ['AI drafts, you approve', 'bg-violet-500'], auto: ['Automatic', 'bg-emerald-500'] };
const TH = 'px-3 py-2.5 text-left text-11.5 font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap';
const todayIso = () => new Date().toISOString().slice(0, 10);

function AreaPill({ k }) {
  const meta = areaOf(k);
  const Icon = meta.icon;
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-12 font-medium whitespace-nowrap ${meta.chip}`}><Icon size={13} aria-hidden="true" />{meta.label}</span>;
}

/** One row per target: what it measures, where it started, where it is, the goal, the progress and whether it is on track. */
function TargetsTable({ items }) {
  const groups = byArea(items);
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-13 min-w-[920px]">
          <thead className="bg-slate-50 border-b border-slate-200"><tr>
            <th className={TH}>Target</th><th className={`${TH} text-right`}>Baseline</th><th className={`${TH} text-right`}>Now</th><th className={`${TH} text-right`}>Goal</th>
            <th className={`${TH} w-44`}>Progress</th><th className={TH}>Status</th><th className={TH}>Why this target</th></tr></thead>
          <tbody>
            {groups.map(([k, rows]) => (
              <React.Fragment key={k}>
                <tr className="bg-slate-50/70 border-y border-slate-200"><td colSpan={7} className="px-3 py-2"><AreaPill k={k} /> <span className="ml-2 text-12 text-slate-500">{rows.length} target{rows.length === 1 ? '' : 's'}</span></td></tr>
                {rows.map(t => {
                  const [label, cls] = TARGET_STATUS[t.status] || TARGET_STATUS.open;
                  const pr = t.status === 'met' ? 100 : targetProgress(t);
                  const f = t.feasibility || {};
                  const note = [f.cap != null ? `Capped at ${typeof f.cap === 'number' ? f.cap : String(f.cap)}` : null, f.note].filter(Boolean).join(' · ');
                  return (
                    <tr key={t.id} className="align-top border-b border-slate-100 hover:bg-slate-50/60">
                      <td className="px-3 py-3 min-w-[220px]"><div className="font-semibold text-slate-900 leading-snug">{t.label}</div><div className="text-11.5 text-slate-400 mt-0.5">{fmtDay(t.window_start)} – {fmtDay(t.window_end)}</div></td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-600 whitespace-nowrap">{fmtVal(t.baseline, t.unit)}</td>
                      <td className="px-3 py-3 text-right tabular-nums font-bold text-slate-900 whitespace-nowrap">{fmtVal(t.current, t.unit)}</td>
                      <td className="px-3 py-3 text-right tabular-nums font-semibold text-indigo-700 whitespace-nowrap">{fmtVal(t.target, t.unit)}{t.direction === 'down' ? <span className="block text-11 font-normal text-slate-400">lower is better</span> : t.direction === 'keep' ? <span className="block text-11 font-normal text-slate-400">keep it</span> : null}</td>
                      <td className="px-3 py-3">
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuenow={pr} aria-valuemin={0} aria-valuemax={100} aria-label={`${t.label}: ${pr}% of the way to the target`}>
                          <div className={`h-full rounded-full ${t.status === 'met' ? 'bg-emerald-500' : t.status === 'at_risk' ? 'bg-amber-400' : t.status === 'missed' ? 'bg-red-400' : t.status === 'blocked' ? 'bg-slate-300' : 'bg-indigo-500'}`} style={{ width: `${Math.max(pr, pr > 0 ? 4 : 0)}%` }} />
                        </div>
                        <div className="text-11.5 text-slate-500 mt-1 tabular-nums">{pr}% of the way</div>
                      </td>
                      <td className="px-3 py-3"><span className={`inline-block text-11.5 font-semibold rounded-full px-2.5 py-1 leading-none ring-1 ring-inset whitespace-nowrap ${cls}`}>{label}</span></td>
                      <td className="px-3 py-3 text-12.5 text-slate-600 leading-relaxed max-w-[360px]">{t.why || <span className="text-slate-400">—</span>}{note && <span className="block text-11.5 text-slate-500 mt-1">{note}</span>}</td>
                    </tr>
                  );
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** One task: its row (what, area, who does it, time, due, status, what the live check says, buttons) and, when opened, its steps and the note box. */
function TaskRow({ a, bid, onChanged }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [panel, setPanel] = useState(null); // 'done' | 'skip'
  const [text, setText] = useState('');
  const [steps, setSteps] = useState(false);
  const [result, setResult] = useState(null);
  const how = arr(a.how);
  const mode = MODES[a.mode] || MODES.manual;
  const st = a.status;
  const [stLabel, stCls] = TASK_STATUS[st] || TASK_STATUS.todo;
  const ext = a.link && /^https?:\/\//i.test(a.link);
  const overdue = st === 'todo' && a.due_on && String(a.due_on).slice(0, 10) < todayIso();
  const call = async (kind, body) => {
    setBusy(kind); setError('');
    try {
      const r = await api(`/businesses/${bid}/growth/actions/${a.id}/${kind}`, { method: 'POST', body: body || {} });
      if (kind === 'verify') setResult(r?.result || null);
      setPanel(null); setText('');
      await onChanged();
    } catch (e) { setError(e.message || 'That did not work. Try again.'); } finally { setBusy(''); }
  };
  const ev = typeof a.evidence === 'string' ? a.evidence : '';
  const check = st === 'verified' ? <><b className="text-emerald-700">Verified</b> {fmtWhen(a.verified_at)}{(result?.before != null || result?.after != null) ? <span className="tabular-nums"> · {dash(result.before)} → {dash(result.after)}</span> : null}{ev ? <span className="block text-slate-500">{ev}</span> : null}</>
    : st === 'unverified' ? <>{result?.details || ev || 'The live data does not show this change yet. Some changes take a few hours to appear.'}</>
    : st === 'failed' ? <>{ev || 'This task failed its live check.'}</>
    : st === 'blocked' ? <>{ev || 'Blocked until something it depends on is done.'}</>
    : st === 'skipped' ? <>Skipped{a.note ? `: ${a.note}` : ''}</>
    : st === 'done' ? <>Marked done{a.note ? `: ${a.note}` : ''}. Counted only once live data confirms it.</>
    : <span className="text-slate-400">Not checked yet: it is checked against live data after you finish</span>;
  const open = steps || panel || error;
  return (
    <>
      <tr className={`align-top border-b border-slate-100 hover:bg-slate-50/60 ${st === 'skipped' ? 'opacity-70' : ''}`}>
        <td className="px-3 py-3 min-w-[240px] max-w-[340px]">
          <div className="font-semibold text-slate-900 leading-snug">{a.title}</div>
          {a.why && <div className="text-12.5 text-slate-600 mt-1 leading-relaxed line-clamp-3" title={a.why}>{a.why}</div>}
          {how.length > 0 && <button type="button" onClick={() => setSteps(x => !x)} aria-expanded={steps} className="mt-1.5 inline-flex items-center gap-1 text-12 font-semibold text-indigo-600 hover:underline cursor-pointer">{steps ? <>Hide steps <ChevronUp size={12} /></> : <>Show {how.length} step{how.length === 1 ? '' : 's'} <ChevronDown size={12} /></>}</button>}
        </td>
        <td className="px-3 py-3"><AreaPill k={a.area} /></td>
        <td className="px-3 py-3 text-12.5 text-slate-700 w-[130px]"><span className="inline-flex items-start gap-1.5"><span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${(WHO[a.mode] || WHO.manual)[1]}`} aria-hidden="true" /><span>{(WHO[a.mode] || WHO.manual)[0]}</span></span></td>
        <td className={`px-3 py-3 text-12.5 whitespace-nowrap ${overdue ? 'text-red-600 font-semibold' : 'text-slate-700'}`}>{a.due_on ? fmtDay(a.due_on) : '—'}{overdue && <span className="block text-11">overdue</span>}{isNum(a.est_minutes) && <span className="block text-11.5 font-normal text-slate-400 tabular-nums">{a.est_minutes} min</span>}</td>
        <td className="px-3 py-3"><span className={`inline-block text-11.5 font-semibold rounded-full px-2.5 py-1 leading-none whitespace-nowrap ${stCls}`}>{stLabel}</span></td>
        <td className="px-3 py-3 text-12.5 text-slate-600 leading-relaxed min-w-[180px] max-w-[260px]">{check}</td>
        <td className="px-3 py-3">
          <div className="flex flex-col items-stretch gap-1.5 w-[104px] ml-auto">
            {a.link && (ext ? <a href={a.link} target="_blank" rel="noreferrer"><Button size="sm" icon={ExternalLink}>Open</Button></a> : <Link to={a.link}><Button size="sm" icon={ExternalLink}>Open</Button></Link>)}
            {st === 'todo' && !panel && (<><Button size="sm" variant="primary" icon={Check} onClick={() => setPanel('done')}>Mark done</Button><Button size="sm" onClick={() => setPanel('skip')}>Skip</Button></>)}
            {(st === 'done' || st === 'unverified' || st === 'failed') && <Button size="sm" variant={st === 'done' ? 'primary' : undefined} icon={busy === 'verify' ? Loader2 : ShieldCheck} disabled={busy === 'verify'} onClick={() => call('verify')}>{busy === 'verify' ? 'Checking…' : 'Check now'}</Button>}
          </div>
        </td>
      </tr>
      {open && (
        <tr className="bg-slate-50/70 border-b border-slate-100">
          <td colSpan={7} className="px-4 py-3">
            {steps && how.length > 0 && <ol className="list-decimal pl-5 space-y-1 text-13 text-slate-700 max-w-3xl">{how.map((h, i) => <li key={i}>{h}</li>)}</ol>}
            {panel && (
              <div className="mt-2 max-w-xl">
                <label className="text-12 font-semibold text-slate-700 block mb-1" htmlFor={`gp-note-${a.id}`}>{panel === 'skip' ? 'Why are you skipping this? (at least 5 characters)' : 'Add a note (optional)'}</label>
                <textarea id={`gp-note-${a.id}`} rows={2} value={text} onChange={e => setText(e.target.value.slice(0, 500))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-13 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                <div className="mt-2 flex flex-wrap gap-2">
                  {panel === 'skip'
                    ? <Button size="sm" variant="primary" busy={busy === 'skip'} disabled={text.trim().length < 5} onClick={() => call('skip', { reason: text.trim() })}>Skip this task</Button>
                    : <Button size="sm" variant="primary" icon={Check} busy={busy === 'done'} onClick={() => call('done', text.trim() ? { note: text.trim() } : {})}>Confirm done</Button>}
                  <Button size="sm" onClick={() => { setPanel(null); setText(''); }}>Cancel</Button>
                </div>
              </div>
            )}
            {error && <p className="mt-2 text-12.5 text-red-600" role="alert">{error}</p>}
          </td>
        </tr>
      )}
    </>
  );
}

/** The period's tasks as one table, with filters by status and area, sorted so what needs you comes first. */
function TasksTable({ list, bid, onChanged }) {
  const [filter, setFilter] = useState('all');
  const [area, setArea] = useState('all');
  const order = { todo: 0, failed: 1, unverified: 2, done: 3, blocked: 4, verified: 5, skipped: 6 };
  const pred = TASK_FILTERS.find(f => f[0] === filter)[2];
  const areas = [...new Set(list.map(a => a.area || 'other'))];
  const rows = list.filter(a => pred(a) && (area === 'all' || (a.area || 'other') === area)).sort((x, y) => (order[x.status] ?? 9) - (order[y.status] ?? 9) || String(x.due_on || '').localeCompare(String(y.due_on || '')));
  const pill = (on) => `h-8 px-3 rounded-full text-12 font-semibold cursor-pointer ring-1 ring-inset ${on ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`;
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-100">
        {TASK_FILTERS.map(([id, label, f]) => <button key={id} type="button" onClick={() => setFilter(id)} aria-pressed={filter === id} className={pill(filter === id)}>{label} <span className="opacity-70">{list.filter(f).length}</span></button>)}
        {areas.length > 1 && <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden="true" />}
        {areas.length > 1 && [['all', 'All areas'], ...areas.map(k => [k, areaOf(k).label])].map(([k, label]) => <button key={k} type="button" onClick={() => setArea(k)} aria-pressed={area === k} className={pill(area === k)}>{label}</button>)}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-13 min-w-[940px]">
          <thead className="bg-slate-50 border-b border-slate-200"><tr>
            <th className={TH}>Task</th><th className={TH}>Area</th><th className={TH}>Who does it</th><th className={TH}>Due · time</th><th className={TH}>Status</th><th className={TH}>Live check</th><th className={`${TH} text-right`}>Actions</th></tr></thead>
          <tbody>
            {rows.map(a => <TaskRow key={a.id} a={a} bid={bid} onChanged={onChanged} />)}
            {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-13 text-slate-500">Nothing matches this filter.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PeriodView({ g, periodKey, bid, onChanged }) {
  const [, period, label] = PERIODS.find(p => p[0] === periodKey);
  const targets = arr(g.targets?.[period]);
  const list = arr(g.actions?.[periodKey]);
  const open = list.filter(a => a.status === 'todo').length;
  const verified = list.filter(a => a.status === 'verified').length;
  const nextRun = g.next?.[period];
  const met = targets.filter(t => t.status === 'met').length;
  return (
    <div className="space-y-8">
      <section className="space-y-3" aria-label={`${label}: targets`}>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 className="text-18 font-semibold text-slate-900">{label}: targets</h2>
          <span className="text-13 text-slate-500">{targets.length} target{targets.length === 1 ? '' : 's'}{targets.length ? ` · ${met} met` : ''}{nextRun ? ` · next ${period === 'daily' ? 'day' : period === 'weekly' ? 'week' : 'month'} starts ${fmtDay(nextRun)}` : ''}</span>
        </div>
        {targets.length === 0 ? <EmptyBox icon={Target} title="No targets for this period yet" text="Targets are set from real measurements. Press Refresh plan after connecting your Google account and running an audit." /> : <TargetsTable items={targets} />}
      </section>
      <section className="space-y-3" aria-label={`${label}: tasks`}>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 className="text-18 font-semibold text-slate-900">{label}: tasks</h2>
          <span className="text-13 text-slate-500">{open} to do · {verified} verified · {list.length} in total</span>
        </div>
        {list.length === 0 ? <EmptyBox icon={ListChecks} title="No tasks for this period" text="When a target needs work, its tasks appear here with the steps and how they will be checked." /> : <TasksTable list={list} bid={bid} onChanged={onChanged} />}
      </section>
    </div>
  );
}

const EmptyBox = ({ icon: Icon, title, text }) => (
  <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
    <span className="w-11 h-11 rounded-full bg-slate-100 text-slate-400 inline-flex items-center justify-center"><Icon size={20} aria-hidden="true" /></span>
    <div className="mt-3 text-15 font-semibold text-slate-800">{title}</div>
    <p className="mt-1 text-13 text-slate-500 max-w-md mx-auto">{text}</p>
  </div>
);

// ---------------------------------------------------------------------------------------------------------------- reality checks
function Reality({ g }) {
  const r = g.reality || {};
  const cap = r.capacity || {};
  const lists = [
    ['Adjustments made for you', r.adjustments, Sparkles, 'bg-indigo-50 text-indigo-600', 'Nothing had to be adjusted: the targets follow the standard rates.'],
    ['Caps that keep targets realistic', r.caps, ShieldCheck, 'bg-emerald-50 text-emerald-600', 'No cap was needed for this project.'],
    ['Blocked until you fix something', r.blocked, Lock, 'bg-slate-100 text-slate-600', 'Nothing is blocked.'],
    ['Deferred to a later period', r.deferred, CalendarDays, 'bg-amber-50 text-amber-600', 'Nothing was deferred.']
  ];
  return (
    <div className="space-y-6">
      <Card className="p-5 sm:p-6">
        <div className="flex items-center gap-3"><IconChip icon={ShieldCheck} cls="bg-indigo-50 text-indigo-600" /><h2 className="text-18 font-semibold text-slate-900">How the targets are set</h2></div>
        <p className="mt-3 text-14 text-slate-700 leading-relaxed max-w-4xl">Every target starts from a <b>baseline measured on real data</b> (your Google profile, your website, the live page checks). It is then <b>capped by what is realistic</b> for a business like yours, <b>scaled by how you did last time</b>, and every finished task is <b>verified against live data</b>. A task you tick as done is not counted until the data confirms it.</p>
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[['Daily', cap.daily], ['Weekly', cap.weekly], ['Monthly', cap.monthly]].map(([l, v]) => (
            <div key={l} className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3"><div className="text-12 text-slate-500">{l} capacity</div><div className="text-24 font-bold text-slate-900 tabular-nums leading-tight">{dash(v)}</div><div className="text-12 text-slate-500">tasks at most</div></div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        {lists.map(([title, items, Icon, chip, empty]) => (
          <Card key={title} className="p-5 sm:p-6">
            <div className="flex items-center gap-3 mb-3"><IconChip icon={Icon} cls={chip} /><h3 className="text-15 font-semibold text-slate-900">{title}</h3><span className="ml-auto text-12 text-slate-400 tabular-nums">{arr(items).length}</span></div>
            {arr(items).length ? <FoldList items={items} /> : <p className="text-13 text-slate-500">{empty}</p>}
          </Card>
        ))}
      </div>

      <Card className="p-5 sm:p-6">
        <div className="flex items-center gap-3 mb-3"><IconChip icon={Ban} cls="bg-red-50 text-red-600" /><h3 className="text-15 font-semibold text-slate-900">What we will never ask you to do</h3></div>
        {arr(r.policy).length ? (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2.5">{arr(r.policy).map((x, i) => <li key={i} className="text-13.5 text-slate-700 leading-relaxed flex gap-2"><X size={15} className="mt-1 text-red-500 shrink-0" aria-hidden="true" /><span>{x}</span></li>)}</ul>
        ) : <p className="text-13 text-slate-500">The server did not send the policy list.</p>}
      </Card>
    </div>
  );
}


/** A bulleted list that shows the first few items and folds the rest behind a toggle. */
function FoldList({ items, limit = 6, render }) {
  const [all, setAll] = useState(false);
  const list = arr(items);
  const shown = all ? list : list.slice(0, limit);
  return (
    <>
      <ul className="space-y-2">{shown.map((x, i) => <li key={i} className="text-13.5 text-slate-700 leading-relaxed flex gap-2"><span className="mt-2 w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />{render ? render(x) : x}</li>)}</ul>
      {list.length > limit && <button type="button" onClick={() => setAll(v => !v)} aria-expanded={all} className="mt-3 text-13 font-semibold text-indigo-600 hover:underline cursor-pointer">{all ? 'Show fewer' : `Show all ${list.length}`}</button>}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------- history
function HistoryView({ g }) {
  const rows = arr(g.history).filter(h => isNum(h.total));
  const weeks = rows.filter(h => h.period === 'week').slice(-8).map(h => ({ name: fmtDay(h.start), met: h.met || 0, missed: Math.max(0, (h.total || 0) - (h.met || 0)), total: h.total, start: h.start }));
  const months = rows.filter(h => h.period === 'month').slice(-3).map(h => ({ name: new Date(`${String(h.start).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }), met: h.met || 0, missed: Math.max(0, (h.total || 0) - (h.met || 0)), total: h.total, start: h.start }));
  if (!weeks.length && !months.length) return <EmptyBox icon={HistoryIcon} title="History appears after the first full week" text="Each finished week and month is saved with how many targets were met. Come back after the first week closes." />;
  const chart = (data, title) => (
    <Card className="p-5 sm:p-6">
      <h3 className="text-15 font-semibold text-slate-900 mb-1">{title}</h3>
      <p className="text-12.5 text-slate-500 mb-3">Targets met against targets set.</p>
      <div className="h-60">
        {data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: 'rgba(99,102,241,0.06)' }} contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="met" name="Met" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="missed" name="Not met" stackId="a" fill="#e2e8f0" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        ) : <div className="h-full flex items-center justify-center text-13 text-slate-500">No closed {title.toLowerCase().includes('week') ? 'weeks' : 'months'} yet.</div>}
      </div>
    </Card>
  );
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">{chart(weeks, 'Last 8 weeks')}{chart(months, 'Last 3 months')}</div>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-14">
            <thead><tr className="text-12 text-slate-500 border-b border-slate-200 bg-slate-50"><th className="px-5 py-3 text-left font-medium">Period</th><th className="px-5 py-3 text-left font-medium">Starts</th><th className="px-5 py-3 text-right font-medium">Met</th><th className="px-5 py-3 text-right font-medium">Set</th><th className="px-5 py-3 text-right font-medium">Rate</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {[...rows].reverse().map((h, i) => <tr key={i} className="h-12"><td className="px-5 capitalize text-slate-800">{h.period}</td><td className="px-5 text-slate-600">{fmtDay(h.start)}</td><td className="px-5 text-right tabular-nums">{dash(h.met)}</td><td className="px-5 text-right tabular-nums">{dash(h.total)}</td><td className={`px-5 text-right tabular-nums font-semibold ${h.total ? tone(Math.round((h.met / h.total) * 100)) : 'text-slate-400'}`}>{h.total ? `${Math.round((h.met / h.total) * 100)}%` : '—'}</td></tr>)}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------- all projects
function AllProjects({ open, onClose, onPick }) {
  const [state, setState] = useState({ loading: true, rows: [], error: '' });
  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    setState({ loading: true, rows: [], error: '' });
    api('/growth/overview').then(rows => { if (live) setState({ loading: false, rows: arr(rows), error: '' }); }).catch(e => { if (live) setState({ loading: false, rows: [], error: e.message || 'Could not load the projects.' }); });
    return () => { live = false; };
  }, [open]);
  return (
    <Drawer open={open} onClose={onClose} title="All projects" subtitle="Presence strength and today's work across your projects" width="max-w-3xl">
      {state.loading ? <div className="space-y-3"><Skeleton h="h-14" /><Skeleton h="h-14" /><Skeleton h="h-14" /></div>
        : state.error ? <p className="text-13 text-red-700 bg-red-50 rounded-lg px-3 py-2">{state.error}</p>
          : state.rows.length === 0 ? <p className="text-13 text-slate-500">No projects have a growth plan yet.</p> : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-14">
                <thead><tr className="text-12 text-slate-500 bg-slate-50 border-b border-slate-200"><th className="px-4 py-3 text-left font-medium">Project</th><th className="px-4 py-3 text-right font-medium">Presence</th><th className="px-4 py-3 text-right font-medium">30 days</th><th className="px-4 py-3 text-right font-medium">Open today</th><th className="px-4 py-3 text-right font-medium">At risk</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {state.rows.map(r => (
                    <tr key={r.business_id} tabIndex={0} onClick={() => onPick(r.business_id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(r.business_id); } }} className="h-14 cursor-pointer hover:bg-indigo-50/50 focus:outline-none focus-visible:bg-indigo-50">
                      <td className="px-4"><div className="font-medium text-slate-900">{r.name}</div><div className="text-11 text-slate-400">Updated {fmtWhen(r.updated_at)}</div></td>
                      <td className={`px-4 text-right tabular-nums font-semibold ${tone(r.presence)}`}>{isNum(r.presence) ? Math.round(r.presence) : '—'}</td>
                      <td className={`px-4 text-right tabular-nums ${!isNum(r.delta_30d) ? 'text-slate-400' : r.delta_30d > 0 ? 'text-emerald-600' : r.delta_30d < 0 ? 'text-red-600' : 'text-slate-600'}`}>{isNum(r.delta_30d) ? `${r.delta_30d > 0 ? '+' : ''}${r.delta_30d}` : '—'}</td>
                      <td className="px-4 text-right tabular-nums text-slate-800">{dash(r.actions_today_open)}</td>
                      <td className={`px-4 text-right tabular-nums ${r.targets_at_risk > 0 ? 'text-amber-600 font-semibold' : 'text-slate-600'}`}>{dash(r.targets_at_risk)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
    </Drawer>
  );
}

// ---------------------------------------------------------------------------------------------------------------- the page
function Growth({ b }) {
  const [, setBusiness] = useSeoBusiness();
  const [g, setG] = useState(null);
  const [error, setError] = useState(null); // {status, message}
  const [refreshing, setRefreshing] = useState(false);
  const [secs, setSecs] = useState(0);
  const [tab, setTab] = useState(() => { const h = (typeof window !== 'undefined' ? window.location.hash : '').replace('#', ''); return TABS.some(t => t[0] === h) ? h : 'today'; });
  const [all, setAll] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const data = await api(`/businesses/${b.id}/growth`);
      if (mine === seq.current) { setG(data); setError(null); }
    } catch (e) { if (mine === seq.current) setError({ status: e.status, message: e.message || 'Could not load the growth plan.' }); }
  }, [b.id]);
  useEffect(() => { setG(null); setError(null); load(); }, [load]);

  useEffect(() => {
    if (!refreshing) return undefined;
    setSecs(0);
    const t = setInterval(() => setSecs(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [refreshing]);
  const refresh = async () => {
    setRefreshing(true);
    try { const data = await api(`/businesses/${b.id}/growth/refresh`, { method: 'POST', body: {} }); setG(data); setError(null); } catch (e) { setError({ status: e.status, message: e.message || 'Could not refresh the plan.' }); } finally { setRefreshing(false); }
  };

  const pick = (id) => { setTab(id); try { window.history.replaceState(null, '', `#${id}`); } catch { /* ignore */ } };
  const onKey = (e) => {
    const i = TABS.findIndex(t => t[0] === tab);
    const next = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i - 1 + TABS.length) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault(); pick(TABS[next][0]);
    setTimeout(() => document.getElementById(`gp-tab-${TABS[next][0]}`)?.focus(), 0);
  };
  const counts = useMemo(() => ({
    today: arr(g?.actions?.today).filter(a => a.status === 'todo').length,
    week: arr(g?.actions?.week).filter(a => a.status === 'todo').length,
    month: arr(g?.actions?.month).filter(a => a.status === 'todo').length,
    issues: g?.issues?.open || 0,
    reality: arr(g?.reality?.blocked).length
  }), [g]);

  if (error && !g) {
    const missing = error.status === 404;
    return (
      <Card className="p-8 text-center max-w-xl mx-auto">
        <span className={`w-12 h-12 rounded-full inline-flex items-center justify-center ${missing ? 'bg-slate-100 text-slate-500' : 'bg-red-50 text-red-600'}`}><AlertTriangle size={22} aria-hidden="true" /></span>
        <h2 className="mt-3 text-16 font-semibold text-slate-900">{missing ? 'The growth plan is not available on this server yet' : 'The growth plan could not be loaded'}</h2>
        <p className="mt-1 text-13 text-slate-600">{missing ? 'Update and restart the backend, then try again.' : error.message}</p>
        <div className="mt-4"><Button variant="primary" icon={RefreshCw} onClick={() => { setError(null); load(); }}>Try again</Button></div>
      </Card>
    );
  }
  if (!g) return <div className="space-y-6" role="status" aria-busy="true" aria-label="Loading the growth plan"><Skeleton h="h-72" /><Skeleton h="h-14" /><div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5"><Skeleton h="h-52" /><Skeleton h="h-52" /><Skeleton h="h-52" /></div></div>;

  return (
    <div className="space-y-6 min-w-0">
      {error && <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-13 text-red-800 flex items-center gap-3" role="alert"><AlertTriangle size={16} className="shrink-0" /><span className="flex-1">{error.message}</span><Button size="sm" onClick={() => { setError(null); load(); }}>Retry</Button></div>}
      {refreshing && <div className="rounded-xl bg-indigo-50 border border-indigo-100 px-4 py-3 text-13 text-indigo-900 flex items-center gap-3" role="status"><Loader2 size={16} className="animate-spin shrink-0" /><span>Measuring your profile, website and live page checks. This takes up to a minute. <b className="tabular-nums">{secs}s</b></span></div>}
      <Hero g={g} onRefresh={refresh} refreshing={refreshing} secs={secs} onAll={() => setAll(true)} />

      <StartCard bid={b.id} onDone={load} />

      <div className="sticky top-2 z-20 bg-white rounded-xl border border-slate-200 shadow-sm">
        <div role="tablist" aria-label="Growth plan views" onKeyDown={onKey} className="flex flex-nowrap overflow-x-auto px-2" style={{ scrollbarWidth: 'none' }}>
          {TABS.map(([id, label, Icon]) => {
            const on = tab === id, n = counts[id];
            return (
              <button key={id} id={`gp-tab-${id}`} type="button" role="tab" aria-selected={on} aria-controls="gp-panel" tabIndex={on ? 0 : -1} onClick={() => pick(id)}
                className={`shrink-0 h-12 px-4 inline-flex items-center gap-2 text-14 whitespace-nowrap border-b-2 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${on ? 'border-indigo-600 text-indigo-700 font-semibold' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>
                <Icon size={15} className="opacity-70" aria-hidden="true" />{label}
                {n > 0 && <span className={`text-12 font-semibold tabular-nums rounded-full px-1.5 py-0.5 leading-none ${on ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-600'}`} title={id === 'reality' ? 'Blocked items' : id === 'issues' ? 'Open issues' : 'Tasks to do'}>{n}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div id="gp-panel" role="tabpanel" aria-labelledby={`gp-tab-${tab}`} key={tab} className="min-w-0">
        {['today', 'week', 'month'].includes(tab) && <PeriodView g={g} periodKey={tab} bid={b.id} onChanged={load} />}
        {tab === 'issues' && <IssuesView bid={b.id} />}
        {tab === 'content' && <ContentPlanView bid={b.id} />}
        {tab === 'reports' && <ReportsView bid={b.id} />}
        {tab === 'reality' && <Reality g={g} />}
        {tab === 'history' && <HistoryView g={g} />}
      </div>
      <AllProjects open={all} onClose={() => setAll(false)} onPick={(id) => { setAll(false); setBusiness(id); }} />
    </div>
  );
}

export default function GrowthPlanPage() {
  return (
    <SeoShell step="fix" title="Growth Plan" subtitle="Daily, weekly and monthly targets that raise your online presence, with every task checked against real data.">
      {(b) => <Growth key={b.id} b={b} />}
    </SeoShell>
  );
}
