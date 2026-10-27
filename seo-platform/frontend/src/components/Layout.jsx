import React, { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard, Workflow, Store, Star, Grid3x3, Search, PenLine, ScanSearch, Link2,
  Sparkles, FileBarChart, Bot, Globe, Plug, Users, LogOut, Menu, X
} from 'lucide-react';

export const NAV = [
  { to: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { to: '/automation-pipeline', label: 'Automation Pipeline', icon: Workflow },
  { to: '/gmb-profile', label: 'GBP Manager', icon: Store },
  { to: '/reviews', label: 'Reviews', icon: Star },
  { to: '/rank-tracking', label: 'Local Rank Grid', icon: Grid3x3 },
  { to: '/keyword-management', label: 'Keyword Research', icon: Search },
  { to: '/ai-content-generation', label: 'AI Content Studio', icon: PenLine },
  { to: '/website-audit', label: 'Site Audit', icon: ScanSearch },
  { to: '/off-page-seo', label: 'Backlinks & Citations', icon: Link2 },
  { to: '/geo-optimization', label: 'GEO / AEO Tracker', icon: Sparkles },
  { to: '/reports', label: 'Reports & Leads', icon: FileBarChart },
  { to: '/automation', label: 'AI Agent', icon: Bot },
  { to: '/website-builder', label: 'Website Builder', icon: Globe },
  { to: '/google-integrations', label: 'Connections & Plans', icon: Plug }
];

const linkCls = ({ isActive }) => `flex items-center gap-2.5 px-3 h-9 rounded text-[13px] ${isActive ? 'bg-white/10 text-white font-medium' : 'text-gray-300 hover:bg-white/5 hover:text-white'}`;

export default function Layout({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const nav = user.is_admin ? [...NAV, { to: '/users', label: 'Users', icon: Users }] : NAV;

  return (
    <div className="min-h-screen flex">
      {open && <div className="fixed inset-0 bg-black/30 z-30 lg:hidden" onClick={() => setOpen(false)} />}
      <aside className={`fixed lg:sticky top-0 z-40 h-screen w-60 shrink-0 bg-codigix-navy flex flex-col transition-transform ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="h-14 px-4 flex items-center justify-between border-b border-white/10">
          <div className="text-white font-semibold text-[15px]">SEO Platform</div>
          <button className="lg:hidden text-gray-300" onClick={() => setOpen(false)} aria-label="Close menu"><X size={18} /></button>
        </div>
        <nav className="flex-1 overflow-y-auto no-scrollbar p-2 space-y-0.5">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={linkCls} onClick={() => setOpen(false)}>
              <Icon size={15} /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-white/10">
          <div className="text-[13px] text-white truncate">{user.name}</div>
          <div className="text-[12px] text-gray-400 truncate">{user.email}</div>
          <button onClick={onLogout} className="mt-2 w-full h-8 inline-flex items-center justify-center gap-1.5 rounded border border-white/15 text-[12px] text-gray-200 hover:bg-white/5 cursor-pointer">
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <div className="lg:hidden h-12 px-4 flex items-center gap-3 bg-white border-b border-gray-200">
          <button onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={18} /></button>
          <span className="text-[14px] font-semibold">SEO Platform</span>
        </div>
        <Outlet />
      </main>
    </div>
  );
}
