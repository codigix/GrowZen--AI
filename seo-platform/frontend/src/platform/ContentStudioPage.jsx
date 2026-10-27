import React, { useMemo, useState } from 'react';
import { Sparkles, Check, ChevronRight, Globe, ShieldCheck, AlertTriangle, RefreshCw, FileText, MapPin, Instagram, Facebook, Linkedin, Copy, Plus, CalendarDays } from 'lucide-react';
import { SeoShell, Card, Tabs, Badge, StatusPill, Button, Field, inputCls, areaCls, ScoreRing, Meter, SERIES, scoreWord, useSimulated, useToast, PreviewNote } from './SeoUi';
import { rng, fmt, shortDate, daysBack, ymd } from './seoMock';

const STEPS = ['Keyword', 'Google results', 'Brief', 'Draft', 'Enrich', 'Score', 'Publish'];

const serpFor = (b, kw) => {
  const r = rng(`${b.id}-${kw}-serp`);
  const sites = ['practo.com', 'justdial.com', 'competitor-one.in', 'healthline.com', 'lbb.in', 'competitor-two.com', 'quora.com', 'medium.com', 'sulekha.com', 'reddit.com'];
  return sites.map((s, i) => ({ pos: i + 1, site: s, title: `${kw.replace(/\b\w/g, c => c.toUpperCase())}${i % 3 === 0 ? ` in ${b.city}` : i % 3 === 1 ? ': cost, benefits & what to expect' : ' - complete guide'}`, words: Math.round((600 + r() * 2200) / 50) * 50, headings: Math.round(5 + r() * 12), faq: r() > 0.5 }));
};

function BlogWriter({ b, toast }) {
  const [step, setStep] = useState(0);
  const [kw, setKw] = useState(`${(b.services[0]?.name || b.seeds[0] || b.primaryCategory || 'service').toLowerCase()} in ${(b.city || b.area || '').toLowerCase()}`.trim());
  const [busy, run] = useSimulated();
  const serp = useMemo(() => serpFor(b, kw), [b, kw]);
  const avgWords = Math.round(serp.reduce((s, x) => s + x.words, 0) / serp.length / 50) * 50;
  const svc = b.services[0] || { name: b.primaryCategory, price: '' };
  const [outline, setOutline] = useState([]);
  const [draft, setDraft] = useState('');
  const [enrich, setEnrich] = useState({ prices: false, quote: false, photos: false, local: false });
  const [cms, setCms] = useState('WordPress');
  const [published, setPublished] = useState(false);

  const makeOutline = () => [
    `What is ${svc.name.toLowerCase()}?`, `Who needs ${svc.name.toLowerCase()}?`, `How much does ${svc.name.toLowerCase()} cost in ${b.city}?`,
    'What happens in the first session', `How many sessions will I need?`, `Choosing a ${b.primaryCategory.toLowerCase()} in ${b.area}`, 'Frequently asked questions'
  ];
  const makeDraft = (o) => o.map((h, i) => `## ${h}\n${i === 2
    ? `${svc.name} at ${b.name} ${svc.price ? `costs ${svc.price}` : 'costs [add your price]'}. The number of sessions depends on your assessment.`
    : i === 0 ? `${svc.name} is ${'[one-line definition in plain words]'}. At ${b.name} in ${b.area}, every plan starts with an assessment.`
      : `[Answer this in the first 40-60 words, then add detail from your own experience.]`}`).join('\n\n');
  const enrichDone = Object.values(enrich).filter(Boolean).length;
  const score = Math.min(96, 58 + enrichDone * 7 + (outline.length >= 6 ? 6 : 0) + (draft.includes(b.area) ? 4 : 0));

  const next = () => {
    if (step === 1) return run('brief', () => { setOutline(makeOutline()); setStep(2); }, 1200);
    if (step === 2) return run('draft', () => { setDraft(makeDraft(outline)); setStep(3); }, 1600);
    if (step === 6) return run('pub', () => { setPublished(true); toast(`Published to ${cms} and indexing requested (simulated)`); }, 1400);
    return setStep(s => Math.min(STEPS.length - 1, s + 1));
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
      <Card title="Pipeline" className="xl:col-span-1">
        <ol className="space-y-1">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button onClick={() => i <= step && setStep(i)} className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-[13px] text-left cursor-pointer ${i === step ? 'bg-blue-50 text-blue-800 font-medium' : i < step ? 'text-gray-800 hover:bg-gray-50' : 'text-gray-400'}`}>
                <span className={`w-5 h-5 rounded-full text-[11px] flex items-center justify-center ${i < step ? 'bg-emerald-600 text-white' : i === step ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}`}>{i < step ? <Check size={11} /> : i + 1}</span>{s}
              </button>
            </li>
          ))}
        </ol>
        <p className="text-[11px] text-gray-500 mt-3">Every draft is grounded in the business profile and the current top results, then scored and approved by a person.</p>
      </Card>

      <Card className="xl:col-span-3" title={STEPS[step]} action={<Button variant={step === 6 ? 'primary' : 'secondary'} busy={Boolean(busy)} onClick={next} disabled={published}>{step === 6 ? (published ? 'Published' : 'Approve & publish') : step === 1 ? 'Build brief' : step === 2 ? 'Write draft' : 'Next'} {step < 6 && <ChevronRight size={13} />}</Button>}>
        {step === 0 && (
          <div className="space-y-3 max-w-xl">
            <Field label="Target keyword" hint="Pick a keyword cluster from Keywords, or type one."><input className={inputCls} value={kw} onChange={e => setKw(e.target.value)} /></Field>
            <div className="flex gap-2 text-[13px]"><span className="text-gray-600">Detected intent:</span><Badge tone="blue">{/near|in /.test(kw) ? 'Local' : /cost|price/.test(kw) ? 'Transactional' : 'Informational'}</Badge><span className="text-gray-500">→ format: service guide with prices and FAQs</span></div>
          </div>
        )}
        {step === 1 && (
          <div>
            <div className="flex flex-wrap gap-4 text-[13px] mb-3"><span>Average length of the top 10: <b>{fmt(avgWords)} words</b></span><span>With FAQ section: <b>{serp.filter(s => s.faq).length}/10</b></span><StatusPill level="info">AI Overview shown for this query</StatusPill></div>
            <table className="w-full text-[13px]">
              <thead className="text-[12px] text-gray-500 border-b border-gray-200"><tr><th className="p-2 text-left font-medium">#</th><th className="p-2 text-left font-medium">Page</th><th className="p-2 text-right font-medium">Words</th><th className="p-2 text-right font-medium">Headings</th><th className="p-2 text-left font-medium">FAQ</th></tr></thead>
              <tbody className="divide-y divide-gray-100">{serp.map(s => <tr key={s.pos}><td className="p-2 text-gray-400">{s.pos}</td><td className="p-2"><div className="text-gray-900 truncate max-w-[420px]">{s.title}</div><div className="text-[11px] text-emerald-700">{s.site}</div></td><td className="p-2 text-right tabular-nums">{fmt(s.words)}</td><td className="p-2 text-right tabular-nums">{s.headings}</td><td className="p-2">{s.faq ? <Check size={14} className="text-emerald-600" /> : <span className="text-gray-300">—</span>}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        {step === 2 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-[12px] text-gray-600 mb-1">Outline (covers the gaps in the top results)</div>
              <div className="space-y-1.5">{outline.map((h, i) => <input key={i} className={inputCls} value={h} onChange={e => setOutline(o => o.map((x, j) => j === i ? e.target.value : x))} />)}</div>
              <Button size="sm" icon={Plus} className="mt-2" onClick={() => setOutline(o => [...o, 'New section'])}>Add section</Button>
            </div>
            <div className="space-y-2 text-[13px]">
              <div><span className="text-gray-500">Title:</span> {svc.name} in {b.city}: Cost, Sessions & What to Expect</div>
              <div><span className="text-gray-500">Meta description:</span> {`${svc.name} at ${b.name}, ${b.area}. Prices, how many sessions you need and what happens in your first visit.`.slice(0, 158)}</div>
              <div><span className="text-gray-500">Target length:</span> ~{fmt(avgWords + 200)} words</div>
              <div><span className="text-gray-500">Schema:</span> Article + FAQPage</div>
              <div><span className="text-gray-500">Internal links:</span> /services, /contact, /{b.area.toLowerCase()}</div>
            </div>
          </div>
        )}
        {step === 3 && (
          <div>
            <div className="text-[11px] text-violet-700 mb-2 flex items-center gap-1"><Sparkles size={11} /> Each section opens with a direct answer (helps AI Overviews). [Brackets] need your real facts.</div>
            <textarea rows={16} className={`${areaCls} font-mono text-[12px]`} value={draft} onChange={e => setDraft(e.target.value)} />
          </div>
        )}
        {step === 4 && (
          <div className="space-y-2 max-w-xl">
            <p className="text-[13px] text-gray-600 mb-2">Add what only you know. This is the E-E-A-T step and the main defence against “scaled low-value content”.</p>
            {[['prices', 'Real prices and package details'], ['quote', 'A quote from the owner or a team member'], ['photos', 'Your own photos (no stock images)'], ['local', `Local details: landmarks, parking, areas near ${b.area}`]].map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 p-2.5 rounded border border-gray-200 text-[13px] cursor-pointer"><input type="checkbox" checked={enrich[k]} onChange={e => setEnrich({ ...enrich, [k]: e.target.checked })} />{l}</label>
            ))}
          </div>
        )}
        {step === 5 && (
          <div className="flex flex-wrap gap-6">
            <ScoreRing score={score} label={scoreWord(score)} size={120} />
            <div className="flex-1 min-w-[260px] space-y-2.5">
              {[['Keyword use (title, first 100 words, headings)', 92], ['Topic coverage vs top 10', 70 + enrichDone * 5], ['Readability', 84], ['Internal links', 75], ['Original detail (E-E-A-T)', 40 + enrichDone * 15]].map(([l, v], i) => (
                <div key={l}><div className="flex justify-between text-[12px] mb-1"><span className="text-gray-600">{l}</span><span className="font-medium">{Math.min(100, v)}</span></div><Meter value={Math.min(100, v)} color={SERIES[i % 3]} /></div>
              ))}
              <div className="flex flex-wrap gap-2 pt-1">
                <StatusPill level="good">Plagiarism 2% (quotes only)</StatusPill>
                {draft.includes('[') ? <StatusPill level="warning">Fill the [bracketed] facts before publishing</StatusPill> : <StatusPill level="good">No unverified claims</StatusPill>}
                <StatusPill level="good">Spam-risk: low</StatusPill>
              </div>
            </div>
          </div>
        )}
        {step === 6 && (
          <div className="max-w-xl space-y-3">
            <div className="grid grid-cols-3 gap-2">{['WordPress', 'Webflow', 'Shopify'].map(c => <button key={c} onClick={() => setCms(c)} className={`h-10 rounded border text-[13px] cursor-pointer ${cms === c ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-300 text-gray-700'}`}>{c}</button>)}</div>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" defaultChecked /> Request indexing in Search Console after publishing</label>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" defaultChecked /> Add links to this post from 3 older posts</label>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" defaultChecked /> Suggest a refresh if it stalls after 60–90 days</label>
            {published && <div className="p-3 rounded bg-emerald-50 text-[13px] text-emerald-800 flex items-center gap-2"><Globe size={14} /> Live at {b.website || 'your site'}/blog/{kw.replace(/\s+/g, '-')}</div>}
            <p className="text-[11px] text-gray-500"><ShieldCheck size={11} className="inline" /> Publishing cap: 3 posts per site per week, to stay clear of scaled-content spam rules.</p>
          </div>
        )}
      </Card>
    </div>
  );
}

function PagesTab({ b, toast }) {
  const [kind, setKind] = useState('service');
  const [busy, run] = useSimulated();
  const [out, setOut] = useState(null);
  const targets = kind === 'service' ? b.services.map(s => s.name) : [b.area, 'Karve Nagar', 'Warje', 'Erandwane', 'Deccan'];
  const [target, setTarget] = useState(targets[0]);
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <Card title="Generate a page">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-1">{[['service', 'Service page', FileText], ['location', 'Location page', MapPin]].map(([k, l, I]) => <button key={k} onClick={() => { setKind(k); setTarget((k === 'service' ? b.services.map(s => s.name) : [b.area])[0]); }} className={`h-9 flex items-center justify-center gap-1.5 text-[12px] rounded border cursor-pointer ${kind === k ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-300 text-gray-700'}`}><I size={13} />{l}</button>)}</div>
          <Field label={kind === 'service' ? 'Service' : 'Area'}><select className={inputCls} value={target} onChange={e => setTarget(e.target.value)}>{targets.map(t => <option key={t}>{t}</option>)}</select></Field>
          <Button variant="ai" icon={Sparkles} className="w-full" busy={busy === 'pg'} onClick={() => run('pg', () => setOut({ kind, target }), 1400)}>Generate</Button>
          {kind === 'location' && <p className="text-[11px] text-gray-500"><AlertTriangle size={11} className="inline text-amber-600" /> Only make location pages for areas you really serve, each with unique local detail. Near-duplicate “doorway” pages get filtered.</p>}
        </div>
      </Card>
      <Card title="Preview" className="xl:col-span-2" action={out && <Button size="sm" variant="primary" onClick={() => toast('Sent for approval')}>Send for approval</Button>}>
        {!out ? <div className="py-12 text-center text-[13px] text-gray-500">Pick a service or area and generate.</div> : (
          <article className="prose-sm max-w-none text-[13px] text-gray-800 space-y-2">
            <div className="text-[11px] text-emerald-700">{b.website || 'yoursite.in'}/{out.kind === 'service' ? 'services' : 'areas'}/{out.target.toLowerCase().replace(/[^a-z0-9]+/g, '-')}</div>
            <h3 className="text-lg font-semibold text-gray-900">{out.kind === 'service' ? `${out.target} in ${b.area}, ${b.city}` : `${b.primaryCategory} in ${out.target}, ${b.city}`}</h3>
            <p>{out.kind === 'service' ? `${b.name} offers ${out.target.toLowerCase()} in ${b.area}. ${b.services.find(s => s.name === out.target)?.description || '[describe the service in your words]'}` : `Patients from ${out.target} visit ${b.name} on Karve Road, about [X] minutes away. [Add a local landmark and parking tip.]`}</p>
            <h4 className="font-semibold text-gray-900 pt-1">Price</h4><p>{b.services.find(s => s.name === out.target)?.price || '[add price]'}</p>
            <h4 className="font-semibold text-gray-900 pt-1">FAQs</h4><p>3 questions from People Also Ask, answered first-line-first.</p>
            <div className="flex gap-2 pt-1"><Badge tone="blue">LocalBusiness schema</Badge><Badge tone="blue">FAQPage schema</Badge><Badge tone="gray">Map embed (matches GBP)</Badge></div>
          </article>
        )}
      </Card>
    </div>
  );
}

function SocialTab({ b, toast }) {
  const [busy, run] = useSimulated();
  const [topic, setTopic] = useState(b.services[0]?.name || '');
  const [caps, setCaps] = useState(null);
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <Card title="Captions for one topic">
        <Field label="Topic"><input className={inputCls} value={topic} onChange={e => setTopic(e.target.value)} /></Field>
        <Button variant="ai" icon={Sparkles} className="mt-3 w-full" busy={busy === 's'} onClick={() => run('s', () => setCaps([
          { net: 'Instagram', icon: Instagram, text: `${topic} done right ✨ Our ${b.area} team starts with a proper assessment, so your plan fits you. Book via the link in bio.\n#${b.city} #${b.area} #${b.primaryCategory.replace(/\s/g, '')}` },
          { net: 'Facebook', icon: Facebook, text: `Looking for ${topic.toLowerCase()} in ${b.area}? At ${b.name} we explain every step in plain language. Call or message us to book.` },
          { net: 'LinkedIn', icon: Linkedin, text: `Long hours at a desk? ${topic} can help. Our team at ${b.name}, ${b.city}, shares 3 simple habits in the comments.` }
        ]), 1200)}>Write captions</Button>
      </Card>
      <div className="xl:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4">
        {(caps || []).map(c => { const I = c.icon; return (
          <Card key={c.net} title={<span className="flex items-center gap-1.5"><I size={14} />{c.net}</span>} action={<Button size="sm" icon={Copy} onClick={() => toast('Caption copied')}>Copy</Button>}>
            <p className="text-[13px] text-gray-700 whitespace-pre-line">{c.text}</p>
          </Card>
        ); })}
        {!caps && <div className="md:col-span-3 py-12 text-center text-[13px] text-gray-500 bg-white border border-gray-200 rounded">Captions for Instagram, Facebook and LinkedIn appear here.</div>}
      </div>
    </div>
  );
}

function CalendarTab({ b }) {
  const items = [
    { d: 1, t: 'GBP post: weekly offer', k: 'post' }, { d: 3, t: `Blog: ${b.services[0]?.name} cost in ${b.city}`, k: 'blog' }, { d: 5, t: 'Instagram reel: clinic tour', k: 'social' },
    { d: 8, t: 'GBP post: evening slots', k: 'post' }, { d: 10, t: `Location page: Karve Nagar`, k: 'page' }, { d: 15, t: 'GBP post: festival hours', k: 'post' },
    { d: 17, t: 'Blog refresh: “back pain exercises”', k: 'refresh' }, { d: 22, t: 'GBP post: FAQ answer', k: 'post' }, { d: 24, t: 'Blog: when to see a specialist', k: 'blog' }
  ];
  const tone = { post: 'blue', blog: 'violet', social: 'orange', page: 'green', refresh: 'amber' };
  const start = new Date(); start.setDate(1); const offset = (start.getDay() + 6) % 7;
  return (
    <Card title={start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} subtitle="Planned content across Google, website and social" action={<CalendarDays size={16} className="text-gray-400" />}>
      <div className="grid grid-cols-7 gap-1 text-[11px] text-gray-500 mb-1">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} className="px-1">{d}</div>)}</div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 35 }, (_, i) => {
          const day = i - offset + 1;
          const valid = day >= 1 && day <= new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
          return (
            <div key={i} className={`min-h-[78px] rounded border p-1 ${valid ? 'border-gray-200 bg-white' : 'border-transparent'}`}>
              {valid && <><div className="text-[11px] text-gray-400">{day}</div>{items.filter(x => x.d === day).map(x => <div key={x.t} className="mt-0.5"><Badge tone={tone[x.k]}>{x.t.length > 22 ? `${x.t.slice(0, 22)}…` : x.t}</Badge></div>)}</>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function RefreshTab({ b, toast }) {
  const posts = [
    { title: `${b.primaryCategory} vs doctor: who to see first`, published: ymd(daysBack(140)), clicks: [120, 96], rank: [6, 14] },
    { title: '5 exercises for lower back pain at your desk', published: ymd(daysBack(210)), clicks: [340, 210], rank: [3, 8] },
    { title: `${b.services[1]?.name || 'Our services'}: complete guide`, published: ymd(daysBack(95)), clicks: [80, 74], rank: [11, 12] }
  ];
  return (
    <Card title="Posts to refresh" subtitle="Pages that stalled or dropped after 60–90 days">
      <div className="divide-y divide-gray-100">
        {posts.map(p => (
          <div key={p.title} className="flex flex-wrap items-center gap-3 py-3">
            <RefreshCw size={15} className="text-amber-600" />
            <div className="flex-1 min-w-[240px]"><div className="text-[13px] text-gray-900">{p.title}</div><div className="text-[12px] text-gray-500">Published {shortDate(p.published)} · clicks {p.clicks[0]} → {p.clicks[1]} · rank {p.rank[0]} → {p.rank[1]}</div></div>
            <StatusPill level={p.rank[1] - p.rank[0] > 4 ? 'serious' : 'warning'}>{p.rank[1] - p.rank[0] > 4 ? 'Dropping' : 'Stalled'}</StatusPill>
            <Button size="sm" variant="ai" icon={Sparkles} onClick={() => toast('Refresh brief created: 3 new sections, updated prices, new FAQ')}>Refresh brief</Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function ContentStudioPage() {
  const [tab, setTab] = useState('blog');
  return (
    <SeoShell title="AI content studio" subtitle="Blog posts, service and location pages, posts, FAQs and captions, grounded in your real business details">
      {(b) => <Studio key={b.id} b={b} tab={tab} setTab={setTab} />}
    </SeoShell>
  );
}

function Studio({ b, tab, setTab }) {
  const [toast, toastNode] = useToast();
  return (
    <>
      <PreviewNote>Preview: the blog writer, pages, captions and calendar show the planned workflow with your business details, but don't call the AI or publish yet. GBP posts are live in GBP Manager → Posts.</PreviewNote>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'blog', label: 'Blog writer' }, { id: 'pages', label: 'Service & location pages' }, { id: 'social', label: 'Social captions' }, { id: 'calendar', label: 'Content calendar' }, { id: 'refresh', label: 'Refresh old posts' }]} />
      {tab === 'blog' && <BlogWriter b={b} toast={toast} />}
      {tab === 'pages' && <PagesTab b={b} toast={toast} />}
      {tab === 'social' && <SocialTab b={b} toast={toast} />}
      {tab === 'calendar' && <CalendarTab b={b} />}
      {tab === 'refresh' && <RefreshTab b={b} toast={toast} />}
      {toastNode}
    </>
  );
}
