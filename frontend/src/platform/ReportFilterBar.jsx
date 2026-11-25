import React, { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronDown, MapPin, RotateCcw, Search, X } from 'lucide-react';
import { api, useApi } from './seoApi';
import PlacePicker from './PlacePicker';
import { MAX_LOCATIONS, PRESETS, describePeriod, isDefault, resetFilter, resolveRange, setFilter, useReportFilter } from './reportFilter';
import Select from '../components/Select';

const MODES = [['presets', 'Period'], ['month', 'Month'], ['year', 'Year'], ['custom', 'Custom']];
const Lbl = ({ children }) => <div className="text-12 font-semibold text-slate-700 mb-1">{children}</div>;
const fieldCls = 'h-9 w-full rounded-lg ring-1 ring-inset ring-slate-300 bg-white px-2.5 text-13 text-slate-800';

/** The header filter every SEO, GEO, AEO and GMB page shares: period (preset, month, year, custom), country and location. */
export default function ReportFilterBar({ business }) {
  const f = useReportFilter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(f.preset === 'month' ? 'month' : f.preset === 'year' ? 'year' : f.preset === 'custom' ? 'custom' : 'presets');
  const box = useRef(null);
  const places = f.locations || [];
  const countries = useApi(open ? '/discover/countries' : null);
  const now = new Date();
  const years = Array.from({ length: 6 }, (_, i) => String(now.getFullYear() - i));

  useEffect(() => {
    if (!open) return undefined;
    const on = (e) => { if (box.current && !box.current.contains(e.target) && !e.target.closest?.('[role=listbox],[role=option]')) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', on); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', on); document.removeEventListener('keydown', esc); };
  }, [open]);

  const country = f.country || business?.country || 'IN';
  const countryName = (countries.data || []).find(c => c.code === f.country)?.name || f.country;
  const range = resolveRange(f);
  const summary = [describePeriod(f), f.country && countryName, places.length > 0 && (places.length === 1 ? places[0].label.split(',')[0] : `${places.length} locations`)].filter(Boolean).join(' · ');
  const active = !isDefault(f);

  return (
    <div className="relative" ref={box}>
      <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(o => !o)} title="Period, country and location for every page"
        className={`h-9 max-w-[420px] px-3 rounded bg-topbar-field border border-dashed ${active ? 'border-sky-400/60 text-white' : 'border-white/10 text-topbar-item'} flex items-center gap-2 text-12 font-medium hover:text-white cursor-pointer transition-colors`}>
        <Calendar size={13} className="shrink-0" /><span className="truncate">{summary}</span>{places.length > 0 && <MapPin size={12} className="shrink-0 opacity-70" />}<ChevronDown size={13} className="shrink-0" />
      </button>
      {open && (
        <div role="dialog" aria-label="Report filter" className="absolute right-0 top-full mt-2 w-[420px] max-h-[calc(100vh-110px)] overflow-y-auto max-w-[calc(100vw-24px)] rounded-xl bg-white text-slate-800 shadow-2xl ring-1 ring-slate-200 p-4 z-50">
          <div className="flex items-center mb-3"><div className="text-14 font-semibold">Report filter</div><button type="button" onClick={() => setOpen(false)} aria-label="Close" className="ml-auto p-1 text-slate-400 hover:text-slate-700 cursor-pointer"><X size={15} /></button></div>

          <Lbl>Period</Lbl>
          <div className="inline-flex rounded-lg ring-1 ring-inset ring-slate-300 overflow-hidden mb-2" role="tablist">{MODES.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)} className={`px-3 h-8 text-12.5 cursor-pointer ${mode === k ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}</div>
          {mode === 'presets' && <div className="grid grid-cols-2 gap-1.5">{PRESETS.map(([k, l]) => <button key={k} type="button" aria-pressed={f.preset === k} onClick={() => setFilter({ preset: k, from: '', to: '' })} className={`h-8 rounded-lg text-12.5 text-left px-2.5 cursor-pointer ring-1 ring-inset ${f.preset === k ? 'bg-indigo-50 ring-indigo-300 text-indigo-700 font-semibold' : 'ring-slate-200 text-slate-700 hover:bg-slate-50'}`}>{l}</button>)}</div>}
          {mode === 'month' && <div><input type="month" aria-label="Month" max={`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`} value={f.preset === 'month' ? f.from : ''} onChange={e => e.target.value && setFilter({ preset: 'month', from: e.target.value, to: '' })} className={fieldCls} /></div>}
          {mode === 'year' && <div className="flex flex-wrap gap-1.5">{years.map(y => <button key={y} type="button" aria-pressed={f.preset === 'year' && f.from === y} onClick={() => setFilter({ preset: 'year', from: y, to: '' })} className={`h-8 px-3 rounded-lg text-12.5 cursor-pointer ring-1 ring-inset ${f.preset === 'year' && f.from === y ? 'bg-indigo-50 ring-indigo-300 text-indigo-700 font-semibold' : 'ring-slate-200 text-slate-700 hover:bg-slate-50'}`}>{y}</button>)}</div>}
          {mode === 'custom' && (
            <div className="grid grid-cols-2 gap-2">
              <div><div className="text-11.5 text-slate-500 mb-0.5">From</div><input type="date" aria-label="From" max={new Date().toISOString().slice(0, 10)} value={f.preset === 'custom' ? f.from : ''} onChange={e => setFilter({ preset: 'custom', from: e.target.value, to: f.preset === 'custom' ? f.to : '' })} className={fieldCls} /></div>
              <div><div className="text-11.5 text-slate-500 mb-0.5">To</div><input type="date" aria-label="To" max={new Date().toISOString().slice(0, 10)} value={f.preset === 'custom' ? f.to : ''} onChange={e => setFilter({ preset: 'custom', to: e.target.value, from: f.preset === 'custom' ? f.from : '' })} className={fieldCls} /></div>
            </div>
          )}
          {range && <div className="mt-1.5 text-12 text-slate-500">{range.from} to {range.to}</div>}

          <div className="mt-4"><Lbl>Country</Lbl>
            <Select aria-label="Country" value={f.country} onChange={e => setFilter({ country: e.target.value, locations: [] })} className={fieldCls}>
              <option value="">Project's own country</option>{(countries.data || []).map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
            </Select>
          </div>

          <div className="mt-3"><Lbl>Locations</Lbl>
            {business ? <PlacePicker inline multiple max={MAX_LOCATIONS} b={{ ...business, country }} value={places} onChange={(next) => setFilter({ locations: next })} mapHeight={150} /> : <p className="text-12 text-slate-500">Open a project to choose places.</p>}
          </div>

          <p className="mt-3 text-11.5 leading-snug text-slate-500">The period cuts Search Console, Analytics and Business Profile figures, dashboards and rank history. The country sets the market for keyword volumes, Google results and Search Console. The location is used for Google results and Maps reads. Stored audits are snapshots and do not change.</p>
          <div className="mt-3 flex items-center gap-2">
            <button type="button" onClick={resetFilter} disabled={!active} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg ring-1 ring-inset ring-slate-300 text-12.5 text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"><RotateCcw size={13} />Reset</button>
            <button type="button" onClick={() => setOpen(false)} className="ml-auto h-8 px-4 rounded-lg bg-indigo-600 text-white text-12.5 font-semibold hover:bg-indigo-700 cursor-pointer">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
