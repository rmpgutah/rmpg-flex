// Offline request queue

interface QueuedRequest {
  id: string;
  method: string;
  url: string;
  body?: any;
  timestamp: number;
  retryCount: number;
}

const STORAGE_KEY = 'rmpg_offline_queue';
const MAX_QUEUE_SIZE = 100;
const MAX_RETRIES = 3;

/** Get the offline queue from localStorage */
function getQueue(): QueuedRequest[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/** Save the queue to localStorage */
function saveQueue(queue: QueuedRequest[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE_SIZE)));
  } catch {
    // localStorage full or unavailable
  }
}

/** Add a request to the offline queue */
export function enqueueRequest(method: string, url: string, body?: any): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const queue = getQueue();
  queue.push({ id, method, url, body, timestamp: Date.now(), retryCount: 0 });
  saveQueue(queue);
  return id;
}

/** Process the offline queue (call when back online) */
export async function processQueue(
  fetchFn: (url: string, options: RequestInit) => Promise<Response>
): Promise<{ processed: number; failed: number }> {
  const queue = getQueue();
  if (queue.length === 0) return { processed: 0, failed: 0 };

  let processed = 0;
  let failed = 0;
  const remaining: QueuedRequest[] = [];

  for (const req of queue) {
    try {
      await fetchFn(req.url, {
        method: req.method,
        headers: { 'Content-Type': 'application/json' },
        body: req.body ? JSON.stringify(req.body) : undefined,
      });
      processed++;
    } catch {
      req.retryCount++;
      if (req.retryCount < MAX_RETRIES) {
        remaining.push(req);
      } else {
        failed++;
      }
    }
  }

  saveQueue(remaining);
  return { processed, failed };
}

/** Get the current queue size */
export function getQueueSize(): number {
  return getQueue().length;
}

/** Clear the offline queue */
export function clearQueue(): void {
  localStorage.removeItem(STORAGE_KEY);
}
