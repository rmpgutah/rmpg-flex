import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Camera, Plus, Search, Monitor, HardDrive, Film,
  Eye, Flag, Clock, AlertTriangle, CheckCircle,
  X, RefreshCw, ChevronDown, Shield, Activity,
  Upload, Download, Lock, BarChart3, Video,
  Battery, Cpu, Users as UsersIcon, Archive,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import StatusBadge from '../components/StatusBadge';
import FormModal from '../components/FormModal';
import { usePersistedTab } from '../hooks/usePersistedState';
import { formatDateTime, formatDate } from '../utils/dateUtils';

const CATEGORIES = [
  { value: 'routine', label: 'Routine', color: 'text-gray-400' },
  { value: 'arrest', label: 'Arrest', color: 'text-red-400' },
  { value: 'use_of_force', label: 'Use of Force', color: 'text-red-500' },
  { value: 'traffic_stop', label: 'Traffic Stop', color: 'text-blue-400' },
  { value: 'pursuit', label: 'Pursuit', color: 'text-orange-400' },
  { value: 'interview', label: 'Interview', color: 'text-cyan-400' },
  { value: 'evidence', label: 'Evidence Collection', color: 'text-yellow-400' },
  { value: 'critical_incident', label: 'Critical Incident', color: 'text-red-600' },
  { value: 'training', label: 'Training', color: 'text-green-400' },
  { value: 'other', label: 'Other', color: 'text-gray-400' },
];

const DEVICE_TYPES = [
  { value: 'body', label: 'Body Camera' },
  { value: 'dash', label: 'Dash Camera' },
  { value: 'interview_room', label: 'Interview Room' },
  { value: 'taser_cam', label: 'Taser Camera' },
];

const RETENTION_CLASSES = [
  { value: 'standard', label: 'Standard (1 year)', color: 'text-gray-400' },
  { value: 'extended', label: 'Extended (3 years)', color: 'text-yellow-400' },
  { value: 'permanent', label: 'Permanent', color: 'text-blue-400' },
  { value: 'litigation_hold', label: 'Litigation Hold', color: 'text-red-400' },
];

// ─── Modal Components (proper components so hooks are valid) ─────

function DeviceModal({ editItem, personnel, loading, onSave, onClose }: {
  editItem: any; personnel: any[]; loading: boolean;
  onSave: (form: any) => void; onClose: () => void;
}) {
  const [form, setForm] = useState<any>(editItem || {
    device_serial: '', device_model: 'Axon Body 3', device_type: 'body',
    assigned_officer_id: '', firmware_version: '', storage_capacity_gb: '',
    purchase_date: '', warranty_expiry: '', notes: '',
  });
  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }));

  return (
    <FormModal isOpen={true} title={editItem ? 'Edit Device' : 'Register Device'} onClose={onClose}
      onSubmit={(e) => { e.preventDefault(); onSave(form); }} isSubmitting={loading}>
      <fieldset className="space-y-3 border border-rmpg-600/30 p-3">
        <legend className="text-xs font-bold text-rmpg-300 px-2 uppercase">Device Info</legend>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Serial Number *</span>
            <input className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.device_serial} onChange={e => set('device_serial', e.target.value)} required />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Model</span>
            <input className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.device_model} onChange={e => set('device_model', e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Type</span>
            <select className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.device_type} onChange={e => set('device_type', e.target.value)}>
              {DEVICE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Assigned Officer</span>
            <select className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.assigned_officer_id} onChange={e => set('assigned_officer_id', e.target.value || null)}>
              <option value="">— Unassigned —</option>
              {personnel.map((p: any) => (
                <option key={p.id} value={p.id}>{p.full_name} ({p.badge_number})</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Firmware Version</span>
            <input className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.firmware_version} onChange={e => set('firmware_version', e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Storage (GB)</span>
            <input type="number" className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.storage_capacity_gb} onChange={e => set('storage_capacity_gb', parseInt(e.target.value) || '')} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Purchase Date</span>
            <input type="date" className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.purchase_date} onChange={e => set('purchase_date', e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Warranty Expiry</span>
            <input type="date" className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.warranty_expiry} onChange={e => set('warranty_expiry', e.target.value)} />
          </label>
        </div>
        <label className="space-y-1">
          <span className="text-xs text-rmpg-400">Notes</span>
          <textarea className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5 h-16"
            value={form.notes || ''} onChange={e => set('notes', e.target.value)} />
        </label>
      </fieldset>
    </FormModal>
  );
}

function FootageModal({ editItem, devices, personnel, loading, onSave, onClose }: {
  editItem: any; devices: any[]; personnel: any[]; loading: boolean;
  onSave: (form: any) => void; onClose: () => void;
}) {
  const [form, setForm] = useState<any>(editItem || {
    device_id: '', officer_id: '', title: '', category: 'routine',
    start_time: '', end_time: '', file_size_mb: '', storage_location: '',
    retention_class: 'standard', linked_incident_id: '', linked_call_id: '',
    flagged: false, flag_reason: '', notes: '',
  });
  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }));

  // ─── Chunked Upload State ─────────────────────────
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'complete' | 'error'>('idle');
  const [uploadError, setUploadError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const uploadAbortRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB per chunk
  const VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/x-msvideo,video/webm,video/x-matroska,video/mpeg,video/3gpp,.mp4,.mov,.avi,.webm,.mkv,.mpg,.mpeg,.ts';

  const formatFileSize = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  };

  const handleFileSelect = (file: File) => {
    const sizeMb = file.size / (1024 * 1024);
    set('file_size_mb', Math.round(sizeMb * 10) / 10);
    setSelectedFile(file);
    setUploadStatus('idle');
    setUploadError('');
    setUploadProgress(0);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('video/')) handleFileSelect(file);
  };

  const startUpload = async () => {
    if (!selectedFile) return;
    const token = localStorage.getItem('rmpg_token');
    if (!token) { setUploadError('Not authenticated'); setUploadStatus('error'); return; }

    setUploadStatus('uploading');
    setUploadProgress(0);
    setUploadError('');
    uploadAbortRef.current = false;

    const totalChunks = Math.ceil(selectedFile.size / CHUNK_SIZE);

    try {
      // Phase 1: Initialize upload session
      const initRes = await fetch('/api/uploads/chunked/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          filename: selectedFile.name,
          fileSize: selectedFile.size,
          mimeType: selectedFile.type || 'application/octet-stream',
          totalChunks,
          entity_type: 'body_camera_footage',
        }),
      });
      if (!initRes.ok) {
        const err = await initRes.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to initialize upload');
      }
      const { uploadId } = await initRes.json();

      // Phase 2: Upload chunks sequentially
      for (let i = 0; i < totalChunks; i++) {
        if (uploadAbortRef.current) throw new Error('Upload cancelled');

        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, selectedFile.size);
        const chunk = selectedFile.slice(start, end);

        let retries = 0;
        let success = false;
        while (!success && retries < 3) {
          const chunkRes = await fetch(`/api/uploads/chunked/${uploadId}/${i}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream', 'Authorization': `Bearer ${token}` },
            body: chunk,
          });
          if (chunkRes.ok) {
            success = true;
          } else if (retries < 2) {
            retries++;
            await new Promise(r => setTimeout(r, 1000 * retries)); // backoff
          } else {
            const err = await chunkRes.json().catch(() => ({}));
            throw new Error(err.error || `Chunk ${i + 1}/${totalChunks} failed after retries`);
          }
        }

        setUploadProgress(Math.round(((i + 1) / totalChunks) * 100));
      }

      // Phase 3: Complete — reassemble on server
      const completeRes = await fetch(`/api/uploads/chunked/${uploadId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      });
      if (!completeRes.ok) {
        const err = await completeRes.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to finalize upload');
      }

      const attachment = await completeRes.json();
      set('storage_location', attachment.file_id);
      setUploadStatus('complete');
      setUploadProgress(100);
    } catch (err: any) {
      if (!uploadAbortRef.current) {
        setUploadStatus('error');
        setUploadError(err.message || 'Upload failed');
      } else {
        setUploadStatus('idle');
        setSelectedFile(null);
      }
    }
  };

  const cancelUpload = () => { uploadAbortRef.current = true; };

  const isUploading = uploadStatus === 'uploading';
  const hasExistingFile = !!editItem?.storage_location;

  return (
    <FormModal isOpen={true} title={editItem ? 'Edit Footage' : 'Log Footage'} onClose={onClose}
      onSubmit={(e) => { e.preventDefault(); onSave(form); }}
      isSubmitting={loading || isUploading} maxWidth="lg">
      <fieldset className="space-y-3 border border-rmpg-600/30 p-3">
        <legend className="text-xs font-bold text-rmpg-300 px-2 uppercase">Recording Info</legend>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Device *</span>
            <select className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.device_id} onChange={e => set('device_id', parseInt(e.target.value) || '')} required>
              <option value="">Select device...</option>
              {devices.map((d: any) => (
                <option key={d.id} value={d.id}>{d.device_serial} ({d.device_model})</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Officer</span>
            <select className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.officer_id} onChange={e => set('officer_id', parseInt(e.target.value) || '')}>
              <option value="">Self</option>
              {personnel.map((p: any) => (
                <option key={p.id} value={p.id}>{p.full_name} ({p.badge_number})</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Title</span>
            <input className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.title} onChange={e => set('title', e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Category</span>
            <select className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.category} onChange={e => set('category', e.target.value)}>
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Start Time *</span>
            <input type="datetime-local" className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.start_time} onChange={e => set('start_time', e.target.value)} required />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">End Time</span>
            <input type="datetime-local" className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.end_time} onChange={e => set('end_time', e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">File Size (MB)</span>
            <input type="number" className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.file_size_mb} onChange={e => set('file_size_mb', parseFloat(e.target.value) || '')}
              readOnly={!!selectedFile} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Retention Class</span>
            <select className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.retention_class} onChange={e => set('retention_class', e.target.value)}>
              {RETENTION_CLASSES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </label>
        </div>
      </fieldset>

      {/* ─── Video File Upload ─────────────────────────── */}
      <fieldset className="space-y-3 border border-rmpg-600/30 p-3">
        <legend className="text-xs font-bold text-rmpg-300 px-2 uppercase">
          <span className="flex items-center gap-1.5">
            <Upload className="w-3 h-3" /> Video File
          </span>
        </legend>

        {hasExistingFile && !selectedFile && (
          <div className="flex items-center gap-2 bg-blue-900/20 border border-blue-600/30 px-3 py-2 text-xs text-blue-300">
            <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
            <span>File already attached ({form.file_size_mb ? `${form.file_size_mb} MB` : 'size unknown'})</span>
          </div>
        )}

        {uploadStatus === 'complete' && (
          <div className="flex items-center gap-2 bg-green-900/20 border border-green-600/30 px-3 py-2 text-xs text-green-300">
            <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
            <span>Upload complete — {selectedFile?.name} ({formatFileSize(selectedFile?.size || 0)})</span>
          </div>
        )}

        {uploadStatus !== 'complete' && (
          <>
            {/* Drop zone / file picker */}
            {!isUploading && (
              <div
                className={`relative border-2 border-dashed rounded transition-colors cursor-pointer
                  ${dragOver ? 'border-cyan-400 bg-cyan-900/10' : 'border-rmpg-600/40 hover:border-rmpg-500/60'}
                  ${selectedFile ? 'p-2' : 'p-5'}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={VIDEO_ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileSelect(f);
                  }}
                />

                {!selectedFile ? (
                  <div className="text-center">
                    <Video className="w-8 h-8 text-rmpg-500 mx-auto mb-2" />
                    <p className="text-sm text-rmpg-300">Drop video file here or click to browse</p>
                    <p className="text-xs text-rmpg-500 mt-1">MP4, MOV, AVI, MKV, WebM — up to 4 GB</p>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <Film className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm text-rmpg-200 truncate">{selectedFile.name}</p>
                        <p className="text-xs text-rmpg-400">{formatFileSize(selectedFile.size)}</p>
                      </div>
                    </div>
                    <button type="button" onClick={(e) => {
                      e.stopPropagation();
                      setSelectedFile(null);
                      set('file_size_mb', '');
                      set('storage_location', editItem?.storage_location || '');
                      setUploadStatus('idle');
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }} className="p-1 hover:bg-rmpg-600/30 text-rmpg-400 hover:text-rmpg-200">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Upload button */}
            {selectedFile && uploadStatus === 'idle' && (
              <button type="button" onClick={startUpload}
                className="flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold px-3 py-1.5 w-full justify-center">
                <Upload className="w-3.5 h-3.5" /> UPLOAD {formatFileSize(selectedFile.size)}
              </button>
            )}

            {/* Progress bar */}
            {isUploading && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-rmpg-300 flex items-center gap-1.5">
                    <RefreshCw className="w-3 h-3 animate-spin text-cyan-400" />
                    Uploading {selectedFile?.name}...
                  </span>
                  <span className="text-cyan-400 font-bold">{uploadProgress}%</span>
                </div>
                <div className="h-2 bg-rmpg-700/50 rounded overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-600 to-cyan-400 transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-rmpg-500">
                  <span>{formatFileSize((selectedFile?.size || 0) * uploadProgress / 100)} / {formatFileSize(selectedFile?.size || 0)}</span>
                  <button type="button" onClick={cancelUpload}
                    className="text-red-400 hover:text-red-300 font-bold">
                    CANCEL
                  </button>
                </div>
              </div>
            )}

            {/* Error */}
            {uploadStatus === 'error' && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 bg-red-900/20 border border-red-600/30 px-3 py-2 text-xs text-red-300">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>{uploadError}</span>
                </div>
                <button type="button" onClick={startUpload}
                  className="flex items-center gap-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-bold px-3 py-1.5">
                  <RefreshCw className="w-3 h-3" /> RETRY
                </button>
              </div>
            )}
          </>
        )}
      </fieldset>

      <fieldset className="space-y-3 border border-rmpg-600/30 p-3">
        <legend className="text-xs font-bold text-rmpg-300 px-2 uppercase">Linked Records</legend>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Incident ID</span>
            <input type="number" className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.linked_incident_id} onChange={e => set('linked_incident_id', parseInt(e.target.value) || '')} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Call ID</span>
            <input type="number" className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.linked_call_id} onChange={e => set('linked_call_id', parseInt(e.target.value) || '')} />
          </label>
        </div>
        <label className="space-y-1">
          <span className="text-xs text-rmpg-400">Notes</span>
          <textarea className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5 h-16"
            value={form.notes || ''} onChange={e => set('notes', e.target.value)} />
        </label>
      </fieldset>
    </FormModal>
  );
}

// ─── Main Page Component ─────────────────────────────────────────

export default function BodyCameraPage() {
  const [activeTab, setActiveTab] = usePersistedTab('bwc-tab', 'dashboard');
  const [stats, setStats] = useState<any>(null);
  const [devices, setDevices] = useState<any[]>([]);
  const [footage, setFootage] = useState<any[]>([]);
  const [personnel, setPersonnel] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [deviceStatusFilter, setDeviceStatusFilter] = useState('');
  const [showModal, setShowModal] = useState<'device' | 'footage' | null>(null);
  const [editItem, setEditItem] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const data = await apiFetch('/api/body-cameras/stats');
      setStats(data);
    } catch (e) { console.error('Failed to load BWC stats:', e); }
  }, []);

  const fetchDevices = useCallback(async () => {
    try {
      let url = '/api/body-cameras/devices?';
      if (deviceStatusFilter) url += `status=${deviceStatusFilter}&`;
      if (search) url += `search=${encodeURIComponent(search)}&`;
      const data = await apiFetch(url);
      setDevices(data);
    } catch (e) { console.error('Failed to load devices:', e); }
  }, [deviceStatusFilter, search]);

  const fetchFootage = useCallback(async () => {
    try {
      let url = '/api/body-cameras/footage?';
      if (categoryFilter) url += `category=${categoryFilter}&`;
      if (statusFilter) url += `status=${statusFilter}&`;
      if (search) url += `search=${encodeURIComponent(search)}&`;
      const data = await apiFetch(url);
      setFootage(data);
    } catch (e) { console.error('Failed to load footage:', e); }
  }, [categoryFilter, statusFilter, search]);

  const fetchPersonnel = useCallback(async () => {
    try {
      const data = await apiFetch('/api/personnel');
      setPersonnel(data);
    } catch (e) { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchStats();
    fetchPersonnel();
  }, []);

  useEffect(() => {
    if (activeTab === 'devices') fetchDevices();
    if (activeTab === 'footage') fetchFootage();
  }, [activeTab, fetchDevices, fetchFootage]);

  // ─── Device Save ─────────────────────────────────
  const saveDevice = async (form: any) => {
    setLoading(true);
    try {
      if (editItem?.id) {
        await apiFetch(`/api/body-cameras/devices/${editItem.id}`, { method: 'PUT', body: JSON.stringify(form) });
      } else {
        await apiFetch('/api/body-cameras/devices', { method: 'POST', body: JSON.stringify(form) });
      }
      setShowModal(null);
      setEditItem(null);
      fetchDevices();
      fetchStats();
    } catch (e: any) {
      alert(e.message || 'Failed to save device');
    } finally { setLoading(false); }
  };

  // ─── Device Checkout/Checkin ─────────────────────
  const checkoutDevice = async (deviceId: number) => {
    try {
      await apiFetch(`/api/body-cameras/devices/${deviceId}/checkout`, {
        method: 'POST', body: JSON.stringify({})
      });
      fetchDevices();
      fetchStats();
    } catch (e: any) { alert(e.message || 'Checkout failed'); }
  };

  const checkinDevice = async (deviceId: number) => {
    try {
      await apiFetch(`/api/body-cameras/devices/${deviceId}/checkin`, {
        method: 'POST', body: JSON.stringify({})
      });
      fetchDevices();
      fetchStats();
    } catch (e: any) { alert(e.message || 'Checkin failed'); }
  };

  // ─── Footage Save ────────────────────────────────
  const saveFootage = async (form: any) => {
    setLoading(true);
    try {
      if (editItem?.id) {
        await apiFetch(`/api/body-cameras/footage/${editItem.id}`, { method: 'PUT', body: JSON.stringify(form) });
      } else {
        await apiFetch('/api/body-cameras/footage', { method: 'POST', body: JSON.stringify(form) });
      }
      setShowModal(null);
      setEditItem(null);
      fetchFootage();
      fetchStats();
    } catch (e: any) {
      alert(e.message || 'Failed to save footage record');
    } finally { setLoading(false); }
  };

  // ─── Flag Footage ────────────────────────────────
  const toggleFlag = async (id: number, currentFlag: boolean) => {
    const reason = !currentFlag ? prompt('Flag reason:') : null;
    if (!currentFlag && !reason) return;
    try {
      await apiFetch(`/api/body-cameras/footage/${id}/flag`, {
        method: 'PUT', body: JSON.stringify({ flagged: !currentFlag, flag_reason: reason })
      });
      fetchFootage();
    } catch (e: any) { alert(e.message); }
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '—';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
  };

  const formatSize = (mb: number | null) => {
    if (!mb) return '—';
    return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
  };

  // ─── TAB: Dashboard ──────────────────────────────
  const renderDashboard = () => {
    if (!stats) return <div className="p-6 text-rmpg-400">Loading...</div>;

    return (
      <div className="space-y-4">
        {/* Stat Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { icon: Monitor, label: 'Total Devices', value: stats.devices.total, color: 'text-blue-400' },
            { icon: CheckCircle, label: 'Assigned', value: stats.devices.assigned, color: 'text-green-400' },
            { icon: Film, label: 'Total Footage', value: stats.footage.total, color: 'text-cyan-400' },
            { icon: HardDrive, label: 'Storage Used', value: `${stats.footage.totalStorageGb} GB`, color: 'text-yellow-400' },
          ].map((s, i) => (
            <div key={i} className="bg-surface-raised border border-rmpg-600/30 p-3">
              <s.icon className={`w-5 h-5 ${s.color} mb-1`} />
              <div className="text-xs text-rmpg-400 uppercase">{s.label}</div>
              <div className="text-xl font-bold text-rmpg-100">{s.value}</div>
            </div>
          ))}
        </div>

        {/* Alert cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { icon: Flag, label: 'Flagged', value: stats.footage.flagged, color: stats.footage.flagged > 0 ? 'text-red-400' : 'text-gray-500' },
            { icon: Eye, label: 'Pending Review', value: stats.footage.pendingReview, color: stats.footage.pendingReview > 0 ? 'text-yellow-400' : 'text-gray-500' },
            { icon: Lock, label: 'Litigation Hold', value: stats.footage.litigationHold, color: stats.footage.litigationHold > 0 ? 'text-red-400' : 'text-gray-500' },
            { icon: Clock, label: 'Retention Expiring', value: stats.footage.expiringRetention, color: stats.footage.expiringRetention > 0 ? 'text-orange-400' : 'text-gray-500' },
          ].map((s, i) => (
            <div key={i} className="bg-surface-raised border border-rmpg-600/30 p-3">
              <s.icon className={`w-4 h-4 ${s.color} mb-1`} />
              <div className="text-xs text-rmpg-400 uppercase">{s.label}</div>
              <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Footage by Category */}
          <div className="bg-surface-raised border border-rmpg-600/30">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-rmpg-600/30">
              <BarChart3 className="w-4 h-4 text-cyan-400" />
              <span className="text-xs font-bold text-rmpg-200 uppercase">Footage by Category</span>
            </div>
            <div className="p-3 space-y-2">
              {stats.footage.byCategory.length === 0 && <div className="text-rmpg-500 text-sm">No data</div>}
              {stats.footage.byCategory.map((c: any) => {
                const cat = CATEGORIES.find(x => x.value === c.category);
                const pct = stats.footage.total > 0 ? Math.round(100 * c.count / stats.footage.total) : 0;
                return (
                  <div key={c.category} className="flex items-center gap-2">
                    <span className={`text-xs w-28 truncate ${cat?.color || 'text-gray-400'}`}>{cat?.label || c.category}</span>
                    <div className="flex-1 h-2 bg-rmpg-700/50 rounded overflow-hidden">
                      <div className="h-full bg-cyan-600 rounded" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-rmpg-300 w-8 text-right">{c.count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Officers with most footage (last 30 days) */}
          <div className="bg-surface-raised border border-rmpg-600/30">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-rmpg-600/30">
              <UsersIcon className="w-4 h-4 text-blue-400" />
              <span className="text-xs font-bold text-rmpg-200 uppercase">Top Officers (30d)</span>
            </div>
            <div className="p-3">
              {stats.byOfficer.length === 0 && <div className="text-rmpg-500 text-sm">No data</div>}
              {stats.byOfficer.map((o: any, i: number) => (
                <div key={i} className="flex items-center justify-between py-1 border-b border-rmpg-700/30 last:border-0">
                  <span className="text-sm text-rmpg-200">{o.full_name}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-rmpg-400">{o.count} clips</span>
                    <span className="text-xs text-cyan-400">{o.total_hours}h</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Recent Checkout Activity */}
        {stats.recentCheckouts.length > 0 && (
          <div className="bg-surface-raised border border-rmpg-600/30">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-rmpg-600/30">
              <Activity className="w-4 h-4 text-green-400" />
              <span className="text-xs font-bold text-rmpg-200 uppercase">Recent Device Activity</span>
            </div>
            <div className="p-3 space-y-1">
              {stats.recentCheckouts.map((cl: any) => (
                <div key={cl.id} className="flex items-center justify-between text-xs py-1">
                  <div className="flex items-center gap-2">
                    <span className={cl.action === 'checkout' ? 'text-green-400' : cl.action === 'checkin' ? 'text-blue-400' : 'text-yellow-400'}>
                      {cl.action.toUpperCase()}
                    </span>
                    <span className="text-rmpg-300">{cl.device_serial}</span>
                    <span className="text-rmpg-400">→ {cl.officer_name}</span>
                  </div>
                  <span className="text-rmpg-500">{formatDateTime(cl.performed_at)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  // ─── TAB: Devices ────────────────────────────────
  const renderDevices = () => (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-rmpg-500" />
          <input
            className="w-full bg-surface-raised border border-rmpg-600/30 text-rmpg-200 text-sm pl-8 pr-3 py-1.5"
            placeholder="Search devices..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select className="bg-surface-raised border border-rmpg-600/30 text-rmpg-300 text-xs py-1.5 px-2"
          value={deviceStatusFilter} onChange={e => setDeviceStatusFilter(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="available">Available</option>
          <option value="assigned">Assigned</option>
          <option value="maintenance">Maintenance</option>
          <option value="decommissioned">Decommissioned</option>
        </select>
        <button onClick={() => { setEditItem(null); setShowModal('device'); }}
          className="flex items-center gap-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-3 py-1.5">
          <Plus className="w-3.5 h-3.5" /> ADD DEVICE
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-rmpg-600/30 text-rmpg-400 uppercase">
              <th className="text-left py-2 px-2">Serial</th>
              <th className="text-left py-2 px-2">Model</th>
              <th className="text-left py-2 px-2">Type</th>
              <th className="text-left py-2 px-2">Status</th>
              <th className="text-left py-2 px-2">Assigned To</th>
              <th className="text-left py-2 px-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 && (
              <tr><td colSpan={6} className="py-6 text-center text-rmpg-500">No devices found</td></tr>
            )}
            {devices.map((d: any) => (
              <tr key={d.id} className="border-b border-rmpg-700/30 hover:bg-rmpg-700/20">
                <td className="py-2 px-2 text-rmpg-200 font-mono">{d.device_serial}</td>
                <td className="py-2 px-2 text-rmpg-300">{d.device_model}</td>
                <td className="py-2 px-2">
                  <span className="text-rmpg-400">{DEVICE_TYPES.find(t => t.value === d.device_type)?.label || d.device_type}</span>
                </td>
                <td className="py-2 px-2">
                  <StatusBadge status={d.status} />
                </td>
                <td className="py-2 px-2 text-rmpg-300">{d.officer_name || '—'}</td>
                <td className="py-2 px-2 flex items-center gap-1">
                  <button onClick={() => { setEditItem(d); setShowModal('device'); }}
                    className="p-1 hover:bg-rmpg-600/30 text-rmpg-400 hover:text-rmpg-200" title="Edit">
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                  {d.status === 'available' && (
                    <button onClick={() => checkoutDevice(d.id)}
                      className="p-1 hover:bg-green-900/30 text-green-500 hover:text-green-400 text-[10px] font-bold" title="Checkout">
                      OUT
                    </button>
                  )}
                  {d.status === 'assigned' && (
                    <button onClick={() => checkinDevice(d.id)}
                      className="p-1 hover:bg-blue-900/30 text-blue-500 hover:text-blue-400 text-[10px] font-bold" title="Checkin">
                      IN
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  // ─── TAB: Footage ────────────────────────────────
  const renderFootage = () => (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-rmpg-500" />
          <input
            className="w-full bg-surface-raised border border-rmpg-600/30 text-rmpg-200 text-sm pl-8 pr-3 py-1.5"
            placeholder="Search footage..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select className="bg-surface-raised border border-rmpg-600/30 text-rmpg-300 text-xs py-1.5 px-2"
          value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
          <option value="">All Categories</option>
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select className="bg-surface-raised border border-rmpg-600/30 text-rmpg-300 text-xs py-1.5 px-2"
          value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="uploaded">Uploaded</option>
          <option value="available">Available</option>
          <option value="archived">Archived</option>
          <option value="litigation_hold">Litigation Hold</option>
        </select>
        <button onClick={() => { setEditItem(null); setShowModal('footage'); }}
          className="flex items-center gap-1 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold px-3 py-1.5">
          <Plus className="w-3.5 h-3.5" /> LOG FOOTAGE
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-rmpg-600/30 text-rmpg-400 uppercase">
              <th className="text-left py-2 px-2">ID</th>
              <th className="text-left py-2 px-2">Date</th>
              <th className="text-left py-2 px-2">Officer</th>
              <th className="text-left py-2 px-2">Category</th>
              <th className="text-left py-2 px-2">Duration</th>
              <th className="text-left py-2 px-2">Size</th>
              <th className="text-left py-2 px-2">Retention</th>
              <th className="text-left py-2 px-2">Status</th>
              <th className="text-left py-2 px-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {footage.length === 0 && (
              <tr><td colSpan={9} className="py-6 text-center text-rmpg-500">No footage found</td></tr>
            )}
            {footage.map((f: any) => {
              const cat = CATEGORIES.find(c => c.value === f.category);
              const ret = RETENTION_CLASSES.find(r => r.value === f.retention_class);
              return (
                <tr key={f.id} className="border-b border-rmpg-700/30 hover:bg-rmpg-700/20">
                  <td className="py-2 px-2 font-mono text-rmpg-300">
                    <div className="flex items-center gap-1">
                      {f.flagged ? <Flag className="w-3 h-3 text-red-400" /> : null}
                      {f.footage_id}
                    </div>
                  </td>
                  <td className="py-2 px-2 text-rmpg-400">{formatDateTime(f.start_time)}</td>
                  <td className="py-2 px-2 text-rmpg-200">{f.officer_name}</td>
                  <td className="py-2 px-2">
                    <span className={cat?.color || 'text-gray-400'}>{cat?.label || f.category}</span>
                  </td>
                  <td className="py-2 px-2 text-rmpg-400">{formatDuration(f.duration_seconds)}</td>
                  <td className="py-2 px-2 text-rmpg-400">{formatSize(f.file_size_mb)}</td>
                  <td className="py-2 px-2">
                    <span className={ret?.color || 'text-gray-400'}>{ret?.label || f.retention_class}</span>
                  </td>
                  <td className="py-2 px-2"><StatusBadge status={f.status} /></td>
                  <td className="py-2 px-2 flex items-center gap-1">
                    <button onClick={() => { setEditItem(f); setShowModal('footage'); }}
                      className="p-1 hover:bg-rmpg-600/30 text-rmpg-400 hover:text-rmpg-200" title="Edit">
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => toggleFlag(f.id, f.flagged)}
                      className={`p-1 hover:bg-red-900/30 ${f.flagged ? 'text-red-400' : 'text-rmpg-500'}`} title="Flag">
                      <Flag className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  // ─── TABS ────────────────────────────────────────
  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
    { id: 'devices', label: 'Devices', icon: Monitor },
    { id: 'footage', label: 'Footage', icon: Film },
  ];

  return (
    <div className="p-2 md:p-4 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Camera className="w-5 h-5 text-cyan-400" />
        <span className="text-sm font-bold text-rmpg-200 uppercase tracking-wider">Body Camera Management</span>
      </div>

      <div className="flex items-center gap-1 border-b border-rmpg-600/30 pb-1">
        {tabs.map(t => (
          <button key={t.id}
            onClick={() => { setActiveTab(t.id); setSearch(''); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase transition-colors
              ${activeTab === t.id
                ? 'text-cyan-400 border-b-2 border-cyan-400 bg-cyan-900/10'
                : 'text-rmpg-400 hover:text-rmpg-200'}`}>
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      <div>
        {activeTab === 'dashboard' && renderDashboard()}
        {activeTab === 'devices' && renderDevices()}
        {activeTab === 'footage' && renderFootage()}
      </div>

      {showModal === 'device' && (
        <DeviceModal
          editItem={editItem}
          personnel={personnel}
          loading={loading}
          onSave={saveDevice}
          onClose={() => { setShowModal(null); setEditItem(null); }}
        />
      )}
      {showModal === 'footage' && (
        <FootageModal
          editItem={editItem}
          devices={devices}
          personnel={personnel}
          loading={loading}
          onSave={saveFootage}
          onClose={() => { setShowModal(null); setEditItem(null); }}
        />
      )}
    </div>
  );
}
