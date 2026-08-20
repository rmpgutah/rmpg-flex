import type { Args as FlaggedAuditArgs } from '../../../pages/fleet/utils/flaggedAuditPdf';
import type { Args as FleetBudgetVarianceArgs } from '../../../pages/fleet/utils/fleetBudgetVariancePdf';
import type { Args as FleetCostOwnershipArgs } from '../../../pages/fleet/utils/fleetCostOwnershipPdf';
import type { Args as FleetDamageReportArgs } from '../../../pages/fleet/utils/fleetDamageReportPdf';
import type { Args as FleetExpensesReportArgs } from '../../../pages/fleet/utils/fleetExpensesReportPdf';
import type { Args as FleetFuelAnalyticsArgs } from '../../../pages/fleet/utils/fleetFuelAnalyticsPdf';
import type { Args as FleetFuelReportArgs } from '../../../pages/fleet/utils/fleetFuelReport';
import type { Args as FleetInspectionReportArgs } from '../../../pages/fleet/utils/fleetInspectionReportPdf';
import type { Args as FleetMaintenanceHistoryArgs } from '../../../pages/fleet/utils/fleetMaintenanceHistoryPdf';
import type { Args as FleetVehicleSummaryArgs } from '../../../pages/fleet/utils/fleetVehicleSummaryPdf';
// The batch-5g-1 generators (fleetPdfReports.ts) take inline anonymous
// parameter types rather than a named exported interface — sourcing the
// fixture type via `Parameters<typeof build...>[0]` keeps fixtures
// structurally pinned to the real builder signature without duplicating
// (and risking drifting from) the inline type.
import type {
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
} from '../../../pages/fleet/utils/fleetPdfReports';

type FleetStatusReportArgs = Parameters<typeof buildFleetStatusReport>[0];
type FleetMaintenanceReportArgs = Parameters<typeof buildFleetMaintenanceReport>[0];
type FleetCostReportArgs = Parameters<typeof buildFleetCostReport>[0];
type FleetLifecycleReportArgs = Parameters<typeof buildFleetLifecycleReport>[0];
type FleetComplianceReportArgs = Parameters<typeof buildFleetComplianceReport>[0];
type FleetUtilizationReportArgs = Parameters<typeof buildFleetUtilizationReport>[0];
type FleetFuelConsumptionReportArgs = Parameters<typeof buildFleetFuelConsumptionReport>[0];
type FleetAccidentReportArgs = Parameters<typeof buildFleetAccidentReport>[0];
type FleetBudgetReportArgs = Parameters<typeof buildFleetBudgetReport>[0];
type FleetReplacementReportArgs = Parameters<typeof buildFleetReplacementReport>[0];
type FleetDepreciationReportArgs = Parameters<typeof buildFleetDepreciationReport>[0];
type FleetKeyReportArgs = Parameters<typeof buildFleetKeyReport>[0];
type FleetScorecardReportArgs = Parameters<typeof buildFleetScorecardReport>[0];
type PersonnelProductivityReportArgs = Parameters<typeof buildPersonnelProductivityReport>[0];
type InspectionAnalysisReportArgs = Parameters<typeof buildInspectionAnalysisReport>[0];
type CostPerMileReportArgs = Parameters<typeof buildCostPerMileReport>[0];
type MaintenanceForecastReportArgs = Parameters<typeof buildMaintenanceForecastReport>[0];
type ComplianceAuditReportArgs = Parameters<typeof buildComplianceAuditReport>[0];
import type { FleetFuelLog, FleetVehicle, FleetFuelSummary, FleetInspection, InspectionItem, FleetMaintenance, FleetAssignment, FleetAnalytics, FuelAnalyticsOverview, FuelAnalyticsByOfficer, FuelAnalyticsByCard } from '../../../types';
import type { PdfFixture } from '../types';

// Synthetic data only. No real vehicle, driver, fuel card, invoice, or work
// order record from live data may appear here — organization policy.
// Realistic fleet-management phrasing is used deliberately (not lorem ipsum)
// so genuine phrase collisions with the placeholder-leak detector surface
// here rather than during a live migration. US units throughout — odometer
// in miles, fuel in gallons, MPG, cost per mile in USD, weights in pounds.

const MAXIMAL_NAME =
  'Bartholomew Maximilian Fitzgerald-Whitlock Fleet Services Division, III'.padEnd(120, ' ').slice(0, 120);

const BOILERPLATE_SENTENCE =
  'Vehicle was inspected per Rocky Mountain Protective Group preventive-maintenance schedule; ' +
  'no defects were observed beyond those noted above. State of Utah, County of Salt Lake. ';
const MAXIMAL_NARRATIVE = BOILERPLATE_SENTENCE.repeat(Math.ceil(2000 / BOILERPLATE_SENTENCE.length)).slice(0, 2000);

const YEAR_BOUNDARY = '2026-12-31T23:59:00Z';

function baseVehicle(over: Partial<FleetVehicle> = {}): FleetVehicle {
  return {
    id: 'veh-47',
    vehicle_number: '47',
    make: 'Ford',
    model: 'Explorer',
    year: 2022,
    color: 'White',
    vin: '1FTFW1ET5DFA00001',
    plate_number: 'UT-7X4K21',
    plate_state: 'UT',
    status: 'in_service',
    assigned_unit_id: 'unit-12',
    assigned_unit_call_sign: '4-Adam-12',
    current_mileage: 42815,
    last_service_date: '2026-05-01',
    next_service_due: '2026-08-01',
    insurance_expiry: '2027-01-01',
    registration_expiry: '2027-03-01',
    equipment: ['ALPR camera', 'partition'],
    take_home: 0,
    created_at: '2022-06-01T00:00:00Z',
    updated_at: '2026-06-21T00:00:00Z',
    ...over,
  };
}

function minimalVehicle(): FleetVehicle {
  return {
    id: 'veh-99',
    vehicle_number: '99',
    status: 'in_service',
    equipment: [],
    created_at: '2026-06-21T00:00:00Z',
    updated_at: '2026-06-21T00:00:00Z',
  };
}

// ── Flagged-Entry Fuel Audit (flaggedAuditPdf.ts) ─────────────

function fuelLog(i: number, flags: string[]): FleetFuelLog {
  return {
    id: `fl-${i}`,
    vehicle_id: 'veh-47',
    fuel_date: '2026-06-21T09:00:00',
    gallons: 14.2,
    cost_per_gallon: 3.42,
    total_cost: 48.56,
    odometer_reading: 42815 + i * 20,
    fuel_type: 'regular',
    station: 'Maverik #4417 — 1400 S State St',
    created_at: '2026-06-21T09:00:00Z',
    driver_name: 'Marcus Reyes',
    flags: JSON.stringify(flags),
    vehicle_number: `#${47 + (i % 3)}`,
  } as unknown as FleetFuelLog;
}

export const flaggedAuditFixtures: PdfFixture<FlaggedAuditArgs>[] = [
  {
    variant: 'typical',
    label: 'Fleet-wide scope with a handful of flagged fuel entries',
    input: {
      logs: [fuelLog(1, ['price-spike']), fuelLog(2, ['mpg-anomaly', 'rapid-duplicate'])],
      scopeLabel: 'Fleet-wide',
      dateRange: { from: '2026-06-01', to: '2026-06-30' },
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — no flagged entries, no date range',
    input: {
      logs: [],
      scopeLabel: '#47 — 2022 Ford Explorer',
      dateRange: {},
    },
  },
  {
    variant: 'maximal',
    label: '40 flagged fuel entries, year-boundary period',
    input: {
      logs: Array.from({ length: 40 }, (_, i) => fuelLog(i + 1, ['tank-overflow', 'price-spike'])),
      scopeLabel: MAXIMAL_NAME,
      dateRange: { from: '2026-01-01', to: '2026-12-31' },
    },
  },
];

// ── Fuel Budget Variance (fleetBudgetVariancePdf.ts) ──────────

function budgetSummary(over: Record<string, unknown> = {}): FleetBudgetVarianceArgs['summary'] {
  return {
    has_budget: true,
    budget: {
      vehicle_id: 47,
      period_type: 'monthly',
      budget_amount: 1200,
      alert_threshold_pct: 80,
      effective_from: '2026-01-01',
      effective_to: '2026-12-31',
      notes: 'Includes ALPR-equipped patrol vehicle surcharge.',
    },
    period: { start: '2026-06-01', end: '2026-06-30', days_elapsed: 21, days_total: 30, days_remaining: 9 },
    spend: { actual: 812.4, pct_of_budget: 67.7, daily_rate: 38.69, forecast: 1160.7, variance_pct: -3.3 },
    status: 'on_track',
    ...over,
  } as unknown as FleetBudgetVarianceArgs['summary'];
}

export const fleetBudgetVarianceFixtures: PdfFixture<FleetBudgetVarianceArgs>[] = [
  {
    variant: 'typical',
    label: 'Vehicle-scoped monthly budget, on-track status',
    input: { summary: budgetSummary(), scopeLabel: '#47 — 2022 Ford Explorer' },
  },
  {
    variant: 'empty',
    label: 'Required fields only — fleet-wide, no notes, no alert threshold overage',
    input: {
      summary: budgetSummary({
        budget: { vehicle_id: null, period_type: 'weekly', budget_amount: 0, alert_threshold_pct: 0, effective_from: '2026-06-21', effective_to: null },
        period: { start: '2026-06-21', end: '2026-06-27', days_elapsed: 0, days_total: 7, days_remaining: 7 },
        spend: { actual: 0, pct_of_budget: 0, daily_rate: 0, forecast: 0, variance_pct: 0 },
        status: 'on_track',
      }),
      scopeLabel: 'Fleet-wide',
    },
  },
  {
    variant: 'maximal',
    label: 'Over-budget status, year-boundary period, long notes',
    input: {
      summary: budgetSummary({
        budget: {
          vehicle_id: 47, period_type: 'yearly', budget_amount: 14400, alert_threshold_pct: 90,
          effective_from: '2026-01-01', effective_to: '2026-12-31', notes: MAXIMAL_NARRATIVE,
        },
        period: { start: '2026-01-01', end: '2026-12-31', days_elapsed: 364, days_total: 365, days_remaining: 1 },
        spend: { actual: 16210.55, pct_of_budget: 112.6, daily_rate: 44.53, forecast: 16240.9, variance_pct: 12.8 },
        status: 'over',
      }),
      scopeLabel: MAXIMAL_NAME,
    },
  },
];

// ── Total Cost of Ownership (fleetCostOwnershipPdf.ts) ────────

export const fleetCostOwnershipFixtures: PdfFixture<FleetCostOwnershipArgs>[] = [
  {
    variant: 'typical',
    label: 'Standard vehicle with cost categories and a 6-month trend',
    input: {
      vehicle: baseVehicle(),
      categories: [
        { label: 'Fuel', amount: 4817.5 },
        { label: 'Maintenance', amount: 2140.0 },
        { label: 'Insurance', amount: 3200.0 },
        { label: 'General Expenses', amount: 512.75 },
      ],
      monthlyTrend: Array.from({ length: 6 }, (_, i) => ({ month: `2026-0${i + 1}`, amount: 850 + i * 25 })),
      totalMiles: 42815,
      monthsOwned: 48,
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — no monthly trend, no mileage, one zero category',
    input: {
      vehicle: minimalVehicle(),
      categories: [{ label: 'Fuel', amount: 0 }],
    },
  },
  {
    variant: 'maximal',
    label: '40-row monthly trend, 120-char vehicle plate note, year-boundary data',
    input: {
      vehicle: baseVehicle({ vehicle_number: '9999', notes: MAXIMAL_NARRATIVE }),
      categories: [
        { label: 'Fuel', amount: 24817.5 },
        { label: 'Maintenance', amount: 11240.0 },
        { label: 'Insurance', amount: 9200.0 },
        { label: 'General Expenses', amount: 2512.75 },
        { label: 'Loan Payments', amount: 18400.0 },
        { label: 'Accessories', amount: 940.25 },
        { label: 'Utilities', amount: 315.6 },
      ],
      monthlyTrend: Array.from({ length: 40 }, (_, i) => ({ month: `2026-${String((i % 12) + 1).padStart(2, '0')}`, amount: 800 + i * 15 })),
      totalMiles: 128400,
      monthsOwned: 60,
    },
  },
];

// ── Damage Report (fleetDamageReportPdf.ts) ───────────────────

function damageRecord(i: number): {
  id: number; damage_date: string; damage_type: string; location_on_vehicle?: string;
  severity?: string; description: string; repair_estimate?: number; repair_cost?: number;
  repair_status?: string; insurance_claim_number?: string; reported_by_name?: string;
} {
  return {
    id: i,
    damage_date: '2026-06-21T09:00:00Z',
    damage_type: 'collision',
    location_on_vehicle: 'front bumper',
    severity: 'moderate',
    description: 'Front bumper cracked during a low-speed parking-lot collision at the retail corridor.',
    repair_estimate: 1450.0,
    repair_cost: 1385.5,
    repair_status: 'completed',
    insurance_claim_number: 'CLM-2026-004417',
    reported_by_name: 'Marcus Reyes',
  };
}

export const fleetDamageReportFixtures: PdfFixture<FleetDamageReportArgs>[] = [
  {
    variant: 'typical',
    label: 'Two damage entries with insurance claim and repair status',
    input: { vehicle: baseVehicle(), damages: [damageRecord(1), { ...damageRecord(2), severity: 'minor', repair_status: 'pending' }] },
  },
  {
    variant: 'empty',
    label: 'Required fields only — one damage entry, no cost or claim data',
    input: {
      vehicle: minimalVehicle(),
      damages: [{ id: 1, damage_date: '2026-06-21T09:00:00Z', damage_type: 'unknown', description: 'Unspecified damage noted at inspection.' }],
    },
  },
  {
    variant: 'maximal',
    label: '40 damage entries, 2,000-char description, year-boundary date',
    input: {
      vehicle: baseVehicle({ vehicle_number: '9999' }),
      damages: Array.from({ length: 40 }, (_, i) => ({
        ...damageRecord(i + 1),
        damage_date: YEAR_BOUNDARY,
        severity: (['minor', 'moderate', 'major', 'totaled'] as const)[i % 4],
        description: MAXIMAL_NARRATIVE,
      })),
    },
  },
];

// ── Expenses Report (fleetExpensesReportPdf.ts) ───────────────

function expenseRecord(i: number): {
  id: number; expense_date: string; category: string; amount: number; vendor?: string; description?: string;
} {
  return {
    id: i,
    expense_date: '2026-06-21',
    category: 'tolls',
    amount: 12.5,
    vendor: 'Utah Department of Transportation',
    description: 'Express-lane toll during patrol response.',
  };
}

export const fleetExpensesReportFixtures: PdfFixture<FleetExpensesReportArgs>[] = [
  {
    variant: 'typical',
    label: 'Vehicle-scoped expenses across a few categories',
    input: {
      vehicle: baseVehicle(),
      expenses: [
        expenseRecord(1),
        { ...expenseRecord(2), category: 'car_wash', amount: 18.0, vendor: 'Salt Lake Car Wash Co.' },
        { ...expenseRecord(3), category: 'registration', amount: 220.0, vendor: 'Utah DMV' },
      ],
      periodLabel: 'June 2026',
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — fleet-wide, no vehicle, no period label',
    input: { vehicle: null, expenses: [{ id: 1, expense_date: '2026-06-21', category: 'misc', amount: 0 }] },
  },
  {
    variant: 'maximal',
    label: '40-row expense table, year-boundary period',
    input: {
      vehicle: baseVehicle({ vehicle_number: '9999' }),
      expenses: Array.from({ length: 40 }, (_, i) => ({
        ...expenseRecord(i + 1),
        expense_date: '2026-12-31',
        category: (['tolls', 'parking', 'car_wash', 'tickets', 'towing'] as const)[i % 5],
        amount: 25.5 + i,
      })),
      periodLabel: 'Full Year 2026',
    },
  },
];

// ── Fuel Analytics (fleetFuelAnalyticsPdf.ts) ─────────────────

function overview(over: Partial<FuelAnalyticsOverview> = {}): FuelAnalyticsOverview {
  return {
    days: 30,
    since: '2026-05-22',
    totals: { fill_count: 84, total_gallons: 1189.4, total_cost: 4068.75, avg_cpg: 3.42, flag_rate: 4.8 },
    vehicles: [
      { vehicle_number: '47', year: 2022, make: 'Ford', model: 'Explorer', fill_count: 12, total_gallons: 168.5, total_cost: 576.42, avg_mpg: 19.2, flag_rate: 2.1 },
    ],
    top_stations: [{ station: 'Maverik #4417', fill_count: 22, total_spent: 940.2, avg_cpg: 3.4 }],
    flagged_leaderboard: [{ vehicle_number: '47', make: 'Ford', model: 'Explorer', flagged_count: 2 }],
    ...over,
  } as unknown as FuelAnalyticsOverview;
}

export const fleetFuelAnalyticsFixtures: PdfFixture<FleetFuelAnalyticsArgs>[] = [
  {
    variant: 'typical',
    label: '30-day window with per-vehicle, per-driver, and per-card breakdowns',
    input: {
      overview: overview(),
      byOfficer: [{ display_name: 'Marcus Reyes', fill_count: 12, total_gallons: 168.5, total_cost: 576.42, avg_mpg: 19.2, flag_rate: 2.1, avg_cpg: 3.42 }],
      byCard: [{ card_number: '****4417', provider: 'WEX', vehicle_number: '47', vehicle_make: 'Ford', vehicle_model: 'Explorer', spent: 576.42, monthly_limit: 800, pct_of_limit: 72.1 }],
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — no vehicles/stations/officers/cards',
    input: {
      overview: overview({ vehicles: [], top_stations: [], flagged_leaderboard: [], totals: { fill_count: 0, total_gallons: 0, total_cost: 0, avg_cpg: null, flag_rate: 0 } } as unknown as Partial<FuelAnalyticsOverview>),
      byOfficer: [],
      byCard: [],
    },
  },
  {
    variant: 'maximal',
    label: '40 vehicles/drivers/cards, year-boundary window',
    input: {
      overview: overview({
        since: '2026-01-01',
        days: 365,
        vehicles: Array.from({ length: 40 }, (_, i) => ({
          vehicle_number: `${47 + i}`, year: 2022, make: 'Ford', model: 'Explorer',
          fill_count: 12 + i, total_gallons: 168.5 + i, total_cost: 576.42 + i * 10, avg_mpg: 19.2, flag_rate: 2.1,
        })),
        top_stations: Array.from({ length: 10 }, (_, i) => ({ station: `Station ${i + 1}`, fill_count: 10, total_spent: 340.5, avg_cpg: 3.4 })),
        flagged_leaderboard: Array.from({ length: 10 }, (_, i) => ({ vehicle_number: `${47 + i}`, make: 'Ford', model: 'Explorer', flagged_count: 3 + i })),
      } as unknown as Partial<FuelAnalyticsOverview>),
      byOfficer: Array.from({ length: 40 }, (_, i) => ({
        display_name: `Officer ${i + 1}`, fill_count: 10, total_gallons: 140.2, total_cost: 480.1, avg_mpg: 18.5, flag_rate: 3.0, avg_cpg: 3.42,
      })),
      byCard: Array.from({ length: 40 }, (_, i) => ({
        card_number: `****441${i % 10}`, provider: 'WEX', vehicle_number: `${47 + i}`, vehicle_make: 'Ford', vehicle_model: 'Explorer', spent: 400.0, monthly_limit: 800, pct_of_limit: 50.0,
      })),
    },
  },
];

// ── Per-Vehicle Fuel Report (fleetFuelReport.ts) ──────────────

function summaryFuel(over: Partial<FleetFuelSummary> = {}): FleetFuelSummary {
  return {
    total_gallons: 168.5, total_cost: 576.42, avg_mpg: 19.2, avg_cost_per_gallon: 3.42,
    log_count: 12, best_mpg: 22.1, worst_mpg: 16.8, total_distance: 3235.4, cost_per_mile: 0.178,
    fuel_cost_per_day: 19.2, full_tank_count: 10,
    ...over,
  };
}

export const fleetFuelReportFixtures: PdfFixture<FleetFuelReportArgs>[] = [
  {
    variant: 'typical',
    label: 'Standard vehicle with a month of fill history and a summary',
    input: {
      vehicle: baseVehicle(),
      fuelLogs: [fuelLog(1, []), fuelLog(2, ['price-spike'])],
      summary: summaryFuel(),
      periodLabel: 'Last 30 Days (2026-05-22 to 2026-06-21)',
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — no fuel logs, no summary',
    input: { vehicle: minimalVehicle(), fuelLogs: [], summary: null },
  },
  {
    variant: 'maximal',
    label: '40-row fuel log table, year-boundary period',
    input: {
      vehicle: baseVehicle({ vehicle_number: '9999' }),
      fuelLogs: Array.from({ length: 40 }, (_, i) => fuelLog(i + 1, i % 5 === 0 ? ['mpg-anomaly'] : [])),
      summary: summaryFuel({ log_count: 40, total_gallons: 568.0, total_cost: 1942.16 }),
      periodLabel: 'Full Year 2026',
    },
  },
];

// ── Inspection Report (fleetInspectionReportPdf.ts) ───────────

function inspectionItem(i: number): InspectionItem {
  return { category: 'Lights & Signals', item: `Headlight assembly ${i}`, status: 'pass' };
}

function baseInspection(over: Partial<FleetInspection> = {}): FleetInspection {
  return {
    id: 'insp-1',
    vehicle_id: 'veh-47',
    inspection_type: 'monthly',
    inspector_name: 'Dana Whitlock',
    inspection_date: '2026-06-21',
    overall_result: 'pass',
    mileage: 42815,
    items: [inspectionItem(1), { category: 'Brakes', item: 'Brake pad wear', status: 'pass' }],
    notes: 'No defects observed during monthly DOT inspection.',
    created_by: 'Dana Whitlock',
    created_at: '2026-06-21T09:00:00Z',
    ...over,
  };
}

export const fleetInspectionReportFixtures: PdfFixture<FleetInspectionReportArgs>[] = [
  {
    variant: 'typical',
    label: 'Passing monthly inspection with a full checklist',
    input: { vehicle: baseVehicle(), inspection: baseInspection() },
  },
  {
    variant: 'empty',
    label: 'Required fields only — no items, no notes, no mileage',
    input: {
      vehicle: minimalVehicle(),
      inspection: {
        id: 'insp-2', vehicle_id: 'veh-99', inspection_type: 'pre_trip', inspector_name: 'Marcus Reyes',
        inspection_date: '2026-06-21', overall_result: 'needs_attention', items: [], created_at: '2026-06-21T09:00:00Z',
      },
    },
  },
  {
    variant: 'maximal',
    label: '40-item checklist across categories, 2,000-char notes, year-boundary date',
    input: {
      vehicle: baseVehicle({ vehicle_number: '9999' }),
      inspection: baseInspection({
        id: 'insp-3',
        inspection_date: '2026-12-31',
        overall_result: 'fail',
        notes: MAXIMAL_NARRATIVE,
        items: Array.from({ length: 40 }, (_, i) => ({
          category: (['Lights & Signals', 'Brakes', 'Tires', 'Fluids', 'DOT Compliance'] as const)[i % 5],
          item: `Checklist item ${i + 1}`,
          status: (['pass', 'fail', 'needs_attention', 'na'] as const)[i % 4],
          notes: i % 4 === 1 ? 'Requires follow-up per DOT inspection standard.' : undefined,
        })),
      }),
    },
  },
];

// ── Maintenance History (fleetMaintenanceHistoryPdf.ts) ───────

function maintenanceRecord(i: number): FleetMaintenance {
  return {
    id: `maint-${i}`,
    vehicle_id: 'veh-47',
    type: 'oil_change',
    description: 'Preventive maintenance — full synthetic oil change and filter replacement.',
    mileage_at_service: 42815 - i * 500,
    cost: 84.5,
    vendor: 'Salt Lake Fleet Service Center',
    performed_by: 'Salt Lake Fleet Service Center',
    performed_at: '2026-06-21T09:00:00Z',
    created_at: '2026-06-21T09:00:00Z',
  };
}

export const fleetMaintenanceHistoryFixtures: PdfFixture<FleetMaintenanceHistoryArgs>[] = [
  {
    variant: 'typical',
    label: 'Standard maintenance log with a few service types',
    input: {
      vehicle: baseVehicle(),
      records: [maintenanceRecord(1), { ...maintenanceRecord(2), type: 'tire_rotation', cost: 45.0 }],
      periodLabel: 'Last 6 Months',
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — no maintenance records',
    input: { vehicle: minimalVehicle(), records: [] },
  },
  {
    variant: 'maximal',
    label: '40-row maintenance history, year-boundary period',
    input: {
      vehicle: baseVehicle({ vehicle_number: '9999' }),
      records: Array.from({ length: 40 }, (_, i) => ({
        ...maintenanceRecord(i + 1),
        type: (['oil_change', 'tire_rotation', 'brake_service', 'inspection', 'repair', 'other'] as const)[i % 6],
        performed_at: YEAR_BOUNDARY,
      })),
      periodLabel: 'Full Year 2026',
    },
  },
];

// ── Vehicle Summary (fleetVehicleSummaryPdf.ts) ───────────────

export const fleetVehicleSummaryFixtures: PdfFixture<FleetVehicleSummaryArgs>[] = [
  {
    variant: 'typical',
    label: 'Assigned patrol vehicle with lifetime costs and recent maintenance',
    input: {
      vehicle: baseVehicle(),
      assignedOfficer: 'Marcus Reyes',
      assignedUnit: '4-Adam-12',
      costTotals: { fuel: 4817.5, maintenance: 2140.0, expenses: 512.75, insurance: 3200.0 },
      recentMaintenance: [
        { type: 'oil_change', performed_at: '2026-06-21T09:00:00Z', cost: 84.5 },
        { type: 'tire_rotation', performed_at: '2026-05-01T09:00:00Z', cost: 45.0 },
      ],
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — unassigned vehicle, no cost totals',
    input: { vehicle: minimalVehicle() },
  },
  {
    variant: 'maximal',
    label: '120-char officer name, 5-row recent maintenance, all cost categories populated',
    input: {
      vehicle: baseVehicle({ vehicle_number: '9999' }),
      assignedOfficer: MAXIMAL_NAME,
      assignedUnit: '4-Adam-99',
      costTotals: {
        fuel: 24817.5, maintenance: 11240.0, expenses: 2512.75, loans: 18400.0,
        insurance: 9200.0, accessories: 940.25, utilities: 315.6,
      },
      recentMaintenance: Array.from({ length: 5 }, (_, i) => ({
        type: (['oil_change', 'tire_rotation', 'brake_service', 'inspection', 'repair'] as const)[i],
        performed_at: YEAR_BOUNDARY,
        cost: 120.0 + i * 10,
      })),
    },
  },
];

// ── Batch 5g-1: fleetPdfReports.ts (first 9 document types) ──

function reportVehicle(i: number, over: Partial<FleetVehicle> = {}): FleetVehicle {
  return baseVehicle({
    id: `veh-${100 + i}`,
    vehicle_number: `${100 + i}`,
    plate_number: `UT-7X4K${(21 + i) % 100}`,
    current_mileage: 30000 + i * 1500,
    ...over,
  });
}

function fleetAnalyticsSummary(over: Partial<FleetAnalytics['fleet_summary']> = {}): FleetAnalytics {
  return {
    maintenance_cost_trend: [{ month: '2026-06', total_cost: 2140.0, count: 3 }],
    mileage_distribution: [{ range: '0-25000', count: 5 }, { range: '25001-50000', count: 8 }],
    status_breakdown: [{ status: 'in_service', count: 11, color: '#10b981' }, { status: 'out_of_service', count: 2, color: 'var(--sev-critical)' }],
    fuel_economy_trend: [{ month: '2026-06', avg_mpg: 19.2, total_gallons: 168.5, total_cost: 576.42 }],
    fleet_summary: {
      total_vehicles: 13,
      avg_mileage: 38400,
      avg_mpg: 19.2,
      total_maintenance_cost: 2140.0,
      total_fuel_cost: 576.42,
      vehicles_needing_service: 2,
      inspections_failing: 1,
      ...over,
    },
  };
}

// ── 1. Fleet Status Report ────────────────────────────────────

export const fleetStatusReportFixtures: PdfFixture<FleetStatusReportArgs>[] = [
  {
    variant: 'typical',
    label: 'Fleet-wide status with a mix of in-service and out-of-service units',
    input: {
      vehicles: [baseVehicle(), reportVehicle(1, { status: 'out_of_service' }), reportVehicle(2)],
      analytics: fleetAnalyticsSummary(),
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — one minimal vehicle, no analytics',
    input: { vehicles: [minimalVehicle()], analytics: null },
  },
  {
    variant: 'maximal',
    label: '40-vehicle fleet roster with full analytics summary',
    input: {
      vehicles: Array.from({ length: 40 }, (_, i) => reportVehicle(i, { status: (['in_service', 'out_of_service', 'maintenance'] as const)[i % 3] })),
      analytics: fleetAnalyticsSummary({ total_vehicles: 40, vehicles_needing_service: 6, inspections_failing: 3 }),
    },
  },
];

// ── 2. Fleet Maintenance History Report ───────────────────────

export const fleetMaintenanceReportFixtures: PdfFixture<FleetMaintenanceReportArgs>[] = [
  {
    variant: 'typical',
    label: 'Standard maintenance record set for one vehicle',
    input: {
      vehicle: baseVehicle(),
      records: [maintenanceRecord(1), { ...maintenanceRecord(2), type: 'brake_service', cost: 210.0 }],
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — no maintenance records',
    input: { vehicle: minimalVehicle(), records: [] },
  },
  {
    variant: 'maximal',
    label: '40-row maintenance history, year-boundary service dates',
    input: {
      vehicle: baseVehicle({ vehicle_number: '9999' }),
      records: Array.from({ length: 40 }, (_, i) => ({
        ...maintenanceRecord(i + 1),
        type: (['oil_change', 'tire_rotation', 'brake_service', 'inspection', 'repair', 'other'] as const)[i % 6],
        performed_at: YEAR_BOUNDARY,
        next_due_date: YEAR_BOUNDARY,
      })),
    },
  },
];

// ── 3. Fleet Cost Analysis Report ─────────────────────────────

export const fleetCostReportFixtures: PdfFixture<FleetCostReportArgs>[] = [
  {
    variant: 'typical',
    label: 'Vehicle with fuel logs, a fuel summary, and maintenance cost breakdown',
    input: {
      vehicle: baseVehicle(),
      fuelLogs: [fuelLog(1, []), fuelLog(2, ['price-spike'])],
      fuelSummary: summaryFuel(),
      maintenanceRecords: [maintenanceRecord(1), { ...maintenanceRecord(2), type: 'brake_service', cost: 210.0 }],
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — no fuel logs, no fuel summary, no maintenance',
    input: { vehicle: minimalVehicle(), fuelLogs: [], fuelSummary: null, maintenanceRecords: [] },
  },
  {
    variant: 'maximal',
    label: '40-row fuel and maintenance history, cost-per-mile computed',
    input: {
      vehicle: baseVehicle({ vehicle_number: '9999' }),
      fuelLogs: Array.from({ length: 40 }, (_, i) => fuelLog(i + 1, i % 5 === 0 ? ['mpg-anomaly'] : [])),
      fuelSummary: summaryFuel({ log_count: 40, total_gallons: 568.0, total_cost: 1942.16, total_distance: 12940.0 }),
      maintenanceRecords: Array.from({ length: 40 }, (_, i) => ({
        ...maintenanceRecord(i + 1),
        type: (['oil_change', 'tire_rotation', 'brake_service', 'inspection', 'repair', 'other'] as const)[i % 6],
        performed_at: YEAR_BOUNDARY,
      })),
    },
  },
];

// ── 4. Fleet Lifecycle Report ──────────────────────────────────

function assignmentRecord(i: number, over: Partial<FleetAssignment> = {}): FleetAssignment {
  return {
    id: `assign-${i}`,
    vehicle_id: 'veh-47',
    unit_id: 'unit-12',
    unit_call_sign: '4-Adam-12',
    officer_name: 'Marcus Reyes',
    assigned_at: '2026-01-01T08:00:00Z',
    unassigned_at: '2026-06-01T08:00:00Z',
    created_at: '2026-01-01T08:00:00Z',
    ...over,
  };
}

export const fleetLifecycleReportFixtures: PdfFixture<FleetLifecycleReportArgs>[] = [
  {
    variant: 'typical',
    label: 'Full lifecycle: fuel, maintenance, inspections, and assignment history',
    input: {
      vehicle: baseVehicle(),
      fuelLogs: [fuelLog(1, []), fuelLog(2, [])],
      maintenanceRecords: [maintenanceRecord(1)],
      inspections: [baseInspection()],
      assignments: [assignmentRecord(1)],
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — no fuel, maintenance, inspections, or assignments',
    input: { vehicle: minimalVehicle(), fuelLogs: [], maintenanceRecords: [], inspections: [], assignments: [] },
  },
  {
    variant: 'maximal',
    label: '40-row maintenance history plus a full lifecycle of related records',
    input: {
      vehicle: baseVehicle({ vehicle_number: '9999' }),
      fuelLogs: Array.from({ length: 40 }, (_, i) => fuelLog(i + 1, [])),
      maintenanceRecords: Array.from({ length: 40 }, (_, i) => ({
        ...maintenanceRecord(i + 1),
        performed_at: YEAR_BOUNDARY,
      })),
      inspections: Array.from({ length: 5 }, (_, i) => baseInspection({ id: `insp-${i + 1}`, inspection_date: YEAR_BOUNDARY })),
      assignments: Array.from({ length: 5 }, (_, i) => assignmentRecord(i + 1, { assigned_at: YEAR_BOUNDARY })),
    },
  },
];

// ── 5. Fleet Compliance Report ─────────────────────────────────

export const fleetComplianceReportFixtures: PdfFixture<FleetComplianceReportArgs>[] = [
  {
    variant: 'typical',
    label: 'Fleet with a mix of compliant and expired-document vehicles',
    input: {
      vehicles: [
        baseVehicle(),
        reportVehicle(1, { insurance_expiry: '2026-01-01', registration_expiry: '2026-01-01', next_service_due: '2026-01-01' }),
      ],
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — one minimal vehicle, no expiry dates',
    input: { vehicles: [minimalVehicle()] },
  },
  {
    variant: 'maximal',
    label: '40-vehicle roster, all documents expired',
    input: {
      vehicles: Array.from({ length: 40 }, (_, i) => reportVehicle(i, {
        insurance_expiry: '2026-01-01', registration_expiry: '2026-01-01', last_service_date: '2025-06-01', next_service_due: '2026-01-01',
      })),
    },
  },
];

// ── 6. Fleet Utilization Report ────────────────────────────────

export const fleetUtilizationReportFixtures: PdfFixture<FleetUtilizationReportArgs>[] = [
  {
    variant: 'typical',
    label: '30-day utilization for a handful of patrol vehicles',
    input: {
      vehicles: [
        { ...baseVehicle(), days_used: 27, miles_driven: 2140, fuel_cost: 412.5, daily_avg_miles: 79.3 },
        { ...reportVehicle(1), days_used: 18, miles_driven: 1120, fuel_cost: 260.1, daily_avg_miles: 62.2 },
      ],
      days: 30,
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — one vehicle, no usage stats, default window',
    input: { vehicles: [minimalVehicle()] },
  },
  {
    variant: 'maximal',
    label: '40-vehicle utilization table over a full year',
    input: {
      vehicles: Array.from({ length: 40 }, (_, i) => ({
        ...reportVehicle(i),
        days_used: 300 + i,
        miles_driven: 18000 + i * 100,
        fuel_cost: 3200.5 + i * 10,
        daily_avg_miles: 60 + (i % 20),
      })),
      days: 365,
    },
  },
];

// ── 7. Fleet Fuel Consumption & Emissions Report ──────────────

export const fleetFuelConsumptionReportFixtures: PdfFixture<FleetFuelConsumptionReportArgs>[] = [
  {
    variant: 'typical',
    label: 'Fleet-wide gallons and CO2 emissions for a handful of vehicles',
    input: {
      vehicles: [
        { ...baseVehicle(), total_gallons: 168.5, co2_kg: 384.2, co2_lbs: 847.2 },
        { ...reportVehicle(1), total_gallons: 142.0, co2_kg: 324.1, co2_lbs: 714.6 },
      ],
      totalGallons: 310.5,
      totalCo2: 708.3,
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — one vehicle, no gallon/CO2 totals',
    input: { vehicles: [minimalVehicle()] },
  },
  {
    variant: 'maximal',
    label: '40-vehicle emissions table, full-year totals',
    input: {
      vehicles: Array.from({ length: 40 }, (_, i) => ({
        ...reportVehicle(i),
        total_gallons: 150.0 + i * 5,
        co2_kg: 340.0 + i * 10,
        co2_lbs: 750.0 + i * 22,
      })),
      totalGallons: 8400.0,
      totalCo2: 19200.0,
    },
  },
];

// ── 8. Fleet Accident Report ───────────────────────────────────

export const fleetAccidentReportFixtures: PdfFixture<FleetAccidentReportArgs>[] = [
  {
    variant: 'typical',
    label: 'Single-vehicle collision with insurance claim and estimated damage',
    input: {
      vehicle: baseVehicle(),
      accident: {
        accident_date: '2026-06-21T09:00:00Z',
        location: '1400 S State St, Salt Lake City, UT 84115',
        severity: 'moderate',
        weather_conditions: 'clear',
        road_conditions: 'dry',
        police_report_number: 'PR-2026-004417',
        insurance_claim_number: 'CLM-2026-004417',
        estimated_damage: 4850.0,
        injuries: 0,
        fault_determination: 'other_party',
        status: 'closed',
        description: 'Rear-ended at a stoplight during a low-speed patrol response; no injuries reported.',
      },
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — minimal vehicle, near-empty accident record',
    input: { vehicle: minimalVehicle(), accident: { accident_date: '2026-06-21T09:00:00Z' } },
  },
  {
    variant: 'maximal',
    label: '2,000-char description, high injury count, year-boundary date',
    input: {
      vehicle: baseVehicle({ vehicle_number: '9999' }),
      accident: {
        accident_date: YEAR_BOUNDARY,
        location: '1400 S State St, Salt Lake City, UT 84115',
        severity: 'severe',
        weather_conditions: 'snow',
        road_conditions: 'icy',
        police_report_number: 'PR-2026-009999',
        insurance_claim_number: 'CLM-2026-009999',
        estimated_damage: 48250.75,
        injuries: 3,
        fault_determination: 'pending',
        status: 'open',
        description: MAXIMAL_NARRATIVE,
      },
    },
  },
];

// ── 9. Fleet Budget Report ──────────────────────────────────────

export const fleetBudgetReportFixtures: PdfFixture<FleetBudgetReportArgs>[] = [
  {
    variant: 'typical',
    label: 'Fiscal-year budget across a few categories, mixed utilization',
    input: {
      fiscalYear: 2026,
      budgets: [
        { category: 'Fuel', allocated_amount: 48000.0, spent_amount: 41200.5 },
        { category: 'Maintenance', allocated_amount: 24000.0, spent_amount: 15840.0 },
        { category: 'Insurance', allocated_amount: 36000.0, spent_amount: 36000.0 },
      ],
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — single zero-allocated category',
    input: { fiscalYear: 2026, budgets: [{ category: 'Fuel', allocated_amount: 0, spent_amount: 0 }] },
  },
  {
    variant: 'maximal',
    label: '40-category budget breakdown, one severely over budget',
    input: {
      fiscalYear: 2026,
      budgets: Array.from({ length: 40 }, (_, i) => ({
        category: `${MAXIMAL_NAME.trim().slice(0, 30)} Category ${i + 1}`,
        allocated_amount: 1000.0 + i * 50,
        spent_amount: i === 0 ? 5000.0 : 800.0 + i * 40,
      })),
    },
  },
];

// ── 10. Fleet Vehicle Replacement Plan Report ──────────────────

function replacementVehicle(i: number, over: Record<string, unknown> = {}) {
  return {
    ...reportVehicle(i),
    replacement_year: 2027 + (i % 3),
    replacement_reason: 'High mileage and rising preventive-maintenance cost per mile.',
    estimated_replacement_cost: 42000.0 + i * 500,
    rp_priority: (['critical', 'high', 'medium', 'low'] as const)[i % 4],
    rp_status: 'planned',
    ...over,
  };
}

export const fleetReplacementReportFixtures: PdfFixture<FleetReplacementReportArgs>[] = [
  {
    variant: 'typical',
    label: 'Replacement plan with a mix of priority levels',
    input: {
      vehicles: [
        replacementVehicle(1, { rp_priority: 'critical' }),
        replacementVehicle(2, { rp_priority: 'medium' }),
      ],
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — one minimal vehicle, no replacement plan data',
    input: { vehicles: [{ ...minimalVehicle() }] },
  },
  {
    variant: 'maximal',
    label: '40-vehicle replacement roster, 35-char reason text',
    input: {
      vehicles: Array.from({ length: 40 }, (_, i) => replacementVehicle(i, { replacement_reason: MAXIMAL_NARRATIVE })),
    },
  },
];

// ── 11. Fleet Depreciation Schedule Report ──────────────────────

function depreciationVehicle(i: number, over: Record<string, unknown> = {}) {
  return {
    ...reportVehicle(i),
    depreciation: {
      purchase_price: 42000.0 + i * 500,
      salvage_value: 8000.0,
      useful_life_months: 96,
      monthly_depreciation: 354.17,
      accumulated_depreciation: 12750.0 + i * 100,
      current_book_value: 29250.0 - i * 100,
    },
    ...over,
  };
}

export const fleetDepreciationReportFixtures: PdfFixture<FleetDepreciationReportArgs>[] = [
  {
    variant: 'typical',
    label: 'Depreciation schedule for a handful of vehicles',
    input: { vehicles: [depreciationVehicle(1), depreciationVehicle(2)] },
  },
  {
    variant: 'empty',
    label: 'Required fields only — one vehicle with no depreciation data',
    input: { vehicles: [{ ...minimalVehicle(), depreciation: null }] },
  },
  {
    variant: 'maximal',
    label: '40-vehicle depreciation schedule, high accumulated depreciation',
    input: {
      vehicles: Array.from({ length: 40 }, (_, i) => depreciationVehicle(i, {
        depreciation: {
          purchase_price: 68000.0 + i * 200,
          salvage_value: 6000.0,
          useful_life_months: 120,
          monthly_depreciation: 516.67,
          accumulated_depreciation: 48000.0 + i * 200,
          current_book_value: 14000.0 - (i % 10) * 50,
        },
      })),
    },
  },
];

// ── 12. Fleet Key Management Report ─────────────────────────────

function keyRecord(i: number, over: Record<string, unknown> = {}): {
  vehicle_number?: string; key_number?: string; key_type?: string; rfid_tag?: string; status?: string;
  current_holder?: string; last_checkout?: string; last_return?: string;
} {
  return {
    vehicle_number: `${100 + i}`,
    key_number: '1',
    key_type: 'ignition',
    rfid_tag: `RFID-${4400 + i}`,
    status: 'available',
    current_holder: 'Marcus Reyes',
    last_checkout: '2026-06-20T08:00:00',
    last_return: '2026-06-20T18:00:00',
    ...over,
  };
}

export const fleetKeyReportFixtures: PdfFixture<FleetKeyReportArgs>[] = [
  {
    variant: 'typical',
    label: 'Key inventory with checked-out and available keys',
    input: {
      keys: [keyRecord(1, { status: 'checked_out' }), keyRecord(2, { status: 'available' })],
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — a single key with no holder or checkout history',
    input: { keys: [{}] },
  },
  {
    variant: 'maximal',
    label: '40-key inventory including a lost key',
    input: {
      keys: Array.from({ length: 40 }, (_, i) => keyRecord(i + 1, {
        status: (['available', 'checked_out', 'lost'] as const)[i % 3],
        current_holder: MAXIMAL_NAME,
      })),
    },
  },
];

// ── 13. Fleet Health Scorecard Report ───────────────────────────

export const fleetScorecardReportFixtures: PdfFixture<FleetScorecardReportArgs>[] = [
  {
    variant: 'typical',
    label: 'Healthy fleet with a few open issues',
    input: {
      total: 13, active: 11, in_maintenance: 2, needing_service: 2,
      expiring_insurance: 1, expiring_registration: 0, open_recalls: 1,
      open_accidents: 0, fuel_this_month: { cost: 4068.75, gallons: 1189.4 },
      maintenance_this_month: { cost: 2140.0, count: 3 }, avg_mpg: 19.2, health_score: 84,
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — zero fleet, no fuel/maintenance-month data',
    input: {
      total: 0, active: 0, in_maintenance: 0, needing_service: 0,
      expiring_insurance: 0, expiring_registration: 0, open_recalls: 0,
      open_accidents: 0, fuel_this_month: null, maintenance_this_month: null,
      avg_mpg: null, health_score: 0,
    },
  },
  {
    variant: 'maximal',
    label: 'Distressed fleet with every issue category populated',
    input: {
      total: 40, active: 22, in_maintenance: 8, needing_service: 12,
      expiring_insurance: 9, expiring_registration: 7, open_recalls: 5,
      open_accidents: 4, fuel_this_month: { cost: 24817.5, gallons: 7189.4 },
      maintenance_this_month: { cost: 11240.0, count: 22 }, avg_mpg: 14.1, health_score: 38,
    },
  },
];

// ── 14. Personnel Productivity Report ───────────────────────────

function personnelRow(i: number, over: Record<string, unknown> = {}) {
  return {
    officer_id: `off-${i}`,
    officer_name: `Officer ${i}`,
    call_sign: `4-Adam-${10 + i}`,
    vehicle_number: `${100 + i}`,
    vehicle_label: `#${100 + i} 2022 Ford Explorer`,
    total_assignments: 6,
    total_miles: 2140,
    total_hours: 172.5,
    active_assignments: 1,
    ...over,
  };
}

export const personnelProductivityReportFixtures: PdfFixture<PersonnelProductivityReportArgs>[] = [
  {
    variant: 'typical',
    label: 'Productivity roster for a handful of officers',
    input: {
      rows: [
        { officer_name: 'Dana Whitlock', call_sign: '4-Adam-12', vehicle_label: '#47 2022 Ford Explorer', total_assignments: 8, total_miles: 3120, total_hours: 210.5, active_assignments: 1 },
        { officer_name: 'Marcus Reyes', call_sign: '4-Adam-13', vehicle_label: '#101 2021 Ford Explorer', total_assignments: 5, total_miles: 1840, total_hours: 145.0, active_assignments: 0 },
      ],
      totalOfficers: 2,
      totalMiles: 4960,
      totalHours: 355.5,
      days: 30,
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — a single row with only the required counters',
    input: { rows: [{ total_assignments: 0, total_miles: 0, total_hours: 0, active_assignments: 0 }] },
  },
  {
    variant: 'maximal',
    label: '40-officer productivity table over a full year',
    input: {
      rows: Array.from({ length: 40 }, (_, i) => personnelRow(i + 1, { officer_name: i === 0 ? MAXIMAL_NAME : `Officer ${i + 1}` })),
      totalOfficers: 40,
      totalMiles: 85600,
      totalHours: 6900.0,
      days: 365,
    },
  },
];

// ── 15. Inspection Analysis Report ──────────────────────────────

function inspectionAnalysisRow(i: number, over: Record<string, unknown> = {}) {
  return {
    vehicle_number: `${100 + i}`,
    vehicle_label: `#${100 + i} 2022 Ford Explorer`,
    total: 12,
    passed: 11,
    failed: 1,
    pass_rate: 91.7,
    last_inspection_date: '2026-06-21',
    last_result: 'pass' as const,
    common_failures: ['Brake pad wear'],
    ...over,
  };
}

export const inspectionAnalysisReportFixtures: PdfFixture<InspectionAnalysisReportArgs>[] = [
  {
    variant: 'typical',
    label: 'Inspection pass/fail analysis with common failure items',
    input: {
      rows: [inspectionAnalysisRow(1), inspectionAnalysisRow(2, { pass_rate: 65.0, last_result: 'fail' as const })],
      totalInspections: 24,
      overallPassRate: 78.4,
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — one vehicle, no common failures, no totals',
    input: {
      rows: [{ vehicle_number: '99', total: 0, passed: 0, failed: 0, pass_rate: 0 }],
    },
  },
  {
    variant: 'maximal',
    label: '40-vehicle inspection analysis with a common-failures leaderboard',
    input: {
      rows: Array.from({ length: 40 }, (_, i) => inspectionAnalysisRow(i + 1, {
        pass_rate: 50 + (i % 50),
        last_result: (['pass', 'fail'] as const)[i % 2],
        common_failures: ['Brake pad wear', 'Headlight assembly', 'DOT compliance placard'],
      })),
      totalInspections: 480,
      overallPassRate: 71.2,
    },
  },
];

// ── 16. Cost-Per-Mile Report ─────────────────────────────────────

function costPerMileRow(i: number, over: Record<string, unknown> = {}) {
  return {
    vehicle_number: `${100 + i}`,
    vehicle_label: `#${100 + i} 2022 Ford Explorer`,
    year: 2022,
    current_mileage: 42815 + i * 1000,
    total_cost: 7957.5,
    fuel_cost: 4817.5,
    maintenance_cost: 3140.0,
    insurance_cost: 3200.0,
    miles_driven: 42815,
    cost_per_mile: 0.186,
    mpg: 19.2,
    ...over,
  };
}

export const costPerMileReportFixtures: PdfFixture<CostPerMileReportArgs>[] = [
  {
    variant: 'typical',
    label: 'Cost-per-mile ranking for a handful of vehicles',
    input: {
      rows: [costPerMileRow(1), costPerMileRow(2, { cost_per_mile: 0.142, mpg: 22.4 })],
      fleetAverageCpm: 0.164,
      totalCost: 15915.0,
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — one vehicle, no MPG, no fleet average',
    input: {
      rows: [{ vehicle_number: '99', current_mileage: 0, total_cost: 0, fuel_cost: 0, maintenance_cost: 0, cost_per_mile: 0, mpg: null }],
    },
  },
  {
    variant: 'maximal',
    label: '40-vehicle cost-per-mile ranking, full-year totals',
    input: {
      rows: Array.from({ length: 40 }, (_, i) => costPerMileRow(i + 1, { cost_per_mile: 0.5 - i * 0.01 })),
      fleetAverageCpm: 0.198,
      totalCost: 318300.0,
    },
  },
];

// ── 17. Maintenance Forecast Report ─────────────────────────────

function maintenanceForecastRow(i: number, over: Record<string, unknown> = {}) {
  return {
    vehicle_number: `${100 + i}`,
    vehicle_label: `#${100 + i} 2022 Ford Explorer`,
    current_mileage: 42815 + i * 500,
    next_service_mileage: 45000 + i * 500,
    miles_until_service: 2185,
    avg_daily_miles: 79.3,
    est_days_until_service: 27,
    last_service_date: '2026-05-01',
    last_service_cost: 84.5,
    urgency: 'ok' as const,
    ...over,
  };
}

export const maintenanceForecastReportFixtures: PdfFixture<MaintenanceForecastReportArgs>[] = [
  {
    variant: 'typical',
    label: 'Forecast with a mix of urgency levels',
    input: {
      rows: [
        maintenanceForecastRow(1, { urgency: 'overdue' as const, miles_until_service: -320 }),
        maintenanceForecastRow(2, { urgency: 'warning' as const }),
      ],
      overdueCount: 1,
      upcomingCount: 1,
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — one vehicle at OK urgency, no estimate',
    input: {
      rows: [{ vehicle_number: '99', current_mileage: 0, next_service_mileage: 0, miles_until_service: 0, avg_daily_miles: 0, est_days_until_service: null, urgency: 'ok' as const }],
    },
  },
  {
    variant: 'maximal',
    label: '40-vehicle forecast, majority overdue or critical',
    input: {
      rows: Array.from({ length: 40 }, (_, i) => maintenanceForecastRow(i + 1, {
        urgency: (['overdue', 'critical', 'warning', 'ok'] as const)[i % 4],
      })),
      overdueCount: 10,
      upcomingCount: 20,
    },
  },
];

// ── 18. Compliance Audit Report ──────────────────────────────────

function complianceRow(i: number, over: Record<string, unknown> = {}) {
  return {
    vehicle_number: `${100 + i}`,
    vehicle_label: `#${100 + i} 2022 Ford Explorer`,
    insurance_status: 'valid' as const,
    insurance_expiry: '2027-01-01',
    registration_status: 'valid' as const,
    registration_expiry: '2027-03-01',
    inspection_status: 'valid' as const,
    inspection_expiry: '2026-12-01',
    open_recalls: 0,
    overdue_service: 0,
    compliance_score: 100,
    ...over,
  };
}

export const complianceAuditReportFixtures: PdfFixture<ComplianceAuditReportArgs>[] = [
  {
    variant: 'typical',
    label: 'Audit with a mix of compliant and expiring-document vehicles',
    input: {
      rows: [
        complianceRow(1),
        complianceRow(2, { insurance_status: 'expiring' as const, compliance_score: 78 }),
      ],
      totalVehicles: 2,
      fullyCompliant: 1,
      issuesCount: 1,
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — one vehicle, no expiry dates',
    input: {
      rows: [{
        vehicle_number: '99', insurance_status: 'valid' as const, registration_status: 'valid' as const,
        inspection_status: 'valid' as const, open_recalls: 0, overdue_service: 0, compliance_score: 100,
      }],
    },
  },
  {
    variant: 'maximal',
    label: '40-vehicle audit with fully expired documents and low scores',
    input: {
      rows: Array.from({ length: 40 }, (_, i) => complianceRow(i + 1, {
        insurance_status: 'expired' as const,
        registration_status: 'expired' as const,
        inspection_status: 'expired' as const,
        open_recalls: i % 3,
        overdue_service: i % 2,
        compliance_score: 20 + (i % 30),
      })),
      totalVehicles: 40,
      fullyCompliant: 0,
      issuesCount: 40,
    },
  },
];
