import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, MapPin, Plus, Search, X } from 'lucide-react';
import { api } from './seoApi';
import { refreshBusinesses } from './SeoUi';
import LocationsMap from './LocationsMap';

/**
 * The place the keyword figures are for, chosen like on a map: search any place Google Maps knows (or click the map), use it at once, and save it as a target area of the project so it stays
 * in the list and is targeted from now on. The project's own places (country, city, target areas) are listed first.
 */
export default function PlacePicker({ b, value, places, onChange, onSaved }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [found, setFound] = useState([]);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [pin, setPin] = useState(null);
  const box = useRef(null);
  const country = (b.country || 'IN').toUpperCase();
  const saved = (b.target_areas || []).map(x => x.toLowerCase());
  const active = value || places[0]?.name || 'Country';

  useEffect(() => {
    if (!open) return undefined;
    const on = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', on); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', on); document.removeEventListener('keydown', esc); };
  }, [open]);

  // the active place gets its pin on the map
  useEffect(() => {
    if (!open || !value) { setPin(null); return; }
    api(`/businesses/${b.id}/keyword-workspace/area-pin?label=${encodeURIComponent(value)}&country=${country}`).then(r => setPin(r.pin ? { label: value, lat: r.pin.lat, lng: r.pin.lng } : null)).catch(() => setPin(null));
  }, [open, value, b.id, country]);

  const search = (v) => {
    setTyped(v); setNote('');
    if (v.trim().length < 2) { setFound([]); return; }
    setBusy('search');
    api(`/businesses/${b.id}/keyword-workspace/area-search?q=${encodeURIComponent(v.trim())}&country=${country}`).then(r => setFound(r.results || [])).catch(e => { setFound([]); setNote(e.message || 'The map search did not answer.'); }).finally(() => setBusy(''));
  };
  const choose = (name, p) => { setOpen(false); setTyped(''); setFound([]); setNote(''); if (p) setPin(p); onChange(name); };
  const save = async (name, add) => {
    setBusy(`save:${name}`); setNote('');
    try {
      const current = b.target_areas || [];
      const next = add ? [...new Set([...current, name])].slice(0, 20) : current.filter(x => x.toLowerCase() !== name.toLowerCase());
      await api(`/businesses/${b.id}`, { method: 'PATCH', body: { target_areas: next } });
      await refreshBusinesses();
      onSaved?.();
      setNote(add ? `“${name}” is now a target area of this project.` : `“${name}” is no longer a target area.`);
      if (!add && value === name) onChange('');
    } catch (e) { setNote(e.message || 'It could not be saved.'); } finally { setBusy(''); }
  };
  const fromMap = async (lat, lng) => {
    setNote('Looking up that place…');
    const r = await api(`/businesses/${b.id}/keyword-workspace/area-at?lat=${lat}&lng=${lng}&country=${country}`).catch(() => null);
    if (!r?.place) { setNote('No named area at that point in this country.'); return; }
    choose(r.place.label, { label: r.place.label, lat: r.place.lat, lng: r.place.lng });
  };
  const isSaved = (name) => saved.includes(name.toLowerCase());
  const own = places.map((x, n) => ({ ...x, value: n === 0 ? '' : x.name }));

  return (
    <div className="relative" ref={box}>
      <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(o => !o)} title="Choose the place these figures are for"
        className="h-9 w-[230px] inline-flex items-center gap-2 pl-3 pr-2.5 rounded-lg ring-1 ring-inset ring-slate-300 bg-white text-13 font-medium text-slate-800 hover:bg-slate-50 cursor-pointer text-left">
        <MapPin size={14} className="text-indigo-500 shrink-0" /><span className="truncate flex-1">{active}</span><ChevronDown size={14} className="text-slate-400 shrink-0" />
      </button>
      {open && (
        <div role="dialog" aria-label="Choose a place" className="absolute left-0 top-full mt-2 w-[400px] max-w-[calc(100vw-24px)] rounded-xl bg-white shadow-2xl ring-1 ring-slate-200 p-3 z-40">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input autoFocus value={typed} onChange={e => search(e.target.value)} placeholder="Search any place on Google Maps" aria-label="Search a place" className="h-10 w-full rounded-lg ring-1 ring-inset ring-slate-300 pl-9 pr-8 text-13 focus:ring-2 focus:ring-indigo-500 outline-none" />
            {busy === 'search' ? <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-400" /> : typed && <button type="button" aria-label="Clear" onClick={() => { setTyped(''); setFound([]); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"><X size={13} /></button>}
          </div>

          {typed.trim().length >= 2 && (
            <ul role="listbox" aria-label="Places found" className="mt-2 max-h-48 overflow-y-auto rounded-lg ring-1 ring-slate-200 divide-y divide-slate-100">
              {found.map(x => (
                <li key={x.label} className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-slate-50">
                  <button type="button" role="option" onClick={() => choose(x.label, x.lat != null ? { label: x.label, lat: x.lat, lng: x.lng } : null)} className="flex-1 min-w-0 text-left inline-flex items-center gap-2 cursor-pointer"><MapPin size={13} className="text-slate-400 shrink-0" /><span className="truncate text-13">{x.label}</span></button>
                  <button type="button" disabled={isSaved(x.label) || busy === `save:${x.label}`} onClick={() => save(x.label, true)} className="shrink-0 inline-flex items-center gap-1 h-7 px-2 rounded-md text-12 font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-default cursor-pointer" title="Keep it as a target area of this project">{isSaved(x.label) ? <><Check size={12} />Target</> : <><Plus size={12} />Save as target</>}</button>
                </li>
              ))}
              {!found.length && busy !== 'search' && <li className="px-3 py-3 text-12.5 text-slate-500">No place found for “{typed}”.</li>}
            </ul>
          )}

          <div className="mt-3 text-11.5 font-semibold uppercase tracking-wide text-slate-400">Your places</div>
          <ul className="mt-1 max-h-40 overflow-y-auto">
            {own.map(x => {
              const on = (value || '') === x.value;
              const savedArea = isSaved(x.name);
              return (
                <li key={x.name} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${on ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
                  <button type="button" onClick={() => choose(x.value)} className="flex-1 min-w-0 text-left inline-flex items-center gap-2 cursor-pointer"><MapPin size={13} className={on ? 'text-indigo-600' : 'text-slate-400'} /><span className={`truncate text-13 ${on ? 'font-semibold text-indigo-800' : ''}`}>{x.name}</span><span className="text-11.5 text-slate-400">{x.kind.toLowerCase()}</span>{on && <Check size={13} className="ml-auto text-indigo-600 shrink-0" />}</button>
                  {savedArea && <button type="button" aria-label={`Stop targeting ${x.name}`} title="Remove from the target areas" disabled={busy === `save:${x.name}`} onClick={() => save(x.name, false)} className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"><X size={13} /></button>}
                </li>
              );
            })}
            {value && !own.some(x => x.value === value) && (
              <li className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-indigo-50"><MapPin size={13} className="text-indigo-600" /><span className="flex-1 truncate text-13 font-semibold text-indigo-800">{value}</span>
                <button type="button" disabled={busy === `save:${value}`} onClick={() => save(value, true)} className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-12 font-semibold text-indigo-700 bg-white ring-1 ring-indigo-200 hover:bg-indigo-100 cursor-pointer"><Plus size={12} />Save as target</button></li>
            )}
          </ul>

          <div className="mt-3"><LocationsMap places={pin ? [pin] : []} country={country} onClick={fromMap} height={170} /></div>
          <p className="mt-1 text-11.5 text-slate-500">Click the map to pick a place. The keyword figures below are for the chosen place. Save it as a target to keep it in this list.</p>
          {note && <p role="status" className="mt-1 text-12 text-slate-700 bg-slate-50 rounded px-2 py-1">{note}</p>}
        </div>
      )}
    </div>
  );
}
