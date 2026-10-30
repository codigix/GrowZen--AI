import React, { useCallback, useState } from 'react';
import { Play, Plus, Trash2, Download, RefreshCw, Loader2, Search, Crosshair, History, Sparkles } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, ReferenceLine, Legend } from 'recharts';
import { SeoShell, Card, Tabs, Badge, Button, Meter, ErrorNote, Drawer, Field, Modal, inputCls, areaCls, SERIES, INK, useToast, useAction, useUrlTab } from './SeoUi';
import { api, useApi, usePoll, fmtDateTime, SEO_API } from './seoApi';

const STATUS_TONE = {
  NEW: 'blue', LIVE: 'green', RESTORED: 'green', CHANGED: 'amber', BROKEN_TARGET: 'amber', REDIRECTED_SOURCE: 'amber',
  LOST_PENDING: 'amber', LOST_CONFIRMED: 'red', SOURCE_UNAVAILABLE: 'gray', UNKNOWN: 'gray'
};
const STATUSES = ['NEW', 'LIVE', 'RESTORED', 'CHANGED', 'BROKEN_TARGET', 'REDIRECTED_SOURCE', 'LOST_PENDING', 'LOST_CONFIRMED', 'SOURCE_UNAVAILABLE', 'UNKNOWN'];

const Verification = ({ v }) => v === 'CRAWLER_VERIFIED'
  ? <Badge tone="green" title="Fetched and confirmed by the Codigix crawler">Crawler verified</Badge>
  : <Badge tone="gray" title="Added from outside; our crawler has not fetched the source page yet">Not verified</Badge>;

const QUALITY_TONE = { good: 'green', ok: 'gray', risky: 'red' };
const Quality = ({ q }) => q
  ? <span title={`${q.reason} (${q.method === 'ai' ? 'AI' : 'rule-based'} score: relevance ${q.relevance}, risk ${q.risk})`}><Badge tone={QUALITY_TONE[q.verdict]}>{q.verdict}</Badge></span>
  : <span className="text-gray-300">—</span>;
const SourceBadge = ({ source }) => <Badge tone={source === 'ai' ? 'blue' : 'gray'}>{source === 'ai' ? 'Written by AI' : 'Rule-based'}</Badge>;

const Empty = ({ children }) => <div className="py-8 text-center text-13 text-gray-500">{children}</div>;
const Spin = () => <div className="py-8 flex justify-center text-gray-400"><Loader2 size={16} className="animate-spin" /></div>;
const Th = ({ children, right }) => <th className={`p-2 font-medium ${right ? 'text-right' : 'text-left'}`}>{children}</th>;

function HistoryDrawer({ base, id, onClose }) {
  const link = useApi(id ? `${base}/${id}` : null);
  const hist = useApi(id ? `${base}/${id}/history` : null);
  const l = link.data;
  return (
    <Drawer open={Boolean(id)} onClose={onClose} title="Backlink history" subtitle={l?.source_url}>
      {!l || !hist.data ? <Spin /> : (
        <div className="space-y-4 text-13">
          <div className="grid grid-cols-2 gap-2">
            <div><div className="text-12 text-gray-500">Target</div><div className="break-all">{l.target_url}</div></div>
            <div><div className="text-12 text-gray-500">Anchor</div><div>{l.anchor_text || '—'}</div></div>
            <div><div className="text-12 text-gray-500">Status</div><Badge tone={STATUS_TONE[l.status]}>{l.status}</Badge></div>
            <div><div className="text-12 text-gray-500">Attributes</div><div>{l.rel_attributes.length ? l.rel_attributes.join(', ') : 'follow'}</div></div>
          </div>
          <div>
            <div className="text-12 font-medium text-gray-500 mb-1">Provenance</div>
            {l.provenance.map(p => <div key={p.source} className="text-12 text-gray-700">{p.source} · imported {fmtDateTime(p.imported_at)} · {p.license_class}</div>)}
          </div>
          <div>
            <div className="text-12 font-medium text-gray-500 mb-1">Events</div>
            {hist.data.events.length === 0 ? <div className="text-12 text-gray-500">None yet.</div> : hist.data.events.map((e, i) => (
              <div key={i} className="flex gap-2 py-1 border-b border-gray-100 text-12">
                <Badge tone={STATUS_TONE[e.type] || 'gray'}>{e.type}</Badge>
                <span className="text-gray-600 flex-1 break-all">{e.previous ? `${e.previous} → ` : ''}{e.new || ''}</span>
                <span className="text-gray-500">{fmtDateTime(e.at)}</span>
              </div>
            ))}
          </div>
          <div>
            <div className="text-12 font-medium text-gray-500 mb-1">Observations (evidence)</div>
            {hist.data.observations.map(o => (
              <div key={o.id} className="flex gap-2 py-1 border-b border-gray-100 text-12 text-gray-700">
                <span className="w-24">{o.type}</span>
                <span className="w-20">HTTP {o.source_http_status ?? '—'}</span>
                <span className="w-24">{o.link_found === null ? 'no evidence' : o.link_found ? 'link found' : 'link absent'}</span>
                <span className="flex-1 text-right text-gray-500">{fmtDateTime(o.at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Drawer>
  );
}

function Explorer({ base, targets }) {
  const [f, setF] = useState({ target: '', status: '', verification_status: '', anchor: '' });
  const [cursors, setCursors] = useState([null]);
  const [open, setOpen] = useState(null);
  const q = new URLSearchParams({ limit: '25', ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), ...(cursors.at(-1) ? { cursor: cursors.at(-1) } : {}) });
  const res = useApi(`${base}?${q}`);
  const set = (k) => (e) => { setF(s => ({ ...s, [k]: e.target.value })); setCursors([null]); };
  const rows = res.data?.data || [];
  return (
    <Card title="Backlink explorer" subtitle="Every link with its status, who vouches for it, and full history">
      <div className="flex flex-wrap gap-2 mb-3">
        <select className={`${inputCls} !w-auto`} value={f.target} onChange={set('target')}>
          <option value="">All tracked domains</option>{targets.map(t => <option key={t.id} value={t.domain}>{t.domain}</option>)}
        </select>
        <select className={`${inputCls} !w-auto`} value={f.status} onChange={set('status')}>
          <option value="">Any status</option>{STATUSES.map(s => <option key={s}>{s}</option>)}
        </select>
        <select className={`${inputCls} !w-auto`} value={f.verification_status} onChange={set('verification_status')}>
          <option value="">Any verification</option><option value="CRAWLER_VERIFIED">Crawler verified</option><option value="IMPORTED">Not verified</option>
        </select>
        <div className="relative"><Search size={13} className="absolute left-2.5 top-3 text-gray-400" /><input className={`${inputCls} !w-52 !pl-8`} placeholder="Anchor contains…" value={f.anchor} onChange={set('anchor')} /></div>
        <Button icon={RefreshCw} onClick={() => res.reload()}>Refresh</Button>
      </div>
      <ErrorNote>{res.error?.message}</ErrorNote>
      {res.loading && !res.data ? <Spin /> : rows.length === 0 ? <Empty>No backlinks yet. Run the discovery bot, or queue pages that should link to a tracked domain and run the crawler.</Empty> : (
        <div className="overflow-x-auto">
          <table className="w-full text-13">
            <thead className="text-12 text-gray-500 border-b border-gray-200"><tr><Th>Source page</Th><Th>Target</Th><Th>Anchor</Th><Th>Attr</Th><Th>Status</Th><Th>Evidence</Th><Th>Last seen</Th><Th /></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="p-2 max-w-[260px] truncate" title={r.source_url}><a className="text-indigo-600 hover:underline" href={r.source_url} target="_blank" rel="noreferrer noopener nofollow">{r.source_url.replace(/^https?:\/\//, '')}</a></td>
                  <td className="p-2 max-w-[200px] truncate text-gray-600" title={r.target_url}>{r.target_url.replace(/^https?:\/\//, '')}</td>
                  <td className="p-2 max-w-[160px] truncate text-gray-700" title={r.anchor_text || ''}>{r.anchor_text || '—'}</td>
                  <td className="p-2 text-12 text-gray-600">{r.rel_attributes.length ? r.rel_attributes.join(', ') : 'follow'}</td>
                  <td className="p-2"><Badge tone={STATUS_TONE[r.status] || 'gray'}>{r.status}</Badge></td>
                  <td className="p-2"><Verification v={r.verification_status} /></td>
                  <td className="p-2 text-12 text-gray-500">{fmtDateTime(r.last_seen_at)}</td>
                  <td className="p-2"><button className="text-gray-400 hover:text-indigo-600 cursor-pointer" aria-label="History" onClick={() => setOpen(r.id)}><History size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex justify-end gap-2 mt-3">
        <Button disabled={cursors.length === 1} onClick={() => setCursors(c => c.slice(0, -1))}>Previous</Button>
        <Button disabled={!res.data?.pagination?.has_more} onClick={() => setCursors(c => [...c, res.data.pagination.next_cursor])}>Next</Button>
      </div>
      <HistoryDrawer base={base} id={open} onClose={() => setOpen(null)} />
    </Card>
  );
}

const ANCHOR_LABEL = { money: 'Money', compound: 'Compound', branded: 'Branded', organic: 'Organic', other: 'Other', naked: 'Naked', empty: 'Empty' };
const TYPE_COLOR = { text: SERIES[0], image: SERIES[2], other: SERIES[3] };
const C = { red: '#f1556c', amber: '#f7b84b', green: '#1abc9c', gray: '#94a3b8' };
const REVIEW_LABEL = { whitelisted: 'Whitelisted', disavow: 'Disavow', to_contact: 'To contact', not_replied: 'Not replied', replied: 'Replied', removed: 'Removed' };
const REVIEW_TONE = { whitelisted: 'green', disavow: 'red', to_contact: 'blue', not_replied: 'amber', replied: 'blue', removed: 'green' };
const ALERT_TONE = { red: 'border-red-400', amber: 'border-amber-400', blue: 'border-indigo-400' };

const Hbar = ({ label, value, total, color = SERIES[0], hint }) => {
  const pct = total ? (value / total) * 100 : 0;
  return (
    <div className="mb-2.5">
      <div className="flex justify-between text-12 mb-1"><span className="text-gray-700" title={hint}>{label}</span><span className="tabular-nums text-gray-500">{pct < 0.1 && value ? '<0.1' : pct.toFixed(1)}% <b className="text-indigo-600 font-semibold ml-1">{value}</b></span></div>
      <Meter value={value} max={total || 1} color={color} />
    </div>
  );
};

const Big = ({ value, sub, rows }) => (
  <div>
    <div className="flex items-baseline gap-2"><span className="text-[28px] leading-none font-semibold text-indigo-600 tabular-nums">{value}</span>{sub && <span className="text-12 text-gray-500">{sub}</span>}</div>
    <div className="mt-2 space-y-0.5">{rows.map(([k, v, tone]) => (
      <div key={k} className="flex gap-2 text-12"><span className="text-gray-500 w-24">{k}</span><span className={`tabular-nums font-medium ${tone || 'text-indigo-600'}`}>{v}</span></div>))}</div>
  </div>
);

const Dot = ({ color }) => <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: color }} />;
const Metric = ({ label, tone, value, onClick }) => (
  <div className="flex justify-between text-13 py-1"><span className="text-gray-600"><Dot color={tone} />{label}</span><span className="tabular-nums text-indigo-600 font-medium">{value}</span></div>
);

function QuickStart({ base, biz, go, reload }) {
  const [busy, error, run] = useAction();
  const site = (biz?.website || '').trim();
  const add = () => run('add', async () => { await api(`${base}/targets/sync`, { method: 'POST' }); reload(true); });
  return (
    <Card title="Start tracking backlinks" subtitle="Backlink intelligence monitors the domains you add. Our own discovery bot finds the links">
      <ol className="text-13 text-gray-700 list-decimal pl-5 space-y-1.5 mb-4">
        <li><b>Add your website</b> (and competitors) as tracked domains.</li>
        <li><b>Discover</b> backlinks: run the discovery bot from your tracked sites, or queue pages that should link to you for the crawler to check.</li>
        <li><b>Review</b> this report: new and lost links, anchors, top pages, and the competitor gap.</li>
      </ol>
      <ErrorNote>{error}</ErrorNote>
      <div className="flex flex-wrap gap-2">
        {site && <Button variant="primary" icon={Plus} busy={busy === 'add'} onClick={add}>Track {site.replace(/^https?:\/\//, '').replace(/\/$/, '')} and my saved competitors</Button>}
        <Button onClick={() => go('targets')}>{site ? 'Add a different domain' : 'Add a domain'}</Button>
      </div>
    </Card>
  );
}

function Overview({ base, targets, biz, go, reload }) {
  const own = targets.filter(t => !t.is_competitor);
  const [domain, setDomain] = useState('');
  const [view, setView] = useState('dynamic');
  const [showAll, setShowAll] = useState(false);
  const [anchorTab, setAnchorTab] = useState('all');
  const [picked, setPicked] = useState([]);
  const [draft, setDraft] = useState(null);
  const [explain, setExplain] = useState(null);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const d = domain || own[0]?.domain || targets[0]?.domain || '';
  const res = useApi(d ? `${base}/overview?domain=${encodeURIComponent(d)}` : null);
  if (!targets.length) return <QuickStart base={base} biz={biz} go={go} reload={reload} />;
  const o = res.data;
  const nTypes = o ? Object.values(o.anchor_types).reduce((s, x) => s + x, 0) : 0;
  const nAttr = o?.backlinks.total || 0;
  const nLink = o ? Object.values(o.link_types).reduce((s, x) => s + x, 0) : 0;
  const trend = (o?.trend || []).map(w => ({ ...w, label: new Date(w.week).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }), lostNeg: -w.lost }));
  const allDomains = o?.top_referring_domains || [];
  const domains = allDomains;
  const pie = o ? Object.entries(o.link_types).map(([k, v]) => ({ name: k, value: v })).filter(x => x.value > 0) : [];
  const anchors = (o?.top_anchors || []).filter(a => anchorTab === 'all' || a.type === anchorTab);
  const nDom = o?.referring_domains.total || 0;
  const review = (status, list = picked) => run('review', async () => {
    await api(`${base}/reviews`, { method: 'PUT', body: { domain: d, source_domains: list, status } });
    setPicked([]); res.reload(true); toast(status ? `${list.length} domain(s) marked ${REVIEW_LABEL[status].toLowerCase()}` : 'Decision cleared');
  });
  const downloadDisavow = () => run('dl', async () => {
    const r = await fetch(`${SEO_API}/businesses/${biz.id}/backlink-intel/disavow?domain=${encodeURIComponent(d)}`, { credentials: 'include' });
    const blob = await r.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `disavow-${d}.txt`; a.click(); URL.revokeObjectURL(a.href);
  });
  const runScores = () => run('score', async () => {
    const r = await api(`${base}/scores/run`, { method: 'POST', body: { domain: d } });
    res.reload(true); toast(`Scored ${r.scored.length} domain(s)${r.remaining ? `; ${r.remaining} left, run it again` : ''}`);
  });
  const explainNow = () => run('explain', async () => { setExplain(await api(`${base}/explain`, { method: 'POST', body: { domain: d } })); });
  const makeDraft = (dom) => run('draft', async () => {
    setDraft(await api(`${base}/reviews/draft-removal`, { method: 'POST', body: { domain: d, source_domain: dom } }));
  });
  const copyDraft = async () => {
    try { await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`); toast('Copied. Paste it into your email.'); } catch (e) { toast('Could not copy: select the text and copy it by hand.'); }
  };
  const toggle = (dom) => setPicked(p => p.includes(dom) ? p.filter(x => x !== dom) : [...p, dom]);
  const shown = showAll ? domains : domains.slice(0, 15);
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <select className={`${inputCls} !w-auto`} value={d} onChange={(e) => { setDomain(e.target.value); setPicked([]); }}>{targets.map(t => <option key={t.id}>{t.domain}</option>)}</select>
        {o && <span className="text-12 text-gray-500">Report scope: all links to <b className="text-gray-700">{o.domain}</b> · updated {fmtDateTime(o.generated_at)}</span>}
        <Button className="ml-auto" icon={RefreshCw} onClick={() => res.reload()}>Refresh</Button>
      </div>
      <ErrorNote>{res.error?.message || error}</ErrorNote>
      {!o ? <Spin /> : o.backlinks.total === 0 && o.backlinks.lost === 0 ? (
        <Card title={`No backlinks collected for ${o.domain} yet`} subtitle="The report fills in as soon as links are imported or the crawler finds them">
          <ol className="text-13 text-gray-700 list-decimal pl-5 space-y-1.5 mb-3">
            <li>Open <b>Discovery bot</b> and click <b>Run now</b>, or open <b>Seeds &amp; verify</b>, paste pages that should link to you and click <b>Run crawler now</b>.</li>
            <li>Add competitors under <b>Targets</b> to unlock the competitor link gap.</li>
          </ol>
          <Button variant="primary" icon={Play} onClick={() => go('bot')}>Open the discovery bot</Button>
        </Card>
      ) : (
        <>
          {o.alerts.length > 0 && (
            <div className="flex gap-3 overflow-x-auto pb-1 mb-4 no-scrollbar">
              {o.alerts.map(a => (
                <div key={a.id} className={`min-w-[250px] flex-1 bg-white shadow-card rounded p-3 border-l-4 ${ALERT_TONE[a.tone]}`}>
                  <div className="text-13 font-semibold text-gray-900">{a.title}</div>
                  <div className="text-12 text-gray-500 mt-1 min-h-[34px]">{a.detail}</div>
                  <Button size="sm" className="mt-2" onClick={() => go('explorer')}>{a.id === 'lost' ? 'Review lost links' : 'Review'}</Button>
                </div>))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Button icon={Sparkles} busy={busy === 'explain'} onClick={explainNow}>Explain what changed</Button>
            <span className="text-12 text-gray-500">A plain-words summary of the last 30 days of link changes.</span>
          </div>
          {explain && (
            <Card className="mb-4" title="What changed" subtitle="Last 30 days" action={<SourceBadge source={explain.source} />}>
              <p className="text-13 text-gray-800">{explain.summary}</p>
              {explain.actions.length > 0 && <ul className="list-disc pl-5 mt-2 text-13 text-gray-700 space-y-1">{explain.actions.map((x, i) => <li key={i}>{x}</li>)}</ul>}
            </Card>
          )}

          <Card className="mb-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div><div className="text-13 font-semibold text-gray-900 mb-2">Referring domains</div>
                <Big value={o.referring_domains.total} sub={`${o.referring_domains.follow_pct}% follow`} rows={[['New (30d)', o.referring_domains.new, 'text-emerald-600'], ['Lost', o.referring_domains.lost, 'text-red-500']]} /></div>
              <div><div className="text-13 font-semibold text-gray-900 mb-2">Analyzed backlinks</div>
                <Big value={o.backlinks.total} sub={`${o.backlinks.follow_pct}% follow`} rows={[['New (30d)', o.backlinks.new, 'text-emerald-600'], ['Broken', o.backlinks.broken, 'text-amber-600'], ['Lost', o.backlinks.lost, 'text-red-500']]} /></div>
              <div><div className="text-13 font-semibold text-gray-900 mb-2">Verified by our crawler</div>
                <Big value={`${o.backlinks.crawler_verified}/${o.backlinks.total}`} sub="links" rows={[['Not verified', o.backlinks.total - o.backlinks.crawler_verified, 'text-gray-600']]} /></div>
            </div>
          </Card>

          <Card className="mb-4" title="Referring domains over time" subtitle="Weekly, last 12 weeks"
            action={<Tabs tabs={[{ id: 'dynamic', label: 'Profile dynamic' }, { id: 'nl', label: 'New & lost domains' }]} value={view} onChange={setView} />}>
            <div style={{ height: 240 }}>
              <ResponsiveContainer>
                {view === 'dynamic' ? (
                  <BarChart data={trend}><CartesianGrid stroke={INK.grid} vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 11, fill: INK.muted }} /><YAxis allowDecimals={false} tick={{ fontSize: 11, fill: INK.muted }} /><Tooltip />
                    <Bar dataKey="total" name="Referring domains" fill={SERIES[0]} radius={[3, 3, 0, 0]} /></BarChart>
                ) : (
                  <BarChart data={trend} stackOffset="sign"><CartesianGrid stroke={INK.grid} vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 11, fill: INK.muted }} /><YAxis allowDecimals={false} tick={{ fontSize: 11, fill: INK.muted }} /><Tooltip formatter={(v, n) => [Math.abs(v), n]} /><ReferenceLine y={0} stroke={INK.axis} />
                    <Bar dataKey="new" name="New" stackId="a" fill={SERIES[2]} radius={[3, 3, 0, 0]} /><Bar dataKey="lostNeg" name="Lost" stackId="a" fill={SERIES[4]} radius={[0, 0, 3, 3]} /></BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
            <Card title="Backlinks to review" subtitle="Links from domains you have not marked yet">
              <Metric label="Awaiting your review" tone={C.amber} value={o.review.to_review.pending} />
              <Metric label="Whitelisted" tone={C.gray} value={o.review.to_review.whitelisted} />
              <Button className="mt-3" variant="primary" onClick={() => document.getElementById('bi-domains')?.scrollIntoView({ behavior: 'smooth' })}>Review backlinks</Button>
            </Card>
            <Card title="Backlink removal requests" subtitle="Track outreach to have links removed">
              <Metric label="To contact" tone={SERIES[1]} value={o.review.removal.to_contact} />
              <Metric label="Not replied" tone={SERIES[3]} value={o.review.removal.not_replied} />
              <Metric label="Replied" tone={SERIES[0]} value={o.review.removal.replied} />
              <Metric label="Removed" tone={SERIES[2]} value={o.review.removal.removed} />
              <p className="text-11 text-gray-400 mt-2">Select domains in the table below and choose “To contact”, then move them along as you hear back.</p>
            </Card>
            <Card title="Items to disavow" subtitle="Ask Google to ignore clearly spammy links">
              <Metric label="Marked for disavow" tone={C.red} value={o.review.disavow.marked} />
              <Button className="mt-3" icon={Download} busy={busy === 'dl'} disabled={!o.review.disavow.marked} onClick={downloadDisavow}>Download disavow file</Button>
              <p className="text-11 text-gray-400 mt-2">Upload it to Google's Disavow tool. Only disavow clear spam; Google ignores most low-quality links.</p>
            </Card>
          </div>

          <div id="bi-domains">
            <Card className="mb-4" title="Top referring domains" subtitle={`${allDomains.length} domain${allDomains.length === 1 ? '' : 's'} linking to ${o.domain} · ${o.quality.good} good, ${o.quality.ok} ok, ${o.quality.risky} risky, ${o.quality.unscored} not scored`}
              action={<Button size="sm" icon={Sparkles} busy={busy === 'score'} disabled={!o.quality.unscored} onClick={runScores}>{o.quality.unscored ? `Score ${o.quality.unscored} with AI` : 'All scored'}</Button>}
>
              {picked.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 mb-3 p-2 rounded bg-indigo-50">
                  <span className="text-12 text-indigo-700 font-medium">{picked.length} selected</span>
                  <Button size="sm" busy={busy === 'review'} onClick={() => review('disavow')}>Disavow</Button>
                  <Button size="sm" onClick={() => review('whitelisted')}>Whitelist</Button>
                  <Button size="sm" onClick={() => review('to_contact')}>To contact</Button>
                  <Button size="sm" busy={busy === 'draft'} disabled={picked.length !== 1} title="Select one domain" onClick={() => makeDraft(picked[0])}>Draft removal email</Button>
                  <Button size="sm" onClick={() => review(null)}>Clear</Button>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-13">
                  <thead className="text-12 text-gray-500 border-b border-gray-200"><tr><Th /><Th>Domain</Th><Th>Quality</Th><Th right>Backlinks</Th><Th right>Verified</Th><Th right>Follow</Th><Th>Status</Th><Th>First seen</Th></tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {shown.map(x => (
                      <tr key={x.domain}>
                        <td className="p-2"><input type="checkbox" checked={picked.includes(x.domain)} onChange={() => toggle(x.domain)} aria-label={`Select ${x.domain}`} /></td>
                        <td className="p-2"><a className="text-indigo-600 hover:underline" href={`https://${x.domain}`} target="_blank" rel="noreferrer noopener nofollow">{x.domain}</a></td>
                        <td className="p-2"><Quality q={x.quality} /></td>
                        <td className="p-2 text-right tabular-nums text-indigo-600">{x.backlinks}</td>
                        <td className="p-2 text-right tabular-nums">{x.crawler_verified}</td>
                        <td className="p-2 text-right tabular-nums">{x.follow_pct}%</td>
                        <td className="p-2">{x.review ? <Badge tone={REVIEW_TONE[x.review]}>{REVIEW_LABEL[x.review]}</Badge> : <span className="text-gray-300">—</span>}</td>
                        <td className="p-2 text-12 text-gray-500">{fmtDateTime(x.first_seen_at)}</td>
                      </tr>))}
                  </tbody>
                </table>
              </div>
              {domains.length > 15 && <button className="text-12 text-indigo-600 mt-2 cursor-pointer" onClick={() => setShowAll(s => !s)}>{showAll ? 'Hide' : `Show more (${domains.length - 15})`}</button>}
            </Card>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
            <Card title="Backlinks by anchor type" subtitle="Heuristic classification of the anchor text">
              {Object.entries(o.anchor_types).map(([k, v]) => <Hbar key={k} label={ANCHOR_LABEL[k]} value={v} total={nTypes} color={SERIES[0]} />)}
            </Card>
            <Card title="Top anchors" pad={false}>
              <div className="px-4 pt-1"><Tabs tabs={[{ id: 'all', label: 'All types' }, { id: 'money', label: 'Money' }, { id: 'compound', label: 'Compound' }, { id: 'branded', label: 'Branded' }]} value={anchorTab} onChange={setAnchorTab} /></div>
              <div className="max-h-[300px] overflow-y-auto px-4 pb-3">
                <table className="w-full text-13">
                  <thead className="text-12 text-gray-500 border-b border-gray-200 sticky top-0 bg-white"><tr><Th>Anchor text</Th><Th right>Domains</Th><Th right>Backlinks</Th></tr></thead>
                  <tbody className="divide-y divide-gray-100">{anchors.length === 0 ? <tr><td colSpan={3} className="p-4 text-center text-gray-500">No {anchorTab} anchors.</td></tr> : anchors.map(a => (
                    <tr key={a.anchor}><td className="p-2 max-w-[320px] truncate" title={a.anchor}>{a.anchor}</td><td className="p-2 text-right tabular-nums text-indigo-600">{a.domains}</td><td className="p-2 text-right tabular-nums text-indigo-600">{a.backlinks}</td></tr>))}</tbody>
                </table>
              </div>
            </Card>
          </div>

          <Card className="mb-4" title="Top target pages" subtitle="Pages on your site that receive the most links">
            <table className="w-full text-13">
              <thead className="text-12 text-gray-500 border-b border-gray-200"><tr><Th>Target URL</Th><Th right>Domains</Th><Th right>Backlinks</Th></tr></thead>
              <tbody className="divide-y divide-gray-100">{o.target_pages.map(t => (
                <tr key={t.target_url}><td className="p-2 break-all">{t.target_url}</td>
                  <td className="p-2 text-right tabular-nums"><span className="text-gray-500 mr-1.5">{(t.domain_share * 100).toFixed(1)}%</span><span className="text-indigo-600">{t.domains}</span></td>
                  <td className="p-2 text-right tabular-nums"><span className="text-gray-500 mr-1.5">{(t.share * 100).toFixed(1)}%</span><span className="text-indigo-600">{t.backlinks}</span></td></tr>))}</tbody>
            </table>
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card title="Backlinks by link attributes" subtitle="A link can carry more than one attribute">
              {[['follow', 'Follow', SERIES[2]], ['nofollow', 'Nofollow', SERIES[0]], ['sponsored', 'Sponsored', SERIES[3]], ['ugc', 'UGC', SERIES[4]]].map(([k, label, c]) => <Hbar key={k} label={label} value={o.attributes[k]} total={nAttr} color={c} />)}
            </Card>
            <Card title="Backlinks by link type">
              <div className="flex items-center gap-6">
                <div style={{ width: 160, height: 160 }}>
                  <ResponsiveContainer><PieChart><Pie data={pie} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={pie.length > 1 ? 2 : 0}>{pie.map(p => <Cell key={p.name} fill={TYPE_COLOR[p.name]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer>
                </div>
                <div className="space-y-1.5 text-13">{Object.entries(o.link_types).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: TYPE_COLOR[k] }} /><span className="capitalize w-14">{k}</span><span className="tabular-nums text-gray-500">{nLink ? Math.round((v / nLink) * 100) : 0}%</span><b className="tabular-nums text-indigo-600 font-semibold">{v}</b></div>))}</div>
              </div>
            </Card>
          </div>
        </>
      )}
      <Modal open={Boolean(draft)} title={draft ? `Removal request for ${draft.source_domain}` : ''} onClose={() => setDraft(null)} width="max-w-2xl"
        footer={draft && (
          <>
            <Button onClick={() => setDraft(null)}>Close</Button>
            <Button onClick={() => { review('to_contact', [draft.source_domain]); }}>Mark “To contact”</Button>
            <Button variant="primary" onClick={copyDraft}>Copy email</Button>
          </>)}>
        {draft && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-12 text-gray-500">
              <Badge tone={draft.source === 'ai' ? 'blue' : 'gray'}>{draft.source === 'ai' ? 'Written by AI' : 'Template'}</Badge>
              Review and edit before sending. Nothing is sent from here.
            </div>
            <Field label="Subject"><input className={inputCls} value={draft.subject} onChange={(e) => setDraft(x => ({ ...x, subject: e.target.value }))} /></Field>
            <Field label="Message"><textarea className={areaCls} rows={12} value={draft.body} onChange={(e) => setDraft(x => ({ ...x, body: e.target.value }))} /></Field>
          </div>)}
      </Modal>
      {toastNode}
    </>
  );
}

function Gap({ base, targets }) {
  const [busy, error, run] = useAction();
  const [plan, setPlan] = useState(null);
  const own = targets.filter(t => !t.is_competitor);
  const hasComp = targets.some(t => t.is_competitor);
  const [client, setClient] = useState('');
  const c = client || own[0]?.domain || '';
  const g = useApi(c && hasComp ? `${base}/gap?client=${encodeURIComponent(c)}` : null);
  const csv = () => {
    const rows = [['domain', 'competitors_linking', 'backlinks', 'crawler_verified'], ...g.data.gap.map(x => [x.domain, x.competitors.join(' | '), x.backlinks, x.crawler_verified])];
    const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `backlink-gap-${c}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <Card title="Competitor link gap" subtitle="Sites that link to your competitors but not to you. A prospecting signal: review relevance and quality before outreach."
      action={g.data?.gap?.length ? <Button icon={Download} onClick={csv}>CSV</Button> : null}>
      {own.length > 0 && hasComp && (
        <div className="mb-3">
          <Button icon={Sparkles} busy={busy === 'plan'} onClick={() => run('plan', async () => setPlan(await api(`${base}/gap/prioritize`, { method: 'POST', body: { client: c } })))}>Prioritise with AI</Button>
          <span className="text-12 text-gray-500 ml-2">Which of these are worth approaching, and how.</span>
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {plan && (
        <div className="mb-4 p-3 rounded bg-indigo-50/50 border border-indigo-100">
          <div className="flex items-center gap-2 mb-2"><span className="text-13 font-semibold text-gray-900">Best prospects first</span><SourceBadge source={plan.source} /><span className="text-11 text-gray-500">{plan.considered} considered</span></div>
          {plan.prospects.map(x => (
            <div key={x.domain} className="py-2 border-t border-indigo-100 first:border-t-0">
              <div className="flex items-center gap-2"><b className="text-13 text-gray-900">{x.domain}</b><Badge tone={x.win_chance === 'high' ? 'green' : x.win_chance === 'medium' ? 'amber' : 'gray'}>{x.win_chance} chance</Badge>
                <span className="text-11 text-gray-500">links to {x.competitors.join(', ')}</span></div>
              <div className="text-12 text-gray-700 mt-0.5">{x.angle}</div>
              <div className="text-11 text-gray-500">{x.reason}</div>
            </div>))}
        </div>
      )}
      {!own.length || !hasComp ? <Empty>Add your own domain and at least one competitor under “Targets”.</Empty> : (
        <>
          <select className={`${inputCls} !w-auto mb-3`} value={c} onChange={(e) => setClient(e.target.value)}>{own.map(t => <option key={t.id}>{t.domain}</option>)}</select>
          {!g.data ? <Spin /> : g.data.gap.length === 0 ? <Empty>No gap found in the data collected so far.</Empty> : (
            <table className="w-full text-13"><thead className="text-12 text-gray-500 border-b border-gray-200"><tr><Th>Domain</Th><Th>Links to</Th><Th right>Links</Th><Th right>Verified</Th></tr></thead>
              <tbody className="divide-y divide-gray-100">{g.data.gap.map(x => <tr key={x.domain}><td className="p-2 text-gray-900">{x.domain}</td><td className="p-2 text-gray-600">{x.competitors.join(', ')}</td><td className="p-2 text-right tabular-nums">{x.backlinks}</td><td className="p-2 text-right tabular-nums">{x.crawler_verified}</td></tr>)}</tbody></table>
          )}
        </>
      )}
    </Card>
  );
}

function Targets({ base, targets, reload, onToast }) {
  const [domain, setDomain] = useState('');
  const [comp, setComp] = useState(false);
  const [busy, error, run] = useAction();
  const add = () => run('add', async () => {
    await api(`${base}/targets`, { method: 'POST', body: { domain, is_competitor: comp } });
    setDomain(''); reload(true); onToast('Domain added');
  });
  const remove = (id) => run('rm', async () => { await api(`${base}/targets/${id}`, { method: 'DELETE' }); reload(true); });
  return (
    <Card title="Tracked domains" subtitle="Your sites and competitors. Backlinks are collected and monitored for these.">
      <div className="flex flex-wrap items-end gap-2 mb-3">
        <Field label="Domain"><input className={`${inputCls} !w-64`} placeholder="example.com" value={domain} onChange={(e) => setDomain(e.target.value)} /></Field>
        <label className="flex items-center gap-1.5 text-13 pb-2"><input type="checkbox" checked={comp} onChange={(e) => setComp(e.target.checked)} /> Competitor</label>
        <Button variant="primary" icon={Plus} busy={busy === 'add'} disabled={domain.trim().length < 3} onClick={add}>Add</Button>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button icon={RefreshCw} busy={busy === 'sync'} onClick={() => run('sync', async () => { const r = await api(`${base}/targets/sync`, { method: 'POST' }); reload(true); onToast(r.added.length ? `Added ${r.added.length}: ${r.added.map(a => a.domain).join(', ')}` : 'Already up to date'); })}>Sync with my business and Competitor Research</Button>
        <span className="text-12 text-gray-500">Adds your website and the competitors you saved elsewhere in the platform.</span>
      </div>
      <ErrorNote>{error}</ErrorNote>
      {targets.length === 0 ? <Empty>Nothing tracked yet.</Empty> : targets.map(t => (
        <div key={t.id} className="flex items-center gap-3 py-2 border-b border-gray-100 text-13">
          <span className="flex-1 text-gray-900">{t.domain}</span>
          <Badge tone={t.is_competitor ? 'amber' : 'green'}>{t.is_competitor ? 'Competitor' : 'Your site'}</Badge>
          <button className="text-gray-400 hover:text-red-500 cursor-pointer" aria-label={`Remove ${t.domain}`} onClick={() => remove(t.id)}><Trash2 size={14} /></button>
        </div>
      ))}
    </Card>
  );
}

function Collect({ base, targets, onToast }) {
  const [busy, error, run] = useAction();
  const [domain, setDomain] = useState('');
  const [urls, setUrls] = useState('');
  const [result, setResult] = useState(null);
  const status = useApi(`${base}/crawl/status`);
  const d = domain || targets[0]?.domain || '';
  const seed = () => run('seed', async () => {
    const list = urls.split(/\s+/).filter(Boolean);
    const r = await api(`${base}/crawl/seed`, { method: 'POST', body: { urls: list } });
    onToast(`${r.queued} page(s) queued`); setUrls(''); status.reload(true);
  });
  const crawl = () => run('crawl', async () => {
    const r = await api(`${base}/crawl/run`, { method: 'POST', body: { limit: 10 } });
    setResult(r); onToast(`Crawled ${r.processed} page(s)`); status.reload(true);
  });
  const verify = () => run('verify', async () => {
    const r = await api(`${base}/verify`, { method: 'POST', body: { all_due: true } });
    onToast(`${r.queued} source page(s) queued for verification`); status.reload(true);
  });
  const counts = Object.entries(status.data?.frontier || {}).map(([q, s]) => `${q}: ${Object.entries(s).map(([k, v]) => `${v} ${k}`).join(', ')}`);
  return (
    <div className="grid grid-cols-1 gap-4">
      <Card title="Seeds and verification" subtitle="Give the bot places to look (pages that should link to you), or re-check links it already found. It respects robots.txt and rate limits.">
        <Field label="Pages to check (one per line)"><textarea className="ai-glass-input w-full px-3 py-2 text-13 rounded" rows={3} placeholder="https://some-blog.com/post-that-links-to-you" value={urls} onChange={(e) => setUrls(e.target.value)} /></Field>
        <div className="flex flex-wrap gap-2 mt-2">
          <Button icon={Plus} busy={busy === 'seed'} disabled={!urls.trim()} onClick={seed}>Queue pages</Button>
          <Button variant="primary" icon={Play} busy={busy === 'crawl'} disabled={!targets.length} onClick={crawl}>Run crawler now</Button>
          <Button icon={Crosshair} busy={busy === 'verify'} onClick={verify}>Re-check all known links</Button>
        </div>
        <div className="text-12 text-gray-500 mt-3">{counts.length ? counts.join(' · ') : 'Queue is empty.'}</div>
        {result && (
          <div className="mt-2 text-12">{result.results.map((x, i) => (
            <div key={i} className="py-1 border-b border-gray-100 break-all">{x.url} → {x.error_code ? <Badge tone="amber">{x.error_code}</Badge> : `HTTP ${x.http_status}`} · {x.links_seen} links · {x.new_backlinks} new backlink(s)</div>))}
          </div>
        )}
      </Card>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}

function BotPanel({ base, targets, onToast }) {
  const st = useApi(`${base}/bot`);
  const [busy, error, run] = useAction();
  const s = st.data;
  const running = Boolean(s?.running);
  usePoll(() => st.reload(true), running, 2500);
  const save = (patch) => run('save', async () => { await api(`${base}/bot`, { method: 'PUT', body: patch }); st.reload(true); });
  const start = () => run('start', async () => { await api(`${base}/bot/run`, { method: 'POST' }); onToast('Bot started'); setTimeout(() => st.reload(true), 800); });
  if (!s) return <Card><Spin /></Card>;
  const c = s.config;
  const queued = Object.values(s.frontier || {}).reduce((n, q) => n + (q.pending || 0), 0);
  const last = s.last_stats;
  return (
    <>
      <Card className="mb-4" title="Discovery bot" subtitle="Our own crawler. It starts from your tracked sites and competitors, explores the pages around them, and records every link it finds to them. No third-party index is used."
        action={<Badge tone={running ? 'blue' : c.enabled ? 'green' : 'gray'}>{running ? 'Running' : c.enabled ? 'Scheduled' : 'Off'}</Badge>}>
        {!targets.length ? <Empty>Add your site and your competitors under “Targets” first. The bot starts from the domains you track.</Empty> : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              {[['Pages fetched', s.totals.pages_fetched], ['Pages known', s.totals.pages_known], ['Domains discovered', s.totals.domains_known], ['Backlinks found by the bot', s.totals.backlinks_found_by_bot]].map(([k, v]) => (
                <div key={k}><div className="text-12 text-gray-500">{k}</div><div className="text-[24px] font-semibold text-indigo-600 tabular-nums">{v}</div></div>))}
            </div>
            <div className="flex flex-wrap items-end gap-3 mb-3">
              <label className="flex items-center gap-2 text-13 pb-2"><input type="checkbox" checked={c.enabled} onChange={(e) => save({ enabled: e.target.checked })} /> Run automatically</label>
              <Field label="Every"><select className={`${inputCls} !w-auto`} value={c.interval_minutes} onChange={(e) => save({ interval_minutes: Number(e.target.value) })}>{[15, 30, 60, 180, 360, 1440].map(m => <option key={m} value={m}>{m >= 60 ? `${m / 60} h` : `${m} min`}</option>)}</select></Field>
              <Field label="Pages per run"><select className={`${inputCls} !w-auto`} value={c.pages_per_run} onChange={(e) => save({ pages_per_run: Number(e.target.value) })}>{[...new Set([25, 50, 100, 250, 500, c.pages_per_run])].sort((x, y) => x - y).map(n => <option key={n}>{n}</option>)}</select></Field>
              <Field label="How far to explore" hint="Links followed away from your tracked sites"><select className={`${inputCls} !w-auto`} value={c.max_hops} onChange={(e) => save({ max_hops: Number(e.target.value) })}>
                <option value={0}>Only your own sites</option><option value={1}>1 step out (recommended)</option><option value={2}>2 steps out</option><option value={3}>3 steps out (slow, wide)</option></select></Field>
              <label className="flex items-center gap-2 text-13 pb-2" title={s.render_available ? 'Loads pages built with JavaScript in a real browser. Slower: at most 10 pages per run.' : 'Chrome was not found on the server, so this is unavailable.'}>
                <input type="checkbox" disabled={!s.render_available} checked={c.render_js} onChange={(e) => save({ render_js: e.target.checked })} /> Read JavaScript pages
              </label>
              <Button variant="primary" icon={running ? Loader2 : Play} busy={busy === 'start' || running} disabled={running} onClick={start}>{running ? 'Running…' : 'Run now'}</Button>
            </div>
            <ErrorNote>{error}</ErrorNote>
            <div className="text-12 text-gray-500">
              {queued} page(s) waiting in the queue
              {s.last_run_at && <> · last run {fmtDateTime(s.last_run_at)}{last && !last.skipped ? `: ${last.pages} pages, ${last.new_backlinks} new backlink(s), ${last.queued} queued, ${last.errors} error(s), ${last.blocked} blocked by robots.txt${last.rendered ? `, ${last.rendered} read in a browser` : ''}${last.handoff ? `; scored ${last.handoff.scored} linking domain(s), ${last.handoff.tasks} removal request(s) waiting for approval in Autonomous AI Agents` : ''}` : ''}</>}
            </div>
            <p className="text-11 text-gray-400 mt-3">The bot follows public links only, obeys robots.txt, waits between requests to the same site, and stays inside the page budget above. It finds links on pages it can reach from your sites, so coverage grows with each run but is smaller than a commercial index. Raise “how far to explore” to widen it.</p>
          </>
        )}
      </Card>
      <Card title="What it just fetched" subtitle="Most recent requests">
        {s.recent.length === 0 ? <Empty>Nothing yet. Click “Run now”.</Empty> : s.recent.map((r, i) => (
          <div key={i} className="flex gap-2 text-12 py-1 border-b border-gray-100">
            <Badge tone={r.error_code ? 'amber' : r.http_status && r.http_status < 400 ? 'green' : 'gray'}>{r.error_code || `HTTP ${r.http_status}`}</Badge>
            <span className="w-16 text-gray-500">{r.purpose}</span><span className="flex-1 break-all text-gray-700">{r.url}</span><span className="text-gray-400">{fmtDateTime(r.at)}</span>
          </div>))}
      </Card>
      {st.error && <ErrorNote>{st.error.message}</ErrorNote>}
    </>
  );
}

function Body({ b }) {
  const [tab, setTab] = useUrlTab('overview', ['overview', 'explorer', 'gap', 'bot', 'collect', 'targets']);
  const base = `/businesses/${b.id}/backlink-intel`;
  const t = useApi(`${base}/targets`);
  const [toast, toastNode] = useToast();
  const reload = useCallback((q) => t.reload(q), [t.reload]);
  const targets = t.data || [];
  return (
    <>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'overview', label: 'Overview' }, { id: 'explorer', label: 'Backlink explorer' }, { id: 'gap', label: 'Competitor gap' },
        { id: 'bot', label: 'Discovery bot' }, { id: 'collect', label: 'Seeds & verify' }, { id: 'targets', label: 'Targets', count: targets.length }]} />
      <ErrorNote>{t.error?.message}</ErrorNote>
      {t.loading && !t.data ? <Spin /> : (
        <>
          {tab === 'overview' && <Overview base={base} targets={targets} biz={b} go={setTab} reload={reload} />}
          {tab === 'explorer' && <Explorer base={base} targets={targets} />}
          {tab === 'gap' && <Gap base={base} targets={targets} />}
          {tab === 'bot' && <BotPanel base={base} targets={targets} onToast={toast} />}
          {tab === 'collect' && <Collect base={base} targets={targets} onToast={toast} />}
          {tab === 'targets' && <Targets base={base} targets={targets} reload={reload} onToast={toast} />}
        </>
      )}
      {toastNode}
    </>
  );
}

export default function BacklinkIntelPage() {
  return (
    <SeoShell title="Backlink intelligence" subtitle="Backlinks found by our own discovery bot, with status, evidence and history for every link">
      {(b) => <Body key={b.id} b={b} />}
    </SeoShell>
  );
}
