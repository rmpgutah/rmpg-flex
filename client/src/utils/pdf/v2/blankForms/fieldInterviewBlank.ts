import type { FormSchema, LabeledField } from '../engine/types';

export type FieldInterviewBlankData = Record<string, never>;

function blankLabeled(label: string): LabeledField<FieldInterviewBlankData> {
  return { kind: 'labeled', label, accessor: () => '', editable: false };
}

export const fieldInterviewBlankSchema: FormSchema<FieldInterviewBlankData> = {
  meta: {
    formNumber: 'PS-211-BLK',
    title: 'FIELD INTERVIEW CARD',
    revision: '2026-04',
  },
  header: { kind: 'default', formId: 'field_interview_blank' },
  watermark: 'blank-form',
  sections: [
    {
      kind: 'section', title: 'CONTACT DETAILS', columns: 3,
      fields: [
        blankLabeled('Date'),
        blankLabeled('Time'),
        blankLabeled('Location'),
        blankLabeled('Contact Reason'),
        blankLabeled('Contact Type'),
        blankLabeled('Action Taken'),
      ],
    },
    {
      kind: 'section', title: 'SUBJECT', columns: 3,
      fields: [
        blankLabeled('First Name'),
        blankLabeled('Last Name'),
        blankLabeled('Date of Birth'),
      ],
    },
    // 4-col physical — split into 2-col section (2 rows of 2).
    {
      kind: 'section', title: 'SUBJECT PHYSICAL', columns: 2,
      fields: [
        blankLabeled('Gender'),
        blankLabeled('Race'),
        blankLabeled('Height'),
        blankLabeled('Weight'),
      ],
    },
    {
      kind: 'section', title: 'SUBJECT APPEARANCE', columns: 3,
      fields: [
        blankLabeled('Hair Color / Style'),
        blankLabeled('Eye Color'),
        blankLabeled('Clothing Description'),
      ],
    },
    {
      kind: 'section', title: 'SUBJECT NOTES', columns: 1,
      fields: [blankLabeled('Additional Physical Description')],
    },
    {
      kind: 'section', title: 'VEHICLE INFORMATION', columns: 2,
      fields: [
        blankLabeled('License Plate'),
        blankLabeled('Vehicle Description'),
      ],
    },
    {
      kind: 'section', title: 'LINKED RECORDS', columns: 3,
      fields: [
        blankLabeled('Person ID'),
        blankLabeled('Call ID'),
        blankLabeled('Incident ID'),
      ],
    },
    {
      kind: 'section', title: 'NARRATIVE', columns: 1,
      fields: [
        {
          kind: 'narrative',
          label: 'Narrative',
          accessor: () => '',
          minLines: 22,
          editable: false,
        },
      ],
    },
    {
      kind: 'section', title: 'SIGNATURES', columns: 1,
      fields: [
        {
          kind: 'signature',
          label: 'Interviewing Officer',
          accessor: () => undefined,
          editable: false,
        },
      ],
    },
  ],
};
