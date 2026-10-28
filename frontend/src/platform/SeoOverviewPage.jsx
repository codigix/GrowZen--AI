import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell } from 'recharts';
import {
  Sparkles, Bot, Cpu, ShieldCheck, CalendarClock, Briefcase, Activity, AlertTriangle, ClipboardCheck, Layers, Target,
  Search, CheckCircle2, XCircle, ArrowUp, ArrowDown, ArrowRight, Phone, Navigation, MousePointerClick,
  Settings2, LayoutGrid, List, Globe, Store, Star, Send, User, ChevronRight, FileText, HeartPulse, BarChart3
} from 'lucide-react';
import { SeoShell, Card, Badge, Button, ScoreRing, ChartTooltip, ErrorNote, SERIES, scoreLevel, scoreWord, useModulePath, useSeoBusiness, useAction, useToast, Drawer, Tabs } from './SeoUi';
import { api, useApi, usePoll, fmtDate, fmtDateTime } from './seoApi';
import { CopilotPriorities, CopilotAlerts, ReportsModal } from './CopilotPanel';

/**
 * Command Center: every project (client business) at once, with the AI side of the work in front.
 * AI briefing + recommended next steps, projects (cards or table), AI operations (agents, approvals,
 * schedule), performance and health. Data: GET /businesses/portfolio, /tasks, /activity, /me.
 * Real data only; the briefing text is built from these numbers, not generated.
 */

const AREA_LABELS = { gbp: 'Profile', rankings: 'Rankings', technical: 'Technical', onpage: 'On-page', backlinks: 'Backlinks', citations: 'Citations' };
const STATUS_META = {
  active: { label: 'Active', tone: 'green', color: '#10b981' },
  needs_approval: { label: 'Needs approval', tone: 'amber', color: '#f59e0b' },
  paused: { label: 'Paused', tone: 'gray', color: '#94a3b8' }
};
const EVERY = { daily: 'Daily', weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly' };
const LEVEL_DOT = { critical: 'bg-red-500', serious: 'bg-orange-500', warning: 'bg-amber-400', info: 'bg-slate-300' };
const IMPACT_ORDER = { High: 0, Medium: 1, Low: 2 };
const PLAN_ORDER = { Starter: 0, Growth: 1, Pro: 2, Agency: 3, 'No plan': 4 };
const AGENT_ICON = { audit: Globe, gbp: Store, review: Star, outreach: Send };
const TASK_KIND = {
  review_reply_high: '4–5★ review replies', review_reply_low: '1–3★ review replies', gbp_post: 'GBP posts', profile_edit: 'Profile edits',
  website_fix: 'Website fixes', blog_draft: 'Blog drafts', outreach_email: 'Outreach emails'
};
const VIEW_KEY = 'growzen.dashboard.view';

const scoreText = (s) => (s == null ? 'text-slate-400' : s >= 80 ? 'text-emerald-700' : s >= 60 ? 'text-amber-700' : 'text-red-600');
const scoreBar = (s) => (s >= 80 ? 'bg-emerald-500' : s >= 60 ? 'bg-amber-400' : s >= 40 ? 'bg-orange-500' : 'bg-red-500');
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const relDay = (iso) => {
  if (!iso) return '—';
  const days = Math.round((new Date(iso) - new Date()) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
};
const dayGroup = (iso) => {
  const d = new Date(iso); const t = new Date();
  const diff = Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000);
  return diff <= 0 ? 'Today' : diff === 1 ? 'Tomorrow' : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
};
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
const readView = () => { try { return localStorage.getItem(VIEW_KEY) || 'cards'; } catch (e) { return 'cards'; } };

function SectionHeader({ icon: Icon, title, subtitle, right }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
      <div className="flex items-center gap-2.5">
        <span className="w-8 h-8 rounded-lg bg-white ring-1 ring-inset ring-slate-200 shadow-sm flex items-center justify-center text-indigo-600"><Icon size={16} /></span>
        <div>
          <h2 className="text-[15px] font-semibold text-slate-900 leading-tight">{title}</h2>
          {subtitle && <p className="text-[12px] text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

/* ── AI briefing ─────────────────────────────────────────────────────────── */

function GlassStat({ icon: Icon, label, value, hint, ok }) {
  return (
    <div className="rounded-xl bg-white/10 ring-1 ring-inset ring-white/20 backdrop-blur-sm px-3 py-2.5 flex items-center gap-2.5 min-w-0" title={hint || undefined}>
      <span className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center shrink-0"><Icon size={15} /></span>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-indigo-100 truncate">{label}</div>
        <div className="text-[13px] font-semibold flex items-center gap-1 truncate">{value}{ok === false && <AlertTriangle size={12} className="text-amber-200 shrink-0" />}</div>
        {hint && <div className="text-[11px] text-indigo-100/85 truncate">{hint}</div>}
      </div>
    </div>
  );
}

function Briefing({ data, me }) {
  const { totals: t, ai } = data;
  const upcoming7 = (data.upcoming || []).filter(u => new Date(u.at) - new Date() < 7 * 86400000).length;

  const summary = [
    `${plural(t.projects, 'project')} under management (${t.by_status.active} active, ${t.by_status.needs_approval} waiting for approval${t.by_status.paused ? `, ${t.by_status.paused} paused` : ''}).`,
    t.needs_attention ? `${plural(t.needs_attention, 'project needs', 'projects need')} attention${t.critical_issues ? `, with ${plural(t.critical_issues, 'critical issue')} open` : ''}.` : 'No project needs urgent attention.',
    `The AI agents have ${plural(t.pending_tasks, 'change')} waiting for your approval${upcoming7 ? ` and ${plural(upcoming7, 'job')} scheduled this week` : ''}.`
  ].join(' ');
  const firstName = (me?.name || '').split(' ')[0];

  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 text-white shadow-lg shadow-indigo-500/20">
      <div className="absolute -top-24 -right-16 w-80 h-80 rounded-full bg-white/10 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 left-1/3 w-96 h-96 rounded-full bg-fuchsia-300/20 blur-3xl pointer-events-none" />
      <div className="absolute inset-0 opacity-[0.07] pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '22px 22px' }} />
      <div className="relative px-5 py-4 flex flex-col xl:flex-row xl:items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-lg font-bold tracking-tight">{greeting()}{firstName ? `, ${firstName}` : ''}</h2>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/15 ring-1 ring-inset ring-white/25 text-[10.5px] font-semibold uppercase tracking-wider">
              <Sparkles size={11} /> AI briefing · {new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
            </span>
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-indigo-50 line-clamp-2" title={summary}>{summary}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 xl:w-[620px] shrink-0">
          <GlassStat icon={Cpu} label="AI engine" value={!ai ? '—' : ai.engine.configured ? `${ai.engine.provider} connected` : 'Not configured'}
            hint={!ai ? 'Restart the backend' : ai.engine.configured ? 'Drafts, replies and reports are AI-written' : 'Add an AI key in Integrations to enable drafts'} ok={ai?.engine.configured} />
          <GlassStat icon={ShieldCheck} label="Autopilot" value={ai ? `${ai.autopilot.auto.length} of ${ai.autopilot.auto.length + ai.autopilot.manual.length} task types` : '—'}
            hint={ai ? `Runs without approval: ${ai.autopilot.auto.map(k => TASK_KIND[k] || k).join(', ') || 'none'}` : ''} />
          <GlassStat icon={Bot} label="Agent work · 30 days" value={ai ? `${ai.applied_30} applied · ${t.pending_tasks} waiting` : `${t.pending_tasks} waiting`}
            hint={`${plural(upcoming7, 'job')} scheduled in the next 7 days`} />
        </div>
      </div>
    </section>
  );
}

/* ── KPIs ────────────────────────────────────────────────────────────────── */

function Kpi({ icon: Icon, label, value, hint, tone }) {
  const tones = { indigo: 'from-indigo-500 to-violet-500', emerald: 'from-emerald-500 to-teal-500', red: 'from-rose-500 to-red-500', amber: 'from-amber-400 to-orange-500', sky: 'from-sky-500 to-indigo-500', slate: 'from-slate-400 to-slate-500' };
  return (
    <div className="ai-glass-card rounded-2xl p-4 flex items-center gap-3.5 min-w-0">
      <span className={`w-11 h-11 rounded-xl bg-gradient-to-br ${tones[tone] || tones.slate} text-white flex items-center justify-center shrink-0 shadow-sm`}><Icon size={19} /></span>
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-slate-500 truncate">{label}</div>
        <div className="text-[22px] leading-tight font-bold text-slate-900 tabular-nums">{value}</div>
        {hint && <div className="text-[11px] text-slate-500 truncate" title={hint}>{hint}</div>}
      </div>
    </div>
  );
}

/* ── Projects ────────────────────────────────────────────────────────────── */

function nextStepFor(p) {
  const top = p.attention.find(a => a.level === 'critical' || a.level === 'serious') || p.attention[0];
  if (top) return { text: top.text, level: top.level };
  if (p.next_job) return { text: `Next: ${p.next_job.label} ${relDay(p.next_job.at)}`, level: 'ok' };
  return { text: 'On track', level: 'ok' };
}

function ProjectCard({ p, onOpen }) {
  const st = STATUS_META[p.status] || { label: p.status, tone: 'gray' };
  const step = nextStepFor(p);
  return (
    <div role="button" tabIndex={0} onClick={() => onOpen(p.id)} onKeyDown={e => e.key === 'Enter' && onOpen(p.id)}
      className="group ai-glass-card rounded-2xl p-5 flex flex-col gap-4 cursor-pointer transition-transform hover:-translate-y-0.5 outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white text-[15px] font-bold flex items-center justify-center shrink-0">{p.name.slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-slate-900 truncate">{p.name}</div>
          <div className="text-[12px] text-slate-500 truncate">{[p.category, p.area || p.city].filter(Boolean).join(' · ') || '—'}{p.plan ? ` · ${p.plan}` : ''}</div>
        </div>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>

      <div className="flex items-center gap-4">
        {p.health != null
          ? <ScoreRing score={p.health} size={76} label="health" />
          : <div className="w-[76px] h-[76px] rounded-full border-[7px] border-slate-100 flex flex-col items-center justify-center text-slate-400 shrink-0"><span className="text-lg font-bold">—</span><span className="text-[9px] uppercase tracking-wider">no audit</span></div>}
        <div className="flex-1 grid grid-cols-2 gap-x-3 gap-y-1.5">
          {Object.entries(AREA_LABELS).map(([k, label]) => {
            const a = p.areas[k];
            return (
              <div key={k} title={!a ? `${label}: not audited` : a.status === 'failed' ? `${label}: audit failed` : `${label}: ${a.score}/100`}>
                <div className="flex justify-between text-[10px] text-slate-500"><span>{label}</span><span className={a?.status === 'failed' ? 'text-red-600' : scoreText(a?.score)}>{!a ? '—' : a.status === 'failed' ? 'failed' : a.score}</span></div>
                <div className="h-1 rounded-full bg-slate-100 overflow-hidden">{a && a.status === 'done' && <div className={`h-full ${scoreBar(a.score)}`} style={{ width: `${a.score}%` }} />}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-1 min-h-[22px]">
        {p.services.length ? p.services.slice(0, 4).map(s => (
          <span key={s.job} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium ring-1 ring-inset ${s.last_status === 'failed' ? 'bg-red-50 text-red-700 ring-red-200' : 'bg-slate-50 text-slate-700 ring-slate-200'}`} title={`${s.label} · ${EVERY[s.every] || s.every}`}>
            {s.last_status === 'failed' && <XCircle size={10} />}{s.label}
          </span>
        )) : <span className="text-[12px] text-slate-400">No services scheduled</span>}
        {p.services.length > 4 && <span className="text-[11px] text-slate-500 px-1">+{p.services.length - 4}</span>}
      </div>

      <div className={`rounded-xl px-3 py-2 flex items-start gap-2 text-[12px] ring-1 ring-inset ${step.level === 'ok' ? 'bg-emerald-50 ring-emerald-100 text-emerald-800' : step.level === 'critical' ? 'bg-red-50 ring-red-100 text-red-800' : 'bg-violet-50 ring-violet-100 text-violet-900'}`}>
        <Sparkles size={13} className="mt-0.5 shrink-0" />
        <span><span className="font-semibold">AI next step: </span>{step.text}</span>
      </div>

      <div className="mt-auto pt-3 border-t border-slate-100 flex items-center justify-between text-[12px] text-slate-500">
        <span className="flex gap-3">
          <span title="Changes waiting for approval"><b className="text-slate-900 tabular-nums">{p.pending_tasks}</b> to approve</span>
          <span title="Leads in the last 30 days"><b className="text-slate-900 tabular-nums">{p.leads_30}</b> leads</span>
          <span title="Reviews without a reply"><b className="text-slate-900 tabular-nums">{p.unreplied_reviews}</b> unreplied</span>
        </span>
        <span className="inline-flex items-center gap-1 font-semibold text-indigo-700 opacity-70 group-hover:opacity-100">Open <ArrowRight size={13} /></span>
      </div>
    </div>
  );
}

function ProjectsTable({ projects, onOpen }) {
  return (
    <div className="ai-glass-card rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-5 py-3 text-left font-semibold">Project</th>
              <th className="px-3 py-3 text-left font-semibold">Status</th>
              <th className="px-3 py-3 text-left font-semibold">Health</th>
              <th className="px-3 py-3 text-left font-semibold">SEO services</th>
              <th className="px-3 py-3 text-left font-semibold">Google</th>
              <th className="px-3 py-3 text-right font-semibold">Work</th>
              <th className="px-5 py-3 text-left font-semibold">AI next step</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {projects.map(p => {
              const st = STATUS_META[p.status] || { label: p.status, tone: 'gray' };
              const step = nextStepFor(p);
              return (
                <tr key={p.id} onClick={() => onOpen(p.id)} className="cursor-pointer align-top hover:bg-slate-50">
                  <td className="px-5 py-3 min-w-[200px]">
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-white text-[12px] font-bold flex items-center justify-center shrink-0">{p.name.slice(0, 1).toUpperCase()}</span>
                      <div className="min-w-0"><div className="font-semibold text-slate-900 truncate">{p.name}</div><div className="text-[12px] text-slate-500 truncate">{[p.category, p.area || p.city].filter(Boolean).join(' · ') || '—'}</div></div>
                    </div>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap"><Badge tone={st.tone}>{st.label}</Badge><div className="mt-1 text-[12px] text-slate-500">{p.plan ? `${p.plan} plan` : 'No plan'}</div></td>
                  <td className="px-3 py-3"><span className={`text-lg font-bold tabular-nums ${scoreText(p.health)}`}>{p.health ?? '—'}</span><div className="text-[11px] text-slate-400">{p.last_audit_at ? `Audited ${relDay(p.last_audit_at)}` : 'Not audited'}</div></td>
                  <td className="px-3 py-3 max-w-[280px]">
                    <div className="flex flex-wrap gap-1">{p.services.length ? p.services.map(s => <span key={s.job} className={`px-1.5 py-0.5 rounded-md text-[11px] font-medium ring-1 ring-inset ${s.last_status === 'failed' ? 'bg-red-50 text-red-700 ring-red-200' : 'bg-slate-50 text-slate-700 ring-slate-200'}`}>{s.label}</span>) : <span className="text-[12px] text-slate-400">Not scheduled</span>}</div>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">{p.gbp_linked ? <span className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-700"><CheckCircle2 size={13} /> Linked</span> : <span className="inline-flex items-center gap-1 text-[12px] text-slate-500"><XCircle size={13} className="text-slate-400" /> Not linked</span>}</td>
                  <td className="px-3 py-3 text-right whitespace-nowrap text-[12px] text-slate-600 leading-5"><div><b className="text-slate-900">{p.pending_tasks}</b> to approve</div><div><b className="text-slate-900">{p.leads_30}</b> leads · 30d</div></td>
                  <td className="px-5 py-3 min-w-[200px]"><div className="flex items-start gap-1.5 text-[12px] text-slate-800"><span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${LEVEL_DOT[step.level] || 'bg-emerald-500'}`} />{step.text}</div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Projects({ projects, onOpen }) {
  const path = useModulePath();
  const [view, setView] = useState(readView);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view); } catch (e) { /* private window */ } }, [view]);
  const needsAttention = (p) => p.attention.some(a => a.level === 'critical' || a.level === 'serious');
  const filters = [['all', 'All', projects.length], ['active', 'Active', projects.filter(p => p.status === 'active').length],
    ['needs_approval', 'Needs approval', projects.filter(p => p.status === 'needs_approval').length], ['paused', 'Paused', projects.filter(p => p.status === 'paused').length],
    ['attention', 'Needs attention', projects.filter(needsAttention).length]];
  const shown = projects.filter(p => (filter === 'all' || (filter === 'attention' ? needsAttention(p) : p.status === filter))
    && (!query || `${p.name} ${p.category || ''} ${p.city || ''} ${p.area || ''}`.toLowerCase().includes(query.toLowerCase())));
  const seg = (on) => `h-8 px-3 rounded-lg text-[12px] font-semibold whitespace-nowrap cursor-pointer transition-colors ${on ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800'}`;

  return (
    <section>
      <SectionHeader icon={Briefcase} title="Projects" subtitle="Every client, its health, the services we run and the AI's next step"
        right={<Link to={path('onboarding')} className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-xl text-[13px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm">+ New project</Link>} />
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex gap-0.5 p-0.5 rounded-xl bg-slate-100 overflow-x-auto max-w-full">
          {filters.map(([id, label, n]) => <button key={id} className={seg(filter === id)} onClick={() => setFilter(id)}>{label} <span className="opacity-60 tabular-nums">{n}</span></button>)}
        </div>
        <label className="relative flex-1 min-w-[180px] max-w-xs ml-auto">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search projects" className="w-full h-9 pl-8 pr-3 text-[13px] rounded-xl bg-white ring-1 ring-inset ring-slate-200 focus:ring-indigo-400 outline-none text-slate-900 placeholder-slate-400" />
        </label>
        <div className="flex gap-0.5 p-0.5 rounded-xl bg-slate-100">
          <button className={seg(view === 'cards')} onClick={() => setView('cards')} aria-label="Card view" title="Cards"><LayoutGrid size={14} /></button>
          <button className={seg(view === 'table')} onClick={() => setView('table')} aria-label="Table view" title="Table"><List size={14} /></button>
        </div>
      </div>
      {!shown.length ? <div className="ai-glass-card rounded-2xl py-12 text-center text-[13px] text-slate-500">No projects match.</div>
        : view === 'cards' ? <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{shown.map(p => <ProjectCard key={p.id} p={p} onOpen={onOpen} />)}</div>
          : <ProjectsTable projects={shown} onOpen={onOpen} />}
    </section>
  );
}

/* ── AI operations ───────────────────────────────────────────────────────── */

function Agents({ ai }) {
  return (
    <Card className="h-full" title="AI agents" subtitle="Proposed and applied in the last 30 days">
      <ul className="space-y-3.5">
        {Object.entries(ai.agents).map(([key, a]) => {
          const Icon = AGENT_ICON[key] || Bot;
          const total = Math.max(1, a.applied_30 + a.pending + a.rejected_30);
          return (
            <li key={key} className="flex items-start gap-3">
              <span className="w-9 h-9 rounded-xl bg-violet-50 ring-1 ring-inset ring-violet-100 text-violet-600 flex items-center justify-center shrink-0"><Icon size={16} /></span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2"><span className="text-[13px] font-semibold text-slate-900">{a.label}</span><span className="text-[11px] text-slate-500 tabular-nums">{a.proposed_30} proposed</span></div>
                <div className="text-[11px] text-slate-500 truncate">{a.does}</div>
                <div className="mt-1.5 flex h-1.5 rounded-full overflow-hidden bg-slate-100">
                  <div className="bg-emerald-500" style={{ width: `${(a.applied_30 / total) * 100}%` }} />
                  <div className="bg-amber-400" style={{ width: `${(a.pending / total) * 100}%` }} />
                  <div className="bg-slate-300" style={{ width: `${(a.rejected_30 / total) * 100}%` }} />
                </div>
                <div className="mt-1 flex gap-3 text-[11px] text-slate-500"><span><b className="text-emerald-700">{a.applied_30}</b> applied</span><span><b className="text-amber-700">{a.pending}</b> waiting</span><span><b className="text-slate-700">{a.rejected_30}</b> rejected</span></div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

const RISK_TONE = { low: 'green', medium: 'amber', high: 'red' };

function ApprovalQueue({ projects }) {
  const tasks = useApi('/tasks?status=pending');
  const path = useModulePath();
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const names = Object.fromEntries(projects.map(p => [p.id, p.name]));
  const list = [...(tasks.data || [])].sort((x, y) => (IMPACT_ORDER[x.impact] ?? 3) - (IMPACT_ORDER[y.impact] ?? 3));
  const lowRisk = list.filter(t => t.detail?.risk === 'low').length;
  const approveLow = () => run('low', async () => { const r = await api('/tasks/approve-low-risk', { method: 'POST' }); tasks.reload(true); toast(`${plural(r.approved, 'low-risk change')} approved`); });
  return (
    <Card className="h-full" title="To approve" subtitle={tasks.data ? `${plural(list.length, 'change')} drafted by the agents` : 'Loading…'}
      action={<div className="flex items-center gap-2">{lowRisk > 0 && <Button size="sm" variant="primary" busy={busy === 'low'} onClick={approveLow}>Approve {lowRisk} low-risk</Button>}<Link to={path('automation')} className="text-[12px] font-semibold text-indigo-700 hover:underline whitespace-nowrap">Review all</Link></div>}>
      <ErrorNote>{error}</ErrorNote>
      {tasks.error ? <ErrorNote>{tasks.error.message}</ErrorNote> : list.length ? (
        <ul className="space-y-2">
          {list.slice(0, 5).map(t => (
            <li key={t.id} className="rounded-xl ring-1 ring-inset ring-slate-200 px-3 py-2.5 flex items-start gap-2.5">
              <Bot size={15} className="text-violet-500 mt-0.5 shrink-0" />
              <span className="min-w-0 flex-1"><span className="block text-[13px] text-slate-800 line-clamp-2">{t.title}</span><span className="block text-[11px] text-slate-500 truncate">{names[t.business_id] || '—'} · {t.agent} agent</span>
                {t.detail?.draft?.changes?.[0]?.after && <span className="mt-1 block text-[11.5px] text-emerald-800 bg-emerald-50 rounded-md px-2 py-1 line-clamp-2" title={t.detail.draft.changes[0].after}>{t.detail.draft.changes[0].label}: {t.detail.draft.changes[0].after}</span>}</span>
              <span className="flex flex-col items-end gap-1"><Badge tone={t.impact === 'High' ? 'red' : t.impact === 'Medium' ? 'amber' : 'gray'}>{t.impact}</Badge>{t.detail?.risk && <Badge tone={RISK_TONE[t.detail.risk]}>{t.detail.risk} risk</Badge>}</span>
            </li>
          ))}
          {list.length > 5 && <li className="text-[12px] text-slate-500 text-center pt-1">+{list.length - 5} more in the queue</li>}
        </ul>
      ) : tasks.data && <div className="py-6 text-center text-[13px] text-slate-500"><CheckCircle2 size={22} className="mx-auto text-emerald-500 mb-1" />Nothing waiting. The agents are up to date.</div>}
      {toastNode}
    </Card>
  );
}

function AgentSchedule({ upcoming }) {
  const path = useModulePath();
  const groups = upcoming.slice(0, 10).reduce((g, u) => { const k = dayGroup(u.at); (g[k] = g[k] || []).push(u); return g; }, {});
  return (
    <Card className="h-full" title="Agent schedule" subtitle="Upcoming automatic work"
      action={<Link to={path('automation-pipeline')} className="inline-flex items-center gap-1 text-[12px] font-semibold text-indigo-700 hover:underline whitespace-nowrap"><Settings2 size={12} /> Manage</Link>}>
      {upcoming.length ? (
        <div className="space-y-4">
          {Object.entries(groups).map(([day, items]) => (
            <div key={day}>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">{day}</div>
              <ol className="relative border-l border-slate-200 ml-1.5 space-y-2.5">
                {items.map((u, i) => (
                  <li key={i} className="pl-4 relative">
                    <span className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-indigo-500 ring-2 ring-white" />
                    <div className="text-[13px] font-medium text-slate-800">{u.label}</div>
                    <div className="text-[11px] text-slate-500">{u.project} · {EVERY[u.every] || u.every}</div>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      ) : <div className="py-6 text-center text-[13px] text-slate-500"><CalendarClock size={22} className="mx-auto text-slate-300 mb-1" />Nothing scheduled. Set up services in Automation Pipeline.</div>}
    </Card>
  );
}

/* ── Performance & health ────────────────────────────────────────────────── */

function Delta({ now, before }) {
  if (!before) return <span className="text-[11px] text-slate-400">no earlier data</span>;
  const pct = Math.round(((now - before) / before) * 100);
  if (!pct) return <span className="text-[11px] text-slate-500">same as before</span>;
  return <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${pct > 0 ? 'text-emerald-700' : 'text-red-600'}`}>{pct > 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}{Math.abs(pct)}% vs previous 30 days</span>;
}

function CustomerActions({ insights }) {
  const now = insights.last_30;
  const before = insights.previous_30;
  const daily = insights.daily.map(x => ({ day: fmtDate(x.day).slice(0, 6), calls: x.calls, directions: x.directions, clicks: x.website_clicks }));
  return (
    <Card className="xl:col-span-2 h-full" title="Customer actions from Google" subtitle="All projects · last 30 days">
      <div className="grid grid-cols-3 gap-3">
        {[[Phone, 'Calls', now.calls, before.calls, SERIES[0]], [Navigation, 'Directions', now.directions, before.directions, SERIES[1]], [MousePointerClick, 'Website clicks', now.website_clicks, before.website_clicks, SERIES[2]]].map(([I, label, n, p, c]) => (
          <div key={label} className="rounded-xl bg-slate-50 ring-1 ring-inset ring-slate-200 p-3">
            <div className="flex items-center gap-1.5 text-[12px] text-slate-500"><span className="w-2 h-2 rounded-full" style={{ background: c }} /><I size={13} /> {label}</div>
            <div className="text-xl font-bold text-slate-900 tabular-nums">{n.toLocaleString()}</div>
            <Delta now={n} before={p} />
          </div>
        ))}
      </div>
      {daily.length > 1 ? (
        <div className="h-52 mt-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={daily} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} minTickGap={24} />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="calls" name="Calls" stroke={SERIES[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="directions" name="Directions" stroke={SERIES[1]} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="clicks" name="Website clicks" stroke={SERIES[2]} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : <div className="mt-4 rounded-xl border border-dashed border-slate-200 py-10 text-center text-[13px] text-slate-500">Daily calls, directions and clicks appear once projects have their Google profile linked and synced.</div>}
    </Card>
  );
}

function Portfolio({ projects, totals }) {
  const data = Object.entries(totals.by_status).filter(([, n]) => n).map(([s, n]) => ({ name: STATUS_META[s]?.label || s, value: n, color: STATUS_META[s]?.color || '#94a3b8' }));
  const plans = Object.entries(projects.reduce((m, p) => ({ ...m, [p.plan || 'No plan']: (m[p.plan || 'No plan'] || 0) + 1 }), {})).sort(([a], [b]) => (PLAN_ORDER[a] ?? 9) - (PLAN_ORDER[b] ?? 9));
  return (
    <Card className="h-full" title="Portfolio" subtitle={plural(totals.projects, 'project')}>
      <div className="flex items-center gap-4">
        <div className="relative w-28 h-28 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart><Pie data={data} dataKey="value" nameKey="name" innerRadius={38} outerRadius={54} paddingAngle={data.length > 1 ? 3 : 0} stroke="none" isAnimationActive={false}>{data.map(d => <Cell key={d.name} fill={d.color} />)}</Pie></PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"><span className="text-xl font-bold text-slate-900">{totals.projects}</span><span className="text-[9px] uppercase tracking-wider text-slate-500">projects</span></div>
        </div>
        <ul className="flex-1 space-y-1.5 text-[13px]">
          {Object.entries(STATUS_META).map(([s, m]) => <li key={s} className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-slate-700"><span className="w-2.5 h-2.5 rounded-full" style={{ background: m.color }} />{m.label}</span><b className="tabular-nums text-slate-900">{totals.by_status[s] || 0}</b></li>)}
        </ul>
      </div>
      <div className="mt-4 pt-3 border-t border-slate-100">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Plans</div>
        <div className="flex flex-wrap gap-1.5">{plans.map(([plan, n]) => <span key={plan} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-violet-50 ring-1 ring-inset ring-violet-200 text-[12px] font-medium text-violet-800">{plan}<span className="text-violet-500 tabular-nums">{n}</span></span>)}</div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
        <div className="rounded-lg bg-slate-50 px-2.5 py-2"><div className="text-slate-500">Google linked</div><div className="font-semibold text-slate-900">{totals.gbp_linked} of {totals.projects}</div></div>
        <div className="rounded-lg bg-slate-50 px-2.5 py-2"><div className="text-slate-500">With a website</div><div className="font-semibold text-slate-900">{projects.filter(p => p.website).length} of {totals.projects}</div></div>
      </div>
    </Card>
  );
}

function AreaHealth({ areas, total }) {
  const labels = { gbp: 'Google profile', rankings: 'Rankings', technical: 'Technical', onpage: 'On-page', backlinks: 'Backlinks', citations: 'Citations' };
  return (
    <Card className="h-full" title="SEO health by area" subtitle="Average across projects">
      <ul className="space-y-3">
        {Object.entries(labels).map(([k, label]) => {
          const a = areas[k] || {};
          return (
            <li key={k}>
              <div className="flex items-center justify-between gap-2 text-[13px]">
                <span className="font-medium text-slate-800">{label}</span>
                <span className="text-[12px] text-slate-500"><b className={`tabular-nums ${scoreText(a.avg)}`}>{a.avg ?? '—'}</b><span className="ml-2">{a.audited}/{total} audited{a.failed ? <span className="text-red-600"> · {a.failed} failed</span> : ''}</span></span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-slate-100 overflow-hidden">{a.avg != null && <div className={`h-full rounded-full ${scoreBar(a.avg)}`} style={{ width: `${a.avg}%` }} />}</div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Coverage({ coverage, total }) {
  return (
    <Card className="h-full" title="Service coverage" subtitle="Projects each SEO service runs for">
      <ul className="space-y-3">
        {Object.entries(coverage).map(([job, c]) => (
          <li key={job}>
            <div className="flex items-center justify-between text-[13px]"><span className="font-medium text-slate-800">{c.label}</span><span className="text-[12px] text-slate-500"><b className="text-slate-900 tabular-nums">{c.projects}</b> of {total}</span></div>
            <div className="mt-1 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" style={{ width: `${total ? (c.projects / total) * 100 : 0}%` }} /></div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ActivityLog({ projects }) {
  const act = useApi('/activity?limit=8');
  const names = Object.fromEntries(projects.map(p => [p.id, p.name]));
  const isAgent = (actor) => /agent|scheduler|autopilot|\bai\b/i.test(actor || '');
  return (
    <Card className="h-full" title="Activity" subtitle="AI agents and the team">
      {act.error ? <ErrorNote>{act.error.message}</ErrorNote> : (act.data || []).length ? (
        <ol className="space-y-3">
          {act.data.map(a => {
            const agent = isAgent(a.actor);
            return (
              <li key={a.id} className="flex items-start gap-2.5">
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${agent ? 'bg-violet-50 text-violet-600 ring-1 ring-inset ring-violet-100' : 'bg-slate-100 text-slate-500'}`}>{agent ? <Bot size={14} /> : <User size={14} />}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-slate-800">{String(a.action || '').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())}</div>
                  <div className="text-[11px] text-slate-500 truncate">{[names[a.business_id], a.actor, fmtDateTime(a.created_at)].filter(Boolean).join(' · ')}</div>
                </div>
              </li>
            );
          })}
        </ol>
      ) : act.data && <div className="py-6 text-center text-[13px] text-slate-500">No activity yet.</div>}
    </Card>
  );
}

/** Equal-height cards in a row; the column count follows how many cards are present. */
const PANELS = {
  performance: { label: 'Performance', icon: BarChart3, hint: 'Calls, directions and website clicks; projects by status' },
  health: { label: 'Project health', icon: HeartPulse, hint: 'Scores by area and which services run where' },
  agents: { label: 'AI agents & schedule', icon: Bot, hint: "What each agent did and what's scheduled next" },
  activity: { label: 'Activity log', icon: Activity, hint: 'Everything the team and the agents did' }
};

function MoreCard({ onPanel, onReports }) {
  const Item = ({ icon: Icon, label, hint, onClick }) => (
    <button type="button" onClick={onClick} className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-slate-50 ring-1 ring-inset ring-transparent hover:ring-slate-200 cursor-pointer">
      <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0"><Icon size={15} /></span>
      <span className="flex-1 min-w-0"><span className="block text-[13px] font-semibold text-slate-900">{label}</span><span className="block text-[11.5px] text-slate-500 truncate">{hint}</span></span>
      <ChevronRight size={15} className="text-slate-400 shrink-0" />
    </button>
  );
  return (
    <Card title="More" subtitle="Details open in a side panel">
      <div className="-mx-2 space-y-0.5">
        {Object.entries(PANELS).map(([id, p]) => <Item key={id} icon={p.icon} label={p.label} hint={p.hint} onClick={() => onPanel(id)} />)}
        <Item icon={FileText} label="Monthly reports" hint="Draft every client's report in one go" onClick={onReports} />
      </div>
    </Card>
  );
}


/* ── Page ────────────────────────────────────────────────────────────────── */

function Dashboard() {
  const pf = useApi('/businesses/portfolio');
  const me = useApi('/me');
  const [, choose] = useSeoBusiness();
  const navigate = useNavigate();
  const path = useModulePath();
  const [panel, setPanel] = useState(null); // side panel: performance | health | agents | activity
  const [reports, setReports] = useState(false);
  const projects = pf.data?.projects || [];
  const t = pf.data?.totals;
  usePoll(() => pf.reload(true), projects.some(p => p.audit_running), 5000);

  // Open a project: make it the selected business everywhere, then go to the right screen.
  const openProject = (id, screen = 'gmb-profile') => { choose(id); navigate(path(screen)); };

  if (pf.error) return <Card><ErrorNote>{pf.error.message}</ErrorNote></Card>;
  if (!t) {
    return (
      <div className="py-24 flex flex-col items-center gap-3 text-[13px] text-slate-500">
        <span className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white flex items-center justify-center shadow-lg"><Sparkles size={20} className="animate-pulse" /></span>
        Preparing your briefing…
      </div>
    );
  }
  const { insights, areas, coverage, upcoming, ai } = pf.data;
  const outdated = !insights || !areas || !coverage || !upcoming || !ai;

  return (
    <div className="space-y-6">
      {outdated && (
        <div className="rounded-xl bg-amber-50 ring-1 ring-inset ring-amber-200 px-4 py-3 text-[13px] text-amber-900 flex items-start gap-2">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>Some sections are hidden because the backend is running an older version. Restart it (<code className="font-mono text-[12px]">python -m uvicorn app.main:app --port 8000</code> in <code className="font-mono text-[12px]">backend</code>) and reload.</span>
        </div>
      )}

      <Briefing data={pf.data} me={me.data} />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon={Briefcase} tone="indigo" label="Projects" value={t.projects} hint={`${t.by_status.active} active · ${t.by_status.needs_approval} pending`} />
        <Kpi icon={Activity} tone={t.avg_health == null ? 'slate' : scoreLevel(t.avg_health) === 'good' ? 'emerald' : 'amber'} label="Average health" value={t.avg_health ?? '—'} hint={t.avg_health == null ? 'No audits yet' : scoreWord(t.avg_health)} />
        <Kpi icon={AlertTriangle} tone={t.needs_attention ? 'red' : 'emerald'} label="Need attention" value={t.needs_attention} hint={plural(t.critical_issues, 'critical issue')} />
        <Kpi icon={ClipboardCheck} tone={t.pending_tasks ? 'amber' : 'slate'} label="To approve" value={t.pending_tasks} hint="Agent proposals" />
        <Kpi icon={Layers} tone="sky" label="Active services" value={t.active_services} hint={`${t.gbp_linked}/${t.projects} profiles linked`} />
        <Kpi icon={Target} tone="emerald" label="Leads · 30 days" value={t.leads_30} hint="All projects" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
        <div className="xl:col-span-2 space-y-5 min-w-0">
          <CopilotPriorities onOpenProject={openProject} />
          <Projects projects={projects} onOpen={(id) => openProject(id)} />
        </div>
        <aside className="space-y-5 min-w-0">
          <CopilotAlerts onOpenProject={openProject} />
          <ApprovalQueue projects={projects} />
          <MoreCard onPanel={setPanel} onReports={() => setReports(true)} />
        </aside>
      </div>

      <Drawer open={Boolean(panel)} onClose={() => setPanel(null)} title={PANELS[panel]?.label} subtitle={PANELS[panel]?.hint}>
        <Tabs value={panel} onChange={setPanel} tabs={Object.entries(PANELS).map(([id, p]) => ({ id, label: p.label }))} />
        <div className="mt-4 space-y-4">
          {panel === 'performance' && <>{insights && <CustomerActions insights={insights} />}<Portfolio projects={projects} totals={t} /></>}
          {panel === 'health' && <>{areas && <AreaHealth areas={areas} total={t.projects} />}{coverage && <Coverage coverage={coverage} total={t.projects} />}</>}
          {panel === 'agents' && <>{ai && <Agents ai={ai} />}{upcoming && <AgentSchedule upcoming={upcoming} />}</>}
          {panel === 'activity' && <ActivityLog projects={projects} />}
        </div>
      </Drawer>
      <ReportsModal open={reports} onClose={() => setReports(false)} />
    </div>
  );
}

export default function SeoOverviewPage() {
  return (
    <SeoShell title="Command Center" subtitle="Your AI-run SEO portfolio at a glance" hideSwitcher>
      {() => <Dashboard />}
    </SeoShell>
  );
}
