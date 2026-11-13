import React, { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ExternalLink, Search, RefreshCw, Download, ShieldAlert, CheckCircle2, Info, Sparkles, Link2 } from 'lucide-react';
import { SeoShell, Card, Button, Badge, Stat, ErrorNote, useAction, useToast, SkList } from './SeoUi';
import Select from '../components/Select';
import { api, useApi } from './seoApi';
import Tip from './Tip';

const VIEWS = {
  links: ['Backlinks', 'Every link to your website that the crawler found: follow or nofollow, anchor text, kind of site, authority and whether it is worth having.'],
  domains: ['Referring domains', 'The websites that link to you, with how many links each gives, what kind of site it is and whether it helps or hurts.'],
  opportunities: ['Link opportunities', 'Websites that link to your competitors but not to you: the places worth asking for a link, best first.'],
  audit: ['Backlink audit', 'What is wrong or weak in your backlink profile, and what to do about it.']
};
const USEFUL = { useful: ['Useful', 'green'], neutral: ['Neutral', 'gray'], risky: ['Risky', 'red'], unscored: ['Not judged', 'amber'] };
const FOLLOW = { dofollow: ['Follow', 'green'], nofollow: ['Nofollow', 'gray'], sponsored: ['Sponsored', 'amber'], ugc: ['UGC', 'gray'] };
const ANCHOR = { branded: 'Brand', naked: 'Web address', money: 'Keyword', generic: 'Generic', compound: 'Brand + words', organic: 'Natural', empty: 'No text', other: 'Other' };
const PRIORITY = { high: ['High', 'red'], medium: ['Medium', 'amber'], low: ['Low', 'gray'] };
const TH = 'px-3 py-2.5 font-semibold whitespace-nowrap text-left';
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const path = (u) => { try { const x = new URL(u); return (x.pathname + x.search) || '/'; } catch { return u; } };
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const Num = ({ v, tip, bad }) => (v == null
  ? <Tip text={tip || 'Not measured: needs a Moz key in the backend settings.'}><span className="text-slate-300">—</span></Tip>
  : <span className={`tabular-nums font-semibold ${bad ? 'text-red-600' : 'text-slate-800'}`}>{v}{bad ? '%' : ''}</span>);

const Verdict = ({ u, why }) => { const [l, t] = USEFUL[u] || USEFUL.unscored; return <Tip text={why} wide><Badge tone={t}>{l}</Badge></Tip>; };
const FollowBadge = ({ f }) => { const [l, t] = FOLLOW[f] || FOLLOW.dofollow; return <Tip text={f === 'dofollow' ? 'A normal link: it can pass ranking value.' : `rel="${f}": it brings visitors but passes little or no ranking value.`}><Badge tone={t}>{l}</Badge></Tip>; };

function Setup({ s }) {
  if (s.state === 'no_target') return <Card><p className="text-13 text-slate-600">This project has no website yet. Add it in the project settings: the crawler looks for links to that address.</p></Card>;
  const c = s.crawler;
  const note = !c.configured
    ? 'Your backlink crawler is not connected. Add CRAWLER_URL and CRAWLER_API_KEY to the backend settings; the links it finds then appear here.'
    : c.last_error ? `The last sync failed: ${c.last_error}` : !c.last_sync_at ? 'The crawler is connected but has not synced this project yet. Press “Find backlinks now”.' : null;
  if (!note && s.moz.configured) return null;
  return (
    <Card>
      <div className="grid gap-1.5 text-13">
        {note && <p className="flex gap-2 text-amber-800"><Info size={15} className="shrink-0 mt-0.5" />{note}</p>}
        {!s.moz.configured && <p className="flex gap-2 text-slate-600"><Info size={15} className="shrink-0 mt-0.5" />Domain Authority, Page Authority and Spam Score come from Moz. Add MOZ_ACCESS_ID and MOZ_SECRET_KEY to the backend settings to show them; until then they read “—” and nothing is estimated.</p>}
      </div>
    </Card>
  );
}

function Summary({ s, b, reload }) {
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  if (s.state !== 'ok') return null;
  const t = s.totals;
  const sync = () => run('sync', async () => { await api(`/businesses/${b.id}/backlink-intel/bot/run`, { method: 'POST' }); toast('Looking for backlinks. This page updates when it is done.'); setTimeout(() => reload(true), 4000); });
  const score = () => run('score', async () => { const r = await api(`/businesses/${b.id}/backlink-intel/scores/run`, { method: 'POST', body: { domain: s.domain, limit: 15 } }); toast(`Judged ${r.scored.length} site${r.scored.length !== 1 ? 's' : ''}${r.remaining ? `, ${r.remaining} to go: press again` : ''}`); reload(true); });
  const moz = () => run('moz', async () => { const r = await api(`/businesses/${b.id}/backlink-hub/metrics/refresh`, { method: 'POST' }); toast(r.message); reload(true); });
  return (
    <Card title={`Backlinks to ${s.domain}`} subtitle={s.crawler.last_sync_at ? `Last crawler sync ${day(s.crawler.last_sync_at)}${s.crawler.running ? ' (running now)' : ''}` : 'Read from your backlink crawler'}
      action={<div className="flex flex-wrap gap-2">
        <Button size="sm" icon={Sparkles} busy={busy === 'score'} onClick={score}>Score the links</Button>
        <Button size="sm" icon={RefreshCw} busy={busy === 'moz'} disabled={!s.moz.configured} onClick={moz}>Get DA / PA / spam</Button>
        <Button size="sm" variant="primary" icon={Link2} busy={busy === 'sync'} onClick={sync}>Find backlinks now</Button>
      </div>}>
      <ErrorNote>{error}</ErrorNote>
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <Stat label="Live links" value={t.live} /><Stat label="Domains" value={t.referring_domains} /><Stat label="Follow" value={t.dofollow_share == null ? '—' : `${t.dofollow_share}%`} hint={`${t.dofollow} follow, ${t.nofollow} other`} />
        <Stat label="New (30 days)" value={t.new_30d} /><Stat label="Lost (30 days)" value={t.lost_30d} /><Stat label="Useful links" value={s.useful.useful || 0} hint={`${s.useful.risky || 0} risky, ${s.useful.unscored || 0} not judged`} /><Stat label="Average DA" value={t.avg_da ?? '—'} />
      </div>
      {toastNode}
    </Card>
  );
}

function Used({ s }) {
  if (s.state !== 'ok') return null;
  return (
    <Card title="Where this data is used" subtitle="Your backlink results are not kept on this page alone.">
      <ul className="grid gap-2 md:grid-cols-2">{s.used_in.map(u => <li key={u.where} className="text-13 text-slate-600"><Link to={u.to} className="font-semibold text-indigo-600 hover:underline">{u.where}</Link>: {u.what}</li>)}</ul>
    </Card>
  );
}

function Filters({ q, setQ, children }) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-slate-100">
      {children}
      <label className="relative ml-auto"><Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search" aria-label="Search" className="h-8 w-52 pl-8 pr-3 text-13 rounded-lg ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none" /></label>
    </div>
  );
}
const sel = 'h-8 text-13 min-w-[140px]';
const Empty = ({ children }) => <tr><td colSpan={12} className="px-5 py-10 text-center text-slate-500">{children}</td></tr>;

function useList(b, view, params) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString();
  return useApi(`/businesses/${b.id}/backlink-hub/${view}${qs ? `?${qs}` : ''}`);
}
function useDebounced(v, ms = 300) { const [x, setX] = useState(v); useEffect(() => { const t = setTimeout(() => setX(v), ms); return () => clearTimeout(t); }, [v, ms]); return x; }

function Links({ b }) {
  const [f, setF] = useState({ status: 'live', follow: '', category: '', useful: '', sort: 'recent' });
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const r = useList(b, 'links', { ...f, q: dq, limit: 100 });
  const d = r.data;
  if (r.error) return <Card><ErrorNote>{r.error.message}</ErrorNote></Card>;
  if (!d) return <SkList rows={6} />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Card pad={false}>
      <Filters q={q} setQ={setQ}>
        <Select value={f.status} onChange={set('status')} className={sel} aria-label="Status"><option value="live">Live links</option><option value="lost">Lost links</option><option value="all">All</option></Select>
        <Select value={f.follow} onChange={set('follow')} className={sel} aria-label="Follow type"><option value="">Any follow type</option><option value="dofollow">Follow</option><option value="nofollow">Nofollow</option><option value="sponsored">Sponsored</option><option value="ugc">UGC</option></Select>
        <Select value={f.useful} onChange={set('useful')} className={sel} aria-label="Useful"><option value="">Useful or not</option>{Object.entries(USEFUL).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select>
        <Select value={f.category} onChange={set('category')} className={sel} aria-label="Category"><option value="">Any category</option>{Object.keys(d.facets?.category || {}).map(k => <option key={k} value={k}>{k}</option>)}</Select>
        <Select value={f.sort} onChange={set('sort')} className={sel} aria-label="Sort"><option value="recent">Newest first</option><option value="da">Highest DA</option><option value="domain">By site</option></Select>
      </Filters>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1150px] text-13">
          <thead className="bg-slate-50 text-12 uppercase tracking-wide text-slate-500"><tr>
            <th className={TH}>Linking page</th><th className={TH}>Anchor text</th><th className={TH}>Goes to</th><th className={TH}>Follow</th><th className={TH}>Category</th>
            <th className={`${TH} text-right`}><Tip text="Moz Domain Authority of the linking site (0-100).">DA</Tip></th><th className={`${TH} text-right`}><Tip text="Moz Page Authority of the linking page (0-100).">PA</Tip></th><th className={`${TH} text-right`}><Tip text="Moz Spam Score: how much the site looks like sites Google penalised. Lower is better.">Spam</Tip></th>
            <th className={TH}><Tip text="Our judgement from relevance to your business, spam risk and the follow type. Hover a badge for the reason.">Useful?</Tip></th><th className={TH}>First seen</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {d.state === 'no_target' && <Empty>Add the project's website first.</Empty>}
            {d.links?.map(x => (
              <tr key={x.id} className="hover:bg-slate-50 align-middle">
                <td className="px-3 py-3 max-w-[260px]"><a href={x.source_url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline inline-flex items-center gap-1 max-w-full"><span className="truncate font-semibold">{x.source_domain}</span><ExternalLink size={11} className="shrink-0" /></a><span className="block truncate text-11.5 text-slate-400" title={x.source_url}>{path(x.source_url)}</span>{!x.is_live && <Badge tone="red">{x.status_label}</Badge>}</td>
                <td className="px-3 py-3 max-w-[200px]"><span className="block truncate" title={x.anchor || ''}>{x.anchor || <span className="text-slate-300">no text</span>}</span><span className="text-11.5 text-slate-400">{ANCHOR[x.anchor_type] || x.anchor_type}</span></td>
                <td className="px-3 py-3 max-w-[160px]"><span className="block truncate text-slate-600" title={x.target_url}>{path(x.target_url)}</span></td>
                <td className="px-3 py-3"><FollowBadge f={x.follow} /></td>
                <td className="px-3 py-3 capitalize text-slate-600">{x.category.label}</td>
                <td className="px-3 py-3 text-right"><Num v={x.metrics?.da} /></td><td className="px-3 py-3 text-right"><Num v={x.metrics?.pa} /></td><td className="px-3 py-3 text-right"><Num v={x.metrics?.spam} bad={(x.metrics?.spam ?? 0) >= 50} /></td>
                <td className="px-3 py-3"><Verdict u={x.useful} why={x.useful_why} /></td>
                <td className="px-3 py-3 text-slate-500 whitespace-nowrap">{day(x.first_seen)}</td>
              </tr>
            ))}
            {d.state === 'ok' && !d.links.length && <Empty>{d.live_total ? 'No link matches these filters.' : 'No backlinks yet. Connect the crawler and press “Find backlinks now”.'}</Empty>}
          </tbody>
        </table>
      </div>
      <p className="px-5 py-3 border-t border-slate-100 text-11.5 text-slate-400">{d.total} link{d.total !== 1 ? 's' : ''}. Follow type and anchor are read from the page by your crawler. “Useful?” is our own judgement, not a Google or Moz metric.</p>
    </Card>
  );
}

function Domains({ b }) {
  const [f, setF] = useState({ sort: 'links', verdict: '' });
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const r = useList(b, 'domains', { ...f, q: dq });
  const d = r.data;
  if (r.error) return <Card><ErrorNote>{r.error.message}</ErrorNote></Card>;
  if (!d) return <SkList rows={6} />;
  return (
    <Card pad={false}>
      <Filters q={q} setQ={setQ}>
        <Select value={f.verdict} onChange={e => setF({ ...f, verdict: e.target.value })} className={sel} aria-label="Useful"><option value="">Useful or not</option>{Object.entries(USEFUL).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select>
        <Select value={f.sort} onChange={e => setF({ ...f, sort: e.target.value })} className={sel} aria-label="Sort"><option value="links">Most links</option><option value="da">Highest DA</option><option value="risk">Highest risk</option><option value="recent">Newest</option><option value="domain">A to Z</option></Select>
      </Filters>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1050px] text-13">
          <thead className="bg-slate-50 text-12 uppercase tracking-wide text-slate-500"><tr>
            <th className={TH}>Domain</th><th className={`${TH} text-right`}>Live links</th><th className={TH}>Follow</th><th className={TH}>Category</th><th className={TH}>Top anchors</th>
            <th className={`${TH} text-right`}>DA</th><th className={`${TH} text-right`}>Spam</th><th className={`${TH} text-right`}>Relevance</th><th className={TH}>Useful?</th><th className={TH}>Last seen</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {d.domains?.map(x => (
              <tr key={x.domain} className="hover:bg-slate-50 align-middle">
                <td className="px-3 py-3 font-semibold text-slate-900"><a href={x.sample_url} target="_blank" rel="noreferrer" className="hover:underline inline-flex items-center gap-1">{x.domain}<ExternalLink size={11} /></a>{x.lost > 0 && <span className="block text-11.5 font-normal text-red-600">{x.lost} lost</span>}</td>
                <td className="px-3 py-3 text-right tabular-nums">{x.live}</td>
                <td className="px-3 py-3 text-12 text-slate-600">{x.dofollow} follow · {x.nofollow} other</td>
                <td className="px-3 py-3 text-slate-600">{x.category.label}</td>
                <td className="px-3 py-3 max-w-[220px]"><span className="block truncate text-slate-600" title={x.anchors.join(', ')}>{x.anchors.join(', ') || '—'}</span></td>
                <td className="px-3 py-3 text-right"><Num v={x.metrics?.da} /></td><td className="px-3 py-3 text-right"><Num v={x.metrics?.spam} bad={(x.metrics?.spam ?? 0) >= 50} /></td>
                <td className="px-3 py-3 text-right tabular-nums">{x.quality ? x.quality.relevance : <span className="text-slate-300">—</span>}</td>
                <td className="px-3 py-3"><Verdict u={x.useful} why={x.useful_why} /></td>
                <td className="px-3 py-3 text-slate-500 whitespace-nowrap">{day(x.last_seen)}</td>
              </tr>
            ))}
            {d.state === 'ok' && !d.domains.length && <Empty>No referring domains yet.</Empty>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Opportunities({ b }) {
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const r = useList(b, 'opportunities', { q: dq, category: cat });
  const d = r.data;
  if (r.error) return <Card><ErrorNote>{r.error.message}</ErrorNote></Card>;
  if (!d) return <SkList rows={6} />;
  return (
    <>
      <Card title="Where your competitors have links and you do not" subtitle={d.competitors?.length ? `Compared with ${d.competitors.join(', ')}. Spammy sites are left out.` : 'Add competitors first.'}>
        {d.state === 'no_target' && <p className="text-13 text-slate-500">Add the project's website first.</p>}
        {d.state === 'no_competitors' && <p className="text-13 text-slate-500">No competitors are saved for this project. Find them on the <Link to="/competitor-finder" className="text-indigo-600 hover:underline">Competitors page</Link>; their links are then read by your crawler.</p>}
        {d.note && <p className="text-13 text-slate-500">{d.note}</p>}
        {d.state === 'ok' && d.total > 0 && <div className="grid grid-cols-3 gap-3 max-w-xl"><Stat label="Sites to approach" value={d.total} /><Stat label="High priority" value={d.opportunities.filter(x => x.priority === 'high').length} /><Stat label="Follow links" value={d.opportunities.filter(x => x.follow === 'dofollow').length} /></div>}
      </Card>
      {d.state === 'ok' && d.total > 0 && (
        <Card pad={false}>
          <Filters q={q} setQ={setQ}>
            <Select value={cat} onChange={e => setCat(e.target.value)} className={sel} aria-label="Category"><option value="">Any category</option>{[...new Set(d.opportunities.map(x => x.category.key))].map(k => <option key={k} value={k}>{k}</option>)}</Select>
          </Filters>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-13">
              <thead className="bg-slate-50 text-12 uppercase tracking-wide text-slate-500"><tr>
                <th className={TH}>Priority</th><th className={TH}>Site</th><th className={TH}>Links to</th><th className={TH}>Category</th><th className={TH}>Follow</th><th className={`${TH} text-right`}>DA</th><th className={`${TH} text-right`}>Relevance</th><th className={TH}>Useful?</th><th className={TH}>How to get it</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {d.opportunities.map(x => { const [pl, pt] = PRIORITY[x.priority]; return (
                  <tr key={x.domain} className="hover:bg-slate-50 align-middle">
                    <td className="px-3 py-3"><Badge tone={pt}>{pl}</Badge></td>
                    <td className="px-3 py-3 max-w-[220px]"><a href={x.sample.url} target="_blank" rel="noreferrer" className="font-semibold text-indigo-600 hover:underline inline-flex items-center gap-1">{x.domain}<ExternalLink size={11} /></a>{x.sample.anchor && <span className="block truncate text-11.5 text-slate-400" title={x.sample.anchor}>anchor “{x.sample.anchor}”</span>}</td>
                    <td className="px-3 py-3 text-slate-600"><Tip text={x.competitors.join(', ')}><span>{x.competitor_count} competitor{x.competitor_count !== 1 ? 's' : ''} · {x.links} link{x.links !== 1 ? 's' : ''}</span></Tip></td>
                    <td className="px-3 py-3 text-slate-600">{x.category.label}</td>
                    <td className="px-3 py-3"><FollowBadge f={x.follow} /></td>
                    <td className="px-3 py-3 text-right"><Num v={x.metrics?.da} /></td>
                    <td className="px-3 py-3 text-right tabular-nums">{x.quality.relevance}</td>
                    <td className="px-3 py-3"><Verdict u={x.useful} why={x.useful_why} /></td>
                    <td className="px-3 py-3 max-w-[300px]"><Tip text={x.how} wide><span className="line-clamp-2 text-12.5 text-slate-600">{x.how}</span></Tip></td>
                  </tr>); })}
              </tbody>
            </table>
          </div>
          <p className="px-5 py-3 border-t border-slate-100 text-11.5 text-slate-400">Listed because a competitor has a link there and you do not. It is a place to ask, not a promise that they will say yes. The best ones also become tasks in your <Link to="/growth#issues" className="text-indigo-600 hover:underline">Growth Plan</Link>.</p>
        </Card>
      )}
    </>
  );
}

const SEV = { serious: ['Serious', 'red'], warning: ['Fix soon', 'amber'], info: ['Good to know', 'blue'] };
function Audit({ b }) {
  const r = useApi(`/businesses/${b.id}/backlink-hub/audit`);
  const d = r.data;
  if (r.error) return <Card><ErrorNote>{r.error.message}</ErrorNote></Card>;
  if (!d) return <SkList rows={4} />;
  if (d.state !== 'ok') return <Card><p className="text-13 text-slate-500">Add the project's website first.</p></Card>;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <Card><p className={`flex items-center gap-2 text-14 font-semibold ${d.healthy ? 'text-emerald-700' : 'text-amber-700'}`}>{d.healthy ? <CheckCircle2 size={17} /> : <ShieldAlert size={17} />}{!d.live && !d.lost ? 'No backlinks to audit yet.' : d.healthy ? 'No serious problems in your backlink profile.' : 'Some links need your attention.'}</p></Card>
      {d.items.map(i => { const [l, t] = SEV[i.severity]; return (
        <Card key={i.key} title={i.title} action={<Badge tone={t}>{l}</Badge>}>
          <p className="text-13 text-slate-600">{i.why}</p>
          <p className="text-13 text-slate-800 mt-1"><span className="font-semibold">What to do:</span> {i.fix}</p>
          {i.examples?.length > 0 && <ul className="mt-2 grid gap-1">{i.examples.map((e, k) => <li key={k} className="text-12.5 text-slate-500 truncate"><span className="text-slate-700">{host(e.url) === e.url ? e.url : e.url.replace(/^https?:\/\//, '')}</span> · {e.note}</li>)}</ul>}
          {i.action && <div className="mt-3"><a className="inline-flex" href={i.action.href}><Button size="sm" icon={Download}>{i.action.label}</Button></a></div>}
        </Card>); })}
    </div>
  );
}

export default function BacklinkHubPage() {
  const { view } = useParams();
  if (!VIEWS[view]) return <Navigate to="/backlinks/links" replace />;
  const [title, subtitle] = VIEWS[view];
  return (
    <SeoShell step="links" title={title} subtitle={subtitle}>
      {(b) => <Body b={b} view={view} />}
    </SeoShell>
  );
}

function Body({ b, view }) {
  const s = useApi(`/businesses/${b.id}/backlink-hub/summary`);
  const key = `${b.id}-${s.data?.totals?.live ?? 'x'}-${s.data?.useful?.useful ?? 'x'}-${s.data?.moz?.configured}-${s.data?.totals?.avg_da ?? 'x'}`;
  const V = { links: Links, domains: Domains, opportunities: Opportunities, audit: Audit }[view];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      {s.data ? <><Summary s={s.data} b={b} reload={s.reload} /><Setup s={s.data} /></> : s.error ? <Card><ErrorNote>{s.error.message}</ErrorNote></Card> : <SkList rows={3} />}
      {(!s.data || s.data.state === 'ok') && <V key={key} b={b} />}
      {s.data && <Used s={s.data} />}
    </div>
  );
}
