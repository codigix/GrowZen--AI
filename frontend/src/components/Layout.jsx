import React, { Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Workflow, Store, Star, Search, ScanSearch, Sparkles, FileBarChart, Bot, Globe, Plug, Users,
  LogOut, Menu, X, KeyRound, MapPin, Building2, CalendarDays, Target, Swords, Award, Radar, PanelLeftClose, PanelLeftOpen,
  TrendingUp, FileText, Columns3, Wand2, Layers, Bookmark, Lightbulb, Link2, Send, Activity
} from 'lucide-react';
import { SIDEBAR_GROUPS, SIDEBAR_SECTIONS } from './sidebarGroups';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../platform/seoApi';
import { SkPage } from '../platform/SeoUi';
import AssistantWidget from './AssistantWidget';
import ErrorBoundary from './ErrorBoundary';

export { SIDEBAR_GROUPS };

const BADGE_TONES = {
  AI: 'bg-indigo-50 text-indigo-600 ring-indigo-100',
  Live: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  'Phase 1': 'bg-amber-50 text-amber-700 ring-amber-100',
  Soon: 'bg-slate-100 text-slate-500 ring-slate-200'
};

const COLLAPSE_KEY = 'growzen.sidebar.collapsed';
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch (e) { return false; } };

const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';

const splitTo = (to) => { const [path, query = ''] = to.split('?'); return [path, new URLSearchParams(query).get('tab')]; };
// One page can carry several entries (?tab=): an entry is active on its own tab; one without a tab, when no sibling claims the current tab.
const isActivePath = (pathname, search, to) => {
  const [path, tab] = splitTo(to);
  if (!(pathname === path || (path !== '/dashboard' && pathname.startsWith(`${path}/`)))) return false;
  const current = new URLSearchParams(search).get('tab');
  if (tab) return current ? current === tab : SIDEBAR_GROUPS.flatMap(g => g.items).find(i => splitTo(i.to)[0] === path)?.to === to;
  if (current && SIDEBAR_SECTIONS.some(sec => sec.groups.some(grp => grp.items.some(i => { const [p, t] = splitTo(i.to); return p === path && t === current; })))) return false; // another entry owns this tab
  return true;
};

// Real numbers only: what the backend reports as connected (GET /status).
function useConnections() {
  const { data } = useApi('/status');
  if (!data) return null;
  const checks = [data.ai?.configured, data.google_oauth, data.pagespeed_key, data.smtp, data.intake_imap];
  return { connected: checks.filter(Boolean).length, total: checks.length };
}

function NavItem({ to, label, icon: Icon, badge, collapsed, active, onNavigate }) {
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      className={`group relative flex items-center h-9 rounded text-14 transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'
        } ${active
          ? 'text-indigo-500 font-semibold bg-indigo-50'
          : 'text-slate-600 hover:text-indigo-500'}`}
    >
      <Icon size={16} strokeWidth={active ? 2.2 : 1.8} className={`shrink-0 transition-colors ${active ? 'text-indigo-500' : 'text-slate-500 group-hover:text-indigo-500'}`} />
      {!collapsed && <span className="truncate flex-1">{label}</span>}
      {!collapsed && badge && (
        <span className={`shrink-0 text-10 font-semibold leading-none px-1.5 py-1 rounded-md ring-1 ring-inset ${BADGE_TONES[badge] || 'bg-slate-500/15 text-slate-700 ring-slate-400/25'}`}>{badge}</span>
      )}
      {collapsed && badge && <span className="absolute top-1.5 right-2.5 w-1.5 h-1.5 rounded-full bg-emerald-400" aria-hidden="true" />}
    </NavLink>
  );
}

export default function Layout({ user, onLogout, onChangePassword, checking = false }) {
  const [open, setOpen] = useState(false); // mobile drawer
  const [collapsed, setCollapsed] = useState(readCollapsed); // desktop: hides the pages panel and keeps the icon rail
  const [picked, setPicked] = useState(null); // the rail section the user opened last
  const location = useLocation();
  const navigate = useNavigate();
  const connections = useConnections();
  const hidePanel = collapsed && !open; // the mobile drawer always shows the panel
  const mainRef = useRef(null);
  const holds = (sec) => sec.groups.some(grp => grp.items.some(i => isActivePath(location.pathname, location.search, i.to)));
  const section = (picked && SIDEBAR_SECTIONS.find(s => s.id === picked && holds(s))) || SIDEBAR_SECTIONS.find(holds) || SIDEBAR_SECTIONS.find(s => s.id === picked) || SIDEBAR_SECTIONS[0];
  const openSection = (sec) => { setPicked(sec.id); setCollapsed(false); if (!holds(sec)) navigate(sec.groups[0].items[0].to); };

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
    <div className="h-screen flex bg-body text-slate-700 relative overflow-hidden">
      <div className="ambient-glow-mesh" />
      <div className="fixed inset-0 ai-grid-pattern pointer-events-none z-0" />

      {open && <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 lg:hidden" onClick={() => setOpen(false)} />}

      <aside className={`fixed lg:static top-0 bottom-0 left-0 z-50 h-screen shrink-0 flex transition-transform duration-300 ease-in-out ${open ? 'translate-x-0 shadow-2xl shadow-slate-900/10' : '-translate-x-full lg:translate-x-0'}`}>
        {/* Rail: the sections */}
        <div className="w-[84px] shrink-0 h-full flex flex-col bg-slate-100 border-r border-slate-200">
          <NavLink to="/dashboard" title="bevisibe AI" className="h-[70px] shrink-0 flex items-center justify-center bg-topbar outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60">
            <span className="w-9 h-9 rounded bg-white p-1 flex items-center justify-center"><img src="/bevisibe-mark.png" alt="bevisibe" className="w-full h-full object-contain" /></span>
          </NavLink>
          <nav className="flex-1 overflow-y-auto no-scrollbar py-2 px-1.5 space-y-1" aria-label="Sections">
            {SIDEBAR_SECTIONS.map(sec => {
              const on = sec.id === section.id;
              const Icon = sec.icon;
              return (
                <button key={sec.id} type="button" onClick={() => openSection(sec)} aria-current={on ? 'true' : undefined} title={sec.title}
                  className={`w-full py-2.5 rounded flex flex-col items-center gap-1 text-11 leading-tight text-center cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 transition-colors ${on ? 'bg-slate-300/70 text-slate-900 font-semibold' : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'}`}>
                  <Icon size={19} strokeWidth={on ? 2.4 : 1.8} />
                  <span className="px-0.5">{sec.label}</span>
                </button>);
            })}
          </nav>
          <button type="button" onClick={() => setCollapsed(c => !c)} aria-label={hidePanel ? 'Show the pages panel' : 'Hide the pages panel'} title={hidePanel ? 'Show the pages panel' : 'Hide the pages panel'}
            className="hidden lg:flex h-11 shrink-0 items-center justify-center border-t border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 cursor-pointer">
            {hidePanel ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </div>

        {/* Panel: this section's pages */}
        <div className={`h-full flex flex-col bg-white border-r border-slate-200 w-60 ${hidePanel ? 'lg:hidden' : ''}`}>
          <div className="h-[70px] shrink-0 px-5 flex items-center justify-between bg-topbar">
            <span className="text-16 font-bold text-white truncate">{section.title}</span>
            <button className="lg:hidden p-1.5 rounded-md text-topbar-item hover:text-white hover:bg-white/10 cursor-pointer" onClick={() => setOpen(false)} aria-label="Close menu"><X size={18} /></button>
          </div>
          <nav className="flex-1 overflow-y-auto no-scrollbar px-3 py-3" aria-label={section.title}>
            {section.groups.map((grp, gi) => {
              const items = grp.items.filter(item => !item.adminOnly || user?.is_admin);
              if (!items.length) return null;
              return (
                <div key={`${grp.title || 'main'}-${gi}`} className={gi ? 'mt-4' : ''}>
                  {grp.title && <div className="px-3 mb-1.5 text-12 text-slate-500">{grp.title}</div>}
                  <div className="space-y-0.5">
                    {items.map(item => {
                      const active = isActivePath(location.pathname, location.search, item.to);
                      return (
                        <NavLink key={item.to} to={item.to} onClick={() => setOpen(false)} aria-current={active ? 'page' : undefined}
                          className={`flex items-center gap-2 min-h-9 px-3 py-1.5 rounded text-14 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 transition-colors ${active ? 'bg-slate-200/80 text-slate-900 font-semibold' : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'}`}>
                          <span className="flex-1 leading-snug">{item.label}</span>
                          {item.badge && <span className={`shrink-0 text-10 font-semibold leading-none px-1.5 py-1 rounded-md ring-1 ring-inset ${BADGE_TONES[item.badge] || 'bg-slate-500/15 text-slate-700 ring-slate-400/25'}`}>{item.badge}</span>}
                        </NavLink>);
                    })}
                  </div>
                </div>);
            })}
          </nav>
        {/* Footer: real connection status + account */}
        <div className="shrink-0 border-t border-slate-200 p-3 space-y-2">
          {connections && (
            <NavLink to="/google-integrations" title={false ? `${connections.connected} of ${connections.total} services connected` : undefined}
              className={`flex items-center rounded-lg h-9 text-12 text-slate-500 hover:text-slate-900 hover:bg-slate-50 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${false ? 'justify-center' : 'gap-2.5 px-3'}`}>
              <span className="relative flex w-2 h-2 shrink-0">
                <span className={`absolute inset-0 rounded-full ${connections.connected === connections.total ? 'bg-emerald-400' : connections.connected ? 'bg-amber-400' : 'bg-slate-500'}`} />
              </span>
              {!false && <span className="truncate"><span className="text-slate-800 font-medium tabular-nums">{connections.connected}/{connections.total}</span> services connected</span>}
            </NavLink>
          )}
          <div className={`flex items-center rounded bg-slate-50 ring-1 ring-inset ring-slate-200 ${false ? 'flex-col gap-2 p-2' : 'gap-3 p-2.5'}`}>
            <div className="w-9 h-9 shrink-0 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-12 font-semibold text-white ring-2 ring-white" title={false ? `${user?.name || ''} · ${user?.role || ''}` : undefined}>
              {checking ? '' : initials(user?.name)}
            </div>
            {!false && (
              <div className="min-w-0 flex-1">
                {checking ? <div className="space-y-1.5"><div className="h-3 w-20 rounded bg-slate-200 animate-pulse" /><div className="h-2.5 w-14 rounded bg-slate-200 animate-pulse" /></div> : (
                  <>
                    <div className="text-13 font-medium text-slate-900 truncate">{user?.name || 'Signed in'}</div>
                    <div className="text-11 text-slate-500 truncate capitalize">{user?.is_admin ? 'Administrator' : user?.role || user?.email}</div>
                  </>
                )}
              </div>
            )}
            <div className="flex items-center gap-0.5">
              {onChangePassword && (
                <button
                  type="button"
                  onClick={onChangePassword}
                  className="p-2 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 cursor-pointer outline-none transition-colors"
                  aria-label="Change password"
                  title="Change password"
                >
                  <KeyRound size={15} />
                </button>
              )}
              <button onClick={onLogout} className="p-2 rounded-lg text-slate-500 hover:text-rose-700 hover:bg-rose-500/10 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60" aria-label="Sign out" title="Sign out">
                <LogOut size={15} />
              </button>
            </div>
          </div>
        </div>
        </div>
      </aside>

      <div ref={mainRef} className="flex-1 min-w-0 flex flex-col h-screen overflow-y-auto relative z-10">
        {/* Mobile header */}
        <header className="lg:hidden h-14 px-4 flex items-center justify-between bg-topbar text-topbar-item sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button onClick={() => setOpen(true)} className="p-2 -ml-1 text-topbar-item hover:text-white rounded-lg cursor-pointer" aria-label="Open navigation menu">
              <Menu size={20} />
            </button>
            <div className="flex items-center gap-2">
              <img src="/bevisibe-mark.png" alt="bevisibe" className="w-7 h-7 object-contain" />
              <span className="font-bold text-15 text-white">bevisibe</span>
              <span className="text-9 font-bold px-1.5 py-0.5 rounded bg-indigo-500 text-white ">AI</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onChangePassword && (
              <button onClick={onChangePassword} className="text-12 font-medium text-topbar-item hover:text-white cursor-pointer flex items-center gap-1">
                <KeyRound size={13} />
                <span>Password</span>
              </button>
            )}
            <button onClick={onLogout} className="text-12 font-medium text-topbar-item hover:text-white cursor-pointer">Sign out</button>
          </div>
        </header>

        <main className="flex-1 min-w-0">
          <ErrorBoundary key={location.pathname}><Suspense fallback={<SkPage />}><Outlet /></Suspense></ErrorBoundary>
        </main>
      </div>
      <AssistantWidget />
    </div>
  );
}
