import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, Star, Loader2, ArrowUp, ArrowDown, Plus, RefreshCw, KeyRound, ScanSearch, Swords, Sparkles, Link2, MapPin, Gauge, Layers, FileText, ExternalLink,
  AlertTriangle, CheckCircle2, Minus, TrendingUp, Trophy, Globe, HelpCircle, Lightbulb, Bot
} from 'lucide-react';
import { SeoShell, Card, Badge, Button, ErrorNote, ScoreRing, scoreLevel, useAction, useToast, useModulePath } from './SeoUi';
import { api, useApi, fmt, fmtDateTime } from './seoApi';

/**
 * The SEO toolkit pages, each on data the platform really has (its own crawl, tracked keywords, Google results
 * from Serper, the competitor research): Domain Overview, Organic Rankings, Top Pages, Keyword Gap, Compare
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

export const Th = ({ children, c = 'text-left', cls = '' }) => <th className={`px-4 py-2.5 font-semibold whitespace-nowrap ${c} ${cls}`}>{children}</th>;
const Table = ({ head, children, max = 'max-h-[calc(100vh-360px)]' }) => (
  <div className={`overflow-auto ${max} min-h-[160px]`}>
    <table className="w-full text-13"><thead className="sticky top-0 z-10 bg-slate-50 text-11.5  tracking-wide text-slate-500 shadow-[0_1px_0_0_theme(colors.slate.200)]"><tr>{head}</tr></thead><tbody className="divide-y divide-slate-100">{children}</tbody></table>
  </div>
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

/** The latest competitor research of the project (Serper), shared by Keyword Gap and Compare Domains. */
function useResearch(b) {
  const d = useApi(`/businesses/${b.id}/competitor-research`);
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
  const ranked = rows.filter(k => k.rank);
  const improved = ranked.filter(k => k.prev_rank && k.rank < k.prev_rank).length;
  const dropped = ranked.filter(k => k.prev_rank && k.rank > k.prev_rank).length;
  const check = () => run('check', async () => {
    const r = await api(`/businesses/${b.id}/seo/check-ranks`, { method: 'POST', body: {} });
    setUrls(Object.fromEntries(r.results.filter(x => x.url).map(x => [x.keyword, x.url])));
    kw.reload(true);
    toast(`Checked ${r.checked} keyword${r.checked === 1 ? '' : 's'} on Google (${r.credits} Serper credits)`);
  });
  const chip = (id, label, n) => <button key={id} type="button" onClick={() => setFilter(id)} className={`h-8 px-3 rounded text-12 font-semibold cursor-pointer ${filter === id ? 'bg-indigo-500 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}>{label} <span className="opacity-70">{n}</span></button>;
  if (!kw.data) return kw.error ? <ErrorNote>{kw.error.message}</ErrorNote> : <div className="py-16 flex justify-center text-slate-400"><Loader2 size={18} className="animate-spin" /></div>;
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
          <Button size="sm" variant="primary" icon={RefreshCw} busy={busy === 'check'} disabled={!rows.length} onClick={check}>Check positions now</Button>
        </div>
        {error && <div className="px-5 pt-3"><ErrorNote>{error}</ErrorNote></div>}
        {!rows.length ? <p className="px-6 py-12 text-center text-13 text-slate-500">No tracked keywords yet. Add some in <Link to="/keyword-management" className="text-indigo-600 font-semibold hover:underline">Keyword Magic Tool</Link>.</p> : (
          <Table head={<><Th>Keyword</Th><Th c="text-right">Position</Th><Th c="text-right">Volume</Th><Th>Intent</Th><Th>Ranking page</Th><Th>Checked</Th></>}>
            {shown.map(k => (
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
      <p className="text-11.5 text-slate-400">Positions are Google's organic results from your location (live, via Serper). A keyword outside the top 20 shows as not ranking. Search volume appears once a keyword provider supplies it.</p>
      {toastNode}
    </div>
  );
}

/* ── Keyword Gap ───────────────────────────────────────────────────────── */

function KeywordGap({ b }) {
  const path = useModulePath();
  const r = useResearch(b);
  const [tab, setTab] = useState('missing');
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const model = useMemo(() => {
    if (!r.result) return null;
    const comps = r.result.organic_competitors.filter(d => d.type === 'business').slice(0, 4);
    const rows = r.result.keywords.map(k => {
      const you = r.result.you.positions[k] || null;
      const them = comps.map(c => c.positions[k] || null);
      const best = Math.min(...them.filter(Boolean), Infinity);
      const state = !Number.isFinite(best) ? (you ? 'unique' : 'none') : !you ? 'missing' : you > best ? 'weak' : you < best ? 'strong' : 'shared';
      return { keyword: k, you, them, best: Number.isFinite(best) ? best : null, state };
    });
    return { comps, rows, untapped: r.result.ideas.competitor_keywords.filter(k => !r.result.keywords.includes(k)) };
  }, [r.result]);
  if (r.loading) return <div className="py-16 flex justify-center text-slate-400"><Loader2 size={18} className="animate-spin" /></div>;
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
          <Table head={<><Th>Keyword competitors’ pages target</Th><Th c="text-right"> </Th></>}>
            {model.untapped.map(kwd => <tr key={kwd} className="hover:bg-slate-50"><td className="px-4 py-2.5 font-semibold text-slate-900">{kwd}</td><td className="px-4 py-2.5 text-right"><Button size="sm" icon={Plus} busy={busy === `t${kwd}`} onClick={() => track(kwd)}>Track</Button></td></tr>)}
            {!model.untapped.length && <tr><td colSpan={2} className="px-5 py-10 text-center text-slate-500">Nothing untapped.</td></tr>}
          </Table>
        ) : (
          <Table head={<><Th>Keyword</Th><Th c="text-center">You</Th>{model.comps.map(c => <Th key={c.domain} c="text-center" cls="normal-case max-w-[130px] truncate">{c.domain}</Th>)}<Th c="text-right">Best competitor</Th><Th c="text-right"> </Th></>}>
            {list.map(x => (
              <tr key={x.keyword} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 font-semibold text-slate-900">{x.keyword}</td>
                <td className="px-4 py-2.5 text-center"><Pos value={x.you} /></td>
                {x.them.map((p, i) => <td key={i} className="px-4 py-2.5 text-center"><Pos value={p} /></td>)}
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{x.best ? `#${x.best}` : '—'}</td>
                <td className="px-4 py-2.5 text-right"><Button size="sm" icon={Plus} busy={busy === `t${x.keyword}`} onClick={() => track(x.keyword)}>Track</Button></td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={model.comps.length + 4} className="px-5 py-10 text-center text-slate-500">Nothing in this group.</td></tr>}
          </Table>
        )}
      </Card>
      <p className="text-11.5 text-slate-400">Positions are Google's top 10 for each researched keyword. Search volume isn't shown: it needs a keyword provider.</p>
      {toastNode}
    </div>
  );
}

/* ── Compare Domains ───────────────────────────────────────────────────── */

function CompareDomains({ b }) {
  const path = useModulePath();
  const r = useResearch(b);
  if (r.loading) return <div className="py-16 flex justify-center text-slate-400"><Loader2 size={18} className="animate-spin" /></div>;
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
      <Card pad={false} title="Side by side" subtitle="The best figure in each row is highlighted">
        <div className="overflow-x-auto"><table className="w-full text-13 min-w-[640px]">
          <thead className="bg-slate-50 text-11.5  tracking-wide text-slate-500"><tr><Th>Metric</Th>{cols.map(c => <Th key={c.domain} c="text-right" cls={`normal-case ${c.mine ? 'text-emerald-700' : ''}`}>{c.domain}{c.mine ? ' (you)' : ''}</Th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map(([label, get, fmtv, better]) => {
            const vals = cols.map(get);
            const nums = vals.filter(v => v != null);
            const best = nums.length ? (better === 'low' ? Math.min(...nums) : Math.max(...nums)) : null;
            return <tr key={label} className="hover:bg-slate-50"><td className="px-4 py-2.5 text-slate-600">{label}</td>{vals.map((v, i) => <td key={i} className={`px-4 py-2.5 text-right tabular-nums ${v != null && v === best ? 'font-bold text-emerald-700 bg-emerald-50/60' : 'text-slate-900'}`}>{v == null ? <Minus size={12} className="inline text-slate-300" /> : fmtv(v)}</td>)}</tr>;
          })}</tbody></table></div>
      </Card>
      <p className="text-11.5 text-slate-400">From the latest competitor research. A dash means that figure wasn't available for the site (for example, backlinks need DataForSEO).</p>
    </div>
  );
}

/* ── Keyword Overview ──────────────────────────────────────────────────── */

function KeywordOverview({ b }) {
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const go = () => run('go', async () => setData(await api(`/businesses/${b.id}/seo/keyword-overview`, { method: 'POST', body: { keyword: q.trim() } })));
  const track = (k) => run('track', async () => { await api(`/businesses/${b.id}/keywords`, { method: 'POST', body: [{ keyword: k }] }); setData(d => ({ ...d, metrics: { ...d.metrics, tracked: true } })); toast('Added to tracking'); });
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap gap-2">
          <label className="relative flex-1 min-w-[260px]"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && q.trim().length > 1 && go()} placeholder="Enter a keyword, e.g. dentist near me" aria-label="Keyword" className="w-full h-10 pl-9 pr-3 text-14 rounded border border-slate-200 bg-white focus:border-indigo-400 outline-none" /></label>
          <Button variant="primary" icon={Search} busy={busy === 'go'} disabled={q.trim().length < 2} onClick={go}>Analyze</Button>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <p className="text-11.5 text-slate-400 mt-2">Live from Google, from the business's location. Each lookup uses 2 Serper credits.</p>
      </Card>
      {data && (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
            <Tile icon={KeyRound} label="Keyword" value={data.keyword.length > 18 ? `${data.keyword.slice(0, 17)}…` : data.keyword} sub={`${data.intent} intent`} right={!data.metrics.tracked && <Button size="sm" icon={Plus} onClick={() => track(data.keyword)}>Track</Button>} />
            <Tile icon={Trophy} tone="emerald" label="Your Google position" value={data.you.organic ? `#${data.you.organic}` : 'Not in top 10'} sub={data.location} />
            <Tile icon={MapPin} tone="sky" label="Your Maps position" value={data.you.local ? `#${data.you.local}` : 'Not in pack'} sub="local results" />
            <Tile icon={TrendingUp} tone="violet" label="Volume" value={data.metrics.volume != null ? fmt(data.metrics.volume) : '—'} sub={data.metrics.volume != null ? 'saved keyword' : 'needs a keyword provider'} />
            <Tile icon={Gauge} tone="amber" label="Difficulty" value={data.metrics.difficulty ?? '—'} sub={data.metrics.difficulty != null ? 'saved keyword' : 'needs a keyword provider'} />
          </div>
          {data.serp_features.length > 0 && <div className="flex flex-wrap items-center gap-2 text-12"><span className="text-slate-500">SERP features:</span>{data.serp_features.map(f => <Badge key={f} tone="blue">{f.replace(/([A-Z])/g, ' $1').toLowerCase()}</Badge>)}</div>}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
            <Card className="xl:col-span-2" title="Google top 10" pad={false}>
              <ol className="divide-y divide-slate-100">{data.organic.map(o => (
                <li key={`${o.position}-${o.url}`} className={`px-5 py-2.5 flex gap-3 ${o.mine ? 'bg-emerald-50' : ''}`}><Pos value={o.position} /><div className="min-w-0"><a href={o.url} target="_blank" rel="noreferrer" className="block text-13 font-semibold text-slate-900 hover:text-indigo-600 truncate">{o.title}</a><span className="text-12 text-slate-500">{o.domain}{o.type === 'directory' ? ' · listing site' : ''}{o.mine ? ' · you' : ''}</span>{o.snippet && <p className="text-12 text-slate-500 line-clamp-2 mt-0.5">{o.snippet}</p>}</div></li>))}
                {!data.organic.length && <li className="px-5 py-8 text-center text-13 text-slate-500">No results.</li>}</ol>
            </Card>
            <div className="space-y-4">
              <Card title="Google Maps pack" pad={false}>
                <ul className="divide-y divide-slate-100">{data.local.slice(0, 8).map(p => <li key={`${p.position}-${p.name}`} className={`px-5 py-2 flex items-center gap-2 ${p.mine ? 'bg-emerald-50' : ''}`}><Pos value={p.position} maps /><span className="flex-1 min-w-0 truncate text-13 text-slate-800">{p.name}{p.mine ? ' (you)' : ''}</span><Stars rating={p.rating} reviews={p.reviews} /></li>)}
                  {!data.local.length && <li className="px-5 py-6 text-center text-13 text-slate-500">No local pack for this search.</li>}</ul>
              </Card>
              {data.related.length > 0 && <Card title="Related searches"><div className="flex flex-wrap gap-1.5">{data.related.map(k => <button key={k} type="button" onClick={() => { setQ(k); }} className="px-2.5 py-1 rounded-full text-12.5 bg-slate-100 text-slate-700 border border-slate-200 hover:bg-indigo-50 hover:text-indigo-700 cursor-pointer">{k}</button>)}</div></Card>}
              {data.questions.length > 0 && <Card title="People also ask"><ul className="space-y-1.5">{data.questions.map(k => <li key={k} className="flex gap-2 text-13 text-slate-700"><HelpCircle size={14} className="text-violet-500 mt-0.5 shrink-0" />{k}</li>)}</ul></Card>}
            </div>
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
export const KeywordGapPage = page('Keyword Gap', "Keywords your competitors rank for that you don't, and where you are weaker or stronger", KeywordGap);
export const CompareDomainsPage = page('Compare Domains', "You and your top competitors side by side", CompareDomains);
export const KeywordOverviewPage = page('Keyword Overview', "One keyword as Google shows it: who ranks, the Maps pack, related searches and questions", KeywordOverview);
