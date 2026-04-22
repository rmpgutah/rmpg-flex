import type { FormSchema, LabeledField } from '../engine/types';

export type PropertyBlankData = Record<string, never>;

function blankLabeled(label: string): LabeledField<PropertyBlankData> {
  return { kind: 'labeled', label, accessor: () => '', editable: false };
}

export const propertyBlankSchema: FormSchema<PropertyBlankData> = {
  meta: {
    formNumber: 'FORM PS-208-BLK',
    title: 'PROPERTY RECORD',
    revision: '2026-04',
  },
  header: { kind: 'default', formId: 'property_blank' },
  watermark: 'blank-form',
  sections: [
    {
      kind: 'section', title: 'PROPERTY NAME', columns: 1,
      fields: [blankLabeled('Property Name')],
    },
    {
      kind: 'section', title: 'ADDRESS', columns: 1,
      fields: [blankLabeled('Street Address')],
    },
    {
      kind: 'section', title: 'CITY / STATE / ZIP', columns: 3,
      fields: [
        blankLabeled('City'),
        blankLabeled('State'),
        blankLabeled('ZIP'),
      ],
    },
    {
      kind: 'section', title: 'TYPE & CLIENT', columns: 2,
      fields: [
        blankLabeled('Property Type'),
        blankLabeled('Client'),
      ],
    },
    {
      kind: 'section', title: 'COORDINATES', columns: 2,
      fields: [
        blankLabeled('Latitude'),
        blankLabeled('Longitude'),
      ],
    },
    {
      kind: 'section', title: 'SECURITY CODES', columns: 2,
      fields: [
        blankLabeled('Gate Code'),
        blankLabeled('Alarm Code'),
      ],
    },
    {
      kind: 'section', title: 'EMERGENCY CONTACT', columns: 1,
      fields: [blankLabeled('Emergency Contact')],
    },
    {
      kind: 'section', title: 'ACCESS INSTRUCTIONS', columns: 1,
      fields: [blankLabeled('Access Instructions')],
    },
    {
      kind: 'section', title: 'POST ORDERS', columns: 1,
      fields: [
        {
          kind: 'narrative',
          label: 'Post Orders',
          accessor: () => '',
          minLines: 12,
          editable: false,
        },
      ],
    },
    {
      kind: 'section', title: 'HAZARD NOTES', columns: 1,
      fields: [
        {
          kind: 'narrative',
          label: 'Hazard Notes',
          accessor: () => '',
          minLines: 6,
          editable: false,
        },
      ],
    },
    {
      kind: 'section', title: 'ADDITIONAL NOTES', columns: 1,
      fields: [
        {
          kind: 'narrative',
          label: 'Additional Notes',
          accessor: () => '',
          minLines: 8,
          editable: false,
        },
      ],
    },
    {
      kind: 'section', title: 'SIGNATURES', columns: 1,
      fields: [
        {
          kind: 'signature',
          label: 'Recording Officer',
          accessor: () => undefined,
          editable: false,
        },
      ],
    },
  ],
};
