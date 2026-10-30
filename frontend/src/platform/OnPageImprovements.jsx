import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Copy, Check, ExternalLink, Wrench, Sparkles, TrendingUp, Clock, FileCode, Download, RotateCw, OctagonAlert, TriangleAlert, CircleAlert, Lightbulb, BookOpen } from 'lucide-react';
import { Card, Button } from './SeoUi';
import { pathOf, LEVEL_ORDER, SEVERITY_TONE as TONE } from './siteUtils';

/**
 * Improvements for the on-page screen: every audit issue grouped by kind across pages, ranked by
 * severity and estimated score gain, each with why it matters, how to fix it step by step, and
 * ready-to-use code or copy built from the business's real details and the crawled pages.
 *
 * The score gain uses the crawler's own formula (crawler.summarise): site issues cost their weight,
 * page issues cost (sum of weights / pages) x 4.
 */

const LEVELS_SHOWN = ['critical', 'serious', 'warning', 'info'];
const WEIGHT = { critical: 12, serious: 6, warning: 2, info: 0.5 };
const PAGE_LEVEL = new Set(['http_error', 'javascript_only', 'noindex', 'missing_title', 'title_length', 'missing_meta_description', 'h1_count', 'thin_content', 'missing_alt', 'no_viewport']);

const domainOf = (u) => { try { return new URL(u).origin; } catch (e) { return ''; } };
const clip = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…`);
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const titleFromPath = (u) => { const seg = pathOf(u).split('?')[0].split('/').filter(Boolean).pop(); return seg ? seg.replace(/[-_]+/g, ' ').replace(/\.\w+$/, '').replace(/^\w/, c => c.toUpperCase()) : 'Home'; };

/** Issues stored before codes existed: recognise them by their wording. */
export function codeFor(i, technical) {
  if (i.code) return i.code;
  const check = i.area === 'Technical' && (technical?.seo_checks || []).find(c => c.title === i.title);
  if (check) return `lighthouse:${check.id}`;
  const t = i.title || '';
  const rules = [[/returns \d{3}/, 'http_error'], [/empty without JavaScript/, 'javascript_only'], [/has noindex/, 'noindex'], [/has no title/, 'missing_title'],
  [/title is \d+ characters/, 'title_length'], [/has no meta description/, 'missing_meta_description'], [/H1 headings/, 'h1_count'], [/is thin \(/, 'thin_content'],
  [/images without alt text/, 'missing_alt'], [/no viewport tag/, 'no_viewport'], [/not on HTTPS/, 'no_https'], [/robots\.txt blocks/, 'robots_blocks_all'],
  [/No XML sitemap/, 'no_sitemap'], [/LocalBusiness schema/, 'no_localbusiness_schema'], [/duplicate page titles/, 'duplicate_titles'], [/^Mobile performance/, 'slow_mobile']];
  const hit = rules.find(([re]) => re.test(t));
  if (hit) return hit[1];
  return i.area === 'Technical' ? `lighthouse:${t}` : `other:${t}`;
}

/* ── suggestions built from the page and the business ─────────────────── */

const place = (b) => (b.area || b.city || '').split(',')[0].trim();

function suggestTitle(page, b) {
  const topic = (page.h1 || '').trim() || titleFromPath(page.url);
  const home = pathOf(page.url) === '/';
  const base = home ? `${b.name}${b.primary_category ? ` – ${b.primary_category}` : ''}${place(b) ? ` in ${place(b)}` : ''}` : `${topic} | ${b.name}`;
  return clip(base.length < 30 && place(b) && !home ? `${topic} in ${place(b)} | ${b.name}` : base, 60);
}

function suggestDescription(page, b) {
  const topic = (page.h1 || '').trim() || titleFromPath(page.url);
  const what = pathOf(page.url) === '/' ? `${b.name}${b.primary_category ? `, ${b.primary_category.toLowerCase()}` : ''}` : `${topic} at ${b.name}`;
  const where = place(b) ? ` in ${place(b)}${b.city && b.city !== place(b) ? `, ${b.city}` : ''}` : '';
  const cta = b.phone ? ` Call ${b.phone} or book online today.` : ' Book online today.';
  const services = (b.services || []).map(s => (typeof s === 'string' ? s : s.name)).filter(Boolean).slice(0, 3);
  const extra = services.length ? ` ${services.join(', ')} and more.` : '';
  let text = `${what}${where}.${extra}${cta}`;
  // Aim for the 150–160 characters Google shows: add a trust line when there is room.
  const trust = ` Trusted ${(b.primary_category || 'local experts').toLowerCase()}${place(b) ? ` serving ${place(b)} and nearby areas` : ''}.`;
  if (text.length < 140 && text.length + trust.length <= 160) text = `${what}${where}.${extra}${trust}${cta}`;
  return clip(text, 160);
}

function suggestAlt(src, b) {
  const file = decodeURIComponent((src.split('/').pop() || '').split('?')[0]).replace(/\.\w+$/, '').replace(/[-_]+/g, ' ').replace(/\d{3,}/g, '').trim();
  return clip(`${file ? `${file.replace(/^\w/, c => c.toUpperCase())} – ` : ''}${b.name}${place(b) ? `, ${place(b)}` : ''}`, 110);
}

function localBusinessSchema(b) {
  const data = {
    '@context': 'https://schema.org', '@type': 'LocalBusiness', name: b.name, url: b.website || undefined, telephone: b.phone || undefined,
    description: b.description || undefined,
    address: b.address ? { '@type': 'PostalAddress', streetAddress: b.address, addressLocality: b.city || undefined, addressCountry: 'IN' } : undefined,
    geo: b.lat != null ? { '@type': 'GeoCoordinates', latitude: b.lat, longitude: b.lng } : undefined
  };
  return `<script type="application/ld+json">\n${JSON.stringify(data, null, 2)}\n</script>`;
}

function sitemapXml(pages) {
  const urls = pages.filter(p => p.status < 400 && !p.noindex).map(p => `  <url><loc>${esc(p.url)}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`;
}

/* ── the fix guides ───────────────────────────────────────────────────── */

const GUIDES = {
  http_error: {
    title: 'Broken pages', effort: '10–30 min',
    why: 'Pages that return an error waste crawl budget, lose any links pointing to them, and send visitors to a dead end.',
    steps: ['Open each page below and confirm it is really missing.', 'If the content moved, add a permanent (301) redirect to the closest live page.', 'If it is gone for good, remove links to it from your menus, footer and sitemap.', 'Re-check this audit to confirm the errors are gone.'],
    code: (ctx) => ({ label: 'Redirect (Apache .htaccess)', text: ctx.items.map(i => `Redirect 301 ${pathOf(i.page?.url || '/old-page')} /`).join('\n') + '\n\n# Nginx:\n# location = /old-page { return 301 /new-page; }' })
  },
  javascript_only: {
    title: 'Pages empty without JavaScript', effort: '1–3 days (developer)',
    why: 'Search engines and AI assistants often read the raw HTML. If the text, links and contact details only appear after JavaScript runs, they may see an empty page and rank nothing.',
    steps: ['Ask your developer to enable server-side rendering (Next.js, Nuxt, Angular Universal) or pre-rendering (e.g. prerender.io) for these pages.', 'Make sure the business name, address, phone, headings and main text are in the HTML the server sends.', 'Test with "View page source": the text should be visible there, not only in the browser.', 'Re-audit; the pages should show a real word count.']
  },
  noindex: {
    title: 'Pages blocked from Google (noindex)', effort: '5 min',
    why: 'A noindex tag tells Google not to show the page in search at all. On a page you want to rank, it removes it completely.',
    steps: ['Open the page template or SEO plugin settings (Yoast, Rank Math: "Allow search engines to show this page").', 'Remove the robots noindex meta tag, or change it to the one below.', 'Check your server is not sending an "X-Robots-Tag: noindex" header.', 'Request indexing in Google Search Console after the change.'],
    code: () => ({ label: 'Replace the robots tag with', text: '<meta name="robots" content="index, follow">' })
  },
  missing_title: {
    title: 'Pages without a title', effort: '5 min per page', perPage: 'title',
    why: 'The title is the blue headline in Google results and the strongest on-page ranking signal. Without one, Google invents a title and click-through drops.',
    steps: ['Give every page a unique title of 50–60 characters.', 'Put the main keyword near the start and the business name at the end.', 'Use the suggestions below as a starting point and paste them into each page\'s SEO title field.']
  },
  title_length: {
    title: 'Titles too short or too long', effort: '5 min per page', perPage: 'title',
    why: 'Titles under 25 characters waste space that could carry keywords; over 60 characters get cut off in Google results.',
    steps: ['Rewrite each title to 50–60 characters.', 'Lead with what the page is about, end with the business name.', 'Avoid repeating the same title on several pages.']
  },
  missing_meta_description: {
    title: 'Pages without a meta description', effort: '5 min per page', perPage: 'meta',
    why: 'The meta description is the grey text under your title in Google. A good one earns the click; without it Google picks random text from the page.',
    steps: ['Write 150–160 characters per page: what it offers, where, and a reason to act.', 'Include the main keyword naturally and a call to action (call, book, visit).', 'Paste the suggestions below into each page\'s SEO description field and adjust the wording.']
  },
  h1_count: {
    title: 'Pages without exactly one H1 heading', effort: '10 min per page', perPage: 'h1',
    why: 'The H1 is the main heading Google and screen readers use to understand the page. None, or several competing H1s, blur what the page is about.',
    steps: ['Make sure each page has one H1 that states its topic (e.g. "Dental Implants in Aundh").', 'Turn any extra H1s into H2 sub-headings.', 'Keep the H1 close to, but not identical with, the title.']
  },
  thin_content: {
    title: 'Thin pages (under 300 words)', effort: '1–2 hours per page',
    why: 'Short pages rarely answer what searchers want, so Google prefers competitors with fuller answers.',
    steps: ['Expand each page to at least 300 words of useful content (600+ for service pages).', 'Cover: what the service is, who it is for, the process, prices or price ranges, and why choose you.', 'Add an FAQ section answering 3–5 real customer questions.', 'Mention the area you serve and link to related pages.']
  },
  missing_alt: {
    title: 'Images without alt text', effort: '2 min per image', perPage: 'alt',
    why: 'Alt text describes images for Google Images and screen readers. Missing alt text loses image-search traffic and fails accessibility checks.',
    steps: ['Add a short description (5–12 words) to every meaningful image.', 'Describe what is shown; include the business or area only where natural.', 'Leave alt="" only for purely decorative images.']
  },
  no_viewport: {
    title: 'Pages missing the mobile viewport tag', effort: '5 min',
    why: 'Without the viewport tag the page renders as a zoomed-out desktop page on phones, which Google\'s mobile-first index treats as not mobile friendly.',
    steps: ['Add the tag below inside <head> on every page (usually once, in the site template).', 'Check the pages on a phone afterwards.'],
    code: () => ({ label: 'Add inside <head>', text: '<meta name="viewport" content="width=device-width, initial-scale=1">' })
  },
  no_https: {
    title: 'Site not on HTTPS', effort: '30 min (hosting panel)',
    why: 'Browsers mark HTTP sites "Not secure", which scares visitors away, and Google uses HTTPS as a ranking signal.',
    steps: ['Turn on a free SSL certificate in your hosting panel (Let\'s Encrypt / AutoSSL).', 'Redirect all HTTP traffic to HTTPS (rule below).', 'Update the website address in Google Business Profile and Search Console.'],
    code: () => ({ label: 'Redirect HTTP to HTTPS (Apache .htaccess)', text: 'RewriteEngine On\nRewriteCond %{HTTPS} off\nRewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]' })
  },
  robots_blocks_all: {
    title: 'robots.txt blocks all crawlers', effort: '5 min',
    why: '"Disallow: /" tells every search engine to stay out of the whole site. Nothing can rank until it is removed.',
    steps: ['Edit /robots.txt in your site\'s root folder (or the SEO plugin\'s robots.txt editor).', 'Replace its contents with the version below.', 'In Search Console, open the robots.txt report to confirm Google sees the change.'],
    code: (ctx) => ({ label: 'robots.txt', text: `User-agent: *\nAllow: /\n\nSitemap: ${ctx.origin || 'https://yourdomain.com'}/sitemap.xml` })
  },
  no_sitemap: {
    title: 'No XML sitemap', effort: '15 min',
    why: 'A sitemap lists every page you want found, so Google discovers new and updated pages quickly.',
    steps: ['Most CMSs create one: enable it in Yoast / Rank Math (WordPress) or your site builder\'s SEO settings.', 'Otherwise upload the sitemap below (built from the pages we crawled) as /sitemap.xml.', 'Add the Sitemap line to robots.txt and submit the sitemap in Google Search Console.'],
    code: (ctx) => ({ label: 'sitemap.xml (from the crawled pages)', text: sitemapXml(ctx.pages), download: 'sitemap.xml' })
  },
  no_localbusiness_schema: {
    title: 'No LocalBusiness structured data', effort: '15 min',
    why: 'LocalBusiness schema tells Google your name, address, phone, hours and location in a machine-readable way. It supports rich results and ties the site to the Google Business Profile.',
    steps: ['Copy the code below; it is built from this business\'s saved details.', 'Paste it into the <head> of the home page and the contact page (or use a schema plugin).', 'Check it with Google\'s Rich Results Test, then re-audit.'],
    code: (ctx) => ({ label: 'LocalBusiness JSON-LD (from the business profile)', text: localBusinessSchema(ctx.business) }),
    link: ['Rich Results Test', 'https://search.google.com/test/rich-results']
  },
  duplicate_titles: {
    title: 'Duplicate page titles', effort: '5 min per page',
    why: 'When several pages share a title, Google cannot tell which one to rank and may show the wrong page.',
    steps: ['Give each page below its own title describing that page specifically.', 'Use the page\'s main heading or service name at the start of the title.']
  },
  slow_mobile: {
    title: 'Slow on mobile', effort: '2–6 hours', technical: true,
    why: 'Most local searches happen on phones. Slow pages lose visitors before they load and rank lower in Google\'s mobile results.',
    steps: ['Compress and resize images; serve WebP/AVIF and lazy-load images below the fold.', 'Defer or remove unused JavaScript and third-party scripts (chat widgets, trackers).', 'Enable caching and a CDN in your hosting or with a caching plugin.', 'Re-run the audit and compare Largest Contentful Paint (target under 2.5 s).'],
    link: ['Open in PageSpeed Insights', null]
  }
};

const LIGHTHOUSE = {
  'meta-description': 'missing_meta_description', 'document-title': 'missing_title', 'image-alt': 'missing_alt', 'is-crawlable': 'noindex', 'robots-txt': 'robots_blocks_all', 'http-status-code': 'http_error',
  'link-text': { title: 'Links with vague text', steps: ['Replace "click here", "read more" and similar link text with words that describe the destination (e.g. "see dental implant prices").', 'Keep link text short but specific.'] },
  'crawlable-anchors': { title: 'Links Google cannot follow', steps: ['Use normal <a href="/page"> links for navigation instead of JavaScript click handlers.', 'Avoid href="#" or javascript: links for real pages.'] },
  canonical: { title: 'Invalid canonical tag', steps: ['Each page should have one canonical link pointing to its own preferred URL.', 'Remove canonicals that point to other domains or to pages that do not exist.'] },
  hreflang: { title: 'Invalid hreflang tags', steps: ['Check language codes (e.g. en-IN, hi-IN) and that every hreflang page links back.'] },
  'structured-data': { title: 'Check structured data', steps: ['Run the page through Google\'s Rich Results Test and fix any errors it reports.'] }
};

function guideFor(code, sample, technical) {
  if (code.startsWith('lighthouse:')) {
    const id = code.slice(11);
    const known = LIGHTHOUSE[id];
    // Same problem the crawler checks page by page: reuse its guide, flagged by Lighthouse on the home page.
    if (typeof known === 'string') return { ...GUIDES[known], title: `${GUIDES[known].title} (Lighthouse, home page)`, technical: true, perPage: undefined, code: undefined };
    return {
      title: known?.title || sample.title, effort: '15–60 min', technical: true,
      why: sample.fix || 'Google Lighthouse flagged this SEO check as failing.',
      steps: known?.steps || ['Read Google\'s explanation linked below.', 'Apply the change on the affected pages, then re-run the audit.'],
      link: ['Google\'s guide', /^[a-z0-9-]+$/.test(id) ? `https://developer.chrome.com/docs/lighthouse/seo/${id}` : null]
    };
  }
  if (GUIDES[code]) return GUIDES[code];
  return { title: sample.title, why: sample.fix || '', steps: [sample.fix || 'Review and fix this issue.'], effort: '—' };
}

/* ── UI ───────────────────────────────────────────────────────────────── */

function CodeBlock({ label, text, download }) {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  const save = () => {
    const href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    Object.assign(document.createElement('a'), { href, download }).click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };
  return (
    <div className="rounded overflow-hidden ring-1 ring-slate-200">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-slate-50 border-b border-slate-200">
        <span className="text-11 font-semibold text-slate-600 inline-flex items-center gap-1.5"><FileCode size={12} /> {label}</span>
        <span className="flex gap-1">
          {download && <button type="button" onClick={save} className="h-7 px-2 rounded-md text-11 font-semibold text-slate-700 hover:bg-white inline-flex items-center gap-1 cursor-pointer"><Download size={12} /> Download</button>}
          <button type="button" onClick={copy} className="h-7 px-2 rounded-md text-11 font-semibold text-slate-700 hover:bg-white inline-flex items-center gap-1 cursor-pointer">{copied ? <><Check size={12} className="text-emerald-600" /> Copied</> : <><Copy size={12} /> Copy</>}</button>
        </span>
      </div>
      <pre className="px-3 py-2.5 text-11.5 leading-relaxed  text-slate-800 bg-white overflow-x-auto max-h-72 whitespace-pre-wrap break-all">{text}</pre>
    </div>
  );
}

function CopyLine({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" onClick={() => navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
      className="shrink-0 h-7 px-2 rounded-md text-11 font-semibold text-indigo-700 hover:bg-indigo-50 inline-flex items-center gap-1 cursor-pointer" aria-label="Copy suggestion">
      {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/** Per-page current value and a ready-made fix (title, meta description, H1, image alt text). */
function PerPage({ kind, items, business }) {
  return (
    <div className="rounded ring-1 ring-slate-200 divide-y divide-slate-100">
      {items.map(({ page, issue }, n) => {
        if (!page) return <div key={n} className="px-3 py-2 text-12 text-slate-700">{issue.title}</div>;
        const path = pathOf(page.url);
        if (kind === 'alt') {
          const imgs = page.images_without_alt || [];
          return (
            <div key={n} className="px-3 py-2.5">
              <div className="text-12  font-semibold text-slate-900">{path} <span className="font-sans font-normal text-slate-500">· {page.images_missing_alt} image{page.images_missing_alt === 1 ? '' : 's'} without alt text</span></div>
              {imgs.length ? imgs.map(src => {
                const tag = `<img src="${esc(src)}" alt="${esc(suggestAlt(src, business))}">`;
                return <div key={src} className="mt-1.5 flex items-center gap-2"><code className="flex-1 min-w-0 text-11 text-slate-700 bg-slate-50 rounded px-2 py-1 truncate" title={tag}>{tag}</code><CopyLine text={tag} /></div>;
              }) : <div className="mt-1 text-11 text-slate-500">Re-audit to list the exact images.</div>}
            </div>
          );
        }
        const current = kind === 'title' ? page.title : kind === 'meta' ? page.meta_description : page.h1;
        const suggestion = kind === 'title' ? suggestTitle(page, business) : kind === 'meta' ? suggestDescription(page, business) : (page.h1 || page.title || titleFromPath(page.url)).split(/\s[|–-]\s/)[0];
        const tag = kind === 'title' ? `<title>${esc(suggestion)}</title>` : kind === 'meta' ? `<meta name="description" content="${esc(suggestion)}">` : `<h1>${esc(suggestion)}</h1>`;
        return (
          <div key={n} className="px-3 py-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <a href={page.url} target="_blank" rel="noreferrer" className="text-12  font-semibold text-slate-900 hover:text-indigo-700">{path}</a>
              <span className="text-11 text-slate-500">{kind === 'h1' ? `${page.h1_count} H1 heading${page.h1_count === 1 ? '' : 's'} now` : `Now: ${current ? `${current.length} characters` : 'missing'}`}</span>
            </div>
            {current && kind !== 'h1' && <div className="mt-1 text-12 text-slate-500 line-through decoration-slate-300">{current}</div>}
            <div className="mt-1 flex items-start gap-2">
              <Sparkles size={13} className="text-violet-500 mt-0.5 shrink-0" />
              <span className="flex-1 min-w-0 text-12.5 text-slate-900">{suggestion} {kind !== 'h1' && <span className="text-11 text-slate-400 tabular-nums">({suggestion.length})</span>}</span>
              <CopyLine text={tag} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Ubold-style activity timeline: a bordered round icon per item on a vertical line, a right-aligned
// marker on the left (the estimated gain, where the theme shows a time), bold title, badges, action buttons.
const LEVEL_STYLE = {
  critical: { icon: OctagonAlert, ring: 'border-red-400 text-red-500', badge: 'bg-red-50 text-red-600', label: 'Critical' },
  serious: { icon: TriangleAlert, ring: 'border-amber-400 text-amber-500', badge: 'bg-amber-50 text-amber-600', label: 'Serious' },
  warning: { icon: CircleAlert, ring: 'border-sky-400 text-sky-500', badge: 'bg-sky-50 text-sky-600', label: 'Warning' },
  info: { icon: Lightbulb, ring: 'border-slate-300 text-slate-400', badge: 'bg-slate-100 text-slate-500', label: 'Info' }
};

function ImprovementCard({ group, ctx, open, onToggle, last }) {
  const g = group.guide;
  const st = LEVEL_STYLE[group.level] || LEVEL_STYLE.info;
  const Icon = st.icon;
  const code = g.code?.({ ...ctx, items: group.items });
  const gain = group.gain > 0 ? (group.gain < 1 ? group.gain.toFixed(1) : Math.round(group.gain)) : null;
  return (
    <div className="flex items-stretch">
      <div className="w-16 shrink-0 pr-3 pt-2 text-right">
        {gain ? <span className="inline-flex items-center gap-1 text-12 font-semibold text-emerald-600" title="Estimated on-page score gain"><TrendingUp size={12} />+{gain}</span> : <span className="text-12 text-slate-300">—</span>}
      </div>
      <div className="flex flex-col items-center shrink-0">
        <span className={`w-9 h-9 rounded-full border-2 bg-white flex items-center justify-center ${st.ring}`}><Icon size={16} /></span>
        {!last && <span className="flex-1 w-px bg-slate-200 my-1" />}
      </div>
      <div className={`flex-1 min-w-0 pl-4 ${last ? '' : 'pb-6'}`}>
        <p className="text-14 text-slate-700 leading-snug pt-1.5"><strong className="text-slate-900">{g.title}</strong>{g.why && <span className="text-slate-500"> {g.why.split(/(?<=[.!?])\s/)[0]}</span>}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={onToggle} className={`h-7 px-2.5 rounded text-12 font-semibold border inline-flex items-center gap-1.5 cursor-pointer transition-colors ${open ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-indigo-200 text-indigo-600 hover:bg-indigo-50'}`}>
            <BookOpen size={12} /> {open ? 'Hide fix' : 'How to fix'} {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {g.link && (g.link[1] || (group.code === 'slow_mobile' && ctx.origin)) && (
            <a href={g.link[1] || `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(ctx.origin)}`} target="_blank" rel="noreferrer" className="h-7 px-2.5 rounded text-12 font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1.5">{g.link[0]} <ExternalLink size={11} /></a>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-11.5 text-slate-400">
          <span className={`px-2 py-0.5 rounded font-semibold ${st.badge}`}>{st.label}</span>
          <span className="px-2 py-0.5 rounded border border-slate-200 bg-slate-50 text-slate-500">{g.technical ? 'Technical' : group.area}</span>
          <span>{group.pageCount ? `${group.pageCount} page${group.pageCount === 1 ? '' : 's'}` : 'Whole site'}{g.effort ? ` · ${g.effort}` : ''}</span>
        </div>
        {open && (
          <div className="mt-3 rounded border border-slate-200 bg-slate-50/50 p-4 space-y-4">
            {g.why && <div><div className="text-11 font-semibold   text-slate-500 mb-1">Why it matters</div><p className="text-13 text-slate-700 leading-relaxed">{g.why}</p></div>}
            <div>
              <div className="text-11 font-semibold   text-slate-500 mb-1.5">How to fix</div>
              <ol className="space-y-1.5">{g.steps.map((x, i) => <li key={i} className="flex gap-2.5 text-13 text-slate-800"><span className="w-5 h-5 rounded-full bg-indigo-50 text-indigo-600 text-11 font-bold flex items-center justify-center shrink-0 mt-px">{i + 1}</span><span>{x}</span></li>)}</ol>
            </div>
            {g.perPage && <div><div className="text-11 font-semibold   text-slate-500 mb-1.5">Suggested fix for each page</div><PerPage kind={g.perPage} items={group.items} business={ctx.business} /></div>}
            {code && <CodeBlock {...code} />}
            {group.code === 'slow_mobile' && ctx.opportunities?.length > 0 && (
              <div>
                <div className="text-11 font-semibold   text-slate-500 mb-1.5">Biggest speed wins on this site</div>
                <ul className="rounded ring-1 ring-slate-200 bg-white divide-y divide-slate-100">{ctx.opportunities.map(o => <li key={o.title} className="px-3 py-2 flex justify-between gap-3 text-12.5"><span className="text-slate-800">{o.title}</span><span className="text-slate-500 tabular-nums shrink-0">saves {(o.savings_ms / 1000).toFixed(1)} s</span></li>)}</ul>
              </div>
            )}
            {group.code === 'duplicate_titles' && group.items[0]?.issue?.titles && (
              <div className="rounded ring-1 ring-slate-200 bg-white px-3 py-2 text-12 text-slate-700 space-y-1">{group.items[0].issue.titles.map(t => <div key={t}>“{t}” is used on {(group.items[0].issue.pages || []).length ? `${(group.items[0].issue.pages || []).filter(u => ctx.pages.find(p => p.url === u)?.title === t).map(pathOf).join(', ') || 'several pages'}` : 'several pages'}</div>)}</div>
            )}
            {!g.perPage && group.pageCount > 0 && (
              <div>
                <div className="text-11 font-semibold   text-slate-500 mb-1.5">Affected pages</div>
                <div className="flex flex-wrap gap-1.5">{group.items.filter(i => i.page).map(i => <a key={i.page.url} href={i.page.url} target="_blank" rel="noreferrer" className="text-11.5  px-2 py-1 rounded bg-white ring-1 ring-inset ring-slate-200 text-slate-700 hover:text-indigo-600 inline-flex items-center gap-1">{pathOf(i.page.url)} <ExternalLink size={10} /></a>)}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Improvements({ issues, pages, business, score, technical, onRecheck, rechecking }) {
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(null);
  const ctx = { business, pages, origin: domainOf(business.website || pages[0]?.url || ''), opportunities: technical?.opportunities || [] };

  const groups = useMemo(() => {
    // Each crawled page keeps its own issues; older audits only have the path at the start of the title.
    const byTitle = Object.fromEntries(pages.flatMap(p => (p.issues || []).map(i => [i.title, p])));
    const byPath = Object.fromEntries(pages.map(p => [new URL(p.url, 'http://x').pathname, p]));
    const map = {};
    issues.forEach(issue => {
      const code = codeFor(issue, technical);
      const g = map[code] || (map[code] = { code, area: issue.area, level: issue.level, items: [], sample: issue });
      const path = PAGE_LEVEL.has(code) ? (issue.title.match(/^(\/\S*?)(?::|\s)/) || [])[1] : null;
      g.items.push({ issue, page: PAGE_LEVEL.has(code) ? byTitle[issue.title] || byPath[path] || null : null });
      if (LEVEL_ORDER[issue.level] < LEVEL_ORDER[g.level]) g.level = issue.level;
    });
    const n = Math.max(pages.length, 1);
    return Object.values(map).map(g => {
      const guide = guideFor(g.code, g.sample, technical);
      const pageCount = g.items.filter(i => i.page).length;
      const technicalGroup = !!guide.technical || g.code.startsWith('lighthouse:') || g.code === 'slow_mobile';
      const cost = g.items.reduce((s, i) => s + (WEIGHT[i.issue.level] ?? 1), 0);
      const gain = technicalGroup ? 0 : PAGE_LEVEL.has(g.code) ? (cost / n) * 4 : cost;
      return { ...g, guide, pageCount, technical: technicalGroup, gain: Math.min(gain, 100 - (score ?? 0)) };
    }).sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || b.gain - a.gain || b.items.length - a.items.length);
  }, [issues, pages, score, technical]);

  const shown = groups.filter(g => filter === 'all' || (filter === 'technical' ? g.technical : !g.technical));
  const top3 = groups.filter(g => !g.technical).slice(0, 3).reduce((s, g) => s + g.gain, 0);
  const chip = (on) => `h-8 px-3 rounded-lg text-12 font-semibold cursor-pointer ${on ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800'}`;

  return (
    <Card title={`Improvements (${groups.length})`}
      subtitle={groups.length ? `Ranked by what to fix first.${top3 >= 1 ? ` Fixing the top 3 on-page items should add about +${Math.round(top3)} points.` : ''}` : 'Nothing to improve right now'}
      action={onRecheck && <Button size="sm" icon={RotateCw} busy={rechecking} onClick={onRecheck}>Re-check after fixing</Button>}>
      {groups.length === 0 ? (
        <div className="py-8 text-center text-13 text-slate-600"><Wrench size={24} className="mx-auto text-emerald-500 mb-2" />Every page passed the on-page checks. Re-audit after publishing new pages.</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="flex gap-0.5 p-0.5 rounded bg-slate-100">
              {[['all', 'All', groups.length], ['onpage', 'On-page', groups.filter(g => !g.technical).length], ['technical', 'Technical & speed', groups.filter(g => g.technical).length]].map(([id, l, c]) => <button key={id} type="button" className={chip(filter === id)} onClick={() => setFilter(id)}>{l} <span className="opacity-60">{c}</span></button>)}
            </div>
            <span className="ml-auto text-11 text-slate-400 inline-flex items-center gap-1"><Clock size={11} /> The number on the left is the estimated score gain</span>
          </div>
          <div className="space-y-5">
            {LEVELS_SHOWN.map(level => {
              const rows = shown.filter(g => g.level === level);
              if (!rows.length) return null;
              return (
                <div key={level}>
                  <h6 className="text-12 font-bold  tracking-wide text-slate-400 mb-3 flex items-center gap-2">{LEVEL_STYLE[level].label}<span className={`px-1.5 py-px rounded text-11 ${LEVEL_STYLE[level].badge}`}>{rows.length}</span></h6>
                  {rows.map((g, i) => <ImprovementCard key={g.code} group={g} ctx={ctx} last={i === rows.length - 1} open={open === g.code} onToggle={() => setOpen(open === g.code ? null : g.code)} />)}
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}
