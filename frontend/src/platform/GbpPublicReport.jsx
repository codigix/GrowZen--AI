import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Star, Download, FileSearch, Printer, Copy } from 'lucide-react';
import { Card, Badge, Button, Modal, ErrorNote, useAction, useToast, SkList, ScoreRing, Meter, refreshBusinesses } from './SeoUi';
import MapsPublicCard from './MapsPublicCard';
import ClientReport from './GbpClientReport';
import { api, useApi } from './seoApi';

const TONE = { ok: ['Good', 'green'], warn: ['Improve', 'amber'], bad: ['Fix', 'red'] };
const IMPACT = { high: 'red', medium: 'amber', low: 'gray' };
const TH = 'px-3 py-2.5 text-left font-medium whitespace-nowrap';
const H = 'text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1.5';

function markdown(b, d) {
  const p = d.profile, a = d.analysis;
  const L = [`# Google Business Profile report: ${p.title || b.name}`, '', `Score: ${a.score}/100 (${a.word}). Read from Google (Maps and Search Console) on ${String(p.read_at).slice(0, 10)}.`, '',
    '## What Google shows', `- Main category: ${p.category || '-'}`, `- Rating: ${p.rating ?? '-'} from ${p.votes} reviews`, `- Photos: ${p.photos ?? '-'}`,
  `- Phone: ${p.phone || '-'}`, `- Website: ${p.website || '-'}`, ...(d.search?.state === 'ok' ? ['', '## Google Search (28 days)', `- ${d.search.totals.impressions} impressions, ${d.search.totals.clicks} clicks, average position ${d.search.totals.position ?? '-'}`, ...d.search.keywords.slice(0, 10).map(k => `- "${k.query}": ${k.impressions} impressions, position ${k.position}`)] : []), '', '## Checklist'];
  a.checks.forEach(c => L.push(`- [${c.status === 'ok' ? 'x' : ' '}] ${c.label}: ${c.detail}${c.fix && c.status !== 'ok' ? ` -> ${c.fix}` : ''}`));
  L.push('', '## Roadmap');
  a.roadmap.forEach(ph => { L.push('', `### ${ph.when}`); ph.items.forEach(i => L.push(`- ${i.what} (${i.impact} impact) ${i.why}`)); });
  if (d.posts) { L.push('', '## Recent posts'); d.posts.slice(0, 10).forEach(x => L.push(`- ${x.date}: ${x.text.slice(0, 120)}`)); }
  return L.join('\n');
}

function clientMessage(b, d) {
  const a = d.analysis, p = d.profile;
  const gaps = (a.gaps || []).slice(0, 3), unseen = (a.unverified || []).slice(0, 3);
  return [`Hello,`, '', `We checked the Google presence of ${p.title || b.name}. ${a.headline}`, '',
    ...(gaps.length ? ['What is costing you calls and enquiries:', ...gaps.map((g, i) => `${i + 1}. ${g.label}: ${g.detail}`), ''] : []),
    ...(unseen.length ? [`What Google hides from outside, which we would check for you: ${unseen.map(x => x.label.toLowerCase()).join(', ')}.`, ''] : []),
    ...(a.potential > a.score ? [`Fixing these would take the profile score from ${a.score} to about ${a.potential}.`, ''] : []),
    'We can handle all of this for you, and you approve everything before it goes live. Reply to this message and we will start with the quick wins.'].join('\n');
}

const PRINT_CSS = `@media print { body > *:not(#gbp-print-root) { display: none !important; } #gbp-print-root { display: block !important; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } section { break-inside: avoid; } }
@media screen { #gbp-print-root { display: none; } }`;

/** The public Google Business Profile read live, an analysis scored from it, and a 7 / 30 / 90 day roadmap. */
export default function GbpPublicReport({ b }) {
  const r = useApi(`/businesses/${b.id}/maps-public/profile`);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const [open, setOpen] = useState(false);
  const d = r.data?.state === 'ok' ? r.data : null;
  const copyMessage = async () => { try { await navigator.clipboard.writeText(clientMessage(b, d)); toast('Message copied: paste it into WhatsApp or email'); } catch { toast('Could not copy: select the text and copy it by hand'); } };
  const use = (fields) => run('use', async () => { const x = await api(`/businesses/${b.id}/maps-public/apply-profile`, { method: 'POST', body: { fields } }); await refreshBusinesses(); toast(`Saved from Google: ${x.applied.join(', ') || 'nothing to change'}`); });
  const download = () => {
    const url = URL.createObjectURL(new Blob([markdown(b, d)], { type: 'text/markdown' }));
    const a = document.createElement('a'); a.href = url; a.download = `gbp-report-${(b.name || 'profile').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`; a.click(); URL.revokeObjectURL(url);
  };
  const p = d?.profile, a = d?.analysis;
  const diffs = !p || b.gbp_location ? [] : [
    ['primary_category', 'Main category', p.category, b.primary_category],
  ].filter(([, , g, m]) => g && String(g).trim().toLowerCase() !== String(m || '').trim().toLowerCase());
  const dist = p?.distribution || null; const total = dist ? Object.values(dist).reduce((x, y) => x + y, 0) || 1 : 1;
  const sc = d?.search;
  const todo = d ? a.checks.filter(c => c.status !== 'ok').sort((x, y) => (x.status === 'bad' ? 0 : 1) - (y.status === 'bad' ? 0 : 1)).slice(0, 3) : [];
  const reportBody = d && (
    <div className="grid gap-6 text-13">
      {diffs.length > 0 && (
        <div className="rounded-lg bg-amber-50 px-4 py-3 grid gap-2">
          <div className="font-semibold text-amber-900">This project differs from what Google shows</div>
          <ul className="text-amber-900/90 grid gap-0.5">{diffs.map(([k, l, g, m]) => <li key={k}><b>{l}:</b> Google has “{String(g).slice(0, 110)}{String(g).length > 110 ? '…' : ''}”; the project has {m ? `“${String(m).slice(0, 80)}”` : 'nothing'}.</li>)}</ul>
          <div><Button size="sm" variant="primary" busy={busy === 'use'} onClick={() => use(diffs.map(x => x[0]))}>Use what Google shows</Button></div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="grid gap-4 content-start">
          <div><h4 className={H}>Category on Maps</h4><div className="flex flex-wrap gap-1.5"><Badge tone="blue">{p.category || 'No main category'}</Badge>{p.additional_categories.map(c => <Badge key={c} tone="gray" title="A place type Google lists for this business">{c}</Badge>)}</div></div>
          {p.description_known && <div><h4 className={H}>Description ({p.description.length}/750)</h4><p className="text-slate-700 whitespace-pre-line">{p.description || <span className="text-slate-400">No description.</span>}</p></div>}
          <div><h4 className={H}>Reviews</h4>
            <div className="flex items-center gap-2 mb-2"><Star className="w-4 h-4 text-amber-500" /><b className="text-slate-900">{p.rating ?? '—'}</b><span className="text-slate-500">from {p.votes} reviews · {p.photos ?? '—'}{p.photos_partial ? '+' : ''} photos{p.claimed == null ? '' : p.claimed ? ' · claimed' : ' · not claimed'}</span></div>
            {dist ? [5, 4, 3, 2, 1].map(n => <div key={n} className="flex items-center gap-2 text-12 text-slate-600"><span className="w-6">{n}★</span><div className="flex-1"><Meter value={dist[n] || 0} max={total} height={6} /></div><span className="w-8  tabular-nums">{dist[n] || 0}</span></div>)
              : <p className="text-12 text-slate-500">Google shows the average and the number of reviews, not the split by stars. The split appears once the profile is connected to Google.</p>}</div>
        </div>
        <div className="grid gap-4 content-start">
          <div><h4 className={H}>Hours Google shows</h4>{p.hours.length ? <ul className="text-slate-700">{p.hours.map(h => <li key={h}>{h}</li>)}</ul> : <p className="text-slate-400">No hours.</p>}</div>
          <div><h4 className={H}>Services</h4>{p.services.length ? <ul className="text-slate-700">{p.services.map((s, i) => <li key={i}>{typeof s === 'string' ? s : s.name || JSON.stringify(s)}</li>)}</ul> : <p className="text-slate-500">Google does not share the services list. Paste it in the Services step, or connect the Google account to read it.</p>}</div>
          <div><h4 className={H}>Attributes</h4>{p.attributes.length ? <div className="flex flex-wrap gap-1.5">{p.attributes.map(x => <Badge key={x} tone="green">{x}</Badge>)}</div> : <p className="text-slate-400">None set.</p>}</div>
        </div>
      </div>

      <div><h4 className={H}>Recent posts{d.posts ? ` (${d.posts.length})` : ''}</h4>
        {d.posts ? (d.posts.length ? <ul className="grid gap-2">{d.posts.slice(0, 6).map((x, i) => <li key={i} className="rounded-lg bg-slate-50 px-3 py-2"><span className="text-12 font-semibold text-slate-500">{x.date}</span><p className="text-slate-700 mt-0.5">{x.text.slice(0, 220)}{x.text.length > 220 ? '…' : ''}</p></li>)}</ul> : <p className="text-slate-400">No posts published from this app yet.</p>)
          : <p className="text-slate-500">Google shows posts to everyone but gives no way to read them. They appear here once the profile is connected to Google.</p>}</div>

      <div><h4 className={H}>Google Search: how the website does</h4>
        {sc?.state === 'ok' ? (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[['Clicks', sc.totals.clicks, sc.previous.clicks], ['Impressions', sc.totals.impressions, sc.previous.impressions], ['Click rate', `${sc.totals.ctr}%`, null], ['Average position', sc.totals.position ?? '—', null]].map(([l, v, was]) => (
              <div key={l} className="rounded-xl bg-white ring-1 ring-slate-200 p-3"><div className="text-12 text-slate-500">{l}</div><div className="text-20 font-bold tabular-nums text-slate-900">{typeof v === 'number' ? v.toLocaleString() : v}</div>{was != null && <div className="text-11 text-slate-400">{was.toLocaleString()} the 28 days before</div>}</div>))}</div>
            <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200"><table className="w-full min-w-[520px]"><thead className="bg-slate-50 text-12 uppercase tracking-wide text-slate-500"><tr><th className={TH}>Search people typed</th><th className={`${TH} text-right`}>Impressions</th><th className={`${TH} text-right`}>Clicks</th><th className={`${TH} text-right`}>Position</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{sc.keywords.slice(0, 10).map(k => <tr key={k.query}><td className="px-3 py-2 text-slate-800">{k.query}</td><td className="px-3 py-2  tabular-nums">{k.impressions}</td><td className="px-3 py-2  tabular-nums">{k.clicks}</td><td className="px-3 py-2  tabular-nums">{k.position}</td></tr>)}</tbody></table></div>
            <p className="text-12 text-slate-500">From Search Console ({sc.property}, {sc.period.start} to {sc.period.end}). These are searches for the website, which feed the profile's prominence.</p>
          </div>
        ) : <p className="text-slate-500">{sc?.message || 'Search Console figures are not available.'}</p>}</div>

      <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
        <table className="w-full min-w-[720px]">
          <thead className="bg-slate-50 text-12 uppercase tracking-wide text-slate-500"><tr><th className={TH}>Check</th><th className={TH}>Result</th><th className={TH}>What we read</th><th className={TH}>What to do</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{a.checks.map(c => (
            <tr key={c.key} className="align-top">
              <td className="px-3 py-2.5 font-medium text-slate-800">{c.label}</td>
              <td className="px-3 py-2.5 whitespace-nowrap"><Badge tone={TONE[c.status][1]}>{TONE[c.status][0]}</Badge></td>
              <td className="px-3 py-2.5 text-slate-600 max-w-[300px]">{c.detail}</td>
              <td className="px-3 py-2.5 text-slate-600 max-w-[340px]">{c.status === 'ok' ? <span className="text-slate-300">—</span> : c.fix}</td>
            </tr>))}</tbody>
        </table>
      </div>

      <div><h4 className={H}>Roadmap to grow the profile and your presence on Google</h4>
        <div className="grid lg:grid-cols-3 gap-3">{a.roadmap.map(ph => (
          <div key={ph.when} className="rounded-xl ring-1 ring-slate-200 p-3.5 grid gap-2 content-start">
            <div className="font-semibold text-slate-900">{ph.when}</div>
            {ph.items.length ? <ol className="grid gap-2.5 list-decimal pl-4">{ph.items.map((i, k) => <li key={k} className="text-slate-700"><span>{i.what}</span> <Badge tone={IMPACT[i.impact]}>{i.impact}</Badge><span className="block text-12 text-slate-500">{i.why}</span></li>)}</ol> : <p className="text-slate-400">Nothing urgent here.</p>}
          </div>))}</div></div>
    </div>
  );
  return (
    <Card title="Google profile report" subtitle="Scored from the Google Maps listing and Search Console. The score is ours, not Google's."
      action={d ? <span className="flex gap-2"><Button size="sm" variant="primary" icon={FileSearch} onClick={() => setOpen(true)}>View full report</Button><Button size="sm" icon={Download} onClick={download}>Download</Button></span> : null}>
      <ErrorNote>{error}</ErrorNote>
      {!r.data && !r.error && <SkList rows={3} />}
      {r.error && <p className="text-13 text-red-600">{r.error.message}</p>}
      {r.data && r.data.state !== 'ok' && !full && <p className="text-13 text-amber-800">{r.data.message}</p>}
      {d && (
        <div className="grid gap-4 text-13">
          <div className="flex flex-wrap items-center gap-6">
            <ScoreRing score={a.score} label={a.word} />
            <div className="grid gap-2 min-w-0 flex-1">
              <div className="flex flex-wrap gap-2"><Badge tone="green">{a.counts.ok} good</Badge><Badge tone="amber">{a.counts.warn} to improve</Badge><Badge tone="red">{a.counts.bad} to fix</Badge></div>
              {todo.length > 0 && <ul className="grid gap-1 text-slate-700">{todo.map(c => <li key={c.key} className="flex gap-2"><Badge tone={TONE[c.status][1]}>{TONE[c.status][0]}</Badge><span className="min-w-0"><b>{c.label}:</b> {c.detail}</span></li>)}</ul>}
            </div>
          </div>
          {diffs.length > 0 && <div className="flex flex-wrap items-center gap-2"><Button size="sm" busy={busy === 'use'} onClick={() => use(diffs.map(x => x[0]))}>Use what Google shows for {diffs.length} different detail{diffs.length === 1 ? '' : 's'}</Button><span className="text-12 text-slate-500">Fills the project from the public listing.</span></div>}
        </div>
      )}
      <Modal open={open && !!d} title="Google Business Profile report" onClose={() => setOpen(false)} width="max-w-6xl"
        footer={<div className="flex items-center gap-2 w-full"><span className="text-12 text-slate-500">Read from Google on {d ? String(p.read_at).slice(0, 10) : ''}</span>
          <Button size="sm" className="ml-auto" icon={Copy} onClick={copyMessage}>Copy message for the client</Button>
          <Button size="sm" icon={Printer} onClick={() => window.print()}>Print or save as PDF</Button>
          <Button size="sm" icon={Download} onClick={download}>Download (.md)</Button><Button size="sm" variant="primary" onClick={() => setOpen(false)}>Close</Button></div>}>
        <ErrorNote>{error}</ErrorNote>
        {d && <ClientReport b={b} d={d} diffs={diffs} onUse={use} busyUse={busy === 'use'} />}
        {d && (
          <details className="mt-8 rounded-xl ring-1 ring-slate-200 bg-white">
            <summary className="cursor-pointer px-4 py-3 font-semibold text-slate-800">The full checklist and the Google Maps listing (for your team)</summary>
            <div className="p-4 grid gap-6">{reportBody}<MapsPublicCard b={b} /></div>
          </details>
        )}
      </Modal>
      {toastNode}
      {open && d && createPortal(<div id="gbp-print-root"><style>{PRINT_CSS}</style><ClientReport b={b} d={d} diffs={[]} print /></div>, document.body)}
    </Card>
  );
}
