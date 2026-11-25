import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * OpenStreetMap map with one numbered pin per chosen place (1 is the primary place). Clicking the map reports the point so a place can be added from it.
 * The map fits all pins; with none it shows the country.
 */
const pin = (n, primary) => L.divIcon({
  className: '',
  html: `<div style="width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${primary ? '#4f46e5' : '#0ea5e9'};border:2px solid #fff;box-shadow:0 3px 8px rgba(15,23,42,.35);display:flex;align-items:center;justify-content:center"><span style="transform:rotate(45deg);color:#fff;font:700 11px/1 system-ui">${n}</span></div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 28],
});
const CENTER = { IN: [22.5, 79, 4], US: [39.5, -98.5, 4], GB: [54, -2.5, 5], AE: [24.3, 54.3, 6], CA: [56, -96, 3], AU: [-25.5, 134, 4] };

function LeafletMap({ places, country = 'IN', onClick, height = 190 }) {
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    const c = CENTER[country] || CENTER.IN;
    const m = L.map(el.current, { scrollWheelZoom: false, zoomControl: true, attributionControl: true }).setView([c[0], c[1]], c[2]);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>' }).addTo(m);
    m.on('click', (e) => clickRef.current?.(e.latlng.lat, e.latlng.lng));
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const resize = new ResizeObserver(() => m.invalidateSize());
    resize.observe(el.current);
    return () => { resize.disconnect(); m.remove(); map.current = null; layer.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const g = layer.current, m = map.current;
    if (!g || !m) return;
    g.clearLayers();
    const pts = (places || []).filter(p => p.lat != null && p.lng != null);
    pts.forEach((p, i) => L.marker([p.lat, p.lng], { icon: pin(i + 1, i === 0), title: p.label }).addTo(g));
    if (pts.length === 1) m.setView([pts[0].lat, pts[0].lng], 10);
    else if (pts.length > 1) m.fitBounds(L.latLngBounds(pts.map(p => [p.lat, p.lng])), { padding: [26, 26], maxZoom: 11 });
    else { const c = CENTER[country] || CENTER.IN; m.setView([c[0], c[1]], c[2]); }
  }, [places, country]);

  return <div ref={el} role="application" aria-label="Map of the chosen locations. Click it to add a place." style={{ height }} className="w-full rounded-lg ring-1 ring-slate-200 overflow-hidden z-0" />;
}

// ---------------------------------------------------------------------------------------------------- Google Maps
// A browser key (VITE_GOOGLE_MAPS_API_KEY, Maps JavaScript API enabled, restricted to this site's address) shows the real Google map. Without it, or if Google refuses it, the OpenStreetMap map above is used.
const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
let googleLoading = null;
function loadGoogle() {
  if (window.google?.maps?.Map) return Promise.resolve(window.google.maps);
  if (googleLoading) return googleLoading;
  googleLoading = new Promise((resolve, reject) => {
    window.__googleMapsReady = () => resolve(window.google.maps);
    window.gm_authFailure = () => reject(new Error('Google refused the Maps key'));
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_KEY)}&callback=__googleMapsReady&v=weekly`;
    s.async = true;
    s.onerror = () => reject(new Error('Google Maps could not be loaded'));
    document.head.appendChild(s);
  }).catch((e) => { googleLoading = null; throw e; });
  return googleLoading;
}

function GoogleMap({ places, country = 'IN', onClick, height = 190, onFail }) {
  const el = useRef(null);
  const state = useRef({ map: null, markers: [] });
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    let dead = false;
    loadGoogle().then((maps) => {
      if (dead || !el.current) return;
      const c = CENTER[country] || CENTER.IN;
      const map = new maps.Map(el.current, { center: { lat: c[0], lng: c[1] }, zoom: c[2], mapTypeControl: false, streetViewControl: false, fullscreenControl: false, gestureHandling: 'cooperative', clickableIcons: false });
      map.addListener('click', (e) => clickRef.current?.(e.latLng.lat(), e.latLng.lng()));
      state.current.map = map;
      state.current.ready?.();
    }).catch(() => onFail?.());
    return () => { dead = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const draw = () => {
      const { map } = state.current;
      const maps = window.google?.maps;
      if (!map || !maps) return;
      state.current.markers.forEach(m => m.setMap(null));
      state.current.markers = [];
      const pts = (places || []).filter(p => p.lat != null && p.lng != null);
      pts.forEach((p, i) => state.current.markers.push(new maps.Marker({
        map, position: { lat: p.lat, lng: p.lng }, title: p.label,
        label: { text: String(i + 1), color: '#fff', fontWeight: '700', fontSize: '12px' },
        icon: { path: maps.SymbolPath.CIRCLE, scale: 13, fillColor: i === 0 ? '#4f46e5' : '#0ea5e9', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
      })));
      if (pts.length === 1) { map.setCenter({ lat: pts[0].lat, lng: pts[0].lng }); map.setZoom(10); }
      else if (pts.length > 1) { const b = new maps.LatLngBounds(); pts.forEach(p => b.extend({ lat: p.lat, lng: p.lng })); map.fitBounds(b, 28); }
      else { const c = CENTER[country] || CENTER.IN; map.setCenter({ lat: c[0], lng: c[1] }); map.setZoom(c[2]); }
    };
    state.current.ready = draw;
    draw();
  }, [places, country]);

  return <div ref={el} role="application" aria-label="Google map of the chosen locations. Click it to add a place." style={{ height }} className="w-full rounded-lg ring-1 ring-slate-200 overflow-hidden z-0 bg-slate-100" />;
}

/** The map of the chosen places: Google Maps when a browser key is set, else OpenStreetMap. */
export default function LocationsMap(props) {
  const [failed, setFailed] = useState(false);
  const google = Boolean(GOOGLE_KEY) && !failed;
  return (
    <div>
      {google ? <GoogleMap {...props} onFail={() => setFailed(true)} /> : <LeafletMap {...props} />}
      <div className="mt-1 text-11 text-slate-400">{google ? 'Google Maps' : GOOGLE_KEY ? 'Google Maps could not load: showing OpenStreetMap' : 'OpenStreetMap. Set VITE_GOOGLE_MAPS_API_KEY in frontend/.env to show Google Maps.'}</div>
    </div>
  );
}
