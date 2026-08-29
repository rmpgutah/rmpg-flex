import { describe, it, expect } from 'vitest';
import {
  tipsToCsv, communityReportsToCsv, crashReportsToCsv, formatRadioLine,
  agendaToCsv, qaReviewsToCsv, assetsToCsv, errorLogsToCsv, recordingsToCsv,
  modulesToCsv, mutualAidToCsv, plateHistoryToCsv,
  jailBookingsToCsv, partnersToCsv, recruitmentPipelineToCsv, invoicesToCsv,
  victimCasesToCsv, alarmAccountsToCsv, screeningHitsToCsv, warrantDocketToCsv,
  crimeOffensesToCsv, briefingWarrantsToCsv, personIntelXrefsToCsv,
  narcCasesToCsv, pawnItemsToCsv, bulletinsToCsv, animalCasesToCsv, impoundsToCsv,
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
});
