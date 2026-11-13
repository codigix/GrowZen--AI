import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp, ArrowDown, Search, MapPin, CheckCircle2, ExternalLink } from 'lucide-react';
import { Card, Badge, Stat, ErrorNote, SkList } from './SeoUi';
import { useApi } from './seoApi';
import Tip from './Tip';

const TONE = { working: 'green', climbing: 'amber', weak: 'red', invisible: 'gray', unchecked: 'gray' };
const FILTERS = [['all', 'All'], ['working', 'Working'], ['climbing', 'Can climb'], ['weak', 'Weak'], ['invisible', 'Not showing'], ['unchecked', 'Not checked']];
const AREA_SHORT = { website: 'Website', blog: 'Blog', gmb_post: 'Posts', aeo: 'AEO', geo: 'GEO', chatgpt: 'ChatGPT' };
const TH = 'px-3 py-2.5 font-semibold whitespace-nowrap text-left';
const n0 = (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN'));
const path = (u) => { try { return new URL(u).pathname || '/'; } catch { return u; } };

/** Every tracked keyword in one table: where it ranks now, what it earns, where it is used, whether it is worth pushing, and what to do next. */
export default function KeywordStatus({ b }) {
  const r = useApi(`/businesses/${b.id}/keywords/status`);
  const [f, setF] = useState('all');
  const [q, setQ] = useState('');
  const d = r.data;
  const rows = useMemo(() => (d ? d.items.filter(x => (f === 'all' || x.status === f) && (!q.trim() || x.keyword.includes(q.trim().toLowerCase()))) : []), [d, f, q]);
  if (r.error) return <Card><ErrorNote>{r.error.message}</ErrorNote></Card>;
  if (!d) return <SkList rows={6} />;
  if (!d.total) return <Card><p className="py-8 text-center text-13 text-slate-500">No keywords are tracked yet. Save some in <Link to="/keyword-management/ai" className="font-semibold text-indigo-600 hover:underline">Find Keywords</Link>, and their status appears here.</p></Card>;
  const c = d.counts;
  const pill = (on) => `h-8 px-3 rounded-full text-12 font-semibold cursor-pointer ring-1 ring-inset ${on ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <Card title="How your keywords are doing" subtitle="Positions are Google Search Console's average position over the last 28 days. Impressions and clicks are real; “potential” is modelled."
        action={<Link to="/rank-tracking/positions" className="text-12.5 font-semibold text-indigo-600 hover:underline">Check positions now →</Link>}>
        {!d.rank_ready && <p className="text-13 text-amber-700 mb-3">Positions need the Google account that owns this website linked to the project (Integrations). Until then only usage is shown.</p>}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
          <Stat label="Tracked" value={d.total} /><Stat label="Working" value={c.working} hint="Page 1 with clicks" /><Stat label="Can climb" value={c.climbing} /><Stat label="Weak" value={c.weak} />
          <Stat label="Not showing" value={c.invisible} /><Stat label="Impressions" value={n0(d.impressions)} /><Stat label="Clicks" value={n0(d.clicks)} />
        </div>
      </Card>
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-slate-100">
          {FILTERS.map(([id, label]) => <button key={id} type="button" aria-pressed={f === id} onClick={() => setF(id)} className={pill(f === id)}>{label} <span className="opacity-70">{id === 'all' ? d.total : c[id]}</span></button>)}
          <label className="relative ml-auto"><Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search keywords" aria-label="Search keywords" className="h-8 w-52 pl-8 pr-3 text-13 rounded-lg ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none" /></label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-13">
            <thead className="bg-slate-50 text-12 uppercase tracking-wide text-slate-500"><tr>
              <th className={TH}>Keyword</th><th className={TH}>Status</th><th className={`${TH} text-right`}>Position</th><th className={`${TH} text-right`}>Impressions</th><th className={`${TH} text-right`}>Clicks</th>
              <th className={`${TH} text-right`}><Tip text="Searches per month for this keyword (Google Keyword Planner)." align="right">Searches</Tip></th>
              <th className={`${TH} text-right`}><Tip text="Modelled, not measured: monthly searches times the usual click-through of the top spot, minus the clicks you already get. It shows how much the keyword could still give." align="right">Potential / mo</Tip></th>
              <th className={TH}>Where it is used</th><th className={TH}>Page</th><th className={TH}>Next step</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(x => (
                <tr key={x.keyword} className="hover:bg-slate-50 align-middle">
                  <td className="px-3 py-3 max-w-[220px]"><span className="block font-semibold text-slate-900 truncate" title={x.keyword}>{x.keyword}</span><span className="text-11.5 text-slate-400">{[x.intent, x.cluster].filter(Boolean).join(' · ') || ' '}{x.articles ? ` · ${x.articles} blog${x.articles > 1 ? 's' : ''}` : ''}</span></td>
                  <td className="px-3 py-3"><Tip text={x.why} wide><Badge tone={TONE[x.status]}>{x.label}</Badge></Tip></td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">{x.rank != null ? <span className="font-bold tabular-nums">{x.rank}</span> : <span className="text-slate-300">—</span>}
                    {x.change ? <span className={`ml-1 inline-flex items-center text-11.5 ${x.change > 0 ? 'text-emerald-600' : 'text-red-600'}`}>{x.change > 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}{Math.abs(x.change)}</span> : null}
                    {x.maps_rank ? <Tip text={`Google Maps: #${x.maps_rank}`}><span className="ml-1 inline-flex align-middle text-slate-400"><MapPin size={11} /></span></Tip> : null}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{n0(x.impressions)}</td><td className="px-3 py-3 text-right tabular-nums font-semibold">{n0(x.clicks)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">{n0(x.volume)}</td><td className="px-3 py-3 text-right tabular-nums text-slate-600">{x.potential == null ? '—' : n0(x.potential)}</td>
                  <td className="px-3 py-3 max-w-[200px]">{x.used_in.length ? <span className="flex flex-wrap gap-1">{x.used_in.map(a => <span key={a} className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-11.5"><CheckCircle2 size={10} />{AREA_SHORT[a] || a}</span>)}</span>
                    : <Link to="/keyword-management/use" className="text-12 font-semibold text-amber-700 hover:underline">Not used yet</Link>}</td>
                  <td className="px-3 py-3 max-w-[170px]">{x.ranking_url ? <a href={x.ranking_url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline inline-flex items-center gap-1 max-w-full"><span className="truncate">{path(x.ranking_url)}</span><ExternalLink size={11} className="shrink-0" /></a>
                    : x.target_url ? <span className="text-slate-500 truncate block" title={x.target_url}>target {x.target_url}</span> : <Link to="/keyword-management/tracked" className="text-12 text-amber-700 hover:underline">No page set</Link>}</td>
                  <td className="px-3 py-3"><Link to={x.next.to} className="text-12.5 font-semibold text-indigo-600 hover:underline">{x.next.text}</Link></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={10} className="px-5 py-10 text-center text-slate-500">No keyword matches.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="px-5 py-3 border-t border-slate-100 text-11.5 text-slate-400">Status is our plain-rule reading of the real position and clicks: Working = page 1 with clicks; Can climb = page 1 without clicks, or page 2; Weak = page 3 or later; Not showing = no impressions in 28 days. “Where it is used” is read from your website crawl, blogs, Google posts, AI questions and ChatGPT profile.</p>
      </Card>
    </div>
  );
}
