import React, { useState, useCallback } from 'react';
import { X, CreditCard, AlertTriangle, CheckCircle, ChevronRight, Loader2 } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useToast } from './ToastProvider';
import type { Person } from '../types';
import type { AamvaResult, ScanAlert, ReadoutRow } from '../utils/aamvaParser';

// Lazy-loaded to keep the Records page initial bundle lean.
type AamvaParserModule = typeof import('../utils/aamvaParser');
const loadParser = (): Promise<AamvaParserModule> => import('../utils/aamvaParser');

type Step = 'scan' | 'preview' | 'importing';

interface DlScanImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImported: (person: Person, personCreated: boolean) => void;
}

const ALERT_STYLE: Record<string, string> = {
  EXPIRED:         'bg-red-900/30 border-red-600/50 text-red-300',
  EXPIRING:        'bg-amber-900/30 border-amber-600/50 text-amber-300',
  MINOR:           'bg-red-900/40 border-red-500/60 text-red-200',
  UNDER_21:        'bg-amber-900/30 border-amber-500/50 text-amber-200',
  ID_CARD:         'bg-blue-900/30 border-blue-600/50 text-blue-300',
  LIMITED_DURATION:'bg-purple-900/30 border-purple-600/50 text-purple-300',
  NOT_REAL_ID:     'bg-orange-900/30 border-orange-600/50 text-orange-300',
};

export default function DlScanImportModal({ isOpen, onClose, onImported }: DlScanImportModalProps) {
  const { addToast } = useToast();
  const [step, setStep] = useState<Step>('scan');
  const [parsed, setParsed] = useState<AamvaResult | null>(null);
  const [alerts, setAlerts] = useState<ScanAlert[]>([]);
  const [readout, setReadout] = useState<ReadoutRow[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [manualText, setManualText] = useState('');

  // LiveDlScanner is loaded lazily inside the dynamic import block too
  const [LiveDlScanner, setLiveDlScanner] = useState<React.ComponentType<{
    onComplete: (r: { barcodeText: string | null; frontImage: Blob | null; backImage: Blob | null }) => void;
    onClose: () => void;
    onUploadInstead: () => void;
  }> | null>(null);

  const loadScanner = useCallback(() => {
    if (LiveDlScanner) return;
    import('./LiveDlScanner').then((m) => setLiveDlScanner(() => m.default));
  }, [LiveDlScanner]);

  // Called when LiveDlScanner or manual entry produces raw barcode text
  const handleBarcodeText = useCallback(async (raw: string) => {
    setScanError(null);
    try {
      const { parseAamva, assessAamva, describeAamva, looksLikeAamva,
               describeRestrictions, describeEndorsements } = await loadParser();
      if (!looksLikeAamva(raw)) {
        setScanError('Barcode decoded but does not appear to be a valid AAMVA driver\'s license. Try again or enter data manually.');
        return;
      }
      const result = parseAamva(raw);
      // Store plain-English descriptions for restrictions/endorsements
      const withDescriptions: AamvaResult = {
        ...result,
        dl_restrictions: describeRestrictions(result.dl_restrictions),
        dl_endorsements: describeEndorsements(result.dl_endorsements),
      };
      setParsed(withDescriptions);
      setAlerts(assessAamva(result));
      setReadout(describeAamva(result));
      setStep('preview');
    } catch (err) {
      setScanError('Failed to parse barcode. Try manual entry.');
      console.error('[DlScanImportModal] parse failed:', err);
    }
  }, []);

  const handleScanComplete = useCallback(async (result: { barcodeText: string | null }) => {
    if (!result.barcodeText) {
      setScanError('No barcode data captured. Try again.');
      return;
    }
    await handleBarcodeText(result.barcodeText);
  }, [handleBarcodeText]);

  const handleManualSubmit = useCallback(async () => {
    if (!manualText.trim()) return;
    await handleBarcodeText(manualText.trim());
  }, [manualText, handleBarcodeText]);

  const handleImport = useCallback(async () => {
    if (!parsed) return;
    setStep('importing');
    try {
      const resp = await apiFetch<{
        person: Record<string, unknown>;
        person_created: boolean;
        vehicle: unknown;
        property: unknown;
      }>('/records/from-dl-scan', {
        method: 'POST',
        body: JSON.stringify({
          scan: {
            first_name:      parsed.first_name,
            middle_name:     parsed.middle_name,
            last_name:       parsed.last_name,
            date_of_birth:   parsed.date_of_birth,
            gender:          parsed.gender,
            height:          parsed.height,
            weight:          parsed.weight,
            eye_color:       parsed.eye_color,
            hair_color:      parsed.hair_color,
            address:         parsed.address,
            city:            parsed.city,
            state:           parsed.state,
            zip:             parsed.zip,
            dl_number:       parsed.dl_number,
            dl_state:        parsed.dl_state,
            dl_class:        parsed.dl_class,
            dl_expiry:       parsed.dl_expiry,
            dl_issue_date:   parsed.dl_issue_date,
            dl_restrictions: parsed.dl_restrictions,
            dl_endorsements: parsed.dl_endorsements,
          },
        }),
      });
      if (!resp?.person) throw new Error('No person returned');
      // Map server row → Person shape (same fields PersonsTab uses)
      const p = resp.person as Record<string, unknown>;
      const person: Person = {
        id: String(p.id ?? ''),
        first_name: String(p.first_name ?? ''),
        last_name: String(p.last_name ?? ''),
        middle_name: p.middle_name ? String(p.middle_name) : undefined,
        date_of_birth: p.dob ? String(p.dob) : undefined,
        gender: p.gender ? String(p.gender) : undefined,
        height: p.height ? String(p.height) : undefined,
        weight: p.weight ? String(p.weight) : undefined,
        eye_color: p.eye_color ? String(p.eye_color) : undefined,
        hair_color: p.hair_color ? String(p.hair_color) : undefined,
        address: p.address ? String(p.address) : undefined,
        city: p.city ? String(p.city) : undefined,
        state: p.state ? String(p.state) : undefined,
        zip: p.zip ? String(p.zip) : undefined,
        dl_number: p.dl_number ? String(p.dl_number) : undefined,
        dl_state: p.dl_state ? String(p.dl_state) : undefined,
        dl_expiry: p.dl_expiry ? String(p.dl_expiry) : undefined,
        dl_class: p.dl_class ? String(p.dl_class) : undefined,
        dl_issue_date: p.dl_issue_date ? String(p.dl_issue_date) : undefined,
        dl_restrictions: p.dl_restrictions ? String(p.dl_restrictions) : undefined,
        dl_endorsements: p.dl_endorsements ? String(p.dl_endorsements) : undefined,
        flags: [],
        incident_ids: [],
        created_at: String(p.created_at ?? ''),
        updated_at: String(p.updated_at ?? ''),
      };
      onImported(person, resp.person_created);
      handleReset();
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : 'Import failed', 'error');
      setStep('preview');
    }
  }, [parsed, addToast, onImported]);

  const handleReset = useCallback(() => {
    setStep('scan');
    setParsed(null);
    setAlerts([]);
    setReadout([]);
    setScanError(null);
    setManualText('');
  }, []);

  const handleClose = useCallback(() => {
    handleReset();
    onClose();
  }, [handleReset, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col bg-surface-base border border-border-default shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-default bg-surface-raised flex-shrink-0">
          <div className="flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-brand-400" />
            <span className="text-[12px] font-bold uppercase tracking-wider text-rmpg-100">
              {step === 'scan' ? 'Scan Driver\'s License' :
               step === 'preview' ? 'DL Barcode — Preview' :
               'Importing to Records…'}
            </span>
          </div>
          <button type="button" onClick={handleClose} className="p-1 text-rmpg-500 hover:text-rmpg-200 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">

          {/* ── STEP 1: Scan ── */}
          {step === 'scan' && (
            <div className="p-4 space-y-4">
              {/* Camera scan */}
              <div className="border border-border-default bg-surface-sunken p-3">
                <p className="text-[11px] text-rmpg-400 mb-3">Point the camera at the PDF417 barcode on the back of the driver's license. The barcode is the large 2D symbol at the bottom.</p>
                {!LiveDlScanner ? (
                  <button
                    type="button"
                    onClick={loadScanner}
                    className="w-full py-3 bg-brand-400/10 border border-brand-400/40 text-brand-400 text-[11px] font-bold uppercase tracking-wider hover:bg-brand-400/20 transition-colors flex items-center justify-center gap-2"
                  >
                    <CreditCard className="w-4 h-4" />
                    Open Camera Scanner
                  </button>
                ) : (
                  <div className="h-72">
                    <LiveDlScanner
                      onComplete={handleScanComplete}
                      onClose={() => setLiveDlScanner(null)}
                      onUploadInstead={() => { /* manual entry below */ }}
                    />
                  </div>
                )}
              </div>

              {/* Manual / paste entry */}
              <div className="border border-border-default bg-surface-sunken p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-rmpg-400 mb-2">Or paste raw barcode data</p>
                <textarea
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                  className="w-full h-20 bg-surface-base border border-border-default text-[11px] text-rmpg-200 font-mono p-2 resize-none focus:outline-none focus:border-brand-400/60"
                  placeholder="@ANSI 636049..."
                />
                <button
                  type="button"
                  onClick={handleManualSubmit}
                  disabled={!manualText.trim()}
                  className="mt-2 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider bg-brand-400/10 border border-brand-400/40 text-brand-400 hover:bg-brand-400/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Parse Barcode
                </button>
              </div>

              {scanError && (
                <div className="flex items-start gap-2 p-3 bg-red-900/20 border border-red-700/40 text-red-300 text-[11px]">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  {scanError}
                </div>
              )}
            </div>
          )}

          {/* ── STEP 2: Preview ── */}
          {step === 'preview' && parsed && (
            <div className="p-4 space-y-4">
              {/* Scan Alerts */}
              {alerts.length > 0 && (
                <div className="space-y-1.5">
                  {alerts.map((a, i) => (
                    <div key={i} className={`flex items-start gap-2 px-3 py-2 border text-[11px] font-medium ${ALERT_STYLE[a.code] || 'bg-amber-900/20 border-amber-600/40 text-amber-300'}`}>
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      {a.message}
                    </div>
                  ))}
                </div>
              )}

              {/* Primary identity */}
              <div className="bg-surface-raised border border-border-default p-3">
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <p className="text-[14px] font-bold text-rmpg-100">
                      {parsed.first_name} {parsed.middle_name && `${parsed.middle_name} `}{parsed.last_name}
                    </p>
                    <p className="text-[11px] text-rmpg-400 mt-0.5">
                      DOB: <span className="text-rmpg-200">{parsed.date_of_birth || '—'}</span>
                      {parsed.gender && <> · {parsed.gender}</>}
                    </p>
                    {parsed.address && (
                      <p className="text-[11px] text-rmpg-400 mt-0.5">
                        {parsed.address}, {parsed.city}, {parsed.state} {parsed.zip}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-[9px] font-bold uppercase text-rmpg-500 tracking-wider mb-0.5">
                      {parsed.card_type === 'ID' ? 'State ID' : 'DL'} · {parsed.dl_state}
                    </p>
                    <p className="text-[12px] font-mono font-bold text-rmpg-100">{parsed.dl_number}</p>
                    {parsed.dl_class && (
                      <p className="text-[10px] text-rmpg-400">Class {parsed.dl_class}</p>
                    )}
                    {parsed.dl_expiry && (
                      <p className="text-[10px] text-rmpg-400">Exp: {parsed.dl_expiry}</p>
                    )}
                    {parsed.dl_issue_date && (
                      <p className="text-[10px] text-rmpg-400">Iss: {parsed.dl_issue_date}</p>
                    )}
                  </div>
                </div>

                {/* Restrictions / Endorsements */}
                {(parsed.dl_restrictions || parsed.dl_endorsements) && (
                  <div className="mt-2 pt-2 border-t border-border-default space-y-1">
                    {parsed.dl_restrictions && (
                      <p className="text-[10px] text-rmpg-400">
                        <span className="font-bold text-rmpg-300">Restrictions: </span>{parsed.dl_restrictions}
                      </p>
                    )}
                    {parsed.dl_endorsements && (
                      <p className="text-[10px] text-rmpg-400">
                        <span className="font-bold text-rmpg-300">Endorsements: </span>{parsed.dl_endorsements}
                      </p>
                    )}
                  </div>
                )}

                {/* Physical description */}
                <div className="mt-2 pt-2 border-t border-border-default flex flex-wrap gap-x-4 gap-y-0.5">
                  {parsed.height && <span className="text-[10px] text-rmpg-400">Ht: <span className="text-rmpg-200">{parsed.height}</span></span>}
                  {parsed.weight && <span className="text-[10px] text-rmpg-400">Wt: <span className="text-rmpg-200">{parsed.weight}</span></span>}
                  {parsed.eye_color && <span className="text-[10px] text-rmpg-400">Eyes: <span className="text-rmpg-200">{parsed.eye_color}</span></span>}
                  {parsed.hair_color && <span className="text-[10px] text-rmpg-400">Hair: <span className="text-rmpg-200">{parsed.hair_color}</span></span>}
                  {parsed.is_real_id && <span className="text-[10px] font-bold text-green-400">REAL ID ✓</span>}
                  {parsed.is_veteran && <span className="text-[10px] font-bold text-blue-400">VETERAN ✓</span>}
                </div>
              </div>

              {/* Full AAMVA readout (collapsible) */}
              <details className="border border-border-default">
                <summary className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-rmpg-400 cursor-pointer hover:bg-surface-raised select-none flex items-center gap-1">
                  <ChevronRight className="w-3 h-3" />
                  Full AAMVA Element Readout ({readout.length} fields)
                </summary>
                <div className="divide-y divide-border-default/40 max-h-48 overflow-y-auto">
                  {readout.map((row, i) => (
                    <div key={i} className="flex gap-2 px-3 py-1">
                      <span className="text-[9px] text-rmpg-500 w-28 flex-shrink-0 pt-0.5">{row.label}</span>
                      <span className="text-[10px] text-rmpg-200 font-mono">{row.value || '—'}</span>
                    </div>
                  ))}
                </div>
              </details>

              <p className="text-[10px] text-rmpg-500">
                Importing will create a new person record — or link to an existing record if the DL number or name+DOB already exists in the database.
              </p>
            </div>
          )}

          {/* ── STEP 3: Importing ── */}
          {step === 'importing' && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
              <p className="text-[12px] text-rmpg-400">Creating person record…</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border-default bg-surface-raised flex-shrink-0">
          {step === 'preview' ? (
            <>
              <button type="button" onClick={handleReset} className="px-3 py-1.5 text-[11px] text-rmpg-400 hover:text-rmpg-200 border border-border-default hover:border-rmpg-500 transition-colors">
                ← Scan Again
              </button>
              <button
                type="button"
                onClick={handleImport}
                className="px-5 py-1.5 text-[11px] font-bold uppercase tracking-wider bg-brand-400 text-surface-base hover:bg-brand-300 transition-colors flex items-center gap-1.5"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                Import to Records
              </button>
            </>
          ) : (
            <button type="button" onClick={handleClose} className="px-3 py-1.5 text-[11px] text-rmpg-400 hover:text-rmpg-200 border border-border-default hover:border-rmpg-500 transition-colors">
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
