import React from 'react';
import {
  Car, Wrench, DollarSign, Calendar, Clock, Gauge, Shield, Radio, Settings, Tag, ArrowRight, Pencil, Trash2,
} from 'lucide-react';
import type { FleetVehicle, FleetMaintenance, FleetVehicleStatus } from '../../../types';
import { formatMilitary, daysUntilExpiry, expiryProgress } from '../utils/fleetFormatters';

const STATUS_LED: Record<FleetVehicleStatus, string> = {
  in_service: 'led-dot led-green',
  maintenance: 'led-dot led-amber',
  out_of_service: 'led-dot led-red',
  retired: 'led-dot led-off',
};

const STATUS_LABEL: Record<FleetVehicleStatus, string> = {
  in_service: 'In Service',
  maintenance: 'Maintenance',
  out_of_service: 'Out of Service',
  retired: 'Retired',
};

const STATUS_COLOR: Record<FleetVehicleStatus, string> = {
  in_service: '#22c55e',
  maintenance: '#f59e0b',
  out_of_service: '#ef4444',
  retired: '#6b7280',
};

function getExpiryStatus(dateStr?: string): 'ok' | 'expiring' | 'expired' | 'none' {
  if (!dateStr) return 'none';
  // Force local-time parse for date-only strings to avoid UTC timezone shift
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T00:00:00` : dateStr;
  const exp = new Date(normalized);
  const now = new Date();
  if (exp < now) return 'expired';
  const thirtyDays = new Date();
  thirtyDays.setDate(thirtyDays.getDate() + 30);
  if (exp <= thirtyDays) return 'expiring';
  return 'ok';
}

function parseEquipment(eq: unknown): string[] {
  if (Array.isArray(eq)) return eq;
  if (typeof eq === 'string') { try { return JSON.parse(eq); } catch { return []; } }
  return [];
}

const TYPE_BORDER_COLOR: Record<string, string> = {
  oil_change: '#3b82f6', tire_rotation: '#06b6d4',
  brake_service: '#ef4444', inspection: '#22c55e',
  repair: '#f59e0b', other: '#6b7280',
};

interface Props {
  detail: FleetVehicle;
  maintenance: FleetMaintenance[];
  onEditMaintenance?: (record: FleetMaintenance) => void;
  onDeleteMaintenance?: (record: FleetMaintenance) => void;
}

export default function FleetOverviewTab({ detail, maintenance, onEditMaintenance, onDeleteMaintenance }: Props) {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {/* Vehicle Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        <div className="panel-beveled p-2.5 text-center" style={{ background: '#0d1520' }}>
          <Gauge className="w-3.5 h-3.5 mx-auto text-brand-400 mb-1" />
          <div className="text-sm font-bold font-mono text-brand-400">{detail.current_mileage?.toLocaleString() || '-'}</div>
          <div className="text-[7px] text-rmpg-500 uppercase">Mileage</div>
        </div>
        <div className="panel-beveled p-2.5 text-center" style={{ background: '#0d1520' }}>
          <Wrench className="w-3.5 h-3.5 mx-auto text-amber-400 mb-1" />
          <div className="text-sm font-bold font-mono text-amber-400">{maintenance.length}</div>
          <div className="text-[7px] text-rmpg-500 uppercase">Services</div>
        </div>
        <div className="panel-beveled p-2.5 text-center" style={{ background: '#0d1520' }}>
          <DollarSign className="w-3.5 h-3.5 mx-auto text-green-400 mb-1" />
          <div className="text-sm font-bold font-mono text-green-400">
            ${maintenance.reduce((sum, m) => sum + (m.cost || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">Total Cost</div>
        </div>
        <div className="panel-beveled p-2.5 text-center" style={{ background: '#0d1520' }}>
          <Calendar className="w-3.5 h-3.5 mx-auto text-blue-400 mb-1" />
          <div className="text-[10px] font-bold font-mono text-blue-400">{formatMilitary(detail.last_service_date)}</div>
          <div className="text-[7px] text-rmpg-500 uppercase">Last Service</div>
        </div>
        <div className={`panel-beveled p-2.5 text-center ${
          getExpiryStatus(detail.next_service_due) === 'expired' ? 'border-amber-700/50' : ''
        }`} style={{ background: getExpiryStatus(detail.next_service_due) === 'expired' ? '#1a1400' : '#0d1520' }}>
          <Clock className="w-3.5 h-3.5 mx-auto mb-1" style={{ color: getExpiryStatus(detail.next_service_due) === 'expired' ? '#f59e0b' : '#22c55e' }} />
          <div className="text-[10px] font-bold font-mono" style={{ color: getExpiryStatus(detail.next_service_due) === 'expired' ? '#f59e0b' : '#22c55e' }}>
            {formatMilitary(detail.next_service_due)}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">Next Due</div>
        </div>
      </div>

      {/* Vehicle Info */}
      <div className="panel-beveled p-3 bg-surface-base">
        <h3 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider mb-2.5 flex items-center gap-1.5">
          <Car className="w-3 h-3" /> Vehicle Information
          <span className="ml-auto text-[8px] text-rmpg-600 font-normal normal-case tracking-normal">
            Added {formatMilitary(detail.created_at)}
          </span>
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2.5">
          {[
            { label: 'Make', value: detail.make },
            { label: 'Model', value: detail.model },
            { label: 'Year', value: detail.year, mono: true },
            { label: 'Color', value: detail.color },
            { label: 'VIN', value: detail.vin, mono: true, span: 2 },
            { label: 'Plate', value: detail.plate_number ? `${detail.plate_state || ''} ${detail.plate_number}` : null, mono: true },
            { label: 'Mileage', value: detail.current_mileage?.toLocaleString(), mono: true },
          ].map((field, i) => (
            <div key={i} className={field.span === 2 ? 'col-span-2' : ''}>
              <div className="text-[9px] text-rmpg-500 uppercase font-semibold tracking-wider">{field.label}</div>
              <div className={`text-[11px] text-rmpg-200 ${field.mono ? 'font-mono' : ''}`}>
                {field.value || <span className="text-rmpg-600">-</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Registration & Insurance */}
      <div className="panel-beveled p-3 bg-surface-base">
        <h3 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider mb-2.5 flex items-center gap-1.5">
          <Shield className="w-3 h-3" /> Registration & Insurance
          {(getExpiryStatus(detail.registration_expiry) === 'expired' || getExpiryStatus(detail.insurance_expiry) === 'expired') && (
            <span className="ml-auto px-1.5 py-0.5 text-[8px] text-red-400 bg-red-900/20 border border-red-700/30 font-bold animate-pulse">
              ACTION REQUIRED
            </span>
          )}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className={`p-2.5 border ${
            getExpiryStatus(detail.registration_expiry) === 'expired' ? 'bg-red-900/10 border-red-700/40' :
            getExpiryStatus(detail.registration_expiry) === 'expiring' ? 'bg-amber-900/10 border-amber-700/40' :
            'bg-surface-sunken border-rmpg-700'
          }`}>
            <div className="flex items-center gap-1.5 mb-1">
              <Calendar className="w-3 h-3 text-rmpg-400" />
              <span className="text-[9px] text-rmpg-400 uppercase font-semibold">Registration</span>
              {getExpiryStatus(detail.registration_expiry) === 'expired' && <span className="text-[8px] text-red-400 font-bold ml-auto">EXPIRED</span>}
              {getExpiryStatus(detail.registration_expiry) === 'expiring' && <span className="text-[8px] text-amber-400 ml-auto">EXPIRING</span>}
              {getExpiryStatus(detail.registration_expiry) === 'ok' && <span className="text-[8px] text-green-400 ml-auto">VALID</span>}
            </div>
            <div className={`text-sm font-mono font-bold ${
              getExpiryStatus(detail.registration_expiry) === 'expired' ? 'text-red-400' :
              getExpiryStatus(detail.registration_expiry) === 'expiring' ? 'text-amber-400' :
              'text-rmpg-200'
            }`}>
              {formatMilitary(detail.registration_expiry)}
            </div>
            {/* Expiry countdown progress bar */}
            {detail.registration_expiry && (
              <div className="mt-1.5">
                <div className="flex justify-between text-[8px] text-rmpg-500 mb-0.5">
                  <span>DAYS REMAINING</span>
                  <span className="font-mono">{daysUntilExpiry(detail.registration_expiry) ?? 0}d</span>
                </div>
                <div className="w-full h-1.5 bg-rmpg-700 overflow-hidden">
                  <div
                    className="h-full transition-all duration-500"
                    style={{
                      width: `${expiryProgress(detail.registration_expiry)}%`,
                      background: expiryProgress(detail.registration_expiry) > 30 ? '#22c55e'
                        : expiryProgress(detail.registration_expiry) > 10 ? '#f59e0b' : '#ef4444',
                    }}
                  />
                </div>
              </div>
            )}
          </div>
          <div className={`p-2.5 border ${
            getExpiryStatus(detail.insurance_expiry) === 'expired' ? 'bg-red-900/10 border-red-700/40' :
            getExpiryStatus(detail.insurance_expiry) === 'expiring' ? 'bg-amber-900/10 border-amber-700/40' :
            'bg-surface-sunken border-rmpg-700'
          }`}>
            <div className="flex items-center gap-1.5 mb-1">
              <Shield className="w-3 h-3 text-rmpg-400" />
              <span className="text-[9px] text-rmpg-400 uppercase font-semibold">Insurance</span>
              {getExpiryStatus(detail.insurance_expiry) === 'expired' && <span className="text-[8px] text-red-400 font-bold ml-auto">EXPIRED</span>}
              {getExpiryStatus(detail.insurance_expiry) === 'expiring' && <span className="text-[8px] text-amber-400 ml-auto">EXPIRING</span>}
              {getExpiryStatus(detail.insurance_expiry) === 'ok' && <span className="text-[8px] text-green-400 ml-auto">VALID</span>}
            </div>
            <div className={`text-sm font-mono font-bold ${
              getExpiryStatus(detail.insurance_expiry) === 'expired' ? 'text-red-400' :
              getExpiryStatus(detail.insurance_expiry) === 'expiring' ? 'text-amber-400' :
              'text-rmpg-200'
            }`}>
              {formatMilitary(detail.insurance_expiry)}
            </div>
            {/* Expiry countdown progress bar */}
            {detail.insurance_expiry && (
              <div className="mt-1.5">
                <div className="flex justify-between text-[8px] text-rmpg-500 mb-0.5">
                  <span>DAYS REMAINING</span>
                  <span className="font-mono">{daysUntilExpiry(detail.insurance_expiry) ?? 0}d</span>
                </div>
                <div className="w-full h-1.5 bg-rmpg-700 overflow-hidden">
                  <div
                    className="h-full transition-all duration-500"
                    style={{
                      width: `${expiryProgress(detail.insurance_expiry)}%`,
                      background: expiryProgress(detail.insurance_expiry) > 30 ? '#22c55e'
                        : expiryProgress(detail.insurance_expiry) > 10 ? '#f59e0b' : '#ef4444',
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
        {detail.assigned_unit_call_sign && (
          <div className="mt-2.5 p-2 bg-amber-900/10 border border-amber-700/30 flex items-center gap-2">
            <Radio className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-[10px] text-amber-400 font-bold uppercase">Assigned to Unit: {detail.assigned_unit_call_sign}</span>
          </div>
        )}
      </div>

      {/* Equipment */}
      {parseEquipment(detail.equipment).length > 0 && (
        <div className="panel-beveled p-3 bg-surface-base">
          <h3 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <Settings className="w-3 h-3" /> Equipment ({parseEquipment(detail.equipment).length})
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {parseEquipment(detail.equipment).map((item, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium bg-brand-900/20 text-brand-300 border border-brand-700/30">
                <Tag className="w-2.5 h-2.5" />{item}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      {detail.notes && (
        <div className="panel-beveled p-3 bg-surface-base">
          <h3 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider mb-2">Notes</h3>
          <div className="p-2 text-[11px] text-rmpg-300 whitespace-pre-wrap leading-relaxed" style={{ background: '#0d1520', border: '1px solid #162236' }}>
            {detail.notes}
          </div>
        </div>
      )}

      {/* Maintenance History */}
      <div className="panel-beveled p-3 bg-surface-base">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider flex items-center gap-1.5">
            <Wrench className="w-3 h-3" /> Maintenance History ({maintenance.length})
          </h3>
          {maintenance.length > 0 && (
            <span className="text-[9px] text-green-400 font-mono">
              Total: ${maintenance.reduce((sum, m) => sum + (m.cost || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          )}
        </div>
        {maintenance.length === 0 ? (
          <div className="text-center py-6">
            <div className="w-12 h-12 mx-auto mb-2 rounded-full border border-rmpg-700 flex items-center justify-center" style={{ background: '#0d1520' }}>
              <Wrench className="w-6 h-6 text-rmpg-600" />
            </div>
            <p className="text-[10px] text-rmpg-500">No maintenance records</p>
            <p className="text-[9px] text-rmpg-600 mt-0.5">Service history will appear here after logging maintenance.</p>
          </div>
        ) : (
          <div className="relative">
            <div className="absolute left-3 top-0 bottom-0 w-px" style={{ background: 'linear-gradient(180deg, #1a5a9e 0%, #2a3e58 30%, #2a3e58 70%, transparent 100%)' }} />
            <div className="space-y-2">
              {maintenance.map((m) => {
                const typeColors: Record<string, string> = {
                  oil_change: 'bg-blue-500', tire_rotation: 'bg-cyan-500',
                  brake_service: 'bg-red-500', inspection: 'bg-green-500',
                  repair: 'bg-amber-500', other: 'bg-gray-500',
                };
                return (
                  <div key={m.id} className="flex gap-3 relative pl-6">
                    <div className={`absolute left-1.5 top-2 w-3 h-3 rounded-full border-2 border-surface-base ${typeColors[m.type] || 'bg-gray-500'}`} />
                    <div
                      className="flex-1 p-2 bg-surface-sunken border border-rmpg-700"
                      style={{ borderLeft: `3px solid ${TYPE_BORDER_COLOR[m.type] || '#6b7280'}` }}
                    >
                      <div className="flex items-center gap-2 justify-between">
                        <div className="flex items-center gap-2">
                          <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase border bg-brand-900/30 text-brand-400 border-brand-700/30">
                            {m.type.replace(/_/g, ' ')}
                          </span>
                          <span className="text-[10px] text-rmpg-300 font-mono">
                            {formatMilitary(m.performed_at)}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          {m.mileage_at_service != null && (
                            <span className="text-[9px] text-rmpg-400 flex items-center gap-0.5">
                              <Gauge className="w-2.5 h-2.5" />{m.mileage_at_service.toLocaleString()} mi
                            </span>
                          )}
                          {m.cost != null && (
                            <span className="text-[10px] text-green-400 font-mono font-bold">${m.cost.toFixed(2)}</span>
                          )}
                          {/* Admin Edit / Delete */}
                          {(onEditMaintenance || onDeleteMaintenance) && (
                            <div className="flex items-center gap-1 ml-1">
                              {onEditMaintenance && (
                                <button
                                  className="p-1 text-rmpg-500 hover:text-brand-400 hover:bg-rmpg-700 rounded transition-colors"
                                  onClick={() => onEditMaintenance(m)}
                                  title="Edit maintenance record"
                                >
                                  <Pencil className="w-3 h-3" />
                                </button>
                              )}
                              {onDeleteMaintenance && (
                                <button
                                  className="p-1 text-rmpg-500 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors"
                                  onClick={() => onDeleteMaintenance(m)}
                                  title="Delete maintenance record"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <p className="text-[10px] text-rmpg-200 mt-1">{m.description}</p>
                      <div className="flex items-center gap-3 mt-1 text-[9px] text-rmpg-500">
                        {m.vendor && <span>Vendor: {m.vendor}</span>}
                        {m.performed_by && <span>By: {m.performed_by}</span>}
                        {m.next_due_date && (
                          <span className="text-amber-400/70 flex items-center gap-0.5">
                            <ArrowRight className="w-2.5 h-2.5" />Next: {formatMilitary(m.next_due_date)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
