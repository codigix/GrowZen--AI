import React, { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Clock, RefreshCw, TrendingUp, ExternalLink } from 'lucide-react';
import { SeoShell, Card, Button, Badge, Stat, ScoreRing, ErrorNote, SkList, useAction, useToast } from './SeoUi';
import { api, useApi } from './seoApi';
import Tip from './Tip';

const AREAS = ['seo', 'aeo', 'geo', 'gmb', 'local', 'chatgpt'];
const SEV = { critical: ['Critical', 'red'], serious: ['Serious', 'amber'], warning: ['Warning', 'blue'], info: ['Notice', 'gray'] };
const STATUS = { todo: ['To do', 'gray'], done: ['Marked done: not confirmed', 'amber'], unverified: ['Check still fails', 'red'], failed: ['Check failed', 'red'], blocked: ['Blocked', 'gray'], verified: ['Confirmed', 'green'] };
const TH = 'px-3 py-2.5 font-semibold whitespace-nowrap text-left';
const day = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—');

function Trend({ h }) {
  if (!h || h.length < 2) return null;
  const max = 100;
  return (
    <div className="flex items-end gap-1 h-12" aria-label="Score over time">
      {h.map((p, i) => <Tip key={i} text={`${p.score}/100 · ${day(p.at)}`}><span className="block w-3 rounded-t bg-indigo-400" style={{ height: `${Math.max(4, Math.round((p.score / max) * 44))}px` }} /></Tip>)}
    </div>
  );
}

function Body({ b, area }) {
  const r = useApi(`/businesses/${b.id}/fix-plan/${area}`);
  const [tab, setTab] = useState('open');
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const [result, setResult] = useState(null);
  const d = r.data;
  if (r.error) return <Card><ErrorNote>{r.error.message}</ErrorNote></Card>;
  if (!d) return <SkList rows={6} />;
  const check = () => run('check', async () => {
    const out = await api(`/businesses/${b.id}/fix-plan/${area}/check`, { method: 'POST', timeout: 180000 });
    r.setData(out); setResult(out.result);
    toast(out.result.delta > 0 ? `Score up by ${out.result.delta}: now ${out.result.after}` : out.result.closed ? `${out.result.closed} fix${out.result.closed > 1 ? 'es' : ''} confirmed` : 'Nothing new passes yet');
  });
  const pill = (on) => `h-8 px-3 rounded-full text-12 font-semibold cursor-pointer ring-1 ring-inset ${on ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`;
  const rows = tab === 'open' ? d.open : d.closed;
  const sc = d.score;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <Card title={d.label} subtitle={d.about}
        action={d.scored && <Button size="sm" variant="primary" icon={RefreshCw} busy={busy === 'check'} disabled={!d.has_website} onClick={check}>Check my fixes</Button>}>
        <ErrorNote>{error}</ErrorNote>
        <div className="flex flex-wrap items-center gap-6">
          {sc ? (
            <>
              <ScoreRing score={sc.now} size={104} label="score now" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-1 min-w-[280px]">
                <Stat label="Score if all fixed" value={sc.potential} hint={`+${d.potential} possible`} /><Stat label="Open changes" value={d.open_total} hint={`${d.counts.critical + d.counts.serious} critical or serious`} />
                <Stat label="Confirmed fixes" value={d.closed.length} hint={d.gained ? `+${d.gained} points earned` : 'last 30 days'} /><Stat label="Checks passing" value={`${sc.checks_passed}/${sc.checks_total}`} hint={`scanned ${day(sc.scanned_at)}`} />
              </div>
              <div className="min-w-[110px]"><p className="text-12 text-slate-500 mb-1">Score over time</p><Trend h={d.history} /></div>
            </>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 flex-1 min-w-[280px]">
              <Stat label="Open changes" value={d.open_total} hint={`${d.counts.critical + d.counts.serious} critical or serious`} /><Stat label="Confirmed" value={d.closed.length} hint="last 30 days" />
              <Stat label="Score" value="—" hint={d.scored ? '' : 'This area has no page score: progress is shown by confirmed tasks'} />
            </div>
          )}
        </div>
        {d.note && <p className="mt-3 text-13 text-amber-700">{d.note}</p>}
        {result && <p className={`mt-3 text-13 font-semibold ${result.delta > 0 ? 'text-emerald-700' : 'text-slate-700'}`}><TrendingUp size={14} className="inline mr-1" />{result.before != null ? `Score ${result.before} → ${result.after}${result.delta > 0 ? ` (+${result.delta})` : ''}. ` : ''}{result.closed} fix{result.closed === 1 ? '' : 'es'} confirmed by this scan, {result.still_open} still open.</p>}
        <p className="mt-3 flex flex-wrap gap-2 text-12">{AREAS.map(k => <Link key={k} to={`/fix-plan/${k}`} className={`rounded-full px-3 py-1 ring-1 ring-inset ${k === area ? 'bg-indigo-50 text-indigo-700 ring-indigo-200 font-semibold' : 'text-slate-600 ring-slate-200 hover:bg-slate-50'}`}>{d.areas[k]}</Link>)}</p>
      </Card>
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-slate-100">
          <button type="button" aria-pressed={tab === 'open'} onClick={() => setTab('open')} className={pill(tab === 'open')}>Changes to make <span className="opacity-70">{d.open_total}</span></button>
          <button type="button" aria-pressed={tab === 'done'} onClick={() => setTab('done')} className={pill(tab === 'done')}>Confirmed <span className="opacity-70">{d.closed.length}</span></button>
          <Link to="/growth#issues" className="ml-auto text-12.5 font-semibold text-indigo-600 hover:underline">All issues in the Growth Plan →</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-13">
            <thead className="bg-slate-50 text-12 uppercase tracking-wide text-slate-500"><tr>
              <th className={TH}>Change to make</th><th className={TH}>Priority</th>
              <th className={`${TH} text-right`}><Tip text="What fixing it adds to this area's score. Only shown for checks of the homepage scan." align="right">Score</Tip></th>
              <th className={TH}>Time</th><th className={TH}>Who</th><th className={TH}>Status</th><th className={TH}>{tab === 'open' ? 'Due' : 'Confirmed'}</th><th className={TH} /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(x => { const [sl, st] = SEV[x.severity] || SEV.warning; const [stl, stt] = STATUS[x.status] || STATUS.todo; return (
                <tr key={x.id} className="hover:bg-slate-50 align-middle">
                  <td className="px-3 py-3 max-w-[360px]"><Link to={`/growth/fix/${x.id}`} className="font-semibold text-slate-900 hover:text-indigo-700 block">{x.title}</Link>{x.last_check && <span className="block text-12 text-slate-500 truncate" title={x.last_check}>{x.last_check}</span>}</td>
                  <td className="px-3 py-3"><Badge tone={st}>{sl}</Badge></td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold text-emerald-700">{x.points != null ? `+${x.points}` : <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-3 text-slate-600 whitespace-nowrap"><Clock size={12} className="inline mr-1 text-slate-400" />{x.est_minutes ? `${x.est_minutes} min` : '—'}</td>
                  <td className="px-3 py-3 text-slate-600">{x.fix_mode_label || '—'}</td>
                  <td className="px-3 py-3"><Tip text={x.closes_when} wide><Badge tone={stt}>{stl}</Badge></Tip></td>
                  <td className={`px-3 py-3 whitespace-nowrap ${x.overdue ? 'text-red-600 font-semibold' : 'text-slate-600'}`}>{day(tab === 'open' ? x.due_on : x.verified_at)}{x.overdue ? ' · overdue' : ''}</td>
                  <td className="px-3 py-3 text-right"><Link to={`/growth/fix/${x.id}`}><Button size="sm" variant={tab === 'open' ? 'primary' : 'secondary'} icon={tab === 'open' ? ArrowRight : CheckCircle2}>{tab === 'open' ? 'How to fix' : 'Details'}</Button></Link></td>
                </tr>); })}
              {!rows.length && <tr><td colSpan={8} className="px-5 py-10 text-center text-slate-500">{tab === 'open' ? 'No open changes for this area. Press “Check my fixes” to scan again, or run a scan from the Growth Plan.' : 'Nothing confirmed yet. A fix counts only when a real check of the live site passes.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="px-5 py-3 border-t border-slate-100 text-11.5 text-slate-400">Marking a task done does not change the score. After you make a change, press “Check my fixes”: the homepage is scanned again, the tasks whose check passes are confirmed, and the score is read from that scan. {d.scored && sc?.url && <a href={sc.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline inline-flex items-center gap-1">Page scanned<ExternalLink size={10} /></a>}</p>
      </Card>
      {toastNode}
    </div>
  );
}

export default function FixPlanPage() {
  const { area } = useParams();
  if (!AREAS.includes(area)) return <Navigate to="/fix-plan/seo" replace />;
  return (
    <SeoShell title="Fix plan" subtitle="Every change to make, what each is worth, and the score that rises once a fix is confirmed">
      {(b) => <Body key={`${b.id}-${area}`} b={b} area={area} />}
    </SeoShell>
  );
}
