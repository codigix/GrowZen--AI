import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Check, ExternalLink, Download, CheckCircle2, XCircle, CircleDashed, Sparkles, Plus, Trash2, Save, Braces, FileCode, Info } from 'lucide-react';
import { Card, Button, Tabs, ErrorNote, inputCls, areaCls, useAction, useToast, refreshBusinesses, useModulePath } from './SeoUi';
import { api } from './seoApi';
import { pathOnly as pathOf } from './siteUtils';

/**
 * Structured data for the business: what the audit found on the site, a LocalBusiness block built from the
 * profile (the most specific schema.org type for its category, with hours, PIN, photo and map pin), and an
 * FAQ block. FAQs can be drafted from the profile's facts (POST /businesses/{id}/ai/faqs) and saved to it.
 */

// The most specific schema.org type for common Google categories (else LocalBusiness).
const TYPES = [
  [/dent/i, 'Dentist'], [/hospital/i, 'Hospital'], [/clinic|medical|doctor|physician|physio|dermatolog|eye care/i, 'MedicalClinic'],
  [/restaurant/i, 'Restaurant'], [/cafe|coffee/i, 'CafeOrCoffeeShop'], [/bakery/i, 'Bakery'], [/hotel/i, 'Hotel'], [/gym|fitness/i, 'ExerciseGym'],
  [/salon|beauty|spa/i, 'BeautySalon'], [/real estate/i, 'RealEstateAgent'], [/lawyer|legal|advocate/i, 'LegalService'], [/account/i, 'AccountingService'],
  [/school|coaching|academy/i, 'EducationalOrganization'], [/car repair|garage|auto/i, 'AutoRepair'], [/store|shop/i, 'Store'],
  [/agency|marketing|software|it services/i, 'ProfessionalService']
];
const TYPE_OPTIONS = ['LocalBusiness', ...new Set(TYPES.map(t => t[1]))];
const BUSINESS_TYPES = /LocalBusiness|Organization|Dentist|Clinic|Physician|Hospital|Restaurant|Store|Cafe|Hotel|Salon|Gym|Agency|Service|Bakery|RealEstate|Educational|AutoRepair/i;
const DAY = { MONDAY: 'Monday', TUESDAY: 'Tuesday', WEDNESDAY: 'Wednesday', THURSDAY: 'Thursday', FRIDAY: 'Friday', SATURDAY: 'Saturday', SUNDAY: 'Sunday' };
const hhmm = (o) => `${String(o?.hours ?? 0).padStart(2, '0')}:${String(o?.minutes ?? 0).padStart(2, '0')}`;
const script = (json) => `<script type="application/ld+json">\n${json}\n</script>`;

function CopyBtn({ text, label = 'Copy code' }) {
  const [done, setDone] = useState(false);
  return <Button size="sm" variant="primary" icon={done ? Check : Copy} onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}>{done ? 'Copied' : label}</Button>;
}
function download(name, text) {
  const href = URL.createObjectURL(new Blob([text], { type: 'text/html' }));
  Object.assign(document.createElement('a'), { href, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
function Code({ text }) {
  return <pre className="text-[11.5px] leading-relaxed font-mono text-slate-100 bg-slate-900 rounded-xl p-4 overflow-auto max-h-[420px]">{text}</pre>;
}

function localBusiness(b, type) {
  const pin = (b.address || '').match(/\b[1-9]\d{5}\b/)?.[0];
  const periods = b.hours?.periods || [];
  return {
    '@context': 'https://schema.org', '@type': type, name: b.name, url: b.website || undefined, telephone: b.phone || undefined,
    description: b.description || undefined, image: b.cover_photo || b.logo || undefined, logo: b.logo || undefined,
    address: b.address ? { '@type': 'PostalAddress', streetAddress: b.address, addressLocality: b.city || undefined, postalCode: pin, addressCountry: 'IN' } : undefined,
    geo: b.lat != null ? { '@type': 'GeoCoordinates', latitude: b.lat, longitude: b.lng } : undefined,
    openingHoursSpecification: periods.length ? periods.map(p => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: DAY[p.openDay] || p.openDay, opens: hhmm(p.openTime), closes: hhmm(p.closeTime) })) : undefined,
    areaServed: b.service_area || b.city || undefined,
    makesOffer: (b.services || []).filter(s => s.name).map(s => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: s.name } }))
  };
}

function FieldRow({ ok, soft, label, hint, to }) {
  const path = useModulePath();
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      {ok ? <CheckCircle2 size={15} className="text-emerald-600 shrink-0 mt-px" /> : soft ? <CircleDashed size={15} className="text-slate-400 shrink-0 mt-px" /> : <XCircle size={15} className="text-red-500 shrink-0 mt-px" />}
      <span className="min-w-0 flex-1 text-[12.5px] text-slate-800">{label}{!ok && hint && <span className="block text-[11.5px] text-slate-500">{hint}{to && <> · <Link to={path(to)} className="font-medium text-indigo-700 hover:underline">add it</Link></>}</span>}</span>
    </li>
  );
}

function FaqEditor({ b, toast }) {
  const [faqs, setFaqs] = useState(() => (b.faqs || []).map(f => ({ q: f.q, a: f.a })));
  const [source, setSource] = useState(null);
  const [busy, error, run] = useAction();
  const saved = JSON.stringify((b.faqs || []).map(f => ({ q: f.q, a: f.a })));
  const dirty = JSON.stringify(faqs) !== saved;
  const valid = faqs.filter(f => f.q.trim() && f.a.trim());
  const draft = () => run('draft', async () => {
    const r = await api(`/businesses/${b.id}/ai/faqs`, { method: 'POST' });
    setSource(r.source);
    setFaqs(list => [...list, ...r.faqs.filter(f => !list.some(x => x.q.toLowerCase() === f.q.toLowerCase()))]);
    toast(r.faqs.length ? `${r.faqs.length} FAQs drafted${r.source === 'ai' ? ' by AI' : ' from the profile'}: check them, then save` : 'Add the address, hours or services to the profile first');
  });
  const save = () => run('save', async () => { await api(`/businesses/${b.id}`, { method: 'PATCH', body: { faqs: valid } }); await refreshBusinesses(); toast('FAQs saved to the profile'); });
  const set = (i, k, v) => setFaqs(list => list.map((f, n) => (n === i ? { ...f, [k]: v } : f)));
  const json = valid.length ? JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: valid.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }, null, 2) : null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ai" icon={Sparkles} busy={busy === 'draft'} onClick={draft}>Draft FAQs from the profile</Button>
        <Button icon={Plus} onClick={() => setFaqs(list => [...list, { q: '', a: '' }])}>Add question</Button>
        {source && <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ring-1 ring-inset ${source === 'ai' ? 'bg-violet-50 text-violet-700 ring-violet-200' : 'bg-slate-50 text-slate-500 ring-slate-200'}`}>{source === 'ai' ? 'AI' : 'from the profile'}</span>}
        <Button className="ml-auto" variant="primary" icon={Save} busy={busy === 'save'} disabled={!dirty} onClick={save}>Save to profile</Button>
      </div>
      <ErrorNote>{error}</ErrorNote>
      {faqs.length === 0 ? <div className="py-6 text-center text-[13px] text-slate-500">No FAQs yet. Draft them from the profile or add your own.</div> : (
        <ol className="space-y-2.5">
          {faqs.map((f, i) => (
            <li key={i} className="rounded-xl ring-1 ring-inset ring-slate-200 p-3 space-y-2">
              <div className="flex items-center gap-2"><span className="text-[11px] font-bold text-slate-400 w-5">Q{i + 1}</span><input className={inputCls} value={f.q} onChange={e => set(i, 'q', e.target.value)} placeholder="A question customers ask" aria-label={`Question ${i + 1}`} />
                <button type="button" onClick={() => setFaqs(list => list.filter((_, n) => n !== i))} className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 cursor-pointer" aria-label={`Remove question ${i + 1}`}><Trash2 size={14} /></button></div>
              <textarea rows={2} className={areaCls} value={f.a} onChange={e => set(i, 'a', e.target.value)} placeholder="The answer, 1-3 sentences" aria-label={`Answer ${i + 1}`} />
            </li>
          ))}
        </ol>
      )}
      {dirty && valid.length > 0 && <p className="text-[12px] text-amber-700 flex items-center gap-1.5"><Info size={13} /> Save to keep these FAQs on the profile (they also feed Google Q&A).</p>}
      {json && (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2"><span className="text-[12px] font-semibold text-slate-700">FAQ code ({valid.length} question{valid.length === 1 ? '' : 's'})</span>
            <div className="flex gap-2"><Button size="sm" icon={Download} onClick={() => download('faq-schema.html', script(json))}>Download</Button><CopyBtn text={script(json)} /></div></div>
          <Code text={script(json)} />
        </div>
      )}
    </div>
  );
}

export default function SchemaStudio({ b, report }) {
  const [toast, toastNode] = useToast();
  const [tab, setTab] = useState('business');
  const auto = (TYPES.find(([re]) => re.test(b.primary_category || '')) || [null, 'LocalBusiness'])[1];
  const [type, setType] = useState(auto);
  const data = useMemo(() => localBusiness(b, type), [b, type]);
  const json = JSON.stringify(data, null, 2);

  const pages = report?.result?.crawl?.pages || [];
  const found = {};
  pages.forEach(p => (p.schema_types || []).forEach(t => { (found[t] = found[t] || []).push(p.url); }));
  const bizTypes = Object.keys(found).filter(t => BUSINESS_TYPES.test(t));
  const onHome = bizTypes.some(t => found[t].some(u => pathOf(u) === '/'));
  const fields = [
    ['Name', b.name, 'gmb-profile'], ['Website', b.website, 'gmb-profile'], ['Phone', b.phone, 'gmb-profile'],
    ['Address with PIN code', /\b[1-9]\d{5}\b/.test(b.address || ''), 'gmb-profile'], ['Map pin', b.lat != null, 'onboarding'],
    ['Opening hours', (b.hours?.periods || []).length, 'gmb-profile'], ['Photo or logo', b.cover_photo || b.logo, 'media-management'],
    ['Description', b.description, 'gmb-profile'], ['Services', (b.services || []).some(s => s.name), 'gmb-profile']
  ];
  const have = fields.filter(f => f[1]).length;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
      <div className="xl:col-span-2 space-y-5 min-w-0">
        <Card>
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white flex items-center justify-center shadow-md shadow-indigo-500/20 shrink-0"><Braces size={18} /></span>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-slate-900">Structured data</div>
              <div className="text-[12px] text-slate-500">Code that tells Google exactly who the business is, where, when it's open and what it offers.</div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[[bizTypes.length > 0, 'Business markup on the site', report ? (bizTypes.length ? bizTypes.join(', ') : 'None found') : 'Run an audit to check'],
              [onHome, 'On the home page', report ? (onHome ? 'Found on /' : 'Add it to the home page') : '—'],
              [have === fields.length, 'Profile details for the code', `${have} of ${fields.length} available`]].map(([ok, l, d]) => (
              <div key={l} className={`rounded-xl ring-1 ring-inset px-3.5 py-3 ${ok ? 'bg-emerald-50/60 ring-emerald-200' : 'bg-amber-50/60 ring-amber-200'}`}>
                <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-900">{ok ? <CheckCircle2 size={14} className="text-emerald-600" /> : <XCircle size={14} className="text-amber-600" />} {l}</div>
                <div className="mt-0.5 text-[12px] text-slate-600 truncate" title={d}>{d}</div>
              </div>
            ))}
          </div>
        </Card>

        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'business', label: 'Business (LocalBusiness)' }, { id: 'faq', label: 'FAQ', count: (b.faqs || []).length }]} />

        {tab === 'business' && (
          <Card title="LocalBusiness code" subtitle="Built from the saved profile, so it always matches Google. Paste it once; regenerate after profile changes."
            action={<div className="flex gap-2"><Button size="sm" icon={Download} onClick={() => download('localbusiness-schema.html', script(json))}>Download</Button><CopyBtn text={script(json)} /></div>}>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <label className="text-[12px] font-semibold text-slate-700" htmlFor="schema-type">Type</label>
              <select id="schema-type" value={type} onChange={e => setType(e.target.value)} className="h-9 px-2.5 rounded-xl text-[12.5px] font-semibold text-slate-800 bg-white ring-1 ring-inset ring-slate-200 outline-none cursor-pointer">
                {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}{t === auto ? ' (suggested)' : ''}</option>)}
              </select>
              <span className="text-[11.5px] text-slate-500">{type === auto ? `The most specific type for “${b.primary_category || 'this business'}”.` : `Suggested: ${auto}`}</span>
            </div>
            <Code text={script(json)} />
            <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px]">
              <a href="https://search.google.com/test/rich-results" target="_blank" rel="noreferrer" className="font-semibold text-indigo-700 hover:underline inline-flex items-center gap-1">Test in Google's Rich Results Test <ExternalLink size={11} /></a>
              <a href="https://validator.schema.org/" target="_blank" rel="noreferrer" className="font-semibold text-slate-600 hover:underline inline-flex items-center gap-1">Schema validator <ExternalLink size={11} /></a>
              <span className="text-slate-400">Review stars aren't included: Google ignores ratings a business marks up about itself.</span>
            </div>
          </Card>
        )}
        {tab === 'faq' && <Card title="FAQ code" subtitle="Questions and answers for the website (FAQPage) and the Google profile's Q&A."><FaqEditor key={b.id} b={b} toast={toast} /></Card>}
      </div>

      <aside className="space-y-5 min-w-0 xl:sticky xl:top-24">
        <Card title="What the code includes" subtitle={`${have} of ${fields.length} profile details`}>
          <ul className="-my-1">{fields.map(([l, ok, to]) => <FieldRow key={l} ok={Boolean(ok)} label={l} hint="Missing from the profile" to={to} />)}</ul>
        </Card>
        <Card title="Found on the site" subtitle={report ? `${pages.length} pages from the latest audit` : 'No audit yet'}>
          {!report ? <div className="text-[12.5px] text-slate-500">Run an audit to see which structured data the site already has.</div>
            : Object.keys(found).length ? (
              <ul className="space-y-2">{Object.entries(found).map(([t, urls]) => <li key={t} className="text-[12px]"><span className="font-mono font-semibold text-slate-900 bg-slate-50 ring-1 ring-inset ring-slate-200 rounded px-1.5 py-0.5">{t}</span> <span className="text-slate-500">on {urls.slice(0, 3).map(pathOf).join(', ')}{urls.length > 3 ? ` +${urls.length - 3}` : ''}</span></li>)}</ul>
            ) : <div className="text-[12.5px] text-amber-700">No structured data on any crawled page yet.</div>}
        </Card>
        <Card title="How to add it">
          <ol className="space-y-2 text-[12.5px] text-slate-700 list-decimal ml-4">
            <li>Copy the code.</li>
            <li>Paste it inside <code className="font-mono text-[11.5px] bg-slate-100 px-1 rounded">&lt;head&gt;</code> on the home and contact pages (WordPress: a header-scripts or schema plugin).</li>
            <li>Check it in the Rich Results Test, then re-run the website audit.</li>
          </ol>
          <div className="mt-2 text-[11.5px] text-slate-500 flex items-center gap-1.5"><FileCode size={12} /> The FAQ code goes on the page that shows those FAQs.</div>
        </Card>
      </aside>
      {toastNode}
    </div>
  );
}
