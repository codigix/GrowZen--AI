import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, CalendarDays, Monitor, Smartphone, Tablet, ArrowDownUp, ArrowUp, ArrowDown, ArrowRight, FolderKanban, KeyRound, Eye, TrendingUp, Inbox } from 'lucide-react';
import { ErrorNote, useSeoBusiness, SkTable } from './SeoUi';
import { useApi } from './seoApi';
import NewTrackingModal from './NewTrackingModal';
import { JourneyButton, useJourneys } from './JourneyBar';

const DEVICE = { desktop: Monitor, mobile: Smartphone, tablet: Tablet };
const ago = (iso) => {
  if (!iso) return '—';
  const h = Math.max(0, Math.round((Date.now() - new Date(`${iso}T00:00:00`).getTime()) / 3600000));
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};
const range = (p) => {
  if (!p) return '';
  const f = (iso, y) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, y ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' });
  return `${f(p.start)} – ${f(p.end, true)}`;
};

// Where a click on each column leads: tabs this app already has
const SEO = { name: '/rank-tracking?tab=landscape', place: '/rank-tracking?tab=devices', visibility: '/rank-tracking?tab=landscape', diff: '/rank-tracking?tab=overview',
  improved: '/organic-rankings?tab=changes', declined: '/organic-rankings?tab=changes', keywords: '/rank-tracking?tab=positions', updated: '/rank-tracking?tab=positions' };
const AI = { name: '/geo-optimization', place: '/geo-optimization', visibility: '/geo-optimization', diff: '/geo-optimization', improved: '/geo-optimization', declined: '/geo-optimization', keywords: '/geo-optimization?tab=prompts', updated: '/geo-optimization?tab=prompts' };

const Tile = ({ icon: Icon, label, value, sub, tone = 'indigo' }) => {
  const tones = { indigo: 'bg-indigo-50 text-indigo-600', emerald: 'bg-emerald-50 text-emerald-600', amber: 'bg-amber-50 text-amber-600', sky: 'bg-sky-50 text-sky-600' };
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5 min-w-0">
      <div className="flex items-center gap-3">
        <span className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${tones[tone]}`}><Icon size={17} aria-hidden="true" /></span>
        <span className="text-13 font-medium text-slate-500 truncate">{label}</span>
      </div>
      <div className="mt-3 text-24 font-semibold text-slate-900 tabular-nums leading-tight">{value}</div>
      {sub && <div className="mt-1 text-13 text-slate-500 truncate">{sub}</div>}
    </div>
  );
};

const Change = ({ v }) => (v == null ? <span className="text-slate-300">—</span> : v === 0 ? <span className="text-slate-400">0</span>
  : <span className={`inline-flex items-center gap-0.5 font-semibold ${v > 0 ? 'text-emerald-600' : 'text-red-600'}`}>{v > 0 ? <ArrowUp size={13} /> : <ArrowDown size={13} />}{Math.abs(v)}</span>);

const Vis = ({ v }) => (v == null ? <span className="text-slate-300">—</span>
  : <span className={`inline-flex rounded-full px-2.5 py-0.5 text-13 font-semibold tabular-nums ${v >= 50 ? 'bg-emerald-50 text-emerald-700' : v >= 20 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-700'}`}>{v}%</span>);

/** Position Tracking home: every project with how visible it is, how that moved and how many keywords went up or down. A click on a project or a figure opens that view. */
export default function PositionTrackingHome() {
  const data = useApi('/businesses/rank-tracking');
  const journeys = useJourneys();
  const [, choose] = useSeoBusiness();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [target, setTarget] = useState('all');
  const [sort, setSort] = useState(1);
  const [creating, setCreating] = useState(false);
  const rows = data.data || [];

  const lines = useMemo(() => {
    const out = [];
    for (const r of rows) {
      if (q && !`${r.name} ${r.domain || ''}`.toLowerCase().includes(q.toLowerCase())) continue;
      if ((target === 'all' || target === 'seo') && r.seo) out.push({ ...r, kind: 'seo', m: r.seo });
      if ((target === 'all' || target === 'ai') && r.ai) out.push({ ...r, kind: 'ai', m: r.ai });
    }
    return out.sort((a, b) => sort * a.name.localeCompare(b.name));
  }, [rows, q, target, sort]);
  const without = rows.filter(r => !r.seo && !r.ai && (!q || `${r.name} ${r.domain || ''}`.toLowerCase().includes(q.toLowerCase())));

  // The tiles only add up numbers the table already shows.
  const all = rows.flatMap(r => [r.seo && { ...r.seo }, r.ai && { ...r.ai }]).filter(Boolean);
  const sum = (k) => all.reduce((a, m) => a + (Number(m[k]) || 0), 0);
  const vis = all.map(m => m.visibility).filter(v => v != null);
  const avgVis = vis.length ? Math.round((vis.reduce((a, v) => a + v, 0) / vis.length) * 10) / 10 : null;
  const tracked = rows.filter(r => r.seo || r.ai).length;

  const open = (r, to) => { choose(r.id).then(ok => ok && navigate(to)); };
  const link = (r, key, children, cls = 'text-slate-900') => <button type="button" onClick={() => open(r, (r.kind === 'ai' ? AI : SEO)[key])} className={`${cls} hover:text-indigo-600 hover:underline cursor-pointer text-left`}>{children}</button>;
  const num = (v) => (v == null ? <span className="text-slate-300">—</span> : v);
  const Th = ({ children, c = 'text-left', onClick }) => <th scope="col" className={`px-4 py-3 font-semibold whitespace-nowrap ${c}`}>{onClick ? <button type="button" onClick={onClick} className="inline-flex items-center gap-1 cursor-pointer hover:text-slate-900">{children}<ArrowDownUp size={12} className="text-slate-400" /></button> : children}</th>;
  const seg = (id, l) => <button key={id} type="button" role="tab" aria-selected={target === id} onClick={() => setTarget(id)} className={`h-8 px-3.5 rounded-md text-13 font-medium cursor-pointer ${target === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>{l}</button>;

  return (
    <div className="pos-theme space-y-6">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        <Tile icon={FolderKanban} label="Projects tracked" value={data.data ? tracked : '—'} sub={data.data ? `${rows.length} project${rows.length === 1 ? '' : 's'} in total` : undefined} />
        <Tile icon={KeyRound} tone="sky" label="Keywords tracked" value={data.data ? sum('keywords') : '—'} sub="across every target below" />
        <Tile icon={Eye} tone="emerald" label="Average visibility" value={avgVis == null ? '—' : `${avgVis}%`} sub={vis.length ? `over ${vis.length} tracked target${vis.length === 1 ? '' : 's'}` : 'no visibility measured yet'} />
        <Tile icon={TrendingUp} tone="amber" label="Improved / declined" value={data.data ? <span><span className="text-emerald-600">{sum('improved')}</span><span className="text-slate-300 mx-1.5">/</span><span className="text-red-600">{sum('declined')}</span></span> : '—'} sub="keywords since the last check" />
      </div>

      <section className="bg-white rounded-xl border border-slate-200 shadow-sm min-w-0">
        <div className="px-5 py-4 flex flex-wrap items-center gap-3 border-b border-slate-100">
          <label className="relative w-full max-w-xs"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Project name or domain" aria-label="Search projects" className="w-full h-10 pl-9 pr-3 text-14 rounded-lg border border-slate-300 bg-white outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" /></label>
          <div role="tablist" aria-label="Target" className="inline-flex rounded-lg bg-slate-100 p-1">{seg('all', 'All targets')}{seg('ai', 'AI Search')}{seg('seo', 'SEO')}</div>
          {rows[0]?.period && <span className="h-10 px-3 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 text-13 text-slate-600"><CalendarDays size={15} className="text-slate-400" />{range(rows[0].period)}</span>}
          <button type="button" onClick={() => setCreating(true)} className="ml-auto h-10 px-4 rounded-lg inline-flex items-center gap-2 text-14 font-semibold bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer"><Plus size={16} />Create project</button>
        </div>
        <ErrorNote>{data.error?.message}</ErrorNote>
        {!data.data && !data.error ? <SkTable cols={['w-1/4', 'w-1/5', 'w-16', 'w-16', 'w-16', 'w-16', 'w-16']} headers={['Project', 'Device & Location', 'Visibility', 'Change', 'Improved', 'Declined', 'Keywords']} rows={4} /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px]">
              <thead><tr><Th onClick={() => setSort(s => -s)}>Project</Th><Th>Device &amp; location</Th><Th c="text-right">Visibility</Th><Th c="text-right">Change</Th><Th c="text-right">Improved</Th><Th c="text-right">Declined</Th><Th c="text-right">Keywords</Th><Th>Updated</Th><Th c="text-right">Journey / action</Th></tr></thead>
              <tbody>
                {lines.map(r => {
                  const D = DEVICE[r.device] || Monitor;
                  const ai = r.kind === 'ai';
                  return (
                    <tr key={`${r.id}-${r.kind}`}>
                      <td className="px-4 min-w-[210px]">{link(r, 'name', <span className="block font-semibold text-slate-900">{r.name}</span>)}<span className="block text-13 text-slate-500">{r.domain || 'No website'}</span>{ai && <span className="mt-1 inline-block text-12 px-2 py-0.5 rounded-full bg-violet-50 text-violet-700">AI Search</span>}</td>
                      <td className="px-4"><div className="flex items-start gap-2"><D size={16} className="mt-0.5 text-slate-400 shrink-0" /><div>{link(r, 'place', r.location || 'Set a location', 'text-slate-900')}<div className="text-13 text-slate-500">{ai ? 'ChatGPT, Gemini…' : `${r.engines.join(', ')}, ${r.language}`}</div></div></div></td>
                      <td className="px-4 text-right tabular-nums">{r.m.visibility == null ? num(null) : link(r, 'visibility', <Vis v={r.m.visibility} />)}</td>
                      <td className="px-4 text-right tabular-nums">{link(r, 'diff', <Change v={r.m.diff} />)}</td>
                      <td className="px-4 text-right tabular-nums text-emerald-700">{r.m.improved == null ? num(null) : link(r, 'improved', r.m.improved, 'text-emerald-700')}</td>
                      <td className="px-4 text-right tabular-nums">{r.m.declined == null ? num(null) : link(r, 'declined', r.m.declined, r.m.declined ? 'text-red-600' : 'text-slate-500')}</td>
                      <td className="px-4 text-right tabular-nums font-medium">{link(r, 'keywords', r.m.keywords)}</td>
                      <td className="px-4 whitespace-nowrap text-slate-600">{link(r, 'updated', ago(r.m.updated), 'text-slate-600')}</td>
                      <td className="px-4 text-right whitespace-nowrap"><span className="inline-flex items-center gap-2"><JourneyButton bid={r.id} name={r.name} stage={journeys[r.id]} /><button type="button" onClick={() => open(r, (ai ? AI : SEO).name)} className="h-8 px-3 rounded-lg inline-flex items-center gap-1.5 text-13 font-medium text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50 cursor-pointer">Open<ArrowRight size={13} /></button></span></td>
                    </tr>);
                })}
                {without.map(r => (
                  <tr key={`${r.id}-none`}>
                    <td className="px-4"><span className="block font-semibold text-slate-900">{r.name}</span><span className="block text-13 text-slate-500">{r.domain || 'No website'}</span></td>
                    <td className="px-4 text-slate-500" colSpan={7}>Not tracked yet.</td>
                    <td className="px-4 text-right"><button type="button" onClick={() => setCreating(r.id)} className="h-8 px-3 rounded-lg inline-flex items-center text-13 font-medium text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50 cursor-pointer">Set up tracking</button></td>
                  </tr>))}
                {!lines.length && !without.length && <tr><td colSpan={9} className="px-5 py-14 text-center text-slate-500"><Inbox size={24} className="mx-auto mb-2 text-slate-300" />{q ? 'No project matches.' : 'No project is tracked yet. Press "Create project".'}</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-5 py-3 border-t border-slate-100 text-13 text-slate-500">{lines.length + without.length} row{lines.length + without.length === 1 ? '' : 's'}</div>
      </section>
      <NewTrackingModal open={Boolean(creating)} onClose={() => setCreating(false)} projects={rows} initialId={typeof creating === 'number' ? creating : undefined}
        onDone={(id) => { setCreating(false); data.reload(true); choose(id).then(ok => ok && navigate('/rank-tracking?tab=positions')); }} />
    </div>
  );
}
