/** Helpers shared by the website audit and keyword screens: page URLs and issue severity. */

/** A page URL's path with its query string ("/services?x=1"). */
export const pathOf = (u) => { try { const p = new URL(u); return (p.pathname || '/') + p.search; } catch (e) { return u; } };

/** A page URL's path only ("/services"). */
export const pathOnly = (u) => { try { return new URL(u).pathname || '/'; } catch (e) { return u; } };

/** A URL's host without "www.". */
export const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } };

export const LEVEL_ORDER = { critical: 0, serious: 1, warning: 2, info: 3 };

export const SEVERITY_TONE = { critical: 'text-red-700 bg-red-50 ring-red-200', serious: 'text-orange-700 bg-orange-50 ring-orange-200', warning: 'text-amber-700 bg-amber-50 ring-amber-200', info: 'text-slate-600 bg-slate-50 ring-slate-200' };
