// ═══════════════════════════════════════════════════════════════
// Upload with Progress — XHR-based upload with speed/ETA tracking
// ═══════════════════════════════════════════════════════════════

export interface UploadProgress {
  loaded: number;       // bytes uploaded
  total: number;        // total bytes
  percent: number;      // 0-100
  speed: number;        // bytes per second
  eta: number;          // seconds remaining
  phase: 'uploading' | 'processing' | 'done' | 'error';
}

/**
 * Upload a FormData payload via XMLHttpRequest with progress tracking.
 * Uses XHR instead of fetch because fetch doesn't support upload progress events.
 */
export function uploadWithProgress(
  url: string,
  formData: FormData,
  token: string,
  onProgress: (progress: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const startTime = Date.now();

    // Wire up abort signal
    if (signal) {
      if (signal.aborted) {
        onProgress({ loaded: 0, total: 0, percent: 0, speed: 0, eta: 0, phase: 'error' });
        reject(new DOMException('Upload aborted', 'AbortError'));
        return;
      }
      signal.addEventListener('abort', () => {
        xhr.abort();
      });
    }

    // Track upload progress
    xhr.upload.onprogress = (e: ProgressEvent) => {
      if (!e.lengthComputable) return;
      const elapsed = (Date.now() - startTime) / 1000; // seconds
      const speed = elapsed > 0 ? e.loaded / elapsed : 0;
      const remaining = speed > 0 ? (e.total - e.loaded) / speed : 0;
      const percent = Math.round((e.loaded / e.total) * 100);

      onProgress({
        loaded: e.loaded,
        total: e.total,
        percent,
        speed,
        eta: remaining,
        phase: 'uploading',
      });
    };

    // Upload finished sending — server is processing
    xhr.upload.onload = () => {
      onProgress({
        loaded: 0,
        total: 0,
        percent: 100,
        speed: 0,
        eta: 0,
        phase: 'processing',
      });
    };

    // Response received
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress({
          loaded: 0,
          total: 0,
          percent: 100,
          speed: 0,
          eta: 0,
          phase: 'done',
        });
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          resolve(xhr.responseText);
        }
      } else {
        onProgress({ loaded: 0, total: 0, percent: 0, speed: 0, eta: 0, phase: 'error' });
        let message = `Upload failed with status ${xhr.status}`;
        try {
          const errData = JSON.parse(xhr.responseText);
          message = errData.error || errData.message || message;
        } catch { /* use default message */ }
        reject(new Error(message));
      }
    };

    xhr.onerror = () => {
      onProgress({ loaded: 0, total: 0, percent: 0, speed: 0, eta: 0, phase: 'error' });
      reject(new Error('Network error during upload'));
    };

    xhr.onabort = () => {
      onProgress({ loaded: 0, total: 0, percent: 0, speed: 0, eta: 0, phase: 'error' });
      reject(new DOMException('Upload aborted', 'AbortError'));
    };

    xhr.open('POST', url);
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }
    xhr.send(formData);
  });
}

// ─── Format Helpers ──────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

export function formatEta(seconds: number): string {
  if (seconds <= 0 || !isFinite(seconds)) return '< 1s';
  if (seconds < 1) return '< 1s';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}
