// Parameterised builder-extraction wrapper test for the 10 standalone fleet
// report generators in this directory (batch 5f). Rather than 10 near-
// identical per-file wrapper tests, this table-drives over all of them,
// asserting for each: the void `generate*` export still returns void, still
// calls jsPDF#save exactly once, and the filename matches the pre-refactor
// filename expression (byte-identical, see the batch report for the diff).
//
// `save` is assigned as an own instance property inside jsPDF's constructor
// (not on the prototype), so vi.spyOn(jsPDF.prototype, 'save') cannot see
// it. Wrap the constructor instead so every instance's `save` is a spy —
// same technique as darPdf.test.ts / patrolTrackingPdfGenerator.wrapper.test.ts.
import { describe, it, expect, vi } from 'vitest';

const saveSpy = vi.fn();
vi.mock('jspdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jspdf')>();
  class PatchedJsPDF extends actual.jsPDF {
    constructor(...args: ConstructorParameters<typeof actual.jsPDF>) {
      super(...args);
      const self = this;
      // jsPDF#save is overloaded — sync, returning `jsPDF`, by default, or
      // `Promise<void>` when called with `{ returnPromise: true }`. Declared
      // with real overload signatures (same as the library's own type)
      // instead of casting past the mismatch, per darPdf.test.ts precedent.
      function patchedSave(filename?: string): PatchedJsPDF;
      function patchedSave(filename: string, options: { returnPromise: true }): Promise<void>;
      function patchedSave(
        filename?: string,
        options?: { returnPromise: true },
      ): PatchedJsPDF | Promise<void> {
        saveSpy(filename);
        return options?.returnPromise ? Promise.resolve() : self;
      }
      this.save = patchedSave;
    }
  }
  return { ...actual, default: PatchedJsPDF, jsPDF: PatchedJsPDF };
});

import { generateFlaggedAuditPdf, buildFlaggedAuditPdf } from '../flaggedAuditPdf';
import { generateFleetBudgetVariancePdf, buildFleetBudgetVariancePdf } from '../fleetBudgetVariancePdf';
import { generateFleetCostOwnershipPdf, buildFleetCostOwnershipPdf } from '../fleetCostOwnershipPdf';
import { generateFleetDamageReportPdf, buildFleetDamageReportPdf } from '../fleetDamageReportPdf';
import { generateFleetExpensesReportPdf, buildFleetExpensesReportPdf } from '../fleetExpensesReportPdf';
import { generateFleetFuelAnalyticsPdf, buildFleetFuelAnalyticsPdf } from '../fleetFuelAnalyticsPdf';
import { generateFleetFuelReport, buildFleetFuelReport } from '../fleetFuelReport';
import { generateFleetInspectionReportPdf, buildFleetInspectionReportPdf } from '../fleetInspectionReportPdf';
import { generateFleetMaintenanceHistoryPdf, buildFleetMaintenanceHistoryPdf } from '../fleetMaintenanceHistoryPdf';
import { generateFleetVehicleSummaryPdf, buildFleetVehicleSummaryPdf } from '../fleetVehicleSummaryPdf';
import {
  generateFleetStatusReport, buildFleetStatusReport,
  generateFleetMaintenanceReport, buildFleetMaintenanceReport,
  generateFleetCostReport, buildFleetCostReport,
  generateFleetLifecycleReport, buildFleetLifecycleReport,
  generateFleetComplianceReport, buildFleetComplianceReport,
  generateFleetUtilizationReport, buildFleetUtilizationReport,
  generateFleetFuelConsumptionReport, buildFleetFuelConsumptionReport,
  generateFleetAccidentReport, buildFleetAccidentReport,
  generateFleetBudgetReport, buildFleetBudgetReport,
  generateFleetReplacementReport, buildFleetReplacementReport,
  generateFleetDepreciationReport, buildFleetDepreciationReport,
  generateFleetKeyReport, buildFleetKeyReport,
  generateFleetScorecardReport, buildFleetScorecardReport,
  generatePersonnelProductivityReport, buildPersonnelProductivityReport,
  generateInspectionAnalysisReport, buildInspectionAnalysisReport,
  generateCostPerMileReport, buildCostPerMileReport,
  generateMaintenanceForecastReport, buildMaintenanceForecastReport,
  generateComplianceAuditReport, buildComplianceAuditReport,
} from '../fleetPdfReports';

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
} from '../../../../devtools/pdfGallery/fixtures/fleet';

const TODAY = new RegExp(`^.*\\d{4}-\\d{2}-\\d{2}\\.pdf$`);

interface WrapperCase<T> {
  name: string;
  generate: (input: T) => void;
  build: (input: T) => import('jspdf').jsPDF;
  input: T;
  filenamePattern: RegExp;
}

const typicalOf = <T,>(fixtures: { variant: string; input: T }[]): T =>
  fixtures.find((f) => f.variant === 'typical')!.input;

const cases: WrapperCase<any>[] = [
  {
    name: 'flaggedAuditPdf',
    generate: generateFlaggedAuditPdf,
    build: buildFlaggedAuditPdf,
    input: typicalOf(flaggedAuditFixtures),
    filenamePattern: /^fuel-flagged-audit-\d{4}-\d{2}-\d{2}\.pdf$/,
  },
  {
    name: 'fleetBudgetVariancePdf',
    generate: generateFleetBudgetVariancePdf,
    build: buildFleetBudgetVariancePdf,
    input: typicalOf(fleetBudgetVarianceFixtures),
    filenamePattern: /^budget-variance-vehicle-47-\d{4}-\d{2}-\d{2}\.pdf$/,
  },
  {
    name: 'fleetCostOwnershipPdf',
    generate: generateFleetCostOwnershipPdf,
    build: buildFleetCostOwnershipPdf,
    input: typicalOf(fleetCostOwnershipFixtures),
    filenamePattern: /^tco-report-47-\d{4}-\d{2}-\d{2}\.pdf$/,
  },
  {
    name: 'fleetDamageReportPdf',
    generate: generateFleetDamageReportPdf,
    build: buildFleetDamageReportPdf,
    input: typicalOf(fleetDamageReportFixtures),
    filenamePattern: /^damage-report-47-\d{4}-\d{2}-\d{2}\.pdf$/,
  },
  {
    name: 'fleetExpensesReportPdf',
    generate: generateFleetExpensesReportPdf,
    build: buildFleetExpensesReportPdf,
    input: typicalOf(fleetExpensesReportFixtures),
    filenamePattern: /^expenses-report-47-\d{4}-\d{2}-\d{2}\.pdf$/,
  },
  {
    name: 'fleetFuelAnalyticsPdf',
    generate: generateFleetFuelAnalyticsPdf,
    build: buildFleetFuelAnalyticsPdf,
    input: typicalOf(fleetFuelAnalyticsFixtures),
    filenamePattern: /^fuel-analytics-\d{4}-\d{2}-\d{2}\.pdf$/,
  },
  {
    name: 'fleetFuelReport',
    generate: generateFleetFuelReport,
    build: buildFleetFuelReport,
    input: typicalOf(fleetFuelReportFixtures),
    filenamePattern: /^fuel-report-47-\d{4}-\d{2}-\d{2}\.pdf$/,
  },
  {
    name: 'fleetInspectionReportPdf',
    generate: generateFleetInspectionReportPdf,
    build: buildFleetInspectionReportPdf,
    input: typicalOf(fleetInspectionReportFixtures),
    filenamePattern: /^inspection-monthly-47-\d{4}-\d{2}-\d{2}\.pdf$/,
  },
  {
    name: 'fleetMaintenanceHistoryPdf',
    generate: generateFleetMaintenanceHistoryPdf,
    build: buildFleetMaintenanceHistoryPdf,
    input: typicalOf(fleetMaintenanceHistoryFixtures),
    filenamePattern: /^maintenance-history-47-\d{4}-\d{2}-\d{2}\.pdf$/,
  },
  {
    name: 'fleetVehicleSummaryPdf',
    generate: generateFleetVehicleSummaryPdf,
    build: buildFleetVehicleSummaryPdf,
    input: typicalOf(fleetVehicleSummaryFixtures),
    filenamePattern: /^vehicle-summary-47-\d{4}-\d{2}-\d{2}\.pdf$/,
  },
  {
    name: 'fleetPdfReports/generateFleetStatusReport',
    generate: generateFleetStatusReport,
    build: buildFleetStatusReport,
    input: typicalOf(fleetStatusReportFixtures),
    filenamePattern: /^fleet_status_report_\d{4}-\d{2}-\d{2}\.pdf$/,
  },
  {
    name: 'fleetPdfReports/generateFleetMaintenanceReport',
    generate: generateFleetMaintenanceReport,
    build: buildFleetMaintenanceReport,
    input: typicalOf(fleetMaintenanceReportFixtures),
    filenamePattern: /^fleet_maintenance_47_\d{4}-\d{2}-\d{2}\.pdf$/,
  },
  {
    name: 'fleetPdfReports/generateFleetCostReport',
    generate: generateFleetCostReport,
    build: buildFleetCostReport,
    input: typicalOf(fleetCostReportFixtures),
    filenamePattern: /^fleet_cost_analysis_47_\d{4}-\d{2}-\d{2}\.pdf$/,
  },
  {
    name: 'fleetPdfReports/generateFleetLifecycleReport',
    generate: generateFleetLifecycleReport,
    build: buildFleetLifecycleReport,
    input: typicalOf(fleetLifecycleReportFixtures),
    filenamePattern: /^fleet_lifecycle_47_\d{4}-\d{2}-\d{2}\.pdf$/,
  },
  {
    name: 'fleetPdfReports/generateFleetComplianceReport',
    generate: generateFleetComplianceReport,
    build: buildFleetComplianceReport,
    input: typicalOf(fleetComplianceReportFixtures),
    filenamePattern: /^fleet_compliance_report_\d{4}-\d{2}-\d{2}\.pdf$/,
  },
  {
    name: 'fleetPdfReports/generateFleetUtilizationReport',
    generate: generateFleetUtilizationReport,
    build: buildFleetUtilizationReport,
    input: typicalOf(fleetUtilizationReportFixtures),
    filenamePattern: /^fleet_utilization_report_\d{4}-\d{2}-\d{2}\.pdf$/,
  },
  {
    name: 'fleetPdfReports/generateFleetFuelConsumptionReport',
    generate: generateFleetFuelConsumptionReport,
    build: buildFleetFuelConsumptionReport,
    input: typicalOf(fleetFuelConsumptionReportFixtures),
    filenamePattern: /^fleet_fuel_consumption_report_\d{4}-\d{2}-\d{2}\.pdf$/,
  },
  {
    name: 'fleetPdfReports/generateFleetAccidentReport',
    generate: generateFleetAccidentReport,
    build: buildFleetAccidentReport,
    input: typicalOf(fleetAccidentReportFixtures),
    filenamePattern: /^fleet_accident_report_47_\d{4}-\d{2}-\d{2}\.pdf$/,
  },
  {
    name: 'fleetPdfReports/generateFleetReplacementReport',
    generate: generateFleetReplacementReport,
    build: buildFleetReplacementReport,
    input: typicalOf(fleetReplacementReportFixtures),
    filenamePattern: /^fleet_replacement_plan_\d{4}-\d{2}-\d{2}\.pdf$/,
  },
  {
    name: 'fleetPdfReports/generateFleetDepreciationReport',
    generate: generateFleetDepreciationReport,
    build: buildFleetDepreciationReport,
    input: typicalOf(fleetDepreciationReportFixtures),
    filenamePattern: /^fleet_depreciation_report_\d{4}-\d{2}-\d{2}\.pdf$/,
  },
  {
    name: 'fleetPdfReports/generateFleetKeyReport',
    generate: generateFleetKeyReport,
    build: buildFleetKeyReport,
    input: typicalOf(fleetKeyReportFixtures),
    filenamePattern: /^fleet_key_management_report_\d{4}-\d{2}-\d{2}\.pdf$/,
  },
  {
    name: 'fleetPdfReports/generateFleetScorecardReport',
    generate: generateFleetScorecardReport,
    build: buildFleetScorecardReport,
    input: typicalOf(fleetScorecardReportFixtures),
    filenamePattern: /^fleet_health_scorecard_\d{4}-\d{2}-\d{2}\.pdf$/,
  },
  {
    name: 'fleetPdfReports/generatePersonnelProductivityReport',
    generate: generatePersonnelProductivityReport,
    build: buildPersonnelProductivityReport,
    input: typicalOf(personnelProductivityReportFixtures),
    filenamePattern: /^personnel_productivity_report_\d{4}-\d{2}-\d{2}\.pdf$/,
  },
  {
    name: 'fleetPdfReports/generateInspectionAnalysisReport',
    generate: generateInspectionAnalysisReport,
    build: buildInspectionAnalysisReport,
    input: typicalOf(inspectionAnalysisReportFixtures),
    filenamePattern: /^fleet_inspection_analysis_\d{4}-\d{2}-\d{2}\.pdf$/,
  },
  {
    name: 'fleetPdfReports/generateCostPerMileReport',
    generate: generateCostPerMileReport,
    build: buildCostPerMileReport,
    input: typicalOf(costPerMileReportFixtures),
    filenamePattern: /^fleet_cost_per_mile_\d{4}-\d{2}-\d{2}\.pdf$/,
  },
  {
    name: 'fleetPdfReports/generateMaintenanceForecastReport',
    generate: generateMaintenanceForecastReport,
    build: buildMaintenanceForecastReport,
    input: typicalOf(maintenanceForecastReportFixtures),
    filenamePattern: /^fleet_maintenance_forecast_\d{4}-\d{2}-\d{2}\.pdf$/,
  },
  {
    name: 'fleetPdfReports/generateComplianceAuditReport',
    generate: generateComplianceAuditReport,
    build: buildComplianceAuditReport,
    input: typicalOf(complianceAuditReportFixtures),
    filenamePattern: /^fleet_compliance_audit_\d{4}-\d{2}-\d{2}\.pdf$/,
  },
];

// fleet_budget_report's filename is `fleet_budget_report_fy${fiscalYear}.pdf` —
// no date component — so it cannot share the generic TODAY-regex assertion
// applied to every other case above; tested separately below.
describe('fleetPdfReports/generateFleetBudgetReport wrapper (builder-extraction)', () => {
  const input = typicalOf(fleetBudgetReportFixtures);
  it('generateFleetBudgetReport still returns void and saves exactly once, with the unchanged filename', () => {
    saveSpy.mockClear();
    const result = generateFleetBudgetReport(input);
    expect(result).toBeUndefined();
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy.mock.calls[0][0]).toBe(`fleet_budget_report_fy${input.fiscalYear}.pdf`);
  });

  it('buildFleetBudgetReport returns the jsPDF document without saving', () => {
    saveSpy.mockClear();
    const doc = buildFleetBudgetReport(input);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(saveSpy).not.toHaveBeenCalled();
  });
});

describe.each(cases)('$name wrapper (builder-extraction)', ({ generate, build, input, filenamePattern }) => {
  it('generate* still returns void and saves exactly once, with the unchanged filename', () => {
    saveSpy.mockClear();
    const result = generate(input);
    expect(result).toBeUndefined();
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy.mock.calls[0][0]).toMatch(filenamePattern);
    expect(saveSpy.mock.calls[0][0]).toMatch(TODAY);
  });

  it('build* returns the jsPDF document without saving', () => {
    saveSpy.mockClear();
    const doc = build(input);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(saveSpy).not.toHaveBeenCalled();
  });
});
