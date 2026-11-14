import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { SeoShell, useSeoBusiness } from './SeoUi';
import { JourneyFull } from './JourneyBar';

/** One project's own journey: opened from the project's card on the dashboard, it makes that project the active one and lists its ten steps. */
export default function JourneyPage() {
  const { id } = useParams();
  const [business, choose] = useSeoBusiness();
  const want = Number(id);
  useEffect(() => { if (want && business && business.id !== want) choose(want); }, [want, business?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <SeoShell title={business && business.id === want ? `${business.name}: project journey` : 'Project journey'} subtitle="The ten steps for this project, in order: where it is now and what to do next" hideSwitcher>
      {(b) => (b.id === want ? <JourneyFull bid={b.id} /> : <div className="h-40 rounded-xl bg-slate-100 animate-pulse" role="status" aria-busy="true" />)}
    </SeoShell>
  );
}
