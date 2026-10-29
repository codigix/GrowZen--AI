import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Globe, Mail, MapPin, Phone, Building2, Star, ExternalLink, CheckCircle2, XCircle, AlertTriangle, ArrowRight, ArrowLeft,
  Sparkles, Loader2, Plus, X, Rocket, Clock, Cpu, Store, Gauge, Link2, PenLine, ShieldCheck, Check, Tags, Layers
} from 'lucide-react';
import { SeoShell, Card, Badge, Button, Field, inputCls, areaCls, ErrorNote, useAction, useBusinesses, refreshBusinesses, useSeoBusiness, useModulePath } from './SeoUi';
import { api, useApi } from './seoApi';
import LocationMap from './LocationMap';
import { useAssist, AssistantPanel, FieldBadge, FieldFix, Suggestion } from './OnboardingAssistant';

/**
 * Onboard a new client in three steps.
 * 1. Find: POST /discover reads the business's website (from the URL or the email's domain) and searches
 *    Google Maps (when GOOGLE_PLACES_API_KEY is set), returning candidates with where each fact came from.
 * 2. Review: the chosen candidate fills the form; everything can be corrected or completed.
 * 3. Launch: POST /discover/import creates the project (or matches an existing one), imports Google reviews
 *    and starts the onboarding run (full audit, planned fixes, the plan's schedule). The remaining fields are
 *    saved with PATCH /businesses/{id}, seed keywords with POST /businesses/{id}/keywords, and the audit's
 *    progress is followed live.
 */

const STEPS = [['find', 'Find the business'], ['review', 'Review the details'], ['launch', 'Launch onboarding']];
const AREAS = [['gbp', 'Google profile'], ['rankings', 'Local rankings'], ['technical', 'Technical SEO'], ['onpage', 'On-page SEO'], ['backlinks', 'Backlinks'], ['citations', 'Citations']];
const PLANS = ['Starter', 'Growth', 'Pro', 'Agency'];
const JOB_LABELS = { full_audit: 'Full SEO audit', rank_scan: 'Rank tracking', technical: 'Technical SEO', reviews: 'Review management', posts: 'GBP posts', report: 'Monthly report', geo: 'AI search visibility' };
const EVERY = { daily: 'daily', weekly: 'weekly', fortnightly: 'every 2 weeks', monthly: 'monthly' };
const CATEGORIES = ['Dentist', 'Hospital', 'Eye care center', 'Medical clinic', 'Physiotherapist', 'Dermatologist', 'Restaurant', 'Cafe', 'Bakery', 'Hotel', 'Gym', 'Beauty salon',
  'Real estate agency', 'Lawyer', 'Accountant', 'School', 'Coaching center', 'Car repair', 'Interior designer', 'Software company', 'Manufacturer', 'Store'];
const EMPTY = { name: '', primary_category: '', description: '', phone: '', website: '', address: '', area: '', city: '', contact_name: '', contact_email: '', booking_url: '', plan: 'Growth', services: [], keywords: [], attributes: [], lat: null, lng: null };

// Google Maps and schema.org placeholders when they don't know the real category: never a category to keep.
const realCategory = (c) => (/^(services?|organization|local ?business|corporation|business|point of interest|establishment|store|company|professional ?services?)$/i.test(String(c || '').trim()) ? '' : String(c || '').trim());
const digits = (s) => String(s || '').replace(/\D/g, '').slice(-10);
const domainOf = (u) => { try { return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } };
const normaliseUrl = (u) => { const s = String(u || '').trim(); if (!s) return ''; return /^https?:\/\//i.test(s) ? s : `https://${s}`; };

/** An existing project that is the same business (same Google place, phone, website or name). */
function findExisting(list, c) {
  if (!list || !c) return null;
  return list.find(b => (c.place_id && b.place_id === c.place_id)
    || (digits(c.phone) && digits(b.phone) === digits(c.phone))
    || (domainOf(c.website || '') && domainOf(b.website || '') === domainOf(c.website || ''))
    || (c.name && b.name.trim().toLowerCase() === c.name.trim().toLowerCase())) || null;
}

function Stepper({ step }) {
  const idx = STEPS.findIndex(([id]) => id === step);
  return (
    <nav aria-label="Onboarding progress" className="mb-5">
      <div className="sm:hidden text-[12px] font-semibold text-slate-600">Step {idx + 1} of {STEPS.length} · <span className="text-slate-900">{STEPS[idx][1]}</span></div>
      <div className="sm:hidden mt-2 h-1.5 rounded-full bg-slate-200 overflow-hidden"><div className="h-full bg-indigo-600 rounded-full transition-all" style={{ width: `${((idx + 1) / STEPS.length) * 100}%` }} /></div>
      <ol className="hidden sm:flex items-center gap-3">
        {STEPS.map(([id, label], i) => {
          const state = i < idx ? 'done' : i === idx ? 'current' : 'todo';
          return (
            <React.Fragment key={id}>
              {i > 0 && <span className={`flex-1 h-px ${i <= idx ? 'bg-indigo-300' : 'bg-slate-200'}`} />}
              <li className="flex items-center gap-2.5 shrink-0" aria-current={state === 'current' ? 'step' : undefined}>
                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold ${state === 'current' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/30' : state === 'done' ? 'bg-emerald-500 text-white' : 'bg-white text-slate-400 ring-1 ring-inset ring-slate-300'}`}>
                  {state === 'done' ? <Check size={14} /> : i + 1}
                </span>
                <span className={`text-[13px] font-semibold ${state === 'todo' ? 'text-slate-400' : 'text-slate-900'}`}>{label}</span>
              </li>
            </React.Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

/** Two columns on wide screens: the step, and a side column that stays in view. */
function StepLayout({ side, children }) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
      <div className="xl:col-span-2 space-y-4 min-w-0">{children}</div>
      <aside className="space-y-4 min-w-0 xl:sticky xl:top-24">{side}</aside>
    </div>
  );
}

/** Back / next, pinned to the bottom of the screen so the next action is always in reach. */
function ActionBar({ onBack, backLabel = 'Back', onNext, nextLabel, nextIcon: NextIcon = ArrowRight, hint, busy }) {
  return (
    <div className="sticky bottom-3 z-20">
      <div className="rounded-2xl bg-white/95 backdrop-blur ring-1 ring-slate-200 shadow-lg shadow-slate-900/5 px-3 py-2.5 flex items-center gap-3">
        {onBack ? <Button icon={ArrowLeft} onClick={onBack}>{backLabel}</Button> : <span />}
        <span className="hidden sm:block flex-1 min-w-0 text-center text-[12px] text-slate-500 truncate">{hint}</span>
        <span className="sm:hidden flex-1" />
        {onNext && <Button variant="primary" busy={busy} onClick={onNext}>{nextLabel} {NextIcon && <NextIcon size={14} />}</Button>}
      </div>
    </div>
  );
}

function Chips({ values, onChange, placeholder, suggestions = [], max = 6 }) {
  const [text, setText] = useState('');
  const add = (v) => {
    const parts = String(v).split(',').map(s => s.trim()).filter(Boolean);
    const next = [...values];
    parts.forEach(p => { if (!next.some(x => x.toLowerCase() === p.toLowerCase())) next.push(p); });
    onChange(next);
    setText('');
  };
  const unused = suggestions.filter(s => !values.some(v => v.toLowerCase() === s.toLowerCase())).slice(0, max);
  return (
    <div>
      <div className="min-h-[38px] w-full px-2 py-1.5 rounded-xl bg-white ring-1 ring-inset ring-slate-300 focus-within:ring-indigo-400 flex flex-wrap gap-1.5 items-center">
        {values.map(v => (
          <span key={v} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-lg bg-indigo-50 ring-1 ring-inset ring-indigo-200 text-[12px] text-indigo-800">
            {v}<button type="button" onClick={() => onChange(values.filter(x => x !== v))} className="p-0.5 rounded hover:bg-indigo-100 cursor-pointer" aria-label={`Remove ${v}`}><X size={11} /></button>
          </span>
        ))}
        <input value={text} onChange={e => setText(e.target.value)} placeholder={values.length ? '' : placeholder}
          onKeyDown={e => { if ((e.key === 'Enter' || e.key === ',') && text.trim()) { e.preventDefault(); add(text); } else if (e.key === 'Backspace' && !text && values.length) onChange(values.slice(0, -1)); }}
          onBlur={() => text.trim() && add(text)} className="flex-1 min-w-[140px] h-7 px-1 text-[13px] outline-none bg-transparent text-slate-900 placeholder-slate-400" />
      </div>
      {unused.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1 items-center">
          <span className="text-[11px] text-slate-500 inline-flex items-center gap-1"><Sparkles size={11} className="text-violet-500" /> Suggestions:</span>
          {unused.map(s => <button key={s} type="button" onClick={() => add(s)} className="text-[11px] px-1.5 py-0.5 rounded-md bg-violet-50 text-violet-800 ring-1 ring-inset ring-violet-200 hover:bg-violet-100 cursor-pointer">+ {s}</button>)}
        </div>
      )}
    </div>
  );
}

/* ── Step 1: find ─────────────────────────────────────────────────────── */

function CandidateCard({ c, existing, onUse, onOpenExisting }) {
  const fromMaps = c.source === 'google_maps';
  return (
    <div className={`rounded-2xl ring-1 ring-inset p-4 flex flex-col gap-3 bg-white ${c.confidence === 'high' ? 'ring-emerald-300 shadow-sm' : 'ring-slate-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <Badge tone={fromMaps ? 'blue' : 'violet'}>{fromMaps ? <><Store size={11} /> Google Maps</> : <><Globe size={11} /> Website</>}</Badge>
            {c.confidence === 'high' && <Badge tone="green"><CheckCircle2 size={11} /> Best match</Badge>}
            {c.status && c.status !== 'OPERATIONAL' && <Badge tone="red">{c.status.toLowerCase().replace(/_/g, ' ')}</Badge>}
          </div>
          <div className="text-[15px] font-semibold text-slate-900">{c.name}</div>
          {c.category && <div className="text-[12px] text-slate-500">{c.category}</div>}
        </div>
        {c.rating != null && <div className="text-right shrink-0"><div className="text-[15px] font-bold text-slate-900 inline-flex items-center gap-1"><Star size={14} className="fill-amber-400 text-amber-400" />{c.rating}</div>{c.review_count != null && <div className="text-[11px] text-slate-500">{c.review_count} reviews</div>}</div>}
      </div>
      <ul className="space-y-1 text-[12px] text-slate-700">
        {c.address && <li className="flex gap-2"><MapPin size={13} className="text-slate-400 mt-0.5 shrink-0" />{c.address}</li>}
        {c.phone && <li className="flex gap-2"><Phone size={13} className="text-slate-400 mt-0.5 shrink-0" />{c.phone}</li>}
        {c.website && <li className="flex gap-2"><Globe size={13} className="text-slate-400 mt-0.5 shrink-0" /><span className="truncate">{c.website}</span></li>}
        {c.hours?.length > 0 && <li className="flex gap-2"><Clock size={13} className="text-slate-400 mt-0.5 shrink-0" />Opening hours for {c.hours.length} days</li>}
      </ul>
      <div className="text-[11px] text-slate-500">Matched by {c.match}{c.lat != null ? ' · map pin included' : ''}</div>
      {existing && (
        <div className="rounded-xl bg-amber-50 ring-1 ring-inset ring-amber-200 px-3 py-2 text-[12px] text-amber-900 flex items-start gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>Already a project: <b>{existing.name}</b>. Using it updates that project's missing details instead of creating a duplicate. <button onClick={() => onOpenExisting(existing.id)} className="font-semibold underline cursor-pointer">Open it</button></span>
        </div>
      )}
      <div className="mt-auto flex items-center justify-between gap-2">
        {c.maps_url ? <a href={c.maps_url} target="_blank" rel="noreferrer" className="text-[12px] font-medium text-indigo-700 hover:underline inline-flex items-center gap-1">View on Google Maps <ExternalLink size={11} /></a> : <span />}
        <button onClick={() => onUse(c)} className="h-9 px-3.5 rounded-xl text-[13px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 inline-flex items-center gap-1.5 cursor-pointer">Use this <ArrowRight size={14} /></button>
      </div>
    </div>
  );
}

const SOURCE_LABEL = { project: 'Existing project', google_maps: 'Google Maps', openstreetmap: 'OpenStreetMap', website: 'Website' };

/** Business-name search with live suggestions (projects, Google Maps, OpenStreetMap); picking one fetches its details. */
function NameSearch({ value, onChange, city, onPick, onOpenExisting, onManual }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [resolving, setResolving] = useState(null);
  const [error, setError] = useState('');
  const box = useRef(null);
  const seq = useRef(0);
  // One Google Autocomplete session per search: the typing and the final pick are billed together.
  const newSession = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const session = useRef(newSession());

  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) { setData(null); setLoading(false); return undefined; }
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const d = await api(`/discover/suggest?q=${encodeURIComponent(q)}&near=${encodeURIComponent(city || '')}&session=${session.current}`);
        if (mine === seq.current) { setData(d); setActive(0); }
      } catch (e) { if (mine === seq.current) setData({ suggestions: [], notes: [e.message], sources: {} }); }
      if (mine === seq.current) setLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [value, city]);

  useEffect(() => {
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const items = data?.suggestions || [];
  const pick = async (s) => {
    setError('');
    if (s.source === 'project') { onOpenExisting(Number(s.ref)); return; }
    setResolving(s.ref);
    try {
      onPick(await api('/discover/resolve', { method: 'POST', body: { source: s.source, ref: s.ref, session: session.current } }));
      session.current = newSession();
      setOpen(false);
    } catch (e) { setError(e.message); }
    setResolving(null);
  };
  const onKey = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, items.length)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (active < items.length) pick(items[active]); else onManual(); }
    else if (e.key === 'Escape') setOpen(false);
  };
  const showList = open && value.trim().length >= 2;
  const badge = { project: 'bg-amber-50 text-amber-700', google_maps: 'bg-blue-50 text-blue-700', openstreetmap: 'bg-emerald-50 text-emerald-700' };

  return (
    <div ref={box} className="relative">
      <div className="relative">
        <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={value} onChange={e => { onChange(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey}
          role="combobox" aria-expanded={showList} aria-autocomplete="list" autoComplete="off"
          placeholder="Start typing the business name, e.g. Ruby Hall Clinic"
          className="w-full h-14 pl-11 pr-11 text-[15px] rounded-2xl bg-white ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-400 outline-none text-slate-900 placeholder-slate-400 shadow-sm" />
        {(loading || resolving) && <Loader2 size={17} className="absolute right-4 top-1/2 -translate-y-1/2 text-indigo-500 animate-spin" />}
      </div>
      {showList && (
        <div role="listbox" className="absolute z-30 mt-2 w-full bg-white rounded-2xl ring-1 ring-slate-200 shadow-xl overflow-hidden">
          {items.length > 0 && (
            <ul className="max-h-[380px] overflow-y-auto divide-y divide-slate-100">
              {items.map((s, i) => (
                <li key={`${s.source}-${s.ref}`} role="option" aria-selected={i === active}>
                  <button type="button" onMouseEnter={() => setActive(i)} onClick={() => pick(s)} disabled={!!resolving}
                    className={`w-full text-left px-4 py-3 flex items-start gap-3 cursor-pointer ${i === active ? 'bg-slate-50' : 'bg-white'}`}>
                    <span className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${s.source === 'project' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'}`}>
                      {resolving === s.ref ? <Loader2 size={15} className="animate-spin" /> : s.source === 'project' ? <Building2 size={15} /> : <MapPin size={15} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-medium text-slate-900">{s.title}</span>
                      {s.subtitle && <span className="block text-[12px] text-slate-500 leading-snug">{s.subtitle}</span>}
                    </span>
                    <span className={`shrink-0 mt-0.5 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${badge[s.source] || ''}`}>{SOURCE_LABEL[s.source]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!loading && data && !items.length && <div className="px-4 py-4 text-[13px] text-slate-600">No business called “{value.trim()}” found on the map.</div>}
          {loading && !data && <div className="px-4 py-4 text-[13px] text-slate-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Searching…</div>}
          {data?.notes?.map(n => <div key={n} className="px-4 py-2 text-[12px] text-amber-800 bg-amber-50 border-t border-amber-100">{n}</div>)}
          {data && data.sources && !data.sources.google_maps && <div className="px-4 py-2 text-[11px] text-slate-500 bg-slate-50 border-t border-slate-100">Google Maps suggestions are off: set GOOGLE_PLACES_API_KEY on the backend to search Google's listings too.</div>}
          <button type="button" onMouseEnter={() => setActive(items.length)} onClick={onManual}
            className={`w-full text-left px-4 py-3 border-t border-slate-100 text-[13px] font-medium text-indigo-700 flex items-center gap-2 cursor-pointer ${active === items.length ? 'bg-slate-50' : 'bg-white'}`}>
            <PenLine size={14} /> Can't find it? Enter “{value.trim()}” manually
          </button>
        </div>
      )}
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}

function FindStep({ query, setQuery, result, setResult, onUse, onManual, list, onOpenExisting }) {
  const [busy, error, run] = useAction();
  const [mode, setMode] = useState('name'); // name | website | email
  const find = () => run('find', async () => {
    const body = { website: mode === 'website' ? query.website.trim() : '', email: mode === 'email' ? query.email.trim() : '', name: mode === 'email' ? query.name.trim() : '', city: query.city.trim() };
    if (!body.website && !body.email) throw new Error(mode === 'website' ? 'Enter the website address.' : 'Enter the client\'s email.');
    setResult(await api('/discover', { method: 'POST', body }));
  });
  const set = (k) => (e) => setQuery({ ...query, [k]: e.target.value });
  const onEnter = (e) => e.key === 'Enter' && find();
  const freeMail = /@(gmail|googlemail|yahoo|outlook|hotmail|live|icloud|rediffmail|rediff|aol|proton|zoho)\./i.test(query.email);
  const tab = (id, Icon, label) => (
    <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => setMode(id)}
      className={`h-9 px-3.5 rounded-lg text-[13px] font-semibold inline-flex items-center gap-1.5 cursor-pointer ${mode === id ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800'}`}><Icon size={14} /> {label}</button>
  );
  const big = 'w-full h-12 pl-10 pr-3 text-[14px] rounded-xl bg-white ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-400 outline-none text-slate-900 placeholder-slate-400';
  return (
    <div className="space-y-4">
      <Card>
        <div className="text-center max-w-xl mx-auto pt-2">
          <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white inline-flex items-center justify-center shadow-md shadow-indigo-500/25"><Building2 size={20} /></span>
          <h2 className="mt-3 text-[18px] font-bold text-slate-900">Which business are you onboarding?</h2>
          <p className="mt-1 text-[13px] text-slate-500">Pick it from Google Maps and its location, contact details and hours are filled in for you.</p>
        </div>
        <div role="tablist" className="mt-5 mx-auto w-fit flex gap-0.5 p-0.5 rounded-xl bg-slate-100">
          {tab('name', Search, 'Business name')}{tab('website', Globe, 'Website')}{tab('email', Mail, 'Email')}
        </div>
        <div className="mt-4 max-w-2xl mx-auto">
          {mode === 'name' ? (
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
              <div className="sm:col-span-3"><NameSearch value={query.name} onChange={v => setQuery({ ...query, name: v })} city={query.city} onPick={onUse} onOpenExisting={onOpenExisting} onManual={onManual} /></div>
              <div className="relative"><MapPin size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" /><input value={query.city} onChange={set('city')} placeholder="City (optional)" aria-label="City" className={`${big} h-14 rounded-2xl pl-9`} /></div>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="relative">
                {mode === 'website' ? <Globe size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" /> : <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />}
                {mode === 'website'
                  ? <input className={big} placeholder="https://clientbusiness.com" value={query.website} onChange={set('website')} onKeyDown={onEnter} aria-label="Website" />
                  : <input className={big} placeholder="owner@clientbusiness.com" value={query.email} onChange={set('email')} onKeyDown={onEnter} aria-label="Client's email" />}
              </div>
              {mode === 'email' && freeMail && <input className={`${big} pl-3`} placeholder="Business name (needed for Gmail-type emails)" value={query.name} onChange={set('name')} onKeyDown={onEnter} aria-label="Business name" />}
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" icon={Search} busy={busy === 'find'} onClick={find}>{busy === 'find' ? 'Reading the website and Google Maps…' : 'Find business'}</Button>
                <span className="text-[12px] text-slate-500">{mode === 'website' ? 'Reads the site, then finds its Google Maps listing.' : 'A business email (not Gmail) leads to its website automatically.'}</span>
              </div>
            </div>
          )}
          <ErrorNote>{error}</ErrorNote>
          <div className="mt-4 text-center"><button type="button" onClick={onManual} className="text-[12.5px] font-medium text-slate-500 hover:text-indigo-700 inline-flex items-center gap-1.5 cursor-pointer"><PenLine size={13} /> Can't find it? Enter the details by hand</button></div>
        </div>
      </Card>

      {result && (
        <Card title={result.candidates.length ? `Found ${result.candidates.length} possible match${result.candidates.length === 1 ? '' : 'es'}` : 'Nothing found'}
          subtitle={result.candidates.length ? 'Pick the right one. You can correct every detail on the next step.' : 'Try another detail, or enter the business by hand.'}>
          {result.notes?.length > 0 && (
            <div className="mb-4 space-y-2">
              {result.notes.map(n => <div key={n} className="rounded-xl bg-amber-50 ring-1 ring-inset ring-amber-200 px-3 py-2 text-[12px] text-amber-900 flex gap-2"><AlertTriangle size={14} className="shrink-0 mt-0.5" />{n}</div>)}
            </div>
          )}
          {result.candidates.length ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {result.candidates.map((c, i) => <CandidateCard key={c.place_id || `${c.source}-${i}`} c={c} existing={findExisting(list, c)} onUse={onUse} onOpenExisting={onOpenExisting} />)}
            </div>
          ) : <Button variant="primary" icon={PenLine} onClick={onManual}>Enter details by hand</Button>}
        </Card>
      )}
    </div>
  );
}

/** Before a business is picked: what happens next. */
function AssistantPreview() {
  return (
    <Card title={<span className="inline-flex items-center gap-2"><Sparkles size={15} className="text-violet-600" /> Assistant</span>} subtitle="Runs as soon as you pick the business">
      <ul className="space-y-2.5">
        {[[ShieldCheck, 'Cross-checks the details', 'Name, phone, address, website and category against Google Maps and the website'],
          [AlertTriangle, 'Flags problems', 'Closed listing, keyword-stuffed name, website down, wrong phone, missing PIN code'],
          [Sparkles, 'Fills the gaps', 'Category, description, services, map pin and opening hours'],
          [Search, 'Finds real keywords', 'What people in the area actually type into Google']].map(([I, t, d]) => (
          <li key={t} className="flex items-start gap-2.5">
            <span className="w-7 h-7 rounded-lg bg-violet-50 text-violet-600 ring-1 ring-inset ring-violet-100 flex items-center justify-center shrink-0"><I size={14} /></span>
            <span className="min-w-0"><span className="block text-[13px] font-semibold text-slate-900">{t}</span><span className="block text-[12px] text-slate-500">{d}</span></span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ── Step 2: review ───────────────────────────────────────────────────── */

function PlanPicker({ value, onChange, plans }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
      {PLANS.map(p => {
        const jobs = Object.entries(plans?.[p] || {}).filter(([, every]) => every && every !== 'off');
        const on = value === p;
        return (
          <button key={p} type="button" onClick={() => onChange(p)} className={`text-left rounded-xl p-3 ring-1 ring-inset cursor-pointer transition-colors ${on ? 'bg-indigo-50 ring-indigo-400' : 'bg-white ring-slate-200 hover:bg-slate-50'}`}>
            <div className="flex items-center justify-between"><span className="text-[13px] font-semibold text-slate-900">{p}</span>{on && <CheckCircle2 size={15} className="text-indigo-600" />}</div>
            <div className="text-[11px] text-slate-500">{plans ? `${jobs.length} automatic services` : 'Loading…'}</div>
          </button>
        );
      })}
    </div>
  );
}

/** A card, or just a titled block when it sits inside another card. */
function Frame({ title, subtitle, bare, children }) {
  if (!bare) return <Card title={title} subtitle={subtitle}>{children}</Card>;
  return <div><div className="text-[12px] font-semibold text-slate-700">{title}</div><div className="text-[11px] text-slate-500 mb-2">{subtitle}</div>{children}</div>;
}

const ATTRIBUTE_IDEAS = ['Wheelchair accessible', 'Free Wi-Fi', 'Parking', 'Accepts UPI', 'Accepts cards', 'Air-conditioned', 'Online appointments', 'Home visits'];

/** Where the business is: OpenStreetMap with a draggable pin, typed address -> pin, pin -> address. */
function LocationCard({ form, setForm, source, bare = false }) {
  const [busy, error, run, setError] = useAction();
  const [matches, setMatches] = useState([]);
  const [pinAddress, setPinAddress] = useState(null);
  const typed = [form.address, form.area, form.city].map(x => x.trim()).filter(Boolean).join(', ');
  const move = (lat, lng) => { setForm(f => ({ ...f, lat, lng })); setPinAddress(null); setMatches([]); setError(''); };
  const find = () => run('find', async () => {
    if (typed.length < 3) throw new Error('Type the street address, area or city first.');
    const { results } = await api(`/discover/geocode?q=${encodeURIComponent(typed)}`);
    if (!results.length) throw new Error('OpenStreetMap could not place this address. Click the map where the business is instead.');
    move(results[0].lat, results[0].lng);
    setMatches(results.length > 1 ? results : []);
  });
  const fromPin = () => run('reverse', async () => setPinAddress(await api(`/discover/reverse?lat=${form.lat}&lng=${form.lng}`)));
  const applyPinAddress = () => {
    setForm(f => ({ ...f, address: pinAddress.address || f.address, area: pinAddress.area || f.area, city: pinAddress.city || f.city }));
    setPinAddress(null);
  };
  const btn = 'h-9 px-3 rounded-xl text-[12px] font-semibold bg-white ring-1 ring-inset ring-slate-200 text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50';
  return (
    <Frame title="Location on the map" subtitle="The exact pin drives local rankings. Drag it to the entrance, or click the map to place it." bare={bare}>
      <LocationMap lat={form.lat} lng={form.lng} onMove={move} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={find} disabled={busy === 'find'} className={btn}>{busy === 'find' ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Find the typed address on the map</button>
        <button type="button" onClick={fromPin} disabled={form.lat == null || busy === 'reverse'} className={btn}>{busy === 'reverse' ? <Loader2 size={13} className="animate-spin" /> : <MapPin size={13} />} Use the pin's address</button>
        <span className="ml-auto text-[12px] text-slate-500 tabular-nums">
          {form.lat != null ? <>Pin: {form.lat.toFixed(5)}, {form.lng.toFixed(5)}{source?.lat != null && source.lat === form.lat ? ` · from ${source.source === 'google_maps' ? 'Google Maps' : 'OpenStreetMap'}` : ''}</> : 'No pin yet'}
        </span>
      </div>
      <ErrorNote>{error}</ErrorNote>
      {matches.length > 0 && (
        <div className="mt-3 rounded-xl ring-1 ring-inset ring-slate-200 divide-y divide-slate-100">
          <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Other places matching this address</div>
          {matches.map((m, i) => (
            <button key={i} type="button" onClick={() => move(m.lat, m.lng)} className={`w-full text-left px-3 py-2 text-[12px] flex items-start gap-2 hover:bg-slate-50 cursor-pointer ${m.lat === form.lat && m.lng === form.lng ? 'bg-indigo-50/60' : ''}`}>
              <MapPin size={13} className="text-slate-400 mt-0.5 shrink-0" /><span className="text-slate-700">{m.label}</span>
            </button>
          ))}
        </div>
      )}
      {pinAddress && (
        <div className="mt-3 rounded-xl bg-indigo-50 ring-1 ring-inset ring-indigo-200 px-3 py-2.5 text-[12px] text-indigo-900 flex flex-wrap items-center gap-2">
          <MapPin size={14} className="shrink-0" />
          <span className="flex-1 min-w-0">At the pin: <b>{pinAddress.address || pinAddress.label}</b></span>
          <button type="button" onClick={applyPinAddress} className="h-8 px-3 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 cursor-pointer">Use this address</button>
          <button type="button" onClick={() => setPinAddress(null)} className="h-8 px-2 rounded-lg text-indigo-700 hover:bg-indigo-100 cursor-pointer">Keep mine</button>
        </div>
      )}
    </Frame>
  );
}

const SECTIONS = [['business', 'Business', Building2], ['contact', 'Contact', Phone], ['location', 'Location', MapPin], ['services', 'Services & keywords', Tags], ['plan', 'Plan', Layers]];
const ERROR_SECTION = { name: 'business', phone: 'contact', website: 'contact', contact_email: 'contact' };

function ReviewStep({ form, setForm, source, plans, existing, onBack, onNext }) {
  const assist = useAssist(form, source);
  const res = assist.res;
  const s = res?.suggestions;
  const f = res?.fields || {};
  const [section, setSection] = useState('business');
  const [tried, setTried] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const errors = {
    name: !form.name.trim() && 'The business name is required.',
    phone: !digits(form.phone) ? 'A phone number is needed for the Google profile and citations.' : digits(form.phone).length < 10 && 'This phone number looks too short.',
    website: form.website && !domainOf(form.website).includes('.') && 'This doesn\'t look like a website address.',
    contact_email: form.contact_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.contact_email) && 'This doesn\'t look like an email address.'
  };
  const keywordIdeas = useMemo(() => {
    const where = (form.area || form.city || '').split(',')[0].trim().toLowerCase();
    const base = [...form.services, form.primary_category].filter(Boolean).map(x => x.toLowerCase());
    return [...new Set([...(s?.keywords.values || []), ...base.flatMap(x => [where ? `${x} in ${where}` : null, `${x} near me`]).filter(Boolean)])];
  }, [form.services, form.primary_category, form.area, form.city, s]);
  const err = (k) => tried && errors[k] ? <span className="block text-[11px] text-red-600 mt-1">{errors[k]}</span> : null;
  const pick = (field, value, sources) => { setForm(x => ({ ...x, [field]: value })); assist.resolve(field, value, sources); };
  const merge = (list, add) => [...new Set([...list, ...add])];
  const applyAll = () => setForm(x => {
    const next = { ...x };
    Object.entries(f).forEach(([k, v]) => { if (v.status === 'suggested' && !String(x[k] || '').trim() && v.best) next[k] = v.best; });
    if (!x.primary_category.trim() && s.category.value) next.primary_category = s.category.value;
    if (x.description.trim().length < 250 && s.description.value) next.description = s.description.value;
    next.services = merge(x.services, s.services.values);
    next.keywords = merge(x.keywords, s.keywords.values.slice(0, 8));
    if (x.lat == null && s.pin) { next.lat = s.pin.lat; next.lng = s.pin.lng; }
    return next;
  });

  const conflict = (...keys) => keys.some(k => f[k]?.status === 'conflict');
  const status = {
    business: (tried && errors.name) || conflict('name', 'primary_category') ? 'attention' : form.name.trim() && form.primary_category.trim() && form.description.trim().length >= 250 ? 'done' : 'todo',
    contact: (tried && (errors.phone || errors.website || errors.contact_email)) || conflict('phone', 'website') ? 'attention' : digits(form.phone).length >= 10 && form.website.trim() && form.contact_email.trim() ? 'done' : 'todo',
    location: conflict('address') ? 'attention' : /\b[1-9]\d{5}\b/.test(form.address) && form.city.trim() && form.lat != null ? 'done' : 'todo',
    services: form.services.length >= 3 && form.keywords.length >= 3 ? 'done' : 'todo',
    plan: 'done'
  };
  const idx = SECTIONS.findIndex(([id]) => id === section);
  const go = (id) => { setSection(id); document.getElementById('onboarding-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const next = () => {
    if (idx < SECTIONS.length - 1) { go(SECTIONS[idx + 1][0]); return; }
    setTried(true);
    const bad = Object.entries(errors).find(([, v]) => v);
    if (bad) { go(ERROR_SECTION[bad[0]]); return; }
    onNext();
  };
  const label = (text, field) => <span className="inline-flex flex-wrap items-center gap-1.5">{text} <FieldBadge check={f[field]} /></span>;
  const jobs = Object.entries(plans?.[form.plan] || {}).filter(([, e]) => e && e !== 'off');

  return (
    <StepLayout side={<AssistantPanel assist={assist} form={form} onApplyAll={applyAll} onUseName={() => setForm(x => ({ ...x, name: s.name.value }))} />}>
      {source && (
        <div className="rounded-2xl bg-white ring-1 ring-inset ring-slate-200 px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-slate-600">
          <Store size={14} className="text-indigo-500" />
          <span>From <b className="text-slate-800">{{ google_maps: 'Google Maps', openstreetmap: 'OpenStreetMap', website: 'the website' }[source.source] || 'your entry'}</b>{source.rating != null ? ` · ★ ${source.rating} (${source.review_count || 0} reviews)` : ''}{source.photo_count ? ` · ${source.photo_count} photos` : ''}</span>
          {source.maps_url && <a href={source.maps_url} target="_blank" rel="noreferrer" className="ml-auto font-semibold text-indigo-700 hover:underline inline-flex items-center gap-1">View listing <ExternalLink size={11} /></a>}
        </div>
      )}
      {source?.status && source.status !== 'OPERATIONAL' && (
        <div className="rounded-xl bg-red-50 ring-1 ring-inset ring-red-200 px-4 py-2.5 text-[13px] text-red-800 flex gap-2"><AlertTriangle size={16} className="shrink-0 mt-0.5" /><span>Google lists this business as <b>{source.status === 'CLOSED_PERMANENTLY' ? 'permanently closed' : 'temporarily closed'}</b>. Check with the client before onboarding it.</span></div>
      )}
      {existing && <div className="rounded-xl bg-amber-50 ring-1 ring-inset ring-amber-200 px-4 py-2.5 text-[13px] text-amber-900 flex gap-2"><AlertTriangle size={16} className="shrink-0 mt-0.5" /><span>This looks like an existing project, <b>{existing.name}</b>. Launching fills in its missing details and re-runs its onboarding audit, without creating a duplicate.</span></div>}

      <section id="onboarding-form" className="ai-glass-card rounded-2xl overflow-hidden scroll-mt-24">
        <div role="tablist" className="flex gap-1 overflow-x-auto px-3 pt-3 border-b border-slate-200 bg-slate-50/60">
          {SECTIONS.map(([id, name, Icon]) => {
            const st = status[id];
            return (
              <button key={id} type="button" role="tab" aria-selected={section === id} onClick={() => go(id)}
                className={`shrink-0 h-10 px-3 -mb-px inline-flex items-center gap-2 text-[13px] font-semibold border-b-2 cursor-pointer ${section === id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                <Icon size={14} /> {name}
                {st === 'done' ? <CheckCircle2 size={13} className="text-emerald-500" /> : st === 'attention' ? <AlertTriangle size={13} className="text-red-500" /> : null}
              </button>
            );
          })}
        </div>
        <div className="p-5">
          {section === 'business' && (
            <div className="space-y-4">
              <div>
                <Field label={label('Business name *', 'name')}><input className={inputCls} value={form.name} onChange={set('name')} placeholder="Registered name, no keywords added" />{err('name')}</Field>
                <FieldFix field="name" check={f.name} value={form.name} onPick={pick} />
                {s?.name && <Suggestion label="Registered name" value={s.name.value} source={s.name.source} inUse={form.name === s.name.value} onUse={() => setForm(x => ({ ...x, name: s.name.value }))} />}
              </div>
              <div>
                <Field label={label('Primary category', 'primary_category')} hint="The main Google Business Profile category."><input className={inputCls} list="gz-categories" value={form.primary_category} onChange={set('primary_category')} placeholder="e.g. Dentist" /><datalist id="gz-categories">{CATEGORIES.map(c => <option key={c} value={c} />)}</datalist></Field>
                {s?.category.value && <Suggestion label="Suggested category" value={s.category.value} source={s.category.source} inUse={form.primary_category === s.category.value} onUse={() => setForm(x => ({ ...x, primary_category: s.category.value }))} />}
              </div>
              <div>
                <Field label="Description" counter={`${form.description.length}/750`}><textarea rows={4} maxLength={750} className={areaCls} value={form.description} onChange={set('description')} placeholder="What the business does, for whom and where. No links or promotions." /></Field>
                {s?.description.value && <Suggestion long label="Suggested description" value={s.description.value} source={s.description.source} inUse={form.description === s.description.value} onUse={() => setForm(x => ({ ...x, description: s.description.value }))} />}
              </div>
            </div>
          )}
          {section === 'contact' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><Field label={label('Phone *', 'phone')}><input className={inputCls} value={form.phone} onChange={set('phone')} placeholder="+91 98xxx xxxxx" inputMode="tel" />{err('phone')}</Field><FieldFix field="phone" check={f.phone} value={form.phone} onPick={pick} /></div>
              <div><Field label={label('Website', 'website')}><input className={inputCls} value={form.website} onChange={set('website')} placeholder="https://…" inputMode="url" />{err('website')}</Field><FieldFix field="website" check={f.website} value={form.website} onPick={pick} /></div>
              <Field label="Booking link"><input className={inputCls} value={form.booking_url} onChange={set('booking_url')} placeholder="Appointment / order URL" /></Field>
              <Field label="Contact person"><input className={inputCls} value={form.contact_name} onChange={set('contact_name')} placeholder="Owner or manager" /></Field>
              <div className="md:col-span-2"><Field label="Contact email" hint="Reports are emailed here."><input className={inputCls} value={form.contact_email} onChange={set('contact_email')} placeholder="owner@…" inputMode="email" />{err('contact_email')}</Field></div>
              {(s?.hours?.length > 0 || source?.hours?.length > 0) && <div className="md:col-span-2 rounded-lg bg-slate-50 ring-1 ring-inset ring-slate-200 px-3 py-2 text-[12px] text-slate-600 flex gap-2"><Clock size={13} className="text-slate-400 mt-0.5 shrink-0" /><span><b className="text-slate-700">Opening hours from Google Maps:</b> {(s?.hours?.length ? s.hours : source.hours).join(' · ')}</span></div>}
            </div>
          )}
          {section === 'location' && (
            <div className="space-y-4">
              <div><Field label={label('Street address', 'address')}><input className={inputCls} value={form.address} onChange={set('address')} placeholder="Shop / building, street, area, city, PIN" /></Field><FieldFix field="address" check={f.address} value={form.address} onPick={pick} /></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Area / locality"><input className={inputCls} value={form.area} onChange={set('area')} placeholder="e.g. Aundh" /></Field>
                <Field label="City"><input className={inputCls} value={form.city} onChange={set('city')} placeholder="e.g. Pune" /></Field>
              </div>
              {form.lat == null && s?.pin && <Suggestion label="Map pin" value={`${s.pin.lat.toFixed(5)}, ${s.pin.lng.toFixed(5)}`} source="Google Maps" inUse={false} onUse={() => setForm(x => ({ ...x, lat: s.pin.lat, lng: s.pin.lng }))} />}
              <LocationCard form={form} setForm={setForm} source={source} bare />
            </div>
          )}
          {section === 'services' && (
            <div className="space-y-4">
              <Field label="Services offered" hint="Press Enter after each service."><Chips values={form.services} onChange={v => setForm({ ...form, services: v })} placeholder="e.g. Dental implants, Root canal" suggestions={s?.services.values || []} max={10} /></Field>
              <Field label="Keywords to track" hint="Suggestions are real Google searches in the area. Rank tracking starts with these."><Chips values={form.keywords} onChange={v => setForm({ ...form, keywords: v })} placeholder="e.g. dentist in aundh" suggestions={keywordIdeas} max={10} /></Field>
              <Field label="Attributes" hint="Shown on the Google profile, e.g. wheelchair accessible."><Chips values={form.attributes} onChange={v => setForm({ ...form, attributes: v })} placeholder="e.g. Wheelchair accessible" suggestions={ATTRIBUTE_IDEAS} /></Field>
            </div>
          )}
          {section === 'plan' && (
            <div className="space-y-4">
              <PlanPicker value={form.plan} onChange={p => setForm({ ...form, plan: p })} plans={plans} />
              {jobs.length > 0 && (
                <div className="rounded-xl bg-slate-50 ring-1 ring-inset ring-slate-200 px-4 py-3">
                  <div className="text-[12px] font-semibold text-slate-700 mb-2">{form.plan} runs automatically after onboarding</div>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">{jobs.map(([j, e]) => <li key={j} className="flex items-center justify-between gap-2 text-[12.5px]"><span className="flex items-center gap-2 text-slate-800"><ShieldCheck size={13} className="text-indigo-500" />{JOB_LABELS[j] || j}</span><span className="text-slate-500 capitalize">{EVERY[e] || e}</span></li>)}</ul>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <ActionBar onBack={idx === 0 ? onBack : () => go(SECTIONS[idx - 1][0])} backLabel={idx === 0 ? 'Change business' : 'Back'}
        onNext={next} nextLabel={idx < SECTIONS.length - 1 ? `Next: ${SECTIONS[idx + 1][1]}` : 'Review & launch'}
        hint={tried && Object.values(errors).some(Boolean) ? <span className="text-red-600">Fix the highlighted fields first</span> : `Section ${idx + 1} of ${SECTIONS.length}`} />
    </StepLayout>
  );
}

/* ── Step 3: launch ───────────────────────────────────────────────────── */

function StepLine({ state, label, detail }) {
  const icon = state === 'done' ? <CheckCircle2 size={17} className="text-emerald-600" /> : state === 'failed' ? <XCircle size={17} className="text-red-600" />
    : state === 'running' ? <Loader2 size={17} className="text-indigo-600 animate-spin" /> : state === 'skipped' ? <span className="block w-[17px] h-[17px] rounded-full border-2 border-slate-200" /> : <span className="block w-[17px] h-[17px] rounded-full border-2 border-slate-300" />;
  return (
    <li className="flex items-start gap-3 py-2">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0"><div className={`text-[13px] font-medium ${state === 'todo' || state === 'skipped' ? 'text-slate-400' : 'text-slate-900'}`}>{label}</div>{detail && <div className={`text-[12px] ${state === 'failed' ? 'text-red-600' : 'text-slate-500'}`}>{detail}</div>}</div>
    </li>
  );
}

function LaunchStep({ form, source, existing, plans, onBack, onDone }) {
  const navigate = useNavigate();
  const path = useModulePath();
  const [, choose] = useSeoBusiness();
  const [phase, setPhase] = useState('ready'); // ready | working | auditing | finished | failed
  const [log, setLog] = useState({});
  const [project, setProject] = useState(null);
  const [baseline, setBaseline] = useState(0);
  const [audits, setAudits] = useState({});
  const [error, setError] = useState('');
  const mark = (k, state, detail) => setLog(l => ({ ...l, [k]: { state, detail } }));
  const jobs = Object.entries(plans?.[form.plan] || {}).filter(([, e]) => e && e !== 'off');

  const launch = async () => {
    setPhase('working'); setError('');
    try {
      let before = 0;
      if (existing) {
        const prior = await api(`/businesses/${existing.id}/audits?limit=1`);
        before = prior?.[0]?.id || 0;
      }
      setBaseline(before);
      mark('create', 'running');
      const candidate = {
        ...(source || { source: 'manual', match: 'entered by hand' }),
        lat: form.lat, lng: form.lng,
        name: form.name.trim(), phone: form.phone.trim(), website: normaliseUrl(form.website) || null, address: form.address.trim() || null,
        category: form.primary_category.trim() || (realCategory(source?.category) || null), description: form.description.trim() || null
      };
      const b = await api('/discover/import', { method: 'POST', body: { email: form.contact_email.trim(), candidate, plan: form.plan } });
      setProject(b);
      mark('create', 'done', b.created ? `Created “${b.name}”` : `Matched the existing project “${b.name}”`);
      mark('reviews', b.imported_reviews ? 'done' : 'skipped', b.imported_reviews ? `${b.imported_reviews} recent Google reviews imported` : 'No Google Maps reviews to import');

      mark('details', 'running');
      const patch = {
        name: form.name.trim(), phone: form.phone.trim(), website: normaliseUrl(form.website) || null, address: form.address.trim() || null,
        area: form.area.trim() || null, city: form.city.trim() || null, primary_category: form.primary_category.trim() || null,
        description: form.description.trim() || null, contact_name: form.contact_name.trim() || null, contact_email: form.contact_email.trim() || null,
        booking_url: normaliseUrl(form.booking_url) || null, plan: form.plan, services: form.services.map(name => ({ name })),
        attributes: form.attributes, lat: form.lat, lng: form.lng
      };
      await api(`/businesses/${b.id}`, { method: 'PATCH', body: Object.fromEntries(Object.entries(patch).filter(([k, v]) => v !== null || k === 'services' || k === 'attributes')) });
      mark('details', 'done', `${form.services.length} service${form.services.length === 1 ? '' : 's'}, contact and location saved`);

      if (form.keywords.length) {
        mark('keywords', 'running');
        const r = await api(`/businesses/${b.id}/keywords`, { method: 'POST', body: form.keywords.map(keyword => ({ keyword })) });
        mark('keywords', 'done', `${r?.added ?? form.keywords.length} keyword${form.keywords.length === 1 ? '' : 's'} added for tracking`);
      } else mark('keywords', 'skipped', 'No seed keywords given');

      mark('audit', 'running', 'Auditing all six areas, then planning fixes and setting the schedule');
      await refreshBusinesses();
      choose(b.id);
      setPhase('auditing');
    } catch (e) {
      setError(e.message || String(e));
      setLog(l => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, v.state === 'running' ? { state: 'failed', detail: e.message } : v])));
      setPhase('failed');
    }
  };

  // Follow the background onboarding audit until every area has a result.
  useEffect(() => {
    if (phase !== 'auditing' || !project) return undefined;
    let stop = false;
    const started = Date.now();
    const tick = async () => {
      try {
        const list = await api(`/businesses/${project.id}/audits?limit=40`);
        const latest = {};
        list.filter(a => a.id > baseline).forEach(a => { if (!latest[a.kind]) latest[a.kind] = a; });
        if (!stop) setAudits(latest);
        const settled = AREAS.every(([k]) => latest[k] && ['done', 'failed'].includes(latest[k].status));
        if (settled) {
          mark('audit', 'done', `${AREAS.filter(([k]) => latest[k].status === 'done').length} of 6 areas audited`);
          setPhase('finished');
          await refreshBusinesses();
          return;
        }
        if (Date.now() - started > 5 * 60 * 1000) { mark('audit', 'running', 'Still running in the background. You can leave this page.'); return; }
      } catch (e) { /* keep polling */ }
      if (!stop) setTimeout(tick, 2500);
    };
    tick();
    return () => { stop = true; };
  }, [phase, project, baseline]);

  const open = (screen) => { choose(project.id); navigate(path(screen)); };

  return (
    <div className="space-y-4">
      <Card title="Ready to launch" subtitle="Check the summary. Launching creates the project and starts its onboarding run.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[13px]">
          <dl className="space-y-1.5">
            {[['Business', form.name], ['Category', form.primary_category || '—'], ['Phone', form.phone], ['Website', form.website || '—'], ['Map pin', form.lat != null ? `${form.lat.toFixed(5)}, ${form.lng.toFixed(5)}` : 'Not set'], ['Location', [form.area, form.city].filter(Boolean).join(', ') || form.address || '—'], ['Contact', [form.contact_name, form.contact_email].filter(Boolean).join(' · ') || '—']].map(([k, v]) => (
              <div key={k} className="flex gap-3"><dt className="w-20 shrink-0 text-slate-500">{k}</dt><dd className="text-slate-900 font-medium min-w-0 break-words">{v}</dd></div>
            ))}
          </dl>
          <div className="space-y-2">
            <div><span className="text-slate-500">Services: </span><span className="text-slate-900">{form.services.join(', ') || '—'}</span></div>
            <div><span className="text-slate-500">Keywords: </span><span className="text-slate-900">{form.keywords.join(', ') || '—'}</span></div>
            <div><span className="text-slate-500">Plan: </span><span className="text-slate-900 font-semibold">{form.plan}</span>{jobs.length > 0 && <span className="text-slate-500"> · {jobs.map(([j, e]) => `${JOB_LABELS[j] || j} (${EVERY[e] || e})`).join(', ')}</span>}</div>
          </div>
        </div>
      </Card>

      <Card title="Onboarding run" subtitle={phase === 'ready' ? 'What happens when you launch' : phase === 'finished' ? 'Done' : phase === 'failed' ? 'Stopped' : 'Working…'}>
        <ol className="divide-y divide-slate-100">
          <StepLine state={log.create?.state || 'todo'} label={(project ? !project.created : existing) ? 'Update the existing project' : 'Create the project'} detail={log.create?.detail} />
          <StepLine state={log.reviews?.state || 'todo'} label="Import recent Google reviews" detail={log.reviews?.detail} />
          <StepLine state={log.details?.state || 'todo'} label="Save details, services and plan" detail={log.details?.detail} />
          <StepLine state={log.keywords?.state || 'todo'} label="Add seed keywords" detail={log.keywords?.detail} />
          <StepLine state={log.audit?.state || 'todo'} label="Baseline audit, AI fix plan and schedule" detail={log.audit?.detail} />
        </ol>
        {(phase === 'auditing' || phase === 'finished') && (
          <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2">
            {AREAS.map(([k, label]) => {
              const a = audits[k];
              const st = !a ? 'waiting' : a.status;
              return (
                <div key={k} className="rounded-xl ring-1 ring-inset ring-slate-200 bg-slate-50 px-3 py-2 flex items-center justify-between gap-2">
                  <span className="text-[12px] font-medium text-slate-700">{label}</span>
                  {st === 'done' ? <span className="text-[13px] font-bold text-slate-900 tabular-nums">{a.score ?? '—'}{a.data_source === 'sample' && <span className="ml-1 text-[10px] font-semibold text-amber-700">sample</span>}</span>
                    : st === 'failed' ? <span className="text-[11px] font-semibold text-red-600" title={a.error}>failed</span>
                      : <Loader2 size={14} className="text-indigo-600 animate-spin" />}
                </div>
              );
            })}
          </div>
        )}
        <ErrorNote>{error}</ErrorNote>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {phase === 'ready' || phase === 'failed'
            ? <button onClick={onBack} className="h-10 px-4 rounded-xl text-[13px] font-semibold bg-white ring-1 ring-inset ring-slate-200 text-slate-700 hover:bg-slate-50 inline-flex items-center gap-2 cursor-pointer"><ArrowLeft size={14} /> Back</button>
            : <span className="text-[12px] text-slate-500">{phase === 'auditing' ? 'The audit runs on the server. You can leave this page; it keeps going.' : ''}</span>}
          <div className="flex flex-wrap gap-2">
            {(phase === 'ready' || phase === 'failed') && (
              <button onClick={launch} className="h-10 px-5 rounded-xl text-[13px] font-semibold bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm hover:shadow-md inline-flex items-center gap-2 cursor-pointer"><Rocket size={15} /> {phase === 'failed' ? 'Try again' : existing ? 'Update project & run onboarding' : 'Create project & start onboarding'}</button>
            )}
            {(phase === 'auditing' || phase === 'finished') && project && (
              <>
                <button onClick={onDone} className="h-10 px-4 rounded-xl text-[13px] font-semibold bg-white ring-1 ring-inset ring-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer">Onboard another</button>
                <button onClick={() => open('dashboard')} className="h-10 px-4 rounded-xl text-[13px] font-semibold bg-white ring-1 ring-inset ring-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer">Command Center</button>
                <button onClick={() => open('gmb-profile')} className="h-10 px-4 rounded-xl text-[13px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 inline-flex items-center gap-1.5 cursor-pointer">Open project <ArrowRight size={14} /></button>
              </>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ── Side panel: what's connected ─────────────────────────────────────── */

function SourcesPanel({ plan, plans, showPlan = false }) {
  const st = useApi('/status');
  const path = useModulePath();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const s = st.data;
  const rows = s ? [
    [Globe, 'Website reader', true, 'Name, phone, address and description from the site'],
    [Store, 'Google Maps lookup', s.places_key, s.places_key ? 'Listing, rating, reviews, hours and map pin' : 'Set GOOGLE_PLACES_API_KEY to find the Maps listing'],
    [Link2, 'Google Business Profile', s.google_oauth, s.google_oauth ? 'Connect the owner\'s account for posts and insights' : 'Optional: the owner\'s Google sign-in'],
    [Gauge, 'PageSpeed (technical audit)', s.pagespeed_key, s.pagespeed_key ? 'Live Lighthouse scores' : 'Without a key the technical audit may hit Google\'s quota'],
    [Cpu, 'AI engine', s.ai?.configured, s.ai?.configured ? `${s.ai.provider}: descriptions, posts and replies` : 'Add an AI key to enable AI drafts']
  ] : [];
  const on = rows.filter(r => r[2]).length;
  const jobs = Object.entries(plans?.[plan] || {}).filter(([, e]) => e && e !== 'off');
  return (
    <>
      <Card>
        <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-2 text-left cursor-pointer" aria-expanded={open}>
          <span><span className="block text-[13.5px] font-semibold text-slate-900">Data sources</span><span className="block text-[12px] text-slate-500">{s ? `${on} of ${rows.length} switched on` : 'Checking…'}</span></span>
          <span className="flex items-center gap-1">{rows.map(([Icon, label, ok]) => <span key={label} title={label} className={`w-6 h-6 rounded-md flex items-center justify-center ${ok ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}><Icon size={12} /></span>)}</span>
        </button>
        {open && s && (
          <ul className="mt-3 pt-3 border-t border-slate-100 space-y-2.5">
            {rows.map(([Icon, label, ok, hint]) => (
              <li key={label} className="flex items-start gap-2.5">
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${ok ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}><Icon size={14} /></span>
                <div className="min-w-0"><div className="text-[12.5px] font-medium text-slate-900 flex items-center gap-1.5">{label}{ok ? <CheckCircle2 size={12} className="text-emerald-600" /> : <span className="text-[10px] font-semibold uppercase text-slate-400">off</span>}</div><div className="text-[11px] text-slate-500">{hint}</div></div>
              </li>
            ))}
            <li><button type="button" onClick={() => navigate(path('google-integrations'))} className="text-[12px] font-semibold text-indigo-700 hover:underline cursor-pointer">Manage integrations</button></li>
          </ul>
        )}
      </Card>
      {showPlan && (
        <Card title={`${plan} plan`} subtitle="Runs automatically after onboarding">
          {!plans ? <div className="py-4 flex justify-center text-slate-400"><Loader2 size={16} className="animate-spin" /></div> : jobs.length ? (
            <ul className="space-y-2">{jobs.map(([j, e]) => <li key={j} className="flex items-center justify-between gap-2 text-[13px]"><span className="flex items-center gap-2 text-slate-800"><ShieldCheck size={14} className="text-indigo-500" />{JOB_LABELS[j] || j}</span><span className="text-[12px] text-slate-500 capitalize">{EVERY[e] || e}</span></li>)}</ul>
          ) : <div className="text-[13px] text-slate-500">No automatic services in this plan.</div>}
        </Card>
      )}
    </>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */

export default function BusinessOnboardingPage() {
  const navigate = useNavigate();
  const path = useModulePath();
  const [, choose] = useSeoBusiness();
  const { list } = useBusinesses();
  const playbook = useApi('/playbook');
  const plans = playbook.data?.plan_schedules;
  const [step, setStep] = useState('find');
  const [query, setQuery] = useState({ website: '', email: '', name: '', city: '' });
  const [result, setResult] = useState(null);
  const [source, setSource] = useState(null);
  const [form, setForm] = useState(EMPTY);

  const existing = useMemo(() => findExisting(list, { ...source, name: form.name, phone: form.phone, website: form.website }), [list, source, form.name, form.phone, form.website]);

  const useCandidate = (c) => {
    const parts = String(c.address || '').split(',').map(p => p.trim()).filter(Boolean);
    const city = c.city || parts.slice().reverse().find(p => !/\d/.test(p) && !/^(india|maharashtra)$/i.test(p)) || query.city;
    setSource(c);
    setForm({
      ...EMPTY,
      name: c.name || query.name, primary_category: realCategory(c.category), description: c.description || '', phone: c.phone || '',
      website: c.website || query.website, address: c.address || '', city: city || '', area: c.area || (parts.length >= 3 ? parts[parts.length - 3] : ''),
      contact_email: query.email || c.email || '', plan: 'Growth', lat: c.lat ?? null, lng: c.lng ?? null,
      attributes: c.attributes || [], services: c.services || []
    });
    setStep('review');
  };
  const manual = () => {
    setSource(null);
    setForm({ ...EMPTY, name: query.name, website: query.website, contact_email: query.email, city: query.city });
    setStep('review');
  };
  const reset = () => { setStep('find'); setResult(null); setSource(null); setForm(EMPTY); setQuery({ website: '', email: '', name: '', city: '' }); };

  return (
    <SeoShell title="Business Onboarding" subtitle="Add a client: find its real details, confirm them, and let the AI agents audit and plan the work" hideSwitcher needsBusiness={false}>
      <Stepper step={step} />
      {step === 'review' ? <ReviewStep form={form} setForm={setForm} source={source} plans={plans} existing={existing} onBack={() => setStep('find')} onNext={() => setStep('launch')} /> : (
      <StepLayout side={<>{step === 'find' && <AssistantPreview />}<SourcesPanel plan={form.plan} plans={plans} showPlan={step === 'launch'} /></>}>
          {step === 'find' && <FindStep query={query} setQuery={setQuery} result={result} setResult={setResult} onUse={useCandidate} onManual={manual} list={list} onOpenExisting={(id) => { choose(id); navigate(path('gmb-profile')); }} />}
          {step === 'launch' && <LaunchStep form={form} source={source} existing={existing} plans={plans} onBack={() => setStep('review')} onDone={reset} />}
      </StepLayout>)}
    </SeoShell>
  );
}
