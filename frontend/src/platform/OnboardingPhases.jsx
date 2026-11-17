import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ChevronDown, ChevronRight, Circle, ExternalLink, RefreshCw, Lock } from 'lucide-react';
import { Card, Button, Badge, ErrorNote, SkList, useAction, useToast } from './SeoUi';
import { api, useApi } from './seoApi';

const LEVEL = { critical: ['Critical', 'red'], serious: ['Serious', 'amber'], warning: ['Warning', 'blue'], info: ['Notice', 'gray'] };
const dateText = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

/** One phase in the row across the top: its number, name, how much is left. */
function PhaseTab({ n, p, on, onPick }) {
  const done = p.status === 'done', empty = p.status === 'empty', cur = p.status === 'current';
  return (
    <button type="button" onClick={onPick} aria-pressed={on} className={`text-left rounded-xl border p-3 min-w-[170px] flex-1 cursor-pointer transition ${on ? 'border-indigo-500 bg-indigo-50/60 ring-1 ring-indigo-200' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
      <div className="flex items-center gap-2">
        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-12 font-bold shrink-0 ${done ? 'bg-emerald-100 text-emerald-700' : cur ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{done ? '✓' : n}</span>
        <span className="text-13 font-semibold text-slate-900 leading-tight">{p.title}</span>
      </div>
      <div className="mt-1.5 text-12 text-slate-500">
        {done ? 'Done' : empty ? 'Nothing found yet' : `${p.open} to do`}{cur && <span className="ml-1.5 text-indigo-700 font-semibold">· work here now</span>}{p.status === 'next' && <span className="ml-1.5 inline-flex items-center gap-1 text-slate-400"><Lock size={11} />after phase {n - 1}</span>}
      </div>
    </button>
  );
}

/** One page of the website and what to change on it. */
function PageRow({ pg }) {
  return (
    <div className="rounded-lg ring-1 ring-inset ring-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <a href={pg.url} target="_blank" rel="noreferrer" className="text-13 font-semibold text-indigo-700 hover:underline inline-flex items-center gap-1 break-all">{pg.path}<ExternalLink size={11} className="shrink-0" /></a>
        <Badge tone="gray">{pg.changes.length} change{pg.changes.length === 1 ? '' : 's'}</Badge>
      </div>
      <ul className="mt-2 grid gap-2">
        {pg.changes.map((c, i) => { const [l, t] = LEVEL[c.level] || LEVEL.warning; return (
          <li key={i} className="flex gap-2 text-13">
            <span className="mt-0.5 shrink-0"><Badge tone={t}>{l}</Badge></span>
            <span className="min-w-0"><span className="font-semibold text-slate-900">{c.title}</span>
              {c.detail && <span className="block text-12 text-slate-500 break-words">{c.detail}</span>}
              <span className="block text-12.5 text-slate-600">{c.fix}</span></span>
          </li>); })}
      </ul>
    </div>
  );
}

/** One step: the pages to change, the site-wide changes, and the tasks, or a tick when nothing is left. */
function StepCard({ n, s, open, onToggle }) {
  const done = s.open === 0;
  return (
    <div className={`rounded-xl border ${open ? 'border-indigo-200' : 'border-slate-200'} bg-white`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full flex items-center gap-3 px-4 py-3.5 text-left cursor-pointer">
        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-13 font-bold shrink-0 ${done ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-600 text-white'}`}>{done ? '✓' : n}</span>
        <span className="min-w-0 flex-1"><span className="block text-14 font-semibold text-slate-900">{s.title}</span><span className="block text-12.5 text-slate-500">{s.why}</span></span>
        <span className="text-12.5 text-slate-500 shrink-0">{done ? 'Nothing left' : `${s.open} to do`}</span>
        {open ? <ChevronDown size={16} className="text-slate-400 shrink-0" /> : <ChevronRight size={16} className="text-slate-400 shrink-0" />}
      </button>
      {open && (
        <div className="px-4 pb-4 grid gap-4">
          {done && <p className="text-13 text-emerald-700 flex items-center gap-1.5"><CheckCircle2 size={15} />Nothing left in this step. {s.done > 0 ? `${s.done} change${s.done === 1 ? '' : 's'} confirmed.` : ''}</p>}
          {s.pages.length > 0 && (
            <div>
              <div className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-2">Page by page ({s.pages.length} page{s.pages.length === 1 ? '' : 's'}, {s.page_total} change{s.page_total === 1 ? '' : 's'})</div>
              <div className="grid gap-2">{s.pages.map(pg => <PageRow key={pg.url} pg={pg} />)}</div>
            </div>
          )}
          {s.site.length > 0 && (
            <div>
              <div className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-2">Whole website</div>
              <ul className="grid gap-2">{s.site.map((c, i) => { const [l, t] = LEVEL[c.level] || LEVEL.warning; return <li key={i} className="flex gap-2 text-13"><Badge tone={t}>{l}</Badge><span><span className="font-semibold text-slate-900">{c.title}</span><span className="block text-12.5 text-slate-600">{c.fix}</span></span></li>; })}</ul>
            </div>
          )}
          {s.tasks.length > 0 && (
            <div>
              <div className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-2">Tasks</div>
              <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-inset ring-slate-200">
                {s.tasks.map(t => { const [l, tone] = LEVEL[t.severity] || LEVEL.warning; return (
                  <li key={t.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                    <Badge tone={tone}>{l}</Badge>
                    <span className="min-w-0 flex-1 text-13 font-semibold text-slate-900">{t.title}{t.points != null && <span className="ml-2 text-12 font-semibold text-emerald-700">+{t.points} score</span>}</span>
                    <span className="text-12 text-slate-500">{t.est_minutes ? `${t.est_minutes} min` : ''}</span>
                    <Link to={`/growth/fix/${t.id}`}><Button size="sm" variant="primary" icon={ArrowRight}>How to fix</Button></Link>
                  </li>); })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The work in order: the website first (page by page, step by step), then each profile phase. */
export default function OnboardingPhases({ b }) {
  const r = useApi(`/businesses/${b.id}/fix-plan/phases`);
  const [pick, setPick] = useState(null);
  const [openStep, setOpenStep] = useState(null);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const [result, setResult] = useState(null);
  const d = r.data;
  if (r.error) return <Card><ErrorNote>{r.error.message}</ErrorNote></Card>;
  if (!d) return <SkList rows={6} />;
  const cur = d.phases.find(p => p.status === 'current');
  const phase = d.phases.find(p => p.key === (pick || cur?.key)) || d.phases[0];
  const stepOpen = openStep ?? (phase.key === cur?.key ? d.current?.step : phase.steps.find(s => s.open)?.key);
  const rescan = () => run('rescan', async () => {
    const out = await api(`/businesses/${b.id}/fix-plan/phases/rescan`, { method: 'POST', timeout: 240000 });
    r.setData(out); setResult(out.result); setPick(null); setOpenStep(null);
    toast(out.result.fixed > 0 ? `${out.result.fixed} change${out.result.fixed === 1 ? '' : 's'} fixed since the last scan` : 'Scan done: nothing new is fixed yet');
  });
  const idx = d.phases.findIndex(p => p.key === phase.key);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <Card title="What to do, in order" subtitle="Start with the website: every page and its data. When it is right, build the profiles, one phase at a time."
        action={<Button size="sm" variant="primary" icon={RefreshCw} busy={busy === 'rescan'} disabled={!d.has_website} onClick={rescan}>Re-scan my website</Button>}>
        <ErrorNote>{error}</ErrorNote>
        <div className="flex flex-wrap gap-3">{d.phases.map((p, i) => <PhaseTab key={p.key} n={i + 1} p={p} on={p.key === phase.key} onPick={() => { setPick(p.key); setOpenStep(null); }} />)}</div>
        <p className="mt-3 text-12.5 text-slate-500">
          {d.crawled ? <>Website pages read: <b className="text-slate-800">{d.pages_crawled}</b> · last scan {dateText(d.crawl_date)}. </> : null}
          {d.note}{!d.has_website && 'Add the project’s website to get the page-by-page changes.'}
        </p>
        {result && <p className="mt-2 text-13 font-semibold text-slate-800">{result.fixed > 0 ? `${result.fixed} change${result.fixed === 1 ? '' : 's'} fixed since the last scan. ` : ''}Website phase: {result.phases.website.before} → {result.phases.website.after} left to do.</p>}
      </Card>

      <Card title={`Phase ${idx + 1}: ${phase.title}`} subtitle={phase.goal}>
        {phase.status === 'next' && <p className="mb-3 text-13 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Finish {d.phases[idx - 1] ? `phase ${idx}` : 'the earlier phase'} first for the best result. You can look ahead here.</p>}
        {phase.status === 'empty' && <p className="mb-3 text-13 text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">Nothing has been found for this phase yet. Its changes appear after the first scan, or once the profile is connected.</p>}
        <div className="grid gap-3">
          {phase.steps.map((s, i) => <StepCard key={s.key} n={i + 1} s={s} open={stepOpen === s.key} onToggle={() => setOpenStep(stepOpen === s.key ? '' : s.key)} />)}
        </div>
        {phase.status === 'done' && idx < d.phases.length - 1 && <div className="mt-4"><Button variant="primary" icon={ArrowRight} onClick={() => { setPick(d.phases[idx + 1].key); setOpenStep(null); }}>On to phase {idx + 2}: {d.phases[idx + 1].title}</Button></div>}
      </Card>
      {toastNode}
    </div>
  );
}
