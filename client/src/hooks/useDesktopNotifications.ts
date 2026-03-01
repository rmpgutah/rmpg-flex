// ============================================================
// RMPG Flex — Desktop Notification Hook
// Browser Notification API integration for dispatch events.
// Alerts officers when new calls arrive, units are dispatched,
// or panic events occur — even when the tab is backgrounded.
// ============================================================

import { useEffect, useRef, useCallback } from 'react';
import { useWebSocket } from '../context/WebSocketContext';
import type { WSMessage } from '../types';

// ── Permission State ───────────────────────────────────────

let permissionRequested = false;

/** Request notification permission (must be triggered by user gesture). */
export function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return Promise.resolve('denied' as NotificationPermission);
  if (Notification.permission !== 'default') return Promise.resolve(Notification.permission);
  permissionRequested = true;
  return Notification.requestPermission();
}

/** Check if notifications are enabled. */
export function areNotificationsEnabled(): boolean {
  return 'Notification' in window && Notification.permission === 'granted';
}

// ── Priority Config ────────────────────────────────────────

const PRIORITY_LABELS: Record<string, string> = {
  P1: '🔴 EMERGENCY',
  P2: '🟠 URGENT',
  P3: '🔵 ROUTINE',
  P4: '⚪ SCHEDULED',
};

const PRIORITY_URGENCY: Record<string, NotificationOptions['tag']> = {
  P1: 'emergency',
  P2: 'urgent',
  P3: 'routine',
  P4: 'low',
};

// ── Notification Creators ──────────────────────────────────

function showCallNotification(data: any): void {
  if (!areNotificationsEnabled()) return;
  // Don't notify if page is focused
  if (document.hasFocus()) return;

  const priority = data.priority || 'P3';
  const callType = (data.incident_type || data.call_type || 'unknown')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c: string) => c.toUpperCase());

  const title = `${PRIORITY_LABELS[priority] || priority} — New Call`;
  const body = [
    callType,
    data.location_address || data.location || '',
    data.description ? data.description.substring(0, 100) : '',
  ].filter(Boolean).join('\n');

  try {
    const notification = new Notification(title, {
      body,
      icon: '/rmpg-logo-192.png',
      badge: '/rmpg-logo-192.png',
      tag: `call-${data.id || Date.now()}`,
      requireInteraction: priority === 'P1' || priority === 'P2',
      silent: false,
    });

    notification.onclick = () => {
      window.focus();
      // Navigate to dispatch page
      window.location.hash = '';
      window.location.pathname = '/dispatch';
      notification.close();
    };

    // Auto-close after 15s for P3/P4
    if (priority !== 'P1' && priority !== 'P2') {
      setTimeout(() => notification.close(), 15000);
    }
  } catch {
    // Notification creation failed (e.g., service worker required on some browsers)
  }
}

function showPanicNotification(data: any): void {
  if (!areNotificationsEnabled()) return;

  const officerName = data.officer_name || data.user_name || 'Officer';
  const title = '🚨 PANIC ALERT — OFFICER EMERGENCY';
  const body = [
    `${officerName} has activated the panic button`,
    data.location || data.address || '',
    data.latitude && data.longitude ? `GPS: ${data.latitude}, ${data.longitude}` : '',
  ].filter(Boolean).join('\n');

  try {
    const notification = new Notification(title, {
      body,
      icon: '/rmpg-logo-192.png',
      tag: `panic-${data.user_id || Date.now()}`,
      requireInteraction: true,
      silent: false,
    });

    notification.onclick = () => {
      window.focus();
      window.location.pathname = '/dispatch';
      notification.close();
    };
  } catch {
    // fail silently
  }
}

function showUnitStatusNotification(data: any): void {
  if (!areNotificationsEnabled()) return;
  if (document.hasFocus()) return;

  // Only notify for important status changes
  const importantStatuses = ['enroute', 'onscene', 'emergency'];
  if (!importantStatuses.includes(data.status)) return;

  const statusLabels: Record<string, string> = {
    enroute: 'En Route',
    onscene: 'On Scene',
    emergency: '⚠️ Emergency',
  };

  try {
    new Notification(`Unit ${data.callsign || data.unit_name || 'Unknown'}: ${statusLabels[data.status] || data.status}`, {
      body: data.call_number ? `Responding to ${data.call_number}` : '',
      icon: '/rmpg-logo-192.png',
      tag: `unit-${data.id || Date.now()}`,
      silent: true,
    });
  } catch {
    // fail silently
  }
}

function showBoloNotification(data: any): void {
  if (!areNotificationsEnabled()) return;

  try {
    const notification = new Notification('⚠️ New BOLO Alert', {
      body: [
        data.title || 'Be on the lookout',
        data.subject_description || data.vehicle_description || '',
      ].filter(Boolean).join('\n'),
      icon: '/rmpg-logo-192.png',
      tag: `bolo-${data.id || Date.now()}`,
      requireInteraction: true,
    });

    notification.onclick = () => {
      window.focus();
      window.location.pathname = '/communications';
      notification.close();
    };
  } catch {
    // fail silently
  }
}

function showTrespassNotification(call: any, alert: any): void {
  if (!areNotificationsEnabled()) return;
  // Show trespass alerts even if window is focused — officer safety
  const subjects = (alert.orders || [])
    .map((o: any) => `${o.subject_first_name} ${o.subject_last_name} (${o.order_type})`)
    .join(', ');

  try {
    const notification = new Notification(`⚠ TRESPASS ALERT — ${call.call_number || 'New Call'}`, {
      body: [
        `${alert.count} active trespass order(s) at this location`,
        subjects,
        call.location_address || '',
      ].filter(Boolean).join('\n'),
      icon: '/rmpg-logo-192.png',
      tag: `trespass-${call.id || Date.now()}`,
      requireInteraction: true,
      silent: false,
    });

    notification.onclick = () => {
      window.focus();
      window.location.pathname = '/dispatch';
      notification.close();
    };
  } catch {
    // fail silently
  }
}

function showBoloMatchNotification(call: any, alert: any): void {
  if (!areNotificationsEnabled()) return;
  // Show BOLO matches even if window is focused — officer safety
  const bolos = (alert.bolos || [])
    .map((b: any) => `${b.bolo_number}: ${b.title}`)
    .join(', ');

  try {
    const notification = new Notification(`🚨 BOLO MATCH — ${call.call_number || 'New Call'}`, {
      body: [
        `${alert.count} possible BOLO match(es)`,
        bolos,
        call.location_address || '',
      ].filter(Boolean).join('\n'),
      icon: '/rmpg-logo-192.png',
      tag: `bolo-match-${call.id || Date.now()}`,
      requireInteraction: true,
      silent: false,
    });

    notification.onclick = () => {
      window.focus();
      window.location.pathname = '/dispatch';
      notification.close();
    };
  } catch {
    // fail silently
  }
}

function showDispatchTimerNotification(data: any): void {
  if (!areNotificationsEnabled()) return;

  const title = data.alert_type === 'pending_overdue'
    ? `⏰ OVERDUE — ${data.call_number || 'Call'} (${data.priority || '?'})`
    : `⚠ ${data.call_number || 'Call'} — No Status Update`;

  try {
    const notification = new Notification(title, {
      body: data.message || 'Dispatch timer alert',
      icon: '/rmpg-logo-192.png',
      tag: `timer-${data.call_id || Date.now()}-${data.alert_type}`,
      requireInteraction: data.priority === 'P1' || data.priority === 'P2',
      silent: false,
    });

    notification.onclick = () => {
      window.focus();
      window.location.pathname = '/dispatch';
      notification.close();
    };

    // Auto-close for lower priority
    if (data.priority !== 'P1' && data.priority !== 'P2') {
      setTimeout(() => notification.close(), 15000);
    }
  } catch {
    // fail silently
  }
}

// ── Hook ───────────────────────────────────────────────────

/**
 * Subscribe to dispatch WebSocket events and show browser notifications.
 * Automatically handles permission requests on first user interaction.
 */
export function useDesktopNotifications(): {
  requestPermission: () => Promise<NotificationPermission>;
  isEnabled: boolean;
} {
  const { subscribe } = useWebSocket();
  const isEnabled = areNotificationsEnabled();

  // Request permission on first user interaction if not yet requested
  useEffect(() => {
    if (permissionRequested || Notification.permission !== 'default') return;

    const handler = () => {
      requestNotificationPermission();
      document.removeEventListener('click', handler);
    };
    document.addEventListener('click', handler, { once: true });
    return () => document.removeEventListener('click', handler);
  }, []);

  // Subscribe to dispatch events
  // NOTE: The server broadcasts all dispatch events as type 'dispatch_update'
  // with an `action` field inside the data payload (e.g. action: 'call_created').
  // Similarly, unit events come as 'unit_update'. We subscribe to the ACTUAL
  // WS message types and check the action inside.
  useEffect(() => {
    const unsubs: (() => void)[] = [];

    // Dispatch updates — new calls, trespass alerts via action field
    unsubs.push(subscribe('dispatch_update' as any, (msg: WSMessage) => {
      const data = (msg as any).data || msg;
      if (data.action === 'call_created' && data.call) {
        showCallNotification(data.call);
        // Trespass alert desktop notification — separate, urgent notification
        if (data.trespass_alert && data.trespass_alert.count > 0) {
          showTrespassNotification(data.call, data.trespass_alert);
        }
        // BOLO match desktop notification
        if (data.bolo_alert && data.bolo_alert.count > 0) {
          showBoloMatchNotification(data.call, data.bolo_alert);
        }
      } else if (data.action === 'dispatch_alert') {
        // Response timer overdue alerts
        showDispatchTimerNotification(data);
      }
    }));

    // Panic alert — uses direct type (bypasses channel routing)
    unsubs.push(subscribe('panic_alert', (msg: WSMessage) => {
      showPanicNotification((msg as any).data || msg);
    }));

    // Unit status changes
    unsubs.push(subscribe('unit_update' as any, (msg: WSMessage) => {
      const data = (msg as any).data || msg;
      if (data.action === 'unit_status_changed' && data.unit) {
        showUnitStatusNotification(data.unit);
      }
    }));

    // Alerts channel — BOLO alerts (broadcastAlert sends type: 'alert', data: { type: 'new_bolo', bolo })
    unsubs.push(subscribe('alert' as any, (msg: WSMessage) => {
      const data = (msg as any).data || msg;
      if (data.type === 'new_bolo' && data.bolo) {
        showBoloNotification(data.bolo);
      }
    }));

    return () => unsubs.forEach(fn => fn());
  }, [subscribe]);

  return {
    requestPermission: requestNotificationPermission,
    isEnabled,
  };
}

export default useDesktopNotifications;
