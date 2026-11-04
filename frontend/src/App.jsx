import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Sk, SkPage } from './platform/SeoUi';
import { api } from './platform/seoApi';
import Layout from './components/Layout';
import PasswordGate from './components/PasswordGate';
const LandingPage = lazy(() => import('./public/LandingPage'));
const LegalPage = lazy(() => import('./public/LegalPage'));
import LoginPage from './pages/LoginPage';
const UsersPage = lazy(() => import('./pages/UsersPage'));
const SeoOverviewPage = lazy(() => import('./platform/SeoOverviewPage'));
const AutomationPipelinePage = lazy(() => import('./platform/AutomationPipelinePage'));
const GbpManagerPage = lazy(() => import('./platform/GbpManagerPage'));
const ReviewManagerPage = lazy(() => import('./platform/ReviewManagerPage'));
const LocalRankTrackerPage = lazy(() => import('./platform/LocalRankTrackerPage'));
const KeywordResearchPage = lazy(() => import('./platform/KeywordResearchPage'));
const CompetitorFinderPage = lazy(() => import('./platform/CompetitorFinderPage'));
const ContentStudioPage = lazy(() => import('./platform/ContentStudioPage'));
const SiteAuditPage = lazy(() => import('./platform/SiteAuditPage'));
const BacklinksCitationsPage = lazy(() => import('./platform/BacklinksCitationsPage'));
const BacklinkIntelPage = lazy(() => import('./platform/BacklinkIntelPage'));
const CompetitorWatchPage = lazy(() => import('./platform/CompetitorWatchPage'));
const GeoTrackerPage = lazy(() => import('./platform/GeoTrackerPage'));
const ReportsLeadsPage = lazy(() => import('./platform/ReportsLeadsPage'));
const AiAgentPage = lazy(() => import('./platform/AiAgentPage'));
const WebsiteBuilderPage = lazy(() => import('./platform/WebsiteBuilderPage'));
const BusinessOnboardingPage = lazy(() => import('./platform/BusinessOnboardingPage'));
const ConnectionsPage = lazy(() => import('./platform/ConnectionsPage'));
const ConnectResultPage = lazy(() => import('./platform/ConnectResultPage'));
const TrafficPage = lazy(() => import('./platform/TrafficPage'));
const SeoBriefPage = lazy(() => import('./platform/ToolPages').then(m => ({ default: m.SeoBriefPage })));
const SocialPosterPage = lazy(() => import('./platform/ToolPages').then(m => ({ default: m.SocialPosterPage })));
const AdsAssistantPage = lazy(() => import('./platform/ToolPages').then(m => ({ default: m.AdsAssistantPage })));
const AiQuestionsPage = lazy(() => import('./platform/ToolPages').then(m => ({ default: m.AiQuestionsPage })));
const FeaturePage = lazy(() => import('./platform/ToolPages').then(m => ({ default: m.FeaturePage })));
const OrganicRankingsPage = lazy(() => import('./platform/OrganicResearch').then(m => ({ default: m.OrganicRankingsPage })));
const TopPagesPage = lazy(() => import('./platform/TopPagesReport').then(m => ({ default: m.TopPagesPage })));
const toolkit = (name) => lazy(() => import('./platform/SeoToolkit').then(m => ({ default: m[name] })));
const DomainOverviewPage = toolkit('DomainOverviewPage');
const KeywordGapPage = toolkit('KeywordGapPage');
const CompareDomainsPage = toolkit('CompareDomainsPage');
const KeywordOverviewPage = toolkit('KeywordOverviewPage');

/** Page-shaped placeholder: top bar, title and subtitle, then tiles, a chart card and a table card, inside the usual page margins. */
function PageLoading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading">
      <div className="h-[88px] px-6 flex items-center justify-end gap-3"><Sk w="w-9" h="h-9" className="!rounded-full" /><Sk w="w-48" h="h-9" /></div>
      <div className="max-w-[1520px] mx-auto px-6 pb-6 space-y-5">
        <div className="space-y-2"><Sk w="w-56" h="h-6" /><Sk w="w-96 max-w-full" h="h-3" /></div>
        <SkPage header={false} />
      </div>
    </div>
  );
}

export default function App() {
  // undefined = checking the session, null = signed out
  // A returning user's last known profile (name and role only, no secrets) renders the app at once while /me confirms the session.
  const [user, setUser] = useState(() => { try { return JSON.parse(localStorage.getItem('seo:user') || 'null') || undefined; } catch (e) { return undefined; } });
  const [showChangePassword, setShowChangePassword] = useState(false);
  const { pathname } = useLocation();

  const loadMe = useCallback(() => api('/me').then(u => { setUser(u); try { localStorage.setItem('seo:user', JSON.stringify({ id: u.id, name: u.name, email: u.email, role: u.role, is_admin: u.is_admin, must_change_password: u.must_change_password })); } catch (e) { /* private mode */ } }).catch(() => { try { localStorage.removeItem('seo:user'); } catch (e) { /* ignore */ } setUser(null); }), []);
  useEffect(() => { loadMe(); }, [loadMe]);
  useEffect(() => {
    const out = () => { try { localStorage.removeItem('seo:user'); } catch (e) { /* ignore */ } setUser(null); };
    const openPwd = () => setShowChangePassword(true);
    window.addEventListener('seo:unauthorized', out);
    window.addEventListener('seo:change-password', openPwd);
    return () => {
      window.removeEventListener('seo:unauthorized', out);
      window.removeEventListener('seo:change-password', openPwd);
    };
  }, []);

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    try { localStorage.removeItem('seo:user'); } catch (e) { /* ignore */ }
    setUser(null);
  };

  // Public pages: the home page and policies open without signing in (Google's OAuth review needs them).
  // A trailing slash (/privacy/) must not turn a public page into the login screen.
  const publicPath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (publicPath === '/') return <Suspense fallback={<PageLoading />}><LandingPage user={user} /></Suspense>;
  if (publicPath === '/privacy') return <Suspense fallback={<PageLoading />}><LegalPage kind="privacy" /></Suspense>;
  if (publicPath === '/terms') return <Suspense fallback={<PageLoading />}><LegalPage kind="terms" /></Suspense>;

  if (user === undefined) {
    // Keep the sidebar on screen while the session is checked; the page area is a neutral skeleton laid out like a real page.
    return (
      <Routes>
        <Route element={<Layout user={null} checking onLogout={() => {}} onChangePassword={() => {}} />}>
          <Route path="*" element={<PageLoading />} />
        </Route>
      </Routes>
    );
  }
  if (!user) return <LoginPage onSignedIn={loadMe} />;

  return (
    <>
    {showChangePassword && (
      <PasswordGate
        user={user}
        onClose={() => setShowChangePassword(false)}
        onChanged={() => { loadMe(); setShowChangePassword(false); }}
      />
    )}
    <Routes>
      <Route element={<Layout user={user} onLogout={logout} onChangePassword={() => setShowChangePassword(true)} />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<SeoOverviewPage />} />
        <Route path="onboarding" element={<BusinessOnboardingPage />} />
        <Route path="work-plan" element={<Navigate to="/dashboard" replace />} />
        <Route path="automation-pipeline" element={<AutomationPipelinePage />} />
        <Route path="gmb-profile" element={<GbpManagerPage />} />
        <Route path="google-posts" element={<GbpManagerPage initialTab="posts" />} />
        <Route path="media-management" element={<GbpManagerPage initialTab="photos" />} />
        <Route path="reviews" element={<ReviewManagerPage />} />
        <Route path="rank-tracking" element={<LocalRankTrackerPage />} />
        <Route path="keyword-management" element={<KeywordResearchPage />} />
        <Route path="competitor-finder" element={<CompetitorFinderPage />} />
        <Route path="competitor-watch" element={<CompetitorWatchPage />} />
        <Route path="traffic" element={<TrafficPage />} />
        <Route path="seo-brief" element={<SeoBriefPage />} />
        <Route path="social-poster" element={<SocialPosterPage />} />
        <Route path="ads-assistant" element={<AdsAssistantPage />} />
        <Route path="ai-questions" element={<AiQuestionsPage />} />
        <Route path="feature/:slug" element={<FeaturePage />} />
        <Route path="domain-overview" element={<DomainOverviewPage />} />
        <Route path="organic-rankings" element={<OrganicRankingsPage />} />
        <Route path="top-pages" element={<TopPagesPage />} />
        <Route path="keyword-gap" element={<KeywordGapPage />} />
        <Route path="compare-domains" element={<CompareDomainsPage />} />
        <Route path="keyword-overview" element={<KeywordOverviewPage />} />
        <Route path="ai-content-generation" element={<ContentStudioPage />} />
        <Route path="content-calendar" element={<Navigate to="/ai-content-generation?tab=calendar" replace />} />
        <Route path="website-audit" element={<SiteAuditPage />} />
        <Route path="on-page-seo" element={<Navigate to="/website-audit?tab=site" replace />} />
        <Route path="off-page-seo" element={<BacklinksCitationsPage />} />
        <Route path="backlink-intelligence" element={<BacklinkIntelPage />} />
        <Route path="geo-optimization" element={<GeoTrackerPage />} />
        <Route path="leads" element={<ReportsLeadsPage initialTab="leads" />} />
        <Route path="reports" element={<ReportsLeadsPage />} />
        <Route path="automation" element={<AiAgentPage />} />
        <Route path="website-builder" element={<WebsiteBuilderPage />} />
        <Route path="google-integrations" element={<ConnectionsPage />} />
        <Route path="connect-result" element={<ConnectResultPage />} />
        {user.is_admin && <Route path="users" element={<UsersPage me={user} />} />}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
    </>
  );
}
