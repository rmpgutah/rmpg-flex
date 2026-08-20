// ============================================================
// RMPG Flex — Detail popups for OSM overlay features
// ============================================================
// The pipeline now captures every tag OpenStreetMap publishes, so a popup can
// show what openstreetmap.org shows for the same feature. This module renders
// an HTML popup from the structured description in osmFeatureDescription.ts.
//
// Every value is escaped: OSM text is user-generated.
// ============================================================

import {
  describeOsmFeature, type DescribeOptions,
  formatSpeed, formatClearance, formatWeight, formatElevation,
  formatBearing, formatVoltage, formatOsmTimestamp,
} from './osmFeatureDescription';

// Re-exported for back-compat: osmPopup.test.ts and any existing consumer
// import these from here. The implementations now live in the description
// module so the React panel can use them without importing a popup builder.
export {
  formatSpeed, formatClearance, formatWeight, formatElevation,
  formatBearing, formatVoltage, formatOsmTimestamp,
};

export function escapeHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const C = {
  panel: '#0f1a28', border: '#2a3646', title: '#f0f4f9',
  label: '#8a97a6', value: '#d7dee7', muted: '#6b7785', chip: '#c3ccd6',
};

export type OsmPopupOptions = DescribeOptions;

/**
 * Detail popup for one OSM feature. Absent fields are omitted entirely —
 * never rendered as "Unknown", which would imply we looked and found nothing.
 */
export function buildOsmPopupHtml(
  props: Record<string, unknown>,
  opts: OsmPopupOptions = {},
): string {
  const d = describeOsmFeature(props, opts);

  const rows: string[] = d.rows.map((r) =>
    `<div style="display:flex;gap:6px;font-size:10px;line-height:1.5;">`
    + `<span style="color:${C.label};min-width:96px;flex:0 0 auto;">${escapeHtml(r.label)}</span>`
    + `<span style="color:${C.value};">${escapeHtml(r.value)}</span>`
    + `</div>`,
  );

  let html = `<div style="font-family:system-ui,-apple-system,sans-serif;background:${C.panel};`
    + `border:1px solid ${C.border};border-radius:2px;padding:9px 11px;min-width:210px;max-width:320px;">`;
  html += `<div style="color:${C.title};font-weight:700;font-size:12px;margin-bottom:2px;">${escapeHtml(d.title)}</div>`;
  if (d.categoryLabel) {
    html += `<div style="color:${C.chip};font-size:8px;letter-spacing:0.5px;text-transform:uppercase;`
      + `margin-bottom:6px;">${escapeHtml(d.categoryLabel)}</div>`;
  }
  if (rows.length) html += `<div style="display:flex;flex-direction:column;gap:1px;">${rows.join('')}</div>`;

  if (d.extras.length) {
    html += `<div style="margin-top:5px;padding-top:4px;border-top:1px solid ${C.border};">`;
    for (const e of d.extras) {
      html += `<div style="display:flex;gap:6px;font-size:9px;line-height:1.45;">`
        + `<span style="color:${C.muted};min-width:96px;flex:0 0 auto;">${escapeHtml(e.key)}</span>`
        + `<span style="color:${C.label};">${escapeHtml(e.value)}</span></div>`;
    }
    html += `</div>`;
  }

  if (d.coverage) {
    html += `<div style="margin-top:6px;padding-top:5px;border-top:1px solid ${C.border};`
      + `color:${C.muted};font-size:8.5px;line-height:1.4;">${escapeHtml(d.coverage)}</div>`;
  }

  if (d.rmpg.verified || d.rmpg.note || d.rmpg.overriddenFields.length) {
    html += `<div style="margin-top:6px;padding-top:5px;border-top:1px solid ${C.border};">`;
    if (d.rmpg.verified) {
      // The whole point of the edit layer: ground-truthed vs crowd-sourced.
      html += `<div style="color:#22c55e;font-size:9px;font-weight:700;letter-spacing:0.4px;">`
        + `✓ RMPG VERIFIED${d.rmpg.verifiedAt ? ` · ${escapeHtml(d.rmpg.verifiedAt)}` : ''}</div>`;
    }
    if (d.rmpg.note) {
      html += `<div style="color:${C.value};font-size:10px;line-height:1.45;margin-top:2px;">`
        + `${escapeHtml(d.rmpg.note)}</div>`;
    }
    if (d.rmpg.overriddenFields.length) {
      // Name the corrected fields explicitly. Silently showing RMPG's value as
      // if OSM published it would misattribute the data.
      html += `<div style="color:${C.muted};font-size:8px;margin-top:2px;">`
        + `Corrected by RMPG: ${escapeHtml(d.rmpg.overriddenFields.join(', '))}</div>`;
    }
    html += `</div>`;
  }

  html += `<div style="margin-top:5px;color:${C.muted};font-size:8px;">`
    + `Source: OpenStreetMap · extract ${escapeHtml(d.provenance.extractDate)}`;
  if (d.provenance.editedDate) html += ` · edited ${escapeHtml(d.provenance.editedDate)}`;
  html += `</div>`;

  if (d.osmLink) {
    // Deep link to the canonical record. Only possible because the pipeline now
    // stamps the element id; before that every feature was anonymous.
    html += `<div style="margin-top:2px;"><a href="${escapeHtml(d.osmLink.url)}"`
      + ` target="_blank" rel="noopener noreferrer" style="color:${C.chip};font-size:8px;">`
      + `${escapeHtml(d.osmLink.id)} on openstreetmap.org ↗</a></div>`;
  }

  html += `</div>`;
  return html;
}
