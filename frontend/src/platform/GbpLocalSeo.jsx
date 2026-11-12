import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Play, Plus, ArrowRight, AlertTriangle, CheckCircle2, Info, MapPinned, Star, Globe, Store, ListChecks, TrendingUp, TrendingDown, Minus, Trophy } from 'lucide-react';
import { Card, Button, ErrorNote, useAction, SkList } from './SeoUi';
import { api, useApi, fmtDateTime } from './seoApi';
import { SectionHead } from './GbpWorkspace';

const LEVEL = {
  good: { ring: '#10b981', chip: 'bg-emerald-50 text-emerald-700', label: 'Strong' },
  warning: { ring: '#f59e0b', chip: 'bg-amber-50 text-amber-700', label: 'Needs work' },
  critical: { ring: '#ef4444', chip: 'bg-red-50 text-red-700', label: 'Weak' },
  none: { ring: '#cbd5e1', chip: 'bg-slate-100 text-slate-500', label: 'Not measured' }
};
const ACTION_TONE = { critical: [AlertTriangle, 'bg-red-50 ring-red-200 text-red-900', 'text-red-500'], warning: [AlertTriangle, 'bg-amber-50 ring-amber-200 text-amber-900', 'text-amber-500'], info: [Info, 'bg-sky-50 ring-sky-200 text-sky-900', 'text-sky-500'] };
const PARTS = [['profile', 'Google profile', Store], ['reviews', 'Reviews', Star], ['citations', 'Listings & NAP', ListChecks], ['website', 'Website', Globe], ['rankings', 'Rankings', MapPinned]];

function Ring({ score, level, size = 132 }) {
  const r = (size - 16) / 2, c = 2 * Math.PI * r, s = score == null ? 0 : score;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={score == null ? 'No score yet' : `Local SEO score ${score} out of 100`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth="10" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={LEVEL[level]?.ring || LEVEL.none.ring} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(s / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="48%" textAnchor="middle" className="fill-slate-900" style={{ fontSize: size * 0.28, fontWeight: 700 }}>{score == null ? '—' : score}</text>
      <text x="50%" y="66%" textAnchor="middle" className="fill-slate-500" style={{ fontSize: 12 }}>out of 100</text>
    </svg>
  );
}

const Change = ({ v }) => (v == null || v === 0 ? <Minus size={13} className="text-slate-300" /> : v > 0 ? <span className="inline-flex items-center text-emerald-600 text-12 font-medium"><TrendingUp size={13} className="mr-0.5" />{v}</span> : <span className="inline-flex items-center text-red-600 text-12 font-medium"><TrendingDown size={13} className="mr-0.5" />{Math.abs(v)}</span>);

/** Local SEO for the Google profile: one score, what is holding it back, and where the tracked local searches stand in Maps and Google. */
export default function LocalSeoSection({ b }) {
  const [how, setHow] = useState(false);
  const data = useApi(`/businesses/${b.id}/gbp/local-seo`);
  const [busy, error, run] = useAction();
  const [note, setNote] = useState('');
  const d = data.data;
  const reload = () => data.reload(true);
  const check = () => run('check', async () => { const r = await api(`/businesses/${b.id}/seo/check-ranks`, { method: 'POST', body: {} }); setNote(`Checked ${r.checked ?? 'the'} search${r.checked === 1 ? '' : 'es'} on Google Maps and Google Search.`); reload(); });
  const seed = () => run('seed', async () => { const r = await api(`/businesses/${b.id}/seo/seed-keywords`, { method: 'POST' }); setNote(`Now tracking ${r.added} local search${r.added === 1 ? '' : 'es'}. Checking where you rank…`); await api(`/businesses/${b.id}/seo/check-ranks`, { method: 'POST', body: {} }).then(() => setNote('Tracking started and checked.')).catch(e => setNote(`Tracking started. ${e.message}`)); reload(); });
  const track = (k) => run(`t${k}`, async () => { await api(`/businesses/${b.id}/keywords`, { method: 'POST', body: [{ keyword: k }] }); reload(); });
  const act = (a) => (a.action === 'seed' ? seed() : check());
  const pos = d?.positions;

  return (
    <div className="space-y-4">
      <SectionHead title="Local SEO" subtitle="How well this business can be found on Google Maps and Google Search, and what to do next" sources={['google', 'external', 'calc']} />
      <ErrorNote>{error || data.error?.message}</ErrorNote>
      {note && <p className="text-13 text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">{note}</p>}

      {!d ? <Card><SkList rows={5} /></Card> : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-4 items-stretch">
            <Card>
              <div className="flex flex-col items-center py-2">
                <Ring score={d.score} level={d.level} />
                <span className={`mt-2 text-12 font-semibold rounded-full px-3 py-1 ${LEVEL[d.level]?.chip}`}>{LEVEL[d.level]?.label}</span>
                <p className="text-12 text-slate-500 text-center mt-3">Our own local SEO score for {b.name}. Google does not publish one.</p>
                <button type="button" onClick={() => setHow(h => !h)} aria-expanded={how} className="mt-2 text-12.5 font-semibold text-indigo-600 hover:underline cursor-pointer">{how ? 'Hide how it is worked out' : 'How is this worked out?'}</button>
              </div>
            </Card>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {PARTS.map(([k, label, Icon]) => { const p = d.parts[k]; const lv = LEVEL[p.level]; return (
                <Link key={k} to={p.to} className="ai-glass-card rounded p-3.5 hover:ring-2 hover:ring-indigo-200 transition cursor-pointer block">
                  <div className="flex items-center justify-between"><span className="w-9 h-9 rounded-full bg-indigo-50 text-indigo-500 flex items-center justify-center"><Icon size={16} /></span><span className={`text-11 font-semibold rounded-full px-2 py-0.5 ${lv.chip}`}>{lv.label}</span></div>
                  <div className="mt-2 text-12 font-semibold text-slate-400">{label}</div>
                  <div className="text-20 font-bold text-slate-900 tabular-nums leading-tight">{p.score == null ? '—' : p.score}<span className="text-12 font-medium text-slate-400"> /100</span></div>
                  <div className="text-11.5 text-slate-500 mt-0.5 line-clamp-2">{p.detail}</div>
                  <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${p.score || 0}%`, background: lv.ring }} /></div>
                </Link>
              ); })}
            </div>
          </div>

          {how && (
            <Card title="How the score is worked out" subtitle={d.note}>
              <ul className="divide-y divide-slate-100">{(d.method || []).map(m => <li key={m.part} className="py-2.5 flex gap-3 text-13"><span className="w-14 shrink-0 text-right font-semibold text-slate-800 tabular-nums">{m.weight}%</span><span><b className="capitalize text-slate-900">{m.part}</b><span className="text-slate-600"> · {m.based_on}</span></span></li>)}</ul>
            </Card>
          )}

          <Card title="Do these next" subtitle="The biggest gaps first. Each one is a single step.">
            {d.actions.length === 0 ? <p className="text-13 text-emerald-700 flex items-center gap-2 py-3"><CheckCircle2 size={16} />Nothing urgent. Keep collecting reviews and posting.</p> : (
              <ul className="space-y-2.5">
                {d.actions.map(a => { const [Icon, cls, ic] = ACTION_TONE[a.level] || ACTION_TONE.info; return (
                  <li key={a.key} className={`rounded-lg ring-1 px-4 py-3 flex items-center gap-3 flex-wrap ${cls}`}>
                    <Icon size={17} className={`${ic} shrink-0`} />
                    <div className="flex-1 min-w-[220px]"><div className="text-13.5 font-semibold">{a.title}</div><div className="text-12.5 opacity-90 mt-0.5">{a.fix}</div></div>
                    {a.action ? <Button size="sm" variant="primary" icon={a.action === 'seed' ? Plus : Play} busy={busy === 'seed' || busy === 'check'} onClick={() => act(a)}>{a.action === 'seed' ? 'Start tracking' : 'Check now'}</Button>
                      : a.to && <Link to={a.to}><Button size="sm">Open <ArrowRight size={13} className="ml-1" /></Button></Link>}
                  </li>
                ); })}
              </ul>
            )}
          </Card>

          <Card title="Where you rank for local searches" subtitle={pos?.area?.label ? `Checked for ${pos.area.label}` : 'Position in Google Maps and Google Search for each tracked search'}
            action={<Button size="sm" variant="primary" icon={Play} busy={busy === 'check'} disabled={!pos?.summary?.keywords} onClick={check}>Check rankings now</Button>}>
            {pos?.state === 'needs_serper' && <p className="text-12.5 text-amber-800 bg-amber-50 rounded-lg px-3 py-2 mb-3">Rank checks need a Serper key. Set <b>SERPER_API_KEY</b> on the backend.</p>}
            {pos?.summary?.keywords > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                {[['Tracked searches', pos.summary.keywords], ['In the Maps top 3', pos.summary.in_pack], ['On Google page 1', pos.summary.page1], ['Not found', pos.summary.not_found]].map(([l, v]) => <div key={l} className="rounded-lg bg-slate-50 px-3 py-2.5"><div className="text-11.5 font-medium text-slate-500">{l}</div><div className="text-18 font-bold text-slate-900 tabular-nums">{v}</div></div>)}
              </div>
            )}
            {!pos?.rows?.length ? <p className="text-13 text-slate-500 py-4 text-center">No searches are tracked yet. Use “Start tracking” above, or add one below.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-13">
                  <thead className="text-12 text-slate-500 border-b border-slate-200"><tr><th className="p-2 text-left font-medium">Search</th><th className="p-2 text-left font-medium">Google Maps</th><th className="p-2 text-left font-medium">Google Search</th><th className="p-2 text-left font-medium">Change</th><th className="p-2 text-left font-medium">First in Maps</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {pos.rows.map(r => (
                      <tr key={r.keyword}>
                        <td className="p-2.5 font-medium text-slate-900">{r.keyword}</td>
                        <td className="p-2.5">{!r.checked || !r.maps.checked ? <span className="text-slate-400">Not checked</span> : r.maps.found ? <span className={`inline-flex items-center gap-1 font-semibold ${r.maps.in_pack ? 'text-emerald-600' : 'text-slate-800'}`}>{r.maps.in_pack && <Trophy size={13} />}#{r.maps.position}</span> : <span className="text-red-600">Not found</span>}</td>
                        <td className="p-2.5">{!r.checked ? <span className="text-slate-400">Not checked</span> : r.organic.found ? <span className="text-slate-800">{r.organic.label}</span> : <span className="text-red-600">{r.organic.label}</span>}</td>
                        <td className="p-2.5"><Change v={r.organic.change_vs_previous} /></td>
                        <td className="p-2.5 text-12 text-slate-500 max-w-[200px] truncate" title={r.who_is_first?.maps || ''}>{r.who_is_first?.maps || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {pos?.last_checked_at && <p className="text-11.5 text-slate-400 mt-2">Last checked {fmtDateTime(pos.last_checked_at)}. Results are live from Google.</p>}
            {d.suggestions.length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <div className="text-12.5 font-semibold text-slate-700 mb-2">Searches customers may use. Track one:</div>
                <div className="flex flex-wrap gap-2">{d.suggestions.map(k => <button key={k} type="button" disabled={busy === `t${k}`} onClick={() => track(k)} className="h-8 px-3 rounded-full ring-1 ring-slate-300 hover:ring-indigo-400 hover:bg-indigo-50 text-12.5 text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"><Plus size={12} />{k}</button>)}</div>
              </div>
            )}
          </Card>

          <Card title="Go deeper" subtitle="More local SEO tools">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {[['Map rank tracker', 'Geo-grid of your Maps position', '/rank-tracking/geo'], ['Keyword research', 'Find and save local searches', '/keyword-management/discover'], ['Site audit', 'Technical and on-page problems', '/website-audit'], ['Listings & NAP', 'Name, address and phone on other sites', '/off-page-seo/citations']].map(([t, s, to]) => (
                <Link key={t} to={to} className="rounded-lg ring-1 ring-slate-200 hover:ring-indigo-300 hover:bg-indigo-50/40 px-3.5 py-3 flex items-center gap-2 cursor-pointer"><div className="flex-1 min-w-0"><div className="text-13 font-semibold text-slate-800">{t}</div><div className="text-11.5 text-slate-500 truncate">{s}</div></div><ArrowRight size={14} className="text-slate-400 shrink-0" /></Link>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
