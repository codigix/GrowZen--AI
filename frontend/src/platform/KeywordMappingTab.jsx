import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Copy, Download, ExternalLink, Eye, Lightbulb, PenLine, Search } from 'lucide-react';
import { Card, Button, Badge, ErrorNote, SkList, useAction, useToast } from './SeoUi';
import { api, useApi } from './seoApi';
import { Act } from './TableBits';
import DataTable, { downloadFile } from './DataTable';
import PageMetaCard from './PageMetaCard';
import BriefButtons from './DevBrief';
import { KeywordsView, PageOverview } from './KeywordPlacement';
import Select from '../components/Select';

const STATUS = { not_mapped: ['Not mapped', 'gray'], mapped: ['Mapped', 'blue'], optimization: ['Optimization required', 'amber'], new_page: ['New page required', 'red'], completed: ['Completed', 'green'] };

const guessQ = (p) => encodeURIComponent((p.path !== '/' ? p.path.replace(/[-_/]+/g, ' ').trim() : (p.title || p.path).split(/[|\-–:]/)[0].trim()).slice(0, 40));
const n0 = (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN'));

/** Plain words a writer or developer can act on. */
const brief = (x, type) => [
  `${type === 'page' ? 'New page' : 'New blog post'}: ${x.title}`,
  `Main keyword: ${x.keyword}${x.volume ? ` (${n0(x.volume)} searches a month)` : ''}`,
  type === 'page' ? `Suggested address: ${x.slug}` : `Suggested slug: ${x.slug}`,
  'Put the keyword in the title, the main heading and the first paragraph, and in the meta description.',
].join('\n');

/** Where each keyword stands (not mapped, mapped, optimization required, new page required, completed), the risks of pages competing with each other, and mapping keywords in bulk. */
function StatusView({ b, d, onData, toast }) {
  const [sel, setSel] = useState(() => new Set());
  const [page, setPage] = useState('');
  const [busy, , run] = useAction();
  const view = useRef([]);
  const rows = d.statuses || [];
  const pages = d.pages || [];
  const send = (payload, done) => run('assign', async () => {
    try {
      const out = await api(`/businesses/${b.id}/keyword-mapping/assign`, { method: 'POST', body: { ids: [...sel], ...payload } });
      onData(out); setSel(new Set()); toast(done(out));
    } catch (e) { toast(e.message || 'Could not update the keywords.'); }
  });
  const one = (id, payload, done) => run('assign', async () => { try { onData(await api(`/businesses/${b.id}/keyword-mapping/assign`, { method: 'POST', body: { ids: [id], ...payload } })); toast(done); } catch (e) { toast(e.message || 'Could not update the keyword.'); } });
  const cols = [
    {
      id: 'sel', header: <input type="checkbox" aria-label="Select every row shown" onChange={e => setSel(x => { const n = new Set(x); view.current.forEach(r => (e.target.checked ? n.add(r.id) : n.delete(r.id))); return n; })} className="accent-indigo-600" />, csv: false,
      cell: r => <input type="checkbox" aria-label={`Select ${r.keyword}`} checked={sel.has(r.id)} onChange={() => setSel(x => { const n = new Set(x); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })} className="accent-indigo-600" />, className: 'pl-3 pr-1 py-2.5 w-8', thClass: 'pl-3 pr-1 py-3 w-8'
    },
    { id: 'keyword', header: 'Keyword', first: 'asc', value: r => r.keyword, cell: r => <span className="font-semibold text-slate-900">{r.keyword}</span>, className: 'px-3 py-2.5 min-w-[200px]' },
    { id: 'volume', header: 'Searches / mo', right: true, first: 'desc', value: r => r.volume ?? null, cell: r => n0(r.volume) },
    {
      id: 'status', header: 'Mapping status', value: r => STATUS[r.status]?.[0] || r.status, tip: { what: 'Mapped: a page of the site carries it. New page required: no page carries it. Optimization required and Completed are set by you.' },
      cell: r => <Badge tone={STATUS[r.status]?.[1] || 'gray'}>{STATUS[r.status]?.[0] || r.status}{r.by_hand && <span className="ml-1 opacity-60" title="Set by hand">·</span>}</Badge>
    },
    { id: 'page', header: 'Page', value: r => r.page || '', cell: r => r.page || <span className="text-slate-300">No page</span>, className: 'px-3 py-2.5 font-mono text-12.5 text-slate-600' },
    { id: 'role', header: 'Role', value: r => r.role || '', cell: r => (r.role === 'primary' ? <Badge tone="blue">Main</Badge> : r.role === 'secondary' ? <Badge tone="gray">Supporting</Badge> : <span className="text-slate-300">—</span>) },
    {
      id: 'act', header: 'Set', csv: false, right: true, className: 'px-2 py-1.5 text-right whitespace-nowrap', cell: r => (
        <span className="inline-flex gap-1">
          <button type="button" onClick={() => one(r.id, { status: 'optimization' }, `${r.keyword}: optimization required`)} title="Optimization required" className="px-1.5 py-0.5 rounded text-11.5 font-semibold text-amber-700 hover:bg-amber-50 cursor-pointer">Optimize</button>
          <button type="button" onClick={() => one(r.id, { status: 'new_page' }, `${r.keyword}: new page required`)} title="New page required" className="px-1.5 py-0.5 rounded text-11.5 font-semibold text-rose-700 hover:bg-rose-50 cursor-pointer">New page</button>
          <button type="button" onClick={() => one(r.id, { status: 'completed' }, `${r.keyword}: completed`)} title="Completed" className="px-1.5 py-0.5 rounded text-11.5 font-semibold text-emerald-700 hover:bg-emerald-50 cursor-pointer">Done</button>
        </span>)
    },
  ];
  const filters = [
    { id: 'status', label: 'Status', options: Object.entries(STATUS).map(([k, v]) => [k, v[0]]), test: (r, v) => r.status === v },
    { id: 'role', label: 'Role', options: [['primary', 'Main'], ['secondary', 'Supporting'], ['none', 'No role']], test: (r, v) => (v === 'none' ? !r.role : r.role === v) },
    { id: 'page', label: 'Page', options: [...new Set(rows.map(r => r.page).filter(Boolean))].sort().map(x => [x, x]), test: (r, v) => r.page === v },
  ];
  const count = (k) => d.status_counts?.[k] || 0;
  return (
    <div className="space-y-3">
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        {Object.entries(STATUS).map(([k, v]) => <div key={k} className="rounded-xl bg-white ring-1 ring-slate-200 px-3.5 py-2.5"><div className="text-12.5 text-slate-600">{v[0]}</div><div className="text-22 font-bold text-slate-900 tabular-nums leading-tight">{count(k)}</div></div>)}
      </div>

      {(d.cannibalization?.length > 0 || d.duplicates?.length > 0) ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card title={`Cannibalization risks (${d.cannibalization.length})`} subtitle="Pages that would compete with each other for the same search.">
            {d.cannibalization.length ? <ul className="space-y-2 max-h-72 overflow-auto">{d.cannibalization.map(x => <li key={x.keyword} className="text-12.5"><b className="text-slate-900">{x.keyword}</b> <span className="text-slate-400">{n0(x.volume)} a month</span><div className="text-slate-600">{x.why}</div><div className="font-mono text-11.5 text-slate-500">{x.pages.join('  ·  ')}</div></li>)}</ul> : <p className="text-13 text-emerald-700 flex items-center gap-1.5"><CheckCircle2 size={14} />No two pages compete for a keyword.</p>}
          </Card>
          <Card title={`Duplicate page targeting (${d.duplicates.length})`} subtitle="Keywords that should share one page, and pages with two main keywords.">
            {d.duplicates.length ? <ul className="space-y-2 max-h-72 overflow-auto">{d.duplicates.map((x, i) => <li key={i} className="text-12.5"><b className="text-slate-900">{x.keywords.join(' · ')}</b><div className="text-slate-600">{x.why}</div>{x.pages.length > 0 && <div className="font-mono text-11.5 text-slate-500">{x.pages.join('  ·  ')}</div>}</li>)}</ul> : <p className="text-13 text-emerald-700 flex items-center gap-1.5"><CheckCircle2 size={14} />No page targets the same keyword twice.</p>}
          </Card>
        </div>
      ) : <p className="rounded-lg bg-emerald-50 ring-1 ring-emerald-200 px-3 py-2 text-12.5 text-emerald-900 inline-flex items-center gap-1.5"><CheckCircle2 size={14} />No cannibalization or duplicate page targeting found in the saved keywords and the last website scan.</p>}
      <p className="text-12 text-slate-500">Risks come from the saved keywords and the last website scan only: two pages are flagged when both carry a keyword in their title, heading, address or description about equally. They show where pages could compete; they do not show real ranking positions.</p>

      <Card pad={false} title={`Keywords (${rows.length})`} subtitle="Tick keywords to put them on a page, make them the page's main keyword, or set their status.">
        <DataTable bare minWidth={900} rows={rows} rowKey={r => r.id} columns={cols} filters={filters} initialSort={{ key: 'volume', dir: 'desc' }} exportName="keyword-mapping-status" searchPlaceholder="Search keywords or pages" label="keywords" onState={st => { view.current = st.rows; }} rowClass={r => (sel.has(r.id) ? 'bg-indigo-50/50' : 'hover:bg-slate-50')} />
      </Card>

      {sel.size > 0 && (
        <div className="sticky bottom-3 z-20"><div role="toolbar" aria-label="Mapping actions" className="rounded-xl bg-white shadow-xl ring-1 ring-slate-200 px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-800 text-13.5 font-semibold">{sel.size} keyword{sel.size === 1 ? '' : 's'} selected</span>
          <button type="button" onClick={() => setSel(new Set())} className="text-12.5 text-slate-500 hover:text-slate-800 underline cursor-pointer">Clear</button>
          <Select value={page} onChange={e => setPage(e.target.value)} aria-label="Page" className="h-9 max-w-[260px] rounded-lg ring-1 ring-inset ring-slate-300 bg-white px-2.5 text-13"><option value="">Choose a page…</option>{pages.map(p => <option key={p.url} value={p.url}>{p.path}</option>)}</Select>
          <Button size="sm" busy={busy === 'assign'} disabled={!page} onClick={() => send({ target_url: page }, o => `${o.updated} keyword${o.updated === 1 ? '' : 's'} put on the page`)}>Put on this page</Button>
          <Button size="sm" busy={busy === 'assign'} disabled={!page} onClick={() => send({ target_url: page, role: 'primary' }, o => `${o.updated} keyword${o.updated === 1 ? '' : 's'}: main keyword of the page (one per page)`)}>Make main</Button>
          <Button size="sm" busy={busy === 'assign'} onClick={() => send({ role: 'secondary' }, o => `${o.updated} keyword${o.updated === 1 ? '' : 's'} set as supporting`)}>Make supporting</Button>
          <Select value="" onChange={e => e.target.value && send({ status: e.target.value }, o => `${o.updated} keyword${o.updated === 1 ? '' : 's'} updated`)} aria-label="Set status" className="h-9 rounded-lg ring-1 ring-inset ring-slate-300 bg-white px-2.5 text-13"><option value="">Set status…</option><option value="optimization">Optimization required</option><option value="new_page">New page required</option><option value="completed">Completed</option><option value="mapped">Reset (work it out again)</option></Select>
        </div></div>
      )}
    </div>
  );
}

/** Which keyword goes on which page, which pages are missing, and which keywords are better as posts. */
export default function KeywordMappingTab({ b }) {
  const r = useApi(`/businesses/${b.id}/keyword-mapping`);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const [view, setView] = useState('keywords'); // keywords | pages | create
  const [open, setOpen] = useState(null); // the page overview: { url, focus }
  const d = r.data;
  const [params] = useSearchParams();
  const arrived = useRef(false);
  useEffect(() => { // sent here from a keyword's "Add to page" or "Where to use it": open that page's overview with the keyword in focus
    if (arrived.current || !d) return;
    const pg = params.get('page'), kwd = params.get('keyword');
    if (!pg && !kwd) return;
    arrived.current = true;
    setView('keywords');
    if (pg) setOpen({ url: pg, focus: kwd || undefined });
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  if (r.error) return <Card><ErrorNote>{r.error.message}</ErrorNote></Card>;
  if (!d) return <SkList rows={6} />;
  const save = () => run('apply', async () => { const out = await api(`/businesses/${b.id}/keyword-mapping/apply`, { method: 'POST' }); r.setData(out); toast(out.mapped ? `Mapping saved: ${out.mapped} keyword${out.mapped === 1 ? '' : 's'} now point to their page` : 'Mapping saved on your keywords'); });
  const copy = (x, type) => { try { navigator.clipboard.writeText(brief(x, type)); toast('Brief copied'); } catch { toast('Could not copy'); } };

  if (!d.keywords) return <Card><p className="py-10 text-center text-13 text-slate-500">No keywords are saved yet. Pick some in the <Link to="/keyword-management/workspace" className="font-semibold text-indigo-700 hover:underline">Keyword Workspace</Link> first.</p></Card>;
  if (!d.crawled) return <Card><p className="py-10 text-center text-13 text-slate-500">The website has not been scanned yet, so there are no pages to match. <Link to="/website-audit" className="font-semibold text-indigo-700 hover:underline">Run the Website Audit</Link>, then come back.</p></Card>;

  const waiting = d.pages.filter(p => p.primary && !p.saved).length;
  const todo = [...d.missing_pages.map(x => ({ ...x, type: 'page' })), ...d.blog_opportunities.map(x => ({ ...x, type: 'post' }))].sort((a, c) => (c.volume || 0) - (a.volume || 0));
  return (
    <div className="space-y-3">
      <ErrorNote>{error}</ErrorNote>
      {d.notes?.map(n => <p key={n} className="text-12.5 text-amber-900 bg-amber-50 rounded px-3 py-2">{n}</p>)}

      {/* One slim toolbar: the three views, how far the mapping is, the button that saves it, and the document for the developer */}
      <div className="rounded-xl bg-white ring-1 ring-slate-200 px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex gap-0.5 p-0.5 bg-slate-100 rounded-lg" role="tablist" aria-label="Mapping views">
          {[['keywords', `Keywords ${d.keywords}`], ['pages', `Pages ${d.pages.length}`], ['create', `To create ${todo.length}`], ['status', `Status and risks ${(d.cannibalization?.length || 0) + (d.duplicates?.length || 0) || ''}`.trim()]].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)} className={`h-8 px-3 text-12.5 font-semibold rounded-md cursor-pointer ${view === id ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800'}`}>{label}</button>))}
        </div>
        <span className="text-12.5 text-slate-600" title={`${d.mapped} of ${d.keywords} keywords have a page. ${d.primaries} of ${d.pages.length} pages have a main keyword.`}><b className="text-slate-900 tabular-nums">{d.mapped}/{d.keywords}</b> keywords have a page · <b className="text-slate-900 tabular-nums">{d.primaries}/{d.pages.length}</b> pages have a main keyword</span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {waiting > 0 ? <span className="text-amber-700 text-12.5">{waiting} suggestion{waiting === 1 ? '' : 's'} not saved</span> : d.primaries > 0 ? <span className="text-emerald-700 text-12.5 inline-flex items-center gap-1"><CheckCircle2 size={14} />All saved</span> : null}
          <Button size="sm" variant="primary" icon={CheckCircle2} busy={busy === 'apply'} disabled={waiting === 0} onClick={save} title="Writes the page and the main or supporting role on each keyword. A page you chose yourself is never changed.">Save the mapping</Button>
          <span className="hidden lg:block w-px h-6 bg-slate-200" aria-hidden="true" />
          <BriefButtons b={b} size="sm" />
        </span>
      </div>

      {view === 'pages' && <>
        <PageMetaCard b={b} sharedNote={Boolean(d.notes?.length)} />

        <Card pad={false} title={`Your pages (${d.pages.length})`} subtitle={`Website scan of ${d.found_at || 'the last audit'}. A page's most searched keyword is its main one.`}>
          <DataTable bare minWidth={760} rows={d.pages} rowKey={p => p.url} exportName="pages-and-keywords" label="pages" searchPlaceholder="Search pages" columnsMenu={false} rowClass={() => 'hover:bg-slate-50'}
            columns={[
              {
                id: 'page', header: 'Page', tip: { what: 'A page of your website.', why: 'Click the address to open it.', from: 'the last website scan (Website Audit).' }, thClass: 'px-3 py-2', value: p => p.url, className: 'px-3 py-2.5 min-w-[200px] max-w-[300px]',
                cell: p => <>
                  <a href={p.url} target="_blank" rel="noreferrer" className="font-semibold text-indigo-700 hover:underline inline-flex items-center gap-1 break-all">{p.path}<ExternalLink size={11} className="shrink-0" /></a>
                  <span className="block text-11.5 text-slate-400 truncate" title={p.title}>{p.title}</span>
                </>
              },
              { id: 'page_title', header: 'Page title', hide: true, value: p => p.title || '' },
              {
                id: 'primary', header: 'Main keyword', tip: { what: 'The keyword this page should rank for: the most searched keyword found on it.', why: 'One main keyword per page keeps your pages from competing with each other.', from: 'your saved keywords matched to the page title, heading and description from the website scan.' }, thClass: 'px-3 py-2', value: p => p.primary || null, className: 'px-3 py-2.5',
                cell: p => (p.primary ? <Link to={`/keyword-overview?q=${encodeURIComponent(p.primary)}`} title="Check its searches and cost" className="font-semibold text-slate-900 hover:text-indigo-700 hover:underline">{p.primary}</Link> : <span className="text-slate-400">none</span>)
              },
              { id: 'volume', header: 'Searches / mo', right: true, first: 'desc', tip: { what: 'Monthly searches for the main keyword.', from: 'Google Ads Keyword Planner.' }, thClass: 'px-3 py-2', value: p => p.primary_volume ?? null, className: 'px-3 py-2.5  tabular-nums', cell: p => n0(p.primary_volume) },
              {
                id: 'secondary', header: 'Also on this page', tip: { what: 'Other saved keywords this page also covers.', why: 'They support the main keyword.' }, thClass: 'px-3 py-2', value: p => p.secondary.join(', '), className: 'px-3 py-2.5 text-12.5 text-slate-600 max-w-[260px]',
                cell: p => (p.secondary.length ? <span title={p.secondary.join(', ')}>{p.secondary.slice(0, 2).join(', ')}{p.secondary.length > 2 ? ` +${p.secondary.length - 2}` : ''}</span> : <span className="text-slate-300">—</span>)
              },
              {
                id: 'status', header: 'Status', tip: { what: 'Saved: written on the keywords already. Suggested: our proposal, not saved yet.', why: 'Press Save the mapping to save the suggestions.' }, thClass: 'px-3 py-2', value: p => (!p.primary ? 'No keyword' : p.saved ? 'Saved' : 'Suggested'), className: 'px-3 py-2.5 whitespace-nowrap',
                cell: p => (!p.primary ? <Link to={`/keyword-management/discover?q=${guessQ(p)}`} className="text-12.5 font-semibold text-amber-700 hover:underline">Find a keyword</Link>
                  : p.saved ? <span title="Written on the keyword: it is saved"><Badge tone="green">Saved</Badge></span> : <span title="Our proposal. Press Save the mapping to keep it"><Badge tone="amber">Suggested</Badge></span>)
              },
              {
                id: 'actions', header: 'Actions', right: true, tip: { what: 'Things you can do for this page.', why: 'Open the page, check its keyword, or find a keyword if it has none.' }, thClass: 'px-3 py-2', className: 'px-3 py-2.5 text-right whitespace-nowrap',
                cell: p => (
                  <span className="inline-flex gap-1.5">
                    <Act icon={Eye} tone="indigo" tip="Overview: read this page and see where each picked keyword is used and where to add it." onClick={() => setOpen({ url: p.url })}>Overview</Act>
                    <a href={p.url} target="_blank" rel="noreferrer"><Act icon={ExternalLink} tone="slate" tip="Open: show this page on your website in a new tab." /></a>
                    {p.primary ? <Link to={`/keyword-overview?q=${encodeURIComponent(p.primary)}`}><Act icon={Search} tone="sky" tip="Check keyword: open the searches, cost and related ideas for its main keyword." /></Link>
                      : <Link to={`/keyword-management/discover?q=${guessQ(p)}`}><Act icon={Lightbulb} tone="indigo" tip="Find a keyword: search for keywords this page could rank for." /></Link>}
                  </span>)
              },
            ]} />
        </Card>

      </>}

      {view === 'status' && <StatusView b={b} d={d} onData={r.setData} toast={toast} />}

      {view === 'keywords' && <KeywordsView b={b} onOpen={(url, focus) => setOpen({ url, focus })} />}

      {view === 'create' && (
        <Card pad={false} title={`Pages and posts to create (${todo.length})`} subtitle="Keywords no page carries: a page for buying or booking, a blog post for questions."
          action={todo.length > 0 && <Button size="sm" icon={Download} onClick={() => downloadFile(`pages-and-posts-to-create-${b.name}-${new Date().toISOString().slice(0, 10)}.md`, `# Pages and posts to create for ${b.name}\n\n${todo.map(x => `## ${x.title}\n\n${brief(x, x.type).split('\n').map(l => `- ${l}`).join('\n')}`).join('\n\n')}\n`, 'text/markdown')} title="Download a short brief for every page and post to create, to send to whoever builds them">Download briefs</Button>}>
          {todo.length === 0 ? <p className="px-5 py-6 text-13 text-emerald-700 flex items-center gap-1.5"><CheckCircle2 size={15} />Every keyword has a page.</p> : (
            <DataTable bare minWidth={700} rows={todo} rowKey={x => `${x.type}-${x.keyword}`} exportName="pages-and-posts-to-create" label="keywords" searchPlaceholder="Search keywords" columnsMenu={false} rowClass={() => 'hover:bg-slate-50'}
              columns={[
                { id: 'type', header: 'Make a', tip: { what: 'What to make: a page for people who want to buy or book, or a blog post for questions and guides.', why: 'Keywords no page covers cannot rank.' }, thClass: 'px-3 py-2', value: x => (x.type === 'page' ? 'Page' : 'Blog post'), className: 'px-3 py-2.5', cell: x => <Badge tone={x.type === 'page' ? 'blue' : 'violet'}>{x.type === 'page' ? 'Page' : 'Blog post'}</Badge> },
                { id: 'keyword', header: 'For the keyword', tip: { what: 'The saved keyword that has no page.', from: 'your saved keywords compared with the website scan.' }, thClass: 'px-3 py-2', value: x => x.keyword, className: 'px-3 py-2.5 font-semibold text-slate-900' },
                { id: 'volume', header: 'Searches / mo', right: true, first: 'desc', tip: { what: 'Monthly searches.', from: 'Google Ads Keyword Planner.' }, thClass: 'px-3 py-2', value: x => x.volume ?? null, className: 'px-3 py-2.5  tabular-nums', cell: x => n0(x.volume) },
                { id: 'slug', header: 'Suggested address', tip: { what: 'A web address made from the keyword.', why: 'Use it when you create the page.' }, thClass: 'px-3 py-2', value: x => x.slug, className: 'px-3 py-2.5 text-12.5 text-slate-500 font-mono' },
                {
                  id: 'actions', header: 'Actions', right: true, tip: { what: 'Copy brief: a short note for whoever builds the page. Write: open the blog writer with this keyword ticked.' }, thClass: 'px-3 py-2', className: 'px-3 py-2.5 text-right whitespace-nowrap',
                  cell: x => (
                    <span className="inline-flex gap-1.5">
                      <Act icon={Copy} tone="slate" tip="Copy brief: copy the title, address and what to put where, to send to whoever builds the page." onClick={() => copy(x, x.type)} />
                      <Link to={`/ai-content-generation/blog?keyword=${encodeURIComponent(x.keyword)}`}><Act icon={PenLine} tone="violet" tip={x.type === 'post' ? 'Write the post: open the blog writer with this keyword ticked.' : 'Write it as a blog post instead: open the blog writer with this keyword ticked.'} /></Link>
                    </span>)
                },
              ]} />
          )}
        </Card>
      )}

      <PageOverview b={b} target={open} onClose={() => setOpen(null)} />
      {toastNode}
    </div>
  );
}
