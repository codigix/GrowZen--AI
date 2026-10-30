import React from 'react';
import { Loader2, TrendingUp, TrendingDown, Minus, Clock } from 'lucide-react';
import { Card, Badge, Stat, ErrorNote, useSeoBusiness } from './SeoUi';
import { useApi, fmtDate } from './seoApi';

const KIND = { outreach_email: 'Outreach', website_fix: 'Website fix', blog_draft: 'Blog draft', gbp_post: 'Google post', review_reply: 'Review reply', profile_edit: 'Profile edit', removal_request: 'Link removal' };
const TONE = { improved: 'green', flat: 'gray', worse: 'red', unknown: 'gray' };
const ICON = { improved: TrendingUp, flat: Minus, worse: TrendingDown, unknown: Minus };
const CHANGE = {
  avg_rank: ['Average rank', true], ranking_keywords: ['Keywords ranking', false], backlinks: ['Backlinks', false], referring_domains: ['Referring domains', false],
  reviews: ['Reviews', false], avg_rating: ['Rating', false]
};

const Delta = ({ k, v }) => {
  const [label, lowerIsBetter] = CHANGE[k] || [k, false];
  const good = lowerIsBetter ? v < 0 : v > 0;
  return <span className={`text-11 px-1.5 py-0.5 rounded ${v === 0 ? 'bg-gray-100 text-gray-500' : good ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{label} {v > 0 ? '+' : ''}{v}</span>;
};

/** What each action changed 14 and 30 days later: the platform's evidence of what works for this business. */
export default function OutcomesPanel() {
  const [b] = useSeoBusiness();
  const res = useApi(b ? `/businesses/${b.id}/outcomes` : null);
  if (!b) return <Card><div className="py-8 text-center text-13 text-gray-500">Choose a project to see what its actions changed.</div></Card>;
  const d = res.data;
  return (
    <>
      <ErrorNote>{res.error?.message}</ErrorNote>
      {!d ? <div className="py-8 flex justify-center text-gray-400"><Loader2 size={16} className="animate-spin" /></div> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <Stat label="Measured" value={d.summary.measured} hint="actions with a 14 or 30 day result" />
            <Stat label="Waiting" value={d.summary.pending} hint="still inside their window" />
            <Stat label="Moved the right way" value={Object.values(d.summary.by_action).reduce((n, s) => n + s.improved, 0)} />
            <Stat label="Moved the wrong way" value={Object.values(d.summary.by_action).reduce((n, s) => n + s.worse, 0)} />
          </div>
          {Object.keys(d.summary.by_action).length > 0 && (
            <Card className="mb-4" title="What works for this business" subtitle="Results by kind of action">
              <div className="space-y-2">{Object.entries(d.summary.by_action).map(([k, s]) => {
                const n = s.improved + s.flat + s.worse + s.unknown;
                return (
                  <div key={k} className="flex items-center gap-3 text-13">
                    <span className="w-32 text-gray-700">{KIND[k] || k}</span>
                    <div className="flex-1 flex h-2.5 rounded overflow-hidden bg-gray-100">
                      <div style={{ width: `${(s.improved / n) * 100}%`, background: '#1abc9c' }} /><div style={{ width: `${(s.flat / n) * 100}%`, background: '#cbd5e1' }} /><div style={{ width: `${(s.worse / n) * 100}%`, background: '#f1556c' }} />
                    </div>
                    <span className="text-12 text-gray-500 w-36 text-right">{s.improved} better · {s.flat} flat · {s.worse} worse</span>
                  </div>);
              })}</div>
            </Card>
          )}
          <Card title="Before and after" subtitle="Each action is measured again 14 and 30 days later">
            {d.items.length === 0 ? <div className="py-8 text-center text-13 text-gray-500">Nothing to measure yet. When you approve a task or start a removal request, its starting numbers are saved here.</div> : (
              <div className="divide-y divide-gray-100">{d.items.map(o => {
                const Icon = o.verdict ? ICON[o.verdict] : Clock;
                return (
                  <div key={o.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <div className="flex-1 min-w-[240px]">
                      <div className="text-13 text-gray-900">{o.title}</div>
                      <div className="text-12 text-gray-500">{KIND[o.action] || o.action} · after {o.check_days} days · started {fmtDate(o.started_at)}</div>
                    </div>
                    <div className="flex flex-wrap gap-1">{o.change && Object.entries(o.change).map(([k, v]) => <Delta key={k} k={k} v={v} />)}</div>
                    {o.verdict
                      ? <Badge tone={TONE[o.verdict]}><Icon size={11} className="inline mr-1" />{o.verdict === 'unknown' ? 'no data' : o.verdict}</Badge>
                      : <Badge tone="gray"><Icon size={11} className="inline mr-1" />measured {fmtDate(o.due_at)}</Badge>}
                  </div>);
              })}</div>
            )}
            <p className="text-11 text-gray-400 mt-3">{d.summary.note} This is evidence of what moved, not proof of cause.</p>
          </Card>
        </>
      )}
    </>
  );
}
