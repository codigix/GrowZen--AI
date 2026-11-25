import React from 'react';
import { ArrowLeft, ArrowRight, Check, Loader2, MapPin, Plus, Search, Users } from 'lucide-react';
import { Button, ErrorNote } from './SeoUi';
import Select from '../components/Select';
import { useCompetitorGap } from './CompetitorKeywordTabs';

export const STEPS = [
  { id: 'find', n: 1, label: 'Find', what: 'Look up the businesses around your place' },
  { id: 'shortlist', n: 2, label: 'Shortlist', what: 'Choose the ones that really compete with you' },
  { id: 'analyze', n: 3, label: 'Analyze', what: 'Read their authority, keywords and traffic' },
  { id: 'opportunities', n: 4, label: 'Opportunities', what: 'Keywords to win, and how you compare' },
];

const COUNTRIES = { IN: 'India', US: 'United States', GB: 'United Kingdom', CA: 'Canada', AU: 'Australia', AE: 'United Arab Emirates', DE: 'Germany', FR: 'France', SG: 'Singapore' };
const LANGS = { en: 'English', hi: 'Hindi', mr: 'Marathi', gu: 'Gujarati', ta: 'Tamil', te: 'Telugu', bn: 'Bengali', es: 'Spanish', fr: 'French', de: 'German', ar: 'Arabic' };
const input = 'mt-1 h-10 w-full rounded-lg ring-1 ring-inset ring-slate-300 px-3 text-13 focus:ring-2 focus:ring-indigo-500 outline-none bg-white';

/** Step 1. One question (where?), one button (Find competitors), one alternative (add one you know). Everything else is tucked under "More options". */
export function FindStep({ b, placeNode, radiusKm, setRadiusKm, opts, setOpts, onFind, finding, findNote, onAdd, adding, addError, mapsError, found, chosen, onNext, placesReady, deep }) {
  const [url, setUrl] = React.useState('');
  const [name, setName] = React.useState('');
  const submit = async (e) => { e.preventDefault(); if (await onAdd(url.trim(), name.trim())) { setUrl(''); setName(''); } };
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white ring-1 ring-slate-200 p-5 sm:p-6">
        <h2 className="text-18 font-bold text-slate-900">Where are your customers?</h2>
        <p className="mt-1 text-13 text-slate-600">We look up the businesses Google Maps shows around this place. You choose which of them really compete with you in the next step.</p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-[260px]"><div className="text-12.5 font-medium text-slate-600">Place</div><div className="mt-1">{placeNode}</div></div>
          <label className="block text-12.5 font-medium text-slate-600">Within
            <Select value={radiusKm} onChange={e => setRadiusKm(e.target.value)} aria-label="Distance around the place" className="mt-1 h-10 w-28 rounded-lg ring-1 ring-inset ring-slate-300 bg-white px-2.5 text-13 text-left">{['2', '5', '10', '20', '30'].map(k => <option key={k} value={k}>{k} km</option>)}</Select>
          </label>
          <Button variant="primary" icon={Search} busy={finding} onClick={onFind} disabled={!placesReady} className="h-10 px-5">Find competitors</Button>
        </div>
        {!placesReady && <p className="mt-3 text-12.5 text-amber-800 bg-amber-50 ring-1 ring-amber-200 rounded-lg px-3 py-2">Google Maps lookup is not connected: add <code>GOOGLE_PLACES_API_KEY</code> to the backend settings and restart it. You can still add competitors by their website below.</p>}
        {findNote && <p role="status" className="mt-3 text-13 text-emerald-800">{findNote}</p>}
        <ErrorNote>{mapsError}</ErrorNote>

        <details className="mt-4 group">
          <summary className="cursor-pointer text-13 font-semibold text-slate-700 select-none">More options <span className="font-normal text-slate-500">business type, services, country, language</span></summary>
          <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
            <label className="block text-12.5 text-slate-600">What kind of business<input value={opts.category} onChange={e => setOpts({ category: e.target.value })} placeholder={b.primaryCategory || 'e.g. clothing rental'} className={input} /><span className="text-11.5 text-slate-400">Empty = your project's category.</span></label>
            <label className="block text-12.5 text-slate-600">Services to search too (up to 3)<input value={opts.services} onChange={e => setOpts({ services: e.target.value })} placeholder="e.g. saree rental, lehenga rental" className={input} /><span className="text-11.5 text-slate-400">Separate with commas. One extra Google request each.</span></label>
            <label className="block text-12.5 text-slate-600">Country
              <Select value={opts.country} onChange={e => setOpts({ country: e.target.value })} aria-label="Country" className={`${input} text-left bg-white`}><option value="">Project's country</option>{Object.entries(COUNTRIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></label>
            <label className="block text-12.5 text-slate-600">Language of the results
              <Select value={opts.language} onChange={e => setOpts({ language: e.target.value })} aria-label="Language" className={`${input} text-left bg-white`}>{Object.entries(LANGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></label>
          </div>
        </details>
      </div>

      <form onSubmit={submit} className="rounded-xl bg-white ring-1 ring-slate-200 p-5 sm:p-6">
        <h3 className="text-15 font-semibold text-slate-900">Know a competitor already?</h3>
        <p className="mt-0.5 text-12.5 text-slate-500">Add it by its website. It is added to your shortlist right away.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="competitor.com" aria-label="Competitor website" className="h-10 flex-1 min-w-[220px] rounded-lg ring-1 ring-inset ring-slate-300 px-3 text-13 focus:ring-2 focus:ring-indigo-500 outline-none" />
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name (optional)" aria-label="Competitor name" className="h-10 w-48 rounded-lg ring-1 ring-inset ring-slate-300 px-3 text-13 focus:ring-2 focus:ring-indigo-500 outline-none" />
          <Button type="submit" icon={Plus} busy={adding} disabled={url.trim().length < 3}>Add</Button>
        </div>
        <ErrorNote>{addError}</ErrorNote>
      </form>

      {deep}

      {found > 0 && (
        <div className="rounded-xl bg-indigo-50 ring-1 ring-indigo-200 px-5 py-4 flex flex-wrap items-center gap-3">
          <div className="text-14 text-indigo-950"><b>{found}</b> competitor{found === 1 ? '' : 's'} found{chosen ? <>, <b>{chosen}</b> chosen</> : ''}. Next, choose the ones that really compete with you.</div>
          <Button variant="primary" className="ml-auto" onClick={onNext}>Choose competitors<ArrowRight size={15} className="ml-1.5 inline" /></Button>
        </div>
      )}
    </div>
  );
}

export function Heading2({ title, text }) {
  return <div><h2 className="text-18 font-bold text-slate-900">{title}</h2>{text && <p className="mt-0.5 text-13 text-slate-600 max-w-3xl">{text}</p>}</div>;
}

export function Searching({ text }) {
  return <div className="rounded-xl bg-white ring-1 ring-slate-200 px-5 py-4 flex items-center gap-3 text-13 text-slate-700"><Loader2 size={16} className="animate-spin text-indigo-600" />{text}</div>;
}

export { MapPin };

/** The page you land on: four big cards, one per job. Each says where that job stands and has one button. There is nothing to click across the top. */
export function HomeCards({ b, found, chosen, analyzed, avgDa, onOpen, onPanel }) {
  const gap = useCompetitorGap(b);
  const missing = gap.data?.counts?.missing;
  const next = !found ? 'find' : !chosen ? 'shortlist' : analyzed < found ? 'analyze' : 'opportunities'; // the one card to highlight: what to do next
  const cards = [
    { id: 'find', n: 1, title: 'Find competitors', text: 'Look up the businesses Google Maps shows around your place, or add one by its website.',
      stat: found ? `${found} found` : 'Not started', done: found > 0, button: found ? 'Find more' : 'Find competitors', primary: next === 'find' },
    { id: 'shortlist', n: 2, title: 'Choose competitors', text: 'Pick the ones a customer would choose instead of you. Around 3 to 8 works best.',
      stat: found ? `${chosen} chosen of ${found}` : 'Find competitors first', done: chosen > 0, button: 'Choose competitors', disabled: !found, primary: next === 'shortlist' },
    { id: 'analyze', n: 3, title: 'Analyze', text: 'Their authority, keywords and estimated visitors in one table, with every column and filter.',
      stat: found ? `${analyzed} of ${found} analyzed${avgDa != null ? ` · average authority ${avgDa}` : ''}` : 'Find competitors first', done: found > 0 && analyzed >= found, button: 'Open the table', disabled: !found, primary: next === 'analyze' },
    { id: 'opportunities', n: 4, title: 'Opportunities', text: 'Keywords to win, their best pages, traffic and backlinks compared, the map, and new keyword ideas.',
      stat: missing != null && analyzed ? `${missing.toLocaleString('en-US')} keywords to win` : analyzed ? 'Ready' : 'Analyze competitors first', done: false, button: 'See opportunities', disabled: !analyzed, primary: next === 'opportunities' },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-14 text-slate-700 max-w-2xl">Work through the four jobs in order, or open any of them. Your choices are kept, so you can come back at any time.</p>
        <Button size="sm" icon={Users} className="ml-auto" onClick={onPanel} title="Add, choose and remove competitors">My competitors</Button>
      </div>
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 440px), 1fr))' }}>
        {cards.map(c => (
          <div key={c.id} className={`rounded-2xl bg-white p-5 flex flex-col ring-1 ${c.primary ? 'ring-2 ring-indigo-400' : 'ring-slate-200'} ${c.disabled ? 'opacity-70' : ''}`}>
            <div className="flex items-center gap-3">
              <span className={`w-9 h-9 rounded-full inline-flex items-center justify-center text-14 font-bold ${c.done ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-50 text-indigo-700'}`}>{c.done ? <Check size={17} strokeWidth={3} /> : c.n}</span>
              <h3 className="text-16 font-semibold text-slate-900">{c.title}</h3>
            </div>
            <p className="mt-3 text-13 text-slate-600 flex-1">{c.text}</p>
            <div className="mt-4 text-13.5 font-semibold text-slate-900">{c.stat}</div>
            <Button variant={c.primary ? 'primary' : 'secondary'} className="mt-3 self-start" disabled={c.disabled} onClick={() => onOpen(c.id)}>{c.button}<ArrowRight size={15} className="ml-1.5 inline" /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** On every page except the home: one Back button, and the name of where you are. */
export function PageBar({ label, onHome, onPanel }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button icon={ArrowLeft} onClick={onHome}>Back to Competitors</Button>
      <span className="text-13 text-slate-500">{label}</span>
      <Button size="sm" icon={Users} className="ml-auto" onClick={onPanel} title="Add, choose and remove competitors">My competitors</Button>
    </div>
  );
}
