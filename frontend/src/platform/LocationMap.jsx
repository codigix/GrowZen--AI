import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * OpenStreetMap map with one draggable pin. Click the map or drag the pin to move it; onMove(lat, lng)
 * reports the new position. Without a position it shows India, ready for the first click.
 * Tiles: tile.openstreetmap.org (attribution required by the OSM tile usage policy).
 */

// A drawn pin: Leaflet's default marker images don't survive bundling.
const PIN = L.divIcon({
  className: '',
  html: '<div style="width:28px;height:28px;border-radius:50% 50% 50% 0;background:linear-gradient(135deg,#6366f1,#8b5cf6);transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 4px 10px rgba(79,70,229,.45)"></div>',
  iconSize: [28, 28],
  iconAnchor: [14, 30]
});
const INDIA = [22.5, 79];

export default function LocationMap({ lat, lng, onMove, height = 280 }) {
  const el = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const moveRef = useRef(onMove);
  moveRef.current = onMove;

  useEffect(() => {
    const m = L.map(el.current, { scrollWheelZoom: false }).setView(lat != null ? [lat, lng] : INDIA, lat != null ? 16 : 4);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'
    }).addTo(m);
    m.on('click', (e) => moveRef.current?.(e.latlng.lat, e.latlng.lng));
    map.current = m;
    // Leaflet sizes its tile grid once; re-measure whenever the box changes (layout settling, window resize),
    // otherwise only the first tiles draw and the rest of the map stays grey.
    const resize = new ResizeObserver(() => m.invalidateSize());
    resize.observe(el.current);
    return () => { resize.disconnect(); m.remove(); map.current = null; marker.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (lat == null || lng == null) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (!marker.current) {
      marker.current = L.marker([lat, lng], { icon: PIN, draggable: true, keyboard: true, title: 'Drag to the exact entrance' }).addTo(m);
      marker.current.on('dragend', () => { const p = marker.current.getLatLng(); moveRef.current?.(p.lat, p.lng); });
    } else {
      marker.current.setLatLng([lat, lng]);
    }
    m.setView([lat, lng], Math.max(m.getZoom(), 16));
  }, [lat, lng]);

  return <div ref={el} style={{ height }} className="relative isolate z-0 w-full rounded overflow-hidden ring-1 ring-slate-200 bg-slate-100" aria-label="Map of the business location" />;
}
