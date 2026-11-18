import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Copy, ExternalLink, PenLine } from 'lucide-react';
import { Card, Button, Badge, ErrorNote, SkList, useAction, useToast } from './SeoUi';
import { api, useApi } from './seoApi';
import { Act, Head } from './TableBits';

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
  const d = r.data;
  if (r.error) return <Card><ErrorNote>{r.error.message}</ErrorNote></Card>;
  if (!d) return <SkList rows={6} />;
  const save = () => run('apply', async () => { const out = await api(`/businesses/${b.id}/keyword-mapping/apply`, { method: 'POST' }); r.setData(out); toast('Mapping saved on your keywords'); });
  const copy = (x, type) => { try { navigator.clipboard.writeText(brief(x, type)); toast('Brief copied'); } catch { toast('Could not copy'); } };

  if (!d.keywords) return <Card><p className="py-10 text-center text-13 text-slate-500">No keywords are saved yet. Pick some in the <Link to="/keyword-management/workspace" className="font-semibold text-indigo-700 hover:underline">Keyword Workspace</Link> first.</p></Card>;
  if (!d.crawled) return <Card><p className="py-10 text-center text-13 text-slate-500">The website has not been scanned yet, so there are no pages to match. <Link to="/website-audit" className="font-semibold text-indigo-700 hover:underline">Run the Website Audit</Link>, then come back.</p></Card>;

  const waiting = d.pages.filter(p => p.primary && !p.saved).length;
  const todo = [...d.missing_pages.map(x => ({ ...x, type: 'page' })), ...d.blog_opportunities.map(x => ({ ...x, type: 'post' }))].sort((a, c) => (c.volume || 0) - (a.volume || 0));
  return (
    <div className="space-y-4">
      <ErrorNote>{error}</ErrorNote>

      {/* The state of the mapping, and the one button that saves it */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-13 text-slate-600">
        <span><b className="text-slate-900 tabular-nums">{d.mapped}/{d.keywords}</b> keywords have a page</span>
        <span><b className="text-slate-900 tabular-nums">{d.primaries}/{d.pages.length}</b> pages have a main keyword</span>
        <span><b className="text-slate-900 tabular-nums">{todo.length}</b> to create</span>
        <span className="ml-auto flex flex-wrap items-center gap-3">
          {waiting > 0 ? <span className="text-amber-700 text-12.5">{waiting} suggestion{waiting === 1 ? '' : 's'} not saved yet</span> : d.primaries > 0 ? <span className="text-emerald-700 text-12.5 inline-flex items-center gap-1"><CheckCircle2 size={14} />All saved</span> : null}
          <Button variant="primary" icon={CheckCircle2} busy={busy === 'apply'} disabled={waiting === 0} onClick={save} title="Writes the page and the main or supporting role on each keyword. A page you chose yourself is never changed.">Save the mapping</Button>
        </span>
      </div>

      <Card pad={false} title="Your pages" subtitle={`The keyword each page should rank for, from the website scan of ${d.found_at || 'the last audit'}. The most searched keyword on a page is its main one.`}>
        <div className="overflow-x-auto">
          <table className="w-full text-13 min-w-[760px]">
            <thead className="bg-slate-50 text-11.5 uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left"><Head what="A page of your website." why="Click the address to open it." from="the last website scan (Website Audit).">Page</Head></th>
                <th className="px-3 py-2 text-left"><Head what="The keyword this page should rank for: the most searched keyword found on it." why="One main keyword per page keeps your pages from competing with each other." from="your saved keywords matched to the page title, heading and description from the website scan.">Main keyword</Head></th>
                <th className="px-3 py-2 text-right"><Head right what="Monthly searches for the main keyword." from="Google Ads Keyword Planner.">Searches / mo</Head></th>
                <th className="px-3 py-2 text-left"><Head what="Other saved keywords this page also covers." why="They support the main keyword.">Also on this page</Head></th>
                <th className="px-3 py-2 text-left"><Head what="Saved: written on the keywords already. Suggested: our proposal, not saved yet." why="Press Save the mapping to save the suggestions.">Status</Head></th>
                <th className="px-3 py-2 text-right"><Head right what="Things you can do for this page." why="Open the page, check its keyword, or find a keyword if it has none.">Actions</Head></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {d.pages.map(p => (
                <tr key={p.url} className="hover:bg-slate-50">
                  <td className="px-3 py-2.5 min-w-[200px] max-w-[300px]">
                    <a href={p.url} target="_blank" rel="noreferrer" className="font-semibold text-indigo-700 hover:underline inline-flex items-center gap-1 break-all">{p.path}<ExternalLink size={11} className="shrink-0" /></a>
                    <span className="block text-11.5 text-slate-400 truncate" title={p.title}>{p.title}</span>
                  </td>
                  <td className="px-3 py-2.5">{p.primary ? <Link to={`/keyword-overview?q=${encodeURIComponent(p.primary)}`} title="Check its searches and cost" className="font-semibold text-slate-900 hover:text-indigo-700 hover:underline">{p.primary}</Link> : <span className="text-slate-400">none</span>}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{n0(p.primary_volume)}</td>
                  <td className="px-3 py-2.5 text-12.5 text-slate-600 max-w-[260px]">{p.secondary.length ? <span title={p.secondary.join(', ')}>{p.secondary.slice(0, 2).join(', ')}{p.secondary.length > 2 ? ` +${p.secondary.length - 2}` : ''}</span> : <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {!p.primary ? <Link to={`/keyword-management/discover?q=${encodeURIComponent((p.title || p.path).split(/[|\-–:]/)[0].trim().slice(0, 40))}`} className="text-12.5 font-semibold text-amber-700 hover:underline">Find a keyword</Link>
                      : p.saved ? <span title="Written on the keyword: it is saved"><Badge tone="green">Saved</Badge></span> : <span title="Our proposal. Press Save the mapping to keep it"><Badge tone="amber">Suggested</Badge></span>}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <span className="inline-flex gap-1.5">
                      <a href={p.url} target="_blank" rel="noreferrer"><Act tip="Open this page on your website in a new tab.">Open</Act></a>
                      {p.primary ? <Link to={`/keyword-overview?q=${encodeURIComponent(p.primary)}`}><Act tip="Open the searches, cost and related ideas for its main keyword.">Check keyword</Act></Link>
                        : <Link to={`/keyword-management/discover?q=${encodeURIComponent((p.title || p.path).split(/[|\-–:]/)[0].trim().slice(0, 40))}`}><Act tip="Search for keywords this page could rank for." primary>Find a keyword</Act></Link>}
                    </span>
                  </td>
                </tr>))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card pad={false} title="Pages and posts to create" subtitle="Keywords no page carries. People who want to buy or book need a page; questions and guides fit a blog post.">
        {todo.length === 0 ? <p className="px-5 py-6 text-13 text-emerald-700 flex items-center gap-1.5"><CheckCircle2 size={15} />Every keyword has a page.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-13 min-w-[700px]">
              <thead className="bg-slate-50 text-11.5 uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left"><Head what="What to make: a page for people who want to buy or book, or a blog post for questions and guides." why="Keywords no page covers cannot rank.">Make a</Head></th>
                  <th className="px-3 py-2 text-left"><Head what="The saved keyword that has no page." from="your saved keywords compared with the website scan.">For the keyword</Head></th>
                  <th className="px-3 py-2 text-right"><Head right what="Monthly searches." from="Google Ads Keyword Planner.">Searches / mo</Head></th>
                  <th className="px-3 py-2 text-left"><Head what="A web address made from the keyword." why="Use it when you create the page.">Suggested address</Head></th>
                  <th className="px-3 py-2 text-right"><Head right what="Copy brief: a short note for whoever builds the page. Write: open the blog writer with this keyword ticked.">Actions</Head></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {todo.map(x => (
                  <tr key={`${x.type}-${x.keyword}`} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5"><Badge tone={x.type === 'page' ? 'blue' : 'violet'}>{x.type === 'page' ? 'Page' : 'Blog post'}</Badge></td>
                    <td className="px-3 py-2.5 font-semibold text-slate-900">{x.keyword}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{n0(x.volume)}</td>
                    <td className="px-3 py-2.5 text-12.5 text-slate-500 font-mono">{x.slug}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <span className="inline-flex gap-1.5">
                        <Button size="sm" icon={Copy} onClick={() => copy(x, x.type)} title="Copies the title, address and what to put where, to send to whoever builds the page">Copy brief</Button>
                        <Link to={`/ai-content-generation/blog?keyword=${encodeURIComponent(x.keyword)}`}><Button size="sm" variant={x.type === 'post' ? 'primary' : undefined} icon={PenLine}>Write {x.type === 'post' ? 'the post' : 'it as a post'}</Button></Link>
                      </span>
                    </td>
                  </tr>))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-3 text-13 text-slate-600">
        <span>Next: see how the keywords rank.</span>
        <Link to="/keyword-management/status"><Button size="sm" icon={ArrowRight}>Keyword Status</Button></Link>
        <Link to="/keyword-management/tracked"><Button size="sm">My Keywords</Button></Link>
      </div>
      {toastNode}
    </div>
  );
}
