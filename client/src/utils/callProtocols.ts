// ============================================================
// RMPG Flex — Call Type Protocols (Spillman Flex-style)
// Auto-set priority, flags, and backup requirements based on
// incident type. Reduces dispatcher manual work.
// ============================================================

export interface CallProtocol {
  priority: string;
  flags: Record<string, boolean>;
  requiresBackup: boolean;
  suggestedUnits: number; // How many units to suggest
  emsNeeded: boolean;
  fireNeeded: boolean;
  officerSafety: boolean;
  autoNotes?: string;
}

// ── Protocol Definitions ─────────────────────────────────────

const PROTOCOLS: Record<string, Partial<CallProtocol>> = {
  // P1 — Emergency (immediate threat to life)
  'Shooting': { priority: 'P1', flags: { weapons_involved: true, injuries_reported: true }, requiresBackup: true, suggestedUnits: 3, emsNeeded: true, officerSafety: true },
  'Stabbing': { priority: 'P1', flags: { weapons_involved: true, injuries_reported: true }, requiresBackup: true, suggestedUnits: 2, emsNeeded: true, officerSafety: true },
  'Officer Down': { priority: 'P1', flags: { officer_safety_caution: true }, requiresBackup: true, suggestedUnits: 4, emsNeeded: true, officerSafety: true },
  'Active Shooter': { priority: 'P1', flags: { weapons_involved: true }, requiresBackup: true, suggestedUnits: 5, emsNeeded: true, officerSafety: true },
  'Pursuit': { priority: 'P1', flags: { vehicle_pursuit: true }, requiresBackup: true, suggestedUnits: 3, officerSafety: true },
  'Foot Pursuit': { priority: 'P1', flags: { foot_pursuit: true }, requiresBackup: true, suggestedUnits: 2, officerSafety: true },
  'Structure Fire': { priority: 'P1', requiresBackup: false, suggestedUnits: 1, fireNeeded: true },
  'Bomb Threat': { priority: 'P1', flags: { hazmat: true }, requiresBackup: true, suggestedUnits: 3, fireNeeded: true, officerSafety: true },
  'Hostage': { priority: 'P1', flags: { weapons_involved: true }, requiresBackup: true, suggestedUnits: 4, officerSafety: true },
  'Barricade': { priority: 'P1', flags: { weapons_involved: true }, requiresBackup: true, suggestedUnits: 3, officerSafety: true },

  // P2 — Urgent (potential threat, in-progress)
  'Domestic Violence': { priority: 'P2', flags: { domestic_violence: true }, requiresBackup: true, suggestedUnits: 2, officerSafety: true },
  'DV': { priority: 'P2', flags: { domestic_violence: true }, requiresBackup: true, suggestedUnits: 2, officerSafety: true },
  'Domestic Disturbance': { priority: 'P2', flags: { domestic_violence: true }, requiresBackup: true, suggestedUnits: 2 },
  'Assault': { priority: 'P2', flags: { injuries_reported: true }, requiresBackup: true, suggestedUnits: 2, emsNeeded: true },
  'Assault with Weapon': { priority: 'P1', flags: { weapons_involved: true, injuries_reported: true }, requiresBackup: true, suggestedUnits: 3, emsNeeded: true, officerSafety: true },
  'Robbery': { priority: 'P2', requiresBackup: true, suggestedUnits: 2, officerSafety: true },
  'Armed Robbery': { priority: 'P1', flags: { weapons_involved: true }, requiresBackup: true, suggestedUnits: 3, officerSafety: true },
  'Burglary In Progress': { priority: 'P2', requiresBackup: true, suggestedUnits: 2, officerSafety: true },
  'Burglary': { priority: 'P2', requiresBackup: false, suggestedUnits: 1 },
  'Person with Weapon': { priority: 'P2', flags: { weapons_involved: true }, requiresBackup: true, suggestedUnits: 2, officerSafety: true },
  'Suspicious Person': { priority: 'P3', requiresBackup: false, suggestedUnits: 1 },
  'Suspicious Vehicle': { priority: 'P3', requiresBackup: false, suggestedUnits: 1 },
  'Accident with Injuries': { priority: 'P2', flags: { injuries_reported: true }, requiresBackup: false, suggestedUnits: 1, emsNeeded: true },
  'Hit and Run': { priority: 'P2', requiresBackup: false, suggestedUnits: 1 },
  'DUI': { priority: 'P2', flags: { alcohol_involved: true }, requiresBackup: false, suggestedUnits: 1 },
  'Mental Health Crisis': { priority: 'P2', flags: { mental_health_crisis: true }, requiresBackup: true, suggestedUnits: 2, emsNeeded: true },
  'Suicide Attempt': { priority: 'P1', flags: { mental_health_crisis: true, injuries_reported: true }, requiresBackup: true, suggestedUnits: 2, emsNeeded: true },
  'Drug Activity': { priority: 'P2', flags: { drugs_involved: true }, requiresBackup: true, suggestedUnits: 2 },
  'Sexual Assault': { priority: 'P2', requiresBackup: true, suggestedUnits: 2, officerSafety: true },
  'Kidnapping': { priority: 'P1', requiresBackup: true, suggestedUnits: 3, officerSafety: true },
  'Gang Activity': { priority: 'P2', flags: { gang_related: true }, requiresBackup: true, suggestedUnits: 2, officerSafety: true },
  'K9 Request': { priority: 'P2', flags: { k9_requested: true }, requiresBackup: false, suggestedUnits: 1 },

  // P3 — Routine
  'Theft': { priority: 'P3', requiresBackup: false, suggestedUnits: 1 },
  'Shoplifting': { priority: 'P3', requiresBackup: false, suggestedUnits: 1 },
  'Vandalism': { priority: 'P3', requiresBackup: false, suggestedUnits: 1 },
  'Trespassing': { priority: 'P3', requiresBackup: false, suggestedUnits: 1 },
  'Disturbance': { priority: 'P3', requiresBackup: false, suggestedUnits: 1 },
  'Noise Complaint': { priority: 'P4', requiresBackup: false, suggestedUnits: 1 },
  'Traffic Stop': { priority: 'P3', requiresBackup: false, suggestedUnits: 1 },
  'Traffic Accident': { priority: 'P3', requiresBackup: false, suggestedUnits: 1 },
  'Accident': { priority: 'P3', requiresBackup: false, suggestedUnits: 1 },
  'Welfare Check': { priority: 'P3', requiresBackup: false, suggestedUnits: 1 },
  'Alarm': { priority: 'P3', requiresBackup: false, suggestedUnits: 1 },
  'Alarm Residential': { priority: 'P3', requiresBackup: false, suggestedUnits: 1 },
  'Alarm Commercial': { priority: 'P3', requiresBackup: false, suggestedUnits: 1 },
  'Animal Complaint': { priority: 'P4', requiresBackup: false, suggestedUnits: 1 },
  'Civil Matter': { priority: 'P4', requiresBackup: false, suggestedUnits: 1 },
  'Fraud': { priority: 'P3', requiresBackup: false, suggestedUnits: 1 },

  // P4 — Low priority
  'Parking Complaint': { priority: 'P4', requiresBackup: false, suggestedUnits: 1 },
  'Found Property': { priority: 'P4', requiresBackup: false, suggestedUnits: 1 },
  'Lost Property': { priority: 'P4', requiresBackup: false, suggestedUnits: 1 },
  'Report': { priority: 'P4', requiresBackup: false, suggestedUnits: 1 },
  'Information': { priority: 'P4', requiresBackup: false, suggestedUnits: 1 },
  'Follow-Up': { priority: 'P4', requiresBackup: false, suggestedUnits: 1 },

  // PSO/Security specific
  'PSO Client Request': { priority: 'P3', requiresBackup: false, suggestedUnits: 1 },
  'Process Service': { priority: 'P3', requiresBackup: false, suggestedUnits: 1 },
  'Patrol Request': { priority: 'P3', requiresBackup: false, suggestedUnits: 1 },
  'Escort': { priority: 'P3', requiresBackup: false, suggestedUnits: 1 },
  'Standing Post': { priority: 'P3', requiresBackup: false, suggestedUnits: 1 },
  'Event Security': { priority: 'P3', requiresBackup: false, suggestedUnits: 2 },
};

// ── Fuzzy Match ──────────────────────────────────────────────

function normalizeType(type: string): string {
  return type.toLowerCase().replace(/[_-]/g, ' ').trim();
}

/**
 * Get the protocol for a given incident type.
 * Uses exact match first, then fuzzy partial match.
 */
export function getProtocol(incidentType: string): CallProtocol {
  const defaults: CallProtocol = {
    priority: 'P3',
    flags: {},
    requiresBackup: false,
    suggestedUnits: 1,
    emsNeeded: false,
    fireNeeded: false,
    officerSafety: false,
  };

  if (!incidentType) return defaults;

  // Exact match
  const exact = PROTOCOLS[incidentType];
  if (exact) return { ...defaults, ...exact };

  // Case-insensitive match
  const normalized = normalizeType(incidentType);
  for (const [key, proto] of Object.entries(PROTOCOLS)) {
    if (normalizeType(key) === normalized) {
      return { ...defaults, ...proto };
    }
  }

  // Partial match (incident type contains a known keyword)
  for (const [key, proto] of Object.entries(PROTOCOLS)) {
    if (normalized.includes(normalizeType(key)) || normalizeType(key).includes(normalized)) {
      return { ...defaults, ...proto };
    }
  }

  return defaults;
}

/**
 * Get protocol-suggested auto-notes for a call type.
 * Returns null if no special notes needed.
 */
export function getProtocolNotes(incidentType: string): string | null {
  const proto = getProtocol(incidentType);
  const parts: string[] = [];
  if (proto.requiresBackup) parts.push('PROTOCOL: Backup required');
  if (proto.officerSafety) parts.push('OFFICER SAFETY ALERT');
  if (proto.emsNeeded) parts.push('EMS requested per protocol');
  if (proto.fireNeeded) parts.push('Fire requested per protocol');
  if (proto.suggestedUnits > 2) parts.push(`Protocol suggests ${proto.suggestedUnits} units`);
  return parts.length > 0 ? parts.join(' | ') : null;
}
