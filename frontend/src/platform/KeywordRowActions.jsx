import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { MoreHorizontal, Search, PenLine, Trash2, ExternalLink, MapPin, Sparkles, Eye, Pencil, Loader2, Star } from 'lucide-react';

const BTN = 'h-8 px-3 rounded-md text-12.5 font-semibold whitespace-nowrap inline-flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const TONES = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700',
  fix: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200 hover:bg-amber-100',
  soft: 'bg-slate-50 text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-100',
  good: 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100',
};

/**
 * Whether the page's index status is a problem. Google's own answer wins: a page Google reports as indexed is not a problem, whatever our own page check predicts.
 * Our check ("risky" or "blocked") only counts while Google has not been asked about the page.
 */
export function indexProblem(idx) {
  if (!idx) return null;
  if (idx.state === 'indexed') return null;
  if (idx.state === 'blocked') return { level: 'blocked', text: 'Google is blocked from this page' };
  if (idx.state === 'not_indexed') return { level: 'warn', text: 'Google has not indexed this page' };
  if (idx.tech === 'blocked') return { level: 'blocked', text: 'This page blocks Google (our page check)' };
  if (idx.tech === 'risky') return { level: 'warn', text: 'This page may not be indexed (our page check: Google has not been asked yet)' };
  return null;
}

/** The one thing this keyword needs next, from what is known about it. The rest is in the menu. */
export function nextAction(b, k, t, usedOn) {
  const base = (b.website || '').replace(/\/$/, '');
  const pageUrl = k.target_url ? (k.target_url.startsWith('http') ? k.target_url : `${base}${k.target_url}`) : '';
  const where = `/keyword-management/mapping?keyword=${encodeURIComponent(k.keyword)}${pageUrl ? `&page=${encodeURIComponent(pageUrl)}` : ''}`;
  if (!t && k.target_url) return { label: 'Check', tone: 'soft', to: `/keyword-overview?q=${encodeURIComponent(k.keyword)}`, tip: 'Open its searches per month, cost and related ideas.' };
  const same = (a, c) => { const p = (u) => ((u || '').replace(/^https?:\/\/[^/]+/, '').replace(/\/+$/, '')) || '/'; return p(a) === p(c); };
  if (!k.target_url) {
    if (usedOn && usedOn[0]) return { label: `Map to ${usedOn[0].path}`, tone: 'primary', map: usedOn[0].url, tip: `Your website already uses this keyword on ${usedOn[0].path}: save it as this keyword's page.` };
    return t?.suggested
      ? { label: `Map to ${t.suggested.path}`, tone: 'primary', map: t.suggested.url, tip: `Save ${t.suggested.path} as this keyword's page (the page the site scan found for it).` }
      : { label: 'Map to a page', tone: 'primary', choose: true, tip: 'Choose the page this keyword should rank on.' };
  }
  const idx = t.index;
  const problem = indexProblem(idx);
  if (problem) {
    return { label: 'Fix indexing', tone: 'fix', to: '/page-indexing', tip: `${idx.page}: ${problem.text}${idx.reason ? ` (${idx.reason})` : ''}` };
  }
  if (usedOn ? !usedOn.some(u => same(u.path, k.target_url)) : !(t.used_in || []).some(u => u === 'website' || u === 'meta')) {
    return { label: 'Add to page', tone: 'fix', to: where, tip: 'The mapped page does not say this keyword yet: see exactly where to add it.' };
  }
  if ((t.status === 'weak' || t.status === 'invisible') && !t.articles) {
    return { label: 'Write', tone: 'primary', to: `/ai-content-generation/blog?keyword=${encodeURIComponent(k.keyword)}`, tip: 'It does not rank yet: a blog post for it helps.' };
  }
  if (t.status === 'climbing') return { label: 'Improve page', tone: 'fix', to: where, tip: 'It is close to page 1: see where the page can say it better.' };
  if (t.status === 'working') return { label: 'View status', tone: 'good', to: '/keyword-management/status', tip: 'It works: see how it does over time.' };
  return { label: 'Check', tone: 'soft', to: `/keyword-overview?q=${encodeURIComponent(k.keyword)}`, tip: 'Open its searches per month, cost and related ideas.' };
}

function Menu({ anchor, onClose, children }) {
  const panel = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    const place = () => {
      if (!anchor.current) return;
      const a = anchor.current.getBoundingClientRect();
      const h = panel.current?.offsetHeight || 260;
      const top = window.innerHeight - a.bottom - 8 >= h || window.innerHeight - a.bottom > a.top ? a.bottom + 4 : Math.max(8, a.top - h - 4);
      const left = Math.max(8, Math.min(a.right - 230, window.innerWidth - 238));
      setPos(prev => (prev && Math.abs(prev.top - top) < 1 && Math.abs(prev.left - left) < 1 ? prev : { top, left }));
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [anchor]);
  useEffect(() => {
    const away = (e) => { if (panel.current && !panel.current.contains(e.target) && !anchor.current?.contains(e.target)) onClose(); };
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key); };
  }, [anchor, onClose]);
  return createPortal(
    <div ref={panel} role="menu" style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: 230, zIndex: 80 }} className="rounded-lg bg-white ring-1 ring-slate-200 shadow-xl py-1">{children}</div>, document.body);
}

const ITEM = 'w-full flex items-center gap-2.5 px-3 py-2 text-13 text-left text-slate-700 hover:bg-slate-50 cursor-pointer';

/** One main action for the keyword, and a menu with everything else you can do with it. */
export default function KeywordRowActions({ b, k, t, usedOn, busy, onMap, onChoose, onAskAi, onRemove, onRole }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  const a = nextAction(b, k, t, usedOn);
  const close = () => setOpen(false);
  const abs = k.target_url ? (k.target_url.startsWith('http') ? k.target_url : `${(b.website || '').replace(/\/$/, '')}${k.target_url}`) : '';
  const where = `/keyword-management/mapping?keyword=${encodeURIComponent(k.keyword)}${abs ? `&page=${encodeURIComponent(abs)}` : ''}`;
  const main = a.to
    ? <Link to={a.to} title={a.tip} className={`${BTN} ${TONES[a.tone]}`}>{a.label}</Link>
    : <button type="button" title={a.tip} disabled={busy === `u${k.id}`} className={`${BTN} ${TONES[a.tone]}`} onClick={() => (a.map ? onMap(a.map) : onChoose())}>{busy === `u${k.id}` && <Loader2 size={13} className="animate-spin" />}{a.label}</button>;
  return (
    <span className="inline-flex items-center gap-1.5">
      {main}
      <button ref={anchor} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`More actions for ${k.keyword}`} title="More actions" onClick={() => setOpen(o => !o)}
        className="h-8 w-8 rounded-md inline-flex items-center justify-center text-slate-500 ring-1 ring-inset ring-slate-200 hover:bg-slate-50 cursor-pointer"><MoreHorizontal size={16} /></button>
      {open && (
        <Menu anchor={anchor} onClose={close}>
          <Link to={where} role="menuitem" onClick={close} className={ITEM}><Eye size={15} className="text-indigo-500" />Where to use it</Link>
          <button type="button" role="menuitem" className={ITEM} onClick={() => { close(); onChoose(); }}>{k.target_url ? <Pencil size={15} className="text-slate-400" /> : <MapPin size={15} className="text-slate-400" />}{k.target_url ? 'Change the page' : 'Choose a page'}</button>
          {abs && <a href={abs} target="_blank" rel="noreferrer noopener" role="menuitem" onClick={close} className={ITEM}><ExternalLink size={15} className="text-slate-400" />Open the mapped page</a>}
          <Link to={`/ai-content-generation/blog?keyword=${encodeURIComponent(k.keyword)}`} role="menuitem" onClick={close} className={ITEM}><PenLine size={15} className="text-violet-500" />Write a blog post</Link>
          <button type="button" role="menuitem" className={ITEM} disabled={busy === `g${k.id}`} onClick={() => { close(); onAskAi(); }}><Sparkles size={15} className="text-violet-500" />{t?.ai?.tracked ? 'AI search question added' : 'Ask the AI engines'}</button>
          <Link to={`/keyword-overview?q=${encodeURIComponent(k.keyword)}`} role="menuitem" onClick={close} className={ITEM}><Search size={15} className="text-sky-500" />Check searches and cost</Link>
          {k.target_url && (
            <>
              <div className="my-1 border-t border-slate-100" />
              {k.role !== 'primary' && <button type="button" role="menuitem" className={ITEM} onClick={() => { close(); onRole('primary'); }}><Star size={15} className="text-indigo-500" />Make it the primary keyword</button>}
              {k.role !== 'secondary' && <button type="button" role="menuitem" className={ITEM} onClick={() => { close(); onRole('secondary'); }}><Star size={15} className="text-slate-400" />Make it a secondary keyword</button>}
            </>)}
          <div className="my-1 border-t border-slate-100" />
          <button type="button" role="menuitem" className={`${ITEM} !text-rose-700 hover:!bg-rose-50`} onClick={() => { close(); onRemove(); }}><Trash2 size={15} />Stop tracking it</button>
        </Menu>)}
    </span>
  );
}
