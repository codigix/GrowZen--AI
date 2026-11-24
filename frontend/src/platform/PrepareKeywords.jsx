import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Check, Loader2, Plus, Sparkles, X } from 'lucide-react';
import { SeoShell, Card, Button, Badge, ErrorNote, useAction, useToast } from './SeoUi';
import { api } from './seoApi';

const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const FORM = { base: 'Keyword', near: 'Near me', area: 'In an area' };
const PRIO = ['High', 'Medium', 'Low'];

function Seg({ value, onChange, options, label }) {
  return (
    <div className="inline-flex rounded-md ring-1 ring-inset ring-slate-300 overflow-hidden bg-white" role="group" aria-label={label}>
      {options.map(([k, l, tone]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)} className={`px-2.5 h-7 text-12 font-semibold cursor-pointer transition-colors ${value === k ? (tone || 'bg-indigo-600 text-white') : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>
      ))}
    </div>
  );
}

/** Rows of one picked keyword: pick which ones to keep, make one primary, set priority. */
function Group({ g, state, set }) {
  return (
    <Card title={g.keyword} subtitle="Pick the wordings people really search, then choose the primary one" pad={false}>
      <div className="overflow-x-auto">
        <table className="w-full text-13">
          <thead>
            <tr className="text-12 uppercase tracking-wide text-slate-500 bg-slate-50/70">
              <th className="px-4 py-2 w-8" /><th className="px-3 py-2 text-left">Keyword</th><th className="px-3 py-2 text-left">Kind</th>
              <th className="px-3 py-2 text-right">Searches / mo</th><th className="px-3 py-2 text-right">Index</th><th className="px-3 py-2 text-right">CPC</th>
              <th className="px-3 py-2 text-left">Role</th><th className="px-3 py-2 text-left">Priority</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {g.rows.map(r => {
              const s = state[r.keyword] || {};
              return (
                <tr key={r.keyword} className={s.on ? 'bg-indigo-50/40' : ''}>
                  <td className="px-4 py-2"><input type="checkbox" aria-label={`Keep ${r.keyword}`} checked={!!s.on} disabled={r.saved} onChange={e => set(r.keyword, { on: e.target.checked })} className="h-4 w-4 accent-indigo-600 cursor-pointer" /></td>
                  <td className="px-3 py-2 font-medium text-slate-900">{r.keyword} {r.saved && <Badge tone="green">In My Keywords</Badge>}</td>
                  <td className="px-3 py-2 text-slate-500">{FORM[r.form]}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.volume == null ? '—' : r.volume === 0 ? <span className="text-slate-400" title="Google has no measured searches for this exact wording">0</span> : num(r.volume)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.difficulty ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.cpc ? `₹${r.cpc}` : '—'}</td>
                  <td className="px-3 py-2"><Seg label="Role" value={s.role} onChange={v => set(r.keyword, { role: v, on: true })} options={[['primary', 'Primary', 'bg-indigo-600 text-white'], ['secondary', 'Secondary', 'bg-slate-700 text-white']]} /></td>
                  <td className="px-3 py-2"><Seg label="Priority" value={s.priority} onChange={v => set(r.keyword, { priority: v, on: true })} options={PRIO.map(p => [p, p, p === 'High' ? 'bg-rose-600 text-white' : p === 'Medium' ? 'bg-amber-500 text-white' : 'bg-slate-500 text-white'])} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Body({ b }) {
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const picked = useMemo(() => (sp.get('k') || '').split('|').map(x => x.trim()).filter(Boolean), [sp]);
  const [typed, setTyped] = useState('');
  const [data, setData] = useState(null);
  const [state, setState] = useState({});
  const [sec, setSec] = useState({});
  const [error, setError] = useState('');
  const [busy, , run] = useAction();
  const [toast, toastNode] = useToast();

  useEffect(() => {
    if (!picked.length) { setData(null); return undefined; }
    let live = true;
    setData(null); setError('');
    api(`/businesses/${b.id}/keyword-workspace/prepare`, { method: 'POST', body: { keywords: picked }, timeout: 120000 })
      .then(d => {
        if (!live) return;
        setData(d);
        const st = {};
        d.groups.forEach(g => g.rows.forEach(r => { st[r.keyword] = { on: !r.saved && (r.role === 'primary' || (r.volume || 0) > 0 && r.form !== 'base'), role: r.role, priority: r.priority, origin: g.keyword }; }));
        setState(st);
      })
      .catch(e => live && setError(e.message || String(e)));
    return () => { live = false; };
  }, [b.id, picked.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, patch) => setState(s => ({ ...s, [k]: { ...s[k], ...patch } }));
  const addPicked = () => { const list = [...new Set([...picked, ...typed.split(/[,\n|]/).map(x => x.trim()).filter(Boolean)])].slice(0, 12); setTyped(''); setSp({ k: list.join('|') }); };
  const remove = (k) => setSp({ k: picked.filter(x => x !== k).join('|') });

  const primaries = data ? data.groups.flatMap(g => g.rows).filter(r => state[r.keyword]?.on && state[r.keyword]?.role === 'primary') : [];
  const askSecondary = (p) => run(`sec:${p}`, async () => {
    const r = await api(`/businesses/${b.id}/keyword-workspace/secondary`, { method: 'POST', body: { primary: p }, timeout: 120000 });
    setSec(s => ({ ...s, [p]: r }));
  });
  const addSecondary = (p, k) => set(k.keyword, { on: true, role: 'secondary', priority: 'Medium', origin: p, extra: k });

  const chosen = useMemo(() => {
    const out = [];
    if (data) data.groups.forEach(g => g.rows.forEach(r => { const s = state[r.keyword]; if (s?.on && !r.saved) out.push({ ...r, ...s }); }));
    Object.values(sec).forEach(x => (x.rows || []).forEach(r => { const s = state[r.keyword]; if (s?.on && s.extra && !out.some(o => o.keyword === r.keyword)) out.push({ ...r, ...s }); }));
    return out;
  }, [data, state, sec]);

  const save = () => run('save', async () => {
    const body = chosen.map(r => ({ keyword: r.keyword, volume: r.volume ?? undefined, cpc: r.cpc ?? undefined, role: r.role, priority: r.priority, source: { type: 'prepare', from: r.origin } }));
    const res = await api(`/businesses/${b.id}/keywords`, { method: 'POST', body });
    toast(`${res.added} new keyword${res.added === 1 ? '' : 's'} added to My Keywords`);
    navigate('/keyword-management/tracked');
  });

  return (
    <div className="space-y-4">
      <Card title="1 · Keywords to prepare" subtitle="The keywords you picked in the research. Each one is shown the ways customers word it: as it is, near me and in your target areas.">
        <div className="flex flex-wrap items-center gap-2">
          {picked.map(k => <span key={k} className="inline-flex items-center gap-1 h-8 pl-3 pr-1.5 rounded-full bg-indigo-50 text-indigo-700 text-13 font-medium">{k}<button type="button" aria-label={`Remove ${k}`} onClick={() => remove(k)} className="h-5 w-5 rounded-full hover:bg-indigo-100 inline-flex items-center justify-center cursor-pointer"><X size={12} /></button></span>)}
          <form onSubmit={e => { e.preventDefault(); addPicked(); }} className="inline-flex items-center gap-2">
            <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="Add a keyword, e.g. digital marketing" aria-label="Add a keyword" className="ai-glass-input h-8 w-64 px-3 text-13 rounded" />
            <Button size="sm" icon={Plus} type="submit" disabled={!typed.trim()}>Add</Button>
          </form>
        </div>
        {!picked.length && <p className="mt-3 text-13 text-slate-500">Nothing picked yet. Type a keyword above, or select keywords in the <Link className="text-indigo-600 underline" to="/keyword-management/workspace">Keyword Workspace</Link> or the <Link className="text-indigo-600 underline" to="/keyword-management/magic">Keyword Magic Tool</Link> and choose Prepare.</p>}
      </Card>

      {error && <ErrorNote>{error}</ErrorNote>}
      {picked.length > 0 && !data && !error && <div className="flex items-center gap-2 text-13 text-slate-500 py-6 justify-center"><Loader2 className="animate-spin" size={16} /> Reading real searches from Google Keyword Planner…</div>}
      {data?.metrics_note && <ErrorNote>{data.metrics_note}</ErrorNote>}

      {data && (
        <>
          <div className="text-13 text-slate-500">Target areas: {data.areas.length ? data.areas.join(', ') : 'none set on the project'}. Volumes are Google Keyword Planner's monthly searches for {data.country}. The one with the most searches among the local wordings is suggested as primary.</div>
          {data.groups.map(g => <Group key={g.keyword} g={g} state={state} set={set} />)}

          <Card title="2 · Secondary keywords" subtitle="Searches around each primary keyword, from Keyword Planner, without off-topic words or ones you already have">
            {!primaries.length && <p className="text-13 text-slate-500">Mark a keyword as Primary above to get the secondary keywords around it.</p>}
            <div className="space-y-4">
              {primaries.map(p => (
                <div key={p.keyword}>
                  <div className="flex items-center gap-3">
                    <span className="text-13.5 font-semibold text-slate-900">Around “{p.keyword}”</span>
                    <Button size="sm" icon={Sparkles} busy={busy === `sec:${p.keyword}`} onClick={() => askSecondary(p.keyword)}>{sec[p.keyword] ? 'Refresh' : 'Find secondary keywords'}</Button>
                  </div>
                  {sec[p.keyword]?.note && <div className="mt-2"><ErrorNote>{sec[p.keyword].note}</ErrorNote></div>}
                  {sec[p.keyword] && !sec[p.keyword].note && !sec[p.keyword].rows.length && <p className="mt-2 text-13 text-slate-500">Planner has no further on-topic searches around this one.</p>}
                  {sec[p.keyword]?.rows?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {sec[p.keyword].rows.map(k => {
                        const on = !!state[k.keyword]?.on;
                        return (
                          <button key={k.keyword} type="button" aria-pressed={on} onClick={() => (on ? set(k.keyword, { on: false }) : addSecondary(p.keyword, k))} className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-12.5 font-medium cursor-pointer ring-1 ring-inset transition-colors ${on ? 'bg-emerald-50 ring-emerald-300 text-emerald-800' : 'bg-white ring-slate-300 text-slate-700 hover:bg-slate-50'}`}>
                            {on ? <Check size={13} /> : <Plus size={13} />}{k.keyword}<span className="text-slate-400 font-normal">{num(k.volume)}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>

          <div className="sticky bottom-3 z-20">
            <div className="bg-slate-900 text-white rounded-xl shadow-xl px-4 py-3 flex flex-wrap items-center gap-3">
              <span className="text-13 font-semibold">{chosen.length} keyword{chosen.length === 1 ? '' : 's'} ready</span>
              <span className="text-12.5 text-slate-300">{chosen.filter(c => c.role === 'primary').length} primary · {chosen.filter(c => c.role !== 'primary').length} secondary</span>
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="primary" icon={ArrowRight} busy={busy === 'save'} disabled={!chosen.length} onClick={save}>Add to My Keywords</Button>
              </div>
            </div>
          </div>
        </>
      )}
      {toastNode}
    </div>
  );
}

export function PrepareKeywordsPage() {
  return <SeoShell title="Prepare Keywords" subtitle="Turn a picked keyword into the wording customers search (near me, in your areas), choose primary and secondary keywords with a priority, then add them all to My Keywords">{(b) => <Body key={b.id} b={b} />}</SeoShell>;
}
