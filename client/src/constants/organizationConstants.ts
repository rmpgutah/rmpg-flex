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
