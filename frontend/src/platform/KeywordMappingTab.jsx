import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Copy, ExternalLink, Eye, Lightbulb, PenLine, Search } from 'lucide-react';
import { Card, Button, Badge, ErrorNote, SkList, useAction, useToast } from './SeoUi';
import { api, useApi } from './seoApi';
import { Act } from './TableBits';
import DataTable from './DataTable';
import PageMetaCard from './PageMetaCard';
import BriefButtons from './DevBrief';
import { KeywordsView, PageOverview } from './KeywordPlacement';

const guessQ = (p) => encodeURIComponent((p.path !== '/' ? p.path.replace(/[-_/]+/g, ' ').trim() : (p.title || p.path).split(/[|\-–:]/)[0].trim()).slice(0, 40));
const n0 = (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN'));

/** Plain words a writer or developer can act on. */
const brief = (x, type) => [
  `${type === 'page' ? 'New page' : 'New blog post'}: ${x.title}`,
  `Main keyword: ${x.keyword}${x.volume ? ` (${n0(x.volume)} searches a month)` : ''}`,
  type === 'page' ? `Suggested address: ${x.slug}` : `Suggested slug: ${x.slug}`,
  'Put the keyword in the title, the main heading and the first paragraph, and in the meta description.',
].join('\n');

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
          {[['keywords', `Keywords ${d.keywords}`], ['pages', `Pages ${d.pages.length}`], ['create', `To create ${todo.length}`]].map(([id, label]) => (
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
            { id: 'page', header: 'Page', tip: { what: 'A page of your website.', why: 'Click the address to open it.', from: 'the last website scan (Website Audit).' }, thClass: 'px-3 py-2', value: p => p.path, className: 'px-3 py-2.5 min-w-[200px] max-w-[300px]',
              cell: p => <>
                <a href={p.url} target="_blank" rel="noreferrer" className="font-semibold text-indigo-700 hover:underline inline-flex items-center gap-1 break-all">{p.path}<ExternalLink size={11} className="shrink-0" /></a>
                <span className="block text-11.5 text-slate-400 truncate" title={p.title}>{p.title}</span>
              </> },
            { id: 'primary', header: 'Main keyword', tip: { what: 'The keyword this page should rank for: the most searched keyword found on it.', why: 'One main keyword per page keeps your pages from competing with each other.', from: 'your saved keywords matched to the page title, heading and description from the website scan.' }, thClass: 'px-3 py-2', value: p => p.primary || null, className: 'px-3 py-2.5',
              cell: p => (p.primary ? <Link to={`/keyword-overview?q=${encodeURIComponent(p.primary)}`} title="Check its searches and cost" className="font-semibold text-slate-900 hover:text-indigo-700 hover:underline">{p.primary}</Link> : <span className="text-slate-400">none</span>) },
            { id: 'volume', header: 'Searches / mo', right: true, first: 'desc', tip: { what: 'Monthly searches for the main keyword.', from: 'Google Ads Keyword Planner.' }, thClass: 'px-3 py-2', value: p => p.primary_volume ?? null, className: 'px-3 py-2.5 text-right tabular-nums', cell: p => n0(p.primary_volume) },
            { id: 'secondary', header: 'Also on this page', tip: { what: 'Other saved keywords this page also covers.', why: 'They support the main keyword.' }, thClass: 'px-3 py-2', value: p => p.secondary.join(', '), className: 'px-3 py-2.5 text-12.5 text-slate-600 max-w-[260px]',
              cell: p => (p.secondary.length ? <span title={p.secondary.join(', ')}>{p.secondary.slice(0, 2).join(', ')}{p.secondary.length > 2 ? ` +${p.secondary.length - 2}` : ''}</span> : <span className="text-slate-300">—</span>) },
            { id: 'status', header: 'Status', tip: { what: 'Saved: written on the keywords already. Suggested: our proposal, not saved yet.', why: 'Press Save the mapping to save the suggestions.' }, thClass: 'px-3 py-2', value: p => (!p.primary ? 'No keyword' : p.saved ? 'Saved' : 'Suggested'), className: 'px-3 py-2.5 whitespace-nowrap',
              cell: p => (!p.primary ? <Link to={`/keyword-management/discover?q=${guessQ(p)}`} className="text-12.5 font-semibold text-amber-700 hover:underline">Find a keyword</Link>
                : p.saved ? <span title="Written on the keyword: it is saved"><Badge tone="green">Saved</Badge></span> : <span title="Our proposal. Press Save the mapping to keep it"><Badge tone="amber">Suggested</Badge></span>) },
            { id: 'actions', header: 'Actions', right: true, tip: { what: 'Things you can do for this page.', why: 'Open the page, check its keyword, or find a keyword if it has none.' }, thClass: 'px-3 py-2', className: 'px-3 py-2.5 text-right whitespace-nowrap',
              cell: p => (
                <span className="inline-flex gap-1.5">
                  <Act icon={Eye} tone="indigo" tip="Overview: read this page and see where each picked keyword is used and where to add it." onClick={() => setOpen({ url: p.url })}>Overview</Act>
                  <a href={p.url} target="_blank" rel="noreferrer"><Act icon={ExternalLink} tone="slate" tip="Open: show this page on your website in a new tab." /></a>
                  {p.primary ? <Link to={`/keyword-overview?q=${encodeURIComponent(p.primary)}`}><Act icon={Search} tone="sky" tip="Check keyword: open the searches, cost and related ideas for its main keyword." /></Link>
                    : <Link to={`/keyword-management/discover?q=${guessQ(p)}`}><Act icon={Lightbulb} tone="indigo" tip="Find a keyword: search for keywords this page could rank for." /></Link>}
                </span>) },
          ]} />
      </Card>

      </>}

      {view === 'keywords' && <KeywordsView b={b} onOpen={(url, focus) => setOpen({ url, focus })} />}

      {view === 'create' && (
      <Card pad={false} title={`Pages and posts to create (${todo.length})`} subtitle="Keywords no page carries: a page for buying or booking, a blog post for questions.">
        {todo.length === 0 ? <p className="px-5 py-6 text-13 text-emerald-700 flex items-center gap-1.5"><CheckCircle2 size={15} />Every keyword has a page.</p> : (
          <DataTable bare minWidth={700} rows={todo} rowKey={x => `${x.type}-${x.keyword}`} exportName="pages-and-posts-to-create" label="keywords" searchPlaceholder="Search keywords" columnsMenu={false} rowClass={() => 'hover:bg-slate-50'}
            columns={[
              { id: 'type', header: 'Make a', tip: { what: 'What to make: a page for people who want to buy or book, or a blog post for questions and guides.', why: 'Keywords no page covers cannot rank.' }, thClass: 'px-3 py-2', value: x => (x.type === 'page' ? 'Page' : 'Blog post'), className: 'px-3 py-2.5', cell: x => <Badge tone={x.type === 'page' ? 'blue' : 'violet'}>{x.type === 'page' ? 'Page' : 'Blog post'}</Badge> },
              { id: 'keyword', header: 'For the keyword', tip: { what: 'The saved keyword that has no page.', from: 'your saved keywords compared with the website scan.' }, thClass: 'px-3 py-2', value: x => x.keyword, className: 'px-3 py-2.5 font-semibold text-slate-900' },
              { id: 'volume', header: 'Searches / mo', right: true, first: 'desc', tip: { what: 'Monthly searches.', from: 'Google Ads Keyword Planner.' }, thClass: 'px-3 py-2', value: x => x.volume ?? null, className: 'px-3 py-2.5 text-right tabular-nums', cell: x => n0(x.volume) },
              { id: 'slug', header: 'Suggested address', tip: { what: 'A web address made from the keyword.', why: 'Use it when you create the page.' }, thClass: 'px-3 py-2', value: x => x.slug, className: 'px-3 py-2.5 text-12.5 text-slate-500 font-mono' },
              { id: 'actions', header: 'Actions', right: true, tip: { what: 'Copy brief: a short note for whoever builds the page. Write: open the blog writer with this keyword ticked.' }, thClass: 'px-3 py-2', className: 'px-3 py-2.5 text-right whitespace-nowrap',
                cell: x => (
                  <span className="inline-flex gap-1.5">
                    <Act icon={Copy} tone="slate" tip="Copy brief: copy the title, address and what to put where, to send to whoever builds the page." onClick={() => copy(x, x.type)} />
                    <Link to={`/ai-content-generation/blog?keyword=${encodeURIComponent(x.keyword)}`}><Act icon={PenLine} tone="violet" tip={x.type === 'post' ? 'Write the post: open the blog writer with this keyword ticked.' : 'Write it as a blog post instead: open the blog writer with this keyword ticked.'} /></Link>
                  </span>) },
            ]} />
        )}
      </Card>
      )}

      <PageOverview b={b} target={open} onClose={() => setOpen(null)} />
      {toastNode}
    </div>
  );
}
