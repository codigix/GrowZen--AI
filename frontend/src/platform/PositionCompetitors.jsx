import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, ScatterChart, Scatter, BarChart, Bar, Cell, ReferenceLine, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip } from 'recharts';
import { ExternalLink, Plus, Check, Settings2, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, Badge, Button, useAction, useModulePath } from './SeoUi';
import { api } from './seoApi';
import { AXIS, PALETTE, Chg, Empty, Filter } from './PositionUi';
import Select from '../components/Select';

const DEPTHS = [[20, 'Top 20'], [10, 'Top 10'], [5, 'Top 5'], [3, 'Top 3']]; // Google results are read to the top 20
const host = (u) => String(u || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '');
const sel = 'h-9 px-2.5 text-13 rounded border border-slate-200 bg-white text-slate-700 cursor-pointer';
const dash = <span className="text-slate-300">—</span>;
const IGNORE_KEY = 'positionIgnoredDomains';
const readIgnored = (id) => { try { return JSON.parse(localStorage.getItem(`${IGNORE_KEY}.${id}`) || '[]'); } catch (e) { return []; } };

/**
 * The row's gear: open the domain, then the analyses available for it. Your own domain opens your Domain Overview, Organic Rankings and backlinks;
 * a competitor can be audited, compared with you, or looked up in the stored backlinks. It can also be tracked or hidden from these lists.
 */
function RowMenu({ c, onTrack, onIgnore, tracked }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const go = (to) => () => navigate(to);
  const items = c.you
    ? [['Analyze in Domain Overview', '/domain-overview'], ['Analyze organic traffic', '/organic-rankings'], ['Analyze backlinks', '/backlink-intelligence']]
    : [['Audit this website', `/website-audit?tab=audit&url=${encodeURIComponent(`https://${c.domain}`)}`], ['Compare with your domain', '/compare-domains'], ['Find its backlinks', `/backlink-intelligence?q=${encodeURIComponent(c.domain)}`]];
  const item = 'w-full text-left px-4 py-2.5 hover:bg-slate-50 text-slate-800 cursor-pointer';
  return (
    <div className="relative inline-block text-left">
      <button type="button" aria-label={`Actions for ${c.domain}`} aria-expanded={open} onClick={() => setOpen(o => !o)} onBlur={() => setTimeout(() => setOpen(false), 150)} className="p-1 text-slate-500 hover:text-slate-900 cursor-pointer"><Settings2 size={15} /></button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1 z-20 w-60 rounded bg-white shadow-lg ring-1 ring-slate-200 py-1 text-14">
          <a href={`https://${c.domain}`} target="_blank" rel="noreferrer" role="menuitem" className={`${item} block`}>Open domain</a>
          <div className="my-1 border-t border-slate-200" />
          <div className="px-4 pt-1.5 pb-1 text-14 font-semibold text-slate-900">bevisibe analytics:</div>
          {items.map(([label, to]) => <button key={label} type="button" role="menuitem" onMouseDown={go(to)} className={item}>{label}</button>)}
          {!c.you && <div className="my-1 border-t border-slate-200" />}
          {!c.you && !tracked && <button type="button" role="menuitem" onMouseDown={() => onTrack(c.domain)} className={item}>Track as competitor</button>}
          {!c.you && <button type="button" role="menuitem" onMouseDown={() => onIgnore(c.domain)} className={item}>Ignore this domain</button>}
        </div>
      )}
    </div>
  );
}

/** Competitors Discovery: the domains in the Google results of your keywords on a map and in a table, with filters, ignoring and one-click tracking. */
export default function PositionCompetitors({ d, b, onChanged }) {
  const path_ = useModulePath();
  const [depth, setDepth] = useState(20);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [mapView, setMapView] = useState('competitors');
  const [smart, setSmart] = useState(false);
  const [plat, setPlat] = useState(false);
  const [off, setOff] = useState(() => new Set());
  const [ignored, setIgnored] = useState(() => readIgnored(b.id));
  const [showIgnored, setShowIgnored] = useState(false);
  const [page, setPage] = useState(1);
  const [per, setPer] = useState(10);
  const [busy, error, run] = useAction();
  const tracked = new Set((d.tracked_competitors || []).map(host));

  const tags = [...new Set(d.all_keywords.map(r => r.tag).filter(Boolean))];
  const kwOf = useMemo(() => Object.fromEntries(d.all_keywords.map(r => [r.keyword, r])), [d.all_keywords]);
  const base = useMemo(() => [...(d.competitors_all || []), ...(plat ? (d.platforms || []).map(p => ({ ...p, platform: true })) : [])], [d, plat]);
  const rows = useMemo(() => base.filter(c => {
    if (!c.you && ignored.includes(c.domain)) return false;
    // A domain is within a depth when it ranks at or above it for any tracked keyword (the bands kept are the top 3, 10 and 20; "Top 5" is the top 10 with a best average position of 8)
    const within = depth === 20 ? c.top20.count > 0 : depth === 10 ? c.top10.count > 0 : depth === 3 ? c.top3.count > 0 : (c.top10.count > 0 && (c.avg_position ?? 99) <= 8);
    return (c.you || within) && (!q || (c.kw || []).some(k => k.toLowerCase().includes(q.toLowerCase())) || c.domain.includes(q.toLowerCase()))
      && (!tag || (c.kw || []).some(k => kwOf[k]?.tag === tag));
  }).sort((a, z) => (z.visibility || 0) - (a.visibility || 0)), [base, ignored, depth, q, tag, kwOf]);
  const mine = rows.find(c => c.you);
  const others = rows.filter(c => !c.you);
  const rankOf = (c) => rows.indexOf(c) + 1;
  const pages = Math.max(1, Math.ceil(others.length / per));
  const cur = Math.min(page, pages);
  const slice = others.slice((cur - 1) * per, cur * per);

  const ignore = (dom) => { const n = [...new Set([...ignored, dom])]; setIgnored(n); try { localStorage.setItem(`${IGNORE_KEY}.${b.id}`, JSON.stringify(n)); } catch (e) { /* private window */ } };
  const unignore = (dom) => { const n = ignored.filter(x => x !== dom); setIgnored(n); try { localStorage.setItem(`${IGNORE_KEY}.${b.id}`, JSON.stringify(n)); } catch (e) { /* private window */ } };
  const track = (domain) => run(domain, async () => { await api(`/businesses/${b.id}/seo/track-competitor`, { method: 'POST', body: { domain } }); onChanged(); });

  const movers = [...rows].filter(c => c.change != null && c.change !== 0).sort((a, z) => z.change - a.change);
  const winners = movers.filter(c => c.change > 0).slice(0, 10);
  const losers = movers.filter(c => c.change < 0).slice(-10);
  const moverBars = [...winners, ...losers].map(c => ({ domain: c.domain, change: c.change, visibility: c.visibility, you: c.you }));
  const mapRows = (mapView === 'losers' ? [...winners, ...[...losers].reverse()] : others).slice(0, 25);
  const plotted = mapRows.filter(c => c.avg_position != null && !off.has(c.domain));
  const colorOf = (c) => PALETTE[(others.indexOf(c)) % PALETTE.length];
  const posDomain = smart ? ['dataMin - 2', 'dataMax + 2'] : [1, 20];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-13 text-slate-600 inline-flex items-center gap-1">Depth <Info size={12} className="text-slate-300" title="Google results are read to the top 20, so Top 50 and Top 100 are not offered" /></span>
        <div className="inline-flex rounded border border-slate-200 overflow-hidden">{DEPTHS.map(([n, l]) => <button key={n} type="button" onClick={() => { setDepth(n); setPage(1); }} className={`h-9 px-3 text-13 border-r last:border-r-0 border-slate-200 cursor-pointer ${depth === n ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>{l}</button>)}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Filter value={q} onChange={v => { setQ(v); setPage(1); }} placeholder="Filter by keyword or domain" />
        {tags.length > 0 && <Select className={sel} value={tag} onChange={e => { setTag(e.target.value); setPage(1); }} aria-label="Tags"><option value="">Tags</option>{tags.map(t => <option key={t}>{t}</option>)}</Select>}
        <label className="h-9 px-3 inline-flex items-center gap-2 rounded border border-slate-200 bg-white text-13 text-slate-700 cursor-pointer"><input type="checkbox" checked={plat} onChange={e => setPlat(e.target.checked)} />Directories &amp; social{d.platform_total ? ` (${d.platform_total})` : ''}</label>
        <button type="button" onClick={() => setShowIgnored(o => !o)} className={`${sel} inline-flex items-center`}>Ignored domains{ignored.length ? ` (${ignored.length})` : ''}</button>
      </div>
      {showIgnored && (
        <div className="rounded border border-slate-200 bg-white px-4 py-3 text-13">
          {ignored.length ? <div className="flex flex-wrap gap-2">{ignored.map(x => <span key={x} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">{x}<button type="button" aria-label={`Stop ignoring ${x}`} onClick={() => unignore(x)} className="text-slate-400 hover:text-slate-800 cursor-pointer">×</button></span>)}</div> : <span className="text-slate-500">No domain is ignored. Use a row's gear menu to hide a domain from these lists.</span>}
        </div>
      )}

      <Card title="Competition Map" pad={false}>
        <div className="px-5 py-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100">
          <label className="inline-flex items-center gap-2 text-14 text-slate-800 cursor-pointer"><input type="checkbox" checked={smart} onChange={e => setSmart(e.target.checked)} />Smart zoom</label>
          <div className="inline-flex rounded border border-slate-200 overflow-hidden">{[['competitors', 'Competitors'], ['losers', 'Winners & Losers']].map(([id, l]) => <button key={id} type="button" onClick={() => setMapView(id)} className={`h-9 px-3 text-13 border-r last:border-r-0 border-slate-200 cursor-pointer ${mapView === id ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>{l}</button>)}</div>
        </div>
        <div className="px-5 pb-5 grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6 items-start">
          {mapView === 'losers' ? (
            <div className="h-80">
              {moverBars.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={moverBars} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 16 }} barCategoryGap={4}>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" horizontal={false} />
                    <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} label={{ value: 'Change in visibility (points)', position: 'insideBottom', offset: -8, fontSize: 12, fill: '#475569' }} />
                    <YAxis type="category" dataKey="domain" tick={{ ...AXIS, fontSize: 11 }} tickLine={false} axisLine={false} width={130} interval={0} />
                    <ReferenceLine x={0} stroke="#94a3b8" />
                    <Tooltip cursor={{ fill: 'rgba(100,116,139,0.08)' }} formatter={(v, n, item) => [`${v > 0 ? '+' : ''}${v} points (now ${item.payload.visibility}%)`, 'Visibility']} />
                    <Bar dataKey="change" radius={[3, 3, 3, 3]} isAnimationActive={false}>{moverBars.map(x => <Cell key={x.domain} fill={x.change > 0 ? '#10b981' : '#ef4444'} stroke={x.you ? '#1e293b' : 'none'} strokeWidth={x.you ? 2 : 0} />)}</Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : <Empty>Winners and losers appear after a second position check on another day, when visibility can be compared.</Empty>}
              {moverBars.length > 0 && <div className="flex gap-5 justify-center text-12 text-slate-600 -mt-1"><span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />Winners: gained visibility</span><span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-red-500" />Losers: lost visibility</span></div>}
            </div>
          ) : (
          <div className="h-80">
            {plotted.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 10, right: 16, left: 4, bottom: 22 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" />
                  <XAxis type="number" dataKey="keywords" name="Keywords" tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} domain={[0, 'dataMax + 1']} label={{ value: 'Number of Keywords', position: 'insideBottom', offset: -12, fontSize: 12, fill: '#475569' }} />
                  <YAxis type="number" dataKey="avg_position" name="Avg. position" reversed tick={AXIS} tickLine={false} axisLine={false} width={44} domain={posDomain} label={{ value: 'Average Position', angle: -90, position: 'insideLeft', fontSize: 12, fill: '#475569' }} />
                  <ZAxis type="number" dataKey="visibility" range={[200, 1800]} />
                  <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ payload }) => payload?.[0] ? <div className="bg-white border border-slate-200 rounded px-2.5 py-1.5 text-12"><b>{payload[0].payload.domain}</b><div>{payload[0].payload.keywords} keywords · avg position {payload[0].payload.avg_position}</div><div>Visibility {payload[0].payload.visibility}%{payload[0].payload.change ? ` (${payload[0].payload.change > 0 ? '+' : ''}${payload[0].payload.change})` : ''}</div></div> : null} />
                  {plotted.map(c => <Scatter key={c.domain} name={c.domain} data={[c]} fill={colorOf(c)} fillOpacity={0.55} />)}
                </ScatterChart>
              </ResponsiveContainer>
            ) : <Empty>Competitors appear after the first position check.</Empty>}
          </div>
          )}
          <div>
            <div className="flex justify-between text-12 text-slate-500 px-1 pb-2 border-b border-slate-100"><span>Competitor</span><span>Visibility{mapView === 'losers' ? ' change' : ''}</span></div>
            <ul className="max-h-72 overflow-y-auto divide-y divide-slate-100">
              {mapRows.map(c => (
                <li key={c.domain} className="flex items-center gap-3 py-2 text-14">
                  <input type="checkbox" aria-label={`Show ${c.domain}`} checked={!off.has(c.domain)} style={{ accentColor: colorOf(c) }} onChange={() => setOff(s => { const n = new Set(s); n.has(c.domain) ? n.delete(c.domain) : n.add(c.domain); return n; })} />
                  <span className="flex-1 min-w-0 truncate text-slate-800">{c.domain}</span>
                  <span className="tabular-nums text-slate-800">{mapView === 'losers' ? <Chg v={c.change} /> : c.visibility}</span>
                </li>))}
              {!mapRows.length && <li className="py-6 text-center text-13 text-slate-500">Nothing to show yet.</li>}
            </ul>
          </div>
        </div>
      </Card>

      <Card title={<span>Competitors <span className="text-slate-500 font-normal">{others.length ? `${(cur - 1) * per + 1}-${Math.min(cur * per, others.length)}` : '0'} ({others.length})</span></span>} pad={false}
        action={(d.tracked_competitors || []).length === 0 ? <Link to={path_('competitor-finder')} className="h-8 px-3 rounded inline-flex items-center text-12.5 font-semibold border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">Find more competitors</Link> : null}>
        <div className="overflow-x-auto">
          <table className="w-full text-14 min-w-[900px]">
            <thead className="bg-slate-50 text-12 text-slate-600">
              <tr><th className="px-4 py-3 w-14" /><th className="px-4 py-3 text-left font-semibold">Domain</th><th className="px-4 py-3 text-right font-semibold" colSpan={2}>Visibility</th><th className="px-3 py-3 text-right font-semibold">Diff</th>
                <th className="px-3 py-3 text-right font-semibold">Est. Traffic</th><th className="px-3 py-3 text-right font-semibold">Diff</th><th className="px-3 py-3 text-right font-semibold">Keywords</th><th className="px-3 py-3 text-right font-semibold">Avg. Pos.</th><th className="w-10" /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...(mine ? [mine] : []), ...slice].map(c => (
                <tr key={c.domain} className={c.you ? 'bg-indigo-50/40' : 'hover:bg-slate-50'}>
                  <td className="px-4 py-3 text-slate-700 tabular-nums">{c.you && c.not_ranking ? '—' : rankOf(c)}.</td>
                  <td className="px-4 py-3"><a href={`https://${c.domain}`} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline inline-flex items-center gap-1">{c.domain}<ExternalLink size={11} /></a>
                    {c.you && <span className="ml-2 text-11 text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">You</span>}
                    {c.platform && <Badge className="ml-2">directory</Badge>}
                    {!c.you && (tracked.has(c.domain) ? <Badge tone="green" className="ml-2"><Check size={11} /> Tracked</Badge> : <button type="button" disabled={busy === c.domain} onClick={() => track(c.domain)} className="ml-2 inline-flex items-center gap-0.5 text-12 text-indigo-600 hover:underline cursor-pointer"><Plus size={11} />Track</button>)}</td>
                  <td className="px-2 py-3 text-right tabular-nums">{c.visibility}%</td>
                  <td className="px-2 py-3 w-28"><div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, c.visibility || 0)}%` }} /></div></td>
                  <td className="px-3 py-3 text-right">{c.change == null ? dash : c.change ? <Chg v={c.change} /> : <span className="text-slate-500">0</span>}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{d.has_volume ? c.traffic : dash}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{!d.has_volume || c.traffic_change == null ? dash : c.traffic_change ? <Chg v={c.traffic_change} /> : <span className="text-slate-500">0</span>}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{c.keywords}</td>
                  <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{c.avg_position != null ? <>{Number(c.avg_position).toFixed(2)}{c.avg_position_sd ? <span className="text-slate-500"> ± {Number(c.avg_position_sd).toFixed(2)}</span> : null}</> : dash}</td>
                  <td className="px-2 py-3"><RowMenu c={c} tracked={tracked.has(c.domain)} onTrack={track} onIgnore={ignore} /></td>
                </tr>))}
              {!mine && !slice.length && <tr><td colSpan={10} className="px-5 py-10 text-center text-slate-500">No domain matches. Competitors appear after the first position check.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex flex-wrap items-center gap-3 text-13 text-slate-700">
          <button type="button" disabled={cur <= 1} onClick={() => setPage(1)} aria-label="First page" className="h-8 w-8 rounded border border-slate-200 disabled:opacity-40 inline-flex items-center justify-center cursor-pointer"><ChevronLeft size={14} /></button>
          <button type="button" disabled={cur <= 1} onClick={() => setPage(cur - 1)} className="h-8 px-3 rounded border border-slate-200 disabled:opacity-40 cursor-pointer">Prev</button>
          <button type="button" disabled={cur >= pages} onClick={() => setPage(cur + 1)} className="h-8 px-3 rounded bg-slate-900 text-white disabled:opacity-40 cursor-pointer inline-flex items-center gap-1">Next<ChevronRight size={13} /></button>
          <span>Page: <b>{cur}</b> of <span className="text-indigo-600">{pages}</span></span>
          <Select value={per} onChange={e => { setPer(Number(e.target.value)); setPage(1); }} className="h-8 px-2 rounded border border-slate-200 bg-white" aria-label="Rows per page">{[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}</Select>
        </div>
        {error && <p className="px-5 pb-3 text-12 text-rose-600">{error}</p>}
      </Card>
      <p className="text-11.5 text-slate-400">Positions are read to Google's top 20, so depths of 50 and 100 are not offered. Ignored domains are remembered in this browser.</p>
    </div>
  );
}
