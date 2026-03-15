// ============================================================
// RMPG Flex — Dash Camera Video Upload Modal
// ============================================================

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, X, Car, Loader2, MapPin, Gauge, Radio, Mic, FileText, Navigation } from 'lucide-react';

interface FleetVehicle {
  id: number;
  vehicle_number: string;
  make?: string;
  model?: string;
  year?: number;
}

interface UnitOption {
  id: number;
  call_sign: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onUploaded: () => void;
  vehicles: FleetVehicle[];
  units: UnitOption[];
  apiBase: string;
  getAuthHeaders: () => Record<string, string>;
}

const CLASSIFICATIONS = [
  { value: 'routine', label: 'Routine' },
  { value: 'evidence', label: 'Evidence' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'restricted', label: 'Restricted' },
];

export default function DashCamUploadModal({
  isOpen, onClose, onUploaded, vehicles, units, apiBase, getAuthHeaders,
}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [recordedAt, setRecordedAt] = useState('');
  const [speedMph, setSpeedMph] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [address, setAddress] = useState('');
  const [caseNumber, setCaseNumber] = useState('');
  const [classification, setClassification] = useState('routine');
  const [notes, setNotes] = useState('');
  const [cameraPosition, setCameraPosition] = useState('FRONT');
  const [micStatus, setMicStatus] = useState('ON');
  const [dataFile, setDataFile] = useState<File | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsSynced, setGpsSynced] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [duration, setDuration] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dataFileRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  // Escape key to close modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !uploading) handleClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, uploading]);

  if (!isOpen) return null;

  const reset = () => {
    setFile(null);
    setTitle('');
    setVehicleId('');
    setUnitId('');
    setRecordedAt('');
    setSpeedMph('');
    setLatitude('');
    setLongitude('');
    setAddress('');
    setCaseNumber('');
    setClassification('routine');
    setNotes('');
    setCameraPosition('FRONT');
    setMicStatus('ON');
    setDataFile(null);
    setGpsLoading(false);
    setGpsSynced(false);
    setProgress(0);
    setError('');
    setDuration(null);
    setUploading(false);
  };

  const handleClose = () => {
    // Abort in-flight upload before closing
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }
    reset();
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setError('');
      setDuration(null);
      if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
      const videoEl = document.createElement('video');
      videoEl.preload = 'metadata';
      videoEl.onloadedmetadata = () => {
        if (videoEl.duration && isFinite(videoEl.duration)) setDuration(Math.round(videoEl.duration));
        URL.revokeObjectURL(videoEl.src);
      };
      videoEl.onerror = () => URL.revokeObjectURL(videoEl.src);
      videoEl.src = URL.createObjectURL(f);
    }
  };

  // ── .txt / .json data file parser ─────────────────────────
  // Supports SmartWitness JSON exports and simple KEY: VALUE text files.

  /** Parse simple KEY: VALUE text format */
  const parseTextDataFile = (text: string): Record<string, string> => {
    const result: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;
      const key = trimmed.slice(0, colonIdx).trim().toUpperCase().replace(/\s+/g, '_');
      const value = trimmed.slice(colonIdx + 1).trim();
      if (key && value) result[key] = value;
    }
    return result;
  };

  /** Parse SmartWitness JSON format */
  const parseSmartWitnessJson = (json: any): Record<string, string> => {
    const result: Record<string, string> = {};
    if (json.speed != null) result.SPEED_MPH = String(Math.round(json.speed));
    if (json.latitude != null) result.LATITUDE = String(json.latitude);
    if (json.longitude != null) result.LONGITUDE = String(json.longitude);
    if (json.mediaDataLocation?.address) result.ADDRESS = json.mediaDataLocation.address;
    if (json.eventTime) {
      // eventTime is Unix epoch seconds — convert to datetime-local format
      const d = new Date(json.eventTime * 1000);
      const pad = (n: number) => String(n).padStart(2, '0');
      result.RECORDED_AT = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    if (json.eventType) result.EVENT_TYPE = json.eventType;
    if (json.recorderId) result.RECORDER_ID = json.recorderId;
    if (json.heading != null) result.HEADING = String(json.heading);
    return result;
  };

  const handleDataFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setDataFile(f);
    try {
      const text = await f.text();
      let parsed: Record<string, string>;
      // Auto-detect JSON vs text format
      const trimmed = text.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        const json = JSON.parse(trimmed);
        parsed = parseSmartWitnessJson(Array.isArray(json) ? json[0] : json);
      } else {
        parsed = parseTextDataFile(text);
      }
      if (parsed.TITLE && !title) setTitle(parsed.TITLE);
      if (parsed.CASE_NUMBER && !caseNumber) setCaseNumber(parsed.CASE_NUMBER);
      if (parsed.SPEED_MPH && !speedMph) setSpeedMph(parsed.SPEED_MPH);
      if (parsed.LATITUDE && !latitude) setLatitude(parsed.LATITUDE);
      if (parsed.LONGITUDE && !longitude) setLongitude(parsed.LONGITUDE);
      if (parsed.ADDRESS && !address) setAddress(parsed.ADDRESS);
      if (parsed.CLASSIFICATION) setClassification(parsed.CLASSIFICATION.toLowerCase());
      if (parsed.CAMERA_POSITION) setCameraPosition(parsed.CAMERA_POSITION.toUpperCase());
      if (parsed.MIC_STATUS) setMicStatus(parsed.MIC_STATUS.toUpperCase());
      if (parsed.NOTES && !notes) setNotes(parsed.NOTES);
      if (parsed.RECORDED_AT && !recordedAt) setRecordedAt(parsed.RECORDED_AT);
      if (parsed.EVENT_TYPE && !notes) setNotes(`Event: ${parsed.EVENT_TYPE}`);
    } catch {
      setError('Failed to read data file — check format (JSON or KEY: VALUE text)');
    }
  };

  // ── ClearPathGPS auto-lookup ──────────────────────────────
  const lookupGps = useCallback(async () => {
    if (!unitId || !recordedAt || gpsLoading) return;
    setGpsLoading(true);
    setGpsSynced(false);
    try {
      const ts = new Date(recordedAt).toISOString();
      const url = `${apiBase}/fleet/dashcam-gps-lookup?unit_id=${encodeURIComponent(unitId)}&timestamp=${encodeURIComponent(ts)}`;
      const resp = await fetch(url, { headers: getAuthHeaders() });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({ error: 'GPS lookup failed' }));
        setError(body.error || 'GPS lookup failed');
        return;
      }
      const data = await resp.json();
      if (data.speedMph != null) setSpeedMph(String(Math.round(data.speedMph)));
      if (data.latitude != null) setLatitude(String(data.latitude));
      if (data.longitude != null) setLongitude(String(data.longitude));
      if (data.address) setAddress(data.address);
      setGpsSynced(true);
    } catch {
      setError('Failed to fetch GPS data from ClearPathGPS');
    } finally {
      setGpsLoading(false);
    }
  }, [unitId, recordedAt, gpsLoading, apiBase, getAuthHeaders]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !title) {
      setError('File and title are required');
      return;
    }

    setUploading(true);
    setProgress(0);
    setError('');

    const formData = new FormData();
    formData.append('video', file);
    formData.append('title', title);
    if (vehicleId) formData.append('vehicle_id', vehicleId);
    if (unitId) formData.append('unit_id', unitId);
    formData.append('classification', classification);
    if (duration != null) formData.append('duration_seconds', String(duration));
    if (recordedAt) formData.append('recorded_at', recordedAt);
    if (speedMph) formData.append('speed_mph', speedMph);
    if (latitude) formData.append('latitude', latitude);
    if (longitude) formData.append('longitude', longitude);
    if (address) formData.append('address', address);
    if (caseNumber) formData.append('case_number', caseNumber);
    if (notes) formData.append('notes', notes);
    if (cameraPosition) formData.append('camera_position', cameraPosition);
    if (micStatus) formData.append('mic_status', micStatus);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open('POST', `${apiBase}/fleet/dashcam-videos`);
    xhr.timeout = 600000;

    const headers = getAuthHeaders();
    for (const [key, val] of Object.entries(headers)) xhr.setRequestHeader(key, val);

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
    };

    xhr.onload = () => {
      setUploading(false);
      if (xhr.status >= 200 && xhr.status < 300) {
        reset();
        onUploaded();
        onClose();
      } else {
        try {
          const resp = JSON.parse(xhr.responseText);
          setError(resp.error || `Upload failed (HTTP ${xhr.status})`);
        } catch {
          setError(`Upload failed (HTTP ${xhr.status})`);
        }
      }
    };

    xhr.onerror = () => { setUploading(false); setError('Network error — upload failed.'); };
    xhr.ontimeout = () => { setUploading(false); setError('Upload timed out.'); };
    xhr.send(formData);
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return '-';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatDurationHMS = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={handleClose}>
      <div className="bg-surface-base border border-rmpg-700 rounded-lg shadow-xl w-[560px] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-700 bg-surface-raised">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-brand-400" />
            <h2 className="text-sm font-bold text-rmpg-100">Upload Dash Camera Video</h2>
          </div>
          <button onClick={handleClose} disabled={uploading} className="toolbar-btn p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="panel-beveled p-2 border border-red-700/40 bg-red-900/20">
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}

          {/* File Input */}
          <div className="panel-inset p-3">
            <label className="field-label mb-2 block">Video File <span className="text-red-400">*</span></label>
            {file ? (
              <div className="flex items-center gap-2">
                <Car className="w-4 h-4 text-brand-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-rmpg-200 truncate">{file.name}</p>
                  <p className="text-[9px] text-rmpg-500">
                    {formatSize(file.size)} &bull; {file.type}
                    {duration != null && <> &bull; {formatDurationHMS(duration)}</>}
                  </p>
                </div>
                <button type="button" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }} className="toolbar-btn p-1">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => fileRef.current?.click()} className="w-full py-6 border-2 border-dashed border-rmpg-600 rounded-lg hover:border-brand-500 transition-colors flex flex-col items-center gap-2">
                <Upload className="w-6 h-6 text-rmpg-500" />
                <span className="text-xs text-rmpg-400">Click to select video</span>
                <span className="text-[9px] text-rmpg-600">MP4, MOV, AVI, WebM</span>
              </button>
            )}
            <input ref={fileRef} type="file" accept="video/mp4,video/quicktime,video/x-msvideo,video/webm,.mp4,.mov,.avi,.webm" onChange={handleFileChange} className="hidden" />

            {/* Data File (.txt) Import */}
            <div className="mt-3 pt-3 border-t border-rmpg-700">
              <label className="field-label mb-2 block flex items-center gap-1">
                <FileText className="w-3 h-3" /> Data File (Optional .txt / .json)
              </label>
              {dataFile ? (
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-green-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-rmpg-200 truncate">{dataFile.name}</p>
                    <p className="text-[9px] text-green-400">Data imported — fields auto-filled</p>
                  </div>
                  <button type="button" onClick={() => { setDataFile(null); if (dataFileRef.current) dataFileRef.current.value = ''; }} className="toolbar-btn p-1">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => dataFileRef.current?.click()} className="w-full py-3 border border-dashed border-rmpg-600 rounded hover:border-green-500/50 transition-colors flex items-center justify-center gap-2">
                  <FileText className="w-4 h-4 text-rmpg-500" />
                  <span className="text-[10px] text-rmpg-400">Load data file (.txt or SmartWitness .json)</span>
                </button>
              )}
              <input ref={dataFileRef} type="file" accept=".txt,.json,text/plain,application/json" onChange={handleDataFileChange} className="hidden" />
            </div>
          </div>

          {/* Metadata */}
          <div className="panel-inset p-3 space-y-3">
            <div>
              <label className="field-label">Title <span className="text-red-400">*</span></label>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)} required placeholder="Video title" className="input-dark" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="field-label">Vehicle</label>
                <select value={vehicleId} onChange={e => setVehicleId(e.target.value)} className="select-dark">
                  <option value="">Select vehicle...</option>
                  {vehicles.map(v => <option key={v.id} value={v.id}>#{v.vehicle_number} — {[v.year, v.make, v.model].filter(Boolean).join(' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label">Unit</label>
                <select value={unitId} onChange={e => setUnitId(e.target.value)} className="select-dark">
                  <option value="">Select unit...</option>
                  {units.map(u => <option key={u.id} value={u.id}>{u.call_sign}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="field-label">Recorded Date</label>
                <input type="datetime-local" value={recordedAt} onChange={e => setRecordedAt(e.target.value)} className="input-dark" />
              </div>
              <div>
                <label className="field-label">Classification</label>
                <select value={classification} onChange={e => setClassification(e.target.value)} className="select-dark">
                  {CLASSIFICATIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Location & Speed */}
          <div className="panel-inset p-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="field-label flex items-center gap-1 text-brand-400"><MapPin className="w-3 h-3" /> Location & Speed Data</p>
              {unitId && recordedAt && (
                <button
                  type="button"
                  onClick={lookupGps}
                  disabled={gpsLoading}
                  className={`text-[9px] px-2 py-0.5 rounded flex items-center gap-1 font-mono ${
                    gpsSynced
                      ? 'bg-green-900/40 text-green-400 border border-green-700/40'
                      : 'toolbar-btn text-brand-400 hover:text-brand-300'
                  }`}
                >
                  {gpsLoading ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Navigation className="w-2.5 h-2.5" />}
                  {gpsSynced ? 'GPS SYNCED' : gpsLoading ? 'SYNCING...' : 'SYNC GPS'}
                </button>
              )}
            </div>
            {!unitId || !recordedAt ? (
              <p className="text-[9px] text-rmpg-500 -mt-1">Set unit and recorded date to sync GPS from ClearPathGPS</p>
            ) : !gpsSynced ? (
              <p className="text-[9px] text-rmpg-500 -mt-1">Click SYNC GPS to auto-fill from ClearPathGPS</p>
            ) : null}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="field-label flex items-center gap-1"><Gauge className="w-2.5 h-2.5" /> Speed (MPH)</label>
                <input type="number" step="0.1" value={speedMph} onChange={e => setSpeedMph(e.target.value)} placeholder="e.g. 45" className="input-dark" />
              </div>
              <div>
                <label className="field-label">Latitude</label>
                <input type="number" step="0.0001" value={latitude} onChange={e => setLatitude(e.target.value)} placeholder="e.g. 40.7608" className="input-dark" />
              </div>
              <div>
                <label className="field-label">Longitude</label>
                <input type="number" step="0.0001" value={longitude} onChange={e => setLongitude(e.target.value)} placeholder="e.g. -111.8910" className="input-dark" />
              </div>
            </div>
            <div>
              <label className="field-label">Street Address</label>
              <input type="text" value={address} onChange={e => setAddress(e.target.value)} placeholder="e.g. 123 S State St, Salt Lake City, UT" className="input-dark" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="field-label">Case Number</label>
                <input type="text" value={caseNumber} onChange={e => setCaseNumber(e.target.value)} placeholder="e.g. 2026-0001" className="input-dark" />
              </div>
              <div>
                <label className="field-label flex items-center gap-1"><Radio className="w-2.5 h-2.5" /> Camera Position</label>
                <select value={cameraPosition} onChange={e => setCameraPosition(e.target.value)} className="select-dark">
                  <option value="FRONT">Front</option>
                  <option value="REAR">Rear</option>
                  <option value="INTERIOR">Interior</option>
                </select>
              </div>
              <div>
                <label className="field-label flex items-center gap-1"><Mic className="w-2.5 h-2.5" /> Mic Status</label>
                <select value={micStatus} onChange={e => setMicStatus(e.target.value)} className="select-dark">
                  <option value="ON">On</option>
                  <option value="OFF">Off</option>
                  <option value="MUTED">Muted</option>
                </select>
              </div>
            </div>
          </div>

          {/* Progress Bar */}
          {uploading && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-rmpg-400 flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin text-brand-400" /> Uploading...
                </span>
                <span className="text-brand-400 font-mono font-bold">{progress}%</span>
              </div>
              <div className="w-full h-2 bg-surface-sunken rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-brand-600 to-brand-400 transition-all duration-300" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={handleClose} disabled={uploading} className="toolbar-btn text-xs px-4 py-1.5">Cancel</button>
            <button type="submit" disabled={uploading || !file || !title} className="toolbar-btn-primary text-xs px-4 py-1.5 flex items-center gap-1.5">
              {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
              {uploading ? 'Uploading...' : 'Upload Video'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
