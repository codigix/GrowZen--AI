import { useCrumb } from './crumbs';
import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Play, Copy, Check, ExternalLink, Link2, ShieldCheck, Trash2, Clock3, Pencil, Download } from 'lucide-react';
import ProcessTasks from './ProcessTasks';
import { SeoShell, Card, Tabs, Stat, StatusPill, Badge, Button, SourceTag, ErrorNote, SERIES, useToast, useAction, useUrlTab, useDoubleConfirm, inputCls, SkTable, SkList } from './SeoUi';
import { api, useApi, usePoll, fmtDateTime } from './seoApi';
import { usePager, Pager, useSorted, SortTh, downloadCsv } from './DataTable';
import { Segments } from './StatBits';

const sameDigits = (a, b) => { const x = String(a || '').replace(/\D/g, ''), y = String(b || '').replace(/\D/g, ''); return x.length >= 7 && y.length >= 7 && (x.endsWith(y.slice(-8)) || y.endsWith(x.slice(-8))); };
const STATUS_PILL = { listed: ['good', 'Correct'], inconsistent: ['warning', 'Mismatch'], pending: ['info', 'Waiting'], missing: ['critical', 'Missing'] };

function CopyButton({ text, label }) {
  const [done, setDone] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(text || ''); } catch { /* ignore */ } setDone(true); setTimeout(() => setDone(false), 1500); };
  return <button type="button" onClick={copy} disabled={!text} aria-label={`Copy ${label}`} className="text-slate-400 hover:text-indigo-600 disabled:opacity-30 cursor-pointer">{done ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}</button>;
}

/** One listing site: its state, the listing link, and what to do next (add the business there, save the link, check it against the profile). */
function ListingRow({ d, n, nap, base, reload, toast }) {
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
    <tr className="align-top hover:bg-slate-50/60">
      <td className="px-2.5 py-2 text-12 text-slate-400 tabular-nums">{n}</td>
      <td className="px-2.5 py-2">
        {confirmNode}
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 text-12 font-bold flex items-center justify-center shrink-0">{d.label.charAt(0)}</span>
          <div className="min-w-0"><div className="text-13 font-medium text-slate-900">{d.label}</div><div className="text-11 text-slate-400">{d.kind_label}{d.source === 'manual' ? ' · added by you' : d.source === 'auto' ? ' · found automatically' : ''}</div></div>
        </div>
      </td>
      <td className="px-2.5 py-2"><span title={d.evidence}><StatusPill level={tone}>{label}</StatusPill></span>{proof && <div className="text-10.5 text-slate-400 mt-1 max-w-[150px] leading-tight">{proof}</div>}</td>
      <td className="px-2.5 py-2 text-12 max-w-[300px]">
        {editing ? (
          <div className="flex flex-wrap gap-1.5"><input autoFocus className={`${inputCls} !h-8 text-12 flex-1 min-w-[160px]`} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://… (your listing page)" aria-label={`${d.label} listing link`} onKeyDown={e => { if (e.key === 'Enter' && /^https?:\/\//i.test(url.trim())) saveUrl(); if (e.key === 'Escape') setEditing(false); }} />
            <Button size="sm" variant="primary" busy={busy === 'save'} disabled={!/^https?:\/\//i.test(url.trim())} onClick={saveUrl}>Save and check</Button><Button size="sm" onClick={() => { setEditing(false); setUrl(d.url || ''); }}>Cancel</Button></div>
        ) : d.url ? <a href={d.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline inline-flex items-center gap-1 break-all"><ExternalLink size={12} className="shrink-0" />{d.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 46)}</a> : <span className="text-slate-400">No listing link yet</span>}
        {d.found && !editing && <div className="mt-1 text-slate-500">{d.found.name && <div className="truncate" title={d.found.name}>{d.found.name}</div>}{d.found.phone && <div className={badPhone ? 'text-red-600 font-medium' : ''}>{d.found.phone}{badPhone ? ' (differs from the profile)' : ''}</div>}</div>}
        {d.note && !editing && <div className="mt-1 text-11.5 text-slate-500">{d.note}</div>}
        {error && <div className="mt-1 text-11.5 text-red-600">{error}</div>}
      </td>
      <td className="px-2.5 py-2">
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

const STATUS_ORDER = { inconsistent: 0, missing: 1, pending: 2, listed: 3 };
const listingValue = (d, k) => ({ site: d.label, status: STATUS_ORDER[d.status] ?? 1, url: d.url ? d.url.replace(/^https?:\/\/(www\.)?/, '') : null })[k];
const LTH = 'p-2 whitespace-nowrap';
const CSV_BTN = 'h-7 px-2.5 inline-flex items-center gap-1.5 rounded text-12 font-semibold cursor-pointer bg-slate-100 text-slate-600 hover:bg-slate-200';
const siteSlug = (b) => String(b?.website || b?.name || 'site').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].replace(/[^a-z0-9.-]+/gi, '-');

function Listings({ b, ov, reload, toast, finishedAt, source, running, onRecheck }) {
  const navigate = useNavigate();
  const nap = ov.nap || {};
  const s = ov.summary || {};
  const [filter, setFilter] = useState('all');
  const rows = (ov.directories || []).filter(d => filter === 'all' || d.status === filter);
  const base = `/businesses/${b.id}/citations`;
  const { sorted, sort, onSort } = useSorted(rows, listingValue);
  const pg = usePager(sorted, { size: 25, resetKey: filter });
  const exportListings = () => downloadCsv(`citations-${siteSlug(b)}`, ['Site', 'Kind', 'Status', 'How sure we are', 'Listing link', 'Name on the listing', 'Phone on the listing', 'Note', 'Where it came from'],
    sorted.map(d => [d.label, d.kind_label || '', (STATUS_PILL[d.status] || STATUS_PILL.missing)[1], { verified: 'Checked on the listing page', search: 'Matched from a Google search result', self_reported: 'Entered by you, not checked yet', not_found: 'Not in Google search results', unchecked: 'Not checked yet' }[d.confidence] || '',
      d.url || '', d.found?.name || '', d.found?.phone || '', d.note || '', d.source === 'manual' ? 'Added by you' : d.source === 'auto' ? 'Found automatically' : '']));
  return (
    <>
      <div className="space-y-3 mb-3">
        <div className="rounded-xl bg-white ring-1 ring-slate-200 px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="min-w-0">
            <div className="text-11.5 font-semibold uppercase tracking-wide text-slate-500">Your business details (NAP)</div>
            <div className="text-11.5 text-slate-400">Use exactly these on every listing site</div>
          </div>
          <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-2 min-w-[300px]">
            {[['Name', nap.name], ['Address', nap.address], ['Phone', nap.phone]].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-slate-50 px-3 py-1.5 min-w-0">
                <div className="flex items-center justify-between text-11 font-semibold text-slate-500">{k}<CopyButton text={v} label={k} /></div>
                <div className={`text-13 truncate ${v ? 'text-slate-900' : 'text-amber-700'}`} title={v || ''}>{v || `Add the ${k.toLowerCase()} first`}</div>
              </div>
            ))}
          </div>
          <Button size="sm" onClick={() => navigate('/gmb-profile?tab=profile&sub=edit&step=contact')}>Edit in profile</Button>
        </div>

        <div className="rounded-xl bg-white ring-1 ring-slate-200 p-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {[['listed', 'Correct', s.total ? `${s.listed}/${s.total}` : '—', '#10b981', `${s.verified ?? 0} checked on the page · ${s.score ?? 0}% of the sites`],
              ['inconsistent', 'Need fixing', s.inconsistent ?? 0, '#f59e0b', 'Name or phone differs'], ['missing', 'Not listed yet', s.missing ?? 0, '#f43f5e', 'Add the business there'], ['pending', 'Waiting', s.pending ?? 0, '#64748b', 'Submitted, not live yet']].map(([id, label, value, color, hint]) => {
              const on = filter === id;
              return (
                <button key={id} type="button" onClick={() => setFilter(on ? 'all' : id)} title={`${hint}. Click to show only these.`}
                  className={`rounded-lg px-3 py-2 text-left ring-1 ring-inset cursor-pointer ${on ? 'bg-white ring-2' : 'bg-slate-50 ring-slate-200 hover:bg-white'}`} style={on ? { '--tw-ring-color': color, boxShadow: `inset 0 -3px 0 ${color}` } : undefined}>
                  <span className="block text-20 leading-tight font-bold tabular-nums" style={{ color }}>{value}</span><span className="block text-11.5 text-slate-500">{label}</span>
                </button>);
            })}
          </div>
          <div className="mt-2.5"><Segments total={s.total || 1} parts={[{ label: 'Correct', value: s.listed ?? 0, color: '#10b981' }, { label: 'Need fixing', value: s.inconsistent ?? 0, color: '#f59e0b' }, { label: 'Waiting', value: s.pending ?? 0, color: '#94a3b8' }, { label: 'Not listed yet', value: s.missing ?? 0, color: '#f43f5e' }]} /></div>
        </div>
      </div>

      <Card pad={false} title={`Listing sites (${rows.length})`} subtitle="Add the business on each site, save its link, then press Check: we open the page and compare the name and phone."
        action={<div className="flex flex-wrap items-center gap-2"><span className="text-12 text-slate-500 hidden md:inline">{finishedAt ? `Checked ${fmtDateTime(finishedAt)}` : 'Not checked yet'}</span><SourceTag source={source} />
          <button type="button" onClick={exportListings} disabled={!sorted.length} title="Download every listing site in the current table as a CSV file" className={`${CSV_BTN} disabled:opacity-40`}><Download size={13} />Export CSV</button>
          <Button size="sm" variant="primary" icon={Play} busy={running} onClick={onRecheck}>Re-check now</Button></div>}>
        <div className="overflow-x-auto">
          <table className="w-full text-13">
            <thead className="text-12 uppercase tracking-wide text-slate-600 bg-slate-100"><tr><th className={`${LTH} w-10`}>#</th><SortTh id="site" sort={sort} onSort={onSort} className={LTH}>Site</SortTh><SortTh id="status" sort={sort} onSort={onSort} className={LTH}>Status</SortTh><SortTh id="url" sort={sort} onSort={onSort} className={LTH}>Listing</SortTh><th className="p-2 text-right font-medium">Next step</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? <tr><td colSpan={5} className="py-8 text-center text-13 text-gray-500">Nothing here.</td></tr> : pg.rows.map((d, i) => <ListingRow key={d.key} n={(pg.from || 0) + i + 1} d={d} nap={nap} base={base} reload={reload} toast={toast} />)}
            </tbody>
          </table>
        </div>
        <Pager p={pg} label="listing sites" />
        <p className="px-5 py-2 text-11.5 text-slate-500 border-t border-slate-100">“Not found” means Google search did not return that listing, not that it does not exist. A listing you add and check on its page is confirmed.</p>
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
        <Card title="Outreach tasks" subtitle="The AI drafts outreach; a person approves and sends it. No bought links or link exchanges."
          action={outreach.length > 0 && <button type="button" className={CSV_BTN} title="Download every outreach task as a CSV file" onClick={() => downloadCsv(`outreach-tasks-${siteSlug(b)}`, ['Task', 'What to do', 'Status'], outreach.map(t => [t.title, t.detail?.fix || '', t.status]))}><Download size={13} />Export CSV</button>}>
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
  if (tab === 'backlinks') return <Navigate to="/backlinks/links" replace />;
  return (
    <SeoShell step="links" title="Citations & outreach" subtitle="Consistent listings everywhere, and outreach for the links worth earning, never bought">
      {(b) => (
        <>
          <Tabs value={tab} onChange={setTab} tabs={[{ id: 'citations', label: 'Citations & NAP' }, { id: 'outreach', label: 'Outreach' }, { id: 'tasks', label: 'Tasks' }]} />
          {tab === 'tasks' ? <ProcessTasks b={b} areas={['backlinks']} /> : <Links key={b.id} b={b} tab={tab} />}
        </>
      )}
    </SeoShell>
  );
}
