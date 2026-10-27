import React, { useMemo, useState } from 'react';
import { Monitor, Smartphone, Sparkles, Globe, Star, MapPin, Phone, CheckCircle2 } from 'lucide-react';
import { SeoShell, Card, Badge, Button, StatusPill, Field, inputCls, useSimulated, useToast, PreviewNote } from './SeoUi';
import { useApi } from './seoApi';

const SECTIONS = [['hero', 'Hero with call button'], ['services', 'Services & prices'], ['reviews', 'Google reviews'], ['about', 'About / team'], ['faq', 'FAQs (with schema)'], ['map', 'Location & map'], ['contact', 'Contact & WhatsApp']];
const THEMES = ['#2a78d6', '#1baf7a', '#6250d6', '#e34948', '#0b0b0b'];

function Builder({ b }) {
  const [on, setOn] = useState(Object.fromEntries(SECTIONS.map(([k]) => [k, true])));
  const [color, setColor] = useState(THEMES[0]);
  const [device, setDevice] = useState('desktop');
  const [domain, setDomain] = useState(`${b.name.split(' ')[0].toLowerCase()}${b.area.toLowerCase()}.in`);
  const [built, setBuilt] = useState(false);
  const [published, setPublished] = useState(false);
  const [busy, run] = useSimulated();
  const [toast, toastNode] = useToast();
  const rv = useApi(`/businesses/${b.id}/reviews`);
  const reviews = useMemo(() => (rv.data?.reviews || []).filter(r => r.rating >= 4 && r.body).slice(0, 3).map(r => ({ ...r, author: r.author || 'Customer' })), [rv.data]);
  const faqs = (b.faqs || []).slice(0, 3);
  const pages = ['/', ...b.services.map(s => `/services/${s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')}`), `/${b.area.toLowerCase()}`, '/contact'];

  return (
    <>
    <PreviewNote>Preview: the site is generated in the browser from this business's saved profile, reviews and FAQs. Publishing to a domain is not connected yet.</PreviewNote>
    <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
      <div className="space-y-4">
        <Card title="Build from Google" subtitle="Uses the Business Profile: name, services, hours, photos, reviews">
          <Button variant="ai" icon={Sparkles} className="w-full" busy={busy === 'build'} onClick={() => run('build', () => { setBuilt(true); toast(`Site generated: ${pages.length} pages`); }, 1800)}>{built ? 'Regenerate site' : 'Generate site'}</Button>
          <div className="mt-3 space-y-1.5 text-[12px]">
            {['Fast (static pages, WebP images)', 'LocalBusiness + FAQ schema built in', 'NAP matches the Business Profile', 'Mobile-first'].map(t => <div key={t} className="flex items-center gap-1.5 text-gray-700"><CheckCircle2 size={13} className="text-emerald-600" />{t}</div>)}
          </div>
        </Card>
        <Card title="Sections">
          <div className="space-y-1.5">{SECTIONS.map(([k, l]) => <label key={k} className="flex items-center gap-2 text-[13px] cursor-pointer"><input type="checkbox" checked={on[k]} onChange={e => setOn({ ...on, [k]: e.target.checked })} />{l}</label>)}</div>
        </Card>
        <Card title="Theme">
          <div className="flex gap-2">{THEMES.map(c => <button key={c} onClick={() => setColor(c)} className={`w-8 h-8 rounded-full cursor-pointer ring-offset-2 ${color === c ? 'ring-2 ring-gray-900' : ''}`} style={{ background: c }} aria-label={`Theme ${c}`} />)}</div>
        </Card>
        <Card title="Pages">
          <div className="space-y-1 font-mono text-[12px] text-gray-700">{pages.map((p, i) => <div key={`${p}-${i}`}>{p}</div>)}</div>
        </Card>
        <Card title="Publish">
          <Field label="Domain"><input className={inputCls} value={domain} onChange={e => setDomain(e.target.value)} /></Field>
          <Button variant="primary" icon={Globe} className="w-full mt-3" disabled={!built} busy={busy === 'pub'} onClick={() => run('pub', () => { setPublished(true); toast(`Published at https://${domain}`); }, 1400)}>{published ? 'Republish' : 'Publish site'}</Button>
          {published && <div className="mt-2"><StatusPill level="good">Live at https://{domain}</StatusPill></div>}
        </Card>
      </div>

      <Card className="xl:col-span-3" title="Preview" action={<div className="flex gap-1">{[['desktop', Monitor], ['mobile', Smartphone]].map(([d, I]) => <button key={d} onClick={() => setDevice(d)} className={`h-8 w-8 flex items-center justify-center rounded border cursor-pointer ${device === d ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-300 text-gray-600'}`} aria-label={d}><I size={14} /></button>)}</div>}>
        {!built ? (
          <div className="py-24 text-center text-[13px] text-gray-500"><Globe size={28} className="mx-auto mb-2 text-gray-300" />Generate a site from the Business Profile to preview it here.</div>
        ) : (
          <div className={`mx-auto border border-gray-300 rounded-lg overflow-hidden bg-white shadow-sm ${device === 'mobile' ? 'max-w-[380px]' : ''}`}>
            <div className="h-7 bg-gray-100 border-b border-gray-200 flex items-center px-3 gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-300" /><span className="w-2.5 h-2.5 rounded-full bg-amber-300" /><span className="w-2.5 h-2.5 rounded-full bg-emerald-300" /><span className="ml-3 text-[11px] text-gray-500 font-mono">https://{domain}</span></div>
            <div className="max-h-[620px] overflow-y-auto text-gray-800">
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100"><span className="font-semibold text-[14px]" style={{ color }}>{b.name}</span><span className="text-[12px] text-gray-500 hidden sm:block">Services · Reviews · Contact</span></div>
              {on.hero && (
                <div className="px-5 py-10 text-white" style={{ background: color }}>
                  <div className="text-[22px] font-semibold leading-tight max-w-md">{b.primaryCategory} in {b.area}, {b.city}</div>
                  <div className="text-[13px] opacity-90 mt-2 max-w-md">{b.description.slice(0, 140)}{b.description.length > 140 ? '…' : ''}</div>
                  <div className="mt-4 flex gap-2"><span className="bg-white text-[13px] font-medium px-3 py-1.5 rounded" style={{ color }}>Call {b.phone}</span><span className="border border-white/70 text-[13px] px-3 py-1.5 rounded">Book online</span></div>
                  {b.rating ? <div className="mt-3 text-[12px] flex items-center gap-1"><Star size={12} className="fill-white" /> {b.rating} from {b.reviewCount} Google reviews</div> : null}
                </div>
              )}
              {on.services && (
                <div className="px-5 py-6">
                  <div className="text-[16px] font-semibold mb-3">Services</div>
                  <div className={`grid gap-3 ${device === 'mobile' ? 'grid-cols-1' : 'grid-cols-2'}`}>{b.services.map((s, i) => <div key={`${s.name}-${i}`} className="border border-gray-200 rounded p-3"><div className="text-[13px] font-medium">{s.name}</div>{s.description && <div className="text-[12px] text-gray-600 mt-0.5">{s.description}</div>}{s.price && <div className="text-[12px] mt-1" style={{ color }}>{s.price}</div>}</div>)}</div>
                </div>
              )}
              {on.reviews && reviews.length > 0 && (
                <div className="px-5 py-6 bg-gray-50">
                  <div className="text-[16px] font-semibold mb-3">What patients say</div>
                  <div className={`grid gap-3 ${device === 'mobile' ? 'grid-cols-1' : 'grid-cols-3'}`}>{reviews.map(r => <div key={r.id} className="bg-white rounded p-3 border border-gray-200"><div className="text-amber-500 text-[12px]">{'★'.repeat(r.rating)}</div><p className="text-[12px] text-gray-700 mt-1">{r.body}</p><div className="text-[11px] text-gray-500 mt-1">— {r.author}</div></div>)}</div>
                </div>
              )}
              {on.about && <div className="px-5 py-6"><div className="text-[16px] font-semibold mb-2">About us</div><p className="text-[13px] text-gray-600">[Add your story, team names and qualifications. Real names and credentials build trust (E-E-A-T).]</p></div>}
              {on.faq && <div className="px-5 py-6 bg-gray-50"><div className="text-[16px] font-semibold mb-2">FAQs</div>{faqs.map((f, i) => <div key={`${f.q}-${i}`} className="py-2 border-b border-gray-200 last:border-0"><div className="text-[13px] font-medium">{f.q}</div><div className="text-[12px] text-gray-600 mt-0.5">{f.a}</div></div>)}</div>}
              {on.map && <div className="px-5 py-6"><div className="text-[16px] font-semibold mb-2">Find us</div><div className="h-36 rounded bg-[#eef2ec] flex items-center justify-center text-[12px] text-gray-500"><MapPin size={16} className="mr-1" style={{ color }} />{b.address || `${b.area}, ${b.city}`}</div></div>}
              {on.contact && <div className="px-5 py-6 text-white text-[13px]" style={{ background: '#111827' }}><div className="font-semibold">{b.name}</div><div className="mt-1 opacity-80 flex items-center gap-1"><Phone size={12} /> {b.phone}</div><div className="opacity-80">{b.address}</div><div className="mt-2"><Badge tone="green">Chat on WhatsApp</Badge></div></div>}
            </div>
          </div>
        )}
      </Card>
      {toastNode}
    </div>
    </>
  );
}

export default function WebsiteBuilderPage() {
  return (
    <SeoShell title="Website builder" subtitle="A fast, schema-ready site generated from the Google Business Profile, with service and location pages">
      {(b) => <Builder key={b.id} b={b} />}
    </SeoShell>
  );
}
