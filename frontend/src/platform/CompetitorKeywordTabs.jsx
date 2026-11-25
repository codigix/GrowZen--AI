import React, { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Loader2, Plus, RefreshCw, Search } from 'lucide-react';
import { Button, Badge, ErrorNote, useAction, useToast } from './SeoUi';
import DataTable from './DataTable';
import Select from '../components/Select';
import { api, useApi } from './seoApi';
import { BANDS, band } from './CompetitorTables';

const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const STATUS = { gap: ['Gap', 'red', 'They rank, you do not'], behind: ['Behind', 'amber', 'Both rank, they are higher'], ahead: ['Ahead', 'green', 'Both rank, you are higher'], only_you: ['Only you', 'blue', 'You rank, the competitors read do not'] };
const FIT = { yes: ['Useful', 'green'], maybe: ['Maybe', 'amber'], have: ['You have it', 'blue'], no: ['Not useful', 'red'] };
const COST = (n) => (0.021 + 0.003 * n).toFixed(2);
const short = (u) => String(u || '').replace(/^https?:\/\/(www\.)?/, '');
const VOLUME = [['100', '100+ a month'], ['1000', '1,000+ a month'], ['10000', '10,000+ a month']];
const KD = [['easy', 'Easy (under 30)'], ['mid', 'Medium (30 to 59)'], ['hard', 'Hard (60+)']];
const kdBand = (v) => (v == null ? null : v < 30 ? 'easy' : v < 60 ? 'mid' : 'hard');
const INTENTS = [['informational', 'Informational'], ['commercial', 'Commercial'], ['transactional', 'Transactional'], ['navigational', 'Navigational'], ['local', 'Local']];
const COUNTRY = { IN: 'India', US: 'United States', GB: 'United Kingdom', CA: 'Canada', AU: 'Australia', AE: 'United Arab Emirates', DE: 'Germany', FR: 'France', SG: 'Singapore' };

/** The competitors' kept rankings and the comparison with you, read once and shared by both tabs. */
export function useCompetitorGap(b) {
  return useApi(`/businesses/${b.id}/keyword-workspace/competitor-gap`);
}

/** One card per competitor: how many of its keywords are kept, and the button that reads its real rankings (paid per keyword). */
function Readers({ gap, onRead, busy }) {
  const [size, setSize] = useState('100');
  return (
    <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div><h3 className="text-15 font-semibold text-slate-900">Competitors</h3><p className="text-12.5 text-slate-500">Only their keywords are read: no website, speed or technical check. Rankings are for {COUNTRY[gap.country] || gap.country || 'the project market'}.</p></div>
        <label className="ml-auto inline-flex items-center gap-2 text-12.5 text-slate-600">Keywords per competitor
          <Select value={size} onChange={e => setSize(e.target.value)} aria-label="Keywords to read" className="h-8 w-28 rounded-lg ring-1 ring-inset ring-slate-300 bg-white px-2 text-13">{['50', '100', '200', '300'].map(n => <option key={n} value={n}>{n}</option>)}</Select>
        </label>
      </div>
      <ul className="mt-3 grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {gap.competitors.map(c => (
          <li key={c.domain} className="rounded-lg ring-1 ring-slate-200 px-3 py-2.5 flex items-center gap-3">
            <div className="min-w-0 flex-1"><a href={`https://${c.domain}`} target="_blank" rel="noreferrer" className="text-13.5 font-semibold text-slate-900 hover:text-indigo-700 truncate block">{c.domain}</a>
              <div className="text-12 text-slate-500">{c.keywords ? `${num(c.keywords)} keywords · read ${new Date(c.read_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : c.from_google ? `${c.from_google} from Google's top 10 on your searches` : 'Rankings not read yet'}</div></div>
            <Button size="sm" icon={RefreshCw} busy={busy === c.domain} onClick={() => onRead(c.domain, Number(size))} title={`Reads up to ${size} ranked keywords: about $${COST(Number(size))} at Apify`}>{c.keywords ? 'Read again' : 'Read rankings'}</Button>
          </li>
        ))}
        {!gap.competitors.length && <li className="text-13 text-slate-500">No competitors chosen yet. Select them on the Competitors tab.</li>}
      </ul>
      <p className="mt-2 text-11.5 text-slate-400">Competitors are also read automatically on the Competitors tab. A read costs about $0.003 per keyword plus $0.02 a domain at Apify (about ${COST(Number(size))} for {size}).</p>
    </div>
  );
}

function useReader(b, gap) {
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const read = (domain, limit) => run(domain, async () => {
    const r = await api(`/businesses/${b.id}/keyword-workspace/competitor-rankings`, { method: 'POST', body: { domain, limit }, timeout: 180000 });
    await gap.reload(true);
    toast(r.note || `${r.rows.length} ranked keyword${r.rows.length === 1 ? '' : 's'} read for ${domain} (about $${r.cost})`);
  });
  return { busy, error, read, toastNode };
}

// ---------------------------------------------------------------------------------------------------------------------------------- Competitor keywords
export function CompetitorKeywordsTab({ b }) {
  const gap = useCompetitorGap(b);
  const { busy, error, read, toastNode } = useReader(b, gap);
  const [topics, setTopics] = useState(null);
  const [tBusy, tErr, tRun] = useAction();
  const g = gap.data;
  const rows = useMemo(() => {
    if (!g) return [];
    const out = [];
    for (const r of g.rows) for (const c of r.competitors) if (c.position) out.push({ id: `${c.domain}|${r.keyword}`, keyword: r.keyword, domain: c.domain, position: c.position, url: c.url, source: c.source, volume: r.volume, intent: r.intent, kd: r.difficulty, cpc: r.cpc, traffic: c.traffic, yours: r.yours, fit: r.fit, why: r.why });
    return out;
  }, [g]);
  const loadTopics = () => tRun('t', async () => setTopics(await api(`/businesses/${b.id}/keyword-workspace/competitor-keywords`, { method: 'POST', body: {}, timeout: 120000 })));
  if (!g) return <div className="flex items-center justify-center gap-2 py-14 text-13 text-slate-500"><Loader2 size={16} className="animate-spin" />Loading…</div>;

  const cols = [
    { id: 'keyword', header: 'Keyword', first: 'asc', value: r => r.keyword, cell: r => <span className="font-medium text-slate-900">{r.keyword}</span>, className: 'px-3 py-2.5 min-w-[200px]' },
    { id: 'domain', header: 'Competitor', value: r => r.domain },
    { id: 'position', header: 'Their position', right: true, value: r => r.position, cell: r => <span className="font-semibold">#{r.position}{r.source === 'google' && <span className="ml-1 text-11 font-normal text-slate-400" title="Seen in Google's top 10 for one of your tracked searches">top 10</span>}</span>, tip: { what: 'Where the competitor ranks on Google for it.' } },
    { id: 'url', header: 'Ranking page', value: r => r.url || '', className: 'px-3 py-2.5 max-w-[240px]', cell: r => (r.url ? <a href={r.url} target="_blank" rel="noreferrer" title={r.url} className="text-blue-700 hover:underline inline-flex items-center gap-1 max-w-full"><span className="truncate">{short(r.url)}</span><ExternalLink size={11} className="shrink-0" /></a> : <span className="text-slate-300">—</span>) },
    { id: 'volume', header: 'Searches / mo', right: true, first: 'desc', value: r => r.volume ?? null, cell: r => num(r.volume) },
    { id: 'kd', header: 'KD', right: true, value: r => r.kd ?? null },
    { id: 'cpc', header: 'CPC', right: true, value: r => r.cpc ?? null, cell: r => (r.cpc == null ? '—' : `$${Number(r.cpc).toFixed(2)}`), hide: true },
    { id: 'traffic', header: 'Est. traffic', right: true, first: 'desc', value: r => r.traffic ?? null, cell: r => (r.traffic == null ? '—' : num(Math.round(r.traffic))), tip: { what: 'Estimated visits a month this keyword brings the competitor.' } },
    { id: 'intent', header: 'Intent', value: r => r.intent || '', cell: r => (r.intent ? <span className="text-12 capitalize text-slate-600">{r.intent}</span> : <span className="text-slate-300">—</span>) },
    { id: 'yours', header: 'Your position', right: true, value: r => r.yours ?? null, cell: r => (r.yours ? `#${r.yours}` : <span className="text-slate-400">Not ranking</span>) },
    { id: 'gap', header: 'Gap', right: true, value: r => (r.yours ? r.yours - r.position : 1000 - r.position), tip: { what: 'How far you are behind this competitor on the keyword.' }, cell: r => (!r.yours ? <span className="text-rose-600 font-semibold">you do not rank</span> : r.yours > r.position ? <span className="text-rose-600 font-semibold">{r.yours - r.position} behind</span> : <span className="text-emerald-600 font-semibold">{r.position - r.yours} ahead</span>) },
    { id: 'fit', header: 'Useful for you?', value: r => FIT[r.fit]?.[0] || '', cell: r => <span title={r.why}><Badge tone={FIT[r.fit]?.[1] || 'gray'}>{FIT[r.fit]?.[0] || '—'}</Badge></span> },
  ];
  const filters = [
    { id: 'domain', label: 'Competitor', options: g.competitors.map(c => [c.domain, c.domain]), test: (r, v) => r.domain === v },
    { id: 'pos', label: 'Their position', options: BANDS.filter(x => x[0] !== 'none'), test: (r, v) => band(r.position) === v },
    { id: 'vs', label: 'Against you', options: [['gap', 'You do not rank'], ['behind', 'You are behind'], ['ahead', 'You are ahead']], test: (r, v) => (v === 'gap' ? !r.yours : v === 'behind' ? r.yours && r.yours > r.position : r.yours && r.yours <= r.position) },
    { id: 'volume', label: 'Searches', options: VOLUME, test: (r, v) => (r.volume || 0) >= Number(v) },
    { id: 'kd', label: 'Difficulty', options: KD, test: (r, v) => kdBand(r.kd) === v },
    { id: 'intent', label: 'Intent', options: INTENTS, test: (r, v) => r.intent === v },
    { id: 'fit', label: 'Useful', options: [['yes', 'Useful'], ['maybe', 'Maybe'], ['no', 'Not useful'], ['have', 'You have it']], test: (r, v) => r.fit === v },
  ];
  return (
    <div className="space-y-4">
      <Readers gap={g} onRead={read} busy={busy} />
      {error && <ErrorNote>{error}</ErrorNote>}
      <div>
        <h3 className="text-15 font-semibold text-slate-900 mb-1.5">Where they rank</h3>
        <DataTable columns={cols} rows={rows} rowKey={r => r.id} filters={filters} initialSort={{ key: 'traffic', dir: 'desc' }} exportName="competitor-keywords" searchPlaceholder="Search keywords or competitors" label="keywords" minWidth={1100}
          empty={g.competitors.some(c => c.keywords) ? 'No keywords match.' : 'Competitors are analyzed automatically; their ranking keywords appear here as each is read.'} />
      </div>
      <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4">
        <div className="flex flex-wrap items-center gap-3"><div><h3 className="text-15 font-semibold text-slate-900">Topics they are about <span className="text-12 font-normal text-slate-400">free, no positions</span></h3><p className="text-12.5 text-slate-500">Google Keyword Planner reads each competitor's address and lists the searches it is about.</p></div>
          <Button className="ml-auto" size="sm" busy={tBusy === 't'} icon={Search} onClick={loadTopics}>{topics ? 'Refresh' : 'Show topics'}</Button></div>
        {tErr && <div className="mt-2"><ErrorNote>{tErr}</ErrorNote></div>}
        {topics?.rows?.length > 0 && <TopicList b={b} rows={topics.rows} />}
      </div>
      {toastNode}
    </div>
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
    { id: 'cpc', header: 'CPC', right: true, value: r => r.cpc ?? null, cell: r => (r.cpc == null ? '—' : `$${Number(r.cpc).toFixed(2)}`) },
    { id: 'comp', header: 'Competitor', value: r => (r.competitors || []).join(', ') },
  ];
  const filters = [
    { id: 'fit', label: 'Useful', options: [['yes', 'Useful'], ['maybe', 'Maybe'], ['no', 'Not useful'], ['have', 'You have it']], test: (r, v) => r.fit === v },
    { id: 'volume', label: 'Searches', options: VOLUME, test: (r, v) => (r.volume || 0) >= Number(v) },
    { id: 'comp', label: 'Competitor', options: [...new Set(rows.flatMap(r => r.competitors || []))].map(d => [d, d]), test: (r, v) => (r.competitors || []).includes(v) },
  ];
  return (
    <div className="mt-3">
      <DataTable columns={cols} rows={rows} rowKey={r => r.keyword} filters={filters} initialSort={{ key: 'volume', dir: 'desc' }} pageSize={15} exportName="competitor-topics" searchPlaceholder="Search topics" label="keywords" bare onState={s => { viewRef.current = s.rows; }}
        toolbar={<Button size="sm" variant="primary" icon={Plus} busy={busy === 's'} onClick={send}>Send useful to Find Keywords</Button>} />
      {toastNode}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------- Keyword gap
export function KeywordGapTab({ b }) {
  const gap = useCompetitorGap(b);
  const { busy, error, read, toastNode } = useReader(b, gap);
  const [status, setStatus] = useState('gap');
  const viewRef = useRef([]); // the rows the table shows now (kept in a ref: the table reports them on every render)
  const [wsBusy, , wsRun] = useAction();
  const [toast, toastNode2] = useToast();
  const g = gap.data;
  const pool = useMemo(() => (g ? g.rows.filter(r => !status || r.status === status) : []), [g, status]);
  if (!g) return <div className="flex items-center justify-center gap-2 py-14 text-13 text-slate-500"><Loader2 size={16} className="animate-spin" />Loading…</div>;
  const c = g.counts;
  const send = () => wsRun('ws', async () => { const list = viewRef.current.filter(r => r.fit === 'yes' || r.fit === 'maybe'); const r = await api(`/businesses/${b.id}/keyword-workspace/add`, { method: 'POST', body: { ideas: list.slice(0, 300).map(i => ({ keyword: i.keyword, volume: i.volume, detail: `Keyword gap: ${i.best?.domain || 'competitor'} ranks #${i.best?.position ?? '?'}` })), label: 'Keyword gap' } }); toast(r.added ? `${r.added} keywords sent to Find Keywords` : 'Already in Find Keywords'); });
  const hasData = g.competitors.some(x => x.keywords || x.from_google);

  const cols = [
    { id: 'keyword', header: 'Keyword', first: 'asc', value: r => r.keyword, cell: r => <span className="font-medium text-slate-900">{r.keyword}</span>, className: 'px-3 py-2.5 min-w-[190px]' },
    { id: 'status', header: 'Gap', value: r => STATUS[r.status][0], cell: r => <Badge tone={STATUS[r.status][1]} title={STATUS[r.status][2]}>{STATUS[r.status][0]}</Badge> },
    { id: 'volume', header: 'Searches / mo', right: true, first: 'desc', value: r => r.volume ?? null, cell: r => num(r.volume) },
    { id: 'kd', header: 'KD', right: true, value: r => r.difficulty ?? null },
    { id: 'cpc', header: 'CPC', right: true, value: r => r.cpc ?? null, cell: r => (r.cpc == null ? '—' : `$${Number(r.cpc).toFixed(2)}`), hide: true },
    { id: 'intent', header: 'Intent', value: r => r.intent || '', cell: r => (r.intent ? <span className="text-12 capitalize text-slate-600">{r.intent}</span> : <span className="text-slate-300">—</span>) },
    { id: 'who', header: 'Who ranks', value: r => r.competitors.map(x => x.domain).join(', '), className: 'px-3 py-2.5 max-w-[240px]', cell: r => <span className="block truncate" title={r.competitors.map(x => `${x.domain} #${x.position ?? '—'}`).join(', ')}>{r.competitors.slice(0, 2).map(x => `${x.domain} #${x.position ?? '—'}`).join(', ')}{r.competitors.length > 2 ? ` +${r.competitors.length - 2}` : ''}</span> },
    { id: 'ncomp', header: 'Competitors', right: true, first: 'desc', value: r => r.competitors.length, hide: true },
    { id: 'best', header: 'Their best', right: true, value: r => r.best?.position ?? null, cell: r => (r.best ? <b>#{r.best.position}</b> : '—') },
    { id: 'yours', header: 'You', right: true, value: r => r.yours ?? null, cell: r => (r.yours ? `#${r.yours}` : <span className="text-slate-400">Not ranking</span>) },
    { id: 'diff', header: 'Difference', right: true, value: r => r.difference ?? null, cell: r => (r.difference == null ? '—' : <span className={r.difference > 0 ? 'text-rose-600 font-semibold' : 'text-emerald-600 font-semibold'}>{r.difference > 0 ? `${r.difference} behind` : `${Math.abs(r.difference)} ahead`}</span>) },
    { id: 'fit', header: 'Useful for you?', value: r => FIT[r.fit]?.[0] || '', className: 'px-3 py-2.5 max-w-[240px]', cell: r => <span><Badge tone={FIT[r.fit][1]}>{FIT[r.fit][0]}</Badge><span className="block text-11.5 text-slate-500 mt-0.5 truncate" title={r.why}>{r.why}</span></span> },
    { id: 'go', header: '', csv: false, right: true, className: 'px-3 py-2.5 text-right whitespace-nowrap', cell: r => ((r.fit === 'yes' || r.fit === 'maybe') ? <Link className="text-12.5 font-semibold text-indigo-600 hover:underline" to={`/keyword-management/prepare?k=${encodeURIComponent(r.keyword)}`}>Prepare</Link> : null) },
  ];
  const filters = [
    { id: 'fit', label: 'Useful', options: [['worth', 'Useful or maybe'], ['yes', 'Useful'], ['maybe', 'Maybe'], ['no', 'Not useful'], ['have', 'You have it']], test: (r, v) => (v === 'worth' ? r.fit === 'yes' || r.fit === 'maybe' : r.fit === v) },
    { id: 'comp', label: 'Competitor', options: g.competitors.map(x => [x.domain, x.domain]), test: (r, v) => r.competitors.some(x => x.domain === v) },
    { id: 'pos', label: 'Their best', options: BANDS.filter(x => x[0] !== 'none'), test: (r, v) => band(r.best?.position) === v },
    { id: 'volume', label: 'Searches', options: VOLUME, test: (r, v) => (r.volume || 0) >= Number(v) },
    { id: 'kd', label: 'Difficulty', options: KD, test: (r, v) => kdBand(r.difficulty) === v },
    { id: 'intent', label: 'Intent', options: INTENTS, test: (r, v) => r.intent === v },
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        {[['gap', 'Gap', c.gap, 'They rank, you do not'], ['behind', 'Behind', c.behind, 'They are higher'], ['ahead', 'Ahead', c.ahead, 'You are higher'], ['only_you', 'Only you', c.only_you, 'No competitor read ranks']].map(([k, l, n, s]) => (
          <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(status === k ? '' : k)} className={`text-left rounded-xl bg-white ring-1 px-4 py-3 cursor-pointer ${status === k ? 'ring-2 ring-indigo-500' : 'ring-slate-200 hover:bg-slate-50'}`}><div className="text-13 text-slate-500">{l}</div><div className="text-28 font-bold text-slate-900 tabular-nums leading-tight">{n}</div><div className="text-12 text-slate-500">{s}</div></button>
        ))}
        <div className="rounded-xl bg-emerald-50 ring-1 ring-emerald-200 px-4 py-3"><div className="text-13 text-emerald-800">Worth targeting</div><div className="text-28 font-bold text-emerald-900 tabular-nums leading-tight">{c.useful_gaps}</div><div className="text-12 text-emerald-800">gaps that fit your business</div></div>
      </div>
      {!hasData && <Readers gap={g} onRead={read} busy={busy} />}
      {error && <ErrorNote>{error}</ErrorNote>}
      {!hasData ? <div className="rounded-xl bg-white ring-1 ring-slate-200 p-8 text-center text-13 text-slate-500">No competitor rankings are kept yet. They are read automatically on the Competitors tab, or open <b>SERP Features</b> in Position Tracking to read Google's top 10 on your tracked searches. Then the gap appears here.</div> : (
        <DataTable columns={cols} rows={pool} rowKey={r => r.keyword} filters={filters} initialSort={{ key: 'volume', dir: 'desc' }} exportName="keyword-gap" searchPlaceholder="Search keywords or competitors" label="keywords" minWidth={1200} onState={s => { viewRef.current = s.rows; }}
          toolbar={<Button size="sm" variant="primary" icon={Plus} busy={wsBusy === 'ws'} onClick={send}>Send useful to Find Keywords</Button>} empty="No keywords in this view." />
      )}
      <p className="text-12 text-slate-500">Rankings are for {COUNTRY[g.country] || g.country || 'the project market'}. Your position is your checked position, or Search Console's average when Google showed your site.</p>
      {toastNode}{toastNode2}
    </div>
  );
}
