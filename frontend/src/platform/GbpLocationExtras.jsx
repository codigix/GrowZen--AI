import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Save, Clock, AlertTriangle, MapPinned } from 'lucide-react';
import { Card, Button, ErrorNote, inputCls, useAction } from './SeoUi';
import { api, useApi } from './seoApi';
import Select from '../components/Select';

export const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

export const OPEN_STATUSES = [
  ['OPEN', 'Open'],
  ['CLOSED_TEMPORARILY', 'Temporarily closed'],
  ['CLOSED_PERMANENTLY', 'Permanently closed']
];

export const MORE_HOURS_TYPES = {
  DELIVERY: 'Delivery', PICKUP: 'Pickup', TAKEOUT: 'Takeout', DRIVE_THROUGH: 'Drive-through', KITCHEN: 'Kitchen', HAPPY_HOUR: 'Happy hour',
  BREAKFAST: 'Breakfast', LUNCH: 'Lunch', DINNER: 'Dinner', BRUNCH: 'Brunch', SENIOR_HOURS: 'Senior hours', ONLINE_SERVICE_HOURS: 'Online service hours', ACCESS: 'Access'
};

const hhmm = (o) => (o ? `${String(o.hours ?? 0).padStart(2, '0')}:${String(o.minutes ?? 0).padStart(2, '0')}` : '');
export const isAllDay = (p) => Boolean(p && (p.openTime?.hours ?? 0) === 0 && (p.openTime?.minutes ?? 0) === 0 && (p.closeTime?.hours ?? 0) === 24);

/** Google's weekly periods -> one editable row per day. A period from 00:00 to 24:00 is "Open 24 hours". `fresh` is what a brand-new schedule starts as. */
export function hoursFrom(h, fresh = 'weekdays') {
  return DAYS.map(day => {
    const p = (h?.periods || []).find(x => x.openDay === day);
    const startOn = fresh === 'all' ? true : day !== 'SUNDAY';
    return { day, on: Boolean(p) || (!h?.periods && startOn), all: isAllDay(p), open: p && !isAllDay(p) ? hhmm(p.openTime) : '09:00', close: p && !isAllDay(p) ? hhmm(p.closeTime) : '19:00' };
  });
}

/** The editable rows -> Google's periods. "Open 24 hours" is sent as 00:00 to 24:00. */
export function hoursTo(rows) {
  return {
    periods: rows.filter(r => r.on).map(r => {
      if (r.all) return { openDay: r.day, closeDay: r.day, openTime: { hours: 0, minutes: 0 }, closeTime: { hours: 24, minutes: 0 } };
      const [oh, om] = r.open.split(':').map(Number);
      const [ch, cm] = r.close.split(':').map(Number);
      return { openDay: r.day, closeDay: r.day, openTime: { hours: oh, minutes: om }, closeTime: { hours: ch, minutes: cm } };
    })
  };
}

/** One row per weekday: open or closed, open 24 hours, or from-to times. */
export function WeekEditor({ rows, setRows }) {
  const patch = (i, v) => setRows(rs => rs.map((x, j) => (j === i ? { ...x, ...v } : x)));
  return (
    <div className="divide-y divide-gray-100">
      {rows.map((h, i) => (
        <div key={h.day} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
          <span className="w-24 text-13 text-gray-800 capitalize">{h.day.toLowerCase()}</span>
          <label className="flex items-center gap-1.5 text-12 text-gray-600 w-20"><input type="checkbox" checked={h.on} onChange={e => patch(i, { on: e.target.checked })} /> {h.on ? 'Open' : 'Closed'}</label>
          {h.on && (
            <>
              <label className="flex items-center gap-1.5 text-12 text-gray-600"><input type="checkbox" checked={h.all} onChange={e => patch(i, { all: e.target.checked })} />24 hours</label>
              {!h.all && <><input type="time" aria-label={`${h.day.toLowerCase()} opens`} className={`${inputCls} w-28`} value={h.open} onChange={e => patch(i, { open: e.target.value })} /><span className="text-gray-400">–</span><input type="time" aria-label={`${h.day.toLowerCase()} closes`} className={`${inputCls} w-28`} value={h.close} onChange={e => patch(i, { close: e.target.value })} /></>}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/** Open, temporarily closed or permanently closed, and the opening date. */
export function StatusCard({ value, onChange }) {
  const set = (patch) => onChange({ ...value, ...patch });
  return (
    <Card title="Business status" subtitle="Tell Google if the business is open, closed for a while, or has closed for good.">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
        <label className="block"><span className="text-12 text-gray-600 block mb-1">Status</span>
          <Select className={inputCls} value={value.open_status} onChange={e => set({ open_status: e.target.value })} aria-label="Business status">{OPEN_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        </label>
        <label className="block"><span className="text-12 text-gray-600 block mb-1">Opening date <span className="text-gray-400">(optional)</span></span>
          <input type="date" className={inputCls} value={value.opening_date} onChange={e => set({ opening_date: e.target.value })} />
        </label>
      </div>
      {value.open_status === 'CLOSED_PERMANENTLY' && <div className="mt-3 flex gap-2 rounded-lg bg-red-50 ring-1 ring-red-200 px-3.5 py-2.5 text-12.5 text-red-800"><AlertTriangle size={15} className="shrink-0 mt-0.5" /><span>Permanently closed removes the listing from Google Search and Maps results. Only choose this if the business has really closed.</span></div>}
      {value.open_status === 'CLOSED_TEMPORARILY' && <p className="mt-3 text-12.5 text-amber-700 bg-amber-50 rounded-lg px-3.5 py-2.5">The listing stays visible with a "Temporarily closed" label. Switch back to Open when you reopen.</p>}
    </Card>
  );
}

/** Extra hour sets: delivery, pickup, kitchen, happy hour... each with its own weekly schedule. `value` is [{type, rows}]. */
export function MoreHoursCard({ value, onChange }) {
  const left = Object.entries(MORE_HOURS_TYPES).filter(([k]) => !value.some(v => v.type === k));
  const [pick, setPick] = useState('');
  const add = () => { const t = pick || left[0]?.[0]; if (t) { onChange([...value, { type: t, rows: hoursFrom(null, 'all') }]); setPick(''); } };
  return (
    <Card title="More hours" subtitle="Separate hours for delivery, pickup, the kitchen, happy hour and more. They show next to your main hours on Google.">
      {value.length === 0 && <p className="text-13 text-gray-500 pb-2">None added.</p>}
      <div className="space-y-4">
        {value.map((v, vi) => (
          <div key={v.type} className="rounded-lg ring-1 ring-slate-200 p-3">
            <div className="flex items-center justify-between mb-1">
              <div className="text-13 font-semibold text-slate-800 flex items-center gap-1.5"><Clock size={14} className="text-indigo-500" />{MORE_HOURS_TYPES[v.type]}</div>
              <button type="button" onClick={() => onChange(value.filter((_, j) => j !== vi))} className="text-gray-400 hover:text-red-600 cursor-pointer" aria-label={`Remove ${MORE_HOURS_TYPES[v.type]} hours`}><Trash2 size={14} /></button>
            </div>
            <WeekEditor rows={v.rows} setRows={(fn) => onChange(value.map((x, j) => (j === vi ? { ...x, rows: typeof fn === 'function' ? fn(x.rows) : fn } : x)))} />
          </div>
        ))}
      </div>
      {left.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Select className={`${inputCls} w-56`} value={pick || left[0][0]} onChange={e => setPick(e.target.value)} aria-label="Hours type">{left.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          <Button size="sm" icon={Plus} onClick={add}>Add hours type</Button>
        </div>
      )}
    </Card>
  );
}

/** The main weekly schedule (with the 24-hour option) and its quick actions. */
export function QuickHoursActions({ setRows }) {
  return (
    <div className="flex flex-wrap gap-2 mb-2">
      <Button size="sm" onClick={() => setRows(rs => rs.map(r => ({ ...r, on: true, all: true })))}>Open 24 hours, every day</Button>
      <Button size="sm" onClick={() => setRows(rs => rs.map(r => ({ ...r, on: r.day !== 'SUNDAY', all: false, open: '09:00', close: '19:00' })))}>Mon–Sat, 9 am – 7 pm</Button>
    </div>
  );
}

/** Internal labels: tags only the profile's managers see in Google. */
export function LabelsField({ value, onChange }) {
  const [t, setT] = useState('');
  const add = (raw) => {
    const x = raw.trim().slice(0, 255);
    if (x && !value.some(v => v.toLowerCase() === x.toLowerCase()) && value.length < 10) onChange([...value, x]);
    setT('');
  };
  return (
    <div className="md:col-span-2">
      <span className="text-12 text-gray-600 block mb-1">Internal labels <span className="text-gray-400">· only you and other managers see these on Google ({value.length}/10)</span></span>
      <div className="flex flex-wrap gap-1.5 items-center rounded-lg ring-1 ring-slate-200 p-2 focus-within:ring-2 focus-within:ring-indigo-300">
        {value.map(v => <span key={v} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 text-12 text-slate-700">{v}<button type="button" onClick={() => onChange(value.filter(x => x !== v))} className="text-slate-400 hover:text-red-600 cursor-pointer" aria-label={`Remove ${v}`}>×</button></span>)}
        {value.length < 10 && <input className="flex-1 min-w-[140px] h-7 text-13 outline-none bg-transparent" value={t} placeholder="e.g. Pune branch, then Enter" aria-label="Add a label" onChange={e => setT(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(t); } else if (e.key === 'Backspace' && !t && value.length) onChange(value.slice(0, -1)); }} onBlur={() => t.trim() && add(t)} />}
      </div>
    </div>
  );
}

/** Where the business serves customers, and whether its street address shows beside it. Saved on its own (it needs a Google lookup). */
export function ServiceAreaCard({ b, toast }) {
  const cur = useApi(`/businesses/${b.id}/gbp/service-area`);
  const [type, setType] = useState('CUSTOMER_AND_BUSINESS_LOCATION');
  const [areas, setAreas] = useState([]);
  const [t, setT] = useState('');
  const [note, setNote] = useState('');
  const [busy, error, run] = useAction();
  useEffect(() => { if (cur.data) { setType(cur.data.type); setAreas((cur.data.areas || []).map(a => a.name).filter(Boolean)); } }, [cur.data]);
  const add = (raw) => { const x = raw.trim(); if (x && areas.length < 20 && !areas.some(a => a.toLowerCase() === x.toLowerCase())) setAreas([...areas, x]); setT(''); };
  const save = () => run('save', async () => {
    setNote('');
    const r = await api(`/businesses/${b.id}/gbp/service-area`, { method: 'PUT', body: { type, areas } });
    setAreas((r.areas || []).map(a => a.name));
    if (r.unresolved?.length) setNote(`Google could not find: ${r.unresolved.join(', ')}. Use a fuller name such as "Wagholi, Pune".`);
    toast(r.linked ? 'Service area updated on your Google Business Profile' : 'Service area saved. Connect Google to publish it.');
    cur.reload?.(true);
  });
  const opts = [
    ['CUSTOMER_AND_BUSINESS_LOCATION', 'Show my address and also serve customers', 'Customers can visit you and you also go to them.'],
    ['CUSTOMER_LOCATION_ONLY', 'Hide my address, I visit customers', 'Only the areas you serve are shown, not your street address.']
  ];
  return (
    <Card title="Service area" subtitle="The places you serve. Google shows them on the profile." action={<MapPinned size={16} className="text-indigo-500" />}>
      <div className="space-y-2" role="radiogroup" aria-label="How the address is shown">
        {opts.map(([v, l, d]) => (
          <label key={v} className={`flex items-start gap-3 rounded-lg ring-1 px-3.5 py-2.5 cursor-pointer ${type === v ? 'ring-indigo-400 bg-indigo-50/50' : 'ring-slate-200 hover:bg-slate-50'}`}>
            <input type="radio" name="service-area-type" className="mt-1" checked={type === v} onChange={() => setType(v)} />
            <span><span className="block text-13 font-medium text-slate-800">{l}</span><span className="block text-12 text-slate-500">{d}</span></span>
          </label>
        ))}
      </div>
      <div className="mt-4">
        <span className="text-12 text-gray-600 block mb-1">Areas you serve <span className="text-gray-400">({areas.length}/20)</span></span>
        <div className="flex flex-wrap gap-1.5 items-center rounded-lg ring-1 ring-slate-200 p-2 focus-within:ring-2 focus-within:ring-indigo-300">
          {areas.map(a => <span key={a} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-50 text-12 text-indigo-700">{a}<button type="button" onClick={() => setAreas(areas.filter(x => x !== a))} className="text-indigo-300 hover:text-red-600 cursor-pointer" aria-label={`Remove ${a}`}>×</button></span>)}
          {areas.length < 20 && <input className="flex-1 min-w-[180px] h-7 text-13 outline-none bg-transparent" value={t} placeholder="Type an area, e.g. Wagholi, Pune, then Enter" aria-label="Add an area" onChange={e => setT(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(t); } else if (e.key === 'Backspace' && !t && areas.length) setAreas(areas.slice(0, -1)); }} onBlur={() => t.trim() && add(t)} />}
        </div>
        {cur.data && cur.data.linked && !cur.data.lookup_ready && <p className="text-12 text-amber-700 mt-2">Looking up areas on Google needs a Places API key on the server (GOOGLE_PLACES_API_KEY). Ask your admin to set it.</p>}
        {note && <p className="text-12.5 text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mt-2">{note}</p>}
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="mt-3"><Button variant="primary" icon={Save} busy={busy === 'save'} disabled={type === 'CUSTOMER_LOCATION_ONLY' && areas.length === 0} onClick={save}>Save service area</Button></div>
    </Card>
  );
}
