/**
 * RMPG Organization Constants
 * Centralized configuration for organizational details (company name, phone, etc.)
 * Used in document generation, notices, and system-wide display.
 *
 * When multiple tenants exist, migrate this to Worker settings row.
 */

export const ORGANIZATION = {
  // Legal entity name
  name: 'Rocky Mountain Protective Group',

  // Main contact phone — used in:
  // - Notice of Attempt to Serve (recipient contact block)
  // - Notice of Communication (dispatch unavailable notice)
  // - Service documents and professional notices
  phone: '(385) 340-6555',
} as const;

/**
 * Subject-facing support channels printed on recipient-facing instruments
 * (Notice of Attempt to Serve). These are the ways a person who finds a
 * notice at their door can reach us WITHOUT calling the individual server.
 *
 * Kept separate from ORGANIZATION because the phone route and URLs are a
 * recipient-support contract, not corporate identity — they can change
 * independently of the legal entity name.
 *
 * NOTE: jsPDF's built-in Helvetica only covers WinAnsi glyphs. Keep these
 * strings free of arrows/box-drawing characters (they render as blanks).
 */
export const SUBJECT_SUPPORT = {
  /** Plain-language explainer a recipient can read before calling. */
  noticeInfoUrl: 'https://rmpgutahps.us/notice-of-attempt',
  /** Online support desk — schedule delivery or ask a question. */
  supportUrl: 'https://rmpgutahps.us/support',
  /** Monitored process-service mailbox. */
  email: 'server@rmpgutah.us',
  /** 24-hour dispatch line (same number as ORGANIZATION.phone). */
  dispatchPhone: '(385) 340-6555',
  /** IVR path to the process-service desk, worded for a printed page. */
  dispatchPhoneRoute: 'press 1, then 1, then 3',
} as const;
