import React, { useEffect, useRef, useState } from 'react';
import { Search, X, Upload, Trash2, Save, Loader2, Pencil, MapPin, Play } from 'lucide-react';
import { Card, Button, Field, ErrorNote, inputCls, areaCls, Modal, Badge, useAction, refreshBusinesses, useDoubleConfirm, Sk, SkList } from './SeoUi';
import { api, useApi } from './seoApi';
import { BusinessAvatar } from './GbpWorkspace';
import Select from '../components/Select';

/** True when the client's profile is linked to Google, so edits here are written to Google. */
export const isLinked = (b) => Boolean(b.gbp_location && b.connection_id);

const MEDIA = [['EXTERIOR', 'Exterior'], ['INTERIOR', 'Interior'], ['TEAMS', 'Team'], ['PRODUCT', 'Product'], ['AT_WORK', 'At work'], ['COVER', 'Cover photo'], ['PROFILE', 'Logo / profile'], ['ADDITIONAL', 'Other']];

export const readBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = () => reject(new Error('Could not read the file'));
  r.readAsDataURL(file);
});

const Linked = ({ b, children }) => (isLinked(b) ? children : (
  <p className="text-13 text-slate-500">Connect this client's Google account to manage this here and publish it to Google.</p>
));

/** Primary and additional categories, picked from Google's own list (Google needs its category ids). */
export function CategoryEditor({ b, toast }) {
  const [primary, setPrimary] = useState(() => ({ name: null, displayName: b.primary_category || '' }));
  const [extra, setExtra] = useState(() => (b.secondary_categories || []).map(d => ({ name: null, displayName: d })));
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);
  const [target, setTarget] = useState('primary');
  const [busy, error, run] = useAction();
  const timer = useRef(null);
  useEffect(() => {
    clearTimeout(timer.current);
    if (q.trim().length < 2) { setHits([]); return undefined; }
    timer.current = setTimeout(() => api(`/businesses/${b.id}/gbp/categories?q=${encodeURIComponent(q.trim())}`).then(setHits).catch(() => setHits([])), 300);
    return () => clearTimeout(timer.current);
  }, [q, b.id]);
  const pick = (c) => {
    if (target === 'primary') setPrimary(c); else if (!extra.some(e => e.displayName === c.displayName) && extra.length < 9) setExtra([...extra, c]);
    setQ(''); setHits([]);
  };
  // A category read from Google carries only its name; saving needs Google's id, so unresolved ones are re-picked.
  const unresolved = !primary.name || extra.some(e => !e.name);
  const save = () => run('save', async () => {
    await api(`/businesses/${b.id}/gbp/categories`, { method: 'PUT', body: { primary, additional: extra.filter(e => e.name) } });
    await refreshBusinesses();
    toast('Categories updated on your Google Business Profile');
  });
  return (
    <Card title="Categories" subtitle="Your primary category is the strongest ranking signal. Choose from Google's list.">
      <Linked b={b}>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5 items-center"><span className="text-12 text-slate-500 w-20">Primary</span><Badge tone="blue">{primary.displayName || 'None'}</Badge></div>
          <div className="flex flex-wrap gap-1.5 items-center"><span className="text-12 text-slate-500 w-20">Additional</span>
            {extra.length === 0 && <span className="text-12 text-slate-400">None</span>}
            {extra.map(e => <span key={e.displayName} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-12 text-slate-700">{e.displayName}<button type="button" aria-label={`Remove ${e.displayName}`} onClick={() => setExtra(extra.filter(x => x !== e))} className="text-slate-400 hover:text-red-600 cursor-pointer"><X size={11} /></button></span>)}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <Select className={`${inputCls} w-40`} value={target} onChange={e => setTarget(e.target.value)} aria-label="Set as"><option value="primary">Set primary</option><option value="extra">Add additional</option></Select>
            <div className="relative flex-1 min-w-[220px]">
              <Search size={13} className="absolute left-2.5 top-3 text-slate-400" />
              <input className={`${inputCls} pl-8`} placeholder="Search Google categories, e.g. dentist" value={q} onChange={e => setQ(e.target.value)} />
              {hits.length > 0 && <ul className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded shadow-lg max-h-56 overflow-auto">{hits.map(h => <li key={h.name}><button type="button" onClick={() => pick(h)} className="w-full text-left px-3 py-2 text-13 hover:bg-indigo-50 cursor-pointer">{h.displayName}</button></li>)}</ul>}
            </div>
          </div>
          {unresolved && <p className="text-12 text-amber-700">Search and pick the primary category once to link it to Google's list, then save.</p>}
          <ErrorNote>{error}</ErrorNote>
          <Button variant="primary" icon={Save} busy={busy === 'save'} disabled={!primary.name} onClick={save}>Save categories to Google</Button>
        </div>
      </Linked>
    </Card>
  );
}

/** Street address, written to Google as a structured address. */
export function AddressEditor({ b, toast }) {
  const addr = useApi(isLinked(b) ? `/businesses/${b.id}/gbp/address` : null);
  const [f, setF] = useState(null);
  const [busy, error, run] = useAction();
  useEffect(() => { if (addr.data) setF({ ...addr.data, address_lines: addr.data.address_lines.length ? addr.data.address_lines : [''] }); }, [addr.data]);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const save = () => run('save', async () => {
    await api(`/businesses/${b.id}/gbp/address`, { method: 'PUT', body: f });
    await refreshBusinesses();
    toast('Address updated on your Google Business Profile');
  });
  return (
    <Card title="Address" subtitle="Changing the address can send the profile for re-verification on Google.">
      <Linked b={b}>
        {!f ? <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="space-y-1.5"><Sk w="w-24" h="h-2.5" /><Sk h="h-9" /></div>)}</div> : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Address line 1"><input className={inputCls} value={f.address_lines[0] || ''} onChange={e => set('address_lines', [e.target.value, ...f.address_lines.slice(1)])} /></Field>
            <Field label="Address line 2"><input className={inputCls} value={f.address_lines[1] || ''} onChange={e => set('address_lines', [f.address_lines[0] || '', e.target.value])} /></Field>
            <Field label="City"><input className={inputCls} value={f.locality} onChange={e => set('locality', e.target.value)} /></Field>
            <Field label="State"><input className={inputCls} value={f.administrative_area} onChange={e => set('administrative_area', e.target.value)} /></Field>
            <Field label="Postal code"><input className={inputCls} value={f.postal_code} onChange={e => set('postal_code', e.target.value)} /></Field>
            <Field label="Country code"><input className={inputCls} value={f.region_code} onChange={e => set('region_code', e.target.value.toUpperCase().slice(0, 2))} /></Field>
            <div className="md:col-span-2 rounded-lg bg-slate-50 px-3.5 py-3 text-12.5 text-slate-600">
              <div className="font-semibold text-slate-800 flex items-center gap-1.5"><MapPin size={14} className="text-blue-600" />Map pin</div>
              {b.lat != null && b.lng != null
                ? <p className="mt-1">{Number(b.lat).toFixed(5)}, {Number(b.lng).toFixed(5)} · <a className="text-indigo-600 hover:underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${b.lat},${b.lng}`}>Check it on Google Maps</a></p>
                : <p className="mt-1">Google has not given a pin for this profile yet.</p>}
              <p className="mt-1 text-slate-500">Google places the pin from the address above and updates it after you save. To drag the pin to the exact door, open the profile in Google Maps, choose Edit profile, then Location. Press Sync now afterwards to bring the new pin here.</p>
            </div>
            <div className="md:col-span-2"><ErrorNote>{error}</ErrorNote><Button variant="primary" icon={Save} busy={busy === 'save'} onClick={save}>Save address to Google</Button></div>
          </div>
        )}
      </Linked>
    </Card>
  );
}

/** Attributes Google offers for this profile (yes/no and choice ones), set on Google. */
export function AttributesEditor({ b, toast }) {
  const list = useApi(isLinked(b) ? `/businesses/${b.id}/gbp/attributes` : null);
  const [vals, setVals] = useState({});
  const [busy, error, run] = useAction();
  const save = () => run('save', async () => { await api(`/businesses/${b.id}/gbp/attributes`, { method: 'PUT', body: { values: vals } }); setVals({}); list.reload(true); toast('Attributes updated on your Google Business Profile'); });
  const groups = {};
  (list.data || []).forEach(a => { (groups[a.group || 'Other'] = groups[a.group || 'Other'] || []).push(a); });
  return (
    <Card title="Attributes" subtitle="Accessibility, amenities, payments and more, exactly as Google offers them for your category.">
      <Linked b={b}>
        {!list.data ? (list.error ? <ErrorNote>{list.error.message}</ErrorNote> : <SkList rows={4} avatar={false} />) : list.data.length === 0 ? <p className="text-13 text-slate-500">Google offers no editable attributes for this category.</p> : (
          <div className="space-y-4 max-h-96 overflow-auto pr-1">
            {Object.entries(groups).map(([g, items]) => (
              <div key={g}><div className="text-11 font-semibold text-slate-400 mb-1.5">{g}</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
                  {items.map(a => {
                    const cur = a.id in vals ? vals[a.id] : a.value;
                    return a.type === 'BOOL' ? (
                      <label key={a.id} className="flex items-center gap-2 text-13 text-slate-700"><input type="checkbox" checked={cur === true} onChange={e => setVals(v => ({ ...v, [a.id]: e.target.checked }))} />{a.name}</label>
                    ) : (
                      <label key={a.id} className="flex items-center gap-2 text-13 text-slate-700 justify-between">{a.name}<Select className={`${inputCls} w-44`} value={cur ?? ''} onChange={e => e.target.value && setVals(v => ({ ...v, [a.id]: e.target.value }))}><option value="">—</option>{a.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        <ErrorNote>{error}</ErrorNote>
        {list.data?.length > 0 && <Button className="mt-3" variant="primary" icon={Save} busy={busy === 'save'} disabled={!Object.keys(vals).length} onClick={save}>Save attributes to Google</Button>}
      </Linked>
    </Card>
  );
}

/** A photo thumbnail that tries Google's thumbnail, then the full image, then shows a neutral tile instead of raw alt text. */
function Thumb({ m }) {
  const sources = [m.thumb, m.url].filter(Boolean);
  const [i, setI] = useState(0);
  if (i >= sources.length) return <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-slate-400 text-11 text-center px-2"><Upload size={16} />Photo not available to preview</div>;
  return <img src={sources[i]} alt="" referrerPolicy="no-referrer" loading="lazy" className="w-full h-full object-cover" onError={() => setI(i + 1)} />;
}

/** A video on the profile: plays in place; if the browser cannot play Google's address, the poster opens it in a new tab instead. */
function VideoTile({ m }) {
  const [failed, setFailed] = useState(false);
  if (failed || !m.url) {
    return (
      <a href={m.url || undefined} target="_blank" rel="noreferrer" className="block w-full h-full relative" title="Open the video">
        <Thumb m={m} />
        <span className="absolute inset-0 flex items-center justify-center"><span className="w-10 h-10 rounded-full bg-slate-900/70 text-white flex items-center justify-center"><Play size={18} className="ml-0.5" /></span></span>
      </a>
    );
  }
  return <video controls preload="metadata" playsInline poster={m.thumb || undefined} src={m.url} className="w-full h-full object-cover bg-slate-900" onError={() => setFailed(true)} />;
}

/** Photos on the profile: upload a file, or a public image link, in a Google category; delete any photo. */
export function MediaManager({ b, toast }) {
  const live = useApi(isLinked(b) ? `/businesses/${b.id}/gbp/live` : null);
  const [category, setCategory] = useState('EXTERIOR');
  const [url, setUrl] = useState('');
  const [busy, error, run] = useAction();
  const fileRef = useRef(null);
  const allMedia = live.data?.live?.media || [];
  const [kind, setKind] = useState('all'); // all | photos | videos
  const videos = allMedia.filter(m => m.type === 'VIDEO');
  const media = kind === 'videos' ? videos : kind === 'photos' ? allMedia.filter(m => m.type !== 'VIDEO') : allMedia;
  // A new photo only has its Google address after a sync, so pull the profile again to show it in the grid.
  const refresh = async () => { try { await api(`/businesses/${b.id}/sync`, { method: 'POST' }); } catch (e) { /* the list still reloads */ } live.reload(true); await refreshBusinesses(); };
  const upload = (file) => file && run('up', async () => {
    const video = file.type.startsWith('video/');
    if (!video && !/^image\/(jpeg|png)$/.test(file.type)) throw new Error('Use a JPG or PNG photo, or an MP4 video.');
    if (video && file.type !== 'video/mp4') throw new Error('Videos must be MP4 files.');
    if (file.size > 25 * 1024 * 1024) throw new Error(`${video ? 'Videos' : 'Photos'} must be under 25 MB here. Google itself accepts videos up to 75 MB: compress it, or upload it in Google Maps.`);
    await api(`/businesses/${b.id}/gbp/media`, { method: 'POST', body: { category, data_base64: await readBase64(file), content_type: file.type || 'image/jpeg' } });
    toast(video ? 'Video sent to your Google Business Profile. Google checks videos before showing them.' : 'Photo uploaded to your Google Business Profile'); await refresh();
  });
  const addUrl = () => run('url', async () => { await api(`/businesses/${b.id}/gbp/media`, { method: 'POST', body: { category, url: url.trim() } }); setUrl(''); toast('Photo sent to Google'); await refresh(); });
  const [ask, confirmNode] = useDoubleConfirm();
  const del = (m) => ask({ what: m.type === 'VIDEO' ? 'this video' : `this ${String(m.category || 'photo').replace(/_/g, ' ').toLowerCase()} photo`, effect: 'It is removed from your Google Business Profile and can no longer be shown on Google Search or Maps.', onConfirm: () => run(`d${m.id}`, async () => { await api(`/businesses/${b.id}/gbp/media?name=${encodeURIComponent(m.id)}`, { method: 'DELETE' }); toast('Photo deleted from your Google Business Profile'); live.reload(true); await refreshBusinesses(); }) });
  return (
    <Card title="Manage photos on Google" subtitle="Uploads go straight to the profile. Google may review new photos before showing them.">
      <Linked b={b}>
        {confirmNode}
        <div className="flex flex-wrap gap-2 items-center mb-4">
          <Select className={`${inputCls} w-44`} value={category} onChange={e => setCategory(e.target.value)} aria-label="Photo category">{MEDIA.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,video/mp4" className="hidden" onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }} />
          <Button icon={Upload} busy={busy === 'up'} onClick={() => fileRef.current?.click()}>Upload photo or video</Button>
          <input className={`${inputCls} flex-1 min-w-[200px]`} placeholder="or paste a public image link (https://…)" value={url} onChange={e => setUrl(e.target.value)} />
          <Button busy={busy === 'url'} disabled={!/^https?:\/\//.test(url.trim())} onClick={addUrl}>Add link</Button>
        </div>
        <p className="text-12 text-slate-500 -mt-2 mb-3">Photos: JPG or PNG, 10 KB to 5 MB, at least 250 × 250 px. Videos: MP4, up to 30 seconds, 720p or higher, up to 75 MB on Google (this page uploads up to 25 MB).</p>
        <ErrorNote>{error}</ErrorNote>
        <div className="flex gap-1 mb-3" role="tablist" aria-label="Show">
          {[['all', `All (${allMedia.length})`], ['photos', `Photos (${allMedia.length - videos.length})`], ['videos', `Videos (${videos.length})`]].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={`h-8 px-3 rounded-full text-12.5 font-semibold cursor-pointer ${kind === k ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{l}</button>
          ))}
        </div>
        {media.length === 0 ? <p className="text-13 text-slate-500 py-4 text-center">{kind === 'videos' ? 'No videos on the profile yet.' : kind === 'photos' ? 'No photos on the profile yet.' : 'No photos or videos on the profile yet.'}</p> : (
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            {media.map(m => (
              <div key={m.id} className="group relative aspect-square rounded overflow-hidden bg-slate-100">
                {m.type === 'VIDEO' ? <VideoTile m={m} /> : <Thumb m={m} />}
                {m.type === 'VIDEO' && <span className="absolute left-1 top-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900/70 text-white text-10 font-semibold pointer-events-none"><Play size={9} />Video</span>}
                <span className="absolute left-1 bottom-1 px-1.5 py-0.5 rounded bg-slate-900/70 text-white text-10 font-semibold pointer-events-none">{String(m.category || (m.type === 'VIDEO' ? 'video' : 'photo')).replace(/_/g, ' ').toLowerCase()}</span>
                <button type="button" aria-label={m.type === 'VIDEO' ? 'Delete video' : 'Delete photo'} title="Delete this from Google" onClick={() => del(m)} className="absolute right-1 top-1 w-7 h-7 rounded-full bg-white shadow text-slate-600 hover:text-red-600 flex items-center justify-center cursor-pointer">{busy === `d${m.id}` ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}</button>
              </div>
            ))}
          </div>
        )}
      </Linked>
    </Card>
  );
}

const LIVE_CTA = { BOOK: 'Book', ORDER: 'Order online', SHOP: 'Shop', LEARN_MORE: 'Learn more', SIGN_UP: 'Sign up', CALL: 'Call now' };
const todayStr = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** The form for a post that is already live: its text, button and (for offers and events) its dates. Saved straight to Google. */
function LivePostEditor({ b, post, onClose, onSaved }) {
  const dated = post.type === 'OFFER' || post.type === 'EVENT';
  const event = post.type === 'EVENT';
  const [f, setF] = useState(() => ({ summary: post.summary || '', cta_type: LIVE_CTA[post.cta] ? post.cta : '', cta_url: post.cta_url || '', title: post.title || '', starts_on: post.starts_on || '', ends_on: post.ends_on || '', start_time: post.start_time || '', end_time: post.end_time || '' }));
  const [busy, error, run] = useAction();
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const problem = (() => {
    if (!f.summary.trim()) return 'The post needs some text.';
    if (f.cta_type && f.cta_type !== 'CALL' && !/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(f.cta_url.trim())) return 'The button needs a link that starts with https://';
    if (dated && (f.starts_on || f.ends_on)) {
      if (!f.title.trim()) return 'Give it a title: Google keeps the dates together with the title.';
      if (event && !(f.starts_on && f.ends_on)) return 'An event needs a start date and an end date.';
      if (f.starts_on && f.ends_on && f.ends_on < f.starts_on) return 'The end date cannot be before the start date.';
      if (f.ends_on && f.ends_on < todayStr()) return 'The end date is already in the past.';
    }
    return '';
  })();
  const save = () => run('save', async () => {
    const body = { name: post.id, summary: f.summary.trim(), cta_type: f.cta_type || null, cta_url: f.cta_type && f.cta_type !== 'CALL' ? f.cta_url.trim() : null };
    if (dated && (f.starts_on || f.ends_on)) Object.assign(body, { title: f.title.trim(), starts_on: f.starts_on || null, ends_on: f.ends_on || null, ...(event ? { start_time: f.start_time || null, end_time: f.end_time || null } : {}) });
    await api(`/businesses/${b.id}/gbp/live-post`, { method: 'PATCH', body });
    onSaved();
  });
  return (
    <Modal open title="Edit post on Google" onClose={onClose} width="max-w-xl" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={Save} busy={busy === 'save'} disabled={Boolean(problem)} onClick={save}>Save to Google</Button></>}>
      <div className="space-y-4">
        <div className="flex items-center gap-2"><Badge tone="blue">{String(post.type || 'post').toLowerCase()}</Badge>{post.image && <img src={post.image} alt="" referrerPolicy="no-referrer" className="w-10 h-10 rounded object-cover" />}<span className="text-12 text-slate-500">The picture can't be changed on a live post. Delete the post and make a new one to change it.</span></div>
        {dated && <Field label="Title"><input className={inputCls} value={f.title} maxLength={58} onChange={e => set('title', e.target.value)} /></Field>}
        <Field label="Post text" counter={<span className="text-slate-400">{f.summary.length}/1500</span>}><textarea rows={6} className={areaCls} value={f.summary} onChange={e => set('summary', e.target.value.slice(0, 1500))} /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Button"><Select className={inputCls} value={f.cta_type} onChange={e => set('cta_type', e.target.value)} aria-label="Button"><option value="">No button</option>{Object.entries(LIVE_CTA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          {f.cta_type && f.cta_type !== 'CALL' && <Field label="Button link"><input className={inputCls} value={f.cta_url} onChange={e => set('cta_url', e.target.value)} placeholder="https://" /></Field>}
        </div>
        {dated && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg ring-1 ring-slate-200 p-3">
            <Field label="Starts on"><input type="date" className={inputCls} max={todayStr(365)} value={f.starts_on} onChange={e => set('starts_on', e.target.value)} /></Field>
            <Field label="Ends on"><input type="date" className={inputCls} min={f.starts_on || undefined} max={todayStr(365)} value={f.ends_on} onChange={e => set('ends_on', e.target.value)} /></Field>
            {event && <><Field label="Start time"><input type="time" className={inputCls} value={f.start_time} onChange={e => set('start_time', e.target.value)} /></Field><Field label="End time"><input type="time" className={inputCls} value={f.end_time} onChange={e => set('end_time', e.target.value)} /></Field></>}
          </div>
        )}
        {problem && <p className="text-12.5 text-red-600">{problem}</p>}
        <ErrorNote>{error}</ErrorNote>
      </div>
    </Modal>
  );
}

/** Posts already on Google (including ones made outside this software): edit or remove them. Writing new posts is in the composer above. */
export function LivePosts({ b, toast }) {
  const live = useApi(isLinked(b) ? `/businesses/${b.id}/gbp/live` : null);
  const [busy, error, run] = useAction();
  const posts = live.data?.live?.posts || [];
  const [editing, setEditing] = useState(null);
  const [ask, confirmNode] = useDoubleConfirm();
  const del = (p) => ask({ what: 'this post', effect: 'It is removed from your Google Business Profile, so customers will no longer see it.', onConfirm: () => run(`d${p.id}`, async () => { await api(`/businesses/${b.id}/gbp/live-post?name=${encodeURIComponent(p.id)}`, { method: 'DELETE' }); toast('Post deleted from Google'); live.reload(true); }) });
  if (!isLinked(b)) return null;
  return (
    <Card title={`Live on Google (${posts.length})`} subtitle="Posts currently on the profile">
      {confirmNode}
      {editing && <LivePostEditor b={b} post={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); toast('Post updated on Google'); live.reload(true); }} />}
      <ErrorNote>{error}</ErrorNote>
      {posts.length === 0 ? <p className="text-13 text-slate-500 py-3 text-center">No posts on Google yet.</p> : (
        <ul className="divide-y divide-slate-100">{posts.map(p => (
          <li key={p.id} className="py-2.5 flex items-start gap-3"><BusinessAvatar name={b.name} src={b.logo} size="w-8 h-8" /><div className="min-w-0 flex-1"><div className="flex gap-1.5 items-center"><Badge tone="blue">{String(p.type || 'post').toLowerCase()}</Badge><Badge tone={p.state === 'LIVE' ? 'green' : 'amber'}>{String(p.state || '').toLowerCase()}</Badge></div><p className="text-13 text-slate-700 mt-1 line-clamp-2">{p.summary || p.title}</p></div>
            <button type="button" aria-label="Edit post" title="Edit this post" onClick={() => setEditing(p)} className="p-1 text-slate-400 hover:text-indigo-600 cursor-pointer"><Pencil size={14} /></button>
            <button type="button" aria-label="Delete post" onClick={() => del(p)} className="p-1 text-slate-400 hover:text-red-600 cursor-pointer">{busy === `d${p.id}` ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}</button></li>
        ))}</ul>
      )}
    </Card>
  );
}
