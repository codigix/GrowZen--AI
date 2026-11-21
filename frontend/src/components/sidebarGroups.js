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
      { to: '/keyword-overview', label: 'Keyword Overview', icon: Search },
      { to: '/keyword-management/discover', label: 'Keyword Magic Tool', icon: Wand2 },
      { to: '/keyword-management/topics', label: 'Keyword Strategy Builder', icon: Layers },
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

export const SIDEBAR_SECTIONS = [
  { id: 'home', label: 'Home', title: 'Home', icon: House, groups: [{ items: [page('/dashboard'), page('/growth'), page('/projects'), page('/tracking-overview'), page('/onboarding')] }] },
  {
    id: 'seo', label: 'SEO', title: 'SEO', icon: TrendingUp, groups: [
      { items: [page('/dashboard'), page('/projects')] },
      { title: '1 · Website audit ', items: [page('/website-audit', { label: 'Website audit & business summary' }), link('/page-indexing', 'Page Indexing')] },
      { title: '2 · Competitor Research', items: [page('/competitor-finder'), page('/competitor-watch')] },
      { title: '3 · Keyword Research', items: [link('/keyword-management/workspace', 'Keyword Workspace'), page('/keyword-management/ai', { label: 'Find Keywords', also: ['/keyword-management/discover', '/keyword-management/planner', '/keyword-management/explorer'] }), page('/keyword-overview', { label: 'Check One Keyword' })] },
      { title: '4 · Keyword Mapping', items: [page('/keyword-management/tracked', { label: 'My Keywords', also: ['/keyword-management/topics'] }), link('/keyword-management/mapping', 'Keyword Mapping'), link('/keyword-management/use', 'Keyword Usage')] },
      { title: '5 · Optimize the Pages', items: [link('/fix-plan', 'Fix Plan')] },
      { title: '6 · Content', items: [page('/ai-content-generation/trends', { label: 'Topic Research' }), link('/seo-brief', 'SEO Brief Generator'), page('/ai-content-generation/blog', { label: 'Write Content' })] },
      { title: '7 · Backlinks', items: [{ to: '/backlinks/links', label: 'Backlinks', also: ['/backlinks/sites'] }, link('/backlinks/domains', 'Referring Domains'), link('/backlinks/audit', 'Backlink Audit'), link('/backlinks/opportunities', 'Link Opportunities'), link('/backlinks/gap', 'Competitor Gap'), page('/off-page-seo/outreach'), link('/off-page-seo/tasks', 'Link Building Tasks'), page('/backlink-checker')] },
      { title: '8 · Track Results', items: [page('/rank-tracking/landscape', { label: 'Position Tracking', also: ['/rank-tracking'] }), link('/keyword-management/status', 'Keyword Status'), page('/traffic'), link('/search-insights', 'Search & Visitor Insights'), page('/domain-overview', { label: 'My Search Performance', also: ['/organic-rankings', '/top-pages'] })] },
    ]
  },
  {
    id: 'GMB', label: 'GMB', title: 'GMB', icon: MapPin, groups: [
      {
        items: [link('/gmb-profile/overview', 'Dashboard'), link('/gmb-profile/profile', 'GBP Optimization'), link('/gmb-profile/performance', 'Performance'), link('/gmb-profile/traffic', 'Website Traffic'),
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
      { items: [link('/ai-content-generation/blog', 'AI Article Generator'), link('/website-audit', 'Content Optimizer'), link('/ai-content-generation/trends', 'Topic Finder'), link('/seo-brief', 'SEO Brief Generator')] },
      { items: [link('/ai-content-generation/articles', 'My Content'), link('/ai-content-generation/calendar', 'Content Calendar'), link('/ai-content-generation/publishing', 'Publishing Setup')] }
    ]
  },
  {
    id: 'ai', label: 'AI', title: 'AI Visibility', icon: Sparkles, groups: [
      { title: 'AI Analysis', items: [link('/geo-optimization', 'Visibility Overview'), link('/gmb-profile/aeo', 'AEO'), link('/gmb-profile/geo', 'GEO'), soon('ai-competitors'), link('/ai-questions', 'Prompt Research')] },
      { title: 'Brand Performance', items: [soon('ai-brand'), soon('ai-perception'), soon('ai-narrative'), link('/geo-optimization/sources', 'Cited Sources')] },
      { title: 'Boost & Monitor', items: [page('/website-audit', { label: 'Site Audit' }), link('/geo-optimization/prompts', 'Prompt Tracking'), link('/geo-optimization/files', 'llms.txt'), page('/ai-content-generation/blog', { label: 'Content Creation' })] },
      { title: 'Automation', items: [page('/automation'), page('/automation-pipeline')] }
    ]
  },
  {
    id: 'traffic', label: 'Traffic & Market', title: 'Traffic & Market', icon: BarChart3, groups: [
      { items: [page('/traffic', { label: 'Traffic Analytics' }), page('/domain-overview', { label: 'My Search Performance', also: ['/organic-rankings', '/top-pages'] }), page('/competitor-watch', { label: 'Competitor Monitoring' })] },
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
  { id: 'settings', label: 'Settings', title: 'Settings', icon: Settings, groups: [{ items: [page('/google-integrations'), link('/gmb-profile/settings', 'GBP Settings & Integrations'), page('/users')] }] }
];
