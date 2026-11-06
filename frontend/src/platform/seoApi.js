import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Client for the SEO platform backend (FastAPI). The login is a session cookie, so every
 * request sends credentials.
 */
// VITE_API_URL wins. Without it: the local backend in dev, and the same origin in a production build
// (the backend serves the built frontend, so /api/v1 is on the same host).
export const SEO_API = (import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8000/api/v1' : '/api/v1')).replace(/\/$/, '');

export class SeoApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

const messageOf = (body, status) => {
  const d = body?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map(x => `${(x.loc || []).slice(1).join('.')}: ${x.msg}`).join('; ');
  if (d && typeof d === 'object') return (Array.isArray(d.messages) && d.messages.length ? d.messages.join('; ') : d.error || d.message) || `Request failed (${status})`;
  return body?.error || `Request failed (${status})`;
};

// The dev backend restarts when a source file changes and is unreachable for a few seconds. Reads are simply retried; a write is
// never re-sent (it might have arrived), but after a failure it first waits until the backend answers, so it is not lost to a restart.
let lastNetworkFailure = 0;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function waitUntilReachable(tries = 10) {
  for (let i = 0; i < tries; i += 1) {
    try { await fetch(`${SEO_API}/status`, { credentials: 'include', cache: 'no-store' }); return true; } catch (e) { await sleep(700); } // any answer, even 401, means it is up
  }
  return false;
}

// `repeat: true` marks a write that gives the same result when sent twice (a PATCH, an upsert, a match-or-create); it is then retried
// like a read when the backend restarts mid-request.
// Identical GETs that are in flight at the same time share one request (React StrictMode and several components asking for the same data),
// and the last answers are kept for a short while so going back to a page shows its data at once while it refreshes in the background.
const inflight = new Map();
const answers = new Map();
const FRESH_MS = 30000;
/** Forget every cached answer: called on sign-out / account switch so the next user never sees the previous one's projects or data. */
export const clearApiCache = () => { answers.clear(); inflight.clear(); };
export const cached = (path) => { const a = answers.get(path); return a && Date.now() - a.at < FRESH_MS ? a.data : undefined; };

export function api(path, opts = {}) {
  const { method = 'GET', raw = false } = opts;
  if (method !== 'GET' && method !== 'HEAD') answers.clear(); // a change may alter anything that was read before
  if (method !== 'GET' || raw) return request(path, opts);
  if (inflight.has(path)) return inflight.get(path);
  const p = request(path, opts).then(data => { answers.set(path, { data, at: Date.now() }); return data; }).finally(() => inflight.delete(path));
  inflight.set(path, p);
  return p;
}

async function request(path, { method = 'GET', body, raw = false, repeat = false } = {}) {
  const safeToRepeat = repeat || method === 'GET' || method === 'HEAD';
  if (!safeToRepeat && Date.now() - lastNetworkFailure < 30000) await waitUntilReachable();
  let r;
  for (let attempt = 0; ; attempt += 1) {
    try {
      r = await fetch(`${SEO_API}${path}`, {
        method,
        credentials: 'include',
        cache: 'no-store', // never reuse a cached API answer: a copy cached for another origin carries that origin's CORS header and is refused
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
      break;
    } catch (e) {
      lastNetworkFailure = Date.now();
      if (safeToRepeat && attempt < 4) { // a restart takes a few seconds: wait until the backend answers, then send again
        if (!(await waitUntilReachable(12))) await sleep(600 * (attempt + 1));
        continue;
      }
      throw new SeoApiError(`The SEO backend is not reachable at ${SEO_API}. Is it running?`, 0);
    }
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
  const [state, setState] = useState(() => { const hit = path ? cached(path) : undefined; return { data: hit ?? null, error: null, loading: Boolean(path) && hit === undefined }; });
  const seq = useRef(0);
  const load = useCallback(async (quiet = false) => {
    if (!path) return;
    const mine = ++seq.current;
    if (!quiet) setState(s => ({ ...s, loading: true, error: null }));
    try {
      if (quiet) answers.delete(path); // an explicit reload must hit the server
      const data = await api(path);
      if (mine === seq.current) setState({ data, error: null, loading: false });
    } catch (e) {
      if (mine === seq.current) setState(s => ({ ...s, error: e, loading: false }));
    }
  }, [path]);
  useEffect(() => {
    const hit = path ? cached(path) : undefined;
    if (hit !== undefined) { setState(s => (s.data === hit ? s : { data: hit, error: null, loading: false })); load(true); } else load();
  }, [load, path]);
  const setData = useCallback((fn) => setState(s => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })), []);
  return { ...state, reload: load, setData };
}

/**
 * Load a list in slabs. `path` is an endpoint that takes `limit` and `offset` and returns an array. Starts with `size` rows;
 * `loadMore()` appends the next slab. `reload()` refreshes what is already shown (as many rows as are loaded, up to 200), so a list does not collapse.
 * Returns { data, error, loading, reload, setData, loadMore, hasMore, loadingMore }.
 */
export function usePaged(path, size = 25) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path), hasMore: false, loadingMore: false });
  const seq = useRef(0);
  const shown = useRef(0);
  const url = useCallback((limit, offset) => `${path}${path.includes('?') ? '&' : '?'}limit=${limit}&offset=${offset}`, [path]);
  const load = useCallback(async (quiet = false) => {
    if (!path) return;
    const mine = ++seq.current;
    if (!quiet) setState(s => ({ ...s, loading: true, error: null }));
    const want = quiet ? Math.min(200, Math.max(size, shown.current)) : size;
    try {
      const rows = await api(url(want, 0));
      if (mine !== seq.current) return;
      shown.current = rows.length;
      setState(s => ({ ...s, data: rows, error: null, loading: false, hasMore: rows.length >= want }));
    } catch (e) {
      if (mine === seq.current) setState(s => ({ ...s, error: e, loading: false }));
    }
  }, [path, size, url]);
  useEffect(() => { shown.current = 0; load(); }, [load]);
  const loadMore = useCallback(async () => {
    const mine = seq.current;
    setState(s => ({ ...s, loadingMore: true }));
    try {
      const rows = await api(url(size, shown.current));
      if (mine !== seq.current) return;
      shown.current += rows.length;
      setState(s => ({ ...s, data: [...(s.data || []), ...rows], hasMore: rows.length >= size, loadingMore: false }));
    } catch (e) {
      setState(s => ({ ...s, error: e, loadingMore: false }));
    }
  }, [size, url]);
  const setData = useCallback((fn) => setState(s => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })), []);
  return { ...state, reload: load, setData, loadMore };
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
export const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN'));
export const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
