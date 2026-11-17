import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useApi } from './seoApi';

const STEPS = [
  { id: 'workspace', to: '/keyword-management/workspace', label: 'Keyword Workspace', hint: 'One list from every place', count: (s) => s.workspace, unit: 'to look at' },
  { id: 'find', to: '/keyword-management/ai', label: 'Find Keywords', hint: 'Search more ideas' },
  { id: 'check', to: '/keyword-overview', label: 'Check One Keyword', hint: 'Searches, cost and related ideas' },
  { id: 'mine', to: '/keyword-management/tracked', label: 'My Keywords', hint: 'Saved and grouped', count: (s) => s.saved, unit: 'saved' },
  { id: 'mapping', to: '/keyword-management/mapping', label: 'Keyword Mapping', hint: 'A page for every keyword' },
  { id: 'status', to: '/keyword-management/status', label: 'Keyword Status', hint: 'How they rank', count: (s) => s.ranking, unit: 'in top 10' },
];
const NEXT = { workspace: 'Pick keywords, then give them a page in My Keywords', find: 'Found something? It is saved to the workspace list too', check: 'Add the ideas you like to the workspace', mine: 'Then give each keyword its page in Keyword Mapping', mapping: 'Then see how they rank in Keyword Status', status: 'Weak or missing? Look for more in the workspace' };

/** The five keyword pages as one path. The same bar sits on each of them, with what is waiting at every step. */
export default function KeywordFlowBar({ b, at }) {
  const sum = useApi(`/businesses/${b.id}/keyword-workspace/summary`).data;
  const i = STEPS.findIndex(s => s.id === at);
  return (
    <div className="mb-5">
      <nav aria-label="Keyword pages" className="bg-white rounded-xl border border-slate-200 shadow-sm p-1.5 flex flex-wrap items-stretch gap-1">
        {STEPS.map((s, n) => {
          const on = s.id === at;
          const c = sum && s.count ? s.count(sum) : null;
          return (
            <Link key={s.id} to={s.to} aria-current={on ? 'page' : undefined} className={`flex-1 min-w-[150px] rounded-lg px-3 py-2 flex items-center gap-2.5 ${on ? 'bg-indigo-600' : 'hover:bg-slate-50'}`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-12 font-bold shrink-0 ${on ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>{n + 1}</span>
              <span className="min-w-0"><span className={`block text-13 font-semibold truncate ${on ? 'text-white' : 'text-slate-800'}`}>{s.label}</span>
                <span className={`block text-11.5 truncate ${on ? 'text-indigo-100' : 'text-slate-500'}`}>{c != null ? `${c} ${s.unit}` : s.hint}</span></span>
            </Link>);
        })}
      </nav>
      {sum && sum.competitors === 0 && at !== 'status' && <p className="mt-2 text-12 text-amber-700">No competitors saved yet, so competitor keywords and gaps are missing. <Link to="/competitor-finder" className="font-semibold underline">Find competitors</Link></p>}
      <p className="mt-2 text-12 text-slate-500 flex flex-wrap items-center gap-1.5">{NEXT[at]}{i >= 0 && i < STEPS.length - 1 && <Link to={STEPS[i + 1].to} className="inline-flex items-center gap-1 font-semibold text-indigo-700 hover:underline">Next: {STEPS[i + 1].label}<ArrowRight size={12} /></Link>}</p>
    </div>
  );
}
