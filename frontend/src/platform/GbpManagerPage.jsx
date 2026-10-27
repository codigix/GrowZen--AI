import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { CheckCircle2, Circle, Sparkles, Plus, Trash2, Image as ImageIcon, Send, Copy, Phone, Globe, MapPin, Loader2, Save } from 'lucide-react';
import { SeoShell, Card, Tabs, ScoreRing, Meter, StatusPill, Badge, Button, Modal, Field, inputCls, areaCls, ChartTooltip, Legend, ErrorNote, SERIES, INK, scoreWord, useToast, useAction, useSeoBusiness, refreshBusinesses } from './SeoUi';
import { ConnectModal, ConnectionsBar, ConnectEmptyState } from './GbpConnect';
import { api, useApi, fmtDate } from './seoApi';

const CTA = { BOOK: 'Book', ORDER: 'Order online', LEARN_MORE: 'Learn more', SIGN_UP: 'Sign up', CALL: 'Call now' };
const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const STUFFED = /[|]|\s-\s|\bbest\b|\bcheap\b|no\.?\s?1|\btop\s/i;

function AuditTab({ b, onEditProfile }) {
  const s = useApi(`/businesses/${b.id}/gbp/score`);
  if (!s.data) return s.error ? <ErrorNote>{s.error.message}</ErrorNote> : <div className="py-10 flex justify-center text-gray-400"><Loader2 size={16} className="animate-spin" /></div>;
  const d = s.data;
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div className="space-y-4">
        <Card title="Profile score" subtitle="Google ranks local results on relevance, distance and prominence">
          <div className="flex items-center gap-5">
            <ScoreRing score={d.score} label={scoreWord(d.score)} />
            <div className="flex-1 space-y-2.5">
              {[['Relevance', d.factors.relevance], ['Distance', d.factors.distance], ['Prominence', d.factors.prominence]].map(([n, v], i) => (
                <div key={n}><div className="flex justify-between text-[12px] mb-1"><span className="text-gray-600">{n}</span><span className="font-medium">{v}/100</span></div><Meter value={v} color={SERIES[i]} /></div>
              ))}
            </div>
          </div>
        </Card>
        {d.alerts.length > 0 && (
          <Card title="Alerts"><div className="space-y-2">{d.alerts.map(a => <div key={a.text} className="text-[12px] text-gray-700"><StatusPill level={a.level}>{a.level === 'critical' ? 'Critical' : 'Warning'}</StatusPill> <span className="ml-1">{a.text}</span></div>)}</div></Card>
        )}
        <Card title="Google link">
          <div className="space-y-1.5 text-[13px]">
            <div className="flex justify-between"><span className="text-gray-500">Linked profile</span><span className="text-gray-900">{b.gbp_location || 'Not linked'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Verification</span><span>{b.verification === 'verified' ? <StatusPill level="good">Verified</StatusPill> : b.verification === 'unknown' ? <Badge>Unknown</Badge> : <StatusPill level="critical">{b.verification}</StatusPill>}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Reviews / rating</span><span className="text-gray-900">{b.reviewCount} · {b.rating ?? '—'}★</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Photos</span><span className="text-gray-900">{b.photo_count ?? '—'}</span></div>
          </div>
        </Card>
      </div>
      <Card title="Profile checklist" subtitle="Sorted by impact: category, reviews, proximity, website, then activity." className="xl:col-span-2" action={<Button size="sm" onClick={onEditProfile}>Edit profile</Button>}>
        <div className="divide-y divide-gray-100">
          {[...d.items].sort((a, c) => (c.weight * (1 - c.score)) - (a.weight * (1 - a.score))).map(i => (
            <div key={i.key} className="flex items-start gap-3 py-2.5">
              {i.ok ? <CheckCircle2 size={16} className="text-emerald-600 mt-0.5 shrink-0" /> : <Circle size={16} className="text-gray-300 mt-0.5 shrink-0" />}
              <div className="flex-1 min-w-0"><div className="text-[13px] text-gray-900">{i.label}</div>{!i.ok && <div className="text-[12px] text-gray-500 mt-0.5">{i.fix}</div>}</div>
              <Badge tone="gray">{i.factor}</Badge>
              <span className="w-16 text-right text-[12px] tabular-nums text-gray-600">{Number((i.weight * i.score).toFixed(1))}/{i.weight}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function ProfileTab({ b, toast }) {
  const [p, setP] = useState(() => ({ name: b.name, primary_category: b.primary_category || '', secondary_categories: b.secondary_categories || [], phone: b.phone || '', website: b.website || '', address: b.address || '', area: b.area || '', city: b.city || '', description: b.description || '', services: b.services || [], attributes: b.attributes || [], booking_url: b.booking_url || '', lat: b.lat ?? '', lng: b.lng ?? '' }));
  const [attr, setAttr] = useState('');
  const [busy, error, run] = useAction();
  const set = (k, v) => setP(x => ({ ...x, [k]: v }));
  const save = () => run('save', async () => {
    await api(`/businesses/${b.id}`, { method: 'PATCH', body: { ...p, lat: p.lat === '' ? null : Number(p.lat), lng: p.lng === '' ? null : Number(p.lng), services: p.services.filter(s => s.name) } });
    await refreshBusinesses();
    toast('Saved. Edits to the live Google profile go through approval.');
  });
  const aiDesc = () => run('ai', async () => { const r = await api(`/businesses/${b.id}/ai/description`, { method: 'POST' }); set('description', r.text); toast('AI draft from your profile: check it, then save'); });
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <Card title="Business information" className="xl:col-span-2">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Business name" hint="The real name on your signage. No keywords or city names.">
            <input className={inputCls} value={p.name} onChange={e => set('name', e.target.value)} />
            {STUFFED.test(p.name) && <div className="mt-1"><StatusPill level="warning">Looks keyword-stuffed: a common cause of suspension</StatusPill></div>}
          </Field>
          <Field label="Primary category"><input className={inputCls} value={p.primary_category} onChange={e => set('primary_category', e.target.value)} /></Field>
          <Field label="Secondary categories" hint="Comma separated"><input className={inputCls} value={p.secondary_categories.join(', ')} onChange={e => set('secondary_categories', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} /></Field>
          <Field label="Phone"><input className={inputCls} value={p.phone} onChange={e => set('phone', e.target.value)} /></Field>
          <Field label="Website (landing page)"><input className={inputCls} value={p.website} onChange={e => set('website', e.target.value)} placeholder="https://" /></Field>
          <Field label="Booking link"><input className={inputCls} value={p.booking_url} onChange={e => set('booking_url', e.target.value)} placeholder="https://" /></Field>
          <Field label="Address"><input className={inputCls} value={p.address} onChange={e => set('address', e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Area"><input className={inputCls} value={p.area} onChange={e => set('area', e.target.value)} /></Field><Field label="City"><input className={inputCls} value={p.city} onChange={e => set('city', e.target.value)} /></Field></div>
          <div className="grid grid-cols-2 gap-2"><Field label="Map pin latitude"><input className={inputCls} value={p.lat} onChange={e => set('lat', e.target.value)} /></Field><Field label="Longitude"><input className={inputCls} value={p.lng} onChange={e => set('lng', e.target.value)} /></Field></div>
        </div>
        <div className="mt-3">
          <Field label="Description" counter={<span className="text-gray-400">{p.description.length}/750</span>} hint="Aim for 600-750 characters. No URLs, phone numbers or promotions.">
            <textarea rows={5} className={areaCls} value={p.description} onChange={e => set('description', e.target.value.slice(0, 750))} />
          </Field>
          <Button className="mt-2" variant="ai" icon={Sparkles} busy={busy === 'ai'} onClick={aiDesc}>Write with AI</Button>
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2"><span className="text-[12px] text-gray-600">Services and prices</span><Button size="sm" icon={Plus} onClick={() => set('services', [...p.services, { name: '', price: '', description: '' }])}>Add service</Button></div>
          <div className="space-y-2">
            {p.services.map((s, i) => (
              <div key={i} className="grid grid-cols-12 gap-2">
                <input className={`${inputCls} col-span-4`} placeholder="Service" value={s.name || ''} onChange={e => set('services', p.services.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                <input className={`${inputCls} col-span-2`} placeholder="Price" value={s.price || ''} onChange={e => set('services', p.services.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} />
                <input className={`${inputCls} col-span-5`} placeholder="One-line description" value={s.description || ''} onChange={e => set('services', p.services.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} />
                <button onClick={() => set('services', p.services.filter((_, j) => j !== i))} className="col-span-1 flex items-center justify-center text-gray-400 hover:text-red-600 cursor-pointer" aria-label="Remove"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-4">
          <span className="text-[12px] text-gray-600">Attributes</span>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {p.attributes.map(a => <span key={a} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-gray-100 text-[12px] text-gray-700">{a}<button onClick={() => set('attributes', p.attributes.filter(x => x !== a))} className="text-gray-400 hover:text-red-600 cursor-pointer">×</button></span>)}
            <input className="h-7 px-2 text-[12px] border border-dashed border-gray-300 rounded outline-none w-44" placeholder="Add attribute + Enter" value={attr} onChange={e => setAttr(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && attr.trim()) { set('attributes', [...p.attributes, attr.trim()]); setAttr(''); } }} />
          </div>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <div className="mt-4 flex justify-end"><Button variant="primary" icon={Save} busy={busy === 'save'} onClick={save}>Save changes</Button></div>
      </Card>
      <Card title="Preview on Google">
        <div className="border border-gray-200 rounded overflow-hidden">
          <div className="h-28 bg-gradient-to-br from-blue-100 to-emerald-100 flex items-center justify-center text-gray-400"><ImageIcon size={28} /></div>
          <div className="p-3">
            <div className="text-[15px] text-gray-900">{p.name}</div>
            <div className="text-[12px] text-gray-600 mt-0.5">{b.rating ? <span className="text-amber-600">{b.rating} ★ </span> : null}({b.reviewCount}) · {p.primary_category || 'Category'}</div>
            <div className="flex gap-2 mt-3">{[['Directions', MapPin], ['Call', Phone], ['Website', Globe]].map(([l, I]) => <span key={l} className="flex-1 flex flex-col items-center gap-1 text-[11px] text-blue-700"><span className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center"><I size={14} /></span>{l}</span>)}</div>
            <p className="text-[12px] text-gray-700 mt-3 line-clamp-4">{p.description || 'No description yet.'}</p>
            <div className="text-[12px] text-gray-600 mt-2">{p.address || 'Service-area business'}</div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function PostsTab({ b, toast }) {
  const posts = useApi(`/businesses/${b.id}/posts`);
  const [edit, setEdit] = useState(null);
  const [busy, error, run, setError] = useAction();
  const open = () => { setError(''); setEdit({ post_type: 'Update', title: '', body: '', cta_type: 'LEARN_MORE', cta_url: b.booking_url || b.website || '', scheduled_for: '' }); };
  const save = () => run('save', async () => {
    await api(`/businesses/${b.id}/posts`, { method: 'POST', body: { ...edit, scheduled_for: edit.scheduled_for ? `${edit.scheduled_for}T09:00:00` : null } });
    setEdit(null); posts.reload(true);
    toast('Post saved and sent to the approval queue: it goes live on Google once approved');
  });
  const aiDraft = () => run('draft', async () => { await api(`/businesses/${b.id}/posts/draft`, { method: 'POST' }); posts.reload(true); toast('AI drafted this week\'s post (in the approval queue)'); });
  const del = (id) => run(`d${id}`, async () => { await api(`/businesses/${b.id}/posts/${id}`, { method: 'DELETE' }); posts.reload(true); });
  return (
    <>
      <Card title="Posts" subtitle="One or two Updates or Offers a week keeps the profile active. Every post is approved before it goes live."
        action={<div className="flex gap-2"><Button variant="ai" icon={Sparkles} busy={busy === 'draft'} onClick={aiDraft}>AI draft</Button><Button variant="primary" icon={Plus} onClick={open}>New post</Button></div>}>
        <ErrorNote>{!edit && error}</ErrorNote>
        {!posts.data ? <div className="py-8 flex justify-center text-gray-400"><Loader2 size={16} className="animate-spin" /></div> : posts.data.length === 0 ? <div className="py-8 text-center text-[13px] text-gray-500">No posts yet.</div> : (
          <div className="divide-y divide-gray-100">
            {posts.data.map(p => (
              <div key={p.id} className="flex items-start gap-3 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap"><Badge tone={p.post_type === 'Offer' ? 'orange' : p.post_type === 'Event' ? 'violet' : 'blue'}>{p.post_type}</Badge>{p.title && <span className="text-[13px] font-medium text-gray-900">{p.title}</span>}{p.ai_generated && <Badge tone="violet"><Sparkles size={10} /> AI</Badge>}</div>
                  <p className="text-[12px] text-gray-600 mt-1 line-clamp-2">{p.body}</p>
                  <div className="text-[11px] text-gray-500 mt-1">{CTA[p.cta_type] || '—'} · {p.published_at ? `published ${fmtDate(p.published_at)}` : p.scheduled_for ? `for ${fmtDate(p.scheduled_for)}` : `created ${fmtDate(p.created_at)}`}</div>
                </div>
                <StatusPill level={p.status === 'published' ? 'good' : p.status === 'failed' ? 'critical' : 'warning'}>{p.status === 'published' ? 'Live' : p.status === 'failed' ? 'Failed' : 'Waiting for approval'}</StatusPill>
                {p.status !== 'published' && <button onClick={() => del(p.id)} className="p-1 text-gray-400 hover:text-red-600 cursor-pointer" aria-label="Delete"><Trash2 size={14} /></button>}
              </div>
            ))}
          </div>
        )}
      </Card>
      <Modal open={Boolean(edit)} title="New post" onClose={() => setEdit(null)} width="max-w-3xl" footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" icon={Send} busy={busy === 'save'} disabled={!edit?.body.trim()} onClick={save}>Send for approval</Button></>}>
        {edit && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="flex gap-1">{['Update', 'Offer', 'Event'].map(t => <button key={t} onClick={() => setEdit({ ...edit, post_type: t })} className={`flex-1 h-8 text-[13px] rounded border cursor-pointer ${edit.post_type === t ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-300 text-gray-700'}`}>{t}</button>)}</div>
              {edit.post_type !== 'Update' && <Field label="Title"><input className={inputCls} value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} /></Field>}
              <Field label="Post text" counter={<span className="text-gray-400">{edit.body.length}/1500</span>} hint="No phone numbers or links in the text; use the button."><textarea rows={6} className={areaCls} value={edit.body} onChange={e => setEdit({ ...edit, body: e.target.value.slice(0, 1500) })} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Button"><select className={inputCls} value={edit.cta_type} onChange={e => setEdit({ ...edit, cta_type: e.target.value })}>{Object.entries(CTA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <Field label="Date (optional)"><input type="date" className={inputCls} value={edit.scheduled_for} onChange={e => setEdit({ ...edit, scheduled_for: e.target.value })} /></Field>
              </div>
              <Field label="Button link"><input className={inputCls} value={edit.cta_url} onChange={e => setEdit({ ...edit, cta_url: e.target.value })} /></Field>
              <ErrorNote>{error}</ErrorNote>
            </div>
            <div>
              <div className="text-[12px] text-gray-600 mb-1">Preview</div>
              <div className="border border-gray-200 rounded overflow-hidden">
                <div className="h-32 flex items-center justify-center text-gray-500 bg-emerald-50"><ImageIcon size={24} /></div>
                <div className="p-3"><div className="text-[12px] text-gray-500">{b.name} · just now</div>{edit.title && <div className="text-[14px] font-medium text-gray-900 mt-1">{edit.title}</div>}<p className="text-[13px] text-gray-700 mt-1 whitespace-pre-line">{edit.body || 'Your post text appears here.'}</p><div className="mt-3 text-[13px] font-medium text-blue-700">{CTA[edit.cta_type]}</div></div>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function PhotosTab({ b, toast }) {
  const [cover, setCover] = useState(b.cover_photo || '');
  const [logo, setLogo] = useState(b.logo || '');
  const [busy, error, run] = useAction();
  const save = () => run('save', async () => { await api(`/businesses/${b.id}`, { method: 'PATCH', body: { cover_photo: cover || null, logo: logo || null } }); await refreshBusinesses(); toast('Saved'); });
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Card title="Photos on Google" subtitle="Counted on every sync of the connected profile">
        <div className="text-3xl font-semibold text-gray-900">{b.photo_count ?? '—'}</div>
        <div className="text-[12px] text-gray-500 mt-1">{b.photo_count == null ? 'Connect the Google profile to count photos.' : b.photo_count >= 10 ? 'Good: keep adding real photos weekly.' : 'Aim for 10+ real photos: outside, inside, team, work. No stock images.'}</div>
        <div className="mt-4 space-y-2 text-[13px]">
          {[['10 or more photos', (b.photo_count || 0) >= 10], ['Cover photo set', Boolean(b.cover_photo)], ['Logo set', Boolean(b.logo)]].map(([l, ok]) => <div key={l} className="flex items-center gap-2">{ok ? <CheckCircle2 size={15} className="text-emerald-600" /> : <Circle size={15} className="text-gray-300" />}<span className={ok ? 'text-gray-800' : 'text-gray-500'}>{l}</span></div>)}
        </div>
        <p className="text-[11px] text-gray-500 mt-4">Upload photos in the Google Business Profile app; geo-relevant file names help (e.g. {`${(b.primaryCategory || 'business').toLowerCase().replace(/\s/g, '-')}-${(b.area || 'area').toLowerCase()}.webp`}).</p>
      </Card>
      <Card title="Cover photo and logo">
        <div className="space-y-3">
          <Field label="Cover photo URL"><input className={inputCls} value={cover} onChange={e => setCover(e.target.value)} placeholder="https://" /></Field>
          <Field label="Logo URL"><input className={inputCls} value={logo} onChange={e => setLogo(e.target.value)} placeholder="https://" /></Field>
          <ErrorNote>{error}</ErrorNote>
          <Button variant="primary" icon={Save} busy={busy === 'save'} onClick={save}>Save</Button>
        </div>
      </Card>
    </div>
  );
}

const hoursFrom = (h) => DAYS.map(day => {
  const p = (h?.periods || []).find(x => x.openDay === day);
  const t = (o) => (o ? `${String(o.hours ?? 0).padStart(2, '0')}:${String(o.minutes ?? 0).padStart(2, '0')}` : '');
  return { day, on: Boolean(p) || (!h?.periods && day !== 'SUNDAY'), open: p ? t(p.openTime) : '09:00', close: p ? t(p.closeTime) : '19:00' };
});
const hoursTo = (rows) => ({ periods: rows.filter(r => r.on).map(r => { const [oh, om] = r.open.split(':').map(Number); const [ch, cm] = r.close.split(':').map(Number); return { openDay: r.day, closeDay: r.day, openTime: { hours: oh, minutes: om }, closeTime: { hours: ch, minutes: cm } }; }) });

function HoursTab({ b, toast }) {
  const [rows, setRows] = useState(() => hoursFrom(b.hours));
  const [special, setSpecial] = useState(() => b.special_hours || []);
  const [busy, error, run] = useAction();
  const save = () => run('save', async () => { await api(`/businesses/${b.id}`, { method: 'PATCH', body: { hours: hoursTo(rows), special_hours: special } }); await refreshBusinesses(); toast('Hours saved'); });
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Card title="Opening hours">
        <div className="divide-y divide-gray-100">
          {rows.map((h, i) => (
            <div key={h.day} className="flex items-center gap-3 py-2">
              <span className="w-24 text-[13px] text-gray-800 capitalize">{h.day.toLowerCase()}</span>
              <label className="flex items-center gap-1.5 text-[12px] text-gray-600 w-20"><input type="checkbox" checked={h.on} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, on: e.target.checked } : x))} /> {h.on ? 'Open' : 'Closed'}</label>
              {h.on && <><input type="time" className={`${inputCls} w-28`} value={h.open} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, open: e.target.value } : x))} /><span className="text-gray-400">–</span><input type="time" className={`${inputCls} w-28`} value={h.close} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, close: e.target.value } : x))} /></>}
            </div>
          ))}
        </div>
      </Card>
      <Card title="Special hours" subtitle="Festivals and holidays" action={<Button size="sm" icon={Plus} onClick={() => setSpecial(s => [...s, { date: new Date().toISOString().slice(0, 10), name: 'Holiday', closed: true }])}>Add day</Button>}>
        {special.length === 0 ? <div className="text-[13px] text-gray-500 py-4">None yet.</div> : (
          <div className="divide-y divide-gray-100">
            {special.map((s, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 py-2">
                <input type="date" className={`${inputCls} w-36`} value={s.date} onChange={e => setSpecial(l => l.map((x, j) => j === i ? { ...x, date: e.target.value } : x))} />
                <input className={`${inputCls} flex-1 min-w-[140px]`} value={s.name} onChange={e => setSpecial(l => l.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                <select className={`${inputCls} w-28`} value={s.closed ? 'closed' : 'open'} onChange={e => setSpecial(l => l.map((x, j) => j === i ? { ...x, closed: e.target.value === 'closed', open: x.open || '10:00', close: x.close || '14:00' } : x))}><option value="closed">Closed</option><option value="open">Open</option></select>
                {!s.closed && <><input type="time" className={`${inputCls} w-24`} value={s.open || '10:00'} onChange={e => setSpecial(l => l.map((x, j) => j === i ? { ...x, open: e.target.value } : x))} /><input type="time" className={`${inputCls} w-24`} value={s.close || '14:00'} onChange={e => setSpecial(l => l.map((x, j) => j === i ? { ...x, close: e.target.value } : x))} /></>}
                <button onClick={() => setSpecial(l => l.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600 cursor-pointer" aria-label="Remove"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </Card>
      <div className="xl:col-span-2"><ErrorNote>{error}</ErrorNote><Button className="mt-1" variant="primary" icon={Save} busy={busy === 'save'} onClick={save}>Save hours</Button></div>
    </div>
  );
}

function FaqTab({ b, toast }) {
  const [faqs, setFaqs] = useState(() => (b.faqs && b.faqs.length ? b.faqs : [{ q: '', a: '' }]));
  const [busy, error, run] = useAction();
  const save = () => run('save', async () => { await api(`/businesses/${b.id}`, { method: 'PATCH', body: { faqs: faqs.filter(f => f.q.trim() && f.a.trim()) } }); await refreshBusinesses(); toast('FAQs saved'); });
  const schema = JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.filter(f => f.q && f.a).map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }, null, 2);
  const copy = () => { navigator.clipboard?.writeText(`<script type="application/ld+json">\n${schema}\n</script>`).then(() => toast('FAQ schema copied'), () => toast('Copy not allowed by the browser')); };
  return (
    <Card title="Questions & answers" subtitle="Google is replacing public Q&A with AI answers drawn from the profile, so put these answers in the description, services and the website FAQ too."
      action={<div className="flex gap-2"><Button icon={Plus} onClick={() => setFaqs(f => [...f, { q: '', a: '' }])}>Add</Button><Button icon={Copy} onClick={copy}>Copy FAQ schema</Button></div>}>
      <div className="divide-y divide-gray-100">
        {faqs.map((f, i) => (
          <div key={i} className="py-3 grid grid-cols-1 md:grid-cols-2 gap-2">
            <input className={inputCls} placeholder="Question" value={f.q} onChange={e => setFaqs(l => l.map((x, j) => j === i ? { ...x, q: e.target.value } : x))} />
            <div className="flex gap-2"><input className={inputCls} placeholder="Answer (real facts only)" value={f.a} onChange={e => setFaqs(l => l.map((x, j) => j === i ? { ...x, a: e.target.value } : x))} /><button onClick={() => setFaqs(l => l.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600 cursor-pointer" aria-label="Remove"><Trash2 size={14} /></button></div>
          </div>
        ))}
      </div>
      <ErrorNote>{error}</ErrorNote>
      <Button className="mt-3" variant="primary" icon={Save} busy={busy === 'save'} onClick={save}>Save FAQs</Button>
    </Card>
  );
}

function InsightsTab({ b }) {
  const ins = useApi(`/businesses/${b.id}/insights?days=84`);
  const weekly = useMemo(() => {
    const days = ins.data || [];
    const out = [];
    for (let i = 0; i < days.length; i += 7) {
      const wk = days.slice(i, i + 7);
      out.push({ week: wk[0].day.slice(5), Search: wk.reduce((s, d) => s + d.views_search, 0), Maps: wk.reduce((s, d) => s + d.views_maps, 0), Calls: wk.reduce((s, d) => s + d.calls, 0) });
    }
    return out;
  }, [ins.data]);
  return (
    <Card title="Profile views per week" subtitle="From the Business Profile Performance API (synced daily)" action={<Legend items={[['Google Search', SERIES[0]], ['Google Maps', SERIES[1]]]} />}>
      {!ins.data ? <div className="py-10 flex justify-center text-gray-400"><Loader2 size={16} className="animate-spin" /></div> : weekly.length === 0 ? <div className="py-12 text-center text-[13px] text-gray-500">No insights yet: they arrive once the Google profile is connected and synced.</div> : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weekly} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
              <CartesianGrid stroke={INK.grid} vertical={false} />
              <XAxis dataKey="week" tick={{ fontSize: 11, fill: INK.muted }} tickLine={false} axisLine={{ stroke: INK.axis }} />
              <YAxis tick={{ fontSize: 11, fill: INK.muted }} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f3f4f6' }} />
              <Bar dataKey="Search" name="Google Search" stackId="v" fill={SERIES[0]} stroke="#fff" strokeWidth={2} />
              <Bar dataKey="Maps" name="Google Maps" stackId="v" fill={SERIES[1]} radius={[4, 4, 0, 0]} stroke="#fff" strokeWidth={2} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

function Manager({ b, tab, setTab, toast, onConnect }) {
  return (
    <>
      <ConnectionsBar onConnect={() => onConnect('find')} toast={toast} />
      {!b.gbp_location && tab === 'audit' && <div className="mb-4"><ConnectEmptyState onConnect={() => onConnect('google')} /></div>}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'audit', label: 'Audit' }, { id: 'profile', label: 'Profile' }, { id: 'posts', label: 'Posts' }, { id: 'photos', label: 'Photos' }, { id: 'hours', label: 'Hours' }, { id: 'faq', label: 'Q&A / FAQs' }, { id: 'insights', label: 'Insights' }]} />
      {tab === 'audit' && <AuditTab b={b} onEditProfile={() => setTab('profile')} />}
      {tab === 'profile' && <ProfileTab b={b} toast={toast} />}
      {tab === 'posts' && <PostsTab b={b} toast={toast} />}
      {tab === 'photos' && <PhotosTab b={b} toast={toast} />}
      {tab === 'hours' && <HoursTab b={b} toast={toast} />}
      {tab === 'faq' && <FaqTab b={b} toast={toast} />}
      {tab === 'insights' && <InsightsTab b={b} />}
    </>
  );
}

export default function GbpManagerPage({ initialTab = 'audit' }) {
  const [tab, setTab] = useState(initialTab);
  const [, setBusiness] = useSeoBusiness();
  const location = useLocation();
  const navigate = useNavigate();
  const [connect, setConnect] = useState(null); // null | 'find' | 'google'
  const [toast, toastNode] = useToast();
  // ?connect=1 (from the business switcher) opens the add-businesses window.
  useEffect(() => {
    if (new URLSearchParams(location.search).get('connect')) { setConnect('find'); navigate(location.pathname, { replace: true }); }
  }, [location.search, location.pathname, navigate]);
  const added = (list, note) => {
    setConnect(null);
    if (list.length) { setBusiness(list[0].id); setTab('audit'); }
    toast(note || `${list.length} business${list.length === 1 ? '' : 'es'} added`);
  };
  // The window lives outside the shell so it also opens when there are no businesses yet.
  return (
    <>
      <SeoShell title="Google Business Profile" subtitle="Connect the business's Google account; profiles sync and are audited automatically">
        {(b) => <Manager key={b.id} b={b} tab={tab} setTab={setTab} toast={toast} onConnect={(mode = 'find') => setConnect(mode)} />}
      </SeoShell>
      <ConnectModal open={Boolean(connect)} initialMode={connect || 'find'} onClose={() => setConnect(null)} onAdded={added} />
      {toastNode}
    </>
  );
}
