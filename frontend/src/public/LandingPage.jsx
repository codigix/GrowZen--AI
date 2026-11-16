import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, ScanSearch, Search, Store, MapPin, Star, Sparkles, Bot, FileBarChart, ShieldCheck, CheckCircle2, Lock, KeyRound, Trash2, Eye,
  ChevronDown, Menu, X, Building2, Wand2, LineChart, BadgeCheck, Mail, Clock, XCircle, Globe, Gauge, Check, AlertTriangle, Users, Zap, Layers,
  TrendingUp, Swords, Play, Phone, Compass, Award, Cpu, Shield, ArrowUpRight, CheckCircle, Flame, ExternalLink, HelpCircle
} from 'lucide-react';
import { SITE, CONTACT, GOOGLE_ACCESS } from './site';
import { PLANS } from '../platform/plans';

/**
 * World-Class Modern Landing Page for bevisibe AI
 * Designed with a high-impact dark-luminescence aesthetic, glowing mesh gradients,
 * crisp 3D logo branding, interactive live product previews, and verified OAuth compliance.
 */

/* ── Brand Logo Component ─────────────────────────────────────────────── */
export const Logo = ({ light = true, className = '', iconSize = 'w-10 h-10', textSize = 'text-2xl', showSubtitle = true }) => (
  <span className={`inline-flex items-center gap-3 transition-transform hover:scale-[1.02] select-none ${className}`}>
    <div className={`${iconSize} shrink-0  flex items-center justify-center `}>
      <img
        src="/bevisibe-mark.png"
        alt="bevisibe Logo"
        className="w-full h-full object-contain filter drop-shadow-md"
      />
    </div>
    <div className="flex flex-col text-left leading-none">
      <div className="flex items-center gap-1.5">
        <span className={`font-display font-extrabold tracking-tight ${textSize} ${light ? 'text-slate-900' : 'text-slate-900'}`}>
          bevisibe
        </span>
        <span className="text-10 font-black px-1.5 py-0.5 rounded-md text-white bg-indigo-500 shadow-sm  ">
          AI
        </span>
      </div>
      {showSubtitle && (
        <span className="text-9.5  tracking-[0.18em] text-indigo-500 font-bold  mt-1">
          Google Profile + SEO
        </span>
      )}
    </div>
  </span>
);

/* ── UI Badges & Buttons ──────────────────────────────────────────────── */
const Eyebrow = ({ children, light = true }) => (
  <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-12 font-bold tracking-[0.14em] bg-indigo-50 text-indigo-600 border border-indigo-200">
    <span className="w-2 h-2 rounded-full bg-indigo-500" />
    <span>{children}</span>
  </div>
);

const GRADIENT_BTN = 'bg-indigo-500 hover:bg-indigo-600 text-white font-bold transition-all duration-200 shadow-md shadow-indigo-500/25 hover:shadow-lg';

/* ── What the product does, shown as screens described in words: no numbers, names or results are shown that are not real ─────────── */
function InteractiveShowcase() {
  const [activeTab, setActiveTab] = useState('command');
  const tabs = [
    { id: 'command', label: 'Dashboard', icon: Layers, title: 'One place for every client', points: ['Every client with the state of its Google profile, website and reviews', 'A short list of what needs attention first', 'Tasks waiting for your approval'] },
    { id: 'grid', label: 'Local Rank Grid', icon: MapPin, title: 'Where you show up on the map', points: ['A grid of points around the business, each showing the position in Google Maps', 'Run it for any search, such as a service and the area', 'Compare scans over time'] },
    { id: 'review', label: 'Reviews', icon: Star, title: 'Reviews and replies', points: ['Every Google review in one list, with date and time', 'Replies drafted by AI in the business\'s tone', 'Nothing is posted until you approve it'] },
    { id: 'audit', label: 'Site Audit', icon: ScanSearch, title: 'Website audit', points: ['Crawls the pages of the website and lists what to fix', 'Speed and technical checks from Google PageSpeed', 'Fixes ranked by impact, with the page they belong to'] }
  ];
  const tab = tabs.find(t => t.id === activeTab) || tabs[0];
  const Icon = tab.icon;
  return (
    <div className="relative w-full max-w-2xl mx-auto lg:max-w-none">
      <div className="absolute -inset-4 sm:-inset-8 bg-gradient-to-tr from-indigo-300/30 via-blue-200/30 to-cyan-200/30 blur-3xl rounded-[40px] pointer-events-none" aria-hidden />
      <div className="relative rounded-3xl bg-white border border-slate-200 shadow-lg overflow-hidden ring-1 ring-indigo-300">
        <div className="px-4 pt-3 pb-2 bg-white border-b border-slate-200 flex items-center gap-1.5 overflow-x-auto no-scrollbar" role="tablist" aria-label="What the product does">
          {tabs.map(t => {
            const TabIcon = t.icon;
            const active = activeTab === t.id;
            return (
              <button key={t.id} type="button" role="tab" aria-selected={active} onClick={() => setActiveTab(t.id)}
                className={`px-3.5 py-2 rounded text-12.5 font-medium flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer transition-all ${active ? 'bg-gradient-to-r from-indigo-50 to-indigo-100 text-indigo-600 border border-indigo-200 font-semibold' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'}`}>
                <TabIcon size={14} className={active ? 'text-indigo-500' : 'text-slate-500'} /><span>{t.label}</span>
              </button>
            );
          })}
        </div>
        <div className="p-8 min-h-[300px]">
          <span className="inline-flex w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 items-center justify-center"><Icon size={24} /></span>
          <h3 className="text-20 font-bold text-slate-900 mt-4 font-display">{tab.title}</h3>
          <ul className="mt-4 space-y-3">
            {tab.points.map(pt => <li key={pt} className="flex items-start gap-2.5 text-14 text-slate-600"><CheckCircle2 size={16} className="text-indigo-500 shrink-0 mt-0.5" /><span>{pt}</span></li>)}
          </ul>
        </div>
      </div>
      <div className="hidden sm:flex absolute -right-4 -bottom-12 items-center gap-3 p-3.5 rounded bg-white/95 backdrop-blur-xl shadow-lg border border-blue-200 z-20">
        <div className="w-9 h-9 rounded bg-indigo-50 text-indigo-500 flex items-center justify-center"><ShieldCheck size={18} /></div>
        <div><div className="text-12.5 font-bold text-slate-900">You stay in control</div><div className="text-11 text-slate-500">Risky items wait for your approval</div></div>
      </div>
    </div>
  );
}

/* ── Bento Grid Data ──────────────────────────────────────────────────── */
const FEATURE_GROUPS = [
  {
    icon: Store, accent: 'from-indigo-500 to-blue-500', badge: 'Google Business Profile',
    title: 'Google Business Profile Manager',
    desc: 'Manage every client\'s profile from one workspace, and publish changes straight to Google.',
    points: ['Connect Google accounts and map each location to a client', 'Edit name, hours, holiday hours, phone, website, description, categories, address, services and attributes', 'Upload and delete photos; create, publish and delete posts', 'Verification status, pending edits and last-sync time per client']
  },
  {
    icon: Star, accent: 'from-amber-500 to-orange-500', badge: 'Reputation',
    title: 'Reviews & Reputation',
    desc: 'Never miss a review: AI answers positive reviews on its own and drafts the rest for you to approve.',
    points: ['All Google reviews with rating distribution and response rate', 'Replies to 4-5★ reviews run automatically; replies to 1-3★ reviews wait for your approval', 'Unanswered-review tracking and sentiment', 'Rating and review-count trends']
  },
  {
    icon: MapPin, accent: 'from-teal-500 to-emerald-500', badge: 'Local SEO & Maps',
    title: 'Local SEO & Maps',
    desc: 'See how each location ranks around the neighbourhood, and keep your listings consistent.',
    points: ['Local position tracking and geo-grid rank maps', 'Local citations and NAP consistency', 'Profile health score with a ranked fix list', 'Search keywords that found the profile, straight from Google']
  },
  {
    icon: ScanSearch, accent: 'from-blue-500 to-cyan-500', badge: 'Site Performance',
    title: 'Site Audit & Rankings',
    desc: 'Find what holds the website back and track where it ranks on Google.',
    points: ['Technical crawl: broken links, meta tags, schema and Core Web Vitals (Lighthouse)', 'Organic rankings and top pages from Google Search Console', 'On-page fixes with ready-to-paste suggestions', 'Domain overview for any website']
  },
  {
    icon: Search, accent: 'from-violet-500 to-indigo-500', badge: 'Keywords & Content',
    title: 'Keyword Research & AI Content',
    desc: 'Plan what to write, write it faster, and publish it on a schedule.',
    points: ['Keyword overview, discovery, strategy builder and saved keywords', 'Topic research from trending searches', 'AI writing assistant grounded in the client\'s real business details', 'Content calendar and publishing to the client\'s website']
  },
  {
    icon: Swords, accent: 'from-rose-500 to-pink-500', badge: 'Competitors & Links',
    title: 'Competitors & Backlinks',
    desc: 'Know who you are up against and where their links come from.',
    points: ['Competitor research, watch and domain comparison', 'Keyword gap against competitors', 'Backlink intelligence', 'Outreach tracking for link building']
  },
  {
    icon: Bot, accent: 'from-cyan-500 to-teal-500', badge: 'AI & Automation',
    title: 'AI Search Visibility & Agents',
    desc: 'Track visibility in AI answers and let agents prepare the routine work.',
    points: ['AI search visibility (GEO / AEO) tracking', 'Autonomous agents that run routine work and queue anything risky for your approval', 'Automation pipeline and a website builder with local slugs', 'Approval queue and a full activity log']
  },
  {
    icon: FileBarChart, accent: 'from-emerald-500 to-cyan-500', badge: 'Results',
    title: 'Leads, Reports & Team',
    desc: 'Show clients the results, and keep the team organised.',
    points: ['Leads and conversions per client', 'Analytics and client reports with PDF export', 'Switch between clients with one click', 'Team members and permissions']
  }
];

const FAQS = [
  {
    q: 'What does bevisibe AI include?',
    a: 'Two things in one workspace. First, Google Business Profile management: connect a client’s Google account, edit the profile, photos and posts, and handle reviews. Second, the SEO process around it: site audits, organic and local rankings, keyword research, competitor and backlink analysis, AI content, AI search visibility, leads and client reports.'
  },
  {
    q: 'Does bevisibe AI change my Google profile without my permission?',
    a: 'Routine, low-risk items run on their own by default: replies to 4-5★ reviews and the weekly post. Anything riskier waits for your approval first: replies to 1-3★ reviews, profile changes, website fixes and outreach. Details you edit yourself, such as hours, phone or description, are saved and sent to your Google Business Profile when you press Save. You can change which items run automatically, or switch autopilot off, in the Playbook.'
  },
  {
    q: 'How does bevisibe comply with Google OAuth & API Limited Use Policies?',
    a: 'We strictly adhere to Google API Services User Data Policy, including Limited Use requirements. Google data accessed through our platform is used solely to provide your requested features (ranking intelligence, profile management, and review syncing). We never sell your data, never use it for advertising, and never use client data to train public AI models.'
  },
  {
    q: 'Can marketing agencies manage multiple client locations?',
    a: 'Yes! bevisibe AI is purpose-built for agencies, multi-location franchises, and local marketing consultants. You can switch between client businesses with one click, assign team member permissions, and generate customized white-label monthly PDF reports.'
  },
  {
    q: 'How accurate is the AI-generated local content and review replies?',
    a: 'bevisibe enforces a strict Fact-Locking system. AI drafts are grounded strictly in your verified business profile data, operating hours, real reviews, and actual geographic service areas. It never invents services or makes false promises.'
  },
  {
    q: 'Can I disconnect my Google accounts or delete my data at any time?',
    a: 'Absolutely. You can revoke Google permissions at any moment from within your bevisibe dashboard or directly via myaccount.google.com/permissions. Furthermore, you can request total account deletion, and all stored data is permanently scrubbed within 30 days.'
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
    <div className="min-h-screen bg-body text-slate-800 selection:bg-indigo-100 selection:text-indigo-900 font-sans antialiased overflow-x-hidden">
      {/* ── 0. Top Announcement Ribbon ─────────────────────────────────── */}
      <div className="bg-indigo-50 border-b border-slate-200 text-xs py-2 px-4 text-center text-slate-600 relative z-50 flex items-center justify-center gap-2.5">
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 text-10.5 font-bold border border-indigo-200 shadow-xs">
          <Sparkles size={11} className="text-indigo-600" /> Google Business Profile manager
        </span>
        <span className="hidden sm:inline text-slate-600 font-medium">Google Business Profile management and the full SEO process for every client.</span>
        <a href="#how-it-works" className="text-indigo-600 font-semibold hover:underline inline-flex items-center gap-1 ml-1">
          Explore Live Engine <ArrowRight size={11} />
        </a>
      </div>

      {/* ── 1. Top Navbar ──────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-2xl border-b border-slate-200 shadow-lg relative after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[1px] after:bg-gradient-to-r after:from-transparent after:via-cyan-500/50 after:to-transparent">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-24 flex items-center justify-between gap-4">
          {/* Logo brand */}
          <a href="#top" className="flex items-center gap-1 focus:outline-hidden" aria-label="bevisibe AI Home">
            <Logo light={false} iconSize="w-14 h-14" textSize="text-3xl" showSubtitle={true} />
          </a>

          {/* Centered Capsule Nav Links */}
          <nav className="hidden lg:flex items-center gap-1 bg-slate-50 px-2 py-1.5 rounded-full border border-slate-200 backdrop-blur-xl shadow-xs">
            {navLinks.map(link => (
              <a
                key={link.href}
                href={link.href}
                className="px-4 py-1.5 rounded-full text-13.5 font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-all"
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
                className="hidden sm:inline-flex px-4 py-2 text-14 font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-all"
              >
                Sign In
              </Link>
            ) : null}

            <Link
              to={startDestination}
              className={`h-11 px-6 inline-flex items-center gap-2 rounded text-14 font-bold ${GRADIENT_BTN}`}
            >
              <span>{signedIn ? 'Command Center' : 'Get Started'}</span>
              <ArrowRight size={15} />
            </Link>

            {/* Mobile menu trigger */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(prev => !prev)}
              className="lg:hidden p-2.5 rounded text-slate-600 hover:bg-slate-100 cursor-pointer focus:outline-hidden border border-slate-200"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>

        {/* Mobile menu dropdown */}
        {mobileMenuOpen && (
          <div className="lg:hidden bg-white backdrop-blur-2xl border-b border-slate-200 px-6 py-5 space-y-3 shadow-2xl animate-fadeIn">
            {navLinks.map(link => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className="block py-2.5 text-15 font-medium text-slate-800 hover:text-indigo-600 border-b border-slate-200"
              >
                {link.label}
              </a>
            ))}
            <div className="pt-3 flex flex-col gap-2.5">
              {!signedIn && (
                <Link
                  to="/login"
                  className="w-full h-11 flex items-center justify-center rounded text-14 font-semibold text-slate-800 border border-slate-200 bg-white"
                >
                  Sign In
                </Link>
              )}
              <Link
                to={startDestination}
                className={`w-full h-11 flex items-center justify-center gap-2 rounded text-14 font-bold ${GRADIENT_BTN}`}
              >
                <span>{signedIn ? 'Command Center' : 'Get Started'}</span>
                <ArrowRight size={15} />
              </Link>
            </div>
          </div>
        )}
      </header>

      <main id="top">
        {/* ── 2. Hero Section ─────────────────────────────────────────── */}
        <section id="overview" className="relative pt-12 pb-24 sm:pt-20 sm:pb-32 overflow-hidden">
          {/* Ambient luminous glow background */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[700px] pointer-events-none opacity-50">
            <div className="absolute -top-40 left-1/4 w-[600px] h-[600px] rounded-full bg-gradient-to-br from-indigo-300/40 via-blue-200/40 to-cyan-200/30 blur-[120px]" />
            <div className="absolute top-20 right-10 w-[500px] h-[500px] rounded-full bg-gradient-to-br from-cyan-200/40 via-indigo-100/40 to-transparent blur-[120px]" />
          </div>

          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-14 lg:gap-8 items-center">
              {/* Left Column: Copy & CTAs */}
              <div className="lg:col-span-6 space-y-7 text-center lg:text-left">
                <div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-white border border-indigo-200 shadow-md backdrop-blur-xl">
                  <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                  <span className="text-12 font-bold  tracking-[0.14em] text-indigo-600">
                    Google Business Profile + Complete SEO
                  </span>
                </div>

                <h1 className="text-4xl sm:text-5xl lg:text-5xl xl:text-62 font-extrabold tracking-tight text-slate-900 leading-[1.06] font-display">
                  Manage Google Profiles and Grow SEO,{' '}
                  <span className="bg-gradient-to-r from-indigo-500 via-blue-500 to-cyan-500 bg-clip-text text-transparent">
                    in One Place.
                  </span>
                </h1>

                <p className="text-lg sm:text-xl text-slate-600 leading-relaxed max-w-xl mx-auto lg:mx-0 font-normal">
                  Connect your clients' Google accounts and manage their Business Profiles, reviews, posts and photos, then run the whole SEO process on top: site audits, keywords, rankings, competitors, backlinks, AI content and reports. Routine work runs on its own, and anything risky waits for your approval.
                </p>

                {/* Primary CTA button group */}
                <div className="pt-2 flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4">
                  <Link
                    to={startDestination}
                    className={`w-full sm:w-auto h-13 px-8 py-2 inline-flex items-center justify-center gap-2.5 rounded text-15 font-bold ${GRADIENT_BTN}`}
                  >
                    <span>{signedIn ? 'Open Command Center' : 'Get Started'}</span>
                    <ArrowRight size={17} />
                  </Link>

                  <a
                    href="#how-it-works"
                    className="w-full sm:w-auto h-13 px-6 p-2 inline-flex items-center justify-center gap-2.5 rounded text-15 font-semibold text-slate-800 bg-white border border-slate-200 hover:bg-slate-100 hover:border-indigo-200 shadow-sm transition-all"
                  >
                    <Play size={14} className="text-indigo-500 fill-indigo-500" />
                    <span>How It Works</span>
                  </a>
                </div>

                {/* Trust Badges with Rating stars */}
                <div className="pt-4 flex flex-wrap items-center justify-center lg:justify-start gap-y-3 gap-x-6 text-13 text-slate-500 font-medium">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-indigo-500" />
                    <span>Connected through official Google APIs</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-teal-600" />
                    <span>Routine tasks run automatically</span>
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
        <section className="py-9 bg-white border-y border-slate-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6 text-center md:text-left">
              <div>
                <span className="text-11.5 font-bold  tracking-[0.18em] text-indigo-500 block mb-0.5">
                  Connected Directly
                </span>
                <span className="text-14.5 font-semibold text-slate-600">
                  Works with the Google services your clients already use:
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-14 font-medium text-slate-500">
                <span className="inline-flex items-center gap-2 hover:text-slate-900 transition-colors"><Store size={17} className="text-blue-600" /> Google Business Profile</span>
                <span className="inline-flex items-center gap-2 hover:text-slate-900 transition-colors"><TrendingUp size={17} className="text-indigo-500" /> Google Search Console</span>
                <span className="inline-flex items-center gap-2 hover:text-slate-900 transition-colors"><MapPin size={17} className="text-rose-600" /> Google Maps Platform</span>
                <span className="inline-flex items-center gap-2 hover:text-slate-900 transition-colors"><Gauge size={17} className="text-amber-400" /> Google Lighthouse</span>
                <span className="inline-flex items-center gap-2 hover:text-slate-900 transition-colors"><Bot size={17} className="text-emerald-600" /> DeepSeek & Gemini</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── 4. Everything in one workspace ───────────────────────────── */}
        <section id="features" className="py-28 bg-body relative">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto mb-16 space-y-3">
              <Eyebrow light={true}>One Workspace</Eyebrow>
              <h2 className="text-3xl sm:text-5xl font-extrabold text-slate-900 tracking-tight font-display">
                Google Business Profile and the Whole SEO Process, Together
              </h2>
              <p className="text-lg text-slate-500 leading-relaxed">
                Manage each client's Google profile, reviews and local rankings, and run their website SEO, keywords, content, competitors and reports, all in one place.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
              {FEATURE_GROUPS.map((g) => {
                const Icon = g.icon;
                return (
                  <div key={g.title} className="p-6 rounded-3xl bg-white border border-slate-200 hover:border-indigo-300 transition-all duration-200 shadow-sm hover:shadow-md flex flex-col">
                    <div className="flex items-center justify-between mb-4 gap-2">
                      <div className={`w-11 h-11 rounded bg-gradient-to-br ${g.accent} flex items-center justify-center text-white shadow-md`}>
                        <Icon size={20} />
                      </div>
                      <span className="text-10.5 font-bold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-200 text-right">{g.badge}</span>
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 mb-1.5 font-display">{g.title}</h3>
                    <p className="text-13.5 text-slate-500 leading-relaxed mb-4">{g.desc}</p>
                    <ul className="space-y-2 text-13 text-slate-600">
                      {g.points.map(pt => (
                        <li key={pt} className="flex items-start gap-2">
                          <CheckCircle2 size={14} className="text-indigo-500 shrink-0 mt-0.5" />
                          <span>{pt}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── 5. Comparison: Manual Agency vs bevisibe AI ─────────────── */}
        <section className="py-28 bg-white border-y border-slate-200 relative overflow-hidden">
          <div className="absolute -top-40 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[130px] pointer-events-none" />
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
            <div className="text-center max-w-3xl mx-auto mb-20 space-y-3">
              <Eyebrow light={true}>The Competitive Shift</Eyebrow>
              <h2 className="text-3xl sm:text-5xl font-extrabold text-slate-900 tracking-tight leading-tight font-display">
                Stop Juggling Separate Tools for Every Client
              </h2>
              <p className="text-slate-500 text-lg">
                Profile edits in one place, rankings in another, reports in a spreadsheet. Bring it into one workspace.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
              {/* Old Traditional Way */}
              <div className="p-8 sm:p-10 rounded-3xl bg-white border border-slate-200 backdrop-blur-md flex flex-col justify-between">
                <div>
                  <div className="text-xs font-bold   text-rose-600 mb-2">Separate Tools</div>
                  <h3 className="text-2xl font-bold text-slate-800 mb-6 font-display">Scattered Work, Slow Reporting</h3>
                  <ul className="space-y-4 text-15 text-slate-500">
                    {[
                      'Logging in to each Google account separately to edit a profile',
                      'One tool for rankings, another for audits, another for reviews',
                      'Review replies written from scratch, days late',
                      'Finding a ranking drop only after calls fall',
                      'Reports assembled by hand each month'
                    ].map(point => (
                      <li key={point} className="flex items-start gap-3.5">
                        <XCircle size={19} className="text-rose-500 shrink-0 mt-0.5" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* The bevisibe AI Way */}
              <div className="p-8 sm:p-10 rounded-3xl bg-gradient-to-br from-indigo-50 via-white to-blue-50 border border-indigo-200 backdrop-blur-md shadow-2xl shadow-indigo-500/20 flex flex-col justify-between">
                <div>
                  <div className="text-xs font-bold   text-indigo-600 mb-2">The bevisibe Workspace</div>
                  <h3 className="text-2xl font-bold text-slate-900 mb-6 font-display">One Place for Every Client</h3>
                  <ul className="space-y-4 text-15 text-slate-800">
                    {[
                      'Every client\'s Google profile, reviews and rankings in one workspace',
                      'Profile edits, photos and posts sent to Google when you save',
                      'Routine tasks, such as positive-review replies and the weekly post, run by themselves',
                      'Site audits, keywords, competitors and backlinks alongside the profile',
                      'Client reports with PDF export, plus leads and conversions'
                    ].map(point => (
                      <li key={point} className="flex items-start gap-3.5">
                        <CheckCircle2 size={19} className="text-indigo-500 shrink-0 mt-0.5" />
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
        <section id="how-it-works" className="py-28 bg-body">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-2xl mx-auto mb-20 space-y-3">
              <Eyebrow light={true}>Workflow</Eyebrow>
              <h2 className="text-3xl sm:text-5xl font-extrabold text-slate-900 tracking-tight font-display">
                From Connecting a Client to Reporting Results
              </h2>
              <p className="text-lg text-slate-500 leading-relaxed">
                One workflow for every client, from Google profile to website SEO.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                {
                  num: '01',
                  icon: Building2,
                  title: 'Connect the Client',
                  desc: 'Sign in with the Google account that manages the profile, pick the locations, and map each one to a client workspace.'
                },
                {
                  num: '02',
                  icon: ScanSearch,
                  title: 'Audit Everything',
                  desc: 'Profile health, reviews and rankings, plus a website crawl, keyword and competitor review, all in one report.'
                },
                {
                  num: '03',
                  icon: Wand2,
                  title: 'Optimise from One Place',
                  desc: 'Edit the Google profile, publish posts and photos, write content and fix pages. Profile edits are sent to Google when you save.'
                },
                {
                  num: '04',
                  icon: LineChart,
                  title: 'Run & Report',
                  desc: 'Routine work runs on its own, risky items wait in your approval queue, and the monthly report is built for each client.'
                }
              ].map(step => {
                const Icon = step.icon;
                return (
                  <div key={step.title} className="p-7 rounded-3xl bg-white border border-slate-200 shadow-md flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-5">
                        <div className="w-12 h-12 rounded bg-gradient-to-br from-indigo-500 to-blue-400 text-white font-bold flex items-center justify-center shadow-lg shadow-indigo-500/20">
                          <Icon size={22} />
                        </div>
                        <span className="text-2xl font-black text-slate-700 tracking-tight font-display">{step.num}</span>
                      </div>
                      <h3 className="text-lg font-bold text-slate-900 mb-2 font-display">{step.title}</h3>
                      <p className="text-14 text-slate-500 leading-relaxed">{step.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── 7. Google OAuth Transparency & Data Safety ──────────────── */}
        <section id="security" className="py-28 bg-white border-y border-slate-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto mb-20 space-y-3">
              <Eyebrow light={true}>Security & Compliance</Eyebrow>
              <h2 className="text-3xl sm:text-5xl font-extrabold text-slate-900 tracking-tight font-display">
                How bevisibe Uses & Protects Google Data
              </h2>
              <p className="text-lg text-slate-500 leading-relaxed">
                We operate under zero-trust security architecture and adhere strictly to Google API Services User Data Policy.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              {GOOGLE_ACCESS.map(access => (
                <div key={access.product} className="p-7 rounded-3xl bg-slate-50 border border-slate-200">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-bold text-slate-900 font-display">{access.product}</h3>
                    <ShieldCheck size={20} className="text-indigo-500" />
                  </div>
                  <code className="text-11.5 text-indigo-600 bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1  block w-fit mb-3.5 break-all">
                    {access.scope}
                  </code>
                  <p className="text-14.5 text-slate-600 leading-relaxed mb-3">
                    <strong className="text-slate-900">What we use it for:</strong> {access.use}
                  </p>
                  <p className="text-13.5 text-emerald-600 font-medium flex items-start gap-2 bg-emerald-50 p-3 rounded border border-emerald-200">
                    <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
                    <span>{access.never}</span>
                  </p>
                </div>
              ))}
            </div>

            {/* Google Limited Use Commitment Callout */}
            <div className="p-8 sm:p-10 rounded-3xl bg-white border border-indigo-200 text-slate-600 text-14.5 leading-relaxed">
              <h4 className="text-lg font-bold text-slate-900 mb-2.5 flex items-center gap-2.5 font-display">
                <Shield size={20} className="text-indigo-500" />
                Google Limited Use Compliance Guarantee
              </h4>
              <p className="mb-2">
                bevisibe's use and transfer to any other app of information received from Google APIs adheres to the{' '}
                <a
                  href="https://developers.google.com/terms/api-services-user-data-policy"
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-500 underline font-semibold"
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
                  className="text-indigo-500 underline font-semibold"
                >
                  myaccount.google.com/permissions
                </a>
                . Read our complete <Link to="/privacy" className="text-indigo-500 underline font-semibold">Privacy Policy</Link>.
              </p>
            </div>
          </div>
        </section>

        {/* ── 8. Pricing Matrix ───────────────────────────────────────── */}
        <section id="pricing" className="py-28 bg-body">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-2xl mx-auto mb-20 space-y-3">
              <Eyebrow light={true}>Transparent Investment</Eyebrow>
              <h2 className="text-3xl sm:text-5xl font-extrabold text-slate-900 tracking-tight font-display">
                Plans for Growing Businesses & Agencies
              </h2>
              <p className="text-lg text-slate-500 leading-relaxed">
                Scale your SEO effortlessly. Pick the plan that fits your clients; change it any time.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch">
              {PLANS.map(plan => {
                const popular = plan.popular;
                return (
                  <div
                    key={plan.name}
                    className={`relative p-8 rounded-3xl bg-white border flex flex-col justify-between transition-all ${popular
                      ? 'border-indigo-200 shadow-2xl shadow-indigo-500/20 lg:-translate-y-2 ring-2 ring-indigo-300'
                      : 'border-slate-200 hover:border-slate-200'
                      }`}
                  >
                    {popular && (
                      <span className={`absolute -top-3.5 left-1/2 -translate-x-1/2 text-11 font-extrabold   px-3.5 py-1 rounded-full ${GRADIENT_BTN}`}>
                        Most Popular
                      </span>
                    )}

                    <div>
                      <h3 className="text-2xl font-bold text-slate-900 font-display">{plan.name}</h3>
                      <p className="text-13 text-slate-500 mt-1 min-h-[36px]">{plan.who}</p>

                      <div className="mt-6 mb-7">
                        <span className="text-2xl xl:text-3xl font-extrabold text-slate-900 tracking-tight font-display">{plan.price}</span>
                        {plan.price.startsWith('₹') && <span className="block text-13 text-slate-500 font-medium mt-1">per month</span>}
                      </div>

                      <div className="pt-5 border-t border-slate-200">
                        <div className="text-11 font-bold   text-slate-500 mb-3.5">Included Capabilities:</div>
                        <ul className="space-y-3 text-14 text-slate-600">
                          {plan.includes.map((feature, idx) => (
                            <li key={idx} className="flex items-start gap-2.5">
                              <CheckCircle2 size={16} className="text-indigo-500 shrink-0 mt-0.5" />
                              <span>{feature}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <div className="pt-8 mt-auto">
                      <Link
                        to={startDestination}
                        className={`w-full h-12 inline-flex items-center justify-center rounded text-14 font-bold transition-all ${popular
                          ? `${GRADIENT_BTN}`
                          : 'border border-slate-200 bg-white text-slate-800 hover:bg-slate-100'
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
        <section id="faq" className="py-28 bg-white border-t border-slate-200">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-2xl mx-auto mb-20 space-y-3">
              <Eyebrow light={true}>Answers On Demand</Eyebrow>
              <h2 className="text-3xl sm:text-5xl font-extrabold text-slate-900 tracking-tight font-display">
                Frequently Asked Questions
              </h2>
              <p className="text-lg text-slate-500">
                Everything you need to know about what is included, how Google data is used, and agency features.
              </p>
            </div>

            <div className="divide-y divide-slate-200 border border-slate-200 rounded-3xl bg-white shadow-xl overflow-hidden">
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
                      <span className="text-17 font-bold text-slate-900 font-display">{faq.q}</span>
                      <ChevronDown
                        size={20}
                        className={`text-slate-500 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180 text-indigo-500' : ''}`}
                      />
                    </button>
                    {isOpen && (
                      <div className="px-7 sm:px-9 pb-6 text-15 text-slate-600 leading-relaxed animate-fadeIn">
                        {faq.a}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-10 text-center text-14.5 text-slate-500">
              Have a custom agency requirement?{' '}
              <a href={SITE.email ? `mailto:${SITE.email}` : undefined} className="text-indigo-500 font-bold hover:underline">
                Contact our engineering team
              </a>
            </div>
          </div>
        </section>

        {/* ── 10. Bottom Conversion Banner ────────────────────────────── */}
        <section className="py-24 bg-body">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="relative rounded-3xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-blue-500 p-9 sm:p-16 text-white overflow-hidden shadow-2xl shadow-indigo-500/20">
              <div className="absolute -right-20 -bottom-20 w-96 h-96 rounded-full bg-white/20 blur-3xl pointer-events-none" />
              <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
                <div className="lg:col-span-8 space-y-4">
                  <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-white/20 text-white text-xs font-bold backdrop-blur-md">
                    <Sparkles size={14} className="text-white" />
                    <span>Manage every client's Google profile in one place</span>
                  </div>
                  <h2 className="text-3xl sm:text-5xl font-black tracking-tight leading-tight font-display text-white">
                    Ready to Manage Every Client's Google Profile and SEO in One Place?
                  </h2>
                  <p className="text-white/90 text-base sm:text-lg max-w-2xl font-medium">
                    Connect a Google account, add a client, and see their profile, reviews, rankings and site health together.
                  </p>
                </div>
                <div className="lg:col-span-4 flex flex-col sm:flex-row lg:flex-col gap-3 justify-center lg:items-end">
                  <Link
                    to={startDestination}
                    className="h-14 px-8 inline-flex items-center justify-center gap-2 rounded text-16 font-black bg-white text-indigo-600 hover:bg-indigo-50 shadow-xl transition-all"
                  >
                    <span>{signedIn ? 'Open Command Center' : 'Get Started'}</span>
                    <ArrowRight size={17} />
                  </Link>
                  <span className="text-12.5 text-white/90 font-semibold text-center lg:text-right">
                    Sign in to get started
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── 11. Enterprise Footer ─────────────────────────────────────── */}
      <footer className="bg-white border-t border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10">
            {/* Column 1: Brand Info */}
            <div className="lg:col-span-2 space-y-4">
              <Logo light={false} iconSize="w-14 h-14" textSize="text-3xl" />
              <p className="text-14 text-slate-500 leading-relaxed max-w-sm">
                Google Business Profile management and the complete SEO process: local rankings, site audits, keywords, content, competitors and reports.
              </p>
              <div className="text-13 text-slate-500">
                A product of <strong className="text-slate-800">{SITE.company}</strong>.
              </div>
            </div>

            {/* Column 2: Product */}
            <div>
              <div className="text-13 font-bold   text-slate-800 mb-4 font-display">
                Platform
              </div>
              <ul className="space-y-2.5 text-14 text-slate-500">
                <li><a href="#features" className="hover:text-indigo-500 transition-colors">Local Rank Tracking</a></li>
                <li><a href="#features" className="hover:text-indigo-500 transition-colors">Google Profile Manager</a></li>
                <li><a href="#features" className="hover:text-indigo-500 transition-colors">Reviews & Reputation</a></li>
                <li><a href="#features" className="hover:text-indigo-500 transition-colors">Site Audit & SEO Tools</a></li>
                <li><a href="#pricing" className="hover:text-indigo-500 transition-colors">Pricing Plans</a></li>
              </ul>
            </div>

            {/* Column 3: Legal & Compliance */}
            <div>
              <div className="text-13 font-bold   text-slate-800 mb-4 font-display">
                Legal & Safety
              </div>
              <ul className="space-y-2.5 text-14 text-slate-500">
                <li><Link to="/privacy" className="hover:text-indigo-500 transition-colors">Privacy Policy</Link></li>
                <li><Link to="/terms" className="hover:text-indigo-500 transition-colors">Terms of Service</Link></li>
                <li><a href="#security" className="hover:text-indigo-500 transition-colors">Google Limited Use</a></li>
                <li><a href="#security" className="hover:text-indigo-500 transition-colors">Security Architecture</a></li>
              </ul>
            </div>

            {/* Column 4: Contact & Access */}
            <div>
              <div className="text-13 font-bold   text-slate-800 mb-4 font-display">
                Connect
              </div>
              <ul className="space-y-2.5 text-14 text-slate-500">
                {SITE.email && (
                  <li>
                    <a href={`mailto:${SITE.email}`} className="hover:text-indigo-500 transition-colors flex items-center gap-1.5 break-all">
                      <Mail size={14} className="shrink-0" />
                      <span>{SITE.email}</span>
                    </a>
                  </li>
                )}
                {SITE.address && <li className="text-slate-500 text-13">{SITE.address}</li>}
                <li className="pt-2">
                  <Link
                    to={startDestination}
                    className="inline-flex items-center gap-1.5 text-indigo-500 font-semibold text-13.5 hover:underline"
                  >
                    <span>{signedIn ? 'Access Dashboard' : 'Sign In to Account'}</span>
                    <ArrowRight size={13} />
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-14 pt-8 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4 text-12.5 text-slate-500">
            <span>© {new Date().getFullYear()} {SITE.company}. All rights reserved.</span>
            <span>{SITE.name} is not affiliated with or endorsed by Google LLC.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
