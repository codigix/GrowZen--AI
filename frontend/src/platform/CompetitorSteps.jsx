import React from 'react';
import { ArrowRight, Check, Loader2, MapPin, Plus, Search } from 'lucide-react';
import { Button, ErrorNote } from './SeoUi';
import Select from '../components/Select';

export const STEPS = [
  { id: 'find', n: 1, label: 'Find', what: 'Look up the businesses around your place' },
  { id: 'shortlist', n: 2, label: 'Shortlist', what: 'Choose the ones that really compete with you' },
  { id: 'analyze', n: 3, label: 'Analyze', what: 'Read their authority, keywords and traffic' },
  { id: 'opportunities', n: 4, label: 'Opportunities', what: 'Keywords to win, and how you compare' },
];

/** The four steps across the top of the page. Each says where you are and what is done, and can be pressed to go there. `notes` is { stepId: 'short status' }. */
export function Stepper({ step, onStep, notes = {}, done = {} }) {
  const at = STEPS.findIndex(s => s.id === step);
  return (
    <nav aria-label="Competitor steps" className="rounded-xl bg-white ring-1 ring-slate-200 px-2 py-2">
      <ol className="grid gap-1" style={{ gridTemplateColumns: `repeat(${STEPS.length}, minmax(0, 1fr))` }}>
        {STEPS.map((s, i) => {
          const on = s.id === step;
          const ok = done[s.id] && !on;
          return (
            <li key={s.id}>
              <button type="button" onClick={() => onStep(s.id)} aria-current={on ? 'step' : undefined} title={s.what}
                className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left cursor-pointer transition-colors ${on ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'hover:bg-slate-50'}`}>
                <span className={`w-8 h-8 shrink-0 rounded-full inline-flex items-center justify-center text-13 font-bold ${on ? 'bg-indigo-600 text-white' : ok ? 'bg-emerald-100 text-emerald-700' : i < at ? 'bg-slate-200 text-slate-600' : 'bg-slate-100 text-slate-500'}`}>{ok ? <Check size={16} strokeWidth={3} /> : s.n}</span>
                <span className="min-w-0">
                  <span className={`block text-13.5 font-semibold ${on ? 'text-indigo-800' : 'text-slate-900'}`}>{s.label}</span>
                  <span className="block text-12 text-slate-500 truncate">{notes[s.id] || s.what}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

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

export function Searching({ text }) {
  return <div className="rounded-xl bg-white ring-1 ring-slate-200 px-5 py-4 flex items-center gap-3 text-13 text-slate-700"><Loader2 size={16} className="animate-spin text-indigo-600" />{text}</div>;
}

export { MapPin };
