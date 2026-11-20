import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Send, Package, Save, Copy, Check } from 'lucide-react';
import { Button, Field, inputCls, areaCls } from './SeoUi';
import { api, useApi } from './seoApi';

const EMPTY = { name: '', price: '', description: '', category: '', url: '', image_url: '' };

/** The Products tab of the profile, managed here. Google has no API for that tab, so the catalogue is kept in the software and each product is sent to Google as a post (photo, price, Learn more button). */
export default function ProductsManager({ b, toast }) {
  const res = useApi(`/businesses/${b.id}/gbp/products`);
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState('');
  useEffect(() => { if (res.data) setItems(res.data.products || []); }, [res.data]);
  if (!items) return <p className="text-13 text-slate-500">Loading products…</p>;
  const set = (i, k, v) => setItems(items.map((x, n) => (n === i ? { ...x, [k]: v } : x)));
  const clean = () => items.filter(x => (x.name || '').trim()).map(x => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, (v || '').trim() || null])));
  const save = async () => {
    setBusy('save');
    try { const r = await api(`/businesses/${b.id}/gbp/products`, { method: 'PUT', body: { products: clean() } }); setItems(r.products); toast('Products saved'); }
    catch (e) { toast(e.message); } finally { setBusy(''); }
  };
  const post = async (i) => {
    setBusy(`p${i}`);
    try {
      const r = await api(`/businesses/${b.id}/gbp/products`, { method: 'PUT', body: { products: clean() } });
      setItems(r.products);
      await api(`/businesses/${b.id}/gbp/products/${i}/post`, { method: 'POST' });
      toast('Published on your Google Business Profile as a post');
    } catch (e) { toast(e.message); } finally { setBusy(''); }
  };
  return (
    <div className="space-y-4">
      <p className="text-12.5 text-slate-600 rounded-lg bg-sky-50 ring-1 ring-sky-100 px-3 py-2">Google does not let any software write the Products tab of a profile. So your products are kept here, and <b>Post to Google</b> puts one on your profile as a post with its photo, price and a Learn more button.</p>
      {items.length === 0 && <div className="py-6 text-center text-13 text-slate-500"><Package className="mx-auto mb-2 text-slate-300" size={28} />No products yet.</div>}
      {items.map((x, i) => (
        <div key={i} className="rounded-xl ring-1 ring-slate-200 p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Product name"><input className={inputCls} value={x.name || ''} onChange={e => set(i, 'name', e.target.value)} maxLength={120} /></Field>
          <Field label="Price (e.g. ₹499)"><input className={inputCls} value={x.price || ''} onChange={e => set(i, 'price', e.target.value)} maxLength={40} /></Field>
          <Field label="Category"><input className={inputCls} value={x.category || ''} onChange={e => set(i, 'category', e.target.value)} maxLength={80} /></Field>
          <Field label="Link (https://…)"><input className={inputCls} value={x.url || ''} onChange={e => set(i, 'url', e.target.value)} /></Field>
          <Field label="Photo link (https://…)"><input className={inputCls} value={x.image_url || ''} onChange={e => set(i, 'image_url', e.target.value)} /></Field>
          <div className="md:col-span-2"><Field label="Description"><textarea className={areaCls} rows={3} value={x.description || ''} onChange={e => set(i, 'description', e.target.value)} maxLength={1000} /></Field></div>
          <div className="md:col-span-2 flex flex-wrap justify-end gap-2">
            <Button size="sm" icon={Send} busy={busy === `p${i}`} disabled={!(x.name || '').trim()} onClick={() => post(i)}>Post to Google</Button>
            <Button size="sm" icon={Trash2} onClick={() => setItems(items.filter((_, n) => n !== i))}>Remove</Button>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap justify-between gap-2">
        <Button icon={Plus} onClick={() => setItems([...items, { ...EMPTY }])}>Add a product</Button>
        <Button variant="primary" icon={Save} busy={busy === 'save'} onClick={save}>Save products</Button>
      </div>
    </div>
  );
}

/** Ask for reviews: the link that opens Google's review box, to copy or send. */
export function ReviewAsk({ b }) {
  const link = useApi(`/businesses/${b.id}/review-link`);
  const [done, setDone] = useState(false);
  const url = link.data?.google_url;
  const msg = `Hi! Thank you for choosing ${b.name}. Could you share a quick review? ${url || ''}`;
  const copy = async () => { try { await navigator.clipboard.writeText(msg); setDone(true); setTimeout(() => setDone(false), 1800); } catch { /* the text is shown below to copy by hand */ } };
  if (!link.data) return <p className="text-13 text-slate-500">{link.error ? link.error.message : 'Loading the review link…'}</p>;
  if (!url) return <p className="text-13 text-slate-600">Google has not given a review link for this profile yet. Sync the profile from Google first.</p>;
  return (
    <div className="space-y-3">
      <p className="text-13 text-slate-600">Send this to happy customers. The link opens the review box on Google directly.</p>
      <textarea readOnly className={areaCls} rows={3} value={msg} onFocus={e => e.target.select()} />
      <div className="flex flex-wrap gap-2">
        <Button icon={done ? Check : Copy} onClick={copy}>{done ? 'Copied' : 'Copy message'}</Button>
        <a href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer"><Button>Send on WhatsApp</Button></a>
        <a href={`mailto:?subject=${encodeURIComponent('Could you review us?')}&body=${encodeURIComponent(msg)}`}><Button>Send by email</Button></a>
      </div>
    </div>
  );
}
