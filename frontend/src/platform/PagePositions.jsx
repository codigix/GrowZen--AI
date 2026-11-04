import React from 'react';
import { RefreshCw, Sparkles, ExternalLink, ArrowUp, ArrowDown } from 'lucide-react';
import { Card, Button, Badge, ErrorNote, Stat, useAction, useToast, SkList } from './SeoUi';
import { api, useApi, fmtDate } from './seoApi';

const LEVEL = { fix: ['Fix', 'red'], improve: ['Improve', 'amber'], keep: ['Keep', 'green'] };
const tone = (r) => (r == null ? 'gray' : r <= 3 ? 'green' : r <= 10 ? 'blue' : 'amber');
const path = (u) => { try { return new URL(u).pathname || '/'; } catch { return u; } };

/** Every tracked keyword: where the site is on Google, which page ranks, who is ahead, and what to do to move up. */
export default function PagePositions({ b }) {
  const rep = useApi(`/businesses/${b.id}/seo/rank-report`);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const d = rep.data;
  const seed = () => run('seed', async () => { const r = await api(`/businesses/${b.id}/seo/seed-keywords`, { method: 'POST' }); toast(`${r.added} keywords added`); rep.reload(true); });
  const check = () => run('check', async () => {
    const r = await api(`/businesses/${b.id}/seo/check-ranks`, { method: 'POST', body: {} });
    toast(`Checked ${r.checked} keyword${r.checked !== 1 ? 's' : ''}`); rep.reload(true);
  });
  if (rep.error) return <Card><ErrorNote>{rep.error.message}</ErrorNote></Card>;
  if (!d) return <SkList rows={5} />;
  const s = d.summary;
  return (
    <div className="grid gap-5">
      <Card title="Where each page ranks on Google" subtitle="Position of your site for each tracked keyword, the page Google shows, and what to change to move up."
        action={<div className="flex gap-2">
          <Button size="sm" icon={Sparkles} busy={busy === 'seed'} onClick={seed}>Add suggested keywords</Button>
          <Button size="sm" variant="primary" icon={RefreshCw} busy={busy === 'check'} disabled={!d.tracked || !d.serper} onClick={check}>Check positions now</Button>
        </div>}>
        <ErrorNote>{error}</ErrorNote>
        {d.state === 'no_website' && <p className="text-13 text-slate-500">Add the project's website first: positions are matched by its domain.</p>}
        {d.state === 'no_keywords' && <p className="text-13 text-slate-500">No keywords are tracked yet. Press "Add suggested keywords" to track the searches customers use to find this business, then check positions.</p>}
        {!d.serper && d.tracked > 0 && <p className="text-13 text-amber-700">Live Google positions need SERPER_API_KEY on the backend.</p>}
        {d.rows.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-1">
            <Stat label="Tracked" value={s.tracked} /><Stat label="Ranking (top 20)" value={s.ranking} /><Stat label="Top 3" value={s.top3} /><Stat label="Top 10" value={s.top10} /><Stat label="Avg position" value={s.avg_position ?? '—'} />
          </div>
        )}
      </Card>
      {d.rows.map(r => (
        <Card key={r.keyword} pad>
          <div className="flex flex-wrap items-center gap-3">
            <span className={`min-w-[52px] text-center px-2 py-1 rounded text-16 font-bold tabular-nums ${r.rank == null ? 'bg-slate-100 text-slate-500' : r.rank <= 3 ? 'bg-emerald-50 text-emerald-700' : r.rank <= 10 ? 'bg-indigo-50 text-indigo-700' : 'bg-amber-50 text-amber-700'}`}>{r.rank ? `#${r.rank}` : '—'}</span>
            <div className="flex-1 min-w-[200px]">
              <div className="text-14 font-semibold text-slate-900">{r.keyword}</div>
              <div className="text-12 text-slate-500">
                {r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline inline-flex items-center gap-1">{path(r.url)} <ExternalLink size={11} /></a> : r.target_url ? `Target page: ${path(r.target_url)}` : 'No page of yours in the top 20'}
                {r.checked && <> · checked {fmtDate(r.checked)}</>}{r.volume ? <> · {r.volume.toLocaleString()} searches/mo</> : null}
              </div>
            </div>
            {r.change ? <Badge tone={r.change > 0 ? 'green' : 'red'}>{r.change > 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}{Math.abs(r.change)}</Badge> : null}
            {r.best ? <Badge tone={tone(r.best)}>best #{r.best}</Badge> : null}
          </div>
          {r.ahead.length > 0 && <div className="mt-2 text-12 text-slate-500">Ahead of you: {r.ahead.join(', ')}</div>}
          <ul className="mt-3 grid gap-2">
            {r.advice.map((a, i) => { const [label, t] = LEVEL[a.level] || LEVEL.improve; return (
              <li key={i} className="flex gap-2 text-13 text-slate-700"><Badge tone={t}>{label}</Badge><span>{a.text}</span></li>
            ); })}
          </ul>
        </Card>
      ))}
      {toastNode}
    </div>
  );
}
