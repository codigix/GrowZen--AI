import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, ChevronRight, Circle, Lock, Map as MapIcon } from 'lucide-react';
import { Drawer } from './SeoUi';
import { useApi } from './seoApi';

const arr = (v) => (Array.isArray(v) ? v : []);
const Icon = ({ s }) => (s === 'done' ? <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 inline-flex items-center justify-center shrink-0"><Check size={13} /></span>
  : s === 'blocked' ? <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-400 inline-flex items-center justify-center shrink-0"><Lock size={12} /></span>
    : <span className="w-6 h-6 rounded-full bg-indigo-50 text-indigo-600 inline-flex items-center justify-center shrink-0"><Circle size={10} fill="currentColor" /></span>);

export function useFlow(bid) { return useApi(bid ? `/businesses/${bid}/flow` : null); }

const STATE = { done: ['Done', 'bg-emerald-50 text-emerald-700'], blocked: ['Waiting on an earlier step', 'bg-amber-50 text-amber-800'], todo: ['To do', 'bg-indigo-50 text-indigo-700'] };

/** One step inside the side panel: a row that opens to what it is, why it matters, what it needs first, and the button to do it. */
function StepRow({ s, total, open, onToggle, onClose }) {
  return (
    <li className="rounded-lg border border-slate-200 bg-white">
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full flex items-center gap-3 text-left px-3 py-2.5 cursor-pointer hover:bg-slate-50 rounded-lg">
        <Icon s={s.status} />
        <span className="min-w-0 flex-1"><span className={`block text-14 font-medium ${s.status === 'done' ? 'text-slate-500' : 'text-slate-900'}`}>{s.order}. {s.title}</span><span className="block text-12 text-slate-500 truncate">{s.detail}</span></span>
        <ChevronRight size={15} className={`text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && <div className="px-3 pb-3"><StepDetail s={s} onClose={onClose} /></div>}
    </li>
  );
}

function StepDetail({ s, onClose }) {
  const [label, cls] = STATE[s.status] || STATE.todo;
  const first = s.status === 'blocked' && s.waiting_for?.[0];
  return (
        <div className="grid gap-3 text-13 text-slate-700">
          <span className={`inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-12 font-semibold ${cls}`}>{label}</span>
          <p><span className="font-semibold text-slate-900">Where you are: </span>{s.detail}</p>
          <p><span className="font-semibold text-slate-900">Why it matters: </span>{s.why}</p>
          {s.requires.length > 0 && (
            <ul className="grid gap-1.5"><li className="text-12 font-semibold uppercase tracking-wide text-slate-500">Needs first</li>{s.requires.map(r => (
              <li key={r.key} className={`flex items-center gap-2 ${r.done ? 'text-emerald-700' : 'text-amber-800 font-medium'}`}>{r.done ? <Check size={13} /> : <Lock size={12} />}{r.title}{r.done || !r.link ? null : <Link to={r.link} onClick={onClose} className="ml-auto text-12.5 font-semibold text-indigo-600 hover:underline">Open</Link>}</li>))}</ul>
          )}
          <Link to={first ? first.link : s.link} onClick={onClose} className="w-fit">
            <span className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-indigo-600 text-white text-13 font-semibold hover:bg-indigo-700">{first ? `Do this first: ${first.title}` : s.status === 'done' ? 'Open' : 'Do this step'}<ArrowRight size={14} /></span>
          </Link>
        </div>
  );
}

/** All ten steps of one project, open on the page: the project's own journey. */
export function JourneyFull({ bid }) {
  const f = useFlow(bid);
  const [open, setOpen] = useState(null);
  const d = f.data;
  if (!d) return <div className="h-64 rounded-xl bg-slate-100 animate-pulse" role="status" aria-busy="true" />;
  const sel = d.steps.find(x => x.key === open);
  return (
    <div className="grid gap-4 max-w-3xl">
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-center gap-3">
        <span className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-600 inline-flex items-center justify-center shrink-0"><MapIcon size={18} /></span>
        <div className="flex-1 min-w-[220px]"><h2 className="text-16 font-semibold text-slate-900">{d.done} of {d.total} steps done</h2>
          <div className="mt-1.5 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${d.percent}%` }} /></div></div>
        {d.next && <Link to={d.next.link} className="shrink-0"><span className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-indigo-600 text-white text-14 font-semibold hover:bg-indigo-700">Next: {d.next.title}<ArrowRight size={15} /></span></Link>}
      </section>
      {d.approvals_waiting > 0 && <p className="text-13 text-violet-800 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">{d.approvals_waiting} prepared item{d.approvals_waiting === 1 ? '' : 's'} wait for your approval on the Posts, Reviews, Photos, Profile and Keyword pages. Nothing is published until you approve it.</p>}
      <ol className="grid grid-cols-[minmax(0,1fr)] gap-2">
        {d.steps.map(s => (
          <li key={s.key}>
            <button type="button" onClick={() => setOpen(s.key)} aria-haspopup="dialog" className="w-full flex items-center gap-3 text-left rounded-lg border border-slate-200 bg-white px-3 py-2.5 cursor-pointer hover:bg-slate-50">
              <Icon s={s.status} />
              <span className="min-w-0 flex-1"><span className={`block text-14 font-medium ${s.status === 'done' ? 'text-slate-500' : 'text-slate-900'}`}>{s.order}. {s.title}</span><span className="block text-12 text-slate-500 truncate">{s.detail}</span></span>
              <ChevronRight size={15} className="text-slate-400" />
            </button>
          </li>
        ))}
      </ol>
      <Drawer open={Boolean(sel)} onClose={() => setOpen(null)} width="max-w-md" title={sel ? `${sel.order}. ${sel.title}` : ''} subtitle={sel ? `Step ${sel.order} of ${d.total}` : ''}>
        {sel && <StepDetail s={sel} onClose={() => setOpen(null)} />}
      </Drawer>
    </div>
  );
}

/** The journey on the dashboard: one slim bar (progress and the next step). Click it to open all ten steps in a panel on the right. */
export function JourneyCard({ bid }) {
  const f = useFlow(bid);
  const [panel, setPanel] = useState(false);
  const [open, setOpen] = useState(null);
  const d = f.data;
  if (!d) return <div className="h-20 rounded-xl bg-slate-100 animate-pulse" role="status" aria-busy="true" />;
  const close = () => { setPanel(false); setOpen(null); };
  const show = (key) => { setOpen(key || d.next?.key || null); setPanel(true); };
  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4" aria-label="Your journey">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => show(null)} aria-haspopup="dialog" className="flex flex-1 min-w-[260px] items-center gap-3 text-left cursor-pointer rounded-lg hover:bg-slate-50 -m-1 p-1">
          <span className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-600 inline-flex items-center justify-center shrink-0"><MapIcon size={18} /></span>
          <span className="flex-1 min-w-0"><span className="block text-16 font-semibold text-slate-900">Your journey: {d.done} of {d.total} steps done</span>
            <span className="mt-1.5 block h-2 rounded-full bg-slate-100 overflow-hidden"><span className="block h-full bg-emerald-500 rounded-full" style={{ width: `${d.percent}%` }} /></span></span>
          <span className="text-13 font-semibold text-indigo-600 whitespace-nowrap hidden sm:inline">All {d.total} steps</span><ChevronRight size={16} className="text-slate-400 shrink-0" />
        </button>
        {d.next && <Link to={d.next.link} className="shrink-0"><span className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-indigo-600 text-white text-14 font-semibold hover:bg-indigo-700">Next: {d.next.title}<ArrowRight size={15} /></span></Link>}
      </div>
      {d.approvals_waiting > 0 && <p className="mt-3 text-13 text-violet-800 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">{d.approvals_waiting} prepared item{d.approvals_waiting === 1 ? '' : 's'} wait for your approval on the Posts, Reviews, Photos, Profile and Keyword pages. Nothing is published until you approve it.</p>}
      <Drawer open={panel} onClose={close} width="max-w-md" title="Your journey" subtitle={`${d.done} of ${d.total} steps done`}>
        <ol className="grid grid-cols-[minmax(0,1fr)] gap-2">{d.steps.map(s => <StepRow key={s.key} s={s} total={d.total} open={open === s.key} onToggle={() => setOpen(open === s.key ? null : s.key)} onClose={close} />)}</ol>
      </Drawer>
    </section>
  );
}

/** A slim bar at the top of a page: which step this page belongs to, what it needs first, and what comes next. */
export function StepBar({ bid, step }) {
  const f = useFlow(bid);
  const [open, setOpen] = useState(false);
  const d = f.data;
  const s = d && arr(d.steps).find(x => x.key === step);
  if (!s) return null;
  const nxt = arr(d.steps).find(x => x.order > s.order && x.status !== 'done') || arr(d.steps).find(x => x.order > s.order);
  const tone = s.status === 'done' ? 'border-emerald-200 bg-emerald-50/60 text-emerald-900' : s.status === 'blocked' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-indigo-100 bg-indigo-50/60 text-indigo-900';
  return (
    <div className={`rounded-xl border px-4 py-2.5 text-13 ${tone}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="inline-flex items-center gap-2 font-semibold"><Icon s={s.status} />Step {s.order} of {d.total}: {s.title}</span>
        <span className="text-12.5 opacity-90">{s.status === 'done' ? 'Done. ' : ''}{s.detail}</span>
        <span className="flex-1" />
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="text-12.5 font-semibold underline underline-offset-2 cursor-pointer">{open ? 'Hide' : 'How this fits'}</button>
      </div>
      {s.status === 'blocked' && <p className="mt-1.5 text-13"><b>Do this first:</b> {s.waiting_for.map(w => <Link key={w.key} to={w.link} className="underline font-semibold mr-2">{w.title}</Link>)}</p>}
      {open && (
        <div className="mt-2 pt-2 border-t border-black/10 space-y-1 text-12.5">
          <p>{s.why}</p>
          {s.requires.length > 0 && <p>Needs first: {s.requires.map(r => <span key={r.key} className="inline-flex items-center gap-1 mr-2">{r.done ? <Check size={11} /> : <Lock size={11} />}{r.title}</span>)}</p>}
          {nxt && <p>Comes next: <Link to={nxt.link} className="underline font-semibold">{nxt.order}. {nxt.title}</Link></p>}
          <p><Link to={`/projects/${bid}/journey`} className="underline font-semibold">See this project's whole journey</Link></p>
        </div>
      )}
    </div>
  );
}
