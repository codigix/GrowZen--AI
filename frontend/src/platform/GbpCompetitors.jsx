import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Plus, Trash2, ExternalLink, Swords, Trophy, Star, ArrowRight, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { Card, Button, ErrorNote, Field, Modal, inputCls, useAction, useDoubleConfirm, SkList } from './SeoUi';
import { api, useApi } from './seoApi';
import { SectionHead } from './GbpWorkspace';

const TONE = {
  critical: ['bg-red-50 ring-red-200 text-red-900', AlertTriangle, 'text-red-500'],
  warning: ['bg-amber-50 ring-amber-200 text-amber-900', AlertTriangle, 'text-amber-500'],
  info: ['bg-sky-50 ring-sky-200 text-sky-900', Info, 'text-sky-500'],
  good: ['bg-emerald-50 ring-emerald-200 text-emerald-900', CheckCircle2, 'text-emerald-500']
};
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN'));
const Stars = ({ value }) => (value == null ? <span className="text-slate-400">—</span> : <span className="inline-flex items-center gap-1"><Star size={13} className="fill-amber-400 text-amber-400" /><span className="font-medium text-slate-800">{Number(value).toFixed(1)}</span></span>);

function AddCompetitor({ b, open, onClose, onDone }) {
  const [f, setF] = useState({ name: '', rating: '', reviews: '', website: '', maps_link: '' });
  const [busy, error, run, setError] = useAction();
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const save = () => run('add', async () => {
    await api(`/businesses/${b.id}/gbp/competitors`, { method: 'POST', body: { name: f.name.trim(), rating: f.rating === '' ? null : Number(f.rating), reviews: f.reviews === '' ? null : Number(f.reviews), website: f.website.trim() || null, maps_link: f.maps_link.trim() || null } });
    setF({ name: '', rating: '', reviews: '', website: '', maps_link: '' }); onDone(); onClose();
  });
  return (
    <Modal open={open} onClose={() => { setError(''); onClose(); }} width="max-w-lg" title="Add a competitor"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy === 'add'} disabled={!f.name.trim()} onClick={save}>Add competitor</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Field label="Business name"><input className={inputCls} value={f.name} onChange={e => set('name', e.target.value)} autoFocus /></Field></div>
        <Field label="Google rating" hint="0 to 5"><input type="number" step="0.1" min="0" max="5" className={inputCls} value={f.rating} onChange={e => set('rating', e.target.value)} /></Field>
        <Field label="Number of reviews"><input type="number" min="0" className={inputCls} value={f.reviews} onChange={e => set('reviews', e.target.value)} /></Field>
        <div className="col-span-2"><Field label="Website (optional)"><input className={inputCls} value={f.website} onChange={e => set('website', e.target.value)} placeholder="their-site.com" /></Field></div>
        <div className="col-span-2"><Field label="Google Maps link (optional)"><input className={inputCls} value={f.maps_link} onChange={e => set('maps_link', e.target.value)} placeholder="https://maps.google.com/…" /></Field></div>
      </div>
      <ErrorNote>{error}</ErrorNote>
    </Modal>
  );
}

/** Competitor Analysis for the Google Business Profile: the businesses ranking around this one, how the profile compares, and what to do about each gap. */
export default function CompetitorSection({ b }) {
  const data = useApi(`/businesses/${b.id}/gbp/competitors`);
  const [busy, error, run] = useAction();
  const [keyword, setKeyword] = useState('');
  const [adding, setAdding] = useState(false);
  const [ask, confirmNode] = useDoubleConfirm();
  const d = data.data;
  const reload = () => data.reload(true);
  const search = () => run('search', async () => { await api(`/businesses/${b.id}/gbp/competitors/search`, { method: 'POST', body: { keyword: keyword.trim() || null, top_n: 10 } }); reload(); });
  const remove = (c) => ask({ what: c.name, effect: 'It is removed from this comparison. The business itself is not touched.', onConfirm: () => run(`d${c.id}`, async () => { await api(`/businesses/${b.id}/gbp/competitors/${c.id}`, { method: 'DELETE' }); reload(); }) });
  const rows = d ? [...d.competitors, d.you].sort((x, y) => (y.reviews || 0) - (x.reviews || 0)) : [];
  const max = Math.max(1, ...rows.map(r => r.reviews || 0));
  const rated = d ? d.competitors.filter(c => typeof c.rating === 'number') : [];
  const avg = rated.length ? (rated.reduce((a, c) => a + c.rating, 0) / rated.length).toFixed(1) : null;
  const sorted = d ? d.competitors.map(c => c.reviews || 0).sort((x, y) => x - y) : [];
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;

  return (
    <div className="space-y-4">
      {confirmNode}
      <SectionHead title="Competitor Analysis" subtitle="Who shows up around you on Google Maps, and how your profile compares" sources={['external', 'manual']} />

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="text-12 font-medium text-slate-500 block mb-1" htmlFor="comp-kw">Search for</label>
            <input id="comp-kw" className={inputCls} value={keyword} onChange={e => setKeyword(e.target.value)} placeholder={b.primary_category || 'e.g. clothing rental'} onKeyDown={e => { if (e.key === 'Enter') search(); }} />
          </div>
          <div className="text-12 text-slate-500 pb-2.5">in <b className="text-slate-700">{d?.area || b.city || 'your area'}</b></div>
          <Button variant="primary" icon={Search} busy={busy === 'search'} disabled={d && !d.can_search} onClick={search}>{d?.competitors?.length ? 'Search again' : 'Find competitors'}</Button>
          <Button icon={Plus} onClick={() => setAdding(true)}>Add one</Button>
        </div>
        {d && !d.can_search && <p className="mt-3 text-12.5 text-amber-800 bg-amber-50 rounded-lg px-3 py-2">Searching needs a Google Places key. Set <b>GOOGLE_PLACES_API_KEY</b> on the backend. You can still add competitors by hand.</p>}
        {d?.found_at && <p className="mt-2 text-11.5 text-slate-400">Last searched {new Date(d.found_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}{d.keyword ? ` for “${d.keyword}”` : ''}. Results come from Google Maps.</p>}
        <ErrorNote>{error || data.error?.message}</ErrorNote>
      </Card>

      {!d ? <Card><SkList rows={5} /></Card> : d.competitors.length === 0 ? (
        <Card><div className="py-10 text-center">
          <span className="inline-flex w-12 h-12 rounded-full bg-indigo-50 text-indigo-500 items-center justify-center"><Swords size={22} /></span>
          <div className="text-15 font-semibold text-slate-900 mt-3">No competitors yet</div>
          <p className="text-13 text-slate-500 mt-1 max-w-md mx-auto">Press <b>Find competitors</b> to list the top businesses of your kind around {d.area || 'you'}, with their ratings and reviews, and see exactly where your profile is behind.</p>
        </div></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[[Trophy, 'Your rank by reviews', d.your_rank ? `#${d.your_rank} of ${d.total}` : '—'], [Swords, 'Competitors compared', d.competitors.length], [Star, 'Their average rating', avg || '—'], [Star, 'Typical reviews', median != null ? fmt(median) : '—']].map(([I, label, value]) => (
              <div key={label} className="ai-glass-card rounded p-3.5 flex items-center gap-3"><span className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-500 flex items-center justify-center shrink-0"><I size={17} /></span><div><div className="text-11.5 font-semibold text-slate-400">{label}</div><div className="text-20 leading-tight font-bold text-slate-900 tabular-nums">{value}</div></div></div>
            ))}
          </div>

          {d.insights.length > 0 && (
            <Card title="What this means for you" subtitle="The gaps between your profile and the competitors, and the next step for each">
              <ul className="space-y-2.5">
                {d.insights.map((i, k) => { const [cls, Icon, ic] = TONE[i.level] || TONE.info; return (
                  <li key={k} className={`rounded-lg ring-1 px-4 py-3 flex gap-3 ${cls}`}><Icon size={17} className={`${ic} mt-0.5 shrink-0`} /><div><div className="text-13.5 font-semibold">{i.title}</div><div className="text-12.5 opacity-90 mt-0.5">{i.fix}</div></div></li>
                ); })}
              </ul>
            </Card>
          )}

          <Card title="You and your competitors" subtitle="Sorted by number of reviews, the strongest signal Google has for local ranking">
            <div className="overflow-x-auto">
              <table className="w-full text-13">
                <thead className="text-12 text-slate-500 border-b border-slate-200"><tr><th className="p-2 text-left font-medium">Business</th><th className="p-2 text-left font-medium">Rating</th><th className="p-2 text-left font-medium w-[34%]">Reviews</th><th className="p-2 text-left font-medium">Website</th><th className="p-2" /></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r, i) => (
                    <tr key={r.id || 'you'} className={r.you ? 'bg-indigo-50/60' : ''}>
                      <td className="p-2.5 align-top">
                        <div className="flex items-start gap-2.5">
                          <span className={`w-7 h-7 rounded-full text-11 font-bold flex items-center justify-center shrink-0 ${r.you ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{i + 1}</span>
                          <div className="min-w-0">
                            <div className="font-medium text-slate-900 flex items-center gap-1.5 flex-wrap">{r.maps_link ? <a href={r.maps_link} target="_blank" rel="noreferrer" className="hover:text-indigo-600 hover:underline">{r.name}</a> : r.name}{r.you && <span className="text-10 font-bold uppercase tracking-wide bg-indigo-600 text-white rounded px-1.5 py-0.5">You</span>}{r.source === 'manual' && <span className="text-10 text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">added by you</span>}</div>
                            {r.address && <div className="text-11.5 text-slate-500 truncate max-w-[300px]" title={r.address}>{r.address}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="p-2.5 align-top"><Stars value={r.rating} /></td>
                      <td className="p-2.5 align-top"><div className="flex items-center gap-2"><div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full rounded-full ${r.you ? 'bg-indigo-500' : 'bg-slate-400'}`} style={{ width: `${Math.max(2, ((r.reviews || 0) / max) * 100)}%` }} /></div><span className="w-12 text-right tabular-nums text-slate-700">{fmt(r.reviews || 0)}</span></div></td>
                      <td className="p-2.5 align-top text-12">{r.website ? <a href={r.website} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline inline-flex items-center gap-1"><ExternalLink size={11} />{r.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').slice(0, 28)}</a> : <span className="text-slate-400">None</span>}</td>
                      <td className="p-2.5 align-top text-right">{!r.you && <button type="button" onClick={() => remove(r)} aria-label={`Remove ${r.name}`} className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"><Trash2 size={14} /></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <Card title="Go deeper" subtitle="More competitor tools, for the website side">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {[['Competitor finder', 'Discover by keyword', '/competitor-finder'], ['Competitor watch', 'Ratings and review growth over time', '/competitor-watch'], ['Compare domains', 'Side-by-side websites', '/compare-domains'], ['Keyword gap', 'Keywords they rank for and you do not', '/keyword-gap']].map(([t, s, to]) => (
            <Link key={t} to={to} className="rounded-lg ring-1 ring-slate-200 hover:ring-indigo-300 hover:bg-indigo-50/40 px-3.5 py-3 flex items-center gap-2 cursor-pointer"><div className="flex-1 min-w-0"><div className="text-13 font-semibold text-slate-800">{t}</div><div className="text-11.5 text-slate-500 truncate">{s}</div></div><ArrowRight size={14} className="text-slate-400 shrink-0" /></Link>
          ))}
        </div>
      </Card>

      <AddCompetitor b={b} open={adding} onClose={() => setAdding(false)} onDone={reload} />
    </div>
  );
}
