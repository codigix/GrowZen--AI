import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BellRing, CheckCircle2, ChevronDown, ChevronRight, Download, ExternalLink, Info, Link2, RefreshCw, Sparkles } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { Card, Button, ErrorNote, useAction, useToast } from './SeoUi';
import { usePager, Pager } from './DataTable';
import { api, fmt } from './seoApi';

const kfmt = (n) => (n == null ? '—' : n >= 1e4 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K` : Number(n).toLocaleString('en-US'));
const TONE = { Low: ['#059669', '#ecfdf5', '#a7f3d0'], Medium: ['#b45309', '#fffbeb', '#fde68a'], High: ['#dc2626', '#fef2f2', '#fecaca'] };
const BAND = { toxic: ['High', '#fee2e2', '#b91c1c'], potential: ['Medium', '#fef3c7', '#b45309'], clean: ['Low', '#d1fae5', '#047857'], unknown: ['Not judged', '#f1f5f9', '#64748b'] };
const CAT_COLOR = { toxic: '#ef4444', potential: '#f59e0b', clean: '#10b981', unknown: '#cbd5e1' };

function Spark({ data, k, color }) {
  if (!data || data.length < 2) return <div className="h-10 flex items-end"><div className="w-full h-px bg-slate-200" /></div>;
  return <div className="h-10"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ top: 2, bottom: 0, left: 0, right: 0 }}><Area type="monotone" dataKey={k} stroke={color} strokeWidth={1.6} fill={color} fillOpacity={0.12} isAnimationActive={false} /></AreaChart></ResponsiveContainer></div>;
}

function Metric({ label, value, change, sub, tone = 'text-indigo-600', hint, children }) {
  return (
    <div className="rounded-xl bg-white ring-1 ring-slate-200 px-4 py-3 min-w-0" title={hint}>
      <div className="flex items-center gap-1.5 text-13.5 font-semibold text-slate-800">{label}{hint && <Info size={12} className="text-slate-400" />}</div>
      <div className="mt-1 flex items-baseline gap-2"><span className={`text-28 font-bold tabular-nums leading-none ${tone}`}>{value}</span>{change != null && <span className="text-12 font-semibold text-emerald-600 tabular-nums">↑ +{change}%</span>}</div>
      {sub && <div className="text-12 text-slate-500 mt-1">{sub}</div>}
      {children}
    </div>
  );
}

function Donut({ data, center, sub }) {
  return (
    <div className="relative h-36 w-36 shrink-0">
      <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data} dataKey="value" innerRadius={44} outerRadius={64} paddingAngle={data.filter(x => x.value).length > 1 ? 1.5 : 0} stroke="none" isAnimationActive={false}>{data.map(x => <Cell key={x.name} fill={x.color} />)}</Pie><Tooltip formatter={(v, n) => [fmt(v), n]} /></PieChart></ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"><div className="text-18 font-bold tabular-nums text-slate-900 leading-tight">{center}</div><div className="text-11.5 text-slate-500">{sub}</div></div>
    </div>
  );
}

const pct = (n, tot) => (tot ? (n && (n * 100) / tot < 1 ? '<1%' : `${Math.round((n * 100) / tot)}%`) : '0%');
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/** The top of the Backlink Audit: the health of the backlink profile in numbers, who is harmful, what to do, and on which basis it is worked out. */
export default function AuditReport({ d, b, syncedAt, onChanged }) {
  const rp = d.report;
  const [tab, setTab] = useState('domains');
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const [basis, setBasis] = useState(false);
  const [withPotential, setWithPotential] = useState(false);
  // Backlinks are shown one row per linking site; its pages are inside it and show when it is opened.
  const siteGroups = useMemo(() => {
    const map = new Map();
    for (const x of rp?.backlinks || []) {
      const dom = (x.source_url || '').replace(/^https?:\/\/(www\.)?/, '').split('/')[0] || x.source_url;
      if (!map.has(dom)) map.set(dom, []);
      map.get(dom).push(x);
    }
    return [...map.entries()].map(([domain, links]) => ({ domain, links }));
  }, [rp]);
  const rows = useMemo(() => (tab === 'domains' ? rp?.domains : tab === 'links' ? siteGroups : d.report?.anchors) || [], [rp, tab, d, siteGroups]);
  const pager = usePager(rows, { size: 8, resetKey: tab });
  const [openSites, setOpenSites] = useState(() => new Set());
  const toggleSite = (dom) => setOpenSites(prev => { const n = new Set(prev); if (n.has(dom)) n.delete(dom); else n.add(dom); return n; });
  if (!rp || rp.state !== 'ok') return null;
  const t = rp.totals, f = rp.follow, kinds = rp.kinds;
  const total = t.backlinks;
  const [tc, bg, ring] = TONE[t.risk] || TONE.Low;
  const rerun = () => run('rerun', async () => { await api(`/businesses/${b.id}/backlink-intel/bot/run`, { method: 'POST' }); toast('Looking for backlinks again. This page updates when it is done.'); setTimeout(() => onChanged && onChanged(), 4000); });
  const judge = () => run('judge', async () => { const r = await api(`/businesses/${b.id}/backlink-intel/scores/run`, { method: 'POST', body: { domain: d.domain, limit: 15 } }); toast(`Judged ${r.scored.length} site${r.scored.length === 1 ? '' : 's'}${r.remaining ? `, ${r.remaining} to go: press again` : ''}`); onChanged && onChanged(); });
  const downloadDisavow = () => {
    const list = [...rp.disavow.toxic, ...(withPotential ? rp.disavow.potential : [])];
    const text = `# Disavow file for ${d.domain}, made ${new Date().toISOString().slice(0, 10)} from our backlink audit.\n# Upload it in Google Search Console: Disavow links tool. Check each site first.\n${list.map(x => `domain:${x}`).join('\n')}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a'); a.href = url; a.download = `disavow-${d.domain}.txt`; a.click(); URL.revokeObjectURL(url);
  };
  const unjudged = t.referring_domains - t.judged_domains;
  const followRows = [['Follow', f.follow || 0, '#3b82f6'], ['Nofollow', f.nofollow || 0, '#f59e0b']];
  const kindRows = Object.entries(kinds).sort((x, y) => y[1] - x[1]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-13 text-slate-600">
        <span>Last update: <b className="text-slate-900">{day(syncedAt)}</b></span><span>Scope: <b className="text-indigo-700">Root domain</b> {d.domain}</span>
        <span className="ml-auto flex flex-wrap gap-2">
          {unjudged > 0 && <Button size="sm" icon={Sparkles} busy={busy === 'judge'} onClick={judge} title="Judge the linking sites that have no risk reading yet">Judge {unjudged} site{unjudged === 1 ? '' : 's'}</Button>}
          <Button size="sm" icon={RefreshCw} busy={busy === 'rerun'} onClick={rerun}>Rerun campaign</Button>
        </span>
      </div>
      <ErrorNote>{error}</ErrorNote>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="rounded-xl bg-white px-4 py-3 ring-2" style={{ '--tw-ring-color': ring }}>
          <div className="flex items-center gap-1.5 text-13.5 font-semibold text-slate-800">Overall toxicity score<Info size={12} className="text-slate-400" /></div>
          <div className="mt-1 flex items-center justify-between gap-3">
            <div><div className="text-28 font-bold leading-tight" style={{ color: tc }}>{t.risk ? `${t.risk} risk` : 'Not judged'}</div><p className="text-12.5 text-slate-600 mt-1">{t.risk === 'Low' ? 'Your backlink profile looks good.' : t.risk === 'Medium' ? 'Some links may hurt your SEO: review them.' : t.risk === 'High' ? 'Many links may hurt your SEO: act on them first.' : 'Judge the linking sites to see this.'}</p></div>
            <div className="relative h-20 w-20 shrink-0"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={[{ v: t.overall || 0 }, { v: 100 - (t.overall || 0) }]} dataKey="v" innerRadius={27} outerRadius={38} startAngle={90} endAngle={-270} stroke="none" isAnimationActive={false}><Cell fill={tc} /><Cell fill="#e5e7eb" /></Pie></PieChart></ResponsiveContainer><div className="absolute inset-0 flex items-center justify-center text-16 font-bold tabular-nums text-slate-900">{t.overall != null ? `${t.overall}%` : '—'}</div></div>
          </div>
        </div>
        <Metric label="Referring domains" value={kfmt(t.referring_domains)} change={t.domains_change} sub={`${t.toxic_domains} toxic, ${t.potential_domains} potentially toxic`} hint="Total unique websites with a live link to yours, among the links our crawler found."><Spark data={rp.series} k="domains" color="#6366f1" /></Metric>
        <Metric label="Backlinks" value={kfmt(t.backlinks)} change={t.links_change} tone="text-indigo-600" sub={`${t.new_30d} found in the last 30 days`} hint="Total number of live links from all those domains."><Spark data={rp.series} k="backlinks" color="#6366f1" /></Metric>
        <Metric label="Toxic backlinks" value={kfmt(t.toxic_links)} tone="text-rose-600" sub={`${t.overall ?? 0}% of total`} hint="Links from sites that look harmful: spammy, unrelated or unnatural."><Spark data={rp.series} k="toxic" color="#ef4444" /></Metric>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card title="Follow vs nofollow" subtitle="Follow links pass SEO value">
          <div className="flex items-center gap-5"><Donut data={followRows.map(([n, v, c]) => ({ name: n, value: v, color: c }))} center={kfmt(total)} sub="Backlinks" />
            <ul className="flex-1 space-y-2.5 text-13">{followRows.map(([n, v, c]) => <li key={n} className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c }} /><span className="flex-1 text-slate-800">{n}</span><span className="tabular-nums text-slate-500">{pct(v, total)}</span><span className="tabular-nums text-indigo-700 w-12 text-right">{kfmt(v)}</span></li>)}</ul></div>
          {total > 0 && (f.follow || 0) * 100 / total > 95 && <p className="mt-3 flex items-center gap-2 text-12.5 text-amber-800 bg-amber-50 rounded-lg px-3 py-2"><AlertTriangle size={14} />Almost every link is follow: a natural profile has some nofollow links too.</p>}
        </Card>
        <Card title="Link types" subtitle="What the link is made of, read from its anchor">
          <ul className="space-y-3">{kindRows.length ? kindRows.map(([k, v]) => <li key={k}><div className="flex items-baseline justify-between text-13"><span className="text-slate-800">{k}</span><span className="tabular-nums"><span className="text-slate-500 mr-3">{pct(v, total)}</span><span className="text-indigo-700">{fmt(v)}</span></span></div><div className="mt-1 h-2 rounded bg-slate-100 overflow-hidden"><div className="h-full bg-blue-500" style={{ width: `${total ? (v * 100) / total : 0}%` }} /></div></li>) : <li className="text-13 text-slate-500">No links yet.</li>}</ul>
          <p className="mt-3 text-11.5 text-slate-400">Form and frame links are not told apart by our crawler.</p>
        </Card>
        <Card title="Toxicity categories" subtitle="Backlinks by how harmful their site looks">
          <div className="flex items-center gap-5"><Donut data={rp.categories.filter(c => c.key !== 'unknown' || c.links).map(c => ({ name: c.label, value: c.links, color: CAT_COLOR[c.key] }))} center={t.overall != null ? `${t.overall}%` : '—'} sub="Toxic" />
            <ul className="flex-1 space-y-2.5 text-13">{rp.categories.filter(c => c.key !== 'unknown' || c.links).map(c => <li key={c.key} className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CAT_COLOR[c.key] }} /><span className="flex-1 text-slate-800">{c.label}</span><span className="tabular-nums text-slate-500">{pct(c.links, total)}</span><span className="tabular-nums text-indigo-700 w-12 text-right">{kfmt(c.links)}</span></li>)}</ul></div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] gap-3">
        <Card pad={false}>
          <div className="px-5 pt-3 flex gap-5 border-b border-slate-200" role="tablist">{[['domains', 'Referring domains'], ['links', 'Backlinks'], ['anchors', 'Anchors']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`pb-2.5 -mb-px text-13.5 font-medium cursor-pointer border-b-2 ${tab === k ? 'border-indigo-500 text-slate-900 font-semibold' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{l}</button>)}</div>
          <div className="overflow-x-auto">
            {tab === 'domains' && <table className="w-full text-13"><thead className="text-12 text-slate-500"><tr><th className="px-5 py-2 text-left font-medium">Domain</th><th className="px-3 py-2  font-medium" title="Our Authority Score of the site, 0 to 100">Authority Score</th><th className="px-3 py-2  font-medium" title="Moz spam score, a percentage">Spam Score</th><th className="px-3 py-2 text-left font-medium">Toxicity Score</th><th className="px-5 py-2 text-right font-medium">Actions</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{pager.rows.map(x => {
                const [l, bgc, fg] = BAND[x.band]; return <tr key={x.domain} className="hover:bg-slate-50"><td className="px-5 py-2.5"><a href={`https://${x.domain}`} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">{x.domain}</a><span className="ml-2 text-11.5 text-slate-400">{fmt(x.links)} link{x.links === 1 ? '' : 's'}</span></td>
                  <td className="px-3 py-2.5  tabular-nums">{x.authority ?? '—'}</td><td className="px-3 py-2.5  tabular-nums">{x.spam != null ? `${x.spam}%` : '—'}</td>
                  <td className="px-3 py-2.5"><span className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-12 font-semibold" style={{ backgroundColor: bgc, color: fg }} title={x.reason || undefined}>{l}{x.toxicity != null && <span className="font-normal">{x.toxicity}</span>}</span></td>
                  <td className="px-5 py-2.5 text-right whitespace-nowrap"><span className="inline-flex gap-3"><Link to={`/backlinks/links?q=${encodeURIComponent(x.domain)}`} className="text-slate-500 hover:text-indigo-700" title="See its links" aria-label={`See the links from ${x.domain}`}><Link2 size={15} /></Link><a href={`https://${x.domain}`} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-indigo-700" title="Open the site" aria-label={`Open ${x.domain}`}><ExternalLink size={15} /></a></span></td></tr>;
              })}</tbody></table>}
            {tab === 'links' && <table className="w-full text-13"><thead className="text-12 text-slate-500"><tr><th className="px-5 py-2 text-left font-medium">Linking page</th><th className="px-3 py-2 text-left font-medium">Anchor</th><th className="px-3 py-2 text-left font-medium">Follow</th><th className="px-5 py-2 text-left font-medium">Toxicity</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{pager.rows.map(g => {
                const RISK = ['toxic', 'potential', 'unknown', 'clean'];
                const worst = RISK.find(r => g.links.some(x => x.band === r)) || 'unknown';
                const [gl, gbg, gfg] = BAND[worst];
                const many = g.links.length > 1;
                const isOpen = openSites.has(g.domain);
                const follows = g.links.filter(x => x.follow === 'dofollow').length;
                const pageRow = (x, i, child) => { const [l, bgc, fg] = BAND[x.band]; return <tr key={`${g.domain}-${i}`} className="hover:bg-slate-50"><td className={`px-5 py-2.5 max-w-[300px] truncate ${child ? 'pl-12 border-l-2 border-indigo-100' : ''}`}><a href={x.source_url} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline" title={x.source_url}>{x.source_url.replace(/^https?:\/\/(www\.)?/, '')}</a></td><td className="px-3 py-2.5 max-w-[200px] truncate text-slate-600" title={x.anchor || ''}>{x.anchor || '—'}</td><td className="px-3 py-2.5 text-slate-600">{x.follow === 'dofollow' ? 'Follow' : 'Nofollow'}</td><td className="px-5 py-2.5"><span className="rounded px-2 py-0.5 text-12 font-semibold" style={{ backgroundColor: bgc, color: fg }}>{l}</span></td></tr>; };
                if (!many) return pageRow(g.links[0], 0, false);
                return <React.Fragment key={g.domain}>
                  <tr className="bg-slate-50/60 hover:bg-slate-100/70 cursor-pointer" onClick={() => toggleSite(g.domain)} aria-expanded={isOpen}>
                    <td className="px-5 py-2.5 max-w-[300px]"><span className="inline-flex items-center gap-1.5 max-w-full"><button type="button" onClick={(e) => { e.stopPropagation(); toggleSite(g.domain); }} aria-label={`${isOpen ? 'Hide' : 'Show'} the ${g.links.length} links from ${g.domain}`} className="grid h-5 w-5 shrink-0 place-items-center rounded text-slate-500 hover:bg-slate-200">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button><span className="truncate font-semibold text-slate-800">{g.domain}</span><span className="shrink-0 text-12 text-slate-400">{g.links.length} pages</span></span></td>
                    <td className="px-3 py-2.5 text-12 text-slate-400">{isOpen ? '' : 'Open to see each page'}</td>
                    <td className="px-3 py-2.5 text-12 text-slate-500 whitespace-nowrap">{follows}/{g.links.length} follow</td>
                    <td className="px-5 py-2.5"><span className="rounded px-2 py-0.5 text-12 font-semibold" style={{ backgroundColor: gbg, color: gfg }}>{gl}</span></td>
                  </tr>
                  {isOpen && g.links.map((x, i) => pageRow(x, i, true))}
                </React.Fragment>;
              })}</tbody></table>}
            {tab === 'anchors' && <table className="w-full text-13"><thead className="text-12 text-slate-500"><tr><th className="px-5 py-2 text-left font-medium">Anchor text</th><th className="px-3 py-2  font-medium">Backlinks</th><th className="px-5 py-2 text-right font-medium">Domains</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{pager.rows.map((x, i) => <tr key={i} className="hover:bg-slate-50"><td className="px-5 py-2.5 max-w-[420px] truncate" title={x.text}>{x.text}</td><td className="px-3 py-2.5  tabular-nums text-indigo-700">{fmt(x.count)}</td><td className="px-5 py-2.5  tabular-nums">{fmt(x.domains)}</td></tr>)}</tbody></table>}
            {rows.length === 0 && <p className="px-5 py-8 text-center text-13 text-slate-500">Nothing to show yet.</p>}
          </div>
          <div className="border-t border-slate-100 flex items-center justify-between pr-5"><Pager p={pager} label="rows" /><Link to={tab === 'anchors' ? '/backlinks/anchors' : tab === 'links' ? '/backlinks/links' : '/backlinks/domains'} className="text-13 font-semibold text-indigo-700 hover:underline">View all {tab === 'domains' ? 'referring domains' : tab === 'links' ? 'backlinks' : 'anchors'} →</Link></div>
        </Card>

        <Card title="Recommended actions" subtitle="What to do about what the audit found">
          <ul className="divide-y divide-slate-100 -my-1">
            <li className="py-3 flex items-start gap-3"><AlertTriangle size={18} className="mt-0.5 text-rose-600 shrink-0" /><div className="flex-1 min-w-0"><div className="text-13.5 font-semibold text-slate-900">Remove toxic backlinks</div><div className="text-12.5 text-slate-500">{fmt(t.toxic_links)} toxic backlink{t.toxic_links === 1 ? '' : 's'} found, from {t.toxic_domains} site{t.toxic_domains === 1 ? '' : 's'}.</div></div><Link to="/backlinks/links?useful=risky"><Button size="sm" variant="primary">Review toxic links</Button></Link></li>
            <li className="py-3 flex items-start gap-3"><AlertTriangle size={18} className="mt-0.5 text-amber-500 shrink-0" /><div className="flex-1 min-w-0"><div className="text-13.5 font-semibold text-slate-900">Disavow low-quality links</div><div className="text-12.5 text-slate-500">{fmt(t.potential_links)} potentially toxic backlinks. Download a list for Google's Disavow tool.</div>
              <label className="mt-1.5 inline-flex items-center gap-1.5 text-12 text-slate-600 cursor-pointer"><input type="checkbox" checked={withPotential} onChange={e => setWithPotential(e.target.checked)} />Include the potentially toxic ({rp.disavow.potential.length} sites)</label></div>
              <Button size="sm" icon={Download} onClick={downloadDisavow} disabled={!rp.disavow.toxic.length && !(withPotential && rp.disavow.potential.length)}>Review &amp; disavow</Button></li>
            <li className="py-3 flex items-start gap-3"><BellRing size={18} className="mt-0.5 text-sky-600 shrink-0" /><div className="flex-1 min-w-0"><div className="text-13.5 font-semibold text-slate-900">Monitor new backlinks</div><div className="text-12.5 text-slate-500">{t.new_30d} new in 30 days. Check new links often; the weekly and monthly reports list the links gained and lost.</div></div><Link to="/backlinks/links"><Button size="sm">See new links</Button></Link></li>
          </ul>
        </Card>
      </div>

      <div className="rounded-xl bg-sky-50/70 ring-1 ring-sky-100 px-5 py-4">
        <button type="button" onClick={() => setBasis(v => !v)} aria-expanded={basis} className="w-full flex items-center justify-between gap-3 text-left cursor-pointer"><span className="flex items-center gap-2 text-14 font-semibold text-slate-900"><Info size={16} className="text-sky-600" />On which basis do we find this data?</span><span className="text-12.5 font-semibold text-indigo-700">{basis ? 'Hide' : 'Show'}</span></button>
        {basis && (
          <ul className="mt-3 grid md:grid-cols-2 gap-x-8 gap-y-2.5 text-13 text-slate-700">
            {[['Referring domains and backlinks', "Counted from the links our own backlink crawler has found and re-checked on the pages that carry them. A link is live while a later check still finds it."],
            ['Toxicity score of a site', "Our own risk reading of the site (relevance to your business, spam and unnatural patterns, AI or rules) together with Moz's spam score. Toxic from 60, potentially toxic from 30."],
            ['Overall toxicity score', 'The share of your live links that come from toxic sites. Low under 30%, medium 30 to 59%, high 60% or more. A site that gives many links counts for each.'],
            ['Authority Score', "Our own 0 to 100 score from Moz: how many sites link to the site, their Domain Authority, and its spam score."],
            ['Spam score', "Moz's spam score of the site, through Apify: the percentage of similar sites banned or penalised."],
            ['Follow and nofollow, link types', 'Read from the link as it is written on the page: rel="nofollow", "sponsored" or "ugc" make it nofollow; the anchor shows whether it is text, a web address or an image.']].map(([h, x]) => <li key={h} className="flex gap-2.5"><CheckCircle2 size={16} className="mt-0.5 text-emerald-600 shrink-0" /><span><b className="text-slate-900">{h}:</b> {x}</span></li>)}
          </ul>
        )}
      </div>
      {toastNode}
    </div>
  );
}
