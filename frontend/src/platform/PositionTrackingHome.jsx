import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, CalendarDays, Monitor, Smartphone, Tablet, ArrowDownUp } from 'lucide-react';
import { Card, ErrorNote, useSeoBusiness, SkTable } from './SeoUi';
import { useApi } from './seoApi';
import NewTrackingModal from './NewTrackingModal';

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

/** Position Tracking home: every project with how visible it is, how that moved and how many keywords went up or down. A click on a project or a figure opens that view. */
export default function PositionTrackingHome() {
  const data = useApi('/businesses/rank-tracking');
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

  const open = (r, to) => { choose(r.id).then(ok => ok && navigate(to)); };
  const link = (r, key, children, cls = 'text-indigo-600') => <button type="button" onClick={() => open(r, (r.kind === 'ai' ? AI : SEO)[key])} className={`${cls} hover:underline cursor-pointer text-left`}>{children}</button>;
  const num = (v) => (v == null ? <span className="text-slate-300">—</span> : v);
  const Th = ({ children, c = 'text-left', onClick }) => <th className={`px-4 py-3 font-semibold text-slate-700 whitespace-nowrap ${c}`}>{onClick ? <button type="button" onClick={onClick} className="inline-flex items-center gap-1 cursor-pointer">{children}<ArrowDownUp size={12} className="text-slate-400" /></button> : children}</th>;
  const chip = (id, l) => <button key={id} type="button" onClick={() => setTarget(id)} className={`h-10 px-4 text-14 border-r last:border-r-0 border-slate-300 cursor-pointer ${target === id ? 'bg-indigo-50 text-indigo-700 font-medium' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>{l}</button>;

  return (
    <div className="space-y-4">
      <Card pad={false}>
        <div className="px-5 py-4 flex flex-wrap items-center gap-3">
          <label className="relative w-full max-w-xs"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Project name or domain" aria-label="Search projects" className="w-full h-10 pl-9 pr-3 text-14 rounded border border-slate-300 bg-white outline-none focus:border-indigo-400" /></label>
          <div className="inline-flex rounded border border-slate-300 overflow-hidden">{chip('all', 'All targets')}{chip('ai', 'AI Search')}{chip('seo', 'SEO')}</div>
          <span className="h-10 px-3 inline-flex items-center gap-2 rounded border border-slate-300 bg-white text-14 text-slate-600"><CalendarDays size={15} className="text-slate-400" />{range(rows[0]?.period)}</span>
          <button type="button" onClick={() => setCreating(true)} className="ml-auto h-10 px-4 rounded-lg inline-flex items-center gap-2 text-14 font-semibold bg-slate-900 text-white hover:bg-slate-800 cursor-pointer"><Plus size={16} />Create project</button>
        </div>
        <ErrorNote>{data.error?.message}</ErrorNote>
        {!data.data && !data.error ? <SkTable cols={['w-1/4', 'w-1/5', 'w-16', 'w-16', 'w-16', 'w-16', 'w-16']} headers={['Project', 'Device & Location', 'Visibility', 'Diff', 'Improved keywords', 'Declined keywords', 'All keywords']} rows={4} /> : (
          <div className="overflow-x-auto border-t border-slate-100">
            <table className="w-full text-14 min-w-[1000px]">
              <thead className="bg-slate-50 text-13"><tr><Th onClick={() => setSort(s => -s)}>Project</Th><Th>Device &amp; Location</Th><Th c="text-right">Visibility</Th><Th c="text-right">Diff</Th><Th c="text-right">Improved keywords</Th><Th c="text-right">Declined keywords</Th><Th c="text-right">All keywords</Th><Th>Updated</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map(r => {
                  const D = DEVICE[r.device] || Monitor;
                  const ai = r.kind === 'ai';
                  return (
                    <tr key={`${r.id}-${r.kind}`} className="hover:bg-slate-50 align-top">
                      <td className="px-4 py-4 min-w-[200px]">{link(r, 'name', <span className="block font-semibold">{r.name}</span>, 'text-blue-600')}<span className="block text-slate-600">{r.domain || 'No website'}</span>{ai && <span className="mt-1 inline-block text-12 px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">AI Search</span>}</td>
                      <td className="px-4 py-4"><div className="flex items-start gap-2"><D size={16} className="mt-1 text-slate-700" /><div>{link(r, 'place', r.location || 'Set a location')}<div className="text-slate-600">{ai ? 'ChatGPT, Gemini…' : `${r.engines.join(', ')}, ${r.language}`}</div><div className="text-slate-600">{r.domain}</div></div></div></td>
                      <td className="px-4 py-4 text-right tabular-nums">{r.m.visibility == null ? num(null) : link(r, 'visibility', `${r.m.visibility}%`)}</td>
                      <td className="px-4 py-4 text-right tabular-nums">{r.m.diff == null ? num(null) : link(r, 'diff', r.m.diff)}</td>
                      <td className="px-4 py-4 text-right tabular-nums">{r.m.improved == null ? num(null) : link(r, 'improved', r.m.improved)}</td>
                      <td className="px-4 py-4 text-right tabular-nums">{r.m.declined == null ? num(null) : link(r, 'declined', r.m.declined)}</td>
                      <td className="px-4 py-4 text-right tabular-nums">{link(r, 'keywords', r.m.keywords, 'text-slate-900')}</td>
                      <td className="px-4 py-4 whitespace-nowrap">{link(r, 'updated', ago(r.m.updated), 'text-slate-900')}</td>
                    </tr>);
                })}
                {without.map(r => (
                  <tr key={`${r.id}-none`} className="hover:bg-slate-50">
                    <td className="px-4 py-4"><span className="block font-semibold text-slate-900">{r.name}</span><span className="block text-slate-600">{r.domain || 'No website'}</span></td>
                    <td className="px-4 py-4 text-slate-500" colSpan={6}>Not tracked yet.</td>
                    <td className="px-4 py-4"><button type="button" onClick={() => setCreating(r.id)} className="text-blue-600 hover:underline cursor-pointer">Set up tracking</button></td>
                  </tr>))}
                {!lines.length && !without.length && <tr><td colSpan={8} className="px-5 py-12 text-center text-slate-500">{q ? 'No project matches.' : 'No project is tracked yet. Press "Create project".'}</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-5 py-3 border-t border-slate-100 text-14 text-slate-600">Page: <b className="text-slate-900">1</b> of 1</div>
      </Card>
      <NewTrackingModal open={Boolean(creating)} onClose={() => setCreating(false)} projects={rows} initialId={typeof creating === 'number' ? creating : undefined}
        onDone={(id) => { setCreating(false); data.reload(true); choose(id).then(ok => ok && navigate('/rank-tracking?tab=positions')); }} />
    </div>
  );
}
