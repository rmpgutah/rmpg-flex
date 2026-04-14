import type { FormSchema, CheckboxField, LabeledField } from '../engine/types';

export type VehicleBlankData = Record<string, never>;

function flag(label: string): CheckboxField<VehicleBlankData> {
  return { kind: 'checkbox', label, accessor: () => false, editable: false };
}

function blankLabeled(label: string): LabeledField<VehicleBlankData> {
  return { kind: 'labeled', label, accessor: () => '', editable: false };
}

export const vehicleBlankSchema: FormSchema<VehicleBlankData> = {
  meta: {
    formNumber: 'FORM PS-207-BLK',
    title: 'VEHICLE RECORD',
    revision: '2026-04',
  },
  header: { kind: 'default', formId: 'vehicle_blank' },
  watermark: 'blank-form',
  sections: [
    {
      kind: 'section', title: 'REGISTRATION', columns: 3,
      fields: [
        blankLabeled('License Plate'),
        blankLabeled('State'),
        blankLabeled('Plate Type'),
        blankLabeled('Make'),
        blankLabeled('Model'),
        blankLabeled('Year'),
      ],
    },
    {
      kind: 'section', title: 'VEHICLE DESCRIPTION', columns: 3,
      fields: [
        blankLabeled('Body Style'),
        blankLabeled('Primary Color'),
        blankLabeled('Secondary Color'),
      ],
    },
    {
      kind: 'section', title: 'VIN', columns: 1,
      fields: [blankLabeled('VIN')],
    },
    {
      kind: 'section', title: 'VEHICLE DETAILS', columns: 3,
      fields: [
        blankLabeled('Doors'),
        blankLabeled('Trim'),
        blankLabeled('Odometer'),
      ],
    },
    // 4-col mechanical — split into 2-col section (2 rows of 2).
    {
      kind: 'section', title: 'MECHANICAL', columns: 2,
      fields: [
        blankLabeled('Engine Type'),
        blankLabeled('Fuel Type'),
        blankLabeled('Transmission'),
        blankLabeled('Drive Type'),
      ],
    },
    // Registration & insurance — 3-col labeled + checkbox row via callback.
    (ctx, data) => {
      ctx.section('REGISTRATION & INSURANCE', (inner) => {
        inner.labeledField(blankLabeled('Registration Expiry'), data);
        inner.labeledField(blankLabeled('Insurance Company'), data);
        inner.labeledField(blankLabeled('Policy Number'), data);
        inner.spacer(1);
        inner.checkboxRow([
          flag('Commercial Vehicle'),
          flag('HAZMAT'),
        ], data);
      });
    },
    {
      kind: 'section', title: 'OWNERSHIP', columns: 3,
      fields: [
        blankLabeled('Owner Address'),
        blankLabeled('Owner Phone'),
        blankLabeled('Lien Holder'),
      ],
    },
    {
      kind: 'section', title: 'TOW INFORMATION', columns: 3,
      fields: [
        blankLabeled('Tow Status'),
        blankLabeled('Tow Company'),
        blankLabeled('Tow Date'),
      ],
    },
    {
      kind: 'section', title: 'STOLEN STATUS', columns: 3,
      fields: [
        blankLabeled('Stolen Status'),
        blankLabeled('Stolen Date'),
        blankLabeled('Recovery Date'),
      ],
    },
    {
      kind: 'section', title: 'DAMAGE & NOTES', columns: 1,
      fields: [
        blankLabeled('Distinguishing Features'),
        {
          kind: 'narrative',
          label: 'Notes',
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
