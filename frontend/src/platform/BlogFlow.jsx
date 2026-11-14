import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Sparkles, CheckCircle2, AlertTriangle, Copy, RefreshCw, Plus, Layout, Megaphone, ArrowRight, FileText } from 'lucide-react';
import { Card, Button, Badge, Stat, ErrorNote, useAction, useToast, SkList, inputCls } from './SeoUi';
import { api, useApi } from './seoApi';
import Tip from './Tip';

const n0 = (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN'));

/** Step 1 and 2: the keywords this project tracks, then topics written for the ones you pick. */
export function KeywordTopicPlanner({ b, onPick }) {
  const base = `/businesses/${b.id}/blog-flow`;
  const kws = useApi(`${base}/keywords`);
  const memKey = `growzen.blogplan.${b.id}`;
  const mem = (() => { try { return JSON.parse(localStorage.getItem(memKey) || 'null') || {}; } catch { return {}; } })();
  const [picked, setPicked] = useState(Array.isArray(mem.picked) ? mem.picked : []);
  const [res, setRes] = useState(mem.res || null);
  useEffect(() => { try { localStorage.setItem(memKey, JSON.stringify({ picked, res })); } catch { /* not remembered */ } }, [picked, res, memKey]);
  const [busy, error, run] = useAction();
  const list = kws.data?.keywords || [];
  const toggle = (k) => setPicked(p => (p.includes(k) ? p.filter(x => x !== k) : p.length >= 4 ? p : [...p, k]));
  const ask = () => run('topics', async () => setRes(await api(`${base}/topics`, { method: 'POST', body: { keywords: picked } })));
  return (
    <Card title="1. Choose the keywords this blog is for" subtitle="Your tracked keywords. Pick up to 4: the topics below are written for them, and the article will use them."
      action={<Link to="/keyword-management/tracked"><Button size="sm">My Keywords</Button></Link>}>
      {!kws.data && !kws.error && <SkList rows={3} />}
      {kws.error && <ErrorNote>{kws.error.message}</ErrorNote>}
      {kws.data && !list.length && <p className="text-13 text-slate-500">No keywords are tracked yet. Add them on <Link to="/keyword-management/ai" className="text-indigo-600 hover:underline">Find Keywords</Link>, then come back; or write from your own topic below.</p>}
      {list.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {list.map(k => {
            const on = picked.includes(k.keyword);
            return (
              <button key={k.keyword} type="button" aria-pressed={on} onClick={() => toggle(k.keyword)}
                className={`inline-flex items-center gap-2 h-9 px-3 rounded-full text-13 cursor-pointer ring-1 ring-inset ${on ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}>
                <span className="font-semibold">{k.keyword}</span>
                <span className={`text-11.5 ${on ? 'text-indigo-100' : 'text-slate-400'}`}>{k.volume != null ? `${n0(k.volume)}/mo` : 'no volume'}</span>
                {k.used > 0 && <Tip text={`Already used in ${k.used} article${k.used > 1 ? 's' : ''}`}><span className={`text-11 rounded-full px-1.5 ${on ? 'bg-white/20' : 'bg-amber-50 text-amber-700'}`}>used {k.used}</span></Tip>}
              </button>
            );
          })}
        </div>
      )}
      {list.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="primary" icon={Sparkles} busy={busy === 'topics'} disabled={!picked.length} onClick={ask}>Suggest topics for {picked.length || 'the'} selected keyword{picked.length === 1 ? '' : 's'}</Button>
          <span className="text-12 text-slate-500">{picked.length ? `${picked.length} of 4 selected` : 'Select at least one keyword.'}</span>
        </div>
      )}
      <ErrorNote>{error}</ErrorNote>
      {res && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <p className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-2">2. Pick a topic {res.method === 'ai' ? '(written by AI for your business)' : '(standard patterns: add an AI key for topics written for your business)'}</p>
          {res.topics.length === 0 ? <p className="text-13 text-slate-500">Nothing new to suggest: every idea already has an article.</p> : (
            <div className="grid gap-3 md:grid-cols-2">
              {res.topics.map((t, i) => (
                <div key={i} className="rounded-lg ring-1 ring-inset ring-slate-200 p-3 grid gap-1.5 text-13">
                  <div className="font-semibold text-slate-900">{t.title}</div>
                  <div className="flex flex-wrap gap-1.5"><Badge tone="blue">{t.keyword}</Badge><Badge tone="gray">{t.intent}</Badge></div>
                  <p className="text-slate-600">{t.angle}</p>
                  <p className="text-slate-500"><span className="font-semibold">Why:</span> {t.why}</p>
                  <div className="pt-1"><Button size="sm" variant="primary" onClick={() => onPick({ title: t.title, selected: [...new Set([t.keyword, ...picked])], related: [] })}>Write this blog</Button></div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

const stageOf = (x) => {
  if (x.status === 'failed') return { label: 'Writing failed', tone: 'red', next: 'Open it and write it again' };
  if (x.status !== 'completed') return { label: 'Being written', tone: 'blue', next: 'Wait for it to finish' };
  const ps = x.publishing_status;
  if (ps === 'published') return { label: 'Published', tone: 'green', next: 'Promote it and check the links' };
  if (ps === 'scheduled' || ps === 'publishing') return { label: 'Scheduled', tone: 'amber', next: 'Check the layout, then wait for it to go live' };
  return { label: 'Draft saved', tone: 'gray', next: 'Review, check the layout, then schedule or publish' };
};

/** Where you stopped: the articles that are not finished (drafts, scheduled, just published and not yet promoted), each with its next step. */
export function ResumeCard({ articles, onOpen }) {
  const rows = [...articles].filter(x => x.status !== 'completed' || x.publishing_status !== 'published' || (x.wp_url || x.react_url))
    .sort((a, c) => String(c.updated_at || c.created_at).localeCompare(String(a.updated_at || a.created_at))).slice(0, 5);
  if (!rows.length) return null;
  const open = rows.filter(x => !(x.status === 'completed' && x.publishing_status === 'published'));
  const [first, ...rest] = rows;
  return (
    <Card title="Continue where you stopped" subtitle="Every blog you generated is saved as a draft. Open one to carry on from its next step.">
      <div className="grid gap-2">
        {[first, ...rest].map((x, i) => { const st = stageOf(x); return (
          <div key={x.id} className={`flex flex-wrap items-center gap-3 rounded-lg px-3 py-2.5 ring-1 ring-inset ${i === 0 ? 'ring-indigo-200 bg-indigo-50/40' : 'ring-slate-200'}`}>
            <FileText size={16} className="text-slate-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-13 font-semibold text-slate-900 truncate">{x.title || x.topic || x.keyword}</div>
              <div className="text-12 text-slate-500 truncate">{x.keyword} · next: {st.next}</div>
            </div>
            <Badge tone={st.tone}>{st.label}</Badge>
            <Button size="sm" variant={i === 0 ? 'primary' : 'secondary'} icon={ArrowRight} disabled={x.status === 'generating' || x.status === 'pending'} onClick={() => onOpen(x.id)}>{i === 0 ? 'Continue' : 'Open'}</Button>
          </div>); })}
      </div>
      {open.length === 0 && <p className="mt-2 text-12 text-slate-500">All finished. Open a published one to promote it.</p>}
    </Card>
  );
}

const Check = ({ ok }) => (ok === true ? <CheckCircle2 size={15} className="text-emerald-600 shrink-0 mt-0.5" /> : ok === false ? <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" /> : <span className="w-[15px]" />);

/** Compare the article with how the website's own blog is built (read from the live site). */
export function LayoutCheckCard({ b, article }) {
  const [d, setD] = useState(null);
  const [busy, error, run] = useAction();
  const go = () => run('layout', async () => setD(await api(`/businesses/${b.id}/blog-flow/layout${article ? `?article_id=${article.id}` : ''}`)));
  return (
    <Card title="Check the layout of your website's blog" subtitle="Opens your blog page and one of your posts, and compares this article with them. Read only."
      action={<Button size="sm" icon={Layout} busy={busy === 'layout'} onClick={go}>{d ? 'Check again' : 'Check my blog layout'}</Button>}>
      <ErrorNote>{error}</ErrorNote>
      {!d && <p className="text-13 text-slate-500">See how your blog page lists posts and what a post on your site contains (image, headings, FAQ, call to action), then fix what this article lacks before you schedule it.</p>}
      {d && d.state !== 'ok' && <p className="text-13 text-amber-800">{d.message}</p>}
      {d?.state === 'ok' && (
        <div className="grid gap-4 text-13">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Posts on your blog page" value={d.listing.posts_found} />
            <Stat label="Typical post length" value={`${n0(d.post?.words)} words`} />
            <Stat label="Headings (H2 / H3)" value={`${d.post?.h2} / ${d.post?.h3}`} />
            <Stat label="Images" value={d.post?.images} />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-12.5 text-slate-600">
            <a href={d.listing_url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline inline-flex items-center gap-1">Blog page<ExternalLink size={11} /></a>
            {d.sample_post && <a href={d.sample_post} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline inline-flex items-center gap-1">Post checked<ExternalLink size={11} /></a>}
            <span>Cards show: {d.listing.cards_with_image ? 'image' : 'no image'}, {d.listing.cards_with_date ? 'date' : 'no date'}, {d.listing.cards_with_excerpt ? 'excerpt' : 'no excerpt'}</span>
          </div>
          {d.fit.length > 0 && (
            <ul className="grid gap-2">
              {d.fit.map((f, i) => <li key={i} className="flex gap-2"><Check ok={f.ok} /><span><span className={f.ok === false ? 'font-semibold text-slate-900' : 'text-slate-700'}>{f.label}</span><span className="block text-12 text-slate-500">{f.detail}</span></span></li>)}
            </ul>
          )}
          {!article && <p className="text-12 text-slate-500">Open an article to see how it compares.</p>}
          <p className="text-12 text-slate-500">{d.note}</p>
        </div>
      )}
    </Card>
  );
}

const ST = { planned: ['To do', 'gray'], posted: ['Posted', 'blue'], verified: ['Link confirmed', 'green'], problem: ['Link not found', 'red'], skipped: ['Skipped', 'gray'] };

function PlatformRow({ b, article, p, reload }) {
  const base = `/businesses/${b.id}/blog-flow/promo/${article.id}/${p.id}`;
  const [open, setOpen] = useState(false);
  const [ov, setOv] = useState(null);
  const [url, setUrl] = useState(p.posted_url || '');
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const [st, tone] = ST[p.status] || ST.planned;
  const write = (refresh = false) => run('ov', async () => { setOv((await api(`${base}/overview`, { method: 'POST', body: { refresh } })).overview); setOpen(true); });
  const copy = () => { try { navigator.clipboard.writeText(ov.text + (ov.hashtags?.length ? `\n\n${ov.hashtags.join(' ')}` : '')); toast('Copied'); } catch { toast('Select the text and copy it'); } };
  const posted = () => run('posted', async () => { await api(`${base}/posted`, { method: 'POST', body: { url } }); reload(true); });
  const recheck = () => run('check', async () => { await api(`${base}/check`, { method: 'POST' }); reload(true); });
  const skip = (status) => run('skip', async () => { await api(`${base}/status`, { method: 'POST', body: { status } }); reload(true); });
  return (
    <div className="rounded-lg ring-1 ring-inset ring-slate-200 p-3 grid gap-2 text-13">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-900">{p.name}</span><Badge tone={tone}>{st}</Badge>
        {p.link_note && <Tip text={p.link_note} wide><span className="text-12 text-slate-400 underline decoration-dotted cursor-help">about the link</span></Tip>}
        <span className="ml-auto flex gap-2">
          {p.status !== 'skipped' && <Button size="sm" variant={ov || p.status !== 'planned' ? 'secondary' : 'primary'} icon={Sparkles} busy={busy === 'ov'} onClick={() => (open ? setOpen(false) : write(false))}>{open ? 'Hide overview' : 'Write the overview'}</Button>}
          {p.status === 'skipped' ? <Button size="sm" onClick={() => skip('planned')}>Undo skip</Button> : p.status === 'planned' && <Button size="sm" onClick={() => skip('skipped')}>Skip</Button>}
        </span>
      </div>
      {p.gives && <p className="text-12.5 text-slate-600">{p.gives}</p>}
      {open && ov && (
        <div className="grid gap-2">
          <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 ring-1 ring-inset ring-slate-200 p-3 text-12.5 text-slate-700 font-sans">{ov.text}{ov.hashtags?.length ? `\n\n${ov.hashtags.join(' ')}` : ''}</pre>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" icon={Copy} onClick={copy}>Copy</Button>
            {p.open_url && (p.internal ? <Link to={p.open_url}><Button size="sm" variant="primary" icon={ExternalLink}>Open Posts</Button></Link>
              : <a href={p.open_url} target="_blank" rel="noreferrer"><Button size="sm" variant="primary" icon={ExternalLink}>Open {p.name}</Button></a>)}
            <button type="button" onClick={() => write(true)} className="text-12 text-slate-500 hover:underline cursor-pointer">Write it again</button>
            <Badge tone={ov.method === 'ai' ? 'blue' : 'gray'}>{ov.method === 'ai' ? 'Written by AI' : 'From the article'}</Badge>
          </div>
          {!p.internal && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <input value={url} onChange={e => setUrl(e.target.value)} placeholder="Paste the address of your post here" aria-label={`Address of your post on ${p.name}`} className={`${inputCls} !w-80`} />
              <Button size="sm" variant="primary" busy={busy === 'posted'} disabled={url.trim().length < 6} onClick={posted}>I posted it: check the link</Button>
            </div>
          )}
        </div>
      )}
      {p.status !== 'planned' && p.status !== 'skipped' && p.posted_url && (
        <div className="flex flex-wrap items-center gap-2 text-12.5">
          <a href={p.posted_url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline inline-flex items-center gap-1 max-w-[320px]"><span className="truncate">{p.posted_url}</span><ExternalLink size={11} className="shrink-0" /></a>
          {p.check && <span className="text-slate-600">{p.check.state === 'working' ? `Link found${p.check.follow ? `, ${p.check.follow === 'dofollow' ? 'follow' : p.check.follow}` : ''}${p.check.anchor ? `, anchor “${p.check.anchor}”` : ''}` : p.check.state === 'link_missing' ? 'The page opens but has no link to your blog.' : p.check.state === 'unconfirmed' ? 'Could not confirm: the site blocks checks.' : (p.check.error || 'The page could not be opened.')}</span>}
          <Button size="sm" icon={RefreshCw} busy={busy === 'check'} onClick={recheck}>Check again</Button>
        </div>
      )}
      <ErrorNote>{error}</ErrorNote>
      {toastNode}
    </div>
  );
}

/** After publishing: where to promote the blog, an overview for each place with the blog's link, and the check that the posted link is there. */
export function PromoteCard({ b, article }) {
  const base = `/businesses/${b.id}/blog-flow/promo/${article.id}`;
  const r = useApi(base);
  const [name, setName] = useState('');
  const [site, setSite] = useState('');
  const [busy, error, run] = useAction();
  const [ask, setAsk] = useState(false);
  const d = r.data;
  useEffect(() => { r.reload(true); }, [article.id, article.wp_url, article.react_url]); // eslint-disable-line react-hooks/exhaustive-deps
  if (r.error) return <Card><ErrorNote>{r.error.message}</ErrorNote></Card>;
  if (!d) return <SkList rows={3} />;
  const add = () => run('add', async () => { await api(`${base}/add`, { method: 'POST', body: { name, url: site || null } }); setName(''); setSite(''); setAsk(false); r.reload(true); });
  const all = () => run('all', async () => { await api(`${base}/check-all`, { method: 'POST' }); r.reload(true); });
  const c = d.counts;
  return (
    <Card title="Promote this blog and track the links" subtitle="After it is published: post a short overview with the blog's link on other platforms, then the software checks that each link is really there."
      action={d.published && <Button size="sm" icon={RefreshCw} busy={busy === 'all'} onClick={all}>Check all links</Button>}>
      {!d.published && <p className="text-13 text-slate-600"><Megaphone size={14} className="inline mr-1" />This blog is not published yet. Publish it (or schedule it) first: the places to promote it, and an overview with its real link, appear here once it is live.</p>}
      {d.published && (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3"><Stat label="Platforms" value={d.items.length} /><Stat label="Posted" value={c.posted + c.verified + c.problem} /><Stat label="Links confirmed" value={c.verified} /><Stat label="Link not found" value={c.problem} /></div>
          <p className="text-12.5 text-slate-600">Blog: <a href={d.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline inline-flex items-center gap-1">{d.url}<ExternalLink size={11} /></a>. Posting is done by you, on your own accounts: nothing is posted for you. Most social links are nofollow: they bring visitors, not ranking value.</p>
          <ErrorNote>{error}</ErrorNote>
          <div className="grid gap-3">{d.items.map(p => <PlatformRow key={p.id} b={b} article={article} p={p} reload={r.reload} />)}</div>
          {ask ? (
            <div className="flex flex-wrap items-end gap-2">
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Site name, for example an industry forum" aria-label="Site name" className={`${inputCls} !w-64`} />
              <input value={site} onChange={e => setSite(e.target.value)} placeholder="Page to open (optional)" aria-label="Page to open" className={`${inputCls} !w-64`} />
              <Button size="sm" variant="primary" busy={busy === 'add'} disabled={name.trim().length < 2} onClick={add}>Add</Button>
              <Button size="sm" onClick={() => setAsk(false)}>Cancel</Button>
            </div>
          ) : <div><Button size="sm" icon={Plus} onClick={() => setAsk(true)}>Add another platform</Button> <Link to="/backlinks/opportunities" className="text-12.5 text-indigo-600 hover:underline ml-2">Find more places for links</Link></div>}
        </div>
      )}
    </Card>
  );
}

/** Where the article is in the flow, from the first keyword to the confirmed link. */
export function FlowSteps({ step }) {
  const steps = ['Keywords', 'Topic', 'Write', 'Layout', 'Schedule', 'Publish', 'Promote', 'Link check'];
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-12">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span className={`inline-flex items-center justify-center h-5 min-w-[20px] px-1 rounded-full font-semibold ${i < step ? 'bg-emerald-100 text-emerald-700' : i === step ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'}`}>{i < step ? '✓' : i + 1}</span>
          <span className={i === step ? 'font-semibold text-slate-900' : 'text-slate-500'}>{s}</span>
          {i < steps.length - 1 && <span className="text-slate-300">›</span>}
        </li>
      ))}
    </ol>
  );
}
