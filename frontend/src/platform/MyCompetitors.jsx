import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ExternalLink, Loader2, MapPin, Plus, Star, Trash2 } from 'lucide-react';
import { Card, Button, Badge, ErrorNote } from './SeoUi';

const host = (u) => { try { return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, ''); } catch { return u || ''; } };
const SOURCE = { google_places: ['Google Maps', 'blue'], manual: ['Added by you', 'gray'] };
const AUDIT = { done: ['Audited', 'green'], failed: ['Audit failed', 'red'] };

/** The project's saved competitors: the list every later step (keywords, traffic, gaps) starts from. Always shown, whether or not the research has run. */
export default function MyCompetitors({ list, auditMap, onAdd, onFind, onAudit, onRemove, addBusy, addError, findBusy, running }) {
  const [url, setUrl] = useState('');
  const [sure, setSure] = useState(null);
  const n = list.length;
  const enough = n >= 3;
  const add = async () => { const v = url.trim(); if (!v) return; const c = await onAdd(v, ''); if (c) setUrl(''); }; // a refused address stays in the box, with the reason shown
  return (
    <Card title="Your competitors" subtitle="3 to 5 direct competitors. Keywords, traffic and gaps all start from this list."
      action={<Badge tone={enough ? 'green' : n ? 'amber' : 'gray'}>{n} of 3 to 5{enough ? ' · enough' : ''}</Badge>}>
      <div className="flex flex-wrap items-center gap-2">
        <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder="Add a competitor's website, e.g. competitor.com" aria-label="Competitor website"
          className="h-10 flex-1 min-w-[240px] px-3 text-13 rounded-lg ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none bg-white" />
        <Button icon={Plus} busy={addBusy === 'add'} disabled={!url.trim()} onClick={add}>Add</Button>
        <Button icon={MapPin} busy={findBusy === 'maps'} onClick={onFind} title="Looks up the businesses Google Maps shows for your type of business and saves the ones with a website">Find on Google Maps</Button>
      </div>
      <ErrorNote>{addError}</ErrorNote>

      {n === 0 ? (
        <p className="mt-4 text-13 text-slate-500">No competitors saved yet. Add the ones you know above, or press <b>Find on Google Maps</b>. You can also run the competitor research below: it finds who ranks for your keywords.</p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100 rounded-lg ring-1 ring-inset ring-slate-200">
          {list.map(c => {
            const a = auditMap[c.id]?.status;
            const [srcLabel, srcTone] = SOURCE[c.source] || ['Saved', 'gray'];
            const auditing = a && !AUDIT[a];
            const [aLabel, aTone] = AUDIT[a] || [];
            return (
              <li key={c.id} className="px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="min-w-0 flex-1 basis-56">
                  <div className="text-13 font-semibold text-slate-900 truncate">{c.name}</div>
                  <a href={c.website} target="_blank" rel="noreferrer" className="text-12 text-indigo-700 hover:underline inline-flex items-center gap-1">{host(c.website)}<ExternalLink size={10} /></a>
                </div>
                <Badge tone={srcTone}>{srcLabel}</Badge>
                {c.rating ? <span className="text-12 text-slate-600 inline-flex items-center gap-1"><Star size={12} className="text-amber-500" />{c.rating}{c.reviews ? ` (${c.reviews})` : ''}</span> : null}
                {auditing ? <span className="text-12 text-indigo-700 inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" />Auditing…</span>
                  : a ? <Badge tone={aTone}>{aLabel}</Badge> : <Button size="sm" onClick={() => onAudit(c)}>Audit its site</Button>}
                {sure === c.id
                  ? <span className="inline-flex items-center gap-1.5"><Button size="sm" variant="danger" onClick={() => { setSure(null); onRemove(c); }}>Remove</Button><button type="button" onClick={() => setSure(null)} className="text-12 text-slate-500 hover:underline cursor-pointer">Keep</button></span>
                  : <button type="button" onClick={() => setSure(c.id)} aria-label={`Remove ${c.name}`} title="Remove from the list" className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"><Trash2 size={14} /></button>}
              </li>);
          })}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 text-13">
        {enough ? <><span className="inline-flex items-center gap-1.5 text-emerald-700"><CheckCircle2 size={15} />The list is ready.</span>
          <Link to="/keyword-management/workspace" className="inline-flex items-center gap-1 font-semibold text-indigo-700 hover:underline">Next: collect their keywords<ArrowRight size={13} /></Link></>
          : n ? <span className="text-slate-600">Add {3 - n} more to reach 3.</span> : null}
        {running && <span className="text-12 text-slate-500">The research below is running.</span>}
      </div>
    </Card>
  );
}
