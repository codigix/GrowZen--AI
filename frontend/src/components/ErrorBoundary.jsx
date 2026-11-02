import React from 'react';
import { AlertTriangle, RefreshCw, LayoutDashboard } from 'lucide-react';

/**
 * Catches a crash inside one page so the rest of the app (sidebar, session) stays usable instead of going blank.
 * Give it `key={location.pathname}` so moving to another page resets it.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('Page crashed:', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="max-w-xl mx-auto mt-16 bg-white shadow-card rounded p-6 text-center">
        <AlertTriangle size={28} className="mx-auto text-amber-500 mb-3" />
        <h2 className="text-16 font-semibold text-gray-900">This page hit a problem</h2>
        <p className="text-13 text-gray-500 mt-1">Something unexpected went wrong while showing this page. Your data is safe. Reload the page, or go back to the dashboard.</p>
        <p className="text-11 text-gray-400 mt-2 break-words">{String(error?.message || error).slice(0, 200)}</p>
        <div className="flex justify-center gap-2 mt-4">
          <button className="inline-flex items-center gap-1.5 px-3 h-9 rounded bg-indigo-500 text-white text-13 font-semibold cursor-pointer" onClick={() => window.location.reload()}>
            <RefreshCw size={14} /> Reload page
          </button>
          <a className="inline-flex items-center gap-1.5 px-3 h-9 rounded border border-gray-200 text-13 font-semibold text-gray-700" href="/dashboard">
            <LayoutDashboard size={14} /> Dashboard
          </a>
        </div>
      </div>
    );
  }
}
