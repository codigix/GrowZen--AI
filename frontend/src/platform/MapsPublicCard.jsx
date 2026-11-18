import React from 'react';
import { Star, MapPin, RefreshCw, ExternalLink } from 'lucide-react';
import { Card, Badge, Button, ErrorNote, useAction, useToast, SkList, refreshBusinesses } from './SeoUi';
import { api, useApi } from './seoApi';

const STATUS = { open: ['Open', 'green'], closed_temporarily: ['Closed for now', 'amber'], closed_permanently: ['Closed for good', 'red'], unknown: ['Unknown', 'gray'] };
const TH = 'px-3 py-2.5 text-left font-medium whitespace-nowrap';

/** What anyone sees on the Google Maps listing (read through the Places API, no owner sign-in), set against what this project has saved. */
export default function MapsPublicCard({ b }) {
  const r = useApi(`/businesses/${b.id}/maps-public`);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const d = r.data;
  const again = () => run('fresh', async () => { await api(`/businesses/${b.id}/maps-public?fresh=1`); await r.reload(true); });
  const use = (fields) => run('use', async () => { const x = await api(`/businesses/${b.id}/maps-public/apply`, { method: 'POST', body: { fields } }); await refreshBusinesses(); r.reload(true); toast(`Saved from Google Maps: ${x.applied.join(', ') || 'nothing to change'}`); });
  const differs = (d?.compare || []).filter(c => !c.same);
  return (
    <Card title="Public info on Google Maps" subtitle="What anyone sees on this business's Google Maps listing. Read live, no Google sign-in needed."
      action={d?.state === 'ok' ? <Button size="sm" icon={RefreshCw} busy={busy === 'fresh'} onClick={again}>Read again</Button> : null}>
      <ErrorNote>{error}</ErrorNote>
      {!d && !r.error && <SkList rows={4} />}
      {r.error && <p className="text-13 text-red-600">{r.error.message}</p>}
      {d && d.state !== 'ok' && <p className="text-13 text-amber-800">{d.message}</p>}
      {d?.state === 'ok' && (
        <div className="grid gap-5 text-13">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="inline-flex items-center gap-1 font-semibold text-slate-900"><Star className="w-4 h-4 text-amber-500" />{d.reputation.rating ?? '—'}<span className="font-normal text-slate-500">· {d.reputation.count ?? 0} reviews</span></span>
            <span className="text-slate-600">{d.reputation.photos} photos shown by Maps</span>
            <Badge tone={STATUS[d.basics.status]?.[1] || 'gray'}>{STATUS[d.basics.status]?.[0] || 'Unknown'}</Badge>
            {d.basics.price && <span className="text-slate-600">Price {d.basics.price}</span>}
            {d.maps_url && <a href={d.maps_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-indigo-600 font-semibold hover:underline"><ExternalLink className="w-3.5 h-3.5" />Open on Maps</a>}
          </div>

          <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
            <table className="w-full min-w-[640px]">
              <thead className="bg-slate-50 text-12 uppercase tracking-wide text-slate-500"><tr><th className={TH}>Detail</th><th className={TH}>On Google Maps</th><th className={TH}>Saved in this project</th><th className={TH}>Match</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {d.compare.map(c => (
                  <tr key={c.field} className="align-top">
                    <td className="px-3 py-2.5 font-medium text-slate-700 whitespace-nowrap">{c.label}</td>
                    <td className="px-3 py-2.5 text-slate-900 max-w-[320px]">{c.maps}</td>
                    <td className="px-3 py-2.5 text-slate-600 max-w-[320px]">{c.yours || <span className="text-slate-300">Empty</span>}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{c.same ? <Badge tone="green">Same</Badge> : <Badge tone="amber">Different</Badge>}</td>
                  </tr>
                ))}
                {d.basics.categories.length > 0 && <tr><td className="px-3 py-2.5 font-medium text-slate-700">Categories shown</td><td colSpan={3} className="px-3 py-2.5 text-slate-900">{d.basics.categories.join(', ')}</td></tr>}
                {d.basics.plus_code && <tr><td className="px-3 py-2.5 font-medium text-slate-700 whitespace-nowrap"><MapPin className="inline w-3.5 h-3.5 mr-1" />Plus code</td><td colSpan={3} className="px-3 py-2.5 text-slate-900 font-mono text-12">{d.basics.plus_code}{d.basics.lat != null ? ` · ${d.basics.lat.toFixed(5)}, ${d.basics.lng.toFixed(5)}` : ''}</td></tr>}
              </tbody>
            </table>
          </div>
          {!d.linked && differs.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary" busy={busy === 'use'} onClick={() => use(differs.map(c => c.field))}>Use the Maps value for {differs.length} different detail{differs.length === 1 ? '' : 's'}</Button>
              <span className="text-12 text-slate-500">Copies what Maps shows into this project. Check each one first.</span>
            </div>
          )}
          {d.linked && differs.length > 0 && <p className="text-12 text-slate-500">This profile is connected to Google, so edit these details in the cards below: that updates Google itself.</p>}

          <div className="grid md:grid-cols-2 gap-5">
            <div><h4 className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Opening hours on Maps</h4>
              {d.hours.length ? <ul className="grid gap-0.5 text-slate-700">{d.hours.map(h => <li key={h}>{h}</li>)}</ul> : <p className="text-slate-400">No hours shown.</p>}
              {d.more_hours.map(m => <div key={m.name} className="mt-2"><div className="font-medium text-slate-600">{m.name}</div><ul className="text-slate-600">{m.days.map(h => <li key={h}>{h}</li>)}</ul></div>)}</div>
            <div><h4 className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Features and amenities</h4>
              {d.features.length ? <div className="flex flex-wrap gap-1.5">{d.features.map(f => <Badge key={f} tone="gray">{f}</Badge>)}</div> : <p className="text-slate-400">Maps lists none for this business.</p>}</div>
          </div>

          <div><h4 className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Recent reviews (the five Maps shares)</h4>
            {d.reputation.reviews.length ? <ul className="grid gap-2">{d.reputation.reviews.map((v, i) => <li key={i} className="rounded-lg bg-slate-50 px-3 py-2"><span className="font-semibold text-slate-900">{v.author || 'Reviewer'}</span> <span className="text-amber-600">{'★'.repeat(v.rating || 0)}</span> <span className="text-12 text-slate-400">{v.when}</span>{v.text && <p className="text-slate-700 mt-0.5">{v.text}</p>}</li>)}</ul> : <p className="text-slate-400">No reviews shown.</p>}</div>

          <p className="rounded-lg bg-slate-50 px-3 py-2 text-12.5 text-slate-600">Not part of Google's public data, so not shown here: {d.not_public.join('; ')}. Connect the Google account to read and edit those.</p>
        </div>
      )}
      {toastNode}
    </Card>
  );
}
