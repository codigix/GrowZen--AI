import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { ExternalLink, Search, RefreshCw, Download, ShieldAlert, CheckCircle2, Info, Sparkles, Link2, Plus, Trash2, Loader2, BookOpen, Send, ChevronRight, ChevronDown } from 'lucide-react';
import { SeoShell, Card, Button, Badge, Stat, ErrorNote, Modal, Field, inputCls, useAction, useToast, useDoubleConfirm, SkList } from './SeoUi';
import Select from '../components/Select';
import { Act, Head, OpenAct } from './TableBits';
import { api, useApi, usePoll, fmtDate, fmtDateTime } from './seoApi';
import Tip from './Tip';
import AuditReport from './BacklinkAuditReport';
import BacklinkOverview, { GraphTab, AnchorsTab, PagesTab, OutboundTab } from './BacklinkOverview';
import { usePager, Pager, useSorted, SortTh, downloadCsv } from './DataTable';

const VIEWS = {
  graph: ['Network graph', 'The websites that link to you, drawn around your site: bigger the more links they give, red when they look risky.'],
  anchors: ['Anchors', 'The words the links to your website use, how natural they look and which sites use them.'],
  pages: ['Indexed pages', 'The pages of your website that have links pointing to them, with how many sites and links each one has.'],
  outbound: ['Outbound domains', 'The websites your own pages link to, read now from your pages.'],
  overview: ['Backlinks', 'The big picture of the links to your website: authority, referring domains and backlinks over time, new and lost links, anchors, follow types, site endings, hosting and top pages.'],
  links: ['Backlinks', 'Every link to your website that the crawler found: follow or nofollow, anchor text, kind of site, authority and whether it is worth having.'],
  domains: ['Referring domains', 'The websites that link to you, with how many links each gives, what kind of site it is and whether it helps or hurts.'],
  opportunities: ['Link opportunities', 'Websites that link to your competitors but not to you: the places worth asking for a link, best first.'],
  gap: ['Competitor gap', 'Pick a competitor to see the websites and pages that link to them but not to you: where they earned links and where you can ask for one.'],
  audit: ['Backlink audit', 'What is wrong or weak in your backlink profile, and what to do about it.'],
  sites: ['Tracked sites and sync', 'The websites whose links are collected (yours and your competitors) and how often they are read from our backlink crawler.']
};
const USEFUL = { useful: ['Useful', 'green'], neutral: ['Neutral', 'gray'], risky: ['Risky', 'red'], unscored: ['Not judged', 'amber'] };
const FOLLOW = { dofollow: ['Follow', 'green'], nofollow: ['Nofollow', 'gray'], sponsored: ['Sponsored', 'amber'], ugc: ['UGC', 'gray'] };
const ANCHOR = { branded: 'Brand', naked: 'Web address', money: 'Keyword', generic: 'Generic', compound: 'Brand + words', organic: 'Natural', empty: 'No text', other: 'Other' };
const PRIORITY = { high: ['High', 'red'], medium: ['Medium', 'amber'], low: ['Low', 'gray'] };
const TH = 'px-3 py-2.5 font-semibold whitespace-nowrap text-left';
const TC = 'px-3 py-2.5 whitespace-nowrap';
const NONE = [];
const num = (v) => (v == null || v === '' ? null : Number(v));
const stamp = (iso) => (iso ? Date.parse(iso) : null);
const norm = (s) => String(s ?? '').toLowerCase();
/** A small search box for a list that can be long. */
function ListSearch({ q, setQ, placeholder = 'Search this list' }) {
  return <label className="relative inline-block mb-3"><Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="h-8 w-56 pl-8 pr-3 text-13 rounded-lg ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none" /></label>;
}
/** Download every row of a list as a CSV: `rows()` gives the full sorted list as arrays, so the file is not limited to the page shown. */
function CsvButton({ name, head, rows, tip = 'Download every row of this table as a CSV file' }) {
  return <button type="button" onClick={() => downloadCsv(name, head, rows())} title={tip} className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white text-12.5 font-semibold text-slate-700 cursor-pointer hover:bg-slate-50"><Download size={13} />Export CSV</button>;
}
const CsvBar = ({ pad = 'px-5', ...p }) => <div className={`${pad} py-2 border-b border-slate-100 flex justify-end`}><CsvButton {...p} /></div>;
const siteName = (b) => String(b?.website || b?.name || 'site').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].replace(/[^a-z0-9.-]+/gi, '-');
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const path = (u) => { try { const x = new URL(u); return (x.pathname + x.search) || '/'; } catch { return u; } };
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const Num = ({ v, tip, bad }) => (v == null
  ? <Tip text={tip || 'Not measured: needs a Moz key in the backend settings.'}><span className="text-slate-300">—</span></Tip>
  : <span className={`tabular-nums font-semibold ${bad ? 'text-red-600' : 'text-slate-800'}`}>{v}{bad ? '%' : ''}</span>);

const Verdict = ({ u, why }) => { const [l, t] = USEFUL[u] || USEFUL.unscored; return <Tip text={why} wide><Badge tone={t}>{l}</Badge></Tip>; };
const FollowBadge = ({ f }) => { const [l, t] = FOLLOW[f] || FOLLOW.dofollow; return <Tip text={f === 'dofollow' ? 'A normal link: it can pass ranking value.' : `rel="${f}": it brings visitors but passes little or no ranking value.`}><Badge tone={t}>{l}</Badge></Tip>; };

function Setup({ s }) {
  if (s.state === 'no_target') return <Card><p className="text-13 text-slate-600">This project has no website yet. Add it in the project settings: the crawler looks for links to that address.</p></Card>;
  const c = s.crawler;
  const note = !c.configured
    ? 'Your backlink crawler is not connected. Add CRAWLER_URL and CRAWLER_API_KEY to the backend settings; the links it finds then appear here.'
    : c.last_error ? `The last sync failed: ${c.last_error}` : !c.last_sync_at ? 'The crawler is connected but has not synced this project yet. Press “Find backlinks now”.' : null;
  if (!note) return null;
  const all = [note, false && 'Site strength comes from your own crawler: how many links and pages each site gives you. DA, PA and Spam Score need a Moz account and are optional.'].filter(Boolean);
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-2 text-12.5 text-amber-900 flex items-center gap-2 min-w-0" title={all.join(' ')}>
      <Info size={14} className="shrink-0" /><span className="truncate">{all[0]}</span>{all.length > 1 && <span className="shrink-0 text-amber-700">+{all.length - 1} more note</span>}
    </div>
  );
  // eslint-disable-next-line no-unreachable
  return (
    <Card>
      <div className="grid gap-1.5 text-13">
        {note && <p className="flex gap-2 text-amber-800"><Info size={15} className="shrink-0 mt-0.5" />{note}</p>}
      </div>
    </Card>
  );
}

function Summary({ s, b, reload, compact = false, main = false }) {
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  if (s.state !== 'ok') return null;
  const t = s.totals;
  const sync = () => run('sync', async () => { await api(`/businesses/${b.id}/backlink-intel/bot/run`, { method: 'POST' }); toast('Looking for backlinks. This page updates when it is done.'); setTimeout(() => reload(true), 4000); });
  const score = () => run('score', async () => { const r = await api(`/businesses/${b.id}/backlink-intel/scores/run`, { method: 'POST', body: { domain: s.domain, limit: 15 } }); toast(`Judged ${r.scored.length} site${r.scored.length !== 1 ? 's' : ''}${r.remaining ? `, ${r.remaining} to go: press again` : ''}`); reload(true); });
  const moz = () => run('moz', async () => { const r = await api(`/businesses/${b.id}/backlink-hub/metrics/refresh`, { method: 'POST' }); toast(r.message); reload(true); });
  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-13 text-slate-600">
        <span><b className="text-slate-900">{s.domain}</b>: {s.totals.live} live links from {s.totals.referring_domains} domains{s.crawler.last_sync_at ? `, synced ${day(s.crawler.last_sync_at)}` : ''}</span>
        {main && <span className="text-slate-500">{t.dofollow_share == null ? '' : `${t.dofollow_share}% follow · `}{t.new_30d} new · {t.lost_30d} lost (30 days) · {s.useful.useful || 0} useful{s.useful.risky ? `, ${s.useful.risky} risky` : ''}</span>}
        <span className="ml-auto flex items-center gap-3"><Link to="/backlinks/links" className="font-semibold text-indigo-600 hover:underline">All backlinks</Link><Button size="sm" icon={Link2} busy={busy === 'sync'} onClick={sync}>Find backlinks now</Button></span>
        {toastNode}
      </div>
    );
  }
  return (
    <Card title={`Backlinks to ${s.domain}`} subtitle={s.crawler.last_sync_at ? `Last crawler sync ${day(s.crawler.last_sync_at)}${s.crawler.running ? ' (running now)' : ''}` : 'Read from your backlink crawler'}
      action={<div className="flex flex-wrap gap-2">
        <Button size="sm" icon={Sparkles} busy={busy === 'score'} onClick={score}>Score the links</Button>
        {s.moz.configured && <Button size="sm" icon={RefreshCw} busy={busy === 'moz'} onClick={moz}>Get DA / PA / spam</Button>}
        <Button size="sm" variant="primary" icon={Link2} busy={busy === 'sync'} onClick={sync}>Find backlinks now</Button>
        <Link to="/backlinks/sites"><Button size="sm">Tracked sites</Button></Link>
      </div>}>
      <ErrorNote>{error}</ErrorNote>
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <Stat label="Live links" value={t.live} /><Stat label="Domains" value={t.referring_domains} /><Stat label="Follow" value={t.dofollow_share == null ? '—' : `${t.dofollow_share}%`} hint={`${t.dofollow} follow, ${t.nofollow} other`} />
        <Stat label="New (30 days)" value={t.new_30d} /><Stat label="Lost (30 days)" value={t.lost_30d} /><Stat label="Useful links" value={s.useful.useful || 0} hint={`${s.useful.risky || 0} risky, ${s.useful.unscored || 0} not judged`} /><Stat label="Average DA" value={t.avg_da ?? '—'} />
      </div>
      {toastNode}
    </Card>
  );
}

function Used({ s }) {
  if (s.state !== 'ok') return null;
  return (
    <Card title="Where this data is used" subtitle="Your backlink results are not kept on this page alone.">
      <ul className="grid gap-2 md:grid-cols-2">{s.used_in.map(u => <li key={u.where} className="text-13 text-slate-600"><Link to={u.to} className="font-semibold text-indigo-600 hover:underline">{u.where}</Link>: {u.what}</li>)}</ul>
    </Card>
  );
}

function Filters({ q, setQ, children }) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-slate-100">
      {children}
      <label className="relative ml-auto"><Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search" aria-label="Search" className="h-8 w-52 pl-8 pr-3 text-13 rounded-lg ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none" /></label>
    </div>
  );
}
const sel = 'h-8 text-13 min-w-[140px]';
const Empty = ({ children }) => <tr><td colSpan={12} className="px-5 py-10 text-center text-slate-500">{children}</td></tr>;

function useList(b, view, params) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString();
  return useApi(`/businesses/${b.id}/backlink-hub/${view}${qs ? `?${qs}` : ''}`);
}
function useDebounced(v, ms = 300) { const [x, setX] = useState(v); useEffect(() => { const t = setTimeout(() => setX(v), ms); return () => clearTimeout(t); }, [v, ms]); return x; }

const hasMoz = (rows) => (rows || []).some(x => x.metrics && (x.metrics.da != null || x.metrics.spam != null));
/** What our own crawler knows about the site: how many links and pages it gives, and since when. No third-party score. */
function SiteCell({ m }) {
  const c = m?.crawler;
  if (!c || !c.links) return <span className="text-slate-300">—</span>;
  return <Tip text={`Our crawler found ${c.links} live link${c.links === 1 ? '' : 's'} from ${c.pages} page${c.pages === 1 ? '' : 's'} of this site${c.sites_linked > 1 ? `, to ${c.sites_linked} of the sites we track` : ''}.${c.linked_by ? ` ${c.linked_by} site${c.linked_by === 1 ? '' : 's'} we crawled link to it.` : ''}${c.sitewide ? ' So many links from one site count as about one link.' : ''}`}>
    <span className="tabular-nums">{c.links} link{c.links === 1 ? '' : 's'}{c.sitewide && <span className="ml-1 text-11.5 text-amber-600">sitewide</span>}</span></Tip>;
}

const ago = (iso) => { if (!iso) return '—'; const d = Math.floor((Date.now() - Date.parse(iso)) / 86400000); if (d < 1) return 'today'; if (d < 31) return `${d}d ago`; return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
const isNew = (x) => x.is_live && x.first_seen && Date.now() - Date.parse(x.first_seen) < 30 * 86400000;
const linkValue = (x, k) => ({
  authority: num(x.authority), last: stamp(x.last_seen),
  page: x.source_domain, anchor: x.anchor, target: path(x.target_url), follow: x.follow, category: x.category?.label,
  da: num(x.metrics?.da), pa: num(x.metrics?.pa), spam: num(x.metrics?.spam), site: num(x.metrics?.crawler?.links), useful: x.useful, seen: stamp(x.first_seen)
})[k];
function LinksTable({ d, showScores, resetKey, site }) {
  const { sorted, sort, onSort } = useSorted(d.links || NONE, linkValue);
  // One row per linking site; its pages are inside it and show when it is opened. The pages of a site stay in the order of the chosen sort.
  const groups = useMemo(() => {
    const map = new Map();
    for (const x of sorted) { const k = x.source_domain || x.source_url; if (!map.has(k)) map.set(k, []); map.get(k).push(x); }
    return [...map.entries()].map(([domain, links]) => ({ domain, links }));
  }, [sorted]);
  const pg = usePager(groups, { size: 25, resetKey });
  const [open, setOpen] = useState(() => new Set());
  const toggle = (dom) => setOpen(prev => { const n = new Set(prev); if (n.has(dom)) n.delete(dom); else n.add(dom); return n; });
  const allOpen = groups.length > 0 && groups.every(g => g.links.length < 2 || open.has(g.domain));
  const toggleAll = () => setOpen(allOpen ? new Set() : new Set(groups.filter(g => g.links.length > 1).map(g => g.domain)));
  const csv = () => sorted.map(x => [x.source_url, x.source_domain, x.is_live ? 'Live' : x.status_label, x.anchor || '', x.target_url, (FOLLOW[x.follow] || FOLLOW.dofollow)[0], x.category?.label || '',
    ...(showScores ? [num(x.metrics?.da), num(x.metrics?.pa), num(x.metrics?.spam)] : []), num(x.metrics?.crawler?.links), num(x.metrics?.crawler?.pages), (USEFUL[x.useful] || USEFUL.unscored)[0], x.useful_why || '', x.first_seen || '']);
  return (
    <>
      <CsvBar name={`backlinks-${site}`} head={['Linking page', 'Linking site', 'Status', 'Anchor text', 'Goes to', 'Follow', 'Category', ...(showScores ? ['DA', 'PA', 'Spam score'] : []), 'Links from this site', 'Pages with the links', 'Useful?', 'Why', 'First seen']} rows={csv} tip={`Exports the ${sorted.length} loaded links (the page loads at most 100 at a time)`} />
      {groups.some(g => g.links.length > 1) && (
        <div className="flex items-center gap-3 px-5 py-2 text-12 text-slate-500">
          <span>{groups.length} sites · {sorted.length} links. Sites with several pages are shown as one row.</span>
          <button type="button" onClick={toggleAll} className="font-semibold text-indigo-600 hover:underline">{allOpen ? 'Collapse all' : 'Expand all'}</button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1150px] text-13">
          <thead className="bg-slate-50 text-12 uppercase tracking-wide text-slate-500"><tr>
            <SortTh id="authority" sort={sort} onSort={onSort} right first="desc" className={TC} tip={{ what: "Our Authority Score of the linking site, 0 to 100: its Domain Authority and spam score together.", from: 'Moz (through Apify).' }}>Page AS</SortTh><SortTh id="page" sort={sort} onSort={onSort} className={TC}>Linking page</SortTh><SortTh id="anchor" sort={sort} onSort={onSort} className={TC}>Anchor text</SortTh><SortTh id="target" sort={sort} onSort={onSort} className={TC}>Goes to</SortTh><SortTh id="follow" sort={sort} onSort={onSort} className={TC}>Follow</SortTh><SortTh id="category" sort={sort} onSort={onSort} className={TC}>Category</SortTh>
            {showScores && <><SortTh id="da" sort={sort} onSort={onSort} right first="desc" className={TC} tip={{ what: "Authority of the linking site, 0-100 (the site's rank at the data service)." }}>DA</SortTh><SortTh id="pa" sort={sort} onSort={onSort} right first="desc" className={TC} tip={{ what: "Strength of the site's home page, 0-100." }}>PA</SortTh><SortTh id="spam" sort={sort} onSort={onSort} right first="desc" className={TC} tip={{ what: 'Spam score of the linking site. Lower is better.' }}>Spam</SortTh></>}
            <SortTh id="site" sort={sort} onSort={onSort} first="desc" className={TC} tip={showScores ? { what: 'How many live links this site gives you, and how many of its pages carry them.', why: 'A link repeated on many pages of one site counts as about one link.', from: 'our backlink crawler.' } : { what: 'How many live links this site gives you, and how many of its pages carry them.', why: 'A link repeated on many pages of one site counts as about one link, so more is not always better.', from: 'our backlink crawler.' }}>Site gives you</SortTh>
            <SortTh id="useful" sort={sort} onSort={onSort} className={TC} tip={{ what: 'Our judgement from relevance to your business, spam risk and the follow type. Hover a badge for the reason.' }}>Useful?</SortTh><SortTh id="seen" sort={sort} onSort={onSort} first="desc" className={TC}>First seen</SortTh><SortTh id="last" sort={sort} onSort={onSort} first="desc" className={TC}>Last seen</SortTh>
            <th className={`${TH} text-right`}><Head right what="Open the linking page, or your own page it points to." why="See the link in its real setting.">Actions</Head></th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {d.state === 'no_target' && <Empty>Add the project's website first.</Empty>}
            {pg.rows.map(g => {
              const first = g.links[0];
              const many = g.links.length > 1;
              const isOpen = open.has(g.domain);
              const live = g.links.filter(l => l.is_live).length;
              const follows = g.links.filter(l => l.follow === 'dofollow').length;
              const anyNew = g.links.some(isNew);
              const latest = g.links.map(l => l.last_seen).filter(Boolean).sort().slice(-1)[0];
              const earliest = g.links.map(l => l.first_seen).filter(Boolean).sort()[0];
              const best = Math.max(...g.links.map(l => (l.authority == null ? -1 : l.authority)));
              return (
                <React.Fragment key={g.domain}>
                  {many && (
                    <tr className="bg-slate-50/60 hover:bg-slate-100/70 align-middle cursor-pointer" onClick={() => toggle(g.domain)} aria-expanded={isOpen}>
                      <td className="px-3 py-3 text-right tabular-nums font-semibold text-slate-800">{best >= 0 ? best : <span className="text-slate-300 font-normal">—</span>}</td>
                      <td className="px-3 py-3 max-w-[300px]">
                        <span className="inline-flex items-center gap-1.5 max-w-full">
                          <button type="button" onClick={(e) => { e.stopPropagation(); toggle(g.domain); }} aria-label={`${isOpen ? 'Hide' : 'Show'} the ${g.links.length} links from ${g.domain}`} className="grid h-5 w-5 shrink-0 place-items-center rounded text-slate-500 hover:bg-slate-200">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
                          <span className="truncate font-semibold text-slate-800">{g.domain}</span>
                        </span>
                        <span className="block pl-[26px] text-11.5 text-slate-400">{g.links.length} pages link to you{live < g.links.length && ` · ${live} live`}{anyNew && <span className="ml-1.5 rounded bg-emerald-50 px-1.5 text-emerald-700 font-medium">New</span>}</span>
                      </td>
                      <td className="px-3 py-3 text-slate-400 text-12">{isOpen ? '' : 'Open to see each page'}</td>
                      <td className="px-3 py-3"></td>
                      <td className="px-3 py-3 text-12 text-slate-500 whitespace-nowrap">{follows}/{g.links.length} follow</td>
                      <td className="px-3 py-3 capitalize text-slate-600">{first.category?.label}</td>
                      {showScores && <><td className="px-3 py-3 text-right"><Num v={first.metrics?.da} /></td><td className="px-3 py-3 text-right"><Num v={first.metrics?.pa} /></td><td className="px-3 py-3 text-right"><Num v={first.metrics?.spam} bad={(first.metrics?.spam ?? 0) >= 50} /></td></>}
                      <td className="px-3 py-3 whitespace-nowrap"><SiteCell m={first.metrics} /></td>
                      <td className="px-3 py-3"><Verdict u={first.useful} why={first.useful_why} /></td>
                      <td className="px-3 py-3 text-slate-500 whitespace-nowrap">{day(earliest)}</td>
                      <td className="px-3 py-3 text-slate-500 whitespace-nowrap">{ago(latest)}</td>
                      <td className="px-3 py-3"></td>
                    </tr>
                  )}
                  {(!many || isOpen) && g.links.map(x => (
              <tr key={x.id} className={`hover:bg-slate-50 align-middle ${many ? 'bg-white' : ''}`}>
                <td className="px-3 py-3 text-right tabular-nums font-semibold text-slate-800">{x.authority ?? <span className="text-slate-300 font-normal">—</span>}</td>
                <td className={`px-3 py-3 max-w-[260px] ${many ? 'pl-9 border-l-2 border-indigo-100' : ''}`}><a href={x.source_url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline inline-flex items-center gap-1 max-w-full"><span className="truncate font-semibold">{x.source_domain}</span><ExternalLink size={11} className="shrink-0" /></a><span className="block truncate text-11.5 text-slate-400" title={x.source_url}>{path(x.source_url)}</span>{!x.is_live && <Badge tone="red">{x.status_label}</Badge>}</td>
                <td className="px-3 py-3 max-w-[200px]"><span className="block truncate" title={x.anchor || ''}>{x.anchor || <span className="text-slate-300">no text</span>}</span><span className="inline-flex items-center gap-1.5 text-11.5 text-slate-400">{ANCHOR[x.anchor_type] || x.anchor_type}{isNew(x) && <span className="rounded bg-emerald-50 px-1.5 text-emerald-700 font-medium">New</span>}</span></td>
                <td className="px-3 py-3 max-w-[160px]"><span className="block truncate text-slate-600" title={x.target_url}>{path(x.target_url)}</span></td>
                <td className="px-3 py-3"><FollowBadge f={x.follow} /></td>
                <td className="px-3 py-3 capitalize text-slate-600">{x.category.label}</td>
                {showScores ? <><td className="px-3 py-3 text-right" title={x.metrics?.source === 'moz' ? 'Figure from Moz' : x.metrics?.source === 'apify' ? 'Figure from Apify (Moz checker)' : x.metrics?.source === 'dataforseo' ? 'Figure from DataForSEO' : undefined}><Num v={x.metrics?.da} /></td><td className="px-3 py-3 text-right" title={x.metrics?.source === 'moz' ? 'Figure from Moz' : x.metrics?.source === 'dataforseo' ? 'Figure from DataForSEO' : undefined}><Num v={x.metrics?.pa} /></td><td className="px-3 py-3 text-right" title={x.metrics?.source === 'moz' ? 'Figure from Moz' : x.metrics?.source === 'dataforseo' ? 'Figure from DataForSEO' : undefined}><Num v={x.metrics?.spam} bad={(x.metrics?.spam ?? 0) >= 50} /></td><td className="px-3 py-3 whitespace-nowrap"><SiteCell m={x.metrics} /></td></> : <td className="px-3 py-3 whitespace-nowrap"><SiteCell m={x.metrics} /></td>}
                <td className="px-3 py-3"><Verdict u={x.useful} why={x.useful_why} /></td>
                <td className="px-3 py-3 text-slate-500 whitespace-nowrap">{day(x.first_seen)}</td>
                <td className="px-3 py-3 text-slate-500 whitespace-nowrap">{ago(x.last_seen)}</td>
                <td className="px-3 py-3 text-right whitespace-nowrap"><span className="inline-flex gap-1.5">
                  <OpenAct url={x.source_url} tip="Open the linking page: see the link where it sits on the other website." />
                  <OpenAct url={x.target_url} tip="Open your page: the page of your site this link points to." />
                </span></td>
              </tr>
                  ))}
                </React.Fragment>
              );
            })}
            {d.state === 'ok' && !d.links.length && <Empty>{d.live_total ? 'No link matches these filters.' : 'No backlinks yet. Connect the crawler and press “Find backlinks now”.'}</Empty>}
          </tbody>
        </table>
      </div>
      <Pager p={pg} label="sites" />
    </>
  );
}

function Links({ b }) {
  const [params] = useSearchParams();
  const [busyScores, errScores, runScores] = useAction();
  const [toastS, toastSNode] = useToast();
  const [preset, setPreset] = useState(''); // best | new | lost_vital: the tiles of the page
  const [f, setF] = useState({ status: params.get('status') || 'live', follow: params.get('follow') || '', category: '', useful: params.get('useful') || '', sort: 'recent' });
  const [q, setQ] = useState(params.get('q') || ''); // opened from a site's row: only that site's links
  const dq = useDebounced(q);
  const r = useList(b, 'links', { ...f, preset, q: dq, limit: 200, group: 1 });  // 200 SITES, each with all of its pages
  const d = r.data;
  if (r.error) return <Card><ErrorNote>{r.error.message}</ErrorNote></Card>;
  if (!d) return <SkList rows={6} />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const sc = d.scores || {};
  const showScores = hasMoz(d.links) || sc.configured; // the columns are there as soon as a data service can fill them
  const getScores = () => runScores('scores', async () => { const x = await api(`/businesses/${b.id}/backlink-hub/metrics/refresh`, { method: 'POST' }); toastS(x.message); r.reload(true); });
  return (
    <Card pad={false}>
      {sc.configured && (
        <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-3 text-13">
          <Button size="sm" variant={sc.missing ? 'primary' : undefined} icon={RefreshCw} busy={busyScores === 'scores'} onClick={getScores}>{sc.missing ? `Get DA, PA and Spam for ${sc.missing} site${sc.missing === 1 ? '' : 's'}` : 'Refresh DA, PA and Spam'}</Button>
          <span className="text-slate-500">{sc.missing ? `${sc.sites - sc.missing - sc.no_data} of ${sc.sites} linking sites have figures.` : `${sc.sites - sc.no_data} of ${sc.sites} linking sites have figures.`}{sc.no_data ? ` ${sc.no_data} are too new or too small for ${sc.source} to know.` : ''} From {sc.source}: DA is the site's rank, PA its home page's rank (0-100), Spam is the spam score (lower is better). Not Moz's own numbers.</span>
          <ErrorNote>{errScores}</ErrorNote>
        </div>)}
      {d.tiles && (
        <div className="grid grid-cols-2 lg:grid-cols-4 border-b border-slate-100 divide-x divide-slate-100">
          {[['', 'all', 'All', d.tiles.all, 'Every link our crawler has found to your website', 'all'], ['best', 'best', 'Best', d.tiles.best, 'Backlinks with the follow attribute, from useful or strong sites', 'live'], ['new', 'new', 'Top new', d.tiles.new, 'Recently acquired backlinks (the last 30 days)', 'live'], ['lost_vital', 'lost_vital', 'Lost and vital', d.tiles.lost_vital, 'Restore these backlinks first: lost from useful or strong sites', 'all']].map(([k, id, label, n, sub, st]) => (
            <button key={id} type="button" onClick={() => { setPreset(k); setF({ ...f, status: st, follow: '' }); }} className={`text-left px-5 py-3 cursor-pointer transition-colors ${preset === k ? 'bg-indigo-50' : 'hover:bg-slate-50'}`} aria-pressed={preset === k}>
              <div className="flex items-baseline gap-2"><span className="text-14 font-semibold text-slate-900">{label}</span><span className={`text-14 tabular-nums ${preset === k ? 'text-indigo-700 font-semibold' : 'text-slate-500'}`}>{n.toLocaleString('en-US')}</span></div>
              <div className="text-12 text-slate-500">{sub}</div></button>))}
        </div>)}
      <Filters q={q} setQ={setQ}>
        <span className="inline-flex rounded-lg ring-1 ring-inset ring-slate-300 overflow-hidden" role="group" aria-label="Status">{[['all', 'All'], ['live', 'Active'], ['lost', 'Lost']].map(([k, l], n) => <button key={k} type="button" aria-pressed={f.status === k && !preset} onClick={() => { setPreset(''); setF({ ...f, status: k }); }} className={`px-3 h-8 text-12.5 font-medium cursor-pointer ${n ? 'border-l border-slate-200' : ''} ${f.status === k && !preset ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>{l}</button>)}<button type="button" aria-pressed={preset === 'new'} onClick={() => { setPreset(preset === 'new' ? '' : 'new'); setF({ ...f, status: 'live' }); }} className={`px-3 h-8 text-12.5 font-medium cursor-pointer border-l border-slate-200 ${preset === 'new' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>New</button></span>
        <span className="inline-flex rounded-lg ring-1 ring-inset ring-slate-300 overflow-hidden" role="group" aria-label="Follow type">{[['', 'All'], ['dofollow', 'Follow'], ['nofollow', 'Nofollow'], ['sponsored', 'Sponsored'], ['ugc', 'UGC']].map(([k, l], n) => <button key={k || 'any'} type="button" aria-pressed={f.follow === k} onClick={() => setF({ ...f, follow: k })} className={`px-3 h-8 text-12.5 font-medium cursor-pointer ${n ? 'border-l border-slate-200' : ''} ${f.follow === k ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>{l}</button>)}</span>
        <Select value={f.useful} onChange={set('useful')} className={sel} aria-label="Useful"><option value="">Useful or not</option>{Object.entries(USEFUL).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select>
        <Select value={f.category} onChange={set('category')} className={sel} aria-label="Category"><option value="">Any category</option>{Object.keys(d.facets?.category || {}).map(k => <option key={k} value={k}>{k}</option>)}</Select>
        <Select value={f.sort} onChange={set('sort')} className={sel} aria-label="Sort"><option value="recent">Newest first</option><option value="da">Highest DA</option><option value="domain">By site</option></Select>
      </Filters>
      <LinksTable d={d} showScores={showScores} resetKey={`${JSON.stringify(f)}|${preset}|${dq}`} site={siteName(b)} />
      <p className="px-5 py-3 border-t border-slate-100 text-11.5 text-slate-400">{d.total} link{d.total !== 1 ? 's' : ''}. Follow type and anchor are read from the page by your crawler. “Useful?” is our own judgement, not a Google or Moz metric.</p>
      {toastSNode}
    </Card>
  );
}

const domainValue = (x, k) => ({
  domain: x.domain, live: num(x.live), follow: num(x.dofollow), category: x.category?.label, anchors: (x.anchors || []).join(', '),
  da: num(x.metrics?.da), pa: num(x.metrics?.pa), spam: num(x.metrics?.spam), site: num(x.metrics?.crawler?.links), relevance: num(x.quality?.relevance), useful: x.useful, seen: stamp(x.last_seen)
})[k];
function DomainsTable({ d, resetKey, site }) {  // the DA / PA / Spam columns are there as soon as a data service can fill them
  const { sorted, sort, onSort } = useSorted(d.domains || NONE, domainValue);
  const pg = usePager(sorted, { size: 25, resetKey });
  const moz = hasMoz(d.domains) || !!d.scores?.configured;
  const csv = () => sorted.map(x => [x.domain, x.sample_url || '', num(x.live), num(x.lost), num(x.dofollow), num(x.nofollow), x.category?.label || '', (x.anchors || []).join(', '),
    ...(moz ? [num(x.metrics?.da), num(x.metrics?.pa), num(x.metrics?.spam)] : []), num(x.metrics?.crawler?.links), num(x.metrics?.crawler?.pages), num(x.quality?.relevance), (USEFUL[x.useful] || USEFUL.unscored)[0], x.useful_why || '', x.last_seen || '']);
  return (
    <>
      <CsvBar name={`referring-domains-${site}`} head={['Domain', 'Example linking page', 'Live links', 'Lost links', 'Follow links', 'Other links', 'Category', 'Top anchors', ...(moz ? ['DA', 'PA', 'Spam score'] : []), 'Links from this site', 'Pages with the links', 'Relevance', 'Useful?', 'Why', 'Last seen']} rows={csv} tip={`Exports all ${sorted.length} loaded referring domains`} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1050px] text-13">
          <thead className="bg-slate-50 text-12 uppercase tracking-wide text-slate-500"><tr>
            <SortTh id="domain" sort={sort} onSort={onSort} className={TC}>Domain</SortTh><SortTh id="live" sort={sort} onSort={onSort} right first="desc" className={TC}>Live links</SortTh><SortTh id="follow" sort={sort} onSort={onSort} first="desc" className={TC}>Follow</SortTh><SortTh id="category" sort={sort} onSort={onSort} className={TC}>Category</SortTh><SortTh id="anchors" sort={sort} onSort={onSort} className={TC}>Top anchors</SortTh>
            {moz ? <><SortTh id="da" sort={sort} onSort={onSort} right first="desc" className={TC}>DA</SortTh><SortTh id="pa" sort={sort} onSort={onSort} right first="desc" className={TC}>PA</SortTh><SortTh id="spam" sort={sort} onSort={onSort} right first="desc" className={TC}>Spam</SortTh></> : <SortTh id="site" sort={sort} onSort={onSort} first="desc" className={TC} tip={{ what: 'How many live links and pages this site gives you.', from: 'our backlink crawler.' }}>Site gives you</SortTh>}<SortTh id="relevance" sort={sort} onSort={onSort} right first="desc" className={TC}>Relevance</SortTh><SortTh id="useful" sort={sort} onSort={onSort} className={TC}>Useful?</SortTh><SortTh id="seen" sort={sort} onSort={onSort} first="desc" className={TC}>Last seen</SortTh><th className={`${TH} text-right`}><Head right what="Open the site, or list only the links this site gives you." why="Check what a site links to before you reply to it.">Actions</Head></th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {pg.rows.map(x => (
              <tr key={x.domain} className="hover:bg-slate-50 align-middle">
                <td className="px-3 py-3 font-semibold text-slate-900"><a href={x.sample_url} target="_blank" rel="noreferrer" className="hover:underline inline-flex items-center gap-1">{x.domain}<ExternalLink size={11} /></a>{x.lost > 0 && <span className="block text-11.5 font-normal text-red-600">{x.lost} lost</span>}</td>
                <td className="px-3 py-3 text-right tabular-nums">{x.live}</td>
                <td className="px-3 py-3 text-12 text-slate-600">{x.dofollow} follow · {x.nofollow} other</td>
                <td className="px-3 py-3 text-slate-600">{x.category.label}</td>
                <td className="px-3 py-3 max-w-[220px]"><span className="block truncate text-slate-600" title={x.anchors.join(', ')}>{x.anchors.join(', ') || '—'}</span></td>
                {moz ? <><td className="px-3 py-3 text-right" title={x.metrics?.source === 'apify' ? 'Figure from Apify (Moz checker): the site DA' : undefined}><Num v={x.metrics?.da} /></td><td className="px-3 py-3 text-right" title={x.metrics?.source === 'apify' ? 'Home page authority of the site' : undefined}><Num v={x.metrics?.pa} /></td><td className="px-3 py-3 text-right"><Num v={x.metrics?.spam} bad={(x.metrics?.spam ?? 0) >= 50} /></td></> : <td className="px-3 py-3 whitespace-nowrap"><SiteCell m={x.metrics} /></td>}
                <td className="px-3 py-3 text-right tabular-nums">{x.quality ? x.quality.relevance : <span className="text-slate-300">—</span>}</td>
                <td className="px-3 py-3"><Verdict u={x.useful} why={x.useful_why} /></td>
                <td className="px-3 py-3 text-slate-500 whitespace-nowrap">{day(x.last_seen)}</td>
                <td className="px-3 py-3 text-right whitespace-nowrap"><span className="inline-flex gap-1.5">
                  <OpenAct url={x.sample_url} tip="Open the site: show a page of it that links to you." />
                  <Link to={`/backlinks/links?q=${encodeURIComponent(x.domain)}`}><Act icon={Link2} tone="sky" tip="Show its links: list only the links this site gives you." /></Link>
                </span></td>
              </tr>
            ))}
            {d.state === 'ok' && !d.domains.length && <Empty>No referring domains yet.</Empty>}
          </tbody>
        </table>
      </div>
      <Pager p={pg} label="domains" />
    </>
  );
}

function Domains({ b }) {
  const [f, setF] = useState({ sort: 'links', verdict: '' });
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const r = useList(b, 'domains', { ...f, q: dq });
  const d = r.data;
  const [busyScores, errScores, runScores] = useAction();
  const [toastS, toastSNode] = useToast();
  if (r.error) return <Card><ErrorNote>{r.error.message}</ErrorNote></Card>;
  if (!d) return <SkList rows={6} />;
  const sc = d.scores || {};
  const getScores = () => runScores('scores', async () => { const x = await api(`/businesses/${b.id}/backlink-hub/metrics/refresh`, { method: 'POST' }); toastS(x.message); r.reload(true); });
  return (
    <Card pad={false}>
      {sc.configured && (
        <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-3 text-13">
          <Button size="sm" variant={sc.missing ? 'primary' : undefined} icon={RefreshCw} busy={busyScores === 'scores'} onClick={getScores}>{sc.missing ? `Get DA, PA and Spam for ${sc.missing} site${sc.missing === 1 ? '' : 's'}` : 'Refresh DA, PA and Spam'}</Button>
          <span className="text-slate-500">{sc.sites - sc.missing - sc.no_data} of {sc.sites} linking sites have figures. From {sc.source}: DA is the site's rank, PA its home page's rank (0-100), Spam is the spam score (lower is better).</span>
          <ErrorNote>{errScores}</ErrorNote>
        </div>)}
      {toastSNode}
      <Filters q={q} setQ={setQ}>
        <Select value={f.verdict} onChange={e => setF({ ...f, verdict: e.target.value })} className={sel} aria-label="Useful"><option value="">Useful or not</option>{Object.entries(USEFUL).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select>
        <Select value={f.sort} onChange={e => setF({ ...f, sort: e.target.value })} className={sel} aria-label="Sort"><option value="links">Most links</option><option value="da">Highest DA</option><option value="risk">Highest risk</option><option value="recent">Newest</option><option value="domain">A to Z</option></Select>
      </Filters>
      <DomainsTable d={d} resetKey={`${JSON.stringify(f)}|${dq}`} site={siteName(b)} />
    </Card>
  );
}

const WORK = { new: ['To do', 'gray'], planned: ['Planned', 'blue'], contacted: ['Contacted', 'amber'], live: ['Got the link', 'green'], skipped: ['Skipped', 'gray'] };
const EFFORT = { low: ['Easy', 'green'], medium: ['Some work', 'amber'], high: ['Hard', 'red'] };
const STAGES = [['todo', 'To do'], ['progress', 'In progress'], ['done', 'Got the link'], ['skipped', 'Skipped']];
const stageOf = (st) => (st === 'contacted' ? 'progress' : st === 'live' ? 'done' : st === 'skipped' ? 'skipped' : 'todo');

/** Write, address, send and track the pitch email for one place. Sending only happens when the button is pressed. */
const PURPOSES = [['submit_link', 'Post my link for me'], ['guest_post', 'Guest article'], ['listing', 'Add me to your list'], ['mention', 'Link my mention']];

function EmailPanel({ b, item, message, onChanged }) {
  const base = `/businesses/${b.id}/backlink-hub`;
  const plan = useApi(`${base}/plan`);
  const row = (plan.data?.items || []).find(x => x.domain === item.domain);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState(`Link request from ${b.name || 'our business'}`);
  const [body, setBody] = useState(message || '');
  const [found, setFound] = useState(null);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const [asks, setAsks] = useState(false);
  const [link, setLink] = useState({ url: b.website || '', title: b.name || '', description: '' });
  const [posted, setPosted] = useState('');
  const [checked, setChecked] = useState(null);
  useEffect(() => { setBody(message || ''); }, [message]);
  useEffect(() => { if (row?.published_url && !posted) setPosted(row.published_url); }, [row?.published_url]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (row?.contact_email && !to) setTo(row.contact_email); }, [row?.contact_email]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (item.email && !to) setTo(item.email); }, [item.email]); // eslint-disable-line react-hooks/exhaustive-deps
  const find = () => run('find', async () => { const r = await api(`${base}/outreach/contacts`, { method: 'POST', body: { domain: item.domain } }); setFound(r); if (r.contacts[0] && !to) setTo(r.contacts[0].email); });
  const [kind, setKind] = useState('submit_link');
  const draft = () => run('draft', async () => { const r = await api(`${base}/outreach/generate`, { method: 'POST', body: { domain: item.domain, kind, ...link, about: item.name || '' } }); setSubject(r.subject); setBody(r.body); });
  const check = () => run('check', async () => { const r = await api(`${base}/outreach/check-link`, { method: 'POST', body: { domain: item.domain, url: posted.trim() } }); setChecked(r.result); plan.reload(true); onChanged?.(); });
  const left = /\[add/i.test(body) || /\[add/i.test(subject);
  const send = () => {
    if (!window.confirm(`Send this email to ${to}?\n\nIt goes from your platform mail account and replies come to ${b.contact_email || 'that account'}.`)) return;
    run('send', async () => { await api(`${base}/outreach/send`, { method: 'POST', body: { domain: item.domain, to, subject, body, name: item.name, source: item.source || 'competitor' } }); plan.reload(true); toast(`Email sent to ${to}`); onChanged?.(); });
  };
  const replied = (v) => run('replied', async () => { await api(`${base}/outreach/replied`, { method: 'POST', body: { domain: item.domain, replied: v } }); plan.reload(true); onChanged?.(); });
  const inp = 'h-9 px-3 text-13 rounded-lg ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none w-full';
  return (
    <section className="rounded-lg ring-1 ring-inset ring-slate-200 p-3 grid gap-2.5">
      <h4 className="text-12 font-semibold uppercase tracking-wide text-slate-500">Email this site</h4>
      {row?.emailed_at && (
        <p className={`rounded-lg px-3 py-2 text-12.5 ${row.replied_at ? 'bg-emerald-50 text-emerald-800' : row.follow_up_due ? 'bg-amber-50 text-amber-800' : 'bg-slate-50 text-slate-700'}`}>
          Sent {row.email_count > 1 ? `${row.email_count} times, last ` : ''}on {fmtDate(row.emailed_at)} to <b>{row.contact_email}</b>.{' '}
          {row.replied_at ? `They replied on ${fmtDate(row.replied_at)}.` : row.follow_up_due ? 'No reply for over a week: send a short follow-up.' : 'No reply yet.'}{' '}
          <button type="button" onClick={() => replied(!row.replied_at)} className="font-semibold underline cursor-pointer">{row.replied_at ? 'Not replied' : 'They replied'}</button>
        </p>
      )}
      <div className="flex gap-2"><input value={to} onChange={e => setTo(e.target.value)} placeholder="Their email address" aria-label="To" className={inp} />
        <Button size="sm" icon={Search} busy={busy === 'find'} onClick={find}>Find email</Button></div>
      {found && (found.contacts.length ? (
        <div className="flex flex-wrap items-center gap-1.5 text-12"><span className="text-slate-500">Published on the site:</span>
          {found.contacts.map(c => <button key={c.email} type="button" onClick={() => setTo(c.email)} title={`${c.how} on ${c.page}`} className={`rounded-full px-2.5 py-1 ring-1 ring-inset cursor-pointer ${to === c.email ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}>{c.email}</button>)}</div>
      ) : <p className="text-12.5 text-amber-800">{found.note}</p>)}
      <div className="flex flex-wrap items-center gap-2 text-12.5"><span className="text-slate-500">This platform posts links for you?</span>
        <button type="button" onClick={() => setAsks(v => !v)} className="font-semibold text-indigo-600 hover:underline cursor-pointer">{asks ? 'Hide' : 'Write the email for me'}</button></div>
      {asks && (
        <div className="grid gap-2 rounded-lg bg-slate-50 p-2.5">
          <div className="flex flex-wrap gap-1.5">{PURPOSES.map(([k, l]) => <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k} className={`h-8 px-3 rounded-full text-12 font-semibold cursor-pointer ring-1 ring-inset ${kind === k ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}>{l}</button>)}</div>
          <input value={link.url} onChange={e => setLink({ ...link, url: e.target.value })} placeholder="Your page to link to" aria-label="Your link" className={inp} />
          <input value={link.title} onChange={e => setLink({ ...link, title: e.target.value })} placeholder="Title they should show" aria-label="Title" className={inp} maxLength={160} />
          <input value={link.description} onChange={e => setLink({ ...link, description: e.target.value })} placeholder="One or two lines about it (optional)" aria-label="Description" className={inp} maxLength={600} />
          <div><Button size="sm" icon={Sparkles} busy={busy === 'draft'} disabled={!link.url.trim()} onClick={draft}>Write the email</Button><span className="ml-2 text-11.5 text-slate-400">Written by AI when it is set up, from a template otherwise. You edit it before sending.</span></div>
        </div>
      )}
      <input value={subject} onChange={e => setSubject(e.target.value)} maxLength={200} aria-label="Subject" className={inp} />
      <textarea value={body} onChange={e => setBody(e.target.value)} rows={8} maxLength={5000} aria-label="Message" className="px-3 py-2 text-13 rounded-lg ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none w-full" />
      {left && <p className="text-12 text-amber-700">Fill in the [add ...] parts before sending.</p>}
      <ErrorNote>{error}</ErrorNote>
      <div className="flex items-center gap-3"><Button size="sm" variant="primary" icon={Send} busy={busy === 'send'} disabled={!to.includes('@') || left || body.trim().length < 30} onClick={send}>{row?.emailed_at ? 'Send again' : 'Send email'}</Button>
        <span className="text-11.5 text-slate-400">Nothing is sent until you press this. Keep it honest and personal: no payment or link swaps.</span></div>
      {row?.emailed_at && (
        <div className="border-t border-slate-100 pt-2.5 grid gap-2">
          <h4 className="text-12 font-semibold uppercase tracking-wide text-slate-500">After they post it</h4>
          <div className="flex gap-2"><input value={posted} onChange={e => setPosted(e.target.value)} placeholder={`Address of the page on ${item.domain} that has your link`} aria-label="Page with your link" className={inp} />
            <Button size="sm" icon={Search} busy={busy === 'check'} disabled={posted.trim().length < 8} onClick={check}>Check the link</Button></div>
          {(checked || row.link_checked_at) && (() => { const f = checked ? checked.found : row.link_found; const rel = checked ? checked.rel : row.link_rel; return f
            ? <p className="rounded-lg bg-emerald-50 text-emerald-800 px-3 py-2 text-12.5">Your link is there{rel && rel !== 'dofollow' ? ` (rel: ${rel}: it passes little ranking value)` : ' and it is followed'}. Marked as “Got the link”.</p>
            : <p className="rounded-lg bg-amber-50 text-amber-800 px-3 py-2 text-12.5">{checked?.note || 'Your link was not on the page the last time we looked.'} Reply to them politely or check again later.</p>; })()}
        </div>
      )}
      {toastNode}
    </section>
  );
}

function AdviceModal({ b, item, onClose, onChanged }) {
  const [adv, setAdv] = useState(null);
  const [note, setNote] = useState(item?.note || '');
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const base = `/businesses/${b.id}/backlink-hub`;
  const load = (refresh = false) => run('advice', async () => { setAdv(await api(`${base}/advice`, { method: 'POST', body: { domain: item.domain, refresh } })); });
  useEffect(() => { if (item) { setAdv(null); setNote(item.note || ''); load(false); } }, [item?.domain]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!item) return null;
  const mark = (status) => run('mark', async () => { await api(`${base}/plan`, { method: 'POST', body: { domain: item.domain, status, note, source: item.source || 'competitor', name: item.name } }); toast(`Marked: ${WORK[status][0]}`); onChanged(); });
    const [el, et] = EFFORT[adv?.effort] || EFFORT.medium;
  return (
    <Modal open title={item.name || item.domain} onClose={onClose} width="max-w-2xl"
      footer={<div className="flex flex-wrap items-center gap-2 w-full">
        <Button size="sm" busy={busy === 'mark'} onClick={() => mark('planned')}>Add to my plan</Button>
        <Button size="sm" busy={busy === 'mark'} onClick={() => mark('contacted')}>I contacted them</Button>
        <Button size="sm" variant="primary" busy={busy === 'mark'} onClick={() => mark('live')}>I got the link</Button>
        <Button size="sm" busy={busy === 'mark'} onClick={() => mark('skipped')}>Not for us</Button>
        <Button size="sm" className="ml-auto" onClick={onClose}>Close</Button>
      </div>}>
      <div className="grid gap-4 text-13">
        <a href={`https://${item.domain}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-600 hover:underline w-fit">{item.domain}<ExternalLink size={12} /></a>
        <ErrorNote>{error}</ErrorNote>
        {!adv && !error && <SkList rows={3} />}
        {adv && (
          <>
            <div className="flex flex-wrap items-center gap-2"><span className="text-slate-700">{adv.what_it_is}</span><Badge tone={et}>{el}</Badge><Badge tone={adv.method === 'ai' ? 'blue' : 'gray'}>{adv.method === 'ai' ? 'Advice by AI' : 'Standard advice'}</Badge></div>
            <section><h4 className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1.5">What you get from a link here</h4><ul className="grid gap-1 list-disc pl-5 text-slate-700">{adv.what_you_get.map((x, i) => <li key={i}>{x}</li>)}</ul></section>
            <section><h4 className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1.5">How to get it</h4><ol className="grid gap-1 list-decimal pl-5 text-slate-700">{adv.steps.map((x, i) => <li key={i}>{x}</li>)}</ol></section>
            <EmailPanel b={b} item={item} message={adv.message} onChanged={onChanged} />
            {adv.caution && <p className="rounded-lg bg-amber-50 text-amber-800 px-3 py-2 text-12.5">{adv.caution}</p>}
            <label className="grid gap-1"><span className="text-12 font-semibold text-slate-500">Your note (who you contacted, when)</span><input value={note} onChange={e => setNote(e.target.value)} maxLength={500} className="h-9 px-3 text-13 rounded-lg ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none" /></label>
            <button type="button" onClick={() => load(true)} className="text-12 text-slate-500 hover:underline w-fit cursor-pointer">Write the advice again</button>
          </>
        )}
      </div>
      {toastNode}
    </Modal>
  );
}

const aiValue = (p, k) => ({ site: p.name, kind: p.kind, why: p.why, how: p.how })[k];
function AiTable({ rows, busy, add, onOpen, site }) {
  const { sorted, sort, onSort } = useSorted(rows, aiValue);
  const pg = usePager(sorted, { size: 10 });
  return (
    <>
        <CsvBar pad="" name={`link-places-suggested-${site}`} head={['Site', 'Domain', 'Kind', 'You get', 'First step']} rows={() => sorted.map(p => [p.name, p.domain, p.kind, p.why, p.how])} tip={`Exports all ${sorted.length} suggested places`} />
        <div className="overflow-x-auto -mx-5">
          <table className="w-full min-w-[820px] text-13">
            <thead className="bg-slate-50 text-12 uppercase tracking-wide text-slate-500"><tr>
              <SortTh id="site" sort={sort} onSort={onSort} className={TC} tip={{ what: 'The website or listing site the AI suggests.', from: 'the AI, from what your business does and where it is.' }}>Site</SortTh>
              <SortTh id="kind" sort={sort} onSort={onSort} className={TC} tip={{ what: 'The kind of place: directory, news, community, partner and so on.' }}>Kind</SortTh>
              <SortTh id="why" sort={sort} onSort={onSort} className={TC} tip={{ what: 'What a link on this site gives you.', why: 'Pick the places with the most value for you.' }}>You get</SortTh>
              <SortTh id="how" sort={sort} onSort={onSort} className={TC} tip={{ what: 'The first thing to do to get the link.', why: 'Start here, then open the Guide for the full steps and a message.' }}>First step</SortTh>
              <th className={`${TH} text-right`}><Head right what="Add the site to your plan, open its Guide, or open the site." why="Suggestions are not checked: look at the site before you use it.">Actions</Head></th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {pg.rows.map(p => (
                <tr key={p.domain} className="align-top hover:bg-slate-50">
                  <td className="px-3 py-3 font-semibold text-slate-900 whitespace-nowrap">{p.name}<span className="block text-11.5 font-normal text-slate-400">{p.domain}</span></td>
                  <td className="px-3 py-3"><Badge tone="gray">{p.kind}</Badge></td>
                  <td className="px-3 py-3 max-w-[280px] text-slate-700">{p.why}</td>
                  <td className="px-3 py-3 max-w-[280px] text-slate-600">{p.how}</td>
                  <td className="px-3 py-3 text-right whitespace-nowrap"><span className="inline-flex gap-1.5">
                    <Act icon={Plus} tone="green" tip="Add to plan: put this site in your link plan." busy={busy === p.domain} onClick={() => add(p)} />
                    <Act icon={BookOpen} tone="violet" tip="Guide: how to get the link, with a draft message." onClick={() => onOpen({ domain: p.domain, name: p.name, source: 'ai' })} />
                    <OpenAct url={`https://${p.domain}`} tip="Open: show the site in a new tab." />
                  </span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="-mx-5"><Pager p={pg} label="sites" /></div>
    </>
  );
}

function AiPlatforms({ b, onOpen, onChanged }) {
  const [res, setRes] = useState(null);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const base = `/businesses/${b.id}/backlink-hub`;
  const ask = () => run('ask', async () => setRes(await api(`${base}/platforms/suggest`, { method: 'POST' })));
  const add = (p) => run(p.domain, async () => { await api(`${base}/plan`, { method: 'POST', body: { domain: p.domain, status: 'planned', source: 'ai', name: p.name } }); setRes(r => ({ ...r, platforms: r.platforms.filter(x => x.domain !== p.domain) })); toast(`${p.name} added to your plan`); onChanged(); });
  return (
    <Card title="More places to get links, chosen by AI for your business" subtitle="Not only where competitors are: sites that fit what you do and where you are. Suggestions, to be checked before you use them."
      action={<Button size="sm" variant="primary" icon={Sparkles} busy={busy === 'ask'} onClick={ask}>{res ? 'Suggest again' : 'Suggest places'}</Button>}>
      <ErrorNote>{error}</ErrorNote>
      {!res && <p className="text-13 text-slate-500">Press “Suggest places” and the AI lists sites that suit this business, what a link there gives you, and the first step.</p>}
      {res?.state === 'no_ai' && <p className="text-13 text-amber-800">{res.message}</p>}
      {res?.state === 'error' && <p className="text-13 text-amber-800">{res.message}</p>}
      {res?.state === 'ok' && (res.platforms.length === 0 ? <p className="text-13 text-slate-500">Nothing new to suggest right now.</p> : (
        <AiTable rows={res.platforms} busy={busy} add={add} onOpen={onOpen} site={siteName(b)} />
      ))}
      {res?.note && <p className="text-11.5 text-slate-400 mt-3">{res.note}</p>}
      {toastNode}
    </Card>
  );
}

/** Write one email per chosen platform, let the owner read and fix each, then send them from the system. */
function BulkModal({ b, platforms, onClose, onSent }) {
  const base = `/businesses/${b.id}/backlink-hub`;
  const [kind, setKind] = useState('submit_link');
  const [drafts, setDrafts] = useState(null);
  const [results, setResults] = useState(null);
  const [busy, error, run] = useAction();
  const write = () => run('write', async () => {
    const out = [];
    for (const p of platforms) {
      const r = await api(`${base}/outreach/generate`, { method: 'POST', body: { domain: p.domain, kind, url: b.website || '', title: b.name || '', description: '', about: p.title || '' } });
      out.push({ domain: p.domain, name: p.title || p.domain, to: p.emails[0]?.email || '', subject: r.subject, body: r.body, include: true });
    }
    setDrafts(out); setResults(null);
  });
  useEffect(() => { write(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (i, patch) => setDrafts(d => d.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const ready = (drafts || []).filter(x => x.include && x.to.includes('@') && !/\[add/i.test(x.body));
  const send = () => {
    if (!window.confirm(`Send ${ready.length} email${ready.length === 1 ? '' : 's'}? Each goes to its own platform from your platform mail account.`)) return;
    run('send', async () => { const r = await api(`${base}/outreach/send-many`, { method: 'POST', body: { items: ready.map(x => ({ domain: x.domain, to: x.to, subject: x.subject, body: x.body, name: x.name, source: 'manual' })) } }); setResults(r.results); onSent(); });
  };
  const inp = 'h-9 px-3 text-13 rounded-lg ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none w-full';
  const res = (d) => (results || []).find(r => r.domain === d);
  return (
    <Modal open title={`Email ${platforms.length} platform${platforms.length === 1 ? '' : 's'}`} onClose={onClose} width="max-w-3xl"
      footer={<div className="flex items-center gap-2 w-full"><span className="text-12 text-slate-500">Read each email: nothing is sent until you press Send. At most 10 at a time.</span>
        <Button size="sm" className="ml-auto" onClick={onClose}>{results ? 'Done' : 'Close'}</Button>
        {!results && <Button size="sm" variant="primary" icon={Send} busy={busy === 'send'} disabled={!ready.length} onClick={send}>Send {ready.length} email{ready.length === 1 ? '' : 's'}</Button>}</div>}>
      <div className="grid gap-3 text-13">
        <div className="flex flex-wrap items-center gap-1.5"><span className="text-slate-500">Purpose:</span>{PURPOSES.map(([k, l]) => <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k} className={`h-8 px-3 rounded-full text-12 font-semibold cursor-pointer ring-1 ring-inset ${kind === k ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}>{l}</button>)}
          <Button size="sm" icon={Sparkles} busy={busy === 'write'} onClick={write}>Write again</Button></div>
        <ErrorNote>{error}</ErrorNote>
        {!drafts && <SkList rows={3} />}
        {(drafts || []).map((x, i) => { const r = res(x.domain); return (
          <div key={x.domain} className={`rounded-lg ring-1 ring-inset p-3 grid gap-2 ${r ? (r.ok ? 'ring-emerald-300 bg-emerald-50/40' : 'ring-red-300 bg-red-50/40') : 'ring-slate-200'}`}>
            <div className="flex items-center gap-2"><input type="checkbox" checked={x.include} onChange={e => set(i, { include: e.target.checked })} aria-label={`Send to ${x.domain}`} disabled={!!results} />
              <span className="font-semibold text-slate-900">{x.domain}</span>{r && <Badge tone={r.ok ? 'green' : 'red'}>{r.ok ? 'Sent' : 'Not sent'}</Badge>}</div>
            {r && !r.ok && <p className="text-12.5 text-red-700">{r.error}</p>}
            {!results && (<>
              <input value={x.to} onChange={e => set(i, { to: e.target.value })} placeholder="Their email address" aria-label="To" className={inp} />
              <input value={x.subject} onChange={e => set(i, { subject: e.target.value })} aria-label="Subject" className={inp} maxLength={200} />
              <textarea value={x.body} onChange={e => set(i, { body: e.target.value })} rows={6} aria-label="Message" className="px-3 py-2 text-13 rounded-lg ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none w-full" maxLength={5000} />
            </>)}
          </div>); })}
      </div>
    </Modal>
  );
}

const foundValue = (p, k) => ({ domain: p.domain, kinds: (p.kinds || []).join(', '), email: p.emails?.[0]?.email, plan: p.in_plan })[k];
function FoundTable({ rows, picked, setPicked, busy, take, site }) {
  const { sorted, sort, onSort } = useSorted(rows, foundValue);
  const pg = usePager(sorted, { size: 25 });
  return (
    <div className="border-b border-slate-100">
        <CsvBar name={`outreach-platforms-${site}`} head={['Platform', 'Page found', 'Title', 'Found by', 'Emails', 'In plan']} rows={() => sorted.map(p => [p.domain, p.page || '', p.title || '', (p.kinds || []).join(', '), (p.emails || []).map(e => e.email).join('; '), p.in_plan || ''])} tip={`Exports all ${sorted.length} platforms found`} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-13">
            <thead className="bg-slate-50 text-12 uppercase tracking-wide text-slate-500"><tr>
              <th className={`${TH} w-8`}><span className="sr-only">Choose</span></th>
              <SortTh id="domain" sort={sort} onSort={onSort} className={TC} tip={{ what: 'A website the searches found.', from: 'Google results for your searches.' }}>Platform</SortTh>
              <SortTh id="kinds" sort={sort} onSort={onSort} className={TC} tip={{ what: 'Which kind of search found it: sends links by email, guest posts or list pages.' }}>Found by</SortTh>
              <SortTh id="email" sort={sort} onSort={onSort} className={TC} tip={{ what: 'Email addresses the site itself publishes on its contact, about or submission pages.', why: 'Send your request here. Check that the site fits first.', from: "the site's own pages." }}>Email</SortTh>
              <SortTh id="plan" sort={sort} onSort={onSort} className={TC} tip={{ what: 'Whether it is already in your plan.' }}>In plan</SortTh>
              <th className={`${TH} text-right`}><Head right what="Add to the plan and write the email, or open the site." why="Look at the site before you email it.">Actions</Head></th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {pg.rows.map(p => (
                <tr key={p.domain} className="align-top hover:bg-slate-50">
                  <td className="px-3 py-3"><input type="checkbox" disabled={!p.emails.length} checked={picked.includes(p.domain)} onChange={e => setPicked(v => (e.target.checked ? [...v, p.domain].slice(0, 10) : v.filter(d => d !== p.domain)))} aria-label={`Choose ${p.domain}`} title={p.emails.length ? 'Include in the batch email' : 'No email published: use its contact form'} /></td>
                  <td className="px-3 py-3 max-w-[300px]"><a href={p.page} target="_blank" rel="noreferrer noopener" className="font-semibold text-indigo-600 hover:underline">{p.domain}</a><span className="block text-12 text-slate-500 truncate" title={p.snippet}>{p.title}</span></td>
                  <td className="px-3 py-3 text-slate-600 max-w-[220px]">{p.kinds.join(', ')}</td>
                  <td className="px-3 py-3">{p.emails.length ? <ul className="grid gap-0.5">{p.emails.map(e => <li key={e.email} className="font-mono text-12 text-slate-800" title={`${e.how} on ${e.page}`}>{e.email}</li>)}</ul> : <span className="text-12 text-slate-400">None published: use its contact form</span>}</td>
                  <td className="px-3 py-3 text-slate-600">{p.in_plan ? <Badge tone="gray">{p.in_plan}</Badge> : <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-3 text-right whitespace-nowrap"><span className="inline-flex gap-1.5">
                    <Act icon={Send} tone="violet" tip="Email: add it to your plan and write the email to this platform." busy={busy === `take${p.domain}`} onClick={() => take(p, p.emails[0]?.email)} />
                    <OpenAct url={p.page} tip="Open: look at the site in a new tab." />
                  </span></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-500">No platforms came up. Try again later or use the searches below.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager p={pg} label="platforms" />
    </div>
  );
}

/** Searches that find sites worth emailing, and a place to add a site you found yourself. */
function FindSites({ b, onOpen, onChanged }) {
  const base = `/businesses/${b.id}/backlink-hub`;
  const r = useApi(`${base}/outreach/search-ideas`);
  const [site, setSite] = useState('');
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const d = r.data;
  const [found, setFound] = useState(null);
  const [picked, setPicked] = useState([]);
  const [mailing, setMailing] = useState(false);
  const discover = (force = false) => run('discover', async () => { setFound(await api(`${base}/outreach/discover${force ? '?force=1' : ''}`, { method: 'POST' })); });
  const take = (p, email) => run(`take${p.domain}`, async () => { await api(`${base}/plan`, { method: 'POST', body: { domain: p.domain, status: 'planned', source: 'manual', name: p.title || p.domain } }); onChanged(); setFound(f => ({ ...f, platforms: f.platforms.map(x => x.domain === p.domain ? { ...x, in_plan: 'planned' } : x) })); onOpen({ domain: p.domain, name: p.title || p.domain, source: 'manual', email }); });
  const clean = site.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  const add = () => run('add', async () => { await api(`${base}/plan`, { method: 'POST', body: { domain: clean, status: 'planned', source: 'manual', name: clean } }); toast(`${clean} added to your plan`); setSite(''); onChanged(); onOpen({ domain: clean, name: clean, source: 'manual' }); });
  return (
    <Card title="Find more sites to email" subtitle="Searches written from your services and area. Open one, look for a site that fits, then add it here and email it from the Guide." pad={false}
      action={<div className="flex items-center gap-2"><input value={site} onChange={e => setSite(e.target.value)} onKeyDown={e => e.key === 'Enter' && clean.includes('.') && add()} placeholder="site you found, e.g. blog.com" aria-label="Site to add" className="h-8 w-52 px-3 text-13 rounded-lg ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none" />
        <Button size="sm" variant="primary" icon={Plus} busy={busy === 'add'} disabled={!clean.includes('.')} onClick={add}>Add and write the email</Button></div>}>
      <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-3">
        <Button size="sm" variant="primary" icon={Sparkles} busy={busy === 'discover'} onClick={() => discover(!!found)}>{found ? 'Search again' : 'Find platforms and emails for me'}</Button>
        <span className="text-12.5 text-slate-500">Runs the searches below, opens the sites that come up and reads the email addresses they publish. Takes about a minute.</span>
        {picked.length > 0 && <Button size="sm" className="ml-auto" icon={Send} onClick={() => setMailing(true)}>Write and send emails to {picked.length} chosen</Button>}
      </div>
      {found?.state && found.state !== 'ok' && <p className="px-5 py-3 text-13 text-amber-800">{found.message}</p>}
      {found?.state === 'ok' && (
        <FoundTable rows={found.platforms} picked={picked} setPicked={setPicked} busy={busy} take={take} site={siteName(b)} />
      )}
      <ErrorNote>{error}</ErrorNote>
      {r.error && <p className="px-5 py-4 text-13 text-red-600">{r.error.message}</p>}
      {!d && !r.error && <SkList rows={3} />}
      {d?.state === 'no_topic' && <p className="px-5 py-6 text-13 text-slate-500">{d.note}</p>}
      {d?.state === 'ok' && (
        <div className="overflow-x-auto">
          <CsvBar name={`outreach-searches-${siteName(b)}`} head={['Kind of site', 'Search', 'Search link', 'Finds', 'What to ask']} rows={() => d.groups.flatMap(g => g.queries.map(x => [g.title, x.q, x.url || '', x.why || '', g.ask || '']))} tip="Exports every search, with the kind of site and what to ask" />
          <table className="w-full min-w-[860px] text-13">
            <thead className="bg-slate-50 text-12 uppercase tracking-wide text-slate-500"><tr>
              <th className={TH}><Head what="The kind of site this search finds." why="Each kind needs a different ask.">Kind of site</Head></th>
              <th className={TH}><Head what="The Google search to run. It uses your services and area." from="your business details.">Search</Head></th>
              <th className={TH}><Head what="What the search turns up.">Finds</Head></th>
              <th className={TH}><Head what="What to ask for when you email a site of this kind.">What to ask</Head></th>
              <th className={`${TH} text-right`}><Head right what="Run the search on Google in a new tab." why="Read the first results, pick the sites that fit, then add them here.">Actions</Head></th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {d.groups.flatMap(g => g.queries.map((x, i) => (
                <tr key={`${g.key}${i}`} className="align-top hover:bg-slate-50">
                  <td className="px-3 py-3 font-semibold text-slate-900 whitespace-nowrap">{i === 0 ? g.title : ''}</td>
                  <td className="px-3 py-3 font-mono text-12 text-slate-700 max-w-[320px] break-words">{x.q}</td>
                  <td className="px-3 py-3 text-slate-600 max-w-[240px]">{x.why}</td>
                  <td className="px-3 py-3 text-slate-600 max-w-[260px]">{i === 0 ? g.ask : ''}</td>
                  <td className="px-3 py-3 text-right whitespace-nowrap"><a href={x.url} target="_blank" rel="noreferrer noopener"><Act icon={Search} tone="sky" tip="Search: run this search on Google in a new tab." /></a></td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      )}
      {mailing && <BulkModal b={b} platforms={(found?.platforms || []).filter(p => picked.includes(p.domain))} onClose={() => { setMailing(false); }} onSent={() => { onChanged(); setPicked([]); }} />}
      {toastNode}
    </Card>
  );
}

const doneSource = (x) => (x.source === 'ai' ? 'Suggested by AI' : x.source === 'manual' ? 'Found by you' : 'Competitor gap');
const doneValue = (x, k) => ({ domain: x.domain, source: doneSource(x), result: x.confirmed ? 0 : 1, note: x.note })[k];
function DoneTable({ rows, site }) {
  const { sorted, sort, onSort } = useSorted(rows, doneValue);
  const pg = usePager(sorted, { size: 25 });
  return (
    <>
    <CsvBar name={`links-won-${site}`} head={['Site', 'Where it came from', 'Result', 'Note']} rows={() => sorted.map(x => [x.domain, doneSource(x), x.confirmed ? 'Confirmed by the crawler' : 'Marked by you: not seen by the crawler yet', x.note || ''])} tip={`Exports all ${sorted.length} sites`} />
    <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-13">
                <thead className="bg-slate-50 text-12 uppercase tracking-wide text-slate-500"><tr><SortTh id="domain" sort={sort} onSort={onSort} className={TC}>Site</SortTh><SortTh id="source" sort={sort} onSort={onSort} className={TC}>Where it came from</SortTh><SortTh id="result" sort={sort} onSort={onSort} className={TC}>Result</SortTh><SortTh id="note" sort={sort} onSort={onSort} className={TC}>Note</SortTh><th className={`${TH} text-right`}>Actions</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {pg.rows.map(x => <tr key={x.domain} className="align-middle"><td className="px-3 py-3 font-semibold text-slate-900">{x.domain}</td><td className="px-3 py-3 text-slate-600">{x.source === 'ai' ? 'Suggested by AI' : x.source === 'manual' ? 'Found by you' : 'Competitor gap'}</td><td className="px-3 py-3">{x.confirmed ? <Badge tone="green">Confirmed by the crawler</Badge> : <Badge tone="amber">Marked by you: not seen by the crawler yet</Badge>}</td><td className="px-3 py-3 text-slate-600">{x.note || '—'}</td><td className="px-3 py-3 text-right"><OpenAct url={`https://${x.domain}`} tip="Open the site that gave you the link." /></td></tr>)}
                  {!rows.length && <Empty>No link won yet. Work through “To do”: the crawler confirms a link when it finds it.</Empty>}
                </tbody>
              </table>
    </div>
      <Pager p={pg} label="sites" />
    </>
  );
}

const PRI = { high: 3, medium: 2, low: 1 };
const oppValue = (planMap) => (x, k) => ({
  priority: PRI[x.priority] || 1, domain: x.domain, competitors: (x.competitors || []).length, category: x.category?.label, follow: x.follow,
  da: num(x.metrics?.da), useful: x.useful, status: x.status, email: stamp(planMap[x.domain]?.emailed_at)
})[k];
function OppTable({ rows, all, stage, planMap, busy, setStatus, setOpen, resetKey, site }) {
  const valueOf = useMemo(() => oppValue(planMap), [planMap]);
  const { sorted, sort, onSort } = useSorted(rows, valueOf);
  const pg = usePager(sorted, { size: 25, resetKey });
  const moz = hasMoz(rows);
  const csv = () => sorted.map(x => { const m = planMap[x.domain]; return [(PRIORITY[x.priority] || PRIORITY.low)[0], x.domain, x.sample?.url || '', (x.competitors || []).join(', '), x.category?.label || '', (FOLLOW[x.follow] || FOLLOW.dofollow)[0], ...(moz ? [num(x.metrics?.da)] : []),
    (USEFUL[x.useful] || USEFUL.unscored)[0], (WORK[x.status] || WORK.new)[0], m?.emailed_at ? (m.replied_at ? 'Replied' : m.follow_up_due ? 'Follow up' : 'Sent') : 'Not emailed', m?.emailed_at || '', m?.contact_email || '', x.note || '']; });
  return (
    <>
    <CsvBar name={`link-opportunities-${site}`} head={['Priority', 'Site', 'Page that links to a competitor', 'Competitors linked there', 'Category', 'Follow', ...(moz ? ['DA'] : []), 'Useful?', 'Status', 'Email', 'Email sent on', 'Emailed to', 'Note']} rows={csv} tip={`Exports all ${sorted.length} sites in this list (up to 200 are loaded)`} />
    <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-13">
                <thead className="bg-slate-50 text-12 uppercase tracking-wide text-slate-500"><tr>
                  <SortTh id="priority" sort={sort} onSort={onSort} first="desc" className={TC}>Priority</SortTh><SortTh id="domain" sort={sort} onSort={onSort} className={TC}>Site</SortTh><SortTh id="competitors" sort={sort} onSort={onSort} first="desc" className={TC}>Competitors linked there</SortTh><SortTh id="category" sort={sort} onSort={onSort} className={TC}>Category</SortTh><SortTh id="follow" sort={sort} onSort={onSort} className={TC}>Follow</SortTh>{moz && <SortTh id="da" sort={sort} onSort={onSort} right first="desc" className={TC}>DA</SortTh>}<SortTh id="useful" sort={sort} onSort={onSort} className={TC}>Useful?</SortTh><SortTh id="status" sort={sort} onSort={onSort} className={TC}>Status</SortTh><SortTh id="email" sort={sort} onSort={onSort} first="desc" className={TC} tip={{ what: 'Whether you emailed this site, to whom, and whether they replied.', why: 'Follow up after a week without a reply.', from: 'the emails you sent from the Guide.' }}>Email</SortTh><th className={`${TH} text-right`}><Head right what="Guide shows how to ask this site for a link. Open shows the site's page that links to your competitor." why="Contact the sites in the order of priority.">Actions</Head></th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {pg.rows.map(x => { const [pl2, pt] = PRIORITY[x.priority] || PRIORITY.low; return (
                    <tr key={x.domain} className="hover:bg-slate-50 align-middle">
                      <td className="px-3 py-3"><Badge tone={pt}>{pl2}</Badge></td>
                      <td className="px-3 py-3 max-w-[220px]"><a href={x.sample.url} target="_blank" rel="noreferrer" className="font-semibold text-indigo-600 hover:underline inline-flex items-center gap-1">{x.domain}<ExternalLink size={11} /></a>{x.note && <span className="block truncate text-11.5 text-slate-400" title={x.note}>{x.note}</span>}</td>
                      <td className="px-3 py-3 text-slate-600"><Tip text={x.competitors.join(', ')}><span>{x.competitors.join(', ')}</span></Tip></td>
                      <td className="px-3 py-3 text-slate-600">{x.category.label}</td>
                      <td className="px-3 py-3"><FollowBadge f={x.follow} /></td>
                      {moz && <td className="px-3 py-3 text-right"><Num v={x.metrics?.da} /></td>}
                      <td className="px-3 py-3"><Verdict u={x.useful} why={x.useful_why} /></td>
                      <td className="px-3 py-3"><Select value={x.status} onChange={e => setStatus(x, e.target.value)} className="h-8 text-13 min-w-[130px]" aria-label={`Status of ${x.domain}`} disabled={busy === x.domain}><option value="new">To do</option><option value="planned">Planned</option><option value="contacted">Contacted</option><option value="live">Got the link</option><option value="skipped">Skipped</option></Select></td>
                      <td className="px-3 py-3 text-12.5 whitespace-nowrap">{(() => { const m = planMap[x.domain]; if (!m?.emailed_at) return <span className="text-slate-300">Not emailed</span>; return <Tip text={`${m.email_subject || ''} · to ${m.contact_email}`}><span className={m.replied_at ? 'text-emerald-700 font-semibold' : m.follow_up_due ? 'text-amber-700 font-semibold' : 'text-slate-600'}>{m.replied_at ? 'Replied' : m.follow_up_due ? 'Follow up' : 'Sent'} · {fmtDate(m.replied_at || m.emailed_at)}</span></Tip>; })()}</td>
                      <td className="px-3 py-3 text-right whitespace-nowrap"><span className="inline-flex gap-1.5"><Act icon={BookOpen} tone="violet" tip="Guide: how to ask this site for a link, with a draft message and the email to send." onClick={() => setOpen(x)} /><OpenAct url={x.sample?.url} tip="Open the site: the page that links to your competitor." /></span></td>
                    </tr>); })}
                  {!rows.length && <Empty>{stage === 'todo' ? (all.length ? 'Nothing left to do here.' : 'No opportunities yet: your crawler has not found sites that link to your competitors and not to you.') : stage === 'progress' ? 'Nothing in progress. Open a site and press “I contacted them”.' : 'Nothing skipped.'}</Empty>}
                </tbody>
              </table>
    </div>
      <Pager p={pg} label="sites" />
    </>
  );
}

function Opportunities({ b }) {
  const [stage, setStage] = useState('todo');
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const dq = useDebounced(q);
  const r = useList(b, 'opportunities', { q: dq, category: cat, limit: 200 });
  const sk = useList(b, 'opportunities', { status: 'skipped', limit: 200 });
  const pl = useApi(`/businesses/${b.id}/backlink-hub/plan`);
  const [busy, error, run] = useAction();
  const d = r.data;
  if (r.error) return <Card><ErrorNote>{r.error.message}</ErrorNote></Card>;
  if (!d) return <SkList rows={6} />;
  const changed = () => { r.reload(true); sk.reload(true); pl.reload(true); };
  const setStatus = (x, status) => run(x.domain, async () => { await api(`/businesses/${b.id}/backlink-hub/plan`, { method: 'POST', body: { domain: x.domain, status, source: 'competitor' } }); changed(); });
  const all = d.opportunities || [];
  const done = (pl.data?.items || []).filter(x => x.status === 'live');
  const planMap = Object.fromEntries((pl.data?.items || []).map(x => [x.domain, x]));
  const lists = { todo: all.filter(x => stageOf(x.status) === 'todo'), progress: all.filter(x => stageOf(x.status) === 'progress'), skipped: sk.data?.opportunities || [] };
  const shown = lists[stage] || [];
  const pill = (on) => `h-8 px-3 rounded-full text-12 font-semibold cursor-pointer ring-1 ring-inset ${on ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`;
  const count = (id) => (id === 'done' ? done.length : (lists[id] || []).length);
  return (
    <>
      <Card title="Where your competitors have links and you do not" subtitle={d.competitors?.length ? 'Your competitors are the ones saved on the Competitors page. Spammy sites are left out.' : 'Add competitors first.'}
        action={<Link to="/competitor-finder"><Button size="sm">Manage competitors</Button></Link>}>
        {d.competitors?.length > 0 && <div className="flex flex-wrap items-center gap-2 mb-3 text-12 text-slate-500"><span>Compared with:</span>{d.competitors.map(c => <Badge key={c} tone="gray">{c}</Badge>)}</div>}
        {d.state === 'no_target' && <p className="text-13 text-slate-500">Add the project's website first.</p>}
        {d.state === 'no_competitors' && <p className="text-13 text-slate-500">No competitors are saved for this project. Find them on the <Link to="/competitor-finder" className="text-indigo-600 hover:underline">Competitors page</Link>; their links are then read by your crawler.</p>}
        {d.note && <p className="text-13 text-slate-500">{d.note}</p>}
        {d.state === 'ok' && <p className="text-12.5 text-slate-500">{lists.todo.filter(x => x.priority === 'high').length} high priority. A link is confirmed automatically when the crawler sees it on the site.</p>}
      </Card>
      {d.state === 'ok' && (
        <Card pad={false}>
          <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-slate-100">
            {STAGES.map(([id, label]) => <button key={id} type="button" aria-pressed={stage === id} onClick={() => setStage(id)} className={pill(stage === id)}>{label} <span className="opacity-70">{count(id)}</span></button>)}
            {stage !== 'done' && <Select value={cat} onChange={e => setCat(e.target.value)} className={sel} aria-label="Category"><option value="">Any category</option>{[...new Set(all.map(x => x.category.key))].map(k => <option key={k} value={k}>{k}</option>)}</Select>}
            <label className="relative ml-auto"><Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search" aria-label="Search" className="h-8 w-48 pl-8 pr-3 text-13 rounded-lg ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none" /></label>
          </div>
          <ErrorNote>{error}</ErrorNote>
          <div className="overflow-x-auto">
            {stage === 'done' ? (
              <DoneTable rows={done} site={siteName(b)} />
            ) : (
              <OppTable rows={shown} all={all} stage={stage} planMap={planMap} busy={busy} setStatus={setStatus} setOpen={setOpen} resetKey={`${stage}|${cat}|${dq}`} site={siteName(b)} />
            )}
          </div>
          <p className="px-5 py-3 border-t border-slate-100 text-11.5 text-slate-400">Listed because a competitor has a link there and you do not: a place to ask, not a promise. “Got the link” is confirmed automatically once the crawler finds your link on that site. The best ones also become tasks in your <Link to="/growth#issues" className="text-indigo-600 hover:underline">Growth Plan</Link>.</p>
        </Card>
      )}
      {d.state !== 'no_target' && <AiPlatforms b={b} onOpen={setOpen} onChanged={changed} />}
      {d.state !== 'no_target' && <FindSites b={b} onOpen={setOpen} onChanged={changed} />}
      {open && <AdviceModal b={b} item={open} onClose={() => setOpen(null)} onChanged={() => { changed(); setOpen(null); }} />}
    </>
  );
}

const SEV = { serious: ['Serious', 'red'], warning: ['Fix soon', 'amber'], info: ['Good to know', 'blue'] };
// GET /businesses/:id/backlink-intel/crawler/gap: our crawler's backlink gap between this business and one (or all) of its registered competitors.
const GapNote = ({ children }) => <p className="py-6 text-center text-13 text-slate-500">{children}</p>;

const gapOppValue = (o, k) => ({ site: o.referring_domain, targets: (o.competitor_targets || []).join(', '), page: o.source_pages?.[0] })[k];
function GapOppsTable({ rows, busy, addToPlan, resetKey, site }) {
  const [q, setQ] = useState('');
  const needle = norm(q.trim());
  const kept = useMemo(() => (needle ? rows.filter(o => norm(`${o.referring_domain} ${(o.competitor_targets || []).join(' ')} ${o.source_pages?.[0] || ''}`).includes(needle)) : rows), [rows, needle]);
  const { sorted, sort, onSort } = useSorted(kept, gapOppValue);
  const pg = usePager(sorted, { size: 25, resetKey: `${resetKey}|${needle}` });
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2"><ListSearch q={q} setQ={setQ} placeholder="Search these websites" />
        <span className="mb-3"><CsvButton name={`competitor-gap-sites-${site}`} head={['Website', 'Links to', 'Example page']} rows={() => sorted.map(o => [o.referring_domain, (o.competitor_targets || []).join(', '), o.source_pages?.[0] || ''])} tip={`Exports all ${sorted.length} websites (up to 500 are loaded)`} /></span></div>
      <div className="overflow-x-auto"><table className="w-full text-13">
                <thead className="text-12 text-slate-500 border-b border-slate-200"><tr><SortTh id="site" sort={sort} onSort={onSort} className={TC}>Website</SortTh><SortTh id="targets" sort={sort} onSort={onSort} className={TC}>Links to</SortTh><SortTh id="page" sort={sort} onSort={onSort} className={TC}>Example page</SortTh><th className={`${TH} text-right`}><Head right what="Open the site or its example page, or add the site to your link plan." why="The plan keeps the sites you will ask for a link, with their status." from="the Link Opportunities list.">Actions</Head></th></tr></thead>
                <tbody className="divide-y divide-slate-100">{pg.rows.map(o => (
                  <tr key={o.referring_domain}>
                    <td className="px-3 py-2 font-semibold text-slate-800">{o.referring_domain}</td>
                    <td className="px-3 py-2"><div className="flex flex-wrap gap-1">{o.competitor_targets.map(t => <Badge key={t} tone="blue">{t}</Badge>)}</div></td>
                    <td className="px-3 py-2 max-w-[360px]">{o.source_pages?.[0] ? <a className="block truncate text-indigo-600 hover:underline" href={o.source_pages[0]} target="_blank" rel="noreferrer noopener nofollow" title={o.source_pages[0]}>{o.source_pages[0].replace(/^https?:\/\//, '')}</a> : '—'}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap"><span className="inline-flex gap-1.5">
                      <OpenAct url={o.source_pages?.[0] || `https://${o.referring_domain}`} tip="Open the site: see the page that links to your competitor." />
                      <Act icon={Plus} tone="green" tip="Add to link plan: put this site in Link Opportunities as a place to ask for a link." busy={busy === `plan${o.referring_domain}`} onClick={() => addToPlan(o)} />
                    </span></td>
                  </tr>))}</tbody>
                    </table></div>
      {!pg.rows.length && <p className="py-4 text-center text-13 text-slate-500">No website matches the search.</p>}
      <div className="-mx-5 -mb-5"><Pager p={pg} label="websites" /></div>
    </>
  );
}

const gapPageValue = (p, k) => { const l = p.links?.[0] || {}; return ({ page: p.source_url, targets: (p.competitor_targets || []).join(', '), anchor: l.anchor_text, follow: l.nofollow ? 'Nofollow' : l.sponsored ? 'Sponsored' : 'Follow', seen: stamp(l.last_seen) })[k]; };
function GapPagesTable({ rows, resetKey, site }) {
  const [q, setQ] = useState('');
  const needle = norm(q.trim());
  const kept = useMemo(() => (needle ? rows.filter(p => norm(`${p.source_url} ${(p.competitor_targets || []).join(' ')} ${p.links?.[0]?.anchor_text || ''}`).includes(needle)) : rows), [rows, needle]);
  const { sorted, sort, onSort } = useSorted(kept, gapPageValue);
  const pg = usePager(sorted, { size: 25, resetKey: `${resetKey}|${needle}` });
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2"><ListSearch q={q} setQ={setQ} placeholder="Search these pages" />
        <span className="mb-3"><CsvButton name={`competitor-gap-pages-${site}`} head={['Linking page', 'Competitor', 'Anchor', 'Follow', 'Last seen']} rows={() => sorted.map(p => { const l = p.links?.[0] || {}; return [p.source_url, (p.competitor_targets || []).join(', '), l.anchor_text || '', l.nofollow ? 'Nofollow' : l.sponsored ? 'Sponsored' : 'Follow', l.last_seen || '']; })} tip={`Exports all ${sorted.length} pages (up to 500 are loaded)`} /></span></div>
      <div className="overflow-x-auto"><table className="w-full text-13">
                <thead className="text-12 text-slate-500 border-b border-slate-200"><tr><SortTh id="page" sort={sort} onSort={onSort} className={TC}>Linking page</SortTh><SortTh id="targets" sort={sort} onSort={onSort} className={TC}>Competitor</SortTh><SortTh id="anchor" sort={sort} onSort={onSort} className={TC}>Anchor</SortTh><SortTh id="follow" sort={sort} onSort={onSort} className={TC}>Follow</SortTh><SortTh id="seen" sort={sort} onSort={onSort} first="desc" className={TC}>Last seen</SortTh><th className={`${TH} text-right`}><Head right what="Open the page that links to your competitor." why="Contact its owner and ask for a link to you too.">Actions</Head></th></tr></thead>
                <tbody className="divide-y divide-slate-100">{pg.rows.map(p => { const l = p.links?.[0] || {}; return (
                  <tr key={p.source_url}>
                    <td className="px-3 py-2 max-w-[320px]"><a className="block truncate text-indigo-600 hover:underline" href={p.source_url} target="_blank" rel="noreferrer noopener nofollow" title={p.source_url}>{p.source_url.replace(/^https?:\/\//, '')}</a></td>
                    <td className="px-3 py-2"><div className="flex flex-wrap gap-1">{p.competitor_targets.map(t => <Badge key={t} tone="blue">{t}</Badge>)}</div></td>
                    <td className="px-3 py-2 max-w-[200px] truncate text-slate-700" title={l.anchor_text || ''}>{l.anchor_text || '—'}</td>
                    <td className="px-3 py-2"><Badge tone={l.nofollow ? 'gray' : 'green'}>{l.nofollow ? 'Nofollow' : l.sponsored ? 'Sponsored' : 'Follow'}</Badge></td>
                    <td className="px-3 py-2 text-12 text-slate-500">{l.last_seen ? fmtDateTime(l.last_seen) : '—'}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap"><OpenAct url={p.source_url} tip="Open the page: see the link to your competitor where it sits." /></td>
                  </tr>); })}</tbody>
                    </table></div>
      {!pg.rows.length && <p className="py-4 text-center text-13 text-slate-500">No page matches the search.</p>}
      <div className="-mx-5 -mb-5"><Pager p={pg} label="pages" /></div>
    </>
  );
}

function CompetitorGap({ b }) {
  const [params] = useSearchParams();
  const [comp, setComp] = useState(params.get('competitor') || ''); // opened from Competitor Watch: that competitor is already picked
  const [busy, , run] = useAction();
  const addToPlan = (o) => run(`plan${o.referring_domain}`, async () => { await api(`/businesses/${b.id}/backlink-hub/plan`, { method: 'POST', body: { domain: o.referring_domain, status: 'planned', source: 'competitor', name: o.referring_domain } }); });
  const r = useApi(`/businesses/${b.id}/backlink-intel/crawler/gap?${new URLSearchParams({ ...(comp ? { competitor: comp } : {}), limit: '500' })}`);
  const d = r.data;
  const g = d?.gap;
  const choices = d?.competitors_available || [];
  const warnings = g?.coverage?.warnings || [];
  const pages = g?.source_page_gap || [];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <Card title="Compare with a competitor" subtitle="Your site is fixed. Choose which competitor to compare it with, or compare with all of them."
        action={<Button icon={RefreshCw} busy={r.loading} onClick={() => r.reload(true)}>Refresh</Button>}>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Your website"><div className={`${inputCls} !w-64 bg-slate-50 text-slate-700 flex items-center`}>{d?.business_domain || b.website || '—'}</div></Field>
          <Field label="Competitor">
            <Select className={`${inputCls} !w-80`} value={comp} onChange={(e) => { setComp(e.target.value); }} searchPlaceholder="Search competitors…">
              <option value="">All competitors ({choices.length})</option>
              {choices.map(c => <option key={c.domain} value={c.domain}>{c.domain}</option>)}
            </Select>
          </Field>
        </div>
        <ErrorNote>{r.error && /not found/i.test(r.error.message) && comp ? `The backlink crawler has no data for ${comp} yet. A competitor is sent to it when it is chosen, and the crawler needs time to find its links. Try again later, or pick All competitors.` : r.error?.message}</ErrorNote>
      </Card>

      {r.loading ? <SkList rows={4} /> : d && !choices.length ? (
        <Card><GapNote>The crawler has no competitors for {d.business_domain} yet. Find them under SEO → Competitors: they are sent to the crawler when saved.</GapNote></Card>
      ) : g && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Sites linking them, not you" value={g.summary.gap_domains} hint="Your link opportunities" />
            <Stat label="Pages linking them, not you" value={g.summary.gap_pages} />
            <Stat label="Sites linking both" value={g.summary.shared_domains} />
            <Stat label="Sites linking only you" value={g.summary.own_only_domains} />
          </div>
          {warnings.length > 0 && (
            <Card><div className="flex gap-2 text-12.5 text-amber-700"><Info size={15} className="shrink-0 mt-0.5" />
              <div>The crawler is still exploring some of these sites, so the gap may be incomplete. {g.coverage?.basis}.
                <ul className="mt-1 text-slate-500 list-disc pl-4">{warnings.slice(0, 6).map(w => <li key={w}>{w}</li>)}</ul></div></div></Card>
          )}
          <Card title="Websites to get links from" subtitle={comp ? `Sites that link ${comp} but not you.` : 'Sites that link your competitors but not you.'}>
            {!g.opportunities.length ? <GapNote>No gap found yet. As the crawler finds more links to your competitors, sites appear here.</GapNote> : (
              <GapOppsTable rows={g.opportunities} busy={busy} addToPlan={addToPlan} resetKey={comp} site={siteName(b)} />
            )}
          </Card>
          <Card title="Pages that link them" subtitle="The exact pages, which competitor page they link to and the words used. Ask these sites to link you too.">
            {!pages.length ? <GapNote>None yet.</GapNote> : (
              <GapPagesTable rows={pages} resetKey={comp} site={siteName(b)} />
            )}
          </Card>
        </>
      )}
    </div>
  );
}

const AUDIT_VIEW = {
  risky: '/backlinks/links?useful=risky', lost: '/backlinks/links?status=lost', nofollow: '/backlinks/links?follow=nofollow', anchors: '/backlinks/links',
  unscored: '/backlinks/domains', sitewide: '/backlinks/domains',
};
function Audit({ b }) {
  const r = useApi(`/businesses/${b.id}/backlink-hub/audit`);
  const sm = useApi(`/businesses/${b.id}/backlink-hub/summary`);
  const [showPassed, setShowPassed] = useState(false);
  const d = r.data;
  if (r.error) return <Card><ErrorNote>{r.error.message}</ErrorNote></Card>;
  if (!d) return <SkList rows={4} />;
  if (d.state !== 'ok') return <Card><p className="text-13 text-slate-500">Add the project's website first.</p></Card>;
  const empty = !d.live && !d.lost;
  const tone = d.score == null ? 'text-slate-400' : d.score >= 80 ? 'text-emerald-600' : d.score >= 55 ? 'text-amber-600' : 'text-red-600';
  const order = { serious: 0, warning: 1, info: 2 };
  const items = [...d.items].sort((x, y) => order[x.severity] - order[y.severity]);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <AuditReport d={d} b={b} syncedAt={sm.data?.crawler?.last_sync_at} onChanged={() => { r.reload(true); sm.reload(true); }} />
      <Card title={`Problems in detail (${items.length})`} pad={false} action={items.length > 0 && <CsvButton name={`backlink-audit-${siteName(b)}`} head={['Priority', 'Problem', 'Why it matters', 'Affects', 'What to do', 'Examples']} rows={() => items.map(i => [SEV[i.severity][0], i.title, i.why || '', num(i.count), i.fix || '', (i.examples || []).map(e => `${e.url} (${e.note})`).join('; ')])} tip="Exports every problem found, with what to do about it" />}>
        {items.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-13">
              <thead className="bg-slate-50 text-12 uppercase tracking-wide text-slate-500"><tr>
                <th className={TH}><Head what="How much it matters: Serious first, then Fix soon, then Good to know." why="Work from the top.">Priority</Head></th>
                <th className={TH}><Head what="The problem we found in your links, and why it matters." from="our crawler's links and our own judgement of each linking site.">Problem</Head></th>
                <th className={`${TH} text-right`}><Head right what="How many links or sites it affects." from="the links we found.">Affects</Head></th>
                <th className={TH}><Head what="The step that fixes it.">What to do</Head></th>
                <th className={TH}><Head what="A few of the links behind it, with the reason.">Examples</Head></th>
                <th className={`${TH} text-right`}><Head right what="Open the affected links, or download the disavow file." why="See exactly which links to act on.">Actions</Head></th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {items.map(i => { const [l, t] = SEV[i.severity]; return (
                  <tr key={i.key} className="align-top hover:bg-slate-50">
                    <td className="px-3 py-3 whitespace-nowrap"><Badge tone={t}>{l}</Badge></td>
                    <td className="px-3 py-3 max-w-[320px]"><div className="font-semibold text-slate-900">{i.title}</div><div className="text-12.5 text-slate-500 mt-0.5">{i.why}</div></td>
                    <td className="px-3 py-3 text-right tabular-nums font-semibold">{i.count ?? '—'}</td>
                    <td className="px-3 py-3 max-w-[260px] text-slate-700">{i.fix}</td>
                    <td className="px-3 py-3 max-w-[280px]">{i.examples?.length ? <ul className="grid gap-1">{i.examples.slice(0, 3).map((e, k) => <li key={k} className="text-12 text-slate-500 truncate" title={`${e.url} · ${e.note}`}><span className="text-slate-700">{e.url.replace(/^https?:\/\//, '')}</span> · {e.note}</li>)}</ul> : <span className="text-slate-300">—</span>}</td>
                    <td className="px-3 py-3 text-right whitespace-nowrap"><span className="inline-flex gap-1.5">
                      {AUDIT_VIEW[i.key] && <Link to={AUDIT_VIEW[i.key]}><Act icon={Link2} tone="sky" tip="View: open the links or sites behind this problem." /></Link>}
                      {i.action && <a href={i.action.href}><Act icon={Download} tone="rose" tip="Disavow: download the file that tells Google to ignore these links." /></a>}
                    </span></td>
                  </tr>); })}
              </tbody>
            </table>
          </div>
        ) : <p className="px-5 py-8 text-center text-13 text-slate-500">{empty ? 'Nothing to check until the crawler has found links to your site.' : 'No problems found.'}</p>}
      </Card>
      {d.passed?.length > 0 && (
        <Card title={`Checks passed (${d.passed.length})`} pad={false} action={<Button size="sm" onClick={() => setShowPassed(v => !v)}>{showPassed ? 'Hide' : 'Show'}</Button>}>
          {showPassed && <ul className="divide-y divide-slate-100">{d.passed.map(p => <li key={p.key} className="px-5 py-2.5 text-13 flex gap-3 items-center"><CheckCircle2 size={15} className="text-emerald-600 shrink-0" /><span className="font-semibold text-slate-800">{p.title}</span><span className="text-slate-500">{p.detail}</span></li>)}</ul>}
        </Card>
      )}
    </div>
  );
}

function Sites({ b }) {
  const base = `/businesses/${b.id}/backlink-intel`;
  const targets = useApi(`${base}/targets`);
  const bot = useApi(`${base}/bot`);
  const [domain, setDomain] = useState('');
  const [comp, setComp] = useState(false);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const [ask, confirmNode] = useDoubleConfirm();
  const st = bot.data;
  const running = Boolean(st?.running);
  usePoll(() => bot.reload(true), running, 2500);
  const list = targets.data || [];
  const add = () => run('add', async () => { await api(`${base}/targets`, { method: 'POST', body: { domain, is_competitor: comp } }); setDomain(''); targets.reload(true); toast('Domain added'); });
  const remove = (t) => ask({ what: `the tracked domain ${t.domain}`, effect: 'It stops being monitored. Backlinks already found for it stay in your records.', onConfirm: () => run('rm', async () => { await api(`${base}/targets/${t.id}`, { method: 'DELETE' }); targets.reload(true); }) });
  const save = (patch) => run('save', async () => { await api(`${base}/bot`, { method: 'PUT', body: patch }); bot.reload(true); });
  const sync = () => run('sync', async () => { await api(`${base}/bot/run`, { method: 'POST' }); toast('Syncing from the crawler'); setTimeout(() => bot.reload(true), 800); });
  const addMine = () => run('mine', async () => { const r = await api(`${base}/targets/sync`, { method: 'POST' }); targets.reload(true); toast(r.added.length ? `Added ${r.added.length}: ${r.added.map(a => a.domain).join(', ')}` : 'Already up to date'); });
  const l = st?.last_stats && !st.last_stats.skipped ? st.last_stats : null;
  return (
    <>
      <Card title="Crawler sync" subtitle="Links are found by our own backlink crawler server. This copies what it found for your tracked sites into the project."
        action={st && <Badge tone={running ? 'blue' : st.source !== 'crawler' ? 'red' : st.config.enabled ? 'green' : 'gray'}>{running ? 'Syncing' : st.source !== 'crawler' ? 'Not connected' : st.config.enabled ? 'Scheduled' : 'Off'}</Badge>}>
        {st && st.source !== 'crawler' && <p className="text-13 text-amber-800">Our backlink crawler is not connected. Set CRAWLER_URL and CRAWLER_API_KEY in the backend settings and restart the backend.</p>}
        {st && st.source === 'crawler' && (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex items-center gap-2 text-13 pb-2"><input type="checkbox" checked={st.config.enabled} onChange={(e) => save({ enabled: e.target.checked })} /> Sync automatically</label>
              <Field label="Every"><Select className={`${inputCls} !w-auto`} value={st.config.interval_minutes} onChange={(e) => save({ interval_minutes: Number(e.target.value) })}>{[15, 30, 60, 180, 360, 1440].map(n => <option key={n} value={n}>{n < 60 ? `${n} min` : `${n / 60} h`}</option>)}</Select></Field>
              <Button variant="primary" icon={running ? Loader2 : RefreshCw} busy={busy === 'sync' || running} disabled={running || !list.length} onClick={sync}>{running ? 'Syncing…' : 'Sync now'}</Button>
            </div>
            {l?.error && <p className="text-12.5 text-amber-700">The last sync stopped: {l.error}</p>}
            <p className="text-12 text-gray-500">{st.last_run_at ? <>Last sync {fmtDateTime(st.last_run_at)}{l ? `: ${l.links_read} links read for ${l.domains} domain(s), ${l.new_backlinks} new${l.seeded ? `, ${l.seeded} site(s) handed to the crawler to start looking` : ''}.` : '.'}</> : 'It has not synced yet.'}</p>
            <CrawlerStatusLine />
          </div>
        )}
        <ErrorNote>{error}</ErrorNote>
      </Card>
      <Card title="Tracked domains" subtitle="Your site and your competitors. Backlinks are collected for these.">
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <Field label="Domain"><input className={`${inputCls} !w-64`} placeholder="example.com" value={domain} onChange={(e) => setDomain(e.target.value)} /></Field>
          <label className="flex items-center gap-1.5 text-13 pb-2"><input type="checkbox" checked={comp} onChange={(e) => setComp(e.target.checked)} /> Competitor</label>
          <Button variant="primary" icon={Plus} busy={busy === 'add'} disabled={domain.trim().length < 3} onClick={add}>Add</Button>
          <Button icon={RefreshCw} busy={busy === 'mine'} onClick={addMine}>Add my website and saved competitors</Button>
        </div>
        {confirmNode}
        {list.length === 0 ? <p className="py-6 text-center text-13 text-slate-500">Nothing tracked yet.</p> : list.map(t => (
          <div key={t.id} className="flex items-center gap-3 py-2 border-b border-slate-100 text-13">
            <span className="flex-1 text-slate-900">{t.domain}</span>
            <Badge tone={t.is_competitor ? 'amber' : 'green'}>{t.is_competitor ? 'Competitor' : 'Your site'}</Badge>
            <button type="button" className="text-slate-400 hover:text-red-500 cursor-pointer" aria-label={`Remove ${t.domain}`} onClick={() => remove(t)}><Trash2 size={14} /></button>
          </div>
        ))}
      </Card>
      {toastNode}
    </>
  );
}

function CrawlerStatusLine() {
  const st = useApi('/backlink-intel/crawler/status');
  const d = st.data;
  if (st.error) return <div className="text-12.5 text-amber-700">{st.error.message}</div>;
  if (!d) return null;
  const ok = d.workers.length > 0 && d.workers.every(w => w.healthy);
  return (
    <div className="text-12.5 text-gray-600 flex flex-wrap items-center gap-x-3 gap-y-1">
      <Badge tone={d.paused ? 'amber' : ok ? 'green' : 'amber'}>{d.paused ? 'Crawler paused' : ok ? 'Crawler running' : 'Crawler needs attention'}</Badge>
      <span>{Number(d.discovered_domains).toLocaleString()} websites known · {Number(d.discovered_urls).toLocaleString()} pages found · {Number(d.outgoing_links).toLocaleString()} links recorded</span>
    </div>
  );
}

export default function BacklinkHubPage() {
  const { view } = useParams();
  if (!VIEWS[view]) return <Navigate to="/backlinks/links" replace />;
  const [title, subtitle] = VIEWS[view];
  return (
    <SeoShell step="links" title={title} subtitle={subtitle}>
      {(b) => <Body b={b} view={view} />}
    </SeoShell>
  );
}

const OWN_DATA = ['overview', 'graph', 'anchors', 'pages', 'outbound']; // the tabs that read their own data, not the summary of the links list
const TABS = [['overview', 'Overview'], ['links', 'Backlinks'], ['domains', 'Referring domains'], ['graph', 'Network graph'], ['anchors', 'Anchors'], ['pages', 'Indexed pages'], ['outbound', 'Outbound domains']];
const MORE = [['audit', 'Backlink audit'], ['opportunities', 'Link opportunities'], ['gap', 'Competitor gap'], ['sites', 'Tracked sites and sync']];

/** The tabs of the one Backlinks page: the overview, the links, the sites, the graph, the anchors, the pages, what you link to, a bulk check, and the rest under More. */
function BacklinkTabs({ view }) {
  const inMore = MORE.some(([k]) => k === view);
  const cls = (on) => `px-3 py-2.5 text-13.5 font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${on ? 'border-indigo-500 text-slate-900 font-semibold' : 'border-transparent text-slate-600 hover:text-slate-900'}`;
  return (
    <nav aria-label="Backlinks" className="flex flex-wrap items-center gap-x-1 border-b border-slate-200 bg-white rounded-t-xl px-2">
      {TABS.map(([k, l]) => <Link key={k} to={`/backlinks/${k}`} aria-current={view === k ? 'page' : undefined} className={cls(view === k)}>{l}</Link>)}
      <Link to="/backlink-checker" className={cls(false)} title="Check any list of links at once">Bulk analysis</Link>
      <details className="relative">
        <summary className={`${cls(inMore)} list-none cursor-pointer select-none`}>{inMore ? MORE.find(([k]) => k === view)[1] : 'More'} ▾</summary>
        <div className="absolute z-20 mt-1 w-56 rounded-lg bg-white shadow-lg ring-1 ring-slate-200 py-1">{MORE.map(([k, l]) => <Link key={k} to={`/backlinks/${k}`} className={`block px-3 py-2 text-13 hover:bg-slate-50 ${view === k ? 'font-semibold text-indigo-700' : 'text-slate-700'}`}>{l}</Link>)}</div>
      </details>
    </nav>
  );
}

function Body({ b, view }) {
  const s = useApi(`/businesses/${b.id}/backlink-hub/summary`);
  const key = `${b.id}-${s.data?.totals?.live ?? 'x'}-${s.data?.useful?.useful ?? 'x'}-${s.data?.moz?.configured}-${s.data?.totals?.avg_da ?? 'x'}`;
  const V = { overview: BacklinkOverview, graph: GraphTab, anchors: AnchorsTab, pages: PagesTab, outbound: OutboundTab, links: Links, domains: Domains, opportunities: Opportunities, gap: CompetitorGap, audit: Audit, sites: Sites }[view];
  const main = view === 'links';
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <BacklinkTabs view={view} />
      {view !== 'sites' && !OWN_DATA.includes(view) && (s.data ? <><Summary s={s.data} b={b} reload={s.reload} compact main={main} />{main && <Setup s={s.data} />}</> : s.error ? <Card><ErrorNote>{s.error.message}</ErrorNote></Card> : <SkList rows={3} />)}
      {(view === 'sites' || OWN_DATA.includes(view) || !s.data || s.data.state === 'ok') && <V key={key} b={b} />}
      {main && s.data && <Used s={s.data} />}
    </div>
  );
}
