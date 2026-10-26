import React, { useEffect, useMemo, useState } from 'react';
import { Play, Plus, Check, Minus, Trash2, Info, Copy, Loader2 } from 'lucide-react';
import { SeoShell, Card, Tabs, Stat, Badge, Button, inputCls, Meter, SourceTag, ErrorNote, SERIES, useToast, useAction } from './SeoUi';
import { api, useApi, usePoll, fmtDateTime } from './seoApi';

function Geo({ b, tab }) {
  const geo = useApi(`/businesses/${b.id}/geo`);
  const [prompt, setPrompt] = useState('');
  const [waiting, setWaiting] = useState(null); // results count when a run started
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const d = geo.data;
  const results = useMemo(() => d?.results || [], [d]);
  usePoll(() => geo.reload(true), waiting !== null, 4000);
  useEffect(() => { if (waiting !== null && results.length && results.some(r => r.created_at > waiting)) { setWaiting(null); toast('AI engines checked'); } }, [waiting, results, toast]);
  const engines = useMemo(() => [...new Set(results.map(r => r.engine))], [results]);
  const byPrompt = useMemo(() => {
    const m = {};
    results.forEach(r => { (m[r.prompt_id] = m[r.prompt_id] || {})[r.engine] = r; });
    return m;
  }, [results]);
  const competitors = useMemo(() => {
    const c = {};
    results.forEach(r => (r.competitors || []).forEach(x => { c[x] = (c[x] || 0) + 1; }));
    return Object.entries(c).sort((a, x) => x[1] - a[1]).slice(0, 8);
  }, [results]);

  const add = () => run('add', async () => { await api(`/businesses/${b.id}/geo/prompts`, { method: 'POST', body: { prompt } }); setPrompt(''); geo.reload(true); });
  const del = (id) => run(`d${id}`, async () => { await api(`/businesses/${b.id}/geo/prompts/${id}`, { method: 'DELETE' }); geo.reload(true); });
  const runNow = () => run('run', async () => { await api(`/businesses/${b.id}/geo/run`, { method: 'POST' }); setWaiting(new Date(Date.now() - 2000).toISOString()); toast('Asking the AI engines… this takes a minute'); });
  const llms = `# ${b.name}\n> ${b.primaryCategory || 'Business'} in ${[b.area, b.city].filter(Boolean).join(', ')}.\n\n## Services\n${(b.services || []).filter(s => s.name).map(s => `- ${s.name}${s.price ? `: ${s.price}` : ''}`).join('\n') || '- [add services]'}\n\n## Contact\n- Phone: ${b.phone || '[add]'}\n- Address: ${b.address || 'Service-area business'}\n- Website: ${b.website || '[add]'}`;

  if (!d) return geo.error ? <ErrorNote>{geo.error.message}</ErrorNote> : <div className="py-16 flex justify-center text-gray-400"><Loader2 size={16} className="animate-spin" /></div>;
  const sov = d.share_of_voice;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2 p-3 bg-blue-50/60 border border-blue-100 rounded text-[12px] text-gray-700">
        <Info size={14} className="text-blue-600 shrink-0" />
        <span className="flex-1">Each prompt is asked to every connected AI engine (OpenAI, Gemini, Perplexity, Claude, DeepSeek). API answers can differ from logged-in apps: read as a trend.</span>
        <SourceTag source={sov.data_source} />
        <Button variant="primary" icon={Play} busy={busy === 'run' || waiting !== null} onClick={runNow}>{waiting !== null ? 'Checking…' : 'Run now'}</Button>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
        <Stat label="AI share of voice" value={sov.data_source ? `${sov.overall}%` : '—'} hint="of prompts name you" />
        {engines.map(e => <Stat key={e} label={e} value={`${sov.per_engine[e] ?? 0}%`} hint="of prompts" />)}
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card title="Share of voice by engine" className="xl:col-span-2">
            {engines.length === 0 ? <div className="py-8 text-center text-[13px] text-gray-500">Not run yet. Click “Run now”.</div> : (
              <div className="space-y-3">{engines.map((e, i) => <div key={e}><div className="flex justify-between text-[12px] mb-1"><span className="text-gray-700">{e}</span><span className="tabular-nums text-gray-600">{sov.per_engine[e] ?? 0}%</span></div><Meter value={sov.per_engine[e] ?? 0} color={SERIES[i % 5]} height={8} /></div>)}</div>
            )}
          </Card>
          <Card title="Competitors named in answers" subtitle="How many answers mention each">
            {competitors.length === 0 ? <div className="text-[13px] text-gray-500">None detected yet.</div> : <div className="space-y-1.5">{competitors.map(([n, c]) => <div key={n} className="flex justify-between text-[13px]"><span className="text-gray-800 truncate">{n}</span><span className="tabular-nums text-gray-500">{c}</span></div>)}</div>}
          </Card>
        </div>
      )}

      {tab === 'prompts' && (
        <Card title={`Prompts (${d.prompts.length})`} subtitle="Questions real customers ask. Aim for 30–100. Defaults are created on the first run.">
          <div className="flex gap-2 mb-3">
            <input className={inputCls} placeholder={`e.g. best ${(b.primaryCategory || 'business').toLowerCase()} near ${b.area || 'me'}`} value={prompt} onChange={e => setPrompt(e.target.value)} onKeyDown={e => e.key === 'Enter' && prompt.trim().length > 2 && add()} />
            <Button icon={Plus} busy={busy === 'add'} disabled={prompt.trim().length < 3} onClick={add}>Add</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="text-[12px] text-gray-500 border-b border-gray-200"><tr><th className="p-2 text-left font-medium">Prompt</th>{engines.map(e => <th key={e} className="p-2 text-center font-medium whitespace-nowrap">{e}</th>)}<th className="p-2" /></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {d.prompts.map(p => (
                  <tr key={p.id}>
                    <td className="p-2 text-gray-900 min-w-[220px]">{p.prompt}</td>
                    {engines.map(e => { const r = byPrompt[p.id]?.[e]; return <td key={e} className="p-2 text-center" title={r?.answer_excerpt || ''}>{!r ? <span className="text-gray-300 text-[11px]">—</span> : r.mentioned ? <span className="inline-flex items-center gap-0.5 text-[#006300]"><Check size={14} /><span className="text-[11px]">#{r.position}</span></span> : <Minus size={14} className="inline text-gray-300" aria-label="Not named" />}</td>; })}
                    <td className="p-2 text-right"><button onClick={() => del(p.id)} className="text-gray-400 hover:text-red-600 cursor-pointer" aria-label="Delete prompt"><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-500 mt-2">✓ #n = named at position n in that engine's answer; — = not named. Hover a cell to read the answer.</p>
        </Card>
      )}

      {tab === 'sources' && (
        <Card title="Sources the engines cite" subtitle="Get listed or mentioned on these: they become outreach targets">
          {sov.top_sources.length === 0 ? <div className="py-8 text-center text-[13px] text-gray-500">No cited sources yet (engines with web search, like Perplexity, cite most).</div> : (
            <div className="divide-y divide-gray-100">{sov.top_sources.map(s => <div key={s.host} className="flex justify-between py-2 text-[13px]"><span className="font-mono text-[12px] text-gray-800">{s.host}</span><Badge tone="gray">{s.citations} citation{s.citations === 1 ? '' : 's'}</Badge></div>)}</div>
          )}
          {results[0] && <p className="text-[11px] text-gray-500 mt-3">Latest run {fmtDateTime(results.map(r => r.created_at).sort().pop())}</p>}
        </Card>
      )}

      {tab === 'files' && (
        <Card title="llms.txt" subtitle="Optional summary file for AI crawlers, built from the profile (cheap; adoption unproven)" action={<Button size="sm" icon={Copy} onClick={() => navigator.clipboard?.writeText(llms).then(() => toast('Copied'))}>Copy</Button>}>
          <pre className="text-[11px] bg-gray-900 text-gray-100 rounded p-3 overflow-auto">{llms}</pre>
          <p className="text-[12px] text-gray-600 mt-3">Also allow OAI-SearchBot, PerplexityBot and Google-Extended in robots.txt unless the owner opts out.</p>
        </Card>
      )}
      {toastNode}
    </>
  );
}

export default function GeoTrackerPage() {
  const [tab, setTab] = useState('overview');
  return (
    <SeoShell title="GEO / AEO tracker" subtitle="How often AI engines name the business when customers ask">
      {(b) => (
        <>
          <Tabs value={tab} onChange={setTab} tabs={[{ id: 'overview', label: 'Overview' }, { id: 'prompts', label: 'Prompts' }, { id: 'sources', label: 'Cited sources' }, { id: 'files', label: 'llms.txt' }]} />
          <Geo key={b.id} b={b} tab={tab} />
        </>
      )}
    </SeoShell>
  );
}
