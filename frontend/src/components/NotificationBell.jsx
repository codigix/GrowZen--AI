import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Star, MessageSquareReply, CheckCheck } from 'lucide-react';
import { api } from '../platform/seoApi';

const POLL_MS = 60000;

const ago = (iso) => {
  const t = new Date(iso).getTime();
  if (!iso || Number.isNaN(t)) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

/** The header bell: unread alerts from the signed-in user's own projects (new Google reviews). Polls every minute while the tab is visible. */
export default function NotificationBell() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  const load = useCallback(async () => {
    try {
      const [latest, unreadList] = await Promise.all([api('/notifications?limit=10'), api('/notifications?unread=true&limit=100')]);
      setItems(latest); setUnread(unreadList.length);
    } catch (e) { /* signed out, offline or the API is restarting: keep what is shown */ }
  }, []);

  useEffect(() => {
    load();
    const tick = () => { if (!document.hidden) load(); };
    const timer = setInterval(tick, POLL_MS);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); window.removeEventListener('focus', tick); document.removeEventListener('visibilitychange', tick); };
  }, [load]);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') { setOpen(false); box.current?.querySelector('button')?.focus(); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const go = async (n) => {
    setOpen(false);
    if (!n.read) { setItems(l => l.map(x => (x.id === n.id ? { ...x, read: true } : x))); setUnread(u => Math.max(0, u - 1)); api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => load()); }
    if (n.link) navigate(n.link);
  };
  const readAll = async () => {
    setItems(l => l.map(x => ({ ...x, read: true }))); setUnread(0);
    try { await api('/notifications/read-all', { method: 'POST' }); } catch (e) { load(); }
  };

  return (
    <div className="relative" ref={box}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-haspopup="true" aria-expanded={open} aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        className="relative w-9 h-9 rounded bg-topbar-field flex items-center justify-center text-topbar-item hover:text-white cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60">
        <Bell size={15} />
        {unread > 0 && <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-rose-500 text-white font-bold text-9 flex items-center justify-center">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div role="menu" aria-label="Notifications" className="absolute right-0 top-11 w-[360px] max-w-[92vw] bg-white rounded-xl shadow-2xl ring-1 ring-slate-200 overflow-hidden z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div className="text-14 font-semibold text-slate-900">Notifications</div>
            <button type="button" onClick={readAll} disabled={!unread} className="text-12 font-medium text-indigo-600 hover:underline disabled:text-slate-300 disabled:no-underline cursor-pointer inline-flex items-center gap-1"><CheckCheck size={13} />Mark all read</button>
          </div>
          {items.length === 0 ? (
            <div className="px-4 py-10 text-center text-13 text-slate-400">Nothing yet. New Google reviews show up here.</div>
          ) : (
            <ul className="max-h-[420px] overflow-y-auto divide-y divide-slate-100">
              {items.map(n => (
                <li key={n.id}>
                  <div className={`flex gap-3 px-4 py-3 ${n.read ? '' : 'bg-indigo-50/50'}`}>
                    <span className={`mt-0.5 w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${n.kind === 'low_rating_review' ? 'bg-rose-50 text-rose-500' : 'bg-amber-50 text-amber-500'}`}><Star size={15} className={n.read ? '' : 'fill-current'} /></span>
                    <div className="min-w-0 flex-1">
                      <button type="button" role="menuitem" onClick={() => go(n)} className="text-left w-full cursor-pointer outline-none focus-visible:underline">
                        <div className="text-11.5 text-slate-400 truncate">{n.business_name || 'Project'} · {ago(n.created_at)}</div>
                        <div className={`text-13 ${n.read ? 'text-slate-700' : 'font-semibold text-slate-900'}`}>{n.title}</div>
                        {n.body && <div className="text-12 text-slate-500 line-clamp-2 mt-0.5">{n.body}</div>}
                      </button>
                      {n.link && (n.kind === 'new_review' || n.kind === 'low_rating_review') && n.review_id && <button type="button" onClick={() => go(n)} className="mt-1.5 text-12 font-medium text-indigo-600 hover:underline cursor-pointer inline-flex items-center gap-1"><MessageSquareReply size={12} />Reply</button>}
                    </div>
                    {!n.read && <span className="mt-2 w-2 h-2 rounded-full bg-indigo-500 shrink-0" aria-label="Unread" />}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
