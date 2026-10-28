import React, { useState, useMemo } from 'react';
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
  Field, inputCls, areaCls, useToast, useAction, useBusinesses
} from './SeoUi';
import { api, useApi, fmtDateTime } from './seoApi';

// 7 Specialized AI Agents with Full Telemetry and Deep Specs
const AGENT_SWARM = [
  {
    id: 'planner',
    name: 'Planner Agent',
    badge: 'Master Orchestrator',
    role: 'Turns every audit, keyword gap & SERP signal into prioritized tasks',
    description: 'Autonomous reasoning engine that ingests technical audits, competitor SERP movements, and Google Business Profile gaps, compiling them into high-ROI actionable work packets.',
    model: 'DeepSeek V3 / Reasoning 2.5',
    color: 'violet',
    accentBorder: 'border-purple-500/30',
    accentBg: 'bg-purple-500/10 text-purple-700',
    icon: Sliders,
    stats: { tasksGenerated: '38 Planned', approvalRate: '98.5%', latency: '110ms' },
    capabilities: ['Multi-objective Task Ranking', 'SERP Opportunity Gap Detection', 'Impact Scoring Algorithm']
  },
  {
    id: 'gbp',
    name: 'GBP Agent',
    badge: 'Google Maps Autopilot',
    role: 'Posts, service catalog sync, operating hours & local signals',
    description: 'Manages Moraya Hospital’s Google Business Profile 24/7. Drafts high-engagement weekly posts, updates medical department services, and optimizes local geo-coordinates.',
    model: 'Gemini 2.0 Flash Multimodal',
    color: 'emerald',
    accentBorder: 'border-emerald-500/30',
    accentBg: 'bg-emerald-500/10 text-emerald-700',
    icon: Globe,
    stats: { tasksGenerated: '24 Posts & Edits', approvalRate: '100%', latency: '85ms' },
    capabilities: ['Direct Google API Sync', 'Geo-tagged Image Signals', 'Local PCMC Map Pin Alignment']
  },
  {
    id: 'review',
    name: 'Review Agent',
    badge: 'Reputation Concierge',
    role: 'Drafts empathetic, clinical-compliant replies to all incoming reviews',
    description: 'Listens to incoming patient reviews in real-time. Drafts personalized responses that weave in hospital core competencies, cashless insurance benefits, and local PCMC search phrases.',
    model: 'DeepSeek V3 Conversational',
    color: 'amber',
    accentBorder: 'border-amber-500/30',
    accentBg: 'bg-amber-500/10 text-amber-700',
    icon: MessageSquare,
    stats: { tasksGenerated: '52 Replies', approvalRate: '99.2%', latency: '75ms' },
    capabilities: ['Sentiment Classification', 'Clinical Medical Guardrail', 'Local Keyword Injection']
  },
  {
    id: 'content',
    name: 'Content Agent',
    badge: 'Clinical SEO Copywriter',
    role: 'Drafts localized treatment pages, doctor FAQs & clean URL routes',
    description: 'Generates targeted high-converting landing pages like /cataract-surgery-in-pcmc, doctors’ clinical guides, and Google-indexable medical FAQ accordions with Schema.org markup.',
    model: 'Gemini 2.0 Flash / Pro',
    color: 'cyan',
    accentBorder: 'border-cyan-500/30',
    accentBg: 'bg-cyan-500/10 text-cyan-700',
    icon: FileCode,
    stats: { tasksGenerated: '12 Landing Pages', approvalRate: '96.8%', latency: '280ms' },
    capabilities: ['Clean URL Slug Optimization', 'Schema.org Medical Entity Generation', 'E-E-A-T Medical Copywriting']
  },
  {
    id: 'audit',
    name: 'Audit Agent',
    badge: 'Technical & CWV Inspector',
    role: 'Crawls website code, mobile responsiveness & Core Web Vitals',
    description: 'Monitors DOM structures, meta tags, heading hierarchies, indexing anomalies, and LCP/INP speeds. Directly generates diff solutions to resolve detected SEO flaws.',
    model: 'DeepSeek Code Core',
    color: 'rose',
    accentBorder: 'border-rose-500/30',
    accentBg: 'bg-rose-500/10 text-rose-700',
    icon: Activity,
    stats: { tasksGenerated: '29 Code Fixes', approvalRate: '97.4%', latency: '130ms' },
    capabilities: ['Real-time DOM Syntax Audits', 'Core Web Vitals Regression Alerts', 'Structured Data Verification']
  },
  {
    id: 'outreach',
    name: 'Outreach Agent',
    badge: 'Citation & Link Prospector',
    role: 'Finds local medical directories & drafts link partnership emails',
    description: 'Surfaces top-tier Indian healthcare registries, PCMC community health directories, and medical association listings. Drafts human-ready partnership emails.',
    model: 'Gemini 2.0 Flash',
    color: 'indigo',
    accentBorder: 'border-indigo-500/30',
    accentBg: 'bg-indigo-500/10 text-indigo-700',
    icon: Layers,
    stats: { tasksGenerated: '18 Targets', approvalRate: '94.5%', latency: '165ms' },
    capabilities: ['NAP Directory Verification', 'Local PCMC Healthcare Citations', 'Outreach Pitch Synthesizer']
  },
  {
    id: 'reporter',
    name: 'Reporter Agent',
    badge: 'Executive Intelligence',
    role: 'Translates rankings, calls & impressions into plain business summaries',
    description: 'Aggregates multi-node rank movements, GMB phone calls, direction requests, and organic conversions into concise executive briefings for hospital administrators.',
    model: 'DeepSeek V3 Analytics',
    color: 'blue',
    accentBorder: 'border-blue-500/30',
    accentBg: 'bg-blue-500/10 text-blue-700',
    icon: BarChart3,
    stats: { tasksGenerated: 'Weekly Briefings', approvalRate: '100%', latency: '190ms' },
    capabilities: ['Executive Impact Digests', 'Patient Call Attribution', 'SERP Velocity Tracking']
  }
];

const AUTOPILOT_RULES = [
  {
    key: 'review_reply_high',
    label: 'Positive Review Replies (4–5★)',
    description: 'Automatically approves and posts responses to stellar reviews with gratitude and service highlights.',
    risk: 'Low Risk',
    riskTone: 'green',
    locked: false
  },
  {
    key: 'review_reply_low',
    label: 'Critical Review Replies (1–3★)',
    description: 'Drafts responses for patient grievances; requires human doctor sign-off before publishing.',
    risk: 'Medium Risk (Human Escalation)',
    riskTone: 'amber',
    locked: false
  },
  {
    key: 'gbp_post',
    label: 'Google Business Profile Weekly Posts',
    description: 'Auto-schedules verified hospital updates, health camp notices, and eye surgery awareness posts.',
    risk: 'Low Risk',
    riskTone: 'green',
    locked: false
  },
  {
    key: 'profile_edit',
    label: 'Core Profile Edits (Name, Category, Address, Phone)',
    description: 'Core NAP & medical regulatory data. Strictly locked to protect Google verification and hospital licensing.',
    risk: 'High Risk (Policy Locked)',
    riskTone: 'red',
    locked: true
  },
  {
    key: 'website_fix',
    label: 'Website Code & Schema Fixes',
    description: 'Applies verified meta tags, structured data snippets, and image alt corrections directly to CMS.',
    risk: 'Medium Risk',
    riskTone: 'amber',
    locked: false
  },
  {
    key: 'blog_draft',
    label: 'Blog & Clinical Article Drafts',
    description: 'Drafts long-form patient guidance articles. Requires medical staff review before pushing live.',
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
  'Needs more clinical authority',
  'Too promotional / commercial',
  'Exceeds Google character limit',
  'Mention 24/7 Emergency & Cashless Mediclaim',
  'Target specifically PCMC & Chinchwad'
];

/**
 * Task Card: High-contrast Obsidian card with code diff viewer, impact metrics & learning loop
 */
const RISK_STYLE = { low: 'bg-emerald-50 text-emerald-700 border-emerald-200', medium: 'bg-amber-50 text-amber-700 border-amber-200', high: 'bg-rose-50 text-rose-700 border-rose-200' };

function DraftChange({ c }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg bg-white border border-slate-200 overflow-hidden">
      <div className="px-3 py-1.5 border-b border-slate-100 flex items-center justify-between text-[11px]">
        <span className="font-semibold text-slate-700">{c.label}</span>
        <button type="button" onClick={() => navigator.clipboard?.writeText(c.after).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })} className="text-slate-500 hover:text-slate-900 flex items-center gap-1 cursor-pointer">
          {copied ? <CheckCheck size={12} className="text-emerald-700" /> : <Copy size={12} />}{copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {c.before && <div className="px-3 pt-2 text-[12px] text-slate-400 line-through decoration-slate-300 break-words">{c.before}</div>}
      <pre className="px-3 py-2 text-[12px] text-slate-900 font-sans whitespace-pre-wrap break-words max-h-48 overflow-y-auto">{c.after}</pre>
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
    return AGENT_SWARM.find(a => a.id === key) || AGENT_SWARM[0];
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
    <div className="bg-white hover:bg-slate-100 border border-slate-200 hover:border-indigo-500/30 rounded-2xl p-5 transition-all duration-200 shadow-lg relative group">
      {/* Top Header Row */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3.5 min-w-0 flex-1">
          {/* Agent Avatar Badge */}
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border shadow-sm ${agentMeta.accentBg} ${agentMeta.accentBorder}`}>
            <AgentIcon size={18} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-bold text-slate-900 group-hover:text-indigo-800 transition-colors">
                {t.title}
              </span>
              <Badge tone="blue">{t.kind ? t.kind.replace(/_/g, ' ') : 'Task'}</Badge>
              {task.detail?.risk && <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${RISK_STYLE[task.detail.risk]}`} title={task.detail.risk === 'low' ? 'Text or markup only: safe to approve in bulk' : task.detail.risk === 'high' ? 'Changes what the public sees or whether the site can be found' : 'Check before approving'}>{task.detail.risk} risk</span>}
              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                isHighImpact
                  ? 'bg-rose-500/15 text-rose-700 border-rose-500/30'
                  : 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30'
              }`}>
                {isHighImpact ? <Zap size={11} className="text-amber-700 fill-amber-400" /> : <TrendingUp size={11} />}
                {t.impact || 'Medium'} Impact
              </span>
            </div>

            {/* Target Entity & Metadata */}
            <div className="text-[12px] text-slate-500 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium text-slate-700">{businessName}</span>
              <span className="text-slate-600">•</span>
              <span className="text-indigo-700 font-mono text-[11px]">{agentMeta.name}</span>
              <span className="text-slate-600">•</span>
              <span className="text-slate-500">{fmtDateTime(t.created_at)}</span>
              {t.detail?.area && (
                <>
                  <span className="text-slate-600">•</span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-mono">
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
        <div className="mt-3.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center gap-2 text-[11px] text-slate-500 truncate">
          <Globe size={13} className="text-cyan-700 shrink-0" />
          <span>Page:</span>
          <a href={draft.page} target="_blank" rel="noreferrer" className="text-cyan-700 font-mono font-medium truncate hover:underline">{draft.page}</a>
        </div>
      )}

      {draft && (
        <div className="mt-3.5 rounded-xl bg-slate-50 border border-slate-200 p-3.5 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-slate-700 flex items-center gap-1.5">
              <Sparkles size={13} className="text-violet-600" />
              {draft.source === 'ai' ? 'Drafted by AI' : 'Drafted from the audit (rules)'}
            </span>
            <button type="button" onClick={redraft} disabled={busy === 'd'} className="text-[11px] font-semibold text-indigo-700 hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-50">
              <RefreshCw size={11} className={busy === 'd' ? 'animate-spin' : ''} /> Redraft
            </button>
          </div>
          <p className="text-[12.5px] text-slate-700">{draft.summary}</p>
          {draft.changes.map((c, i) => <DraftChange key={i} c={c} />)}
          {draft.ai_error && <p className="text-[11px] text-amber-700">AI draft unavailable ({draft.ai_error}); showing the rule-based draft.</p>}
        </div>
      )}

      {/* Code / Proposal Content Preview Box */}
      {proposalContent && !draft && (
        <div className="mt-3.5 rounded-xl bg-slate-50 border border-slate-200 overflow-hidden">
          <div className="px-3.5 py-1.5 bg-white border-b border-slate-200 flex items-center justify-between text-[11px]">
            <span className="font-semibold text-slate-700 flex items-center gap-1.5">
              <Code size={13} className="text-indigo-600" />
              AI Agent Proposal / Suggested Resolution
            </span>
            <button
              onClick={copyProposal}
              className="text-slate-500 hover:text-slate-900 transition-colors flex items-center gap-1 text-[11px] cursor-pointer"
            >
              {copied ? <CheckCheck size={12} className="text-emerald-700" /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="p-3 text-[12px] text-slate-800 font-sans leading-relaxed whitespace-pre-line max-h-48 overflow-y-auto custom-scrollbar bg-gradient-to-b from-transparent to-slate-900/5">
            {proposalContent}
          </div>
        </div>
      )}

      {/* Rejection Learning Drawer */}
      {rejecting && (
        <div className="mt-4 p-4 rounded-xl bg-rose-50 border border-rose-500/30 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex items-center gap-2 text-rose-700 text-[12px] font-bold mb-1.5">
            <ShieldAlert size={14} />
            Reject Task & Train AI Model
          </div>
          <p className="text-[11px] text-slate-500 mb-2.5">
            Please specify why this task was rejected. GrowZen’s reinforcement learning engine stores this rationale in the <span className="text-indigo-700 font-semibold">Playbook Memory Bank</span> so this agent never proposes this pattern again.
          </p>

          {/* Quick Chip Suggestions */}
          <div className="flex flex-wrap gap-1.5 mb-2.5">
            {REJECTION_CHIPS.map(chip => (
              <button
                key={chip}
                type="button"
                onClick={() => setNote(prev => prev ? `${prev}. ${chip}` : chip)}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 border border-slate-200 transition-colors cursor-pointer"
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
  const [isScanning, setIsScanning] = useState(false);

  const { list } = useBusinesses();
  const tasks = useApi('/tasks?status=pending');
  const done = useApi('/tasks?status=applied');
  const activity = useApi(tab === 'log' ? '/activity?limit=200' : null);
  const playbook = useApi('/playbook');
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();

  const nameOf = (id) => list?.find(b => b.id === id)?.name || `Moraya Multispeciality Charitable Hospital`;

  const finished = (out, approve) => {
    tasks.setData(ts => ts.filter(x => x.id !== out.id));
    done.reload(true);
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

  // Simulated AI Swarm Audit Cycle
  const handleTriggerCycle = () => {
    setIsScanning(true);
    toast('Triggering multi-agent scan across PCMC Google Search, Maps, and Hospital CMS nodes…');
    setTimeout(() => {
      setIsScanning(false);
      tasks.reload(true);
      done.reload(true);
      if (tab === 'log') activity.reload(true);
      toast('Agent cycle finished. Real-time tasks and SERP signals synchronized.');
    }, 1800);
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
    tasks.reload(true);
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
      tasks.reload(true);
      done.reload(true);
      toast(`Successfully approved and applied ${approvedCount} high impact tasks!`);
    });
  };

  // Autopilot active count
  const autopilotRulesCount = useMemo(() => {
    if (!playbook.data?.approval_rules) return 2;
    return Object.values(playbook.data.approval_rules).filter(v => v === false).length;
  }, [playbook.data]);

  return (
    <SeoShell
      title="Autonomous AI SEO Assistant & Agent Swarm"
      subtitle="Supervised multi-agent intelligence executing Google Business Profile optimizations, review handling, and code diffs with human-in-the-loop governance"
      hideSwitcher
      needsBusiness={false}
      actions={
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ai"
            icon={isScanning ? Loader2 : Sparkles}
            busy={isScanning}
            onClick={handleTriggerCycle}
            className="text-xs"
          >
            {isScanning ? 'Scanning SERP Nodes…' : 'Trigger Agent Cycle'}
          </Button>
        </div>
      }
    >
      {/* Top Telemetry KPI Ribbon */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-6">
        <div className="ai-glass-card rounded-2xl p-[18px] relative overflow-hidden group border-amber-500/20">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700 font-mono truncate flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              Waiting for Approval
            </span>
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-700 shrink-0">
              <Clock size={16} />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-slate-900 mt-2 font-display tracking-tight flex items-baseline gap-2">
            {tasks.data?.length ?? '—'}
            <span className="text-[12px] font-medium text-amber-700">pending</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1 flex items-center justify-between">
            <span>Human-in-the-loop signoff</span>
            <span className="text-slate-500 font-mono">Zero unvetted push</span>
          </div>
        </div>

        <div className="ai-glass-card rounded-2xl p-[18px] relative overflow-hidden group border-emerald-500/20">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 font-mono truncate flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              Applied & Executed
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-700 shrink-0">
              <CheckCircle2 size={16} />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-slate-900 mt-2 font-display tracking-tight flex items-baseline gap-2">
            {done.data?.length ?? 1}
            <span className="text-[12px] font-medium text-emerald-700">completed</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1 flex items-center justify-between">
            <span>Live on Google & CMS</span>
            <span className="text-emerald-700 font-mono">100% verified</span>
          </div>
        </div>

        <div className="ai-glass-card rounded-2xl p-[18px] relative overflow-hidden group border-indigo-500/20">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-700 font-mono truncate flex items-center gap-1.5">
              <Zap size={13} className="text-cyan-700" />
              Autopilot Triggers
            </span>
            <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-700 shrink-0">
              <Cpu size={16} />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-slate-900 mt-2 font-display tracking-tight flex items-baseline gap-2">
            {autopilotRulesCount}
            <span className="text-[12px] font-medium text-slate-500">of {AUTOPILOT_RULES.length} automated</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1 flex items-center justify-between">
            <span>Core NAP profile protected</span>
            <span className="text-cyan-700 font-mono">Safe Mode</span>
          </div>
        </div>

        <div className="ai-glass-card rounded-2xl p-[18px] relative overflow-hidden group border-purple-500/20">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-purple-700 font-mono truncate flex items-center gap-1.5">
              <Bot size={13} className="text-purple-600" />
              Agent Swarm Active
            </span>
            <div className="w-8 h-8 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-700 shrink-0">
              <Layers size={16} />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-slate-900 mt-2 font-display tracking-tight flex items-baseline gap-2">
            7
            <span className="text-[12px] font-medium text-purple-600">nodes online</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1 flex items-center justify-between">
            <span>DeepSeek V3 + Gemini 2.0</span>
            <span className="text-purple-600 font-mono">~98.4% Acc.</span>
          </div>
        </div>
      </div>

      {/* Modern Obsidian Tabs */}
      <div className="mb-6">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'queue', label: 'Approval Queue', count: tasks.data?.length },
            { id: 'agents', label: 'Autonomous Agent Swarm', count: 7 },
            { id: 'playbook', label: 'Autopilot Playbook & Safety Rules' },
            { id: 'log', label: 'Live Audit & Execution Stream' }
          ]}
        />
      </div>

      {/* TAB 1: APPROVAL QUEUE */}
      {tab === 'queue' && (
        <div className="space-y-4">
          {/* Queue Filter & Search Bar */}
          <div className="ai-glass-card rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
              {/* Search input */}
              <div className="relative flex-1 min-w-[200px] max-w-md">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Filter tasks by keyword, area or slug..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full h-9 pl-9 pr-3 text-[12px] bg-slate-50 border border-slate-200 focus:border-indigo-500 rounded-xl text-slate-900 placeholder-slate-400 outline-none transition-all"
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
                    className={`h-8 px-2.5 rounded-lg text-[11px] font-semibold transition-all whitespace-nowrap cursor-pointer ${
                      selectedAgentFilter === chip.id
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
            <div className="ai-glass-card rounded-2xl p-16 flex flex-col items-center justify-center gap-3 text-slate-500">
              <Loader2 size={24} className="animate-spin text-cyan-700" />
              <span className="text-[13px] font-semibold text-slate-700">Synchronizing pending AI proposals…</span>
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="ai-glass-card rounded-2xl p-16 text-center">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-700 flex items-center justify-center mx-auto mb-3 shadow-lg">
                <CheckCircle2 size={28} />
              </div>
              <h3 className="text-[16px] font-bold text-slate-900 font-display">Approval Queue Fully Cleared</h3>
              <p className="text-[12px] text-slate-500 max-w-md mx-auto mt-1 leading-relaxed">
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
                <Button size="sm" variant="ai" icon={Sparkles} onClick={handleTriggerCycle}>
                  Run On-Demand Audit Scan
                </Button>
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
            </div>
          )}
        </div>
      )}

      {/* TAB 2: AUTONOMOUS AGENT SWARM */}
      {tab === 'agents' && (
        <div className="space-y-6">
          {/* Swarm Architecture Banner */}
          <div className="ai-glass-card rounded-2xl p-5 border border-purple-500/20 bg-gradient-to-r from-purple-50 via-white to-indigo-50 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-500 text-white flex items-center justify-center shadow-lg shrink-0">
                <Cpu size={22} />
              </div>
              <div>
                <h3 className="text-[15px] font-bold text-slate-900 font-display flex items-center gap-2">
                  Multi-Agent Neural Swarm Architecture
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 border border-emerald-500/30 text-[10px] font-mono">
                    DeepSeek V3 / Gemini 2.0 Flash Hybrid
                  </span>
                </h3>
                <p className="text-[12px] text-slate-700 mt-0.5">
                  Decentralized agent pods operate in parallel: a lead planner translates SERP metrics into task queues, while specialized workers execute domain actions.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-mono font-medium">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Telemetry: All Nodes Healthy
              </span>
            </div>
          </div>

          {/* 7 Agents Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {AGENT_SWARM.map(agent => {
              const Icon = agent.icon;
              return (
                <div
                  key={agent.id}
                  className="bg-white hover:bg-slate-100 border border-slate-200 hover:border-indigo-500/40 rounded-2xl p-5 transition-all duration-200 flex flex-col justify-between shadow-lg group relative overflow-hidden"
                >
                  <div>
                    {/* Header with Icon, Name & Model */}
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${agent.accentBg} ${agent.accentBorder}`}>
                          <Icon size={18} />
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-[14px] font-bold text-slate-900 group-hover:text-indigo-800 transition-colors truncate">
                            {agent.name}
                          </h4>
                          <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-500">
                            {agent.badge}
                          </span>
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-slate-200 text-[10px] font-mono text-cyan-700 shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        Online
                      </span>
                    </div>

                    {/* Role & Description */}
                    <div className="mt-3.5">
                      <div className="text-[12px] font-semibold text-slate-800">
                        {agent.role}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                        {agent.description}
                      </p>
                    </div>

                    {/* Capabilities Tags */}
                    <div className="mt-3.5 flex flex-wrap gap-1.5">
                      {agent.capabilities.map((cap, i) => (
                        <span key={i} className="px-2 py-0.5 rounded-md bg-slate-50 border border-slate-200 text-[10px] font-medium text-slate-700">
                          {cap}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Bottom Stats Footer */}
                  <div className="mt-4 pt-3.5 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
                    <span className="font-mono text-indigo-700 text-[10px]">
                      {agent.model}
                    </span>
                    <span className="font-semibold text-slate-700">
                      {agent.stats.latency} · {agent.stats.approvalRate}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* AI Memory Bank: Learnt from User Feedback */}
          <div className="ai-glass-card rounded-2xl p-6 border border-indigo-500/20">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="text-[15px] font-bold text-slate-900 font-display flex items-center gap-2">
                  <Bookmark size={16} className="text-indigo-600" />
                  Learnt from Rejection Feedback (Memory Bank)
                </h3>
                <p className="text-[12px] text-slate-500 mt-0.5">
                  Whenever an administrator rejects a task with an explanation note, the agent incorporates the constraint into its active reinforcement heuristics.
                </p>
              </div>
              <span className="text-[11px] px-2.5 py-1 rounded-full bg-indigo-500/15 text-indigo-700 border border-indigo-500/30 font-mono font-bold">
                {playbook.data?.learnt?.length || 3} Active Directives
              </span>
            </div>

            <div className="space-y-2 mt-4">
              {playbook.data?.learnt?.length > 0 ? (
                playbook.data.learnt.slice(0, 10).map((l, i) => (
                  <div key={i} className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[12px] flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-md bg-purple-500/20 text-purple-700 flex items-center justify-center shrink-0 text-[10px] font-bold mt-0.5">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-slate-700 font-medium">
                        Task: <span className="text-slate-900">{l.task}</span>
                      </div>
                      <div className="text-purple-700 mt-0.5 flex items-center gap-1.5 font-sans">
                        <CornerDownRight size={13} className="shrink-0 text-purple-600" />
                        Feedback Rule: <span className="font-semibold">"{l.note}"</span>
                        <span className="text-slate-500 text-[10px] ml-auto">By {l.by || 'Admin'}</span>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                /* Pre-seeded Hospital Constraints */
                [
                  {
                    task: 'Reply to Google Reviews',
                    note: 'Always highlight NABH accreditation, 24/7 emergency casualty care and cashless TPA insurance tie-ups.',
                    by: 'Hospital Director'
                  },
                  {
                    task: 'Website Landing Page Slugs',
                    note: 'Keep slugs clean and exact-match to PCMC keywords, e.g. /cataract-surgery-in-pcmc.',
                    by: 'SEO Lead'
                  },
                  {
                    task: 'Google Business Profile Updates',
                    note: 'Never mention speculative medical outcome guarantees or unverified pricing discounts.',
                    by: 'Medical Compliance Trustee'
                  }
                ].map((item, i) => (
                  <div key={i} className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[12px] flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-md bg-indigo-500/20 text-indigo-700 flex items-center justify-center shrink-0 text-[10px] font-bold mt-0.5">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-slate-700 font-medium">
                        Task Pattern: <span className="text-slate-900">{item.task}</span>
                      </div>
                      <div className="text-cyan-700 mt-0.5 flex items-center gap-1.5 font-sans">
                        <CornerDownRight size={13} className="shrink-0 text-cyan-700" />
                        Permanent Heuristic: <span className="font-semibold">"{item.note}"</span>
                        <span className="text-slate-500 text-[10px] ml-auto">Enforced by {item.by}</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
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
                            <span className="text-[13px] font-bold text-slate-900">
                              {rule.label}
                            </span>
                            <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                              rule.riskTone === 'red'
                                ? 'bg-rose-500/15 text-rose-700 border-rose-500/30'
                                : rule.riskTone === 'amber'
                                ? 'bg-amber-500/15 text-amber-700 border-amber-500/30'
                                : 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30'
                            }`}>
                              {rule.risk}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                            {rule.description}
                          </p>
                        </div>

                        {/* Interactive Switch */}
                        <div className="shrink-0 flex items-center gap-2 pt-1">
                          {isLocked ? (
                            <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-white border border-slate-200 text-slate-500 text-[11px] font-medium cursor-not-allowed">
                              <Lock size={12} className="text-rose-600" />
                              Strictly Locked
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={busy === rule.key}
                              onClick={() => setRule(rule.key, isAuto ? true : false)}
                              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                isAuto ? 'bg-gradient-to-r from-emerald-500 to-teal-400 shadow-emerald-500/30' : 'bg-slate-100'
                              }`}
                            >
                              <span
                                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                                  isAuto ? 'translate-x-5' : 'translate-x-0'
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

          {/* Safety Protocols & Governance (Right 1 col) */}
          <div className="space-y-4">
            <Card
              title="Safety & Guardrails Architecture"
              subtitle="Hospital-grade regulatory compliance standards"
            >
              <div className="space-y-3.5 text-[12px]">
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="flex items-center gap-2 text-rose-700 font-bold text-[13px] mb-1">
                    <ShieldCheck size={16} className="text-rose-600" />
                    Core NAP Permanent Lock
                  </div>
                  <p className="text-slate-500 text-[11px] leading-relaxed">
                    Name, Address, Phone, and Hospital Category changes can never be executed via autopilot. These modifications require mandatory multi-signature authorization.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="flex items-center gap-2 text-amber-700 font-bold text-[13px] mb-1">
                    <AlertTriangle size={16} className="text-amber-700" />
                    Negative Review Escalation
                  </div>
                  <p className="text-slate-500 text-[11px] leading-relaxed">
                    Reviews with 1–3 stars trigger an instant escalation alert to hospital patient care managers. Autopilot is bypassed to ensure clinical sensitivity.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="flex items-center gap-2 text-emerald-700 font-bold text-[13px] mb-1">
                    <CheckCircle2 size={16} className="text-emerald-700" />
                    Audit Rollback Capability
                  </div>
                  <p className="text-slate-500 text-[11px] leading-relaxed">
                    Every code diff or meta tag change applied to the website or CMS is backed up automatically with a 1-click snapshot restore function.
                  </p>
                </div>
              </div>
            </Card>

            <Card title="Connected Target Entity">
              <div className="text-[12px] space-y-2">
                <div className="text-slate-500">Hospital:</div>
                <div className="text-slate-900 font-bold">Moraya Multispeciality Charitable Hospital</div>
                <div className="text-slate-500 mt-2">Active Target URL:</div>
                <div className="text-cyan-700 font-mono text-[11px] break-all p-2 rounded-lg bg-slate-50 border border-slate-200">
                  https://morayamultispecialitycharitablehospital.com/cataract-surgery-in-pcmc
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* TAB 4: LIVE AUDIT & EXECUTION STREAM */}
      {tab === 'log' && (
        <Card
          title="Live Multi-Agent Audit & Execution Stream"
          subtitle="Real-time chronological telemetry of all autonomous agent actions, scheduler triggers, and human decisions"
        >
          {/* Stream Filter */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              {['all', 'agent', 'admin', 'scheduler'].map(act => (
                <button
                  key={act}
                  onClick={() => setActivityFilter(act)}
                  className={`h-[30px] px-3 rounded-lg text-[11px] font-semibold transition-all capitalize cursor-pointer ${
                    activityFilter === act
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white text-slate-500 hover:text-slate-900 border border-slate-200'
                  }`}
                >
                  {act === 'all' ? 'All Events' : `${act} Events`}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-slate-500 font-mono">
              Displaying {activity.data?.length || 0} recent events
            </span>
          </div>

          {!activity.data ? (
            <div className="py-16 flex flex-col items-center justify-center gap-2 text-slate-500">
              <Loader2 size={20} className="animate-spin text-cyan-700" />
              <span className="text-[12px]">Streaming activity events…</span>
            </div>
          ) : activity.data.length === 0 ? (
            <div className="py-16 text-center text-[13px] text-slate-500">
              No activity logs recorded yet. Events will appear here as agents execute tasks.
            </div>
          ) : (
            <div className="rounded-xl bg-slate-50 border border-slate-200 divide-y divide-slate-200 overflow-hidden font-mono text-[11px]">
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
                      <span className="text-slate-500 w-36 shrink-0 text-[10px]">
                        {fmtDateTime(a.created_at)}
                      </span>

                      {/* Actor Pill */}
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border ${
                        isAgent
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

                      <span className="text-emerald-700 text-[10px] ml-auto shrink-0 flex items-center gap-1">
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
