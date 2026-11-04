import React from 'react';
import { MapPin, Monitor, Smartphone, Copy, Printer, Plus, Trophy, Check, Globe } from 'lucide-react';
import { Card, Badge, Button, useAction } from './SeoUi';
import { api } from './seoApi';

export const SECTIONS = [['sec-landscape', 'Landscape'], ['sec-overview', 'Overview'], ['sec-distribution', 'Rankings Distribution'], ['sec-tags', 'Tags'], ['sec-pages', 'Pages'],
  ['sec-cannibal', 'Cannibalization'], ['sec-competitors', 'Competitors Discovery'], ['sec-devices', 'Devices & Locations'], ['sec-snippets', 'Featured Snippets']];

export const Anchor = ({ id }) => <span id={id} className="block scroll-mt-24" aria-hidden="true" />;

/** The tracked domain, where and on what device it is checked, and how many keywords and competitors are tracked. */
export function TrackingHeader({ d }) {
  const chip = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-50 border border-slate-200 text-12 text-slate-700';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={chip}><Globe size={12} />{d.domain}</span>
      <span className={chip}><MapPin size={12} />{d.country ? `${d.country} · ` : ''}{d.location || 'Google'}</span>
      <span className={chip}><Monitor size={12} />Desktop</span>
      <span className={chip}>Keywords: <b>{d.tracked}</b></span>
      <span className={chip}>Competitors: <b>{(d.tracked_competitors || []).length}</b></span>
      <span className={chip}>SERP features: <b>{d.serp_features?.length ?? 0}</b></span>
      <span className={chip}>Share of voice: <b>{d.share_of_voice?.value ?? 0}%</b></span>
    </div>
  );
}

export const TABS = [['landscape', 'Landscape'], ['overview', 'Overview'], ['distribution', 'Rankings Distribution'], ['tags', 'Tags'], ['pages', 'Pages'],
  ['cannibal', 'Cannibalization'], ['competitors', 'Competitors Discovery'], ['devices', 'Devices & Locations'], ['snippets', 'Featured Snippets']];

export function TabBar({ value, onChange }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto no-scrollbar border-b border-slate-200">
      {TABS.map(([id, label]) => (
        <button key={id} role="tab" aria-selected={value === id} type="button" onClick={() => onChange(id)}
          className={`px-3.5 py-2.5 text-13 font-semibold whitespace-nowrap border-b-2 -mb-px cursor-pointer ${value === id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>{label}</button>
      ))}
    </div>
  );
}

/** Copy the summary to the clipboard, or print the page to PDF. */
export function ExportButtons({ d, toast }) {
  const copy = () => {
    const text = [`Position tracking: ${d.domain}`, `${d.period.start} to ${d.period.end}`, ...d.summary.map(s => `- ${s}`)].join('\n');
    navigator.clipboard?.writeText(text).then(() => toast('Summary copied'));
  };
  return (
    <div className="flex gap-2">
      <Button size="sm" icon={Copy} onClick={copy}>Copy all</Button>
      <Button size="sm" icon={Printer} onClick={() => window.print()}>PDF</Button>
    </div>
  );
}

export function ShareOfVoice({ d }) {
  const mine = d.share_of_voice?.value ?? 0;
  return (
    <Card title="Share of voice" subtitle="Your visibility as a share of all the visibility in these Google results">
      <div className="flex items-center gap-4">
        <div className="text-2xl font-bold text-slate-900 tabular-nums">{mine}%</div>
        <div className="flex-1">
          <div className="h-3 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, mine)}%` }} /></div>
          <div className="text-12 text-slate-500 mt-1.5">{d.share_of_voice?.domains ?? 0} domains share the results of your tracked keywords.</div>
        </div>
      </div>
    </Card>
  );
}

export function FeaturedSnippets({ d }) {
  const rows = d.snippets || [];
  return (
    <Card title="Featured snippets" subtitle="Keywords where Google shows a snippet, answer box or People-also-ask, and whether it is yours" pad={false}>
      {rows.length ? (
        <table className="w-full text-13">
          <thead className="bg-slate-50 text-11.5 text-slate-500"><tr><th className="px-4 py-2.5 text-left font-semibold">Keyword</th><th className="px-4 py-2.5 text-left font-semibold">Feature</th><th className="px-4 py-2.5 text-right font-semibold">Your position</th><th className="px-4 py-2.5 text-right font-semibold">Yours?</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map(r => (
            <tr key={r.keyword}><td className="px-4 py-2.5">{r.keyword}</td><td className="px-4 py-2.5 text-slate-600">{r.feature}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{r.rank ? `#${r.rank}` : '—'}</td>
              <td className="px-4 py-2.5 text-right">{r.yours ? <Badge tone="green"><Check size={11} /> Yes</Badge> : <Badge tone="amber">Opportunity</Badge>}</td></tr>))}</tbody>
        </table>
      ) : <div className="py-8 text-center text-13 text-slate-500">No snippet or answer box was seen on the latest checks.</div>}
      {rows.some(r => !r.yours) && <p className="px-4 py-3 text-12 text-slate-500 border-t border-slate-100">To win one: add a 40-60 word direct answer under a question heading, plus FAQ schema, on the page that ranks.</p>}
    </Card>
  );
}

/** Domains that outrank you in the results, with a one-click way to track them as competitors. */
export function CompetitorsDiscovery({ d, b, onChanged }) {
  const [busy, error, run] = useAction();
  const tracked = new Set((d.tracked_competitors || []).map(u => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '')));
  const rivals = (d.competitors || []).filter(c => !c.you && c.domain).slice(0, 10);
  const add = (domain) => run(domain, async () => { await api(`/businesses/${b.id}/seo/track-competitor`, { method: 'POST', body: { domain } }); onChanged(); });
  return (
    <Card title="Competitors discovery" subtitle="Domains found in the Google results of your keywords">
      {rivals.length ? (
        <ul className="divide-y divide-slate-100 -my-2">{rivals.map(c => (
          <li key={c.domain} className="flex items-center gap-3 py-2.5 text-13">
            <Trophy size={14} className="text-amber-500" />
            <span className="flex-1 min-w-0 truncate"><a href={`https://${c.domain}`} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">{c.domain}</a>
              <span className="text-slate-400"> · {c.keywords} keyword{c.keywords !== 1 ? 's' : ''} · avg #{c.avg_position} · {c.visibility}% visibility</span></span>
            {tracked.has(c.domain) ? <Badge tone="green">Tracked</Badge> : <Button size="sm" icon={Plus} busy={busy === c.domain} onClick={() => add(c.domain)}>Track</Button>}
          </li>))}
        </ul>
      ) : <div className="py-6 text-center text-13 text-slate-500">Competitors appear after the first position check.</div>}
      {error && <p className="text-12 text-rose-600 mt-2">{error}</p>}
    </Card>
  );
}

export function DevicesLocations({ d }) {
  return (
    <Card title="Devices & locations" subtitle="Where and on which device positions are checked">
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="rounded border border-slate-200 p-4 flex items-center gap-3"><Monitor size={18} className="text-indigo-600" /><div className="flex-1"><div className="text-13 font-semibold text-slate-900">Desktop</div><div className="text-12 text-slate-500">{d.tracked} keyword{d.tracked !== 1 ? 's' : ''} checked</div></div><Badge tone="green">Active</Badge></div>
        <div className="rounded border border-slate-200 p-4 flex items-center gap-3 opacity-60"><Smartphone size={18} className="text-slate-500" /><div className="flex-1"><div className="text-13 font-semibold text-slate-900">Mobile</div><div className="text-12 text-slate-500">Not tracked yet</div></div><Badge>Planned</Badge></div>
        <div className="rounded border border-slate-200 p-4 flex items-center gap-3 sm:col-span-2"><MapPin size={18} className="text-indigo-600" /><div className="flex-1"><div className="text-13 font-semibold text-slate-900">{d.location || 'Google'}{d.country ? ` · ${d.country}` : ''}</div><div className="text-12 text-slate-500">The location Google results are read for. It follows the business's target market.</div></div><Badge tone="green">Active</Badge></div>
      </div>
    </Card>
  );
}
