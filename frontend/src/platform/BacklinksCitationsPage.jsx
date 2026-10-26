import React, { useEffect, useState } from 'react';
import { Play, Download, ShieldAlert, Loader2 } from 'lucide-react';
import { SeoShell, Card, Tabs, Stat, StatusPill, Badge, Button, Meter, SourceTag, ErrorNote, SERIES, useToast, useAction } from './SeoUi';
import { api, useApi, usePoll, fmtDateTime } from './seoApi';

function Links({ b, tab }) {
  const bl = useApi(`/businesses/${b.id}/backlinks`);
  const ct = useApi(`/businesses/${b.id}/citations`);
  const tasks = useApi(`/tasks?status=&business_id=${b.id}`);
  const [waiting, setWaiting] = useState(null); // finished_at seen when a re-check started
  const [disavow, setDisavow] = useState([]);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  usePoll(() => { bl.reload(true); ct.reload(true); }, waiting !== null, 3000);
  const blRes = bl.data?.result; const ctRes = ct.data?.result;
  useEffect(() => { if (blRes?.top) setDisavow(blRes.top.filter(t => t.toxic).map(t => t.domain)); }, [blRes]);
  useEffect(() => { if (waiting !== null && ct.data?.finished_at && ct.data.finished_at !== waiting) { setWaiting(null); toast('Re-check finished'); } }, [waiting, ct.data, toast]);
  const runAudit = () => run('run', async () => {
    await api(`/businesses/${b.id}/audits`, { method: 'POST', body: { kinds: ['backlinks', 'citations'] } });
    setWaiting(ct.data?.finished_at || '');
    toast('Backlinks and citations re-check started');
  });
  const dirs = ctRes?.directories || [];
  const listed = dirs.filter(d => d.status === 'listed').length;
  const diff = (d, k) => d.found && (d.found[k] || '') !== ((k === 'name' ? b.name : k === 'phone' ? b.phone : b.address) || '');
  const downloadDisavow = () => {
    const blob = new Blob([`# Disavow file for ${b.website || b.name}\n# Generated ${new Date().toISOString().slice(0, 10)}\n${disavow.map(d => `domain:${d}`).join('\n')}\n`], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'disavow.txt'; a.click(); URL.revokeObjectURL(a.href);
  };
  const outreach = (tasks.data || []).filter(t => t.kind === 'outreach_email');

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-[12px] text-gray-500">{bl.data?.finished_at ? `Last checked ${fmtDateTime(bl.data.finished_at)}` : 'Not checked yet'}</span>
        <SourceTag source={bl.data?.data_source} />
        <Button className="ml-auto" variant="primary" icon={Play} busy={busy === 'run' || waiting !== null} onClick={runAudit}>Re-check now</Button>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="Citations correct" value={dirs.length ? `${listed}/${dirs.length}` : '—'} hint="directories with matching NAP" />
        <Stat label="Referring domains" value={blRes?.referring_domains ?? '—'} />
        <Stat label="Backlinks" value={blRes?.backlinks ?? '—'} />
        <Stat label="Toxic links" value={blRes?.toxic ?? '—'} />
      </div>

      {tab === 'citations' && (
        <Card title="Local citations" subtitle="Name, address and phone (NAP) must match the Business Profile everywhere" action={<SourceTag source={ct.data?.data_source} />}>
          {!ct.data ? <div className="py-8 flex justify-center text-gray-400"><Loader2 size={16} className="animate-spin" /></div> : !dirs.length ? <div className="py-8 text-center text-[13px] text-gray-500">{ct.data.note || 'No citations data yet.'}</div> : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="text-[12px] text-gray-500 border-b border-gray-200"><tr><th className="p-2 text-left font-medium">Directory</th><th className="p-2 text-left font-medium">Status</th><th className="p-2 text-left font-medium">Name</th><th className="p-2 text-left font-medium">Phone</th><th className="p-2 text-left font-medium">Address</th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {dirs.map(d => (
                    <tr key={d.directory}>
                      <td className="p-2 text-gray-900">{d.directory}</td>
                      <td className="p-2">{d.status === 'listed' ? <StatusPill level="good">Correct</StatusPill> : d.status === 'inconsistent' ? <StatusPill level="warning">Mismatch</StatusPill> : <StatusPill level="critical">Missing</StatusPill>}</td>
                      {['name', 'phone', 'address'].map(k => <td key={k} className={`p-2 text-[12px] max-w-[220px] truncate ${diff(d, k) ? 'text-[#d03b3b] font-medium' : 'text-gray-600'}`} title={d.found?.[k] || ''}>{d.found ? d.found[k] || '—' : '—'}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[11px] text-gray-500 mt-2">Values in red differ from the Business Profile.</p>
            </div>
          )}
        </Card>
      )}

      {tab === 'backlinks' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card title="Referring domains" className="xl:col-span-2" action={<SourceTag source={bl.data?.data_source} />}>
            {!blRes ? <div className="py-8 text-center text-[13px] text-gray-500">{bl.data?.note || 'No backlink data yet.'}</div> : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead className="text-[12px] text-gray-500 border-b border-gray-200"><tr><th className="p-2 text-left font-medium">Domain</th><th className="p-2 text-right font-medium">Authority</th><th className="p-2 text-left font-medium">Anchor</th><th className="p-2 text-left font-medium">Disavow</th></tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {(blRes.top || []).map(l => (
                        <tr key={l.domain} className={l.toxic ? 'bg-red-50/40' : ''}>
                          <td className="p-2 text-gray-900">{l.domain}{l.toxic && <span className="ml-2"><StatusPill level="critical">Toxic</StatusPill></span>}</td>
                          <td className="p-2 text-right tabular-nums">{l.authority ?? '—'}</td>
                          <td className="p-2 text-gray-600">{l.anchor || '—'}</td>
                          <td className="p-2"><input type="checkbox" checked={disavow.includes(l.domain)} onChange={() => setDisavow(d => d.includes(l.domain) ? d.filter(x => x !== l.domain) : [...d, l.domain])} aria-label={`Disavow ${l.domain}`} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Button icon={Download} disabled={!disavow.length} onClick={downloadDisavow}>Download disavow file ({disavow.length})</Button>
                  <span className="text-[11px] text-gray-500"><ShieldAlert size={11} className="inline" /> Only disavow clear spam; Google ignores most low-quality links.</span>
                </div>
              </>
            )}
          </Card>
          <Card title="Anchor text mix" subtitle="Mostly brand and URL anchors is natural">
            {blRes?.anchors && Object.keys(blRes.anchors).length ? (
              <div className="space-y-2">{Object.entries(blRes.anchors).map(([k, v], i) => { const total = Object.values(blRes.anchors).reduce((s, x) => s + x, 0); return <div key={k}><div className="flex justify-between text-[12px] mb-1"><span className="text-gray-700 capitalize">{k}</span><span className="tabular-nums text-gray-500">{v}</span></div><Meter value={v} max={total} color={SERIES[i]} /></div>; })}</div>
            ) : <div className="text-[13px] text-gray-500">Not available from the current data source.</div>}
          </Card>
        </div>
      )}

      {tab === 'outreach' && (
        <Card title="Outreach tasks" subtitle="The AI drafts outreach; a person approves and sends it. No bought links or link exchanges.">
          {!tasks.data ? <div className="py-8 flex justify-center text-gray-400"><Loader2 size={16} className="animate-spin" /></div> : outreach.length === 0 ? <div className="py-8 text-center text-[13px] text-gray-500">No outreach tasks yet. They're created from backlink and citation issues after an audit.</div> : (
            <div className="divide-y divide-gray-100">
              {outreach.map(t => (
                <div key={t.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="flex-1 min-w-[240px]"><div className="text-[13px] text-gray-900">{t.title}</div><div className="text-[12px] text-gray-500">{t.detail?.fix}</div></div>
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
  const [tab, setTab] = useState('citations');
  return (
    <SeoShell title="Backlinks & citations" subtitle="Consistent listings everywhere and links the web gives you, earned, never bought">
      {(b) => (
        <>
          <Tabs value={tab} onChange={setTab} tabs={[{ id: 'citations', label: 'Citations & NAP' }, { id: 'backlinks', label: 'Backlinks' }, { id: 'outreach', label: 'Outreach' }]} />
          <Links key={b.id} b={b} tab={tab} />
        </>
      )}
    </SeoShell>
  );
}
