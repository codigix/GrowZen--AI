import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronDown, Check, X, Loader2, AlertTriangle, AlertCircle, CheckCircle2, Info, MapPin,
  Plug, ServerCrash, Plus, Mail, Store, RefreshCw, Sparkles, Building2, ExternalLink, Cpu,
  Bell, Calendar
} from 'lucide-react';
import { api, toUi, SEO_API } from './seoApi';

// High-tech Neon Categorical Palette
export const SERIES = ['#818cf8', '#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#60a5fa', '#f87171'];
export const STATUS = { good: '#10b981', warning: '#f59e0b', serious: '#f97316', critical: '#ef4444' };
export const INK = { primary: '#f8fafc', secondary: '#94a3b8', muted: '#64748b', grid: '#1e293b', axis: '#334155', up: '#34d399' };

// Shared businesses store
const store = { list: null, error: null, loading: false, listeners: new Set() };
const notify = () => store.listeners.forEach(fn => fn());

export const refreshBusinesses = async () => {
  store.loading = true; notify();
  try {
    store.list = (await api('/businesses')).map(toUi);
    store.error = null;
  } catch (e) {
    store.error = e;
  }
  store.loading = false; notify();
  return store.list;
};

export const useBusinesses = () => {
  const [, force] = useReducer(x => x + 1, 0);
  useEffect(() => {
    store.listeners.add(force);
    if (!store.list && !store.loading) refreshBusinesses();
    return () => store.listeners.delete(force);
  }, []);
  return { list: store.list, error: store.error, loading: store.loading, refresh: refreshBusinesses };
};

// Selected business in current browser
const KEY = 'seoBusinessId';
export const useSeoBusiness = () => {
  const { list } = useBusinesses();
  const read = () => { try { return Number(localStorage.getItem(KEY)) || null; } catch (e) { return null; } };
  const [id, setId] = useState(read);
  useEffect(() => {
    const on = () => setId(read());
    window.addEventListener('seo-business', on);
    return () => window.removeEventListener('seo-business', on);
  }, []);
  const choose = useCallback((next) => {
    try { localStorage.setItem(KEY, String(next)); } catch (e) { /* private window */ }
    setId(Number(next));
    window.dispatchEvent(new Event('seo-business'));
  }, []);
  const business = list ? (list.find(b => b.id === id) || list[0] || null) : null;
  return [business, choose];
};

export const useSimulated = () => {
  const [busy, setBusy] = useState('');
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const run = useCallback((label, fn, ms = 1100) => {
    setBusy(label);
    timer.current = setTimeout(() => { setBusy(''); fn(); }, ms);
  }, []);
  return [busy, run];
};

export const useAction = () => {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const run = useCallback(async (label, fn) => {
    setBusy(label); setError('');
    try { return await fn(); } catch (e) { setError(e.message || String(e)); return undefined; } finally { setBusy(''); }
  }, []);
  return [busy, error, run, setError];
};

export const useModulePath = () => (slug) => `/${slug}`;

// Futuristic Glassmorphic Business Switcher
const BusinessSwitcher = ({ business, onChange, list }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const path = useModulePath();

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2.5 h-10 px-3 bg-[#0d1424] hover:bg-[#131b2e] border border-white/10 rounded-xl transition-all cursor-pointer text-left group"
      >
        <span className="w-7 h-7 rounded-full bg-blue-600 text-white text-[12px] font-bold flex items-center justify-center shrink-0 shadow-sm">
          {business.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 pr-1">
          <div className="text-[12px] font-bold text-white truncate max-w-[150px] leading-tight group-hover:text-blue-300 transition-colors">
            {business.name}
          </div>
          <div className="text-[10px] text-slate-400 truncate leading-tight mt-0.5">
            {[business.city, business.area].filter(Boolean).join(', ') || 'PCMC, Pune'} ▾
          </div>
        </div>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-84 bg-slate-900/95 backdrop-blur-2xl border border-white/15 rounded-2xl shadow-2xl z-50 py-2 overflow-hidden animate-in fade-in zoom-in-95 duration-150 text-slate-100 ring-1 ring-black/50">
          <div className="px-4 py-2 border-b border-white/10 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 font-mono">Managed Entities</span>
            <span className="text-[11px] bg-slate-800 text-cyan-300 border border-cyan-500/30 font-bold px-2 py-0.5 rounded-full">
              {list.length} clients
            </span>
          </div>

          <div className="max-h-[60vh] overflow-y-auto no-scrollbar py-1">
            {list.map(b => (
              <button
                key={b.id}
                onClick={() => { onChange(b.id); setOpen(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors cursor-pointer ${
                  b.id === business.id ? 'bg-indigo-600/20 text-white font-medium border-l-2 border-indigo-400' : 'hover:bg-white/5 text-slate-300'
                }`}
              >
                <span className={`w-8 h-8 rounded-xl text-[12px] font-bold flex items-center justify-center shrink-0 ${
                  b.id === business.id ? 'bg-gradient-to-tr from-indigo-600 to-cyan-500 text-white shadow-md' : 'bg-slate-800 text-slate-300 border border-white/10'
                }`}>
                  {b.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-semibold truncate text-white">{b.name}</span>
                  <span className="block text-[11px] text-slate-400 truncate flex items-center gap-1 mt-0.5">
                    <MapPin size={11} className="text-slate-500" /> {[b.area, b.city].filter(Boolean).join(', ') || 'Online / Remote'}
                  </span>
                </span>
                {b.id === business.id && (
                  <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center shrink-0">
                    <Check size={12} strokeWidth={2.5} />
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="p-2.5 border-t border-white/10 bg-slate-950/60">
            <button
              onClick={() => { setOpen(false); navigate(`${path('gmb-profile')}?connect=1`); }}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-600 hover:opacity-95 text-white text-[12px] font-bold shadow-md transition-all cursor-pointer"
            >
              <Plus size={14} /> Add new client business
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export const BackendDown = ({ error, onRetry }) => (
  <div className="bg-slate-900/90 backdrop-blur-xl rounded-2xl border border-rose-500/30 p-8 max-w-2xl shadow-2xl shadow-rose-950/40 text-slate-100">
    <div className="flex items-center gap-3.5 text-rose-400 font-bold text-lg font-display">
      <div className="w-11 h-11 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
        <ServerCrash size={24} />
      </div>
      <div>
        <div>{error?.status === 401 ? 'Authentication Required' : error?.status === 403 ? 'Access Forbidden' : 'Backend Engine Offline'}</div>
        <p className="text-[13px] text-slate-400 font-normal mt-0.5">{error?.message || 'FastAPI service on port 8000 is not responding'}</p>
      </div>
    </div>
    {!error?.status && (
      <div className="mt-6">
        <span className="text-[12px] font-bold text-slate-400 uppercase tracking-wider font-mono">Terminal start command:</span>
        <pre className="mt-2 text-[12px] bg-slate-950 text-slate-200 rounded-xl p-4 font-mono overflow-x-auto border border-white/10 shadow-inner">
          {'cd backend\n.\\.venv\\Scripts\\activate\nuvicorn app.main:app --port 8000'}
        </pre>
      </div>
    )}
    <div className="mt-6 flex items-center justify-between pt-4 border-t border-white/10">
      <span className="text-[12px] text-slate-400 font-mono">Endpoint: {SEO_API}</span>
      <Button variant="primary" icon={RefreshCw} onClick={onRetry}>Retry Handshake</Button>
    </div>
  </div>
);

const NoBusinesses = ({ onCreated }) => {
  const navigate = useNavigate();
  const path = useModulePath();
  const [form, setForm] = useState({ name: '', primary_category: '', phone: '', website: '', area: '', city: '' });
  const [busy, error, run] = useAction();
  const create = () => run('create', async () => {
    const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim()));
    const b = await api('/businesses', { method: 'POST', body });
    await refreshBusinesses();
    onCreated(b.id);
  });

  return (
    <div className="bg-slate-900/80 backdrop-blur-xl rounded-3xl border border-white/15 p-8 max-w-3xl shadow-2xl text-slate-100">
      <div className="flex items-center gap-3.5">
        <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shadow-sm">
          <Building2 size={24} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white font-display">No Managed Businesses Found</h2>
          <p className="text-[13px] text-slate-400 mt-0.5">Initialize the first client to activate the autonomous SEO pipeline.</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          onClick={() => navigate(`${path('gmb-profile')}?connect=1`)}
          className="text-left p-5 rounded-2xl border border-white/10 hover:border-indigo-400 hover:bg-white/5 transition-all cursor-pointer group bg-slate-950/40"
        >
          <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
            <Store size={18} />
          </div>
          <div className="text-[14px] font-bold text-white group-hover:text-cyan-300 transition-colors">Connect Google Account</div>
          <div className="text-[12px] text-slate-400 mt-1">Import Business Profiles, locations, and live reviews directly.</div>
        </button>
        <button
          onClick={() => navigate(path('automation-pipeline'))}
          className="text-left p-5 rounded-2xl border border-white/10 hover:border-indigo-400 hover:bg-white/5 transition-all cursor-pointer group bg-slate-950/40"
        >
          <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
            <Mail size={18} />
          </div>
          <div className="text-[14px] font-bold text-white group-hover:text-cyan-300 transition-colors">Onboarding Email Pipeline</div>
          <div className="text-[12px] text-slate-400 mt-1">Paste onboarding briefing; autonomous AI parses attributes and starts audit.</div>
        </button>
      </div>

      <div className="mt-8 pt-6 border-t border-white/10">
        <h3 className="text-[14px] font-bold text-white">Or Register Client Manually</h3>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
          {[['name', 'Business name *'], ['primary_category', 'Category (e.g. Multispeciality Hospital)'], ['phone', 'Phone Number'], ['website', 'Website URL'], ['area', 'Area (e.g. Chinchwad)'], ['city', 'City (e.g. PCMC)']].map(([k, l]) => (
            <input key={k} className={inputCls} placeholder={l} value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} />
          ))}
        </div>
        <ErrorNote>{error}</ErrorNote>
        <div className="mt-5 flex justify-end">
          <Button variant="primary" icon={Plus} busy={busy === 'create'} disabled={!form.name.trim()} onClick={create}>
            Create Business
          </Button>
        </div>
      </div>
    </div>
  );
};

/**
 * Top Page Shell: High-tech obsidian glass header with breadcrumbs and business switcher.
 */
export const SeoShell = ({ title, subtitle, actions, children, hideSwitcher = false, needsBusiness = true }) => {
  const { list, error, refresh } = useBusinesses();
  const [business, setBusiness] = useSeoBusiness();

  let body;
  if (error && !list) body = <BackendDown error={error} onRetry={refresh} />;
  else if (!list && needsBusiness) body = (
    <div className="py-28 flex flex-col items-center justify-center gap-3.5 text-slate-400">
      <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shadow-sm animate-pulse">
        <Loader2 size={24} className="animate-spin text-cyan-400" />
      </div>
      <span className="text-[14px] font-semibold text-slate-300">Synchronizing neural pipelines…</span>
    </div>
  );
  else if (needsBusiness && !business) body = <NoBusinesses onCreated={setBusiness} />;
  else body = typeof children === 'function' ? children(business) : children;

  return (
    <div className="min-h-screen text-slate-100 bg-[#070b14]">
      {/* Top Header Banner matching reference image */}
      <header className="bg-[#090e1c] border-b border-[#151c2e] sticky top-0 z-30">
        <div className="max-w-[1520px] mx-auto px-6 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[17px] font-bold text-white tracking-tight font-display">{title}</h1>
            {subtitle && <p className="text-[11px] text-slate-400 mt-0.5 font-normal">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2.5 flex-wrap">
            {/* Calendar Last 30 Days Dropdown */}
            <div className="h-9 px-3 rounded-xl bg-[#0d1424] border border-white/10 flex items-center gap-2 text-[12px] font-medium text-slate-300 hover:text-white cursor-pointer transition-colors shadow-xs">
              <Calendar size={13} className="text-slate-400" />
              <span>Last 30 Days</span>
              <ChevronDown size={13} className="text-slate-500" />
            </div>

            {/* Notification Bell with Badge 3 */}
            <div className="relative w-9 h-9 rounded-xl bg-[#0d1424] border border-white/10 flex items-center justify-center text-slate-300 hover:text-white cursor-pointer transition-colors">
              <Bell size={15} />
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-600 text-white font-bold text-[9px] flex items-center justify-center shadow-xs">
                3
              </span>
            </div>

            {actions}
            {!hideSwitcher && business && list?.length > 0 && (
              <BusinessSwitcher business={business} onChange={setBusiness} list={list} />
            )}
          </div>
        </div>
      </header>

      {/* Main Page Container */}
      <div className="max-w-[1520px] mx-auto px-6 py-5 animate-in fade-in duration-200">
        {body}
      </div>
    </div>
  );
};

export const ErrorNote = ({ children }) => (
  children ? (
    <div className="mt-2 text-[12px] font-semibold text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3.5 py-2 flex items-center gap-2">
      <AlertCircle size={15} className="shrink-0 text-rose-400" />
      <span>{children}</span>
    </div>
  ) : null
);

export const SourceTag = ({ source }) => (
  source === 'sample' ? (
    <span title="Sample simulated data" className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/25 text-[11px] font-semibold font-mono">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> sample
    </span>
  ) : source === 'live' ? (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/25 text-[11px] font-semibold font-mono">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> live sync
    </span>
  ) : null
);

export const PreviewNote = ({ children }) => (
  <div className="mb-5 p-4 rounded-2xl border border-indigo-500/25 bg-gradient-to-r from-indigo-950/40 via-purple-950/30 to-slate-900/60 text-[13px] text-indigo-200 flex items-start gap-3 shadow-lg">
    <div className="w-7 h-7 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-cyan-300 shrink-0 mt-0.5">
      <Sparkles size={15} />
    </div>
    <div className="flex-1 font-medium leading-relaxed">{children}</div>
  </div>
);

/**
 * Modern AI Glassmorphism Card
 */
export const Card = ({ title, subtitle, action, children, className = '', pad = true }) => (
  <section className={`ai-glass-card rounded-2xl transition-all duration-200 ${className}`}>
    {(title || action) && (
      <header className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-white/10">
        <div className="min-w-0">
          {title && <h2 className="text-[15px] font-bold text-white font-display tracking-tight">{title}</h2>}
          {subtitle && <p className="text-[12px] text-slate-400 mt-0.5 font-normal">{subtitle}</p>}
        </div>
        {action}
      </header>
    )}
    <div className={pad ? 'p-6' : ''}>{children}</div>
  </section>
);

/**
 * High-impact KPI Stat Card
 */
export const Stat = ({ label, value, delta, deltaGoodWhenUp = true, hint, icon: Icon }) => {
  const up = delta > 0;
  const good = delta === 0 || delta == null ? null : up === deltaGoodWhenUp;

  return (
    <div className="ai-glass-card rounded-2xl p-5 min-w-0 relative overflow-hidden group">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 font-mono truncate">{label}</span>
        {Icon && (
          <div className="w-8 h-8 rounded-xl bg-slate-800/80 group-hover:bg-indigo-500/20 border border-white/10 group-hover:border-indigo-500/30 flex items-center justify-center text-slate-400 group-hover:text-cyan-400 transition-all shrink-0">
            <Icon size={16} />
          </div>
        )}
      </div>
      <div className="text-2xl lg:text-3xl font-extrabold text-white mt-2 font-display tracking-tight">{value}</div>
      <div className="text-[12px] mt-2 flex items-center gap-1.5 flex-wrap">
        {delta != null && delta !== 0 && (
          <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full font-bold text-[11px] ${
            good ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
          }`}>
            {up ? '▲ +' : '▼ -'}{Math.abs(delta)}%
          </span>
        )}
        {hint && <span className="text-slate-400 font-medium">{hint}</span>}
      </div>
    </div>
  );
};

const TONES = {
  gray: 'bg-slate-800/80 text-slate-300 border-white/10',
  blue: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  green: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  red: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  violet: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  orange: 'bg-orange-500/15 text-orange-300 border-orange-500/30'
};

export const Badge = ({ tone = 'gray', children, title }) => (
  <span title={title} className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap shadow-xs ${TONES[tone] || TONES.gray}`}>
    {children}
  </span>
);

const STATUS_META = {
  good: { icon: CheckCircle2, color: STATUS.good, tone: 'green' },
  warning: { icon: AlertTriangle, color: '#f59e0b', tone: 'amber' },
  serious: { icon: AlertCircle, color: '#f97316', tone: 'orange' },
  critical: { icon: AlertCircle, color: STATUS.critical, tone: 'red' },
  info: { icon: Info, color: INK.secondary, tone: 'gray' }
};

export const StatusPill = ({ level, children }) => {
  const m = STATUS_META[level] || STATUS_META.info;
  const Icon = m.icon;
  return <Badge tone={m.tone}><Icon size={12} className="shrink-0" /> {children}</Badge>;
};

export const scoreLevel = (s) => (s >= 80 ? 'good' : s >= 60 ? 'warning' : s >= 40 ? 'serious' : 'critical');
export const scoreWord = (s) => (s >= 80 ? 'Optimal' : s >= 60 ? 'Moderate' : s >= 40 ? 'Weak' : 'Critical');

export const ScoreRing = ({ score, size = 112, label = 'Score', level }) => {
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  const lvl = level || scoreLevel(score);

  return (
    <div className="relative shrink-0 flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e293b" strokeWidth="8" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={STATUS[lvl]}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${(score / 100) * c} ${c}`}
          style={{ transition: 'stroke-dasharray .8s cubic-bezier(0.4, 0, 0.2, 1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-2xl font-extrabold text-white leading-none font-display">{score}</span>
        <span className="text-[10px] uppercase font-bold text-slate-400 font-mono mt-1 tracking-wider">{label}</span>
      </div>
    </div>
  );
};

export const Meter = ({ value, max = 100, color = SERIES[0], height = 7 }) => (
  <div className="w-full bg-slate-800/80 rounded-full overflow-hidden border border-white/5" style={{ height }}>
    <div
      className="h-full rounded-full"
      style={{
        width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`,
        background: color,
        transition: 'width .6s cubic-bezier(0.4, 0, 0.2, 1)'
      }}
    />
  </div>
);

/**
 * Segmented dark pill tabs
 */
export const Tabs = ({ tabs, value, onChange }) => (
  <div className="flex gap-1.5 p-1 bg-slate-900/90 border border-white/10 rounded-xl mb-5 overflow-x-auto no-scrollbar w-fit max-w-full shadow-lg">
    {tabs.map(t => {
      const id = typeof t === 'string' ? t : t.id;
      const label = typeof t === 'string' ? t : t.label;
      const active = value === id;
      return (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`px-4 py-1.5 text-[13px] font-semibold whitespace-nowrap rounded-lg transition-all duration-150 cursor-pointer flex items-center gap-1.5 ${
            active
              ? 'bg-gradient-to-r from-indigo-600 to-cyan-600 text-white shadow-md font-bold'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <span>{label}</span>
          {typeof t !== 'string' && t.count != null && (
            <span className={`text-[11px] px-1.5 py-0.2 rounded-full font-bold ${
              active ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-400'
            }`}>
              {t.count}
            </span>
          )}
        </button>
      );
    })}
  </div>
);

export const Button = ({ variant = 'secondary', size = 'md', icon: Icon, busy, children, className = '', ...rest }) => {
  const v = {
    primary: 'bg-gradient-to-r from-indigo-600 via-indigo-500 to-cyan-500 hover:opacity-95 text-white shadow-lg shadow-indigo-500/25 border-transparent',
    secondary: 'bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 border-white/10 shadow-sm',
    ghost: 'bg-transparent text-slate-300 hover:bg-white/10 border-transparent',
    danger: 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 border-rose-500/30',
    ai: 'bg-gradient-to-r from-purple-600 via-indigo-600 to-pink-500 hover:opacity-95 text-white shadow-lg shadow-purple-500/30 border-transparent'
  }[variant];

  const s = size === 'sm' ? 'h-7.5 px-3 text-xs rounded-lg' : 'h-9 px-4 text-[13px] rounded-xl';

  return (
    <button
      {...rest}
      disabled={busy || rest.disabled}
      className={`inline-flex items-center justify-center gap-2 border font-bold whitespace-nowrap cursor-pointer active:scale-[0.98] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${v} ${s} ${className}`}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : Icon ? <Icon size={14} className="shrink-0" /> : null}
      {children}
    </button>
  );
};

export const Modal = ({ open, title, onClose, children, footer, width = 'max-w-lg' }) => {
  useEffect(() => {
    if (!open) return undefined;
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-black/75 backdrop-blur-md flex items-start justify-center p-4 overflow-y-auto animate-in fade-in duration-150" onMouseDown={onClose}>
      <div className={`bg-slate-900/95 backdrop-blur-2xl rounded-2xl shadow-2xl border border-white/15 w-full ${width} mt-12 overflow-hidden animate-in zoom-in-95 duration-150 text-slate-100 ring-1 ring-white/10`} onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-slate-950/60">
          <h3 className="text-[15px] font-bold text-white font-display">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="p-6">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-white/10 bg-slate-950/70 flex justify-end gap-2.5">{footer}</div>}
      </div>
    </div>
  );
};

export const Field = ({ label, hint, children, counter }) => (
  <label className="block">
    <span className="flex items-center justify-between text-[12px] font-semibold text-slate-300 mb-1.5">
      <span>{label}</span>
      {counter && <span className="text-slate-500 font-normal">{counter}</span>}
    </span>
    {children}
    {hint && <span className="block text-[11px] text-slate-400 mt-1">{hint}</span>}
  </label>
);

export const inputCls = 'ai-glass-input w-full h-9 px-3 text-[13px] rounded-xl placeholder-slate-500 text-white';
export const areaCls = 'ai-glass-input w-full px-3 py-2.5 text-[13px] rounded-xl placeholder-slate-500 text-white';

export const ChartTooltip = ({ active, payload, label, unit = '' }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900/95 backdrop-blur-xl border border-white/15 rounded-xl shadow-2xl px-3.5 py-2.5 text-[12px] text-slate-100">
      {label != null && <div className="text-slate-400 font-mono mb-1">{label}</div>}
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center gap-2 py-0.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: p.color || p.fill }} />
          <span className="text-slate-300 font-medium">{p.name}:</span>
          <span className="ml-auto pl-3 font-bold text-white tabular-nums">{p.value}{unit}</span>
        </div>
      ))}
    </div>
  );
};

export const Legend = ({ items }) => (
  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-slate-400 font-medium">
    {items.map(([name, color]) => (
      <span key={name} className="flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
        {name}
      </span>
    ))}
  </div>
);

export const Empty = ({ children }) => (
  <div className="py-16 text-center text-[13px] text-slate-400 font-medium flex flex-col items-center justify-center gap-2">
    <div className="w-12 h-12 rounded-2xl bg-slate-800/80 border border-white/10 flex items-center justify-center text-slate-400 mb-1">
      <Info size={20} />
    </div>
    {children}
  </div>
);

export const useToast = () => {
  const [msg, setMsg] = useState('');
  const t = useRef(null);
  const show = (m) => { setMsg(m); clearTimeout(t.current); t.current = setTimeout(() => setMsg(''), 2600); };
  const node = msg ? (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] bg-slate-900/95 backdrop-blur-xl text-white text-[13px] font-bold rounded-2xl shadow-2xl px-5 py-3 flex items-center gap-3 border border-indigo-500/40 animate-in fade-in slide-in-from-bottom-2 duration-150">
      <Sparkles size={16} className="text-cyan-400" />
      <span>{msg}</span>
    </div>
  ) : null;
  return [show, node];
};

/**
 * End-to-End Growth Engine Lifecycle Navigation
 */
export const GROWTH_LIFECYCLE_STEPS = [
  { id: 'onboarding', num: 1, title: 'Onboarding', subtitle: 'Foundation & Slugs', path: '/onboarding' },
  { id: 'audit', num: 2, title: 'Site Audit', subtitle: 'Tech & Schema Health', path: '/website-audit' },
  { id: 'cms', num: 3, title: 'CMS & Landing', subtitle: 'Target Slug Routing', path: '/website-builder' },
  { id: 'gbp', num: 4, title: 'Google Profile', subtitle: 'Local Authority & Posts', path: '/gmb-profile' },
  { id: 'radar', num: 5, title: 'Geo-Grid Radar', subtitle: 'Local Map Pack Ranks', path: '/rank-tracking' },
  { id: 'content', num: 6, title: 'Content & PR', subtitle: 'E-E-A-T & Citations', path: '/ai-content-generation' },
  { id: 'swarm', num: 7, title: 'AI Swarm', subtitle: 'Autopilot Execution', path: '/automation' },
  { id: 'leads', num: 8, title: 'Leads & ROI', subtitle: 'Conversion Attribution', path: '/leads' },
];

export const LifecycleGrowthBar = ({ currentStepId = 'onboarding' }) => {
  const navigate = useNavigate();
  const currentIndex = GROWTH_LIFECYCLE_STEPS.findIndex(s => s.id === currentStepId);
  const activeIndex = currentIndex >= 0 ? currentIndex : 0;
  const progressPercent = Math.round(((activeIndex + 1) / GROWTH_LIFECYCLE_STEPS.length) * 100);

  return (
    <div className="mb-6 p-4 rounded-2xl bg-[#090e1c]/90 border border-indigo-500/20 backdrop-blur-md shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3.5 pb-2.5 border-b border-white/5">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-cyan-400 text-xs font-bold">
            ⚡
          </div>
          <div>
            <span className="text-[13px] font-bold text-white tracking-wide font-display">GrowZen AI End-to-End Growth Engine</span>
            <span className="text-[11px] text-slate-400 ml-2 hidden sm:inline">Phase {activeIndex + 1} of 8: <strong className="text-cyan-300">{GROWTH_LIFECYCLE_STEPS[activeIndex].title}</strong></span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-[11px] font-mono text-slate-400">
            Lifecycle Progress: <span className="font-bold text-emerald-400">{progressPercent}%</span>
          </div>
          <div className="w-24 h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-cyan-400 to-indigo-500 rounded-full transition-all duration-300" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {GROWTH_LIFECYCLE_STEPS.map((step, idx) => {
          const isDone = idx < activeIndex;
          const isCurrent = idx === activeIndex;
          return (
            <button
              key={step.id}
              onClick={() => navigate(step.path)}
              className={`p-2 rounded-xl text-left transition-all border cursor-pointer relative group flex flex-col justify-between ${
                isCurrent
                  ? 'bg-gradient-to-br from-indigo-900/60 to-purple-900/40 border-cyan-400/60 shadow-lg shadow-indigo-500/10'
                  : isDone
                  ? 'bg-slate-900/50 border-emerald-500/20 hover:border-emerald-500/50 hover:bg-slate-800/60'
                  : 'bg-slate-950/40 border-white/5 hover:border-white/20 hover:bg-slate-900/40'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded ${
                  isCurrent ? 'bg-cyan-500/20 text-cyan-300' : isDone ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'
                }`}>
                  {isDone ? '✓' : `0${step.num}`}
                </span>
                {isCurrent && (
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                )}
              </div>
              <div className={`text-[11px] font-bold tracking-tight truncate ${isCurrent ? 'text-white' : isDone ? 'text-slate-200' : 'text-slate-400'}`}>
                {step.title}
              </div>
              <div className="text-[9px] text-slate-500 truncate mt-0.5">
                {step.subtitle}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export const LifecycleNextCard = ({ currentStepId = 'onboarding', customTitle, customDescription, customActionLabel, customActionPath }) => {
  const navigate = useNavigate();
  const currentIndex = GROWTH_LIFECYCLE_STEPS.findIndex(s => s.id === currentStepId);
  const nextStep = currentIndex >= 0 && currentIndex < GROWTH_LIFECYCLE_STEPS.length - 1
    ? GROWTH_LIFECYCLE_STEPS[currentIndex + 1]
    : GROWTH_LIFECYCLE_STEPS[0];

  const title = customTitle || `Proceed to Phase ${nextStep.num}: ${nextStep.title}`;
  const desc = customDescription || `All components of this phase are active. Advance to ${nextStep.title} (${nextStep.subtitle}) to continue the autonomous growth pipeline.`;
  const btnLabel = customActionLabel || `Continue to ${nextStep.title} ➔`;
  const destPath = customActionPath || nextStep.path;

  return (
    <div className="mt-8 p-6 rounded-2xl bg-gradient-to-r from-indigo-950/60 via-purple-950/40 to-slate-900/80 border border-indigo-500/30 backdrop-blur-xl shadow-2xl flex flex-col md:flex-row items-center justify-between gap-5">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center text-white font-bold text-xl shadow-lg shrink-0">
          ➔
        </div>
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-[10px] font-bold font-mono uppercase tracking-wider mb-1.5">
            Next Lifecycle Milestone
          </div>
          <h3 className="text-base font-bold text-white font-display tracking-tight">{title}</h3>
          <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">{desc}</p>
        </div>
      </div>
      <button
        onClick={() => navigate(destPath)}
        className="px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-cyan-500 hover:from-indigo-400 hover:to-cyan-400 text-white font-bold text-xs tracking-wide shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/40 transition-all duration-200 cursor-pointer shrink-0"
      >
        {btnLabel}
      </button>
    </div>
  );
};

