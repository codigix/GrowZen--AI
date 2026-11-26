import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Clock, RefreshCw, TrendingUp, ExternalLink, Download } from 'lucide-react';
import { SeoShell, Card, Button, Badge, ScoreRing, ErrorNote, SkList, useAction, useToast } from './SeoUi';
import { api, useApi } from './seoApi';
import Tip from './Tip';
import OnboardingPhases from './OnboardingPhases';
import { usePager, Pager, useSorted, SortTh, downloadCsv, downloadFile } from './DataTable';

const SEV = { critical: ['Critical', 'red'], serious: ['Serious', 'amber'], warning: ['Warning', 'blue'], info: ['Notice', 'gray'] };
const STATUS = { todo: ['To do', 'gray'], done: ['Marked done: not confirmed', 'amber'], unverified: ['Check still fails', 'red'], failed: ['Check failed', 'red'], blocked: ['Blocked', 'gray'], verified: ['Confirmed', 'green'] };
const TH = 'px-3 py-2.5 font-semibold whitespace-nowrap text-left';
const day = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—');

function Trend({ h }) {
  if (!h || h.length < 2) return null;
  return (
    <div className="flex items-end gap-1" style={{ height: 30 }} aria-label="Score over time">
      {h.map((p, i) => <Tip key={i} text={`${p.score}/100 · ${day(p.at)}`}><span className="block w-2.5 rounded-t bg-indigo-300" style={{ height: `${Math.max(3, Math.round((p.score / 100) * 30))}px` }} /></Tip>)}
    </div>
  );
}

/** One area's card: its score (website areas) or task progress, and it filters the list below when clicked. */
function AreaCard({ a, on, onPick }) {
  const sc = a.score;
  return (
    <button type="button" onClick={onPick} aria-pressed={on} className={`text-left rounded-xl border p-3.5 cursor-pointer transition ${on ? 'border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-200' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
      <div className="flex items-center gap-3">
        {sc ? <ScoreRing score={sc.now} size={64} label="" /> : <span className="w-16 h-16 rounded-full bg-slate-50 ring-1 ring-inset ring-slate-200 inline-flex items-center justify-center text-slate-400 text-18 font-bold shrink-0">{a.open_total}</span>}
        <div className="min-w-0 flex-1">
          <div className="text-14 font-semibold text-slate-900 leading-tight">{a.label}</div>
          <div className="text-12 text-slate-500 mt-0.5">{a.open_total} to do{a.closed_total ? ` · ${a.closed_total} confirmed` : ''}</div>
          {sc ? <div className="text-12 text-emerald-700 mt-0.5">{a.potential ? `up to ${sc.potential} if fixed` : 'nothing left to fix'}</div> : <div className="text-12 text-slate-400 mt-0.5">no page score</div>}
        </div>
      </div>
      {sc && a.history.length > 1 && <div className="mt-2"><Trend h={a.history} /></div>}
    </button>
  );
}

const SEV_RANK = { critical: 0, serious: 1, warning: 2, info: 3 };
const FIX_VAL = (x, k, names, tab) => (k === 'title' ? x.title : k === 'area' ? (names[x.area] || x.area) : k === 'sev' ? SEV_RANK[x.severity] : k === 'points' ? x.points : k === 'time' ? x.est_minutes : k === 'who' ? x.fix_mode_label : k === 'status' ? (STATUS[x.status] || STATUS.todo)[0] : k === 'date' ? (tab === 'open' ? x.due_on : x.verified_at) : undefined);

function FixTable({ rows: all, tab, names }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const kept = useMemo(() => (needle ? all.filter(x => `${x.title} ${names[x.area] || x.area}`.toLowerCase().includes(needle)) : all), [all, needle, names]);
  const valueOf = useMemo(() => (x, k) => FIX_VAL(x, k, names, tab), [names, tab]);
  const { sorted, sort, onSort } = useSorted(kept, valueOf);
  const pager = usePager(sorted, { size: 25, resetKey: `${tab}|${needle}|${all.length}|${sort?.key}|${sort?.dir}` });
  const rows = pager.rows;
  return (
    <>
      <div className="px-5 py-2 border-b border-slate-100 flex justify-end"><Button size="sm" icon={Download} disabled={!sorted.length} onClick={() => downloadCsv(tab === 'open' ? 'fix-plan-changes-to-make' : 'fix-plan-confirmed', ['Change to make', 'Area', 'Priority', 'Score points', 'Time (minutes)', 'Who', 'Status', tab === 'open' ? 'Due date' : 'Confirmed on', 'Overdue', 'Closes when'],
        sorted.map(x => [x.title, names[x.area] || x.area, (SEV[x.severity] || SEV.warning)[0], x.points ?? '', x.est_minutes ?? '', x.fix_mode_label || '', (STATUS[x.status] || STATUS.todo)[0], (tab === 'open' ? x.due_on : x.verified_at) || '', x.overdue ? 'yes' : 'no', x.closes_when || '']))}>Export CSV</Button></div>
      {all.length > 10 && <div className="px-5 py-2 border-b border-slate-100"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search the changes" aria-label="Search the changes" className="h-8 w-60 px-2 text-13 rounded-md border border-slate-200 bg-white focus:border-indigo-400 outline-none" /></div>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-13">
          <thead className="bg-slate-50 text-12 uppercase tracking-wide text-slate-500"><tr>
            <SortTh id="title" sort={sort} onSort={onSort} className={TH}>Change to make</SortTh><SortTh id="area" sort={sort} onSort={onSort} className={TH}>Area</SortTh><SortTh id="sev" sort={sort} onSort={onSort} className={TH}>Priority</SortTh>
            <SortTh id="points" sort={sort} onSort={onSort} right first="desc" className={TH}><Tip text="What fixing it adds to that area's score (homepage checks only)." align="right">Score</Tip></SortTh>
            <SortTh id="time" sort={sort} onSort={onSort} className={TH}>Time</SortTh><SortTh id="who" sort={sort} onSort={onSort} className={TH}>Who</SortTh><SortTh id="status" sort={sort} onSort={onSort} className={TH}>Status</SortTh><SortTh id="date" sort={sort} onSort={onSort} className={TH}>{tab === 'open' ? 'Due' : 'Confirmed'}</SortTh><th className={TH} /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(x => {
              const [sl, st] = SEV[x.severity] || SEV.warning; const [stl, stt] = STATUS[x.status] || STATUS.todo; return (
                <tr key={x.id} className="hover:bg-slate-50 align-middle">
                  <td className="px-3 py-3 max-w-[340px]"><Link target="_blank" rel="noopener noreferrer" to={`/growth/fix/${x.id}`} className="font-semibold text-slate-900 hover:text-indigo-700 block">{x.title}</Link>{x.last_check && <span className="block text-12 text-slate-500 truncate" title={x.last_check}>{x.last_check}</span>}</td>
                  <td className="px-3 py-3 text-slate-600 whitespace-nowrap">{names[x.area] || x.area}</td>
                  <td className="px-3 py-3"><Badge tone={st}>{sl}</Badge></td>
                  <td className="px-3 py-3  tabular-nums font-semibold text-emerald-700">{x.points != null ? `+${x.points}` : <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-3 text-slate-600 whitespace-nowrap"><Clock size={12} className="inline mr-1 text-slate-400" />{x.est_minutes ? `${x.est_minutes} min` : '—'}</td>
                  <td className="px-3 py-3 text-slate-600 whitespace-nowrap">{x.fix_mode_label || '—'}</td>
                  <td className="px-3 py-3"><Tip text={x.closes_when} wide><Badge tone={stt}>{stl}</Badge></Tip></td>
                  <td className={`px-3 py-3 whitespace-nowrap ${x.overdue ? 'text-red-600 font-semibold' : 'text-slate-600'}`}>{day(tab === 'open' ? x.due_on : x.verified_at)}{x.overdue ? ' · overdue' : ''}</td>
                  <td className="px-3 py-3 text-right"><Link target="_blank" rel="noopener noreferrer" to={`/growth/fix/${x.id}`}><Button size="sm" variant={tab === 'open' ? 'primary' : 'secondary'} icon={tab === 'open' ? ArrowRight : CheckCircle2}>{tab === 'open' ? 'How to fix' : 'Details'}</Button></Link></td>
                </tr>);
            })}
            {!rows.length && <tr><td colSpan={9} className="px-5 py-10 text-center text-slate-500">{tab === 'open' ? 'Nothing to change here. Press “Check my fixes” to scan again, or run a scan from the Growth Plan.' : 'Nothing confirmed yet. A fix counts only when a real check of the live site passes.'}</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager p={pager} label="changes" />
    </>
  );
}

function Body({ b }) {
  const r = useApi(`/businesses/${b.id}/fix-plan`);
  const [params, setParams] = useSearchParams();
  const area = params.get('area') || 'all';
  const [tab, setTab] = useState('open');
  const [sev, setSev] = useState('all');
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const [result, setResult] = useState(null);
  const d = r.data;
  if (r.error) return <Card><ErrorNote>{r.error.message}</ErrorNote></Card>;
  if (!d) return <SkList rows={6} />;
  const setArea = (k) => setParams(k === 'all' ? { view: 'all' } : { view: 'all', area: k }, { replace: true });
  const check = () => run('check', async () => {
    const out = await api(`/businesses/${b.id}/fix-plan/check`, { method: 'POST', timeout: 180000 });
    r.setData(out); setResult(out.result);
    const up = Object.entries(out.result.areas).filter(([, v]) => v.delta > 0);
    toast(up.length ? up.map(([k, v]) => `${k.toUpperCase()} +${v.delta}`).join(', ') : out.result.closed ? `${out.result.closed} fix${out.result.closed > 1 ? 'es' : ''} confirmed` : 'Nothing new passes yet');
  });
  const pill = (on) => `h-8 px-3 rounded-full text-12 font-semibold cursor-pointer ring-1 ring-inset ${on ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`;
  const src = tab === 'open' ? d.open : d.closed;
  const rows = src.filter(x => (area === 'all' || x.area === area) && (sev === 'all' || x.severity === sev));
  const names = Object.fromEntries(d.areas.map(a => [a.key, a.label]));
  const scored = d.areas.filter(a => a.scored && a.score);
  const downloadPlan = () => {
    const item = (x) => `- **${x.title}** (${(SEV[x.severity] || SEV.warning)[0]}${x.points != null ? `, +${x.points} points` : ''}${x.est_minutes ? `, about ${x.est_minutes} min` : ''}${x.fix_mode_label ? `, ${x.fix_mode_label}` : ''})${x.closes_when ? `
  Confirmed when: ${x.closes_when}` : ''}`;
    const md = [`# Fix plan: ${b.name || 'project'}`, '', `Made ${new Date().toISOString().slice(0, 10)}. ${d.open_total} changes to make, ${d.closed.length} confirmed.`, '',
      '## Scores', '', ...d.areas.map(a => `- ${a.label}: ${a.score ? `${a.score.now}/100${a.potential ? `, up to ${a.score.potential} if fixed` : ''}` : 'no page score'}; ${a.open_total} to do, ${a.closed_total || 0} confirmed`), '',
    ...d.areas.flatMap(a => { const list = d.open.filter(x => x.area === a.key); return list.length ? [`## ${a.label}: changes to make`, '', ...list.map(item), ''] : []; }),
      '## Confirmed', '', ...(d.closed.length ? d.closed.map(x => `- ${x.title} (${names[x.area] || x.area}${x.verified_at ? `, ${x.verified_at.slice(0, 10)}` : ''})`) : ['Nothing confirmed yet.']), ''].join('\n');
    downloadFile(`fix-plan-${String(b.name || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${new Date().toISOString().slice(0, 10)}.md`, md, 'text/markdown');
  };
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <Card title="Everything to change on your website and profile" subtitle="Pick an area to filter. A fix counts, and the score rises, only after a real scan of the live site confirms it."
        action={<span className="flex gap-2"><Button size="sm" icon={Download} onClick={downloadPlan}>Download plan</Button><Button size="sm" variant="primary" icon={RefreshCw} busy={busy === 'check'} disabled={!d.has_website} onClick={check}>Check my fixes</Button></span>}>
        <ErrorNote>{error}</ErrorNote>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{d.areas.map(a => <AreaCard key={a.key} a={a} on={area === a.key} onPick={() => setArea(area === a.key ? 'all' : a.key)} />)}</div>
        {!scored.length && <p className="mt-3 text-13 text-amber-700">{d.has_website ? 'No website score yet: press “Check my fixes” to scan the homepage.' : 'Add the project’s website to get the website scores.'}</p>}
        {result && (
          <p className="mt-3 text-13 font-semibold text-slate-800"><TrendingUp size={14} className="inline mr-1 text-emerald-600" />
            {Object.entries(result.areas).filter(([, v]) => v.before != null).map(([k, v]) => `${k.toUpperCase()} ${v.before} → ${v.after}${v.delta > 0 ? ` (+${v.delta})` : ''}`).join(' · ')}{'. '}{result.closed} fix{result.closed === 1 ? '' : 'es'} confirmed by this scan, {result.still_open} still open.</p>
        )}
      </Card>
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-slate-100">
          <button type="button" aria-pressed={tab === 'open'} onClick={() => setTab('open')} className={pill(tab === 'open')}>Changes to make <span className="opacity-70">{d.open_total}</span></button>
          <button type="button" aria-pressed={tab === 'done'} onClick={() => setTab('done')} className={pill(tab === 'done')}>Confirmed <span className="opacity-70">{d.closed.length}</span></button>
          <span className="w-px h-5 bg-slate-200 mx-1" aria-hidden="true" />
          {[['all', 'Any priority'], ['critical', 'Critical'], ['serious', 'Serious'], ['warning', 'Warning'], ['info', 'Notice']].map(([k, l]) => <button key={k} type="button" aria-pressed={sev === k} onClick={() => setSev(k)} className={pill(sev === k)}>{l}{k !== 'all' && tab === 'open' && d.counts[k] ? <span className="opacity-70"> {d.counts[k]}</span> : null}</button>)}
          <Link to="/growth#issues" className="ml-auto text-12.5 font-semibold text-indigo-600 hover:underline">Growth Plan issues →</Link>
        </div>
        <FixTable rows={rows} tab={tab} names={names} />
        <p className="px-5 py-3 border-t border-slate-100 text-11.5 text-slate-400">Marking a task done does not change a score. After you make a change, press “Check my fixes”: the homepage is scanned again, tasks whose check passes are confirmed, and the scores come from that scan.{scored[0]?.score?.url && <> <a href={scored[0].score.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline inline-flex items-center gap-1">Page scanned<ExternalLink size={10} /></a></>}</p>
      </Card>
      {toastNode}
    </div>
  );
}

/** Two views of the same plan: step by step (the website first, then each profile phase) and every change in one list with the scores. */
function Views({ b }) {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'all' || params.get('area') ? 'all' : 'steps';
  const tab = (id, label) => <button type="button" aria-pressed={view === id} onClick={() => setParams(id === 'all' ? { view: 'all' } : {}, { replace: true })}
    className={`h-9 px-4 rounded-lg text-13 font-semibold cursor-pointer ring-1 ring-inset ${view === id ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}>{label}</button>;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex flex-wrap gap-2">{tab('steps', 'Step by step')}{tab('all', 'All changes and scores')}</div>
      {view === 'steps' ? <OnboardingPhases b={b} /> : <Body b={b} />}
    </div>
  );
}

export default function FixPlanPage() {
  return (
    <SeoShell title="Fix plan" subtitle="Start with the website, page by page. When it is right, build the profiles phase by phase.">
      {(b) => <Views key={b.id} b={b} />}
    </SeoShell>
  );
}
