import { useEffect, useSyncExternalStore } from 'react';

// The last breadcrumb a page can add for what it is showing inside itself (a tab, a step, a sub-view).
let label = '';
const listeners = new Set();
const set = (v) => { label = v || ''; listeners.forEach(l => l()); };

/** Add a last breadcrumb for the current tab or view of a page; it is removed when the page closes or the label changes. */
export function useCrumb(text) {
  useEffect(() => { set(text); return () => set(''); }, [text]);
}

export const useCrumbLabel = () => useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => label);
