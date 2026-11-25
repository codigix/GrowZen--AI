import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { inputCls } from './SeoUi';

const pad = (n) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);     // 1-12
const MINUTES = Array.from({ length: 60 }, (_, i) => i);       // 0-59

// AM / PM stays a plain native <select> (two options; typing "a" or "p" also picks one).
const timeSelectCls = 'h-9 px-2 rounded bg-white ring-1 ring-inset ring-slate-200 text-13 text-slate-900 cursor-pointer';

/**
 * One time part (hour or minute) that can be typed OR picked: type the digits (they are applied as soon as they are
 * complete, or when you leave the box / press Enter), use the up/down arrow keys, or open the little list.
 */
function NumberBox({ value, min, max, options, onCommit, label }) {
  const [text, setText] = useState(pad(value));
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const wrap = useRef(null);
  const pop = useRef(null);
  useEffect(() => { setText(pad(value)); }, [value]);

  const commit = (raw) => {
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) { setText(pad(value)); return; }
    const v = Math.min(max, Math.max(min, n));
    setText(pad(v));
    if (v !== value) onCommit(v);
  };
  const step = (d) => { const n = value + d; onCommit(n > max ? min : n < min ? max : n); };
  const typed = (e) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 2);
    setText(digits);
    // two digits, or a first digit that cannot be followed by another valid one (e.g. 7 for minutes): apply now
    if (digits.length === 2 || (digits.length === 1 && Number(digits) * 10 > max)) commit(digits);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const r = wrap.current?.getBoundingClientRect();
    if (!r) return;
    const room = window.innerHeight - r.bottom;
    const up = room < 230 && r.top > room;
    setPos({ left: r.left, width: Math.max(r.width, 72), top: up ? undefined : r.bottom + 4, bottom: up ? window.innerHeight - r.top + 4 : undefined });
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!wrap.current?.contains(e.target) && !pop.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  useEffect(() => { if (open && pos) pop.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'center' }); }, [open, pos]);

  return (
    <>
      <span ref={wrap} className="inline-flex items-center h-9 rounded bg-white ring-1 ring-inset ring-slate-200 focus-within:ring-2 focus-within:ring-indigo-500 text-13 text-slate-900">
        <input type="text" inputMode="numeric" autoComplete="off" aria-label={label} value={text} maxLength={2}
          className="w-8 h-full pl-2 bg-transparent outline-none text-center tabular-nums"
          onChange={typed} onFocus={e => e.target.select()} onBlur={() => commit(text)}
          onKeyDown={e => {
            if (e.key === 'ArrowUp') { e.preventDefault(); step(1); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); step(-1); }
            else if (e.key === 'Enter') { e.preventDefault(); commit(text); e.currentTarget.blur(); }
          }} />
        <button type="button" tabIndex={-1} aria-label={`Choose ${label.toLowerCase()} from the list`} onClick={() => setOpen(o => !o)}
          className="h-full px-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"><ChevronDown size={14} /></button>
      </span>
      {open && pos && createPortal(
        <ul ref={pop} role="listbox" aria-label={label} onMouseDown={e => e.stopPropagation()}
          style={{ position: 'fixed', left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, zIndex: 9999, maxHeight: 220 }}
          className="overflow-y-auto py-1 rounded-lg bg-white shadow-2xl ring-1 ring-slate-200 text-13">
          {options.map(o => (
            <li key={o} role="option" aria-selected={o === value} onClick={() => { setOpen(false); if (o !== value) onCommit(o); }}
              className={`mx-1 px-3 py-1.5 rounded-md cursor-pointer tabular-nums hover:bg-indigo-50 ${o === value ? 'font-semibold text-indigo-700 bg-indigo-50' : 'text-slate-700'}`}>{pad(o)}</li>
          ))}
        </ul>,
        document.body
      )}
    </>
  );
}

/** "YYYY-MM-DDTHH:mm" for right now, in the browser's own time zone (same shape the scheduling fields already use). */
export const nowLocal = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
/** Today's date as "YYYY-MM-DD", for a date input's min. */
export const todayLocal = () => nowLocal().slice(0, 10);

/** A 24-hour "HH:MM" split into 12-hour parts. */
const split24 = (hhmm) => {
  const [hStr, mStr] = String(hhmm || '00:00').split(':');
  const h = Number(hStr) || 0, m = Number(mStr) || 0;
  return { hour12: (h % 12) || 12, minute: m, ampm: h >= 12 ? 'PM' : 'AM' };
};
/** 12-hour parts back into a 24-hour "HH:MM". */
const join24 = (hour12, minute, ampm) => {
  let h = Number(hour12) % 12;
  if (ampm === 'PM') h += 12;
  return `${pad(h)}:${pad(minute)}`;
};

/**
 * Hour / minute / AM-PM selects for a 24-hour "HH:MM" time string. Always shows 12-hour AM/PM, regardless of the
 * browser's own locale (a native <input type="time"> follows the computer's clock setting, which is 24-hour on
 * some computers). value / onChange keep using the same "HH:MM" string the rest of the scheduling code expects.
 */
export function TimeAmPm({ value, onChange, className = '' }) {
  const { hour12, minute, ampm } = split24(value);
  const set = (patch) => {
    const next = { hour12, minute, ampm, ...patch };
    onChange(join24(next.hour12, next.minute, next.ampm));
  };
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <NumberBox value={hour12} min={1} max={12} options={HOURS} label="Hour" onCommit={v => set({ hour12: v })} />
      <span className="text-slate-400 font-semibold">:</span>
      <NumberBox value={minute} min={0} max={59} options={MINUTES} label="Minute" onCommit={v => set({ minute: v })} />
      <select className={`${timeSelectCls} font-semibold`} value={ampm} onChange={e => set({ ampm: e.target.value })} aria-label="AM or PM">
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}

/**
 * Date + time picker for the "YYYY-MM-DDTHH:mm" local string the schedule fields already pass around (it becomes
 * `new Date(value).toISOString()` when sent to the server). Shows the time in 12-hour AM/PM form (see TimeAmPm);
 * the date itself still uses the browser's own date picker, which has no AM/PM concept.
 */
export default function DateTimeAmPm({ value, onChange, className = '' }) {
  const [date, time] = String(value || '').split('T');
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <input type="date" className={inputCls} style={{ maxWidth: 168 }} min={todayLocal()} value={date || ''}
        onChange={e => onChange(`${e.target.value}T${time || '00:00'}`)} aria-label="Date" />
      <TimeAmPm value={time} onChange={t => onChange(`${date || todayLocal()}T${t}`)} />
    </div>
  );
}
