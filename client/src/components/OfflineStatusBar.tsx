import { useState } from 'react';
import { WifiOff, Lock, Unlock, RefreshCw, Check, AlertTriangle } from 'lucide-react';
import { useOfflineMode } from '../hooks/useOfflineMode';
import PinEntryModal from './PinEntryModal';

/**
 * Status bar shown at the top of the app when offline or syncing.
 *
 * States:
 * - Amber:  Offline, no PIN — read-only mode for employees
 * - Green:  Offline, PIN authorized — local writes enabled (24h countdown)
 * - Blue:   Push/pull sync in progress
 * - Hidden: Online and not syncing
 *
 * Admin users always see green when offline (no PIN needed).
 * Renders in both Electron and browser when offline mode is initialized.
 */
export default function OfflineStatusBar() {
  const {
    isOfflineCapable,
    isOffline,
    isLocalAuthorized,
    pinCountdown,
    isSyncing,
    syncStatus,
    syncComplete,
    userRole,
    syncQueueDepth,
    triggerSync,
    dismissSyncComplete,
  } = useOfflineMode();

  const [pinModalOpen, setPinModalOpen] = useState(false);

  // Only render when offline mode is available and there's something to show
  if (!isOfflineCapable) return null;
  if (!isOffline && !isSyncing && !syncComplete) return null;

  const isAdmin = userRole === 'admin';

  // ── Sync in progress ──────────────────────────────────
  if (isSyncing) {
    const pct = syncStatus.total > 0 ? Math.round((syncStatus.current / syncStatus.total) * 100) : 0;
    return (
      <div
        className="flex items-center justify-center gap-2 px-4 py-1.5 text-[11px] font-mono"
        style={{
          background: 'rgba(136, 136, 136, 0.15)',
          borderBottom: '1px solid rgba(136, 136, 136, 0.3)',
          color: '#cccccc',
        }}
      >
        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
        <span>
          {syncStatus.phase === 'push' ? 'Pushing' : 'Syncing'}{' '}
          {syncStatus.table && `${syncStatus.table} `}
          ({syncStatus.current}/{syncStatus.total})
        </span>
        <div className="w-24 h-1.5 bg-gray-900/50 overflow-hidden" style={{ borderRadius: 1 }}>
          <div
            className="h-full transition-all duration-300"
            style={{ width: `${pct}%`, background: '#888888' }}
          />
        </div>
      </div>
    );
  }

  // ── Sync complete notification ─────────────────────────
  if (syncComplete && !isOffline) {
    return (
      <div
        className="flex items-center justify-center gap-2 px-4 py-1.5 text-[11px] font-mono cursor-pointer"
        style={{
          background: syncComplete.errors > 0
            ? 'rgba(217, 119, 6, 0.12)'
            : 'rgba(34, 197, 94, 0.12)',
          borderBottom: `1px solid ${syncComplete.errors > 0 ? 'rgba(217, 119, 6, 0.3)' : 'rgba(34, 197, 94, 0.3)'}`,
          color: syncComplete.errors > 0 ? '#fbbf24' : '#86efac',
        }}
        onClick={dismissSyncComplete}
      >
        {syncComplete.errors > 0 ? (
          <AlertTriangle className="w-3.5 h-3.5" />
        ) : (
          <Check className="w-3.5 h-3.5" />
        )}
        <span>
          Sync complete — {syncComplete.pushed > 0 ? `${syncComplete.pushed} pushed` : ''}
          {syncComplete.pushed > 0 && syncComplete.pulled > 0 ? ', ' : ''}
          {syncComplete.pulled > 0 ? `${syncComplete.pulled} pulled` : ''}
          {syncComplete.errors > 0 ? ` (${syncComplete.errors} errors)` : ''}
        </span>
      </div>
    );
  }

  // ── Offline status bars ────────────────────────────────

  // Admin or PIN-authorized: full offline access
  if (isOffline && (isAdmin || isLocalAuthorized)) {
    return (
      <>
        <div
          className="flex items-center justify-center gap-2 px-4 py-1.5 text-[11px] font-mono"
          style={{
            background: 'rgba(34, 197, 94, 0.12)',
            borderBottom: '1px solid rgba(34, 197, 94, 0.3)',
            color: '#86efac',
          }}
        >
          <Unlock className="w-3.5 h-3.5" />
          <span>
            Offline — Local mode active
            {pinCountdown && !isAdmin && ` (expires in ${pinCountdown})`}
          </span>
          {syncQueueDepth > 0 && (
            <span className="text-[10px] text-green-400/60 ml-1">
              • {syncQueueDepth} pending sync
            </span>
          )}
          <button type="button"
            onClick={triggerSync}
            className="ml-2 px-2 py-0.5 text-[10px] transition-colors"
            style={{
              background: 'rgba(34, 197, 94, 0.15)',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              color: '#86efac',
            }}
            title="Force sync attempt"
          >
            <RefreshCw className="w-3 h-3 inline mr-1" />
            Retry
          </button>
        </div>
      </>
    );
  }

  // Employee without PIN: read-only
  if (isOffline) {
    return (
      <>
        <div
          className="flex items-center justify-center gap-2 px-4 py-1.5 text-[11px] font-mono"
          style={{
            background: 'rgba(217, 119, 6, 0.12)',
            borderBottom: '1px solid rgba(217, 119, 6, 0.3)',
            color: '#fbbf24',
          }}
        >
          <WifiOff className="w-3.5 h-3.5" />
          <span>Offline — Read-only mode</span>
          <button type="button"
            onClick={() => setPinModalOpen(true)}
            className="ml-2 px-2 py-0.5 text-[10px] transition-colors"
            style={{
              background: 'rgba(217, 119, 6, 0.2)',
              border: '1px solid rgba(217, 119, 6, 0.4)',
              color: '#fbbf24',
            }}
          >
            <Lock className="w-3 h-3 inline mr-1" />
            Enter PIN
          </button>
        </div>

        <PinEntryModal
          isOpen={pinModalOpen}
          onClose={() => setPinModalOpen(false)}
        />
      </>
    );
  }

  return null;
}
