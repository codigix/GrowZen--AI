import { ScanLine, MessageSquare, BarChart3, House, Settings, Megaphone, Newspaper, MessageCircle, LayoutGrid, Activity, Award, Bookmark, Bot, Building2, CalendarDays, Columns3, FileBarChart, FileText, Globe, Layers, LayoutDashboard, Lightbulb, Link2, MapPin, Plug, Radar, ScanSearch, Search, Send, Sparkles, Star, Store, Swords, Target, TrendingUp, Users, Wand2, Workflow } from 'lucide-react';

// The sidebar's sections and pages. Kept apart from Layout so the breadcrumbs can read the same map without a circular import.
export const SIDEBAR_GROUPS = [
  {
    title: 'Overview',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/growth', label: 'Growth Plan', icon: Target, badge: 'New' },
      { to: '/projects', label: 'Projects', icon: Layers },
      { to: '/tracking-overview', label: 'Tracking Overview', icon: MapPin },
      { to: '/onboarding', label: 'Business Onboarding', icon: Building2, badge: 'Phase 1' }
    ]
  },
  {
    title: 'Site Performance',
    items: [
      { to: '/website-audit', label: 'Website Audit & X-Ray', icon: ScanSearch },
      { to: '/rank-tracking/landscape', label: 'Position Tracking', icon: MapPin },
      { to: '/traffic', label: 'Website Traffic', icon: Activity, badge: 'New' },


    ]
  },
  {
    title: 'Competitive Analysis',
    items: [
      { to: '/domain-overview', label: 'Domain Overview', icon: Globe },
      { to: '/organic-rankings', label: 'Organic Rankings', icon: TrendingUp },
      { to: '/top-pages', label: 'Top Pages', icon: FileText },
      { to: '/competitor-finder', label: 'Competitors', icon: Swords },
      { to: '/competitor-watch', label: 'Competitor Watch', icon: Radar, badge: 'New' }
    ]
  },
  {
    title: 'Keyword Research',
    items: [
      { to: '/keyword-management/magic', label: 'Keyword Magic Tool', icon: Wand2, also: ['/keyword-overview'] },
      { to: '/keyword-management/magic2', label: 'Keyword Magic Tool 2.0', icon: Wand2, badge: 'New' },
      { to: '/keyword-management/strategy', label: 'Keyword Strategy Builder', icon: Layers },
      { to: '/keyword-management/tracked', label: 'Saved Keywords', icon: Bookmark }
    ]
  },
  {
    title: 'Content Ideas',
    items: [
      { to: '/ai-content-generation/trends', label: 'Topic Research', icon: Lightbulb },
      { to: '/ai-content-generation/blog', label: 'SEO Writing Assistant', icon: Sparkles, badge: 'AI' },
      { to: '/ai-content-generation/calendar', label: 'Content Calendar & CMS', icon: CalendarDays }
    ]
  },
  {
    title: 'Link Building',
    items: [
      { to: '/backlinks/links', label: 'Backlinks', icon: Link2, badge: 'New' },
      { to: '/backlink-checker', label: 'Backlink Checker', icon: Link2, badge: 'New' },
      { to: '/off-page-seo/outreach', label: 'Outreach', icon: Send }
    ]
  },
  {
    title: 'Local SEO & Maps',
    items: [
      { to: '/gmb-profile', label: 'GBP Profile Manager', icon: Store },
      { to: '/reviews', label: 'Reviews & Reputation', icon: Star },
      { to: '/off-page-seo/citations', label: 'Local Citations & NAP', icon: Award }
    ]
  },
  {
    title: 'AI & Automation',
    items: [
      { to: '/geo-optimization', label: 'AI Search Visibility', icon: Radar },
      { to: '/automation', label: 'AI Tasks & Approvals', icon: Bot },
      { to: '/automation-pipeline', label: 'Automation Pipeline', icon: Workflow }
    ]
  },
  {
    title: 'Business Results',
    items: [
      { to: '/leads', label: 'Leads & Conversions', icon: Target },
      { to: '/reports', label: 'Analytics & Client Reports', icon: FileBarChart }
    ]
  },
  {
    title: 'Administration',
    items: [
      { to: '/google-integrations', label: 'Integrations & APIs', icon: Plug },
      { to: '/users', label: 'Team & Permissions', icon: Users, adminOnly: true }
    ]
  }
];

import { soon } from './featureCatalog';

const BY_TO = Object.fromEntries(SIDEBAR_GROUPS.flatMap(grp => grp.items).map(i => [i.to, i]));
const page = (to, extra = {}) => ({ ...(BY_TO[to] || { to, label: to }), ...extra });

/**
 * The far-left rail: each entry opens its own panel of pages. A page can appear under more than one section (as in the tools this layout
 * follows); only sections with pages that exist here are listed.
 */
const link = (to, label) => ({ to, label });
/** A pointer to a page another section owns (the Blogs section owns the writing pages, Traffic & Market the traffic ones): it is listed here so the path is not lost,
 *  but pressing it opens that section, and the page is never shown as belonging to this one. */
const go = (to, label, section) => ({ to, label, elsewhere: section });

export const SIDEBAR_SECTIONS = [
  { id: 'home', label: 'Home', title: 'Home', icon: House, groups: [{ items: [page('/dashboard'), page('/growth'), page('/projects'), page('/tracking-overview'), page('/onboarding')] }] },
  {
    id: 'seo', label: 'SEO', title: 'SEO', icon: TrendingUp, groups: [
      { title: '1 · Website audit ', items: [page('/website-audit', { label: 'Website audit' }), link('/page-indexing', 'Page Indexing')] },
      { title: '2 · Competitor Research', items: [page('/competitor-finder'), go('/competitor-watch', 'Competitor Watch', 'traffic'), link('/competitor-keywords', 'Competitor Keywords'), link('/organic-rankings/page', 'Organic Rankings')] },
      { title: '3 · Keywords', items: [
        { to: '/keyword-management/workspace', label: 'Find Keywords', also: ['/keyword-management/ai', '/keyword-management/discover', '/keyword-management/planner', '/keyword-management/explorer'] },
        { to: '/keyword-management/magic', label: 'Keyword Magic Tool', also: ['/keyword-overview'] },
        { to: '/keyword-management/magic2', label: 'Keyword Magic Tool 2.0', badge: 'New' },
        link('/keyword-management/prepare', 'Prepare Keywords'),
        link('/keyword-management/strategy', 'Keyword Strategy Builder'),
        page('/keyword-management/tracked', { label: 'My Keywords' }),
        link('/keyword-management/topics', 'Keyword Topics'),
        { to: '/keyword-management/mapping', label: 'Keyword Mapping', also: ['/keyword-management/use'] }] },
      { title: '4 · Write & Update', items: [go('/ai-content-generation/blog', 'Write content (Blogs)', 'Blogs'), link('/fix-plan', 'Fix Plan')] },
      { title: '5 · Track Results', items: [page('/rank-tracking/landscape', { label: 'Position Tracking', also: ['/rank-tracking'] }), link('/keyword-management/status', 'Keyword Status'), link('/search-insights', 'Search & Visitor Insights'), go('/traffic', 'Traffic & search performance', 'traffic')] },
      { title: '6 · Backlinks', items: [{ to: '/backlinks/overview', label: 'Backlinks', also: ['/backlinks/links', '/backlinks/graph', '/backlinks/anchors', '/backlinks/pages', '/backlinks/outbound', '/backlinks/sites'] }, link('/backlinks/domains', 'Referring Domains'), link('/backlinks/audit', 'Backlink Audit'), link('/backlinks/opportunities', 'Link Opportunities'), link('/backlinks/gap', 'Competitor Gap'), page('/off-page-seo/outreach'), link('/off-page-seo/tasks', 'Link Building Tasks'), page('/backlink-checker')] },
    ]
  },
  {
    id: 'GMB', label: 'GMB', title: 'GMB', icon: MapPin, groups: [
      {
        items: [link('/gmb-profile/overview', 'Dashboard'), link('/gmb-profile/project', 'Project Overview'), link('/gmb-profile/gmb-audit', 'GMB Audit'), link('/gmb-profile/profile', 'GBP Optimization'), link('/gmb-profile/performance', 'Performance'), link('/gmb-profile/traffic', 'Website Traffic'),
        page('/reviews', { label: 'Reviews & Reputation' }), page('/google-posts', { label: 'Posts' }), page('/media-management', { label: 'Photos' })]
      },
      { title: 'Listings & Rankings', items: [page('/off-page-seo/citations', { label: 'Listing Management' }), link('/rank-tracking/geo', 'Map Rank Tracker'), link('/gmb-profile/competitors', 'Maps Competitors')] },
      { title: 'Optimization', items: [link('/gmb-profile/local-seo', 'Local SEO'), link('/gmb-profile/ai', 'AI Recommendations')] },
      { title: 'Manage', items: [page('/automation', { label: 'AI Tasks & Approvals' }), link('/gmb-profile/tasks', 'Tasks & Activities'), link('/gmb-profile/sync', 'Sync History'), link('/gmb-profile/reports', 'Reports')] },
      { title: 'Settings', items: [link('/gmb-profile/settings', 'Settings & Integrations')] }
    ]
  },
  {
    id: 'chatgpt', label: 'ChatGPT', title: 'ChatGPT', icon: MessageSquare, groups: [
      { items: [link('/chatgpt-business/claim', 'Claim & Verification'), link('/chatgpt-business/profile', 'Profile & Policies'), link('/chatgpt-business/feed', 'Product / Service Feed'), link('/chatgpt-business/agent', 'Business Agent & Insights')] }
    ]
  },
  {
    id: 'Blogs', label: 'Blogs', title: 'Blogs', icon: FileText, groups: [
      { items: [link('/ai-content-generation/trends', 'Topic Finder'), link('/ai-content-generation/blog', 'AI Article Generator'), link('/seo-brief', 'SEO Brief Generator')] },
      { items: [link('/ai-content-generation/articles', 'Written, Not Posted'), link('/ai-content-generation/posted', 'Posted Blogs'), link('/ai-content-generation/promote', 'Promote & Track Links'), link('/ai-content-generation/calendar', 'Content Calendar'), link('/ai-content-generation/publishing', 'Publishing Setup')] }
    ]
  },
  {
    id: 'ai', label: 'AI', title: 'AI Visibility', icon: Sparkles, groups: [
      { title: 'AI Analysis', items: [link('/geo-optimization', 'Visibility Overview'), link('/gmb-profile/aeo', 'AEO'), link('/gmb-profile/geo', 'GEO'), soon('ai-competitors'), link('/ai-questions', 'Prompt Research')] },
      { title: 'Brand Performance', items: [soon('ai-brand'), soon('ai-perception'), soon('ai-narrative'), link('/geo-optimization/sources', 'Cited Sources')] },
      { title: 'Boost & Monitor', items: [page('/website-audit', { label: 'Site Audit' }), link('/geo-optimization/prompts', 'Prompt Tracking'), link('/geo-optimization/files', 'llms.txt'), go('/ai-content-generation/blog', 'Content Creation (Blogs)', 'Blogs')] },
      { title: 'Automation', items: [page('/automation'), page('/automation-pipeline')] }
    ]
  },
  {
    id: 'traffic', label: 'Traffic & Market', title: 'Traffic & Market', icon: BarChart3, groups: [
      { items: [page('/traffic', { label: 'Traffic Analytics' }), page('/domain-overview', { label: 'My Search Performance', also: ['/organic-rankings', '/top-pages'] }), page('/competitor-watch', { label: 'Competitor Watch' })] },
      { title: 'Traffic Distribution', items: ['tm-ai-traffic', 'tm-referral', 'tm-organic-search', 'tm-paid-search', 'tm-organic-social', 'tm-paid-social', 'tm-email', 'tm-display', 'tm-sources'].map(soon) },
      { title: 'Pages and Categories', items: [link('/organic-rankings/subdomains', 'Subfolders & Subdomains'), soon('tm-page-groups')] },
      { title: 'Regional Trends', items: ['tm-usa', 'tm-business-regions', 'tm-geo-regions'].map(soon) },
      { title: 'Audience Profile', items: ['tm-demographics', 'tm-overlap', 'tm-socio', 'tm-behavior'].map(soon) },
      { title: 'Advanced', items: ['tm-daily', 'tm-industry', 'tm-api', 'tm-trending'].map(soon) }
    ]
  },


  {
    id: 'ad', label: 'Ad', title: 'Advertising', icon: Megaphone, groups: [
      { items: [soon('ads-start')] },
      { items: [link('/ads-assistant', 'Ads Launch Assistant'), soon('ads-agent'), soon('ads-research'), soon('ads-pla'), soon('ads-adclarity')] }
    ]
  },
  {
    id: 'aipr', label: 'AI PR', title: 'AI PR', icon: Newspaper, groups: [
      { items: [soon('pr-dashboard'), link('/geo-optimization/sources', 'AI-Cited Media')] },
      { title: 'Media Database', items: [soon('pr-contacts'), soon('pr-lists')] },
      { title: 'Emails', items: [soon('pr-emails'), soon('pr-senders')] },
      { title: 'Media Monitoring', items: [soon('pr-monitoring'), soon('pr-alerts')] }
    ]
  },
  {
    id: 'social', label: 'Social', title: 'Social', icon: MessageCircle, groups: [
      { items: [soon('social-dashboard')] },
      { title: 'Core', items: [link('/social-poster', 'Social Poster'), soon('social-tracker'), soon('social-insights'), soon('social-analytics')] },
      { title: 'Advanced', items: [soon('social-influencers'), soon('social-monitoring')] }
    ]
  },
  {
    id: 'reports', label: 'Reports', title: 'Reports', icon: FileBarChart, groups: [
      { items: [link('/reports', 'My Reports'), link('/gmb-profile/reports', 'GBP Reports'), link('/reports/progress', 'Weekly & Monthly Progress'), link('/reports/tasks', 'All Tasks'), link('/reports/leads', 'Leads Report'), page('/leads', { label: 'Leads & Conversions' })] },
      { title: 'Top Templates', items: [link('/traffic', 'Google Analytics 4'), link('/domain-overview', 'Google Search Console'), link('/reports', 'Monthly SEO')] },
      { items: [soon('report-create'), soon('report-templates'), soon('report-themes')] }
    ]
  },
  { id: 'apps', label: 'Apps', title: 'App Center', icon: LayoutGrid, groups: [{ items: [soon('apps-store'), soon('apps-mine'), page('/google-integrations')] }] },
  { id: 'settings', label: 'Settings', title: 'Settings', icon: Settings, groups: [{ items: [page('/google-integrations'), link('/data-sources', 'Data Source Map'), link('/gmb-profile/settings', 'GBP Settings & Integrations'), page('/users')] }] }
];
