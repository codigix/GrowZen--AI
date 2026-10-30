import React, { useEffect, useRef, useState } from 'react';
import {
  Sparkles, RefreshCw, AlertTriangle, CircleHelp, CircleDashed, ShieldCheck, Wand2, Check, Loader2, Globe, Store, ChevronDown, ChevronRight,
  ListTodo, ExternalLink, X
} from 'lucide-react';
import { Button, ErrorNote, useAction } from './SeoUi';
import { api } from './seoApi';
import { countryInfo, nationalNumber, phoneOk, hasPostcode } from './countries';

/**
 * Onboarding assistant (POST /discover/assist): every key detail cross-checked against Google Maps and the
 * business's website, the problems found, and suggestions (category, description, services, real local
 * keywords, map pin). The check runs once on arrival; suggestions show next to the field they belong to.
 * Nothing in the form changes without a click.
 *
 * The side panel is a live checklist: what the profile is still missing (with a one-click fix when a
 * source has the value), what needs a decision, and what has to change on the business's own website or
 * Google profile (those are added to the to-do list at launch).
 */

export const STATUS = {
  verified: { label: 'Verified', icon: ShieldCheck, tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  conflict: { label: 'Sources disagree', icon: AlertTriangle, tone: 'bg-red-50 text-red-700 ring-red-200' },
  suggested: { label: 'Found', icon: Wand2, tone: 'bg-indigo-50 text-indigo-700 ring-indigo-200' },
  single_source: { label: 'One source', icon: CircleHelp, tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
  only_typed: { label: 'Not confirmed', icon: CircleHelp, tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
  missing: { label: 'Not found', icon: CircleDashed, tone: 'bg-slate-50 text-slate-500 ring-slate-200' }
};
const LEVEL = { critical: 'text-red-700', serious: 'text-orange-700', warning: 'text-amber-800', info: 'text-slate-600' };
const FIELD_LABEL = { name: 'Business name', phone: 'Phone', address: 'Address', website: 'Website', primary_category: 'Category' };
const FIELD_SECTION = { name: 'business', primary_category: 'business', phone: 'contact', website: 'contact', address: 'location' };

/**
 * Where a detail is changed outside this form. Google Business Profile paths are the "Edit profile" menu the
 * owner sees when signed in (Google Search or business.google.com); website places are where Google reads it.
 */
export const WHERE = {
  name: { google: 'Edit profile → About → Business name', website: 'Site header, footer and the home page title' },
  primary_category: { google: 'Edit profile → About → Business category', website: 'Home page title and main heading (e.g. "Dentist in Aundh") and the schema type' },
  description: { google: 'Edit profile → About → Description', website: 'Home page introduction and its meta description' },
  phone: { google: 'Edit profile → Contact → Phone number', website: 'Footer and Contact page, as a tap-to-call link' },
  website: { google: 'Edit profile → Contact → Website' },
  address: { google: 'Edit profile → Location → Business location', website: 'Footer and Contact page, written exactly as on Google, with the PIN code' },
  map: { google: 'Edit profile → Location → move the map pin to the entrance' },
  services: { google: 'Edit profile → Services (or "Edit services")', website: 'One page per service, linked from the menu' },
  schema: { website: 'Add LocalBusiness JSON-LD to the home page <head> (the to-do task has it ready to paste)' }
};
const GOOGLE_MANAGE = 'https://business.google.com/locations';

// Phones and postcodes are checked by the business's country (countries.js).
const samePhone = (a, b, c) => { const x = nationalNumber(a, c); const y = nationalNumber(b, c); return x.length >= 7 && (x === y || (Math.min(x.length, y.length) >= 8 && (x.endsWith(y) || y.endsWith(x)))); };
const merge = (list, add) => [...new Set([...list, ...add])];

/**
 * Everything the profile needs, live as the form changes: { key, label, why, section, field, done, fix? }.
 * `fix` is a value a source found ({ value, from, apply(form) => form }), so it can be filled in one click.
 */
export function profileGaps(form, res) {
  const f = res?.fields || {};
  const s = res?.suggestions;
  const found = (k, ok = () => true) => { const v = f[k]?.best; return v && !String(form[k] || '').trim() && ok(v) ? v : null; };
  const fromOf = (k) => (f[k]?.options?.[0]?.sources || []).join(' + ') || 'a source';
  const fixField = (k, ok) => { const v = found(k, ok); return v ? { value: v, from: fromOf(k), apply: (x) => ({ ...x, [k]: v }) } : null; };
  const c = form.country;
  const info = countryInfo(c);
  const postcode = info.postcode ? info.postcode_name : null;
  const newServices = (s?.services?.values || []).filter(v => !form.services.includes(v));
  const newKeywords = (s?.keywords?.values || []).filter(v => !form.keywords.includes(v)).slice(0, 6);
  return [
    { key: 'name', label: 'Business name', section: 'business', field: 'name', done: Boolean(form.name.trim()), why: 'The registered name, exactly as on the signboard.' },
    {
      key: 'category', label: 'Primary category', section: 'business', field: 'primary_category', done: Boolean(form.primary_category.trim()),
      why: 'Decides which searches Google shows the business for.',
      fix: s?.category?.value && { value: s.category.value, from: s.category.source, apply: (x) => ({ ...x, primary_category: s.category.value }) }
    },
    {
      key: 'description', label: 'Description (250+ characters)', section: 'business', field: 'description', done: form.description.trim().length >= 250,
      why: `Tells Google and customers what the business does and where.${form.description.trim() ? ` Now ${form.description.trim().length} characters.` : ''}`,
      fix: s?.description?.value && s.description.value.length > form.description.trim().length && { value: s.description.value, from: s.description.source, apply: (x) => ({ ...x, description: s.description.value }) }
    },
    {
      key: 'phone', label: info.dial ? `Phone (+${info.dial})` : 'Phone', section: 'contact', field: 'phone', done: phoneOk(form.phone, c),
      why: `Calls are the main lead from Google; needed on the profile and every listing.${form.phone && !phoneOk(form.phone, c) ? ` It doesn't look complete for ${info.name}.` : ''}`, fix: fixField('phone', v => phoneOk(v, c))
    },
    {
      key: 'website', label: 'Website', section: 'contact', field: 'website', done: Boolean(form.website.trim()),
      why: 'Businesses with a website rank higher, and the SEO audits need it.', fix: fixField('website')
    },
    {
      key: 'email', label: 'Contact email', section: 'contact', field: 'contact_email', done: Boolean(form.contact_email.trim()),
      why: 'Monthly reports and alerts go here. Ask the client for it.'
    },
    {
      key: 'address', label: postcode ? `Address with ${postcode}` : 'Full address', section: 'location', field: 'address', done: Boolean(form.address.trim()) && hasPostcode(form.address, c),
      why: `Must match Google Maps for local rankings${postcode ? `; the ${postcode} places it` : ''}.`, fix: fixField('address', v => hasPostcode(v, c))
    },
    {
      key: 'area', label: 'Area and city', section: 'location', field: 'area', done: Boolean(form.area.trim() && form.city.trim()),
      why: 'Used in the keywords customers type, like "dentist in Aundh".'
    },
    {
      key: 'pin', label: 'Map pin', section: 'location', field: 'map', done: form.lat != null,
      why: 'Needed for street-by-street (geo-grid) rank tracking.',
      fix: s?.pin && { value: `${s.pin.lat.toFixed(5)}, ${s.pin.lng.toFixed(5)}`, from: 'Google Maps', apply: (x) => ({ ...x, lat: s.pin.lat, lng: s.pin.lng }) }
    },
    {
      key: 'services', label: 'At least 3 services', section: 'services', field: 'services', done: form.services.length >= 3,
      why: `Each service is a search the business can rank for.${form.services.length ? ` ${form.services.length} so far.` : ''}`,
      fix: newServices.length > 0 && { value: newServices.slice(0, 5).join(', '), from: s.services.source || 'Suggested', apply: (x) => ({ ...x, services: merge(x.services, newServices).slice(0, 10) }) }
    },
    {
      key: 'keywords', label: 'At least 3 keywords', section: 'services', field: 'keywords', done: form.keywords.length >= 3,
      why: 'Rank tracking starts with these.',
      fix: newKeywords.length > 0 && { value: newKeywords.join(', '), from: 'Google searches', apply: (x) => ({ ...x, keywords: merge(x.keywords, newKeywords).slice(0, 10) }) }
    }
  ];
}

const same = (k, a, b, c) => (k === 'phone' ? samePhone(a, b, c) : String(a || '').toLowerCase().replace(/[^a-z0-9]/g, '') === String(b || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
const SOURCE_FIELDS = ['name', 'phone', 'website', 'address', 'primary_category'];

/**
 * After a re-fetch: the new values from Google Maps (else the website) for each detail. A field is updated
 * only when it is empty or still holds the value fetched before, so anything typed by hand is kept.
 * Returns { patch, changes: [{ field, label, from, to, source }] }.
 */
export function refreshedValues(prev, next, form) {
  const patch = {};
  const changes = [];
  SOURCE_FIELDS.forEach(k => {
    const pv = prev?.fields?.[k]?.values || {};
    const nv = next?.fields?.[k]?.values || {};
    const to = nv.maps || nv.website;
    if (!to) return;
    const was = pv.maps || pv.website;
    const cur = String(form[k] || '').trim();
    if (same(k, cur, to, form.country)) return;
    if (!cur || same(k, cur, was, form.country)) {
      patch[k] = to;
      changes.push({ field: k, label: FIELD_LABEL[k], from: cur, to, source: nv.maps ? 'Google Maps' : 'the website' });
    }
  });
  const pin = next?.suggestions?.pin; const oldPin = prev?.suggestions?.pin;
  if (pin && (form.lat == null || (oldPin && form.lat === oldPin.lat && form.lng === oldPin.lng)) && (form.lat !== pin.lat || form.lng !== pin.lng)) {
    patch.lat = pin.lat; patch.lng = pin.lng;
    changes.push({ field: 'map', label: 'Map pin', from: form.lat != null ? `${form.lat.toFixed(5)}, ${form.lng.toFixed(5)}` : '', to: `${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`, source: 'Google Maps' });
  }
  return { patch, changes };
}

/** Share of the profile that is complete. */
export function completeness(form, res) {
  const items = profileGaps(form, res);
  const done = items.filter(i => i.done).length;
  return { done, total: items.length, pct: Math.round((done / items.length) * 100), missing: items.filter(i => !i.done).map(i => i.label) };
}

/** Details where Google Maps, the website and the form disagree, until one is chosen. */
export function decisions(res) {
  return Object.entries(res?.fields || {}).filter(([, v]) => v.status === 'conflict')
    .map(([k, v]) => ({ key: k, label: FIELD_LABEL[k] || k, section: FIELD_SECTION[k] || 'business', field: k, options: v.options }));
}

/**
 * What has to change outside this form, on the business's own website or its Google profile, so every place
 * shows the same name, address and phone. Each becomes a to-do task at launch: { where, kind, code, title, fix, impact }.
 */
export function outsideFixes(form, res) {
  if (!res) return [];
  const f = res.fields || {};
  const by = (k) => f[k]?.values || {};
  const out = [];
  const add = (where, title, fix, code = '', impact = 'Medium', field = null) => out.push({ where, kind: where === 'google' ? 'profile_edit' : 'website_fix', title, fix, code, impact, field });
  const phone = by('phone'); const address = by('address');
  if (res.website?.read) {
    if (!phone.website && (form.phone || phone.maps)) add('website', 'Show the phone number on the website', 'Google matches the name, address and phone across the web. Put the phone in the footer and on the contact page.', 'nap_phone', 'High', 'phone');
    else if (phone.website && (phone.maps || form.phone) && !samePhone(phone.website, phone.maps || form.phone, form.country)) add('website', 'Make the website\'s phone number match Google', `The website shows ${phone.website}; Google has ${phone.maps || form.phone}. Use one number everywhere.`, 'nap_mismatch', 'High', 'phone');
    if (!address.website && (form.address || address.maps)) add('website', 'Show the full address on the website', 'Add the address, with PIN code, to the footer and contact page, written exactly as on Google.', 'nap_address', 'Medium', 'address');
    if (!by('primary_category').website) add('website', 'Add LocalBusiness structured data', 'Schema markup tells Google the business type, address, phone and hours.', 'no_localbusiness_schema', 'Medium', 'schema');
    if ((res.checks || []).some(c => /JavaScript/i.test(c.text))) add('website', 'Make the website readable without JavaScript', 'Google and AI search may see an empty page. Ask the developer for server-side rendering.', 'javascript_only', 'High');
  } else if (res.website?.domain) {
    add('website', 'Fix the website: it did not load', `${res.website.domain} did not answer. Check the address and that the site is online.`, 'site_down', 'High');
  } else if (!form.website.trim()) {
    add('website', 'Get a website', 'Every business on Google\'s first page has one; without it the business can only show in Maps.', 'no_website');
  }
  if (res.maps?.matched) {
    if (!by('website').maps && form.website.trim()) add('google', 'Add the website to the Google profile', 'The Google listing has no website link, so it loses clicks and ranking signal.', '', 'High', 'website');
    if (!phone.maps && form.phone.trim()) add('google', 'Add the phone number to the Google profile', 'Customers can\'t call from the listing.', '', 'High', 'phone');
    if ((res.checks || []).some(c => /listing's name/i.test(c.text))) add('google', 'Rename the Google listing to the registered name', 'Extra keywords in the listing name can get the profile suspended.', '', 'High', 'name');
  } else if (res.maps?.enabled && form.name.trim()) {
    add('google', 'Create or claim the Google Business Profile', 'No Google Maps listing was found for this name. Without one the business can\'t appear in Maps.', '', 'High');
  }
  return out;
}

export function SourceTag({ source }) {
  return <span className={`text-10 font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ring-1 ring-inset whitespace-nowrap ${source === 'AI' ? 'bg-violet-50 text-violet-700 ring-violet-200' : 'bg-slate-50 text-slate-500 ring-slate-200'}`}>{source === 'AI' ? 'AI' : `from ${source}`}</span>;
}

/**
 * Runs the check once when the step opens. `refetch()` reads Google Maps (skipping its cache) and the website
 * again after the details were changed there, updates the form fields that still hold the old fetched value,
 * and lists what changed. It also runs by itself when the user comes back to this tab after a while away
 * (e.g. after editing the Google profile or the website in another tab).
 */
export function useAssist(form, source, setForm) {
  const [res, setRes] = useState(null);
  const [busy, error, run] = useAction();
  const [lastChecked, setLastChecked] = useState(null);
  const [changes, setChanges] = useState(null); // null = no re-fetch yet; [] = nothing new
  const [auto, setAuto] = useState(false);
  const started = useRef(false);
  const formRef = useRef(form); formRef.current = form;
  const resRef = useRef(res); resRef.current = res;
  const ask = (f, fresh) => api('/discover/assist', {
    method: 'POST', body: {
      name: f.name, primary_category: f.primary_category, description: f.description, phone: f.phone, website: f.website,
      address: f.address, area: f.area, city: f.city, country: f.country || '', services: f.services, fresh,
      place_id: (source?.source === 'google_maps' ? source.place_id : null) || resRef.current?.maps?.place_id || null
    }
  });
  const check = () => run('check', async () => { setRes(await ask(formRef.current, false)); setLastChecked(Date.now()); });
  const refetch = (byItself = false) => run('refetch', async () => {
    setAuto(byItself);
    const next = await ask(formRef.current, true);
    const { patch, changes: found } = refreshedValues(resRef.current, next, formRef.current);
    if (Object.keys(patch).length && setForm) {
      const merged = { ...formRef.current, ...patch };
      setForm(merged);
      setRes(await ask(merged, false)); // check again with the new values (Maps is cached now, so this is quick)
    } else setRes(next);
    setChanges(found);
    setLastChecked(Date.now());
  });
  useEffect(() => { if (!started.current && form.name.trim()) { started.current = true; check(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const refetchRef = useRef(refetch); refetchRef.current = refetch;
  const lastRef = useRef(lastChecked); lastRef.current = lastChecked;
  useEffect(() => {
    let hiddenAt = null;
    const onVisible = () => {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt > 15000 && resRef.current && Date.now() - (lastRef.current || 0) > 30000) refetchRef.current(true);
      hiddenAt = null;
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  // A value picked by hand counts as verified only when two or more sources back it.
  const resolve = (field, value, sources = []) => setRes(r => r && ({ ...r, fields: { ...r.fields, [field]: { ...r.fields[field], status: sources.length >= 2 ? 'verified' : 'single_source', chosen: value } } }));
  return { res, busy: busy === 'check', refetching: busy === 'refetch', error, check, refetch, resolve, lastChecked, changes, auto, dismissChanges: () => setChanges(null) };
}

/** A field's check, shown next to its label. */
export function FieldBadge({ check }) {
  if (!check) return null;
  const st = STATUS[check.status] || STATUS.missing;
  const by = check.options?.[0]?.sources?.join(' + ');
  return <span title={by ? `${st.label}: ${by}` : st.label} className={`inline-flex items-center gap-1 text-10.5 font-semibold px-1.5 py-0.5 rounded-md ring-1 ring-inset ${st.tone}`}><st.icon size={10} /> {st.label}</span>;
}

/** Under a field: the values the sources found when they differ from (or fill) what's typed. */
export function FieldFix({ field, check, value, onPick }) {
  if (!check || !['conflict', 'suggested'].includes(check.status)) return null;
  const options = check.options.filter(o => o.value !== value);
  if (!options.length) return null;
  return (
    <div className="mt-1.5 space-y-1">
      {options.map(o => (
        <div key={o.value} className="flex items-center gap-2 rounded-lg bg-indigo-50/60 ring-1 ring-inset ring-indigo-100 px-2.5 py-1.5">
          <Wand2 size={12} className="text-indigo-500 shrink-0" />
          <span className="flex-1 min-w-0 text-12 text-slate-800 truncate" title={o.value}>{o.value} <span className="text-slate-400">· {o.sources.join(' + ')}</span></span>
          <button type="button" onClick={() => onPick(field, o.value, o.sources)} className="text-11.5 font-semibold text-indigo-700 hover:underline cursor-pointer shrink-0">Use</button>
        </div>
      ))}
    </div>
  );
}

/** A suggested value (category, description, name) with where it came from. */
export function Suggestion({ label, value, source, inUse, onUse, long = false }) {
  if (!value) return null;
  return (
    <div className="mt-1.5 rounded-lg bg-violet-50/60 ring-1 ring-inset ring-violet-100 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <Sparkles size={12} className="text-violet-500 shrink-0" />
        <span className="text-11.5 font-semibold text-slate-700">{label}</span>
        <SourceTag source={source} />
        <span className="ml-auto shrink-0">{inUse ? <span className="text-11.5 text-emerald-700 inline-flex items-center gap-1"><Check size={12} /> In use</span>
          : <button type="button" onClick={onUse} className="text-11.5 font-semibold text-violet-700 hover:underline cursor-pointer">Use</button>}</span>
      </div>
      <div className={`mt-1 text-12 text-slate-800 ${long ? 'leading-relaxed' : 'truncate'}`} title={long ? undefined : value}>{value}</div>
    </div>
  );
}


/** Where to change a detail on the Google profile and on the website, with links. */
function WhereToFix({ field, res, form }) {
  const w = WHERE[field];
  if (!w) return null;
  const site = form.website ? (/^https?:/i.test(form.website) ? form.website : `https://${form.website}`) : '';
  const host = site.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  return (
    <div className="mt-2 space-y-1.5 text-11.5 leading-snug">
      {w.google && (
        <div className="flex gap-1.5">
          <Store size={12} className="text-indigo-500 mt-0.5 shrink-0" />
          <div className="min-w-0"><span className="text-slate-700">{w.google}</span>
            <span className="block">
              {res?.maps?.url && <><a href={res.maps.url} target="_blank" rel="noreferrer" className="font-semibold text-indigo-700 hover:underline">Listing</a><span className="text-slate-300"> · </span></>}
              <a href={GOOGLE_MANAGE} target="_blank" rel="noreferrer" className="font-semibold text-indigo-700 hover:underline inline-flex items-center gap-0.5">Business Profile Manager <ExternalLink size={10} /></a>
            </span>
          </div>
        </div>
      )}
      {w.website && (
        <div className="flex gap-1.5">
          <Globe size={12} className="text-indigo-500 mt-0.5 shrink-0" />
          <div className="min-w-0"><span className="text-slate-700">{w.website}</span>
            {site && <a href={site} target="_blank" rel="noreferrer" className="block font-semibold text-indigo-700 hover:underline truncate">{host} <ExternalLink size={10} className="inline" /></a>}
          </div>
        </div>
      )}
    </div>
  );
}

const TONE = {
  fill: { dot: 'bg-amber-400', open: 'bg-amber-50/70 ring-amber-200' },
  decide: { dot: 'bg-red-500', open: 'bg-red-50/60 ring-red-200' },
  outside: { dot: 'bg-indigo-500', open: 'bg-indigo-50/50 ring-indigo-100' },
  note: { dot: 'bg-slate-400', open: 'bg-slate-50 ring-slate-200' }
};

/** One line per item; click to open its details. Only one item is open at a time. */
function Row({ id, open, setOpen, tone, title, action, children }) {
  const isOpen = open === id;
  return (
    <li className={`rounded-lg ${isOpen ? `ring-1 ring-inset ${TONE[tone].open}` : 'hover:bg-slate-50'}`}>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button type="button" onClick={() => setOpen(isOpen ? null : id)} aria-expanded={isOpen} className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TONE[tone].dot}`} />
          <span className="flex-1 min-w-0 text-12.5 font-medium text-slate-800 truncate" title={typeof title === 'string' ? title : undefined}>{title}</span>
          {isOpen ? <ChevronDown size={13} className="text-slate-400 shrink-0" /> : <ChevronRight size={13} className="text-slate-400 shrink-0" />}
        </button>
        {action}
      </div>
      {isOpen && <div className="px-2 pb-2 pl-5">{children}</div>}
    </li>
  );
}

const Act = ({ onClick, children, tone = 'indigo' }) => (
  <button type="button" onClick={onClick} className={`shrink-0 h-6 px-2 rounded-md text-11 font-semibold cursor-pointer ${tone === 'red' ? 'text-red-700 bg-red-50 hover:bg-red-100' : tone === 'solid' ? 'text-white bg-indigo-600 hover:bg-indigo-700' : 'text-indigo-700 bg-indigo-50 hover:bg-indigo-100'}`}>{children}</button>
);

/**
 * The side checklist, kept short: a progress line, then one group at a time (to fill, to decide, to change on
 * the website / Google, notes), each item one line that opens for its details. `onGo(section, field)` opens
 * the form section and highlights the field; `setForm` applies a fix.
 */
export function AssistantPanel({ assist, form, setForm, onGo, onApplyAll, onUseName }) {
  const { res, busy, error, refetch, refetching, lastChecked, changes, auto } = assist;
  const [open, setOpen] = useState(null);
  const [tab, setTab] = useState(null);
  const [showChanges, setShowChanges] = useState(false);
  const items = profileGaps(form, res);
  const missing = items.filter(i => !i.done);
  const done = items.filter(i => i.done);
  const pct = Math.round((done.length / items.length) * 100);
  const choose = decisions(res);
  const outside = outsideFixes(form, res);
  const s = res?.suggestions;
  const fields = res ? Object.values(res.fields) : [];
  const verified = fields.filter(x => x.status === 'verified').length;
  const notes = [
    ...(res?.checks || []).filter(c => !/JavaScript|listing's name|didn't answer|description is short/i.test(c.text)).map(c => ({ id: c.text, text: c.text, level: c.level })),
    ...(s?.name && form.name !== s.name.value ? [{ id: 'name', text: `Registered name: ${s.name.value}`, level: 'info', use: true }] : [])
  ];
  const fixable = missing.filter(i => i.fix).length;
  const tabs = [['fill', 'To fill', missing.length], ['decide', 'To decide', choose.length], ['outside', 'Website & Google', outside.length], ['note', 'Notes', notes.length]].filter(t => t[2] > 0);
  const current = tabs.find(t => t[0] === tab) ? tab : tabs[0]?.[0];
  const checkedAt = lastChecked ? new Date(lastChecked).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null;
  const bar = pct >= 90 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-400' : 'bg-red-500';

  return (
    <section className="ai-glass-card rounded p-4">
      {/* Header: title, progress, re-fetch */}
      <div className="flex items-center gap-2">
        <ListTodo size={15} className="text-violet-600 shrink-0" />
        <h3 className="text-14 font-bold text-slate-900">What's missing</h3>
        {res && <span className={`text-9.5 font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ring-1 ring-inset ${res.ai ? 'bg-violet-50 text-violet-700 ring-violet-200' : 'bg-slate-50 text-slate-500 ring-slate-200'}`}>{res.ai ? 'AI' : 'Rules'}</span>}
        <button type="button" onClick={() => refetch(false)} disabled={busy || refetching || !res} title="Fetch the business again from Google Maps and its website"
          className="ml-auto inline-flex items-center gap-1 h-7 px-2 rounded-lg text-11.5 font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 cursor-pointer">
          <RefreshCw size={12} className={refetching ? 'animate-spin' : ''} /> Re-fetch
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full rounded-full transition-all ${bar}`} style={{ width: `${pct}%` }} /></div>
        <span className="text-12 font-bold text-slate-900 tabular-nums">{pct}%</span>
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-11 text-slate-500">
        <span title={done.map(i => i.label).join(', ')}>{done.length} of {items.length} done</span>
        {res && <><span>·</span><span>{verified} of {fields.length} verified</span></>}
        {checkedAt && <><span>·</span><span title="Last fetched from Google Maps and the website">fetched {checkedAt}</span></>}
      </div>

      <ErrorNote>{error}</ErrorNote>
      {(busy && !res) && <div className="mt-3 flex items-center gap-2 text-12 text-slate-500"><Loader2 size={13} className="animate-spin" /> Checking Google Maps and the website…</div>}
      {refetching && <div className="mt-3 flex items-center gap-2 text-12 text-indigo-700"><Loader2 size={13} className="animate-spin" /> {auto ? 'Welcome back: checking for your changes…' : 'Fetching again from Google and the website…'}</div>}
      {!refetching && changes && (
        <div className={`mt-3 rounded-lg px-2.5 py-1.5 text-11.5 ring-1 ring-inset ${changes.length ? 'bg-emerald-50 ring-emerald-200 text-emerald-900' : 'bg-slate-50 ring-slate-200 text-slate-600'}`}>
          <div className="flex items-center gap-1.5">
            {changes.length ? <Check size={12} className="shrink-0" /> : <RefreshCw size={11} className="shrink-0" />}
            <button type="button" onClick={() => setShowChanges(v => !v)} className="flex-1 min-w-0 text-left font-semibold truncate cursor-pointer">
              {changes.length ? `${changes.length} detail${changes.length === 1 ? '' : 's'} updated from the latest fetch` : 'Nothing new yet'}
            </button>
            <button type="button" onClick={assist.dismissChanges} aria-label="Hide" className="text-slate-400 hover:text-slate-600 cursor-pointer"><X size={12} /></button>
          </div>
          {showChanges && (changes.length
            ? <ul className="mt-1 space-y-0.5">{changes.map(c => <li key={c.field} className="leading-snug"><b>{c.label}</b> ({c.source}): {c.from && <><span className="line-through opacity-60">{c.from}</span> → </>}{c.to}</li>)}</ul>
            : <p className="mt-1 leading-snug">Website changes show at once; Google profile edits can take minutes to days while Google reviews them.</p>)}
        </div>
      )}

      {res && tabs.length === 0 && (
        <div className="mt-3 rounded-lg bg-emerald-50 ring-1 ring-inset ring-emerald-200 px-3 py-2.5 text-12.5 text-emerald-800 flex items-center gap-2"><ShieldCheck size={15} /> Everything is filled in and matches.</div>
      )}

      {tabs.length > 0 && (
        <>
          {/* One group at a time */}
          <div role="tablist" className="mt-3 flex gap-1 p-0.5 rounded-lg bg-slate-100">
            {tabs.map(([id, label, n]) => (
              <button key={id} type="button" role="tab" aria-selected={current === id} onClick={() => { setTab(id); setOpen(null); }}
                className={`flex-1 min-w-0 h-7 px-1.5 rounded-md text-11 font-semibold inline-flex items-center justify-center gap-1 cursor-pointer ${current === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                <span className="truncate">{label}</span>
                <span className={`min-w-4 h-4 px-1 rounded-full text-10 leading-4 ${id === 'fill' ? 'bg-amber-100 text-amber-800' : id === 'decide' ? 'bg-red-100 text-red-700' : id === 'outside' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-600'}`}>{n}</span>
              </button>
            ))}
          </div>

          <ul className="mt-2 space-y-0.5">
            {current === 'fill' && missing.map(i => (
              <Row key={i.key} id={i.key} open={open} setOpen={setOpen} tone="fill" title={i.label}
                action={i.fix ? <Act onClick={() => setForm(i.fix.apply)}>Use</Act> : <Act onClick={() => onGo(i.section, i.field)}>Fill in</Act>}>
                <p className="text-11.5 leading-snug text-slate-600">{i.why}</p>
                {i.fix && (
                  <div className="mt-1.5 rounded-md bg-white ring-1 ring-inset ring-indigo-100 px-2 py-1.5 text-11.5 text-slate-700">
                    <span className="text-slate-400">Found ({i.fix.from}): </span><span className="line-clamp-3">{i.fix.value}</span>
                    <button type="button" onClick={() => onGo(i.section, i.field)} className="mt-1 block font-semibold text-indigo-700 hover:underline cursor-pointer">Or type it in yourself</button>
                  </div>
                )}
                <WhereToFix field={i.field} res={res} form={form} />
              </Row>
            ))}

            {current === 'decide' && choose.map(c => (
              <Row key={c.key} id={c.key} open={open} setOpen={setOpen} tone="decide" title={`${c.label}: sources disagree`} action={<Act tone="red" onClick={() => onGo(c.section, c.field)}>Choose</Act>}>
                <ul className="space-y-0.5">{c.options.map(o => <li key={o.value} className="text-11.5 leading-snug text-slate-700"><span className="text-slate-500">{o.sources.join(' + ')}:</span> {o.value}</li>)}</ul>
                <p className="mt-1 text-11 text-slate-500">Pick the right one, then correct the other places so they all match.</p>
                <WhereToFix field={c.field} res={res} form={form} />
              </Row>
            ))}

            {current === 'outside' && outside.map(o => (
              <Row key={o.title} id={o.title} open={open} setOpen={setOpen} tone="outside"
                title={<span className="inline-flex items-center gap-1.5 min-w-0">{o.where === 'google' ? <Store size={12} className="text-indigo-500 shrink-0" /> : <Globe size={12} className="text-indigo-500 shrink-0" />}<span className="truncate">{o.title}</span></span>}>
                <p className="text-11.5 leading-snug text-slate-600">{o.fix}</p>
                {o.field && <WhereToFix field={o.field} res={res} form={form} />}
              </Row>
            ))}

            {current === 'note' && notes.map(n => (
              <Row key={n.id} id={n.id} open={open} setOpen={setOpen} tone="note" title={n.text}
                action={n.use ? <Act onClick={onUseName}>Use</Act> : null}>
                <p className={`text-11.5 leading-snug ${LEVEL[n.level]}`}>{n.text}</p>
              </Row>
            ))}
          </ul>

          {/* One line under the list: the group's main action or what happens next */}
          <div className="mt-2 pt-2 border-t border-slate-100">
            {current === 'fill' && fixable > 1 && <Button className="w-full" variant="primary" size="sm" icon={Wand2} onClick={onApplyAll}>Fill all found details ({fixable})</Button>}
            {current === 'fill' && fixable <= 1 && <p className="text-11 text-slate-500">Click an item for why it matters and where to change it.</p>}
            {current === 'decide' && <p className="text-11 text-slate-500">Open an item to see each source's value.</p>}
            {current === 'outside' && <p className="text-11 text-slate-500">Saved to the to-do list at launch. Fixed one? Re-fetch and it drops off.</p>}
            {current === 'note' && <p className="text-11 text-slate-500">Worth a look before launching.</p>}
          </div>
        </>
      )}
      {res && <p className="mt-2 text-10.5 leading-snug text-slate-400">Changed something on Google or the website? Come back to this tab and it fetches again by itself.{!res.ai ? ' Add an AI key for AI-written descriptions and services.' : ''}</p>}
    </section>
  );
}
