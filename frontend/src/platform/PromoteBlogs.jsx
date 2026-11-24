import React, { useEffect, useMemo, useState } from 'react';
import { Megaphone, Search as SearchIcon, ExternalLink, FileText, CheckCircle2, ArrowRight } from 'lucide-react';
import { Card, Button, ErrorNote, SkList } from './SeoUi';
import { useApi, fmtDateTime } from './seoApi';
import { PromoteCard } from './BlogFlow';

const isLive = (a) => a.wp_status === 'publish' || a.react_status === 'publish' || a.publishing_status === 'published';
const urlOf = (a) => a.wp_url || a.react_url || '';

/**
 * "Promote & Track Links": one page for promoting the blogs that are live. Pick a blog on the left; on the right its promotion tools
 * (where competitors post, the top blogging platforms, your promotion plan and the link checks). The tools are the same PromoteCard
 * that used to sit under the article in the writer: nothing about how promotion works has changed, only where it is.
 */
export default function PromoteBlogs({ b, onShowPosted }) {
  const list = useApi(`/businesses/${b.id}/articles`);
  const [q, setQ] = useState('');
  const live = useMemo(() => (list.data?.articles || []).filter(isLive)
    .sort((x, y) => String(y.wp_published_at || y.updated_at || '').localeCompare(String(x.wp_published_at || x.updated_at || ''))), [list.data]);
  const shown = live.filter(a => !q.trim() || `${a.title || ''} ${a.keyword || ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  const [picked, setPicked] = useState(() => Number(new URLSearchParams(window.location.search).get('article')) || null); // ?article=ID opens that blog
  useEffect(() => { if (live.length && !live.some(a => a.id === picked)) setPicked(live[0].id); }, [live]); // eslint-disable-line react-hooks/exhaustive-deps
  const article = live.find(a => a.id === picked);

  if (list.error) return <ErrorNote>{list.error.message || String(list.error)}</ErrorNote>;
  if (!list.data) return <SkList rows={4} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 p-4 rounded-2xl bg-gradient-to-r from-indigo-50 via-white to-violet-50 ring-1 ring-inset ring-slate-200">
        <span className="h-11 w-11 shrink-0 rounded-2xl bg-indigo-600 text-white inline-flex items-center justify-center shadow-sm"><Megaphone size={20} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-16 font-semibold text-slate-900">Promote your blogs and track the links</h2>
          <p className="text-12.5 text-slate-500 max-w-3xl">Pick a live blog. See where your competitors post, the best blogging platforms for your business, and your promotion plan: write a short overview, post it yourself, then paste your post's address so the link is checked.</p>
        </div>
        <ol className="hidden lg:flex items-center gap-2 text-[11.5px] text-slate-600">
          {['Pick a blog', 'Choose places', 'Post the overview', 'Check the link'].map((s, i) => (
            <li key={s} className="flex items-center gap-2"><span className="h-5 w-5 rounded-full bg-white ring-1 ring-slate-300 text-[10px] font-bold inline-flex items-center justify-center">{i + 1}</span>{s}{i < 3 && <ArrowRight size={12} className="text-slate-300" />}</li>
          ))}
        </ol>
      </div>

      {!live.length ? (
        <Card>
          <div className="py-10 text-center grid gap-2 justify-items-center">
            <span className="h-11 w-11 rounded-full bg-slate-100 text-slate-500 inline-flex items-center justify-center"><FileText size={20} /></span>
            <p className="text-14 font-semibold text-slate-800">No live blogs yet</p>
            <p className="text-13 text-slate-500 max-w-md">A blog can be promoted once it is published on your website. Publish one, or add a blog that is already live, in Posted Blogs.</p>
            {onShowPosted && <Button variant="primary" onClick={onShowPosted}>Go to Posted Blogs</Button>}
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[300px_minmax(0,1fr)] gap-4 items-start">
          <aside className="rounded-2xl bg-white ring-1 ring-inset ring-slate-200 p-3 space-y-2 xl:sticky xl:top-4" aria-label="Live blogs">
            <div className="flex items-center justify-between px-1"><span className="text-[12px] font-bold text-slate-800">Live blogs</span><span className="text-[11px] text-slate-500">{live.length}</span></div>
            <label className="relative block"><SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search blogs" aria-label="Search blogs" className="w-full h-9 pl-9 pr-3 text-13 bg-white ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 rounded-lg outline-none" />
            </label>
            <ul className="max-h-[70vh] overflow-y-auto space-y-1 pr-0.5">
              {shown.map(a => (
                <li key={a.id}>
                  <button type="button" onClick={() => setPicked(a.id)} aria-pressed={a.id === picked}
                    className={`w-full text-left rounded-xl px-3 py-2.5 transition-colors cursor-pointer ${a.id === picked ? 'bg-indigo-600 text-white shadow-sm' : 'hover:bg-slate-50 text-slate-800'}`}>
                    <div className="text-[12.5px] font-semibold leading-snug line-clamp-2">{a.title || a.keyword}</div>
                    <div className={`mt-1 flex items-center gap-1.5 text-[11px] ${a.id === picked ? 'text-indigo-100' : 'text-slate-500'}`}>
                      <CheckCircle2 size={11} />Live{(a.wp_published_at || a.updated_at) ? ` · ${fmtDateTime(a.wp_published_at || a.updated_at)}` : ''}
                    </div>
                  </button>
                </li>
              ))}
              {!shown.length && <li className="px-3 py-4 text-[12px] text-slate-500 text-center">No blog matches “{q}”.</li>}
            </ul>
          </aside>

          <div className="min-w-0 space-y-3">
            {article && (
              <>
                <div className="flex flex-wrap items-center gap-2 px-1">
                  <span className="text-[14px] font-bold text-slate-900 truncate">{article.title || article.keyword}</span>
                  {urlOf(article) && <a href={urlOf(article)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-indigo-700 hover:underline"><ExternalLink size={12} />Open the blog</a>}
                </div>
                <PromoteCard key={article.id} b={b} article={article} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
