import React, { useEffect, useState } from 'react';
import { ArrowRight, Plus, Check } from 'lucide-react';
import { Button, ErrorNote, useAction } from './SeoUi';
import { api } from './seoApi';
import Wizard, { Row, fieldCls, boxCls } from './Wizard';
import Select from '../components/Select';

const ENGINES = [['google', 'Google'], ['chatgpt', 'ChatGPT'], ['gemini', 'Gemini']];
const DEVICES = [['desktop', 'Desktop'], ['mobile', 'Mobile'], ['tablet', 'Tablet']];
const LANGS = [['en', 'English'], ['hi', 'Hindi'], ['mr', 'Marathi'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['ar', 'Arabic']];
const seg = (on) => `h-10 px-4 text-14 border-r last:border-r-0 border-slate-300 cursor-pointer ${on ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'bg-white text-slate-700 hover:bg-slate-50'}`;
const lines = (t) => [...new Set(t.split('\n').map(x => x.trim().toLowerCase()).filter(Boolean))];

/**
 * "New Position Tracking campaign": first which project, and where its positions are checked (search engine, device, location, language, the business name for
 * the Maps pack); then the keywords, with suggestions. Saved on the project; positions are read from Google, and ChatGPT / Gemini are tracked as AI prompts.
 */
export default function NewTrackingModal({ open, onClose, projects, initialId, onDone }) {
  const [step, setStep] = useState('targeting');
  const [id, setId] = useState(initialId || '');
  const [info, setInfo] = useState(null);
  const [cfg, setCfg] = useState({ engines: ['google'], device: 'desktop', location: '', language: 'en', map_name: '' });
  const [text, setText] = useState('');
  const [check, setCheck] = useState(true);
  const [busy, error, run] = useAction();
  const [result, setResult] = useState(null);

  useEffect(() => { if (open) { setStep('targeting'); setResult(null); setText(''); setId(initialId || projects?.[0]?.id || ''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open || !id) { setInfo(null); return; }
    api(`/businesses/${id}/seo/track-config`).then(d => {
      setInfo(d);
      setCfg({ engines: d.engines || ['google'], device: d.device || 'desktop', location: d.location || '', language: d.language || 'en', map_name: d.map_name || d.name || '' });
    }).catch(() => setInfo(null));
  }, [open, id]);

  const set = (k, v) => setCfg(c => ({ ...c, [k]: v }));
  const toggleEngine = (e) => setCfg(c => { const has = c.engines.includes(e); const next = has ? c.engines.filter(x => x !== e) : [...c.engines, e]; return { ...c, engines: next.length ? next : c.engines }; });
  const words = lines(text);
  const addWord = (w) => setText(t => (lines(t).includes(w) ? t : `${t.trim()}${t.trim() ? '\n' : ''}${w}`));
  const project = projects?.find(p => String(p.id) === String(id));
  const steps = [
    { id: 'targeting', label: 'Targeting', hint: `${cfg.location || '—'} (${cfg.engines.map(e => ENGINES.find(x => x[0] === e)?.[1]).join(', ')})` },
    { id: 'keywords', label: 'Keywords', hint: `Added: ${words.length}` }
  ];
  const start = () => run('start', async () => {
    const r = await api(`/businesses/${id}/seo/track-campaign`, { method: 'PUT', body: { ...cfg, location: cfg.location || null, map_name: cfg.map_name || null, keywords: words, check_now: check && words.length > 0 }, repeat: true });
    setResult(r);
    if (!r.note) onDone(Number(id));
  });

  return (
    <Wizard open={open} onClose={onClose} title="New Position Tracking Campaign" steps={steps} step={step} onStep={setStep} done={step === 'keywords' ? ['targeting'] : []}
      heading={step === 'targeting' ? 'Targeting' : 'Keywords'}
      footer={result?.note ? <Button variant="primary" onClick={() => onDone(Number(id))}>Open the project</Button>
        : step === 'targeting'
          ? <button type="button" onClick={() => setStep('keywords')} disabled={!id} className="inline-flex items-center gap-2 text-16 font-semibold text-blue-600 hover:text-blue-800 disabled:opacity-40 cursor-pointer">Continue To Keywords <ArrowRight size={18} /></button>
          : <div className="flex items-center gap-3"><Button onClick={() => setStep('targeting')}>Back</Button><button type="button" onClick={start} disabled={busy || !id} className="h-12 px-8 rounded-lg text-16 font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 cursor-pointer">{busy ? 'Saving…' : words.length ? 'Start tracking' : 'Save targeting'}</button></div>}>
      {result?.note ? (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-5 py-4 text-15 text-emerald-900"><div className="flex items-center gap-2 font-semibold"><Check size={18} />Saved. {result.keywords_added} keyword{result.keywords_added !== 1 ? 's' : ''} added{result.checked ? `, ${result.checked.keywords} checked` : ''}.</div><p className="mt-2 text-14 text-emerald-800">{result.note}</p></div>
      ) : step === 'targeting' ? (
        <div>
          <Row label="Project">
            <Select className={`${fieldCls} w-full max-w-md`} value={id} onChange={e => setId(e.target.value)} aria-label="Project">{(projects || []).map(p => <option key={p.id} value={p.id}>{p.name}{p.domain ? ` · ${p.domain}` : ''}</option>)}</Select>
            {project && <p className="text-14 text-slate-500 mt-2">Tracked as <b>{project.domain || 'no website yet'}</b> (root domain).</p>}
          </Row>
          <Row label="Search engine" hint={info && !info.ai_engines?.length ? 'ChatGPT and Gemini need their API keys on the server to answer prompts.' : 'Google is read as positions; ChatGPT and Gemini are tracked as prompts in AI Search Visibility.'}>
            <div className="inline-flex rounded border border-slate-300 overflow-hidden">{ENGINES.map(([e, l]) => {
              const off = e !== 'google' && info && !info.ai_engines?.includes(l);
              return <button key={e} type="button" disabled={off} title={off ? `${l} is not connected on the server` : undefined} onClick={() => toggleEngine(e)} className={`${seg(cfg.engines.includes(e))} ${off ? 'opacity-40 cursor-not-allowed' : ''}`}>{l}</button>;
            })}</div>
          </Row>
          <Row label="Device" hint={cfg.device !== 'desktop' ? 'Positions are read for desktop for now; this choice is saved for when other devices are available.' : null}>
            <div className="inline-flex rounded border border-slate-300 overflow-hidden">{DEVICES.map(([d, l]) => <button key={d} type="button" onClick={() => set('device', d)} className={seg(cfg.device === d)}>{l}</button>)}</div>
          </Row>
          <Row label="Location" hint="A city or country: Google's results are read as if searched from there."><input className={`${fieldCls} w-full max-w-md`} value={cfg.location} onChange={e => set('location', e.target.value)} placeholder="e.g. Pune, India" aria-label="Location" /></Row>
          <Row label="Language"><Select className={`${fieldCls} w-48`} value={cfg.language} onChange={e => set('language', e.target.value)} aria-label="Language">{LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Row>
          <Row label="Business name for local map pack" hint="Optional. The full name as it appears on Google Maps, to follow the business in the Maps pack."><input className={`${fieldCls} w-full max-w-md`} value={cfg.map_name} onChange={e => set('map_name', e.target.value)} placeholder="Enter full business name" aria-label="Business name" /></Row>
        </div>
      ) : (
        <div>
          {info?.suggestions?.length > 0 && (
            <div className="mb-5">
              <div className="text-15 font-semibold text-slate-900 mb-2">Suggested for {project?.name}</div>
              <div className="flex flex-wrap gap-2">{info.suggestions.map(s => <button key={s} type="button" onClick={() => addWord(s)} disabled={words.includes(s)} className="px-3 py-1.5 rounded-full border border-slate-300 text-13 text-slate-700 hover:bg-indigo-50 hover:border-indigo-300 disabled:opacity-40 inline-flex items-center gap-1 cursor-pointer">{words.includes(s) ? <Check size={12} /> : <Plus size={12} />}{s}</button>)}</div>
            </div>
          )}
          <div className="text-15 font-semibold text-slate-900 mb-2">Keywords to track <span className="font-normal text-slate-500">({words.length}): one per line</span></div>
          <textarea className={boxCls} rows={8} value={text} onChange={e => setText(e.target.value)} placeholder={'dental clinic pune\nbest dentist near me'} aria-label="Keywords" />
          {info?.tracked?.length > 0 && <p className="text-13 text-slate-500 mt-2">Already tracked: {info.tracked.slice(0, 8).join(', ')}{info.tracked.length > 8 ? '…' : ''}</p>}
          <label className={`mt-4 flex items-center gap-2.5 text-15 ${info?.rank_ready ? 'text-slate-800 cursor-pointer' : 'text-slate-400'}`}><input type="checkbox" disabled={!info?.rank_ready} checked={check && !!info?.rank_ready} onChange={e => setCheck(e.target.checked)} />Check positions now{info?.rank_ready ? ` (reads Google Search Console)` : ' (link the Google account that owns the site, in Integrations, to read positions)'}</label>
        </div>
      )}
      <ErrorNote>{error}</ErrorNote>
    </Wizard>
  );
}
