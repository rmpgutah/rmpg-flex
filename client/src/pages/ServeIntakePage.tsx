// ============================================================
// RMPG Flex — Process Service Intake Portal (v2 — Review Wizard)
// Two-step workflow: Upload PDFs → Review/Edit Extracted Data → Confirm
// Auto-creates Person, Property, Case, CFS call, Serve Queue.
// ============================================================

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Upload, FileText, CheckCircle, AlertTriangle, Loader2, MapPin,
  User, Building2, Phone, X, ChevronRight, Edit2, Save, ArrowLeft,
  Gavel, Calendar, Briefcase, FileWarning, Clock, Shield, Users,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useNavigate } from 'react-router-dom';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';

interface UploadedFile {
  name: string;
  type: 'court_docket' | 'field_sheet' | 'info_sheet' | 'unknown';
  text: string;
  status: 'pending' | 'extracted' | 'error';
}

interface ParsedData {
  defendant: { first: string; middle: string; last: string; dob: string };
  address: string;
  plaintiff: string;
  court: string;
  courtAddress: string;
  county: string;
  attorney: { name: string; firm: string; barNumber: string; tel: string; email: string; addressLine1: string; addressLine2: string; fax: string };
  documents: string;
  primaryDoc: string;
  serviceType: string;
  instructions: string;
  jobNumber: string;
  clientJobNumber: string;
  dueDate: string;
  signedDate: string;
  serviceWindows: string;
  serviceRulesSummary: string;
  courtCaseNumber: string;
}

interface ParseResponse {
  parsed: ParsedData;
  detectedTypes: { fieldSheet: boolean; courtDocket: boolean; infoSheet: boolean };
  warnings: string[];
}

interface IntakeResult {
  success: boolean;
  defendant_person_id: number;
  plaintiff_person_id: number | null;
  attorney_person_id: number | null;
  property_id: number | null;
  case_id: number;
  case_number: string;
  call_id: number;
  call_number: string;
  serve_queue_id: number | null;
  serve_attempt_ids: number[];
  latitude: number | null;
  longitude: number | null;
  weather: string | null;
  lighting: string | null;
  warnings: string[];
  extracted: any;
}

type Step = 'upload' | 'review' | 'complete';

const DOC_TYPE_OPTIONS = [
  { value: 'court_docket', label: 'Court Docket', color: 'bg-red-900/40 text-red-400 border-red-700/40' },
  { value: 'field_sheet', label: 'Field Sheet', color: 'bg-amber-900/40 text-amber-400 border-amber-700/40' },
  { value: 'info_sheet', label: 'Info Sheet', color: 'bg-green-900/40 text-green-400 border-green-700/40' },
];

export default function ServeIntakePage() {
  const [step, setStep] = useState<Step>('upload');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [parsed, setParsed] = useState<ParsedData | null>(null);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [detectedTypes, setDetectedTypes] = useState<ParseResponse['detectedTypes'] | null>(null);
  const [processing, setProcessing] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Client selector
  const [clients, setClients] = useState<{ id: number; name: string; billing_code?: string; caller_phone?: string; address?: string }[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<number | ''>('');
  useEffect(() => {
    apiFetch<any[]>('/admin/clients').then(data => {
      const active = (data || []).filter((c: any) => c.is_active !== 0);
      setClients(active);
    }).catch(() => {});
  }, []);
  // Editable overrides
  const [editDefendant, setEditDefendant] = useState({ first: '', middle: '', last: '', dob: '' });
  const [editAddress, setEditAddress] = useState('');
  const [editPlaintiff, setEditPlaintiff] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editInstructions, setEditInstructions] = useState('');
  const [editCourt, setEditCourt] = useState('');
  const [editJobNumber, setEditJobNumber] = useState('');
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
    } catch { /* fallback */ }
    return '';
  }, []);

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const newFiles: UploadedFile[] = [];
    for (const file of Array.from(fileList)) {
      if (file.type !== 'application/pdf') continue;
      const text = await extractPdfText(file);
      const type = file.name.toLowerCase().includes('court') ? 'court_docket' as const
        : file.name.toLowerCase().includes('field') ? 'field_sheet' as const
        : file.name.toLowerCase().includes('info') ? 'info_sheet' as const
        : 'unknown' as const;
      newFiles.push({ name: file.name, type, text, status: text.length > 50 ? 'extracted' : 'error' });
    }
    setFiles(prev => [...prev, ...newFiles]);
    setError(null);
  }, [extractPdfText]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const removeFile = (idx: number) => setFiles(prev => prev.filter((_, i) => i !== idx));

  const changeDocType = (idx: number, newType: UploadedFile['type']) => {
    setFiles(prev => prev.map((f, i) => i === idx ? { ...f, type: newType } : f));
  };

  // Step 1 → Step 2: Parse documents and show review
  const handleParse = useCallback(async () => {
    if (files.length === 0) return;
    setParsing(true);
    setError(null);
    try {
      const documents = files.map(f => ({ type: f.type, text: f.text }));
      const resp = await apiFetch<ParseResponse>('/serve-intake/parse', {
        method: 'POST',
        body: JSON.stringify({ documents }),
      });
      setParsed(resp.parsed);
      setParseWarnings(resp.warnings);
      setDetectedTypes(resp.detectedTypes);
      // Pre-fill editable fields
      setEditDefendant({ ...resp.parsed.defendant });
      setEditAddress(resp.parsed.address);
      setEditPlaintiff(resp.parsed.plaintiff);
      setEditDueDate(resp.parsed.dueDate);
      setEditInstructions(resp.parsed.instructions);
      setEditCourt(resp.parsed.court);
      setEditJobNumber(resp.parsed.jobNumber);
      setStep('review');
    } catch (err: any) {
      setError(err?.message || 'Failed to parse documents');
    }
    setParsing(false);
  }, [files]);

  // Step 2 → Step 3: Create records with overrides
  const handleConfirm = useCallback(async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setError(null);
    try {
      const documents = files.map(f => ({ type: f.type, text: f.text }));
      const overrides: Record<string, any> = {};
      if (parsed) {
        // Only send overrides if user changed a value
        if (editDefendant.first !== parsed.defendant.first || editDefendant.last !== parsed.defendant.last ||
            editDefendant.middle !== parsed.defendant.middle || editDefendant.dob !== parsed.defendant.dob) {
          overrides.defendant = editDefendant;
        }
        if (editAddress !== parsed.address) overrides.address = editAddress;
        if (editPlaintiff !== parsed.plaintiff) overrides.plaintiff = editPlaintiff;
        if (editDueDate !== parsed.dueDate) overrides.dueDate = editDueDate;
        if (editInstructions !== parsed.instructions) overrides.instructions = editInstructions;
        if (editCourt !== parsed.court) overrides.court = editCourt;
        if (editJobNumber !== parsed.jobNumber) overrides.jobNumber = editJobNumber;
      }
      // Include selected client if user chose one
      if (selectedClientId) overrides.client_id = selectedClientId;
      const resp = await apiFetch<IntakeResult>('/serve-intake/intake', {
        method: 'POST',
        body: JSON.stringify({ documents, overrides: Object.keys(overrides).length > 0 ? overrides : undefined }),
      });
      if (resp?.success) {
        setResult(resp);
        setStep('complete');
      } else {
        setError('Intake processing failed');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to process documents');
    }
    setProcessing(false);
  }, [files, parsed, editDefendant, editAddress, editPlaintiff, editDueDate, editInstructions, editCourt, editJobNumber]);

  const resetAll = () => {
    setStep('upload');
    setFiles([]);
    setParsed(null);
    setParseWarnings([]);
    setResult(null);
    setError(null);
  };

  const FieldRow = ({ label, icon: Icon, value, onChange, placeholder, multiline }: {
    label: string; icon: React.ElementType; value: string;
    onChange: (v: string) => void; placeholder?: string; multiline?: boolean;
  }) => (
    <div>
      <label className="text-[10px] text-rmpg-400 uppercase flex items-center gap-1 mb-1">
        <Icon className="w-3 h-3" /> {label}
      </label>
      {multiline ? (
        <textarea className="input-dark text-xs w-full min-h-[48px]" rows={3} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
      ) : (
        <input className="input-dark text-xs w-full" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
      )}
    </div>
  );

  return (
    <div className="p-4 space-y-4 max-w-5xl mx-auto">
      <PanelTitleBar title="Process Service Intake" icon={Upload}>
        {/* Step indicator */}
        <div className="flex items-center gap-1 text-[10px] text-rmpg-400">
          <span className={step === 'upload' ? 'text-brand-400 font-bold' : ''}>1. Upload</span>
          <ChevronRight className="w-3 h-3" />
          <span className={step === 'review' ? 'text-brand-400 font-bold' : ''}>2. Review</span>
          <ChevronRight className="w-3 h-3" />
          <span className={step === 'complete' ? 'text-green-400 font-bold' : ''}>3. Complete</span>
        </div>
      </PanelTitleBar>

      {/* ═══════ STEP 1: UPLOAD ═══════ */}
      {step === 'upload' && (
        <>
          <div
            ref={dropRef}
            onDrop={handleDrop}
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
            role="button" tabIndex={0}
            aria-label="Upload PDF documents"
            className="border-2 border-dashed border-rmpg-600 p-8 text-center cursor-pointer hover:border-rmpg-400 hover:bg-surface-raised/50 focus:outline-none focus:border-brand-500 transition-all"
          >
            <Upload className="w-10 h-10 text-rmpg-500 mx-auto mb-3" />
            <p className="text-sm font-bold text-rmpg-300">DRAG & DROP PDF DOCUMENTS</p>
            <p className="text-[10px] text-rmpg-500 mt-1">Court Docket · Field Sheet · Information Sheet</p>
            <p className="text-[9px] text-rmpg-600 mt-2">or click to browse files</p>
            <input ref={fileInputRef} type="file" accept=".pdf" multiple className="hidden"
              onChange={e => { if (e.target.files) handleFiles(e.target.files); e.target.value = ''; }} />
          </div>

          {files.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider">{files.length} Document{files.length > 1 ? 's' : ''} Loaded</p>
              {files.map((f, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 panel-beveled bg-surface-raised text-xs">
                  <FileText className="w-4 h-4 text-rmpg-400 flex-shrink-0" />
                  <span className="text-white font-medium truncate flex-1">{f.name}</span>
                  {/* Doc type selector */}
                  <select
                    className="input-dark text-[9px] w-28 py-0.5"
                    value={f.type}
                    onChange={e => changeDocType(i, e.target.value as UploadedFile['type'])}
                  >
                    {DOC_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    <option value="unknown">Auto-detect</option>
                  </select>
                  {f.status === 'extracted' ? (
                    <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500" title="Extraction may be incomplete" />
                  )}
                  <span className="text-[9px] text-rmpg-500">{f.text.length.toLocaleString()} chars</span>
                  <IconButton onClick={() => removeFile(i)} aria-label={`Remove ${f.name}`} className="p-0.5 text-rmpg-500 hover:text-red-400">
                    <X className="w-3 h-3" />
                  </IconButton>
                </div>
              ))}
            </div>
          )}

          {files.length > 0 && (
            <button onClick={handleParse} disabled={parsing || files.every(f => f.status === 'error')}
              className="w-full toolbar-btn toolbar-btn-primary py-3 text-sm font-bold justify-center">
              {parsing ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Extracting & Parsing...</>
              ) : (
                <><ChevronRight className="w-4 h-4" /> Review Extracted Data</>
              )}
            </button>
          )}
        </>
      )}

      {/* ═══════ STEP 2: REVIEW & EDIT ═══════ */}
      {step === 'review' && parsed && (
        <>
          <div className="flex items-center gap-2 mb-2">
            <button onClick={() => setStep('upload')} className="toolbar-btn text-[10px]">
              <ArrowLeft className="w-3 h-3" /> Back to Upload
            </button>
            <span className="text-[10px] text-rmpg-400 flex-1">Review and correct extracted data before creating records</span>
          </div>

          {/* Warnings */}
          {parseWarnings.length > 0 && (
            <div className="bg-amber-900/20 border border-amber-700/40 p-3 text-[10px] text-amber-300 space-y-1">
              <div className="flex items-center gap-1 font-bold"><AlertTriangle className="w-3.5 h-3.5" /> Warnings</div>
              {parseWarnings.map((w, i) => <p key={i}>• {w}</p>)}
            </div>
          )}

          {/* Detected document types */}
          {detectedTypes && (
            <div className="flex items-center gap-3 text-[10px]">
              <span className="text-rmpg-500">Detected:</span>
              {detectedTypes.fieldSheet && <span className="text-amber-400">✓ Field Sheet</span>}
              {detectedTypes.courtDocket && <span className="text-red-400">✓ Court Docket</span>}
              {detectedTypes.infoSheet && <span className="text-green-400">✓ Info Sheet</span>}
              {!detectedTypes.fieldSheet && <span className="text-rmpg-600">✗ Field Sheet</span>}
              {!detectedTypes.courtDocket && <span className="text-rmpg-600">✗ Court Docket</span>}
              {!detectedTypes.infoSheet && <span className="text-rmpg-600">✗ Info Sheet</span>}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Defendant */}
            <div className="panel-beveled p-4 space-y-3">
              <h3 className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" /> Defendant / Recipient
              </h3>
              <div className="grid grid-cols-3 gap-2">
                <FieldRow label="First Name" icon={User} value={editDefendant.first} onChange={v => setEditDefendant(p => ({ ...p, first: v }))} placeholder="First" />
                <FieldRow label="Middle" icon={User} value={editDefendant.middle} onChange={v => setEditDefendant(p => ({ ...p, middle: v }))} placeholder="Middle" />
                <FieldRow label="Last Name" icon={User} value={editDefendant.last} onChange={v => setEditDefendant(p => ({ ...p, last: v }))} placeholder="Last" />
              </div>
              <FieldRow label="Date of Birth" icon={Calendar} value={editDefendant.dob} onChange={v => setEditDefendant(p => ({ ...p, dob: v }))} placeholder="YYYY-MM-DD" />
              <FieldRow label="Service Address" icon={MapPin} value={editAddress} onChange={setEditAddress} placeholder="Full address with city, state, ZIP" />
            </div>

            {/* Client + Case Details */}
            <div className="panel-beveled p-4 space-y-3">
              <h3 className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider flex items-center gap-1.5">
                <Gavel className="w-3.5 h-3.5" /> Client & Case Details
              </h3>
              {/* Client selector */}
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase flex items-center gap-1 mb-1">
                  <Users className="w-3 h-3" /> Ordering Client
                </label>
                <select
                  className="input-dark text-xs w-full"
                  value={selectedClientId}
                  onChange={e => {
                    const id = e.target.value ? parseInt(e.target.value, 10) : '';
                    setSelectedClientId(id);
                  }}
                >
                  <option value="">Auto-detect from document</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.billing_code ? ` (${c.billing_code})` : ''}
                    </option>
                  ))}
                </select>
                {selectedClientId && (() => {
                  const c = clients.find(cl => cl.id === selectedClientId);
                  return c ? (
                    <div className="mt-1 text-[9px] text-rmpg-500 space-x-3">
                      {c.caller_phone && <span>Phone: {c.caller_phone}</span>}
                      {c.address && <span>Address: {c.address}</span>}
                    </div>
                  ) : null;
                })()}
              </div>
              <FieldRow label="Plaintiff" icon={Building2} value={editPlaintiff} onChange={setEditPlaintiff} placeholder="Plaintiff name" />
              <FieldRow label="Court" icon={Gavel} value={editCourt} onChange={setEditCourt} placeholder="Court name" />
              <div className="grid grid-cols-2 gap-2">
                <FieldRow label="Due Date" icon={Calendar} value={editDueDate} onChange={setEditDueDate} placeholder="MM/DD/YYYY" />
                <FieldRow label="Job Number" icon={Briefcase} value={editJobNumber} onChange={setEditJobNumber} placeholder="Job #" />
              </div>
            </div>
          </div>

          {/* Instructions */}
          <div className="panel-beveled p-4 space-y-3">
            <h3 className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5" /> Service Instructions
            </h3>
            <FieldRow label="Instructions" icon={FileText} value={editInstructions} onChange={setEditInstructions} placeholder="Service instructions..." multiline />
          </div>

          {/* Read-only extracted details */}
          <div className="panel-beveled p-4 space-y-2">
            <h3 className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5" /> Additional Extracted Data (read-only)
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
              {parsed.documents && <div><span className="text-rmpg-500">Documents:</span> <span className="text-rmpg-300">{parsed.documents}</span></div>}
              {parsed.serviceType && <div><span className="text-rmpg-500">Service Type:</span> <span className="text-rmpg-300">{parsed.serviceType}</span></div>}
              {parsed.courtCaseNumber && <div><span className="text-rmpg-500">Case #:</span> <span className="text-rmpg-300">{parsed.courtCaseNumber}</span></div>}
              {parsed.serviceWindows && <div><span className="text-rmpg-500">Windows:</span> <span className="text-rmpg-300">{parsed.serviceWindows}</span></div>}
              {parsed.attorney.name && <div><span className="text-rmpg-500">Attorney:</span> <span className="text-rmpg-300">{parsed.attorney.name}</span></div>}
              {parsed.attorney.firm && <div><span className="text-rmpg-500">Firm:</span> <span className="text-rmpg-300">{parsed.attorney.firm}</span></div>}
              {parsed.signedDate && <div><span className="text-rmpg-500">Signed:</span> <span className="text-rmpg-300">{parsed.signedDate}</span></div>}
              {parsed.serviceRulesSummary && <div className="col-span-2"><span className="text-rmpg-500">Rules:</span> <span className="text-rmpg-300">{parsed.serviceRulesSummary}</span></div>}
            </div>
          </div>

          {/* Confirm button */}
          <button onClick={handleConfirm} disabled={processing || !editDefendant.last}
            className="w-full toolbar-btn toolbar-btn-primary py-3 text-sm font-bold justify-center">
            {processing ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Creating Records...</>
            ) : (
              <><CheckCircle className="w-4 h-4" /> Confirm & Create Person + Property + Case + Dispatch Call</>
            )}
          </button>
        </>
      )}

      {/* ═══════ STEP 3: COMPLETE ═══════ */}
      {step === 'complete' && result && (
        <div className="space-y-3">
          <div className="bg-green-900/20 border border-green-700/40 p-4">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <span className="text-sm font-bold text-green-400">INTAKE COMPLETE</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="panel-beveled bg-surface-raised p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <User className="w-3.5 h-3.5 text-rmpg-400" />
                  <span className="text-[10px] text-rmpg-400 uppercase font-bold">Defendant</span>
                </div>
                <p className="text-sm font-bold text-white">{editDefendant.first} {editDefendant.middle} {editDefendant.last}</p>
                {editDefendant.dob && <p className="text-[10px] text-rmpg-400">DOB: {editDefendant.dob}</p>}
                <button onClick={() => navigate(`/records?person=${result.defendant_person_id}`)} className="text-[9px] text-brand-400 mt-1 hover:underline">View in Records →</button>
              </div>
              <div className="panel-beveled bg-surface-raised p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Building2 className="w-3.5 h-3.5 text-rmpg-400" />
                  <span className="text-[10px] text-rmpg-400 uppercase font-bold">Property</span>
                </div>
                <p className="text-xs text-white">{editAddress || 'No address'}</p>
                {result.latitude && result.longitude && (
                  <p className="text-[9px] text-green-400 mt-1"><MapPin className="w-3 h-3 inline" /> {result.latitude.toFixed(6)}, {result.longitude.toFixed(6)}</p>
                )}
              </div>
              <div className="panel-beveled bg-surface-raised p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Phone className="w-3.5 h-3.5 text-rmpg-400" />
                  <span className="text-[10px] text-rmpg-400 uppercase font-bold">Dispatch Call</span>
                </div>
                <p className="text-sm font-bold text-white font-mono">{result.call_number}</p>
                <p className="text-[10px] text-rmpg-400">PSO Client Request — Pending</p>
                <button onClick={() => navigate('/dispatch')} className="text-[9px] text-brand-400 mt-1 hover:underline">View in Dispatch →</button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-3 text-[10px]">
              <button onClick={() => navigate(`/records?person=${result.defendant_person_id}`)} className="toolbar-btn justify-center"><User className="w-3 h-3" /> Defendant</button>
              {result.plaintiff_person_id && <button onClick={() => navigate(`/records?person=${result.plaintiff_person_id}`)} className="toolbar-btn justify-center"><Building2 className="w-3 h-3" /> Plaintiff</button>}
              {result.attorney_person_id && <button onClick={() => navigate(`/records?person=${result.attorney_person_id}`)} className="toolbar-btn justify-center"><User className="w-3 h-3" /> Attorney</button>}
              <button onClick={() => navigate(`/cases?case=${result.case_id}`)} className="toolbar-btn justify-center"><FileText className="w-3 h-3" /> Case</button>
              {result.serve_queue_id && <button onClick={() => navigate(`/serve?queue=${result.serve_queue_id}`)} className="toolbar-btn justify-center"><Phone className="w-3 h-3" /> Serve Queue</button>}
            </div>

            {result.warnings && result.warnings.length > 0 && (
              <div className="bg-amber-900/20 border border-amber-700/40 p-2 text-[10px] text-amber-300 mt-2">
                <AlertTriangle className="w-3 h-3 inline mr-1" /> Warnings:
                <ul className="list-disc list-inside">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </div>
            )}
          </div>

          <button onClick={resetAll} className="toolbar-btn w-full justify-center py-2">
            <Upload className="w-3.5 h-3.5" /> Process Another Set of Documents
          </button>
        </div>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 p-3 text-xs text-red-300">
          <AlertTriangle className="w-4 h-4 inline mr-1" /> {error}
        </div>
      )}
    </div>
  );
}
