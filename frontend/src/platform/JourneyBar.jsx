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

/** Where every project stands: { [businessId]: { done, total, percent, next: { order, title } } } (one request for all of them). */
export function useJourneys() { return useApi('/flow/projects').data?.projects || {}; }

/** One project's journey in a panel on the right: progress, the next step, and all ten steps (each opens to its detail). */
export function JourneyDrawer({ bid, name, open, onClose }) {
  const f = useFlow(open ? bid : null);
  const [cur, setCur] = useState(null);
  const d = f.data;
  const close = () => { setCur(null); onClose(); };
  const show = cur === null ? d?.next?.key : cur;
  return (
    <Drawer open={open} onClose={close} width="max-w-md" title={name ? `${name}: journey` : 'Project journey'} subtitle={d ? `${d.done} of ${d.total} steps done` : ''}>
      {!d ? <div className="h-40 rounded-xl bg-slate-100 animate-pulse" role="status" aria-busy="true" /> : (
        <div className="grid gap-3">
          <div className="rounded-lg bg-white border border-slate-200 p-3">
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${d.percent}%` }} /></div>
            {d.next && <Link to={d.next.link} onClick={close} className="mt-3 inline-flex"><span className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-indigo-600 text-white text-13 font-semibold hover:bg-indigo-700">Next: {d.next.title}<ArrowRight size={14} /></span></Link>}
          </div>
          {d.approvals_waiting > 0 && <p className="text-12.5 text-violet-800 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">{d.approvals_waiting} prepared item{d.approvals_waiting === 1 ? '' : 's'} wait for your approval. Nothing is published until you approve it.</p>}
          <ol className="grid grid-cols-[minmax(0,1fr)] gap-2">{d.steps.map(st => <StepRow key={st.key} s={st} total={d.total} open={show === st.key} onToggle={() => setCur(show === st.key ? '' : st.key)} onClose={close} />)}</ol>
        </div>
      )}
    </Drawer>
  );
}

/** A button showing a project's current stage ("Step 4 · Choose keywords"). It opens that project's journey on the right. */
export function JourneyButton({ bid, name, stage, link = false }) {
  const [open, setOpen] = useState(false);
  const label = !stage ? 'Journey' : stage.next ? `Step ${stage.next.order} · ${stage.next.title}` : 'Journey done';
  return (
    <>
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(true); }} aria-haspopup="dialog" title={stage ? `${stage.done} of ${stage.total} steps done` : 'Open the project journey'}
        className={link ? 'font-semibold text-indigo-700 hover:underline cursor-pointer text-left' : 'h-8 px-3 rounded-lg inline-flex items-center gap-1.5 text-13 font-medium text-emerald-800 ring-1 ring-emerald-200 bg-emerald-50/60 hover:bg-emerald-50 cursor-pointer whitespace-nowrap'}>
        {!link && <MapIcon size={13} />}{label}
      </button>
      {open && <JourneyDrawer bid={bid} name={name} open onClose={() => setOpen(false)} />}
    </>
  );
}

/** A slim bar at the top of a page: which step this page belongs to, what it needs first, and what comes next. */
export function StepBar({ bid, step }) {
  const f = useFlow(bid);
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState(false);
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
          <p><button type="button" onClick={() => setPanel(true)} className="underline font-semibold cursor-pointer">See this project's whole journey</button></p>
        </div>
      )}
      <JourneyDrawer bid={bid} open={panel} onClose={() => setPanel(false)} />
    </div>
  );
}
