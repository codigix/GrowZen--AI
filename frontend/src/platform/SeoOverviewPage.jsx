import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip
} from 'recharts';
import {
  Phone, Navigation, MousePointerClick, Users, Star, Grid3x3, Bot, ArrowRight,
  Sparkles, CheckCircle2, Plug, Play, Loader2, TrendingUp, AlertTriangle,
  ShieldCheck, ExternalLink, RefreshCw, Zap, ArrowUpRight, BarChart3,
  Calendar, Award, Globe, Layers, Check, Search, FileText, Send, Terminal,
  Sliders, Cpu, ChevronRight, Activity, Flame, ShieldAlert, X, Copy,
  Eye, Stethoscope, Compass, MapPin, ChevronDown, Info, Code, Link2, CheckCheck
} from 'lucide-react';
import {
  SeoShell, Card, Stat, ScoreRing, Meter, StatusPill, Badge, Button, ChartTooltip,
  Legend, SourceTag, ErrorNote, BackendDown, SERIES, INK, scoreWord,
  useModulePath, useToast, useAction, LifecycleGrowthBar
} from './SeoUi';

import { api, useApi, fmtDateTime } from './seoApi';

export default function SeoOverviewPage() {
  return (
    <SeoShell
      title="Executive Local SEO Command Center"
      subtitle="Autonomous SERP dominance, Google Business Profile signals, and multi-node rank intelligence"
    >
      {(b) => <OverviewContent key={b.id} b={b} />}
    </SeoShell>
  );
}

function OverviewContent({ b }) {
  const navigate = useNavigate();
  const path = useModulePath();
  const [toast, toastNode] = useToast();
  const [chartRange, setChartRange] = useState('Last 30 Days');
  const [aiAssistantInput, setAiAssistantInput] = useState('');
  const [aiAssistantReply, setAiAssistantReply] = useState('');
  const [isAiAnswering, setIsAiAnswering] = useState(false);

  const ov = useApi(`/businesses/${b.id}/overview`);
  const [busy, error, run] = useAction();

  // Active clean target URL
  const targetDomain = b.website ? b.website.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : 'morayamultispecialitycharitablehospital.com';
  const targetSlug = 'cataract-surgery-in-pcmc';
  const targetUrl = `https://${targetDomain}/${targetSlug}`;

  const copyToClipboard = (text, msg) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      toast(msg || 'Copied to clipboard');
    }
  };

  const handleAiAsk = (promptText) => {
    const q = promptText || aiAssistantInput;
    if (!q.trim()) return;
    setIsAiAnswering(true);
    setAiAssistantInput(q);
    setTimeout(() => {
      setAiAssistantReply(`Analyzed '${q}' for ${b.name}: High local search intent detected in PCMC & Chinchwad. Recommend adding 2 new FAQ schemas to /${targetSlug} and increasing review response velocity to under 4 hours.`);
      setIsAiAnswering(false);
    }, 900);
  };

  // 30-Day Verified Conversion Trends data matching reference image
  const trendData = [
    { day: 'Oct 1', profile_views: 180, calls: 90, directions: 120, clicks: 140 },
    { day: 'Oct 5', profile_views: 240, calls: 110, directions: 160, clicks: 190 },
    { day: 'Oct 10', profile_views: 310, calls: 140, directions: 210, clicks: 250 },
    { day: 'Oct 15', profile_views: 360, calls: 160, directions: 260, clicks: 280 },
    { day: 'Oct 20', profile_views: 420, calls: 186, directions: 312, clicks: 298 },
    { day: 'Oct 25', profile_views: 390, calls: 175, directions: 290, clicks: 270 },
    { day: 'Oct 30', profile_views: 450, calls: 195, directions: 330, clicks: 320 }
  ];

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {/* Universal End-to-End Growth Engine Lifecycle Navigator */}
      <LifecycleGrowthBar currentStepId="onboarding" />

      {/* ════════════════ 1. TOP HERO ROW: 2 CARDS ════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Card 1: Business Entity & Clean URL Spotlight (approx 68% / 8 cols) */}
        <div className="lg:col-span-8 bg-[#0d1424] border border-[#1b253b] rounded-2xl p-5 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-5 relative overflow-hidden">
          <div className="flex items-center gap-4 min-w-0">
            {/* Hospital Building Image */}
            <div className="relative w-40 h-28 rounded-xl overflow-hidden border border-white/10 shrink-0 shadow-md">
              <img
                src="/moraya-hospital.jpg"
                alt="Moraya Hospital"
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.nextSibling.style.display = 'flex';
                }}
              />
              <div className="hidden absolute inset-0 bg-gradient-to-tr from-blue-700 to-indigo-600 items-center justify-center text-white font-extrabold text-2xl">
                M
              </div>
            </div>

            {/* Info and Clean URL */}
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[11px] font-semibold mb-1.5">
                <Check size={11} strokeWidth={3} /> Google Verified
              </div>

              <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight font-display truncate">
                {b.name}
              </h2>

              <p className="text-[12px] text-slate-400 mt-0.5">
                {b.primaryCategory || 'Multispeciality Hospital'} · {[b.city, b.area].filter(Boolean).join(', ') || 'PCMC, Pune'}
              </p>

              {/* Clean URL Bar */}
              <div className="mt-2.5 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#080d18] border border-white/10 text-[11px] font-mono text-cyan-400 shadow-inner max-w-full">
                <span className="truncate">{targetUrl}</span>
                <button
                  onClick={() => copyToClipboard(targetUrl, 'Clean URL copied!')}
                  className="p-0.5 text-slate-400 hover:text-white transition-colors cursor-pointer"
                  title="Copy URL"
                >
                  <Copy size={12} />
                </button>
                <a
                  href={targetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="p-0.5 text-slate-400 hover:text-cyan-300 transition-colors"
                  title="Visit Live Page"
                >
                  <ExternalLink size={12} />
                </a>
              </div>
            </div>
          </div>

          {/* Overall SEO Health Score Gauge on the right */}
          <div className="flex items-center gap-4 shrink-0 border-t md:border-t-0 md:border-l border-white/10 pt-3 md:pt-0 md:pl-5 w-full md:w-auto justify-between md:justify-end">
            {/* Custom Neon Circular Ring with 84 */}
            <div className="relative w-20 h-20 flex items-center justify-center shrink-0">
              <svg className="w-20 h-20 -rotate-90">
                <circle cx="40" cy="40" r="33" stroke="#172338" strokeWidth="6" fill="transparent" />
                <circle
                  cx="40"
                  cy="40"
                  r="33"
                  stroke="#10b981"
                  strokeWidth="6"
                  strokeDasharray="207"
                  strokeDashoffset="33"
                  strokeLinecap="round"
                  fill="transparent"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-black text-white font-display">84</span>
              </div>
            </div>

            <div className="min-w-0">
              <div className="text-[12px] font-bold text-emerald-400 flex items-center gap-0.5">
                <span>↑ +12</span>
              </div>
              <div className="text-[12px] font-bold text-white flex items-center gap-1 font-display">
                Overall SEO Health <Info size={11} className="text-slate-400" />
              </div>
              <div className="text-[11px] font-bold text-emerald-400 mt-0.5">
                Good Progress
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                3 priority items remaining
              </div>
            </div>
          </div>
        </div>

        {/* Card 2: AI Insight & Actions (approx 32% / 4 cols) */}
        <div className="lg:col-span-4 bg-[#0d1424] border border-[#1b253b] rounded-2xl p-4 shadow-xl flex flex-col justify-between gap-3">
          {/* Top Box: AI Insight */}
          <div className="bg-gradient-to-r from-blue-950/70 via-indigo-950/60 to-purple-950/50 border border-indigo-500/30 rounded-xl p-3.5 relative">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5 text-[12px] font-bold text-white">
                <Sparkles size={14} className="text-cyan-400" />
                <span>AI Insight</span>
              </div>
              <button
                onClick={() => navigate(path('automation'))}
                className="w-5 h-5 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-slate-300 hover:text-white transition-colors cursor-pointer"
              >
                <ArrowRight size={11} />
              </button>
            </div>
            <p className="text-[12px] text-slate-300 leading-relaxed">
              Your local visibility increased by 28% this month. Continue optimizing service pages.
            </p>
          </div>

          {/* Bottom Action Buttons */}
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => {
                toast('Multi-node neural audit started: crawling GBP, rankings, and on-page schema...');
                setTimeout(() => toast('Multi-node audit completed: SERP Health score updated to 84/100'), 3000);
              }}
              className="flex-1 h-9.5 px-3 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:opacity-95 text-white font-bold text-[12px] shadow-md shadow-blue-600/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Play size={13} className="fill-white" />
              <span>Run Multi-Node Audit</span>
            </button>
            <button
              onClick={() => navigate(path('reports'))}
              className="h-9.5 px-3.5 rounded-xl bg-[#131b2e] hover:bg-[#1a253e] border border-white/10 text-slate-200 hover:text-white font-bold text-[12px] transition-all flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
            >
              <FileText size={13} />
              <span>View Report</span>
            </button>
          </div>
        </div>
      </div>

      {/* ════════════════ 2. FIVE METRIC CARDS ROW ════════════════ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        {/* Card 1: Google Profile Views */}
        <div className="bg-[#0d1424] border border-[#1b253b] rounded-2xl p-4 shadow-lg flex flex-col justify-between">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-8 h-8 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
              <MapPin size={15} />
            </div>
            <span className="text-[11px] font-medium text-slate-300 leading-tight">
              Google Profile Views
            </span>
          </div>
          <div className="text-2xl font-black text-white font-display">2,348</div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-0.5">
              ↑ 28%
            </span>
            {/* Smooth SVG Sparkline */}
            <svg width="72" height="24" className="overflow-visible">
              <path d="M0,20 Q18,12 36,15 T72,4" fill="none" stroke="#3b82f6" strokeWidth="2.5" />
            </svg>
          </div>
        </div>

        {/* Card 2: Direct Phone Calls */}
        <div className="bg-[#0d1424] border border-[#1b253b] rounded-2xl p-4 shadow-lg flex flex-col justify-between">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-8 h-8 rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0">
              <Phone size={15} />
            </div>
            <span className="text-[11px] font-medium text-slate-300 leading-tight">
              Direct Phone Calls
            </span>
          </div>
          <div className="text-2xl font-black text-white font-display">186</div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-0.5">
              ↑ 42%
            </span>
            <svg width="72" height="24" className="overflow-visible">
              <path d="M0,22 Q18,16 36,18 T72,5" fill="none" stroke="#a855f7" strokeWidth="2.5" />
            </svg>
          </div>
        </div>

        {/* Card 3: Direction Requests */}
        <div className="bg-[#0d1424] border border-[#1b253b] rounded-2xl p-4 shadow-lg flex flex-col justify-between">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-8 h-8 rounded-xl bg-cyan-600/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
              <Navigation size={15} />
            </div>
            <span className="text-[11px] font-medium text-slate-300 leading-tight">
              Direction Requests
            </span>
          </div>
          <div className="text-2xl font-black text-white font-display">312</div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-0.5">
              ↑ 36%
            </span>
            <svg width="72" height="24" className="overflow-visible">
              <path d="M0,20 Q18,18 36,12 T72,6" fill="none" stroke="#06b6d4" strokeWidth="2.5" />
            </svg>
          </div>
        </div>

        {/* Card 4: Website Clicks */}
        <div className="bg-[#0d1424] border border-[#1b253b] rounded-2xl p-4 shadow-lg flex flex-col justify-between">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-8 h-8 rounded-xl bg-amber-600/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <MousePointerClick size={15} />
            </div>
            <span className="text-[11px] font-medium text-slate-300 leading-tight">
              Website Clicks
            </span>
          </div>
          <div className="text-2xl font-black text-white font-display">423</div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-0.5">
              ↑ 24%
            </span>
            <svg width="72" height="24" className="overflow-visible">
              <path d="M0,21 Q18,14 36,16 T72,7" fill="none" stroke="#f97316" strokeWidth="2.5" />
            </svg>
          </div>
        </div>

        {/* Card 5: New Patient Leads */}
        <div className="bg-[#0d1424] border border-[#1b253b] rounded-2xl p-4 shadow-lg flex flex-col justify-between">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-8 h-8 rounded-xl bg-pink-600/20 border border-pink-500/30 flex items-center justify-center text-pink-400 shrink-0">
              <Users size={15} />
            </div>
            <span className="text-[11px] font-medium text-slate-300 leading-tight">
              New Patient Leads
            </span>
          </div>
          <div className="text-2xl font-black text-white font-display">61</div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-0.5">
              ↑ 51%
            </span>
            <svg width="72" height="24" className="overflow-visible">
              <path d="M0,22 Q18,17 36,19 T72,4" fill="none" stroke="#ec4899" strokeWidth="2.5" />
            </svg>
          </div>
        </div>
      </div>

      {/* ════════════════ 3. MIDDLE ROW: TRENDS & MAP PERFORMANCE ════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Card: Patient Conversion Trends (approx 62% / 7 cols) */}
        <div className="lg:col-span-7 bg-[#0d1424] border border-[#1b253b] rounded-2xl p-5 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
              <div>
                <h3 className="text-[15px] font-bold text-white font-display">
                  Patient Conversion Trends
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Google activity and website engagement (last 30 days)
                </p>
              </div>

              {/* Date dropdown */}
              <div className="h-8 px-2.5 rounded-lg bg-[#12192c] border border-white/10 flex items-center gap-1.5 text-[11px] font-medium text-slate-300 cursor-pointer">
                <span>{chartRange}</span>
                <ChevronDown size={12} className="text-slate-400" />
              </div>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-300 mb-3 font-medium">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-500" /> Profile Views
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-purple-500" /> Calls
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-cyan-400" /> Directions
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-500" /> Website Clicks
              </span>
            </div>
          </div>

          {/* Area Chart with Floating Tooltip at Oct 20 */}
          <div className="h-64 relative pt-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData} margin={{ top: 8, right: 10, left: -22, bottom: 0 }}>
                <defs>
                  <linearGradient id="viewsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="callsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="dirGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="clicksGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#172238" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#1e293b' }} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} />
                <Area type="monotone" dataKey="profile_views" stroke="#3b82f6" strokeWidth={2.5} fill="url(#viewsGrad)" />
                <Area type="monotone" dataKey="calls" stroke="#8b5cf6" strokeWidth={2.5} fill="url(#callsGrad)" />
                <Area type="monotone" dataKey="directions" stroke="#06b6d4" strokeWidth={2.5} fill="url(#dirGrad)" />
                <Area type="monotone" dataKey="clicks" stroke="#f97316" strokeWidth={2.5} fill="url(#clicksGrad)" />
              </AreaChart>
            </ResponsiveContainer>

            {/* Pinned Tooltip Box exactly matching Oct 20 callout in reference */}
            <div className="absolute top-10 right-28 bg-[#0a0f1d]/95 backdrop-blur-md border border-white/15 rounded-xl p-3 shadow-2xl text-[11px] text-slate-200 pointer-events-none z-10 w-44">
              <div className="font-bold text-white mb-1.5 border-b border-white/10 pb-1">Oct 20, 2026</div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-slate-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500" /> Profile Views
                  </span>
                  <span className="font-mono font-bold text-white">420</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-slate-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-500" /> Calls
                  </span>
                  <span className="font-mono font-bold text-white">186</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-slate-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" /> Directions
                  </span>
                  <span className="font-mono font-bold text-white">312</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-slate-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Website Clicks
                  </span>
                  <span className="font-mono font-bold text-white">298</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Card: Local Map Performance (approx 38% / 5 cols) */}
        <div className="lg:col-span-5 bg-[#0d1424] border border-[#1b253b] rounded-2xl p-5 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-1">
              <div>
                <h3 className="text-[15px] font-bold text-white font-display">
                  Local Map Performance
                </h3>
                <p className="text-[11px] text-slate-400">
                  Google Maps ranking across PCMC region
                </p>
              </div>
              <button
                onClick={() => navigate(path('rank-tracking'))}
                className="px-2.5 py-1 rounded-lg bg-[#131b2e] hover:bg-[#1a253e] border border-white/10 text-cyan-400 hover:text-cyan-300 font-bold text-[11px] flex items-center gap-1 cursor-pointer transition-colors"
              >
                View Geo-Grid →
              </button>
            </div>
          </div>

          {/* Interactive Radar Map Canvas */}
          <div className="relative my-3 h-52 rounded-xl bg-[#090d18] border border-white/5 overflow-hidden flex items-center justify-center">
            {/* Concentric Radar Rings */}
            <div className="absolute w-44 h-44 rounded-full border border-blue-500/10 pointer-events-none" />
            <div className="absolute w-32 h-32 rounded-full border border-cyan-500/15 pointer-events-none" />
            <div className="absolute w-20 h-20 rounded-full border border-cyan-500/20 pointer-events-none" />

            {/* Radar Sweep Effect */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-500/10 via-transparent to-transparent pointer-events-none" />

            {/* Center Hospital Marker */}
            <div className="relative z-10 flex flex-col items-center">
              <div className="w-7 h-7 rounded-full bg-blue-600 border-2 border-white text-white flex items-center justify-center shadow-lg shadow-blue-500/40">
                <MapPin size={14} className="fill-white" />
              </div>
              <span className="mt-1 px-2 py-0.5 rounded bg-blue-950/90 border border-blue-500/40 text-[9px] font-bold text-white shadow-md">
                Moraya Hospital
              </span>
            </div>

            {/* Scattered Rank Nodes matching reference */}
            {/* Green #1 nodes */}
            <div className="absolute top-10 left-16 w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-md shadow-emerald-400/50" />
            <div className="absolute top-20 left-12 w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-md shadow-emerald-400/50" />
            <div className="absolute bottom-12 left-18 w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-md shadow-emerald-400/50" />
            <div className="absolute bottom-16 left-28 w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-md shadow-emerald-400/50" />

            {/* Teal Top 3 nodes */}
            <div className="absolute top-8 left-32 w-2.5 h-2.5 rounded-full bg-teal-300" />
            <div className="absolute top-14 left-24 w-2.5 h-2.5 rounded-full bg-teal-300" />
            <div className="absolute bottom-8 left-36 w-2.5 h-2.5 rounded-full bg-teal-300" />
            <div className="absolute bottom-10 left-14 w-2.5 h-2.5 rounded-full bg-teal-300" />

            {/* Orange Top 10 nodes */}
            <div className="absolute top-12 right-24 w-2.5 h-2.5 rounded-full bg-amber-400" />
            <div className="absolute top-24 right-20 w-2.5 h-2.5 rounded-full bg-amber-400" />
            <div className="absolute bottom-14 right-26 w-2.5 h-2.5 rounded-full bg-amber-400" />
            <div className="absolute top-18 right-32 w-2.5 h-2.5 rounded-full bg-amber-400" />

            {/* Red Outside 10 nodes */}
            <div className="absolute top-6 right-16 w-2.5 h-2.5 rounded-full bg-rose-500" />
            <div className="absolute bottom-6 right-14 w-2.5 h-2.5 rounded-full bg-rose-500" />

            {/* Stats Sidebar inside Map on the right */}
            <div className="absolute top-3 right-3 bg-[#0c1220]/90 border border-white/10 rounded-xl p-2.5 space-y-1.5 text-[11px] shadow-lg">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" /> #1
                </span>
                <span className="text-slate-300 font-mono">5 locations</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-teal-300 font-bold">
                  <span className="w-2 h-2 rounded-full bg-teal-300" /> Top 3
                </span>
                <span className="text-slate-300 font-mono">18 locations</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-amber-400 font-bold">
                  <span className="w-2 h-2 rounded-full bg-amber-400" /> Top 10
                </span>
                <span className="text-slate-300 font-mono">42 locations</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-rose-400 font-bold">
                  <span className="w-2 h-2 rounded-full bg-rose-400" /> Outside 10
                </span>
                <span className="text-slate-300 font-mono">6 locations</span>
              </div>
            </div>
          </div>

          {/* Bottom Map Legend */}
          <div className="flex items-center justify-between text-[11px] text-slate-400 font-medium pt-2 border-t border-white/10">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" /> #1 Rank
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-teal-300" /> Top 3
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400" /> Top 10
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500" /> Outside 10
            </span>
          </div>
        </div>
      </div>

      {/* ════════════════ 4. NEXT ROW: 6-PILLAR AUDIT & PRIORITY ACTION CENTER ════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Card: 6-Pillar Local SEO Audit (approx 65% / 8 cols) */}
        <div className="lg:col-span-8 bg-[#0d1424] border border-[#1b253b] rounded-2xl p-5 shadow-xl">
          <div className="flex items-center justify-between mb-3.5">
            <div>
              <h3 className="text-[15px] font-bold text-white font-display">
                6-Pillar Local SEO Audit
              </h3>
              <p className="text-[11px] text-slate-400">
                Comprehensive SERP ranking authority scores
              </p>
            </div>
            <button
              onClick={() => navigate(path('website-audit'))}
              className="text-[11px] font-bold text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer transition-colors"
            >
              View Detailed Audit →
            </button>
          </div>

          {/* 6 Pillars in a row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            {/* 1. Google Profile */}
            <div
              onClick={() => navigate(path('gmb-profile'))}
              className="bg-[#090e1c] border border-white/5 rounded-xl p-3 hover:border-blue-500/40 transition-all cursor-pointer flex flex-col justify-between"
            >
              <div>
                <div className="w-7 h-7 rounded-lg bg-blue-600/20 text-blue-400 flex items-center justify-center mb-2">
                  <Globe size={14} />
                </div>
                <div className="text-lg font-black text-white font-display">92/100</div>
                <div className="text-[12px] font-bold text-white mt-1">Google Profile</div>
                <div className="text-[10px] text-slate-400 mt-0.5">NAP & Category</div>
              </div>
              <div className="w-full h-1 bg-slate-800 rounded-full mt-3 overflow-hidden">
                <div className="h-full bg-emerald-400 rounded-full" style={{ width: '92%' }} />
              </div>
            </div>

            {/* 2. Map 3-Pack */}
            <div
              onClick={() => navigate(path('rank-tracking'))}
              className="bg-[#090e1c] border border-white/5 rounded-xl p-3 hover:border-cyan-500/40 transition-all cursor-pointer flex flex-col justify-between"
            >
              <div>
                <div className="w-7 h-7 rounded-lg bg-cyan-600/20 text-cyan-400 flex items-center justify-center mb-2">
                  <Grid3x3 size={14} />
                </div>
                <div className="text-lg font-black text-white font-display">88/100</div>
                <div className="text-[12px] font-bold text-white mt-1">Map 3-Pack</div>
                <div className="text-[10px] text-slate-400 mt-0.5">Geo-centroid ranking</div>
              </div>
              <div className="w-full h-1 bg-slate-800 rounded-full mt-3 overflow-hidden">
                <div className="h-full bg-cyan-400 rounded-full" style={{ width: '88%' }} />
              </div>
            </div>

            {/* 3. Technical SEO */}
            <div
              onClick={() => navigate(path('website-audit'))}
              className="bg-[#090e1c] border border-white/5 rounded-xl p-3 hover:border-emerald-500/40 transition-all cursor-pointer flex flex-col justify-between"
            >
              <div>
                <div className="w-7 h-7 rounded-lg bg-emerald-600/20 text-emerald-400 flex items-center justify-center mb-2">
                  <Zap size={14} />
                </div>
                <div className="text-lg font-black text-white font-display">96/100</div>
                <div className="text-[12px] font-bold text-white mt-1">Technical SEO</div>
                <div className="text-[10px] text-slate-400 mt-0.5">Core Web Vitals</div>
              </div>
              <div className="w-full h-1 bg-slate-800 rounded-full mt-3 overflow-hidden">
                <div className="h-full bg-emerald-400 rounded-full" style={{ width: '96%' }} />
              </div>
            </div>

            {/* 4. On-Page SEO */}
            <div
              onClick={() => navigate(path('on-page-seo'))}
              className="bg-[#090e1c] border border-white/5 rounded-xl p-3 hover:border-amber-500/40 transition-all cursor-pointer flex flex-col justify-between"
            >
              <div>
                <div className="w-7 h-7 rounded-lg bg-amber-600/20 text-amber-400 flex items-center justify-center mb-2">
                  <Layers size={14} />
                </div>
                <div className="text-lg font-black text-white font-display">90/100</div>
                <div className="text-[12px] font-bold text-white mt-1">On-Page SEO</div>
                <div className="text-[10px] text-slate-400 mt-0.5">Schema & Content</div>
              </div>
              <div className="w-full h-1 bg-slate-800 rounded-full mt-3 overflow-hidden">
                <div className="h-full bg-amber-400 rounded-full" style={{ width: '90%' }} />
              </div>
            </div>

            {/* 5. Backlink Authority */}
            <div
              onClick={() => navigate(path('off-page-seo'))}
              className="bg-[#090e1c] border border-white/5 rounded-xl p-3 hover:border-purple-500/40 transition-all cursor-pointer flex flex-col justify-between"
            >
              <div>
                <div className="w-7 h-7 rounded-lg bg-purple-600/20 text-purple-400 flex items-center justify-center mb-2">
                  <BarChart3 size={14} />
                </div>
                <div className="text-lg font-black text-white font-display">68/100</div>
                <div className="text-[12px] font-bold text-white mt-1">Backlink Authority</div>
                <div className="text-[10px] text-slate-400 mt-0.5">Local Citations</div>
              </div>
              <div className="w-full h-1 bg-slate-800 rounded-full mt-3 overflow-hidden">
                <div className="h-full bg-purple-400 rounded-full" style={{ width: '68%' }} />
              </div>
            </div>

            {/* 6. Directory Sync */}
            <div
              onClick={() => navigate(path('off-page-seo'))}
              className="bg-[#090e1c] border border-white/5 rounded-xl p-3 hover:border-indigo-500/40 transition-all cursor-pointer flex flex-col justify-between"
            >
              <div>
                <div className="w-7 h-7 rounded-lg bg-indigo-600/20 text-indigo-400 flex items-center justify-center mb-2">
                  <Award size={14} />
                </div>
                <div className="text-lg font-black text-white font-display">82/100</div>
                <div className="text-[12px] font-bold text-white mt-1">Directory Sync</div>
                <div className="text-[10px] text-slate-400 mt-0.5">Listings & NAP</div>
              </div>
              <div className="w-full h-1 bg-slate-800 rounded-full mt-3 overflow-hidden">
                <div className="h-full bg-indigo-400 rounded-full" style={{ width: '82%' }} />
              </div>
            </div>
          </div>
        </div>

        {/* Right Card: Priority Action Center (approx 35% / 4 cols) */}
        <div className="lg:col-span-4 bg-[#0d1424] border border-[#1b253b] rounded-2xl p-5 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <h3 className="text-[15px] font-bold text-white font-display">
                  Priority Action Center
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-bold">
                  3 High Priority
                </span>
              </div>
              <button
                onClick={() => navigate(path('automation-pipeline'))}
                className="text-[11px] font-bold text-cyan-400 hover:text-cyan-300 cursor-pointer"
              >
                View All →
              </button>
            </div>

            {/* 4 Action Items */}
            <div className="space-y-2">
              {/* Item 1 */}
              <div
                onClick={() => navigate(path('website-builder'))}
                className="p-2.5 rounded-xl bg-[#090e1c] border border-white/5 hover:border-rose-500/40 transition-all flex items-center justify-between gap-3 cursor-pointer group"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-6 h-6 rounded-lg bg-rose-600/20 text-rose-400 flex items-center justify-center text-[11px] font-bold shrink-0">
                    1
                  </div>
                  <span className="text-[12px] font-medium text-slate-200 group-hover:text-white truncate">
                    Optimize cataract-surgery-in-pcmc page
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-300 text-[10px] font-bold shrink-0">
                  High
                </span>
              </div>

              {/* Item 2 */}
              <div
                onClick={() => navigate(path('website-builder'))}
                className="p-2.5 rounded-xl bg-[#090e1c] border border-white/5 hover:border-amber-500/40 transition-all flex items-center justify-between gap-3 cursor-pointer group"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-6 h-6 rounded-lg bg-purple-600/20 text-purple-400 flex items-center justify-center text-[11px] font-bold shrink-0">
                    2
                  </div>
                  <span className="text-[12px] font-medium text-slate-200 group-hover:text-white truncate">
                    Add Schema.org MedicalWebPage
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 text-[10px] font-bold shrink-0">
                  Medium
                </span>
              </div>

              {/* Item 3 */}
              <div
                onClick={() => navigate(path('google-posts'))}
                className="p-2.5 rounded-xl bg-[#090e1c] border border-white/5 hover:border-blue-500/40 transition-all flex items-center justify-between gap-3 cursor-pointer group"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-6 h-6 rounded-lg bg-blue-600/20 text-blue-400 flex items-center justify-center text-[11px] font-bold shrink-0">
                    3
                  </div>
                  <span className="text-[12px] font-medium text-slate-200 group-hover:text-white truncate">
                    Publish 3 weekly Google Posts
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 text-[10px] font-bold shrink-0">
                  Medium
                </span>
              </div>

              {/* Item 4 */}
              <div
                onClick={() => navigate(path('off-page-seo'))}
                className="p-2.5 rounded-xl bg-[#090e1c] border border-white/5 hover:border-emerald-500/40 transition-all flex items-center justify-between gap-3 cursor-pointer group"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-6 h-6 rounded-lg bg-emerald-600/20 text-emerald-400 flex items-center justify-center text-[11px] font-bold shrink-0">
                    4
                  </div>
                  <span className="text-[12px] font-medium text-slate-200 group-hover:text-white truncate">
                    Build 10 high-authority local citations
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 text-[10px] font-bold shrink-0">
                  Low
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ════════════════ 5. BOTTOM ROW: RECENT ACTIONS, KEYWORDS, AI ASSISTANT ════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Column 1: Recent AI Actions (approx 28% / 3.5 cols) */}
        <div className="lg:col-span-4 bg-[#0d1424] border border-[#1b253b] rounded-2xl p-4 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5 text-[14px] font-bold text-white font-display">
                <Sparkles size={14} className="text-cyan-400" />
                <span>Recent AI Actions</span>
              </div>
              <button
                onClick={() => navigate(path('automation'))}
                className="text-[11px] font-bold text-cyan-400 hover:text-cyan-300 cursor-pointer"
              >
                View All →
              </button>
            </div>
            <p className="text-[10px] text-slate-400 -mt-2 mb-3">Latest automated SEO activities</p>

            <div className="space-y-2.5 text-[12px]">
              <div className="p-2 rounded-xl bg-[#090e1c] border border-white/5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-slate-200 font-medium truncate">Added service keyword to GBP description</div>
                    <div className="text-[10px] text-slate-400">2 hours ago</div>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 text-[10px] font-semibold shrink-0">
                  GBP Update
                </span>
              </div>

              <div className="p-2 rounded-xl bg-[#090e1c] border border-white/5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-slate-200 font-medium truncate">Created 3 optimized meta titles</div>
                    <div className="text-[10px] text-slate-400">5 hours ago</div>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 text-[10px] font-semibold shrink-0">
                  Content
                </span>
              </div>

              <div className="p-2 rounded-xl bg-[#090e1c] border border-white/5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-slate-200 font-medium truncate">Scanned PCMC local map pack</div>
                    <div className="text-[10px] text-slate-400">12 hours ago</div>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 text-[10px] font-semibold shrink-0">
                  Rank Tracking
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Column 2: Top Performing Keywords (approx 36% / 4.5 cols) */}
        <div className="lg:col-span-4 bg-[#0d1424] border border-[#1b253b] rounded-2xl p-4 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[14px] font-bold text-white font-display">
                Top Performing Keywords
              </h3>
              <button
                onClick={() => navigate(path('keyword-management'))}
                className="text-[11px] font-bold text-cyan-400 hover:text-cyan-300 cursor-pointer"
              >
                View All →
              </button>
            </div>

            <table className="w-full text-left text-[11px]">
              <thead className="text-slate-400 border-b border-white/10 pb-1">
                <tr>
                  <th className="pb-1.5 font-semibold">Keyword</th>
                  <th className="pb-1.5 text-center font-semibold">Position</th>
                  <th className="pb-1.5 text-center font-semibold">Change</th>
                  <th className="pb-1.5 text-right font-semibold">Search Vol.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                <tr>
                  <td className="py-2 text-slate-200 font-medium truncate">cataract surgery in pcmc</td>
                  <td className="py-2 text-center font-bold text-white font-mono">1</td>
                  <td className="py-2 text-center text-emerald-400 font-bold font-mono">↑ 2</td>
                  <td className="py-2 text-right text-slate-300 font-mono">1,600</td>
                </tr>
                <tr>
                  <td className="py-2 text-slate-200 font-medium truncate">eye hospital pcmc</td>
                  <td className="py-2 text-center font-bold text-white font-mono">2</td>
                  <td className="py-2 text-center text-emerald-400 font-bold font-mono">↑ 1</td>
                  <td className="py-2 text-right text-slate-300 font-mono">1,300</td>
                </tr>
                <tr>
                  <td className="py-2 text-slate-200 font-medium truncate">multispeciality hospital pcmc</td>
                  <td className="py-2 text-center font-bold text-white font-mono">3</td>
                  <td className="py-2 text-center text-emerald-400 font-bold font-mono">↑ 3</td>
                  <td className="py-2 text-right text-slate-300 font-mono">2,400</td>
                </tr>
                <tr>
                  <td className="py-2 text-slate-200 font-medium truncate">best eye hospital in pune</td>
                  <td className="py-2 text-center font-bold text-white font-mono">4</td>
                  <td className="py-2 text-center text-emerald-400 font-bold font-mono">↑ 5</td>
                  <td className="py-2 text-right text-slate-300 font-mono">880</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Column 3: AI Assistant (approx 36% / 4 cols) */}
        <div className="lg:col-span-4 bg-[#0d1424] border border-[#1b253b] rounded-2xl p-4 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-[13px] font-bold text-white font-display">
                <div className="w-5 h-5 rounded-lg bg-blue-600/30 text-blue-400 flex items-center justify-center">
                  <Sparkles size={12} />
                </div>
                <span>AI Assistant</span>
              </div>
              <span className="text-[10px] text-slate-400 font-medium flex items-center gap-1.5">
                <img src="/growzen-icon.png" alt="" className="w-3.5 h-3.5 object-contain" />
                <span>Powered by GrowZen AI</span>
              </span>
            </div>

            <div className="text-[13px] font-bold text-white mt-1">How can I help you today?</div>
            <p className="text-[11px] text-slate-400 mt-0.5 mb-2.5">
              Get SEO insights, create content, analyze competitors, and more.
            </p>

            {/* Quick Action Chips */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              {[
                'Optimize this page',
                'Find new keywords',
                'Improve Google Profile',
                'Generate content ideas'
              ].map((chip) => (
                <button
                  key={chip}
                  onClick={() => handleAiAsk(chip)}
                  className="px-2.5 py-1 rounded-lg bg-[#12192c] hover:bg-[#1a253e] border border-white/10 text-slate-300 hover:text-white text-[10px] font-medium transition-all cursor-pointer"
                >
                  {chip}
                </button>
              ))}
            </div>

            {/* AI Assistant Output if any */}
            {aiAssistantReply && (
              <div className="mb-2 p-2 rounded-xl bg-blue-950/40 border border-blue-500/20 text-[11px] text-cyan-200">
                {aiAssistantReply}
              </div>
            )}
          </div>

          {/* Chat Input Bar with Send Button */}
          <div className="flex items-center gap-1.5 bg-[#080d18] border border-white/10 rounded-xl px-2.5 py-1.5 shadow-inner">
            <input
              type="text"
              value={aiAssistantInput}
              onChange={(e) => setAiAssistantInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAiAsk()}
              placeholder="Ask anything about your local SEO..."
              className="flex-1 bg-transparent text-[12px] text-white placeholder-slate-500 focus:outline-none"
            />
            <button
              onClick={() => handleAiAsk()}
              disabled={isAiAnswering}
              className="w-7 h-7 rounded-lg bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center cursor-pointer transition-colors shrink-0 disabled:opacity-50"
            >
              {isAiAnswering ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            </button>
          </div>
        </div>
      </div>

      {toastNode}
    </div>
  );
}
