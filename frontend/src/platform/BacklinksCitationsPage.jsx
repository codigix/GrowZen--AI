import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Play, Loader2 } from 'lucide-react';
import { SeoShell, Card, Tabs, Stat, StatusPill, Badge, Button, SourceTag, ErrorNote, SERIES, useToast, useAction, useUrlTab } from './SeoUi';
import { api, useApi, usePoll, fmtDateTime } from './seoApi';

function Links({ b, tab }) {
  const ct = useApi(`/businesses/${b.id}/citations`);
  const tasks = useApi(`/tasks?status=&business_id=${b.id}`);
  const [waiting, setWaiting] = useState(null); // finished_at seen when a re-check started
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  usePoll(() => { ct.reload(true); }, waiting !== null, 3000);
  const ctRes = ct.data?.result;
  useEffect(() => { if (waiting !== null && ct.data?.finished_at && ct.data.finished_at !== waiting) { setWaiting(null); toast('Re-check finished'); } }, [waiting, ct.data, toast]);
  const runAudit = () => run('run', async () => {
    await api(`/businesses/${b.id}/audits`, { method: 'POST', body: { kinds: ['citations'] } });
    setWaiting(ct.data?.finished_at || '');
    toast('Citations re-check started');
  });
  const dirs = ctRes?.directories || [];
  const listed = dirs.filter(d => d.status === 'listed').length;
  const diff = (d, k) => d.found && (d.found[k] || '') !== ((k === 'name' ? b.name : k === 'phone' ? b.phone : b.address) || '');
  const outreach = (tasks.data || []).filter(t => t.kind === 'outreach_email');

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-12 text-gray-500">{ct.data?.finished_at ? `Last checked ${fmtDateTime(ct.data.finished_at)}` : 'Not checked yet'}</span>
        <SourceTag source={ct.data?.data_source} />
        <Button className="ml-auto" variant="primary" icon={Play} busy={busy === 'run' || waiting !== null} onClick={runAudit}>Re-check now</Button>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="Citations correct" value={dirs.length ? `${listed}/${dirs.length}` : '—'} hint="directories with matching NAP" />
      </div>

      {tab === 'citations' && (
        <Card title="Local citations" subtitle="Name, address and phone (NAP) must match the Business Profile everywhere" action={<SourceTag source={ct.data?.data_source} />}>
          {!ct.data ? <div className="py-8 flex justify-center text-gray-400"><Loader2 size={16} className="animate-spin" /></div> : !dirs.length ? <div className="py-8 text-center text-13 text-gray-500">{ct.data.note || 'No citations data yet.'}</div> : (
            <div className="overflow-x-auto">
              <table className="w-full text-13">
                <thead className="text-12 text-gray-500 border-b border-gray-200"><tr><th className="p-2 text-left font-medium">Directory</th><th className="p-2 text-left font-medium">Status</th><th className="p-2 text-left font-medium">Name</th><th className="p-2 text-left font-medium">Phone</th><th className="p-2 text-left font-medium">Address</th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {dirs.map(d => (
                    <tr key={d.directory}>
                      <td className="p-2 text-gray-900">{d.directory}</td>
                      <td className="p-2">{d.status === 'listed' ? <StatusPill level="good">Correct</StatusPill> : d.status === 'inconsistent' ? <StatusPill level="warning">Mismatch</StatusPill> : <StatusPill level="critical">Missing</StatusPill>}</td>
                      {['name', 'phone', 'address'].map(k => <td key={k} className={`p-2 text-12 max-w-[220px] truncate ${diff(d, k) ? 'text-danger font-medium' : 'text-gray-600'}`} title={d.found?.[k] || ''}>{d.found ? d.found[k] || '—' : '—'}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-11 text-gray-500 mt-2">Values in red differ from the Business Profile.</p>
            </div>
          )}
        </Card>
      )}

      {tab === 'outreach' && (
        <Card title="Outreach tasks" subtitle="The AI drafts outreach; a person approves and sends it. No bought links or link exchanges.">
          {!tasks.data ? <div className="py-8 flex justify-center text-gray-400"><Loader2 size={16} className="animate-spin" /></div> : outreach.length === 0 ? <div className="py-8 text-center text-13 text-gray-500">No outreach tasks yet. They're created from backlink and citation issues after an audit.</div> : (
            <div className="divide-y divide-gray-100">
              {outreach.map(t => (
                <div key={t.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="flex-1 min-w-[240px]"><div className="text-13 text-gray-900">{t.title}</div><div className="text-12 text-gray-500">{t.detail?.fix}</div></div>
                  <Badge tone={t.status === 'pending' ? 'amber' : t.status === 'applied' ? 'green' : 'gray'}>{t.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
      {toastNode}
    </>
  );
}

export default function BacklinksCitationsPage() {
  const [tab, setTab] = useUrlTab('citations', ['citations', 'backlinks', 'outreach']);
  // Backlinks moved to Backlink Intelligence (our own discovery bot); old bookmarks and links keep working.
  if (tab === 'backlinks') return <Navigate to="/backlink-intelligence" replace />;
  return (
    <SeoShell title="Citations & outreach" subtitle="Consistent listings everywhere, and outreach for the links worth earning, never bought">
      {(b) => (
        <>
          <Tabs value={tab} onChange={setTab} tabs={[{ id: 'citations', label: 'Citations & NAP' }, { id: 'outreach', label: 'Outreach' }]} />
          <Links key={b.id} b={b} tab={tab} />
        </>
      )}
    </SeoShell>
  );
}
