// Shared entity-type styling for the Connections graph, used by both
// ConnectionsGraphPanel.tsx (embedded panel) and ConnectionsPage.tsx (full
// investigation canvas). Previously each file kept its own copy of these
// maps, which let fixes in one drift out of sync with the other — see the
// collision history below.

// Entity-type color palette for the d3 force graph. Categorical hues — each
// entity type gets a distinct color so an operator can scan the graph at a
// glance. Historically several collisions silently rendered different
// entity types as the same dot:
//   person + case              both #d4a017 -> case bumped to #84cc16 lime
//   evidence + arrest          both #ef4444 -> arrest bumped to #f43f5e rose
//   incident + business        both #f59e0b -> business bumped to #0ea5e9 sky
//   case + forensic_exhibit    both #84cc16 -> forensic_exhibit bumped to #b45309 amber-700
// This is the LEGITIMATE use of raw hex literals in this codebase: a
// categorical palette where every entry must be distinguishable. The
// semantic --sev-* tokens can't serve here — only 5 tokens vs 19 entity
// types — but the 3 hues that DO match sev (brand gold, sev-warn, sev-
// critical) stay perceptually consistent with the rest of the app.
export const NODE_COLORS: Record<string, string> = {
  person:           '#d4a017', // brand gold (mirrors --brand-gold)
  vehicle:          '#10b981', // emerald
  property:         '#8b5cf6', // violet
  business:         '#0ea5e9', // sky (was #f59e0b — collided with incident)
  evidence:         '#ef4444', // red (mirrors --sev-critical)
  case:             '#84cc16', // lime (was #d4a017 — collided with person)
  incident:         '#f59e0b', // amber (mirrors --sev-warn)
  warrant:          '#dc2626', // darker red — wider use across the app
  citation:         '#fbbf24', // yellow (mirrors --sev-warn-soft)
  arrest:           '#f43f5e', // rose (was #ef4444 — collided with evidence)
  field_interview:  '#64748b', // slate
  trespass_order:   '#a855f7', // purple
  serve_job:        '#14b8a6', // teal
  call:             '#22d3ee', // cyan
  report:           '#ec4899', // pink
  intel_report:     '#e879f9', // fuchsia
  alpr_sighting:    '#06b6d4', // cyan-500 (ALPR plate-camera sightings)
  forensic_case:    '#a3e635', // lime-400
  forensic_exhibit: '#b45309', // amber-700 (was #84cc16 — collided with `case`)
};

export const NODE_RADIUS: Record<string, number> = {
  person: 28, vehicle: 18, property: 18, business: 18, evidence: 16,
  case: 18, incident: 20, warrant: 18, citation: 16,
  arrest: 18, field_interview: 14, trespass_order: 16, serve_job: 16,
  call: 20, report: 14, intel_report: 20, alpr_sighting: 14,
  forensic_case: 18, forensic_exhibit: 14,
};
