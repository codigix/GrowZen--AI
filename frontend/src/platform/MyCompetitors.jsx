import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, CheckCircle2, ExternalLink, Loader2, MapPin, Plus, Star, Trash2 } from 'lucide-react';
import { Card, Button, Badge, ErrorNote } from './SeoUi';

const host = (u) => { try { return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, ''); } catch { return u || ''; } };
const SOURCE = { google_places: ['Maps', 'blue'], manual: ['You', 'gray'] };
const AUDIT = { done: ['Audited', 'green'], failed: ['Failed', 'red'] };
/** Google's own wording is long; say what it means and what to do. */
const friendly = (m) => (/quota/i.test(m || '') ? "Google Maps has reached its daily search limit, so it can't look up competitors until it resets. Add the ones you know in the box above." : /GOOGLE_PLACES_API_KEY/.test(m || '') ? 'Google Maps search is not set up on this server (GOOGLE_PLACES_API_KEY). Add competitors by hand above.' : m);

/**
 * The competitors, in a column beside the research. Found ones are not used by anything until they are chosen: the chosen ones are what Competitor Watch,
 * the keyword workspace, the traffic and the link steps work on.
 */
export default function MyCompetitors({ list, auditMap, onAdd, onFind, onAudit, onRemove, onChoose, addBusy, addError, findBusy, findError, running }) {
  const [url, setUrl] = useState('');
  const [sure, setSure] = useState(null);
  const chosen = list.filter(c => c.selected !== false);
  const left = list.filter(c => c.selected === false);
  const n = chosen.length;
  const enough = n >= 3;
  const add = async () => { const v = url.trim(); if (!v) return; const c = await onAdd(v, ''); if (c) setUrl(''); }; // a refused address stays in the box, with the reason shown

  const Row = ({ c, isChosen }) => {
    const a = auditMap[c.id]?.status;
    const [srcLabel, srcTone] = SOURCE[c.source] || ['Saved', 'gray'];
    const auditing = a && !AUDIT[a];
    const [aLabel, aTone] = AUDIT[a] || [];
    return (
      <li className="py-2.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5"><span className="text-13 font-semibold text-slate-900 truncate" title={c.name}>{c.name}</span><Badge tone={srcTone}>{srcLabel}</Badge></div>
            <a href={c.website} target="_blank" rel="noreferrer" className="text-12 text-indigo-700 hover:underline inline-flex items-center gap-1 max-w-full"><span className="truncate">{host(c.website)}</span><ExternalLink size={10} className="shrink-0" /></a>
            {c.rating ? <span className="ml-2 text-12 text-slate-500 inline-flex items-center gap-0.5"><Star size={11} className="text-amber-500" />{c.rating}{c.reviews ? ` (${c.reviews})` : ''}</span> : null}
          </div>
          {sure === c.id
            ? <span className="inline-flex items-center gap-1.5 shrink-0"><Button size="sm" variant="danger" onClick={() => { setSure(null); onRemove(c); }}>Delete</Button><button type="button" onClick={() => setSure(null)} className="text-12 text-slate-500 hover:underline cursor-pointer">Keep</button></span>
            : <button type="button" onClick={() => setSure(c.id)} aria-label={`Delete ${c.name}`} title="Delete it from the list" className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer shrink-0"><Trash2 size={14} /></button>}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {isChosen
            ? <button type="button" onClick={() => onChoose(c, false)} title="Leave it out of Competitor Watch and the later steps" className="h-7 px-2.5 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 text-12 font-semibold inline-flex items-center gap-1 cursor-pointer hover:bg-emerald-100"><Check size={12} />Chosen</button>
            : <button type="button" onClick={() => onChoose(c, true)} className="h-7 px-2.5 rounded-full bg-white text-indigo-700 ring-1 ring-inset ring-indigo-300 text-12 font-semibold inline-flex items-center gap-1 cursor-pointer hover:bg-indigo-50"><Plus size={12} />Choose</button>}
          {auditing ? <span className="text-12 text-indigo-700 inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" />Auditing…</span>
            : a ? <Badge tone={aTone}>{aLabel}</Badge>
              : <button type="button" onClick={() => onAudit(c)} className="text-12 font-semibold text-indigo-700 hover:underline cursor-pointer">Audit its site</button>}
        </div>
      </li>
    );
  };

  return (
    <Card title="Competitors" subtitle="Choose 3 to 5 that really compete with you. Only the chosen ones are watched and used by the next steps."
      action={<Badge tone={enough ? 'green' : n ? 'amber' : 'gray'}>{n} chosen</Badge>}>
      <div className="flex gap-2">
        <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder="competitor.com" aria-label="Competitor website"
          className="h-10 flex-1 min-w-0 px-3 text-13 rounded-lg ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none bg-white" />
        <Button icon={Plus} busy={addBusy === 'add'} disabled={!url.trim()} onClick={add}>Add</Button>
      </div>
      <ErrorNote>{addError}</ErrorNote>
      <button type="button" onClick={onFind} disabled={findBusy === 'maps'} title="Looks up the businesses Google Maps shows for your type of business and lists the ones with a website"
        className="mt-2 w-full h-9 rounded-lg ring-1 ring-inset ring-slate-300 bg-white text-13 font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer inline-flex items-center justify-center gap-1.5 disabled:opacity-60">
        {findBusy === 'maps' ? <Loader2 size={14} className="animate-spin" /> : <MapPin size={14} />}Find on Google Maps
      </button>
      {findError && <div className="mt-2"><ErrorNote>{friendly(findError)}</ErrorNote></div>}

      {list.length === 0 && <p className="mt-4 text-12.5 text-slate-500">None yet. Add the ones you know, find them on Google Maps, or run the research below. Then choose the right ones.</p>}

      {chosen.length > 0 && <>
        <div className="mt-4 text-12 font-semibold uppercase tracking-wide text-slate-500">Chosen ({n})</div>
        <ul className="divide-y divide-slate-100">{chosen.map(c => <Row key={c.id} c={c} isChosen />)}</ul>
      </>}
      {left.length > 0 && <>
        <div className="mt-4 text-12 font-semibold uppercase tracking-wide text-slate-500">Found, not chosen ({left.length})</div>
        <ul className="divide-y divide-slate-100">{left.map(c => <Row key={c.id} c={c} isChosen={false} />)}</ul>
      </>}

      <div className="mt-3 pt-3 border-t border-slate-100 text-13 grid gap-2">
        {enough ? <span className="inline-flex items-center gap-1.5 text-emerald-700"><CheckCircle2 size={15} />The list is ready.</span>
          : <span className="text-slate-600">{n ? `Choose ${3 - n} more to reach 3.` : left.length ? 'Choose the ones that really compete with you.' : null}</span>}
        {n > 0 && <Link to="/competitor-watch" className="inline-flex items-center gap-1 font-semibold text-indigo-700 hover:underline">Next: watch what they change<ArrowRight size={13} /></Link>}
        {enough && <Link to="/keyword-management/workspace" className="inline-flex items-center gap-1 font-semibold text-indigo-700 hover:underline">Then: collect their keywords<ArrowRight size={13} /></Link>}
        {running && <div className="text-12 text-slate-500">The research is running.</div>}
      </div>
    </Card>
  );
}
