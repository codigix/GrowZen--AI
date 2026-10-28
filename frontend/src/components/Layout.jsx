import React, { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Workflow, Store, Star, Search, ScanSearch, Sparkles, FileBarChart, Bot, Globe, Plug, Users,
  LogOut, Menu, X, MapPin, Building2, CalendarDays, Target, Swords, Award, Radar, PanelLeftClose, PanelLeftOpen
} from 'lucide-react';
import { useApi } from '../platform/seoApi';

export const SIDEBAR_GROUPS = [
  {
    title: 'Overview',
    items: [
      { to: '/dashboard', label: 'Command Center', icon: LayoutDashboard },
      { to: '/onboarding', label: 'Business Onboarding', icon: Building2, badge: 'Phase 1' }
    ]
  },
  {
    title: 'SEO Intelligence',
    items: [
      { to: '/website-audit', label: 'Website & On-Page SEO', icon: ScanSearch },
      { to: '/keyword-management', label: 'Keyword Intelligence', icon: Search },
      { to: '/competitor-finder', label: 'Competitor Research', icon: Swords }
    ]
  },
  {
    title: 'Local SEO & Maps',
    items: [
      { to: '/gmb-profile', label: 'GBP Profile Manager', icon: Store },
      { to: '/rank-tracking', label: 'Geo-Grid Rank Tracking', icon: MapPin },
      { to: '/reviews', label: 'Reviews & Reputation', icon: Star },
      { to: '/off-page-seo', label: 'Local Citations & NAP', icon: Award }
    ]
  },
  {
    title: 'AI Growth & Content',
    items: [
      { to: '/ai-content-generation', label: 'AI Blog & Trend Studio', icon: Sparkles, badge: 'AI' },
      { to: '/geo-optimization', label: 'AI Search Visibility', icon: Radar },
      { to: '/content-calendar', label: 'Content Calendar & CMS', icon: CalendarDays },
      { to: '/website-builder', label: 'Website Builder & Slugs', icon: Globe, badge: 'Live' },
      { to: '/automation', label: 'Autonomous AI Agents', icon: Bot },
      { to: '/automation-pipeline', label: 'Automation Pipeline', icon: Workflow }
    ]
  },
  {
    title: 'Business Results',
    items: [
      { to: '/leads', label: 'Leads & Conversions', icon: Target },
      { to: '/reports', label: 'Analytics & Client Reports', icon: FileBarChart }
    ]
  },
  {
    title: 'Administration',
    items: [
      { to: '/google-integrations', label: 'Integrations & APIs', icon: Plug },
      { to: '/users', label: 'Team & Permissions', icon: Users, adminOnly: true }
    ]
  }
];

const BADGE_TONES = {
  AI: 'bg-violet-500/15 text-violet-700 ring-violet-400/25',
  Live: 'bg-emerald-500/15 text-emerald-700 ring-emerald-400/25',
  'Phase 1': 'bg-amber-500/15 text-amber-700 ring-amber-400/25'
};

const COLLAPSE_KEY = 'growzen.sidebar.collapsed';
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch (e) { return false; } };

const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';

const isActivePath = (pathname, to) => pathname === to || (to !== '/dashboard' && pathname.startsWith(`${to}/`));

// Real numbers only: what the backend reports as connected (GET /status).
function useConnections() {
  const { data } = useApi('/status');
  if (!data) return null;
  const checks = [data.ai?.configured, data.google_oauth, data.pagespeed_key, data.dataforseo, data.smtp, data.intake_imap];
  return { connected: checks.filter(Boolean).length, total: checks.length };
}

function NavItem({ to, label, icon: Icon, badge, collapsed, active, onNavigate }) {
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      className={`group relative flex items-center h-9 rounded-lg text-[13px] transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'
        } ${active
          ? 'bg-gradient-to-r from-blue-500/[0.18] to-blue-500/[0.04] text-slate-900 font-medium'
          : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'}`}
    >
      {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-blue-400" aria-hidden="true" />}
      <Icon size={16} strokeWidth={active ? 2.2 : 1.8} className={`shrink-0 transition-colors ${active ? 'text-blue-600' : 'text-slate-500 group-hover:text-slate-700'}`} />
      {!collapsed && <span className="truncate flex-1">{label}</span>}
      {!collapsed && badge && (
        <span className={`shrink-0 text-[10px] font-semibold leading-none px-1.5 py-1 rounded-md ring-1 ring-inset ${BADGE_TONES[badge] || 'bg-slate-500/15 text-slate-700 ring-slate-400/25'}`}>{badge}</span>
      )}
      {collapsed && badge && <span className="absolute top-1.5 right-2.5 w-1.5 h-1.5 rounded-full bg-emerald-400" aria-hidden="true" />}
    </NavLink>
  );
}

export default function Layout({ user, onLogout }) {
  const [open, setOpen] = useState(false); // mobile drawer
  const [collapsed, setCollapsed] = useState(readCollapsed); // desktop icon rail
  const location = useLocation();
  const connections = useConnections();
  const rail = collapsed && !open; // the mobile drawer always shows labels
  const mainRef = useRef(null);

  useEffect(() => { try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch (e) { /* private mode */ } }, [collapsed]);
  useEffect(() => {
    setOpen(false);
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [location.pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="h-screen flex bg-slate-50 text-slate-900 relative overflow-hidden">
      <div className="ambient-glow-mesh" />
      <div className="fixed inset-0 ai-grid-pattern pointer-events-none z-0" />

      {open && <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 lg:hidden" onClick={() => setOpen(false)} />}

      <aside
        className={`fixed lg:static top-0 bottom-0 left-0 z-50 h-screen shrink-0 flex flex-col bg-white/95 backdrop-blur-xl border-r border-slate-200 transition-[width,transform] duration-300 ease-in-out ${rail ? 'lg:w-[72px]' : 'lg:w-72'
          } w-72 ${open ? 'translate-x-0 shadow-2xl shadow-slate-900/10' : '-translate-x-full lg:translate-x-0'}`}
      >
        {/* Brand */}
        <div className={`h-16 shrink-0 flex items-center border-b border-slate-200 ${rail ? 'justify-center px-2' : 'justify-between px-4'}`}>
          <NavLink to="/dashboard" className="flex items-center gap-2.5 min-w-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60" title="bevisibe AI">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500/15 via-cyan-500/10 to-teal-500/15 ring-1 ring-inset ring-blue-500/20 p-1 flex items-center justify-center shrink-0">
              <img src="/bevisibe-icon.png" alt="bevisibe" className="w-full h-full object-contain" />
            </div>
            {!rail && (
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-slate-900 font-bold text-[15px] tracking-tight font-display leading-tight">
                  bevisibe
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gradient-to-r from-blue-600 to-teal-500 text-white tracking-wider">AI</span>
                </div>
                <p className="text-[11px] text-slate-500 leading-tight truncate">Autonomous Local SEO</p>
              </div>
            )}
          </NavLink>
          {!rail && (
            <button onClick={() => setCollapsed(true)} className="hidden lg:flex p-1.5 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-50 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60" aria-label="Collapse sidebar" title="Collapse sidebar">
              <PanelLeftClose size={16} />
            </button>
          )}
          <button className="lg:hidden p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-50 cursor-pointer" onClick={() => setOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto no-scrollbar px-3 py-4" aria-label="Main">
          {rail && (
            <button onClick={() => setCollapsed(false)} className="hidden lg:flex w-full h-9 mb-3 items-center justify-center rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-50 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60" aria-label="Expand sidebar" title="Expand sidebar">
              <PanelLeftOpen size={16} />
            </button>
          )}
          {SIDEBAR_GROUPS.map((group, gi) => {
            const items = group.items.filter(item => !item.adminOnly || user?.is_admin);
            if (!items.length) return null;
            return (
              <div key={group.title} className={gi ? 'mt-5' : ''}>
                {rail
                  ? gi > 0 && <div className="mx-2 mb-3 border-t border-slate-200" />
                  : <div className="px-3 mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-500">{group.title}</div>}
                <div className="space-y-0.5">
                  {items.map(item => <NavItem key={item.to} {...item} collapsed={rail} active={isActivePath(location.pathname, item.to)} onNavigate={() => setOpen(false)} />)}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Footer: real connection status + account */}
        <div className="shrink-0 border-t border-slate-200 p-3 space-y-2">
          {connections && (
            <NavLink to="/google-integrations" title={rail ? `${connections.connected} of ${connections.total} services connected` : undefined}
              className={`flex items-center rounded-lg h-9 text-[12px] text-slate-500 hover:text-slate-900 hover:bg-slate-50 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${rail ? 'justify-center' : 'gap-2.5 px-3'}`}>
              <span className="relative flex w-2 h-2 shrink-0">
                <span className={`absolute inset-0 rounded-full ${connections.connected === connections.total ? 'bg-emerald-400' : connections.connected ? 'bg-amber-400' : 'bg-slate-500'}`} />
              </span>
              {!rail && <span className="truncate"><span className="text-slate-800 font-medium tabular-nums">{connections.connected}/{connections.total}</span> services connected</span>}
            </NavLink>
          )}
          <div className={`flex items-center rounded-xl bg-slate-50 ring-1 ring-inset ring-slate-200 ${rail ? 'flex-col gap-2 p-2' : 'gap-3 p-2.5'}`}>
            <div className="w-9 h-9 shrink-0 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-[12px] font-semibold text-white ring-2 ring-white" title={rail ? `${user?.name || ''} · ${user?.role || ''}` : undefined}>
              {initials(user?.name)}
            </div>
            {!rail && (
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-slate-900 truncate">{user?.name || 'Signed in'}</div>
                <div className="text-[11px] text-slate-500 truncate capitalize">{user?.is_admin ? 'Administrator' : user?.role || user?.email}</div>
              </div>
            )}
            <button onClick={onLogout} className="p-2 rounded-lg text-slate-500 hover:text-rose-700 hover:bg-rose-500/10 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60" aria-label="Sign out" title="Sign out">
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      <div ref={mainRef} className="flex-1 min-w-0 flex flex-col h-screen overflow-y-auto relative z-10">
        {/* Mobile header */}
        <header className="lg:hidden h-14 px-4 flex items-center justify-between bg-white/95 backdrop-blur-xl border-b border-slate-200 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button onClick={() => setOpen(true)} className="p-2 -ml-1 text-slate-700 hover:bg-slate-50 rounded-lg cursor-pointer" aria-label="Open navigation menu">
              <Menu size={20} />
            </button>
            <div className="flex items-center gap-2">
              <img src="/bevisibe-icon.png" alt="bevisibe" className="w-7 h-7 object-contain" />
              <span className="font-bold text-[15px] text-slate-900 font-display">bevisibe</span>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gradient-to-r from-blue-600 to-teal-500 text-white tracking-wider">AI</span>
            </div>
          </div>
          <button onClick={onLogout} className="text-[12px] font-medium text-slate-500 hover:text-slate-900 cursor-pointer">Sign out</button>
        </header>

        <main className="flex-1 min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
