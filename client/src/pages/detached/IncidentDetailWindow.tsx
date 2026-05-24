// ============================================================
// RMPG Flex — Incident Detail Window (Detached)
// Full incident report view in a secondary browser window
// ============================================================

import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import DetachedLayout from '../../components/DetachedLayout';
import ReportTypeSelector from '../../components/ReportTypeSelector';
import StatusBadge from '../../components/StatusBadge';
import { formatIncidentType, getTypeCode, getIncidentCategory, CATEGORY_COLORS } from '../../utils/caseNumbers';
import { downloadPdfReport } from '../../utils/pdfGenerator';
import type { PdfReportType } from '../../utils/caseNumbers';
import { apiFetch } from '../../hooks/useApi';
import { fetchEntityImages } from '../../utils/pdfImageHelpers';

export default function IncidentDetailWindow() {
  const { id } = useParams<{ id: string }>();
  const [incident, setIncident] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const data = await apiFetch<any>(`/incidents/${id}`);
        setIncident(data);
        // Update window title
        document.title = `${data.incident_number} — RMPG Flex`;
      } catch (err: any) {
        setError(err.message || 'Failed to load incident');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const handlePdfExport = async (reportType: PdfReportType) => {
    if (!incident) return;

    // Fetch attachment images for the incident
    let attachmentImages: any[] = [];
    try {
      attachmentImages = await fetchEntityImages('incident', incident.id);
    } catch { /* proceed without images */ }

    await downloadPdfReport(reportType, {
      incident_number: incident.incident_number,
      incident_type: incident.incident_type,
      priority: incident.priority,
      status: incident.status,
      location: incident.location_address || '',
      officer_name: incident.officer_name || '',
      narrative: incident.narrative || '',
      occurred_date: incident.occurred_date,
      occurred_time: incident.occurred_time,
      end_date: incident.end_date,
      end_time: incident.end_time,
      weather_conditions: incident.weather_conditions,
      lighting_conditions: incident.lighting_conditions,
      injuries: incident.injuries,
      injury_description: incident.injury_description,
      damage_estimate: incident.damage_estimate,
      damage_description: incident.damage_description,
      weapons_involved: incident.weapons_involved,
      alcohol_involved: incident.alcohol_involved,
      drugs_involved: incident.drugs_involved,
      domestic_violence: incident.domestic_violence,
      disposition: incident.disposition,
      zone_beat: incident.zone_beat,
      sector_id: incident.sector_id,
      zone_id: incident.zone_id,
      beat_id: incident.beat_id,
      dispatch_code: incident.dispatch_code,
      source: incident.source,
      badge_number: incident.badge_number,
      property_name: incident.property_name,
      client_name: incident.client_name,
      call_number: incident.call_number,
      scene_safety: incident.scene_safety,
      direction_of_travel: incident.direction_of_travel,
      contract_id: incident.contract_id,
      responding_le_agency: incident.responding_le_agency,
      le_case_number: incident.le_case_number,
      created_at: incident.created_at,
      road_conditions: incident.road_conditions,
      traffic_control: incident.traffic_control,
      vehicle_1_info: incident.vehicle_1_info,
      vehicle_2_info: incident.vehicle_2_info,
      diagram_notes: incident.diagram_notes,
      patient_status: incident.patient_status,
      ems_transport: incident.ems_transport,
      patient_vitals: incident.patient_vitals,
      treatment_rendered: incident.treatment_rendered,
      trespass_warning_issued: incident.trespass_warning_issued,
      trespass_effective_date: incident.trespass_effective_date,
      trespass_expiry_date: incident.trespass_expiry_date,
      property_boundaries: incident.property_boundaries,
      force_type: incident.force_type,
      force_justification: incident.force_justification,
      subject_injuries: incident.subject_injuries,
      officer_injuries: incident.officer_injuries,
      de_escalation_attempts: incident.de_escalation_attempts,
      // Operational flags
      injuries_reported: incident.injuries_reported,
      mental_health_crisis: incident.mental_health_crisis,
      juvenile_involved: incident.juvenile_involved,
      felony_in_progress: incident.felony_in_progress,
      officer_safety_caution: incident.officer_safety_caution,
      gang_related: incident.gang_related,
      hazmat: incident.hazmat,
      body_camera_active: incident.body_camera_active,
      evidence_collected: incident.evidence_collected,
      photos_taken: incident.photos_taken,
      supervisor_notified: incident.supervisor_notified,
      le_notified: incident.le_notified,
      trespass_issued: incident.trespass_issued,
      vehicle_pursuit: incident.vehicle_pursuit,
      foot_pursuit: incident.foot_pursuit,
      k9_requested: incident.k9_requested,
      ems_requested: incident.ems_requested,
      fire_requested: incident.fire_requested,
      // PSO / Process Service
      pso_service_type: incident.pso_service_type,
      pso_authorization: incident.pso_authorization,
      pso_requestor_name: incident.pso_requestor_name,
      pso_requestor_phone: incident.pso_requestor_phone,
      pso_requestor_email: incident.pso_requestor_email,
      pso_billing_code: incident.pso_billing_code,
      process_service_type: incident.process_service_type,
      process_served_to: incident.process_served_to,
      process_served_address: incident.process_served_address,
      process_attempts: incident.process_attempts,
      process_served_at: incident.process_served_at,
      process_service_result: incident.process_service_result,
      // Geo
      latitude: incident.latitude,
      longitude: incident.longitude,
      // Linked entities
      linked_persons: incident.linked_persons || [],
      linked_vehicles: incident.linked_vehicles || [],
      evidence: incident.evidence || [],
      attachment_images: attachmentImages.length > 0 ? attachmentImages : undefined,
    } as any);
  };

  if (loading) {
    return (
      <DetachedLayout title="Loading...">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 text-brand-400 animate-spin" role="status" aria-label="Loading" />
        </div>
      </DetachedLayout>
    );
  }

  if (error || !incident) {
    return (
      <DetachedLayout title="Error">
        <div className="flex items-center justify-center h-64">
          <p className="text-red-400">{error || 'Incident not found'}</p>
        </div>
      </DetachedLayout>
    );
  }

  const category = getIncidentCategory(incident.incident_type);
  const typeCode = getTypeCode(incident.incident_type);
  const persons = incident.linked_persons || [];
  const vehicles = incident.linked_vehicles || [];
  const evidence = incident.evidence || [];

  return (
    <DetachedLayout
      title={incident.incident_number}
      subtitle={`${formatIncidentType(incident.incident_type)} — ${incident.location_address || ''}`}
      actions={
        <ReportTypeSelector
          incidentType={incident.incident_type}
          onSelect={handlePdfExport}
          onSignAndExport={async (reportType, signature) => {
            if (!incident) return;
            let attachmentImages: any[] = [];
            try { attachmentImages = await fetchEntityImages('incident', incident.id); } catch (e) { console.warn('[IncidentDetail] fetch images failed:', e); }
            await downloadPdfReport(reportType, {
              ...incident,
              location: incident.location_address || '',
              attachment_images: attachmentImages.length > 0 ? attachmentImages : undefined,
              _officerSignature: signature,
            });
          }}
        />
      }
    >
      {/* Report Header */}
      <div className="bg-surface-base border border-rmpg-600 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight">{incident.incident_number}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className={`px-2 py-0.5 text-[10px] uppercase font-bold border ${CATEGORY_COLORS[category]}`}>
                {category}
              </span>
              <span className="text-sm text-brand-400 font-semibold">{formatIncidentType(incident.incident_type)}</span>
              <span className="text-xs text-rmpg-400 font-mono">({typeCode})</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={incident.priority} type="priority" />
            <StatusBadge status={incident.status} type="incident_status" />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold block">Officer</label>
            <p className="text-rmpg-200">{incident.officer_name || 'N/A'}</p>
          </div>
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold block">Section / Zone / Beat</label>
            <p className="text-rmpg-200">{[incident.sector_id, incident.zone_id, incident.beat_id].filter(Boolean).join(' / ') || 'N/A'}</p>
          </div>
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold block">Disposition</label>
            <p className="text-rmpg-200">{incident.disposition || 'Pending'}</p>
          </div>
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold block">Created</label>
            <p className="text-rmpg-200">{incident.created_at ? new Date(incident.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : 'N/A'}</p>
          </div>
        </div>
      </div>

      {/* Location & DateTime */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
        <div className="bg-surface-base border border-rmpg-600 p-4">
          <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3 border-b border-rmpg-700 pb-2">Location</h3>
          <p className="text-sm text-white font-medium">{incident.location_address || 'N/A'}</p>
          {incident.property_name && (
            <p className="text-xs text-rmpg-300 mt-1">Property: {incident.property_name}</p>
          )}
        </div>
        <div className="bg-surface-base border border-rmpg-600 p-4">
          <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3 border-b border-rmpg-700 pb-2">Date / Time</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <label className="text-[10px] text-rmpg-500">Start</label>
              <p className="text-rmpg-200">{incident.occurred_date || 'N/A'} {incident.occurred_time || ''}</p>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-500">End</label>
              <p className="text-rmpg-200">{incident.end_date || 'N/A'} {incident.end_time || ''}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Scene Details */}
      {(incident.weather_conditions || incident.lighting_conditions || incident.injuries || incident.damage_estimate || incident.weapons_involved) && (
        <div className="bg-surface-base border border-rmpg-600 p-4 mb-6">
          <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3 border-b border-rmpg-700 pb-2">Scene Details</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            {incident.weather_conditions && (
              <div>
                <label className="text-[10px] text-rmpg-500">Weather</label>
                <p className="text-rmpg-200">{incident.weather_conditions}</p>
              </div>
            )}
            {incident.lighting_conditions && (
              <div>
                <label className="text-[10px] text-rmpg-500">Lighting</label>
                <p className="text-rmpg-200">{incident.lighting_conditions}</p>
              </div>
            )}
            {incident.injuries && incident.injuries !== 'none' && (
              <div>
                <label className="text-[10px] text-rmpg-500">Injuries</label>
                <p className="text-red-400">{incident.injuries}{incident.injury_description ? ` — ${incident.injury_description}` : ''}</p>
              </div>
            )}
            {incident.damage_estimate && (
              <div>
                <label className="text-[10px] text-rmpg-500">Damage</label>
                <p className="text-amber-400">${incident.damage_estimate}{incident.damage_description ? ` — ${incident.damage_description}` : ''}</p>
              </div>
            )}
            {incident.weapons_involved && (
              <div>
                <label className="text-[10px] text-rmpg-500">Weapons</label>
                <p className="text-red-400">{incident.weapons_involved}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Flags */}
      {(incident.alcohol_involved || incident.drugs_involved || incident.domestic_violence) && (
        <div className="flex items-center gap-2 mb-6">
          {incident.alcohol_involved && (
            <span className="px-3 py-1 bg-amber-900/40 text-amber-300 text-xs uppercase font-bold border border-amber-700/40">Alcohol Involved</span>
          )}
          {incident.drugs_involved && (
            <span className="px-3 py-1 bg-purple-900/40 text-purple-300 text-xs uppercase font-bold border border-purple-700/40">Drugs Involved</span>
          )}
          {incident.domestic_violence && (
            <span className="px-3 py-1 bg-red-900/40 text-red-300 text-xs uppercase font-bold border border-red-700/40">Domestic Violence</span>
          )}
        </div>
      )}

      {/* Persons Involved */}
      <div className="bg-surface-base border border-rmpg-600 p-4 mb-6">
        <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3 border-b border-rmpg-700 pb-2">
          Persons Involved ({persons.length})
        </h3>
        {persons.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] text-rmpg-400 uppercase">
                <th className="text-left pb-2">Role</th>
                <th className="text-left pb-2">Name</th>
                <th className="text-left pb-2">DOB</th>
              </tr>
            </thead>
            <tbody>
              {persons.map((p: any, i: number) => {
                let flags: string[] = [];
                try { flags = JSON.parse(p.flags || '[]'); } catch { /* ignore */ }
                return (
                  <tr key={p.id || `person-${i}`} className="border-t border-rmpg-700/50">
                    <td className="py-1.5">
                      <span className="px-1.5 py-0.5 bg-brand-900/40 text-brand-300 text-[10px] uppercase font-bold border border-brand-600/40">
                        {(p.role || '').replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="py-1.5 text-white font-medium">{p.last_name}, {p.first_name}</td>
                    <td className="py-1.5 text-rmpg-300">{p.dob || 'N/A'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-xs text-rmpg-500">No persons linked</p>
        )}
      </div>

      {/* Vehicles Involved */}
      <div className="bg-surface-base border border-rmpg-600 p-4 mb-6">
        <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3 border-b border-rmpg-700 pb-2">
          Vehicles Involved ({vehicles.length})
        </h3>
        {vehicles.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] text-rmpg-400 uppercase">
                <th className="text-left pb-2">Role</th>
                <th className="text-left pb-2">Plate</th>
                <th className="text-left pb-2">Description</th>
                <th className="text-left pb-2">Owner</th>
              </tr>
            </thead>
            <tbody>
              {vehicles.map((v: any, i: number) => (
                <tr key={v.id || `vehicle-${i}`} className="border-t border-rmpg-700/50">
                  <td className="py-1.5">
                    <span className="px-1.5 py-0.5 bg-amber-900/40 text-amber-300 text-[10px] uppercase font-bold border border-amber-600/40">
                      {(v.role || '').replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="py-1.5 text-white font-mono">{v.plate_number || 'N/A'}{v.state ? ` (${v.state})` : ''}</td>
                  <td className="py-1.5 text-rmpg-200">{[v.year, v.color, v.make, v.model].filter(Boolean).join(' ')}</td>
                  <td className="py-1.5 text-rmpg-300">{v.owner_first_name ? `${v.owner_first_name} ${v.owner_last_name || ''}` : 'N/A'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-xs text-rmpg-500">No vehicles linked</p>
        )}
      </div>

      {/* Evidence */}
      <div className="bg-surface-base border border-rmpg-600 p-4 mb-6">
        <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3 border-b border-rmpg-700 pb-2">
          Evidence ({evidence.length})
        </h3>
        {evidence.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] text-rmpg-400 uppercase">
                <th className="text-left pb-2">Item #</th>
                <th className="text-left pb-2">Type</th>
                <th className="text-left pb-2">Description</th>
                <th className="text-left pb-2">Storage</th>
              </tr>
            </thead>
            <tbody>
              {evidence.map((e: any, i: number) => (
                <tr key={e.id || `evidence-${i}`} className="border-t border-rmpg-700/50">
                  <td className="py-1.5 text-white font-mono font-bold">{e.evidence_number}</td>
                  <td className="py-1.5">
                    <span className="px-1.5 py-0.5 bg-purple-900/40 text-purple-300 text-[10px] uppercase font-bold border border-purple-600/40">
                      {e.evidence_type || 'physical'}
                    </span>
                  </td>
                  <td className="py-1.5 text-rmpg-200">{e.description}</td>
                  <td className="py-1.5 text-rmpg-400">{e.storage_location || 'N/A'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-xs text-rmpg-500">No evidence recorded</p>
        )}
      </div>

      {/* LE Coordination */}
      {(incident.responding_le_agency || incident.le_case_number) && (
        <div className="bg-surface-base border border-rmpg-600 p-4 mb-6">
          <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3 border-b border-rmpg-700 pb-2">External Agency Coordination</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            {incident.responding_le_agency && (
              <div>
                <label className="text-[10px] text-rmpg-500">Responding Agency</label>
                <p className="text-rmpg-200">{incident.responding_le_agency}</p>
              </div>
            )}
            {incident.le_case_number && (
              <div>
                <label className="text-[10px] text-rmpg-500">LE Case #</label>
                <p className="text-rmpg-200 font-mono">{incident.le_case_number}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Narrative */}
      <div className="bg-surface-base border border-rmpg-600 p-4 mb-6">
        <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3 border-b border-rmpg-700 pb-2">Narrative</h3>
        <p className="text-sm text-rmpg-200 leading-relaxed whitespace-pre-wrap">
          {incident.narrative || 'No narrative provided.'}
        </p>
      </div>

      {/* Supervisor Review */}
      {(incident.supervisor_name || incident.review_notes) && (
        <div className="bg-surface-base border border-rmpg-600 p-4 mb-6">
          <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3 border-b border-rmpg-700 pb-2">Supervisor Review</h3>
          {incident.supervisor_name && (
            <div className="mb-2">
              <label className="text-[10px] text-rmpg-500">Reviewer</label>
              <p className="text-sm text-rmpg-200">{incident.supervisor_name}</p>
            </div>
          )}
          {incident.review_notes && (
            <div>
              <label className="text-[10px] text-rmpg-500">Notes</label>
              <p className="text-sm text-rmpg-200">{incident.review_notes}</p>
            </div>
          )}
        </div>
      )}
    </DetachedLayout>
  );
}
