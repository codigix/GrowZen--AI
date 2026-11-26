import React, { useEffect, useRef, useState } from 'react';
import { Area, AreaChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ExternalLink, Info, Lightbulb, Loader2, RefreshCw } from 'lucide-react';
import { Button, ErrorNote, useAction } from './SeoUi';
import { api, useApi } from './seoApi';

const COLORS = { Ads: '#f59e0b', 'People also ask': '#8b5cf6', 'Local pack': '#14b8a6', 'Knowledge panel': '#2563eb', Videos: '#ef4444', Shopping: '#ec4899', Discussions: '#64748b', 'AI overview': '#0ea5e9' };
const ABOUT = {
  Ads: 'Paid results above or below the organic ones.',
  'People also ask': 'Questions Google shows with expandable answers. Answering them on your page can win a spot.',
  'Local pack': 'The map with three local businesses. Your Google Business Profile competes here, not your website.',
  'Knowledge panel': 'The information box about a brand, person or place.',
  Videos: 'Video results. A video on the topic can earn a place above the text results.',
  Shopping: 'Product listings with prices and images.',
  Discussions: 'Forum and community threads such as Reddit and Quora.',
  'AI overview': "Google's AI answer at the top, with links to the pages it used.",
};
const PERIODS = [['1w', 7], ['1m', 30], ['3m', 90], ['6m', 180]];
const shortDay = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const gsearch = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;

function Spark({ series, color }) {
  if (!series || series.length < 2) return <span className="text-12 text-slate-400">1 read so far</span>;
  return <div className="w-32 h-8"><ResponsiveContainer width="100%" height="100%"><LineChart data={series}><Line type="monotone" dataKey="pct" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>;
}

function Stat({ label, value, sub, tip }) {
  return <div className="rounded-xl bg-white ring-1 ring-slate-200 px-4 py-3" title={tip}><div className="text-13 text-slate-500">{label}</div><div className="text-28 font-bold text-slate-900 tabular-nums leading-tight">{value}</div><div className="text-12 text-slate-500 mt-0.5">{sub}</div></div>;
}

export default function SerpFeaturesTab({ b, keyword }) {
  const [scope, setScope] = useState('keyword');
  const [days, setDays] = useState(90);
  const [busy, error, run] = useAction();
  const q = scope === 'keyword' ? `&keyword=${encodeURIComponent(keyword)}` : '';
  const rep = useApi(`/businesses/${b.id}/seo/serp-features?days=${days}${q}`);
  const d = rep.data;
  const asked = useRef('');
  const read = () => run('scan', async () => {
    await api(`/businesses/${b.id}/seo/serp-features/scan`, { method: 'POST', body: { keywords: scope === 'keyword' ? [keyword] : null }, timeout: 240000 });
    await rep.reload(true);
  });
  // a search with no stored read is read once on arrival (about ten seconds); the whole list waits for the button because it reads every tracked keyword
  useEffect(() => {
    if (scope === 'keyword' && d && d.read === 0 && asked.current !== keyword) { asked.current = keyword; read(); }
  }, [d, scope, keyword]); // eslint-disable-line react-hooks/exhaustive-deps

  const feats = d?.features || [];
  const on = feats.filter(f => f.count > 0);
  const donut = d && d.read ? [{ name: 'With SERP features', value: d.with_features }, { name: 'Without', value: d.read - d.with_features }] : [];
  const lastRead = d?.last_read ? new Date(d.last_read).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
  const multi = (d?.series || []).length > 1;
  const many = scope === 'all';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg ring-1 ring-inset ring-slate-300 overflow-hidden bg-white" role="group" aria-label="Scope">
          {[['keyword', 'This keyword'], ['all', 'All tracked keywords']].map(([k, l]) => <button key={k} type="button" aria-pressed={scope === k} onClick={() => setScope(k)} className={`px-3.5 h-9 text-13 font-medium cursor-pointer ${scope === k ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}
        </div>
        <span className="text-13 text-slate-500">{d ? (many ? `${d.read} of ${d.tracked} tracked keywords read` : d.read ? 'Read from Google' : 'Not read yet') : ''}{lastRead ? ` · last read ${lastRead}` : ''}</span>
        <Button className="ml-auto" variant="primary" icon={RefreshCw} busy={busy === 'scan'} onClick={read} title={many ? 'Reads Google for up to 12 tracked keywords, about 40 seconds' : 'Reads Google for this keyword, about 10 seconds'}>{many ? 'Read tracked keywords now' : 'Read Google now'}</Button>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}

      {!d ? <div className="flex items-center justify-center gap-2 py-14 text-13 text-slate-500"><Loader2 size={16} className="animate-spin" />Loading…</div> : (
        <>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
            <Stat label="Visibility" value={d.visibility != null ? `${d.visibility}%` : '—'} sub="estimate from your positions" tip="Share of searches that click your result, from an average click curve and your Search Console position" />
            <Stat label={many ? 'Keywords' : 'Keyword'} value={d.tracked} sub={many ? `${d.read} read for features` : 'tracked'} />
            <Stat label="Top 3" value={d.top3} sub={`of ${d.tracked} ranking in the first 3`} />
            <Stat label="Top 10" value={d.top10} sub={`of ${d.tracked} on page 1`} />
            <Stat label="Top 100" value={d.top100} sub={`of ${d.tracked} found in Google`} />
          </div>

          <div className="rounded-xl bg-white ring-1 ring-slate-200 p-5">
            <div className="flex flex-wrap items-start gap-3">
              <div><h3 className="text-16 font-semibold text-slate-900">SERP Features</h3><p className="text-13 text-slate-500">How often Google shows special results on {many ? 'your tracked searches' : 'this search'}.</p></div>
              <div className="ml-auto flex gap-1">{PERIODS.map(([l, n]) => <button key={l} type="button" aria-pressed={days === n} onClick={() => setDays(n)} className={`px-2.5 h-7 rounded text-12.5 font-medium cursor-pointer ${days === n ? 'bg-indigo-50 text-indigo-700 underline underline-offset-4' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}</div>
            </div>
            {!d.read ? <p className="py-12 text-center text-13 text-slate-500">{busy === 'scan' ? 'Reading Google…' : 'No results page has been read yet. Press Read Google now.'}</p> : (
              <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)]">
                <div className="flex flex-wrap items-center gap-5">
                  <div className="relative w-44 h-44 shrink-0">
                    <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={donut} dataKey="value" innerRadius={56} outerRadius={78} startAngle={90} endAngle={-270} stroke="none" isAnimationActive={false}><Cell fill="#2563eb" /><Cell fill="#e5e7eb" /></Pie></PieChart></ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center"><div className="text-24 font-bold text-slate-900 tabular-nums">{d.with_pct}%</div><div className="text-12 text-slate-500 leading-tight">with SERP<br />features</div></div>
                  </div>
                  <ul className="flex-1 min-w-[180px] rounded-lg ring-1 ring-slate-200 divide-y divide-slate-100">
                    {feats.map(f => <li key={f.feature} className="flex items-center gap-2 px-3 py-1.5 text-13"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COLORS[f.feature] }} /><span className={f.count ? 'text-slate-800' : 'text-slate-400'}>{f.feature}</span><span className={`ml-auto tabular-nums font-semibold ${f.count ? 'text-slate-900' : 'text-slate-400'}`}>{f.presence}%</span></li>)}
                  </ul>
                </div>
                <div>
                  <div className="flex items-center gap-4 text-12 text-slate-500 mb-1"><span><span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-600 mr-1" />With SERP features</span><span><span className="inline-block w-2.5 h-2.5 rounded-full bg-slate-300 mr-1" />Without</span></div>
                  {multi ? (
                    <div className="h-52"><ResponsiveContainer width="100%" height="100%"><AreaChart data={d.series.map(x => ({ ...x, without: Math.round((100 - x.with) * 10) / 10 }))} margin={{ left: 0, right: 8, top: 6 }}>
                      <CartesianGrid stroke="#e5e7eb" vertical={false} /><XAxis dataKey="day" tickFormatter={shortDay} tick={{ fontSize: 11, fill: '#64748b' }} minTickGap={30} /><YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11, fill: '#64748b' }} width={42} />
                      <Tooltip formatter={(v, n) => [`${v}%`, n === 'with' ? 'With features' : 'Without']} labelFormatter={shortDay} />
                      <Area type="monotone" dataKey="with" stroke="#2563eb" fill="#2563eb" fillOpacity={0.12} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} /><Area type="monotone" dataKey="without" stroke="#cbd5e1" fill="#cbd5e1" fillOpacity={0.15} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                    </AreaChart></ResponsiveContainer></div>
                  ) : <div className="h-52 flex items-center justify-center text-center text-13 text-slate-500 rounded-lg bg-slate-50 px-6">Google has been read on 1 day so far. The trend over time appears here after the next reads on other days: each read is kept, nothing is estimated.</div>}
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden">
              <div className="px-4 pt-4 pb-2"><h3 className="text-15 font-semibold text-slate-900">SERP Features Details</h3></div>
              <div className="overflow-x-auto">
                <table className="w-full text-13">
                  <thead><tr className="text-12 text-slate-500 bg-slate-50/70"><th className="px-4 py-2 text-left font-medium">SERP feature</th><th className="px-3 py-2  font-medium">Presence</th><th className="px-3 py-2  font-medium">Searches</th><th className="px-3 py-2 text-left font-medium">Trend</th><th className="px-3 py-2 text-left font-medium">Examples</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {feats.map(f => (
                      <tr key={f.feature} className={f.count ? '' : 'text-slate-400'}>
                        <td className="px-4 py-2.5"><span className="inline-flex items-center gap-2 font-medium"><span className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[f.feature] }} />{f.feature}</span><div className="text-11.5 text-slate-400 font-normal max-w-[240px]">{ABOUT[f.feature]}</div></td>
                        <td className="px-3 py-2.5  tabular-nums font-semibold">{f.presence != null ? `${f.presence}%` : '—'}</td>
                        <td className="px-3 py-2.5  tabular-nums">{f.count}{d.read ? ` of ${d.read}` : ''}</td>
                        <td className="px-3 py-2.5"><Spark series={f.series} color={COLORS[f.feature]} /></td>
                        <td className="px-3 py-2.5 max-w-[300px]">{f.examples.length ? <ul className="space-y-0.5">{f.examples.slice(0, 3).map(e => <li key={e.text + e.keyword}><a href={gsearch(e.keyword)} target="_blank" rel="noreferrer" title={`Open Google for “${e.keyword}”`} className="text-blue-700 hover:underline inline-flex items-center gap-1 text-12.5"><span className="truncate max-w-[250px]">{e.text}</span><ExternalLink size={11} className="shrink-0" /></a></li>)}</ul> : <span className="text-12 text-slate-400">Not seen</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <aside className="rounded-xl bg-indigo-50/60 ring-1 ring-indigo-100 p-4 self-start">
              <div className="flex items-center gap-2 text-14 font-semibold text-slate-900"><Lightbulb size={16} className="text-indigo-500" />About SERP features</div>
              <p className="mt-2 text-13 text-slate-600">SERP features are the special results around the ten blue links. They take space and clicks from the normal results, and they are also a way to be seen without being first.</p>
              {on.length > 0 && <div className="mt-3 text-13 text-slate-700"><b>What to do here</b>
                <ul className="mt-1 list-disc pl-4 space-y-1 text-12.5 text-slate-600">
                  {on.some(f => f.feature === 'Local pack') && <li>Local pack shows: keep your Google Business Profile complete, with reviews and photos.</li>}
                  {on.some(f => f.feature === 'People also ask') && <li>People also ask shows: add a short answer to those questions on your page.</li>}
                  {on.some(f => f.feature === 'Ads') && <li>Ads show: others pay for this search, so the organic result matters more.</li>}
                  {on.some(f => f.feature === 'AI overview') && <li>AI overview shows: clear, factual answers on your page are more likely to be used.</li>}
                  {on.some(f => f.feature === 'Videos') && <li>Videos show: a short video on the topic can reach this spot.</li>}
                </ul></div>}
              <p className="mt-3 text-12 text-slate-500 flex gap-1.5"><Info size={13} className="shrink-0 mt-0.5" />Presence is the share of read searches where the feature showed. Results can differ a little between reads and places.</p>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
