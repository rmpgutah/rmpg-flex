// ============================================================
// RMPG Flex — Process Service Intake Portal
// Drag-and-drop upload for Court Filing, Field Sheet, and
// Information Page PDFs. Auto-creates Person, Property, and
// CFS dispatch call with geocoded coordinates.
// ============================================================

import React, { useState, useCallback, useRef } from 'react';
import { Upload, FileText, CheckCircle, AlertTriangle, Loader2, MapPin, User, Building2, Phone, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';

interface UploadedFile {
  name: string;
  type: string;
  file: File;
  text: string;
  status: 'pending' | 'extracted' | 'error';
}

interface IntakeAttachment {
  id: number;
  filename: string;
  doc_type: string;
}

interface IntakeResult {
  success: boolean;
  defendant_person_id: number;
  plaintiff_person_id: number | null;
  attorney_person_id: number | null;
  property_id: number | null;
  case_id: number;
  call_id: number;
  call_number: string;
  serve_queue_id: number | null;
  serve_attempt_ids: number[];
  latitude: number | null;
  longitude: number | null;
  weather: string | null;
  lighting: string | null;
  warnings: string[];
  attachment_ids?: number[];
  additional_defendants?: string[];
  extracted: {
    defendant: { first: string; middle: string; last: string; dob: string };
    address: string;
    plaintiff: string;
    court: string;
    documents: string;
    primaryDoc: string;
    serviceType: string;
    clientJobNumber: string;
    jobNumber: string;
    dueDate: string;
    attorney: { name: string; firm: string; barNumber: string; tel: string; email: string };
  };
}

export default function ServeIntakePage() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Extract text from PDF using canvas-based approach
  const extractPdfText = useCallback(async (file: File): Promise<string> => {
    // Send raw PDF binary to server for pdftotext extraction
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
      const type = file.name.toLowerCase().includes('court') ? 'court_filing'
        : file.name.toLowerCase().includes('field') ? 'field_sheet'
        : 'info_page';
      newFiles.push({ name: file.name, type, file, text, status: text.length > 50 ? 'extracted' : 'error' });
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
      const form = new FormData();
      for (const f of files) {
        const docType = f.type === 'court_filing' ? 'court_docket'
          : f.type === 'info_page' ? 'info_sheet'
          : f.type; // field_sheet
        form.append(docType, f.file, f.name);
      }
      const resp = await fetch('/api/serve-intake/intake-multipart', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('rmpg_token')}` },
        body: form,
      });
      const data: IntakeResult | { error?: string } = await resp.json();
      if (resp.ok && (data as IntakeResult).success) {
        setResult(data as IntakeResult);
      } else {
        setError((data as any).error || 'Intake processing failed');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to process documents');
    }
    setProcessing(false);
  }, [files]);

  return (
    <div className="p-4 space-y-4 max-w-4xl mx-auto">
      <PanelTitleBar title="Process Service Intake" icon={Upload} />

      {/* Drop Zone */}
      <div
        ref={dropRef}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
        role="button"
        tabIndex={0}
        aria-label="Upload PDF documents: drag and drop or press Enter to browse"
        className="border-2 border-dashed border-rmpg-600 rounded-sm p-8 text-center cursor-pointer hover:border-rmpg-400 hover:bg-surface-raised/50 focus:outline-none focus:border-rmpg-400 focus:ring-2 focus:ring-[#d4a017]/40 transition-all"
        style={{ background: 'var(--surface-sunken)' }}
      >
        <Upload className="w-10 h-10 text-rmpg-500 mx-auto mb-3" />
        <p className="text-sm font-bold text-rmpg-300">DRAG & DROP PDF DOCUMENTS</p>
        <p className="text-[10px] text-rmpg-500 mt-1">Court Filing, Field Sheet, Information Page</p>
        <p className="text-[9px] text-rmpg-600 mt-2">or click to browse files</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          multiple
          className="hidden"
          onChange={e => { if (e.target.files) handleFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {/* Uploaded Files */}
      {files.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider">{files.length} Document{files.length > 1 ? 's' : ''} Loaded</p>
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
              <span className="text-[9px] text-rmpg-500">{f.text.length} chars</span>
              <IconButton onClick={() => removeFile(i)} aria-label={`Remove ${f.name}`} className="p-0.5 text-rmpg-500 hover:text-red-400"><X className="w-3 h-3" /></IconButton>
            </div>
          ))}
        </div>
      )}

      {/* Process Button */}
      {files.length > 0 && !result && (
        <button
          onClick={processIntake}
          disabled={processing || files.every(f => f.status === 'error')}
          className="w-full toolbar-btn toolbar-btn-primary py-3 text-sm font-bold justify-center"
        >
          {processing ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Processing Documents...</>
          ) : (
            <><Upload className="w-4 h-4" /> Create Person + Property + Dispatch Call</>
          )}
        </button>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-sm p-3 text-xs text-red-300">
          <AlertTriangle className="w-4 h-4 inline mr-1" /> {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-3">
          <div className="bg-green-900/20 border border-green-700/40 rounded-sm p-4">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <span className="text-sm font-bold text-green-400">INTAKE COMPLETE</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Person */}
              <div className="panel-beveled bg-surface-raised p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <User className="w-3.5 h-3.5 text-rmpg-400" />
                  <span className="text-[10px] text-rmpg-400 uppercase font-bold">Person Created</span>
                </div>
                <p className="text-sm font-bold text-white">
                  {result.extracted.defendant.first} {result.extracted.defendant.middle} {result.extracted.defendant.last}
                </p>
                {result.extracted.defendant.dob && <p className="text-[10px] text-rmpg-400">DOB: {result.extracted.defendant.dob}</p>}
                <button onClick={() => navigate(`/records?person=${result.defendant_person_id}`)} className="text-[9px] text-brand-400 mt-1 hover:underline">
                  View in Records →
                </button>
              </div>

              {/* Property */}
              <div className="panel-beveled bg-surface-raised p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Building2 className="w-3.5 h-3.5 text-rmpg-400" />
                  <span className="text-[10px] text-rmpg-400 uppercase font-bold">Property Created</span>
                </div>
                <p className="text-xs text-white">{result.extracted.address || 'No address'}</p>
                {result.latitude && result.longitude && (
                  <p className="text-[9px] text-green-400 mt-1">
                    <MapPin className="w-3 h-3 inline" /> {result.latitude.toFixed(6)}, {result.longitude.toFixed(6)}
                  </p>
                )}
              </div>

              {/* Call */}
              <div className="panel-beveled bg-surface-raised p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Phone className="w-3.5 h-3.5 text-rmpg-400" />
                  <span className="text-[10px] text-rmpg-400 uppercase font-bold">Dispatch Call</span>
                </div>
                <p className="text-sm font-bold text-white font-mono">{result.call_number}</p>
                <p className="text-[10px] text-rmpg-400">PSO Client Request — Pending</p>
                <button onClick={() => navigate('/dispatch')} className="text-[9px] text-brand-400 mt-1 hover:underline">
                  View in Dispatch →
                </button>
              </div>
            </div>

            {/* Quick-nav buttons */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-2 text-[10px]">
              <button onClick={() => navigate(`/records?person=${result.defendant_person_id}`)} className="toolbar-btn justify-center">
                <User className="w-3 h-3" /> Defendant
              </button>
              {result.plaintiff_person_id && (
                <button onClick={() => navigate(`/records?person=${result.plaintiff_person_id}`)} className="toolbar-btn justify-center">
                  <Building2 className="w-3 h-3" /> Plaintiff
                </button>
              )}
              {result.attorney_person_id && (
                <button onClick={() => navigate(`/records?person=${result.attorney_person_id}`)} className="toolbar-btn justify-center">
                  <User className="w-3 h-3" /> Attorney
                </button>
              )}
              <button onClick={() => navigate(`/cases?case=${result.case_id}`)} className="toolbar-btn justify-center">
                <FileText className="w-3 h-3" /> Case
              </button>
              {result.serve_queue_id && (
                <button onClick={() => navigate(`/serve?queue=${result.serve_queue_id}`)} className="toolbar-btn justify-center">
                  <Phone className="w-3 h-3" /> Serve Queue
                </button>
              )}
            </div>

            {result.warnings && result.warnings.length > 0 && (
              <div className="bg-amber-900/20 border border-amber-700/40 rounded-sm p-2 text-[10px] text-amber-300 mt-2">
                <AlertTriangle className="w-3 h-3 inline mr-1" /> Warnings:
                <ul className="list-disc list-inside">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </div>
            )}

            {result.additional_defendants && result.additional_defendants.length > 0 && (
              <div className="bg-amber-900/20 border border-amber-700/40 rounded-sm p-2 text-[10px] text-amber-300 mt-2">
                <AlertTriangle className="w-3 h-3 inline mr-1" />
                Multi-defendant detected ({result.additional_defendants.length}): {result.additional_defendants.join(', ')}.
                <p className="mt-1">To create separate serve jobs for them, re-upload with modified Field Sheet (change Party to Serve) or use bulk intake (PR-2 scope).</p>
              </div>
            )}

            {result.attachment_ids && result.attachment_ids.length > 0 && (
              <div className="panel-beveled bg-surface-raised p-3 mt-2">
                <div className="flex items-center gap-1.5 mb-2">
                  <FileText className="w-3.5 h-3.5 text-rmpg-400" />
                  <span className="text-[10px] text-rmpg-400 uppercase font-bold">Attachments Saved ({result.attachment_ids.length})</span>
                </div>
                <ul className="space-y-1">
                  {result.attachment_ids.map(id => (
                    <li key={id} className="text-[10px]">
                      <button
                        type="button"
                        className="text-brand-400 hover:underline"
                        onClick={async () => {
                          try {
                            const r = await fetch(`/api/serve-intake/calls/${result.call_id}/attachments/${id}/download`, {
                              headers: { 'Authorization': `Bearer ${localStorage.getItem('rmpg_token')}` },
                            });
                            if (!r.ok) { alert('Download failed'); return; }
                            const blob = await r.blob();
                            const url = URL.createObjectURL(blob);
                            window.open(url, '_blank');
                            setTimeout(() => URL.revokeObjectURL(url), 60_000);
                          } catch { alert('Download failed'); }
                        }}
                      >
                        View attachment #{id}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Extracted Details */}
            <div className="mt-3 pt-3 border-t border-rmpg-700 grid grid-cols-2 gap-2 text-[10px]">
              {result.extracted.court && <div><span className="text-rmpg-500">Court:</span> <span className="text-rmpg-300">{result.extracted.court}</span></div>}
              {result.extracted.plaintiff && <div><span className="text-rmpg-500">Plaintiff:</span> <span className="text-rmpg-300">{result.extracted.plaintiff.substring(0, 60)}</span></div>}
              {result.extracted.documents && <div><span className="text-rmpg-500">Documents:</span> <span className="text-rmpg-300">{result.extracted.documents}</span></div>}
              {result.extracted.clientJobNumber && <div><span className="text-rmpg-500">Case #:</span> <span className="text-rmpg-300">{result.extracted.clientJobNumber}</span></div>}
              {result.extracted.jobNumber && <div><span className="text-rmpg-500">Job #:</span> <span className="text-rmpg-300">{result.extracted.jobNumber}</span></div>}
              {result.extracted.dueDate && <div><span className="text-rmpg-500">Due:</span> <span className="text-rmpg-300">{result.extracted.dueDate}</span></div>}
              {result.extracted.attorney.name && <div><span className="text-rmpg-500">Attorney:</span> <span className="text-rmpg-300">{result.extracted.attorney.name}</span></div>}
            </div>
          </div>

          <button onClick={() => { setFiles([]); setResult(null); }} className="toolbar-btn w-full justify-center py-2">
            Process Another Set of Documents
          </button>
        </div>
      )}
    </div>
  );
}
