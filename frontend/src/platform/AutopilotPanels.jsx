import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Calendar, Check, CheckCircle2, Clock, Image as ImageIcon, Loader2, MessageSquare, Play, RefreshCw, Settings as SettingsIcon, ShieldCheck, Sparkles, Search, Star, Undo2, Upload, User, X, XCircle } from 'lucide-react';
import { SeoShell, Button } from './SeoUi';
import Select from '../components/Select';
import { api, useApi, SEO_API } from './seoApi';
import DataTable from './DataTable';

const arr = (v) => (Array.isArray(v) ? v : []);
const when = (iso) => { if (!iso) return 'no time set'; const t = new Date(iso); return Number.isNaN(t.getTime()) ? '—' : t.toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }); };
const toInput = (iso) => { if (!iso) return ''; const t = new Date(iso); if (Number.isNaN(t.getTime())) return ''; const p = (n) => String(n).padStart(2, '0'); return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}T${p(t.getHours())}:${p(t.getMinutes())}`; };
const fromInput = (v) => (v ? new Date(v).toISOString() : null);
const Card = ({ children, className = '' }) => <section className={`bg-white rounded-xl border border-slate-200 shadow-sm min-w-0 ${className}`}>{children}</section>;
const Chip = ({ children, cls = 'bg-slate-100 text-slate-700' }) => <span className={`inline-flex items-center gap-1 text-12 rounded-full px-2.5 py-1 leading-none font-medium whitespace-nowrap ${cls}`}>{children}</span>;
const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
const KIND = { keyword_add: ['Keyword', 'bg-sky-50 text-sky-700', Search], gbp_post: ['Google post', 'bg-indigo-50 text-indigo-700', Calendar], review_reply: ['Review reply', 'bg-amber-50 text-amber-700', MessageSquare], profile_edit: ['Profile rewrite', 'bg-violet-50 text-violet-700', User], gbp_photo: ['Photo', 'bg-emerald-50 text-emerald-700', ImageIcon] };
const SHOTS = ['Storefront from the street, in daylight, with the whole sign visible', 'The inside: a wide shot from the entrance', 'Your best 5 products or pieces of work, each well lit', 'The team at work (with their permission)', 'Before and after, if it applies', 'The opening-hours sign and the street number'];

export function ItemCard({ it, bid, onChanged }) {
  const [text, setText] = useState(it.text || it.changes?.description || '');
  const [at, setAt] = useState(toInput(it.publish_at));
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const k = KIND[it.kind] || KIND.gbp_post;
  const Icon = k[2];
  const base = `/businesses/${bid}/autopilot/items/${it.id}`;
  const run = async (path, body, label) => {
    setBusy(label); setErr('');
    try {
      if (it.status === 'pending' && (it.kind === 'gbp_post' || it.kind === 'review_reply' || it.kind === 'profile_edit') && path !== 'reject' && ((it.kind !== 'profile_edit' && text !== (it.text || '')) || (it.kind === 'profile_edit' && text !== (it.changes?.description || '')))) {
        await api(base, { method: 'PATCH', body: it.kind === 'profile_edit' ? { description: text } : { text }, repeat: true });
      }
      await api(`${base}/${path}`, { method: 'POST', body: body || {} });
      await onChanged();
    } catch (e) { setErr(e.message || 'That did not work.'); } finally { setBusy(''); }
  };
  const pending = it.status === 'pending';
  const [photo, setPhoto] = useState(it.image_url || '');
  const [pick, setPick] = useState(false);
  const live = useApi(pick ? `/businesses/${bid}/gbp/live` : null);
  const fileRef = useRef(null);
  const setImage = async (url, label) => {
    setBusy(label); setErr('');
    try { await api(base, { method: 'PATCH', body: { image_url: url }, repeat: true }); setPhoto(url); setPick(false); }
    catch (e) { setErr(e.message || 'That did not work.'); } finally { setBusy(''); }
  };
  const upload = async (file) => { // the picture goes to the profile's photos first: Google accepts a post photo only from there
    if (!file) return;
    setBusy('up'); setErr('');
    try {
      const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });
      const made = await api(`/businesses/${bid}/gbp/media`, { method: 'POST', body: { category: 'ADDITIONAL', data_base64: data, content_type: file.type || 'image/jpeg' } });
      if (!made.googleUrl) throw new Error('Google has not returned the picture address yet. Try again in a minute.');
      await setImage(made.googleUrl, 'up');
    } catch (e) { setErr(e.message || 'That did not work.'); setBusy(''); }
  };
  const mapsPhoto = /\/(gpu-csl|places)\//.test(photo);
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2 mb-3"><Chip cls={k[1]}><Icon size={12} />{k[0]}</Chip>
        {it.source === 'autopilot' && <Chip cls="bg-violet-50 text-violet-700"><Sparkles size={11} />Prepared by Autopilot</Chip>}
        {it.status === 'scheduled' && <Chip cls="bg-emerald-50 text-emerald-700"><Clock size={11} />Approved by {it.approved_by} · goes out {when(it.publish_at)}</Chip>}
        {it.status === 'failed' && <Chip cls="bg-red-50 text-red-700">Failed</Chip>}
        {it.topic && <span className="text-12 text-slate-500">Topic: {it.topic}</span>}</div>

      {it.kind === 'review_reply' && it.review && (
        <div className="mb-3 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5 text-13">
          <div className="flex items-center gap-1.5 text-slate-700 font-medium">{it.review.author || 'A customer'} <span className="inline-flex items-center text-amber-500">{Array.from({ length: it.review.rating || 0 }).map((_, i) => <Star key={i} size={12} fill="currentColor" />)}</span></div>
          <p className="mt-1 text-slate-600">{it.review.text || '(rating only, no text)'}</p>
        </div>
      )}
      {it.kind === 'keyword_add' && <div className="mb-3"><div className="text-15 font-semibold text-slate-900">{it.keyword}</div><p className="text-13 text-slate-600 mt-0.5">{it.reason}</p></div>}
      {it.kind === 'gbp_photo' && <div className="mb-3 flex gap-3 items-start"><img src={`${SEO_API}${it.preview}`} alt={it.name} className="w-40 h-28 object-cover rounded-lg border border-slate-200 bg-slate-50" loading="lazy" /><div className="text-13 text-slate-600"><div className="font-medium text-slate-800 break-all">{it.name}</div><div>{it.category} · {it.width}×{it.height}px</div></div></div>}
      {it.kind === 'profile_edit' && (
        <div className="mb-3 space-y-3 text-13">
          {it.changes?.description && <div className="grid md:grid-cols-2 gap-3"><div><div className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1">Now</div><p className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-slate-600 whitespace-pre-wrap">{it.before?.description || '(empty)'}</p></div>
            <div><div className="text-12 font-semibold uppercase tracking-wide text-indigo-600 mb-1">Proposed (editable)</div></div></div>}
          {arr(it.added_services).length > 0 && <div><div className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1">Services that would be added (yours stay)</div><ul className="space-y-1">{it.added_services.map((s, i) => <li key={i} className="text-slate-700"><b>{s.name}</b>: {s.description}</li>)}</ul></div>}
        </div>
      )}
      {(it.kind === 'gbp_post' || it.kind === 'review_reply' || (it.kind === 'profile_edit' && it.changes?.description)) && (
        <>
          {it.headline && <div className="text-14 font-semibold text-slate-900 mb-1">{it.headline}</div>}
          <textarea value={text} onChange={e => setText(e.target.value.slice(0, 1500))} disabled={!pending} rows={it.kind === 'review_reply' ? 3 : 5} aria-label="Text" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-14 text-slate-900 leading-relaxed disabled:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          <div className="text-11 text-slate-400 text-right">{text.length} characters</div>
        </>
      )}
      {it.kind === 'gbp_post' && (
        <div className="mt-3">
          <div className="text-12 font-semibold text-slate-700 mb-1">Photo</div>
          <div className="flex flex-wrap items-start gap-3">
            {photo ? <img src={photo} alt="Post photo" className="w-36 h-28 object-cover rounded-lg border border-slate-200 bg-slate-50" loading="lazy" /> : <div className="w-36 h-28 rounded-lg border border-dashed border-slate-300 flex items-center justify-center text-12 text-slate-400 text-center px-2">No photo: the post goes out as text</div>}
            {pending && (
              <div className="space-y-1.5">
                <input ref={fileRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }} />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={!!busy} icon={busy === 'up' ? Loader2 : Upload} onClick={() => fileRef.current?.click()}>Upload a photo</Button>
                  <Button size="sm" disabled={!!busy} onClick={() => setPick(v => !v)}>{pick ? 'Hide profile photos' : 'Choose from profile photos'}</Button>
                  {photo && <Button size="sm" disabled={!!busy} icon={busy === 'rm' ? Loader2 : XCircle} onClick={() => setImage('', 'rm')}>Remove photo</Button>}
                </div>
                {mapsPhoto && <p className="text-12 text-amber-700 max-w-md">This is a Google Maps photo link. Google often refuses it for posts. Upload your own photo or choose one from the profile.</p>}
                <p className="text-11.5 text-slate-500">JPG or PNG. An uploaded photo is also added to the profile's photos.</p>
              </div>
            )}
          </div>
          {pick && pending && (
            <div className="mt-2">{!live.data ? <p className="text-12 text-slate-400">Loading profile photos…</p> : (() => { const ph = (live.data?.live?.media || []).filter(m => m.type !== 'VIDEO' && m.url).slice(0, 18); return ph.length === 0 ? <p className="text-12 text-slate-400">No photos on the profile yet: upload one.</p> : (
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">{ph.map(m => <button key={m.id || m.url} type="button" onClick={() => setImage(m.url, 'pk')} className="aspect-square rounded overflow-hidden ring-1 ring-slate-200 hover:ring-indigo-400 cursor-pointer"><img src={m.url} alt="" className="w-full h-full object-cover" loading="lazy" /></button>)}</div>); })()}</div>
          )}
        </div>
      )}
      {(it.kind === 'gbp_post' || it.kind === 'gbp_photo') && pending && (
        <div className="mt-2"><label className="text-12 font-semibold text-slate-700 block mb-1" htmlFor={`at-${it.id}`}>Goes out on (your device's time)</label>
          <input id={`at-${it.id}`} type="datetime-local" value={at} onChange={e => setAt(e.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-14" /></div>
      )}
      {err && <p className="mt-2 text-13 text-red-700" role="alert">{err}</p>}
      {it.status === 'failed' && <p className="mt-2 text-13 text-red-700">{it.result?.error || 'It could not be sent.'}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {pending && (it.kind === 'gbp_post' || it.kind === 'gbp_photo') && <>
          <Button size="sm" variant="primary" icon={busy === 'a' ? Loader2 : Check} disabled={!!busy} onClick={() => run('approve', { publish_at: fromInput(at) }, 'a')}>Approve and schedule</Button>
          <Button size="sm" icon={busy === 'n' ? Loader2 : Play} disabled={!!busy} onClick={() => { if (window.confirm('Publish this to Google right now?')) run('approve', { now: true }, 'n'); }}>Publish now</Button></>}
        {pending && it.kind === 'review_reply' && <Button size="sm" variant="primary" icon={busy === 'a' ? Loader2 : Check} disabled={!!busy} onClick={() => run('approve', {}, 'a')}>Approve and post the reply</Button>}
        {pending && it.kind === 'keyword_add' && <Button size="sm" variant="primary" icon={busy === 'a' ? Loader2 : Check} disabled={!!busy} onClick={() => run('approve', {}, 'a')}>Approve: track this keyword</Button>}
        {pending && it.kind === 'profile_edit' && <Button size="sm" variant="primary" icon={busy === 'a' ? Loader2 : Check} disabled={!!busy} onClick={() => { if (window.confirm('Apply this to your profile (and to Google, if it is linked)?')) run('approve', {}, 'a'); }}>Approve and apply</Button>}
        {pending && <Button size="sm" icon={busy === 'r' ? Loader2 : XCircle} disabled={!!busy} onClick={() => run('reject', {}, 'r')}>Reject</Button>}
        {it.status === 'scheduled' && <Button size="sm" icon={busy === 'u' ? Loader2 : Undo2} disabled={!!busy} onClick={() => run('unschedule', {}, 'u')}>Take back (do not send)</Button>}
        {it.status === 'failed' && it.approved_by && <Button size="sm" variant="primary" icon={busy === 'y' ? Loader2 : RefreshCw} disabled={!!busy} onClick={() => run('retry', {}, 'y')}>Try again</Button>}
      </div>
    </article>
  );
}

const KW_STATUS = { pending: ['Waiting for you', 'bg-amber-50 text-amber-700'], scheduled: ['Approved', 'bg-emerald-50 text-emerald-700'], applied: ['Done', 'bg-emerald-50 text-emerald-700'], rejected: ['Rejected', 'bg-slate-100 text-slate-600'], failed: ['Failed', 'bg-red-50 text-red-700'] };

/** The keyword suggestions as one data table: what is suggested and why, where it stands, and the buttons for the ones that wait. */
function KeywordItemsTable({ items, bid, onChanged }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const act = async (it, what) => {
    setBusy(`${it.id}-${what}`); setErr('');
    try { await api(`/businesses/${bid}/autopilot/items/${it.id}/${what}`, { method: 'POST', body: {} }); await onChanged(); } catch (e) { setErr(e.message || 'That did not work.'); } finally { setBusy(''); }
  };
  const label = (it) => (KW_STATUS[it.status] || [it.status, 'bg-slate-100 text-slate-600'])[0];
  return (
    <Card>
      {err && <p className="px-4 pt-3 text-13 text-red-700" role="alert">{err}</p>}
      <DataTable bare rows={items} rowKey={it => it.id} pageSize={10} exportName="keyword-suggestions" label="suggestions" searchPlaceholder="Search suggestions" minWidth={620} columnsMenu={false}
        initialSort={{ key: 'status', dir: 'asc' }}
        empty="Nothing waits for you here."
        filters={[{ id: 'status', label: 'Status', options: [...new Set(items.map(label))].map(x => [x, x]), test: (it, v) => label(it) === v }]}
        columns={[
          { id: 'keyword', header: 'Keyword and why', value: it => it.keyword || '', className: 'px-4 py-3 min-w-[240px]', thClass: 'px-4 py-3', cell: it => <><div className="text-14 font-semibold text-slate-900">{it.keyword}</div>{it.reason && <div className="text-12.5 text-slate-600 mt-0.5">{it.reason}</div>}</> },
          { id: 'status', header: 'Status', value: it => ({ pending: 0, scheduled: 1, failed: 2, applied: 3, rejected: 4 })[it.status] ?? 5, className: 'px-3 py-3 whitespace-nowrap', cell: it => <Chip cls={(KW_STATUS[it.status] || [0, 'bg-slate-100 text-slate-600'])[1]}>{label(it)}</Chip> },
          { id: 'act', header: 'Actions', right: true, className: 'px-4 py-3 text-right whitespace-nowrap', thClass: 'px-4 py-3',
            cell: it => (it.status === 'pending' ? <span className="inline-flex gap-2"><Button size="sm" variant="primary" icon={busy === `${it.id}-approve` ? Loader2 : Check} disabled={Boolean(busy)} onClick={() => act(it, 'approve')}>Track it</Button><Button size="sm" icon={busy === `${it.id}-reject` ? Loader2 : XCircle} disabled={Boolean(busy)} onClick={() => act(it, 'reject')}>Reject</Button></span> : <span className="text-slate-300">—</span>) }
        ]} />
    </Card>
  );
}

const FEATURES = {
  posts: { title: 'Scheduled Google posts', kinds: ['gbp_post'], what: 'posts', hint: 'Drafts are written for the days and time you choose. You edit, approve and schedule each one; it goes out only at its time.' },
  replies: { title: 'Review replies', kinds: ['review_reply'], what: 'replies', hint: 'A reply is drafted for every review that waits. A reply is posted only after you approve it.' },
  photos: { title: 'Photo scheduler', kinds: ['gbp_photo'], what: null, hint: 'Upload your own photos: each gets the next free photo day and is uploaded to Google only after you approve it.' },
  profile: { title: 'Profile improvements', kinds: ['profile_edit'], what: 'profile', hint: 'Once a month a better description and extra services are suggested. Nothing changes until you approve, and your own services are never removed.' },
  keywords: { title: 'Keyword suggestions', kinds: ['keyword_add'], what: 'keywords', hint: 'Searches your website is about, and ones competitors win, are suggested every week. A keyword is tracked only after you approve it.' }
};

function PhotoUploader({ bid, onChanged, queued }) {
  const [cat, setCat] = useState('ADDITIONAL');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const input = useRef(null);
  const read = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res({ name: f.name, data: r.result, category: cat }); r.onerror = rej; r.readAsDataURL(f); });
  const pick = async (e) => {
    const files = [...(e.target.files || [])].slice(0, 6);
    if (!files.length) return;
    setBusy(true); setMsg('');
    try {
      const out = await api(`/businesses/${bid}/autopilot/photos`, { method: 'POST', body: { files: await Promise.all(files.map(read)) }, timeout: 180000 });
      setMsg(`${out.added.length} photo${out.added.length === 1 ? '' : 's'} queued. ${arr(out.errors).join(' ')}`);
      await onChanged();
    } catch (er) { setMsg(er.message || 'The upload did not work.'); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="text-12.5 font-semibold text-slate-700" htmlFor="phototype">Photo type</label>
        <Select id="phototype" className="h-9 w-44 rounded-lg border border-slate-300 bg-white px-3 text-13" aria-label="Photo type" value={cat} onChange={e => setCat(e.target.value)}>
          {['ADDITIONAL', 'EXTERIOR', 'INTERIOR', 'PRODUCT', 'AT_WORK', 'TEAMS', 'FOOD_AND_DRINK', 'COVER', 'PROFILE'].map(c => <option key={c} value={c}>{c.replaceAll('_', ' ').toLowerCase().replace(/^./, s => s.toUpperCase())}</option>)}
        </Select>
        <input ref={input} type="file" accept="image/*" multiple className="sr-only" onChange={pick} />
        <Button size="sm" variant="primary" icon={busy ? Loader2 : Upload} disabled={busy || queued >= 12} onClick={() => input.current?.click()}>{busy ? 'Uploading…' : 'Choose photos (up to 6)'}</Button>
        <span className="text-12 text-slate-500 underline decoration-dotted cursor-help" title={SHOTS.map((s, i) => `${i + 1}. ${s}`).join(' | ')}>What to photograph</span>
        {queued > 0 && <span className="text-12 text-slate-500 ml-auto">{queued} waiting for approval</span>}
      </div>
      {msg && <p className="mt-2 text-13 text-slate-700 bg-slate-50 rounded-lg px-3 py-2" role="status">{msg}</p>}
    </div>
  );
}

function PanelSettings({ feature, d, bid, onChanged }) {
  const [f, setF] = useState(d.settings);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const toggleDay = (k, day) => set(k, f[k].includes(day) ? f[k].filter(x => x !== day) : [...f[k], day]);
  const save = async () => {
    setBusy(true); setMsg('');
    try { await api(`/businesses/${bid}/autopilot/settings`, { method: 'PUT', body: f, repeat: true }); setMsg('Saved.'); await onChanged(); } catch (e) { setMsg(e.message || 'Could not save.'); } finally { setBusy(false); }
  };
  const Days = ({ k }) => <div className="flex flex-wrap gap-1.5">{DAYS.map(([v, l]) => <button key={v} type="button" aria-pressed={f[k].includes(v)} onClick={() => toggleDay(k, v)} className={`h-8 px-3 rounded-full text-13 border cursor-pointer ${f[k].includes(v) ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}</div>;
  const nums = [0, 1, 2, 3];
  const Check1 = ({ k, label }) => <label className="flex items-center gap-2.5 text-14 text-slate-800 cursor-pointer"><input type="checkbox" checked={!!f[k]} onChange={e => set(k, e.target.checked)} className="w-4 h-4 accent-indigo-600" />{label}</label>;
  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-4">
      {feature === 'posts' && <>
        <div className="flex flex-wrap gap-4 items-end">
          <div><label className="text-12 font-semibold text-slate-700 block mb-1">Drafts per week</label><Select className="h-10 w-28 rounded-lg border border-slate-300 bg-white px-3 text-14" aria-label="Posts per week" value={String(f.posts_per_week)} onChange={e => set('posts_per_week', Number(e.target.value))}>{nums.map(n => <option key={n} value={n}>{n === 0 ? 'Off' : n}</option>)}</Select></div>
          <div><label className="text-12 font-semibold text-slate-700 block mb-1" htmlFor="pt">Proposed time</label><input id="pt" type="time" value={f.post_time} onChange={e => set('post_time', e.target.value)} className="h-10 rounded-lg border border-slate-300 px-3 text-14" /></div>
        </div>
        <div><div className="text-12 font-semibold text-slate-700 mb-1">Proposed days</div><Days k="post_days" /></div>
        <p className="text-12 text-slate-500">Three a week is the most. Times are in {d.timezone}.</p></>}
      {feature === 'replies' && <><Check1 k="replies" label="Write a reply draft for every review that waits" />
        <div className="max-w-xs"><label className="text-12 font-semibold text-slate-700 block mb-1" htmlFor="lang">Language of replies</label><input id="lang" value={f.language} onChange={e => set('language', e.target.value)} maxLength={30} className="h-10 w-full rounded-lg border border-slate-300 px-3 text-14" /></div></>}
      {feature === 'photos' && <>
        <div className="flex flex-wrap gap-4 items-end">
          <div><label className="text-12 font-semibold text-slate-700 block mb-1">Photos per week</label><Select className="h-10 w-28 rounded-lg border border-slate-300 bg-white px-3 text-14" aria-label="Photos per week" value={String(f.photos_per_week)} onChange={e => set('photos_per_week', Number(e.target.value))}>{nums.map(n => <option key={n} value={n}>{n === 0 ? 'Off' : n}</option>)}</Select></div>
          <div><label className="text-12 font-semibold text-slate-700 block mb-1" htmlFor="pht">Proposed time</label><input id="pht" type="time" value={f.photo_time} onChange={e => set('photo_time', e.target.value)} className="h-10 rounded-lg border border-slate-300 px-3 text-14" /></div>
        </div>
        <div><div className="text-12 font-semibold text-slate-700 mb-1">Days photos are proposed for</div><Days k="photo_days" /></div></>}
      {feature === 'profile' && <Check1 k="profile" label="Suggest a profile rewrite once a month" />}
      {feature === 'keywords' && <Check1 k="keywords" label="Suggest keywords to track every week" />}
      <div className="flex items-center gap-3"><Button size="sm" variant="primary" busy={busy} onClick={save}>Save</Button>{msg && <span className="text-13 text-slate-700" role="status">{msg}</span>}</div>
    </div>
  );
}

/** The scheduler of one feature, placed on that feature's own page. Everything it prepares waits for approval. */
/** How many drafts of this kind wait for the owner's approval (the same filter the panel uses). */
export function waitingFor(d, feature) {
  const cfg = FEATURES[feature];
  return cfg ? (d?.inbox || []).filter(i => cfg.kinds.includes(i.kind) && (feature !== 'profile' || i.source === 'autopilot')).length : 0;
}

export function AutopilotPanel({ bid, feature, hideItems = false, onChanged }) {
  const cfg = FEATURES[feature];
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [note, setNote] = useState('');
  const [showSet, setShowSet] = useState(false);
  const [bulk, setBulk] = useState(false);
  const load = useCallback(async () => { try { setD(await api(`/businesses/${bid}/autopilot`)); setError(''); } catch (e) { setError(e.message || 'Could not load.'); } }, [bid]);
  useEffect(() => { setD(null); load(); }, [load]);
  if (error && !d) return <Card className="p-4 text-13 text-red-700">{error} <button type="button" className="font-semibold underline cursor-pointer" onClick={load}>Try again</button></Card>;
  if (!d) return <div className="h-24 rounded-xl bg-slate-100 animate-pulse" role="status" aria-busy="true" />;
  const mine = (i) => cfg.kinds.includes(i.kind) && (feature !== 'profile' || i.source === 'autopilot');
  const inbox = d.inbox.filter(mine), scheduled = d.scheduled.filter(mine), recent = d.recent.filter(mine).slice(0, 8);
  const posts = inbox.filter(i => i.kind === 'gbp_post');
  const on = d.settings.enabled;
  const slim = hideItems || feature === 'photos'; // the photo scheduler keeps its header on one line and holds the upload row inside the same card
  const flip = async () => { try { await api(`/businesses/${bid}/autopilot/settings`, { method: 'PUT', body: { enabled: !on }, repeat: true }); await load(); onChanged?.(); } catch (e) { setNote(e.message); } };
  const generate = async () => {
    setGenerating(true); setNote('');
    try { const r = await api(`/businesses/${bid}/autopilot/generate`, { method: 'POST', body: { what: cfg.what }, timeout: 170000 }); onChanged?.(); setNote(Object.values(r).map(v => (v.made ? `${v.made} new draft${v.made === 1 ? '' : 's'} ready below.` : v.note || 'Nothing new right now.')).join(' ')); await load(); }
    catch (e) { setNote(e.message || 'Could not prepare drafts.'); } finally { setGenerating(false); }
  };
  const approveAll = async () => {
    if (!window.confirm(`Approve these ${posts.length} posts, each for its own time? They go out only at those times, and you can take any back before then.`)) return;
    setBulk(true);
    try { await api(`/businesses/${bid}/autopilot/approve-posts`, { method: 'POST', body: { ids: posts.map(p => p.id) } }); await load(); } finally { setBulk(false); }
  };
  return (
    <section className="space-y-3" aria-label={cfg.title}>
      <Card className={slim ? 'px-4 py-2.5' : 'p-4 sm:p-5'}>
        <div className="flex flex-wrap items-center gap-3">
          <span className={`${slim ? 'w-8 h-8' : 'w-10 h-10'} rounded-full bg-indigo-50 text-indigo-600 inline-flex items-center justify-center shrink-0`} title={slim ? d.rule : undefined}><ShieldCheck size={slim ? 15 : 18} /></span>
          <div className="flex-1 min-w-[240px]"><div className="text-15 font-semibold text-slate-900 flex flex-wrap items-center gap-2" title={slim && feature !== 'photos' ? cfg.hint : undefined}>{cfg.title}<Chip cls={on ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}>Autopilot {on ? 'on' : 'off'}</Chip></div>
            {hideItems ? (note ? <p className="text-12.5 text-slate-700" role="status">{note}</p> : null) : <p className="text-12.5 text-slate-600">{cfg.hint}</p>}</div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={flip}>{on ? 'Turn off' : 'Turn on'}</Button>
            {cfg.what && <Button size="sm" variant="primary" icon={generating ? Loader2 : Sparkles} disabled={generating || !d.ai_ready} onClick={generate}>{generating ? 'Preparing…' : 'Prepare drafts now'}</Button>}
            <Button size="sm" icon={SettingsIcon} onClick={() => setShowSet(s => !s)} aria-expanded={showSet}>Settings</Button>
          </div>
        </div>
        {!slim && <p className="mt-2 text-12 text-slate-500 flex items-center gap-1.5"><ShieldCheck size={12} className="text-emerald-600" />{d.rule}</p>}
        {on && !hideItems && d.next_run && <p className="mt-1 text-12 text-slate-500">Next automatic run: {when(d.next_run)}.</p>}
        {!d.ai_ready && cfg.what && <p className="mt-2 text-13 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">AI is not set up on this server, so drafts cannot be written.</p>}
        {!d.linked && feature !== 'keywords' && <p className="mt-2 text-13 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex gap-2"><AlertTriangle size={15} className="mt-0.5 shrink-0" />The Google Business Profile is not linked, so nothing can be published yet. Drafts are still prepared.</p>}
        {note && !hideItems && <p className="mt-2 text-13 text-slate-700 bg-slate-50 rounded-lg px-3 py-2" role="status">{note}</p>}
        {showSet && <PanelSettings feature={feature} d={d} bid={bid} onChanged={load} />}
        {feature === 'photos' && !hideItems && <PhotoUploader bid={bid} onChanged={load} queued={inbox.length} />}
      </Card>
      {hideItems ? null : <>
      {posts.length > 1 && d.linked && <div><Button size="sm" icon={bulk ? Loader2 : Check} disabled={bulk} onClick={approveAll}>Approve all {posts.length} posts at their times</Button></div>}
      {feature === 'keywords' ? ((inbox.length + scheduled.length + recent.length) > 0 && <KeywordItemsTable items={[...inbox, ...scheduled, ...d.recent.filter(mine)]} bid={bid} onChanged={load} />) : <>
      {inbox.length > 0 && <div className="space-y-3"><div className="text-13 font-semibold text-slate-900">{inbox.length} waiting for your approval</div>{inbox.map(it => <ItemCard key={`${it.id}-${it.status}`} it={it} bid={bid} onChanged={load} />)}</div>}
      {scheduled.length > 0 && <div className="space-y-3"><div className="text-13 font-semibold text-slate-900">Approved and scheduled</div>{scheduled.map(it => <ItemCard key={`${it.id}-${it.status}`} it={it} bid={bid} onChanged={load} />)}</div>}
      {recent.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-white px-4 py-3"><summary className="text-13 font-semibold text-slate-800 cursor-pointer">Recently decided ({recent.length})</summary>
          <ul className="mt-2 divide-y divide-slate-100">{recent.map(it => <li key={it.id} className="py-2 flex flex-wrap items-center gap-2 text-13"><span className="min-w-0 flex-1 text-slate-700 truncate">{it.title}</span>
            {it.status === 'applied' && <span className="text-emerald-700 flex items-center gap-1"><CheckCircle2 size={13} />Done</span>}{it.status === 'rejected' && <span className="text-slate-500">Rejected</span>}{it.status === 'failed' && <span className="text-red-700">Failed: {it.result?.error || ''}</span>}</li>)}</ul></details>
      )}
      {inbox.length === 0 && scheduled.length === 0 && (feature !== 'photos' || on) && <p className="text-13 text-slate-500">Nothing waits for you here. {on ? 'The next drafts appear after the next automatic run, or press “Prepare drafts now”.' : 'Turn Autopilot on to have drafts prepared for you every day.'}</p>}
      </>}
      {feature === 'keywords' && inbox.length === 0 && scheduled.length === 0 && recent.length === 0 && <p className="text-13 text-slate-500">Nothing waits for you here. {on ? 'The next suggestions appear after the next automatic run, or press “Prepare” above.' : 'Turn it on, or press “Prepare” above.'}</p>}
      </>}
    </section>
  );
}
