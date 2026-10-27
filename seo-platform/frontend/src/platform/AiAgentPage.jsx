import React, { useState } from 'react';
import { Sparkles, Check, X, Bot, ShieldCheck, Loader2 } from 'lucide-react';
import { SeoShell, Card, Tabs, Stat, StatusPill, Badge, Button, ErrorNote, areaCls, useToast, useAction, useBusinesses } from './SeoUi';
import { api, useApi, fmtDateTime } from './seoApi';

const AGENTS = [
  ['Planner', 'Turns every audit into tasks, ranked by expected impact'],
  ['GBP agent', 'Posts and profile changes (written to Google after approval)'],
  ['Review agent', 'Drafts replies to every new review'],
  ['Content agent', 'Drafts posts and pages from the profile'],
  ['Audit agent', 'Finds and explains website issues'],
  ['Outreach agent', 'Finds link and citation targets; drafts emails a person sends'],
  ['Reporter', 'Monthly summary in plain words']
];
const RULES = [
  ['review_reply_high', 'Review replies (4–5★)'], ['review_reply_low', 'Review replies (1–3★)'], ['gbp_post', 'GBP posts'],
  ['profile_edit', 'Profile edits (name, category, address)'], ['website_fix', 'Website fixes'], ['blog_draft', 'Blog drafts'], ['outreach_email', 'Outreach emails']
];

function TaskCard({ t, businessName, onDone }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, error, run] = useAction();
  const decide = (approve) => run(approve ? 'a' : 'r', async () => {
    const out = await api(`/tasks/${t.id}/${approve ? 'approve' : 'reject'}`, { method: 'POST', body: approve ? undefined : { note: note || null } });
    onDone(out, approve);
  });
  return (
    <div className="border border-gray-200 rounded p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-7 h-7 rounded bg-violet-50 text-violet-700 flex items-center justify-center"><Sparkles size={14} /></span>
        <span className="text-[13px] font-medium text-gray-900 flex-1 min-w-[200px]">{t.title}</span>
        <Badge tone="gray">{t.kind.replace('_', ' ')}</Badge>
        <StatusPill level={t.impact === 'High' ? 'good' : 'info'}>{t.impact} impact</StatusPill>
      </div>
      <div className="text-[12px] text-gray-500 mt-1 ml-9">{businessName} · {t.agent} agent · {fmtDateTime(t.created_at)}</div>
      {(t.detail?.text || t.detail?.body || t.detail?.fix) && <div className="ml-9 mt-2 text-[12px] p-2 rounded bg-emerald-50/60 border border-emerald-100 whitespace-pre-line text-gray-800">{t.detail.text || t.detail.body || t.detail.fix}</div>}
      {rejecting && <div className="ml-9 mt-2"><textarea rows={2} className={areaCls} placeholder="Why? (the AI learns from this)" value={note} onChange={e => setNote(e.target.value)} /></div>}
      <div className="ml-9 mt-2 flex gap-1.5">
        {!rejecting ? (
          <>
            <Button size="sm" variant="primary" icon={Check} busy={busy === 'a'} onClick={() => decide(true)}>Approve</Button>
            <Button size="sm" variant="danger" icon={X} onClick={() => setRejecting(true)}>Reject</Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="danger" busy={busy === 'r'} onClick={() => decide(false)}>Reject task</Button>
            <Button size="sm" onClick={() => setRejecting(false)}>Cancel</Button>
          </>
        )}
      </div>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}

function Agent({ tab }) {
  const { list } = useBusinesses();
  const tasks = useApi('/tasks?status=pending');
  const done = useApi('/tasks?status=applied');
  const activity = useApi(tab === 'log' ? '/activity?limit=200' : null);
  const playbook = useApi('/playbook');
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const nameOf = (id) => list?.find(b => b.id === id)?.name || `Business #${id}`;
  const finished = (out, approve) => {
    tasks.setData(ts => ts.filter(x => x.id !== out.id));
    done.reload(true);
    toast(approve ? (out.status === 'applied' ? `Applied: ${out.result?.note || 'done'}` : `Failed: ${out.result?.error || ''}`) : 'Rejected');
  };
  const setRule = (key, value) => run(key, async () => {
    const rules = { ...(playbook.data?.approval_rules || {}), [key]: value };
    const out = await api('/playbook', { method: 'PUT', body: { approval_rules: rules } });
    playbook.setData(out);
  });

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="Waiting for approval" value={tasks.data?.length ?? '—'} />
        <Stat label="Applied" value={done.data?.length ?? '—'} hint="last 300" />
        <Stat label="On autopilot" value={playbook.data ? Object.values(playbook.data.approval_rules || {}).filter(v => v === false).length : '—'} hint={`of ${RULES.length} task kinds`} />
        <Stat label="Businesses" value={list?.length ?? '—'} />
      </div>

      {tab === 'queue' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card title="Approval queue" subtitle="Nothing goes live on Google or the website until approved" className="xl:col-span-2">
            {!tasks.data ? <div className="py-8 flex justify-center text-gray-400"><Loader2 size={16} className="animate-spin" /></div> : tasks.data.length === 0 ? <div className="py-10 text-center text-[13px] text-gray-500">Nothing waiting. New tasks appear after audits, review syncs and weekly post drafts.</div> : (
              <div className="space-y-3">{tasks.data.map(t => <TaskCard key={t.id} t={t} businessName={nameOf(t.business_id)} onDone={finished} />)}</div>
            )}
          </Card>
          <Card title="Autopilot" subtitle="Ticked = the agent applies it without asking">
            {!playbook.data ? <Loader2 size={16} className="animate-spin text-gray-400" /> : (
              <div className="space-y-2">
                {RULES.map(([k, l]) => {
                  const locked = k === 'profile_edit';
                  const auto = playbook.data.approval_rules?.[k] === false;
                  return (
                    <label key={k} className={`flex items-center justify-between text-[13px] ${locked ? 'opacity-60' : 'cursor-pointer'}`}>
                      <span className="text-gray-800">{l}</span>
                      <input type="checkbox" disabled={locked || busy === k} checked={auto} onChange={e => setRule(k, !e.target.checked)} />
                    </label>
                  );
                })}
              </div>
            )}
            <ErrorNote>{error}</ErrorNote>
            <p className="text-[11px] text-gray-500 mt-3"><ShieldCheck size={11} className="inline" /> Profile edits always need approval.</p>
          </Card>
        </div>
      )}

      {tab === 'agents' && (
        <Card title="Agents" subtitle="A planner reads every module; narrow workers each do one job">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {AGENTS.map(([n, job]) => <div key={n} className="p-3 rounded border border-gray-200"><div className="flex items-center gap-2"><span className="w-7 h-7 rounded bg-gray-900 text-white flex items-center justify-center"><Bot size={14} /></span><span className="text-[13px] font-semibold text-gray-900">{n}</span></div><p className="text-[12px] text-gray-700 mt-2">{job}</p></div>)}
          </div>
          {playbook.data?.learnt?.length > 0 && (
            <div className="mt-4"><div className="text-[13px] font-medium text-gray-900 mb-1">Learnt from your rejections</div>
              <div className="space-y-1.5">{playbook.data.learnt.slice(0, 10).map((l, i) => <div key={i} className="text-[12px]"><span className="text-gray-500">{l.by}: </span><span className="text-gray-800">{l.task}</span><span className="text-violet-700"> → {l.note}</span></div>)}</div>
            </div>
          )}
        </Card>
      )}

      {tab === 'log' && (
        <Card title="Activity log" subtitle="Everything people and agents did">
          {!activity.data ? <div className="py-8 flex justify-center text-gray-400"><Loader2 size={16} className="animate-spin" /></div> : activity.data.length === 0 ? <div className="py-8 text-center text-[13px] text-gray-500">No activity yet.</div> : (
            <div className="divide-y divide-gray-100">
              {activity.data.map(a => (
                <div key={a.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="w-32 text-[12px] text-gray-500">{fmtDateTime(a.created_at)}</span>
                  <Badge tone={/agent|pipeline|scheduler|autopilot|reporter/.test(a.actor) ? 'violet' : 'blue'}>{a.actor}</Badge>
                  <span className="text-[13px] text-gray-800">{a.action.replace(/_/g, ' ')}</span>
                  <span className="text-[12px] text-gray-500 truncate">{a.business_id ? nameOf(a.business_id) : ''} {a.detail?.title || a.detail?.email || ''}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
      {toastNode}
    </>
  );
}

export default function AiAgentPage() {
  const [tab, setTab] = useState('queue');
  return (
    <SeoShell title="AI agent" subtitle="It plans the tasks, drafts every change and asks you to approve" hideSwitcher needsBusiness={false}>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'queue', label: 'Approval queue' }, { id: 'agents', label: 'Agents' }, { id: 'log', label: 'Activity log' }]} />
      <Agent tab={tab} />
    </SeoShell>
  );
}
