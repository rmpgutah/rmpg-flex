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
  private consecutiveState: number = 0;
  private pendingState: boolean = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private onTransition: ConnectivityCallback | null = null;
  private listeners: Set<ConnectivityCallback> = new Set();

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

    // Start polling
    this.timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        this.check();
      }
    }, this.pollInterval);

    console.log(`[CONNECTIVITY] Monitoring started (poll every ${this.pollInterval / 1000}s)`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
    document.removeEventListener('visibilitychange', this.handleVisibility);

    console.log('[CONNECTIVITY] Monitoring stopped');
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
    console.log('[CONNECTIVITY] Browser online event');
    // Trigger an immediate check to confirm
    this.check();
  }

  private onBrowserOffline(): void {
    console.log('[CONNECTIVITY] Browser offline event');
    // Immediately transition — navigator.onLine is reliable for offline
    if (this.isOnline) {
      this.isOnline = false;
      this.consecutiveState = 0;
      this.pendingState = false;
      console.log('[CONNECTIVITY] State changed: ONLINE -> OFFLINE');
      this.notifyListeners(false);
    }
  }

  private onVisibilityChange(): void {
    if (document.visibilityState === 'visible') {
      // Tab became visible — do an immediate check
      this.check();
    }
  }

  private async check(): Promise<void> {
    const reachable = await this.doHealthCheck();

    if (reachable === this.pendingState) {
      this.consecutiveState++;
    } else {
      this.pendingState = reachable;
      this.consecutiveState = 1;
    }

    // Only transition after stable consecutive checks
    if (this.consecutiveState >= this.stableCount && reachable !== this.isOnline) {
      const wasOnline = this.isOnline;
      this.isOnline = reachable;

      console.log(
        `[CONNECTIVITY] State changed: ${wasOnline ? 'ONLINE' : 'OFFLINE'} -> ${reachable ? 'ONLINE' : 'OFFLINE'}`
      );

      this.notifyListeners(reachable);
    }
  }

  private async doHealthCheck(): Promise<boolean> {
    // Quick fail if browser is offline
    if (!navigator.onLine) return false;

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

export { BrowserConnectivityMonitor };
export type { ConnectivityCallback, ConnectivityOptions };
