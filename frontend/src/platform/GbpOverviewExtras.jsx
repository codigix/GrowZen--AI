import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import {
  Pencil, MessageSquareText, Image as ImageIcon, Newspaper, TrendingUp, Megaphone, QrCode, Star, Mail, MessageCircle, Facebook, Copy, Check,
  Download, ExternalLink, CheckCircle2, Circle, Plus, X, ArrowRight
} from 'lucide-react';
import { Card, Button } from './SeoUi';
import { api, useApi, fmt } from './seoApi';

// ---------- helpers

function useCopy() {
  const [done, setDone] = useState(false);
  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); } catch {
      const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch { /* ignore */ } t.remove();
    }
    setDone(true); setTimeout(() => setDone(false), 1800);
  };
  return [done, copy];
}

const dismissKey = (id) => `gbp.review.dismissed.${id}`;
const readDismissed = (id) => { try { return JSON.parse(localStorage.getItem(dismissKey(id)) || '[]'); } catch { return []; } };
const writeDismissed = (id, list) => { try { localStorage.setItem(dismissKey(id), JSON.stringify(list.slice(-50))); } catch { /* private mode */ } };

// ---------- 1. profile strength

/** A ring and one honest word, from our own profile score. Google does not publish its own number. */
export function ProfileStrength({ score }) {
  if (score == null) return null;
  const tone = score >= 80 ? { word: 'Looks good!', color: '#10b981' } : score >= 55 ? { word: 'Getting there', color: '#f59e0b' } : { word: 'Needs work', color: '#ef4444' };
  const r = 17;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-3" title="Google does not share its own profile strength number; this is our check of the same things Google rewards.">
      <div className="text-right">
        <div className="text-13 font-semibold text-slate-800">Profile strength</div>
        <div className="text-12 font-medium" style={{ color: tone.color }}>{tone.word}</div>
      </div>
      <svg width="46" height="46" viewBox="0 0 46 46" role="img" aria-label={`Profile strength ${score} out of 100`}>
        <circle cx="23" cy="23" r={r} fill="none" stroke="#e2e8f0" strokeWidth="5" />
        <circle cx="23" cy="23" r={r} fill="none" stroke={tone.color} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 23 23)" />
        <text x="23" y="27" textAnchor="middle" fontSize="12" fontWeight="700" fill="#334155">{score}</text>
      </svg>
    </div>
  );
}

// ---------- 2. quick-action tiles

export function QuickTiles({ b, unreplied = 0 }) {
  const navigate = useNavigate();
  const tiles = [
    ['Edit profile', Pencil, '/gmb-profile?tab=profile&sub=edit'],
    ['Read reviews', MessageSquareText, '/gmb-profile?tab=reviews', unreplied > 0],
    ['Photos', ImageIcon, '/media-management'],
    ['Posts', Newspaper, '/google-posts'],
    ['Performance', TrendingUp, '/gmb-profile?tab=performance'],
    ['Advertise', Megaphone, '/gmb-profile?tab=settings'],
    ['Get profile QR', QrCode, '#share-profile'],
    ['Ask for reviews', Star, '/gmb-profile?tab=reviews']
  ];
  const open = (to) => {
    if (to === '#share-profile') { document.getElementById('share-profile')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    navigate(to);
  };
  return (
    <div className="grid grid-cols-4 sm:grid-cols-4 lg:grid-cols-8 gap-1">
      {tiles.map(([label, Icon, to, dot]) => (
        <button key={label} type="button" onClick={() => open(to)} className="relative flex flex-col items-center gap-1.5 px-1 py-3 rounded-lg hover:bg-indigo-50/60 cursor-pointer text-center">
          <span className="relative text-indigo-600"><Icon size={22} />{dot && <span className="absolute -top-1 -right-1.5 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-white" aria-label="New" />}</span>
          <span className="text-12.5 text-slate-700 leading-tight">{label}</span>
        </button>
      ))}
    </div>
  );
}

// ---------- 3. what is missing

function missingFor(b, d) {
  const items = [];
  const photoCount = b.photo_count || (d?.live?.media || []).length || 0;
  const hasBooking = Boolean(b.booking_url || (b.action_links || []).some(x => x.type === 'APPOINTMENT'));
  const edit = (step) => `/gmb-profile?tab=profile&sub=edit&step=${step}`;
  const add = (key, label, why, to, empty) => items.push({ key, label, why, to, empty });
  add('phone', 'Phone number', 'Customers cannot call you from Google.', edit('contact'), !(b.phone || '').trim());
  add('website', 'Website', 'Adds the Website button.', edit('contact'), !(b.website || '').trim());
  add('hours', 'Opening hours', 'People look for “open now”.', '/gmb-profile?tab=profile&sub=hours', !(b.hours?.periods || []).length);
  add('booking', 'Booking or appointment link', 'Adds a Book button.', edit('contact'), !hasBooking);
  add('address', 'Address', 'Needed to show on the map.', edit('location'), !(b.address || '').trim());
  add('description', 'Description', `Write at least 250 characters (now ${(b.description || '').length}).`, edit('about'), (b.description || '').length < 250);
  add('services', 'Services', 'Shown under Services on your profile.', edit('services'), !(b.services || []).some(s => s?.name));
  add('categories', 'Extra categories', 'Helps you show for more searches.', edit('details'), !(b.secondary_categories || []).length);
  add('attributes', 'Highlights / attributes', 'e.g. “Free Wi-Fi”, “Women-led”.', edit('highlights'), !(b.attributes || []).length);
  add('photos', `Photos (${photoCount} of 5)`, 'Profiles with photos get more actions.', '/media-management', photoCount < 5);
  add('logo', 'Logo', 'Shown next to your name.', '/media-management', !(b.logo || d?.profile?.logo));
  add('cover', 'Cover photo', 'The first picture people see.', '/media-management', !b.cover_photo);
  return items;
}

export function MissingInfoCard({ b, d }) {
  const navigate = useNavigate();
  const all = useMemo(() => missingFor(b, d), [b, d]);
  const todo = all.filter(x => x.empty);
  const pct = Math.round(((all.length - todo.length) / all.length) * 100);
  return (
    <Card title="Add missing information" subtitle={todo.length ? `${todo.length} thing${todo.length === 1 ? '' : 's'} still empty · profile ${pct}% filled in` : 'Everything Google asks for is filled in'}>
      {todo.length === 0 ? (
        <div className="py-4 flex items-center gap-2 text-13 text-emerald-700"><CheckCircle2 size={18} />Nothing missing. Keep it fresh with posts and photos.</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {todo.map(x => (
            <li key={x.key} className="py-2.5 flex items-center gap-3">
              <Circle size={16} className="text-slate-300 shrink-0" />
              <div className="flex-1 min-w-0"><div className="text-13 font-medium text-slate-900">{x.label}</div><div className="text-12 text-slate-500">{x.why}</div></div>
              <Button size="sm" icon={Plus} onClick={() => navigate(x.to)}>Add</Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------- 4. share the profile

export function ShareProfileCard({ b }) {
  const link = useApi(`/businesses/${b.id}/review-link`);
  const url = link.data?.profile_url;
  const [qr, setQr] = useState('');
  const [copied, copy] = useCopy();
  useEffect(() => { if (url) QRCode.toDataURL(url, { width: 360, margin: 1, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr('')); }, [url]);
  const enc = encodeURIComponent;
  const msg = `Find ${b.name} on Google: ${url || ''}`;
  const channels = url ? [
    ['Email', Mail, `mailto:?subject=${enc(b.name)}&body=${enc(msg)}`],
    ['WhatsApp', MessageCircle, `https://wa.me/?text=${enc(msg)}`],
    ['Facebook', Facebook, `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`]
  ] : [];
  return (
    <div id="share-profile">
      <Card title="Share your profile" subtitle="One link and QR code that open this business on Google Maps and Search">
        {!url ? <p className="text-13 text-slate-500">{link.error ? link.error.message : 'Loading the link…'}</p> : (
          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_160px] gap-5">
            <div className="space-y-3 min-w-0">
              <div className="flex items-stretch gap-2">
                <input readOnly value={url} onFocus={e => e.target.select()} aria-label="Profile link" className="flex-1 min-w-0 h-9 px-3 text-12.5 font-mono rounded border border-slate-200 bg-slate-50" />
                <Button icon={copied ? Check : Copy} onClick={() => copy(url)}>{copied ? 'Copied' : 'Copy'}</Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {channels.map(([l, I, href]) => <a key={l} href={href} target="_blank" rel="noreferrer" className="h-9 px-3.5 rounded-lg ring-1 ring-slate-300 hover:bg-slate-50 inline-flex items-center gap-2 text-13 font-medium text-slate-700 cursor-pointer"><I size={15} />{l}</a>)}
                <a href={url} target="_blank" rel="noreferrer" className="h-9 px-3.5 rounded-lg ring-1 ring-slate-300 hover:bg-slate-50 inline-flex items-center gap-2 text-13 font-medium text-slate-700 cursor-pointer"><ExternalLink size={15} />Open on Google</a>
              </div>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="w-[150px] h-[150px] rounded-xl ring-1 ring-slate-200 bg-white p-2 flex items-center justify-center">{qr ? <img src={qr} alt="QR code for the profile" className="w-full h-full" /> : <QrCode size={32} className="text-slate-300" />}</div>
              <a href={qr || undefined} download={`${b.name.replace(/\W+/g, '-')}-profile-qr.png`} className={`text-13 font-medium inline-flex items-center gap-1.5 ${qr ? 'text-indigo-600 hover:underline cursor-pointer' : 'text-slate-300 pointer-events-none'}`}><Download size={14} />Download QR</a>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------- 5. new-review banner

/** Like Google's "You have a new 5-star review": from the notifications list when it exists, else the latest review that still has no reply. */
export function NewReviewBanner({ b }) {
  const navigate = useNavigate();
  const [note, setNote] = useState(null);
  const [dismissed, setDismissed] = useState(() => readDismissed(b.id));
  const reviews = useApi(`/businesses/${b.id}/reviews`);

  useEffect(() => { // the notifications API is optional: no answer means no banner from it
    let live = true;
    api(`/notifications?business_id=${b.id}&unread=true`).then(r => {
      const rows = Array.isArray(r) ? r : r?.notifications || r?.items || [];
      if (live) setNote(rows.find(x => x.kind === 'review' || x.kind === 'new_review') || null);
    }).catch(() => { if (live) setNote(null); });
    return () => { live = false; };
  }, [b.id]);

  const fromReviews = useMemo(() => {
    const cutoff = Date.now() - 14 * 86400000;
    const rows = (reviews.data?.reviews || []).filter(r => r.reply_status !== 'posted' && !dismissed.includes(`r${r.id}`) && new Date(r.review_at || r.review_date || 0).getTime() >= cutoff);
    return rows.sort((a, c) => new Date(c.review_at || c.review_date || 0) - new Date(a.review_at || a.review_date || 0))[0] || null;
  }, [reviews.data, dismissed]);

  const item = note ? { key: `n${note.id}`, rating: note.rating, author: note.author || note.reviewer || '', notification: note } : fromReviews ? { key: `r${fromReviews.id}`, rating: fromReviews.rating, author: fromReviews.author } : null;
  if (!item || dismissed.includes(item.key)) return null;
  const stars = Number(item.rating) || 0;
  const good = stars >= 4;
  const close = async () => {
    const next = [...dismissed, item.key];
    setDismissed(next); writeDismissed(b.id, next);
    if (item.notification) { try { await api(`/notifications/${item.notification.id}/read`, { method: 'POST' }); } catch { /* the banner is hidden either way */ } }
  };
  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-4 flex items-start gap-4 max-w-xl" role="status">
      <div className="flex-1 min-w-0">
        <div className="text-15 font-medium text-slate-900">{stars ? `You have a new ${stars}-star review` : 'You have a new review'}</div>
        <p className="text-13 text-slate-500 mt-1">{good ? 'Reply to this positive feedback to build trust with future customers.' : 'Reply to show customers you care and to put things right.'}</p>
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" variant="primary" icon={ArrowRight} onClick={() => navigate('/gmb-profile?tab=reviews')}>Reply</Button>
          <Button size="sm" onClick={close}>Dismiss</Button>
        </div>
      </div>
      <div className="flex flex-col items-end gap-3">
        <button type="button" onClick={close} aria-label="Dismiss" className="text-slate-400 hover:text-slate-700 cursor-pointer"><X size={16} /></button>
        <span className={`w-11 h-11 rounded-full flex items-center justify-center text-white text-18 font-medium ${good ? 'bg-emerald-600' : 'bg-amber-500'}`}>{(item.author || '★').trim().charAt(0).toUpperCase()}</span>
      </div>
    </div>
  );
}

export const interactions = (m) => fmt((m?.calls_30 || 0) + (m?.directions_30 || 0) + (m?.website_clicks_30 || 0) + (m?.bookings_30 || 0));
