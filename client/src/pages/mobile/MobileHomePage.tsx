import { Suspense } from 'react';
import { lazyRetry } from '../../utils/importWithRetry';
import { useAuth } from '../../context/AuthContext';
import { useMobileLayout, CardId } from './hooks/useMobileLayout';
import QuickStatusBar from './components/QuickStatusBar';

const CARDS: Record<CardId, React.LazyExoticComponent<any>> = {
  unit: lazyRetry(() => import('./cards/UnitStatusCard')),
  calls: lazyRetry(() => import('./cards/ActiveCallsCard')),
  search: lazyRetry(() => import('./cards/QuickSearchCard')),
  bolos: lazyRetry(() => import('./cards/BolosCard')),
  map: lazyRetry(() => import('./cards/MapSnippetCard')),
  actions: lazyRetry(() => import('./cards/QuickActionsCard')),
  messages: lazyRetry(() => import('./cards/MessagesCard')),
  shift: lazyRetry(() => import('./cards/ShiftCard')),
};

export default function MobileHomePage() {
  const { user } = useAuth();
  const cards = useMobileLayout(user?.role);

  return (
    <div className="min-h-[100dvh] bg-surface-sunken text-rmpg-100 safe-px safe-pb no-overscroll">
      <header className="safe-pt py-3 border-b border-border-default">
        <h1 className="text-[color:var(--panel-header-color)] text-xs font-bold tracking-widest text-center">
          RMPG FLEX · MOBILE
        </h1>
      </header>
      {/* Quick-status bar — one-thumb status update, always visible */}
      <QuickStatusBar />
      <main className="p-3 space-y-3">
        {cards.map((id) => {
          const Card = CARDS[id];
          return (
            <Suspense key={id} fallback={<div className="h-32 bg-surface-base border border-border-default animate-pulse" />}>
              <Card />
            </Suspense>
          );
        })}
      </main>
    </div>
  );
}
