import React, { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Play, MapPin, Clock, Loader2 } from 'lucide-react';
import { SeoShell, Card, Stat, Button, SourceTag, ErrorNote, ChartTooltip, SERIES, STATUS, INK, useToast, useAction } from './SeoUi';
import { api, useApi, usePoll, fmtDateTime, fmtDate } from './seoApi';

// Rank bands use the status colors, and every point also shows its number.
const band = (rank) => (rank == null ? { color: STATUS.critical, text: '#fff', label: '20+' } : rank <= 3 ? { color: STATUS.good, text: '#fff', label: rank } : rank <= 10 ? { color: STATUS.warning, text: '#0b0b0b', label: rank } : { color: STATUS.serious, text: '#fff', label: rank });

const FauxMap = () => (
  <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    <rect width="100" height="100" fill="#eef2ec" />
    <path d="M0 62 C 30 55, 55 70, 100 58" stroke="#c9d6e8" strokeWidth="5" fill="none" />
    <path d="M18 0 L 26 100" stroke="#fff" strokeWidth="2.2" /><path d="M0 30 L 100 26" stroke="#fff" strokeWidth="2.2" />
    <path d="M62 0 L 55 100" stroke="#fff" strokeWidth="1.6" /><path d="M0 80 L 100 86" stroke="#fff" strokeWidth="1.6" />
    <path d="M40 0 C 44 40, 36 60, 44 100" stroke="#fde9b8" strokeWidth="2.6" fill="none" />
  </svg>
);

function Grid({ points, size, label }) {
  const mid = (size - 1) / 2;
  return (
    <div className="relative rounded overflow-hidden border border-gray-200 aspect-square">
      <FauxMap />
      <div className="absolute inset-0 grid p-[4%]" style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}>
        {points.map((c, i) => {
          const s = band(c.rank);
          return (
            <div key={i} className="flex items-center justify-center">
              <span title={`${c.lat}, ${c.lng}: ${c.rank ? `rank ${c.rank}` : 'not in top 20'}`} className={`rounded-full flex items-center justify-center font-semibold ring-2 ${c.x === mid && c.y === mid ? 'ring-gray-900' : 'ring-white'}`}
                style={{ background: s.color, color: s.text, width: size > 9 ? 22 : 30, height: size > 9 ? 22 : 30, fontSize: size > 9 ? 9 : 12 }}>{s.label}</span>
            </div>
          );
        })}
      </div>
      {label && <span className="absolute top-2 left-2 bg-white/90 rounded px-1.5 py-0.5 text-[11px] text-gray-700">{label}</span>}
    </div>
  );
}

function Tracker({ b }) {
  const scans = useApi(`/businesses/${b.id}/rank-scans`);
  const kw = useApi(`/businesses/${b.id}/keywords`);
  const suggestions = useMemo(() => {
    const tracked = (kw.data?.keywords || []).filter(k => k.tracked).map(k => k.keyword);
    const fromScans = (scans.data || []).map(s => s.keyword);
    const base = b.primaryCategory ? [`${b.primaryCategory.toLowerCase()} near me`, `${b.primaryCategory.toLowerCase()} in ${(b.area || b.city || '').toLowerCase()}`.trim()] : [];
    return [...new Set([...fromScans, ...tracked, ...base])].filter(Boolean);
  }, [kw.data, scans.data, b]);
  const [keyword, setKeyword] = useState('');
  const [size, setSize] = useState(7);
  const [radius, setRadius] = useState(5);
  const [waiting, setWaiting] = useState(null); // scan count when a scan was started
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const kwNow = keyword || suggestions[0] || '';
  const forKw = (scans.data || []).filter(s => s.keyword === kwNow);
  const latest = forKw[0];
  usePoll(() => scans.reload(true), waiting != null);
  const scanCount = (scans.data || []).length;
  useEffect(() => {
    if (waiting != null && scanCount > waiting) { setWaiting(null); toast('Scan finished'); }
  }, [waiting, scanCount, toast]);

  const start = () => run('scan', async () => {
    if (b.lat == null || b.lng == null) throw new Error('Set the map pin (latitude/longitude) in GBP Manager → Profile first.');
    await api(`/businesses/${b.id}/rank-scans`, { method: 'POST', body: { keyword: kwNow, grid_size: size, radius_km: radius } });
    setWaiting((scans.data || []).length);
  });
  const history = [...forKw].reverse().map(s => ({ date: fmtDate(s.created_at), 'Average rank': s.avg_rank }));
  const cells = latest?.points?.length || 1;

  return (
    <>
      <div className="flex flex-wrap items-end gap-3 mb-4 bg-white border border-gray-200 rounded p-3">
        <label className="text-[12px] text-gray-600">Keyword
          <input list="rank-kw" className="block mt-1 h-8 px-2 text-[13px] border border-gray-300 rounded bg-white min-w-[240px]" value={kwNow} onChange={e => setKeyword(e.target.value)} />
          <datalist id="rank-kw">{suggestions.map(k => <option key={k} value={k} />)}</datalist>
        </label>
        <label className="text-[12px] text-gray-600">Grid<select className="block mt-1 h-8 px-2 text-[13px] border border-gray-300 rounded bg-white" value={size} onChange={e => setSize(Number(e.target.value))}>{[3, 5, 7, 9, 11, 13].map(n => <option key={n} value={n}>{n} × {n}</option>)}</select></label>
        <label className="text-[12px] text-gray-600">Radius<select className="block mt-1 h-8 px-2 text-[13px] border border-gray-300 rounded bg-white" value={radius} onChange={e => setRadius(Number(e.target.value))}>{[1, 2, 3, 5, 8, 10].map(n => <option key={n} value={n}>{n} km</option>)}</select></label>
        <div className="text-[12px] text-gray-500 flex items-center gap-1.5 pb-2"><Clock size={12} /> {latest ? `Last scan ${fmtDateTime(latest.created_at)}` : 'Not scanned yet'} · {size * size} points</div>
        <Button variant="primary" icon={Play} className="ml-auto" busy={busy === 'scan' || waiting != null} disabled={!kwNow} onClick={start}>{waiting != null ? 'Scanning…' : 'Run scan'}</Button>
      </div>
      <ErrorNote>{error}</ErrorNote>

      {!scans.data ? <div className="py-16 flex justify-center text-gray-400"><Loader2 size={16} className="animate-spin" /></div> : !latest ? (
        <Card><div className="py-12 text-center text-[13px] text-gray-500">No scan for “{kwNow || '—'}” yet. Run one to see how you rank street by street.</div></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4 mt-2">
            <Stat label="Average rank (where found)" value={latest.avg_rank ?? '—'} hint="lower is better" />
            <Stat label="Points in the top 3" value={`${latest.top3} / ${cells}`} hint={`${Math.round((latest.top3 / cells) * 100)}% of the area`} />
            <Stat label="Found in the top 20" value={`${latest.found} / ${cells}`} />
            <div className="bg-white border border-gray-200 rounded p-3.5"><div className="text-[12px] text-gray-500">Data</div><div className="mt-2"><SourceTag source={latest.data_source} /></div><div className="text-[11px] text-gray-500 mt-1">{latest.data_source === 'sample' ? 'Connect DataForSEO for live Maps ranks' : 'Google Maps results'}</div></div>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 mb-4">
            <Card title={`Map grid for “${latest.keyword}”`} subtitle={`${latest.grid_size}×${latest.grid_size} points, ${latest.radius_km} km around the pin (black ring)`} className="xl:col-span-3">
              <div className="max-w-[560px] mx-auto"><Grid points={latest.points} size={latest.grid_size} label={<><MapPin size={10} className="inline" /> {[b.area, b.city].filter(Boolean).join(', ')}</>} /></div>
              <div className="flex flex-wrap justify-center gap-3 mt-3 text-[12px] text-gray-600">
                {[['1–3', STATUS.good], ['4–10', STATUS.warning], ['11–20', STATUS.serious], ['Not in top 20', STATUS.critical]].map(([l, c]) => <span key={l} className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full" style={{ background: c }} />{l}</span>)}
              </div>
            </Card>
            <Card title="Competitors on this grid" subtitle="Businesses that appear most in the top 10" className="xl:col-span-2">
              {(latest.competitors || []).length === 0 ? <div className="text-[13px] text-gray-500">None recorded.</div> : (
                <table className="w-full text-[13px]">
                  <thead className="text-[12px] text-gray-500 border-b border-gray-200"><tr><th className="p-2 text-left font-medium">Business</th><th className="p-2 text-right font-medium">Avg rank</th><th className="p-2 text-right font-medium">Top-3 points</th></tr></thead>
                  <tbody className="divide-y divide-gray-100">{latest.competitors.map(c => <tr key={c.name}><td className="p-2 text-gray-900">{c.name}</td><td className="p-2 text-right tabular-nums">{c.avg_rank}</td><td className="p-2 text-right tabular-nums">{c.top3}</td></tr>)}</tbody>
                </table>
              )}
            </Card>
          </div>
          {history.length > 1 && (
            <Card title={`Average rank over time for “${latest.keyword}”`} subtitle="Lower is better">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history} margin={{ top: 8, right: 12, left: -14, bottom: 0 }}>
                    <CartesianGrid stroke={INK.grid} vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: INK.muted }} tickLine={false} axisLine={{ stroke: INK.axis }} />
                    <YAxis reversed domain={[1, 'dataMax + 2']} tick={{ fontSize: 11, fill: INK.muted }} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Line type="monotone" dataKey="Average rank" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
        </>
      )}
      {toastNode}
    </>
  );
}

export default function LocalRankTrackerPage() {
  return (
    <SeoShell title="Local rank grid" subtitle="How you rank in the Map Pack across your area, point by point">
      {(b) => <Tracker key={b.id} b={b} />}
    </SeoShell>
  );
}
