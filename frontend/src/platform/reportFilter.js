import { useEffect, useState } from 'react';

/**
 * The report filter every SEO, GEO, AEO and GMB page shares: a period (a preset, a month, a year or a custom range), a country and a location.
 * It lives in the browser (one choice for all pages), is sent to the backend on every project request as rf_from, rf_to, rf_country and rf_location,
 * and the backend applies it wherever the figures can be cut that way (see backend/app/services/report_filter.py).
 */
const KEY = 'bevisibe.report-filter';
const EVENT = 'report-filter';
export const DEFAULT_FILTER = { preset: 'default', from: '', to: '', country: '', locations: [] }; // locations: [{ label, lat, lng }], the first is the primary place
export const MAX_LOCATIONS = 5;
export const PRESETS = [
  ['default', 'Default period'], ['7d', 'Last 7 days'], ['28d', 'Last 28 days'], ['90d', 'Last 3 months'], ['180d', 'Last 6 months'], ['365d', 'Last 12 months'],
  ['this_month', 'This month'], ['last_month', 'Last month'], ['this_year', 'This year'], ['last_year', 'Last year'],
];

let state = (() => {
  try {
    const s = { ...DEFAULT_FILTER, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    if (s.location && !(s.locations || []).length) s.locations = [{ label: s.location }]; // a single place saved by an earlier version
    delete s.location;
    return s;
  } catch { return { ...DEFAULT_FILTER }; }
})();
let version = 0;

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };

/** {from, to} as ISO dates for the filter, or null for the default period (each page keeps its own). */
export function resolveRange(f = state) {
  const today = new Date();
  switch (f.preset) {
    case '7d': return { from: iso(daysAgo(6)), to: iso(today) };
    case '28d': return { from: iso(daysAgo(27)), to: iso(today) };
    case '90d': return { from: iso(daysAgo(89)), to: iso(today) };
    case '180d': return { from: iso(daysAgo(179)), to: iso(today) };
    case '365d': return { from: iso(daysAgo(364)), to: iso(today) };
    case 'this_month': return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today) };
    case 'last_month': return { from: iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: iso(new Date(today.getFullYear(), today.getMonth(), 0)) };
    case 'this_year': return { from: iso(new Date(today.getFullYear(), 0, 1)), to: iso(today) };
    case 'last_year': return { from: iso(new Date(today.getFullYear() - 1, 0, 1)), to: iso(new Date(today.getFullYear() - 1, 11, 31)) };
    case 'month': { // f.from is "YYYY-MM"
      const [y, m] = (f.from || '').split('-').map(Number);
      if (!y || !m) return null;
      const end = new Date(y, m, 0);
      return { from: iso(new Date(y, m - 1, 1)), to: iso(end > today ? today : end) };
    }
    case 'year': { // f.from is "YYYY"
      const y = Number(f.from);
      if (!y) return null;
      return { from: `${y}-01-01`, to: y === today.getFullYear() ? iso(today) : `${y}-12-31` };
    }
    case 'custom': return f.from && f.to ? (f.from <= f.to ? { from: f.from, to: f.to } : { from: f.to, to: f.from }) : null;
    default: return null;
  }
}

export const getFilter = () => state;
export const isDefault = (f = state) => !resolveRange(f) && !f.country && !(f.locations || []).length;

export function setFilter(patch) {
  state = { ...state, ...patch };
  version += 1;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* the choice is simply not remembered */ }
  window.dispatchEvent(new Event(EVENT));
}
export const resetFilter = () => setFilter({ ...DEFAULT_FILTER });

/** The query string the backend reads: rf_from, rf_to, rf_country, rf_location (only what was chosen). */
export function filterQuery() {
  const r = resolveRange();
  const p = new URLSearchParams();
  if (r) { p.set('rf_from', r.from); p.set('rf_to', r.to); }
  if (state.country) p.set('rf_country', state.country);
  if ((state.locations || []).length) p.set('rf_location', state.locations.map(l => l.label).join('|'));
  return p.toString();
}

/** A project path with the filter added (other paths are left alone). */
export function withFilter(path) {
  if (!/^\/businesses\/\d+/.test(path)) return path;
  const q = filterQuery();
  if (!q) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${q}`;
}

/** Re-render when the filter changes. */
export function useReportFilter() {
  const [, set] = useState(version);
  useEffect(() => {
    const on = () => set(version);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return state;
}

/** A number that changes with every filter change: put it in a data hook's dependencies to read again. */
export function useFilterVersion() { useReportFilter(); return version; }

const fmt = (s) => new Date(`${s}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
export function describePeriod(f = state) {
  if (f.preset === 'default') return 'Default period';
  if (f.preset === 'month') { const [y, m] = (f.from || '').split('-').map(Number); return y && m ? new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'Choose a month'; }
  if (f.preset === 'year') return f.from || 'Choose a year';
  if (f.preset === 'custom') { const r = resolveRange(f); return r ? `${fmt(r.from)} to ${fmt(r.to)}` : 'Custom range'; }
  return (PRESETS.find(p => p[0] === f.preset) || PRESETS[0])[1];
}
