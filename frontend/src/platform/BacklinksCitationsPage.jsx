import { useCrumb } from './crumbs';
import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Play, Copy, Check, ExternalLink, Link2, ShieldCheck, Trash2, Clock3, Pencil } from 'lucide-react';
import ProcessTasks from './ProcessTasks';
import { SeoShell, Card, Tabs, Stat, StatusPill, Badge, Button, SourceTag, ErrorNote, SERIES, useToast, useAction, useUrlTab, useDoubleConfirm, inputCls, SkTable, SkList } from './SeoUi';
import { api, useApi, usePoll, fmtDateTime } from './seoApi';

const sameDigits = (a, b) => { const x = String(a || '').replace(/\D/g, ''), y = String(b || '').replace(/\D/g, ''); return x.length >= 7 && y.length >= 7 && (x.endsWith(y.slice(-8)) || y.endsWith(x.slice(-8))); };
const STATUS_PILL = { listed: ['good', 'Correct'], inconsistent: ['warning', 'Mismatch'], pending: ['info', 'Waiting'], missing: ['critical', 'Missing'] };

function CopyButton({ text, label }) {
  const [done, setDone] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(text || ''); } catch { /* ignore */ } setDone(true); setTimeout(() => setDone(false), 1500); };
  return <button type="button" onClick={copy} disabled={!text} aria-label={`Copy ${label}`} className="text-slate-400 hover:text-indigo-600 disabled:opacity-30 cursor-pointer">{done ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}</button>;
}

/** One listing site: its state, the listing link, and what to do next (add the business there, save the link, check it against the profile). */
function ListingRow({ d, nap, base, reload, toast }) {
  const navigate = useNavigate();
  const [busy, error, run, setError] = useAction();
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(d.url || '');
  const [ask, confirmNode] = useDoubleConfirm();
  const unconfirmed = d.status === 'missing' && d.source === 'auto'; // the Google search did not return it: that is not proof it does not exist
  const [tone, label] = unconfirmed ? ['warning', 'Not found'] : (STATUS_PILL[d.status] || STATUS_PILL.missing);
  const proof = { verified: 'Checked on the listing page', search: 'Matched from a Google search result', self_reported: 'Entered by you, not checked yet', not_found: 'Not in Google search results', unchecked: 'Not checked yet' }[d.confidence];
  const saveUrl = () => run('save', async () => {
    await api(`${base}/listings/${d.key}`, { method: 'PUT', body: { url: url.trim() } });
    setEditing(false);
    if (url.trim()) { const r = await api(`${base}/listings/${d.key}/verify`, { method: 'POST' }); toast(r.note); }
    reload();
  });
  const verify = () => run('verify', async () => { const r = await api(`${base}/listings/${d.key}/verify`, { method: 'POST' }); toast(r.note); reload(); });
  const mark = (status) => run('mark', async () => { await api(`${base}/listings/${d.key}`, { method: 'PUT', body: { status, note: status === 'pending' ? `Submitted ${new Date().toLocaleDateString('en-GB')}` : '' } }); reload(); });
  const remove = () => ask({ what: `your saved ${d.label} listing`, effect: 'The saved link and its check are removed from this list. The listing on the site itself is not touched.', onConfirm: () => run('remove', async () => { await api(`${base}/listings/${d.key}`, { method: 'DELETE' }); setUrl(''); reload(); }) });
  const badPhone = d.found?.phone && nap.phone && !sameDigits(d.found.phone, nap.phone);
  return (
    <tr className="align-top">
      <td className="p-2.5">
        {confirmNode}
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 text-12 font-bold flex items-center justify-center shrink-0">{d.label.charAt(0)}</span>
          <div className="min-w-0"><div className="text-13 font-medium text-slate-900">{d.label}</div><div className="text-11 text-slate-400">{d.kind_label}{d.source === 'manual' ? ' · added by you' : d.source === 'auto' ? ' · found automatically' : ''}</div></div>
        </div>
      </td>
      <td className="p-2.5"><span title={d.evidence}><StatusPill level={tone}>{label}</StatusPill></span>{proof && <div className="text-10.5 text-slate-400 mt-1 max-w-[150px] leading-tight">{proof}</div>}</td>
      <td className="p-2.5 text-12 max-w-[300px]">
        {editing ? (
          <div className="flex flex-wrap gap-1.5"><input autoFocus className={`${inputCls} !h-8 text-12 flex-1 min-w-[160px]`} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://… (your listing page)" aria-label={`${d.label} listing link`} onKeyDown={e => { if (e.key === 'Enter' && /^https?:\/\//i.test(url.trim())) saveUrl(); if (e.key === 'Escape') setEditing(false); }} />
            <Button size="sm" variant="primary" busy={busy === 'save'} disabled={!/^https?:\/\//i.test(url.trim())} onClick={saveUrl}>Save and check</Button><Button size="sm" onClick={() => { setEditing(false); setUrl(d.url || ''); }}>Cancel</Button></div>
        ) : d.url ? <a href={d.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline inline-flex items-center gap-1 break-all"><ExternalLink size={12} className="shrink-0" />{d.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 46)}</a> : <span className="text-slate-400">No listing link yet</span>}
        {d.found && !editing && <div className="mt-1 text-slate-500">{d.found.name && <div className="truncate" title={d.found.name}>{d.found.name}</div>}{d.found.phone && <div className={badPhone ? 'text-red-600 font-medium' : ''}>{d.found.phone}{badPhone ? ' (differs from the profile)' : ''}</div>}</div>}
        {d.note && !editing && <div className="mt-1 text-11.5 text-slate-500">{d.note}</div>}
        {error && <div className="mt-1 text-11.5 text-red-600">{error}</div>}
      </td>
      <td className="p-2.5">
        <div className="flex flex-wrap gap-1.5 justify-end">
          {d.managed ? <Button size="sm" onClick={() => navigate('/gmb-profile?tab=profile')}>Manage</Button> : (
            <>
              {d.status !== 'listed' && d.submit_url && <a href={d.submit_url} target="_blank" rel="noreferrer" className="h-8 px-3 rounded inline-flex items-center gap-1.5 text-12.5 font-semibold bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer"><ExternalLink size={12} />Add business</a>}
              {d.url && <Button size="sm" icon={ShieldCheck} busy={busy === 'verify'} onClick={verify}>Check</Button>}
              {!editing && <Button size="sm" icon={d.url ? Pencil : Link2} onClick={() => { setUrl(d.url || ''); setEditing(true); setError(''); }}>{d.url ? 'Edit link' : 'I have a link'}</Button>}
              {d.status === 'missing' && !d.url && <Button size="sm" icon={Clock3} busy={busy === 'mark'} onClick={() => mark('pending')}>Mark submitted</Button>}
              {d.source === 'manual' && <button type="button" onClick={remove} aria-label={`Remove ${d.label} entry`} className="h-8 w-8 flex items-center justify-center text-slate-400 hover:text-red-600 cursor-pointer"><Trash2 size={14} /></button>}
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

function Listings({ b, ov, reload, toast, finishedAt, source, running, onRecheck }) {
  const navigate = useNavigate();
  const nap = ov.nap || {};
  const s = ov.summary || {};
  const [filter, setFilter] = useState('all');
  const rows = (ov.directories || []).filter(d => filter === 'all' || (filter === 'fix' ? d.status === 'inconsistent' || d.status === 'missing' : d.status === filter));
  const base = `/businesses/${b.id}/citations`;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-12 text-gray-500">{finishedAt ? `Automatic check ${fmtDateTime(finishedAt)}` : 'Automatic check not run yet'}</span>
        <SourceTag source={source} />
        <Button className="ml-auto" variant="primary" icon={Play} busy={running} onClick={onRecheck}>Re-check now</Button>
      </div>

      <Card title="Your business details (NAP)" subtitle="Use exactly this name, address and phone on every listing site. Copy them with one click."
        action={<Button size="sm" onClick={() => navigate('/gmb-profile?tab=profile&sub=edit&step=contact')}>Edit in profile</Button>}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[['Name', nap.name], ['Address', nap.address], ['Phone', nap.phone]].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-slate-50 px-3 py-2.5 min-w-0">
              <div className="flex items-center justify-between text-11.5 font-medium text-slate-500">{k}<CopyButton text={v} label={k} /></div>
              <div className={`text-13 mt-0.5 break-words ${v ? 'text-slate-900' : 'text-amber-700'}`}>{v || `Add the ${k.toLowerCase()} first`}</div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 my-4">
        <Stat label="Correct listings" value={s.total ? `${s.listed}/${s.total}` : '—'} hint={`${s.verified ?? 0} checked on the page · ${s.score ?? 0}% of the sites`} />
        <Stat label="Need fixing" value={s.inconsistent ?? 0} hint="name or phone differs" />
        <Stat label="Not listed yet" value={s.missing ?? 0} hint="add the business" />
        <Stat label="Waiting" value={s.pending ?? 0} hint="submitted, not live yet" />
      </div>

      <Card title="Listing sites" subtitle="Add the business on each site, save its link, then press Check: we open the page and compare the name and phone with the profile."
        action={<div className="flex gap-1">{[['all', 'All'], ['fix', 'Needs action'], ['listed', 'Correct']].map(([id, l]) => <button key={id} type="button" onClick={() => setFilter(id)} className={`h-7 px-2.5 rounded text-12 font-semibold cursor-pointer ${filter === id ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{l}</button>)}</div>}>
        <div className="overflow-x-auto">
          <table className="w-full text-13">
            <thead className="text-12 text-gray-500 border-b border-gray-200"><tr><th className="p-2 text-left font-medium">Site</th><th className="p-2 text-left font-medium">Status</th><th className="p-2 text-left font-medium">Listing</th><th className="p-2 text-right font-medium">Next step</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 ? <tr><td colSpan={4} className="py-8 text-center text-13 text-gray-500">Nothing here.</td></tr> : rows.map(d => <ListingRow key={d.key} d={d} nap={nap} base={base} reload={reload} toast={toast} />)}
            </tbody>
          </table>
        </div>
        <p className="text-11 text-gray-500 mt-3">“Not found” means Google search did not return that listing, not that it does not exist. “Correct” from a search match is a good sign; a listing you add and check on its page is confirmed.</p>
      </Card>
    </>
  );
}

function Links({ b, tab }) {
  const ct = useApi(`/businesses/${b.id}/citations`);
  const ov = useApi(`/businesses/${b.id}/citations/overview`);
  const tasks = useApi(`/tasks?status=&business_id=${b.id}`);
  const [waiting, setWaiting] = useState(null); // finished_at seen when a re-check started
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  usePoll(() => { ct.reload(true); }, waiting !== null, 3000);
  useEffect(() => { if (waiting === null) ov.reload(true); }, [waiting]); // eslint-disable-line react-hooks/exhaustive-deps -- re-read the merged view when a re-check ends
  useEffect(() => { if (waiting !== null && ct.data?.finished_at && ct.data.finished_at !== waiting) { setWaiting(null); toast('Re-check finished'); } }, [waiting, ct.data, toast]);
  const runAudit = () => run('run', async () => {
    await api(`/businesses/${b.id}/audits`, { method: 'POST', body: { kinds: ['citations'] } });
    setWaiting(ct.data?.finished_at || '');
    toast('Citations re-check started');
  });
  const outreach = (tasks.data || []).filter(t => t.kind === 'outreach_email');

  return (
    <>
      <ErrorNote>{error}</ErrorNote>
      {tab === 'citations' && (!ov.data
        ? <SkTable cols={['w-1/3', 'w-20', 'w-20', 'w-16']} rows={6} />
        : <Listings b={b} ov={ov.data} reload={() => ov.reload(true)} toast={toast} finishedAt={ct.data?.finished_at || ov.data.finished_at} source={ov.data.data_source || ct.data?.data_source} running={busy === 'run' || waiting !== null} onRecheck={runAudit} />)}

      {tab === 'outreach' && (
        <Card title="Outreach tasks" subtitle="The AI drafts outreach; a person approves and sends it. No bought links or link exchanges.">
          {!tasks.data ? <SkList rows={4} avatar={false} /> : outreach.length === 0 ? <div className="py-8 text-center text-13 text-gray-500">No outreach tasks yet. They're created from backlink and citation issues after an audit.</div> : (
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
  const [tab, setTab] = useUrlTab('citations', ['citations', 'backlinks', 'outreach', 'tasks']);
  useCrumb({ citations: 'Citations & NAP', outreach: 'Outreach', tasks: 'Tasks' }[tab]);
  // Backlinks moved to Backlink Intelligence (our own discovery bot); old bookmarks and links keep working.
  if (tab === 'backlinks') return <Navigate to="/backlink-intelligence" replace />;
  return (
    <SeoShell title="Citations & outreach" subtitle="Consistent listings everywhere, and outreach for the links worth earning, never bought">
      {(b) => (
        <>
          <Tabs value={tab} onChange={setTab} tabs={[{ id: 'citations', label: 'Citations & NAP' }, { id: 'outreach', label: 'Outreach' }, { id: 'tasks', label: 'Tasks' }]} />
          {tab === 'tasks' ? <ProcessTasks b={b} areas={['backlinks']} /> : <Links key={b.id} b={b} tab={tab} />}
        </>
      )}
    </SeoShell>
  );
}
