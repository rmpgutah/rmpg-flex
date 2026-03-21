// ============================================================
// RMPG Flex — App-Wide Dispatch Voice Alerts Hook
// Subscribes to WebSocket dispatch events and triggers voice
// announcements on every page (Dashboard, Map, MDT, etc.),
// not just DispatchPage. Runs inside Layout.tsx so it's always
// active while the user is logged in.
//
// The dedup cache in voiceAlerts.ts (60s TTL) prevents double-
// announcing if DispatchPage also triggers the same alert.
// ============================================================

import { useEffect } from 'react';
import { useWebSocket } from '../context/WebSocketContext';
import {
  announceNewCall,
  announceCallAlerts,
  announceStatusChange,
  announceUnitDispatched,
  announcePanicAlert,
  announceBolo,
  announceWarrantHit,
  announceDispatchEvent,
  announceBackupRequest,
  announcePursuit,
  announceAllUnits,
} from '../utils/voiceAlerts';

/**
 * App-wide dispatch voice alert hook.
 * Call once in Layout.tsx — subscribes to all dispatch-related
 * WebSocket events and fires the appropriate voice announcements.
 */
export function useDispatchVoiceAlerts(): void {
  const { subscribe } = useWebSocket();

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    // ── Dispatch updates (call created, status changed, units dispatched) ──
    unsubs.push(
      subscribe('dispatch_update', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        const action = data.action || msg.action;

        if (action === 'call_created' && data.call) {
          announceNewCall(data.call);
          announceCallAlerts(data.call);
        }

        if (action === 'call_status_changed' && data.call) {
          const status = data.status || data.call?.status;
          if (status) {
            announceStatusChange(data.call, status);
          }
          // Announce dispatch event specifically when status is 'dispatched'
          if (status === 'dispatched') {
            announceDispatchEvent(data.call);
          }
        }

        if (action === 'units_dispatched') {
          announceUnitDispatched(data.call, data.units);
        }
      })
    );

    // ── Panic alert ──
    unsubs.push(
      subscribe('panic_alert', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        announcePanicAlert(data.user_name || data.userName || data.officerName);
      })
    );

    // ── BOLO alert ──
    unsubs.push(
      subscribe('bolo_alert', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        announceBolo(data);
      })
    );

    // ── Warrant hit from safety screening ──
    unsubs.push(
      subscribe('call:warrant_alert', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        announceWarrantHit(data);
      })
    );

    // ── Backup request ──
    unsubs.push(
      subscribe('backup_request', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        announceBackupRequest(data);
      })
    );

    // ── Pursuit update ──
    unsubs.push(
      subscribe('pursuit_update', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        announcePursuit(data);
      })
    );

    // ── All-units broadcast ──
    unsubs.push(
      subscribe('all_units', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        announceAllUnits(data.message || data.text || '');
      })
    );

    return () => {
      unsubs.forEach(fn => fn());
    };
  }, [subscribe]);
}
