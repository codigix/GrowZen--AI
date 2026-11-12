import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { CheckCircle2, Circle, PlugZap, Search, Sparkles, Plus, Trash2, Image as ImageIcon, Send, Copy, Phone, Globe, MapPin, Save, Store, FileText, ListChecks, Tags, Navigation, CalendarCheck, Clock, ChevronDown, Upload } from 'lucide-react';
import { SeoShell, Drawer, Card, Tabs, ScoreRing, Meter, StatusPill, Badge, Button, Modal, Field, inputCls, areaCls, ChartTooltip, Legend, ErrorNote, SERIES, INK, scoreWord, useToast, useAction, useDoubleConfirm, useSeoBusiness, refreshBusinesses, useUrlTab, SkChart, SkList, SkLines, SkScore, SkCard } from './SeoUi';
import GbpLive from './GbpLive';
import { BusinessTraffic } from './TrafficPage';
import AccessGate from './AccessGate';
import { CategoryEditor, AddressEditor, AttributesEditor, MediaManager, LivePosts, isLinked, readBase64 } from './GbpEditors';
import { MarketCard } from './Market';
import { GbpAccounts, GoogleSignIn, ListingStatus, VerifyPill } from './GbpAccounts';
import { hoursFrom, hoursTo, isAllDay, WeekEditor, StatusCard, MoreHoursCard, QuickHoursActions, LabelsField, ServiceAreaCard } from './GbpLocationExtras';
import CreateOnGoogle from './GbpCreate';
import { api, useApi, fmtDate } from './seoApi';
import { useCountries } from './countries';
import { BusinessAvatar, SECTION_IDS, TAB_ALIAS, TRAFFIC_VIEWS, SectionHead, ClientBar, OverviewSection, PerformanceMetrics, ReviewsSection, ToolSection, TasksSection, SyncSection, SettingsSection } from './GbpWorkspace';
import Select from '../components/Select';

const CTA = { BOOK: 'Book', ORDER: 'Order online', LEARN_MORE: 'Learn more', SIGN_UP: 'Sign up', CALL: 'Call now' };
const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const pushedMsg = (r, base = 'Saved') => (r?.pushed_to_google?.length ? `${base} and updated on your Google Business Profile` : `${base}. Not sent to Google: connect this client's Google account to publish changes there.`);
const STUFFED = /[|]|\s-\s|\bbest\b|\bcheap\b|no\.?\s?1|\btop\s/i;

function AuditTab({ b, onEditProfile }) {
  const s = useApi(`/businesses/${b.id}/gbp/score`);
  if (!s.data) return s.error ? <ErrorNote>{s.error.message}</ErrorNote> : <div className="grid grid-cols-1 xl:grid-cols-3 gap-4"><SkCard title="Profile score" subtitle="Google ranks local results on relevance, distance and prominence"><SkScore /></SkCard><SkCard title="Profile checklist" subtitle="Sorted by impact: category, reviews, proximity, website, then activity." className="xl:col-span-2"><SkLines n={6} /></SkCard></div>;
  const d = s.data;
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div className="space-y-4">
        <Card title="Profile score" subtitle="Google ranks local results on relevance, distance and prominence">
          <div className="flex items-center gap-5">
            <ScoreRing score={d.score} label={scoreWord(d.score)} />
            <div className="flex-1 space-y-2.5">
              {[['Relevance', d.factors.relevance], ['Distance', d.factors.distance], ['Prominence', d.factors.prominence]].map(([n, v], i) => (
                <div key={n}><div className="flex justify-between text-12 mb-1"><span className="text-gray-600">{n}</span><span className="font-medium">{v}/100</span></div><Meter value={v} color={SERIES[i]} /></div>
              ))}
            </div>
          </div>
        </Card>
        {d.alerts.length > 0 && (
          <Card title="Alerts"><div className="space-y-2">{d.alerts.map(a => <div key={a.text} className="text-12 text-gray-700"><StatusPill level={a.level}>{a.level === 'critical' ? 'Critical' : 'Warning'}</StatusPill> <span className="ml-1">{a.text}</span></div>)}</div></Card>
        )}
      </div>
      <Card title="Profile checklist" subtitle="Sorted by impact: category, reviews, proximity, website, then activity." className="xl:col-span-2" action={<Button size="sm" onClick={onEditProfile}>Edit profile</Button>}>
        <div className="divide-y divide-gray-100">
          {[...d.items].sort((a, c) => (c.weight * (1 - c.score)) - (a.weight * (1 - a.score))).map(i => (
            <div key={i.key} className="flex items-start gap-3 py-2.5">
              {i.ok ? <CheckCircle2 size={16} className="text-emerald-600 mt-0.5 shrink-0" /> : <Circle size={16} className="text-gray-300 mt-0.5 shrink-0" />}
              <div className="flex-1 min-w-0"><div className="text-13 text-gray-900">{i.label}</div>{!i.ok && <div className="text-12 text-gray-500 mt-0.5">{i.fix}</div>}</div>
              <Badge tone="gray">{i.factor}</Badge>
              <span className="w-16 text-right text-12 tabular-nums text-gray-600">{Number((i.weight * i.score).toFixed(1))}/{i.weight}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

const ACTION_TYPES = { ONLINE_APPOINTMENT: 'Book online', FOOD_ORDERING: 'Order food', DINING_RESERVATION: 'Reserve a table', FOOD_DELIVERY: 'Food delivery', FOOD_TAKEOUT: 'Takeaway', SHOP_ONLINE: 'Shop online' };
const usedTypes = (p) => new Set(p.action_links.map(x => x.type));
const phoneProblem = (v) => { const t = String(v || '').trim(); if (!t) return ''; const d = t.replace(/\D/g, ''); return /[^\d+()\-\s.]/.test(t) || d.length < 7 || d.length > 15 ? 'Enter a valid phone number (7 to 15 digits, with the country code if it is not local).' : ''; };
const urlProblem = (v) => { const t = String(v || '').trim(); return !t || /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(t) ? '' : 'Enter a full link that starts with https://'; };
/** What is wrong with the contact fields, before anything is sent to Google. */
function contactProblems(p) {
  const main = String(p.phone || '').trim();
  const extra = p.additional_phones.map((x, i) => phoneProblem(x) || (x.trim() && x.trim() === main ? 'This is the same as the main number.' : '') || (x.trim() && p.additional_phones.findIndex(y => y.trim() === x.trim()) !== i ? 'This number is listed twice.' : ''));
  const links = p.action_links.map(l => urlProblem(l.url));
  const out = { phone: phoneProblem(p.phone), website: p.website && p.website.trim() && !/^https?:\/\//i.test(p.website.trim()) ? 'Start the link with https://' : '', booking: urlProblem(p.booking_url), extra, links };
  out.any = Boolean(out.phone || out.website || out.booking || extra.some(Boolean) || links.some(Boolean));
  return out;
}

function ProfileTab({ b, toast }) {
  const countryRows = useCountries();
  const [p, setP] = useState(() => ({ name: b.name, primary_category: b.primary_category || '', secondary_categories: b.secondary_categories || [], phone: b.phone || '', website: b.website || '', address: b.address || '', area: b.area || '', city: b.city || '', country: b.country || 'IN', description: b.description || '', services: b.services || [], attributes: b.attributes || [], booking_url: b.booking_url || '', labels: b.labels || [], additional_phones: b.additional_phones || [], action_links: (b.action_links || []).filter(x => x.type !== 'APPOINTMENT'), lat: b.lat ?? '', lng: b.lng ?? '' }));
  const [attr, setAttr] = useState('');
  const linked = isLinked(b);
  const [busy, error, run] = useAction();
  const set = (k, v) => setP(x => ({ ...x, [k]: v }));
  const save = () => run('save', async () => {
    const body = { ...p, lat: p.lat === '' ? null : Number(p.lat), lng: p.lng === '' ? null : Number(p.lng), services: p.services.filter(s => s.name), additional_phones: p.additional_phones.map(x => x.trim()).filter(Boolean), action_links: p.action_links.filter(x => x.url.trim()).map(x => ({ type: x.type, url: x.url.trim() })) };
    if (linked) ['primary_category', 'secondary_categories', 'address', 'area', 'city', 'lat', 'lng', 'country'].forEach(k => delete body[k]); // set on Google in the cards below
    const r = await api(`/businesses/${b.id}`, { method: 'PATCH', body });
    await refreshBusinesses();
    toast(pushedMsg(r));
    return true;
  });
  const aiDesc = () => run('ai', async () => { const r = await api(`/businesses/${b.id}/ai/description`, { method: 'POST' }); set('description', r.text); toast('AI draft from your profile: check it, then save'); });
  const problems = contactProblems(p);
  const [saved, setSaved] = useState(() => JSON.stringify(p));
  const [sec, setSec] = useState(() => { // ?step=contact (and so on) opens that step, so a link can land on it
    try { const q = new URLSearchParams(window.location.search).get('step'); return ['details', 'contact', 'location', 'about', 'services', 'highlights'].includes(q) ? q : 'details'; } catch { return 'details'; }
  });
  const SECS = [
    { id: 'details', label: 'Basics', icon: Store, done: Boolean(p.name && (p.primary_category || linked)) },
    { id: 'contact', label: 'Contact', icon: Phone, done: Boolean(p.phone && p.website) && !problems.any },
    { id: 'location', label: 'Location', icon: MapPin, done: Boolean(p.address || p.city || linked) },
    { id: 'about', label: 'About', icon: FileText, done: p.description.length >= 250 },
    { id: 'services', label: 'Services', icon: ListChecks, done: p.services.some(x => x.name) },
    { id: 'highlights', label: 'Highlights', icon: Tags, done: p.attributes.length > 0 }
  ];
  const doneCount = SECS.filter(x => x.done).length + (b.logo ? 1 : 0) + (b.cover_photo ? 1 : 0);
  const pct = Math.round((doneCount / (SECS.length + 2)) * 100);
  const at = SECS.findIndex(x => x.id === sec);
  const dirty = JSON.stringify(p) !== saved;
  const stars = (r) => '★★★★★'.slice(0, Math.round(r || 0)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(r || 0));
  const Sect = ({ id, icon: I, title, hint, children, action }) => (
    <section className={`ai-glass-card rounded p-5 ${sec === id ? '' : 'hidden'}`}>
      <div className="flex items-start gap-3 mb-4">
        <span className="w-9 h-9 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0"><I size={16} /></span>
        <div className="flex-1 min-w-0"><h3 className="text-15 font-semibold text-slate-900">{title}</h3>{hint && <p className="text-12 text-slate-500 mt-0.5">{hint}</p>}</div>
        {action}
      </div>
      {children}
    </section>
  );
  const Row = ({ icon: I, children }) => <div className="flex items-start gap-3 text-13 text-slate-700"><I size={16} className="text-blue-600 mt-0.5 shrink-0" /><span className="min-w-0 break-words">{children}</span></div>;
  return (
    <div className="space-y-5">
      <div className="ai-glass-card rounded overflow-hidden">
        {b.cover_photo ? <img src={b.cover_photo} alt="Cover" className="h-36 w-full object-cover" /> : <div className="h-36 bg-gradient-to-br from-indigo-100 via-sky-100 to-emerald-100" />}
        <div className="px-5 pb-4 flex flex-wrap items-end gap-4 -mt-9">
          <BusinessAvatar name={p.name} src={b.logo} size="w-[76px] h-[76px]" className="ring-4 ring-white shadow-sm text-24" />
          <div className="flex-1 min-w-[220px] pt-10">
            <div className="text-20 font-semibold text-slate-900 leading-tight">{p.name || 'Business name'}</div>
            <div className="text-12.5 text-slate-500 mt-0.5">{b.rating ? <><span className="text-amber-500 font-semibold">{b.rating}</span> <span className="text-amber-400 tracking-tight">{stars(b.rating)}</span> ({b.reviewCount || 0}) · </> : null}{p.primary_category || 'Add a category'}</div>
          </div>
          <div className="pt-10 text-12 text-slate-500">{linked ? <Badge tone="green">Linked to Google</Badge> : <Badge tone="amber">Not linked to Google</Badge>}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
        <div className="space-y-5 min-w-0">
          <div className="ai-glass-card rounded p-3 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2.5 pr-3 sm:border-r border-slate-100">
              <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="18" fill="none" stroke="#e2e8f0" strokeWidth="5" /><circle cx="22" cy="22" r="18" fill="none" stroke={pct === 100 ? '#10b981' : '#6366f1'} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${pct * 1.131} 113.1`} transform="rotate(-90 22 22)" /></svg>
              <div><div className="text-13 font-semibold text-slate-800">{pct}% complete</div><div className="text-11.5 text-slate-500">{pct === 100 ? 'Everything is filled in' : 'Fill each step to finish'}</div></div>
            </div>
            <nav aria-label="Profile sections" className="flex flex-wrap gap-1 flex-1">
              {SECS.map((x) => (
                <button key={x.id} type="button" onClick={() => setSec(x.id)} aria-current={sec === x.id ? 'step' : undefined}
                  className={`h-9 px-3 rounded-full inline-flex items-center gap-1.5 text-13 font-medium cursor-pointer transition-colors ${sec === x.id ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                  {x.done && sec !== x.id ? <CheckCircle2 size={14} className="text-emerald-500" /> : <x.icon size={14} />}{x.label}
                </button>
              ))}
            </nav>
          </div>
          <Sect id="details" icon={Store} title="Business details" hint="The real name on your signage. No keywords or city names.">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2"><Field label="Business name">
                <input className={inputCls} value={p.name} onChange={e => set('name', e.target.value)} />
                {STUFFED.test(p.name) && <div className="mt-1"><StatusPill level="warning">Looks keyword-stuffed: a common cause of suspension</StatusPill></div>}
              </Field></div>
              {!linked && <><Field label="Primary category"><input className={inputCls} value={p.primary_category} onChange={e => set('primary_category', e.target.value)} /></Field>
              <Field label="Secondary categories" hint="Comma separated"><input className={inputCls} value={p.secondary_categories.join(', ')} onChange={e => set('secondary_categories', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} /></Field></>}
            </div>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3"><LabelsField value={p.labels} onChange={v => set('labels', v)} /></div>
            {linked && <p className="mt-3 text-12 text-slate-500">Categories, address and map pin are managed in the Google cards below, because Google needs them in its own format.</p>}
          </Sect>

          <Sect id="contact" icon={Phone} title="Phone, website & booking" hint="These are the Call, Website and Book buttons on Google. Saved changes go to your Google profile.">
            <div className="space-y-5">
              <div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field label="Main phone number" hint="With the country code, e.g. +91 98765 43210">
                    <input type="tel" inputMode="tel" className={`${inputCls} ${problems.phone ? '!border-red-300' : ''}`} value={p.phone} onChange={e => set('phone', e.target.value)} placeholder="+91 …" />
                    {problems.phone && <p className="text-12 text-red-600 mt-1">{problems.phone}</p>}
                  </Field>
                  <Field label="Website (landing page)">
                    <input className={`${inputCls} ${problems.website ? '!border-red-300' : ''}`} value={p.website} onChange={e => set('website', e.target.value)} placeholder="https://" />
                    {problems.website && <p className="text-12 text-red-600 mt-1">{problems.website}</p>}
                  </Field>
                </div>
                {p.additional_phones.map((ph, i) => (
                  <div key={i} className="mt-3 flex items-start gap-2">
                    <div className="flex-1">
                      <input type="tel" inputMode="tel" aria-label={`Extra phone number ${i + 1}`} className={`${inputCls} ${problems.extra[i] ? '!border-red-300' : ''}`} value={ph} onChange={e => set('additional_phones', p.additional_phones.map((x, j) => (j === i ? e.target.value : x)))} placeholder="Another number customers can call" />
                      {problems.extra[i] && <p className="text-12 text-red-600 mt-1">{problems.extra[i]}</p>}
                    </div>
                    <button type="button" onClick={() => set('additional_phones', p.additional_phones.filter((_, j) => j !== i))} className="h-9 w-9 flex items-center justify-center text-slate-400 hover:text-red-600 cursor-pointer" aria-label="Remove this number"><Trash2 size={15} /></button>
                  </div>
                ))}
                {p.additional_phones.length < 2 && <button type="button" onClick={() => set('additional_phones', [...p.additional_phones, ''])} className="mt-2 text-13 font-medium text-indigo-600 hover:underline cursor-pointer inline-flex items-center gap-1"><Plus size={14} />Add another phone number</button>}
              </div>

              <div className="pt-4 border-t border-slate-100">
                <div className="text-13 font-semibold text-slate-800">Booking and order buttons</div>
                <p className="text-12 text-slate-500 mt-0.5 mb-3">Each one becomes a button on your Google profile. Leave a link empty to remove that button.</p>
                <Field label="Book an appointment link">
                  <input className={`${inputCls} ${problems.booking ? '!border-red-300' : ''}`} value={p.booking_url} onChange={e => set('booking_url', e.target.value)} placeholder="https://" />
                  {problems.booking && <p className="text-12 text-red-600 mt-1">{problems.booking}</p>}
                </Field>
                {p.action_links.map((l, i) => (
                  <div key={i} className="mt-3 flex items-start gap-2">
                    <Select className={`${inputCls} w-48 shrink-0`} aria-label="Button type" value={l.type} onChange={e => set('action_links', p.action_links.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}>
                      {Object.entries(ACTION_TYPES).filter(([k]) => k === l.type || !usedTypes(p).has(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                    <div className="flex-1">
                      <input className={`${inputCls} ${problems.links[i] ? '!border-red-300' : ''}`} aria-label={`${ACTION_TYPES[l.type]} link`} value={l.url} onChange={e => set('action_links', p.action_links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} placeholder="https://" />
                      {problems.links[i] && <p className="text-12 text-red-600 mt-1">{problems.links[i]}</p>}
                    </div>
                    <button type="button" onClick={() => set('action_links', p.action_links.filter((_, j) => j !== i))} className="h-9 w-9 flex items-center justify-center text-slate-400 hover:text-red-600 cursor-pointer" aria-label="Remove this button"><Trash2 size={15} /></button>
                  </div>
                ))}
                {Object.keys(ACTION_TYPES).some(k => !usedTypes(p).has(k)) && <button type="button" onClick={() => set('action_links', [...p.action_links, { type: Object.keys(ACTION_TYPES).find(k => !usedTypes(p).has(k)), url: '' }])} className="mt-2 text-13 font-medium text-indigo-600 hover:underline cursor-pointer inline-flex items-center gap-1"><Plus size={14} />Add another button (order online, reserve a table…)</button>}
                {b.gbp_status?.action_links_error && <p className="mt-3 text-12.5 text-amber-700 bg-amber-50 rounded-lg px-3 py-2">Google would not give the booking and order links on the last sync: {b.gbp_status.action_links_error}</p>}
              </div>
            </div>
          </Sect>

          {!linked && (
            <Sect id="location" icon={MapPin} title="Location" hint="Used for local rankings and the map pin.">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="md:col-span-2"><Field label="Address"><input className={inputCls} value={p.address} onChange={e => set('address', e.target.value)} /></Field></div>
                <Field label="Area"><input className={inputCls} value={p.area} onChange={e => set('area', e.target.value)} /></Field>
                <Field label="City"><input className={inputCls} value={p.city} onChange={e => set('city', e.target.value)} /></Field>
                <Field label="Country" hint="Google searches, phone checks and listing sites follow it."><Select className={inputCls} value={p.country} onChange={e => set('country', e.target.value)} aria-label="Country">{countryRows.map(r => <option key={r.code} value={r.code}>{r.name}</option>)}</Select></Field>
                <div className="grid grid-cols-2 gap-2"><Field label="Map pin latitude"><input className={inputCls} value={p.lat} onChange={e => set('lat', e.target.value)} /></Field><Field label="Longitude"><input className={inputCls} value={p.lng} onChange={e => set('lng', e.target.value)} /></Field></div>
              </div>
            </Sect>
          )}

          <Sect id="about" icon={FileText} title="About the business" hint="Aim for 600-750 characters. No URLs, phone numbers or promotions."
            action={<Button size="sm" variant="ai" icon={Sparkles} busy={busy === 'ai'} onClick={aiDesc}>Write with AI</Button>}>
            <textarea rows={6} className={areaCls} value={p.description} onChange={e => set('description', e.target.value.slice(0, 750))} placeholder="What you do, who you serve and what makes you different." />
            <div className="mt-1.5 flex items-center gap-2">
              <div className="flex-1 h-1 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full ${p.description.length >= 600 ? 'bg-emerald-500' : 'bg-indigo-400'}`} style={{ width: `${Math.min(100, p.description.length / 7.5)}%` }} /></div>
              <span className="text-11.5 text-slate-400 tabular-nums">{p.description.length}/750</span>
            </div>
          </Sect>

          <Sect id="services" icon={ListChecks} title="Services & prices" hint="Shown under the Services section of your Google profile."
            action={<Button size="sm" icon={Plus} onClick={() => set('services', [...p.services, { name: '', price: '', description: '' }])}>Add service</Button>}>
            {p.services.length === 0 && <p className="text-13 text-slate-400">No services yet. Add the main things customers book or buy.</p>}
            <div className="space-y-2">
              {p.services.map((s, i) => (
                <div key={i} className="grid grid-cols-12 gap-2">
                  <input className={`${inputCls} col-span-12 sm:col-span-4`} placeholder="Service" value={s.name || ''} onChange={e => set('services', p.services.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                  <input className={`${inputCls} col-span-5 sm:col-span-2`} placeholder="Price" value={s.price || ''} onChange={e => set('services', p.services.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} />
                  <input className={`${inputCls} col-span-6 sm:col-span-5`} placeholder="One-line description" value={s.description || ''} onChange={e => set('services', p.services.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} />
                  <button onClick={() => set('services', p.services.filter((_, j) => j !== i))} className="col-span-1 flex items-center justify-center text-slate-400 hover:text-red-600 cursor-pointer" aria-label="Remove"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </Sect>

          <Sect id="highlights" icon={Tags} title="Highlights" hint="Short tags such as “Wheelchair accessible” or “Free Wi-Fi”.">
            <div className="flex flex-wrap gap-1.5">
              {p.attributes.map(a => <span key={a} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 text-12 text-slate-700">{a}<button onClick={() => set('attributes', p.attributes.filter(x => x !== a))} className="text-slate-400 hover:text-red-600 cursor-pointer" aria-label={`Remove ${a}`}>×</button></span>)}
              <input className="h-7 px-3 text-12 border border-dashed border-slate-300 rounded-full outline-none w-48 focus:border-indigo-400" placeholder="Add highlight + Enter" value={attr} onChange={e => setAttr(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && attr.trim()) { set('attributes', [...p.attributes, attr.trim()]); setAttr(''); } }} />
            </div>
          </Sect>

          <ErrorNote>{error}</ErrorNote>

          {sec === 'details' && <div className="space-y-2"><div className="text-12 font-semibold uppercase tracking-wide text-slate-400 px-1">Categories on Google</div><CategoryEditor b={b} toast={toast} /></div>}
          {sec === 'location' && <div className="space-y-2"><div className="text-12 font-semibold uppercase tracking-wide text-slate-400 px-1">Address and map pin on Google</div><AddressEditor b={b} toast={toast} /></div>}
          {sec === 'location' && <ServiceAreaCard key={b.id} b={b} toast={toast} />}
          {sec === 'highlights' && <div className="space-y-2"><div className="text-12 font-semibold uppercase tracking-wide text-slate-400 px-1">Attributes on Google</div><AttributesEditor b={b} toast={toast} /></div>}

          <div className="flex items-center justify-between">
            <Button disabled={at <= 0} onClick={() => setSec(SECS[at - 1].id)}>Back</Button>
            <span className="text-12 text-slate-400">Step {at + 1} of {SECS.length}</span>
            <Button variant="primary" disabled={at >= SECS.length - 1} onClick={() => setSec(SECS[at + 1].id)}>Next</Button>
          </div>

          <div className={`sticky bottom-3 z-10 rounded-lg px-4 py-3 flex items-center gap-3 shadow-lg ring-1 transition-colors ${dirty ? 'bg-white ring-indigo-200' : 'bg-white/80 ring-slate-200'}`}>
            <span className={`w-2 h-2 rounded-full ${dirty ? 'bg-amber-500' : 'bg-emerald-500'}`} />
            <span className="flex-1 text-13 text-slate-600">{problems.any ? <span className="text-red-600">Fix the highlighted fields to save</span> : dirty ? 'You have unsaved changes' : 'All changes saved'}</span>
            <Button disabled={!dirty} onClick={() => setP(JSON.parse(saved))}>Discard</Button>
            <Button variant="primary" icon={Save} busy={busy === 'save'} disabled={!dirty || problems.any} title={problems.any ? 'Fix the highlighted phone numbers or links first' : ''} onClick={async () => { const ok = await save(); if (ok) setSaved(JSON.stringify(p)); }}>Save changes</Button>
          </div>
        </div>

        <aside className="xl:sticky xl:top-20 space-y-3 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto xl:pr-1">
          <div className="flex items-center justify-between px-1">
            <span className="text-12 font-semibold uppercase tracking-wide text-slate-400">How it looks on Google</span>
            <span className="text-11 text-emerald-600 font-medium inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Live preview</span>
          </div>
          <GooglePreview b={b} p={p} stars={stars} />
          <p className="text-11.5 text-slate-400 px-1">Built from the details you are editing. The buttons and tabs work like the real listing; greyed items are still missing.</p>
        </aside>
      </div>
    </div>
  );
}

const WEEK = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const clock = (t) => { const h = t?.hours ?? 0, m = t?.minutes ?? 0; return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h >= 12 && h < 24 ? 'PM' : 'AM'}`; };
const hoursByDay = (hours) => WEEK.map(d => ({ day: d, spans: (hours?.periods || []).filter(x => x.openDay === d).map(x => (isAllDay(x) ? '24 hours' : `${clock(x.openTime)} – ${clock(x.closeTime)}`)) }));
const asUrl = (u) => (u ? (/^https?:\/\//i.test(u) ? u : `https://${u}`) : null);

/** The business as it appears on Google: working buttons (maps, call, website, booking) and the Overview / Reviews / Photos / About tabs, from the details being edited. */
function GooglePreview({ b, p, stars }) {
  const [tab, setTab] = useState('overview');
  const [weekOpen, setWeekOpen] = useState(false);
  const reviews = useApi(tab === 'reviews' ? `/businesses/${b.id}/reviews` : null);
  const live = useApi(tab === 'photos' && isLinked(b) ? `/businesses/${b.id}/gbp/live` : null);
  const week = hoursByDay(b.hours);
  const hasHours = week.some(d => d.spans.length);
  const today = week[(new Date().getDay() + 6) % 7];
  const mapsQuery = [p.name, p.address || [p.area, p.city].filter(Boolean).join(', ')].filter(Boolean).join(' ');
  const mapsUrl = b.lat != null && b.lng != null ? `https://www.google.com/maps/search/?api=1&query=${b.lat},${b.lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`;
  const web = asUrl(p.website);
  const book = asUrl(p.booking_url);
  const extraPhones = (p.additional_phones || []).filter(x => x && x.trim());
  const otherLinks = (p.action_links || []).filter(x => x.url && x.url.trim());
  const actions = [['Directions', Navigation, mapsUrl, true], ['Call', Phone, p.phone ? `tel:${p.phone.replace(/[^\d+]/g, '')}` : null], ['Website', Globe, web], ['Book', CalendarCheck, book]];
  const photos = (live.data?.live?.media || []).filter(m => m.type !== 'VIDEO' && m.url);
  const gallery = photos.length ? photos : [b.cover_photo, b.logo].filter(Boolean).map(url => ({ url }));
  const services = p.services.filter(s => s.name);
  const Line = ({ icon: I, children }) => <div className="flex items-start gap-3.5 text-13 text-slate-700"><I size={17} className="text-blue-600 mt-0.5 shrink-0" /><div className="min-w-0 break-words flex-1">{children}</div></div>;
  return (
    <div className="bg-white rounded-2xl ring-1 ring-slate-200 shadow-sm overflow-hidden">
      {b.cover_photo
        ? <img src={b.cover_photo} alt="" className="h-44 w-full object-cover" />
        : <div className="h-44 bg-gradient-to-br from-sky-100 via-indigo-50 to-emerald-100 flex flex-col items-center justify-center gap-2 text-slate-400">
            <BusinessAvatar name={p.name} src={b.logo} size="w-16 h-16" className="shadow-sm text-24" />
            <span className="text-12">Add a cover photo in Photos &amp; Media</span>
          </div>}
      <div className="px-5 pt-4 pb-5">
        <div className="text-22 text-slate-900 leading-snug" style={{ fontFamily: 'Google Sans, Roboto, Arial, sans-serif' }}>{p.name || 'Business name'}</div>
        <div className="flex flex-wrap items-center gap-x-1.5 text-13 text-slate-600 mt-1">
          {b.rating ? <><span className="text-slate-800">{b.rating}</span><span className="text-amber-400 tracking-tight">{stars(b.rating)}</span><button type="button" onClick={() => setTab('reviews')} className="text-blue-700 hover:underline cursor-pointer">({b.reviewCount || 0})</button></> : <span className="text-slate-400">No reviews yet</span>}
          <span className="text-slate-300">·</span><span>{p.primary_category || 'Add a category'}</span>
        </div>
        {hasHours && <div className="text-13 mt-1"><span className={today.spans.length ? 'text-emerald-700 font-medium' : 'text-red-600 font-medium'}>{today.spans.length ? 'Open today' : 'Closed today'}</span>{today.spans.length ? <span className="text-slate-500"> · {today.spans.join(', ')}</span> : null}</div>}
        <div className="grid grid-cols-4 gap-1 mt-5">
          {actions.map(([l, I, href, main]) => (href
            ? <a key={l} href={href} target={href.startsWith('tel:') ? undefined : '_blank'} rel="noreferrer" className="group flex flex-col items-center gap-1.5 cursor-pointer">
                <span className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${main ? 'bg-blue-600 text-white group-hover:bg-blue-700' : 'ring-1 ring-slate-300 text-blue-700 group-hover:bg-blue-50'}`}><I size={17} /></span>
                <span className="text-12 text-blue-700">{l}</span>
              </a>
            : <div key={l} className="flex flex-col items-center gap-1.5" title={`Add ${l === 'Book' ? 'a booking link' : l === 'Call' ? 'a phone number' : 'a website'} to turn this on`}>
                <span className="w-11 h-11 rounded-full flex items-center justify-center ring-1 ring-dashed ring-slate-200 text-slate-300"><I size={17} /></span>
                <span className="text-12 text-slate-300">{l}</span>
              </div>))}
        </div>
        <div role="tablist" className="flex border-b border-slate-200 mt-5 -mx-5 px-3 text-13">
          {[['overview', 'Overview'], ['reviews', 'Reviews'], ['photos', 'Photos'], ['about', 'About']].map(([id, t]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`px-3 py-2.5 cursor-pointer ${tab === id ? 'text-blue-700 border-b-2 border-blue-600 font-medium' : 'text-slate-500 hover:text-slate-800'}`}>{t}</button>
          ))}
        </div>

        {tab === 'overview' && (
          <div className="mt-4 divide-y divide-slate-100">
            <div className="space-y-3.5 pb-4">
              <Line icon={MapPin}>{p.address || [p.area, p.city].filter(Boolean).join(', ') || <span className="text-slate-400">Add the address, or mark as a service-area business</span>}</Line>
              {hasHours && (
                <Line icon={Clock}>
                  <button type="button" onClick={() => setWeekOpen(o => !o)} className="text-left cursor-pointer w-full flex items-center justify-between gap-2"><span>{today.spans.length ? <>Open · {today.spans.join(', ')}</> : 'Closed today'}</span><ChevronDown size={15} className={`text-slate-400 transition-transform ${weekOpen ? 'rotate-180' : ''}`} /></button>
                  {weekOpen && <div className="mt-2 space-y-1">{week.map(d => <div key={d.day} className={`flex justify-between gap-3 text-12.5 ${d.day === today.day ? 'font-semibold text-slate-900' : 'text-slate-600'}`}><span>{d.day.charAt(0) + d.day.slice(1).toLowerCase()}</span><span>{d.spans.join(', ') || 'Closed'}</span></div>)}</div>}
                </Line>
              )}
              <Line icon={Globe}>{web ? <a href={web} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">{p.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a> : <span className="text-slate-400">Add a website</span>}</Line>
              <Line icon={Phone}>{p.phone ? <a href={`tel:${p.phone.replace(/[^\d+]/g, '')}`} className="hover:underline">{p.phone}</a> : <span className="text-slate-400">Add a phone number</span>}{extraPhones.map(x => <div key={x}><a href={`tel:${x.replace(/[^\d+]/g, '')}`} className="hover:underline">{x}</a></div>)}</Line>
              {(book || otherLinks.length > 0) && <Line icon={CalendarCheck}><div className="flex flex-wrap gap-x-3 gap-y-1">{book && <a href={book} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">Book an appointment</a>}{otherLinks.map(x => <a key={x.type} href={asUrl(x.url)} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">{ACTION_TYPES[x.type] || x.type}</a>)}</div></Line>}
            </div>
            <div className="py-4">
              <div className="text-14 font-medium text-slate-900 mb-1">From the business</div>
              <p className="text-13 text-slate-600 leading-relaxed line-clamp-4">{p.description || <span className="text-slate-400">Write a short description so customers know what you offer.</span>}</p>
              {p.description.length > 200 && <button type="button" onClick={() => setTab('about')} className="text-13 text-blue-700 mt-1 hover:underline cursor-pointer">More</button>}
            </div>
            {services.length > 0 && (
              <div className="py-4">
                <div className="text-14 font-medium text-slate-900 mb-2">Services</div>
                {services.slice(0, 4).map((s, i) => <div key={i} className="flex justify-between gap-3 text-13 text-slate-600 py-1"><span className="truncate">{s.name}</span><span className="text-slate-500 shrink-0">{s.price}</span></div>)}
                {services.length > 4 && <button type="button" onClick={() => setTab('about')} className="text-13 text-blue-700 mt-1 hover:underline cursor-pointer">All {services.length} services</button>}
              </div>
            )}
          </div>
        )}

        {tab === 'reviews' && (
          <div className="mt-4">
            {!reviews.data ? (reviews.error ? <div className="text-13 text-red-600">{reviews.error.message}</div> : <SkList rows={3} />) : (
              <>
                <div className="flex items-center gap-4 pb-3 border-b border-slate-100">
                  <div className="text-34 leading-none text-slate-900">{b.rating || '–'}</div>
                  <div><div className="text-amber-400 tracking-tight">{stars(b.rating)}</div><div className="text-12 text-slate-500">{b.reviewCount || 0} reviews</div></div>
                </div>
                {reviews.data.reviews.length === 0 && <p className="text-13 text-slate-400 py-4">No reviews yet. Ask happy customers to leave one.</p>}
                <ul className="divide-y divide-slate-100">
                  {reviews.data.reviews.slice(0, 5).map(r => (
                    <li key={r.id} className="py-3">
                      <div className="flex items-center gap-2"><span className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 text-12 font-semibold flex items-center justify-center">{(r.author || '?').charAt(0).toUpperCase()}</span><span className="text-13 font-medium text-slate-800">{r.author || 'Google user'}</span></div>
                      <div className="mt-1 text-12 text-slate-500"><span className="text-amber-400 tracking-tight">{stars(r.rating)}</span> {r.review_at ? new Date(r.review_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : r.review_date ? fmtDate(r.review_date) : ''}</div>
                      {r.body && <p className="text-13 text-slate-600 mt-1 line-clamp-4">{r.body}</p>}
                      {r.reply_text && <div className="mt-2 ml-3 pl-3 border-l-2 border-slate-200 text-12.5 text-slate-600"><span className="font-medium text-slate-700">Response from the owner</span><p className="mt-0.5 line-clamp-3">{r.reply_text}</p></div>}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {tab === 'photos' && (
          <div className="mt-4">
            {live.loading && !live.data ? <SkList rows={2} /> : gallery.length === 0
              ? <p className="text-13 text-slate-400 py-4">No photos yet. Add some in Photos &amp; Media so customers can see the place and the work.</p>
              : <div className="grid grid-cols-3 gap-1.5">{gallery.slice(0, 9).map((m, i) => <a key={m.url + i} href={m.url} target="_blank" rel="noreferrer" className={`overflow-hidden rounded-lg bg-slate-100 ${i === 0 ? 'col-span-2 row-span-2' : ''}`}><img src={m.url} alt="" className="w-full h-full aspect-square object-cover hover:scale-105 transition-transform" loading="lazy" /></a>)}</div>}
          </div>
        )}

        {tab === 'about' && (
          <div className="mt-4 space-y-5">
            <div>
              <div className="text-14 font-medium text-slate-900 mb-1">From the business</div>
              <p className="text-13 text-slate-600 leading-relaxed whitespace-pre-line">{p.description || <span className="text-slate-400">No description yet.</span>}</p>
            </div>
            {services.length > 0 && <div><div className="text-14 font-medium text-slate-900 mb-1.5">Services</div>{services.map((s, i) => <div key={i} className="py-1.5 border-b border-slate-100 last:border-0"><div className="flex justify-between gap-3 text-13 text-slate-800"><span>{s.name}</span><span className="text-slate-500 shrink-0">{s.price}</span></div>{s.description && <div className="text-12 text-slate-500">{s.description}</div>}</div>)}</div>}
            {p.attributes.length > 0 && <div><div className="text-14 font-medium text-slate-900 mb-1.5">Highlights</div><div className="flex flex-wrap gap-1.5">{p.attributes.map(a => <span key={a} className="text-12 text-slate-600 ring-1 ring-slate-200 rounded-full px-2.5 py-0.5">{a}</span>)}</div></div>}
            {(p.secondary_categories || []).length > 0 && <div><div className="text-14 font-medium text-slate-900 mb-1.5">Also listed as</div><div className="text-13 text-slate-600">{p.secondary_categories.join(', ')}</div></div>}
          </div>
        )}
      </div>
    </div>
  );
}

const cleanTag = (t) => { const s = String(t).replace(/[^\p{L}\p{N}_]/gu, ''); return s ? `#${s}` : ''; };
const dayStr = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const shortDay = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
/** What is wrong with an Offer or Event, checked before it is sent: the same rules the server and Google apply. */
const postProblem = (e) => {
  if (e.post_type === 'Update') return '';
  const kind = e.post_type === 'Event' ? 'event' : 'offer';
  if (!e.title.trim()) return `Give the ${kind} a title.`;
  if (e.post_type === 'Event' && !(e.starts_on && e.ends_on)) return 'An event needs a start date and an end date.';
  if (e.starts_on && e.ends_on && e.ends_on < e.starts_on) return 'The end date cannot be before the start date.';
  if (e.ends_on && e.ends_on < dayStr()) return 'The end date is already in the past.';
  if (e.post_type === 'Event' && e.starts_on && e.starts_on === e.ends_on && e.start_time && e.end_time && e.end_time <= e.start_time) return 'On a one-day event the end time must be after the start time.';
  if (e.redeem_url && !/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(e.redeem_url.trim())) return 'The redeem link must start with https://';
  return '';
};
/** The request body for a new post: only the details that belong to its type. */
const cleanPost = (e) => {
  const offer = e.post_type === 'Offer', event = e.post_type === 'Event';
  return {
    post_type: e.post_type, title: e.title.trim() || null, body: postText(e), cta_type: e.cta_type, cta_url: e.cta_type === 'CALL' ? null : e.cta_url || null, image_url: e.image_url || null,
    scheduled_for: e.scheduled_for ? `${e.scheduled_for}T09:00:00` : null,
    starts_on: (offer || event) && e.starts_on ? e.starts_on : null, ends_on: (offer || event) && e.ends_on ? e.ends_on : null,
    start_time: event && e.start_time ? e.start_time : null, end_time: event && e.end_time ? e.end_time : null,
    coupon_code: offer && e.coupon_code.trim() ? e.coupon_code.trim() : null, redeem_url: offer && e.redeem_url.trim() ? e.redeem_url.trim() : null, terms: offer && e.terms.trim() ? e.terms.trim() : null
  };
};
const postText = (e) => `${e.body.trim()}${e.tags?.length ? `\n\n${e.tags.join(' ')}` : ''}`;

/** The New post form: picture, text and hashtags on the left, how the post will look on Google on the right. */
function PostEditor({ b, edit, setEdit, toast, error }) {
  const linked = isLinked(b);
  const live = useApi(linked ? `/businesses/${b.id}/gbp/live` : null);
  const photos = (live.data?.live?.media || []).filter(m => m.type !== 'VIDEO' && m.url).slice(0, 12);
  const [busy, , run] = useAction();
  const [tag, setTag] = useState('');
  const [topic, setTopic] = useState('');
  const [pick, setPick] = useState(false);
  const [broken, setBroken] = useState(false);
  const fileRef = useRef(null);
  const set = (patch) => setEdit(e => ({ ...e, ...patch }));
  const total = postText(edit).length;
  const addTags = (raw) => { const add = String(raw).split(/[\s,]+/).map(cleanTag).filter(Boolean); if (add.length) set({ tags: [...new Set([...(edit.tags || []), ...add])].slice(0, 10) }); setTag(''); };
  const upload = (file) => file && run('up', async () => {
    if (!/^image\/(jpeg|png)$/.test(file.type)) throw new Error('Use a JPG or PNG photo.');
    if (file.size > 25 * 1024 * 1024) throw new Error('Photos must be under 25 MB.');
    const r = await api(`/businesses/${b.id}/gbp/media`, { method: 'POST', body: { category: 'ADDITIONAL', data_base64: await readBase64(file), content_type: file.type } });
    if (!r.googleUrl) throw new Error('Google has not returned the photo address yet. Pick it from Profile photos in a moment.');
    setBroken(false); set({ image_url: r.googleUrl }); toast('Photo added to your Google profile and attached to this post');
  });
  const compose = (tagsOnly) => run('ai', async () => {
    const r = await api(`/businesses/${b.id}/posts/compose`, { method: 'POST', body: { topic: tagsOnly ? (edit.body || topic).slice(0, 300) : topic, post_type: edit.post_type } });
    set(tagsOnly ? { tags: r.hashtags } : { body: r.body, tags: r.hashtags, ...(edit.post_type !== 'Update' && r.title ? { title: r.title } : {}) });
    toast(tagsOnly ? 'Hashtags suggested' : 'AI draft ready: read it and change anything you like');
  });
  const img = edit.image_url && !broken ? edit.image_url : null;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6">
      <div className="space-y-5 min-w-0">
        <div className="flex gap-1 p-1 bg-slate-100 rounded-lg w-fit">{['Update', 'Offer', 'Event'].map(t => <button key={t} type="button" onClick={() => set({ post_type: t })} className={`h-8 px-4 text-13 rounded-md cursor-pointer font-medium ${edit.post_type === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>{t === 'Update' ? 'What’s new' : t}</button>)}</div>

        <section>
          <div className="text-13 font-semibold text-slate-800 mb-2">1 · Picture</div>
          {img ? (
            <div className="flex items-center gap-3 p-2 rounded-lg ring-1 ring-slate-200">
              <img src={img} alt="" className="w-20 h-20 rounded-md object-cover bg-slate-100" onError={() => setBroken(true)} />
              <div className="flex-1 min-w-0 text-12 text-slate-500 truncate">{edit.image_url}</div>
              <Button size="sm" onClick={() => set({ image_url: '' })}>Remove</Button>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 p-4">
              {broken && edit.image_url && <div className="text-12 text-red-600 mb-2">That picture could not be loaded. Use a public JPG or PNG link, or upload one.</div>}
              <div className="flex flex-wrap items-center gap-2">
                <input ref={fileRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }} />
                <Button icon={Upload} busy={busy === 'up'} disabled={!linked} title={linked ? '' : 'Connect the Google account to upload'} onClick={() => fileRef.current?.click()}>Upload photo</Button>
                {linked && <Button icon={ImageIcon} onClick={() => setPick(v => !v)}>{pick ? 'Hide profile photos' : 'Profile photos'}</Button>}
                <input className={`${inputCls} flex-1 min-w-[180px]`} placeholder="or paste a public image link (https://…)" value={broken ? '' : edit.image_url || ''} onChange={e => { setBroken(false); set({ image_url: e.target.value.trim() }); }} />
              </div>
              {!linked && <p className="text-12 text-slate-400 mt-2">Uploading needs the Google account connected. You can still paste a public image link.</p>}
              {pick && (photos.length === 0 ? <p className="text-12 text-slate-400 mt-3">No photos on the profile yet.</p> : (
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5 mt-3">{photos.map(m => <button key={m.id} type="button" onClick={() => { setBroken(false); set({ image_url: m.url }); setPick(false); }} className="aspect-square rounded-md overflow-hidden ring-1 ring-slate-200 hover:ring-2 hover:ring-indigo-400 cursor-pointer"><img src={m.thumb || m.url} alt="" className="w-full h-full object-cover" loading="lazy" /></button>)}</div>
              ))}
              <p className="text-11.5 text-slate-400 mt-2">Best: a clear JPG or PNG, 1200 × 900 px or larger, no text or phone numbers on it.</p>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-13 font-semibold text-slate-800">2 · Description</div>
            <Button size="sm" variant="ai" icon={Sparkles} busy={busy === 'ai'} onClick={() => compose(false)}>Write with AI</Button>
          </div>
          <input className={inputCls} value={topic} onChange={e => setTopic(e.target.value)} placeholder="Optional: what is this post about? e.g. wedding season lehenga rentals" />
          {edit.post_type !== 'Update' && <Field label={`Title (required for an ${edit.post_type.toLowerCase()})`}><input className={inputCls} value={edit.title} onChange={e => set({ title: e.target.value.slice(0, 58) })} placeholder={edit.post_type === 'Offer' ? 'e.g. 20% off this weekend' : 'e.g. Open day'} /></Field>}
          <textarea rows={7} className={areaCls} value={edit.body} onChange={e => set({ body: e.target.value.slice(0, 1400) })} placeholder="Tell customers what is new, what you offer, and what to do next." aria-label="Post description" />
          <p className="text-11.5 text-slate-400">No phone numbers or links in the text: the button below carries the link.</p>
        </section>

        <section>
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-13 font-semibold text-slate-800">3 · Hashtags</div>
            <Button size="sm" icon={Sparkles} busy={busy === 'ai'} onClick={() => compose(true)}>Suggest hashtags</Button>
          </div>
          <div className="flex flex-wrap gap-1.5 items-center rounded-lg ring-1 ring-slate-200 p-2 focus-within:ring-2 focus-within:ring-indigo-300">
            {(edit.tags || []).map(t => <span key={t} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-50 text-12 text-indigo-700">{t}<button type="button" onClick={() => set({ tags: edit.tags.filter(x => x !== t) })} className="text-indigo-300 hover:text-red-600 cursor-pointer" aria-label={`Remove ${t}`}>×</button></span>)}
            <input className="flex-1 min-w-[140px] h-7 text-13 outline-none bg-transparent" value={tag} placeholder={(edit.tags || []).length ? 'Add another…' : 'Type a hashtag and press Enter'} onChange={e => setTag(e.target.value)}
              onKeyDown={e => { if (['Enter', ',', ' '].includes(e.key) && tag.trim()) { e.preventDefault(); addTags(tag); } else if (e.key === 'Backspace' && !tag && (edit.tags || []).length) set({ tags: edit.tags.slice(0, -1) }); }} onBlur={() => tag.trim() && addTags(tag)} />
          </div>
          <p className="text-11.5 text-slate-400 mt-1">3 to 8 tags is plenty. They are added to the end of the post.</p>
        </section>

        <section className="space-y-3">
          <div className="text-13 font-semibold text-slate-800">4 · Button and timing</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Button"><Select className={inputCls} value={edit.cta_type} onChange={e => set({ cta_type: e.target.value })}>{Object.entries(CTA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Date (optional)"><input type="date" className={inputCls} value={edit.scheduled_for} onChange={e => set({ scheduled_for: e.target.value })} /></Field>
          </div>
          {edit.cta_type !== 'CALL' && <Field label="Button link"><input className={inputCls} value={edit.cta_url} onChange={e => set({ cta_url: e.target.value })} placeholder="https://" /></Field>}
        </section>

        {edit.post_type !== 'Update' && (
          <section className="space-y-3 rounded-lg ring-1 ring-slate-200 p-4">
            <div className="text-13 font-semibold text-slate-800">{edit.post_type === 'Event' ? 'When the event happens' : 'How long the offer runs'}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={edit.post_type === 'Event' ? 'Starts on' : 'Starts on (optional)'}><input type="date" className={inputCls} min={dayStr()} max={dayStr(365)} value={edit.starts_on} onChange={e => set({ starts_on: e.target.value, ends_on: edit.ends_on && edit.ends_on < e.target.value ? e.target.value : edit.ends_on })} /></Field>
              <Field label={edit.post_type === 'Event' ? 'Ends on' : 'Ends on (optional)'}><input type="date" className={inputCls} min={edit.starts_on || dayStr()} max={dayStr(365)} value={edit.ends_on} onChange={e => set({ ends_on: e.target.value })} /></Field>
              {edit.post_type === 'Event' && <>
                <Field label="Start time (optional)"><input type="time" className={inputCls} value={edit.start_time} onChange={e => set({ start_time: e.target.value })} /></Field>
                <Field label="End time (optional)"><input type="time" className={inputCls} value={edit.end_time} onChange={e => set({ end_time: e.target.value })} /></Field>
              </>}
            </div>
            {edit.post_type === 'Offer' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Coupon code (optional)"><input className={inputCls} value={edit.coupon_code} maxLength={60} onChange={e => set({ coupon_code: e.target.value })} placeholder="e.g. WEEKEND20" /></Field>
                <Field label="Redeem online link (optional)"><input className={inputCls} value={edit.redeem_url} onChange={e => set({ redeem_url: e.target.value })} placeholder="https://" /></Field>
                <div className="sm:col-span-2"><Field label="Terms and conditions (optional)"><input className={inputCls} value={edit.terms} maxLength={500} onChange={e => set({ terms: e.target.value })} placeholder="e.g. One per customer. Not valid with other offers." /></Field></div>
              </div>
            )}
            {edit.post_type === 'Offer' && !edit.starts_on && !edit.ends_on && <p className="text-11.5 text-slate-400">With no dates the offer runs for 7 days from today.</p>}
            {postProblem(edit) && <p className="text-12.5 text-red-600">{postProblem(edit)}</p>}
          </section>
        )}
        <ErrorNote>{error}</ErrorNote>
      </div>

      <aside className="lg:sticky lg:top-0 self-start space-y-2">
        <div className="text-12 font-semibold uppercase tracking-wide text-slate-400">How it will look on Google</div>
        <div className="bg-white rounded-2xl ring-1 ring-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-2.5 p-3"><BusinessAvatar name={b.name} src={b.logo} size="w-9 h-9" /><div className="min-w-0"><div className="text-13 font-medium text-slate-900 truncate">{b.name}</div><div className="text-11.5 text-slate-500">Just now · {edit.post_type === 'Update' ? 'Update' : edit.post_type}</div></div></div>
          {img ? <img src={img} alt="" className="w-full aspect-[4/3] object-cover bg-slate-100" onError={() => setBroken(true)} /> : <div className="w-full aspect-[4/3] bg-gradient-to-br from-sky-100 to-emerald-100 flex flex-col items-center justify-center gap-1 text-slate-400"><ImageIcon size={28} /><span className="text-12">Add a picture</span></div>}
          <div className="p-3.5">
            {edit.title && edit.post_type !== 'Update' && <div className="text-14 font-medium text-slate-900 mb-1">{edit.title}</div>}
            {edit.post_type !== 'Update' && (edit.starts_on || edit.ends_on) && <div className="text-12.5 text-slate-500 mb-1.5">{shortDay(edit.starts_on)}{edit.start_time && edit.post_type === 'Event' ? `, ${edit.start_time}` : ''}{edit.ends_on && edit.ends_on !== edit.starts_on ? ` – ${shortDay(edit.ends_on)}` : ''}{edit.end_time && edit.post_type === 'Event' ? `${edit.ends_on && edit.ends_on !== edit.starts_on ? ', ' : ' – '}${edit.end_time}` : ''}</div>}
            <p className="text-13 text-slate-700 whitespace-pre-line break-words">{edit.body || <span className="text-slate-400">Your description appears here.</span>}</p>
            {(edit.tags || []).length > 0 && <p className="text-13 text-blue-700 mt-2 break-words">{edit.tags.join(' ')}</p>}
            {edit.post_type === 'Offer' && edit.coupon_code.trim() && <div className="mt-3 inline-block rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-1.5 text-12.5"><span className="text-slate-500">Use code </span><span className="font-mono font-semibold text-slate-900">{edit.coupon_code.trim()}</span></div>}
            {edit.post_type === 'Offer' && edit.terms.trim() && <p className="text-11.5 text-slate-400 mt-2">{edit.terms.trim()}</p>}
            {edit.cta_type && <div className="mt-3 flex flex-wrap gap-2"><span className="inline-flex h-8 px-4 items-center rounded-full ring-1 ring-slate-300 text-13 font-medium text-blue-700">{CTA[edit.cta_type]}</span>{edit.post_type === 'Offer' && edit.redeem_url.trim() && <span className="inline-flex h-8 px-4 items-center rounded-full bg-blue-600 text-13 font-medium text-white">Redeem online</span>}</div>}
          </div>
        </div>
        <div className={`text-12 text-right tabular-nums ${total > 1500 ? 'text-red-600' : 'text-slate-400'}`}>{total}/1500 characters</div>
      </aside>
    </div>
  );
}

function PostsTab({ b, toast }) {
  const posts = useApi(`/businesses/${b.id}/posts`);
  const [edit, setEdit] = useState(null);
  const [busy, error, run, setError] = useAction();
  const open = () => { setError(''); setEdit({ post_type: 'Update', title: '', body: '', tags: [], image_url: '', cta_type: 'LEARN_MORE', cta_url: b.booking_url || b.website || '', scheduled_for: '', starts_on: '', ends_on: '', start_time: '', end_time: '', coupon_code: '', redeem_url: '', terms: '' }); };
  const save = (now = false) => run(now ? 'now' : 'save', async () => {
    const made = await api(`/businesses/${b.id}/posts`, { method: 'POST', body: cleanPost(edit) });
    if (now) await api(`/businesses/${b.id}/gbp/posts/${made.id}/publish`, { method: 'POST' });
    setEdit(null); posts.reload(true);
    toast(now ? 'Shared on your Google Business Profile' : 'Post saved and sent to the approval queue: it goes live on Google once approved');
  });
  const publish = (id) => run(`p${id}`, async () => { await api(`/businesses/${b.id}/gbp/posts/${id}/publish`, { method: 'POST' }); posts.reload(true); toast('Published on your Google Business Profile'); });
  const aiDraft = () => run('draft', async () => { await api(`/businesses/${b.id}/posts/draft`, { method: 'POST' }); posts.reload(true); toast('AI drafted this week\'s post (in the approval queue)'); });
  const [ask, confirmNode] = useDoubleConfirm();
  const del = (id) => ask({ what: 'this post', effect: 'The draft or scheduled post is deleted and will not be published.', onConfirm: () => run(`d${id}`, async () => { await api(`/businesses/${b.id}/posts/${id}`, { method: 'DELETE' }); posts.reload(true); }) });
  return (
    <>
      {confirmNode}
      <Card title="Posts" subtitle="One or two Updates or Offers a week keeps the profile active. Every post is approved before it goes live."
        action={<div className="flex gap-2"><Button variant="ai" icon={Sparkles} busy={busy === 'draft'} onClick={aiDraft}>AI draft</Button><Button variant="primary" icon={Plus} onClick={open}>New post</Button></div>}>
        <ErrorNote>{!edit && error}</ErrorNote>
        {!posts.data ? <SkList rows={4} thumb /> : posts.data.length === 0 ? <div className="py-8 text-center text-13 text-gray-500">No posts yet.</div> : (
          <div className="divide-y divide-gray-100">
            {posts.data.map(p => (
              <div key={p.id} className="flex items-start gap-3 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap"><Badge tone={p.post_type === 'Offer' ? 'orange' : p.post_type === 'Event' ? 'violet' : 'blue'}>{p.post_type}</Badge>{p.title && <span className="text-13 font-medium text-gray-900">{p.title}</span>}{p.ai_generated && <Badge tone="violet"><Sparkles size={10} /> AI</Badge>}</div>
                  <p className="text-12 text-gray-600 mt-1 line-clamp-2">{p.body}</p>
                  <div className="text-11 text-gray-500 mt-1">{CTA[p.cta_type] || '—'} · {p.published_at ? `published ${fmtDate(p.published_at)}` : p.scheduled_for ? `for ${fmtDate(p.scheduled_for)}` : `created ${fmtDate(p.created_at)}`}</div>
                </div>
                <StatusPill level={p.status === 'published' ? 'good' : p.status === 'failed' ? 'critical' : 'warning'}>{p.status === 'published' ? 'Live' : p.status === 'failed' ? 'Failed' : 'Waiting for approval'}</StatusPill>
                {p.status !== 'published' && isLinked(b) && <Button size="sm" variant="primary" busy={busy === `p${p.id}`} onClick={() => publish(p.id)}>Share on Google</Button>}
                {p.status !== 'published' && <button onClick={() => del(p.id)} className="p-1 text-gray-400 hover:text-red-600 cursor-pointer" aria-label="Delete"><Trash2 size={14} /></button>}
              </div>
            ))}
          </div>
        )}
      </Card>
      <div className="mt-4"><LivePosts b={b} toast={toast} /></div>
      <Modal open={Boolean(edit)} title="New post" onClose={() => setEdit(null)} width="max-w-5xl" footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button icon={Send} busy={busy === 'save'} disabled={!edit?.body.trim() || postText(edit).length > 1500 || Boolean(postProblem(edit))} onClick={() => save(false)}>Save for approval</Button>{isLinked(b) && <Button variant="primary" icon={Send} busy={busy === 'now'} disabled={!edit?.body.trim() || postText(edit).length > 1500 || Boolean(postProblem(edit))} onClick={() => save(true)}>Share on Google</Button>}</>}>
        {edit && <PostEditor b={b} edit={edit} setEdit={setEdit} toast={toast} error={error} />}
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
      <div className="xl:col-span-2"><MediaManager b={b} toast={toast} /></div>
      <Card title="Photo checklist" subtitle="The photos themselves are on the Live from Google tab">
        <div className="text-3xl font-semibold text-gray-900">{b.photo_count ?? '—'}</div>
        <div className="text-12 text-gray-500 mt-1">{b.photo_count == null ? 'Connect the Google profile to count photos.' : b.photo_count >= 10 ? 'Good: keep adding real photos weekly.' : 'Aim for 10+ real photos: outside, inside, team, work. No stock images.'}</div>
        <div className="mt-4 space-y-2 text-13">
          {[['10 or more photos', (b.photo_count || 0) >= 10], ['Cover photo set', Boolean(b.cover_photo)], ['Logo set', Boolean(b.logo)]].map(([l, ok]) => <div key={l} className="flex items-center gap-2">{ok ? <CheckCircle2 size={15} className="text-emerald-600" /> : <Circle size={15} className="text-gray-300" />}<span className={ok ? 'text-gray-800' : 'text-gray-500'}>{l}</span></div>)}
        </div>
        <p className="text-11 text-gray-500 mt-4">Upload photos in the Google Business Profile app; geo-relevant file names help (e.g. {`${(b.primaryCategory || 'business').toLowerCase().replace(/\s/g, '-')}-${(b.area || 'area').toLowerCase()}.webp`}).</p>
      </Card>
      {!isLinked(b) && <Card title="Cover photo and logo">
        <div className="space-y-3">
          <Field label="Cover photo URL"><input className={inputCls} value={cover} onChange={e => setCover(e.target.value)} placeholder="https://" /></Field>
          <Field label="Logo URL"><input className={inputCls} value={logo} onChange={e => setLogo(e.target.value)} placeholder="https://" /></Field>
          <ErrorNote>{error}</ErrorNote>
          <Button variant="primary" icon={Save} busy={busy === 'save'} onClick={save}>Save</Button>
        </div>
      </Card>}
    </div>
  );
}

function HoursTab({ b, toast }) {
  const [rows, setRows] = useState(() => hoursFrom(b.hours));
  const [special, setSpecial] = useState(() => b.special_hours || []);
  const [status, setStatus] = useState(() => ({ open_status: b.open_status || 'OPEN', opening_date: b.opening_date || '' }));
  const [more, setMore] = useState(() => Object.entries(b.more_hours || {}).map(([type, periods]) => ({ type, rows: hoursFrom({ periods }) })));
  const [busy, error, run] = useAction();
  const save = () => run('save', async () => {
    const moreBody = Object.fromEntries(more.map(m => [m.type, hoursTo(m.rows).periods]));
    const body = { hours: hoursTo(rows), special_hours: special };
    if (status.open_status !== (b.open_status || 'OPEN')) body.open_status = status.open_status;
    if (status.opening_date !== (b.opening_date || '')) body.opening_date = status.opening_date || null;
    if (JSON.stringify(moreBody) !== JSON.stringify(b.more_hours || {})) body.more_hours = moreBody;
    const r = await api(`/businesses/${b.id}`, { method: 'PATCH', body });
    await refreshBusinesses();
    toast(pushedMsg(r, 'Hours saved'));
  });
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <div className="xl:col-span-2"><StatusCard value={status} onChange={setStatus} /></div>
      <Card title="Opening hours">
        <QuickHoursActions setRows={setRows} />
        <WeekEditor rows={rows} setRows={setRows} />
      </Card>
      <Card title="Special hours" subtitle="Festivals and holidays" action={<Button size="sm" icon={Plus} onClick={() => setSpecial(s => [...s, { date: new Date().toISOString().slice(0, 10), name: 'Holiday', closed: true }])}>Add day</Button>}>
        {special.length === 0 ? <div className="text-13 text-gray-500 py-4">None yet.</div> : (
          <div className="divide-y divide-gray-100">
            {special.map((s, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 py-2">
                <input type="date" className={`${inputCls} w-36`} value={s.date} onChange={e => setSpecial(l => l.map((x, j) => j === i ? { ...x, date: e.target.value } : x))} />
                <input className={`${inputCls} flex-1 min-w-[140px]`} value={s.name} onChange={e => setSpecial(l => l.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                <Select className={`${inputCls} w-28`} value={s.closed ? 'closed' : 'open'} onChange={e => setSpecial(l => l.map((x, j) => j === i ? { ...x, closed: e.target.value === 'closed', open: x.open || '10:00', close: x.close || '14:00' } : x))}><option value="closed">Closed</option><option value="open">Open</option></Select>
                {!s.closed && <><input type="time" className={`${inputCls} w-24`} value={s.open || '10:00'} onChange={e => setSpecial(l => l.map((x, j) => j === i ? { ...x, open: e.target.value } : x))} /><input type="time" className={`${inputCls} w-24`} value={s.close || '14:00'} onChange={e => setSpecial(l => l.map((x, j) => j === i ? { ...x, close: e.target.value } : x))} /></>}
                <button onClick={() => setSpecial(l => l.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600 cursor-pointer" aria-label="Remove"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </Card>
      <div className="xl:col-span-2"><MoreHoursCard value={more} onChange={setMore} /></div>
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
      {!ins.data ? <SkChart h="h-64" /> : weekly.length === 0 ? <div className="py-12 text-center text-13 text-gray-500">No insights yet: they arrive once the Google profile is connected and synced.</div> : (
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
  const [params, setParams] = useSearchParams();
  const section = (tab === 'performance' && params.get('view')) ? 'traffic' : (TAB_ALIAS[tab] || tab); // old ?tab=performance&view=… links
  const sub = params.get('sub') || (tab === 'hours' || tab === 'faq' ? tab : 'live');
  const setSub = (v) => setParams(p => { const n = new URLSearchParams(p); n.set('tab', 'profile'); n.set('sub', v); return n; }, { replace: true });
  const trafficView = TRAFFIC_VIEWS.some(v => v.id === params.get('view')) ? params.get('view') : 'overview';
  const go = (id, s) => { if (id === 'profile' && s) setSub(s); else setTab(id); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const [syncing, setSyncing] = useState(false);
  const [panel, setPanel] = useState(null); // an edit panel that opens on this page, so nothing navigates away
  const [version, setVersion] = useState(0); // bumped after a save or sync: the sections reload their Google data in place
  const closePanel = () => { setPanel(null); setVersion(v => v + 1); };
  const sync = async () => {
    setSyncing(true);
    try { const r = await api(`/businesses/${b.id}/sync`, { method: 'POST' }); toast(`Synced from Google: ${r.reviews} reviews, ${r.photos ?? 0} photos`); await refreshBusinesses(); setVersion(v => v + 1); } catch (e) { toast(e.message || 'Sync failed'); } finally { setSyncing(false); }
  };
  return (
    <div className="space-y-4">
      <ClientBar b={b} onConnect={onConnect} onSync={sync} syncing={syncing} version={version} />
      {!(b.gbp_location && b.connection_id) && <ListingStatus b={b} toast={toast} onFind={() => { onConnect('email'); setTimeout(() => document.querySelector('input[aria-label="Business email"]')?.focus(), 400); }} />}
      <div className="grid grid-cols-1 gap-5 items-start">
        <div className="min-w-0" key={version}>
          {section === 'overview' && <AccessGate b={b} kind="gmb"><OverviewSection b={b} go={go} onOpen={setPanel} /></AccessGate>}
          {section === 'profile' && (
            <>
              <SectionHead title="Business Profile" subtitle="Name, categories, address, contact, hours, services, attributes and verification" sources={['google', 'manual']} />
              <Tabs value={sub} onChange={setSub} tabs={[{ id: 'live', label: 'Live from Google' }, { id: 'edit', label: 'Edit profile' }, { id: 'hours', label: 'Hours' }, { id: 'faq', label: 'Q&A / FAQs' }]} />
              {sub === 'live' && <AccessGate b={b} kind="gmb"><GbpLive b={b} toast={toast} onConnect={onConnect} /></AccessGate>}
              {sub === 'edit' && <div className="space-y-4"><ProfileTab b={b} toast={toast} /><MarketCard b={b} /></div>}
              {sub === 'hours' && <HoursTab b={b} toast={toast} />}
              {sub === 'faq' && <FaqTab b={b} toast={toast} />}
            </>
          )}
          {section === 'performance' && (
            <>
              <SectionHead title="Performance" subtitle="How customers find and act on the profile" sources={['google']} />
              <AccessGate b={b} kind="gmb"><div className="space-y-4"><PerformanceMetrics b={b} /><InsightsTab b={b} /></div></AccessGate>
            </>
          )}
          {section === 'traffic' && (
            <>
              <SectionHead title="Website traffic" subtitle="Visitors, sessions, channels and pages from Google Analytics 4" />
              <BusinessTraffic b={b} initialView={trafficView} />
            </>
          )}
          {section === 'reviews' && <AccessGate b={b} kind="gmb"><ReviewsSection b={b} toast={toast} /></AccessGate>}
          {section === 'posts' && <><SectionHead title="Posts & Content" subtitle="What's New, Offer and Event posts with approval before publishing" sources={['google', 'ai']} /><AccessGate b={b} kind="gmb"><PostsTab b={b} toast={toast} /></AccessGate></>}
          {section === 'photos' && <><SectionHead title="Photos & Media" subtitle="Logo, cover, photos and missing-media checks" sources={['google', 'calc']} /><AccessGate b={b} kind="gmb"><PhotosTab b={b} toast={toast} /></AccessGate></>}
          {['local-seo', 'aeo', 'geo', 'competitors', 'reports'].includes(section) && <ToolSection id={section} go={go} />}
          {section === 'ai' && <><SectionHead title="AI Recommendations" subtitle="Profile audit, health score and what to fix first" sources={['calc', 'ai']} /><AuditTab b={b} onEditProfile={() => go('profile', 'edit')} /></>}
          {section === 'tasks' && <TasksSection b={b} />}
          {section === 'sync' && <SyncSection b={b} onSync={sync} syncing={syncing} />}
          {section === 'settings' && <SettingsSection b={b} onConnect={onConnect} toast={toast} />}
        </div>
      </div>
      <Drawer open={panel === 'profile'} onClose={closePanel} width="max-w-4xl" title="Edit profile and hours" subtitle="Saved changes are sent straight to your Google Business Profile">
        <div className="gbp-compact space-y-4"><ProfileTab b={b} toast={toast} /><HoursTab b={b} toast={toast} /></div>
      </Drawer>
      <Drawer open={panel === 'posts'} onClose={closePanel} width="max-w-3xl" title="Posts" subtitle="Write a post and publish it to Google, or send it for approval">
        <div className="gbp-compact"><PostsTab b={b} toast={toast} /></div>
      </Drawer>
      <Drawer open={panel === 'photos'} onClose={closePanel} width="max-w-4xl" title="Photos and media" subtitle="Uploads go straight to your Google Business Profile">
        <div className="gbp-compact"><MediaManager b={b} toast={toast} /></div>
      </Drawer>
      <Drawer open={panel === 'reviews'} onClose={closePanel} width="max-w-4xl" title="Reviews" subtitle="Replies you post here appear on Google">
        <div className="gbp-compact"><ReviewsSection b={b} toast={toast} /></div>
      </Drawer>
    </div>
  );
}

/** The create-profile window for the project in the header (rendered outside the page body, so it reads the selected project itself). */
function SeoBusinessCreate({ open, onClose, toast }) {
  const [b] = useSeoBusiness();
  return b ? <CreateOnGoogle b={b} open={open} onClose={onClose} toast={toast} /> : null;
}

export default function GbpManagerPage({ initialTab = 'overview' }) {
  const [tab, setTab] = useUrlTab(initialTab, [...SECTION_IDS, ...Object.keys(TAB_ALIAS)]);
  const [, setBusiness] = useSeoBusiness();
  const location = useLocation();
  const navigate = useNavigate();
  const [addOpen, setAddOpen] = useState(false); // find by email (public Maps data)
  const [createOpen, setCreateOpen] = useState(false); // create a new Google profile from the project's details
  const [googleOpen, setGoogleOpen] = useState(false); // Google accounts: connect, then pick the businesses to add
  const addRef = useRef(null);
  const openAdd = () => { setAddOpen(true); setTimeout(() => addRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); };
  const [toast, toastNode] = useToast();
  // ?connect=1 (from the business switcher) opens the Google accounts window.
  useEffect(() => {
    if (new URLSearchParams(location.search).get('connect')) { setGoogleOpen(true); navigate(location.pathname, { replace: true }); }
  }, [location.search, location.pathname, navigate]);
  const account = Number(new URLSearchParams(location.search).get('account')) || null; // just connected (from Google sign-in)
  return (
    <>
      <SeoShell title="Google Business Profile" subtitle="Each project's Google Business Profile, read live: profile, photos, posts, reviews and search data, plus its audit, hours and insights" needsBusiness={false}>
        {(b) => (
          <div className="space-y-5">
            {!(b && isLinked(b)) && (
              <div className="ai-glass-card rounded px-5 py-3 flex flex-wrap items-center gap-3">
                <span className="flex-1 min-w-[200px] text-13 text-slate-600">Add a project's Google Business Profile.</span>
                <Button size="sm" variant="primary" icon={PlugZap} onClick={() => setGoogleOpen(true)}>Connect Google account</Button>
                <Button size="sm" icon={Search} onClick={() => (addOpen ? setAddOpen(false) : openAdd())}>Find by email</Button>
                {b && <Button size="sm" icon={Plus} onClick={() => setCreateOpen(true)}>Create new profile</Button>}
              </div>
            )}
            <div ref={addRef} className="scroll-mt-24">
              <GbpAccounts business={b} toast={toast} open={addOpen} onToggle={() => setAddOpen(false)}
                onOpenBusiness={(id) => { setBusiness(id); setTab('overview'); setAddOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
            </div>
            {b && <Manager key={b.id} b={b} tab={tab} setTab={setTab} toast={toast} onConnect={(mode) => (mode === 'email' ? openAdd() : setGoogleOpen(true))} />}
          </div>
        )}
      </SeoShell>
      <SeoBusinessCreate open={createOpen} onClose={() => setCreateOpen(false)} toast={toast} />
      <Modal open={googleOpen} onClose={() => setGoogleOpen(false)} width="max-w-3xl" title="Connect Google account">
        <GoogleSignIn initialAccount={account} toast={toast}
          onOpenBusiness={(id) => { setBusiness(id); setTab('overview'); setGoogleOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
      </Modal>
      {toastNode}
    </>
  );
}
