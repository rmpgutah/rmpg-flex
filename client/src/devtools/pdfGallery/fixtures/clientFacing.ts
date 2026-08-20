import type { InvoicePdfData } from '../../../utils/invoicePdfGenerator';
import type { IntakePdfInput } from '../../../utils/documentIntakePdf';
import type { TrainingCertificatePdfInput } from '../../../utils/trainingCertificatePdf';
import type { SkipTraceContext } from '../../../utils/skipTracerReportPdf';
import type { PdfFixture } from '../types';

// Synthetic data only. No real client, invoice, or subject record from
// live data may appear here — organization policy. Realistic commercial/
// contract phrasing is used deliberately (not lorem ipsum) so genuine
// phrase collisions with the placeholder-leak detector surface here
// rather than during a live migration. US units throughout. These
// documents go to paying clients under the company's name, so branding
// is spelled out in full ("Rocky Mountain Protective Group") except
// where space genuinely forbids it.

const MAXIMAL_NAME =
  'Bartholomew Maximilian Fitzgerald-Whitlock Holdings & Associates, LLC, a Utah Limited Liability Company'.padEnd(120, ' ').slice(0, 120);

const BOILERPLATE_SENTENCE =
  'This proposal is valid for 30 days from the date of issue. Services described herein are provided by ' +
  'Rocky Mountain Protective Group under the terms of the executed master services agreement. ';
const MAXIMAL_NARRATIVE = BOILERPLATE_SENTENCE.repeat(Math.ceil(2000 / BOILERPLATE_SENTENCE.length)).slice(0, 2000);

const YEAR_BOUNDARY = '2026-12-31T23:59:00Z';

// ── Invoice (invoicePdfGenerator.ts) ──────────────────────────

function lineItem(i: number): NonNullable<InvoicePdfData['line_items']>[number] {
  return {
    line_type: i % 2 === 0 ? 'service' : 'expense',
    description: `Patrol coverage — Riverton retail corridor, ${i + 1} hr block`,
    quantity: 4,
    unit_price: 62.5,
    amount: 250,
  };
}

export const invoiceFixtures: PdfFixture<InvoicePdfData>[] = [
  {
    variant: 'typical',
    label: 'Standard net-30 invoice with line items and one recorded payment',
    input: {
      invoice_number: 'INV-2026-0417',
      status: 'sent',
      client_name: 'Wasatch Retail Holdings, LLC',
      client_address: '250 Main St, Sandy, UT 84070',
      contact_name: 'Dana Whitlock',
      contact_email: 'dana.whitlock@example-client.test',
      contact_phone: '(801) 555-0142',
      client_code: 'WRH-001',
      tax_id: '87-1234567',
      period_start: '2026-06-01',
      period_end: '2026-06-30',
      issue_date: '2026-07-01',
      due_date: '2026-07-31',
      payment_terms: 'Net 30',
      billing_email: 'ap@example-client.test',
      billing_address: '250 Main St, Sandy, UT 84070',
      subtotal: 4500,
      discount_amount: 0,
      tax_amount: 317.5,
      late_fee_amount: 0,
      total: 4817.5,
      amount_paid: 2000,
      balance_due: 2817.5,
      notes: 'Remit payment to Rocky Mountain Protective Group, 1400 S State St, Salt Lake City, UT 84115.',
      created_by_name: 'Marcus Reyes',
      line_items: [
        { line_type: 'service', description: 'Uniformed patrol — Riverton retail corridor', quantity: 60, unit_price: 62.5, amount: 3750 },
        { line_type: 'service', description: 'ALPR-equipped vehicle rate', quantity: 30, unit_price: 25, amount: 750 },
      ],
      payments: [
        { payment_date: '2026-07-05', amount: 2000, payment_method: 'ACH', reference_number: 'ACH-88213', recorded_by_name: 'Dana Whitlock' },
      ],
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — no line items, no payments, no billing contact',
    input: {
      invoice_number: 'INV-2026-0418',
      status: 'draft',
      period_start: '2026-07-01',
      period_end: '2026-07-31',
      subtotal: 0,
      discount_amount: 0,
      tax_amount: 0,
      late_fee_amount: 0,
      total: 0,
      amount_paid: 0,
      balance_due: 0,
    },
  },
  {
    variant: 'maximal',
    label: '40-row line-item table, 120-char client name, year-boundary period',
    input: {
      invoice_number: 'INV-2026-0419',
      status: 'overdue',
      client_name: MAXIMAL_NAME,
      client_address: '250 Main St, Sandy, UT 84070',
      contact_name: MAXIMAL_NAME,
      contact_email: 'ap@example-client.test',
      contact_phone: '(801) 555-0142',
      client_code: 'WRH-002',
      tax_id: '87-1234567',
      period_start: '2026-12-01',
      period_end: '2026-12-31',
      issue_date: '2026-12-31',
      due_date: YEAR_BOUNDARY.slice(0, 10),
      payment_terms: 'Net 30',
      billing_email: 'ap@example-client.test',
      billing_address: '250 Main St, Sandy, UT 84070',
      subtotal: 10000,
      discount_amount: 250,
      tax_amount: 683.13,
      late_fee_amount: 150,
      total: 10583.13,
      amount_paid: 0,
      balance_due: 10583.13,
      notes: MAXIMAL_NARRATIVE,
      created_by_name: 'Marcus Reyes',
      line_items: Array.from({ length: 40 }, (_, i) => lineItem(i)),
      payments: Array.from({ length: 10 }, (_, i) => ({
        payment_date: '2026-12-31',
        amount: 100,
        payment_method: 'ACH',
        reference_number: `ACH-8821${i}`,
        recorded_by_name: 'Dana Whitlock',
      })),
    },
  },
];

// ── Document Intake (documentIntakePdf.ts) ────────────────────

function intakeField(i: number): IntakePdfInput['fields'][number] {
  return {
    key: `field_${i}`,
    value: `Extracted value ${i}`,
    confidence: 0.6 + (i % 4) * 0.1,
    matchedAnchor: `Anchor ${i}`,
    originalValue: `OCR value ${i}`,
  };
}

export const documentIntakeFixtures: PdfFixture<IntakePdfInput>[] = [
  {
    variant: 'typical',
    label: 'Court warrant intake with several high/medium-confidence fields',
    input: {
      filename: 'warrant-2026-004417.pdf',
      kind: 'court_warrant',
      tier: 'implemented',
      confidence: 0.87,
      pageCount: 3,
      usedOcr: true,
      fields: [
        { key: 'case_number', value: '2026-004417', confidence: 0.95, matchedAnchor: 'Case No.', originalValue: '2026-004417' },
        { key: 'subject_name', value: 'Dana Whitlock', confidence: 0.9, matchedAnchor: 'Defendant', originalValue: 'Dana Whitlock' },
        { key: 'court_name', value: 'Third District Court', confidence: 0.62, matchedAnchor: 'Court', originalValue: '3rd Dist Court' },
      ],
      rawTextPreview: 'STATE OF UTAH, COUNTY OF SALT LAKE — WARRANT OF ARREST, Case No. 2026-004417...',
      courtCategory: 'criminal',
      state: 'UT',
      exportedBy: 'Marcus Reyes',
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — no fields extracted, no raw-text preview',
    input: {
      filename: 'unknown-doc.pdf',
      kind: 'unknown',
      tier: 'stub',
      confidence: 0,
      pageCount: 1,
      usedOcr: false,
      fields: [],
    },
  },
  {
    variant: 'maximal',
    label: '40 extracted fields, 2,000-char raw-text preview, long source filename',
    input: {
      filename: MAXIMAL_NAME.trim() + '.pdf',
      kind: 'fi_card',
      tier: 'implemented',
      confidence: 0.73,
      pageCount: 12,
      usedOcr: true,
      fields: Array.from({ length: 40 }, (_, i) => intakeField(i)),
      rawTextPreview: MAXIMAL_NARRATIVE,
      courtCategory: 'civil',
      state: 'UT',
      exportedBy: MAXIMAL_NAME,
    },
  },
];

// ── Training Certificate (trainingCertificatePdf.ts) ──────────

export const trainingCertificateFixtures: PdfFixture<TrainingCertificatePdfInput>[] = [
  {
    variant: 'typical',
    label: 'Completed course with a matching requirement showing renewal cadence',
    input: {
      record: {
        id: 601,
        officer_id: 42,
        officer_name: 'Marcus Reyes',
        officer_badge: '4417',
        course_name: 'Utah Private Security Officer Certification',
        category: 'certification',
        provider: 'Utah Bureau of Criminal Identification',
        completed_date: '2026-06-01',
        expiry_date: '2028-06-01',
        score: 92,
        hours: 40,
        certificate_number: 'UT-PSO-4417',
        status: 'completed',
      },
      requirement: {
        id: 12,
        course_name: 'Utah Private Security Officer Certification',
        category: 'certification',
        required_for_roles: ['officer', 'supervisor'],
        renewal_period_months: 24,
        minimum_hours: 40,
        is_mandatory: true,
      },
      preparedBy: 'Dana Whitlock',
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — no requirement match, no scores or dates',
    input: {
      record: {},
    },
  },
  {
    variant: 'maximal',
    label: '120-char provider name, long notes, year-boundary completion date',
    input: {
      record: {
        id: 602,
        officer_id: 42,
        officer_name: MAXIMAL_NAME,
        officer_badge: '4417',
        course_name: 'Advanced De-Escalation and Use-of-Force Refresher',
        category: 'use_of_force',
        provider: MAXIMAL_NAME,
        completed_date: '2026-12-31',
        expiry_date: '2027-12-31',
        score: 88,
        hours: 16,
        certificate_number: 'UT-UOF-4417-R2',
        status: 'completed',
        notes: MAXIMAL_NARRATIVE,
        created_at: YEAR_BOUNDARY,
        updated_at: YEAR_BOUNDARY,
      },
      requirement: {
        id: 13,
        course_name: 'Advanced De-Escalation and Use-of-Force Refresher',
        category: 'use_of_force',
        required_for_roles: ['officer', 'supervisor', 'manager'],
        renewal_period_months: 12,
        minimum_hours: 16,
        is_mandatory: true,
        description: MAXIMAL_NARRATIVE,
      },
      preparedBy: MAXIMAL_NAME,
    },
  },
];

// ── Skip Tracer Report (skipTracerReportPdf.ts) ───────────────
// generateSkipTracerReportPdf takes two positional args (subject, ctx),
// not one — the registry's `generate` contract is single-argument, so
// the fixture input bundles both and skipTracerAdapter (registered
// below in registry.ts) unpacks them at the call site rather than
// changing the generator's own signature.

export interface SkipTracerFixtureInput {
  subject: Record<string, unknown>;
  ctx: SkipTraceContext;
}

export const skipTracerReportFixtures: PdfFixture<SkipTracerFixtureInput>[] = [
  {
    variant: 'typical',
    label: 'Name-search subject with phones, emails, and one related record',
    input: {
      subject: {
        name: 'Dana Whitlock',
        personId: 'PID-4417',
        age: '36',
        livesIn: 'Salt Lake City, UT',
        phones: ['(801) 555-0142'],
        emails: ['dana.whitlock@example-subject.test'],
        addresses: ['1400 S State St, Salt Lake City, UT 84115'],
        related: [{ name: 'Alex Kim', relationship: 'associate' }],
      },
      ctx: {
        query: 'Dana Whitlock',
        mode: 'name',
        officerName: 'Marcus Reyes',
        badgeNumber: '4417',
        caseNumber: '2026-004417',
      },
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — unknown subject, no attribution',
    input: {
      subject: {},
      ctx: {
        query: '(801) 555-0199',
        mode: 'phone',
      },
    },
  },
  {
    variant: 'maximal',
    label: '40 related records, 120-char subject name, year-boundary query',
    input: {
      subject: {
        name: MAXIMAL_NAME,
        personId: 'PID-4419',
        age: '61',
        livesIn: 'Sandy, UT',
        phones: Array.from({ length: 5 }, (_, i) => `(801) 555-0${100 + i}`),
        emails: Array.from({ length: 5 }, (_, i) => `contact${i}@example-subject.test`),
        addresses: Array.from({ length: 5 }, (_, i) => `${1400 + i} S State St, Salt Lake City, UT 84115`),
        related: Array.from({ length: 40 }, (_, i) => ({ name: `Associate ${i + 1}`, relationship: 'associate' })),
      },
      ctx: {
        query: MAXIMAL_NAME,
        mode: 'name',
        officerName: MAXIMAL_NAME,
        badgeNumber: '4419',
        caseNumber: '2026-004419',
      },
    },
  },
];

// ── Proposal (proposalPdf.ts — builder) ───────────────────────
// proposalPdf.ts's exports intentionally use `any` for both `proposal`
// and `client` (out of scope to type per the batch brief — inventing an
// interface here would ripple into call sites). Fixtures below are typed
// realistically as plain objects instead.

export interface ProposalFixtureInput {
  proposal: Record<string, unknown>;
  client: Record<string, unknown>;
}

function proposalService(i: number): Record<string, unknown> {
  return {
    description: `Uniformed patrol coverage — phase ${i + 1}`,
    quantity: 1,
    unit_price: 1200.5,
  };
}

export const proposalFixtures: PdfFixture<ProposalFixtureInput>[] = [
  {
    variant: 'typical',
    label: 'Draft proposal with scope of work, terms, and estimated value',
    input: {
      proposal: {
        proposal_number: 'PROP-2026-0417',
        stage: 'sent',
        valid_until: '2026-07-31',
        created_at: '2026-07-01',
        title: 'Retail Corridor Patrol Services Proposal',
        client_name: 'Wasatch Retail Holdings, LLC',
        scope_of_work:
          'Rocky Mountain Protective Group will provide uniformed patrol coverage of the Riverton retail ' +
          'corridor, State of Utah, County of Salt Lake, per the schedule described herein.',
        total_value: 4817.5,
        terms: 'This proposal is valid for 30 days from the date of issue. Net 30 payment terms apply upon acceptance.',
      },
      client: {
        name: 'Wasatch Retail Holdings, LLC',
        address: '250 Main St, Sandy, UT 84070',
        contact_name: 'Dana Whitlock',
        email: 'dana.whitlock@example-client.test',
      },
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — no scope of work, no terms, no client contact',
    input: {
      proposal: {
        proposal_number: 'PROP-2026-0418',
      },
      client: {},
    },
  },
  {
    variant: 'maximal',
    label: '2,000-char scope of work, 120-char title, year-boundary valid-until date',
    input: {
      proposal: {
        proposal_number: 'PROP-2026-0419',
        stage: 'negotiation',
        valid_until: '2026-12-31',
        created_at: YEAR_BOUNDARY,
        title: MAXIMAL_NAME,
        client_name: MAXIMAL_NAME,
        scope_of_work: MAXIMAL_NARRATIVE,
        total_value: 108543.2,
        terms: MAXIMAL_NARRATIVE,
        services: Array.from({ length: 40 }, (_, i) => proposalService(i)),
      },
      client: {
        name: MAXIMAL_NAME,
        address: '250 Main St, Sandy, UT 84070',
        billing_address: '250 Main St, Sandy, UT 84070',
        primary_contact: MAXIMAL_NAME,
        contact_email: 'ap@example-client.test',
      },
    },
  },
];
