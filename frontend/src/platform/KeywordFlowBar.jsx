import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Check } from 'lucide-react';
import { useApi } from './seoApi';

/**
 * The keyword journey in six steps, the same on every keyword page and in the sidebar:
 * find the keywords, choose the ones that fit, decide where each is used, write the content, update the site, track how they do.
 */
export const KEYWORD_STEPS = [
  { n: 1, id: 'find', label: 'Find', to: '/keyword-management/workspace', hint: 'Collect keyword ideas from your website, Google, your competitors and the AI.',
    pages: [['/keyword-management/workspace', 'Keyword Workspace', 'workspace'], ['/keyword-management/ai', 'Find Keywords', 'find'], ['/keyword-overview', 'Check One Keyword', 'check']] },
  { n: 2, id: 'choose', label: 'Choose', to: '/keyword-management/tracked', hint: 'Keep the keywords that fit your business. Each one shows its searches and its Google position.',
    pages: [['/keyword-management/tracked', 'My Keywords']] },
  { n: 3, id: 'where', label: 'Decide where', to: '/keyword-management/mapping', hint: 'For each chosen keyword: which page, FAQ, meta data, blog post or Google post it goes in.',
    pages: [['/keyword-management/mapping', 'Keyword Mapping', 'mapping'], ['/keyword-management/use', 'Usage grid', 'use']] },
  { n: 4, id: 'write', label: 'Write', to: '/ai-content-generation/blog', hint: 'Write the content for the places you chose.',
    pages: [['/ai-content-generation/trends', 'Topic Research'], ['/seo-brief', 'SEO Brief'], ['/ai-content-generation/blog', 'Write Content'], ['/google-posts', 'Google Posts']] },
  { n: 5, id: 'update', label: 'Update', to: '/fix-plan', hint: 'Put the changes on your website and your Google profile.',
    pages: [['/fix-plan', 'Fix Plan'], ['/page-indexing', 'Page Indexing']] },
  { n: 6, id: 'track', label: 'Track', to: '/keyword-management/status', hint: 'See whether the keywords rank and bring visitors.',
    pages: [['/keyword-management/status', 'Keyword Status', 'status'], ['/rank-tracking/landscape', 'Position Tracking'], ['/domain-overview', 'My Search Performance'], ['/search-insights', 'Search Insights']] },
];

// the page a bar is shown on -> its step
const STEP_OF = { workspace: 'find', find: 'find', check: 'find', mine: 'choose', mapping: 'where', use: 'where', status: 'track' };

/** The six steps as one line, with how many there are in the steps that have a count, what the current step is for, and its pages. */
export default function KeywordFlowBar({ b, at }) {
  const sum = useApi(b ? `/businesses/${b.id}/keyword-workspace/summary` : null).data;
  const here = STEP_OF[at] || at;
  const current = KEYWORD_STEPS.find(s => s.id === here) || KEYWORD_STEPS[0];
  const count = { find: sum?.workspace != null ? `${sum.workspace} ideas waiting` : null, choose: sum?.saved != null ? `${sum.saved} chosen` : null, track: sum?.ranking != null ? `${sum.ranking} on page 1` : null };
  return (
    <nav aria-label="Keyword steps" className="mb-4 rounded-xl bg-white ring-1 ring-slate-200 shadow-sm px-3 py-2.5">
      <ol className="flex flex-wrap items-center gap-x-0.5 gap-y-1.5">
        {KEYWORD_STEPS.map((s, i) => {
          const on = s.id === current.id;
          const done = s.n < current.n;
          return (
            <React.Fragment key={s.id}>
              {i > 0 && <ChevronRight size={13} className="text-slate-300 shrink-0" aria-hidden="true" />}
              <li>
                <Link to={s.to} aria-current={on ? 'step' : undefined} title={s.hint}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-13 transition-colors ${on ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-600 hover:bg-slate-100'}`}>
                  <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-11 font-bold ${on ? 'bg-white/25 text-white' : done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{done ? <Check size={12} /> : s.n}</span>
                  {s.label}
                  {count[s.id] && <span className={`text-11 font-medium ${on ? 'text-white/80' : 'text-slate-400'}`}>{count[s.id]}</span>}
                </Link>
              </li>
            </React.Fragment>
          );
        })}
      </ol>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 pt-2 text-12.5">
        <span className="text-slate-600"><b className="text-slate-900">Step {current.n}: {current.label}.</b> {current.hint}</span>
        {current.pages.length > 1 && <span className="flex flex-wrap items-center gap-x-1 ml-auto">{current.pages.map(([to, label, id], i) => (
          <React.Fragment key={to}>{i > 0 && <span className="text-slate-300">·</span>}{id && id === at
            ? <span aria-current="page" className="font-semibold text-slate-900">{label}</span> : <Link to={to} className="text-indigo-700 hover:underline">{label}</Link>}</React.Fragment>))}</span>}
      </div>
    </nav>
  );
}
