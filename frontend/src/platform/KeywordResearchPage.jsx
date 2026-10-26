import React, { useState } from 'react';
import { Search, Plus, Sparkles, FileText, Trash2, Loader2 } from 'lucide-react';
import { SeoShell, Card, Tabs, Stat, Badge, Button, inputCls, Meter, SourceTag, ErrorNote, useToast, useAction } from './SeoUi';
import { api, useApi } from './seoApi';

const INTENT_TONE = { local: 'blue', transactional: 'green', commercial: 'orange', informational: 'violet' };
const kd = (d) => (d == null ? ['—', 'gray'] : d < 30 ? ['Easy', 'green'] : d < 55 ? ['Medium', 'amber'] : ['Hard', 'red']);
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN'));

function Keywords({ b, tab }) {
  const kw = useApi(`/businesses/${b.id}/keywords`);
  const [seed, setSeed] = useState(b.seeds[0] || '');
  const [location, setLocation] = useState([b.area, b.city].filter(Boolean).join(', '));
  const [ideas, setIdeas] = useState(null);
  const [selected, setSelected] = useState([]);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const tracked = kw.data?.keywords || [];

  const find = () => run('find', async () => { const r = await api(`/businesses/${b.id}/keywords/ideas`, { method: 'POST', body: { seed, location } }); setIdeas(r); setSelected([]); });
  const track = () => run('track', async () => {
    const rows = ideas.ideas.filter(i => selected.includes(i.keyword)).map(i => ({ keyword: i.keyword, volume: i.volume, difficulty: i.difficulty, cpc: i.cpc, intent: i.intent }));
    const r = await api(`/businesses/${b.id}/keywords`, { method: 'POST', body: rows });
    setSelected([]); kw.reload(true); toast(`${r.added} keyword${r.added === 1 ? '' : 's'} added to tracking`);
  });
  const cluster = () => run('cluster', async () => { const r = await api(`/businesses/${b.id}/keywords/cluster`, { method: 'POST' }); kw.reload(true); toast(`${r.updated} keywords grouped into topics`); });
  const update = (k, patch) => run(`u${k.id}`, async () => {
    const out = await api(`/businesses/${b.id}/keywords/${k.id}`, { method: 'PATCH', body: { keyword: k.keyword, ...patch } });
    kw.setData(d => ({ ...d, keywords: d.keywords.map(x => x.id === k.id ? out : x) }));
  });
  const remove = (k) => run(`d${k.id}`, async () => { await api(`/businesses/${b.id}/keywords/${k.id}`, { method: 'DELETE' }); kw.reload(true); });
  const pages = [...new Set(['/', '/services', '/contact', ...(b.services || []).map(s => `/services/${String(s.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')}`), ...tracked.map(k => k.target_url).filter(Boolean)])];

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="Tracked keywords" value={tracked.length} />
        <Stat label="Monthly searches (tracked)" value={fmt(tracked.reduce((s, k) => s + (k.volume || 0), 0))} />
        <Stat label="Ranking top 10" value={tracked.filter(k => k.rank && k.rank <= 10).length} hint={`of ${tracked.length}`} />
        <Stat label="Mapped to a page" value={`${tracked.filter(k => k.target_url).length}/${tracked.length}`} />
      </div>
      <ErrorNote>{error}</ErrorNote>

      {tab === 'research' && (
        <Card>
          <div className="flex flex-wrap items-end gap-2 mb-3 pt-2">
            <label className="text-[12px] text-gray-600 flex-1 min-w-[220px]">Seed keyword<input className={`${inputCls} mt-1`} value={seed} onChange={e => setSeed(e.target.value)} onKeyDown={e => e.key === 'Enter' && seed.trim() && find()} /></label>
            <label className="text-[12px] text-gray-600 w-56">Location<input className={`${inputCls} mt-1`} value={location} onChange={e => setLocation(e.target.value)} /></label>
            <Button variant="primary" icon={Search} busy={busy === 'find'} disabled={!seed.trim()} onClick={find}>Find ideas</Button>
            {ideas && <SourceTag source={ideas.data_source} />}
            <Button className="ml-auto" variant="primary" icon={Plus} disabled={!selected.length} busy={busy === 'track'} onClick={track}>Track {selected.length || ''}</Button>
          </div>
          {!ideas ? <div className="py-10 text-center text-[13px] text-gray-500">Enter a seed keyword to get ideas with volume, difficulty and intent.</div> : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="text-[12px] text-gray-500 border-b border-gray-200"><tr>
                  <th className="p-2 w-8"><input type="checkbox" checked={ideas.ideas.length > 0 && ideas.ideas.every(i => selected.includes(i.keyword))} onChange={e => setSelected(e.target.checked ? ideas.ideas.map(i => i.keyword) : [])} aria-label="Select all" /></th>
                  <th className="p-2 text-left font-medium">Keyword</th><th className="p-2 text-left font-medium">Intent</th><th className="p-2 text-right font-medium">Volume / mo</th><th className="p-2 text-left font-medium">Difficulty</th><th className="p-2 text-right font-medium">CPC</th><th className="p-2 text-left font-medium" />
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {ideas.ideas.map(i => {
                    const [l, t] = kd(i.difficulty);
                    const already = tracked.some(k => k.keyword === i.keyword.toLowerCase());
                    return (
                      <tr key={i.keyword} className={selected.includes(i.keyword) ? 'bg-blue-50/50' : ''}>
                        <td className="p-2"><input type="checkbox" disabled={already} checked={selected.includes(i.keyword)} onChange={() => setSelected(s => s.includes(i.keyword) ? s.filter(x => x !== i.keyword) : [...s, i.keyword])} aria-label={`Select ${i.keyword}`} /></td>
                        <td className="p-2 text-gray-900">{i.keyword}</td>
                        <td className="p-2"><Badge tone={INTENT_TONE[i.intent] || 'gray'}>{i.intent}</Badge></td>
                        <td className="p-2 text-right tabular-nums">{fmt(i.volume)}</td>
                        <td className="p-2"><span className="tabular-nums mr-2">{i.difficulty ?? '—'}</span><Badge tone={t}>{l}</Badge></td>
                        <td className="p-2 text-right tabular-nums text-gray-600">{i.cpc != null ? `₹${i.cpc}` : '—'}</td>
                        <td className="p-2 text-[11px] text-gray-500">{already ? 'tracked' : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'clusters' && (
        <>
          <div className="flex justify-end mb-3"><Button variant="ai" icon={Sparkles} busy={busy === 'cluster'} disabled={!tracked.length} onClick={cluster}>Group into topics with AI</Button></div>
          {!kw.data ? <div className="py-10 flex justify-center text-gray-400"><Loader2 size={16} className="animate-spin" /></div> : kw.data.clusters.length === 0 ? <Card><div className="py-10 text-center text-[13px] text-gray-500">Track some keywords first.</div></Card> : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {kw.data.clusters.map(c => {
                const list = tracked.filter(k => (k.cluster || 'Not grouped') === c.name);
                const page = list.find(k => k.target_url)?.target_url;
                return (
                  <Card key={c.name} title={c.name} subtitle={`${c.keywords} keywords · ${fmt(c.volume)} searches / month`}>
                    <div className="space-y-1.5">{list.slice(0, 8).map(k => <div key={k.id} className="flex items-center gap-2 text-[12px]"><span className="flex-1 truncate text-gray-800">{k.keyword}</span><span className="tabular-nums text-gray-500 w-12 text-right">{fmt(k.volume)}</span></div>)}</div>
                    <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2 text-[12px]"><FileText size={13} className="text-gray-400" />{page ? <span className="font-mono text-gray-700 truncate">{page}</span> : <span className="text-amber-700">No page yet</span>}</div>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === 'mapping' && (
        <Card title="Tracked keywords and their pages" subtitle="Each topic gets one page, so your pages don't compete with each other">
          {!kw.data ? <div className="py-10 flex justify-center text-gray-400"><Loader2 size={16} className="animate-spin" /></div> : tracked.length === 0 ? <div className="py-10 text-center text-[13px] text-gray-500">No tracked keywords yet.</div> : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="text-[12px] text-gray-500 border-b border-gray-200"><tr><th className="p-2 text-left font-medium">Keyword</th><th className="p-2 text-right font-medium">Volume</th><th className="p-2 text-left font-medium">Target page</th><th className="p-2 text-right font-medium">Rank</th><th className="p-2 text-left font-medium">Priority</th><th className="p-2" /></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {tracked.map(k => (
                    <tr key={k.id}>
                      <td className="p-2 text-gray-900">{k.keyword}<div>{k.intent && <Badge tone={INTENT_TONE[k.intent] || 'gray'}>{k.intent}</Badge>}</div></td>
                      <td className="p-2 text-right tabular-nums">{fmt(k.volume)}</td>
                      <td className="p-2">
                        <input list={`pages-${b.id}`} className={`${inputCls} max-w-[260px] ${!k.target_url ? 'border-amber-400' : ''}`} defaultValue={k.target_url || ''} placeholder="— not mapped —" onBlur={e => e.target.value !== (k.target_url || '') && update(k, { target_url: e.target.value || null })} />
                      </td>
                      <td className="p-2 text-right tabular-nums">{k.rank ?? <span className="text-gray-400">—</span>}{k.rank && k.prev_rank && k.prev_rank !== k.rank && <span className={`ml-1 text-[11px] ${k.prev_rank > k.rank ? 'text-[#006300]' : 'text-[#d03b3b]'}`}>{k.prev_rank > k.rank ? '▲' : '▼'}{Math.abs(k.prev_rank - k.rank)}</span>}</td>
                      <td className="p-2"><select className="h-7 px-1.5 text-xs border border-gray-300 rounded bg-white" value={k.priority} onChange={e => update(k, { priority: e.target.value })}>{['High', 'Medium', 'Low'].map(p => <option key={p}>{p}</option>)}</select></td>
                      <td className="p-2 text-right"><button onClick={() => remove(k)} className="text-gray-400 hover:text-red-600 cursor-pointer" aria-label="Remove"><Trash2 size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <datalist id={`pages-${b.id}`}>{pages.map(p => <option key={p} value={p} />)}</datalist>
              <div className="mt-3 flex items-center gap-3 text-[12px] text-gray-600">{tracked.filter(k => k.target_url).length} of {tracked.length} mapped <div className="w-40"><Meter value={tracked.filter(k => k.target_url).length} max={tracked.length} /></div></div>
            </div>
          )}
        </Card>
      )}
      {toastNode}
    </>
  );
}

export default function KeywordResearchPage() {
  const [tab, setTab] = useState('research');
  return (
    <SeoShell title="Keyword research" subtitle="What customers search for: volume, difficulty, intent and local variants, grouped into topics">
      {(b) => (
        <>
          <Tabs value={tab} onChange={setTab} tabs={[{ id: 'research', label: 'Keyword ideas' }, { id: 'clusters', label: 'Topic clusters' }, { id: 'mapping', label: 'Tracked & page mapping' }]} />
          <Keywords key={b.id} b={b} tab={tab} />
        </>
      )}
    </SeoShell>
  );
}
