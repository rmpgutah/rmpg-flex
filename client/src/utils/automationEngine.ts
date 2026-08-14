// Pure client-side rule evaluator. No React, no IndexedDB — testable in Node.
// Called from useGpsTracking after every accepted GPS fix.

export interface AutomationRule {
  id: number;
  name: string;
  description: string | null;
  scope: string;
  scope_id: number | null;
  enabled: number;
  trigger_type: string;
  trigger_config: string;
  action_type: string;
  action_config: string;
  dedup_window_ms: number;
  evaluate_client: number;
  evaluate_server: number;
}

export interface ClientGpsFix {
  ts: number;
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  source: string;
}

export interface EvaluatorState {
  lastFired: Record<number, number>; // rule_id → epoch ms last fired
  lastFix: ClientGpsFix | null;
  lastMovedTs: number;               // epoch ms when last meaningful movement
  assignedCallLatLng: { lat: number; lng: number } | null;
}

export interface FiredAction {
  rule: AutomationRule;
  pendingServerAction: boolean;
  localAction?: {
    type: 'notify_officer';
    message: string;
    severity: 'info' | 'warn' | 'critical';
    confirmCallback?: string; // action key for confirm-toast pattern
  };
}

type GeofenceFeature = { polygons: number[][][] };

const CLIENT_LOCAL_ACTIONS = new Set(['notify_officer']);

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseCfg<T>(raw: string): T {
  try { return JSON.parse(raw) as T; } catch { return {} as T; }
}

function matchesTrigger(
  rule: AutomationRule,
  fix: ClientGpsFix,
  state: EvaluatorState,
  geofences: GeofenceFeature[],
): boolean {
  const cfg = parseCfg<Record<string, unknown>>(rule.trigger_config);

  switch (rule.trigger_type) {
    case 'speed_threshold': {
      if (fix.speed === null) return false;
      const threshold = Number(cfg.speed_ms ?? 0);
      return cfg.direction === 'above' ? fix.speed > threshold : fix.speed < threshold;
    }
    case 'no_movement': {
      const threshold = Number(cfg.threshold_ms ?? 0);
      return threshold > 0 && (fix.ts - state.lastMovedTs) > threshold;
    }
    case 'call_proximity': {
      if (!state.assignedCallLatLng) return false;
      const radius = Number(cfg.radius_m ?? 200);
      const dist = haversineM(fix.lat, fix.lng, state.assignedCallLatLng.lat, state.assignedCallLatLng.lng);
      return dist <= radius;
    }
    case 'low_accuracy': {
      if (fix.accuracy === null) return false;
      return fix.accuracy > Number(cfg.threshold_m ?? 100);
    }
    default:
      return false;
  }
}

export function evaluateRules(
  fix: ClientGpsFix,
  rules: AutomationRule[],
  state: EvaluatorState,
  geofences: GeofenceFeature[],
): FiredAction[] {
  const fired: FiredAction[] = [];
  const now = fix.ts;

  for (const rule of rules) {
    if (rule.enabled !== 1 || rule.evaluate_client !== 1) continue;

    const lastFiredAt = state.lastFired[rule.id] ?? 0;
    if (now - lastFiredAt < rule.dedup_window_ms) continue;

    if (!matchesTrigger(rule, fix, state, geofences)) continue;

    // Mark as fired in state (caller must persist this)
    state.lastFired[rule.id] = now;

    const isLocal = CLIENT_LOCAL_ACTIONS.has(rule.action_type);
    const action: FiredAction = {
      rule,
      pendingServerAction: !isLocal,
    };

    if (isLocal) {
      const cfg = parseCfg<{ message?: string; severity?: string }>(rule.action_config);
      action.localAction = {
        type: 'notify_officer',
        message: cfg.message ?? rule.name,
        severity: (cfg.severity as 'info' | 'warn' | 'critical') ?? 'info',
      };
      // call_proximity rules get a confirm callback key for the toast UI
      if (rule.trigger_type === 'call_proximity') {
        action.localAction.confirmCallback = 'mark_on_scene';
      }
    }

    fired.push(action);
  }

  return fired;
}

/** Update movement tracking state in-place. Call before evaluateRules on each fix. */
export function updateMovementState(fix: ClientGpsFix, state: EvaluatorState): void {
  if (state.lastFix) {
    const dist = haversineM(fix.lat, fix.lng, state.lastFix.lat, state.lastFix.lng);
    if (dist > 10) state.lastMovedTs = fix.ts;
  }
  state.lastFix = fix;
}
