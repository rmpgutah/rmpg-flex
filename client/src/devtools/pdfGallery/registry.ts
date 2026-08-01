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
import { generateUseOfForceReportPdf } from '../../utils/useOfForceReportPdf';
import { generateAffairsComplaintPdf } from '../../utils/affairsComplaintPdf';
import { generateClearedSummaryPdf } from '../../utils/clearedSummaryPdf';
import { buildDarPdf } from '../../utils/darPdf';
import {
  useOfForceReportFixtures,
  affairsComplaintFixtures,
  clearedSummaryFixtures,
  darFixtures,
} from './fixtures/useOfForce';
import { generateShiftReportPdf } from '../../utils/shiftReportPdf';
import { generateShiftPlanPdf } from '../../utils/shiftPlanPdf';
import { generatePlateCapturePdf } from '../../utils/plateCapturePdf';
import { generateFiCardPdf } from '../../utils/fiCardPdf';
import { generateNoticeOfCommunication } from '../../utils/psoNoticePdfGenerator';
import { buildPatrolTrackingPdf } from '../../utils/patrolTrackingPdfGenerator';
import { buildNavBriefingPdf } from '../../utils/navBriefingPdf';
import { buildNavTripReportPdf, buildNavSingleTripReportPdf } from '../../utils/navTripPdf';
import { buildMapSituationReportPdf } from '../../utils/mapSituationReportPdf';
import {
  shiftReportFixtures,
  shiftPlanFixtures,
  plateCaptureFixtures,
  fiCardFixtures,
  psoNoticeFixtures,
  patrolTrackingFixtures,
  navBriefingFixtures,
  navTripReportFixtures,
  navTripDetailFixtures,
  mapSituationReportFixtures,
} from './fixtures/dispatchPatrol';
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
  createEntry({
    id: 'use-of-force-report',
    label: 'Use of Force Report',
    criticality: 'use-of-force',
    module: 'client/src/utils/useOfForceReportPdf.ts',
    generate: generateUseOfForceReportPdf,
    fixtures: useOfForceReportFixtures,
  }),
  createEntry({
    id: 'affairs-complaint',
    label: 'Internal Affairs Complaint',
    criticality: 'use-of-force',
    module: 'client/src/utils/affairsComplaintPdf.ts',
    generate: generateAffairsComplaintPdf,
    fixtures: affairsComplaintFixtures,
  }),
  createEntry({
    id: 'cleared-summary',
    label: 'Cleared Calls Summary',
    criticality: 'use-of-force',
    module: 'client/src/utils/clearedSummaryPdf.ts',
    generate: generateClearedSummaryPdf,
    fixtures: clearedSummaryFixtures,
  }),
  createEntry({
    id: 'dar',
    label: 'Daily Activity Report',
    criticality: 'use-of-force',
    module: 'client/src/utils/darPdf.ts',
    generate: buildDarPdf,
    fixtures: darFixtures,
  }),
  createEntry({
    id: 'shift-report',
    label: 'End-of-Shift Report',
    criticality: 'dispatch-patrol',
    module: 'client/src/utils/shiftReportPdf.ts',
    generate: generateShiftReportPdf,
    fixtures: shiftReportFixtures,
  }),
  createEntry({
    id: 'shift-plan',
    label: 'Shift Briefing — Deployment Plan',
    criticality: 'dispatch-patrol',
    module: 'client/src/utils/shiftPlanPdf.ts',
    generate: generateShiftPlanPdf,
    fixtures: shiftPlanFixtures,
  }),
  createEntry({
    id: 'plate-capture',
    label: 'ALPR Plate Capture',
    criticality: 'dispatch-patrol',
    module: 'client/src/utils/plateCapturePdf.ts',
    generate: generatePlateCapturePdf,
    fixtures: plateCaptureFixtures,
  }),
  createEntry({
    id: 'fi-card',
    label: 'Field Interview Card',
    criticality: 'dispatch-patrol',
    module: 'client/src/utils/fiCardPdf.ts',
    generate: generateFiCardPdf,
    fixtures: fiCardFixtures,
  }),
  createEntry({
    id: 'pso-notice',
    label: 'PSO Notice of Communication',
    criticality: 'dispatch-patrol',
    module: 'client/src/utils/psoNoticePdfGenerator.ts',
    generate: generateNoticeOfCommunication,
    fixtures: psoNoticeFixtures,
  }),
  createEntry({
    id: 'patrol-tracking',
    label: 'Patrol Tracking Report',
    criticality: 'dispatch-patrol',
    module: 'client/src/utils/patrolTrackingPdfGenerator.ts',
    generate: buildPatrolTrackingPdf,
    fixtures: patrolTrackingFixtures,
  }),
  createEntry({
    id: 'nav-briefing',
    label: 'Pre-Trip Route Briefing',
    criticality: 'dispatch-patrol',
    module: 'client/src/utils/navBriefingPdf.ts',
    generate: buildNavBriefingPdf,
    fixtures: navBriefingFixtures,
  }),
  createEntry({
    id: 'nav-trip-report',
    label: 'Nav Trip Report',
    criticality: 'dispatch-patrol',
    module: 'client/src/utils/navTripPdf.ts',
    generate: buildNavTripReportPdf,
    fixtures: navTripReportFixtures,
  }),
  createEntry({
    id: 'nav-trip-detail',
    label: 'Nav Trip — Detail',
    criticality: 'dispatch-patrol',
    module: 'client/src/utils/navTripPdf.ts',
    generate: buildNavSingleTripReportPdf,
    fixtures: navTripDetailFixtures,
  }),
  createEntry({
    id: 'map-situation-report',
    label: 'Tactical Situation Report',
    criticality: 'dispatch-patrol',
    module: 'client/src/utils/mapSituationReportPdf.ts',
    generate: buildMapSituationReportPdf,
    fixtures: mapSituationReportFixtures,
  }),
];

export function getEntry(id: string): PdfRegistryEntry | undefined {
  return PDF_REGISTRY.find((e) => e.id === id);
}

export function entriesByCriticality(c: Criticality): PdfRegistryEntry[] {
  return PDF_REGISTRY.filter((e) => e.criticality === c);
}
