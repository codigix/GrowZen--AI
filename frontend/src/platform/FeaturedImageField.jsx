import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, RefreshCw, Trash2, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button, inputCls } from './SeoUi';
import { api, SEO_API } from './seoApi';
import Select from '../components/Select';

const MAX_MB = 15;
// Everything is converted to optimized WebP on the server; the server checks the real format from the file's bytes.
const EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif', 'heic', 'heif', 'svg', 'pdf'];
const ACCEPT_ATTR = [...EXTS.map(e => `.${e}`), 'image/*', 'application/pdf'].join(',');
const FORMATS_TEXT = 'JPG, PNG, WebP, GIF, BMP, TIFF, AVIF, HEIC, SVG or PDF';
const kb = (n) => (n == null ? '—' : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** The article's featured-image fields, picked out of an article row. */
export const featuredOf = (a) => ({
  path: a?.featured_image_path || null, alt: a?.featured_image_alt || '', mediaId: a?.wp_media_id || null, url: a?.featured_image_url || null,
  info: a?.featured_image_info || null
});

export const featuredSrc = (b, articleId, path) => (path ? `${SEO_API}/businesses/${b.id}/articles/${articleId}/featured-image?v=${encodeURIComponent(path)}` : null);

const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(new Error('The file could not be read.'));
  r.readAsDataURL(file);
});

const dimensions = (src) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
  img.onerror = () => resolve(null);
  img.src = src;
});

/**
 * Featured image for one saved article: upload (JPG/PNG/WEBP, up to 5 MB), preview, change, remove, ALT text.
 * Changes are saved straight away and reported through onChange(featuredOf(updatedArticle)); the rest of the
 * article editor (title, meta, body) is not reloaded, so unsaved text edits are never lost.
 */
export default function FeaturedImageField({ b, article, value, onChange, toast }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [alt, setAlt] = useState(value.alt);
  const [size, setSize] = useState(null);
  useEffect(() => { setAlt(value.alt); }, [value.alt]);

  const src = featuredSrc(b, article.id, value.path);
  useEffect(() => { setSize(null); if (src) dimensions(src).then(setSize); }, [src]);

  // The last uploaded original (kept in this page only), so another PDF page can be chosen without re-selecting the file
  const original = useRef(null);
  useEffect(() => { original.current = null; }, [article.id]);

  const pick = () => { setError(''); fileRef.current?.click(); };
  const send = async (dataUrl, name, page, label) => {
    setBusy(label); setError('');
    try {
      const updated = await api(`/businesses/${b.id}/articles/${article.id}/featured-image`, {
        method: 'PUT', body: { data_url: dataUrl, filename: name, alt: alt.trim() || null, page: page || null }
      });
      onChange(featuredOf(updated));
      return updated;
    } catch (e) {
      setError(e.message || String(e));
      return null;
    } finally {
      setBusy('');
    }
  };
  const upload = async (file) => {
    if (!file) return;
    setError('');
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!EXTS.includes(ext)) { setError(`".${ext}" files are not supported. Upload ${FORMATS_TEXT}.`); return; }
    if (file.size > MAX_MB * 1024 * 1024) { setError(`The file is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${MAX_MB} MB; use a smaller file.`); return; }
    const hadImage = Boolean(value.path);
    try {
      const dataUrl = await readAsDataUrl(file);
      original.current = { dataUrl, name: file.name };
      const updated = await send(dataUrl, file.name, 1, 'upload');
      if (updated) {
        const i = updated.featured_image_info;
        toast(`${hadImage ? 'Featured image changed' : 'Featured image added'}: converted to WebP${i ? ` (${kb(i.size)})` : ''}.`);
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const choosePage = async (page) => {
    if (!original.current) { setError('Upload the PDF again to choose a different page.'); return; }
    const updated = await send(original.current.dataUrl, original.current.name, page, 'page');
    if (updated) toast(`Using page ${page} of the PDF.`);
  };
  const remove = () => {
    setBusy('remove'); setError('');
    api(`/businesses/${b.id}/articles/${article.id}/featured-image`, { method: 'DELETE' })
      .then(updated => { onChange(featuredOf(updated)); toast('Featured image removed from this article.'); })
      .catch(e => setError(e.message || String(e)))
      .finally(() => setBusy(''));
  };
  const saveAlt = () => {
    if (alt.trim() === (value.alt || '').trim()) return;
    setBusy('alt');
    api(`/businesses/${b.id}/articles/${article.id}`, { method: 'PATCH', body: { featured_image_alt: alt.trim() || null }, repeat: true })
      .then(updated => { onChange(featuredOf(updated)); toast('ALT text saved.'); })
      .catch(e => setError(e.message || String(e)))
      .finally(() => setBusy(''));
  };
  const onDrop = (e) => { e.preventDefault(); if (!busy) upload(e.dataTransfer.files?.[0]); };
  const small = size && (size.w < 1200 || size.h < 630);

  return (
    <div className="space-y-2">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-700">Featured image</div>
        <div className="text-[11px] text-slate-500">Shown on your blog listing card and at the top of the post. {FORMATS_TEXT}, up to {MAX_MB} MB; converted to optimized WebP automatically. 1200 × 630 px or larger works best.</div>
      </div>
      <input ref={fileRef} type="file" accept={ACCEPT_ATTR} className="hidden" onChange={e => upload(e.target.files?.[0])} />
      {value.path ? (
        <div className="flex flex-col sm:flex-row gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50">
          <div className="relative w-full sm:w-64 shrink-0 aspect-[1200/630] rounded-lg overflow-hidden bg-slate-200 ring-1 ring-slate-200">
            <img src={src} alt={value.alt || 'Featured image'} className="absolute inset-0 w-full h-full object-cover" />
            {busy === 'upload' && <div className="absolute inset-0 bg-white/70 flex items-center justify-center"><Loader2 size={18} className="animate-spin text-indigo-600" /></div>}
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            <label className="block">
              <span className="text-[11px] font-semibold text-slate-600">ALT text (describes the image for search engines and screen readers)</span>
              <input className={inputCls} value={alt} maxLength={255} placeholder="e.g. Doctor discussing a medical weight loss plan with a patient"
                onChange={e => setAlt(e.target.value)} onBlur={saveAlt} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} />
            </label>
            {value.info && (() => {
              const i = value.info;
              const change = i.original_size ? Math.round((1 - i.size / i.original_size) * 100) : 0;
              return (
                <div className="rounded-lg bg-white ring-1 ring-inset ring-slate-200 px-2.5 py-2 text-[11px] text-slate-600 space-y-0.5">
                  <div className="truncate" title={i.original_name || ''}><span className="text-slate-400">Uploaded:</span> <b className="text-slate-800">{i.original_name || 'image'}</b> · {i.original_format} · {kb(i.original_size)} · {i.original_width} × {i.original_height} px</div>
                  <div><span className="text-slate-400">Converted:</span> <b className="text-slate-800">WebP</b> · {i.width} × {i.height} px · {kb(i.size)}
                    {i.kept_original ? <span className="text-slate-500"> · already optimized, kept as is</span>
                      : change > 0 ? <span className="text-emerald-700 font-semibold"> · {change}% smaller</span>
                        : <span className="text-slate-500"> · {['SVG', 'PDF'].includes(i.original_format) ? 'rendered from a vector file' : i.original_format === 'AVIF' ? 'AVIF is more compact than WebP' : 'optimized for the web'}</span>}
                    {i.transparent && <span className="text-slate-500"> · transparency kept</span>}
                  </div>
                </div>
              );
            })()}
            {value.info?.page_count > 1 && (
              <label className="flex items-center gap-2 text-[11.5px] text-slate-700">
                PDF page
                <Select className="h-8 px-2 rounded-lg bg-white ring-1 ring-inset ring-slate-200 text-[12px]" value={value.info.page || 1} disabled={Boolean(busy)} onChange={e => choosePage(Number(e.target.value))}>
                  {Array.from({ length: value.info.page_count }, (_, n) => <option key={n + 1} value={n + 1}>Page {n + 1} of {value.info.page_count}</option>)}
                </Select>
                {busy === 'page' && <Loader2 size={12} className="animate-spin" />}
              </label>
            )}
            <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
              {size && !value.info && <span>{size.w} × {size.h} px</span>}
              {small && <span className="text-amber-700 inline-flex items-center gap-1"><AlertTriangle size={11} /> Smaller than 1200 × 630; it may look soft on large screens</span>}
              {value.mediaId
                ? <span className="text-emerald-700 inline-flex items-center gap-1"><CheckCircle2 size={11} /> On your website (media #{value.mediaId})</span>
                : <span>Uploaded to your website when you publish</span>}
              {busy === 'alt' && <span className="inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Saving…</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={RefreshCw} busy={busy === 'upload'} disabled={Boolean(busy)} onClick={pick}>Change image</Button>
              <Button size="sm" icon={Trash2} busy={busy === 'remove'} disabled={Boolean(busy)} onClick={remove}>Remove image</Button>
            </div>
          </div>
        </div>
      ) : (
        <button type="button" onClick={pick} onDragOver={e => e.preventDefault()} onDrop={onDrop} disabled={Boolean(busy)}
          className="w-full rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 hover:bg-indigo-50/50 hover:border-indigo-300 px-4 py-6 flex flex-col items-center gap-1.5 text-slate-600 cursor-pointer transition-colors">
          {busy === 'upload' ? <Loader2 size={20} className="animate-spin text-indigo-600" /> : <ImagePlus size={20} className="text-indigo-600" />}
          <span className="text-[12.5px] font-semibold text-slate-800">{busy === 'upload' ? 'Uploading…' : 'Upload a featured image'}</span>
          <span className="text-[11px] text-slate-500">Click or drop a file here · {FORMATS_TEXT} · up to {MAX_MB} MB · converted to WebP</span>
        </button>
      )}
      {error && <p className="text-[11.5px] text-rose-700">{error}</p>}
    </div>
  );
}
