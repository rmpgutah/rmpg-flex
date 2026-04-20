import { lazy, Suspense } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useMobileLayout, CardId } from './hooks/useMobileLayout';

const CARDS: Record<CardId, React.LazyExoticComponent<any>> = {
  unit: lazy(() => import('./cards/UnitStatusCard')),
  calls: lazy(() => import('./cards/ActiveCallsCard')),
  search: lazy(() => import('./cards/QuickSearchCard')),
  bolos: lazy(() => import('./cards/BolosCard')),
  map: lazy(() => import('./cards/MapSnippetCard')),
  actions: lazy(() => import('./cards/QuickActionsCard')),
  messages: lazy(() => import('./cards/MessagesCard')),
  shift: lazy(() => import('./cards/ShiftCard')),
};

export default function MobileHomePage() {
  const { user } = useAuth();
  const cards = useMobileLayout(user?.role);

  return (
    <div className="min-h-[100dvh] bg-[#0a0a0a] text-white safe-px safe-pb no-overscroll">
      <header className="safe-pt py-3 border-b border-[#222]">
        <h1 className="text-[#d4a017] text-xs font-bold tracking-widest text-center">
          RMPG FLEX · MOBILE
        </h1>
      </header>
      <main className="p-3 space-y-3">
        {cards.map((id) => {
          const Card = CARDS[id];
          return (
            <Suspense key={id} fallback={<div className="h-32 bg-[#141414] border border-[#222] animate-pulse" />}>
              <Card />
            </Suspense>
          );
        })}
      </main>
    </div>
  );
}
