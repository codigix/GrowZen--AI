import React from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDown, ArrowRight, ArrowUp, Info, Lightbulb, Loader2, Minus, Target } from 'lucide-react';
import { useApi } from './seoApi';

const INTENT = { commercial: ['Commercial', '#2563eb'], informational: ['Informational', '#10b981'], navigational: ['Navigational', '#f59e0b'], transactional: ['Transactional', '#8b5cf6'], local: ['Local', '#14b8a6'], unknown: ['Not classified', '#94a3b8'] };
const INTENT_NOTE = {
  commercial: 'mainly commercial, showing strong purchase intent.',
  transactional: 'mainly transactional: people are ready to buy or book.',
  informational: 'mainly informational: people are learning, not buying yet. Blog posts and guides fit.',
  navigational: 'mainly navigational: people look for a specific brand or site.',
  local: 'mainly local: people want a business near them. Your Google Business Profile and local pages matter most.',
  unknown: 'not classified yet.',
};
const LIKELY = { High: 'bg-emerald-100 text-emerald-800', Medium: 'bg-amber-100 text-amber-800', Low: 'bg-slate-100 text-slate-600' };
const FEATURE_COLOR = { Ads: '#f59e0b', 'People also ask': '#8b5cf6', 'Local pack': '#14b8a6', 'Knowledge panel': '#2563eb', Videos: '#ef4444', Shopping: '#ec4899', Discussions: '#64748b', 'AI overview': '#0ea5e9' };
const shortDay = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export function Change({ now, before, unit = '', good = 'up' }) {
  if (before == null || now == null) return <span className="text-12 text-slate-400">no earlier check</span>;
  const d = Math.round((now - before) * 10) / 10;
  if (d === 0) return <span className="inline-flex items-center gap-0.5 text-12.5 text-slate-500"><Minus size={12} />no change</span>;
  const better = good === 'up' ? d > 0 : d < 0;
  return <span className={`inline-flex items-center gap-0.5 text-12.5 font-semibold ${better ? 'text-emerald-600' : 'text-rose-600'}`}>{d > 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}{d > 0 ? '+' : ''}{d}{unit}</span>;
}

export const Tile = ({ label, value, change, tip }) => <div className="rounded-xl bg-white ring-1 ring-slate-200 px-4 py-3" title={tip}><div className="text-13 text-slate-500">{label}</div><div className="text-28 font-bold text-slate-900 tabular-nums leading-tight">{value}</div><div className="mt-0.5">{change}</div></div>;
const Panel = ({ title, tip, children, className = '' }) => <div className={`rounded-xl bg-white ring-1 ring-slate-200 p-4 ${className}`}><h3 className="text-15 font-semibold text-slate-900 flex items-center gap-1.5">{title}{tip && <span title={tip} className="text-slate-400 cursor-help"><Info size={13} /></span>}</h3>{children}</div>;

export default function TrackingInsightsTab({ b, keyword, setTab }) {
  const rep = useApi(`/businesses/${b.id}/seo/tracking-insights?keyword=${encodeURIComponent(keyword)}`);
  const d = rep.data;
  if (!d) return <div className="flex items-center justify-center gap-2 py-14 text-13 text-slate-500"><Loader2 size={16} className="animate-spin" />Loading…</div>;
  if (!d.tracked) return <p className="text-13 text-slate-500">No tracked keywords yet.</p>;

  const top = d.intents[0];
  const intentRows = d.intents.map(i => ({ ...i, name: (INTENT[i.intent] || INTENT.unknown)[0], color: (INTENT[i.intent] || INTENT.unknown)[1] }));
  const max = Math.max(1, ...d.landscape.map(x => x.visibility));
  const lead = d.landscape[0];
  const rank = d.landscape.findIndex(x => x.you) + 1;
  const insights = [
    d.visibility_prev != null && d.visibility != null && d.visibility !== d.visibility_prev ? { up: d.visibility > d.visibility_prev, text: `Your visibility is ${d.visibility > d.visibility_prev ? 'up' : 'down'} by ${Math.abs(Math.round((d.visibility - d.visibility_prev) * 10) / 10)}% since the last check` } : { up: null, text: `Your estimated visibility is ${d.visibility ?? 0}%` },
    d.top3 > 0 ? { up: true, text: `${d.top3} of ${d.tracked} keywords rank in the Top 3` } : { up: false, text: 'No tracked keyword is in the Top 3 yet' },
    d.feature_types > 0 ? { up: true, text: `SERP features appear in ${d.feature_types} type${d.feature_types === 1 ? '' : 's'} on your searches` } : { up: null, text: 'No SERP features were seen on your searches' },
    d.average_position != null ? { up: d.average_position <= 10, text: `Your average position is ${d.average_position}` } : { up: false, text: 'None of your tracked keywords ranks yet' },
    d.not_ranking > 0 ? { up: false, text: `${d.not_ranking} of ${d.tracked} keywords are not ranking in Google yet` } : null,
  ].filter(Boolean);
  const target = d.opportunities.filter(o => !o.yours || o.yours.yes < o.yours.of);

  return (
    <div className="space-y-4">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <Tile label="Visibility" value={d.visibility != null ? `${d.visibility}%` : '—'} change={<Change now={d.visibility} before={d.visibility_prev} unit="%" />} tip="Estimate from your positions and an average click curve" />
        <Tile label="Keywords" value={d.tracked} change={<span className="text-12 text-slate-500">{d.read} read for SERP features</span>} />
        <Tile label="Top 3" value={d.top3} change={<Change now={d.top3} before={d.top3_prev} />} />
        <Tile label="Top 10" value={d.top10} change={<Change now={d.top10} before={d.top10_prev} />} />
        <Tile label="Top 100" value={d.top100} change={<Change now={d.top100} before={d.top100_prev} />} />
      </div>

      <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4">
        <div className="flex items-center gap-3 mb-3"><Lightbulb size={26} className="text-sky-500" /><div><h3 className="text-17 font-semibold text-slate-900">Tracking Insights</h3><p className="text-13 text-slate-500">Key insights about the performance of your {d.tracked} tracked keyword{d.tracked === 1 ? '' : 's'}</p></div></div>
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_0.9fr]">
          <Panel title="Keyword Intent" tip="The search intent of your tracked keywords: what people want when they type them" className="ring-0 !p-3 bg-slate-50/40">
            <div className="mt-2 flex items-center gap-4">
              <div className="relative w-36 h-36 shrink-0">
                <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={intentRows} dataKey="count" innerRadius={44} outerRadius={64} stroke="none" isAnimationActive={false}>{intentRows.map(r => <Cell key={r.intent} fill={r.color} />)}</Pie></PieChart></ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center"><div className="text-12 text-slate-500">{(INTENT[top.intent] || INTENT.unknown)[0]}</div><div className="text-20 font-bold tabular-nums">{top.pct}%</div></div>
              </div>
              <ul className="flex-1 space-y-1.5 text-13">{intentRows.map(r => <li key={r.intent} className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: r.color }} />{r.name}<span className="ml-auto tabular-nums font-semibold">{r.pct}%</span></li>)}</ul>
            </div>
            <div className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-12.5 text-sky-900 flex gap-2"><Info size={14} className="shrink-0 mt-0.5" /><span>Your tracked keywords are {INTENT_NOTE[top.intent] || INTENT_NOTE.unknown}{d.keyword_intent ? ` This keyword is ${(INTENT[d.keyword_intent] || INTENT.unknown)[0].toLowerCase()}.` : ''}</span></div>
          </Panel>

          <Panel title="Competitor Landscape" tip="Estimated visibility of the sites in Google's top 10 on your tracked searches, from the stored reads of Google's results" className="ring-0 !p-3 bg-slate-50/40">
            {d.landscape.length ? (
              <>
                <div className="h-44 mt-2"><ResponsiveContainer width="100%" height="100%"><BarChart data={d.landscape} margin={{ left: -18, right: 4, top: 14 }}>
                  <XAxis dataKey="domain" tick={{ fontSize: 10, fill: '#475569' }} interval={0} tickFormatter={x => (x.length > 12 ? `${x.slice(0, 11)}…` : x)} /><YAxis hide domain={[0, max * 1.15]} />
                  <Tooltip formatter={v => [`${v}%`, 'Visibility']} cursor={{ fill: '#f1f5f9' }} />
                  <Bar dataKey="visibility" radius={[4, 4, 0, 0]} isAnimationActive={false} label={{ position: 'top', fontSize: 11, fill: '#334155', formatter: v => `${v}%` }}>{d.landscape.map(x => <Cell key={x.domain} fill={x.you ? '#2563eb' : x.competitor ? '#f43f5e' : '#cbd5e1'} />)}</Bar>
                </BarChart></ResponsiveContainer></div>
                <p className="text-12.5 text-slate-600">{rank ? `You are number ${rank} of ${d.landscape.length} in visibility` : 'Your site is not visible yet'}{lead && !lead.you ? `; ${lead.domain} leads with ${lead.visibility}%.` : '.'} <span className="text-slate-400">Blue is you, red a saved competitor.</span></p>
              </>
            ) : <p className="mt-4 text-13 text-slate-500">Read Google's results on the SERP Features tab first.</p>}
            <Link to="/competitor-finder" className="mt-2 inline-flex items-center gap-1 text-13 font-semibold text-indigo-600 hover:underline">View competitors <ArrowRight size={13} /></Link>
          </Panel>

          <Panel title="Ranking Insights" tip="Plain statements counted from your positions and the SERP reads" className="ring-0 !p-3 bg-slate-50/40">
            <ul className="mt-3 space-y-3">{insights.map(i => <li key={i.text} className="flex items-start gap-2.5 text-13.5 text-slate-800">{i.up === true ? <ArrowUp size={17} className="text-emerald-600 shrink-0 mt-px" /> : i.up === false ? <ArrowDown size={17} className="text-rose-500 shrink-0 mt-px" /> : <Minus size={17} className="text-slate-400 shrink-0 mt-px" />}{i.text}</li>)}</ul>
          </Panel>

          <div className="rounded-xl ring-1 ring-emerald-200 bg-emerald-50/70 p-4 flex flex-col">
            <div className="flex items-center gap-2 text-15 font-semibold text-slate-900"><Target size={18} className="text-emerald-600" />SERP Opportunities</div>
            <p className="mt-1 text-13 text-slate-600">{target.length ? 'Google shows these features on your searches. Target them to increase visibility:' : 'No feature seen on your searches needs action right now.'}</p>
            <ul className="mt-2 space-y-1.5 flex-1">{target.slice(0, 4).map(o => <li key={o.feature} className="flex items-center gap-2 text-13.5 font-medium text-slate-800"><span className="w-2.5 h-2.5 rounded-full" style={{ background: FEATURE_COLOR[o.feature] }} />{o.feature}<span className="ml-auto text-12 font-normal text-slate-500">{o.presence}% of searches</span></li>)}</ul>
            <button type="button" onClick={() => setTab('SERP Features')} className="mt-3 h-9 rounded-lg bg-blue-600 text-white text-13 font-semibold hover:bg-blue-700 cursor-pointer inline-flex items-center justify-center gap-1.5">View Opportunities <ArrowRight size={14} /></button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Panel title="Visibility Trend" tip="Estimated visibility of your tracked keywords on each day they were checked">
          {d.trend.length > 1 ? (
            <div className="h-56 mt-2"><ResponsiveContainer width="100%" height="100%"><AreaChart data={d.trend} margin={{ left: 0, right: 8, top: 6 }}>
              <CartesianGrid stroke="#e5e7eb" vertical={false} /><XAxis dataKey="day" tickFormatter={shortDay} tick={{ fontSize: 11, fill: '#64748b' }} minTickGap={30} /><YAxis unit="%" tick={{ fontSize: 11, fill: '#64748b' }} width={42} domain={[0, (m) => Math.max(5, Math.ceil(m))]} />
              <Tooltip formatter={v => [`${v}%`, 'Visibility']} labelFormatter={shortDay} /><Area type="monotone" dataKey="visibility" stroke="#2563eb" fill="#2563eb" fillOpacity={0.12} strokeWidth={2} dot={{ r: 3.5 }} isAnimationActive={false} />
            </AreaChart></ResponsiveContainer></div>
          ) : <div className="mt-2 h-56 flex flex-col items-center justify-center rounded-lg bg-slate-50 text-center px-6"><div className="text-26 font-bold text-slate-900">{d.trend[0] ? `${d.trend[0].visibility}%` : '—'}</div><p className="text-13 text-slate-500 mt-1">Checked on 1 day so far ({d.trend[0] ? `${d.trend[0].keywords} keywords` : 'none'}). The trend line appears after checks on other days.</p></div>}
        </Panel>
        <Panel title="SERP Opportunities" tip="Features Google shows on your searches, how likely they are, and whether your site is in them">
          <table className="w-full text-13 mt-2">
            <thead><tr className="text-12 text-slate-500 bg-slate-50"><th className="text-left font-medium px-2 py-1.5">Feature</th><th className="font-medium px-2 py-1.5">Likelihood</th><th className="font-medium px-2 py-1.5">Your presence</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {d.opportunities.map(o => (
                <tr key={o.feature}><td className="px-2 py-2"><span className="inline-flex items-center gap-2 font-medium"><span className="w-2.5 h-2.5 rounded-full" style={{ background: FEATURE_COLOR[o.feature] }} />{o.feature}</span></td>
                  <td className="px-2 py-2 text-center"><span className={`px-2.5 py-0.5 rounded-full text-12 font-semibold ${LIKELY[o.likelihood]}`}>{o.likelihood}</span></td>
                  <td className="px-2 py-2 text-center">{o.yours ? <span className={`px-2.5 py-0.5 rounded-md text-12 font-semibold ${o.yours.yes ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-700'}`}>{o.yours.yes ? `Yes (${o.yours.yes} of ${o.yours.of})` : 'No'}</span> : <span className="text-12 text-slate-400" title="Checking whether your site appears inside this feature is not possible yet">Not checked</span>}</td></tr>
              ))}
              {!d.opportunities.length && <tr><td colSpan={3} className="px-2 py-6 text-center text-slate-500">No SERP features read yet.</td></tr>}
            </tbody>
          </table>
          <button type="button" onClick={() => setTab('SERP Features')} className="mt-2 inline-flex items-center gap-1 text-13 font-semibold text-indigo-600 hover:underline cursor-pointer">View all opportunities <ArrowRight size={13} /></button>
        </Panel>
      </div>
    </div>
  );
}
