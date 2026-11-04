import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, ChevronRight } from 'lucide-react';
import { SIDEBAR_SECTIONS } from '../components/sidebarGroups';
import { useCrumbLabel } from './crumbs';

const split = (to) => { const [path, query = ''] = to.split('?'); return [path, new URLSearchParams(query).get('tab')]; };

/** The page's place in the app: Home › the sidebar section › the page › (the tab or view it is showing). Read from the sidebar's own map. */
export default function Breadcrumbs({ title }) {
  const { pathname, search } = useLocation();
  const sub = useCrumbLabel();
  const tab = new URLSearchParams(search).get('tab');
  let group = null; // the rail section that holds this page (the first, when several do)
  let item = null;
  for (const sec of SIDEBAR_SECTIONS) {
    const hits = sec.groups.flatMap(g => g.items).filter(i => { const [p] = split(i.to); return p === pathname; });
    if (hits.length) { group = { title: sec.title, items: sec.groups[0].items }; item = hits.find(i => split(i.to)[1] === tab) || hits.find(i => !split(i.to)[1]) || hits[0]; break; }
  }
  const trail = [{ label: 'Home', to: '/dashboard', home: true }];
  if (group) trail.push({ label: group.title, to: group.items[0].to });
  trail.push({ label: item?.label || title, to: sub ? `${pathname}${search}` : null });
  if (sub && sub !== (item?.label || title)) trail.push({ label: sub, to: null });
  if (pathname === '/dashboard' || trail.length < 2) return null;
  return (
    <nav aria-label="Breadcrumb" className="mb-1.5">
      <ol className="flex flex-wrap items-center gap-1 text-12.5 text-slate-500">
        {trail.map((c, i) => (
          <li key={`${c.label}-${i}`} className="inline-flex items-center gap-1">
            {i > 0 && <ChevronRight size={12} className="text-slate-300" aria-hidden="true" />}
            {c.to && i < trail.length - 1
              ? <Link to={c.to} className="inline-flex items-center gap-1 hover:text-indigo-600 hover:underline">{c.home && <Home size={12} />}{c.label}</Link>
              : <span aria-current={i === trail.length - 1 ? 'page' : undefined} className={i === trail.length - 1 ? 'font-semibold text-slate-800' : ''}>{c.label}</span>}
          </li>))}
      </ol>
    </nav>
  );
}
