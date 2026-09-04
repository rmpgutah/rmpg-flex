// RMPG Flex — Plate Scan Modal
// Drag-drop or camera capture → Analyze via /alpr/capture → review/correct
// vehicle fields → Create Record in vehicles_records.
//
// Auth: apiPostForm injects Authorization: Bearer <token> for the multipart
// upload (fixes the raw-fetch 401 that appeared when this modal used fetch()
// without headers). apiFetch does the same for the JSON create call.
import { useRef, useState, useCallback } from 'react';
import { Camera, X, CheckCircle, Loader2, Car, Upload } from 'lucide-react';
import { apiPostForm, apiFetch } from '../hooks/useApi';
import { useToast } from './ToastProvider';
import { authedImageUrl } from '../hooks/useApi';

interface ScanVehicle {
  plate: string | null; state: string | null; make: string | null;
  model: string | null; color: string | null; year: number | null;
  vehicleType: string | null; confidence: number | null; riskScore: number | null;
  reviewStatus: string | null; alerted: boolean;
}
interface ScanHit { severity: 'critical' | 'warning'; detail: string }
interface ScanResult {
  id: number; capture: ScanVehicle; hits: ScanHit[];
  image_url: string; annotated_image_url: string | null;
  warnings?: string[];
}

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
  'NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
  'VT','VA','WA','WV','WI','WY',
];

interface Props {
  /** Optional call/incident context for linking the capture */
  callId?: number | string;
  onClose: () => void;
  onCreated?: (vehicleRecordId: number) => void;
}

const inputCls =
  'w-full bg-surface-overlay border border-border-default px-2 py-1.5 text-sm text-rmpg-200 ' +
  'placeholder:text-rmpg-500 focus:border-brand-400 outline-none';

export default function PlateScanModal({ callId, onClose, onCreated }: Props) {
  const { addToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [preview, setPreview] = useState<string | null>(null);
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Editable fields pre-filled from the scan result
  const [plate, setPlate] = useState('');
  const [state, setState] = useState('UT');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [color, setColor] = useState('');
  const [body, setBody] = useState('');

  const fillFromCapture = useCallback((cap: ScanVehicle) => {
    setPlate(cap.plate?.toUpperCase() ?? '');
    setState(cap.state?.toUpperCase() ?? 'UT');
    setMake(cap.make ?? '');
    setModel(cap.model ?? '');
    setYear(cap.year ? String(cap.year) : '');
    setColor(cap.color ?? '');
    setBody(cap.vehicleType ?? '');
  }, []);

  const acceptImage = useCallback((blob: Blob, objectUrl: string) => {
    setImageBlob(blob);
    setPreview(objectUrl);
    setScanResult(null);
    setError(null);
  }, []);

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) { addToast('Please upload an image file (JPEG, PNG, WEBP)', 'error'); return; }
    acceptImage(file, URL.createObjectURL(file));
  }, [acceptImage, addToast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  // ── Camera ───────────────────────────────────────────────
  const openCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      setCameraOpen(true);
      setTimeout(() => { if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); } }, 50);
    } catch {
      addToast('Camera access denied or unavailable', 'error');
    }
  }, [addToast]);

  const closeCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOpen(false);
  }, []);

  const captureFromCamera = useCallback(() => {
    const video = videoRef.current; const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      acceptImage(blob, canvas.toDataURL('image/jpeg'));
      closeCamera();
    }, 'image/jpeg', 0.9);
  }, [acceptImage, closeCamera]);

  // ── Analyze ──────────────────────────────────────────────
  const analyze = useCallback(async () => {
    if (!imageBlob) { addToast('No image selected', 'error'); return; }
    setAnalyzing(true); setError(null);
    try {
      const form = new FormData();
      form.append('photo', imageBlob, 'plate-scan.jpg');
      if (callId) form.append('call_id', String(callId));
      // apiPostForm injects Authorization: Bearer <token> automatically
      const result = await apiPostForm<ScanResult>('/alpr/capture', form);
      setScanResult(result);
      fillFromCapture(result.capture);
      if (result.warnings?.length) addToast(result.warnings[0], 'warning');
      const critical = result.hits?.filter((h) => h.severity === 'critical') ?? [];
      if (critical.length) addToast(`⚠ Records HIT: ${critical[0].detail}`, 'error', 8000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Analysis failed';
      setError(msg);
      addToast(msg, 'error');
    } finally {
      setAnalyzing(false);
    }
  }, [imageBlob, callId, fillFromCapture, addToast]);

  // ── Create Record ────────────────────────────────────────
  const createRecord = useCallback(async () => {
    if (!plate.trim()) { addToast('Plate number is required', 'error'); return; }
    setCreating(true); setError(null);
    try {
      const body_payload: Record<string, unknown> = {
        plate_number: plate.trim().toUpperCase(),
        state: state || 'UT',
        make: make.trim() || undefined,
        model: model.trim() || undefined,
        year: year ? Number(year) : undefined,
        color: color.trim() || undefined,
        body_style: body.trim() || undefined,
      };
      // apiFetch injects Authorization: Bearer <token> automatically
      const result = await apiFetch<{ id: number; plate_number: string }>('/records/vehicles', {
        method: 'POST',
        body: JSON.stringify(body_payload),
      });
      addToast(`Vehicle record created — ${result.plate_number}`, 'success');
      onCreated?.(result.id);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Create failed';
      setError(msg);
      addToast(msg, 'error');
    } finally {
      setCreating(false);
    }
  }, [plate, state, make, model, year, color, body, scanResult, onCreated, onClose, addToast]);

  const hasCriticalHits = (scanResult?.hits ?? []).some((h) => h.severity === 'critical');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onKeyDown={(e) => { if (e.key === 'Escape' && !analyzing && !creating) onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget && !analyzing && !creating) onClose(); }}
    >
      <div
        className="bg-surface-base border border-border-default flex flex-col"
        style={{ width: 480, maxHeight: '90vh', borderRadius: 2 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <div className="flex items-center gap-2 text-sm font-bold text-[color:var(--panel-header-color)]">
            <Car className="w-4 h-4" />
            PLATE SCAN — RMPG Flex
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-rmpg-400 hover:text-rmpg-200 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Camera live view */}
          {cameraOpen && (
            <div className="relative border border-border-default bg-black">
              <video ref={videoRef} playsInline muted className="w-full" style={{ maxHeight: 220 }} />
              <canvas ref={canvasRef} className="hidden" />
              <div className="flex gap-2 p-2 justify-end">
                <button type="button" onClick={closeCamera} className="px-3 py-1 text-xs border border-border-default text-rmpg-400">Cancel</button>
                <button type="button" onClick={captureFromCamera} className="px-3 py-1 text-xs border border-brand-400 text-brand-400">Capture</button>
              </div>
            </div>
          )}

          {/* Drop zone / preview */}
          {!cameraOpen && (
            preview ? (
              <div className="relative border border-border-default">
                <img src={preview} alt="Captured" className="w-full object-contain" style={{ maxHeight: 200 }} />
                <button
                  type="button"
                  onClick={() => { setPreview(null); setImageBlob(null); setScanResult(null); setError(null); }}
                  aria-label="Remove image"
                  className="absolute top-1 right-1 bg-black/70 text-white p-1 rounded-sm hover:bg-black"
                >
                  <X className="w-3 h-3" />
                </button>
                {/* Show scan result image if available */}
                {scanResult?.annotated_image_url && (
                  <img
                    src={authedImageUrl(scanResult.annotated_image_url)}
                    alt="Annotated"
                    className="w-full object-contain border-t border-border-default"
                    style={{ maxHeight: 200 }}
                  />
                )}
              </div>
            ) : (
              <div
                className={`border-2 border-dashed flex flex-col items-center justify-center gap-2 py-8 cursor-pointer transition-colors ${
                  dragOver ? 'border-brand-400 bg-surface-raised' : 'border-rmpg-600 hover:border-rmpg-400'
                }`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-8 h-8 text-rmpg-500" />
                <span className="text-sm text-rmpg-400">Drop an image here, or click to upload</span>
                <span className="text-[10px] text-rmpg-600">JPEG · PNG · WEBP</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />
              </div>
            )
          )}

          {!cameraOpen && !preview && (
            <button
              type="button"
              onClick={openCamera}
              className="w-full py-2 text-sm border border-border-default text-rmpg-400 hover:text-rmpg-200 flex items-center justify-center gap-2"
            >
              <Camera className="w-4 h-4" />
              Use Live Camera
            </button>
          )}

          {/* Hits */}
          {hasCriticalHits && (
            <div className="bg-red-950 border border-red-600 text-red-300 text-xs font-semibold px-3 py-2 flex flex-wrap gap-1">
              {scanResult!.hits.filter((h) => h.severity === 'critical').map((h) => (
                <span key={h.detail}>⚠ {h.detail}</span>
              ))}
            </div>
          )}

          {/* Review note */}
          {scanResult && (
            <p className="text-[10px] text-[color:var(--field-label-color)]">
              ✏ Review and correct any fields before creating the record
            </p>
          )}

          {/* Editable vehicle fields */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="field-label">PLATE</label>
              <input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} className={`${inputCls} uppercase mt-0.5`} placeholder="ABC123" />
            </div>
            <div>
              <label className="field-label">STATE</label>
              <select value={state} onChange={(e) => setState(e.target.value)} className={`${inputCls} mt-0.5`}>
                {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="field-label">MAKE</label>
              <input value={make} onChange={(e) => setMake(e.target.value)} className={`${inputCls} mt-0.5`} placeholder="Toyota" />
            </div>
            <div>
              <label className="field-label">MODEL</label>
              <input value={model} onChange={(e) => setModel(e.target.value)} className={`${inputCls} mt-0.5`} placeholder="Camry" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="field-label">YEAR</label>
              <input value={year} onChange={(e) => setYear(e.target.value)} className={`${inputCls} mt-0.5`} placeholder="2021" maxLength={4} />
            </div>
            <div>
              <label className="field-label">COLOR</label>
              <input value={color} onChange={(e) => setColor(e.target.value)} className={`${inputCls} mt-0.5`} placeholder="Silver" />
            </div>
            <div>
              <label className="field-label">BODY</label>
              <input value={body} onChange={(e) => setBody(e.target.value)} className={`${inputCls} mt-0.5`} placeholder="Sedan" />
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-red-400">✗ {error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-default">
          <button
            type="button"
            onClick={onClose}
            disabled={analyzing || creating}
            className="px-4 py-1.5 text-xs border border-border-default text-rmpg-400 hover:text-rmpg-200 disabled:opacity-40"
          >
            Cancel
          </button>
          {imageBlob && (
            <button
              type="button"
              onClick={analyze}
              disabled={analyzing || creating}
              className="px-4 py-1.5 text-xs border border-rmpg-500 text-rmpg-300 hover:text-rmpg-100 disabled:opacity-40 flex items-center gap-1.5"
            >
              {analyzing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
              Analyze Plate
            </button>
          )}
          <button
            type="button"
            onClick={createRecord}
            disabled={!plate.trim() || creating || analyzing}
            className="px-4 py-1.5 text-xs border border-green-600 text-green-400 hover:text-green-200 disabled:opacity-40 flex items-center gap-1.5"
          >
            {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
            Create Record
          </button>
        </div>
      </div>
    </div>
  );
}
