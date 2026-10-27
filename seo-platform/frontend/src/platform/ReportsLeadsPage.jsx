import React, { useState } from 'react';
import { Download, Phone, MessageCircle, FileText, Navigation, CalendarCheck, Plus, Loader2 } from 'lucide-react';
import { SeoShell, Card, Tabs, Stat, Badge, Button, Modal, Field, inputCls, ErrorNote, StatusPill, useToast, useAction } from './SeoUi';
import { api, useApi, fmtDate } from './seoApi';

const TYPE_ICON = { call: Phone, whatsapp: MessageCircle, form: FileText, direction: Navigation, booking: CalendarCheck, other: FileText };
const STATUS_TONE = { new: 'blue', contacted: 'amber', won: 'green', lost: 'gray' };
const change = (a, b) => (b ? Math.round(((a - b) / b) * 100) : 0);
const thisMonth = () => new Date().toISOString().slice(0, 7);

function Reports({ b, tab }) {
  const [month, setMonth] = useState(thisMonth());
  const rep = useApi(`/businesses/${b.id}/report?month=${month}`);
  const leads = useApi(`/businesses/${b.id}/leads`);
  const [adding, setAdding] = useState(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();

  const pdf = () => run('pdf', async () => {
    const r = await api(`/businesses/${b.id}/report.pdf?month=${month}`, { raw: true });
    const blob = await r.blob();
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${b.name}-${month}.pdf`; a.click(); URL.revokeObjectURL(a.href);
    toast('Report PDF downloaded');
  });
  const addLead = () => run('add', async () => { await api(`/businesses/${b.id}/leads`, { method: 'POST', body: adding }); setAdding(null); leads.reload(true); toast('Lead added'); });
  const setStatus = (l, status) => run(`s${l.id}`, async () => { const out = await api(`/businesses/${b.id}/leads/${l.id}?status=${status}`, { method: 'PATCH' }); leads.setData(list => list.map(x => x.id === l.id ? out : x)); });
  const shown = (leads.data || []).filter(l => typeFilter === 'all' || l.lead_type === typeFilter);
  const s = rep.data;

  return (
    <>
      {tab === 'report' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <label className="text-[13px] text-gray-600 flex items-center gap-2">Month <input type="month" className={`${inputCls} w-40`} value={month} max={thisMonth()} onChange={e => e.target.value && setMonth(e.target.value)} /></label>
            <Button variant="primary" icon={Download} busy={busy === 'pdf'} onClick={pdf}>Download PDF report</Button>
          </div>
          <ErrorNote>{error || rep.error?.message}</ErrorNote>
          {!s ? <div className="py-16 flex justify-center text-gray-400"><Loader2 size={16} className="animate-spin" /></div> : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4 mt-2">
                <Stat icon={Phone} label="Calls" value={s.insights.calls} delta={change(s.insights.calls, s.previous.calls)} hint="vs last month" />
                <Stat icon={Navigation} label="Directions" value={s.insights.directions} delta={change(s.insights.directions, s.previous.directions)} />
                <Stat label="Website clicks" value={s.insights.website_clicks} delta={change(s.insights.website_clicks, s.previous.website_clicks)} />
                <Stat label="Profile views" value={s.insights.views.toLocaleString('en-IN')} delta={change(s.insights.views, s.previous.views)} />
                <Stat label="Leads" value={s.leads} hint={`${s.new_reviews} new reviews`} />
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <Card title="In plain words" subtitle="Written by the Reporter agent" className="xl:col-span-2">
                  <p className="text-[13px] text-gray-700 leading-relaxed whitespace-pre-line">{s.plain_words}</p>
                  <div className="mt-4 text-[13px] font-medium text-gray-900">Next steps</div>
                  {s.top_fixes.length === 0 ? <div className="text-[12px] text-gray-500 mt-1">Run an audit to get next steps.</div> : (
                    <ul className="mt-1 space-y-1.5">{s.top_fixes.map((f, i) => <li key={i} className="flex gap-2 text-[13px]"><StatusPill level={f.level || 'info'}>{f.area}</StatusPill><span className="text-gray-800">{f.title}</span></li>)}</ul>
                  )}
                </Card>
                <Card title="Scores">
                  <div className="text-3xl font-semibold text-gray-900">{s.overall ?? '—'}<span className="text-sm text-gray-500 font-normal">/100 overall</span></div>
                  <div className="mt-3 space-y-1.5 text-[13px]">{Object.entries(s.scores).map(([k, v]) => <div key={k} className="flex justify-between"><span className="text-gray-600 capitalize">{k}</span><span className="tabular-nums">{v ?? '—'}</span></div>)}</div>
                  {s.keywords.length > 0 && <><div className="mt-4 text-[12px] text-gray-500">Keyword positions</div><div className="mt-1 space-y-1 text-[12px]">{s.keywords.map(k => <div key={k.keyword} className="flex justify-between"><span className="truncate">{k.keyword}</span><span className="tabular-nums">#{k.rank}</span></div>)}</div></>}
                </Card>
              </div>
            </>
          )}
        </>
      )}

      {tab === 'leads' && (
        <Card title={`Leads (${shown.length})`} action={<Button size="sm" variant="primary" icon={Plus} onClick={() => setAdding({ lead_type: 'call', name: '', contact: '', message: '', source: 'Google Business Profile' })}>Add lead</Button>}>
          <div className="flex flex-wrap gap-1 mb-3">{['all', 'call', 'whatsapp', 'form', 'direction', 'booking'].map(t => <button key={t} onClick={() => setTypeFilter(t)} className={`h-7 px-2.5 text-xs rounded border capitalize cursor-pointer ${typeFilter === t ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-300 text-gray-700'}`}>{t}</button>)}</div>
          <ErrorNote>{error}</ErrorNote>
          {!leads.data ? <div className="py-8 flex justify-center text-gray-400"><Loader2 size={16} className="animate-spin" /></div> : shown.length === 0 ? <div className="py-8 text-center text-[13px] text-gray-500">No leads yet.</div> : (
            <div className="divide-y divide-gray-100">
              {shown.map(l => { const I = TYPE_ICON[l.lead_type] || Phone; return (
                <div key={l.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="w-7 h-7 rounded bg-gray-100 text-gray-600 flex items-center justify-center shrink-0"><I size={13} /></span>
                  <div className="flex-1 min-w-[200px]"><div className="text-[13px] text-gray-900">{l.name || 'Unknown'} <span className="text-gray-400 text-[12px]">· {l.contact || '—'}</span></div><div className="text-[12px] text-gray-500">{l.message || '—'} · {l.source} · {fmtDate(l.lead_date)}</div></div>
                  <select className="h-7 px-1.5 text-xs border border-gray-300 rounded bg-white" value={l.status} onChange={e => setStatus(l, e.target.value)} aria-label="Lead status">{['new', 'contacted', 'won', 'lost'].map(x => <option key={x} value={x}>{x}</option>)}</select>
                  <Badge tone={STATUS_TONE[l.status]}>{l.status}</Badge>
                </div>
              ); })}
            </div>
          )}
        </Card>
      )}

      <Modal open={Boolean(adding)} title="Add lead" onClose={() => setAdding(null)} footer={<><Button onClick={() => setAdding(null)}>Cancel</Button><Button variant="primary" busy={busy === 'add'} onClick={addLead}>Add</Button></>}>
        {adding && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type"><select className={inputCls} value={adding.lead_type} onChange={e => setAdding({ ...adding, lead_type: e.target.value })}>{Object.keys(TYPE_ICON).map(t => <option key={t} value={t}>{t}</option>)}</select></Field>
            <Field label="Source"><select className={inputCls} value={adding.source} onChange={e => setAdding({ ...adding, source: e.target.value })}>{['Google Business Profile', 'Website', 'Google Ads', 'WhatsApp'].map(t => <option key={t}>{t}</option>)}</select></Field>
            <Field label="Name"><input className={inputCls} value={adding.name} onChange={e => setAdding({ ...adding, name: e.target.value })} /></Field>
            <Field label="Phone / email"><input className={inputCls} value={adding.contact} onChange={e => setAdding({ ...adding, contact: e.target.value })} /></Field>
            <div className="col-span-2"><Field label="Note"><input className={inputCls} value={adding.message} onChange={e => setAdding({ ...adding, message: e.target.value })} /></Field></div>
          </div>
        )}
      </Modal>
      {toastNode}
    </>
  );
}

export default function ReportsLeadsPage() {
  const [tab, setTab] = useState('report');
  return (
    <SeoShell title="Reports & leads" subtitle="Calls, directions, clicks and leads in one place, plus the monthly PDF">
      {(b) => (
        <>
          <Tabs value={tab} onChange={setTab} tabs={[{ id: 'report', label: 'Monthly report' }, { id: 'leads', label: 'Leads' }]} />
          <Reports key={b.id} b={b} tab={tab} />
        </>
      )}
    </SeoShell>
  );
}
