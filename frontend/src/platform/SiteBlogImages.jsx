import React, { useEffect, useState } from 'react';
import { Image as ImageIcon, AlertTriangle, CheckCircle2, ChevronDown, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from './SeoUi';
import { api } from './seoApi';

/**
 * Your website's blog images (read only): opens the /blog page and every post (or, for a React.js website, its blog API,
 * which holds what the pages draw) and shows each post's featured, article, gallery and social images: size, dimensions,
 * where each sits. Runs by itself when the step opens; "Check again" refreshes. An image that cannot be read is shown as
 * unavailable, never counted as missing.
 */

const fmtSize = (n) => (n == null ? '—' : n === 0 ? '0 KB' : n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const dimsOf = (x) => (x?.width ? `${x.width} × ${x.height}` : '');
const KIND_CLS = { Featured: 'bg-indigo-100 text-indigo-700', Content: 'bg-slate-100 text-slate-700', Gallery: 'bg-amber-100 text-amber-800', Social: 'bg-sky-100 text-sky-800' };
const cacheKey = (b, a) => `growzen.siteImages.${b.id}.${a.id}`;

export default function SiteBlogImages({ b, article, mine, limitMb }) {
  const [data, setData] = useState(() => { try { return JSON.parse(sessionStorage.getItem(cacheKey(b, article)) || 'null'); } catch { return null; } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null); // post index shown in detail
  const run = () => {
    setBusy(true); setError('');
    api(`/businesses/${b.id}/blog-flow/images?article_id=${article.id}`)
      .then(d => { setData(d); try { sessionStorage.setItem(cacheKey(b, article), JSON.stringify(d)); } catch { /* too big to keep: checked again next time */ } })
      .catch(e => setError(e.message || String(e))).finally(() => setBusy(false));
  };
  useEffect(() => { if (!data) run(); }, [b.id, article.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const ok = data?.state === 'ok';
  const f = data?.featured, c = data?.content, g = data?.gallery, s = data?.social, t = data?.total;
  const tips = [];
  if (ok) {
    if (f?.count) tips.push({ ok: mine.featured != null, text: mine.featured != null
      ? `Featured image: yours is ${fmtSize(mine.featured)}${mine.featuredDims ? ` (${mine.featuredDims} px)` : ''}; your posts use about ${fmtSize(f.avg_bytes)}${f.typical ? ` at ${f.typical} px` : ''}.`
      : `Your posts show a featured image (about ${fmtSize(f.avg_bytes)}${f.typical ? `, ${f.typical} px` : ''}). This blog has none yet: add one on the AI Draft step.` });
    tips.push({ ok: true, text: c?.count
      ? `Article images: ${c.posts_with} of ${data.posts_checked} posts have pictures inside the text (${c.count} in all, ${c.typical ? `typically ${c.typical} px, ` : ''}about ${fmtSize(c.avg_bytes)} each). This blog has ${mine.content}.`
      : `Article images: none of your ${data.posts_checked} posts has a picture inside the text. This blog has ${mine.content}.` });
    if (g?.count) tips.push({ ok: true, text: `Galleries / side-by-side: ${g.posts_with} post${g.posts_with === 1 ? '' : 's'} (${g.count} images). This blog has ${mine.gallery}.` });
    if (data.same_featured_on > 1) tips.push({ ok: false, text: `${data.same_featured_on} of your posts use the same featured image. Give each blog its own picture.` });
    if (t?.unavailable) tips.push({ ok: false, text: `${t.unavailable} image${t.unavailable === 1 ? '' : 's'} on your blog cannot be loaded (broken on the website). Open “View details” to see which.` });
    if (t?.max_bytes) tips.push({ ok: t.max_bytes <= limitMb * 1048576, text: `Largest image on your blog: ${fmtSize(t.max_bytes)} (limit per image here: ${limitMb} MB).` });
  }
  const box = (label, sum, extra) => (
    <div key={label} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[11.5px]">
      <div className="font-semibold uppercase tracking-wider text-[10.5px] text-slate-500">{label}</div>
      <div className="text-slate-900"><b className="text-[17px] tabular-nums">{sum?.count ?? 0}</b> <span className="text-slate-500">· {fmtSize(sum?.total_bytes)}</span></div>
      <div className="text-slate-500 truncate">{extra}{sum?.unavailable ? <span className="text-rose-700"> · {sum.unavailable} unavailable</span> : null}</div>
    </div>
  );

  return (
    <div className="rounded-xl border border-slate-200 p-3.5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[220px]">
          <div className="text-[12.5px] font-bold text-slate-900">Your website’s blog images</div>
          <div className="text-[11.5px] text-slate-500">Read from your /blog page and every post on it: how many pictures each post has, where they sit and how big they are.</div>
        </div>
        <Button size="sm" icon={busy ? Loader2 : RefreshCw} busy={busy} onClick={run}>{busy ? 'Checking…' : 'Check again'}</Button>
      </div>
      {busy && !data && <div className="text-[12px] text-slate-500 inline-flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Opening your blog and measuring its images…</div>}
      {error && <p className="text-[11.5px] text-rose-700">{error}</p>}
      {data && !ok && <div className="text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{data.message || 'The blog could not be read.'}</div>}
      {ok && (
        <>
          <div className="text-[11.5px] text-slate-500">
            {data.posts_checked} post{data.posts_checked === 1 ? '' : 's'} checked · {t?.count ?? 0} images ({t?.distinct ?? 0} different files) · {fmtSize(t?.total_bytes)} in all
            {data.source === 'api' ? ' · read from your website’s blog API (its pages are built in the browser)' : ''}
            {data.listing_url && <> · <a href={data.listing_url} target="_blank" rel="noreferrer" className="text-indigo-600 underline">{data.listing_url}</a></>}
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {box('Featured', f, f?.typical ? `${f.typical} px` : '')}
            {box('Article images', c, `${c?.per_post ?? 0} per post`)}
            {box('Gallery / side by side', g, g?.posts_with ? `${g.posts_with} post${g.posts_with === 1 ? '' : 's'}` : 'none')}
            {box('Social sharing', s, s?.count ? '' : 'same as featured or none')}
          </div>
          <ul className="space-y-1 text-[12px]">
            {tips.map((x, i) => (
              <li key={i} className={`flex items-start gap-1.5 ${x.ok ? 'text-slate-700' : 'text-amber-800'}`}>
                {x.ok ? <CheckCircle2 size={13} className="text-emerald-600 shrink-0 mt-0.5" /> : <AlertTriangle size={13} className="shrink-0 mt-0.5" />}{x.text}
              </li>
            ))}
          </ul>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-[11.5px]">
            {data.posts.map((p, i) => {
              const all = [p.featured, p.social, ...p.content].filter(Boolean);
              const bad = all.filter(x => x.error).length;
              return (
                <li key={i}>
                  <button type="button" onClick={() => setOpen(o => (o === i ? null : i))} className="w-full flex flex-wrap items-center gap-2 p-2.5 text-left cursor-pointer hover:bg-slate-50">
                    <span className="font-semibold text-slate-900 truncate flex-1 min-w-[200px]">{p.title}</span>
                    <span className="text-slate-500 tabular-nums">
                      {p.featured ? '1 featured' : 'no featured'} · {p.content.filter(x => x.kind === 'Content').length} article · {p.content.filter(x => x.kind === 'Gallery').length} gallery · {fmtSize(p.total_bytes)}
                    </span>
                    {bad > 0 && <span className="text-rose-700 font-semibold">{bad} unavailable</span>}
                    {p.read === false && <span className="text-amber-700">{p.error || 'post could not be read'}</span>}
                    <span className="text-indigo-600 font-semibold inline-flex items-center gap-0.5">View details <ChevronDown size={12} className={open === i ? 'rotate-180' : ''} /></span>
                  </button>
                  {open === i && (
                    <div className="px-2.5 pb-3 space-y-2">
                      {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="text-indigo-600 underline break-all">{p.url}</a>}
                      {p.social_same_as_featured && <div className="text-slate-500">The social sharing image is the featured image.</div>}
                      {!all.length && <div className="text-slate-500">This post has no images.</div>}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {all.map((x, j) => (
                          <div key={j} className={`flex gap-2.5 p-2 rounded-lg border ${x.error ? 'border-rose-200 bg-rose-50/50' : 'border-slate-200'}`}>
                            <div className="w-24 aspect-[16/10] shrink-0 rounded-md overflow-hidden bg-slate-100 flex items-center justify-center">
                              {x.preview && !x.error ? <img src={x.preview} alt={x.alt || x.name} loading="lazy" className="w-full h-full object-cover" /> : <ImageIcon size={16} className="text-slate-400" />}
                            </div>
                            <div className="min-w-0 space-y-0.5">
                              <div className="flex items-center gap-1.5"><span className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${KIND_CLS[x.kind] || KIND_CLS.Content}`}>{x.kind}</span><span className="truncate text-slate-800 font-medium" title={x.preview || x.name}>{x.name}</span></div>
                              {x.error ? <div className="text-rose-700">{x.error}</div>
                                : <div className="text-slate-600 tabular-nums">{fmtSize(x.bytes)}{dimsOf(x) ? ` · ${dimsOf(x)} px` : ''}{x.format ? ` · ${x.format}` : ''}{x.inline ? ' · stored inside the post' : ''}</div>}
                              {x.placement && <div className="text-slate-500">{x.placement}</div>}
                              {x.kind !== 'Social' && <div className={x.alt ? 'text-slate-500 truncate' : 'text-amber-700'}>{x.alt ? `ALT: ${x.alt}` : 'No ALT text'}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
