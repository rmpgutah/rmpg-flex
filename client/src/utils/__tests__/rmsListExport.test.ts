import { describe, it, expect } from 'vitest';
import {
  tipsToCsv, communityReportsToCsv, crashReportsToCsv, formatRadioLine,
  briefingsToCsv, shiftNotesToCsv, trainingCoursesToCsv,
  unitsBoardToCsv, unitsBoardToTsv, fileListingToCsv,
  agendaToCsv, qaReviewsToCsv, assetsToCsv, errorLogsToCsv, recordingsToCsv,
  modulesToCsv, mutualAidToCsv, plateHistoryToCsv,
  jailBookingsToCsv, partnersToCsv, recruitmentPipelineToCsv, invoicesToCsv,
  victimCasesToCsv, alarmAccountsToCsv, screeningHitsToCsv, warrantDocketToCsv,
  crimeOffensesToCsv, briefingWarrantsToCsv, personIntelXrefsToCsv,
  narcCasesToCsv, pawnItemsToCsv, bulletinsToCsv, animalCasesToCsv, impoundsToCsv,
  accreditationStandardsToCsv, crisisIncidentsToCsv, alertTemplatesToCsv, inmateRosterToCsv,
  communityTipsSafeToCsv, darListToCsv, bodyCamerasToCsv, loginHistoryToCsv, cdocResultsToCsv,
  inboxNotificationsToCsv, codeViolationsToCsv, fiCardsToCsv, courtDocketToCsv, kbHitsToCsv,
  historyTimelineToCsv, dashcamListToCsv, plateSummaryToCsv, towOrdersToCsv,
  docsLibraryToCsv, tasksToCsv, trespassOrdersToCsv, uofReportsToCsv, nationalWarrantsToCsv,
  auditLogsToCsv, evidencePropertyToCsv, specialOpsEquipmentToCsv, connectionSeedsToCsv,
} from '../rmsListExport';

describe('rmsListExport', () => {
  it('redacts anonymous community contact', () => {
    const csv = communityReportsToCsv([{
      tracking_number: 'CR-9', report_type: 'noise', status: 'submitted', location: '400 S',
      anonymous: true, reporter_name: 'Jane Doe', reporter_phone: '8015551212',
      reporter_email: 'jane@example.com', description: 'loud music',
    }]);
    expect(csv).not.toContain('Jane Doe');
    expect(csv).toContain('[anonymous]');
  });

  it('covers crash, radio, agenda, qa, assets, logs, recordings, modules, aid, plates', () => {
    expect(tipsToCsv([{ tracking_number: 'T-1', tip_type: 't', urgency: 'u', status: 's', location: 'l', assigned_to_name: null }])).toContain('T-1');
    expect(crashReportsToCsv([{
      report_number: 'CR-1', crash_date: 'd', location: 'x', crash_type: 't', severity: 's',
      vehicles_involved: 1, injuries: 0, fatalities: 0, status: 'filed',
    }])).toContain('CR-1');
    expect(formatRadioLine({ unit_id: '12A', officer_name: 'Hale', status: 'available', location_description: 'Main' }))
      .toBe('12A available — Hale — Main');
    expect(agendaToCsv([{ source: 'custom', title: 'Brief', date: '2026-08-01' }])).toContain('Brief');
    expect(qaReviewsToCsv([{ id: 9, review_type: 'call_audit', findings: 'ok' }])).toContain('call_audit');
    expect(assetsToCsv([{ asset_tag: 'A-1', serial_number: 'SN9', status: 'issued' }])).toContain('SN9');
    expect(errorLogsToCsv([{ created_at: 't', severity: 'error', category: 'route', message: 'boom', trace_id: 'abc' }])).toContain('abc');
    expect(recordingsToCsv([{ id: 3, started_at: 't', duration_sec: 12, status: 'saved', location_text: '400 S', notes: null }])).toContain('400 S');
    expect(modulesToCsv([{ path: '/qa', label: 'QA' }])).toContain('/qa');
    expect(mutualAidToCsv([{ callNumber: 'C1', nature: 'assist', location: 'x', requestingAgency: 'RMPG', assistingAgencies: ['SLCPD'] }])).toContain('SLCPD');
    expect(plateHistoryToCsv([{ plate: 'ABC123', state: 'UT' }])).toContain('ABC123');
    expect(plateHistoryToCsv([{ plate: 'XYZ', state: 'UT', ts: 1_700_000_000_000 }])).toContain('XYZ');
    expect(jailBookingsToCsv([{ full_name: 'Ada', booking_date: '2026-01-01', charges: 'x', county: 'SL' }])).toContain('Ada');
    expect(partnersToCsv([{ agency_name: 'SLCPD', data_share_level: 'full' }])).toContain('SLCPD');
    const recCsv = recruitmentPipelineToCsv([{ candidate_name: 'Pat', position: 'officer', stage: 'applied', applied_date: '2026-01-01' }]);
    expect(recCsv).toContain('Pat');
    expect(recCsv).not.toContain('email');
    expect(invoicesToCsv([{ invoice_number: 'INV-1', status: 'sent', total_amount: 10, paid_amount: 0 }])).toContain('INV-1');
  });

  it('omits victim contact and alarm phones from CSV', () => {
    const v = victimCasesToCsv([{
      victim_name: 'Pat', case_number: '26-1', crime_type: 'assault', status: 'active',
      safety_plan: 1, protective_order: 0,
    }]);
    expect(v).toContain('26-1');
    expect(v).not.toContain('email');
    expect(v).not.toContain('phone');
    const a = alarmAccountsToCsv([{
      account_number: 'A-9', account_name: 'Shop', address: '400 S', alarm_type: 'burglary',
      permit_status: 'active', status: 'active', false_alarm_count: 2,
    }]);
    expect(a).toContain('A-9');
    expect(a).not.toContain('contact');
  });

  it('omits warrant names and screening display names from CSV', () => {
    const w = warrantDocketToCsv([{ warrant_number: 'W-1', type: 'arrest', status: 'active', issuing_court: '3rd' }]);
    expect(w).toContain('W-1');
    expect(w).not.toContain('name');
    expect(w).not.toContain('dob');
    const h = screeningHitsToCsv([{ id: 4, source_key: 'interpol', match_score: 0.9, status: 'pending' }]);
    expect(h).toContain('interpol');
    expect(h).not.toContain('display');
    expect(crimeOffensesToCsv([{ offense_type: 'theft', count: 3 }])).toContain('theft');
    expect(briefingWarrantsToCsv([{ warrant_number: 'W-2', warrant_type: 'bench', charge: 'FTA' }])).toContain('FTA');
    expect(personIntelXrefsToCsv([{ source: 'FBI_WANTED', externalRef: 'x-1', confidence: 0.8, isCriminal: true }])).toContain('x-1');
  });

  it('omits narcotics notes, pawn seller PII, bulletin suspects, and owner phones', () => {
    const n = narcCasesToCsv([{ case_number: 'N-1', substance: 'meth', status: 'open', location: '400 S' }]);
    expect(n).toContain('N-1');
    expect(n).not.toContain('notes');
    expect(n).not.toContain('subject');
    const p = pawnItemsToCsv([{ shop_name: 'PawnCo', serial_number: 'SN1', item_description: 'TV', status: 'held' }]);
    expect(p).toContain('SN1');
    expect(p).not.toContain('seller');
    expect(p).not.toContain('dob');
    const b = bulletinsToCsv([{ bulletin_number: 'BOLO-1', title: 'Alert', type: 'bolo', priority: 'high', status: 'active' }]);
    expect(b).toContain('BOLO-1');
    expect(b).not.toContain('suspect');
    expect(animalCasesToCsv([{ case_number: 'AC-1', animal_type: 'dog', location: 'Main' }])).toContain('AC-1');
    expect(impoundsToCsv([{ license_plate: 'ABC123', status: 'impounded' }])).toContain('ABC123');
  });

  it('omits crisis subjects, inmate names/DOB, DOC names/DOB, login names, camera officers, DAR narrative, and alert bodies', () => {
    const c = crisisIncidentsToCsv([{
      incident_number: 'CIT-1', incident_type: 'mental_health', location: '400 S', disposition: 'diverted',
    }]);
    expect(c).toContain('CIT-1');
    expect(c).not.toContain('subject');
    expect(c).not.toContain('notes');
    const j = inmateRosterToCsv([{ booking_number: 'BK-1', status: 'housed', housing_unit: 'A', booking_date: '2026-01-01' }]);
    expect(j).toContain('BK-1');
    expect(j).not.toContain('name');
    expect(j).not.toContain('dob');
    const d = cdocResultsToCsv([{ doc_number: '12345', facility: 'CSP', status: 'incarcerated' }]);
    expect(d).toContain('12345');
    expect(d).not.toContain('dob');
    expect(d).not.toContain('first_name');
    expect(loginHistoryToCsv([{ created_at: 't', success: 1, ip_address: '1.2.3.4' }])).not.toContain('full_name');
    expect(bodyCamerasToCsv([{ camera_id: 'CAM-1', make: 'Axon', model: '3', status: 'issued' }])).not.toContain('officer');
    expect(darListToCsv([{ dar_number: 'DAR-1', shift_date: '2026-01-01', status: 'submitted' }])).not.toContain('narrative');
    expect(alertTemplatesToCsv([{ template_name: 'Storm', subject: 'Weather', channel: 'sms', category: 'wx' }])).not.toContain('body');
    expect(accreditationStandardsToCsv([{ standard_number: '1.1', standard_name: 'Use of Force', category: 'ops', compliance_status: 'compliant' }])).toContain('1.1');
    const tip = communityTipsSafeToCsv([{ tip_number: 'T-9', is_anonymous: 1, submitter_name: 'Jane Doe', category: 'noise', location: 'Main', status: 'new', priority: 'low' }]);
    expect(tip).toContain('[anonymous]');
    expect(tip).not.toContain('Jane Doe');
    const inbox = inboxNotificationsToCsv([{ type: 'bolo', title: 'Watch', priority: 'high', is_read: 0, created_at: 't' }]);
    expect(inbox).toContain('Watch');
    expect(inbox).not.toContain('body');
    expect(codeViolationsToCsv([{ violation_number: 'CE-1', violation_type: 'noise', status: 'open', location: 'Main' }])).not.toContain('violator');
    expect(fiCardsToCsv([{ fi_number: 'FI-1', location: '400 S', contact_reason: 'trespass', contact_type: 'field', action_taken: 'warned', status: 'active' }])).not.toContain('subject');
    expect(courtDocketToCsv([{ event_number: 'CT-1', event_type: 'arraignment', status: 'scheduled', event_date: '2026-01-01' }])).not.toContain('defendant');
    expect(kbHitsToCsv([{ type: 'warrant', recordId: 9, route: '/warrants' }])).not.toContain('name');
    expect(historyTimelineToCsv([{ type: 'warrant', date: 'd', reference_number: 'W-1', status: 'active' }])).not.toContain('officer');
    expect(dashcamListToCsv([{ id: 1, classification: 'routine', source: 'upload', recorded_at: 't', case_number: '26-1' }])).not.toContain('officer');
    expect(towOrdersToCsv([{ tow_number: 'TOW-1', status: 'ordered', vehicle_plate: 'ABC123', tow_reason: 'parking' }])).not.toContain('phone');
    expect(plateSummaryToCsv([{ plate: 'XYZ', reads: 3, last_seen: 't', ever_hit: 1 }])).toContain('XYZ');
    expect(trespassOrdersToCsv([{
      order_number: 'TO-1', order_type: 'ban', status: 'active', location: '400 S',
    }])).not.toContain('subject');
    expect(uofReportsToCsv([{ id: 1, incident_number: '26-9', force_type: 'taser', status: 'pending', created_at: 't' }])).not.toContain('narrative');
    expect(nationalWarrantsToCsv([{ id: 'W-9', state: 'UT', warrant_type: 'arrest', status: 'active' }])).not.toContain('name');
    expect(nationalWarrantsToCsv([{ id: 'W-9', state: 'UT', warrant_type: 'arrest', status: 'active' }])).not.toContain('dob');
    expect(auditLogsToCsv([{ action: 'login', entity_type: 'user', entity_id: '3', created_at: 't', badge_number: '42' }])).not.toContain('ip');
    expect(auditLogsToCsv([{ action: 'login', entity_type: 'user', entity_id: '3', created_at: 't' }])).not.toContain('details');
    expect(evidencePropertyToCsv([{ evidence_number: 'EV-1', type: 'weapon', status: 'in_storage' }])).not.toContain('owner');
    expect(specialOpsEquipmentToCsv([{ equipment_type: 'rifle', serial_number: 'SN9', condition: 'ready' }])).not.toContain('assigned');
    expect(connectionSeedsToCsv([{ type: 'person', id: 4 }])).not.toContain('label');
    expect(docsLibraryToCsv([{ id: 1, title: 'SOP', status: 'draft' }])).not.toContain('owner');
    expect(tasksToCsv([{ id: 2, task_title: 'Brief', status: 'pending', priority: 'high' }])).not.toContain('notes');
  });

  it('exports crash reports, briefings, shift notes, and training courses', () => {
    expect(crashReportsToCsv([{
      report_number: 'CR-1', crash_date: '2026-08-01', location: 'Main',
      crash_type: 'rear_end', severity: 'minor_injury', vehicles_involved: 2,
      injuries: 1, fatalities: 0, status: 'filed',
    }])).toContain('CR-1');

    expect(briefingsToCsv([{
      briefing_number: 'B-1', title: 'Day shift', shift_type: 'day',
      created_at: 't', created_by: 'Sgt', acknowledged_count: 3, total_officers: 8,
    }])).toContain('Day shift');

    expect(shiftNotesToCsv([{
      officer_name: 'Hale', content: 'FI stop', visibility: 'supervisor',
      tags: ['FI', 'Patrol'], created_at: 't',
    }])).toContain('FI|Patrol');

    expect(trainingCoursesToCsv([{
      course_name: 'Firearms', course_code: 'FA-1', category: 'firearms',
      duration_hours: 8, location: 'Range', is_mandatory: 1,
    }])).toContain('yes');
  });

  it('formats radio lines and unit board CSV/TSV', () => {
    const unit = {
      unit_id: 'U12', officer_name: 'Hale', badge: '42', status: 'available',
      current_call_number: 'CFS-9', location_description: 'Main St',
    };
    expect(formatRadioLine(unit)).toBe('U12 available — Hale — call CFS-9');
    expect(unitsBoardToCsv([unit])).toContain('U12');
    expect(unitsBoardToTsv([unit]).split('\n')[1]).toContain('\t');
  });

  it('exports file listings', () => {
    expect(fileListingToCsv([{
      name: 'a.log', size: 12, modified: 't', path: '/logs/a.log',
    }])).toContain('/logs/a.log');
  });
});
