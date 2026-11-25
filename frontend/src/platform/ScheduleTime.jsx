import React from 'react';
import { inputCls } from './SeoUi';

const pad = (n) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);     // 1-12
const MINUTES = Array.from({ length: 60 }, (_, i) => i);       // 0-59

// A plain native <select>: for a short list like this (12 hours, 60 minutes, AM/PM) it is quicker to use than a
// searchable dropdown (no overlay to open, pick with the keyboard's up/down arrows or by typing the first digit).
const timeSelectCls = 'h-9 px-2 rounded bg-white ring-1 ring-inset ring-slate-200 text-13 text-slate-900 cursor-pointer';

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
      <select className={timeSelectCls} value={hour12} onChange={e => set({ hour12: Number(e.target.value) })} aria-label="Hour">
        {HOURS.map(h => <option key={h} value={h}>{pad(h)}</option>)}
      </select>
      <span className="text-slate-400 font-semibold">:</span>
      <select className={timeSelectCls} value={minute} onChange={e => set({ minute: Number(e.target.value) })} aria-label="Minute">
        {MINUTES.map(m => <option key={m} value={m}>{pad(m)}</option>)}
      </select>
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
