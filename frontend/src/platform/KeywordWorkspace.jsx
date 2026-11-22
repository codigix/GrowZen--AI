import React, { useMemo, useState } from 'react';
import { usePager, Pager } from './DataTable';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowRight, ArrowUp, Check, CheckCircle2, Download, EyeOff, Loader2, RefreshCw, Search, Sparkles, Star, Undo2, X } from 'lucide-react';
import { Card, Button, Badge, ErrorNote, Modal, SkList, useAction, useToast } from './SeoUi';
import { api, useApi } from './seoApi';
import { Act, Head } from './TableBits';

const TAG_TONE = { gap: 'red', win: 'green', almost: 'amber', shared: 'blue', yours: 'gray', idea: 'violet' };
const TAG_SHORT = { gap: 'Gap', win: 'Win', almost: 'Almost', shared: 'Shared', yours: 'Yours', idea: 'Idea' };
const TAG_HELP = { gap: 'Competitors use it, you do not', win: 'You already rank in the top 3', almost: 'You are on page 2 of Google', shared: 'You and a competitor both use it', yours: 'Only your own places mention it', idea: 'Suggested by Google or AI' };
const SRC_SHORT = { website: 'Website', search_console: 'Search Console', profile: 'Profile', competitors: 'Competitor', google_ideas: 'Google', planner: 'Planner', area: 'Area', brief: 'Summary', ai: 'AI' };
const SRC_TONE = { website: 'blue', search_console: 'green', profile: 'amber', competitors: 'red', google_ideas: 'gray', planner: 'blue', area: 'amber', brief: 'green', ai: 'violet' };
const n0 = (v) => (v == null ? '—' : v.toLocaleString('en-US'));
const PAGE = 50;

/** Where your site stands on Google for a keyword: the average position as a whole place, and which page of Google that is. */
const BANDS = [['top3', 'Top 3', (n) => n <= 3, 'bg-emerald-100 text-emerald-800'], ['page1', 'Page 1', (n) => n > 3 && n <= 10, 'bg-green-50 text-green-800'], ['page2', 'Page 2', (n) => n > 10 && n <= 20, 'bg-amber-50 text-amber-800'],
  ['page3', 'Page 3+', (n) => n > 20, 'bg-slate-100 text-slate-600']];
const bandOf = (rank) => (rank == null ? null : BANDS.find(b => b[2](Math.max(1, Math.round(rank)))) || null);
const FIRST = { keyword: 'asc', rank: 'asc', difficulty: 'asc' }; // the first click on these puts the best first: A to Z, position 1 first, easiest first

function SortTh({ id, sort, setSort, children, right, what, why, from }) {
  const on = sort.key === id;
  return (
    <th className={`px-3 py-2 ${right ? 'text-right' : 'text-left'}`} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => setSort(s => ({ key: id, dir: s.key === id ? (s.dir === 'asc' ? 'desc' : 'asc') : (FIRST[id] || 'desc') }))} className={`inline-flex items-center gap-1 cursor-pointer hover:text-slate-800 ${on ? 'text-slate-900' : ''}`}>
        <Head what={what} why={why} from={from} right={right}>{children}</Head>{on && (sort.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    </th>
  );
}

/** One chip: a way to look at the list, with how many keywords it holds. */
function View({ on, onClick, children, count, tone = 'slate' }) {
  const pill = { slate: 'bg-slate-100 text-slate-600', red: 'bg-rose-50 text-rose-700', green: 'bg-emerald-50 text-emerald-700', indigo: 'bg-indigo-50 text-indigo-700', amber: 'bg-amber-50 text-amber-700' }[tone];
  return (
    <button type="button" role="tab" aria-selected={on} onClick={onClick} className={`-mb-px h-11 px-4 text-13.5 font-semibold cursor-pointer inline-flex items-center gap-2 whitespace-nowrap border-b-2 transition-colors ${on ? 'border-indigo-600 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'}`}>
      {children}<span className={`min-w-[1.5rem] px-1.5 py-0.5 rounded-full text-11.5 text-center tabular-nums ${on ? 'bg-slate-900 text-white' : pill}`}>{count}</span>
    </button>
  );
}

/** Collect keywords: choose the places, run them one after another, see each result. */
function CollectModal({ d, open, onClose, onDone }) {
  const [chosen, setChosen] = useState(null);
  const [progress, setProgress] = useState({});
  const [info, setInfo] = useState('');
  const [busy, error, run] = useAction();
  const kinds = d.sources.map(s => s.kind);
  const on = chosen || kinds;
  const toggle = (k) => setChosen(on.includes(k) ? on.filter(x => x !== k) : [...on, k]);
  const go = () => run('go', async () => {
    setProgress(Object.fromEntries(on.map(k => [k, 'running'])));
    let added = 0;
    for (const k of on) { // one place at a time, so each shows its own result as it finishes
      const out = await api(`/businesses/${d.bid}/keyword-workspace/collect`, { method: 'POST', body: { sources: [k] }, timeout: 240000 });
      setProgress(p => ({ ...p, [k]: out.report[k] }));
      if (out.report.summary?.note) setInfo(out.report.summary.note); // the business summary was missing and was built first
      added += out.report[k].new;
      onDone(false);
    }
    onDone(true, added);
  });
  return (
    <Modal open={open} onClose={onClose} width="max-w-xl" title="Collect keywords"
      footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" icon={RefreshCw} busy={busy === 'go'} disabled={!on.length} onClick={go}>{d.totals.all ? 'Collect again' : 'Collect'} ({on.length})</Button></>}>
      <p className="text-13 text-slate-600 mb-3">Each place adds to one list. A keyword found in several places stays one row with every place shown.</p>
      <ErrorNote>{error}</ErrorNote>
      {info && <p role="status" className="mb-3 text-12.5 text-emerald-800 bg-emerald-50 rounded px-3 py-1.5">{info}</p>}
      <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-inset ring-slate-200">
        {d.sources.map(s => {
          const p = progress[s.kind];
          return (
            <li key={s.kind} className="px-3 py-2.5 flex items-center gap-3">
              <input type="checkbox" aria-label={s.label} checked={on.includes(s.kind)} onChange={() => toggle(s.kind)} disabled={busy === 'go'} className="w-4 h-4 accent-indigo-600" />
              <div className="min-w-0 flex-1">
                <div className="text-13 font-semibold text-slate-900">{s.label}</div>
                <div className="text-12 text-slate-500">{s.count ? `${s.count} in the list` : 'Not collected yet'}</div>
              </div>
              {p === 'running' ? <span className="text-12 text-indigo-700 inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" />Reading…</span>
                : p ? <span className={`text-12 text-right max-w-[220px] ${p.note ? 'text-amber-700' : 'text-emerald-700'}`}>{p.note || `${p.found} found, ${p.new} new`}</span> : null}
            </li>);
        })}
      </ul>
      <p className="mt-3 text-12.5 text-slate-600">Competitors: {d.competitors.done ? d.competitors.domains.join(', ') : <>none saved. <Link to="/competitor-finder" className="font-semibold text-indigo-700 underline">Choose them first</Link> for gaps and competitor keywords.</>}</p>
      {!d.volumes && <p className="mt-2 text-12 text-slate-500">Google Ads is not connected, so there are no search volumes.</p>}
    </Modal>
  );
}

export default function KeywordWorkspace({ b, onUse }) {
  const [params] = useSearchParams();
  const [view, setView] = useState(params.get('tag') === 'gap' ? 'gap' : 'open');
  const [source, setSource] = useState(params.get('source') || '');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ key: 'volume', dir: 'desc' }); // ranked by monthly searches, highest first; the other headings re-sort it
  const [band, setBand] = useState(''); // rank filter: top3 | page1 | page2 | page3 | none
  const [limit, setLimit] = useState(PAGE);
  const [sel, setSel] = useState(() => new Set());
  const [collecting, setCollecting] = useState(false);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const show = view === 'picked' ? 'picked' : view === 'dismissed' ? 'dismissed' : 'open';
  const tag = view === 'gap' || view === 'almost' ? view : '';
  const qs = new URLSearchParams({ show, ...(source && { source }), ...(tag && { tag }), ...(q.trim() && { q: q.trim() }) }).toString();
  const r = useApi(`/businesses/${b.id}/keyword-workspace?${qs}`);
  const d = r.data;
  const rows = useMemo(() => {
    let list = [...(d?.items || [])];
    if (view === 'suggested') list = list.filter(i => i.suggested);
    if (band) list = list.filter(i => (band === 'none' ? i.rank == null : i.rank != null && bandOf(i.rank)?.[0] === band));
    const v = (i) => (sort.key === 'keyword' ? i.keyword : i[sort.key]);
    list.sort((a, c) => {
      const x = v(a), y = v(c);
      if (x == null && y == null) return 0;
      if (x == null) return 1; // no figure (not ranking, no volume...) always at the end, not at the top
      if (y == null) return -1;
      const o = typeof x === 'string' ? x.localeCompare(y) : x - y;
      if (o === 0) return (c.score ?? 0) - (a.score ?? 0) || a.keyword.localeCompare(c.keyword); // the same figure: the better opportunity first, then A to Z
      return sort.dir === 'asc' ? o : -o;
    });
    return list;
  }, [d, sort, view, band]);
  const pager = usePager(rows, { size: PAGE, resetKey: `${view}|${band}|${q}|${source}|${sort.key}|${sort.dir}` });
  const topVolume = useMemo(() => Math.max(1, ...rows.map(i => i.volume || 0)), [rows]);
  if (r.error) return <Card><ErrorNote>{r.error.message}</ErrorNote></Card>;
  if (!d) return <SkList rows={6} />;

  const base = `/businesses/${b.id}/keyword-workspace`;
  const count = (t) => d.tags.find(x => x.tag === t)?.count || 0;
  const suggestedAll = rows.filter(i => i.suggested && !i.picked);
  const shown = pager.rows;
  const allOn = shown.length > 0 && shown.every(i => sel.has(i.id));
  const toggle = (id) => setSel(s => { const x = new Set(s); x.has(id) ? x.delete(id) : x.add(id); return x; });
  const ids = [...sel];
  const act = (kind, list, msg) => run(kind, async () => { await api(`${base}/${kind}`, { method: 'POST', body: { ids: list } }); setSel(new Set()); r.reload(true); toast(msg); });
  const pick = (list) => act('pick', list, `${list.length} keyword${list.length === 1 ? '' : 's'} saved to your list`);
  const go = (v) => { setView(v); setLimit(PAGE); setSel(new Set()); };
  const empty = d.totals.all === 0;
  const sourcesWith = d.sources.filter(s => s.count);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 pb-20">
      <ErrorNote>{error}</ErrorNote>

      {/* What is in the list, the one thing to do first, and the way out of the page; the views of the list are the tabs under it */}
      <div className="rounded-xl bg-white ring-1 ring-slate-200 shadow-sm">
        <div className="px-5 py-4 flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="min-w-0">
            <div className="text-18 font-semibold text-slate-900 leading-tight">{empty ? 'No keywords yet' : <><span className="tabular-nums">{d.totals.all}</span> keywords</>}</div>
            <div className="mt-0.5 text-13 text-slate-500">{empty ? 'Collect them from your website, Google and your competitors.' : `Collected from ${sourcesWith.length} place${sourcesWith.length === 1 ? '' : 's'}. ${d.totals.picked} picked, ${d.totals.open} still to look at.`}</div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Link to="/keyword-management/ai"><Button>Find more ideas</Button></Link>
            {!empty && <Button icon={Download} onClick={() => exportCsv(rows)} disabled={!rows.length}>Export</Button>}
            <Button variant="primary" icon={RefreshCw} onClick={() => setCollecting(true)}>{empty ? 'Collect keywords' : 'Collect again'}</Button>
          </div>
        </div>
        {!empty && (
      <div role="tablist" aria-label="Which keywords" className="flex overflow-x-auto px-2 border-t border-slate-200">
        <View on={view === 'open'} onClick={() => go('open')} count={d.totals.open}>To look at</View>
        <View on={view === 'suggested'} onClick={() => go('suggested')} count={d.totals.suggested || 0} tone="indigo"><Sparkles size={13} className="text-amber-500" />Suggested</View>
        <View on={view === 'gap'} onClick={() => go('gap')} count={count('gap')} tone="red">Gaps</View>
        <View on={view === 'almost'} onClick={() => go('almost')} count={count('almost')} tone="amber">Almost there</View>
        <View on={view === 'picked'} onClick={() => go('picked')} count={d.totals.picked} tone="green">Picked</View>
        {d.totals.dismissed > 0 && <View on={view === 'dismissed'} onClick={() => go('dismissed')} count={d.totals.dismissed}>Set aside</View>}
      </div>
        )}
      </div>

      {empty ? (
        <Card><div className="py-12 text-center">
          <Sparkles size={28} className="mx-auto text-indigo-500" />
          <h3 className="mt-3 text-16 font-semibold text-slate-900">Your keyword list is empty</h3>
          <p className="mt-1 text-13 text-slate-500 max-w-md mx-auto">Press <b>Collect keywords</b>. We read your website, your Google searches, your services, your competitors and Google, and put everything in one list with where each came from.</p>
        </div></Card>
      ) : (
        <>

          <Card pad={false}>
            <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
              <label className="relative"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" /><input value={q} onChange={e => { setQ(e.target.value); setLimit(PAGE); }} placeholder="Search keywords" aria-label="Search keywords" className="h-9 pl-8 pr-3 text-13 rounded-lg ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none w-60" /></label>
              {q && <button type="button" onClick={() => setQ('')} className="text-12.5 font-semibold text-indigo-700 hover:underline inline-flex items-center gap-1 cursor-pointer"><X size={12} />Clear</button>}
              {view === 'open' || view === 'suggested' ? (
                suggestedAll.length > 0 && <Button size="sm" className="ml-auto" icon={Star} busy={busy === 'pick'} onClick={() => pick(suggestedAll.map(i => i.id))} title="The best-looking keywords: searches, ease, gaps and how many places agree">Pick {suggestedAll.length} suggested</Button>
              ) : null}
            </div>

            {rows.length === 0 ? (
              <div className="py-12 text-center text-13 text-slate-500">Nothing here. <button type="button" onClick={() => { setSource(''); setQ(''); go('open'); }} className="font-semibold text-indigo-700 hover:underline cursor-pointer">Show everything to look at</button></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-13 min-w-[760px]">
                  <thead className="bg-slate-50 text-11.5 uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="w-10 px-3 py-2"><input type="checkbox" aria-label="Select all shown" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(shown.map(i => i.id)))} /></th>
                      <SortTh id="keyword" sort={sort} setSort={setSort} what="A search people type into Google." why="Click the name to check its searches, cost and related ideas. Click the heading to sort A to Z." from="your website, Search Console, your profile, competitor sites, Google suggestions and AI.">Keyword</SortTh>
                      <SortTh id="volume" sort={sort} setSort={setSort} right what="How many times a month people search it in your country." why="Shows which keywords are worth the effort." from="Google Ads Keyword Planner (needs Google Ads connected). Blank when Google gave no figure.">Searches / mo</SortTh>
                      <SortTh id="difficulty" sort={sort} setSort={setSort} right what="How hard it is to rank for it, 0 to 100. Higher is harder." why="Pick easier ones first." from="the advertiser competition Google Ads reports for the keyword.">Difficulty</SortTh>
                      <th className="px-3 py-2 text-left"><Head what="What kind of opportunity it is: Gap (competitors use it, you do not), Win (you are in the top 3), Almost (page 2), Shared, Yours, Idea." why="Start with Gaps and Almost." from="comparing your own places with the competitor sites and Google results collected.">Kind</Head></th>
                      <th className="px-3 py-2 text-left"><Head what="The places this keyword was found." why="A keyword found in several places is more trustworthy." from="the collect step: hover a badge for the detail.">Found in</Head></th>
                      <SortTh id="rank" sort={sort} setSort={setSort} right what="Your average position on Google for it, last 90 days." why="Shows where you already show up." from="Google Search Console. Blank when Google has not shown your site for it.">Your rank</SortTh>
                      <th className="px-3 py-2 text-right"><Head right what="Things you can do with this keyword right here." why="Pick saves it to your list; Set aside hides it; Check opens its numbers.">Actions</Head></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {shown.map(i => (
                      <tr key={i.id} onClick={() => toggle(i.id)} className={`cursor-pointer ${sel.has(i.id) ? 'bg-indigo-50/60' : 'hover:bg-slate-50'}`}>
                        <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${i.keyword}`} checked={sel.has(i.id)} onChange={() => toggle(i.id)} /></td>
                        <td className="px-3 py-2.5 min-w-[220px]">
                          <span className="inline-flex items-center gap-1.5">
                            {i.suggested && <Sparkles size={12} className="text-amber-500 shrink-0" aria-label="Suggested" />}
                            <Link to={`/keyword-overview?q=${encodeURIComponent(i.keyword)}`} onClick={e => e.stopPropagation()} title="Check its searches, cost and related ideas" className="font-semibold text-slate-900 hover:text-indigo-700 hover:underline">{i.keyword}</Link>
                            {i.picked && <Badge tone="green">Picked</Badge>}
                          </span>
                          {i.fit?.why && <span className={`block text-11.5 ${i.fit.fit === 'no' ? 'text-amber-700' : 'text-slate-500'}`}>{i.fit.fit === 'no' ? 'Hidden: ' : i.fit.fit === 'maybe' ? 'Check: ' : i.fit.for ? `Fits ${i.fit.for}: ` : 'Fits: '}{i.fit.why}</span>}
                          {i.competitors.length > 0 && <span className="block text-11.5 text-slate-500">used by {i.competitors.slice(0, 2).join(', ')}{i.competitors.length > 2 ? ` +${i.competitors.length - 2}` : ''}</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right" title="Searches per month in your country (Google Ads Keyword Planner)"><div className="tabular-nums">{n0(i.volume)}</div>{i.volume > 0 && <div className="mt-1 h-1 rounded-full bg-slate-100 ml-auto w-16"><div className="h-1 rounded-full bg-slate-400" style={{ width: `${Math.max(5, (i.volume / topVolume) * 100)}%` }} /></div>}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums" title="0 to 100, higher is harder (from Google Ads competition)">{i.difficulty ?? '—'}</td>
                        <td className="px-3 py-2.5"><span title={TAG_HELP[i.tag]}><Badge tone={TAG_TONE[i.tag]}>{TAG_SHORT[i.tag]}</Badge></span></td>
                        <td className="px-3 py-2.5">
                          <span className="inline-flex flex-wrap gap-1" title={i.sources.map(s => `${s.label}${s.detail ? ': ' + s.detail : ''}`).join('\n')}>
                            {i.sources.slice(0, 2).map((s, n) => <Badge key={n} tone={SRC_TONE[s.kind] || 'gray'}>{SRC_SHORT[s.kind] || s.kind}</Badge>)}
                            {i.sources.length > 2 && <span className="text-12 text-slate-500 self-center">+{i.sources.length - 2}</span>}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap" title={i.rank != null ? `Average position ${i.rank.toFixed(1)} on Google over the last 90 days${i.impressions ? `: ${i.impressions.toLocaleString('en-IN')} impressions, ${(i.clicks || 0).toLocaleString('en-IN')} clicks` : ''} (Search Console)` : 'Google has not shown your site for this keyword in the last 90 days'}>
                          {i.rank != null ? (() => { const n = Math.max(1, Math.round(i.rank)); const bd = bandOf(i.rank); return <span className="inline-flex items-center justify-end gap-1.5"><span className={`font-semibold tabular-nums ${n <= 10 ? 'text-emerald-700' : 'text-slate-800'}`}>#{n}</span>{bd && <span className={`rounded-full px-1.5 py-px text-11 font-semibold ${bd[3]}`}>{bd[1]}</span>}</span>; })() : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                          <span className="inline-flex gap-1.5">
                            {!i.picked && show !== 'dismissed' && <Act icon={Check} tone="green" tip="Pick: save this keyword to your list (My Keywords) so you can give it a page and track it." onClick={() => pick([i.id])} />}
                            {show === 'dismissed' ? <Act icon={Undo2} tone="slate" tip="Put back: return it to the list to look at." onClick={() => act('restore', [i.id], 'Put back in the list')} />
                              : !i.picked && <Act icon={EyeOff} tone="amber" tip="Set aside: hide it from this list. It stays under Set aside if you change your mind." onClick={() => act('dismiss', [i.id], 'Set aside')} />}
                            <Link to={`/keyword-overview?q=${encodeURIComponent(i.keyword)}`}><Act icon={Search} tone="sky" tip="Check: open its searches per month, cost and related ideas." /></Link>
                          </span>
                        </td>
                      </tr>))}
                  </tbody>
                </table>
              </div>
            )}
            <Pager p={pager} label="keywords" />
          </Card>

          {/* What to do next */}
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[220px] text-13 text-indigo-950">
              {d.totals.picked ? <><b>{d.totals.picked} keyword{d.totals.picked === 1 ? '' : 's'} picked.</b> Next, give each one a page on your website.</> : <><b>Pick the keywords worth working on.</b> Tick the rows you want, or pick the suggested ones.</>}
            </div>
            <Button variant="primary" icon={ArrowRight} disabled={!d.totals.picked} onClick={() => onUse('mapping')}>Map them to pages</Button>
          </div>
        </>
      )}

      {ids.length > 0 && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-30 max-w-[calc(100vw-32px)]">
          <div role="toolbar" aria-label="Selected keywords" className="bg-slate-900 text-white rounded-xl shadow-xl px-4 py-2.5 flex flex-wrap items-center gap-3">
            <span className="text-13 font-semibold">{ids.length} selected</span>
            {view !== 'picked' && <Button size="sm" variant="primary" icon={CheckCircle2} busy={busy === 'pick'} onClick={() => pick(ids)}>Pick</Button>}
            {view === 'dismissed' ? <Button size="sm" icon={Undo2} onClick={() => act('restore', ids, 'Put back in the list')}>Put back</Button>
              : <Button size="sm" icon={EyeOff} busy={busy === 'dismiss'} onClick={() => act('dismiss', ids, `${ids.length} set aside`)}>Set aside</Button>}
            <button type="button" onClick={() => setSel(new Set())} className="text-12.5 text-slate-300 hover:text-white underline cursor-pointer">Clear</button>
          </div>
        </div>
      )}
      <CollectModal d={{ ...d, bid: b.id }} open={collecting} onClose={() => setCollecting(false)} onDone={(final, added) => { r.reload(true); if (final) toast(`${added} new keyword${added === 1 ? '' : 's'} collected`); }} />
      {toastNode}
    </div>
  );
}

function exportCsv(items) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Keyword', 'Searches per month', 'Difficulty', 'Your rank', 'Kind', 'Score', 'Sources', 'Competitors'], ...items.map(i => [i.keyword, i.volume, i.difficulty, i.rank, i.tag, i.score, i.sources.map(s => s.label).join('; '), i.competitors.join('; ')])];
  const blob = new Blob([rows.map(r => r.map(cell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'keywords.csv'; a.click(); URL.revokeObjectURL(a.href);
}
