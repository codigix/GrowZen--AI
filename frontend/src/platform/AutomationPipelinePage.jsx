import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, CheckCircle2, Loader2, Circle, AlertTriangle, Inbox, Plus, Trash2, RefreshCw, Play, ArrowRight, CalendarClock, Save } from 'lucide-react';
import { SeoShell, Card, Tabs, Stat, StatusPill, Badge, Button, Modal, Field, inputCls, areaCls, ErrorNote, useToast, useAction, useBusinesses, useSeoBusiness, refreshBusinesses, useModulePath } from './SeoUi';
import { api, useApi, usePoll, fmtDateTime } from './seoApi';

const STEP_LABEL = {
  extract: 'AI reads the email and extracts the business', profile: 'Client profile created', gbp_match: 'Google Business Profile matched',
  audits: 'GBP, rankings, technical, on-page, backlinks, citations audited', plan: 'Fixes planned as agent tasks', report: 'Audit report written',
  schedule: 'Schedule created for the plan', notify: 'Team and client notified'
};
const STATUS_TONE = { waiting: 'amber', processing: 'blue', done: 'green', needs_info: 'orange', failed: 'red', rejected: 'gray' };
const JOBS = [['full_audit', 'Full audit'], ['rank_scan', 'Rank-grid scan'], ['reviews', 'Reviews + reply drafts'], ['posts', 'GBP post draft'], ['technical', 'Website speed check'], ['report', 'Client report'], ['geo', 'AI visibility check']];
const EVERY = ['daily', 'weekly', 'fortnightly', 'monthly', 'off'];

function Steps({ em }) {
  const got = Object.fromEntries((em.steps || []).map(s => [s.id, s]));
  return (
    <ol className="space-y-1">
      {Object.keys(STEP_LABEL).map(k => {
        const s = got[k];
        const st = s?.status;
        return (
          <li key={k} className={`flex items-start gap-3 p-2 rounded ${st === 'running' ? 'bg-blue-50' : ''}`}>
            {st === 'done' ? <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-px" /> : st === 'running' ? <Loader2 size={16} className="text-blue-600 animate-spin shrink-0 mt-px" /> : st === 'needs_info' ? <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-px" /> : <Circle size={16} className="text-gray-300 shrink-0 mt-px" />}
            <div className="flex-1 min-w-0"><div className={`text-[13px] ${s ? 'text-gray-900' : 'text-gray-400'}`}>{STEP_LABEL[k]}</div>{s?.note && <div className="text-[12px] text-gray-500 mt-0.5 line-clamp-2">{s.note}</div>}</div>
          </li>
        );
      })}
    </ol>
  );
}

function PasteModal({ open, onClose, onSent }) {
  const [mail, setMail] = useState({ from_addr: '', subject: '', body: '' });
  const [busy, error, run] = useAction();
  const send = () => run('send', async () => { const em = await api('/intake/emails', { method: 'POST', body: mail }); setMail({ from_addr: mail.from_addr, subject: '', body: '' }); onSent(em); });
  return (
    <Modal open={open} onClose={onClose} title="Paste an onboarding email" width="max-w-2xl" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={Play} busy={busy === 'send'} disabled={!mail.from_addr || !mail.body.trim()} onClick={send}>Process</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="From (your team's address)"><input className={inputCls} value={mail.from_addr} onChange={e => setMail({ ...mail, from_addr: e.target.value })} placeholder="sales@codigixinfotech.com" /></Field>
          <Field label="Subject"><input className={inputCls} value={mail.subject} onChange={e => setMail({ ...mail, subject: e.target.value })} /></Field>
        </div>
        <Field label="Email text" hint="Any format: a form, a few typed lines, a forwarded chat."><textarea rows={9} className={areaCls} value={mail.body} onChange={e => setMail({ ...mail, body: e.target.value })} placeholder={'Business: Sai Dental Care\nWebsite: https://saidentalcare.in\nPhone: +91 98505 22140\nAddress: ITI Road, Aundh, Pune\nCategory: Dentist\nPackage: Growth'} /></Field>
        <ErrorNote>{error}</ErrorNote>
      </div>
    </Modal>
  );
}

function PipelineTab({ emails, toast }) {
  const [selected, setSelected] = useState(null);
  const [paste, setPaste] = useState(false);
  const [busy, error, run] = useAction();
  const navigate = useNavigate();
  const path = useModulePath();
  const [, setBusiness] = useSeoBusiness();
  const current = useApi(selected ? `/intake/emails/${selected}` : null);
  const em = current.data;
  const active = em && ['waiting', 'processing'].includes(em.status);
  usePoll(() => { current.reload(true); emails.reload(true); }, Boolean(active), 2000);
  useEffect(() => { if (em?.status === 'done') refreshBusinesses(); }, [em?.status]);
  useEffect(() => { if (!selected && emails.data?.length) setSelected(emails.data[0].id); }, [emails.data, selected]);
  const poll = () => run('poll', async () => { const r = await api('/intake/poll', { method: 'POST' }); emails.reload(true); toast(`${r.new} new email${r.new === 1 ? '' : 's'}`); });

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <Card title="Live pipeline" subtitle="From email to scheduled client, with no manual steps" className="xl:col-span-2"
        action={<div className="flex gap-2"><Button icon={RefreshCw} busy={busy === 'poll'} onClick={poll}>Check mailbox</Button><Button variant="primary" icon={Plus} onClick={() => setPaste(true)}>Paste email</Button></div>}>
        <ErrorNote>{error}</ErrorNote>
        {!em ? (
          <div className="py-14 text-center text-[13px] text-gray-500"><Inbox size={28} className="mx-auto mb-2 text-gray-300" />No onboarding emails yet. Forward one to the onboarding mailbox, or paste it here.</div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
              <span className="font-medium text-gray-900">{em.extracted?.name || em.subject || 'Email'}</span>
              <Badge tone={STATUS_TONE[em.status]}>{em.status.replace('_', ' ')}</Badge>
              <span className="text-[12px] text-gray-500">{em.from_addr} · {fmtDateTime(em.received_at)}</span>
            </div>
            <Steps em={em} />
            {em.status === 'needs_info' && <div className="mt-3 p-3 rounded bg-amber-50 border border-amber-200 text-[13px] text-amber-900">Missing: <b>{(em.missing || []).join(', ')}</b>. The sender was asked by email (if SMTP is set up). Reply with the details as a new email, or fix and re-run from the inbox.</div>}
            {em.status === 'failed' && <div className="mt-3 p-3 rounded bg-red-50 border border-red-200 text-[13px] text-red-800">Failed: {em.error}</div>}
            {em.status === 'rejected' && <div className="mt-3 p-3 rounded bg-gray-50 border border-gray-200 text-[13px] text-gray-700">{em.error}</div>}
            {em.status === 'done' && em.business_id && (
              <div className="mt-4 flex flex-wrap items-center gap-3 p-3 rounded border border-emerald-200 bg-emerald-50/50">
                <CheckCircle2 size={18} className="text-emerald-600" />
                <span className="flex-1 text-[13px] text-gray-800">{em.extracted?.name} is audited and scheduled.</span>
                <Button size="sm" onClick={() => { setBusiness(em.business_id); navigate(path('dashboard')); }}>Open overview <ArrowRight size={12} /></Button>
              </div>
            )}
          </>
        )}
      </Card>
      <Card title="Recent emails">
        {!emails.data ? <Loader2 size={16} className="animate-spin text-gray-400" /> : emails.data.length === 0 ? <div className="text-[13px] text-gray-500">None yet.</div> : (
          <div className="divide-y divide-gray-100">
            {emails.data.slice(0, 12).map(e => (
              <button key={e.id} onClick={() => setSelected(e.id)} className={`w-full flex items-center gap-2 py-2 px-1 text-left cursor-pointer ${e.id === selected ? 'bg-blue-50/60' : 'hover:bg-gray-50'}`}>
                <Mail size={13} className="text-gray-400 shrink-0" />
                <span className="flex-1 min-w-0"><span className="block text-[13px] text-gray-900 truncate">{e.extracted?.name || e.subject || '(no subject)'}</span><span className="block text-[11px] text-gray-500">{fmtDateTime(e.received_at)}</span></span>
                <Badge tone={STATUS_TONE[e.status]}>{e.status.replace('_', ' ')}</Badge>
              </button>
            ))}
          </div>
        )}
      </Card>
      <PasteModal open={paste} onClose={() => setPaste(false)} onSent={(e) => { setPaste(false); setSelected(e.id); emails.reload(true); toast(e.status === 'rejected' ? 'Rejected: sender not on the allowed list' : 'Processing…'); }} />
    </div>
  );
}

function InboxTab({ emails, toast }) {
  const [open, setOpen] = useState(null);
  const detail = useApi(open ? `/intake/emails/${open}` : null);
  const [busy, error, run] = useAction();
  const reprocess = () => run('re', async () => { await api(`/intake/emails/${open}/process`, { method: 'POST' }); emails.reload(true); toast('Re-running the pipeline'); setOpen(null); });
  const d = detail.data;
  return (
    <Card title="Onboarding inbox" subtitle="Every email received (mailbox, webhook or pasted)">
      {!emails.data ? <Loader2 size={16} className="animate-spin text-gray-400" /> : emails.data.length === 0 ? <div className="py-8 text-center text-[13px] text-gray-500">No emails yet.</div> : (
        <div className="divide-y divide-gray-100">
          {emails.data.map(e => (
            <button key={e.id} onClick={() => setOpen(e.id)} className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-gray-50 px-1 cursor-pointer">
              <Mail size={15} className="text-gray-400 shrink-0" />
              <div className="flex-1 min-w-0"><div className="text-[13px] text-gray-900 truncate">{e.subject || '(no subject)'}</div><div className="text-[12px] text-gray-500 truncate">{e.from_addr} · {fmtDateTime(e.received_at)}</div></div>
              {(e.missing || []).length > 0 && <StatusPill level="warning">Missing {e.missing.join(', ')}</StatusPill>}
              <Badge tone={STATUS_TONE[e.status]}>{e.status.replace('_', ' ')}</Badge>
            </button>
          ))}
        </div>
      )}
      <Modal open={Boolean(open)} title={d?.subject || 'Email'} onClose={() => setOpen(null)} width="max-w-3xl"
        footer={<>{d && !['processing', 'rejected'].includes(d.status) && <Button icon={Play} busy={busy === 're'} onClick={reprocess}>Run pipeline again</Button>}<Button onClick={() => setOpen(null)}>Close</Button></>}>
        {!d ? <Loader2 size={16} className="animate-spin text-gray-400" /> : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><div className="text-[12px] text-gray-500 mb-1">Email</div><pre className="whitespace-pre-wrap text-[12px] text-gray-800 bg-gray-50 border border-gray-200 rounded p-3 font-sans max-h-80 overflow-auto">{d.body}</pre></div>
            <div>
              <div className="text-[12px] text-gray-500 mb-1">Extracted</div>
              {Object.keys(d.extracted || {}).length === 0 ? <div className="text-[13px] text-gray-500">Not processed yet.</div> : (
                <div className="space-y-1.5 text-[13px]">{Object.entries(d.extracted).map(([k, v]) => <div key={k} className="flex gap-2"><span className="w-28 text-gray-500 shrink-0 text-[12px]">{k.replace('_', ' ')}</span><span className="text-gray-900 break-words">{Array.isArray(v) ? v.join(', ') : String(v)}</span></div>)}</div>
              )}
              {(d.missing || []).length > 0 && <div className="mt-2 text-[12px] text-amber-800">Missing: {d.missing.join(', ')}</div>}
              {d.error && <div className="mt-2 text-[12px] text-red-700">{d.error}</div>}
            </div>
          </div>
        )}
        <ErrorNote>{error}</ErrorNote>
      </Modal>
    </Card>
  );
}

function ScheduleModal({ business, onClose, toast }) {
  const sch = useApi(business ? `/businesses/${business.id}/schedules` : null);
  const [busy, error, run] = useAction();
  const setJob = (job, every) => run(job, async () => { const out = await api(`/businesses/${business.id}/schedules`, { method: 'PUT', body: { job, every } }); sch.setData(list => list.map(s => s.job === job ? out : s)); toast('Schedule saved'); });
  return (
    <Modal open={Boolean(business)} title={business ? `${business.name}: automatic schedule` : ''} onClose={onClose} width="max-w-xl" footer={<Button onClick={onClose}>Close</Button>}>
      {!sch.data ? <Loader2 size={16} className="animate-spin text-gray-400" /> : (
        <div className="divide-y divide-gray-100">
          {JOBS.map(([job, label]) => {
            const s = sch.data.find(x => x.job === job);
            return (
              <div key={job} className="flex items-center gap-2 py-2 text-[13px]">
                <span className="flex-1 text-gray-800">{label}{s?.last_status === 'failed' && <span className="ml-2 text-[11px] text-red-600" title={s.last_error}>last run failed</span>}</span>
                <select className="h-7 px-1.5 text-xs border border-gray-300 rounded bg-white" disabled={busy === job} value={s?.every || 'off'} onChange={e => setJob(job, e.target.value)}>{EVERY.map(f => <option key={f} value={f}>{f}</option>)}</select>
                <span className="w-32 text-right text-[12px] text-gray-500">{s?.next_run_at ? `next ${fmtDateTime(s.next_run_at)}` : 'off'}</span>
              </div>
            );
          })}
        </div>
      )}
      <ErrorNote>{error}</ErrorNote>
    </Modal>
  );
}

function ProfilesTab({ toast }) {
  const rows = useApi('/businesses');
  const [open, setOpen] = useState(null);
  const { list } = useBusinesses();
  return (
    <Card title={`Client profiles (${rows.data?.length ?? '…'})`} subtitle="Each profile runs on its own schedule">
      {!rows.data ? <Loader2 size={16} className="animate-spin text-gray-400" /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-[12px] text-gray-500 border-b border-gray-200"><tr><th className="p-2 text-left font-medium">Business</th><th className="p-2 text-left font-medium">Plan</th><th className="p-2 text-left font-medium">Source</th><th className="p-2 text-right font-medium">Score</th><th className="p-2 text-left font-medium">Status</th><th className="p-2 text-right font-medium">Waiting tasks</th><th className="p-2 text-left font-medium">Next job</th><th className="p-2" /></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {rows.data.map(b => (
                <tr key={b.id}>
                  <td className="p-2"><div className="text-gray-900">{b.name}</div><div className="text-[12px] text-gray-500">{[b.primary_category, b.area || b.city].filter(Boolean).join(' · ')}</div></td>
                  <td className="p-2">{b.plan ? <Badge tone="blue">{b.plan}</Badge> : '—'}</td>
                  <td className="p-2 text-gray-600">{b.source}</td>
                  <td className="p-2 text-right tabular-nums font-medium">{b.last_audit_score ?? '—'}</td>
                  <td className="p-2">{b.status === 'active' ? <StatusPill level="good">On autopilot</StatusPill> : b.status === 'paused' ? <Badge>Paused</Badge> : <StatusPill level="warning">Needs approval</StatusPill>}</td>
                  <td className="p-2 text-right tabular-nums">{b.pending_tasks}</td>
                  <td className="p-2 text-gray-600">{b.next_run_at ? fmtDateTime(b.next_run_at) : '—'}</td>
                  <td className="p-2 text-right"><Button size="sm" icon={CalendarClock} onClick={() => setOpen(list?.find(x => x.id === b.id) || b)}>Schedule</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ScheduleModal business={open} onClose={() => { setOpen(null); rows.reload(true); }} toast={toast} />
    </Card>
  );
}

function PlaybookTab({ toast }) {
  const pb = useApi('/playbook');
  const [draft, setDraft] = useState(null);
  const [newStep, setNewStep] = useState('');
  const [busy, error, run] = useAction();
  useEffect(() => { if (pb.data && !draft) setDraft({ steps: pb.data.steps || [], tone: pb.data.tone || '', languages: pb.data.languages || '', plan_schedules: pb.data.plan_schedules || {} }); }, [pb.data, draft]);
  if (!draft) return <Loader2 size={16} className="animate-spin text-gray-400" />;
  const save = () => run('save', async () => { const out = await api('/playbook', { method: 'PUT', body: draft }); pb.setData(out); toast('Playbook saved: applies to the next runs'); });
  const plans = Object.keys(draft.plan_schedules);
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <Card title="Standard process the AI follows" subtitle="Your SOP, in order" className="xl:col-span-2" action={<Button variant="primary" icon={Save} busy={busy === 'save'} onClick={save}>Save</Button>}>
        <ol className="space-y-1.5">
          {draft.steps.map((s, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-gray-900 text-white text-[11px] flex items-center justify-center shrink-0">{i + 1}</span>
              <input className={inputCls} value={s} onChange={e => setDraft(d => ({ ...d, steps: d.steps.map((x, j) => j === i ? e.target.value : x) }))} />
              <button onClick={() => setDraft(d => ({ ...d, steps: d.steps.filter((_, j) => j !== i) }))} className="text-gray-400 hover:text-red-600 cursor-pointer" aria-label="Remove step"><Trash2 size={14} /></button>
            </li>
          ))}
        </ol>
        <div className="mt-2 flex gap-2"><input className={inputCls} placeholder="Add a step" value={newStep} onChange={e => setNewStep(e.target.value)} /><Button icon={Plus} disabled={!newStep.trim()} onClick={() => { setDraft(d => ({ ...d, steps: [...d.steps, newStep.trim()] })); setNewStep(''); }}>Add</Button></div>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Writing tone"><textarea rows={3} className={areaCls} value={draft.tone} onChange={e => setDraft({ ...draft, tone: e.target.value })} /></Field>
          <Field label="Languages"><textarea rows={3} className={areaCls} value={draft.languages} onChange={e => setDraft({ ...draft, languages: e.target.value })} /></Field>
        </div>
        <ErrorNote>{error}</ErrorNote>
      </Card>
      <Card title="Schedules per plan" subtitle="Used when a new client is onboarded">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="text-gray-500 border-b border-gray-200"><tr><th className="p-1.5 text-left font-medium">Job</th>{plans.map(p => <th key={p} className="p-1.5 text-left font-medium">{p}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-100">
              {JOBS.map(([job, label]) => (
                <tr key={job}><td className="p-1.5 text-gray-800">{label}</td>{plans.map(p => (
                  <td key={p} className="p-1.5"><select className="h-6 px-1 text-[11px] border border-gray-300 rounded bg-white" value={draft.plan_schedules[p]?.[job] || 'off'} onChange={e => setDraft(d => ({ ...d, plan_schedules: { ...d.plan_schedules, [p]: { ...d.plan_schedules[p], [job]: e.target.value } } }))}>{EVERY.map(f => <option key={f} value={f}>{f}</option>)}</select></td>
                ))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Pipeline({ tab }) {
  const emails = useApi('/intake/emails');
  const [toast, toastNode] = useToast();
  const { list } = useBusinesses();
  const data = emails.data || [];
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="Client profiles" value={list?.length ?? '—'} />
        <Stat label="Emails waiting / running" value={data.filter(e => ['waiting', 'processing'].includes(e.status)).length} />
        <Stat label="Need details" value={data.filter(e => e.status === 'needs_info').length} />
        <Stat label="Failed" value={data.filter(e => e.status === 'failed').length} hint={data.some(e => e.status === 'failed') ? 'open the inbox to re-run' : ''} />
      </div>
      {tab === 'pipeline' && <PipelineTab emails={emails} toast={toast} />}
      {tab === 'inbox' && <InboxTab emails={emails} toast={toast} />}
      {tab === 'profiles' && <ProfilesTab toast={toast} />}
      {tab === 'playbook' && <PlaybookTab toast={toast} />}
      {toastNode}
    </>
  );
}

export default function AutomationPipelinePage() {
  const [tab, setTab] = useState('pipeline');
  return (
    <SeoShell hideSwitcher needsBusiness={false} title="Automation pipeline" subtitle="Onboarding emails in, audited and scheduled client profiles out. The AI runs every step on its own.">
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'pipeline', label: 'Live pipeline' }, { id: 'inbox', label: 'Onboarding inbox' }, { id: 'profiles', label: 'Profiles & schedule' }, { id: 'playbook', label: 'AI playbook' }]} />
      <Pipeline tab={tab} />
    </SeoShell>
  );
}

