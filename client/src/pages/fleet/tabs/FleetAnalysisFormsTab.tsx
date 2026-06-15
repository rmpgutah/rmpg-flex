import { useState, useMemo, useCallback } from 'react';
import {
  FileText, Download, Filter, Calendar, Users, Wrench, Shield,
  AlertTriangle, Gauge, BarChart3, Loader2, Car,
} from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { useToast } from '../../../components/ToastProvider';
import {
  generatePersonnelProductivityReport,
  generateInspectionAnalysisReport,
  generateCostPerMileReport,
  generateMaintenanceForecastReport,
  generateComplianceAuditReport,
} from '../utils/fleetPdfReports';
import type {
  FleetVehicle, FleetMaintenance, FleetInspection, FleetFuelLog,
  FleetAssignment,
} from '../../../types';

type ReportType =
  | 'personnel_productivity'
  | 'inspection_analysis'
  | 'cost_per_mile'
  | 'maintenance_forecast'
  | 'compliance_audit';

const REPORT_LABELS: Record<ReportType, string> = {
  personnel_productivity: 'Personnel Productivity',
  inspection_analysis: 'Inspection Analysis',
  cost_per_mile: 'Cost-Per-Mile Breakdown',
  maintenance_forecast: 'Maintenance Forecast',
  compliance_audit: 'Compliance Audit',
};

const REPORT_DESCRIPTIONS: Record<ReportType, string> = {
  personnel_productivity: 'Assignment density per officer, derived from vehicle assignment timestamps.',
  inspection_analysis: 'Pass/fail rates and common item failures, per vehicle.',
  cost_per_mile: 'Per-vehicle cost efficiency, ranked most-to-least expensive.',
  maintenance_forecast: 'Vehicles due for service, ranked by urgency (overdue → 30 days).',
  compliance_audit: 'Insurance, registration, and overdue-service flags in one report.',
};

const REPORT_ICONS: Record<ReportType, typeof Users> = {
  personnel_productivity: Users,
  inspection_analysis: Shield,
  cost_per_mile: BarChart3,
  maintenance_forecast: Wrench,
  compliance_audit: AlertTriangle,
};

export default function FleetAnalysisFormsTab({
  vehicles,
  vehicleNumberById,
}: {
  vehicles: FleetVehicle[];
  vehicleNumberById: Map<string | number, string>;
}) {
  const { addToast } = useToast();
  const [generating, setGenerating] = useState<ReportType | null>(null);

  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d' | '365d' | 'ytd' | 'all'>('30d');
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<(string | number)[]>([]);
  const [minMileage, setMinMileage] = useState<number>(0);
  const [groupBy, setGroupBy] = useState<'vehicle' | 'officer' | 'type'>('vehicle');

  const vehicleOptions = useMemo(
    () =>
      [...vehicles]
        .map((v) => ({
          id: v.id,
          number: v.vehicle_number || `#${v.id}`,
          label: [v.year, v.make, v.model].filter(Boolean).join(' '),
          status: v.status,
        }))
        .sort((a, b) => a.number.localeCompare(b.number)),
    [vehicles],
  );

  const toggleVehicle = useCallback((id: string | number) => {
    setSelectedVehicleIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const selectAll = useCallback(() => {
    setSelectedVehicleIds(vehicleOptions.map((v) => v.id));
  }, [vehicleOptions]);

  const clearSelection = useCallback(() => setSelectedVehicleIds([]), []);

  const dateRangeStart = useMemo(() => {
    const now = new Date();
    if (dateRange === '7d') return new Date(now.getTime() - 7 * 86400_000);
    if (dateRange === '30d') return new Date(now.getTime() - 30 * 86400_000);
    if (dateRange === '90d') return new Date(now.getTime() - 90 * 86400_000);
    if (dateRange === '365d') return new Date(now.getTime() - 365 * 86400_000);
    if (dateRange === 'ytd') return new Date(now.getFullYear(), 0, 1);
    return new Date(0);
  }, [dateRange]);

  const fetchAllData = useCallback(async () => {
    const [maintenance, fuelLogs, inspections, assignments] = await Promise.all([
      apiFetch<FleetMaintenance[]>('/fleet/maintenance').catch(() => [] as FleetMaintenance[]),
      apiFetch<FleetFuelLog[]>('/fleet/fuel-logs').catch(() => [] as FleetFuelLog[]),
      apiFetch<FleetInspection[]>('/fleet/inspections').catch(() => [] as FleetInspection[]),
      apiFetch<FleetAssignment[]>('/fleet/assignments').catch(() => [] as FleetAssignment[]),
    ]);
    return { maintenance, fuelLogs, inspections, assignments };
  }, []);

  const handleGenerate = useCallback(async (report: ReportType) => {
    setGenerating(report);
    try {
      const data = await fetchAllData();

      const inRange = (dateStr?: string) => {
        if (!dateStr || dateRange === 'all') return true;
        const d = new Date(dateStr.replace(' ', 'T'));
        return d >= dateRangeStart;
      };

      const vehiclesInRange = vehicles.filter((v) => {
        if (selectedVehicleIds.length && !selectedVehicleIds.includes(v.id)) return false;
        if (minMileage > 0 && (v.current_mileage ?? 0) < minMileage) return false;
        return true;
      });

      const maintenanceFiltered = data.maintenance.filter((m) => inRange(m.performed_at));
      const fuelFiltered = data.fuelLogs.filter((f) => inRange(f.fuel_date));
      const inspectionsFiltered = data.inspections.filter((i) => inRange(i.inspection_date));
      const assignmentsFiltered = data.assignments.filter((a) => inRange(a.assigned_at));

      const vehicleLabel = (id: string) => vehicleNumberById.get(id) ?? `#${id}`;
      const vehicleFullLabel = (id: string) => {
        const v = vehicles.find((x) => x.id === id);
        return v ? [v.year, v.make, v.model].filter(Boolean).join(' ') : '';
      };

      switch (report) {
        case 'personnel_productivity': {
          const officerMap = new Map<string, {
            name: string; call_sign?: string; vehicleIds: Set<string>;
            total_assignments: number; active_assignments: number;
          }>();
          for (const a of assignmentsFiltered) {
            const key = a.officer_name || a.unit_call_sign || a.unit_id || 'Unknown';
            const existing = officerMap.get(key) ?? {
              name: a.officer_name ?? a.unit_call_sign ?? 'Unknown',
              call_sign: a.unit_call_sign,
              vehicleIds: new Set(),
              total_assignments: 0,
              active_assignments: 0,
            };
            existing.total_assignments += 1;
            if (!a.unassigned_at) existing.active_assignments += 1;
            if (a.vehicle_id) existing.vehicleIds.add(a.vehicle_id);
            officerMap.set(key, existing);
          }
          const rows = [...officerMap.entries()].map(([id, v]) => ({
            officer_id: id,
            officer_name: v.name,
            call_sign: v.call_sign,
            vehicle_label: [...v.vehicleIds].map(vehicleLabel).join(', ') || '-',
            total_assignments: v.total_assignments,
            active_assignments: v.active_assignments,
            total_miles: 0,
            total_hours: 0,
          }));
          generatePersonnelProductivityReport({
            rows,
            totalMiles: 0,
            totalHours: 0,
            days: dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : dateRange === '90d' ? 90 : dateRange === '365d' ? 365 : 30,
          });
          addToast(`Generated ${REPORT_LABELS[report]} (${rows.length} officers)`, 'success');
          break;
        }
        case 'inspection_analysis': {
          const vehicleInspections = new Map<string, FleetInspection[]>();
          for (const i of inspectionsFiltered) {
            if (!vehicleInspections.has(i.vehicle_id)) vehicleInspections.set(i.vehicle_id, []);
            vehicleInspections.get(i.vehicle_id)!.push(i);
          }
          const rows = [...vehicleInspections.entries()].map(([vid, items]) => {
            const passed = items.filter((i) => i.overall_result === 'pass').length;
            const failed = items.filter((i) => i.overall_result === 'fail').length;
            const sorted = [...items].sort((a, b) => (b.inspection_date || '').localeCompare(a.inspection_date || ''));
            const failures: Record<string, number> = {};
            for (const i of items) {
              for (const it of i.items) {
                if (it.status === 'fail' || it.status === 'needs_attention') {
                  failures[it.item] = (failures[it.item] ?? 0) + 1;
                }
              }
            }
            return {
              vehicle_number: vehicleLabel(vid),
              vehicle_label: vehicleFullLabel(vid) || undefined,
              total: items.length,
              passed,
              failed,
              pass_rate: items.length ? (passed / items.length) * 100 : 0,
              last_inspection_date: sorted[0]?.inspection_date,
              last_result: sorted[0]?.overall_result === 'pass' ? 'pass' as const : 'fail' as const,
              common_failures: Object.entries(failures).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f]) => f),
            };
          });
          const totalInspections = rows.reduce((s, r) => s + r.total, 0);
          const overallPass = rows.reduce((s, r) => s + r.passed, 0);
          generateInspectionAnalysisReport({
            rows,
            totalInspections,
            overallPassRate: totalInspections ? (overallPass / totalInspections) * 100 : 0,
          });
          addToast(`Generated ${REPORT_LABELS[report]} (${rows.length} vehicles)`, 'success');
          break;
        }
        case 'cost_per_mile': {
          const costByVehicle = new Map<string, { fuel: number; maint: number }>();
          for (const f of fuelFiltered) {
            const existing = costByVehicle.get(f.vehicle_id) ?? { fuel: 0, maint: 0 };
            existing.fuel += Number(f.total_cost) || 0;
            costByVehicle.set(f.vehicle_id, existing);
          }
          for (const m of maintenanceFiltered) {
            const existing = costByVehicle.get(m.vehicle_id) ?? { fuel: 0, maint: 0 };
            existing.maint += Number(m.cost) || 0;
            costByVehicle.set(m.vehicle_id, existing);
          }
          const milesByVehicle = new Map<string, number>();
          for (const f of fuelFiltered) {
            if (f.distance) {
              milesByVehicle.set(f.vehicle_id, (milesByVehicle.get(f.vehicle_id) ?? 0) + Number(f.distance));
            }
          }
          const rows = vehiclesInRange.map((v) => {
            const costs = costByVehicle.get(v.id) ?? { fuel: 0, maint: 0 };
            const total_cost = costs.fuel + costs.maint;
            const miles_driven = milesByVehicle.get(v.id) ?? 0;
            const cost_per_mile = miles_driven > 0 ? total_cost / miles_driven : 0;
            const gal = fuelFiltered.filter((f) => f.vehicle_id === v.id).reduce((s, f) => s + (Number(f.gallons) || 0), 0);
            const mpg = gal > 0 && miles_driven > 0 ? miles_driven / gal : null;
            return {
              vehicle_number: vehicleLabel(v.id),
              vehicle_label: vehicleFullLabel(v.id),
              year: v.year ?? undefined,
              current_mileage: v.current_mileage ?? 0,
              total_cost,
              fuel_cost: costs.fuel,
              maintenance_cost: costs.maint,
              miles_driven,
              cost_per_mile,
              mpg,
            };
          }).filter((r) => r.cost_per_mile > 0);
          generateCostPerMileReport({
            rows,
            totalCost: rows.reduce((s, r) => s + r.total_cost, 0),
            fleetAverageCpm: rows.length ? rows.reduce((s, r) => s + r.cost_per_mile, 0) / rows.length : 0,
          });
          addToast(`Generated ${REPORT_LABELS[report]} (${rows.length} vehicles)`, 'success');
          break;
        }
        case 'maintenance_forecast': {
          const rows = vehiclesInRange.map((v) => {
            const recent = maintenanceFiltered
              .filter((m) => m.vehicle_id === v.id)
              .sort((a, b) => (b.performed_at || '').localeCompare(a.performed_at || ''));
            const lastSvc = recent[0];
            const nextSvcMileage = v.next_service_due
              ? Number((v.next_service_due as unknown as string).match(/\d+/)?.[0]) || (v.current_mileage ?? 0) + 5000
              : (v.current_mileage ?? 0) + 5000;
            const currentMileage = v.current_mileage ?? 0;
            const milesUntil = Math.max(0, nextSvcMileage - currentMileage);
            const mileageHistory = recent
              .map((m) => m.mileage_at_service ?? 0)
              .filter((x) => x > 0);
            const avgMileageGain = mileageHistory.length > 1
              ? (mileageHistory[0] - mileageHistory[mileageHistory.length - 1]) / Math.max(1, mileageHistory.length - 1)
              : 50;
            const avgDailyMiles = avgMileageGain / 30;
            let urgency: 'overdue' | 'critical' | 'warning' | 'ok' = 'ok';
            if (milesUntil <= 0) urgency = 'overdue';
            else if (milesUntil < 500) urgency = 'critical';
            else if (milesUntil < 2000) urgency = 'warning';
            return {
              vehicle_number: vehicleLabel(v.id),
              vehicle_label: vehicleFullLabel(v.id),
              current_mileage: currentMileage,
              next_service_mileage: nextSvcMileage,
              miles_until_service: milesUntil,
              avg_daily_miles: avgDailyMiles,
              est_days_until_service: avgDailyMiles > 0 ? Math.round(milesUntil / avgDailyMiles) : null,
              last_service_date: lastSvc?.performed_at,
              last_service_cost: lastSvc?.cost,
              urgency,
            };
          });
          generateMaintenanceForecastReport({
            rows,
            overdueCount: rows.filter((r) => r.urgency === 'overdue').length,
          });
          addToast(`Generated ${REPORT_LABELS[report]} (${rows.length} vehicles)`, 'success');
          break;
        }
        case 'compliance_audit': {
          const today = new Date();
          const inDays = (s?: string) => {
            if (!s) return Infinity;
            const d = new Date(s.replace(' ', 'T'));
            return Math.round((d.getTime() - today.getTime()) / 86400_000);
          };
          const statusFrom = (s?: string): 'valid' | 'expiring' | 'expired' => {
            const days = inDays(s);
            if (days < 0) return 'expired';
            if (days < 30) return 'expiring';
            return 'valid';
          };
          const rows = vehiclesInRange.map((v) => {
            const insuranceDays = inDays(v.insurance_expiry);
            const regDays = inDays(v.registration_expiry);
            const overdueSvc = maintenanceFiltered.filter(
              (m) => m.vehicle_id === v.id && m.performed_at,
            ).filter((m) => {
              if (!m.next_due_date) return false;
              return new Date(m.next_due_date.replace(' ', 'T')) < today;
            }).length;
            const score = Math.max(0, 100
              - (insuranceDays < 0 ? 25 : insuranceDays < 30 ? 10 : 0)
              - (regDays < 0 ? 20 : regDays < 30 ? 8 : 0)
              - overdueSvc * 10);
            return {
              vehicle_number: vehicleLabel(v.id),
              vehicle_label: vehicleFullLabel(v.id),
              insurance_status: statusFrom(v.insurance_expiry),
              insurance_expiry: v.insurance_expiry,
              registration_status: statusFrom(v.registration_expiry),
              registration_expiry: v.registration_expiry,
              inspection_status: 'valid' as const,
              inspection_expiry: undefined,
              open_recalls: 0,
              overdue_service: overdueSvc,
              compliance_score: score,
            };
          });
          generateComplianceAuditReport({
            rows,
            fullyCompliant: rows.filter((r) => r.compliance_score === 100).length,
          });
          addToast(`Generated ${REPORT_LABELS[report]} (${rows.length} vehicles)`, 'success');
          break;
        }
      }
    } catch (err) {
      console.error('Report generation failed:', err);
      addToast(`Failed to generate ${REPORT_LABELS[report]}`, 'error');
    } finally {
      setGenerating(null);
    }
  }, [addToast, dateRange, dateRangeStart, fetchAllData, minMileage, selectedVehicleIds, vehicleNumberById, vehicles]);

  return (
    <div className="space-y-4">
      <div className="px-3 pt-3">
        <div className="flex items-center gap-2 mb-1">
          <FileText size={14} style={{ color: '#d4a017' }} />
          <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
            Analysis Reports
          </h2>
        </div>
        <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
          Generate detailed PDF analysis reports for fleet management. Apply filters below to scope each report.
        </p>
      </div>

      <div className="mx-3 rounded-sm border border-subtle" style={{ background: 'var(--surface-base)' }}>
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-subtle">
          <Filter size={11} style={{ color: '#d4a017' }} />
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#d4a017' }}>
            Report Filters
          </span>
        </div>

        <div className="p-2.5 space-y-3">
          <div>
            <label className="flex items-center gap-1 text-[9px] font-semibold uppercase mb-1" style={{ color: 'var(--text-muted)' }}>
              <Calendar size={9} /> Date Range
            </label>
            <div className="flex flex-wrap gap-1">
              {(['7d', '30d', '90d', '365d', 'ytd', 'all'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setDateRange(r)}
                  className="px-2 py-0.5 text-[10px] font-mono border transition-colors"
                  style={{
                    background: dateRange === r ? '#1a1a1a' : 'transparent',
                    borderColor: dateRange === r ? '#d4a017' : 'var(--border-default)',
                    color: dateRange === r ? '#d4a017' : '#888',
                  }}
                >
                  {r === '7d' ? '7 Days' : r === '30d' ? '30 Days' : r === '90d' ? '90 Days' : r === '365d' ? '1 Year' : r === 'ytd' ? 'YTD' : 'All Time'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="flex items-center gap-1 text-[9px] font-semibold uppercase mb-1" style={{ color: 'var(--text-muted)' }}>
              <BarChart3 size={9} /> Group Reports By
            </label>
            <div className="flex flex-wrap gap-1">
              {(['vehicle', 'officer', 'type'] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGroupBy(g)}
                  className="px-2 py-0.5 text-[10px] font-mono border transition-colors"
                  style={{
                    background: groupBy === g ? '#1a1a1a' : 'transparent',
                    borderColor: groupBy === g ? '#d4a017' : 'var(--border-default)',
                    color: groupBy === g ? '#d4a017' : '#888',
                  }}
                >
                  {g === 'vehicle' ? 'By Vehicle' : g === 'officer' ? 'By Officer' : 'By Type'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="flex items-center gap-1 text-[9px] font-semibold uppercase mb-1" style={{ color: 'var(--text-muted)' }}>
              <Gauge size={9} /> Min Current Mileage
            </label>
            <input
              type="number"
              min={0}
              step={1000}
              value={minMileage}
              onChange={(e) => setMinMileage(Number(e.target.value) || 0)}
              className="w-full px-2 py-1 text-[11px] font-mono bg-surface-sunken border border-subtle focus:border-rmpg-400 outline-none"
              style={{ color: 'var(--text-secondary)' }}
              placeholder="0 (no minimum)"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="flex items-center gap-1 text-[9px] font-semibold uppercase" style={{ color: 'var(--text-muted)' }}>
                <Car size={9} /> Vehicles ({selectedVehicleIds.length || 'all'} selected)
              </label>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={selectAll}
                  className="text-[9px] font-mono hover:underline"
                  style={{ color: '#d4a017' }}
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="text-[9px] font-mono hover:underline"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="max-h-40 overflow-y-auto border border-subtle bg-surface-sunken p-1.5 space-y-0.5">
              {vehicleOptions.length === 0 ? (
                <p className="text-[10px] text-rmpg-500 p-1">No vehicles available</p>
              ) : vehicleOptions.map((v) => {
                const checked = selectedVehicleIds.includes(v.id);
                return (
                  <label key={v.id} className="flex items-center gap-1.5 px-1 py-0.5 cursor-pointer hover:bg-rmpg-800 transition-colors">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleVehicle(v.id)}
                      className="w-3 h-3 accent-rmpg-400"
                    />
                    <span className="text-[10px] font-mono" style={{ color: '#d4a017' }}>{v.number}</span>
                    <span className="text-[9px] truncate" style={{ color: 'var(--text-muted)' }}>{v.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#d4a017' }}>
          Available Reports
        </div>
        <div className="space-y-1.5">
          {(Object.keys(REPORT_LABELS) as ReportType[]).map((r) => {
            const Icon = REPORT_ICONS[r];
            const isLoading = generating === r;
            return (
              <div
                key={r}
                className="rounded-sm border border-subtle p-2.5 transition-colors hover:border-strong"
                style={{ background: 'var(--surface-base)' }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Icon size={12} style={{ color: '#d4a017' }} />
                      <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                        {REPORT_LABELS[r]}
                      </span>
                    </div>
                    <p className="text-[9px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {REPORT_DESCRIPTIONS[r]}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleGenerate(r)}
                    disabled={isLoading || vehicles.length === 0}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider border transition-colors disabled:opacity-50"
                    style={{
                      background: 'var(--surface-raised)',
                      borderColor: '#d4a017',
                      color: '#d4a017',
                    }}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 size={10} className="animate-spin" />
                        Generating…
                      </>
                    ) : (
                      <>
                        <Download size={10} />
                        PDF
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
