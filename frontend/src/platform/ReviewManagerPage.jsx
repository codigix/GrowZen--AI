import React, { useState } from 'react';
import { Star, Sparkles, Send, MessageCircle, Mail, Smartphone, Copy, ShieldCheck, Check, Pencil, Loader2, RefreshCw } from 'lucide-react';
import { SeoShell, Card, Tabs, Stat, Badge, StatusPill, Button, Field, inputCls, areaCls, Meter, ErrorNote, SERIES, useToast, useAction } from './SeoUi';
import { api, useApi, fmtDate } from './seoApi';

const Stars = ({ n, size = 13 }) => (
  <span className="inline-flex" aria-label={`${n} stars`}>{[1, 2, 3, 4, 5].map(i => <Star key={i} size={size} className={i <= n ? 'text-amber-500 fill-amber-500' : 'text-gray-300'} />)}</span>
);

function ReviewCard({ r, b, onSaved, toast }) {
  const [language, setLanguage] = useState(r.reply_language || 'English');
  const [text, setText] = useState(r.reply_text || '');
  const [editing, setEditing] = useState(false);
  const [busy, error, run] = useAction();
  const posted = r.reply_status === 'posted';
  const draft = () => run('draft', async () => { const out = await api(`/businesses/${b.id}/reviews/${r.id}/draft`, { method: 'POST', body: { language } }); setText(out.reply_text); onSaved(out); });
  const approve = () => run('approve', async () => {
    const out = await api(`/businesses/${b.id}/reviews/${r.id}/approve`, { method: 'POST', body: { text, language } });
    onSaved(out);
    setEditing(false);
    toast(out.task?.result?.posted ? 'Reply posted on Google' : 'Reply approved and saved (not linked to Google: post it from the Google app)');
  });
  return (
    <div className={`p-4 border rounded ${r.rating <= 2 && !posted ? 'border-red-200 bg-red-50/30' : 'border-gray-200 bg-white'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium text-gray-900">{r.author || 'Customer'}</span>
        <Stars n={r.rating} />
        <span className="text-[12px] text-gray-500">{fmtDate(r.review_date)}</span>
        {(r.topics || []).map(t => <Badge key={t} tone="gray">{t}</Badge>)}
        <span className="ml-auto">{posted ? <StatusPill level="good">Replied</StatusPill> : r.rating <= 2 ? <StatusPill level="critical">Needs reply</StatusPill> : <StatusPill level="warning">No reply yet</StatusPill>}</span>
      </div>
      {r.body && <p className="text-[13px] text-gray-700 mt-1.5">{r.body}</p>}
      <div className="mt-3 pl-3 border-l-2 border-gray-200">
        {posted ? (
          <><div className="text-[11px] text-gray-500 mb-1">Your reply</div><p className="text-[13px] text-gray-800 whitespace-pre-line">{r.reply_text}</p></>
        ) : (
          <>
            {text && !editing && <><div className="text-[11px] text-gray-500 mb-1 flex items-center gap-1"><Sparkles size={11} className="text-violet-600" /> Draft ({r.reply_language || language}) · waiting for approval</div><p className="text-[13px] text-gray-800 whitespace-pre-line">{text}</p></>}
            {editing && <textarea rows={3} className={areaCls} value={text} onChange={e => setText(e.target.value)} />}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select className="h-7 px-2 text-xs border border-gray-300 rounded bg-white" value={language} onChange={e => setLanguage(e.target.value)} aria-label="Reply language">{['English', 'Hindi', 'Marathi'].map(l => <option key={l}>{l}</option>)}</select>
              <Button size="sm" variant="ai" icon={Sparkles} busy={busy === 'draft'} onClick={draft}>{text ? 'Redraft' : 'Draft reply'}</Button>
              <Button size="sm" icon={editing ? Check : Pencil} onClick={() => setEditing(e => !e)}>{editing ? 'Done' : text ? 'Edit' : 'Write'}</Button>
              {text && <Button size="sm" variant="primary" icon={Send} busy={busy === 'approve'} onClick={approve}>Approve & post</Button>}
            </div>
            <ErrorNote>{error}</ErrorNote>
          </>
        )}
      </div>
    </div>
  );
}

function Reviews({ b, tab }) {
  const rv = useApi(`/businesses/${b.id}/reviews`);
  const [filter, setFilter] = useState('all');
  const [toast, toastNode] = useToast();
  const [busy, error, run] = useAction();
  const [form, setForm] = useState({ name: '', contact: '', channel: 'WhatsApp' });
  if (!rv.data) return rv.error ? <ErrorNote>{rv.error.message}</ErrorNote> : <div className="py-16 flex justify-center text-gray-400"><Loader2 size={16} className="animate-spin" /></div>;
  const { reviews, summary } = rv.data;
  const n = summary.count;
  const shown = reviews.filter(r => filter === 'all' ? true : filter === 'unreplied' ? r.reply_status !== 'posted' : filter === 'negative' ? r.rating <= 2 : r.rating >= 4);
  const saved = (next) => rv.setData(d => ({ ...d, reviews: d.reviews.map(x => x.id === next.id ? { ...x, ...next } : x) }));
  const draftAll = () => run('all', async () => {
    const todo = reviews.filter(r => r.reply_status === 'none');
    for (const r of todo) await api(`/businesses/${b.id}/reviews/${r.id}/draft`, { method: 'POST', body: { language: 'English' } });
    rv.reload(true);
    toast(`Drafted ${todo.length} replies`);
  });
  const sync = () => run('sync', async () => { const r = await api(`/businesses/${b.id}/sync`, { method: 'POST' }); rv.reload(true); toast(`Synced: ${r.new_reviews} new review${r.new_reviews === 1 ? '' : 's'}`); });
  const link = b.place_id ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(b.place_id)}` : '';
  const message = `Hi ${form.name || ''}, thank you for visiting ${b.name}! Could you share your experience on Google? It takes 30 seconds: ${link || '[review link]'}`;
  const phone = form.contact.replace(/\D/g, '');
  const sendHref = form.channel === 'WhatsApp' ? `https://wa.me/${phone.length === 10 ? `91${phone}` : phone}?text=${encodeURIComponent(message)}` : form.channel === 'SMS' ? `sms:${form.contact}?body=${encodeURIComponent(message)}` : `mailto:${form.contact}?subject=${encodeURIComponent(`How was your visit to ${b.name}?`)}&body=${encodeURIComponent(message)}`;

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <Stat label="Average rating" value={summary.avg_rating ? <span className="flex items-center gap-2">{summary.avg_rating}<Stars n={Math.round(summary.avg_rating)} size={14} /></span> : '—'} hint={`${b.reviewCount} on Google`} />
        <Stat label="Reviews here" value={n} />
        <Stat label="Reply rate" value={`${summary.reply_rate}%`} hint="target 90%+" />
        <Stat label="Waiting for a reply" value={summary.awaiting_reply} hint="reply within 24 h" />
        <Stat label="Negative, unanswered" value={reviews.filter(r => r.rating <= 2 && r.reply_status !== 'posted').length} />
      </div>

      {tab === 'inbox' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2">
            <div className="flex flex-wrap gap-1 mb-3">
              {[['all', 'All'], ['unreplied', 'Waiting for reply'], ['negative', '1–2 stars'], ['positive', '4–5 stars']].map(([k, l]) => <button key={k} onClick={() => setFilter(k)} className={`h-7 px-2.5 text-xs rounded border cursor-pointer ${filter === k ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-300 text-gray-700'}`}>{l}</button>)}
              <div className="ml-auto flex gap-2">
                {b.gbp_location && <Button size="sm" icon={RefreshCw} busy={busy === 'sync'} onClick={sync}>Sync from Google</Button>}
                <Button size="sm" variant="ai" icon={Sparkles} busy={busy === 'all'} disabled={!reviews.some(r => r.reply_status === 'none')} onClick={draftAll}>Draft all</Button>
              </div>
            </div>
            <ErrorNote>{error}</ErrorNote>
            {n === 0 ? <div className="py-12 text-center text-[13px] text-gray-500 bg-white border border-gray-200 rounded">{b.gbp_location ? 'No reviews synced yet.' : 'Connect the Google profile (GBP Manager) to pull in reviews.'}</div> : (
              <div className="space-y-3">{shown.map(r => <ReviewCard key={r.id} r={r} b={b} onSaved={saved} toast={toast} />)}</div>
            )}
          </div>
          <div className="space-y-4">
            <Card title="Rating breakdown">
              <div className="space-y-1.5">
                {[5, 4, 3, 2, 1].map(s => { const c = summary.distribution[s] || 0; return <div key={s} className="flex items-center gap-2 text-[12px]"><span className="w-6 text-gray-600">{s}★</span><Meter value={c} max={n || 1} color={s >= 4 ? SERIES[0] : s === 3 ? SERIES[3] : SERIES[1]} /><span className="w-6 text-right tabular-nums text-gray-600">{c}</span></div>; })}
              </div>
            </Card>
            <Card title="What customers talk about" subtitle="Topics tagged from review text">
              {summary.topics.length === 0 ? <div className="text-[12px] text-gray-500">No topics yet.</div> : <div className="flex flex-wrap gap-1.5">{summary.topics.map(t => <Badge key={t.name} tone="gray">{t.name} · {t.count}</Badge>)}</div>}
            </Card>
          </div>
        </div>
      )}

      {tab === 'requests' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card title="Ask for a review" subtitle="Opens WhatsApp, SMS or email with the message ready to send">
            <div className="space-y-3">
              <Field label="Customer name"><input className={inputCls} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Phone or email"><input className={inputCls} value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} /></Field>
              <div className="grid grid-cols-3 gap-1">{[['WhatsApp', MessageCircle], ['SMS', Smartphone], ['Email', Mail]].map(([c, I]) => <button key={c} onClick={() => setForm({ ...form, channel: c })} className={`h-9 flex items-center justify-center gap-1.5 text-[12px] rounded border cursor-pointer ${form.channel === c ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-300 text-gray-700'}`}><I size={13} /> {c}</button>)}</div>
              <div className="bg-[#e7f6e7] rounded p-3 text-[12px] text-gray-800">{message}</div>
              <a href={form.contact && link ? sendHref : undefined} target="_blank" rel="noreferrer" className={`h-8 w-full inline-flex items-center justify-center gap-1.5 rounded text-[13px] font-medium ${form.contact && link ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-100 text-gray-400 pointer-events-none'}`}><Send size={13} /> Open {form.channel}</a>
              {!link && <p className="text-[12px] text-amber-800">The review link needs the profile's Place ID: connect the Google profile first.</p>}
            </div>
          </Card>
          <Card title="Review link">
            {link ? (
              <>
                <div className="font-mono text-[12px] text-gray-700 break-all bg-gray-50 border border-gray-200 rounded p-2">{link}</div>
                <Button className="mt-2" size="sm" icon={Copy} onClick={() => navigator.clipboard?.writeText(link).then(() => toast('Link copied'))}>Copy link</Button>
                <p className="text-[12px] text-gray-500 mt-2">Put it on receipts, the website and a QR code at the counter.</p>
              </>
            ) : <div className="text-[13px] text-gray-500">Available once the Google profile is connected.</div>}
          </Card>
          <Card title="Review rules we enforce">
            <ul className="text-[12px] text-gray-700 space-y-1.5">
              {['Ask every customer, never only happy ones (no “review gating”)', 'No discounts or gifts for reviews', 'No AI-written reviews; AI only drafts your replies', 'Message customers only with consent (DPDP Act)'].map(t => <li key={t} className="flex gap-2"><ShieldCheck size={14} className="text-emerald-600 shrink-0 mt-px" />{t}</li>)}
            </ul>
          </Card>
        </div>
      )}
      {toastNode}
    </>
  );
}

export default function ReviewManagerPage() {
  const [tab, setTab] = useState('inbox');
  return (
    <SeoShell title="Reviews" subtitle="Reply to every review within 24 hours, ask every customer for one, and see what people talk about">
      {(b) => (
        <>
          <Tabs value={tab} onChange={setTab} tabs={[{ id: 'inbox', label: 'Review inbox' }, { id: 'requests', label: 'Review requests' }]} />
          <Reviews key={b.id} b={b} tab={tab} />
        </>
      )}
    </SeoShell>
  );
}
