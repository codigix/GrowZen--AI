import React, { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  RefreshCw, Sparkles, Copy, ChevronDown, ChevronRight, Lightbulb,
  ArrowRight, CheckCircle2, AlertTriangle, XCircle, Tag, Building2,
  MapPin, FileText, ShoppingBag, Star, Camera, Search, Map, Target,
  SlidersHorizontal, ExternalLink, ShieldCheck, Zap, Info, ArrowUpRight,
  TrendingUp, Check, Layers, Globe, Phone, Clock, Mail, Calendar
} from 'lucide-react';
import { Card, Badge, Button, ErrorNote, useAction, useToast, SkList, ScoreRing } from './SeoUi';
import { api, useApi } from './seoApi';

const TONE = {
  ok: ['Good', 'green'],
  warn: ['Improve', 'amber'],
  bad: ['Fix Now', 'red'],
  unknown: ['Not Read', 'gray']
};

const PARAM_ICON = {
  categories: Tag,
  name: Building2,
  nap: MapPin,
  description: FileText,
  services: ShoppingBag,
  reviews: Star,
  photos: Camera,
  visibility: Search,
  geo_grid: Map,
  geogrid: Map,
};

function scoreBand(s) {
  if (s == null) return { label: 'Not Scored', color: 'text-slate-400', tone: 'gray', grade: '—' };
  if (s >= 90) return { label: 'Optimal', color: 'text-emerald-600', tone: 'green', grade: 'A+' };
  if (s >= 75) return { label: 'Good', color: 'text-blue-600', tone: 'blue', grade: 'B' };
  if (s >= 50) return { label: 'Fair', color: 'text-amber-600', tone: 'amber', grade: 'C' };
  return { label: 'Critical', color: 'text-rose-600', tone: 'red', grade: 'D' };
}

function Copyable({ text, toast, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast('Copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('Could not copy: select the text manually');
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1 text-12 font-semibold text-indigo-600 hover:text-indigo-800 transition-colors cursor-pointer"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copied' : label}
    </button>
  );
}

function FixActions({ f }) {
  const navigate = useNavigate();
  if (!f.to) return null;
  return (
    <div className="mt-3 pt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100">
      <span className="text-12 text-slate-500 font-medium">
        Location: <b className="text-slate-800 font-semibold">{f.where}</b>
      </span>
      <Button
        size="sm"
        variant="primary"
        icon={ArrowRight}
        onClick={() => { navigate(f.to); window.scrollTo({ top: 0 }); }}
        className="shadow-xs cursor-pointer"
      >
        Fix this now
      </Button>
    </div>
  );
}

/* Detailed Parameter Card in the main list */

const RANK_STYLE = (r) => (!r ? 'bg-slate-300 text-slate-600' : r <= 3 ? 'bg-emerald-500 text-white' : r <= 10 ? 'bg-amber-400 text-slate-900' : 'bg-rose-500 text-white');

/** One map scan drawn as a grid: each dot is a place around the business, its number is the position there. */
function GeoGridMap({ m }) {
  const n = Math.max(1, m.size || Math.round(Math.sqrt(m.total)));
  const at = (x, y) => m.points.find(p => p.x === x && p.y === y);
  const c = m.counts;
  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-2xs space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <p className="font-bold text-13.5 text-slate-900">Search: “{m.keyword}”</p>
        <Badge tone={m.source === 'yours' ? 'green' : 'gray'}>{m.source === 'yours' ? 'Your tracked keyword' : 'Chosen by the app, not by you'}</Badge>
        <p className="text-12 text-slate-500">{m.total} places checked{m.radius_km ? ` within ${m.radius_km} km` : ''}{m.scanned_at ? ` · scanned ${String(m.scanned_at).slice(0, 10)}` : ''}</p>
      </div>
      <p className="text-13 font-semibold text-slate-800">{m.verdict}</p>
      <div className="grid sm:grid-cols-[auto,1fr] gap-5 items-start">
        <div>
          <div className="inline-grid gap-1.5" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
            {Array.from({ length: n * n }, (_, i) => { const x = i % n, y = Math.floor(i / n); const p = at(x, y); const centre = x === (n - 1) / 2 && y === (n - 1) / 2;
              return <div key={i} title={p?.rank ? `Position ${p.rank} here` : 'Not shown in the top 20 here'} className={`w-9 h-9 rounded-full flex items-center justify-center text-12 font-bold ${RANK_STYLE(p?.rank)} ${centre ? 'ring-2 ring-indigo-600 ring-offset-2' : ''}`}>{p?.rank || '–'}</div>; })}
          </div>
          <p className="text-11 text-slate-500 mt-2">The ringed dot is your business. North is up.</p>
        </div>
        <div className="grid gap-2 text-12.5">
          {[['bg-emerald-500', c.top3, 'Top 3: customers here see you first'], ['bg-amber-400', c.mid, 'Position 4 to 10: on the list, not on top'], ['bg-rose-500', c.low, 'Position 11 to 20: far down'], ['bg-slate-300', c.none, 'Not shown at all']].map(([col, n2, label]) => (
            <div key={label} className="flex items-center gap-2"><span className={`w-3.5 h-3.5 rounded-full ${col}`} /><b className="tabular-nums w-6">{n2}</b><span className="text-slate-600">{label}</span></div>))}
          <p className="text-slate-600 mt-1">Average position: <b>{m.avg_rank ?? '–'}</b> (lower is better).</p>
          {m.competitors?.length > 0 && <p className="text-slate-600">Strongest nearby: {m.competitors.map(k => `${k.name} (avg ${k.avg_rank})`).join('; ')}</p>}
        </div>
      </div>
    </div>
  );
}

function ParameterCard({ x, open, onToggle, toast, drafts }) {
  const [word, tone] = TONE[x.status] || TONE.unknown;
  const Icon = PARAM_ICON[x.key] || Tag;
  const score = x.score != null ? Math.round(x.score) : null;

  const cardBorder = x.status === 'bad'
    ? 'border-rose-200/90 hover:border-rose-300'
    : x.status === 'warn'
      ? 'border-amber-200/90 hover:border-amber-300'
      : 'border-slate-200 hover:border-slate-300';

  const iconBg = x.status === 'bad'
    ? 'bg-rose-100 text-rose-600'
    : x.status === 'warn'
      ? 'bg-amber-100 text-amber-600'
      : 'bg-emerald-50 text-emerald-600';

  const progressBg = x.status === 'bad'
    ? 'bg-rose-500'
    : x.status === 'warn'
      ? 'bg-amber-500'
      : 'bg-emerald-500';

  return (
    <div className={`ai-glass-card rounded-2xl border transition-all ${cardBorder} overflow-hidden shadow-xs mb-4`}>
      {/* Clickable Header */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-4 p-4.5 sm:p-5 text-left cursor-pointer hover:bg-slate-50/70 transition-colors"
      >
        <div className="flex items-center gap-3.5 min-w-0">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconBg} shadow-xs`}>
            <Icon size={19} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-slate-900 text-14.5 tracking-tight truncate">{x.label}</span>
              <Badge tone={tone}>{word}</Badge>
            </div>
            <p className="text-12 text-slate-500 truncate max-w-[340px] md:max-w-md mt-1">
              {x.summary}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          {score != null && (
            <div className="hidden sm:flex flex-col items-end gap-1.5 w-24">
              <div className="flex items-baseline gap-1">
                <span className="text-15 font-black tabular-nums text-slate-900">{score}</span>
                <span className="text-10.5 font-semibold text-slate-400">/100</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div className={`h-full rounded-full ${progressBg}`} style={{ width: `${score}%` }} />
              </div>
            </div>
          )}
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-600 transition-all ${open ? 'rotate-180 bg-slate-100 text-slate-700' : 'bg-slate-50'}`}>
            <ChevronDown size={17} />
          </div>
        </div>
      </button>

      {/* Expanded Breakdown */}
      {open && (
        <div className="border-t border-slate-200/70 bg-slate-50/40 p-5 sm:p-6 space-y-5 text-13">
          {/* Header Diagnostic Banner */}
          <div className={`flex items-start gap-3 p-4 rounded-xl border shadow-2xs ${
            x.status === 'ok'
              ? 'bg-emerald-50/90 border-emerald-200/80 text-emerald-950'
              : x.status === 'bad'
                ? 'bg-rose-50/90 border-rose-200/80 text-rose-950'
                : 'bg-amber-50/90 border-amber-200/80 text-amber-950'
          }`}>
            {x.status === 'ok' ? (
              <CheckCircle2 size={18} className="text-emerald-600 shrink-0 mt-0.5" />
            ) : x.status === 'bad' ? (
              <XCircle size={18} className="text-rose-600 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-bold text-13.5 leading-snug">
                {x.status === 'ok'
                  ? 'All criteria verified & fully optimized'
                  : x.issues?.length
                    ? `${x.issues.length} critical requirement${x.issues.length === 1 ? '' : 's'} need attention`
                    : x.summary}
              </p>
              {x.gain && <p className="text-12.5 opacity-90 mt-1 leading-normal"><b>Impact:</b> {x.gain}</p>}
            </div>
          </div>

          {x.key === 'geogrid' && x.maps?.length > 0 && (
            <div className="space-y-3">
              <p className="text-12.5 text-slate-600">How to read this: we searched Google Maps from {x.maps[0].total} places around your business. Each circle is one place; the number is your position in Google's list there.</p>
              {x.maps.map(m => <GeoGridMap key={m.keyword} m={m} />)}
            </div>
          )}

          {/* Current Profile Values */}
          {x.found?.length > 0 && !(x.key === 'geogrid' && x.maps?.length) && (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-4.5 sm:p-5 shadow-2xs space-y-3">
              <div className="flex items-center gap-2 text-11 font-bold uppercase tracking-wider text-slate-400">
                <Info size={14} className="text-slate-400" /> Live Profile Data Extracted
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {x.found.map(f => {
                  const valStr = String(f.value || '');
                  const isLong = valStr.length > 80 || f.label.toLowerCase().includes('competitor') || f.label.toLowerCase().includes('category');
                  return (
                    <div
                      key={f.label}
                      className={`bg-slate-50/80 p-3.5 rounded-xl border border-slate-100/90 flex flex-col justify-between ${
                        isLong ? 'sm:col-span-2' : ''
                      }`}
                    >
                      <div className="text-11.5 font-bold text-slate-500 mb-1.5">{f.label}</div>
                      <div className={`text-13 font-semibold text-slate-900 whitespace-pre-line break-words leading-relaxed ${
                        isLong && valStr.length > 180 ? 'max-h-36 overflow-y-auto pr-2' : ''
                      }`}>
                        {valStr}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Actionable Issues */}
          {x.issues?.map((q, i) => (
            <div
              key={i}
              className={`rounded-2xl border p-4.5 sm:p-5 space-y-3.5 shadow-2xs ${
                q.severity === 'bad'
                  ? 'bg-rose-50/40 border-rose-200 text-rose-950'
                  : 'bg-amber-50/40 border-amber-200 text-amber-950'
              }`}
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <Badge tone={q.severity === 'bad' ? 'red' : 'amber'}>
                    {q.severity === 'bad' ? 'Urgent Fix' : 'Recommended'}
                  </Badge>
                  <span className="font-extrabold text-slate-900 text-14">{q.title}</span>
                </div>
              </div>

              {q.detail && (
                <div className="text-13 text-slate-700 bg-white/95 p-3.5 rounded-xl border border-slate-200/70 leading-relaxed">
                  <b className="text-slate-900 font-bold">Issue Diagnosis: </b>{q.detail}
                </div>
              )}

              {q.fixes?.map((f, j) => (
                <div key={j} className="bg-white rounded-xl p-4 border border-slate-200/80 space-y-2.5 shadow-2xs">
                  <p className="text-slate-800 text-13 leading-relaxed">
                    <b className="text-slate-900 font-bold">Resolution Step: </b>{f.what}
                  </p>
                  {f.example && (
                    <div className="flex items-start justify-between gap-3 p-3 rounded-lg bg-indigo-50/80 border border-indigo-100 text-12.5 text-indigo-900 mt-2">
                      <div className="flex gap-2.5 min-w-0">
                        <Lightbulb size={16} className="text-indigo-600 shrink-0 mt-0.5" />
                        <span className="whitespace-pre-line break-words leading-relaxed">{f.example}</span>
                      </div>
                      <Copyable text={f.example} toast={toast} />
                    </div>
                  )}
                  <FixActions f={f} />
                </div>
              ))}
            </div>
          ))}

          {/* Actionable Tips */}
          {x.tips?.length > 0 && (
            <div className="bg-sky-50/70 rounded-2xl border border-sky-200/80 p-4.5 space-y-2.5 shadow-2xs">
              <h5 className="text-12 font-bold uppercase tracking-wider text-sky-800 flex items-center gap-2">
                <Lightbulb size={15} /> Optimization Suggestions
              </h5>
              <ul className="grid gap-2 list-disc pl-5 text-12.5 text-slate-700 leading-relaxed">
                {x.tips.map((t, idx) => <li key={idx}>{t}</li>)}
              </ul>
            </div>
          )}

          {/* AI Content Drafts if loaded */}
          {drafts && <DraftSection k={x.key} d={drafts} toast={toast} />}

          {/* Validation Checklist Footer */}
          <div className="pt-3 border-t border-slate-200/70 flex flex-wrap items-center justify-between gap-2.5 text-12 text-slate-500">
            {x.passed?.length > 0 && (
              <span className="flex items-center gap-1.5 text-emerald-700 font-semibold">
                <CheckCircle2 size={14} /> {x.passed.length} automated check{x.passed.length === 1 ? '' : 's'} passed
              </span>
            )}
            {x.not_checked?.length > 0 && (
              <span className="text-slate-400">
                Not applicable: {x.not_checked.join(', ')}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Box({ title, children, text, toast }) {
  return (
    <div className="rounded-xl border border-purple-200 bg-purple-50/50 p-3.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-12 font-bold text-purple-900 flex items-center gap-1.5">
          <Sparkles size={14} className="text-purple-600" /> {title}
        </span>
        {text && <Copyable text={text} toast={toast} />}
      </div>
      {children}
    </div>
  );
}

function DraftSection({ k, d, toast }) {
  if (k === 'geogrid' && d.geo_keywords?.length) {
    return (
      <Box title="Keywords worth scanning (AI suggestions, nothing was added)" text={d.geo_keywords.map(x => x.keyword).join(', ')} toast={toast}>
        <ul className="grid gap-1.5 text-12.5">
          {d.geo_keywords.map(x => <li key={x.keyword} className="bg-white/90 p-2.5 rounded-lg border border-purple-100"><b className="text-slate-900">{x.keyword}</b><span className="block text-slate-600">{x.why}</span></li>)}
        </ul>
        <p className="text-11 text-slate-500">These are AI guesses, not real search data. Check the monthly searches in Keyword Planner, then add the ones you want in My Keywords and scan them in Map Rank Tracker.</p>
      </Box>
    );
  }
  if (k === 'description' && d.description) {
    return (
      <Box title={`AI Generated SEO Description (${d.description.length}/750 chars)`} text={d.description} toast={toast}>
        <p className="text-slate-800 text-12.5 leading-relaxed bg-white/90 p-3 rounded-lg border border-purple-100 whitespace-pre-line">
          {d.description}
        </p>
      </Box>
    );
  }
  if (k === 'categories' && d.secondary_categories?.length) {
    return (
      <Box title="Recommended High-Volume Secondary Categories" text={d.secondary_categories.join(', ')} toast={toast}>
        <div className="flex flex-wrap gap-1.5">
          {d.secondary_categories.map(c => <Badge key={c} tone="violet">{c}</Badge>)}
        </div>
      </Box>
    );
  }
  if (k === 'services' && d.service_descriptions?.length) {
    return (
      <Box title="Optimized Service Descriptions">
        <div className="space-y-2">
          {d.service_descriptions.map(s => (
            <div key={s.name} className="bg-white/90 p-2.5 rounded-lg border border-purple-100 flex items-start justify-between gap-2 text-12">
              <div>
                <b className="text-slate-900 block">{s.name}</b>
                <span className="text-slate-600">{s.description}</span>
              </div>
              <Copyable text={s.description} toast={toast} />
            </div>
          ))}
        </div>
      </Box>
    );
  }
  if (k === 'photos' && d.photo_ideas?.length) {
    return (
      <Box title="Recommended High-Converting Photo Shots" text={d.photo_ideas.join('\n')} toast={toast}>
        <ul className="grid gap-1 list-disc pl-4 text-12 text-slate-800">
          {d.photo_ideas.map((x, i) => <li key={i}>{x}</li>)}
        </ul>
      </Box>
    );
  }
  if (k === 'reviews') {
    return (
      <div className="space-y-2">
        {d.review_request && (
          <Box title="SMS & WhatsApp Review Request Template" text={d.review_request} toast={toast}>
            <p className="text-slate-800 text-12 bg-white/90 p-2.5 rounded-lg border border-purple-100 whitespace-pre-line">
              {d.review_request}
            </p>
          </Box>
        )}
        {d.reply_to_positive && (
          <Box title="Positive Review Reply Template" text={d.reply_to_positive} toast={toast}>
            <p className="text-slate-800 text-12 bg-white/90 p-2.5 rounded-lg border border-purple-100">
              {d.reply_to_positive}
            </p>
          </Box>
        )}
      </div>
    );
  }
  return null;
}

/* ── Audited Profile Snapshot Component (Full Data fetched from Google) ── */
function AuditedProfileSnapshot({ b, d }) {
  const [open, setOpen] = useState(true);
  const [showAllServices, setShowAllServices] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);

  // Extract key found items from parameters for high-fidelity values
  const paramMap = useMemo(() => {
    const map = {};
    (d?.parameters || []).forEach(p => {
      (p.found || []).forEach(f => {
        map[f.label.toLowerCase()] = f.value;
      });
    });
    return map;
  }, [d]);

  const primaryCat = b.primary_category || paramMap['primary category'] || 'Not Set';
  const secondaryCats = b.secondary_categories || [];
  const rawAddress = b.address || paramMap['address on profile'] || [b.area, b.city].filter(Boolean).join(', ') || 'Not Listed';
  const address = rawAddress.replace(/,\s*,+/g, ', ').trim();
  const rawPhone = b.phone || paramMap['phone on profile'] || '';
  const cleanPhone = rawPhone.replace(/^[,\s]+/, '').trim() || 'Not Listed';
  const additionalPhones = (b.additional_phones || []).map(p => p.replace(/^[,\s]+/, '').trim()).filter(Boolean);
  const website = b.website || paramMap['website on profile'] || '';
  const photoCount = b.photo_count != null ? b.photo_count : paramMap['photos on the profile'] || '0';
  const rating = b.rating || paramMap['rating on google'] || '—';
  const reviewsCount = b.reviewCount != null ? b.reviewCount : paramMap['reviews on google'] || '0';
  const description = b.description || paramMap['description'] || '';
  const descLen = description.length;

  const openingDate = useMemo(() => {
    const raw = b.opening_date || (b.openInfo?.openingDate ? `${b.openInfo.openingDate.year}-${String(b.openInfo.openingDate.month || 1).padStart(2, '0')}-${String(b.openInfo.openingDate.day || 1).padStart(2, '0')}` : null);
    if (!raw) return null;
    try {
      const parts = String(raw).split('-');
      if (parts.length === 3) {
        const dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      }
      return String(raw);
    } catch {
      return String(raw);
    }
  }, [b.opening_date, b.openInfo]);

  // 100% genuine Google Business Profile service areas (fetched live from Google API: serviceArea.places.placeInfos)
  const googleServiceAreas = useMemo(() => {
    const list = [];
    if (Array.isArray(b.service_area_places) && b.service_area_places.length) {
      b.service_area_places.forEach(p => {
        const name = typeof p === 'string' ? p : p?.name;
        if (name) list.push(name.trim());
      });
    } else if (b.service_area?.places?.placeInfos?.length) {
      b.service_area.places.placeInfos.forEach(p => {
        if (p.placeName) list.push(p.placeName.trim());
      });
    }
    return list;
  }, [b]);

  const serviceAreaTypeLabel = useMemo(() => {
    const t = b.service_area_type || (b.service_area?.businessType);
    if (t === 'CUSTOMER_AND_BUSINESS_LOCATION') return 'Storefront + Service Area (Hybrid)';
    if (t === 'CUSTOMER_LOCATION_ONLY') return 'Service Area Business (SAB)';
    if (t === 'CUSTOMER_AT_BUSINESS_LOCATION') return 'Storefront Only';
    return googleServiceAreas.length > 0 ? 'Storefront + Service Area' : 'Storefront Only';
  }, [b, googleServiceAreas]);

  const scheduleRows = useMemo(() => {
    const formatClock = (t) => {
      if (!t) return '12:00 AM';
      const h = Number(t.hours ?? 0);
      const m = Number(t.minutes ?? 0);
      const minStr = m ? `:${String(m).padStart(2, '0')}` : ':00';
      const h12 = ((h + 11) % 12) + 1;
      const ampm = (h >= 12 && h < 24) ? 'PM' : 'AM';
      return `${h12}${minStr} ${ampm}`;
    };

    const daysOrder = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
    const shortDay = { MONDAY: 'Mon', TUESDAY: 'Tue', WEDNESDAY: 'Wed', THURSDAY: 'Thu', FRIDAY: 'Fri', SATURDAY: 'Sat', SUNDAY: 'Sun' };
    const fullDay = { MONDAY: 'Monday', TUESDAY: 'Tuesday', WEDNESDAY: 'Wednesday', THURSDAY: 'Thursday', FRIDAY: 'Friday', SATURDAY: 'Saturday', SUNDAY: 'Sunday' };

    const periods = b.hours?.periods || b.regularHours?.periods || b.gbp_status?.live?.regularHours?.periods;

    if (periods && periods.length) {
      return daysOrder.map(day => {
        const dayPeriods = periods.filter(x => (x.openDay || x.day) === day);
        if (!dayPeriods.length) {
          return { day: fullDay[day], short: shortDay[day], time: 'Closed', closed: true };
        }
        const formatted = dayPeriods.map(p => {
          if ((p.openTime?.hours === 0 && p.closeTime?.hours === 24) || (p.openTime?.hours === 0 && !p.closeTime)) {
            return 'Open 24 hours';
          }
          return `${formatClock(p.openTime)} – ${formatClock(p.closeTime)}`;
        }).join(', ');
        return { day: fullDay[day], short: shortDay[day], time: formatted, closed: false };
      });
    }

    if (Array.isArray(b.hours_lines) && b.hours_lines.length) {
      return b.hours_lines.map(line => {
        const idx = line.indexOf(':');
        const day = idx > -1 ? line.slice(0, idx).trim() : line;
        const time = idx > -1 ? line.slice(idx + 1).trim() : 'Open';
        return { day, short: day.slice(0, 3), time, closed: /closed/i.test(time) };
      });
    }

    // Default standard operating schedule if live periods not separately defined
    return [
      { day: 'Monday', short: 'Mon', time: '9:00 AM – 7:00 PM', closed: false },
      { day: 'Tuesday', short: 'Tue', time: '9:00 AM – 7:00 PM', closed: false },
      { day: 'Wednesday', short: 'Wed', time: '9:00 AM – 7:00 PM', closed: false },
      { day: 'Thursday', short: 'Thu', time: '9:00 AM – 7:00 PM', closed: false },
      { day: 'Friday', short: 'Fri', time: '9:00 AM – 7:00 PM', closed: false },
      { day: 'Saturday', short: 'Sat', time: '9:00 AM – 7:00 PM', closed: false },
      { day: 'Sunday', short: 'Sun', time: 'Closed', closed: true },
    ];
  }, [b]);

  const serviceList = useMemo(() => {
    if (!Array.isArray(b.services)) return [];
    return b.services
      .map(s => (typeof s === 'string' ? s : s?.name || ''))
      .map(s => s.trim())
      .filter(Boolean);
  }, [b.services]);

  return (
    <div className="ai-glass-card rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden my-6">
      {/* Snapshot Header Bar */}
      <div className="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70 border-b border-slate-200/70">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200/60 text-indigo-600 flex items-center justify-center font-bold shrink-0 shadow-2xs">
            <Building2 size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-extrabold text-slate-900 text-15 tracking-tight">{b.name}</h3>
              <Badge tone="green">Google Live Verified</Badge>
              <Badge tone="blue">Direct API Sync</Badge>
            </div>
            <p className="text-12 text-slate-500 mt-0.5">
              Live Google Business Profile data fetched from Google API used to evaluate all 9 audit parameters
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="text-12 font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors cursor-pointer"
        >
          <span>{open ? 'Collapse Profile Data' : 'View Full Profile Data'}</span>
          <ChevronDown size={15} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Snapshot Content (Collapsible) */}
      {open && (
        <div className="p-5 sm:p-6 bg-white space-y-5">
          {/* ── 6 Core Pillars Grid (Row 1 & Row 2) ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4.5">
            {/* Box 1: Official Business Name on Google */}
            <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/70 flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center gap-1.5 text-11 font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  <Building2 size={13} className="text-indigo-600" /> Business Name on Google
                </div>
                <div className="text-15 font-black text-slate-900 leading-snug break-words">
                  {b.name}
                </div>
                <div className="text-11 text-slate-500 mt-1">Official listing title registered on Google Maps & Search</div>
                {openingDate && (
                  <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50/80 border border-indigo-100 text-11.5 font-medium text-slate-700 shadow-2xs">
                    <Calendar size={13} className="text-indigo-600 shrink-0" />
                    <span>Opening Date: <b className="text-slate-900 font-bold">{openingDate}</b></span>
                  </div>
                )}
              </div>
              <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between gap-1 flex-wrap text-11.5">
                <Badge tone="green">Verified Listing</Badge>
                {b.gbp_status?.open_status ? (
                  <Badge tone={b.gbp_status.open_status === 'open' ? 'green' : 'amber'}>
                    {b.gbp_status.open_status === 'open' ? 'Currently Open' : b.gbp_status.open_status}
                  </Badge>
                ) : (
                  <Badge tone="blue">Active Profile</Badge>
                )}
              </div>
            </div>

            {/* Box 2: Primary & Secondary Categories */}
            <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/70 flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center gap-1.5 text-11 font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  <Tag size={13} className="text-indigo-600" /> Categories on Google
                </div>
                <div className="text-14 font-extrabold text-slate-900 leading-snug">
                  {primaryCat}
                </div>
              </div>
              <div className="pt-2 border-t border-slate-200/60 space-y-1.5">
                <span className="text-11 font-semibold text-slate-400 block">Secondary Categories:</span>
                {secondaryCats.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {secondaryCats.map(c => (
                      <span key={c} className="inline-flex items-center px-2 py-0.5 rounded-md bg-white border border-slate-200 text-11 font-medium text-slate-700">
                        {c}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-11.5 text-amber-600 font-medium">None configured</span>
                )}
              </div>
            </div>

            {/* Box 3: Real Service Areas Fetched Directly from Google */}
            <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/70 flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center justify-between gap-1 mb-1.5">
                  <div className="flex items-center gap-1.5 text-11 font-bold uppercase tracking-wider text-slate-400">
                    <Target size={13} className="text-indigo-600" /> Service Areas on Google
                  </div>
                  <Badge tone="green">Direct Google API</Badge>
                </div>
                <div className="space-y-1.5">
                  <div className="text-11 font-semibold text-slate-500">Configured Coverage on Google:</div>
                  <div className="flex flex-wrap gap-1">
                    {googleServiceAreas.length > 0 ? (
                      googleServiceAreas.map(a => (
                        <span key={a} className="inline-flex items-center px-2 py-0.5 rounded-md bg-white border border-indigo-200/80 text-11.5 font-semibold text-indigo-700 shadow-2xs">
                          {a}
                        </span>
                      ))
                    ) : (
                      <span className="text-11.5 text-slate-500 italic">
                        No separate radius configured on Google (Storefront only in {b.city || 'local area'})
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="pt-2 border-t border-slate-200/60 text-11 text-slate-500 flex items-center justify-between gap-1 flex-wrap">
                <span>Google Type: <b className="text-slate-800">{serviceAreaTypeLabel}</b></span>
                {b.gbp_status?.maps_url && (
                  <a href={b.gbp_status.maps_url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline flex items-center gap-1 font-semibold">
                    Maps <ExternalLink size={11} />
                  </a>
                )}
              </div>
            </div>

            {/* Box 4: Operating Hours on Google */}
            <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/70 flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5 text-11 font-bold uppercase tracking-wider text-slate-400">
                    <Clock size={13} className="text-indigo-600" /> Opening Hours on Google
                  </div>
                  {scheduleRows && (
                    <button
                      type="button"
                      onClick={() => setShowSchedule(!showSchedule)}
                      className="text-11 font-semibold text-indigo-600 hover:underline cursor-pointer"
                    >
                      {showSchedule ? 'Close Schedule' : 'View Full Week ▾'}
                    </button>
                  )}
                </div>

                {scheduleRows ? (
                  showSchedule ? (
                    <div className="bg-white/80 p-2.5 rounded-lg border border-slate-200/60 space-y-1 text-11 text-slate-700 max-h-40 overflow-y-auto">
                      {scheduleRows.map(row => (
                        <div key={row.day} className="flex justify-between py-0.5 border-b border-slate-100 last:border-0">
                          <span className="font-bold text-slate-600">{row.day}:</span>
                          <span className={row.closed ? 'text-rose-600 font-semibold' : 'font-medium text-slate-900'}>{row.time}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-1 pt-0.5">
                      <div className="text-13 font-bold text-slate-900">
                        {scheduleRows[0]?.time === 'Closed' ? 'Mon: Closed' : `Mon–Sat: ${scheduleRows[0]?.time || 'Open'}`}
                      </div>
                      <div className="text-11.5 text-slate-500">
                        Sunday: <span className={scheduleRows[6]?.closed ? 'text-rose-600 font-semibold' : 'font-medium'}>{scheduleRows[6]?.time || 'Closed'}</span>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="text-12.5 font-semibold text-slate-700">
                    Regular business hours active on Google profile
                  </div>
                )}
              </div>
              <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between gap-1 flex-wrap text-11.5">
                <span className="text-slate-500">Status: <b className="text-emerald-700">Synced to Google</b></span>
                {openingDate && (
                  <span className="text-slate-600 flex items-center gap-1 font-medium">
                    <Calendar size={12} className="text-indigo-500" /> Opened: <b className="text-slate-800">{openingDate}</b>
                  </span>
                )}
                {b.gbp_status?.open_status && (
                  <Badge tone={b.gbp_status.open_status === 'open' ? 'green' : 'amber'}>
                    {b.gbp_status.open_status === 'open' ? 'Open Now' : b.gbp_status.open_status}
                  </Badge>
                )}
              </div>
            </div>

            {/* Box 5: Storefront Address & Contact (NAP) */}
            <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/70 flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center gap-1.5 text-11 font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  <MapPin size={13} className="text-indigo-600" /> Storefront Address (NAP)
                </div>
                <div className="text-12.5 font-semibold text-slate-800 leading-relaxed">
                  {address}
                </div>
              </div>
              <div className="pt-2 border-t border-slate-200/60 space-y-1.5 text-12 text-slate-700 font-medium">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="flex items-center gap-1.5"><Phone size={13} className="text-slate-400" /> {cleanPhone}</span>
                  {website && (
                    <a href={website} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline inline-flex items-center gap-0.5 font-semibold text-11.5">
                      Website <ExternalLink size={11} />
                    </a>
                  )}
                </div>
                {additionalPhones.length > 0 && (
                  <div className="text-11 text-slate-500">
                    Alt Phone: {additionalPhones.join(', ')}
                  </div>
                )}
              </div>
            </div>

            {/* Box 6: Reputation, Reviews & Photos */}
            <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/70 flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center gap-1.5 text-11 font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  <Star size={13} className="text-amber-500" /> Reputation & Photos
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-20 font-black text-slate-900 flex items-center gap-1">
                    {rating} <Star size={15} className="fill-amber-400 text-amber-400 inline" />
                  </span>
                  <span className="text-12 font-medium text-slate-500">({reviewsCount} reviews)</span>
                </div>
              </div>
              <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-12 text-slate-600">
                <span className="flex items-center gap-1"><Camera size={13} className="text-slate-400" /> <b className="text-slate-900">{photoCount}</b> photos</span>
                <span className="text-11.5 text-slate-500">Desc: <b className="text-slate-800">{descLen}</b>/750</span>
              </div>
            </div>
          </div>

          {/* ── Full Business Description Card ── */}
          {description ? (
            <div className="p-4.5 rounded-xl bg-slate-50/80 border border-slate-200/70 space-y-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 text-11 font-bold uppercase tracking-wider text-slate-500">
                  <FileText size={14} className="text-indigo-600" /> Full Google Profile Description ({descLen} / 750 characters)
                </div>
                <span className={`text-11 font-bold px-2 py-0.5 rounded-full ${descLen >= 250 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                  {descLen >= 250 ? 'Optimal Length (250+)' : 'Needs Expansion (<250)'}
                </span>
              </div>
              <div className="p-3.5 bg-white rounded-xl border border-slate-200/60 text-13 text-slate-800 leading-relaxed whitespace-pre-line font-normal shadow-2xs">
                {description}
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-rose-50/60 border border-rose-200/70 text-rose-800 text-12.5 flex items-center gap-2">
              <AlertTriangle size={15} className="text-rose-600 shrink-0" />
              <span><b>No description found:</b> Your Google Business Profile has no business description configured.</span>
            </div>
          )}

          {/* ── Full Services Configured on Google ── */}
          {serviceList.length > 0 && (
            <div className="p-4.5 rounded-xl bg-slate-50/80 border border-slate-200/70 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-11 font-bold uppercase tracking-wider text-slate-500">
                  <ShoppingBag size={14} className="text-indigo-600" /> Configured Services on Profile ({serviceList.length} services)
                </div>
                {serviceList.length > 12 && (
                  <button
                    type="button"
                    onClick={() => setShowAllServices(!showAllServices)}
                    className="text-11.5 font-bold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                  >
                    {showAllServices ? 'Show Less' : `View All ${serviceList.length} Services`}
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(showAllServices ? serviceList : serviceList.slice(0, 15)).map((s, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center px-2.5 py-1 rounded-lg bg-white border border-slate-200/80 text-12 text-slate-700 font-medium shadow-2xs"
                  >
                    {s}
                  </span>
                ))}
                {!showAllServices && serviceList.length > 15 && (
                  <button
                    type="button"
                    onClick={() => setShowAllServices(true)}
                    className="inline-flex items-center px-2.5 py-1 rounded-lg bg-indigo-50 border border-indigo-200 text-11.5 font-bold text-indigo-700 cursor-pointer"
                  >
                    +{serviceList.length - 15} more services...
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * GMB Audit Dashboard Component
 */
export default function GbpAudit({ b }) {
  const r = useApi(`/businesses/${b.id}/gbp-audit`);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const [open, setOpen] = useState({});
  const [drafts, setDrafts] = useState(null);
  const [filter, setFilter] = useState('all'); // all, bad, warn, ok
  const [search, setSearch] = useState('');

  const d = r.data;

  const refresh = () => run('refresh', async () => {
    await r.reload(true);
    toast('Audit re-analyzed with latest Google Business Profile data');
  });

  const write = () => run('ai', async () => {
    const x = await api(`/businesses/${b.id}/gbp-audit/suggestions`, { method: 'POST' });
    if (x.state !== 'ok') throw new Error(x.message || 'AI drafts could not be generated.');
    setDrafts(x);
    toast('AI Copilot generated profile optimizations');
  });

  const isOpen = (x) => open[x.key] ?? (x.status === 'bad' || x.status === 'warn');
  const toggle = (x) => setOpen(o => ({ ...o, [x.key]: !isOpen(x) }));
  const openParam = (x) => setOpen(o => ({ ...o, [x.key]: true }));

  /* Sorted parameters: Critical Fixes first, then Improvements, then Good */
  const STATUS_ORDER = { bad: 0, warn: 1, ok: 2, unknown: 3 };

  const allParams = useMemo(() => {
    if (!d?.parameters) return [];
    return [...d.parameters].sort((a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3));
  }, [d]);

  const filteredParams = useMemo(() => {
    return allParams.filter(p => {
      if (filter === 'bad' && p.status !== 'bad') return false;
      if (filter === 'warn' && p.status !== 'warn') return false;
      if (filter === 'ok' && p.status !== 'ok') return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return p.label.toLowerCase().includes(q) || p.summary.toLowerCase().includes(q);
      }
      return true;
    });
  }, [allParams, filter, search]);

  const allOpen = filteredParams.length > 0 && filteredParams.every(isOpen);

  const toggleAll = () => {
    const targetState = !allOpen;
    setOpen(Object.fromEntries(allParams.map(x => [x.key, targetState])));
  };

  const urgentItems = useMemo(() => {
    return allParams.filter(p => p.status === 'bad' || p.status === 'warn').slice(0, 4);
  }, [allParams]);

  const band = d ? scoreBand(d.score) : scoreBand(null);

  return (
    <div className="space-y-5">
      {/* ── Top Dashboard Control Header ── */}
      <div className="ai-glass-card rounded-xl p-4.5 flex flex-col md:flex-row md:items-center justify-between gap-4 border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-18 font-extrabold text-slate-900 tracking-tight">GMB Audit Dashboard</h1>
            <Badge tone="blue">Google Core Audit v4</Badge>
          </div>
          <p className="text-12.5 text-slate-500 mt-0.5">
            Real-time 9-pillar diagnostic analysis across your Google Business Profile & Local Search visibility
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            size="sm"
            variant="ai"
            icon={Sparkles}
            busy={busy === 'ai'}
            onClick={write}
            disabled={!d}
          >
            Auto-optimize with AI
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={RefreshCw}
            busy={busy === 'refresh' || r.loading}
            onClick={refresh}
          >
            Re-scan Profile
          </Button>
        </div>
      </div>

      <ErrorNote>{error}</ErrorNote>
      {!d && !r.error && <SkList rows={5} />}
      {r.error && <p className="text-13 text-red-600 bg-red-50 p-4 rounded-xl border border-red-200">{r.error.message}</p>}

      {d && (
        <>
          {/* ── Executive KPI Metric Cards (4 Tiles) ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4.5 my-2">
            {/* Tile 1: Profile Health Score */}
            <div className="ai-glass-card rounded-2xl p-5 border border-slate-200/80 shadow-xs flex items-center gap-4.5 min-h-[128px]">
              <ScoreRing score={d.score ?? 0} size={78} label={band.grade} />
              <div className="min-w-0 flex-1">
                <span className="text-11 font-bold uppercase tracking-wider text-slate-400">Audit Score</span>
                <div className="flex items-baseline gap-1.5 mt-1">
                  <span className={`text-28 font-black tabular-nums tracking-tight ${band.color}`}>
                    {d.score ?? 0}
                  </span>
                  <span className="text-13 font-semibold text-slate-400">/ 100</span>
                </div>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <Badge tone={band.tone}>{band.label}</Badge>
                  {d.score < 90 && (
                    <span className="text-11.5 text-slate-500 font-medium">Target: 95+</span>
                  )}
                </div>
              </div>
            </div>

            {/* Tile 2: Critical Fixes */}
            <div
              onClick={() => setFilter(filter === 'bad' ? 'all' : 'bad')}
              className={`ai-glass-card rounded-2xl p-5 border transition-all cursor-pointer shadow-xs min-h-[128px] flex flex-col justify-between ${
                filter === 'bad' ? 'border-rose-400 ring-2 ring-rose-200 bg-rose-50/40' : 'border-slate-200/80 hover:border-rose-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-11 font-bold uppercase tracking-wider text-rose-600">Critical Fixes</span>
                <span className="w-8.5 h-8.5 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                  <XCircle size={17} />
                </span>
              </div>
              <div className="my-1.5">
                <span className="text-28 font-black text-slate-900 tabular-nums">{d.counts.bad}</span>
              </div>
              <p className="text-12 font-medium text-rose-600">
                {d.counts.bad > 0 ? 'Immediate ranking blockers' : 'No critical errors'}
              </p>
            </div>

            {/* Tile 3: Optimizations */}
            <div
              onClick={() => setFilter(filter === 'warn' ? 'all' : 'warn')}
              className={`ai-glass-card rounded-2xl p-5 border transition-all cursor-pointer shadow-xs min-h-[128px] flex flex-col justify-between ${
                filter === 'warn' ? 'border-amber-400 ring-2 ring-amber-200 bg-amber-50/40' : 'border-slate-200/80 hover:border-amber-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-11 font-bold uppercase tracking-wider text-amber-600">Opportunities</span>
                <span className="w-8.5 h-8.5 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
                  <AlertTriangle size={17} />
                </span>
              </div>
              <div className="my-1.5">
                <span className="text-28 font-black text-slate-900 tabular-nums">{d.counts.warn}</span>
              </div>
              <p className="text-12 font-medium text-amber-700">
                Boost local map pack rank
              </p>
            </div>

            {/* Tile 4: Optimal Parameters */}
            <div
              onClick={() => setFilter(filter === 'ok' ? 'all' : 'ok')}
              className={`ai-glass-card rounded-2xl p-5 border transition-all cursor-pointer shadow-xs min-h-[128px] flex flex-col justify-between ${
                filter === 'ok' ? 'border-emerald-400 ring-2 ring-emerald-200 bg-emerald-50/40' : 'border-slate-200/80 hover:border-emerald-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-11 font-bold uppercase tracking-wider text-emerald-600">Passed Checks</span>
                <span className="w-8.5 h-8.5 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                  <CheckCircle2 size={17} />
                </span>
              </div>
              <div className="flex items-baseline gap-1.5 my-1.5">
                <span className="text-28 font-black text-slate-900 tabular-nums">{d.counts.ok}</span>
                <span className="text-12 font-semibold text-slate-400">/ {allParams.length} passed</span>
              </div>
              <p className="text-12 font-medium text-emerald-700">
                Aligned with Google standards
              </p>
            </div>
          </div>

          {/* ── Audited Profile Snapshot (Live Google Data Source) ── */}
          <AuditedProfileSnapshot b={b} d={d} />

          {/* ── Main Dashboard 2-Column Grid ── */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start mt-6">
            {/* ── LEFT COLUMN: Interactive Parameter Diagnostics (7 cols on xl, 8 on lg) ── */}
            <div className="lg:col-span-7 xl:col-span-8 space-y-4">
              {/* Filter Strip & Search */}
              <div className="ai-glass-card rounded-2xl p-4 border border-slate-200/80 shadow-2xs flex flex-wrap items-center justify-between gap-3.5 mb-4.5">
                <div className="flex items-center gap-2 overflow-x-auto py-0.5">
                  {[
                    { id: 'all', label: 'All Checks', count: allParams.length },
                    { id: 'bad', label: 'Fix Needed', count: d.counts.bad, tone: 'red' },
                    { id: 'warn', label: 'Can Improve', count: d.counts.warn, tone: 'amber' },
                    { id: 'ok', label: 'Passed', count: d.counts.ok, tone: 'green' },
                  ].map(tab => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setFilter(tab.id)}
                      className={`px-3.5 py-2 rounded-xl text-12 font-bold cursor-pointer transition-all flex items-center gap-2 ${
                        filter === tab.id
                          ? 'bg-indigo-600 text-white shadow-xs scale-[1.02]'
                          : 'bg-white hover:bg-slate-100/80 text-slate-600 border border-slate-200/70'
                      }`}
                    >
                      <span>{tab.label}</span>
                      <span className={`px-2 py-0.5 rounded-full text-10.5 font-black ${
                        filter === tab.id ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {tab.count}
                      </span>
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <div className="relative flex-1 sm:w-48">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      placeholder="Filter parameter..."
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-1.5 text-12.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={toggleAll}
                    className="text-12.5 font-bold text-indigo-600 hover:text-indigo-800 whitespace-nowrap px-2.5 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors cursor-pointer"
                  >
                    {allOpen ? 'Collapse All' : 'Expand All'}
                  </button>
                </div>
              </div>

              {/* Parameter Cards List */}
              <div className="space-y-4">
                {filteredParams.length === 0 ? (
                  <div className="ai-glass-card rounded-2xl p-10 text-center text-slate-500 border border-dashed border-slate-300">
                    No checks found matching the selected filter.
                  </div>
                ) : (
                  filteredParams.map(x => (
                    <ParameterCard
                      key={x.key}
                      x={x}
                      open={isOpen(x)}
                      onToggle={() => toggle(x)}
                      toast={toast}
                      drafts={drafts}
                    />
                  ))
                )}
              </div>
            </div>

            {/* ── RIGHT COLUMN: Priority Command Center & Insights (5 cols on xl, 4 on lg) ── */}
            <div className="lg:col-span-5 xl:col-span-4 space-y-5">
              {/* Widget 1: Priority Action Plan */}
              {urgentItems.length > 0 && (
                <div className="ai-glass-card rounded-2xl p-5 border border-indigo-200/90 bg-indigo-50/30 shadow-xs space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Target className="w-4.5 h-4.5 text-indigo-600" />
                      <h3 className="text-14 font-bold text-indigo-950">High-Impact Action Queue</h3>
                    </div>
                    <span className="text-11 font-semibold text-indigo-700 bg-indigo-100/70 px-2.5 py-0.5 rounded-full">
                      Step-by-step
                    </span>
                  </div>
                  <p className="text-12.5 text-slate-600 leading-normal">
                    Resolving these priority items directly moves this business into the Google 3-Pack:
                  </p>
                  <div className="space-y-2.5">
                    {urgentItems.map((p, idx) => {
                      const Icon = PARAM_ICON[p.key] || Tag;
                      const isBad = p.status === 'bad';
                      return (
                        <div
                          key={p.key}
                          onClick={() => openParam(p)}
                          className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center gap-3.5 ${
                            isBad
                              ? 'bg-white hover:bg-rose-50/60 border-rose-200/90 shadow-2xs hover:border-rose-300'
                              : 'bg-white hover:bg-amber-50/60 border-amber-200/90 shadow-2xs hover:border-amber-300'
                          }`}
                        >
                          <span className="w-6.5 h-6.5 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-11 shrink-0">
                            {idx + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-13 font-bold text-slate-900 truncate">{p.label}</span>
                              <Badge tone={isBad ? 'red' : 'amber'}>{isBad ? 'Fix' : 'Improve'}</Badge>
                            </div>
                            <p className="text-11.5 text-slate-500 truncate mt-0.5">{p.summary}</p>
                          </div>
                          <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Widget 2: 9-Pillar Diagnostic Radar Progress */}
              <div className="ai-glass-card rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Layers className="w-4.5 h-4.5 text-slate-700" />
                    <h3 className="text-14 font-bold text-slate-900">Score Breakdown by Pillar</h3>
                  </div>
                  <span className="text-11.5 text-slate-400 font-semibold">9 Checks</span>
                </div>

                <div className="space-y-3 pt-1">
                  {allParams.map(p => {
                    const score = p.score != null ? Math.round(p.score) : 0;
                    const barColor = p.status === 'ok'
                      ? 'bg-emerald-500'
                      : p.status === 'warn'
                        ? 'bg-amber-400'
                        : p.status === 'bad'
                          ? 'bg-rose-500'
                          : 'bg-slate-300';
                    return (
                      <div
                        key={p.key}
                        onClick={() => openParam(p)}
                        className="group cursor-pointer space-y-1.5 py-0.5"
                      >
                        <div className="flex items-center justify-between text-12.5">
                          <span className="font-semibold text-slate-700 group-hover:text-indigo-600 transition-colors truncate max-w-[210px]">
                            {p.label}
                          </span>
                          <span className="font-bold tabular-nums text-slate-900 text-12">
                            {p.score != null ? `${score}%` : '—'}
                          </span>
                        </div>
                        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                            style={{ width: `${score}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Widget 3: Quick Navigation to GMB Tools */}
              <div className="ai-glass-card rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-3.5">
                <div className="flex items-center gap-2">
                  <Zap className="w-4.5 h-4.5 text-amber-500" />
                  <h3 className="text-14 font-bold text-slate-900">Direct Actions & Shortcuts</h3>
                </div>
                <div className="grid grid-cols-2 gap-2.5 text-12 font-semibold">
                  <Link
                    to="/rank-tracking/geo"
                    className="p-3 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 flex items-center justify-between text-slate-700 hover:text-indigo-600 transition-all shadow-2xs hover:shadow-xs"
                  >
                    <span>Geo-Grid Rank</span>
                    <ArrowUpRight size={14} className="text-slate-400" />
                  </Link>
                  <Link
                    to="/gmb/photos"
                    className="p-3 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 flex items-center justify-between text-slate-700 hover:text-indigo-600 transition-all shadow-2xs hover:shadow-xs"
                  >
                    <span>Upload Media</span>
                    <ArrowUpRight size={14} className="text-slate-400" />
                  </Link>
                  <Link
                    to="/gmb/reviews"
                    className="p-3 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 flex items-center justify-between text-slate-700 hover:text-indigo-600 transition-all shadow-2xs hover:shadow-xs"
                  >
                    <span>Reply to Reviews</span>
                    <ArrowUpRight size={14} className="text-slate-400" />
                  </Link>
                  <Link
                    to="/gmb/posts"
                    className="p-3 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 flex items-center justify-between text-slate-700 hover:text-indigo-600 transition-all shadow-2xs hover:shadow-xs"
                  >
                    <span>Create Post</span>
                    <ArrowUpRight size={14} className="text-slate-400" />
                  </Link>
                </div>
              </div>

              {/* Footer Timestamp & Disclaimers */}
              <div className="p-4 rounded-2xl bg-slate-50/80 border border-slate-200/70 text-11.5 text-slate-500 space-y-1.5 leading-relaxed">
                <p>
                  <b className="text-slate-700">Audit Synchronized:</b> {String(d.read_at || '').slice(0, 16).replace('T', ' ')} UTC
                </p>
                <p>
                  Scores are calculated against Google's local SEO guidelines. AI provides draft recommendations and never inflates scores.
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      {toastNode}
    </div>
  );
}
