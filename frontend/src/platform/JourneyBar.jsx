import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, ChevronDown, Circle, Lock, Map as MapIcon } from 'lucide-react';
import { useApi } from './seoApi';

const arr = (v) => (Array.isArray(v) ? v : []);
const Icon = ({ s }) => (s === 'done' ? <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 inline-flex items-center justify-center shrink-0"><Check size={13} /></span>
  : s === 'blocked' ? <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-400 inline-flex items-center justify-center shrink-0"><Lock size={12} /></span>
    : <span className="w-6 h-6 rounded-full bg-indigo-50 text-indigo-600 inline-flex items-center justify-center shrink-0"><Circle size={10} fill="currentColor" /></span>);

export function useFlow(bid) { return useApi(bid ? `/businesses/${bid}/flow` : null); }

/** The whole journey: ten steps in order, what each needs first, and the next thing to do. */
export function JourneyCard({ bid }) {
  const f = useFlow(bid);
  const [open, setOpen] = useState(null);
  const d = f.data;
  if (!d) return <div className="h-40 rounded-xl bg-slate-100 animate-pulse" role="status" aria-busy="true" />;
  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5" aria-label="Your journey">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-600 inline-flex items-center justify-center shrink-0"><MapIcon size={18} /></span>
        <div className="flex-1 min-w-[220px]"><h2 className="text-16 font-semibold text-slate-900">Your journey: {d.done} of {d.total} steps done</h2>
          <div className="mt-1.5 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${d.percent}%` }} /></div></div>
        {d.next && <Link to={d.next.link} className="shrink-0"><span className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-indigo-600 text-white text-14 font-semibold hover:bg-indigo-700">Next: {d.next.title}<ArrowRight size={15} /></span></Link>}
      </div>
      {d.approvals_waiting > 0 && <p className="mt-3 text-13 text-violet-800 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">{d.approvals_waiting} prepared item{d.approvals_waiting === 1 ? '' : 's'} wait for your approval on the Posts, Reviews, Photos, Profile and Keyword pages. Nothing is published until you approve it.</p>}
      <ol className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-1">
        {d.steps.map(s => (
          <li key={s.key} className="min-w-0">
            <button type="button" onClick={() => setOpen(open === s.key ? null : s.key)} aria-expanded={open === s.key} className="w-full flex items-center gap-3 text-left rounded-lg px-2 py-2 hover:bg-slate-50 cursor-pointer">
              <Icon s={s.status} />
              <span className="min-w-0 flex-1"><span className={`block text-14 font-medium ${s.status === 'done' ? 'text-slate-500' : 'text-slate-900'}`}>{s.order}. {s.title}</span><span className="block text-12 text-slate-500 truncate">{s.status === 'blocked' ? `Waiting for: ${s.waiting_for.map(w => w.title).join(', ')}` : s.detail}</span></span>
              <ChevronDown size={14} className={`text-slate-400 transition-transform ${open === s.key ? 'rotate-180' : ''}`} />
            </button>
            {open === s.key && (
              <div className="ml-11 mb-2 text-13 text-slate-600 space-y-1.5">
                <p>{s.why}</p><p className="text-slate-700">{s.detail}</p>
                {s.requires.length > 0 && <p className="text-12.5">Needs first: {s.requires.map(r => <span key={r.key} className={`inline-flex items-center gap-1 mr-2 ${r.done ? 'text-emerald-700' : 'text-amber-700 font-medium'}`}>{r.done ? <Check size={11} /> : <Lock size={11} />}{r.title}</span>)}</p>}
                <Link to={s.status === 'blocked' ? s.waiting_for[0].link : s.link} className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:underline">{s.status === 'blocked' ? `Do this first: ${s.waiting_for[0].title}` : s.status === 'done' ? 'Open' : 'Do this step'}<ArrowRight size={13} /></Link>
              </div>
            )}
          </li>
        ))}
      </ol>
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
          <p><Link to="/dashboard" className="underline font-semibold">See the whole journey</Link></p>
        </div>
      )}
    </div>
  );
}
