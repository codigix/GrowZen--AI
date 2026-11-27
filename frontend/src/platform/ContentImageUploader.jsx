import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Trash2, ArrowUp, ArrowDown, Loader2, AlertTriangle, Plus, CheckCircle2 } from 'lucide-react';
import { Button, inputCls } from './SeoUi';
import { api, SEO_API } from './seoApi';
import Select from '../components/Select';
import { keywordAlt } from './FeaturedImageField';

/**
 * Article-body images (Images & Analysis step): upload several at once (drag & drop or multi-select), give each ALT text
 * and a caption, reorder, then insert them into the Article Body at the chosen place: one under another, two side by
 * side, or a gallery. The featured image upload is separate and unchanged. Images are stored in GrowZen as optimized
 * WebP and uploaded to the website once, when the blog is published (backend services/content_images.py).
 */

const MAX_MB = 15; // GrowZen converts anything up to this (as the featured image)
const EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif', 'heic', 'heif'];
const kb = (n) => (n == null ? '—' : n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const plain = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
export const contentImageSrc = (b, articleId, name) => `${SEO_API}/businesses/${b.id}/articles/${articleId}/content-images/${encodeURIComponent(name)}`;

const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(new Error('The file could not be read.'));
  r.readAsDataURL(file);
});

const LAYOUTS = [
  ['single', 'One under another (full width)'],
  ['row-2', 'Two side by side (one column on phones)'],
  ['gallery', 'Gallery (grid, fits the screen)']
];

/** The HTML for the images, in the website's own structure (<figure class="blog-content-image">). */
export function imagesHtml(b, articleId, items, layout) {
  const inRow = layout !== 'single';
  const fig = (x) => `<figure class="blog-content-image" data-gz-figure="1"${inRow ? ' style="margin:0;"' : ''}>`
    + `<img src="${contentImageSrc(b, articleId, x.name)}" data-gz-image="${x.name}" alt="${esc(x.alt)}" loading="lazy"`
    + `${x.info?.width ? ` width="${x.info.width}" height="${x.info.height}"` : ''} style="max-width:100%;height:auto;${inRow ? 'width:100%;' : ''}">`
    + `${x.caption.trim() ? `<figcaption>${esc(x.caption.trim())}</figcaption>` : ''}</figure>`;
  if (!inRow) return items.map(fig).join('\n');
  const min = layout === 'row-2' ? 240 : 180;
  return `<div class="${layout === 'row-2' ? 'blog-image-row' : 'blog-image-gallery'}" data-gz-layout="${layout}" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(${min}px,1fr));gap:${layout === 'row-2' ? 16 : 12}px;margin:24px 0;">`
    + items.map(fig).join('') + '</div>';
}

/** Places to put the images: the cursor in the HTML editor, the top, under each H2 (after its first paragraph), the end. */
export function placesIn(draft, caret) {
  const out = [];
  const snap = (i) => { // never inside a tag
    const lt = draft.lastIndexOf('<', i - 1), gt = draft.lastIndexOf('>', i - 1);
    if (lt > gt) { const end = draft.indexOf('>', i); return end < 0 ? draft.length : end + 1; }
    return i;
  };
  if (caret != null && caret >= 0 && caret <= draft.length) out.push({ id: 'caret', label: 'Where my cursor was in the HTML editor', at: snap(caret) });
  const h1 = draft.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/i);
  const firstP = draft.match(/<\/p>/i);
  out.push({ id: 'top', label: 'Near the top (after the first paragraph)', at: firstP ? firstP.index + firstP[0].length : h1 ? h1.index + h1[0].length : 0 });
  for (const m of draft.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)) {
    const end = m.index + m[0].length;
    const nextHead = draft.slice(end).search(/<h[1-6]\b/i);
    const limit = nextHead < 0 ? draft.length : end + nextHead;
    const p = draft.slice(end, limit).match(/<\/p>/i);
    out.push({ id: `h${m.index}`, label: `Under “${plain(m[1]).slice(0, 60)}”`, at: p ? end + p.index + p[0].length : end });
  }
  const schema = draft.search(/<script\b[^>]*application\/ld\+json/i);
  out.push({ id: 'end', label: 'At the end of the article', at: schema < 0 ? draft.length : schema });
  return out;
}

/**
 * Will the article images publish on this website? A React.js website that does not serve its uploaded images gets them
 * inside the article text, and its article column has a size limit (MySQL TEXT: 64 KB). Facts learned on publish
 * (uploads_load, body_refused_bytes, body_ok_bytes) make this exact; without them the safe assumption is used.
 */
const MYSQL_SIZES = [255, 65535, 16777215];
export function imageFit({ site, draft, queued, storedBy }) {
  if (!site?.toReact) return null; // WordPress: every image goes to the media library, the article only holds links
  const f = site.facts || {};
  const placed = [...String(draft || '').matchAll(/data-gz-image="([^"]+)"/g)].map(m => storedBy[m[1]]?.size || 0);
  const imageBytes = placed.reduce((s, n) => s + n, 0);
  const textBytes = new Blob([String(draft || '').replace(/<img\b[^>]*>/gi, '<img>')]).size;
  const allImages = imageBytes + queued.reduce((s, x) => s + (x.size || 0), 0);
  const inlineBytes = textBytes + Math.ceil(allImages * 4 / 3) + 200 * (placed.length + queued.length);
  const learned = f.body_refused_bytes ? Math.max(...MYSQL_SIZES.filter(n => n < f.body_refused_bytes), 255) : null;
  const limit = learned || (f.body_ok_bytes > 65535 ? null : 65535);
  const uploads = f.uploads_load; // true: images go to the website's storage; false: inside the text; undefined: not known yet
  const fits = uploads === true || !limit || inlineBytes <= limit;
  return { uploads, inlineBytes, textBytes, imageBytes: allImages, limit, learned: Boolean(learned), fits, count: placed.length + queued.length };
}

export default function ContentImageUploader({ b, article, draft, onDraftChange, onInsertSave, stored, site, caret, limitMb, onUploaded, toast }) {
  const fileRef = useRef(null);
  const [items, setItems] = useState([]); // uploaded, not inserted yet
  // images uploaded earlier but never placed in the article (e.g. the page was left before "Insert"): back in the list
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !stored) return;
    seeded.current = true;
    const inDraft = new Set([...(draft || '').matchAll(/data-gz-image="([^"]+)"/g)].map(m => m[1]));
    const imgs = new Set([...String(draft || '').matchAll(/<img\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/gi)].map(m => m[1])).size;
    const waiting = stored.filter(x => !inDraft.has(x.name)).map((x, i) => ({
      name: x.name, size: x.size, info: { width: x.width, height: x.height, original_size: x.original_size }, file: x.original_name || x.name,
      alt: keywordAlt(article.keyword, imgs + i + 1) || String(x.original_name || '').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim(), caption: ''
    }));
    if (waiting.length) setItems(xs => [...waiting.filter(w => !xs.some(x => x.name === w.name)), ...xs]);
  }, [stored]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(0);    // files still uploading
  const [errors, setErrors] = useState([]);
  const [layout, setLayout] = useState('single');
  const places = placesIn(draft || '', caret);
  const [placeId, setPlaceId] = useState('');
  const place = places.find(p => p.id === placeId) || places.find(p => p.id === 'caret') || places[places.length - 1];
  const [over, setOver] = useState(false);
  const storedBy = Object.fromEntries((stored || []).map(x => [x.name, x]));
  const fit = imageFit({ site, draft, queued: items, storedBy });
  const where = site?.name || 'your website';

  const upload = async (files) => {
    const list = [...(files || [])];
    if (!list.length) return;
    setErrors([]);
    setBusy(n => n + list.length);
    for (const file of list) {
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      try {
        if (!EXTS.includes(ext)) throw new Error(`".${ext}" is not an image GrowZen can use. Upload JPG, PNG, WebP, GIF, AVIF or HEIC.`);
        if (file.size > MAX_MB * 1048576) throw new Error(`${(file.size / 1048576).toFixed(1)} MB: larger than ${MAX_MB} MB.`);
        const r = await api(`/businesses/${b.id}/articles/${article.id}/content-images`, { method: 'POST', body: { data_url: await readAsDataUrl(file), filename: file.name } });
        // ALT from the primary keyword, numbered after the images already in the article: "wedding-dress-1", "wedding-dress-2", …
        const inArticle = new Set([...String(draft || '').matchAll(/<img\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/gi)].map(m => m[1])).size;
        setItems(xs => (xs.some(x => x.name === r.name) ? xs : [...xs, {
          name: r.name, size: r.size, info: r.info, file: file.name, caption: '',
          alt: keywordAlt(article.keyword, inArticle + xs.length + 1) || file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
        }]));
        if (onUploaded) onUploaded();
      } catch (e) {
        setErrors(es => [...es, `${file.name}: ${e.message || e}`]);
      } finally {
        setBusy(n => n - 1);
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  };
  const set = (i, k, v) => setItems(xs => xs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const move = (i, d) => setItems(xs => { const ys = [...xs]; const j = i + d; if (j < 0 || j >= ys.length) return xs; [ys[i], ys[j]] = [ys[j], ys[i]]; return ys; });
  const drop = (i) => {
    const x = items[i];
    setItems(xs => xs.filter((_, j) => j !== i));
    api(`/businesses/${b.id}/articles/${article.id}/content-images/${encodeURIComponent(x.name)}`, { method: 'DELETE' })
      .then(() => onUploaded && onUploaded()).catch(() => { /* still listed only if it is in the article */ });
  };
  const missingAlt = items.filter(x => !x.alt.trim()).length;
  const [saving, setSaving] = useState(false);
  const insert = async () => {
    if (!items.length || !place) return;
    const htmlOut = `\n${imagesHtml(b, article.id, items, layout)}\n`;
    const next = (draft || '').slice(0, place.at) + htmlOut + (draft || '').slice(place.at);
    const n = items.length;
    onDraftChange(next);
    setItems([]);
    if (!onInsertSave) { toast(`${n} image${n === 1 ? '' : 's'} placed. Click "Save changes" to keep ${n === 1 ? 'it' : 'them'}.`); return; }
    setSaving(true);
    try {
      await onInsertSave(next); // saved straight away: publishing sends the saved article
      toast(`${n} image${n === 1 ? '' : 's'} placed ${place.id === 'end' ? 'at the end' : place.label.toLowerCase()} and saved. Publish again to send ${n === 1 ? 'it' : 'them'} to your website.`);
    } catch (e) {
      toast(`Placed in the article, but saving failed: ${e.message || e}. Click "Save changes".`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 p-3.5 space-y-3">
      <div>
        <div className="text-[12.5px] font-bold text-slate-900">Article images (inside the text)</div>
        <div className="text-[11.5px] text-slate-500">Upload one or many pictures for the article body. Each is converted to an optimized WebP and uploaded to your website once, when you publish. The featured image stays on the AI Draft step.</div>
      </div>
      <input ref={fileRef} type="file" multiple accept={EXTS.map(e => `.${e}`).join(',') + ',image/*'} className="hidden" onChange={e => upload(e.target.files)} />
      <button type="button" onClick={() => fileRef.current?.click()} onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}
        className={`w-full rounded-xl border-2 border-dashed px-4 py-5 flex flex-col items-center gap-1 cursor-pointer transition-colors ${over ? 'border-indigo-400 bg-indigo-50' : 'border-slate-300 bg-slate-50 hover:bg-indigo-50/50 hover:border-indigo-300'}`}>
        {busy ? <Loader2 size={20} className="animate-spin text-indigo-600" /> : <ImagePlus size={20} className="text-indigo-600" />}
        <span className="text-[12.5px] font-semibold text-slate-800">{busy ? `Uploading ${busy} image${busy === 1 ? '' : 's'}…` : 'Drop images here or click to choose several'}</span>
        <span className="text-[11px] text-slate-500">JPG, PNG, WebP, GIF, AVIF, HEIC · up to {MAX_MB} MB each · converted to WebP</span>
      </button>
      {errors.map((e, i) => <p key={i} className="text-[11.5px] text-rose-700">{e}</p>)}

      {fit && fit.count > 0 && (
        fit.uploads === true ? (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-[12px] text-emerald-900">
            <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
            <span>{where} stores uploaded images: each picture is uploaded there and the article only holds its link. Article size stays about {kb(fit.textBytes)}.</span>
          </div>
        ) : !fit.fits ? (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-50 border border-rose-300 text-[12px] text-rose-900">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>
              <b>These images will not publish on {where}.</b> {fit.uploads === false ? `${where} does not show the images uploaded to it (its upload addresses do not load), so` : 'Unless the website serves uploaded images,'} the pictures
              go inside the article text: about <b>{kb(fit.inlineBytes)}</b> ({kb(fit.textBytes)} text + {kb(fit.imageBytes)} of images). The website stores at most <b>{kb(fit.limit)}</b> of article text
              {fit.learned ? ' (it refused a larger post: “Data too long for column body”)' : ' (the usual MySQL TEXT column)'}.
              {' '}Fix: the website developer makes <code>/api/uploads</code> files load, or changes the article column to LONGTEXT. Until then publish without article images
              {fit.textBytes + 1000 < fit.limit ? ` or use smaller ones (about ${kb(Math.floor((fit.limit - fit.textBytes) * 3 / 4) - 2048)} of images fit in all)` : ''}.
            </span>
          </div>
        ) : fit.uploads === undefined ? (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-[12px] text-amber-900">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>Fits even if the pictures go inside the article: about {kb(fit.inlineBytes)} of {kb(fit.limit)}. Publishing first tries {where}’s image upload.</span>
          </div>
        ) : (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-[12px] text-emerald-900">
            <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
            <span>Fits: the pictures go inside the article text and the post is about {kb(fit.inlineBytes)} of the {kb(fit.limit)} {where} stores.</span>
          </div>
        )
      )}

      {items.length > 0 && (
        <>
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-[12px] text-amber-900">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span><b>{items.length} image{items.length === 1 ? ' is' : 's are'} uploaded but not in the article yet.</b> Choose the layout and the place below, then click <b>Insert into the article</b>. Until then {items.length === 1 ? 'it is' : 'they are'} not published.</span>
          </div>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {items.map((x, i) => {
              const big = x.size > limitMb * 1048576;
              return (
                <li key={x.name} className="flex flex-col md:flex-row gap-3 p-2.5">
                  <img src={contentImageSrc(b, article.id, x.name)} alt={x.alt} className="w-full md:w-32 aspect-[16/10] object-cover rounded-lg bg-slate-100 ring-1 ring-slate-200 shrink-0" />
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="text-[12px] flex flex-wrap items-center gap-x-2">
                      <span className="font-semibold text-slate-900 truncate max-w-full">{i + 1}. {x.file}</span>
                      <span className={`tabular-nums ${big ? 'text-rose-700 font-semibold' : 'text-slate-600'}`}>{kb(x.size)} WebP</span>
                      {x.info?.original_size ? <span className="text-slate-400">uploaded {kb(x.info.original_size)}</span> : null}
                      {x.info?.width ? <span className="text-slate-400">{x.info.width} × {x.info.height} px</span> : null}
                      {big && <span className="text-rose-700 inline-flex items-center gap-1"><AlertTriangle size={11} /> over {limitMb} MB</span>}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input className={inputCls} placeholder="ALT text (describes the picture)" maxLength={255} value={x.alt} onChange={e => set(i, 'alt', e.target.value)} />
                      <input className={inputCls} placeholder="Caption (optional, shown under the picture)" maxLength={300} value={x.caption} onChange={e => set(i, 'caption', e.target.value)} />
                    </div>
                  </div>
                  <div className="flex md:flex-col gap-1 shrink-0">
                    <Button size="sm" icon={ArrowUp} disabled={i === 0} onClick={() => move(i, -1)} title="Move up" />
                    <Button size="sm" icon={ArrowDown} disabled={i === items.length - 1} onClick={() => move(i, 1)} title="Move down" />
                    <Button size="sm" icon={Trash2} onClick={() => drop(i)} title="Remove" />
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <label className="text-[11.5px] font-semibold text-slate-600 space-y-1">
              <span>Layout</span>
              <Select className={inputCls} value={layout} onChange={e => setLayout(e.target.value)}>
                {LAYOUTS.map(([id, label]) => <option key={id} value={id} disabled={id !== 'single' && items.length < 2}>{label}{id !== 'single' && items.length < 2 ? ' (needs 2+ images)' : ''}</option>)}
              </Select>
            </label>
            <label className="text-[11.5px] font-semibold text-slate-600 space-y-1">
              <span>Place in the article</span>
              <Select className={inputCls} value={place?.id || ''} onChange={e => setPlaceId(e.target.value)}>
                {places.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </Select>
            </label>
          </div>
          {missingAlt > 0 && <p className="text-[11.5px] text-amber-800 inline-flex items-center gap-1"><AlertTriangle size={12} /> {missingAlt} image{missingAlt === 1 ? ' has' : 's have'} no ALT text. Add it for Google and screen readers.</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant={fit && !fit.fits ? 'danger' : 'primary'} icon={Plus} busy={saving} disabled={Boolean(busy)} onClick={insert}>
              {fit && !fit.fits ? 'Insert anyway (will not publish until the website is fixed)' : `Insert ${items.length} image${items.length === 1 ? '' : 's'} into the article`}
            </Button>
            <span className="text-[11.5px] text-slate-500">The article is saved straight away. See them on the AI Draft step → Preview, then publish.</span>
          </div>
        </>
      )}
    </div>
  );
}
