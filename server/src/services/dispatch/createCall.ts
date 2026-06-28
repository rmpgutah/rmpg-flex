import { generateCallNumber } from '../../utils/caseNumbers';
import { localNow } from '../../utils/timeUtils';
import { identifyBeat } from '../../utils/geofence';
import { computeRiskScore } from '../../utils/riskScoring';
import { createNotification } from '../../routes/notifications';
import { getDb } from '../../models/database';
import {
  getActiveSupervisorIds,
  getCallById,
  getDispatchDistrict,
  getPropertyClientId,
  insertCall,
  insertCallActivityLog,
  updateCallRiskScore,
} from '../../db/dispatchQueries';
import type { CreateDispatchCallInput, DispatchCallRecord, DispatchDomainEvent, DispatchServiceResult } from '../../types/dispatch';

interface CreateDispatchContext {
  userId: number;
  username: string;
  ipAddress: string;
}

interface CreateDispatchResponse {
  call: DispatchCallRecord;
  event: DispatchDomainEvent;
}

function asNumberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function createDispatchCall(
  input: CreateDispatchCallInput,
  context: CreateDispatchContext
): DispatchServiceResult<CreateDispatchResponse> {
  if (!input.incident_type || !input.priority || !input.location_address) {
    return { ok: false, status: 400, error: 'incident_type, priority, and location_address are required' };
  }

  const normalizedPriority = String(input.priority).toUpperCase();
  const callNumber = generateCallNumber(getDb());
  const validStatuses = ['pending', 'dispatched', 'enroute', 'onscene', 'cleared', 'closed', 'cancelled', 'archived'];
  const customStatus = typeof input.status === 'string' ? input.status : undefined;
  const status = customStatus && validStatuses.includes(customStatus) ? customStatus : 'pending';

  let resolvedClientId = asNumberOrNull(input.client_id);
  const propertyId = asNumberOrNull(input.property_id);
  if (!resolvedClientId && propertyId) {
    resolvedClientId = getPropertyClientId(propertyId);
  }

  let autoZoneBeat = (input.zone_beat as string | null | undefined) || null;
  let autoSectionId = (input.section_id as string | null | undefined) || null;
  let autoZoneId = (input.zone_id as string | null | undefined) || null;
  let autoBeatId = (input.beat_id as string | null | undefined) || null;
  let autoDispatchCode: string | null = null;
  let autoSectionName: string | null = null;
  let autoZoneName: string | null = null;
  let autoBeatName: string | null = null;
  let autoBeatDescriptor: string | null = null;

  const latitude = asNumberOrNull(input.latitude);
  const longitude = asNumberOrNull(input.longitude);
  if (latitude && longitude) {
    try {
      const beat = identifyBeat(latitude, longitude);
      if (beat) {
        if (!autoZoneBeat) autoZoneBeat = beat.beat_code;

        const district = getDispatchDistrict(beat.city_code, beat.district_letter) as Record<string, string> | null;
        if (district) {
          if (!autoSectionId) autoSectionId = district.section_id;
          if (!autoZoneId) autoZoneId = district.zone_id;
          if (!autoBeatId) autoBeatId = district.beat_id;
          autoDispatchCode = district.dispatch_code;
          autoSectionName = district.section_name;
          autoZoneName = district.zone_name;
          autoBeatName = district.beat_name;
          autoBeatDescriptor = district.beat_descriptor;
        } else {
          if (!autoBeatId) autoBeatId = beat.beat_id;
          if (!autoZoneId) autoZoneId = `${beat.city} ${beat.district_letter}${beat.beat_number}`;
          if (!autoSectionId) autoSectionId = beat.district_letter;
        }
      }
    } catch {
      // Geofence config is optional for this workflow.
    }
  }

  const callId = insertCall({
    ...input,
    call_number: callNumber,
    priority: normalizedPriority,
    status,
    property_id: propertyId,
    client_id: resolvedClientId,
    latitude,
    longitude,
    dispatcher_id: context.userId,
    zone_beat: autoZoneBeat,
    section_id: autoSectionId,
    zone_id: autoZoneId,
    beat_id: autoBeatId,
    dispatch_code: autoDispatchCode,
    section_name: autoSectionName,
    zone_name: autoZoneName,
    beat_name: autoBeatName,
    beat_descriptor: autoBeatDescriptor,
    created_at_value: typeof input.created_at === 'string' ? input.created_at : null,
    historical_fallback_created_at: localNow(),
    dispatched_at: typeof input.dispatched_at === 'string' ? input.dispatched_at : null,
    enroute_at: typeof input.enroute_at === 'string' ? input.enroute_at : null,
    onscene_at: typeof input.onscene_at === 'string' ? input.onscene_at : null,
    cleared_at: typeof input.cleared_at === 'string' ? input.cleared_at : null,
    closed_at: typeof input.closed_at === 'string' ? input.closed_at : null,
    archived_at: typeof input.archived_at === 'string' ? input.archived_at : null,
    disposition: typeof input.disposition === 'string' ? input.disposition : null,
  });

  const call = getCallById(callId);
  if (!call) {
    return { ok: false, status: 500, error: 'Failed to load created call' };
  }

  const isHistorical = typeof input.created_at === 'string' && input.created_at.length > 0;
  insertCallActivityLog(
    context.userId,
    call.id,
    `${isHistorical ? 'Historical entry: ' : 'Created '}${callNumber}: ${input.incident_type}`,
    context.ipAddress,
  );

  try {
    const riskScore = computeRiskScore(call.id);
    updateCallRiskScore(call.id, riskScore);
    call.risk_score = riskScore;

    if (riskScore >= 80) {
      for (const supervisorId of getActiveSupervisorIds()) {
        createNotification(
          supervisorId,
          'high_risk_call',
          `HIGH RISK Call: ${callNumber}`,
          `Risk score ${riskScore}/100 — ${input.incident_type} at ${input.location_address}`,
          'call',
          call.id,
          'critical',
        );
      }
    }
  } catch (error) {
    console.error('Risk scoring error:', error);
  }

  return {
    ok: true,
    data: {
      call,
      event: {
        type: 'dispatch.call.created',
        payload: { call },
      },
    },
  };
}
