import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, Pencil, Loader2, RefreshCw, CheckCircle2, AlertTriangle, Users, MapPin, Search, Swords, ArrowRight, Target, ListChecks, Globe } from 'lucide-react';
import { Card, Button, Badge } from './SeoUi';
import { api, useApi } from './seoApi';

const tone = (s) => (s == null ? 'gray' : s >= 75 ? 'green' : s >= 45 ? 'amber' : 'red');
const when = (iso) => { try { return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };

function List({ icon: Icon, title, items, color = 'text-indigo-500' }) {
  if (!items || !items.length) return null;
  return (
    <div>
      <div className="flex items-center gap-1.5 text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1.5"><Icon size={13} className={color} />{title}</div>
      <ul className="space-y-1.5">{items.map((x, i) => <li key={i} className="text-13 text-slate-800 flex items-start gap-2"><span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />{x}</li>)}</ul>
    </div>
  );
}

const LINES = (v) => (Array.isArray(v) ? v.join('\n') : String(v || ''));
const FIELDS = [
  ['business_type', 'Kind of business', 'text', 'The specific kind of business, as a customer would name it. For example: digital marketing agency for healthcare.'],
  ['industry_focus', 'Who it serves', 'text', 'The industry or customer group you specialise in. Leave empty if you serve everyone.'],
  ['market', 'Target area', 'text', 'Where your customers are.'],
  ['offerings', 'What it sells', 'lines', 'One service or product per line, the most important first.'],
  ['audience', 'Who the customers are', 'lines', 'One kind of customer per line.'],
  ['customer_search_terms', 'Words customers search with', 'lines', 'One phrase per line, as people type it into Google. Keyword research starts from these.'],
  ['competitor_queries', 'Phrases that find businesses like yours', 'lines', 'One per line, with the city. Competitor research looks for these.'],
  ['competitors_are', 'Counts as a competitor', 'area', 'The same service, for the same kind of customer, in the same area.'],
  ['competitors_are_not', 'Does not count', 'area', 'Businesses that look similar but are not competitors, so they are left out.'],
];

/** The owner corrects what the AI wrote. What is saved here is kept when the understanding is refreshed, and the competitor and keyword research start from it. */
function BriefEditor({ b, brief, onSaved, onCancel }) {
  const [v, setV] = useState(() => Object.fromEntries(FIELDS.map(([k, , kind]) => [k, kind === 'lines' ? LINES(brief[k]) : (brief[k] || '')])));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const edited = Object.keys(brief.edits || {});
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const body = {};
      for (const [k, , kind] of FIELDS) {
        const now = kind === 'lines' ? v[k].split('\n').map(x => x.trim()).filter(Boolean) : v[k].trim();
        const before = kind === 'lines' ? (brief[k] || []) : (brief[k] || '');
        if (JSON.stringify(now) !== JSON.stringify(before)) body[k] = now;
      }
      const r = await api(`/businesses/${b.id}/business-brief`, { method: 'PATCH', body });
      onSaved(r.brief);
    } catch (e) { setErr(e.message || 'Could not save.'); } finally { setBusy(false); }
  };
  const resetAll = async () => {
    setBusy(true); setErr('');
    try { const r = await api(`/businesses/${b.id}/business-brief`, { method: 'PATCH', body: { reset: edited } }); onSaved(r.brief); } catch (e) { setErr(e.message || 'Could not reset.'); } finally { setBusy(false); }
  };
  return (
    <div className="mb-4 rounded-xl border-2 border-indigo-300 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2 mb-1"><div className="text-14 font-bold text-slate-900">Correct the business understanding</div><span className="text-12 text-slate-500">Competitors and keywords are found from this. Your words are kept when you refresh.</span></div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        {FIELDS.map(([k, label, kind, hint]) => (
          <label key={k} className={`block ${kind === 'text' && k === 'market' ? 'md:col-span-2' : ''}`}>
            <span className="text-12 font-semibold text-slate-700 flex items-center gap-1.5">{label}{edited.includes(k) && <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 text-10.5 font-semibold">edited by you</span>}</span>
            {kind === 'text' ? <input value={v[k]} onChange={e => setV(x => ({ ...x, [k]: e.target.value }))} className="mt-1 w-full h-9 rounded-lg border border-slate-300 px-3 text-13" />
              : <textarea rows={kind === 'area' ? 3 : 5} value={v[k]} onChange={e => setV(x => ({ ...x, [k]: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-13" />}
            <span className="text-11.5 text-slate-500">{hint}</span>
          </label>))}
      </div>
      {err && <p className="mt-2 text-13 text-red-600" role="alert">{err}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="primary" icon={busy ? Loader2 : CheckCircle2} disabled={busy} onClick={save}>Save</Button>
        <Button disabled={busy} onClick={onCancel}>Cancel</Button>
        {edited.length > 0 && <button type="button" disabled={busy} onClick={resetAll} className="ml-auto text-12.5 font-semibold text-slate-600 hover:underline cursor-pointer">Use the AI's reading again for everything I edited</button>}
      </div>
    </div>
  );
}

/** The first SEO step: what the business is, from its website, the audit and its profile. Competitor and keyword research start from the search words written here. */
export default function BusinessUnderstanding({ b }) {
  const saved = useApi(`/businesses/${b.id}/business-brief`);
  const [made, setMade] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('overview');
  const [editing, setEditing] = useState(false);
  const brief = made || saved.data?.brief;
  const build = async () => {
    setBusy(true); setErr('');
    try { const r = await api(`/businesses/${b.id}/business-brief`, { method: 'POST' }); setMade(r.brief); }
    catch (e) { setErr(e.message || 'The summary could not be built.'); } finally { setBusy(false); }
  };
  const action = <Button variant={brief ? 'secondary' : 'primary'} icon={busy ? Loader2 : brief ? RefreshCw : Sparkles} disabled={busy} onClick={build}>{busy ? 'Reading the website…' : brief ? 'Refresh summary' : 'Build business summary'}</Button>;

  if (!brief) {
    return (
      <Card title="Business understanding" subtitle="Step 1: what the business is, in one overview. Competitors and keywords are found from it." action={action}>
        {saved.error ? <p className="text-13 text-red-600">{saved.error.message}</p> : (
          <p className="text-13 text-slate-600">{busy ? 'Reading the website, the audit results and the profile, then writing the overview. This takes about half a minute.' : 'Not built yet. It reads the live website, the audit results and the profile, then writes what the business sells, to whom, how customers search for it and who its real competitors are. Run the website audit first for the fullest picture.'}</p>
        )}
        {err && <p className="mt-2 text-13 text-red-600" role="alert">{err}</p>}
      </Card>
    );
  }
  const f = brief.facts || {};
  const sc = f.scores || {};
  const TABS = [['overview', 'Overview'], ['gaps', 'Strengths and gaps'], ['market', 'Keyword themes'], ['todo', 'What to do first']];
  const counts = { gaps: (brief.strengths || []).length + (brief.weaknesses || []).length, market: (brief.keyword_themes || []).length, todo: (brief.next_steps || []).length };
  return (
    <Card title="Business understanding" subtitle={`Built ${when(brief.built_at)} from ${brief.pages?.length || 0} page${brief.pages?.length === 1 ? '' : 's'} of the website, the audit and the profile${brief.by_ai ? '' : ' (profile only: AI was not available)'}`} action={action}>
      {err && <p className="mb-2 text-13 text-red-600" role="alert">{err}</p>}

      {editing && <BriefEditor b={b} brief={brief} onSaved={(nb) => { setMade(nb); setEditing(false); }} onCancel={() => setEditing(false)} />}
      {!editing && <div className="mb-4 rounded-xl border-2 border-indigo-200 bg-indigo-50/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 text-13 font-bold text-indigo-900"><Sparkles size={15} className="text-indigo-600" />Used to find competitors and keywords{Object.keys(brief.edits || {}).length > 0 && <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 text-11 font-semibold">{Object.keys(brief.edits).length} edited by you</span>}</div>
          <span className="flex items-center gap-3"><span className="text-11.5 text-indigo-700">Competitor and keyword research start from exactly this</span><Button size="sm" icon={Pencil} onClick={() => setEditing(true)}>Edit</Button></span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-lg bg-white px-3 py-2.5 ring-1 ring-indigo-100">
            <div className="text-11 font-semibold uppercase tracking-wide text-slate-500">Kind of business</div>
            <div className="mt-0.5 text-15 font-bold text-slate-900 capitalize">{brief.business_type || brief.business_model || '—'}</div>
            {brief.industry_focus && <div className="text-12 text-slate-600">Serves: {brief.industry_focus}</div>}
          </div>
          <div className="rounded-lg bg-white px-3 py-2.5 ring-1 ring-indigo-100 md:col-span-2">
            <div className="text-11 font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1"><MapPin size={11} />Target area</div>
            <div className="mt-0.5 text-13.5 font-semibold text-slate-900">{brief.market || '—'}</div>
          </div>
        </div>
        <div className="mt-3 rounded-lg bg-white px-3 py-2.5 ring-1 ring-indigo-100">
          <div className="text-11 font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1"><Target size={11} />What it sells</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">{(brief.offerings || []).map(x => <span key={x} className="px-2.5 py-1 rounded-md bg-slate-100 text-12.5 font-semibold text-slate-800">{x}</span>)}{!(brief.offerings || []).length && <span className="text-13 text-slate-400">—</span>}</div>
        </div>
        <div className="mt-3 rounded-lg bg-white px-3 py-2.5 ring-1 ring-indigo-100">
          <div className="text-11 font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1"><Search size={11} />Words customers search with</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">{(brief.customer_search_terms || []).map(x => <span key={x} className="px-2.5 py-1 rounded-full bg-indigo-600 text-white text-12.5 font-semibold">{x}</span>)}{!(brief.customer_search_terms || []).length && <span className="text-13 text-slate-400">—</span>}</div>
        </div>
        {(brief.competitors_are || brief.competitors_are_not) && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            {brief.competitors_are && <div className="rounded-lg bg-emerald-50 px-3 py-2.5 ring-1 ring-emerald-200"><div className="flex items-center gap-1.5 text-11 font-bold uppercase tracking-wide text-emerald-800"><Swords size={11} />Counts as a competitor</div><p className="mt-0.5 text-12.5 text-slate-800">{brief.competitors_are}</p></div>}
            {brief.competitors_are_not && <div className="rounded-lg bg-rose-50 px-3 py-2.5 ring-1 ring-rose-200"><div className="flex items-center gap-1.5 text-11 font-bold uppercase tracking-wide text-rose-800"><Swords size={11} />Does not count</div><p className="mt-0.5 text-12.5 text-slate-800">{brief.competitors_are_not}</p></div>}
          </div>
        )}
      </div>}

      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <span className="text-11.5 font-semibold text-slate-500 mr-1">Audit scores</span>
        {Object.entries(sc).map(([k, v]) => <Badge key={k} tone={tone(v)}>{k === 'onpage' ? 'On-page' : k === 'gbp' ? 'Google profile' : k.charAt(0).toUpperCase() + k.slice(1)} {v}/100</Badge>)}
      </div>

      <nav role="tablist" aria-label="Business understanding" className="flex gap-1 border-b border-slate-200 overflow-x-auto">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`px-3.5 py-2 text-13 font-semibold whitespace-nowrap border-b-2 -mb-px cursor-pointer ${tab === id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {label}{counts[id] ? <span className="ml-1.5 text-11 text-slate-400 font-medium">{counts[id]}</span> : null}
          </button>
        ))}
      </nav>

      <div className="pt-4 min-h-[150px]">
        {tab === 'overview' && (
          <div className="space-y-4">
            <p className="text-14 text-slate-800 leading-relaxed">{brief.overview}</p>
            <List icon={Users} title="Who it is for" items={brief.audience} />
            {brief.website_summary && (
              <div className="rounded-lg bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-1.5 text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1"><Globe size={13} className="text-indigo-500" />The website</div>
                <p className="text-13 text-slate-700 leading-relaxed">{brief.website_summary}</p>
              </div>
            )}
          </div>
        )}

        {tab === 'gaps' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <List icon={CheckCircle2} title="Strengths" items={brief.strengths} color="text-emerald-600" />
            <List icon={AlertTriangle} title="What holds the SEO back" items={brief.weaknesses} color="text-amber-600" />
          </div>
        )}

        {tab === 'market' && (
          <div className="space-y-4">
            {(brief.keyword_themes || []).length > 0 && (
              <div>
                <div className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Keyword themes</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {brief.keyword_themes.map(th => (
                    <div key={th.theme} className="rounded-lg ring-1 ring-slate-200 px-3 py-2.5"><div className="text-13 font-semibold text-slate-900">{th.theme}</div><div className="mt-1 flex flex-wrap gap-1">{th.keywords.map(k => <span key={k} className="px-2 py-0.5 rounded bg-slate-100 text-12 text-slate-700">{k}</span>)}</div></div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'todo' && (
          <div>
            <div className="flex items-center gap-1.5 text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1.5"><ListChecks size={13} className="text-indigo-500" />In this order</div>
            {(brief.next_steps || []).length ? <ol className="space-y-2 list-decimal list-inside text-13.5 text-slate-800">{brief.next_steps.map((x, i) => <li key={i}>{x}</li>)}</ol> : <p className="text-13 text-slate-500">No steps were written. Refresh the summary.</p>}
          </div>
        )}
      </div>

      <div className="pt-3 mt-1 border-t border-slate-100 flex flex-wrap items-center gap-2">
        <span className="text-12.5 font-semibold text-slate-600 mr-1">Next:</span>
        <Link to="/competitor-finder"><Button size="sm" variant="primary" icon={Swords}>Find competitors <ArrowRight size={13} className="inline ml-1" /></Button></Link>
        <Link to="/keyword-management/ai"><Button size="sm" icon={Search}>Find keywords</Button></Link>
        <Link to="/keyword-management/workspace"><Button size="sm">Keyword workspace</Button></Link>
      </div>
    </Card>
  );
}
