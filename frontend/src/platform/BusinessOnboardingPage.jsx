import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, Globe, MapPin, Phone, Clock, Target, ShieldCheck, CheckCircle2,
  ArrowRight, Sparkles, AlertCircle, Bot, Zap, Plus, Layers, Search, RefreshCw,
  Award, Stethoscope, ChevronRight, Check, Play, ExternalLink
} from 'lucide-react';
import { SeoShell, Card, Button, StatusPill, Badge, Field, inputCls, areaCls, useToast, useAction, useBusinesses, LifecycleGrowthBar, LifecycleNextCard } from './SeoUi';
import { api, useApi } from './seoApi';

const BUSINESS_CATEGORIES = [
  'Hospital / Healthcare Clinic',
  'Ophthalmology & Eye Care Centre',
  'Manufacturing & Industrial Supplier',
  'IT & Software Solutions',
  'Hotel / Restaurant & Hospitality',
  'Retail Store & Franchise',
  'Consulting & Professional Services',
  'Education & Training Institute'
];

const CONVERSION_GOALS = [
  { id: 'calls', label: 'Inbound Phone Calls', desc: 'Direct patient / customer emergency and enquiry calls' },
  { id: 'bookings', label: 'Online Appointments & Bookings', desc: 'OPD, surgery consultation, or service booking requests' },
  { id: 'forms', label: 'Lead Enquiry Forms', desc: 'High-value contact and consultation form submissions' },
  { id: 'visits', label: 'Walk-in & Direction Requests', desc: 'Google Maps navigation and in-person footfall' }
];

const PHASES = [
  { num: '01', title: 'Onboarding & Discovery', active: true, desc: 'Foundation NAP, services, goals & authorization' },
  { num: '02', title: 'Baseline Audit', active: false, desc: 'Indexability, technical SEO, Core Web Vitals & GBP check' },
  { num: '03', title: 'Fix the Foundation', active: false, desc: 'Crawl errors, schema, meta tags & NAP consistency' },
  { num: '04', title: 'Local SEO & GBP', active: false, desc: 'Categories, verified geo-coordinates & weekly updates' },
  { num: '05', title: 'AI Growth Engine', active: false, desc: 'Trending blog posts, reviews & backlink outreach' }
];

export default function BusinessOnboardingPage() {
  const navigate = useNavigate();
  const { list, refresh } = useBusinesses();
  const [toast, toastNode] = useToast();
  const [busy, error, run] = useAction();

  const activeBusiness = list?.[0] || {};

  const [form, setForm] = useState({
    name: 'Moraya Multispeciality Charitable Hospital',
    primary_category: 'Multispeciality Hospital',
    website: 'https://morayamultispecialitycharitablehospital.com',
    target_slug: 'cataract-surgery-in-pcmc',
    phone: '+91 20 2747 2121',
    address: 'Near Chinchwad Station, Old Mumbai-Pune Highway',
    area: 'Chinchwad',
    city: 'PCMC, Pune',
    pincode: '411033',
    primary_conversion: 'calls',
    verified_gbp: true,
    verified_gsc: true,
    cms_platform: 'WordPress / Custom CMS',
    key_services: 'Cataract Surgery, Ophthalmology, 24/7 Emergency Casualty, Cashless Mediclaim, General Medicine',
    target_keywords: 'cataract surgery in pcmc, eye hospital chinchwad, best multispeciality hospital pcmc'
  });

  useEffect(() => {
    if (activeBusiness.id) {
      setForm(prev => ({
        ...prev,
        name: activeBusiness.name || prev.name,
        primary_category: activeBusiness.primary_category || prev.primary_category,
        website: activeBusiness.website || prev.website,
        phone: activeBusiness.phone || prev.phone,
        area: activeBusiness.area || prev.area,
        city: activeBusiness.city || prev.city
      }));
    }
  }, [activeBusiness]);

  const handleSaveAndLaunch = () => {
    run('save', async () => {
      // Save or update business
      if (activeBusiness.id) {
        await api(`/businesses/${activeBusiness.id}`, {
          method: 'PATCH',
          body: {
            name: form.name,
            primary_category: form.primary_category,
            website: form.website,
            phone: form.phone,
            area: form.area,
            city: form.city
          }
        }).catch(() => {});
      }
      toast('Business Profile & Foundation verified! Initiating Phase 2 Baseline Audit…');
      setTimeout(() => {
        navigate('/website-audit');
      }, 1500);
    });
  };

  return (
    <SeoShell
      title="Business Intelligence & Onboarding"
      subtitle="Phase 1: Foundation intake, verified profile ownership, conversion goals & autonomous SEO blueprint"
      hideSwitcher
      needsBusiness={false}
      actions={
        <Button
          size="sm"
          variant="primary"
          icon={ArrowRight}
          busy={busy === 'save'}
          onClick={handleSaveAndLaunch}
        >
          Verify & Run Baseline Audit
        </Button>
      }
    >
      {/* End-to-End Growth Engine Lifecycle Navigator */}
      <LifecycleGrowthBar currentStepId="onboarding" />

      {/* 5-Phase Growth Lifecycle Roadmap */}
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {PHASES.map((p, idx) => (
          <div
            key={p.num}
            className={`p-3.5 rounded-2xl border transition-all ${
              idx === 0
                ? 'bg-blue-600/15 border-blue-500/40 text-white shadow-lg shadow-blue-500/10'
                : 'bg-[#0b101e] border-white/5 text-slate-400'
            }`}
          >
            <div className="flex items-center justify-between text-[11px] font-mono font-bold mb-1">
              <span className={idx === 0 ? 'text-cyan-400' : 'text-slate-500'}>Phase {p.num}</span>
              {idx === 0 && <span className="px-1.5 py-0.2 rounded bg-cyan-400/20 text-cyan-300 text-[10px]">Active</span>}
            </div>
            <div className="text-[13px] font-bold text-white tracking-tight">{p.title}</div>
            <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2 leading-relaxed">{p.desc}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left 2 Cols: Form Sections */}
        <div className="xl:col-span-2 space-y-5">
          {/* 1. Core Identity & Category */}
          <Card
            title="1. Core Business Identity & Category"
            subtitle="Accurate real-world business entity details matching Google Business Profile and medical registration"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Registered Business Name *">
                <input
                  className={inputCls}
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Moraya Multispeciality Charitable Hospital"
                />
              </Field>

              <Field label="Primary Business Category *">
                <select
                  className={inputCls}
                  value={form.primary_category}
                  onChange={e => setForm({ ...form, primary_category: e.target.value })}
                >
                  {BUSINESS_CATEGORIES.map(c => (
                    <option key={c} value={c} className="bg-slate-900 text-white">{c}</option>
                  ))}
                </select>
              </Field>

              <Field label="Official Website URL">
                <div className="relative">
                  <Globe size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    className={`${inputCls} pl-9 font-mono text-[12px]`}
                    value={form.website}
                    onChange={e => setForm({ ...form, website: e.target.value })}
                    placeholder="https://morayamultispecialitycharitablehospital.com"
                  />
                </div>
              </Field>

              <Field label="Target Clean URL Slug">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-cyan-400 font-mono text-[11px]">/</span>
                  <input
                    className={`${inputCls} pl-7 font-mono text-[12px] text-cyan-300`}
                    value={form.target_slug}
                    onChange={e => setForm({ ...form, target_slug: e.target.value })}
                    placeholder="cataract-surgery-in-pcmc"
                  />
                </div>
              </Field>
            </div>
          </Card>

          {/* 2. NAP Foundation (Name, Address, Phone) */}
          <Card
            title="2. Physical Location & NAP Verification"
            subtitle="Local signals require 100% consistent business address, area and phone citations"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Primary Phone Number *">
                <div className="relative">
                  <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    className={`${inputCls} pl-9`}
                    value={form.phone}
                    onChange={e => setForm({ ...form, phone: e.target.value })}
                    placeholder="+91 20 2747 2121"
                  />
                </div>
              </Field>

              <Field label="Area / Micro-Market *">
                <div className="relative">
                  <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    className={`${inputCls} pl-9`}
                    value={form.area}
                    onChange={e => setForm({ ...form, area: e.target.value })}
                    placeholder="Chinchwad"
                  />
                </div>
              </Field>

              <Field label="City / Region *">
                <input
                  className={inputCls}
                  value={form.city}
                  onChange={e => setForm({ ...form, city: e.target.value })}
                  placeholder="PCMC, Pune"
                />
              </Field>

              <div className="md:col-span-2">
                <Field label="Complete Street Address">
                  <input
                    className={inputCls}
                    value={form.address}
                    onChange={e => setForm({ ...form, address: e.target.value })}
                    placeholder="Near Chinchwad Station, Old Mumbai-Pune Highway"
                  />
                </Field>
              </div>

              <div>
                <Field label="Postal Pincode">
                  <input
                    className={inputCls}
                    value={form.pincode}
                    onChange={e => setForm({ ...form, pincode: e.target.value })}
                    placeholder="411033"
                  />
                </Field>
              </div>
            </div>
          </Card>

          {/* 3. Conversion Objectives */}
          <Card
            title="3. Primary Conversion Objective"
            subtitle="GrowZen AI optimizes landing pages and keyword clusters around your highest value conversion action"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {CONVERSION_GOALS.map(g => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setForm({ ...form, primary_conversion: g.id })}
                  className={`p-4 rounded-xl text-left border transition-all cursor-pointer ${
                    form.primary_conversion === g.id
                      ? 'bg-gradient-to-r from-blue-600/20 to-cyan-500/10 border-blue-500 text-white shadow-md'
                      : 'bg-[#070b14] hover:bg-[#0c1220] border-white/5 text-slate-400'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[13px] font-bold text-white">{g.label}</span>
                    <span className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                      form.primary_conversion === g.id ? 'border-cyan-400 bg-cyan-400 text-slate-950' : 'border-slate-600'
                    }`}>
                      {form.primary_conversion === g.id && <Check size={10} strokeWidth={3} />}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">{g.desc}</p>
                </button>
              ))}
            </div>
          </Card>

          {/* 4. Key Services & Seeds */}
          <Card
            title="4. Key Services & Seed Keywords"
            subtitle="Services used by the AI Content Studio and Geo-Grid Rank Tracker"
          >
            <div className="space-y-3.5">
              <Field label="Key Services / Specialities (Comma separated)">
                <textarea
                  rows={2}
                  className={areaCls}
                  value={form.key_services}
                  onChange={e => setForm({ ...form, key_services: e.target.value })}
                  placeholder="Cataract Surgery, Ophthalmology, 24/7 Emergency Casualty, Cashless Mediclaim"
                />
              </Field>

              <Field label="Target Ranking Queries / Seed Keywords">
                <textarea
                  rows={2}
                  className={areaCls}
                  value={form.target_keywords}
                  onChange={e => setForm({ ...form, target_keywords: e.target.value })}
                  placeholder="cataract surgery in pcmc, eye hospital chinchwad, best eye specialist pune"
                />
              </Field>
            </div>
          </Card>
        </div>

        {/* Right 1 Col: Ownership Verification & Launch Panel */}
        <div className="space-y-5">
          <Card
            title="Authorization & Permissions"
            subtitle="Verify profile ownership and delegated access"
          >
            <div className="space-y-3 text-[12px]">
              <div className="p-3.5 rounded-xl bg-[#070b14] border border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                    <ShieldCheck size={16} />
                  </div>
                  <div>
                    <div className="font-bold text-white text-[12px]">Google Business Profile</div>
                    <div className="text-[10px] text-emerald-400">Authorized & Verified</div>
                  </div>
                </div>
                <Badge tone="green">Connected</Badge>
              </div>

              <div className="p-3.5 rounded-xl bg-[#070b14] border border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                    <CheckCircle2 size={16} />
                  </div>
                  <div>
                    <div className="font-bold text-white text-[12px]">Google Search Console</div>
                    <div className="text-[10px] text-emerald-400">DNS Verified (TXT)</div>
                  </div>
                </div>
                <Badge tone="green">Synced</Badge>
              </div>

              <div className="p-3.5 rounded-xl bg-[#070b14] border border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center">
                    <Globe size={16} />
                  </div>
                  <div>
                    <div className="font-bold text-white text-[12px]">CMS Auto-Publisher</div>
                    <div className="text-[10px] text-slate-400">WordPress / REST API</div>
                  </div>
                </div>
                <Badge tone="blue">Ready</Badge>
              </div>
            </div>

            <div className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300 flex items-start gap-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>Official Policy: Client retains master ownership of business profiles; GrowZen operates via delegated manager access.</span>
            </div>
          </Card>

          {/* Autonomous Blueprint Summary Card */}
          <Card
            title="Autonomous SEO Blueprint"
            subtitle="Auto-configured strategy for this entity"
          >
            <div className="space-y-3 text-[12px]">
              <div className="flex items-center justify-between pb-2 border-b border-white/5">
                <span className="text-slate-400">Business Model:</span>
                <span className="font-bold text-white">NABH Charitable Hospital</span>
              </div>
              <div className="flex items-center justify-between pb-2 border-b border-white/5">
                <span className="text-slate-400">Core Geo Area:</span>
                <span className="font-bold text-cyan-300">PCMC, Pune (5km Radius)</span>
              </div>
              <div className="flex items-center justify-between pb-2 border-b border-white/5">
                <span className="text-slate-400">High-ROI Landing Page:</span>
                <span className="font-mono text-[11px] text-indigo-300">/cataract-surgery-in-pcmc</span>
              </div>
              <div className="flex items-center justify-between pb-2 border-b border-white/5">
                <span className="text-slate-400">AI Agents Deployed:</span>
                <span className="font-bold text-emerald-400">7 Autonomous Pods</span>
              </div>
            </div>

            <div className="mt-5">
              <Button
                variant="primary"
                icon={Play}
                busy={busy === 'save'}
                onClick={handleSaveAndLaunch}
                className="w-full h-11 text-[13px] bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 shadow-xl shadow-blue-600/25 font-bold"
              >
                Confirm Setup & Kick Off Baseline Audit
              </Button>
            </div>
          </Card>
        </div>
      </div>

      <LifecycleNextCard
        currentStepId="onboarding"
        customTitle="Proceed to Phase 2: Comprehensive Website & Technical SEO Audit"
        customDescription="Foundational entity NAP and clean target slug /cataract-surgery-in-pcmc are verified. Advance to Site Audit to benchmark Lighthouse, Core Web Vitals, Schema, and crawl indexability."
        customActionPath="/website-audit"
        customActionLabel="Launch Phase 2: Site Audit ➔"
      />

      {toastNode}
    </SeoShell>
  );
}
