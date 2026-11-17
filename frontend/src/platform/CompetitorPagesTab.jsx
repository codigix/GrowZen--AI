import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { Card, Badge, ErrorNote, SkList } from './SeoUi';
import { useApi } from './seoApi';

const n0 = (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN'));

/** The competitors' pages that are in Google's top 10 for the project's keywords, with an estimate of the visits they bring, beside the same estimate for the project. */
export default function CompetitorPagesTab({ b }) {
  const r = useApi(`/businesses/${b.id}/competitor-pages`);
  const [params] = useSearchParams();
  const focus = (params.get('competitor') || '').replace(/^www\./, '').toLowerCase(); // opened from Competitor Watch: only that competitor
  const d = r.data;
  if (r.error) return <Card><ErrorNote>{r.error.message}</ErrorNote></Card>;
  if (!d) return <SkList rows={5} />;
  if (!d.available) return <Card title="Competitor traffic and top pages"><p className="py-6 text-13 text-slate-600">{d.reason} <button type="button" className="font-semibold text-indigo-700 hover:underline cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>Run it from the top of this page.</button></p></Card>;
  const top = Math.max(1, d.you.visits, ...d.competitors.map(c => c.est_visits));
  const shown = focus ? d.competitors.filter(c => c.domain.replace(/^www\./, '').toLowerCase() === focus) : d.competitors;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <Card title="Estimated organic visits per month" subtitle={`From ${d.keywords} researched keywords. ${d.note}`}>
        {!d.volumes && <p className="mb-3 text-12.5 text-amber-700">Google Ads is not connected, so there are no search volumes and the visit estimates are 0. The pages are still listed.</p>}
        <div className="space-y-2.5">
          {[{ domain: 'You', est_visits: d.you.visits, keywords_top10: d.you.keywords, me: true }, ...shown].map(c => (
            <div key={c.domain} className="flex items-center gap-3 text-13">
              <span className={`w-44 truncate font-semibold ${c.me ? 'text-indigo-700' : 'text-slate-800'}`}>{c.domain}</span>
              <div className="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full rounded-full ${c.me ? 'bg-indigo-600' : 'bg-slate-400'}`} style={{ width: `${(c.est_visits / top) * 100}%` }} /></div>
              <span className="w-24 text-right tabular-nums">{n0(c.est_visits)}</span><span className="w-24 text-right text-12 text-slate-500">{c.keywords_top10} in top 10</span>
            </div>))}
        </div>
      </Card>
      {focus && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-indigo-50 ring-1 ring-inset ring-indigo-200 px-4 py-2.5 text-13 text-indigo-900">
          Showing <b>{focus}</b> only.<Link to="/competitor-finder?tab=pages" className="font-semibold underline">Show all competitors</Link>
        </div>
      )}
      {focus && shown.length === 0 && <Card><p className="py-4 text-13 text-slate-600">None of {focus}'s pages is in Google's top 10 for the keywords in the last research. Run the research again with keywords this competitor targets, or look at its pages in Competitor Watch.</p></Card>}
      {shown.map(c => (
        <Card key={c.domain} title={`${c.domain}: top-ranking pages`} subtitle={`${n0(c.est_visits)} estimated visits · ${c.keywords_top10} keywords in the top 10`}>
          <div className="divide-y divide-slate-100">
            {c.top_pages.map(p => (
              <div key={p.url} className="py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <a href={p.url} target="_blank" rel="noreferrer" className="text-13 font-semibold text-indigo-700 hover:underline inline-flex items-center gap-1 break-all">{p.path}<ExternalLink size={11} /></a>
                  <Badge tone="gray">{n0(p.visits)} visits est.</Badge>
                </div>
                {p.title && <div className="text-12 text-slate-500 truncate">{p.title}</div>}
                <div className="mt-1 flex flex-wrap gap-1.5">{p.keywords.map(k => <span key={k.keyword} className="text-11.5 rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{k.keyword} · #{k.position}{k.volume ? ` · ${n0(k.volume)}/mo` : ''}</span>)}</div>
              </div>))}
          </div>
        </Card>))}
      {d.gaps.length > 0 && (
        <Card title="Keyword gaps" subtitle="Competitors rank for these, you do not." action={<Link to="/keyword-management/workspace?tag=gap" className="text-12.5 font-semibold text-indigo-700 hover:underline">Open in the Keyword Workspace</Link>}>
          <div className="divide-y divide-slate-100">{d.gaps.map(g => <div key={g.keyword} className="py-2 flex flex-wrap gap-3 text-13"><span className="font-semibold text-slate-900">{g.keyword}</span><span className="text-slate-500">{g.volume ? `${n0(g.volume)}/mo` : ''}</span><span className="text-slate-500 ml-auto">{g.competitors.join(', ')}</span></div>)}</div>
        </Card>)}
    </div>
  );
}
