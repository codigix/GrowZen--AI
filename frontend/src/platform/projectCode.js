// Two-step verification on a project switch: the logic. The window it shows is ProjectCodeModal.jsx.
//   verifyProjectSwitch(id) → Promise<boolean>: asks for the authenticator code (setting the app up first if needed) and resolves true once the server
//   accepted it for that project. One window per project at a time, however many requests are waiting on it.
import { api, setProjectCodeHandler } from './seoApi';

const queue = [];
const pending = new Map();
const listeners = new Set();
const emit = () => listeners.forEach(fn => fn());
export const subscribeProjectCode = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const currentCodeRequest = () => queue[0] || null;

let statusPromise = null;
/** { enabled, can }: whether this account has an authenticator app, and whether it can (CRM sign-ins cannot). */
export const twoFactorStatus = (fresh = false) => {
  if (!statusPromise || fresh) {
    statusPromise = api('/me').then(me => ({ enabled: Boolean(me.totp_enabled), can: me.can_enrol_2fa !== false })).catch(() => { statusPromise = null; return { enabled: false, can: false }; });
  }
  return statusPromise;
};
export const markTwoFactor = (enabled) => { statusPromise = Promise.resolve({ enabled, can: true }); };

/** Sign-out / another account: forget the status and close any open window. */
export const resetProjectCode = () => {
  statusPromise = null;
  queue.splice(0).forEach(r => r.done(false));
  pending.clear();
  emit();
};

export function verifyProjectSwitch(businessId) {
  const id = Number(businessId);
  if (pending.has(id)) return pending.get(id);
  const p = twoFactorStatus().then(st => {
    if (!st.can) return true; // a CRM sign-in has no authenticator: the CRM decides who may open the platform
    return new Promise(resolve => {
      const req = { businessId: id, resolve: (ok) => req.done(ok), done: (ok) => { const i = queue.indexOf(req); if (i >= 0) queue.splice(i, 1); pending.delete(id); emit(); resolve(ok); } };
      queue.push(req);
      emit();
    });
  });
  pending.set(id, p);
  return p;
}

/** Does moving to another project need a code? Accounts with an authenticator app, and accounts with several projects to switch between. */
export const needsSwitchCode = async (projectCount) => {
  const st = await twoFactorStatus();
  return st.can && (st.enabled || projectCount > 1);
};

setProjectCodeHandler((businessId) => verifyProjectSwitch(businessId));
