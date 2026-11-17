import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, CheckCircle2, ChevronDown, ChevronRight, Circle, Save } from 'lucide-react';
import { SeoShell, Card, Button, Badge, ErrorNote, SkList, useAction, useToast } from './SeoUi';
import { api, useApi } from './seoApi';

const GOALS = ['Phone calls', 'Bookings and appointments', 'Leads and enquiries', 'Online sales', 'Local visibility', 'Brand awareness'];
const SCOPES = [['local', 'Local: customers near the business'], ['national', 'National: all over the country'], ['international', 'International']];

/** Stage 1: the facts the rest of the plan starts from. */
function BusinessForm({ b, onSaved }) {
  const [audience, setAudience] = useState(b.target_audience || '');
  const [goals, setGoals] = useState(b.goals || []);
  const [scope, setScope] = useState(b.target_scope || 'local');
  const [areas, setAreas] = useState((b.target_areas || []).join(', '));
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const toggle = (g) => setGoals(x => (x.includes(g) ? x.filter(y => y !== g) : [...x, g]));
  const save = () => run('save', async () => {
    await api(`/businesses/${b.id}`, { method: 'PATCH', body: { target_audience: audience.trim() || null, goals, target_scope: scope, target_areas: areas.split(',').map(s => s.trim()).filter(Boolean) } });
    toast('Business analysis saved');
    onSaved();
  });
  const cls = 'w-full rounded-lg ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none px-3 py-2 text-13 bg-white';
  return (
    <Card title="Business analysis" subtitle="Services and products come from the Google profile. Add who the customers are, where they are and what you want from SEO.">
      <div id="business" className="grid gap-4 scroll-mt-24">
        <label className="grid gap-1.5 text-13 font-semibold text-slate-800">Target audience
          <textarea rows={3} value={audience} onChange={e => setAudience(e.target.value)} maxLength={1000} className={cls} placeholder="For example: families in Baner and Aundh looking for a dentist for children and for implants" /></label>
        <div className="grid gap-1.5"><span className="text-13 font-semibold text-slate-800">Business goals</span>
          <div className="flex flex-wrap gap-1.5">{GOALS.map(g => <button key={g} type="button" aria-pressed={goals.includes(g)} onClick={() => toggle(g)} className={`h-8 px-3 rounded-full text-12.5 font-semibold cursor-pointer ring-1 ring-inset ${goals.includes(g) ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}>{g}</button>)}</div></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-13 font-semibold text-slate-800">Who should find you
            <select value={scope} onChange={e => setScope(e.target.value)} className={cls}>{SCOPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="grid gap-1.5 text-13 font-semibold text-slate-800">Target areas
            <input value={areas} onChange={e => setAreas(e.target.value)} className={cls} placeholder="Baner, Aundh, Wakad (separate with commas)" /></label>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <div><Button variant="primary" icon={Save} busy={busy === 'save'} onClick={save}>Save</Button></div>
      </div>
      {toastNode}
    </Card>
  );
}

function StageCard({ s, open, onToggle }) {
  const done = s.status === 'done';
  return (
    <div className={`rounded-xl border bg-white ${open ? 'border-indigo-200' : 'border-slate-200'}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full flex items-center gap-3 px-4 py-3.5 text-left cursor-pointer">
        <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-13 font-bold shrink-0 ${done ? 'bg-emerald-100 text-emerald-700' : s.status === 'current' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{done ? <Check size={15} /> : s.n}</span>
        <span className="min-w-0 flex-1"><span className="block text-14 font-semibold text-slate-900">{s.title}{s.status === 'current' && <span className="ml-2 text-12 font-semibold text-indigo-700">· work here now</span>}</span><span className="block text-12.5 text-slate-500">{s.goal}</span></span>
        <span className="text-12.5 text-slate-500 shrink-0">{s.done} of {s.total}</span>
        {open ? <ChevronDown size={16} className="text-slate-400 shrink-0" /> : <ChevronRight size={16} className="text-slate-400 shrink-0" />}
      </button>
      {open && (
        <ul className="px-4 pb-4 divide-y divide-slate-100">
          {s.steps.map(st => (
            <li key={st.key} className="py-2.5 flex items-start gap-3">
              {st.done ? <CheckCircle2 size={17} className="text-emerald-600 shrink-0 mt-0.5" /> : <Circle size={17} className="text-slate-300 shrink-0 mt-0.5" />}
              <span className="min-w-0 flex-1"><span className={`block text-13 font-semibold ${st.done ? 'text-slate-700' : 'text-slate-900'}`}>{st.title}</span><span className="block text-12.5 text-slate-500">{st.detail}</span></span>
              {st.to.startsWith('/seo-journey#') ? <a href="#business" className="text-12.5 font-semibold text-indigo-700 hover:underline shrink-0">{st.done ? 'Edit' : st.action}</a>
                : <Link to={st.to} className="text-12.5 font-semibold text-indigo-700 hover:underline shrink-0 inline-flex items-center gap-1">{st.done ? 'Open' : st.action}<ArrowRight size={12} /></Link>}
            </li>))}
        </ul>)}
    </div>
  );
}

function Journey({ b }) {
  const r = useApi(`/businesses/${b.id}/seo-journey`);
  const [open, setOpen] = useState(null);
  const d = r.data;
  if (r.error) return <Card><ErrorNote>{r.error.message}</ErrorNote></Card>;
  if (!d) return <SkList rows={6} />;
  const shown = open ?? d.current;
  const pct = d.total ? Math.round((d.done / d.total) * 100) : 0;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <Card title="Your SEO plan, in six stages" subtitle="Each tick is read from the project's real data, so this page is always up to date. Work from the top.">
        <div className="flex items-center gap-3"><div className="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-indigo-600" style={{ width: `${pct}%` }} /></div><span className="text-13 font-semibold text-slate-800 tabular-nums">{d.done} of {d.total} checks</span></div>
      </Card>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)] items-start">
        <div className="grid gap-3">
          {d.stages.map(s => <StageCard key={s.key} s={s} open={shown === s.key} onToggle={() => setOpen(shown === s.key ? '' : s.key)} />)}
        </div>
        <Card title="Roadmap: what to do next" subtitle={d.open ? `${d.open} open, in order` : 'Everything is done'}>
          {d.roadmap.length === 0 ? <p className="py-3 text-13 text-emerald-700 flex items-center gap-1.5"><CheckCircle2 size={15} />All checks are done.</p> : (
            <ol className="grid gap-2.5">{d.roadmap.map((x, i) => (
              <li key={i} className="flex gap-2.5 text-13"><Badge tone="gray">{x.stage}</Badge>
                <span className="min-w-0 flex-1"><span className="block font-semibold text-slate-900">{x.title}</span><span className="block text-12 text-slate-500">{x.detail}</span></span>
                {x.to.startsWith('/seo-journey#') ? <a href="#business" className="text-12 font-semibold text-indigo-700 hover:underline shrink-0">{x.action}</a> : <Link to={x.to} className="text-12 font-semibold text-indigo-700 hover:underline shrink-0">{x.action}</Link>}</li>))}</ol>)}
        </Card>
      </div>
      <BusinessForm key={b.id} b={b} onSaved={() => r.reload(true)} />
    </div>
  );
}

export default function SeoJourneyPage() {
  return (
    <SeoShell step="any" title="SEO Plan" subtitle="Business analysis, competitors, keywords, mapping, audit and execution: one path, in order">
      {(b) => <Journey key={b.id} b={b} />}
    </SeoShell>
  );
}
