import type { FormSchema, LabeledField, NarrativeField, SignatureField, CheckboxField } from '../engine/types';

export type EvidenceChainBlankData = Record<string, never>;

function blankLabeled(label: string): LabeledField<EvidenceChainBlankData> {
  return { kind: 'labeled', label, accessor: () => '', editable: false };
}

function flag(label: string): CheckboxField<EvidenceChainBlankData> {
  return { kind: 'checkbox', label, accessor: () => false, editable: false };
}

export const evidenceChainBlankSchema: FormSchema<EvidenceChainBlankData> = {
  meta: {
    formNumber: 'PS-214-BLK',
    title: 'EVIDENCE CHAIN OF CUSTODY',
    revision: '2026-06',
  },
  header: { kind: 'default', formId: 'evidence_chain_blank' },
  watermark: 'blank-form',
  sections: [
    {
      kind: 'section', title: 'CASE INFORMATION', columns: 2,
      fields: [
        blankLabeled('Case Number'),
        blankLabeled('Report Number'),
        blankLabeled('Incident Date'),
        blankLabeled('Officer Name'),
      ],
    },
    {
      kind: 'section', title: 'EVIDENCE IDENTIFICATION', columns: 2,
      fields: [
        blankLabeled('Evidence Item Number'),
        blankLabeled('Evidence Tag Number'),
        blankLabeled('Description'),
        blankLabeled('Evidence Type'),
      ],
    },
    {
      kind: 'section', title: 'EVIDENCE DETAILS', columns: 2,
      fields: [
        blankLabeled('Color'),
        blankLabeled('Condition'),
        blankLabeled('Brand / Make'),
        blankLabeled('Serial Number'),
      ],
    },
    {
      kind: 'section', title: 'COLLECTION INFORMATION', columns: 2,
      fields: [
        blankLabeled('Collected By'),
        blankLabeled('Collection Date'),
        blankLabeled('Collection Time'),
        blankLabeled('Location Found'),
      ],
    },
    {
      kind: 'section', title: 'COLLECTION DETAILS', columns: 2,
      fields: [
        blankLabeled('GPS Latitude'),
        blankLabeled('GPS Longitude'),
        blankLabeled('Photo Reference'),
        blankLabeled('Packaging Type'),
      ],
    },
    {
      kind: 'section', title: 'EVIDENCE CATEGORY', columns: 3,
      fields: [
        flag('Physical Evidence'),
        flag('Biological'),
        flag('Digital Evidence'),
        flag('Documentary'),
        flag('Trace Evidence'),
        flag('Contraband'),
      ],
    },
    {
      kind: 'section', title: 'CUSTODY TRANSFERS', columns: 1,
      fields: [
        blankLabeled('Transferred To'),
        blankLabeled('Transfer Date / Time'),
        blankLabeled('Purpose of Transfer'),
        blankLabeled('Receiving Agency'),
      ],
    },
    {
      kind: 'section', title: 'STORAGE INFORMATION', columns: 2,
      fields: [
        blankLabeled('Storage Location'),
        blankLabeled('Storage Method'),
        blankLabeled('Storage Condition'),
        blankLabeled('Access Restrictions'),
      ],
    },
    {
      kind: 'section', title: 'DISPOSITION', columns: 2,
      fields: [
        blankLabeled('Disposition Method'),
        blankLabeled('Disposition Date'),
        blankLabeled('Authorized By'),
        blankLabeled('Disposition Notes'),
      ],
    },
    {
      kind: 'section', title: 'NOTES', columns: 1,
      fields: [
        {
          kind: 'narrative',
          label: 'Additional Notes',
          accessor: () => '',
          minLines: 8,
          editable: false,
        } as NarrativeField<EvidenceChainBlankData>,
      ],
    },
    {
      kind: 'section', title: 'SIGNATURES', columns: 2,
      fields: [
        {
          kind: 'signature',
          label: 'Collecting Officer',
          accessor: () => undefined,
          editable: false,
        } as SignatureField<EvidenceChainBlankData>,
        {
          kind: 'signature',
          label: 'Evidence Custodian',
          accessor: () => undefined,
          editable: false,
        } as SignatureField<EvidenceChainBlankData>,
      ],
    },
  ],
};
