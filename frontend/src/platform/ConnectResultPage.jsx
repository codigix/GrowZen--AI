import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { SeoShell, Card, Button, useSeoBusiness } from './SeoUi';
import { LocationPicker } from './GbpConnect';

/** Where Google sends the browser back after sign-in (via the SEO backend's callback). */
export default function ConnectResultPage() {
  const { search } = useLocation();
  const navigate = useNavigate();
  const [, setBusiness] = useSeoBusiness();
  const q = new URLSearchParams(search);
  const connection = q.get('connection');
  const error = q.get('error');
  const gbpPage = '/gmb-profile';
  return (
    <SeoShell title="Google account connected" subtitle="Choose which of its Business Profiles to add" hideSwitcher needsBusiness={false}>
      <Card className="max-w-3xl">
        {error ? (
          <div className="py-4">
            <div className="flex items-center gap-2 text-red-700 font-medium"><AlertTriangle size={16} /> Google sign-in did not finish</div>
            <p className="text-[13px] text-gray-700 mt-1">{error === 'access_denied' || error === 'cancelled' ? 'Access was not granted.' : error}</p>
            <Button className="mt-3" onClick={() => navigate(`${gbpPage}?connect=1`)}>Try again</Button>
          </div>
        ) : connection ? (
          <div className="pt-2">
            <LocationPicker connectionId={connection} onImported={(out) => { if (out[0]) setBusiness(out[0].id); navigate(gbpPage); }} />
          </div>
        ) : <div className="py-6 text-[13px] text-gray-600">Nothing to show.</div>}
      </Card>
    </SeoShell>
  );
}
