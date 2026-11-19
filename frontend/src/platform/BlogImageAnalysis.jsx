import React, { useEffect, useMemo, useState } from 'react';
import { Image as ImageIcon, AlertTriangle, CheckCircle2, Trash2, Loader2, HardDrive, Info } from 'lucide-react';
import { Button } from './SeoUi';
import { api, useApi } from './seoApi';
import { featuredOf, featuredSrc } from './FeaturedImageField';
import ContentImageUploader from './ContentImageUploader';
import SiteBlogImages from './SiteBlogImages';
import SmartImagePlanner from './SmartImagePlanner';

/**
 * Blog Image Analysis: a read-mostly view of every image in this blog (featured + images in the article body,
 * including ones pasted through the HTML editor). It never changes the upload controls; removing an image here
 * uses the same endpoint as "Remove image" (featured) or takes the <img> out of the draft (body, saved with Save changes).
 */

const GROWZEN_FILE_MB = 15; // the featured-image upload limit GrowZen itself accepts
const fmtSize = (n) => (n == null ? '—' : n === 0 ? '0 KB' : n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
const fileNameOf = (src, i) => {
  if (src.startsWith('data:')) return `pasted-image-${i + 1}.${(src.match(/^data:image\/([a-z0-9+.-]+)/i) || [])[1]?.replace('svg+xml', 'svg') || 'img'}`;
  try { return decodeURIComponent(new URL(src, window.location.href).pathname.split('/').filter(Boolean).pop() || src); } catch { return src; }
};
const dataUriBytes = (src) => {
  const i = src.indexOf(',');
  const payload = i < 0 ? '' : src.slice(i + 1);
  if (/;base64/i.test(src.slice(0, i))) { const b = payload.replace(/\s/g, ''); return Math.floor(b.length * 3 / 4) - (b.endsWith('==') ? 2 : b.endsWith('=') ? 1 : 0); }
  try { return new Blob([decodeURIComponent(payload)]).size; } catch { return payload.length; }
};
/** The src attribute of one <img> tag exactly as written (quoted or not). */
const srcOf = (tag) => {
  const q = tag.match(/\bsrc\s*=\s*(["'])([\s\S]*?)\1/i);
  if (q) return q[2];
  return (tag.match(/\bsrc\s*=\s*([^\s>]+)/i) || [])[1] || '';
};
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

/** Every distinct <img> in the article body, in order (the same picture used twice counts once). */
export function bodyImages(html) {
  const seen = new Map();
  const gallery = gallerySrcs(html);
  for (const m of String(html || '').matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const raw = srcOf(tag);
    const src = decode(raw);
    if (!src) continue;
    const alt = decode((tag.match(/\balt\s*=\s*(["'])([\s\S]*?)\1/i) || [])[2] || '');
    const gz = (tag.match(/\bdata-gz-image\s*=\s*"([^"]+)"/i) || [])[1] || null; // uploaded on the Images & Analysis step
    if (seen.has(src)) seen.get(src).uses += 1;
    else seen.set(src, { src, raw, alt, gz, gallery: gallery.has(src), uses: 1 });
  }
  return [...seen.values()];
}

/** Images that sit in a gallery / side-by-side row: a container holding more than one picture, or named like one. */
function gallerySrcs(html) {
  const out = new Set();
  if (!/<img\b/i.test(html || '') || typeof DOMParser === 'undefined') return out;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  doc.body.querySelectorAll('img').forEach(img => {
    let node = img.parentElement;
    for (let i = 0; i < 3 && node && node !== doc.body; i += 1, node = node.parentElement) {
      if (node.querySelectorAll('img').length > 1 || node.hasAttribute('data-gz-layout') || /gallery|grid|columns|side-by-side|image-row/i.test(node.className || '')) {
        out.add((img.getAttribute('src') || '').trim());
        break;
      }
    }
  });
  return out;
}

/** Takes every <img> with this src out of the HTML; a <figure> left with no picture goes too. Everything else is untouched. */
export function removeImage(html, raw) {
  let out = String(html || '').replace(/<img\b[^>]*>/gi, (tag) => (srcOf(tag) === raw ? '' : tag));
  out = out.replace(/<figure\b[^>]*>(?:(?!<img\b|<\/figure>)[\s\S])*<\/figure>/gi, (fig) => (/<(img|video|iframe|svg|picture)\b/i.test(fig) ? fig : ''));
  return out;
}

/** Size of an image on another server: HEAD first, then a GET; null when that server does not allow the browser to read it. */
async function remoteBytes(src) {
  try {
    const h = await fetch(src, { method: 'HEAD', mode: 'cors' });
    const n = Number(h.headers.get('content-length'));
    if (h.ok && n > 0) return { bytes: n, ok: true };
  } catch { /* try a GET */ }
  try {
    const r = await fetch(src, { mode: 'cors' });
    if (!r.ok) return { bytes: null, ok: false, status: r.status };
    return { bytes: (await r.blob()).size, ok: true };
  } catch { return { bytes: null, ok: null }; }
}
const loads = (src) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
  img.onerror = () => resolve(null);
  img.src = src;
});

export default function BlogImageAnalysis({ b, article, featured, onFeaturedChange, draft, onDraftChange, saved, onSave, onInsertSave, saveBusy, caret, toast }) {
  const react = useApi(`/businesses/${b.id}/react-site`);
  const stored = useApi(`/businesses/${b.id}/articles/${article.id}/content-images`); // images uploaded here: sizes from GrowZen itself
  const storedBy = Object.fromEntries((stored.data?.images || []).map(x => [x.name, x]));
  const wp = useApi(`/businesses/${b.id}/site-integration`);
  const dest = (() => { try { return localStorage.getItem(`growzen.dest.${b.id}`) || ''; } catch { return ''; } })();
  const reactOn = react.data?.status === 'connected', wpOn = wp.data?.status === 'connected';
  const toReact = dest ? dest === 'react' : (!wpOn && reactOn);
  const siteLimitMb = toReact ? Number(react.data?.mapping?.max_upload_mb) || 5 : null;
  const limitKey = `growzen.imgLimit.${b.id}`;
  const [ownLimit, setOwnLimit] = useState(() => { try { return localStorage.getItem(limitKey) || ''; } catch { return ''; } });
  const limitMb = Number(ownLimit) > 0 ? Number(ownLimit) : siteLimitMb || GROWZEN_FILE_MB;
  const limitFrom = Number(ownLimit) > 0 ? 'set by you on this page'
    : siteLimitMb ? 'the upload limit set for your React.js website (Publishing Setup)'
      : 'the largest file GrowZen accepts; WordPress may allow less (Media → Add New shows its limit)';
  const saveLimit = (v) => { setOwnLimit(v); try { if (v) localStorage.setItem(limitKey, v); else localStorage.removeItem(limitKey); } catch { /* this page only */ } };
  const limitBytes = limitMb * 1048576;

  // ---- featured image (the WebP GrowZen stores and sends to the website)
  const feat = featured || featuredOf(article);
  const featSrc = featuredSrc(b, article.id, feat.path);
  const [featBytes, setFeatBytes] = useState(null);
  useEffect(() => {
    setFeatBytes(null);
    if (!featSrc || feat.info?.size) return undefined;
    let live = true;
    fetch(featSrc).then(r => (r.ok ? r.blob() : null)).then(bl => { if (live && bl) setFeatBytes(bl.size); }).catch(() => {});
    return () => { live = false; };
  }, [featSrc, feat.info?.size]);

  // ---- body images (incl. pasted in the HTML editor), each measured once
  const images = useMemo(() => bodyImages(draft), [draft]);
  const [measured, setMeasured] = useState({}); // src -> { bytes, ok, w, h }
  useEffect(() => {
    let live = true;
    images.filter(im => !im.gz && !(im.src in measured)).forEach(im => {
      if (im.src.startsWith('data:')) {
        loads(im.src).then(d => live && setMeasured(m => ({ ...m, [im.src]: { bytes: dataUriBytes(im.src), ok: Boolean(d), ...d } })));
        return;
      }
      setMeasured(m => ({ ...m, [im.src]: { pending: true } }));
      Promise.all([remoteBytes(im.src), loads(im.src)]).then(([r, d]) => live && setMeasured(m => ({ ...m, [im.src]: { ...r, ok: d ? true : r.ok, w: d?.w, h: d?.h } })));
    });
    return () => { live = false; };
  }, [images]); // eslint-disable-line react-hooks/exhaustive-deps

  const site = hostOf(react.data?.website_url || wp.data?.base_url || b.website || '');
  const featUrl = feat.url ? decode(feat.url) : '';
  const rows = [];
  if (feat.path) {
    const bytes = feat.info?.size ?? featBytes;
    rows.push({
      key: 'featured', kind: 'Featured', src: featSrc, name: feat.info?.original_name ? `${feat.info.original_name.replace(/\.[^.]+$/, '')}.webp` : 'featured-image.webp',
      bytes, pending: bytes == null, original: feat.info?.original_size, dims: feat.info ? `${feat.info.width} × ${feat.info.height}` : '',
      status: feat.mediaId ? { tone: 'ok', text: `On your website (media #${feat.mediaId})` } : feat.url ? { tone: 'ok', text: 'On your website' } : { tone: 'wait', text: 'Saved in GrowZen · uploaded when you publish' }
    });
  }
  images.forEach((im, i) => {
    if (featUrl && im.src === featUrl) return; // the featured image placed in the body too: counted once, as Featured
    const kind = im.gallery ? 'Gallery' : 'Content';
    if (im.gz) {
      const s = storedBy[im.gz];
      rows.push({
        key: im.src, raw: im.raw, kind, src: im.src, name: s?.original_name ? `${s.original_name.replace(/\.[^.]+$/, '')}.webp` : im.gz, alt: im.alt, uses: im.uses,
        bytes: s ? s.size : null, pending: !s && !stored.error && !stored.data, unknown: Boolean(stored.data && !s), original: s?.original_size, dims: s?.width ? `${s.width} × ${s.height}` : '',
        status: !stored.data ? { tone: 'wait', text: 'Reading…' } : !s ? { tone: 'bad', text: 'Missing in GrowZen: upload it again' }
          : s.on_sites?.length ? { tone: 'ok', text: 'Uploaded · on your website' } : { tone: 'wait', text: 'Saved in GrowZen · uploaded to your website when you publish' }
      });
      return;
    }
    const m = measured[im.src] || { pending: true };
    const data = im.src.startsWith('data:');
    const onSite = !data && site && hostOf(im.src) === site;
    const status = m.ok === false ? { tone: 'bad', text: `Cannot be loaded${m.status ? ` (error ${m.status})` : ''}: readers will see a broken image` }
      : data ? { tone: 'wait', text: 'Pasted into the article · sent inside the article text' }
        : onSite ? { tone: 'ok', text: 'On your website' }
          : { tone: 'info', text: `Linked from ${hostOf(im.src) || 'another site'} · not uploaded` };
    rows.push({
      key: im.src, raw: im.raw, kind, src: im.src, name: fileNameOf(im.src, i), alt: im.alt, uses: im.uses,
      bytes: m.bytes ?? null, pending: Boolean(m.pending), unknown: !m.pending && m.bytes == null, dims: m.w ? `${m.w} × ${m.h}` : '', status
    });
  });

  const sum = (list) => list.reduce((s, r) => s + (r.bytes || 0), 0);
  const featRows = rows.filter(r => r.kind === 'Featured'), bodyRows = rows.filter(r => r.kind !== 'Featured');
  const contentRows = rows.filter(r => r.kind === 'Content'), galleryRows = rows.filter(r => r.kind === 'Gallery');
  const over = rows.filter(r => r.bytes > limitBytes);
  const unknown = rows.filter(r => r.unknown).length;
  const pending = rows.some(r => r.pending);
  const dataBytes = sum(bodyRows.filter(r => r.src.startsWith('data:')));
  const dirty = draft !== (saved || '');

  // ---- remove (two clicks)
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => { if (!confirm) return undefined; const t = setTimeout(() => setConfirm(''), 4000); return () => clearTimeout(t); }, [confirm]);
  const remove = (r) => {
    if (confirm !== r.key) { setConfirm(r.key); return; }
    setConfirm('');
    if (r.kind === 'Featured') {
      setBusy(r.key);
      api(`/businesses/${b.id}/articles/${article.id}/featured-image`, { method: 'DELETE' })
        .then(updated => { onFeaturedChange(featuredOf(updated)); toast('Featured image removed from this article.'); })
        .catch(e => toast(e.message || String(e)))
        .finally(() => setBusy(''));
      return;
    }
    onDraftChange(removeImage(draft, r.raw));
    toast('Image taken out of the article. Click "Save changes" to keep it.');
  };

  const Stat = ({ label, count, bytes, tone = 'slate' }) => (
    <div className={`p-3 rounded-xl border ${tone === 'indigo' ? 'bg-indigo-50 border-indigo-200' : 'bg-slate-50 border-slate-200'}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-2"><span className="text-[22px] font-bold text-slate-900 tabular-nums">{count}</span><span className="text-[12px] text-slate-500">image{count === 1 ? '' : 's'}</span></div>
      <div className="text-[13px] font-semibold text-slate-700 tabular-nums">{fmtSize(bytes)}{pending ? <Loader2 size={11} className="inline ml-1.5 animate-spin text-slate-400" /> : null}</div>
    </div>
  );
  const toneCls = { ok: 'text-emerald-700', wait: 'text-slate-600', info: 'text-indigo-700', bad: 'text-rose-700' };

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-slate-700">Every image in this blog: the featured image and each picture in the article body, including ones pasted in the HTML editor. The same picture used more than once is counted once. Nothing here changes how you upload; it shows what will be sent when you publish.</p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Total upload" count={rows.length} bytes={sum(rows)} tone="indigo" />
        <Stat label="Featured image" count={featRows.length} bytes={sum(featRows)} />
        <Stat label="Content images" count={contentRows.length} bytes={sum(contentRows)} />
        <Stat label="Gallery images" count={galleryRows.length} bytes={sum(galleryRows)} />
      </div>
      <div className={`text-[11.5px] inline-flex items-center gap-1.5 ${over.length ? 'text-rose-700' : 'text-emerald-700'}`}>
        {over.length ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
        {over.length ? `${over.length} image${over.length === 1 ? '' : 's'} over the ${limitMb} MB limit` : `All images are within the ${limitMb} MB limit per image`}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-slate-600">
        <HardDrive size={13} className="text-slate-400" />
        <span>Size limit per image: <b className="text-slate-800">{limitMb} MB</b> · {limitFrom}.</span>
        <label className="inline-flex items-center gap-1.5">Change:
          <input type="number" min="0.1" max="100" step="0.1" value={ownLimit} placeholder={String(siteLimitMb || GROWZEN_FILE_MB)} onChange={e => saveLimit(e.target.value)}
            className="w-20 h-7 px-2 rounded-md bg-white ring-1 ring-inset ring-slate-200 text-[12px]" /> MB
        </label>
      </div>

      {over.length > 0 && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-[12.5px] text-rose-900">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span><b>{over.length} image{over.length === 1 ? ' is' : 's are'} larger than {limitMb} MB</b> ({over.map(r => r.name).join(', ')}). The website may refuse {over.length === 1 ? 'it' : 'them'}: use a smaller or compressed file.{toReact ? ' For the featured image GrowZen re-compresses it to fit before sending.' : ''}</span>
        </div>
      )}
      {dataBytes > 1048576 && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-[12.5px] text-amber-900">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span><b>{fmtSize(dataBytes)} of pictures are pasted inside the article text.</b> They travel with every save and publish, and many websites refuse a post this large. Upload them to your website’s media library and use their link instead.</span>
        </div>
      )}
      {dirty && (
        <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-indigo-50 border border-indigo-200 text-[12.5px] text-indigo-900">
          <Info size={14} className="shrink-0" /><span className="flex-1 min-w-[200px]">The article has changes that are not saved yet.</span>
          {onSave && <Button size="sm" busy={saveBusy} onClick={onSave}>Save changes</Button>}
        </div>
      )}

      <SmartImagePlanner b={b} article={article} draft={draft} onDraftChange={onDraftChange} onInsertSave={onInsertSave} onUploaded={() => stored.reload(true)}
        rows={rows} featSrc={feat.path ? featSrc : ''} toast={toast} />

      <ContentImageUploader b={b} article={article} draft={draft} onDraftChange={onDraftChange} onInsertSave={onInsertSave} stored={stored.data?.images} site={{ toReact, facts: react.data?.image_facts || {}, name: react.data?.website_name || hostOf(react.data?.website_url || '') }} caret={caret} limitMb={limitMb}
        onUploaded={() => stored.reload(true)} toast={toast} />

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center space-y-1">
          <ImageIcon size={22} className="text-slate-400 mx-auto" />
          <div className="text-[13px] font-semibold text-slate-700">No images in this blog yet</div>
          <div className="text-[11.5px] text-slate-500">Add a featured image on the AI Draft step, or upload article images above. They show up here straight away.</div>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {rows.map(r => {
            const big = r.bytes > limitBytes;
            return (
              <li key={r.key} className={`flex flex-col sm:flex-row sm:items-center gap-3 p-3 ${big ? 'bg-rose-50/50' : ''}`}>
                <div className="w-full sm:w-28 shrink-0 aspect-[16/10] rounded-lg overflow-hidden bg-slate-100 ring-1 ring-slate-200 flex items-center justify-center">
                  {r.status.tone === 'bad' ? <ImageIcon size={18} className="text-slate-400" /> : <img src={r.src} alt={r.alt || r.name} loading="lazy" className="w-full h-full object-cover" />}
                </div>
                <div className="flex-1 min-w-0 space-y-0.5 text-[12px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900 truncate max-w-full" title={r.src.startsWith('data:') ? r.name : r.src}>{r.name}</span>
                    <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${r.kind === 'Featured' ? 'bg-indigo-100 text-indigo-700' : r.kind === 'Gallery' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{r.kind}</span>
                    {r.uses > 1 && <span className="text-[11px] text-slate-500">used {r.uses}× · counted once</span>}
                  </div>
                  <div className="text-slate-600 tabular-nums">
                    {r.pending ? <span className="inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Measuring…</span>
                      : r.unknown ? <span title="That server does not let the browser read the file size">Size not shared by that server</span>
                        : <b className={big ? 'text-rose-700' : 'text-slate-800'}>{fmtSize(r.bytes)}</b>}
                    {r.original ? <span className="text-slate-400"> · uploaded {fmtSize(r.original)}, stored as WebP</span> : null}
                    {r.dims ? <span className="text-slate-400"> · {r.dims} px</span> : null}
                    {big && <span className="text-rose-700 font-semibold inline-flex items-center gap-1 ml-1.5"><AlertTriangle size={11} /> over {limitMb} MB</span>}
                  </div>
                  <div className={`inline-flex items-center gap-1 ${toneCls[r.status.tone]}`}>
                    {r.status.tone === 'ok' ? <CheckCircle2 size={11} /> : r.status.tone === 'bad' ? <AlertTriangle size={11} /> : null}{r.status.text}
                  </div>
                </div>
                <Button size="sm" icon={Trash2} busy={busy === r.key} disabled={Boolean(busy)} onClick={() => remove(r)}>
                  {confirm === r.key ? 'Click again to remove' : 'Remove'}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {unknown > 0 && <p className="text-[11px] text-slate-500">{unknown} linked image{unknown === 1 ? '' : 's'} could not be measured because {unknown === 1 ? 'its' : 'their'} server hides the file size; {unknown === 1 ? 'it is' : 'they are'} not in the totals. Linked images are not uploaded, so they do not count toward the website’s limit.</p>}

      <SiteBlogImages b={b} article={article} mine={{ featured: featRows[0]?.bytes ?? null, featuredDims: featRows[0]?.dims || '', content: contentRows.length, gallery: galleryRows.length }} limitMb={limitMb} />
    </div>
  );
}
