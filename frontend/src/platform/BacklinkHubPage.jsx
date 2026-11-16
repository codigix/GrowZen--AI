import React, { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ExternalLink, Search, RefreshCw, Download, ShieldAlert, CheckCircle2, Info, Sparkles, Link2, Plus, Trash2, Loader2 } from 'lucide-react';
import { SeoShell, Card, Button, Badge, Stat, ErrorNote, Modal, Field, inputCls, useAction, useToast, useDoubleConfirm, SkList } from './SeoUi';
import Select from '../components/Select';
import { api, useApi, usePoll, fmtDateTime } from './seoApi';
import Tip from './Tip';

const VIEWS = {
  links: ['Backlinks', 'Every link to your website that the crawler found: follow or nofollow, anchor text, kind of site, authority and whether it is worth having.'],
  domains: ['Referring domains', 'The websites that link to you, with how many links each gives, what kind of site it is and whether it helps or hurts.'],
  opportunities: ['Link opportunities', 'Websites that link to your competitors but not to you: the places worth asking for a link, best first.'],
  audit: ['Backlink audit', 'What is wrong or weak in your backlink profile, and what to do about it.'],
  sites: ['Tracked sites and sync', 'The websites whose links are collected (yours and your competitors) and how often they are read from our backlink crawler.']
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

function Summary({ s, b, reload, compact = false }) {
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  if (s.state !== 'ok') return null;
  const t = s.totals;
  const sync = () => run('sync', async () => { await api(`/businesses/${b.id}/backlink-intel/bot/run`, { method: 'POST' }); toast('Looking for backlinks. This page updates when it is done.'); setTimeout(() => reload(true), 4000); });
  const score = () => run('score', async () => { const r = await api(`/businesses/${b.id}/backlink-intel/scores/run`, { method: 'POST', body: { domain: s.domain, limit: 15 } }); toast(`Judged ${r.scored.length} site${r.scored.length !== 1 ? 's' : ''}${r.remaining ? `, ${r.remaining} to go: press again` : ''}`); reload(true); });
  const moz = () => run('moz', async () => { const r = await api(`/businesses/${b.id}/backlink-hub/metrics/refresh`, { method: 'POST' }); toast(r.message); reload(true); });
  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-13 text-slate-600">
        <span><b className="text-slate-900">{s.domain}</b>: {s.totals.live} live links from {s.totals.referring_domains} domains{s.crawler.last_sync_at ? `, synced ${day(s.crawler.last_sync_at)}` : ''}</span>
        <span className="ml-auto flex items-center gap-3"><Link to="/backlinks/links" className="font-semibold text-indigo-600 hover:underline">All backlinks</Link><Button size="sm" icon={Link2} busy={busy === 'sync'} onClick={sync}>Find backlinks now</Button></span>
        {toastNode}
      </div>
    );
  }
  return (
    <Card title={`Backlinks to ${s.domain}`} subtitle={s.crawler.last_sync_at ? `Last crawler sync ${day(s.crawler.last_sync_at)}${s.crawler.running ? ' (running now)' : ''}` : 'Read from your backlink crawler'}
      action={<div className="flex flex-wrap gap-2">
        <Button size="sm" icon={Sparkles} busy={busy === 'score'} onClick={score}>Score the links</Button>
        <Button size="sm" icon={RefreshCw} busy={busy === 'moz'} disabled={!s.moz.configured} onClick={moz}>Get DA / PA / spam</Button>
        <Button size="sm" variant="primary" icon={Link2} busy={busy === 'sync'} onClick={sync}>Find backlinks now</Button>
        <Link to="/backlinks/sites"><Button size="sm">Tracked sites</Button></Link>
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

const WORK = { new: ['To do', 'gray'], planned: ['Planned', 'blue'], contacted: ['Contacted', 'amber'], live: ['Got the link', 'green'], skipped: ['Skipped', 'gray'] };
const EFFORT = { low: ['Easy', 'green'], medium: ['Some work', 'amber'], high: ['Hard', 'red'] };
const STAGES = [['todo', 'To do'], ['progress', 'In progress'], ['done', 'Got the link'], ['skipped', 'Skipped']];
const stageOf = (st) => (st === 'contacted' ? 'progress' : st === 'live' ? 'done' : st === 'skipped' ? 'skipped' : 'todo');

function AdviceModal({ b, item, onClose, onChanged }) {
  const [adv, setAdv] = useState(null);
  const [note, setNote] = useState(item?.note || '');
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const base = `/businesses/${b.id}/backlink-hub`;
  const load = (refresh = false) => run('advice', async () => { setAdv(await api(`${base}/advice`, { method: 'POST', body: { domain: item.domain, refresh } })); });
  useEffect(() => { if (item) { setAdv(null); setNote(item.note || ''); load(false); } }, [item?.domain]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!item) return null;
  const mark = (status) => run('mark', async () => { await api(`${base}/plan`, { method: 'POST', body: { domain: item.domain, status, note, source: item.source || 'competitor', name: item.name } }); toast(`Marked: ${WORK[status][0]}`); onChanged(); });
  const copy = () => { try { navigator.clipboard.writeText(adv.message); toast('Message copied'); } catch { toast('Select the text and copy it'); } };
  const [el, et] = EFFORT[adv?.effort] || EFFORT.medium;
  return (
    <Modal open title={item.name || item.domain} onClose={onClose} width="max-w-2xl"
      footer={<div className="flex flex-wrap items-center gap-2 w-full">
        <Button size="sm" busy={busy === 'mark'} onClick={() => mark('planned')}>Add to my plan</Button>
        <Button size="sm" busy={busy === 'mark'} onClick={() => mark('contacted')}>I contacted them</Button>
        <Button size="sm" variant="primary" busy={busy === 'mark'} onClick={() => mark('live')}>I got the link</Button>
        <Button size="sm" busy={busy === 'mark'} onClick={() => mark('skipped')}>Not for us</Button>
        <Button size="sm" className="ml-auto" onClick={onClose}>Close</Button>
      </div>}>
      <div className="grid gap-4 text-13">
        <a href={`https://${item.domain}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-600 hover:underline w-fit">{item.domain}<ExternalLink size={12} /></a>
        <ErrorNote>{error}</ErrorNote>
        {!adv && !error && <SkList rows={3} />}
        {adv && (
          <>
            <div className="flex flex-wrap items-center gap-2"><span className="text-slate-700">{adv.what_it_is}</span><Badge tone={et}>{el}</Badge><Badge tone={adv.method === 'ai' ? 'blue' : 'gray'}>{adv.method === 'ai' ? 'Advice by AI' : 'Standard advice'}</Badge></div>
            <section><h4 className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1.5">What you get from a link here</h4><ul className="grid gap-1 list-disc pl-5 text-slate-700">{adv.what_you_get.map((x, i) => <li key={i}>{x}</li>)}</ul></section>
            <section><h4 className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1.5">How to get it</h4><ol className="grid gap-1 list-decimal pl-5 text-slate-700">{adv.steps.map((x, i) => <li key={i}>{x}</li>)}</ol></section>
            <section><div className="flex items-center justify-between mb-1.5"><h4 className="text-12 font-semibold uppercase tracking-wide text-slate-500">Message you can send</h4><button type="button" onClick={copy} className="text-12 font-semibold text-indigo-600 hover:underline cursor-pointer">Copy</button></div>
              <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 ring-1 ring-inset ring-slate-200 p-3 text-12.5 text-slate-700 font-sans">{adv.message}</pre><p className="text-11.5 text-slate-400 mt-1">Fill in the [add …] parts before sending. Nothing is sent from here.</p></section>
            {adv.caution && <p className="rounded-lg bg-amber-50 text-amber-800 px-3 py-2 text-12.5">{adv.caution}</p>}
            <label className="grid gap-1"><span className="text-12 font-semibold text-slate-500">Your note (who you contacted, when)</span><input value={note} onChange={e => setNote(e.target.value)} maxLength={500} className="h-9 px-3 text-13 rounded-lg ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none" /></label>
            <button type="button" onClick={() => load(true)} className="text-12 text-slate-500 hover:underline w-fit cursor-pointer">Write the advice again</button>
          </>
        )}
      </div>
      {toastNode}
    </Modal>
  );
}

function AiPlatforms({ b, onOpen, onChanged }) {
  const [res, setRes] = useState(null);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const base = `/businesses/${b.id}/backlink-hub`;
  const ask = () => run('ask', async () => setRes(await api(`${base}/platforms/suggest`, { method: 'POST' })));
  const add = (p) => run(p.domain, async () => { await api(`${base}/plan`, { method: 'POST', body: { domain: p.domain, status: 'planned', source: 'ai', name: p.name } }); setRes(r => ({ ...r, platforms: r.platforms.filter(x => x.domain !== p.domain) })); toast(`${p.name} added to your plan`); onChanged(); });
  return (
    <Card title="More places to get links, chosen by AI for your business" subtitle="Not only where competitors are: sites that fit what you do and where you are. Suggestions, to be checked before you use them."
      action={<Button size="sm" variant="primary" icon={Sparkles} busy={busy === 'ask'} onClick={ask}>{res ? 'Suggest again' : 'Suggest places'}</Button>}>
      <ErrorNote>{error}</ErrorNote>
      {!res && <p className="text-13 text-slate-500">Press “Suggest places” and the AI lists sites that suit this business, what a link there gives you, and the first step.</p>}
      {res?.state === 'no_ai' && <p className="text-13 text-amber-800">{res.message}</p>}
      {res?.state === 'error' && <p className="text-13 text-amber-800">{res.message}</p>}
      {res?.state === 'ok' && (res.platforms.length === 0 ? <p className="text-13 text-slate-500">Nothing new to suggest right now.</p> : (
        <div className="grid gap-3 md:grid-cols-2">
          {res.platforms.map(p => (
            <div key={p.domain} className="rounded-lg ring-1 ring-inset ring-slate-200 p-3 grid gap-1.5 text-13">
              <div className="flex items-center gap-2"><a href={`https://${p.domain}`} target="_blank" rel="noreferrer" className="font-semibold text-indigo-600 hover:underline inline-flex items-center gap-1">{p.name}<ExternalLink size={11} /></a><Badge tone="gray">{p.kind}</Badge></div>
              <p className="text-slate-700"><span className="font-semibold">You get:</span> {p.why}</p>
              <p className="text-slate-600"><span className="font-semibold">First step:</span> {p.how}</p>
              <div className="flex gap-2 pt-1"><Button size="sm" busy={busy === p.domain} onClick={() => add(p)}>Add to my plan</Button><Button size="sm" onClick={() => onOpen({ domain: p.domain, name: p.name, source: 'ai' })}>How to get it</Button></div>
            </div>
          ))}
        </div>
      ))}
      {res?.note && <p className="text-11.5 text-slate-400 mt-3">{res.note}</p>}
      {toastNode}
    </Card>
  );
}

function Opportunities({ b }) {
  const [stage, setStage] = useState('todo');
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const dq = useDebounced(q);
  const r = useList(b, 'opportunities', { q: dq, category: cat, limit: 200 });
  const sk = useList(b, 'opportunities', { status: 'skipped', limit: 200 });
  const pl = useApi(`/businesses/${b.id}/backlink-hub/plan`);
  const [busy, error, run] = useAction();
  const d = r.data;
  if (r.error) return <Card><ErrorNote>{r.error.message}</ErrorNote></Card>;
  if (!d) return <SkList rows={6} />;
  const changed = () => { r.reload(true); sk.reload(true); pl.reload(true); };
  const setStatus = (x, status) => run(x.domain, async () => { await api(`/businesses/${b.id}/backlink-hub/plan`, { method: 'POST', body: { domain: x.domain, status, source: 'competitor' } }); changed(); });
  const all = d.opportunities || [];
  const done = (pl.data?.items || []).filter(x => x.status === 'live');
  const lists = { todo: all.filter(x => stageOf(x.status) === 'todo'), progress: all.filter(x => stageOf(x.status) === 'progress'), skipped: sk.data?.opportunities || [] };
  const shown = lists[stage] || [];
  const pill = (on) => `h-8 px-3 rounded-full text-12 font-semibold cursor-pointer ring-1 ring-inset ${on ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`;
  const count = (id) => (id === 'done' ? done.length : (lists[id] || []).length);
  return (
    <>
      <Card title="Where your competitors have links and you do not" subtitle={d.competitors?.length ? 'Your competitors are the ones saved on the Competitors page. Spammy sites are left out.' : 'Add competitors first.'}
        action={<Link to="/competitor-finder"><Button size="sm">Manage competitors</Button></Link>}>
        {d.competitors?.length > 0 && <div className="flex flex-wrap items-center gap-2 mb-3 text-12 text-slate-500"><span>Compared with:</span>{d.competitors.map(c => <Badge key={c} tone="gray">{c}</Badge>)}</div>}
        {d.state === 'no_target' && <p className="text-13 text-slate-500">Add the project's website first.</p>}
        {d.state === 'no_competitors' && <p className="text-13 text-slate-500">No competitors are saved for this project. Find them on the <Link to="/competitor-finder" className="text-indigo-600 hover:underline">Competitors page</Link>; their links are then read by your crawler.</p>}
        {d.note && <p className="text-13 text-slate-500">{d.note}</p>}
        {d.state === 'ok' && <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl"><Stat label="To do" value={lists.todo.length} /><Stat label="In progress" value={lists.progress.length} /><Stat label="Got the link" value={done.length} hint="Confirmed when the crawler sees it" /><Stat label="High priority" value={lists.todo.filter(x => x.priority === 'high').length} /></div>}
      </Card>
      {d.state === 'ok' && (
        <Card pad={false}>
          <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-slate-100">
            {STAGES.map(([id, label]) => <button key={id} type="button" aria-pressed={stage === id} onClick={() => setStage(id)} className={pill(stage === id)}>{label} <span className="opacity-70">{count(id)}</span></button>)}
            {stage !== 'done' && <Select value={cat} onChange={e => setCat(e.target.value)} className={sel} aria-label="Category"><option value="">Any category</option>{[...new Set(all.map(x => x.category.key))].map(k => <option key={k} value={k}>{k}</option>)}</Select>}
            <label className="relative ml-auto"><Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search" aria-label="Search" className="h-8 w-48 pl-8 pr-3 text-13 rounded-lg ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none" /></label>
          </div>
          <ErrorNote>{error}</ErrorNote>
          <div className="overflow-x-auto">
            {stage === 'done' ? (
              <table className="w-full min-w-[600px] text-13">
                <thead className="bg-slate-50 text-12 uppercase tracking-wide text-slate-500"><tr><th className={TH}>Site</th><th className={TH}>Where it came from</th><th className={TH}>Result</th><th className={TH}>Note</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {done.map(x => <tr key={x.domain} className="align-middle"><td className="px-3 py-3 font-semibold text-slate-900">{x.domain}</td><td className="px-3 py-3 text-slate-600">{x.source === 'ai' ? 'Suggested by AI' : 'Competitor gap'}</td><td className="px-3 py-3">{x.confirmed ? <Badge tone="green">Confirmed by the crawler</Badge> : <Badge tone="amber">Marked by you: not seen by the crawler yet</Badge>}</td><td className="px-3 py-3 text-slate-600">{x.note || '—'}</td></tr>)}
                  {!done.length && <Empty>No link won yet. Work through “To do”: the crawler confirms a link when it finds it.</Empty>}
                </tbody>
              </table>
            ) : (
              <table className="w-full min-w-[1000px] text-13">
                <thead className="bg-slate-50 text-12 uppercase tracking-wide text-slate-500"><tr>
                  <th className={TH}>Priority</th><th className={TH}>Site</th><th className={TH}>Competitors linked there</th><th className={TH}>Category</th><th className={TH}>Follow</th><th className={`${TH} text-right`}>DA</th><th className={TH}>Useful?</th><th className={TH}>Status</th><th className={TH} /></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {shown.map(x => { const [pl2, pt] = PRIORITY[x.priority] || PRIORITY.low; return (
                    <tr key={x.domain} className="hover:bg-slate-50 align-middle">
                      <td className="px-3 py-3"><Badge tone={pt}>{pl2}</Badge></td>
                      <td className="px-3 py-3 max-w-[220px]"><a href={x.sample.url} target="_blank" rel="noreferrer" className="font-semibold text-indigo-600 hover:underline inline-flex items-center gap-1">{x.domain}<ExternalLink size={11} /></a>{x.note && <span className="block truncate text-11.5 text-slate-400" title={x.note}>{x.note}</span>}</td>
                      <td className="px-3 py-3 text-slate-600"><Tip text={x.competitors.join(', ')}><span>{x.competitors.join(', ')}</span></Tip></td>
                      <td className="px-3 py-3 text-slate-600">{x.category.label}</td>
                      <td className="px-3 py-3"><FollowBadge f={x.follow} /></td>
                      <td className="px-3 py-3 text-right"><Num v={x.metrics?.da} /></td>
                      <td className="px-3 py-3"><Verdict u={x.useful} why={x.useful_why} /></td>
                      <td className="px-3 py-3"><Select value={x.status} onChange={e => setStatus(x, e.target.value)} className="h-8 text-13 min-w-[130px]" aria-label={`Status of ${x.domain}`} disabled={busy === x.domain}><option value="new">To do</option><option value="planned">Planned</option><option value="contacted">Contacted</option><option value="live">Got the link</option><option value="skipped">Skipped</option></Select></td>
                      <td className="px-3 py-3"><Button size="sm" variant="primary" onClick={() => setOpen(x)}>Guide</Button></td>
                    </tr>); })}
                  {!shown.length && <Empty>{stage === 'todo' ? (all.length ? 'Nothing left to do here.' : 'No opportunities yet: your crawler has not found sites that link to your competitors and not to you.') : stage === 'progress' ? 'Nothing in progress. Open a site and press “I contacted them”.' : 'Nothing skipped.'}</Empty>}
                </tbody>
              </table>
            )}
          </div>
          <p className="px-5 py-3 border-t border-slate-100 text-11.5 text-slate-400">Listed because a competitor has a link there and you do not: a place to ask, not a promise. “Got the link” is confirmed automatically once the crawler finds your link on that site. The best ones also become tasks in your <Link to="/growth#issues" className="text-indigo-600 hover:underline">Growth Plan</Link>.</p>
        </Card>
      )}
      {d.state !== 'no_target' && <AiPlatforms b={b} onOpen={setOpen} onChanged={changed} />}
      {open && <AdviceModal b={b} item={open} onClose={() => setOpen(null)} onChanged={() => { changed(); setOpen(null); }} />}
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

function Sites({ b }) {
  const base = `/businesses/${b.id}/backlink-intel`;
  const targets = useApi(`${base}/targets`);
  const bot = useApi(`${base}/bot`);
  const [domain, setDomain] = useState('');
  const [comp, setComp] = useState(false);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const [ask, confirmNode] = useDoubleConfirm();
  const st = bot.data;
  const running = Boolean(st?.running);
  usePoll(() => bot.reload(true), running, 2500);
  const list = targets.data || [];
  const add = () => run('add', async () => { await api(`${base}/targets`, { method: 'POST', body: { domain, is_competitor: comp } }); setDomain(''); targets.reload(true); toast('Domain added'); });
  const remove = (t) => ask({ what: `the tracked domain ${t.domain}`, effect: 'It stops being monitored. Backlinks already found for it stay in your records.', onConfirm: () => run('rm', async () => { await api(`${base}/targets/${t.id}`, { method: 'DELETE' }); targets.reload(true); }) });
  const save = (patch) => run('save', async () => { await api(`${base}/bot`, { method: 'PUT', body: patch }); bot.reload(true); });
  const sync = () => run('sync', async () => { await api(`${base}/bot/run`, { method: 'POST' }); toast('Syncing from the crawler'); setTimeout(() => bot.reload(true), 800); });
  const addMine = () => run('mine', async () => { const r = await api(`${base}/targets/sync`, { method: 'POST' }); targets.reload(true); toast(r.added.length ? `Added ${r.added.length}: ${r.added.map(a => a.domain).join(', ')}` : 'Already up to date'); });
  const l = st?.last_stats && !st.last_stats.skipped ? st.last_stats : null;
  return (
    <>
      <Card title="Crawler sync" subtitle="Links are found by our own backlink crawler server. This copies what it found for your tracked sites into the project."
        action={st && <Badge tone={running ? 'blue' : st.source !== 'crawler' ? 'red' : st.config.enabled ? 'green' : 'gray'}>{running ? 'Syncing' : st.source !== 'crawler' ? 'Not connected' : st.config.enabled ? 'Scheduled' : 'Off'}</Badge>}>
        {st && st.source !== 'crawler' && <p className="text-13 text-amber-800">Our backlink crawler is not connected. Set CRAWLER_URL and CRAWLER_API_KEY in the backend settings and restart the backend.</p>}
        {st && st.source === 'crawler' && (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex items-center gap-2 text-13 pb-2"><input type="checkbox" checked={st.config.enabled} onChange={(e) => save({ enabled: e.target.checked })} /> Sync automatically</label>
              <Field label="Every"><Select className={`${inputCls} !w-auto`} value={st.config.interval_minutes} onChange={(e) => save({ interval_minutes: Number(e.target.value) })}>{[15, 30, 60, 180, 360, 1440].map(n => <option key={n} value={n}>{n < 60 ? `${n} min` : `${n / 60} h`}</option>)}</Select></Field>
              <Button variant="primary" icon={running ? Loader2 : RefreshCw} busy={busy === 'sync' || running} disabled={running || !list.length} onClick={sync}>{running ? 'Syncing…' : 'Sync now'}</Button>
            </div>
            {l?.error && <p className="text-12.5 text-amber-700">The last sync stopped: {l.error}</p>}
            <p className="text-12 text-gray-500">{st.last_run_at ? <>Last sync {fmtDateTime(st.last_run_at)}{l ? `: ${l.links_read} links read for ${l.domains} domain(s), ${l.new_backlinks} new${l.seeded ? `, ${l.seeded} site(s) handed to the crawler to start looking` : ''}.` : '.'}</> : 'It has not synced yet.'}</p>
            <CrawlerStatusLine />
          </div>
        )}
        <ErrorNote>{error}</ErrorNote>
      </Card>
      <Card title="Tracked domains" subtitle="Your site and your competitors. Backlinks are collected for these.">
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <Field label="Domain"><input className={`${inputCls} !w-64`} placeholder="example.com" value={domain} onChange={(e) => setDomain(e.target.value)} /></Field>
          <label className="flex items-center gap-1.5 text-13 pb-2"><input type="checkbox" checked={comp} onChange={(e) => setComp(e.target.checked)} /> Competitor</label>
          <Button variant="primary" icon={Plus} busy={busy === 'add'} disabled={domain.trim().length < 3} onClick={add}>Add</Button>
          <Button icon={RefreshCw} busy={busy === 'mine'} onClick={addMine}>Add my website and saved competitors</Button>
        </div>
        {confirmNode}
        {list.length === 0 ? <p className="py-6 text-center text-13 text-slate-500">Nothing tracked yet.</p> : list.map(t => (
          <div key={t.id} className="flex items-center gap-3 py-2 border-b border-slate-100 text-13">
            <span className="flex-1 text-slate-900">{t.domain}</span>
            <Badge tone={t.is_competitor ? 'amber' : 'green'}>{t.is_competitor ? 'Competitor' : 'Your site'}</Badge>
            <button type="button" className="text-slate-400 hover:text-red-500 cursor-pointer" aria-label={`Remove ${t.domain}`} onClick={() => remove(t)}><Trash2 size={14} /></button>
          </div>
        ))}
      </Card>
      {toastNode}
    </>
  );
}

function CrawlerStatusLine() {
  const st = useApi('/backlink-intel/crawler/status');
  const d = st.data;
  if (st.error) return <div className="text-12.5 text-amber-700">{st.error.message}</div>;
  if (!d) return null;
  const ok = d.workers.length > 0 && d.workers.every(w => w.healthy);
  return (
    <div className="text-12.5 text-gray-600 flex flex-wrap items-center gap-x-3 gap-y-1">
      <Badge tone={d.paused ? 'amber' : ok ? 'green' : 'amber'}>{d.paused ? 'Crawler paused' : ok ? 'Crawler running' : 'Crawler needs attention'}</Badge>
      <span>{Number(d.discovered_domains).toLocaleString()} websites known · {Number(d.discovered_urls).toLocaleString()} pages found · {Number(d.outgoing_links).toLocaleString()} links recorded</span>
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
  const V = { links: Links, domains: Domains, opportunities: Opportunities, audit: Audit, sites: Sites }[view];
  const main = view === 'links';
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      {view !== 'sites' && (s.data ? <><Summary s={s.data} b={b} reload={s.reload} compact={!main} />{main && <Setup s={s.data} />}</> : s.error ? <Card><ErrorNote>{s.error.message}</ErrorNote></Card> : <SkList rows={3} />)}
      {(view === 'sites' || !s.data || s.data.state === 'ok') && <V key={key} b={b} />}
      {main && s.data && <Used s={s.data} />}
    </div>
  );
}
