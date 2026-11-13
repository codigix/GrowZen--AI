import React, { useMemo, useState } from 'react';
import { RefreshCw, Sparkles, ExternalLink, ArrowUp, ArrowDown, ChevronDown, ChevronRight, MapPin, Search } from 'lucide-react';
import { Card, Button, Badge, ErrorNote, Stat, useAction, useToast, SkList } from './SeoUi';
import { api, useApi, fmtDate } from './seoApi';
import Tip from './Tip';

const LEVEL = { fix: ['Fix', 'red'], improve: ['Improve', 'amber'], keep: ['Keep', 'green'] };
const tone = (r) => (r == null ? 'gray' : r <= 3 ? 'green' : r <= 10 ? 'blue' : 'amber');
const path = (u) => { try { return new URL(u).pathname || '/'; } catch { return u; } };
const n0 = (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN'));
const FILTERS = [['all', 'All', () => true], ['shown', 'Shown on Google', r => r.rank != null], ['none', 'No impressions yet', r => r.rank == null && r.checked], ['unchecked', 'Not checked', r => !r.checked], ['fix', 'Needs a fix', r => r.advice.some(a => a.level === 'fix')]];
const TH = 'px-3 py-2.5 font-semibold whitespace-nowrap text-left';

const PosBadge = ({ r }) => {
  if (!r.checked) return <span className="inline-flex min-w-[56px] justify-center rounded px-2 py-1 text-13 font-semibold bg-slate-50 text-slate-400">—</span>;
  if (r.rank == null) return <Tip text="Google Search Console reports no impressions for this keyword in the last 28 days: the site is not shown for it yet."><span className="inline-flex min-w-[56px] justify-center rounded px-2 py-1 text-12 font-semibold bg-slate-100 text-slate-500 whitespace-nowrap">none yet</span></Tip>;
  const v = r.average_position ?? r.rank;
  return <Tip text={`Average position ${v} over the last 28 days (Google Search Console).`}><span className={`inline-flex min-w-[56px] justify-center rounded px-2 py-1 text-15 font-bold tabular-nums ${r.rank <= 3 ? 'bg-emerald-50 text-emerald-700' : r.rank <= 10 ? 'bg-indigo-50 text-indigo-700' : 'bg-amber-50 text-amber-700'}`}>{v}</span></Tip>;
};

/** Every tracked keyword: its position on Google (Search Console), the impressions and clicks behind it, the Maps place, the page that ranks, and what to do to move up. */
export default function PagePositions({ b }) {
  const rep = useApi(`/businesses/${b.id}/seo/rank-report`);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const d = rep.data;
  const seed = () => run('seed', async () => { const r = await api(`/businesses/${b.id}/seo/seed-keywords`, { method: 'POST' }); toast(`${r.added} keywords added`); rep.reload(true); });
  const check = () => run('check', async () => {
    const r = await api(`/businesses/${b.id}/seo/check-ranks`, { method: 'POST', body: {} });
    toast(`Read ${r.checked} keyword${r.checked !== 1 ? 's' : ''} from Google Search Console`); rep.reload(true);
  });
  const rows = useMemo(() => {
    if (!d) return [];
    const f = FILTERS.find(x => x[0] === filter)[2];
    const needle = q.trim().toLowerCase();
    return d.rows.filter(r => f(r) && (!needle || r.keyword.includes(needle)));
  }, [d, filter, q]);
  if (rep.error) return <Card><ErrorNote>{rep.error.message}</ErrorNote></Card>;
  if (!d) return <SkList rows={5} />;
  const s = d.summary;
  const pill = (on) => `h-8 px-3 rounded-full text-12 font-semibold cursor-pointer ring-1 ring-inset ${on ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`;
  return (
    <div className="grid gap-5">
      <Card title="Where each page ranks on Google" subtitle="Each tracked keyword's average position from Google Search Console (last 28 days), the page Google shows, and what to change to move up."
        action={<div className="flex gap-2">
          <Button size="sm" icon={Sparkles} busy={busy === 'seed'} onClick={seed}>Add suggested keywords</Button>
          <Button size="sm" variant="primary" icon={RefreshCw} busy={busy === 'check'} disabled={!d.tracked || !d.rank_ready} onClick={check}>Check positions now</Button>
        </div>}>
        <ErrorNote>{error}</ErrorNote>
        {d.state === 'no_website' && <p className="text-13 text-slate-500">Add the project's website first: positions are read from its Search Console property.</p>}
        {d.state === 'no_keywords' && <p className="text-13 text-slate-500">No keywords are tracked yet. Press "Add suggested keywords" to track the searches customers use to find this business, then check positions.</p>}
        {!d.rank_ready && d.tracked > 0 && <p className="text-13 text-amber-700">Positions are read from Google Search Console: link the Google account that owns this website to the project (Integrations).</p>}
        {d.rows.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 mt-1">
            <Stat label="Tracked" value={s.tracked} /><Stat label="Shown on Google" value={s.shown ?? s.ranking} /><Stat label="Impressions" value={n0(s.impressions)} /><Stat label="Clicks" value={n0(s.clicks)} />
            <Stat label="Top 3" value={s.top3} /><Stat label="Top 10" value={s.top10} /><Stat label="Avg position" value={s.avg_position ?? '—'} />
          </div>
        )}
      </Card>

      {d.rows.length > 0 && (
        <Card pad={false}>
          <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-slate-100">
            {FILTERS.map(([id, label, f]) => <button key={id} type="button" onClick={() => setFilter(id)} aria-pressed={filter === id} className={pill(filter === id)}>{label} <span className="opacity-70">{d.rows.filter(f).length}</span></button>)}
            <label className="relative ml-auto"><Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search keywords" aria-label="Search keywords" className="h-8 w-52 pl-8 pr-3 text-13 rounded-lg ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none" /></label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-13">
              <thead className="bg-slate-50 text-12 uppercase tracking-wide text-slate-500">
                <tr>
                  <th className={`${TH} w-8`} />
                  <th className={TH}>Keyword</th>
                  <th className={TH}><Tip text="Search Console's average position over the last 28 days. Lower is better.">Position</Tip></th>
                  <th className={`${TH} text-right`}>Change</th>
                  <th className={`${TH} text-right`}><Tip text="How many times the site was shown on Google for this keyword." align="right">Impressions</Tip></th>
                  <th className={`${TH} text-right`}>Clicks</th>
                  <th className={TH}><Tip text="The business's place in the Google Maps results for this search (Google Places API).">Maps</Tip></th>
                  <th className={TH}>Page that ranks</th>
                  <th className={`${TH} text-right`}>Volume</th>
                  <th className={TH}>What to do</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(r => {
                  const on = open === r.keyword;
                  const top = r.advice[0];
                  const [label, t] = LEVEL[top?.level] || LEVEL.improve;
                  return (
                    <React.Fragment key={r.keyword}>
                      <tr className="align-middle hover:bg-slate-50 cursor-pointer" onClick={() => setOpen(on ? null : r.keyword)}>
                        <td className="px-3 py-3 text-slate-400">{on ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                        <td className="px-3 py-3 font-semibold text-slate-900 max-w-[240px]"><span className="block truncate" title={r.keyword}>{r.keyword}</span>{r.checked && <span className="block text-11.5 font-normal text-slate-400">checked {fmtDate(r.checked)}</span>}</td>
                        <td className="px-3 py-3"><PosBadge r={r} /></td>
                        <td className="px-3 py-3 text-right">{r.change ? <Badge tone={r.change > 0 ? 'green' : 'red'}>{r.change > 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}{Math.abs(r.change)}</Badge> : <span className="text-slate-300">—</span>}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{n0(r.impressions)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{n0(r.clicks)}</td>
                        <td className="px-3 py-3 whitespace-nowrap">{!r.checked ? <span className="text-slate-300">—</span> : r.maps_rank ? <Badge tone={r.maps_rank <= 3 ? 'green' : 'blue'}><MapPin size={11} />#{r.maps_rank}</Badge> : <Tip text={r.maps_first ? `Not in the Maps results. Maps leader: ${r.maps_first}.` : 'Not in the Maps results.'}><span className="text-12 text-slate-400">not listed</span></Tip>}</td>
                        <td className="px-3 py-3 max-w-[200px]">{r.url ? <a href={r.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-indigo-600 hover:underline inline-flex items-center gap-1 max-w-full"><span className="truncate">{path(r.url)}</span><ExternalLink size={11} className="shrink-0" /></a> : r.target_url ? <span className="text-slate-500 truncate block" title={r.target_url}>target {path(r.target_url)}</span> : <span className="text-slate-300">—</span>}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-600">{n0(r.volume)}</td>
                        <td className="px-3 py-3 max-w-[260px]">{top ? <span className="flex items-start gap-1.5"><Badge tone={t}>{label}</Badge><Tip text={top.text} wide><span className="text-12.5 text-slate-600 line-clamp-2">{top.text}</span></Tip></span> : <span className="text-slate-300">—</span>}{r.advice.length > 1 && <span className="text-11.5 text-indigo-600">+{r.advice.length - 1} more</span>}</td>
                      </tr>
                      {on && (
                        <tr className="bg-slate-50/70">
                          <td />
                          <td colSpan={9} className="px-3 py-3">
                            {r.ahead.length > 0 && <div className="mb-2 text-12 text-slate-500">Ahead of you: {r.ahead.join(', ')}</div>}
                            <ul className="grid gap-2">{r.advice.map((a, i) => { const [l, tt] = LEVEL[a.level] || LEVEL.improve; return <li key={i} className="flex gap-2 text-13 text-slate-700"><Badge tone={tt}>{l}</Badge><span>{a.text}</span></li>; })}</ul>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {!rows.length && <tr><td colSpan={10} className="px-5 py-10 text-center text-slate-500">No keyword matches.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="px-5 py-3 border-t border-slate-100 text-11.5 text-slate-400">Position is Google Search Console's average position over the last 28 days, with the impressions and clicks behind it. “None yet” means the site was not shown on Google for the keyword in that time. Click a row for everything to do for it.</p>
        </Card>
      )}
      {toastNode}
    </div>
  );
}
