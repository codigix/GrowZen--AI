import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Loader2, Plus, Search } from 'lucide-react';
import { SeoShell, Card, Button, Badge, ErrorNote, useAction, useToast } from './SeoUi';
import { usePager, Pager, downloadCsv } from './DataTable';
import { api } from './seoApi';

const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const VERDICT = { yes: ['Useful', 'green'], maybe: ['Maybe', 'amber'], have: ['You have it', 'blue'], no: ['Not useful', 'red'] };

function Body({ b }) {
  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState(null);
  const [fit, setFit] = useState('yes');
  const [q, setQ] = useState('');
  const [paid, setPaid] = useState({});
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();

  const load = () => run('load', async () => {
    const r = await api(`/businesses/${b.id}/keyword-workspace/competitor-keywords`, { method: 'POST', body: {}, timeout: 120000 });
    setMeta(r); setRows(r.rows);
  });
  const real = (d) => run(`rank:${d}`, async () => {
    const r = await api(`/businesses/${b.id}/keyword-workspace/competitor-rankings`, { method: 'POST', body: { domain: d, limit: 100 }, timeout: 150000 });
    setPaid(p => ({ ...p, [d]: r }));
    toast(r.note || `${r.rows.length} real rankings read (about $${r.cost})`);
  });

  const all = useMemo(() => {
    const by = new Map((rows || []).map(r => [r.keyword, { ...r }]));
    Object.values(paid).forEach(p => (p.rows || []).forEach(r => { const e = by.get(r.keyword); by.set(r.keyword, e ? { ...e, ...r, competitors: e.competitors || [r.competitor], rankings: [...(e.rankings || []), { d: r.competitor, pos: r.position, url: r.url }] } : { ...r, competitors: [r.competitor], rankings: [{ d: r.competitor, pos: r.position, url: r.url }] }); }));
    return [...by.values()];
  }, [rows, paid]);
  const counts = useMemo(() => all.reduce((m, r) => ({ ...m, [r.fit]: (m[r.fit] || 0) + 1 }), {}), [all]);
  const shown = useMemo(() => all.filter(r => (!fit || r.fit === fit) && (!q || r.keyword.includes(q.toLowerCase()))), [all, fit, q]);
  const pager = usePager(shown, { size: 25, resetKey: `${fit}|${q}` });

  const send = (list) => run('send', async () => {
    const r = await api(`/businesses/${b.id}/keyword-workspace/add`, { method: 'POST', body: { ideas: list.map(i => ({ keyword: i.keyword, volume: i.volume, detail: `Competitor keyword: ${(i.competitors || [i.competitor])[0]}` })), label: 'Competitor keywords' } });
    toast(r.added ? `${r.added} keyword${r.added === 1 ? '' : 's'} sent to the Keyword Workspace` : 'Already in the Keyword Workspace');
  });

  return (
    <div className="space-y-4">
      <Card title="Competitor keywords" subtitle="Only their keywords, and whether each one is useful for you. Their websites are not crawled and nothing technical is checked."
        action={<Button size="sm" variant="primary" icon={Search} busy={busy === 'load'} onClick={load}>{rows ? 'Refresh' : 'Find their keywords'}</Button>}>
        <p className="text-13 text-slate-600">Free: Google Keyword Planner reads each competitor's address and lists the searches it is about. For the keywords a competitor really ranks for, with position and the ranking page, read them one competitor at a time (about $0.003 a keyword, about $0.33 for 100).</p>
        {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
        {meta?.state === 'no_competitors' && <p className="mt-3 text-13 text-slate-500">No competitors saved yet. <Link className="text-indigo-600 underline" to="/competitor-finder">Find your competitors</Link> first.</p>}
        {meta?.competitors?.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {meta.competitors.map(d => (
              <span key={d} className="inline-flex items-center gap-2 h-8 pl-3 pr-1 rounded-full bg-slate-100 text-13">
                {d}{meta.notes?.[d] && <span title={meta.notes[d]} className="text-rose-600">!</span>}
                {paid[d] ? <Badge tone="green">{paid[d].rows.length} real</Badge> : <Button size="sm" busy={busy === `rank:${d}`} onClick={() => real(d)}>Real rankings</Button>}
              </span>
            ))}
          </div>
        )}
      </Card>

      {busy === 'load' && <div className="flex items-center gap-2 text-13 text-slate-500 justify-center py-6"><Loader2 className="animate-spin" size={16} /> Reading the competitors' searches from Keyword Planner…</div>}

      {rows && (
        <Card pad={false} title={`${shown.length} keywords`} subtitle="Sorted by usefulness, then by how many competitors have it, then by searches"
          action={<Button size="sm" icon={Download} onClick={() => downloadCsv('competitor-keywords', ['Keyword', 'Verdict', 'Why', 'Competitors', 'Searches/mo', 'Position'], shown.map(r => [r.keyword, VERDICT[r.fit][0], r.why, (r.competitors || []).join(' '), r.volume ?? '', r.position ?? '']))}>CSV</Button>}>
          <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-b border-slate-100">
            {['yes', 'maybe', 'have', 'no', ''].map(k => (
              <button key={k || 'all'} type="button" aria-pressed={fit === k} onClick={() => setFit(k)} className={`h-8 px-3 rounded-full text-12.5 font-semibold cursor-pointer ${fit === k ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
                {k ? VERDICT[k][0] : 'All'} <span className="opacity-70">{k ? counts[k] || 0 : all.length}</span>
              </button>
            ))}
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search these keywords" aria-label="Search these keywords" className="ai-glass-input h-8 w-56 px-3 text-13 rounded ml-auto" />
            <Button size="sm" variant="primary" icon={Plus} busy={busy === 'send'} disabled={!shown.some(r => r.fit === 'yes')} onClick={() => send(shown.filter(r => r.fit === 'yes'))}>Send useful to workspace</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-13">
              <thead><tr className="text-12 uppercase tracking-wide text-slate-500 bg-slate-50/70">
                <th className="px-4 py-2 text-left">Keyword</th><th className="px-3 py-2 text-left">Useful for you?</th><th className="px-3 py-2 text-left">Competitors</th>
                <th className="px-3 py-2 ">Searches / mo</th><th className="px-3 py-2 ">CPC</th><th className="px-3 py-2 ">Their position</th><th className="px-3 py-2" />
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {pager.rows.map(r => (
                  <tr key={r.keyword}>
                    <td className="px-4 py-2 font-medium text-slate-900">{r.keyword}</td>
                    <td className="px-3 py-2"><Badge tone={VERDICT[r.fit][1]}>{VERDICT[r.fit][0]}</Badge> <span className="text-12 text-slate-500">{r.why}</span></td>
                    <td className="px-3 py-2 text-slate-600">{(r.competitors || []).join(', ')}</td>
                    <td className="px-3 py-2  tabular-nums">{num(r.volume)}</td>
                    <td className="px-3 py-2  tabular-nums">{r.cpc ? `$${Number(r.cpc).toFixed(2)}` : '—'}</td>
                    <td className="px-3 py-2  tabular-nums">{r.rankings?.length ? r.rankings.map(x => <a key={x.d} href={x.url} target="_blank" rel="noreferrer" title={`${x.d}: ${x.url}`} className="text-indigo-600 hover:underline ml-2">#{x.pos}</a>) : '—'}</td>
                    <td className="px-3 py-2 ">{r.fit !== 'have' && r.fit !== 'no' && <Link className="text-12.5 text-indigo-600 hover:underline" to={`/keyword-management/prepare?k=${encodeURIComponent(r.keyword)}`}>Prepare</Link>}</td>
                  </tr>
                ))}
                {!pager.rows.length && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">No keywords in this view.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3"><Pager p={pager} label="keywords" /></div>
        </Card>
      )}
      {toastNode}
    </div>
  );
}

export function CompetitorKeywordsPage() {
  return <SeoShell title="Competitor Keywords" subtitle="The keywords your competitors are about or rank for, and which of them are useful for you">{(b) => <Body key={b.id} b={b} />}</SeoShell>;
}
