import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ExternalLink, Gauge, Globe, Info, Link2, Loader2, Search, Swords, TrendingUp, ArrowLeft } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ScatterChart, Scatter, ZAxis } from 'recharts';
import { SeoShell, Card, Badge, Button, ErrorNote, Tabs } from './SeoUi';
import DataTable from './DataTable';
import { api, fmt } from './seoApi';
import Select from '../components/Select';

const COUNTRIES = [['IN', 'India'], ['US', 'United States'], ['GB', 'United Kingdom'], ['AU', 'Australia'], ['CA', 'Canada'], ['AE', 'United Arab Emirates'], ['SG', 'Singapore'], ['DE', 'Germany'], ['FR', 'France'], ['IT', 'Italy'], ['ES', 'Spain'], ['BR', 'Brazil'], ['NL', 'Netherlands'], ['ID', 'Indonesia'], ['TR', 'Turkey'], ['MX', 'Mexico'], ['JP', 'Japan'], ['ZA', 'South Africa']];
const INTENT = { informational: ['Informational', '#6658dd'], navigational: ['Navigational', '#a855f7'], commercial: ['Commercial', '#f59e0b'], transactional: ['Transactional', '#10b981'], local: ['Local', '#0ea5e9'] };
const BUCKETS = [['top3', 'Top 3', '#f59e0b'], ['p4_10', '4 to 10', '#4338ca'], ['p11_20', '11 to 20', '#6366f1'], ['out', 'Not in the top 20', '#cbd5e1']];
const kfmt = (n) => (n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K` : Number(n).toLocaleString('en-US'));
const posColor = (n) => (n == null ? '#94a3b8' : n <= 3 ? '#059669' : n <= 10 ? '#65a30d' : '#d97706');
const CHUNK = 6;

function Stat({ label, value, sub, tone = 'text-slate-900', hint }) {
  return (
    <div className="px-4 py-3 min-w-0" title={hint}>
      <div className="text-12.5 text-slate-500">{label}</div>
      <div className={`text-26 font-bold tabular-nums leading-tight ${tone}`}>{value}</div>
      {sub && <div className="text-11.5 text-slate-500 mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

function Empty({ children }) {
  return <p className="px-5 py-8 text-center text-13 text-slate-500">{children}</p>;
}

function PosChip({ r }) {
  if (r.position != null) return <b className="tabular-nums" style={{ color: posColor(r.position) }}>#{r.position}</b>;
  return <span className="text-slate-400 text-12.5" title={r.measured ? 'The page is not in the top 20 for this search' : 'Not measured yet or Google\'s results could not be read'}>{r.measured ? 'Not in top 20' : '…'}</span>;
}

export function PageRankingsBody({ b }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const url = (params.get('u') || '').trim();
  const kw = (params.get('q') || '').trim();
  const [country, setCountry] = useState(params.get('c') || '');
  const [typed, setTyped] = useState(url);
  const [tab, setTab] = useState('overview');
  const [info, setInfo] = useState(null);
  const [meas, setMeas] = useState({ rows: [], done: 0, total: 0, running: false });
  const [auths, setAuths] = useState({});
  const [changeTab, setChangeTab] = useState('new');
  const run = useRef(0);
  useEffect(() => setTyped(url), [url]);

  // 1. the page, its site, the searches Google ties to it (and Search Console for your own pages); 2. the positions, a few searches at a time; 3. the competitors' strength
  useEffect(() => {
    if (!url) return undefined;
    const mine = ++run.current;
    const live = () => run.current === mine;
    setInfo({ state: 'loading' }); setMeas({ rows: [], done: 0, total: 0, running: false }); setAuths({}); setTab('overview');
    (async () => {
      let res;
      try { res = await api(`/businesses/${b.id}/seo/organic-rankings`, { method: 'POST', body: { url, keyword: kw || null, country: country || null }, timeout: 180000 }); } catch (e) { if (live()) setInfo({ state: 'error', message: e.message }); return; }
      if (!live()) return;
      setInfo({ state: 'ready', ...res });
      const ks = res.keywords || [];
      const cands = [...new Set([...ks.filter(k => k.source === 'On the page').slice(0, 8).map(k => k.keyword), ...ks.filter(k => (k.volume || 0) >= 10).slice(0, 30).map(k => k.keyword)])].slice(0, 36);
      setMeas({ rows: [], done: 0, total: cands.length, running: cands.length > 0 });
      const all = [];
      for (let n = 0; n < cands.length; n += CHUNK) {
        const chunk = cands.slice(n, n + CHUNK);
        let got = [];
        try { got = (await api(`/businesses/${b.id}/seo/organic-rankings/positions`, { method: 'POST', body: { url, keywords: chunk, country: res.country, also: res.page?.final_url || null }, timeout: 240000 })).rows; } catch { got = chunk.map(k => ({ keyword: k, measured: false, position: null, top: [] })); }
        if (!live()) return;
        all.push(...got);
        setMeas({ rows: [...all], done: Math.min(cands.length, n + CHUNK), total: cands.length, running: n + CHUNK < cands.length });
      }
      if (!live()) return;
      const host = res.site;
      const count = {};
      for (const r of all) for (const o of r.top || []) if (o.site && o.site !== host) count[o.site] = (count[o.site] || 0) + 1;
      const top = Object.entries(count).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([d]) => d);
      if (top.length) { try { const a = await api(`/businesses/${b.id}/seo/organic-rankings/authorities`, { method: 'POST', body: { domains: top }, timeout: 120000 }); if (live()) setAuths(a.authorities || {}); } catch { /* the table still shows the counts */ } }
    })();
    return () => { run.current += 1; };
  }, [url, kw, country, b.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const ideas = info?.keywords || [];
  const byKw = useMemo(() => Object.fromEntries(ideas.map(k => [k.keyword, k])), [ideas]);
  const rows = useMemo(() => meas.rows.map(r => ({ ...r, volume: byKw[r.keyword]?.volume ?? null, index: byKw[r.keyword]?.index ?? null, intent: byKw[r.keyword]?.intent || '', source: byKw[r.keyword]?.source || '' })), [meas.rows, byKw]);
  const ranked = rows.filter(r => r.position != null);
  const dist = useMemo(() => {
    const d = { top3: 0, p4_10: 0, p11_20: 0, out: 0 };
    for (const r of rows) { if (!r.measured) continue; const p = r.position; if (p == null) d.out += 1; else if (p <= 3) d.top3 += 1; else if (p <= 10) d.p4_10 += 1; else d.p11_20 += 1; }
    return d;
  }, [rows]);
  const comps = useMemo(() => {
    const base = ranked.length ? ranked : rows.filter(r => r.measured);
    const count = {}, best = {};
    for (const r of base) for (const o of r.top || []) { if (!o.site || o.site === info?.site) continue; count[o.site] = (count[o.site] || 0) + 1; best[o.site] = Math.min(best[o.site] || 99, o.position); }
    return Object.entries(count).sort((x, y) => y[1] - x[1]).slice(0, 12).map(([site, n]) => ({ site, common: n, level: Math.round((n * 100) / Math.max(1, base.length)), best: best[site], da: auths[site]?.da ?? null, rd: auths[site]?.rd ?? null, kws: auths[site]?.ranking_keywords ?? null }));
  }, [ranked, rows, auths, info?.site]);
  const intents = useMemo(() => {
    const m = {};
    for (const k of ideas) { const x = (m[k.intent] ||= { n: 0, v: 0 }); x.n += 1; x.v += k.volume || 0; }
    const total = Object.values(m).reduce((a, x) => a + x.n, 0) || 1;
    return Object.entries(m).map(([k, x]) => ({ key: k, ...x, share: Math.round((x.n * 100) / total) })).sort((a, c) => c.n - a.n);
  }, [ideas]);

  const submit = () => { const u = typed.trim(); if (u.length > 3) navigate(`/organic-rankings/page?u=${encodeURIComponent(u)}${kw ? `&q=${encodeURIComponent(kw)}` : ''}${country ? `&c=${country}` : ''}`); };
  const pg = info?.page, au = info?.authority, sc = info?.search_console;
  const host = info?.site || (() => { try { return new URL(/^https?:/i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, ''); } catch { return url; } })();
  const lenTone = (n, lo, hi) => (!n ? 'text-rose-600' : n < lo || n > hi ? 'text-amber-600' : 'text-emerald-600');
  const loading = info?.state === 'loading';

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative flex-1 min-w-[260px]"><Globe size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={typed} onChange={e => setTyped(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder="Enter a page address, e.g. https://example.com/page" aria-label="Page address" className="h-10 w-full pl-9 pr-3 text-13.5 rounded-lg ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none" /></label>
          <Select value={country || info?.country || ''} onChange={e => { const c = e.target.value; setCountry(c); }} aria-label="Country" className="h-10 rounded-lg ring-1 ring-inset ring-slate-300 bg-white px-3 text-13.5">{!country && !info?.country && <option value="">Your country</option>}{COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</Select>
          <Button variant="primary" icon={Search} disabled={typed.trim().length < 4} onClick={submit}>Analyze</Button>
        </div>
        {url && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-13">
            <Link to={`/keyword-overview${kw ? `?q=${encodeURIComponent(kw)}` : ''}`} className="inline-flex items-center gap-1 font-semibold text-indigo-700 hover:underline"><ArrowLeft size={14} />Keyword Overview{kw ? `: ${kw}` : ''}</Link>
            <span className="text-slate-500">Device: Desktop</span><span className="text-slate-500">{new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
            {pg?.status && <Badge tone={pg.status === 200 ? 'green' : 'red'}>{pg.status === 200 ? 'Page loads (200)' : `Answers ${pg.status}`}</Badge>}
          </div>
        )}
      </Card>

      {!url ? <Card><Empty>Enter the address of any page above, or open one from the top-10 table of the <Link to="/keyword-overview" className="font-semibold text-indigo-700 hover:underline">Keyword Overview</Link>.</Empty></Card> : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-18 font-semibold text-slate-900 break-all">Organic rankings: {url}</h2>
            <a href={url} target="_blank" rel="noreferrer" aria-label="Open the page in a new tab" title="Open the page itself" className="text-slate-400 hover:text-indigo-600"><ExternalLink size={16} /></a>
          </div>
          {info?.state === 'error' && <ErrorNote>{info.message}</ErrorNote>}
          {pg && !pg.ok && <Card><p className="text-13 text-amber-800">{pg.error || 'The page could not be read.'}</p></Card>}
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-12.5 text-amber-900"><Info size={15} className="mt-0.5 shrink-0" /><span>Showing this page{sc?.own ? ' (your own page: Search Console data is real)' : ''}. Positions are measured live in Google's top 20 for the searches Google ties to the page ({meas.total || '…'} checked). Traffic, traffic cost and position history of other sites need a ranking database that is not connected, so they are not shown.</span></div>

          <Tabs tabs={[{ id: 'overview', label: 'Overview' }, { id: 'positions', label: 'Positions', count: rows.length || undefined }, { id: 'changes', label: 'Position changes' }, { id: 'competitors', label: 'Competitors', count: comps.length || undefined }, { id: 'page', label: 'Page' }]} value={tab} onChange={setTab} />

          {tab === 'overview' && (
            <>
              <Card pad={false}>
                <div className="grid grid-cols-2 lg:grid-cols-5 divide-x divide-slate-100">
                  <Stat label="Keywords the site ranks for" value={loading ? '…' : kfmt(au?.ranking_keywords)} sub={`whole of ${host}, Moz`} hint="How many keywords the whole site ranks for (Moz)" />
                  <Stat label="This page, top 20" value={meas.total ? `${ranked.length} of ${meas.done}` : '…'} sub={meas.running ? `measuring… ${meas.done}/${meas.total}` : 'searches it shows for'} tone="text-indigo-700" hint="The searches Google ties to the page where it is in the top 20" />
                  <Stat label="Domain Authority" value={loading ? '…' : au?.da ?? '—'} sub={au?.error || 'Moz'} />
                  <Stat label="Referring domains" value={loading ? '…' : kfmt(au?.rd)} sub="sites linking to the domain" />
                  {sc?.own && sc.totals ? <Stat label="Clicks, 90 days" value={fmt(sc.totals.clicks)} sub={`${fmt(sc.totals.views)} views · ${fmt(sc.totals.non_branded_clicks)} not branded`} tone="text-emerald-700" hint="Google Search Console, this page" /> : <Stat label="Traffic and cost" value="n/a" sub="needs a ranking database" tone="text-slate-400" />}
                </div>
              </Card>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <Card title="Where the page ranks" subtitle="Its position in Google's top 20 for each search measured">
                  {meas.total === 0 && !loading ? <p className="text-13 text-slate-500">Google gave no searches for this page.</p> : (
                    <>
                      <div className="flex h-8 rounded-lg overflow-hidden ring-1 ring-slate-200" role="img" aria-label="Positions of the page">
                        {BUCKETS.map(([k, label, c]) => dist[k] > 0 && <div key={k} className="flex items-center justify-center text-11.5 font-semibold text-white" style={{ width: `${(dist[k] * 100) / Math.max(1, rows.filter(r => r.measured).length)}%`, backgroundColor: c, color: k === 'out' ? '#475569' : '#fff' }} title={`${label}: ${dist[k]}`}>{dist[k]}</div>)}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-12.5">{BUCKETS.map(([k, label, c]) => <span key={k} className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: c }} />{label} <b className="tabular-nums">{dist[k]}</b></span>)}</div>
                    </>
                  )}
                  {sc?.own && sc.series?.length > 0 && (
                    <div className="mt-4"><div className="text-12.5 font-semibold text-slate-700 mb-1">Clicks per day, last 90 days (Search Console)</div>
                      <div className="h-36"><ResponsiveContainer width="100%" height="100%"><AreaChart data={sc.series} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}><CartesianGrid stroke="#eef2f7" vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={d => d.slice(5)} minTickGap={24} /><YAxis tick={{ fontSize: 10, fill: '#64748b' }} width={28} allowDecimals={false} /><Tooltip formatter={(v, n) => [v, n === 'clicks' ? 'Clicks' : 'Views']} labelFormatter={d => d} /><Area type="monotone" dataKey="clicks" stroke="#6366f1" fill="#c7d2fe" /></AreaChart></ResponsiveContainer></div></div>
                  )}
                </Card>
                <Card title="Keywords by intent" subtitle="What the searches Google ties to the page are for">
                  {intents.length === 0 ? <p className="text-13 text-slate-500">{loading ? 'Reading…' : 'No searches found.'}</p> : (
                    <>
                      <div className="flex h-3 rounded-full overflow-hidden mb-3">{intents.map(i => <div key={i.key} style={{ width: `${i.share}%`, backgroundColor: (INTENT[i.key] || ['', '#94a3b8'])[1] }} title={`${(INTENT[i.key] || [i.key])[0]}: ${i.share}%`} />)}</div>
                      <table className="w-full text-12.5"><thead><tr className="text-left text-11.5 text-slate-500"><th className="py-1 font-medium">Intent</th><th className="py-1 font-medium text-right">Share</th><th className="py-1 font-medium text-right">Keywords</th><th className="py-1 font-medium text-right">Searches / mo</th></tr></thead>
                        <tbody>{intents.map(i => <tr key={i.key} className="border-t border-slate-100"><td className="py-1.5"><span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: (INTENT[i.key] || ['', '#94a3b8'])[1] }} />{(INTENT[i.key] || [i.key])[0]}</span></td><td className="py-1.5  tabular-nums text-indigo-700">{i.share}%</td><td className="py-1.5  tabular-nums">{kfmt(i.n)}</td><td className="py-1.5  tabular-nums">{kfmt(i.v)}</td></tr>)}</tbody></table>
                    </>
                  )}
                </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <Card title="Top keywords" subtitle="The searches it shows for, by searches a month">
                  {meas.total > 0 && ranked.length === 0 ? <p className="text-13 text-slate-500">{meas.running ? 'Measuring positions…' : 'The page is not in the top 20 for any of the searches measured.'}</p> : (
                    <table className="w-full text-12.5"><thead><tr className="text-left text-11.5 text-slate-500 border-b border-slate-200"><th className="py-1.5 font-medium">Keyword</th><th className="py-1.5 font-medium text-right">Position</th><th className="py-1.5 font-medium text-right">Volume</th></tr></thead>
                      <tbody>{[...ranked].sort((a, c) => (c.volume || 0) - (a.volume || 0)).slice(0, 5).map(r => <tr key={r.keyword} className="border-b border-slate-100"><td className="py-2"><Link to={`/keyword-overview?q=${encodeURIComponent(r.keyword)}`} className="text-indigo-700 hover:underline">{r.keyword}</Link></td><td className="py-2 text-right"><PosChip r={r} /></td><td className="py-2  tabular-nums">{kfmt(r.volume)}</td></tr>)}</tbody></table>
                  )}
                  {ranked.length > 5 && <button type="button" onClick={() => setTab('positions')} className="mt-3 rounded-lg ring-1 ring-inset ring-slate-300 px-3 py-1.5 text-12.5 font-medium text-slate-700 hover:bg-slate-50 cursor-pointer">View all {ranked.length} keywords</button>}
                </Card>
                <Card title="Main organic competitors" subtitle="Pages that show next to it in Google for the same searches">
                  {comps.length === 0 ? <p className="text-13 text-slate-500">{meas.running || loading ? 'Measuring…' : 'No competitors found.'}</p> : (
                    <table className="w-full text-12.5"><thead><tr className="text-left text-11.5 text-slate-500 border-b border-slate-200"><th className="py-1.5 font-medium">Domain</th><th className="py-1.5 font-medium text-right">Common keywords</th><th className="py-1.5 font-medium text-right">Level</th></tr></thead>
                      <tbody>{comps.slice(0, 5).map(c => <tr key={c.site} className="border-b border-slate-100"><td className="py-2"><a href={`https://${c.site}`} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline inline-flex items-center gap-1">{c.site}<ExternalLink size={11} className="text-slate-400" /></a></td><td className="py-2  tabular-nums">{c.common}</td>
                        <td className="py-2 text-right"><span className="inline-flex items-center gap-1.5 justify-end"><span className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden"><span className="block h-full bg-indigo-500" style={{ width: `${c.level}%` }} /></span><span className="tabular-nums w-9">{c.level}%</span></span></td></tr>)}</tbody></table>
                  )}
                  {comps.length > 5 && <button type="button" onClick={() => setTab('competitors')} className="mt-3 rounded-lg ring-1 ring-inset ring-slate-300 px-3 py-1.5 text-12.5 font-medium text-slate-700 hover:bg-slate-50 cursor-pointer">View all {comps.length} competitors</button>}
                </Card>
              </div>

              {sc?.own && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <Card pad={false} title="Top position changes" subtitle="Search Console: the last 90 days against the 90 days before">
                    <ChangesTable sc={sc} tab={changeTab} setTab={setChangeTab} limit={5} />
                    {sc.rows?.length > 0 && <div className="px-5 pb-4"><button type="button" onClick={() => setTab('changes')} className="rounded-lg ring-1 ring-inset ring-slate-300 px-3 py-1.5 text-12.5 font-medium text-slate-700 hover:bg-slate-50 cursor-pointer">View all changes</button></div>}
                  </Card>
                  <Card pad={false} title="Top pages of your site" subtitle="Search Console, last 90 days">
                    {sc.pages?.length ? <table className="w-full text-12.5"><thead><tr className="text-left text-11.5 text-slate-500 border-b border-slate-200"><th className="px-4 py-1.5 font-medium">Page</th><th className="px-2 py-1.5 font-medium text-right">Clicks</th><th className="px-4 py-1.5 font-medium text-right">Views</th></tr></thead>
                      <tbody>{sc.pages.slice(0, 8).map(p => <tr key={p.page} className="border-b border-slate-100"><td className="px-4 py-2 max-w-[260px] truncate"><Link to={`/organic-rankings/page?u=${encodeURIComponent(p.page)}`} className="text-indigo-700 hover:underline" title={p.page}>{p.page.replace(/^https?:\/\/(www\.)?/, '')}</Link></td><td className="px-2 py-2  tabular-nums">{fmt(p.clicks)}</td><td className="px-4 py-2  tabular-nums">{fmt(p.views)}</td></tr>)}</tbody></table> : <Empty>No pages with clicks yet.</Empty>}
                  </Card>
                </div>
              )}

              <Card title="Competitive positioning map" subtitle="The competitors above: how many of the page's searches they share and how strong their domain is (Domain Authority)">
                {comps.filter(c => c.da != null).length < 2 ? <p className="text-13 text-slate-500">{meas.running ? 'Measuring…' : 'Not enough competitors with a Domain Authority to draw the map.'}</p> : (
                  <div className="h-64"><ResponsiveContainer width="100%" height="100%"><ScatterChart margin={{ left: 0, right: 16, top: 8, bottom: 16 }}>
                    <CartesianGrid stroke="#eef2f7" /><XAxis type="number" dataKey="common" name="Common keywords" tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} label={{ value: 'Common keywords', position: 'insideBottom', offset: -8, fontSize: 11, fill: '#64748b' }} /><YAxis type="number" dataKey="da" name="Domain Authority" domain={[0, 100]} tick={{ fontSize: 11, fill: '#64748b' }} width={34} /><ZAxis type="number" dataKey="rdSize" range={[80, 600]} />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ payload }) => { const c = payload?.[0]?.payload; return c ? <div className="rounded-md bg-slate-900 text-white text-12 px-2.5 py-1.5 shadow-lg"><div className="font-semibold">{c.site}</div><div>{c.common} common keywords · Domain Authority {c.da}</div>{c.rd != null && <div className="text-slate-300">{kfmt(c.rd)} referring domains</div>}</div> : null; }} />
                    <Scatter data={comps.filter(c => c.da != null).map(c => ({ ...c, rdSize: Math.log10((c.rd || 10) + 10) }))} fill="#6366f1" fillOpacity={0.55} />
                  </ScatterChart></ResponsiveContainer></div>
                )}
              </Card>
            </>
          )}

          {tab === 'positions' && (
            <Card pad={false} title="Positions" subtitle={`The searches Google ties to the page and where it is in Google's top 20${meas.running ? ` (measuring ${meas.done}/${meas.total}…)` : ''}`}>
              {rows.length === 0 ? <Empty>{meas.running || loading ? 'Measuring…' : 'No searches found.'}</Empty> : (
                <DataTable bare rows={rows} rowKey={r => r.keyword} pageSize={25} sizes={[25, 50]} exportName={`page-positions-${host}`} label="keywords" headClass="bg-slate-100 text-slate-700" minWidth={640}
                  columns={[
                    { id: 'keyword', header: 'Keyword', value: r => r.keyword, className: 'px-3 py-2', cell: r => <Link to={`/keyword-overview?q=${encodeURIComponent(r.keyword)}`} className="text-indigo-700 hover:underline">{r.keyword}</Link> },
                    { id: 'position', header: 'Position in Google', right: true, first: 'asc', value: r => (r.position == null ? 999 : r.position), className: 'px-3 py-2 ', cell: r => <PosChip r={r} /> },
                    { id: 'volume', header: 'Searches / mo', right: true, first: 'desc', value: r => r.volume, className: 'px-3 py-2  tabular-nums', cell: r => (r.volume != null ? fmt(r.volume) : '—') },
                    { id: 'index', header: 'Competition index', right: true, value: r => r.index, className: 'px-3 py-2  tabular-nums', cell: r => r.index ?? '—' },
                    { id: 'intent', header: 'Intent', value: r => r.intent, className: 'px-3 py-2 capitalize text-slate-600', cell: r => r.intent },
                    { id: 'source', header: 'Found by', value: r => r.source, className: 'px-3 py-2 text-slate-500', cell: r => r.source },
                  ]} />
              )}
            </Card>
          )}

          {tab === 'changes' && (
            <Card pad={false} title="Position changes" subtitle="Search Console: the last 90 days against the 90 days before (your own pages)">
              {sc?.own ? <ChangesTable sc={sc} tab={changeTab} setTab={setChangeTab} limit={50} /> : <Empty>Position changes need history, which only Google Search Console has, and only for your own site. For any other page there is no history to compare.</Empty>}
            </Card>
          )}

          {tab === 'competitors' && (
            <Card pad={false} title="Main organic competitors" subtitle="The pages that show in Google's top 20 for the same searches, with the strength of their domain (Moz)">
              {comps.length === 0 ? <Empty>{meas.running || loading ? 'Measuring…' : 'No competitors found.'}</Empty> : (
                <DataTable bare rows={comps} rowKey={c => c.site} pageSize={25} sizes={[25]} exportName={`page-competitors-${host}`} label="competitors" headClass="bg-slate-100 text-slate-700" minWidth={640}
                  columns={[
                    { id: 'site', header: 'Domain', value: c => c.site, className: 'px-3 py-2', cell: c => <a href={`https://${c.site}`} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline inline-flex items-center gap-1">{c.site}<ExternalLink size={11} className="text-slate-400" /></a> },
                    { id: 'common', header: 'Common keywords', right: true, first: 'desc', value: c => c.common, className: 'px-3 py-2  tabular-nums', cell: c => c.common },
                    { id: 'level', header: 'Competition level', right: true, first: 'desc', value: c => c.level, className: 'px-3 py-2  tabular-nums', cell: c => `${c.level}%` },
                    { id: 'best', header: 'Best position', right: true, first: 'asc', value: c => c.best, className: 'px-3 py-2  tabular-nums', cell: c => `#${c.best}` },
                    { id: 'da', header: 'Domain Authority', right: true, first: 'desc', value: c => c.da, className: 'px-3 py-2  tabular-nums', cell: c => c.da ?? '—' },
                    { id: 'rd', header: 'Referring domains', right: true, first: 'desc', value: c => c.rd, className: 'px-3 py-2  tabular-nums', cell: c => kfmt(c.rd) },
                    { id: 'kws', header: 'Keywords it ranks for', right: true, first: 'desc', value: c => c.kws, className: 'px-3 py-2  tabular-nums', cell: c => kfmt(c.kws) },
                  ]} />
              )}
            </Card>
          )}

          {tab === 'page' && (pg?.ok ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <Card title="On the page" subtitle="Read directly from the page">
                <dl className="text-13 grid grid-cols-[130px_1fr] gap-x-3 gap-y-2">
                  <dt className="text-slate-500">Title</dt><dd><span className="text-slate-900">{pg.title || 'None'}</span> <span className={`text-11.5 ${lenTone(pg.title_len, 30, 62)}`}>({pg.title_len} characters)</span></dd>
                  <dt className="text-slate-500">Description</dt><dd><span className="text-slate-900">{pg.description || 'None'}</span> <span className={`text-11.5 ${lenTone(pg.description_len, 70, 160)}`}>({pg.description_len} characters)</span></dd>
                  <dt className="text-slate-500">Main heading</dt><dd className="text-slate-900">{pg.h1?.length ? pg.h1.join(' / ') : 'None'}</dd>
                  <dt className="text-slate-500">Length</dt><dd className="text-slate-900">{fmt(pg.words)} words</dd>
                  <dt className="text-slate-500">Last updated</dt><dd className="text-slate-900">{pg.modified || 'The page does not say'}</dd>
                  <dt className="text-slate-500">Links</dt><dd className="text-slate-900">{pg.links_internal} inside the site, {pg.links_external} to other sites</dd>
                  <dt className="text-slate-500">Images</dt><dd className="text-slate-900">{pg.images}{pg.images_no_alt ? <span className="text-amber-600"> ({pg.images_no_alt} without a description)</span> : ''}</dd>
                  <dt className="text-slate-500">Structured data</dt><dd className="text-slate-900">{pg.schema?.length ? pg.schema.join(', ') : 'None'}</dd>
                  <dt className="text-slate-500">Canonical</dt><dd className="text-slate-900 break-all">{pg.canonical || 'None'}</dd>
                  <dt className="text-slate-500">Robots</dt><dd className="text-slate-900">{pg.robots || 'No restriction'}</dd>
                </dl>
              </Card>
              <Card title="Headings" subtitle="How the page is laid out">
                {pg.headings?.length ? <ul className="space-y-1 text-13">{pg.headings.map((h, n) => <li key={n} className={h.tag === 'h3' ? 'pl-5 text-slate-600' : 'font-medium text-slate-900'}><span className="text-11 text-slate-400 mr-1.5 uppercase">{h.tag}</span>{h.text}</li>)}</ul> : <p className="text-13 text-slate-500">The page has no sub-headings.</p>}
              </Card>
            </div>
          ) : <Card><Empty>{loading ? 'Reading the page…' : (pg?.error || 'The page could not be read.')}</Empty></Card>)}
        </>
      )}
    </div>
  );
}

function ChangesTable({ sc, tab, setTab, limit }) {
  const tabs = [['new', 'New'], ['lost', 'Lost'], ['improved', 'Improved'], ['declined', 'Declined']];
  const list = (sc.changes?.[tab] || []).slice(0, limit);
  return (
    <div>
      <div className="px-5 pt-3 flex gap-1.5" role="tablist">{tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`px-3 h-7 rounded-md text-12.5 font-semibold cursor-pointer ${tab === k ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{l}{sc.counts?.[k] != null ? ` (${sc.counts[k]})` : ''}</button>)}</div>
      {list.length === 0 ? <p className="px-5 py-6 text-13 text-slate-500">None in this group.</p> : (
        <table className="mt-2 w-full text-12.5"><thead><tr className="text-left text-11.5 text-slate-500 border-b border-slate-200"><th className="px-5 py-1.5 font-medium">Keyword</th><th className="px-2 py-1.5 font-medium text-right">Previous</th><th className="px-2 py-1.5 font-medium text-right">Current</th><th className="px-5 py-1.5 font-medium text-right">Views</th></tr></thead>
          <tbody>{list.map(r => <tr key={r.keyword} className="border-b border-slate-100"><td className="px-5 py-2"><Link to={`/keyword-overview?q=${encodeURIComponent(r.keyword)}`} className="text-indigo-700 hover:underline">{r.keyword}</Link></td>
            <td className="px-2 py-2  tabular-nums text-slate-500">{tab === 'lost' ? r.position : r.previous ?? '—'}</td><td className="px-2 py-2  tabular-nums">{tab === 'lost' ? '—' : <b style={{ color: posColor(r.position) }}>{r.position}</b>}</td><td className="px-5 py-2  tabular-nums">{fmt(r.views)}</td></tr>)}</tbody></table>
      )}
    </div>
  );
}

export function PageRankingsPage() {
  return <SeoShell title="Organic Rankings" subtitle="One page: how strong its site is, the searches it shows for, its position, its competitors and what it says">{(b) => <PageRankingsBody key={b.id} b={b} />}</SeoShell>;
}
