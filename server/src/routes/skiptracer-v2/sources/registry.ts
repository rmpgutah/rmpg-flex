// ============================================================
// Skip Tracer v2 — Source Registry (stub)
// ============================================================
// Will be populated as individual source adapters are built.
// For now exports empty arrays so the orchestrator compiles.

import type { DataSource } from '../types';

/** All registered data source adapters */
const allSources: DataSource[] = [];

/** Return every registered source (enabled or not). */
export function getAllSources(): DataSource[] {
  return allSources;
}

/** Return only sources that are both enabled and configured. */
export function getEnabledSources(): DataSource[] {
  return allSources.filter(s => s.isEnabled() && s.isConfigured());
}

/** Register a new source adapter. Called by each adapter module on import. */
export function registerSource(source: DataSource): void {
  allSources.push(source);
}
