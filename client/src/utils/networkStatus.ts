// Network status detection
type NetworkCallback = (online: boolean) => void;

const listeners: NetworkCallback[] = [];
let isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

/** Subscribe to network status changes */
export function onNetworkChange(callback: NetworkCallback): () => void {
  listeners.push(callback);
  return () => {
    const idx = listeners.indexOf(callback);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

/** Get current network status */
export function getNetworkStatus(): boolean {
  return isOnline;
}

// Set up listeners
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    isOnline = true;
    listeners.forEach((cb) => cb(true));
  });
  window.addEventListener('offline', () => {
    isOnline = false;
    listeners.forEach((cb) => cb(false));
  });
}
