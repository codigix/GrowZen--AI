import React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PlugZap, XCircle, Globe, MapPin, Phone, Navigation, MousePointerClick, Users, ListChecks, ArrowRight, ArrowUpRight, ArrowDownRight, Star, ScanSearch, FileText, TrendingUp, Link2, BarChart3, CheckCircle2, AlertTriangle } from 'lucide-react';
import { SeoShell, useSeoBusiness, Card, Badge, ScoreRing, scoreWord, SkStats, SkCard } from './SeoUi';
import { useApi, api, fmt } from './seoApi';
import SiteAuditOverview from './SiteAuditOverview';
import { useCountries } from './countries';
import { decodeProjectId } from './projectUrl';
import ProgressSection from './ProjectProgress';

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

function Connections({ b }) {
  const c = useApi(`/businesses/${b.id}/connections`);
  if (c.error) return null;
  const d = c.data;
  return (
    <Card title="Connections" subtitle={d ? `${d.connected} of ${d.total} connected for this project` : 'Checking…'}>
      {!d ? <p className="text-13 text-slate-400">Checking…</p> : (
        <ul className="divide-y divide-slate-100">
          {d.connections.map(x => (
            <li key={x.key} className="py-2.5 flex items-start gap-3">
              {x.connected ? <CheckCircle2 size={17} className="text-emerald-600 mt-0.5 shrink-0" /> : x.level === 'warn' ? <AlertTriangle size={17} className="text-amber-500 mt-0.5 shrink-0" /> : <XCircle size={17} className="text-slate-300 mt-0.5 shrink-0" />}
              <div className="flex-1 min-w-0"><div className="text-13 font-semibold text-slate-900 flex flex-wrap items-center gap-2">{x.label}<Badge tone={x.connected ? 'green' : x.level === 'warn' ? 'amber' : 'gray'}>{x.connected ? 'Connected' : 'Not connected'}</Badge></div><div className="text-12 text-slate-500">{x.detail}</div></div>
              {!x.connected && x.to && <Link to={x.to} className="text-12.5 font-semibold text-indigo-600 hover:underline inline-flex items-center gap-1 shrink-0"><PlugZap size={13} />Connect</Link>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TargetMarket({ b }) {
  const countries = useCountries();
  const name = (c) => (countries || []).find(x => x.code === c)?.name || c;
  const scope = b.target_scope || 'local';
  const places = scope === 'international' ? (b.target_countries || []).map(name) : scope === 'local' ? (b.target_areas || []) : [];
  return (
    <Card title="Target market" subtitle="Where this project wants customers from (set when it was onboarded)">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="blue">{scope === 'local' ? 'Local' : scope === 'national' ? 'National' : 'International'}</Badge>
        {places.map(p => <span key={p} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-12.5 text-slate-700"><MapPin size={12} />{p}</span>)}
        {scope === 'national' && <span className="text-13 text-slate-600">Customers from across the whole country.</span>}
        {scope !== 'national' && places.length === 0 && <span className="text-13 text-slate-500">No target {scope === 'local' ? 'areas' : 'countries'} saved yet.</span>}
      </div>
    </Card>
  );
}

function ProjectDashboard({ b, middle }) {
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

      {middle}

      {noData && (
        <div className="rounded bg-sky-50 ring-1 ring-inset ring-sky-100 px-4 py-3 text-13 text-sky-900">
          Nothing has been measured for this project yet. Run a <Link to="/website-audit" className="font-semibold underline">website audit</Link> and connect the Google profile in <Link to="/gmb-profile" className="font-semibold underline">Google Business Profile</Link>: the numbers appear here.
        </div>
      )}

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
          <Link to="/gmb-profile" target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-13 font-semibold text-indigo-600 hover:underline">Open the Google profile <ArrowRight size={14} /></Link>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <TargetMarket b={b} />
        <Connections b={b} />
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

/** The project's own site audit, in the same layout as the Website Audit page (Overview, Issues, Crawled Pages, Statistics, Compare Crawls, Progress, JS Impact). */
function AuditSection({ b }) {
  const navigate = useNavigate();
  const probe = useApi(`/businesses/${b.id}/audit-overview`);
  const [starting, setStarting] = React.useState(false);
  const [note, setNote] = React.useState('');
  if (!probe.data && !probe.error) return <div className="ai-glass-card rounded p-6 text-13 text-slate-500">Loading the site audit…</div>;
  if (probe.error) {
    const run = async () => {
      setStarting(true); setNote('');
      try { await api(`/businesses/${b.id}/audits`, { method: 'POST', body: { kinds: ['technical', 'onpage'] } }); setNote('Audit started: this page fills in when it finishes (a few minutes).'); }
      catch (e) { setNote(e.message); } finally { setStarting(false); }
    };
    return (
      <Card title={`Site Audit: ${(b.website || b.name).replace(/^https?:\/\//, '').replace(/\/$/, '')}`} subtitle="Site health, errors, warnings and crawled pages">
        <p className="text-13 text-slate-600">{b.website ? 'No website audit has run for this project yet.' : 'This project has no website, so there is nothing to audit.'}</p>
        {b.website && <button type="button" onClick={run} disabled={starting} className="mt-3 h-9 px-4 rounded text-13 font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 cursor-pointer">{starting ? 'Starting…' : 'Run the first audit'}</button>}
        {note && <p className="mt-2 text-12.5 text-slate-600">{note}</p>}
      </Card>
    );
  }
  return <SiteAuditOverview key={b.id} projectId={b.id} onBack={() => navigate('/projects')} />;
}

export default function ProjectDashboardPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [selected, choose] = useSeoBusiness();
  const want = decodeProjectId(projectId) || 0;
  const have = Number(selected?.id ?? selected) || null;
  const asked = React.useRef(false);
  React.useEffect(() => { // the address names the project: make it the selected one (two-step check included); if that is declined, go back to the list
    if (!want) { navigate('/projects', { replace: true }); return; } // not a project code
    if (have === want || asked.current) return;
    asked.current = true;
    choose(want).then(ok => { if (!ok) navigate('/projects', { replace: true }); });
  }, [want, have, choose, navigate]);
  return (
    <SeoShell title="Project dashboard" subtitle="This project's site audit, Google activity, connections and what to do next" hideSwitcher>
      {(b) => (b && b.id === want ? (
        <ProjectDashboard key={b.id} b={b} middle={<div className="space-y-8"><ProgressSection b={b} /><AuditSection b={b} /></div>} />
      ) : null)}
    </SeoShell>
  );
}
