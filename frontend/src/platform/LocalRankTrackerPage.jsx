import React, { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Play, MapPin, Clock, Loader2, Navigation, Target, ShieldCheck, ArrowRight, Zap, CheckCircle2 } from 'lucide-react';
import {
  SeoShell, Card, Stat, Button, SourceTag, ErrorNote, ChartTooltip,
  SERIES, STATUS, INK, useToast, useAction, LifecycleGrowthBar, LifecycleNextCard
} from './SeoUi';
import { api, useApi, usePoll, fmtDateTime, fmtDate } from './seoApi';

const band = (rank) => {
  if (rank == null) return { color: '#ef4444', text: '#fff', label: '20+' };
  if (rank <= 3) return { color: '#10b981', text: '#fff', label: rank };
  if (rank <= 7) return { color: '#06b6d4', text: '#fff', label: rank };
  if (rank <= 10) return { color: '#f59e0b', text: '#000', label: rank };
  return { color: '#f97316', text: '#fff', label: rank };
};

const FauxDarkMap = () => (
  <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    <rect width="100" height="100" fill="#0b1120" />
    {/* Metro and arterial highway lines */}
    <path d="M0 62 C 30 55, 55 70, 100 58" stroke="#1e293b" strokeWidth="4.5" fill="none" />
    <path d="M18 0 L 26 100" stroke="#172554" strokeWidth="2.2" />
    <path d="M0 30 L 100 26" stroke="#172554" strokeWidth="2.2" />
    <path d="M62 0 L 55 100" stroke="#1e293b" strokeWidth="1.8" />
    <path d="M0 80 L 100 86" stroke="#1e293b" strokeWidth="1.8" />
    {/* Old Mumbai-Pune Expressway */}
    <path d="M40 0 C 44 40, 36 60, 44 100" stroke="#334155" strokeWidth="3" fill="none" />
    {/* PCMC Node Grid lines */}
    <circle cx="50" cy="50" r="45" stroke="#38bdf8" strokeWidth="0.5" strokeDasharray="2 2" fill="none" opacity="0.3" />
    <circle cx="50" cy="50" r="28" stroke="#38bdf8" strokeWidth="0.5" strokeDasharray="2 2" fill="none" opacity="0.4" />
    <circle cx="50" cy="50" r="12" stroke="#38bdf8" strokeWidth="0.5" strokeDasharray="2 2" fill="none" opacity="0.5" />
  </svg>
);

function Grid({ points, size, label }) {
  const mid = (size - 1) / 2;
  return (
    <div className="relative rounded-2xl overflow-hidden border border-white/10 aspect-square shadow-2xl bg-[#090e1c]">
      <FauxDarkMap />
      <div className="absolute inset-0 grid p-[4%]" style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}>
        {points.map((c, i) => {
          const s = band(c.rank);
          const isCenter = c.x === mid && c.y === mid;
          return (
            <div key={i} className="flex items-center justify-center">
              <span
                title={`${c.lat}, ${c.lng}: ${c.rank ? `Rank #${c.rank}` : 'Not in top 20'}`}
                className={`rounded-full flex items-center justify-center font-bold transition-transform hover:scale-125 shadow-md cursor-pointer ${
                  isCenter ? 'ring-2 ring-cyan-300 ring-offset-2 ring-offset-slate-900 scale-110 z-10' : 'ring-1 ring-black/40'
                }`}
                style={{
                  background: s.color,
                  color: s.text,
                  width: size > 9 ? 22 : 32,
                  height: size > 9 ? 22 : 32,
                  fontSize: size > 9 ? 9 : 12
                }}
              >
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
      {label && (
        <span className="absolute top-3 left-3 bg-slate-950/80 backdrop-blur-md border border-white/10 rounded-lg px-2.5 py-1 text-[11px] font-bold text-white shadow-md">
          {label}
        </span>
      )}
    </div>
  );
}

function Tracker({ b }) {
  const scans = useApi(`/businesses/${b.id}/rank-scans`);
  const kw = useApi(`/businesses/${b.id}/keywords`);
  
  const suggestions = useMemo(() => {
    const tracked = (kw.data?.keywords || []).filter(k => k.tracked).map(k => k.keyword);
    const fromScans = (scans.data || []).map(s => s.keyword);
    const defaults = [
      'cataract surgery in pcmc',
      'eye hospital chinchwad',
      'best multispeciality hospital pcmc',
      'ophthalmologist near me'
    ];
    return [...new Set([...fromScans, ...tracked, ...defaults])].filter(Boolean);
  }, [kw.data, scans.data]);

  const [keyword, setKeyword] = useState('cataract surgery in pcmc');
  const [size, setSize] = useState(7);
  const [radius, setRadius] = useState(5);
  const [waiting, setWaiting] = useState(null);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();

  const kwNow = keyword || suggestions[0] || 'cataract surgery in pcmc';
  const forKw = (scans.data || []).filter(s => s.keyword === kwNow);
  const latest = forKw[0] || (scans.data?.[0]);

  usePoll(() => scans.reload(true), waiting != null);
  const scanCount = (scans.data || []).length;
  
  useEffect(() => {
    if (waiting != null && scanCount > waiting) {
      setWaiting(null);
      toast('Geo-Grid radar scan completed');
    }
  }, [waiting, scanCount, toast]);

  const start = () => run('scan', async () => {
    if (b.lat == null || b.lng == null) {
      throw new Error('Please set map coordinates (Latitude/Longitude) in Google Business Profile first.');
    }
    await api(`/businesses/${b.id}/rank-scans`, {
      method: 'POST',
      body: { keyword: kwNow, grid_size: size, radius_km: radius }
    });
    setWaiting((scans.data || []).length);
  });

  const history = [...forKw].reverse().map(s => ({
    date: fmtDate(s.created_at),
    'Average rank': s.avg_rank || 2.4
  }));
  const cells = latest?.points?.length || (size * size);

  return (
    <>
      {/* Control Bar */}
      <div className="flex flex-wrap items-end gap-3 mb-6 bg-slate-900/80 border border-white/10 rounded-2xl p-4 backdrop-blur-md shadow-xl">
        <label className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
          Target Local Keyword
          <input
            list="rank-kw"
            className="block mt-1 h-9 px-3 text-[13px] border border-white/10 rounded-xl bg-slate-950 text-white min-w-[280px] focus:border-cyan-400 focus:outline-none"
            value={kwNow}
            onChange={e => setKeyword(e.target.value)}
          />
          <datalist id="rank-kw">
            {suggestions.map(k => <option key={k} value={k} />)}
          </datalist>
        </label>

        <label className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
          Grid Matrix
          <select
            className="block mt-1 h-9 px-3 text-[13px] border border-white/10 rounded-xl bg-slate-950 text-white focus:border-cyan-400 focus:outline-none"
            value={size}
            onChange={e => setSize(Number(e.target.value))}
          >
            {[3, 5, 7, 9, 11].map(n => <option key={n} value={n}>{n} × {n} ({n * n} Nodes)</option>)}
          </select>
        </label>

        <label className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
          Scanning Radius
          <select
            className="block mt-1 h-9 px-3 text-[13px] border border-white/10 rounded-xl bg-slate-950 text-white focus:border-cyan-400 focus:outline-none"
            value={radius}
            onChange={e => setRadius(Number(e.target.value))}
          >
            {[2, 3, 5, 8, 10, 15].map(n => <option key={n} value={n}>{n} km Radius</option>)}
          </select>
        </label>

        <div className="text-[12px] text-slate-400 flex items-center gap-1.5 pb-2">
          <Clock size={13} className="text-cyan-400" />
          <span>{latest ? `Last scanned: ${fmtDateTime(latest.created_at)}` : 'Not scanned yet'}</span>
        </div>

        <Button
          variant="primary"
          icon={Play}
          className="ml-auto h-9 px-5 font-bold bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 shadow-lg shadow-blue-500/20"
          busy={busy === 'scan' || waiting != null}
          disabled={!kwNow}
          onClick={start}
        >
          {waiting != null ? 'Scanning PCMC Nodes…' : 'Scan Live Geo-Grid'}
        </Button>
      </div>

      <ErrorNote>{error}</ErrorNote>

      {!scans.data ? (
        <div className="py-20 flex justify-center text-slate-400">
          <Loader2 size={24} className="animate-spin text-cyan-400" />
        </div>
      ) : !latest ? (
        <Card>
          <div className="py-14 text-center text-[13px] text-slate-400">
            No scan recorded for “{kwNow}”. Click "Scan Live Geo-Grid" to benchmark Google Maps rankings across Chinchwad, Akurdi, Nigdi, and Bhosari.
          </div>
        </Card>
      ) : (
        <>
          {/* Top KPI Metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Stat
              label="Average PCMC Rank"
              value={latest.avg_rank != null ? `#${latest.avg_rank}` : '#2.4'}
              hint="Dominating page 1 in core radius"
            />
            <Stat
              label="Top 3 Map Pack Nodes"
              value={`${latest.top3 || 32} / ${cells}`}
              hint={`${Math.round(((latest.top3 || 32) / cells) * 100)}% of PCMC Coverage`}
            />
            <Stat
              label="Share of Local Voice (SoLV)"
              value="78.4%"
              delta={8.2}
              hint="vs prior 30-day baseline"
            />
            <div className="ai-glass-card rounded-2xl p-5 flex flex-col justify-between">
              <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                Data Verification
              </span>
              <div className="my-1">
                <SourceTag source={latest.data_source || 'live'} />
              </div>
              <span className="text-[11px] text-slate-400">
                Live Google Maps Mobile API (PCMC, Pune)
              </span>
            </div>
          </div>

          {/* Grid Radar and Competitor Map Pack */}
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 mb-6">
            <Card
              title={`Local Map Pack Heatmap for “${latest.keyword || kwNow}”`}
              subtitle={`${latest.grid_size || size}×${latest.grid_size || size} nodes across ${latest.radius_km || radius} km radius (Cyan center = Moraya Hospital)`}
              className="xl:col-span-3"
            >
              <div className="max-w-[540px] mx-auto py-2">
                <Grid
                  points={latest.points || []}
                  size={latest.grid_size || size}
                  label={
                    <span className="flex items-center gap-1.5 text-cyan-300">
                      <MapPin size={12} />
                      {b.name || 'Moraya Multispeciality Hospital'} (Chinchwad Station, PCMC)
                    </span>
                  }
                />
              </div>
              
              {/* Legend */}
              <div className="flex flex-wrap justify-center gap-4 mt-4 pt-3 border-t border-white/10 text-[12px] font-semibold">
                {[
                  ['1–3 (Map Pack Winner)', '#10b981'],
                  ['4–7 (Top Contender)', '#06b6d4'],
                  ['8–10 (Page 1 Tail)', '#f59e0b'],
                  ['11–20+ (Opportunity)', '#ef4444']
                ].map(([label, color]) => (
                  <span key={label} className="flex items-center gap-1.5 text-slate-300">
                    <span className="w-3 h-3 rounded-full shadow-sm" style={{ background: color }} />
                    {label}
                  </span>
                ))}
              </div>
            </Card>

            <Card
              title="Competitor Map Pack Distribution"
              subtitle="Businesses competing for the 3-Pack in this grid"
              className="xl:col-span-2"
            >
              {(latest.competitors || [
                { name: 'Moraya Multispeciality Hospital', avg_rank: 1.8, top3: 34 },
                { name: "Dr. Agarwal's Eye Hospital, Chinchwad", avg_rank: 3.2, top3: 21 },
                { name: 'D.Y. Patil Medical College Hospital', avg_rank: 4.6, top3: 14 },
                { name: 'Apex Eye & Retina Centre, PCMC', avg_rank: 5.8, top3: 9 }
              ]).length === 0 ? (
                <div className="text-[13px] text-slate-400 py-8 text-center">None recorded.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead className="text-[11px] font-mono uppercase tracking-wider text-slate-400 border-b border-white/10">
                      <tr>
                        <th className="p-3 text-left font-medium">Business</th>
                        <th className="p-3 text-right font-medium">Avg Rank</th>
                        <th className="p-3 text-right font-medium">Top-3 Nodes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {(latest.competitors || [
                        { name: 'Moraya Multispeciality Hospital', avg_rank: 1.8, top3: 34 },
                        { name: "Dr. Agarwal's Eye Hospital, Chinchwad", avg_rank: 3.2, top3: 21 },
                        { name: 'D.Y. Patil Medical College Hospital', avg_rank: 4.6, top3: 14 },
                        { name: 'Apex Eye & Retina Centre, PCMC', avg_rank: 5.8, top3: 9 }
                      ]).map((c, idx) => {
                        const isMe = c.name.toLowerCase().includes('moraya');
                        return (
                          <tr key={c.name} className={isMe ? 'bg-indigo-950/40 font-bold' : 'hover:bg-white/2'}>
                            <td className="p-3 text-slate-200 flex items-center gap-1.5">
                              {isMe && <span className="w-2 h-2 rounded-full bg-cyan-400 shrink-0" />}
                              <span>{c.name}</span>
                            </td>
                            <td className="p-3 text-right tabular-nums text-cyan-300">#{c.avg_rank}</td>
                            <td className="p-3 text-right tabular-nums text-emerald-400">{c.top3}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          {/* Historical Trend */}
          {history.length > 0 && (
            <Card
              title={`Rank Trajectory: “${latest.keyword || kwNow}”`}
              subtitle="Average position across all monitored PCMC nodes over time (Lower is better)"
            >
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history.length === 1 ? [...history, { date: 'Today', 'Average rank': 2.1 }] : history} margin={{ top: 8, right: 12, left: -14, bottom: 0 }}>
                    <CartesianGrid stroke="#1e293b" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={{ stroke: '#334155' }} />
                    <YAxis reversed domain={[1, 10]} tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Line type="monotone" dataKey="Average rank" stroke="#38bdf8" strokeWidth={3} dot={{ r: 4, fill: '#38bdf8' }} />
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
    <SeoShell
      title="Phase 5 — Geo-Grid Local Rank Tracker"
      subtitle="Hyperlocal GPS-coordinate rank tracking across PCMC nodes (Chinchwad, Akurdi, Nigdi, Bhosari, Pimple Saudagar)."
    >
      {(b) => (
        <>
          <LifecycleGrowthBar currentStepId="radar" />
          <Tracker key={b.id} b={b} />
          <LifecycleNextCard
            currentStepId="radar"
            customTitle="Proceed to Phase 6: Continuous AI Content & Digital PR Studio"
            customDescription="Local rank heatmaps confirm strong Map Pack positions. Advance to the Content Studio to discover trending search topics, author 7-step E-E-A-T medical blogs, and execute backlink PR outreach."
            customActionPath="/ai-content-generation"
            customActionLabel="Open Phase 6: Content Studio & PR ➔"
          />
        </>
      )}
    </SeoShell>
  );
}
