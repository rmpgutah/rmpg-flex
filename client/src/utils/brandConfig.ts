// ============================================================
// RMPG Flex — Brand config (Console Settings → reports/PDFs)
// ============================================================
// Reads the org branding from the system-settings cache
// (systemSettings.ts, populated post-login). Falls back to the
// historical hardcoded identity so pre-load or unconfigured installs
// render exactly as before. Consumed by every PDF generator and the
// PDF header/footer helpers — this is what makes Console Settings →
// Branding actually affect output.
// ============================================================

import { getSystemSetting } from './systemSettings';

export const FALLBACK_AGENCY_NAME = 'ROCKY MOUNTAIN PROTECTIVE GROUP';

/** Uppercased agency name for report headers/footers. */
export function getAgencyName(): string {
  const n = getSystemSetting('agency_name', '');
  return (n || FALLBACK_AGENCY_NAME).toUpperCase();
}

export function getAgencyAddress(): string { return getSystemSetting('agency_address', 'Salt Lake City, Utah'); }
export function getAgencyPhone(): string { return getSystemSetting('agency_phone', ''); }

/**
 * Map the individual Console Settings → Branding keys onto the
 * PdfBranding shape. Only includes keys the admin has set, so it layers
 * cleanly over DEFAULT_PDF_BRANDING without clobbering unset fields.
 */
export function brandingFromSystemSettings(): Record<string, string> {
  const out: Record<string, string> = {};
  const name = getSystemSetting('agency_name', '');
  if (name) out.report_header_text = name.toUpperCase();
  const primary = getSystemSetting('primary_color', '');
  if (primary) out.primary_color = primary;
  const accent = getSystemSetting('accent_color', '');
  if (accent) out.accent_color = accent;
  const classification = getSystemSetting('report_classification', '');
  if (classification) out.default_classification = classification;
  const watermark = getSystemSetting('report_watermark_text', '');
  if (watermark) out.watermark_text = watermark;
  return out;
}
