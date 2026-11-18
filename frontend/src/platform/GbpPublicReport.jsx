import React, { useState } from 'react';
import { Star, Download, FileSearch } from 'lucide-react';
import { Card, Badge, Button, ErrorNote, useAction, useToast, SkList, ScoreRing, Meter, refreshBusinesses } from './SeoUi';
import { api, useApi } from './seoApi';

const TONE = { ok: ['Good', 'green'], warn: ['Improve', 'amber'], bad: ['Fix', 'red'] };
const IMPACT = { high: 'red', medium: 'amber', low: 'gray' };
const TH = 'px-3 py-2.5 text-left font-medium whitespace-nowrap';
const H = 'text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1.5';

function markdown(b, d) {
  const p = d.profile, a = d.analysis;
  const L = [`# Google Business Profile report: ${p.title || b.name}`, '', `Score: ${a.score}/100 (${a.word}). Read from Google on ${String(p.read_at).slice(0, 10)}.`, '',
    '## What Google shows', `- Main category: ${p.category || '-'}`, `- Extra categories: ${(p.additional_categories || []).join(', ') || '-'}`, `- Rating: ${p.rating ?? '-'} from ${p.votes} reviews`, `- Photos: ${p.photos ?? '-'}`,
    `- Claimed: ${p.claimed ? 'yes' : 'no'}`, `- Phone: ${p.phone || '-'}`, `- Website: ${p.website || '-'}`, `- Services listed: ${(p.services || []).length}`, '', '## Checklist'];
  a.checks.forEach(c => L.push(`- [${c.status === 'ok' ? 'x' : ' '}] ${c.label}: ${c.detail}${c.fix && c.status !== 'ok' ? ` -> ${c.fix}` : ''}`));
  L.push('', '## Roadmap');
  a.roadmap.forEach(ph => { L.push('', `### ${ph.when}`); ph.items.forEach(i => L.push(`- ${i.what} (${i.impact} impact) ${i.why}`)); });
  if (d.posts) { L.push('', '## Recent posts'); d.posts.slice(0, 10).forEach(x => L.push(`- ${x.date}: ${x.text.slice(0, 120)}`)); }
  return L.join('\n');
}

/** The public Google Business Profile read live, an analysis scored from it, and a 7 / 30 / 90 day roadmap. */
export default function GbpPublicReport({ b }) {
  const r = useApi(`/businesses/${b.id}/maps-public/profile`);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const [full, setFull] = useState(null);
  const d = full || (r.data?.state === 'ok' ? r.data : null);
  const runFull = () => run('full', async () => { setFull(await api(`/businesses/${b.id}/maps-public/report`, { method: 'POST' })); });
  const use = (fields) => run('use', async () => { const x = await api(`/businesses/${b.id}/maps-public/apply-profile`, { method: 'POST', body: { fields } }); await refreshBusinesses(); toast(`Saved from Google: ${x.applied.join(', ') || 'nothing to change'}`); });
  const download = () => {
    const url = URL.createObjectURL(new Blob([markdown(b, d)], { type: 'text/markdown' }));
    const a = document.createElement('a'); a.href = url; a.download = `gbp-report-${(b.name || 'profile').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`; a.click(); URL.revokeObjectURL(url);
  };
  const p = d?.profile, a = d?.analysis;
  const mineSec = (b.secondary_categories || []).join(', ');
  const theirSec = (p?.additional_categories || []).join(', ');
  const diffs = !p || b.gbp_location ? [] : [
    ['primary_category', 'Main category', p.category, b.primary_category], ['secondary_categories', 'Extra categories', theirSec, mineSec], ['description', 'Description', p.description, b.description],
  ].filter(([, , g, m]) => g && String(g).trim().toLowerCase() !== String(m || '').trim().toLowerCase());
  const dist = p?.distribution || {}; const total = Object.values(dist).reduce((x, y) => x + y, 0) || 1;
  return (
    <Card title="Google profile: what it shows, analysis and roadmap" subtitle="Read live from the public Google Business Profile. The score and roadmap come only from what was read."
      action={d ? <span className="flex gap-2"><Button size="sm" icon={FileSearch} busy={busy === 'full'} onClick={runFull}>{d.posts ? 'Read again with posts' : 'Add the posts (20 seconds)'}</Button><Button size="sm" icon={Download} onClick={download}>Download report</Button></span> : null}>
      <ErrorNote>{error}</ErrorNote>
      {!r.data && !r.error && <SkList rows={5} />}
      {r.error && <p className="text-13 text-red-600">{r.error.message}</p>}
      {r.data && r.data.state !== 'ok' && !full && <p className="text-13 text-amber-800">{r.data.message}</p>}
      {d && (
        <div className="grid gap-6 text-13">
          <div className="flex flex-wrap items-center gap-6">
            <ScoreRing score={a.score} label={a.word} />
            <div className="grid gap-1">
              <div className="flex gap-2"><Badge tone="green">{a.counts.ok} good</Badge><Badge tone="amber">{a.counts.warn} to improve</Badge><Badge tone="red">{a.counts.bad} to fix</Badge></div>
              <p className="text-slate-600 max-w-xl">Scored from {a.checks.length} checks of the public profile{a.posts_read ? '' : '. Posts are not read yet: press “Add the posts” to include them'}. It is our score, not a Google score.</p>
            </div>
          </div>

          {diffs.length > 0 && (
            <div className="rounded-lg bg-amber-50 px-4 py-3 grid gap-2">
              <div className="font-semibold text-amber-900">This project differs from what Google shows</div>
              <ul className="text-amber-900/90 grid gap-0.5">{diffs.map(([k, l, g, m]) => <li key={k}><b>{l}:</b> Google has “{String(g).slice(0, 110)}{String(g).length > 110 ? '…' : ''}”; the project has {m ? `“${String(m).slice(0, 80)}”` : 'nothing'}.</li>)}</ul>
              <div><Button size="sm" variant="primary" busy={busy === 'use'} onClick={() => use(diffs.map(x => x[0]))}>Use what Google shows</Button></div>
            </div>
          )}

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="grid gap-4 content-start">
              <div><h4 className={H}>Categories</h4><div className="flex flex-wrap gap-1.5"><Badge tone="blue">{p.category || 'No main category'}</Badge>{p.additional_categories.map(c => <Badge key={c} tone="gray">{c}</Badge>)}</div></div>
              <div><h4 className={H}>Description ({p.description.length}/750)</h4><p className="text-slate-700 whitespace-pre-line">{p.description || <span className="text-slate-400">No description.</span>}</p></div>
              <div><h4 className={H}>Reviews</h4>
                <div className="flex items-center gap-2 mb-2"><Star className="w-4 h-4 text-amber-500" /><b className="text-slate-900">{p.rating ?? '—'}</b><span className="text-slate-500">from {p.votes} reviews · {p.photos ?? '—'} photos · {p.claimed ? 'claimed' : 'not claimed'}</span></div>
                {[5, 4, 3, 2, 1].map(n => <div key={n} className="flex items-center gap-2 text-12 text-slate-600"><span className="w-6">{n}★</span><div className="flex-1"><Meter value={dist[n] || 0} max={total} height={6} /></div><span className="w-8 text-right tabular-nums">{dist[n] || 0}</span></div>)}</div>
            </div>
            <div className="grid gap-4 content-start">
              <div><h4 className={H}>Hours Google shows</h4>{p.hours.length ? <ul className="text-slate-700">{p.hours.map(h => <li key={h}>{h}</li>)}</ul> : <p className="text-slate-400">No hours.</p>}</div>
              <div><h4 className={H}>What customers mention most</h4>{p.topics.length ? <div className="flex flex-wrap gap-1.5">{p.topics.map(t => <Badge key={t.topic} tone="gray" title={`${t.mentions} mentions`}>{t.topic} · {t.mentions}</Badge>)}</div> : <p className="text-slate-400">Nothing yet.</p>}</div>
              <div><h4 className={H}>Services listed</h4>{p.services.length ? <ul className="text-slate-700">{p.services.map((s, i) => <li key={i}>{typeof s === 'string' ? s : s.name || JSON.stringify(s)}</li>)}</ul> : <p className="text-slate-400">No services listed on the profile.</p>}</div>
              <div><h4 className={H}>Attributes</h4>{p.attributes.length ? <div className="flex flex-wrap gap-1.5">{p.attributes.map(x => <Badge key={x} tone="green">{x}</Badge>)}</div> : <p className="text-slate-400">None set.</p>}</div>
            </div>
          </div>

          {d.posts && (
            <div><h4 className={H}>Recent posts ({d.posts.length})</h4>
              {d.posts.length ? <ul className="grid gap-2">{d.posts.slice(0, 6).map((x, i) => <li key={i} className="rounded-lg bg-slate-50 px-3 py-2"><span className="text-12 font-semibold text-slate-500">{x.date}</span><p className="text-slate-700 mt-0.5">{x.text.slice(0, 220)}{x.text.length > 220 ? '…' : ''}</p></li>)}</ul> : <p className="text-slate-400">No posts found.</p>}</div>
          )}

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
      )}
      {toastNode}
    </Card>
  );
}
