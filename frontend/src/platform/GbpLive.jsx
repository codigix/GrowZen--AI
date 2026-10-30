import React, { useEffect, useRef, useState } from 'react';
import {
  RefreshCw, Star, Image as ImageIcon, MessageSquare, Phone, Navigation, MousePointerClick, Search, Eye, MapPin, Globe, Clock, Loader2, ExternalLink,
  CheckCircle2, AlertTriangle, PlugZap, Newspaper, ListChecks, Tag, CalendarX
} from 'lucide-react';
import { Card, Badge, Button, ErrorNote, useAction } from './SeoUi';
import { api, useApi, fmtDateTime, fmt } from './seoApi';
import { VerifyPill } from './GbpAccounts';

/**
 * "Live from Google": everything read from the project's Google Business Profile after its Google account is
 * connected: profile, hours, photos, posts, attributes, the searches that found it, reviews and 30 days of
 * customer actions. Data: GET /businesses/{id}/gbp/live (stored by POST /businesses/{id}/sync, which also runs
 * on the schedule). The page re-syncs by itself when the stored data is older than STALE_MIN.
 */

const STALE_MIN = 10;
const DAY_NAMES = { MONDAY: 'Mon', TUESDAY: 'Tue', WEDNESDAY: 'Wed', THURSDAY: 'Thu', FRIDAY: 'Fri', SATURDAY: 'Sat', SUNDAY: 'Sun' };
const hm = (t) => (t ? `${String(t.hours || 0).padStart(2, '0')}:${String(t.minutes || 0).padStart(2, '0')}` : '');
const ago = (iso) => {
  if (!iso) return 'never';
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const pretty = (id) => String(id || '').replace(/^has_|^is_|^pay_|^wi_fi$/g, m => (m === 'wi_fi' ? 'Wi-Fi' : '')).replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
const POST_TONE = { LIVE: 'green', PROCESSING: 'amber', REJECTED: 'red' };

function Tile({ icon: Icon, label, value, sub, tone = 'indigo' }) {
  const tones = { indigo: 'bg-indigo-50 text-indigo-500', emerald: 'bg-emerald-50 text-emerald-500', amber: 'bg-amber-50 text-amber-500', sky: 'bg-sky-50 text-sky-500', violet: 'bg-violet-50 text-violet-500' };
  return (
    <div className="ai-glass-card rounded p-3.5 flex items-center gap-3 min-w-0">
      <span className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${tones[tone]}`}><Icon size={17} /></span>
      <div className="min-w-0"><div className="text-11.5 font-semibold uppercase tracking-wide text-slate-400 truncate">{label}</div><div className="text-20 leading-tight font-bold text-slate-900 tabular-nums">{value ?? '—'}</div>{sub && <div className="text-11.5 text-slate-500 truncate">{sub}</div>}</div>
    </div>
  );
}

const Label = ({ children }) => <div className="text-11 font-semibold uppercase tracking-wider text-slate-400 mb-1.5">{children}</div>;

function Hours({ hours, special }) {
  const by = {};
  (hours?.periods || []).forEach(p => { (by[p.openDay] = by[p.openDay] || []).push(`${hm(p.openTime)}–${hm(p.closeTime)}`); });
  return (
    <div>
      <ul className="text-13 divide-y divide-slate-100">
        {Object.keys(DAY_NAMES).map(d => <li key={d} className="flex justify-between py-1.5"><span className="text-slate-600">{DAY_NAMES[d]}</span><span className={by[d] ? 'text-slate-900 tabular-nums' : 'text-slate-400'}>{by[d] ? by[d].join(', ') : 'Closed'}</span></li>)}
      </ul>
      {special?.length > 0 && (
        <div className="mt-3">
          <Label>Special hours</Label>
          <ul className="text-12.5 space-y-1">{special.slice(0, 6).map(s => <li key={s.date} className="flex justify-between"><span className="text-slate-600 inline-flex items-center gap-1.5"><CalendarX size={12} className="text-slate-400" />{s.date}</span><span className="text-slate-900">{s.closed ? 'Closed' : `${s.open}–${s.close}`}</span></li>)}</ul>
        </div>
      )}
    </div>
  );
}

export default function GbpLive({ b, toast, onConnect }) {
  const data = useApi(`/businesses/${b.id}/gbp/live`);
  const [busy, error, run] = useAction();
  const [allPhotos, setAllPhotos] = useState(false);
  const tried = useRef(false);
  const d = data.data;
  const live = d?.live;
  const connected = Boolean(d?.linked && d?.connection && d.connection.status === 'active');
  const stale = connected && (!live?.synced_at || Date.now() - new Date(live.synced_at).getTime() > STALE_MIN * 60000);

  const sync = (quiet = false) => run('sync', async () => {
    const r = await api(`/businesses/${b.id}/sync`, { method: 'POST' });
    data.reload(true);
    if (!quiet) toast(`Synced from Google: ${r.reviews} reviews, ${r.photos ?? 0} photos, ${r.posts ?? 0} posts, ${r.keywords ?? 0} search keywords`);
    return r;
  });
  // Pull fresh data when the page opens on stale data, then keep it fresh while the page stays open.
  useEffect(() => { if (stale && !tried.current) { tried.current = true; sync(true); } }, [stale]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!connected) return undefined;
    const t = setInterval(() => { if (document.visibilityState === 'visible') sync(true); }, STALE_MIN * 60000);
    return () => clearInterval(t);
  }, [connected, b.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!d) return data.error ? <ErrorNote>{data.error.message}</ErrorNote> : <div className="py-12 flex justify-center text-slate-400"><Loader2 size={18} className="animate-spin" /></div>;

  if (!d.linked) {
    return (
      <Card><div className="py-6 text-center max-w-md mx-auto">
        <span className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-500 flex items-center justify-center mx-auto mb-3"><PlugZap size={22} /></span>
        <div className="text-15 font-semibold text-slate-900">{b.name} isn't connected to a Google account yet</div>
        <p className="text-13 text-slate-500 mt-1">Sign in with the Google account that manages this profile. Its photos, posts, hours, reviews, search keywords and customer actions then load here live.</p>
        <Button className="mt-4" variant="primary" icon={PlugZap} onClick={() => onConnect?.('google')}>Connect Google account</Button>
      </div></Card>
    );
  }

  const m = d.metrics;
  const p = d.profile;
  const errors = Object.entries(live?.errors || {});
  const media = live?.media || [];
  const posts = live?.posts || [];
  const keywords = live?.search_keywords || [];
  const split = d.rating_split;
  const totalReviews = Object.values(split).reduce((a, v) => a + v, 0) || 1;

  return (
    <div className="space-y-4">
      {/* Connection and sync */}
      <div className="ai-glass-card rounded px-5 py-3.5 flex flex-wrap items-center gap-3">
        <span className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${connected ? 'bg-emerald-50 text-emerald-500' : 'bg-amber-50 text-amber-500'}`}>{connected ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}</span>
        <div className="flex-1 min-w-[220px]">
          <div className="text-14 font-semibold text-slate-900">{connected ? 'Connected to Google' : 'Google access needs attention'} <span className="font-normal text-slate-500">· {d.connection?.email || '—'}</span></div>
          <div className="text-12 text-slate-500 flex flex-wrap items-center gap-x-3">
            <span className="inline-flex items-center gap-1"><Clock size={11} /> Last synced {ago(live?.synced_at || d.connection?.last_sync_at)}</span>
            <span>{p.account || ''}</span>
            {connected && <span className="text-slate-400">Refreshes itself every {STALE_MIN} min while this page is open</span>}
          </div>
          {d.connection?.last_error && <div className="text-12 text-red-600 mt-0.5">{d.connection.last_error}</div>}
        </div>
        <VerifyPill state={d.verification} />
        {d.status?.maps_url && <a href={d.status.maps_url} target="_blank" rel="noreferrer" className="text-12 font-semibold text-indigo-600 hover:underline inline-flex items-center gap-1">View on Maps <ExternalLink size={11} /></a>}
        {connected ? <Button variant="primary" icon={RefreshCw} busy={busy === 'sync'} onClick={() => sync(false)}>Sync now</Button> : <Button variant="primary" icon={PlugZap} onClick={() => onConnect?.('google')}>Reconnect</Button>}
      </div>
      <ErrorNote>{error}</ErrorNote>
      {errors.length > 0 && (
        <div className="rounded bg-amber-50 ring-1 ring-inset ring-amber-200 px-4 py-3 text-12.5 text-amber-900">
          <b>Google didn't return everything.</b> The rest loaded fine.
          <ul className="mt-1 space-y-0.5">{errors.map(([k, v]) => <li key={k}><b className="capitalize">{k.replace('_', ' ')}:</b> {v}</li>)}</ul>
        </div>
      )}

      {/* Key numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile icon={Star} tone="amber" label="Rating" value={m.rating ? `${m.rating}★` : '—'} sub={`${fmt(m.review_count || 0)} reviews · ${m.unreplied_reviews} unreplied`} />
        <Tile icon={ImageIcon} tone="violet" label="Photos" value={m.photo_count} sub={`${posts.length} posts`} />
        <Tile icon={Phone} tone="emerald" label="Calls · 30 days" value={fmt(m.calls_30)} />
        <Tile icon={Navigation} tone="sky" label="Directions · 30 days" value={fmt(m.directions_30)} />
        <Tile icon={MousePointerClick} tone="indigo" label="Website clicks" value={fmt(m.website_clicks_30)} sub="30 days" />
        <Tile icon={Search} tone="violet" label="Search views" value={fmt(m.views_search_30)} sub="30 days" />
        <Tile icon={MapPin} tone="emerald" label="Maps views" value={fmt(m.views_maps_30)} sub="30 days" />
        <Tile icon={Eye} tone="amber" label="Bookings" value={fmt(m.bookings_30)} sub="30 days" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
        {/* Profile as Google holds it */}
        <Card title="Profile on Google" subtitle="As it is on Google right now" className="xl:col-span-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 text-13">
            <div><Label>Business</Label><div className="font-semibold text-slate-900">{p.name}</div><div className="mt-1 flex flex-wrap gap-1.5">{p.primary_category && <Badge tone="blue">{p.primary_category}</Badge>}{p.secondary_categories.map(c => <Badge key={c} tone="gray">{c}</Badge>)}</div></div>
            <div><Label>Contact</Label><div className="space-y-1 text-slate-700"><div className="flex items-center gap-2"><Phone size={13} className="text-slate-400" />{p.phone || '—'}</div><div className="flex items-center gap-2 truncate"><Globe size={13} className="text-slate-400" />{p.website ? <a href={p.website} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline truncate">{p.website}</a> : '—'}</div></div></div>
            <div className="md:col-span-2"><Label>Address</Label><div className="text-slate-700 flex items-start gap-2"><MapPin size={13} className="text-slate-400 mt-0.5" />{p.address || '—'}{p.service_area ? <span className="text-slate-400"> · serves {p.service_area}</span> : null}</div></div>
            <div className="md:col-span-2"><Label>Description</Label><p className="text-slate-700 leading-relaxed">{p.description || <span className="text-slate-400">No description on Google.</span>}</p></div>
            {(live?.attributes?.length > 0 || live?.service_items?.length > 0) && (
              <div className="md:col-span-2">
                {live.attributes?.length > 0 && <><Label>Attributes</Label><div className="flex flex-wrap gap-1.5 mb-3">{live.attributes.map(a => <span key={a.id} className="px-2 py-0.5 rounded-full text-12 bg-slate-100 text-slate-700 border border-slate-200 inline-flex items-center gap-1"><Tag size={10} />{pretty(a.id)}{a.values?.length && a.values[0] !== true ? `: ${a.values.join(', ')}` : ''}</span>)}</div></>}
                {live.service_items?.length > 0 && <><Label>Services</Label><div className="flex flex-wrap gap-1.5">{live.service_items.map((s, i) => <span key={i} className="px-2 py-0.5 rounded-full text-12 bg-indigo-50 text-indigo-700 border border-indigo-100" title={s.description || ''}>{pretty(s.name)}</span>)}</div></>}
              </div>
            )}
          </div>
        </Card>
        <Card title="Opening hours"><Hours hours={p.hours} special={p.special_hours} /></Card>
      </div>

      {/* Photos and posts */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
        <Card title={`Photos (${media.length})`} subtitle="Live from the profile, with how often each was viewed" className="xl:col-span-2"
          action={media.length > 12 && <button type="button" onClick={() => setAllPhotos(v => !v)} className="text-12 font-semibold text-indigo-600 hover:underline cursor-pointer">{allPhotos ? 'Show fewer' : `Show all ${media.length}`}</button>}>
          {media.length ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
              {(allPhotos ? media : media.slice(0, 12)).map(x => (
                <a key={x.id} href={x.url} target="_blank" rel="noreferrer" className="group relative block aspect-square rounded overflow-hidden bg-slate-100" title={`${x.category || 'Photo'}${x.views ? ` · ${fmt(x.views)} views` : ''}`}>
                  <img src={x.thumb || x.url} alt={x.category || 'Photo'} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                  <span className="absolute left-1 bottom-1 px-1.5 py-0.5 rounded bg-slate-900/70 text-white text-10 font-semibold">{x.category ? String(x.category).replace(/_/g, ' ').toLowerCase() : 'photo'}{x.views ? ` · ${fmt(x.views)}` : ''}</span>
                </a>
              ))}
            </div>
          ) : <p className="text-13 text-slate-500 py-6 text-center">{live?.errors?.media ? 'Google did not return the photos (see above).' : 'No photos on the profile yet.'}</p>}
        </Card>
        <Card title={`Posts (${posts.length})`} subtitle="Updates, offers and events on the profile">
          {posts.length ? (
            <ul className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {posts.slice(0, 10).map(x => (
                <li key={x.id} className="flex gap-3">
                  <span className="w-9 h-9 rounded-full bg-sky-50 text-sky-500 flex items-center justify-center shrink-0"><Newspaper size={15} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5"><Badge tone={POST_TONE[x.state] || 'gray'}>{(x.state || 'LIVE').toLowerCase()}</Badge><span className="text-11.5 text-slate-400">{x.type?.toLowerCase()} · {fmtDateTime(x.created)}</span></div>
                    <p className="text-13 text-slate-700 line-clamp-3 mt-0.5">{x.summary || x.title}</p>
                    {x.url && <a href={x.url} target="_blank" rel="noreferrer" className="text-12 font-semibold text-indigo-600 hover:underline inline-flex items-center gap-1">Open <ExternalLink size={10} /></a>}
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="text-13 text-slate-500 py-6 text-center">{live?.errors?.posts ? 'Google did not return the posts (see above).' : 'No posts yet.'}</p>}
        </Card>
      </div>

      {/* Searches and reviews */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
        <Card title="Searches that found the profile" subtitle="Last 3 full months, by monthly impressions" pad={false}>
          {keywords.length ? (
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-13"><thead className="sticky top-0 bg-slate-50 text-11.5 uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-2 text-left font-semibold">Search</th><th className="px-5 py-2 text-right font-semibold">Impressions</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{keywords.slice(0, 40).map(k => <tr key={k.keyword}><td className="px-5 py-2 text-slate-800">{k.keyword}</td><td className="px-5 py-2 text-right tabular-nums">{k.impressions != null ? fmt(k.impressions) : <span className="text-slate-400">&lt; {k.below}</span>}</td></tr>)}</tbody></table>
            </div>
          ) : <p className="text-13 text-slate-500 px-5 py-8 text-center">{live?.errors?.search_keywords ? 'Google did not return the search keywords (see above).' : 'No search data yet.'}</p>}
        </Card>
        <Card title="Reviews" subtitle={`${fmt(m.review_count || 0)} on Google`} className="xl:col-span-2">
          <div className="grid grid-cols-1 md:grid-cols-[200px_minmax(0,1fr)] gap-6">
            <div>
              <div className="flex items-baseline gap-1.5"><span className="text-26 font-bold text-slate-900">{m.rating ?? '—'}</span><Star size={16} className="fill-amber-400 text-amber-400" /></div>
              <ul className="mt-2 space-y-1.5">{[5, 4, 3, 2, 1].map(n => <li key={n} className="flex items-center gap-2 text-12"><span className="w-3 text-slate-500">{n}</span><span className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><span className="block h-full rounded-full bg-amber-400" style={{ width: `${(split[String(n)] / totalReviews) * 100}%` }} /></span><span className="w-6 text-right tabular-nums text-slate-500">{split[String(n)]}</span></li>)}</ul>
            </div>
            <ul className="space-y-3 max-h-72 overflow-y-auto pr-1">
              {d.recent_reviews.length ? d.recent_reviews.map(r => (
                <li key={r.id} className="text-13">
                  <div className="flex items-center gap-2"><span className="font-semibold text-slate-900">{r.author || 'Google user'}</span><span className="text-amber-500 tabular-nums">{'★'.repeat(r.rating)}</span><span className="text-11.5 text-slate-400">{r.date}</span>{!r.replied && <Badge tone="amber">No reply</Badge>}</div>
                  {r.body && <p className="text-slate-600 line-clamp-2">{r.body}</p>}
                  {r.reply && <p className="mt-1 pl-3 border-l-2 border-slate-200 text-12.5 text-slate-500 line-clamp-2"><MessageSquare size={11} className="inline mr-1" />{r.reply}</p>}
                </li>
              )) : <li className="text-13 text-slate-500 py-4 text-center">No reviews yet.</li>}
            </ul>
          </div>
        </Card>
      </div>
    </div>
  );
}
