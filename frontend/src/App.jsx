import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Sk, SkPage } from './platform/SeoUi';
import { api } from './platform/seoApi';
import Layout from './components/Layout';
import PasswordGate from './components/PasswordGate';
import LandingPage from './public/LandingPage';
import LegalPage from './public/LegalPage';
import LoginPage from './pages/LoginPage';
import UsersPage from './pages/UsersPage';
import SeoOverviewPage from './platform/SeoOverviewPage';
import AutomationPipelinePage from './platform/AutomationPipelinePage';
import GbpManagerPage from './platform/GbpManagerPage';
import ReviewManagerPage from './platform/ReviewManagerPage';
import LocalRankTrackerPage from './platform/LocalRankTrackerPage';
import KeywordResearchPage from './platform/KeywordResearchPage';
import CompetitorFinderPage from './platform/CompetitorFinderPage';
import ContentStudioPage from './platform/ContentStudioPage';
import SiteAuditPage from './platform/SiteAuditPage';
import BacklinksCitationsPage from './platform/BacklinksCitationsPage';
import BacklinkIntelPage from './platform/BacklinkIntelPage';
import CompetitorWatchPage from './platform/CompetitorWatchPage';
import GeoTrackerPage from './platform/GeoTrackerPage';
import ReportsLeadsPage from './platform/ReportsLeadsPage';
import AiAgentPage from './platform/AiAgentPage';
import WebsiteBuilderPage from './platform/WebsiteBuilderPage';
import BusinessOnboardingPage from './platform/BusinessOnboardingPage';
import ConnectionsPage from './platform/ConnectionsPage';
import ConnectResultPage from './platform/ConnectResultPage';
import TrafficPage from './platform/TrafficPage';
import { OrganicRankingsPage } from './platform/OrganicResearch';
import { TopPagesPage } from './platform/TopPagesReport';
import { DomainOverviewPage, KeywordGapPage, CompareDomainsPage, KeywordOverviewPage } from './platform/SeoToolkit';

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
  if (publicPath === '/') return <LandingPage user={user} />;
  if (publicPath === '/privacy') return <LegalPage kind="privacy" />;
  if (publicPath === '/terms') return <LegalPage kind="terms" />;

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
