// Pure mapping of an inbound MDT signal (a message the officer's phone pushed to
// the in-vehicle terminal) to its desktop toast text, navigation target, and
// toast severity. Extracted from MDTBridge so it's unit-testable and so new
// phone signals (vehicle_oos, alpr_hit, shift_summary, cfs_action, evidence)
// have one obvious place to land.

export interface MDTMsg {
  id: number;
  type: string;
  payload: Record<string, any>;
  created_at: string;
}

export type ToastSeverity = 'success' | 'error' | 'warning' | 'info';

export function describeSignal(m: MDTMsg): string {
  const p = m.payload || {};
  switch (m.type) {
    case 'person': {
      // iOS sends first_name/last_name (ScannedID.toPersonPayload), not a
      // combined `name` field — reading p.name here always came back blank.
      const name = p.name ?? p.full_name ?? [p.first_name, p.last_name].filter(Boolean).join(' ');
      return `📱 Phone → subject: ${name}${p.dob ? ' · DOB ' + p.dob : ''}`.trim();
    }
    case 'plate':
      return `📱 Phone → plate: ${p.plate ?? p.vehicle_plate ?? ''}`;
    case 'location':
      return `📱 Officer location received${p.label ? ': ' + p.label : ''}`;
    case 'nav':
      return '📱 Navigation point from phone';
    case 'draft':
      return `📱 Officer is filing: ${p.title ?? p.workflow ?? 'a report'}`;
    case 'text':
      return `📱 ${p.text ?? 'Message from phone'}`;
    case 'scan':
      return '📱 Phone sent a scan — open DL Search';
    case 'alpr_hit':
      return `🚨 ALPR HIT — ${p.plate || 'plate'}${p.detail ? ': ' + p.detail : ''}`;
    case 'vehicle_oos':
      return `🚗 VEHICLE OUT OF SERVICE${p.defects ? ': ' + p.defects : ''}${p.phase === 'post_trip' ? ' (post-trip)' : ''}`;
    case 'shift_summary':
      return `📋 Shift summary from phone${p.calls != null ? ` · ${p.calls} calls` : ''}${p.miles ? `, ${p.miles} mi` : ''}`;
    case 'cfs_action':
      return `📱 Call action: ${p.label ?? p.action ?? 'updated'}`;
    case 'evidence':
      return `📸 Evidence logged${p.classification ? ' · ' + p.classification : ''}`;
    default:
      return `📱 MDT message (${m.type})`;
  }
}

// The desktop view a phone push should jump to. Same-user channel: the officer
// scanned/looked something up on their phone and wants it on the big screen.
// Only urgent/actionable signals navigate; informational ones just toast.
//
// For person/scan signals, the destination carries the scanned subject as
// DlSearchPage's deep-link query params (?dl=&first=&last=&dob=&state=,
// the same contract its QR-code phone-relay deep link already uses) so the
// MDT opens the full record directly instead of a blank search form the
// operator has to retype the name into. Payload keys match iOS's
// ScannedID.toPersonPayload() shape (first_name, last_name, dob, id_number,
// id_state) — see ios2/RMPGFlexConnect/Sources/CoreIDScan/IDScanModels.swift.
export function routeForSignal(type: string, payload?: Record<string, any>): string | null {
  switch (type) {
    case 'scan':
    case 'person': {
      const p = payload || {};
      const params = new URLSearchParams();
      if (p.id_number) params.set('dl', String(p.id_number));
      if (p.first_name) params.set('first', String(p.first_name));
      if (p.last_name) params.set('last', String(p.last_name));
      if (p.dob) params.set('dob', String(p.dob));
      if (p.id_state) params.set('state', String(p.id_state));
      const qs = params.toString();
      return qs ? `/dl-search?${qs}` : '/dl-search';
    }
    case 'plate':
    case 'alpr_hit':
      return '/ncic';
    case 'location':
    case 'nav':
      return '/map';
    case 'vehicle_oos':
      return '/fleet';
    default:
      return null;
  }
}

export function severityForSignal(type: string): ToastSeverity {
  switch (type) {
    case 'alpr_hit':
    case 'vehicle_oos':
      return 'error';
    default:
      return 'info';
  }
}
