import React, { useMemo, useRef, useState } from 'react';
import { ImagePlus, Loader2, CheckCircle2, AlertTriangle, Sparkles, Monitor, Smartphone, Eye, EyeOff, Upload } from 'lucide-react';
import { Button, inputCls } from './SeoUi';
import { api } from './seoApi';
import { imagesHtml, contentImageSrc } from './ContentImageUploader';

/**
 * Smart image plan (Images & Analysis step only). Reads the whole article (words, H2 sections, paragraphs), works out how
 * many pictures it needs, of which kind and size, and exactly where (never in the FAQs, Why Choose or the call to action,
 * never right under a heading, never two in a row). Each planned place is a slot: drop pictures on it and they are
 * uploaded (the same optimized-WebP upload as "Article images"), placed in that spot and saved. One picture is shown full
 * width, two side by side, three or more as a gallery: the same three layouts publishing already sends, so nothing in
 * saving or publishing changes. The plan itself is only calculated here; it is never written into the article.
 */

const EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif', 'heic', 'heif'];
const MAX_MB = 15;
const plain = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
const wordsIn = (h) => (plain(h) ? plain(h).split(' ').length : 0);
const kb = (n) => (n == null ? '—' : n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const dimsOf = (s) => { const m = String(s || '').match(/(\d+)\s*[×x]\s*(\d+)/); return m ? { w: Number(m[1]), h: Number(m[2]) } : null; };
const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(new Error('The file could not be read.'));
  r.readAsDataURL(file);
});

// sections that stay clean: FAQs, Why Choose, the call to action and the conclusion
const SKIP = /frequently asked|\bfaqs?\b|why choose|contact|ready to|get started|conclusion|final thoughts|summary|call to action/i;
// image kinds, picked from what each section is about (sizes: the starting standards; WebP limits as on the website)
const TYPES = {
  contextual: { label: 'Contextual photo', w: 800, h: 1200, shape: '2:3 portrait', maxKb: 150 },
  detail: { label: 'Detail close-up', w: 1200, h: 800, shape: '3:2 landscape', maxKb: 150 },
  infographic: { label: 'Infographic / chart', w: 1200, h: 1600, shape: '3:4 portrait', maxKb: 150 },
  gallery: { label: 'Comparison gallery (3)', w: 600, h: 900, shape: '2:3 portrait × 3', maxKb: 150, many: 3 },
};
const typeOf = (heading, galleryUsed) => {
  if (!galleryUsed && /\b(compar|vs\.?|versus|options|types|styles|looks|ideas|trends|collection|designs|variet|choos)/i.test(heading)) return 'gallery';
  if (/\b(price|pricing|cost|estimate|budget|rate|fee|steps?|process|how to|checklist|timeline|calculat|plan)/i.test(heading)) return 'infographic';
  if (/\b(fabric|detail|embroider|jewel|accessor|care|clean|maint|quality|material|textur|fit|size)/i.test(heading)) return 'detail';
  return 'contextual';
};
const subjectFor = (type, heading, b) => ({
  contextual: `A real photo from ${b.name} that shows “${heading}” (your own outfit, shop or customer, not a stock picture)`,
  detail: `A close-up of what “${heading}” explains: fabric, embroidery, finish or accessories`,
  infographic: `A simple chart, table or step graphic that explains “${heading}” at a glance`,
  gallery: `Three outfits or styles side by side that compare what “${heading}” talks about`,
}[type]);
// starting counts by length; about one picture per 350 words inside that range
const BANDS = [[900, 2, 2], [1500, 3, 4], [2000, 4, 5], [2500, 5, 7], [Infinity, 7, 9]];

/** The article read as sections: the introduction, then every H2 up to the next one (the JSON-LD schema is left out). */
export function analyseArticle(html) {
  const src = String(html || '');
  const schemaAt = src.search(/<script\b[^>]*application\/ld\+json/i);
  const body = schemaAt < 0 ? src : src.slice(0, schemaAt);
  const heads = [...body.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)];
  const h1 = body.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/i);
  const bounds = [
    { heading: 'Introduction', intro: true, start: h1 ? h1.index + h1[0].length : 0, end: heads[0]?.index ?? body.length },
    ...heads.map((m, i) => ({ heading: plain(m[1]), start: m.index + m[0].length, end: heads[i + 1]?.index ?? body.length })),
  ];
  const sections = bounds.map((s, i) => {
    const part = body.slice(s.start, s.end);
    const paras = [...part.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(p => ({ end: s.start + p.index + p[0].length, words: wordsIn(p[1]) })).filter(p => p.words > 0);
    const images = [...part.matchAll(/<img\b[^>]*>/gi)].map(m => (m[0].match(/\bsrc\s*=\s*"([^"]*)"/i) || [])[1]).filter(Boolean);
    return { ...s, id: `s${i}`, i, paras, images, words: wordsIn(part.replace(/<figure\b[\s\S]*?<\/figure>/gi, ' ')), skip: !s.intro && (SKIP.test(s.heading) || /blog-cta-box/i.test(part)) };
  });
  // text between pictures, and pictures with nothing between them (a row or gallery counts as one block)
  const blocks = body.replace(/<div\b[^>]*data-gz-layout[^>]*>[\s\S]*?<\/div>/gi, '<GZBLOCK>').replace(/<figure\b[\s\S]*?<\/figure>/gi, '<GZBLOCK>').replace(/<img\b[^>]*>/gi, '<GZBLOCK>');
  const runs = blocks.split('<GZBLOCK>').map(wordsIn);
  const adjacent = (blocks.match(/<GZBLOCK>(?:\s|<p>\s*<\/p>|<br\s*\/?>)*(?=<GZBLOCK>)/g) || []).length;
  return { sections, title: h1 ? plain(h1[0]) : '', words: sections.reduce((n, s) => n + s.words, 0), longestRun: Math.max(0, ...runs), adjacent };
}

/** Where a picture goes in a section: after its first real paragraph (40+ words), never straight under the heading. */
const slotAt = (s) => (s.paras.find(p => p.words >= 40) || s.paras[0])?.end ?? s.end;

/** How many pictures, which kind and where. Sections that already hold a picture count as filled slots. */
export function planImages(html, b) {
  const a = analyseArticle(html);
  const [, min, max] = BANDS.find(([upTo]) => a.words < upTo);
  const eligible = a.sections.filter(s => !s.skip && s.paras.length && (s.words >= 60 || s.images.length));
  const target = Math.min(Math.max(min, Math.min(max, Math.round(a.words / 350))), eligible.length); // never more than places that make sense
  const filled = eligible.filter(s => s.images.length).slice(0, target);
  const rest = eligible.filter(s => !s.images.length);
  const need = target - filled.length;
  const picked = new Set(filled.map(s => s.id));
  if (need > 0 && rest.length) {
    const intro = rest.find(s => s.intro);
    if (intro) picked.add(intro.id);
    const others = rest.filter(s => !s.intro);
    const left = target - picked.size;
    for (let k = 0; k < left && others.length; k += 1) {
      let idx = Math.min(others.length - 1, Math.floor(((k + 0.5) * others.length) / left));
      while (picked.has(others[idx]?.id) && idx < others.length - 1) idx += 1;
      if (others[idx]) picked.add(others[idx].id);
    }
  }
  let galleryUsed = false;
  const slots = a.sections.filter(s => picked.has(s.id)).map((s, n) => {
    const type = s.intro ? 'contextual' : typeOf(s.heading, galleryUsed);
    if (type === 'gallery') galleryUsed = true;
    return { ...s, n: n + 1, type, spec: TYPES[type], filled: s.images.length > 0, at: slotAt(s), subject: subjectFor(type, s.intro ? (a.title || b.primary_category || 'this article') : s.heading, b) };
  });
  return { ...a, target, slots, eligible: eligible.length };
}

function Bar({ label, value }) {
  const v = value == null ? null : Math.round(value);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11.5px]"><span className="text-slate-600">{label}</span><span className="font-semibold tabular-nums text-slate-800">{v == null ? 'n/a' : `${v}%`}</span></div>
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full rounded-full ${v == null ? '' : v >= 80 ? 'bg-emerald-500' : v >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${v || 0}%` }} /></div>
    </div>
  );
}

export default function SmartImagePlanner({ b, article, draft, onDraftChange, onInsertSave, onUploaded, rows, featSrc, toast }) {
  const plan = useMemo(() => planImages(draft, b), [draft, b]);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [alts, setAlts] = useState({}); // slot id -> ALT text typed here
  const [busy, setBusy] = useState(''); // slot id, or 'all'
  const [over, setOver] = useState('');
  const [preview, setPreview] = useState('');
  const fileRefs = useRef({});
  const allRef = useRef(null);
  const primary = article.keyword || '';
  const altOf = (s) => alts[s.id] ?? `${s.intro ? (article.title || primary) : s.heading}${primary && !(s.heading || '').toLowerCase().includes(primary.toLowerCase()) ? ` – ${primary}` : ''}`.slice(0, 125);

  // ---- featured image: shape and size against the website's own posts (read on this page by "Your website's blog images")
  const site = (() => { try { return JSON.parse(sessionStorage.getItem(`growzen.siteImages.${b.id}.${article.id}`) || 'null'); } catch { return null; } })();
  const want = dimsOf(site?.featured?.typical) || { w: 1000, h: 1500 };
  const featRow = rows.find(r => r.kind === 'Featured');
  const fd = dimsOf(featRow?.dims);
  const featNotes = [];
  if (!featRow) featNotes.push('No featured image yet: add one on the AI Draft step.');
  else if (fd) {
    if (Math.abs(fd.w / fd.h - want.w / want.h) > 0.08) featNotes.push(`Its shape (${fd.w} × ${fd.h}) differs from your posts (${want.w} × ${want.h}): crop it to the same shape so the cards on your blog page line up.`);
    if (fd.w < want.w * 0.8) featNotes.push(`It is ${fd.w} px wide; your posts use ${want.w} px. Use a larger picture (it is never enlarged, so it would look soft).`);
    if (featRow.bytes > 200 * 1024) featNotes.push(`It is ${kb(featRow.bytes)}; keep the featured image under 200 KB.`);
  }

  // ---- upload pictures, then place them in their slots (positions read again from the latest article) and save once
  const uploadFiles = async (files) => {
    const out = [], errs = [];
    for (const file of files) {
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      try {
        if (!EXTS.includes(ext)) throw new Error(`".${ext}" is not an image GrowZen can use`);
        if (file.size > MAX_MB * 1048576) throw new Error(`larger than ${MAX_MB} MB`);
        const r = await api(`/businesses/${b.id}/articles/${article.id}/content-images`, { method: 'POST', body: { data_url: await readAsDataUrl(file), filename: file.name } });
        out.push({ name: r.name, size: r.size, info: r.info, file: file.name });
      } catch (e) { errs.push(`${file.name}: ${e.message || e}`); }
    }
    if (out.length && onUploaded) onUploaded();
    return { out, errs };
  };
  const placeAll = async (groups) => { // groups: [{ slotId, items }]
    let next = draftRef.current || '';
    const fresh = planImages(next, b);
    const notes = [];
    const inserts = groups.map(g => {
      const s = fresh.sections.find(x => x.id === g.slotId);
      const slot = plan.slots.find(x => x.id === g.slotId);
      const alt = slot ? altOf(slot) : '';
      const items = g.items.map((x, k) => ({ ...x, alt: g.items.length > 1 ? `${alt} (${k + 1} of ${g.items.length})` : alt, caption: '' }));
      const layout = items.length >= 3 ? 'gallery' : items.length === 2 ? 'row-2' : 'single';
      g.items.forEach(x => {
        if (slot && x.info?.width && x.info.width < slot.spec.w * 0.75) notes.push(`${x.file} is ${x.info.width} px wide (suggested ${slot.spec.w} px)`);
        if (slot && x.size > slot.spec.maxKb * 1024) notes.push(`${x.file} is ${kb(x.size)} (aim under ${slot.spec.maxKb} KB)`);
      });
      return { at: s ? slotAt(s) : next.length, html: `\n${imagesHtml(b, article.id, items, layout)}\n` };
    }).sort((x, y) => y.at - x.at); // from the end, so earlier positions stay right
    inserts.forEach(x => { next = next.slice(0, x.at) + x.html + next.slice(x.at); });
    onDraftChange(next);
    const n = groups.reduce((s, g) => s + g.items.length, 0);
    try {
      if (onInsertSave) await onInsertSave(next);
      toast(`${n} picture${n === 1 ? '' : 's'} placed in ${groups.length} slot${groups.length === 1 ? '' : 's'}${onInsertSave ? ' and saved' : '. Click "Save changes" to keep them'}.${notes.length ? ` Check: ${notes.slice(0, 2).join('; ')}.` : ''}`);
    } catch (e) {
      toast(`Placed in the article, but saving failed: ${e.message || e}. Click "Save changes".`);
    }
  };
  const fillSlot = async (slot, fileList) => {
    const files = [...(fileList || [])].slice(0, slot.spec.many || 3);
    if (!files.length) return;
    setBusy(slot.id);
    try {
      const { out, errs } = await uploadFiles(files);
      if (errs.length) toast(errs.join(' · '));
      if (out.length) await placeAll([{ slotId: slot.id, items: out }]);
    } finally { setBusy(''); if (fileRefs.current[slot.id]) fileRefs.current[slot.id].value = ''; }
  };
  const waiting = plan.slots.filter(s => !s.filled);
  const fillAll = async (fileList) => {
    const files = [...(fileList || [])];
    if (!files.length || !waiting.length) return;
    setBusy('all');
    try {
      const { out, errs } = await uploadFiles(files);
      if (errs.length) toast(errs.join(' · '));
      const groups = [];
      let k = 0;
      for (const s of waiting) { // in article order: a gallery slot takes up to 3, the others one each
        const take = s.spec.many ? Math.min(s.spec.many, Math.max(1, out.length - k - (waiting.length - groups.length - 1))) : 1;
        if (k >= out.length) break;
        groups.push({ slotId: s.id, items: out.slice(k, k + take) });
        k += take;
      }
      if (groups.length) await placeAll(groups);
      if (k < out.length) toast(`${out.length - k} extra picture${out.length - k === 1 ? ' is' : 's are'} uploaded but not placed: find ${out.length - k === 1 ? 'it' : 'them'} under “Article images”.`);
    } finally { setBusy(''); if (allRef.current) allRef.current.value = ''; }
  };

  // ---- visual content quality (updates with every change to the article's pictures)
  const body = rows.filter(r => r.kind !== 'Featured');
  const pct = (ok, all) => (all ? (ok / all) * 100 : null);
  const imgTags = [...String(draft || '').replace(/<script\b[\s\S]*?<\/script>/gi, '').matchAll(/<img\b[^>]*>/gi)].map(m => m[0]);
  const scores = {
    coverage: plan.target ? (plan.slots.filter(s => s.filled).length / plan.target) * 100 : 100,
    quality: pct(body.filter(r => !(r.bytes > 150 * 1024) && !((dimsOf(r.dims)?.w || 9999) < 600)).length, body.length),
    alt: pct(body.filter(r => (r.alt || '').trim()).length, body.length),
    spacing: Math.max(0, 100 - plan.adjacent * 25 - (plan.longestRun > 500 ? 15 : 0) - (plan.longestRun > 900 ? 15 : 0)),
    responsive: pct(imgTags.filter(t => /\bwidth="\d+"/.test(t) && /\bheight="\d+"/.test(t) && /loading="lazy"/.test(t)).length, imgTags.length),
    broken: rows.length ? 100 - (pct(rows.filter(r => r.status?.tone === 'bad').length, rows.length) || 0) : null,
  };
  const weights = { coverage: 30, quality: 15, alt: 15, spacing: 15, responsive: 10, broken: 15 };
  const used = Object.keys(weights).filter(k => scores[k] != null);
  const total = Math.round(used.reduce((s, k) => s + scores[k] * weights[k], 0) / Math.max(1, used.reduce((s, k) => s + weights[k], 0)));
  const verdict = total >= 85 ? ['Great image coverage', 'text-emerald-700'] : total >= 65 ? ['Good, some places still need a picture', 'text-amber-700'] : ['Needs pictures', 'text-rose-700'];
  const done = plan.slots.filter(s => s.filled).length;

  // ---- full article preview with the pictures in place (waiting slots shown as dashed boxes; nothing is saved)
  const previewDoc = useMemo(() => {
    if (!preview) return '';
    let html = String(draft || '').replace(/<script\b[\s\S]*?<\/script>/gi, '');
    [...plan.slots].filter(s => !s.filled).sort((x, y) => y.at - x.at).forEach(s => {
      html = html.slice(0, s.at) + `<div class="gz-slot">Image slot ${s.n} · ${s.spec.label} · ${s.spec.w} × ${s.spec.h}</div>` + html.slice(s.at);
    });
    const hero = featSrc ? `<img class="hero" src="${featSrc}" alt="">` : '';
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{margin:0;background:#fff;color:#1e293b;font:16px/1.75 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:24px 18px 48px}h1{font-size:30px;line-height:1.25;margin:16px 0}h2{font-size:22px;line-height:1.3;margin:36px 0 10px}h3{font-size:17px;margin:22px 0 6px}
img{max-width:100%;height:auto;border-radius:10px;display:block;margin:0 auto}figure{margin:26px 0}figcaption{font-size:13px;color:#64748b;text-align:center;margin-top:6px}
.hero{width:100%;max-height:440px;object-fit:cover}.gz-slot{border:2px dashed #a5b4fc;background:#eef2ff;color:#4338ca;border-radius:12px;padding:30px 12px;text-align:center;font:600 13px system-ui,sans-serif;margin:26px 0}
.blog-cta-box{padding:20px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0}</style></head><body><div class="wrap">${hero}${html}</div></body></html>`;
  }, [preview, draft, plan, featSrc]);

  const typeTone = { contextual: 'bg-indigo-50 text-indigo-700', detail: 'bg-amber-50 text-amber-800', infographic: 'bg-sky-50 text-sky-800', gallery: 'bg-fuchsia-50 text-fuchsia-800' };

  return (
    <div className="rounded-xl border border-indigo-200 bg-gradient-to-b from-indigo-50/60 to-white p-3.5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[240px] flex-1">
          <div className="text-[13px] font-bold text-slate-900 inline-flex items-center gap-1.5"><Sparkles size={14} className="text-indigo-600" />Smart image plan</div>
          <div className="text-[11.5px] text-slate-600">Worked out from this whole article: how many pictures it needs, which kind and size, and exactly where. Drop pictures on a slot and they are placed and saved; 1 picture shows full width, 2 side by side, 3 as a gallery, and every layout fits phones.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={allRef} type="file" multiple accept={EXTS.map(e => `.${e}`).join(',') + ',image/*'} className="hidden" onChange={e => fillAll(e.target.files)} />
          <Button size="sm" variant="primary" icon={Upload} busy={busy === 'all'} disabled={Boolean(busy) || !waiting.length} onClick={() => allRef.current?.click()}>Fill all slots</Button>
          <Button size="sm" icon={preview ? EyeOff : Eye} onClick={() => setPreview(p => (p ? '' : 'desktop'))}>{preview ? 'Hide preview' : 'Preview article'}</Button>
        </div>
      </div>

      {/* 1. full blog analysis */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {[['Words', plan.words.toLocaleString('en-IN')], ['Sections (H2)', plan.sections.length - 1], ['Pictures planned', `1 featured + ${plan.target}`], ['Placed', `${done} of ${plan.target}`],
          ['Longest text without a picture', `${plan.longestRun.toLocaleString('en-IN')} words`]].map(([l, v]) => (
          <div key={l} className="p-2.5 rounded-lg bg-white border border-slate-200"><div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">{l}</div><div className="text-[14px] font-bold text-slate-900 tabular-nums">{v}</div></div>
        ))}
      </div>
      <div>
        <div className="flex justify-between text-[11.5px] mb-1"><span className="font-semibold text-slate-700">{done} of {plan.target} pictures added</span><span className="tabular-nums text-slate-500">{plan.target ? Math.round((done / plan.target) * 100) : 100}%</span></div>
        <div className="h-2 rounded-full bg-slate-200 overflow-hidden"><div className="h-full bg-indigo-600 rounded-full transition-all" style={{ width: `${plan.target ? (done / plan.target) * 100 : 100}%` }} /></div>
        {plan.target < Math.round(plan.words / 350) && <p className="mt-1 text-[11px] text-slate-500">Only {plan.eligible} section{plan.eligible === 1 ? ' has' : 's have'} room for a picture, so the plan stops there: pictures are never added just to reach a number.</p>}
      </div>

      {/* featured image check */}
      <div className={`flex items-start gap-2 p-2.5 rounded-lg border text-[12px] ${featNotes.length ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-emerald-50 border-emerald-200 text-emerald-900'}`}>
        {featNotes.length ? <AlertTriangle size={14} className="shrink-0 mt-0.5" /> : <CheckCircle2 size={14} className="shrink-0 mt-0.5" />}
        <div><b>Featured image</b> · suggested {want.w} × {want.h} px{site?.featured?.typical ? ' (as on your website)' : ''}, under 200 KB.{' '}
          {featNotes.length ? featNotes.join(' ') : 'Matches your website.'}</div>
      </div>

      {/* 2-3. the slots */}
      {plan.slots.length === 0 ? (
        <p className="text-[12px] text-slate-500">This article has no section long enough for a picture yet. Write or generate the article first.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {plan.slots.map(s => (
            <div key={s.id} className={`rounded-xl border bg-white p-3 space-y-2 ${s.filled ? 'border-emerald-200' : 'border-slate-200'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[12.5px] font-bold text-slate-900 truncate">Slot {s.n} · {s.intro ? 'Introduction' : s.heading}</div>
                  <div className="text-[11px] text-slate-500">After the first full paragraph of {s.intro ? 'the introduction' : 'this section'}</div>
                </div>
                <span className={`shrink-0 text-[10.5px] font-semibold px-2 py-0.5 rounded-full ${s.filled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{s.filled ? 'Added' : 'Waiting'}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className={`px-2 py-0.5 rounded-full font-semibold ${typeTone[s.type]}`}>{s.spec.label}</span>
                <span className="text-slate-600 tabular-nums">{s.spec.w} × {s.spec.h} px · {s.spec.shape} · WebP under {s.spec.maxKb} KB</span>
              </div>
              <p className="text-[11.5px] text-slate-700"><b>Suggested picture:</b> {s.subject}</p>
              {s.filled ? (
                <div className="flex gap-2">{s.images.slice(0, 3).map(src => <img key={src} src={src} alt="" className="h-20 w-20 object-cover rounded-lg ring-1 ring-slate-200 bg-slate-100" loading="lazy" />)}
                  <span className="self-center text-[11.5px] text-emerald-700 inline-flex items-center gap-1"><CheckCircle2 size={12} />{s.images.length} picture{s.images.length === 1 ? '' : 's'} in this section</span></div>
              ) : (
                <>
                  <input className={inputCls} value={altOf(s)} maxLength={125} onChange={e => setAlts(a => ({ ...a, [s.id]: e.target.value }))} aria-label={`ALT text for slot ${s.n}`} placeholder="ALT text (describes the picture)" />
                  <input ref={el => { fileRefs.current[s.id] = el; }} type="file" multiple accept={EXTS.map(e => `.${e}`).join(',') + ',image/*'} className="hidden" onChange={e => fillSlot(s, e.target.files)} />
                  <button type="button" disabled={Boolean(busy)} onClick={() => fileRefs.current[s.id]?.click()}
                    onDragOver={e => { e.preventDefault(); setOver(s.id); }} onDragLeave={() => setOver('')} onDrop={e => { e.preventDefault(); setOver(''); fillSlot(s, e.dataTransfer.files); }}
                    className={`w-full rounded-lg border-2 border-dashed px-3 py-4 flex flex-col items-center gap-0.5 cursor-pointer transition-colors disabled:cursor-wait ${over === s.id ? 'border-indigo-400 bg-indigo-50' : 'border-slate-300 bg-slate-50 hover:border-indigo-300 hover:bg-indigo-50/50'}`}>
                    {busy === s.id || busy === 'all' ? <Loader2 size={18} className="animate-spin text-indigo-600" /> : <ImagePlus size={18} className="text-indigo-600" />}
                    <span className="text-[12px] font-semibold text-slate-800">{busy === s.id ? 'Uploading and placing…' : s.spec.many ? 'Drop 3 pictures here, or click' : 'Drop a picture here, or click'}</span>
                    <span className="text-[10.5px] text-slate-500">1 = full width · 2 = side by side · 3 = gallery</span>
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-slate-500">Never placed: in the FAQs, “Why Choose”, the call to action or the conclusion; straight under a heading; or next to another picture. A section without a full paragraph is skipped and the picture goes to the next good place.</p>

      {/* 5. visual content quality */}
      <div className="grid grid-cols-1 md:grid-cols-[180px_minmax(0,1fr)] gap-4 p-3 rounded-xl bg-white border border-slate-200">
        <div className="flex flex-col justify-center">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">Visual content quality</div>
          <div className="text-[34px] font-bold text-slate-900 tabular-nums leading-tight">{total}<span className="text-[15px] text-slate-400">/100</span></div>
          <div className={`text-[12px] font-semibold ${verdict[1]}`}>{verdict[0]}</div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2.5">
          <Bar label="Image coverage (slots filled)" value={scores.coverage} />
          <Bar label="Image quality (size and width)" value={scores.quality} />
          <Bar label="ALT text and SEO" value={scores.alt} />
          <Bar label="Spacing between pictures" value={scores.spacing} />
          <Bar label="Responsive sizing" value={scores.responsive} />
          <Bar label="No broken pictures" value={scores.broken} />
        </div>
      </div>
      {(plan.adjacent > 0 || plan.longestRun > 500) && (
        <p className="text-[11.5px] text-amber-800 inline-flex items-start gap-1.5"><AlertTriangle size={12} className="shrink-0 mt-0.5" />
          {plan.adjacent > 0 ? `${plan.adjacent} place${plan.adjacent === 1 ? ' has' : 's have'} two pictures in a row: put them side by side or move one. ` : ''}
          {plan.longestRun > 500 ? `${plan.longestRun.toLocaleString('en-IN')} words run without a picture: fill the slot in that part.` : ''}</p>
      )}

      {/* full article preview */}
      {preview && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Button size="sm" variant={preview === 'desktop' ? 'primary' : 'secondary'} icon={Monitor} onClick={() => setPreview('desktop')}>Desktop</Button>
            <Button size="sm" variant={preview === 'mobile' ? 'primary' : 'secondary'} icon={Smartphone} onClick={() => setPreview('mobile')}>Mobile</Button>
            <span className="text-[11px] text-slate-500">Dashed boxes are slots still waiting for a picture. Preview only: nothing is saved.</span>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-100 p-3 flex justify-center">
            {/* same origin so the signed-in picture addresses load; no allow-scripts, and scripts are stripped anyway */}
            <iframe title="Article preview" sandbox="allow-same-origin" srcDoc={previewDoc} className={`bg-white rounded-lg shadow-sm border border-slate-200 h-[640px] ${preview === 'mobile' ? 'w-[390px]' : 'w-full'}`} />
          </div>
        </div>
      )}
    </div>
  );
}
