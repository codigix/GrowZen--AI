import React from 'react';
import { SeoShell } from './SeoUi';
import PositionTrackingHome from './PositionTrackingHome';

/** Every project's tracking in one table: visibility, how it moved, keywords up and down. A click opens that project's Position Tracking. */
export default function TrackingOverviewPage() {
  return (
    <SeoShell title="Tracking Overview" subtitle="Every project's visibility on Google and in AI answers: open one to see its positions, landscape and competitors" needsBusiness={false}>
      <PositionTrackingHome />
    </SeoShell>
  );
}
