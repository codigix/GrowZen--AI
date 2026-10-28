import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, RefreshCw, AlertTriangle, CircleHelp, CircleDashed, ShieldCheck, Wand2, Check, Loader2 } from 'lucide-react';
import { Card, Button, ErrorNote, useAction } from './SeoUi';
import { api } from './seoApi';

/**
 * Onboarding assistant (POST /discover/assist): every key detail cross-checked against Google Maps and the
 * business's website, the problems found, and suggestions (category, description, services, real local
 * keywords, map pin). The check runs once on arrival; suggestions show next to the field they belong to.
 * Nothing in the form changes without a click.
 */

export const STATUS = {
  verified: { label: 'Verified', icon: ShieldCheck, tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  conflict: { label: 'Sources disagree', icon: AlertTriangle, tone: 'bg-red-50 text-red-700 ring-red-200' },
  suggested: { label: 'Found', icon: Wand2, tone: 'bg-indigo-50 text-indigo-700 ring-indigo-200' },
  single_source: { label: 'One source', icon: CircleHelp, tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
  only_typed: { label: 'Not confirmed', icon: CircleHelp, tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
  missing: { label: 'Not found', icon: CircleDashed, tone: 'bg-slate-50 text-slate-500 ring-slate-200' }
};
const LEVEL = { critical: 'text-red-700', serious: 'text-orange-700', warning: 'text-amber-800', info: 'text-slate-600' };

/** What the profile still needs, live as the form changes. */
export function completeness(form) {
  const items = [
    ['Name', form.name.trim()], ['Category', form.primary_category.trim()], ['Description (250+ characters)', form.description.trim().length >= 250],
    ['Phone (10 digits)', String(form.phone).replace(/\D/g, '').length >= 10], ['Website', form.website.trim()], ['Address with PIN code', /\b[1-9]\d{5}\b/.test(form.address)],
    ['Area and city', form.area.trim() && form.city.trim()], ['Map pin', form.lat != null], ['3+ services', form.services.length >= 3],
    ['3+ keywords', form.keywords.length >= 3], ['Contact email', form.contact_email.trim()]
  ];
  const done = items.filter(i => i[1]).length;
  return { done, total: items.length, pct: Math.round((done / items.length) * 100), missing: items.filter(i => !i[1]).map(i => i[0]) };
}

export function SourceTag({ source }) {
  return <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ring-1 ring-inset whitespace-nowrap ${source === 'AI' ? 'bg-violet-50 text-violet-700 ring-violet-200' : 'bg-slate-50 text-slate-500 ring-slate-200'}`}>{source === 'AI' ? 'AI' : `from ${source}`}</span>;
}

/** Runs the check once when the step opens (and again on demand). */
export function useAssist(form, source) {
  const [res, setRes] = useState(null);
  const [busy, error, run] = useAction();
  const started = useRef(false);
  const check = () => run('check', async () => {
    const body = { name: form.name, primary_category: form.primary_category, description: form.description, phone: form.phone, website: form.website,
      address: form.address, area: form.area, city: form.city, services: form.services, place_id: source?.source === 'google_maps' ? source.place_id : null };
    setRes(await api('/discover/assist', { method: 'POST', body }));
  });
  useEffect(() => { if (!started.current && form.name.trim()) { started.current = true; check(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // A value picked by hand counts as verified only when two or more sources back it.
  const resolve = (field, value, sources = []) => setRes(r => r && ({ ...r, fields: { ...r.fields, [field]: { ...r.fields[field], status: sources.length >= 2 ? 'verified' : 'single_source', chosen: value } } }));
  return { res, busy: busy === 'check', error, check, resolve };
}

/** A field's check, shown next to its label. */
export function FieldBadge({ check }) {
  if (!check) return null;
  const st = STATUS[check.status] || STATUS.missing;
  const by = check.options?.[0]?.sources?.join(' + ');
  return <span title={by ? `${st.label}: ${by}` : st.label} className={`inline-flex items-center gap-1 text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md ring-1 ring-inset ${st.tone}`}><st.icon size={10} /> {st.label}</span>;
}

/** Under a field: the values the sources found when they differ from (or fill) what's typed. */
export function FieldFix({ field, check, value, onPick }) {
  if (!check || !['conflict', 'suggested'].includes(check.status)) return null;
  const options = check.options.filter(o => o.value !== value);
  if (!options.length) return null;
  return (
    <div className="mt-1.5 space-y-1">
      {options.map(o => (
        <div key={o.value} className="flex items-center gap-2 rounded-lg bg-indigo-50/60 ring-1 ring-inset ring-indigo-100 px-2.5 py-1.5">
          <Wand2 size={12} className="text-indigo-500 shrink-0" />
          <span className="flex-1 min-w-0 text-[12px] text-slate-800 truncate" title={o.value}>{o.value} <span className="text-slate-400">· {o.sources.join(' + ')}</span></span>
          <button type="button" onClick={() => onPick(field, o.value, o.sources)} className="text-[11.5px] font-semibold text-indigo-700 hover:underline cursor-pointer shrink-0">Use</button>
        </div>
      ))}
    </div>
  );
}

/** A suggested value (category, description, name) with where it came from. */
export function Suggestion({ label, value, source, inUse, onUse, long = false }) {
  if (!value) return null;
  return (
    <div className="mt-1.5 rounded-lg bg-violet-50/60 ring-1 ring-inset ring-violet-100 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <Sparkles size={12} className="text-violet-500 shrink-0" />
        <span className="text-[11.5px] font-semibold text-slate-700">{label}</span>
        <SourceTag source={source} />
        <span className="ml-auto shrink-0">{inUse ? <span className="text-[11.5px] text-emerald-700 inline-flex items-center gap-1"><Check size={12} /> In use</span>
          : <button type="button" onClick={onUse} className="text-[11.5px] font-semibold text-violet-700 hover:underline cursor-pointer">Use</button>}</span>
      </div>
      <div className={`mt-1 text-[12px] text-slate-800 ${long ? 'leading-relaxed' : 'truncate'}`} title={long ? undefined : value}>{value}</div>
    </div>
  );
}

function Ring({ pct }) {
  return (
    <div className="relative w-12 h-12 shrink-0">
      <svg viewBox="0 0 36 36" className="w-12 h-12 -rotate-90"><circle cx="18" cy="18" r="15.5" fill="none" stroke="#e2e8f0" strokeWidth="3.5" />
        <circle cx="18" cy="18" r="15.5" fill="none" stroke={pct >= 90 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#ef4444'} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${(pct / 100) * 97.4} 97.4`} /></svg>
      <span className="absolute inset-0 flex items-center justify-center text-[12px] font-bold text-slate-900">{pct}%</span>
    </div>
  );
}

/** The side summary: completeness, what was checked, problems, and Apply all. */
export function AssistantPanel({ assist, form, onApplyAll, onUseName }) {
  const { res, busy, error, check } = assist;
  const score = completeness(form);
  const fields = res ? Object.values(res.fields) : [];
  const verified = fields.filter(f => f.status === 'verified').length;
  const conflicts = fields.filter(f => f.status === 'conflict').length;
  const s = res?.suggestions;
  return (
    <Card title={<span className="inline-flex items-center gap-2"><Sparkles size={15} className="text-violet-600" /> Assistant {res && <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ring-1 ring-inset ${res.ai ? 'bg-violet-50 text-violet-700 ring-violet-200' : 'bg-slate-50 text-slate-500 ring-slate-200'}`}>{res.ai ? 'AI' : 'Rules'}</span>}</span>}
      action={<Button size="sm" variant="ghost" icon={RefreshCw} busy={busy} onClick={check}>{res ? 'Re-check' : 'Check'}</Button>}>
      <div className="flex items-center gap-3">
        <Ring pct={score.pct} />
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-slate-900">{score.pct >= 90 ? 'Ready to launch' : `${score.done} of ${score.total} complete`}</div>
          <div className="text-[11.5px] text-slate-500 line-clamp-2" title={score.missing.join(', ')}>{score.missing.length ? `Needs: ${score.missing.join(', ')}` : 'Everything Google needs is filled in.'}</div>
        </div>
      </div>
      <ErrorNote>{error}</ErrorNote>
      {busy && !res && <div className="mt-3 flex items-center gap-2 text-[12.5px] text-slate-500"><Loader2 size={14} className="animate-spin" /> Checking Google Maps and the website…</div>}
      {res && (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5 text-[11.5px]">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200"><ShieldCheck size={11} /> {verified} of {fields.length} verified</span>
            {conflicts > 0 && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-50 text-red-700 ring-1 ring-inset ring-red-200"><AlertTriangle size={11} /> {conflicts} to resolve</span>}
          </div>
          <div className="mt-1.5 text-[11px] text-slate-500">Checked against {[res.maps.matched && 'Google Maps', res.website.read && 'the website'].filter(Boolean).join(' and ') || 'what was typed only'}.</div>
          {res.checks.length > 0 && (
            <ul className="mt-3 space-y-1.5 rounded-xl bg-amber-50/70 ring-1 ring-inset ring-amber-200 px-3 py-2.5">
              {res.checks.map(c => <li key={c.text} className={`text-[12px] leading-snug flex gap-1.5 ${LEVEL[c.level]}`}><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {c.text}</li>)}
              {s?.name && form.name !== s.name.value && (
                <li className="pt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-slate-700">Registered name: <b>{s.name.value}</b>
                  <button type="button" onClick={onUseName} className="font-semibold text-indigo-700 hover:underline cursor-pointer">Use it</button></li>
              )}
            </ul>
          )}
          <Button className="mt-3 w-full" variant="primary" icon={Wand2} onClick={onApplyAll}>Apply all suggestions</Button>
          <p className="mt-1.5 text-[11px] text-slate-500 text-center">Fills only empty fields; never overwrites what you typed.</p>
          {!res.ai && <p className="mt-2 text-[11px] text-slate-400">Add an AI key to have the description, category and services written by AI.</p>}
        </>
      )}
    </Card>
  );
}
