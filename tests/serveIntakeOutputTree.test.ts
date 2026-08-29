import { describe, it, expect } from 'vitest';
import {
  OUTPUT_TREE_CATALOG_SIZE, inferVenueKind, buildOutputTree, renderOutputTreeNote,
} from '../src/utils/serveIntakeOutputTree';
import { selectWindows } from '../src/utils/serveAttemptWindows';
import type { QueueRow } from '../src/utils/serveIntakeExtract';
import { buildPsoBriefing } from '../src/utils/serveIntakeBriefing';
import type { BriefingInput } from '../src/utils/serveIntakeBriefing';

const bristolRow: QueueRow = {
  recipient_name: 'BRISTOL HOSPICE LLC', recipient_address: '2005 East 2700 South Suite 200',
  recipient_city: 'SALT LAKE CITY', recipient_state: 'UT', recipient_zip: '84109',
  document_type: 'summons', case_number: '2026-015924-CA-01',
  court_name: 'THE CIRCUIT COURT OF THE ELEVENTH JUDICIAL CIRCUIT',
  jurisdiction: 'FL', client_name: 'Cara Kopp', attorney_name: 'Christopher L. DeCort, Esq.',
  priority: 'urgent', deadline: '2026-08-12',
  service_instructions: 'YOU CAN SERVE ANYONE AUTHORIZED TO ACCEPT SERVICE ON BEHALF OF THE COMPANY. DO NOT SERVE ON SUNDAYS.',
  notes: null, plaintiff: 'ODYSSEY HEALTHCARE', defendant: 'BRISTOL HOSPICE LLC',
  court_date: null, sm_job_id: null,
  recipient_phone: null, recipient_dob: null, recipient_type: 'business',
  business_name: 'BRISTOL HOSPICE LLC', registered_agent_name: 'REGISTERED AGENT SOLUTIONS INC',
  registered_office_address: null,
  attorney_phone: null, attorney_email: 'cdecort@jnd-law.com', attorney_bar_number: null,
  serve_type: null, serve_fee: null, time_window: null,
};

describe('output tree catalog', () => {
  it('ships at least 30 named dynamics', () => {
    expect(OUTPUT_TREE_CATALOG_SIZE).toBeGreaterThanOrEqual(30);
  });
});

describe('venue inference', () => {
  it('classifies a hospice LLC as medical/hospice, not a generic office', () => {
    expect(inferVenueKind(
      '2005 East 2700 South Suite 200',
      'BRISTOL HOSPICE LLC',
      '',
    )).toBe('medical_hospice');
  });

  it('classifies a high school as school', () => {
    expect(inferVenueKind('123 Main St', 'East High School', '')).toBe('school');
  });
});

describe('Bristol Hospice operational tree', () => {
  it('fires venue, paper, packet, legal, and timeline branches with a visible tree', () => {
    const tree = buildOutputTree({
      addressClass: 'corporate',
      addressClassConfirmed: false,
      isBusiness: true,
      fields: {
        documents_to_serve: {
          value: '20 DAY SUMMONS; VERIFIED COMPLAINT; PLAINTIFF\'S MOTION FOR EX-PARTE TEMPORARY INJUNCTION; ORDER TO SERVE; EXPEDITED DISCOVERY',
          confidence: 1,
        },
      },
      queueRow: bristolRow,
      agentName: 'REGISTERED AGENT SOLUTIONS INC',
      fullLocation: '2005 East 2700 South Suite 200, Salt Lake City, UT 84109',
      docCount: 3,
      nowIso: '2026-08-12T08:26:06Z',
    });
    expect(tree.venue).toBe('medical_hospice');
    expect(tree.firedIds).toContain('venue.medical_hospice');
    expect(tree.firedIds).toContain('paper.summons_complaint');
    expect(tree.firedIds).toContain('paper.injunction');
    expect(tree.firedIds).toContain('packet.multi_document');
    expect(tree.firedIds).toContain('legal.no_sunday');
    expect(tree.firedIds).toContain('legal.broad_acceptors');
    expect(
      tree.firedIds.some((id) => id === 'timeline.same_day' || id === 'timeline.past_due' || id === 'timeline.escalated_priority'),
    ).toBe(true);
    expect(tree.features.length).toBeGreaterThanOrEqual(8);
    const md = renderOutputTreeNote(tree);
    expect(md).toContain('OUTPUT TREE');
    expect(md).toContain('├─ Medical / Hospice');
    expect(md).toContain('Check in at reception');
  });

  it('does not dump unfired catalog rules into the officer note', () => {
    const tree = buildOutputTree({
      addressClass: 'residential',
      isBusiness: false,
      fields: {},
      queueRow: {
        ...bristolRow,
        recipient_name: 'DANA WHITFIELD', recipient_type: 'individual',
        document_type: 'subpoena', service_instructions: null, deadline: null,
        priority: 'routine', plaintiff: 'A', defendant: 'B',
      },
      agentName: '',
      fullLocation: '1180 E Vine St',
      docCount: 1,
      nowIso: '2026-06-20T12:00:00Z',
    });
    const md = renderOutputTreeNote(tree);
    expect(md).not.toContain('venue.military');
    expect(md).not.toContain('Nursing / Assisted Living');
  });
});

describe('venue window overlay', () => {
  it('uses hospice admin hours on a corporate hospice job, not residential evenings', () => {
    const out = selectWindows({
      addressClass: 'corporate',
      addressClassConfirmed: false,
      clientBands: [],
      locationNote: null,
      venueKind: 'medical_hospice',
    });
    expect(out.every((w) => w.authority === 'venue default')).toBe(true);
    expect(out.map((w) => w.window)).toEqual(['09:30-11:30', '13:30-16:00']);
    expect(out.some((w) => w.window === '17:00-20:30')).toBe(false);
  });

  it('never applies venue overlay to shrink a residence (D-2)', () => {
    const out = selectWindows({
      addressClass: 'residential',
      clientBands: [],
      locationNote: null,
      venueKind: 'warehouse',
    });
    expect(out.every((w) => w.authority === 'residential default')).toBe(true);
  });
});

describe('OPS note is in the briefing feed', () => {
  it('files an OPS playbook between INTAKE and DISPATCH', () => {
    const input: BriefingInput = {
      fields: {
        documents_to_serve: { value: 'SUMMONS; COMPLAINT', confidence: 1 },
      },
      queueRow: bristolRow,
      isBusiness: true,
      agentName: 'REGISTERED AGENT SOLUTIONS INC',
      fullLocation: '2005 East 2700 South Suite 200, Salt Lake City, UT 84109',
      docCount: 3,
      addressClass: 'corporate',
    };
    const b = buildPsoBriefing(input, '2026-08-12T08:26:06Z');
    expect(b.notes.map((n) => n.author)).toContain('OPS');
    const ops = b.notes.find((n) => n.author === 'OPS')!;
    expect(ops.text).toContain('Medical / Hospice');
    expect(ops.text).toContain('Dynamics fired:');
  });
});
