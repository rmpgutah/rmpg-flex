// ============================================================
// Skip Tracer v2 — Source Registry
// ============================================================
// Central registry of all data source adapters. Each source
// is instantiated once and shared across all searches.

import type { DataSource } from '../types';

// --- Import source adapters ---
import OfacSource from './ofac';
import UtahCourtsSource from './utahCourts';
import SlcAssessorSource from './slcAssessor';
import NsopwSource from './nsopw';
import UtahBusinessSource from './utahBusiness';
import UtahDoplSource from './utahDOPL';

/** All registered data source adapters */
const allSources: DataSource[] = [
  new OfacSource(),
  new UtahCourtsSource(),
  new SlcAssessorSource(),
  new NsopwSource(),
  new UtahBusinessSource(),
  new UtahDoplSource(),
];

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
