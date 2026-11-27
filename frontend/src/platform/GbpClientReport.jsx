import React from 'react';
import { Star, ShieldCheck, Camera, Search, TrendingUp, CheckCircle2, AlertTriangle, ArrowRight, Sparkles, MapPin, Phone, Globe, Clock } from 'lucide-react';
import { ScoreRing, Badge, Button } from './SeoUi';

const GREEN = '#059669', AMBER = '#d97706', RED = '#dc2626', INDIGO = '#4f46e5';
const tone = (v) => (v == null ? '#94a3b8' : v >= 80 ? GREEN : v >= 55 ? AMBER : RED);
const PILLAR_ICON = { reputation: Star, profile: ShieldCheck, activity: Camera, search: Search };
const IMPACT = { high: ['High impact', 'red'], medium: ['Medium impact', 'amber'], low: ['Quick win', 'gray'] };
const impactOf = (c) => (c.weight >= 8 ? 'high' : c.weight >= 5 ? 'medium' : 'low');
const H2 = 'text-18 font-bold text-slate-900';

const day = (iso) => { try { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }); } catch { return ''; } };

function Bar({ value, color, h = 8 }) {
  return <div className="w-full rounded-full bg-slate-100 overflow-hidden" style={{ height: h }}><div className="h-full rounded-full" style={{ width: `${Math.max(value == null ? 0 : 3, Math.min(100, value || 0))}%`, background: color }} /></div>;
}

/** A small bar chart of the website's clicks per day from Search Console. */
function Daily({ points }) {
  const max = Math.max(1, ...points.map(p => p.clicks));
  return (
    <div className="flex items-end gap-[3px] h-16" role="img" aria-label="Clicks from Google Search per day">
      {points.map(p => <div key={p.date} title={`${p.date}: ${p.clicks} clicks`} className="flex-1 rounded-sm bg-indigo-400/80" style={{ height: `${Math.max(4, (p.clicks / max) * 100)}%` }} />)}
    </div>
  );
}

/** The report as a client reads it: where the profile stands, what is working, what is costing calls and enquiries, how it gets fixed, and the plan. */
export default function ClientReport({ b, d, diffs = [], onUse, busyUse, print = false }) {
  const p = d.profile, a = d.analysis, sc = d.search;
  const gaps = a.gaps || [], strengths = a.strengths || [], unverified = a.unverified || [];
  const plan = a.roadmap || [];
  const weakPillars = (a.pillars || []).filter(x => x.score != null && x.score < 85);
  return (
    <div className={`grid gap-8 text-14 text-slate-700 ${print ? 'p-8' : ''}`}>
      {/* ---------- hero */}
      <section className="rounded-2xl p-6 sm:p-8 text-white" style={{ background: 'linear-gradient(135deg,#312e81 0%,#4f46e5 55%,#7c3aed 100%)' }}>
        <div className="flex flex-wrap items-center gap-8">
          <div className="rounded-2xl bg-white p-3 shadow-lg"><ScoreRing score={a.score} size={132} label={a.word} /></div>
          <div className="min-w-0 flex-1 basis-80">
            <div className="text-12 font-semibold uppercase tracking-widest text-indigo-200">Google presence report</div>
            <h2 className="mt-1 text-24 sm:text-32 font-bold leading-tight">{p.title || b.name}</h2>
            <p className="mt-2 text-16 leading-snug text-indigo-50">{a.headline}</p>
            {unverified.length > 0 && <p className="mt-2 text-12.5 text-indigo-200">The score covers the {a.checks.length} checks we can run from outside. {unverified.length} more need access to your profile, so the real picture may be lower.</p>}
            <div className="mt-4 flex flex-wrap gap-2 text-12 font-semibold">
              <span className="rounded-full bg-white/15 px-3 py-1">{gaps.length} to fix</span>
              {unverified.length > 0 && <span className="rounded-full bg-white/15 px-3 py-1">{unverified.length} we cannot see from outside</span>}
              <span className="rounded-full bg-white/15 px-3 py-1">{day(p.read_at)}</span>
            </div>
          </div>
        </div>
        {(gaps.length > 0 || unverified.length > 0) && (
          <div className="mt-6 rounded-xl bg-white/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-13 font-semibold"><span>Your score today: {a.score}</span><span className="inline-flex items-center gap-1.5"><TrendingUp size={15} />{a.potential > a.score ? `After the fixes below: about ${a.potential}` : 'Room to grow once we can see the rest'}</span></div>
            <div className="mt-2 relative h-3 rounded-full bg-white/20 overflow-hidden"><div className="absolute inset-y-0 left-0 rounded-full bg-white/40" style={{ width: `${a.potential}%` }} /><div className="absolute inset-y-0 left-0 rounded-full bg-white" style={{ width: `${a.score}%` }} /></div>
            <p className="mt-2 text-12 text-indigo-100">This is our own score from the checks in this report. It shows how complete the profile is, and is not a Google ranking.</p>
          </div>
        )}
      </section>

      {/* ---------- what is costing calls */}
      {gaps.length > 0 && (
        <section>
          <h3 className={H2}>What is costing you calls and enquiries</h3>
          <p className="text-13 text-slate-500 mt-0.5">Each gap, why it matters to a customer, and how we fix it for you. Start at the top: the first ones matter most.</p>
          <div className="mt-3 grid gap-3">
            {gaps.map((c, i) => {
              const [lab, t] = IMPACT[impactOf(c)]; return (
                <div key={c.key} className="rounded-xl bg-white ring-1 ring-slate-200 shadow-sm overflow-hidden">
                  <div className="flex items-start gap-3 p-4">
                    <span className="mt-0.5 w-7 h-7 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-13 font-bold shrink-0">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold text-slate-900">{c.label}</h4><Badge tone={t}>{lab}</Badge></div>
                      <p className="mt-1 text-13 text-slate-600"><b className="text-slate-800">What we found:</b> {c.detail}</p>
                      {c.why_it_matters && <p className="mt-1 text-13 text-slate-600"><b className="text-slate-800">Why it matters:</b> {c.why_it_matters}</p>}
                    </div>
                  </div>
                  <div className="bg-indigo-50/70 px-4 py-3 border-t border-indigo-100 text-13 flex gap-2.5">
                    <Sparkles size={16} className="text-indigo-600 mt-0.5 shrink-0" />
                    <div className="min-w-0"><b className="text-indigo-900">What to do:</b> <span className="text-slate-700">{c.fix}</span>{c.help && <div className="mt-1 text-slate-600"><b className="text-indigo-900">With {c.help.title}:</b> {c.help.text}</div>}</div>
                  </div>
                </div>);
            })}
          </div>
        </section>
      )}

      {unverified.length > 0 && (
        <section>
          <h3 className={H2}>What we cannot see from outside, and where profiles lose enquiries</h3>
          <p className="text-13 text-slate-500 mt-0.5">Google shows these only to the owner. We would check and set each one up for you.</p>
          <div className="mt-3 grid sm:grid-cols-2 gap-3">
            {unverified.map(u => (
              <div key={u.key} className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-4">
                <div className="flex items-center gap-2 font-semibold text-slate-900"><AlertTriangle size={16} className="text-slate-500 shrink-0" />{u.label}<span className="text-11 font-semibold rounded-full bg-slate-200 text-slate-700 px-2 py-0.5">Not confirmed</span></div>
                <p className="mt-1.5 text-13 text-slate-600">{u.why_it_matters}</p>
                <p className="mt-1.5 text-12.5 text-indigo-800"><b>With {u.help.title}:</b> {u.help.text}</p>
              </div>))}
          </div>
        </section>
      )}

      {/* ---------- where you stand */}
      <section>
        <h3 className={H2}>Where you stand</h3>
        <p className="text-13 text-slate-500 mt-0.5">Four things decide whether a person who finds you picks up the phone.</p>
        <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {a.pillars.map(x => {
            const I = PILLAR_ICON[x.key] || Star; const c = tone(x.score); return (
              <div key={x.key} className="rounded-xl bg-white ring-1 ring-slate-200 p-4 shadow-sm">
                <div className="flex items-center gap-2.5"><span className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: `${c}1a`, color: c }}><I size={18} /></span>
                  <div className="min-w-0"><div className="font-semibold text-slate-900 leading-tight">{x.label}</div><div className="text-11.5 text-slate-500 leading-tight">{x.sub}</div></div></div>
                <div className="mt-3 flex items-baseline gap-1"><span className="text-26 font-bold tabular-nums" style={{ color: c }}>{x.score ?? '—'}</span>{x.score != null && <span className="text-12 text-slate-400">/ 100</span>}</div>
                <Bar value={x.score} color={c} />
                {x.missing?.length > 0 && <p className="mt-2 text-11.5 text-slate-500">Not measured yet: {x.missing.join(', ')}. {x.score == null ? 'Connect Search Console and the Google profile to include it.' : 'Connect the Google profile to include it.'}</p>}
              </div>);
          })}
        </div>
      </section>

      {/* ---------- you against nearby businesses */}
      {d.compare && (
        <section>
          <h3 className={H2}>How you compare with nearby businesses</h3>
          <p className="text-13 text-slate-500 mt-0.5">Google rating of you and the businesses saved as your competitors. {d.compare.rank === 1 ? 'You lead on rating.' : `You are number ${d.compare.rank} of ${d.compare.others.length + 1} on rating.`}</p>
          <div className="mt-3 grid gap-2">
            {[{ ...d.compare.you, you: true }, ...d.compare.others].sort((x, y) => (y.rating || 0) - (x.rating || 0)).map((x, i) => (
              <div key={`${x.name}${i}`} className="flex items-center gap-3 text-13">
                <span className={`w-44 shrink-0 truncate ${x.you ? 'font-bold text-indigo-700' : 'text-slate-700'}`} title={x.name}>{x.you ? 'You' : x.name}</span>
                <div className="flex-1"><Bar value={((x.rating || 0) / 5) * 100} color={x.you ? INDIGO : '#94a3b8'} h={10} /></div>
                <span className="w-24  tabular-nums"><b>{x.rating}</b> <span className="text-slate-400">{x.reviews ? `· ${x.reviews}` : ''}</span></span>
              </div>))}
          </div>
        </section>
      )}

      {/* ---------- Google Search */}
      <section>
        <h3 className={H2}>How people find your website on Google</h3>
        {sc?.state === 'ok' ? (
          <div className="mt-3 grid gap-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[['Visits from Google', sc.totals.clicks, sc.previous.clicks], ['Times you appeared', sc.totals.impressions, sc.previous.impressions], ['Click rate', `${sc.totals.ctr}%`, null], ['Average position', sc.totals.position ?? '—', null]].map(([l, v, was]) => (
                <div key={l} className="rounded-xl bg-white ring-1 ring-slate-200 p-4 shadow-sm"><div className="text-12 text-slate-500">{l}</div><div className="text-24 font-bold tabular-nums text-slate-900">{typeof v === 'number' ? v.toLocaleString() : v}</div>
                  {was != null && <div className="text-11.5 text-slate-400">{was.toLocaleString()} in the 28 days before</div>}</div>))}
            </div>
            {sc.timeline?.length > 0 && <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4"><div className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-2">Visits per day, last 28 days</div><Daily points={sc.timeline} /></div>}
            <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200 bg-white">
              <table className="w-full min-w-[520px] text-13"><thead className="bg-slate-50 text-12 uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2.5 text-left font-medium">What people typed</th><th className="px-3 py-2.5 text-right font-medium">Times shown</th><th className="px-3 py-2.5 text-right font-medium">Visits</th><th className="px-3 py-2.5 text-right font-medium">Position</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{sc.keywords.slice(0, 8).map(k => <tr key={k.query}><td className="px-3 py-2 text-slate-800">{k.query}</td><td className="px-3 py-2  tabular-nums">{k.impressions}</td><td className="px-3 py-2  tabular-nums">{k.clicks}</td><td className="px-3 py-2  tabular-nums">{k.position}</td></tr>)}</tbody></table>
            </div>
            <p className="text-12 text-slate-500">From Google Search Console, {sc.period.start} to {sc.period.end}.</p>
          </div>
        ) : <p className="mt-2 rounded-xl bg-slate-50 px-4 py-3 text-13 text-slate-600">{sc?.message || 'Search figures are not available.'} Once it is connected, this section shows how many people find the website on Google, what they typed, and whether it is growing.</p>}
      </section>

      {/* ---------- the plan */}
      <section>
        <h3 className={H2}>Your plan to get more calls and enquiries</h3>
        <p className="text-13 text-slate-500 mt-0.5">In order: the quick wins first, then the work that keeps growing the profile.</p>
        <div className="mt-4 grid lg:grid-cols-3 gap-3">
          {plan.map((ph, i) => (
            <div key={ph.when} className="rounded-2xl ring-1 ring-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2.5"><span className="w-8 h-8 rounded-full text-white flex items-center justify-center font-bold text-14" style={{ background: [GREEN, INDIGO, '#7c3aed'][i] }}>{i + 1}</span><div><div className="font-bold text-slate-900 leading-tight">{ph.when}</div><div className="text-11.5 text-slate-500">{['Quick wins', 'Build momentum', 'Grow and compound'][i]}</div></div></div>
              <ul className="mt-3 grid gap-2.5">{ph.items.length ? ph.items.map((it, k) => (
                <li key={k} className="flex gap-2 text-13"><ArrowRight size={14} className="mt-1 text-slate-400 shrink-0" /><span><span className="text-slate-800">{it.what}</span><span className="block text-11.5 text-slate-500">{it.why}</span></span></li>)) : <li className="text-slate-400 text-13">Nothing urgent here.</li>}</ul>
            </div>))}
        </div>
      </section>

      {/* ---------- what is on the profile today */}
      <section>
        <h3 className={H2}>What your profile shows today</h3>
        <div className="mt-3 grid lg:grid-cols-2 gap-4 text-13">
          <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4 grid gap-2.5">
            <div className="flex items-center gap-2"><Star size={16} className="text-amber-500" /><b className="text-slate-900 text-16">{p.rating ?? '—'}</b><span className="text-slate-500">from {p.votes} reviews</span></div>
            <div className="flex items-center gap-2"><MapPin size={15} className="text-slate-400 shrink-0" /><span>{p.address || 'No address shown'}</span></div>
            <div className="flex items-center gap-2"><Phone size={15} className="text-slate-400 shrink-0" /><span>{p.phone || 'No phone shown'}</span></div>
            <div className="flex items-center gap-2"><Globe size={15} className="text-slate-400 shrink-0" /><span className="truncate">{p.website || 'No website shown'}</span></div>
            <div className="flex flex-wrap gap-1.5 pt-1"><Badge tone="blue">{p.category || 'No main category'}</Badge>{p.additional_categories.slice(0, 6).map(x => <Badge key={x} tone="gray">{x}</Badge>)}{p.attributes.map(x => <Badge key={x} tone="green">{x}</Badge>)}</div>
          </div>
          <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4">
            <div className="flex items-center gap-2 font-semibold text-slate-900 mb-2"><Clock size={15} className="text-slate-400" />Opening hours</div>
            {p.hours.length ? <ul className="grid gap-0.5 text-slate-600">{p.hours.map(h => <li key={h}>{h}</li>)}</ul> : <p className="text-slate-400">No opening hours shown.</p>}
          </div>
        </div>
        {diffs.length > 0 && onUse && (
          <div className="mt-3 rounded-xl bg-amber-50 ring-1 ring-amber-100 px-4 py-3 flex flex-wrap items-center gap-3 text-13 print:hidden">
            <span className="text-amber-900">Your saved details differ from Google: {diffs.map(x => x[1]).join(', ')}.</span>
            <Button size="sm" variant="primary" busy={busyUse} onClick={() => onUse(diffs.map(x => x[0]))}>Use what Google shows</Button>
          </div>)}
      </section>

      {strengths.length > 0 && (
        <section className="rounded-xl bg-slate-50 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-13">
            <span className="font-semibold text-slate-800">Already in place, and we will protect it:</span>
            {strengths.map(x => <span key={x.key} className="inline-flex items-center gap-1 text-emerald-800"><CheckCircle2 size={14} className="text-emerald-600" />{x.label}</span>)}
          </div>
        </section>
      )}

      {/* ---------- call to action */}
      <section className="rounded-2xl p-6 sm:p-8 text-white" style={{ background: 'linear-gradient(135deg,#0f172a 0%,#1e1b4b 60%,#312e81 100%)' }}>
        <h3 className="text-22 font-bold">Let us handle this for you</h3>
        <p className="mt-1 text-indigo-100 text-14 max-w-3xl">You run the business. We do the profile work that brings in calls and enquiries, and send you a report every month so you can see it moving.</p>
        <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {(weakPillars.length ? weakPillars : a.pillars.filter(x => x.score != null)).map(x => (
            <div key={x.key} className="rounded-xl bg-white/10 p-3.5"><div className="font-semibold">{x.help.title}</div><p className="mt-1 text-12.5 text-indigo-100">{x.help.text}</p></div>))}
        </div>
        <ul className="mt-5 grid gap-1.5 text-13 text-indigo-100 sm:grid-cols-2">
          {['You approve everything before it goes live', 'A plain monthly report: searches, reviews and progress', 'We start with the quick wins at the top of the plan'].map(x => <li key={x} className="flex items-center gap-2"><CheckCircle2 size={15} className="text-emerald-300 shrink-0" />{x}</li>)}
        </ul>
        <p className="mt-5 text-11.5 text-indigo-300">Prepared with bevisibe AI on {day(p.read_at)}. Figures come from Google Maps and Google Search Console. The score is our own measure of how complete the profile is; it is not a Google ranking and no result is guaranteed.</p>
      </section>
    </div>
  );
}
