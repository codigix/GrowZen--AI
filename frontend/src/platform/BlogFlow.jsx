import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Sparkles, CheckCircle2, AlertTriangle, Copy, RefreshCw, Plus, Layout, Megaphone, ArrowRight, FileText, Globe, Users, ListChecks, Link2, Send, ShieldCheck, Download } from 'lucide-react';
import { Card, Button, Badge, Stat, ErrorNote, useAction, useToast, SkList, inputCls } from './SeoUi';
import { api, useApi } from './seoApi';
import Tip from './Tip';
import { downloadFile } from './DataTable';

const n0 = (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN'));

// ---- Downloads: everything the owner may want to use outside the software ----
const today = () => new Date().toISOString().slice(0, 10);
const stem = (s) => String(s || 'site').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '') || 'site';
const siteOf = (b) => stem(b?.website || b?.name);
const fileStem = (s, max = 50) => String(s || '').toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '') || 'untitled';
const numOrBlank = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? '' : Number(v));
const looksHtml = (s) => /<\/?(p|h[1-6]|ul|ol|li|div|br|img|a|table|blockquote|strong|em|section|article)\b/i.test(s);
const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unescHtml = (s) => String(s).replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
const attrOf = (tag, name) => { const m = String(tag).match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i')); return m ? (m[1] ?? m[2] ?? '') : ''; };

/** The article's HTML as Markdown: headings, paragraphs, lists, links, images, bold, italics, quotes and tables. */
export function htmlToMarkdown(html) {
  const inline = (t) => unescHtml(String(t || '')
    .replace(/<img\b[^>]*>/gi, (tag) => `![${attrOf(tag, 'alt')}](${attrOf(tag, 'src')})`)
    .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, (m) => { const href = attrOf(m.slice(0, m.indexOf('>') + 1), 'href'); const text = m.replace(/<[^>]+>/g, ''); return href ? `[${text}](${href})` : text; })
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<br\s*\/?>/gi, '  \n')
    .replace(/<[^>]+>/g, '')).trim();
  const out = [];
  const keep = (t) => { out.push(t); return `\n\n\u0000${out.length - 1}\u0000\n\n`; };
  let s = String(html || '').replace(/\r/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_, t) => {
    const rows = [...t.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(r => [...r[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(c => inline(c[1]).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')));
    if (!rows.length) return '';
    const w = Math.max(...rows.map(r => r.length));
    const pad = (r) => [...r, ...Array(w - r.length).fill('')];
    return keep([`| ${pad(rows[0]).join(' | ')} |`, `| ${Array(w).fill('---').join(' | ')} |`, ...rows.slice(1).map(r => `| ${pad(r).join(' | ')} |`)].join('\n'));
  });
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, t) => keep(`${'#'.repeat(Number(n))} ${inline(t).replace(/\s*\n\s*/g, ' ')}`));
  s = s.replace(/<(ul|ol)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, kind, inner) => { let n = 0; return keep([...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(m => `${kind.toLowerCase() === 'ol' ? `${++n}.` : '-'} ${inline(m[1]).replace(/\s*\n\s*/g, ' ')}`).join('\n')); });
  s = s.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, t) => keep(inline(t).split('\n').map(l => `> ${l}`).join('\n')));
  s = s.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_, t) => keep(inline(t)));
  s = s.replace(/<hr\b[^>]*>/gi, () => keep('---'));
  s = inline(s);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => out[Number(i)]).replace(/\n{3,}/g, '\n\n').trim();
}

/** Markdown as HTML (for an article that was stored as Markdown). */
export function markdownToHtml(md) {
  const inl = (t) => escHtml(t).replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1">').replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>').replace(/`([^`]+)`/g, '<code>$1</code>');
  return String(md || '').replace(/\r/g, '').split(/\n{2,}/).map(raw => {
    const x = raw.trim(); let m;
    if (!x) return '';
    if ((m = x.match(/^(#{1,6})\s+(.+)$/))) return `<h${m[1].length}>${inl(m[2])}</h${m[1].length}>`;
    if (/^([-*]\s+.+(\n|$))+$/.test(x)) return `<ul>${x.split('\n').map(l => `<li>${inl(l.replace(/^[-*]\s+/, ''))}</li>`).join('')}</ul>`;
    if (/^(\d+\.\s+.+(\n|$))+$/.test(x)) return `<ol>${x.split('\n').map(l => `<li>${inl(l.replace(/^\d+\.\s+/, ''))}</li>`).join('')}</ol>`;
    if (/^>/.test(x)) return `<blockquote>${inl(x.replace(/^>\s?/gm, ''))}</blockquote>`;
    return `<p>${inl(x).replace(/\n/g, '<br>')}</p>`;
  }).filter(Boolean).join('\n');
}

/** Save one article as a file: kind 'md' (Markdown with its SEO details on top) or 'html' (a complete page). */
export function downloadArticle(a, kind, b) {
  const body = String(a.body || '');
  const title = a.title || a.keyword || 'Article';
  const sec = Array.isArray(a.secondary_keywords) ? a.secondary_keywords : String(a.secondary_keywords || '').split(',').map(x => x.trim()).filter(Boolean);
  const name = `article-${fileStem(title)}-${siteOf(b)}-${today()}`;
  if (kind === 'md') {
    const md = looksHtml(body) ? htmlToMarkdown(body) : body;
    const front = ['---', `title: ${JSON.stringify(title)}`, a.meta_description && `description: ${JSON.stringify(a.meta_description)}`, a.keyword && `keyword: ${JSON.stringify(a.keyword)}`, sec.length && `secondary_keywords: ${JSON.stringify(sec)}`, a.slug && `slug: ${JSON.stringify(a.slug)}`, '---'].filter(Boolean).join('\n');
    downloadFile(`${name}.md`, `${front}\n\n${/^#\s/m.test(md) ? '' : `# ${title}\n\n`}${md}\n`, 'text/markdown');
    return;
  }
  const inner = looksHtml(body) ? body : markdownToHtml(body);
  const page = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escHtml(title)}</title>\n${a.meta_description ? `<meta name="description" content="${escHtml(a.meta_description)}">\n` : ''}${[a.keyword, ...sec].filter(Boolean).length ? `<meta name="keywords" content="${escHtml([a.keyword, ...sec].filter(Boolean).join(', '))}">\n` : ''}<style>body{font-family:Georgia,serif;max-width:46rem;margin:2rem auto;padding:0 1rem;line-height:1.65;color:#1e293b}h1,h2,h3{font-family:system-ui,sans-serif;line-height:1.25}img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{border:1px solid #cbd5e1;padding:.4rem .6rem}blockquote{border-left:4px solid #cbd5e1;margin-left:0;padding-left:1rem;color:#475569}</style>\n</head>\n<body>\n<article>\n${/<h1\b/i.test(inner) ? '' : `<h1>${escHtml(title)}</h1>\n`}${inner}\n</article>\n</body>\n</html>\n`;
  downloadFile(`${name}.html`, page, 'text/html');
}

/** Download an article as Markdown and as HTML. `article` needs a `body`; when it has none (a list row) the full article is read first. */
export function ArticleDownloads({ b, article }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const go = async (kind) => {
    setBusy(kind); setErr('');
    try {
      const a = article.body == null && b ? await api(`/businesses/${b.id}/articles/${article.id}`) : article;
      downloadArticle(a, kind, b);
    } catch (e) { setErr(e.message || 'Could not read the article.'); } finally { setBusy(''); }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Button size="sm" icon={Download} busy={busy === 'md'} onClick={() => go('md')} title="Download the article as a Markdown (.md) file">Download .md</Button>
      <Button size="sm" icon={Download} busy={busy === 'html'} onClick={() => go('html')} title="Download the article as a web page (.html) file">Download .html</Button>
      {err && <span className="text-12 text-red-600">{err}</span>}
    </span>
  );
}


/** The look of the "Promote this blog" section: one panel per job, each with an icon, a title and a line saying what it is for. */
function SectionHead({ icon: Icon, title, hint, right }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="h-9 w-9 shrink-0 rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100 inline-flex items-center justify-center"><Icon size={16} /></span>
      <div className="min-w-0 flex-1">
        <h3 className="text-14 font-semibold text-slate-900 leading-tight">{title}</h3>
        {hint && <p className="text-12.5 text-slate-500 mt-0.5">{hint}</p>}
      </div>
      {right}
    </div>
  );
}
const Panel = ({ children }) => <section className="rounded-2xl bg-white ring-1 ring-inset ring-slate-200 p-4 grid gap-3.5">{children}</section>;
const STAT_TONE = { slate: 'bg-slate-100 text-slate-600', indigo: 'bg-indigo-50 text-indigo-600', emerald: 'bg-emerald-50 text-emerald-600', rose: 'bg-rose-50 text-rose-600' };
function StatTile({ icon: Icon, label, value, tone = 'slate' }) {
  return (
    <div className="rounded-xl bg-white ring-1 ring-inset ring-slate-200 p-3 flex items-center gap-3">
      <span className={`h-10 w-10 shrink-0 rounded-xl inline-flex items-center justify-center ${STAT_TONE[tone]}`}><Icon size={17} /></span>
      <div className="min-w-0"><div className="text-20 font-semibold text-slate-900 leading-none">{n0(value)}</div><div className="text-12 text-slate-500 mt-1 truncate">{label}</div></div>
    </div>
  );
}

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
const ST_ACCENT = { planned: 'bg-slate-300', posted: 'bg-blue-400', verified: 'bg-emerald-500', problem: 'bg-rose-500', skipped: 'bg-slate-200' };

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
    <div className={`relative overflow-hidden rounded-xl bg-white ring-1 ring-inset ring-slate-200 p-3.5 pl-5 grid gap-2 text-13 ${p.status === 'skipped' ? 'opacity-70' : ''}`}>
      <span className={`absolute left-0 inset-y-0 w-1 ${ST_ACCENT[p.status] || ST_ACCENT.planned}`} aria-hidden="true" />
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
    const sv = comp.saved || {};
    // switch a saved competitor on (the same choice as on the Competitors page); its blog platforms are then looked up by themselves
    const use = (c) => run(`u${c.id}`, async () => { await api(`/competitors/${c.id}`, { method: 'PATCH', body: { selected: true } }); toast(`${c.name} is now used`); reload(true); });
    return (
      <Panel>
        <SectionHead icon={Users} title="Where your competitors post their blogs"
          hint={sv.total
            ? `You have ${sv.total} competitor${sv.total === 1 ? '' : 's'} saved, but none can be read yet: their blog platforms are found from their websites.`
            : <><Link to="/competitor-finder" className="text-indigo-600 hover:underline">Add your competitors</Link> to see the platforms where they post their blogs.</>} />
        {sv.left_out?.length > 0 && (
          <div className="rounded-xl bg-slate-50 ring-1 ring-inset ring-slate-200 p-3 grid gap-2 text-13">
            <div className="text-slate-700">These have a website but are <b>left out</b> (not selected). Use them to see where they post their blogs:</div>
            {sv.left_out.map(c => (
              <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white ring-1 ring-inset ring-slate-200 px-3 py-2">
                <span className="font-medium text-slate-900">{c.name}</span>
                <a href={`https://${c.domain}`} target="_blank" rel="noreferrer" className="text-12 text-slate-400 hover:text-indigo-600 inline-flex items-center gap-1">{c.domain}<ExternalLink size={10} /></a>
                <span className="ml-auto"><Button size="sm" variant="primary" icon={Plus} busy={busy === `u${c.id}`} onClick={() => use(c)}>Use this competitor</Button></span>
              </div>
            ))}
          </div>
        )}
        {sv.no_website?.length > 0 && (
          <p className="text-12.5 text-slate-600">Only on Google Maps, without a website (nothing to read): {sv.no_website.join(', ')}. Add their website on the <Link to="/competitor-finder" className="text-indigo-600 hover:underline">Competitors page</Link> to include them.</p>
        )}
        <ErrorNote>{error}</ErrorNote>
        {toastNode}
      </Panel>
    );
  }
  const list = comp.by_competitor || [];
  return (
    <Panel>
      <SectionHead icon={Users} title="Where your competitors post their blogs"
        hint={research?.running ? <span className="inline-flex items-center gap-1 text-indigo-600"><RefreshCw size={12} className="animate-spin" />Checking competitor websites ({research.done}/{research.total})…</span>
          : `${research?.done || 0} of ${research?.total || list.length} competitor websites checked`}
        right={<Button size="sm" icon={RefreshCw} busy={busy === 'research'} disabled={research?.running} onClick={() => go(true)}>Check again</Button>} />
      <ErrorNote>{error}</ErrorNote>
      <div className="grid gap-2.5">{list.map(c => <CompetitorRow key={c.competitor} c={c} running={research?.running} />)}</div>
      {comp.items?.length > 0 && <SuggestedPlaces comp={comp} busy={busy} add={add} />}
      {toastNode}
    </Panel>
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
    <div className="rounded-xl bg-slate-50/60 ring-1 ring-inset ring-slate-200 p-3.5 grid gap-2 text-13">
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

const selCls = 'h-8 rounded-lg border border-slate-200 bg-white px-2 text-12.5 text-slate-700';

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

/** The top blogging and article-publishing platforms: always listed (a built-in list), plus the ones Claude picks for this business, which come first with a reason.
 *  Each platform is opened in the background to see that it is online; one that is not is hidden. */
function TopPlatforms({ b, article }) {
  const base = `/businesses/${b.id}/blog-flow/platforms/${article.id}`;
  const r = useApi(base);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const [f, setF] = useState({ q: '', kind: '', free: false, suggested: false, all: false });
  const auto = React.useRef(false);
  const d = r.data;
  const go = () => run('check', async () => { await api(`${base}/check`, { method: 'POST' }); r.reload(true); });
  useEffect(() => { if (d?.stale && !d.running && !auto.current) { auto.current = true; go(); } }, [d?.stale, d?.running]); // eslint-disable-line react-hooks/exhaustive-deps
  const busyNow = Boolean(d?.running || d?.rental?.running);
  useEffect(() => {
    if (!busyNow) return undefined;
    const t = setInterval(() => r.reload(true), 5000);
    return () => clearInterval(t);
  }, [busyNow]); // eslint-disable-line react-hooks/exhaustive-deps
  const rentalTried = React.useRef(false);  // the clothing-rental websites are looked up and opened in the background (once a day at most)
  useEffect(() => {
    if (d?.rental?.show && d.rental.stale && !d.rental.running && !d.running && !rentalTried.current) {
      rentalTried.current = true;
      api(`${base}/rental/refresh`, { method: 'POST' }).then(() => r.reload(true)).catch(() => { });
    }
  }, [d?.rental?.show, d?.rental?.stale, d?.rental?.running, d?.running]); // eslint-disable-line react-hooks/exhaustive-deps
  if (r.error) return <ErrorNote>{r.error.message}</ErrorNote>;
  if (!d) return <SkList rows={2} />;
  const save = (i) => run(`p${i.domain}`, async () => { r.setData(await api(`${base}/save`, { method: 'POST', body: { domain: i.domain } })); toast(`${i.name} saved to your link-building plan`); });
  const items = d.items.filter(i => i.live !== false);  // a platform that could not be opened is not shown
  const offline = d.items.length - items.length;
  const q = f.q.trim().toLowerCase();
  const shown = items.filter(i => (!q || `${i.name} ${i.domain}`.toLowerCase().includes(q)) && (!f.kind || i.kind === f.kind)
    && (!f.free || i.price === 'free' || i.price === 'free plan') && (!f.suggested || i.suggested));
  const TOP = 20;  // only the best 20 are listed (Claude's picks first); search or a filter reaches the others
  const list = shown.slice(0, TOP);
  const picked = items.filter(i => i.suggested).length;
  const chk = 'inline-flex items-center gap-1.5 text-12.5 text-slate-700 cursor-pointer';
  return (
    <Panel>
      <SectionHead icon={Layout} title="Top blogging platforms"
        hint={busyNow ? <span className="inline-flex items-center gap-1 text-indigo-600"><RefreshCw size={12} className="animate-spin" />{d.running ? 'Asking Claude for the platforms that suit your business and checking each one is online…' : 'Looking up clothing rental websites and opening each one…'}</span>
          : `The best 20 of ${items.length} platforms where you can publish this blog from your own account${picked ? ' · Claude picked the best fits for your business first' : ''}${d.checked_at ? ` · checked ${new Date(d.checked_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}` : ''}${offline ? ` · ${offline} offline, hidden` : ''}`}
        right={<Button size="sm" icon={RefreshCw} busy={busy === 'check'} disabled={d.running} onClick={go}>Refresh</Button>} />
      <ErrorNote>{error}</ErrorNote>
      {d.source === 'built-in' && d.message && !d.running && (
        <p className="flex gap-2 rounded-xl bg-amber-50 ring-1 ring-inset ring-amber-200 p-3 text-12.5 text-amber-900">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" /><span>Claude could not add platforms for your business ({d.message}). The built-in list below is always shown.</span>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 ring-1 ring-inset ring-slate-200 p-2.5">
        <input value={f.q} onChange={e => setF(s => ({ ...s, q: e.target.value }))} placeholder="Search platforms" aria-label="Search platforms" className={`${selCls} !w-48`} />
        <select aria-label="Type" className={selCls} value={f.kind} onChange={e => setF(s => ({ ...s, kind: e.target.value }))}><option value="">All types</option>{(d.kinds || []).map(k => <option key={k}>{k}</option>)}</select>
        <label className={chk}><input type="checkbox" checked={f.free} onChange={e => setF(s => ({ ...s, free: e.target.checked }))} />Free to publish</label>
        {picked > 0 && <label className={chk}><input type="checkbox" checked={f.suggested} onChange={e => setF(s => ({ ...s, suggested: e.target.checked }))} />Picked for my business</label>}
        <span className="ml-auto text-12 text-slate-400">{list.length} shown</span>
      </div>
      <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
        {list.map(i => (
          <div key={i.domain} className="rounded-xl bg-white ring-1 ring-inset ring-slate-200 hover:ring-indigo-200 transition-shadow hover:shadow-sm p-3.5 grid gap-1.5 text-13 content-start">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-slate-900 truncate">{i.name}</div>
                <div className="text-12 text-slate-400 truncate">{i.domain}</div>
              </div>
              {i.saved ? <Badge tone="green"><CheckCircle2 size={11} className="inline mr-0.5" />Saved</Badge>
                : <Button size="sm" icon={Plus} busy={busy === `p${i.domain}`} onClick={() => save(i)}>Save</Button>}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="violet">{i.kind}</Badge>
              {i.price && <Badge tone={i.price === 'paid' ? 'amber' : 'green'}>{i.price === 'free' ? 'Free' : i.price === 'free plan' ? 'Free plan' : 'Paid'}</Badge>}
              {i.suggested && <Badge tone="blue">Picked for you</Badge>}
              {i.suits && <Tip wide text={`${i.name} is a fashion platform where anyone can publish an article, so it suits clothing rental articles. This comes from the kind of platform, not from reading its pages.`}><span><Badge tone="green">Suits clothing rental articles</Badge></span></Tip>}
            </div>
            {i.why && <p className="text-12.5 text-slate-600">{i.why}</p>}
            {i.related?.length > 0 && (
              <div className="mt-0.5 rounded-lg bg-slate-50/70 ring-1 ring-inset ring-slate-100 p-2.5 grid gap-1.5">
                <div className="text-12 font-semibold text-slate-700">Related Clothing Rental Websites</div>
                {i.related.map(s => (
                  <div key={s.domain} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-12.5">
                    {s.why || s.found_by ? <Tip text={[s.why, s.found_by && `Found by ${s.found_by === 'earlier' ? 'an earlier search' : s.found_by}, then opened and checked`].filter(Boolean).join(' · ')}><span className="font-medium text-slate-800 cursor-help">{s.name}</span></Tip> : <span className="font-medium text-slate-800">{s.name}</span>}
                    {s.verified === true && <Tip text="The website was opened and its page is about renting clothes."><span className="inline-flex items-center gap-0.5 text-12 text-emerald-600"><CheckCircle2 size={11} />Verified</span></Tip>}
                    {s.verified === false && <Tip text={s.error || 'The website could not be opened.'}><span className="text-12 text-rose-600">Could not be opened</span></Tip>}
                    <a href={s.url} target="_blank" rel="noreferrer" className="ml-auto text-indigo-700 hover:underline inline-flex items-center gap-1">Visit Website<ExternalLink size={11} className="shrink-0" /></a>
                  </div>
                ))}
                <p className="text-11.5 text-slate-500">Reference websites for clothing rental content. You publish your blog on {i.name}, not on these sites.</p>
              </div>
            )}
            <a href={i.url} target="_blank" rel="noreferrer" className="text-12.5 text-indigo-700 hover:underline inline-flex items-center gap-1">Start publishing<ExternalLink size={11} className="shrink-0" /></a>
          </div>
        ))}
      </div>
      {!list.length && <p className="rounded-xl border border-dashed border-slate-300 p-4 text-13 text-slate-600 text-center">No platform matches these filters.</p>}
      {shown.length > TOP && <p className="text-12.5 text-slate-500">Showing the best {TOP} of {shown.length} platforms. Search or use a filter to find the others.</p>}
      {toastNode}
    </Panel>
  );
}

/** After publishing: where to promote the blog, an overview for each place with the blog's link, and the check that the posted link is there. */
export function PromoteCard({ b, article }) {
  const base = `/businesses/${b.id}/blog-flow/promo/${article.id}`;
  const r = useApi(base);
  const [name, setName] = useState('');
  const [site, setSite] = useState('');
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const [ask, setAsk] = useState(false);
  const d = r.data;
  useEffect(() => { r.reload(true); }, [article.id, article.wp_url, article.react_url]); // eslint-disable-line react-hooks/exhaustive-deps
  if (r.error) return <Card><ErrorNote>{r.error.message}</ErrorNote></Card>;
  if (!d) return <SkList rows={3} />;
  const add = () => run('add', async () => { await api(`${base}/add`, { method: 'POST', body: { name, url: site || null } }); setName(''); setSite(''); setAsk(false); r.reload(true); });
  const all = () => run('all', async () => { await api(`${base}/check-all`, { method: 'POST' }); r.reload(true); });
  const copyLink = () => { try { navigator.clipboard.writeText(d.url); toast('Link copied'); } catch { toast('Select the link and copy it'); } };
  const c = d.counts;
  const active = d.items.filter(p => p.status !== 'skipped').length;
  const pct = active ? Math.round((c.verified / active) * 100) : 0;
  return (
    <section className="rounded-2xl bg-slate-50 ring-1 ring-inset ring-slate-200 overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 px-5 py-4 bg-gradient-to-r from-indigo-50 via-white to-violet-50 border-b border-slate-200">
        <span className="h-11 w-11 shrink-0 rounded-2xl bg-indigo-600 text-white inline-flex items-center justify-center shadow-sm"><Megaphone size={20} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-16 font-semibold text-slate-900 leading-tight">Promote this blog and track the links</h2>
          <p className="text-12.5 text-slate-500 mt-0.5 max-w-2xl">After it is published: post a short overview with the blog's link on other platforms, then the software checks that each link is really there.</p>
        </div>
        {d.published && <Button size="sm" icon={RefreshCw} busy={busy === 'all'} onClick={all}>Check all links</Button>}
      </header>

      <div className="p-4 grid gap-4">
        {!d.published && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center grid gap-1.5 justify-items-center">
            <span className="h-10 w-10 rounded-full bg-slate-100 text-slate-500 inline-flex items-center justify-center"><Megaphone size={18} /></span>
            <p className="text-14 font-semibold text-slate-800">This blog is not published yet</p>
            <p className="text-13 text-slate-500 max-w-xl">Publish it (or schedule it) first. The places to promote it, and an overview with its real link, appear here once it is live.</p>
          </div>
        )}
        {d.published && (
          <>
            {/* the live blog, and how far the promotion is */}
            <div className="rounded-2xl bg-white ring-1 ring-inset ring-slate-200 p-4 grid gap-3.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <Badge tone="green"><span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 mr-1 align-middle" />Live</Badge>
                <a href={d.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-13 text-indigo-700 hover:underline" title={d.url}>{d.url}</a>
                <Button size="sm" icon={Copy} onClick={copyLink}>Copy link</Button>
                <a href={d.url} target="_blank" rel="noreferrer"><Button size="sm" icon={ExternalLink}>Open</Button></a>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                <StatTile icon={ListChecks} label="Places to post" value={d.items.length} tone="indigo" />
                <StatTile icon={Send} label="Posted" value={c.posted + c.verified + c.problem} tone="slate" />
                <StatTile icon={Link2} label="Links confirmed" value={c.verified} tone="emerald" />
                <StatTile icon={AlertTriangle} label="Link not found" value={c.problem} tone="rose" />
              </div>
              <div>
                <div className="flex items-center justify-between text-12 text-slate-500 mb-1.5"><span>Promotion progress</span><span className="font-medium text-slate-700">{c.verified} of {active} links confirmed · {pct}%</span></div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500 transition-all" style={{ width: `${pct}%` }} /></div>
              </div>
              <p className="flex gap-2 rounded-xl bg-indigo-50/60 ring-1 ring-inset ring-indigo-100 p-3 text-12.5 text-slate-600">
                <ShieldCheck size={14} className="shrink-0 mt-0.5 text-indigo-500" />
                <span>Posting is done by you, on your own accounts: nothing is posted for you. Most social links are nofollow: they bring visitors, not ranking value.</span>
              </p>
            </div>
            <ErrorNote>{error}</ErrorNote>

            <CompetitorPlaces b={b} base={base} comp={d.from_competitors} onAdded={(next) => r.setData(next)} reload={r.reload} />
            <TopPlatforms b={b} article={article} />

            {/* your own plan: one card per place, with the overview and the link check */}
            <Panel>
              <SectionHead icon={ListChecks} title="Your promotion plan" hint="Write the overview for a place, post it there yourself, then paste the address of your post so the link can be checked."
                right={<Badge tone="gray">{d.items.length} place{d.items.length === 1 ? '' : 's'}</Badge>} />
              <div className="grid gap-2.5">{d.items.map(p => <PlatformRow key={p.id} b={b} article={article} p={p} reload={r.reload} />)}</div>
              {ask ? (
                <div className="flex flex-wrap items-end gap-2 rounded-xl bg-slate-50 ring-1 ring-inset ring-slate-200 p-3">
                  <input value={name} onChange={e => setName(e.target.value)} placeholder="Site name, for example an industry forum" aria-label="Site name" className={`${inputCls} !w-64`} />
                  <input value={site} onChange={e => setSite(e.target.value)} placeholder="Page to open (optional)" aria-label="Page to open" className={`${inputCls} !w-64`} />
                  <Button size="sm" variant="primary" busy={busy === 'add'} disabled={name.trim().length < 2} onClick={add}>Add</Button>
                  <Button size="sm" onClick={() => setAsk(false)}>Cancel</Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-slate-300 p-3">
                  <Button size="sm" icon={Plus} onClick={() => setAsk(true)}>Add another platform</Button>
                  <Link to="/backlinks/opportunities" className="text-12.5 text-indigo-600 hover:underline inline-flex items-center gap-1">Find more places for links<ArrowRight size={12} /></Link>
                </div>
              )}
            </Panel>
          </>
        )}
      </div>
      {toastNode}
    </section>
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
