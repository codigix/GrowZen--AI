import React, { useEffect, useState } from 'react';
import { Loader2, MapPin } from 'lucide-react';
import { Button, StatusPill, Badge, ErrorNote, useAction, refreshBusinesses } from './SeoUi';
import { api, useApi } from './seoApi';
import { VerifyPill } from './GbpAccounts';

/** Pick which of a connected Google account's business locations to add (used right after the Google sign-in). */

export function LocationPicker({ connectionId, onImported }) {
  const locs = useApi(`/connections/${connectionId}/locations`);
  const [selected, setSelected] = useState([]);
  const [busy, error, run] = useAction();
  useEffect(() => { if (locs.data) setSelected(locs.data.filter(l => !l.imported).map(l => l.gbp_location)); }, [locs.data]);
  if (locs.loading) return <div className="py-8 flex items-center justify-center gap-2 text-13 text-gray-600"><Loader2 size={15} className="animate-spin text-blue-600" /> Fetching the businesses this account manages…</div>;
  if (locs.error) return <ErrorNote>{locs.error.message}</ErrorNote>;
  if (!locs.data?.length) return <div className="py-6 text-center text-13 text-gray-600">This account doesn't own or manage any Business Profile. Ask the owner to add it as a manager, or sign in with the owner's account.</div>;
  const importNow = () => run('import', async () => {
    const out = await api(`/connections/${connectionId}/import`, { method: 'POST', body: { locations: selected } });
    await refreshBusinesses();
    onImported(out);
  });
  return (
    <div>
      <div className="text-13 text-gray-700 mb-3">Found <b>{locs.data.length}</b> business{locs.data.length === 1 ? '' : 'es'}. Pick the ones to add:</div>
      <div className="border border-gray-200 rounded divide-y divide-gray-100">
        {locs.data.map(l => (
          <label key={l.gbp_location} className={`flex items-center gap-3 px-3 py-2.5 ${l.imported ? 'opacity-60' : 'cursor-pointer hover:bg-gray-50'}`}>
            <input type="checkbox" disabled={l.imported} checked={selected.includes(l.gbp_location)} onChange={() => setSelected(s => s.includes(l.gbp_location) ? s.filter(x => x !== l.gbp_location) : [...s, l.gbp_location])} />
            <div className="flex-1 min-w-0">
              <div className="text-13 text-gray-900">{l.name}</div>
              <div className="text-12 text-gray-500 truncate flex items-center gap-1"><MapPin size={10} /> {l.address || 'Service-area business'}{l.primary_category ? ` · ${l.primary_category}` : ''}</div>
            </div>
            {l.duplicate_listing && <StatusPill level="warning">Duplicate</StatusPill>}
            <VerifyPill state={l.verification} />
            {l.imported && <Badge tone="gray">Already added</Badge>}
          </label>
        ))}
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="mt-4 flex justify-end"><Button variant="primary" busy={busy === 'import'} disabled={!selected.length} onClick={importNow}>Add {selected.length} and audit</Button></div>
    </div>
  );
}
