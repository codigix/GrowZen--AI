import React from 'react';
import { MapPin, Monitor, Smartphone, Tablet, Copy, Download, Printer, Plus, Trophy, Check, Globe } from 'lucide-react';
import { Card, Badge, Button, useAction } from './SeoUi';
import { api, useApi } from './seoApi';
import DataTable, { downloadCsv, downloadFile } from './DataTable';

export const SECTIONS = [['sec-landscape', 'Landscape'], ['sec-overview', 'Overview'], ['sec-distribution', 'Rankings Distribution'], ['sec-tags', 'Tags'], ['sec-pages', 'Pages'],
['sec-cannibal', 'Cannibalization'], ['sec-competitors', 'Competitors Discovery'], ['sec-devices', 'Devices & Locations'], ['sec-snippets', 'Featured Snippets']];

/** The small Export CSV button of a table with its own markup: put it next to the search box or the pager, and give it the FULL sorted and filtered list. */
export function CsvButton({ onClick, disabled = false, label = 'Export CSV', className = '', title = 'Download every row of this table (all pages, with the search and filters applied) as a CSV file' }) {
  return <button type="button" onClick={onClick} disabled={disabled} title={title} className={`h-8 px-3 inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white text-12.5 font-semibold text-slate-700 cursor-pointer hover:bg-slate-50 disabled:opacity-40 ${className}`}><Download size={13} />{label}</button>;
}

export const Anchor = ({ id }) => <span id={id} className="block scroll-mt-24" aria-hidden="true" />;

/** The tracked domain, where and on what device it is checked, and how many keywords and competitors are tracked. */
export function TrackingHeader({ d }) {
  const chip = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-50 border border-slate-200 text-12 text-slate-700';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={chip}><Globe size={12} />{d.domain}</span>
      <span className={chip}><MapPin size={12} />{d.country ? `${d.country} · ` : ''}{d.location || 'Google'}</span>
      <span className={chip}><Monitor size={12} />Desktop</span>
      <span className={chip}>Keywords: <b>{d.tracked}</b></span>
    </div>
  );
}

export const TABS = [['landscape', 'Landscape'], ['overview', 'Overview'], ['distribution', 'Rankings Distribution'], ['tags', 'Tags'], ['pages', 'Pages'],
['cannibal', 'Cannibalization'], ['devices', 'Devices & Locations']];

export function TabBar({ value, onChange }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto no-scrollbar border-b border-slate-200">
      {TABS.map(([id, label]) => (
        <button key={id} role="tab" aria-selected={value === id} type="button" onClick={() => onChange(id)}
          className={`px-3.5 py-2.5 text-13 font-semibold whitespace-nowrap border-b-2 -mb-px cursor-pointer ${value === id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>{label}</button>
      ))}
    </div>
  );
}

/** Copy the summary to the clipboard, or print the page to PDF. */
export function ExportButtons({ d, toast }) {
  const copy = () => {
    const text = [`Position tracking: ${d.domain}`, `${d.period.start} to ${d.period.end}`, ...d.summary.map(s => `- ${s}`)].join('\n');
    navigator.clipboard?.writeText(text).then(() => toast('Summary copied'));
  };
  return (
    <div className="flex gap-2">
      <Button size="sm" icon={Copy} onClick={copy}>Copy all</Button>
      <Button size="sm" icon={Download} onClick={() => downloadFile(`position-tracking-summary-${d.domain}-${new Date().toISOString().slice(0, 10)}.md`, `# Position tracking: ${d.domain}\n\n${d.period.start} to ${d.period.end}\n\n${d.summary.map(s => `- ${s}`).join('\n')}\n`, 'text/markdown')} title="Download the summary as a Markdown file">Download summary</Button>
      <Button size="sm" icon={Printer} onClick={() => window.print()}>PDF</Button>
    </div>
  );
}

export function ShareOfVoice({ d }) {
  const mine = d.share_of_voice?.value ?? 0;
  return (
    <Card title="Share of voice" subtitle="Your visibility as a share of all the visibility in these Google results">
      <div className="flex items-center gap-4">
        <div className="text-2xl font-bold text-slate-900 tabular-nums">{mine}%</div>
        <div className="flex-1">
          <div className="h-3 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, mine)}%` }} /></div>
          <div className="text-12 text-slate-500 mt-1.5">{d.share_of_voice?.domains ?? 0} domains share the results of your tracked keywords.</div>
        </div>
      </div>
    </Card>
  );
}

export function FeaturedSnippets({ d }) {
  const rows = d.snippets || [];
  return (
    <Card title="Featured snippets" subtitle="Keywords where Google shows a snippet, answer box or People-also-ask, and whether it is yours" pad={false}>
      {rows.length ? (
        <DataTable bare minWidth={0} rows={rows} rowKey={r => r.keyword} exportName={`featured-snippets-${d.domain}`} label="keywords" searchPlaceholder="Search keywords" columnsMenu={false}
          columns={[
            { id: 'keyword', header: 'Keyword', value: r => r.keyword, className: 'px-4 py-2.5', thClass: 'px-4 py-2.5' },
            { id: 'feature', header: 'Feature', value: r => r.feature, className: 'px-4 py-2.5 text-slate-600', thClass: 'px-4 py-2.5' },
            { id: 'rank', header: 'Your position', right: true, value: r => r.rank || null, cell: r => (r.rank ? `#${r.rank}` : '—'), className: 'px-4 py-2.5  tabular-nums', thClass: 'px-4 py-2.5' },
            { id: 'yours', header: 'Yours?', right: true, value: r => (r.yours ? 'Yes' : 'Opportunity'), cell: r => (r.yours ? <Badge tone="green"><Check size={11} /> Yes</Badge> : <Badge tone="amber">Opportunity</Badge>), className: 'px-4 py-2.5 text-right', thClass: 'px-4 py-2.5' },
          ]} />
      ) : <div className="py-8 text-center text-13 text-slate-500">No snippet or answer box was seen on the latest checks.</div>}
      {rows.some(r => !r.yours) && <p className="px-4 py-3 text-12 text-slate-500 border-t border-slate-100">To win one: add a 40-60 word direct answer under a question heading, plus FAQ schema, on the page that ranks.</p>}
    </Card>
  );
}

/** Domains that outrank you in the results, with a one-click way to track them as competitors. */
export function CompetitorsDiscovery({ d, b, onChanged }) {
  const [busy, error, run] = useAction();
  const tracked = new Set((d.tracked_competitors || []).map(u => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '')));
  const rivals = (d.competitors || []).filter(c => !c.you && c.domain).slice(0, 10);
  const add = (domain) => run(domain, async () => { await api(`/businesses/${b.id}/seo/track-competitor`, { method: 'POST', body: { domain } }); onChanged(); });
  return (
    <Card title="Competitors discovery" subtitle="Domains found in the Google results of your keywords"
      action={(d.competitors || []).some(c => !c.you && c.domain) && <Button size="sm" icon={Download} onClick={() => downloadCsv(`competitors-discovered-${d.domain}`, ['Domain', 'Keywords', 'Average position', 'Visibility (%)', 'Tracked as competitor'], (d.competitors || []).filter(c => !c.you && c.domain).map(c => [c.domain, c.keywords, c.avg_position ?? '', c.visibility ?? '', tracked.has(c.domain) ? 'Yes' : 'No']))} title="Download every domain found in the results (not only the first 10) as a CSV file">Export CSV</Button>}>
      {rivals.length ? (
        <ul className="divide-y divide-slate-100 -my-2">{rivals.map(c => (
          <li key={c.domain} className="flex items-center gap-3 py-2.5 text-13">
            <Trophy size={14} className="text-amber-500" />
            <span className="flex-1 min-w-0 truncate"><a href={`https://${c.domain}`} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">{c.domain}</a>
              <span className="text-slate-400"> · {c.keywords} keyword{c.keywords !== 1 ? 's' : ''} · avg #{c.avg_position} · {c.visibility}% visibility</span></span>
            {tracked.has(c.domain) ? <Badge tone="green">Tracked</Badge> : <Button size="sm" icon={Plus} busy={busy === c.domain} onClick={() => add(c.domain)}>Track</Button>}
          </li>))}
        </ul>
      ) : <div className="py-6 text-center text-13 text-slate-500">Competitors appear after the first position check.</div>}
      {error && <p className="text-12 text-rose-600 mt-2">{error}</p>}
    </Card>
  );
}

const DEV = { desktop: ['Desktop', Monitor], mobile: ['Mobile', Smartphone], tablet: ['Tablet', Tablet] };
const num = (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN'));
// + means mobile ranks lower on the page than desktop
const devDiff = (r) => { const dp = r.desktop?.position; const mp = r.mobile?.position; return dp != null && mp != null ? Math.round((mp - dp) * 10) / 10 : null; };

/** Where and on which device the site is shown: Search Console's position, impressions and clicks per device, then every keyword on desktop vs mobile. */
export function DevicesLocations({ d, b }) {
  const dev = useApi(b ? `/businesses/${b.id}/seo/device-positions` : null);
  const x = dev.data;
  const rows = x?.state === 'ok' ? Object.entries(x.keywords || {}).map(([k, v]) => ({ keyword: k, ...v })).sort((p, q) => ((q.mobile?.impressions || 0) + (q.desktop?.impressions || 0)) - ((p.mobile?.impressions || 0) + (p.desktop?.impressions || 0))) : [];
  const best = x?.state === 'ok' ? Object.entries(x.devices).filter(([, v]) => v.position != null).sort((p, q) => p[1].position - q[1].position)[0]?.[0] : null;
  return (
    <div className="space-y-4">
      <Card title="Devices & locations" subtitle="How the site is shown on each device (Google Search Console, last 28 days) and where Google is read from">
        {!x && !dev.error && <div className="h-24 rounded-lg bg-slate-100 animate-pulse" role="status" aria-busy="true" />}
        {dev.error && <p className="text-13 text-red-600">{dev.error.message}</p>}
        {x && x.state !== 'ok' && <p className="text-13 text-slate-600">{x.state === 'no_website' ? 'Add the project\'s website first.' : x.state === 'no_keywords' ? 'No keywords are tracked yet.' : x.state === 'needs_google' ? 'Link the Google account that owns this website to the project (Integrations) to read positions per device.' : x.message}</p>}
        {x?.state === 'ok' && (
          <div className="grid sm:grid-cols-3 gap-3">
            {Object.entries(DEV).map(([id, [label, Icon]]) => {
              const v = x.devices[id];
              const on = v.keywords > 0;
              return (
                <div key={id} className={`rounded-xl border p-4 ${on ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50/60'}`}>
                  <div className="flex items-center gap-2"><Icon size={18} className={on ? 'text-indigo-600' : 'text-slate-400'} /><span className="text-14 font-semibold text-slate-900">{label}</span>{best === id && <span className="ml-auto rounded-full bg-emerald-50 text-emerald-700 text-11 font-semibold px-2 py-0.5">best position</span>}</div>
                  {on ? (
                    <>
                      <div className="mt-3 flex items-end gap-2"><span className="text-26 font-bold text-slate-900 tabular-nums leading-none">{v.position}</span><span className="text-12 text-slate-500 pb-0.5">average position</span></div>
                      <dl className="mt-3 grid grid-cols-3 gap-2 text-12"><div><dt className="text-slate-500">Keywords</dt><dd className="font-semibold text-slate-800 tabular-nums">{v.keywords}</dd></div><div><dt className="text-slate-500">Impressions</dt><dd className="font-semibold text-slate-800 tabular-nums">{num(v.impressions)}</dd></div><div><dt className="text-slate-500">Clicks</dt><dd className="font-semibold text-slate-800 tabular-nums">{num(v.clicks)}{v.ctr != null && <span className="text-slate-400 font-normal"> · {v.ctr}%</span>}</dd></div></dl>
                    </>
                  ) : <p className="mt-3 text-12.5 text-slate-500">No impressions on {label.toLowerCase()} in the last 28 days.</p>}
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-3 rounded-xl border border-slate-200 p-4 flex items-center gap-3"><MapPin size={18} className="text-indigo-600" /><div className="flex-1"><div className="text-13 font-semibold text-slate-900">{d?.location || 'Target market'}{x?.country ? ` · ${x.country}` : ''}</div><div className="text-12.5 text-slate-500">Search Console positions are for searches from this country; Maps results are read around the business's pin.</div></div><span className="rounded-full bg-emerald-50 text-emerald-700 text-11.5 font-semibold px-2.5 py-1">Active</span></div>
      </Card>
      {rows.length > 0 && (
        <Card pad={false} title="Keywords by device" subtitle="Average position on desktop and on mobile for every tracked keyword that was shown">
          <DataTable bare minWidth={720} rows={rows} rowKey={r => r.keyword} exportName={`keywords-by-device-${d?.domain || 'site'}`} label="keywords" searchPlaceholder="Search keywords" columnsMenu={false}
            rowClass={() => 'hover:bg-slate-50'}
            columns={[
              { id: 'keyword', header: 'Keyword', value: r => r.keyword, className: 'px-4 py-2.5 font-semibold text-slate-900', thClass: 'px-4 py-2.5' },
              { id: 'desktop', header: 'Desktop', right: true, value: r => r.desktop?.position ?? null, cell: r => r.desktop?.position ?? <span className="text-slate-300">—</span>, className: 'px-4 py-2.5  tabular-nums', thClass: 'px-4 py-2.5' },
              { id: 'mobile', header: 'Mobile', right: true, value: r => r.mobile?.position ?? null, cell: r => r.mobile?.position ?? <span className="text-slate-300">—</span>, className: 'px-4 py-2.5  tabular-nums', thClass: 'px-4 py-2.5' },
              { id: 'diff', header: 'Difference', right: true, value: devDiff, cell: r => { const diff = devDiff(r); return diff == null ? <span className="text-slate-300">—</span> : diff === 0 ? <span className="text-slate-400">same</span> : <span className={diff > 0 ? 'text-red-600 font-semibold' : 'text-emerald-600 font-semibold'} title={diff > 0 ? 'Lower on mobile' : 'Higher on mobile'}>{diff > 0 ? '+' : ''}{diff}</span>; }, className: 'px-4 py-2.5  tabular-nums', thClass: 'px-4 py-2.5' },
              { id: 'imp', header: 'Impressions', right: true, value: r => (r.desktop?.impressions || 0) + (r.mobile?.impressions || 0) + (r.tablet?.impressions || 0), cell: r => num((r.desktop?.impressions || 0) + (r.mobile?.impressions || 0) + (r.tablet?.impressions || 0)), className: 'px-4 py-2.5  tabular-nums text-slate-600', thClass: 'px-4 py-2.5' },
            ]} />
        </Card>
      )}
    </div>
  );
}
