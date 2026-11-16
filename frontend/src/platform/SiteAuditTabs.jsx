import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { ChevronRight, ExternalLink, Download, Check, LayoutGrid, BarChart3, Folder, FileText, Search } from 'lucide-react';
import { Card, Badge, Button } from './SeoUi';
import { AXIS, PALETTE, Th, Empty, Segmented, usePager } from './PositionUi';
import Select from '../components/Select';

const SEV = { error: ['Errors', '#ef4444'], warning: ['Warnings', '#f59e0b'], notice: ['Notices', '#818cf8'] };
const SEV_ORDER = ['error', 'warning', 'notice'];
const dash = <span className="text-slate-300">—</span>;
const short = (u) => { try { const x = new URL(u); return x.hostname.replace(/^www\./, '') + (x.pathname === '/' ? '/' : x.pathname) + x.search; } catch (e) { return u; } };
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const sel = 'h-9 px-2.5 text-13 rounded border border-slate-200 bg-white text-slate-700 cursor-pointer';
const Url = ({ u }) => <a href={u} target="_blank" rel="noreferrer" title={u} className="text-indigo-700 hover:underline inline-flex items-center gap-1 break-all">{short(u)}<ExternalLink size={10} className="shrink-0" /></a>;

function csv(name, head, rows) {
  const text = [head, ...rows].map(l => l.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name;
  a.click();
}

const Chip = ({ on, onClick, children, n }) => (
  <button type="button" onClick={onClick} className={`h-9 px-3 text-13 border-r last:border-r-0 border-slate-200 cursor-pointer ${on ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>{children}{n != null && <span className="ml-1.5 text-slate-400 font-normal">{n}</span>}</button>
);

/** Issues: what the audit found, by severity, with the pages affected and how to fix each. */
export function IssuesTab({ r, initial }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState(initial?.category || '');
  const [sev, setSev] = useState(initial?.severity || '');
  const [only, setOnly] = useState(!initial?.category && !initial?.severity); // opened from a table figure: show every check of that kind, clean ones too
  const [open, setOpen] = useState(() => new Set());
  const prev = r.history[1]?.counts;
  const rows = r.checks.map(c => ({ ...c, ...r.results[c.code], before: prev ? prev[c.code] : null }));
  const visible = (x) => (!only || x.count > 0) && (!q || x.label.toLowerCase().includes(q.toLowerCase())) && (!cat || x.category === cat) && (!sev || x.severity === sev);
  const cats = [...new Set(r.checks.map(c => c.category))];
  const types = (f) => rows.filter(x => x.count > 0 && f(x)).length;
  const toggle = (k) => setOpen(o => { const n = new Set(o); n.has(k) ? n.delete(k) : n.add(k); return n; });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative"><Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search" aria-label="Search issues" className="h-9 pl-8 pr-3 w-44 text-13 rounded border border-slate-200 bg-white" /></label>
        <div className="flex rounded border border-slate-200 overflow-hidden"><Chip on={!cat} onClick={() => setCat('')} n={types(() => true)}>All</Chip>{cats.map(c => <Chip key={c} on={cat === c} onClick={() => setCat(c)} n={types(x => x.category === c)}>{c}</Chip>)}</div>
        <div className="flex rounded border border-slate-200 overflow-hidden"><Chip on={!sev} onClick={() => setSev('')} n={types(() => true)}>All</Chip>{SEV_ORDER.map(s => <Chip key={s} on={sev === s} onClick={() => setSev(s)} n={types(x => x.severity === s)}>{SEV[s][0]}</Chip>)}</div>
        <label className={`h-9 px-3 inline-flex items-center gap-2 rounded border text-13 cursor-pointer ${only ? 'border-indigo-300 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200 bg-white text-slate-700'}`}><input type="checkbox" checked={only} onChange={e => setOnly(e.target.checked)} />With issues</label>
        <Button size="sm" icon={Download} className="ml-auto" onClick={() => csv(`${r.project}-issues.csv`, ['Severity', 'Issue', 'Count', 'Affected pages', 'How to fix'], rows.filter(x => x.count).map(x => [x.severity, x.label, x.count, x.urls.join(' '), x.fix]))}>Export</Button>
      </div>
      {SEV_ORDER.map(s => {
        const list = rows.filter(x => x.severity === s && visible(x));
        if (!list.length && (sev || only)) return null;
        const total = rows.filter(x => x.severity === s).reduce((a, x) => a + x.count, 0);
        return (
          <Card key={s} pad={false}>
            <div className="px-6 pt-4 pb-3 text-18 font-bold text-slate-900">{SEV[s][0]} <span className="text-slate-500 font-normal">({total})</span></div>
            <div className="h-[3px]" style={{ background: SEV[s][1] }} />
            {list.length ? <ul className="divide-y divide-slate-100">{list.map(x => (
              <li key={x.code}>
                <div className="px-6 py-3.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-14">
                  <button type="button" onClick={() => toggle(x.code)} aria-label="Show details" className="text-slate-400 hover:text-slate-700 cursor-pointer"><ChevronRight size={15} className={`transition-transform ${open.has(x.code) ? 'rotate-90' : ''}`} /></button>
                  <span className="text-slate-900"><b className="text-indigo-600">{x.count}</b> {x.scope === 'page' ? (x.count === 1 ? 'page' : 'pages') : (x.count === 1 ? 'issue' : 'issues')} — {x.label}</span>
                  <button type="button" onClick={() => toggle(x.code)} className="text-13 text-slate-500 underline decoration-dotted cursor-pointer">How to fix</button>
                  <span className="ml-auto text-13">{x.before == null ? '' : x.count > x.before ? <span className="text-indigo-600">{x.count - x.before} new {x.count - x.before === 1 ? 'issue' : 'issues'}</span> : x.count < x.before ? <span className="text-emerald-600">{x.before - x.count} fixed</span> : <span className="text-slate-400">no change</span>}</span>
                </div>
                {open.has(x.code) && (
                  <div className="px-6 pb-4 pl-14 text-13 space-y-2">
                    <p className="text-slate-700"><b>How to fix:</b> {x.fix}.</p>
                    {x.urls.length > 0 && <div><div className="text-12 font-semibold text-slate-500 mb-1">Affected pages</div><ul className="space-y-0.5">{x.urls.slice(0, 20).map(u => <li key={u}><Url u={u} /></li>)}{x.urls.length > 20 && <li className="text-slate-400">+{x.urls.length - 20} more (see Export)</li>}</ul></div>}
                  </div>
                )}
              </li>))}</ul> : <p className="px-6 py-6 text-13 text-slate-500">Nothing in this view.</p>}
          </Card>
        );
      })}
      <p className="text-11.5 text-slate-400">The audit lists only what it can measure from the crawl; a check that needs data we do not collect (such as file compression or HSTS headers) is not shown, so a clean list means nothing here is wrong.</p>
    </div>
  );
}

function Tree({ node, depth = 0 }) {
  const [open, setOpen] = useState(depth < 1);
  const kids = Object.values(node.children).sort((a, b) => b.pages - a.pages || a.name.localeCompare(b.name));
  return (
    <li>
      <div className="flex items-center gap-2 py-1.5 text-13" style={{ paddingLeft: depth * 18 }}>
        {kids.length ? <button type="button" onClick={() => setOpen(o => !o)} aria-label="Toggle" className="text-slate-400 cursor-pointer"><ChevronRight size={13} className={`transition-transform ${open ? 'rotate-90' : ''}`} /></button> : <span className="w-[13px]" />}
        {kids.length ? <Folder size={14} className="text-amber-500" /> : <FileText size={14} className="text-slate-400" />}
        {node.url ? <Url u={node.url} /> : <span className="font-semibold text-slate-800">/{node.name}</span>}
        <span className="text-slate-400">{node.pages} page{node.pages !== 1 ? 's' : ''}</span>
        {node.issues > 0 && <Badge tone="amber">{node.issues} issues</Badge>}
      </div>
      {open && kids.length > 0 && <ul>{kids.map(k => <Tree key={k.name} node={k} depth={depth + 1} />)}</ul>}
    </li>
  );
}

function structure(pages) {
  const root = { name: '', children: {}, pages: 0, issues: 0 };
  for (const p of pages) {
    let segs = [];
    try { segs = new URL(p.url).pathname.split('/').filter(Boolean); } catch (e) { segs = []; }
    let n = root;
    root.pages += 1; root.issues += p.issues.length;
    segs.forEach((s, i) => {
      n.children[s] = n.children[s] || { name: s, children: {}, pages: 0, issues: 0 };
      n = n.children[s];
      n.pages += 1; n.issues += p.issues.length;
      if (i === segs.length - 1) n.url = p.url;
    });
    if (!segs.length) root.url = p.url;
  }
  return root;
}

/** Crawled Pages: every page the crawl fetched with its status, issues, depth and links; or the same as a folder tree. */
export function CrawledPagesTab({ r }) {
  const [mode, setMode] = useState('pages');
  const [q, setQ] = useState('');
  const [scope, setScope] = useState('url');
  const [sev, setSev] = useState('');
  const [open, setOpen] = useState(() => new Set());
  const rows = useMemo(() => r.pages.filter(p => (!q || (scope === 'title' ? (p.title || '') : p.url).toLowerCase().includes(q.toLowerCase())) && (!sev || (sev === 'healthy' ? !p.issues.length : p.issues.some(i => i.severity === sev)))), [r.pages, q, scope, sev]);
  const [slice, footer] = usePager(rows, 25);
  const toggle = (k) => setOpen(o => { const n = new Set(o); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const code = (s) => <span className={`inline-block px-2.5 py-0.5 rounded-full text-12 font-semibold ${!s ? 'bg-slate-100 text-slate-500' : s < 300 ? 'bg-emerald-100 text-emerald-700' : s < 400 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{s || '—'}</span>;
  const tree = useMemo(() => structure(r.pages), [r.pages]);
  return (
    <div className="space-y-4">
      <Segmented value={mode} onChange={setMode} options={[['pages', 'Pages'], ['structure', 'Site Structure']]} />
      {mode === 'structure' ? (
        <Card title="Site Structure" subtitle="The crawled pages by folder, with how many have issues"><ul>{<Tree node={{ ...tree, name: r.target.replace(/^https?:\/\//, '').replace(/\/$/, '') }} />}</ul></Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Select className={sel} value={scope} onChange={e => setScope(e.target.value)} aria-label="Search in"><option value="url">URL</option><option value="title">Title</option></Select>
            <label className="relative"><Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search" aria-label="Search pages" className="h-9 pl-8 pr-3 w-56 text-13 rounded border border-slate-200 bg-white" /></label>
            <Select className={sel} value={sev} onChange={e => setSev(e.target.value)} aria-label="Issues"><option value="">All pages</option><option value="error">With errors</option><option value="warning">With warnings</option><option value="notice">With notices</option><option value="healthy">Healthy</option></Select>
          </div>
          <Card title={`Crawled Pages (${rows.length})`} pad={false} action={<Button size="sm" icon={Download} onClick={() => csv(`${r.project}-pages.csv`, ['URL', 'Title', 'Status', 'Issues', 'Crawl depth', 'Inbound links', 'Words'], rows.map(p => [p.url, p.title, p.status, p.issues.length, p.depth, p.inbound, p.words]))}>Export</Button>}>
            <div className="overflow-x-auto">
              <table className="w-full text-13 min-w-[1000px]">
                <thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th> </Th><Th c="text-right">Inbound links</Th><Th>Page URL</Th><Th>Title</Th><Th>Status Code</Th><Th c="text-right">Issues</Th><Th c="text-right">Crawl Depth</Th><Th c="text-right">Words</Th><Th c="text-right">Text / HTML</Th></tr></thead>
                <tbody className="divide-y divide-slate-100">{slice.map(p => (
                  <React.Fragment key={p.url}>
                    <tr className="hover:bg-slate-50 align-top">
                      <td className="pl-3 pt-3 w-8">{p.issues.length > 0 && <button type="button" onClick={() => toggle(p.url)} aria-label="Show issues" className="text-slate-400 hover:text-slate-700 cursor-pointer"><ChevronRight size={14} className={`transition-transform ${open.has(p.url) ? 'rotate-90' : ''}`} /></button>}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{p.inbound ?? dash}</td>
                      <td className="px-4 py-3 max-w-[320px]"><Url u={p.url} /></td>
                      <td className="px-4 py-3 max-w-[260px] truncate" title={p.title || ''}>{p.title || dash}</td>
                      <td className="px-4 py-3">{code(p.status)}</td>
                      <td className="px-4 py-3 text-right">{p.issues.length ? <button type="button" onClick={() => toggle(p.url)} className="text-indigo-600 hover:underline cursor-pointer">{p.issues.length} {p.issues.length === 1 ? 'issue' : 'issues'}</button> : <span className="inline-flex items-center gap-1 text-emerald-600"><Check size={13} />Healthy</span>}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{p.depth != null ? `${p.depth} ${p.depth === 1 ? 'click' : 'clicks'}` : dash}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{p.words ?? dash}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{p.text_ratio != null ? `${p.text_ratio}%` : dash}</td>
                    </tr>
                    {open.has(p.url) && <tr className="bg-slate-50/60"><td /><td colSpan={8} className="px-4 py-3"><ul className="space-y-1.5">{p.issues.map(i => <li key={i.code} className="flex gap-2 text-13"><span className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ background: SEV[i.severity][1] }} /><span><b className="text-slate-900">{i.label}.</b> <span className="text-slate-600">{i.fix}.</span></span></li>)}</ul></td></tr>}
                  </React.Fragment>))}
                {!slice.length && <tr><td colSpan={9} className="px-5 py-10 text-center text-slate-500">No page matches.</td></tr>}</tbody>
              </table>
            </div>
            {footer}
          </Card>
        </>
      )}
    </div>
  );
}

/** Statistics: how the crawled pages are spread over status codes, sitemap, depth, links, markup and canonical tags. */
export function StatisticsTab({ r }) {
  const [view, setView] = useState('tile');
  const s = r.statistics;
  const unk = (label) => `${label} (not recorded in this crawl: re-run the audit)`;
  const tiles = [
    { title: 'HTTP Status Code', big: `${s.http.bad}%`, cap: 'pages with 4xx and 5xx status codes', rows: ['5xx', '4xx', '3xx', '2xx', '1xx'].map(k => [`${k}`, s.http[k]]) },
    { title: 'Sitemap vs. Crawled Pages', big: s.sitemap.listed, cap: 'pages in sitemap', rows: s.sitemap.found_in_sitemap != null ? [['Crawled pages found in sitemap', s.sitemap.found_in_sitemap], ['Crawled pages not found in sitemap', s.sitemap.not_in_sitemap]] : [['Pages crawled', r.pages_crawled]], count: s.sitemap.found_in_sitemap == null },
    { title: 'Pages Crawl Depth', big: s.depth.unknown === 100 ? '—' : `${s.depth.deep}%`, cap: s.depth.unknown === 100 ? unk('depth') : 'pages with more than 3 clicks', rows: Object.entries(s.depth.levels).map(([k, v]) => [`${k === '4' ? '4+' : k} ${k === '1' ? 'click' : 'clicks'}`, v]) },
    { title: 'Incoming Internal Links', big: `${s.inbound.one}%`, cap: 'pages have only 1 incoming internal link', rows: [['No links (orphans)', s.inbound.zero], ['2-5', s.inbound['2-5']], ['6-15', s.inbound['6-15']], ['16-50', s.inbound['16-50']], ['51+', s.inbound['51+']]] },
    { title: 'Markup Types', big: `${s.markup.none}%`, cap: 'pages have no markup', rows: [['Schema.org (JSON-LD)', s.markup.json_ld], ['Open Graph', s.markup.open_graph], ['Twitter Cards', s.markup.twitter]] },
    { title: 'Canonicalization', big: `${s.canonical.missing}%`, cap: 'pages without rel="canonical" tag', rows: [['Canonical to another page', s.canonical.other], ['Self-canonical', s.canonical.self]] },
    { title: 'Content', big: s.content.avg_words, cap: 'average words per page', rows: [['Thin pages (under 200 words)', s.content.thin], ['Pages with one H1', s.content.with_h1], ['Pages with a meta description', s.content.with_meta], ['Pages with a title', s.content.with_title]] },
  ];
  return (
    <div className="space-y-4">
      <Segmented value={view} onChange={setView} options={[['tile', 'Tile'], ['graph', 'Graph']]} />
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {tiles.map(t => (
          <Card key={t.title} title={t.title}>
            {view === 'tile' ? (
              <>
                <div className="text-30 font-bold tabular-nums" style={{ color: '#5b50d6' }}>{t.big}</div>
                <div className="text-13 text-slate-700 mb-3">{t.cap}</div>
                <ul className="space-y-1 text-13 text-slate-600">{t.rows.map(([l, v]) => <li key={l}>{l}: <b className="text-emerald-600 tabular-nums">{t.count ? v : `${v}%`}</b></li>)}</ul>
              </>
            ) : (
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={t.rows.map(([l, v]) => ({ l, v }))} layout="vertical" margin={{ top: 4, right: 12, left: 10, bottom: 0 }}>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" horizontal={false} />
                    <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} domain={t.count ? [0, 'auto'] : [0, 100]} />
                    <YAxis type="category" dataKey="l" tick={AXIS} tickLine={false} axisLine={false} width={120} />
                    <Tooltip /><Bar dataKey="v" name={t.count ? 'Pages' : '% of pages'} fill="#6658dd" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>))}
      </div>
    </div>
  );
}

/** Compare Crawls: two audits side by side, what was fixed and what is new. */
export function CompareTab({ r }) {
  const h = r.history;
  const [a, setA] = useState(h[0].id);
  const [b, setB] = useState((h[1] || h[0]).id);
  const A = h.find(x => x.id === a) || h[0];
  const B = h.find(x => x.id === b) || h[0];
  const opts = h.map(x => <option key={x.id} value={x.id}>{when(x.date)}</option>);
  const gen = [['Pages crawled', x => x.pages], ['Site Health', x => x.health], ['Total issues', x => x.totals.issues], ['Total errors', x => x.totals.errors], ['Total warnings', x => x.totals.warnings], ['Total notices', x => x.totals.notices]];
  const cell = (n, o) => (n > o ? <span className="text-indigo-600 font-semibold">{n - o}</span> : dash);
  return (
    <Card pad={false}>
      <table className="w-full text-13">
        <thead className="bg-slate-50 text-12.5"><tr><th className="px-5 py-3 text-left font-semibold text-slate-700">General</th>
          <th className="px-5 py-3"><Select className={sel} value={a} onChange={e => setA(Number(e.target.value))} aria-label="Newer crawl">{opts}</Select></th>
          <th className="px-5 py-3"><div className="inline-flex items-center gap-2"><span className="text-slate-500">vs</span><Select className={sel} value={b} onChange={e => setB(Number(e.target.value))} aria-label="Older crawl">{opts}</Select></div></th>
          <th className="px-5 py-3 text-right font-semibold text-slate-600">Fixed</th><th className="px-5 py-3 text-right font-semibold text-slate-600">New</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{gen.map(([l, f]) => (
          <tr key={l}><td className="px-5 py-2.5 text-slate-800">{l}</td><td className="px-5 py-2.5 text-center tabular-nums">{f(A) ?? dash}</td><td className="px-5 py-2.5 text-center tabular-nums">{f(B) ?? dash}</td>
            <td className="px-5 py-2.5 text-right">{l.startsWith('Total') && f(B) > f(A) ? <span className="text-emerald-600 font-semibold">{f(B) - f(A)}</span> : dash}</td>
            <td className="px-5 py-2.5 text-right">{l.startsWith('Total') ? cell(f(A), f(B)) : dash}</td></tr>))}</tbody>
        {SEV_ORDER.map(s => (
          <tbody key={s} className="divide-y divide-slate-100">
            <tr><td colSpan={5} className="px-5 pt-5 pb-2 text-16 font-bold text-slate-900">{SEV[s][0]}<div className="h-[3px] mt-2" style={{ background: SEV[s][1] }} /></td></tr>
            {r.checks.filter(c => c.severity === s).map(c => { const x = A.counts[c.code] ?? 0; const y = B.counts[c.code] ?? 0; return (
              <tr key={c.code}><td className="px-5 py-2.5 text-indigo-700">{c.label}</td><td className="px-5 py-2.5 text-center tabular-nums">{x}</td><td className="px-5 py-2.5 text-center tabular-nums">{y}</td>
                <td className="px-5 py-2.5 text-right">{y > x ? <span className="text-emerald-600 font-semibold">{y - x}</span> : dash}</td><td className="px-5 py-2.5 text-right">{cell(x, y)}</td></tr>); })}
          </tbody>))}
      </table>
      {h.length < 2 && <p className="px-5 py-4 text-12 text-slate-500 border-t border-slate-100">Only one crawl so far: run the audit again to compare.</p>}
    </Card>
  );
}

/** Progress: how the chosen figures moved over the audits. */
export function ProgressTab({ r }) {
  const all = [...r.history].reverse();
  const [from, setFrom] = useState(all[0].id);
  const [to, setTo] = useState(all[all.length - 1].id);
  const [on, setOn] = useState(() => new Set(['issues']));
  const i0 = all.findIndex(x => x.id === from), i1 = all.findIndex(x => x.id === to);
  const range = all.slice(Math.min(i0, i1), Math.max(i0, i1) + 1);
  const metrics = {
    pages: ['Pages crawled', x => x.pages], health: ['Site Health', x => x.health], issues: ['Total issues', x => x.totals.issues], errors: ['Total errors', x => x.totals.errors],
    warnings: ['Total warnings', x => x.totals.warnings], notices: ['Total notices', x => x.totals.notices], ...Object.fromEntries(r.checks.map(c => [c.code, [c.label, x => x.counts[c.code] ?? 0]])),
  };
  const data = range.map(x => ({ t: when(x.date), ...Object.fromEntries([...on].map(k => [k, metrics[k][1](x)])) }));
  const toggle = (k) => setOn(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n.size ? n : s; });
  const pill = (k, label) => <button key={k} type="button" onClick={() => toggle(k)} className={`px-3 py-1.5 rounded-full border text-12.5 cursor-pointer ${on.has(k) ? 'border-indigo-400 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>{on.has(k) ? '● ' : '○ '}{label}</button>;
  const opts = all.map(x => <option key={x.id} value={x.id}>{when(x.date)}</option>);
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-3 mb-3 text-13">
          <span className="font-semibold text-slate-700">HISTORICAL CHART FOR AUDITS</span>
          <span className="text-slate-500">From:</span><Select className={sel} value={from} onChange={e => setFrom(Number(e.target.value))} aria-label="From">{opts}</Select>
          <span className="text-slate-500">To:</span><Select className={sel} value={to} onChange={e => setTo(Number(e.target.value))} aria-label="To">{opts}</Select>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 16, left: -6, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" vertical={false} />
              <XAxis dataKey="t" tick={AXIS} tickLine={false} axisLine={false} minTickGap={30} />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
              <Tooltip formatter={(v, n) => [v, metrics[n]?.[0] || n]} /><Legend formatter={(n) => metrics[n]?.[0] || n} iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              {[...on].map((k, i) => <Line key={k} type="monotone" dataKey={k} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />)}
            </LineChart>
          </ResponsiveContainer>
        </div>
        {range.length < 2 && <p className="text-12 text-slate-500">One audit so far: lines draw as more audits are run.</p>}
      </Card>
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-6">
        <div><div className="text-16 font-bold text-slate-900 pb-1 mb-3 border-b-[3px] border-slate-300">General:</div><div className="flex flex-wrap gap-2">{['pages', 'health', 'issues', 'errors', 'warnings', 'notices'].map(k => pill(k, metrics[k][0]))}</div></div>
        {SEV_ORDER.map(s => <div key={s}><div className="text-16 font-bold text-slate-900 pb-1 mb-3 border-b-[3px]" style={{ borderColor: SEV[s][1] }}>{SEV[s][0]}:</div><div className="flex flex-wrap gap-2">{r.checks.filter(c => c.severity === s).map(c => pill(c.code, c.label))}</div></div>)}
      </div>
    </div>
  );
}

/** JS Impact: pages whose content only exists after JavaScript runs, which search engines and AI crawlers may not see. */
export function JsTab({ r }) {
  const j = r.js;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="Pages crawled"><div className="text-30 font-bold tabular-nums" style={{ color: '#5b50d6' }}>{j.pages}</div></Card>
        <Card title="Content needs JavaScript"><div className={`text-30 font-bold tabular-nums ${j.js_only ? 'text-red-600' : 'text-emerald-600'}`}>{j.js_only}</div><div className="text-13 text-slate-600">{j.pages ? Math.round(j.js_only / j.pages * 100) : 0}% of crawled pages show almost no text without JavaScript</div></Card>
        <Card title="Average words per page"><div className="text-30 font-bold tabular-nums" style={{ color: '#5b50d6' }}>{j.avg_words}</div><div className="text-13 text-slate-600">in the HTML a crawler receives</div></Card>
      </div>
      <Card title="What this means" subtitle="The audit reads each page as a search engine's first fetch does: without running JavaScript">
        {j.js_only ? <p className="text-13 text-slate-700">{j.js_only} of {j.pages} pages are empty until JavaScript builds them. Google can render JavaScript later, but many AI crawlers and social previews never do, so the text, links and contact details on these pages may not be seen. Fix: serve the content in the HTML (server-side rendering or pre-rendering).</p>
          : <p className="text-13 text-slate-700">Every crawled page has its content in the HTML, so it does not depend on JavaScript to be read.</p>}
      </Card>
      {j.urls.length > 0 && <Card title={`Pages that depend on JavaScript (${j.urls.length})`} pad={false}><ul className="divide-y divide-slate-100">{j.urls.map(u => <li key={u} className="px-5 py-2.5 text-13"><Url u={u} /></li>)}</ul></Card>}
    </div>
  );
}
