import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

const STEPS = [
  { id: 'workspace', to: '/keyword-management/workspace', label: 'Keyword Workspace' },
  { id: 'find', to: '/keyword-management/ai', label: 'Find Keywords' },
  { id: 'check', to: '/keyword-overview', label: 'Check One Keyword' },
  { id: 'mine', to: '/keyword-management/tracked', label: 'My Keywords' },
  { id: 'mapping', to: '/keyword-management/mapping', label: 'Keyword Mapping' },
  { id: 'status', to: '/keyword-management/status', label: 'Keyword Status' },
];

/** The keyword pages in order, as one quiet line: where you are and where the other pages are. */
export default function KeywordFlowBar({ at }) {
  return (
    <nav aria-label="Keyword pages" className="mb-2.5 flex flex-wrap items-center gap-x-1 gap-y-1 text-12.5">
      {STEPS.map((s, n) => (
        <React.Fragment key={s.id}>
          {n > 0 && <ChevronRight size={12} className="text-slate-300" aria-hidden="true" />}
          {s.id === at
            ? <span aria-current="page" className="font-semibold text-slate-900 bg-slate-200/70 rounded px-2 py-0.5">{s.label}</span>
            : <Link to={s.to} className="text-slate-500 hover:text-indigo-700 hover:underline px-1">{s.label}</Link>}
        </React.Fragment>
      ))}
    </nav>
  );
}
