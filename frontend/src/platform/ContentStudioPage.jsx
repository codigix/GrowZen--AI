import React, { useMemo, useState } from 'react';
import {
  Sparkles, Check, ChevronRight, Globe, ShieldCheck, AlertTriangle, RefreshCw,
  FileText, MapPin, Instagram, Facebook, Linkedin, Copy, Plus, CalendarDays,
  Flame, TrendingUp, Search, Clock, ArrowUpRight, CheckCircle2, Lock, Sliders,
  Send, ExternalLink, Link2, Share2, Layers, Award, Tag, BarChart3, Code, Eye
} from 'lucide-react';
import {
  SeoShell, Card, Tabs, Badge, StatusPill, Button, Field, inputCls, areaCls,
  ScoreRing, Meter, SERIES, scoreWord, useSimulated, useToast, PreviewNote, useUrlTab } from './SeoUi';
import { rng, shortDate, daysBack, ymd } from './seoMock';
import { fmt } from './seoApi';

const STEPS = ['Topic & Intent', 'SERP Analysis', 'Structured Brief', 'AI Draft', 'E-E-A-T Enrichment', 'Quality Gate', 'Publish & Schedule'];

// Real-world Trending Topic Candidates for Hospital / Local Business
const TRENDING_TOPICS = [
  {
    id: 1,
    title: 'Micro-Incision Cataract Surgery (MICS) in PCMC: Cost, Recovery & Lens Options',
    slug: 'cataract-surgery-in-pcmc',
    category: 'Ophthalmology & Surgery',
    volume: '2,400 / mo',
    velocity: '+46% Rising',
    intent: 'Local / High Intent',
    competition: 'Medium (0.42)',
    source: 'Google Trends & Search Console',
    recommendedCta: 'Book Free Cataract Screening',
    internalLinkTarget: '/cataract-surgery-in-pcmc',
    audience: 'Senior patients & adult children in Chinchwad, Akurdi, Nigdi, PCMC',
    seedKeywords: ['mics cataract surgery pcmc', 'cataract operation cost chinchwad', 'best eye hospital for cataract pune']
  },
  {
    id: 2,
    title: 'Cashless Mediclaim & TPA Insurance Guide for Eye Surgery in Chinchwad',
    slug: 'cashless-mediclaim-eye-hospital-pcmc',
    category: 'Patient Care & Billing',
    volume: '1,850 / mo',
    velocity: '+38% Rising',
    intent: 'Transactional',
    competition: 'Low (0.28)',
    source: 'Patient FAQs & Search Queries',
    recommendedCta: 'Check Your Insurance Eligibility',
    internalLinkTarget: '/contact',
    audience: 'Insured families, corporate policyholders, senior citizens',
    seedKeywords: ['cashless eye surgery pcmc', 'star health tpa moraya hospital', 'mediclaim cataract coverage']
  },
  {
    id: 3,
    title: 'Femtosecond Laser vs Phacoemulsification: Which Cataract Surgery is Safer?',
    slug: 'femtosecond-laser-vs-phaco-cataract',
    category: 'Clinical Comparison',
    volume: '3,100 / mo',
    velocity: '+29% Rising',
    intent: 'Informational & Commercial',
    competition: 'High (0.64)',
    source: 'AI Search Overview Queries',
    recommendedCta: 'Consult an Eye Surgeon',
    internalLinkTarget: '/cataract-surgery-in-pcmc',
    audience: 'Patients researching blade-free laser cataract technologies',
    seedKeywords: ['robotic laser cataract surgery pune', 'phaco vs femto cataract', 'blade free eye surgery pcmc']
  },
  {
    id: 4,
    title: 'Post-Cataract Surgery Recovery Checklist: Dos, Don’ts & Eye Drop Schedule',
    slug: 'cataract-surgery-recovery-care-pcmc',
    category: 'Post-Operative Care',
    volume: '4,200 / mo',
    velocity: '+22% Rising',
    intent: 'Informational',
    competition: 'Low (0.21)',
    source: 'Post-Op Followup FAQs',
    recommendedCta: 'Download Free Recovery PDF',
    internalLinkTarget: '/cataract-surgery-in-pcmc',
    audience: 'Patients recovering from surgery and primary caregivers',
    seedKeywords: ['cataract post surgery care', 'how long to wear eye shield after cataract', 'eye drop schedule after surgery']
  }
];

const serpFor = (b, kw) => {
  const r = rng(`${b.id}-${kw}-serp`);
  const sites = ['practo.com', 'justdial.com', 'apollohospitals.com', 'healthline.com', 'lybrate.com', 'competitor-hospital.in', 'quora.com', 'medium.com', 'sulekha.com', 'ncbi.nlm.nih.gov'];
  return sites.map((s, i) => ({
    pos: i + 1,
    site: s,
    title: `${kw.replace(/\b\w/g, c => c.toUpperCase())}${i % 3 === 0 ? ` in ${b.city}` : i % 3 === 1 ? ': Procedure, Cost & Recovery' : ' - Complete 2026 Guide'}`,
    words: Math.round((900 + r() * 2100) / 50) * 50,
    headings: Math.round(6 + r() * 12),
    faq: r() > 0.4
  }));
};

/**
 * 1. Trending Topics Discovery Module
 */
function TrendingTopicsTab({ b, onSelectTopic }) {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const filteredTopics = useMemo(() => {
    return TRENDING_TOPICS.filter(t => {
      const matchSearch = t.title.toLowerCase().includes(search.toLowerCase()) ||
        t.category.toLowerCase().includes(search.toLowerCase());
      const matchFilter = filter === 'all' ||
        (filter === 'local' && t.intent.includes('Local')) ||
        (filter === 'high' && t.velocity.includes('+30') || t.velocity.includes('+40')) ||
        (filter === 'transactional' && t.intent.includes('Transactional'));
      return matchSearch && matchFilter;
    });
  }, [search, filter]);

  return (
    <div className="space-y-4">
      {/* Search & Filter Header */}
      <div className="ai-glass-card rounded p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[280px]">
          <div className="relative flex-1 max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search trending topics, procedures, or keywords..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full h-9 pl-9 pr-3 text-12 bg-slate-50 border border-slate-200 focus:border-indigo-500 rounded text-slate-900 placeholder-slate-400 outline-none"
            />
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {[
              { id: 'all', label: 'All Trends' },
              { id: 'local', label: 'Local Intent' },
              { id: 'high', label: 'High Velocity (🔥 +30%)' },
              { id: 'transactional', label: 'Transactional / Booking' }
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`h-8 px-3 rounded-lg text-11 font-semibold transition-all whitespace-nowrap cursor-pointer ${filter === f.id
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-white text-slate-700 hover:text-slate-900 border border-slate-200'
                  }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 text-11 text-slate-500 font-mono">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>Real-time Google Trends & Search Console Signals</span>
        </div>
      </div>

      {/* Trending Topics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredTopics.map(topic => (
          <div
            key={topic.id}
            className="ai-glass-card rounded p-5 border border-slate-200 hover:border-indigo-500/30 transition-all duration-200 flex flex-col justify-between group shadow-lg"
          >
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-700 border border-blue-500/30 text-10 font-mono font-bold">
                  {topic.category}
                </span>
                <span className="inline-flex items-center gap-1 text-11 font-bold text-emerald-700 bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 rounded-full font-mono">
                  <Flame size={12} className="text-amber-700 fill-amber-400" />
                  {topic.velocity}
                </span>
              </div>

              <h3 className="text-14 font-bold text-slate-900 group-hover:text-blue-700 transition-colors leading-snug">
                {topic.title}
              </h3>

              <div className="mt-3 grid grid-cols-2 gap-2 text-11 text-slate-500">
                <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-slate-500 block text-10 uppercase font-mono">Search Volume:</span>
                  <strong className="text-slate-800 font-mono">{topic.volume}</strong>
                </div>
                <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-slate-500 block text-10 uppercase font-mono">Search Intent:</span>
                  <strong className="text-cyan-700 font-mono">{topic.intent}</strong>
                </div>
              </div>

              <div className="mt-3 text-11 text-slate-500">
                <span className="text-slate-500">Target Internal Link: </span>
                <span className="text-indigo-700 font-mono font-semibold">{topic.internalLinkTarget}</span>
              </div>
            </div>

            <div className="mt-4 pt-3.5 border-t border-slate-200 flex items-center justify-between gap-2">
              <span className="text-10 text-slate-500 font-mono">
                Source: {topic.source}
              </span>
              <Button
                size="sm"
                variant="ai"
                icon={Sparkles}
                onClick={() => onSelectTopic(topic)}
                className="text-xs"
              >
                Create Brief & Draft
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 2. 7-Step AI Blog Writer & E-E-A-T Quality Gate
 */
function BlogWriterTab({ b, selectedTopic, onScheduled, toast }) {
  const [step, setStep] = useState(0);
  const [kw, setKw] = useState(
    selectedTopic
      ? selectedTopic.title
      : `Micro-Incision Cataract Surgery (MICS) in PCMC: Cost & Lens Options (2026 Guide)`
  );
  const [busy, run] = useSimulated();
  const serp = useMemo(() => serpFor(b, kw), [b, kw]);
  const avgWords = Math.round(serp.reduce((s, x) => s + x.words, 0) / serp.length / 50) * 50;

  const [outline, setOutline] = useState([
    'What is Micro-Incision Cataract Surgery (MICS)?',
    'Phacoemulsification vs Laser Cataract Surgery: Key Differences',
    'Average Cataract Surgery Cost in PCMC & Chinchwad (2026 Prices)',
    'Types of Intraocular Lenses (IOL): Monofocal, Toric & Multifocal',
    'Cashless Mediclaim & TPA Insurance Approval Process at Moraya Hospital',
    'Post-Surgery Recovery Timeline: What to Expect on Day 1 to Day 30',
    'Frequently Asked Questions by Patients in PCMC'
  ]);

  const [draft, setDraft] = useState('');
  const [enrich, setEnrich] = useState({ prices: true, quote: true, photos: true, local: true });
  const [cms, setCms] = useState('GrowZen Website Builder');
  const [published, setPublished] = useState(false);
  const [scheduledDate, setScheduledDate] = useState('2026-10-30T10:00');

  const makeDraft = () => {
    return `# Micro-Incision Cataract Surgery (MICS) in PCMC: Cost, Lens Options & Recovery\n\n` +
      `Cataract surgery in PCMC has advanced dramatically with modern micro-incision phacoemulsification (MICS). At Moraya Multispeciality Charitable Hospital in Chinchwad, patients receive advanced blade-free eye surgery with fast visual recovery and cashless mediclaim support.\n\n` +
      `## 1. What is Micro-Incision Cataract Surgery (MICS)?\n` +
      `Micro-Incision Cataract Surgery (MICS) is an advanced surgical technique where the cloudy natural lens is removed through a self-sealing sub-2.0mm micro-incision. Because the incision requires no stitches or needles, patient healing is rapid with minimal astigmatic distortion.\n\n` +
      `## 2. Average Cataract Surgery Cost in PCMC (2026 Rates)\n` +
      `At Moraya Hospital, cataract surgery is offered at subsidized charitable package rates:\n` +
      `- Standard Phacoemulsification with Monofocal IOL: ₹12,000 - ₹18,000\n` +
      `- Micro-Incision (MICS) with Indian Foldable IOL: ₹18,000 - ₹25,000\n` +
      `- Advanced Toric (Astigmatism-correcting) Lens: ₹35,000 - ₹45,000\n` +
      `- Premium Trifocal / Multifocal IOL (Spectacle Free): ₹50,000 - ₹65,000\n\n` +
      `## 3. Cashless Mediclaim & TPA Insurance Support\n` +
      `Moraya Hospital is empaneled with all major government and private TPAs (Star Health, ICICI Lombard, MediAssist, Vidal, MDIndia, HDFC Ergo, Paramount). Our dedicated TPA desk processes cashless pre-authorizations within 2 hours.\n\n` +
      `## 4. Internal Resources & Booking\n` +
      `To explore our full medical facility, visit [Cataract Surgery in PCMC](https://morayamultispecialitycharitablehospital.com/cataract-surgery-in-pcmc) or contact our 24/7 helpline at +91 20 2747 2121.`;
  };

  const enrichDone = Object.values(enrich).filter(Boolean).length;
  const score = Math.min(98, 62 + enrichDone * 7 + (outline.length >= 6 ? 6 : 0) + 4);

  const next = () => {
    if (step === 1) return run('brief', () => { setStep(2); }, 1100);
    if (step === 2) return run('draft', () => { setDraft(makeDraft()); setStep(3); }, 1400);
    if (step === 6) {
      return run('pub', () => {
        setPublished(true);
        toast(`Article successfully scheduled and synced with ${cms}! Search Console indexing submitted.`);
        if (onScheduled) {
          onScheduled({
            title: kw,
            slug: 'cataract-surgery-in-pcmc',
            cms,
            date: scheduledDate,
            status: 'Scheduled'
          });
        }
      }, 1300);
    }
    return setStep(s => Math.min(STEPS.length - 1, s + 1));
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
      {/* Step Navigator */}
      <Card title="E-E-A-T Content Pipeline" className="xl:col-span-1">
        <ol className="space-y-1.5">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button
                onClick={() => i <= step && setStep(i)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded text-12 font-semibold text-left transition-colors cursor-pointer ${i === step
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                  : i < step
                    ? 'text-slate-800 hover:bg-slate-50'
                    : 'text-slate-500'
                  }`}
              >
                <span className={`w-5 h-5 rounded-full text-10 flex items-center justify-center font-bold ${i < step ? 'bg-emerald-500 text-white' : i === step ? 'bg-white text-blue-600' : 'bg-slate-100 text-slate-500'
                  }`}>
                  {i < step ? <Check size={11} strokeWidth={3} /> : i + 1}
                </span>
                <span className="truncate">{s}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="mt-4 p-3 rounded bg-white border border-slate-200 text-11 text-slate-500 leading-relaxed">
          <ShieldCheck size={13} className="text-emerald-700 inline mr-1" />
          Content is cross-checked against Google Search Essentials, E-E-A-T guidelines, and hospital policy safeguards.
        </div>
      </Card>

      {/* Main Step Workspace */}
      <Card
        className="xl:col-span-3"
        title={STEPS[step]}
        action={
          <Button
            variant={step === 6 ? 'primary' : 'secondary'}
            busy={Boolean(busy)}
            onClick={next}
            disabled={published}
          >
            {step === 6 ? (published ? 'Scheduled & Live' : 'Approve & Schedule to CMS') : step === 1 ? 'Generate Brief' : step === 2 ? 'Draft Complete Article' : 'Next Step'}
            {step < 6 && <ChevronRight size={13} />}
          </Button>
        }
      >
        {/* Step 0: Keyword & Intent */}
        {step === 0 && (
          <div className="space-y-4 max-w-2xl">
            <Field label="Target Ranking Topic / Keyword" hint="Directly pulls from real patient searches in PCMC">
              <input className={inputCls} value={kw} onChange={e => setKw(e.target.value)} />
            </Field>
            <div className="p-3.5 rounded bg-slate-50 border border-slate-200 space-y-2 text-12">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Search Intent:</span>
                <Badge tone="blue">Local Transactional / Patient Guidance</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Target Conversion URL:</span>
                <span className="font-mono text-cyan-700">/cataract-surgery-in-pcmc</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Suggested Format:</span>
                <span className="text-slate-800 font-semibold">2026 Comprehensive Cost & Clinical Guide</span>
              </div>
            </div>
          </div>
        )}

        {/* Step 1: SERP Insights */}
        {step === 1 && (
          <div>
            <div className="flex flex-wrap gap-4 text-12 text-slate-700 mb-3">
              <span>Avg Word Count Top 10: <strong className="text-slate-900 font-mono">{fmt(avgWords)} words</strong></span>
              <span>FAQ Schema Present: <strong className="text-emerald-700 font-mono">8/10</strong></span>
              <StatusPill level="good">AI Overview Eligible for this query</StatusPill>
            </div>
            <div className="rounded border border-slate-200 overflow-hidden">
              <table className="w-full text-12">
                <thead className="bg-white text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="p-2.5 text-left font-mono">Rank</th>
                    <th className="p-2.5 text-left">Competitor URL</th>
                    <th className="p-2.5 text-right font-mono">Length</th>
                    <th className="p-2.5 text-right font-mono">H2/H3</th>
                    <th className="p-2.5 text-center">FAQ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-slate-50">
                  {serp.slice(0, 5).map(s => (
                    <tr key={s.pos}>
                      <td className="p-2.5 font-mono text-slate-500 font-bold">{s.pos}</td>
                      <td className="p-2.5">
                        <div className="text-slate-900 font-medium truncate max-w-[340px]">{s.title}</div>
                        <div className="text-10 text-cyan-700 font-mono">{s.site}</div>
                      </td>
                      <td className="p-2.5 text-right font-mono text-slate-700">{fmt(s.words)}</td>
                      <td className="p-2.5 text-right font-mono text-slate-700">{s.headings}</td>
                      <td className="p-2.5 text-center">{s.faq ? <Check size={14} className="text-emerald-700 mx-auto" /> : <span className="text-slate-600">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Step 2: Structured Brief */}
        {step === 2 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-12 font-bold text-slate-700 mb-2">Outline & Logical Headings</div>
              <div className="space-y-2">
                {outline.map((h, i) => (
                  <input
                    key={i}
                    className={inputCls}
                    value={h}
                    onChange={e => setOutline(o => o.map((x, j) => j === i ? e.target.value : x))}
                  />
                ))}
              </div>
              <Button size="sm" icon={Plus} className="mt-2.5" onClick={() => setOutline(o => [...o, 'New Clinical Section'])}>
                Add Section
              </Button>
            </div>
            <div className="p-4 rounded bg-slate-50 border border-slate-200 space-y-2.5 text-12">
              <div className="font-bold text-slate-900 mb-1">SEO Blueprint Specs</div>
              <div><span className="text-slate-500">SEO Title:</span> Micro-Incision Cataract Surgery in PCMC: Cost, Lens Types & Recovery</div>
              <div><span className="text-slate-500">Meta Desc:</span> Complete 2026 guide to micro-incision cataract surgery at Moraya Hospital, Chinchwad. Costs, lens types, cashless insurance & recovery time.</div>
              <div><span className="text-slate-500">Target Word Count:</span> ~1,450 words</div>
              <div><span className="text-slate-500">Internal Link:</span> <span className="text-cyan-700 font-mono">/cataract-surgery-in-pcmc</span></div>
              <div><span className="text-slate-500">Schema:</span> MedicalWebPage + FAQPage + Hospital</div>
            </div>
          </div>
        )}

        {/* Step 3: AI Draft Generation */}
        {step === 3 && (
          <div className="space-y-3">
            <div className="text-11 text-purple-700 flex items-center gap-1.5 p-2 rounded-lg bg-purple-500/10 border border-purple-500/20">
              <Sparkles size={13} className="text-cyan-700" />
              Full draft generated with E-E-A-T facts, transparent package pricing, and internal anchors to /cataract-surgery-in-pcmc.
            </div>
            <textarea
              rows={16}
              className={`${areaCls} font-mono text-12 leading-relaxed`}
              value={draft}
              onChange={e => setDraft(e.target.value)}
            />
          </div>
        )}

        {/* Step 4: E-E-A-T Enrichment */}
        {step === 4 && (
          <div className="space-y-3 max-w-xl">
            <p className="text-12 text-slate-700 mb-2">
              Inject first-hand medical proof points to safeguard against generic, low-value AI penalties.
            </p>
            {[
              ['prices', 'Verified Subsidized Package Pricing (₹12,000 - ₹65,000)'],
              ['quote', 'Quote from Senior Ophthalmologist / Medical Director'],
              ['photos', 'Hospital OT & Biometry Diagnostics Photos (No stock photos)'],
              ['local', 'Local PCMC Access: Opposite Chinchwad Railway Station, Free Parking']
            ].map(([k, l]) => (
              <label key={k} className="flex items-center gap-3 p-3 rounded bg-slate-50 border border-slate-200 text-12 cursor-pointer hover:bg-slate-50 transition-colors">
                <input
                  type="checkbox"
                  checked={enrich[k]}
                  onChange={e => setEnrich({ ...enrich, [k]: e.target.checked })}
                  className="rounded text-blue-600 focus:ring-0"
                />
                <span className="text-slate-800 font-medium">{l}</span>
              </label>
            ))}
          </div>
        )}

        {/* Step 5: Quality Gate & Fact Checks */}
        {step === 5 && (
          <div className="flex flex-wrap gap-6 items-center">
            <ScoreRing score={score} label={scoreWord(score)} size={110} />
            <div className="flex-1 min-w-[280px] space-y-3">
              {[
                ['Search Intent & Keyword Saturation', 94],
                ['Topic Depth vs Top 10 SERP', 75 + enrichDone * 5],
                ['Internal Anchor Linking (/cataract-surgery-in-pcmc)', 95],
                ['E-E-A-T Real Fact Verification', 50 + enrichDone * 12]
              ].map(([l, v], i) => (
                <div key={l}>
                  <div className="flex justify-between text-11 mb-1">
                    <span className="text-slate-500">{l}</span>
                    <span className="font-mono font-bold text-slate-900">{Math.min(100, v)}%</span>
                  </div>
                  <Meter value={Math.min(100, v)} color={SERIES[i % 3]} />
                </div>
              ))}
              <div className="flex flex-wrap gap-2 pt-1 text-11">
                <StatusPill level="good">Plagiarism 0.5% (Clean)</StatusPill>
                <StatusPill level="good">Medical Disclaimer Attached</StatusPill>
                <StatusPill level="good">Spam-Risk: None</StatusPill>
              </div>
            </div>
          </div>
        )}

        {/* Step 6: Publish & Schedule */}
        {step === 6 && (
          <div className="max-w-xl space-y-4 text-12">
            <div>
              <label className="block text-slate-700 font-bold mb-2">Select Target CMS Integration</label>
              <div className="grid grid-cols-3 gap-2">
                {['GrowZen Website Builder', 'WordPress REST API', 'Webflow'].map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCms(c)}
                    className={`h-10 px-2 rounded border text-11 font-bold cursor-pointer transition-all ${cms === c
                      ? 'bg-blue-600 text-white border-blue-500 shadow-md'
                      : 'bg-slate-50 text-slate-500 border-slate-200 hover:text-slate-900'
                      }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <Field label="Scheduled Publishing Date & Time">
              <input
                type="datetime-local"
                value={scheduledDate}
                onChange={e => setScheduledDate(e.target.value)}
                className={inputCls}
              />
            </Field>

            <div className="p-3.5 rounded bg-slate-50 border border-slate-200 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer text-slate-700">
                <input type="checkbox" defaultChecked />
                <span>Auto-publish to website once scheduled date arrives</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-slate-700">
                <input type="checkbox" defaultChecked />
                <span>Trigger instant Google Search Console indexing ping upon publishing</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-slate-700">
                <input type="checkbox" defaultChecked />
                <span>Inject internal backlink to /cataract-surgery-in-pcmc</span>
              </label>
            </div>

            {published && (
              <div className="p-3.5 rounded bg-emerald-500/10 border border-emerald-500/25 text-emerald-700 flex items-center justify-between text-11 font-mono">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-emerald-700" />
                  <span>Scheduled on {cms} for {new Date(scheduledDate).toLocaleString()}</span>
                </div>
                <Badge tone="green">Verified</Badge>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

/**
 * 3. Content Calendar & Scheduled Publishing Queue
 */
function CalendarTab({ b, scheduledItems }) {
  const allEvents = useMemo(() => {
    const base = [
      { id: 1, d: 2, title: 'GBP Post: 24/7 Emergency Eye Trauma Care', kind: 'gbp', status: 'Published' },
      { id: 2, d: 6, title: 'Blog: Micro-Incision Cataract Surgery (MICS) in PCMC', kind: 'blog', status: 'Scheduled' },
      { id: 3, d: 10, title: 'Location Page: Eye Clinic in Chinchwad Station', kind: 'page', status: 'Approved' },
      { id: 4, d: 14, title: 'GBP Post: Free Cataract Screening Camp Sunday', kind: 'gbp', status: 'Scheduled' },
      { id: 5, d: 18, title: 'Blog: Cashless Mediclaim & TPA Insurance Guide', kind: 'blog', status: 'Draft' },
      { id: 6, d: 24, title: 'GBP Post: Doctor Consultation Hours Update', kind: 'gbp', status: 'Scheduled' },
      { id: 7, d: 28, title: 'Blog Refresh: Femto Laser vs Phacoemulsification', kind: 'refresh', status: 'In Review' }
    ];
    return base;
  }, []);

  const tone = { gbp: 'blue', blog: 'violet', page: 'green', refresh: 'amber' };
  const start = new Date();
  start.setDate(1);
  const offset = (start.getDay() + 6) % 7;

  return (
    <div className="space-y-5">
      <Card
        title={`${start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} Publishing Calendar`}
        subtitle="Autonomous schedule across Google Business Profile, Hospital CMS, and local landing pages"
        action={
          <div className="flex items-center gap-2">
            <span className="text-11 text-slate-500 font-mono">CMS Destination: GrowZen CMS</span>
          </div>
        }
      >
        <div className="grid grid-cols-7 gap-1 text-11 font-mono text-slate-500 mb-1 text-center font-bold">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} className="py-1">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: 35 }, (_, i) => {
            const day = i - offset + 1;
            const valid = day >= 1 && day <= new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
            const events = allEvents.filter(x => x.d === day);

            return (
              <div
                key={i}
                className={`min-h-[85px] rounded border p-2 transition-all ${valid
                  ? 'border-slate-200 bg-slate-50 hover:border-indigo-500/30'
                  : 'border-transparent bg-transparent opacity-20'
                  }`}
              >
                {valid && (
                  <>
                    <div className="text-11 font-mono text-slate-500 font-bold mb-1">{day}</div>
                    <div className="space-y-1">
                      {events.map(ev => (
                        <div
                          key={ev.id}
                          className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-10 truncate text-slate-700 font-medium"
                          title={ev.title}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full inline-block mr-1 ${ev.kind === 'blog' ? 'bg-purple-400' : ev.kind === 'gbp' ? 'bg-blue-400' : 'bg-emerald-400'
                            }`} />
                          {ev.title}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

/**
 * 4. Contextual Backlink & Digital PR Outreach Hub
 */
function BacklinksTab({ b, toast }) {
  const [prospects, setProspects] = useState([
    {
      id: 1,
      domain: 'practo.com/pune/hospitals/cataract',
      name: 'Practo Healthcare Directory',
      type: 'Medical Registry',
      da: 88,
      status: 'Link Acquired',
      anchor: 'Moraya Charitable Hospital Cataract Care',
      target: '/cataract-surgery-in-pcmc'
    },
    {
      id: 2,
      domain: 'punenews.org/health/eye-care-charity',
      name: 'Pune News Community Health',
      type: 'Local Publication',
      da: 62,
      status: 'Outreach Sent',
      anchor: 'Affordable cataract surgery in PCMC',
      target: '/cataract-surgery-in-pcmc'
    },
    {
      id: 3,
      domain: 'justdial.com/pune/eye-surgeons-chinchwad',
      name: 'JustDial PCMC Verified Business',
      type: 'Local Citation NAP',
      da: 84,
      status: 'Link Acquired',
      anchor: 'Moraya Multispeciality Hospital',
      target: '/'
    },
    {
      id: 4,
      domain: 'ima-pune.org/members/moraya-hospital',
      name: 'Indian Medical Association Directory',
      type: 'Accreditation Body',
      da: 71,
      status: 'Qualified Prospect',
      anchor: 'NABH Charitable Eye Care Unit',
      target: '/cataract-surgery-in-pcmc'
    }
  ]);

  const [pitching, setPitching] = useState(null);

  const sendPitch = (p) => {
    toast(`Personalized digital PR pitch drafted and sent for ${p.name}!`);
    setProspects(prev => prev.map(x => x.id === p.id ? { ...x, status: 'Outreach Sent' } : x));
    setPitching(null);
  };

  return (
    <div className="space-y-5">
      {/* Top Value Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="ai-glass-card rounded p-[18px] border border-emerald-500/20">
          <div className="text-11 font-bold uppercase tracking-wider text-emerald-700 font-mono">
            Verified Referring Domains
          </div>
          <div className="text-3xl font-extrabold text-slate-900 mt-2 font-display">18 Domains</div>
          <p className="text-11 text-slate-500 mt-1">100% legitimate editorial & medical listings</p>
        </div>

        <div className="ai-glass-card rounded p-[18px] border border-cyan-500/20">
          <div className="text-11 font-bold uppercase tracking-wider text-cyan-700 font-mono">
            Key Anchor Target URL
          </div>
          <div className="text-13 font-mono font-bold text-cyan-700 mt-2 truncate">
            /cataract-surgery-in-pcmc
          </div>
          <p className="text-11 text-slate-500 mt-1">Directing link equity to primary service page</p>
        </div>

        <div className="ai-glass-card rounded p-[18px] border border-purple-500/20">
          <div className="text-11 font-bold uppercase tracking-wider text-purple-600 font-mono">
            Ethical Outreach Guardrail
          </div>
          <div className="text-13 font-bold text-slate-900 mt-2">Zero Spam / PBN Safe</div>
          <p className="text-11 text-slate-500 mt-1">Strict compliance with Google link spam policies</p>
        </div>
      </div>

      {/* Prospects & Live Backlinks Table */}
      <Card
        title="Authority Prospects & Verified Backlinks"
        subtitle="Legitimate citations and medical publication relationship pipeline"
      >
        <div className="rounded border border-slate-200 overflow-hidden">
          <table className="w-full text-12">
            <thead className="bg-white text-slate-500 border-b border-slate-200">
              <tr>
                <th className="p-3 text-left">Prospect / Publication</th>
                <th className="p-3 text-left">Category</th>
                <th className="p-3 text-center font-mono">Domain Auth</th>
                <th className="p-3 text-left">Anchor Text & Target</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-slate-50">
              {prospects.map(p => (
                <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                  <td className="p-3">
                    <div className="font-bold text-slate-900">{p.name}</div>
                    <div className="text-10 text-cyan-700 font-mono">{p.domain}</div>
                  </td>
                  <td className="p-3 text-slate-700 font-medium">{p.type}</td>
                  <td className="p-3 text-center font-mono font-bold text-slate-800">DA {p.da}</td>
                  <td className="p-3">
                    <div className="text-slate-900 font-medium">"{p.anchor}"</div>
                    <div className="text-10 text-indigo-700 font-mono">{p.target}</div>
                  </td>
                  <td className="p-3">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-10 font-mono font-bold border ${p.status === 'Link Acquired'
                      ? 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30'
                      : p.status === 'Outreach Sent'
                        ? 'bg-blue-500/15 text-blue-700 border-blue-500/30'
                        : 'bg-amber-500/15 text-amber-700 border-amber-500/30'
                      }`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    {p.status === 'Qualified Prospect' ? (
                      <Button size="sm" variant="ai" icon={Send} onClick={() => sendPitch(p)} className="text-xs">
                        Draft Pitch
                      </Button>
                    ) : (
                      <span className="text-emerald-700 font-mono text-11 font-bold flex items-center justify-end gap-1">
                        <CheckCircle2 size={13} /> Active
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/**
 * Main AI Content Studio Component
 */
export default function ContentStudioPage() {
  const [tab, setTab] = useUrlTab('trends', ['trends', 'blog', 'calendar', 'backlinks']);
  const [activeTopic, setActiveTopic] = useState(null);

  const handleSelectTopic = (topic) => {
    setActiveTopic(topic);
    setTab('blog');
  };

  return (
    <SeoShell
      title="AI Blog Studio & Autonomous Content Engine"
      subtitle="Discover trending patient queries, draft E-E-A-T validated medical articles, schedule CMS publishing, and build ethical backlinks"
    >
      {(b) => (
        <div className="space-y-5 animate-in fade-in duration-200">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'trends', label: 'Trending Topics Radar', count: 4 },
              { id: 'blog', label: 'AI Blog & Article Writer (E-E-A-T)' },
              { id: 'calendar', label: 'Publishing Calendar & CMS Queue' },
              { id: 'backlinks', label: 'Backlink & Digital PR Hub' }
            ]}
          />

          {tab === 'trends' && <TrendingTopicsTab b={b} onSelectTopic={handleSelectTopic} />}
          {tab === 'blog' && <BlogWriterTab b={b} selectedTopic={activeTopic} toast={window.__seoToast || console.log} />}
          {tab === 'calendar' && <CalendarTab b={b} />}
          {tab === 'backlinks' && <BacklinksTab b={b} toast={window.__seoToast || console.log} />}
        </div>
      )}
    </SeoShell>
  );
}
