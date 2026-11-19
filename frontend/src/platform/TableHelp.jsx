import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { helpFor } from './headHelp';

/**
 * Gives every table heading that has no explanation of its own a hover note (what it is, what it is for, where it comes from),
 * so any column in the software can be hovered and read. Headings already explained with <Head> are left alone.
 */
export default function TableHelp() {
  const { pathname } = useLocation();
  useEffect(() => {
    let frame = 0;
    const apply = () => {
      frame = 0;
      document.querySelectorAll('th').forEach(th => {
        if (th.dataset.helped === '1' || th.title || th.querySelector('[tabindex],[role=tooltip]')) return;
        th.dataset.helped = '1';
        const text = helpFor(th.textContent);
        if (text) { th.title = text; th.style.cursor = 'help'; }
      });
    };
    const queue = () => { if (!frame) frame = requestAnimationFrame(apply); };
    queue();
    const mo = new MutationObserver(queue);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => { mo.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [pathname]);
  return null;
}
