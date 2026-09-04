// Tri-pane Intel Portal shell: left rail · center <Outlet/> · right context
// panel. Mounts IntelProvider so every child surface shares one selection
// and one panel. Rail badge counts piggyback on the dashboard overview poll.
import { Outlet } from 'react-router';
import { IntelProvider } from './IntelContext';
import IntelRail from './IntelRail';
import IntelContextPanel from './IntelContextPanel';
import { useIntelOverview } from './useIntelOverview';
import ErrorBoundary from '../../components/ErrorBoundary';

function PortalChrome() {
  const { data } = useIntelOverview();
  const counts = {
    watchlist: data?.stats.on_watchlist ?? 0,
    bolos: data?.bolos.active ?? 0,
    alerts: data?.alerts.length ?? 0,
    queues: (data?.queues.link_suggestions ?? 0) + (data?.queues.resolution_pairs ?? 0),
    aiOnline: false, // flips true in the AI Analyst plan once a provider is detected
  };
  return (
    <div className="flex h-[calc(100vh-var(--app-header-h,72px))] min-h-[480px] bg-surface-base">
      <IntelRail counts={counts} />
      <main className="flex-1 min-h-0 overflow-y-auto min-w-0">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
      <IntelContextPanel />
    </div>
  );
}

export default function IntelPortalLayout() {
  return (
    <IntelProvider>
      <PortalChrome />
    </IntelProvider>
  );
}
