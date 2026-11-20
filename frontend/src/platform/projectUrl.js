// The project in a page address as a short code instead of the plain number: /projects/p1c9k3x instead of /projects/41.
// This only keeps the number out of sight: who may open a project is still decided by the server on every request.

const OFFSET = 104729;
const STEP = 7919;
const sum = (s) => [...s].reduce((a, ch, i) => a + ch.charCodeAt(0) * (i + 3), 0).toString(36).slice(-1);

export function encodeProjectId(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 0) return '';
  const body = (n * STEP + OFFSET).toString(36);
  return `p${body}${sum(body)}`;
}

/** The project number from a code; null when the code is not one of ours (a typo, or an old plain-number link is accepted too). */
export function decodeProjectId(code) {
  const c = String(code || '').trim().toLowerCase();
  if (/^\d+$/.test(c)) return Number(c);
  const m = /^p([0-9a-z]+)([0-9a-z])$/.exec(c);
  if (!m || sum(m[1]) !== m[2]) return null;
  const n = parseInt(m[1], 36) - OFFSET;
  return n >= 0 && n % STEP === 0 ? n / STEP : null;
}
