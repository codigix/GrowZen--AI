import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, Loader2, RefreshCw, CheckCircle2, AlertTriangle, Users, MapPin, Search, Swords, ArrowRight, Target, ListChecks, Globe } from 'lucide-react';
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

/** The first SEO step: what the business is, from its website, the audit and its profile. Competitor and keyword research start from the search words written here. */
export default function BusinessUnderstanding({ b }) {
  const saved = useApi(`/businesses/${b.id}/business-brief`);
  const [made, setMade] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
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
  return (
    <Card title="Business understanding" subtitle={`Built ${when(brief.built_at)} from ${brief.pages?.length || 0} page${brief.pages?.length === 1 ? '' : 's'} of the website, the audit and the profile${brief.by_ai ? '' : ' (profile only: AI was not available)'}`} action={action}>
      {err && <p className="mb-2 text-13 text-red-600" role="alert">{err}</p>}
      <div className="space-y-5">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {brief.business_model && <Badge tone="blue">{brief.business_model}</Badge>}
            {brief.market && <span className="inline-flex items-center gap-1 text-12.5 text-slate-600"><MapPin size={13} />{brief.market}</span>}
            {Object.entries(sc).map(([k, v]) => <Badge key={k} tone={tone(v)}>{k === 'onpage' ? 'On-page' : k === 'gbp' ? 'Google profile' : k.charAt(0).toUpperCase() + k.slice(1)} {v}/100</Badge>)}
          </div>
          <p className="text-14 text-slate-800 leading-relaxed">{brief.overview}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <List icon={Target} title="What it sells" items={brief.offerings} />
          <List icon={Users} title="Who it is for" items={brief.audience} />
        </div>

        {brief.website_summary && (
          <div className="rounded-lg bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-1.5 text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1"><Globe size={13} className="text-indigo-500" />The website</div>
            <p className="text-13 text-slate-700 leading-relaxed">{brief.website_summary}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <List icon={CheckCircle2} title="Strengths" items={brief.strengths} color="text-emerald-600" />
          <List icon={AlertTriangle} title="What holds the SEO back" items={brief.weaknesses} color="text-amber-600" />
        </div>

        <div>
          <div className="flex items-center gap-1.5 text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1.5"><Search size={13} className="text-indigo-500" />How customers search for it</div>
          <div className="flex flex-wrap gap-1.5">{(brief.customer_search_terms || []).map(t => <span key={t} className="px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-800 text-12.5 font-medium">{t}</span>)}</div>
          <p className="mt-1.5 text-11.5 text-slate-500">Competitor and keyword research start from these words.</p>
        </div>

        {(brief.competitors_are || brief.competitors_are_not) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {brief.competitors_are && <div className="rounded-lg bg-emerald-50 px-4 py-3"><div className="flex items-center gap-1.5 text-12 font-semibold text-emerald-800 mb-1"><Swords size={13} />Real competitors</div><p className="text-13 text-slate-700">{brief.competitors_are}</p></div>}
            {brief.competitors_are_not && <div className="rounded-lg bg-slate-50 px-4 py-3"><div className="flex items-center gap-1.5 text-12 font-semibold text-slate-600 mb-1"><Swords size={13} />Not competitors</div><p className="text-13 text-slate-700">{brief.competitors_are_not}</p></div>}
          </div>
        )}

        {(brief.keyword_themes || []).length > 0 && (
          <div>
            <div className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Keyword themes</div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
              {brief.keyword_themes.map(t => (
                <div key={t.theme} className="rounded-lg ring-1 ring-slate-200 px-3 py-2.5"><div className="text-13 font-semibold text-slate-900">{t.theme}</div><div className="mt-1 flex flex-wrap gap-1">{t.keywords.map(k => <span key={k} className="px-2 py-0.5 rounded bg-slate-100 text-12 text-slate-700">{k}</span>)}</div></div>
              ))}
            </div>
          </div>
        )}

        {(brief.next_steps || []).length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1.5"><ListChecks size={13} className="text-indigo-500" />What to do first</div>
            <ol className="space-y-1.5 list-decimal list-inside text-13 text-slate-800">{brief.next_steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          </div>
        )}

        <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2">
          <span className="text-12.5 font-semibold text-slate-600 mr-1">Next:</span>
          <Link to="/competitor-finder"><Button size="sm" variant="primary" icon={Swords}>Find competitors <ArrowRight size={13} className="inline ml-1" /></Button></Link>
          <Link to="/keyword-management/ai"><Button size="sm" icon={Search}>Find keywords</Button></Link>
          <Link to="/keyword-management/workspace"><Button size="sm">Keyword workspace</Button></Link>
        </div>
      </div>
    </Card>
  );
}
