import React from 'react';
import { Link } from 'react-router-dom';
import { Globe, MapPin, Phone, Navigation, MousePointerClick, Users, ListChecks, ArrowRight, ArrowUpRight, ArrowDownRight, Star, ScanSearch, FileText, TrendingUp, Link2, BarChart3, CheckCircle2, AlertTriangle } from 'lucide-react';
import { SeoShell, Card, Badge, ScoreRing, scoreWord, SkStats, SkCard } from './SeoUi';
import { useApi, fmt } from './seoApi';

const AREA_LABEL = { technical: 'Technical SEO', onpage: 'On-page SEO', gbp: 'Google Business Profile', content: 'Content', speed: 'Site speed', geo: 'AI search (GEO)', aeo: 'Answer engines (AEO)', local: 'Local SEO', backlinks: 'Backlinks', reviews: 'Reviews' };
const label = (k) => AREA_LABEL[k] || String(k).replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase());
const tone = (s) => (s >= 80 ? 'green' : s >= 60 ? 'amber' : 'red');

function Delta({ now, before }) {
  if (!before && !now) return null;
  const d = (now || 0) - (before || 0);
  if (!d) return <span className="text-11.5 text-slate-400">same as the 30 days before</span>;
  const up = d > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return <span className={`text-11.5 font-semibold inline-flex items-center gap-0.5 ${up ? 'text-emerald-600' : 'text-red-600'}`}><Icon size={13} />{up ? '+' : ''}{fmt(d)} vs the 30 days before</span>;
}

function Stat({ icon: Icon, label: l, value, children }) {
  return (
    <div className="ai-glass-card rounded p-4 flex items-start gap-3 min-w-0">
      <span className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-500 flex items-center justify-center shrink-0"><Icon size={17} /></span>
      <div className="min-w-0">
        <div className="text-12 font-semibold text-slate-500 truncate">{l}</div>
        <div className="text-24 leading-tight font-bold text-slate-900 tabular-nums">{value ?? '—'}</div>
        {children}
      </div>
    </div>
  );
}

const LINKS = [
  ['Website audit', '/website-audit', ScanSearch, 'Site health, errors and warnings'],
  ['Google Business Profile', '/gmb-profile', MapPin, 'Profile, reviews, photos and posts'],
  ['Position tracking', '/rank-tracking/landscape', TrendingUp, 'Where you rank on Google'],
  ['Blogs', '/ai-content-generation/blog', FileText, 'Write and publish articles'],
  ['Backlinks', '/backlinks/links', Link2, 'Links pointing to the site'],
  ['Website traffic', '/traffic', BarChart3, 'Visits and where they come from']
];

function ProjectDashboard({ b }) {
  const ov = useApi(`/businesses/${b.id}/overview`);
  const d = ov.data;
  if (ov.error) return <Card><p className="text-13 text-red-600">{ov.error.message}</p></Card>;
  if (!d) return <div className="space-y-4"><SkStats labels={['Overall score', 'Calls · 30 days', 'Directions · 30 days', 'Website clicks · 30 days']} /><SkCard title="Loading this project…"><div className="h-24" /></SkCard></div>;

  const cur = d.insights?.last_30 || {};
  const prev = d.insights?.previous_30 || {};
  const areas = Object.entries(d.areas || {}).filter(([, a]) => a.score != null);
  const failed = Object.entries(d.failed || {});
  const fixes = d.profile?.top_fixes || [];
  const tasks = d.pending_tasks || [];
  const noData = !areas.length && !cur.calls && !cur.directions && !cur.website_clicks;

  return (
    <div className="space-y-5">
      <div className="ai-glass-card rounded p-5 flex flex-wrap items-center gap-5">
        <ScoreRing score={d.overall ?? 0} size={104} label={d.overall == null ? 'No score' : scoreWord(d.overall)} />
        <div className="flex-1 min-w-[240px] space-y-1.5">
          <h2 className="text-20 font-semibold text-slate-900">{b.name}</h2>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-13 text-slate-600">
            {b.website && <a href={b.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-indigo-600 hover:underline"><Globe size={14} />{b.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a>}
            {(b.area || b.city) && <span className="inline-flex items-center gap-1.5"><MapPin size={14} />{[b.area, b.city].filter(Boolean).join(', ')}</span>}
            {b.phone && <span className="inline-flex items-center gap-1.5"><Phone size={14} />{b.phone}</span>}
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {b.primary_category && <Badge tone="blue">{b.primary_category}</Badge>}
            {(b.gbp_location && b.connection_id) ? <Badge tone="green">Google profile connected</Badge> : <Badge tone="gray">Google profile not connected</Badge>}
            {d.profile?.score != null && <Badge tone={tone(d.profile.score)}>Profile score {d.profile.score}/100</Badge>}
          </div>
        </div>
      </div>

      {noData && (
        <div className="rounded bg-sky-50 ring-1 ring-inset ring-sky-100 px-4 py-3 text-13 text-sky-900">
          Nothing has been measured for this project yet. Run a <Link to="/website-audit" className="font-semibold underline">website audit</Link> and connect the Google profile in <Link to="/gmb-profile" className="font-semibold underline">Google Business Profile</Link>: the numbers appear here.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={Phone} label="Calls · 30 days" value={fmt(cur.calls || 0)}><Delta now={cur.calls} before={prev.calls} /></Stat>
        <Stat icon={Navigation} label="Directions · 30 days" value={fmt(cur.directions || 0)}><Delta now={cur.directions} before={prev.directions} /></Stat>
        <Stat icon={MousePointerClick} label="Website clicks · 30 days" value={fmt(cur.website_clicks || 0)}><Delta now={cur.website_clicks} before={prev.website_clicks} /></Stat>
        <Stat icon={Users} label="Leads · 30 days" value={fmt(d.leads_30 || 0)} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <Card title="Scores by area" subtitle="Latest result of each check for this project">
          {areas.length === 0 ? <p className="text-13 text-slate-500 py-2">No checks have run yet.</p> : (
            <ul className="space-y-3">
              {areas.map(([k, a]) => (
                <li key={k}>
                  <div className="flex items-center justify-between text-13 mb-1"><span className="font-medium text-slate-800">{label(k)}</span><span className="tabular-nums font-semibold text-slate-700">{a.score}<span className="text-slate-400">/100</span></span></div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full rounded-full ${a.score >= 80 ? 'bg-emerald-500' : a.score >= 60 ? 'bg-amber-400' : 'bg-red-500'}`} style={{ width: `${Math.max(3, Math.min(100, a.score))}%` }} /></div>
                  {a.data_source === 'sample' && <div className="text-11 text-amber-700 mt-0.5">Sample data: no live source was connected</div>}
                </li>
              ))}
            </ul>
          )}
          {failed.length > 0 && (
            <div className="mt-4 rounded bg-amber-50 ring-1 ring-inset ring-amber-200 px-3 py-2 text-12.5 text-amber-900 space-y-1">
              {failed.map(([k, why]) => <div key={k} className="flex items-start gap-2"><AlertTriangle size={14} className="shrink-0 mt-0.5" /><span><b>{label(k)}</b> failed on its last run: {String(why || 'unknown error').slice(0, 140)}</span></div>)}
            </div>
          )}
        </Card>

        <Card title="Fix next" subtitle="The biggest gaps on this project's Google profile">
          {fixes.length === 0 ? <p className="text-13 text-slate-500 py-2 inline-flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-600" />Nothing urgent on the profile.</p> : (
            <ul className="divide-y divide-slate-100">
              {fixes.slice(0, 6).map((f, i) => (
                <li key={i} className="py-2.5 flex items-start gap-3"><Star size={15} className="text-amber-500 mt-0.5 shrink-0" /><div className="min-w-0"><div className="text-13 font-medium text-slate-800">{typeof f === 'string' ? f : (f.label || f.title || 'Profile check')}</div>{f.fix && <div className="text-12 text-slate-500">{f.fix}</div>}</div></li>
              ))}
            </ul>
          )}
          <Link to="/gmb-profile" className="mt-3 inline-flex items-center gap-1 text-13 font-semibold text-indigo-600 hover:underline">Open the Google profile <ArrowRight size={14} /></Link>
        </Card>
      </div>

      {tasks.length > 0 && (
        <Card title="Waiting for your approval" subtitle={`${tasks.length} item${tasks.length === 1 ? '' : 's'} the assistant prepared for this project`}>
          <ul className="divide-y divide-slate-100">
            {tasks.slice(0, 6).map(t => <li key={t.id} className="py-2.5 flex items-center gap-3 text-13"><ListChecks size={15} className="text-indigo-500 shrink-0" /><span className="flex-1 min-w-0 truncate text-slate-800">{t.title}</span><Badge tone="gray">{t.kind}</Badge></li>)}
          </ul>
        </Card>
      )}

      <div>
        <h3 className="text-15 font-semibold text-slate-900 mb-2">Work on this project</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {LINKS.map(([t, to, I, hint]) => (
            <Link key={to} to={to} className="ai-glass-card rounded p-4 flex items-center gap-3 hover:ring-1 hover:ring-indigo-200">
              <span className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-500 flex items-center justify-center shrink-0"><I size={17} /></span>
              <span className="min-w-0 flex-1"><span className="block text-13.5 font-semibold text-slate-900">{t}</span><span className="block text-12 text-slate-500">{hint}</span></span>
              <ArrowRight size={15} className="text-slate-300" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ProjectDashboardPage() {
  return (
    <SeoShell title="Project dashboard" subtitle="This project at a glance: scores, Google activity and what to do next">
      {(b) => (b ? <ProjectDashboard key={b.id} b={b} /> : null)}
    </SeoShell>
  );
}
