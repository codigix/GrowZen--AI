/**
 * Helpers for the screens that still show generated demo numbers (Content Studio), and the plan list.
 * Everything else comes from the SEO backend.
 */

// Small seeded random generator so demo numbers are stable.
const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
export const rng = (seed) => {
  let a = hash(seed) || 1;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const daysBack = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
export const shortDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

export const PLANS = [
  { name: 'Starter', who: 'Single shop, clinic, salon', price: '₹999 – 1,999', includes: ['GBP manager', 'Review replies', '4 posts / month', 'Monthly report'] },
  { name: 'Growth', who: 'Business with a website', price: '₹2,999 – 4,999', includes: ['Everything in Starter', 'Local rank grid', '4 AI blogs / month', 'Site audit', 'WhatsApp bot'], popular: true },
  { name: 'Pro', who: 'Competitive local markets', price: '₹7,999 – 14,999', includes: ['Everything in Growth', 'Backlinks & citations', 'GEO / AEO tracker', 'AI autopilot'] },
  { name: 'Agency', who: 'Agencies and freelancers', price: 'Per location', includes: ['White-label reports', 'Client logins', 'Bulk tools', 'Volume discounts'] }
];
