/**
 * Makes every "Copy" button work on a plain-http address.
 *
 * Browsers only provide navigator.clipboard on https:// or localhost. The app is often opened by its network address
 * (http://192.168.1.22:3100), where navigator.clipboard is undefined and every copy button silently did nothing.
 * This installs a stand-in that copies through a temporary text field (document.execCommand('copy')), which works there.
 * On https or localhost the real clipboard API is left untouched.
 */
function writeText(text) {
  return new Promise((resolve, reject) => {
    const before = document.activeElement;
    const ta = document.createElement('textarea');
    ta.value = String(text ?? '');
    ta.setAttribute('readonly', '');
    ta.setAttribute('aria-hidden', 'true');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
    // Inside an open drawer or dialog the field must live in it, or the dialog's focus handling would take the selection back.
    const host = (before && before.closest && before.closest('[role="dialog"], dialog')) || document.body;
    try {
      host.appendChild(ta);
      ta.focus({ preventScroll: true });
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand('copy');
      if (ok) resolve(); else reject(new Error('The browser blocked copying. Select the text and press Ctrl+C.'));
    } catch (e) {
      reject(e);
    } finally {
      ta.remove();
      try { if (before && before.focus) before.focus({ preventScroll: true }); } catch { /* the element may be gone */ }
    }
  });
}

export function installClipboardFallback() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
  if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) return; // https or localhost: the real one works
  const stand = { writeText, readText: () => Promise.reject(new Error('Reading the clipboard needs an https address.')) };
  try {
    Object.defineProperty(navigator, 'clipboard', { value: stand, configurable: true });
  } catch {
    try { navigator.clipboard = stand; } catch { /* a locked-down browser: the buttons keep their own fallbacks */ }
  }
}
