import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search, Star, ArrowUp, ArrowDown, Plus, RefreshCw, KeyRound, ScanSearch, Swords, Sparkles, Link2, MapPin, Gauge, Layers, FileText, ExternalLink,
  AlertTriangle, CheckCircle2, Minus, TrendingUp, Trophy, Globe, HelpCircle, Lightbulb, Bot, Download, Loader2
} from 'lucide-react';
import { SeoShell, Card, Badge, Button, ErrorNote, ScoreRing, scoreLevel, useAction, useToast, useModulePath, Sk, SkStats, SkTable, SkCard } from './SeoUi';
import { api, useApi, fmt, fmtDateTime } from './seoApi';
import { usePager, Pager, useSorted, SortTh, downloadCsv } from './DataTable';

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
const difficultyWord = (v) => (v == null ? 'No data' : v < 15 ? 'Very easy' : v < 30 ? 'Easy' : v < 50 ? 'Medium' : v < 70 ? 'Challenging' : 'Very hard');
const diffTone = (v) => (v == null ? 'slate' : v < 30 ? 'green' : v < 50 ? 'amber' : 'red');

function Gauge180({ value, note }) {
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  const r = 60, cx = 80, cy = 74, ang = Math.PI * (1 - v / 100);
  const pt = (a) => `${(cx + r * Math.cos(a)).toFixed(1)} ${(cy - r * Math.sin(a)).toFixed(1)}`;
  return (
    <div className="flex flex-col items-center" role="img" aria-label={`Difficulty ${value ?? 'not available'} of 100, ${difficultyWord(value)}`}>
      <svg viewBox="0 0 160 84" className="w-48">
        <path d={`M ${pt(Math.PI)} A ${r} ${r} 0 0 1 ${pt(0)}`} fill="none" stroke="#e2e8f0" strokeWidth="12" strokeLinecap="round" />
        {value != null && v > 0 && <path d={`M ${pt(Math.PI)} A ${r} ${r} 0 0 1 ${pt(ang)}`} fill="none" stroke={value < 30 ? '#10b981' : value < 50 ? '#f59e0b' : '#ef4444'} strokeWidth="12" strokeLinecap="round" />}
        <text x={cx} y={cy - 6} textAnchor="middle" className="fill-slate-900" style={{ fontSize: 26, fontWeight: 700 }}>{value ?? '—'}</text>
      </svg>
      <Badge tone={diffTone(value)}>{difficultyWord(value)}</Badge>
      <p className="text-11.5 text-slate-500 mt-2 text-center">{note || 'From Google Ads: how many advertisers bid on it. It is not the SEO difficulty of page one.'}</p>
    </div>
  );
}

function Bar({ label, value, max, text }) {
  return (
    <div className="flex items-center gap-2 text-12.5"><span className="w-28 truncate text-slate-700" title={label}>{label}</span>
      <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-indigo-400" style={{ width: `${Math.max(3, ((value || 0) / (max || 1)) * 100)}%` }} /></div>
      <span className="w-24 text-right tabular-nums text-slate-700">{text}</span></div>
  );
}

function IdeaGroup({ title, g, go }) {
  const rows = g.rows;
  return (
    <Card pad={false} title={`${title} (${kfmt(g.total)})`}>
      {rows.length === 0 ? <p className="px-4 py-6 text-center text-12.5 text-slate-500">None from Google.</p> : (
        <table className="w-full text-12.5"><thead><tr className="text-left text-11.5 text-slate-500"><th className="px-4 py-1.5 font-medium">Keyword</th><th className="px-2 py-1.5 font-medium text-right">Volume</th><th className="px-4 py-1.5 font-medium text-right">Difficulty</th></tr></thead>
          <tbody>{rows.slice(0, 8).map(r => (
            <tr key={r.keyword} className="border-t border-slate-100"><td className="px-4 py-1.5 truncate max-w-[180px]"><button type="button" className="text-indigo-700 hover:underline cursor-pointer text-left" onClick={() => go(r.keyword)} title="Open its overview">{r.keyword}</button></td>
              <td className="px-2 py-1.5 text-right tabular-nums">{kfmt(r.v)}</td>
              <td className="px-4 py-1.5 text-right">{r.index == null ? '—' : <Badge tone={diffTone(r.index)}>{r.index}</Badge>}</td></tr>))}</tbody></table>
      )}
    </Card>
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
  const [extra, setExtra] = useState([]); // places added from the map search
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
  const pickArea = (x) => { setExtra(l => (l.some(e => e.name === x.name && e.country === activeCountry) ? l : [...l, { name: x.name, country: activeCountry }])); setTyped(''); setFound([]); setPlace(x.name); if (data || q.trim().length > 1) go(data?.keyword ?? q, x.name, activeCountry); };
  const changeCountry = (c) => { setCountry(c); setPlace(''); if (data || q.trim().length > 1) go(data?.keyword ?? q, '', c || home); };
  const [period, setPeriod] = useState('12'); // time filter: the last 12, 6 or 3 months, or one month
  const placesApi = useApi(`/businesses/${b.id}/keyword-workspace/places`);
  const places = placesApi.data?.places || [];
  const go = (k, pl, c) => run('go', async () => { const kw = (k ?? q).trim(); setQ(kw); setData(null); setKd(null); setData(await api(`/businesses/${b.id}/seo/keyword-overview`, { method: 'POST', body: { keyword: kw, place: (pl ?? place) || null, country: (c ?? activeCountry) || null }, timeout: 120000 })); });
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
  useEffect(() => {
    if (!data) { setKd(null); return undefined; }
    let live = true;
    setKd({ state: 'loading' });
    api(`/businesses/${b.id}/seo/keyword-difficulty`, { method: 'POST', body: { keyword: data.keyword, country: data.country || null, volume: data.metrics?.volume ?? null }, timeout: 240000 })
      .then(r => { if (live) setKd({ state: 'ready', ...r }); }).catch(e => { if (live) setKd({ state: 'error', message: e.message || 'Google results could not be read.' }); });
    return () => { live = false; };
  }, [kdKey]); // eslint-disable-line react-hooks/exhaustive-deps -- once per keyword and country
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
  const groupsShown = (k) => { const g = data?.groups?.[k]; return { total: g?.total || 0, rows: (g?.rows || []).map(r => ({ ...r, v: inPeriod(r.monthly, r.volume) })).sort((x, y) => (y.v || 0) - (x.v || 0)) }; };
  const isTracked = (k) => added[k] || (data?.keyword === k && data?.you?.tracked);
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap gap-2">
          <label className="relative flex-1 min-w-[260px]"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && q.trim().length > 1 && go()} placeholder="Enter a keyword, e.g. dentist near me" aria-label="Keyword" className="w-full h-10 pl-9 pr-3 text-13 rounded-lg bg-white ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none" /></label>
          <label className="text-12 font-medium text-slate-500 flex items-center gap-1.5">Country
            <select value={activeCountry} onChange={e => changeCountry(e.target.value === home ? '' : e.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-13 text-slate-800" aria-label="Country">
              {(countriesApi.data || [{ code: home, name: home }]).map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
          <label className="text-12 font-medium text-slate-500 flex items-center gap-1.5">Location
            <select value={place} onChange={e => { setPlace(e.target.value); if (data || q.trim().length > 1) go(data?.keyword ?? q, e.target.value, activeCountry); }} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-13 text-slate-800" aria-label="Location">
              <option value="">Whole country</option>
              {(activeCountry === home ? places.slice(1) : []).map(x => <option key={x.name} value={x.name}>{x.name} ({x.kind.toLowerCase()})</option>)}
              {extra.filter(e => e.country === activeCountry && !(activeCountry === home && places.some(x => x.name === e.name))).map(e => <option key={e.name} value={e.name}>{e.name} (added)</option>)}</select></label>
          <div className="relative">
            <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={typed} onChange={e => search(e.target.value)} placeholder="Search Google Maps for an area…" aria-label="Search an area on Google Maps" className="h-9 w-60 pl-9 pr-3 text-13 rounded-lg border border-slate-300 bg-white" />
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
        <ErrorNote>{error}</ErrorNote>
        <p className="text-11.5 text-slate-400 mt-2">Numbers come from the Google Ads Keyword Planner, for the country and location chosen above. Costs are in the currency of the Google Ads account. It shows how often a keyword is searched and what it costs; who ranks for it is on Position Tracking and Competitors.</p>
      </Card>
      {data && (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-white ring-1 ring-slate-200 px-4 py-3">
            <KeyRound size={16} className="text-indigo-500" />
            <div className="mr-auto min-w-0"><div className="text-16 font-semibold text-slate-900 truncate">{data.keyword}</div>
              <div className="text-12 text-slate-500">{data.place ? `Figures for ${data.place}` : data.country ? `Figures for ${data.country}` : 'Figures for your country'} · Google Ads Keyword Planner · {data.you.rank ? `you rank #${data.you.rank}` : data.you.tracked ? 'tracked, not ranking yet' : 'not tracked yet'}</div></div>
            <div className="flex flex-wrap gap-1.5" aria-label="Search intent">{intentChips(data.intent).map(c => <Badge key={c.k} tone={c.on ? 'indigo' : 'slate'}>{c.k}</Badge>)}</div>
            {!isTracked(data.keyword) && <Button size="sm" icon={Plus} busy={busy === `t${data.keyword}`} onClick={() => track(data.keyword)}>Track</Button>}
          </div>
          {!data.found && <p className="text-13 text-amber-800 bg-amber-50 rounded-lg px-3 py-2">Google's Keyword Planner has no figures for this exact keyword (it is too rare or too new). The ideas below are what it does know.</p>}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <Card title="Difficulty" subtitle={kd?.state === 'ready' && kd.score != null ? 'SEO difficulty from the real top 10 of Google' : 'Advertiser competition on Google, 0 to 100'}>
              {kd?.state === 'ready' && kd.score != null ? (
                <>
                  <Gauge180 value={kd.score} note={`Average Domain Authority ${kd.components.avg_da ?? '—'}, Page Authority ${kd.components.avg_pa ?? '—'}, ${kd.components.top10_strength ?? 0}% of the top 10 have DA 70+, SERP features ${kd.components.serp_features}%. From ${kd.sites_with_figures} of ${kd.sites} sites.`} />
                  <p className="text-11.5 text-slate-500 mt-1 text-center">Advertiser competition (Google Ads): {m.competition_index ?? '—'}</p>
                </>
              ) : (
                <>
                  <Gauge180 value={m.competition_index} />
                  <p className="text-11.5 text-center mt-1 flex items-center justify-center gap-1.5 text-slate-500">{kd?.state === 'loading' ? <><Loader2 size={12} className="animate-spin" />Reading the top 10 on Google for the SEO difficulty…</> : kd?.state === 'error' ? kd.message : ''}</p>
                </>
              )}
            </Card>
            <Card title="Search volume" subtitle={`Average searches per month, ${periodLabel}`}>
              <div className="flex items-baseline gap-2"><div className="text-28 font-bold text-slate-900 tabular-nums">{kfmt(volumeShown)}</div>
                <div className="text-12 text-slate-500">{[pct(m.three_month_change) && `${pct(m.three_month_change)} in 3 months`, pct(m.yoy_change) && `${pct(m.yoy_change)} vs last year`].filter(Boolean).join(' · ')}</div></div>
              {allMonths.length > 0 ? (
                <div className="flex items-end gap-1 h-24 mt-3" role="img" aria-label="Monthly searches for the last 12 months">
                  {allMonths.map(x => <div key={`${x.year}-${x.month}`} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full" title={`${x.month.slice(0, 3)} ${x.year}: ${fmt(x.searches)}`}><div className={`w-full rounded-t ${monthsShown.includes(x) ? 'bg-indigo-500' : 'bg-indigo-200'}`} style={{ height: `${Math.max(4, Math.round((x.searches / peak) * 100))}%` }} /><span className="text-[9px] text-slate-400 mt-0.5">{x.month.slice(0, 1)}</span></div>)}
                </div>
              ) : <p className="text-12 text-slate-400 mt-3">No monthly figures from Google.</p>}
            </Card>
            <Card title="Cost per click" subtitle="What advertisers bid at the top of the page">
              <div className="flex items-baseline gap-2"><div className="text-28 font-bold text-slate-900 tabular-nums">{INR(m.cpc_high)}</div>
                <div className="text-12 text-slate-500">{m.cpc_low != null ? `low ${INR(m.cpc_low)}` : ''}{m.competition && m.competition !== 'UNSPECIFIED' ? ` · competition ${m.competition.toLowerCase()}${m.competition_index != null ? ` (${m.competition_index})` : ''}` : ''}</div></div>
              <div className="mt-3 space-y-1.5">{(data.countries || []).filter(c => c.cpc != null).slice(0, 5).map(c => <Bar key={c.code} label={c.name} value={c.cpc} max={Math.max(...data.countries.map(x => x.cpc || 0), 0.01)} text={INR(c.cpc)} />)}
                {!(data.countries || []).some(c => c.cpc != null) && <p className="text-12 text-slate-400">No bid figures by country.</p>}</div>
            </Card>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <Card title="Global volume by country" subtitle="Searches per month in each country Google reports">
              {countriesShown.length === 0 ? <p className="text-12 text-slate-400">Google has no figures for this keyword in other countries.</p> : (
                <div className="space-y-1.5">{countriesShown.map(c => <Bar key={c.code} label={c.name} value={c.v} max={countriesShown[0].v} text={`${kfmt(c.v)} · ${c.share}%`} />)}</div>
              )}
            </Card>
            {[['similar', 'Similar keywords'], ['related', 'Related keywords']].map(([k, title]) => <IdeaGroup key={k} title={title} g={groupsShown(k)} go={go} />)}
          </div>
          {kd?.state === 'ready' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <div className="lg:col-span-2"><Card pad={false} title="SERP overview" subtitle={`The top ${kd.organic.length} results on Google for "${data.keyword}"`}>
                <table className="w-full text-12.5"><thead><tr className="text-left text-11.5 text-slate-500"><th className="px-4 py-1.5 font-medium w-8">#</th><th className="px-2 py-1.5 font-medium">Page</th><th className="px-2 py-1.5 font-medium text-right">DA</th><th className="px-2 py-1.5 font-medium text-right">PA</th><th className="px-4 py-1.5 font-medium text-right">Linking sites</th></tr></thead>
                  <tbody>{kd.organic.map(o => (
                    <tr key={`${o.position}${o.url}`} className="border-t border-slate-100"><td className="px-4 py-1.5 tabular-nums text-slate-500">{o.position}</td>
                      <td className="px-2 py-1.5 max-w-[320px]"><a href={o.url} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline block truncate" title={o.title}>{o.title || o.url}</a><span className="text-11.5 text-slate-500">{o.site}</span></td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{o.da ?? '—'}</td><td className="px-2 py-1.5 text-right tabular-nums">{o.pa ?? '—'}</td><td className="px-4 py-1.5 text-right tabular-nums">{kfmt(o.rd)}</td></tr>))}</tbody></table>
                <div className="px-4 py-2.5 border-t border-slate-100 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-12 text-slate-600">
                  <span>Authority <b className="text-slate-900">{kd.components.authority_strength ?? '—'}</b></span><span>SERP features <b className="text-slate-900">{kd.components.serp_features}%</b></span>
                  <span>Top 10 with DA 70+ <b className="text-slate-900">{kd.components.top10_strength ?? '—'}%</b></span><span>Content strength <b className="text-slate-900">{kd.content?.cc ?? '—'}</b></span>
                  <span>Pages with the keyword in title <b className="text-slate-900">{kd.content?.relevance ?? '—'}%</b></span><span>Average length <b className="text-slate-900">{kd.content?.avg_words ?? '—'} words</b></span>
                  <span>Updated in a year <b className="text-slate-900">{kd.content?.freshness ?? '—'}%</b></span><span>Intent C/T/N <b className="text-slate-900">{kd.intent?.commercial}/{kd.intent?.transactional}/{kd.intent?.navigational}</b></span>
                </div>
                <p className="px-4 pb-2 text-11.5 text-slate-500">{kd.note} DA, PA and linking sites are Moz's figures; a dash means no figure.</p>
              </Card></div>
              <Card title={`People also ask (${kd.questions.length})`}>
                {kd.questions.length === 0 ? <p className="text-12.5 text-slate-500">Google shows none for this search.</p> : <ul className="space-y-1.5 text-12.5">{kd.questions.map(x => <li key={x}><button type="button" className="text-indigo-700 hover:underline text-left cursor-pointer" onClick={() => go(x)}>{x}</button></li>)}</ul>}
                {kd.related.length > 0 && <><div className="text-12 font-semibold text-slate-600 mt-3 mb-1">Related searches</div><div className="flex flex-wrap gap-1.5">{kd.related.map(x => <button key={x} type="button" onClick={() => go(x)} className="px-2 py-0.5 rounded-full bg-slate-100 text-12 text-slate-700 hover:bg-indigo-50 cursor-pointer">{x}</button>)}</div></>}
              </Card>
              <div className="lg:col-span-3"><Card title={`Ads on this search (${kd.ads.length})`} subtitle="What advertisers show on Google's results page for the keyword, right now">
                {kd.ads.length === 0 ? <p className="text-12.5 text-slate-500">No ads were shown on this search when it was read.</p> : (
                  <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">{kd.ads.map((a, n) => <div key={n} className="rounded-lg ring-1 ring-slate-200 p-3"><div className="text-11.5 text-slate-500 truncate">Ad · {a.site || a.url}</div><div className="text-13 font-semibold text-indigo-700">{a.title}</div><div className="text-12 text-slate-600 mt-0.5">{a.description}</div></div>)}</div>)}
              </Card></div>
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <IdeaGroup title="Questions" g={groupsShown('questions')} go={go} />
            <div className="lg:col-span-2"><Card title="Not available from Google">
              <p className="text-13 text-slate-600">These sections have no source connected, so they are not shown, rather than made up:</p>
              <ul className="mt-2 grid sm:grid-cols-2 gap-x-6 gap-y-1 text-13 text-slate-500 list-disc pl-5"><li>Ranking dynamics (use Position Tracking for yours)</li><li>Ads history over the months</li><li>Domain traffic and traffic cost</li></ul>
              <div className="mt-3 flex gap-2"><Button size="sm" onClick={() => navigate('/rank-tracking')}>Position Tracking</Button><Button size="sm" busy={busy === 'ws'} onClick={() => toWorkspace(['similar', 'related', 'questions'].flatMap(k => data.groups?.[k]?.rows || []).map(r => ({ keyword: r.keyword, volume: r.volume })))}>Add all ideas to the Keyword Workspace</Button></div>
            </Card></div>
          </div>
        </>
      )}
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
