import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, Send, Search as SearchIcon, ShieldCheck, Download, CheckCircle2, AlertTriangle, ExternalLink, Play } from 'lucide-react';
import { SeoShell, Card, Button, Badge, ErrorNote, useAction, useToast, SkList } from './SeoUi';
import { Act, OpenAct } from './TableBits';
import Select from '../components/Select';
import { api, useApi } from './seoApi';

const when = (iso) => { if (!iso) return '—'; const t = new Date(iso); return Number.isNaN(t.getTime()) ? '—' : t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); };
const TH = 'px-3 py-2.5 text-left font-medium whitespace-nowrap';
const STATE = { indexed: ['Indexed', 'green'], not_indexed: ['Not indexed', 'amber'], blocked: ['Blocked', 'red'], unknown: ['Unknown', 'gray'] };
const TECH = { indexable: ['Can be indexed', 'green'], risky: ['Risky', 'amber'], blocked: ['Blocked', 'red'] };
const FILTERS = [['all', 'Every page'], ['tech_problem', 'Blocked or risky: may not be indexed'], ['new', 'New this week'], ['pending', 'Waiting to be sent'], ['indexed', 'Indexed in Google'], ['not_indexed', 'Not indexed in Google'], ['unchecked', 'Not checked yet'], ['skipped', 'Not sent: a problem']];

function Tile({ label, value, tone = 'text-slate-900', hint }) {
  return <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4 shadow-sm" title={hint}><div className="text-12 text-slate-500">{label}</div><div className={`text-26 font-bold tabular-nums ${tone}`}>{value ?? '—'}</div></div>;
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
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Tile label="Pages in your sitemap" value={c.in_sitemap} />
        <Tile label="Indexed in Google" value={c.indexed} tone="text-emerald-700" hint="Google shows these in search, or told us so when we checked" />
        <Tile label="Not indexed in Google" value={c.not_indexed} tone={c.not_indexed ? 'text-amber-600' : 'text-slate-900'} />
        <Tile label="Sent to other engines" value={c.sent} hint="Bing, Yandex, Seznam, Naver, Yep (IndexNow)" />
        <Tile label="Waiting to be sent" value={c.pending} tone={c.pending ? 'text-indigo-700' : 'text-slate-900'} />
      </div>

      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
          <h3 className="text-15 font-semibold text-slate-900">Can Google index these pages?</h3>
          <span className="text-12 text-slate-500">Our own check: each page is loaded like a crawler. It needs no Google account. {c.tech_unchecked ? `${c.tech_unchecked} not checked yet.` : ''}</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile label="Can be indexed" value={c.tech_ok} tone="text-emerald-700" hint="Loads, no noindex, allowed by robots.txt, its own canonical and readable text" />
          <Tile label="Risky" value={c.tech_risky} tone={c.tech_risky ? 'text-amber-600' : 'text-slate-900'} hint="It loads but something may keep Google from indexing it: a canonical to another page, a redirect, almost no readable text" />
          <Tile label="Blocked" value={c.tech_blocked} tone={c.tech_blocked ? 'text-red-600' : 'text-slate-900'} hint="An error, a noindex tag or header, or robots.txt stops Google" />
          <Tile label="Not checked yet" value={c.tech_unchecked} hint="Checked automatically when this page opens and every day" />
        </div>
      </div>

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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-13">
            <thead className="bg-slate-50 text-12 uppercase tracking-wide text-slate-500"><tr><th className={TH}>Page</th><th className={TH}>Can it be indexed?</th><th className={TH}>In Google</th><th className={TH}>Last crawled by Google</th><th className={TH}>Sent to other engines</th><th className={`${TH} text-right`}>Actions</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {d.pages.map(p => { const [lab, tone] = STATE[p.g_state] || ['Not checked', 'gray']; return (
                <tr key={p.id} className="align-top hover:bg-slate-50">
                  <td className="px-3 py-3 max-w-[340px]"><div className="font-medium text-slate-900 truncate" title={p.url}>{p.path}</div><div className="text-12 text-slate-500">First seen {when(p.first_seen)}{p.is_new && <span className="ml-1.5"><Badge tone="blue">New</Badge></span>}{p.changed_at && <span className="ml-1.5"><Badge tone="amber">Changed</Badge></span>}{!p.in_sitemap && <span className="ml-1.5 text-slate-400">no longer in the sitemap</span>}</div></td>
                  <td className="px-3 py-3 max-w-[300px]">{p.tech ? <><Badge tone={(TECH[p.tech.verdict] || ['', 'gray'])[1]}>{(TECH[p.tech.verdict] || ['Not checked'])[0]}</Badge>{p.tech.reasons.slice(0, 2).map((r, i) => <div key={i} className="text-12 text-slate-600 mt-1">{r.text}</div>)}{p.tech.reasons.length > 2 && <div className="text-11.5 text-slate-400 mt-0.5">+{p.tech.reasons.length - 2} more</div>}</> : <Badge tone="gray">Not checked</Badge>}</td>
                  <td className="px-3 py-3 max-w-[320px]"><Badge tone={tone}>{lab}</Badge>{!p.g_state && gs && gs.state !== 'ok' && <div className="text-11.5 text-amber-800 mt-1">Google cannot be asked yet: connect Search Console (see the Google box)</div>}{p.g_reason && <div className="text-12 text-slate-600 mt-1">{p.g_reason}</div>}{p.g_advice && <div className="text-12 text-indigo-800 mt-0.5">{p.g_advice}</div>}{p.g_checked_at && <div className="text-11 text-slate-400 mt-0.5">checked {when(p.g_checked_at)}</div>}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-slate-600">{when(p.g_last_crawl)}</td>
                  <td className="px-3 py-3 max-w-[240px]">{p.skip_reason ? <span className="text-amber-800 inline-flex gap-1"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{p.skip_reason}</span> : p.submitted_at ? <span className="text-emerald-700 inline-flex gap-1"><CheckCircle2 size={13} className="mt-0.5 shrink-0" />Sent {when(p.submitted_at)}</span> : p.pending ? <span className="text-indigo-700">Waiting to be sent</span> : <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-3 text-right whitespace-nowrap"><span className="inline-flex gap-1.5">
                    <Act tip="Check: ask Google about this page now." busy={busy === `check${p.url}`} onClick={() => inspect([p.url])}>Check</Act>
                    {d.key.ready && <Act tone="violet" tip="Send: tell Bing, Yandex and the others about this page now." busy={busy === `send${p.url}`} onClick={() => send([p.url])}>Send</Act>}
                    <OpenAct url={p.url} tip="Open: show the page in a new tab." />
                  </span></td>
                </tr>); })}
              {!d.pages.length && <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-500">{c.total ? 'No page matches this filter.' : 'No pages yet. Press “Read the sitemap now” to find the pages of your site.'}</td></tr>}
            </tbody>
          </table>
        </div>
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
