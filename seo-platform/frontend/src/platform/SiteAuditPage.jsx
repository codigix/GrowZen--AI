import React, { useEffect, useState } from 'react';
import { Play, Copy, ExternalLink } from 'lucide-react';
import { SeoShell, Card, Tabs, StatusPill, Badge, Button, ScoreRing, ErrorNote, scoreWord, useToast, useAction } from './SeoUi';
import WebsiteAuditTool from './WebsiteAuditTool';
import { api, useApi, usePoll, fmtDateTime } from './seoApi';

const ORDER = { critical: 0, serious: 1, warning: 2, info: 3 };

function useLatestAudit(businessId, kind) {
  const list = useApi(`/businesses/${businessId}/audits?kind=${kind}&limit=1`);
  const id = list.data?.[0]?.id;
  const detail = useApi(id ? `/businesses/${businessId}/audits/${id}` : null);
  return { list, detail: detail.data, reload: () => list.reload(true) };
}

function BusinessSite({ b }) {
  const tech = useLatestAudit(b.id, 'technical');
  const onpage = useLatestAudit(b.id, 'onpage');
  const [waiting, setWaiting] = useState(false);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const running = waiting || [tech.list.data?.[0], onpage.list.data?.[0]].some(a => a && ['queued', 'running'].includes(a.status));
  usePoll(() => { tech.reload(); onpage.reload(); }, running, 3000);
  useEffect(() => { if (waiting && tech.list.data?.[0]?.status === 'done' && onpage.list.data?.[0]?.status === 'done') setWaiting(false); }, [waiting, tech.list.data, onpage.list.data]);
  const start = () => run('run', async () => { await api(`/businesses/${b.id}/audits`, { method: 'POST', body: { kinds: ['technical', 'onpage'] } }); setWaiting(true); toast('Audit started'); setTimeout(() => { tech.reload(); onpage.reload(); }, 1500); });

  if (!b.website) return <Card><div className="py-10 text-center text-[13px] text-gray-600">This business has no website on file. Add it in GBP Manager → Profile, or build one with the Website Builder.</div></Card>;
  const t = tech.detail; const o = onpage.detail;
  const issues = [...(t?.issues || []), ...(o?.issues || [])].sort((x, y) => (ORDER[x.level] ?? 9) - (ORDER[y.level] ?? 9));
  const pages = o?.result?.pages || [];
  return (
    <>
      <Card title={b.website} subtitle={t || o ? `Last audit ${fmtDateTime((o || t).finished_at)}` : 'Not audited yet'} className="mb-4"
        action={<Button variant="primary" icon={Play} busy={busy === 'run' || running} onClick={start}>{running ? 'Auditing…' : 'Re-audit site'}</Button>}>
        <div className="flex flex-wrap gap-8 items-center">
          <div className="flex flex-col items-center"><ScoreRing score={t?.score ?? 0} label="Technical" />{t?.error && <span className="text-[11px] text-red-600 mt-1 max-w-[180px] text-center">{t.error}</span>}</div>
          <div className="flex flex-col items-center"><ScoreRing score={o?.score ?? 0} label="On-page" />{o && <span className="text-[11px] text-gray-500 mt-1">{pages.length} pages · {scoreWord(o.score ?? 0)}</span>}</div>
          <div className="flex-1 min-w-[220px] space-y-1.5 text-[13px]">
            {['critical', 'serious', 'warning', 'info'].map(l => <div key={l} className="flex items-center justify-between"><StatusPill level={l}>{l}</StatusPill><span className="tabular-nums">{issues.filter(i => i.level === l).length}</span></div>)}
          </div>
        </div>
        <ErrorNote>{error}</ErrorNote>
      </Card>
      <Card title={`Issues (${issues.length})`} subtitle="Sorted by priority" className="mb-4">
        {issues.length === 0 ? <div className="py-6 text-center text-[13px] text-gray-500">{t || o ? 'No issues found.' : 'Run the audit to see issues.'}</div> : (
          <div className="divide-y divide-gray-100">
            {issues.map((i, n) => <div key={n} className="flex items-start gap-3 py-2.5"><span className="w-24 shrink-0"><StatusPill level={i.level}>{i.level}</StatusPill></span><div className="flex-1 min-w-0"><div className="text-[13px] text-gray-900">{i.title}</div><div className="text-[12px] text-gray-500">{i.area} · {i.fix}</div></div></div>)}
          </div>
        )}
      </Card>
      {pages.length > 0 && (
        <Card title="On-page checks per page">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="text-[12px] text-gray-500 border-b border-gray-200"><tr><th className="p-2 text-left font-medium">Page</th><th className="p-2 text-left font-medium">Status</th><th className="p-2 text-right font-medium">Title</th><th className="p-2 text-right font-medium">Meta</th><th className="p-2 text-right font-medium">H1</th><th className="p-2 text-right font-medium">Words</th><th className="p-2 text-left font-medium">Schema</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {pages.map(p => {
                  const bad = (ok) => (ok ? 'text-gray-800' : 'text-[#d03b3b] font-medium');
                  let path = p.url; try { path = new URL(p.url).pathname; } catch (e) { /* keep */ }
                  return (
                    <tr key={p.url}>
                      <td className="p-2 font-mono text-[12px] text-gray-800">{path}</td>
                      <td className="p-2">{p.status < 400 ? <Badge tone="green">{p.status}</Badge> : <Badge tone="red">{p.status}</Badge>}</td>
                      <td className={`p-2 text-right tabular-nums ${bad(p.title_length >= 25 && p.title_length <= 60)}`}>{p.title_length}</td>
                      <td className={`p-2 text-right tabular-nums ${bad(p.meta_description_length > 0)}`}>{p.meta_description_length || 'none'}</td>
                      <td className={`p-2 text-right tabular-nums ${bad(p.h1_count === 1)}`}>{p.h1_count}</td>
                      <td className={`p-2 text-right tabular-nums ${bad(p.word_count >= 300)}`}>{p.word_count}</td>
                      <td className="p-2 text-[12px] text-gray-600">{(p.schema_types || []).join(', ') || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {toastNode}
    </>
  );
}

function SchemaTab({ b }) {
  const [toast, toastNode] = useToast();
  const json = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'LocalBusiness', name: b.name, url: b.website || undefined, telephone: b.phone || undefined,
    address: b.address ? { '@type': 'PostalAddress', streetAddress: b.address, addressLocality: b.city || undefined, addressCountry: 'IN' } : undefined,
    geo: b.lat != null ? { '@type': 'GeoCoordinates', latitude: b.lat, longitude: b.lng } : undefined,
    aggregateRating: b.rating ? { '@type': 'AggregateRating', ratingValue: b.rating, reviewCount: b.reviewCount } : undefined,
    makesOffer: (b.services || []).filter(s => s.name).map(s => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: s.name } }))
  }, null, 2);
  const faq = (b.faqs || []).length ? JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: b.faqs.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }, null, 2) : null;
  const copy = (text, what) => navigator.clipboard?.writeText(`<script type="application/ld+json">\n${text}\n</script>`).then(() => toast(`${what} copied`));
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Card title="LocalBusiness schema" subtitle="Built from the saved profile, so it matches Google" action={<div className="flex gap-2"><Button size="sm" icon={Copy} onClick={() => copy(json, 'LocalBusiness schema')}>Copy</Button><a className="h-7 px-2.5 inline-flex items-center gap-1 text-xs border border-gray-300 rounded hover:bg-gray-50" href="https://search.google.com/test/rich-results" target="_blank" rel="noreferrer"><ExternalLink size={12} /> Test</a></div>}>
        <pre className="text-[11px] bg-gray-900 text-gray-100 rounded p-3 overflow-auto max-h-[460px]">{json}</pre>
      </Card>
      <Card title="FAQ schema" subtitle="From the Q&A saved in GBP Manager" action={faq && <Button size="sm" icon={Copy} onClick={() => copy(faq, 'FAQ schema')}>Copy</Button>}>
        {faq ? <pre className="text-[11px] bg-gray-900 text-gray-100 rounded p-3 overflow-auto max-h-[460px]">{faq}</pre> : <div className="py-6 text-[13px] text-gray-500">Add Q&A in GBP Manager → Q&A / FAQs.</div>}
      </Card>
      {toastNode}
    </div>
  );
}

export default function SiteAuditPage({ initialTab = 'check' }) {
  const [tab, setTab] = useState(initialTab === 'pages' ? 'business' : initialTab);
  return (
    <SeoShell title="Site audit" subtitle="Is the website SEO friendly? Check any site, or this business's site, then fix and re-check.">
      {(b) => (
        <>
          <Tabs value={tab} onChange={setTab} tabs={[{ id: 'check', label: 'Check any website' }, { id: 'business', label: "This business's website" }, { id: 'schema', label: 'Schema' }]} />
          {tab === 'check' && <WebsiteAuditTool defaultUrl={b.website || ''} />}
          {tab === 'business' && <BusinessSite key={b.id} b={b} />}
          {tab === 'schema' && <SchemaTab b={b} />}
        </>
      )}
    </SeoShell>
  );
}

