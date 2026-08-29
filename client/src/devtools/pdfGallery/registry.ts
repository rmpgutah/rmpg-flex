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
import { generateDialConnectCallPdf } from '../../utils/dialConnectCallPdf';
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
  dialConnectCallFixtures,
} from './fixtures/dispatchPatrol';
import { generateInvoicePdf } from '../../utils/invoicePdfGenerator';
import { generateDocumentIntakePdf } from '../../utils/documentIntakePdf';
import { generateTrainingCertificatePdf } from '../../utils/trainingCertificatePdf';
import { generateSkipTracerReportPdf } from '../../utils/skipTracerReportPdf';
import { buildProposalPdf } from '../../utils/proposalPdf';
import {
  invoiceFixtures,
  documentIntakeFixtures,
  trainingCertificateFixtures,
  skipTracerReportFixtures,
  proposalFixtures,
} from './fixtures/clientFacing';
import type { SkipTracerFixtureInput, ProposalFixtureInput } from './fixtures/clientFacing';
import { buildFlaggedAuditPdf } from '../../pages/fleet/utils/flaggedAuditPdf';
import { buildFleetBudgetVariancePdf } from '../../pages/fleet/utils/fleetBudgetVariancePdf';
import { buildFleetCostOwnershipPdf } from '../../pages/fleet/utils/fleetCostOwnershipPdf';
import { buildFleetDamageReportPdf } from '../../pages/fleet/utils/fleetDamageReportPdf';
import { buildFleetExpensesReportPdf } from '../../pages/fleet/utils/fleetExpensesReportPdf';
import { buildFleetFuelAnalyticsPdf } from '../../pages/fleet/utils/fleetFuelAnalyticsPdf';
import { buildFleetFuelReport } from '../../pages/fleet/utils/fleetFuelReport';
import { buildFleetInspectionReportPdf } from '../../pages/fleet/utils/fleetInspectionReportPdf';
import { buildFleetMaintenanceHistoryPdf } from '../../pages/fleet/utils/fleetMaintenanceHistoryPdf';
import { buildFleetVehicleSummaryPdf } from '../../pages/fleet/utils/fleetVehicleSummaryPdf';
import {
  buildFleetStatusReport,
  buildFleetMaintenanceReport,
  buildFleetCostReport,
  buildFleetLifecycleReport,
  buildFleetComplianceReport,
  buildFleetUtilizationReport,
  buildFleetFuelConsumptionReport,
  buildFleetAccidentReport,
  buildFleetBudgetReport,
  buildFleetReplacementReport,
  buildFleetDepreciationReport,
  buildFleetKeyReport,
  buildFleetScorecardReport,
  buildPersonnelProductivityReport,
  buildInspectionAnalysisReport,
  buildCostPerMileReport,
  buildMaintenanceForecastReport,
  buildComplianceAuditReport,
} from '../../pages/fleet/utils/fleetPdfReports';
import {
  flaggedAuditFixtures,
  fleetBudgetVarianceFixtures,
  fleetCostOwnershipFixtures,
  fleetDamageReportFixtures,
  fleetExpensesReportFixtures,
  fleetFuelAnalyticsFixtures,
  fleetFuelReportFixtures,
  fleetInspectionReportFixtures,
  fleetMaintenanceHistoryFixtures,
  fleetVehicleSummaryFixtures,
  fleetStatusReportFixtures,
  fleetMaintenanceReportFixtures,
  fleetCostReportFixtures,
  fleetLifecycleReportFixtures,
  fleetComplianceReportFixtures,
  fleetUtilizationReportFixtures,
  fleetFuelConsumptionReportFixtures,
  fleetAccidentReportFixtures,
  fleetBudgetReportFixtures,
  fleetReplacementReportFixtures,
  fleetDepreciationReportFixtures,
  fleetKeyReportFixtures,
  fleetScorecardReportFixtures,
  personnelProductivityReportFixtures,
  inspectionAnalysisReportFixtures,
  costPerMileReportFixtures,
  maintenanceForecastReportFixtures,
  complianceAuditReportFixtures,
} from './fixtures/fleet';
import { generateAuditLogPdf } from '../../utils/auditLogPdf';
import { generateConversationTranscriptPdf } from '../../utils/conversationTranscriptPdf';
import { generateEmailThreadPdf } from '../../utils/emailThreadPdf';
import { buildHelpQuickReferencePdf } from '../../utils/helpQuickReferencePdf';
import { generateKnowledgeBaseSearchPdf } from '../../utils/knowledgeBaseSearchPdf';
import { buildStatuteDoc } from '../../utils/statutePdfGenerator';
import { generateTasksPdf } from '../../utils/taskPdf';
import { buildDispatchGuideDoc } from '../../utils/dispatchGuidePdfGenerator';
import { generateSafetySheet } from '../../utils/dlSafetySheet';
import {
  auditLogFixtures,
  conversationTranscriptFixtures,
  emailThreadFixtures,
  helpQuickReferenceFixtures,
  knowledgeBaseSearchFixtures,
  ncicReferenceFixtures,
  ncicReferenceAdapter,
  statuteFixtures,
  taskFixtures,
  dispatchGuideFixtures,
  webResearchReportFixtures,
  webResearchReportAdapter,
  dlSafetySheetFixtures,
} from './fixtures/internalReference';
import {
  generateCallRecord,
  generatePersonRecord,
  generateVehicleRecord,
  generateWarrantRecord,
  generateEvidenceRecord,
  generateFleetRecord,
  generatePersonnelRecord,
  generatePropertyRecord,
  generateBusinessRecord,
  generateCitationRecord,
  generateCaseRecord,
  generateFieldInterviewRecord,
  generateCourtEventRecord,
  generateJailBookingRecord,
  callFixtures,
  personFixtures,
  vehicleFixtures,
  warrantFixtures,
  evidenceFixtures,
  fleetFixtures,
  personnelFixtures,
  propertyFixtures,
  businessFixtures,
  citationFixtures,
  caseFixtures,
  fieldInterviewFixtures,
  courtEventFixtures,
  jailBookingFixtures,
} from './fixtures/coreRecords';
import { createEntry } from './types';
import type { Criticality, PdfRegistryEntry } from './types';

// generateSkipTracerReportPdf takes two positional args (subject, ctx); the
// registry's `generate` contract is single-argument, so this adapter unpacks
// the bundled fixture input rather than changing the generator's signature.
function skipTracerAdapter(input: SkipTracerFixtureInput) {
  return generateSkipTracerReportPdf(input.subject, input.ctx);
}

// buildProposalPdf takes two positional args (proposal, client); same
// single-argument adapter pattern as skipTracerAdapter above.
function proposalAdapter(input: ProposalFixtureInput) {
  return buildProposalPdf(input.proposal, input.client);
}

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
  createEntry({
    id: 'dial-connect-call',
    label: 'Dial Connect Call Record',
    criticality: 'dispatch-patrol',
    module: 'client/src/utils/dialConnectCallPdf.ts',
    generate: generateDialConnectCallPdf,
    fixtures: dialConnectCallFixtures,
  }),
  createEntry({
    id: 'invoice',
    label: 'Client Invoice',
    criticality: 'client-facing',
    module: 'client/src/utils/invoicePdfGenerator.ts',
    generate: generateInvoicePdf,
    fixtures: invoiceFixtures,
  }),
  createEntry({
    id: 'document-intake',
    label: 'Document Intake Review',
    criticality: 'client-facing',
    module: 'client/src/utils/documentIntakePdf.ts',
    generate: generateDocumentIntakePdf,
    fixtures: documentIntakeFixtures,
  }),
  createEntry({
    id: 'training-certificate',
    label: 'Training Certificate',
    criticality: 'client-facing',
    module: 'client/src/utils/trainingCertificatePdf.ts',
    generate: generateTrainingCertificatePdf,
    fixtures: trainingCertificateFixtures,
  }),
  createEntry({
    id: 'skip-tracer-report',
    label: 'Skip Tracer Report',
    criticality: 'client-facing',
    module: 'client/src/utils/skipTracerReportPdf.ts',
    generate: skipTracerAdapter,
    fixtures: skipTracerReportFixtures,
  }),
  createEntry({
    id: 'proposal',
    label: 'Client Proposal',
    criticality: 'client-facing',
    module: 'client/src/utils/proposalPdf.ts',
    generate: proposalAdapter,
    fixtures: proposalFixtures,
  }),
  createEntry({
    id: 'flagged-fuel-audit',
    label: 'Flagged Fuel Entry Audit',
    criticality: 'client-facing',
    module: 'client/src/pages/fleet/utils/flaggedAuditPdf.ts',
    generate: buildFlaggedAuditPdf,
    fixtures: flaggedAuditFixtures,
  }),
  createEntry({
    id: 'fleet-budget-variance',
    label: 'Fuel Budget Variance',
    criticality: 'client-facing',
    module: 'client/src/pages/fleet/utils/fleetBudgetVariancePdf.ts',
    generate: buildFleetBudgetVariancePdf,
    fixtures: fleetBudgetVarianceFixtures,
  }),
  createEntry({
    id: 'fleet-cost-ownership',
    label: 'Total Cost of Ownership',
    criticality: 'client-facing',
    module: 'client/src/pages/fleet/utils/fleetCostOwnershipPdf.ts',
    generate: buildFleetCostOwnershipPdf,
    fixtures: fleetCostOwnershipFixtures,
  }),
  createEntry({
    id: 'fleet-damage-report',
    label: 'Vehicle Damage Report',
    criticality: 'client-facing',
    module: 'client/src/pages/fleet/utils/fleetDamageReportPdf.ts',
    generate: buildFleetDamageReportPdf,
    fixtures: fleetDamageReportFixtures,
  }),
  createEntry({
    id: 'fleet-expenses-report',
    label: 'Fleet Expenses Report',
    criticality: 'client-facing',
    module: 'client/src/pages/fleet/utils/fleetExpensesReportPdf.ts',
    generate: buildFleetExpensesReportPdf,
    fixtures: fleetExpensesReportFixtures,
  }),
  createEntry({
    id: 'fleet-fuel-analytics',
    label: 'Fleet Fuel Analytics',
    criticality: 'client-facing',
    module: 'client/src/pages/fleet/utils/fleetFuelAnalyticsPdf.ts',
    generate: buildFleetFuelAnalyticsPdf,
    fixtures: fleetFuelAnalyticsFixtures,
  }),
  createEntry({
    id: 'fleet-fuel-report',
    label: 'Vehicle Fuel Report',
    criticality: 'client-facing',
    module: 'client/src/pages/fleet/utils/fleetFuelReport.ts',
    generate: buildFleetFuelReport,
    fixtures: fleetFuelReportFixtures,
  }),
  createEntry({
    id: 'fleet-inspection-report',
    label: 'Vehicle Inspection Report',
    criticality: 'client-facing',
    module: 'client/src/pages/fleet/utils/fleetInspectionReportPdf.ts',
    generate: buildFleetInspectionReportPdf,
    fixtures: fleetInspectionReportFixtures,
  }),
  createEntry({
    id: 'fleet-maintenance-history',
    label: 'Vehicle Maintenance History',
    criticality: 'client-facing',
    module: 'client/src/pages/fleet/utils/fleetMaintenanceHistoryPdf.ts',
    generate: buildFleetMaintenanceHistoryPdf,
    fixtures: fleetMaintenanceHistoryFixtures,
  }),
  createEntry({
    id: 'fleet-vehicle-summary',
    label: 'Vehicle Summary Report',
    criticality: 'client-facing',
    module: 'client/src/pages/fleet/utils/fleetVehicleSummaryPdf.ts',
    generate: buildFleetVehicleSummaryPdf,
    fixtures: fleetVehicleSummaryFixtures,
  }),
  createEntry({
    id: 'fleet-status-report',
    label: 'Fleet Status Report',
    criticality: 'client-facing',
    module: 'client/src/pages/fleet/utils/fleetPdfReports.ts',
    generate: buildFleetStatusReport,
    fixtures: fleetStatusReportFixtures,
  }),
  createEntry({
    id: 'fleet-maintenance-report',
    label: 'Fleet Maintenance History Report',
    criticality: 'client-facing',
    module: 'client/src/pages/fleet/utils/fleetPdfReports.ts',
    generate: buildFleetMaintenanceReport,
    fixtures: fleetMaintenanceReportFixtures,
  }),
  createEntry({
    id: 'fleet-cost-report',
    label: 'Fleet Cost Analysis Report',
    criticality: 'client-facing',
    module: 'client/src/pages/fleet/utils/fleetPdfReports.ts',
    generate: buildFleetCostReport,
    fixtures: fleetCostReportFixtures,
  }),
  createEntry({
    id: 'fleet-lifecycle-report',
    label: 'Vehicle Lifecycle Report',
    criticality: 'client-facing',
    module: 'client/src/pages/fleet/utils/fleetPdfReports.ts',
    generate: buildFleetLifecycleReport,
    fixtures: fleetLifecycleReportFixtures,
  }),
  createEntry({
    id: 'fleet-compliance-report',
    label: 'Fleet Compliance Report',
    criticality: 'client-facing',
    module: 'client/src/pages/fleet/utils/fleetPdfReports.ts',
    generate: buildFleetComplianceReport,
    fixtures: fleetComplianceReportFixtures,
  }),
  createEntry({
    id: 'fleet-utilization-report',
    label: 'Fleet Utilization Report',
    criticality: 'client-facing',
    module: 'client/src/pages/fleet/utils/fleetPdfReports.ts',
    generate: buildFleetUtilizationReport,
    fixtures: fleetUtilizationReportFixtures,
  }),
  createEntry({
    id: 'fleet-fuel-consumption-report',
    label: 'Fleet Fuel Consumption & Emissions Report',
    criticality: 'client-facing',
    module: 'client/src/pages/fleet/utils/fleetPdfReports.ts',
    generate: buildFleetFuelConsumptionReport,
    fixtures: fleetFuelConsumptionReportFixtures,
  }),
  createEntry({
    id: 'fleet-accident-report',
    label: 'Fleet Accident Report',
    criticality: 'client-facing',
    module: 'client/src/pages/fleet/utils/fleetPdfReports.ts',
    generate: buildFleetAccidentReport,
    fixtures: fleetAccidentReportFixtures,
  }),
  createEntry({
    id: 'fleet-budget-report',
    label: 'Fleet Budget Report',
    criticality: 'client-facing',
    module: 'client/src/pages/fleet/utils/fleetPdfReports.ts',
    generate: buildFleetBudgetReport,
    fixtures: fleetBudgetReportFixtures,
  }),
  createEntry({
    id: 'fleet-replacement-report',
    label: 'Fleet Vehicle Replacement Plan',
    criticality: 'client-facing',
    module: 'client/src/pages/fleet/utils/fleetPdfReports.ts',
    generate: buildFleetReplacementReport,
    fixtures: fleetReplacementReportFixtures,
  }),
  createEntry({
    id: 'fleet-depreciation-report',
    label: 'Fleet Depreciation Schedule',
    criticality: 'client-facing',
    module: 'client/src/pages/fleet/utils/fleetPdfReports.ts',
    generate: buildFleetDepreciationReport,
    fixtures: fleetDepreciationReportFixtures,
  }),
  createEntry({
    id: 'fleet-key-report',
    label: 'Fleet Key Management Report',
    criticality: 'client-facing',
    module: 'client/src/pages/fleet/utils/fleetPdfReports.ts',
    generate: buildFleetKeyReport,
    fixtures: fleetKeyReportFixtures,
  }),
  createEntry({
    id: 'fleet-scorecard-report',
    label: 'Fleet Health Scorecard',
    criticality: 'client-facing',
    module: 'client/src/pages/fleet/utils/fleetPdfReports.ts',
    generate: buildFleetScorecardReport,
    fixtures: fleetScorecardReportFixtures,
  }),
  createEntry({
    id: 'personnel-productivity-report',
    label: 'Personnel Productivity Report',
    criticality: 'client-facing',
    module: 'client/src/pages/fleet/utils/fleetPdfReports.ts',
    generate: buildPersonnelProductivityReport,
    fixtures: personnelProductivityReportFixtures,
  }),
  createEntry({
    id: 'inspection-analysis-report',
    label: 'Inspection Analysis Report',
    criticality: 'client-facing',
    module: 'client/src/pages/fleet/utils/fleetPdfReports.ts',
    generate: buildInspectionAnalysisReport,
    fixtures: inspectionAnalysisReportFixtures,
  }),
  createEntry({
    id: 'cost-per-mile-report',
    label: 'Cost-Per-Mile Analysis Report',
    criticality: 'client-facing',
    module: 'client/src/pages/fleet/utils/fleetPdfReports.ts',
    generate: buildCostPerMileReport,
    fixtures: costPerMileReportFixtures,
  }),
  createEntry({
    id: 'maintenance-forecast-report',
    label: 'Maintenance Forecast Report',
    criticality: 'client-facing',
    module: 'client/src/pages/fleet/utils/fleetPdfReports.ts',
    generate: buildMaintenanceForecastReport,
    fixtures: maintenanceForecastReportFixtures,
  }),
  createEntry({
    id: 'compliance-audit-report',
    label: 'Compliance Audit Report',
    criticality: 'client-facing',
    module: 'client/src/pages/fleet/utils/fleetPdfReports.ts',
    generate: buildComplianceAuditReport,
    fixtures: complianceAuditReportFixtures,
  }),
  createEntry({
    id: 'audit-log',
    label: 'Audit Log Export',
    criticality: 'internal-reference',
    module: 'client/src/utils/auditLogPdf.ts',
    generate: generateAuditLogPdf,
    fixtures: auditLogFixtures,
  }),
  createEntry({
    id: 'conversation-transcript',
    label: 'Conversation Transcript',
    criticality: 'internal-reference',
    module: 'client/src/utils/conversationTranscriptPdf.ts',
    generate: generateConversationTranscriptPdf,
    fixtures: conversationTranscriptFixtures,
  }),
  createEntry({
    id: 'email-thread',
    label: 'Email Thread Transcript',
    criticality: 'internal-reference',
    module: 'client/src/utils/emailThreadPdf.ts',
    generate: generateEmailThreadPdf,
    fixtures: emailThreadFixtures,
  }),
  createEntry({
    id: 'help-quick-reference',
    label: 'Help Quick Reference Card',
    criticality: 'internal-reference',
    module: 'client/src/utils/helpQuickReferencePdf.ts',
    generate: buildHelpQuickReferencePdf,
    fixtures: helpQuickReferenceFixtures,
  }),
  createEntry({
    id: 'knowledge-base-search',
    label: 'Knowledge Base Search Export',
    criticality: 'internal-reference',
    module: 'client/src/utils/knowledgeBaseSearchPdf.ts',
    generate: generateKnowledgeBaseSearchPdf,
    fixtures: knowledgeBaseSearchFixtures,
  }),
  createEntry({
    id: 'ncic-reference',
    label: 'NCIC Operator Reference Guide',
    criticality: 'internal-reference',
    module: 'client/src/utils/ncicReferencePdf.ts',
    generate: ncicReferenceAdapter,
    fixtures: ncicReferenceFixtures,
  }),
  createEntry({
    id: 'statute',
    label: 'Utah Law Book / Statute Export',
    criticality: 'internal-reference',
    module: 'client/src/utils/statutePdfGenerator.ts',
    generate: buildStatuteDoc,
    fixtures: statuteFixtures,
  }),
  createEntry({
    id: 'task-list',
    label: 'Task List Export',
    criticality: 'internal-reference',
    module: 'client/src/utils/taskPdf.ts',
    generate: generateTasksPdf,
    fixtures: taskFixtures,
  }),
  createEntry({
    id: 'dispatch-guide',
    label: 'Dispatch Guide',
    criticality: 'internal-reference',
    module: 'client/src/utils/dispatchGuidePdfGenerator.ts',
    generate: buildDispatchGuideDoc,
    fixtures: dispatchGuideFixtures,
  }),
  createEntry({
    id: 'web-research-report',
    label: 'Web Research Report',
    criticality: 'internal-reference',
    module: 'client/src/utils/webResearchReportPdf.ts',
    generate: webResearchReportAdapter,
    fixtures: webResearchReportFixtures,
  }),
  createEntry({
    id: 'dl-safety-sheet',
    label: 'Pre-Contact Officer Safety Sheet',
    criticality: 'internal-reference',
    module: 'client/src/utils/dlSafetySheet.ts',
    generate: generateSafetySheet,
    fixtures: dlSafetySheetFixtures,
  }),
  createEntry({
    id: 'call-record',
    label: 'Call Record (FORM PS-201)',
    criticality: 'dispatch-patrol',
    module: 'client/src/utils/recordPdfGenerator.ts',
    generate: generateCallRecord,
    fixtures: callFixtures,
  }),
  createEntry({
    id: 'person-record',
    label: 'Person Record (FORM PS-202)',
    criticality: 'dispatch-patrol',
    module: 'client/src/utils/recordPdfGenerator.ts',
    generate: generatePersonRecord,
    fixtures: personFixtures,
  }),
  createEntry({
    id: 'vehicle-record',
    label: 'Vehicle Record (FORM PS-203)',
    criticality: 'dispatch-patrol',
    module: 'client/src/utils/recordPdfGenerator.ts',
    generate: generateVehicleRecord,
    fixtures: vehicleFixtures,
  }),
  createEntry({
    id: 'warrant-record',
    label: 'Warrant Record (FORM PS-204)',
    criticality: 'court-legal',
    module: 'client/src/utils/recordPdfGenerator.ts',
    generate: generateWarrantRecord,
    fixtures: warrantFixtures,
  }),
  createEntry({
    id: 'evidence-record',
    label: 'Evidence Record (FORM PS-205)',
    criticality: 'evidence-custody',
    module: 'client/src/utils/recordPdfGenerator.ts',
    generate: generateEvidenceRecord,
    fixtures: evidenceFixtures,
  }),
  createEntry({
    id: 'fleet-record',
    label: 'Fleet Record (FORM PS-206)',
    criticality: 'internal-reference',
    module: 'client/src/utils/recordPdfGenerator.ts',
    generate: generateFleetRecord,
    fixtures: fleetFixtures,
  }),
  createEntry({
    id: 'personnel-record',
    label: 'Personnel Record (FORM PS-207)',
    criticality: 'internal-reference',
    module: 'client/src/utils/recordPdfGenerator.ts',
    generate: generatePersonnelRecord,
    fixtures: personnelFixtures,
  }),
  createEntry({
    id: 'property-record',
    label: 'Property Record (FORM PS-208)',
    criticality: 'evidence-custody',
    module: 'client/src/utils/recordPdfGenerator.ts',
    generate: generatePropertyRecord,
    fixtures: propertyFixtures,
  }),
  createEntry({
    id: 'business-record',
    label: 'Business Record (FORM PS-212)',
    criticality: 'client-facing',
    module: 'client/src/utils/recordPdfGenerator.ts',
    generate: generateBusinessRecord,
    fixtures: businessFixtures,
  }),
  createEntry({
    id: 'citation-record',
    label: 'Citation Record (FORM PS-209)',
    criticality: 'court-legal',
    module: 'client/src/utils/recordPdfGenerator.ts',
    generate: generateCitationRecord,
    fixtures: citationFixtures,
  }),
  createEntry({
    id: 'case-record',
    label: 'Case Record (FORM PS-301)',
    criticality: 'court-legal',
    module: 'client/src/utils/recordPdfGeneratorExt.ts',
    generate: generateCaseRecord,
    fixtures: caseFixtures,
  }),
  createEntry({
    id: 'field-interview-record',
    label: 'Field Interview Record',
    criticality: 'dispatch-patrol',
    module: 'client/src/utils/recordPdfGeneratorExt.ts',
    generate: generateFieldInterviewRecord,
    fixtures: fieldInterviewFixtures,
  }),
  createEntry({
    id: 'court-event-record',
    label: 'Court Event Record',
    criticality: 'court-legal',
    module: 'client/src/utils/recordPdfGeneratorExt.ts',
    generate: generateCourtEventRecord,
    fixtures: courtEventFixtures,
  }),
  createEntry({
    id: 'jail-booking-record',
    label: 'Jail Booking Record',
    criticality: 'evidence-custody',
    module: 'client/src/utils/recordPdfGeneratorExt.ts',
    generate: generateJailBookingRecord,
    fixtures: jailBookingFixtures,
  }),
];

export function getEntry(id: string): PdfRegistryEntry | undefined {
  return PDF_REGISTRY.find((e) => e.id === id);
}

export function entriesByCriticality(c: Criticality): PdfRegistryEntry[] {
  return PDF_REGISTRY.filter((e) => e.criticality === c);
}
