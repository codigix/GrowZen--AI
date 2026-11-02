import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Play, MapPin, Clock, Loader2, ArrowUp, ArrowDown, Crosshair, Layers, Target, Trophy, Search, RotateCw } from 'lucide-react';
import { SeoShell, Card, Button, SourceTag, ErrorNote, STATUS, Tabs, useUrlTab, useToast, useAction, useModulePath } from './SeoUi';
import PositionLandscape from './PositionLandscape';
import { api, useApi, usePoll, fmtDateTime, fmtDate } from './seoApi';
import { marketOf } from './MarketBadge';

/**
 * Local rank grid: where a business shows in the Google Maps pack, point by point around its pin, for every
 * tracked keyword. A real map carries the grid; a table lists every keyword with its latest scan and the
 * change since the one before; each keyword keeps its scan history. Data: GET/POST /businesses/{id}/rank-scans.
 */

const band = (rank) => (rank == null ? { color: '#f1556c', text: '#fff', label: '20+', name: 'Not in the top 20' } : rank <= 3 ? { color: STATUS.good, text: '#fff', label: rank, name: 'Top 3' }
  : rank <= 10 ? { color: STATUS.warning, text: '#1f2937', label: rank, name: '4–10' } : { color: '#f08a4b', text: '#fff', label: rank, name: '11–20' });

const cellsOf = (s) => (s?.points?.length || s?.grid_size ** 2 || 1);
const topPct = (s) => (s ? Math.round((s.top3 / cellsOf(s)) * 100) : null);
const foundPct = (s) => (s ? Math.round((s.found / cellsOf(s)) * 100) : null);

/** The grid on a real OpenStreetMap map: one numbered circle per scan point, the business pin in the middle. */
function RankMap({ points, center, height = 460 }) {
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  useEffect(() => {
    const m = L.map(el.current, { scrollWheelZoom: false }).setView(center ? [center.lat, center.lng] : [22.5, 79], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors' }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const resize = new ResizeObserver(() => m.invalidateSize());
    resize.observe(el.current);
    return () => { resize.disconnect(); m.remove(); map.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    layer.current.clearLayers();
    const size = points.length > 80 ? 22 : points.length > 40 ? 28 : 34;
    points.forEach(pt => {
      if (pt.lat == null || pt.lng == null) return;
      const s = band(pt.rank);
      const icon = L.divIcon({
        className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2],
        html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${s.color};color:${s.text};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font:700 ${size > 28 ? 12 : 10}px/1 system-ui">${s.label}</div>`
      });
      L.marker([pt.lat, pt.lng], { icon, title: `${pt.rank ? `Rank ${pt.rank}` : 'Not in the top 20'} · ${pt.lat.toFixed?.(4)}, ${pt.lng.toFixed?.(4)}` }).addTo(layer.current);
    });
    if (center) {
      L.marker([center.lat, center.lng], { zIndexOffset: 1000, title: 'Your business pin', icon: L.divIcon({ className: '', iconSize: [14, 14], iconAnchor: [7, 7], html: '<div style="width:14px;height:14px;border-radius:50%;border:3px solid #313a46;background:#fff"></div>' }) }).addTo(layer.current);
    }
    const ll = points.filter(p => p.lat != null).map(p => [p.lat, p.lng]);
    if (ll.length) m.fitBounds(L.latLngBounds(ll).pad(0.12));
  }, [points, center]);
  return <div ref={el} style={{ height }} className="relative isolate z-0 w-full rounded overflow-hidden ring-1 ring-slate-200 bg-slate-100" aria-label="Rank grid on a map" />;
}

const Delta = ({ now, before, better = 'down', unit = '' }) => {
  if (now == null || before == null) return null;
  const d = Math.round((now - before) * 10) / 10;
  if (!d) return <span className="text-11.5 text-slate-400">no change</span>;
  const good = (d < 0) === (better === 'down');
  return <span className={`inline-flex items-center gap-0.5 text-11.5 font-semibold ${good ? 'text-emerald-600' : 'text-red-500'}`}>{d > 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}{Math.abs(d)}{unit}</span>;
};

function Tile({ icon: Icon, label, value, sub, delta, tone = 'indigo' }) {
  const tones = { indigo: 'bg-indigo-50 text-indigo-500', emerald: 'bg-emerald-50 text-emerald-500', amber: 'bg-amber-50 text-amber-500', sky: 'bg-sky-50 text-sky-500' };
  return (
    <div className="ai-glass-card rounded p-3.5 flex items-center gap-3 min-w-0">
      <span className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${tones[tone]}`}><Icon size={17} /></span>
      <div className="min-w-0">
        <div className="text-11.5 font-semibold  tracking-wide text-slate-400 truncate">{label}</div>
        <div className="flex items-baseline gap-2"><span className="text-22 leading-tight font-bold text-slate-900 tabular-nums">{value ?? '—'}</span>{delta}</div>
        {sub && <div className="text-11.5 text-slate-500 truncate">{sub}</div>}
      </div>
    </div>
  );
}

function Spark({ values }) {
  if (values.length < 2) return <span className="text-slate-300">—</span>;
  const max = Math.max(...values), min = Math.min(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 70},${4 + ((v - min) / span) * 20}`).join(' '); // lower rank = higher on the line
  return <svg width="72" height="28" aria-hidden="true"><polyline points={pts} fill="none" stroke="#6658dd" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

function Tracker({ b }) {
  const path = useModulePath();
  const market = marketOf(b);
  const [gridAnyway, setGridAnyway] = useState(false);
  const scans = useApi(`/businesses/${b.id}/rank-scans`);
  const kw = useApi(`/businesses/${b.id}/keywords`);
  const status = useApi('/status');
  const live = status.data?.rank_source === 'serper'; // live Google results cost 3 credits per grid point, so those scans stay small
  const sizes = live ? [3, 5] : [3, 5, 7, 9, 11, 13];
  const [size, setSize] = useState(5);
  const [radius, setRadius] = useState(5);
  const [keyword, setKeyword] = useState('');
  const [scanId, setScanId] = useState(null); // an older scan of the keyword, else the latest
  const [waiting, setWaiting] = useState(null); // scan count when scans were started
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();

  const all = scans.data || [];
  const tracked = (kw.data?.keywords || []).filter(k => k.tracked).map(k => k.keyword);
  const rows = useMemo(() => {
    const by = {};
    [...all].reverse().forEach(s => { (by[s.keyword] = by[s.keyword] || []).push(s); }); // oldest first
    const names = [...new Set([...Object.keys(by), ...tracked])];
    return names.map(k => { const h = by[k] || []; return { keyword: k, history: h, latest: h[h.length - 1], previous: h[h.length - 2] }; })
      .sort((a, c) => (c.latest ? new Date(c.latest.created_at) : 0) - (a.latest ? new Date(a.latest.created_at) : 0));
  }, [all, tracked.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const base = b.primaryCategory ? [`${b.primaryCategory.toLowerCase()} near me`, `${b.primaryCategory.toLowerCase()} in ${(b.area || b.city || '').toLowerCase()}`.trim()] : [];
  const suggestions = [...new Set([...rows.map(r => r.keyword), ...base])].filter(Boolean);
  const kwNow = keyword || rows[0]?.keyword || suggestions[0] || '';
  const row = rows.find(r => r.keyword === kwNow);
  const history = row?.history || [];
  const shownScan = history.find(s => s.id === scanId) || row?.latest;
  const shownIdx = shownScan ? history.findIndex(s => s.id === shownScan.id) : -1;
  const before = shownIdx > 0 ? history[shownIdx - 1] : null;
  const hasPin = b.lat != null && b.lng != null;

  usePoll(() => scans.reload(true), waiting != null);
  useEffect(() => { if (waiting != null && all.length > waiting) { setWaiting(null); toast('Scan finished'); } }, [waiting, all.length, toast]);

  const post = (k) => api(`/businesses/${b.id}/rank-scans`, { method: 'POST', body: { keyword: k, grid_size: size, radius_km: radius } });
  const start = (k = kwNow) => run('scan', async () => {
    if (!hasPin) throw new Error('Set the map pin first: GBP Profile Manager → Profile.');
    await post(k); setKeyword(k); setScanId(null); setWaiting(all.length);
  });
  const scanAll = () => run('all', async () => {
    if (!hasPin) throw new Error('Set the map pin first: GBP Profile Manager → Profile.');
    const list = rows.map(r => r.keyword).slice(0, 10);
    if (live && !window.confirm(`Scan ${list.length} keywords live? That uses about ${list.length * Math.min(size, 5) ** 2 * 3} Serper credits.`)) return;
    for (const k of list) await post(k);
    setScanId(null); setWaiting(all.length);
  });

  const dist = shownScan ? [['1–3', STATUS.good, shownScan.points.filter(p => p.rank && p.rank <= 3).length], ['4–10', STATUS.warning, shownScan.points.filter(p => p.rank > 3 && p.rank <= 10).length],
  ['11–20', '#f08a4b', shownScan.points.filter(p => p.rank > 10).length], ['Not in top 20', '#f1556c', shownScan.points.filter(p => !p.rank).length]] : [];
  const trend = history.map(s => ({ date: fmtDate(s.created_at), 'Average rank': s.avg_rank, 'Top-3 coverage': topPct(s) }));
  const competitors = shownScan?.competitors || [];
  const best = shownScan ? Math.min(...shownScan.points.filter(p => p.rank).map(p => p.rank), Infinity) : null;

  if (!market.grid && !gridAnyway) {
    return (
      <Card>
        <div className="py-8 text-center max-w-xl mx-auto">
          <span className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center mx-auto mb-3"><Crosshair size={22} /></span>
          <div className="text-15 font-semibold text-slate-900">The map grid is for local projects</div>
          <p className="text-13 text-slate-500 mt-1">{b.name} is a <b>{market.short.toLowerCase()}</b> project ({market.label}): its customers aren't searching from streets around one address, so a grid of points would not show how it ranks. Track its Google positions {market.scope === 'national' ? 'country-wide' : 'for the target countries'} instead.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link to={path('organic-rankings')} className="h-9 px-4 rounded inline-flex items-center text-13 font-semibold bg-indigo-500 text-white hover:bg-indigo-600">Open Organic Rankings</Link>
            <Button onClick={() => setGridAnyway(true)}>Use the map grid anyway</Button>
          </div>
          <p className="text-11.5 text-slate-400 mt-3">Does it also serve customers near one location? Change the market to Local in the GBP Profile Manager → Profile.</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* One bar: what to scan, how, and when it last ran */}
      <div className="ai-glass-card rounded p-4 flex flex-wrap items-end gap-3">
        <label className="text-12 font-medium text-slate-500 flex-1 min-w-[240px]">Keyword
          <div className="relative mt-1"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input list="rank-kw" className="w-full h-9 pl-9 pr-3 text-13 rounded border border-slate-200 bg-white focus:border-indigo-400 outline-none text-slate-800" value={kwNow} onChange={e => { setKeyword(e.target.value); setScanId(null); }} placeholder="e.g. dentist near me" />
          </div>
          <datalist id="rank-kw">{suggestions.map(k => <option key={k} value={k} />)}</datalist>
        </label>
        <label className="text-12 font-medium text-slate-500">Grid<select className="block mt-1 h-9 px-2 text-13 rounded border border-slate-200 bg-white text-slate-800" value={size} onChange={e => setSize(Number(e.target.value))}>{sizes.map(n => <option key={n} value={n}>{n} × {n}</option>)}</select></label>
        <label className="text-12 font-medium text-slate-500">Radius<select className="block mt-1 h-9 px-2 text-13 rounded border border-slate-200 bg-white text-slate-800" value={radius} onChange={e => setRadius(Number(e.target.value))}>{[1, 2, 3, 5, 8, 10].map(n => <option key={n} value={n}>{n} km</option>)}</select></label>
        <Button variant="primary" icon={Play} busy={busy === 'scan' || waiting != null} disabled={!kwNow} onClick={() => start()}>{waiting != null ? 'Scanning…' : 'Run scan'}</Button>
        {rows.length > 1 && <Button icon={Layers} busy={busy === 'all'} onClick={scanAll} title="Scan every keyword in the table below">Scan all ({Math.min(rows.length, 10)})</Button>}
        <div className="basis-full text-11.5 text-slate-400 flex flex-wrap items-center gap-x-3">
          <span className="inline-flex items-center gap-1"><Clock size={11} /> {row?.latest ? `Last scan ${fmtDateTime(row.latest.created_at)}` : 'Not scanned yet'}</span>
          <span>{Math.min(size, live ? 5 : size) ** 2} points{live ? ` · live Google Maps, ${Math.min(size, 5) ** 2 * 3} Serper credits per scan` : ' · sample data until live results are connected'}</span>
        </div>
      </div>
      <ErrorNote>{error}</ErrorNote>

      {!hasPin && (
        <div className="rounded bg-amber-50 ring-1 ring-inset ring-amber-200 px-4 py-3 text-13 text-amber-900 flex flex-wrap items-center gap-3">
          <MapPin size={16} className="shrink-0" />
          <span className="flex-1 min-w-[220px]">The grid is drawn around the business's map pin, and {b.name} has none yet.</span>
          <Link to={path('gmb-profile')} className="h-8 px-3 rounded inline-flex items-center text-12.5 font-semibold bg-amber-500 text-white hover:bg-amber-600">Set the pin</Link>
        </div>
      )}

      {!scans.data ? <div className="py-16 flex justify-center text-slate-400"><Loader2 size={18} className="animate-spin" /></div> : !shownScan ? (
        <Card><div className="py-12 text-center text-13 text-slate-500"><Crosshair size={26} className="mx-auto mb-2 text-slate-300" />No scan for “{kwNow || '—'}” yet. Run one to see how you rank street by street.</div></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile icon={Target} tone="emerald" label="Top-3 coverage" value={`${topPct(shownScan)}%`} sub={`${shownScan.top3} of ${cellsOf(shownScan)} points`} delta={<Delta now={topPct(shownScan)} before={topPct(before)} better="up" unit="%" />} />
            <Tile icon={Trophy} tone="indigo" label="Average rank" value={shownScan.avg_rank ?? '—'} sub={Number.isFinite(best) ? `best #${best} · lower is better` : 'not found anywhere'} delta={<Delta now={shownScan.avg_rank} before={before?.avg_rank} better="down" />} />
            <Tile icon={MapPin} tone="sky" label="Found in top 20" value={`${foundPct(shownScan)}%`} sub={`${shownScan.found} of ${cellsOf(shownScan)} points`} delta={<Delta now={foundPct(shownScan)} before={foundPct(before)} better="up" unit="%" />} />
            <div className="ai-glass-card rounded p-3.5 min-w-0"><div className="text-11.5 font-semibold  tracking-wide text-slate-400">Data</div><div className="mt-1.5"><SourceTag source={shownScan.data_source} /></div><div className="text-11.5 text-slate-500 mt-1">{shownScan.data_source === 'sample' ? 'Connect Serper or DataForSEO for live results.' : 'Live Google Maps results.'}</div></div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
            <Card className="xl:col-span-2" title={`“${shownScan.keyword}”`} subtitle={`${shownScan.grid_size}×${shownScan.grid_size} points, ${shownScan.radius_km} km around the pin (white ring)`}
              action={history.length > 1 && (
                <select className="h-8 px-2 text-12.5 rounded border border-slate-200 bg-white text-slate-700" value={shownScan.id} onChange={e => setScanId(Number(e.target.value))} aria-label="Scan to show">
                  {[...history].reverse().map(s => <option key={s.id} value={s.id}>{fmtDateTime(s.created_at)} · avg {s.avg_rank ?? '—'}</option>)}
                </select>)}>
              <RankMap points={shownScan.points} center={hasPin ? { lat: b.lat, lng: b.lng } : null} />
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-12 text-slate-600">
                {dist.map(([l, c, n]) => <span key={l} className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full" style={{ background: c }} />{l}<b className="text-slate-900 tabular-nums">{n}</b></span>)}
              </div>
            </Card>
            <div className="space-y-4">
              <Card title="Who beats you here" subtitle="Businesses that show most often in the top 10" pad={false}>
                {competitors.length === 0 ? <p className="px-6 py-6 text-13 text-slate-500">None recorded for this scan.</p> : (
                  <table className="w-full text-13">
                    <thead className="bg-slate-50 text-11.5  tracking-wide text-slate-500"><tr><th className="px-5 py-2 text-left font-semibold">Business</th><th className="px-3 py-2 text-right font-semibold">Avg</th><th className="px-5 py-2 text-right font-semibold">Top 3</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">{competitors.slice(0, 8).map(c => <tr key={c.name}><td className="px-5 py-2 text-slate-800 max-w-[200px] truncate" title={c.name}>{c.name}</td><td className="px-3 py-2 text-right tabular-nums">{c.avg_rank}</td><td className="px-5 py-2 text-right tabular-nums">{c.top3}</td></tr>)}</tbody>
                  </table>
                )}
              </Card>
              {trend.length > 1 && (
                <Card title="Average rank over time" subtitle="Lower is better">
                  <div className="h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={trend} margin={{ top: 8, right: 10, left: -18, bottom: 0 }}>
                        <defs><linearGradient id="rk" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6658dd" stopOpacity={0.28} /><stop offset="100%" stopColor="#6658dd" stopOpacity={0.02} /></linearGradient></defs>
                        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" vertical={false} />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} minTickGap={16} />
                        <YAxis reversed domain={[1, 'dataMax + 2']} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} allowDecimals={false} />
                        <Tooltip />
                        <Area type="monotone" dataKey="Average rank" stroke="#6658dd" strokeWidth={2.5} fill="url(#rk)" connectNulls dot={{ r: 3, fill: '#fff', strokeWidth: 2 }} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              )}
            </div>
          </div>
        </>
      )}

      {/* Every keyword, its latest scan and the change since the one before */}
      {rows.length > 0 && (
        <Card title={`Keywords (${rows.length})`} subtitle="Click a row to see its grid. The change is against the scan before the latest." pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-13 min-w-[760px]">
              <thead className="bg-slate-50 text-11.5  tracking-wide text-slate-500"><tr>
                <th className="px-5 py-2.5 text-left font-semibold">Keyword</th><th className="px-3 py-2.5 text-left font-semibold">Last scan</th><th className="px-3 py-2.5 text-right font-semibold">Avg rank</th>
                <th className="px-3 py-2.5 text-right font-semibold">Top-3 coverage</th><th className="px-3 py-2.5 text-right font-semibold">Found</th><th className="px-3 py-2.5 text-left font-semibold">Trend</th><th className="px-5 py-2.5 text-right font-semibold"> </th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(r => (
                  <tr key={r.keyword} onClick={() => { setKeyword(r.keyword); setScanId(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className={`cursor-pointer hover:bg-slate-50 ${r.keyword === kwNow ? 'bg-indigo-50/50' : ''}`}>
                    <td className="px-5 py-2.5 font-semibold text-slate-900">{r.keyword}</td>
                    <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{r.latest ? fmtDateTime(r.latest.created_at) : <span className="text-slate-400">Not scanned</span>}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">{r.latest ? <><span className="font-semibold tabular-nums">{r.latest.avg_rank ?? '—'}</span> <Delta now={r.latest.avg_rank} before={r.previous?.avg_rank} better="down" /></> : '—'}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">{r.latest ? <><span className="font-semibold tabular-nums">{topPct(r.latest)}%</span> <Delta now={topPct(r.latest)} before={topPct(r.previous)} better="up" unit="%" /></> : '—'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.latest ? `${foundPct(r.latest)}%` : '—'}</td>
                    <td className="px-3 py-2.5"><Spark values={r.history.map(s => s.avg_rank).filter(v => v != null)} /></td>
                    <td className="px-5 py-2.5 text-right"><Button size="sm" icon={RotateCw} disabled={waiting != null} onClick={e => { e.stopPropagation(); start(r.keyword); }}>Scan</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {toastNode}
    </div>
  );
}

function Page({ b }) {
  const [tab, setTab] = useUrlTab('landscape', ['landscape', 'geo']);
  return (
    <>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'landscape', label: 'Landscape' }, { id: 'geo', label: 'Geo-grid (Maps pack)' }]} />
      {tab === 'landscape' ? <PositionLandscape key={b.id} b={b} /> : <Tracker key={b.id} b={b} />}
    </>
  );
}

export default function LocalRankTrackerPage() {
  return (
    <SeoShell title="Position Tracking" subtitle="Visibility, estimated traffic and positions of your tracked keywords on Google, and how you rank in the Maps pack">
      {(b) => <Page key={b.id} b={b} />}
    </SeoShell>
  );
}
