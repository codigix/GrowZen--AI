import React from 'react';
import { Link } from 'react-router-dom';
import { Play, Loader2, FilePlus2, Pencil, FileX2, ExternalLink, ArrowRight, Star, Plus } from 'lucide-react';
import { SeoShell, Card, Badge, Button, ErrorNote, useAction, useToast, SkList, SkCard } from './SeoUi';
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
  if (!d) return <SkCard title="Weekly competitor watch" subtitle="Each week we visit your competitors' websites and tell you what is new, what changed and what disappeared"><SkList rows={4} /></SkCard>;
  const none = d.competitors.length === 0;
  return (
    <>
      <ErrorNote>{w.error?.message || error}</ErrorNote>
      {/* The weekly visit: one slim bar, so the competitors and what changed start high on the page */}
      <div className="mb-3 rounded-lg border border-gray-200 bg-white px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2" title="Public pages only, with robots.txt and polite delays respected. Up to 25 pages per competitor per visit: the home page, new pages, then the ones not looked at for the longest. We report what changed, not why.">
        <span className="text-14 font-semibold text-gray-900">Weekly watch</span>
        <Badge tone={running ? 'blue' : d.enabled ? 'green' : 'gray'}>{running ? 'Visiting now' : d.enabled ? 'On' : 'Off'}</Badge>
        {none ? (
          <span className="text-13 text-gray-600 flex-1 min-w-[240px]">No competitors are chosen yet. <Link className="text-indigo-600 font-semibold" to="/competitor-finder">Choose the 3 to 5 that really compete with you</Link>; the watch follows them.{d.not_chosen?.length > 0 ? ` ${d.not_chosen.length} found competitor${d.not_chosen.length === 1 ? ' is' : 's are'} waiting to be chosen.` : ''}</span>
        ) : (
          <>
            <label className="flex items-center gap-2 text-13"><input type="checkbox" checked={d.enabled} onChange={(e) => toggle(e.target.checked)} /> Visit every week</label>
            <span className="text-12.5 text-gray-500">{d.last_run_at ? `Last visit ${fmtDateTime(d.last_run_at)}` : 'Not visited yet'}{d.enabled && d.next_run_at ? ` · next ${fmtDate(d.next_run_at)}` : ''}</span>
            <span className="flex-1" />
            <Button size="sm" variant="primary" icon={running ? Loader2 : Play} busy={busy === 'run' || running} disabled={running} onClick={start}>{running ? 'Visiting…' : 'Check now'}</Button>
          </>
        )}
      </div>

      {!none && (
        <Card className="mb-4" title="Competitors you chose" subtitle="Chosen in Competitor Research. The watch follows these."
          action={<Link to="/competitor-finder?tab=competitors" className="text-12.5 font-semibold text-indigo-700 hover:underline">Change the choice →</Link>}>
          <div className="overflow-x-auto rounded-lg ring-1 ring-inset ring-gray-200">
            <table className="w-full text-13 min-w-[760px]">
              <thead className="bg-gray-50 text-11.5 uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left">Competitor</th><th className="px-3 py-2 text-right">Pages watched</th>
                  <th className="px-3 py-2 text-right">New</th><th className="px-3 py-2 text-right">Changed</th><th className="px-3 py-2 text-right">Removed</th>
                  <th className="px-3 py-2 text-left">Last change</th><th className="px-3 py-2 text-left">Open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {d.competitors.map(c => {
                  const ch = c.changes_30d || {};
                  const num = (v, tone) => <td className={`px-3 py-2.5 text-right tabular-nums ${v ? `font-semibold ${tone}` : 'text-gray-300'}`}>{v || 0}</td>;
                  return (
                    <tr key={c.domain} className="hover:bg-gray-50">
                      <td className="px-3 py-2.5 min-w-[220px]">
                        <div className="font-semibold text-gray-900 truncate max-w-[300px]" title={c.name}>{c.name}</div>
                        <a href={c.website} target="_blank" rel="noreferrer noopener nofollow" className="text-12 text-indigo-600 hover:underline inline-flex items-center gap-1 max-w-full"><span className="truncate">{c.domain}</span><ExternalLink size={10} className="shrink-0" /></a>
                        {c.rating ? <span className="ml-2 text-12 text-gray-500 inline-flex items-center gap-0.5"><Star size={11} className="text-amber-500" />{c.rating}{c.reviews ? ` (${c.reviews})` : ''}</span> : null}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{c.pages_watched}</td>
                      {num(ch.new_page, 'text-green-700')}{num(ch.changed, 'text-amber-700')}{num(ch.removed, 'text-red-700')}
                      <td className="px-3 py-2.5 text-12.5 text-gray-600 whitespace-nowrap">{c.last_change_at ? fmtDate(c.last_change_at) : <span className="text-gray-400">none in 30 days</span>}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-12.5 font-semibold">
                        <Link className="text-indigo-600 hover:underline mr-3" to={`/competitor-finder?tab=pages&competitor=${encodeURIComponent(c.domain)}`}>Top pages</Link>
                        <Link className="text-indigo-600 hover:underline mr-3" to={`/competitor-finder?compare=${encodeURIComponent(c.domain)}`}>Compare</Link>
                        <Link className="text-indigo-600 hover:underline" to={`/backlinks/gap?competitor=${encodeURIComponent(c.domain)}`}>Backlinks</Link>
                      </td>
                    </tr>);
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-11.5 text-gray-400">New, changed and removed are counted over the last 30 days.</p>
          {d.not_chosen?.length > 0 && (
            <p className="mt-3 text-12.5 text-gray-600">{d.not_chosen.length} more competitor{d.not_chosen.length === 1 ? ' was' : 's were'} found but not chosen ({d.not_chosen.slice(0, 3).map(x => x.name).join(', ')}{d.not_chosen.length > 3 ? '…' : ''}).{' '}
              <Link className="font-semibold text-indigo-700 hover:underline" to="/competitor-finder?tab=competitors">Look at them <ArrowRight size={11} className="inline" /></Link></p>
          )}
        </Card>
      )}

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
    <SeoShell step="competitors" title="Competitor watch" subtitle="The competitors you chose, and what they changed on their websites each week">
      {(b) => <Body key={b.id} b={b} />}
    </SeoShell>
  );
}
