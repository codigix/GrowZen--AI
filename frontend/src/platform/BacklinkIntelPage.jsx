import React, { useCallback, useEffect, useState } from 'react';
import { Play, Plus, Trash2, Download, RefreshCw, Loader2, Search, Crosshair, History, Sparkles, Bot } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, ReferenceLine, Legend } from 'recharts';
import { SeoShell, Card, Tabs, Badge, Button, Meter, ErrorNote, Drawer, Field, Modal, Stat, inputCls, areaCls, SERIES, INK, useToast, useAction, useUrlTab, useDoubleConfirm, SkStats, SkTable, SkChart, SkList, SkCard } from './SeoUi';
import { api, useApi, usePoll, fmtDateTime, SEO_API } from './seoApi';
import Select from '../components/Select';

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
const Th = ({ children, right }) => <th className={`p-2 font-medium ${right ? 'text-right' : 'text-left'}`}>{children}</th>;

function HistoryDrawer({ base, id, onClose }) {
  const link = useApi(id ? `${base}/${id}` : null);
  const hist = useApi(id ? `${base}/${id}/history` : null);
  const l = link.data;
  return (
    <Drawer open={Boolean(id)} onClose={onClose} title="Backlink history" subtitle={l?.source_url}>
      {!l || !hist.data ? <div className="space-y-4"><SkStats n={2} cols="grid-cols-2" /><SkList rows={4} avatar={false} /></div> : (
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
        <Select className={`${inputCls} !w-auto`} value={f.target} onChange={set('target')}>
          <option value="">All tracked domains</option>{targets.map(t => <option key={t.id} value={t.domain}>{t.domain}</option>)}
        </Select>
        <Select className={`${inputCls} !w-auto`} value={f.status} onChange={set('status')}>
          <option value="">Any status</option>{STATUSES.map(s => <option key={s}>{s}</option>)}
        </Select>
        <Select className={`${inputCls} !w-auto`} value={f.verification_status} onChange={set('verification_status')}>
          <option value="">Any verification</option><option value="CRAWLER_VERIFIED">Crawler verified</option><option value="IMPORTED">Not verified</option>
        </Select>
        <div className="relative"><Search size={13} className="absolute left-2.5 top-3 text-gray-400" /><input className={`${inputCls} !w-52 !pl-8`} placeholder="Anchor contains…" value={f.anchor} onChange={set('anchor')} /></div>
        <Button icon={RefreshCw} onClick={() => res.reload()}>Refresh</Button>
      </div>
      <ErrorNote>{res.error?.message}</ErrorNote>
      {res.loading && !res.data ? <SkTable cols={7} rows={8} /> : rows.length === 0 ? <Empty>No backlinks yet. Run the discovery bot, or queue pages that should link to a tracked domain and run the crawler.</Empty> : (
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

const DIRECTION_TONE = { inbound: 'green', outbound: 'blue', other: 'gray' };
const DIRECTION_LABEL = { inbound: 'Links to it', outbound: 'Links from it', other: 'Other match' };

// Shown when no stored backlink matches a domain/URL query: the backend starts (or reuses) a live Ahrefs lookup via Fortress and we show its state.
function AhrefsFallback({ query, af }) {
  if (!af) return <Empty>No stored backlinks match “{query}”.</Empty>;
  if (af.state === 'queued' || af.state === 'in_progress' || af.status === 'queued' || af.status === 'running') {
    return (
      <div className="py-6 text-center">
        <Loader2 size={16} className="inline-block animate-spin text-indigo-500 mb-2" />
        <div className="text-13 text-gray-700">No stored backlinks for “{query}” yet. Looking it up live on Ahrefs now…</div>
        <div className="text-12 text-gray-500 mt-1">This takes about 30-120 seconds; the search refreshes itself.</div>
      </div>
    );
  }
  if (af.status === 'failed') {
    return (
      <div className="py-6 text-center">
        <div className="text-13 text-gray-700">No stored backlinks for “{query}”, and the live Ahrefs lookup failed.</div>
        <div className="text-12 text-gray-500 mt-1 break-all">{af.error}</div>
      </div>
    );
  }
  if (af.status === 'done') {
    return (
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Badge tone="blue">From Ahrefs (live lookup)</Badge>
          <span className="text-12 text-gray-500">No stored backlinks for “{query}”; here is Ahrefs' public report for {af.domain}.</span>
        </div>
        <div className="flex flex-wrap gap-4 mb-3 text-13">
          {af.domain_rating != null && <div><span className="text-gray-500">Domain rating </span><b className="text-indigo-600">{af.domain_rating}</b></div>}
          {af.backlinks && <div><span className="text-gray-500">Backlinks </span><b className="text-indigo-600">{af.backlinks.value}</b> <span className="text-gray-400">({af.backlinks.dofollow} dofollow)</span></div>}
          {af.linking_websites && <div><span className="text-gray-500">Linking websites </span><b className="text-indigo-600">{af.linking_websites.value}</b> <span className="text-gray-400">({af.linking_websites.dofollow} dofollow)</span></div>}
        </div>
        {!af.referring_pages?.length ? <Empty>Ahrefs returned no referring pages.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-13">
              <thead className="text-12 text-gray-500 border-b border-gray-200"><tr><Th>Referring page</Th><Th>Anchor</Th><Th>Target</Th><Th right>DR</Th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {af.referring_pages.map((p, i) => (
                  <tr key={i}>
                    <td className="p-2 max-w-[280px] truncate" title={p.referring_page_title}>
                      {p.referring_page_url ? <a className="text-indigo-600 hover:underline" href={p.referring_page_url} target="_blank" rel="noreferrer noopener nofollow">{p.referring_page_url.replace(/^https?:\/\//, '')}</a> : p.referring_page_title || '—'}
                    </td>
                    <td className="p-2 max-w-[200px] truncate text-gray-700" title={p.anchor_text || ''}>{p.anchor_text || '—'}</td>
                    <td className="p-2 max-w-[220px] truncate text-gray-600" title={p.target_url || ''}>{(p.target_url || '').replace(/^https?:\/\//, '') || '—'}</td>
                    <td className="p-2 text-right tabular-nums">{p.dr || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }
  return <Empty>No stored backlinks match “{query}”.</Empty>;
}

// GET /backlink-intel/lookup: fuzzy search by domain, URL or word over every backlink stored (all projects, not only this one). Falls back to a
// live Ahrefs lookup via Fortress when a domain/URL query has no stored matches.
function Lookup() {
  const fromLink = new URLSearchParams(window.location.search).get('q') || ''; // ?q=domain opens the search already filled in and run
  const [q, setQ] = useState(fromLink);
  const [limit, setLimit] = useState(25);
  const [res, setRes] = useState(null);
  const [busy, error, run] = useAction();
  const search = (e) => {
    e?.preventDefault();
    run('lookup', async () => setRes(await api(`/backlink-intel/lookup?${new URLSearchParams({ q: q.trim(), limit: String(limit) })}`)));
  };
  useEffect(() => { if (fromLink) search(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const s = res?.summary;
  const matched = res ? [...(res.matched_domains?.as_target || []), ...(res.matched_domains?.as_source || [])] : [];
  const domains = [...new Map(matched.map(m => [m.domain, m])).values()].slice(0, 12);
  const af = res?.ahrefs_fallback;
  usePoll(() => search(), Boolean(af && ['queued', 'in_progress', 'running'].includes(af.state)), 5000);
  return (
    <Card className="mb-4" title="Search all backlinks" subtitle="Find links by a domain, URL or word (typos allowed): codigix finds codigix.co and codigixinfotech.com. Searches every project's stored backlinks; leave empty or use * to list everything.">
      <form className="flex flex-wrap gap-2 mb-3" onSubmit={search}>
        <div className="relative"><Search size={13} className="absolute left-2.5 top-3 text-gray-400" /><input className={`${inputCls} !w-80 !pl-8`} placeholder="codigix.co, https://site.com/blog or a word" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Select className={`${inputCls} !w-auto`} value={limit} onChange={(e) => setLimit(Number(e.target.value))} aria-label="Results">{[25, 100, 500].map(n => <option key={n} value={n}>{n} results</option>)}</Select>
        <Button type="submit" variant="primary" icon={Search} busy={busy === 'lookup'}>Search</Button>
      </form>
      <ErrorNote>{error}</ErrorNote>
      {s && (
        <>
          <div className="text-12 text-gray-500 mb-2">
            {s.total_backlinks} matching backlink(s) from {s.referring_domains} domain(s)
            {s.inbound != null && <> · {s.inbound} link to it · {s.outbound} link from it</>}
            {' '}· showing {s.returned}{res.interpreted_as?.type !== 'all' ? ` · read as a ${res.interpreted_as.type}: ${res.interpreted_as.term}${res.interpreted_as.path || ''}` : ''}
          </div>
          {domains.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">{domains.map(m => <Badge key={m.domain} tone={m.score === 100 ? 'green' : m.score >= 92 ? 'blue' : 'gray'}>{m.domain} · {m.backlinks}</Badge>)}</div>
          )}
          {res.data.length === 0 ? <AhrefsFallback query={res.query} af={af} /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-13">
                <thead className="text-12 text-gray-500 border-b border-gray-200"><tr><Th>Direction</Th><Th>Source page</Th><Th>Target</Th><Th>Anchor</Th><Th>Attr</Th><Th>Status</Th><Th>Last seen</Th><Th right>Match</Th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {res.data.map(r => (
                    <tr key={r.id}>
                      <td className="p-2"><Badge tone={DIRECTION_TONE[r.direction] || 'gray'}>{DIRECTION_LABEL[r.direction] || 'All'}</Badge></td>
                      <td className="p-2 max-w-[240px] truncate" title={r.source_url}><a className="text-indigo-600 hover:underline" href={r.source_url} target="_blank" rel="noreferrer noopener nofollow">{r.source_url.replace(/^https?:\/\//, '')}</a></td>
                      <td className="p-2 max-w-[220px] truncate text-gray-600" title={r.target_url}>{r.target_url.replace(/^https?:\/\//, '')}</td>
                      <td className="p-2 max-w-[160px] truncate text-gray-700" title={r.anchor_text || ''}>{r.anchor_text || '—'}</td>
                      <td className="p-2 text-12 text-gray-600">{r.rel_attributes.length ? r.rel_attributes.join(', ') : 'follow'}</td>
                      <td className="p-2"><Badge tone={STATUS_TONE[r.status] || 'gray'}>{r.status}</Badge></td>
                      <td className="p-2 text-12 text-gray-500">{fmtDateTime(r.last_seen_at)}</td>
                      <td className="p-2 text-12 text-right text-gray-500" title={(r.matched_on || []).join(', ')}>{r.match_score ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
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
        <Select className={`${inputCls} !w-auto`} value={d} onChange={(e) => { setDomain(e.target.value); setPicked([]); }}>{targets.map(t => <option key={t.id}>{t.domain}</option>)}</Select>
        {o && <span className="text-12 text-gray-500">Report scope: all links to <b className="text-gray-700">{o.domain}</b> · updated {fmtDateTime(o.generated_at)}</span>}
        <Button className="ml-auto" icon={RefreshCw} onClick={() => res.reload()}>Refresh</Button>
      </div>
      <ErrorNote>{res.error?.message || error}</ErrorNote>
      {!o ? <div className="space-y-4"><SkStats labels={["Backlinks", "Referring domains", "Lost links", "Verified"]} /><SkCard title="Backlink report" subtitle="Links found by the crawler and by Google results"><SkChart /></SkCard></div> : o.backlinks.total === 0 && o.backlinks.lost === 0 ? (
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
          <Select className={`${inputCls} !w-auto mb-3`} value={c} onChange={(e) => setClient(e.target.value)}>{own.map(t => <option key={t.id}>{t.domain}</option>)}</Select>
          {!g.data ? <SkTable cols={['w-1/3','w-1/3','w-12','w-12']} rows={6} /> : g.data.gap.length === 0 ? <Empty>No gap found in the data collected so far.</Empty> : (
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
  const [ask, confirmNode] = useDoubleConfirm();
  const remove = (t) => ask({ what: `the tracked domain ${t.domain}`, effect: 'It stops being monitored. Backlinks already found for it stay in your records.', onConfirm: () => run('rm', async () => { await api(`${base}/targets/${t.id}`, { method: 'DELETE' }); reload(true); }) });
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
      {confirmNode}
      {targets.length === 0 ? <Empty>Nothing tracked yet.</Empty> : targets.map(t => (
        <div key={t.id} className="flex items-center gap-3 py-2 border-b border-gray-100 text-13">
          <span className="flex-1 text-gray-900">{t.domain}</span>
          <Badge tone={t.is_competitor ? 'amber' : 'green'}>{t.is_competitor ? 'Competitor' : 'Your site'}</Badge>
          <button className="text-gray-400 hover:text-red-500 cursor-pointer" aria-label={`Remove ${t.domain}`} onClick={() => remove(t)}><Trash2 size={14} /></button>
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
  const fmtQueues = (f) => Object.entries(f || {}).map(([q, s]) => `${q}: ${Object.entries(s).map(([k, v]) => `${v} ${k}`).join(', ')}`).join(' · ');
  const counts = fmtQueues(status.data?.frontier);
  const mineCounts = fmtQueues(status.data?.mine);
  return (
    <div className="grid grid-cols-1 gap-4">
      <Card title="Seeds and verification" subtitle="Give the bot places to look (pages that should link to you), or re-check links it already found. It respects robots.txt and rate limits.">
        <Field label="Pages to check (one per line)"><textarea className="ai-glass-input w-full px-3 py-2 text-13 rounded" rows={3} placeholder="https://some-blog.com/post-that-links-to-you" value={urls} onChange={(e) => setUrls(e.target.value)} /></Field>
        <div className="flex flex-wrap gap-2 mt-2">
          <Button icon={Plus} busy={busy === 'seed'} disabled={!urls.trim()} onClick={seed}>Queue pages</Button>
          <Button variant="primary" icon={Play} busy={busy === 'crawl'} disabled={!targets.length} onClick={crawl}>Run crawler now</Button>
          <Button icon={Crosshair} busy={busy === 'verify'} onClick={verify}>Re-check all known links</Button>
        </div>
        <div className="text-12 text-gray-500 mt-3">This project: {mineCounts || 'nothing queued.'}</div>
        <div className="text-12 text-gray-400 mt-1">Shared queue, all projects: {counts || 'empty.'}</div>
        {result && (
          <div className="mt-2 text-12">{result.results.map((x, i) => (
            <div key={i} className="py-1 border-b border-gray-100 break-all">{x.url} → {x.error_code ? <Badge tone="amber">{x.error_code}</Badge> : `HTTP ${x.http_status}`} · {x.links_seen} links · {x.new_backlinks} new backlink(s) to tracked projects</div>))}
          </div>
        )}
      </Card>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}

const fmtMinutes = (m) => (m < 60 ? `${m} min` : `${+(m / 60).toFixed(1)} h`);

// When this project crawls next. With rotation on (the default), projects take turns in batches and the "Every" setting is not used.
function botSchedule(s) {
  const r = s?.rotation;
  if (!r?.enabled) return `It runs again every ${fmtMinutes(s?.config?.interval_minutes || 30)}.`;
  if (r.in_current_batch && r.window_ends_at) return `It is crawling in the current batch until ${fmtDateTime(r.window_ends_at)}.`;
  if (!r.window_ends_at) return 'It starts with the next crawl batch, within a minute.';
  if (r.batches_before_turn == null) return 'It joins the rotation once the bot is on and a domain is tracked.';
  const next = new Date(new Date(r.window_ends_at).getTime() + r.batches_before_turn * r.batch_minutes * 60000);
  return `Its next turn starts by about ${fmtDateTime(next.toISOString())} (projects take turns, ${r.batch_size} at a time for ${fmtMinutes(r.batch_minutes)}; ${r.batches_before_turn} batch(es) ahead).`;
}

function BotPanel({ base, targets, onToast }) {
  const st = useApi(`${base}/bot`);
  const [busy, error, run] = useAction();
  const s = st.data;
  const running = Boolean(s?.running);
  usePoll(() => st.reload(true), running, 2500);
  const save = (patch) => run('save', async () => { await api(`${base}/bot`, { method: 'PUT', body: patch }); st.reload(true); });
  const start = () => run('start', async () => { await api(`${base}/bot/run`, { method: 'POST' }); onToast('Bot started'); setTimeout(() => st.reload(true), 800); });
  if (!s) return <SkCard title="Discovery bot" subtitle="Our own crawler. It starts from your tracked sites and competitors, explores the pages around them, and records every link it finds to them."><SkList rows={4} avatar={false} /></SkCard>;
  const c = s.config;
  const queued = Object.values(s.frontier || {}).reduce((n, q) => n + (q.pending || 0), 0);
  const mine = s.mine || {};
  const last = s.last_stats;
  const rotating = Boolean(s.rotation?.enabled);
  return (
    <>
      <Card className="mb-4" title="Discovery bot" subtitle="Our own crawler. It starts from your tracked sites and competitors, explores the pages around them, and records every link it finds to them. No third-party index is used."
        action={<Badge tone={running ? 'blue' : c.enabled ? 'green' : 'gray'}>{running ? 'Running' : c.enabled ? 'Scheduled' : 'Off'}</Badge>}>
        {!targets.length ? <Empty>Add your site and your competitors under “Targets” first. The bot starts from the domains you track.</Empty> : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              {[['Backlinks found by the bot', mine.backlinks ?? s.totals.backlinks_found_by_bot], ['Linking domains', mine.linking_domains ?? 0], ['Pages crawled on your sites', mine.pages_crawled ?? 0], ['Pages queued for this project', mine.queue_pending ?? 0]].map(([k, v]) => (
                <div key={k}><div className="text-12 text-gray-500">{k}</div><div className="text-[24px] font-semibold text-indigo-600 tabular-nums">{v}</div></div>))}
            </div>
            <div className="text-12 text-gray-500 mb-4">Shared crawler, all projects: {s.totals.pages_fetched} pages fetched · {s.totals.pages_known} pages known · {s.totals.domains_known} domains discovered · {queued} pages waiting. Every page it reads is checked for links to all tracked projects.</div>
            <div className="flex flex-wrap items-end gap-3 mb-3">
              <label className="flex items-center gap-2 text-13 pb-2"><input type="checkbox" checked={c.enabled} onChange={(e) => save({ enabled: e.target.checked })} /> Run automatically</label>
              {!rotating && <Field label="Every"><Select className={`${inputCls} !w-auto`} value={c.interval_minutes} onChange={(e) => save({ interval_minutes: Number(e.target.value) })}>{[15, 30, 60, 180, 360, 1440].map(m => <option key={m} value={m}>{fmtMinutes(m)}</option>)}</Select></Field>}
              <Field label="Pages per run"><Select className={`${inputCls} !w-auto`} value={c.pages_per_run} onChange={(e) => save({ pages_per_run: Number(e.target.value) })}>{[...new Set([25, 50, 100, 250, 500, c.pages_per_run])].sort((x, y) => x - y).map(n => <option key={n}>{n}</option>)}</Select></Field>
              <Field label="How far to explore" hint="Links followed away from your tracked sites"><Select className={`${inputCls} !w-auto`} value={c.max_hops} onChange={(e) => save({ max_hops: Number(e.target.value) })}>
                <option value={0}>Only your own sites</option><option value={1}>1 step out (recommended)</option><option value={2}>2 steps out</option><option value={3}>3 steps out (slow, wide)</option></Select></Field>
              <label className="flex items-center gap-2 text-13 pb-2" title={s.render_available ? 'Loads pages built with JavaScript in a real browser. Slower: at most 10 pages per run.' : 'Chrome was not found on the server, so this is unavailable.'}>
                <input type="checkbox" disabled={!s.render_available} checked={c.render_js} onChange={(e) => save({ render_js: e.target.checked })} /> Read JavaScript pages
              </label>
              <Button variant="primary" icon={running ? Loader2 : Play} busy={busy === 'start' || running} disabled={running} onClick={start}>{running ? 'Running…' : 'Run now'}</Button>
            </div>
            <ErrorNote>{error}</ErrorNote>
            <div className="text-12 text-gray-500">
              {c.enabled ? botSchedule(s) : 'Automatic runs are off.'}
              {s.last_run_at && <> · last run {fmtDateTime(s.last_run_at)}{last && !last.skipped ? `: ${last.pages} pages read, ${last.new_backlinks} new backlink(s) to your sites, ${last.queued} queued, ${last.errors} error(s), ${last.blocked} blocked by robots.txt${last.rendered ? `, ${last.rendered} read in a browser` : ''}${last.handoff ? `; scored ${last.handoff.scored} linking domain(s), ${last.handoff.tasks} removal request(s) waiting for approval in Autonomous AI Agents` : ''}` : ''}</>}
            </div>
            <p className="text-11 text-gray-400 mt-3">The bot follows public links only, obeys robots.txt, waits between requests to the same site, and stays inside the page budget above. It finds links on pages it can reach from your sites, so coverage grows with each run but is smaller than a commercial index. Raise “how far to explore” to widen it.</p>
          </>
        )}
      </Card>
      <Card title="What it just fetched" subtitle="Most recent requests by the shared crawler, for all projects">
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

const hostOf = (site) => {
  const raw = (site || '').trim();
  if (!raw) return '';
  try { return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.replace(/^www\./, ''); } catch { return ''; }
};

// GET /backlinks?query=: the backlinks our seed crawler (Seed Backlink Finder) stored in PostgreSQL. Reads the database only; the crawler keeps adding rows.
function SeedBacklinks({ biz }) {
  const own = hostOf(biz.website);
  const [query, setQuery] = useState(own);
  const [shown, setShown] = useState(100);
  const r = useApi(query ? `/backlinks?${new URLSearchParams({ query })}` : null);
  usePoll(() => r.reload(true), Boolean(query), 15000); // new backlinks appear while the crawler runs
  const rows = r.data?.backlinks || [];
  const sites = new Set(rows.map(x => x.source_site)).size;
  const follow = rows.filter(x => x.link_type === 'dofollow').length;
  const search = (e) => { e.preventDefault(); setShown(100); r.reload(); };
  return (
    <>
      <Card className="mb-4" title="Backlinks found by the Seed Backlink Finder" subtitle={`Saved in the database by the crawler that reads the seed sites. ${own ? `Showing links to ${own}.` : 'This project has no website: enter a domain below.'}`}>
        <form className="flex flex-wrap gap-2" onSubmit={search}>
          <div className="relative"><Search size={13} className="absolute left-2.5 top-3 text-gray-400" /><input className={`${inputCls} !w-80 !pl-8`} placeholder="codigix.co or https://site.com/page" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
          <Button type="submit" variant="primary" icon={Search} busy={r.loading}>Search</Button>
          {own && query !== own && <Button onClick={() => setQuery(own)}>This project</Button>}
        </form>
        <ErrorNote>{r.error?.message}</ErrorNote>
      </Card>
      {r.loading && !r.data ? <SkCard title="Backlinks"><SkTable headers={['Source page', 'Anchor', 'Type', 'Found in', 'Last seen']} rows={5} bare /></SkCard> : r.data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Stat label="Backlinks" value={r.data.total} />
            <Stat label="Referring sites" value={sites} />
            <Stat label="Dofollow" value={follow} />
            <Stat label="Nofollow" value={rows.length - follow} />
          </div>
          <Card title="Backlinks" subtitle={`Newest first · ${r.data.match_mode === 'exact' ? 'links to this exact page' : 'links to the domain and its subdomains'}`}>
            {rows.length === 0 ? <Empty>No backlinks stored yet for “{r.data.query}”. The crawler adds them as it reads the seed sites.</Empty> : (
              <div className="overflow-x-auto">
                <table className="w-full text-13">
                  <thead className="text-12 text-gray-500 border-b border-gray-200"><tr><Th>Source page</Th><Th>Target</Th><Th>Anchor</Th><Th>Type</Th><Th>Found in</Th><Th>Last seen</Th></tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.slice(0, shown).map(x => (
                      <tr key={`${x.source_url}|${x.target_url}`}>
                        <td className="p-2 max-w-[280px] truncate" title={x.source_title ? `${x.source_title}\n${x.source_url}` : x.source_url}><a className="text-indigo-600 hover:underline" href={x.source_url} target="_blank" rel="noreferrer noopener nofollow">{x.source_url.replace(/^https?:\/\//, '')}</a></td>
                        <td className="p-2 max-w-[200px] truncate text-gray-600" title={x.target_url}>{x.target_url.replace(/^https?:\/\//, '')}</td>
                        <td className="p-2 max-w-[180px] truncate text-gray-700" title={x.context || x.anchor_text || ''}>{x.anchor_text || '—'}</td>
                        <td className="p-2"><Badge tone={x.link_type === 'dofollow' ? 'green' : 'amber'} title={x.rel.length ? x.rel.join(', ') : ''}>{x.link_type}</Badge></td>
                        <td className="p-2 text-12 text-gray-600">{x.found_in}</td>
                        <td className="p-2 text-12 text-gray-500">{fmtDateTime(x.last_seen_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {rows.length > shown && <div className="flex justify-center mt-3"><Button onClick={() => setShown(n => n + 100)}>Show more ({rows.length - shown} left)</Button></div>}
          </Card>
        </>
      )}
    </>
  );
}

const drTone = (dr) => (dr >= 50 ? 'green' : dr >= 20 ? 'blue' : dr >= 5 ? 'gray' : 'amber');
const IN_PROGRESS = ['queued', 'running'];

// GET /backlinks/ahrefs?domain=: the Ahrefs report saved in PostgreSQL. Made at onboarding and refreshed daily by the backend; this only reads
// the database. While a refresh runs, the previous report stays on screen. "Refresh now" queues a new lookup (POST /backlinks/ahrefs).
// competitors: the same report for a competitor's domain the user types (Competitor gap tab). It starts empty and offers the tracked competitors.
function AhrefsReport({ biz, competitors = null }) {
  const forCompetitor = competitors !== null;
  const own = forCompetitor ? '' : hostOf(biz.website);
  const [domain, setDomain] = useState(own);
  const [input, setInput] = useState(own);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [shown, setShown] = useState(50);
  const r = useApi(domain ? `/backlinks/ahrefs?${new URLSearchParams({ domain })}` : null);
  const d = r.data;
  const missing = r.error?.status === 404;
  const working = Boolean(d && (IN_PROGRESS.includes(d.status) || IN_PROGRESS.includes(d.refresh?.status)));
  usePoll(() => r.reload(true), working || busy, 5000); // a lookup takes about a minute: show the result as soon as it is saved
  const hasData = d?.status === 'done';
  const pages = d?.referring_pages || [];

  const lookUp = async (refresh) => {
    setBusy(true); setNote('');
    try {
      const res = await api('/backlinks/ahrefs', { method: 'POST', body: { domain, refresh } });
      if (res.state === 'cached') setNote('A report from the last day is already saved, so it was not looked up again.');
      await r.reload(true);
    } catch (e) {
      setNote(e.message);
    } finally {
      setBusy(false);
    }
  };
  const search = (e) => { e.preventDefault(); setShown(50); setNote(''); setDomain(hostOf(input) || input.trim()); };

  return (
    <>
      <Card className="mb-4" title={forCompetitor ? 'Competitor backlinks (Ahrefs)' : 'Ahrefs backlink report'}
        subtitle={forCompetitor
          ? `Enter a competitor's domain to see its Domain Rating, backlinks and top referring pages from Ahrefs, saved in our database. ${domain ? `Showing ${domain}.` : ''}`
          : `Domain Rating, backlinks and top referring pages from Ahrefs, saved in our database and refreshed every day. ${own ? `Showing ${domain || own}.` : 'This project has no website: enter a domain below.'}`}
        action={domain && (hasData || d?.status === 'failed') && <Button icon={RefreshCw} busy={busy || working} disabled={working} onClick={() => lookUp(true)}>{working ? 'Updating…' : 'Refresh now'}</Button>}>
        <form className="flex flex-wrap gap-2" onSubmit={search}>
          <div className="relative"><Search size={13} className="absolute left-2.5 top-3 text-gray-400" /><input className={`${inputCls} !w-80 !pl-8`} placeholder={forCompetitor ? 'competitor.com' : 'codigix.co'} value={input} onChange={(e) => setInput(e.target.value)} /></div>
          <Button type="submit" variant="primary" icon={Search} busy={r.loading}>Show</Button>
          {own && domain !== own && <Button onClick={() => { setInput(own); setDomain(own); }}>This project</Button>}
        </form>
        {forCompetitor && competitors.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-12 text-gray-500">
            <span>Your tracked competitors:</span>
            {competitors.map(c => <Button key={c} size="sm" onClick={() => { setInput(c); setShown(50); setNote(''); setDomain(c); }}>{c}</Button>)}
          </div>
        )}
        {hasData && d.refresh && IN_PROGRESS.includes(d.refresh.status) && (
          <div className="mt-3 text-12.5 text-indigo-700 flex items-center gap-2"><Loader2 size={13} className="animate-spin" />Updating from Ahrefs. Showing the report from {fmtDateTime(d.finished_at)} until the new one is saved.</div>
        )}
        {hasData && d.refresh?.status === 'failed' && (
          <div className="mt-3 text-12.5 text-amber-700">The latest update did not work ({d.refresh.error}). Showing the report from {fmtDateTime(d.finished_at)}; it is tried again automatically.</div>
        )}
        {note && <div className="mt-3 text-12.5 text-gray-600">{note}</div>}
        <ErrorNote>{!missing && r.error?.message}</ErrorNote>
      </Card>

      {r.loading && !d && !missing ? <><SkStats labels={['Domain Rating', 'Backlinks', 'Linking websites', 'Updated']} /><SkCard title="Top referring pages"><SkTable headers={['DR', 'Referring page', 'Anchor', 'Target']} rows={5} bare /></SkCard></>
        : missing ? (
          <Card><Empty>
            No Ahrefs report saved for {domain} yet.{own === domain ? ' It is made automatically after onboarding and then every day.' : ''}
            <div className="mt-3"><Button variant="primary" icon={Play} busy={busy} onClick={() => lookUp(false)}>Look it up now</Button></div>
          </Empty></Card>
        ) : d && !hasData ? (
          <Card><Empty>
            {IN_PROGRESS.includes(d.status)
              ? <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" />Looking up {d.domain} on Ahrefs ({d.status}). This takes about a minute.</span>
              : <>The Ahrefs lookup for {d.domain} did not work: {d.error}<div className="mt-3"><Button icon={RefreshCw} busy={busy} onClick={() => lookUp(true)}>Try again</Button></div></>}
          </Empty></Card>
        ) : hasData && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <Stat label="Domain Rating" value={d.domain_rating ?? '—'} hint="Ahrefs' 0-100 score of the site's link strength" />
              <Stat label="Backlinks" value={d.backlinks?.value ?? '—'} hint={d.backlinks?.dofollow ? `${d.backlinks.dofollow} dofollow` : undefined} />
              <Stat label="Linking websites" value={d.linking_websites?.value ?? '—'} hint={d.linking_websites?.dofollow ? `${d.linking_websites.dofollow} dofollow` : undefined} />
              <Stat label="Updated" value={fmtDateTime(d.finished_at)} />
            </div>
            <Card title="Top referring pages" subtitle={`The ${pages.length} pages Ahrefs lists first; the totals above count every backlink. Data from Ahrefs, saved ${fmtDateTime(d.finished_at)}.`}>
              {pages.length === 0 ? <Empty>Ahrefs listed no referring pages for {d.domain}.</Empty> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-13">
                    <thead className="text-12 text-gray-500 border-b border-gray-200"><tr><Th>DR</Th><Th>Referring page</Th><Th>Anchor</Th><Th>Target</Th></tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {pages.slice(0, shown).map((p, i) => (
                        <tr key={`${i}|${p.referring_page_url}`}>
                          <td className="p-2">{p.dr !== '' ? <Badge tone={drTone(Number(p.dr))}>{p.dr}</Badge> : '—'}</td>
                          <td className="p-2 max-w-[340px]">
                            <div className="truncate text-gray-800" title={p.referring_page_title}>{p.referring_page_title || '—'}</div>
                            {p.referring_page_url && <a className="block truncate text-12 text-indigo-600 hover:underline" title={p.referring_page_url} href={p.referring_page_url} target="_blank" rel="noreferrer noopener nofollow">{p.referring_page_url.replace(/^https?:\/\//, '')}</a>}
                          </td>
                          <td className="p-2 max-w-[260px] truncate text-gray-700" title={p.anchor_text}>{p.anchor_text || '—'}</td>
                          <td className="p-2 max-w-[240px] text-12 text-gray-600">
                            <div className="truncate" title={p.target_url || ''}>{(p.target_url || '—').replace(/^https?:\/\//, '')}</div>
                            {p.redirects.length > 0 && <span title={p.redirects.join('\n')}><Badge tone="amber">{p.redirects.length} redirect{p.redirects.length > 1 ? 's' : ''}</Badge></span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {pages.length > shown && <div className="flex justify-center mt-3"><Button onClick={() => setShown(n => n + 50)}>Show more ({pages.length - shown} left)</Button></div>}
            </Card>
          </>
        )}
    </>
  );
}

// GET /serp-search/top-results: top organic Google results for a query (via Serper.dev), with an optional time range and country.
function SerpSearch() {
  const [query, setQuery] = useState('');
  const [timeRange, setTimeRange] = useState('any');
  const [country, setCountry] = useState('');
  const [top, setTop] = useState(10);
  const [res, setRes] = useState(null);
  const [busy, error, run] = useAction();
  const search = (e) => {
    e?.preventDefault();
    if (!query.trim()) return;
    run('search', async () => setRes(await api(`/serp-search/top-results?${new URLSearchParams({ query: query.trim(), time_range: timeRange, top: String(top), ...(country.trim() ? { country: country.trim() } : {}) })}`)));
  };
  return (
    <>
      <Card className="mb-4" title="Top search results" subtitle="Top organic Google results for a query, live from Serper.dev. Leave country empty to search globally.">
        <form className="flex flex-wrap items-end gap-2" onSubmit={search}>
          <Field label="Query"><div className="relative"><Search size={13} className="absolute left-2.5 top-3 text-gray-400" /><input className={`${inputCls} !w-80 !pl-8`} placeholder="social media bookmarking sites" value={query} onChange={(e) => setQuery(e.target.value)} /></div></Field>
          <Field label="Time range"><Select className={`${inputCls} !w-auto`} value={timeRange} onChange={(e) => setTimeRange(e.target.value)}>
            <option value="any">Any time</option><option value="day">Past day</option><option value="week">Past week</option><option value="month">Past month</option><option value="year">Past year</option>
          </Select></Field>
          <Field label="Country"><input className={`${inputCls} !w-28`} placeholder="global" value={country} onChange={(e) => setCountry(e.target.value)} /></Field>
          <Field label="Results"><Select className={`${inputCls} !w-auto`} value={top} onChange={(e) => setTop(Number(e.target.value))}>{[5, 10, 20, 30, 50].map(n => <option key={n} value={n}>{n}</option>)}</Select></Field>
          <Button type="submit" variant="primary" icon={Search} busy={busy === 'search'} disabled={query.trim().length < 2}>Search</Button>
        </form>
        <ErrorNote>{error}</ErrorNote>
      </Card>
      {res && (
        <Card title="Results" subtitle={`${res.returned} organic result(s) for “${res.query}” · ${res.country} · ${res.time_range}`}>
          {res.results.length === 0 ? <Empty>No results found.</Empty> : (
            <div className="divide-y divide-gray-100">
              {res.results.map((r, i) => (
                <div key={i} className="py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-12 text-gray-400 tabular-nums w-5">{r.position}.</span>
                    <a className="text-13 text-indigo-600 hover:underline font-medium truncate" href={r.link} target="_blank" rel="noreferrer noopener">{r.title}</a>
                    {r.date && <Badge tone="gray">{r.date}</Badge>}
                  </div>
                  <div className="text-12 text-gray-500 break-all ml-7">{r.link}</div>
                  {r.snippet && <div className="text-12.5 text-gray-700 mt-1 ml-7">{r.snippet}</div>}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </>
  );
}

function Body({ b }) {
  const [tab, setTab] = useUrlTab('ahrefs', ['ahrefs', 'seed', 'serp', 'overview', 'explorer', 'gap', 'bot', 'collect', 'targets']);
  const base = `/businesses/${b.id}/backlink-intel`;
  const t = useApi(`${base}/targets`);
  const [toast, toastNode] = useToast();
  const reload = useCallback((q) => t.reload(q), [t.reload]);
  const targets = t.data || [];
  // The bot runs in the background (started at onboarding, then on its schedule): keep an eye on it, and reload the data when a run ends.
  const botState = useApi(`${base}/bot`);
  const running = Boolean(botState.data?.running);
  usePoll(() => botState.reload(true), true, running ? 3000 : 20000);
  const lastRun = botState.data?.last_run_at || 'never';
  const stats = botState.data?.last_stats;
  return (
    <>
      {botState.data?.config?.enabled && targets.length > 0 && (
        <div className={`mb-4 rounded px-4 py-2.5 text-12.5 flex flex-wrap items-center gap-x-3 gap-y-1 ring-1 ring-inset ${running ? 'bg-indigo-50 ring-indigo-200 text-indigo-800' : 'bg-slate-50 ring-slate-200 text-slate-600'}`}>
          {running ? <Loader2 size={13} className="animate-spin" /> : <Bot size={13} />}
          <span className="font-semibold">{running ? 'Discovery bot is running' : 'Discovery bot is on'}</span>
          <span>{running ? 'New backlinks appear here as they are found.' : botState.data.last_run_at ? `Last run ${fmtDateTime(botState.data.last_run_at)}${stats && !stats.skipped ? `: ${stats.pages} pages read, ${stats.new_backlinks} new backlink(s) to your sites` : ''}. ${botSchedule(botState.data)}` : 'It starts shortly after onboarding.'}</span>
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'ahrefs', label: 'Ahrefs report' }, { id: 'seed', label: 'Seed backlinks' }, { id: 'serp', label: 'Top Search Results' }, { id: 'overview', label: 'Overview' }, { id: 'explorer', label: 'Backlink explorer' }, { id: 'gap', label: 'Competitor gap' },
        { id: 'bot', label: 'Discovery bot' }, { id: 'collect', label: 'Seeds & verify' }, { id: 'targets', label: 'Targets', count: targets.length }]} />
      <ErrorNote>{t.error?.message}</ErrorNote>
      {t.loading && !t.data ? <div className="space-y-4"><SkStats labels={["Backlinks", "Referring domains", "Lost links", "Verified"]} /><SkCard title="Backlinks"><SkTable headers={["Source page", "Target", "Anchor", "Status", "Last seen"]} rows={5} bare /></SkCard></div> : (
        <div key={`${lastRun}-${running}`}>
          {tab === 'ahrefs' && <AhrefsReport biz={b} />}
          {tab === 'seed' && <SeedBacklinks biz={b} />}
          {tab === 'serp' && <SerpSearch />}
          {tab === 'overview' && <Overview base={base} targets={targets} biz={b} go={setTab} reload={reload} />}
          {tab === 'explorer' && <><Lookup /><Explorer base={base} targets={targets} /></>}
          {tab === 'gap' && <><div className="mb-4"><AhrefsReport biz={b} competitors={targets.filter(t => t.is_competitor).map(t => t.domain)} /></div><Gap base={base} targets={targets} /></>}
          {tab === 'bot' && <BotPanel base={base} targets={targets} onToast={toast} />}
          {tab === 'collect' && <Collect base={base} targets={targets} onToast={toast} />}
          {tab === 'targets' && <Targets base={base} targets={targets} reload={reload} onToast={toast} />}
        </div>
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
