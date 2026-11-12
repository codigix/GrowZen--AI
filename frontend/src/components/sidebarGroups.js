import { BarChart3, House, Settings, Megaphone, Newspaper, MessageCircle, LayoutGrid, Activity, Award, Bookmark, Bot, Building2, CalendarDays, Columns3, FileBarChart, FileText, Globe, Layers, LayoutDashboard, Lightbulb, Link2, MapPin, Plug, Radar, ScanSearch, Search, Send, Sparkles, Star, Store, Swords, Target, TrendingUp, Users, Wand2, Workflow } from 'lucide-react';

// The sidebar's sections and pages. Kept apart from Layout so the breadcrumbs can read the same map without a circular import.
export const SIDEBAR_GROUPS = [
  {
    title: 'Overview',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/projects', label: 'Projects', icon: Layers },
      { to: '/onboarding', label: 'Business Onboarding', icon: Building2, badge: 'Phase 1' }
    ]
  },
  {
    title: 'Site Performance',
    items: [
      { to: '/website-audit', label: 'Site Audit', icon: ScanSearch },
      { to: '/rank-tracking', label: 'Position Tracking', icon: MapPin },
      { to: '/traffic', label: 'Website Traffic', icon: Activity, badge: 'New' },


    ]
  },
  {
    title: 'Competitive Analysis',
    items: [
      { to: '/domain-overview', label: 'Domain Overview', icon: Globe },
      { to: '/organic-rankings', label: 'Organic Rankings', icon: TrendingUp },
      { to: '/top-pages', label: 'Top Pages', icon: FileText },
      { to: '/competitor-finder', label: 'Competitor Research', icon: Swords },
      { to: '/competitor-watch', label: 'Competitor Watch', icon: Radar, badge: 'New' },
      { to: '/compare-domains', label: 'Compare Domains', icon: Columns3 },
      { to: '/keyword-gap', label: 'Keyword Gap', icon: Target }
    ]
  },
  {
    title: 'Keyword Research',
    items: [
      { to: '/keyword-overview', label: 'Keyword Overview', icon: Search },
      { to: '/keyword-management?tab=discover', label: 'Keyword Magic Tool', icon: Wand2 },
      { to: '/keyword-management?tab=topics', label: 'Keyword Strategy Builder', icon: Layers },
      { to: '/keyword-management?tab=tracked', label: 'Saved Keywords', icon: Bookmark }
    ]
  },
  {
    title: 'Content Ideas',
    items: [
      { to: '/ai-content-generation?tab=trends', label: 'Topic Research', icon: Lightbulb },
      { to: '/ai-content-generation?tab=blog', label: 'SEO Writing Assistant', icon: Sparkles, badge: 'AI' },
      { to: '/ai-content-generation?tab=calendar', label: 'Content Calendar & CMS', icon: CalendarDays }
    ]
  },
  {
    title: 'Link Building',
    items: [
      { to: '/backlink-intelligence', label: 'Backlink Intelligence', icon: Link2, badge: 'New' },
      { to: '/off-page-seo?tab=outreach', label: 'Outreach', icon: Send }
    ]
  },
  {
    title: 'Local SEO & Maps',
    items: [
      { to: '/gmb-profile', label: 'GBP Profile Manager', icon: Store },
      { to: '/reviews', label: 'Reviews & Reputation', icon: Star },
      { to: '/off-page-seo?tab=citations', label: 'Local Citations & NAP', icon: Award }
    ]
  },
  {
    title: 'AI & Automation',
    items: [
      { to: '/geo-optimization', label: 'AI Search Visibility', icon: Radar },
      { to: '/automation', label: 'Autonomous AI Agents', icon: Bot },
      { to: '/automation-pipeline', label: 'Automation Pipeline', icon: Workflow },
      { to: '/website-builder', label: 'Website Builder & Slugs', icon: Globe, badge: 'Live' }
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
  { id: 'home', label: 'Home', title: 'Home', icon: House, groups: [{ items: [page('/dashboard'), page('/projects'), page('/onboarding')] }] },
  {
    id: 'seo', label: 'SEO', title: 'SEO', icon: TrendingUp, groups: [
      { items: [page('/dashboard')] },
      { title: 'Site Performance', items: [page('/website-audit'), page('/rank-tracking'), page('/traffic')] },
      { title: 'Competitive Analysis', items: [page('/domain-overview'), page('/organic-rankings'), page('/top-pages'), page('/competitor-finder'), page('/competitor-watch'), page('/compare-domains'), page('/keyword-gap'), link('/backlink-intelligence?tab=gap', 'Backlink Gap')] },
      { title: 'Keyword Research', items: [page('/keyword-overview'), page('/keyword-management?tab=discover'), page('/keyword-management?tab=topics'), page('/keyword-management?tab=tracked')] },
      { title: 'Content Ideas', items: [page('/ai-content-generation?tab=blog'), page('/ai-content-generation?tab=trends'), link('/seo-brief', 'SEO Brief Generator')] },
      { title: 'Link Building', items: [page('/backlink-intelligence'), link('/backlink-intelligence?tab=explorer', 'Backlinks'), soon('referring-domains'), soon('backlink-audit'), page('/off-page-seo?tab=outreach')] }
    ]
  },
  {
    id: 'GMB', label: 'GMB', title: 'GMB', icon: MapPin, groups: [
      { items: [link('/gmb-profile?tab=overview', 'Dashboard'), link('/gmb-profile?tab=profile', 'GBP Optimization'), link('/gmb-profile?tab=performance', 'Performance'), link('/gmb-profile?tab=traffic', 'Website Traffic'),
        link('/gmb-profile?tab=reviews', 'Reviews & Reputation'), page('/google-posts', { label: 'Posts' }), page('/media-management', { label: 'Photos' })] },
      { title: 'Listings & Rankings', items: [page('/off-page-seo?tab=citations', { label: 'Listing Management' }), link('/rank-tracking?tab=geo', 'Map Rank Tracker'), link('/gmb-profile?tab=competitors', 'Competitor Analysis')] },
      { title: 'Optimization', items: [link('/gmb-profile?tab=local-seo', 'Local SEO'), link('/gmb-profile?tab=ai', 'AI Recommendations')] },
      { title: 'Manage', items: [page('/automation', { label: 'GBP AI Agent' }), link('/gmb-profile?tab=tasks', 'Tasks & Activities'), link('/gmb-profile?tab=sync', 'Sync History'), link('/gmb-profile?tab=reports', 'Reports')] },
      { title: 'Settings', items: [link('/gmb-profile?tab=settings', 'Settings & Integrations')] }
    ]
  },
  {
    id: 'Blogs', label: 'Blogs', title: 'Blogs', icon: FileText, groups: [
      { items: [link('/ai-content-generation?tab=blog', 'AI Article Generator'), link('/website-audit', 'Content Optimizer'), link('/ai-content-generation?tab=trends', 'Topic Finder'), link('/seo-brief', 'SEO Brief Generator')] },
      { items: [link('/ai-content-generation?tab=articles', 'My Content'), link('/ai-content-generation?tab=calendar', 'Content Calendar'), page('/website-builder')] }
    ]
  },
  {
    id: 'ai', label: 'AI', title: 'AI Visibility', icon: Sparkles, groups: [
      { title: 'AI Analysis', items: [link('/geo-optimization', 'Visibility Overview'), link('/gmb-profile?tab=aeo', 'AEO'), link('/gmb-profile?tab=geo', 'GEO'), soon('ai-competitors'), link('/ai-questions', 'Prompt Research')] },
      { title: 'Brand Performance', items: [soon('ai-brand'), soon('ai-perception'), soon('ai-narrative'), link('/geo-optimization?tab=sources', 'Cited Sources')] },
      { title: 'Boost & Monitor', items: [page('/website-audit', { label: 'Site Audit' }), link('/geo-optimization?tab=prompts', 'Prompt Tracking'), link('/geo-optimization?tab=files', 'llms.txt'), page('/ai-content-generation?tab=blog', { label: 'Content Creation' })] },
      { title: 'Automation', items: [page('/automation'), page('/automation-pipeline')] }
    ]
  },
  {
    id: 'traffic', label: 'Traffic & Market', title: 'Traffic & Market', icon: BarChart3, groups: [
      { items: [page('/traffic', { label: 'Traffic Analytics' }), page('/top-pages'), page('/domain-overview', { label: 'Market Overview' }), page('/competitor-watch', { label: 'Competitor Monitoring' })] },
      { title: 'Traffic Distribution', items: ['tm-ai-traffic', 'tm-referral', 'tm-organic-search', 'tm-paid-search', 'tm-organic-social', 'tm-paid-social', 'tm-email', 'tm-display', 'tm-sources'].map(soon) },
      { title: 'Pages and Categories', items: [link('/organic-rankings?tab=subdomains', 'Subfolders & Subdomains'), soon('tm-page-groups')] },
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
      { items: [soon('pr-dashboard'), link('/geo-optimization?tab=sources', 'AI-Cited Media')] },
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
      { items: [link('/reports', 'My Reports'), link('/gmb-profile?tab=reports', 'GBP Reports'), link('/reports?tab=progress', 'Weekly & Monthly Progress'), link('/reports?tab=tasks', 'All Tasks'), page('/leads', { label: 'Leads & Conversions' })] },
      { title: 'Top Templates', items: [link('/traffic', 'Google Analytics 4'), link('/domain-overview', 'Google Search Console'), link('/reports', 'Monthly SEO')] },
      { items: [soon('report-create'), soon('report-templates'), soon('report-themes')] }
    ]
  },
  { id: 'apps', label: 'Apps', title: 'App Center', icon: LayoutGrid, groups: [{ items: [soon('apps-store'), soon('apps-mine'), page('/google-integrations')] }] },
  { id: 'settings', label: 'Settings', title: 'Settings', icon: Settings, groups: [{ items: [page('/google-integrations'), link('/gmb-profile?tab=settings', 'GBP Settings & Integrations'), page('/users')] }] }
];
