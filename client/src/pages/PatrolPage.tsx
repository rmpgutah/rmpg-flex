import React, { useState, useEffect, useCallback, useId } from 'react';
import {
  QrCode,
  MapPin,
  Clock,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Plus,
  Loader2,
  RefreshCw,
  Pencil,
  Trash2,
  Eye,
  X,
  Archive,
  RotateCcw,
  Copy,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import ConfirmDialog from '../components/ConfirmDialog';
import { usePersistedTab } from '../hooks/usePersistedState';
import PanelTitleBar from '../components/PanelTitleBar';
import RmpgLogo from '../components/RmpgLogo';
import PrintButton from '../components/PrintButton';
import ExportButton from '../components/ExportButton';
import TabBar from '../components/TabBar';

type Checkpoint = {
  id: number;
  property_id: number;
  property_name: string;
  name: string;
  description: string | null;
  qr_code: string;
  latitude: number | null;
  longitude: number | null;
  scan_required_interval_minutes: number;
  is_active: number;
  archived_at: string | null;
  created_at: string;
};

type Scan = {
  id: number;
  checkpoint_id: number;
  checkpoint_name: string;
  property_name: string;
  officer_id: number;
  officer_name: string;
  scanned_at: string;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  status: 'on_time' | 'late' | 'missed';
};

type Compliance = {
  checkpoint_id: number;
  checkpoint_name: string;
  property_name: string;
  scans_today: number;
  last_scan_time: string | null;
  compliance_rate: number;
  next_scan_due: string | null;
  scan_interval_minutes: number;
};

type Property = {
  id: number;
  name: string;
};

const PatrolPage: React.FC = () => {
  const checkpointModalTitleId = useId();
  const qrModalTitleId = useId();
  const [activeTab, setActiveTab] = usePersistedTab('rmpg_patrol_tab', 'checkpoints', ['checkpoints', 'scans', 'compliance'] as const);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [scans, setScans] = useState<Scan[]>([]);
  const [compliance, setCompliance] = useState<Compliance[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showCheckpointModal, setShowCheckpointModal] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [selectedQrCode, setSelectedQrCode] = useState('');
  const [editingCheckpoint, setEditingCheckpoint] = useState<Checkpoint | null>(null);
  const [formData, setFormData] = useState({
    property_id: '',
    name: '',
    description: '',
    latitude: '',
    longitude: '',
    scan_required_interval_minutes: '',
    is_active: true
  });

  // Scan filters
  const [scanFilters, setScanFilters] = useState({
    checkpointId: '',
    officerId: '',
    startDate: '',
    endDate: ''
  });

  useEffect(() => {
    loadProperties();
  }, []);

  useEffect(() => {
    if (activeTab === 'compliance') {
      const interval = setInterval(() => {
        loadCompliance();
      }, 60000);
      return () => clearInterval(interval);
    }
  }, [activeTab]);

  const loadProperties = async () => {
    try {
      const data = await apiFetch<Property[]>('/records/properties');
      setProperties(data);
    } catch (error) {
      console.error('Error loading properties:', error);
    }
  };

  const loadData = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) { setLoading(true); setError(null); }
    try {
      if (activeTab === 'checkpoints') {
        await loadCheckpoints();
      } else if (activeTab === 'scans') {
        await loadScans();
      } else if (activeTab === 'compliance') {
        await loadCompliance();
      }
    } catch (err: any) {
      if (!options?.silent) {
        console.error('Error loading data:', err);
        setError(err?.message || 'Failed to load data');
      }
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [activeTab]);

  const loadCheckpoints = async () => {
    try {
      const data = await apiFetch<Checkpoint[]>('/patrol/checkpoints');
      setCheckpoints(data);
    } catch {
      setCheckpoints([]);
    }
  };

  const loadScans = async () => {
    try {
      const params = new URLSearchParams();
      if (scanFilters.checkpointId) params.append('checkpointId', scanFilters.checkpointId);
      if (scanFilters.officerId) params.append('officerId', scanFilters.officerId);
      if (scanFilters.startDate) params.append('startDate', scanFilters.startDate);
      if (scanFilters.endDate) params.append('endDate', scanFilters.endDate);

      const data = await apiFetch<Scan[]>(`/patrol/scans?${params.toString()}`);
      setScans(data);
    } catch {
      setScans([]);
    }
  };

  const loadCompliance = async () => {
    try {
      const data = await apiFetch<Compliance[]>('/patrol/compliance');
      setCompliance(data);
    } catch {
      setCompliance([]);
    }
  };

  useEffect(() => {
    if (activeTab === 'scans') {
      loadScans();
    }
  }, [scanFilters]);

  useEffect(() => {
    loadData();
  }, [activeTab]);

  // Live sync — auto-refresh when any device modifies patrol data (silent to avoid unmounting UI)
  const silentRefreshPatrol = useCallback(() => loadData({ silent: true }), [loadData]);
  useLiveSync('patrol', silentRefreshPatrol);

  const handleCreateCheckpoint = () => {
    setEditingCheckpoint(null);
    setFormData({
      property_id: '',
      name: '',
      description: '',
      latitude: '',
      longitude: '',
      scan_required_interval_minutes: '',
      is_active: true
    });
    setShowCheckpointModal(true);
  };

  const handleEditCheckpoint = (checkpoint: Checkpoint) => {
    setEditingCheckpoint(checkpoint);
    setFormData({
      property_id: checkpoint.property_id.toString(),
      name: checkpoint.name,
      description: checkpoint.description || '',
      latitude: checkpoint.latitude?.toString() || '',
      longitude: checkpoint.longitude?.toString() || '',
      scan_required_interval_minutes: checkpoint.scan_required_interval_minutes.toString(),
      is_active: checkpoint.is_active === 1
    });
    setShowCheckpointModal(true);
  };

  const handleSaveCheckpoint = async () => {
    try {
      const payload = {
        property_id: parseInt(formData.property_id),
        name: formData.name,
        description: formData.description || null,
        latitude: formData.latitude ? parseFloat(formData.latitude) : null,
        longitude: formData.longitude ? parseFloat(formData.longitude) : null,
        scan_required_interval_minutes: parseInt(formData.scan_required_interval_minutes),
        is_active: formData.is_active
      };

      if (editingCheckpoint) {
        await apiFetch(`/patrol/checkpoints/${editingCheckpoint.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        await apiFetch('/patrol/checkpoints', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }

      setShowCheckpointModal(false);
      loadCheckpoints();
    } catch (err: any) {
      console.error('Error saving checkpoint:', err);
      setError(err?.message || 'Failed to save checkpoint');
    }
  };

  const handleDeleteCheckpoint = async (id: number) => {
    try {
      await apiFetch(`/patrol/checkpoints/${id}`, {
        method: 'DELETE'
      });
      setDeleteConfirmId(null);
      loadCheckpoints();
    } catch (err: any) {
      console.error('Error deleting checkpoint:', err);
      setError(err?.message || 'Failed to delete checkpoint');
    }
  };

  const handleArchiveCheckpoint = async (id: number) => {
    try {
      await apiFetch(`/patrol/checkpoints/${id}/archive`, { method: 'POST' });
      loadCheckpoints();
    } catch (err: any) {
      console.error('Error archiving checkpoint:', err);
      setError(err?.message || 'Failed to archive checkpoint');
    }
  };

  const handleUnarchiveCheckpoint = async (id: number) => {
    try {
      await apiFetch(`/patrol/checkpoints/${id}/unarchive`, { method: 'POST' });
      loadCheckpoints();
    } catch (err: any) {
      console.error('Error unarchiving checkpoint:', err);
      setError(err?.message || 'Failed to restore checkpoint');
    }
  };

  const handleShowQr = (qrCode: string) => {
    setSelectedQrCode(qrCode);
    setShowQrModal(true);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'on_time':
        return 'text-green-400';
      case 'late':
        return 'text-amber-400';
      case 'missed':
        return 'text-red-400';
      default:
        return 'text-rmpg-300';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'on_time':
        return <CheckCircle className="w-4 h-4" />;
      case 'late':
        return <AlertTriangle className="w-4 h-4" />;
      case 'missed':
        return <XCircle className="w-4 h-4" />;
      default:
        return null;
    }
  };

  const getComplianceColor = (rate: number) => {
    if (rate >= 90) return 'text-green-400 border-green-400';
    if (rate >= 70) return 'text-amber-400 border-amber-400';
    return 'text-red-400 border-red-400';
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
  };

  const formatTimeAgo = (dateString: string | null) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `${diffDays}d ago`;
    if (diffHours > 0) return `${diffHours}h ago`;
    if (diffMins > 0) return `${diffMins}m ago`;
    return 'Just now';
  };

  const isOverdue = (nextDue: string | null) => {
    if (!nextDue) return false;
    return new Date(nextDue) < new Date();
  };

  const patrolTabs = [
    { id: 'checkpoints' as const, label: 'Checkpoints', icon: QrCode },
    { id: 'scans' as const, label: 'Scan Log', icon: Clock },
    { id: 'compliance' as const, label: 'Compliance', icon: CheckCircle },
  ];

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Portal Header */}
      <div className="panel-beveled bg-surface-base overflow-hidden">
        <div className="flex items-center gap-4 px-4 py-2.5 relative">
          <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, #6e0a0a, #bc1010 30%, #bc1010 70%, #6e0a0a)' }} />
          <RmpgLogo height={64} />
          <div className="flex-1">
            <h1 className="text-sm font-bold tracking-wider uppercase text-rmpg-200">Patrol Operations</h1>
            <p className="text-[9px] tracking-wide text-rmpg-600">Rocky Mountain Protective Group, LLC</p>
          </div>
        </div>
      </div>

      <PanelTitleBar title="PATROL MANAGEMENT" icon={MapPin}>
        <PrintButton />
        {activeTab === 'scans' && (
          <ExportButton exportUrl="/patrol/scans/export?format=csv" exportFilename="patrol_scans_export.csv" />
        )}
        {activeTab === 'checkpoints' && (
          <button onClick={handleCreateCheckpoint} className="toolbar-btn toolbar-btn-primary">
            <Plus className="w-3.5 h-3.5" /> Add Checkpoint
          </button>
        )}
        {activeTab === 'compliance' && (
          <button onClick={loadCompliance} className="toolbar-btn">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        )}
      </PanelTitleBar>

      {/* Tabs */}
      <TabBar
        tabs={patrolTabs}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as 'checkpoints' | 'scans' | 'compliance')}
      />

      {/* Error Banner */}
      {error && (
        <div className="px-3 py-1.5 bg-red-900/30 border-b border-red-700/50 flex items-center gap-2 text-xs text-red-300 flex-shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-200">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Stats Strip */}
      {!loading && (
        <div className="px-4 py-1.5 border-b border-rmpg-700/50 flex items-center gap-4 text-[9px] font-mono flex-shrink-0 bg-surface-sunken">
          <div className="flex items-center gap-1">
            <QrCode className="w-3 h-3 text-brand-400" />
            <span className="text-rmpg-400">Checkpoints:</span>
            <span className="text-brand-400 font-bold">{checkpoints.length}</span>
          </div>
          <div className="flex items-center gap-1">
            <CheckCircle className="w-3 h-3 text-green-400" />
            <span className="text-rmpg-400">Active:</span>
            <span className="text-green-400 font-bold">{checkpoints.filter(c => c.is_active).length}</span>
          </div>
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3 text-blue-400" />
            <span className="text-rmpg-400">Scans Today:</span>
            <span className="text-blue-400 font-bold">
              {scans.filter(s => {
                const today = new Date().toDateString();
                return new Date(s.scanned_at).toDateString() === today;
              }).length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <MapPin className="w-3 h-3 text-purple-400" />
            <span className="text-rmpg-400">Total Scans:</span>
            <span className="text-purple-400 font-bold">{scans.length}</span>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center items-center h-64 panel-inset">
          <Loader2 className="w-8 h-8 animate-spin text-brand-400" />
        </div>
      ) : (
        <>
          {/* Checkpoints Tab */}
          {activeTab === 'checkpoints' && (
            <div className="panel-beveled overflow-hidden bg-[var(--surface-base)]">
              <table className="table-dark">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Property</th>
                    <th>Description</th>
                    <th>Interval</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {checkpoints.map((checkpoint) => (
                    <tr key={checkpoint.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <span className={`led-dot ${checkpoint.is_active ? 'led-green' : 'led-off'}`} />
                          <span className="text-white font-medium text-xs">{checkpoint.name}</span>
                        </div>
                      </td>
                      <td className="text-xs text-rmpg-200">
                        {checkpoint.property_name}
                      </td>
                      <td className="text-xs text-rmpg-200 max-w-[200px] truncate">
                        {checkpoint.description || '-'}
                      </td>
                      <td className="text-xs text-rmpg-200 font-mono">
                        {checkpoint.scan_required_interval_minutes} min
                      </td>
                      <td>
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold uppercase panel-beveled ${
                            checkpoint.is_active
                              ? 'bg-green-900/50 text-green-400 border border-green-700/50'
                              : 'bg-gray-700/50 text-rmpg-400 border border-rmpg-600/50'
                          }`}
                        >
                          {checkpoint.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => handleShowQr(checkpoint.qr_code)}
                            className="text-brand-400 hover:text-brand-300"
                            title="Show QR Code"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {!checkpoint.archived_at && (
                            <>
                              <button
                                onClick={() => handleEditCheckpoint(checkpoint)}
                                className="text-amber-400 hover:text-amber-300"
                                title="Edit"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleArchiveCheckpoint(checkpoint.id)}
                                className="text-slate-400 hover:text-slate-300"
                                title="Archive"
                              >
                                <Archive className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setDeleteConfirmId(checkpoint.id)}
                                className="text-red-400 hover:text-red-300"
                                title="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                          {checkpoint.archived_at && (
                            <button
                              onClick={() => handleUnarchiveCheckpoint(checkpoint.id)}
                              className="text-green-400 hover:text-green-300"
                              title="Unarchive"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {checkpoints.length === 0 && (
                <div className="text-center py-12 text-rmpg-300">
                  No checkpoints found. Create one to get started.
                </div>
              )}
            </div>
          )}

          {/* Scans Tab */}
          {activeTab === 'scans' && (
            <>
              {/* Filters */}
              <div className="panel-beveled p-4 mb-4 bg-[var(--surface-base)]">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-rmpg-200 mb-1">
                      Checkpoint:
                    </label>
                    <select
                      value={scanFilters.checkpointId}
                      onChange={(e) =>
                        setScanFilters(prev => ({ ...prev, checkpointId: e.target.value }))
                      }
                      className="select-dark"
                    >
                      <option value="">All Checkpoints</option>
                      {checkpoints.map((cp) => (
                        <option key={cp.id} value={cp.id}>
                          {cp.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-rmpg-200 mb-1">
                      Start Date:
                    </label>
                    <input
                      type="datetime-local"
                      value={scanFilters.startDate}
                      onChange={(e) =>
                        setScanFilters(prev => ({ ...prev, startDate: e.target.value }))
                      }
                      className="input-dark"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-rmpg-200 mb-1">
                      End Date:
                    </label>
                    <input
                      type="datetime-local"
                      value={scanFilters.endDate}
                      onChange={(e) =>
                        setScanFilters(prev => ({ ...prev, endDate: e.target.value }))
                      }
                      className="input-dark"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={() =>
                        setScanFilters({
                          checkpointId: '',
                          officerId: '',
                          startDate: '',
                          endDate: ''
                        })
                      }
                      className="toolbar-btn w-full justify-center"
                    >
                      <X className="w-4 h-4" />
                      Clear Filters
                    </button>
                  </div>
                </div>
              </div>

              <div className="panel-beveled overflow-hidden bg-[var(--surface-base)]">
                <table className="table-dark">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Officer</th>
                      <th>Checkpoint</th>
                      <th>Property</th>
                      <th>Status</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scans.map((scan) => (
                      <tr key={scan.id}>
                        <td className="text-xs text-rmpg-200 font-mono whitespace-nowrap">
                          {formatDateTime(scan.scanned_at)}
                        </td>
                        <td className="text-xs text-rmpg-200">{scan.officer_name}</td>
                        <td className="text-xs text-white font-medium">{scan.checkpoint_name}</td>
                        <td className="text-xs text-rmpg-200">{scan.property_name}</td>
                        <td>
                          <div className={`flex items-center gap-2 text-xs ${getStatusColor(scan.status)}`}>
                            {getStatusIcon(scan.status)}
                            <span className="capitalize">{scan.status.replace('_', ' ')}</span>
                          </div>
                        </td>
                        <td className="text-xs text-rmpg-200 max-w-[200px] truncate">{scan.notes || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {scans.length === 0 && (
                  <div className="text-center py-12 text-rmpg-300">
                    No scans found matching the filters.
                  </div>
                )}
              </div>
            </>
          )}

          {/* Compliance Tab */}
          {activeTab === 'compliance' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {compliance.map((item) => {
                const complianceColor = getComplianceColor(item.compliance_rate);
                const overdue = isOverdue(item.next_scan_due);

                return (
                  <div
                    key={item.checkpoint_id}
                    className={`panel-beveled p-6 border-2 bg-surface-base ${complianceColor}`}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="text-lg font-bold text-white mb-1">
                          {item.checkpoint_name}
                        </h3>
                        <p className="text-sm text-rmpg-300">{item.property_name}</p>
                      </div>
                      <div className={`text-2xl font-bold font-mono ${complianceColor}`}>
                        {item.compliance_rate}%
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-rmpg-300">Scans Today:</span>
                        <span className="text-white font-medium font-mono">{item.scans_today}</span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-sm text-rmpg-300">Last Scan:</span>
                        <span className="text-white font-medium font-mono">
                          {formatTimeAgo(item.last_scan_time)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-sm text-rmpg-300">Interval:</span>
                        <span className="text-white font-medium font-mono">
                          {item.scan_interval_minutes} min
                        </span>
                      </div>

                      <div className="pt-3 border-t border-rmpg-700">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-rmpg-300">Next Due:</span>
                          {item.next_scan_due ? (
                            <span
                              className={`text-sm font-medium ${
                                overdue ? 'text-red-400' : 'text-green-400'
                              }`}
                            >
                              {overdue ? 'OVERDUE' : formatTimeAgo(item.next_scan_due)}
                            </span>
                          ) : (
                            <span className="text-sm text-rmpg-400">Not scanned yet</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {compliance.length === 0 && (
                <div className="col-span-3 text-center py-12 text-rmpg-300">
                  No active checkpoints found.
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Checkpoint Modal */}
      {showCheckpointModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" role="dialog" aria-modal="true" aria-labelledby={checkpointModalTitleId}>
          <div className="panel-beveled bg-surface-base p-6 max-w-md w-full mx-4">
            <h2 id={checkpointModalTitleId} className="text-xl font-bold text-white mb-4">
              {editingCheckpoint ? 'Edit Checkpoint' : 'Create Checkpoint'}
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-rmpg-200 mb-1">
                  Property: *
                </label>
                <select
                  value={formData.property_id}
                  onChange={(e) => setFormData(prev => ({ ...prev, property_id: e.target.value }))}
                  className="select-dark"
                  required
                >
                  <option value="">Select Property</option>
                  {properties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-rmpg-200 mb-1">
                  Checkpoint Name: *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="input-dark"
                  placeholder="e.g., Main Entrance"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-rmpg-200 mb-1">
                  Description:
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  className="textarea-dark"
                  rows={3}
                  placeholder="Optional description"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-rmpg-200 mb-1">
                  Scan Interval (minutes): *
                </label>
                <input
                  type="number"
                  value={formData.scan_required_interval_minutes}
                  onChange={(e) =>
                    setFormData(prev => ({
                      ...prev,
                      scan_required_interval_minutes: e.target.value
                    }))
                  }
                  className="input-dark"
                  placeholder="e.g., 60"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-rmpg-200 mb-1">
                    Latitude:
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={formData.latitude}
                    onChange={(e) => setFormData(prev => ({ ...prev, latitude: e.target.value }))}
                    className="input-dark"
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-rmpg-200 mb-1">
                    Longitude:
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={formData.longitude}
                    onChange={(e) => setFormData(prev => ({ ...prev, longitude: e.target.value }))}
                    className="input-dark"
                    placeholder="Optional"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_active"
                  checked={formData.is_active}
                  onChange={(e) => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
                  className="w-4 h-4 bg-gray-700 border-rmpg-600"
                />
                <label htmlFor="is_active" className="text-sm text-rmpg-200">
                  Active
                </label>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowCheckpointModal(false)}
                className="toolbar-btn flex-1 justify-center"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveCheckpoint}
                className="toolbar-btn toolbar-btn-primary flex-1 justify-center"
                disabled={
                  !formData.property_id ||
                  !formData.name ||
                  !formData.scan_required_interval_minutes
                }
              >
                {editingCheckpoint ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR Code Modal */}
      {showQrModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" role="dialog" aria-modal="true" aria-labelledby={qrModalTitleId}>
          <div className="panel-beveled bg-surface-base p-6 max-w-lg w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h2 id={qrModalTitleId} className="text-xl font-bold text-white">QR Code</h2>
              <button
                onClick={() => setShowQrModal(false)}
                className="text-rmpg-300 hover:text-white"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="bg-surface-sunken panel-inset p-8 text-center">
              <QrCode className="w-16 h-16 text-brand-400 mx-auto mb-4" />
              <p className="text-xs text-rmpg-300 mb-2">Scan this code with a QR scanner app:</p>
              <p className="text-2xl font-mono text-white break-all">{selectedQrCode}</p>
            </div>

            <p className="text-sm text-rmpg-300 mt-4">
              Officers should scan this QR code at the checkpoint location to log their patrol.
            </p>

            <button
              onClick={() => {
                navigator.clipboard.writeText(selectedQrCode);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="toolbar-btn toolbar-btn-primary w-full mt-4 justify-center py-2"
            >
              <Copy className="w-3.5 h-3.5" />
              {copied ? 'Copied!' : 'Copy to Clipboard'}
            </button>
          </div>
        </div>
      )}
      {/* Delete Checkpoint Confirmation */}
      <ConfirmDialog
        isOpen={deleteConfirmId !== null}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={() => deleteConfirmId && handleDeleteCheckpoint(deleteConfirmId)}
        title="Delete Checkpoint"
        message="Are you sure you want to delete this checkpoint? This action cannot be undone."
        confirmLabel="Delete"
        confirmVariant="danger"
      />
    </div>
  );
};

export default PatrolPage;
