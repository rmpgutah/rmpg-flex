/** Tracks consecutive tile-load error timestamps and decides when the map
 *  should be considered "degraded" (fallback backdrop should show). */
export class TileFailureTracker {
  private firstErrorAt: number | null = null;
  constructor(private readonly degradedAfterMs: number = 5000) {}

  recordError(nowMs: number): void {
    if (this.firstErrorAt === null) this.firstErrorAt = nowMs;
  }

  recordSuccess(): void {
    this.firstErrorAt = null;
  }

  isDegraded(nowMs: number): boolean {
    if (this.firstErrorAt === null) return false;
    return nowMs - this.firstErrorAt >= this.degradedAfterMs;
  }
}
