import React, { Suspense, lazy, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { Button } from './SeoUi';
import DataTable from './DataTable';

// The rank tracker is a large page: it is only loaded when this section is opened.
const MapsRanking = lazy(() => import('./LocalRankTrackerPage').then(m => ({ default: m.MapsRanking })));

const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const km = (m) => (m == null ? null : m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);
const NA = <span className="text-slate-300">Not available</span>;
const SOURCE = { google_places: 'Google Maps', organic_serp: 'Organic search', manual: 'Added by hand' };

/** Everything the Google Maps tab says about local competitors, in two parts that are never mixed up:
 *  1. Found on Google Maps: who Google Maps returned for the search (discovery). It says nothing about who ranks higher for which keyword.
 *  2. Local rank tracking: real Maps positions from scans of a keyword around a point (the street grid, by area, and the competitors seen in it). */
export default function CompetitorMaps({ b, rows, legacy = null }) {
  const [part, setPart] = useState('found');
  const list = rows.filter(c => c.maps || c.reg).map(c => {
    const reg = c.reg || {};
    const m = c.maps || {};
    const mapsUrl = m.maps_link || reg.maps_link || ((m.address || reg.address) ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${c.name} ${m.address || reg.address}`)}` : null);
    const services = (reg.listing?.services || m.services || []).filter(Boolean);
    return {
      id: c.key, name: c.name, category: m.category || reg.listing?.kind || '', address: m.address || reg.address || '', distance: m.distance_m ?? null, rating: m.rating ?? reg.rating ?? null,
      reviews: m.reviews ?? m.ratingCount ?? reg.reviews ?? null, website: c.host ? `https://${c.host}` : (c.website || ''), host: c.host, mapsUrl, services,
      found: (reg.discovery?.length ? reg.discovery : [reg.source || 'google_places']).map(x => SOURCE[x] || x).join(', '), chosen: Boolean(reg.id) && reg.selected !== false,
    };
  });
  const cols = [
    { id: 'name', header: 'Business', first: 'asc', value: r => r.name, className: 'px-3 py-2.5 min-w-[200px]', cell: r => <span className="font-semibold text-slate-900">{r.name}{r.chosen && <span className="ml-2 text-11 font-semibold text-emerald-700">Selected</span>}</span> },
    { id: 'category', header: 'Primary category', value: r => r.category, cell: r => r.category || NA, tip: { what: 'The category Google Maps shows for the business.', from: 'Google Places' } },
    { id: 'address', header: 'Address', value: r => r.address, className: 'px-3 py-2.5 max-w-[260px]', cell: r => (r.address ? <span className="block truncate" title={r.address}>{r.address}</span> : NA) },
    { id: 'distance', header: 'Distance', right: true, first: 'asc', value: r => r.distance, cell: r => km(r.distance) || NA, tip: { what: 'Straight-line distance from the place you search.', from: 'Google Places' } },
    { id: 'rating', header: 'Rating', right: true, first: 'desc', value: r => r.rating, cell: r => (r.rating == null || r.rating === '' ? NA : <b>{Number(r.rating).toFixed(1)}</b>) },
    { id: 'reviews', header: 'Reviews', right: true, first: 'desc', value: r => r.reviews, cell: r => (r.reviews == null ? NA : num(r.reviews)) },
    { id: 'website', header: 'Website', value: r => r.host || '', cell: r => (r.host ? <a href={r.website} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline inline-flex items-center gap-1"><span className="truncate max-w-[160px]">{r.host}</span><ExternalLink size={10} /></a> : <span className="text-slate-400">no website</span>) },
    { id: 'maps', header: 'Google Maps', csv: false, value: r => r.mapsUrl || '', cell: r => (r.mapsUrl ? <a href={r.mapsUrl} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline inline-flex items-center gap-1">Open<ExternalLink size={10} /></a> : NA) },
    { id: 'services', header: 'Services on its listing', value: r => r.services.join(', '), className: 'px-3 py-2.5 max-w-[240px]', cell: r => (r.services.length ? <span className="block truncate" title={r.services.join(', ')}>{r.services.slice(0, 3).join(', ')}{r.services.length > 3 ? ` +${r.services.length - 3}` : ''}</span> : NA), tip: { what: 'Services read from its Google listing. Shown only after its listing was read; otherwise Not available.' } },
    { id: 'found', header: 'Found by', value: r => r.found, hide: true },
  ];
  const filters = [
    { id: 'rating', label: 'Rating', options: [['4', '4.0 and above'], ['4.5', '4.5 and above']], test: (r, v) => Number(r.rating) >= Number(v) },
    { id: 'reviews', label: 'Reviews', options: [['50', '50+'], ['100', '100+'], ['500', '500+']], test: (r, v) => (r.reviews || 0) >= Number(v) },
    { id: 'dist', label: 'Distance', options: [['2000', 'Within 2 km'], ['5000', 'Within 5 km'], ['10000', 'Within 10 km']], test: (r, v) => r.distance != null && r.distance <= Number(v) },
    { id: 'site', label: 'Website', options: [['yes', 'Has a website'], ['no', 'No website']], test: (r, v) => (v === 'yes' ? !!r.host : !r.host) },
    { id: 'sel', label: 'Selection', options: [['yes', 'Selected'], ['no', 'Not selected']], test: (r, v) => (v === 'yes' ? r.chosen : !r.chosen) },
  ];
  return (
    <div className="space-y-3">
      {part === 'found'
        ? <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setPart('rank')}>See local rank tracking</Button>
            {legacy && <Button onClick={() => setPart('searches')}>Maps results from your research run</Button>}
          </div>
        : <div><Button onClick={() => setPart('found')}>← Back to the list of businesses</Button></div>}
      {part === 'found' && <>
        <div className="rounded-lg bg-sky-50 ring-1 ring-sky-200 px-3 py-2 text-12.5 text-sky-900">This is <b>discovery</b>: the businesses Google Maps returned around your place. Being on this list does not mean a business ranks above or below you for any keyword, and it is not automatically a competitor for organic search. Real Maps positions are in <button type="button" onClick={() => setPart('rank')} className="font-semibold underline cursor-pointer">Local rank tracking</button>.</div>
        <DataTable columns={cols} rows={list} rowKey={r => r.id} filters={[]} initialSort={{ key: 'distance', dir: 'asc' }} exportName="google-maps-competitors" searchPlaceholder="Search businesses, categories or addresses" label="businesses" minWidth={1300}
          empty="No business found on Google Maps yet. Press Find or refresh on Google Maps on the Competitors tab." />
      </>}
      {part === 'rank' && <>
        <div className="rounded-lg bg-slate-50 ring-1 ring-slate-200 px-3 py-2 text-12.5 text-slate-700">This is <b>rank tracking</b>: each scan asks Google Maps for one keyword from points around your pin and records where each business appears, so you see local positions, the street grid and how competitors compare. Scans use the Google Places API, one request per grid point. Without a scan there are no positions, and none are shown.</div>
        <Suspense fallback={<div className="flex items-center justify-center gap-2 py-10 text-13 text-slate-500"><Loader2 size={16} className="animate-spin" />Loading…</div>}><MapsRanking b={b} /></Suspense>
      </>}
      {part === 'searches' && legacy}
    </div>
  );
}
