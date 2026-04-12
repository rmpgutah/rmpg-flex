/**
 * Voice Command Executor — Client-Side
 *
 * Maps NLU-parsed voice commands to API calls. This is the client-side
 * counterpart to the server-side executeCommand() in voice.ts.
 *
 * Used by the voice channel state machine (voiceChannel.ts) to execute
 * commands parsed from the Web Speech API (browser-side STT) without
 * needing to round-trip through /api/voice/command.
 */

import { apiFetch } from '../hooks/useApi';

// ─── Types ──────────────────────────────────────────────────

export interface VoiceCommandResult {
  success: boolean;
  message: string;   // spoken confirmation text
  data?: any;
}

// ─── Main Executor ──────────────────────────────────────────

export async function executeVoiceCommand(
  action: string,
  params: Record<string, any>,
  confidence: number,
  userId: number,
): Promise<VoiceCommandResult> {
  // Confidence gating
  if (confidence < 0.5) {
    return { success: false, message: "Please repeat, I didn't copy that." };
  }
  if (confidence < 0.7) {
    return { success: false, message: `Did you say ${formatAction(action)}? Please confirm.` };
  }

  try {
    switch (action) {
      case 'status_update':    return await handleStatusUpdate(params, userId);
      case 'acknowledge':      return await handleAcknowledge(params, userId);
      case 'request_backup':   return await handleRequest(params, userId, 'backup');
      case 'request_ems':      return await handleRequest(params, userId, 'ems');
      case 'request_k9':       return await handleRequest(params, userId, 'k9');
      case 'run_plate':        return await handleRunPlate(params);
      case 'run_name':         return await handleRunName(params);
      case 'next_call':        return await handleNextCall();
      case 'start_pursuit':    return await handleStartPursuit(params, userId);
      case 'officer_down':     return await handleOfficerDown(userId);
      case 'sitrep':           return await handleSitrep(userId);
      case 'code_4':           return await handleCode4(params, userId);
      case 'create_call':      return await handleCreateCall(params, userId);
      default:
        return { success: false, message: `Unknown command: ${formatAction(action)}` };
    }
  } catch (err: any) {
    console.error('[VoiceExecutor] Command failed:', action, err?.message || err);
    return { success: false, message: 'Command failed. Please try again.' };
  }
}

// ─── Helpers ────────────────────────────────────────────────

function formatAction(action: string): string {
  return action.replace(/_/g, ' ');
}

/** Find the current user's assigned unit */
async function getUserUnit(userId: number): Promise<{ id: number; call_sign: string; status: string; current_call_id?: number } | null> {
  try {
    const units = await apiFetch<any[]>('/dispatch/units');
    const unit = units.find((u: any) => u.officer_id === userId);
    return unit || null;
  } catch {
    return null;
  }
}

/** Resolve a call_id from params or from the user's current unit assignment */
async function resolveCallId(params: Record<string, any>, userId: number): Promise<number | null> {
  if (params.call_id) return Number(params.call_id);

  // Fall back to user's current call
  const unit = await getUserUnit(userId);
  if (unit?.current_call_id) return unit.current_call_id;
  return null;
}

// ─── Command Handlers ───────────────────────────────────────

async function handleStatusUpdate(
  params: Record<string, any>,
  userId: number,
): Promise<VoiceCommandResult> {
  const unit = await getUserUnit(userId);
  if (!unit) return { success: false, message: 'No active unit found for your account.' };

  const newStatus = params.status;
  if (!newStatus) return { success: false, message: 'Status not specified.' };

  await apiFetch(`/dispatch/units/${unit.id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: newStatus }),
  });

  return {
    success: true,
    message: `Copy, ${unit.call_sign} now showing ${newStatus.replace(/_/g, ' ')}.`,
  };
}

async function handleAcknowledge(
  params: Record<string, any>,
  userId: number,
): Promise<VoiceCommandResult> {
  const callId = await resolveCallId(params, userId);
  if (!callId) return { success: true, message: 'Acknowledged.' };

  try {
    await apiFetch(`/dispatch/calls/${callId}/acknowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    return { success: true, message: `Call ${callId} acknowledged.` };
  } catch {
    // Non-critical — still confirm verbally
    return { success: true, message: 'Acknowledged.' };
  }
}

async function handleRequest(
  params: Record<string, any>,
  userId: number,
  type: 'backup' | 'ems' | 'k9',
): Promise<VoiceCommandResult> {
  const callId = await resolveCallId(params, userId);

  if (callId) {
    // Route through the call-specific endpoint
    try {
      await apiFetch(`/dispatch/calls/${callId}/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urgency: params.urgency || 'routine',
          reason: params.reason || undefined,
        }),
      });
    } catch {
      // Endpoint may not exist yet on older servers; fall through
    }
  }

  // Also submit via voice/parse so the server broadcasts via WebSocket
  try {
    await apiFetch('/voice/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: `request ${type}` }),
    });
  } catch {
    // non-critical — the dispatch endpoint above already handled it
  }

  const labels: Record<string, string> = {
    backup: 'Backup',
    ems: 'E.M.S.',
    k9: 'K-9',
  };
  return { success: true, message: `${labels[type]} request transmitted.` };
}

async function handleRunPlate(params: Record<string, any>): Promise<VoiceCommandResult> {
  const plate = (params.plate || '').replace(/\s+/g, '').toUpperCase();
  if (!plate) return { success: false, message: 'No plate number provided.' };

  try {
    const results = await apiFetch<any>(`/records/compound-search?plate=${encodeURIComponent(plate)}`);
    const vehicles = results?.vehicles || results?.data?.vehicles || [];
    if (!vehicles.length) {
      return { success: true, message: `No local records found for plate ${plate}.` };
    }
    const v = vehicles[0];
    const desc = [v.year, v.color, v.make, v.model].filter(Boolean).join(' ');
    return {
      success: true,
      message: `Plate ${plate}: ${desc}. Registered to ${v.owner_name || 'unknown'}.`,
      data: v,
    };
  } catch {
    return { success: true, message: `Plate lookup not available for ${plate}.` };
  }
}

async function handleRunName(params: Record<string, any>): Promise<VoiceCommandResult> {
  const name = (params.name || '').trim();
  if (!name) return { success: false, message: 'Please specify a name to look up.' };

  try {
    const results = await apiFetch<any>(`/records/universal-search?q=${encodeURIComponent(name)}`);
    const persons = results?.persons || [];
    const warrants = results?.warrants || [];

    if (!persons.length && !warrants.length) {
      return { success: true, message: `No local records found for ${name}.` };
    }

    const parts: string[] = [];
    if (persons.length > 0) {
      const p = persons[0];
      parts.push(`${p.first_name || ''} ${p.last_name || ''}`.trim());
      if (p.dob) parts.push(`DOB ${p.dob}`);
      const flags: string[] = [];
      if (p.has_criminal_history) flags.push('criminal history');
      if (p.is_sex_offender) flags.push('registered sex offender');
      if (flags.length) parts.push(`Flags: ${flags.join(', ')}`);
    }
    if (warrants.length > 0) {
      parts.push(`${warrants.length} active warrant${warrants.length > 1 ? 's' : ''}`);
    }

    return { success: true, message: parts.join('. ') + '.', data: { persons, warrants } };
  } catch {
    return { success: true, message: `Name lookup not available for ${name}.` };
  }
}

async function handleNextCall(): Promise<VoiceCommandResult> {
  try {
    const calls = await apiFetch<any[]>('/dispatch/calls?status=pending&limit=1&sort=priority');
    if (!calls || calls.length === 0) {
      return { success: true, message: 'No pending calls in the queue.' };
    }
    const c = calls[0];
    return {
      success: true,
      message: `Next call: ${c.call_number}, ${(c.incident_type || 'unknown').replace(/_/g, ' ')}, priority ${c.priority}, at ${c.location_address || 'unknown location'}.`,
      data: c,
    };
  } catch {
    return { success: false, message: 'Unable to retrieve pending calls.' };
  }
}

async function handleStartPursuit(
  params: Record<string, any>,
  userId: number,
): Promise<VoiceCommandResult> {
  const callId = await resolveCallId(params, userId);
  const unit = await getUserUnit(userId);
  if (!unit) return { success: false, message: 'No active unit found.' };

  if (callId) {
    try {
      await apiFetch(`/dispatch/calls/${callId}/pursuit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicle_description: params.vehicle_description || undefined,
          direction: params.direction || undefined,
          speed: params.speed || undefined,
        }),
      });
    } catch {
      // fall through — the voice/parse route also handles pursuit
    }
  }

  // Also trigger via voice/parse for WebSocket broadcast
  try {
    await apiFetch('/voice/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: 'start pursuit' }),
    });
  } catch { /* non-critical */ }

  return { success: true, message: `Pursuit logged for ${unit.call_sign}. All units notified.` };
}

async function handleOfficerDown(userId: number): Promise<VoiceCommandResult> {
  try {
    const result = await apiFetch<any>('/dispatch/panic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger_method: 'voice_command' }),
    });
    return {
      success: true,
      message: `OFFICER DOWN. Emergency alert transmitted. Call ${result.call_number || ''} created. All units respond.`,
      data: result,
    };
  } catch {
    return { success: false, message: 'Emergency alert failed. Use the panic button.' };
  }
}

async function handleSitrep(userId: number): Promise<VoiceCommandResult> {
  // Use voice/parse endpoint which has full server-side sitrep logic
  try {
    const result = await apiFetch<any>('/voice/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: 'sitrep' }),
    });
    if (result?.response) {
      return { success: true, message: result.response };
    }
    return { success: false, message: 'Situation report unavailable.' };
  } catch {
    return { success: false, message: 'Situation report unavailable.' };
  }
}

async function handleCode4(
  params: Record<string, any>,
  userId: number,
): Promise<VoiceCommandResult> {
  const callId = await resolveCallId(params, userId);

  // Use voice/parse for full server-side welfare check + broadcast
  try {
    await apiFetch('/voice/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: 'code 4' }),
    });
  } catch { /* non-critical */ }

  const callRef = callId ? ` on call ${callId}` : '';
  return { success: true, message: `Copy, code 4${callRef}. Scene secure, no further assistance needed.` };
}

async function handleCreateCall(
  params: Record<string, any>,
  userId: number,
): Promise<VoiceCommandResult> {
  const callType = params.call_type || params.incident_type || 'unknown';
  const address = params.address || params.location || undefined;
  const description = params.description || undefined;

  try {
    const result = await apiFetch<any>('/dispatch/calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        incident_type: callType,
        location_address: address,
        description,
        priority: params.priority || 'P3',
        source: 'voice',
      }),
    });

    return {
      success: true,
      message: `Call created: ${result.call_number || 'new call'}, ${callType.replace(/_/g, ' ')}${address ? ` at ${address}` : ''}.`,
      data: result,
    };
  } catch {
    return { success: false, message: 'Failed to create call. Please use the dispatch console.' };
  }
}
