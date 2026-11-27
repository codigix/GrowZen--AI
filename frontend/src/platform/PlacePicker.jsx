import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, MapPin, Plus, Search, X } from 'lucide-react';
import { api, useApi } from './seoApi';
import { refreshBusinesses } from './SeoUi';
import LocationsMap from './LocationsMap';

/**
 * The one place selector of the software, used like a map: search any place Google Maps knows or click the map, use it at once, and save it as a target area of the project.
 * The project's own places (country, city, target areas) are listed first.
 *
 *   single   value is a place name ('' = the country / the project's own place); onChange(name, pin)
 *   multiple value is a list of { label, lat?, lng? } (up to `max`); onChange(list); none chosen = the whole country
 *   inline   show the panel itself instead of a button that opens it (for use inside another panel)
 *   canSave  offer "Save as target" (adds the place to the project's target areas)
 */
export default function PlacePicker({ b, value, places: placesProp, onChange, onSaved, multiple = false, max = 5, inline = false, canSave = true, mapHeight = 170, width = 230, placeholder = 'Choose a place' }) {
  const own = useApi(placesProp ? null : `/businesses/${b.id}/keyword-workspace/places`);
  const places = placesProp || own.data?.places || [];
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [found, setFound] = useState([]);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [pins, setPins] = useState({}); // label -> { lat, lng }
  const box = useRef(null);
  const country = (b.country || 'IN').toUpperCase();
  const saved = (b.target_areas || []).map(x => x.toLowerCase());
  const chosen = useMemo(() => (multiple ? (value || []) : value ? [{ label: value }] : []), [multiple, value]);
  const labels = chosen.map(c => c.label);
  const first = labels[0];
  const trigger = multiple ? (first ? (labels.length > 1 ? `${first.split(',')[0]} +${labels.length - 1}` : first) : (places[0]?.name || 'Whole country')) : (value || places[0]?.name || placeholder);
  const shown = open || inline;

  useEffect(() => {
    if (!open || inline) return undefined;
    const on = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', on); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', on); document.removeEventListener('keydown', esc); };
  }, [open, inline]);

  // every chosen place gets its pin on the map: the ones already carrying a point use it, the others are looked up
  const known = (c) => (c.lat != null ? { lat: c.lat, lng: c.lng } : pins[c.label]);
  useEffect(() => {
    if (!shown) return;
    chosen.filter(c => !known(c)).forEach(c => {
      api(`/businesses/${b.id}/keyword-workspace/area-pin?label=${encodeURIComponent(c.label)}&country=${country}`).then(r => { if (r.pin) setPins(p => ({ ...p, [c.label]: { lat: r.pin.lat, lng: r.pin.lng } })); }).catch(() => {});
    });
  }, [shown, labels.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const mapPlaces = chosen.map(c => ({ label: c.label, ...(known(c) || {}) })).filter(p => p.lat != null);

  const search = (v) => {
    setTyped(v); setNote('');
    if (v.trim().length < 2) { setFound([]); return; }
    setBusy('search');
    api(`/businesses/${b.id}/keyword-workspace/area-search?q=${encodeURIComponent(v.trim())}&country=${country}`).then(r => setFound(r.results || [])).catch(e => { setFound([]); setNote(e.message || 'The map search did not answer.'); }).finally(() => setBusy(''));
  };

  // choose a place: single closes and uses it; multiple adds it (or removes it when it is already chosen)
  const pick = (name, pin) => {
    setTyped(''); setFound([]); setNote('');
    if (!multiple) { if (!inline) setOpen(false); onChange(name, pin || null); return; }
    if (!name) { onChange([]); return; }
    if (labels.includes(name)) { onChange(chosen.filter(c => c.label !== name)); return; }
    if (chosen.length >= max) { setNote(`At most ${max} places: remove one first.`); return; }
    onChange([...chosen, { label: name, lat: pin?.lat ?? null, lng: pin?.lng ?? null }]);
  };
  const save = async (name, add) => {
    setBusy(`save:${name}`); setNote('');
    try {
      const current = b.target_areas || [];
      const next = add ? [...new Set([...current, name])].slice(0, 20) : current.filter(x => x.toLowerCase() !== name.toLowerCase());
      await api(`/businesses/${b.id}`, { method: 'PATCH', body: { target_areas: next } });
      await refreshBusinesses();
      own.reload?.(true); onSaved?.();
      setNote(add ? `“${name}” is now a target area of this project.` : `“${name}” is no longer a target area.`);
      if (!add) { if (multiple) onChange(chosen.filter(c => c.label !== name)); else if (value === name) onChange('', null); }
    } catch (e) { setNote(e.message || 'It could not be saved.'); } finally { setBusy(''); }
  };
  const fromMap = async (lat, lng) => {
    setNote('Looking up that place…');
    const r = await api(`/businesses/${b.id}/keyword-workspace/area-at?lat=${lat}&lng=${lng}&country=${country}`).catch(() => null);
    if (!r?.place) { setNote('No named area at that point in this country.'); return; }
    setNote('');
    pick(r.place.label, { lat: r.place.lat, lng: r.place.lng });
  };
  const isSaved = (name) => saved.includes(name.toLowerCase());
  const rows = places.map((x, n) => ({ ...x, value: n === 0 ? '' : x.name }));
  const onRow = (v) => (multiple ? (v === '' ? chosen.length === 0 : labels.includes(v)) : (value || '') === v);

  const panel = (
    <div role={inline ? undefined : 'dialog'} aria-label="Choose a place" className={inline ? '' : 'absolute left-0 top-full mt-2 w-[400px] max-w-[calc(100vw-24px)] rounded-xl bg-white shadow-2xl ring-1 ring-slate-200 p-3 z-40'}>
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input autoFocus={!inline} value={typed} onChange={e => search(e.target.value)} placeholder={multiple && chosen.length ? 'Add another place on Google Maps' : 'Search any place on Google Maps'} aria-label="Search a place" className="h-10 w-full rounded-lg ring-1 ring-inset ring-slate-300 pl-9 pr-8 text-13 focus:ring-2 focus:ring-indigo-500 outline-none bg-white" />
        {busy === 'search' ? <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-400" /> : typed && <button type="button" aria-label="Clear" onClick={() => { setTyped(''); setFound([]); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"><X size={13} /></button>}
      </div>

      {multiple && chosen.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Chosen places">
          {chosen.map((c, i) => (
            <li key={c.label} className={`inline-flex items-center gap-1.5 h-7 pl-1.5 pr-1 rounded-full text-12 ring-1 ring-inset ${i === 0 ? 'bg-indigo-50 ring-indigo-200 text-indigo-800' : 'bg-sky-50 ring-sky-200 text-sky-800'}`}>
              <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-10 font-bold text-white ${i === 0 ? 'bg-indigo-600' : 'bg-sky-500'}`}>{i + 1}</span>
              <span className="max-w-[210px] truncate" title={c.label}>{c.label}</span>
              <button type="button" aria-label={`Remove ${c.label}`} onClick={() => pick(c.label)} className="p-0.5 rounded-full hover:bg-black/10 cursor-pointer"><X size={11} /></button>
            </li>
          ))}
        </ul>
      )}

      {typed.trim().length >= 2 && (
        <ul role="listbox" aria-label="Places found" className="mt-2 max-h-48 overflow-y-auto rounded-lg ring-1 ring-slate-200 divide-y divide-slate-100 bg-white">
          {found.map(x => {
            const on = labels.includes(x.label);
            return (
              <li key={x.label} className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-slate-50">
                <button type="button" role="option" aria-selected={on} onClick={() => pick(x.label, x.lat != null ? { lat: x.lat, lng: x.lng } : null)} className="flex-1 min-w-0 text-left inline-flex items-center gap-2 cursor-pointer"><MapPin size={13} className={on ? 'text-indigo-600' : 'text-slate-400'} /><span className="truncate text-13">{x.label}</span>{on && <Check size={13} className="text-indigo-600 shrink-0" />}</button>
                {canSave && <button type="button" disabled={isSaved(x.label) || busy === `save:${x.label}`} onClick={() => save(x.label, true)} className="shrink-0 inline-flex items-center gap-1 h-7 px-2 rounded-md text-12 font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-default cursor-pointer" title="Keep it as a target area of this project">{isSaved(x.label) ? <><Check size={12} />Target</> : <><Plus size={12} />Save as target</>}</button>}
              </li>
            );
          })}
          {!found.length && busy !== 'search' && <li className="px-3 py-3 text-12.5 text-slate-500">No place found for “{typed}”.</li>}
        </ul>
      )}

      {rows.length > 0 && <div className="mt-3 text-11.5 font-semibold uppercase tracking-wide text-slate-400">Your places</div>}
      <ul className="mt-1 max-h-40 overflow-y-auto">
        {rows.map(x => {
          const on = onRow(x.value);
          const savedArea = isSaved(x.name);
          return (
            <li key={x.name} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${on ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
              <button type="button" onClick={() => pick(x.value)} className="flex-1 min-w-0 text-left inline-flex items-center gap-2 cursor-pointer"><MapPin size={13} className={on ? 'text-indigo-600' : 'text-slate-400'} /><span className={`truncate text-13 ${on ? 'font-semibold text-indigo-800' : ''}`}>{x.name}</span><span className="text-11.5 text-slate-400">{String(x.kind || '').toLowerCase()}</span>{on && <Check size={13} className="ml-auto text-indigo-600 shrink-0" />}</button>
              {canSave && savedArea && <button type="button" aria-label={`Stop targeting ${x.name}`} title="Remove from the target areas" disabled={busy === `save:${x.name}`} onClick={() => save(x.name, false)} className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"><X size={13} /></button>}
            </li>
          );
        })}
        {!multiple && value && !rows.some(x => x.value === value) && (
          <li className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-indigo-50"><MapPin size={13} className="text-indigo-600" /><span className="flex-1 truncate text-13 font-semibold text-indigo-800">{value}</span>
            {canSave && <button type="button" disabled={busy === `save:${value}`} onClick={() => save(value, true)} className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-12 font-semibold text-indigo-700 bg-white ring-1 ring-indigo-200 hover:bg-indigo-100 cursor-pointer"><Plus size={12} />Save as target</button>}</li>
        )}
      </ul>

      <div className="mt-3"><LocationsMap places={mapPlaces} country={country} onClick={fromMap} height={mapHeight} /></div>
      <p className="mt-1 text-11.5 text-slate-500">{multiple ? `Click the map or search to add places (up to ${max}). Pin 1 is the primary place. None chosen means the whole country.` : 'Click the map to pick a place.'}{canSave ? ' Save a place as a target to keep it in this list.' : ''}</p>
      {note && <p role="status" className="mt-1 text-12 text-slate-700 bg-slate-50 rounded px-2 py-1">{note}</p>}
    </div>
  );

  if (inline) return panel;
  return (
    <div className="relative" ref={box}>
      <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(o => !o)} title="Choose the place these figures are for" style={{ width }}
        className="h-9 max-w-full inline-flex items-center gap-2 pl-3 pr-2.5 rounded-lg ring-1 ring-inset ring-slate-300 bg-white text-13 font-medium text-slate-800 hover:bg-slate-50 cursor-pointer text-left">
        <MapPin size={14} className="text-indigo-500 shrink-0" /><span className="truncate flex-1">{trigger}</span><ChevronDown size={14} className="text-slate-400 shrink-0" />
      </button>
      {open && panel}
    </div>
  );
}
