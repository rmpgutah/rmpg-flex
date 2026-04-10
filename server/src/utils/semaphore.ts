// ============================================================
// Simple Semaphore
// ============================================================
// Limits concurrent async operations. Used to cap warrant
// scraper HTTP fetches so boot storms don't exhaust the VPS.
// ============================================================

export class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(permits: number) {
    if (permits < 1) throw new Error('Semaphore requires at least 1 permit');
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise<void>(resolve => { this.queue.push(resolve); });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }

  get available(): number { return this.permits; }
  get waiting(): number { return this.queue.length; }
}
