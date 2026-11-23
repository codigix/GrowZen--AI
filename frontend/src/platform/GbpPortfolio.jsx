import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Star, ArrowRight, CheckCircle2, PlugZap, AlertTriangle, RefreshCw, Eye, MousePointerClick, MessageSquare, FileText, Image as ImageIcon, Pencil, Layers } from 'lucide-react';
import { Card, Button, Badge, ErrorNote, SkList } from './SeoUi';
import { useApi, fmtDateTime } from './seoApi';
import DataTable from './DataTable';
import { Spark, Delta } from './StatBits';
import { BusinessAvatar } from './GbpWorkspace';

const fmt = (n) => Number(n || 0).toLocaleString('en-IN');
const ago = (iso) => { if (!iso) return 'never'; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 2 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const sum3 = (x) => (x.calls || 0) + (x.directions || 0) + (x.website_clicks || 0);

function Tile({ icon: Icon, label, value, color, sub, delta }) {
  return (
    <div className="rounded-xl bg-white ring-1 ring-slate-200 px-4 py-3 min-w-0">
      <div className="flex items-center gap-1.5 text-12 font-semibold text-slate-500"><Icon size={13} style={{ color }} />{label}</div>
      <div className="mt-1 flex items-baseline gap-2"><span className="text-24 leading-tight font-bold tabular-nums text-slate-900">{value}</span>{delta}</div>
      {sub && <div className="text-11.5 text-slate-500 mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

/** Every project on one page: its Google connection, posts, photos, review replies, updates and results. Click a project to open its own overview. */
export default function GbpPortfolio({ onOpen }) {
  const data = useApi('/gbp/portfolio');
  const [only, setOnly] = useState('all');
  const d = data.data;
  const t = d?.totals;
  const rows = useMemo(() => (d?.projects || []).filter(p => only === 'all' || (only === 'attention' ? p.attention.length : only === 'connected' ? p.google.linked : !p.google.linked)), [d, only]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 mr-auto"><h2 className="text-18 font-semibold text-slate-900">All projects</h2><p className="text-12 text-slate-500">Everything managed from this software and what Google shows, for every project. Open a project for its own overview and monthly progress.</p></div>
        {d && <span className="text-12 text-slate-400">Updated {ago(d.generated_at)}</span>}
        <Button size="sm" icon={RefreshCw} onClick={() => data.reload(true)}>Refresh</Button>
      </div>
      <ErrorNote>{data.error?.message}</ErrorNote>

      {!d ? <Card><SkList rows={5} /></Card> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-2.5">
            <Tile icon={Layers} label="Projects" value={t.projects} color="#6366f1" sub={`${t.connected} connected to Google`} />
            <Tile icon={AlertTriangle} label="Need attention" value={t.needs_attention} color={t.needs_attention ? '#f59e0b' : '#10b981'} sub={t.needs_attention ? 'see the list below' : 'all clear'} />
            <Tile icon={Eye} label="Profile views (30 d)" value={fmt(t.views[0])} color="#6366f1" delta={<Delta now={t.views[0]} before={t.views[1]} />} />
            <Tile icon={MousePointerClick} label="Customer actions (30 d)" value={fmt(t.actions[0])} color="#0ea5e9" delta={<Delta now={t.actions[0]} before={t.actions[1]} />} sub="calls, directions, clicks" />
            <Tile icon={MessageSquare} label="Reviews to reply" value={t.reviews_waiting} color={t.reviews_waiting ? '#f43f5e' : '#10b981'} sub={`${t.replied_30d} replied in 30 days`} />
            <Tile icon={FileText} label="Posts (30 d)" value={t.posts_30d} color="#8b5cf6" sub={`${t.scheduled} scheduled`} />
            <Tile icon={ImageIcon} label="Photos added (30 d)" value={t.photos_added_30d} color="#10b981" />
            <Tile icon={Pencil} label="Profile updates (30 d)" value={t.updates_30d} color="#f59e0b" />
          </div>

          <Card pad={false} title={`Projects (${rows.length})`} subtitle="Click a project to open its overview: progress month by month, Google results and updates."
            action={<div className="flex gap-1" role="tablist" aria-label="Show projects">
              {[['all', 'All'], ['attention', 'Need attention'], ['connected', 'Connected'], ['not', 'Not connected']].map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={only === k} onClick={() => setOnly(k)} className={`h-8 px-3 rounded-full text-12.5 font-semibold cursor-pointer ${only === k ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{l}</button>))}
            </div>}>
            <DataTable bare rows={rows} rowKey={p => p.id} pageSize={10} sizes={[10, 25, 50]} exportName="all-projects" label="projects" searchPlaceholder="Search projects" minWidth={1180} columnsMenu={false} headClass="bg-slate-100 text-slate-700"
              empty="No projects match."
              columns={[
                { id: 'project', header: 'Project', value: p => p.name, className: 'px-3 py-2.5 min-w-[220px]', cell: p => (
                  <button type="button" onClick={() => onOpen(p.id)} className="flex items-center gap-2.5 text-left cursor-pointer group">
                    <BusinessAvatar name={p.name} src={p.logo} size="w-9 h-9" />
                    <span className="min-w-0"><span className="block text-13 font-semibold text-slate-900 group-hover:text-indigo-700 truncate">{p.name}</span><span className="block text-11.5 text-slate-500 truncate">{[p.category, p.city].filter(Boolean).join(' · ') || '—'}</span></span>
                  </button>) },
                { id: 'google', header: 'Google', value: p => (p.google.linked ? 1 : 0), className: 'px-3 py-2.5 whitespace-nowrap', cell: p => (
                  <div>{p.google.linked ? <span className="inline-flex items-center gap-1 text-12.5 font-semibold text-emerald-700"><CheckCircle2 size={13} />Connected</span> : <span className="inline-flex items-center gap-1 text-12.5 font-semibold text-amber-700"><PlugZap size={13} />Not connected</span>}
                    <div className="text-11 text-slate-500">{p.google.linked ? `${p.google.verification === 'unknown' ? 'verification unknown' : p.google.verification} · synced ${ago(p.google.last_sync)}` : 'connect to see live data'}</div></div>) },
                { id: 'rating', header: 'Rating', right: true, value: p => p.profile.rating ?? null, className: 'px-3 py-2.5 text-right whitespace-nowrap', cell: p => (p.profile.rating ? <span className="inline-flex items-center gap-1 font-semibold tabular-nums"><Star size={12} className="text-amber-400" fill="currentColor" />{Number(p.profile.rating).toFixed(1)}<span className="text-11.5 font-normal text-slate-500">({fmt(p.profile.reviews)})</span></span> : <span className="text-slate-300">—</span>) },
                { id: 'replies', header: 'Review replies', right: true, value: p => p.reviews.waiting, className: 'px-3 py-2.5 text-right whitespace-nowrap', cell: p => (
                  <div className="text-12.5"><span className={p.reviews.waiting ? 'font-bold text-rose-600' : 'text-slate-400'}>{p.reviews.waiting} waiting</span><div className="text-11 text-slate-500">{p.reviews.replied_30d} replied · {p.reviews.new_30d} new (30 d)</div></div>) },
                { id: 'posts', header: 'Posts', right: true, value: p => p.posts.published_30d, className: 'px-3 py-2.5 text-right whitespace-nowrap', cell: p => (
                  <div className="text-12.5"><b className="tabular-nums">{p.posts.published_30d}</b> <span className="text-slate-500">in 30 d</span><div className="text-11 text-slate-500">{p.posts.scheduled} scheduled · {p.posts.drafts} drafts</div></div>) },
                { id: 'photos', header: 'Photos', right: true, value: p => p.photos.total ?? null, className: 'px-3 py-2.5 text-right whitespace-nowrap', cell: p => (
                  <div className="text-12.5"><b className="tabular-nums">{p.photos.total ?? '—'}</b><div className="text-11 text-slate-500">{p.photos.added_30d} added (30 d)</div></div>) },
                { id: 'updates', header: 'Updates', right: true, value: p => p.updates.count_30d, className: 'px-3 py-2.5 text-right whitespace-nowrap', cell: p => (
                  <div className="text-12.5"><b className="tabular-nums">{p.updates.count_30d}</b> <span className="text-slate-500">in 30 d</span><div className="text-11 text-slate-500">{p.profile.services} services · {p.updates.last ? `last ${ago(p.updates.last)}` : 'none yet'}</div></div>) },
                { id: 'results', header: 'Customer actions (30 d)', right: true, value: p => sum3(p.insights.now), className: 'px-3 py-2.5 text-right', cell: p => (
                  <div className="flex items-center justify-end gap-2"><div className="text-right"><div className="text-14 font-bold tabular-nums text-slate-900">{fmt(sum3(p.insights.now))}</div><Delta now={sum3(p.insights.now)} before={sum3(p.insights.before)} /></div><Spark values={p.insights.actions} tone="#0ea5e9" width={64} height={32} /></div>) },
                { id: 'views', header: 'Views (30 d)', right: true, value: p => p.insights.now.views, className: 'px-3 py-2.5 text-right', cell: p => (
                  <div className="flex items-center justify-end gap-2"><div className="text-right"><div className="text-14 font-bold tabular-nums text-slate-900">{fmt(p.insights.now.views)}</div><Delta now={p.insights.now.views} before={p.insights.before.views} /></div><Spark values={p.insights.views} tone="#6366f1" width={64} height={32} /></div>) },
                { id: 'attention', header: 'Needs attention', value: p => p.attention.length, className: 'px-3 py-2.5 min-w-[200px] max-w-[260px]', cell: p => (p.attention.length ? <ul className="text-11.5 text-amber-800 space-y-0.5">{p.attention.slice(0, 3).map(a => <li key={a}>• {a}</li>)}{p.attention.length > 3 && <li className="text-slate-500">+ {p.attention.length - 3} more</li>}</ul> : <Badge tone="green">All good</Badge>) },
                { id: 'open', header: '', csv: false, right: true, className: 'px-3 py-2.5 text-right', cell: p => <Button size="sm" variant="primary" onClick={() => onOpen(p.id)}>Open <ArrowRight size={13} /></Button> },
              ]} />
          </Card>
          <p className="text-11.5 text-slate-500">Numbers are the ones saved from each project's last sync with Google and from the actions taken in this software. <Link to="/gmb-profile/reports" className="text-indigo-600 hover:underline">Monthly reports</Link> and the live client link are in each project's Reports.</p>
        </>
      )}
    </div>
  );
}
