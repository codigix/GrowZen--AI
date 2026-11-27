import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';

/**
 * A dropdown that picks several values, styled like <Select>: a button that says what is chosen, and a searchable list with a tick for each choice.
 *   options: [{ value, label, hint? }]        value: array of chosen values (empty = nothing chosen)        onChange(nextArray)
 *   allLabel: what the button says when nothing is chosen (the caller treats that as "all")
 *   actions: [{ label, onClick, disabled? }]  extra shortcuts shown above the list (for example "All analyzed")
 */
export default function MultiSelect({ options, value, onChange, allLabel = 'All', actions = [], searchPlaceholder = 'Search…', className = '', 'aria-label': ariaLabel, noun = 'selected' }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef(null);
  const chosen = useMemo(() => new Set(value || []), [value]);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const shown = useMemo(() => { const n = q.trim().toLowerCase(); return n ? options.filter(o => `${o.label} ${o.value}`.toLowerCase().includes(n)) : options; }, [options, q]);
  const first = options.find(o => chosen.has(o.value));
  const text = !chosen.size ? allLabel : chosen.size === 1 ? (first?.label || '1 selected') : `${first?.label || 'Several'} +${chosen.size - 1}`;
  const toggle = (v) => { const n = new Set(chosen); n.has(v) ? n.delete(v) : n.add(v); onChange([...n]); };
  return (
    <div ref={box} className={`relative inline-block ${className}`}>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel} onClick={() => setOpen(o => !o)}
        className="h-9 min-w-[220px] max-w-[360px] rounded-lg ring-1 ring-inset ring-slate-300 bg-white px-3 text-13 text-left inline-flex items-center gap-2 cursor-pointer hover:bg-slate-50">
        <span className="truncate flex-1 font-medium text-slate-800">{text}</span>
        {chosen.size > 1 && <span className="text-11 font-semibold text-indigo-700 bg-indigo-50 rounded-full px-1.5">{chosen.size} {noun}</span>}
        <ChevronDown size={14} className="text-slate-400 shrink-0" />
      </button>
      {open && (
        <div role="listbox" aria-multiselectable="true" className="absolute z-40 mt-1.5 w-[340px] max-w-[92vw] rounded-xl bg-white shadow-xl ring-1 ring-slate-200 overflow-hidden">
          <div className="p-2 border-b border-slate-100 relative">
            <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} className="h-8 w-full rounded-lg ring-1 ring-inset ring-slate-200 pl-8 pr-2 text-13 outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div className="px-3 py-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 text-12.5">
            {actions.map(a => <button key={a.label} type="button" disabled={a.disabled} onClick={() => { a.onClick(); }} className="font-semibold text-indigo-700 hover:underline disabled:opacity-40 disabled:no-underline cursor-pointer">{a.label}</button>)}
            <button type="button" disabled={!chosen.size} onClick={() => onChange([])} className="font-semibold text-slate-600 hover:underline disabled:opacity-40 disabled:no-underline cursor-pointer ml-auto">Clear</button>
          </div>
          <ul className="max-h-72 overflow-auto py-1">
            {shown.map(o => {
              const on = chosen.has(o.value);
              return (
                <li key={o.value} role="option" aria-selected={on}>
                  <button type="button" onClick={() => toggle(o.value)} className={`w-full px-3 py-1.5 flex items-center gap-2.5 text-13 text-left cursor-pointer hover:bg-slate-50 ${on ? 'bg-indigo-50/60' : ''}`}>
                    <span className={`w-4 h-4 rounded border inline-flex items-center justify-center shrink-0 ${on ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300 bg-white'}`}>{on && <Check size={11} strokeWidth={3} />}</span>
                    <span className="truncate flex-1 text-slate-900">{o.label}</span>
                    {o.hint && <span className="text-11.5 text-slate-400 shrink-0">{o.hint}</span>}
                  </button>
                </li>
              );
            })}
            {!shown.length && <li className="px-3 py-3 text-13 text-slate-500">Nothing matches “{q}”.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
