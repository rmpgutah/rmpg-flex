// Jail roster source framework types (Intel Wave 3a).
import type { D1Database } from '@cloudflare/workers-types';

export type JailSourceKind = 'html' | 'json' | 'browser' | 'portal' | 'manual';

export interface JailBooking {
  source_key: string;
  booking_id: string;            // source's stable id (or synthesized)
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  middle_name?: string | null;
  dob?: string | null;
  booking_date?: string | null;
  charges?: string | null;       // free text or '; '-joined
  county?: string | null;
  agency?: string | null;
  mugshot_url?: string | null;
  detail_url?: string | null;
}

export interface JailSourceMeta {
  key: string;
  display_name: string;
  county: string | null;
  state: string;
  source_url: string;
  kind: JailSourceKind;
}

export interface JailSourceAdapter {
  meta: JailSourceMeta;
  // Returns recent bookings, or [] on failure (NEVER throws into the cron —
  // record last_status instead). Browser/portal kinds return [] until an
  // HTML/JSON endpoint or external render step exists.
  fetchRecent(env: { DB: D1Database } & Record<string, unknown>): Promise<JailBooking[]>;
}
