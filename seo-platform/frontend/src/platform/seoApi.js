import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Client for the SEO platform backend (FastAPI). The login is a session cookie, so every
 * request sends credentials.
 */
export const SEO_API = (import.meta.env.VITE_API_URL || 'http://localhost:8100/api/v1').replace(/\/$/, '');

export class SeoApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

const messageOf = (body, status) => {
  const d = body?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map(x => `${(x.loc || []).slice(1).join('.')}: ${x.msg}`).join('; ');
  return body?.error || `Request failed (${status})`;
};

export async function api(path, { method = 'GET', body, raw = false } = {}) {
  let r;
  try {
    r = await fetch(`${SEO_API}${path}`, {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (e) {
    throw new SeoApiError(`The SEO backend is not reachable at ${SEO_API}. Is it running?`, 0);
  }
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    // Session ended: the app shell listens for this and shows the login page.
    if (r.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('seo:unauthorized'));
    throw new SeoApiError(messageOf(b, r.status), r.status);
  }
  if (raw) return r;
  if (r.status === 204) return null;
  return r.json();
}

/** Load `path` (null = don't load). Returns { data, error, loading, reload, setData }. */
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path) });
  const seq = useRef(0);
  const load = useCallback(async (quiet = false) => {
    if (!path) return;
    const mine = ++seq.current;
    if (!quiet) setState(s => ({ ...s, loading: true, error: null }));
    try {
      const data = await api(path);
      if (mine === seq.current) setState({ data, error: null, loading: false });
    } catch (e) {
      if (mine === seq.current) setState(s => ({ ...s, error: e, loading: false }));
    }
  }, [path]);
  useEffect(() => { load(); }, [load]);
  const setData = useCallback((fn) => setState(s => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })), []);
  return { ...state, reload: load, setData };
}

/** Re-run `fn` every `ms` while `active`; stops on unmount. */
export function usePoll(fn, active, ms = 2500) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => saved.current(), ms);
    return () => clearInterval(t);
  }, [active, ms]);
}

/** Backend business (snake_case) -> the shape the screens use. */
export const toUi = (b) => (b ? {
  ...b,
  primaryCategory: b.primary_category || '',
  secondaryCategories: b.secondary_categories || [],
  services: b.services || [],
  attributes: b.attributes || [],
  area: b.area || b.city || '',
  city: b.city || '',
  address: b.address || '',
  phone: b.phone || '',
  website: b.website || '',
  description: b.description || '',
  rating: b.rating ?? null,
  reviewCount: b.review_count ?? 0,
  duplicate: Boolean(b.duplicate_listing),
  seeds: [b.primary_category, ...(b.services || []).map(s => s.name)].filter(Boolean).map(s => s.toLowerCase()).slice(0, 4)
} : null);

export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
