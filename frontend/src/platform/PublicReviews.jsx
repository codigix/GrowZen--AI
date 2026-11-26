import React, { useState } from 'react';
import { Star, Download } from 'lucide-react';
import { Card, Badge, Button, ErrorNote, useAction, useToast, SkList, Meter } from './SeoUi';
import { api, useApi, fmtDate } from './seoApi';

const FILTERS = [['all', 'All'], ['open', 'No reply yet'], ['5', '5★'], ['4', '4★'], ['3', '3★'], ['low', '1–2★'], ['text', 'With a comment']];
const H = 'text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1.5';
const Stars = ({ n }) => <span className="text-amber-500 tracking-tight" aria-label={`${n} stars`}>{'★'.repeat(n)}<span className="text-slate-300">{'★'.repeat(5 - n)}</span></span>;

/** The Reviews tab for a profile that is not connected to Google: the public reviews read from Google, their rating spread and who has been answered. */
export default function PublicReviews({ b }) {
  const prof = useApi(`/businesses/${b.id}/maps-public/profile`);
  const all = useApi(`/businesses/${b.id}/maps-public/reviews`);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const [filter, setFilter] = useState('all');
  const p = prof.data?.state === 'ok' ? prof.data.profile : null;
  const fetchAll = () => run('fetch', async () => { const r = await api(`/businesses/${b.id}/maps-public/import-reviews`, { method: 'POST', body: { depth: 5 } }); await all.reload(true); toast(`Google shows ${r.read} reviews: ${r.added} new, ${r.skipped} already saved`); });
  const rows = all.data?.reviews || [];
  const shown = rows.filter(r => filter === 'all' || (filter === 'open' && r.reply_status !== 'posted') || (filter === 'low' && r.rating <= 2) || (filter === 'text' && r.body) || String(r.rating) === filter);
  const fromGoogle = !!p?.distribution; // the split by stars is known only for a connected profile; otherwise it is counted from the reviews saved here
  const dist = p?.distribution || Object.fromEntries([1, 2, 3, 4, 5].map(n => [n, rows.filter(r => r.rating === n).length])); const total = Object.values(dist).reduce((x, y) => x + y, 0) || 1;
  const answered = rows.filter(r => r.reply_status === 'posted').length;
  const csv = () => {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Author', 'Stars', 'Date', 'Comment', 'Owner reply'].join(','), ...rows.map(r => [r.author, r.rating, r.review_date, r.body, r.reply_text].map(q).join(','))];
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })); a.download = 'google-reviews.csv'; a.click();
  };
  return (
    <div className="space-y-4">
      <Card title="Reviews on Google" subtitle="Read from the public Google listing. To reply from here, connect the Google account."
        action={<span className="flex gap-2"><Button size="sm" variant="primary" busy={busy === 'fetch'} disabled={!b.place_id} onClick={fetchAll}>{rows.length ? 'Read the reviews Google shows again' : 'Read the reviews Google shows'}</Button>{rows.length > 0 && <Button size="sm" icon={Download} onClick={csv}>Download CSV</Button>}</span>}>
        <ErrorNote>{error}</ErrorNote>
        {!b.place_id && <p className="text-13 text-amber-800">This project is not linked to a Google Maps listing yet, so there is nothing to read.</p>}
        {b.place_id && !p && !prof.error && <SkList rows={2} />}
        {prof.data && prof.data.state !== 'ok' && <p className="text-13 text-amber-800">{prof.data.message}</p>}
        {p && (
          <div className="grid md:grid-cols-2 gap-6 text-13">
            <div className="flex items-center gap-4"><div className="text-center"><div className="text-32 leading-none font-bold text-slate-900">{p.rating ?? '—'}</div><Stars n={Math.round(p.rating || 0)} /><div className="text-12 text-slate-500 mt-1">{p.votes} reviews</div></div>
              <div className="flex-1 grid gap-1">{[5, 4, 3, 2, 1].map(n => <div key={n} className="flex items-center gap-2 text-12 text-slate-600"><span className="w-6">{n}★</span><div className="flex-1"><Meter value={dist[n] || 0} max={total} height={6} /></div><span className="w-9  tabular-nums">{dist[n] || 0}</span></div>)}{!fromGoogle && <p className="text-11 text-slate-400 mt-1">Counted from the {total} review{total === 1 ? '' : 's'} saved here, not from all {p.votes}.</p>}</div></div>
            <div className="grid grid-cols-3 gap-3 content-center text-center">
              <div className="rounded-lg bg-slate-50 py-3"><div className="text-20 font-bold tabular-nums">{rows.length}</div><div className="text-12 text-slate-500">saved here</div></div>
              <div className="rounded-lg bg-slate-50 py-3"><div className="text-20 font-bold tabular-nums">{rows.length ? Math.round((answered / rows.length) * 100) : 0}%</div><div className="text-12 text-slate-500">answered by owner</div></div>
              <div className="rounded-lg bg-slate-50 py-3"><div className="text-20 font-bold tabular-nums">{rows.filter(r => r.rating <= 2).length}</div><div className="text-12 text-slate-500">1–2 stars</div></div>
            </div>
          </div>
        )}
      </Card>

      <Card title="Reviews" subtitle={rows.length ? `${shown.length} of ${rows.length} saved` : 'None saved yet'}>
        {!all.data && !all.error && <SkList rows={4} />}
        {all.error && <ErrorNote>{all.error.message}</ErrorNote>}
        {all.data && (
          <>
            <div className="flex flex-wrap gap-1.5 mb-3">{FILTERS.map(([k, l]) => <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k} className={`h-8 px-3 rounded-full text-12 font-semibold cursor-pointer ring-1 ring-inset ${filter === k ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}>{l}</button>)}</div>
            {shown.length === 0 && <p className="text-13 text-slate-500 py-6 text-center">{rows.length ? 'No reviews match this filter.' : 'Press “Read the reviews Google shows” to save them here. Google shares the five most relevant; all of them arrive once the Google account is connected.'}</p>}
            <ul className="grid gap-3">{shown.map(r => (
              <li key={r.id} className="rounded-lg ring-1 ring-inset ring-slate-200 p-3.5 text-13">
                <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-slate-900">{r.author || 'Google user'}</span><Stars n={r.rating} /><span className="text-12 text-slate-400">{r.review_date ? fmtDate(r.review_date) : ''}</span>
                  {r.reply_status === 'posted' ? <Badge tone="green">Owner replied</Badge> : <Badge tone="amber">No reply</Badge>}</div>
                {r.body ? <p className="mt-1.5 text-slate-700 whitespace-pre-line">{r.body}</p> : <p className="mt-1.5 text-slate-400">Rating only, no comment.</p>}
                {r.reply_text && <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-slate-600"><span className="text-12 font-semibold text-slate-500">Owner reply</span><p>{r.reply_text}</p></div>}
              </li>))}</ul>
          </>
        )}
      </Card>
      {toastNode}
    </div>
  );
}
