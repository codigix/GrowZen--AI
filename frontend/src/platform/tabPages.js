// Pages that hold several views. Each view has its own address, /<page>/<view> (for example /gmb-profile/performance), so a sidebar
// link opens a page, not a tab. The old /<page>?tab=<view> links still work: they are redirected to the new address.
export const TAB_BASES = [
  '/gmb-profile', '/keyword-management', '/ai-content-generation', '/off-page-seo', '/geo-optimization', '/reports',
  '/backlink-intelligence', '/organic-rankings', '/rank-tracking', '/chatgpt-business'
];
// Pages whose views are all reachable from the sidebar: their own tab strip is hidden, the sidebar is the menu.
export const HIDE_STRIP = ['/gmb-profile', '/keyword-management', '/ai-content-generation', '/off-page-seo', '/geo-optimization', '/reports', '/chatgpt-business'];
// Pages where the address without a view is a page of its own (a list), so it is not redirected to a default view.
export const LIST_BASES = ['/rank-tracking'];

/** The address of a view of the page that is open now: /gmb-profile/overview + "reviews" -> /gmb-profile/reviews. */
export function viewPath(pathname, view) {
  const clean = pathname.replace(/\/+$/, '') || '/';
  const base = TAB_BASES.find(b => clean === b || clean.startsWith(`${b}/`)) || clean;
  return `${base}/${view}`;
}
