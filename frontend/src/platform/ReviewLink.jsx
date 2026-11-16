import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, Check, Mail, MessageCircle, Facebook, Download, ExternalLink, QrCode, Sparkles, Star, Loader2, RefreshCw, ClipboardCheck } from 'lucide-react';
import { Card, Button, ErrorNote, inputCls } from './SeoUi';
import { api, useApi } from './seoApi';
import Select from '../components/Select';

function useCopy() {
  const [done, setDone] = useState('');
  const copy = async (key, text) => {
    try { await navigator.clipboard.writeText(text); } catch {
      const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch { /* ignore */ } t.remove();
    }
    setDone(key); setTimeout(() => setDone(d => (d === key ? '' : d)), 1800);
  };
  return [done, copy];
}

/** Reviews page card: the customer review link, its QR code and one-tap sharing. */
export function ReviewLinkCard({ b }) {
  const link = useApi(`/businesses/${b.id}/review-link`);
  const [qr, setQr] = useState('');
  const [done, copy] = useCopy();
  const d = link.data;
  useEffect(() => { if (d?.share_url) QRCode.toDataURL(d.share_url, { width: 360, margin: 1, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr('')); }, [d?.share_url]);
  if (!d) return link.error ? <ErrorNote>{link.error.message}</ErrorNote> : null;
  const msg = `Hi! Thank you for choosing ${b.name}. Could you share your experience in a quick review? It takes a minute: ${d.share_url}`;
  const enc = encodeURIComponent;
  const channels = [
    ['Email', Mail, `mailto:?subject=${enc(`How was your visit to ${b.name}?`)}&body=${enc(msg)}`],
    ['WhatsApp', MessageCircle, `https://wa.me/?text=${enc(msg)}`],
    ['Facebook', Facebook, `https://www.facebook.com/sharer/sharer.php?u=${enc(d.share_url)}`]
  ];
  const Row = ({ label, value, k }) => (
    <div>
      <div className="text-12 font-medium text-slate-500 mb-1">{label}</div>
      <div className="flex items-stretch gap-2">
        <input readOnly value={value} onFocus={e => e.target.select()} className={`${inputCls} flex-1 min-w-0 font-mono text-12.5`} aria-label={label} />
        <Button icon={done === k ? Check : Copy} onClick={() => copy(k, value)}>{done === k ? 'Copied' : 'Copy'}</Button>
      </div>
    </div>
  );
  return (
    <Card title="Get more reviews" subtitle="Send customers one link. They pick what they used, get a ready-to-edit review, and post it on Google themselves.">
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_200px] gap-6">
        <div className="space-y-4 min-w-0">
          <div className="flex flex-wrap gap-2">
            {channels.map(([l, I, href]) => <a key={l} href={href} target="_blank" rel="noreferrer" className="h-9 px-3.5 rounded-lg ring-1 ring-slate-300 hover:bg-slate-50 inline-flex items-center gap-2 text-13 font-medium text-slate-700 cursor-pointer"><I size={15} />{l}</a>)}
            <a href={d.share_url} target="_blank" rel="noreferrer" className="h-9 px-3.5 rounded-lg ring-1 ring-slate-300 hover:bg-slate-50 inline-flex items-center gap-2 text-13 font-medium text-slate-700 cursor-pointer"><ExternalLink size={15} />Preview the customer page</a>
          </div>
          <Row label="Review page link (share this)" value={d.share_url} k="share" />
          {d.google_url ? <Row label="Direct Google review link" value={d.google_url} k="google" /> : <p className="text-12.5 text-amber-700 bg-amber-50 rounded-lg px-3 py-2">Google’s review link is not available yet. Connect the Google account and sync, and the customer page will send people straight to Google.</p>}
          {!d.public_site && <p className="text-12.5 text-slate-500 bg-slate-50 rounded-lg px-3 py-2">This link points to a private address ({new URL(d.share_url).host}), so customers outside your network cannot open it. Set FRONTEND_URL to your public website address for the link and QR code to work for everyone.</p>}
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="w-[180px] h-[180px] rounded-xl ring-1 ring-slate-200 bg-white p-2 flex items-center justify-center">{qr ? <img src={qr} alt="QR code for the review page" className="w-full h-full" /> : <QrCode size={40} className="text-slate-300" />}</div>
          <a href={qr || undefined} download={`${b.name.replace(/\W+/g, '-')}-review-qr.png`} className={`text-13 font-medium inline-flex items-center gap-1.5 ${qr ? 'text-indigo-600 hover:underline cursor-pointer' : 'text-slate-300 pointer-events-none'}`}><Download size={14} />Download QR</a>
          <p className="text-11.5 text-slate-400 text-center">Print it for the counter, the bill or a thank-you card.</p>
        </div>
      </div>
    </Card>
  );
}

/** The page a customer opens from the link: pick stars and services, get a worded review to edit, copy it and post on Google. No sign-in. */
export function PublicReviewPage({ token }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [rating, setRating] = useState(5);
  const [hover, setHover] = useState(0);
  const [picked, setPicked] = useState([]);
  const [notes, setNotes] = useState('');
  const [language, setLanguage] = useState('English');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const area = useRef(null);
  const base = import.meta.env.VITE_API_URL || '/api/v1';

  useEffect(() => {
    document.title = 'Share your experience';
    fetch(`${base}/public/review/${encodeURIComponent(token)}`).then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'This review link is not valid.'); return r.json(); }).then(setInfo).catch(e => setError(e.message));
  }, [token, base]);

  const write = async () => {
    setBusy(true); setError(''); setCopied(false);
    try {
      const r = await fetch(`${base}/public/review/${encodeURIComponent(token)}/suggest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating, services: picked, notes, language }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'Could not write a suggestion. Please try again.');
      setText(j.text);
      setTimeout(() => area.current?.focus(), 50);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const post = async () => {
    try { await navigator.clipboard.writeText(text); } catch { area.current?.select(); try { document.execCommand('copy'); } catch { /* ignore */ } }
    setCopied(true);
    if (info?.google_url) window.open(info.google_url, '_blank', 'noopener');
  };

  if (error && !info) return <Shell><div className="text-center py-10"><div className="text-18 font-semibold text-slate-900">Link not available</div><p className="text-14 text-slate-500 mt-2">{error}</p></div></Shell>;
  if (!info) return <Shell><div className="py-16 flex justify-center text-slate-400"><Loader2 className="animate-spin" /></div></Shell>;
  const toggle = (s) => setPicked(p => (p.includes(s) ? p.filter(x => x !== s) : [...p, s].slice(0, 5)));
  const shownStars = hover || rating;
  return (
    <Shell>
      <div className="flex flex-col items-center text-center">
        {info.logo ? <img src={info.logo} alt="" className="w-16 h-16 rounded-full object-cover ring-1 ring-slate-200" /> : <div className="w-16 h-16 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-24 font-bold">{info.name.charAt(0).toUpperCase()}</div>}
        <h1 className="text-22 font-semibold text-slate-900 mt-3">{info.name}</h1>
        {(info.category || info.city) && <div className="text-13 text-slate-500 mt-0.5">{[info.category, info.city].filter(Boolean).join(' · ')}</div>}
        <p className="text-15 text-slate-700 mt-4">How was your experience?</p>
        <div className="flex gap-1 mt-2" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map(n => <button key={n} type="button" onMouseEnter={() => setHover(n)} onClick={() => setRating(n)} aria-label={`${n} star${n > 1 ? 's' : ''}`} className="p-1 cursor-pointer"><Star size={34} className={n <= shownStars ? 'fill-amber-400 text-amber-400' : 'text-slate-300'} /></button>)}
        </div>
      </div>

      {info.services.length > 0 && (
        <section className="mt-6">
          <div className="text-13 font-semibold text-slate-800 mb-2">What did you use? <span className="font-normal text-slate-400">(pick up to 5)</span></div>
          <div className="flex flex-wrap gap-2">{info.services.map(s => <button key={s} type="button" onClick={() => toggle(s)} aria-pressed={picked.includes(s)} className={`h-9 px-3.5 rounded-full text-13 cursor-pointer transition-colors ${picked.includes(s) ? 'bg-indigo-600 text-white' : 'ring-1 ring-slate-300 text-slate-700 hover:bg-slate-50'}`}>{s}</button>)}</div>
        </section>
      )}

      <section className="mt-5">
        <label className="text-13 font-semibold text-slate-800 block mb-1.5" htmlFor="note">Anything you liked? <span className="font-normal text-slate-400">(optional)</span></label>
        <input id="note" className={inputCls} value={notes} onChange={e => setNotes(e.target.value.slice(0, 300))} placeholder="e.g. friendly staff, delivered on time" />
      </section>

      <div className="mt-5 flex items-end gap-3">
        <div className="w-36 shrink-0"><div className="text-13 font-semibold text-slate-800 mb-1.5">Language</div><Select className={inputCls} value={language} onChange={e => setLanguage(e.target.value)} aria-label="Language">{info.languages.map(l => <option key={l} value={l}>{l}</option>)}</Select></div>
        <button type="button" onClick={write} disabled={busy} className="flex-1 h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-14 font-semibold inline-flex items-center justify-center gap-2 cursor-pointer">{busy ? <Loader2 size={16} className="animate-spin" /> : text ? <RefreshCw size={16} /> : <Sparkles size={16} />}{text ? 'Write another version' : 'Write my review'}</button>
      </div>
      {error && <p className="text-13 text-red-600 mt-3">{error}</p>}

      {text && (
        <section className="mt-6">
          <div className="text-13 font-semibold text-slate-800 mb-1.5">Your review</div>
          <textarea ref={area} rows={6} value={text} onChange={e => { setText(e.target.value.slice(0, 1000)); setCopied(false); }} className={`${inputCls} !h-auto py-3 leading-relaxed`} aria-label="Your review" />
          <p className="text-12 text-slate-400 mt-1.5">This is a suggestion from your answers. Please change it so it says what you really felt.</p>
          <button type="button" onClick={post} disabled={!text.trim()} className="mt-3 w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-15 font-semibold inline-flex items-center justify-center gap-2 cursor-pointer">
            {copied ? <ClipboardCheck size={18} /> : <Copy size={18} />}{copied ? 'Copied: now paste it on Google' : 'Copy and post on Google'}
          </button>
          {copied && <ol className="mt-3 text-13 text-slate-600 list-decimal pl-5 space-y-0.5"><li>Google opens in a new tab.</li><li>Choose your stars, paste your review (Ctrl+V or long-press).</li><li>Tap <b>Post</b>. Thank you!</li></ol>}
          {!info.google_url && <p className="text-12.5 text-amber-700 mt-2">The Google review link is not ready yet. Search for {info.name} on Google Maps and tap “Write a review”.</p>}
        </section>
      )}
      <p className="text-11.5 text-slate-400 text-center mt-8">Your review is posted by you on Google. We never post for you.</p>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-slate-50 flex justify-center px-4 py-8 sm:py-12">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-6 sm:p-8 h-fit">{children}</div>
    </div>
  );
}
