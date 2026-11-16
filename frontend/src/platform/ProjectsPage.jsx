import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Briefcase, Search, Plus, X, Trash2, ArrowRight, Globe, MapPin, RotateCcw } from 'lucide-react';
import { SeoShell, Card, Badge, Button, ErrorNote, SkTable, useDoubleConfirm, useSeoBusiness, useAction, useToast, refreshBusinesses } from './SeoUi';
import { api, useApi, fmtDate, clearApiCache } from './seoApi';

/**
 * Projects: every project the signed-in user can open, the services (SEO, GEO, AEO, GMB) each is onboarded for, a way to remove one service
 * from a project (deleting only that service's stored data) and a way to delete the whole project.
 */
const MODULES = ['seo', 'geo', 'aeo', 'gmb'];
const META = {
  seo: { label: 'SEO', long: 'Search engine optimisation', tone: 'blue' },
  geo: { label: 'GEO', long: 'Generative engine optimisation (ChatGPT, Gemini, Claude, DeepSeek answers)', tone: 'violet' },
  aeo: { label: 'AEO', long: 'Answer engine optimisation (Perplexity-style cited answers)', tone: 'green' },
  gmb: { label: 'GMB', long: 'Google Business Profile', tone: 'amber' }
};
const n = (v) => Number(v || 0).toLocaleString();

// What is deleted when a service is removed: shown in the confirmation so nobody is surprised.
function effectOf(mod, st = {}) {
  const s = st[mod] || {};
  if (mod === 'seo') return `${n(s.audits)} audit${s.audits === 1 ? '' : 's'}, ${n(s.keywords)} tracked keyword${s.keywords === 1 ? '' : 's'}, ${n(s.rank_scans)} rank scan${s.rank_scans === 1 ? '' : 's'}, the ranking history and the SEO schedules of this project are deleted.`;
  if (mod === 'gmb') return `The Google profile is unlinked from this project and ${n(s.reviews)} stored review${s.reviews === 1 ? '' : 's'}, ${n(s.posts)} post${s.posts === 1 ? '' : 's'} and the stored customer-action history are deleted here. Nothing is changed on Google itself.`;
  return `${n(s.answers)} stored AI answer${s.answers === 1 ? '' : 's'} for ${mod.toUpperCase()} are deleted. The tracked questions are kept while the other AI service is still on.`;
}

function Chip({ mod, on, canManage, busy, onRemove, onAdd }) {
  const m = META[mod];
  if (!on) {
    return (
      <span className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1 rounded-full border border-dashed border-slate-300 text-11 font-semibold text-slate-400" title={`${m.label} is not set up for this project`}>
        <span className="line-through decoration-slate-300">{m.label}</span>
        {canManage && <button type="button" disabled={busy} onClick={onAdd} title={`Add ${m.label} again`} aria-label={`Add ${m.label}`} className="w-5 h-5 rounded-full inline-flex items-center justify-center hover:bg-indigo-50 hover:text-indigo-600 cursor-pointer disabled:opacity-50"><Plus size={12} /></button>}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 h-7 pl-1 pr-0.5 rounded-full" title={m.long}>
      <Badge tone={m.tone}>{m.label}</Badge>
      {canManage && <button type="button" disabled={busy} onClick={onRemove} title={`Remove ${m.label} from this project`} aria-label={`Remove ${m.label}`} className="w-5 h-5 rounded-full inline-flex items-center justify-center text-slate-400 hover:bg-rose-50 hover:text-rose-600 cursor-pointer disabled:opacity-50"><X size={12} /></button>}
    </span>
  );
}

function ProjectsTable({ rows, busy, onOpen, onRemove, onAdd, onDelete }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-13 min-w-[860px]">
        <thead>
          <tr className="text-left text-11 uppercase tracking-wide text-slate-500 border-b border-slate-200">
            <th className="py-2.5 px-3 font-semibold">Project</th>
            <th className="py-2.5 px-3 font-semibold">Plan</th>
            <th className="py-2.5 px-3 font-semibold">Services</th>
            <th className="py-2.5 px-3 font-semibold text-right">Health</th>
            <th className="py-2.5 px-3 font-semibold">Added</th>
            <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => (
            <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50/60 align-middle">
              <td className="py-3 px-3 min-w-[220px]">
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded bg-gradient-to-br from-indigo-500 to-violet-500 text-white text-14 font-bold flex items-center justify-center shrink-0">{(p.name || '?').slice(0, 1).toUpperCase()}</span>
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate max-w-[260px]">{p.name}</div>
                    <div className="text-12 text-slate-500 truncate max-w-[260px] flex items-center gap-1.5">
                      {p.website && <span className="inline-flex items-center gap-1 truncate"><Globe size={11} />{String(p.website).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</span>}
                      {p.city && <span className="inline-flex items-center gap-1 shrink-0"><MapPin size={11} />{p.city}</span>}
                    </div>
                  </div>
                </div>
              </td>
              <td className="py-3 px-3 text-slate-700">{p.plan || '—'}</td>
              <td className="py-3 px-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {MODULES.map(m => <Chip key={m} mod={m} on={p.modules.includes(m)} canManage={p.can_manage} busy={busy === `${p.id}-${m}`} onRemove={() => onRemove(p, m)} onAdd={() => onAdd(p, m)} />)}
                </div>
                {!p.modules.length && <div className="text-12 text-amber-700 mt-1">No service is set up for this project.</div>}
              </td>
              <td className="py-3 px-3 text-right tabular-nums">{p.health == null ? <span className="text-slate-400">—</span> : <b className={p.health >= 80 ? 'text-emerald-600' : p.health >= 60 ? 'text-amber-600' : 'text-rose-600'}>{p.health}</b>}</td>
              <td className="py-3 px-3 text-slate-500 whitespace-nowrap">{fmtDate(p.created_at)}</td>
              <td className="py-3 px-3">
                <div className="flex items-center justify-end gap-1.5">
                  <Button size="sm" onClick={() => onOpen(p)}>Open <ArrowRight size={12} /></Button>
                  {p.can_manage && <Button size="sm" variant="danger" onClick={() => onDelete(p)} title="Delete this project permanently"><Trash2 size={12} /> Delete</Button>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Projects() {
  const list = useApi('/businesses/services');
  const [selected, choose] = useSeoBusiness();
  const navigate = useNavigate();
  const [ask, confirmNode] = useDoubleConfirm();
  const [toast, toastNode] = useToast();
  const [busy, error, run] = useAction();
  const [query, setQuery] = useState('');
  const rows = list.data || [];

  const shown = useMemo(() => rows.filter(p => !query || `${p.name} ${p.website || ''} ${p.city || ''}`.toLowerCase().includes(query.toLowerCase())), [rows, query]);
  const count = (m) => rows.filter(p => p.modules.includes(m)).length;
  const refresh = async () => { await refreshBusinesses(); list.reload(true); };

  const open = (p) => { choose(p.id).then(ok => ok && navigate('/dashboard')); };
  const remove = (p, mod) => ask({
    what: `${META[mod].label} from "${p.name}"`,
    effect: `${effectOf(mod, p.stats)} The project and its other services stay. This cannot be undone.`,
    onConfirm: () => run(`${p.id}-${mod}`, async () => { await api(`/businesses/${p.id}/services/${mod}`, { method: 'DELETE' }); toast(`${META[mod].label} removed from ${p.name}`); await refresh(); })
  });
  const add = (p, mod) => run(`${p.id}-${mod}`, async () => { await api(`/businesses/${p.id}/services/${mod}`, { method: 'PUT', body: { enabled: true } }); toast(`${META[mod].label} added to ${p.name}`); await refresh(); });
  const del = (p) => ask({
    what: `the project "${p.name}"`,
    effect: `The project and everything stored for it is deleted from the system: ${MODULES.filter(m => p.modules.includes(m)).map(m => META[m].label).join(', ') || 'no'} services, audits, keywords, rankings, reviews, articles, tasks, schedules, reports and links to its website and Google profile. Your Google Business Profile itself is not touched. This cannot be undone.`,
    onConfirm: () => run(`del-${p.id}`, async () => {
      await api(`/businesses/${p.id}`, { method: 'DELETE' });
      clearApiCache(); // nothing saved about the deleted project (or its Google account lists) is shown again
      const rest = (await refreshBusinesses()) || [];
      if (String(selected?.id ?? selected) === String(p.id) && rest.length) choose(rest[0].id);
      toast(`${p.name} deleted`);
      list.reload(true);
    })
  });

  return (
    <div className="space-y-5">
      {confirmNode}{toastNode}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="ai-glass-card rounded p-4"><div className="text-12 text-slate-500 flex items-center gap-1.5"><Briefcase size={13} /> Projects</div><div className="text-2xl font-bold text-slate-900 tabular-nums mt-1">{list.data ? rows.length : '—'}</div></div>
        {MODULES.map(m => (
          <div key={m} className="ai-glass-card rounded p-4" title={META[m].long}>
            <div className="text-12 text-slate-500">{META[m].label} <span className="text-slate-400">projects</span></div>
            <div className="text-2xl font-bold text-slate-900 tabular-nums mt-1">{list.data ? count(m) : '—'}</div>
          </div>
        ))}
      </div>

      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 p-4 border-b border-slate-100">
          <label className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name, website or city" className="w-full h-9 pl-8 pr-3 text-13 rounded bg-white ring-1 ring-inset ring-slate-200 focus:ring-indigo-400 outline-none text-slate-900 placeholder-slate-400" />
          </label>
          <Button size="sm" onClick={() => list.reload(true)} title="Reload"><RotateCcw size={12} /> Refresh</Button>
          <Link to="/onboarding" className="ml-auto h-9 px-3.5 inline-flex items-center gap-1.5 rounded text-13 font-semibold bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm"><Plus size={14} /> New project</Link>
        </div>
        {error && <div className="p-4"><ErrorNote>{error}</ErrorNote></div>}
        {list.error ? <div className="p-4"><ErrorNote>{list.error.message}</ErrorNote></div>
          : !list.data ? <div className="p-4"><SkTable headers={['Project', 'Plan', 'Services', 'Health', 'Added', 'Actions']} rows={5} /></div>
            : !rows.length ? (
              <div className="py-14 text-center text-13 text-slate-500">
                <Briefcase size={28} className="mx-auto text-slate-300 mb-2" />
                <div className="font-semibold text-slate-700">No projects yet</div>
                <div className="mt-1">Add a business with its website and Google profile to get started.</div>
                <Link to="/onboarding" className="inline-flex mt-4 h-9 px-3.5 items-center gap-1.5 rounded text-13 font-semibold bg-indigo-600 text-white hover:bg-indigo-700"><Plus size={14} /> New project</Link>
              </div>
            ) : !shown.length ? <div className="py-12 text-center text-13 text-slate-500">No projects match "{query}".</div>
              : <ProjectsTable rows={shown} busy={busy} onOpen={open} onRemove={remove} onAdd={add} onDelete={del} />}
      </Card>
      <p className="text-12 text-slate-500 px-1">Removing a service deletes only what this app stored for it. The project and its other services stay, and nothing is changed on Google or on the website. Click + on a greyed service to set it up again.</p>
    </div>
  );
}

export default function ProjectsPage() {
  return (
    <SeoShell step="details" title="Projects" subtitle="Every project you manage, the services it is set up for, and where to remove a service or the whole project" hideSwitcher needsBusiness={false}>
      <Projects />
    </SeoShell>
  );
}
