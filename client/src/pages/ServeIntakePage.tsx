import React, { useState, useCallback, useRef } from 'react';
import {
  Upload, FileText, CheckCircle, AlertTriangle, Loader2,
  MapPin, User, Building2, Phone, X, Camera, Edit3, Eye,
  Car, Shield, Link2, Layers, FileSearch, Hash, Calendar,
  Scale, CreditCard,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useNavigate } from 'react-router-dom';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';

interface UploadedFile {
  name: string;
  type: string;
  text: string;
  status: 'pending' | 'extracted' | 'error';
  ocrResult?: any;
}

interface PersonResult {
  id: number;
  role: string;
  first_name: string;
  last_name: string;
}

interface VehicleExtract {
  plate: string;
  vin: string;
  make: string;
  model: string;
  year: string;
  color: string;
}

interface IntakeResult {
  success: boolean;
  batch_id: number;
  person_id: number;
  persons: PersonResult[];
  property_id: number | null;
  vehicle_id: number | null;
  evidence_ids: number[];
  call_id: number;
  call_number: string;
  serve_queue_id: number | null;
  latitude: number | null;
  longitude: number | null;
  confidence: number;
  weather: string | null;
  lighting: string | null;
  correlated_fields: Record<string, { value: string; confidence: number; source: string }>;
  extracted: {
    name: { first: string; middle: string; last: string };
    fullName: string;
    dob: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    plaintiff: string;
    court: string;
    docs: string;
    instructions: string;
    jobNumber: string;
    caseNumber: string;
    dueDate: string;
    attorney: { name: string; phone: string; email: string; bar: string };
    fee: string;
    phoneNumbers: string;
    ssn: string;
    dlNumber: string;
    processType: string;
    vehicle: VehicleExtract | null;
  };
}

function confidenceColor(conf: number): string {
  if (conf >= 0.7) return 'text-green-400';
  if (conf >= 0.4) return 'text-amber-400';
  return 'text-red-400';
}

function confidenceBg(conf: number): string {
  if (conf >= 0.7) return 'bg-green-500';
  if (conf >= 0.4) return 'bg-amber-500';
  return 'bg-red-500';
}

function FieldBadge({ label, value, confidence }: { label: string; value: string; confidence?: number }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 p-2 bg-surface-sunken rounded-sm">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-rmpg-500 uppercase font-mono tracking-wider">{label}</span>
          {confidence !== undefined && (
            <span className={`text-[8px] font-bold ${confidenceColor(confidence)}`}>
              {(confidence * 100).toFixed(0)}%
            </span>
          )}
        </div>
        <span className="text-xs text-white truncate block mt-0.5">{value}</span>
      </div>
    </div>
  );
}

function confidenceBar(conf: number): { bg: string; width: string } {
  return {
    bg: confidenceBg(conf),
    width: `${Math.min(100, conf * 100)}%`,
  };
}

const ROLE_COLORS: Record<string, string> = {
  defendant: 'bg-red-900/40 text-red-400 border-red-700/40',
  plaintiff: 'bg-blue-900/40 text-blue-400 border-blue-700/40',
  attorney: 'bg-purple-900/40 text-purple-400 border-purple-700/40',
  involved: 'bg-amber-900/40 text-amber-400 border-amber-700/40',
  reporter: 'bg-cyan-900/40 text-cyan-400 border-cyan-700/40',
};

export default function ServeIntakePage() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFieldReview, setShowFieldReview] = useState(false);
  const [editableFields, setEditableFields] = useState<Record<string, string>>({});
  const dropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const extractPdfText = useCallback(async (file: File): Promise<string> => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const resp = await fetch('/api/serve-intake/extract-text', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('rmpg_token')}`,
          'Content-Type': 'application/octet-stream',
        },
        body: arrayBuffer,
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.text || '';
      }
    } catch { }
    return '';
  }, []);

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const newFiles: UploadedFile[] = [];
    for (const file of Array.from(fileList)) {
      const isImage = file.type.startsWith('image/');
      const isPdf = file.type === 'application/pdf';
      if (!isImage && !isPdf) continue;

      let text = '';
      let type = 'info_page';

      if (isPdf) {
        text = await extractPdfText(file);
        type = file.name.toLowerCase().includes('court') ? 'court_filing'
          : file.name.toLowerCase().includes('field') ? 'field_sheet'
          : 'info_page';
      }

      newFiles.push({
        name: file.name, type, text,
        status: text.length > 50 ? 'extracted' : 'error',
      });
    }
    setFiles(prev => [...prev, ...newFiles]);
    setError(null);
    setResult(null);
  }, [extractPdfText]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const removeFile = (idx: number) => setFiles(prev => prev.filter((_, i) => i !== idx));

  const processIntake = useCallback(async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setError(null);
    setResult(null);
    try {
      const documents = files.map(f => ({ type: f.type, text: f.text, filename: f.name }));
      const resp = await apiFetch<IntakeResult>('/serve-intake/intake', {
        method: 'POST',
        body: JSON.stringify({ documents }),
      });
      if (resp && resp.success) {
        setResult(resp);
        setShowFieldReview(false);
      } else {
        setError('Intake processing failed');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to process documents');
    }
    setProcessing(false);
  }, [files]);

  const openFieldReview = () => {
    if (!result) return;
    const fields: Record<string, string> = {};
    const e = result.extracted;
    fields['first_name'] = e.name.first;
    fields['middle_name'] = e.name.middle;
    fields['last_name'] = e.name.last;
    fields['dob'] = e.dob;
    fields['address'] = e.address;
    fields['city'] = e.city;
    fields['state'] = e.state;
    fields['zip'] = e.zip;
    fields['plaintiff'] = e.plaintiff;
    fields['court'] = e.court;
    fields['case_number'] = e.caseNumber;
    fields['job_number'] = e.jobNumber;
    fields['due_date'] = e.dueDate;
    fields['attorney_name'] = e.attorney.name;
    fields['attorney_phone'] = e.attorney.phone;
    fields['attorney_email'] = e.attorney.email;
    fields['fee'] = e.fee;
    setEditableFields(fields);
    setShowFieldReview(true);
  };

  const ref = dropRef;
  const hasResult = result !== null;

  return (
    <div className="p-4 space-y-4 max-w-4xl mx-auto">
      <PanelTitleBar title="Process Service Intake — Advanced OCR" icon={FileSearch} />

      {/* Drop Zone */}
      <div
        ref={ref}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
        role="button"
        tabIndex={0}
        aria-label="Upload documents: drag and drop or press Enter to browse"
        className="border-2 border-dashed border-rmpg-600 rounded-sm p-8 text-center cursor-pointer hover:border-rmpg-400 hover:bg-surface-raised/50 focus:outline-none focus:border-rmpg-400 focus:ring-2 focus:ring-[#d4a017]/40 transition-all"
        style={{ background: 'var(--surface-sunken)' }}
      >
        <Upload className="w-10 h-10 text-rmpg-500 mx-auto mb-3" />
        <p className="text-sm font-bold text-rmpg-300">DRAG & DROP DOCUMENTS</p>
        <p className="text-[10px] text-rmpg-500 mt-1">PDF or Images (Court Filing, Field Sheet, Info Page)</p>
        <p className="text-[9px] text-rmpg-600 mt-2">Upload all documents for a case at once — the system correlates fields across them</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,image/*"
          multiple
          className="hidden"
          onChange={e => { if (e.target.files) handleFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {/* Loaded Documents */}
      {files.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider">
            <Layers className="w-3 h-3 inline mr-1" />
            {files.length} Document{files.length > 1 ? 's' : ''} Loaded
            <span className="text-rmpg-600 font-normal ml-2">for multi-document correlation</span>
          </p>
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2 panel-beveled bg-surface-raised text-xs">
              <FileText className="w-4 h-4 text-rmpg-400 flex-shrink-0" />
              <span className="text-white font-medium truncate flex-1">{f.name}</span>
              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-sm ${
                f.type === 'court_filing' ? 'bg-red-900/40 text-red-400 border border-red-700/40' :
                f.type === 'field_sheet' ? 'bg-amber-900/40 text-amber-400 border border-amber-700/40' :
                'bg-green-900/40 text-green-400 border border-green-700/40'
              }`}>
                {f.type.replace(/_/g, ' ')}
              </span>
              {f.status === 'extracted' ? (
                <CheckCircle className="w-3.5 h-3.5 text-green-500" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              )}
              <IconButton onClick={() => removeFile(i)} aria-label={`Remove ${f.name}`} className="p-0.5 text-rmpg-500 hover:text-red-400"><X className="w-3 h-3" /></IconButton>
            </div>
          ))}
        </div>
      )}

      {/* Process Button */}
      {files.length > 0 && !hasResult && (
        <button
          onClick={processIntake}
          disabled={processing || files.every(f => f.status === 'error')}
          className="w-full toolbar-btn toolbar-btn-primary py-3 text-sm font-bold justify-center"
        >
          {processing ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Processing Documents with Multi-Document Correlation...</>
          ) : (
            <><FileSearch className="w-4 h-4" /> Run Advanced OCR Intake Pipeline</>
          )}
        </button>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-sm p-3 text-xs text-red-300">
          <AlertTriangle className="w-4 h-4 inline mr-1" /> {error}
        </div>
      )}

      {/* ── Enhanced Results Display ── */}
      {hasResult && (
        <div className="space-y-3">
          <div className="bg-green-900/20 border border-green-700/40 rounded-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-500" />
                <span className="text-sm font-bold text-green-400">INTAKE COMPLETE</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <div className={`w-2 h-2 rounded-full ${confidenceBg(result.confidence)}`} />
                  <span className={`text-[10px] font-bold ${confidenceColor(result.confidence)}`}>
                    OCR Confidence: {(result.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <button onClick={openFieldReview} className="text-[9px] text-brand-400 hover:text-brand-300 flex items-center gap-0.5">
                  <Eye className="w-3 h-3" /> Review Fields
                </button>
              </div>
            </div>

            {/* Person Cards */}
            <div className="mb-3">
              <p className="text-[10px] text-rmpg-400 uppercase font-bold mb-2 flex items-center gap-1">
                <User className="w-3 h-3" /> Persons Created ({result.persons.length})
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {result.persons.map((p) => (
                  <div key={p.id} className="panel-beveled bg-surface-raised p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={`text-[8px] font-bold uppercase px-1 py-0.5 rounded-sm ${ROLE_COLORS[p.role] || 'bg-gray-900/40 text-gray-400 border-gray-700/40'}`}>
                        {p.role}
                      </span>
                    </div>
                    <p className="text-xs font-bold text-white">{p.first_name} {p.last_name}</p>
                    <p className="text-[9px] text-rmpg-500 font-mono">ID: {p.id}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Created Records Grid */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3">
              {/* Property */}
              <div className={`panel-beveled p-3 ${result.property_id ? 'bg-surface-raised' : 'bg-surface-sunken opacity-50'}`}>
                <div className="flex items-center gap-1.5 mb-1">
                  <Building2 className={`w-3.5 h-3.5 ${result.property_id ? 'text-rmpg-400' : 'text-rmpg-600'}`} />
                  <span className="text-[9px] text-rmpg-500 uppercase font-bold">Property</span>
                  {result.property_id && <CheckCircle className="w-2.5 h-2.5 text-green-500 ml-auto" />}
                </div>
                <p className="text-[10px] text-white truncate">{result.extracted.address || 'Not extracted'}</p>
                {result.property_id && <p className="text-[8px] text-rmpg-500">ID: {result.property_id}</p>}
              </div>

              {/* Vehicle */}
              <div className={`panel-beveled p-3 ${result.vehicle_id ? 'bg-surface-raised' : 'bg-surface-sunken opacity-50'}`}>
                <div className="flex items-center gap-1.5 mb-1">
                  <Car className={`w-3.5 h-3.5 ${result.vehicle_id ? 'text-rmpg-400' : 'text-rmpg-600'}`} />
                  <span className="text-[9px] text-rmpg-500 uppercase font-bold">Vehicle</span>
                  {result.vehicle_id && <CheckCircle className="w-2.5 h-2.5 text-green-500 ml-auto" />}
                </div>
                {result.extracted.vehicle ? (
                  <p className="text-[10px] text-white truncate">
                    {[result.extracted.vehicle.year, result.extracted.vehicle.make, result.extracted.vehicle.model].filter(Boolean).join(' ')}
                    {result.extracted.vehicle.plate && <span className="text-rmpg-400 ml-1">Plate: {result.extracted.vehicle.plate}</span>}
                  </p>
                ) : (
                  <p className="text-[9px] text-rmpg-600">No vehicle data</p>
                )}
                {result.vehicle_id && <p className="text-[8px] text-rmpg-500">ID: {result.vehicle_id}</p>}
              </div>

              {/* Dispatch Call */}
              <div className="panel-beveled bg-surface-raised p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Phone className="w-3.5 h-3.5 text-rmpg-400" />
                  <span className="text-[9px] text-rmpg-500 uppercase font-bold">Dispatch Call</span>
                  <CheckCircle className="w-2.5 h-2.5 text-green-500 ml-auto" />
                </div>
                <p className="text-xs font-bold text-white font-mono">{result.call_number}</p>
                <p className="text-[9px] text-rmpg-400">{result.extracted.processType?.toUpperCase() || 'PSO'} — Pending</p>
                <button onClick={() => navigate('/dispatch')} className="text-[8px] text-brand-400 hover:underline mt-0.5">
                  View in Dispatch →
                </button>
              </div>

              {/* Serve Queue */}
              <div className={`panel-beveled p-3 ${result.serve_queue_id ? 'bg-surface-raised' : 'bg-surface-sunken opacity-50'}`}>
                <div className="flex items-center gap-1.5 mb-1">
                  <Shield className={`w-3.5 h-3.5 ${result.serve_queue_id ? 'text-rmpg-400' : 'text-rmpg-600'}`} />
                  <span className="text-[9px] text-rmpg-500 uppercase font-bold">Serve Queue</span>
                  {result.serve_queue_id && <CheckCircle className="w-2.5 h-2.5 text-green-500 ml-auto" />}
                </div>
                <p className="text-[10px] text-white">{result.extracted.fullName || 'Pending'}</p>
                {result.serve_queue_id && <p className="text-[8px] text-rmpg-500">Entry ID: {result.serve_queue_id}</p>}
              </div>
            </div>

            {/* Evidence */}
            {result.evidence_ids && result.evidence_ids.length > 0 && (
              <div className="mb-3">
                <p className="text-[10px] text-rmpg-400 uppercase font-bold mb-1 flex items-center gap-1">
                  <Shield className="w-3 h-3" /> Evidence Records Created ({result.evidence_ids.length})
                </p>
                <div className="flex flex-wrap gap-1">
                  {result.evidence_ids.map((id: number) => (
                    <span key={id} className="text-[9px] bg-surface-sunken border border-[#222] rounded-sm px-1.5 py-0.5 text-rmpg-400 font-mono">
                      Evidence #{id}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Coordinates & Conditions */}
            {result.latitude && result.longitude && (
              <div className="flex gap-3 text-[10px] mb-3 bg-surface-sunken p-2 rounded-sm">
                <span className="text-rmpg-500">
                  <MapPin className="w-3 h-3 inline mr-0.5" />
                  {result.latitude.toFixed(6)}, {result.longitude.toFixed(6)}
                </span>
                {result.weather && <span className="text-rmpg-400">☁ {result.weather}</span>}
                {result.lighting && <span className="text-rmpg-400">☀ {result.lighting}</span>}
              </div>
            )}

            {/* Extracted Data Detail */}
            <details className="mt-2">
              <summary className="text-[10px] text-rmpg-500 cursor-pointer hover:text-rmpg-300 uppercase tracking-wider font-bold">
                All Extracted Fields ({result.correlated_fields ? Object.keys(result.correlated_fields).length : 0})
              </summary>
              <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-1.5">
                {result.correlated_fields && Object.entries(result.correlated_fields)
                  .filter(([, f]) => f.value && f.confidence > 0)
                  .sort(([, a], [, b]) => b.confidence - a.confidence)
                  .map(([key, field]) => (
                    <FieldBadge
                      key={key}
                      label={key.replace(/_/g, ' ')}
                      value={field.value}
                      confidence={field.confidence}
                    />
                  ))}
              </div>
            </details>

            {/* Batch Info */}
            <div className="mt-2 pt-2 border-t border-rmpg-700 flex items-center gap-3 text-[9px] text-rmpg-500">
              <span>Batch #{result.batch_id}</span>
              <span>Call #{result.call_number}</span>
              <Link2 className="w-3 h-3 text-brand-400" />
              <span>All records linked</span>
            </div>
          </div>

          <button onClick={() => { setFiles([]); setResult(null); }} className="toolbar-btn w-full justify-center py-2">
            Process Another Set of Documents
          </button>
        </div>
      )}

      {/* ── Field Review Modal ── */}
      {showFieldReview && result && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowFieldReview(false)}>
          <div className="bg-surface-base border border-[#222] rounded-sm max-w-3xl w-full max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#222]">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-brand-400" />
                <span className="text-xs font-bold text-white uppercase">Extracted Fields Review</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold ${confidenceColor(result.confidence)}`}>
                  Overall: {(result.confidence * 100).toFixed(0)}%
                </span>
                <IconButton onClick={() => setShowFieldReview(false)} aria-label="Close field review">
                  <X className="w-4 h-4" />
                </IconButton>
              </div>
            </div>
            <div className="p-4 space-y-3">
              {/* Confidence bar */}
              <div className="w-full h-2 bg-[#222] rounded-sm overflow-hidden">
                <div className={`h-full rounded-sm transition-all ${confidenceBg(result.confidence)}`}
                  style={{ width: `${Math.min(100, result.confidence * 100)}%` }} />
              </div>

              {/* Person */}
              <div>
                <p className="text-[10px] text-rmpg-400 uppercase font-bold mb-1 flex items-center gap-1">
                  <User className="w-3 h-3" /> Person
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  <FieldBadge label="First Name" value={editableFields['first_name']} confidence={result.correlated_fields?.first_name?.confidence} />
                  <FieldBadge label="Middle Name" value={editableFields['middle_name']} confidence={result.correlated_fields?.middle_name?.confidence} />
                  <FieldBadge label="Last Name" value={editableFields['last_name']} confidence={result.correlated_fields?.last_name?.confidence} />
                  {editableFields['dob'] && <FieldBadge label="DOB" value={editableFields['dob']} confidence={result.correlated_fields?.dob?.confidence} />}
                </div>
              </div>

              {/* Address */}
              <div>
                <p className="text-[10px] text-rmpg-400 uppercase font-bold mb-1 flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> Address
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
                  <FieldBadge label="Address" value={editableFields['address']} confidence={result.correlated_fields?.address?.confidence} />
                  <FieldBadge label="City" value={editableFields['city']} confidence={result.correlated_fields?.city?.confidence} />
                  <FieldBadge label="State" value={editableFields['state']} confidence={result.correlated_fields?.state?.confidence} />
                  <FieldBadge label="Zip" value={editableFields['zip']} confidence={result.correlated_fields?.zip_code?.confidence} />
                </div>
              </div>

              {/* Court / Case */}
              <div>
                <p className="text-[10px] text-rmpg-400 uppercase font-bold mb-1 flex items-center gap-1">
                  <Scale className="w-3 h-3" /> Court & Case
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
                  <FieldBadge label="Case #" value={editableFields['case_number']} confidence={result.correlated_fields?.case_number?.confidence} />
                  <FieldBadge label="Court" value={editableFields['court']} confidence={result.correlated_fields?.court?.confidence} />
                  <FieldBadge label="Plaintiff" value={editableFields['plaintiff']} confidence={result.correlated_fields?.plaintiff?.confidence} />
                  <FieldBadge label="Job #" value={editableFields['job_number']} confidence={result.correlated_fields?.job_number?.confidence} />
                  <FieldBadge label="Due Date" value={editableFields['due_date']} confidence={result.correlated_fields?.due_date?.confidence} />
                  <FieldBadge label="Fee" value={editableFields['fee']} confidence={result.correlated_fields?.fee?.confidence} />
                </div>
              </div>

              {/* Attorney */}
              {(editableFields['attorney_name'] || editableFields['attorney_phone']) && (
                <div>
                  <p className="text-[10px] text-rmpg-400 uppercase font-bold mb-1 flex items-center gap-1">
                    <CreditCard className="w-3 h-3" /> Attorney
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
                    <FieldBadge label="Name" value={editableFields['attorney_name']} confidence={result.correlated_fields?.attorney_name?.confidence} />
                    <FieldBadge label="Phone" value={editableFields['attorney_phone']} confidence={result.correlated_fields?.attorney_phone?.confidence} />
                    <FieldBadge label="Email" value={editableFields['attorney_email']} confidence={result.correlated_fields?.attorney_email?.confidence} />
                  </div>
                </div>
              )}

              {/* Vehicle */}
              {result.extracted.vehicle && (
                <div>
                  <p className="text-[10px] text-rmpg-400 uppercase font-bold mb-1 flex items-center gap-1">
                    <Car className="w-3 h-3" /> Vehicle
                  </p>
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-1.5">
                    <FieldBadge label="Plate" value={result.extracted.vehicle.plate} confidence={result.correlated_fields?.vehicle_plate?.confidence} />
                    <FieldBadge label="VIN" value={result.extracted.vehicle.vin} confidence={result.correlated_fields?.vehicle_vin?.confidence} />
                    <FieldBadge label="Make" value={result.extracted.vehicle.make} confidence={result.correlated_fields?.vehicle_make?.confidence} />
                    <FieldBadge label="Model" value={result.extracted.vehicle.model} confidence={result.correlated_fields?.vehicle_model?.confidence} />
                    <FieldBadge label="Year" value={result.extracted.vehicle.year} confidence={result.correlated_fields?.vehicle_year?.confidence} />
                    <FieldBadge label="Color" value={result.extracted.vehicle.color} confidence={result.correlated_fields?.vehicle_color?.confidence} />
                  </div>
                </div>
              )}

              {/* ID Numbers */}
              {(result.extracted.ssn || result.extracted.dlNumber || result.extracted.phoneNumbers) && (
                <div>
                  <p className="text-[10px] text-rmpg-400 uppercase font-bold mb-1 flex items-center gap-1">
                    <Hash className="w-3 h-3" /> ID Numbers & Contact
                  </p>
                  <div className="grid grid-cols-3 gap-1.5">
                    <FieldBadge label="SSN" value={result.extracted.ssn} confidence={result.correlated_fields?.ssn?.confidence} />
                    <FieldBadge label="DL #" value={result.extracted.dlNumber} confidence={result.correlated_fields?.dl_number?.confidence} />
                    <FieldBadge label="Phone" value={result.extracted.phoneNumbers} confidence={result.correlated_fields?.phone_numbers?.confidence} />
                  </div>
                </div>
              )}

              {/* Source Info */}
              {result.correlated_fields && (
                <div>
                  <p className="text-[10px] text-rmpg-400 uppercase font-bold mb-1 flex items-center gap-1">
                    <Layers className="w-3 h-3" /> Field Sources (per-field correlation)
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                    {Object.entries(result.correlated_fields)
                      .filter(([, f]) => f.value && f.confidence > 0 && f.source)
                      .slice(0, 12)
                      .map(([key, field]) => (
                        <div key={key} className="flex items-center gap-1 p-1.5 bg-surface-sunken rounded-sm text-[9px]">
                          <span className="text-rmpg-500 font-mono">{key.replace(/_/g, ' ')}</span>
                          <span className="text-rmpg-600">→</span>
                          <span className="text-rmpg-400">{field.source.replace(/_/g, ' ')}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
