import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { api } from './platform/seoApi';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import UsersPage from './pages/UsersPage';
import SeoOverviewPage from './platform/SeoOverviewPage';
import AutomationPipelinePage from './platform/AutomationPipelinePage';
import GbpManagerPage from './platform/GbpManagerPage';
import ReviewManagerPage from './platform/ReviewManagerPage';
import LocalRankTrackerPage from './platform/LocalRankTrackerPage';
import KeywordResearchPage from './platform/KeywordResearchPage';
import ContentStudioPage from './platform/ContentStudioPage';
import SiteAuditPage from './platform/SiteAuditPage';
import BacklinksCitationsPage from './platform/BacklinksCitationsPage';
import GeoTrackerPage from './platform/GeoTrackerPage';
import ReportsLeadsPage from './platform/ReportsLeadsPage';
import AiAgentPage from './platform/AiAgentPage';
import WebsiteBuilderPage from './platform/WebsiteBuilderPage';
import ConnectionsPage from './platform/ConnectionsPage';
import ConnectResultPage from './platform/ConnectResultPage';

export default function App() {
  // undefined = checking the session, null = signed out
  const [user, setUser] = useState(undefined);

  const loadMe = useCallback(() => api('/me').then(setUser).catch(() => setUser(null)), []);
  useEffect(() => { loadMe(); }, [loadMe]);
  useEffect(() => {
    const out = () => setUser(null);
    window.addEventListener('seo:unauthorized', out);
    return () => window.removeEventListener('seo:unauthorized', out);
  }, []);

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
  };

  if (user === undefined) {
    return <div className="min-h-screen flex items-center justify-center gap-2 text-[13px] text-gray-500"><Loader2 size={15} className="animate-spin" /> Loading…</div>;
  }
  if (!user) return <LoginPage onSignedIn={loadMe} />;

  return (
    <Routes>
      <Route element={<Layout user={user} onLogout={logout} />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<SeoOverviewPage />} />
        <Route path="automation-pipeline" element={<AutomationPipelinePage />} />
        <Route path="gmb-profile" element={<GbpManagerPage />} />
        <Route path="google-posts" element={<GbpManagerPage initialTab="posts" />} />
        <Route path="media-management" element={<GbpManagerPage initialTab="photos" />} />
        <Route path="reviews" element={<ReviewManagerPage />} />
        <Route path="rank-tracking" element={<LocalRankTrackerPage />} />
        <Route path="keyword-management" element={<KeywordResearchPage />} />
        <Route path="ai-content-generation" element={<ContentStudioPage />} />
        <Route path="website-audit" element={<SiteAuditPage />} />
        <Route path="on-page-seo" element={<SiteAuditPage initialTab="pages" />} />
        <Route path="off-page-seo" element={<BacklinksCitationsPage />} />
        <Route path="geo-optimization" element={<GeoTrackerPage />} />
        <Route path="reports" element={<ReportsLeadsPage />} />
        <Route path="automation" element={<AiAgentPage />} />
        <Route path="website-builder" element={<WebsiteBuilderPage />} />
        <Route path="google-integrations" element={<ConnectionsPage />} />
        <Route path="connect-result" element={<ConnectResultPage />} />
        {user.is_admin && <Route path="users" element={<UsersPage me={user} />} />}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
