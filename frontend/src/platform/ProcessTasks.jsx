import React, { Suspense, lazy } from 'react';
import { SkList } from './SeoUi';

const Tasks = lazy(() => import('./WorkPlanPage').then(m => ({ default: m.ThisWeek }))); // loaded only when a tasks tab opens

/** The project's weekly tasks for one process, shown on that process's own page (no separate Work Plan page). `areas` picks which tasks belong here. */
export default function ProcessTasks({ b, areas }) {
  return <Suspense fallback={<SkList rows={4} />}><Tasks key={b.id} b={b} areas={areas} /></Suspense>;
}
