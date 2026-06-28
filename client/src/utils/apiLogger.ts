export const MAX_ENTRIES = 100;

export interface LogEntry {
  method: string;
  path: string;
  status: number;
  latencyMs: number;
  timestamp: string;
}

let ringBuffer: LogEntry[] = [];

export function logEntry(entry: Omit<LogEntry, 'timestamp'>): void {
  ringBuffer = [
    { ...entry, timestamp: new Date().toISOString() },
    ...ringBuffer,
  ].slice(0, MAX_ENTRIES);
}

export function getLog(pathPrefix?: string): LogEntry[] {
  if (!pathPrefix) return ringBuffer;
  return ringBuffer.filter(e => e.path.startsWith(pathPrefix));
}

export function clearLog(): void {
  ringBuffer = [];
}
