import type { FormSchema, LabeledField, NarrativeField, SignatureField, CheckboxField } from '../engine/types';

export type ProofOfServiceBlankData = Record<string, never>;

function blankLabeled(label: string): LabeledField<ProofOfServiceBlankData> {
  return { kind: 'labeled', label, accessor: () => '', editable: false };
}

function flag(label: string): CheckboxField<ProofOfServiceBlankData> {
  return { kind: 'checkbox', label, accessor: () => false, editable: false };
}

export const proofOfServiceBlankSchema: FormSchema<ProofOfServiceBlankData> = {
  meta: {
    formNumber: 'PS-212-BLK',
    title: 'AFFIDAVIT OF SERVICE',
    revision: '2026-06',
  },
  header: { kind: 'default', formId: 'proof_of_service_blank' },
  watermark: 'blank-form',
  sections: [
    {
      kind: 'section', title: 'COURT INFORMATION', columns: 2,
      fields: [
        blankLabeled('Court Name'),
        blankLabeled('Case Number'),
        blankLabeled('Jurisdiction'),
        blankLabeled('Court Division'),
      ],
    },
    {
      kind: 'section', title: 'SERVER INFORMATION', columns: 2,
      fields: [
        blankLabeled('Server Name'),
        blankLabeled('Badge / ID Number'),
        blankLabeled('Company'),
        blankLabeled('Phone'),
      ],
    },
    {
      kind: 'section', title: 'RECIPIENT', columns: 1,
      fields: [
        blankLabeled('Recipient Name'),
        blankLabeled('Recipient Address'),
      ],
    },
    {
      kind: 'section', title: 'DOCUMENT SERVED', columns: 1,
      fields: [
        blankLabeled('Document Type'),
        blankLabeled('Document Description'),
      ],
    },
    {
      kind: 'section', title: 'SERVICE DETAILS', columns: 2,
      fields: [
        blankLabeled('Date of Service'),
        blankLabeled('Time of Service'),
        blankLabeled('GPS Latitude'),
        blankLabeled('GPS Longitude'),
      ],
    },
    {
      kind: 'section', title: 'SERVICE METHOD', columns: 3,
      fields: [
        flag('Personal Service'),
        flag('Substitute Service'),
        flag('Posting / Attachment'),
      ],
    },
    {
      kind: 'section', title: 'SUBSTITUTE SERVICE DETAILS', columns: 1,
      visibleIf: () => false,
      fields: [
        blankLabeled('Substitute Name'),
        blankLabeled('Relationship to Recipient'),
        blankLabeled('Description of Substitute'),
      ],
    },
    {
      kind: 'section', title: 'POSTING DETAILS', columns: 1,
      visibleIf: () => false,
      fields: [
        blankLabeled('Location Posted'),
        blankLabeled('Date Posted'),
        blankLabeled('Description of Posting'),
      ],
    },
    {
      kind: 'section', title: 'PHOTOS / EVIDENCE', columns: 2,
      fields: [
        blankLabeled('Photo 1 Description'),
        blankLabeled('Photo 2 Description'),
      ],
    },
    {
      kind: 'section', title: 'NOTES', columns: 1,
      fields: [
        {
          kind: 'narrative',
          label: 'Additional Notes',
          accessor: () => '',
          minLines: 6,
          editable: false,
        } as NarrativeField<ProofOfServiceBlankData>,
      ],
    },
    {
      kind: 'section', title: 'SERVER CERTIFICATION', columns: 1,
      fields: [
        {
          kind: 'narrative',
          label: '',
          accessor: () => '',
          minLines: 4,
          editable: false,
        } as NarrativeField<ProofOfServiceBlankData>,
      ],
    },
    {
      kind: 'section', title: 'SIGNATURES', columns: 2,
      fields: [
        {
          kind: 'signature',
          label: 'Server Signature',
          accessor: () => undefined,
          editable: false,
        } as SignatureField<ProofOfServiceBlankData>,
        {
          kind: 'signature',
          label: 'Notary Public',
          accessor: () => undefined,
          editable: false,
        } as SignatureField<ProofOfServiceBlankData>,
      ],
    },
  ],
};
