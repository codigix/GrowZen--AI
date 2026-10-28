import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, ScanSearch, Search, Store, MapPin, Star, Sparkles, Bot, FileBarChart, ShieldCheck, CheckCircle2, Lock, KeyRound, Trash2, Eye,
  ChevronDown, Menu, X, Building2, Wand2, LineChart, BadgeCheck, Mail, Clock, XCircle, Globe, Gauge, Check, AlertTriangle, Users, Zap, Layers,
  TrendingUp, Play, Phone, Compass, Award, Cpu, Shield, ArrowUpRight, CheckCircle, Flame, ExternalLink, HelpCircle
} from 'lucide-react';
import { SITE, CONTACT, GOOGLE_ACCESS } from './site';
import { PLANS } from '../platform/seoMock';

/**
 * World-Class Modern Landing Page for Bevisiby AI
 * Designed with a high-impact dark-luminescence aesthetic, glowing mesh gradients,
 * crisp 3D logo branding, interactive live product previews, and verified OAuth compliance.
 */

/* ── Brand Logo Component ─────────────────────────────────────────────── */
export const Logo = ({ light = true, className = '', iconSize = 'w-9 h-9 sm:w-10 sm:h-10', textSize = 'text-xl sm:text-2xl' }) => (
  <span className={`inline-flex items-center gap-2.5 transition-transform hover:scale-[1.02] select-none ${className}`}>
    <div className={`${iconSize} shrink-0 relative flex items-center justify-center`}>
      <img
        src="/bevisiby-mark.png"
        alt="Bevisiby Logo"
        className="w-full h-full object-contain filter drop-shadow-[0_2px_8px_rgba(6,182,212,0.3)]"
      />
    </div>
    <div className="flex items-center gap-1.5">
      <span className={`font-display font-extrabold tracking-tight ${textSize} ${light ? 'text-white' : 'text-slate-900'}`}>
        Bevisiby
      </span>
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md text-white bg-gradient-to-r from-blue-500 via-cyan-400 to-teal-400 shadow-sm tracking-wider">
        AI
      </span>
    </div>
  </span>
);

/* ── UI Badges & Buttons ──────────────────────────────────────────────── */
const Eyebrow = ({ children, light = true }) => (
  <div className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[12px] font-bold uppercase tracking-[0.14em] ${
    light
      ? 'bg-gradient-to-r from-blue-500/15 via-cyan-500/15 to-teal-500/15 text-cyan-300 border border-cyan-400/30 backdrop-blur-md shadow-[0_0_20px_rgba(6,182,212,0.15)]'
      : 'bg-blue-500/10 text-blue-600 border border-blue-500/20'
  }`}>
    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
    <span>{children}</span>
  </div>
);

const GRADIENT_BTN = 'bg-gradient-to-r from-blue-600 via-cyan-500 to-teal-400 hover:from-blue-500 hover:via-cyan-400 hover:to-teal-300 text-slate-950 font-bold transition-all duration-300 shadow-[0_0_25px_rgba(6,182,212,0.35)] hover:shadow-[0_0_35px_rgba(6,182,212,0.55)]';

/* ── Interactive Live Product Showcase ────────────────────────────────── */
function InteractiveShowcase() {
  const [activeTab, setActiveTab] = useState('command');

  const points = [14, 18, 16, 22, 21, 27, 25, 31, 30, 36, 41, 48];
  const path = points.map((v, i) => `${i ? 'L' : 'M'}${(i / (points.length - 1)) * 340},${64 - (v - 12) * 1.4}`).join(' ');

  const grid5x5 = [
    [3, 2, 2, 4, 7],
    [2, 1, 1, 2, 5],
    [3, 1, 1, 1, 3],
    [6, 2, 1, 3, 8],
    [11, 5, 3, 6, 14]
  ];

  return (
    <div className="relative w-full max-w-2xl mx-auto lg:max-w-none">
      {/* Background ambient lighting */}
      <div className="absolute -inset-4 sm:-inset-8 bg-gradient-to-tr from-blue-600/30 via-cyan-500/25 to-teal-400/20 blur-3xl rounded-[40px] pointer-events-none" aria-hidden />

      {/* Main Glass Chrome Shell */}
      <div className="relative rounded-3xl bg-[#0c1322]/90 backdrop-blur-2xl border border-slate-800 shadow-[0_25px_70px_-15px_rgba(0,0,0,0.7)] overflow-hidden ring-1 ring-cyan-500/20">
        {/* Top window bar */}
        <div className="h-12 px-4 flex items-center justify-between bg-[#080d18] border-b border-slate-800/80">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-rose-500/80 inline-block" />
            <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block" />
            <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
          </div>
          <div className="px-4 py-1 rounded-lg bg-[#0e1626] border border-slate-800 text-[11.5px] font-mono text-cyan-300 flex items-center gap-1.5 shadow-inner">
            <Lock size={11} className="text-emerald-400" />
            <span>https://app.bevisiby.ai/{activeTab}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-400 bg-emerald-950/60 px-2.5 py-1 rounded-full border border-emerald-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            <span>Autonomous Loop: Online</span>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="px-4 pt-3 pb-2 bg-[#0a0f1d] border-b border-slate-800/60 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {[
            { id: 'command', label: 'Command Center', icon: Layers },
            { id: 'grid', label: '5x5 Geo-Grid Map', icon: MapPin },
            { id: 'review', label: 'Review AI Copilot', icon: Star },
            { id: 'audit', label: 'Technical SEO Crawl', icon: ScanSearch }
          ].map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3.5 py-2 rounded-xl text-[12.5px] font-medium flex items-center gap-2 cursor-pointer transition-all ${
                  active
                    ? 'bg-gradient-to-r from-blue-600/30 to-cyan-500/20 text-cyan-300 border border-cyan-400/40 shadow-xs font-semibold'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/40'
                }`}
              >
                <Icon size={14} className={active ? 'text-cyan-400' : 'text-slate-500'} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Content Display */}
        <div className="p-6 min-h-[380px] flex flex-col justify-between">
          {activeTab === 'command' && (
            <div className="space-y-4 animate-fadeIn">
              {/* Top stats row */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: 'Overall Health', val: '94/100', color: 'text-emerald-400', sub: '+12pts this month' },
                  { label: 'Google Calls', val: '438 calls', color: 'text-cyan-400', sub: '+34% velocity' },
                  { label: 'Top 3 Map Pack', val: '18 keywords', color: 'text-blue-400', sub: 'Dominant' },
                  { label: 'Drafts Ready', val: '3 items', color: 'text-amber-400', sub: 'Awaiting 1-click' }
                ].map(s => (
                  <div key={s.label} className="p-3 rounded-2xl bg-[#0e1627] border border-slate-800/90 shadow-sm">
                    <div className="text-[10.5px] text-slate-400 font-medium truncate">{s.label}</div>
                    <div className={`text-[17px] font-extrabold tabular-nums tracking-tight mt-1 font-display ${s.color}`}>{s.val}</div>
                    <div className="text-[10px] text-emerald-400 font-semibold mt-0.5">{s.sub}</div>
                  </div>
                ))}
              </div>

              {/* Call Velocity Graph */}
              <div className="p-4 rounded-2xl bg-[#0e1627] border border-slate-800/90 shadow-inner">
                <div className="flex items-center justify-between text-[11.5px] mb-2">
                  <span className="font-semibold text-slate-200 flex items-center gap-2">
                    <Phone size={13} className="text-cyan-400" />
                    Direct Customer Calls from Google Maps
                  </span>
                  <span className="text-cyan-400/80 font-mono text-[10.5px]">Weekly Trend · Verified</span>
                </div>
                <svg viewBox="0 0 340 70" className="w-full h-16" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="hero-dark-graph" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.4" />
                      <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>
                  <path d={`${path} L340,70 L0,70 Z`} fill="url(#hero-dark-graph)" />
                  <path d={path} fill="none" stroke="#22d3ee" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>

              {/* AI Proposed Tasks */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Autonomous Drafts Ready for Approval:</div>
                {[
                  { title: 'Personalized Reply to 5★ Review from Dr. Sharma', desc: 'Emphasized clinical safety & quick response · Low risk' },
                  { title: 'Sync Updated Holiday Hours & Emergency Line', desc: 'Pre-scheduled for Google Business Profile sync' }
                ].map(t => (
                  <div key={t.title} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[#0e1627] border border-slate-800">
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-semibold text-slate-200 truncate">{t.title}</div>
                      <div className="text-[11px] text-slate-400 truncate">{t.desc}</div>
                    </div>
                    <button className="shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-cyan-500 text-white hover:from-blue-500 hover:to-cyan-400 cursor-pointer shadow-md shadow-cyan-500/20">
                      Approve
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'grid' && (
            <div className="space-y-4 animate-fadeIn">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[14px] font-bold text-white">“dentist near me” · 5x5 Geo-Grid Heatmap</div>
                  <div className="text-[11.5px] text-slate-400">Radius: 5.0 km from Clinic Centroid · Scan: Today</div>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-emerald-950/80 text-emerald-400 border border-emerald-500/30 text-[11px] font-bold">
                  Avg Position #1.6
                </span>
              </div>
              <div className="p-4 rounded-2xl bg-[#090e1b] border border-slate-800 flex items-center justify-center">
                <div className="grid grid-cols-5 gap-3">
                  {grid5x5.flat().map((rank, idx) => {
                    const bg = rank <= 3
                      ? 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/25 ring-1 ring-emerald-300/40'
                      : rank <= 6
                      ? 'bg-amber-400 text-slate-950 shadow-md ring-1 ring-amber-200'
                      : 'bg-rose-600 text-white shadow-md ring-1 ring-rose-300';
                    return (
                      <div
                        key={idx}
                        className={`w-10 h-10 rounded-xl ${bg} text-[13px] font-bold flex items-center justify-center transition-transform hover:scale-110 cursor-pointer ${
                          idx === 12 ? 'ring-4 ring-cyan-400 scale-105 shadow-cyan-400/40' : ''
                        }`}
                        title={`Rank #${rank}`}
                      >
                        {rank}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center justify-between text-[11.5px] text-slate-400 px-1">
                <span>🟢 Top 3 Map Pack in 20 of 25 grid nodes</span>
                <span className="font-semibold text-cyan-400">▲ 4.2 places gained vs last month</span>
              </div>
            </div>
          )}

          {activeTab === 'review' && (
            <div className="space-y-3.5 animate-fadeIn">
              <div className="flex items-center justify-between">
                <div className="text-[14px] font-bold text-white">Autonomous Review Copilot & Sentiment Guard</div>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-cyan-950 text-cyan-300 border border-cyan-800">
                  Sentiment: 98% Positive
                </span>
              </div>
              <div className="p-3.5 rounded-2xl bg-[#0e1627] border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 text-slate-950 font-bold text-[11px] flex items-center justify-center shadow-xs">
                      RS
                    </div>
                    <span className="text-[12.5px] font-semibold text-slate-200">Rahul Sen</span>
                  </div>
                  <div className="flex text-amber-400 text-[13px]">★★★★★</div>
                </div>
                <p className="text-[12px] text-slate-300 italic leading-relaxed">
                  "Hands down the best local service experience! The staff was courteous, appointments were on time, and results were visible immediately."
                </p>
              </div>
              <div className="p-3.5 rounded-2xl bg-cyan-950/40 border border-cyan-500/30 space-y-2">
                <div className="flex items-center gap-2 text-[11.5px] font-bold text-cyan-300">
                  <Bot size={14} className="text-cyan-400" />
                  <span>Drafted Response (Verified Business Persona):</span>
                </div>
                <p className="text-[12px] text-slate-200 leading-relaxed">
                  "Thank you so much Rahul! Our whole team takes great pride in on-time appointments and delivering real results. Looking forward to welcoming you back anytime!"
                </p>
                <div className="flex justify-end gap-2.5 pt-1">
                  <button className="px-3 py-1 rounded-lg text-[11px] font-medium text-slate-300 hover:bg-slate-800/60">Edit Draft</button>
                  <button className="px-3.5 py-1 rounded-lg text-[11px] font-bold bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-sm hover:from-blue-500 hover:to-cyan-400">
                    Publish to Google
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'audit' && (
            <div className="space-y-4 animate-fadeIn">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[14px] font-bold text-white">Google Lighthouse 360° Technical Diagnostic</div>
                  <div className="text-[11.5px] text-slate-400">Crawl completed across 48 local landing pages</div>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-500/40 text-[11px] font-bold">
                  Score: 98/100
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2.5">
                {[
                  { name: 'Core SEO', score: '98', color: 'text-emerald-400' },
                  { name: 'Page Speed', score: '94', color: 'text-emerald-400' },
                  { name: 'Schema JSON', score: '100', color: 'text-cyan-400' },
                  { name: 'Local NAP', score: '96', color: 'text-emerald-400' }
                ].map(item => (
                  <div key={item.name} className="p-3 rounded-xl bg-[#0e1627] border border-slate-800 text-center">
                    <div className={`text-[18px] font-extrabold ${item.color} font-display`}>{item.score}</div>
                    <div className="text-[10px] text-slate-400 font-medium mt-0.5">{item.name}</div>
                  </div>
                ))}
              </div>
              <div className="space-y-2 pt-1">
                {[
                  { ok: true, text: 'LocalBusiness JSON-LD schema validated with 0 errors' },
                  { ok: true, text: 'Clean URL slug hierarchy with neighborhood geo-modifiers' },
                  { ok: false, text: '2 missing meta descriptions generated & ready for 1-click paste' }
                ].map((row, i) => (
                  <div key={i} className="flex items-center gap-2.5 p-2.5 rounded-lg bg-[#0e1627] border border-slate-800 text-[12px]">
                    {row.ok ? <CheckCircle2 size={14} className="text-emerald-400 shrink-0" /> : <AlertTriangle size={14} className="text-amber-400 shrink-0" />}
                    <span className="text-slate-300 flex-1 truncate">{row.text}</span>
                    {!row.ok && <span className="text-[11px] font-bold text-cyan-400 hover:underline cursor-pointer">Apply Fix</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Floating Success Pill (Top Left) */}
      <div className="hidden sm:flex absolute -left-6 top-[22%] items-center gap-3 p-3.5 rounded-2xl bg-[#0e1627]/95 backdrop-blur-xl shadow-[0_15px_40px_rgba(0,0,0,0.5)] border border-cyan-500/30 z-20">
        <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
          <TrendingUp size={18} />
        </div>
        <div>
          <div className="text-[12.5px] font-bold text-white">#1 in Google Maps Pack</div>
          <div className="text-[11px] text-emerald-400 font-semibold">+6 positions in 14 days</div>
        </div>
      </div>

      {/* Floating Review Pill (Bottom Right) */}
      <div className="hidden sm:flex absolute -right-6 -bottom-5 items-center gap-3 p-3.5 rounded-2xl bg-[#0e1627]/95 backdrop-blur-xl shadow-[0_15px_40px_rgba(0,0,0,0.5)] border border-blue-500/30 z-20">
        <div className="w-9 h-9 rounded-xl bg-blue-500/20 text-cyan-400 flex items-center justify-center">
          <ShieldCheck size={18} />
        </div>
        <div>
          <div className="text-[12.5px] font-bold text-white">100% Human Approval</div>
          <div className="text-[11px] text-slate-400">Zero unauthorized changes</div>
        </div>
      </div>
    </div>
  );
}

/* ── Bento Grid Data ──────────────────────────────────────────────────── */
const BENTO_FEATURES = [
  {
    icon: MapPin,
    title: '5x5 Geo-Grid Rank Tracking',
    badge: 'Street-By-Street',
    desc: 'Pinpoint Google Maps rankings at every coordinate in your town. Discover who outranks you across radius scans from 1km to 25km.',
    accent: 'from-blue-500 to-cyan-500'
  },
  {
    icon: Store,
    title: 'Autonomous Google Profile Sync',
    badge: 'Official API v1',
    desc: 'Continuous synchronization with Google Business Profile. Schedules promotional posts, monitors review velocities, and updates hours.',
    accent: 'from-cyan-500 to-teal-500'
  },
  {
    icon: Star,
    title: 'AI Review Copilot & Sentiment Guard',
    badge: 'Human-Approved',
    desc: 'Automatically drafts warm, personalized responses to reviews within 24 hours, while immediately escalating negative feedback for review.',
    accent: 'from-teal-500 to-emerald-500'
  },
  {
    icon: ScanSearch,
    title: 'Lighthouse & Technical Crawler',
    badge: 'Core Web Vitals',
    desc: 'Deep crawl 50+ pages per domain. Identifies broken links, speed bottlenecks, mobile layout shifts, and missing local schema markup.',
    accent: 'from-blue-600 to-indigo-500'
  },
  {
    icon: Sparkles,
    title: 'Neighborhood Slugs & Content',
    badge: 'Fact-Locked AI',
    desc: 'Generates targeted local service articles and FAQ accordions grounded strictly in your verified business details. Zero hallucinations.',
    accent: 'from-violet-500 to-cyan-500'
  },
  {
    icon: FileBarChart,
    title: 'White-Label Agency Client Reports',
    badge: 'Automated PDFs',
    desc: 'Export executive-grade monthly PDF reports demonstrating tangible calls, direction requests, and rank trajectory gains to clients.',
    accent: 'from-emerald-500 to-cyan-500'
  }
];

const FAQS = [
  {
    q: 'What makes Bevisiby AI different from traditional SEO agencies?',
    a: 'Traditional agencies charge thousands each month for manual spreadsheets and slow quarterly reviews. Bevisiby AI operates 24/7 continuous autonomous loops, tracks precise 5x5 geo-grid rankings street-by-street, and pre-drafts technical fixes, review replies, and localized content for one-click approval.'
  },
  {
    q: 'Does Bevisiby AI publish changes to Google without my permission?',
    a: 'Never. Your public brand reputation is safeguarded by our strict Human-in-the-Loop policy. Every public-facing action (review responses, Google Business Profile updates, business hour changes) is prepared as a draft for your review. You have full discretion over what goes live.'
  },
  {
    q: 'How does Bevisiby comply with Google OAuth & API Limited Use Policies?',
    a: 'We strictly adhere to Google API Services User Data Policy, including Limited Use requirements. Google data accessed through our platform is used solely to provide your requested features (ranking intelligence, profile management, and review syncing). We never sell your data, never use it for advertising, and never use client data to train public AI models.'
  },
  {
    q: 'Can marketing agencies manage multiple client locations?',
    a: 'Yes! Bevisiby AI is purpose-built for agencies, multi-location franchises, and local marketing consultants. You can switch between client businesses with one click, assign team member permissions, and generate customized white-label monthly PDF reports.'
  },
  {
    q: 'How accurate is the AI-generated local content and review replies?',
    a: 'Bevisiby enforces a strict Fact-Locking system. AI drafts are grounded strictly in your verified business profile data, operating hours, real reviews, and actual geographic service areas. It never invents services or makes false promises.'
  },
  {
    q: 'Can I disconnect my Google accounts or delete my data at any time?',
    a: 'Absolutely. You can revoke Google permissions at any moment from within your Bevisiby dashboard or directly via myaccount.google.com/permissions. Furthermore, you can request total account deletion, and all stored data is permanently scrubbed within 30 days.'
  }
];

/* ── Main Landing Page Component ─────────────────────────────────────── */
export default function LandingPage({ user }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);

  const signedIn = Boolean(user);
  const startDestination = signedIn ? '/dashboard' : '/login';

  const navLinks = [
    { href: '#overview', label: 'Overview' },
    { href: '#features', label: 'Features' },
    { href: '#how-it-works', label: 'How It Works' },
    { href: '#security', label: 'Google Safety' },
    { href: '#pricing', label: 'Pricing' },
    { href: '#faq', label: 'FAQ' }
  ];

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 selection:bg-cyan-500/30 selection:text-cyan-200 font-sans antialiased overflow-x-hidden">
      {/* ── 1. Top Navbar ──────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-[#070b14]/85 backdrop-blur-xl border-b border-slate-800/80 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between gap-4">
          {/* Logo brand */}
          <a href="#top" className="flex items-center gap-1 focus:outline-hidden" aria-label="Bevisiby AI Home">
            <Logo light={true} iconSize="w-10 h-10" textSize="text-2xl" />
          </a>

          {/* Desktop Nav Links */}
          <nav className="hidden lg:flex items-center gap-8 text-[14.5px] font-medium text-slate-300">
            {navLinks.map(link => (
              <a
                key={link.href}
                href={link.href}
                className="hover:text-cyan-300 transition-colors relative py-1 hover:font-semibold"
              >
                {link.label}
              </a>
            ))}
          </nav>

          {/* Right Action Buttons */}
          <div className="flex items-center gap-3">
            {!signedIn ? (
              <Link
                to="/login"
                className="hidden sm:inline-flex px-4 py-2 text-[14px] font-semibold text-slate-300 hover:text-white hover:bg-slate-800/60 rounded-xl transition-all"
              >
                Sign In
              </Link>
            ) : null}

            <Link
              to={startDestination}
              className={`h-11 px-6 inline-flex items-center gap-2 rounded-xl text-[14px] font-bold ${GRADIENT_BTN}`}
            >
              <span>{signedIn ? 'Command Center' : 'Start Free Trial'}</span>
              <ArrowRight size={15} />
            </Link>

            {/* Mobile menu trigger */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(prev => !prev)}
              className="lg:hidden p-2 rounded-xl text-slate-300 hover:bg-slate-800 cursor-pointer focus:outline-hidden"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>

        {/* Mobile menu dropdown */}
        {mobileMenuOpen && (
          <div className="lg:hidden bg-[#0c1222]/95 backdrop-blur-2xl border-b border-slate-800 px-6 py-4 space-y-2 shadow-2xl animate-fadeIn">
            {navLinks.map(link => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className="block py-2.5 text-[15px] font-medium text-slate-300 hover:text-cyan-300"
              >
                {link.label}
              </a>
            ))}
            <div className="pt-3 border-t border-slate-800 flex flex-col gap-2">
              {!signedIn && (
                <Link
                  to="/login"
                  className="w-full h-11 flex items-center justify-center rounded-xl text-[14px] font-semibold text-slate-200 border border-slate-700 bg-slate-900"
                >
                  Sign In
                </Link>
              )}
              <Link
                to={startDestination}
                className={`w-full h-11 flex items-center justify-center gap-2 rounded-xl text-[14px] font-bold ${GRADIENT_BTN}`}
              >
                <span>{signedIn ? 'Command Center' : 'Start Free Trial'}</span>
                <ArrowRight size={15} />
              </Link>
            </div>
          </div>
        )}
      </header>

      <main id="top">
        {/* ── 2. Hero Section ─────────────────────────────────────────── */}
        <section id="overview" className="relative pt-16 pb-24 sm:pt-24 sm:pb-32 overflow-hidden">
          {/* Ambient luminous glow background */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[700px] pointer-events-none opacity-50">
            <div className="absolute -top-40 left-1/4 w-[600px] h-[600px] rounded-full bg-gradient-to-br from-blue-600/30 via-cyan-400/25 to-teal-400/15 blur-[120px]" />
            <div className="absolute top-20 right-10 w-[500px] h-[500px] rounded-full bg-gradient-to-br from-teal-500/20 via-emerald-400/15 to-transparent blur-[120px]" />
          </div>

          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-14 lg:gap-8 items-center">
              {/* Left Column: Copy & CTAs */}
              <div className="lg:col-span-6 space-y-7 text-center lg:text-left">
                <Eyebrow light={true}>Autonomous Local Growth & Maps SEO</Eyebrow>

                <h1 className="text-4xl sm:text-5xl lg:text-[60px] font-extrabold tracking-tight text-white leading-[1.06] font-display">
                  Dominate Local Search on{' '}
                  <span className="bg-gradient-to-r from-blue-400 via-cyan-300 to-teal-300 bg-clip-text text-transparent">
                    Autopilot.
                  </span>
                </h1>

                <p className="text-lg sm:text-xl text-slate-300 leading-relaxed max-w-xl mx-auto lg:mx-0 font-normal">
                  Bevisiby continuously monitors local rankings, audits website health, automates Google Business Profiles, and drafts revenue-driving fixes with risk-scored AI. You stay in control with 1-click approvals.
                </p>

                {/* Primary CTA button group */}
                <div className="pt-2 flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4">
                  <Link
                    to={startDestination}
                    className={`w-full sm:w-auto h-13 px-8 inline-flex items-center justify-center gap-2.5 rounded-2xl text-[15px] font-bold ${GRADIENT_BTN}`}
                  >
                    <span>{signedIn ? 'Open Command Center' : 'Start Free Trial'}</span>
                    <ArrowRight size={17} />
                  </Link>

                  <a
                    href="#how-it-works"
                    className="w-full sm:w-auto h-13 px-6 inline-flex items-center justify-center gap-2.5 rounded-2xl text-[15px] font-semibold text-slate-200 bg-slate-900/80 border border-slate-700/80 hover:bg-slate-800 hover:border-cyan-400/40 shadow-sm transition-all"
                  >
                    <Play size={14} className="text-cyan-400 fill-cyan-400" />
                    <span>How It Works</span>
                  </a>
                </div>

                {/* Trust Badges */}
                <div className="pt-4 flex flex-wrap items-center justify-center lg:justify-start gap-y-2 gap-x-6 text-[13px] text-slate-400 font-medium">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-emerald-400" />
                    <span>No credit card required</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-cyan-400" />
                    <span>Google OAuth Certified</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-teal-400" />
                    <span>Full Human-In-The-Loop</span>
                  </div>
                </div>
              </div>

              {/* Right Column: High-Tech Mockup Visual */}
              <div className="lg:col-span-6">
                <InteractiveShowcase />
              </div>
            </div>
          </div>
        </section>

        {/* ── 3. Ecosystem Marquee ─────────────────────────────────────── */}
        <section className="py-9 bg-[#0b1120] border-y border-slate-800/80">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6 text-center md:text-left">
              <div>
                <span className="text-[11.5px] font-bold uppercase tracking-[0.18em] text-cyan-400 block mb-0.5">
                  Connected Directly
                </span>
                <span className="text-[14.5px] font-semibold text-slate-300">
                  Built on official enterprise Google & AI APIs:
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[14px] font-medium text-slate-400">
                <span className="inline-flex items-center gap-2 hover:text-white transition-colors"><Store size={17} className="text-blue-400" /> Google Business Profile</span>
                <span className="inline-flex items-center gap-2 hover:text-white transition-colors"><MapPin size={17} className="text-rose-400" /> Google Maps Platform</span>
                <span className="inline-flex items-center gap-2 hover:text-white transition-colors"><Gauge size={17} className="text-amber-400" /> Google Lighthouse</span>
                <span className="inline-flex items-center gap-2 hover:text-white transition-colors"><Search size={17} className="text-cyan-400" /> Google Keyword Planner</span>
                <span className="inline-flex items-center gap-2 hover:text-white transition-colors"><Bot size={17} className="text-emerald-400" /> DeepSeek & Gemini</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── 4. Bento Grid: Enterprise Feature Matrix ────────────────── */}
        <section id="features" className="py-28 bg-[#070b14] relative">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto mb-20 space-y-3">
              <Eyebrow light={true}>Platform Architecture</Eyebrow>
              <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight font-display">
                Engineered for Local Market Dominance
              </h2>
              <p className="text-lg text-slate-400 leading-relaxed">
                Replace 5 fragmented subscriptions with one unified autonomous platform built specifically for local businesses, clinics, and marketing agencies.
              </p>
            </div>

            {/* Bento Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {BENTO_FEATURES.map((feat) => {
                const Icon = feat.icon;
                return (
                  <div
                    key={feat.title}
                    className="group relative p-8 rounded-3xl bg-[#0d1424] border border-slate-800 hover:border-cyan-400/50 hover:bg-[#10192e] transition-all duration-300 flex flex-col justify-between shadow-lg hover:shadow-[0_10px_35px_-10px_rgba(6,182,212,0.2)]"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-5">
                        <div className={`w-13 h-13 rounded-2xl bg-gradient-to-br ${feat.accent} p-0.5 shadow-md`}>
                          <div className="w-full h-full bg-[#0d1424] rounded-2xl flex items-center justify-center text-cyan-300">
                            <Icon size={24} />
                          </div>
                        </div>
                        <span className="text-[11px] font-bold px-3 py-1 rounded-full bg-cyan-950/70 text-cyan-300 border border-cyan-800/80">
                          {feat.badge}
                        </span>
                      </div>
                      <h3 className="text-xl font-bold text-white mb-2.5 font-display">{feat.title}</h3>
                      <p className="text-[14.5px] text-slate-400 leading-relaxed mb-4">{feat.desc}</p>
                    </div>
                    <div className="pt-4 border-t border-slate-800/80 text-[12.5px] font-semibold text-cyan-400 flex items-center justify-between">
                      <span>Explore Capability</span>
                      <ArrowUpRight size={16} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── 5. Comparison: Manual Agency vs Bevisiby AI ─────────────── */}
        <section className="py-28 bg-[#0a0f1d] border-y border-slate-800 relative overflow-hidden">
          <div className="absolute -top-40 right-0 w-[600px] h-[600px] rounded-full bg-cyan-600/10 blur-[130px] pointer-events-none" />
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
            <div className="text-center max-w-3xl mx-auto mb-20 space-y-3">
              <Eyebrow light={true}>The Competitive Shift</Eyebrow>
              <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight leading-tight font-display">
                Manual SEO Is Slow & Opaque. Autonomous AI Delivers ROI.
              </h2>
              <p className="text-slate-400 text-lg">
                Stop paying high retainers for backward-looking reports. Switch to real-time 24/7 autonomous growth.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
              {/* Old Traditional Way */}
              <div className="p-8 sm:p-10 rounded-3xl bg-[#0f172a]/70 border border-slate-800/80 backdrop-blur-md flex flex-col justify-between">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-rose-400 mb-2">Traditional Manual Agency</div>
                  <h3 className="text-2xl font-bold text-slate-200 mb-6 font-display">High Costs & Delayed Feedback</h3>
                  <ul className="space-y-4 text-[15px] text-slate-400">
                    {[
                      'Static audit spreadsheets that become outdated within 14 days',
                      'Blind keyword targeting without neighborhood geo-radius scanning',
                      'Waiting days for junior writers to compose simple review replies',
                      'Discovering a ranking drop only after customer call volume collapses',
                      'Clunky quarterly PDF decks without live transparent action records'
                    ].map(point => (
                      <li key={point} className="flex items-start gap-3.5">
                        <XCircle size={19} className="text-rose-500 shrink-0 mt-0.5" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* The Bevisiby AI Way */}
              <div className="p-8 sm:p-10 rounded-3xl bg-gradient-to-br from-blue-950/60 via-cyan-950/40 to-teal-950/50 border border-cyan-400/40 backdrop-blur-md shadow-2xl shadow-cyan-900/20 flex flex-col justify-between">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-cyan-300 mb-2">The Bevisiby AI Advantage</div>
                  <h3 className="text-2xl font-bold text-white mb-6 font-display">Continuous Real-Time Precision</h3>
                  <ul className="space-y-4 text-[15px] text-slate-100">
                    {[
                      '24/7 continuous autonomous monitoring with risk-scored instant fixes',
                      'Street-by-street 5x5 geo-grid rank maps updated on schedule',
                      'Personalized review responses pre-drafted within minutes for 1-click tap',
                      'Instant alerting via email/dashboard before drop penalties hurt revenue',
                      '1-click executive white-label client PDF reports showing actual ROI'
                    ].map(point => (
                      <li key={point} className="flex items-start gap-3.5">
                        <CheckCircle2 size={19} className="text-cyan-400 shrink-0 mt-0.5" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── 6. How It Works Pipeline ─────────────────────────────────── */}
        <section id="how-it-works" className="py-28 bg-[#070b14]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-2xl mx-auto mb-20 space-y-3">
              <Eyebrow light={true}>Autonomous Workflow</Eyebrow>
              <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight font-display">
                Four Steps to Search Supremacy
              </h2>
              <p className="text-lg text-slate-400 leading-relaxed">
                Add your business in 60 seconds. Our intelligence engine executes the rest.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                {
                  num: '01',
                  icon: Building2,
                  title: 'Connect & Verify',
                  desc: 'Input your business name or link Google account. We cross-verify details across Maps, web domains, and citations.'
                },
                {
                  num: '02',
                  icon: ScanSearch,
                  title: '360° Diagnostic',
                  desc: 'Our engine scans web speed, 5x5 Maps rank grids, GBP profile attributes, and customer sentiment.'
                },
                {
                  num: '03',
                  icon: Wand2,
                  title: 'AI Drafts & Risk-Scores',
                  desc: 'High-impact fixes are prepared: meta descriptions, schema markup, GBP posts, and review replies.'
                },
                {
                  num: '04',
                  icon: LineChart,
                  title: 'Approve & Grow',
                  desc: 'Approve public-facing actions in one click or enable autopilot for low-risk routine tasks. Watch calls surge.'
                }
              ].map(step => {
                const Icon = step.icon;
                return (
                  <div key={step.title} className="p-7 rounded-3xl bg-[#0d1424] border border-slate-800 shadow-md flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-5">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-400 text-slate-950 font-bold flex items-center justify-center shadow-lg shadow-cyan-500/20">
                          <Icon size={22} />
                        </div>
                        <span className="text-2xl font-black text-slate-700 tracking-tight font-display">{step.num}</span>
                      </div>
                      <h3 className="text-lg font-bold text-white mb-2 font-display">{step.title}</h3>
                      <p className="text-[14px] text-slate-400 leading-relaxed">{step.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── 7. Google OAuth Transparency & Data Safety ──────────────── */}
        <section id="security" className="py-28 bg-[#0a0f1d] border-y border-slate-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto mb-20 space-y-3">
              <Eyebrow light={true}>Security & Compliance</Eyebrow>
              <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight font-display">
                How Bevisiby Uses & Protects Google Data
              </h2>
              <p className="text-lg text-slate-400 leading-relaxed">
                We operate under zero-trust security architecture and adhere strictly to Google API Services User Data Policy.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              {GOOGLE_ACCESS.map(access => (
                <div key={access.product} className="p-7 rounded-3xl bg-[#0e1627] border border-slate-800">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-bold text-white font-display">{access.product}</h3>
                    <ShieldCheck size={20} className="text-cyan-400" />
                  </div>
                  <code className="text-[11.5px] text-cyan-300 bg-[#080d18] border border-slate-800 rounded-md px-2.5 py-1 font-mono block w-fit mb-3.5 break-all">
                    {access.scope}
                  </code>
                  <p className="text-[14.5px] text-slate-300 leading-relaxed mb-3">
                    <strong className="text-white">What we use it for:</strong> {access.use}
                  </p>
                  <p className="text-[13.5px] text-emerald-400 font-medium flex items-start gap-2 bg-emerald-950/40 p-3 rounded-xl border border-emerald-500/30">
                    <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
                    <span>{access.never}</span>
                  </p>
                </div>
              ))}
            </div>

            {/* Google Limited Use Commitment Callout */}
            <div className="p-8 sm:p-10 rounded-3xl bg-gradient-to-r from-blue-950/40 via-cyan-950/40 to-teal-950/40 border border-cyan-400/30 text-slate-300 text-[14.5px] leading-relaxed">
              <h4 className="text-lg font-bold text-white mb-2.5 flex items-center gap-2.5 font-display">
                <Shield size={20} className="text-cyan-400" />
                Google Limited Use Compliance Guarantee
              </h4>
              <p className="mb-2">
                Bevisiby's use and transfer to any other app of information received from Google APIs adheres to the{' '}
                <a
                  href="https://developers.google.com/terms/api-services-user-data-policy"
                  target="_blank"
                  rel="noreferrer"
                  className="text-cyan-400 underline font-semibold"
                >
                  Google API Services User Data Policy
                </a>
                , including the Limited Use requirements.
              </p>
              <p>
                Your Google data is never sold, never shared with third-party advertisers, and never used to train public AI models. You can revoke authorization anytime via{' '}
                <a
                  href="https://myaccount.google.com/permissions"
                  target="_blank"
                  rel="noreferrer"
                  className="text-cyan-400 underline font-semibold"
                >
                  myaccount.google.com/permissions
                </a>
                . Read our complete <Link to="/privacy" className="text-cyan-400 underline font-semibold">Privacy Policy</Link>.
              </p>
            </div>
          </div>
        </section>

        {/* ── 8. Pricing Matrix ───────────────────────────────────────── */}
        <section id="pricing" className="py-28 bg-[#070b14]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-2xl mx-auto mb-20 space-y-3">
              <Eyebrow light={true}>Transparent Investment</Eyebrow>
              <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight font-display">
                Plans for Growing Businesses & Agencies
              </h2>
              <p className="text-lg text-slate-400 leading-relaxed">
                Scale your SEO effortlessly. Upgrade, downgrade, or cancel anytime with zero lock-in contracts.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch">
              {PLANS.map(plan => {
                const popular = plan.popular;
                return (
                  <div
                    key={plan.name}
                    className={`relative p-8 rounded-3xl bg-[#0d1424] border flex flex-col justify-between transition-all ${
                      popular
                        ? 'border-cyan-400 shadow-2xl shadow-cyan-500/20 lg:-translate-y-2 ring-2 ring-cyan-400/30'
                        : 'border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {popular && (
                      <span className={`absolute -top-3.5 left-1/2 -translate-x-1/2 text-[11px] font-extrabold uppercase tracking-wider px-3.5 py-1 rounded-full ${GRADIENT_BTN}`}>
                        Most Popular
                      </span>
                    )}

                    <div>
                      <h3 className="text-2xl font-bold text-white font-display">{plan.name}</h3>
                      <p className="text-[13px] text-slate-400 mt-1 min-h-[36px]">{plan.who}</p>

                      <div className="mt-6 mb-7">
                        <span className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight font-display">{plan.price}</span>
                        {plan.price.startsWith('₹') && <span className="text-[13px] text-slate-400 font-medium"> / month</span>}
                      </div>

                      <div className="pt-5 border-t border-slate-800">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-3.5">Included Capabilities:</div>
                        <ul className="space-y-3 text-[14px] text-slate-300">
                          {plan.includes.map((feature, idx) => (
                            <li key={idx} className="flex items-start gap-2.5">
                              <CheckCircle2 size={16} className="text-cyan-400 shrink-0 mt-0.5" />
                              <span>{feature}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <div className="pt-8 mt-auto">
                      <Link
                        to={startDestination}
                        className={`w-full h-12 inline-flex items-center justify-center rounded-xl text-[14px] font-bold transition-all ${
                          popular
                            ? `${GRADIENT_BTN}`
                            : 'border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800'
                        }`}
                      >
                        {signedIn ? 'Access Plan' : 'Get Started'}
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── 9. FAQ Accordion ────────────────────────────────────────── */}
        <section id="faq" className="py-28 bg-[#0a0f1d] border-t border-slate-800">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-2xl mx-auto mb-20 space-y-3">
              <Eyebrow light={true}>Answers On Demand</Eyebrow>
              <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight font-display">
                Frequently Asked Questions
              </h2>
              <p className="text-lg text-slate-400">
                Everything you need to know about autonomous workflows, Google compliance, and agency features.
              </p>
            </div>

            <div className="divide-y divide-slate-800 border border-slate-800 rounded-3xl bg-[#0d1424] shadow-xl overflow-hidden">
              {FAQS.map((faq, index) => {
                const isOpen = openFaq === index;
                return (
                  <div key={faq.q} className="transition-colors">
                    <button
                      type="button"
                      onClick={() => setOpenFaq(isOpen ? -1 : index)}
                      className="w-full py-6 px-7 sm:px-9 text-left flex items-center justify-between gap-4 cursor-pointer focus:outline-hidden"
                      aria-expanded={isOpen}
                    >
                      <span className="text-[17px] font-bold text-white font-display">{faq.q}</span>
                      <ChevronDown
                        size={20}
                        className={`text-slate-400 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180 text-cyan-400' : ''}`}
                      />
                    </button>
                    {isOpen && (
                      <div className="px-7 sm:px-9 pb-6 text-[15px] text-slate-300 leading-relaxed animate-fadeIn">
                        {faq.a}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-10 text-center text-[14.5px] text-slate-400">
              Have a custom agency requirement?{' '}
              <a href={SITE.email ? `mailto:${SITE.email}` : undefined} className="text-cyan-400 font-bold hover:underline">
                Contact our engineering team
              </a>
            </div>
          </div>
        </section>

        {/* ── 10. Bottom Conversion Banner ────────────────────────────── */}
        <section className="py-24 bg-[#070b14]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="relative rounded-3xl bg-gradient-to-r from-blue-700 via-cyan-600 to-teal-500 p-9 sm:p-16 text-slate-950 overflow-hidden shadow-2xl shadow-cyan-500/20">
              <div className="absolute -right-20 -bottom-20 w-96 h-96 rounded-full bg-white/20 blur-3xl pointer-events-none" />
              <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
                <div className="lg:col-span-8 space-y-4">
                  <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-slate-950/20 text-slate-950 text-xs font-bold backdrop-blur-md">
                    <Sparkles size={14} className="text-slate-950" />
                    <span>Join 500+ Businesses Growing on Autopilot</span>
                  </div>
                  <h2 className="text-3xl sm:text-5xl font-black tracking-tight leading-tight font-display text-white">
                    Ready to Transform Your Local Search Presence?
                  </h2>
                  <p className="text-slate-900 text-base sm:text-lg max-w-2xl font-medium">
                    Add your business in under 60 seconds. Experience live 5x5 geo-grid rank maps, autonomous Lighthouse audits, and risk-scored AI draft fixes.
                  </p>
                </div>
                <div className="lg:col-span-4 flex flex-col sm:flex-row lg:flex-col gap-3 justify-center lg:items-end">
                  <Link
                    to={startDestination}
                    className="h-14 px-8 inline-flex items-center justify-center gap-2 rounded-2xl text-[16px] font-black bg-slate-950 text-white hover:bg-slate-900 shadow-2xl transition-all"
                  >
                    <span>{signedIn ? 'Open Command Center' : 'Start Free Trial'}</span>
                    <ArrowRight size={17} />
                  </Link>
                  <span className="text-[12.5px] text-slate-950 font-semibold text-center lg:text-right">
                    Zero credit card • Cancel anytime
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── 11. Enterprise Footer ─────────────────────────────────────── */}
      <footer className="bg-[#050811] border-t border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10">
            {/* Column 1: Brand Info */}
            <div className="lg:col-span-2 space-y-4">
              <Logo light={true} iconSize="w-10 h-10" textSize="text-2xl" />
              <p className="text-[14px] text-slate-400 leading-relaxed max-w-sm">
                Autonomous local SEO, Google Business Profile management, and hyper-local rank tracking engineered for verified revenue growth.
              </p>
              <div className="text-[13px] text-slate-400">
                A product of <strong className="text-slate-200">{SITE.company}</strong>.
              </div>
            </div>

            {/* Column 2: Product */}
            <div>
              <div className="text-[13px] font-bold uppercase tracking-wider text-slate-200 mb-4 font-display">
                Platform
              </div>
              <ul className="space-y-2.5 text-[14px] text-slate-400">
                <li><a href="#features" className="hover:text-cyan-400 transition-colors">5x5 Geo-Grid Tracking</a></li>
                <li><a href="#features" className="hover:text-cyan-400 transition-colors">GBP Manager</a></li>
                <li><a href="#features" className="hover:text-cyan-400 transition-colors">Review Copilot</a></li>
                <li><a href="#features" className="hover:text-cyan-400 transition-colors">Lighthouse Audits</a></li>
                <li><a href="#pricing" className="hover:text-cyan-400 transition-colors">Pricing Plans</a></li>
              </ul>
            </div>

            {/* Column 3: Legal & Compliance */}
            <div>
              <div className="text-[13px] font-bold uppercase tracking-wider text-slate-200 mb-4 font-display">
                Legal & Safety
              </div>
              <ul className="space-y-2.5 text-[14px] text-slate-400">
                <li><Link to="/privacy" className="hover:text-cyan-400 transition-colors">Privacy Policy</Link></li>
                <li><Link to="/terms" className="hover:text-cyan-400 transition-colors">Terms of Service</Link></li>
                <li><a href="#security" className="hover:text-cyan-400 transition-colors">Google Limited Use</a></li>
                <li><a href="#security" className="hover:text-cyan-400 transition-colors">Security Architecture</a></li>
              </ul>
            </div>

            {/* Column 4: Contact & Access */}
            <div>
              <div className="text-[13px] font-bold uppercase tracking-wider text-slate-200 mb-4 font-display">
                Connect
              </div>
              <ul className="space-y-2.5 text-[14px] text-slate-400">
                {SITE.email && (
                  <li>
                    <a href={`mailto:${SITE.email}`} className="hover:text-cyan-400 transition-colors flex items-center gap-1.5 break-all">
                      <Mail size={14} className="shrink-0" />
                      <span>{SITE.email}</span>
                    </a>
                  </li>
                )}
                {SITE.address && <li className="text-slate-400 text-[13px]">{SITE.address}</li>}
                <li className="pt-2">
                  <Link
                    to={startDestination}
                    className="inline-flex items-center gap-1.5 text-cyan-400 font-semibold text-[13.5px] hover:underline"
                  >
                    <span>{signedIn ? 'Access Dashboard' : 'Sign In to Account'}</span>
                    <ArrowRight size={13} />
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-14 pt-8 border-t border-slate-900 flex flex-col sm:flex-row items-center justify-between gap-4 text-[12.5px] text-slate-400">
            <span>© {new Date().getFullYear()} {SITE.company}. All rights reserved.</span>
            <span>{SITE.name} is not affiliated with or endorsed by Google LLC.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
