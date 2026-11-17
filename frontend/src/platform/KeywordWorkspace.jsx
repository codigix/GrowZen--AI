import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, CheckCircle2, Download, EyeOff, RefreshCw, Sparkles, Star, Swords, Undo2 } from 'lucide-react';
import { Card, Button, Badge, ErrorNote, SkList, useAction, useToast } from './SeoUi';
import { api, useApi } from './seoApi';

const TAG_TONE = { gap: 'red', win: 'green', almost: 'amber', shared: 'blue', yours: 'gray', idea: 'violet' };
const TAG_SHORT = { gap: 'Gap', win: 'Win', almost: 'Almost', shared: 'Shared', yours: 'Yours only', idea: 'Idea' };
const SRC_SHORT = { website: 'Website', search_console: 'Search Console', profile: 'Profile', competitors: 'Competitor', google_ideas: 'Google', ai: 'AI' };
const SRC_TONE = { website: 'blue', search_console: 'green', profile: 'amber', competitors: 'red', google_ideas: 'gray', ai: 'violet' };
const n0 = (v) => (v == null ? '—' : v.toLocaleString('en-US'));

/** The four stages in order, each with where the project stands. */
function Stages({ d }) {
  const picked = d.totals.picked;
  const steps = [
    ['1', 'Competitors', d.competitors.done ? `${d.competitors.count} found` : 'None yet', d.competitors.done],
    ['2', 'Collect', d.totals.all ? `${d.totals.all} keywords` : 'Nothing yet', d.totals.all > 0],
    ['3', 'Compare and pick', picked ? `${picked} picked` : `${d.totals.open} to look at`, picked > 0],
    ['4', 'Use', picked ? 'Group and write' : 'After picking', false],
  ];
  return (
    <nav aria-label="Keyword steps" className="bg-white rounded-xl border border-slate-200 shadow-sm p-1.5 flex flex-wrap gap-1">
      {steps.map(([n, t, s, done]) => (
        <div key={n} className="flex-1 min-w-[150px] rounded-lg px-3 py-2 flex items-center gap-2.5">
          <span className={`w-7 h-7 rounded-full flex items-center justify-center text-12 font-bold shrink-0 ${done ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>{done ? <Check size={14} /> : n}</span>
          <span className="min-w-0"><span className="block text-13 font-semibold text-slate-800">{t}</span><span className="block text-11.5 text-slate-500 truncate">{s}</span></span>
        </div>
      ))}
    </nav>
  );
}

function SourceBadges({ sources }) {
  return (
    <div className="flex flex-wrap gap-1">
      {sources.map((s, i) => <span key={i} title={`${s.label}${s.detail ? ': ' + s.detail : ''}`}><Badge tone={SRC_TONE[s.kind] || 'gray'}>{s.kind === 'competitors' && s.label && s.label !== 'Competitor research' ? s.label : SRC_SHORT[s.kind] || s.kind}</Badge></span>)}
    </div>
  );
}

export default function KeywordWorkspace({ b, onUse }) {
  const [source, setSource] = useState('');
  const [tag, setTag] = useState('');
  const [q, setQ] = useState('');
  const [show, setShow] = useState('open');
  const [sel, setSel] = useState(() => new Set());
  const [report, setReport] = useState(null);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const qs = new URLSearchParams({ show, ...(source && { source }), ...(tag && { tag }), ...(q.trim() && { q: q.trim() }) }).toString();
  const r = useApi(`/businesses/${b.id}/keyword-workspace?${qs}`);
  const d = r.data;
  const items = d?.items || [];
  const suggested = useMemo(() => items.filter(i => i.suggested && !i.picked), [items]);
  if (r.error) return <Card><ErrorNote>{r.error.message}</ErrorNote></Card>;
  if (!d) return <SkList rows={6} />;

  const base = `/businesses/${b.id}/keyword-workspace`;
  const collect = (sources) => run(sources ? sources[0] : 'all', async () => {
    const out = await api(`${base}/collect`, { method: 'POST', body: { sources: sources || null }, timeout: 240000 });
    setReport(out.report); r.reload(true);
    toast(`${Object.values(out.report).reduce((a, x) => a + x.new, 0)} new keywords collected`);
  });
  const act = (kind, ids, msg) => run(kind, async () => { await api(`${base}/${kind}`, { method: 'POST', body: { ids } }); setSel(new Set()); r.reload(true); toast(msg); });
  const allOn = items.length > 0 && items.every(i => sel.has(i.id));
  const toggle = (id) => setSel(s => { const x = new Set(s); x.has(id) ? x.delete(id) : x.add(id); return x; });
  const ids = [...sel];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <Stages d={d} />

      <Card title="1 · Competitors" subtitle="Their keywords are only as good as the list of competitors. Confirm it first.">
        {d.competitors.done ? (
          <div className="flex flex-wrap items-center gap-2 text-13">
            <Swords size={15} className="text-slate-400" />{d.competitors.domains.map(x => <Badge key={x} tone="gray">{x}</Badge>)}
            <Link to="/competitor-finder" className="ml-auto text-12.5 font-semibold text-indigo-700 hover:underline">Change competitors</Link>
          </div>
        ) : (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-13 text-amber-900 flex flex-wrap items-center gap-3">
            <span className="flex-1 min-w-[220px]">No competitors saved yet. You can still collect from your own places, but the Gap tag and competitor keywords need competitors.</span>
            <Link to="/competitor-finder"><Button size="sm" variant="primary" icon={ArrowRight}>Find competitors</Button></Link>
          </div>
        )}
      </Card>

      <Card title="2 · Collect keywords" subtitle="Each place adds to one list. Run them all, or one at a time. A keyword found in several places stays one row with every source."
        action={<Button size="sm" variant="primary" icon={RefreshCw} busy={busy === 'all'} onClick={() => collect(null)}>Collect from all</Button>}>
        <ErrorNote>{error}</ErrorNote>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {d.sources.map(s => { const rep = report?.[s.kind]; return (
            <div key={s.kind} className="rounded-lg ring-1 ring-inset ring-slate-200 p-3 flex flex-col gap-1.5">
              <div className="flex items-center gap-2"><Badge tone={SRC_TONE[s.kind]}>{SRC_SHORT[s.kind]}</Badge><span className="text-13 font-semibold text-slate-900 truncate">{s.label}</span></div>
              <div className="text-12 text-slate-500">{s.count ? `${s.count} keyword${s.count === 1 ? '' : 's'} in the list` : 'Not collected yet'}</div>
              {rep && <div className={`text-12 ${rep.note ? 'text-amber-700' : 'text-emerald-700'}`}>{rep.note ? rep.note : `${rep.found} found, ${rep.new} new`}</div>}
              <div className="mt-auto pt-1"><Button size="sm" busy={busy === s.kind} onClick={() => collect([s.kind])}>{s.count ? 'Refresh' : 'Collect'}</Button></div>
            </div>); })}
        </div>
        {!d.volumes && <p className="mt-3 text-12 text-slate-500">Google Ads is not connected, so there are no search volumes. Keywords are ordered by where they were found.</p>}
      </Card>

      <Card title="3 · Compare and pick" subtitle={`${d.totals.open} to look at · ${d.totals.picked} picked · ${d.totals.dismissed} set aside`}
        action={<Button size="sm" icon={Download} onClick={() => exportCsv(items)} disabled={!items.length}>Export CSV</Button>}>
        <div className="flex flex-wrap gap-1.5 mb-3" role="tablist" aria-label="Where it came from">
          <Pill on={!source} onClick={() => setSource('')}>All places</Pill>
          {d.sources.filter(s => s.count).map(s => <Pill key={s.kind} on={source === s.kind} onClick={() => setSource(source === s.kind ? '' : s.kind)}>{SRC_SHORT[s.kind]} ({s.count})</Pill>)}
        </div>
        <div className="flex flex-wrap gap-1.5 mb-3" role="tablist" aria-label="Kind of keyword">
          <Pill on={!tag} onClick={() => setTag('')}>Every kind</Pill>
          {d.tags.filter(t => t.count).map(t => <span key={t.tag} title={t.label}><Pill on={tag === t.tag} onClick={() => setTag(tag === t.tag ? '' : t.tag)}>{TAG_SHORT[t.tag]} ({t.count})</Pill></span>)}
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search the list" aria-label="Search the list" className="h-9 px-3 text-13 rounded-lg ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none min-w-[200px]" />
          <select value={show} onChange={e => setShow(e.target.value)} aria-label="Show" className="h-9 px-2 text-13 rounded-lg ring-1 ring-inset ring-slate-300 bg-white">
            <option value="open">To look at</option><option value="picked">Picked</option><option value="dismissed">Set aside</option><option value="all">All</option>
          </select>
          <span className="ml-auto flex flex-wrap gap-2">
            {show === 'dismissed' ? <Button size="sm" icon={Undo2} disabled={!ids.length} onClick={() => act('restore', ids, 'Put back in the list')}>Put back</Button>
              : <Button size="sm" icon={EyeOff} disabled={!ids.length} busy={busy === 'dismiss'} onClick={() => act('dismiss', ids, `${ids.length} set aside`)}>Set aside</Button>}
            <Button size="sm" icon={Star} disabled={!suggested.length} busy={busy === 'pick'} onClick={() => act('pick', suggested.map(i => i.id), `${suggested.length} suggested keywords saved`)} title="The best-looking keywords: searches, ease, gaps and how many places agree">Pick suggested ({suggested.length})</Button>
            <Button size="sm" variant="primary" icon={CheckCircle2} disabled={!ids.length} busy={busy === 'pick'} onClick={() => act('pick', ids, `${ids.length} keywords saved to your list`)}>Pick selected ({ids.length})</Button>
          </span>
        </div>

        {items.length === 0 ? (
          <div className="py-10 text-center text-13 text-slate-500">{d.totals.all ? 'Nothing matches these filters.' : 'Nothing collected yet. Press "Collect from all" above.'}</div>
        ) : (
          <div className="overflow-x-auto rounded-lg ring-1 ring-inset ring-slate-200">
            <table className="w-full text-13">
              <thead className="bg-slate-50 text-11.5 uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-9 px-3 py-2"><input type="checkbox" aria-label="Select all" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(items.map(i => i.id)))} /></th>
                  <th className="px-3 py-2 text-left">Keyword</th><th className="px-3 py-2 text-left">Where it came from</th><th className="px-3 py-2 text-right">Searches / mo</th>
                  <th className="px-3 py-2 text-right">Difficulty</th><th className="px-3 py-2 text-right">Your rank</th><th className="px-3 py-2 text-left">Kind</th><th className="px-3 py-2 text-right">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map(i => (
                  <tr key={i.id} className={sel.has(i.id) ? 'bg-indigo-50/50' : ''}>
                    <td className="px-3 py-2"><input type="checkbox" aria-label={`Select ${i.keyword}`} checked={sel.has(i.id)} onChange={() => toggle(i.id)} /></td>
                    <td className="px-3 py-2 min-w-[180px]">
                      <span className="font-semibold text-slate-900">{i.keyword}</span>{i.picked && <span className="ml-2"><Badge tone="green">Picked</Badge></span>}
                      {i.variants.length > 0 && <span className="block text-11.5 text-slate-400" title="Written differently in other places, merged into this one">also: {i.variants.slice(0, 3).join(', ')}</span>}
                      {i.competitors.length > 0 && <span className="block text-11.5 text-slate-500">used by {i.competitors.slice(0, 3).join(', ')}</span>}
                    </td>
                    <td className="px-3 py-2"><SourceBadges sources={i.sources} /></td>
                    <td className="px-3 py-2 text-right tabular-nums">{n0(i.volume)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{i.difficulty ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{i.rank != null ? i.rank.toFixed(1) : '—'}</td>
                    <td className="px-3 py-2"><Badge tone={TAG_TONE[i.tag]}>{TAG_SHORT[i.tag]}</Badge></td>
                    <td className="px-3 py-2 text-right tabular-nums"><span className="inline-flex items-center gap-1">{i.suggested && <Sparkles size={12} className="text-amber-500" aria-label="Suggested" />}{i.score}</span></td>
                  </tr>))}
              </tbody>
            </table>
          </div>
        )}
        {d.shown > items.length && <p className="mt-2 text-12 text-slate-500">Showing the first {items.length} of {d.shown}. Use the filters to narrow the list.</p>}
        <p className="mt-3 text-12 text-slate-500">Kinds: <b>Gap</b> competitors use it and you do not · <b>Win</b> you are in the top 3 · <b>Almost</b> you are on page 2 · <b>Shared</b> you both use it · <b>Yours only</b> only you · <b>Idea</b> from Google or AI. The score is a suggestion, not a rule.</p>
      </Card>

      <Card title="4 · Use the picked keywords" subtitle="Group them into topics, give each topic a page, then write the blog posts and track the rank.">
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={ArrowRight} onClick={() => onUse('topics')} disabled={!d.totals.picked}>Group into topics</Button>
          <Button onClick={() => onUse('tracked')} disabled={!d.totals.picked}>My saved keywords</Button>
          <Link to="/ai-content-generation/blog"><Button icon={ArrowRight}>Write a blog post</Button></Link>
          <Link to="/rank-tracking/landscape"><Button icon={ArrowRight}>Track the rank</Button></Link>
        </div>
        {!d.totals.picked && <p className="mt-2 text-12 text-slate-500">Pick at least one keyword above to start.</p>}
      </Card>
      {toastNode}
    </div>
  );
}

function Pill({ on, onClick, children }) {
  return <button type="button" role="tab" aria-selected={on} onClick={onClick} className={`h-8 px-3.5 rounded-full text-12.5 font-semibold cursor-pointer ring-1 ring-inset ${on ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}>{children}</button>;
}

function exportCsv(items) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Keyword', 'Searches per month', 'Difficulty', 'Your rank', 'Kind', 'Score', 'Sources', 'Competitors'], ...items.map(i => [i.keyword, i.volume, i.difficulty, i.rank, i.tag, i.score, i.sources.map(s => s.label).join('; '), i.competitors.join('; ')])];
  const blob = new Blob([rows.map(r => r.map(cell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'keywords.csv'; a.click(); URL.revokeObjectURL(a.href);
}
