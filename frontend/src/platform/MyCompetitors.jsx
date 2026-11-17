import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ExternalLink, Loader2, MapPin, Plus, Star, Trash2 } from 'lucide-react';
import { Card, Button, Badge, ErrorNote } from './SeoUi';

const host = (u) => { try { return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, ''); } catch { return u || ''; } };
const SOURCE = { google_places: ['Maps', 'blue'], manual: ['You', 'gray'] };
const AUDIT = { done: ['Audited', 'green'], failed: ['Failed', 'red'] };

/** The project's saved competitors, in a column beside the research: the list every later step (keywords, traffic, gaps) starts from. */
/** Google's own wording is long; say what it means and what to do. */
const friendly = (m) => (/quota/i.test(m || '') ? "Google Maps has reached its daily search limit, so it can't look up competitors until it resets. Add the ones you know in the box above." : /GOOGLE_PLACES_API_KEY/.test(m || '') ? 'Google Maps search is not set up on this server (GOOGLE_PLACES_API_KEY). Add competitors by hand above.' : m);

export default function MyCompetitors({ list, auditMap, onAdd, onFind, onAudit, onRemove, addBusy, addError, findBusy, findError, running }) {
  const [url, setUrl] = useState('');
  const [sure, setSure] = useState(null);
  const n = list.length;
  const enough = n >= 3;
  const add = async () => { const v = url.trim(); if (!v) return; const c = await onAdd(v, ''); if (c) setUrl(''); }; // a refused address stays in the box, with the reason shown
  return (
    <Card title="Saved competitors" subtitle="3 to 5 direct competitors. Keywords, traffic and gaps start from them."
      action={<Badge tone={enough ? 'green' : n ? 'amber' : 'gray'}>{n} of 3 to 5</Badge>}>
      <div className="flex gap-2">
        <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder="competitor.com" aria-label="Competitor website"
          className="h-10 flex-1 min-w-0 px-3 text-13 rounded-lg ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none bg-white" />
        <Button icon={Plus} busy={addBusy === 'add'} disabled={!url.trim()} onClick={add}>Add</Button>
      </div>
      <ErrorNote>{addError}</ErrorNote>
      <button type="button" onClick={onFind} disabled={findBusy === 'maps'} title="Looks up the businesses Google Maps shows for your type of business and saves the ones with a website"
        className="mt-2 w-full h-9 rounded-lg ring-1 ring-inset ring-slate-300 bg-white text-13 font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer inline-flex items-center justify-center gap-1.5 disabled:opacity-60">
        {findBusy === 'maps' ? <Loader2 size={14} className="animate-spin" /> : <MapPin size={14} />}Find on Google Maps
      </button>
      {findError && <div className="mt-2"><ErrorNote>{friendly(findError)}</ErrorNote></div>}

      {n === 0 ? (
        <p className="mt-4 text-12.5 text-slate-500">None saved yet. Add the ones you know, find them on Google Maps, or run the research: it shows who ranks for your keywords.</p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100">
          {list.map(c => {
            const a = auditMap[c.id]?.status;
            const [srcLabel, srcTone] = SOURCE[c.source] || ['Saved', 'gray'];
            const auditing = a && !AUDIT[a];
            const [aLabel, aTone] = AUDIT[a] || [];
            return (
              <li key={c.id} className="py-2.5">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5"><span className="text-13 font-semibold text-slate-900 truncate" title={c.name}>{c.name}</span><Badge tone={srcTone}>{srcLabel}</Badge></div>
                    <a href={c.website} target="_blank" rel="noreferrer" className="text-12 text-indigo-700 hover:underline inline-flex items-center gap-1 max-w-full"><span className="truncate">{host(c.website)}</span><ExternalLink size={10} className="shrink-0" /></a>
                    {c.rating ? <span className="ml-2 text-12 text-slate-500 inline-flex items-center gap-0.5"><Star size={11} className="text-amber-500" />{c.rating}{c.reviews ? ` (${c.reviews})` : ''}</span> : null}
                  </div>
                  {sure === c.id
                    ? <span className="inline-flex items-center gap-1.5 shrink-0"><Button size="sm" variant="danger" onClick={() => { setSure(null); onRemove(c); }}>Remove</Button><button type="button" onClick={() => setSure(null)} className="text-12 text-slate-500 hover:underline cursor-pointer">Keep</button></span>
                    : <button type="button" onClick={() => setSure(c.id)} aria-label={`Remove ${c.name}`} title="Remove from the list" className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer shrink-0"><Trash2 size={14} /></button>}
                </div>
                <div className="mt-1.5">
                  {auditing ? <span className="text-12 text-indigo-700 inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" />Auditing its site…</span>
                    : a ? <Badge tone={aTone}>{aLabel}</Badge>
                      : <button type="button" onClick={() => onAudit(c)} className="text-12 font-semibold text-indigo-700 hover:underline cursor-pointer">Audit its site</button>}
                </div>
              </li>);
          })}
        </ul>
      )}

      <div className="mt-3 pt-3 border-t border-slate-100 text-13">
        {enough ? <div className="grid gap-2"><span className="inline-flex items-center gap-1.5 text-emerald-700"><CheckCircle2 size={15} />The list is ready.</span>
          <Link to="/keyword-management/workspace" className="inline-flex items-center gap-1 font-semibold text-indigo-700 hover:underline">Next: collect their keywords<ArrowRight size={13} /></Link></div>
          : n ? <span className="text-slate-600">Add {3 - n} more to reach 3.</span> : null}
        {running && <div className="mt-1 text-12 text-slate-500">The research is running.</div>}
      </div>
    </Card>
  );
}
