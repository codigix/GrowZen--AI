import React from 'react';
import { NavLink } from 'react-router-dom';
import { Globe, TrendingUp, FileText } from 'lucide-react';

const ITEMS = [
  ['/domain-overview', 'Overview', 'Traffic, countries, AI visibility, backlinks', Globe],
  ['/organic-rankings', 'Keyword rankings', 'Where each keyword ranks, movers, SERP features', TrendingUp],
  ['/top-pages', 'Pages', 'Every page: rank, earnings, AI citations, problems', FileText]
];

/** The three views of the site's own Google performance, as one section: the same switcher on each page. */
export default function SearchPerfNav() {
  return (
    <nav aria-label="My search performance" className="flex flex-wrap items-center gap-2">
      <span className="text-12 font-semibold uppercase tracking-wide text-slate-400 mr-1">My search performance</span>
      {ITEMS.map(([to, label, hint, Icon]) => (
        <NavLink key={to} to={to} title={hint} className={({ isActive }) => `h-9 px-3.5 rounded-lg inline-flex items-center gap-2 text-13 font-semibold ring-1 ring-inset ${isActive ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}>
          <Icon size={14} />{label}
        </NavLink>
      ))}
    </nav>
  );
}
