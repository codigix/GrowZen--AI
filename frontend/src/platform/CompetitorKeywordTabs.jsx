import React, { useMemo, useRef, useState } from 'react';
import { FocusBar, sameSite } from './TableBits';
import { Link } from 'react-router-dom';
import { ExternalLink, Eye, Loader2, Plus, Search } from 'lucide-react';
import { Button, Badge, ErrorNote, Modal, useAction, useToast } from './SeoUi';
import DataTable from './DataTable';
import MultiSelect from '../components/MultiSelect';
import { api, useApi } from './seoApi';
import { BANDS, band } from './CompetitorTables';

const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const STATUS = { missing: ['Missing', 'red', 'A competitor ranks and you do not'], weak: ['Weak', 'amber', 'Both rank and they are more than 3 positions above you'], shared: ['Shared', 'blue', 'Both rank, within 3 positions of each other'], strong: ['Strong', 'green', 'Both rank and you are more than 3 positions above them'], only_you: ['Only you', 'gray', 'You rank, the competitors read do not'] };
const SCORE_HELP = 'Opportunity score, 0 to 100, our own way of ordering your to-do list (not a Google ranking factor). Searches 30 (log scale, 10,000+ = full), ease 25 (100 minus difficulty), intent 15 (transactional 15, commercial or local 12, informational 6, navigational 2), distance 20 (missing 20, weak 2 per position behind, shared 4, strong 0), fit 10 (useful 10, maybe 5).';
const FIT = { yes: ['Useful', 'green'], maybe: ['Maybe', 'amber'], have: ['You have it', 'blue'], no: ['Not useful', 'red'] };
const short = (u) => String(u || '').replace(/^https?:\/\/(www\.)?/, '');
const VOLUME = [['100', '100+ a month'], ['1000', '1,000+ a month'], ['10000', '10,000+ a month']];
const KD = [['easy', 'Easy (under 30)'], ['mid', 'Medium (30 to 59)'], ['hard', 'Hard (60+)']];
const kdBand = (v) => (v == null ? null : v < 30 ? 'easy' : v < 60 ? 'mid' : 'hard');
const INTENTS = [['informational', 'Informational'], ['commercial', 'Commercial'], ['transactional', 'Transactional'], ['navigational', 'Navigational'], ['local', 'Local']];
const COUNTRY = { IN: 'India', US: 'United States', GB: 'United Kingdom', CA: 'Canada', AU: 'Australia', AE: 'United Arab Emirates', DE: 'Germany', FR: 'France', SG: 'Singapore' };

/** The competitors' kept rankings and the comparison with you, read once and shared by both tabs. */
const normHost = (d) => String(d || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
/** The competitor's domain as the kept data spells it, from the host a table cell sent. */
const resolveDomain = (g, host) => (host ? (g?.competitors || []).find(c => normHost(c.domain) === normHost(host))?.domain || host : '');
export function useCompetitorGap(b) {
  return useApi(`/businesses/${b.id}/keyword-workspace/competitor-gap`);
}

// ---------------------------------------------------------------------------------------------------------------------------------- Competitor keywords
export function CompetitorKeywordsTab({ b, focus = '', band: focusBand = '' }) {
  const gap = useCompetitorGap(b);
  const [topics, setTopics] = useState(null);
  const [tBusy, tErr, tRun] = useAction();
  const g = gap.data;
  const [fh, setFh] = useState(focus); // the one competitor shown; '' = all
  const only = g && fh ? resolveDomain(g, fh) : '';
  const [chosen, setChosen] = useState(() => new Set()); // competitors picked as chips; empty = every competitor
  const [rng, setRng] = useState({ pmin: '', pmax: '', vmin: '', vmax: '', kmin: '', kmax: '', url: '' });
  const [sel, setSel] = useState(() => new Set());
  const [drawer, setDrawer] = useState(null);
  const [adding, setAdding] = useState(false);
  const [toast, toastNode2] = useToast();
  const viewRef = useRef([]); // the rows the table shows now (filtered, sorted)
  const rows = useMemo(() => {
    if (!g) return [];
    const out = [];
    for (const r of g.rows) for (const c of r.competitors) if (c.position) out.push({ id: `${c.domain}|${r.keyword}`, keyword: r.keyword, domain: c.domain, position: c.position, url: c.url, source: c.source, volume: r.volume, intent: r.intent, kd: r.difficulty, cpc: r.cpc, traffic: c.traffic, yours: r.yours, fit: r.fit, why: r.why, others: r.competitors, readAt: (g.competitors.find(x => x.domain === c.domain) || {}).read_at });
    return out;
  }, [g]);
  const loadTopics = () => tRun('t', async () => setTopics(await api(`/businesses/${b.id}/keyword-workspace/competitor-keywords`, { method: 'POST', body: {}, timeout: 120000 })));
  if (!g) return <div className="flex items-center justify-center gap-2 py-14 text-13 text-slate-500"><Loader2 size={16} className="animate-spin" />Loading…</div>;

  const n = (v) => (v === '' || v == null ? null : Number(v));
  const inRange = (v, lo, hi) => (lo == null && hi == null) || (v != null && (lo == null || v >= lo) && (hi == null || v <= hi));
  const urlNeedle = rng.url.trim().toLowerCase();
  const base = rows.filter(r => (only ? sameSite(r.domain, only) : !chosen.size || chosen.has(r.domain))
    && inRange(r.position, n(rng.pmin), n(rng.pmax)) && inRange(r.volume, n(rng.vmin), n(rng.vmax)) && inRange(r.kd, n(rng.kmin), n(rng.kmax)) && (!urlNeedle || (r.url || '').toLowerCase().includes(urlNeedle)));
  const analyzed = g.competitors.filter(c => c.keywords);
  const rangeActive = Object.values(rng).some(v => v !== '');
  const picked = base.filter(r => sel.has(r.id));
  const addToMy = async (list) => {
    if (!list.length) { toast('Nothing to add: tick some rows, or use Add all filtered.'); return; }
    setAdding(true);
    try {
      const body = list.slice(0, 300).map(r => ({ keyword: r.keyword, volume: r.volume ?? undefined, difficulty: r.kd ?? undefined, cpc: r.cpc ?? undefined, intent: r.intent || undefined,
        source: { kind: 'competitors', label: `Competitor keywords: ${r.domain}`, competitor: r.domain, from: 'competitor_keywords', at: new Date().toISOString().slice(0, 10) } }));
      const res = await api(`/businesses/${b.id}/keywords`, { method: 'POST', body, timeout: 120000 });
      toast(`${res.added} new keyword${res.added === 1 ? '' : 's'} added to My Keywords${res.existing?.length ? `. ${res.existing.length} already there${res.updated ? `, ${res.updated} got this competitor as a new source` : ''}: not duplicated` : ''}${list.length > 300 ? '. Only the first 300 were sent.' : ''}`);
      setSel(new Set());
    } catch (e) { toast(e.message || 'The keywords could not be added.'); } finally { setAdding(false); }
  };

  const cols = [
    { id: 'sel', header: <input type="checkbox" aria-label="Select every row shown" checked={viewRef.current.length > 0 && viewRef.current.every(r => sel.has(r.id))} onChange={e => setSel(s0 => { const x = new Set(s0); viewRef.current.forEach(r => (e.target.checked ? x.add(r.id) : x.delete(r.id))); return x; })} className="accent-indigo-600" />, csv: false,
      cell: r => <input type="checkbox" aria-label={`Select ${r.keyword}`} checked={sel.has(r.id)} onChange={() => setSel(s0 => { const x = new Set(s0); x.has(r.id) ? x.delete(r.id) : x.add(r.id); return x; })} className="accent-indigo-600" />, className: 'pl-3 pr-1 py-2.5 w-8', thClass: 'pl-3 pr-1 py-3 w-8' },
    { id: 'keyword', header: 'Keyword', first: 'asc', value: r => r.keyword, cell: r => <button type="button" onClick={() => setDrawer(r)} title="Open the keyword's details" className="font-medium text-slate-900 hover:text-indigo-700 hover:underline text-left cursor-pointer">{r.keyword}</button>, className: 'px-3 py-2.5 min-w-[200px]' },
    { id: 'domain', header: 'Competitor', value: r => r.domain },
    { id: 'position', header: 'Their position', right: true, value: r => r.position, cell: r => <span className="font-semibold">#{r.position}{r.source === 'google' && <span className="ml-1 text-11 font-normal text-slate-400" title="Seen in Google's top 10 for one of your tracked searches">top 10</span>}</span>, tip: { what: 'Where the competitor ranks on Google for it.' } },
    { id: 'url', header: 'Ranking page', value: r => r.url || '', className: 'px-3 py-2.5 max-w-[240px]', cell: r => (r.url ? <a href={r.url} target="_blank" rel="noreferrer" title={r.url} className="text-blue-700 hover:underline inline-flex items-center gap-1 max-w-full"><span className="truncate">{short(r.url)}</span><ExternalLink size={11} className="shrink-0" /></a> : <span className="text-slate-300">—</span>) },
    { id: 'volume', header: 'Searches / mo', right: true, first: 'desc', value: r => r.volume ?? null, cell: r => num(r.volume) },
    { id: 'kd', header: 'KD', right: true, value: r => r.kd ?? null },
    { id: 'traffic', header: 'Est. traffic', right: true, first: 'desc', value: r => r.traffic ?? null, cell: r => (r.traffic == null ? '—' : num(Math.round(r.traffic))), tip: { what: 'Estimated visits a month this keyword brings the competitor.' } },
    { id: 'intent', header: 'Intent', value: r => r.intent || '', cell: r => (r.intent ? <span className="text-12 capitalize text-slate-600">{r.intent}</span> : <span className="text-slate-300">—</span>) },
    { id: 'yours', header: 'Your position', right: true, value: r => r.yours ?? null, cell: r => (r.yours ? `#${r.yours}` : <span className="text-slate-400">Not ranking</span>) },
    { id: 'gap', header: 'Gap', right: true, value: r => (r.yours ? r.yours - r.position : 1000 - r.position), tip: { what: 'How far you are behind this competitor on the keyword.' }, cell: r => (!r.yours ? <span className="text-rose-600 font-semibold">you do not rank</span> : r.yours > r.position ? <span className="text-rose-600 font-semibold">{r.yours - r.position} behind</span> : <span className="text-emerald-600 font-semibold">{r.position - r.yours} ahead</span>) },
    { id: 'fit', header: 'Useful for you?', value: r => FIT[r.fit]?.[0] || '', cell: r => <span title={r.why}><Badge tone={FIT[r.fit]?.[1] || 'gray'}>{FIT[r.fit]?.[0] || '—'}</Badge></span> },
    { id: 'serp', header: 'SERP features', value: () => '', hide: true, cell: () => <span className="text-slate-300">Not available</span>, tip: { what: 'Features such as snippets or maps on the results page. The ranked-keywords source does not return them, so none are shown.' } },
    { id: 'updated', header: 'Last updated', first: 'desc', value: r => r.readAt || null, cell: r => (r.readAt ? new Date(r.readAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : <span className="text-slate-300">Not available</span>), tip: { what: 'When this competitor\'s ranked keywords were last read.' } },
    { id: 'act', header: 'Actions', csv: false, right: true, className: 'px-2 py-1.5 text-right whitespace-nowrap', cell: r => (
      <span className="inline-flex items-center">
        <button type="button" aria-label={`Details of ${r.keyword}`} title="Details" onClick={() => setDrawer(r)} className="p-1.5 text-slate-500 hover:text-indigo-700 cursor-pointer"><Eye size={16} /></button>
        <button type="button" aria-label={`Add ${r.keyword} to My Keywords`} title="Add to My Keywords" onClick={() => addToMy([r])} className="p-1.5 text-slate-500 hover:text-emerald-700 cursor-pointer"><Plus size={16} /></button>
      </span>) },
  ];
  const filters = [
    { id: 'domain', label: 'Competitor', options: g.competitors.map(c => [c.domain, c.domain]), test: (r, v) => r.domain === v },
    { id: 'pos', label: 'Their position', options: [['top10', 'Top 10 (page 1)'], ...BANDS.filter(x => x[0] !== 'none')], test: (r, v) => (v === 'top10' ? r.position <= 10 : band(r.position) === v) },
    { id: 'vs', label: 'Against you', options: [['gap', 'You do not rank'], ['behind', 'You are behind'], ['ahead', 'You are ahead']], test: (r, v) => (v === 'gap' ? !r.yours : v === 'behind' ? r.yours && r.yours > r.position : r.yours && r.yours <= r.position) },
    { id: 'volume', label: 'Searches', options: VOLUME, test: (r, v) => (r.volume || 0) >= Number(v) },
    { id: 'kd', label: 'Difficulty', options: KD, test: (r, v) => kdBand(r.kd) === v },
    { id: 'intent', label: 'Intent', options: INTENTS, test: (r, v) => r.intent === v },
    { id: 'fit', label: 'Useful', options: [['yes', 'Useful'], ['maybe', 'Maybe'], ['no', 'Not useful'], ['have', 'You have it']], test: (r, v) => r.fit === v },
  ];
  return (
    <div className="space-y-4">
      <FocusBar name={only} what={focusBand ? `its ${focusBand === 'top3' ? 'top 3' : focusBand === 'top10' ? 'top 10' : focusBand} keywords` : 'its ranking keywords'} onAll={() => setFh('')} />
      <div>
        <DataTable columnsKey="competitor-keywords" key={only} initialFilters={{ ...(only ? { domain: only } : {}), ...(only && focusBand ? { pos: focusBand } : {}) }} columns={cols} rows={base} rowKey={r => r.id} filters={filters.filter(f => f.id !== 'domain')} collapseFilters filtersExtra={<>
          {[['Position', 'pmin', 'pmax', 1, 100], ['Searches / mo', 'vmin', 'vmax', 0, null], ['Difficulty', 'kmin', 'kmax', 0, 100]].map(([l, lo, hi, min, max]) => (
            <span key={l} className="inline-flex items-center gap-1.5">{l}
              <input type="number" min={min} max={max ?? undefined} value={rng[lo]} onChange={e => setRng(r => ({ ...r, [lo]: e.target.value }))} placeholder="from" aria-label={`${l} from`} className="h-8 w-20 rounded-lg ring-1 ring-inset ring-slate-300 px-2 text-13" />
              <input type="number" min={min} max={max ?? undefined} value={rng[hi]} onChange={e => setRng(r => ({ ...r, [hi]: e.target.value }))} placeholder="to" aria-label={`${l} to`} className="h-8 w-20 rounded-lg ring-1 ring-inset ring-slate-300 px-2 text-13" /></span>))}
          <span className="inline-flex items-center gap-1.5">Ranking page<input value={rng.url} onChange={e => setRng(r => ({ ...r, url: e.target.value }))} placeholder="part of the address" aria-label="Ranking page contains" className="h-8 w-44 rounded-lg ring-1 ring-inset ring-slate-300 px-2 text-13" /></span>
          {rangeActive && <button type="button" onClick={() => setRng({ pmin: '', pmax: '', vmin: '', vmax: '', kmin: '', kmax: '', url: '' })} className="text-indigo-700 hover:underline cursor-pointer">Clear ranges</button>}
        </>} onState={st => { viewRef.current = st.rows; }}
          toolbar={<>{!only && <MultiSelect aria-label="Competitors to show" noun="competitors" allLabel={`All competitors (${g.competitors.length})`} searchPlaceholder="Search competitors" value={[...chosen]} onChange={v => setChosen(new Set(v))}
            options={g.competitors.map(c => ({ value: c.domain, label: c.domain, hint: c.keywords ? `${num(c.keywords)} keywords` : 'not read' }))}
            actions={[{ label: `All analyzed (${analyzed.length})`, disabled: !analyzed.length, onClick: () => setChosen(new Set(analyzed.map(c => c.domain))) }]} />}<Button size="sm" variant="primary" icon={Plus} busy={adding} disabled={!picked.length} onClick={() => addToMy(picked)} title="Add the ticked keywords to My Keywords">Add {picked.length || ''} ticked</Button><Button size="sm" icon={Plus} busy={adding} disabled={!base.length} onClick={() => addToMy(viewRef.current.length ? viewRef.current : base)} title="Add every keyword the table shows now, with its filters, to My Keywords (up to 300 at a time)">Add all filtered</Button></>} initialSort={{ key: 'traffic', dir: 'desc' }} exportName="competitor-keywords" searchPlaceholder="Search keywords or competitors" label="keywords" minWidth={1100}
          empty={g.competitors.some(c => c.keywords) ? 'No keywords match.' : 'Competitors are analyzed automatically; their ranking keywords appear here as each is read.'} />
      </div>
      <KeywordDrawer r={drawer} rows={rows} country={g.country} onClose={() => setDrawer(null)} onAdd={(x) => addToMy([x])} />
      {toastNode2}
      {!only && <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4">
        <div className="flex flex-wrap items-center gap-3"><div><h3 className="text-15 font-semibold text-slate-900">Topics they are about <span className="text-12 font-normal text-slate-400">free, no positions</span></h3><p className="text-12.5 text-slate-500">Google Keyword Planner reads each competitor's address and lists the searches it is about.</p></div>
          <Button className="ml-auto" size="sm" busy={tBusy === 't'} icon={Search} onClick={loadTopics}>{topics ? 'Refresh' : 'Show topics'}</Button></div>
        {tErr && <div className="mt-2"><ErrorNote>{tErr}</ErrorNote></div>}
        {topics?.rows?.length > 0 && <TopicList b={b} rows={topics.rows} />}
      </div>}
    </div>
  );
}

/** Everything kept about one keyword a competitor ranks for. Only what was read is shown: nothing is estimated here. */
function KeywordDrawer({ r, rows, country, onClose, onAdd }) {
  if (!r) return null;
  const words = r.keyword.split(' ').filter(w => w.length > 3);
  const related = [...new Map(rows.filter(x => x.keyword !== r.keyword && words.some(w => x.keyword.split(' ').includes(w))).map(x => [x.keyword, x])).values()].sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 8);
  const F = ({ k, v }) => <div className="rounded-lg bg-slate-50 px-3 py-2"><div className="text-11.5 text-slate-500">{k}</div><div className="text-14 font-semibold text-slate-900 tabular-nums">{v}</div></div>;
  return (
    <Modal open onClose={onClose} width="max-w-2xl" title={r.keyword} footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" icon={Plus} onClick={() => onAdd(r)}>Add to My Keywords</Button></>}>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <F k="Searches / mo" v={num(r.volume)} /><F k="Keyword difficulty" v={r.kd ?? '—'} />
        <F k="Search intent" v={r.intent ? <span className="capitalize">{r.intent}</span> : '—'} /><F k={`${r.domain} position`} v={`#${r.position}`} /><F k="Your position" v={r.yours ? `#${r.yours}` : 'Not ranking'} />
      </div>
      <dl className="mt-3 text-13 space-y-1.5">
        <div><dt className="inline text-slate-500">Ranking page: </dt><dd className="inline">{r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline break-all">{r.url}</a> : 'Not available'}</dd></div>
        <div><dt className="inline text-slate-500">Estimated visits a month to them: </dt><dd className="inline">{r.traffic == null ? 'Not available' : num(Math.round(r.traffic))}</dd></div>
        <div><dt className="inline text-slate-500">Market: </dt><dd className="inline">{COUNTRY[country] || country || 'the project market'}</dd></div>
        <div><dt className="inline text-slate-500">Last read: </dt><dd className="inline">{r.readAt ? new Date(r.readAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Not available'}</dd></div>
      </dl>
      <h4 className="mt-4 text-13 font-semibold text-slate-900">Other competitors ranking for it</h4>
      {(r.others || []).filter(o => o.domain !== r.domain && o.position).length
        ? <ul className="mt-1 text-13 divide-y divide-slate-100">{r.others.filter(o => o.domain !== r.domain && o.position).sort((a, b) => a.position - b.position).map(o => <li key={o.domain} className="py-1.5 flex items-center gap-3"><b className="w-10 tabular-nums">#{o.position}</b><span className="font-medium">{o.domain}</span>{o.url && <a href={o.url} target="_blank" rel="noreferrer" className="ml-auto text-blue-700 hover:underline truncate max-w-[260px]" title={o.url}>{short(o.url)}</a>}</li>)}</ul>
        : <p className="mt-1 text-13 text-slate-500">No other competitor read ranks for it. The full results page (SERP overview) is not kept for this keyword.</p>}
      <h4 className="mt-4 text-13 font-semibold text-slate-900">Related keywords in the data kept</h4>
      {related.length ? <div className="mt-1 flex flex-wrap gap-1.5">{related.map(x => <span key={x.keyword} className="px-2.5 py-1 rounded-full text-12.5 bg-slate-50 border border-slate-200 text-slate-700" title={`${x.domain} #${x.position}`}>{x.keyword}{x.volume != null && <span className="ml-1 text-slate-400">{num(x.volume)}</span>}</span>)}</div>
        : <p className="mt-1 text-13 text-slate-500">None of the other kept keywords share a word with it.</p>}
    </Modal>
  );
}

function TopicList({ b, rows }) {
  const [busy, , run] = useAction();
  const [toast, toastNode] = useToast();
  const viewRef = useRef([]); // the rows the table shows now (kept in a ref: the table reports them on every render)
  const send = () => run('s', async () => { const list = viewRef.current.filter(r => r.fit === 'yes' || r.fit === 'maybe'); const r = await api(`/businesses/${b.id}/keyword-workspace/add`, { method: 'POST', body: { ideas: list.slice(0, 300).map(i => ({ keyword: i.keyword, volume: i.volume, detail: `Competitor topic: ${i.competitors[0]}` })), label: 'Competitor topics' } }); toast(r.added ? `${r.added} keywords sent to Find Keywords` : 'Already in Find Keywords'); });
  const cols = [
    { id: 'keyword', header: 'Keyword', first: 'asc', value: r => r.keyword, cell: r => <span className="font-medium text-slate-900">{r.keyword}</span> },
    { id: 'fit', header: 'Useful for you?', value: r => FIT[r.fit]?.[0] || '', cell: r => <span><Badge tone={FIT[r.fit]?.[1] || 'gray'}>{FIT[r.fit]?.[0]}</Badge> <span className="text-12 text-slate-500">{r.why}</span></span> },
    { id: 'volume', header: 'Searches / mo', right: true, first: 'desc', value: r => r.volume ?? null, cell: r => num(r.volume) },
    { id: 'comp', header: 'Competitor', value: r => (r.competitors || []).join(', ') },
  ];
  const filters = [
    { id: 'fit', label: 'Useful', options: [['yes', 'Useful'], ['maybe', 'Maybe'], ['no', 'Not useful'], ['have', 'You have it']], test: (r, v) => r.fit === v },
    { id: 'volume', label: 'Searches', options: VOLUME, test: (r, v) => (r.volume || 0) >= Number(v) },
    { id: 'comp', label: 'Competitor', options: [...new Set(rows.flatMap(r => r.competitors || []))].map(d => [d, d]), test: (r, v) => (r.competitors || []).includes(v) },
  ];
  return (
    <div className="mt-3">
      <DataTable columnsKey="topics" columns={cols} rows={rows} rowKey={r => r.keyword} filters={filters} initialSort={{ key: 'volume', dir: 'desc' }} pageSize={15} exportName="competitor-topics" searchPlaceholder="Search topics" label="keywords" bare onState={s => { viewRef.current = s.rows; }}
        toolbar={<Button size="sm" variant="primary" icon={Plus} busy={busy === 's'} onClick={send}>Send useful to Find Keywords</Button>} />
      {toastNode}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------- Keyword gap
export function KeywordGapTab({ b, focus = '' }) {
  const gap = useCompetitorGap(b);
  const [status, setStatus] = useState('missing');
  const [fh, setFh] = useState(focus);
  const viewRef = useRef([]); // the rows the table shows now (kept in a ref: the table reports them on every render)
  const [wsBusy, , wsRun] = useAction();
  const [toast, toastNode2] = useToast();
  const g = gap.data;
  const only = g && fh ? resolveDomain(g, fh) : '';
  const pool = useMemo(() => (g ? g.rows.filter(r => (!status || r.status === status) && (!only || r.competitors.some(x => sameSite(x.domain, only)))) : []), [g, status, only]);
  if (!g) return <div className="flex items-center justify-center gap-2 py-14 text-13 text-slate-500"><Loader2 size={16} className="animate-spin" />Loading…</div>;
  const c = g.counts;
  const send = () => wsRun('ws', async () => { const list = viewRef.current.filter(r => r.fit === 'yes' || r.fit === 'maybe'); const r = await api(`/businesses/${b.id}/keyword-workspace/add`, { method: 'POST', body: { ideas: list.slice(0, 300).map(i => ({ keyword: i.keyword, volume: i.volume, detail: `Keyword gap: ${i.best?.domain || 'competitor'} ranks #${i.best?.position ?? '?'}` })), label: 'Keyword gap' } }); toast(r.added ? `${r.added} keywords sent to Find Keywords` : 'Already in Find Keywords'); });
  const hasData = g.competitors.some(x => x.keywords || x.from_google);
  const stale = c.missing === undefined && (c.gap !== undefined || c.behind !== undefined); // the server still sends the old status names: it is running code from before this page was updated

  const cols = [
    { id: 'keyword', header: 'Keyword', first: 'asc', value: r => r.keyword, cell: r => <span className="font-medium text-slate-900">{r.keyword}</span>, className: 'px-3 py-2.5 min-w-[190px]' },
    { id: 'status', header: 'Gap', value: r => STATUS[r.status][0], cell: r => <Badge tone={STATUS[r.status][1]} title={STATUS[r.status][2]}>{STATUS[r.status][0]}</Badge> },
    { id: 'volume', header: 'Searches / mo', right: true, first: 'desc', value: r => r.volume ?? null, cell: r => num(r.volume) },
    { id: 'kd', header: 'KD', right: true, value: r => r.difficulty ?? null },
    { id: 'score', header: 'Opportunity', right: true, first: 'desc', value: r => r.score ?? null, tip: { what: SCORE_HELP },
      cell: r => (r.score == null ? <span className="text-slate-300">—</span> : <span title={r.score_parts ? `Searches ${r.score_parts.searches}/30 · Ease ${r.score_parts.ease}/25 · Intent ${r.score_parts.intent}/15 · Distance ${r.score_parts.distance}/20 · Fit ${r.score_parts.fit}/10` : ''} className={`inline-flex min-w-[34px] justify-center px-2 py-0.5 rounded-md text-13 font-bold ${r.score >= 70 ? 'bg-emerald-100 text-emerald-800' : r.score >= 45 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{r.score}</span>) },
    ...g.competitors.filter(x => x.keywords || x.from_google).slice(0, 6).map((x, i) => ({ id: `pos:${x.domain}`, header: x.domain, right: true, hide: i > 1, value: r => r.competitors.find(y => y.domain === x.domain)?.position ?? null, cell: r => { const p = r.competitors.find(y => y.domain === x.domain)?.position; return p ? `#${p}` : <span className="text-slate-300">—</span>; }, tip: { what: `Where ${x.domain} ranks for the keyword.` } })),
    { id: 'intent', header: 'Intent', value: r => r.intent || '', cell: r => (r.intent ? <span className="text-12 capitalize text-slate-600">{r.intent}</span> : <span className="text-slate-300">—</span>) },
    { id: 'who', header: 'Who ranks', value: r => r.competitors.map(x => x.domain).join(', '), className: 'px-3 py-2.5 max-w-[240px]', cell: r => <span className="block truncate" title={r.competitors.map(x => `${x.domain} #${x.position ?? '—'}`).join(', ')}>{r.competitors.slice(0, 2).map(x => `${x.domain} #${x.position ?? '—'}`).join(', ')}{r.competitors.length > 2 ? ` +${r.competitors.length - 2}` : ''}</span> },
    { id: 'ncomp', header: 'Competitors', right: true, first: 'desc', value: r => r.competitors.length, hide: true },
    { id: 'best', header: 'Their best', right: true, value: r => r.best?.position ?? null, cell: r => (r.best ? <b>#{r.best.position}</b> : '—') },
    { id: 'yours', header: 'Our position', right: true, value: r => r.yours ?? null, cell: r => (r.yours ? `#${r.yours}` : <span className="text-slate-400">Not ranking</span>) },
    { id: 'diff', header: 'Difference', right: true, value: r => r.difference ?? null, cell: r => (r.difference == null ? '—' : <span className={r.difference > 0 ? 'text-rose-600 font-semibold' : 'text-emerald-600 font-semibold'}>{r.difference > 0 ? `${r.difference} behind` : `${Math.abs(r.difference)} ahead`}</span>) },
    { id: 'fit', header: 'Useful for you?', value: r => FIT[r.fit]?.[0] || '', className: 'px-3 py-2.5 max-w-[240px]', cell: r => <span><Badge tone={FIT[r.fit][1]}>{FIT[r.fit][0]}</Badge><span className="block text-11.5 text-slate-500 mt-0.5 truncate" title={r.why}>{r.why}</span></span> },
    { id: 'go', header: '', csv: false, right: true, className: 'px-3 py-2.5 text-right whitespace-nowrap', cell: r => ((r.fit === 'yes' || r.fit === 'maybe') ? <Link className="text-12.5 font-semibold text-indigo-600 hover:underline" to={`/keyword-management/prepare?k=${encodeURIComponent(r.keyword)}`}>Prepare</Link> : null) },
  ];
  const filters = [
    { id: 'fit', label: 'Useful', options: [['worth', 'Useful or maybe'], ['yes', 'Useful'], ['maybe', 'Maybe'], ['no', 'Not useful'], ['have', 'You have it']], test: (r, v) => (v === 'worth' ? r.fit === 'yes' || r.fit === 'maybe' : r.fit === v) },
    { id: 'type', label: 'Opportunity type', options: Object.entries(STATUS).map(([k, v]) => [k, v[0]]), test: (r, v) => r.status === v },
    { id: 'comp', label: 'Competitor', options: g.competitors.map(x => [x.domain, x.domain]), test: (r, v) => r.competitors.some(x => x.domain === v) },
    { id: 'pos', label: 'Their best', options: BANDS.filter(x => x[0] !== 'none'), test: (r, v) => band(r.best?.position) === v },
    { id: 'volume', label: 'Searches', options: VOLUME, test: (r, v) => (r.volume || 0) >= Number(v) },
    { id: 'kd', label: 'Difficulty', options: KD, test: (r, v) => kdBand(r.difficulty) === v },
    { id: 'intent', label: 'Intent', options: INTENTS, test: (r, v) => r.intent === v },
  ];
  return (
    <div className="space-y-4">
      <FocusBar name={only} what="the keywords it ranks for that you can still win" onAll={() => setFh('')} />
      <div className="flex flex-wrap items-center gap-2">
        {[['missing', 'Missing', c.missing, 'They rank and you do not'], ['weak', 'Weak', c.weak, 'Both rank and they are 4 or more positions higher'], ['shared', 'Shared', c.shared, 'Both rank, within 3 positions of each other'], ['strong', 'Strong', c.strong, 'Both rank and you are 4 or more positions higher'], ['only_you', 'Only you', c.only_you, 'You rank and no competitor read does']].map(([key, label, n, tip]) => (
          <button key={key} type="button" aria-pressed={status === key} title={tip} onClick={() => setStatus(status === key ? '' : key)}
            className={`h-9 px-3.5 rounded-lg text-13 font-semibold inline-flex items-center gap-2 cursor-pointer ring-1 ring-inset ${status === key ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}>{label}<span className={`tabular-nums ${status === key ? 'text-indigo-100' : 'text-slate-400'}`}>{n}</span></button>
        ))}
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 ring-1 ring-emerald-200 px-3 py-1.5 text-13 text-emerald-900" title="Missing keywords that fit your business"><b className="tabular-nums">{c.useful_gaps}</b> worth targeting</span>
      </div>
      {stale && <div role="alert" className="rounded-lg bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-13 text-amber-900"><b>The backend is running old code.</b> It still answers with the old gap names (Gap, Behind, Ahead), so the cards and table cannot fill in. Stop every backend process on port 8000, start the backend again, and reload this page.</div>}
      {!hasData ? <div className="rounded-xl bg-white ring-1 ring-slate-200 p-8 text-center text-13 text-slate-500">No competitor rankings are kept yet. They are read automatically on the Competitors tab, or open <b>SERP Features</b> in Position Tracking to read Google's top 10 on your tracked searches. Then the gap appears here.</div> : (
        <DataTable columnsKey="keyword-gap" key={only} columns={cols} rows={pool} rowKey={r => r.keyword} filters={only ? filters.filter(f => f.id !== 'comp') : filters} collapseFilters initialSort={{ key: 'volume', dir: 'desc' }} exportName="keyword-gap" searchPlaceholder="Search keywords or competitors" label="keywords" minWidth={1200} onState={s => { viewRef.current = s.rows; }}
          toolbar={<Button size="sm" variant="primary" icon={Plus} busy={wsBusy === 'ws'} onClick={send}>Send useful to Find Keywords</Button>} empty="No keywords in this view." />
      )}
      <p className="text-12 text-slate-500">Rankings are for {COUNTRY[g.country] || g.country || 'the project market'}. Your position is your checked position, or Search Console's average when Google showed your site.</p>
      {toastNode2}
    </div>
  );
}
