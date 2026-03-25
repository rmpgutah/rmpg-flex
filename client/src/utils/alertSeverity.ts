// Alert Severity Classifier
// Classifies dispatch events into minor/moderate/major tiers for the voice alert system.

export type AlertSeverity = 'minor' | 'moderate' | 'major';

export interface CallFlags {
  weapons_involved?: boolean;
  felony_in_progress?: boolean;
  domestic_violence?: boolean;
  mental_health_crisis?: boolean;
  officer_safety_caution?: boolean;
  vehicle_pursuit?: boolean;
  foot_pursuit?: boolean;
  hazmat?: boolean;
  gang_related?: boolean;
  injuries_reported?: boolean;
  ems_requested?: boolean;
  k9_requested?: boolean;
  drugs_involved?: boolean;
  alcohol_involved?: boolean;
  priority?: string;
}

export interface AlertClassification {
  severity: AlertSeverity;
  interrupt: boolean;
  toneRepeats: number;
  urgentVoice: boolean;
}

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  minor: 0,
  moderate: 1,
  major: 2,
};

const MAJOR_EVENTS = new Set([
  'panic_alert',
  'officer_down',
  'active_shooter',
  'shots_fired',
]);

const MODERATE_EVENTS = new Set([
  'bolo_alert',
  'warrant_hit',
  'backup_request',
  'pursuit_update',
  'all_units',
]);

const MINOR_EVENTS = new Set([
  'call_closed',
  'call_cleared',
  'unit_cleared',
  'status_update',
]);

const MODERATE_FLAGS: (keyof CallFlags)[] = [
  'weapons_involved',
  'felony_in_progress',
  'domestic_violence',
  'mental_health_crisis',
  'officer_safety_caution',
  'hazmat',
  'gang_related',
  'injuries_reported',
];

function highest(a: AlertSeverity, b: AlertSeverity): AlertSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

function classifyByEvent(eventType: string): AlertSeverity | null {
  if (MAJOR_EVENTS.has(eventType)) return 'major';
  if (MODERATE_EVENTS.has(eventType)) return 'moderate';
  if (MINOR_EVENTS.has(eventType)) return 'minor';
  return null;
}

function classifyByFlags(call: CallFlags | null | undefined): AlertSeverity {
  if (!call) return 'minor';

  // Major flag combos
  if (call.weapons_involved && call.felony_in_progress) return 'major';
  if (call.vehicle_pursuit) return 'major';
  if (call.foot_pursuit) return 'major';

  // Any moderate flag present
  for (const flag of MODERATE_FLAGS) {
    if (call[flag]) return 'moderate';
  }

  // P1 priority escalates to at least moderate
  if (call.priority === 'P1') return 'moderate';

  return 'minor';
}

function buildClassification(severity: AlertSeverity): AlertClassification {
  switch (severity) {
    case 'major':
      return { severity, interrupt: true, toneRepeats: 3, urgentVoice: true };
    case 'moderate':
      return { severity, interrupt: true, toneRepeats: 1, urgentVoice: false };
    case 'minor':
      return { severity, interrupt: false, toneRepeats: 0, urgentVoice: false };
  }
}

/**
 * Classify a dispatch event into a severity tier.
 * AI override can only escalate, never downgrade.
 */
export function classifySeverity(
  eventType: string,
  call?: CallFlags | null,
  aiSeverityOverride?: AlertSeverity | null,
): AlertClassification {
  // Start with event-type classification, fall back to flag-based
  const eventSeverity = classifyByEvent(eventType);
  const flagSeverity = classifyByFlags(call);

  let severity: AlertSeverity = eventSeverity
    ? highest(eventSeverity, flagSeverity)
    : flagSeverity;

  // P1 priority escalates to at least moderate
  if (call?.priority === 'P1') {
    severity = highest(severity, 'moderate');
  }

  // AI override only escalates
  if (aiSeverityOverride && SEVERITY_RANK[aiSeverityOverride] > SEVERITY_RANK[severity]) {
    severity = aiSeverityOverride;
  }

  return buildClassification(severity);
}

/** Map severity to tone name for the audio system. */
export function getToneForSeverity(severity: AlertSeverity): string {
  switch (severity) {
    case 'minor': return 'info';
    case 'moderate': return 'caution';
    case 'major': return 'alarm';
  }
}

/**
 * Check whether audio should play for the given severity,
 * respecting the user's minimum tier preference in localStorage.
 */
export function shouldPlayAudio(severity: AlertSeverity): boolean {
  try {
    const minTier = localStorage.getItem('rmpg-alert-min-tier') as AlertSeverity | null;
    if (!minTier || !SEVERITY_RANK.hasOwnProperty(minTier)) return true;
    return SEVERITY_RANK[severity] >= SEVERITY_RANK[minTier];
  } catch {
    // localStorage unavailable (SSR, private browsing edge cases)
    return true;
  }
}
