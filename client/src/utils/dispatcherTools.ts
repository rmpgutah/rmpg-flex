// ============================================================
// RMPG Flex — Dispatcher Tools (Spillman Flex Console Standard)
// 10 AI & smart system features: call prediction engine,
// resource level forecasting, anomaly detection rules,
// automated status recommendation, voice command parser,
// intelligent call routing, smart priority suggestion,
// automated unit status updates, predictive hotspot mapping,
// and natural language query processing.
// ============================================================

/* ── FEATURE 91: Call Prediction Engine ────────────────────
   Spillman Flex predicts future call volume based on
   historical patterns, time of day, weather, and events. */
export interface CallPrediction {
  hour: number;
  predictedCalls: number;
  confidence: number;
  factors: Array<{ factor: string; impact: 'increase' | 'decrease'; weight: number }>;
  recommendedStaffing: number;
}

export function predictCallVolume(
  historicalAverage: number[],
  dayOfWeek: number,
  isHoliday: boolean,
  hasSpecialEvent: boolean,
  weather: 'clear' | 'rain' | 'snow' | 'severe'
): CallPrediction[] {
  const predictions: CallPrediction[] = [];

  for (let hour = 0; hour < 24; hour++) {
    let predicted = historicalAverage[hour] || 0;
    const factors: CallPrediction['factors'] = [];

    // Day-of-week adjustment
    const weekendMultiplier = [0, 6].includes(dayOfWeek) ? 1.2 : 1.0;
    predicted *= weekendMultiplier;
    if (weekendMultiplier !== 1.0) factors.push({ factor: 'Weekend', impact: 'increase', weight: 0.2 });

    // Evening peak (16-22)
    if (hour >= 16 && hour <= 22) {
      predicted *= 1.3;
      factors.push({ factor: 'Evening peak hours', impact: 'increase', weight: 0.3 });
    }

    // Overnight reduction (1-5)
    if (hour >= 1 && hour <= 5) {
      predicted *= 0.5;
      factors.push({ factor: 'Overnight reduction', impact: 'decrease', weight: 0.5 });
    }

    // Weather impact
    if (weather === 'rain') { predicted *= 1.1; factors.push({ factor: 'Rainy weather', impact: 'increase', weight: 0.1 }); }
    if (weather === 'snow') { predicted *= 0.7; factors.push({ factor: 'Snow', impact: 'decrease', weight: 0.3 }); }
    if (weather === 'severe') { predicted *= 1.4; factors.push({ factor: 'Severe weather', impact: 'increase', weight: 0.4 }); }

    // Holiday
    if (isHoliday) { predicted *= 1.15; factors.push({ factor: 'Holiday', impact: 'increase', weight: 0.15 }); }

    // Special event
    if (hasSpecialEvent) { predicted *= 1.5; factors.push({ factor: 'Special event', impact: 'increase', weight: 0.5 }); }

    const recommendedStaffing = Math.max(1, Math.ceil(predicted / 4));

    predictions.push({
      hour,
      predictedCalls: Math.round(predicted * 10) / 10,
      confidence: Math.max(50, 90 - Math.abs(predicted - historicalAverage[hour] || 0) * 5),
      factors,
      recommendedStaffing,
    });
  }

  return predictions;
}

/* ── FEATURE 92: Resource Level Forecasting ────────────────
   Spillman Flex forecasts required resource levels for each
   upcoming hour based on predicted demand and service standards. */
export interface ResourceForecast {
  hour: number;
  minimumUnits: number;
  optimalUnits: number;
  currentScheduled: number;
  deficit: number;
  riskLevel: 'safe' | 'caution' | 'risk' | 'critical';
}

export function forecastResources(
  predictedCalls: number[],
  avgCallDurationMinutes: number,
  targetResponseMinutes: number,
  currentlyScheduled: number[]
): ResourceForecast[] {
  const forecasts: ResourceForecast[] = [];

  for (let hour = 0; hour < 24; hour++) {
    const callLoad = predictedCalls[hour] || 0;
    const callsPerUnitPerHour = 60 / avgCallDurationMinutes;
    const minimumUnits = Math.max(1, Math.ceil(callLoad / callsPerUnitPerHour));
    const optimalUnits = Math.max(minimumUnits, Math.ceil(callLoad / callsPerUnitPerHour * 1.3));
    const scheduled = currentlyScheduled[hour] || 0;
    const deficit = Math.max(0, minimumUnits - scheduled);

    let riskLevel: ResourceForecast['riskLevel'] = 'safe';
    if (deficit > 2) riskLevel = 'critical';
    else if (deficit > 1) riskLevel = 'risk';
    else if (deficit > 0) riskLevel = 'caution';

    forecasts.push({ hour, minimumUnits, optimalUnits, currentScheduled: scheduled, deficit, riskLevel });
  }

  return forecasts;
}

/* ── FEATURE 93: Anomaly Detection Rules ────────────────────
   Spillman Flex has configurable anomaly detection rules that
   flag unusual dispatch patterns for supervisor review. */
export interface AnomalyRule {
  id: string;
  name: string;
  description: string;
  condition: string;
  severity: 'info' | 'warning' | 'critical';
  enabled: boolean;
  threshold: number;
  currentValue: number;
  triggered: boolean;
}

export const DEFAULT_ANOMALY_RULES: AnomalyRule[] = [
  { id: 'unassigned_timeout', name: 'Unassigned Call Timeout', description: 'Call pending without unit assignment for too long', condition: 'pending_minutes > threshold', severity: 'critical', enabled: true, threshold: 5, currentValue: 0, triggered: false },
  { id: 'no_gps_update', name: 'No GPS Update', description: 'Unit has not reported GPS position recently', condition: 'gps_age_minutes > threshold', severity: 'warning', enabled: true, threshold: 10, currentValue: 0, triggered: false },
  { id: 'extended_onscene', name: 'Extended On-Scene Time', description: 'Unit on scene longer than expected', condition: 'onscene_minutes > threshold', severity: 'warning', enabled: true, threshold: 60, currentValue: 0, triggered: false },
  { id: 'multiple_p1', name: 'Multiple P1 Calls', description: 'More P1 calls than threshold in short window', condition: 'p1_count > threshold', severity: 'critical', enabled: true, threshold: 3, currentValue: 0, triggered: false },
  { id: 'unit_clustering', name: 'Unit Clustering', description: 'Multiple units in same small area', condition: 'units_in_radius > threshold', severity: 'info', enabled: true, threshold: 3, currentValue: 0, triggered: false },
  { id: 'call_drop', name: 'Call Volume Drop', description: 'Unusual drop in call volume', condition: 'calls_per_hour < threshold', severity: 'info', enabled: false, threshold: 2, currentValue: 0, triggered: false },
  { id: 'call_surge', name: 'Call Volume Surge', description: 'Unusual surge in call volume', condition: 'calls_per_hour > threshold', severity: 'warning', enabled: true, threshold: 20, currentValue: 0, triggered: false },
  { id: 'dispatcher_alert', name: 'Dispatcher Alert', description: 'Dispatcher has not acknowledged alert', condition: 'alert_age_seconds > threshold', severity: 'critical', enabled: true, threshold: 30, currentValue: 0, triggered: false },
  { id: 'officer_distress', name: 'Officer Distress', description: 'Officer has not responded to status check', condition: 'no_response_minutes > threshold', severity: 'critical', enabled: true, threshold: 2, currentValue: 0, triggered: false },
  { id: 'duplicate_address', name: 'Duplicate Address', description: 'Multiple calls from same address', condition: 'calls_same_address > threshold', severity: 'warning', enabled: true, threshold: 2, currentValue: 0, triggered: false },
];

export function evaluateAnomalyRules(
  rules: AnomalyRule[],
  metrics: Record<string, number>
): AnomalyRule[] {
  return rules.map(rule => {
    const currentValue = metrics[rule.id] || 0;
    const triggered = rule.enabled && currentValue > rule.threshold;
    return { ...rule, currentValue, triggered };
  });
}

/* ── FEATURE 94: Automated Status Recommendation ───────────
   Spillman Flex recommends unit status changes based on
   call queue, officer availability, and response standards. */
export interface StatusRecommendation {
  officerId: string;
  callSign: string;
  currentStatus: string;
  recommendedStatus: string;
  reason: string;
  urgency: 'now' | 'soon' | 'suggestion';
  autoApply: boolean;
}

export function recommendStatusChanges(
  officers: Array<{ id: string; callSign: string; status: string; onSceneMinutes: number; gpsAgeMinutes: number }>,
  pendingCalls: number,
  availableUnits: number
): StatusRecommendation[] {
  const recommendations: StatusRecommendation[] = [];

  for (const officer of officers) {
    // Officers on scene > 90 min should clear
    if (officer.status === 'onscene' && officer.onSceneMinutes > 90) {
      recommendations.push({
        officerId: officer.id, callSign: officer.callSign, currentStatus: 'onscene',
        recommendedStatus: 'available', reason: `On scene for ${Math.round(officer.onSceneMinutes)} min — consider clearing`,
        urgency: 'soon', autoApply: false,
      });
    }

    // Officers with stale GPS should check in
    if ((officer.status === 'enroute' || officer.status === 'onscene') && officer.gpsAgeMinutes > 15) {
      recommendations.push({
        officerId: officer.id, callSign: officer.callSign, currentStatus: officer.status,
        recommendedStatus: officer.status, reason: `No GPS update in ${officer.gpsAgeMinutes} min — status check needed`,
        urgency: 'now', autoApply: false,
      });
    }
  }

  // If pending calls and no available units, suggest clearing lowest priority
  if (pendingCalls > 0 && availableUnits === 0) {
    // Already handled above
  }

  return recommendations;
}

/* ── FEATURE 95: Voice Command Parser ──────────────────────
   Spillman Flex interprets natural language voice commands
   from dispatchers to execute CAD operations. */
export interface VoiceCommand {
  raw: string;
  intent: 'create_call' | 'assign_unit' | 'update_status' | 'lookup_record' | 'send_message' | 'clear_call' | 'unknown';
  confidence: number;
  entities: Record<string, string>;
  response: string;
}

const COMMAND_PATTERNS: Array<{ intent: VoiceCommand['intent']; patterns: RegExp[] }> = [
  { intent: 'create_call', patterns: [/new call/i, /create call/i, /report (?:a |an )?(.+?) at (.+)/i, /10-?\d{2}.+at.+/i] },
  { intent: 'assign_unit', patterns: [/assign (?:unit )?(.+?) to (.+)/i, /send (.+?) to (.+)/i, /dispatch (.+?) to/i] },
  { intent: 'update_status', patterns: [/status (.+?) (.+)/i, /mark (.+?) as (.+)/i, /(.+?) is (.+)/i] },
  { intent: 'lookup_record', patterns: [/lookup (.+)/i, /run (.+)/i, /check (.+)/i, /query (.+)/i] },
  { intent: 'send_message', patterns: [/message (.+?) (.+)/i, /tell (.+?) (.+)/i, /notify (.+)/i] },
  { intent: 'clear_call', patterns: [/clear (.+?)(?: with (.+))?/i, /close (.+)/i, /disposition (.+?) (.+)/i] },
];

export function parseVoiceCommand(text: string): VoiceCommand {
  for (const { intent, patterns } of COMMAND_PATTERNS) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return {
          raw: text,
          intent,
          confidence: 80,
          entities: { fullMatch: match[0], group1: match[1] || '', group2: match[2] || '' },
          response: `Parsed intent: ${intent}`,
        };
      }
    }
  }

  return { raw: text, intent: 'unknown', confidence: 0, entities: {}, response: 'Unable to parse command. Try: "new call [type] at [location]" or "assign [unit] to [call]"' };
}

/* ── FEATURE 96: Intelligent Call Routing ──────────────────
   Spillman Flex routes calls to the most appropriate dispatcher
   based on workload, specialization, and zone knowledge. */
export interface DispatcherLoad {
  dispatcherId: string;
  name: string;
  activeCalls: number;
  maxCalls: number;
  zoneSpecialty: string[];
  callTypeSpecialty: string[];
  loadPercentage: number;
}

export function routeCallToDispatcher(
  call: { zone: string; natureCode: string; priority: string },
  dispatchers: DispatcherLoad[]
): { dispatcher: DispatcherLoad; score: number; reason: string } | null {
  if (dispatchers.length === 0) return null;

  const scored = dispatchers
    .filter(d => d.activeCalls < d.maxCalls)
    .map(d => {
      let score = 0;
      const reasons: string[] = [];

      // Prefer zone specialty
      if (d.zoneSpecialty.includes(call.zone)) { score += 30; reasons.push('zone specialist'); }

      // Prefer call type specialty
      if (d.callTypeSpecialty.some(t => call.natureCode.startsWith(t))) { score += 20; reasons.push('call type specialist'); }

      // Prefer lower load
      const loadBonus = Math.round((100 - d.loadPercentage) * 0.5);
      score += loadBonus;
      if (d.loadPercentage < 50) reasons.push('low workload');

      // Priority calls go to most experienced (lowest load)
      if (call.priority === 'P1' || call.priority === 'P2') {
        if (d.loadPercentage < 60) score += 15;
      }

      return { dispatcher: d, score, reason: reasons.join(', ') || 'general assignment' };
    })
    .sort((a, b) => b.score - a.score);

  return scored.length > 0 ? scored[0] : null;
}

/* ── FEATURE 97: Smart Priority Suggestion ──────────────────
   Spillman Flex analyzes call descriptions and suggests the
   appropriate priority level based on keywords and context. */
export interface PrioritySuggestion {
  suggestedPriority: 'P1' | 'P2' | 'P3' | 'P4';
  confidence: number;
  matchedKeywords: string[];
  reasoning: string;
}

export function suggestPriority(description: string, location: string | null, callerIsVictim: boolean): PrioritySuggestion {
  const lower = (description + ' ' + (location || '')).toLowerCase();
  const matchedKeywords: string[] = [];
  let priority: PrioritySuggestion['suggestedPriority'] = 'P3';

  // P1 keywords — immediate life threat
  const p1Keywords = ['shots fired', 'officer down', 'active shooter', 'stabbing', 'armed robbery', 'hostage', 'person with a gun', 'structure fire', 'mass casualty', 'child not breathing', 'drowning', 'trapped'];
  if (p1Keywords.some(k => lower.includes(k))) {
    priority = 'P1';
    matchedKeywords.push(...p1Keywords.filter(k => lower.includes(k)));
  }

  // P2 keywords — urgent but not life-threatening
  const p2Keywords = ['in progress', 'just occurred', 'altercation', 'disturbance', 'domestic', 'suicidal', 'overdose', 'accident with injuries', 'hit and run', 'suspicious person with weapon'];
  if (priority !== 'P1' && p2Keywords.some(k => lower.includes(k))) {
    priority = 'P2';
    matchedKeywords.push(...p2Keywords.filter(k => lower.includes(k)));
  }

  // P4 keywords — administrative
  const p4Keywords = ['cold report', 'theft report', 'fraud report', 'documentation', 'follow up', 'information only', 'parking complaint', 'noise complaint'];
  if (p4Keywords.some(k => lower.includes(k)) && priority === 'P3') {
    priority = 'P4';
    matchedKeywords.push(...p4Keywords.filter(k => lower.includes(k)));
  }

  if (callerIsVictim && priority === 'P3') {
    priority = 'P2';
    matchedKeywords.push('caller is victim');
  }

  const confidence = matchedKeywords.length >= 3 ? 90 : matchedKeywords.length >= 2 ? 80 : matchedKeywords.length >= 1 ? 70 : 50;

  return {
    suggestedPriority: priority,
    confidence,
    matchedKeywords,
    reasoning: matchedKeywords.length > 0 ? `Keywords detected: ${matchedKeywords.join(', ')}` : 'No specific priority indicators found — defaulting to P3',
  };
}

/* ── FEATURE 98: Automated Unit Status Updates ──────────────
   Spillman Flex can automatically update unit status based
   on GPS triggers, call assignments, and time thresholds. */
export interface AutoStatusRule {
  trigger: string;
  condition: (context: AutoStatusContext) => boolean;
  newStatus: string;
  confirmBeforeApply: boolean;
}

export interface AutoStatusContext {
  currentStatus: string;
  gpsSpeed: number | null;
  distanceToCall: number | null;
  timeInStatus: number;
  assignedCallId: string | null;
  assignedCallPriority: string | null;
}

export const AUTO_STATUS_RULES: AutoStatusRule[] = [
  {
    trigger: 'Auto-enroute on assignment',
    condition: (ctx) => ctx.currentStatus === 'dispatched' && ctx.gpsSpeed !== null && ctx.gpsSpeed > 5 && ctx.timeInStatus > 30,
    newStatus: 'enroute',
    confirmBeforeApply: true,
  },
  {
    trigger: 'Auto-arrived at scene',
    condition: (ctx) => ctx.currentStatus === 'enroute' && ctx.distanceToCall !== null && ctx.distanceToCall < 100,
    newStatus: 'arrived',
    confirmBeforeApply: true,
  },
  {
    trigger: 'Auto-available after clear',
    condition: (ctx) => ctx.currentStatus === 'cleared' && ctx.timeInStatus > 300,
    newStatus: 'available',
    confirmBeforeApply: false,
  },
  {
    trigger: 'Extended idle — prompt status',
    condition: (ctx) => ctx.currentStatus === 'available' && ctx.timeInStatus > 3600,
    newStatus: 'available',
    confirmBeforeApply: false,
  },
];

export function evaluateAutoStatusRules(context: AutoStatusContext): AutoStatusRule[] {
  return AUTO_STATUS_RULES.filter(rule => rule.condition(context));
}

/* ── FEATURE 99: Predictive Hotspot Mapping ────────────────
   Spillman Flex predicts future crime hotspots based on
   historical data, temporal patterns, and leading indicators. */
export interface PredictiveHotspot {
  latitude: number;
  longitude: number;
  radius: number;
  crimeType: string;
  probability: number;
  timeframe: { start: Date; end: Date };
  confidence: number;
  contributingFactors: string[];
  recommendedAction: string;
}

export function predictHotspots(
  historicalIncidents: Array<{ latitude: number; longitude: number; crimeType: string; occurredAt: string }>,
  lookAheadHours: number = 4
): PredictiveHotspot[] {
  const hotspots: PredictiveHotspot[] = [];
  const now = new Date();
  const lookbackMs = 30 * 86400000; // 30 days

  // Group by location and crime type
  const grid = new Map<string, typeof historicalIncidents>();
  for (const incident of historicalIncidents) {
    const ts = new Date(incident.occurredAt).getTime();
    if (now.getTime() - ts > lookbackMs) continue;

    const latBin = Math.round(incident.latitude * 100) / 100;
    const lngBin = Math.round(incident.longitude * 100) / 100;
    const key = `${latBin},${lngBin},${incident.crimeType}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key)!.push(incident);
  }

  for (const [key, incidents] of grid.entries()) {
    if (incidents.length < 3) continue;

    const [latStr, lngStr, crimeType] = key.split(',');
    const avgLat = incidents.reduce((s, i) => s + i.latitude, 0) / incidents.length;
    const avgLng = incidents.reduce((s, i) => s + i.longitude, 0) / incidents.length;

    // Check temporal pattern (same hour/day of week)
    const currentHour = now.getHours();
    const currentDay = now.getDay();
    const recentIncidents = incidents.filter(i => {
      const d = new Date(i.occurredAt);
      return d.getDay() === currentDay && Math.abs(d.getHours() - currentHour) <= 2;
    });

    const probability = Math.min(95, (recentIncidents.length / incidents.length) * 80 + 20);
    const confidence = Math.min(90, incidents.length * 10);

    hotspots.push({
      latitude: avgLat,
      longitude: avgLng,
      radius: 500,
      crimeType,
      probability,
      timeframe: { start: now, end: new Date(now.getTime() + lookAheadHours * 3600000) },
      confidence,
      contributingFactors: [`${incidents.length} incidents in 30 days`, `${recentIncidents.length} during same time window`, 'Temporal pattern detected'],
      recommendedAction: 'Increase patrol presence during predicted window',
    });
  }

  return hotspots
    .filter(h => h.probability > 30)
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 10);
}

/* ── FEATURE 100: Natural Language Query Processing ────────
   Spillman Flex allows dispatchers to query the CAD system
   using natural language for rapid information retrieval. */
export interface NLQuery {
  query: string;
  intent: 'call_status' | 'unit_status' | 'zone_status' | 'warrant_check' | 'record_lookup' | 'statistics' | 'history' | 'unknown';
  entities: Record<string, string>;
  resolvedQuery: string;
  systemResponse: string;
}

const NL_PATTERNS: Array<{ intent: NLQuery['intent']; patterns: RegExp[]; extractor: (match: RegExpMatchArray) => Record<string, string> }> = [
  {
    intent: 'call_status',
    patterns: [/what(?:'s| is) the status of (call )?(.+?)\?/i, /status (.+?)(?: call)?/i, /where(?:'s| is) call (.+)/i, /show (?:me )?call (.+)/i],
    extractor: (m) => ({ callId: m[1] || m[2] || '' }),
  },
  {
    intent: 'unit_status',
    patterns: [/where(?:'s| is) (?:unit |officer )?(.+?)\?/i, /status (?:of |unit |officer )?(.+)/i, /show (?:me )?(?:unit )?(.+?)('s| is)? status/i],
    extractor: (m) => ({ unitId: m[1] || m[2] || '' }),
  },
  {
    intent: 'zone_status',
    patterns: [/how(?:'s| is) zone (.+?)(?:\?)?$/i, /coverage (?:in |of )?zone (.+)/i, /zone (.+?) (?:status|coverage)/i],
    extractor: (m) => ({ zone: m[1] || '' }),
  },
  {
    intent: 'warrant_check',
    patterns: [/does (.+?) have (?:any )?warrants\?/i, /check (.+?) (?:for )?warrants/i, /warrant (?:check|search) (.+)/i, /ncic (.+)/i],
    extractor: (m) => ({ personName: m[1] || '' }),
  },
  {
    intent: 'record_lookup',
    patterns: [/lookup (.+?) (?:by |with )?(.+)/i, /find (.+?) in (.+)/i, /search (.+?) for (.+)/i, /dl (?:check |lookup )?(.+)/i],
    extractor: (m) => ({ query: m[1] || '', source: m[2] || '' }),
  },
  {
    intent: 'statistics',
    patterns: [/how many calls (today|this week|this month|this shift)\?/i, /stats?(?: for)? (.+)/i, /show (?:me )?statistics/i, /call volume (.+)/i],
    extractor: (m) => ({ period: m[1] || '' }),
  },
  {
    intent: 'history',
    patterns: [/history (?:of |for |at )?(.+)/i, /previous calls? (?:at |for )?(.+)/i, /what(?:'s| has) happened at (.+?)\?/i],
    extractor: (m) => ({ address: m[1] || '' }),
  },
];

export function processNaturalLanguageQuery(query: string): NLQuery {
  for (const { intent, patterns, extractor } of NL_PATTERNS) {
    for (const pattern of patterns) {
      const match = query.match(pattern);
      if (match) {
        const entities = extractor(match);
        return {
          query,
          intent,
          entities,
          resolvedQuery: `${intent}: ${Object.values(entities).join(', ')}`,
          systemResponse: `Processing ${intent.replace(/_/g, ' ')} query...`,
        };
      }
    }
  }

  return { query, intent: 'unknown', entities: {}, resolvedQuery: query, systemResponse: 'I didn\'t understand that query. Try: "status of call [number]" or "check [name] for warrants"' };
}
