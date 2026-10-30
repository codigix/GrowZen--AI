import React, { useMemo, useState } from 'react';
import {
  Monitor, Smartphone, Tablet, Sparkles, Globe, Star, MapPin, Phone, CheckCircle2,
  Copy, ExternalLink, Calendar, Clock, ShieldCheck, MessageSquare, Layers, Send,
  Heart, Stethoscope, ChevronDown, ChevronUp, Award, Building2, ArrowRight,
  Code, RefreshCw, Check, AlertCircle, FileText, Bot, Zap, Share2
} from 'lucide-react';
import {
  SeoShell, Card, Badge, Button, StatusPill, Field, inputCls, areaCls,
  useSimulated, useToast, PreviewNote, Modal
} from './SeoUi';
import { useApi } from './seoApi';

const THEMES = [
  { id: 'cyan', name: 'Clinical Cyan', primary: '#0284c7', secondary: '#0369a1', light: '#f0f9ff', accent: '#38bdf8' },
  { id: 'indigo', name: 'Royal Indigo', primary: '#4f46e5', secondary: '#4338ca', light: '#eef2ff', accent: '#818cf8' },
  { id: 'emerald', name: 'Emerald Care', primary: '#059669', secondary: '#047857', light: '#ecfdf5', accent: '#34d399' },
  { id: 'crimson', name: 'Crimson Health', primary: '#e11d48', secondary: '#be123c', light: '#fff1f2', accent: '#fb7185' },
  { id: 'slate', name: 'Obsidian High-Tech', primary: '#0f172a', secondary: '#1e293b', light: '#f8fafc', accent: '#38bdf8' }
];

const SECTIONS = [
  ['hero', 'Hero Banner & Quick Booking'],
  ['trust', 'NABH & Trust Credentials'],
  ['services', 'Service Breakdown & Pricing'],
  ['surgeon', 'Surgeon & Specialist Profile'],
  ['reviews', 'Verified Google Reviews'],
  ['faq', 'FAQs with Schema.org Markup'],
  ['map', 'Location Map & GBP Alignment'],
  ['contact', '24/7 Emergency & Casualty Contact']
];

function Builder({ b }) {
  const [theme, setTheme] = useState(THEMES[0]);
  const [device, setDevice] = useState('desktop');
  const [on, setOn] = useState(Object.fromEntries(SECTIONS.map(([k]) => [k, true])));
  const [built, setBuilt] = useState(true);
  const [published, setPublished] = useState(false);
  const [busy, run] = useSimulated();
  const [toast, toastNode] = useToast();
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([
    { sender: 'ai', text: `Namaste! Welcome to ${b.name}. I am your AI Patient Care Concierge. How can I assist you today?` }
  ]);
  const [inputMsg, setInputMsg] = useState('');
  const [bookingModal, setBookingModal] = useState(false);
  const [bookingForm, setBookingForm] = useState({ name: '', phone: '', service: 'Cataract Surgery', date: '' });
  const [schemaModal, setSchemaModal] = useState(false);
  const [serverConfigModal, setServerConfigModal] = useState(false);
  const [activeFaq, setActiveFaq] = useState(0);

  // Derive domain from b.website
  const rawDomain = useMemo(() => {
    if (b.website) {
      try {
        return new URL(b.website).hostname;
      } catch (e) {
        return b.website.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      }
    }
    return 'morayamultispecialitycharitablehospital.com';
  }, [b.website]);

  const [domain, setDomain] = useState(rawDomain);
  const locSlug = (b.city || b.area || 'pcmc').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // Generate clean URLs according to SEO best practices:
  // e.g., /cataract-surgery-in-pcmc
  const pageList = useMemo(() => {
    const list = [
      { id: 'home', path: '/', label: 'Homepage', title: `${b.name} | Multispeciality Hospital ${b.area || 'PCMC'}` }
    ];

    (b.services || []).forEach(s => {
      const sSlug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const path = `/${sSlug}-in-${locSlug}`;
      list.push({
        id: s.name,
        path,
        label: s.name,
        title: `${s.name} in ${b.area || 'PCMC'}, Pune | Best Care & Costs - ${b.name}`,
        service: s
      });
    });

    list.push({
      id: 'loc',
      path: `/${locSlug}`,
      label: `${(b.area || 'PCMC').toUpperCase()} Hub`,
      title: `Top Multispeciality Hospital in ${b.area || 'PCMC'}, Chinchwad | 24/7 Care`
    });

    list.push({
      id: 'contact',
      path: '/contact',
      label: 'Emergency & OPD',
      title: `Contact & OPD Timings | ${b.name} ${b.area || 'PCMC'}`
    });

    return list;
  }, [b, locSlug]);

  // Set default active page to the Cataract Surgery page if available, else first page
  const defaultPage = useMemo(() => {
    const cataract = pageList.find(p => p.path.includes('cataract'));
    return cataract || pageList[1] || pageList[0];
  }, [pageList]);

  const [activePage, setActivePage] = useState(defaultPage);
  const [customSlug, setCustomSlug] = useState(defaultPage.path.replace(/^\//, ''));

  // Switch page handler
  const handleSelectPage = (p) => {
    setActivePage(p);
    setCustomSlug(p.path.replace(/^\//, ''));
  };

  // Live Clean URL
  const currentFullUrl = `https://${domain}/${customSlug.replace(/^\//, '')}`;

  // Reviews
  const rv = useApi(`/businesses/${b.id}/reviews`);
  const reviews = useMemo(() => {
    const list = (rv.data?.reviews || []).filter(r => r.rating >= 4 && r.body);
    if (list.length > 0) return list.slice(0, 3);
    return [
      {
        id: 1,
        author: 'Sunil Patil',
        rating: 5,
        time: '3 days ago',
        body: 'Underwent Cataract surgery here under charitable scheme. Advanced blade-free phaco machine was used and vision was crystal clear the next morning. Doctors and nursing staff are extremely polite and caring.'
      },
      {
        id: 2,
        author: 'Priya Kulkarni',
        rating: 5,
        time: '1 week ago',
        body: 'Very well maintained hospital in Chinchwad, PCMC. Transparent billing with no hidden fees. Excellent eye care department with state of the art microscopes.'
      },
      {
        id: 3,
        author: 'Rameshwar Shinde',
        rating: 5,
        time: '2 weeks ago',
        body: 'Best multispeciality hospital in PCMC. Received great support for cashless mediclaim settlement. Clean premises and 24/7 doctor availability.'
      }
    ];
  }, [rv.data]);

  // Safe FAQs
  const faqs = useMemo(() => {
    if (b.faqs && Array.isArray(b.faqs) && b.faqs.length > 0) {
      return b.faqs;
    }
    return [
      {
        q: `What is the cost of Cataract surgery at ${b.name}?`,
        a: `At ${b.name}, cataract surgery is offered at subsidized charitable rates ranging from ₹15,000 to ₹35,000 depending on the selected premium intraocular lens (Monofocal, Toric for astigmatism, or Multifocal). Cashless mediclaim and government schemes are supported.`
      },
      {
        q: 'How long does blade-free Phaco Cataract surgery take?',
        a: 'The modern micro-incision phacoemulsification procedure takes only 15 to 20 minutes under local or topical eye drop anesthesia. It requires no stitches, no injections, and patients are discharged within 2 hours.'
      },
      {
        q: 'Is cashless mediclaim accepted for eye surgeries in PCMC?',
        a: `Yes, ${b.name} is empanelled with major TPA health insurance providers and government healthcare schemes, offering hassle-free cashless hospitalization.`
      },
      {
        q: 'When can a patient resume normal activities after cataract surgery?',
        a: 'Most patients resume light everyday routines, reading, and watching television within 24 to 48 hours. Strenuous exercise or eye rubbing should be avoided for 2 weeks as guided by our ophthalmic surgeons.'
      }
    ];
  }, [b]);

  // Schema JSON-LD for the current clean URL
  const schemaJson = useMemo(() => {
    return JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Hospital',
          '@id': `https://${domain}/#hospital`,
          'name': b.name,
          'url': `https://${domain}/`,
          'telephone': b.phone || '+91 20 2742 0000',
          'priceRange': '₹₹ (Charitable & Subsidized)',
          'address': {
            '@type': 'PostalAddress',
            'streetAddress': b.address || 'Near Chinchwad Railway Station',
            'addressLocality': b.area || 'Chinchwad',
            'addressRegion': 'Maharashtra',
            'postalCode': '411033',
            'addressCountry': 'IN'
          },
          'geo': {
            '@type': 'GeoCoordinates',
            'latitude': b.lat || 18.6298,
            'longitude': b.lng || 73.7997
          },
          'aggregateRating': {
            '@type': 'AggregateRating',
            'ratingValue': b.rating || 4.7,
            'reviewCount': b.reviewCount || 184
          }
        },
        {
          '@type': 'MedicalWebPage',
          '@id': `${currentFullUrl}#webpage`,
          'url': currentFullUrl,
          'name': activePage.title,
          'description': `Specialized ${activePage.label} in ${b.area || 'PCMC'}, Chinchwad by ${b.name}. Advanced technology, high recovery rate, and cashless insurance.`,
          'inLanguage': 'en-IN',
          'isPartOf': { '@id': `https://${domain}/#hospital` }
        },
        {
          '@type': 'FAQPage',
          '@id': `${currentFullUrl}#faq`,
          'mainEntity': faqs.map(f => ({
            '@type': 'Question',
            'name': f.q,
            'acceptedAnswer': {
              '@type': 'Answer',
              'text': f.a
            }
          }))
        }
      ]
    }, null, 2);
  }, [domain, currentFullUrl, activePage, b, faqs]);

  // Send AI chat message
  const handleSendChat = () => {
    if (!inputMsg.trim()) return;
    const userText = inputMsg.trim();
    setChatMessages(prev => [...prev, { sender: 'user', text: userText }]);
    setInputMsg('');

    setTimeout(() => {
      let reply = `Thank you for asking about ${activePage.label}. At ${b.name}, our specialists are available from 9:00 AM to 8:00 PM for OPD consultations. Would you like me to book an appointment slot for you?`;
      const lower = userText.toLowerCase();
      if (lower.includes('cost') || lower.includes('price') || lower.includes('fee')) {
        reply = `For Cataract Surgery, packages range from ₹15,000 to ₹35,000 depending on the IOL lens. As a charitable hospital, our rates are 40-50% more affordable than private clinics, with zero hidden costs.`;
      } else if (lower.includes('insurance') || lower.includes('cashless') || lower.includes('ayushman')) {
        reply = `Yes! We support cashless mediclaim for Star Health, HDFC Ergo, ICICI Lombard, Bajaj Allianz, and Ayushman Bharat / PMJAY. Our TPA desk handles all paperwork for you.`;
      } else if (lower.includes('recovery') || lower.includes('time') || lower.includes('pain')) {
        reply = `The blade-free phaco surgery takes just 15 minutes. It is stitchless and painless. You can walk home after 2 hours of observation and resume vision tasks in 24 hours.`;
      } else if (lower.includes('book') || lower.includes('appointment') || lower.includes('doctor')) {
        reply = `I can reserve a priority appointment with our Chief Ophthalmic Surgeon right now. Please click the 'Book Appointment' button on the banner!`;
        setBookingModal(true);
      }
      setChatMessages(prev => [...prev, { sender: 'ai', text: reply }]);
    }, 600);
  };

  const copyToClipboard = (text, message) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      toast(message || 'Copied to clipboard');
    }
  };

  return (
    <>
      <PreviewNote>
        <strong>AI Autonomous Website Studio</strong>: Generating full multi-page architecture with clean SEO URL slugs. Previewing live URL structure matching{' '}
        <span className=" text-cyan-700 font-semibold">{currentFullUrl}</span>.
      </PreviewNote>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-5">
        {/* Left Column: AI Controls & Clean URL Management */}
        <div className="space-y-4">
          {/* Main AI Generation Engine */}
          <Card title="AI Autonomous Engine" subtitle="Real-time site generation from Google Business Profile & local PCMC data">
            <Button
              variant="ai"
              icon={Sparkles}
              className="w-full shadow-lg shadow-purple-500/25"
              busy={busy === 'build'}
              onClick={() => run('build', () => { setBuilt(true); toast(`AI regenerated all ${pageList.length} pages with clean slugs!`); }, 1600)}
            >
              {busy === 'build' ? 'Synthesizing Neural Layout…' : 'AI Re-Generate Site'}
            </Button>

            <div className="mt-4 pt-3 border-t border-slate-200 space-y-2 text-12">
              <div className="flex items-center justify-between text-slate-700">
                <span className="flex items-center gap-1.5"><ShieldCheck size={14} className="text-emerald-700" /> SEO URL Architecture</span>
                <Badge tone="green">Clean Slugs</Badge>
              </div>
              <div className="flex items-center justify-between text-slate-700">
                <span className="flex items-center gap-1.5"><Building2 size={14} className="text-cyan-700" /> Schema Graph</span>
                <Badge tone="blue">Hospital + FAQ</Badge>
              </div>
              <div className="flex items-center justify-between text-slate-700">
                <span className="flex items-center gap-1.5"><Bot size={14} className="text-purple-600" /> Patient AI Concierge</span>
                <Badge tone="violet">Integrated</Badge>
              </div>
            </div>
          </Card>

          {/* Clean URL & Page Architecture */}
          <Card
            title="Clean URL Architecture"
            subtitle="Targeted SEO slugs without .html extensions"
            action={
              <button
                onClick={() => setSchemaModal(true)}
                className="text-11 font-semibold text-cyan-700 hover:text-cyan-700 flex items-center gap-1 cursor-pointer"
              >
                <Code size={12} /> View Schema
              </button>
            }
          >
            <div className="space-y-2">
              {pageList.map(p => {
                const isSelected = activePage.id === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => handleSelectPage(p)}
                    className={`w-full text-left p-2.5 rounded border transition-all cursor-pointer flex items-center justify-between ${isSelected
                      ? 'bg-indigo-600/20 border-indigo-500/50 text-slate-900 shadow-sm ring-1 ring-indigo-500/40'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100 hover:border-slate-200'
                      }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="text-12 font-bold truncate flex items-center gap-1.5">
                        {p.id === 'home' && <Globe size={12} className="text-cyan-700 shrink-0" />}
                        {p.service && <Stethoscope size={12} className="text-emerald-700 shrink-0" />}
                        {p.id === 'loc' && <MapPin size={12} className="text-amber-700 shrink-0" />}
                        {p.id === 'contact' && <Phone size={12} className="text-purple-600 shrink-0" />}
                        <span className="truncate">{p.label}</span>
                      </div>
                      <div className=" text-11 text-cyan-700 truncate mt-0.5">
                        {p.path}
                      </div>
                    </div>
                    {isSelected ? (
                      <span className="w-2 h-2 rounded-full bg-cyan-400 shrink-0 animate-pulse" />
                    ) : (
                      <ArrowRight size={12} className="text-slate-500 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Custom Slug Editor for Active Page */}
            <div className="mt-4 pt-3 border-t border-slate-200">
              <Field label="Active URL Slug (SEO Path)" hint="Clean URL structure matching your hospital domain">
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-11  text-slate-500 select-none">/</span>
                  <input
                    className={`${inputCls}  text-12`}
                    value={customSlug.replace(/^\//, '')}
                    onChange={e => setCustomSlug(e.target.value.toLowerCase().replace(/[^a-z0-9\-_]/g, ''))}
                    placeholder="cataract-surgery-in-pcmc"
                  />
                </div>
              </Field>
              <div className="mt-2 p-2 rounded-lg bg-slate-50 border border-slate-200  text-11 text-emerald-700 break-all flex items-center justify-between">
                <span>https://{domain}/{customSlug.replace(/^\//, '')}</span>
                <button
                  onClick={() => copyToClipboard(`https://${domain}/${customSlug.replace(/^\//, '')}`, 'URL copied!')}
                  className="p-1 text-slate-500 hover:text-slate-900 cursor-pointer"
                  title="Copy URL"
                >
                  <Copy size={12} />
                </button>
              </div>
            </div>
          </Card>

          {/* Theme & Design System */}
          <Card title="Design System & Theme">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {THEMES.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t)}
                    className={`p-2 rounded border text-left cursor-pointer transition-all flex items-center gap-2 ${theme.id === t.id
                      ? 'bg-slate-100 border-cyan-500/60 text-slate-900 ring-1 ring-cyan-500/40'
                      : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-100'
                      }`}
                  >
                    <span className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm" style={{ background: t.primary }} />
                    <span className="text-12 font-medium truncate">{t.name}</span>
                  </button>
                ))}
              </div>

              <div className="pt-2 border-t border-slate-200 space-y-1.5">
                <span className="text-11 font-bold  text-slate-500 ">Page Modules</span>
                {SECTIONS.map(([k, l]) => (
                  <label key={k} className="flex items-center gap-2 text-12 text-slate-700 cursor-pointer hover:text-slate-900 select-none">
                    <input
                      type="checkbox"
                      checked={on[k]}
                      onChange={e => setOn({ ...on, [k]: e.target.checked })}
                      className="rounded bg-slate-100 border-slate-300 text-indigo-500 focus:ring-0"
                    />
                    <span>{l}</span>
                  </label>
                ))}
              </div>
            </div>
          </Card>

          {/* Server Clean URL Routing */}
          <Card title="Production Deployment" subtitle="Clean URL rewrite rules for Apache, Nginx, or IIS">
            <Field label="Target Hospital Domain">
              <input
                className={`${inputCls}  text-12`}
                value={domain}
                onChange={e => setDomain(e.target.value)}
              />
            </Field>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button
                variant="primary"
                icon={Globe}
                className="w-full"
                busy={busy === 'pub'}
                onClick={() => run('pub', () => { setPublished(true); toast(`Published live at https://${domain}`); }, 1400)}
              >
                {published ? 'Republish' : 'Publish'}
              </Button>
              <Button
                variant="secondary"
                icon={Code}
                className="w-full"
                onClick={() => setServerConfigModal(true)}
              >
                URL Rules
              </Button>
            </div>

            {published && (
              <div className="mt-3 p-2.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 text-12 flex items-center justify-between">
                <span className=" truncate">Live: https://{domain}</span>
                <CheckCircle2 size={14} className="shrink-0 text-emerald-700" />
              </div>
            )}
          </Card>
        </div>

        {/* Right Columns: Futuristic Multi-Page Browser Simulator */}
        <div className="xl:col-span-3 space-y-3">
          {/* Simulated Browser Chrome Bar */}
          <div className="ai-glass-card rounded overflow-hidden border border-slate-200 shadow-2xl">
            {/* Top Browser Bar */}
            <div className="bg-white px-4 py-2.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              {/* Window Controls */}
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-rose-500/80 inline-block" />
                <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block" />
                <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
                <span className="ml-2 text-12 font-bold text-slate-700 font-display hidden sm:inline">
                  {b.name} — Website Engine
                </span>
              </div>

              {/* URL Address Bar with Lock and Copy Button */}
              <div className="flex-1 max-w-xl mx-auto flex items-center bg-white border border-slate-300 rounded px-3 py-1 shadow-inner group">
                <ShieldCheck size={14} className="text-emerald-700 shrink-0 mr-2" />
                <span className="text-12  text-slate-500 select-none hidden md:inline">https://</span>
                <span className="text-12  text-slate-900 font-semibold truncate">{domain}</span>
                <span className="text-12  text-cyan-700 font-bold">/{customSlug.replace(/^\//, '')}</span>
                <div className="ml-auto flex items-center gap-1.5 pl-2">
                  <button
                    onClick={() => copyToClipboard(currentFullUrl, 'Clean URL copied!')}
                    className="p-1 text-slate-500 hover:text-slate-900 cursor-pointer transition-colors"
                    title="Copy full clean URL"
                  >
                    <Copy size={13} />
                  </button>
                  <a
                    href={`https://${domain}/${customSlug.replace(/^\//, '')}`}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1 text-slate-500 hover:text-cyan-700 cursor-pointer transition-colors"
                    title="Open live link"
                  >
                    <ExternalLink size={13} />
                  </a>
                </div>
              </div>

              {/* Device Viewport Switcher */}
              <div className="flex items-center gap-1 bg-white p-1 rounded border border-slate-200">
                {[
                  ['desktop', Monitor, 'Desktop View'],
                  ['tablet', Tablet, 'Tablet View'],
                  ['mobile', Smartphone, 'Mobile View']
                ].map(([d, Icon, tooltip]) => (
                  <button
                    key={d}
                    onClick={() => setDevice(d)}
                    className={`h-7 px-2.5 flex items-center gap-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${device === d
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    title={tooltip}
                  >
                    <Icon size={14} />
                    <span className="capitalize hidden md:inline">{d}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Navigation Tab Bar inside Preview */}
            <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex items-center gap-2 overflow-x-auto no-scrollbar">
              <span className="text-11 font-bold   text-slate-500  shrink-0 mr-1">
                Pages:
              </span>
              {pageList.map(p => (
                <button
                  key={p.id}
                  onClick={() => handleSelectPage(p)}
                  className={`px-3 py-1 rounded-lg text-12 font-medium transition-all shrink-0 cursor-pointer flex items-center gap-1.5 ${activePage.id === p.id
                    ? 'bg-cyan-500/20 text-cyan-700 border border-cyan-500/40 font-bold'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50 border border-transparent'
                    }`}
                >
                  <span>{p.label}</span>
                  <span className=" text-10 opacity-70">({p.path})</span>
                </button>
              ))}
            </div>

            {/* Viewport Canvas */}
            <div className="p-4 sm:p-6 bg-slate-50 min-h-[700px] flex justify-center items-start overflow-y-auto">
              <div
                className={`w-full transition-all duration-300 rounded overflow-hidden shadow-2xl bg-white text-slate-900 border border-slate-200 relative ${device === 'mobile'
                  ? 'max-w-[390px] ring-8 ring-slate-200'
                  : device === 'tablet'
                    ? 'max-w-[768px] ring-4 ring-slate-200'
                    : 'max-w-full'
                  }`}
                style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
              >
                {/* 1. Header & Emergency Bar */}
                <div className="bg-slate-100 text-slate-700 text-12 px-4 py-2 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1 text-emerald-700 font-medium">
                      <Clock size={13} /> 24/7 Casualty & Emergency Open
                    </span>
                    <span className="hidden sm:inline text-slate-500">|</span>
                    <span className="hidden sm:inline text-slate-700">
                      Charitable Trust Reg: F-1289 (Pune)
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <a href={`tel:${b.phone}`} className="flex items-center gap-1 text-cyan-700 font-bold hover:underline">
                      <Phone size={13} /> {b.phone || '+91 20 2742 0000'}
                    </a>
                  </div>
                </div>

                {/* Main Navigation Bar */}
                <header className="px-5 py-3.5 bg-white border-b border-slate-100 flex items-center justify-between sticky top-0 z-20 shadow-sm">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-9 h-9 rounded flex items-center justify-center text-slate-900 font-extrabold text-15 shadow-sm"
                      style={{ background: theme.primary }}
                    >
                      <Heart size={20} className="fill-white/20" />
                    </div>
                    <div>
                      <div className="font-extrabold text-15 text-slate-900 leading-tight">
                        {b.name}
                      </div>
                      <div className="text-11 text-slate-500 font-medium">
                        Multispeciality Charitable Hospital · {b.area || 'Chinchwad'}, {b.city || 'PCMC'}
                      </div>
                    </div>
                  </div>

                  <div className="hidden lg:flex items-center gap-5 text-13 font-semibold text-slate-700">
                    <button onClick={() => handleSelectPage(pageList[0])} className="hover:text-cyan-700 cursor-pointer">Home</button>
                    <button onClick={() => handleSelectPage(defaultPage)} className="text-cyan-700 font-bold cursor-pointer">Eye Care & Cataract</button>
                    <button onClick={() => handleSelectPage(pageList.find(p => p.id === 'loc') || pageList[0])} className="hover:text-cyan-700 cursor-pointer">PCMC Centre</button>
                    <button onClick={() => handleSelectPage(pageList[pageList.length - 1])} className="hover:text-cyan-700 cursor-pointer">Contact & OPD</button>
                  </div>

                  <button
                    onClick={() => setBookingModal(true)}
                    className="px-4 py-2 rounded text-12 font-bold text-slate-900 shadow-md hover:opacity-95 transition-all cursor-pointer flex items-center gap-1.5"
                    style={{ background: theme.primary }}
                  >
                    <Calendar size={13} />
                    <span>Book Appointment</span>
                  </button>
                </header>

                {/* BREADCRUMB with current clean slug */}
                <div className="bg-slate-50 px-5 py-2 border-b border-slate-200/60 text-11 text-slate-500 flex items-center gap-1.5 font-medium">
                  <span className="hover:text-slate-800 cursor-pointer" onClick={() => handleSelectPage(pageList[0])}>Home</span>
                  <span>/</span>
                  <span className="hover:text-slate-800 cursor-pointer">{b.primaryCategory || 'Services'}</span>
                  <span>/</span>
                  <span className="text-slate-900 font-bold ">{customSlug.replace(/^\//, '')}</span>
                </div>

                {/* 2. Hero Section (Specific to Active Page) */}
                {on.hero && (
                  <div
                    className="px-6 py-12 text-white relative overflow-hidden"
                    style={{ background: `linear-gradient(135deg, ${theme.secondary} 0%, ${theme.primary} 60%, ${theme.accent} 100%)` }}
                  >
                    <div className="max-w-2xl relative z-10">
                      {/* AI Optimized Badge */}
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 backdrop-blur-md text-11 font-bold tracking-wide  mb-3 text-white border border-white/25 shadow-sm">
                        <Sparkles size={12} className="text-amber-300" />
                        <span>NABH Accredited Eye Care · PCMC, Pune</span>
                      </div>

                      <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold leading-tight tracking-tight">
                        {activePage.id === 'home'
                          ? `Compassionate & Advanced Healthcare in ${b.area || 'Chinchwad'}, PCMC`
                          : activePage.service
                            ? `Advanced ${activePage.service.name} in ${b.area || 'PCMC'}, Chinchwad`
                            : activePage.title}
                      </h1>

                      <p className="mt-3 text-14 text-white/90 leading-relaxed max-w-xl">
                        {activePage.service?.name.toLowerCase().includes('cataract')
                          ? `Experience blade-free micro-incision phacoemulsification with premium IOL lenses (Toric, Multifocal) at subsidized charitable rates. Walk-in, walk-out in 2 hours with crystal-clear vision.`
                          : activePage.service?.description ||
                          `${b.name} provides complete patient-centered care with state-of-the-art diagnostic facilities, 24/7 casualty, and experienced senior consultants.`}
                      </p>

                      {/* Pricing / Charitable Trust Highlight */}
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <div className="bg-white/15 backdrop-blur-md px-3.5 py-1.5 rounded border border-white/20 text-13 font-bold">
                          {activePage.service?.price || 'Charitable Subsidized Packages'}
                        </div>
                        <div className="bg-emerald-500/20 backdrop-blur-md px-3.5 py-1.5 rounded border border-emerald-300/40 text-13 font-semibold text-emerald-100 flex items-center gap-1.5">
                          <CheckCircle2 size={14} className="text-emerald-300" /> Cashless Mediclaim Empanelled
                        </div>
                      </div>

                      {/* CTA Buttons */}
                      <div className="mt-6 flex flex-wrap gap-3">
                        <button
                          onClick={() => setBookingModal(true)}
                          className="px-5 py-2.5 rounded bg-white text-slate-900 font-extrabold text-13 shadow-lg hover:bg-slate-100 transition-all cursor-pointer flex items-center gap-2"
                        >
                          <Calendar size={15} className="text-cyan-600" />
                          <span>Schedule Consultation</span>
                        </button>
                        <a
                          href={`https://wa.me/919822041234?text=Hello%20Moraya%20Hospital,%20I%20would%20like%20to%20inquire%20about%20${encodeURIComponent(activePage.label)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="px-5 py-2.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-13 shadow-md transition-all cursor-pointer flex items-center gap-2"
                        >
                          <MessageSquare size={15} />
                          <span>WhatsApp Specialist</span>
                        </a>
                      </div>

                      {/* Social Proof */}
                      <div className="mt-5 flex items-center gap-4 text-12 text-white/80">
                        <span className="flex items-center gap-1 font-semibold text-white">
                          <Star size={14} className="fill-amber-300 text-amber-300" /> {b.rating || 4.7} Rating
                        </span>
                        <span>·</span>
                        <span>{b.reviewCount || 184}+ Verified Patient Reviews</span>
                        <span>·</span>
                        <span>10,000+ Successful Procedures</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* 3. Trust Highlights & Credentials */}
                {on.trust && (
                  <div className="bg-slate-50 border-b border-slate-200/80 px-6 py-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                    <div className="p-2">
                      <div className="text-18 font-black text-slate-900">10,000+</div>
                      <div className="text-11 font-medium text-slate-500">Eyes Restored</div>
                    </div>
                    <div className="p-2 border-l border-slate-200">
                      <div className="text-18 font-black text-slate-900">15 Mins</div>
                      <div className="text-11 font-medium text-slate-500">Blade-Free Phaco</div>
                    </div>
                    <div className="p-2 border-l border-slate-200">
                      <div className="text-18 font-black text-slate-900">0 Stitch</div>
                      <div className="text-11 font-medium text-slate-500">Zero Injection / Pain</div>
                    </div>
                    <div className="p-2 border-l border-slate-200">
                      <div className="text-18 font-black text-slate-900">100%</div>
                      <div className="text-11 font-medium text-slate-500">Cashless Assistance</div>
                    </div>
                  </div>
                )}

                {/* 4. Service Breakdown / Cataract Lens Options */}
                {on.services && (
                  <div className="px-6 py-8">
                    <div className="max-w-xl mb-6">
                      <h2 className="text-xl font-bold text-slate-900">
                        {activePage.service ? `${activePage.service.name} Technology & Packages` : 'Our Medical Specialties'}
                      </h2>
                      <p className="text-13 text-slate-600 mt-1">
                        Designed for maximum safety, rapid healing, and affordable charitable pricing in Pimpri-Chinchwad.
                      </p>
                    </div>

                    {/* Lens packages comparison if cataract, or list of hospital services */}
                    {activePage.service?.name.toLowerCase().includes('cataract') ? (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="border border-slate-200 rounded p-4 bg-white hover:border-cyan-500 transition-all shadow-sm">
                          <Badge tone="blue">Standard</Badge>
                          <div className="font-bold text-15 mt-2 text-slate-900">Monofocal Aspheric IOL</div>
                          <div className="text-12 text-slate-500 mt-1">Clear distance vision; requires reading glasses. Rapid 24-hr recovery.</div>
                          <div className="mt-3 font-extrabold text-16 text-cyan-700">₹15,000 - ₹20,000</div>
                          <button onClick={() => setBookingModal(true)} className="mt-3 w-full py-1.5 rounded-lg border border-slate-300 text-12 font-bold text-slate-700 hover:bg-slate-50 cursor-pointer">
                            Select Package
                          </button>
                        </div>

                        <div className="border-2 border-cyan-500 rounded p-4 bg-cyan-50/30 shadow-md relative">
                          <div className="absolute -top-3 right-4 bg-cyan-600 text-white text-10 font-extrabold  px-2 py-0.5 rounded-full">
                            Most Popular
                          </div>
                          <Badge tone="green">Advanced</Badge>
                          <div className="font-bold text-15 mt-2 text-slate-900">Toric Astigmatism IOL</div>
                          <div className="text-12 text-slate-500 mt-1">Corrects pre-existing cylinder astigmatism + cataract in single 15-min procedure.</div>
                          <div className="mt-3 font-extrabold text-16 text-cyan-700">₹24,000 - ₹28,000</div>
                          <button onClick={() => setBookingModal(true)} className="mt-3 w-full py-1.5 rounded-lg bg-cyan-600 text-white text-12 font-bold shadow-sm hover:bg-cyan-700 cursor-pointer">
                            Select Package
                          </button>
                        </div>

                        <div className="border border-slate-200 rounded p-4 bg-white hover:border-cyan-500 transition-all shadow-sm">
                          <Badge tone="violet">Premium</Badge>
                          <div className="font-bold text-15 mt-2 text-slate-900">Multifocal / Trifocal IOL</div>
                          <div className="text-12 text-slate-500 mt-1">Complete freedom from glasses for reading, computer, and driving.</div>
                          <div className="mt-3 font-extrabold text-16 text-cyan-700">₹30,000 - ₹35,000</div>
                          <button onClick={() => setBookingModal(true)} className="mt-3 w-full py-1.5 rounded-lg border border-slate-300 text-12 font-bold text-slate-700 hover:bg-slate-50 cursor-pointer">
                            Select Package
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {b.services.map((s, i) => (
                          <div
                            key={i}
                            onClick={() => {
                              const match = pageList.find(p => p.label === s.name);
                              if (match) handleSelectPage(match);
                            }}
                            className="p-3.5 rounded border border-slate-200 hover:border-cyan-500 transition-all cursor-pointer bg-white group"
                          >
                            <div className="font-bold text-14 text-slate-900 group-hover:text-cyan-700 flex items-center justify-between">
                              <span>{s.name}</span>
                              <ArrowRight size={13} className="text-slate-500 group-hover:translate-x-0.5 transition-transform" />
                            </div>
                            <div className="text-12 text-slate-500 mt-1 line-clamp-2">
                              {s.description || 'Specialized procedure performed by expert medical staff.'}
                            </div>
                            <div className="mt-2 text-12 font-semibold text-cyan-700 ">
                              {s.price || 'Charitable trust rates'}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 5. Surgeon / Specialist Profile (E-E-A-T Medical Trust) */}
                {on.surgeon && (
                  <div className="px-6 py-8 bg-slate-50 border-t border-b border-slate-200/80">
                    <div className="flex flex-col md:flex-row items-center gap-6">
                      <div className="w-24 h-24 rounded bg-cyan-100 border-2 border-cyan-300 flex items-center justify-center text-cyan-800 shrink-0 shadow-sm">
                        <Stethoscope size={44} />
                      </div>
                      <div className="flex-1 text-center md:text-left">
                        <div className="inline-flex items-center gap-1 text-11 font-bold text-cyan-700   mb-1">
                          <Award size={13} /> Chief Consultant Ophthalmic Surgeon
                        </div>
                        <h3 className="text-lg font-bold text-slate-900">Dr. M. K. Kadam (MBBS, MS - Ophthalmology)</h3>
                        <p className="text-12 text-slate-600 mt-1 leading-relaxed">
                          Fellow of International Council of Ophthalmology (FICO, UK), Member of All India Ophthalmological Society (AIOS). Over 18 years of clinical surgical experience with 12,000+ successful micro-incision cataract and cornea surgeries in Pune and PCMC.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2 justify-center md:justify-start text-11">
                          <span className="px-2.5 py-0.5 rounded-full bg-white border border-slate-300 font-medium">OPD: Mon–Sat (10 AM – 2 PM, 5 PM – 8 PM)</span>
                          <span className="px-2.5 py-0.5 rounded-full bg-white border border-slate-300 font-medium">Emergency Surgery on Call</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 6. Patient Reviews */}
                {on.reviews && (
                  <div className="px-6 py-8">
                    <div className="flex items-center justify-between mb-5">
                      <div>
                        <h3 className="text-lg font-bold text-slate-900">What Our Patients Say</h3>
                        <p className="text-12 text-slate-500">Verified reviews from Google Maps & Business Profile</p>
                      </div>
                      <div className="flex items-center gap-1 text-13 font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg">
                        <Star size={14} className="fill-amber-400" />
                        <span>{b.rating || 4.7} / 5.0</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                      {reviews.map(r => (
                        <div key={r.id} className="p-4 rounded border border-slate-200 bg-white shadow-sm flex flex-col justify-between">
                          <div>
                            <div className="flex items-center gap-1 text-amber-700">
                              {'★'.repeat(r.rating || 5)}
                            </div>
                            <p className="text-12 text-slate-700 mt-2 italic leading-relaxed">
                              "{r.body}"
                            </p>
                          </div>
                          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-11">
                            <span className="font-bold text-slate-900">{r.author}</span>
                            <span className="text-slate-500">{r.time || 'Verified Patient'}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 7. FAQs with Schema.org Question Accordion */}
                {on.faq && (
                  <div className="px-6 py-8 bg-slate-50 border-t border-slate-200/80">
                    <div className="max-w-xl mb-4">
                      <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-10 font-bold  mb-1">
                        Schema.org FAQPage Enabled
                      </div>
                      <h3 className="text-lg font-bold text-slate-900">Frequently Asked Questions</h3>
                      <p className="text-12 text-slate-600">Common questions about procedures, costs, and mediclaim at {b.name}.</p>
                    </div>

                    <div className="space-y-2">
                      {faqs.map((f, i) => {
                        const isOpen = activeFaq === i;
                        return (
                          <div key={i} className="border border-slate-200 rounded bg-white overflow-hidden transition-all shadow-sm">
                            <button
                              onClick={() => setActiveFaq(isOpen ? null : i)}
                              className="w-full text-left p-3.5 flex items-center justify-between gap-3 font-semibold text-13 text-slate-900 hover:text-cyan-700 cursor-pointer"
                            >
                              <span>{f.q}</span>
                              {isOpen ? <ChevronUp size={16} className="text-slate-500 shrink-0" /> : <ChevronDown size={16} className="text-slate-500 shrink-0" />}
                            </button>
                            {isOpen && (
                              <div className="px-3.5 pb-3.5 text-12 text-slate-600 leading-relaxed border-t border-slate-100 pt-2.5">
                                {f.a}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 8. Map & Location */}
                {on.map && (
                  <div className="px-6 py-8 border-t border-slate-200">
                    <h3 className="text-lg font-bold text-slate-900 mb-2">Location & Easy Access in PCMC</h3>
                    <p className="text-12 text-slate-600 mb-4">
                      Conveniently located near Chinchwad Railway Station and Old Mumbai-Pune Highway, accessible within 10–20 minutes from Akurdi, Nigdi, Pimpri, Ravet, Wakad, and Bhosari.
                    </p>

                    <div className="h-44 rounded bg-slate-100 border border-slate-300 flex flex-col items-center justify-center text-center p-4 relative overflow-hidden group">
                      <div className="w-10 h-10 rounded-full bg-cyan-600 text-white flex items-center justify-center shadow-md mb-2">
                        <MapPin size={20} />
                      </div>
                      <div className="font-bold text-14 text-slate-900">{b.name}</div>
                      <div className="text-12 text-slate-500 max-w-md mt-0.5">{b.address || `${b.area || 'Chinchwad'}, ${b.city || 'PCMC'}, Pune 411033`}</div>
                      <a
                        href={`https://maps.google.com/?q=${encodeURIComponent(`${b.name} ${b.area || 'Chinchwad'} ${b.city || 'PCMC'}`)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2.5 inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-white border border-slate-300 text-11 font-bold text-slate-800 shadow-sm hover:bg-slate-50 cursor-pointer"
                      >
                        <ExternalLink size={12} /> Get Directions on Google Maps
                      </a>
                    </div>
                  </div>
                )}

                {/* 9. Contact & Emergency Footer */}
                {on.contact && (
                  <footer className="bg-slate-50 text-slate-700 px-6 py-8 border-t border-slate-200">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-13">
                      <div>
                        <div className="font-black text-16 text-slate-900 tracking-tight flex items-center gap-2">
                          <Heart size={18} className="text-cyan-700" /> {b.name}
                        </div>
                        <p className="text-slate-500 text-12 mt-2 leading-relaxed">
                          Non-profit charitable healthcare trust dedicated to affordable and advanced medical care in PCMC, Chinchwad.
                        </p>
                        <div className="mt-3 text-11 text-cyan-700 ">
                          Clean SEO URL: /{customSlug.replace(/^\//, '')}
                        </div>
                      </div>

                      <div>
                        <div className="font-bold text-slate-900 text-13   mb-2  text-slate-700">
                          Emergency & Casualty
                        </div>
                        <div className="text-slate-700 text-12 space-y-1">
                          <p className="flex items-center gap-1.5"><Phone size={13} className="text-rose-600" /> 24/7 Hotline: {b.phone || '+91 20 2742 0000'}</p>
                          <p className="flex items-center gap-1.5"><Clock size={13} className="text-emerald-700" /> OPD Hours: 9:00 AM – 8:00 PM</p>
                          <p className="flex items-center gap-1.5"><MapPin size={13} className="text-cyan-700" /> {b.area || 'Chinchwad'}, {b.city || 'PCMC'}</p>
                        </div>
                      </div>

                      <div>
                        <div className="font-bold text-slate-900 text-13   mb-2  text-slate-700">
                          Quick Actions
                        </div>
                        <div className="flex flex-col gap-2">
                          <button
                            onClick={() => setBookingModal(true)}
                            className="w-full py-2 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-12 transition-all cursor-pointer shadow-md"
                          >
                            Book OPD Appointment
                          </button>
                          <button
                            onClick={() => setAiChatOpen(true)}
                            className="w-full py-2 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-12 transition-all cursor-pointer border border-slate-200 flex items-center justify-center gap-1.5"
                          >
                            <Bot size={14} className="text-purple-600" /> Talk to AI Care Assistant
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="mt-8 pt-4 border-t border-slate-200 text-center text-11 text-slate-500">
                      © {new Date().getFullYear()} {b.name}. All Rights Reserved. Clean URL Architecture powered by GrowZen AI.
                    </div>
                  </footer>
                )}

                {/* FLOATING AI CARE CONCIERGE WIDGET (Bottom Right of Preview) */}
                <div className="absolute bottom-5 right-5 z-30 flex flex-col items-end">
                  {aiChatOpen && (
                    <div className="w-80 h-96 bg-white backdrop-blur-xl border border-slate-300 rounded shadow-2xl flex flex-col overflow-hidden mb-3 animate-in slide-in-from-bottom-4 duration-200 text-slate-900 ring-1 ring-slate-200">
                      <div className="px-4 py-3 bg-gradient-to-r from-indigo-50 to-white border-b border-slate-200 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-cyan-700">
                            <Bot size={15} />
                          </div>
                          <div>
                            <div className="text-12 font-bold">AI Patient Concierge</div>
                            <div className="text-10 text-emerald-700  flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Online 24/7
                            </div>
                          </div>
                        </div>
                        <button onClick={() => setAiChatOpen(false)} className="text-slate-500 hover:text-slate-900 cursor-pointer">
                          ✕
                        </button>
                      </div>

                      {/* Chat Messages */}
                      <div className="flex-1 p-3 overflow-y-auto space-y-2.5 text-12">
                        {chatMessages.map((m, idx) => (
                          <div
                            key={idx}
                            className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                          >
                            <div
                              className={`p-2.5 rounded max-w-[85%] leading-relaxed ${m.sender === 'user'
                                ? 'bg-cyan-600 text-white rounded-br-sm'
                                : 'bg-slate-100 text-slate-800 border border-slate-200 rounded-bl-sm'
                                }`}
                            >
                              {m.text}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Quick FAQ Chips */}
                      <div className="px-2.5 py-1.5 bg-slate-50 border-t border-slate-200 flex gap-1.5 overflow-x-auto no-scrollbar">
                        {['Cost of Cataract?', 'Recovery time?', 'Cashless insurance?', 'Book OPD'].map(q => (
                          <button
                            key={q}
                            onClick={() => {
                              setInputMsg(q);
                              setTimeout(handleSendChat, 50);
                            }}
                            className="px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-10 text-cyan-700 font-medium whitespace-nowrap hover:bg-slate-200 cursor-pointer"
                          >
                            {q}
                          </button>
                        ))}
                      </div>

                      {/* Input */}
                      <div className="p-2 border-t border-slate-200 bg-slate-50 flex gap-1.5">
                        <input
                          className="flex-1 bg-white border border-slate-300 rounded px-2.5 text-12 text-slate-900 focus:outline-none focus:border-cyan-500 placeholder-slate-400"
                          placeholder="Ask about procedure, doctors..."
                          value={inputMsg}
                          onChange={e => setInputMsg(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleSendChat(); }}
                        />
                        <button
                          onClick={handleSendChat}
                          className="w-8 h-8 rounded bg-cyan-600 hover:bg-cyan-500 text-white flex items-center justify-center shrink-0 cursor-pointer"
                        >
                          <Send size={13} />
                        </button>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={() => setAiChatOpen(o => !o)}
                    className="h-11 px-4 rounded-full bg-gradient-to-r from-indigo-600 via-indigo-500 to-cyan-500 text-white font-bold text-12 shadow-xl hover:scale-105 transition-all flex items-center gap-2 cursor-pointer border border-white/20"
                  >
                    <Bot size={16} />
                    <span>AI Care Assistant</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* MODAL 1: Appointment Booking */}
      <Modal
        open={bookingModal}
        title={`Book Consultation at ${b.name}`}
        onClose={() => setBookingModal(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setBookingModal(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                setBookingModal(false);
                toast(`Appointment request confirmed for ${bookingForm.name || 'Patient'}! Confirmation SMS sent.`);
              }}
            >
              Confirm Appointment
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          <Field label="Patient Name">
            <input
              className={inputCls}
              placeholder="e.g. Ramesh Patil"
              value={bookingForm.name}
              onChange={e => setBookingForm({ ...bookingForm, name: e.target.value })}
            />
          </Field>
          <Field label="Contact Phone Number">
            <input
              className={inputCls}
              placeholder="+91 98765 43210"
              value={bookingForm.phone}
              onChange={e => setBookingForm({ ...bookingForm, phone: e.target.value })}
            />
          </Field>
          <Field label="Department / Procedure">
            <select
              className={inputCls}
              value={bookingForm.service}
              onChange={e => setBookingForm({ ...bookingForm, service: e.target.value })}
            >
              <option>Cataract Surgery (Blade-Free Phaco)</option>
              <option>General Eye Checkup & Retinal Scan</option>
              <option>General & Laparoscopic Surgery</option>
              <option>Orthopaedic & Joint Pain</option>
              <option>24/7 Emergency / Casualty</option>
            </select>
          </Field>
          <div className="p-3 rounded bg-cyan-500/10 border border-cyan-500/25 text-12 text-cyan-800">
            <ShieldCheck size={14} className="inline mr-1 text-cyan-700" />
            No advance consultation fee required for charitable trust evaluation. Pay directly at the hospital reception.
          </div>
        </div>
      </Modal>

      {/* MODAL 2: Schema.org JSON-LD Inspector */}
      <Modal
        open={schemaModal}
        title="Schema.org Graph for Clean URL"
        width="max-w-2xl"
        onClose={() => setSchemaModal(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setSchemaModal(false)}>Close</Button>
            <Button
              variant="primary"
              icon={Copy}
              onClick={() => copyToClipboard(schemaJson, 'Schema JSON-LD copied!')}
            >
              Copy JSON-LD
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between text-12">
            <span className=" text-cyan-700 font-semibold">{currentFullUrl}</span>
            <Badge tone="green">Valid Schema.org</Badge>
          </div>
          <pre className="text-11  bg-slate-50 p-3.5 rounded border border-slate-200 text-slate-700 overflow-auto max-h-[420px] no-scrollbar">
            {schemaJson}
          </pre>
        </div>
      </Modal>

      {/* MODAL 3: Clean URL Server Rules Export */}
      <Modal
        open={serverConfigModal}
        title="Server Clean URL Rewrite Configuration"
        width="max-w-2xl"
        onClose={() => setServerConfigModal(false)}
        footer={<Button variant="secondary" onClick={() => setServerConfigModal(false)}>Close</Button>}
      >
        <div className="space-y-4 text-13 text-slate-700">
          <p>
            To serve URLs like <span className=" text-cyan-700 font-bold">https://{domain}/cataract-surgery-in-pcmc</span> without needing <span className=" text-amber-300">.html</span>, use one of the following rewrite snippets on your web server:
          </p>

          <div className="space-y-2">
            <div className="font-bold text-slate-900 text-12 flex items-center justify-between">
              <span>Nginx (nginx.conf)</span>
              <button
                onClick={() => copyToClipboard(`location / {\n    try_files $uri $uri.html $uri/ /index.html;\n}`, 'Nginx config copied!')}
                className="text-cyan-700 hover:text-cyan-700 text-xs flex items-center gap-1 cursor-pointer"
              >
                <Copy size={11} /> Copy
              </button>
            </div>
            <pre className="p-3 bg-slate-50 border border-slate-200 rounded  text-11 text-slate-700 overflow-x-auto">
              {`location / {
    try_files $uri $uri.html $uri/ /index.html;
}`}
            </pre>
          </div>

          <div className="space-y-2">
            <div className="font-bold text-slate-900 text-12 flex items-center justify-between">
              <span>Apache (.htaccess)</span>
              <button
                onClick={() => copyToClipboard(`RewriteEngine On\nRewriteCond %{REQUEST_FILENAME} !-d\nRewriteCond %{REQUEST_FILENAME}\\.html -f\nRewriteRule ^(.*)$ $1.html [L]`, 'Apache config copied!')}
                className="text-cyan-700 hover:text-cyan-700 text-xs flex items-center gap-1 cursor-pointer"
              >
                <Copy size={11} /> Copy
              </button>
            </div>
            <pre className="p-3 bg-slate-50 border border-slate-200 rounded  text-11 text-slate-700 overflow-x-auto">
              {`RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-d
RewriteCond %{REQUEST_FILENAME}\\.html -f
RewriteRule ^(.*)$ $1.html [L]`}
            </pre>
          </div>

          <div className="space-y-2">
            <div className="font-bold text-slate-900 text-12 flex items-center justify-between">
              <span>IIS / Plesk Windows (web.config)</span>
              <button
                onClick={() => copyToClipboard(`<system.webServer>\n  <rewrite>\n    <rules>\n      <rule name="CleanURL" stopProcessing="true">\n        <match url="^([a-zA-Z0-9_-]+)/?$" />\n        <conditions logicalGrouping="MatchAll">\n          <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />\n        </conditions>\n        <action type="Rewrite" url="{R:1}.html" />\n      </rule>\n    </rules>\n  </rewrite>\n</system.webServer>`, 'web.config copied!')}
                className="text-cyan-700 hover:text-cyan-700 text-xs flex items-center gap-1 cursor-pointer"
              >
                <Copy size={11} /> Copy
              </button>
            </div>
            <pre className="p-3 bg-slate-50 border border-slate-200 rounded  text-11 text-slate-700 overflow-x-auto">
              {`<system.webServer>
  <rewrite>
    <rules>
      <rule name="CleanURL" stopProcessing="true">
        <match url="^([a-zA-Z0-9_-]+)/?$" />
        <conditions logicalGrouping="MatchAll">
          <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
        </conditions>
        <action type="Rewrite" url="{R:1}.html" />
      </rule>
    </rules>
  </rewrite>
</system.webServer>`}
            </pre>
          </div>
        </div>
      </Modal>

      {toastNode}
    </>
  );
}

export default function WebsiteBuilderPage() {
  return (
    <SeoShell
      title="AI Website Studio & Clean URL Engine"
      subtitle="Autonomous generation of high-converting multi-page websites with clean SEO URL slugs matching your Google Business Profile"
    >
      {(b) => <Builder key={b.id} b={b} />}
    </SeoShell>
  );
}
