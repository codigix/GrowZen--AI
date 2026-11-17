import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ExternalLink, FilePlus2, PenLine } from 'lucide-react';
import { Card, Button, Badge, ErrorNote, SkList, useAction, useToast } from './SeoUi';
import { api, useApi } from './seoApi';

const n0 = (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN'));

export default function KeywordMappingTab({ b }) {
  const r = useApi(`/businesses/${b.id}/keyword-mapping`);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const d = r.data;
  if (r.error) return <Card><ErrorNote>{r.error.message}</ErrorNote></Card>;
  if (!d) return <SkList rows={6} />;
  const save = () => run('apply', async () => { const out = await api(`/businesses/${b.id}/keyword-mapping/apply`, { method: 'POST' }); r.setData(out); toast(`Saved: ${out.primaries} page${out.primaries === 1 ? '' : 's'} with a primary keyword`); });
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      {!d.keywords ? (
        <Card><p className="py-8 text-center text-13 text-slate-500">No keywords are saved yet. Pick some in the <Link to="/keyword-management/workspace" className="font-semibold text-indigo-700 hover:underline">Keyword Workspace</Link> first.</p></Card>
      ) : !d.crawled ? (
        <Card><p className="py-8 text-center text-13 text-slate-500">The website has not been scanned yet, so there are no pages to map to. <Link to="/website-audit" className="font-semibold text-indigo-700 hover:underline">Run the Website Audit</Link>, then come back.</p></Card>
      ) : (
        <>
          <Card title="Keyword mapping" subtitle="Each keyword goes to the page that says it in its title, heading or description. The most searched keyword of a page is its primary one."
            action={<Button size="sm" variant="primary" icon={CheckCircle2} busy={busy === 'apply'} onClick={save}>Save the mapping</Button>}>
            <ErrorNote>{error}</ErrorNote>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-13">
              {[['Keywords', d.keywords], ['Have a page', `${d.mapped}/${d.keywords}`], ['Pages with a primary keyword', `${d.primaries}/${d.pages.length}`], ['Missing pages and posts', d.unmapped]].map(([l, v]) => (
                <div key={l} className="rounded-lg ring-1 ring-inset ring-slate-200 px-3 py-2.5"><div className="text-12 text-slate-500">{l}</div><div className="text-20 font-bold text-slate-900 tabular-nums">{v}</div></div>))}
            </div>
            <p className="mt-3 text-12 text-slate-500">Saving writes the page and the primary or secondary role on each keyword. A page you chose yourself is never changed.</p>
          </Card>

          <Card title="Page by page" subtitle={`From the website scan of ${d.found_at || 'the last audit'}`}>
            <div className="overflow-x-auto rounded-lg ring-1 ring-inset ring-slate-200">
              <table className="w-full text-13 min-w-[720px]">
                <thead className="bg-slate-50 text-11.5 uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2 text-left">Page</th><th className="px-3 py-2 text-left">Primary keyword</th><th className="px-3 py-2 text-right">Searches / mo</th><th className="px-3 py-2 text-left">Secondary keywords</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {d.pages.map(p => (
                    <tr key={p.url}>
                      <td className="px-3 py-2 max-w-[260px]"><a href={p.url} target="_blank" rel="noreferrer" className="font-semibold text-indigo-700 hover:underline inline-flex items-center gap-1 break-all">{p.path}<ExternalLink size={11} /></a><span className="block text-11.5 text-slate-400 truncate">{p.title}</span></td>
                      <td className="px-3 py-2">{p.primary ? <Link to={`/keyword-overview?q=${encodeURIComponent(p.primary)}`} className="font-semibold text-slate-900 hover:text-indigo-700 hover:underline">{p.primary}</Link> : <Badge tone="amber">No keyword yet</Badge>}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{n0(p.primary_volume)}</td>
                      <td className="px-3 py-2 text-12.5 text-slate-600">{p.secondary.join(', ') || <span className="text-slate-300">—</span>}</td>
                    </tr>))}
                </tbody>
              </table>
            </div>
            {d.pages_without_keyword > 0 && <p className="mt-2 text-12 text-slate-500">{d.pages_without_keyword} page{d.pages_without_keyword === 1 ? '' : 's'} carry none of your keywords. Either add a keyword to them in the Fix Plan, or they are pages that need no keyword (contact, privacy).</p>}
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Missing pages" subtitle="Keywords no page of the site carries, and that people search to buy or book.">
              {d.missing_pages.length === 0 ? <p className="py-3 text-13 text-emerald-700 flex items-center gap-1.5"><CheckCircle2 size={15} />Every service keyword has a page.</p> : (
                <ul className="divide-y divide-slate-100">{d.missing_pages.map(m => (
                  <li key={m.keyword} className="py-2.5 flex flex-wrap items-center gap-2 text-13"><FilePlus2 size={15} className="text-slate-400 shrink-0" />
                    <span className="min-w-0 flex-1"><span className="block font-semibold text-slate-900">{m.title}</span><span className="block text-12 text-slate-500">Suggested address {m.slug} · {n0(m.volume)} searches/mo</span></span></li>))}</ul>)}
            </Card>
            <Card title="Blog opportunities" subtitle="Questions and guides: better as a blog post than a service page."
              action={<Link to="/ai-content-generation/blog"><Button size="sm" icon={PenLine}>Write a post</Button></Link>}>
              {d.blog_opportunities.length === 0 ? <p className="py-3 text-13 text-emerald-700 flex items-center gap-1.5"><CheckCircle2 size={15} />No open post ideas.</p> : (
                <ul className="divide-y divide-slate-100">{d.blog_opportunities.map(m => (
                  <li key={m.keyword} className="py-2.5 flex items-center gap-2 text-13"><PenLine size={15} className="text-slate-400 shrink-0" />
                    <span className="min-w-0 flex-1"><span className="block font-semibold text-slate-900">{m.title}</span><span className="block text-12 text-slate-500">{n0(m.volume)} searches/mo</span></span></li>))}</ul>)}
            </Card>
          </div>
          <div className="flex flex-wrap gap-2"><Link to="/keyword-management/tracked"><Button icon={ArrowRight}>My Keywords</Button></Link><Link to="/keyword-management/status"><Button icon={ArrowRight}>Keyword Status</Button></Link></div>
        </>
      )}
      {toastNode}
    </div>
  );
}
