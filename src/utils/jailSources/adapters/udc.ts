// Utah Dept. of Corrections statewide offender-search adapter (Wave 3a).
// Attempts the UDC offender search endpoint. UDC fronts its search with
// anti-bot protection, so this adapter is written to DEGRADE GRACEFULLY:
// on any non-200 / parse failure it returns [] (the scan orchestrator
// records last_status from the throw-free path). It NEVER throws into the
// cron. When UDC exposes a stable JSON endpoint this is the one place to
// wire it; until then the manual-ingest path carries UDC data.
import type { JailSourceAdapter, JailBooking } from '../types';

export const udcAdapter: JailSourceAdapter = {
  meta: {
    key: 'ut-udc', display_name: 'Utah Dept. of Corrections (statewide)',
    county: null, state: 'UT',
    source_url: 'https://corrections.utah.gov/inmate-services/offender-search/',
    kind: 'json',
  },
  async fetchRecent(): Promise<JailBooking[]> {
    // No stable public JSON endpoint confirmed; probe is best-effort and
    // returns [] rather than scraping HTML that may change without notice.
    // Kept as the wiring point for when an authorized feed is provisioned.
    try {
      const res = await fetch('https://corrections.utah.gov/wp-json/', {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return [];
      // Endpoint exists but exposes no booking feed today — no rows to map.
      return [];
    } catch {
      return [];
    }
  },
};
