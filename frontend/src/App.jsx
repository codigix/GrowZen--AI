import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
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
import GeoTrackerPage from './platform/GeoTrackerPage';
import ReportsLeadsPage from './platform/ReportsLeadsPage';
import AiAgentPage from './platform/AiAgentPage';
import WebsiteBuilderPage from './platform/WebsiteBuilderPage';
import BusinessOnboardingPage from './platform/BusinessOnboardingPage';
import ConnectionsPage from './platform/ConnectionsPage';
import ConnectResultPage from './platform/ConnectResultPage';
import { OrganicRankingsPage } from './platform/OrganicResearch';
import { DomainOverviewPage, TopPagesPage, KeywordGapPage, CompareDomainsPage, KeywordOverviewPage } from './platform/SeoToolkit';

export default function App() {
  // undefined = checking the session, null = signed out
  const [user, setUser] = useState(undefined);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const { pathname } = useLocation();

  const loadMe = useCallback(() => api('/me').then(setUser).catch(() => setUser(null)), []);
  useEffect(() => { loadMe(); }, [loadMe]);
  useEffect(() => {
    const out = () => setUser(null);
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
    setUser(null);
  };

  // Public pages: the home page and policies open without signing in (Google's OAuth review needs them).
  if (pathname === '/') return <LandingPage user={user} />;
  if (pathname === '/privacy') return <LegalPage kind="privacy" />;
  if (pathname === '/terms') return <LegalPage kind="terms" />;

  if (user === undefined) {
    return <div className="min-h-screen flex items-center justify-center gap-2 text-13 text-gray-500"><Loader2 size={15} className="animate-spin" /> Loading…</div>;
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
