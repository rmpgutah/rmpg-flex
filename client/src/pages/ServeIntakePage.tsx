// ============================================================
// RMPG Flex — Process Service Intake Portal (v2 — Review Wizard)
// Two-step workflow: Upload PDFs → Review/Edit Extracted Data → Confirm
// Auto-creates Person, Property, Case, CFS call, Serve Queue.
// ============================================================

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { extractFolderGroups, type FolderGroup } from '../utils/dropFolders';
import { formatPhoneInput } from '../utils/formatters';
import BulkDefendantTable from '../components/serve/BulkDefendantTable';
import RichTextArea from '../components/RichTextArea';
import {
  Upload, FileText, CheckCircle, AlertTriangle, Loader2, MapPin, User, Building2,
  Phone, X, ChevronRight, ArrowLeft, Gavel, Calendar, Briefcase, FileWarning,
  Clock, Shield, Users, History, Target, AlertCircle, Star, Fingerprint,
  ListChecks, Eye,
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
  rawFile: File;  // Keep original File for uploading as attachment after intake
}

interface ParsedData {
  defendant: { first: string; middle: string; last: string; dob: string };
  address: string;
  addressParts: { building: string; floor: string; suite: string; street: string; city: string; state: string; zip: string };
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
  responseDeadlineDays: number;
  clerkPhone: string;
  documentPages: number;
  bilingual: boolean;
  orderingClientRule: string;
  serviceWindows: string;
  serviceRulesSummary: string;
  courtCaseNumber: string;
  vendorFingerprint: string;
  jobActivity: { when: string; action: string; detail: string }[];
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

// IMPORTANT: FieldRow must be defined OUTSIDE the component to prevent
// React from recreating it on every render (which unmounts the input and kills focus).
// Confidence badge — inline indicator showing extraction quality per field
function ConfidenceBadge({ score, source }: { score: number; source: string }) {
  if (score <= 0) return null;
  const color = score >= 80 ? 'text-green-400 bg-green-900/20 border-green-700/40' : score >= 60 ? 'text-amber-400 bg-amber-900/20 border-amber-700/40' : 'text-red-400 bg-red-900/20 border-red-700/40';
  return (
    <span className={`ml-1 px-1 py-0 text-[7px] font-bold border ${color}`} title={`${score}% confidence — ${source}`}>
      {score}%
    </span>
  );
}

function FieldRow({ label, icon: Icon, value, onChange, placeholder, multiline }: {
  label: string; icon: React.ElementType; value: string;
  onChange: (v: string) => void; placeholder?: string; multiline?: boolean;
}) {
  return (
    <div>
      <label className="text-[10px] text-rmpg-400 uppercase flex items-center gap-1 mb-1">
        <Icon className="w-3 h-3" /> {label}
      </label>
      {multiline ? (
        <RichTextArea className="input-dark text-xs w-full min-h-[48px]" rows={3} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
      ) : (
        <input className="input-dark text-xs w-full" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
      )}
    </div>
  );
}

const DOC_TYPE_OPTIONS = [
  { value: 'court_docket', label: 'Court Docket', color: 'bg-red-900/40 text-red-400 border-red-700/40' },
  { value: 'field_sheet', label: 'Field Sheet', color: 'bg-amber-900/40 text-amber-400 border-amber-700/40' },
  { value: 'info_sheet', label: 'Info Sheet', color: 'bg-green-900/40 text-green-400 border-green-700/40' },
];

export default function ServeIntakePage() {
  const [step, setStep] = useState<Step>('upload');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  // Folder-drop queue: when a dispatcher drops multiple folders, each one
  // becomes its own intake "job" processed sequentially. The first folder's
  // files load immediately; subsequent folders wait in `folderQueue` and
  // auto-load after the prior job is submitted.
  const [folderQueue, setFolderQueue] = useState<FolderGroup[]>([]);
  const [currentJobName, setCurrentJobName] = useState<string | null>(null);
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
  // Editable overrides — all extracted fields are user-correctable
  const [editDefendant, setEditDefendant] = useState({ first: '', middle: '', last: '', dob: '' });
  const [editAddress, setEditAddress] = useState('');
  const [editAddressParts, setEditAddressParts] = useState({ building: '', floor: '', suite: '', city: '', state: '', zip: '' });
  const [editPlaintiff, setEditPlaintiff] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editInstructions, setEditInstructions] = useState('');
  const [editCourt, setEditCourt] = useState('');
  const [editCourtAddress, setEditCourtAddress] = useState('');
  const [editCounty, setEditCounty] = useState('');
  const [editCourtCaseNumber, setEditCourtCaseNumber] = useState('');
  const [editJobNumber, setEditJobNumber] = useState('');
  const [editClientJobNumber, setEditClientJobNumber] = useState('');
  const [editDocuments, setEditDocuments] = useState('');
  const [editServiceType, setEditServiceType] = useState('');
  const [editServiceWindows, setEditServiceWindows] = useState('');
  const [editSignedDate, setEditSignedDate] = useState('');
  const [editResponseDays, setEditResponseDays] = useState('');
  const [editClerkPhone, setEditClerkPhone] = useState('');
  const [editDocPages, setEditDocPages] = useState('');
  const [editBilingual, setEditBilingual] = useState(false);
  // Attorney
  const [editAttorney, setEditAttorney] = useState({ name: '', firm: '', barNumber: '', tel: '', email: '', fax: '' });
  // Priority & additional notes
  const [editPriority, setEditPriority] = useState<'P1' | 'P2' | 'P3' | 'P4'>('P4');
  const [editAdditionalNotes, setEditAdditionalNotes] = useState('');
  // Geocode preview
  const [previewLat, setPreviewLat] = useState('');
  const [previewLng, setPreviewLng] = useState('');
  const [geocodeFailed, setGeocodeFailed] = useState(false);
  const [expandedPreview, setExpandedPreview] = useState<number | null>(null);
  // Confidence scores from parse
  const [confidence, setConfidence] = useState<Record<string, { score: number; source: string }>>({});
  const [overallConfidence, setOverallConfidence] = useState(0);
  // Google Maps autocomplete
  const addressAutocompleteRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Initialize Google Maps Places Autocomplete — only once when entering review step
  const autocompleteInitialized = useRef(false);
  useEffect(() => {
    if (step !== 'review' || !addressAutocompleteRef.current || autocompleteInitialized.current) return;
    const g = (window as any).google;
    if (!g?.maps?.places) return;
    autocompleteInitialized.current = true;
    const ac = new g.maps.places.Autocomplete(addressAutocompleteRef.current, {
      types: ['address'],
      componentRestrictions: { country: 'us' },
      fields: ['formatted_address', 'geometry', 'address_components'],
    });
    ac.addListener('place_changed', () => {
      const place = ac.getPlace();
      if (place.formatted_address) setEditAddress(place.formatted_address);
      if (place.geometry?.location) {
        setPreviewLat(String(place.geometry.location.lat()));
        setPreviewLng(String(place.geometry.location.lng()));
        setGeocodeFailed(false);
      }
      if (place.address_components) {
        const get = (type: string) => place.address_components.find((c: any) => c.types.includes(type))?.long_name || '';
        const getShort = (type: string) => place.address_components.find((c: any) => c.types.includes(type))?.short_name || '';
        setEditAddressParts(prev => ({
          ...prev,
          building: get('street_number'),
          city: get('locality') || get('sublocality'),
          state: getShort('administrative_area_level_1'),
          zip: get('postal_code'),
          suite: prev.suite,
        }));
      }
    });
    return () => { autocompleteInitialized.current = false; };
  }, [step]);

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
      newFiles.push({ name: file.name, type, text, status: text.length > 50 ? 'extracted' : 'error', rawFile: file });
    }
    setFiles(prev => [...prev, ...newFiles]);
    setError(null);
  }, [extractPdfText]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Extract folder structure (each top-level folder = one intake job).
    // Falls back to flat file list if the browser doesn't expose folder entries.
    const groups = await extractFolderGroups(
      e.dataTransfer,
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
    );
    if (groups.length === 0) {
      // Last-resort fallback to plain files
      if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
      return;
    }
    // Load the first group into the active intake form.
    const [first, ...rest] = groups;
    setCurrentJobName(first.name);
    handleFiles(first.files);
    // Queue any additional folders to process after this one is submitted.
    if (rest.length > 0) {
      setFolderQueue((prev) => [...prev, ...rest]);
    }
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
      // Pre-fill ALL editable fields from parsed data
      const p = resp.parsed;
      setEditDefendant({ ...p.defendant });
      setEditAddress(p.address || '');
      setEditAddressParts({ building: p.addressParts?.building || '', floor: p.addressParts?.floor || '', suite: p.addressParts?.suite || '', city: p.addressParts?.city || '', state: p.addressParts?.state || 'UT', zip: p.addressParts?.zip || '' });
      setEditPlaintiff(p.plaintiff || '');
      setEditDueDate(p.dueDate || '');
      setEditInstructions(p.instructions || '');
      setEditCourt(p.court || '');
      setEditCourtAddress(p.courtAddress || '');
      setEditCounty(p.county || '');
      setEditCourtCaseNumber(p.courtCaseNumber || '');
      setEditJobNumber(p.jobNumber || '');
      setEditClientJobNumber(p.clientJobNumber || '');
      setEditDocuments(p.documents || '');
      setEditServiceType(p.serviceType || '');
      setEditServiceWindows(p.serviceWindows || '');
      setEditSignedDate(p.signedDate || '');
      setEditResponseDays(String(p.responseDeadlineDays || '21'));
      setEditClerkPhone(p.clerkPhone || '');
      setEditDocPages(String(p.documentPages || '0'));
      setEditBilingual(!!p.bilingual);
      setEditAttorney({ name: p.attorney?.name || '', firm: p.attorney?.firm || '', barNumber: p.attorney?.barNumber || '', tel: p.attorney?.tel || '', email: p.attorney?.email || '', fax: p.attorney?.fax || '' });
      // Confidence scores
      setConfidence((resp as any).confidence || {});
      setOverallConfidence((resp as any).overallConfidence || 0);
      // Geocode preview from parse response
      if ((resp as any).geocode) {
        setPreviewLat(String((resp as any).geocode.latitude));
        setPreviewLng(String((resp as any).geocode.longitude));
        setGeocodeFailed(false);
      } else {
        setPreviewLat('');
        setPreviewLng('');
        setGeocodeFailed(true);
      }
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
      // Send ALL editable fields as overrides — server applies them over auto-extracted values
      const overrides: Record<string, any> = {
        defendant: editDefendant,
        address: editAddress,
        plaintiff: editPlaintiff,
        dueDate: editDueDate,
        instructions: editInstructions,
        court: editCourt,
        courtAddress: editCourtAddress,
        county: editCounty,
        courtCaseNumber: editCourtCaseNumber,
        jobNumber: editJobNumber,
        clientJobNumber: editClientJobNumber,
        documents: editDocuments,
        serviceType: editServiceType,
        serviceWindows: editServiceWindows,
        signedDate: editSignedDate,
        responseDeadlineDays: parseInt(editResponseDays, 10) || 21,
        clerkPhone: editClerkPhone,
        documentPages: parseInt(editDocPages, 10) || 0,
        bilingual: editBilingual,
        attorney: editAttorney,
        priority: editPriority,
        additionalNotes: editAdditionalNotes || undefined,
        latitude: previewLat ? parseFloat(previewLat) : undefined,
        longitude: previewLng ? parseFloat(previewLng) : undefined,
      };
      if (selectedClientId) overrides.client_id = selectedClientId;
      const resp = await apiFetch<IntakeResult>('/serve-intake/intake', {
        method: 'POST',
        body: JSON.stringify({ documents, overrides: Object.keys(overrides).length > 0 ? overrides : undefined }),
      });
      if (resp?.success) {
        setResult(resp);
        setStep('complete');

        // Upload original PDF files as attachments to the dispatch call + case
        // This runs in the background — doesn't block the completion step
        const token = localStorage.getItem('rmpg_token');
        for (const f of files) {
          if (!f.rawFile) continue;
          const formData = new FormData();
          formData.append('files', f.rawFile);
          // Link to dispatch call
          formData.append('entity_type', 'call');
          formData.append('entity_id', String(resp.call_id));
          try {
            await fetch('/api/uploads', {
              method: 'POST',
              headers: token ? { 'Authorization': `Bearer ${token}` } : {},
              body: formData,
            });
          } catch { /* non-fatal — files still processed */ }
          // Also link to case
          const formData2 = new FormData();
          formData2.append('files', f.rawFile);
          formData2.append('entity_type', 'case');
          formData2.append('entity_id', String(resp.case_id));
          try {
            await fetch('/api/uploads', {
              method: 'POST',
              headers: token ? { 'Authorization': `Bearer ${token}` } : {},
              body: formData2,
            });
          } catch { /* non-fatal */ }
        }
      } else {
        setError('Intake processing failed');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to process documents');
    }
    setProcessing(false);
  }, [files, parsed, editDefendant, editAddress, editPlaintiff, editDueDate, editInstructions,
      editCourt, editCourtAddress, editCounty, editCourtCaseNumber, editJobNumber, editClientJobNumber,
      editDocuments, editServiceType, editServiceWindows, editSignedDate, editResponseDays,
      editClerkPhone, editDocPages, editBilingual, editAttorney, editPriority, editAdditionalNotes,
      selectedClientId, previewLat, previewLng]);

  const resetAll = () => {
    setStep('upload');
    setFiles([]);
    setParsed(null);
    setParseWarnings([]);
    setResult(null);
    setError(null);
  };

  // Reset state for a fresh job WITHOUT clearing the folder queue, so the
  // next queued folder can be loaded as a brand new intake.
  const resetForNextJob = useCallback(() => {
    setStep('upload');
    setFiles([]);
    setParsed(null);
    setParseWarnings([]);
    setDetectedTypes(null);
    setResult(null);
    setError(null);
  }, []);

  // Advance the folder queue: pop the next group, load its files, kick off parse.
  const advanceFolderQueue = useCallback(() => {
    if (folderQueue.length === 0) { setCurrentJobName(null); return; }
    const [next, ...rest] = folderQueue;
    setFolderQueue(rest);
    setCurrentJobName(next.name);
    resetForNextJob();
    handleFiles(next.files);
  }, [folderQueue, handleFiles, resetForNextJob]);

  // After a successful intake completion, auto-load the next queued folder.
  useEffect(() => {
    if (step === 'complete' && folderQueue.length > 0) {
      const t = setTimeout(() => advanceFolderQueue(), 1500);
      return () => clearTimeout(t);
    }
  }, [step, folderQueue.length, advanceFolderQueue]);

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

      {/* Folder-drop queue banner — shown across all steps when there are queued
          folders waiting to be processed as separate jobs. */}
      {(currentJobName || folderQueue.length > 0) && (
        <div className="panel-beveled p-3 bg-amber-900/10 border-l-4 border-amber-500/60">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-amber-300 font-bold uppercase tracking-wider text-[10px]">📁 Folder Queue</span>
              {currentJobName && (
                <span className="text-rmpg-200">
                  Current job: <strong className="text-amber-200">{currentJobName}</strong>
                </span>
              )}
              {folderQueue.length > 0 && (
                <span className="text-rmpg-400">
                  · {folderQueue.length} folder{folderQueue.length === 1 ? '' : 's'} pending
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => { setFolderQueue([]); setCurrentJobName(null); }}
              className="toolbar-btn text-[9px]"
              title="Clear pending folders (does not affect current job)"
            >
              Clear queue
            </button>
          </div>
          {folderQueue.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {folderQueue.map((g, i) => (
                <span key={i} className="text-[10px] font-mono px-2 py-0.5 bg-surface-raised border border-rmpg-700 text-rmpg-300">
                  #{i + 1} {g.name} ({g.files.length} file{g.files.length === 1 ? '' : 's'})
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══════ STEP 1: UPLOAD ═══════ */}
      {step === 'upload' && (
        <>
          {/* Bulk-defendant table — alternative entry path. Each row creates one
              dispatch CFS without parsing PDFs. PDFs can be attached later. */}
          <BulkDefendantTable />

          {/* Instructions panel */}
          <div className="panel-beveled p-4 bg-surface-sunken">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 flex items-center justify-center bg-brand-900/30 border border-brand-700/50 flex-shrink-0">
                <Upload className="w-5 h-5 text-brand-400" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-white mb-1">Or upload Service Documents (single job)</h3>
                <p className="text-[10px] text-rmpg-400 leading-relaxed">
                  Upload PDF documents from the process service packet. The system automatically detects document types,
                  extracts defendant information, addresses, court details, and service instructions.
                </p>
                <div className="flex items-center gap-4 mt-2 text-[9px]">
                  <span className="flex items-center gap-1 text-red-400"><FileText className="w-3 h-3" /> Court Docket — Summons, Complaints, Orders</span>
                  <span className="flex items-center gap-1 text-amber-400"><FileText className="w-3 h-3" /> Field Sheet — Service instructions, addresses</span>
                  <span className="flex items-center gap-1 text-green-400"><FileText className="w-3 h-3" /> Info Sheet — Job details, activity history</span>
                </div>
              </div>
            </div>
          </div>

          {/* Drop zone */}
          <div
            ref={dropRef}
            onDrop={handleDrop}
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
            role="button" tabIndex={0}
            aria-label="Upload PDF documents"
            className={`border-2 border-dashed p-10 text-center cursor-pointer transition-all ${
              files.length > 0
                ? 'border-brand-500/50 bg-brand-900/5 hover:bg-brand-900/10'
                : 'border-rmpg-600 hover:border-rmpg-400 hover:bg-surface-raised/50'
            } focus:outline-none focus:border-brand-500`}
          >
            <div className="flex flex-col items-center">
              <div className="w-16 h-16 rounded-full bg-surface-raised border border-rmpg-600 flex items-center justify-center mb-4">
                <Upload className="w-8 h-8 text-rmpg-400" />
              </div>
              <p className="text-sm font-bold text-rmpg-200">DRAG & DROP PDF DOCUMENTS — OR ENTIRE FOLDERS</p>
              <p className="text-[10px] text-rmpg-500 mt-1">Drop multiple folders to queue separate jobs · Court Docket · Field Sheet · Info Sheet</p>
              <p className="text-[10px] text-brand-400 mt-3 font-medium">or click anywhere to browse files</p>
              <p className="text-[8px] text-rmpg-600 mt-2">Each folder dropped becomes its own intake job, processed sequentially.</p>
            </div>
            <input ref={fileInputRef} type="file" accept=".pdf" multiple className="hidden"
              onChange={e => { if (e.target.files) handleFiles(e.target.files); e.target.value = ''; }} />
          </div>

          {files.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5" />
                  {files.length} Document{files.length > 1 ? 's' : ''} Loaded
                </p>
                <div className="flex items-center gap-2 text-[9px]">
                  <span className="text-rmpg-500">{files.reduce((sum, f) => sum + f.text.length, 0).toLocaleString()} chars extracted</span>
                  {files.every(f => f.status === 'extracted') && (
                    <span className="flex items-center gap-1 text-green-400"><CheckCircle className="w-3 h-3" /> All extracted</span>
                  )}
                </div>
              </div>
              {files.map((f, i) => (
                <React.Fragment key={i}>
                  <div className="flex items-center gap-2 px-3 py-2.5 panel-beveled bg-surface-raised text-xs border-l-2" style={{
                    borderLeftColor: f.type === 'court_docket' ? '#dc2626' : f.type === 'field_sheet' ? '#f59e0b' : f.type === 'info_sheet' ? '#22c55e' : '#888',
                  }}>
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
                      <span title="Extraction may be incomplete"><AlertTriangle className="w-3.5 h-3.5 text-amber-500" /></span>
                    )}
                    <span className="text-[9px] text-rmpg-500">{f.text.length.toLocaleString()} chars</span>
                    <button type="button" onClick={(e) => { e.stopPropagation(); setExpandedPreview(expandedPreview === i ? null : i); }}
                      className="p-0.5 text-rmpg-500 hover:text-brand-400 transition-colors" title="Preview extracted text">
                      <Eye className="w-3 h-3" />
                    </button>
                    <IconButton onClick={() => removeFile(i)} aria-label={`Remove ${f.name}`} className="p-0.5 text-rmpg-500 hover:text-red-400">
                      <X className="w-3 h-3" />
                    </IconButton>
                  </div>
                  {/* Extracted text preview */}
                  {expandedPreview === i && (
                    <div className="mx-3 mb-2 p-3 bg-surface-sunken border border-rmpg-700/50 max-h-[200px] overflow-y-auto">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[9px] text-rmpg-500 uppercase font-bold">Extracted Text Preview</span>
                        <span className="text-[9px] text-rmpg-600">{f.text.length.toLocaleString()} characters</span>
                      </div>
                      <pre className="text-[9px] text-rmpg-300 font-mono whitespace-pre-wrap leading-relaxed">{f.text.slice(0, 3000)}{f.text.length > 3000 ? '\n\n... (truncated)' : ''}</pre>
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
          )}

          {files.length > 0 && (
            <div className="space-y-2">
              {/* Document checklist */}
              <div className="panel-beveled p-3 bg-surface-sunken">
                <p className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-1.5">Document Detection Summary</p>
                <div className="grid grid-cols-3 gap-2 text-[10px]">
                  <div className={`flex items-center gap-1.5 p-1.5 border ${files.some(f => f.type === 'court_docket') ? 'border-red-700/40 bg-red-900/10 text-red-400' : 'border-rmpg-700/30 text-rmpg-600'}`}>
                    {files.some(f => f.type === 'court_docket') ? <CheckCircle className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    Court Docket {files.filter(f => f.type === 'court_docket').length > 1 ? `(${files.filter(f => f.type === 'court_docket').length})` : ''}
                  </div>
                  <div className={`flex items-center gap-1.5 p-1.5 border ${files.some(f => f.type === 'field_sheet') ? 'border-amber-700/40 bg-amber-900/10 text-amber-400' : 'border-rmpg-700/30 text-rmpg-600'}`}>
                    {files.some(f => f.type === 'field_sheet') ? <CheckCircle className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    Field Sheet
                  </div>
                  <div className={`flex items-center gap-1.5 p-1.5 border ${files.some(f => f.type === 'info_sheet') ? 'border-green-700/40 bg-green-900/10 text-green-400' : 'border-rmpg-700/30 text-rmpg-600'}`}>
                    {files.some(f => f.type === 'info_sheet') ? <CheckCircle className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    Info Sheet
                  </div>
                </div>
                {!files.some(f => f.type === 'field_sheet') && (
                  <p className="text-[9px] text-amber-400 mt-1.5 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Field Sheet missing — defendant name and address may not extract</p>
                )}
              </div>
              <button onClick={handleParse} disabled={parsing || files.every(f => f.status === 'error')}
                className="w-full toolbar-btn toolbar-btn-primary py-3.5 text-sm font-bold justify-center">
                {parsing ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Extracting & Parsing {files.length} Document{files.length > 1 ? 's' : ''}...</>
                ) : (
                  <><ChevronRight className="w-4 h-4" /> Review Extracted Data →</>
                )}
              </button>
            </div>
          )}
        </>
      )}

      {/* ═══════ STEP 2: REVIEW & EDIT ═══════ */}
      {step === 'review' && parsed && (
        <>
          <div className="flex items-center gap-2 mb-2">
            <button onClick={() => setStep('upload')} className="toolbar-btn text-[10px]"><ArrowLeft className="w-3 h-3" /> Back</button>
            <span className="text-[10px] text-rmpg-400 flex-1">Review and correct all extracted data before creating records</span>
          </div>

          {parseWarnings.length > 0 && (
            <div className="bg-amber-900/20 border border-amber-700/40 p-3 text-[10px] text-amber-300 space-y-1">
              <div className="flex items-center gap-1 font-bold"><AlertTriangle className="w-3.5 h-3.5" /> Warnings</div>
              {parseWarnings.map((w, i) => <p key={i}>• {w}</p>)}
            </div>
          )}

          {detectedTypes && (
            <div className="flex items-center gap-3 text-[10px] flex-wrap">
              <span className="text-rmpg-500">Documents detected:</span>
              {detectedTypes.fieldSheet ? <span className="text-amber-400">✓ Field Sheet</span> : <span className="text-rmpg-600">✗ Field Sheet</span>}
              {detectedTypes.courtDocket ? <span className="text-red-400">✓ Court Docket{(detectedTypes as any).courtDocketCount > 1 ? ` (${(detectedTypes as any).courtDocketCount} docs)` : ''}</span> : <span className="text-rmpg-600">✗ Court Docket</span>}
              {detectedTypes.infoSheet ? <span className="text-green-400">✓ Info Sheet</span> : <span className="text-rmpg-600">✗ Info Sheet</span>}
            </div>
          )}

          {/* ── Confidence Score Panel ── */}
          {overallConfidence > 0 && (
            <div className="panel-beveled p-3 bg-surface-sunken">
              <div className="flex items-center gap-3 mb-2">
                <div className={`text-2xl font-bold font-mono tabular-nums ${overallConfidence >= 80 ? 'text-green-400' : overallConfidence >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                  {overallConfidence}%
                </div>
                <div>
                  <div className="text-[10px] font-bold text-white uppercase">Extraction Confidence</div>
                  <div className="text-[9px] text-rmpg-400">
                    {overallConfidence >= 80 ? 'High — most fields extracted from structured sources' :
                     overallConfidence >= 60 ? 'Medium — some fields from fallback patterns, verify before submitting' :
                     'Low — many fields from universal scanner, manual review strongly recommended'}
                  </div>
                </div>
                {/* Progress bar */}
                <div className="flex-1 ml-2">
                  <div className="h-2 bg-rmpg-800 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${overallConfidence >= 80 ? 'bg-green-500' : overallConfidence >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                      style={{ width: `${overallConfidence}%` }} />
                  </div>
                </div>
              </div>
              {/* Per-field confidence breakdown */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-1 text-[9px]">
                {Object.entries(confidence).map(([field, { score, source }]) => (
                  <div key={field} className="flex items-center gap-1 px-1.5 py-0.5 bg-rmpg-800/50">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${score >= 80 ? 'bg-green-500' : score >= 60 ? 'bg-amber-500' : score > 0 ? 'bg-red-500' : 'bg-rmpg-600'}`} />
                    <span className="text-rmpg-400 truncate">{field}</span>
                    <span className={`ml-auto font-bold ${score >= 80 ? 'text-green-400' : score >= 60 ? 'text-amber-400' : score > 0 ? 'text-red-400' : 'text-rmpg-600'}`}>{score}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Row 1: Defendant + Address ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="panel-beveled p-4 space-y-3">
              <h3 className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> Defendant / Recipient</h3>
              <div className="grid grid-cols-3 gap-2">
                <FieldRow label="First Name" icon={User} value={editDefendant.first} onChange={v => setEditDefendant(p => ({ ...p, first: v }))} placeholder="First" />
                <FieldRow label="Middle" icon={User} value={editDefendant.middle} onChange={v => setEditDefendant(p => ({ ...p, middle: v }))} placeholder="Middle" />
                <FieldRow label="Last Name" icon={User} value={editDefendant.last} onChange={v => setEditDefendant(p => ({ ...p, last: v }))} placeholder="Last" />
              </div>
              <FieldRow label="Date of Birth" icon={Calendar} value={editDefendant.dob} onChange={v => setEditDefendant(p => ({ ...p, dob: v }))} placeholder="YYYY-MM-DD" />
            </div>

            <div className="panel-beveled p-4 space-y-3">
              <h3 className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> Service Address</h3>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase flex items-center gap-1 mb-1">
                  <MapPin className="w-3 h-3" /> Full Address
                  {confidence.address && <ConfidenceBadge score={confidence.address.score} source={confidence.address.source} />}
                </label>
                <input ref={addressAutocompleteRef} className="input-dark text-xs w-full" value={editAddress}
                  onChange={e => setEditAddress(e.target.value)}
                  placeholder="Start typing address — Google Maps will suggest matches..." />
                <p className="text-[8px] text-rmpg-600 mt-0.5">Google Maps autocomplete active — type to search. Selecting a result auto-fills coordinates.</p>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <FieldRow label="Building #" icon={Building2} value={editAddressParts.building} onChange={v => setEditAddressParts(p => ({ ...p, building: v }))} placeholder="5245" />
                <FieldRow label="Suite/Apt" icon={Building2} value={editAddressParts.suite} onChange={v => setEditAddressParts(p => ({ ...p, suite: v }))} placeholder="Apt 4B" />
                <FieldRow label="City" icon={MapPin} value={editAddressParts.city} onChange={v => setEditAddressParts(p => ({ ...p, city: v }))} placeholder="Murray" />
                <div className="grid grid-cols-2 gap-1">
                  <FieldRow label="State" icon={MapPin} value={editAddressParts.state} onChange={v => setEditAddressParts(p => ({ ...p, state: v }))} placeholder="UT" />
                  <FieldRow label="ZIP" icon={MapPin} value={editAddressParts.zip} onChange={v => setEditAddressParts(p => ({ ...p, zip: v }))} placeholder="84123" />
                </div>
              </div>
              {/* Geocode result + manual fix */}
              <div className={`p-2.5 border text-[10px] ${geocodeFailed ? 'bg-red-900/10 border-red-700/40' : 'bg-green-900/10 border-green-700/40'}`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <MapPin className={`w-3.5 h-3.5 ${geocodeFailed ? 'text-red-400' : 'text-green-400'}`} />
                  <span className={`font-bold uppercase ${geocodeFailed ? 'text-red-400' : 'text-green-400'}`}>
                    {geocodeFailed ? 'GEOCODING FAILED — Enter coordinates manually' : 'GEOCODED SUCCESSFULLY'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <FieldRow label="Latitude" icon={MapPin} value={previewLat} onChange={setPreviewLat} placeholder="40.6571375" />
                  <FieldRow label="Longitude" icon={MapPin} value={previewLng} onChange={setPreviewLng} placeholder="-111.9055814" />
                </div>
                {previewLat && previewLng && (
                  <a href={`https://maps.google.com/?q=${previewLat},${previewLng}`} target="_blank" rel="noopener noreferrer"
                    className="text-[9px] text-brand-400 hover:underline mt-1 inline-flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> Verify on Google Maps →
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* ── Row 2: Client + Case ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="panel-beveled p-4 space-y-3">
              <h3 className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Ordering Client</h3>
              <select className="input-dark text-xs w-full" value={selectedClientId} onChange={e => setSelectedClientId(e.target.value ? parseInt(e.target.value, 10) : '')}>
                <option value="">Auto-detect from document</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}{c.billing_code ? ` (${c.billing_code})` : ''}</option>)}
              </select>
              {selectedClientId && (() => { const c = clients.find(cl => cl.id === selectedClientId); return c ? <div className="text-[9px] text-rmpg-500">{c.caller_phone && <span>Phone: {c.caller_phone} · </span>}{c.address && <span>{c.address}</span>}</div> : null; })()}
              <FieldRow label="Plaintiff" icon={Building2} value={editPlaintiff} onChange={setEditPlaintiff} placeholder="Plaintiff name or organization" />
            </div>

            <div className="panel-beveled p-4 space-y-3">
              <h3 className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider flex items-center gap-1.5"><Gavel className="w-3.5 h-3.5" /> Court & Case</h3>
              <FieldRow label="Court" icon={Gavel} value={editCourt} onChange={setEditCourt} placeholder="Third Judicial District Court" />
              <FieldRow label="Court Address" icon={MapPin} value={editCourtAddress} onChange={setEditCourtAddress} placeholder="450 South State St, SLC 84111" />
              <div className="grid grid-cols-3 gap-2">
                <FieldRow label="County" icon={MapPin} value={editCounty} onChange={setEditCounty} placeholder="Salt Lake" />
                <FieldRow label="Court Case #" icon={FileText} value={editCourtCaseNumber} onChange={setEditCourtCaseNumber} placeholder="CV-26-001234" />
                <FieldRow label="Clerk Phone" icon={Phone} value={editClerkPhone} onChange={setEditClerkPhone} placeholder="(801) 555-1234" />
              </div>
            </div>
          </div>

          {/* ── Row 3: Documents + Service ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="panel-beveled p-4 space-y-3">
              <h3 className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Documents</h3>
              <FieldRow label="Document List" icon={FileText} value={editDocuments} onChange={setEditDocuments} placeholder="Summons; Complaint; Exhibits A-C" />
              <div className="grid grid-cols-3 gap-2">
                <FieldRow label="Service Type" icon={Shield} value={editServiceType} onChange={setEditServiceType} placeholder="SUMMONS SERVICE" />
                <FieldRow label="Pages" icon={FileText} value={editDocPages} onChange={setEditDocPages} placeholder="0" />
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase flex items-center gap-1 mb-1"><FileWarning className="w-3 h-3" /> Bilingual</label>
                  <button type="button" onClick={() => setEditBilingual(!editBilingual)} role="switch" aria-checked={editBilingual}
                    className={`w-full p-2 border text-[11px] font-medium text-left ${editBilingual ? 'bg-green-900/15 border-green-700/40 text-green-300' : 'bg-[#0c0c0c] border-[#181818] text-rmpg-400'}`}>
                    {editBilingual ? '✓ Bilingual documents' : 'English only'}
                  </button>
                </div>
              </div>
              <FieldRow label="Signed/Filed Date" icon={Calendar} value={editSignedDate} onChange={setEditSignedDate} placeholder="January 15, 2026" />
            </div>

            <div className="panel-beveled p-4 space-y-3">
              <h3 className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Service Schedule</h3>
              <div className="grid grid-cols-2 gap-2">
                <FieldRow label="Due Date" icon={Calendar} value={editDueDate} onChange={setEditDueDate} placeholder="MM/DD/YYYY" />
                <FieldRow label="Response Deadline (days)" icon={Clock} value={editResponseDays} onChange={setEditResponseDays} placeholder="21" />
              </div>
              <FieldRow label="Service Windows" icon={Clock} value={editServiceWindows} onChange={setEditServiceWindows} placeholder="6AM-9AM, 9AM-6PM, 6PM-9PM" />
              <div className="grid grid-cols-2 gap-2">
                <FieldRow label="Job Number (ICU)" icon={Briefcase} value={editJobNumber} onChange={setEditJobNumber} placeholder="1234567" />
                <FieldRow label="Client Job #" icon={Briefcase} value={editClientJobNumber} onChange={setEditClientJobNumber} placeholder="56789" />
              </div>
            </div>
          </div>

          {/* ── Row 4: Attorney ── */}
          <div className="panel-beveled p-4 space-y-3">
            <h3 className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> Attorney for Plaintiff</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <FieldRow label="Name" icon={User} value={editAttorney.name} onChange={v => setEditAttorney(p => ({ ...p, name: v }))} placeholder="Attorney name" />
              <FieldRow label="Firm" icon={Building2} value={editAttorney.firm} onChange={v => setEditAttorney(p => ({ ...p, firm: v }))} placeholder="Law firm" />
              <FieldRow label="Bar #" icon={Shield} value={editAttorney.barNumber} onChange={v => setEditAttorney(p => ({ ...p, barNumber: v }))} placeholder="12345" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <FieldRow label="Phone" icon={Phone} value={editAttorney.tel} onChange={v => setEditAttorney(p => ({ ...p, tel: formatPhoneInput(v) }))} placeholder="(801) 555-1234" />
              <FieldRow label="Fax" icon={Phone} value={editAttorney.fax} onChange={v => setEditAttorney(p => ({ ...p, fax: formatPhoneInput(v) }))} placeholder="(801) 555-5678" />
              <FieldRow label="Email" icon={FileText} value={editAttorney.email} onChange={v => setEditAttorney(p => ({ ...p, email: v }))} placeholder="attorney@firm.com" />
            </div>
          </div>

          {/* ── Row 5: Instructions ── */}
          <div className="panel-beveled p-4 space-y-3">
            <h3 className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Service Instructions</h3>
            <FieldRow label="Instructions (verbatim from field sheet)" icon={FileText} value={editInstructions} onChange={setEditInstructions} placeholder="Service instructions..." multiline />
            {parsed.serviceRulesSummary && (
              <div className="bg-amber-900/10 border border-amber-700/30 p-2 text-[10px]">
                <span className="text-amber-400 font-bold">AUTO-DETECTED RULES: </span>
                <span className="text-amber-300">{parsed.serviceRulesSummary}</span>
              </div>
            )}
          </div>

          {/* ── Row 6: Service Rules + Priority ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="panel-beveled p-4 space-y-3">
              <h3 className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider flex items-center gap-1.5"><Shield className="w-3.5 h-3.5" /> Service Rules & Restrictions</h3>
              {parsed.serviceRulesSummary ? (
                <div className="space-y-1.5">
                  {parsed.serviceRulesSummary.split('. ').filter(Boolean).map((rule, i) => (
                    <div key={i} className="flex items-start gap-2 text-[10px]">
                      <AlertCircle className="w-3 h-3 text-amber-400 mt-0.5 flex-shrink-0" />
                      <span className="text-rmpg-200">{rule.endsWith('.') ? rule : rule + '.'}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-rmpg-500 italic">No specific service rules detected from instructions</p>
              )}
              {parsed.orderingClientRule && (
                <div className="bg-surface-sunken p-2 text-[10px]">
                  <span className="text-rmpg-500 font-bold">CLIENT RULE: </span>
                  <span className="text-rmpg-300">{parsed.orderingClientRule}</span>
                </div>
              )}
            </div>

            <div className="panel-beveled p-4 space-y-3">
              <h3 className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider flex items-center gap-1.5"><Star className="w-3.5 h-3.5" /> Priority & Classification</h3>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase flex items-center gap-1 mb-1"><Target className="w-3 h-3" /> Dispatch Priority</label>
                <div className="grid grid-cols-4 gap-1">
                  {([['P1', 'Emergency', 'bg-red-900/30 border-red-700/50 text-red-400'], ['P2', 'Urgent', 'bg-amber-900/30 border-amber-700/50 text-amber-400'], ['P3', 'Normal', 'bg-gray-900/30 border-gray-700/50 text-gray-400'], ['P4', 'Low', 'bg-green-900/30 border-green-700/50 text-green-400']] as const).map(([val, label, cls]) => (
                    <button key={val} type="button" onClick={() => setEditPriority(val)}
                      className={`p-1.5 border text-center text-[10px] font-bold transition-all ${editPriority === val ? cls + ' ring-1 ring-brand-500/50' : 'bg-[#0c0c0c] border-[#181818] text-rmpg-500'}`}>
                      {val}<br /><span className="text-[8px] font-normal">{label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <FieldRow label="Additional Dispatcher Notes" icon={FileText} value={editAdditionalNotes} onChange={setEditAdditionalNotes} placeholder="Any additional notes for the dispatcher..." multiline />
            </div>
          </div>

          {/* ── Row 7: Job Activity History ── */}
          {parsed.jobActivity && parsed.jobActivity.length > 0 && (
            <div className="panel-beveled p-4 space-y-3">
              <h3 className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> Client Job Activity History</h3>
              <div className="space-y-1 max-h-[200px] overflow-y-auto">
                {parsed.jobActivity.map((entry: any, i: number) => (
                  <div key={i} className="flex items-start gap-3 text-[10px] py-1 border-b border-rmpg-800 last:border-0">
                    <span className="text-rmpg-500 font-mono whitespace-nowrap">{entry.when}</span>
                    <span className="text-amber-400 font-bold whitespace-nowrap">{entry.action}</span>
                    <span className="text-rmpg-300 flex-1">{entry.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Row 8: Vendor Fingerprint + Data Summary ── */}
          <div className="panel-beveled p-4 space-y-3">
            <h3 className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider flex items-center gap-1.5"><Fingerprint className="w-3.5 h-3.5" /> Extraction Summary</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[10px]">
              <div className="bg-surface-sunken p-2">
                <span className="text-rmpg-500 block">Vendor ID</span>
                <span className="text-rmpg-200 font-mono">{parsed.vendorFingerprint || '—'}</span>
              </div>
              <div className="bg-surface-sunken p-2">
                <span className="text-rmpg-500 block">Document Pages</span>
                <span className="text-rmpg-200 font-mono">{editDocPages || '0'}</span>
              </div>
              <div className="bg-surface-sunken p-2">
                <span className="text-rmpg-500 block">Primary Doc</span>
                <span className="text-rmpg-200 font-mono">{parsed.primaryDoc || '—'}</span>
              </div>
              <div className="bg-surface-sunken p-2">
                <span className="text-rmpg-500 block">Files Uploaded</span>
                <span className="text-rmpg-200 font-mono">{files.length}</span>
              </div>
            </div>
          </div>

          {/* ── Row 9: What Will Be Created ── */}
          <div className="panel-beveled p-4 space-y-2">
            <h3 className="text-[10px] font-bold text-green-400 uppercase tracking-wider flex items-center gap-1.5"><ListChecks className="w-3.5 h-3.5" /> Records To Be Created</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
              <div className="flex items-center gap-1.5 text-rmpg-200"><CheckCircle className="w-3 h-3 text-green-500" /> Person: {editDefendant.first} {editDefendant.last}</div>
              {editPlaintiff && <div className="flex items-center gap-1.5 text-rmpg-200"><CheckCircle className="w-3 h-3 text-green-500" /> Plaintiff: {editPlaintiff.substring(0, 30)}</div>}
              {editAttorney.name && <div className="flex items-center gap-1.5 text-rmpg-200"><CheckCircle className="w-3 h-3 text-green-500" /> Attorney: {editAttorney.name}</div>}
              {editAddress && <div className="flex items-center gap-1.5 text-rmpg-200"><CheckCircle className="w-3 h-3 text-green-500" /> Property at address</div>}
              <div className="flex items-center gap-1.5 text-rmpg-200"><CheckCircle className="w-3 h-3 text-green-500" /> Civil Case (CV-XX-XXXXX)</div>
              <div className="flex items-center gap-1.5 text-rmpg-200"><CheckCircle className="w-3 h-3 text-green-500" /> Dispatch Call ({editPriority})</div>
              <div className="flex items-center gap-1.5 text-rmpg-200"><CheckCircle className="w-3 h-3 text-green-500" /> Serve Queue Entry</div>
              {editDueDate && <div className="flex items-center gap-1.5 text-rmpg-200"><CheckCircle className="w-3 h-3 text-green-500" /> 3 Planned Attempts</div>}
            </div>
          </div>

          {/* Confirm */}
          <button onClick={handleConfirm} disabled={processing || !editDefendant.last}
            className="w-full toolbar-btn toolbar-btn-primary py-3 text-sm font-bold justify-center">
            {processing ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating Records...</> : <><CheckCircle className="w-4 h-4" /> Confirm & Create All Records</>}
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
