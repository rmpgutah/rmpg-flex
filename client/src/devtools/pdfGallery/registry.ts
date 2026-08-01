import { generateTrespassOrderPdf } from '../../utils/trespassOrderPdf';
import { generateCriminalHistoryPdf } from '../../utils/criminalHistoryPdf';
import { generateCourtAppearancePdf } from '../../utils/courtAppearancePdf';
import {
  trespassOrderFixtures,
  criminalHistoryFixtures,
  courtAppearanceFixtures,
} from './fixtures/courtLegal';
import { generateEquipmentCustodyPdf } from '../../utils/equipmentCustodyPdf';
import { generateEvidenceItemPdf } from '../../utils/evidenceItemPdf';
import { generateBodycamVideoCustodyPdf } from '../../utils/bodycamVideoCustodyPdf';
import { generateForensicCasePdf } from '../../utils/forensicCasePdf';
import {
  generateJailBookingSheetPdf,
  generateJailRosterSnapshotPdf,
} from '../../utils/jailBookingSheetPdf';
import {
  equipmentCustodyFixtures,
  evidenceItemFixtures,
  bodycamVideoCustodyFixtures,
  forensicCaseFixtures,
  jailBookingSheetFixtures,
  jailRosterSnapshotFixtures,
} from './fixtures/evidenceCustody';
import { createEntry } from './types';
import type { Criticality, PdfRegistryEntry } from './types';

// One entry per PDF output type. This is the inventory: no complete
// list of RMPG Flex's PDF outputs existed before this file.
export const PDF_REGISTRY: PdfRegistryEntry[] = [
  createEntry({
    id: 'trespass-order',
    label: 'Trespass Order',
    criticality: 'court-legal',
    module: 'client/src/utils/trespassOrderPdf.ts',
    generate: generateTrespassOrderPdf,
    fixtures: trespassOrderFixtures,
  }),
  createEntry({
    id: 'criminal-history',
    label: 'Criminal History',
    criticality: 'court-legal',
    module: 'client/src/utils/criminalHistoryPdf.ts',
    generate: generateCriminalHistoryPdf,
    fixtures: criminalHistoryFixtures,
  }),
  createEntry({
    id: 'court-appearance',
    label: 'Court Appearance Notice',
    criticality: 'court-legal',
    module: 'client/src/utils/courtAppearancePdf.ts',
    generate: generateCourtAppearancePdf,
    fixtures: courtAppearanceFixtures,
  }),
  createEntry({
    id: 'equipment-custody',
    label: 'Equipment Custody',
    criticality: 'evidence-custody',
    module: 'client/src/utils/equipmentCustodyPdf.ts',
    generate: generateEquipmentCustodyPdf,
    fixtures: equipmentCustodyFixtures,
  }),
  createEntry({
    id: 'evidence-item',
    label: 'Evidence Item',
    criticality: 'evidence-custody',
    module: 'client/src/utils/evidenceItemPdf.ts',
    generate: generateEvidenceItemPdf,
    fixtures: evidenceItemFixtures,
  }),
  createEntry({
    id: 'bodycam-video-custody',
    label: 'Bodycam Video Custody',
    criticality: 'evidence-custody',
    module: 'client/src/utils/bodycamVideoCustodyPdf.ts',
    generate: generateBodycamVideoCustodyPdf,
    fixtures: bodycamVideoCustodyFixtures,
  }),
  createEntry({
    id: 'forensic-case',
    label: 'Forensic Case',
    criticality: 'evidence-custody',
    module: 'client/src/utils/forensicCasePdf.ts',
    generate: generateForensicCasePdf,
    fixtures: forensicCaseFixtures,
  }),
  createEntry({
    id: 'jail-booking-sheet',
    label: 'Jail Booking Sheet',
    criticality: 'evidence-custody',
    module: 'client/src/utils/jailBookingSheetPdf.ts',
    generate: generateJailBookingSheetPdf,
    fixtures: jailBookingSheetFixtures,
  }),
  createEntry({
    id: 'jail-roster-snapshot',
    label: 'Jail Roster Snapshot',
    criticality: 'evidence-custody',
    module: 'client/src/utils/jailBookingSheetPdf.ts',
    generate: generateJailRosterSnapshotPdf,
    fixtures: jailRosterSnapshotFixtures,
  }),
];

export function getEntry(id: string): PdfRegistryEntry | undefined {
  return PDF_REGISTRY.find((e) => e.id === id);
}

export function entriesByCriticality(c: Criticality): PdfRegistryEntry[] {
  return PDF_REGISTRY.filter((e) => e.criticality === c);
}
