import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, XCircle, MinusCircle, Download, Printer, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, Badge, Tabs, ErrorNote, Button, useAction } from './SeoUi';
import { api } from './seoApi';
import { usePager, Pager, useSorted, SortTh } from './DataTable';

/**
 * The side-by-side result of comparing a competitor's site audit with the business's own (PageSpeed scores,
 * Core Web Vitals, Lighthouse SEO checks, matched pages, keyword and content gaps). Opened from Competitor
 * Research (POST /audit/competitors/compare); the page there runs the audits.
 */

const Chips = ({ items, empty, tone = 'slate' }) => (
  items && items.length ? (
    <div className="flex flex-wrap gap-1.5">
      {items.map(k => <span key={k} className={`px-2.5 py-1 rounded-full text-12.5 border ${tone === 'rose' ? 'bg-rose-50 text-rose-800 border-rose-200' : tone === 'green' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>{k}</span>)}
    </div>
  ) : <p className="text-13 text-slate-500">{empty}</p>
);
const SIDE = { both: ['Both sites', 'green'], competitor: ['Competitor', 'rose'], client: ['Your site', 'blue'] };

const KW_VAL = (i, k) => (k === 'keyword' ? i.keyword : k === 'volume' ? i.volume : k === 'side' ? SIDE[i.side]?.[0] : k === 'pages' ? i.pages : undefined);

/** The researched keywords as a table: search, sortable headings and pages. */
function KeywordTable({ items, added, pick, setPick, open, setOpen, save }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const kept = useMemo(() => (needle ? items.filter(i => i.keyword.toLowerCase().includes(needle)) : items), [items, needle]);
  const { sorted, sort, onSort } = useSorted(kept, KW_VAL);
  const pager = usePager(sorted, { size: 25, resetKey: `${needle}|${sort?.key}|${sort?.dir}` });
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      {items.length > 10 && <div className="px-3 py-2 border-b border-slate-100"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search these keywords" aria-label="Search these keywords" className="h-8 w-56 px-2 text-13 rounded-md border border-slate-200 bg-white focus:border-indigo-400 outline-none" /></div>}
      <div className="overflow-x-auto">
        <table className="w-full text-13 min-w-[720px]">
          <thead className="bg-slate-50 text-left text-11 uppercase tracking-wide text-slate-500"><tr>
            <th className="px-3 py-2 w-8" />
            <SortTh id="keyword" sort={sort} onSort={onSort} className="px-3 py-2">Keyword</SortTh>
            <SortTh id="volume" sort={sort} onSort={onSort} right first="desc" className="px-3 py-2">Searches/mo</SortTh>
            <SortTh id="side" sort={sort} onSort={onSort} className="px-3 py-2">Taken from</SortTh>
            <SortTh id="pages" sort={sort} onSort={onSort} right first="desc" className="px-3 py-2">Pages</SortTh>
            <th className="px-3 py-2" /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {pager.rows.map(i => { const done = i.tracked || added[i.keyword]; const [sl, st] = SIDE[i.side]; return (
              <React.Fragment key={i.keyword}>
                <tr className="align-middle">
                  <td className="px-3 py-2"><input type="checkbox" disabled={done} checked={pick.includes(i.keyword)} onChange={() => setPick(p => (p.includes(i.keyword) ? p.filter(x => x !== i.keyword) : [...p, i.keyword]))} aria-label={`Select ${i.keyword}`} /></td>
                  <td className="px-3 py-2 font-semibold text-slate-900">{i.keyword}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{i.volume != null ? i.volume.toLocaleString('en-IN') : <span className="text-slate-300" title="Not verified">—</span>}</td>
                  <td className="px-3 py-2"><Badge tone={st}>{sl}</Badge> <button type="button" onClick={() => setOpen(open === i.keyword ? null : i.keyword)} className="ml-1 text-12 text-indigo-600 hover:underline cursor-pointer">{open === i.keyword ? 'hide pages' : 'see pages'}</button></td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{i.pages}</td>
                  <td className="px-3 py-2 text-right">{done ? <span className="text-12 text-emerald-700 font-semibold">In My Keywords</span> : <Button size="sm" onClick={() => save([i])}>Add</Button>}</td>
                </tr>
                {open === i.keyword && <tr><td /><td colSpan={5} className="px-3 pb-3"><ul className="grid gap-1 text-12.5 text-slate-600">{i.sources.map((x, n) => <li key={n}><b>{x.name}</b>: <a href={x.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">{x.path}</a> · in the {x.in.join(', ')}</li>)}</ul></td></tr>}
              </React.Fragment>); })}
            {!pager.rows.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">No keyword matches.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager p={pager} label="keywords" />
    </div>
  );
}

/** The keywords worth targeting: real searched phrases from both sites' titles, headings and descriptions, each with where it was taken from. */
function ResearchedKeywords({ r, bid, competitor }) {
  const [added, setAdded] = useState({});
  const [pick, setPick] = useState([]);
  const [open, setOpen] = useState(null);
  const [busy, error, run] = useAction();
  if (!r) return null;
  if (!r.available) return <p className="text-13 text-slate-500">No usable phrases were found in the crawled titles, headings and descriptions.</p>;
  const items = r.items;
  const todo = items.filter(i => !i.tracked && !added[i.keyword]);
  const save = (list) => run('add', async () => {
    await api(`/businesses/${bid}/keywords`, { method: 'POST', body: list.map(i => ({ keyword: i.keyword, volume: i.volume || undefined, source: {
      kind: 'competitor_compare', label: i.side === 'client' ? 'Your own site' : `${competitor || 'Competitor'} website`, side: i.side, from: competitor || null,
      pages: i.sources.slice(0, 4).map(x => ({ url: x.url, in: x.in })), searches: i.volume ?? null, at: new Date().toISOString().slice(0, 10) } })) });
    setAdded(a => ({ ...a, ...Object.fromEntries(list.map(i => [i.keyword, true])) })); setPick([]);
  });
  return (
    <div className="space-y-3">
      <p className="text-12.5 text-slate-600">Phrases taken from the {r.source}. {r.verified ? 'Only phrases people really search for are kept, with their monthly searches from Google Keyword Planner.' : <b className="text-amber-800">Searches not verified: {r.volume_note}</b>}</p>
      <div className="flex flex-wrap items-center gap-2 text-12">
        {Object.entries(SIDE).map(([k, [l, t]]) => <Badge key={k} tone={t}>{l} {r.counts[k] || 0}</Badge>)}
        <span className="ml-auto flex gap-2">
          {pick.length > 0 && <Button size="sm" variant="primary" busy={busy === 'add'} onClick={() => save(items.filter(i => pick.includes(i.keyword)))}>Add {pick.length} to My Keywords</Button>}
          {!pick.length && todo.length > 0 && <Button size="sm" onClick={() => setPick(todo.slice(0, 20).map(i => i.keyword))}>Select the top {Math.min(20, todo.length)}</Button>}
        </span>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <KeywordTable items={items} added={added} pick={pick} setPick={setPick} open={open} setOpen={setOpen} save={save} />
    </div>
  );
}

const PRI = { high: ['Do first', 'red'], medium: ['Next', 'amber'], low: ['Later', 'gray'] };
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/** The upgrade report as one standalone page the user can keep, send or print. */
function reportHtml(c) {
  const u = c.upgrade; const them = c.competitor?.name || c.competitor?.target || 'Competitor';
  const rows = u.items.map(i => `<tr><td><b class="${i.priority}">${PRI[i.priority][0]}</b></td><td>${esc(i.area)}</td><td><b>${esc(i.title)}</b><br><span>${esc(i.why)}</span></td><td>${esc(i.you)}</td><td>${esc(i.them)}</td><td>${esc(i.fix)}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Upgrade report: ${esc(c.ours?.target)} vs ${esc(them)}</title><style>body{font:14px/1.5 system-ui,sans-serif;margin:32px;color:#1e293b}h1{font-size:22px;margin:0 0 4px}table{border-collapse:collapse;width:100%;margin:16px 0}td,th{border-bottom:1px solid #e2e8f0;padding:8px 10px;text-align:left;vertical-align:top}th{font-size:12px;text-transform:uppercase;color:#64748b}span{color:#64748b;font-size:12.5px}.high{color:#b91c1c}.medium{color:#b45309}.low{color:#64748b}li{margin:4px 0}</style></head><body><h1>Where to upgrade: ${esc(c.ours?.target)} vs ${esc(them)}</h1><p>${esc(u.headline)}</p><p><span>Made ${new Date().toLocaleDateString('en-GB')}. ${esc(u.note)}</span></p><table><thead><tr><th>Priority</th><th>Area</th><th>What to improve</th><th>You</th><th>Them</th><th>How to fix</th></tr></thead><tbody>${rows}</tbody></table>${u.strengths.length ? `<h2>Where you already lead</h2><ul>${u.strengths.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</body></html>`;
}

const UP_VAL = (i, k) => (k === 'priority' ? ({ high: 0, medium: 1, low: 2 })[i.priority] : k === 'title' ? i.title : k === 'you' ? i.you : k === 'them' ? i.them : k === 'fix' ? i.fix : undefined);

function UpgradeTable({ items, onGo }) {
  const { sorted, sort, onSort } = useSorted(items, UP_VAL);
  const pager = usePager(sorted, { size: 25, resetKey: `${items.length}|${sort?.key}|${sort?.dir}` });
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-13 min-w-[860px]">
          <thead className="bg-slate-50 text-left text-11 uppercase tracking-wide text-slate-500"><tr>
            <SortTh id="priority" sort={sort} onSort={onSort} className="px-3 py-2">Priority</SortTh>
            <SortTh id="title" sort={sort} onSort={onSort} className="px-3 py-2">What to improve</SortTh>
            <SortTh id="you" sort={sort} onSort={onSort} className="px-3 py-2">You</SortTh>
            <SortTh id="them" sort={sort} onSort={onSort} className="px-3 py-2">Them</SortTh>
            <SortTh id="fix" sort={sort} onSort={onSort} className="px-3 py-2">How to fix</SortTh>
            <th className="px-3 py-2" /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {pager.rows.map((i, n) => (
              <tr key={pager.from + n} className="align-top">
                <td className="px-3 py-3"><Badge tone={PRI[i.priority][1]}>{PRI[i.priority][0]}</Badge><div className="text-11.5 text-slate-400 mt-1">{i.area}</div></td>
                <td className="px-3 py-3 max-w-[260px]"><div className="font-semibold text-slate-900">{i.title}</div><div className="text-12 text-slate-500 mt-0.5">{i.why}</div></td>
                <td className="px-3 py-3 text-slate-700 whitespace-nowrap">{i.you}</td>
                <td className="px-3 py-3 text-slate-700 whitespace-nowrap">{i.them}</td>
                <td className="px-3 py-3 text-slate-700 max-w-[320px]">{i.fix}</td>
                <td className="px-3 py-3 text-right">{i.to && <Link to={i.to} onClick={onGo}><Button size="sm" icon={ArrowRight}>{i.to_label || 'Open'}</Button></Link>}</td>
              </tr>))}
          </tbody>
        </table>
      </div>
      <Pager p={pager} label="items" />
    </div>
  );
}

/** Where to upgrade, in order: every real difference found in this comparison, how to fix it and where to do it. */
function UpgradeReport({ c, onGo }) {
  const u = c.upgrade;
  const [pri, setPri] = useState('all');
  if (!u) return <p className="text-13 text-slate-500">This comparison has no report yet. Compare again.</p>;
  const items = u.items.filter(i => pri === 'all' || i.priority === pri);
  const download = () => {
    const url = URL.createObjectURL(new Blob([reportHtml(c)], { type: 'text/html' }));
    const a = document.createElement('a'); a.href = url; a.download = `upgrade-report-${(c.competitor?.name || 'competitor').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.html`; a.click(); URL.revokeObjectURL(url);
  };
  const print = () => { const w = window.open('', '_blank'); if (!w) return; w.document.write(reportHtml(c)); w.document.close(); w.focus(); w.print(); };
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-slate-50 ring-1 ring-inset ring-slate-200 p-4">
        <p className="text-14 font-semibold text-slate-900">{u.headline}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {Object.entries(PRI).map(([k, [l, t]]) => <button key={k} type="button" onClick={() => setPri(pri === k ? 'all' : k)} aria-pressed={pri === k} className={`cursor-pointer rounded-full ${pri === k ? 'ring-2 ring-indigo-400' : ''}`}><Badge tone={t}>{l} {u.counts[k]}</Badge></button>)}
          <span className="ml-auto flex gap-2"><Button size="sm" icon={Download} onClick={download}>Download report</Button><Button size="sm" icon={Printer} onClick={print}>Print</Button></span>
        </div>
      </div>
      {!items.length ? <p className="text-13 text-slate-500">Nothing to upgrade here.</p> : (
        <UpgradeTable items={items} onGo={onGo} />
      )}
      {u.strengths.length > 0 && (
        <div><div className="text-12 font-semibold uppercase tracking-wide text-emerald-700 mb-1.5">Where you already lead</div>
          <ul className="grid gap-1 text-13 text-slate-700">{u.strengths.map((x, n) => <li key={n} className="flex gap-2"><CheckCircle2 size={14} className="text-emerald-600 mt-0.5 shrink-0" />{x}</li>)}</ul></div>
      )}
      <p className="text-12 text-slate-500">{u.note}</p>
    </div>
  );
}

const STATUS_TONE = {
  both_pass: ['green', CheckCircle2, 'Both pass'],
  both_fail: ['red', XCircle, 'Both fail'],
  ours_fail_competitor_pass: ['red', AlertTriangle, 'Ground to make up'],
  ours_pass_competitor_fail: ['green', CheckCircle2, 'Our advantage'],
  both_unavailable: ['gray', MinusCircle, 'Not applicable'],
  incomparable: ['gray', MinusCircle, 'Not comparable']
};

function MetricRow({ m }) {
  const better = m.better === 'ours' ? 'text-emerald-700' : m.better === 'competitor' ? 'text-rose-700' : 'text-slate-500';
  return (
    <tr>
      <td className="px-4 py-2.5 text-13 font-medium text-slate-900">{m.label}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-13">{m.ours_display ?? m.ours ?? '—'}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-13">{m.competitor_display ?? m.competitor ?? '—'}</td>
      <td className={`px-3 py-2.5 text-right tabular-nums text-13 font-semibold ${better}`}>
        {m.available ? (m.better === 'tie' ? 'Tie' : m.better === 'ours' ? 'You lead' : 'They lead') : '—'}
      </td>
    </tr>
  );
}

/** The comparison without its own card: inside a modal the modal is the frame. */
const BareShell = ({ note, children }) => <div><p className="text-12.5 text-slate-500 mb-4">{note}</p>{children}</div>;

/** One measure, you against them: two bars, the better side in green, and who leads in words. */
function PairRow({ m }) {
  const a = Number(m.ours), b = Number(m.competitor);
  const max = Math.max(Number.isFinite(a) ? a : 0, Number.isFinite(b) ? b : 0, 1);
  const lead = m.better;
  const bar = (v, mine) => {
    const good = lead === (mine ? 'ours' : 'competitor');
    const bad = lead && lead !== 'tie' && !good;
    return <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full rounded-full ${good ? 'bg-emerald-500' : bad ? 'bg-rose-400' : 'bg-slate-400'}`} style={{ width: `${Number.isFinite(v) ? Math.max(3, (v / max) * 100) : 0}%` }} /></div>;
  };
  return (
    <div className="py-2.5">
      <div className="flex items-center justify-between gap-2 mb-1.5"><span className="text-13 font-medium text-slate-900">{m.label}</span>
        <span className={`text-11.5 font-semibold ${lead === 'ours' ? 'text-emerald-700' : lead === 'competitor' ? 'text-rose-700' : 'text-slate-400'}`}>{!m.available ? 'no data' : lead === 'tie' ? 'Tie' : lead === 'ours' ? 'You lead' : 'They lead'}</span></div>
      <div className="grid grid-cols-[44px_1fr_70px] items-center gap-x-2 gap-y-1 text-12">
        <span className="text-slate-500">You</span>{bar(a, true)}<span className="text-right tabular-nums text-slate-800">{m.ours_display ?? m.ours ?? '—'}</span>
        <span className="text-slate-500">Them</span>{bar(b, false)}<span className="text-right tabular-nums text-slate-800">{m.competitor_display ?? m.competitor ?? '—'}</span>
      </div>
    </div>
  );
}

/** The first thing to read: who is ahead, the few things to do first, and where you already lead. The rest is in the tabs. */
function CompareSummary({ c, setTab }) {
  const u = c.upgrade;
  const name = c.competitor?.name || c.competitor?.target || 'They';
  const first = (u?.items || []).filter(i => i.priority === 'high').slice(0, 3);
  const counts = Object.fromEntries(Object.keys(PRI).map(k => [k, (u?.items || []).filter(i => i.priority === k).length]));
  const scores = (c.overall?.scores || []).filter(m => m.available);
  const vitals = (c.overall?.core_web_vitals || []).filter(m => m.available).slice(0, 5);
  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-slate-50 ring-1 ring-inset ring-slate-200 p-4">
        <p className="text-15 font-semibold text-slate-900">{u?.headline || `${name} compared with your site.`}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {Object.entries(PRI).map(([k, [l, tone]]) => counts[k] > 0 && <button key={k} type="button" onClick={() => setTab('report')} className="cursor-pointer" title="See them in What to fix"><Badge tone={tone}>{l} {counts[k]}</Badge></button>)}
          {u && <button type="button" onClick={() => setTab('report')} className="ml-auto text-12.5 font-semibold text-indigo-700 hover:underline cursor-pointer">See the full list of {u.items.length} →</button>}
        </div>
      </div>
      {(scores.length > 0 || vitals.length > 0) ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
          <div><div className="text-12 font-semibold uppercase tracking-wide text-slate-500">Scores (0 to 100, higher is better)</div><div className="divide-y divide-slate-100">{scores.map(m => <PairRow key={m.key} m={m} />)}</div></div>
          <div><div className="text-12 font-semibold uppercase tracking-wide text-slate-500">What visitors feel (lower is better)</div><div className="divide-y divide-slate-100">{vitals.map(m => <PairRow key={m.key} m={m} />)}</div></div>
        </div>
      ) : <p className="text-13 text-slate-500">No speed data on one side yet: audit both sites to compare scores.</p>}
      {first.length > 0 && (
        <div>
          <div className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-2">Do these first</div>
          <ol className="space-y-2">{first.map((i, n) => (
            <li key={n} className="rounded-lg ring-1 ring-slate-200 px-4 py-2.5 flex gap-3">
              <span className="w-6 h-6 rounded-full bg-rose-100 text-rose-700 text-12 font-bold inline-flex items-center justify-center shrink-0">{n + 1}</span>
              <div className="min-w-0"><div className="text-13 font-semibold text-slate-900">{i.title}</div>
                <div className="text-12 text-slate-500">You <b className="text-slate-700">{i.you}</b> · Them <b className="text-slate-700">{i.them}</b></div>
                <div className="text-12.5 text-slate-600 mt-0.5">{i.fix}</div></div>
            </li>))}</ol>
        </div>)}
      {(u?.strengths || []).length > 0 && (
        <div><div className="text-12 font-semibold uppercase tracking-wide text-emerald-700 mb-1.5">Where you already lead</div>
          <ul className="grid gap-1 text-13 text-slate-700">{u.strengths.slice(0, 3).map((x, n) => <li key={n} className="flex gap-2"><CheckCircle2 size={14} className="text-emerald-600 mt-0.5 shrink-0" />{x}</li>)}</ul></div>)}
    </div>
  );
}

const CK_VAL = (ch, k) => (k === 'title' ? (ch.title || ch.id) : k === 'ours' ? ch.ours?.status : k === 'competitor' ? ch.competitor?.status : k === 'status' ? (STATUS_TONE[ch.status] || STATUS_TONE.incomparable)[2] : undefined);

function ChecksTable({ checks }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const kept = useMemo(() => (needle ? checks.filter(ch => String(ch.title || ch.id).toLowerCase().includes(needle)) : checks), [checks, needle]);
  const { sorted, sort, onSort } = useSorted(kept, CK_VAL);
  const pager = usePager(sorted, { size: 25, resetKey: `${needle}|${sort?.key}|${sort?.dir}` });
  return (
    <div>
      {checks.length > 10 && <div className="px-1 pb-2"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search the checks" aria-label="Search the checks" className="h-8 w-56 px-2 text-13 rounded-md border border-slate-200 bg-white focus:border-indigo-400 outline-none" /></div>}
      <div className="overflow-x-auto">
        <table className="w-full text-13">
          <thead className="bg-slate-50 text-left text-11  tracking-wide text-slate-500">
            <tr>
              <SortTh id="title" sort={sort} onSort={onSort} className="px-4 py-2.5">Check</SortTh>
              <SortTh id="ours" sort={sort} onSort={onSort} className="px-3 py-2.5 text-center">You</SortTh>
              <SortTh id="competitor" sort={sort} onSort={onSort} className="px-3 py-2.5 text-center">Competitor</SortTh>
              <SortTh id="status" sort={sort} onSort={onSort} className="px-3 py-2.5">Status</SortTh>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pager.rows.map(ch => {
              const [tone, Icon, label] = STATUS_TONE[ch.status] || STATUS_TONE.incomparable;
              return (
                <tr key={ch.id}>
                  <td className="px-4 py-2.5 font-medium text-slate-900" title={ch.description}>{ch.title || ch.id}</td>
                  <td className="px-3 py-2.5 text-center text-slate-600">{ch.ours?.status || '—'}</td>
                  <td className="px-3 py-2.5 text-center text-slate-600">{ch.competitor?.status || '—'}</td>
                  <td className="px-3 py-2.5"><Badge tone={tone}><Icon size={11} />{label}</Badge></td>
                </tr>
              );
            })}
            {!pager.rows.length && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-500">No check matches.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager p={pager} label="checks" />
    </div>
  );
}

const PG_VAL = (m, k) => (k === 'path' ? m.path : k === 'ours' ? m.ours?.title : k === 'competitor' ? m.competitor?.title : k === 'words' ? m.ours?.word_count : undefined);

function PagesTable({ matched }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const kept = useMemo(() => (needle ? matched.filter(m => `${m.path} ${m.ours?.title || ''} ${m.competitor?.title || ''}`.toLowerCase().includes(needle)) : matched), [matched, needle]);
  const { sorted, sort, onSort } = useSorted(kept, PG_VAL);
  const pager = usePager(sorted, { size: 25, resetKey: `${needle}|${sort?.key}|${sort?.dir}` });
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      {matched.length > 10 && <div className="px-3 py-2 border-b border-slate-100"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search the pages" aria-label="Search the pages" className="h-8 w-56 px-2 text-13 rounded-md border border-slate-200 bg-white focus:border-indigo-400 outline-none" /></div>}
      <div className="overflow-x-auto">
        <table className="w-full text-13">
          <thead className="bg-slate-50 text-left text-11  tracking-wide text-slate-500">
            <tr>
              <SortTh id="path" sort={sort} onSort={onSort} className="px-4 py-2.5">Page</SortTh>
              <SortTh id="ours" sort={sort} onSort={onSort} className="px-3 py-2.5">Your title</SortTh>
              <SortTh id="competitor" sort={sort} onSort={onSort} className="px-3 py-2.5">Their title</SortTh>
              <SortTh id="words" sort={sort} onSort={onSort} right first="desc" className="px-3 py-2.5">Words (you / them)</SortTh>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pager.rows.map(m => (
              <tr key={m.path}>
                <td className="px-4 py-2.5  text-12 text-slate-700">{m.path}</td>
                <td className="px-3 py-2.5 truncate max-w-[220px]" title={m.ours?.title}>{m.ours?.title || '(missing)'}</td>
                <td className="px-3 py-2.5 truncate max-w-[220px]" title={m.competitor?.title}>{m.competitor?.title || '(missing)'}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{m.ours?.word_count ?? '—'} / {m.competitor?.word_count ?? '—'}</td>
              </tr>
            ))}
            {!pager.rows.length && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-500">No page matches.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager p={pager} label="pages" />
    </div>
  );
}

export function ComparisonResult({ c, bare = false, onGo, extraTabs = [] }) {
  const [tab, setTab] = useState('summary');
  if (c.error) return <ErrorNote>{c.error}</ErrorNote>;
  const checks = c.technical_seo?.checks || [];
  const pages = c.pages || {};
  const gaps = c.keywords_and_content_gaps || {};
  const subtitle = `vs ${c.ours?.target || 'your site'} · ${c.ours?.strategy || '?'} audit`;
  const Shell = bare ? BareShell : Card;
  const shellProps = bare ? { note: `${c.competitor?.name || c.competitor?.target} ${subtitle}` } : { title: c.competitor?.name || c.competitor?.target, subtitle };
  return (
    <Shell {...shellProps}>
      {!c.compatibility?.compatible && (
        <div className="mb-4 text-12.5 text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center gap-2">
          <AlertTriangle size={14} className="shrink-0" /> {c.compatibility?.note || 'Strategies differ (mobile vs desktop); scores are not directly comparable.'}
        </div>
      )}
      {/* in the order you read them: the verdict, what to do, then the evidence, then the Google listing */}
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'summary', label: 'Summary' },
        { id: 'report', label: 'What to fix', count: c.upgrade?.total },
        { id: 'scores', label: 'Speed & scores' },
        { id: 'technical', label: 'Technical SEO', count: checks.length },
        { id: 'pages', label: 'Pages', count: pages.matched?.length || 0 },
        { id: 'keywords', label: 'Keywords & content' },
        ...extraTabs.map(({ id, label, count }) => ({ id, label, count }))
      ]} />

      {tab === 'summary' && <CompareSummary c={c} setTab={setTab} />}

      {tab === 'report' && <UpgradeReport c={c} onGo={onGo} />}

      {extraTabs.map(x => tab === x.id && <div key={x.id}>{x.node}</div>)}

      {tab === 'scores' && (
        <div className="space-y-5">
          {!c.overall?.available && <p className="text-13 text-slate-500">No PageSpeed data on one side yet.</p>}
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full">
              <thead className="bg-slate-50 text-left text-11  tracking-wide text-slate-500">
                <tr><th className="px-4 py-2 font-semibold">Metric</th><th className="px-3 py-2 font-semibold text-right">You</th><th className="px-3 py-2 font-semibold text-right">Competitor</th><th className="px-3 py-2 font-semibold text-right">Edge</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(c.overall?.scores || []).map(m => <MetricRow key={m.key} m={m} />)}
                {(c.overall?.core_web_vitals || []).map(m => <MetricRow key={m.key} m={m} />)}
              </tbody>
            </table>
          </div>
          {(c.overall?.field_data || []).some(f => f.available) && (
            <div>
              <div className="text-12 font-semibold  tracking-wide text-slate-500 mb-2">Real-user (CrUX field) data</div>
              <div className="flex flex-wrap gap-2">
                {(c.overall.field_data || []).filter(f => f.available).map(f => (
                  <span key={f.key} className="text-12 px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50">{f.label}: <b>{f.ours || '—'}</b> vs <b>{f.competitor || '—'}</b></span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'technical' && (
        <div>
          {!checks.length ? <p className="text-13 text-slate-500">No Lighthouse SEO checks on one side yet.</p> : (
            <ChecksTable checks={checks} />
          )}
        </div>
      )}

      {tab === 'pages' && (
        <div className="space-y-4">
          <p className="text-12 text-slate-500">{pages.note}</p>
          {!pages.matched?.length ? <p className="text-13 text-slate-500">No matching pages found between the two crawls.</p> : (
            <PagesTable matched={pages.matched} />
          )}
          <div className="grid grid-cols-2 gap-3 text-12 text-slate-500">
            <span>Pages only you crawled: {pages.unmatched_ours?.length || 0}</span>
            <span>Pages only they crawled: {pages.unmatched_competitor?.length || 0}</span>
          </div>
        </div>
      )}

      {tab === 'keywords' && (
        <div className="space-y-6">
          <div>
            <div className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-2">Best keywords to target</div>
            <ResearchedKeywords r={gaps.researched} bid={c.ours?.business_id} competitor={c.competitor?.name || c.competitor?.target} />
          </div>

          <details className="group">
            <summary className="text-12 font-semibold uppercase tracking-wide text-slate-500 cursor-pointer">All repeated words on the pages (raw, not checked for searches)</summary>
            <div className="mt-3">
            <div className="text-12 font-semibold  tracking-wide text-slate-500 mb-2">On-page keywords (from the crawled content, no external API)</div>
            {gaps.on_page?.available ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <div className="text-12 font-semibold text-emerald-700 mb-1.5">Shared ({gaps.on_page.shared_keywords.length})</div>
                  <Chips items={gaps.on_page.shared_keywords} empty="None in common." />
                </div>
                <div>
                  <div className="text-12 font-semibold text-indigo-700 mb-1.5">Only you emphasise ({gaps.on_page.ours_only_keywords.length})</div>
                  <Chips items={gaps.on_page.ours_only_keywords} empty="Nothing unique to your content." />
                </div>
                <div>
                  <div className="text-12 font-semibold text-rose-700 mb-1.5">Only they emphasise ({gaps.on_page.competitor_only_keywords.length}) — the gap</div>
                  <Chips items={gaps.on_page.competitor_only_keywords} empty="They cover nothing you don't." tone="rose" />
                </div>
              </div>
            ) : (
              <div className="text-13 text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">{gaps.on_page?.reason}</div>
            )}
            </div>
          </details>

          <div>
            <div className="text-12 font-semibold  tracking-wide text-slate-500 mb-2">Google-search keyword gaps (from Competitor Research)</div>
            {gaps.search?.available ? (
              <div className="space-y-3">
                {gaps.search.note && <p className="text-12 text-slate-500">{gaps.search.note}</p>}
                {!gaps.search.keyword_gaps?.length ? <p className="text-13 text-slate-500">No search keyword gaps found against this competitor.</p> : (
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {gaps.search.keyword_gaps.map(g => (
                      <li key={g.keyword} className="px-4 py-2.5 text-13 flex flex-wrap items-center gap-2">
                        <b className="text-slate-900">{g.keyword}</b>
                        <span className="text-slate-500">· outranked by {g.competitors?.map(x => x.domain).join(', ')}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div className="text-13 text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">{gaps.search?.reason} {gaps.search?.required_source}</div>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}
