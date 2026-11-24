import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search, Star, ArrowUp, ArrowDown, Plus, RefreshCw, KeyRound, ScanSearch, Swords, Sparkles, Link2, MapPin, Gauge, Layers, FileText, ExternalLink,
  AlertTriangle, CheckCircle2, ChevronRight, Minus, TrendingUp, Trophy, Globe, HelpCircle, Lightbulb, Bot, Download, Loader2, X
} from 'lucide-react';
import { SeoShell, Card, Badge, Button, Modal, ErrorNote, ScoreRing, scoreLevel, useAction, useToast, useModulePath, Sk, SkStats, SkTable, SkCard } from './SeoUi';
import { api, useApi, fmt, fmtDateTime } from './seoApi';
import DataTable, { usePager, Pager, useSorted, SortTh, downloadCsv } from './DataTable';

/**
 * The SEO toolkit pages, each on data the platform really has (its own crawl, tracked keywords, Google results
 * from Google Search Console and the Places API, the competitor research): Domain Overview, Organic Rankings, Top Pages, Keyword Gap, Compare
 * Domains and Keyword Overview. Figures that need a paid index (organic traffic, backlink totals) are not
 * estimated: a page says what is missing and where to turn it on.
 */

/* ── shared bits ───────────────────────────────────────────────────────── */

const Pos = ({ value, maps }) => {
  if (!value) return <span className="inline-flex items-center justify-center w-9 h-6 rounded-md text-12 text-slate-400 bg-slate-50 border border-slate-200" title="Not in the results">—</span>;
  const cls = value <= 3 ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : value <= 10 ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-slate-50 text-slate-600 border-slate-200';
  return <span className={`inline-flex items-center justify-center min-w-9 h-6 px-1.5 rounded-md text-12 font-bold tabular-nums border ${cls}`} title={`${maps ? 'Google Maps' : 'Google'} position ${value}`}>#{value}</span>;
};

const Stars = ({ rating, reviews }) => (
  <span className="inline-flex items-center gap-1 text-12.5 text-slate-700 whitespace-nowrap"><Star size={12} className={rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'} /><b className="text-slate-900">{rating ? Number(rating).toFixed(1) : '—'}</b>{reviews != null && <span className="text-slate-500">({fmt(reviews)})</span>}</span>
);

function Tile({ icon: Icon, label, value, sub, tone = 'indigo', right }) {
  const tones = { indigo: 'bg-indigo-50 text-indigo-500', emerald: 'bg-emerald-50 text-emerald-500', amber: 'bg-amber-50 text-amber-500', sky: 'bg-sky-50 text-sky-500', violet: 'bg-violet-50 text-violet-500', red: 'bg-red-50 text-red-500' };
  return (
    <div className="ai-glass-card rounded p-3.5 flex items-center gap-3 min-w-0">
      <span className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${tones[tone]}`}><Icon size={17} /></span>
      <div className="min-w-0 flex-1"><div className="text-11.5 font-semibold  tracking-wide text-slate-400 truncate">{label}</div><div className="text-22 leading-tight font-bold text-slate-900 tabular-nums">{value ?? '—'}</div>{sub && <div className="text-11.5 text-slate-500 truncate" title={sub}>{sub}</div>}</div>
      {right}
    </div>
  );
}

/** A heading cell. With an `id` (and the sort state from useSorted) it sorts when pressed. */
export const Th = ({ children, c = 'text-left', cls = '', id, sort, onSort, first }) => (id
  ? <SortTh id={id} sort={sort} onSort={onSort} first={first} right={c === 'text-right'} className={`px-4 py-2.5 whitespace-nowrap ${c === 'text-center' ? 'text-center' : ''} ${cls}`}>{children}</SortTh>
  : <th className={`px-4 py-2.5 font-semibold whitespace-nowrap ${c} ${cls}`}>{children}</th>);
/** The search row above a table. */
const ExportBtn = ({ onClick, disabled, className = '' }) => <button type="button" onClick={onClick} disabled={disabled} className={`h-8 px-3 inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white text-12.5 font-semibold text-slate-700 cursor-pointer hover:bg-slate-50 disabled:opacity-40 ${className}`} title="Download every row of this table (all pages, with the search applied) as a CSV file"><Download size={13} />Export CSV</button>;
const SearchBar = ({ q, setQ, placeholder, search = true, onExport }) => <div className="px-4 py-2 border-b border-slate-100 flex flex-wrap items-center gap-2">{search && <input value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="h-8 w-60 px-2 text-13 rounded-md border border-slate-200 bg-white focus:border-indigo-400 outline-none" />}{onExport && <ExportBtn onClick={onExport} className="ml-auto" />}</div>;
const Table = ({ head, children, max = 'max-h-[calc(100vh-360px)]', pager = null, bar = null }) => (
  <>
    {bar}
    <div className={`overflow-auto ${max} min-h-[160px]`}>
      <table className="w-full text-13"><thead className="sticky top-0 z-10 bg-slate-50 text-11.5  tracking-wide text-slate-500 shadow-[0_1px_0_0_theme(colors.slate.200)]"><tr>{head}</tr></thead><tbody className="divide-y divide-slate-100">{children}</tbody></table>
    </div>
    {pager && <Pager p={pager} label="rows" />}
  </>
);

const Delta = ({ now, before }) => {
  if (!now || !before || now === before) return before && now ? <span className="text-11.5 text-slate-400">–</span> : null;
  const d = before - now; // lower position = better
  return <span className={`inline-flex items-center gap-0.5 text-11.5 font-semibold ${d > 0 ? 'text-emerald-600' : 'text-red-500'}`}>{d > 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}{Math.abs(d)}</span>;
};

const Empty = ({ icon: Icon = Lightbulb, title, children, action }) => (
  <Card><div className="py-10 text-center max-w-lg mx-auto"><span className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3"><Icon size={22} /></span>
    <div className="text-15 font-semibold text-slate-900">{title}</div><p className="text-13 text-slate-500 mt-1">{children}</p>{action && <div className="mt-4">{action}</div>}</div></Card>
);

/** The latest competitor research of the project (Google Places and Search Console), shared by Keyword Gap and Compare Domains. */
function useResearch(b, given = null) {
  const d = useApi(given ? null : `/businesses/${b.id}/competitor-research`); // inside Competitor Research the result is handed over: no second request
  if (given) return { loading: false, error: null, result: given, running: false };
  const run = d.data?.run;
  const done = run?.status === 'done' ? run : d.data?.last_done;
  return { loading: !d.data && !d.error, error: d.error, result: done?.result || null, running: run && run.status !== 'done' && run.status !== 'failed' };
}

const NeedResearch = ({ path, what }) => (
  <Empty icon={Swords} title="Run the competitor research first" action={<Link to={path('competitor-finder')} className="h-9 px-4 rounded inline-flex items-center text-13 font-semibold bg-indigo-500 text-white hover:bg-indigo-600">Open Competitor Research</Link>}>
    {what} comes from the competitor research: it reads who ranks on Google for your keywords and what their sites do.
  </Empty>
);

/* ── Organic Rankings ──────────────────────────────────────────────────── */

const TRACK_VAL = (k, key) => (key === 'kw' ? k.keyword : key === 'rank' ? k.rank : key === 'vol' ? k.volume : key === 'intent' ? k.intent : key === 'page' ? k.target_url : key === 'checked' ? k.rank_checked_at : undefined);

export function TrackedPositions({ b }) {
  const kw = useApi(`/businesses/${b.id}/keywords`);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [urls, setUrls] = useState({});
  const rows = (kw.data?.keywords || []).filter(k => k.tracked);
  const shown = rows.filter(k => (filter === 'all' || (filter === 'top3' ? k.rank && k.rank <= 3 : filter === 'top10' ? k.rank && k.rank <= 10 : filter === 'ranking' ? k.rank : !k.rank)) && (!q || k.keyword.includes(q.toLowerCase())))
    .sort((a, c) => (a.rank || 999) - (c.rank || 999));
  const { sorted, sort, onSort } = useSorted(shown, TRACK_VAL);
  const pager = usePager(sorted, { size: 25, resetKey: `${filter}|${q}|${sort?.key}|${sort?.dir}` });
  const ranked = rows.filter(k => k.rank);
  const improved = ranked.filter(k => k.prev_rank && k.rank < k.prev_rank).length;
  const dropped = ranked.filter(k => k.prev_rank && k.rank > k.prev_rank).length;
  const check = () => run('check', async () => {
    const r = await api(`/businesses/${b.id}/seo/check-ranks`, { method: 'POST', body: {} });
    setUrls(Object.fromEntries(r.results.filter(x => x.url).map(x => [x.keyword, x.url])));
    kw.reload(true);
    toast(`Read ${r.checked} keyword${r.checked === 1 ? '' : 's'} from Google Search Console`);
  });
  const chip = (id, label, n) => <button key={id} type="button" onClick={() => setFilter(id)} className={`h-8 px-3 rounded text-12 font-semibold cursor-pointer ${filter === id ? 'bg-indigo-500 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}>{label} <span className="opacity-70">{n}</span></button>;
  if (!kw.data) return kw.error ? <ErrorNote>{kw.error.message}</ErrorNote> : <div className="space-y-4"><SkStats cols="grid-cols-2 xl:grid-cols-4" labels={["Tracked keywords", "Top 3", "Improved", "Dropped"]} /><SkCard title="Tracked keywords" pad={false}><SkTable headers={["Keyword", "Volume", "Position", "Change", "Page"]} rows={8} bare /></SkCard></div>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Tile icon={KeyRound} label="Tracked keywords" value={rows.length} sub={`${ranked.length} in Google's top 20`} />
        <Tile icon={Trophy} tone="emerald" label="Top 3" value={ranked.filter(k => k.rank <= 3).length} sub={`${ranked.filter(k => k.rank <= 10).length} in the top 10`} />
        <Tile icon={TrendingUp} tone="sky" label="Improved" value={improved} sub="vs the check before" />
        <Tile icon={ArrowDown} tone="red" label="Dropped" value={dropped} sub="vs the check before" />
      </div>
      <Card pad={false}>
        <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
          {chip('all', 'All', rows.length)}{chip('top3', 'Top 3', ranked.filter(k => k.rank <= 3).length)}{chip('top10', 'Top 10', ranked.filter(k => k.rank <= 10).length)}{chip('ranking', 'Ranking', ranked.length)}{chip('none', 'Not ranking', rows.length - ranked.length)}
          <label className="relative ml-auto"><Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search keywords" className="h-8 pl-8 pr-3 text-13 rounded border border-slate-200 bg-white focus:border-indigo-400 outline-none" /></label>
          <ExportBtn disabled={!sorted.length} onClick={() => downloadCsv(`tracked-keyword-positions-${b.name}`, ['Keyword', 'Position', 'Previous position', 'Searches per month', 'Intent', 'Ranking page', 'Checked'], sorted.map(k => [k.keyword, k.rank ?? '', k.prev_rank ?? '', k.volume ?? '', k.intent || '', urls[k.keyword] || k.target_url || '', k.rank_checked_at || '']))} />
          <Button size="sm" variant="primary" icon={RefreshCw} busy={busy === 'check'} disabled={!rows.length} onClick={check}>Check positions now</Button>
        </div>
        {error && <div className="px-5 pt-3"><ErrorNote>{error}</ErrorNote></div>}
        {!rows.length ? <p className="px-6 py-12 text-center text-13 text-slate-500">No tracked keywords yet. Add some in <Link to="/keyword-management" className="text-indigo-600 font-semibold hover:underline">Keyword Magic Tool</Link>.</p> : (
          <Table pager={pager} head={<><Th id="kw" sort={sort} onSort={onSort}>Keyword</Th><Th id="rank" sort={sort} onSort={onSort} c="text-right">Position</Th><Th id="vol" sort={sort} onSort={onSort} first="desc" c="text-right">Volume</Th><Th id="intent" sort={sort} onSort={onSort}>Intent</Th><Th id="page" sort={sort} onSort={onSort}>Ranking page</Th><Th id="checked" sort={sort} onSort={onSort} first="desc">Checked</Th></>}>
            {pager.rows.map(k => (
              <tr key={k.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 font-semibold text-slate-900">{k.keyword}</td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap"><Pos value={k.rank} /> <Delta now={k.rank} before={k.prev_rank} /></td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{k.volume != null ? fmt(k.volume) : '—'}</td>
                <td className="px-4 py-2.5"><Badge tone="gray">{k.intent || '—'}</Badge></td>
                <td className="px-4 py-2.5 max-w-[260px] truncate">{(urls[k.keyword] || k.target_url) ? <a href={urls[k.keyword] || k.target_url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline" title={urls[k.keyword] || k.target_url}>{(urls[k.keyword] || k.target_url).replace(/^https?:\/\/[^/]+/, '') || '/'}</a> : <span className="text-slate-400">—</span>}</td>
                <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{k.rank_checked_at || 'Never'}</td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-500">No keyword matches.</td></tr>}
          </Table>
        )}
      </Card>
      <p className="text-11.5 text-slate-400">Positions are Google Search Console's average position over the last 28 days. A keyword with no impressions shows as not ranking yet. Search volume comes from the Google Ads Keyword Planner.</p>
      {toastNode}
    </div>
  );
}

/* ── Keyword Gap ───────────────────────────────────────────────────────── */

const UNT_VAL = (k) => k;

function UntappedTable({ list, busy, track, name }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const kept = useMemo(() => (needle ? list.filter(k => k.toLowerCase().includes(needle)) : list), [list, needle]);
  const { sorted, sort, onSort } = useSorted(kept, UNT_VAL);
  const pager = usePager(sorted, { size: 25, resetKey: `${needle}|${sort?.key}|${sort?.dir}` });
  return (
    <Table pager={pager} bar={list.length > 0 ? <SearchBar q={q} setQ={setQ} placeholder="Search keywords" search={list.length > 10} onExport={() => downloadCsv(name, ['Keyword competitors’ pages target'], sorted.map(k => [k]))} /> : null} head={<><Th id="kw" sort={sort} onSort={onSort}>Keyword competitors’ pages target</Th><Th c="text-right"> </Th></>}>
      {pager.rows.map(kwd => <tr key={kwd} className="hover:bg-slate-50"><td className="px-4 py-2.5 font-semibold text-slate-900">{kwd}</td><td className="px-4 py-2.5 text-right"><Button size="sm" icon={Plus} busy={busy === `t${kwd}`} onClick={() => track(kwd)}>Track</Button></td></tr>)}
      {!pager.rows.length && <tr><td colSpan={2} className="px-5 py-10 text-center text-slate-500">{list.length ? 'No keyword matches.' : 'Nothing untapped.'}</td></tr>}
    </Table>
  );
}

const GAP_VAL = (x, k) => (k === 'kw' ? x.keyword : k === 'you' ? x.you : k === 'best' ? x.best : k.startsWith('c:') ? x.them[Number(k.slice(2))] : undefined);

function GapTable({ list, comps, busy, track, name }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const kept = useMemo(() => (needle ? list.filter(x => x.keyword.toLowerCase().includes(needle)) : list), [list, needle]);
  const { sorted, sort, onSort } = useSorted(kept, GAP_VAL);
  const pager = usePager(sorted, { size: 25, resetKey: `${needle}|${sort?.key}|${sort?.dir}` });
  return (
    <Table pager={pager} bar={list.length > 0 ? <SearchBar q={q} setQ={setQ} placeholder="Search keywords" search={list.length > 10} onExport={() => downloadCsv(name, ['Keyword', 'Your position', ...comps.map(c => `${c.domain} position`), 'Best competitor position'], sorted.map(x => [x.keyword, x.you ?? '', ...x.them.map(p => p ?? ''), x.best ?? '']))} /> : null} head={<><Th id="kw" sort={sort} onSort={onSort}>Keyword</Th><Th id="you" sort={sort} onSort={onSort} c="text-center">You</Th>{comps.map((c, i) => <Th key={c.domain} id={`c:${i}`} sort={sort} onSort={onSort} c="text-center" cls="normal-case max-w-[130px] truncate">{c.domain}</Th>)}<Th id="best" sort={sort} onSort={onSort} c="text-right">Best competitor</Th><Th c="text-right"> </Th></>}>
      {pager.rows.map(x => (
        <tr key={x.keyword} className="hover:bg-slate-50">
          <td className="px-4 py-2.5 font-semibold text-slate-900">{x.keyword}</td>
          <td className="px-4 py-2.5 text-center"><Pos value={x.you} /></td>
          {x.them.map((p, i) => <td key={i} className="px-4 py-2.5 text-center"><Pos value={p} /></td>)}
          <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{x.best ? `#${x.best}` : '—'}</td>
          <td className="px-4 py-2.5 text-right"><Button size="sm" icon={Plus} busy={busy === `t${x.keyword}`} onClick={() => track(x.keyword)}>Track</Button></td>
        </tr>
      ))}
      {!pager.rows.length && <tr><td colSpan={comps.length + 4} className="px-5 py-10 text-center text-slate-500">{list.length ? 'No keyword matches.' : 'Nothing in this group.'}</td></tr>}
    </Table>
  );
}

export function KeywordGap({ b, result = null }) {
  const path = useModulePath();
  const r = useResearch(b, result);
  const [tab, setTab] = useState('missing');
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const model = useMemo(() => {
    if (!r.result) return null;
    const comps = (r.result.local_competitors || []).filter(d => d.name).slice(0, 4).map(d => ({ ...d, domain: d.domain || d.name })); // the businesses Google Maps shows for these searches
    const rows = r.result.keywords.map(k => {
      const you = (r.result.you.local || {})[k] || null; // the business's place in Google Maps for this search
      const them = comps.map(c => (c.positions || {})[k] || null);
      const best = Math.min(...them.filter(Boolean), Infinity);
      const state = !Number.isFinite(best) ? (you ? 'unique' : 'none') : !you ? 'missing' : you > best ? 'weak' : you < best ? 'strong' : 'shared';
      return { keyword: k, you, them, best: Number.isFinite(best) ? best : null, state };
    });
    return { comps, rows, untapped: r.result.ideas.competitor_keywords.filter(k => !r.result.keywords.includes(k)) };
  }, [r.result]);
  if (r.loading) return <div className="space-y-4"><div className="flex gap-2">{[0, 1, 2].map(i => <Sk key={i} w="w-32" h="h-9" />)}</div><SkCard title="Keyword gap" subtitle="Keywords competitors' pages target that you don't" pad={false}><SkTable headers={["Keyword", "You", "Competitor", "Best competitor"]} rows={8} bare /></SkCard></div>;
  if (!model) return <NeedResearch path={path} what="The keyword gap" />;
  const count = (s) => model.rows.filter(x => x.state === s).length;
  const tabs = [['missing', 'Missing', count('missing'), 'Competitors rank, you don’t'], ['weak', 'Weak', count('weak'), 'You rank below a competitor'], ['strong', 'Strong', count('strong'), 'You rank above every competitor'], ['shared', 'Shared', count('shared'), 'Same position'], ['untapped', 'Untapped', model.untapped.length, 'Keywords competitors’ pages target that you don’t track']];
  const list = model.rows.filter(x => x.state === tab);
  const track = (kwd) => run(`t${kwd}`, async () => { await api(`/businesses/${b.id}/keywords`, { method: 'POST', body: [{ keyword: kwd }] }); toast(`“${kwd}” added to tracking`); });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {tabs.map(([id, label, n, hint]) => <button key={id} type="button" title={hint} onClick={() => setTab(id)} className={`h-9 px-4 rounded text-13 font-semibold cursor-pointer inline-flex items-center gap-2 ${tab === id ? 'bg-indigo-500 text-white' : 'bg-white text-slate-600 shadow-card hover:bg-slate-50'}`}>{label}<span className={`px-1.5 rounded text-11.5 ${tab === id ? 'bg-white/20' : 'bg-slate-100'}`}>{n}</span></button>)}
        <span className="ml-auto text-12 text-slate-400 self-center">Researched {fmtDateTime(r.result.analysed_at)}</span>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Card pad={false}>
        {tab === 'untapped' ? (
          <UntappedTable list={model.untapped} busy={busy} track={track} name={`keyword-gap-untapped-${b.name}`} />
        ) : (
          <GapTable key={tab} list={list} comps={model.comps} busy={busy} track={track} name={`keyword-gap-${tab}-${b.name}`} />
        )}
      </Card>
      <p className="text-11.5 text-slate-400">Positions are the places in Google Maps for each researched search (Google Places API). Google gives no data on other websites' organic rankings. Search volume is in Find Keywords.</p>
      {toastNode}
    </div>
  );
}

/* ── Compare Domains ───────────────────────────────────────────────────── */

export function CompareDomains({ b, result = null }) {
  const path = useModulePath();
  const r = useResearch(b, result);
  if (r.loading) return <SkCard title="Side by side" subtitle="The best figure in each row is highlighted" pad={false}><SkTable headers={["Measure", "You", "Competitor 1", "Competitor 2", "Competitor 3"]} rows={6} bare /></SkCard>;
  if (!r.result) return <NeedResearch path={path} what="The comparison" />;
  const x = r.result;
  const comps = x.profiles.slice(0, 4);
  const you = { domain: x.business.domain || 'You', mine: true, visibility: x.summary.visibility, ranked: x.summary.keywords_ranked, top3: x.summary.keywords_top3, local: { best: Math.min(...Object.values(x.you.local), Infinity), rating: x.business.rating, reviews: x.business.reviews }, site: x.you.site, sources: x.you.link_sources, back: x.you.backlinks };
  const cols = [you, ...comps.map(p => ({ domain: p.domain, visibility: p.visibility, ranked: Object.keys(p.positions).length, top3: Object.values(p.positions).filter(v => v <= 3).length, local: p.local, site: p.site, sources: p.link_sources, back: p.backlinks }))];
  const rows = [
    ['Google visibility', c => c.visibility, v => `${v}%`, 'high'], ['Keywords on page 1', c => c.ranked, v => `${v}/${x.keywords.length}`, 'high'], ['Keywords in the top 3', c => c.top3, v => v, 'high'],
    ['Best Maps position', c => (c.local?.best && Number.isFinite(c.local.best) ? c.local.best : null), v => `#${v}`, 'low'], ['Google rating', c => c.local?.rating ?? null, v => `${Number(v).toFixed(1)}★`, 'high'], ['Reviews', c => c.local?.reviews ?? null, v => fmt(v), 'high'],
    ['Words per page', c => (c.site?.scanned ? c.site.avg_words : null), v => fmt(v), 'high'], ['Service pages', c => (c.site?.scanned ? (c.site.services || []).length : null), v => v, 'high'], ['Area pages', c => (c.site?.scanned ? (c.site.location_pages || []).length : null), v => v, 'high'],
    ['Has a blog', c => (c.site?.scanned ? (c.site.blog ? 1 : 0) : null), v => (v ? 'Yes' : 'No'), 'high'], ['Schema types', c => (c.site?.scanned ? (c.site.schema || []).length : null), v => v, 'high'], ['Listed on (sites)', c => (c.sources ? c.sources.length : null), v => v, 'high'],
    ['Backlinks', c => c.back?.backlinks ?? null, v => fmt(v), 'high'], ['Referring domains', c => c.back?.referring_domains ?? null, v => fmt(v), 'high']
  ].filter(([, get]) => cols.some(c => get(c) != null));
  const top = Math.max(1, ...cols.map(c => c.visibility));
  return (
    <div className="space-y-4">
      <Card title="Google visibility" subtitle="Expected share of clicks from your researched keywords" action={<span className="text-12 text-slate-400">Researched {fmtDateTime(x.analysed_at)}</span>}>
        <ul className="space-y-2">{cols.map(c => <li key={c.domain} className="grid grid-cols-[minmax(0,180px)_1fr_48px] items-center gap-3"><span className={`text-13 truncate ${c.mine ? 'font-bold text-emerald-700' : 'text-slate-700'}`}>{c.domain}{c.mine ? ' (you)' : ''}</span><span className="h-2.5 rounded-full bg-slate-100 overflow-hidden"><span className={`block h-full rounded-full ${c.mine ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${Math.max(c.visibility > 0 ? 2 : 0, (c.visibility / top) * 100)}%` }} /></span><span className="text-right text-12.5 font-semibold tabular-nums">{c.visibility}%</span></li>)}</ul>
      </Card>
      <Card pad={false} title="Side by side" subtitle="The best figure in each row is highlighted" action={<ExportBtn onClick={() => downloadCsv(`compare-domains-${b.name}`, ['Metric', ...cols.map(c => `${c.domain}${c.mine ? ' (you)' : ''}`)], rows.map(([label, get]) => [label, ...cols.map(c => { const v = get(c); return v == null ? '' : label === 'Has a blog' ? (v ? 'Yes' : 'No') : v; })]))} />}>
        <div className="overflow-x-auto"><table className="w-full text-13 min-w-[640px]">
          <thead className="bg-slate-50 text-11.5  tracking-wide text-slate-500"><tr><Th>Metric</Th>{cols.map(c => <Th key={c.domain} c="text-right" cls={`normal-case ${c.mine ? 'text-emerald-700' : ''}`}>{c.domain}{c.mine ? ' (you)' : ''}</Th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map(([label, get, fmtv, better]) => {
            const vals = cols.map(get);
            const nums = vals.filter(v => v != null);
            const best = nums.length ? (better === 'low' ? Math.min(...nums) : Math.max(...nums)) : null;
            return <tr key={label} className="hover:bg-slate-50"><td className="px-4 py-2.5 text-slate-600">{label}</td>{vals.map((v, i) => <td key={i} className={`px-4 py-2.5 text-right tabular-nums ${v != null && v === best ? 'font-bold text-emerald-700 bg-emerald-50/60' : 'text-slate-900'}`}>{v == null ? <Minus size={12} className="inline text-slate-300" /> : fmtv(v)}</td>)}</tr>;
          })}</tbody></table></div>
      </Card>
      <p className="text-11.5 text-slate-400">From the latest competitor research. A dash means that figure wasn't available for the site (for example, full backlink totals: Google has no API for them).</p>
    </div>
  );
}

/* ── Keyword Overview ──────────────────────────────────────────────────── */

const COMP_TONE = { LOW: 'text-emerald-700 bg-emerald-50', MEDIUM: 'text-amber-700 bg-amber-50', HIGH: 'text-red-700 bg-red-50' };
const money = (v) => (v == null ? '—' : Number(v).toFixed(2));
const pct = (v) => (v == null ? null : `${v > 0 ? '+' : ''}${Number(v).toFixed(0)}%`);

const IDEA_VAL = (i, k) => (k === 'kw' ? i.keyword : k === 'vol' ? i.volume : k === 'comp' ? ({ LOW: 1, MEDIUM: 2, HIGH: 3 })[i.competition] : k === 'cpc' ? i.cpc : undefined);

function IdeasTable({ ideas, go, busy, track, isTracked, name }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const kept = useMemo(() => (needle ? ideas.filter(i => i.keyword.toLowerCase().includes(needle)) : ideas), [ideas, needle]);
  const { sorted, sort, onSort } = useSorted(kept, IDEA_VAL);
  const pager = usePager(sorted, { size: 25, resetKey: `${needle}|${sort?.key}|${sort?.dir}` });
  return (
    <Table pager={pager} bar={ideas.length > 0 ? <SearchBar q={q} setQ={setQ} placeholder="Search ideas" search={ideas.length > 10} onExport={() => downloadCsv(name, ['Keyword', 'Searches per month', 'Competition', 'Top-of-page bid', 'Tracked'], sorted.map(i => [i.keyword, i.volume ?? '', i.competition && i.competition !== 'UNSPECIFIED' ? i.competition.toLowerCase() : '', i.cpc ?? '', isTracked(i.keyword) ? 'Yes' : 'No']))} /> : null} head={<><Th id="kw" sort={sort} onSort={onSort}>Keyword</Th><Th id="vol" sort={sort} onSort={onSort} first="desc" c="text-right">Searches / month</Th><Th id="comp" sort={sort} onSort={onSort}>Competition</Th><Th id="cpc" sort={sort} onSort={onSort} first="desc" c="text-right">Top-of-page bid</Th><Th c="text-right"> </Th></>}>
      {pager.rows.map(i => (
        <tr key={i.keyword} className="hover:bg-slate-50">
          <td className="px-4 py-2.5"><button type="button" onClick={() => go(i.keyword)} className="font-semibold text-slate-900 hover:text-indigo-600 text-left cursor-pointer" title="Analyze this keyword">{i.keyword}</button></td>
          <td className="px-4 py-2.5 text-right tabular-nums">{i.volume != null ? fmt(i.volume) : '—'}</td>
          <td className="px-4 py-2.5">{i.competition && i.competition !== 'UNSPECIFIED' ? <span className={`rounded-full px-2 py-0.5 text-12 font-semibold ${COMP_TONE[i.competition] || 'bg-slate-100 text-slate-600'}`}>{i.competition.toLowerCase()}</span> : <span className="text-slate-400">—</span>}</td>
          <td className="px-4 py-2.5 text-right tabular-nums">{money(i.cpc)}</td>
          <td className="px-4 py-2.5 text-right">{isTracked(i.keyword) ? <Badge tone="green">Tracked</Badge> : <Button size="sm" icon={Plus} busy={busy === `t${i.keyword}`} onClick={() => track(i.keyword)}>Track</Button>}</td>
        </tr>
      ))}
    </Table>
  );
}

const kfmt = (n) => (n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K` : Number(n).toLocaleString('en-US'));
const INR = (v) => (v == null ? '—' : `₹${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
const INTENTS = ['informational', 'navigational', 'commercial', 'transactional', 'local'];
const intentChips = (intent) => INTENTS.map(k => ({ k: k[0].toUpperCase() + k.slice(1), on: k === String(intent || '').toLowerCase() }));
const difficultyText = (v) => (v == null ? '' : v < 15 ? 'Very easy to rank for. Good on-page SEO and a little content should be enough.' : v < 30 ? 'A fairly easy keyword. Strong content and a few quality links can rank.' : v < 50 ? 'Moderately competitive. Expect solid content and steady link building.' : v < 70 ? 'A competitive keyword. It takes strong content and consistent link building.' : 'The hardest keyword to compete for. It will take a lot of on-page SEO, link building and content promotion.');
const difficultyWord = (v) => (v == null ? 'No data' : v < 15 ? 'Very easy' : v < 30 ? 'Easy' : v < 50 ? 'Medium' : v < 70 ? 'Challenging' : 'Very hard');
const diffColor = (v) => (v == null ? '#94a3b8' : v < 15 ? '#059669' : v < 30 ? '#65a30d' : v < 50 ? '#d97706' : v < 70 ? '#ea580c' : '#dc2626'); // very easy, easy, medium, challenging, very hard
function DiffChip({ v, word }) {
  const c = diffColor(v);
  return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-12 font-semibold tabular-nums" style={{ color: c, backgroundColor: `${c}1f`, boxShadow: `inset 0 0 0 1px ${c}55` }} title={v == null ? 'No figure' : `${v} out of 100: ${difficultyWord(v)}`}>{word ? difficultyWord(v) : (v ?? '—')}</span>;
}

/** A tooltip that opens on hover or keyboard focus around anything. */
function Tip({ tip, children, className = '', below = false }) {
  return (
    <div className={`group relative ${className}`} tabIndex={tip ? 0 : undefined}>
      {children}
      {tip && <div role="tooltip" className={`pointer-events-none absolute z-30 left-1/2 -translate-x-1/2 ${below ? 'top-full mt-1.5' : 'bottom-full mb-1.5'} hidden group-hover:block group-focus:block rounded-md bg-slate-900 px-2.5 py-1.5 text-11.5 leading-snug text-white shadow-lg whitespace-nowrap`}>{tip}</div>}
    </div>
  );
}

function Gauge180({ value, note, tip }) {
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  const r = 60, cx = 80, cy = 74, ang = Math.PI * (1 - v / 100);
  const pt = (a) => `${(cx + r * Math.cos(a)).toFixed(1)} ${(cy - r * Math.sin(a)).toFixed(1)}`;
  return (
    <div className="flex flex-col items-center" role="img" aria-label={`Difficulty ${value ?? 'not available'} of 100, ${difficultyWord(value)}`}>
      <Tip tip={tip} below>
      <svg viewBox="0 0 160 84" className="w-48">
        <path d={`M ${pt(Math.PI)} A ${r} ${r} 0 0 1 ${pt(0)}`} fill="none" stroke="#e2e8f0" strokeWidth="12" strokeLinecap="round" />
        {value != null && v > 0 && <path d={`M ${pt(Math.PI)} A ${r} ${r} 0 0 1 ${pt(ang)}`} fill="none" stroke={diffColor(value)} strokeWidth="12" strokeLinecap="round" />}
        <text x={cx} y={cy - 6} textAnchor="middle" style={{ fontSize: 26, fontWeight: 700, fill: diffColor(value) }}>{value ?? '—'}</text>
      </svg>
      </Tip>
      <DiffChip v={value} word />
      <p className="text-11.5 text-slate-500 mt-2 text-center">{note || 'From Google Ads: how many advertisers bid on it. It is not the SEO difficulty of page one.'}</p>
    </div>
  );
}

function Bar({ label, value, max, text, tip }) {
  return (
    <Tip tip={tip} className="rounded hover:bg-slate-50">
      <div className="flex items-center gap-2 text-12.5"><span className="w-28 truncate text-slate-700">{label}</span>
        <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-indigo-400 group-hover:bg-indigo-600 transition-colors" style={{ width: `${Math.max(3, ((value || 0) / (max || 1)) * 100)}%` }} /></div>
        <span className="w-24 text-right tabular-nums text-slate-700">{text}</span></div>
    </Tip>
  );
}

/** The colour of a keyword difficulty (KD %): green when it is easy, red when it is very hard. */
function KdDot({ v }) {
  if (v === undefined || v === 'loading') return <span className="inline-flex items-center gap-1 text-slate-400" title="Reading the top 10 on Google for this keyword"><Loader2 size={12} className="animate-spin" /></span>;
  if (v == null) return <span className="text-slate-300" title="Google's results could not be read for it">—</span>;
  return <span className="inline-flex items-center justify-end gap-1.5 tabular-nums" title={`${v} out of 100: ${difficultyWord(v)}`}>{v}<span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: diffColor(v) }} /></span>;
}

const MoreBtn = ({ onClick }) => <button type="button" onClick={onClick} className="shrink-0 inline-flex items-center gap-0.5 text-12.5 font-semibold text-indigo-700 hover:text-indigo-900 hover:underline cursor-pointer">Show more<ChevronRight size={14} /></button>;

const INTENT_LETTER = { informational: ['I', '#4338ca', '#e0e7ff'], commercial: ['C', '#b45309', '#fef3c7'], transactional: ['T', '#047857', '#d1fae5'], navigational: ['N', '#7e22ce', '#f3e8ff'], local: ['L', '#0369a1', '#e0f2fe'] };
const QUESTION_START = /^(what|how|why|when|where|which|who|can|does|do|is|are|should|will)\b/;
const NOISE_WORDS = new Set(['a', 'an', 'the', 'and', 'for', 'to', 'of', 'in', 'on', 'at', 'with', 'is', 'are', 'my', 'me', 'you', 'your', 'how', 'what', 'near']);

/** Every idea Google gave, explored like the Keyword Magic Tool: questions or all, broad / phrase / exact / related match, filters, the words the ideas share (by number or by searches), totals, and the difficulty of any keyword on request. */
function IdeasExplorer({ data, preset, kdMap, askKd, go, toWorkspace, adding }) {
  const seed = data.keyword;
  const seedWords = useMemo(() => seed.split(/\s+/).filter(Boolean), [seed]);
  const everything = useMemo(() => { const m = new Map(); for (const k of ['similar', 'related', 'questions']) for (const r of data.groups?.[k]?.all || []) if (!m.has(r.keyword)) m.set(r.keyword, r); return [...m.values()]; }, [data]);
  const [type, setType] = useState(preset === 'questions' ? 'questions' : 'all');
  const [match, setMatch] = useState(preset === 'related' ? 'related' : preset === 'similar' ? 'broad' : 'all');
  const [minVol, setMinVol] = useState('');
  const [idx, setIdx] = useState('');
  const [intent, setIntent] = useState('');
  const [minCpc, setMinCpc] = useState('');
  const [inc, setInc] = useState('');
  const [exc, setExc] = useState('');
  const [word, setWord] = useState('');
  const [wordBy, setWordBy] = useState('number');
  const hasAll = (k) => seedWords.every(w => k.split(/\s+/).includes(w));
  const matches = (k) => (match === 'all' ? true : match === 'broad' ? hasAll(k) : match === 'phrase' ? k.includes(seed) : match === 'exact' ? k === seed : !hasAll(k));
  const base = useMemo(() => everything.filter(r => (type === 'all' || QUESTION_START.test(r.keyword)) && matches(r.keyword)), [everything, type, match]); // eslint-disable-line react-hooks/exhaustive-deps
  const words = useMemo(() => {
    const m = {};
    for (const r of base) for (const w of new Set(r.keyword.split(/\s+/))) if (w.length > 2 && !seedWords.includes(w) && !NOISE_WORDS.has(w)) { const x = (m[w] ||= { w, n: 0, v: 0 }); x.n += 1; x.v += r.volume || 0; }
    return Object.values(m).sort((a, c) => (wordBy === 'number' ? c.n - a.n : c.v - a.v)).slice(0, 40);
  }, [base, seedWords, wordBy]);
  const rows = useMemo(() => base.filter(r => (!minVol || (r.volume || 0) >= Number(minVol)) && (!idx || (r.index != null && (idx === 'low' ? r.index < 34 : idx === 'medium' ? r.index >= 34 && r.index < 67 : r.index >= 67)))
    && (!intent || r.intent === intent) && (!minCpc || (r.cpc || 0) >= Number(minCpc)) && (!word || r.keyword.split(/\s+/).includes(word))
    && (!inc.trim() || inc.toLowerCase().split(/[,\s]+/).filter(Boolean).every(w => r.keyword.includes(w))) && (!exc.trim() || !exc.toLowerCase().split(/[,\s]+/).filter(Boolean).some(w => r.keyword.includes(w)))), [base, minVol, idx, intent, minCpc, word, inc, exc]);
  const total = rows.reduce((a, r) => a + (r.volume || 0), 0);
  const avgIdx = (() => { const l = rows.filter(r => r.index != null); return l.length ? Math.round(l.reduce((a, r) => a + r.index, 0) / l.length) : null; })();
  const sel = 'h-8 rounded-lg ring-1 ring-inset ring-slate-300 bg-white px-2 text-12.5 text-slate-800';
  const tab = (on, label, set) => <button type="button" onClick={set} className={`px-3 h-8 text-12.5 font-medium cursor-pointer border ${on ? 'bg-indigo-50 text-indigo-800 border-indigo-300' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>{label}</button>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <div className="inline-flex rounded-lg overflow-hidden">{tab(type === 'all', 'All', () => setType('all'))}{tab(type === 'questions', 'Questions', () => setType('questions'))}</div>
        <div className="inline-flex rounded-lg overflow-hidden">{[['all', 'All keywords'], ['broad', 'Broad match'], ['phrase', 'Phrase match'], ['exact', 'Exact match'], ['related', 'Related']].map(([k, l]) => <React.Fragment key={k}>{tab(match === k, l, () => setMatch(k))}</React.Fragment>)}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select className={sel} value={minVol} onChange={e => setMinVol(e.target.value)} aria-label="Volume"><option value="">Volume: any</option><option value="100">100+</option><option value="500">500+</option><option value="1000">1,000+</option><option value="5000">5,000+</option><option value="10000">10,000+</option></select>
        <select className={sel} value={idx} onChange={e => setIdx(e.target.value)} aria-label="Competition index"><option value="">Index: any</option><option value="low">Low (under 34)</option><option value="medium">Medium (34 to 66)</option><option value="high">High (67+)</option></select>
        <select className={sel} value={intent} onChange={e => setIntent(e.target.value)} aria-label="Intent"><option value="">Intent: any</option>{Object.keys(INTENT_LETTER).map(k => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}</select>
        <select className={sel} value={minCpc} onChange={e => setMinCpc(e.target.value)} aria-label="Cost per click"><option value="">CPC: any</option><option value="10">₹10+</option><option value="50">₹50+</option><option value="100">₹100+</option><option value="300">₹300+</option></select>
        <input className={`${sel} w-44`} value={inc} onChange={e => setInc(e.target.value)} placeholder="Include keywords" aria-label="Include keywords" />
        <input className={`${sel} w-44`} value={exc} onChange={e => setExc(e.target.value)} placeholder="Exclude keywords" aria-label="Exclude keywords" />
        {(minVol || idx || intent || minCpc || inc || exc || word) && <button type="button" onClick={() => { setMinVol(''); setIdx(''); setIntent(''); setMinCpc(''); setInc(''); setExc(''); setWord(''); }} className="text-12.5 font-semibold text-indigo-700 hover:underline cursor-pointer">Clear filters</button>}
        <Button size="sm" className="ml-auto" busy={adding} onClick={() => toWorkspace(rows.slice(0, 500).map(r => ({ keyword: r.keyword, volume: r.volume })))} disabled={!rows.length}>Add {Math.min(rows.length, 500)} to the Keyword Workspace</Button>
      </div>
      <div className="text-13 text-slate-600">All keywords: <b className="text-slate-900 tabular-nums">{fmt(rows.length)}</b> <span className="mx-1.5">Total volume: <b className="text-slate-900 tabular-nums">{fmt(total)}</b></span> <span>Average index: <b className="text-slate-900 tabular-nums">{avgIdx ?? '—'}</b></span></div>
      <div className="grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] gap-4">
        <div className="rounded-lg ring-1 ring-slate-200 p-3 self-start max-h-[420px] overflow-auto">
          <div className="flex gap-1 mb-2">{[['number', 'By number'], ['volume', 'By volume']].map(([k, l]) => <button key={k} type="button" onClick={() => setWordBy(k)} className={`px-2.5 h-7 rounded-md text-12 font-medium cursor-pointer ${wordBy === k ? 'bg-indigo-50 text-indigo-800 ring-1 ring-indigo-300' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}</div>
          <div className="flex justify-between text-11.5 text-slate-500 mb-1"><span>All keywords</span><b className="text-slate-900 tabular-nums">{fmt(base.length)}</b></div>
          {words.length === 0 ? <p className="text-12 text-slate-400">No shared words.</p> : <ul className="space-y-0.5">{words.map(x => (
            <li key={x.w}><button type="button" onClick={() => setWord(word === x.w ? '' : x.w)} className={`w-full flex justify-between gap-2 px-1.5 py-1 rounded text-12.5 cursor-pointer ${word === x.w ? 'bg-indigo-50 text-indigo-800 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}><span className="truncate">{x.w}</span><span className="tabular-nums text-slate-500">{wordBy === 'number' ? fmt(x.n) : kfmt(x.v)}</span></button></li>))}</ul>}
        </div>
        <DataTable bare rows={rows} rowKey={r => r.keyword} pageSize={25} sizes={[25, 50, 100]} exportName={`keywords-${seed}`.toLowerCase().replace(/[^a-z0-9]+/g, '-')} label="keywords" headClass="bg-slate-100 text-slate-700" minWidth={560}
          columns={[
            { id: 'keyword', header: 'Keyword', value: r => r.keyword, className: 'px-3 py-2', cell: r => <button type="button" className="text-indigo-700 hover:underline cursor-pointer text-left" onClick={() => go(r.keyword)} title="Open its overview">{r.keyword}</button> },
            { id: 'intent', header: 'Intent', value: r => r.intent, className: 'px-3 py-2', cell: r => { const l = INTENT_LETTER[r.intent]; return l ? <span className="inline-flex w-5 h-5 items-center justify-center rounded text-11 font-bold" style={{ color: l[1], backgroundColor: l[2] }} title={r.intent}>{l[0]}</span> : '—'; } },
            { id: 'volume', header: 'Volume', right: true, first: 'desc', value: r => r.volume, className: 'px-3 py-2 text-right tabular-nums', cell: r => (r.volume != null ? fmt(r.volume) : '—') },
            { id: 'index', header: 'Index', right: true, value: r => r.index, className: 'px-3 py-2 text-right tabular-nums', cell: r => r.index ?? '—' },
            { id: 'kd', header: 'KD %', right: true, value: r => (typeof kdMap[r.keyword] === 'number' ? kdMap[r.keyword] : null), className: 'px-3 py-2 text-right', cell: r => (kdMap[r.keyword] === undefined ? <button type="button" onClick={() => askKd(r.keyword)} className="text-12 font-semibold text-indigo-700 hover:underline cursor-pointer" title="Read the top 10 on Google for this keyword and work out its difficulty">Check</button> : <KdDot v={kdMap[r.keyword]} />) },
            { id: 'cpc', header: 'CPC', right: true, value: r => r.cpc, className: 'px-3 py-2 text-right tabular-nums', cell: r => INR(r.cpc) },
          ]} />
      </div>
    </div>
  );
}

/** One list of ideas: how many Google has, their total searches a month, the top five with searches and difficulty, and a way to open them all. */
function IdeaPanel({ title, g, kdMap, go, onAll }) {
  const rows = g.rows.slice(0, 5);
  return (
    <div className="min-w-0">
      <div className="text-13 text-slate-600">{title}</div>
      <div className="flex flex-wrap items-baseline gap-x-2"><span className="text-24 font-semibold text-indigo-600 tabular-nums">{kfmt(g.total)}</span><span className="text-12.5 text-slate-600">Total volume: <b className="text-slate-900">{kfmt(g.volume)}</b></span></div>
      {rows.length === 0 ? <p className="mt-3 text-12.5 text-slate-500">None from Google.</p> : (
        <table className="mt-2 w-full text-12.5"><thead><tr className="text-left text-11.5 text-slate-500 border-b border-slate-200"><th className="py-1.5 font-medium">Keywords</th><th className="py-1.5 font-medium text-right">Volume</th><th className="py-1.5 pl-2 font-medium text-right" title="Keyword difficulty, 0 to 100, from the real top 10 on Google">KD %</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.keyword} className="border-b border-slate-100"><td className="py-2 pr-2"><button type="button" className="text-indigo-700 hover:underline cursor-pointer text-left" onClick={() => go(r.keyword)} title="Open its overview">{r.keyword}</button></td>
              <td className="py-2 text-right tabular-nums">{kfmt(r.v)}</td><td className="py-2 pl-2 text-right"><KdDot v={kdMap[r.keyword]} /></td></tr>))}</tbody></table>
      )}
      {g.total > rows.length && <button type="button" onClick={onAll} className="mt-3 rounded-lg ring-1 ring-inset ring-slate-300 px-3 py-1.5 text-12.5 font-medium text-slate-700 hover:bg-slate-50 cursor-pointer">View all {fmt(g.total)} keywords</button>}
    </div>
  );
}

/** Topics found in Google's ideas: the biggest idea of each topic, a bar for its searches, how many keywords it holds. */
function ClusterPanel({ clusters, onAll, go }) {
  const top = clusters.slice(0, 6);
  const max = Math.max(1, ...top.map(c => c.volume));
  return (
    <div className="min-w-0">
      <div className="text-13 text-slate-600">Keyword strategy</div>
      <div className="text-12.5 text-slate-600 mt-1">Topics people search around it, found in Google's own ideas</div>
      {top.length === 0 ? <p className="mt-3 text-12.5 text-slate-500">Not enough ideas to find topics.</p> : (
        <ul className="mt-3 space-y-2.5">{top.map(c => (
          <li key={c.topic} className="flex items-center gap-2 text-12.5" title={`${c.count} keywords · ${fmt(c.volume)} searches a month in total`}>
            <button type="button" onClick={() => go(c.label)} className="w-40 truncate text-left text-slate-800 hover:text-indigo-700 hover:underline cursor-pointer">{c.label}</button>
            <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-indigo-400" style={{ width: `${Math.max(4, (c.volume / max) * 100)}%` }} /></div>
            <span className="w-14 text-right tabular-nums text-slate-600">{kfmt(c.volume)}</span>
          </li>))}</ul>
      )}
      {clusters.length > top.length && <button type="button" onClick={onAll} className="mt-3 rounded-lg ring-1 ring-inset ring-slate-300 px-3 py-1.5 text-12.5 font-medium text-slate-700 hover:bg-slate-50 cursor-pointer">View all clusters</button>}
    </div>
  );
}

function KeywordOverview({ b }) {
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const [added, setAdded] = useState({});
  const [place, setPlace] = useState(''); // location filter: '' = the whole country
  const [country, setCountry] = useState(''); // '' = the project's own country
  const [chosen, setChosen] = useState([]); // target areas picked from the map search: [{ name }], up to five; none means the whole country
  const [typed, setTyped] = useState('');
  const [found, setFound] = useState([]);
  const [findErr, setFindErr] = useState('');
  const countriesApi = useApi('/discover/countries');
  const home = b.country || 'IN';
  const activeCountry = country || home;
  const search = (v) => {
    setTyped(v); setFindErr('');
    if (v.trim().length < 2) { setFound([]); return; }
    api(`/businesses/${b.id}/keyword-workspace/area-search?q=${encodeURIComponent(v.trim())}&country=${activeCountry}`).then(r => setFound(r.results || [])).catch(e => setFindErr(e.message || 'The map service did not answer.'));
  };
  const namesOf = (l) => l.map(x => x.label || x.name); // the full Google Maps line ("Baner, Pune, Maharashtra, India") is what Google Ads is asked for, so a name used in several places is the right one
  const rerun = (names, c) => { if (data || q.trim().length > 1) go(data?.keyword ?? q, names, c); };
  const pickArea = (x) => { const next = chosen.some(e => e.name === x.name) ? chosen : [...chosen, { name: x.name, label: x.label }].slice(0, 5); setChosen(next); setTyped(''); setFound([]); rerun(namesOf(next), activeCountry); };
  const dropArea = (name) => { const next = chosen.filter(e => e.name !== name); setChosen(next); rerun(namesOf(next), activeCountry); };
  const changeCountry = (c) => { setCountry(c); setChosen([]); rerun([], c || home); };
  const [period, setPeriod] = useState('12'); // time filter: the last 12, 6 or 3 months, or one month
  const go = (k, pl, c) => run('go', async () => { const kw = (k ?? q).trim(); setQ(kw); setData(null); const pls = pl ?? namesOf(chosen); startKd(kw, (c ?? activeCountry) || '', pls, k === undefined); setKdMap({}); kdBatch.current += 1; setData(await api(`/businesses/${b.id}/seo/keyword-overview`, { method: 'POST', body: { keyword: kw, places: pls, country: (c ?? activeCountry) || null }, timeout: 120000 })); });
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const started = useRef(false);
  useEffect(() => { const k = (params.get('q') || '').trim(); if (k.length > 1 && !started.current) { started.current = true; go(k); } }, []); // eslint-disable-line react-hooks/exhaustive-deps  (a keyword sent from the workspace is analysed at once)
  const toWorkspace = (ideas) => run('ws', async () => { const r = await api(`/businesses/${b.id}/keyword-workspace/add`, { method: 'POST', body: { ideas: ideas.map(i => ({ keyword: i.keyword, volume: i.volume, detail: `Related to ${data.keyword}` })), label: 'Check One Keyword' } }); toast(r.added ? `${r.added} added to the Keyword Workspace` : 'Already in the Keyword Workspace'); });
  // Saving a keyword ends on My Keywords, with it marked "Just added" (the same landing as Find Keywords).
  const track = (k) => run(`t${k}`, async () => { const r = await api(`/businesses/${b.id}/keywords`, { method: 'POST', body: [{ keyword: k }] }); setAdded(a => ({ ...a, [k]: true })); navigate('/keyword-management/tracked', { state: { added: [k], newCount: r?.added ?? 1 } }); });
  const m = data?.metrics;
  // the SEO difficulty and the Google results page are read from the real top 10 (slow the first time, so the page does not wait for it)
  const [kd, setKd] = useState(null); // { state: 'loading' | 'ready' | 'error', ...result }
  const kdKey = data ? `${data.keyword}|${data.country}` : '';
  const [secs, setSecs] = useState(0); // how long the difficulty has been read for
  useEffect(() => {
    if (kd?.state !== 'loading') { setSecs(0); return undefined; }
    const t = setInterval(() => setSecs(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [kd?.state]);
  const [kdMap, setKdMap] = useState({}); // difficulty of the keywords listed in the ideas: { keyword: score | null | 'loading' }
  const kdBatch = useRef(0); // the run in progress (a new analysis starts a new one, and the old one's answers are dropped)
  const [more, setMore] = useState(null); // the card whose detail is open: difficulty, volume, cpc, global, ideas, serp, paa, ads
  const [preset, setPreset] = useState('all'); // how the ideas window opens: all, similar, related or questions
  const [allClusters, setAllClusters] = useState(false);
  const [aiOpen, setAiOpen] = useState(false); // the AI Overview row of the top-10 table, open or closed
  const kdRun = useRef(0);
  const kdFor = useRef('');
  // read together with the overview (not after it); the results are read as Google shows them in the chosen place, so a new place reads them again, a new period does not
  const startKd = (kw, c, pl, force) => {
    const key = `${kw}|${c}|${pl.join('|')}`;
    if (!force && kdFor.current === key) return;
    kdFor.current = key;
    const mine = ++kdRun.current;
    setKd({ state: 'loading' });
    api(`/businesses/${b.id}/seo/keyword-difficulty`, { method: 'POST', body: { keyword: kw, country: c || null, places: pl }, timeout: 330000 })
      .then(r => { if (kdRun.current === mine) setKd({ state: 'ready', ...r }); }).catch(e => { if (kdRun.current === mine) setKd({ state: 'error', message: e.message || 'Google results could not be read.' }); });
  };
  const exportPdf = async () => {
    const { jsPDF } = await import('jspdf'); // the PDF library is fetched only when a report is exported
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const H = doc.internal.pageSize.getHeight();
    let y = 50;
    const line = (txt, size = 10, bold = false, gap = 15) => { if (y > H - 50) { doc.addPage(); y = 50; } doc.setFontSize(size); doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setTextColor(30, 41, 59); doc.text(String(txt).slice(0, 110), 40, y); y += gap; };
    line(`Keyword overview: ${data.keyword}`, 18, true, 24);
    line(`${data.place || data.country || ''} · Google Ads Keyword Planner${kd?.state === 'ready' ? ' · Google results' : ''} · ${new Date().toLocaleDateString('en-GB')}`, 9, false, 20);
    line(`Searches a month: ${m.volume != null ? fmt(m.volume) : 'n/a'}   ·   World: ${data.world_volume != null ? fmt(data.world_volume) : 'n/a'}`, 11);
    line(`Average cost per click: ${INR(m.cpc_avg)}   ·   Top-of-page bid: ${m.cpc_low != null ? INR(m.cpc_low) + ' to ' : ''}${INR(m.cpc_high)}   ·   Competitive density: ${m.density ?? 'n/a'}`, 11);
    if (kd?.state === 'ready' && kd.score != null) { line(`SEO difficulty: ${kd.score} (${difficultyWord(kd.score)})`, 11, true); line(difficultyText(kd.score), 9, false, 18); }
    line('Searches by country', 12, true, 18);
    countriesShown.slice(0, 8).forEach(c => line(`${c.name}: ${fmt(c.v)} a month`));
    if (kd?.state === 'ready') { y += 8; line('Top results on Google', 12, true, 18); kd.organic.forEach(o => line(`${o.position}. ${o.site} (DA ${o.da ?? '-'}, PA ${o.pa ?? '-'}) ${o.title}`, 9, false, 13)); }
    y += 8; line('Related keywords', 12, true, 18);
    ['similar', 'related', 'questions'].flatMap(k => groupsShown(k).rows).slice(0, 25).forEach(r => line(`${r.keyword}: ${r.v != null ? fmt(r.v) : '-'} a month`, 9, false, 13));
    doc.save(`keyword-overview-${data.keyword.replace(/[^a-z0-9]+/gi, '-')}.pdf`);
  };
  // the first five ideas of each list get their difficulty by themselves, after the keyword's own difficulty is in (three at a time)
  useEffect(() => {
    if (!data || !kd || kd.state === 'loading') return;
    const wanted = ['similar', 'questions', 'related'].flatMap(k => (data.groups?.[k]?.rows || []).slice().sort((x, y) => (y.volume || 0) - (x.volume || 0)).slice(0, 5).map(r => r.keyword));
    const todo = wanted.filter((w, n) => wanted.indexOf(w) === n && kdMap[w] === undefined);
    if (!todo.length) return;
    const mine = kdBatch.current;
    setKdMap(m => ({ ...m, ...Object.fromEntries(todo.map(w => [w, 'loading'])) }));
    (async () => {
      for (let n = 0; n < todo.length; n += 3) {
        const chunk = todo.slice(n, n + 3);
        let res = [];
        try { res = (await api(`/businesses/${b.id}/seo/keyword-difficulty/batch`, { method: 'POST', body: { keywords: chunk, country: data.country || null, places: namesOf(chosen) }, timeout: 240000 })).results; } catch { res = chunk.map(k => ({ keyword: k, score: null })); }
        if (kdBatch.current !== mine) return;
        setKdMap(m => ({ ...m, ...Object.fromEntries(chunk.map(k => [k, res.find(x => x.keyword === k)?.score ?? null])) }));
      }
    })();
  }, [data, kd?.state]); // eslint-disable-line react-hooks/exhaustive-deps -- once the keyword's own difficulty is in
  const allMonths = m?.monthly || [];
  const monthsShown = period === '12' ? allMonths : period === '6' || period === '3' ? allMonths.slice(-Number(period)) : allMonths.filter(x => `${x.year}-${x.month}` === period);
  const volumeShown = period === '12' || !monthsShown.length ? m?.volume : Math.round(monthsShown.reduce((a, x) => a + x.searches, 0) / monthsShown.length);
  const monthList = (allMonths.length ? allMonths : Array.from({ length: 12 }, (_, i) => { const d = new Date(); d.setMonth(d.getMonth() - 12 + i); return { year: d.getFullYear(), month: d.toLocaleString('en', { month: 'long' }).toUpperCase() }; }));
  const periodLabel = period === '12' ? 'last 12 months' : period === '6' ? 'last 6 months' : period === '3' ? 'last 3 months' : (() => { const x = allMonths.find(y => `${y.year}-${y.month}` === period); return x ? `${x.month.slice(0, 3)[0]}${x.month.slice(1, 3).toLowerCase()} ${x.year}` : 'the month'; })();
  const peak = Math.max(1, ...allMonths.map(x => x.searches || 0));
  const inPeriod = (months, whole) => { // searches per month over the chosen period, from that row's own months
    if (period === '12' || !months?.length) return whole;
    const last = period === '6' || period === '3' ? months.slice(-Number(period)) : months.filter(x => `${x.year}-${x.month}` === period);
    return last.length ? Math.round(last.reduce((a, x) => a + x.searches, 0) / last.length) : null;
  };
  const countriesShown = (() => { const l = (data?.countries || []).map(c => ({ ...c, v: inPeriod(c.monthly, c.volume) })).filter(c => c.v); const tot = l.reduce((a, c) => a + c.v, 0) || 1; return l.map(c => ({ ...c, share: Math.round((c.v * 1000) / tot) / 10 })).sort((x, y) => y.v - x.v); })();
  const groupsShown = (k) => { const g = data?.groups?.[k]; return { total: g?.total || 0, volume: g?.volume || 0, all: g?.all || [], rows: (g?.rows || []).map(r => ({ ...r, v: inPeriod(r.monthly, r.volume) })).sort((x, y) => (y.v || 0) - (x.v || 0)) }; };
  const askKd = async (k) => {
    setKdMap(mm => ({ ...mm, [k]: 'loading' }));
    try { const r = await api(`/businesses/${b.id}/seo/keyword-difficulty/batch`, { method: 'POST', body: { keywords: [k], country: data.country || null, places: namesOf(chosen) }, timeout: 240000 }); setKdMap(mm => ({ ...mm, [k]: r.results?.[0]?.score ?? null })); } catch { setKdMap(mm => ({ ...mm, [k]: null })); }
  };
  const ago = (n) => (n == null ? '—' : n < 31 ? `${n} day${n === 1 ? '' : 's'} ago` : n < 365 ? `${Math.round(n / 30)} months ago` : `${(n / 365).toFixed(1)} years ago`);
  const PART_HELP = { RD: 'Referring domains of the top 10 sites, on a log scale', DA: 'Average Domain Authority of the top 10 sites (Moz)', PA: "Average Page Authority (the sites' home pages, Moz)", BQ: 'Backlink quality from our saved links: domain quality, topic, follow type, placement and health', CC: 'Content competition: the keyword in the title, length and freshness of the top pages', SV: 'Search volume against a benchmark of 100,000 a month', SC: 'SERP competition: authority strength, SERP features and top-10 strength', KI: 'Keyword intent: how commercial and transactional the results page is' };
  const Th = ({ children, right }) => <th className={`px-3 py-2 font-medium ${right ? 'text-right' : 'text-left'}`}>{children}</th>;
  const detail = () => {
    if (!more || !data) return null;
    const wait = <p className="text-13 text-slate-500 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" />Reading the top 10 on Google… the detail appears when it is in.</p>;
    if (more === 'difficulty') {
      if (!kd || kd.state === 'loading') return wait;
      if (kd.state === 'error' || kd.score == null) return <p className="text-13 text-amber-800">{kd.message || 'Google gave too few results with figures to score this keyword.'}</p>;
      return (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-8"><Gauge180 value={kd.score} /><div className="max-w-xl text-13 text-slate-600 space-y-2"><p>{difficultyText(kd.score)}</p><p>Read from {kd.sites_with_figures} of {kd.sites} sites{kd.location ? ` in ${kd.location.split(',')[0]}` : ''}. {kd.note}</p>{kd.intent && <p>Intent of the results page: commercial {kd.intent.commercial}, transactional {kd.intent.transactional}, navigational {kd.intent.navigational}.</p>}</div></div>
          <div><h4 className="text-14 font-semibold text-slate-900 mb-2">How the score is made</h4>
            <table className="w-full text-13"><thead className="bg-slate-50 text-11.5 uppercase tracking-wide text-slate-500"><tr><Th>Part</Th><Th>What it measures</Th><Th right>Weight</Th><Th right>Value</Th></tr></thead>
              <tbody>{(kd.formula || []).map(f => <tr key={f.key} className={`border-t border-slate-100 ${f.used ? '' : 'text-slate-400'}`}><td className="px-3 py-2 font-semibold">{f.name}</td><td className="px-3 py-2">{PART_HELP[f.key]}</td><td className="px-3 py-2 text-right tabular-nums">{f.weight}%</td><td className="px-3 py-2 text-right tabular-nums font-semibold">{f.used ? f.value : 'no data'}</td></tr>)}</tbody></table></div>
          <div><h4 className="text-14 font-semibold text-slate-900 mb-2">The top {kd.organic.length} on Google</h4>
            <div className="overflow-x-auto"><table className="w-full text-12.5 min-w-[760px]"><thead className="bg-slate-50 text-11.5 uppercase tracking-wide text-slate-500"><tr><Th>#</Th><Th>Site</Th><Th right>Authority Score</Th><Th right>DA</Th><Th right>PA</Th><Th right>Ref. domains</Th><Th right>Spam</Th><Th right>Words</Th><Th>Updated</Th><Th>Keyword in title</Th></tr></thead>
              <tbody>{kd.organic.map(o => <tr key={o.url} className="border-t border-slate-100"><td className="px-3 py-2 text-slate-500">{o.position}</td><td className="px-3 py-2 max-w-[220px] truncate"><a href={o.url} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline" title={o.title}>{o.site}</a></td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{o.as ?? '—'}</td><td className="px-3 py-2 text-right tabular-nums">{o.da ?? '—'}</td><td className="px-3 py-2 text-right tabular-nums">{o.pa ?? '—'}</td><td className="px-3 py-2 text-right tabular-nums">{kfmt(o.rd)}</td><td className="px-3 py-2 text-right tabular-nums">{o.spam ?? '—'}</td><td className="px-3 py-2 text-right tabular-nums">{o.words != null ? fmt(o.words) : '—'}</td><td className="px-3 py-2">{ago(o.age_days)}</td><td className="px-3 py-2">{o.relevant == null ? '—' : o.relevant ? 'Yes' : 'No'}</td></tr>)}</tbody></table></div></div>
        </div>
      );
    }
    if (more === 'volume') {
      const avg = allMonths.length ? Math.round(allMonths.reduce((a, x) => a + x.searches, 0) / allMonths.length) : 0;
      const top = Math.max(1, ...allMonths.map(x => x.searches));
      return (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-8 text-13"><div><div className="text-slate-500">Average a month (12 months)</div><div className="text-24 font-bold tabular-nums text-slate-900">{m.volume != null ? fmt(m.volume) : '—'}</div></div>
            <div><div className="text-slate-500">3 months</div><div className="text-20 font-semibold tabular-nums">{pct(m.three_month_change) || '—'}</div></div><div><div className="text-slate-500">Against last year</div><div className="text-20 font-semibold tabular-nums">{pct(m.yoy_change) || '—'}</div></div>
            <div><div className="text-slate-500">Peak month</div><div className="text-20 font-semibold tabular-nums">{fmt(top)}</div></div></div>
          <table className="w-full text-13"><thead className="bg-slate-50 text-11.5 uppercase tracking-wide text-slate-500"><tr><Th>Month</Th><Th right>Searches</Th><Th right>Change on the month before</Th><Th right>Against the average</Th><Th>&nbsp;</Th></tr></thead>
            <tbody>{allMonths.map((x, i) => { const prev = allMonths[i - 1]?.searches; const ch = prev ? Math.round(((x.searches - prev) * 100) / prev) : null; return <tr key={`${x.year}${x.month}`} className="border-t border-slate-100"><td className="px-3 py-2 font-medium">{x.month.slice(0, 1)}{x.month.slice(1).toLowerCase()} {x.year}</td><td className="px-3 py-2 text-right tabular-nums">{fmt(x.searches)}</td>
              <td className="px-3 py-2 text-right tabular-nums" style={{ color: ch == null ? '#94a3b8' : ch >= 0 ? '#059669' : '#dc2626' }}>{ch == null ? '—' : `${ch >= 0 ? '+' : ''}${ch}%`}</td><td className="px-3 py-2 text-right tabular-nums">{avg ? `${Math.round((x.searches * 100) / avg)}%` : '—'}</td>
              <td className="px-3 py-2 w-48"><div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-indigo-500" style={{ width: `${Math.max(3, (x.searches / top) * 100)}%` }} /></div></td></tr>; })}</tbody></table>
        </div>
      );
    }
    if (more === 'cpc' || more === 'global') {
      const list = [...(data.countries || [])];
      const totalW = data.world_volume || list.reduce((a, x) => a + x.volume, 0) || 1;
      return (
        <div className="space-y-4">
          {more === 'cpc' ? <div className="flex flex-wrap gap-8 text-13"><div><div className="text-slate-500">Average cost per click</div><div className="text-24 font-bold tabular-nums">{INR(m.cpc_avg ?? m.cpc_high)}</div></div><div><div className="text-slate-500">Top-of-page bid</div><div className="text-20 font-semibold tabular-nums">{m.cpc_low != null ? `${INR(m.cpc_low)} to ` : ''}{INR(m.cpc_high)}</div></div>
            <div><div className="text-slate-500">Competitive density</div><div className="text-20 font-semibold tabular-nums">{m.density != null ? m.density.toFixed(2) : '—'}</div></div><div><div className="text-slate-500">Ads / PLA on the results page</div><div className="text-20 font-semibold tabular-nums">{kd?.state === 'ready' ? `${kd.serp_counts?.ads ?? 'n/a'} / ${kd.serp_counts?.pla ?? 'n/a'}` : '…'}</div></div></div>
            : <div className="text-13"><div className="text-slate-500">Searches a month in every location (Google Keyword Planner)</div><div className="text-24 font-bold tabular-nums">{data.world_volume != null ? fmt(data.world_volume) : '—'}</div></div>}
          <table className="w-full text-13"><thead className="bg-slate-50 text-11.5 uppercase tracking-wide text-slate-500"><tr><Th>Country</Th><Th right>Searches / mo</Th><Th right>Share</Th><Th right>Top-of-page bid</Th><Th right>Competition index</Th><Th>&nbsp;</Th></tr></thead>
            <tbody>{list.sort((a, c) => (more === 'cpc' ? (c.cpc || 0) - (a.cpc || 0) : c.volume - a.volume)).map(x => <tr key={x.code} className="border-t border-slate-100"><td className="px-3 py-2 font-medium">{x.name}</td><td className="px-3 py-2 text-right tabular-nums">{fmt(x.volume)}</td><td className="px-3 py-2 text-right tabular-nums">{Math.round((x.volume * 100) / totalW)}%</td><td className="px-3 py-2 text-right tabular-nums">{INR(x.cpc)}</td><td className="px-3 py-2 text-right tabular-nums">{x.index ?? '—'}</td>
              <td className="px-3 py-2 w-40"><div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-indigo-400" style={{ width: `${Math.max(3, (x.volume / Math.max(1, ...list.map(y => y.volume))) * 100)}%` }} /></div></td></tr>)}</tbody></table>
        </div>
      );
    }
    if (more === 'ideas') return <IdeasExplorer key={preset} data={data} preset={preset} kdMap={kdMap} askKd={askKd} go={k => { setMore(null); go(k); }} toWorkspace={toWorkspace} adding={busy === 'ws'} />;
    if (!kd || kd.state === 'loading') return wait;
    if (kd.state === 'error') return <p className="text-13 text-amber-800">{kd.message}</p>;
    if (more === 'serp') {
      return (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-1.5">{Object.entries(kd.components?.features || {}).map(([k, on]) => <span key={k} className={`rounded-full px-2.5 py-0.5 text-12 font-medium ring-1 ring-inset ${on ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-slate-50 text-slate-400 ring-slate-200'}`}>{k}{on ? '' : ': none'}</span>)}</div>
          <div className="overflow-x-auto"><table className="w-full text-12.5 min-w-[820px]"><thead className="bg-slate-50 text-11.5 uppercase tracking-wide text-slate-500"><tr><Th>#</Th><Th>Page</Th><Th right>Authority Score</Th><Th right>DA</Th><Th right>PA</Th><Th right>Ref. domains</Th><Th right>Ranking keywords</Th><Th right>Words</Th><Th>Updated</Th></tr></thead>
            <tbody>{kd.organic.map(o => <tr key={o.url} className="border-t border-slate-100 align-top"><td className="px-3 py-2 text-slate-500">{o.position}</td><td className="px-3 py-2 max-w-[340px]"><a href={o.url} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">{o.title || o.url}</a><div className="text-11.5 text-slate-500 truncate">{o.url.replace(/^https?:\/\/(www\.)?/, '')}</div>{o.description && <div className="text-11.5 text-slate-500 mt-0.5 line-clamp-2">{o.description}</div>}</td>
              <td className="px-3 py-2 text-right tabular-nums font-semibold">{o.as ?? '—'}</td><td className="px-3 py-2 text-right tabular-nums">{o.da ?? '—'}</td><td className="px-3 py-2 text-right tabular-nums">{o.pa ?? '—'}</td><td className="px-3 py-2 text-right tabular-nums">{kfmt(o.rd)}</td><td className="px-3 py-2 text-right tabular-nums">{kfmt(o.rk)}</td><td className="px-3 py-2 text-right tabular-nums">{o.words != null ? fmt(o.words) : '—'}</td><td className="px-3 py-2">{ago(o.age_days)}</td></tr>)}</tbody></table></div>
        </div>
      );
    }
    if (more === 'paa') {
      return (
        <div className="grid md:grid-cols-2 gap-6">
          <div><h4 className="text-14 font-semibold text-slate-900 mb-2">People also ask ({kd.questions.length})</h4>{kd.questions.length ? <ul className="space-y-2 text-13">{kd.questions.map(x => <li key={x}><button type="button" className="text-indigo-700 hover:underline text-left cursor-pointer" onClick={() => { setMore(null); go(x); }}>{x}</button></li>)}</ul> : <p className="text-13 text-slate-500">Google shows none for this search.</p>}</div>
          <div><h4 className="text-14 font-semibold text-slate-900 mb-2">Related searches ({kd.related.length})</h4>{kd.related.length ? <div className="flex flex-wrap gap-1.5">{kd.related.map(x => <button key={x} type="button" onClick={() => { setMore(null); go(x); }} className="px-2.5 py-1 rounded-full bg-slate-100 text-12.5 text-slate-700 hover:bg-indigo-50 cursor-pointer">{x}</button>)}</div> : <p className="text-13 text-slate-500">None.</p>}</div>
        </div>
      );
    }
    if (more === 'ads') {
      return kd.ads.length === 0 ? <p className="text-13 text-slate-500">No ads were shown on this search when it was read.</p> : (
        <div className="grid md:grid-cols-2 gap-3">{kd.ads.map((a, n) => <div key={n} className="rounded-lg ring-1 ring-slate-200 p-3"><div className="text-11.5 text-slate-500 truncate">Ad · {a.url}</div><a href={a.url} target="_blank" rel="noreferrer" className="text-14 font-semibold text-indigo-700 hover:underline">{a.title}</a><div className="text-12.5 text-slate-600 mt-1">{a.description}</div></div>)}</div>
      );
    }
    return null;
  };
  const MORE_TITLE = { difficulty: 'Difficulty in detail', volume: 'Search volume in detail', cpc: 'Cost per click in detail', global: 'Global volume in detail', ideas: 'Keyword ideas', serp: 'SERP overview in detail', paa: 'People also ask and related searches', ads: 'Ads on this search' };
  const isTracked = (k) => added[k] || (data?.keyword === k && data?.you?.tracked);
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap gap-2">
          <label className="relative flex-1 min-w-[260px]"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && q.trim().length > 1 && go()} placeholder="Enter a keyword, e.g. dentist near me" aria-label="Keyword" className="w-full h-10 pl-9 pr-3 text-13 rounded-lg bg-white ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none" /></label>
          <label className="text-12 font-medium text-slate-500 flex items-center gap-1.5">Country
            <select value={activeCountry} onChange={e => changeCountry(e.target.value === home ? '' : e.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-13 text-slate-800" aria-label="Country">
              {(countriesApi.data || [{ code: home, name: home }]).map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
          <div className="relative">
            <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={typed} onChange={e => search(e.target.value)} placeholder={chosen.length ? "Add another target area…" : "Add a target area: search Google Maps…"} aria-label="Search a target area on Google Maps" className="h-9 w-60 pl-9 pr-3 text-13 rounded-lg border border-slate-300 bg-white" />
            {found.length > 0 && (
              <ul className="absolute z-20 mt-1 w-80 max-h-60 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg divide-y divide-slate-100">
                {found.map(x => <li key={x.label}><button type="button" onClick={() => pickArea(x)} className="w-full text-left px-3 py-2 text-13 hover:bg-indigo-50 cursor-pointer"><MapPin size={12} className="inline mr-1.5 text-indigo-500" />{x.label}</button></li>)}
                <li className="px-3 py-1 text-11 text-slate-400">{found[0].source}</li>
              </ul>)}
            {findErr && <p className="absolute text-11.5 text-rose-600 mt-1 whitespace-nowrap">{findErr}</p>}
          </div>
          <label className="text-12 font-medium text-slate-500 flex items-center gap-1.5">Period
            <select value={period} onChange={e => setPeriod(e.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-13 text-slate-800" aria-label="Period">
              <option value="12">Last 12 months</option><option value="6">Last 6 months</option><option value="3">Last 3 months</option>
              {[...monthList].reverse().map(x => <option key={`${x.year}-${x.month}`} value={`${x.year}-${x.month}`}>{x.month.slice(0, 1)}{x.month.slice(1, 3).toLowerCase()} {String(x.year).slice(2)}</option>)}</select></label>
          <Button variant="primary" icon={Search} busy={busy === 'go'} disabled={q.trim().length < 2} onClick={() => go()}>Analyze</Button>
        </div>
        {chosen.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Target areas">
            <span className="text-12 font-medium text-slate-500 mr-1">Target areas</span>
            {chosen.map(x => <span key={x.name} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 ring-1 ring-inset ring-indigo-200 pl-2.5 pr-1 py-0.5 text-12.5 font-medium text-indigo-800"><MapPin size={11} />{x.name}<button type="button" onClick={() => dropArea(x.name)} aria-label={`Remove ${x.name}`} className="rounded-full p-0.5 hover:bg-indigo-100 cursor-pointer"><X size={12} /></button></span>)}
            {chosen.length > 1 && <span className="text-11.5 text-slate-500">figures are added over the {chosen.length} areas</span>}
          </div>
        )}
        <ErrorNote>{error}</ErrorNote>
        <p className="text-11.5 text-slate-400 mt-2">Numbers come from the Google Ads Keyword Planner, for the country and the target areas chosen above (none chosen: the whole country). Costs are in the currency of the Google Ads account. It shows how often a keyword is searched and what it costs; who ranks for it is on Position Tracking and Competitors.</p>
      </Card>
      {data && (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-white ring-1 ring-slate-200 px-4 py-3">
            <KeyRound size={16} className="text-indigo-500" />
            <div className="mr-auto min-w-0"><div className="text-16 font-semibold text-slate-900 truncate">{data.keyword}</div>
              <div className="text-12 text-slate-500">{data.place ? `Figures for ${data.place}` : data.country ? `Figures for ${data.country}` : 'Figures for your country'} · Google Ads Keyword Planner · {data.you.rank ? `you rank #${data.you.rank}` : data.you.tracked ? 'tracked, not ranking yet' : 'not tracked yet'}</div></div>
            <div className="flex flex-wrap gap-1.5" aria-label="Search intent">{[...new Set([data.intent, ...(kd?.state === 'ready' ? [['commercial', kd.intent?.commercial], ['transactional', kd.intent?.transactional]].filter(([, v]) => v >= 50).map(([k]) => k) : [])])].filter(Boolean).map(k => <span key={k} className="rounded-full bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200 px-3 py-1 text-12.5 font-semibold">{k[0].toUpperCase() + k.slice(1)}</span>)}</div>
            <Button size="sm" icon={RefreshCw} busy={busy === 'go'} onClick={() => go()} title="Read everything again, fresh from Google">Update metrics</Button>
            <Button size="sm" icon={Download} onClick={exportPdf}>Export PDF</Button>
            {!isTracked(data.keyword) && <Button size="sm" icon={Plus} busy={busy === `t${data.keyword}`} onClick={() => track(data.keyword)}>Track</Button>}
          </div>
          {data.found && (m.volume ?? 0) === 0 && <p className="text-13 text-amber-800 bg-amber-50 rounded-lg px-3 py-2">Google Keyword Planner reports no searches for this exact keyword in {data.place || data.country || 'your country'}: it is very specific. {data.ideas_from ? <>The ideas below are for its main words, <b>{data.ideas_from}</b>.</> : 'Try a shorter phrase.'}</p>}
          {!data.found && <p className="text-13 text-amber-800 bg-amber-50 rounded-lg px-3 py-2">Google's Keyword Planner has no figures for this exact keyword (it is too rare or too new). The ideas below are what it does know.</p>}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <Card title="Difficulty" action={<MoreBtn onClick={() => setMore('difficulty')} />} subtitle={`SEO difficulty, from the real top 10 on Google${kd?.state === 'ready' && kd.location ? ` in ${kd.location.split(',')[0]}` : ''}`}>
              {kd?.state === 'ready' && kd.score != null ? (
                <>
                  <Gauge180 value={kd.score} tip={<div className="space-y-0.5"><div className="font-semibold">Difficulty {kd.score} · {difficultyWord(kd.score)}</div>{(kd.formula || []).map(f => <div key={f.key} className={f.used ? '' : 'text-slate-400'}>{f.name} ({f.weight}%): {f.used ? f.value : 'no data'}</div>)}</div>} note={`Average Domain Authority ${kd.components.avg_da ?? '—'}, Page Authority ${kd.components.avg_pa ?? '—'}, ${kd.components.top10_strength ?? 0}% of the top 10 have DA 70+, SERP features ${kd.components.serp_features}%. From ${kd.sites_with_figures} of ${kd.sites} sites.${kd.sites_with_figures < 5 ? ' Google showed few results, so treat this score as a rough guide.' : ''}`} />
                </>
              ) : (
                <div className="py-10 text-center text-13 text-slate-500">
                  {kd?.state === 'error' ? <><AlertTriangle size={18} className="mx-auto mb-2 text-amber-500" />Not available: {kd.message}</>
                    : kd?.state === 'ready' ? 'Google gave too few results with figures to score this keyword.'
                      : <><Loader2 size={20} className="mx-auto mb-2 animate-spin text-indigo-500" />Reading the top 10 on Google and their authority… {secs}s <span className="block text-11.5 text-slate-400 mt-1">Google's results page is the slow part (about a minute). Everything else on this page is already final.</span></>}
                </div>
              )}
              {kd?.state === 'ready' && kd.score != null && (
                <div className="mt-3 border-t border-slate-100 pt-3 text-12.5 text-slate-600 space-y-1.5">
                  <p>{difficultyText(kd.score)}</p>
                  {kd.location && kd.location_applied === false && <p className="text-amber-700 text-12">Google's results were read for the whole country: the reader that gives the real addresses of the results has no place setting, so this score is not specific to {kd.location.split(',')[0]}.</p>}
                  {kd.you && kd.you.da != null && <p className="text-slate-500">Your site <b className="text-slate-800">{kd.you.domain}</b>: Domain Authority <b className="text-slate-800">{kd.you.da}</b>{kd.you.pa != null ? <>, Page Authority <b className="text-slate-800">{kd.you.pa}</b></> : ''} against {kd.you.top_da ?? '—'} on average in the top 10{kd.you.top_da != null && kd.you.da < kd.you.top_da - 10 ? ': you are well below them.' : kd.you.top_da != null && kd.you.da >= kd.you.top_da ? ': you are on their level.' : '.'}</p>}
                </div>
              )}
            </Card>
            <Card title="Search volume" action={<MoreBtn onClick={() => setMore('volume')} />} subtitle={`Average searches per month, ${periodLabel}`}>
              <div className="flex items-baseline gap-2"><div className="text-28 font-bold text-slate-900 tabular-nums">{kfmt(volumeShown)}</div>
                <div className="text-12 text-slate-500">{[pct(m.three_month_change) && `${pct(m.three_month_change)} in 3 months`, pct(m.yoy_change) && `${pct(m.yoy_change)} vs last year`].filter(Boolean).join(' · ')}</div></div>
              {allMonths.length > 0 ? (
                <div className="flex items-end gap-1 h-24 mt-3" role="img" aria-label="Monthly searches for the last 12 months">
                  {allMonths.map((x, i) => { const prev = allMonths[i - 1]?.searches; const ch = prev ? Math.round(((x.searches - prev) * 100) / prev) : null; return (
                    <Tip key={`${x.year}-${x.month}`} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full cursor-default" tip={<div><div className="font-semibold">{x.month.slice(0, 1)}{x.month.slice(1, 3).toLowerCase()} {x.year}</div><div>{fmt(x.searches)} searches</div>{ch != null && <div className={ch >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{ch >= 0 ? '+' : ''}{ch}% vs the month before</div>}<div className="text-slate-300">{Math.round((x.searches * 100) / (m.volume || x.searches || 1))}% of the average</div></div>}>
                      <div className={`w-full rounded-t transition-colors ${monthsShown.includes(x) ? 'bg-indigo-500 group-hover:bg-indigo-700' : 'bg-indigo-200 group-hover:bg-indigo-400'}`} style={{ height: `${Math.max(4, Math.round((x.searches / peak) * 100))}%` }} /><span className="text-[9px] text-slate-400 mt-0.5">{x.month.slice(0, 1)}</span>
                    </Tip>); })}
                </div>
              ) : <p className="text-12 text-slate-400 mt-3">No monthly figures from Google.</p>}
            </Card>
            <Card title="Cost per click" action={<MoreBtn onClick={() => setMore('cpc')} />} subtitle="What advertisers pay on Google">
              <div className="flex items-baseline gap-2"><div className="text-28 font-bold text-slate-900 tabular-nums" title="Average cost per click (Google Ads)">{INR(m.cpc_avg ?? m.cpc_high)}</div><div className="text-12 text-slate-500">average{m.cpc_avg == null ? ' (top-of-page bid)' : ''}</div></div>
              <div className="mt-1 text-12 text-slate-500">Top-of-page bid {m.cpc_low != null ? `${INR(m.cpc_low)} to ` : ''}{INR(m.cpc_high)}</div>
              <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-3 gap-2 text-center">
                <div title="How many advertisers compete for it, 0 to 1 (Google's competition index divided by 100)"><div className="text-11.5 text-slate-500">Competitive density</div><div className="text-18 font-semibold tabular-nums text-slate-900">{m.density != null ? m.density.toFixed(2) : '—'}</div></div>
                <div title="Ads shown on Google's results page for the keyword right now"><div className="text-11.5 text-slate-500">Ads</div><div className="text-18 font-semibold tabular-nums text-slate-900">{kd?.state === 'ready' ? (kd.serp_counts?.ads ?? 'n/a') : '…'}</div></div>
                <div title="Product listing (shopping) ads shown on Google's results page right now"><div className="text-11.5 text-slate-500">PLA</div><div className="text-18 font-semibold tabular-nums text-slate-900">{kd?.state === 'ready' ? (kd.serp_counts?.pla ?? 'n/a') : '…'}</div></div>
              </div>
              <div className="mt-3 space-y-1.5">{(data.countries || []).filter(c => c.cpc != null).slice(0, 4).map(c => <Bar key={c.code} label={c.name} value={c.cpc} max={Math.max(...data.countries.map(x => x.cpc || 0), 0.01)} text={INR(c.cpc)} tip={<div><div className="font-semibold">{c.name}</div><div>Top-of-page bid {INR(c.cpc)} per click</div><div className="text-slate-300">Competition index {c.index ?? '—'} · {fmt(c.volume)} searches a month</div></div>} />)}</div>
            </Card>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <Card title="Global volume" action={<MoreBtn onClick={() => setMore('global')} />} subtitle="Searches per month in every country Google reports">
              {(() => {
                const top = countriesShown.slice(0, 6);
                const world = period === '12' ? data.world_volume : null; // the world figure is Google's 12-month average
                const other = world != null ? Math.max(0, world - top.reduce((a, x) => a + x.v, 0)) : null;
                return countriesShown.length === 0 ? <p className="text-12 text-slate-400">Google has no figures for this keyword in other countries.</p> : (
                  <>
                    {world != null && <div className="text-28 font-bold text-slate-900 tabular-nums mb-2" title="Searches a month in every location at once (Google Keyword Planner)">{kfmt(world)}</div>}
                    <div className="space-y-1.5">{top.map(c => <Bar key={c.code} label={c.name} value={c.v} max={top[0].v} text={`${kfmt(c.v)}${world ? ` · ${Math.round((c.v * 100) / world)}%` : ` · ${c.share}%`}`} tip={<div><div className="font-semibold">{c.name}</div><div>{fmt(c.v)} searches a month ({periodLabel})</div><div className="text-slate-300">bid {INR(c.cpc)} · index {c.index ?? '—'}</div></div>} />)}</div>
                    {other != null && other > 0 && <div className="mt-2 pt-2 border-t border-slate-100"><Bar label="Other" value={other} max={top[0].v} text={`${kfmt(other)} · ${Math.round((other * 100) / world)}%`} tip={<div><div className="font-semibold">All other countries</div><div>{fmt(other)} searches a month</div></div>} /></div>}
                  </>
                );
              })()}
            </Card>
            <div className="lg:col-span-2"><Card title="Related keywords" action={<MoreBtn onClick={() => { setPreset('related'); setMore('ideas'); }} />} subtitle="Other searches Google connects to it">
              <IdeaPanel title="Related keywords" g={groupsShown('related')} kdMap={kdMap} go={go} onAll={() => { setPreset('related'); setMore('ideas'); }} />
            </Card></div>
          </div>
          <Card title="Keyword ideas" action={<MoreBtn onClick={() => { setPreset('all'); setMore('ideas'); }} />} subtitle="From Google Keyword Planner: how many it knows, their total searches, and how hard the biggest ones are">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-10 gap-y-6">
              <IdeaPanel title="Keyword variations" g={groupsShown('similar')} kdMap={kdMap} go={go} onAll={() => { setPreset('similar'); setMore('ideas'); }} />
              <IdeaPanel title="Questions" g={groupsShown('questions')} kdMap={kdMap} go={go} onAll={() => { setPreset('questions'); setMore('ideas'); }} />
              <ClusterPanel clusters={data.clusters || []} go={go} onAll={() => setAllClusters(true)} />
            </div>
            <p className="mt-4 text-11.5 text-slate-400">Google Keyword Planner returns up to about 600 ideas for one keyword, so the counts are lower than in tools with their own very large keyword databases. KD % is worked out for the first five of each list by reading the real top 10 on Google; open a keyword to see it in full.</p>
          </Card>
          {kd?.state === 'ready' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <div className="lg:col-span-2"><Card pad={false} title="SERP overview" action={<MoreBtn onClick={() => setMore('serp')} />} subtitle={`The top ${kd.organic.length} results on Google for "${data.keyword}"`}>
                <table className="w-full text-12.5">
                  <thead><tr className="text-left text-11.5 text-slate-500 border-b border-slate-200">
                    <th className="px-4 py-2 font-medium">URL</th>
                    <th className="px-2 py-2 font-medium text-right" title="Authority Score, 0 to 100: how reputable the site is. It accounts for the number and quality of its backlinks (sites linking to it and their Domain Authority), its organic presence (how many keywords it ranks for) and how authentic its profile is (spam score). Worked out by us from Moz data; the site's Domain Authority is under it.">Page AS</th>
                    <th className="px-2 py-2 font-medium text-right" title="The number of referring domains that have at least one link pointing to the URL. Moz gives this count for the whole website, not for the exact URL, so that is what is shown.">Ref. Domains</th>
                    <th className="px-2 py-2 font-medium text-right" title="The total number of backlinks leading to the URL. Shown only for sites whose links our own crawler holds; a dash means no URL-level backlink data.">Backlinks</th>
                    <th className="px-2 py-2 font-medium text-right" title="The overall amount of organic traffic driven to the URL in a month. It needs a traffic database that is not connected, so it is not shown rather than estimated.">Search Traffic</th>
                    <th className="px-4 py-2 font-medium text-right" title="The number of keywords for which the URL ranks in search results. Open the page to see the searches it shows for, measured in Google now.">URL Keywords</th></tr></thead>
                  <tbody>
                    {(kd.ai_links || []).length > 0 && (
                      <>
                        <tr className="border-b border-slate-100 bg-slate-50/60 cursor-pointer hover:bg-slate-50" onClick={() => setAiOpen(o => !o)}>
                          <td colSpan={6} className="px-4 py-2"><button type="button" aria-expanded={aiOpen} className="inline-flex items-center gap-2 font-semibold text-slate-800 cursor-pointer"><span className={`inline-block transition-transform text-slate-400 ${aiOpen ? 'rotate-90' : ''}`}>›</span><Sparkles size={14} className="text-slate-400" />AI Overview ({kd.ai_links.length} link{kd.ai_links.length === 1 ? '' : 's'})</button></td>
                        </tr>
                        {aiOpen && kd.ai_links.map((l, n) => (
                          <tr key={`${n}${l.url}`} className="border-b border-slate-100 bg-slate-50/40"><td colSpan={6} className="pl-10 pr-4 py-1.5"><span className="flex items-center gap-1.5 min-w-0"><Link to={`/organic-rankings/page?u=${encodeURIComponent(l.url)}&q=${encodeURIComponent(data.keyword)}`} className="text-indigo-700 hover:underline truncate" title={l.title}>{l.title || l.url}</Link>
                            <a href={l.url} target="_blank" rel="noreferrer" aria-label="Open the page in a new tab" className="shrink-0 text-slate-400 hover:text-indigo-600"><ExternalLink size={13} /></a><span className="text-11.5 text-slate-500 shrink-0">{l.site}</span></span></td></tr>))}
                      </>
                    )}
                    {kd.organic.map(o => (
                      <tr key={`${o.position}${o.url}`} className="border-b border-slate-100 align-top">
                        <td className="px-4 py-2 max-w-[380px]"><div className="flex items-start gap-2 min-w-0"><span className="tabular-nums text-slate-400 w-5 shrink-0 text-right">{o.position}</span>
                          <div className="min-w-0"><span className="flex items-center gap-1.5 min-w-0"><Link to={`/organic-rankings/page?u=${encodeURIComponent(o.url)}&q=${encodeURIComponent(data.keyword)}`} className="text-indigo-700 hover:underline truncate" title={`Open the organic rankings of this page: ${o.title}`}>{o.title || o.url}</Link>
                            <a href={o.url} target="_blank" rel="noreferrer" aria-label="Open the page in a new tab" title="Open the page itself in a new tab" className="shrink-0 text-slate-400 hover:text-indigo-600"><ExternalLink size={13} /></a></span>
                            <span className="block text-11.5 text-slate-500 truncate" title={o.url}>{o.url.replace(/^https?:\/\/(www\.)?/, '')}</span></div></div></td>
                        <td className="px-2 py-2 text-right tabular-nums"><div className="font-semibold text-slate-900" title={o.as != null ? `Authority Score ${o.as}: from ${o.rd != null ? `${fmt(o.rd)} referring domains, ` : ''}Domain Authority ${o.da}${o.rk != null ? `, ${fmt(o.rk)} ranking keywords` : ''}${o.spam != null ? `, spam score ${o.spam}` : ''}` : 'No Moz figures for this site'}>{o.as ?? '—'}</div>{o.da != null && <div className="text-11 text-slate-400" title="Domain Authority of the whole site (Moz)">DA {o.da}</div>}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{kfmt(o.rd)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{o.backlinks != null ? fmt(o.backlinks) : <span className="text-slate-300">—</span>}</td>
                        <td className="px-2 py-2 text-right text-slate-300" title="Needs a traffic database that is not connected">—</td>
                        <td className="px-4 py-2 text-right"><Link to={`/organic-rankings/page?u=${encodeURIComponent(o.url)}&q=${encodeURIComponent(data.keyword)}`} className="text-12 font-semibold text-indigo-700 hover:underline" title="Open the page: its searches and positions are measured in Google now">See</Link></td></tr>))}
                  </tbody></table>
                <div className="px-4 py-2.5 border-t border-slate-100">
                  <div className="text-12 font-semibold text-slate-700 mb-1.5">How the difficulty of {kd.score} is made{kd.weight_used < 100 ? ` (parts with no data are left out; the other ${kd.weight_used}% is scaled to 100%)` : ''}</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">{(kd.formula || []).map(f => (
                    <div key={f.key} className={`rounded-lg ring-1 px-2.5 py-1.5 ${f.used ? 'ring-slate-200 bg-white' : 'ring-slate-100 bg-slate-50 text-slate-400'}`} title={f.used ? `${f.name}: ${f.value} out of 100, weight ${f.weight}%` : `${f.name}: no data, not counted`}>
                      <div className="text-11.5">{f.name} <span className="text-slate-400">· {f.weight}%</span></div><div className="text-16 font-semibold tabular-nums">{f.value ?? '—'}</div></div>))}</div>
                </div>
                <div className="px-4 py-2.5 border-t border-slate-100 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-12 text-slate-600">
                  <span>Authority <b className="text-slate-900">{kd.components.authority_strength ?? '—'}</b></span><span>SERP features <b className="text-slate-900">{kd.components.serp_features}%</b></span>
                  <span>Top 10 with DA 70+ <b className="text-slate-900">{kd.components.top10_strength ?? '—'}%</b></span><span>Content strength <b className="text-slate-900">{kd.content?.cc ?? '—'}</b></span>
                  <span>Pages with the keyword in title <b className="text-slate-900">{kd.content?.relevance ?? '—'}%</b></span><span>Average length <b className="text-slate-900">{kd.content?.avg_words ?? '—'} words</b></span>
                  <span>Updated in a year <b className="text-slate-900">{kd.content?.freshness ?? '—'}%</b></span><span>Intent C/T/N <b className="text-slate-900">{kd.intent?.commercial}/{kd.intent?.transactional}/{kd.intent?.navigational}</b></span>
                  <span title="From our own saved backlinks: only sites we hold links for">Backlink quality <b className="text-slate-900">{kd.backlinks?.bq ?? '—'}</b> <span className="text-slate-400">({kd.backlinks?.sites_with_links ?? 0} sites{kd.backlinks?.counted ? '' : ', not counted'})</span>
                    <span className="block text-11 text-slate-400">{Object.entries(kd.backlinks?.parts || {}).map(([k, v]) => `${k} ${v ?? '—'}`).join(' · ')}</span></span>
                </div>
                <p className="px-4 pb-2 text-11.5 text-slate-500">{kd.note} DA, PA and linking sites are Moz's figures; a dash means no figure.</p>
              </Card></div>
              <Card title={`People also ask (${kd.questions.length})`} action={<MoreBtn onClick={() => setMore('paa')} />}>
                {kd.questions.length === 0 ? <p className="text-12.5 text-slate-500">Google shows none for this search.</p> : <ul className="space-y-1.5 text-12.5">{kd.questions.map(x => <li key={x}><button type="button" className="text-indigo-700 hover:underline text-left cursor-pointer" onClick={() => go(x)}>{x}</button></li>)}</ul>}
                {kd.related.length > 0 && <><div className="text-12 font-semibold text-slate-600 mt-3 mb-1">Related searches</div><div className="flex flex-wrap gap-1.5">{kd.related.map(x => <button key={x} type="button" onClick={() => go(x)} className="px-2 py-0.5 rounded-full bg-slate-100 text-12 text-slate-700 hover:bg-indigo-50 cursor-pointer">{x}</button>)}</div></>}
              </Card>
              <div className="lg:col-span-3"><Card title={`Ads on this search (${kd.ads.length})`} action={<MoreBtn onClick={() => setMore('ads')} />} subtitle="What advertisers show on Google's results page for the keyword, right now">
                {kd.ads.length === 0 ? <p className="text-12.5 text-slate-500">No ads were shown on this search when it was read.</p> : (
                  <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">{kd.ads.map((a, n) => <div key={n} className="rounded-lg ring-1 ring-slate-200 p-3"><div className="text-11.5 text-slate-500 truncate">Ad · {a.site || a.url}</div><div className="text-13 font-semibold text-indigo-700">{a.title}</div><div className="text-12 text-slate-600 mt-0.5">{a.description}</div></div>)}</div>)}
              </Card></div>
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="lg:col-span-3"><Card title="Not available from Google">
              <p className="text-13 text-slate-600">These sections have no source connected, so they are not shown, rather than made up:</p>
              <ul className="mt-2 grid sm:grid-cols-2 gap-x-6 gap-y-1 text-13 text-slate-500 list-disc pl-5"><li>Ranking dynamics (use Position Tracking for yours)</li><li>Ads history over the months</li><li>Domain traffic and traffic cost</li></ul>
              <div className="mt-3 flex gap-2"><Button size="sm" onClick={() => navigate('/rank-tracking')}>Position Tracking</Button><Button size="sm" busy={busy === 'ws'} onClick={() => toWorkspace(['similar', 'related', 'questions'].flatMap(k => data.groups?.[k]?.rows || []).map(r => ({ keyword: r.keyword, volume: r.volume })))}>Add all ideas to the Keyword Workspace</Button></div>
            </Card></div>
          </div>
        </>
      )}
      <Modal open={!!more} title={more ? `${MORE_TITLE[more]}: ${data?.keyword || ''}` : ''} onClose={() => setMore(null)} width="max-w-6xl" footer={<Button size="sm" onClick={() => setMore(null)}>Close</Button>}>
        {detail()}
      </Modal>
      <Modal open={allClusters} title={`Keyword strategy: ${data?.clusters?.length || 0} topics`} onClose={() => setAllClusters(false)} width="max-w-3xl" footer={<Button size="sm" onClick={() => setAllClusters(false)}>Close</Button>}>
        <div className="space-y-4">{(data?.clusters || []).map(c => (
          <div key={c.topic}>
            <div className="flex items-baseline justify-between gap-3"><button type="button" className="font-semibold text-slate-900 hover:text-indigo-700 hover:underline cursor-pointer text-left" onClick={() => { setAllClusters(false); go(c.label); }}>{c.label}</button><span className="text-12 text-slate-500 tabular-nums">{c.count} keywords · {fmt(c.volume)} a month</span></div>
            <div className="mt-1 flex flex-wrap gap-1.5">{c.keywords.map(k => <button key={k.keyword} type="button" onClick={() => { setAllClusters(false); go(k.keyword); }} className="rounded-full bg-slate-100 hover:bg-indigo-50 px-2.5 py-0.5 text-12 text-slate-700 cursor-pointer" title={`${fmt(k.volume)} searches a month`}>{k.keyword}</button>)}</div>
          </div>))}</div>
      </Modal>
      {toastNode}
    </div>
  );
}


const page = (title, subtitle, Component) => function Page() {
  return <SeoShell title={title} subtitle={subtitle}>{(b) => <Component key={b.id} b={b} />}</SeoShell>;
};

export { DomainOverviewPage } from './DomainOverview';
export const KeywordGapPage = page('Keyword Gap', "Searches where the Google Maps competitors show and you do not, and where you are weaker or stronger", KeywordGap);
export const CompareDomainsPage = page('Compare Domains', "You and your top competitors side by side", CompareDomains);
export const KeywordOverviewPage = page('Keyword Overview', "One keyword from the Google Keyword Planner: searches per month, trend, competition, cost per click and related ideas", KeywordOverview);
