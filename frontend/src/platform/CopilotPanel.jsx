import React, { useState } from 'react';
import { Sparkles, RefreshCw, AlertTriangle, ArrowRight, Download, Loader2, Siren, Lightbulb } from 'lucide-react';
import { Card, Button, Modal, ErrorNote, useAction, useToast } from './SeoUi';
import { api, useApi, fmtDateTime } from './seoApi';

/**
 * The AI copilot on the dashboard: today's priorities across every client, alerts with their likely
 * cause and next step, and every client's monthly report in one go. Rule-based until an AI key is set.
 */

// Where each kind of priority or alert is handled.
const SCREEN = {
  approvals: ['automation', 'Review drafts'], audit: ['website-audit?tab=report', 'Open audit'], reviews: ['reviews', 'Open reviews'],
  gbp: ['gmb-profile', 'Open profile'], link_google: ['gmb-profile', 'Find on Google'], rank: ['rank-tracking', 'Open rankings'],
  insights: ['reports', 'Open insights'], jobs: ['automation-pipeline', 'Open jobs']
};
const LEVEL = {
  critical: 'bg-red-50 text-red-700 ring-red-200', serious: 'bg-orange-50 text-orange-700 ring-orange-200', warning: 'bg-amber-50 text-amber-700 ring-amber-200'
};
const screen = (action) => SCREEN[action] || SCREEN.audit;

function SourceBadge({ source }) {
  return source === 'ai'
    ? <span className="inline-flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200"><Sparkles size={10} /> AI</span>
    : <span className="text-[10.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200">Rules</span>;
}

export function ReportsModal({ open, onClose }) {
  const [res, setRes] = useState(null);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const draft = () => run('draft', async () => setRes(await api('/copilot/reports', { method: 'POST' })));
  const download = (r) => run(`pdf${r.business_id}`, async () => {
    const res = await api(r.pdf, { raw: true });
    const href = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href, download: `${r.business}-${r.month}.pdf` }).click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    toast(`${r.business} report downloaded`);
  });
  return (
    <Modal open={open} onClose={onClose} width="max-w-3xl" title="Monthly reports for every client">
      {!res ? (
        <div className="py-4">
          <p className="text-[13px] text-slate-600">Writes this month's plain-words summary for each active client from their calls, directions, reviews, leads, scores and rankings, ready to send as a PDF.</p>
          <Button className="mt-4" variant="primary" icon={Sparkles} busy={busy === 'draft'} onClick={draft}>Draft all reports</Button>
        </div>
      ) : (
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          <div className="text-[12px] text-slate-500 flex items-center gap-2"><SourceBadge source={res.ai ? 'ai' : 'rules'} /> {res.reports.length} report{res.reports.length === 1 ? '' : 's'} for {res.reports[0]?.month || 'this month'}</div>
          {res.reports.map(r => (
            <div key={r.business_id} className="rounded-xl ring-1 ring-inset ring-slate-200 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-[13.5px] font-semibold text-slate-900">{r.business}</div>
                <div className="flex items-center gap-3 text-[12px] text-slate-500"><span>{r.calls} calls <span className="text-slate-400">(was {r.previous_calls})</span></span>{r.overall != null && <span>Score {r.overall}</span>}
                  <Button size="sm" icon={Download} busy={busy === `pdf${r.business_id}`} onClick={() => download(r)}>PDF</Button></div>
              </div>
              <p className="mt-1.5 text-[12.5px] text-slate-700 leading-relaxed">{r.summary}</p>
            </div>
          ))}
        </div>
      )}
      <ErrorNote>{error}</ErrorNote>
      {toastNode}
    </Modal>
  );
}

/** Today's top priorities across every client, each with a button to the screen that handles it. */
export function CopilotPriorities({ onOpenProject }) {
  const brief = useApi('/copilot/briefing');
  const [busy, error, run] = useAction();
  const regenerate = () => run('brief', async () => brief.setData(await api('/copilot/briefing?refresh=true')));
  return (
    <Card title={<span className="inline-flex items-center gap-2"><Lightbulb size={15} className="text-violet-600" /> Today's priorities {brief.data && <SourceBadge source={brief.data.source} />}</span>}
      subtitle={brief.data ? brief.data.headline : 'Planning…'}
      action={<Button size="sm" variant="ghost" icon={RefreshCw} busy={busy === 'brief'} onClick={regenerate}>Re-plan</Button>}>
      <ErrorNote>{error || brief.error?.message}</ErrorNote>
      {!brief.data ? <div className="py-6 flex justify-center text-slate-400"><Loader2 size={16} className="animate-spin" /></div>
        : !brief.data.priorities.length ? <div className="py-6 text-center text-[13px] text-slate-500">Nothing urgent today. Every client is on track.</div> : (
          <ol className="space-y-2">
            {brief.data.priorities.map((p, i) => (
              <li key={`${p.business_id}-${i}`} className="flex flex-wrap sm:flex-nowrap items-start gap-3 rounded-xl ring-1 ring-inset ring-slate-200 px-3.5 py-2.5">
                <span className="w-6 h-6 rounded-full bg-violet-600 text-white text-[12px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-slate-900">{p.title}</div>
                  <div className="text-[12px] text-slate-500"><span className="font-medium text-slate-700">{p.business}</span> · {p.why}</div>
                </div>
                <Button size="sm" icon={ArrowRight} onClick={() => onOpenProject(p.business_id, screen(p.action)[0])}>{screen(p.action)[1]}</Button>
              </li>
            ))}
          </ol>
        )}
      {brief.data && <div className="mt-2 text-[11px] text-slate-400">Planned {fmtDateTime(brief.data.generated_at)} · refreshed daily</div>}
    </Card>
  );
}

/** Problems worth acting on this week, with the likely cause and the next step. */
export function CopilotAlerts({ onOpenProject }) {
  const alerts = useApi('/copilot/alerts');
  const list = alerts.data?.alerts || [];
  return (
    <Card title={<span className="inline-flex items-center gap-2"><Siren size={15} className="text-red-600" /> Alerts {alerts.data && <SourceBadge source={alerts.data.source} />}</span>}
      subtitle={alerts.data ? (list.length ? `${list.length} to look at this week` : 'Nothing unusual this week') : 'Checking…'}>
      <ErrorNote>{alerts.error?.message}</ErrorNote>
      {!alerts.data ? <div className="py-6 flex justify-center text-slate-400"><Loader2 size={16} className="animate-spin" /></div>
        : !list.length ? <div className="py-4 text-center text-[12.5px] text-slate-500">No drops in calls, rankings or scores, no unanswered bad reviews, no listing problems.</div> : (
          <ul className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
            {list.map(a => (
              <li key={a.id}>
                <button type="button" onClick={() => onOpenProject(a.business_id, screen(a.action)[0])} className="w-full text-left rounded-xl ring-1 ring-inset ring-slate-200 hover:ring-indigo-300 hover:bg-slate-50 px-3 py-2.5 cursor-pointer">
                  <div className="flex items-start gap-2">
                    <span className={`mt-0.5 text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded ring-1 ring-inset shrink-0 ${LEVEL[a.level]}`}>{a.level}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] font-semibold text-slate-900">{a.title}</div>
                      <div className="text-[11.5px] text-slate-500"><span className="font-medium text-slate-700">{a.business}</span> · {a.why}</div>
                      <div className="mt-0.5 text-[11.5px] text-indigo-800 flex items-start gap-1"><AlertTriangle size={11} className="mt-0.5 shrink-0 text-indigo-500" /> {a.next}</div>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
    </Card>
  );
}
