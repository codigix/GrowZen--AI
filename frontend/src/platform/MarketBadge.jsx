import React from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Globe, Flag } from 'lucide-react';
import { countryInfo } from './countries';

/**
 * A project's market decides how it is searched and what its pages show (see services/market.py):
 * local = a city (Maps grid), national = a whole country, international = other countries.
 * Light on purpose: SeoUi shows the badge on every page, so this file imports nothing from it.
 */

export const marketOf = (b) => {
  const scope = ['local', 'national', 'international'].includes(b?.target_scope) ? b.target_scope : 'local';
  const home = countryInfo(b?.country).name;
  if (scope === 'local') return { scope, label: [(b?.area || '').split(',')[0].trim(), (b?.city || '').trim()].filter(Boolean).join(', ') || 'Local', short: 'Local', grid: true };
  if (scope === 'national') return { scope, label: home, short: 'National', grid: false };
  const names = (b?.target_countries || []).map(c => countryInfo(c).name);
  return { scope, label: names.length ? `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}` : 'no countries picked yet', short: 'International', grid: false };
};

const STYLE = { local: ['bg-sky-50 text-sky-700 ring-sky-200', MapPin], national: ['bg-emerald-50 text-emerald-700 ring-emerald-200', Flag], international: ['bg-violet-50 text-violet-700 ring-violet-200', Globe] };

/** "Local · Aundh, Pune" / "National · India" / "International · United States, Germany", linking to where it is changed. */
export function MarketBadge({ business, to = '/gmb-profile?tab=profile&sub=edit' }) {
  if (!business) return null;
  const m = marketOf(business);
  const [cls, Icon] = STYLE[m.scope];
  return (
    <Link to={to} title="This project's market decides how it is searched and tracked. Click to change it." className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-full ring-1 ring-inset text-11.5 font-semibold whitespace-nowrap ${cls}`}>
      <Icon size={11} />{m.short}<span className="font-normal opacity-80 max-w-[220px] truncate">· {m.label}</span>
    </Link>
  );
}
