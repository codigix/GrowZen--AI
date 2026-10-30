import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import { Card, Badge, Tabs, ErrorNote } from './SeoUi';

/**
 * The side-by-side result of comparing a competitor's site audit with the business's own (PageSpeed scores,
 * Core Web Vitals, Lighthouse SEO checks, matched pages, keyword and content gaps). Opened from Competitor
 * Research (POST /audit/competitors/compare); the page there runs the audits.
 */

const Chips = ({ items, empty, tone = 'slate' }) => (
  items && items.length ? (
    <div className="flex flex-wrap gap-1.5">
      {items.map(k => <span key={k} className={`px-2.5 py-1 rounded-full text-12.5 border ${tone === 'rose' ? 'bg-rose-50 text-rose-800 border-rose-200' : tone === 'green' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>{k}</span>)}
    </div>
  ) : <p className="text-13 text-slate-500">{empty}</p>
);
const STATUS_TONE = {
  both_pass: ['green', CheckCircle2, 'Both pass'],
  both_fail: ['red', XCircle, 'Both fail'],
  ours_fail_competitor_pass: ['red', AlertTriangle, 'Ground to make up'],
  ours_pass_competitor_fail: ['green', CheckCircle2, 'Our advantage'],
  both_unavailable: ['gray', MinusCircle, 'Not applicable'],
  incomparable: ['gray', MinusCircle, 'Not comparable']
};

function MetricRow({ m }) {
  const better = m.better === 'ours' ? 'text-emerald-700' : m.better === 'competitor' ? 'text-rose-700' : 'text-slate-500';
  return (
    <tr>
      <td className="px-4 py-2.5 text-13 font-medium text-slate-900">{m.label}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-13">{m.ours_display ?? m.ours ?? '—'}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-13">{m.competitor_display ?? m.competitor ?? '—'}</td>
      <td className={`px-3 py-2.5 text-right tabular-nums text-13 font-semibold ${better}`}>
        {m.available ? (m.better === 'tie' ? 'Tie' : m.better === 'ours' ? 'You lead' : 'They lead') : '—'}
      </td>
    </tr>
  );
}

/** The comparison without its own card: inside a modal the modal is the frame. */
const BareShell = ({ note, children }) => <div><p className="text-12.5 text-slate-500 mb-4">{note}</p>{children}</div>;

export function ComparisonResult({ c, bare = false }) {
  const [tab, setTab] = useState('overview');
  if (c.error) return <ErrorNote>{c.error}</ErrorNote>;
  const checks = c.technical_seo?.checks || [];
  const pages = c.pages || {};
  const gaps = c.keywords_and_content_gaps || {};
  const subtitle = `vs ${c.ours?.target || 'your site'} · ${c.ours?.strategy || '?'} audit`;
  const Shell = bare ? BareShell : Card;
  const shellProps = bare ? { note: `${c.competitor?.name || c.competitor?.target} ${subtitle}` } : { title: c.competitor?.name || c.competitor?.target, subtitle };
  return (
    <Shell {...shellProps}>
      {!c.compatibility?.compatible && (
        <div className="mb-4 text-12.5 text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center gap-2">
          <AlertTriangle size={14} className="shrink-0" /> {c.compatibility?.note || 'Strategies differ (mobile vs desktop); scores are not directly comparable.'}
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'overview', label: 'Scores & vitals' },
        { id: 'technical', label: 'Technical SEO', count: checks.length },
        { id: 'pages', label: 'Pages', count: pages.matched?.length || 0 },
        { id: 'keywords', label: 'Keywords & content' }
      ]} />

      {tab === 'overview' && (
        <div className="space-y-5">
          {!c.overall?.available && <p className="text-13 text-slate-500">No PageSpeed data on one side yet.</p>}
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full">
              <thead className="bg-slate-50 text-left text-11  tracking-wide text-slate-500">
                <tr><th className="px-4 py-2 font-semibold">Metric</th><th className="px-3 py-2 font-semibold text-right">You</th><th className="px-3 py-2 font-semibold text-right">Competitor</th><th className="px-3 py-2 font-semibold text-right">Edge</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(c.overall?.scores || []).map(m => <MetricRow key={m.key} m={m} />)}
                {(c.overall?.core_web_vitals || []).map(m => <MetricRow key={m.key} m={m} />)}
              </tbody>
            </table>
          </div>
          {(c.overall?.field_data || []).some(f => f.available) && (
            <div>
              <div className="text-12 font-semibold  tracking-wide text-slate-500 mb-2">Real-user (CrUX field) data</div>
              <div className="flex flex-wrap gap-2">
                {(c.overall.field_data || []).filter(f => f.available).map(f => (
                  <span key={f.key} className="text-12 px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50">{f.label}: <b>{f.ours || '—'}</b> vs <b>{f.competitor || '—'}</b></span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'technical' && (
        <div className="overflow-x-auto">
          {!checks.length ? <p className="text-13 text-slate-500">No Lighthouse SEO checks on one side yet.</p> : (
            <table className="w-full text-13">
              <thead className="bg-slate-50 text-left text-11  tracking-wide text-slate-500">
                <tr><th className="px-4 py-2.5 font-semibold">Check</th><th className="px-3 py-2.5 font-semibold text-center">You</th><th className="px-3 py-2.5 font-semibold text-center">Competitor</th><th className="px-3 py-2.5 font-semibold">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {checks.map(ch => {
                  const [tone, Icon, label] = STATUS_TONE[ch.status] || STATUS_TONE.incomparable;
                  return (
                    <tr key={ch.id}>
                      <td className="px-4 py-2.5 font-medium text-slate-900" title={ch.description}>{ch.title || ch.id}</td>
                      <td className="px-3 py-2.5 text-center text-slate-600">{ch.ours?.status || '—'}</td>
                      <td className="px-3 py-2.5 text-center text-slate-600">{ch.competitor?.status || '—'}</td>
                      <td className="px-3 py-2.5"><Badge tone={tone}><Icon size={11} />{label}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'pages' && (
        <div className="space-y-4">
          <p className="text-12 text-slate-500">{pages.note}</p>
          {!pages.matched?.length ? <p className="text-13 text-slate-500">No matching pages found between the two crawls.</p> : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-13">
                <thead className="bg-slate-50 text-left text-11  tracking-wide text-slate-500">
                  <tr><th className="px-4 py-2.5 font-semibold">Page</th><th className="px-3 py-2.5 font-semibold">Your title</th><th className="px-3 py-2.5 font-semibold">Their title</th><th className="px-3 py-2.5 font-semibold text-right">Words (you / them)</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pages.matched.map(m => (
                    <tr key={m.path}>
                      <td className="px-4 py-2.5  text-12 text-slate-700">{m.path}</td>
                      <td className="px-3 py-2.5 truncate max-w-[220px]" title={m.ours?.title}>{m.ours?.title || '(missing)'}</td>
                      <td className="px-3 py-2.5 truncate max-w-[220px]" title={m.competitor?.title}>{m.competitor?.title || '(missing)'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{m.ours?.word_count ?? '—'} / {m.competitor?.word_count ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 text-12 text-slate-500">
            <span>Pages only you crawled: {pages.unmatched_ours?.length || 0}</span>
            <span>Pages only they crawled: {pages.unmatched_competitor?.length || 0}</span>
          </div>
        </div>
      )}

      {tab === 'keywords' && (
        <div className="space-y-6">
          <div>
            <div className="text-12 font-semibold  tracking-wide text-slate-500 mb-2">On-page keywords (from the crawled content, no external API)</div>
            {gaps.on_page?.available ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <div className="text-12 font-semibold text-emerald-700 mb-1.5">Shared ({gaps.on_page.shared_keywords.length})</div>
                  <Chips items={gaps.on_page.shared_keywords} empty="None in common." />
                </div>
                <div>
                  <div className="text-12 font-semibold text-indigo-700 mb-1.5">Only you emphasise ({gaps.on_page.ours_only_keywords.length})</div>
                  <Chips items={gaps.on_page.ours_only_keywords} empty="Nothing unique to your content." />
                </div>
                <div>
                  <div className="text-12 font-semibold text-rose-700 mb-1.5">Only they emphasise ({gaps.on_page.competitor_only_keywords.length}) — the gap</div>
                  <Chips items={gaps.on_page.competitor_only_keywords} empty="They cover nothing you don't." tone="rose" />
                </div>
              </div>
            ) : (
              <div className="text-13 text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">{gaps.on_page?.reason}</div>
            )}
          </div>

          <div>
            <div className="text-12 font-semibold  tracking-wide text-slate-500 mb-2">Google-search keyword gaps (from Competitor Research)</div>
            {gaps.search?.available ? (
              <div className="space-y-3">
                {gaps.search.note && <p className="text-12 text-slate-500">{gaps.search.note}</p>}
                {!gaps.search.keyword_gaps?.length ? <p className="text-13 text-slate-500">No search keyword gaps found against this competitor.</p> : (
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {gaps.search.keyword_gaps.map(g => (
                      <li key={g.keyword} className="px-4 py-2.5 text-13 flex flex-wrap items-center gap-2">
                        <b className="text-slate-900">{g.keyword}</b>
                        <span className="text-slate-500">· outranked by {g.competitors?.map(x => x.domain).join(', ')}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div className="text-13 text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">{gaps.search?.reason} {gaps.search?.required_source}</div>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}
