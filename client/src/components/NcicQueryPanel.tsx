// ============================================================
// RMPG Flex — NCIC/NLETS Query Terminal Panel
// Slide-out terminal that simulates NCIC queries against the
// local database. Black background, green monospace text.
// ============================================================

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Terminal, Loader2 } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import {
  formatPersonResponse,
  formatVehicleResponse,
  formatWarrantResponse,
  formatMvrRegistrationResponse,
  formatMvrDriverResponse,
  formatNhtsaVinResponse,
  formatFmcsaCarrierResponse,
  formatCriminalRecordsResponse,
  formatOpenCorporatesResponse,
  formatEnformionPersonResponse,
  formatEnformionPhoneResponse,
  formatNoRecord,
  type NcicPerson,
  type NcicVehicle,
  type NcicCriminalHistory,
  type NcicWarrant,
  type UtahMvrRegistration,
  type UtahMvrDriver,
  type NhtsaFullReport,
  type FmcsaCarrier,
  type CriminalSearchResult,
  type OCSearchResult,
  type EnformionSearchResult,
  type EnformionPhoneSearchResult,
} from '../utils/ncicFormatter';
import { playTone } from '../utils/dispatchTones';

interface NcicQueryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  initialQuery?: { type: 'person' | 'vehicle' | 'warrant' | 'nhtsa_vin' | 'fmcsa_carrier' | 'criminal' | 'business' | 'individual' | 'phone'; query: string } | null;
  /** When true, renders as a block element filling its parent (no overlay/close button). */
  embedded?: boolean;
}

interface QueryEntry {
  id: number;
  timestamp: string;
  command: string;
  response: string;
  hasHit: boolean;
}

let queryIdCounter = 0;

export default function NcicQueryPanel({ isOpen, onClose, initialQuery, embedded }: NcicQueryPanelProps) {
  const [input, setInput] = useState('');
  const [entries, setEntries] = useState<QueryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input when panel opens (or on mount for embedded mode)
  useEffect(() => {
    if (isOpen || embedded) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, embedded]);

  // Process initial query from command line
  useEffect(() => {
    if (initialQuery && isOpen) {
      const cmdMap: Record<string, string> = { person: 'QH', vehicle: 'QV', warrant: 'QW', nhtsa_vin: 'QN', fmcsa_carrier: 'QC', criminal: 'QX', business: 'QE', individual: 'QI', phone: 'QZ' };
      const cmd = `${cmdMap[initialQuery.type]} ${initialQuery.query}`;
      runQuery(cmd);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery, isOpen]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, loading]);

  const runQuery = useCallback(async (command: string) => {
    const parts = command.trim().split(/\s+/);
    const verb = parts[0].toUpperCase();
    const queryText = parts.slice(1).join(' ');

    if (!queryText) return;

    setLoading(true);
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });

    try {
      let response = '';
      let hasHit = false;

      switch (verb) {
        case 'QH':
        case 'QP': {
          // Person query
          const data = await apiFetch<{
            type: string;
            results: Array<{
              person: NcicPerson;
              criminalHistory: NcicCriminalHistory[];
              warrants: NcicWarrant[];
            }>;
            query: string;
          }>(`/records/ncic-query?type=person&query=${encodeURIComponent(queryText)}`);

          if (data.results.length === 0) {
            response = formatNoRecord('PERSON', queryText);
          } else {
            response = data.results
              .map(r => formatPersonResponse(r.person, r.criminalHistory, r.warrants))
              .join('\n\n');
            hasHit = true;

            // Check for warrants — play warning tone
            const hasWarrants = data.results.some(r => r.warrants.length > 0);
            if (hasWarrants) {
              playTone('warning');
            } else {
              playTone('info');
            }
          }
          break;
        }

        case 'QV': {
          // Vehicle query
          const data = await apiFetch<{
            type: string;
            results: NcicVehicle[];
            query: string;
          }>(`/records/ncic-query?type=vehicle&query=${encodeURIComponent(queryText)}`);

          if (data.results.length === 0) {
            response = formatNoRecord('VEHICLE', queryText);
          } else {
            response = data.results.map(v => formatVehicleResponse(v)).join('\n\n');
            hasHit = true;

            // Check for stolen — play warning
            const hasStolen = data.results.some(v => v.is_stolen);
            if (hasStolen) {
              playTone('warning');
            } else {
              playTone('info');
            }
          }
          break;
        }

        case 'QW': {
          // Warrant query
          const data = await apiFetch<{
            type: string;
            results: (NcicWarrant & {
              subject_first_name?: string;
              subject_last_name?: string;
              subject_dob?: string;
            })[];
            query: string;
          }>(`/records/ncic-query?type=warrant&query=${encodeURIComponent(queryText)}`);

          response = formatWarrantResponse(data.results, queryText);
          hasHit = data.results.length > 0;
          if (hasHit) playTone('warning');
          break;
        }

        case 'QR': {
          // Utah MVR — Vehicle registration by plate
          const data = await apiFetch<{
            type: string;
            query: string;
            hit: boolean;
            data: UtahMvrRegistration | null;
          }>(`/utah-mvr/query/registration?plate=${encodeURIComponent(queryText)}&state=UT`);

          if (!data.hit || !data.data) {
            response = formatNoRecord('UT-REGISTRATION', queryText);
          } else {
            response = formatMvrRegistrationResponse(data.data);
            hasHit = true;

            // Check for flags
            if (data.data.flags && data.data.flags.length > 0) {
              playTone('warning');
            } else {
              playTone('info');
            }
          }
          break;
        }

        case 'QD': {
          // Utah MVR — Driver record by DL number
          const data = await apiFetch<{
            type: string;
            query: string;
            hit: boolean;
            data: UtahMvrDriver | null;
          }>(`/utah-mvr/query/driver?dl=${encodeURIComponent(queryText)}`);

          if (!data.hit || !data.data) {
            response = formatNoRecord('UT-DRIVER', queryText);
          } else {
            response = formatMvrDriverResponse(data.data);
            hasHit = true;

            // Check for suspended/revoked license or suspensions
            const dlStatus = data.data.dl_status?.toUpperCase() || '';
            if (dlStatus !== 'VALID' && dlStatus !== 'ACTIVE' && dlStatus) {
              playTone('warning');
            } else if (data.data.suspensions && data.data.suspensions.length > 0) {
              playTone('warning');
            } else {
              playTone('info');
            }
          }
          break;
        }

        case 'QN': {
          // NHTSA — Full VIN report (decode + recalls + complaints)
          const nhtsaData = await apiFetch<{
            success: boolean;
            data: NhtsaFullReport;
            error?: string;
          }>(`/mvr/nhtsa/report/${encodeURIComponent(queryText)}`);

          if (!nhtsaData.success || !nhtsaData.data?.vehicle?.make) {
            response = nhtsaData.error
              ? `ERROR: ${nhtsaData.error}`
              : formatNoRecord('NHTSA-VIN', queryText);
          } else {
            response = formatNhtsaVinResponse(nhtsaData.data);
            hasHit = true;

            // Play warning for safety recalls or fire risk
            if (nhtsaData.data.hasParkItRecall || nhtsaData.data.hasFireRisk) {
              playTone('warning');
            } else if (nhtsaData.data.recallCount > 0) {
              playTone('info');
            } else {
              playTone('info');
            }
          }
          break;
        }

        case 'QC': {
          // FMCSA — Carrier lookup by DOT number
          const fmcsaData = await apiFetch<{
            success: boolean;
            data: FmcsaCarrier;
            error?: string;
          }>(`/mvr/fmcsa/carrier/${encodeURIComponent(queryText)}`);

          if (!fmcsaData.success || !fmcsaData.data?.legalName) {
            response = fmcsaData.error
              ? `ERROR: ${fmcsaData.error}`
              : formatNoRecord('FMCSA-CARRIER', queryText);
          } else {
            response = formatFmcsaCarrierResponse(fmcsaData.data);
            hasHit = true;

            // Warn on out-of-service carriers
            if (fmcsaData.data.oosDate || fmcsaData.data.oosReason) {
              playTone('warning');
            } else {
              playTone('info');
            }
          }
          break;
        }

        case 'QX': {
          // Criminal Records — search by name
          const crimData = await apiFetch<CriminalSearchResult>(
            `/mvr/criminal/search/${encodeURIComponent(queryText)}`
          );

          if (!crimData.success) {
            response = crimData.error
              ? `ERROR: ${crimData.error}`
              : formatNoRecord('CRIMINAL-RECORDS', queryText);
          } else {
            response = formatCriminalRecordsResponse(crimData);
            hasHit = crimData.totalRecords > 0;

            // Warn on sex offender or warrant hits
            const hasSexOffender = crimData.records?.some(r => r.source === 'sex_offender');
            const hasWarrant = crimData.records?.some(r => r.source === 'arrest_warrants');
            if (hasSexOffender || hasWarrant) {
              playTone('warning');
            } else if (hasHit) {
              playTone('info');
            }
          }
          break;
        }

        case 'QE': {
          // Business entity lookup (OpenCorporates)
          const ocData = await apiFetch<OCSearchResult>(
            `/mvr/opencorporates/companies/${encodeURIComponent(queryText)}`
          );

          if (!ocData.success) {
            response = ocData.error
              ? `ERROR: ${ocData.error}`
              : formatNoRecord('BUSINESS-ENTITY', queryText);
          } else {
            response = formatOpenCorporatesResponse(ocData);
            hasHit = ocData.totalCount > 0;
            if (hasHit) playTone('info');
          }
          break;
        }

        case 'QI': {
          // Individual person lookup (Enformion)
          const enData = await apiFetch<EnformionSearchResult>(
            `/mvr/enformion/person/${encodeURIComponent(queryText)}`
          );

          if (!enData.success) {
            response = enData.error
              ? `ERROR: ${enData.error}`
              : formatNoRecord('INDIVIDUAL', queryText);
          } else {
            response = formatEnformionPersonResponse(enData);
            hasHit = enData.totalCount > 0;

            // Check for criminal indicators
            const hasCriminal = enData.persons?.some(p => p.indicators?.criminal);
            if (hasCriminal) {
              playTone('warning');
            } else if (hasHit) {
              playTone('info');
            }
          }
          break;
        }

        case 'QZ': {
          // Reverse phone lookup (Enformion)
          const phoneData = await apiFetch<EnformionPhoneSearchResult>(
            `/mvr/enformion/phone/${encodeURIComponent(queryText)}`
          );

          if (!phoneData.success) {
            response = phoneData.error
              ? `ERROR: ${phoneData.error}`
              : formatNoRecord('REVERSE-PHONE', queryText);
          } else {
            response = formatEnformionPhoneResponse(phoneData);
            hasHit = phoneData.totalCount > 0;
            if (hasHit) playTone('info');
          }
          break;
        }

        default:
          response = `UNKNOWN QUERY TYPE: ${verb}\nValid: QH (person), QV (vehicle), QW (warrant), QN (NHTSA VIN), QC (FMCSA DOT#), QX (criminal), QE (business), QI (individual), QZ (phone), QR (UT reg), QD (UT driver)`;
      }

      setEntries(prev => [...prev, {
        id: ++queryIdCounter,
        timestamp,
        command,
        response,
        hasHit,
      }]);
    } catch (err: any) {
      setEntries(prev => [...prev, {
        id: ++queryIdCounter,
        timestamp,
        command,
        response: `ERROR: ${err.message || 'Query failed'}`,
        hasHit: false,
      }]);
      playTone('error');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSubmit = useCallback(() => {
    if (!input.trim() || loading) return;
    const cmd = input.trim();
    setInput('');
    runQuery(cmd);
  }, [input, loading, runQuery]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  }, [handleSubmit, onClose]);

  if (!isOpen && !embedded) return null;

  // ── Shared terminal content (used in both modes) ──
  const terminalContent = (
    <>
      <div className="ncic-output" ref={scrollRef}>
        {entries.length === 0 && !loading && (
          <div className="ncic-welcome">
            <pre>{`╔══════════════════════════════════════════════╗
║      NCIC / NLETS QUERY TERMINAL             ║
║      RMPG FLEX LAW ENFORCEMENT CAD           ║
╠══════════════════════════════════════════════╣
║  LOCAL DATABASE:                             ║
║  QH <name>      Query Person / History       ║
║  QV <plate>     Query Vehicle                ║
║  QW <name>      Query Warrants               ║
╠══════════════════════════════════════════════╣
║  FEDERAL / EXTERNAL (LIVE):                  ║
║  QN <VIN>       NHTSA VIN Report + Recalls   ║
║  QC <DOT#>      FMCSA Carrier Safety Lookup  ║
║  QX <name>      Criminal Records Search      ║
║  QE <company>   Business Entity Lookup       ║
║  QI <name>      Individual Person (Enformion)║
║  QZ <phone>     Reverse Phone (Enformion)    ║
╠══════════════════════════════════════════════╣
║  UTAH DLD (requires credentials):            ║
║  QR <plate>     UT Vehicle Registration      ║
║  QD <dl#>       UT Driver Record             ║
╚══════════════════════════════════════════════╝`}</pre>
          </div>
        )}

        {entries.map(entry => (
          <div key={entry.id} className="ncic-entry">
            <div className="ncic-entry-cmd">
              <span className="ncic-timestamp">[{entry.timestamp}]</span>
              <span className="ncic-cmd-text">&gt; {entry.command}</span>
            </div>
            <pre className={`ncic-entry-response ${entry.hasHit ? 'ncic-hit' : ''}`}>
              {entry.response}
            </pre>
          </div>
        ))}

        {loading && (
          <div className="ncic-loading">
            <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" />
            <span className="animate-pulse">SEARCHING...</span>
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="ncic-input-row">
        <span className="ncic-prompt">&gt;</span>
        <input
          ref={inputRef}
          type="text"
          className="ncic-input"
          value={input}
          onChange={e => setInput(e.target.value.toUpperCase())}
          onKeyDown={handleKeyDown}
          placeholder="QH SMITH | QV ABC1234 | QN 1HGCM82... | QI DOE | QZ 3855551234 | QE ACME"
          spellCheck={false}
          autoComplete="off"
          disabled={loading}
        />
      </div>
    </>
  );

  // ── Embedded mode: render terminal directly without overlay ──
  if (embedded) {
    return (
      <div className="ncic-panel ncic-embedded">
        {terminalContent}
      </div>
    );
  }

  // ── Overlay mode (default): slide-out panel with backdrop ──
  return (
    <div className="ncic-panel-overlay" onClick={onClose}>
      <div className="ncic-panel" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="ncic-header">
          <div className="flex items-center gap-2">
            <Terminal style={{ width: 14, height: 14, color: '#d4a017' }} />
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: '#d4a017' }}>
              NCIC / NLETS Terminal
            </span>
          </div>
          <button onClick={onClose} className="ncic-close-btn">
            <X style={{ width: 14, height: 14 }} />
          </button>
        </div>
        {terminalContent}
      </div>
    </div>
  );
}
