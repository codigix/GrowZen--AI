import React from 'react';
import { Link } from 'react-router-dom';
import { Play, Loader2, FilePlus2, Pencil, FileX2 } from 'lucide-react';
import { SeoShell, Card, Badge, Button, ErrorNote, useAction, useToast } from './SeoUi';
import { api, useApi, usePoll, fmtDate, fmtDateTime } from './seoApi';

const KIND = {
  new_page: { label: 'New page', tone: 'green', icon: FilePlus2 },
  changed: { label: 'Changed', tone: 'amber', icon: Pencil },
  removed: { label: 'Removed', tone: 'red', icon: FileX2 }
};
const FIELD = { title: 'title', h1: 'heading', snippet: 'description', content: 'text' };

const Report = ({ r, compact }) => (
  <div>
    <div className="flex flex-wrap items-center gap-2 mb-1">
      <span className="text-[15px] font-semibold text-gray-900">{r.headline}</span>
      <Badge tone={r.source === 'ai' ? 'blue' : 'gray'}>{r.source === 'ai' ? 'Written by AI' : 'Rule-based'}</Badge>
      {r.baseline && <Badge tone="gray">First visit</Badge>}
    </div>
    <div className="text-12 text-gray-500 mb-2">Week of {fmtDate(r.week_start)} · {r.events} change{r.events === 1 ? '' : 's'}</div>
    <p className="text-13 text-gray-800">{r.summary}</p>
    {!compact && (
      <>
        <p className="text-13 text-gray-700 mt-2"><b>What it means for you:</b> {r.what_it_means}</p>
        {r.actions?.length > 0 && <ul className="list-disc pl-5 mt-2 text-13 text-gray-700 space-y-1">{r.actions.map((a, i) => <li key={i}>{a}</li>)}</ul>}
      </>
    )}
  </div>
);

function Body({ b }) {
  const base = `/businesses/${b.id}/competitor-watch`;
  const w = useApi(base);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const d = w.data;
  const running = Boolean(d?.running);
  usePoll(() => w.reload(true), running, 3000);
  const start = () => run('run', async () => { await api(`${base}/run`, { method: 'POST' }); toast('Visiting your competitors now'); setTimeout(() => w.reload(true), 800); });
  const toggle = (enabled) => run('cfg', async () => { await api(base, { method: 'PUT', body: { enabled } }); w.reload(true); });
  if (!d) return <div className="py-10 flex justify-center text-gray-400"><Loader2 size={16} className="animate-spin" /></div>;
  const none = d.competitors.length === 0;
  return (
    <>
      <ErrorNote>{w.error?.message || error}</ErrorNote>
      <Card className="mb-4" title="Weekly competitor watch" subtitle="Each week we visit your competitors' websites and tell you what is new, what changed and what disappeared"
        action={<Badge tone={running ? 'blue' : d.enabled ? 'green' : 'gray'}>{running ? 'Visiting now' : d.enabled ? 'On' : 'Off'}</Badge>}>
        {none ? (
          <div className="text-13 text-gray-600">
            No competitors are being watched yet. Save competitors in <Link className="text-indigo-600 font-semibold" to="/competitor-finder">Competitor Research</Link>, or add them under{' '}
            <Link className="text-indigo-600 font-semibold" to="/backlink-intelligence?tab=targets">Backlink Intelligence → Targets</Link> (use “Sync”).
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-13"><input type="checkbox" checked={d.enabled} onChange={(e) => toggle(e.target.checked)} /> Visit every week automatically</label>
              <Button variant="primary" icon={running ? Loader2 : Play} busy={busy === 'run' || running} disabled={running} onClick={start}>{running ? 'Visiting…' : 'Check now'}</Button>
              <span className="text-12 text-gray-500">
                {d.last_run_at ? `Last visit ${fmtDateTime(d.last_run_at)}` : 'Not visited yet'}{d.enabled && d.next_run_at ? ` · next ${fmtDate(d.next_run_at)}` : ''}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">{d.competitors.map(c => (
              <span key={c.domain} className="text-12 px-2 py-1 rounded bg-gray-100 text-gray-700">{c.domain} · {c.pages_watched} page{c.pages_watched === 1 ? '' : 's'} watched</span>))}</div>
            <p className="text-11 text-gray-400 mt-3">Public pages only, with robots.txt and polite delays respected. Up to 25 pages per competitor per visit: the home page, new pages, then the ones we have not looked at for the longest. We report what changed, not why.</p>
          </>
        )}
      </Card>

      {d.latest && <Card className="mb-4" title="This week"><Report r={d.latest} /></Card>}

      <Card className="mb-4" title="What changed" subtitle="Newest first">
        {d.events.length === 0 ? <div className="py-6 text-center text-13 text-gray-500">{none ? 'Nothing to show yet.' : 'No changes recorded yet. The first visit only sets the starting point.'}</div> : (
          <div className="divide-y divide-gray-100">{d.events.map((e, i) => {
            const K = KIND[e.kind]; const Icon = K.icon;
            const fields = (e.detail?.fields || []).map(f => FIELD[f] || f);
            return (
              <div key={i} className="py-2.5 flex flex-wrap items-start gap-3">
                <Badge tone={K.tone}><Icon size={11} className="inline mr-1" />{K.label}</Badge>
                <div className="flex-1 min-w-[240px]">
                  <div className="text-13 text-gray-900">{e.title || '(untitled page)'} <span className="text-12 text-gray-400">· {e.domain}</span></div>
                  <a className="text-12 text-indigo-600 hover:underline break-all" href={e.url} target="_blank" rel="noreferrer noopener nofollow">{e.url.replace(/^https?:\/\//, '')}</a>
                  {e.kind === 'changed' && (
                    <div className="text-12 text-gray-600 mt-0.5">
                      Changed: {fields.join(', ')}
                      {e.detail.title_before && e.detail.title_after && <> · title “{e.detail.title_before}” → “{e.detail.title_after}”</>}
                      {fields.includes('text') && <> · {e.detail.words_before} → {e.detail.words_after} words</>}
                    </div>
                  )}
                </div>
                <span className="text-12 text-gray-400">{fmtDate(e.at)}</span>
              </div>);
          })}</div>
        )}
      </Card>

      {d.history.length > 0 && (
        <Card title="Earlier weeks">
          <div className="divide-y divide-gray-100">{d.history.map(r => <div key={r.week_start} className="py-3"><Report r={r} compact /></div>)}</div>
        </Card>
      )}
      {toastNode}
    </>
  );
}

export default function CompetitorWatchPage() {
  return (
    <SeoShell title="Competitor watch" subtitle="A weekly summary of what your competitors changed on their websites">
      {(b) => <Body key={b.id} b={b} />}
    </SeoShell>
  );
}
