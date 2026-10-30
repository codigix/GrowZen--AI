import React, { useState } from 'react';
import { Save } from 'lucide-react';
import { Card, Button, ErrorNote, useAction, useToast, refreshBusinesses } from './SeoUi';
import { api } from './seoApi';
import { TargetMarket } from './BusinessOnboardingPage';

/** Change an existing project's market. */
export function MarketCard({ b }) {
  const [form, setForm] = useState({ target_scope: b.target_scope || 'local', target_countries: b.target_countries || [], target_areas: b.target_areas || [], country: b.country || 'IN', area: b.area || '', city: b.city || '' });
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const save = () => run('save', async () => {
    const local = form.target_scope === 'local';
    await api(`/businesses/${b.id}`, { method: 'PATCH', body: { target_scope: form.target_scope, target_countries: form.target_scope === 'international' ? form.target_countries : [], target_areas: local ? form.target_areas : [] } });
    await refreshBusinesses();
    toast('Market saved: searches and pages now follow it');
  });
  return (
    <Card title="Target market" subtitle="Who this project's customers are. Searches, keywords, rankings and which tools show all follow it.">
      <TargetMarket form={form} setForm={setForm} />
      <ErrorNote>{error}</ErrorNote>
      <Button className="mt-3" variant="primary" icon={Save} busy={busy === 'save'} onClick={save}>Save market</Button>
      {toastNode}
    </Card>
  );
}
