import React from 'react';
import Tip from './Tip';

/**
 * A column heading that explains itself: what the column is, what it is for, and where its figures come from.
 * Hover (or focus) the heading to read it. The dotted underline tells people it can be hovered.
 */
export function Head({ children, what, why, from, right = false }) {
  const text = [what, why && `Use: ${why}`, from && `Comes from: ${from}`].filter(Boolean).join(' ');
  if (!text) return <>{children}</>;
  return (
    <Tip text={text} wide align={right ? 'right' : 'left'}>
      <span tabIndex={0} className="cursor-help border-b border-dotted border-slate-400/70 outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50 rounded-sm">{children}</span>
    </Tip>
  );
}

/** A small labelled action in a table row, with a sentence that says what pressing it does. */
export function Act({ tip, children, danger = false, primary = false, className = '', ...rest }) {
  const tone = danger ? 'text-rose-700 ring-rose-200 hover:bg-rose-50' : primary ? 'bg-indigo-600 text-white ring-indigo-600 hover:bg-indigo-700' : 'text-slate-700 ring-slate-300 hover:bg-slate-50';
  return (
    <Tip text={tip} align="right">
      <button type="button" {...rest} className={`h-7 px-2.5 rounded-md text-12 font-semibold cursor-pointer inline-flex items-center gap-1 ring-1 ring-inset transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${tone} ${className}`}>{children}</button>
    </Tip>
  );
}
