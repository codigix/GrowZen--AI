import { useEffect, useState } from 'react';
import { api } from './seoApi';

/**
 * Countries a business can be in (GET /discover/countries, from the server's services/countries.py): dial
 * code, normal phone lengths, postcode format and the listing sites that matter there. Loaded once and kept
 * here so checks anywhere in the app can ask `countryInfo(code)`. India is built in, so nothing breaks before
 * the list arrives.
 */

const INDIA = { code: 'IN', name: 'India', dial: '91', digits: [10], postcode: '\\b[1-9]\\d{5}\\b', postcode_name: 'PIN code', sites: ['Justdial', 'Sulekha', 'IndiaMART', 'Facebook', 'Instagram', 'LinkedIn'] };
let list = [INDIA];
let loading = null;
const listeners = new Set();

export const LAST_COUNTRY_KEY = 'gzOnboardingCountry';

/** Convert a 2-letter ISO country code to its flag emoji. */
export function countryFlag(code) {
  const c = String(code || '').toUpperCase();
  if (c.length !== 2) return '🌐';
  const offset = 127397;
  try {
    return String.fromCodePoint(...[...c].map(ch => ch.charCodeAt(0) + offset));
  } catch (e) {
    return '🌐';
  }
}

function load() {
  if (!loading) {
    loading = api('/discover/countries').then(rows => {
      if (Array.isArray(rows) && rows.length) { list = rows; listeners.forEach(fn => fn(list)); }
    }).catch(() => { loading = null; });
  }
  return loading;
}

/** The list of countries (re-renders when it has loaded). */
export function useCountries() {
  const [rows, setRows] = useState(list);
  useEffect(() => { listeners.add(setRows); load(); return () => listeners.delete(setRows); }, []);
  return rows;
}

/** Details for a country code; an unlisted code gets lenient defaults (any 7-12 digit phone, no postcode). */
export function countryInfo(code) {
  const c = String(code || 'IN').toUpperCase();
  const found = list.find(x => x.code === c);
  const info = found || (c === 'IN' ? INDIA : { code: c, name: c, dial: '', digits: [], postcode: null, postcode_name: 'postcode', sites: ['Facebook', 'Instagram', 'LinkedIn', 'Bing Places', 'Apple Maps', 'Yelp'] });
  return { ...info, flag: countryFlag(c) };
}

/** A phone's national number: digits without the dial code (after a "+" or "00") or a leading trunk 0. */
export function nationalNumber(phone, code) {
  const raw = String(phone || '').trim();
  const info = countryInfo(code);
  let d = raw.replace(/\D/g, '');
  if (raw.startsWith('00')) d = d.slice(2);
  if (info.dial && d.startsWith(info.dial) && (raw.startsWith('+') || raw.startsWith('00') || !info.digits.length || info.digits.includes(d.length - info.dial.length))) d = d.slice(info.dial.length);
  if (d.startsWith('0') && info.digits.includes(d.length - 1)) d = d.slice(1);
  return d;
}

/** Whether a phone looks complete for the country. */
export function phoneOk(phone, code) {
  const n = nationalNumber(phone, code);
  const { digits } = countryInfo(code);
  return digits.length ? digits.includes(n.length) : n.length >= 7 && n.length <= 12;
}

/** Whether the address has the country's postcode (true where postcodes aren't used). */
export function hasPostcode(address, code) {
  const { postcode } = countryInfo(code);
  if (!postcode) return true;
  try { return new RegExp(postcode, 'i').test(address || ''); } catch (e) { return true; }
}
