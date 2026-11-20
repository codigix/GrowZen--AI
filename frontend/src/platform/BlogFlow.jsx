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
  const fromUrl = new URLSearchParams(window.location.search).get('keyword'); // sent from Keyword Mapping: that keyword is already ticked
  const [picked, setPicked] = useState(fromUrl ? [fromUrl.toLowerCase()] : Array.isArray(mem.picked) ? mem.picked : []);
  const [res, setRes] = useState(mem.res || null);
  useEffect(() => { try { localStorage.setItem(memKey, JSON.stringify({ picked, res })); } catch { /* not remembered */ } }, [picked, res, memKey]);
  const [busy, error, run] = useAction();
  const [own, setOwn] = useState('');
  const [q, setQ] = useState('');
  const list = kws.data?.keywords || [];
  const shown = q.trim() ? list.filter(k => k.keyword.toLowerCase().includes(q.trim().toLowerCase())) : list;
  const toggle = (k) => setPicked(p => (p.includes(k) ? p.filter(x => x !== k) : p.length >= 4 ? p : [...p, k]));
  const ask = () => run('topics', async () => setRes(await api(`${base}/topics`, { method: 'POST', body: { keywords: picked } })));
  return (
    <Card title="Start a new blog" subtitle="Pick the keywords it is for and choose a topic, or type your own topic. The article is written from them."
      action={<Link to="/keyword-management/tracked"><Button size="sm">My Keywords</Button></Link>}>
      <div className="mb-5 rounded-xl bg-slate-50 ring-1 ring-inset ring-slate-200 p-3.5">
        <label className="block text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1.5" htmlFor="own-topic">I already know what to write about</label>
        <div className="flex flex-wrap gap-2">
          <input id="own-topic" value={own} onChange={e => setOwn(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && own.trim().length > 2) onPick({ title: own.trim(), selected: [], related: [] }); }} placeholder="For example: how much does a root canal cost in Pune" className={`${inputCls} flex-1 min-w-[260px]`} />
          <Button variant="primary" icon={ArrowRight} disabled={own.trim().length < 3} onClick={() => onPick({ title: own.trim(), selected: [], related: [] })}>Write this blog</Button>
        </div>
      </div>
      <p className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-2">Or choose from your keywords: tick up to 4</p>
      {!kws.data && !kws.error && <SkList rows={3} />}
      {kws.error && <ErrorNote>{kws.error.message}</ErrorNote>}
      {kws.data && !list.length && <p className="text-13 text-slate-500">No keywords are tracked yet. Add them on <Link to="/keyword-management/ai" className="text-indigo-600 hover:underline">Find Keywords</Link>, then come back; or write from your own topic below.</p>}
      {list.length > 0 && (
        <div className="rounded-xl ring-1 ring-inset ring-slate-200 overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${list.length} keywords`} aria-label="Search keywords" className={`${inputCls} !w-64`} />
            <span className="text-12 text-slate-500">{shown.length === list.length ? `${list.length} keywords` : `${shown.length} of ${list.length}`}</span>
            {picked.length > 0 && <button type="button" onClick={() => setPicked([])} className="ml-auto text-12 font-semibold text-indigo-600 hover:underline cursor-pointer">Clear {picked.length} selected</button>}
          </div>
          <div className="max-h-[340px] overflow-y-auto divide-y divide-slate-100" role="listbox" aria-multiselectable="true" aria-label="Keywords">
            <div className="grid grid-cols-[28px_minmax(0,1fr)_90px_70px_70px] gap-3 px-3 py-1.5 text-11.5 uppercase tracking-wide text-slate-400 sticky top-0 bg-white">
              <span /><span>Keyword</span><span className="text-right">Searches/mo</span><span className="text-right">Difficulty</span><span className="text-right">Rank</span>
            </div>
            {shown.map(k => {
              const on = picked.includes(k.keyword);
              const full = !on && picked.length >= 4;
              return (
                <button key={k.keyword} type="button" role="option" aria-selected={on} disabled={full} onClick={() => toggle(k.keyword)}
                  className={`w-full grid grid-cols-[28px_minmax(0,1fr)_90px_70px_70px] items-center gap-3 px-3 py-2 text-left text-13 cursor-pointer ${on ? 'bg-indigo-50' : 'hover:bg-slate-50'} ${full ? 'opacity-40 cursor-not-allowed' : ''}`}>
                  <span className={`h-[18px] w-[18px] rounded border inline-flex items-center justify-center text-white text-11 ${on ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 bg-white'}`}>{on ? '✓' : ''}</span>
                  <span className="min-w-0"><span className="font-semibold text-slate-900 break-words">{k.keyword}</span>
                    {k.for_blog && <span className="ml-2 text-11 rounded-full px-1.5 py-0.5 bg-emerald-50 text-emerald-700">meant for blogs</span>}
                    {k.used > 0 && <span className="ml-2 text-11 rounded-full px-1.5 py-0.5 bg-amber-50 text-amber-700">used in {k.used} article{k.used > 1 ? 's' : ''}</span>}</span>
                  <span className="text-right tabular-nums text-slate-700">{k.volume != null ? n0(k.volume) : <span className="text-slate-300">—</span>}</span>
                  <span className="text-right tabular-nums text-slate-700">{k.difficulty != null ? k.difficulty : <span className="text-slate-300">—</span>}</span>
                  <span className="text-right tabular-nums text-slate-700">{k.rank != null ? `#${k.rank}` : <span className="text-slate-300">—</span>}</span>
                </button>
              );
            })}
            {!shown.length && <p className="px-3 py-6 text-center text-13 text-slate-500">No keyword matches “{q}”.</p>}
          </div>
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
          <p className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-2">Pick a topic {res.method === 'ai' ? '(written by AI for your business)' : '(standard patterns: add an AI key for topics written for your business)'}</p>
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
        {p.competitor_use && (
          <Tip wide text={`${p.competitor_use.competitors.join(', ')} promote${p.competitor_use.competitors.length === 1 ? 's' : ''} ${p.competitor_use.articles === 1 ? 'an article' : `${p.competitor_use.articles} articles`} here${p.competitor_use.example?.title ? `, for example “${p.competitor_use.example.title}”` : ''}.`}>
            <span><Badge tone="violet">Used by {p.competitor_use.competitors.length} competitor{p.competitor_use.competitors.length === 1 ? '' : 's'}</Badge></span>
          </Tip>
        )}
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

const TOPIC = { same: ['Same topic', 'green'], related: ['Related topic', 'blue'] };

/** Per competitor: the platforms it publishes its blog on (read from its own website) and the sites that link to its articles (our backlink crawler),
 *  verified results apart from what was looked for and not found. Starts by itself when a competitor has not been checked yet. */
function CompetitorPlaces({ b, base, comp, onAdded, reload }) {
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const research = comp?.research;
  const started = React.useRef(false);
  const go = (force) => run('research', async () => { await api(`${base}/research-competitors${force ? '?force=true' : ''}`, { method: 'POST' }); reload(true); });
  useEffect(() => {  // automatic: competitors never checked are researched once, in the background
    if (!started.current && research && !research.running && research.total && research.done < research.total) { started.current = true; go(false); }
  }, [research?.done, research?.total, research?.running]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!research?.running) return undefined;
    const t = setInterval(() => reload(true), 4000);
    return () => clearInterval(t);
  }, [research?.running]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!comp || comp.state === 'error') return null;
  const add = (x) => run(`a${x.domain}`, async () => { onAdded(await api(`${base}/add-from-competitor`, { method: 'POST', body: { domain: x.domain } })); toast(`${x.domain} added to the plan`); });
  if (comp.state === 'no_competitors') {
    return <p className="text-13 text-slate-600"><Link to="/competitor-finder" className="text-indigo-600 hover:underline">Add your competitors</Link> to see the platforms where they post their blogs.</p>;
  }
  const list = comp.by_competitor || [];
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2 text-12.5 text-slate-500">
        <span className="font-semibold text-slate-900 text-13">Competitor blog platforms</span>
        {research?.running ? <span className="inline-flex items-center gap-1 text-indigo-600"><RefreshCw size={12} className="animate-spin" />Checking competitor websites ({research.done}/{research.total})…</span>
          : <span>{research?.done || 0} of {research?.total || list.length} checked</span>}
        <span className="ml-auto"><Button size="sm" icon={RefreshCw} busy={busy === 'research'} disabled={research?.running} onClick={() => go(true)}>Check again</Button></span>
      </div>
      <ErrorNote>{error}</ErrorNote>
      {list.map(c => <CompetitorRow key={c.competitor} c={c} running={research?.running} />)}
      {comp.items?.length > 0 && <SuggestedPlaces comp={comp} busy={busy} add={add} />}
      {toastNode}
    </div>
  );
}

const USEFUL_TONE = { useful: ['Useful', 'green'], neutral: ['Neutral', 'gray'], risky: ['Risky', 'red'], unscored: ['Not judged', 'amber'] };

function PlatformChip({ name, href, tip, tone = 'green' }) {
  const cls = tone === 'green' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200 hover:bg-emerald-100' : tone === 'red' ? 'bg-red-50 text-red-700 ring-red-200' : 'bg-indigo-50 text-indigo-800 ring-indigo-200 hover:bg-indigo-100';
  return (
    <Tip text={tip} wide>
      <a href={href} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-12.5 font-medium ring-1 ring-inset ${cls}`}>
        <CheckCircle2 size={12} />{name}<ExternalLink size={10} className="opacity-60" />
      </a>
    </Tip>
  );
}

/** One competitor: the platforms where its blog is posted (verified, with the page that proves it), the sites linking to its articles, and what was not found. */
function CompetitorRow({ c, running }) {
  const [open, setOpen] = useState(false);
  const s = c.site;
  const platforms = s?.platforms || [];
  const linked = c.linked_from || [];
  const articles = s?.articles || [];
  return (
    <div className="rounded-lg ring-1 ring-inset ring-slate-200 p-3 grid gap-2 text-13">
      <div className="flex flex-wrap items-center gap-2">
        <a href={`https://${c.competitor}`} target="_blank" rel="noreferrer" className="font-semibold text-slate-900 hover:text-indigo-600">{c.competitor}</a>
        {!s ? <span className="text-12.5 text-slate-400">{running ? 'Checking…' : 'Not checked yet'}</span>
          : !s.reachable ? <Badge tone="gray">Website could not be opened</Badge>
            : s.blog_url ? <a href={s.blog_url} target="_blank" rel="noreferrer"><Badge tone="green">Own blog · {articles.length}{articles.length >= 20 ? '+' : ''} article{articles.length === 1 ? '' : 's'}</Badge></a>
              : articles.length ? <Badge tone="blue">{articles.length}{articles.length >= 20 ? '+' : ''} article page{articles.length === 1 ? '' : 's'} on its website</Badge>
                : <Badge tone="gray">No blog on its website</Badge>}
        {articles.length > 0 && <button type="button" onClick={() => setOpen(o => !o)} className="ml-auto text-12 text-indigo-600 hover:underline cursor-pointer">{open ? 'Hide articles' : 'Show articles'}</button>}
      </div>
      {(platforms.length > 0 || linked.length > 0) ? (
        <div className="flex flex-wrap gap-1.5">
          {platforms.map(p => <PlatformChip key={p.name} name={p.name} href={p.url} tone="green"
            tip={`${p.evidence}${p.posts > 1 ? ` (${p.posts} articles)` : ''}. Seen on ${p.seen_on}`} />)}
          {linked.filter(l => !platforms.some(p => p.name === l.name)).map(l => {
            const [ut] = USEFUL_TONE[l.useful] || USEFUL_TONE.unscored;
            return <PlatformChip key={l.domain} name={l.name} href={l.url} tone={l.useful === 'risky' ? 'red' : 'indigo'}
              tip={`Links to their article ${l.article} (${l.links} link${l.links === 1 ? '' : 's'}, ${l.follow === 'dofollow' ? 'follow' : 'nofollow'}, ${ut}). Found by our backlink crawler.`} />;
          })}
        </div>
      ) : s && <p className="text-12.5 text-slate-500">No outside platform found for this competitor’s blog.</p>}
      {s?.not_found?.length > 0 && <p className="text-12 text-slate-400">Not found: {s.not_found.join(', ')}</p>}
      {open && (
        <ul className="grid gap-0.5 pl-3 border-l-2 border-slate-100">
          {articles.map(u => <li key={u}><a href={u} target="_blank" rel="noreferrer" className="text-12.5 text-slate-700 hover:text-indigo-600 hover:underline break-all">{u.replace(/^https?:\/\/(www\.)?/, '')}</a></li>)}
        </ul>
      )}
    </div>
  );
}

const PUB_TYPE = { guest: ['Guest posts', 'green'], free: ['Free submission', 'green'], paid: ['Paid publishing', 'amber'], open: ['Open platform', 'blue'], unknown: ['Not verified', 'gray'] };
const BACKLINK = { likely: ['Backlink likely', 'green'], possible: ['Backlink possible', 'blue'], unknown: ['Backlink unknown', 'gray'] };
const selCls = 'h-8 rounded-lg border border-slate-200 bg-white px-2 text-12.5 text-slate-700';

/** Websites across the web that publish articles on this blog's topics (Google searches, not the competitor list), with what was verified on each. */
function PublishingDiscovery({ b, article }) {
  const base = `/businesses/${b.id}/blog-flow/discovery/${article.id}`;
  const r = useApi(base);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const [f, setF] = useState({ platform: '', topic: '', type: '', da: 0, verified: false, saved: false });
  const auto = React.useRef(false);
  const d = r.data;
  const go = () => run('run', async () => { await api(`${base}/run`, { method: 'POST' }); r.reload(true); });
  useEffect(() => { if (d?.state === 'not_run' && !d.running && !auto.current) { auto.current = true; go(); } }, [d?.state, d?.running]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!d?.running) return undefined;
    const t = setInterval(() => r.reload(true), 5000);
    return () => clearInterval(t);
  }, [d?.running]); // eslint-disable-line react-hooks/exhaustive-deps
  if (r.error) return <ErrorNote>{r.error.message}</ErrorNote>;
  if (!d) return <SkList rows={2} />;
  const save = (i) => run(`s${i.url}`, async () => { r.setData(await api(`${base}/save`, { method: 'POST', body: { domain: i.domain } })); toast(`${i.domain} saved to your link-building plan`); });
  const items = d.items || [];
  const platforms = [...new Set(items.map(i => i.platform))].sort();
  const topics = [...new Set(items.flatMap(i => i.topics || []))];
  const shown = items.filter(i => (!f.platform || i.platform === f.platform) && (!f.topic || (i.topics || []).includes(f.topic)) && (!f.type || i.publishing?.type === f.type)
    && (!f.da || (i.da ?? -1) >= f.da) && (!f.verified || i.publishing?.verified || i.article_verified) && (!f.saved || i.saved));
  const verified = items.filter(i => i.publishing?.verified).length;
  return (
    <div className="grid gap-2 border-t border-slate-200 pt-4">
      <div className="flex flex-wrap items-center gap-2 text-12.5 text-slate-500">
        <span className="font-semibold text-slate-900 text-13">Publishing sites on the web</span>
        {d.running ? <span className="inline-flex items-center gap-1 text-indigo-600"><RefreshCw size={12} className="animate-spin" />Searching the web and checking each site…</span>
          : d.state === 'ok' && <span>{items.length} sites · {verified} verified · topics: {(d.topics || []).join(', ')}</span>}
        <span className="ml-auto"><Button size="sm" icon={RefreshCw} busy={busy === 'run'} disabled={d.running || d.state === 'no_search' || d.state === 'no_topic'} onClick={go}>Search again</Button></span>
      </div>
      <ErrorNote>{error || (d.state === 'error' ? d.message : null)}</ErrorNote>
      {d.source === 'ai' && items.length > 0 && (
        <p className="flex gap-2 rounded-lg bg-amber-50 ring-1 ring-inset ring-amber-200 p-2.5 text-12.5 text-amber-900">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>The web search could not run{d.message ? ` (${d.message})` : ''}. These sites are <b>AI suggestions</b>, not search results: each one was opened and checked, and only what is marked “verified” was seen on the site itself.</span>
        </p>
      )}
      {(d.state === 'no_search' || d.state === 'no_topic') && <p className="text-13 text-slate-600">{d.message}</p>}
      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Platform" className={selCls} value={f.platform} onChange={e => setF(s => ({ ...s, platform: e.target.value }))}><option value="">All platforms</option>{platforms.map(p => <option key={p}>{p}</option>)}</select>
          <select aria-label="Topic" className={selCls} value={f.topic} onChange={e => setF(s => ({ ...s, topic: e.target.value }))}><option value="">All topics</option>{topics.map(t => <option key={t}>{t}</option>)}</select>
          <select aria-label="Publishing type" className={selCls} value={f.type} onChange={e => setF(s => ({ ...s, type: e.target.value }))}><option value="">All publishing types</option>{Object.entries(PUB_TYPE).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
          <select aria-label="Domain authority" className={selCls} value={f.da} onChange={e => setF(s => ({ ...s, da: Number(e.target.value) }))}><option value={0}>Any DA</option>{[10, 20, 30, 40, 50].map(n => <option key={n} value={n}>DA {n}+</option>)}</select>
          <label className="inline-flex items-center gap-1.5 text-12.5 text-slate-700"><input type="checkbox" checked={f.verified} onChange={e => setF(s => ({ ...s, verified: e.target.checked }))} />Verified only</label>
          <label className="inline-flex items-center gap-1.5 text-12.5 text-slate-700"><input type="checkbox" checked={f.saved} onChange={e => setF(s => ({ ...s, saved: e.target.checked }))} />Saved</label>
          <span className="text-12 text-slate-400">{shown.length} shown</span>
        </div>
      )}
      {d.state === 'ok' && !items.length && !d.running && <p className="text-13 text-slate-600">The searches found no publishing sites for these topics.</p>}
      <div className="grid gap-2">
        {shown.map(i => {
          const pub = i.publishing || {};
          const [pl, pt] = PUB_TYPE[pub.type] || PUB_TYPE.unknown;
          const [bl, bt] = BACKLINK[i.backlink] || BACKLINK.unknown;
          return (
            <div key={i.url} className="rounded-lg ring-1 ring-inset ring-slate-200 p-3 grid gap-1 text-13">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900">{i.site || i.domain}</span>
                <span className="text-12 text-slate-400">{i.domain}</span>
                <Badge tone="violet">{i.platform}</Badge>
                <Tip wide text={pub.verified ? `Verified on ${pub.evidence_url}: “${pub.evidence}”` : pub.known ? pub.evidence : 'No “write for us”, guest-post or submission page was found on this site.'}>
                  <span><Badge tone={pt}>{pub.verified && <CheckCircle2 size={11} className="inline mr-0.5" />}{pl}{pub.verified ? ' · verified' : ''}</Badge></span>
                </Tip>
                <Tip wide text={i.links_out ? `Its article links out to other sites ${i.links_out.follow} time(s) with followed links and ${i.links_out.nofollow} with nofollow.` : 'The article could not be opened.'}><span><Badge tone={bt}>{bl}</Badge></span></Tip>
                {i.da != null && <span className="text-12 text-slate-500">DA {i.da}</span>}
                {i.competitor && <Badge tone="amber">Competitor</Badge>}
                <span className="ml-auto">{i.saved ? <Badge tone="green"><CheckCircle2 size={11} className="inline mr-0.5" />Saved</Badge>
                  : <Button size="sm" icon={Plus} busy={busy === `s${i.url}`} onClick={() => save(i)}>Save</Button>}</span>
              </div>
              <a href={i.url} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline inline-flex items-center gap-1 break-all">{i.title || i.url}<ExternalLink size={11} className="shrink-0" /></a>
              <div className="text-12 text-slate-500 flex flex-wrap gap-x-3">
                <span className={i.article_verified ? 'text-emerald-700' : ''}>{i.article_verified ? '✓ Article verified' : i.reachable === false ? 'Page could not be opened' : 'Article not verified'}</span>
                <span>Found by: {(i.found_by || []).join(', ')}</span>
                {pub.verified && pub.evidence_url && <a href={pub.evidence_url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">Their publishing page</a>}
              </div>
            </div>
          );
        })}
      </div>
      {toastNode}
    </div>
  );
}

/** Step 2: the linking sites worth posting this blog on, best first; each one can be added to the plan. */
function SuggestedPlaces({ comp, busy, add }) {
  return (
      <div className="grid gap-2">
        {comp.items.map(x => (
          <div key={x.domain} className="rounded-lg ring-1 ring-inset ring-slate-200 p-3 grid gap-1.5 text-13">
            <div className="flex flex-wrap items-center gap-2">
              <a href={`https://${x.domain}`} target="_blank" rel="noreferrer" className="font-semibold text-slate-900 hover:text-indigo-600 inline-flex items-center gap-1">{x.domain}<ExternalLink size={11} /></a>
              <Badge tone="gray">{x.category.label}</Badge>
              <Badge tone={x.follow === 'dofollow' ? 'green' : 'gray'}>{x.follow === 'dofollow' ? 'Follow' : 'Nofollow'}</Badge>
              {x.topic && <Badge tone={TOPIC[x.topic][1]}>{TOPIC[x.topic][0]}</Badge>}
              {x.da != null && <span className="text-12 text-slate-500">DA {x.da}</span>}
              <span className="ml-auto"><Button size="sm" variant="primary" icon={Plus} busy={busy === `a${x.domain}`} onClick={() => add(x)}>Add to plan</Button></span>
            </div>
            <p className="text-12.5 text-slate-600">Used by {x.competitors.join(', ')} · {x.articles === 1 ? '1 article' : `${x.articles} articles`}</p>
            {x.example?.url && (
              <p className="text-12.5 text-slate-500 truncate">Example: <a href={x.example.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">{x.example.title || x.example.url}</a>
                {x.example.competitor_article && <> → <a href={x.example.competitor_article} target="_blank" rel="noreferrer" className="hover:underline">{x.example.competitor}’s article</a></>}</p>
            )}
            <p className="text-12 text-slate-500">{x.how}</p>
          </div>
        ))}
        {comp.total > comp.items.length && <p className="text-12 text-slate-500">Showing the best {comp.items.length} of {comp.total}. <Link to="/backlinks/opportunities" className="text-indigo-600 hover:underline">See all link opportunities</Link></p>}
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
          <CompetitorPlaces b={b} base={base} comp={d.from_competitors} onAdded={(next) => r.setData(next)} reload={r.reload} />
          <PublishingDiscovery b={b} article={article} />
          <h3 className="text-14 font-semibold text-slate-900 border-t border-slate-200 pt-4">Your promotion plan</h3>
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

/** Where the article is in the flow: five stages, and in a line what to do now. */
export function FlowSteps({ step }) {
  const steps = [['Keywords & topic', 'Choose the keywords and a topic, or type your own.'], ['Write', 'The article is written from your keywords. Read it and edit what you like.'], ['Review & layout', 'Compare it with your website’s blog, fix what is missing, then save the draft.'],
    ['Schedule or publish', 'Pick a day and time, or publish now. A task is added for you.'], ['Promote & track', 'Post a short overview on other sites with the blog’s link, then check the links.']];
  return (
    <div className="rounded-xl bg-white ring-1 ring-inset ring-slate-200 p-3.5">
      <ol className="grid grid-cols-5 gap-2">
        {steps.map(([s], i) => (
          <li key={s} className="min-w-0">
            <div className={`h-1.5 rounded-full ${i < step ? 'bg-emerald-500' : i === step ? 'bg-indigo-600' : 'bg-slate-200'}`} />
            <div className="mt-2 flex items-center gap-1.5 text-12">
              <span className={`inline-flex items-center justify-center h-5 w-5 rounded-full text-11 font-semibold shrink-0 ${i < step ? 'bg-emerald-100 text-emerald-700' : i === step ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'}`}>{i < step ? '✓' : i + 1}</span>
              <span className={`truncate ${i === step ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>{s}</span>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-2.5 text-12.5 text-slate-600"><b className="text-slate-800">Now:</b> {steps[Math.min(step, 4)][1]}</p>
    </div>
  );
}
