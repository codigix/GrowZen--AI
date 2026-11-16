import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, ExternalLink, Loader2, RefreshCw, Send, XCircle, Pencil, Ban } from 'lucide-react';
import { Badge, Button, Card, Field, Modal, inputCls } from './SeoUi';
import { api, usePoll } from './seoApi';
import Select from '../components/Select';

/** Publishing status of an article in GrowZen (from the server: publishing_status). */
export const PUB_STATUS = {
  draft: ['Draft', 'gray'],
  scheduled: ['Scheduled', 'amber'],
  publishing: ['Publishing', 'blue'],
  published: ['Published', 'green'],
  failed: ['Failed', 'red']
};
const DOT = { draft: 'bg-slate-400', scheduled: 'bg-amber-500', publishing: 'bg-blue-500', published: 'bg-emerald-500', failed: 'bg-rose-500' };
const CHIP = {
  scheduled: 'bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100',
  publishing: 'bg-blue-50 border-blue-200 text-blue-900 hover:bg-blue-100',
  published: 'bg-emerald-50 border-emerald-200 text-emerald-900 hover:bg-emerald-100',
  failed: 'bg-rose-50 border-rose-200 text-rose-900 hover:bg-rose-100'
};
const DEST_LABEL = { react: 'React.js Website', html: 'HTML Website', wordpress: 'WordPress', github: 'GitHub', ghost: 'Ghost', shopify: 'Shopify', webhook: 'Signed webhook' };

export const tzShort = (tz) => (tz === 'Asia/Kolkata' ? 'IST' : tz || '');
const fmtDay = (ymd) => new Date(`${ymd}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
/** "Wed, 05 Nov 2026 · 10:00 IST · React.js Website" */
export const scheduleText = (s) => s ? `${fmtDay(s.date)} · ${s.time} ${tzShort(s.timezone)} · ${DEST_LABEL[s.destination] || s.destination}` : '';

/** Now in the publishing time zone, as "YYYY-MM-DD" and "HH:MM" (only for defaults and the early check; the server decides). */
function nowIn(tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00`); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
const pad = (n) => String(n).padStart(2, '0');
/** The next 15-minute slot after now in the publishing time zone (e.g. 16:41 -> 16:45, 23:50 -> 00:00 next day). */
function nextSlot(tz) {
  const now = nowIn(tz);
  const [h, m] = now.time.split(':').map(Number);
  const mins = Math.floor((h * 60 + m) / 15) * 15 + 15;
  return mins >= 1440 ? { date: addDays(now.date, 1), time: `${pad(Math.floor((mins - 1440) / 60))}:${pad((mins - 1440) % 60)}` }
    : { date: now.date, time: `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}` };
}
/** A complete date + time that is still in the future (in the publishing time zone). */
const isFuture = (date, time, tz) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(time || '')) return false;
  const now = nowIn(tz);
  return `${date} ${time}` > `${now.date} ${now.time}`;
};
/** Keep a valid future date/time as it is; anything already passed becomes the next available slot. */
const validWhen = (date, time, tz) => (isFuture(date, time, tz) ? { date, time } : nextSlot(tz));

/** Schedule / reschedule (mode "schedule") or publish right away (mode "publish") one article. */
export function ScheduleModal({ b, article, mode = 'schedule', onClose, onDone, toast }) {
  const [dest, setDest] = useState(null);  // { destinations, timezone }
  const [loadErr, setLoadErr] = useState('');
  const current = article?.schedule;
  const [form, setForm] = useState({ date: '', time: '10:00', destination: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api(`/businesses/${b.id}/articles/destinations`).then(d => {
      setDest(d);
      // the saved schedule when it is still ahead, otherwise the next available 15-minute slot
      const when = current ? validWhen(current.date, current.time, d.timezone) : nextSlot(d.timezone);
      setForm({
        ...when,
        destination: (current && d.destinations.some(x => x.id === current.destination) ? current.destination : d.destinations[0]?.id) || ''
      });
    }).catch(e => setLoadErr(e.message || String(e)));
  }, [b.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const tz = dest?.timezone || 'Asia/Kolkata';
  const now = nowIn(tz);
  const chosen = dest?.destinations.find(x => x.id === form.destination);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  // a picked date/time that has already passed is replaced by the next available slot (no error text)
  const setWhen = (k) => (e) => {
    const v = e.target.value;
    setForm(f => {
      const next = { ...f, [k]: v };
      if (!next.date || !next.time) return next;  // still being typed
      return { ...next, ...validWhen(next.date, next.time, tz) };
    });
  };

  const submit = async () => {
    setError('');
    let body = form;
    if (mode === 'schedule' && !isFuture(form.date, form.time, tz)) {
      setForm(f => ({ ...f, ...nextSlot(tz) }));  // the time passed while the dialog was open: suggest the next slot, save on the next click
      return;
    }
    setBusy(true);
    try {
      let r;
      if (mode === 'schedule') {
        try {
          r = await api(`/businesses/${b.id}/articles/${article.id}/schedule`, { method: 'PUT', body });
        } catch (e) {
          if (!/future/i.test(e.message || '')) throw e;
          body = { ...body, ...nextSlot(tz) };  // the server's clock says it just passed: move to the next slot once
          setForm(f => ({ ...f, ...nextSlot(tz) }));
          r = await api(`/businesses/${b.id}/articles/${article.id}/schedule`, { method: 'PUT', body });
        }
        toast?.(`Scheduled for ${scheduleText(r.article.schedule)}.`);
      } else if (form.destination === 'react') {
        r = await api(`/businesses/${b.id}/articles/${article.id}/publish-react`, { method: 'POST', body: { mode: 'publish' } });
        toast?.('Published on the React.js website.');
      } else {
        r = await api(`/businesses/${b.id}/articles/${article.id}/publish`, { method: 'POST', body: { mode: 'publish' } });
        toast?.('Published on your website.');
      }
      onDone?.(r.article);
      onClose();
    } catch (e) { setError(e.message || String(e)); } finally { setBusy(false); }
  };

  const title = mode === 'publish' ? 'Publish now' : current && ['scheduled', 'failed'].includes(article.publishing_status) ? 'Reschedule article' : 'Schedule article';
  return (
    <Modal open title={title} onClose={onClose} footer={
      <>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon={mode === 'publish' ? Send : CalendarDays} busy={busy}
          disabled={!dest || !form.destination || (mode === 'schedule' && (!form.date || !form.time))} onClick={submit}>
          {mode === 'publish' ? 'Publish now' : 'Save schedule'}
        </Button>
      </>
    }>
      <div className="space-y-3 text-[12.5px]">
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
          <div className="font-semibold text-slate-900">{article.title || article.keyword}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">{mode === 'publish'
            ? 'The article goes live on the website right away, with its featured image and SEO fields.'
            : 'GrowZen keeps the article and publishes it automatically at this time. Nothing is sent to the website before then.'}</div>
        </div>
        {loadErr && <p className="text-rose-700">{loadErr}</p>}
        {!dest && !loadErr && <div className="flex items-center gap-2 text-slate-500"><Loader2 size={13} className="animate-spin" /> Loading destinations…</div>}
        {dest && !dest.destinations.length && (
          <p className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900">No website is connected to this account. Connect WordPress or the React.js website first (open the article → Publish &amp; Schedule).</p>
        )}
        {dest && dest.destinations.length > 0 && (
          <>
            <Field label="Publishing destination" hint={chosen?.target ? `Target: ${chosen.target.replace(/^https?:\/\//, '')}` : undefined}>
              <Select className={inputCls} value={form.destination} onChange={set('destination')}>
                {dest.destinations.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
              </Select>
            </Field>
            {mode === 'schedule' && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Publication date"><input type="date" className={inputCls} min={now.date} value={form.date} onChange={setWhen('date')} /></Field>
                <Field label={`Publication time (${tzShort(tz)})`}><input type="time" className={inputCls} value={form.time} onChange={setWhen('time')} /></Field>
              </div>
            )}
            {mode === 'schedule' && <p className="flex items-center gap-1.5 text-[11px] text-slate-500"><Clock size={12} /> Times are in {tz}{tz === 'Asia/Kolkata' ? ' (India Standard Time)' : ''}.</p>}
          </>
        )}
        {error && <p className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800">{error}</p>}
      </div>
    </Modal>
  );
}

/** Cancel / retry calls shared by the list and the calendar. */
export const cancelSchedule = (b, id) => api(`/businesses/${b.id}/articles/${id}/schedule`, { method: 'DELETE' });
export const retrySchedule = (b, id) => api(`/businesses/${b.id}/articles/${id}/schedule/retry`, { method: 'POST' });

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const monthOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** The Publishing Calendar: articles scheduled in GrowZen, on their dates, with their status. */
export function PublishingCalendar({ b, onOpenArticle, toast }) {
  const [month, setMonth] = useState(() => monthOf(new Date()));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);       // the calendar entry shown in the details dialog
  const [editing, setEditing] = useState(null);  // { article, mode } for the schedule dialog
  const [busy, setBusy] = useState('');
  const load = (quiet) => {
    if (!quiet) setError('');
    return api(`/businesses/${b.id}/articles/calendar?month=${month}`).then(setData).catch(e => setError(e.message || String(e)));
  };
  useEffect(() => { setData(null); load(); }, [b.id, month]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = (data?.entries || []).some(e => e.publishing_status === 'publishing' || e.publishing_status === 'scheduled');
  usePoll(() => load(true), live, 30000);  // only to show what the backend scheduler did; publishing never depends on this page

  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  const cells = Math.ceil((offset + days) / 7) * 7;
  const byDay = useMemo(() => {
    const out = {};
    for (const e of data?.entries || []) (out[Number(e.date.slice(8, 10))] ||= []).push(e);
    return out;
  }, [data]);
  const today = nowIn(data?.timezone);
  const shift = (n) => setMonth(monthOf(new Date(y, m - 1 + n, 1)));
  const counts = (data?.entries || []).reduce((acc, e) => ({ ...acc, [e.publishing_status]: (acc[e.publishing_status] || 0) + 1 }), {});

  const act = async (key, fn, done) => {
    setBusy(key);
    try { await fn(); toast?.(done); setOpen(null); await load(true); } catch (e) { toast?.(e.message || String(e)); } finally { setBusy(''); }
  };
  const asArticle = (e) => ({ id: e.article_id, title: e.title, publishing_status: e.publishing_status, schedule: e });

  return (
    <div className="space-y-5">
      <Card
        title={`${first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} Publishing Calendar`}
        subtitle="Articles scheduled in GrowZen (published automatically at their time) and articles already published to your website."
        action={
          <div className="flex items-center gap-1.5">
            <span className="hidden sm:inline text-[11px] text-slate-500 font-mono mr-1">Times in {tzShort(data?.timezone || 'Asia/Kolkata')}</span>
            <Button size="sm" variant="ghost" icon={ChevronLeft} onClick={() => shift(-1)} aria-label="Previous month" />
            <Button size="sm" onClick={() => setMonth(monthOf(new Date()))}>Today</Button>
            <Button size="sm" variant="ghost" icon={ChevronRight} onClick={() => shift(1)} aria-label="Next month" />
            <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => load()} aria-label="Refresh" />
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-3 mb-3 text-[11px] text-slate-600">
          {['scheduled', 'publishing', 'published', 'failed'].map(s => (
            <span key={s} className="inline-flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${DOT[s]}`} />{PUB_STATUS[s][0]}{counts[s] ? <b className="text-slate-800">{counts[s]}</b> : null}</span>
          ))}
          {!data && !error && <span className="inline-flex items-center gap-1 text-slate-400"><Loader2 size={11} className="animate-spin" /> Loading…</span>}
        </div>
        {error && <p className="mb-2 text-rose-700 text-[12px]">{error}</p>}
        <div className="grid grid-cols-7 gap-1 text-[11px] font-mono text-slate-500 mb-1 text-center font-bold">
          {WEEK.map(d => <div key={d} className="py-1">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: cells }, (_, i) => {
            const day = i - offset + 1;
            const valid = day >= 1 && day <= days;
            const isToday = valid && today.date === `${month}-${String(day).padStart(2, '0')}`;
            return (
              <div key={i} className={`min-h-[92px] rounded-xl border p-1.5 sm:p-2 ${valid ? `bg-slate-50 ${isToday ? 'border-indigo-400 ring-1 ring-indigo-200' : 'border-slate-200'}` : 'border-transparent opacity-0'}`}>
                {valid && (
                  <>
                    <div className={`text-[11px] font-mono font-bold mb-1 ${isToday ? 'text-indigo-700' : 'text-slate-500'}`}>{day}</div>
                    <div className="space-y-1">
                      {(byDay[day] || []).map(e => (
                        <button key={e.id} type="button" onClick={() => setOpen(e)} title={`${e.title} · ${PUB_STATUS[e.publishing_status]?.[0]} · ${e.time}`}
                          className={`w-full text-left px-1.5 py-0.5 rounded border text-[10px] truncate font-medium cursor-pointer transition-colors ${CHIP[e.publishing_status] || CHIP.scheduled}`}>
                          <span className={`w-1.5 h-1.5 rounded-full inline-block mr-1 ${DOT[e.publishing_status]}`} />
                          <span className="font-mono">{e.time}</span> {e.title}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
        {data && !data.entries.length && (
          <p className="mt-3 text-center text-[12px] text-slate-500">Nothing scheduled this month. Schedule a draft from <b>Generated articles</b> on the AI Blog &amp; Article Writer tab.</p>
        )}
      </Card>

      {open && (
        <Modal open title={open.publishing_status === 'published' ? 'Published article' : 'Scheduled article'} onClose={() => setOpen(null)} footer={
          <>
            {['scheduled', 'failed'].includes(open.publishing_status) && (
              <Button icon={Ban} busy={busy === 'cancel'} onClick={() => act('cancel', () => cancelSchedule(b, open.article_id), 'Schedule cancelled: the article is a draft again.')}>Cancel schedule</Button>
            )}
            {['scheduled', 'failed'].includes(open.publishing_status) && (
              <Button icon={CalendarDays} onClick={() => { setEditing({ article: asArticle(open), mode: 'schedule' }); setOpen(null); }}>Reschedule</Button>
            )}
            {open.publishing_status === 'failed' && (
              <Button variant="primary" icon={RefreshCw} busy={busy === 'retry'} onClick={() => act('retry', async () => {
                const r = await retrySchedule(b, open.article_id);
                if (r.article.publishing_status !== 'published') throw new Error(r.error || 'Publishing failed again.');
              }, 'Published.')}>Retry now</Button>
            )}
            <Button variant={open.publishing_status === 'failed' ? 'secondary' : 'primary'} icon={Pencil} onClick={() => { onOpenArticle?.(open.article_id); setOpen(null); }}>Review &amp; edit</Button>
          </>
        }>
          <div className="space-y-3 text-[12.5px]">
            <div className="flex items-start gap-2">
              <Badge tone={PUB_STATUS[open.publishing_status]?.[1]}>{open.publishing_status === 'publishing' && <Loader2 size={11} className="animate-spin" />}{PUB_STATUS[open.publishing_status]?.[0]}</Badge>
              <span className="font-semibold text-slate-900">{open.title}</span>
            </div>
            <dl className="grid grid-cols-[120px_1fr] gap-y-1.5 text-[12px]">
              <dt className="text-slate-500">Publication</dt><dd className="text-slate-800">{fmtDay(open.date)} · {open.time} {tzShort(open.timezone)}{open.direct ? ' · published directly' : open.publishing_status === 'published' ? ' · published by the scheduler' : ''}</dd>
              <dt className="text-slate-500">Destination</dt><dd className="text-slate-800">{DEST_LABEL[open.destination] || open.destination}</dd>
              {open.attempts > 0 && <><dt className="text-slate-500">Attempts</dt><dd className="text-slate-800">{open.attempts}</dd></>}
              {open.url && <><dt className="text-slate-500">Published URL</dt><dd><a href={open.url} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline inline-flex items-center gap-1 break-all">{open.url} <ExternalLink size={10} /></a></dd></>}
              {open.post_id && <><dt className="text-slate-500">Website post</dt><dd className="text-slate-800">#{open.post_id}</dd></>}
              {open.finished_at && open.publishing_status === 'published' && !open.direct && <><dt className="text-slate-500">Published at</dt><dd className="text-slate-800">{new Date(open.finished_at).toLocaleString('en-GB', { timeZone: open.timezone, dateStyle: 'medium', timeStyle: 'short' })} {tzShort(open.timezone)}</dd></>}
            </dl>
            {open.error && <p className="flex items-start gap-1.5 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800"><XCircle size={13} className="shrink-0 mt-0.5" />{open.error}</p>}
          </div>
        </Modal>
      )}
      {editing && <ScheduleModal b={b} article={editing.article} mode={editing.mode} toast={toast} onClose={() => setEditing(null)} onDone={() => load(true)} />}
    </div>
  );
}
