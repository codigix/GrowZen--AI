import React from 'react';
import { Link } from 'react-router-dom';
import { Play, Loader2, FilePlus2, Pencil, FileX2, ExternalLink, ArrowRight, Star, Plus, FileText, Columns3, Link2, UserMinus, Download } from 'lucide-react';
import { SeoShell, Card, Badge, Button, ErrorNote, useAction, useToast, SkList, SkCard } from './SeoUi';
import { api, useApi, usePoll, fmtDate, fmtDateTime } from './seoApi';
import { Act, Head } from './TableBits';
import { downloadCsv, downloadFile } from './DataTable';

const KIND = {
  new_page: { label: 'New page', tone: 'green', icon: FilePlus2 },
  changed: { label: 'Changed', tone: 'amber', icon: Pencil },
  removed: { label: 'Removed', tone: 'red', icon: FileX2 }
};
const FIELD = { title: 'title', h1: 'heading', snippet: 'description', content: 'text' };

const Report = ({ r, compact }) => (r.outdated ? (
  <div className="rounded-lg bg-amber-50 ring-1 ring-amber-200 px-3 py-2.5 text-13 text-amber-900">
    <b>This report is about other competitors.</b> It was made for {r.other_sites?.slice(0, 6).join(', ') || 'sites'}{r.other_sites?.length > 6 ? ` and ${r.other_sites.length - 6} more` : ''}, which you have not chosen. Nothing is shown about them. The report for the competitors you chose is written after their first visit finishes.
  </div>
) : (
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
));

const reportMd = (r) => [`## ${r.headline}`, '', `Week of ${String(r.week_start || '').slice(0, 10)} · ${r.events} change${r.events === 1 ? '' : 's'}${r.baseline ? ' · first visit' : ''}`, '', r.summary || '', '', ...(r.what_it_means ? [`**What it means for you:** ${r.what_it_means}`, ''] : []), ...(r.actions?.length ? ['**What to do:**', ...r.actions.map(a => `- ${a}`), ''] : [])].join('\n');

function Body({ b }) {
  const base = `/businesses/${b.id}/competitor-watch`;
  const w = useApi(base);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const d = w.data;
  const running = Boolean(d?.running);
  usePoll(() => w.reload(true), running, 3000);
  const start = () => run('run', async () => { await api(`${base}/run`, { method: 'POST' }); toast('Visiting your competitors now'); setTimeout(() => w.reload(true), 800); });
  const leaveOut = (c) => run(`out${c.id}`, async () => { await api(`/competitors/${c.id}`, { method: 'PATCH', body: { selected: false } }); toast(`${c.name} left out of the watch`); w.reload(true); });
  const toggle = (enabled) => run('cfg', async () => { await api(base, { method: 'PUT', body: { enabled } }); w.reload(true); });
  if (!d) return <SkCard title="Weekly competitor watch" subtitle="Each week we visit your competitors' websites and tell you what is new, what changed and what disappeared"><SkList rows={4} /></SkCard>;
  const none = d.competitors.length === 0;
  const slug = String(b.name || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const exportCompetitors = () => downloadCsv(`competitor-watch-competitors-${slug}`, ['Competitor', 'Website', 'Rating', 'Reviews', 'Pages watched', 'New pages (30 days)', 'Changed pages (30 days)', 'Removed pages (30 days)', 'Last change'],
    d.competitors.map(c => [c.name, c.website || c.domain, c.rating ?? '', c.reviews ?? '', c.pages_watched ?? 0, c.changes_30d?.new_page || 0, c.changes_30d?.changed || 0, c.changes_30d?.removed || 0, c.last_change_at || '']));
  const exportEvents = () => downloadCsv(`competitor-watch-changes-${slug}`, ['Date', 'Type', 'Competitor', 'Page title', 'Page URL', 'What changed', 'Title before', 'Title after', 'Words before', 'Words after'],
    d.events.map(e => [e.at || '', KIND[e.kind]?.label || e.kind, e.domain, e.title || '', e.url, (e.detail?.fields || []).map(f => FIELD[f] || f).join(', '), e.detail?.title_before || '', e.detail?.title_after || '', e.detail?.words_before ?? '', e.detail?.words_after ?? '']));
  const exportReport = (list, what) => downloadFile(`competitor-watch-${what}-${slug}-${new Date().toISOString().slice(0, 10)}.md`, [`# Competitor watch: ${b.name || 'project'}`, '', ...list.map(reportMd)].join('\n'), 'text/markdown');
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
          action={<span className="flex items-center gap-3"><Button size="sm" icon={Download} onClick={exportCompetitors}>Export CSV</Button><Link to="/competitor-finder?tab=competitors" className="text-12.5 font-semibold text-indigo-700 hover:underline">Change the choice →</Link></span>}>
          <div className="overflow-x-auto rounded-lg ring-1 ring-inset ring-gray-200">
            <table className="w-full text-13 min-w-[760px]">
              <thead className="bg-gray-50 text-11.5 uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left"><Head what="A competitor you chose." why="The watch visits only these." from="your choice in Competitor Research.">Competitor</Head></th>
                  <th className="px-3 py-2 text-right"><Head right what="How many of its pages the watch remembers." why="Changes are found by comparing a page with what was remembered last time." from="the weekly visits to its public pages.">Pages watched</Head></th>
                  <th className="px-3 py-2 text-right"><Head right what="Pages it published in the last 30 days." from="pages found in its sitemap or links that were not known before.">New</Head></th>
                  <th className="px-3 py-2 text-right"><Head right what="Pages whose title, heading, description or text changed in the last 30 days." from="comparing each visit with the one before.">Changed</Head></th>
                  <th className="px-3 py-2 text-right"><Head right what="Pages that disappeared in the last 30 days (missing for two visits)." from="the weekly visits.">Removed</Head></th>
                  <th className="px-3 py-2 text-left"><Head what="The date of its most recent change we noticed." from="the weekly visits.">Last change</Head></th>
                  <th className="px-3 py-2 text-left"><Head what="Top pages: where it ranks on Google. Compare: its site next to yours. Backlinks: sites that link to it and not to you. Leave out: stop watching it." from="the competitor research, site audits and the backlink crawler.">Actions</Head></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {d.competitors.map(c => {
                  const ch = c.changes_30d || {};
                  const num = (v, tone) => <td className={`px-3 py-2.5  tabular-nums ${v ? `font-semibold ${tone}` : 'text-gray-300'}`}>{v || 0}</td>;
                  return (
                    <tr key={c.domain} className="hover:bg-gray-50">
                      <td className="px-3 py-2.5 min-w-[220px]">
                        <div className="font-semibold text-gray-900 truncate max-w-[300px]" title={c.name}>{c.name}</div>
                        <a href={c.website} target="_blank" rel="noreferrer noopener nofollow" className="text-12 text-indigo-600 hover:underline inline-flex items-center gap-1 max-w-full"><span className="truncate">{c.domain}</span><ExternalLink size={10} className="shrink-0" /></a>
                        {c.rating ? <span className="ml-2 text-12 text-gray-500 inline-flex items-center gap-0.5"><Star size={11} className="text-amber-500" />{c.rating}{c.reviews ? ` (${c.reviews})` : ''}</span> : null}
                      </td>
                      <td className="px-3 py-2.5  tabular-nums">{c.pages_watched || (d.running ? <span className="text-xs text-gray-400" title="Its pages are being visited now">Visiting…</span> : <span className="text-xs text-gray-400" title="The watch has not visited this competitor yet. Press Visit now.">Not visited yet</span>)}</td>
                      {num(ch.new_page, 'text-green-700')}{num(ch.changed, 'text-amber-700')}{num(ch.removed, 'text-red-700')}
                      <td className="px-3 py-2.5 text-12.5 text-gray-600 whitespace-nowrap">{c.last_change_at ? fmtDate(c.last_change_at) : <span className="text-gray-400">none in 30 days</span>}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-12.5 font-semibold">
                        <span className="inline-flex gap-1.5">
                          <Link to={`/competitor-finder?tab=pages&competitor=${encodeURIComponent(c.domain)}`}><Act icon={FileText} tone="teal" tip="Top pages: the pages of this competitor that are in Google's top 10 for your keywords, with an estimate of the visits they bring." /></Link>
                          <Link to={`/competitor-finder?compare=${encodeURIComponent(c.domain)}`}><Act icon={Columns3} tone="indigo" tip="Compare: open its site next to yours (speed, content, links). It is audited first if needed." /></Link>
                          <Link to={`/backlinks/gap?competitor=${encodeURIComponent(c.domain)}`}><Act icon={Link2} tone="sky" tip="Backlinks: websites that link to this competitor but not to you, places to ask for a link." /></Link>
                          {c.id && <Act icon={UserMinus} tone="rose" tip="Leave out: stop watching it. It stays in the found list, and you can choose it again." busy={busy === `out${c.id}`} onClick={() => leaveOut(c)} />}
                        </span>
                      </td>
                    </tr>);
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-11.5 text-gray-400">New, changed and removed are counted over the last 30 days.</p>
        </Card>
      )}

      {d.latest && <Card className="mb-4" title="This week" action={d.latest.outdated ? null : <Button size="sm" icon={Download} onClick={() => exportReport([d.latest], 'report')}>Download report</Button>}><Report r={d.latest} /></Card>}

      <Card className="mb-4" title="What changed" subtitle="Newest first" action={d.events.length ? <Button size="sm" icon={Download} onClick={exportEvents}>Export CSV</Button> : null}>
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
        <Card title="Earlier weeks" action={<Button size="sm" icon={Download} onClick={() => exportReport(d.history, 'earlier-weeks')}>Download reports</Button>}>
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
