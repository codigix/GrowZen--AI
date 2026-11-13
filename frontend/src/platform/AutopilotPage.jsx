import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Calendar, Check, CheckCircle2, Clock, Image as ImageIcon, Inbox, Loader2, MessageSquare, Play, RefreshCw, Settings as SettingsIcon, ShieldCheck, Sparkles, Star, TrendingUp, Undo2, Upload, User, X, XCircle } from 'lucide-react';
import { SeoShell, Button } from './SeoUi';
import Select from '../components/Select';
import { api, SEO_API } from './seoApi';

const arr = (v) => (Array.isArray(v) ? v : []);
const when = (iso) => { if (!iso) return 'no time set'; const t = new Date(iso); return Number.isNaN(t.getTime()) ? '—' : t.toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }); };
const toInput = (iso) => { if (!iso) return ''; const t = new Date(iso); if (Number.isNaN(t.getTime())) return ''; const p = (n) => String(n).padStart(2, '0'); return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}T${p(t.getHours())}:${p(t.getMinutes())}`; };
const fromInput = (v) => (v ? new Date(v).toISOString() : null);
const Card = ({ children, className = '' }) => <section className={`bg-white rounded-xl border border-slate-200 shadow-sm min-w-0 ${className}`}>{children}</section>;
const Chip = ({ children, cls = 'bg-slate-100 text-slate-700' }) => <span className={`inline-flex items-center gap-1 text-12 rounded-full px-2.5 py-1 leading-none font-medium whitespace-nowrap ${cls}`}>{children}</span>;
const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
const KIND = { gbp_post: ['Google post', 'bg-indigo-50 text-indigo-700', Calendar], review_reply: ['Review reply', 'bg-amber-50 text-amber-700', MessageSquare], profile_edit: ['Profile rewrite', 'bg-violet-50 text-violet-700', User], gbp_photo: ['Photo', 'bg-emerald-50 text-emerald-700', ImageIcon] };
const SHOTS = ['Storefront from the street, in daylight, with the whole sign visible', 'The inside: a wide shot from the entrance', 'Your best 5 products or pieces of work, each well lit', 'The team at work (with their permission)', 'Before and after, if it applies', 'The opening-hours sign and the street number'];
const TABS = [['inbox', 'Needs approval', Inbox], ['schedule', 'Schedule', Calendar], ['photos', 'Photos', ImageIcon], ['settings', 'Settings', SettingsIcon], ['results', 'Results', TrendingUp]];

function ItemCard({ it, bid, onChanged }) {
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
        {pending && it.kind === 'profile_edit' && <Button size="sm" variant="primary" icon={busy === 'a' ? Loader2 : Check} disabled={!!busy} onClick={() => { if (window.confirm('Apply this to your profile (and to Google, if it is linked)?')) run('approve', {}, 'a'); }}>Approve and apply</Button>}
        {pending && <Button size="sm" icon={busy === 'r' ? Loader2 : XCircle} disabled={!!busy} onClick={() => run('reject', {}, 'r')}>Reject</Button>}
        {it.status === 'scheduled' && <Button size="sm" icon={busy === 'u' ? Loader2 : Undo2} disabled={!!busy} onClick={() => run('unschedule', {}, 'u')}>Take back (do not send)</Button>}
        {it.status === 'failed' && it.approved_by && <Button size="sm" variant="primary" icon={busy === 'y' ? Loader2 : RefreshCw} disabled={!!busy} onClick={() => run('retry', {}, 'y')}>Try again</Button>}
      </div>
    </article>
  );
}

function InboxView({ d, bid, onChanged, onGenerate, generating, note }) {
  const posts = d.inbox.filter(i => i.kind === 'gbp_post');
  const [bulk, setBulk] = useState(false);
  const approveAll = async () => {
    if (!window.confirm(`Approve these ${posts.length} posts, each for its own time? They go out only at those times, and you can take any back before then.`)) return;
    setBulk(true);
    try { await api(`/businesses/${bid}/autopilot/approve-posts`, { method: 'POST', body: { ids: posts.map(p => p.id) } }); await onChanged(); } finally { setBulk(false); }
  };
  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[240px]"><h3 className="text-15 font-semibold text-slate-900">{d.counts.inbox ? `${d.counts.inbox} item${d.counts.inbox === 1 ? '' : 's'} wait for you` : 'Nothing waits for you'}</h3>
            <p className="text-12.5 text-slate-500">Read, edit if you like, then approve. Only what you approve is sent, and only at the time you choose.</p></div>
          <div className="flex flex-wrap gap-2">
            {posts.length > 1 && d.linked && <Button icon={bulk ? Loader2 : Check} disabled={bulk} onClick={approveAll}>Approve all {posts.length} posts at their times</Button>}
            <Button variant="primary" icon={generating ? Loader2 : Sparkles} disabled={generating || !d.ai_ready} onClick={() => onGenerate('all')}>{generating ? 'Preparing…' : 'Prepare drafts now'}</Button>
          </div>
        </div>
        {!d.ai_ready && <p className="mt-3 text-13 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">AI is not set up on this server, so drafts cannot be written. Add an AI key in the server settings.</p>}
        {note && <p className="mt-3 text-13 text-slate-700 bg-slate-50 rounded-lg px-3 py-2" role="status">{note}</p>}
      </Card>
      {d.inbox.length === 0 ? <Card className="p-8 text-center text-13 text-slate-500"><CheckCircle2 size={28} className="mx-auto text-emerald-500 mb-2" />All caught up. {d.settings.enabled ? 'Autopilot prepares the next drafts at its next run.' : 'Switch Autopilot on in Settings to have drafts prepared for you every day.'}</Card>
        : d.inbox.map(it => <ItemCard key={`${it.id}-${it.status}`} it={it} bid={bid} onChanged={onChanged} />)}
    </div>
  );
}

function Schedule({ d, bid, onChanged }) {
  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5"><h3 className="text-15 font-semibold text-slate-900">Approved and waiting for their time</h3><p className="text-12.5 text-slate-500">Each one goes out at its time, because you approved it. Take one back and nothing is sent.</p></Card>
      {d.scheduled.length === 0 ? <Card className="p-6 text-center text-13 text-slate-500">Nothing is scheduled.</Card> : d.scheduled.map(it => <ItemCard key={it.id} it={it} bid={bid} onChanged={onChanged} />)}
      <Card className="p-4 sm:p-5">
        <h3 className="text-15 font-semibold text-slate-900 mb-2">Recently</h3>
        {d.recent.length === 0 ? <p className="text-13 text-slate-500">Nothing has been sent or decided yet.</p> : (
          <ul className="divide-y divide-slate-100">{d.recent.map(it => (
            <li key={it.id} className="py-2.5 flex flex-wrap items-center gap-2 text-13"><Chip cls={(KIND[it.kind] || KIND.gbp_post)[1]}>{(KIND[it.kind] || KIND.gbp_post)[0]}</Chip><span className="min-w-0 flex-1 text-slate-700 truncate">{it.title}</span>
              {it.status === 'applied' && <span className="text-emerald-700 flex items-center gap-1"><CheckCircle2 size={13} />Sent</span>}{it.status === 'rejected' && <span className="text-slate-500">Rejected</span>}
              {it.status === 'failed' && <span className="text-red-700">Failed: {it.result?.error || ''}</span>}{it.status === 'handoff' && <span className="text-slate-500">Needs a person</span>}</li>))}</ul>
        )}
      </Card>
    </div>
  );
}

function Photos({ d, bid, onChanged }) {
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
  const queued = d.inbox.filter(i => i.kind === 'gbp_photo').length;
  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <h3 className="text-15 font-semibold text-slate-900 flex items-center gap-2"><ImageIcon size={16} className="text-indigo-600" />Photo scheduler</h3>
        <p className="mt-1 text-13 text-slate-600">Upload real photos of your business (up to 6 at a time). Each gets the next free photo day from your settings and waits in “Needs approval”. Nothing is uploaded to Google until you approve it.</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div><label className="text-12 font-semibold text-slate-700 block mb-1">Photo type</label>
            <Select className="h-10 w-56 rounded-lg border border-slate-300 bg-white px-3 text-14" aria-label="Photo type" value={cat} onChange={e => setCat(e.target.value)}>
              {['ADDITIONAL', 'EXTERIOR', 'INTERIOR', 'PRODUCT', 'AT_WORK', 'TEAMS', 'FOOD_AND_DRINK', 'COVER', 'PROFILE'].map(c => <option key={c} value={c}>{c.replaceAll('_', ' ').toLowerCase().replace(/^./, s => s.toUpperCase())}</option>)}
            </Select></div>
          <input ref={input} type="file" accept="image/*" multiple className="sr-only" id="ap-files" onChange={pick} />
          <Button variant="primary" icon={busy ? Loader2 : Upload} disabled={busy || queued >= 12} onClick={() => input.current?.click()}>{busy ? 'Uploading…' : 'Choose photos'}</Button>
        </div>
        {msg && <p className="mt-3 text-13 text-slate-700 bg-slate-50 rounded-lg px-3 py-2" role="status">{msg}</p>}
        <p className="mt-3 text-12 text-slate-500">{queued} photo{queued === 1 ? '' : 's'} wait for approval (at most 12). Use your own photos: stock images and logos with text on them do not help.</p>
      </Card>
      <Card className="p-4 sm:p-5"><h3 className="text-15 font-semibold text-slate-900 mb-2">What to photograph</h3><ol className="list-decimal pl-5 space-y-1 text-13.5 text-slate-700">{SHOTS.map((s, i) => <li key={i}>{s}</li>)}</ol>
        <p className="mt-2 text-12.5 text-slate-500">Landscape, steady, daylight, no filters. Two or three new photos a week keeps the profile fresh.</p></Card>
      {d.inbox.filter(i => i.kind === 'gbp_photo').map(it => <ItemCard key={it.id} it={it} bid={bid} onChanged={onChanged} />)}
    </div>
  );
}

function SettingsView({ d, bid, onChanged }) {
  const [f, setF] = useState(d.settings);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const toggleDay = (k, day) => set(k, f[k].includes(day) ? f[k].filter(x => x !== day) : [...f[k], day]);
  const save = async () => {
    setBusy(true); setMsg('');
    try { await api(`/businesses/${bid}/autopilot/settings`, { method: 'PUT', body: f, repeat: true }); setMsg('Saved.'); await onChanged(); } catch (e) { setMsg(e.message || 'Could not save.'); } finally { setBusy(false); }
  };
  const Switch = ({ k, label, hint }) => <label className="flex items-start gap-3 cursor-pointer"><input type="checkbox" checked={!!f[k]} onChange={e => set(k, e.target.checked)} className="mt-1 w-4 h-4 accent-indigo-600" /><span><span className="text-14 font-medium text-slate-800">{label}</span><span className="block text-12 text-slate-500">{hint}</span></span></label>;
  const Days = ({ k }) => <div className="flex flex-wrap gap-1.5">{DAYS.map(([v, l]) => <button key={v} type="button" aria-pressed={f[k].includes(v)} onClick={() => toggleDay(k, v)} className={`h-8 px-3 rounded-full text-13 border cursor-pointer ${f[k].includes(v) ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}</div>;
  const nums = [0, 1, 2, 3];
  return (
    <div className="space-y-4 max-w-3xl">
      <Card className="p-5">
        <Switch k="enabled" label="Autopilot is on" hint="Every day it prepares drafts for you. It never publishes anything: every item waits in “Needs approval”." />
        <div className="mt-3 text-12.5 text-slate-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex gap-2"><ShieldCheck size={15} className="text-emerald-600 mt-0.5 shrink-0" />{d.rule} This cannot be switched off.</div>
      </Card>
      <Card className="p-5 space-y-4">
        <h3 className="text-15 font-semibold text-slate-900">Google posts</h3>
        <div className="flex flex-wrap gap-4 items-end">
          <div><label className="text-12 font-semibold text-slate-700 block mb-1">Drafts per week</label><Select className="h-10 w-28 rounded-lg border border-slate-300 bg-white px-3 text-14" aria-label="Posts per week" value={String(f.posts_per_week)} onChange={e => set('posts_per_week', Number(e.target.value))}>{nums.map(n => <option key={n} value={n}>{n === 0 ? 'Off' : n}</option>)}</Select></div>
          <div><label className="text-12 font-semibold text-slate-700 block mb-1" htmlFor="pt">Proposed time</label><input id="pt" type="time" value={f.post_time} onChange={e => set('post_time', e.target.value)} className="h-10 rounded-lg border border-slate-300 px-3 text-14" /></div>
        </div>
        <div><div className="text-12 font-semibold text-slate-700 mb-1">Proposed days</div><Days k="post_days" /></div>
        <p className="text-12 text-slate-500">Three a week is the most: more looks like spam. Times are in {d.timezone}.</p>
      </Card>
      <Card className="p-5 space-y-3">
        <h3 className="text-15 font-semibold text-slate-900">Reviews and profile</h3>
        <Switch k="replies" label="Write a reply for every review that waits" hint="Drafts only. You approve each reply before it is posted." />
        <Switch k="profile" label="Suggest a profile rewrite once a month" hint="A better description and extra services. Your own services are never removed. You approve before anything changes." />
        <div className="max-w-xs"><label className="text-12 font-semibold text-slate-700 block mb-1" htmlFor="lang">Language of replies and posts</label><input id="lang" value={f.language} onChange={e => set('language', e.target.value)} maxLength={30} className="h-10 w-full rounded-lg border border-slate-300 px-3 text-14" /></div>
      </Card>
      <Card className="p-5 space-y-4">
        <h3 className="text-15 font-semibold text-slate-900">Photo days</h3>
        <div className="flex flex-wrap gap-4 items-end">
          <div><label className="text-12 font-semibold text-slate-700 block mb-1">Photos per week</label><Select className="h-10 w-28 rounded-lg border border-slate-300 bg-white px-3 text-14" aria-label="Photos per week" value={String(f.photos_per_week)} onChange={e => set('photos_per_week', Number(e.target.value))}>{nums.map(n => <option key={n} value={n}>{n === 0 ? 'Off' : n}</option>)}</Select></div>
          <div><label className="text-12 font-semibold text-slate-700 block mb-1" htmlFor="pht">Proposed time</label><input id="pht" type="time" value={f.photo_time} onChange={e => set('photo_time', e.target.value)} className="h-10 rounded-lg border border-slate-300 px-3 text-14" /></div>
        </div>
        <div><div className="text-12 font-semibold text-slate-700 mb-1">Days photos are proposed for</div><Days k="photo_days" /></div>
      </Card>
      <div className="flex items-center gap-3"><Button variant="primary" busy={busy} onClick={save}>Save settings</Button>{msg && <span className="text-13 text-slate-700" role="status">{msg}</span>}</div>
    </div>
  );
}

function Results({ d }) {
  const r = d.results;
  const Delta = ({ a, b }) => { const diff = a - b; return <span className={`text-12 tabular-nums ${diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-red-600' : 'text-slate-400'}`}>{diff > 0 ? '+' : ''}{diff} vs the 30 days before</span>; };
  return (
    <div className="space-y-4">
      <Card className="p-5"><h3 className="text-15 font-semibold text-slate-900 mb-3">What was sent in the last 30 days (all approved by you)</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[['Posts', r.sent.gbp_post], ['Review replies', r.sent.review_reply], ['Photos', r.sent.gbp_photo], ['Profile rewrites', r.sent.profile_edit]].map(([l, v]) => <div key={l} className="rounded-xl border border-slate-200 p-3.5"><div className="text-12 text-slate-500">{l}</div><div className="text-22 font-semibold text-slate-900 tabular-nums">{v || 0}</div></div>)}</div></Card>
      <Card className="p-5"><h3 className="text-15 font-semibold text-slate-900 mb-1">Performance on Google (last 30 days)</h3>
        {!r.has_insights ? <p className="text-13 text-slate-500">No performance data yet. It appears after the Google profile is linked and synced.</p> : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">{[['Views', 'views'], ['Calls', 'calls'], ['Directions', 'directions'], ['Website clicks', 'website_clicks']].map(([l, k]) => <div key={k} className="rounded-xl border border-slate-200 p-3.5"><div className="text-12 text-slate-500">{l}</div><div className="text-22 font-semibold text-slate-900 tabular-nums">{r.now[k]}</div><Delta a={r.now[k]} b={r.before[k]} /></div>)}</div>)}
        <p className="mt-3 text-12 text-slate-500">These are Google's own numbers. They show what happened, not what Autopilot caused.</p></Card>
      <Card className="p-5"><h3 className="text-15 font-semibold text-slate-900 mb-1">Reviews</h3><p className="text-14 text-slate-700">{r.reviews.total ?? '—'} reviews{r.reviews.rating ? `, rated ${r.reviews.rating}` : ''}. {r.reviews.unanswered} still without a reply.</p>
        <Link to="/gmb-profile/reviews" className="text-13 font-semibold text-indigo-600 hover:underline">Open Reviews</Link></Card>
    </div>
  );
}

function Autopilot({ b }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [note, setNote] = useState('');
  const [tab, setTab] = useState(() => { const h = (typeof window !== 'undefined' ? window.location.hash : '').replace('#', ''); return TABS.some(t => t[0] === h) ? h : 'inbox'; });
  const load = useCallback(async () => { try { setD(await api(`/businesses/${b.id}/autopilot`)); setError(''); } catch (e) { setError(e.message || 'Could not load Autopilot.'); } }, [b.id]);
  useEffect(() => { setD(null); load(); }, [load]);
  const pick = (id) => { setTab(id); try { window.history.replaceState(null, '', `#${id}`); } catch { /* optional */ } };
  const generate = async (what) => {
    setGenerating(true); setNote('');
    try {
      const r = await api(`/businesses/${b.id}/autopilot/generate`, { method: 'POST', body: { what }, timeout: 170000 });
      setNote(Object.entries(r).map(([k, v]) => `${k}: ${v.made} new${v.note ? ` (${v.note})` : ''}`).join(' · '));
      await load();
    } catch (e) { setNote(e.message || 'Could not prepare drafts.'); } finally { setGenerating(false); }
  };
  if (error && !d) return <Card className="p-6 text-13 text-red-700">{error} <button type="button" className="font-semibold underline cursor-pointer" onClick={load}>Try again</button></Card>;
  if (!d) return <div className="space-y-4" role="status" aria-busy="true"><div className="h-20 rounded-xl bg-slate-100 animate-pulse" /><div className="h-64 rounded-xl bg-slate-100 animate-pulse" /></div>;
  return (
    <div className="space-y-5 min-w-0">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-600 inline-flex items-center justify-center shrink-0"><ShieldCheck size={18} /></span>
          <div className="flex-1 min-w-[240px]"><div className="text-15 font-semibold text-slate-900">Autopilot is {d.settings.enabled ? 'on' : 'off'}{d.settings.enabled && d.next_run ? <span className="text-12 font-normal text-slate-500"> · next run {when(d.next_run)}</span> : null}</div>
            <p className="text-13 text-slate-600">{d.rule}</p></div>
          <Button icon={SettingsIcon} onClick={() => pick('settings')}>{d.settings.enabled ? 'Settings' : 'Switch on'}</Button>
        </div>
        {!d.linked && <p className="mt-3 text-13 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex gap-2"><AlertTriangle size={15} className="mt-0.5 shrink-0" />The Google Business Profile is not linked, so nothing can be published yet. Drafts are still prepared. <Link to="/gmb-profile/profile" className="font-semibold underline">Link it</Link></p>}
      </Card>
      <div className="sticky top-2 z-20 bg-white rounded-xl border border-slate-200 shadow-sm">
        <div role="tablist" aria-label="Autopilot views" className="flex flex-nowrap overflow-x-auto px-2" style={{ scrollbarWidth: 'none' }}>
          {TABS.map(([id, label, Icon]) => { const on = tab === id; const n = id === 'inbox' ? d.counts.inbox : id === 'schedule' ? d.counts.scheduled : 0;
            return <button key={id} type="button" role="tab" aria-selected={on} onClick={() => pick(id)} className={`shrink-0 h-12 px-4 inline-flex items-center gap-2 text-14 whitespace-nowrap border-b-2 cursor-pointer ${on ? 'border-indigo-600 text-indigo-700 font-semibold' : 'border-transparent text-slate-600 hover:text-slate-900'}`}><Icon size={15} className="opacity-70" />{label}{n > 0 && <span className={`text-12 font-semibold tabular-nums rounded-full px-1.5 py-0.5 leading-none ${on ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>{n}</span>}</button>; })}
        </div>
      </div>
      <div key={tab} role="tabpanel">
        {tab === 'inbox' && <InboxView d={d} bid={b.id} onChanged={load} onGenerate={generate} generating={generating} note={note} />}
        {tab === 'schedule' && <Schedule d={d} bid={b.id} onChanged={load} />}
        {tab === 'photos' && <Photos d={d} bid={b.id} onChanged={load} />}
        {tab === 'settings' && <SettingsView key={JSON.stringify(d.settings)} d={d} bid={b.id} onChanged={load} />}
        {tab === 'results' && <Results d={d} />}
      </div>
    </div>
  );
}

export default function AutopilotPage() {
  return (
    <SeoShell title="Autopilot" subtitle="Posts, review replies, profile improvements and photos prepared for you. You approve every item before anything reaches Google.">
      {(b) => <Autopilot key={b.id} b={b} />}
    </SeoShell>
  );
}
