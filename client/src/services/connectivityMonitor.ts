// ============================================================
// RMPG Flex — Browser Connectivity Monitor
// Mirrors desktop/connectivityMonitor.js using browser APIs.
// Combines navigator.onLine + /api/health polling + debounce.
// ============================================================

// ─── Types ──────────────────────────────────────────────────

type ConnectivityCallback = (isOnline: boolean) => void;

interface ConnectivityOptions {
  pollInterval?: number;     // ms between health checks (default 10s)
  stableCount?: number;      // consecutive checks to confirm transition (default 3)
  requestTimeout?: number;   // ms per health check request (default 5s)
}

// ─── Connectivity Monitor ───────────────────────────────────

class BrowserConnectivityMonitor {
  private serverUrl: string;
  private pollInterval: number;
  private stableCount: number;
  private requestTimeout: number;

  isOnline: boolean = false;
  private stopped: boolean = false;
  private consecutiveState: number = 0;
  private pendingState: boolean = false;
  private timer: ReturnType<typeof setTimeout> | null = null; // changed to setTimeout for adaptive polling
  private onTransition: ConnectivityCallback | null = null;
  private listeners: Set<ConnectivityCallback> = new Set();
  private consecutiveFailures: number = 0;      // track offline streaks for adaptive backoff
  hasCompletedFirstCheck: boolean = false;       // public so isLikelyOnline() can prefer authoritative state over navigator.onLine

  // Browser event handlers (stored for cleanup)
  private handleOnline: () => void;
  private handleOffline: () => void;
  private handleVisibility: () => void;

  constructor(serverUrl: string, options: ConnectivityOptions = {}) {
    this.serverUrl = serverUrl;
    this.pollInterval = options.pollInterval || 10_000;
    this.stableCount = options.stableCount || 3;
    this.requestTimeout = options.requestTimeout || 5_000;

    // Bind browser event handlers
    this.handleOnline = () => this.onBrowserOnline();
    this.handleOffline = () => this.onBrowserOffline();
    this.handleVisibility = () => this.onVisibilityChange();
  }

  /**
   * Start monitoring connectivity.
   * @param onTransition — called when online/offline state changes
   */
  start(onTransition?: ConnectivityCallback): void {
    this.onTransition = onTransition || null;

    // Set initial state from navigator
    this.isOnline = navigator.onLine;
    this.pendingState = navigator.onLine;

    // Listen for browser online/offline events (instant detection)
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);

    // Pause polling when tab is hidden
    document.addEventListener('visibilitychange', this.handleVisibility);

    // Immediate health check
    this.check();

    // Start adaptive polling (uses setTimeout chain instead of fixed setInterval
    // so we can increase the interval during extended outages to save bandwidth)
    this.scheduleNextPoll();

  }

  private scheduleNextPoll(): void {
    if (this.timer) clearTimeout(this.timer);

    // Adaptive interval: during extended offline, slow down to save bandwidth on patrol vehicles.
    // Normal: 10s. After 6 consecutive failures (~1 min): 20s. After 18 (~5 min): 30s.
    let interval = this.pollInterval;
    if (this.consecutiveFailures > 18) {
      interval = Math.min(this.pollInterval * 3, 30_000); // cap at 30s
    } else if (this.consecutiveFailures > 6) {
      interval = this.pollInterval * 2;
    }

    this.timer = setTimeout(() => {
      if (document.visibilityState === 'visible') {
        this.check();
      }
      this.scheduleNextPoll();
    }, interval);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
    document.removeEventListener('visibilitychange', this.handleVisibility);

  }

  /** Subscribe to connectivity changes */
  onChange(callback: ConnectivityCallback): () => void {
    this.listeners.add(callback);
    return () => { this.listeners.delete(callback); };
  }

  /** Force an immediate check */
  async checkNow(): Promise<boolean> {
    return this.doHealthCheck();
  }

  // ─── Internal ────────────────────────────────────────────

  private onBrowserOnline(): void {
    // Trigger rapid sequential checks to confirm connectivity quickly.
    // Officers returning from dead zones need fast online transition
    // rather than waiting for stableCount * pollInterval (30s default).
    this.rapidCheck(0);
  }

  private rapidCheck(count: number): void {
    if (this.stopped) return; // monitor was stopped
    if (count >= this.stableCount) return; // enough checks done
    if (this.isOnline) return; // already transitioned

    this.check().then(() => {
      if (!this.isOnline && count < this.stableCount - 1) {
        // Schedule next rapid check after 1s instead of full pollInterval
        setTimeout(() => this.rapidCheck(count + 1), 1000);
      }
    });
  }

  private onBrowserOffline(): void {
    // Immediately transition — navigator.onLine is reliable for offline
    if (this.isOnline) {
      this.isOnline = false;
      this.consecutiveState = 0;
      this.pendingState = false;
      this.notifyListeners(false);
    }
  }

  private onVisibilityChange(): void {
    if (document.visibilityState === 'visible') {
      // Tab became visible — reset backoff and check immediately.
      // Officer returning to the app should get instant connectivity status.
      this.consecutiveFailures = 0;
      this.check();
      this.scheduleNextPoll(); // restart with base interval
    }
  }

  private async check(): Promise<void> {
    const reachable = await this.doHealthCheck();

    // Track consecutive failures for adaptive backoff
    if (reachable) {
      this.consecutiveFailures = 0;
    } else {
      this.consecutiveFailures++;
    }

    if (reachable === this.pendingState) {
      this.consecutiveState++;
    } else {
      this.pendingState = reachable;
      this.consecutiveState = 1;
    }

    // Fast-path the very first real check: if the bootstrap state (seeded
    // from navigator.onLine in start()) disagrees with the authoritative
    // health-check result, transition immediately instead of waiting
    // stableCount × pollInterval seconds. This matters when navigator.onLine
    // lies at page-load time (common in Chromium VMs, iOS Safari standalone,
    // and some Electron contexts): without the fast-path, a bogus
    // `navigator.onLine === false` would pin the UI to "offline" for a full
    // 30 seconds after load even though the server is reachable.
    if (!this.hasCompletedFirstCheck) {
      this.hasCompletedFirstCheck = true;
      if (reachable !== this.isOnline) {
        this.isOnline = reachable;
        this.pendingState = reachable;
        this.consecutiveState = this.stableCount; // treat as fully confirmed
        this.notifyListeners(reachable);
        return;
      }
    }

    // Only transition after stable consecutive checks
    if (this.consecutiveState >= this.stableCount && reachable !== this.isOnline) {
      const wasOnline = this.isOnline;
      this.isOnline = reachable;

      this.notifyListeners(reachable);
    }
  }

  private async doHealthCheck(): Promise<boolean> {
    // NOTE: We deliberately do NOT short-circuit on !navigator.onLine here.
    // navigator.onLine is unreliable: it returns `false` in some Chromium
    // VMs, iOS Safari standalone mode, and certain corporate proxy setups
    // even while the device is happily making HTTP requests. A short-circuit
    // would trap the monitor in "offline" forever because the only thing
    // that would unstick it (a navigator `online` event) requires the
    // browser's flag to flip on its own — which never happens when the
    // underlying network state hasn't actually changed.
    //
    // Instead, always attempt the real fetch. If navigator genuinely is
    // offline, the fetch fails quickly (no DNS, no socket) and we return
    // false. If navigator is lying and the server IS reachable, the fetch
    // succeeds and we return true, letting the monitor recover.
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.requestTimeout);

      const response = await fetch(`${this.serverUrl}/api/health`, {
        method: 'GET',
        signal: controller.signal,
        cache: 'no-store',
      });

      clearTimeout(timeout);
      return response.status === 200;
    } catch {
      return false;
    }
  }

  private notifyListeners(isOnline: boolean): void {
    // Callback
    if (this.onTransition) {
      try { this.onTransition(isOnline); } catch { /* ignore */ }
    }

    // Subscribed listeners
    this.listeners.forEach(cb => {
      try { cb(isOnline); } catch { /* ignore */ }
    });
  }
}

// ─── Singleton Instance ─────────────────────────────────────

let monitor: BrowserConnectivityMonitor | null = null;

export function createConnectivityMonitor(
  serverUrl: string,
  options?: ConnectivityOptions
): BrowserConnectivityMonitor {
  if (monitor) {
    monitor.stop();
  }
  monitor = new BrowserConnectivityMonitor(serverUrl, options);
  return monitor;
}

export function getConnectivityMonitor(): BrowserConnectivityMonitor | null {
  return monitor;
}

/**
 * Best available online-ness signal for code outside the monitor.
 *
 * After the monitor has completed its first real health check, prefer its
 * authoritative state (a successful /api/health fetch ground-truths it, even
 * when `navigator.onLine` lies `false` in Chromium VMs / iOS Safari standalone
 * / corporate proxies). Before the first check (monitor just started, or not
 * created at all on routes that don't mount useOfflineMode), fall back to
 * `navigator.onLine` — imperfect but better than nothing.
 *
 * Consumers that directly read `navigator.onLine` to gate expensive or
 * write-touching behaviour (useApi routing, sync scheduler, banners) should
 * use this helper instead so they benefit from the monitor's recovery path.
 */
export function isLikelyOnline(): boolean {
  if (monitor && monitor.hasCompletedFirstCheck) {
    return monitor.isOnline;
  }
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

export { BrowserConnectivityMonitor };
export type { ConnectivityCallback, ConnectivityOptions };
