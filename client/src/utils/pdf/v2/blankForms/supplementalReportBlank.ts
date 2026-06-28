import type { FormSchema, LabeledField, NarrativeField, SignatureField } from '../engine/types';

export type SupplementalReportBlankData = Record<string, never>;

function blankLabeled(label: string): LabeledField<SupplementalReportBlankData> {
  return { kind: 'labeled', label, accessor: () => '', editable: false };
}

export const supplementalReportBlankSchema: FormSchema<SupplementalReportBlankData> = {
  meta: {
    formNumber: 'PS-213-BLK',
    title: 'SUPPLEMENTAL REPORT',
    revision: '2026-06',
  },
  header: { kind: 'default', formId: 'supplemental_report_blank' },
  watermark: 'blank-form',
  sections: [
    {
      kind: 'section', title: 'REFERENCE INFORMATION', columns: 2,
      fields: [
        blankLabeled('Original Report Number'),
        blankLabeled('Supplement Number'),
        blankLabeled('Report Date'),
        blankLabeled('Report Time'),
      ],
    },
    {
      kind: 'section', title: 'REPORTING OFFICER', columns: 2,
      fields: [
        blankLabeled('Officer Name'),
        blankLabeled('Badge Number'),
        blankLabeled('Unit / Assignment'),
        blankLabeled('Radio Call Sign'),
      ],
    },
    {
      kind: 'section', title: 'SUPPLEMENT TYPE', columns: 3,
      fields: [
        blankLabeled('Type'),
        blankLabeled('Priority'),
        blankLabeled('Status'),
      ],
    },
    {
      kind: 'section', title: 'ADDITIONAL SUBJECTS', columns: 2,
      fields: [
        blankLabeled('Subject Name'),
        blankLabeled('Date of Birth'),
        blankLabeled('Role / Involvement'),
        blankLabeled('Statement Taken'),
      ],
    },
    {
      kind: 'section', title: 'ADDITIONAL WITNESSES', columns: 2,
      fields: [
        blankLabeled('Witness Name'),
        blankLabeled('Phone'),
        blankLabeled('Statement Taken'),
        blankLabeled('Statement Type'),
      ],
    },
    {
      kind: 'section', title: 'NEW EVIDENCE', columns: 2,
      fields: [
        blankLabeled('Evidence Type'),
        blankLabeled('Evidence Description'),
        blankLabeled('Collected By'),
        blankLabeled('Collection Date/Time'),
      ],
    },
    {
      kind: 'section', title: 'INVESTIGATION UPDATES', columns: 1,
      fields: [
        blankLabeled('Updated Location'),
        blankLabeled('Updated Suspect Description'),
      ],
    },
    {
      kind: 'section', title: 'NARRATIVE', columns: 1,
      fields: [
        {
          kind: 'narrative',
          label: 'Supplemental Narrative',
          accessor: () => '',
          minLines: 25,
          editable: false,
        } as NarrativeField<SupplementalReportBlankData>,
      ],
    },
    {
      kind: 'section', title: 'SIGNATURES', columns: 1,
      fields: [
        {
          kind: 'signature',
          label: 'Reporting Officer',
          accessor: () => undefined,
          editable: false,
        } as SignatureField<SupplementalReportBlankData>,
        {
          kind: 'signature',
          label: 'Supervisor Review',
          accessor: () => undefined,
          editable: false,
        } as SignatureField<SupplementalReportBlankData>,
      ],
    },
  ],
};
