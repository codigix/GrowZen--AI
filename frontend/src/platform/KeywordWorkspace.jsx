import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowRight, ArrowUp, CheckCircle2, ChevronDown, ChevronUp, Download, EyeOff, Loader2, RefreshCw, Search, Sparkles, Star, Swords, Undo2, X } from 'lucide-react';
import { Card, Button, Badge, ErrorNote, SkList, useAction, useToast } from './SeoUi';
import { api, useApi } from './seoApi';

const TAG_TONE = { gap: 'red', win: 'green', almost: 'amber', shared: 'blue', yours: 'gray', idea: 'violet' };
const TAG_SHORT = { gap: 'Gap', win: 'Win', almost: 'Almost', shared: 'Shared', yours: 'Yours only', idea: 'Idea' };
const TAG_HELP = { gap: 'Competitors use it, you do not', win: 'You already rank in the top 3', almost: 'You are on page 2 of Google', shared: 'You and a competitor both use it', yours: 'Only your own places mention it', idea: 'Suggested by Google or AI' };
const SRC_SHORT = { website: 'Website', search_console: 'Search Console', profile: 'Profile', competitors: 'Competitor', google_ideas: 'Google', ai: 'AI' };
const SRC_TONE = { website: 'blue', search_console: 'green', profile: 'amber', competitors: 'red', google_ideas: 'gray', ai: 'violet' };
const n0 = (v) => (v == null ? '—' : v.toLocaleString('en-US'));
const PAGE = 50;

function SourceBadges({ sources }) {
  return (
    <div className="flex flex-wrap gap-1">
      {sources.map((s, i) => <span key={i} title={`${s.label}${s.detail ? ': ' + s.detail : ''}`}><Badge tone={SRC_TONE[s.kind] || 'gray'}>{s.kind === 'competitors' && s.label && s.label !== 'Competitor research' ? s.label : SRC_SHORT[s.kind] || s.kind}</Badge></span>)}
    </div>
  );
}

function Pill({ on, onClick, children, title }) {
  return <button type="button" role="tab" aria-selected={on} title={title} onClick={onClick} className={`h-8 px-3 rounded-full text-12.5 font-semibold cursor-pointer ring-1 ring-inset transition-colors ${on ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}>{children}</button>;
}

/** One clickable number above the list: it filters the list to what it counts. */
function Tile({ label, value, sub, tone = 'slate', on, onClick }) {
  const c = { slate: 'text-slate-900', red: 'text-rose-600', green: 'text-emerald-600', amber: 'text-amber-600', indigo: 'text-indigo-700' }[tone];
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={`text-left rounded-xl border bg-white px-4 py-3 cursor-pointer transition ${on ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-200 hover:border-slate-300'}`}>
      <div className="text-12 font-semibold text-slate-500">{label}</div>
      <div className={`text-24 font-bold tabular-nums leading-tight ${c}`}>{value}</div>
      <div className="text-11.5 text-slate-500 truncate">{sub}</div>
    </button>
  );
}

function SortTh({ id, sort, setSort, children, right }) {
  const on = sort.key === id;
  return (
    <th className={`px-3 py-2 ${right ? 'text-right' : 'text-left'}`} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => setSort(s => ({ key: id, dir: s.key === id && s.dir === 'desc' ? 'asc' : 'desc' }))} className={`inline-flex items-center gap-1 uppercase tracking-wide cursor-pointer hover:text-slate-800 ${on ? 'text-slate-900' : ''}`}>
        {children}{on && (sort.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    </th>
  );
}

/** Where the keywords come from: one chip per place, collected one after another with live progress. Folds away once the list has keywords. */
function Sources({ d, run, busy, progress, collect, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const running = busy === 'all' || busy === 'one';
  return (
    <Card title="Where the keywords come from" subtitle={`${d.totals.all} keyword${d.totals.all === 1 ? '' : 's'} from ${d.sources.filter(s => s.count).length} of ${d.sources.length} places`}
      action={<div className="flex items-center gap-2">
        <Button size="sm" variant="primary" icon={RefreshCw} busy={busy === 'all'} disabled={running} onClick={() => collect(null)}>{d.totals.all ? 'Refresh all' : 'Collect from all'}</Button>
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={open ? 'Hide the places' : 'Show the places'} className="h-8 w-8 rounded-lg ring-1 ring-inset ring-slate-300 text-slate-500 hover:bg-slate-50 flex items-center justify-center cursor-pointer">{open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button>
      </div>}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-13">
        <span className="inline-flex items-center gap-1.5 text-slate-600"><Swords size={14} className="text-slate-400" />Competitors:</span>
        {d.competitors.done ? <>{d.competitors.domains.map(x => <Badge key={x} tone="gray">{x}</Badge>)}<Link to="/competitor-finder" className="text-12.5 font-semibold text-indigo-700 hover:underline">Change</Link></>
          : <span className="text-amber-700">none saved yet. Gaps and competitor keywords need them. <Link to="/competitor-finder" className="font-semibold underline">Find competitors</Link></span>}
      </div>
      {open && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {d.sources.map(s => {
            const p = progress[s.kind];
            return (
              <div key={s.kind} className="rounded-lg ring-1 ring-inset ring-slate-200 p-3 flex flex-col gap-1.5">
                <div className="flex items-center gap-2"><Badge tone={SRC_TONE[s.kind]}>{SRC_SHORT[s.kind]}</Badge><span className="text-13 font-semibold text-slate-900 truncate" title={s.label}>{s.label}</span></div>
                <div className="text-12 text-slate-500">{s.count ? `${s.count} keyword${s.count === 1 ? '' : 's'} in the list` : 'Not collected yet'}</div>
                {p === 'running' && <div className="text-12 text-indigo-700 inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" />Reading…</div>}
                {p && p !== 'running' && <div className={`text-12 ${p.note ? 'text-amber-700' : 'text-emerald-700'}`}>{p.note || `${p.found} found, ${p.new} new`}</div>}
                <div className="mt-auto pt-1"><Button size="sm" disabled={running} busy={busy === 'one' && p === 'running'} onClick={() => collect([s.kind])}>{s.count ? 'Refresh' : 'Collect'}</Button></div>
              </div>);
          })}
        </div>
      )}
      {!d.volumes && <p className="mt-3 text-12 text-slate-500">Google Ads is not connected, so there are no search volumes. Keywords are ordered by where they were found.</p>}
    </Card>
  );
}

export default function KeywordWorkspace({ b, onUse }) {
  const [params] = useSearchParams();
  const [source, setSource] = useState(params.get('source') || '');
  const [tag, setTag] = useState(params.get('tag') || '');
  const [q, setQ] = useState('');
  const [show, setShow] = useState('open');
  const [sort, setSort] = useState({ key: 'score', dir: 'desc' });
  const [limit, setLimit] = useState(PAGE);
  const [sel, setSel] = useState(() => new Set());
  const [progress, setProgress] = useState({});
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const qs = new URLSearchParams({ show, ...(source && { source }), ...(tag && { tag }), ...(q.trim() && { q: q.trim() }) }).toString();
  const r = useApi(`/businesses/${b.id}/keyword-workspace?${qs}`);
  const d = r.data;
  const rows = useMemo(() => {
    const list = [...(d?.items || [])];
    const v = (i) => (sort.key === 'keyword' ? i.keyword : sort.key === 'rank' ? (i.rank ?? 999) : (i[sort.key] ?? -1));
    list.sort((a, c) => { const x = v(a); const y = v(c); const o = typeof x === 'string' ? x.localeCompare(y) : x - y; return sort.dir === 'asc' ? o : -o; });
    return list;
  }, [d, sort]);
  const topVolume = useMemo(() => Math.max(1, ...rows.map(i => i.volume || 0)), [rows]);
  const suggested = useMemo(() => rows.filter(i => i.suggested && !i.picked), [rows]);
  if (r.error) return <Card><ErrorNote>{r.error.message}</ErrorNote></Card>;
  if (!d) return <SkList rows={6} />;

  const base = `/businesses/${b.id}/keyword-workspace`;
  const kinds = (t) => d.tags.find(x => x.tag === t)?.count || 0;
  const collect = (sources) => run(sources ? 'one' : 'all', async () => {
    const list = sources || d.sources.map(s => s.kind);
    setProgress(Object.fromEntries(list.map(k => [k, 'running'])));
    let added = 0;
    for (const k of list) { // one place at a time, so each shows its own result as it finishes
      const out = await api(`${base}/collect`, { method: 'POST', body: { sources: [k] }, timeout: 240000 });
      setProgress(p => ({ ...p, [k]: out.report[k] }));
      added += out.report[k].new;
      r.reload(true);
    }
    toast(`${added} new keyword${added === 1 ? '' : 's'} collected`);
  });
  const act = (kind, ids, msg) => run(kind, async () => { await api(`${base}/${kind}`, { method: 'POST', body: { ids } }); setSel(new Set()); r.reload(true); toast(msg); });
  const shown = rows.slice(0, limit);
  const allOn = shown.length > 0 && shown.every(i => sel.has(i.id));
  const toggle = (id) => setSel(s => { const x = new Set(s); x.has(id) ? x.delete(id) : x.add(id); return x; });
  const ids = [...sel];
  const filtered = Boolean(source || tag || q.trim());
  const clear = () => { setSource(''); setTag(''); setQ(''); setShow('open'); };
  const empty = d.totals.all === 0;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 pb-20">
      <ErrorNote>{error}</ErrorNote>
      <Sources d={d} run={run} busy={busy} progress={progress} collect={collect} defaultOpen={empty} />

      {empty ? (
        <Card><div className="py-10 text-center">
          <Sparkles size={28} className="mx-auto text-indigo-500" />
          <h3 className="mt-3 text-16 font-semibold text-slate-900">Your keyword list is empty</h3>
          <p className="mt-1 text-13 text-slate-500 max-w-md mx-auto">Press <b>Collect from all</b> above. It reads your website, your Google searches, your services, your competitors and Google, and puts every keyword in one list with where it came from.</p>
        </div></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label="To look at" value={d.totals.open} sub="not picked yet" on={!tag && show === 'open' && !source} onClick={clear} />
            <Tile label="Suggested" value={suggested.length} sub="best-looking to pick" tone="indigo" onClick={() => { clear(); setSort({ key: 'score', dir: 'desc' }); }} />
            <Tile label="Gaps" value={kinds('gap')} sub="competitors have, you do not" tone="red" on={tag === 'gap'} onClick={() => { setShow('open'); setTag(tag === 'gap' ? '' : 'gap'); }} />
            <Tile label="Picked" value={d.totals.picked} sub="saved to your list" tone="green" on={show === 'picked'} onClick={() => setShow(show === 'picked' ? 'open' : 'picked')} />
          </div>

          <Card title="Compare and pick" subtitle="Click a row to select it. Click a keyword to check its searches and cost."
            action={<Button size="sm" icon={Download} onClick={() => exportCsv(rows)} disabled={!rows.length}>Export CSV</Button>}>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <label className="relative"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" /><input value={q} onChange={e => { setQ(e.target.value); setLimit(PAGE); }} placeholder="Search the list" aria-label="Search the list" className="h-9 pl-8 pr-3 text-13 rounded-lg ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none w-56" /></label>
              <select value={source} onChange={e => setSource(e.target.value)} aria-label="Place" className="h-9 px-2 text-13 rounded-lg ring-1 ring-inset ring-slate-300 bg-white">
                <option value="">All places</option>{d.sources.filter(s => s.count).map(s => <option key={s.kind} value={s.kind}>{SRC_SHORT[s.kind]} ({s.count})</option>)}
              </select>
              <select value={show} onChange={e => setShow(e.target.value)} aria-label="Show" className="h-9 px-2 text-13 rounded-lg ring-1 ring-inset ring-slate-300 bg-white">
                <option value="open">To look at</option><option value="picked">Picked</option><option value="dismissed">Set aside</option><option value="all">All</option>
              </select>
              {filtered && <button type="button" onClick={clear} className="text-12.5 font-semibold text-indigo-700 hover:underline inline-flex items-center gap-1 cursor-pointer"><X size={12} />Clear filters</button>}
              <span className="ml-auto flex items-center gap-3"><span className="text-12.5 text-slate-500">{d.shown} keyword{d.shown === 1 ? '' : 's'}</span>
                {show === 'open' && suggested.length > 0 && <Button size="sm" icon={Star} busy={busy === 'pick'} onClick={() => act('pick', suggested.map(i => i.id), `${suggested.length} suggested keywords saved`)} title="The best-looking keywords: searches, ease, gaps and how many places agree">Pick {suggested.length} suggested</Button>}</span>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-4" role="tablist" aria-label="Kind of keyword">
              <Pill on={!tag} onClick={() => setTag('')}>Every kind</Pill>
              {d.tags.filter(t => t.count).map(t => <Pill key={t.tag} title={TAG_HELP[t.tag]} on={tag === t.tag} onClick={() => setTag(tag === t.tag ? '' : t.tag)}>{TAG_SHORT[t.tag]} ({t.count})</Pill>)}
            </div>

            {rows.length === 0 ? (
              <div className="py-10 text-center text-13 text-slate-500">Nothing matches these filters. <button type="button" onClick={clear} className="font-semibold text-indigo-700 hover:underline cursor-pointer">Clear them</button></div>
            ) : (
              <div className="overflow-x-auto rounded-lg ring-1 ring-inset ring-slate-200">
                <table className="w-full text-13 min-w-[860px]">
                  <thead className="bg-slate-50 text-11.5 text-slate-500">
                    <tr>
                      <th className="w-10 px-3 py-2"><input type="checkbox" aria-label="Select all shown" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(shown.map(i => i.id)))} /></th>
                      <SortTh id="keyword" sort={sort} setSort={setSort}>Keyword</SortTh>
                      <th className="px-3 py-2 text-left uppercase tracking-wide">Where it came from</th>
                      <SortTh id="volume" sort={sort} setSort={setSort} right>Searches / mo</SortTh>
                      <SortTh id="difficulty" sort={sort} setSort={setSort} right>Difficulty</SortTh>
                      <SortTh id="rank" sort={sort} setSort={setSort} right>Your rank</SortTh>
                      <th className="px-3 py-2 text-left uppercase tracking-wide">Kind</th>
                      <SortTh id="score" sort={sort} setSort={setSort} right>Score</SortTh>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {shown.map(i => (
                      <tr key={i.id} onClick={() => toggle(i.id)} className={`cursor-pointer ${sel.has(i.id) ? 'bg-indigo-50/60' : 'hover:bg-slate-50'}`}>
                        <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${i.keyword}`} checked={sel.has(i.id)} onChange={() => toggle(i.id)} /></td>
                        <td className="px-3 py-2.5 min-w-[200px]">
                          <Link to={`/keyword-overview?q=${encodeURIComponent(i.keyword)}`} onClick={e => e.stopPropagation()} title="Check its searches, cost and related ideas" className="font-semibold text-slate-900 hover:text-indigo-700 hover:underline">{i.keyword}</Link>
                          {i.picked && <span className="ml-2"><Badge tone="green">Picked</Badge></span>}
                          {i.variants.length > 0 && <span className="block text-11.5 text-slate-400" title="Written differently in other places, merged into this one">also: {i.variants.slice(0, 3).join(', ')}</span>}
                          {i.competitors.length > 0 && <span className="block text-11.5 text-slate-500">used by {i.competitors.slice(0, 3).join(', ')}</span>}
                        </td>
                        <td className="px-3 py-2.5"><SourceBadges sources={i.sources} /></td>
                        <td className="px-3 py-2.5 text-right"><div className="tabular-nums">{n0(i.volume)}</div>{i.volume > 0 && <div className="mt-1 h-1 rounded-full bg-slate-100 ml-auto w-20"><div className="h-1 rounded-full bg-slate-400" style={{ width: `${Math.max(4, (i.volume / topVolume) * 100)}%` }} /></div>}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{i.difficulty ?? '—'}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{i.rank != null ? i.rank.toFixed(1) : '—'}</td>
                        <td className="px-3 py-2.5"><span title={TAG_HELP[i.tag]}><Badge tone={TAG_TONE[i.tag]}>{TAG_SHORT[i.tag]}</Badge></span></td>
                        <td className="px-3 py-2.5 text-right"><span title="A suggestion built from searches, ease, gap or page-2 position, intent and how many places agree" className={`inline-flex items-center gap-1 tabular-nums font-semibold ${i.score >= 70 ? 'text-emerald-700' : i.score >= 45 ? 'text-slate-800' : 'text-slate-500'}`}>{i.suggested && <Sparkles size={12} className="text-amber-500" aria-label="Suggested" />}{i.score}</span></td>
                      </tr>))}
                  </tbody>
                </table>
              </div>
            )}
            {rows.length > shown.length && <div className="mt-3 text-center"><Button onClick={() => setLimit(l => l + PAGE)}>Show {Math.min(PAGE, rows.length - shown.length)} more ({rows.length - shown.length} left)</Button></div>}
            <p className="mt-3 text-12 text-slate-500">The score is a suggestion, not a rule. Hover a kind to see what it means.</p>
          </Card>

          <Card title="Use the picked keywords" subtitle="Group them into topics, give each its page, write the posts and track the rank.">
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon={ArrowRight} onClick={() => onUse('mapping')} disabled={!d.totals.picked}>Map them to pages</Button>
              <Button onClick={() => onUse('topics')} disabled={!d.totals.picked}>Group into topics</Button>
              <Button onClick={() => onUse('status')} disabled={!d.totals.picked}>Keyword Status</Button>
              <Link to="/ai-content-generation/blog"><Button icon={ArrowRight}>Write a blog post</Button></Link>
            </div>
            {!d.totals.picked && <p className="mt-2 text-12 text-slate-500">Pick at least one keyword above to start.</p>}
            <p className="mt-3 text-12.5 text-slate-600">Want more ideas? <Link to="/keyword-management/ai" className="font-semibold text-indigo-700 hover:underline">Find Keywords</Link> · <Link to="/keyword-overview" className="font-semibold text-indigo-700 hover:underline">Check One Keyword</Link>. What you save there lands in this list too.</p>
          </Card>
        </>
      )}

      {ids.length > 0 && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-30 max-w-[calc(100vw-32px)]">
          <div role="toolbar" aria-label="Selected keywords" className="bg-slate-900 text-white rounded-xl shadow-xl px-4 py-2.5 flex flex-wrap items-center gap-3">
            <span className="text-13 font-semibold">{ids.length} selected</span>
            <Button size="sm" variant="primary" icon={CheckCircle2} busy={busy === 'pick'} onClick={() => act('pick', ids, `${ids.length} keyword${ids.length === 1 ? '' : 's'} saved to your list`)}>Pick</Button>
            {show === 'dismissed' ? <Button size="sm" icon={Undo2} onClick={() => act('restore', ids, 'Put back in the list')}>Put back</Button>
              : <Button size="sm" icon={EyeOff} busy={busy === 'dismiss'} onClick={() => act('dismiss', ids, `${ids.length} set aside`)}>Set aside</Button>}
            <button type="button" onClick={() => setSel(new Set())} className="text-12.5 text-slate-300 hover:text-white underline cursor-pointer">Clear</button>
          </div>
        </div>
      )}
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
