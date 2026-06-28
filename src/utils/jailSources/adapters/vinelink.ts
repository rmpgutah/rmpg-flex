// VINELink statewide jail-lookup adapter (Wave 3a).
// VINELink is a JS/portal application behind anti-automation protections
// that a Cloudflare Worker cannot drive directly. This adapter degrades
// to [] and exists as the wiring point for an authorized API key or an
// external render step. Never throws into the cron.
import type { JailSourceAdapter, JailBooking } from '../types';

export const vinelinkAdapter: JailSourceAdapter = {
  meta: {
    key: 'ut-vinelink', display_name: 'VINELink (statewide jails)',
    county: null, state: 'UT', source_url: 'https://www.vinelink.com/',
    kind: 'portal',
  },
  async fetchRecent(): Promise<JailBooking[]> {
    // Portal kind — not Worker-scrapable without an authorized API/render
    // step. Returns [] so the orchestrator records a clean no-op status.
    return [];
  },
};
