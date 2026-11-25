import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, Download, Layers, Loader2, Plus, Save, X } from 'lucide-react';
import { SeoShell, Card, Button, Badge, ErrorNote, useAction, useToast } from './SeoUi';
import { usePager, Pager, downloadCsv } from './DataTable';
import { api } from './seoApi';

const kfmt = (n) => (n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K` : String(Math.round(n)));
const INTENT = { informational: ['I', '#4338ca', '#e0e7ff', 'Informational'], commercial: ['C', '#b45309', '#fef3c7', 'Commercial'], transactional: ['T', '#047857', '#d1fae5', 'Transactional'], navigational: ['N', '#9d174d', '#fce7f3', 'Navigational'] };
const Tag = ({ v }) => { const m = INTENT[v]; return m ? <span title={m[3]} className="inline-flex items-center justify-center w-5 h-5 rounded text-11 font-bold" style={{ color: m[1], background: m[2] }}>{m[0]}</span> : <span className="text-slate-300">—</span>; };
const idxColor = (v) => (v < 34 ? '#059669' : v < 67 ? '#d97706' : '#dc2626');
const PRESETS = [['best', 'Best for Strategy', 'Per topic: the pillar and up to 3 pages with the most searches that are not too competitive'], ['quick', 'Quick Conversions', 'Pages whose keywords show buying or comparing intent'], ['traffic', 'More Potential Traffic', 'The 30 pages with the most searches'], ['all', 'All Pages', 'The full content plan']];

/** The plan as flat pages: each topic's pillar and subpages with their keywords. */
function pagesOf(topics) {
  const out = [];
  topics.forEach(t => {
    out.push({ id: `${t.topic}|pillar`, topic: t.topic, role: 'Pillar page', lead: t.pillar.keyword, volume: t.pillar.volume, index: t.pillar.index, intent: t.pillar.intent, keywords: [{ keyword: t.pillar.keyword, volume: t.pillar.volume, index: t.pillar.index, intent: t.pillar.intent }, ...t.pillar.keywords] });
    t.pages.forEach(p => out.push({ id: `${t.topic}|${p.lead}`, topic: t.topic, role: 'Subpage', lead: p.lead, volume: p.volume, index: p.keywords[0]?.index, intent: p.keywords[0]?.intent, keywords: p.keywords }));
  });
  return out;
}
const pick = (pages, preset) => {
  if (preset === 'all') return pages;
  if (preset === 'quick') return pages.filter(p => p.keywords.some(k => k.intent === 'transactional' || k.intent === 'commercial'));
  if (preset === 'traffic') return [...pages].sort((a, c) => (c.volume || 0) - (a.volume || 0)).slice(0, 30);
  const keep = new Set();
  const by = {};
  pages.forEach(p => (by[p.topic] ||= []).push(p));
  Object.values(by).forEach(l => { l.filter(p => p.role === 'Pillar page').forEach(p => keep.add(p.id)); l.filter(p => p.role !== 'Pillar page' && (p.index == null || p.index < 67)).sort((a, c) => (c.volume || 0) - (a.volume || 0)).slice(0, 3).forEach(p => keep.add(p.id)); });
  return pages.filter(p => keep.has(p.id));
};

function Body({ b }) {
  const [params, setParams] = useSearchParams();
  const seeds = useMemo(() => (params.get('s') || '').split('|').filter(Boolean).slice(0, 5), [params]);
  const [typed, setTyped] = useState('');
  const [data, setData] = useState(null);
  const [preset, setPreset] = useState('best');
  const [view, setView] = useState('plan');
  const [open, setOpen] = useState(() => new Set());
  const [sel, setSel] = useState(() => new Set());
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();

  const create = (list) => run('build', async () => {
    setData(null); setSel(new Set());
    const r = await api(`/businesses/${b.id}/keyword-workspace/strategy`, { method: 'POST', body: { seeds: list }, timeout: 180000 });
    setData(r);
    if (r.state === 'ok') setOpen(new Set(r.topics.slice(0, 2).map(t => t.topic)));
  });
  const addSeed = () => { const l = [...new Set([...seeds, ...typed.split(/[,\n|]/).map(x => x.trim().toLowerCase()).filter(Boolean)])].slice(0, 5); setTyped(''); setParams({ s: l.join('|') }); };
  const dropSeed = (s) => setParams({ s: seeds.filter(x => x !== s).join('|') });

  const all = useMemo(() => (data?.state === 'ok' ? pagesOf(data.topics) : []), [data]);
  const shown = useMemo(() => pick(all, preset), [all, preset]);
  const shownIds = new Set(shown.map(p => p.id));
  const topics = (data?.topics || []).filter(t => shown.some(p => p.topic === t.topic));
  const flat = useMemo(() => shown.flatMap(p => p.keywords.map(k => ({ ...k, page: p.lead, topic: p.topic, role: p.role }))), [shown]);
  const pager = usePager(flat, { size: 50, resetKey: `${preset}|${view}|${data?.seeds?.join()}` });
  const chosenPages = shown.filter(p => sel.has(p.id));
  const chosenKeywords = (chosenPages.length ? chosenPages : []).flatMap(p => p.keywords.map(k => ({ ...k, role: p.role, lead: p.lead })));
  const toggleOpen = (t) => setOpen(s => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n; });
  const toggleSel = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const save = () => run('save', async () => {
    const body = [...new Map(chosenKeywords.map(k => [k.keyword, { keyword: k.keyword, volume: k.volume ?? undefined, cpc: k.cpc ?? undefined, role: k.keyword === k.lead && k.role === 'Pillar page' ? 'primary' : 'secondary', priority: k.role === 'Pillar page' ? 'High' : 'Medium', source: { type: 'strategy_builder' } }])).values()].slice(0, 300);
    const r = await api(`/businesses/${b.id}/keywords`, { method: 'POST', body });
    toast(`${r.added} new keyword${r.added === 1 ? '' : 's'} added to My Keywords`);
  });

  return (
    <div className="space-y-4">
      <Card title="1 · Seed keywords" subtitle="Up to 5 broad keywords for what you sell. Google Keyword Planner's ideas for them become topics, each with a pillar page and subpages.">
        <div className="flex flex-wrap items-center gap-2">
          {seeds.map(s => <span key={s} className="inline-flex items-center gap-1 h-8 pl-3 pr-1.5 rounded-full bg-indigo-50 text-indigo-700 text-13 font-medium">{s}<button type="button" aria-label={`Remove ${s}`} onClick={() => dropSeed(s)} className="h-5 w-5 rounded-full hover:bg-indigo-100 inline-flex items-center justify-center cursor-pointer"><X size={12} /></button></span>)}
          {seeds.length < 5 && (
            <form onSubmit={e => { e.preventDefault(); addSeed(); }} className="inline-flex items-center gap-2">
              <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="Add a seed, e.g. digital marketing" aria-label="Add a seed keyword" className="ai-glass-input h-8 w-64 px-3 text-13 rounded" />
              <Button size="sm" icon={Plus} type="submit" disabled={!typed.trim()}>Add</Button>
            </form>
          )}
          <Button variant="primary" icon={Layers} busy={busy === 'build'} disabled={!seeds.length} onClick={() => create(seeds)} className="ml-auto">{data ? 'Rebuild the plan' : 'Create strategy'}</Button>
        </div>
        {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      </Card>

      {busy === 'build' && <div className="flex items-center justify-center gap-2 py-12 text-13 text-slate-500"><Loader2 className="animate-spin" size={16} />Reading Keyword Planner and structuring the keywords into topics…</div>}
      {data?.state === 'error' && <ErrorNote>{data.message}</ErrorNote>}

      {data?.state === 'ok' && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[['Topics', data.topics.length], ['Pages in the plan', all.length], ['Keywords analysed', data.analysed], ['Search volume', kfmt(data.topics.reduce((a, t) => a + t.volume, 0))]].map(([l, v]) => <div key={l} className="rounded-xl bg-white ring-1 ring-slate-200 px-4 py-3"><div className="text-12 text-slate-500">{l}</div><div className="text-24 font-bold tabular-nums text-slate-900">{v}</div></div>)}
          </div>
          {data.dropped > 0 && <p className="text-12.5 text-slate-500">{data.dropped} idea{data.dropped === 1 ? '' : 's'} left out because they do not fit what the business sells.</p>}

          <div className="rounded-xl bg-white ring-1 ring-slate-200">
            <div className="px-4 pt-4 flex flex-wrap items-center gap-2">
              <span className="text-13 font-semibold text-slate-700 mr-1">Filter</span>
              {PRESETS.map(([k, l, tip]) => <button key={k} type="button" title={tip} aria-pressed={preset === k} onClick={() => setPreset(k)} className={`h-8 px-3 rounded-full text-12.5 font-semibold cursor-pointer ${preset === k ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>{l}</button>)}
              <span className="text-12.5 text-slate-500">{shown.length} page{shown.length === 1 ? '' : 's'}</span>
            </div>
            <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-b border-slate-100">
              <div className="inline-flex rounded ring-1 ring-inset ring-slate-300 overflow-hidden">{[['plan', 'Topics and pages'], ['table', 'Table']].map(([k, l]) => <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)} className={`px-3 h-8 text-13 cursor-pointer ${view === k ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-600'}`}>{l}</button>)}</div>
              <div className="ml-auto flex flex-wrap gap-2">
                <Button size="sm" icon={Save} variant="primary" busy={busy === 'save'} disabled={!chosenPages.length} onClick={save}>{chosenPages.length ? `Add ${chosenKeywords.length} keywords to My Keywords` : 'Select pages to add'}</Button>
                <Button size="sm" icon={Download} onClick={() => downloadCsv('keyword-strategy', ['Topic', 'Page', 'Role', 'Keyword', 'Volume', 'Index', 'Intent'], flat.map(r => [r.topic, r.page, r.role, r.keyword, r.volume ?? '', r.index ?? '', r.intent ?? '']))}>Export</Button>
              </div>
            </div>

            {view === 'plan' ? (
              <div className="divide-y divide-slate-100">
                {topics.map(t => {
                  const pages = shown.filter(p => p.topic === t.topic);
                  const isOpen = open.has(t.topic);
                  return (
                    <div key={t.topic}>
                      <button type="button" onClick={() => toggleOpen(t.topic)} aria-expanded={isOpen} className="w-full px-4 py-3 flex items-center gap-3 text-left cursor-pointer hover:bg-slate-50">
                        {isOpen ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                        <span className="font-semibold text-slate-900 capitalize">{t.topic}</span>
                        <span className="text-12.5 text-slate-500">{pages.length} page{pages.length === 1 ? '' : 's'} · {kfmt(t.volume)} searches a month</span>
                      </button>
                      {isOpen && (
                        <table className="w-full text-13">
                          <thead className="text-12 text-slate-500 bg-slate-50/60"><tr><th className="px-4 py-2 w-8" /><th className="px-3 py-2 text-left">Page</th><th className="px-3 py-2 text-left">Keywords it targets</th><th className="px-3 py-2 text-right">Volume</th><th className="px-3 py-2 text-right">Index</th><th className="px-3 py-2 text-center">Intent</th><th className="px-3 py-2" /></tr></thead>
                          <tbody className="divide-y divide-slate-100">
                            {pages.map(p => (
                              <tr key={p.id} className={sel.has(p.id) ? 'bg-indigo-50/50' : ''}>
                                <td className="px-4 py-2 align-top"><input type="checkbox" aria-label={`Select ${p.lead}`} checked={sel.has(p.id)} onChange={() => toggleSel(p.id)} className="accent-indigo-600" /></td>
                                <td className="px-3 py-2 align-top"><div className="font-medium text-slate-900">{p.lead}</div><Badge tone={p.role === 'Pillar page' ? 'blue' : 'gray'}>{p.role}</Badge></td>
                                <td className="px-3 py-2 text-slate-600"><div className="flex flex-wrap gap-1.5">{p.keywords.slice(0, 6).map(k => <span key={k.keyword} className="px-2 py-0.5 rounded-full bg-slate-100 text-12" title={`${kfmt(k.volume)} searches a month`}>{k.keyword}</span>)}{p.keywords.length > 6 && <span className="text-12 text-slate-400 self-center">+{p.keywords.length - 6}</span>}</div></td>
                                <td className="px-3 py-2 text-right tabular-nums align-top">{kfmt(p.volume)}</td>
                                <td className="px-3 py-2 text-right tabular-nums align-top">{p.index != null ? <span className="inline-flex items-center gap-1.5">{p.index}<span className="w-2.5 h-2.5 rounded-full" style={{ background: idxColor(p.index) }} /></span> : '—'}</td>
                                <td className="px-3 py-2 text-center align-top"><Tag v={p.intent} /></td>
                                <td className="px-3 py-2 text-right align-top"><Link className="text-12.5 text-indigo-600 hover:underline" to={`/keyword-management/prepare?k=${encodeURIComponent(p.lead)}`}>Prepare</Link></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                })}
                {!topics.length && <div className="px-4 py-10 text-center text-slate-500">No pages match this filter.</div>}
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-13">
                    <thead className="text-12 text-slate-500 bg-slate-50/60"><tr><th className="px-4 py-2.5 text-left">Keyword</th><th className="px-3 py-2.5 text-left">Page</th><th className="px-3 py-2.5 text-left">Topic</th><th className="px-3 py-2.5 text-right">Volume</th><th className="px-3 py-2.5 text-right">Index</th><th className="px-3 py-2.5 text-center">Intent</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">{pager.rows.map(r => <tr key={`${r.page}|${r.keyword}`}><td className="px-4 py-2 font-medium text-slate-900">{r.keyword}</td><td className="px-3 py-2 text-slate-600">{r.page}</td><td className="px-3 py-2 text-slate-500 capitalize">{r.topic}</td><td className="px-3 py-2 text-right tabular-nums">{kfmt(r.volume)}</td><td className="px-3 py-2 text-right tabular-nums">{r.index ?? '—'}</td><td className="px-3 py-2 text-center"><Tag v={r.intent} /></td></tr>)}</tbody>
                  </table>
                </div>
                <div className="border-t border-slate-100"><Pager p={pager} label="keywords" /></div>
              </>
            )}
          </div>
        </>
      )}
      {!data && !busy && !error && <Card><p className="text-13 text-slate-500 text-center py-6">Add up to 5 seed keywords and press Create strategy. It works best for a new content plan. For the keywords you already saved, open <Link className="text-indigo-600 underline" to="/keyword-management/topics">Keyword Topics</Link>.</p></Card>}
      {toastNode}
    </div>
  );
}

export function KeywordStrategyBuilderPage() {
  return <SeoShell title="Keyword Strategy Builder" subtitle="From a few seed keywords to a content plan: topics, a pillar page and subpages for each, and the keywords every page should target">{(b) => <Body key={b.id} b={b} />}</SeoShell>;
}
