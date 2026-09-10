import { Suspense } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { LayoutDashboard, Radio, Map, Search, Siren } from 'lucide-react';
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

interface NavItem {
  label: string;
  path: string;
  Icon: React.ElementType;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Home', path: '/mobile', Icon: LayoutDashboard },
  { label: 'Dispatch', path: '/dispatch', Icon: Siren },
  { label: 'Map', path: '/map', Icon: Map },
  { label: 'Search', path: '/records', Icon: Search },
  { label: 'Radio', path: '/radio', Icon: Radio },
];

export default function MobileHomePage() {
  const { user } = useAuth();
  const cards = useMobileLayout(user?.role);
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="flex flex-col min-h-[100dvh] bg-surface-sunken text-rmpg-100 no-overscroll">
      {/* ── Status bar / header ── */}
      <header className="safe-pt px-4 py-3 bg-surface-base border-b border-border-default flex items-center justify-between shrink-0">
        <span className="text-[color:var(--panel-header-color)] text-xs font-bold tracking-widest">
          RMPG FLEX
        </span>
        <span className="text-rmpg-500 text-[10px] uppercase tracking-widest">
          {user?.username ?? ''}
        </span>
      </header>

      {/* ── Quick unit-status row ── */}
      <QuickStatusBar />

      {/* ── Scrollable card stack ── */}
      <main className="flex-1 overflow-y-auto overscroll-contain p-3 space-y-3 pb-[calc(theme(spacing.16)+env(safe-area-inset-bottom,0px))]">
        {cards.map((id) => {
          const Card = CARDS[id];
          return (
            <Suspense
              key={id}
              fallback={
                <div className="h-32 bg-surface-base border border-border-default animate-pulse" />
              }
            >
              <Card />
            </Suspense>
          );
        })}
      </main>

      {/* ── Bottom navigation bar ── */}
      <nav
        aria-label="Mobile navigation"
        className="fixed bottom-0 inset-x-0 bg-surface-base border-t border-border-default grid grid-cols-5 safe-pb shrink-0 z-50"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 4px)' }}
      >
        {NAV_ITEMS.map(({ label, path, Icon }) => {
          const isActive = location.pathname === path;
          return (
            <button
              key={path}
              type="button"
              onClick={() => navigate(path)}
              aria-label={label}
              aria-current={isActive ? 'page' : undefined}
              className={[
                'flex flex-col items-center justify-center gap-0.5 pt-2 pb-1',
                'text-[10px] font-semibold uppercase tracking-widest transition-colors',
                isActive
                  ? 'text-[color:var(--field-label-color)]'
                  : 'text-fg-muted',
              ].join(' ')}
            >
              <Icon
                className={['w-5 h-5', isActive ? 'text-[color:var(--field-label-color)]' : 'text-rmpg-500'].join(' ')}
                aria-hidden="true"
              />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
