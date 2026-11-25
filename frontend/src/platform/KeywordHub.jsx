import React, { Suspense, lazy } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SeoShell } from './SeoUi';
import { KeywordMagicBody } from './KeywordMagicTool';
import { KeywordMagic2Body } from './KeywordMagicTool2';

const Overview = lazy(() => import('./SeoToolkit').then(m => ({ default: m.KeywordOverviewBody })));

/** One keyword page: Overview is one keyword in depth (trend, cost, the Google results, questions, ads); Keyword ideas is every idea around it to filter and save. They share the keyword in the address. */
const TABS = [['overview', 'Overview', 'One keyword in depth: searches and trend, cost, competition, the first results on Google, questions and ads'], ['ideas', 'Keyword ideas', 'Every idea around it, with filters, difficulty and save to your workspace'], ['topics', 'Topics', 'Summary cards, global volume, and the ideas grouped into topics'], ['bulk', 'Bulk analysis', 'Paste a list of keywords and get real searches and difficulty for each']];

export function KeywordHubPage() {
  const [params] = useSearchParams();
  const tab = ['ideas', 'topics', 'bulk'].includes(params.get('tab')) ? params.get('tab') : 'overview';
  const rest = Object.fromEntries([...params].filter(([k]) => k !== 'tab' && k !== 'view'));
  return (
    <SeoShell title="Keyword Magic Tool" subtitle="Look at one keyword in depth, then browse every keyword idea around it">
      {(b) => (
        <div className="space-y-4">
          <div className="flex gap-6 border-b border-slate-200" role="tablist">
            {TABS.map(([id, l, hint]) => <Link key={id} role="tab" title={hint} aria-selected={tab === id} replace to={`/keyword-management/magic?${new URLSearchParams({ ...rest, tab: id })}`} className={`-mb-px pb-2.5 text-14 font-medium border-b-2 ${tab === id ? 'border-indigo-600 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{l}</Link>)}
          </div>
          <Suspense fallback={null}>{tab === 'ideas' ? <KeywordMagicBody key={b.id} b={b} /> : tab === 'topics' || tab === 'bulk' ? <KeywordMagic2Body key={`${b.id}${tab}`} b={b} hub={tab} /> : <Overview key={b.id} b={b} />}</Suspense>
        </div>
      )}
    </SeoShell>
  );
}
