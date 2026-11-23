import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, Send, Search as SearchIcon, ShieldCheck, Download, CheckCircle2, AlertTriangle, ExternalLink, Play } from 'lucide-react';
import { SeoShell, Card, Button, Badge, ErrorNote, useAction, useToast, SkList } from './SeoUi';
import { Act, OpenAct } from './TableBits';
import Select from '../components/Select';
import { api, useApi } from './seoApi';
import { usePager, Pager, useSorted, SortTh, downloadCsv } from './DataTable';
import { Ring, Segments, StatCard, Spark, Delta, trendOf } from './StatBits';

const when = (iso) => { if (!iso) return '—'; const t = new Date(iso); return Number.isNaN(t.getTime()) ? '—' : t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); };
const TH = 'px-3 py-2.5 text-left font-medium whitespace-nowrap';
const STATE = { indexed: ['Indexed', 'green'], not_indexed: ['Not indexed', 'amber'], blocked: ['Blocked', 'red'], unknown: ['Unknown', 'gray'] };
const TECH = { indexable: ['Can be indexed', 'green'], risky: ['Risky', 'amber'], blocked: ['Blocked', 'red'] };
const FILTERS = [['all', 'Every page'], ['tech_problem', 'Blocked or risky: may not be indexed'], ['new', 'New this week'], ['pending', 'Waiting to be sent'], ['indexed', 'Indexed in Google'], ['not_indexed', 'Not indexed in Google'], ['unchecked', 'Not checked yet'], ['skipped', 'Not sent: a problem']];

const PAGE_VALUE = (p, k) => (k === 'page' ? p.path : k === 'tech' ? p.tech?.verdict ?? null : k === 'google' ? p.g_state ?? null : k === 'crawl' ? (p.g_last_crawl ? Date.parse(p.g_last_crawl) : null) : (p.submitted_at ? Date.parse(p.submitted_at) : null));

/** The pages table: sortable headings and real pages over the rows the server sent for the filter and search above it. */
function IndexTable({ pages, d, gs, busy, goGoogle, total, resetKey }) {
  const { sorted, sort, onSort } = useSorted(pages, PAGE_VALUE);
  const pager = usePager(sorted, { size: 25, resetKey: `${resetKey}|${sort?.key}|${sort?.dir}` });
  return (
    <>
      <div className="px-5 py-2 flex justify-end border-b border-slate-100"><Button size="sm" icon={Download} disabled={!sorted.length} onClick={() => downloadCsv('page-indexing', ['Page URL', 'First seen', 'New this week', 'Can it be indexed?', 'Reasons', 'In Google', 'Last crawled by Google', 'Sent to other engines', 'Not sent because'],
        sorted.map(p => [p.url, p.first_seen || '', p.is_new ? 'yes' : 'no', p.tech ? (TECH[p.tech.verdict] || ['Not checked'])[0] : 'Not checked', (p.tech?.reasons || []).join('; '), (STATE[p.g_state] || ['Not checked'])[0], p.g_last_crawl || '', p.submitted_at || '', p.skip_reason || '']))}>Export CSV</Button></div>
      <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-13">
            <thead className="bg-slate-50 text-12 uppercase tracking-wide text-slate-500"><tr>{[['page', 'Page'], ['tech', 'Can it be indexed?'], ['google', 'In Google'], ['crawl', 'Last crawled by Google'], ['sent', 'Sent to other engines']].map(([k, l]) => <SortTh key={k} id={k} sort={sort} onSort={onSort} className={TH.replace(' text-left', '').replace(' font-medium', '')}>{l}</SortTh>)}<th className={`${TH} text-right`}>Actions</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {pager.rows.map(p => { const [lab, tone] = STATE[p.g_state] || ['Not checked', 'gray']; return (
                <tr key={p.id} className="align-top hover:bg-slate-50">
                  <td className="px-3 py-3 max-w-[340px]"><div className="font-medium text-slate-900 truncate" title={p.url}>{p.path}</div><div className="text-12 text-slate-500">First seen {when(p.first_seen)}{p.is_new && <span className="ml-1.5"><Badge tone="blue">New</Badge></span>}{p.changed_at && <span className="ml-1.5"><Badge tone="amber">Changed</Badge></span>}{!p.in_sitemap && <span className="ml-1.5 text-slate-400">no longer in the sitemap</span>}</div></td>
                  <td className="px-3 py-3 max-w-[300px]">{p.tech ? <><Badge tone={(TECH[p.tech.verdict] || ['', 'gray'])[1]}>{(TECH[p.tech.verdict] || ['Not checked'])[0]}</Badge>{p.tech.reasons.slice(0, 2).map((r, i) => <div key={i} className="text-12 text-slate-600 mt-1">{r.text}</div>)}{p.tech.reasons.length > 2 && <div className="text-11.5 text-slate-400 mt-0.5">+{p.tech.reasons.length - 2} more</div>}</> : <Badge tone="gray">Not checked</Badge>}</td>
                  <td className="px-3 py-3 max-w-[320px]"><Badge tone={tone}>{lab}</Badge>{!p.g_state && gs && gs.state !== 'ok' && <div className="text-11.5 text-amber-800 mt-1">Google cannot be asked yet: connect Search Console (see the Google box)</div>}{p.g_reason && <div className="text-12 text-slate-600 mt-1">{p.g_reason}</div>}{p.g_advice && <div className="text-12 text-indigo-800 mt-0.5">{p.g_advice}</div>}{p.g_checked_at && <div className="text-11 text-slate-400 mt-0.5">checked {when(p.g_checked_at)}</div>}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-slate-600">{when(p.g_last_crawl)}</td>
                  <td className="px-3 py-3 max-w-[240px]">{p.skip_reason ? <span className="text-amber-800 inline-flex gap-1"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{p.skip_reason}</span> : p.submitted_at ? <span className="text-emerald-700 inline-flex gap-1"><CheckCircle2 size={13} className="mt-0.5 shrink-0" />Sent {when(p.submitted_at)}</span> : p.pending ? <span className="text-indigo-700">Waiting to be sent</span> : <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-3 text-right whitespace-nowrap"><span className="inline-flex gap-1.5">
                    <Act icon={ExternalLink} tone={p.g_state === 'indexed' ? 'sky' : 'indigo'} busy={busy === `go${p.url}`} onClick={() => goGoogle(p)}
                      tip={p.g_state === 'indexed' ? "Check: ask Google about this page and open its report in Search Console." : "Index it: ask Google about this page, send it to the other search engines, and open its report in Search Console, where you press Request indexing."}>{p.g_state === 'indexed' ? 'Check' : 'Index it'}</Act>
                    <OpenAct url={p.url} tip="Open: show the page in a new tab." />
                  </span></td>
                </tr>); })}
              {!d.pages.length && <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-500">{total ? 'No page matches this filter.' : 'No pages yet. Press “Read the sitemap now” to find the pages of your site.'}</td></tr>}
            </tbody>
          </table>
        </div>
      <Pager p={pager} label="pages" />
    </>
  );
}

function Indexing({ b }) {
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const o = useApi(`/businesses/${b.id}/indexing?status=${status}&q=${encodeURIComponent(q)}&limit=300`);
  const g = useApi(`/businesses/${b.id}/indexing/google`);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const [keyMsg, setKeyMsg] = useState(null);
  const d = o.data;
  const tried = useRef(false);
  // The first time the page opens with pages nobody has checked, check them: no button to press.
  useEffect(() => {
    const n = o.data?.counts;
    if (!n || tried.current || !n.total || !n.tech_unchecked) return;
    tried.current = true;
    api(`/businesses/${b.id}/indexing/check`, { method: 'POST', body: {}, timeout: 170000 }).then(() => o.reload(true)).catch(() => { /* the button below does the same, with the error shown */ });
  }, [o.data?.counts?.tech_unchecked, o.data?.counts?.total]); // eslint-disable-line react-hooks/exhaustive-deps
  if (o.error) return <Card><ErrorNote>{o.error.message}</ErrorNote></Card>;
  if (!d) return <SkList rows={6} />;
  const c = d.counts;
  const act = (key, path, body, then) => run(key, async () => { const r = await api(`/businesses/${b.id}/indexing${path}`, { method: 'POST', body: body || {}, timeout: 170000 }); await o.reload(true); then?.(r); });
  const scan = () => act('scan', '/scan', null, r => toast(`${r.found} pages in the sitemap: ${r.new} new, ${r.changed} changed${r.seen_in_google ? `, ${r.seen_in_google} already shown in Google` : ''}`));
  const send = (urls) => act(urls ? `send${urls[0]}` : 'send', '/submit', urls ? { urls } : {}, r => toast(r.sent ? `${r.sent} page${r.sent === 1 ? '' : 's'} sent to ${d.engines.join(', ')}${r.skipped.length ? `; ${r.skipped.length} skipped (a problem on the page)` : ''}` : r.message));
  const techCheck = (urls) => act(urls ? `tech${urls[0]}` : 'tech', '/check', urls ? { urls } : null, r => toast(r.checked ? `${r.checked} page${r.checked === 1 ? '' : 's'} checked: ${r.indexable} can be indexed, ${r.risky} risky, ${r.blocked} blocked` : 'Every page was checked in the last 3 days.'));
  const inspect = (urls) => act(urls ? `check${urls[0]}` : 'inspect', '/inspect', urls ? { urls } : { limit: 25 }, r => toast(r.checked ? `Google answered for ${r.checked} pages: ${r.indexed} indexed, ${r.not_indexed + r.blocked} not` : (r.error || 'Nothing to check')));
  // One action for a page: ask Google about it, send it to the other engines when it is not indexed, and open its own report in Search Console (Google's link, with the Request indexing button).
  const goGoogle = (p) => {
    const tab = window.open('', '_blank'); // opened by the click, filled when Google has answered (a tab opened later would be blocked)
    return run(`go${p.url}`, async () => {
      let link = p.g_link || null;
      let state = p.g_state;
      try {
        const r = await api(`/businesses/${b.id}/indexing/inspect`, { method: 'POST', body: { urls: [p.url] }, timeout: 170000 });
        const got = r.pages?.[p.url];
        if (got) { link = got.link || link; state = got.state; }
        if (!got && r.error) throw new Error(r.error);
      } catch (e) {
        if (!link) { tab?.close(); throw e; }
      }
      if (state !== 'indexed' && d.key.ready) { try { await api(`/businesses/${b.id}/indexing/submit`, { method: 'POST', body: { urls: [p.url] } }); } catch { /* the Search Console tab still opens */ } }
      await o.reload(true);
      if (link && tab) { tab.location.href = link; toast(state === 'indexed' ? 'Google shows this page. Its report is open in Search Console.' : 'This page is not indexed yet. In the Search Console tab press Request indexing.'); }
      else { tab?.close(); toast(state === 'indexed' ? 'Google shows this page.' : 'Google has not given a Search Console link for this page.'); }
    });
  };
  const verify = () => run('verify', async () => { const r = await api(`/businesses/${b.id}/indexing/verify-key`, { method: 'POST' }); setKeyMsg(r); await o.reload(true); });
  const auto = (on) => run('auto', async () => { await api(`/businesses/${b.id}/indexing/settings`, { method: 'PUT', body: { auto: on } }); await o.reload(true); toast(on ? 'Automatic indexing is on: it runs every day' : 'Automatic indexing is off'); });
  const runNow = () => act('run', '/run', null, r => toast(r.note || `Done: ${r.new ?? 0} new pages, ${r.submitted ?? 0} sent, ${r.inspected ?? 0} checked in Google`));
  const download = () => run('key', async () => {
    const k = await api(`/businesses/${b.id}/indexing/key`);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([k.content], { type: 'text/plain' })); a.download = k.name; a.click();
    await o.reload(true);
  });
  const gs = g.data;
  const last = d.last_scan || {};
  return (
    <div className="space-y-5">
      {(() => {
        const hist = d.history || [];
        const tr = (k) => trendOf(hist, k);
        const total = c.in_sitemap || c.total || 0;
        const share = (n) => (total ? Math.round((n / total) * 100) : 0);
        const idx = tr('indexed');
        return (
          <div className="space-y-3">
            <div className="rounded-xl bg-white ring-1 ring-slate-200 p-5 flex flex-wrap items-center gap-x-8 gap-y-4">
              <Ring value={c.indexed} total={total} label="indexed" />
              <div className="flex-1 min-w-[260px]">
                <div className="text-15 font-semibold text-slate-900"><span className="tabular-nums">{c.indexed}</span> of <span className="tabular-nums">{total}</span> sitemap pages are indexed in Google</div>
                <div className="mt-1 text-12.5 text-slate-500">{c.unchecked ? `${c.unchecked} have not been asked yet: press “Check Google for 25 pages”. ` : 'Every page has been asked. '}{c.not_indexed ? `${c.not_indexed} are not indexed.` : ''}</div>
                <div className="mt-3"><Segments total={total} parts={[{ label: 'Indexed', value: c.indexed, color: '#10b981' }, { label: 'Not indexed', value: c.not_indexed, color: '#f59e0b' }, { label: 'Not asked yet', value: c.unchecked, color: '#cbd5e1' }]} /></div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-12 text-slate-600">
                  <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />Indexed <b className="tabular-nums text-slate-900">{c.indexed}</b></span>
                  <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" />Not indexed <b className="tabular-nums text-slate-900">{c.not_indexed}</b></span>
                  <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-slate-300" />Not asked yet <b className="tabular-nums text-slate-900">{c.unchecked}</b></span>
                </div>
              </div>
              <div className="min-w-[170px]">
                <div className="text-12 font-semibold text-slate-500 mb-1">Indexed pages, last 30 days</div>
                {idx.series.length > 1 ? <Spark values={idx.series} tone="#10b981" width={170} height={48} /> : <div className="text-12 text-slate-400">The graph fills in as days pass: this page keeps each day's count from now on.</div>}
                <div className="mt-1"><Delta now={c.indexed} before={idx.before} since={idx.since} /></div>
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <StatCard label="Pages in your sitemap" value={c.in_sitemap} tone="#6366f1" {...tr('in_sitemap')} />
              <StatCard label="Indexed in Google" value={c.indexed} tone="#10b981" valueTone="text-emerald-700" hint="Google shows these in search, or told us so when we checked" share={share(c.indexed)} {...tr('indexed')} />
              <StatCard label="Not indexed in Google" value={c.not_indexed} tone="#f59e0b" valueTone={c.not_indexed ? 'text-amber-600' : 'text-slate-900'} lowerIsBetter share={share(c.not_indexed)} {...tr('not_indexed')} />
              <StatCard label="Sent to other engines" value={c.sent} tone="#0ea5e9" hint="Bing, Yandex, Seznam, Naver, Yep (IndexNow)" share={share(c.sent)} {...tr('sent')} />
              <StatCard label="Waiting to be sent" value={c.pending} tone="#8b5cf6" valueTone={c.pending ? 'text-indigo-700' : 'text-slate-900'} lowerIsBetter share={share(c.pending)} {...tr('pending')} />
            </div>

            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2 mt-2">
                <h3 className="text-15 font-semibold text-slate-900">Can Google index these pages?</h3>
                <span className="text-12 text-slate-500">Our own check: each page is loaded like a crawler. It needs no Google account. {c.tech_unchecked ? `${c.tech_unchecked} not checked yet.` : ''}</span>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard label="Can be indexed" value={c.tech_ok} tone="#10b981" valueTone="text-emerald-700" hint="Loads, no noindex, allowed by robots.txt, its own canonical and readable text" share={share(c.tech_ok)} {...tr('tech_ok')} />
                <StatCard label="Risky" value={c.tech_risky} tone="#f59e0b" valueTone={c.tech_risky ? 'text-amber-600' : 'text-slate-900'} lowerIsBetter hint="It loads but something may keep Google from indexing it: a canonical to another page, a redirect, almost no readable text" share={share(c.tech_risky)} {...tr('tech_risky')} />
                <StatCard label="Blocked" value={c.tech_blocked} tone="#ef4444" valueTone={c.tech_blocked ? 'text-red-600' : 'text-slate-900'} lowerIsBetter hint="An error, a noindex tag or header, or robots.txt stops Google" share={share(c.tech_blocked)} {...tr('tech_blocked')} />
                <StatCard label="Not checked yet" value={c.tech_unchecked} tone="#94a3b8" lowerIsBetter hint="Checked automatically when this page opens and every day" share={share(c.tech_unchecked)} {...tr('tech_unchecked')} />
              </div>
            </div>
          </div>
        );
      })()}

      <Card title="Automatic indexing" subtitle="Every day the software reads your sitemap, finds new and changed pages, sends them to the other search engines, and asks Google how each page is doing."
        action={<span className="flex gap-2"><Button size="sm" icon={Play} busy={busy === 'run'} onClick={runNow}>Run it now</Button>{d.auto ? <Button size="sm" onClick={() => auto(false)} busy={busy === 'auto'}>Turn off</Button> : <Button size="sm" variant="primary" onClick={() => auto(true)} busy={busy === 'auto'}>Turn on</Button>}</span>}>
        <ErrorNote>{error}</ErrorNote>
        <div className="flex flex-wrap items-center gap-3 text-13">
          <Badge tone={d.auto ? 'green' : 'gray'}>{d.auto ? 'On: runs daily' : 'Off'}</Badge>
          <span className="text-slate-600">{last.at ? `Last run ${when(last.at)}: ${last.found ?? 0} pages, ${last.new ?? 0} new, ${last.changed ?? 0} changed${last.submitted != null ? `, ${last.submitted} sent` : ''}${last.inspected != null ? `, ${last.inspected} checked in Google` : ''}.` : 'It has not run yet.'}</span>
          {(last.note || last.submit_note || last.google_note) && <span className="text-amber-800">{last.note || last.submit_note || last.google_note}</span>}
        </div>
        <p className="mt-3 text-12.5 text-slate-500">New pages published from this app are recorded the moment they go live{d.auto && d.key.ready ? ' and sent within a minute' : ''}. Pages with an error or a noindex tag are not sent: they are listed with the reason.</p>
      </Card>

      <div className="grid lg:grid-cols-2 gap-5">
        <Card title="Bing, Yandex and other search engines" subtitle="IndexNow: one message reaches Bing, Yandex, Seznam, Naver and Yep at once, so new pages appear in hours instead of weeks."
          action={<Badge tone={d.key.ready ? 'green' : 'amber'}>{d.key.ready ? 'Ready' : 'Setup needed'}</Badge>}>
          <ol className="grid gap-3 text-13 text-slate-700 list-decimal pl-5">
            <li><div className="flex flex-wrap items-center gap-2">Download your key file <Button size="sm" icon={Download} busy={busy === 'key'} onClick={download}>Download key file</Button></div></li>
            <li>Upload it to the root of {d.host || 'your site'}, so it opens at <a href={d.key.url || '#'} target="_blank" rel="noreferrer noopener" className="text-indigo-600 hover:underline break-all">{d.key.url || 'the key address'}</a>. It proves the site is yours.</li>
            <li><div className="flex flex-wrap items-center gap-2">Check that it is there <Button size="sm" icon={ShieldCheck} busy={busy === 'verify'} onClick={verify}>Check the file</Button></div>
              {keyMsg && <p className={`mt-1.5 ${keyMsg.ok ? 'text-emerald-700' : 'text-amber-800'}`}>{keyMsg.message}</p>}
              {d.key.verified_at && !keyMsg && <p className="mt-1.5 text-emerald-700">Checked {when(d.key.verified_at)}: ready.</p>}</li>
          </ol>
          <p className="mt-3 text-12 text-slate-500">Google does not take part in IndexNow. Its part is on the right.</p>
        </Card>

        <Card title="Google" subtitle="Google has no way to ask for a page to be indexed. The software checks each page's real status in Google and tells you the reason and the fix."
          action={gs?.console_url ? <a href={gs.console_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-13 font-semibold text-indigo-600 hover:underline"><ExternalLink size={13} />Search Console</a> : null}>
          {!gs && !g.error && <SkList rows={2} />}
          {gs && gs.state !== 'ok' && <p className="text-13 text-amber-800 flex gap-2"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{gs.message}</p>}
          {gs?.state === 'ok' && (
            <div className="grid gap-3 text-13">
              <p className="text-slate-600">Reading {gs.property} through {gs.account}.</p>
              {gs.sitemaps?.length ? <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200"><table className="w-full min-w-[420px]"><thead className="bg-slate-50 text-12 uppercase tracking-wide text-slate-500"><tr><th className={TH}>Sitemap Google knows</th><th className={`${TH} text-right`}>Pages</th><th className={`${TH} text-right`}>Problems</th><th className={TH}>Last read</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{gs.sitemaps.map(m => <tr key={m.path}><td className="px-3 py-2 break-all">{m.path}</td><td className="px-3 py-2 text-right tabular-nums">{m.submitted}</td><td className="px-3 py-2 text-right tabular-nums">{m.errors + m.warnings ? <span className="text-amber-700">{m.errors} errors, {m.warnings} warnings</span> : <span className="text-emerald-700">None</span>}</td><td className="px-3 py-2 whitespace-nowrap">{when(m.last_downloaded)}</td></tr>)}</tbody></table></div>
                : <p className="text-amber-800">Google has no sitemap for this site. In Search Console open Sitemaps and submit your sitemap address.</p>}
              <p className="text-slate-500">For an important page that is not indexed, fix what the reason says, then press “Request indexing” for it in Search Console (that step is manual, by Google's design).</p>
            </div>)}
        </Card>
      </div>

      <Card pad={false}>
        <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
          <Select value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter" className="h-9 w-56 rounded-lg border border-slate-300 bg-white px-3 text-13">{FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          <div className="relative"><SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a page" aria-label="Find a page" className="h-9 w-56 rounded-lg border border-slate-300 pl-8 pr-3 text-13" /></div>
          <span className="text-12 text-slate-500">{d.shown} of {c.total} pages</span>
          <span className="flex-1" />
          <Button size="sm" icon={RefreshCw} busy={busy === 'scan'} onClick={scan}>Read the sitemap now</Button>
          <Button size="sm" icon={ShieldCheck} busy={busy === 'tech'} onClick={() => techCheck()} title="Load each page like a crawler and check what could stop indexing">Check pages now</Button>
          <Button size="sm" icon={SearchIcon} busy={busy === 'inspect'} onClick={() => inspect()}>Check Google for 25 pages</Button>
          <Button size="sm" variant="primary" icon={Send} busy={busy === 'send'} disabled={!c.pending || !d.key.ready} title={d.key.ready ? '' : 'Put the key file on the site first'} onClick={() => send()}>Send {c.pending} waiting page{c.pending === 1 ? '' : 's'}</Button>
        </div>
        <IndexTable pages={d.pages} d={d} gs={gs} busy={busy} goGoogle={goGoogle} total={c.total} resetKey={`${status}|${q}`} />
      </Card>
      {toastNode}
    </div>
  );
}

export default function PageIndexingPage() {
  return (
    <SeoShell step="website" title="Page Indexing" subtitle="Which pages of your site Google and the other search engines know, and getting new pages found sooner.">
      {(b) => <Indexing key={b.id} b={b} />}
    </SeoShell>
  );
}
