import React, { useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, ScatterChart, Scatter, PieChart, Pie, Cell, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { Loader2, RefreshCw, ExternalLink, PlugZap, Database, Download, AlertTriangle, Inbox } from 'lucide-react';
import { Card, Badge, Button } from './SeoUi';
import { fmt } from './seoApi';

/**
 * The Semrush-style sections of the Domain Overview, from DataForSEO (GET /businesses/{id}/seo/domain-intel).
 * A section whose call failed shows the provider's error; with no data source it shows what is needed. Figures are never estimated here.
 */

const INTENT = { informational: ['I', '#6658dd', 'Informational'], navigational: ['N', '#a855f7', 'Navigational'], commercial: ['C', '#f59e0b', 'Commercial'], transactional: ['T', '#1abc9c', 'Transactional'], unknown: ['?', '#94a3b8', 'Unclassified'] };
const BUCKETS = [['top3', 'Top 3', '#f59e0b'], ['p4_10', '4-10', '#4338ca'], ['p11_20', '11-20', '#6366f1'], ['p21_50', '21-50', '#a5b4fc'], ['p51_100', '51-100', '#c7d2fe']];
const AXIS = { fontSize: 11, fill: '#64748b' };
const Th = ({ children, c = 'text-left' }) => <th className={`px-4 py-2.5 font-semibold whitespace-nowrap ${c}`}>{children}</th>;
const flag = (code) => (/^[A-Z]{2}$/.test(code || '') ? String.fromCodePoint(...[...code].map(c => 127397 + c.charCodeAt(0))) : '🌐');
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } };
const path = (u) => { try { const x = new URL(u); return x.pathname + x.search || '/'; } catch (e) { return u; } };
const usd = (n) => (n == null ? '—' : `$${Number(n).toFixed(2)}`);
const num1 = (n) => (n == null ? '—' : Number(n) >= 100 ? fmt(Math.round(n)) : String(Math.round(n * 10) / 10));

/** The data of one section, or why there is none. */
export function section(intel, key) {
  const s = intel?.[key];
  if (!intel || intel.state !== 'ok') return { data: null, why: null, off: true };
  if (!s) return { data: null, why: 'Not returned', off: false };
  if (!s.ok) return { data: null, why: s.error, off: false };
  return { data: s.data, why: null, off: false };
}

function Empty({ intel, why, off, noun = 'data' }) {
  const text = off ? (intel?.state === 'not_configured' ? 'Needs DataForSEO (see the note above).' : intel?.state === 'no_website' ? 'Needs a real website address.' : intel?.state === 'needs_approval' ? 'Approve this client first.' : 'Loading…')
    : why ? why : `No ${noun} found for this domain in ${intel?.country_name || 'this market'}.`;
  const bad = !off && why;
  return (
    <div className="py-10 flex flex-col items-center text-center gap-2 text-13 text-slate-500">
      {bad ? <AlertTriangle size={22} className="text-amber-500" /> : <Inbox size={22} className="text-slate-300" />}
      <span className="max-w-xs">{text}</span>
    </div>
  );
}

function Panel({ intel, k, title, subtitle, className = '', pad = false, noun, children, action }) {
  const { data, why, off } = section(intel, k);
  const hasData = data != null && !(Array.isArray(data) && !data.length);
  return (
    <Card className={className} title={title} subtitle={subtitle} pad={pad} action={action}>
      {hasData ? children(data) : <Empty intel={intel} why={why} off={off} noun={noun} />}
    </Card>
  );
}

const csv = (name, head, rows) => {
  const text = [head, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  Object.assign(document.createElement('a'), { href, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
};

/** Source banner: what is connected, the market, when it was fetched. */
export function IntelBar({ intel, loading, market, setMarket, onRefresh, refreshing }) {
  if (!intel) return <div className="py-6 flex justify-center text-slate-400"><Loader2 size={16} className="animate-spin" /></div>;
  const when = intel.fetched_at ? new Date(intel.fetched_at).toLocaleString() : null;
  if (intel.state !== 'ok') {
    const msg = {
      not_configured: ['Connect DataForSEO to fill the sections below', 'Authority score, estimated traffic, keywords, competitors, ads, backlinks and the history charts come from DataForSEO. Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to backend/.env and restart the backend.'],
      no_website: ['Add the real website first', 'The sections below are looked up by domain, and this business has no real website address.'],
      needs_approval: ['Approve this client first', 'Data credits are not spent on a client that is waiting for approval.']
    }[intel.state] || ['Not available', ''];
    return (
      <div className="rounded bg-violet-50 ring-1 ring-inset ring-violet-200 px-5 py-4 flex flex-wrap items-center gap-4">
        <span className="w-10 h-10 rounded-full bg-white text-violet-500 flex items-center justify-center shrink-0"><PlugZap size={18} /></span>
        <div className="flex-1 min-w-[260px]"><div className="text-14 font-semibold text-violet-900">{msg[0]}</div><p className="text-12.5 text-violet-800 mt-0.5">{msg[1]}</p></div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 text-12.5 text-slate-600">
      {intel.mock ? <Badge tone="amber" title="DOMAIN_INTEL_MOCK is on in backend/.env"><AlertTriangle size={11} />Sample data: not real</Badge> : <span className="inline-flex items-center gap-1.5"><Database size={13} className="text-slate-400" />Source: DataForSEO</span>}
      {intel.markets.length > 1 && (
        <select value={market || intel.country} onChange={e => setMarket(e.target.value)} className="h-8 px-2 text-12.5 rounded border border-slate-200 bg-white cursor-pointer" aria-label="Market">
          {intel.markets.map(m => <option key={m.code} value={m.code}>{flag(m.code)} {m.name}</option>)}
        </select>
      )}
      {intel.markets.length <= 1 && <span>{flag(intel.country)} {intel.country_name}</span>}
      {when && !intel.mock && <span className="text-slate-400">Fetched {when}{intel.cached ? ' (saved copy)' : ''}</span>}
      <Button size="sm" icon={RefreshCw} busy={refreshing || loading} onClick={onRefresh} className="ml-auto">Refresh data</Button>
    </div>
  );
}

function History({ intel }) {
  const [show, setShow] = useState({ traffic: true, paid_traffic: false });
  const [range, setRange] = useState(24);
  return (
    <Panel intel={intel} k="history" title="Traffic and keywords over time" subtitle="Estimated organic traffic and ranking keywords by month" pad noun="history">
      {(all) => {
        const rows = all.slice(-range);
        return (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-4 text-12.5">
              {[['traffic', 'Organic traffic', '#6658dd'], ['paid_traffic', 'Paid traffic', '#1abc9c']].map(([k, l, c]) => (
                <label key={k} className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700"><input type="checkbox" checked={show[k]} onChange={e => setShow(s => ({ ...s, [k]: e.target.checked }))} style={{ accentColor: c }} />{l}</label>
              ))}
              <div className="ml-auto flex gap-0.5 p-0.5 bg-slate-100 rounded">{[[6, '6M'], [12, '1Y'], [24, '2Y']].map(([n, l]) => <button key={n} type="button" onClick={() => setRange(n)} className={`h-7 px-2.5 text-12 font-semibold rounded cursor-pointer ${range === n ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>{l}</button>)}</div>
              <Button size="sm" icon={Download} onClick={() => csv(`${intel.domain}-history.csv`, ['month', 'organic traffic', 'organic keywords', 'paid traffic', 'paid keywords'], all.map(r => [r.date, r.traffic, r.keywords, r.paid_traffic, r.paid_keywords]))}>Export</Button>
            </div>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={rows} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" vertical={false} />
                  <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} minTickGap={28} />
                  <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
                  <Tooltip />
                  {show.paid_traffic && <Area type="monotone" dataKey="paid_traffic" name="Paid traffic" stroke="#1abc9c" strokeWidth={2} fill="#1abc9c" fillOpacity={0.12} dot={false} />}
                  {show.traffic && <Area type="monotone" dataKey="traffic" name="Organic traffic" stroke="#6658dd" strokeWidth={2.5} fill="#6658dd" fillOpacity={0.15} dot={false} />}
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div>
              <div className="text-13 font-semibold text-slate-800 mb-1">Keywords by position</div>
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={rows} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" vertical={false} />
                    <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} minTickGap={28} />
                    <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
                    <Tooltip /><Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    {[...BUCKETS].reverse().map(([k, l, c]) => <Area key={k} type="monotone" stackId="k" dataKey={k} name={l} stroke={c} fill={c} fillOpacity={0.85} dot={false} />)}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        );
      }}
    </Panel>
  );
}

function OrganicResearch({ intel }) {
  const [more, setMore] = useState(false);
  const kw = section(intel, 'keywords').data;
  const ov = section(intel, 'overview').data;
  const comp = section(intel, 'competitors').data || [];
  const maxCommon = Math.max(1, ...comp.map(c => c.common));
  const dist = ov ? BUCKETS.map(([k, l, c]) => ({ name: l, keywords: ov.organic[k], fill: c })) : [];
  const own = ov ? { domain: intel.domain, x: ov.organic.count, y: ov.organic.traffic, own: true } : null;
  const mapData = [...(own ? [own] : []), ...comp.map(c => ({ domain: c.domain, x: c.keywords, y: c.traffic }))];
  const palette = ['#6658dd', '#1abc9c', '#f59e0b', '#ef4444', '#8b5cf6', '#0ea5e9', '#84cc16'];
  const totalKw = (kw?.intents || []).reduce((s, i) => s + i.keywords, 0) || 1;
  const totalTr = (kw?.intents || []).reduce((s, i) => s + i.traffic, 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <Panel intel={intel} k="keywords" title={<span>Top organic keywords <span className="text-slate-400 font-normal">{kw ? fmt(kw.total) : ''}</span></span>} noun="organic keywords"
          action={kw && <Button size="sm" icon={Download} onClick={() => csv(`${intel.domain}-keywords.csv`, ['keyword', 'intent', 'position', 'volume', 'cpc', 'traffic', 'url'], kw.rows.map(r => [r.keyword, r.intent, r.position, r.volume, r.cpc, r.traffic, r.url]))}>Export</Button>}>
          {(d) => (
            <>
              <div className="overflow-auto" style={{ maxHeight: more ? 520 : 'none' }}>
                <table className="w-full text-13">
                  <thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>Keyword</Th><Th>Intent</Th><Th c="text-right">Pos.</Th><Th c="text-right">Volume</Th><Th c="text-right">CPC (USD)</Th><Th c="text-right">Traffic</Th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {d.rows.slice(0, more ? 100 : 5).map(r => {
                      const I = INTENT[(r.intent || 'unknown').toLowerCase()] || INTENT.unknown;
                      return (
                        <tr key={r.keyword + r.position} className="hover:bg-slate-50">
                          <td className="px-4 py-2.5 max-w-[240px] truncate text-indigo-700 font-medium" title={r.keyword}>{r.keyword}</td>
                          <td className="px-4 py-2.5"><span title={I[2]} className="inline-flex w-5 h-5 rounded text-[11px] font-bold items-center justify-center text-white" style={{ background: I[1] }}>{I[0]}</span></td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{r.position ?? '—'}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{r.volume != null ? fmt(r.volume) : '—'}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{r.cpc != null ? r.cpc.toFixed(2) : '—'}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-indigo-700">{num1(r.traffic)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {d.rows.length > 5 && <div className="p-4"><Button size="sm" onClick={() => setMore(m => !m)}>{more ? 'Show fewer' : `View details (${d.rows.length})`}</Button></div>}
            </>
          )}
        </Panel>

        <Card title="Keywords by intent" subtitle={kw ? `The top ${kw.rows.length} keywords by traffic` : undefined}>
          {kw?.intents?.length ? (
            <>
              <div className="flex h-3 rounded-full overflow-hidden bg-slate-100 mb-4">{kw.intents.map(i => <span key={i.intent} title={`${(INTENT[i.intent] || INTENT.unknown)[2]}: ${i.keywords}`} style={{ width: `${(i.keywords / totalKw) * 100}%`, background: (INTENT[i.intent] || INTENT.unknown)[1] }} />)}</div>
              <table className="w-full text-13">
                <thead className="text-11.5 text-slate-500"><tr><Th>Intent</Th><Th c="text-right">Keywords</Th><Th c="text-right">Share</Th><Th c="text-right">Traffic</Th></tr></thead>
                <tbody className="divide-y divide-slate-100">{kw.intents.map(i => { const m = INTENT[i.intent] || INTENT.unknown; return (
                  <tr key={i.intent}><td className="px-4 py-2"><span className="inline-block w-2.5 h-2.5 rounded-full mr-2" style={{ background: m[1] }} />{m[2]}</td><td className="px-4 py-2 text-right tabular-nums text-indigo-700">{i.keywords}</td><td className="px-4 py-2 text-right tabular-nums">{Math.round((i.keywords / totalKw) * 1000) / 10}%</td><td className="px-4 py-2 text-right tabular-nums">{totalTr ? `${Math.round((i.traffic / totalTr) * 100)}%` : '—'}</td></tr>); })}</tbody>
              </table>
            </>
          ) : <Empty intel={intel} why={section(intel, 'keywords').why} off={section(intel, 'keywords').off} noun="keywords" />}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <Card title="Organic position distribution" subtitle="Keywords by where they rank on Google">
          {ov && ov.organic.count ? (
            <div className="h-60"><ResponsiveContainer width="100%" height="100%"><BarChart data={dist} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}><CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" vertical={false} /><XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={false} /><YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={44} /><Tooltip /><Bar dataKey="keywords" name="Keywords" radius={[4, 4, 0, 0]}>{dist.map(x => <Cell key={x.name} fill={x.fill} />)}</Bar></BarChart></ResponsiveContainer></div>
          ) : <Empty intel={intel} why={section(intel, 'overview').why} off={section(intel, 'overview').off} noun="ranking keywords" />}
        </Card>
        <Card title="Top pages" subtitle="Pages that bring the most estimated organic traffic" pad={false}>
          {section(intel, 'pages').data?.length ? (
            <table className="w-full text-13"><thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>Page</Th><Th c="text-right">Keywords</Th><Th c="text-right">Traffic</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">{section(intel, 'pages').data.slice(0, 8).map(p => <tr key={p.url} className="hover:bg-slate-50"><td className="px-4 py-2.5 max-w-[300px] truncate"><a href={p.url} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline inline-flex items-center gap-1">{path(p.url)}<ExternalLink size={10} /></a></td><td className="px-4 py-2.5 text-right tabular-nums">{fmt(p.keywords)}</td><td className="px-4 py-2.5 text-right tabular-nums text-indigo-700">{num1(p.traffic)}</td></tr>)}</tbody></table>
          ) : <Empty intel={intel} why={section(intel, 'pages').why} off={section(intel, 'pages').off} noun="pages" />}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <Card title={<span>Main organic competitors <span className="text-slate-400 font-normal">{comp.length || ''}</span></span>} pad={false}>
          {comp.length ? (
            <table className="w-full text-13"><thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>Competitor</Th><Th>Com. level</Th><Th c="text-right">Com. keywords</Th><Th c="text-right">SE keywords</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">{comp.slice(0, 8).map(c => <tr key={c.domain} className="hover:bg-slate-50"><td className="px-4 py-2.5"><a href={`https://${c.domain}`} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline inline-flex items-center gap-1">{c.domain}<ExternalLink size={10} /></a></td><td className="px-4 py-2.5 w-28"><span className="block h-1.5 rounded-full bg-slate-100 overflow-hidden"><span className="block h-full bg-indigo-400" style={{ width: `${(c.common / maxCommon) * 100}%` }} /></span></td><td className="px-4 py-2.5 text-right tabular-nums">{fmt(c.common)}</td><td className="px-4 py-2.5 text-right tabular-nums text-indigo-700">{fmt(c.keywords)}</td></tr>)}</tbody></table>
          ) : <Empty intel={intel} why={section(intel, 'competitors').why} off={section(intel, 'competitors').off} noun="competitors" />}
        </Card>
        <Card title="Competitive positioning map" subtitle="Organic keywords (across) against estimated organic traffic (up)">
          {mapData.length > 1 ? (
            <div className="h-64"><ResponsiveContainer width="100%" height="100%"><ScatterChart margin={{ top: 8, right: 16, left: -4, bottom: 8 }}><CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" /><XAxis type="number" dataKey="x" name="Organic keywords" tick={AXIS} tickLine={false} axisLine={false} /><YAxis type="number" dataKey="y" name="Traffic" tick={AXIS} tickLine={false} axisLine={false} width={44} /><ZAxis range={[90, 90]} /><Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ payload }) => payload?.[0] ? <div className="bg-white border border-slate-200 rounded px-2.5 py-1.5 text-12"><b>{payload[0].payload.domain}</b><div>{fmt(payload[0].payload.x)} keywords · {num1(payload[0].payload.y)} traffic</div></div> : null} /><Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              {mapData.map((m, i) => <Scatter key={m.domain} name={m.domain} data={[m]} fill={m.own ? '#6658dd' : palette[(i % (palette.length - 1)) + 1]} />)}</ScatterChart></ResponsiveContainer></div>
          ) : <Empty intel={intel} why={section(intel, 'competitors').why} off={section(intel, 'competitors').off} noun="competitors to plot" />}
        </Card>
      </div>
    </div>
  );
}

function Advertising({ intel }) {
  const pk = section(intel, 'paid_keywords');
  const pc = section(intel, 'paid_competitors');
  const ov = section(intel, 'overview').data;
  const none = intel?.state === 'ok' && ov && !ov.paid.count;
  const Nothing = <Empty intel={intel} why={none ? null : pk.why} off={pk.off} noun="paid keywords" />;
  const rows = pk.data?.rows || [];
  const dist = ov ? BUCKETS.map(([k, l, c]) => ({ name: l, keywords: ov.paid[k], fill: c })) : [];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <Card title="Top paid keywords" pad={false}>
          {rows.length ? (
            <table className="w-full text-13"><thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>Keyword</Th><Th c="text-right">Pos.</Th><Th c="text-right">Volume</Th><Th c="text-right">CPC (USD)</Th><Th c="text-right">Traffic</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">{rows.slice(0, 6).map(r => <tr key={r.keyword + r.position}><td className="px-4 py-2.5 max-w-[220px] truncate text-indigo-700 font-medium">{r.keyword}</td><td className="px-4 py-2.5 text-right tabular-nums">{r.position ?? '—'}</td><td className="px-4 py-2.5 text-right tabular-nums">{r.volume != null ? fmt(r.volume) : '—'}</td><td className="px-4 py-2.5 text-right tabular-nums">{usd(r.cpc)}</td><td className="px-4 py-2.5 text-right tabular-nums">{num1(r.traffic)}</td></tr>)}</tbody></table>
          ) : Nothing}
        </Card>
        <Card title="Paid position distribution">
          {ov && ov.paid.count ? <div className="h-56"><ResponsiveContainer width="100%" height="100%"><BarChart data={dist} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}><CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" vertical={false} /><XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={false} /><YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={44} /><Tooltip /><Bar dataKey="keywords" name="Keywords" radius={[4, 4, 0, 0]}>{dist.map(x => <Cell key={x.name} fill={x.fill} />)}</Bar></BarChart></ResponsiveContainer></div> : Nothing}
        </Card>
        <Card title="Main paid competitors" pad={false}>
          {pc.data?.length ? (
            <table className="w-full text-13"><thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>Competitor</Th><Th c="text-right">Com. keywords</Th><Th c="text-right">Ad keywords</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">{pc.data.slice(0, 6).map(c => <tr key={c.domain}><td className="px-4 py-2.5 text-indigo-700">{c.domain}</td><td className="px-4 py-2.5 text-right tabular-nums">{fmt(c.common)}</td><td className="px-4 py-2.5 text-right tabular-nums">{fmt(c.keywords)}</td></tr>)}</tbody></table>
          ) : Nothing}
        </Card>
        <Card title="Sample text ads">
          {rows.some(r => r.title) ? (
            <div className="space-y-3">{rows.filter(r => r.title).slice(0, 3).map(r => <div key={r.keyword} className="rounded border border-slate-200 p-3"><div className="text-11.5 text-slate-500">Ad · {r.url ? host(r.url) : ''}</div><div className="text-14 font-semibold text-indigo-700">{r.title}</div><div className="text-12.5 text-slate-600">{r.description}</div><div className="text-11 text-slate-400 mt-1">Keyword: {r.keyword}</div></div>)}</div>
          ) : Nothing}
        </Card>
      </div>
    </div>
  );
}

function Backlinks({ intel }) {
  const links = section(intel, 'links').data;
  const list = section(intel, 'backlinks');
  const anc = section(intel, 'anchors');
  const refs = section(intel, 'ref_domains');
  const idx = section(intel, 'indexed_pages');
  const total = links ? links.follow + links.nofollow : 0;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
        <Card className="xl:col-span-2" title="Backlinks" pad={false}
          action={list.data?.length ? <Button size="sm" icon={Download} onClick={() => csv(`${intel.domain}-backlinks.csv`, ['referring page title', 'referring url', 'anchor', 'target url', 'follow'], list.data.map(r => [r.title, r.url_from, r.anchor, r.url_to, r.follow ? 'follow' : 'nofollow']))}>Export</Button> : null}>
          {list.data?.length ? (
            <div className="overflow-auto max-h-[330px]">
              <table className="w-full text-13"><thead className="sticky top-0 bg-slate-50 text-11.5 text-slate-500"><tr><Th>Referring page</Th><Th>Anchor text / target</Th><Th c="text-right">Type</Th></tr></thead>
                <tbody className="divide-y divide-slate-100">{list.data.map((r, i) => (
                  <tr key={r.url_from + i} className="hover:bg-slate-50 align-top">
                    <td className="px-4 py-2.5 max-w-[320px]"><div className="truncate font-medium text-slate-900" title={r.title}>{r.title || host(r.url_from)}</div><a href={r.url_from} target="_blank" rel="noreferrer" className="text-12 text-indigo-700 hover:underline block truncate">{r.url_from}</a></td>
                    <td className="px-4 py-2.5 max-w-[300px]"><div className="truncate text-slate-800" title={r.anchor}>{r.anchor || '—'}</div><div className="text-12 text-slate-500 truncate">{r.url_to}</div></td>
                    <td className="px-4 py-2.5 text-right"><Badge tone={r.follow ? 'green' : 'gray'}>{r.follow ? 'follow' : 'nofollow'}</Badge></td>
                  </tr>))}</tbody></table>
            </div>
          ) : <Empty intel={intel} why={list.why} off={list.off} noun="backlinks" />}
        </Card>
        <div className="space-y-4">
          <Card title="Follow vs nofollow">
            {links && total ? (
              <div className="flex items-center gap-4">
                <div className="w-28 h-28"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={[{ n: 'Follow', v: links.follow }, { n: 'Nofollow', v: links.nofollow }]} dataKey="v" innerRadius={34} outerRadius={52} stroke="none"><Cell fill="#8b5cf6" /><Cell fill="#e9d5ff" /></Pie></PieChart></ResponsiveContainer></div>
                <div className="text-13 space-y-1"><div><span className="inline-block w-2.5 h-2.5 rounded-full bg-violet-500 mr-2" />Follow links <b className="tabular-nums">{fmt(links.follow)}</b></div><div><span className="inline-block w-2.5 h-2.5 rounded-full bg-violet-200 mr-2" />Nofollow links <b className="tabular-nums">{fmt(links.nofollow)}</b></div></div>
              </div>
            ) : <Empty intel={intel} why={section(intel, 'links').why} off={section(intel, 'links').off} noun="links" />}
          </Card>
          <Card title="Backlink types">
            {links?.types?.length ? <div className="space-y-2.5">{links.types.map(t => <div key={t.type} className="flex items-center gap-3 text-13"><span className="w-16 text-slate-700">{t.type}</span><span className="flex-1 h-2 rounded-full bg-violet-100 overflow-hidden"><span className="block h-full bg-violet-500" style={{ width: `${Math.min(100, t.share)}%` }} /></span><span className="w-10 text-right tabular-nums text-slate-500">{t.share}%</span><span className="w-14 text-right tabular-nums text-indigo-700">{fmt(t.count)}</span></div>)}</div>
              : <Empty intel={intel} why={section(intel, 'links').why} off={section(intel, 'links').off} noun="link types" />}
          </Card>
        </div>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <Card title="Anchors" pad={false}>
          {anc.data?.length ? <table className="w-full text-13"><thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>Anchor</Th><Th c="text-right">Domains</Th><Th c="text-right">Backlinks</Th></tr></thead><tbody className="divide-y divide-slate-100">{anc.data.slice(0, 8).map(a => <tr key={a.anchor}><td className="px-4 py-2.5 max-w-[320px] truncate" title={a.anchor}>{a.anchor}</td><td className="px-4 py-2.5 text-right tabular-nums text-indigo-700">{fmt(a.domains)}</td><td className="px-4 py-2.5 text-right tabular-nums text-indigo-700">{fmt(a.backlinks)}</td></tr>)}</tbody></table>
            : <Empty intel={intel} why={anc.why} off={anc.off} noun="anchors" />}
        </Card>
        <Card title="Root domains" pad={false}>
          {refs.data?.length ? <table className="w-full text-13"><thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>Root domain</Th><Th>Country</Th><Th c="text-right">Authority</Th><Th c="text-right">Backlinks</Th></tr></thead><tbody className="divide-y divide-slate-100">{refs.data.slice(0, 8).map(r => <tr key={r.domain}><td className="px-4 py-2.5"><a href={`https://${r.domain}`} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline inline-flex items-center gap-1">{r.domain}<ExternalLink size={10} /></a></td><td className="px-4 py-2.5">{r.country ? `${flag(r.country)} ${r.country}` : '—'}</td><td className="px-4 py-2.5 text-right tabular-nums">{r.authority}</td><td className="px-4 py-2.5 text-right tabular-nums text-indigo-700">{fmt(r.backlinks)}</td></tr>)}</tbody></table>
            : <Empty intel={intel} why={refs.why} off={refs.off} noun="referring domains" />}
        </Card>
      </div>
      <Card title="Indexed pages" subtitle="Pages of this domain that other sites link to" pad={false}>
        {idx.data?.length ? <table className="w-full text-13"><thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>Title and URL</Th><Th c="text-right">Domains</Th><Th c="text-right">Backlinks</Th></tr></thead><tbody className="divide-y divide-slate-100">{idx.data.map(p => <tr key={p.url} className="hover:bg-slate-50"><td className="px-4 py-2.5 max-w-[560px]"><div className="truncate text-slate-900">{p.title || '-'}</div><a href={p.url} target="_blank" rel="noreferrer" className="text-12 text-indigo-700 hover:underline block truncate">{p.url}</a></td><td className="px-4 py-2.5 text-right tabular-nums text-indigo-700">{fmt(p.domains)}</td><td className="px-4 py-2.5 text-right tabular-nums text-indigo-700">{fmt(p.backlinks)}</td></tr>)}</tbody></table>
          : <Empty intel={intel} why={idx.why} off={idx.off} noun="indexed pages" />}
      </Card>
    </div>
  );
}

function Markets({ intel }) {
  const rows = intel?.state === 'ok' ? intel.by_country || [] : [];
  return (
    <Card title="Keywords and traffic by market" subtitle="Estimated, in each country this business targets" pad={false}>
      {rows.length ? (
        <table className="w-full text-13"><thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>Country</Th><Th c="text-right">Organic keywords</Th><Th c="text-right">Organic traffic</Th><Th c="text-right">Paid keywords</Th><Th c="text-right">Paid traffic</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map(r => <tr key={r.code}><td className="px-4 py-2.5 font-medium text-slate-900">{flag(r.code)} {r.name}</td>{r.error ? <td colSpan={4} className="px-4 py-2.5 text-amber-700">{r.error}</td> : <>
            <td className="px-4 py-2.5 text-right tabular-nums text-indigo-700">{fmt(r.organic.count)}</td><td className="px-4 py-2.5 text-right tabular-nums">{num1(r.organic.traffic)}</td><td className="px-4 py-2.5 text-right tabular-nums">{fmt(r.paid.count)}</td><td className="px-4 py-2.5 text-right tabular-nums">{num1(r.paid.traffic)}</td></>}</tr>)}</tbody></table>
      ) : <Empty intel={intel} off={intel?.state !== 'ok'} noun="market data" />}
    </Card>
  );
}

const Heading = ({ children, sub }) => <div className="pt-2"><h2 className="text-16 font-semibold text-slate-900">{children}</h2>{sub && <p className="text-12 text-slate-500">{sub}</p>}</div>;

/** The sections under the headline cards. */
export function IntelSections({ intel }) {
  return (
    <div className="space-y-4">
      <History intel={intel} />
      <Markets intel={intel} />
      <Heading sub="From Google results in the selected market">Organic research</Heading>
      <OrganicResearch intel={intel} />
      <Heading sub="Paid search: only when the domain runs Google Ads">Advertising research</Heading>
      <Advertising intel={intel} />
      <Heading sub="All links the index has found to this domain">Backlinks</Heading>
      <Backlinks intel={intel} />
      <p className="text-11.5 text-slate-400">{intel?.mock ? 'These figures are generated sample data for testing the layout. ' : ''}Traffic, paid figures and keyword positions are DataForSEO estimates built from Google results, so they will not match Search Console or another tool exactly. Authority score is DataForSEO&apos;s domain rank on a 0-100 scale.</p>
    </div>
  );
}

/** Figures for the headline card (null when not available). */
export function headline(intel) {
  const ov = section(intel, 'overview').data;
  const l = section(intel, 'links').data;
  return {
    authority: l ? l.authority : null, backlinks: l ? l.backlinks : null, referring: l ? l.referring_domains : null,
    organicTraffic: ov ? ov.organic.traffic : null, organicKeywords: ov ? ov.organic.count : null, paidTraffic: ov ? ov.paid.traffic : null, paidKeywords: ov ? ov.paid.count : null,
    why: intel?.state === 'ok' ? null : intel?.state === 'not_configured' ? 'Needs DataForSEO' : null
  };
}
