import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

/** A button that opens a panel under it and closes on a click outside or Escape. It keeps the page short: what is not needed all the time sits in here, still one click away. */
export default function MorePanel({ label, children, width = 'min(780px, 92vw)', align = 'right', icon: Icon }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button type="button" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(o => !o)}
        className={`h-9 px-3 inline-flex items-center gap-1.5 rounded-lg border text-13 font-medium cursor-pointer ${open ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>
        {Icon && <Icon size={14} />}{label}<ChevronDown size={13} className={open ? 'rotate-180' : ''} />
      </button>
      {open && <div role="dialog" aria-label={label} style={{ width }} className={`absolute z-40 mt-2 ${align === 'right' ? 'right-0' : 'left-0'} max-h-[72vh] overflow-auto rounded-xl bg-white shadow-xl ring-1 ring-slate-200 p-4`}>{children}</div>}
    </div>
  );
}
