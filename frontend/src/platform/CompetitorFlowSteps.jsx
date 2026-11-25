import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BarChart3, Check, ExternalLink, Loader2, MapPin, Search, Trash2 } from 'lucide-react';
import { Badge, Button, ErrorNote, Modal, useToast } from './SeoUi';
import DataTable from './DataTable';
import MultiSelect from '../components/MultiSelect';
import { api } from './seoApi';
import { BacklinkTab, TopPagesTab, TrafficTab } from './CompetitorAnalysis';
import { CompetitorKeywordsTab, KeywordGapTab, useCompetitorGap } from './CompetitorKeywordTabs';
import CompetitorMaps from './CompetitorMaps';
import ResearchTab from './CompetitorResearch';

const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const kfmt = (n) => (n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : num(n));
const km = (m) => (m == null ? '' : m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);
const NA = <span className="text-slate-300">Not available</span>;
const when = (t) => (t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const daTone = (v) => (v == null ? 'bg-slate-100 text-slate-400' : v >= 60 ? 'bg-emerald-100 text-emerald-800' : v >= 30 ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800');
const STATUS = { analyzed: ['Analyzed', 'green'], partial: ['Partly read', 'amber'], pending: ['Not analyzed', 'gray'], queued: ['Waiting', 'gray'], running: ['Analyzing…', 'blue'], failed: ['Failed', 'red'], retry: ['Try again later', 'amber'] };
const place = (c) => (c.maps?.address || c.reg?.address || '').split(',').slice(-3, -1).map(x => x.trim()).filter(Boolean).join(', ') || (c.maps?.address || c.reg?.address || '').split(',')[0];
const choiceOf = (c) => ({ ...(c.reg || {}), id: c.reg?.id, name: c.name, website: c.website, maps: c.maps });

function Heading({ title, text, right }) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-0"><h2 className="text-18 font-bold text-slate-900">{title}</h2>{text && <p className="mt-0.5 text-13 text-slate-600 max-w-3xl">{text}</p>}</div>
      {right && <div className="ml-auto flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

const Back = ({ onClick, children }) => <Button onClick={onClick} icon={ArrowLeft}>{children}</Button>;

// ----------------------------------------------------------------------------------------------------------------------------- step 2: shortlist
/** A plain list. One button per competitor: Choose / Chosen. No table, no filters. */
export function ShortlistStep({ rows, isChosen, onChoose, onRemove, onNext, onFind }) {
  const [q, setQ] = useState('');
  const [more, setMore] = useState(false);
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState('');
  const sorted = useMemo(() => [...rows].sort((a, b) => Number(isChosen(b)) - Number(isChosen(a)) || (b.maps?.relevance?.score ?? -1) - (a.maps?.relevance?.score ?? -1)), [rows, isChosen]);
  const needle = q.trim().toLowerCase();
  const found = sorted.filter(c => !needle || `${c.name} ${c.host}`.toLowerCase().includes(needle));
  const shown = more || needle ? found : found.slice(0, 12);
  const chosen = rows.filter(isChosen).length;
  const likely = rows.filter(c => !isChosen(c) && c.maps?.relevance?.label === 'direct');
  const toggle = async (c) => { setBusy(c.key); try { await onChoose(choiceOf(c), !isChosen(c)); } finally { setBusy(''); } };
  const chooseLikely = async () => { setBusy('likely'); try { for (const c of likely) await onChoose(choiceOf(c), true); } finally { setBusy(''); } };
  return (
    <div className="space-y-4">
      <Heading title="Choose the competitors that really compete with you" text="Pick the businesses a customer would choose instead of you. Only the chosen ones are analyzed and compared. Around 3 to 8 works best."
        right={<>{likely.length > 0 && <Button busy={busy === 'likely'} onClick={chooseLikely} title="Choose every business that looks like a direct competitor">Choose the {likely.length} likely direct competitor{likely.length === 1 ? '' : 's'}</Button>}</>} />
      {!rows.length ? (
        <div className="rounded-xl bg-white ring-1 ring-slate-200 p-8 text-center"><p className="text-14 text-slate-700">No competitors yet.</p><Button variant="primary" className="mt-3" onClick={onFind}>Find competitors</Button></div>
      ) : (
        <div className="rounded-xl bg-white ring-1 ring-slate-200">
          <div className="p-3 border-b border-slate-100 relative max-w-sm">
            <Search size={14} className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or website" aria-label="Search competitors" className="h-9 w-full rounded-lg ring-1 ring-inset ring-slate-200 pl-8 pr-3 text-13 outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <ul className="divide-y divide-slate-100">
            {shown.map(c => {
              const on = isChosen(c);
              const rel = c.maps?.relevance;
              return (
                <li key={c.key} className={`px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 ${on ? 'bg-emerald-50/40' : ''}`}>
                  <button type="button" onClick={() => toggle(c)} disabled={busy === c.key} aria-pressed={on} className={`h-9 min-w-[104px] px-3 rounded-lg text-13 font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer ring-1 ring-inset ${on ? 'bg-emerald-600 text-white ring-emerald-600' : 'bg-white text-slate-800 ring-slate-300 hover:bg-slate-50'}`}>
                    {busy === c.key ? <Loader2 size={14} className="animate-spin" /> : on ? <Check size={14} strokeWidth={3} /> : null}{on ? 'Chosen' : 'Choose'}
                  </button>
                  <div className="min-w-0 flex-1 basis-[240px]">
                    <div className="text-14 font-semibold text-slate-900 truncate">{c.name}</div>
                    <div className="text-12.5 text-slate-500 flex flex-wrap items-center gap-x-2">
                      {c.host ? <a href={`https://${c.host}`} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline inline-flex items-center gap-1">{c.host}<ExternalLink size={10} /></a> : <span>no website</span>}
                      {(place(c) || c.maps?.distance_m != null) && <span className="inline-flex items-center gap-1"><MapPin size={11} />{[place(c), km(c.maps?.distance_m)].filter(Boolean).join(' · ')}</span>}
                    </div>
                  </div>
                  {rel && <span title={rel.reason || ''}><Badge tone={rel.label === 'direct' ? 'green' : rel.label === 'related' ? 'amber' : 'gray'}>{rel.label === 'direct' ? 'Looks like a direct competitor' : rel.label === 'related' ? 'Partly overlaps' : 'Probably not a competitor'}</Badge></span>}
                  {c.reg && <button type="button" onClick={() => setDel(c)} aria-label={`Remove ${c.name}`} title="Remove from my list" className="p-2 text-slate-400 hover:text-rose-600 cursor-pointer"><Trash2 size={16} /></button>}
                </li>
              );
            })}
            {!shown.length && <li className="px-4 py-8 text-center text-13 text-slate-500">No competitor matches “{q}”.</li>}
          </ul>
          {!more && !needle && found.length > shown.length && <div className="p-3 border-t border-slate-100"><Button onClick={() => setMore(true)}>Show the other {found.length - shown.length}</Button></div>}
        </div>
      )}
      <div className="sticky bottom-3 z-10"><div className="rounded-xl bg-white shadow-lg ring-1 ring-slate-200 px-4 py-3 flex flex-wrap items-center gap-3">
        <span className="text-14 text-slate-800"><b>{chosen}</b> chosen</span>
        {chosen === 0 && rows.length > 0 && <span className="text-12.5 text-slate-500">Choose at least one to continue.</span>}
        <Button variant="primary" className="ml-auto" disabled={!chosen} onClick={onNext}>Analyze the chosen<ArrowRight size={15} className="ml-1.5 inline" /></Button>
      </div></div>
      <Modal open={!!del} onClose={() => setDel(null)} title="Remove this competitor?" width="max-w-md" footer={<><Button onClick={() => setDel(null)}>Cancel</Button><Button variant="danger" onClick={async () => { const c = del; setDel(null); await onRemove(c.reg); }}>Remove</Button></>}>
        <p className="text-13 text-slate-600">{del?.name} is taken off your list with its saved keywords. A business that is only found on Google Maps is not saved and stays as it is.</p>
      </Modal>
    </div>
  );
}

// ----------------------------------------------------------------------------------------------------------------------------- step 4: opportunities
const VIEWS = [
  { id: 'keywords', title: 'Keywords to win', text: 'The keyword gap: what they rank for and you do not, with a score for each' },
  { id: 'allkeywords', title: 'All competitor keywords', text: 'Every keyword each competitor ranks for, with positions and pages' },
  { id: 'pages', title: 'Their best pages', text: 'The pages that bring them the most visitors' },
  { id: 'traffic', title: 'Traffic compared', text: 'Estimated visitors, and how they change over time' },
  { id: 'backlinks', title: 'Backlinks compared', text: 'Authority and referring sites of each competitor' },
  { id: 'maps', title: 'On Google Maps', text: 'Who shows around you, and your local rankings' },
  { id: 'find', title: 'Find new keywords', text: 'Ideas from Google, and keywords by area' },
];

export function OpportunitiesStep({ b, rows, isChosen, analysis, view, setView, onAnalyze }) {
  const gap = useCompetitorGap(b);
  const [fsec, setFsec] = useState('discovery');
  const missing = gap.data?.counts?.missing;
  const stat = (id) => (id === 'keywords' && missing != null ? `${num(missing)} found` : '');
  const chosenOnly = rows.filter(isChosen);
  const chosenRows = chosenOnly.length ? chosenOnly : rows; // the comparisons are about the competitors you chose
  if (!view) {
    return (
      <div className="space-y-4">
        <Heading title="What would you like to do with what we found?" text="Start with Keywords to win: it lists the searches your competitors already get customers from." right={<Button onClick={onAnalyze}>Back to analysis</Button>} />
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {VIEWS.map((v, i) => (
            <button key={v.id} type="button" onClick={() => setView(v.id)} className={`text-left rounded-xl bg-white ring-1 px-5 py-4 cursor-pointer hover:bg-slate-50 hover:ring-indigo-300 transition-colors ${i === 0 ? 'ring-2 ring-indigo-400' : 'ring-slate-200'}`}>
              <div className="flex items-center gap-2"><span className="text-15 font-semibold text-slate-900">{v.title}</span>{stat(v.id) && <Badge tone="green">{stat(v.id)}</Badge>}<ArrowRight size={16} className="ml-auto text-slate-400" /></div>
              <p className="mt-1 text-13 text-slate-600">{v.text}</p>
            </button>
          ))}
        </div>
      </div>
    );
  }
  const cur = VIEWS.find(v => v.id === view);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3"><Back onClick={() => setView('')}>All opportunities</Back><h2 className="text-18 font-bold text-slate-900">{cur?.title}</h2></div>
      {view === 'keywords' && <KeywordGapTab b={b} />}
      {view === 'allkeywords' && <CompetitorKeywordsTab b={b} />}
      {view === 'pages' && <TopPagesTab b={b} rows={chosenRows} />}
      {view === 'traffic' && <TrafficTab b={b} rows={chosenRows} analysis={analysis} />}
      {view === 'backlinks' && <BacklinkTab rows={chosenRows} analysis={analysis} />}
      {view === 'maps' && <CompetitorMaps b={b} rows={rows} />}
      {view === 'find' && <>
        <div className="flex flex-wrap gap-2">{[['discovery', 'Ideas from Google'], ['location', 'Keywords by area']].map(([k, l]) => <button key={k} type="button" aria-pressed={fsec === k} onClick={() => setFsec(k)} className={`h-9 px-4 rounded-lg text-13 font-semibold cursor-pointer ring-1 ring-inset ${fsec === k ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}>{l}</button>)}</div>
        <ResearchTab key={fsec} b={b} section={fsec} hideNav />
      </>}
    </div>
  );
}
