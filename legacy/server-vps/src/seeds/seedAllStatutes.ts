// ============================================================
// RMPG Flex — Multi-State Statute Seed Orchestrator
// ============================================================
// Seeds all 7 states: UT, CO, WY, ID, NV, AZ, NM
// Uses upsert (ON CONFLICT DO UPDATE) so safe to re-run.
// ============================================================

import { seedStatutes } from './utahStatutes';
import { UTAH_STATUTES } from './utahStatutes';
import { COLORADO_STATUTES } from './coloradoStatutes';
import { WYOMING_STATUTES } from './wyomingStatutes';
import { IDAHO_STATUTES } from './idahoStatutes';
import { NEVADA_STATUTES } from './nevadaStatutes';
import { ARIZONA_STATUTES } from './arizonaStatutes';
import { NEW_MEXICO_STATUTES } from './newMexicoStatutes';

const ALL_STATES = [
  { name: 'Utah',       code: 'UT', statutes: UTAH_STATUTES },
  { name: 'Colorado',   code: 'CO', statutes: COLORADO_STATUTES },
  { name: 'Wyoming',    code: 'WY', statutes: WYOMING_STATUTES },
  { name: 'Idaho',      code: 'ID', statutes: IDAHO_STATUTES },
  { name: 'Nevada',     code: 'NV', statutes: NEVADA_STATUTES },
  { name: 'Arizona',    code: 'AZ', statutes: ARIZONA_STATUTES },
  { name: 'New Mexico', code: 'NM', statutes: NEW_MEXICO_STATUTES },
];

export function seedAllStatutes(db: any): void {
  let totalSeeded = 0;

  for (const state of ALL_STATES) {
    try {
      seedStatutes(db, state.statutes);
      totalSeeded += state.statutes.length;
      console.log(`  ✓ ${state.name} (${state.code}): ${state.statutes.length} statutes`);
    } catch (err: any) {
      console.error(`  ✗ ${state.name} (${state.code}): ${err.message}`);
    }
  }

  console.log(`Seeded/updated ${totalSeeded} statute entries across ${ALL_STATES.length} states.`);
}
