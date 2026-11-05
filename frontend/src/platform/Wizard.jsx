import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Check } from 'lucide-react';

/**
 * A setup window with a dark step list on the left and the step's form on the right (used by "New audit" and "New Position Tracking campaign").
 * steps: [{ id, label, hint }]. `done` marks steps already filled in. The footer is where the step's main button goes.
 */
export default function Wizard({ open, onClose, title, steps, step, onStep, done = [], heading, aside, children, footer }) {
  useEffect(() => {
    if (!open) return undefined;
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = overflow; };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] bg-slate-900/50 flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={title} onMouseDown={onClose}>
      <div className="relative w-full max-w-5xl h-[min(760px,calc(100vh-2rem))] rounded-2xl overflow-hidden bg-white shadow-2xl flex flex-col md:flex-row" onMouseDown={e => e.stopPropagation()}>
        <aside className="md:w-72 shrink-0 bg-[#1b211f] text-white p-5 md:p-7 overflow-y-auto">
          <div className="text-18 font-bold leading-snug">{title}</div>
          <ol className="mt-5 space-y-1.5">
            {steps.map((s, i) => {
              const active = s.id === step;
              return (
                <li key={s.id}>
                  <button type="button" onClick={() => onStep(s.id)} aria-current={active ? 'step' : undefined}
                    className={`w-full text-left rounded-lg px-3 py-2.5 flex gap-3 cursor-pointer transition-colors ${active ? 'bg-white/15' : 'hover:bg-white/10'}`}>
                    <span className="w-5 shrink-0 text-15 font-bold">{done.includes(s.id) ? <Check size={17} /> : i + 1}</span>
                    <span className="min-w-0"><span className="block text-15 font-semibold leading-tight">{s.label}</span>{s.hint && <span className="block text-13 text-white/70 mt-0.5">{s.hint}</span>}</span>
                  </button>
                </li>);
            })}
          </ol>
        </aside>
        <section className="flex-1 min-w-0 flex flex-col">
          <button type="button" onClick={onClose} aria-label="Close" className="absolute top-4 right-4 w-9 h-9 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 cursor-pointer"><X size={20} /></button>
          <div className="flex-1 overflow-y-auto px-6 md:px-10 pt-8 pb-4">
            <h2 className="text-28 font-bold text-slate-900 flex items-center gap-2">{heading}</h2>
            {aside}
            <div className="mt-6">{children}</div>
          </div>
          <div className="shrink-0 px-6 md:px-10 py-5 flex justify-center">{footer}</div>
        </section>
      </div>
    </div>,
    document.body
  );
}

export const Row = ({ label, hint, children }) => (
  <div className="grid grid-cols-1 sm:grid-cols-[170px_1fr] gap-x-6 gap-y-1.5 py-3 items-start">
    <div className="text-15 text-slate-800 pt-2">{label}</div>
    <div className="min-w-0">{children}{hint && <p className="text-14 text-slate-500 mt-2">{hint}</p>}</div>
  </div>
);

export const fieldCls = 'h-10 px-3 text-14 rounded border border-slate-300 bg-white text-slate-800 outline-none focus:border-indigo-400';
export const boxCls = 'w-full px-3 py-2.5 text-14 rounded border border-slate-300 bg-white text-slate-800 outline-none focus:border-indigo-400 font-mono';
