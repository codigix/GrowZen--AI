import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Globe, Mail, MapPin, Phone, Building2, Star, ExternalLink, CheckCircle2, XCircle, AlertTriangle, ArrowRight, ArrowLeft,
  Sparkles, Loader2, Plus, X, Rocket, Clock, Cpu, Store, Gauge, Link2, PenLine, ShieldCheck, Check, Tags, Layers,
  ChevronDown, ChevronUp
} from 'lucide-react';
import { SeoShell, Card, Badge, Button, Field, inputCls, areaCls, ErrorNote, useAction, useBusinesses, refreshBusinesses, useSeoBusiness, useModulePath } from './SeoUi';
import { api, useApi } from './seoApi';
import LocationMap from './LocationMap';
import { useAssist, AssistantPanel, FieldBadge, FieldFix, Suggestion, profileGaps, outsideFixes } from './OnboardingAssistant';
import ActionPlan from './OnboardingPlan';
import { useCountries, countryInfo, countryFlag, phoneOk, LAST_COUNTRY_KEY } from './countries';

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

const STEPS = [
  ['find', '1. Discovery & Scope', 'Find business & target reach'],
  ['review', '2. Review & Enrich', 'Verify NAP, categories & hours'],
  ['launch', '3. Launch SEO Agents', 'Audits & automated playbook']
];
const AREAS = [['gbp', 'Google profile'], ['rankings', 'Local rankings'], ['technical', 'Technical SEO'], ['onpage', 'On-page SEO'], ['backlinks', 'Backlinks'], ['citations', 'Citations']];
const PLANS = ['Starter', 'Growth', 'Pro', 'Agency'];
const JOB_LABELS = { full_audit: 'Full SEO audit', rank_scan: 'Rank tracking', technical: 'Technical SEO', reviews: 'Review management', posts: 'GBP posts', report: 'Monthly report', geo: 'AI search visibility' };
const EVERY = { daily: 'daily', weekly: 'weekly', fortnightly: 'every 2 weeks', monthly: 'monthly' };
const CATEGORIES = ['Dentist', 'Hospital', 'Eye care center', 'Medical clinic', 'Physiotherapist', 'Dermatologist', 'Restaurant', 'Cafe', 'Bakery', 'Hotel', 'Gym', 'Beauty salon',
  'Real estate agency', 'Lawyer', 'Accountant', 'School', 'Coaching center', 'Car repair', 'Interior designer', 'Software company', 'Manufacturer', 'Store'];
const EMPTY = { name: '', primary_category: '', description: '', phone: '', website: '', address: '', area: '', city: '', country: 'IN', target_scope: 'local', target_countries: [], target_areas: [], contact_name: '', contact_email: '', booking_url: '', plan: 'Growth', services: [], keywords: [], attributes: [], lat: null, lng: null };

// Google Maps and schema.org placeholders when they don't know the real category: never a category to keep.
const realCategory = (c) => (/^(services?|organization|local ?business|corporation|business|point of interest|establishment|store|company|professional ?services?)$/i.test(String(c || '').trim()) ? '' : String(c || '').trim());
const digits = (s) => String(s || '').replace(/\D/g, '').slice(-10);
const domainOf = (u) => { try { return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } };
const normaliseUrl = (u) => { const s = String(u || '').trim(); if (!s) return ''; return /^https?:\/\//i.test(s) ? s : `https://${s}`; };

// Words that say what a business is, not which one (same list as the server's match.py).
const GENERIC_WORDS = new Set(['the', 'and', 'pvt', 'ltd', 'private', 'limited', 'llp', 'inc', 'company', 'clinic', 'hospital', 'centre', 'center', 'care',
  'services', 'service', 'multispeciality', 'multi', 'speciality', 'specialty', 'solutions', 'group', 'india', 'intl', 'international']);
const nameWords = (s) => new Set((String(s || '').toLowerCase().match(/[a-z0-9]+/g) || []).filter(w => w.length >= 3 && !GENERIC_WORDS.has(w)));
const sameName = (a, b) => {
  const x = nameWords(a); const y = nameWords(b);
  if (!x.size || !y.size) return Boolean(a) && String(a).toLowerCase().replace(/[^a-z0-9]/g, '') === String(b || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return [...x].filter(w => y.has(w)).length / Math.min(x.size, y.size) >= 0.66;
};

/**
 * An existing project that is the same business: the same Google place, or the same phone / website with a
 * matching name (same rule as the server). Two different Google places are never the same business.
 */
function findExisting(list, c) {
  if (!list || !c) return null;
  return list.find(b => {
    if (c.place_id && b.place_id) return c.place_id === b.place_id;
    const contact = (digits(c.phone).length === 10 && digits(b.phone) === digits(c.phone)) || (domainOf(c.website || '') && domainOf(b.website || '') === domainOf(c.website || ''));
    return (contact && sameName(c.name, b.name)) || (c.name && b.name.trim().toLowerCase() === c.name.trim().toLowerCase());
  }) || null;
}

function Stepper({ step }) {
  const idx = STEPS.findIndex(([id]) => id === step);
  return (
    <nav aria-label="Onboarding progress" className="mb-6">
      <div className="bg-white/90 backdrop-blur rounded-2xl ring-1 ring-slate-200/90 shadow-2xs p-3.5">
        <div className="sm:hidden flex items-center justify-between text-[12px] font-semibold text-slate-700">
          <span>Step {idx + 1} of {STEPS.length} · <span className="text-indigo-600 font-bold">{STEPS[idx][1]}</span></span>
          <span className="text-slate-400">{Math.round(((idx + 1) / STEPS.length) * 100)}%</span>
        </div>
        <div className="sm:hidden mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full bg-indigo-600 rounded-full transition-all" style={{ width: `${((idx + 1) / STEPS.length) * 100}%` }} />
        </div>
        <ol className="hidden sm:flex items-center gap-4">
          {STEPS.map(([id, label, hint], i) => {
            const state = i < idx ? 'done' : i === idx ? 'current' : 'todo';
            return (
              <React.Fragment key={id}>
                {i > 0 && <span className={`flex-1 h-0.5 rounded-full transition-colors ${i <= idx ? 'bg-indigo-400' : 'bg-slate-200'}`} />}
                <li className="flex items-center gap-3 shrink-0" aria-current={state === 'current' ? 'step' : undefined}>
                  <span className={`w-8 h-8 rounded-xl flex items-center justify-center text-[12px] font-bold transition-all ${state === 'current'
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/25 ring-2 ring-indigo-200'
                      : state === 'done'
                        ? 'bg-emerald-500 text-white shadow-2xs'
                        : 'bg-slate-100 text-slate-400 ring-1 ring-inset ring-slate-200'
                    }`}>
                    {state === 'done' ? <Check size={15} /> : i + 1}
                  </span>
                  <div className="min-w-0">
                    <span className={`block text-[13px] font-bold ${state === 'todo' ? 'text-slate-400' : state === 'current' ? 'text-indigo-900' : 'text-slate-800'}`}>
                      {label}
                    </span>
                    <span className="block text-[11px] text-slate-400 leading-tight">
                      {hint}
                    </span>
                  </div>
                </li>
              </React.Fragment>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}

/** Two columns on wide screens: the step, and a side column that stays in view. */
function StepLayout({ side, children }) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
      <div className="xl:col-span-2 space-y-4 min-w-0">{children}</div>
      <aside className="space-y-4 min-w-0 xl:sticky xl:top-24 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto xl:pr-1">{side}</aside>
    </div>
  );
}

/** Back / next, pinned to the bottom of the screen so the next action is always in reach. */
function ActionBar({ onBack, backLabel = 'Back', onNext, nextLabel, nextIcon: NextIcon = ArrowRight, hint, busy }) {
  return (
    <div className="sticky bottom-3 z-20">
      <div className="rounded bg-white/95 backdrop-blur ring-1 ring-slate-200 shadow-lg shadow-slate-900/5 px-3 py-2.5 flex items-center gap-3">
        {onBack ? <Button icon={ArrowLeft} onClick={onBack}>{backLabel}</Button> : <span />}
        <span className="hidden sm:block flex-1 min-w-0 text-center text-12 text-slate-500 truncate">{hint}</span>
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
      <div className="min-h-[38px] w-full px-2 py-1.5 rounded bg-white ring-1 ring-inset ring-slate-300 focus-within:ring-indigo-400 flex flex-wrap gap-1.5 items-center">
        {values.map(v => (
          <span key={v} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-lg bg-indigo-50 ring-1 ring-inset ring-indigo-200 text-12 text-indigo-800">
            {v}<button type="button" onClick={() => onChange(values.filter(x => x !== v))} className="p-0.5 rounded hover:bg-indigo-100 cursor-pointer" aria-label={`Remove ${v}`}><X size={11} /></button>
          </span>
        ))}
        <input value={text} onChange={e => setText(e.target.value)} placeholder={values.length ? '' : placeholder}
          onKeyDown={e => { if ((e.key === 'Enter' || e.key === ',') && text.trim()) { e.preventDefault(); add(text); } else if (e.key === 'Backspace' && !text && values.length) onChange(values.slice(0, -1)); }}
          onBlur={() => text.trim() && add(text)} className="flex-1 min-w-[140px] h-7 px-1 text-13 outline-none bg-transparent text-slate-900 placeholder-slate-400" />
      </div>
      {unused.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1 items-center">
          <span className="text-11 text-slate-500 inline-flex items-center gap-1"><Sparkles size={11} className="text-violet-500" /> Suggestions:</span>
          {unused.map(s => <button key={s} type="button" onClick={() => add(s)} className="text-11 px-1.5 py-0.5 rounded-md bg-violet-50 text-violet-800 ring-1 ring-inset ring-violet-200 hover:bg-violet-100 cursor-pointer">+ {s}</button>)}
        </div>
      )}
    </div>
  );
}

/* ── Step 1: find ─────────────────────────────────────────────────────── */

function CandidateCard({ c, existing, onUse, onOpenExisting }) {
  const fromMaps = c.source === 'google_maps';
  return (
    <div className={`rounded ring-1 ring-inset p-4 flex flex-col gap-3 bg-white ${c.confidence === 'high' ? 'ring-emerald-300 shadow-sm' : 'ring-slate-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <Badge tone={fromMaps ? 'blue' : 'violet'}>{fromMaps ? <><Store size={11} /> Google Maps</> : <><Globe size={11} /> Website</>}</Badge>
            {c.confidence === 'high' && <Badge tone="green"><CheckCircle2 size={11} /> Best match</Badge>}
            {c.status && c.status !== 'OPERATIONAL' && <Badge tone="red">{c.status.toLowerCase().replace(/_/g, ' ')}</Badge>}
          </div>
          <div className="text-15 font-semibold text-slate-900">{c.name}</div>
          {c.category && <div className="text-12 text-slate-500">{c.category}</div>}
        </div>
        {c.rating != null && <div className="text-right shrink-0"><div className="text-15 font-bold text-slate-900 inline-flex items-center gap-1"><Star size={14} className="fill-amber-400 text-amber-400" />{c.rating}</div>{c.review_count != null && <div className="text-11 text-slate-500">{c.review_count} reviews</div>}</div>}
      </div>
      <ul className="space-y-1 text-12 text-slate-700">
        {c.address && <li className="flex gap-2"><MapPin size={13} className="text-slate-400 mt-0.5 shrink-0" />{c.address}</li>}
        {c.phone && <li className="flex gap-2"><Phone size={13} className="text-slate-400 mt-0.5 shrink-0" />{c.phone}</li>}
        {c.website && <li className="flex gap-2"><Globe size={13} className="text-slate-400 mt-0.5 shrink-0" /><span className="truncate">{c.website}</span></li>}
        {c.hours?.length > 0 && <li className="flex gap-2"><Clock size={13} className="text-slate-400 mt-0.5 shrink-0" />Opening hours for {c.hours.length} days</li>}
      </ul>
      <div className="text-11 text-slate-500">Matched by {c.match}{c.lat != null ? ' · map pin included' : ''}</div>
      {existing && (
        <div className="rounded bg-amber-50 ring-1 ring-inset ring-amber-200 px-3 py-2 text-12 text-amber-900 flex items-start gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>Already a project: <b>{existing.name}</b>. Using it updates that project's missing details instead of creating a duplicate. <button onClick={() => onOpenExisting(existing.id)} className="font-semibold underline cursor-pointer">Open it</button></span>
        </div>
      )}
      <div className="mt-auto flex items-center justify-between gap-2">
        {c.maps_url ? <a href={c.maps_url} target="_blank" rel="noreferrer" className="text-12 font-medium text-indigo-700 hover:underline inline-flex items-center gap-1">View on Google Maps <ExternalLink size={11} /></a> : <span />}
        <button onClick={() => onUse(c)} className="h-9 px-3.5 rounded text-13 font-semibold bg-indigo-600 text-white hover:bg-indigo-700 inline-flex items-center gap-1.5 cursor-pointer">Use this <ArrowRight size={14} /></button>
      </div>
    </div>
  );
}

const SOURCE_LABEL = { project: 'Existing project', google_maps: 'Google Maps', openstreetmap: 'OpenStreetMap', website: 'Website' };

/** Country picker: Google is searched there, and phones / addresses are checked by its rules. */
/** Sleek searchable single country dropdown with flags, dial code, and instant search */
function CountrySelect({ value, onChange, className = '' }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const rows = useCountries();
  const current = countryInfo(value || 'IN');

  useEffect(() => {
    if (!open) return;
    const clickOut = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', clickOut);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', clickOut); document.removeEventListener('keydown', esc); };
  }, [open]);

  useEffect(() => {
    if (open && inputRef.current) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(r => r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s) || (r.dial && r.dial.includes(s.replace(/\+/g, ''))));
  }, [rows, q]);

  return (
    <div ref={boxRef} className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`h-9 px-3 rounded-xl bg-white ring-1 ring-inset inline-flex items-center gap-2 text-[12.5px] font-semibold text-slate-800 cursor-pointer shadow-2xs transition-all ${open ? 'ring-2 ring-indigo-500 shadow-sm' : 'ring-slate-200 hover:ring-slate-300 hover:bg-slate-50'
          } ${className}`}
        aria-expanded={open}
      >
        <span className="text-base leading-none" role="img" aria-label={current.name}>{countryFlag(current.code)}</span>
        <span className="truncate max-w-[140px]">{current.name}</span>
        {current.dial && <span className="text-[11px] font-normal text-slate-400">(+{current.dial})</span>}
        <ChevronDown size={14} className="text-slate-400 shrink-0 ml-auto" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-72 rounded-2xl bg-white ring-1 ring-slate-200 shadow-2xl p-2 space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search country or code..."
              className="w-full h-8 pl-7 pr-7 rounded-lg bg-slate-50 ring-1 ring-inset ring-slate-200 text-[12px] text-slate-900 placeholder-slate-400 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500"
            />
            {q && <button type="button" onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600"><X size={12} /></button>}
          </div>

          <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 rounded-lg ring-1 ring-inset ring-slate-100">
            {filtered.map(r => (
              <button
                key={r.code}
                type="button"
                onClick={() => { onChange(r.code); setOpen(false); setQ(''); }}
                className={`w-full px-2.5 py-1.5 text-left flex items-center gap-2.5 text-[12.5px] cursor-pointer hover:bg-slate-50 transition-colors ${r.code === (value || 'IN') ? 'bg-indigo-50/80 font-semibold text-indigo-900' : 'text-slate-700'
                  }`}
              >
                <span className="text-base leading-none" role="img" aria-label={r.name}>{countryFlag(r.code)}</span>
                <span className="flex-1 truncate">{r.name}</span>
                <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-slate-100 text-slate-500">{r.code}</span>
                {r.dial && <span className="text-[11px] font-mono text-slate-400">+{r.dial}</span>}
                {r.code === (value || 'IN') && <Check size={13} className="text-indigo-600 shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Business-name search with live suggestions (projects, Google Maps, OpenStreetMap); picking one fetches its details. */
function NameSearch({ value, onChange, city, country, onPick, onOpenExisting, onManual }) {
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
        const d = await api(`/discover/suggest?q=${encodeURIComponent(q)}&near=${encodeURIComponent(city || '')}&country=${encodeURIComponent(country || 'IN')}&session=${session.current}`);
        if (mine === seq.current) { setData(d); setActive(0); }
      } catch (e) { if (mine === seq.current) setData({ suggestions: [], notes: [e.message], sources: {} }); }
      if (mine === seq.current) setLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [value, city, country]);

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
          className="w-full h-14 pl-11 pr-11 text-15 rounded bg-white ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-400 outline-none text-slate-900 placeholder-slate-400 shadow-sm" />
        {(loading || resolving) && <Loader2 size={17} className="absolute right-4 top-1/2 -translate-y-1/2 text-indigo-500 animate-spin" />}
      </div>
      {showList && (
        <div role="listbox" className="absolute z-30 mt-2 w-full bg-white rounded ring-1 ring-slate-200 shadow-xl overflow-hidden">
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
                      <span className="block text-14 font-medium text-slate-900">{s.title}</span>
                      {s.subtitle && <span className="block text-12 text-slate-500 leading-snug">{s.subtitle}</span>}
                    </span>
                    <span className={`shrink-0 mt-0.5 text-10 font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${badge[s.source] || ''}`}>{SOURCE_LABEL[s.source]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!loading && data && !items.length && <div className="px-4 py-4 text-13 text-slate-600">No business called “{value.trim()}” found on the map.</div>}
          {loading && !data && <div className="px-4 py-4 text-13 text-slate-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Searching…</div>}
          {data?.notes?.map(n => <div key={n} className="px-4 py-2 text-12 text-amber-800 bg-amber-50 border-t border-amber-100">{n}</div>)}
          {data && data.sources && !data.sources.google_maps && <div className="px-4 py-2 text-11 text-slate-500 bg-slate-50 border-t border-slate-100">Google Maps suggestions are off: set GOOGLE_PLACES_API_KEY on the backend to search Google's listings too.</div>}
          <button type="button" onMouseEnter={() => setActive(items.length)} onClick={onManual}
            className={`w-full text-left px-4 py-3 border-t border-slate-100 text-13 font-medium text-indigo-700 flex items-center gap-2 cursor-pointer ${active === items.length ? 'bg-slate-50' : 'bg-white'}`}>
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
    const body = {
      website: mode === 'website' ? query.website.trim() : '',
      email: mode === 'email' ? query.email.trim() : '',
      name: mode === 'email' ? query.name.trim() : '',
      city: query.city.trim(),
      country: query.country
    };
    if (!body.website && !body.email) {
      throw new Error(mode === 'website' ? 'Enter the website address.' : 'Enter the client\'s email.');
    }
    setResult(await api('/discover', { method: 'POST', body }));
  });

  const set = (k) => (e) => setQuery({ ...query, [k]: e.target.value });
  const onEnter = (e) => e.key === 'Enter' && find();
  const freeMail = /@(gmail|googlemail|yahoo|outlook|hotmail|live|icloud|rediffmail|rediff|aol|proton|zoho)\./i.test(query.email);

  const big = 'w-full h-12 pl-10 pr-3 text-[14px] rounded-xl bg-white ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none text-slate-900 placeholder-slate-400 shadow-2xs';

  return (
    <div className="space-y-5">
      {/* Unified Business Onboarding & Reach Card */}
      <Card>
        <div className="max-w-2xl mx-auto space-y-4">
          <div className="text-center pt-1">
            <h2 className="text-[20px] font-bold text-slate-900 tracking-tight">Which business are you onboarding?</h2>
            <p className="mt-1 text-[13px] text-slate-500">
              Locate the business profile to automatically import contact details, photos, opening hours, and reviews.
            </p>
          </div>

          {/* Discovery Method Selector Tabs */}
          <div role="tablist" className="p-1 rounded-xl bg-slate-100 flex gap-1 justify-center max-w-xl mx-auto">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'name'}
              onClick={() => setMode('name')}
              className={`flex-1 h-9 px-3 rounded-lg text-[12.5px] font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-all ${mode === 'name' ? 'bg-white text-indigo-900 shadow-xs ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800'
                }`}
            >
              <Search size={14} className={mode === 'name' ? 'text-indigo-600' : 'text-slate-400'} />
              Google Maps Search
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'website'}
              onClick={() => setMode('website')}
              className={`flex-1 h-9 px-3 rounded-lg text-[12.5px] font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-all ${mode === 'website' ? 'bg-white text-indigo-900 shadow-xs ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800'
                }`}
            >
              <Globe size={14} className={mode === 'website' ? 'text-indigo-600' : 'text-slate-400'} />
              Website URL
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'email'}
              onClick={() => setMode('email')}
              className={`flex-1 h-9 px-3 rounded-lg text-[12.5px] font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-all ${mode === 'email' ? 'bg-white text-indigo-900 shadow-xs ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800'
                }`}
            >
              <Mail size={14} className={mode === 'email' ? 'text-indigo-600' : 'text-slate-400'} />
              Client Email
            </button>
          </div>

          {/* Search Inputs based on mode */}
          <div className="pt-1">
            {mode === 'name' ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                  <div className="sm:col-span-3">
                    <NameSearch
                      value={query.name}
                      onChange={v => setQuery({ ...query, name: v })}
                      city={query.city}
                      country={query.country}
                      onPick={onUse}
                      onOpenExisting={onOpenExisting}
                      onManual={onManual}
                    />
                  </div>
                  <div className="relative">
                    <MapPin size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                      value={query.city}
                      onChange={set('city')}
                      placeholder="City (optional)"
                      aria-label="City"
                      className={`${big} h-14 pl-9 text-[13px]`}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[12px] text-slate-500">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-600">Search Region / Google Index:</span>
                    <CountrySelect
                      value={query.country}
                      onChange={v => setQuery({ ...query, country: v })}
                    />
                  </div>
                  <span className="text-slate-400 text-[11.5px]">Type 2+ letters to search live</span>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="relative">
                  {mode === 'website' ? (
                    <Globe size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  ) : (
                    <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  )}
                  {mode === 'website' ? (
                    <input
                      className={`${big} h-14 text-[14px]`}
                      placeholder="https://clientwebsite.com"
                      value={query.website}
                      onChange={set('website')}
                      onKeyDown={onEnter}
                      aria-label="Website"
                    />
                  ) : (
                    <input
                      className={`${big} h-14 text-[14px]`}
                      placeholder="owner@clientbusiness.com"
                      value={query.email}
                      onChange={set('email')}
                      onKeyDown={onEnter}
                      aria-label="Client's email"
                    />
                  )}
                </div>

                {mode === 'email' && freeMail && (
                  <input
                    className={`${big} pl-3.5 h-11 text-[13px]`}
                    placeholder="Business name (required for Gmail/Yahoo/personal emails)"
                    value={query.name}
                    onChange={set('name')}
                    onKeyDown={onEnter}
                    aria-label="Business name"
                  />
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="primary"
                      icon={Search}
                      busy={busy === 'find'}
                      onClick={find}
                      className="h-10 px-4 text-[13px]"
                    >
                      {busy === 'find' ? 'Analyzing Website & Google Maps…' : mode === 'website' ? 'Scan & Find Business' : 'Find via Email'}
                    </Button>
                    <CountrySelect
                      value={query.country}
                      onChange={v => setQuery({ ...query, country: v })}
                    />
                  </div>
                  <span className="text-[11.5px] text-slate-400">
                    {mode === 'website' ? 'Scrapes meta tags, schema.org & Maps' : 'Extracts corporate domain automatically'}
                  </span>
                </div>
              </div>
            )}
            <ErrorNote>{error}</ErrorNote>
          </div>

          {/* Merged Target Market & Scope Section */}
          <div className="pt-4 border-t border-slate-200/80">
            <TargetMarket
              form={{ target_scope: 'local', target_countries: [], target_areas: [], ...query }}
              setForm={(fn) => setQuery(typeof fn === 'function' ? fn({ target_scope: 'local', target_countries: [], target_areas: [], ...query }) : fn)}
            />
          </div>

          {/* Unified Card Footer: Manual Entry Fallback */}
          <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[12px] text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <PenLine size={13} className="text-slate-400" />
              Setting up a brand-new business without an online listing?
            </span>
            <button
              type="button"
              onClick={onManual}
              className="font-semibold text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer inline-flex items-center gap-1"
            >
              Enter details manually <ArrowRight size={13} />
            </button>
          </div>
        </div>
      </Card>

      {/* Candidate Matches Card */}
      {result && (
        <Card
          title={result.candidates.length ? `Found ${result.candidates.length} possible match${result.candidates.length === 1 ? '' : 'es'}` : 'Nothing found'}
          subtitle={result.candidates.length ? 'Pick the exact listing to import verified NAP data, reviews, and photos.' : 'Try adjusting the search criteria or enter the business details manually.'}
        >
          {result.notes?.length > 0 && (
            <div className="mb-4 space-y-2">
              {result.notes.map(n => (
                <div key={n} className="rounded-xl bg-amber-50 ring-1 ring-inset ring-amber-200 px-3 py-2 text-[12px] text-amber-900 flex gap-2">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  {n}
                </div>
              ))}
            </div>
          )}
          {result.candidates.length ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
              {result.candidates.map((c, i) => (
                <CandidateCard
                  key={c.place_id || `${c.source}-${i}`}
                  c={c}
                  existing={findExisting(list, c)}
                  onUse={onUse}
                  onOpenExisting={onOpenExisting}
                />
              ))}
            </div>
          ) : (
            <Button variant="primary" icon={PenLine} onClick={onManual}>
              Enter details by hand
            </Button>
          )}
        </Card>
      )}
    </div>
  );
}

/** Before a business is picked: what happens next. */
function AssistantPreview() {
  return (
    <Card
      title={<span className="inline-flex items-center gap-2"><Sparkles size={16} className="text-violet-600" /> Autonomous SEO Assistant</span>}
      subtitle="Runs automatically as soon as the business is selected"
    >
      <div className="space-y-4">
        {/* Live Readiness Telemetry */}
        <div className="p-3 rounded-xl bg-slate-50 ring-1 ring-inset ring-slate-200/80 space-y-2">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center justify-between">
            <span>Agent Readiness Telemetry</span>
            <span className="flex items-center gap-1.5 text-emerald-600 font-semibold lowercase">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              active
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11.5px]">
            <div className="flex items-center gap-1.5 text-slate-700">
              <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
              <span>Google Places API</span>
            </div>
            <div className="flex items-center gap-1.5 text-slate-700">
              <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
              <span>PageSpeed Insights</span>
            </div>
            <div className="flex items-center gap-1.5 text-slate-700">
              <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
              <span>SERP Rank Grid</span>
            </div>
            <div className="flex items-center gap-1.5 text-slate-700">
              <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
              <span>NAP Cross-Checker</span>
            </div>
          </div>
        </div>

        {/* Process Steps */}
        <ul className="space-y-3">
          {[
            [ShieldCheck, '1. Cross-checks & Verifies NAP', 'Audits name, phone, address, website and categories across Google Maps & schema.'],
            [AlertTriangle, '2. Flags Risks & Inconsistencies', 'Detects duplicate listings, closed flags, wrong phone formats or missing postcodes.'],
            [Sparkles, '3. Fills Gaps Automatically', 'Pre-populates opening hours, photo assets, service descriptions, and primary categories.'],
            [Search, '4. Discovers High-Intent Keywords', 'Extracts real local and international search queries customers type into Google.']
          ].map(([I, t, d]) => (
            <li key={t} className="flex items-start gap-2.5">
              <span className="w-7 h-7 rounded-lg bg-violet-50 text-violet-600 ring-1 ring-inset ring-violet-200/60 flex items-center justify-center shrink-0 mt-0.5">
                <I size={14} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-bold text-slate-800">{t}</span>
                <span className="block text-[12px] text-slate-500 leading-snug">{d}</span>
              </span>
            </li>
          ))}
        </ul>

        {/* Estimation pill */}
        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11.5px] text-slate-400">
          <span>Average execution: ~2 mins</span>
          <span className="font-semibold text-indigo-600">Phase 1 of Onboarding</span>
        </div>
      </div>
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
          <button key={p} type="button" onClick={() => onChange(p)} className={`text-left rounded p-3 ring-1 ring-inset cursor-pointer transition-colors ${on ? 'bg-indigo-50 ring-indigo-400' : 'bg-white ring-slate-200 hover:bg-slate-50'}`}>
            <div className="flex items-center justify-between"><span className="text-13 font-semibold text-slate-900">{p}</span>{on && <CheckCircle2 size={15} className="text-indigo-600" />}</div>
            <div className="text-11 text-slate-500">{plans ? `${jobs.length} automatic services` : 'Loading…'}</div>
          </button>
        );
      })}
    </div>
  );
}

/** A card, or just a titled block when it sits inside another card. */
function Frame({ title, subtitle, bare, children }) {
  if (!bare) return <Card title={title} subtitle={subtitle}>{children}</Card>;
  return <div><div className="text-12 font-semibold text-slate-700">{title}</div><div className="text-11 text-slate-500 mb-2">{subtitle}</div>{children}</div>;
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
  const btn = 'h-9 px-3 rounded text-12 font-semibold bg-white ring-1 ring-inset ring-slate-200 text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50';
  return (
    <Frame title="Location on the map" subtitle="The exact pin drives local rankings. Drag it to the entrance, or click the map to place it." bare={bare}>
      <LocationMap lat={form.lat} lng={form.lng} onMove={move} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={find} disabled={busy === 'find'} className={btn}>{busy === 'find' ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Find the typed address on the map</button>
        <button type="button" onClick={fromPin} disabled={form.lat == null || busy === 'reverse'} className={btn}>{busy === 'reverse' ? <Loader2 size={13} className="animate-spin" /> : <MapPin size={13} />} Use the pin's address</button>
        <span className="ml-auto text-12 text-slate-500 tabular-nums">
          {form.lat != null ? <>Pin: {form.lat.toFixed(5)}, {form.lng.toFixed(5)}{source?.lat != null && source.lat === form.lat ? ` · from ${source.source === 'google_maps' ? 'Google Maps' : 'OpenStreetMap'}` : ''}</> : 'No pin yet'}
        </span>
      </div>
      <ErrorNote>{error}</ErrorNote>
      {matches.length > 0 && (
        <div className="mt-3 rounded ring-1 ring-inset ring-slate-200 divide-y divide-slate-100">
          <div className="px-3 py-2 text-11 font-semibold uppercase tracking-wider text-slate-500">Other places matching this address</div>
          {matches.map((m, i) => (
            <button key={i} type="button" onClick={() => move(m.lat, m.lng)} className={`w-full text-left px-3 py-2 text-12 flex items-start gap-2 hover:bg-slate-50 cursor-pointer ${m.lat === form.lat && m.lng === form.lng ? 'bg-indigo-50/60' : ''}`}>
              <MapPin size={13} className="text-slate-400 mt-0.5 shrink-0" /><span className="text-slate-700">{m.label}</span>
            </button>
          ))}
        </div>
      )}
      {pinAddress && (
        <div className="mt-3 rounded bg-indigo-50 ring-1 ring-inset ring-indigo-200 px-3 py-2.5 text-12 text-indigo-900 flex flex-wrap items-center gap-2">
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

/**
 * Customizable searchable select with checkboxes to select multiple international target locations (countries).
 * Features:
 * - Proper display locations with flag, name, code, remove (X) button, and clear-all.
 * - Searchable dropdown popover with instant filter by country name, code, or dial code.
 * - Multi-select checkboxes allowing users to toggle multiple locations without closing the menu.
 * - Select all matching / Deselect all quick actions.
 * - Click-outside and Escape key closing.
 * - Interactive suggestion chips with selected states.
 */
function SearchableCountryMultiSelect({ selected = [], onChange, hostCountry, popularCodes = [] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef(null);
  const searchInputRef = useRef(null);
  const rows = useCountries();

  // Close dropdown when clicking outside or pressing Escape
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  // Focus search input on open
  useEffect(() => {
    if (open && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.code.toLowerCase().includes(q) ||
      (r.dial && r.dial.includes(q.replace(/\+/g, '')))
    );
  }, [rows, query]);

  const toggle = (code) => {
    if (selected.includes(code)) {
      onChange(selected.filter(c => c !== code));
    } else {
      onChange([...selected, code]);
    }
  };

  const remove = (code, e) => {
    e?.stopPropagation();
    onChange(selected.filter(c => c !== code));
  };

  const clearAll = (e) => {
    e?.stopPropagation();
    onChange([]);
  };

  const selectAllMatching = (e) => {
    e?.preventDefault();
    const codesToAdd = filtered.map(r => r.code).filter(c => !selected.includes(c));
    onChange([...selected, ...codesToAdd]);
  };

  const deselectAllMatching = (e) => {
    e?.preventDefault();
    const matchingCodes = new Set(filtered.map(r => r.code));
    onChange(selected.filter(c => !matchingCodes.has(c)));
  };

  const allMatchingSelected = filtered.length > 0 && filtered.every(r => selected.includes(r.code));

  return (
    <div className="space-y-3" ref={containerRef}>
      {/* Proper Display Locations: Selected Locations Tags */}
      {selected.length > 0 ? (
        <div className="p-2.5 rounded-xl bg-white ring-1 ring-inset ring-slate-200/80 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-11.5 font-medium text-slate-500">
            <span className="flex items-center gap-1.5 font-semibold text-slate-700">
              <Globe size={13} className="text-indigo-600" />
              Target Countries ({selected.length})
            </span>
            <button
              type="button"
              onClick={clearAll}
              className="text-slate-400 hover:text-rose-600 cursor-pointer transition-colors"
            >
              Clear all
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 items-center">
            {selected.map(code => {
              const info = countryInfo(code);
              return (
                <span
                  key={code}
                  className="inline-flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-lg bg-indigo-50/90 ring-1 ring-inset ring-indigo-200 text-12 font-medium text-indigo-900 shadow-2xs"
                >
                  <span className="text-sm leading-none" role="img" aria-label={info.name}>{countryFlag(code)}</span>
                  <span>{info.name}</span>
                  <span className="text-10 font-mono px-1 py-0.5 rounded bg-indigo-200/60 text-indigo-700">
                    {code}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => remove(code, e)}
                    className="p-0.5 rounded hover:bg-indigo-200 text-indigo-500 hover:text-indigo-800 cursor-pointer transition-colors"
                    aria-label={`Remove ${info.name}`}
                  >
                    <X size={12} />
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="px-3 py-2 rounded-xl bg-slate-100/70 border border-dashed border-slate-200 text-12 text-slate-500 flex items-center gap-2">
          <Globe size={13} className="text-slate-400 shrink-0" />
          <span>No target countries selected yet. Pick below where this business seeks customers.</span>
        </div>
      )}

      {/* Dropdown Trigger Box */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={`w-full min-h-[42px] px-3.5 py-2 rounded-xl bg-white ring-1 ring-inset flex items-center justify-between gap-2 text-left cursor-pointer transition-all shadow-2xs ${open
              ? 'ring-2 ring-indigo-500 shadow-md shadow-indigo-500/10'
              : 'ring-slate-300 hover:ring-slate-400'
            }`}
          aria-expanded={open}
          aria-haspopup="listbox"
        >
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-6 h-6 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
              <Globe size={14} className="text-indigo-600" />
            </div>
            {selected.length === 0 ? (
              <span className="text-13 text-slate-400 truncate">
                Search and select target countries with checkboxes…
              </span>
            ) : (
              <div className="flex items-center gap-1.5 text-13 text-slate-800 font-medium truncate">
                <span>{selected.length} target countr{selected.length === 1 ? 'y' : 'ies'} selected</span>
                <span className="text-12 text-slate-400 font-normal truncate">
                  ({selected.slice(0, 3).map(c => countryInfo(c).name).join(', ')}{selected.length > 3 ? `, +${selected.length - 3} more` : ''})
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {selected.length > 0 && (
              <span className="text-11 font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                {selected.length}
              </span>
            )}
            {open ? <ChevronUp size={16} className="text-slate-600" /> : <ChevronDown size={16} className="text-slate-400" />}
          </div>
        </button>

        {/* Dropdown Menu */}
        {open && (
          <div className="absolute left-0 right-0 top-full mt-1.5 z-40 rounded-2xl bg-white ring-1 ring-slate-200 shadow-2xl p-2.5 space-y-2">
            {/* Search Input Bar */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search by country name, code, or dial code (e.g. US, +44, Emirates)..."
                className="w-full h-9 pl-8 pr-8 rounded-lg bg-slate-50 ring-1 ring-inset ring-slate-200 text-12.5 text-slate-900 placeholder-slate-400 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500 transition-all"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 rounded cursor-pointer"
                  aria-label="Clear search"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Header Toolbar */}
            <div className="flex items-center justify-between px-1 text-11 text-slate-500">
              <span>
                Showing {filtered.length} {filtered.length === 1 ? 'country' : 'countries'}
                {query ? ' matching search' : ''}
              </span>
              <div className="flex items-center gap-2">
                {filtered.length > 0 && (
                  <button
                    type="button"
                    onClick={allMatchingSelected ? deselectAllMatching : selectAllMatching}
                    className="text-indigo-600 hover:text-indigo-800 font-medium cursor-pointer"
                  >
                    {allMatchingSelected ? 'Deselect all' : 'Select all matching'}
                  </button>
                )}
                {selected.length > 0 && (
                  <>
                    <span className="text-slate-300">·</span>
                    <button
                      type="button"
                      onClick={clearAll}
                      className="text-slate-400 hover:text-rose-600 font-medium cursor-pointer"
                    >
                      Clear all
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Checkbox Options List */}
            <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 rounded-xl ring-1 ring-inset ring-slate-100">
              {filtered.length > 0 ? (
                filtered.map(r => {
                  const isChecked = selected.includes(r.code);
                  return (
                    <div
                      key={r.code}
                      onClick={() => toggle(r.code)}
                      className={`flex items-center gap-3 px-3 py-2 text-left cursor-pointer transition-colors select-none ${isChecked
                          ? 'bg-indigo-50/80 text-indigo-950 font-medium'
                          : 'hover:bg-slate-50 text-slate-700'
                        }`}
                      role="checkbox"
                      aria-checked={isChecked}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => { }}
                        className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 accent-indigo-600 pointer-events-none cursor-pointer shrink-0"
                      />
                      <span className="text-base leading-none shrink-0" role="img" aria-label={r.name}>
                        {countryFlag(r.code)}
                      </span>
                      <span className="text-13 flex-1 truncate">{r.name}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-10.5 font-mono font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                          {r.code}
                        </span>
                        {r.dial && (
                          <span className="text-11 font-mono text-slate-400">
                            +{r.dial}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="py-6 text-center text-12.5 text-slate-400 space-y-1">
                  <div>No countries found matching "{query}"</div>
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="text-11.5 text-indigo-600 hover:underline cursor-pointer"
                  >
                    Clear search filter
                  </button>
                </div>
              )}
            </div>

            {/* Footer Summary & Done button */}
            <div className="flex items-center justify-between pt-1.5 border-t border-slate-100">
              <span className="text-11.5 text-slate-500 font-medium">
                {selected.length} {selected.length === 1 ? 'country' : 'countries'} selected
              </span>
              <Button
                variant="primary"
                onClick={() => setOpen(false)}
                className="h-7 px-3 text-12"
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Suggestions Row */}
      {popularCodes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-11 text-slate-500 inline-flex items-center gap-1">
            <Sparkles size={11} className="text-violet-500" /> Suggestions:
          </span>
          {popularCodes.map(code => {
            const isChecked = selected.includes(code);
            return (
              <button
                key={code}
                type="button"
                onClick={() => toggle(code)}
                className={`text-11.5 px-2 py-0.5 rounded-lg ring-1 ring-inset inline-flex items-center gap-1 cursor-pointer transition-all ${isChecked
                    ? 'bg-indigo-600 text-white ring-indigo-600 shadow-2xs font-medium'
                    : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50 hover:ring-slate-300'
                  }`}
              >
                <span>{countryFlag(code)}</span>
                <span>{countryInfo(code).name}</span>
                {isChecked ? <Check size={11} /> : <Plus size={11} className="text-slate-400" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Where the business wants customers: nearby areas (local) or other countries (international), with suggestions. */
function TargetMarket({ form, setForm }) {
  const rows = useCountries();
  const [text, setText] = useState('');
  const [found, setFound] = useState([]);
  const [busy, setBusy] = useState(false);
  const scope = form.target_scope || 'local';
  const home = [form.area, form.city].filter(Boolean).join(', ');

  useEffect(() => {
    const q = text.trim();
    if (scope !== 'local' || q.length < 2) { setFound([]); return; }
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const d = await api(`/discover/areas?q=${encodeURIComponent(q)}&country=${encodeURIComponent(form.country || 'IN')}&near=${encodeURIComponent(form.city || '')}`);
        setFound(d.results || []);
      } catch (e) {
        setFound([]);
      } finally {
        setBusy(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [text, scope, form.country, form.city]);

  const addArea = (v) => {
    if (v && !form.target_areas.some(x => x.toLowerCase() === v.toLowerCase())) {
      setForm(x => ({ ...x, target_areas: [...x.target_areas, v] }));
    }
    setText('');
    setFound([]);
  };

  const popular = ['US', 'GB', 'AE', 'CA', 'AU', 'SG', 'SA', 'DE'].filter(c => c !== form.country && rows.some(r => r.code === c));
  const ownSuggestions = [home, form.city].filter((v, i, a) => v && a.indexOf(v) === i && !form.target_areas.includes(v));

  const seg = (id, name, hint) => (
    <button
      type="button"
      onClick={() => setForm(x => ({ ...x, target_scope: id }))}
      className={`flex-1 text-left px-3.5 py-2.5 rounded-xl ring-1 ring-inset cursor-pointer transition-all ${scope === id
          ? 'ring-2 ring-indigo-500 bg-indigo-50/70 shadow-2xs'
          : 'ring-slate-200 bg-white hover:bg-slate-50 hover:ring-slate-300'
        }`}
    >
      <div className={`text-13 font-semibold ${scope === id ? 'text-indigo-900' : 'text-slate-800'}`}>{name}</div>
      <div className="text-11.5 text-slate-500 mt-0.5">{hint}</div>
    </button>
  );

  return (
    <div data-field="target" className="rounded-2xl bg-slate-50/80 ring-1 ring-inset ring-slate-200/90 p-4 space-y-3.5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-13 font-semibold text-slate-800">Who should find this business?</div>
          <div className="text-11.5 text-slate-500">Pick where potential clients search for this business</div>
        </div>
      </div>

      <div className="flex gap-2.5">
        {seg('local', 'Local', 'Customers in nearby areas')}
        {seg('international', 'International', 'Customers in other countries')}
      </div>

      {scope === 'local' ? (
        <div className="space-y-3">
          {/* Proper Display Locations: Selected Areas Tags */}
          {form.target_areas.length > 0 ? (
            <div className="p-2.5 rounded-xl bg-white ring-1 ring-inset ring-slate-200/80 shadow-2xs space-y-2">
              <div className="flex items-center justify-between text-11.5 font-medium text-slate-500">
                <span className="flex items-center gap-1.5 font-semibold text-slate-700">
                  <MapPin size={13} className="text-indigo-600" />
                  Target Areas ({form.target_areas.length})
                </span>
                <button
                  type="button"
                  onClick={() => setForm(x => ({ ...x, target_areas: [] }))}
                  className="text-slate-400 hover:text-rose-600 cursor-pointer transition-colors"
                >
                  Clear all
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 items-center">
                {form.target_areas.map(v => (
                  <span
                    key={v}
                    className="inline-flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-lg bg-indigo-50/90 ring-1 ring-inset ring-indigo-200 text-12 font-medium text-indigo-900 shadow-2xs"
                  >
                    <MapPin size={11} className="text-indigo-500 shrink-0" />
                    <span>{v}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${v}`}
                      onClick={() => setForm(x => ({ ...x, target_areas: x.target_areas.filter(y => y !== v) }))}
                      className="p-0.5 rounded hover:bg-indigo-200 text-indigo-500 hover:text-indigo-800 cursor-pointer transition-colors"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="px-3 py-2 rounded-xl bg-slate-100/70 border border-dashed border-slate-200 text-12 text-slate-500 flex items-center gap-2">
              <MapPin size={13} className="text-slate-400 shrink-0" />
              <span>No target areas added yet. Search nearby localities or neighborhoods below.</span>
            </div>
          )}

          {/* Search Areas Input with Checkboxes in Results */}
          <div className="relative">
            <div className="min-h-[42px] w-full px-3 py-2 rounded-xl bg-white ring-1 ring-inset ring-slate-300 focus-within:ring-2 focus-within:ring-indigo-500 flex items-center gap-2 transition-all shadow-2xs">
              <MapPin size={15} className="text-slate-400 shrink-0" />
              <input
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && text.trim()) {
                    e.preventDefault();
                    addArea(found[0]?.label || text.trim());
                  }
                }}
                placeholder={form.target_areas.length ? 'Add another nearby locality or neighborhood…' : `Search areas in ${countryInfo(form.country).name}, e.g. ${form.city || 'Aundh'}`}
                className="flex-1 h-7 text-13 outline-none bg-transparent text-slate-900 placeholder-slate-400"
              />
              {busy && <Loader2 size={14} className="animate-spin text-slate-400 shrink-0" />}
              {text && (
                <button
                  type="button"
                  onClick={() => setText('')}
                  className="p-0.5 text-slate-400 hover:text-slate-600 rounded cursor-pointer"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Found Areas Dropdown with Checkbox Selection */}
            {found.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1.5 z-30 rounded-2xl bg-white ring-1 ring-slate-200 shadow-xl overflow-hidden divide-y divide-slate-100">
                <div className="px-3 py-1.5 bg-slate-50 text-11 font-semibold text-slate-500 flex items-center justify-between">
                  <span>Found {found.length} areas</span>
                  <span className="text-slate-400">Click to select/unselect</span>
                </div>
                <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
                  {found.map(r => {
                    const isChecked = form.target_areas.some(x => x.toLowerCase() === r.label.toLowerCase());
                    return (
                      <div
                        key={r.label}
                        onClick={() => {
                          if (isChecked) {
                            setForm(x => ({ ...x, target_areas: x.target_areas.filter(y => y.toLowerCase() !== r.label.toLowerCase()) }));
                          } else {
                            addArea(r.label);
                          }
                        }}
                        className={`w-full text-left px-3 py-2 text-12.5 cursor-pointer flex items-center gap-2.5 transition-colors select-none ${isChecked ? 'bg-indigo-50/80 text-indigo-950 font-medium' : 'hover:bg-slate-50 text-slate-800'
                          }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => { }}
                          className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 accent-indigo-600 pointer-events-none cursor-pointer shrink-0"
                        />
                        <MapPin size={13} className={isChecked ? 'text-indigo-600 shrink-0' : 'text-slate-400 shrink-0'} />
                        <span className="flex-1 truncate">{r.label}</span>
                        {r.state && <span className="text-11 text-slate-400 shrink-0">· {r.state}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Suggestions */}
          {ownSuggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-11 text-slate-500 inline-flex items-center gap-1">
                <Sparkles size={11} className="text-violet-500" /> Suggestions:
              </span>
              {ownSuggestions.map(v => {
                const isChecked = form.target_areas.some(x => x.toLowerCase() === v.toLowerCase());
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      if (isChecked) {
                        setForm(x => ({ ...x, target_areas: x.target_areas.filter(y => y.toLowerCase() !== v.toLowerCase()) }));
                      } else {
                        addArea(v);
                      }
                    }}
                    className={`text-11.5 px-2 py-0.5 rounded-lg ring-1 ring-inset inline-flex items-center gap-1 cursor-pointer transition-all ${isChecked
                        ? 'bg-indigo-600 text-white ring-indigo-600 shadow-2xs font-medium'
                        : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50 hover:ring-slate-300'
                      }`}
                  >
                    <MapPin size={10} className={isChecked ? 'text-white' : 'text-slate-400'} />
                    <span>{v}</span>
                    {isChecked ? <Check size={11} /> : <Plus size={11} className="text-slate-400" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <SearchableCountryMultiSelect
          selected={form.target_countries || []}
          onChange={(next) => setForm(x => ({ ...x, target_countries: next }))}
          hostCountry={form.country}
          popularCodes={popular}
        />
      )}
    </div>
  );
}

function ReviewStep({ form, setForm, source, plans, existing, onBack, onNext, onFollowUps }) {
  const assist = useAssist(form, source, setForm);
  const res = assist.res;
  const s = res?.suggestions;
  const f = res?.fields || {};
  const [section, setSection] = useState('business');
  const [tried, setTried] = useState(false);
  // What's still missing, live: highlighted in the form and listed in the side panel.
  const gaps = profileGaps(form, res);
  const missingFields = new Set(gaps.filter(g => !g.done).map(g => g.field));
  const [flash, setFlash] = useState(null);
  const goTo = (sec, field) => { setSection(sec); setFlash(field); };
  useEffect(() => {
    if (!flash) return undefined;
    const t1 = setTimeout(() => {
      const el = document.querySelector(`[data-field="${flash}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      (el.matches('input,textarea') ? el : el.querySelector('input,textarea'))?.focus({ preventScroll: true });
    }, 60);
    const t2 = setTimeout(() => setFlash(null), 2200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [flash, section]);
  // The field "Fill in" (side panel) jumped to flashes briefly; the form itself carries no standing highlights.
  const hl = (field) => (flash === field ? ' ring-2 ring-indigo-500 ring-offset-1' : '');
  const box = (field) => `rounded transition-shadow${flash === field ? ' ring-2 ring-indigo-500 ring-offset-2' : ''}`;
  // Fixes for the business's own website and Google profile go to the to-do list at launch.
  const followUps = outsideFixes(form, res);
  const followKey = followUps.map(x => x.title).join('|');
  useEffect(() => { onFollowUps?.(followUps); }, [followKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const errors = {
    name: !form.name.trim() && 'The business name is required.',
    phone: !digits(form.phone) ? 'A phone number is needed for the Google profile and citations.' : !phoneOk(form.phone, form.country) && `This phone number doesn't look complete for ${countryInfo(form.country).name}.`,
    website: form.website && !domainOf(form.website).includes('.') && 'This doesn\'t look like a website address.',
    contact_email: form.contact_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.contact_email) && 'This doesn\'t look like an email address.'
  };
  const keywordIdeas = useMemo(() => {
    const where = (form.area || form.city || '').split(',')[0].trim().toLowerCase();
    const base = [...form.services, form.primary_category].filter(Boolean).map(x => x.toLowerCase());
    return [...new Set([...(s?.keywords.values || []), ...base.flatMap(x => [where ? `${x} in ${where}` : null, `${x} near me`]).filter(Boolean)])];
  }, [form.services, form.primary_category, form.area, form.city, s]);
  const err = (k) => tried && errors[k] ? <span className="block text-11 text-red-600 mt-1">{errors[k]}</span> : null;
  const pick = (field, value, sources) => { setForm(x => ({ ...x, [field]: value })); assist.resolve(field, value, sources); };
  // Fills every missing detail a source found (never overwrites what was typed).
  const applyAll = () => setForm(x => gaps.filter(g => !g.done && g.fix).reduce((acc, g) => g.fix.apply(acc), x));

  const conflict = (...keys) => keys.some(k => f[k]?.status === 'conflict');
  const status = {
    business: (tried && errors.name) || conflict('name', 'primary_category') ? 'attention' : form.name.trim() && form.primary_category.trim() && form.description.trim().length >= 250 ? 'done' : 'todo',
    contact: (tried && (errors.phone || errors.website || errors.contact_email)) || conflict('phone', 'website') ? 'attention' : phoneOk(form.phone, form.country) && form.website.trim() && form.contact_email.trim() ? 'done' : 'todo',
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
    <StepLayout side={<AssistantPanel assist={assist} form={form} setForm={setForm} onGo={goTo} onApplyAll={applyAll} onUseName={() => setForm(x => ({ ...x, name: s.name.value }))} />}>
      {source && (
        <div className="rounded bg-white ring-1 ring-inset ring-slate-200 px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-12.5 text-slate-600">
          <Store size={14} className="text-indigo-500" />
          <span>From <b className="text-slate-800">{{ google_maps: 'Google Maps', openstreetmap: 'OpenStreetMap', website: 'the website' }[source.source] || 'your entry'}</b>{source.rating != null ? ` · ★ ${source.rating} (${source.review_count || 0} reviews)` : ''}{source.photo_count ? ` · ${source.photo_count} photos` : ''}</span>
          {source.maps_url && <a href={source.maps_url} target="_blank" rel="noreferrer" className="ml-auto font-semibold text-indigo-700 hover:underline inline-flex items-center gap-1">View listing <ExternalLink size={11} /></a>}
        </div>
      )}
      {source?.status && source.status !== 'OPERATIONAL' && (
        <div className="rounded bg-red-50 ring-1 ring-inset ring-red-200 px-4 py-2.5 text-13 text-red-800 flex gap-2"><AlertTriangle size={16} className="shrink-0 mt-0.5" /><span>Google lists this business as <b>{source.status === 'CLOSED_PERMANENTLY' ? 'permanently closed' : 'temporarily closed'}</b>. Check with the client before onboarding it.</span></div>
      )}
      {existing && <div className="rounded bg-amber-50 ring-1 ring-inset ring-amber-200 px-4 py-2.5 text-13 text-amber-900 flex gap-2"><AlertTriangle size={16} className="shrink-0 mt-0.5" /><span>This looks like an existing project, <b>{existing.name}</b>. Launching fills in its missing details and re-runs its onboarding audit, without creating a duplicate.</span></div>}

      <section id="onboarding-form" className="ai-glass-card rounded overflow-hidden scroll-mt-24">
        <div role="tablist" className="flex gap-1 overflow-x-auto px-3 pt-3 border-b border-slate-200 bg-slate-50/60">
          {SECTIONS.map(([id, name, Icon]) => {
            const st = status[id];
            const todo = gaps.filter(g => !g.done && g.section === id).length;
            return (
              <button key={id} type="button" role="tab" aria-selected={section === id} onClick={() => go(id)}
                className={`shrink-0 h-10 px-3 -mb-px inline-flex items-center gap-2 text-13 font-semibold border-b-2 cursor-pointer ${section === id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                <Icon size={14} /> {name}
                {st === 'attention' ? <AlertTriangle size={13} className="text-red-500" /> : st === 'done' && !todo ? <CheckCircle2 size={13} className="text-emerald-500" /> : null}
              </button>
            );
          })}
        </div>
        <div className="p-5">
          {section === 'business' && (
            <div className="space-y-4">
              <div>
                <Field label={label('Business name *', 'name')}><input data-field="name" className={inputCls + hl('name')} value={form.name} onChange={set('name')} placeholder="Registered name, no keywords added" />{err('name')}</Field>
                <FieldFix field="name" check={f.name} value={form.name} onPick={pick} />
                {s?.name && <Suggestion label="Registered name" value={s.name.value} source={s.name.source} inUse={form.name === s.name.value} onUse={() => setForm(x => ({ ...x, name: s.name.value }))} />}
              </div>
              <div>
                <Field label={label('Primary category', 'primary_category')} hint="The main Google Business Profile category."><input data-field="primary_category" className={inputCls + hl('primary_category')} list="gz-categories" value={form.primary_category} onChange={set('primary_category')} placeholder="e.g. Dentist" /><datalist id="gz-categories">{CATEGORIES.map(c => <option key={c} value={c} />)}</datalist></Field>
                {s?.category.value && <Suggestion label="Suggested category" value={s.category.value} source={s.category.source} inUse={form.primary_category === s.category.value} onUse={() => setForm(x => ({ ...x, primary_category: s.category.value }))} />}
              </div>
              <div>
                <Field label="Description" counter={`${form.description.length}/750`}><textarea data-field="description" rows={4} maxLength={750} className={areaCls + hl('description')} value={form.description} onChange={set('description')} placeholder="What the business does, for whom and where. No links or promotions." /></Field>
                {s?.description.value && <Suggestion long label="Suggested description" value={s.description.value} source={s.description.source} inUse={form.description === s.description.value} onUse={() => setForm(x => ({ ...x, description: s.description.value }))} />}
              </div>
            </div>
          )}
          {section === 'contact' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><Field label={label('Phone *', 'phone')}><input data-field="phone" className={inputCls + hl('phone')} value={form.phone} onChange={set('phone')} placeholder={countryInfo(form.country).dial ? `+${countryInfo(form.country).dial} …` : 'Phone with country code'} inputMode="tel" />{err('phone')}</Field><FieldFix field="phone" check={f.phone} value={form.phone} onPick={pick} /></div>
              <div><Field label={label('Website', 'website')}><input data-field="website" className={inputCls + hl('website')} value={form.website} onChange={set('website')} placeholder="https://…" inputMode="url" />{err('website')}</Field><FieldFix field="website" check={f.website} value={form.website} onPick={pick} /></div>
              <Field label="Booking link"><input className={inputCls} value={form.booking_url} onChange={set('booking_url')} placeholder="Appointment / order URL" /></Field>
              <Field label="Contact person"><input className={inputCls} value={form.contact_name} onChange={set('contact_name')} placeholder="Owner or manager" /></Field>
              <div className="md:col-span-2"><Field label="Contact email" hint="Reports are emailed here."><input data-field="contact_email" className={inputCls + hl('contact_email')} value={form.contact_email} onChange={set('contact_email')} placeholder="owner@…" inputMode="email" />{err('contact_email')}</Field></div>
              {(s?.hours?.length > 0 || source?.hours?.length > 0) && <div className="md:col-span-2 rounded-lg bg-slate-50 ring-1 ring-inset ring-slate-200 px-3 py-2 text-12 text-slate-600 flex gap-2"><Clock size={13} className="text-slate-400 mt-0.5 shrink-0" /><span><b className="text-slate-700">Opening hours from Google Maps:</b> {(s?.hours?.length ? s.hours : source.hours).join(' · ')}</span></div>}
            </div>
          )}
          {section === 'location' && (
            <div className="space-y-4">
              <div><Field label={label('Street address', 'address')}><input data-field="address" className={inputCls + hl('address')} value={form.address} onChange={set('address')} placeholder="Shop / building, street, area, city, PIN" /></Field><FieldFix field="address" check={f.address} value={form.address} onPick={pick} /></div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field label="Area / locality"><input data-field="area" className={inputCls + hl('area')} value={form.area} onChange={set('area')} placeholder="e.g. Aundh" /></Field>
                <Field label="City"><input className={inputCls} value={form.city} onChange={set('city')} placeholder="e.g. Pune" /></Field>
                <Field label="Country" hint="Google is searched here; phone and address checks follow it."><CountrySelect value={form.country} onChange={v => setForm(x => ({ ...x, country: v }))} className={inputCls} /></Field>
              </div>
              {form.lat == null && s?.pin && <Suggestion label="Map pin" value={`${s.pin.lat.toFixed(5)}, ${s.pin.lng.toFixed(5)}`} source="Google Maps" inUse={false} onUse={() => setForm(x => ({ ...x, lat: s.pin.lat, lng: s.pin.lng }))} />}
              <div data-field="map" className={box('map')}><LocationCard form={form} setForm={setForm} source={source} bare /></div>
              <TargetMarket form={form} setForm={setForm} />
            </div>
          )}
          {section === 'services' && (
            <div className="space-y-4">
              <div data-field="services" className={box('services')}><Field label="Services offered" hint="Press Enter after each service."><Chips values={form.services} onChange={v => setForm({ ...form, services: v })} placeholder="e.g. Dental implants, Root canal" suggestions={s?.services.values || []} max={10} /></Field></div>
              <div data-field="keywords" className={box('keywords')}><Field label="Keywords to track" hint="Suggestions are real Google searches in the area. Rank tracking starts with these."><Chips values={form.keywords} onChange={v => setForm({ ...form, keywords: v })} placeholder="e.g. dentist in aundh" suggestions={keywordIdeas} max={10} /></Field></div>
              <Field label="Attributes" hint="Shown on the Google profile, e.g. wheelchair accessible."><Chips values={form.attributes} onChange={v => setForm({ ...form, attributes: v })} placeholder="e.g. Wheelchair accessible" suggestions={ATTRIBUTE_IDEAS} /></Field>
            </div>
          )}
          {section === 'plan' && (
            <div className="space-y-4">
              <PlanPicker value={form.plan} onChange={p => setForm({ ...form, plan: p })} plans={plans} />
              {jobs.length > 0 && (
                <div className="rounded bg-slate-50 ring-1 ring-inset ring-slate-200 px-4 py-3">
                  <div className="text-12 font-semibold text-slate-700 mb-2">{form.plan} runs automatically after onboarding</div>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">{jobs.map(([j, e]) => <li key={j} className="flex items-center justify-between gap-2 text-12.5"><span className="flex items-center gap-2 text-slate-800"><ShieldCheck size={13} className="text-indigo-500" />{JOB_LABELS[j] || j}</span><span className="text-slate-500 capitalize">{EVERY[e] || e}</span></li>)}</ul>
                </div>
              )}
              <ActionPlan form={form} res={res} source={source} planName={form.plan} jobs={jobs} />
            </div>
          )}
        </div>
      </section>

      <ActionBar onBack={idx === 0 ? onBack : () => go(SECTIONS[idx - 1][0])} backLabel={idx === 0 ? 'Change business' : 'Back'}
        onNext={next} nextLabel={idx < SECTIONS.length - 1 ? `Next: ${SECTIONS[idx + 1][1]}` : 'Review & launch'}
        hint={tried && Object.values(errors).some(Boolean) ? <span className="text-red-600">Fix the highlighted fields first</span>
          : missingFields.size ? <span className="text-amber-700">{missingFields.size} detail{missingFields.size === 1 ? '' : 's'} still missing · see the list on the right</span> : `Section ${idx + 1} of ${SECTIONS.length} · all details filled in`} />
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
      <div className="min-w-0"><div className={`text-13 font-medium ${state === 'todo' || state === 'skipped' ? 'text-slate-400' : 'text-slate-900'}`}>{label}</div>{detail && <div className={`text-12 ${state === 'failed' ? 'text-red-600' : 'text-slate-500'}`}>{detail}</div>}</div>
    </li>
  );
}

function LaunchStep({ form, source, existing, plans, followUps = [], onBack, onDone }) {
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
        name: form.name.trim(), phone: form.phone.trim(), website: normaliseUrl(form.website) || null, address: form.address.trim() || null, country: form.country || 'IN',
        category: form.primary_category.trim() || (realCategory(source?.category) || null), description: form.description.trim() || null
      };
      // The audit waits until the details and keywords below are saved, so it audits the real business.
      const b = await api('/discover/import', { method: 'POST', body: { email: form.contact_email.trim(), candidate, plan: form.plan, defer_audit: true } });
      setProject(b);
      mark('create', 'done', b.created ? `Created “${b.name}”` : `Matched the existing project “${b.name}”`);
      mark('reviews', b.imported_reviews ? 'done' : 'skipped', b.imported_reviews ? `${b.imported_reviews} recent Google reviews imported` : 'No Google Maps reviews to import');

      mark('details', 'running');
      const patch = {
        name: form.name.trim(), phone: form.phone.trim(), website: normaliseUrl(form.website) || null, address: form.address.trim() || null,
        area: form.area.trim() || null, city: form.city.trim() || null, country: form.country || 'IN', primary_category: form.primary_category.trim() || null,
        description: form.description.trim() || null, contact_name: form.contact_name.trim() || null, contact_email: form.contact_email.trim() || null,
        booking_url: normaliseUrl(form.booking_url) || null, plan: form.plan, services: form.services.map(name => ({ name })),
        attributes: form.attributes, lat: form.lat, lng: form.lng,
        target_scope: form.target_scope || 'local', target_countries: form.target_scope === 'international' ? form.target_countries : [], target_areas: form.target_scope === 'international' ? [] : form.target_areas
      };
      await api(`/businesses/${b.id}`, { method: 'PATCH', body: Object.fromEntries(Object.entries(patch).filter(([k, v]) => v !== null || k === 'services' || k === 'attributes')) });
      mark('details', 'done', `${form.services.length} service${form.services.length === 1 ? '' : 's'}, contact and location saved`);

      // Step 1 of the process: research the competitors. Keyword discovery then starts from what it finds.
      mark('competitors', 'running');
      try {
        const cr = await api(`/businesses/${b.id}/competitor-research`);
        if (!cr.setup?.google_results) mark('competitors', 'skipped', 'Needs a Google results key (SERPER_API_KEY). Run it later from Competitor Research.');
        else {
          await api(`/businesses/${b.id}/competitor-research`, { method: 'POST', body: { keywords: (form.keywords.length ? form.keywords : cr.defaults.keywords).slice(0, 4), location: cr.defaults.location } });
          mark('competitors', 'done', 'Competitor research started. Keyword Intelligence builds on it when it finishes.');
        }
      } catch (e) { mark('competitors', 'skipped', 'Could not start competitor research. Run it from Competitor Research.'); }

      if (form.keywords.length) {
        mark('keywords', 'running');
        const r = await api(`/businesses/${b.id}/keywords`, { method: 'POST', body: form.keywords.map(keyword => ({ keyword })) });
        mark('keywords', 'done', `${r?.added ?? form.keywords.length} keyword${form.keywords.length === 1 ? '' : 's'} added for tracking`);
      } else mark('keywords', 'skipped', 'No seed keywords given');

      if (followUps.length) {
        mark('followups', 'running');
        const r = await api(`/businesses/${b.id}/tasks`, { method: 'POST', body: followUps.map(({ kind, title, fix, code, impact }) => ({ kind, title, fix, code, impact })) });
        mark('followups', 'done', r.added ? `${r.added} fix${r.added === 1 ? '' : 'es'} for the website and Google profile added to the to-do list` : 'Already on the to-do list');
      } else mark('followups', 'skipped', 'Nothing to change on the website or Google profile');

      mark('audit', 'running', 'Auditing all six areas, then planning fixes and setting the schedule');
      await api(`/discover/onboard/${b.id}`, { method: 'POST' });
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-13">
          <dl className="space-y-1.5">
            {[['Business', form.name], ['Category', form.primary_category || '—'], ['Phone', form.phone], ['Website', form.website || '—'], ['Map pin', form.lat != null ? `${form.lat.toFixed(5)}, ${form.lng.toFixed(5)}` : 'Not set'], ['Location', [form.area, form.city].filter(Boolean).join(', ') || form.address || '—'], ['Contact', [form.contact_name, form.contact_email].filter(Boolean).join(' · ') || '—']].map(([k, v]) => (
              <div key={k} className="flex gap-3"><dt className="w-20 shrink-0 text-slate-500">{k}</dt><dd className="text-slate-900 font-medium min-w-0 break-words">{v}</dd></div>
            ))}
          </dl>
          <div className="space-y-2">
            <div><span className="text-slate-500">Services: </span><span className="text-slate-900">{form.services.join(', ') || '—'}</span></div>
            <div><span className="text-slate-500">Keywords: </span><span className="text-slate-900">{form.keywords.join(', ') || '—'}</span></div>
            {followUps.length > 0 && <div><span className="text-slate-500">To fix outside the app: </span><span className="text-slate-900">{followUps.length} (website & Google profile)</span></div>}
            <div><span className="text-slate-500">Plan: </span><span className="text-slate-900 font-semibold">{form.plan}</span>{jobs.length > 0 && <span className="text-slate-500"> · {jobs.map(([j, e]) => `${JOB_LABELS[j] || j} (${EVERY[e] || e})`).join(', ')}</span>}</div>
          </div>
        </div>
      </Card>

      <Card title="Onboarding run" subtitle={phase === 'ready' ? 'What happens when you launch' : phase === 'finished' ? 'Done' : phase === 'failed' ? 'Stopped' : 'Working…'}>
        <ol className="divide-y divide-slate-100">
          <StepLine state={log.create?.state || 'todo'} label={(project ? !project.created : existing) ? 'Update the existing project' : 'Create the project'} detail={log.create?.detail} />
          <StepLine state={log.reviews?.state || 'todo'} label="Import recent Google reviews" detail={log.reviews?.detail} />
          <StepLine state={log.details?.state || 'todo'} label="Save details, services and plan" detail={log.details?.detail} />
          <StepLine state={log.competitors?.state || 'todo'} label="Research competitors (step 1)" detail={log.competitors?.detail} />
          <StepLine state={log.keywords?.state || 'todo'} label="Add seed keywords" detail={log.keywords?.detail} />
          <StepLine state={log.followups?.state || 'todo'} label="Add website & Google profile fixes to the to-do list" detail={log.followups?.detail || (followUps.length ? followUps.map(x => x.title).join(' · ') : null)} />
          <StepLine state={log.audit?.state || 'todo'} label="Baseline audit, AI fix plan and schedule" detail={log.audit?.detail} />
        </ol>
        {(phase === 'auditing' || phase === 'finished') && (
          <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2">
            {AREAS.map(([k, label]) => {
              const a = audits[k];
              const st = !a ? 'waiting' : a.status;
              return (
                <div key={k} className="rounded ring-1 ring-inset ring-slate-200 bg-slate-50 px-3 py-2 flex items-center justify-between gap-2">
                  <span className="text-12 font-medium text-slate-700">{label}</span>
                  {st === 'done' ? <span className="text-13 font-bold text-slate-900 tabular-nums">{a.score ?? '—'}{a.data_source === 'sample' && <span className="ml-1 text-10 font-semibold text-amber-700">sample</span>}</span>
                    : st === 'failed' ? <span className="text-11 font-semibold text-red-600" title={a.error}>failed</span>
                      : <Loader2 size={14} className="text-indigo-600 animate-spin" />}
                </div>
              );
            })}
          </div>
        )}
        <ErrorNote>{error}</ErrorNote>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {phase === 'ready' || phase === 'failed'
            ? <button onClick={onBack} className="h-10 px-4 rounded text-13 font-semibold bg-white ring-1 ring-inset ring-slate-200 text-slate-700 hover:bg-slate-50 inline-flex items-center gap-2 cursor-pointer"><ArrowLeft size={14} /> Back</button>
            : <span className="text-12 text-slate-500">{phase === 'auditing' ? 'The audit runs on the server. You can leave this page; it keeps going.' : ''}</span>}
          <div className="flex flex-wrap gap-2">
            {(phase === 'ready' || phase === 'failed') && (
              <button onClick={launch} className="h-10 px-5 rounded text-13 font-semibold bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm hover:shadow-md inline-flex items-center gap-2 cursor-pointer"><Rocket size={15} /> {phase === 'failed' ? 'Try again' : existing ? 'Update project & run onboarding' : 'Create project & start onboarding'}</button>
            )}
            {(phase === 'auditing' || phase === 'finished') && project && (
              <>
                <button onClick={onDone} className="h-10 px-4 rounded text-13 font-semibold bg-white ring-1 ring-inset ring-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer">Onboard another</button>
                <button onClick={() => open('dashboard')} className="h-10 px-4 rounded text-13 font-semibold bg-white ring-1 ring-inset ring-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer">Command Center</button>
                <button onClick={() => open('gmb-profile')} className="h-10 px-4 rounded text-13 font-semibold bg-indigo-600 text-white hover:bg-indigo-700 inline-flex items-center gap-1.5 cursor-pointer">Open project <ArrowRight size={14} /></button>
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
          <span><span className="block text-13.5 font-semibold text-slate-900">Data sources</span><span className="block text-12 text-slate-500">{s ? `${on} of ${rows.length} switched on` : 'Checking…'}</span></span>
          <span className="flex items-center gap-1">{rows.map(([Icon, label, ok]) => <span key={label} title={label} className={`w-6 h-6 rounded-md flex items-center justify-center ${ok ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}><Icon size={12} /></span>)}</span>
        </button>
        {open && s && (
          <ul className="mt-3 pt-3 border-t border-slate-100 space-y-2.5">
            {rows.map(([Icon, label, ok, hint]) => (
              <li key={label} className="flex items-start gap-2.5">
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${ok ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}><Icon size={14} /></span>
                <div className="min-w-0"><div className="text-12.5 font-medium text-slate-900 flex items-center gap-1.5">{label}{ok ? <CheckCircle2 size={12} className="text-emerald-600" /> : <span className="text-10 font-semibold uppercase text-slate-400">off</span>}</div><div className="text-11 text-slate-500">{hint}</div></div>
              </li>
            ))}
            <li><button type="button" onClick={() => navigate(path('google-integrations'))} className="text-12 font-semibold text-indigo-700 hover:underline cursor-pointer">Manage integrations</button></li>
          </ul>
        )}
      </Card>
      {showPlan && (
        <Card title={`${plan} plan`} subtitle="Runs automatically after onboarding">
          {!plans ? <div className="py-4 flex justify-center text-slate-400"><Loader2 size={16} className="animate-spin" /></div> : jobs.length ? (
            <ul className="space-y-2">{jobs.map(([j, e]) => <li key={j} className="flex items-center justify-between gap-2 text-13"><span className="flex items-center gap-2 text-slate-800"><ShieldCheck size={14} className="text-indigo-500" />{JOB_LABELS[j] || j}</span><span className="text-12 text-slate-500 capitalize">{EVERY[e] || e}</span></li>)}</ul>
          ) : <div className="text-13 text-slate-500">No automatic services in this plan.</div>}
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
  const lastCountry = () => { try { return localStorage.getItem(LAST_COUNTRY_KEY) || 'IN'; } catch (e) { return 'IN'; } };
  const [query, setQueryState] = useState(() => ({ website: '', email: '', name: '', city: '', country: lastCountry(), target_scope: 'local', target_countries: [], target_areas: [] }));
  const setQuery = (q) => { setQueryState(q); try { localStorage.setItem(LAST_COUNTRY_KEY, q.country || 'IN'); } catch (e) { /* private window */ } };
  const [result, setResult] = useState(null);
  const [source, setSource] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [followUps, setFollowUps] = useState([]);

  const existing = useMemo(() => findExisting(list, { ...source, name: form.name, phone: form.phone, website: form.website }), [list, source, form.name, form.phone, form.website]);

  const useCandidate = (c) => {
    const parts = String(c.address || '').split(',').map(p => p.trim()).filter(Boolean);
    const city = c.city || parts.slice().reverse().find(p => !/\d/.test(p) && !/^(india|maharashtra)$/i.test(p)) || query.city;
    setSource(c);
    setForm({
      ...EMPTY,
      name: c.name || query.name, primary_category: realCategory(c.category), description: c.description || '', phone: c.phone || '',
      website: c.website || query.website, address: c.address || '', city: city || '', area: c.area || (parts.length >= 3 ? parts[parts.length - 3] : ''),
      contact_email: query.email || c.email || '', plan: 'Growth', lat: c.lat ?? null, lng: c.lng ?? null, country: c.country || query.country || 'IN',
      attributes: c.attributes || [], services: c.services || [],
      target_scope: query.target_scope, target_countries: query.target_countries, target_areas: query.target_areas
    });
    setStep('review');
  };
  const manual = () => {
    setSource(null);
    setForm({ ...EMPTY, name: query.name, website: query.website, contact_email: query.email, city: query.city, country: query.country || 'IN', target_scope: query.target_scope, target_countries: query.target_countries, target_areas: query.target_areas });
    setStep('review');
  };
  const reset = () => { setStep('find'); setResult(null); setSource(null); setForm(EMPTY); setFollowUps([]); setQuery({ website: '', email: '', name: '', city: '', country: query.country || 'IN', target_scope: 'local', target_countries: [], target_areas: [] }); };

  return (
    <SeoShell title="Business Onboarding" subtitle="Add a client: find its real details, confirm them, and let the AI agents audit and plan the work" hideSwitcher needsBusiness={false}>
      <Stepper step={step} />
      {step === 'review' ? <ReviewStep form={form} setForm={setForm} source={source} plans={plans} existing={existing} onFollowUps={setFollowUps} onBack={() => setStep('find')} onNext={() => setStep('launch')} /> : (
        <StepLayout side={<>{step === 'find' && <AssistantPreview />}<SourcesPanel plan={form.plan} plans={plans} showPlan={step === 'launch'} /></>}>
          {step === 'find' && <FindStep query={query} setQuery={setQuery} result={result} setResult={setResult} onUse={useCandidate} onManual={manual} list={list} onOpenExisting={(id) => { choose(id); navigate(path('gmb-profile')); }} />}
          {step === 'launch' && <LaunchStep form={form} source={source} existing={existing} plans={plans} followUps={followUps} onBack={() => setStep('review')} onDone={reset} />}
        </StepLayout>)}
    </SeoShell>
  );
}
