import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDown, ArrowUp, CheckCircle2, ExternalLink, Loader2, RefreshCw, X } from 'lucide-react';
import { Button, ErrorNote, useAction, useToast } from './SeoUi';
import { api, useApi } from './seoApi';

const kfmt = (n) => (n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K` : String(Math.round(n)));
const RANGES = [['1M', 30], ['3M', 90], ['6M', 180], ['1Y', 365], ['All time', 3650]];
const TABS = ['Overview', 'SERP Features', 'Competitors', 'Pages', 'Progress'];
const Card = ({ title, children, className = '', action }) => <div className={`rounded-xl bg-white ring-1 ring-slate-200 p-4 ${className}`}>{(title || action) && <div className="flex items-center mb-2"><h3 className="text-15 font-semibold text-slate-900">{title}</h3><div className="ml-auto">{action}</div></div>}{children}</div>;

function Delta({ now, before }) {
  if (!now || !before || now === before) return null;
  const up = now < before; // a lower number is a better position
  return <span className={`inline-flex items-center text-13 font-semibold ${up ? 'text-emerald-600' : 'text-rose-600'}`}>{up ? <ArrowUp size={13} /> : <ArrowDown size={13} />}{Math.abs(now - before)}</span>;
}

function Tile({ label, value, sub, series, color = '#2563eb', tip }) {
  const data = (series || []).map((v, i) => ({ i, v }));
  return (
    <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4 min-w-0" title={tip}>
      <div className="text-13 text-slate-500">{label}</div>
      <div className="flex items-baseline gap-2"><div className="text-28 font-bold text-slate-900 tabular-nums leading-tight">{value}</div>{sub}</div>
      <div className="h-10 -mx-1 mt-1">{data.length > 1 && <ResponsiveContainer width="100%" height="100%"><AreaChart data={data}><Area type="monotone" dataKey="v" stroke={color} fill={color} fillOpacity={0.12} strokeWidth={1.5} isAnimationActive={false} /></AreaChart></ResponsiveContainer>}</div>
    </div>
  );
}

function Trend({ series, range, setRange }) {
  const cut = new Date(Date.now() - range * 864e5).toISOString().slice(0, 10);
  const data = series.filter(s => s.day >= cut && s.rank).map(s => ({ ...s, label: s.day }));
  return (
    <Card title="Ranking Trend" action={<div className="flex gap-1">{RANGES.map(([l, d]) => <button key={l} type="button" aria-pressed={range === d} onClick={() => setRange(d)} className={`px-2.5 h-7 rounded text-12.5 font-medium cursor-pointer ${range === d ? 'bg-indigo-50 text-indigo-700 underline underline-offset-4' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}</div>}>
      {data.length === 0 ? <p className="text-13 text-slate-500 py-10 text-center">No position has been read for this keyword in this period yet. Press Update report.</p> : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ left: 0, right: 12, top: 8 }}>
              <defs><linearGradient id="kpg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2563eb" stopOpacity={0.25} /><stop offset="100%" stopColor="#2563eb" stopOpacity={0.02} /></linearGradient></defs>
              <CartesianGrid stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} minTickGap={30} />
              <YAxis reversed domain={[1, (m) => Math.max(10, Math.ceil(m / 10) * 10)]} tick={{ fontSize: 11, fill: '#64748b' }} width={32} allowDecimals={false} />
              <Tooltip formatter={(v) => [`#${v}`, 'Position']} labelFormatter={d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} />
              <Area type="monotone" dataKey="rank" stroke="#2563eb" strokeWidth={2} fill="url(#kpg)" dot={{ r: 3 }} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

export default function KeywordPosition({ b, keyword }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState('Overview');
  const [range, setRange] = useState(90);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const q = encodeURIComponent(keyword);
  const rep = useApi(`/businesses/${b.id}/seo/keyword-position?keyword=${q}&days=365`);
  const serp = useApi(`/businesses/${b.id}/seo/keyword-position/serp?keyword=${q}`);
  const tracked = useApi(`/businesses/${b.id}/keywords`);
  const list = (tracked.data?.keywords || []).map(k => k.keyword);
  const d = rep.data;
  const s = d?.summary || {};
  const series = d?.series || [];
  const inRange = useMemo(() => series.filter(x => x.day >= new Date(Date.now() - range * 864e5).toISOString().slice(0, 10)), [series, range]);

  const update = () => run('update', async () => {
    await api(`/businesses/${b.id}/seo/check-ranks`, { method: 'POST', body: { keywords: [keyword] }, timeout: 120000 });
    await rep.reload(true); serp.reload(true);
    toast(`Position of “${keyword}” updated from Google Search Console`);
  });
  const go = (k) => navigate(k ? `/rank-tracking/landscape?kw=${encodeURIComponent(k)}` : '/rank-tracking/landscape');
  const organic = serp.data?.organic || [];
  const mine = organic.find(o => o.mine);
  const features = Object.entries(serp.data?.features || {});

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-13 text-slate-600">
        <span>Targeting: <b className="text-blue-700">{d?.location || b.country || '—'}</b></span><span>Search engine: <b className="text-slate-800">Google</b></span>
        <span>Last update: <b className="text-slate-800">{d?.last_update ? new Date(d.last_update).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'not read yet'}</b></span>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl bg-white ring-1 ring-slate-200 p-3">
        <label className="flex-1 min-w-[240px]"><div className="text-13 font-semibold text-slate-800 mb-1">Keyword</div>
          <div className="flex items-center gap-2 h-10 rounded-lg ring-1 ring-inset ring-slate-300 px-2">
            <span className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1 rounded bg-slate-100 text-13 font-medium">{keyword}<button type="button" aria-label="Back to all keywords" onClick={() => go('')} className="p-0.5 hover:bg-slate-200 rounded cursor-pointer"><X size={12} /></button></span>
            <select aria-label="Choose another tracked keyword" value="" onChange={e => e.target.value && go(e.target.value)} className="ml-auto h-8 text-13 bg-transparent text-slate-500 cursor-pointer max-w-[40%]"><option value="">Switch keyword…</option>{list.filter(k => k !== keyword).map(k => <option key={k} value={k}>{k}</option>)}</select>
          </div>
        </label>
        <div><div className="text-13 font-semibold text-slate-800 mb-1">Search engine</div><div className="h-10 px-3 inline-flex items-center rounded-lg ring-1 ring-inset ring-slate-300 text-13">Google</div></div>
        <div><div className="text-13 font-semibold text-slate-800 mb-1">Location</div><div className="h-10 px-3 inline-flex items-center rounded-lg ring-1 ring-inset ring-slate-300 text-13">{d?.location || b.city || b.country || '—'}</div></div>
        <Button variant="primary" icon={RefreshCw} busy={busy === 'update'} onClick={update}>Update report</Button>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {rep.error && <ErrorNote>{rep.error.message}</ErrorNote>}

      <div className="flex gap-6 border-b border-slate-200" role="tablist">{TABS.map(t => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`-mb-px pb-2.5 text-14 font-medium border-b-2 cursor-pointer ${tab === t ? 'border-indigo-600 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{t}</button>)}</div>

      {!d ? <div className="flex items-center justify-center gap-2 py-14 text-13 text-slate-500"><Loader2 size={16} className="animate-spin" />Reading the position history…</div> : !d.tracked ? (
        <Card><p className="text-13 text-slate-600">“{keyword}” is not in your saved keywords, so it is not tracked. <Link className="text-indigo-600 underline" to={`/keyword-management/prepare?k=${q}`}>Prepare and save it</Link> first.</p></Card>
      ) : (
        <>
          {tab === 'Overview' && (
            <>
              <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
                <Tile label="Position" value={s.current ? s.current : '—'} sub={<Delta now={s.current} before={s.previous} />} series={inRange.filter(x => x.rank).map(x => -x.rank)} tip="Average position on Google over the last 28 days, from Search Console" />
                <Tile label="Search Volume" value={kfmt(d.volume)} sub={null} tip="Monthly searches, Google Keyword Planner" color="#64748b" />
                <Tile label="Visibility" value={d.visibility != null ? `${d.visibility}%` : '—'} series={inRange.map(x => x.visibility)} color="#059669" tip="Estimate: share of searches that click a result at this position, from a published average click curve" />
                <Tile label="Estimated Traffic" value={d.traffic != null ? kfmt(d.traffic) : '—'} series={inRange.map(x => x.traffic || 0)} color="#7c3aed" tip="Estimate: monthly searches times the click share at this position" />
                <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4"><div className="text-13 text-slate-500">SERP Features</div>
                  {serp.data?.state === 'ok' ? <div className="mt-2 flex flex-wrap gap-1.5">{features.filter(([, on]) => on).map(([n]) => <span key={n} className="px-2 py-0.5 rounded bg-slate-100 text-12 text-slate-700">{n}</span>)}{!features.some(([, on]) => on) && <span className="text-13 text-slate-400">None on this search</span>}</div> : serp.error || serp.data?.state === 'error' ? <div className="mt-2 text-12 text-slate-400">Not read</div> : <Loader2 size={14} className="animate-spin text-slate-400 mt-3" />}
                </div>
              </div>
              <Trend series={series} range={range} setRange={setRange} />
              <div className="grid gap-4 lg:grid-cols-3">
                <Card title="Keyword Position Summary"><table className="w-full text-13"><tbody className="divide-y divide-slate-100">
                  {[['Current Position', s.current, <Delta key="d" now={s.current} before={s.previous} />], ['Previous Position', s.previous], ['Best Position', s.best], ['Worst Position', s.worst], ['Average Position', s.average]].map(([l, v, x]) => <tr key={l}><td className="py-2 text-slate-600">{l}</td><td className="py-2 text-right font-semibold tabular-nums">{v ?? '—'} {x}</td></tr>)}
                </tbody></table>{s.checks < 2 && <p className="mt-2 text-12 text-slate-400">Only {s.checks} check so far: previous, best and worst fill in as positions are read over time.</p>}</Card>
                <Card title="Competitors" action={<button type="button" onClick={() => setTab('Competitors')} className="text-12.5 text-indigo-600 hover:underline cursor-pointer">All</button>}>
                  {serp.data?.state === 'ok' ? <table className="w-full text-13"><thead><tr className="text-12 text-slate-500"><th className="text-left font-medium pb-1">Domain</th><th className="text-right font-medium pb-1">Position</th></tr></thead><tbody className="divide-y divide-slate-100">{organic.slice(0, 5).map(o => <tr key={o.url} className={o.mine ? 'bg-emerald-50/60' : ''}><td className="py-1.5"><a href={o.url} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">{o.site}</a></td><td className="py-1.5 text-right tabular-nums">{o.position}</td></tr>)}</tbody></table>
                    : serp.data?.state === 'error' ? <p className="text-13 text-slate-500">{serp.data.message}</p> : <div className="flex items-center gap-2 text-13 text-slate-400"><Loader2 size={14} className="animate-spin" />Reading Google's results…</div>}
                </Card>
                <Card title="SERP Result Preview">
                  {d.url ? <div><div className="text-12 text-slate-500 truncate">{d.url}</div><a href={d.url} target="_blank" rel="noreferrer" className="text-16 text-blue-700 hover:underline">{(mine && mine.title) || d.url.replace(/^https?:\/\//, '')}</a>{mine?.description && <p className="text-13 text-slate-600 mt-1">{mine.description}</p>}
                    {s.current ? <div className="mt-3 inline-flex items-center gap-1.5 rounded bg-emerald-50 text-emerald-800 text-13 px-2.5 py-1.5 ring-1 ring-emerald-200"><CheckCircle2 size={14} />Your page is ranking at position {s.current}</div> : <div className="mt-3 text-13 text-slate-500">Not ranking yet.</div>}</div>
                    : <p className="text-13 text-slate-500">No page of your site has shown for this keyword in Search Console yet.</p>}
                </Card>
              </div>
            </>
          )}
          {tab === 'SERP Features' && <Card title="SERP Features on this search" action={<span className="text-12 text-slate-400">Read live from Google</span>}>{serp.data?.state === 'ok' ? <ul className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">{features.map(([n, on]) => <li key={n} className={`rounded-lg px-3 py-2 text-13 ring-1 ${on ? 'bg-indigo-50 ring-indigo-200 text-indigo-900' : 'bg-white ring-slate-200 text-slate-400'}`}>{n}<div className="text-11.5">{on ? 'On this search' : 'Not shown'}</div></li>)}</ul> : <p className="text-13 text-slate-500">{serp.data?.message || 'Reading Google…'}</p>}{serp.data?.state === 'ok' && <p className="mt-3 text-13 text-slate-600">Ads: {serp.data.ads} · People also ask: {serp.data.questions}</p>}</Card>}
          {tab === 'Competitors' && <Card title="Top 10 on Google right now">{serp.data?.state === 'ok' ? <table className="w-full text-13"><thead><tr className="text-12 text-slate-500"><th className="text-left py-1.5 w-14">Position</th><th className="text-left">Page</th><th className="text-left">Domain</th></tr></thead><tbody className="divide-y divide-slate-100">{organic.map(o => <tr key={o.url} className={o.mine ? 'bg-emerald-50/60' : ''}><td className="py-2 tabular-nums">{o.position}</td><td className="py-2 max-w-[420px]"><a href={o.url} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline inline-flex items-center gap-1 truncate">{o.title || o.url}<ExternalLink size={11} /></a></td><td className="py-2">{o.site}{o.mine && <span className="ml-2 text-11 font-semibold text-emerald-700">You</span>}</td></tr>)}</tbody></table> : <p className="text-13 text-slate-500">{serp.data?.message || 'Reading Google…'}</p>}{serp.data?.state === 'ok' && !mine && <p className="mt-3 text-13 text-slate-500">Your site is not in Google's top 10 for this search.</p>}</Card>}
          {tab === 'Pages' && <Card title="Pages of your site that ranked">{(() => { const m = new Map(); series.forEach(x => { if (x.url) { const e = m.get(x.url) || { url: x.url, first: x.day, last: x.day, best: null }; e.last = x.day; e.best = x.rank && (e.best == null || x.rank < e.best) ? x.rank : e.best; m.set(x.url, e); } }); const l = [...m.values()]; return l.length ? <table className="w-full text-13"><thead><tr className="text-12 text-slate-500"><th className="text-left py-1.5">Page</th><th className="text-right">Best position</th><th className="text-right">First seen</th><th className="text-right">Last seen</th></tr></thead><tbody className="divide-y divide-slate-100">{l.map(e => <tr key={e.url}><td className="py-2"><a href={e.url} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">{e.url}</a></td><td className="py-2 text-right tabular-nums">{e.best ?? '—'}</td><td className="py-2 text-right">{e.first}</td><td className="py-2 text-right">{e.last}</td></tr>)}</tbody></table> : <p className="text-13 text-slate-500">No page has ranked for it yet.</p>; })()}</Card>}
          {tab === 'Progress' && <Card title="Every check">{series.length ? <table className="w-full text-13"><thead><tr className="text-12 text-slate-500"><th className="text-left py-1.5">Date</th><th className="text-right">Position</th><th className="text-right">Impressions</th><th className="text-right">Clicks</th><th className="text-right">Visibility</th><th className="text-right">Est. traffic</th></tr></thead><tbody className="divide-y divide-slate-100">{[...series].reverse().map(x => <tr key={x.day}><td className="py-2">{x.day}</td><td className="py-2 text-right tabular-nums">{x.rank ? `#${x.rank}` : 'Not ranking'}</td><td className="py-2 text-right tabular-nums">{x.impressions ?? '—'}</td><td className="py-2 text-right tabular-nums">{x.clicks ?? '—'}</td><td className="py-2 text-right tabular-nums">{x.visibility}%</td><td className="py-2 text-right tabular-nums">{x.traffic != null ? kfmt(x.traffic) : '—'}</td></tr>)}</tbody></table> : <p className="text-13 text-slate-500">Nothing read yet. Press Update report.</p>}</Card>}
        </>
      )}
      {toastNode}
    </div>
  );
}
