import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BarChart3, Check, ExternalLink, Loader2, MapPin, Search, Trash2 } from 'lucide-react';
import { Badge, Button, ErrorNote, Modal, useToast } from './SeoUi';
import DataTable from './DataTable';
import MultiSelect from '../components/MultiSelect';
import { api } from './seoApi';
import { AutoBar, BacklinkTab, TopPagesTab, TrafficTab } from './CompetitorAnalysis';
import { useCompetitorGap } from './CompetitorKeywordTabs';
import CompetitorMaps from './CompetitorMaps';
import ResearchTab, { saveToMy } from './CompetitorResearch';

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

// ----------------------------------------------------------------------------------------------------------------------------- step 3: analyze
/** The chosen competitors, with the four numbers that matter. One button per row. Everything else is in the details window. */
export function AnalyzeStep({ b, rows, isChosen, metrics, auto, reload, onShortlist, onNext, onProfile, onKind }) {
  const [toast, toastNode] = useToast();
  const [running, setRunning] = useState({});
  const [open, setOpen] = useState(null);
  const chosen = rows.filter(isChosen);
  const queue = auto?.prog?.queue || [];
  const statusOf = (c) => running[c.host] || (auto?.prog?.running && auto.prog.current === c.host ? 'running' : auto?.prog?.running && queue.includes(c.host) ? 'queued' : metrics[c.host]?.status || 'pending');
  const analyze = async (list, force) => {
    const todo = list.filter(c => c.host && running[c.host] !== 'running');
    if (!todo.length) { toast('Nothing to analyze: these have no website.'); return; }
    let ok = 0;
    for (const c of todo) {
      setRunning(r => ({ ...r, [c.host]: 'running' }));
      try {
        const r = await api(`/businesses/${b.id}/keyword-workspace/competitor-analysis/analyze`, { method: 'POST', body: { domain: c.host, limit: 100, force }, timeout: 240000 });
        setRunning(x => { const n = { ...x }; delete n[c.host]; return n; });
        await reload();
        if (r.cached || r.notes?.length) toast(`${c.name}: ${r.notes[0]}`); else ok += 1;
      } catch (e) { setRunning(x => { const n = { ...x }; delete n[c.host]; return n; }); toast(`${c.name}: ${e.message}`); }
    }
    if (ok) toast(`${ok} competitor${ok === 1 ? '' : 's'} analyzed`);
  };
  const waiting = chosen.filter(c => c.host && !['analyzed', 'running', 'queued'].includes(statusOf(c)));
  const done = chosen.filter(c => statusOf(c) === 'analyzed').length;
  const cols = [
    { id: 'name', header: 'Competitor', first: 'asc', value: c => c.name, className: 'px-3 py-3 min-w-[220px]', cell: c => (
      <div className="min-w-0"><button type="button" onClick={() => setOpen(c)} className="block max-w-full text-left font-semibold text-slate-900 hover:text-indigo-700 hover:underline truncate cursor-pointer">{c.name}</button>
        {c.host ? <span className="text-12.5 text-slate-500 truncate block">{c.host}</span> : <span className="text-12 text-slate-400">no website to analyze</span>}</div>) },
    { id: 'da', header: 'Authority (DA)', first: 'desc', value: c => metrics[c.host]?.da ?? null, tip: { what: 'Domain Authority, 0 to 100: how strong the website is. Higher is harder to beat.', from: 'Moz, read through Apify' },
      cell: c => <span className={`inline-flex items-center justify-center min-w-[36px] h-7 px-2 rounded-md text-13 font-bold ${daTone(metrics[c.host]?.da)}`}>{metrics[c.host]?.da ?? '—'}</span> },
    { id: 'kw', header: 'Keywords', right: true, first: 'desc', value: c => metrics[c.host]?.keywords ?? null, tip: { what: 'How many Google searches it ranks for.', from: 'Apify ranked-keywords read' }, cell: c => (metrics[c.host]?.keywords == null ? NA : num(metrics[c.host].keywords)) },
    { id: 'tr', header: 'Visitors a month', right: true, first: 'desc', value: c => metrics[c.host]?.traffic ?? null, tip: { what: 'An estimate worked out from the keywords it ranks for. It is not its real analytics.' }, cell: c => (metrics[c.host]?.traffic == null ? NA : kfmt(metrics[c.host].traffic)) },
    { id: 'status', header: 'Status', value: c => (STATUS[statusOf(c)] || STATUS.pending)[0], cell: c => { const st = statusOf(c); return <Badge tone={(STATUS[st] || STATUS.pending)[1]}>{st === 'running' && <Loader2 size={11} className="animate-spin" />}{(STATUS[st] || STATUS.pending)[0]}</Badge>; } },
    { id: 'act', header: '', csv: false, right: true, className: 'px-3 py-2 text-right whitespace-nowrap', cell: c => {
      const st = statusOf(c);
      const read = st === 'analyzed' || st === 'partial';
      return <span className="inline-flex gap-2">
        <Button size="sm" variant={read ? 'secondary' : 'primary'} disabled={!c.host || st === 'running' || st === 'queued'} onClick={() => analyze([c], true)}>{read ? 'Refresh' : 'Analyze'}</Button>
        <Button size="sm" onClick={() => setOpen(c)}>Details</Button>
      </span>;
    } },
  ];
  return (
    <div className="space-y-4">
      <Heading title="Analyze your competitors" text="We read each website's authority, the searches it ranks for and its estimated visitors. A read costs a little at Apify, so a competitor read in the last day is not read again."
        right={<><Button onClick={onShortlist}>Change who is chosen</Button><Button variant="primary" icon={BarChart3} disabled={!waiting.length} onClick={() => analyze(waiting, false)}>{waiting.length ? `Analyze ${waiting.length} not yet read` : 'All analyzed'}</Button></>} />
      <AutoBar auto={auto} />
      {!chosen.length ? (
        <div className="rounded-xl bg-white ring-1 ring-slate-200 p-8 text-center"><p className="text-14 text-slate-700">You have not chosen any competitor yet.</p><Button variant="primary" className="mt-3" onClick={onShortlist}>Choose competitors</Button></div>
      ) : (
        <DataTable columns={cols} rows={chosen} rowKey={c => c.key} initialSort={{ key: 'tr', dir: 'desc' }} pageSize={10} serial={false} search={false} filters={[]} columnsMenu={false} label="competitors" minWidth={760} empty="Nothing to show." />
      )}
      <div className="sticky bottom-3 z-10"><div className="rounded-xl bg-white shadow-lg ring-1 ring-slate-200 px-4 py-3 flex flex-wrap items-center gap-3">
        <span className="text-14 text-slate-800"><b>{done}</b> of <b>{chosen.length}</b> analyzed</span>
        <Button variant="primary" className="ml-auto" disabled={!done} onClick={onNext}>See opportunities<ArrowRight size={15} className="ml-1.5 inline" /></Button>
      </div></div>
      {open && <CompetitorDetail b={b} c={open} m={metrics[open.host] || {}} status={statusOf(open)} onClose={() => setOpen(null)} onProfile={() => { const c = open; setOpen(null); onProfile(c); }} onKind={onKind} />}
      {toastNode}
    </div>
  );
}

/** Everything else about one competitor, in one window: the other numbers, how well it matches you, whether it is a direct competitor, and every earlier analysis. */
function CompetitorDetail({ b, c, m, status, onClose, onProfile, onKind }) {
  const [runs, setRuns] = useState(null);
  const [kind, setKind] = useState(c.reg?.kind || '');
  useEffect(() => { if (!c.host) { setRuns([]); return; } api(`/businesses/${b.id}/keyword-workspace/competitor-analysis/history?domain=${encodeURIComponent(c.host)}`).then(r => setRuns(r.runs || [])).catch(() => setRuns([])); }, [c.host]); // eslint-disable-line react-hooks/exhaustive-deps
  const rel = c.maps?.relevance;
  const F = ({ k, v }) => <div className="rounded-lg bg-slate-50 px-3 py-2"><div className="text-11.5 text-slate-500">{k}</div><div className="text-14 font-semibold text-slate-900 tabular-nums">{v}</div></div>;
  const setK = async (k) => { if (!c.reg?.id) return; setKind(k); await onKind(c.reg.id, k); };
  return (
    <Modal open onClose={onClose} width="max-w-2xl" title={c.name} footer={<><Button onClick={onProfile}>Full profile</Button><Button variant="primary" onClick={onClose}>Close</Button></>}>
      <p className="text-13 text-slate-600 flex flex-wrap items-center gap-x-3">{c.host && <a href={`https://${c.host}`} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline inline-flex items-center gap-1">{c.host}<ExternalLink size={11} /></a>}{place(c) && <span>{[place(c), km(c.maps?.distance_m)].filter(Boolean).join(' · ')}</span>}<Badge tone={(STATUS[status] || STATUS.pending)[1]}>{(STATUS[status] || STATUS.pending)[0]}</Badge></p>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <F k="Authority (DA)" v={m.da ?? '—'} /><F k="Page authority" v={m.pa ?? '—'} /><F k="Spam score" v={m.spam == null ? '—' : `${m.spam}%`} /><F k="Referring sites" v={kfmt(m.rd)} />
        <F k="Keywords" v={num(m.keywords)} /><F k="On page 1" v={num(m.top10)} /><F k="In the top 3" v={num(m.top3)} /><F k="Average position" v={m.avg_position == null ? '—' : `#${m.avg_position}`} />
      </div>
      <p className="mt-1.5 text-12 text-slate-500">Visitors a month: {m.traffic == null ? 'not available' : <b>{kfmt(m.traffic)}</b>} (an estimate from its keywords). {m.kw_read_at || m.site_read_at ? `Last read ${when(m.kw_read_at || m.site_read_at)}.` : 'Not read yet.'}</p>
      {rel && <div className="mt-4 rounded-lg ring-1 ring-slate-200 px-3 py-2.5"><div className="text-13 font-semibold text-slate-900">Match with your business: {rel.score} / 100 <span className="font-normal text-slate-500">· {rel.label_text}</span></div>{rel.reason && <p className="text-12.5 text-slate-600 mt-0.5">{rel.reason}</p>}</div>}
      {c.reg?.id && <div className="mt-4"><div className="text-13 font-semibold text-slate-900 mb-1.5">Is it a direct competitor?</div>
        <div className="flex flex-wrap gap-2">{[['direct', 'Direct'], ['indirect', 'Indirect'], ['', 'Not decided']].map(([k, l]) => <button key={l} type="button" aria-pressed={kind === k} onClick={() => setK(k)} className={`h-8 px-3 rounded-lg text-12.5 font-semibold cursor-pointer ring-1 ring-inset ${kind === k ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}>{l}</button>)}</div></div>}
      <div className="mt-4"><div className="text-13 font-semibold text-slate-900 mb-1.5">Earlier analyses</div>
        {runs == null ? <Loader2 size={14} className="animate-spin text-slate-400" /> : !runs.length ? <p className="text-12.5 text-slate-500">Not analyzed yet. Each analysis is kept here.</p>
          : <ul className="space-y-1.5 max-h-48 overflow-auto">{runs.map(r => <li key={r.id ?? 'e'} className="text-12.5 text-slate-700"><Badge tone={(STATUS[r.status] || STATUS.pending)[1]}>{(STATUS[r.status] || [r.status])[0]}</Badge> <span className="text-slate-500">{when(r.finished_at || r.started_at)}{r.earlier ? ' · read before history was kept' : r.trigger === 'auto' ? ' · automatic' : ''}</span>{r.error && <div className="text-amber-700 mt-0.5">{r.error}</div>}</li>)}</ul>}</div>
    </Modal>
  );
}

// ----------------------------------------------------------------------------------------------------------------------------- step 4: opportunities
const VIEWS = [
  { id: 'keywords', title: 'Keywords to win', text: 'Searches your competitors rank for and you do not' },
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
      {view === 'keywords' && <KeywordsView b={b} gap={gap} />}
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

// ----------------------------------------------------------------------------------------------------------------------------- one Keywords page
const MODES = [['missing', 'They rank, you do not'], ['weak', 'They rank higher than you'], ['all', 'All']];

/** The keyword gap and the competitors' keywords as one list. Three buttons say which (they rank and you do not, they rank higher, all), one switch keeps only what fits your business, one dropdown picks the competitors, one search box. */
function KeywordsView({ b, gap }) {
  const [toast, toastNode] = useToast();
  const [mode, setMode] = useState('missing');
  const [fitOnly, setFitOnly] = useState(true);
  const [who, setWho] = useState([]);
  const [sel, setSel] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const view = useRef([]);
  const g = gap.data;
  const stale = g && g.counts && g.counts.missing === undefined && g.counts.gap !== undefined;
  const all = useMemo(() => (g?.rows || []).filter(r => r.status !== 'only_you').map(r => ({
    id: r.keyword, keyword: r.keyword, volume: r.volume, kd: r.difficulty, score: r.score, status: r.status, fit: r.fit === 'yes' || r.fit === 'maybe', yours: r.yours, best: r.best, competitors: r.competitors, intent: r.intent, cpc: r.cpc, competitor: r.best?.domain,
  })), [g]);
  const base = all.filter(r => (mode === 'all' || (mode === 'missing' ? r.status === 'missing' : r.status === 'weak')) && (!fitOnly || r.fit) && (!who.length || r.competitors.some(c => who.includes(c.domain))));
  const count = (m) => all.filter(r => (m === 'all' || (m === 'missing' ? r.status === 'missing' : r.status === 'weak')) && (!fitOnly || r.fit)).length;
  if (gap.error) return <ErrorNote>{gap.error.message || String(gap.error)}</ErrorNote>;
  if (!g) return <div className="flex items-center gap-2 py-10 text-13 text-slate-500"><Loader2 size={16} className="animate-spin" />Loading…</div>;
  const read = g.competitors.filter(c => c.keywords).length;
  const picked = base.filter(r => sel.has(r.id));
  const add = async (list) => { setBusy(true); const ok = await saveToMy(b, list.map(r => ({ ...r, sourceLabel: `Competitor gap: ${r.competitor || 'competitors'}` })), toast, 'Competitor gap', 'competitors'); setBusy(false); if (ok) setSel(new Set()); };
  const cols = [
    { id: 'sel', header: <input type="checkbox" aria-label="Select every keyword shown" onChange={e => setSel(s => { const n = new Set(s); view.current.forEach(r => (e.target.checked ? n.add(r.id) : n.delete(r.id))); return n; })} className="accent-indigo-600" />, csv: false,
      cell: r => <input type="checkbox" aria-label={`Select ${r.keyword}`} checked={sel.has(r.id)} onChange={() => setSel(s => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })} className="accent-indigo-600" />, className: 'pl-3 pr-1 py-2.5 w-8', thClass: 'pl-3 pr-1 py-3 w-8' },
    { id: 'keyword', header: 'Keyword', first: 'asc', value: r => r.keyword, className: 'px-3 py-2.5 min-w-[220px]', cell: r => <span className="font-medium text-slate-900">{r.keyword}</span> },
    { id: 'volume', header: 'Searches a month', right: true, first: 'desc', value: r => r.volume ?? null, cell: r => num(r.volume) },
    { id: 'kd', header: 'Difficulty', right: true, value: r => r.kd ?? null, tip: { what: 'Keyword difficulty, 0 to 100: how hard it is to reach page 1. Lower is easier.' }, cell: r => r.kd ?? '—' },
    { id: 'score', header: 'Worth', right: true, first: 'desc', value: r => r.score ?? null, tip: { what: 'Our own 0 to 100 score for how worth going after it is: searches, ease, intent, how far behind you are and how well it fits your business. It is not a Google ranking factor.' },
      cell: r => (r.score == null ? '—' : <span className={`inline-flex min-w-[34px] justify-center px-2 py-0.5 rounded-md text-13 font-bold ${r.score >= 70 ? 'bg-emerald-100 text-emerald-800' : r.score >= 45 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{r.score}</span>) },
    { id: 'best', header: 'Best competitor', value: r => r.best?.position ?? null, className: 'px-3 py-2.5', cell: r => (r.best ? <span className="text-12.5"><b>#{r.best.position}</b> <span className="text-slate-500">{r.best.domain}</span>{r.competitors.length > 1 && <span className="text-slate-400"> +{r.competitors.length - 1}</span>}</span> : '—') },
    { id: 'yours', header: 'You', right: true, value: r => r.yours ?? null, cell: r => (r.yours ? `#${r.yours}` : <span className="text-slate-400">Not ranking</span>) },
    { id: 'add', header: '', csv: false, right: true, className: 'px-3 py-2 text-right', cell: r => <Button size="sm" onClick={() => add([r])}>Add</Button> },
  ];
  return (
    <div className="space-y-3">
      {stale && <div role="alert" className="rounded-lg bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-13 text-amber-900"><b>The backend is running old code.</b> Stop every backend process on port 8000, start the backend again, and reload this page.</div>}
      <p className="text-13 text-slate-600">Built from the keywords of <b>{read}</b> analyzed competitor{read === 1 ? '' : 's'}{read < g.competitors.length ? `. ${g.competitors.length - read} more are not read yet: analyze them in step 3 for a fuller list` : ''}. Rankings are for your project's market.</p>
      <div className="flex flex-wrap items-center gap-2">
        {MODES.map(([k, l]) => <button key={k} type="button" aria-pressed={mode === k} onClick={() => { setMode(k); setSel(new Set()); }} className={`h-9 px-4 rounded-lg text-13 font-semibold cursor-pointer ring-1 ring-inset ${mode === k ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}>{l} <span className="opacity-70">{count(k)}</span></button>)}
        <button type="button" aria-pressed={fitOnly} onClick={() => setFitOnly(f => !f)} className={`h-9 px-4 rounded-lg text-13 font-semibold cursor-pointer ring-1 ring-inset ${fitOnly ? 'bg-emerald-600 text-white ring-emerald-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}>{fitOnly ? '✓ Only what fits my business' : 'Only what fits my business'}</button>
        <MultiSelect aria-label="Competitors" noun="competitors" allLabel="All competitors" searchPlaceholder="Search competitors" value={who} onChange={setWho} className="ml-auto"
          options={g.competitors.map(c => ({ value: c.domain, label: c.domain, hint: c.keywords ? `${num(c.keywords)} keywords` : 'not read' }))} />
      </div>
      <DataTable columns={cols} rows={base} rowKey={r => r.id} initialSort={{ key: 'score', dir: 'desc' }} pageSize={15} serial={false} filters={[]} columnsMenu={false} searchPlaceholder="Search keywords" label="keywords" minWidth={860} onState={s => { view.current = s.rows; }}
        toolbar={<><Button size="sm" variant="primary" busy={busy} disabled={!picked.length} onClick={() => add(picked)}>Add {picked.length || ''} chosen to My Keywords</Button><Button size="sm" busy={busy} disabled={!base.length} onClick={() => add(view.current.length ? view.current : base)} title="Adds every keyword in the list below, up to 300 at a time">Add all {base.length > 300 ? '300' : base.length} shown</Button></>}
        empty={g.competitors.some(c => c.keywords) ? 'No keyword fits this view. Try “All”, or switch off “Only what fits my business”.' : 'No competitor has been analyzed yet. Analyze them in step 3 and their keywords appear here.'} />
      {toastNode}
    </div>
  );
}
