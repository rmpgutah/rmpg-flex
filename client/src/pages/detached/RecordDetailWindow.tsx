// ============================================================
// RMPG Flex — Record Detail Window (Detached)
// Person/Vehicle record view in a secondary browser window
// ============================================================

import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import DetachedLayout from '../../components/DetachedLayout';
import StatusBadge from '../../components/StatusBadge';
import { apiFetch } from '../../hooks/useApi';
import { formatIncidentType } from '../../utils/caseNumbers';

export default function RecordDetailWindow() {
  const { type, id } = useParams<{ type: string; id: string }>();
  const [record, setRecord] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!type || !id) return;
    (async () => {
      try {
        const endpoint = type === 'person' ? `/records/persons/${id}` : `/records/vehicles/${id}`;
        const data = await apiFetch<any>(endpoint);
        setRecord(data);
        document.title = type === 'person'
          ? `${data.last_name}, ${data.first_name} — RMPG Flex`
          : `${data.plate_number || 'Vehicle'} — RMPG Flex`;
      } catch (err: any) {
        setError(err.message || 'Failed to load record');
      } finally {
        setLoading(false);
      }
    })();
  }, [type, id]);

  if (loading) {
    return (
      <DetachedLayout title="Loading...">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 text-brand-400 animate-spin" role="status" aria-label="Loading" />
        </div>
      </DetachedLayout>
    );
  }

  if (error || !record) {
    return (
      <DetachedLayout title="Error">
        <div className="flex items-center justify-center h-64">
          <p className="text-red-400">{error || 'Record not found'}</p>
        </div>
      </DetachedLayout>
    );
  }

  if (type === 'person') {
    let flags: string[] = [];
    try { flags = JSON.parse(record.flags || '[]'); } catch { /* ignore */ }
    const incidents = record.incidents || [];

    return (
      <DetachedLayout
        title={`${record.last_name}, ${record.first_name}`}
        subtitle={`Person Record — ID: ${record.id}`}
      >
        {/* Person Details */}
        <div className="bg-surface-base border border-rmpg-600 p-6 mb-6">
          <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-4 border-b border-rmpg-700 pb-2">Personal Information</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <label className="text-[10px] text-rmpg-500 block">Last Name</label>
              <p className="text-white font-medium">{record.last_name}</p>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-500 block">First Name</label>
              <p className="text-white font-medium">{record.first_name}</p>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-500 block">Middle Name</label>
              <p className="text-rmpg-200">{record.middle_name || 'N/A'}</p>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-500 block">DOB</label>
              <p className="text-rmpg-200">{record.dob || 'N/A'}</p>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-500 block">Gender</label>
              <p className="text-rmpg-200">{record.gender || 'N/A'}</p>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-500 block">Race</label>
              <p className="text-rmpg-200">{record.race || 'N/A'}</p>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-500 block">Height</label>
              <p className="text-rmpg-200">{record.height || 'N/A'}</p>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-500 block">Weight</label>
              <p className="text-rmpg-200">{record.weight || 'N/A'}</p>
            </div>
          </div>

          {/* Physical Description */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm mt-4">
            <div>
              <label className="text-[10px] text-rmpg-500 block">Hair Color</label>
              <p className="text-rmpg-200">{record.hair_color || 'N/A'}</p>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-500 block">Eye Color</label>
              <p className="text-rmpg-200">{record.eye_color || 'N/A'}</p>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-500 block">Phone</label>
              <p className="text-rmpg-200">{record.phone || 'N/A'}</p>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-500 block">Email</label>
              <p className="text-rmpg-200">{record.email || 'N/A'}</p>
            </div>
          </div>

          {record.address && (
            <div className="mt-4">
              <label className="text-[10px] text-rmpg-500 block">Address</label>
              <p className="text-sm text-rmpg-200">{record.address}</p>
            </div>
          )}

          {/* Flags */}
          {flags.length > 0 && (
            <div className="flex items-center gap-2 mt-4">
              {flags.map((f, i) => {
                const flagText = typeof f === 'object' && f !== null ? (f as any).type || JSON.stringify(f) : String(f);
                return (
                  <span key={`${flagText}-${i}`} className="px-2 py-0.5 bg-red-900/40 text-red-400 text-[10px] uppercase font-bold border border-red-700/40">
                    {flagText}
                  </span>
                );
              })}
            </div>
          )}

          {record.notes && (
            <div className="mt-4">
              <label className="text-[10px] text-rmpg-500 block">Notes</label>
              <p className="text-sm text-rmpg-200 whitespace-pre-wrap">{record.notes}</p>
            </div>
          )}
        </div>

        {/* Incident History */}
        <div className="bg-surface-base border border-rmpg-600 p-4">
          <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3 border-b border-rmpg-700 pb-2">
            Incident History ({incidents.length})
          </h3>
          {incidents.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] text-rmpg-400 uppercase">
                  <th className="text-left pb-2">Case #</th>
                  <th className="text-left pb-2">Type</th>
                  <th className="text-left pb-2">Role</th>
                  <th className="text-left pb-2">Date</th>
                  <th className="text-left pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((inc: any, i: number) => (
                  <tr key={inc.id || `incident-${i}`} className="border-t border-rmpg-700/50">
                    <td className="py-1.5 text-white font-mono font-bold text-xs">{inc.incident_number}</td>
                    <td className="py-1.5 text-brand-400">{formatIncidentType(inc.incident_type || '')}</td>
                    <td className="py-1.5 text-rmpg-300">{(inc.role || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</td>
                    <td className="py-1.5 text-rmpg-300">{inc.created_at ? new Date(inc.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A'}</td>
                    <td className="py-1.5">
                      <StatusBadge status={inc.status || 'draft'} type="incident_status" size="sm" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-xs text-rmpg-500">No incidents on record</p>
          )}
        </div>
      </DetachedLayout>
    );
  }

  // Vehicle record
  const incidents = record.incidents || [];

  return (
    <DetachedLayout
      title={record.plate_number || 'Vehicle'}
      subtitle={`Vehicle Record — ${[record.year, record.color, record.make, record.model].filter(Boolean).join(' ')}`}
    >
      <div className="bg-surface-base border border-rmpg-600 p-6 mb-6">
        <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-4 border-b border-rmpg-700 pb-2">Vehicle Information</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <label className="text-[10px] text-rmpg-500 block">Plate Number</label>
            <p className="text-white font-mono font-bold">{record.plate_number || 'N/A'}</p>
          </div>
          <div>
            <label className="text-[10px] text-rmpg-500 block">State</label>
            <p className="text-rmpg-200">{record.state || 'N/A'}</p>
          </div>
          <div>
            <label className="text-[10px] text-rmpg-500 block">Year</label>
            <p className="text-rmpg-200">{record.year || 'N/A'}</p>
          </div>
          <div>
            <label className="text-[10px] text-rmpg-500 block">Color</label>
            <p className="text-rmpg-200">{record.color || 'N/A'}</p>
          </div>
          <div>
            <label className="text-[10px] text-rmpg-500 block">Make</label>
            <p className="text-rmpg-200">{record.make || 'N/A'}</p>
          </div>
          <div>
            <label className="text-[10px] text-rmpg-500 block">Model</label>
            <p className="text-rmpg-200">{record.model || 'N/A'}</p>
          </div>
          <div>
            <label className="text-[10px] text-rmpg-500 block">VIN</label>
            <p className="text-rmpg-200 font-mono">{record.vin || 'N/A'}</p>
          </div>
          <div>
            <label className="text-[10px] text-rmpg-500 block">Style</label>
            <p className="text-rmpg-200">{record.style || 'N/A'}</p>
          </div>
        </div>

        {/* Owner Info */}
        {(record.owner_first_name || record.owner_last_name) && (
          <div className="mt-4 pt-4 border-t border-rmpg-700">
            <h4 className="text-[10px] text-rmpg-500 uppercase font-bold mb-2">Registered Owner</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <label className="text-[10px] text-rmpg-500 block">Name</label>
                <p className="text-rmpg-200">{record.owner_first_name} {record.owner_last_name}</p>
              </div>
              {record.owner_phone && (
                <div>
                  <label className="text-[10px] text-rmpg-500 block">Phone</label>
                  <p className="text-rmpg-200">{record.owner_phone}</p>
                </div>
              )}
              {record.owner_address && (
                <div>
                  <label className="text-[10px] text-rmpg-500 block">Address</label>
                  <p className="text-rmpg-200">{record.owner_address}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {record.notes && (
          <div className="mt-4">
            <label className="text-[10px] text-rmpg-500 block">Notes</label>
            <p className="text-sm text-rmpg-200 whitespace-pre-wrap">{record.notes}</p>
          </div>
        )}
      </div>

      {/* Incident History */}
      <div className="bg-surface-base border border-rmpg-600 p-4">
        <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3 border-b border-rmpg-700 pb-2">
          Incident History ({incidents.length})
        </h3>
        {incidents.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] text-rmpg-400 uppercase">
                <th className="text-left pb-2">Case #</th>
                <th className="text-left pb-2">Type</th>
                <th className="text-left pb-2">Role</th>
                <th className="text-left pb-2">Date</th>
                <th className="text-left pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((inc: any, i: number) => (
                <tr key={inc.id || `incident-${i}`} className="border-t border-rmpg-700/50">
                  <td className="py-1.5 text-white font-mono font-bold text-xs">{inc.incident_number}</td>
                  <td className="py-1.5 text-brand-400">{formatIncidentType(inc.incident_type || '')}</td>
                  <td className="py-1.5 text-rmpg-300">{(inc.role || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</td>
                  <td className="py-1.5 text-rmpg-300">{inc.created_at ? new Date(inc.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A'}</td>
                  <td className="py-1.5">
                    <StatusBadge status={inc.status || 'draft'} type="incident_status" size="sm" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-xs text-rmpg-500">No incidents on record</p>
        )}
      </div>
    </DetachedLayout>
  );
}
