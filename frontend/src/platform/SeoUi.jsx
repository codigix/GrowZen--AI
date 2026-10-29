import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  ChevronDown, Check, X, Loader2, AlertTriangle, AlertCircle, CheckCircle2, Info, MapPin,
  Plug, ServerCrash, Plus, Mail, Store, RefreshCw, Sparkles, Building2, ExternalLink, Cpu,
  Bell, Calendar
} from 'lucide-react';
import { api, toUi, SEO_API } from './seoApi';

// Categorical palette, tuned for white surfaces
export const SERIES = ['#4f46e5', '#0284c7', '#059669', '#d97706', '#db2777', '#7c3aed', '#2563eb', '#dc2626'];
export const STATUS = { good: '#10b981', warning: '#f59e0b', serious: '#f97316', critical: '#ef4444' };
export const INK = { primary: '#0f172a', secondary: '#475569', muted: '#64748b', grid: '#e2e8f0', axis: '#cbd5e1', up: '#059669' };

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
        className="flex items-center gap-2.5 h-10 px-3 bg-white hover:bg-slate-100 border border-slate-200 rounded transition-all cursor-pointer text-left group"
      >
        <span className="w-7 h-7 rounded-full bg-blue-600 text-white text-12 font-bold flex items-center justify-center shrink-0 shadow-sm">
          {business.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 pr-1">
          <div className="text-12 font-bold text-slate-900 truncate max-w-[150px] leading-tight group-hover:text-blue-700 transition-colors">
            {business.name}
          </div>
          <div className="text-10 text-slate-500 truncate leading-tight mt-0.5">
            {[business.city, business.area].filter(Boolean).join(', ') || 'PCMC, Pune'} ▾
          </div>
        </div>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[21rem] bg-white backdrop-blur-2xl border border-slate-300 rounded shadow-2xl z-50 py-2 overflow-hidden animate-in fade-in zoom-in-95 duration-150 text-slate-900 ring-1 ring-slate-900/5">
          <div className="px-4 py-2 border-b border-slate-200 flex items-center justify-between">
            <span className="text-11 font-bold uppercase tracking-wider text-slate-500 font-mono">Managed Entities</span>
            <span className="text-11 bg-slate-100 text-cyan-700 border border-cyan-500/30 font-bold px-2 py-0.5 rounded-full">
              {list.length} clients
            </span>
          </div>

          <div className="max-h-[60vh] overflow-y-auto no-scrollbar py-1">
            {list.map(b => (
              <button
                key={b.id}
                onClick={() => { onChange(b.id); setOpen(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors cursor-pointer ${b.id === business.id ? 'bg-indigo-600/20 text-slate-900 font-medium border-l-2 border-indigo-400' : 'hover:bg-slate-50 text-slate-700'
                  }`}
              >
                <span className={`w-8 h-8 rounded text-12 font-bold flex items-center justify-center shrink-0 ${b.id === business.id ? 'bg-gradient-to-tr from-indigo-600 to-cyan-500 text-white shadow-md' : 'bg-slate-100 text-slate-700 border border-slate-200'
                  }`}>
                  {b.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-13 font-semibold truncate text-slate-900">{b.name}</span>
                  <span className="block text-11 text-slate-500 truncate flex items-center gap-1 mt-0.5">
                    <MapPin size={11} className="text-slate-500" /> {[b.area, b.city].filter(Boolean).join(', ') || 'Online / Remote'}
                  </span>
                </span>
                {b.id === business.id && (
                  <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-600 border border-indigo-500/30 flex items-center justify-center shrink-0">
                    <Check size={12} strokeWidth={2.5} />
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="p-2.5 border-t border-slate-200 bg-slate-50">
            <button
              onClick={() => { setOpen(false); navigate(`${path('gmb-profile')}?connect=1`); }}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded bg-gradient-to-r from-indigo-600 to-cyan-600 hover:opacity-95 text-white text-12 font-bold shadow-md transition-all cursor-pointer"
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
  <div className="bg-white backdrop-blur-xl rounded border border-rose-500/30 p-8 max-w-2xl shadow-2xl shadow-rose-200/50 text-slate-900">
    <div className="flex items-center gap-3.5 text-rose-600 font-bold text-lg font-display">
      <div className="w-11 h-11 rounded bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-600">
        <ServerCrash size={24} />
      </div>
      <div>
        <div>{error?.status === 401 ? 'Authentication Required' : error?.status === 403 ? 'Access Forbidden' : 'Backend Engine Offline'}</div>
        <p className="text-13 text-slate-500 font-normal mt-0.5">{error?.message || 'FastAPI service on port 8000 is not responding'}</p>
      </div>
    </div>
    {!error?.status && (
      <div className="mt-6">
        <span className="text-12 font-bold text-slate-500 uppercase tracking-wider font-mono">Terminal start command:</span>
        <pre className="mt-2 text-12 bg-slate-50 text-slate-800 rounded p-4 font-mono overflow-x-auto border border-slate-200 shadow-inner">
          {'cd backend\n.\\.venv\\Scripts\\activate\nuvicorn app.main:app --port 8000'}
        </pre>
      </div>
    )}
    <div className="mt-6 flex items-center justify-between pt-4 border-t border-slate-200">
      <span className="text-12 text-slate-500 font-mono">Endpoint: {SEO_API}</span>
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
    <div className="bg-white backdrop-blur-xl rounded-3xl border border-slate-300 p-8 max-w-3xl shadow-2xl text-slate-900">
      <div className="flex items-center gap-3.5">
        <div className="w-12 h-12 rounded bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-600 shadow-sm">
          <Building2 size={24} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900 font-display">No Managed Businesses Found</h2>
          <p className="text-13 text-slate-500 mt-0.5">Initialize the first client to activate the autonomous SEO pipeline.</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          onClick={() => navigate(`${path('gmb-profile')}?connect=1`)}
          className="text-left p-5 rounded border border-slate-200 hover:border-indigo-400 hover:bg-slate-50 transition-all cursor-pointer group bg-slate-50"
        >
          <div className="w-9 h-9 rounded bg-blue-500/10 border border-blue-500/20 text-blue-600 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
            <Store size={18} />
          </div>
          <div className="text-14 font-bold text-slate-900 group-hover:text-cyan-700 transition-colors">Connect Google Account</div>
          <div className="text-12 text-slate-500 mt-1">Import Business Profiles, locations, and live reviews directly.</div>
        </button>
        <button
          onClick={() => navigate(path('automation-pipeline'))}
          className="text-left p-5 rounded border border-slate-200 hover:border-indigo-400 hover:bg-slate-50 transition-all cursor-pointer group bg-slate-50"
        >
          <div className="w-9 h-9 rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
            <Mail size={18} />
          </div>
          <div className="text-14 font-bold text-slate-900 group-hover:text-cyan-700 transition-colors">Onboarding Email Pipeline</div>
          <div className="text-12 text-slate-500 mt-1">Paste onboarding briefing; autonomous AI parses attributes and starts audit.</div>
        </button>
      </div>

      <div className="mt-8 pt-6 border-t border-slate-200">
        <h3 className="text-14 font-bold text-slate-900">Or Register Client Manually</h3>
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
    <div className="py-28 flex flex-col items-center justify-center gap-3.5 text-slate-500">
      <div className="w-12 h-12 rounded bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-600 shadow-sm animate-pulse">
        <Loader2 size={24} className="animate-spin text-cyan-700" />
      </div>
      <span className="text-14 font-semibold text-slate-700">Synchronizing neural pipelines…</span>
    </div>
  );
  else if (needsBusiness && !business) body = <NoBusinesses onCreated={setBusiness} />;
  else body = typeof children === 'function' ? children(business) : children;

  return (
    <div className="min-h-screen text-slate-900 bg-slate-50">
      {/* Top Header Banner matching reference image */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-[1520px] mx-auto px-6 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-17 font-bold text-slate-900 tracking-tight font-display">{title}</h1>
            {subtitle && <p className="text-11 text-slate-500 mt-0.5 font-normal">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2.5 flex-wrap">
            {/* Calendar Last 30 Days Dropdown */}
            <div className="h-9 px-3 rounded bg-white border border-slate-200 flex items-center gap-2 text-12 font-medium text-slate-700 hover:text-slate-900 cursor-pointer transition-colors shadow-sm">
              <Calendar size={13} className="text-slate-500" />
              <span>Last 30 Days</span>
              <ChevronDown size={13} className="text-slate-500" />
            </div>

            {/* Notification Bell with Badge 3 */}
            <div className="relative w-9 h-9 rounded bg-white border border-slate-200 flex items-center justify-center text-slate-700 hover:text-slate-900 cursor-pointer transition-colors">
              <Bell size={15} />
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-600 text-white font-bold text-9 flex items-center justify-center shadow-sm">
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
    <div className="mt-2 text-12 font-semibold text-rose-700 bg-rose-500/10 border border-rose-500/20 rounded px-3.5 py-2 flex items-center gap-2">
      <AlertCircle size={15} className="shrink-0 text-rose-600" />
      <span>{children}</span>
    </div>
  ) : null
);

export const SourceTag = ({ source }) => (
  source === 'sample' ? (
    <span title="Sample simulated data" className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 border border-amber-500/25 text-11 font-semibold font-mono">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> sample
    </span>
  ) : source === 'live' ? (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 border border-emerald-500/25 text-11 font-semibold font-mono">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> live sync
    </span>
  ) : null
);

export const PreviewNote = ({ children }) => (
  <div className="mb-5 p-4 rounded border border-indigo-500/25 bg-gradient-to-r from-indigo-50 via-purple-50 to-white text-13 text-indigo-800 flex items-start gap-3 shadow-lg">
    <div className="w-7 h-7 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-cyan-700 shrink-0 mt-0.5">
      <Sparkles size={15} />
    </div>
    <div className="flex-1 font-medium leading-relaxed">{children}</div>
  </div>
);

/**
 * Modern AI Glassmorphism Card
 */
export const Card = ({ title, subtitle, action, children, className = '', pad = true }) => (
  <section className={`ai-glass-card rounded transition-all duration-200 ${className}`}>
    {(title || action) && (
      <header className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-slate-200">
        <div className="min-w-0">
          {title && <h2 className="text-15 font-bold text-slate-900 font-display tracking-tight">{title}</h2>}
          {subtitle && <p className="text-12 text-slate-500 mt-0.5 font-normal">{subtitle}</p>}
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
    <div className="ai-glass-card rounded p-5 min-w-0 relative overflow-hidden group">
      <div className="flex items-center justify-between gap-2">
        <span className="text-11 font-bold uppercase tracking-wider text-slate-500 font-mono truncate">{label}</span>
        {Icon && (
          <div className="w-8 h-8 rounded bg-slate-100 group-hover:bg-indigo-500/20 border border-slate-200 group-hover:border-indigo-500/30 flex items-center justify-center text-slate-500 group-hover:text-cyan-700 transition-all shrink-0">
            <Icon size={16} />
          </div>
        )}
      </div>
      <div className="text-2xl lg:text-3xl font-extrabold text-slate-900 mt-2 font-display tracking-tight">{value}</div>
      <div className="text-12 mt-2 flex items-center gap-1.5 flex-wrap">
        {delta != null && delta !== 0 && (
          <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full font-bold text-11 ${good ? 'bg-emerald-500/15 text-emerald-700 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-600 border border-rose-500/30'
            }`}>
            {up ? '▲ +' : '▼ -'}{Math.abs(delta)}%
          </span>
        )}
        {hint && <span className="text-slate-500 font-medium">{hint}</span>}
      </div>
    </div>
  );
};

const TONES = {
  gray: 'bg-slate-100 text-slate-700 border-slate-200',
  blue: 'bg-indigo-500/15 text-indigo-700 border-indigo-500/30',
  green: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  amber: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
  red: 'bg-rose-500/15 text-rose-700 border-rose-500/30',
  violet: 'bg-purple-500/15 text-purple-700 border-purple-500/30',
  orange: 'bg-orange-500/15 text-orange-700 border-orange-500/30'
};

export const Badge = ({ tone = 'gray', children, title }) => (
  <span title={title} className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-11 font-semibold whitespace-nowrap shadow-sm ${TONES[tone] || TONES.gray}`}>
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
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth="8" />
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
        <span className="text-2xl font-extrabold text-slate-900 leading-none font-display">{score}</span>
        <span className="text-10 uppercase font-bold text-slate-500 font-mono mt-1 tracking-wider">{label}</span>
      </div>
    </div>
  );
};

export const Meter = ({ value, max = 100, color = SERIES[0], height = 7 }) => (
  <div className="w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200" style={{ height }}>
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
  <div className="flex gap-1.5 p-1 bg-white border border-slate-200 rounded mb-5 overflow-x-auto no-scrollbar w-fit max-w-full shadow-lg">
    {tabs.map(t => {
      const id = typeof t === 'string' ? t : t.id;
      const label = typeof t === 'string' ? t : t.label;
      const active = value === id;
      return (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`px-4 py-1.5 text-13 font-semibold whitespace-nowrap rounded-lg transition-all duration-150 cursor-pointer flex items-center gap-1.5 ${active
            ? 'bg-gradient-to-r from-indigo-600 to-cyan-600 text-white shadow-md font-bold'
            : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
            }`}
        >
          <span>{label}</span>
          {typeof t !== 'string' && t.count != null && (
            <span className={`text-11 px-1.5 py-0.2 rounded-full font-bold ${active ? 'bg-slate-200 text-slate-900' : 'bg-slate-100 text-slate-500'
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
    secondary: 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-200 shadow-sm',
    ghost: 'bg-transparent text-slate-700 hover:bg-slate-100 border-transparent',
    danger: 'bg-rose-500/20 text-rose-700 hover:bg-rose-500/30 border-rose-500/30',
    ai: 'bg-gradient-to-r from-purple-600 via-indigo-600 to-pink-500 hover:opacity-95 text-white shadow-lg shadow-purple-500/30 border-transparent'
  }[variant];

  const s = size === 'sm' ? 'h-[30px] px-3 text-xs rounded-lg' : 'h-9 px-4 text-13 rounded';

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
    <div className="fixed inset-0 z-[70] bg-slate-900/40 backdrop-blur-md flex items-start justify-center p-4 overflow-y-auto animate-in fade-in duration-150" onMouseDown={onClose}>
      <div className={`bg-white backdrop-blur-2xl rounded shadow-2xl border border-slate-300 w-full ${width} mt-12 overflow-hidden animate-in zoom-in-95 duration-150 text-slate-900 ring-1 ring-slate-200`} onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <h3 className="text-15 font-bold text-slate-900 font-display">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-colors cursor-pointer" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="p-6">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-2.5">{footer}</div>}
      </div>
    </div>
  );
};

/** A panel that slides in from the right over the page: secondary detail without leaving the screen. */
export const Drawer = ({ open, title, subtitle, onClose, children, width = 'max-w-2xl' }) => {
  useEffect(() => {
    if (!open) return undefined;
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = overflow; };
  }, [open, onClose]);

  if (!open) return null;

  // On <body>, so an animated (transformed) page container can't clip or offset the fixed overlay.
  return createPortal(
    <div className="fixed inset-0 z-[70] bg-slate-900/30 backdrop-blur-sm animate-in fade-in duration-150" onMouseDown={onClose}>
      <aside role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}
        className={`absolute right-0 top-0 h-full w-full ${width} bg-slate-50 shadow-2xl border-l border-slate-200 flex flex-col animate-in slide-in-from-right duration-200`} onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-slate-200 bg-white">
          <div className="min-w-0">
            <h3 className="text-15 font-bold text-slate-900 font-display">{title}</h3>
            {subtitle && <p className="text-12 text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-colors cursor-pointer" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>,
    document.body
  );
};

export const Field = ({ label, hint, children, counter }) => (
  <label className="block">
    <span className="flex items-center justify-between text-12 font-semibold text-slate-700 mb-1.5">
      <span>{label}</span>
      {counter && <span className="text-slate-500 font-normal">{counter}</span>}
    </span>
    {children}
    {hint && <span className="block text-11 text-slate-500 mt-1">{hint}</span>}
  </label>
);

export const inputCls = 'ai-glass-input w-full h-9 px-3 text-13 rounded placeholder-slate-400 text-slate-900';
export const areaCls = 'ai-glass-input w-full px-3 py-2.5 text-13 rounded placeholder-slate-400 text-slate-900';

export const ChartTooltip = ({ active, payload, label, unit = '' }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white backdrop-blur-xl border border-slate-300 rounded shadow-2xl px-3.5 py-2.5 text-12 text-slate-900">
      {label != null && <div className="text-slate-500 font-mono mb-1">{label}</div>}
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center gap-2 py-0.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: p.color || p.fill }} />
          <span className="text-slate-700 font-medium">{p.name}:</span>
          <span className="ml-auto pl-3 font-bold text-slate-900 tabular-nums">{p.value}{unit}</span>
        </div>
      ))}
    </div>
  );
};

export const Legend = ({ items }) => (
  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-12 text-slate-500 font-medium">
    {items.map(([name, color]) => (
      <span key={name} className="flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
        {name}
      </span>
    ))}
  </div>
);

export const Empty = ({ children }) => (
  <div className="py-16 text-center text-13 text-slate-500 font-medium flex flex-col items-center justify-center gap-2">
    <div className="w-12 h-12 rounded bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 mb-1">
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
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] bg-white backdrop-blur-xl text-slate-900 text-13 font-bold rounded shadow-2xl px-5 py-3 flex items-center gap-3 border border-indigo-500/40 animate-in fade-in slide-in-from-bottom-2 duration-150">
      <Sparkles size={16} className="text-cyan-700" />
      <span>{msg}</span>
    </div>
  ) : null;
  return [show, node];
};
