import React from 'react';
import { CheckCircle2, XCircle, AlertTriangle, HelpCircle, Link2 } from 'lucide-react';
import { usePager, Pager, useSorted, SortTh } from './DataTable';

const when = (iso, long) => { if (!iso) return '—'; const t = new Date(iso); return Number.isNaN(t.getTime()) ? '—' : t.toLocaleDateString('en-GB', long ? { day: '2-digit', month: 'short', year: 'numeric' } : { day: '2-digit', month: 'short' }); };
const ago = (iso) => { if (!iso) return null; const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); return Number.isNaN(d) ? null : d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 60 ? `${d} days ago` : `${Math.round(d / 30)} months ago`; };
const NONE = [];
const isNofollow = (l) => (l.rel || []).some(x => ['nofollow', 'sponsored', 'ugc'].includes(x));
const pageLinkValue = (l, k) => ({ anchor: l.anchor, href: l.href, placement: l.placement, type: isNofollow(l) ? `rel ${(l.rel || []).join(' ')}` : 'Follow' })[k];
const LTC = 'px-3 py-2 whitespace-nowrap';
const H = 'text-12 font-semibold uppercase tracking-wide text-slate-500 mb-2';
const STATE = { working: ['Working', '#059669', CheckCircle2], link_missing: ['Link missing', '#d97706', XCircle], unconfirmed: ['Cannot confirm', '#7c3aed', HelpCircle], page_error: ['Page error', '#dc2626', AlertTriangle] };

/** A small line of the values a figure has had over the checks. Needs two points; otherwise it says so. */
function Spark({ values, color }) {
  const pts = values.filter(v => v != null);
  if (pts.length < 2) return <div className="h-8 flex items-end text-11 text-slate-400">Check again to build a trend</div>;
  const w = 120, h = 32, lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * (w - 4) + 2, h - 3 - ((v - lo) / span) * (h - 8)]);
  const delta = pts[pts.length - 1] - pts[0];
  return (
    <div className="flex items-center gap-2">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Trend over ${pts.length} checks`}><polyline fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={xy.map(p => p.join(',')).join(' ')} /><circle cx={xy[xy.length - 1][0]} cy={xy[xy.length - 1][1]} r="3" fill={color} /></svg>
      <span className={`text-12 font-semibold tabular-nums ${delta === 0 ? 'text-slate-400' : (delta > 0) === (color !== '#dc2626') ? 'text-emerald-600' : 'text-red-600'}`}>{delta > 0 ? '+' : ''}{delta}</span>
    </div>
  );
}

function Tile({ label, hint, value, max = 100, color, series, suffix = '', note }) {
  const has = value != null;
  return (
    <div className="rounded-xl bg-white ring-1 ring-slate-200 p-3.5" title={hint}>
      <div className="text-12 font-medium text-slate-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-1"><span className="text-24 font-bold tabular-nums text-slate-900">{has ? value : '—'}</span>{has && <span className="text-12 text-slate-400">{suffix || `/ ${max}`}</span>}</div>
      <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${has ? Math.max(3, Math.min(100, (value / max) * 100)) : 0}%`, background: color }} /></div>
      <div className="mt-2">{series ? <Spark values={series} color={color} /> : null}</div>
      {note && <div className="mt-1 text-11 text-slate-500">{note}</div>}
    </div>
  );
}

const spamTone = (v) => (v == null ? '#94a3b8' : v >= 30 ? '#dc2626' : v >= 15 ? '#d97706' : '#059669');
const spamWord = (v, thin) => (v == null ? '' : thin ? 'Unreliable: very few links are known for this site' : v >= 30 ? 'High: be careful with this site' : v >= 15 ? 'Medium: look at the site' : 'Low: looks clean');

/** Everything about one backlink in pictures: its status, its figures and how they moved, its life, and the links on the page. */
export default function LinkDetail({ r }) {
  const { sorted: linkRows, sort, onSort } = useSorted(r.links || NONE, pageLinkValue);
  const pg = usePager(linkRows, { size: 10 });
  const mz = r.moz && r.moz.da != null ? r.moz : null; // Moz's own figures when it answered, DataForSEO's otherwise
  const src = mz ? 'Moz' : r.scores ? 'DataForSEO' : '';
  const s = mz ? { da: mz.da, pa: mz.pa, spam: mz.spam } : (r.scores || {});
  const hist = Array.isArray(r.history) && r.history.length ? r.history : (r.checked_at ? [{ at: r.checked_at, state: r.state, follow: r.follow, links: (r.links || []).length, da: s.da, pa: s.pa, spam: s.spam }] : []); // a row checked before histories were kept starts from its last check
  const [stLabel, stColor, StIcon] = STATE[r.lost ? 'link_missing' : r.state] || STATE.page_error;
  const first = r.crawler?.first_seen || hist[0]?.at;
  const days = first ? Math.max(0, Math.floor((Date.now() - new Date(first).getTime()) / 86400000)) : null;
  const flags = [r.page_noindex && 'This page is noindex: Google will not index it, so the link is worth little.', r.page_nofollow && 'The page tells search engines not to follow any link on it.',
    r.canonical_elsewhere && `The page names another address as its main version: ${r.canonical_elsewhere}`, r.site?.sitewide && `Sitewide link: ${r.site.links} links from ${r.site.pages} pages of this site.`].filter(Boolean);
  const series = (k) => hist.map(h => h[k]);
  const thin = s.da === 0 && s.pa === 0; // a rank of 0 means the data service has almost no link data for the site, so its other figures rest on very little
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: stColor }}><StIcon size={16} />{r.lost ? 'Link lost since the last check' : stLabel}</span>
        <span className="text-slate-600">{r.follow === 'dofollow' ? 'Passes link value' : r.follow ? 'Does not pass link value' : ''}</span>
        <span className="text-slate-600">{r.page_noindex == null ? '' : r.page_noindex ? 'Not indexable' : 'Indexable'}</span>
        <span className="text-slate-500">{r.category?.label}{r.category?.why ? ` · ${r.category.why}` : ''}</span>
        {r.error && <span className="text-red-700">{r.error}</span>}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label={mz ? 'Authority (Moz DA)' : 'Authority (DA-like)'} hint={mz ? 'Moz Domain Authority.' : 'DataForSEO domain rank, scaled to 0-100. Not Moz DA: a different database, so the numbers differ.'} value={s.da} color="#4f46e5" series={s.da != null ? series('da') : null} note={thin && !mz ? 'DataForSEO knows almost no links to this site' : src ? `Source: ${src}${(r.scores?.site_level && !mz) || (mz && r.moz?.site_level) ? ' · site figure, shared by its pages' : ''}` : ''} />
        <Tile label={mz ? 'Page strength (Moz PA)' : 'Page strength (PA-like)'} hint={mz ? 'Moz Page Authority.' : 'DataForSEO page rank, scaled to 0-100. Not Moz PA.'} value={s.pa} color="#0891b2" series={s.pa != null ? series('pa') : null} note={s.pa == null && (r.scores?.site_level || r.moz?.site_level) ? 'Not known for this page yet' : ''} />
        <Tile label="Spam score" hint={mz ? 'Moz Spam Score: lower is better.' : 'DataForSEO backlink spam score: lower is better.'} value={s.spam} suffix="%" color={spamTone(s.spam)} series={s.spam != null ? series('spam') : null} note={spamWord(s.spam, thin && !mz)} />
        <Tile label="Site rank (Open PageRank)" hint="0 to 10, from the Common Crawl link graph." value={r.domain_rank} max={10} color="#7c3aed" suffix="/ 10" />
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <div>
          <h4 className={H}>Life of this link</h4>
          <ol className="relative border-l-2 border-slate-200 ml-1.5 grid gap-3 text-13">
            <li className="pl-4 relative"><span className="absolute -left-[7px] top-1 w-3 h-3 rounded-full bg-indigo-500" /><div className="font-medium text-slate-800">First seen {when(first, true)}</div><div className="text-12 text-slate-500">{r.crawler?.first_seen ? 'by our crawler' : 'at your first check'}{days != null ? ` · ${days} day${days === 1 ? '' : 's'} old` : ''}</div></li>
            {r.crawler?.last_seen && <li className="pl-4 relative"><span className="absolute -left-[7px] top-1 w-3 h-3 rounded-full bg-slate-400" /><div className="font-medium text-slate-800">Last seen by the crawler {when(r.crawler.last_seen, true)}</div><div className="text-12 text-slate-500">{ago(r.crawler.last_seen)} · {r.crawler.live} of {r.crawler.links} link{r.crawler.links === 1 ? '' : 's'} live</div></li>}
            <li className="pl-4 relative"><span className="absolute -left-[7px] top-1 w-3 h-3 rounded-full" style={{ background: stColor }} /><div className="font-medium text-slate-800">Last checked {when(r.checked_at, true)}</div><div className="text-12 text-slate-500">{r.checks} check{r.checks === 1 ? '' : 's'} so far{r.http_status ? ` · HTTP ${r.http_status}` : ''}</div></li>
          </ol>
        </div>

        <div className="lg:col-span-2">
          <h4 className={H}>Status at each check</h4>
          {hist.length ? (
            <>
              <div className="flex flex-wrap gap-1.5" role="list">{hist.map((h, i) => { const c = (STATE[h.state] || STATE.page_error); return <span key={i} role="listitem" title={`${when(h.at, true)}: ${c[0]}${h.follow ? ` · ${h.follow}` : ''}${h.links != null ? ` · ${h.links} link${h.links === 1 ? '' : 's'}` : ''}`} className="w-5 h-5 rounded-md" style={{ background: c[1] }} />; })}</div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-12 text-slate-500"><span>{when(hist[0].at, true)}</span><span className="flex-1 h-px bg-slate-200 min-w-6" /><span>{when(hist[hist.length - 1].at, true)}</span></div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-12 text-slate-600">{Object.entries(STATE).map(([k, [l, c]]) => hist.some(h => h.state === k) && <span key={k} className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: c }} />{l}: {hist.filter(h => h.state === k).length}</span>)}</div>
            </>
          ) : <p className="text-13 text-slate-500">The history starts with the next check. Each check adds one square: green when the link works.</p>}
        </div>
      </div>

      {r.links?.length > 0 && (
        <div>
          <h4 className={H}>Links to your site on this page ({r.links.length})</h4>
          <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200 bg-white">
            <table className="w-full min-w-[640px] text-13">
              <thead className="bg-slate-50 text-12 uppercase tracking-wide text-slate-500"><tr><SortTh id="anchor" sort={sort} onSort={onSort} className={LTC}>Anchor</SortTh><SortTh id="href" sort={sort} onSort={onSort} className={LTC}>Points to</SortTh><SortTh id="placement" sort={sort} onSort={onSort} className={LTC}>Where on the page</SortTh><SortTh id="type" sort={sort} onSort={onSort} className={LTC}>Type</SortTh></tr></thead>
              <tbody className="divide-y divide-slate-100">{pg.rows.map((l, i) => {
                const nofollow = isNofollow(l);
                return (
                  <tr key={i}>
                    <td className="px-3 py-2 text-slate-800">{l.anchor || <span className="text-slate-400">({l.type} link)</span>}</td>
                    <td className="px-3 py-2 break-all"><a href={l.href} target="_blank" rel="noreferrer noopener" className="text-indigo-600 hover:underline inline-flex items-center gap-1"><Link2 size={12} />{l.href}</a></td>
                    <td className="px-3 py-2 capitalize text-slate-600">{l.placement || '—'}</td>
                    <td className="px-3 py-2"><span className={`inline-flex rounded-full px-2.5 py-1 text-12 font-medium ${nofollow ? 'bg-slate-100 text-slate-700' : 'bg-emerald-50 text-emerald-700'}`}>{nofollow ? `rel ${l.rel.join(' ')}` : 'Follow'}</span></td>
                  </tr>); })}</tbody>
            </table>
          </div>
          <Pager p={pg} label="links" />
        </div>
      )}

      {flags.length > 0 && <ul className="grid gap-1.5">{flags.map(f => <li key={f} className="rounded-lg bg-amber-50 text-amber-900 px-3 py-2 text-13 flex gap-2"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{f}</li>)}</ul>}
    </div>
  );
}
