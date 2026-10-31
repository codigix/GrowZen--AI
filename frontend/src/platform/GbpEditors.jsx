import React, { useEffect, useRef, useState } from 'react';
import { Search, X, Upload, Trash2, Save, Loader2, Pencil } from 'lucide-react';
import { Card, Button, Field, ErrorNote, inputCls, Modal, Badge, useAction, refreshBusinesses } from './SeoUi';
import { api, useApi } from './seoApi';

/** True when the client's profile is linked to Google, so edits here are written to Google. */
export const isLinked = (b) => Boolean(b.gbp_location && b.connection_id);

const MEDIA = [['EXTERIOR', 'Exterior'], ['INTERIOR', 'Interior'], ['TEAMS', 'Team'], ['PRODUCT', 'Product'], ['AT_WORK', 'At work'], ['COVER', 'Cover photo'], ['PROFILE', 'Logo / profile'], ['ADDITIONAL', 'Other']];

const readBase64 = (file) => new Promise((resolve, reject) => {
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
            <select className={`${inputCls} w-40`} value={target} onChange={e => setTarget(e.target.value)} aria-label="Set as"><option value="primary">Set primary</option><option value="extra">Add additional</option></select>
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
        {!f ? <div className="py-4 flex justify-center text-slate-400"><Loader2 size={16} className="animate-spin" /></div> : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Address line 1"><input className={inputCls} value={f.address_lines[0] || ''} onChange={e => set('address_lines', [e.target.value, ...f.address_lines.slice(1)])} /></Field>
            <Field label="Address line 2"><input className={inputCls} value={f.address_lines[1] || ''} onChange={e => set('address_lines', [f.address_lines[0] || '', e.target.value])} /></Field>
            <Field label="City"><input className={inputCls} value={f.locality} onChange={e => set('locality', e.target.value)} /></Field>
            <Field label="State"><input className={inputCls} value={f.administrative_area} onChange={e => set('administrative_area', e.target.value)} /></Field>
            <Field label="Postal code"><input className={inputCls} value={f.postal_code} onChange={e => set('postal_code', e.target.value)} /></Field>
            <Field label="Country code"><input className={inputCls} value={f.region_code} onChange={e => set('region_code', e.target.value.toUpperCase().slice(0, 2))} /></Field>
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
        {!list.data ? (list.error ? <ErrorNote>{list.error.message}</ErrorNote> : <div className="py-4 flex justify-center text-slate-400"><Loader2 size={16} className="animate-spin" /></div>) : list.data.length === 0 ? <p className="text-13 text-slate-500">Google offers no editable attributes for this category.</p> : (
          <div className="space-y-4 max-h-96 overflow-auto pr-1">
            {Object.entries(groups).map(([g, items]) => (
              <div key={g}><div className="text-11 font-semibold text-slate-400 mb-1.5">{g}</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
                  {items.map(a => {
                    const cur = a.id in vals ? vals[a.id] : a.value;
                    return a.type === 'BOOL' ? (
                      <label key={a.id} className="flex items-center gap-2 text-13 text-slate-700"><input type="checkbox" checked={cur === true} onChange={e => setVals(v => ({ ...v, [a.id]: e.target.checked }))} />{a.name}</label>
                    ) : (
                      <label key={a.id} className="flex items-center gap-2 text-13 text-slate-700 justify-between">{a.name}<select className={`${inputCls} w-44`} value={cur ?? ''} onChange={e => e.target.value && setVals(v => ({ ...v, [a.id]: e.target.value }))}><option value="">—</option>{a.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
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

/** Photos on the profile: upload a file, or a public image link, in a Google category; delete any photo. */
export function MediaManager({ b, toast }) {
  const live = useApi(isLinked(b) ? `/businesses/${b.id}/gbp/live` : null);
  const [category, setCategory] = useState('EXTERIOR');
  const [url, setUrl] = useState('');
  const [busy, error, run] = useAction();
  const fileRef = useRef(null);
  const media = live.data?.live?.media || [];
  const upload = (file) => file && run('up', async () => {
    if (file.size > 25 * 1024 * 1024) throw new Error('Photos must be under 25 MB');
    await api(`/businesses/${b.id}/gbp/media`, { method: 'POST', body: { category, data_base64: await readBase64(file), content_type: file.type || 'image/jpeg' } });
    toast('Photo uploaded to your Google Business Profile'); live.reload(true); await refreshBusinesses();
  });
  const addUrl = () => run('url', async () => { await api(`/businesses/${b.id}/gbp/media`, { method: 'POST', body: { category, url: url.trim() } }); setUrl(''); toast('Photo sent to Google'); live.reload(true); await refreshBusinesses(); });
  const del = (m) => window.confirm('Delete this photo from your Google Business Profile?') && run(`d${m.id}`, async () => { await api(`/businesses/${b.id}/gbp/media?name=${encodeURIComponent(m.id)}`, { method: 'DELETE' }); toast('Photo deleted'); live.reload(true); await refreshBusinesses(); });
  return (
    <Card title="Manage photos on Google" subtitle="Uploads go straight to the profile. Google may review new photos before showing them.">
      <Linked b={b}>
        <div className="flex flex-wrap gap-2 items-center mb-4">
          <select className={`${inputCls} w-44`} value={category} onChange={e => setCategory(e.target.value)} aria-label="Photo category">{MEDIA.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,video/mp4" className="hidden" onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }} />
          <Button icon={Upload} busy={busy === 'up'} onClick={() => fileRef.current?.click()}>Upload photo</Button>
          <input className={`${inputCls} flex-1 min-w-[200px]`} placeholder="or paste a public image link (https://…)" value={url} onChange={e => setUrl(e.target.value)} />
          <Button busy={busy === 'url'} disabled={!/^https?:\/\//.test(url.trim())} onClick={addUrl}>Add link</Button>
        </div>
        <ErrorNote>{error}</ErrorNote>
        {media.length === 0 ? <p className="text-13 text-slate-500 py-4 text-center">No photos on the profile yet.</p> : (
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            {media.map(m => (
              <div key={m.id} className="group relative aspect-square rounded overflow-hidden bg-slate-100">
                <img src={m.thumb || m.url} alt={m.category || 'Photo'} loading="lazy" className="w-full h-full object-cover" />
                <span className="absolute left-1 bottom-1 px-1.5 py-0.5 rounded bg-slate-900/70 text-white text-10 font-semibold">{String(m.category || 'photo').replace(/_/g, ' ').toLowerCase()}</span>
                <button type="button" aria-label="Delete photo" onClick={() => del(m)} className="absolute right-1 top-1 w-7 h-7 rounded-full bg-white/90 text-slate-600 hover:text-red-600 flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 cursor-pointer">{busy === `d${m.id}` ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}</button>
              </div>
            ))}
          </div>
        )}
      </Linked>
    </Card>
  );
}

/** Posts already on Google (including ones made outside this software): remove them. Writing posts is in the composer above. */
export function LivePosts({ b, toast }) {
  const live = useApi(isLinked(b) ? `/businesses/${b.id}/gbp/live` : null);
  const [busy, error, run] = useAction();
  const posts = live.data?.live?.posts || [];
  const del = (p) => window.confirm('Delete this post from your Google Business Profile?') && run(`d${p.id}`, async () => { await api(`/businesses/${b.id}/gbp/live-post?name=${encodeURIComponent(p.id)}`, { method: 'DELETE' }); toast('Post deleted from Google'); live.reload(true); });
  if (!isLinked(b)) return null;
  return (
    <Card title={`Live on Google (${posts.length})`} subtitle="Posts currently on the profile">
      <ErrorNote>{error}</ErrorNote>
      {posts.length === 0 ? <p className="text-13 text-slate-500 py-3 text-center">No posts on Google yet.</p> : (
        <ul className="divide-y divide-slate-100">{posts.map(p => (
          <li key={p.id} className="py-2.5 flex items-start gap-3"><div className="min-w-0 flex-1"><div className="flex gap-1.5 items-center"><Badge tone="blue">{String(p.type || 'post').toLowerCase()}</Badge><Badge tone={p.state === 'LIVE' ? 'green' : 'amber'}>{String(p.state || '').toLowerCase()}</Badge></div><p className="text-13 text-slate-700 mt-1 line-clamp-2">{p.summary || p.title}</p></div>
            <button type="button" aria-label="Delete post" onClick={() => del(p)} className="p-1 text-slate-400 hover:text-red-600 cursor-pointer">{busy === `d${p.id}` ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}</button></li>
        ))}</ul>
      )}
    </Card>
  );
}
