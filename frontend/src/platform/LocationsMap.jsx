import React, { useEffect, useRef } from 'react';
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

export default function LocationsMap({ places, country = 'IN', onClick, height = 190 }) {
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
