import React, { useState } from 'react';
import { createPortal } from 'react-dom';

/** A hover / keyboard-focus bubble for a short explanation. Drawn on the page body, so a scrolling table or a card never clips it. */
export default function Tip({ text, children, wide = false, align = 'left', className = '' }) {
  const [pos, setPos] = useState(null);
  if (!text) return children;
  const show = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const w = wide ? 320 : 240;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, align === 'right' ? r.right - w : align === 'center' ? r.left + r.width / 2 - w / 2 : r.left));
    const below = r.bottom + 8 + 120 < window.innerHeight;
    setPos({ left, width: w, ...(below ? { top: r.bottom + 6 } : { bottom: window.innerHeight - r.top + 6 }) });
  };
  return (
    <span className={`inline-flex max-w-full ${className}`} onMouseEnter={show} onMouseLeave={() => setPos(null)} onFocus={show} onBlur={() => setPos(null)}>
      {children}
      {pos && createPortal(<span role="tooltip" style={{ position: 'fixed', zIndex: 80, ...pos }} className="pointer-events-none rounded-lg bg-slate-900 text-white text-12 leading-snug font-normal normal-case tracking-normal text-left px-3 py-2 shadow-xl">{text}</span>, document.body)}
    </span>
  );
}
