// Per-state SOR detail-page enrichment types.
//
// Each adapter is a PURE function: given the raw HTML of a state's public
// offender detail page (already fetched by the runner), extract whatever
// fields the page exposes. Adapters never fetch — that's the runner's job
// (one place to handle timeouts/retries/user-agent, not six).
//
// Parsing is label-driven/tolerant text extraction, not exact CSS selectors
// — these were built without a live HTML sample from any of the 6 target
// states, so precision will need tightening once real pages are captured
// (see raw_snippet on sor_enrichment_runs, meant for exactly that).
//
// Current regex only handles same-line `Label: value` pairs in flat or singly-nested
// tags — table/definition-list layouts (`<th>Label</th><td>value</td>`) are NOT yet
// supported and will return null for those fields; tighten once real page HTML is
// captured (see the design doc).

export interface ParsedEnrichment {
  offense: string | null;
  risk_level: string | null;
  tier: number | null;
  registration_status: string | null;
}

export interface SorEnrichmentAdapter {
  state: string; // 2-letter code, e.g. 'UT'
  parseDetailPage(html: string): ParsedEnrichment;
}
