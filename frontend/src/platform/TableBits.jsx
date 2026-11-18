import React from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Loader2, PenLine, Search } from 'lucide-react';
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

// One colour for one meaning, the same on every table: green saves, amber sets aside, blue checks, violet writes, red removes, teal and indigo open and compare.
const TONES = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200 hover:bg-amber-100',
  sky: 'bg-sky-50 text-sky-700 ring-sky-200 hover:bg-sky-100',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200 hover:bg-violet-100',
  rose: 'bg-rose-50 text-rose-700 ring-rose-200 hover:bg-rose-100',
  teal: 'bg-teal-50 text-teal-700 ring-teal-200 hover:bg-teal-100',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200 hover:bg-indigo-100',
  slate: 'bg-slate-50 text-slate-600 ring-slate-200 hover:bg-slate-100',
};

/**
 * An action in a table row: an icon in its own colour, with a sentence on hover that says what pressing it does.
 * Without an icon it falls back to a small text button.
 */
export function Act({ tip, icon: Icon, tone = 'slate', busy = false, children, danger = false, primary = false, className = '', ...rest }) {
  if (Icon) {
    return (
      <Tip text={tip} align="right">
        <button type="button" aria-label={tip} {...rest} disabled={rest.disabled || busy} className={`h-8 w-8 rounded-lg inline-flex items-center justify-center ring-1 ring-inset cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${TONES[tone] || TONES.slate} ${className}`}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Icon size={15} strokeWidth={2.2} />}
        </button>
      </Tip>
    );
  }
  const t = danger ? 'text-rose-700 ring-rose-200 hover:bg-rose-50' : primary ? 'bg-indigo-600 text-white ring-indigo-600 hover:bg-indigo-700' : 'text-slate-700 ring-slate-300 hover:bg-slate-50';
  return (
    <Tip text={tip} align="right">
      <button type="button" {...rest} className={`h-7 px-2.5 rounded-md text-12 font-semibold cursor-pointer inline-flex items-center gap-1 ring-1 ring-inset transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${t} ${className}`}>{children}</button>
    </Tip>
  );
}

/** The actions every keyword row has: check its numbers, open the page that ranks for it, write about it. */
export function KeywordActs({ keyword, url }) {
  const q = encodeURIComponent(keyword || '');
  return (
    <span className="inline-flex gap-1.5">
      {keyword && <Link to={`/keyword-overview?q=${q}`}><Act icon={Search} tone="sky" tip="Check: open its searches per month, cost and related ideas." /></Link>}
      {url && <a href={url} target="_blank" rel="noreferrer noopener"><Act icon={ExternalLink} tone="slate" tip="Open: show the page that ranks for it, in a new tab." /></a>}
      {keyword && <Link to={`/ai-content-generation/blog?keyword=${q}`}><Act icon={PenLine} tone="violet" tip="Write: start a blog post for this keyword in the blog writer." /></Link>}
    </span>
  );
}

/** Open a web address in a new tab, as an icon with a sentence. */
export function OpenAct({ url, tip = 'Open: show it in a new tab.' }) {
  if (!url) return null;
  return <a href={url} target="_blank" rel="noreferrer noopener"><Act icon={ExternalLink} tone="slate" tip={tip} /></a>;
}
