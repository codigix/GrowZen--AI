import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';

/**
 * The one dropdown used across the app: a searchable, keyboard-friendly replacement for the browser's own <select>.
 *
 * It takes the same props and children as <select> (value, onChange, className, disabled, name, aria-label,
 * <option>, <optgroup>) and calls onChange with { target: { value, name } }, so it is a drop-in swap.
 * The list opens in a portal, so it is never clipped by a modal, a card or a scrolling table.
 */

// Flatten <option>/<optgroup>/fragments/arrays into [{ value, label, disabled, group }].
function readOptions(children, group = null, out = []) {
  React.Children.forEach(children, (c) => {
    if (c == null || c === false || typeof c === 'string' || typeof c === 'number') return;
    if (c.type === React.Fragment) return readOptions(c.props.children, group, out);
    if (c.type === 'optgroup') return readOptions(c.props.children, c.props.label, out);
    if (c.type === 'option') {
      const label = React.Children.toArray(c.props.children).join('');
      out.push({ value: String(c.props.value ?? label), label, disabled: Boolean(c.props.disabled), group });
    }
  });
  return out;
}

const norm = (s) => String(s ?? '').toLowerCase();

export default function Select({
  value, onChange, children, className = '', disabled = false, name, placeholder = 'Select…', searchPlaceholder = 'Search…',
  'aria-label': ariaLabel, title, id, required, ...rest
}) {
  const options = useMemo(() => readOptions(children), [children]);
  const current = String(value ?? '');
  const selected = options.find(o => o.value === current);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  const pop = useRef(null);
  const search = useRef(null);
  const list = useRef(null);

  const filtered = useMemo(() => {
    const q = norm(query).trim();
    return q ? options.filter(o => norm(o.label).includes(q) || norm(o.value).includes(q)) : options;
  }, [options, query]);

  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const room = window.innerHeight - r.bottom;
    const up = room < 280 && r.top > room; // not enough space below: open upwards
    const width = Math.max(r.width, 200);
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8));
    setPos({ left, width, top: up ? undefined : r.bottom + 6, bottom: up ? window.innerHeight - r.top + 6 : undefined, max: Math.max(180, Math.min(340, (up ? r.top : room) - 16)) });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!btn.current?.contains(e.target) && !pop.current?.contains(e.target)) setOpen(false); };
    const move = (e) => { if (!pop.current?.contains(e.target)) place(); };
    document.addEventListener('mousedown', away);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', move, true);
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('resize', place); window.removeEventListener('scroll', move, true); };
  }, [open, place]);
  useEffect(() => { if (open) setTimeout(() => search.current?.focus(), 0); }, [open]);
  useEffect(() => { setActive(0); }, [query, open]);
  useEffect(() => { // bring the highlighted row into view
    list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const openList = () => {
    if (disabled) return;
    setQuery('');
    const i = options.findIndex(o => o.value === current);
    setOpen(true);
    setTimeout(() => setActive(Math.max(0, i)), 0);
  };
  const pick = (o) => {
    if (!o || o.disabled) return;
    setOpen(false);
    btn.current?.focus();
    if (o.value !== current) onChange?.({ target: { value: o.value, name }, currentTarget: { value: o.value, name } });
  };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(filtered.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(filtered.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(filtered[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); btn.current?.focus(); }
    else if (e.key === 'Tab') setOpen(false);
  };

  const label = selected ? selected.label : (options[0] && current === '' ? options[0].label : placeholder);
  const muted = !selected || selected.value === '';

  return (
    <>
      <button ref={btn} type="button" id={id} title={title} disabled={disabled} aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(e) => { if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); openList(); } }}
        className={`${className} !flex items-center justify-between gap-2 text-left !appearance-none ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`} {...rest}>
        <span className={`truncate min-w-0 ${muted && selected?.value === '' ? 'text-slate-500' : ''}`}>{label}</span>
        <ChevronDown size={15} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {name && required && <input tabIndex={-1} aria-hidden="true" className="sr-only" required value={current} onChange={() => {}} />}
      {open && pos && createPortal(
        <div ref={pop} onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey}
          style={{ position: 'fixed', left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, zIndex: 9999 }}
          className="rounded-lg bg-white shadow-2xl ring-1 ring-slate-200 overflow-hidden animate-in fade-in duration-100">
          <div className="flex items-center gap-2 px-3 border-b border-slate-100">
            <Search size={14} className="text-slate-400 shrink-0" aria-hidden="true" />
            <input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searchPlaceholder} aria-label="Search options"
              className="w-full h-10 text-13 bg-transparent outline-none text-slate-800 placeholder:text-slate-400" />
          </div>
          <ul ref={list} role="listbox" aria-label={ariaLabel} style={{ maxHeight: pos.max - 44 }} className="overflow-y-auto py-1">
            {filtered.length === 0 && <li className="px-3 py-3 text-13 text-slate-400 text-center">No match</li>}
            {filtered.map((o, i) => (
              <React.Fragment key={`${o.group || ''}|${o.value}|${i}`}>
                {o.group && (i === 0 || filtered[i - 1].group !== o.group) && <li className="px-3 pt-2 pb-1 text-11 font-semibold uppercase tracking-wide text-slate-400" role="presentation">{o.group}</li>}
                <li role="option" aria-selected={o.value === current} aria-disabled={o.disabled || undefined} data-i={i}
                  onMouseEnter={() => setActive(i)} onClick={() => pick(o)}
                  className={`mx-1 px-3 py-2 rounded-md text-13 flex items-center gap-2 ${o.disabled ? 'text-slate-300 cursor-not-allowed' : 'cursor-pointer'} ${i === active && !o.disabled ? 'bg-indigo-50 text-indigo-900' : 'text-slate-700'} ${o.value === current ? 'font-semibold' : ''}`}>
                  <span className="flex-1 truncate">{o.label || '—'}</span>
                  {o.value === current && <Check size={14} className="text-indigo-600 shrink-0" />}
                </li>
              </React.Fragment>
            ))}
          </ul>
        </div>,
        document.body
      )}
    </>
  );
}
