import OutcomesPanel from './OutcomesPanel';
import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Sparkles, Check, X, Bot, ShieldCheck, Loader2, ArrowRight, CheckCircle2, TrendingUp,
  AlertTriangle, ShieldAlert, Zap, Filter, Search, RefreshCw, Cpu, Layers,
  Activity, Eye, Terminal, ChevronDown, ChevronRight, Lock, Unlock, Play,
  FileCode, CheckCheck, MessageSquare, Globe, ExternalLink, ArrowUpRight,
  BarChart3, Database, Sliders, Info, Shield, Award, Clock, Copy, CornerDownRight,
  Send, AlertCircle, Bookmark, Code, ThumbsUp, ThumbsDown
} from 'lucide-react';
import {
  SeoShell, Card, Tabs, Stat, StatusPill, Badge, Button, ErrorNote, Modal,
  Field, inputCls, areaCls, useToast, useAction, useBusinesses, LoadMore
} from './SeoUi';
import { api, useApi, usePaged, fmtDateTime } from './seoApi';

const AUTOPILOT_RULES = [
  {
    key: 'review_reply_high',
    label: 'Positive Review Replies (4–5★)',
    description: 'Replies to 4 and 5 star reviews can be posted without waiting for approval when this is switched on.',
    risk: 'Low Risk',
    riskTone: 'green',
    locked: false
  },
  {
    key: 'review_reply_low',
    label: 'Critical Review Replies (1–3★)',
    description: 'Drafts replies to unhappy customers. A person reads and approves each one before it is posted.',
    risk: 'Medium Risk (Human Escalation)',
    riskTone: 'amber',
    locked: false
  },
  {
    key: 'gbp_post',
    label: 'Google Business Profile Posts',
    description: 'Drafts posts for the profile. Turn the switch on to post them without waiting for approval.',
    risk: 'Low Risk',
    riskTone: 'green',
    locked: false
  },
  {
    key: 'profile_edit',
    label: 'Core Profile Edits (Name, Category, Address, Phone)',
    description: 'The name, address and phone are what Google verified. They are never changed automatically.',
    risk: 'High Risk (Policy Locked)',
    riskTone: 'red',
    locked: true
  },
  {
    key: 'website_fix',
    label: 'Website Code & Schema Fixes',
    description: 'Meta tags, structured data and image alt text fixes for the website.',
    risk: 'Medium Risk',
    riskTone: 'amber',
    locked: false
  },
  {
    key: 'blog_draft',
    label: 'Blog Article Drafts',
    description: 'Drafts long-form articles. A person reviews each one before it goes to the website.',
    risk: 'Low Risk',
    riskTone: 'green',
    locked: false
  },
  {
    key: 'outreach_email',
    label: 'Citation Outreach Emails',
    description: 'Prepares email drafts to local directories; human operator clicks send.',
    risk: 'Medium Risk',
    riskTone: 'amber',
    locked: false
  }
];

// Rejection Quick Reason Templates
const REJECTION_CHIPS = [
  'Too promotional',
  'Exceeds Google character limit',
  'Facts are not accurate',
  'Wrong tone for this business',
  'Not relevant to this business'
];

/**
 * Task Card: High-contrast Obsidian card with code diff viewer, impact metrics & learning loop
 */
const RISK_STYLE = { low: 'bg-emerald-50 text-emerald-700 border-emerald-200', medium: 'bg-amber-50 text-amber-700 border-amber-200', high: 'bg-rose-50 text-rose-700 border-rose-200' };

function DraftChange({ c }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg bg-white border border-slate-200 overflow-hidden">
      <div className="px-3 py-1.5 border-b border-slate-100 flex items-center justify-between text-11">
        <span className="font-semibold text-slate-700">{c.label}</span>
        <button type="button" onClick={() => navigator.clipboard?.writeText(c.after).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })} className="text-slate-500 hover:text-slate-900 flex items-center gap-1 cursor-pointer">
          {copied ? <CheckCheck size={12} className="text-emerald-700" /> : <Copy size={12} />}{copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {c.before && <div className="px-3 pt-2 text-12 text-slate-400 line-through decoration-slate-300 break-words">{c.before}</div>}
      <pre className="px-3 py-2 text-12 text-slate-900 font-sans whitespace-pre-wrap break-words max-h-48 overflow-y-auto">{c.after}</pre>
    </div>
  );
}

function TaskCard({ t, businessName, onDone }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [showDetail, setShowDetail] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, error, run] = useAction();
  const [task, setTask] = useState(t);
  const draft = task.detail?.draft;
  const redraft = () => run('d', async () => setTask(await api(`/tasks/${t.id}/redraft`, { method: 'POST' })));

  const decide = (approve) => run(approve ? 'a' : 'r', async () => {
    const out = await api(`/tasks/${t.id}/${approve ? 'approve' : 'reject'}`, {
      method: 'POST',
      body: approve ? undefined : { note: note || null }
    });
    onDone(out, approve);
  });

  const agentMeta = useMemo(() => {
    const key = (t.agent || '').toLowerCase();
    const name = { gbp: 'Google profile', review: 'Reviews', audit: 'Site audit', planner: 'Planner', outreach: 'Outreach', content: 'Content', rankings: 'Rankings' }[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Assistant');
    return { name, accentBg: 'bg-indigo-500/10 text-indigo-700', accentBorder: 'border-indigo-500/30', icon: Bot };
  }, [t.agent]);

  const AgentIcon = agentMeta.icon;

  // Primary snippet to display
  const proposalContent = t.detail?.fix || t.detail?.text || t.detail?.body || t.detail?.suggested_reply || '';

  const copyProposal = () => {
    if (proposalContent && navigator.clipboard) {
      navigator.clipboard.writeText(proposalContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const isHighImpact = (t.impact || '').toLowerCase() === 'high';

  return (
    <div className="bg-white hover:bg-slate-100 border border-slate-200 hover:border-indigo-500/30 rounded p-5 transition-all duration-200 shadow-lg relative group">
      {/* Top Header Row */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3.5 min-w-0 flex-1">
          {/* Agent Avatar Badge */}
          <div className={`w-10 h-10 rounded flex items-center justify-center shrink-0 border shadow-sm ${agentMeta.accentBg} ${agentMeta.accentBorder}`}>
            <AgentIcon size={18} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-14 font-bold text-slate-900 group-hover:text-indigo-800 transition-colors">
                {t.title}
              </span>
              <Badge tone="blue">{t.kind ? t.kind.replace(/_/g, ' ') : 'Task'}</Badge>
              {task.detail?.risk && <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-11 font-bold border ${RISK_STYLE[task.detail.risk]}`} title={task.detail.risk === 'low' ? 'Text or markup only: safe to approve in bulk' : task.detail.risk === 'high' ? 'Changes what the public sees or whether the site can be found' : 'Check before approving'}>{task.detail.risk} risk</span>}
              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-11 font-bold border ${isHighImpact
                ? 'bg-rose-500/15 text-rose-700 border-rose-500/30'
                : 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30'
                }`}>
                {isHighImpact ? <Zap size={11} className="text-amber-700 fill-amber-400" /> : <TrendingUp size={11} />}
                {t.impact || 'Medium'} Impact
              </span>
            </div>

            {/* Target Entity & Metadata */}
            <div className="text-12 text-slate-500 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium text-slate-700">{businessName}</span>
              <span className="text-slate-600">•</span>
              <span className="text-indigo-700  text-11">{agentMeta.name}</span>
              <span className="text-slate-600">•</span>
              <span className="text-slate-500">{fmtDateTime(t.created_at)}</span>
              {t.detail?.area && (
                <>
                  <span className="text-slate-600">•</span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-10 ">
                    Pillar: {t.detail.area}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Action Controls */}
        {!rejecting && (
          <div className="flex items-center gap-2 shrink-0 pt-0.5">
            <Button
              size="sm"
              variant="danger"
              icon={X}
              onClick={() => setRejecting(true)}
              className="text-xs"
            >
              Reject
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={Check}
              busy={busy === 'a'}
              onClick={() => decide(true)}
              className="text-xs bg-gradient-to-r from-emerald-600 to-teal-500 hover:opacity-95 shadow-emerald-500/20"
            >
              Approve & Apply
            </Button>
          </div>
        )}
      </div>

      {draft?.page && (
        <div className="mt-3.5 px-3 py-1.5 rounded bg-slate-50 border border-slate-200 flex items-center gap-2 text-11 text-slate-500 truncate">
          <Globe size={13} className="text-cyan-700 shrink-0" />
          <span>Page:</span>
          <a href={draft.page} target="_blank" rel="noreferrer" className="text-cyan-700  font-medium truncate hover:underline">{draft.page}</a>
        </div>
      )}

      {draft && (
        <div className="mt-3.5 rounded bg-slate-50 border border-slate-200 p-3.5 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-11 font-semibold text-slate-700 flex items-center gap-1.5">
              <Sparkles size={13} className="text-violet-600" />
              {draft.source === 'ai' ? 'Drafted by AI' : 'Drafted from the audit (rules)'}
            </span>
            <button type="button" onClick={redraft} disabled={busy === 'd'} className="text-11 font-semibold text-indigo-700 hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-50">
              <RefreshCw size={11} className={busy === 'd' ? 'animate-spin' : ''} /> Redraft
            </button>
          </div>
          <p className="text-12.5 text-slate-700">{draft.summary}</p>
          {draft.changes.map((c, i) => <DraftChange key={i} c={c} />)}
          {draft.ai_error && <p className="text-11 text-amber-700">AI draft unavailable ({draft.ai_error}); showing the rule-based draft.</p>}
        </div>
      )}

      {/* Code / Proposal Content Preview Box */}
      {proposalContent && !draft && (
        <div className="mt-3.5 rounded bg-slate-50 border border-slate-200 overflow-hidden">
          <div className="px-3.5 py-1.5 bg-white border-b border-slate-200 flex items-center justify-between text-11">
            <span className="font-semibold text-slate-700 flex items-center gap-1.5">
              <Code size={13} className="text-indigo-600" />
              AI Agent Proposal / Suggested Resolution
            </span>
            <button
              onClick={copyProposal}
              className="text-slate-500 hover:text-slate-900 transition-colors flex items-center gap-1 text-11 cursor-pointer"
            >
              {copied ? <CheckCheck size={12} className="text-emerald-700" /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="p-3 text-12 text-slate-800 font-sans leading-relaxed whitespace-pre-line max-h-48 overflow-y-auto custom-scrollbar bg-gradient-to-b from-transparent to-slate-900/5">
            {proposalContent}
          </div>
        </div>
      )}

      {/* Rejection Learning Drawer */}
      {rejecting && (
        <div className="mt-4 p-4 rounded bg-rose-50 border border-rose-500/30 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex items-center gap-2 text-rose-700 text-12 font-bold mb-1.5">
            <ShieldAlert size={14} />
            Reject Task & Train AI Model
          </div>
          <p className="text-11 text-slate-500 mb-2.5">
            Please specify why this task was rejected. GrowZen’s reinforcement learning engine stores this rationale in the <span className="text-indigo-700 font-semibold">Playbook Memory Bank</span> so this agent never proposes this pattern again.
          </p>

          {/* Quick Chip Suggestions */}
          <div className="flex flex-wrap gap-1.5 mb-2.5">
            {REJECTION_CHIPS.map(chip => (
              <button
                key={chip}
                type="button"
                onClick={() => setNote(prev => prev ? `${prev}. ${chip}` : chip)}
                className="text-11 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 border border-slate-200 transition-colors cursor-pointer"
              >
                + {chip}
              </button>
            ))}
          </div>

          <textarea
            rows={2}
            className={`${areaCls} border-rose-500/30 focus:border-rose-400`}
            placeholder="Feedback note for the AI agent (e.g. Too casual, mention NABH accreditation, tone down promotional tone)..."
            value={note}
            onChange={e => setNote(e.target.value)}
          />

          <div className="mt-3 flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setRejecting(false); setNote(''); }}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              busy={busy === 'r'}
              onClick={() => decide(false)}
              className="bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30 font-bold"
            >
              Confirm Rejection & Teach AI
            </Button>
          </div>
        </div>
      )}

      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}

/**
 * Main Autonomous AI Agent Page
 */
export default function AiAgentPage() {
  const [tab, setTab] = useState('queue');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAgentFilter, setSelectedAgentFilter] = useState('all');
  const [selectedImpactFilter, setSelectedImpactFilter] = useState('all');
  const [activityFilter, setActivityFilter] = useState('all');

  const { list } = useBusinesses();
  const tasks = usePaged('/tasks?status=pending', 40); // slabs of 40; the totals come from /tasks/counts
  const done = usePaged('/tasks?status=applied', 40);
  const counts = useApi('/tasks/counts');
  const activity = useApi(tab === 'log' ? '/activity?limit=200' : null);
  const playbook = useApi('/playbook');
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();

  const nameOf = (id) => list?.find(b => b.id === id)?.name || 'Another project';

  const finished = (out, approve) => {
    tasks.setData(ts => ts.filter(x => x.id !== out.id));
    done.reload(true);
    counts.reload(true);
    toast(
      approve
        ? (out.status === 'applied' ? `Applied: ${out.result?.note || 'Executed successfully'}` : `Approved: Task queued for deployment`)
        : 'Task rejected. AI agent learned and adapted memory bank.'
    );
  };

  const setRule = (key, value) => run(key, async () => {
    const rules = { ...(playbook.data?.approval_rules || {}), [key]: value };
    const out = await api('/playbook', { method: 'PUT', body: { approval_rules: rules } });
    playbook.setData(out);
    toast(`Autopilot rule updated: ${key} is now ${value ? 'requiring approval' : 'fully automated'}`);
  });

  // Reload everything from the server (new proposals appear after the scheduled audits, review syncs and weekly jobs run).
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([tasks.reload(true), counts.reload(true), done.reload(true), tab === 'log' ? activity.reload(true) : null, playbook.reload(true)]);
      toast('Updated.');
    } catch (e) { toast(e.message || 'Could not refresh'); }
    finally { setRefreshing(false); }
  };

  // Filter pending tasks
  const filteredTasks = useMemo(() => {
    if (!tasks.data) return [];
    return tasks.data.filter(t => {
      const matchSearch = searchQuery === '' ||
        (t.title && t.title.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (t.kind && t.kind.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchAgent = selectedAgentFilter === 'all' ||
        (t.agent && t.agent.toLowerCase() === selectedAgentFilter.toLowerCase());
      const matchImpact = selectedImpactFilter === 'all' ||
        (t.impact && t.impact.toLowerCase() === selectedImpactFilter.toLowerCase());
      return matchSearch && matchAgent && matchImpact;
    });
  }, [tasks.data, searchQuery, selectedAgentFilter, selectedImpactFilter]);

  // Approve every draft the copilot rated low risk (text and markup only).
  const lowRiskCount = (tasks.data || []).filter(t => t.detail?.risk === 'low').length;
  const handleApproveLowRisk = () => run('low_risk', async () => {
    const r = await api('/tasks/approve-low-risk', { method: 'POST' });
    tasks.reload(true); counts.reload(true);
    done.reload(true);
    toast(`${r.approved} low-risk change${r.approved === 1 ? '' : 's'} approved`);
  });

  // Bulk Approve All High Impact Tasks
  const handleBatchApproveHigh = () => {
    const highTasks = (tasks.data || []).filter(t => (t.impact || '').toLowerCase() === 'high');
    if (highTasks.length === 0) {
      toast('No high impact tasks pending approval');
      return;
    }
    run('batch_approve', async () => {
      let approvedCount = 0;
      for (const t of highTasks.slice(0, 5)) {
        try {
          await api(`/tasks/${t.id}/approve`, { method: 'POST' });
          approvedCount++;
        } catch (e) {
          // continue
        }
      }
      tasks.reload(true); counts.reload(true);
      done.reload(true);
      toast(`Successfully approved and applied ${approvedCount} high impact tasks!`);
    });
  };

  // Autopilot active count
  const autopilotRulesCount = useMemo(() => {
    if (!playbook.data?.approval_rules) return 0;
    return Object.values(playbook.data.approval_rules).filter(v => v === false).length;
  }, [playbook.data]);

  return (
    <SeoShell
      title="AI Assistant: approvals and automation"
      subtitle="What the assistant proposes, what you approved, which actions may run on their own, and everything that was done"
      hideSwitcher
      needsBusiness={false}
      actions={
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" icon={RefreshCw} busy={refreshing} onClick={refresh} className="text-xs">Refresh</Button>
        </div>
      }
    >
      {/* Top Telemetry KPI Ribbon */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-6">
        <div className="ai-glass-card rounded p-[18px] relative overflow-hidden group border-amber-500/20">
          <div className="flex items-center justify-between gap-2">
            <span className="text-11 font-bold   text-amber-700  truncate flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              Waiting for Approval
            </span>
            <div className="w-8 h-8 rounded bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-700 shrink-0">
              <Clock size={16} />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-slate-900 mt-2 font-display tracking-tight flex items-baseline gap-2">
            {counts.data ? (counts.data.pending ?? 0) : '—'}
            <span className="text-12 font-medium text-amber-700">pending</span>
          </div>
          <div className="text-11 text-slate-500 mt-1"><span>Waiting for your decision</span></div>
        </div>

        <div className="ai-glass-card rounded p-[18px] relative overflow-hidden group border-emerald-500/20">
          <div className="flex items-center justify-between gap-2">
            <span className="text-11 font-bold   text-emerald-700  truncate flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              Applied & Executed
            </span>
            <div className="w-8 h-8 rounded bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-700 shrink-0">
              <CheckCircle2 size={16} />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-slate-900 mt-2 font-display tracking-tight flex items-baseline gap-2">
            {counts.data ? (counts.data.applied ?? 0) : '—'}
            <span className="text-12 font-medium text-emerald-700">completed</span>
          </div>
          <div className="text-11 text-slate-500 mt-1"><span>Approved and carried out</span></div>
        </div>

        <div className="ai-glass-card rounded p-[18px] relative overflow-hidden group border-indigo-500/20">
          <div className="flex items-center justify-between gap-2">
            <span className="text-11 font-bold   text-indigo-700  truncate flex items-center gap-1.5">
              <Zap size={13} className="text-cyan-700" />
              Autopilot Triggers
            </span>
            <div className="w-8 h-8 rounded bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-700 shrink-0">
              <Cpu size={16} />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-slate-900 mt-2 font-display tracking-tight flex items-baseline gap-2">
            {autopilotRulesCount}
            <span className="text-12 font-medium text-slate-500">of {AUTOPILOT_RULES.length} on their own</span>
          </div>
          <div className="text-11 text-slate-500 mt-1"><span>Actions that may run without approval</span></div>
        </div>

        <div className="ai-glass-card rounded p-[18px] relative overflow-hidden group border-rose-500/20">
          <div className="flex items-center justify-between gap-2">
            <span className="text-11 font-bold text-rose-700 truncate flex items-center gap-1.5"><X size={13} />Rejected</span>
            <div className="w-8 h-8 rounded bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-700 shrink-0"><ThumbsDown size={16} /></div>
          </div>
          <div className="text-3xl font-extrabold text-slate-900 mt-2 font-display tracking-tight flex items-baseline gap-2">
            {counts.data ? (counts.data.rejected ?? 0) : '—'}
            <span className="text-12 font-medium text-rose-700">rejected</span>
          </div>
          <div className="text-11 text-slate-500 mt-1"><span>The assistant learns from your reasons</span></div>
        </div>
      </div>

      {/* Modern Obsidian Tabs */}
      <div className="mb-6">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'queue', label: 'Approval Queue', count: counts.data ? (counts.data.pending ?? 0) : undefined },
            { id: 'playbook', label: 'Automation rules' },
            { id: 'results', label: 'What worked' },
            { id: 'log', label: 'Activity log' }
          ]}
        />
      </div>

      {/* TAB 1: APPROVAL QUEUE */}
      {tab === 'queue' && (
        <div className="space-y-4">
          {/* Queue Filter & Search Bar */}
          <div className="ai-glass-card rounded p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
              {/* Search input */}
              <div className="relative flex-1 min-w-[200px] max-w-md">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Filter tasks by keyword, area or slug..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full h-9 pl-9 pr-3 text-12 bg-slate-50 border border-slate-200 focus:border-indigo-500 rounded text-slate-900 placeholder-slate-400 outline-none transition-all"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900">
                    <X size={13} />
                  </button>
                )}
              </div>

              {/* Agent Filter Chips */}
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                {[
                  { id: 'all', label: 'All Agents' },
                  { id: 'gbp', label: 'GBP' },
                  { id: 'review', label: 'Review' },
                  { id: 'audit', label: 'Audit / Code' },
                  { id: 'planner', label: 'Planner' },
                  { id: 'outreach', label: 'Outreach' }
                ].map(chip => (
                  <button
                    key={chip.id}
                    onClick={() => setSelectedAgentFilter(chip.id)}
                    className={`h-8 px-2.5 rounded-lg text-11 font-semibold transition-all whitespace-nowrap cursor-pointer ${selectedAgentFilter === chip.id
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
                      }`}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Bulk Action */}
            <div className="flex items-center gap-2 shrink-0">
              {lowRiskCount > 0 && (
                <Button size="sm" variant="primary" icon={CheckCheck} busy={busy === 'low_risk'} onClick={handleApproveLowRisk} className="text-xs">
                  Approve {lowRiskCount} low-risk
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                icon={CheckCheck}
                busy={busy === 'batch_approve'}
                onClick={handleBatchApproveHigh}
                className="text-xs border-amber-500/30 text-amber-700 hover:bg-amber-500/10"
              >
                Approve High Impact (Top 5)
              </Button>
            </div>
          </div>

          {/* Pending Tasks List */}
          {!tasks.data ? (
            <div className="ai-glass-card rounded p-16 flex flex-col items-center justify-center gap-3 text-slate-500">
              <Loader2 size={24} className="animate-spin text-cyan-700" />
              <span className="text-13 font-semibold text-slate-700">Synchronizing pending AI proposals…</span>
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="ai-glass-card rounded p-16 text-center">
              <div className="w-14 h-14 rounded bg-emerald-500/10 border border-emerald-500/25 text-emerald-700 flex items-center justify-center mx-auto mb-3 shadow-lg">
                <CheckCircle2 size={28} />
              </div>
              <h3 className="text-16 font-bold text-slate-900 font-display">Approval Queue Fully Cleared</h3>
              <p className="text-12 text-slate-500 max-w-md mx-auto mt-1 leading-relaxed">
                {searchQuery || selectedAgentFilter !== 'all'
                  ? 'No tasks match your current filter settings. Try clearing the search or switching agent filters.'
                  : 'All proposed actions have been reviewed and applied. New tasks will be drafted automatically after scheduled SERP audits, review syncs, and weekly post cycles.'}
              </p>
              <div className="mt-4 flex justify-center gap-2">
                {searchQuery && (
                  <Button size="sm" variant="secondary" onClick={() => { setSearchQuery(''); setSelectedAgentFilter('all'); }}>
                    Clear Filters
                  </Button>
                )}
                <Button size="sm" variant="secondary" icon={RefreshCw} busy={refreshing} onClick={refresh}>Refresh</Button>
                <Link to="/website-audit"><Button size="sm" variant="ai" icon={Sparkles}>Run a site audit</Button></Link>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTasks.map(t => (
                <TaskCard
                  key={t.id}
                  t={t}
                  businessName={nameOf(t.business_id)}
                  onDone={finished}
                />
              ))}
              <LoadMore list={tasks} label={`Show more (${Math.max(0, (counts.data?.pending ?? 0) - (tasks.data?.length ?? 0))} left)`} />
            </div>
          )}
        </div>
      )}

      {/* TAB 3: AUTOPILOT PLAYBOOK & SAFETY RULES */}
      {tab === 'playbook' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Rules Configuration (Left 2 cols) */}
          <div className="lg:col-span-2 space-y-4">
            <Card
              title="Autonomous Autopilot Rules"
              subtitle="Toggle which task kinds the AI applies immediately without waiting for human signoff"
            >
              {!playbook.data ? (
                <div className="py-12 flex justify-center text-slate-500">
                  <Loader2 size={20} className="animate-spin text-cyan-700" />
                </div>
              ) : (
                <div className="divide-y divide-slate-200">
                  {AUTOPILOT_RULES.map((rule) => {
                    const isAuto = playbook.data.approval_rules?.[rule.key] === false;
                    const isLocked = rule.locked;

                    return (
                      <div key={rule.key} className="py-4 first:pt-1 last:pb-1 flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-13 font-bold text-slate-900">
                              {rule.label}
                            </span>
                            <span className={`text-10  px-2 py-0.5 rounded-full border ${rule.riskTone === 'red'
                              ? 'bg-rose-500/15 text-rose-700 border-rose-500/30'
                              : rule.riskTone === 'amber'
                                ? 'bg-amber-500/15 text-amber-700 border-amber-500/30'
                                : 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30'
                              }`}>
                              {rule.risk}
                            </span>
                          </div>
                          <p className="text-11 text-slate-500 mt-1 leading-relaxed">
                            {rule.description}
                          </p>
                        </div>

                        {/* Interactive Switch */}
                        <div className="shrink-0 flex items-center gap-2 pt-1">
                          {isLocked ? (
                            <div className="flex items-center gap-1.5 px-3 py-1 rounded bg-white border border-slate-200 text-slate-500 text-11 font-medium cursor-not-allowed">
                              <Lock size={12} className="text-rose-600" />
                              Strictly Locked
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={busy === rule.key}
                              onClick={() => setRule(rule.key, isAuto ? true : false)}
                              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${isAuto ? 'bg-gradient-to-r from-emerald-500 to-teal-400 shadow-emerald-500/30' : 'bg-slate-100'
                                }`}
                            >
                              <span
                                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${isAuto ? 'translate-x-5' : 'translate-x-0'
                                  }`}
                              />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

          {/* What the rules above mean, and what the assistant learnt from the rejections (real data only) */}
          <div className="space-y-4">
            <Card title="How approval works" subtitle="Nothing reaches Google or your website without a rule or a person allowing it">
              <div className="space-y-3 text-12">
                <div className="p-3.5 rounded bg-slate-50 border border-slate-200">
                  <div className="flex items-center gap-2 text-rose-700 font-bold text-13 mb-1"><ShieldCheck size={16} className="text-rose-600" />Profile name, address and phone</div>
                  <p className="text-slate-500 text-11 leading-relaxed">Always need a person. The switch is locked off because Google verified these details.</p>
                </div>
                <div className="p-3.5 rounded bg-slate-50 border border-slate-200">
                  <div className="flex items-center gap-2 text-amber-700 font-bold text-13 mb-1"><AlertTriangle size={16} className="text-amber-700" />Everything else</div>
                  <p className="text-slate-500 text-11 leading-relaxed">Waits in the Approval Queue until you approve it, unless you switch its rule to run on its own. Every decision is written to the Activity log.</p>
                </div>
              </div>
            </Card>

            <Card title="Learnt from your rejections" subtitle="When you reject a task and give a reason, the reason is kept here">
              {playbook.data?.learnt?.length > 0 ? (
                <div className="space-y-2">
                  {playbook.data.learnt.slice(0, 10).map((l, i) => (
                    <div key={i} className="p-3 rounded bg-slate-50 border border-slate-200 text-12">
                      <div className="text-slate-700 font-medium">Task: <span className="text-slate-900">{l.task}</span></div>
                      <div className="text-purple-700 mt-0.5 flex items-start gap-1.5"><CornerDownRight size={13} className="shrink-0 mt-0.5 text-purple-600" /><span>“{l.note}”<span className="text-slate-500 text-10 ml-2">by {l.by || 'a team member'}</span></span></div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-12 text-slate-500 py-2">Nothing yet. Reject a proposed task with a short reason and it appears here.</p>}
            </Card>
          </div>
        </div>
      )}

      {tab === 'results' && <OutcomesPanel />}

      {/* TAB 4: LIVE AUDIT & EXECUTION STREAM */}
      {tab === 'log' && (
        <Card
          title="Activity log"
          subtitle="Every action the assistant, the scheduler and your team took, newest first"
        >
          {/* Stream Filter */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              {['all', 'agent', 'admin', 'scheduler'].map(act => (
                <button
                  key={act}
                  onClick={() => setActivityFilter(act)}
                  className={`h-[30px] px-3 rounded-lg text-11 font-semibold transition-all capitalize cursor-pointer ${activityFilter === act
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-slate-500 hover:text-slate-900 border border-slate-200'
                    }`}
                >
                  {act === 'all' ? 'All Events' : `${act} Events`}
                </button>
              ))}
            </div>
            <span className="text-11 text-slate-500 ">
              Displaying {activity.data?.length || 0} recent events
            </span>
          </div>

          {!activity.data ? (
            <div className="py-16 flex flex-col items-center justify-center gap-2 text-slate-500">
              <Loader2 size={20} className="animate-spin text-cyan-700" />
              <span className="text-12">Streaming activity events…</span>
            </div>
          ) : activity.data.length === 0 ? (
            <div className="py-16 text-center text-13 text-slate-500">
              No activity logs recorded yet. Events will appear here as agents execute tasks.
            </div>
          ) : (
            <div className="rounded bg-slate-50 border border-slate-200 divide-y divide-slate-200 overflow-hidden  text-11">
              {activity.data
                .filter(a => {
                  if (activityFilter === 'all') return true;
                  if (activityFilter === 'agent') return /agent|planner|gbp|review|audit|content/.test(a.actor.toLowerCase());
                  if (activityFilter === 'admin') return !/agent|pipeline|scheduler|reporter/.test(a.actor.toLowerCase());
                  if (activityFilter === 'scheduler') return /scheduler|pipeline/.test(a.actor.toLowerCase());
                  return true;
                })
                .map(a => {
                  const isAgent = /agent|pipeline|scheduler|reporter/.test(a.actor.toLowerCase());
                  return (
                    <div key={a.id} className="p-3 hover:bg-slate-100 transition-colors flex flex-wrap items-center gap-3">
                      {/* Timestamp */}
                      <span className="text-slate-500 w-36 shrink-0 text-10">
                        {fmtDateTime(a.created_at)}
                      </span>

                      {/* Actor Pill */}
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-10 font-bold border ${isAgent
                        ? 'bg-purple-500/15 text-purple-700 border-purple-500/30'
                        : 'bg-indigo-500/15 text-indigo-700 border-indigo-500/30'
                        }`}>
                        {isAgent ? <Bot size={11} /> : <Eye size={11} />}
                        {a.actor}
                      </span>

                      {/* Action */}
                      <span className="font-semibold text-slate-900">
                        {a.action.replace(/_/g, ' ')}
                      </span>

                      {/* Detail info */}
                      <span className="text-slate-500 truncate flex-1 min-w-[200px]">
                        {a.business_id ? `[${nameOf(a.business_id)}] ` : ''}
                        {a.detail?.title || a.detail?.email || JSON.stringify(a.detail || {})}
                      </span>

                      <span className="text-emerald-700 text-10 ml-auto shrink-0 flex items-center gap-1">
                        <Check size={11} /> logged
                      </span>
                    </div>
                  );
                })}
            </div>
          )}
        </Card>
      )}

      {toastNode}
    </SeoShell>
  );
}
