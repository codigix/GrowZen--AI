import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, ExternalLink, Loader2, Plus, RefreshCw, Search } from 'lucide-react';
import { Button, Badge, ErrorNote, useAction, useToast } from './SeoUi';
import { usePager, Pager, downloadCsv } from './DataTable';
import Select from '../components/Select';
import { api, useApi } from './seoApi';

const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const STATUS = { gap: ['Gap', 'red', 'They rank, you do not'], behind: ['Behind', 'amber', 'Both rank, they are higher'], ahead: ['Ahead', 'green', 'Both rank, you are higher'], only_you: ['Only you', 'blue', 'You rank, the competitors read do not'] };
const FIT = { yes: ['Useful', 'green'], maybe: ['Maybe', 'amber'], have: ['You have it', 'blue'], no: ['Not useful', 'red'] };
const COST = (n) => (0.021 + 0.003 * n).toFixed(2);
const Intent = ({ v }) => (v ? <span className="text-12 text-slate-500 capitalize">{v}</span> : <span className="text-slate-300">—</span>);
const short = (u) => String(u || '').replace(/^https?:\/\/(www\.)?/, '');

/** The competitors' kept rankings and the comparison with you, read once and shared by both tabs. */
export function useCompetitorGap(b) {
  const r = useApi(`/businesses/${b.id}/keyword-workspace/competitor-gap`);
  return r;
}

/** One chip per competitor: how many of its keywords are kept, and the button that reads its real rankings (paid per keyword). */
function Readers({ b, gap, onRead, busy }) {
  const [size, setSize] = useState('100');
  return (
    <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div><h3 className="text-15 font-semibold text-slate-900">Competitors</h3><p className="text-12.5 text-slate-500">Only their keywords are read: no website, speed or technical check.</p></div>
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
        {!gap.competitors.length && <li className="text-13 text-slate-500">No competitors chosen yet. Find and choose them on the Competitors tab.</li>}
      </ul>
      <p className="mt-2 text-11.5 text-slate-400">A read costs about $0.003 per keyword plus $0.02 a domain at Apify (about ${COST(Number(size))} for {size}). It is kept until you read that competitor again.</p>
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
  const [dom, setDom] = useState('');
  const [q, setQ] = useState('');
  const [topics, setTopics] = useState(null);
  const [tBusy, tErr, tRun] = useAction();
  const g = gap.data;
  const rows = useMemo(() => {
    if (!g) return [];
    const out = [];
    for (const r of g.rows) for (const c of r.competitors) if (c.position && (!dom || c.domain === dom) && (!q || r.keyword.includes(q.toLowerCase()))) out.push({ keyword: r.keyword, domain: c.domain, position: c.position, url: c.url, source: c.source, volume: r.volume, intent: r.intent, difficulty: r.difficulty, yours: r.yours, fit: r.fit });
    return out.sort((a, c) => a.position - c.position || (c.volume || 0) - (a.volume || 0));
  }, [g, dom, q]);
  const pager = usePager(rows, { size: 25, resetKey: `${dom}|${q}` });
  const loadTopics = () => tRun('t', async () => setTopics(await api(`/businesses/${b.id}/keyword-workspace/competitor-keywords`, { method: 'POST', body: {}, timeout: 120000 })));

  if (!g) return <div className="flex items-center justify-center gap-2 py-14 text-13 text-slate-500"><Loader2 size={16} className="animate-spin" />Loading…</div>;
  return (
    <div className="space-y-4">
      <Readers b={b} gap={g} onRead={read} busy={busy} />
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="rounded-xl bg-white ring-1 ring-slate-200">
        <div className="px-4 pt-4 flex flex-wrap items-center gap-2">
          <h3 className="text-15 font-semibold text-slate-900">Where they rank</h3><span className="text-13 text-slate-500">{num(rows.length)} keyword{rows.length === 1 ? '' : 's'}</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Select value={dom} onChange={e => setDom(e.target.value)} aria-label="Competitor" className="h-9 w-48 rounded-lg ring-1 ring-inset ring-slate-300 bg-white px-2.5 text-13"><option value="">All competitors</option>{g.competitors.map(c => <option key={c.domain} value={c.domain}>{c.domain}</option>)}</Select>
            <div className="relative"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter keywords" aria-label="Filter keywords" className="h-9 w-44 rounded-lg ring-1 ring-inset ring-slate-300 pl-8 pr-2 text-13" /></div>
            <Button size="sm" icon={Download} disabled={!rows.length} onClick={() => downloadCsv('competitor-keywords', ['Keyword', 'Competitor', 'Position', 'Page', 'Volume', 'Difficulty', 'Intent', 'Your position'], rows.map(r => [r.keyword, r.domain, r.position, r.url || '', r.volume ?? '', r.difficulty ?? '', r.intent || '', r.yours ?? '']))}>CSV</Button>
          </div>
        </div>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-13">
            <thead><tr className="text-12 text-slate-500 bg-slate-50/70"><th className="px-4 py-2 text-left font-medium">Keyword</th><th className="px-3 py-2 text-left font-medium">Competitor</th><th className="px-3 py-2 text-right font-medium">Their position</th><th className="px-3 py-2 text-left font-medium">Ranking page</th><th className="px-3 py-2 text-right font-medium">Searches / mo</th><th className="px-3 py-2 text-right font-medium">KD</th><th className="px-3 py-2 text-left font-medium">Intent</th><th className="px-3 py-2 text-right font-medium">Your position</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {pager.rows.map(r => (
                <tr key={`${r.domain}|${r.keyword}`}>
                  <td className="px-4 py-2.5 font-medium text-slate-900">{r.keyword}</td>
                  <td className="px-3 py-2.5 text-slate-600">{r.domain}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold">#{r.position}{r.source === 'google' && <span className="ml-1 text-11 font-normal text-slate-400" title="Seen in Google's top 10 for one of your tracked searches">top 10</span>}</td>
                  <td className="px-3 py-2.5 max-w-[260px]">{r.url ? <a href={r.url} target="_blank" rel="noreferrer" title={r.url} className="text-blue-700 hover:underline inline-flex items-center gap-1 max-w-full"><span className="truncate">{short(r.url)}</span><ExternalLink size={11} className="shrink-0" /></a> : <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{num(r.volume)}</td><td className="px-3 py-2.5 text-right tabular-nums">{r.difficulty ?? '—'}</td><td className="px-3 py-2.5"><Intent v={r.intent} /></td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.yours ? `#${r.yours}` : <span className="text-slate-400">Not ranking</span>}</td>
                </tr>
              ))}
              {!pager.rows.length && <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">{g.competitors.some(c => c.keywords) ? 'No keywords match.' : 'Read a competitor above to see the keywords it ranks for.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-100"><Pager p={pager} label="keywords" /></div>
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
  const [fit, setFit] = useState('yes');
  const [busy, , run] = useAction();
  const [toast, toastNode] = useToast();
  const shown = rows.filter(r => !fit || r.fit === fit);
  const pager = usePager(shown, { size: 15, resetKey: fit });
  const send = () => run('s', async () => { const r = await api(`/businesses/${b.id}/keyword-workspace/add`, { method: 'POST', body: { ideas: shown.slice(0, 300).map(i => ({ keyword: i.keyword, volume: i.volume, detail: `Competitor topic: ${i.competitors[0]}` })), label: 'Competitor topics' } }); toast(r.added ? `${r.added} keywords sent to Find Keywords` : 'Already in Find Keywords'); });
  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-1.5">{['yes', 'maybe', 'no', ''].map(k => <button key={k || 'all'} type="button" aria-pressed={fit === k} onClick={() => setFit(k)} className={`h-8 px-3 rounded-full text-12.5 font-semibold cursor-pointer ${fit === k ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>{k ? FIT[k][0] : 'All'} <span className="opacity-70">{k ? rows.filter(r => r.fit === k).length : rows.length}</span></button>)}
        <Button className="ml-auto" size="sm" variant="primary" icon={Plus} busy={busy === 's'} disabled={!shown.length} onClick={send}>Send to Find Keywords</Button></div>
      <table className="w-full text-13 mt-2"><thead><tr className="text-12 text-slate-500"><th className="text-left font-medium py-1.5">Keyword</th><th className="text-left font-medium">Useful for you?</th><th className="text-right font-medium">Searches / mo</th><th className="text-left font-medium pl-4">Competitor</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{pager.rows.map(r => <tr key={r.keyword}><td className="py-2 font-medium text-slate-900">{r.keyword}</td><td className="py-2"><Badge tone={FIT[r.fit][1]}>{FIT[r.fit][0]}</Badge> <span className="text-12 text-slate-500">{r.why}</span></td><td className="py-2 text-right tabular-nums">{num(r.volume)}</td><td className="py-2 pl-4 text-slate-600">{(r.competitors || []).join(', ')}</td></tr>)}</tbody></table>
      <Pager p={pager} label="keywords" />{toastNode}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------- Keyword gap
export function KeywordGapTab({ b }) {
  const gap = useCompetitorGap(b);
  const { busy, error, read, toastNode } = useReader(b, gap);
  const [status, setStatus] = useState('gap');
  const [fit, setFit] = useState('');
  const [dom, setDom] = useState('');
  const [q, setQ] = useState('');
  const [wsBusy, , wsRun] = useAction();
  const [toast, toastNode2] = useToast();
  const g = gap.data;
  const rows = useMemo(() => (g ? g.rows.filter(r => (!status || r.status === status) && (!fit || (fit === 'worth' ? r.fit === 'yes' || r.fit === 'maybe' : r.fit === fit)) && (!dom || r.competitors.some(c => c.domain === dom)) && (!q || r.keyword.includes(q.toLowerCase()))) : []), [g, status, fit, dom, q]);
  const pager = usePager(rows, { size: 25, resetKey: `${status}|${fit}|${dom}|${q}` });
  if (!g) return <div className="flex items-center justify-center gap-2 py-14 text-13 text-slate-500"><Loader2 size={16} className="animate-spin" />Loading…</div>;
  const c = g.counts;
  const send = (list) => wsRun('ws', async () => { const r = await api(`/businesses/${b.id}/keyword-workspace/add`, { method: 'POST', body: { ideas: list.slice(0, 300).map(i => ({ keyword: i.keyword, volume: i.volume, detail: `Keyword gap: ${i.best?.domain || 'competitor'} ranks #${i.best?.position ?? '?'}` })), label: 'Keyword gap' } }); toast(r.added ? `${r.added} keywords sent to Find Keywords` : 'Already in Find Keywords'); });
  const hasData = g.competitors.some(x => x.keywords || x.from_google);

  return (
    <div className="space-y-4">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        {[['gap', 'Gap', c.gap, 'They rank, you do not'], ['behind', 'Behind', c.behind, 'They are higher'], ['ahead', 'Ahead', c.ahead, 'You are higher'], ['only_you', 'Only you', c.only_you, 'No competitor read ranks']].map(([k, l, n, s]) => (
          <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(status === k ? '' : k)} className={`text-left rounded-xl bg-white ring-1 px-4 py-3 cursor-pointer ${status === k ? 'ring-2 ring-indigo-500' : 'ring-slate-200 hover:bg-slate-50'}`}><div className="text-13 text-slate-500">{l}</div><div className="text-28 font-bold text-slate-900 tabular-nums leading-tight">{n}</div><div className="text-12 text-slate-500">{s}</div></button>
        ))}
        <div className="rounded-xl bg-emerald-50 ring-1 ring-emerald-200 px-4 py-3"><div className="text-13 text-emerald-800">Worth targeting</div><div className="text-28 font-bold text-emerald-900 tabular-nums leading-tight">{c.useful_gaps}</div><div className="text-12 text-emerald-800">gaps that fit your business</div></div>
      </div>

      {!hasData && <Readers b={b} gap={g} onRead={read} busy={busy} />}
      {error && <ErrorNote>{error}</ErrorNote>}
      {!hasData ? <div className="rounded-xl bg-white ring-1 ring-slate-200 p-8 text-center text-13 text-slate-500">No competitor rankings are kept yet. Read a competitor above (or open <b>SERP Features</b> in Position Tracking to read Google's top 10 on your tracked searches), then the gap appears here.</div> : (
        <div className="rounded-xl bg-white ring-1 ring-slate-200">
          <div className="px-4 pt-4 flex flex-wrap items-center gap-2">
            <h3 className="text-15 font-semibold text-slate-900">Keyword gap</h3><span className="text-13 text-slate-500">{num(rows.length)} keyword{rows.length === 1 ? '' : 's'}</span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Select value={fit} onChange={e => setFit(e.target.value)} aria-label="Useful" className="h-9 w-44 rounded-lg ring-1 ring-inset ring-slate-300 bg-white px-2.5 text-13"><option value="">Any usefulness</option><option value="worth">Useful or maybe</option><option value="yes">Useful</option><option value="no">Not useful</option></Select>
              <Select value={dom} onChange={e => setDom(e.target.value)} aria-label="Competitor" className="h-9 w-48 rounded-lg ring-1 ring-inset ring-slate-300 bg-white px-2.5 text-13"><option value="">All competitors</option>{g.competitors.map(x => <option key={x.domain} value={x.domain}>{x.domain}</option>)}</Select>
              <div className="relative"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter keywords" aria-label="Filter keywords" className="h-9 w-40 rounded-lg ring-1 ring-inset ring-slate-300 pl-8 pr-2 text-13" /></div>
              <Button size="sm" variant="primary" icon={Plus} busy={wsBusy === 'ws'} disabled={!rows.some(r => r.fit === 'yes' || r.fit === 'maybe')} onClick={() => send(rows.filter(r => r.fit === 'yes' || r.fit === 'maybe'))}>Send useful to Find Keywords</Button>
              <Button size="sm" icon={Download} disabled={!rows.length} onClick={() => downloadCsv('keyword-gap', ['Keyword', 'Status', 'Searches/mo', 'Best competitor', 'Their position', 'Your position', 'Difference', 'Useful', 'Why'], rows.map(r => [r.keyword, STATUS[r.status][0], r.volume ?? '', r.best?.domain || '', r.best?.position ?? '', r.yours ?? '', r.difference ?? '', FIT[r.fit][0], r.why]))}>CSV</Button>
            </div>
          </div>
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-13">
              <thead><tr className="text-12 text-slate-500 bg-slate-50/70"><th className="px-4 py-2 text-left font-medium">Keyword</th><th className="px-3 py-2 text-left font-medium">Gap</th><th className="px-3 py-2 text-right font-medium">Searches / mo</th><th className="px-3 py-2 text-left font-medium">Who ranks</th><th className="px-3 py-2 text-right font-medium">Their best</th><th className="px-3 py-2 text-right font-medium">You</th><th className="px-3 py-2 text-right font-medium">Difference</th><th className="px-3 py-2 text-left font-medium">Useful for you?</th><th className="px-3 py-2" /></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {pager.rows.map(r => (
                  <tr key={r.keyword}>
                    <td className="px-4 py-2.5 font-medium text-slate-900">{r.keyword}</td>
                    <td className="px-3 py-2.5"><Badge tone={STATUS[r.status][1]} title={STATUS[r.status][2]}>{STATUS[r.status][0]}</Badge></td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{num(r.volume)}</td>
                    <td className="px-3 py-2.5 text-slate-600 max-w-[240px]"><span className="block truncate" title={r.competitors.map(x => `${x.domain} #${x.position ?? '—'}`).join(', ')}>{r.competitors.length ? r.competitors.slice(0, 2).map(x => `${x.domain} #${x.position ?? '—'}`).join(', ') + (r.competitors.length > 2 ? ` +${r.competitors.length - 2}` : '') : '—'}</span></td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{r.best ? `#${r.best.position}` : '—'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.yours ? `#${r.yours}` : <span className="text-slate-400">Not ranking</span>}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.difference == null ? '—' : <span className={r.difference > 0 ? 'text-rose-600 font-semibold' : 'text-emerald-600 font-semibold'}>{r.difference > 0 ? `${r.difference} behind` : `${Math.abs(r.difference)} ahead`}</span>}</td>
                    <td className="px-3 py-2.5 max-w-[260px]"><Badge tone={FIT[r.fit][1]}>{FIT[r.fit][0]}</Badge><div className="text-11.5 text-slate-500 mt-0.5 truncate" title={r.why}>{r.why}</div></td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">{(r.fit === 'yes' || r.fit === 'maybe') && <Link className="text-12.5 font-semibold text-indigo-600 hover:underline" to={`/keyword-management/prepare?k=${encodeURIComponent(r.keyword)}`}>Prepare</Link>}</td>
                  </tr>
                ))}
                {!pager.rows.length && <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">No keywords in this view.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="border-t border-slate-100"><Pager p={pager} label="keywords" /></div>
        </div>
      )}
      {toastNode}{toastNode2}
    </div>
  );
}
