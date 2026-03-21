// ============================================================
// RMPG Flex — NCIC/NLETS Query Terminal Panel
// Slide-out terminal that simulates NCIC queries against the
// local database. Black background, green monospace text.
// ============================================================

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Terminal, Loader2 } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { openUtahCourtsXChange } from '../utils/xchange';
import {
  formatPersonResponse,
  formatVehicleResponse,
  formatWarrantResponse,
  formatDlResponse,
  formatOfacResponse,
  formatCrossReferenceResponse,
  formatAddressResponse,
  formatNoRecord,
  getNcicLineClass,
  type NcicPerson,
  type NcicVehicle,
  type NcicCriminalHistory,
  type NcicWarrant,
  type NcicDlSubject,
  type NcicOfacSubject,
  type CrossReferenceResults,
  type AddressLookupResults,
} from '../utils/ncicFormatter';
import { playTone } from '../utils/dispatchTones';

interface NcicQueryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  initialQuery?: { type: 'person' | 'vehicle' | 'warrant'; query: string } | null;
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

/** Render NCIC response text with per-line semantic coloring and inline field-label highlighting */
function renderColorizedResponse(text: string): React.ReactNode {
  return text.split('\n').map((line, i) => {
    const lineClass = getNcicLineClass(line);

    // Lines with a special classification — render entirely in that color
    if (lineClass) {
      return <React.Fragment key={i}><span className={lineClass}>{line}</span>{'\n'}</React.Fragment>;
    }

    // Empty lines
    if (!line.trim()) {
      return <React.Fragment key={i}>{'\n'}</React.Fragment>;
    }

    // Normal data lines — highlight field-label codes (NAM/, DOB/, etc.) inline
    const parts = line.split(/([A-Z]{2,5}\/)/g);
    if (parts.length <= 1) {
      // No field labels found — plain amber text
      return <React.Fragment key={i}>{line}{'\n'}</React.Fragment>;
    }

    return (
      <React.Fragment key={i}>
        {parts.map((part, j) =>
          /^[A-Z]{2,5}\/$/.test(part)
            ? <span key={j} className="ncic-c-label">{part}</span>
            : <React.Fragment key={j}>{part}</React.Fragment>
        )}
        {'\n'}
      </React.Fragment>
    );
  });
}

export default function NcicQueryPanel({ isOpen, onClose, initialQuery, embedded }: NcicQueryPanelProps) {
  const [input, setInput] = useState('');
  const [entries, setEntries] = useState<QueryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Process initial query from command line
  useEffect(() => {
    if (initialQuery && isOpen) {
      const cmdMap: Record<string, string> = { person: 'QH', vehicle: 'QV', warrant: 'QW', dl: 'QD', ofac: 'QO' };
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

        case 'QD':
        case 'QL': {
          // Check for ADD subcommand
          if (queryText.toUpperCase().startsWith('ADD')) {
            response = [
              '*** DL MANUAL ENTRY ***',
              '',
              '  Navigate to Records > DL Search and click "Manual Entry"',
              '  to add a DL record from a physical license.',
              '',
              '*** END ***',
            ].join('\n');
            hasHit = false;
            break;
          }

          // Driver's License query
          // Parse: QD SMITH, JOHN UT  |  QD D12345678 UT  |  QD SMITH
          const dlParts = queryText.split(/[,\s]+/).filter(Boolean);
          const body: any = {};

          // Check if last token is a 2-letter state code
          const lastToken = dlParts[dlParts.length - 1];
          if (dlParts.length >= 2 && /^[A-Z]{2}$/.test(lastToken)) {
            body.state = lastToken;
            dlParts.pop();
          }

          // If single token with digits, treat as DL number; otherwise treat as name
          if (dlParts.length === 1 && /\d/.test(dlParts[0])) {
            body.dlNumber = dlParts[0];
          } else if (dlParts.length >= 2) {
            body.lastName = dlParts[0];
            body.firstName = dlParts.slice(1).join(' ');
          } else if (dlParts.length === 1) {
            body.lastName = dlParts[0];
          }

          const dlData = await apiFetch<{
            hit: boolean;
            source: string;
            subjects: NcicDlSubject[];
            resultCount: number;
          }>('/microbilt/dl/search', {
            method: 'POST',
            body: JSON.stringify(body),
          });

          if (!dlData.hit || dlData.subjects.length === 0) {
            response = formatNoRecord('DL SEARCH', queryText);
          } else {
            response = formatDlResponse(dlData.subjects, queryText);
            hasHit = true;
            playTone('info');
          }
          break;
        }

        case 'QO': {
          // OFAC / SDN watchlist query
          // Parse: QO AL QAIDA  |  QO SMITH, JOHN
          const ofacBody: any = {};
          if (queryText.includes(',')) {
            const [last, first] = queryText.split(',').map(s => s.trim());
            ofacBody.lastName = last;
            ofacBody.firstName = first;
          } else {
            ofacBody.fullName = queryText;
          }

          const ofacData = await apiFetch<{
            hit: boolean;
            sources: string[];
            subjects: NcicOfacSubject[];
            resultCount: number;
          }>('/microbilt/ofac/search', {
            method: 'POST',
            body: JSON.stringify(ofacBody),
          });

          if (!ofacData.hit || ofacData.subjects.length === 0) {
            response = formatNoRecord('OFAC WATCHLIST', queryText);
          } else {
            response = formatOfacResponse(ofacData.subjects, queryText);
            hasHit = true;
            playTone('warning');
          }
          break;
        }

        case 'QX': {
          // Cross-reference — fan out to ALL data sources in parallel
          // Parse name: "LAST, FIRST" or "LAST FIRST" or just "LAST"
          const xrefBody: any = {};
          if (queryText.includes(',')) {
            const [last, first] = queryText.split(',').map(s => s.trim());
            xrefBody.lastName = last;
            xrefBody.firstName = first;
          } else {
            const nameParts = queryText.trim().split(/\s+/);
            xrefBody.lastName = nameParts[0];
            if (nameParts.length > 1) xrefBody.firstName = nameParts.slice(1).join(' ');
          }

          // Fire all 4 queries in parallel — allSettled so one failure doesn't block others
          const [personResult, warrantResult, dlResult, ofacResult] = await Promise.allSettled([
            apiFetch<{ results: Array<{ person: NcicPerson; criminalHistory: NcicCriminalHistory[]; warrants: NcicWarrant[] }> }>(
              `/records/ncic-query?type=person&query=${encodeURIComponent(queryText)}`
            ),
            apiFetch<{ results: (NcicWarrant & { subject_first_name?: string; subject_last_name?: string; subject_dob?: string })[] }>(
              `/records/ncic-query?type=warrant&query=${encodeURIComponent(queryText)}`
            ),
            apiFetch<{ hit: boolean; subjects: NcicDlSubject[] }>(
              '/microbilt/dl/search',
              { method: 'POST', body: JSON.stringify(xrefBody) }
            ),
            apiFetch<{ hit: boolean; subjects: NcicOfacSubject[] }>(
              '/microbilt/ofac/search',
              { method: 'POST', body: JSON.stringify(xrefBody.firstName ? { lastName: xrefBody.lastName, firstName: xrefBody.firstName } : { fullName: queryText }) }
            ),
          ]);

          // Collect results, track errors
          const xref: CrossReferenceResults = {
            persons: [], directWarrants: [], dlSubjects: [], ofacSubjects: [], errors: [],
          };

          if (personResult.status === 'fulfilled') {
            xref.persons = personResult.value.results || [];
          } else {
            xref.errors.push('PERSON QUERY FAILED');
          }

          // Deduplicate warrants already shown via person records
          const personWarrantNums = new Set(
            xref.persons.flatMap(r => r.warrants.map(w => w.warrant_number))
          );
          if (warrantResult.status === 'fulfilled') {
            xref.directWarrants = (warrantResult.value.results || []).filter(
              w => !personWarrantNums.has(w.warrant_number)
            );
          } else {
            xref.errors.push('WARRANT QUERY FAILED');
          }

          if (dlResult.status === 'fulfilled') {
            xref.dlSubjects = dlResult.value.subjects || [];
          } else {
            xref.errors.push('DL QUERY FAILED');
          }

          if (ofacResult.status === 'fulfilled') {
            xref.ofacSubjects = ofacResult.value.subjects || [];
          } else {
            xref.errors.push('OFAC QUERY FAILED');
          }

          response = formatCrossReferenceResponse(xref, queryText);
          hasHit = xref.persons.length > 0 || xref.directWarrants.length > 0 ||
                   xref.dlSubjects.length > 0 || xref.ofacSubjects.length > 0;

          // Play appropriate tone based on severity
          const xrefHasWarrants = xref.persons.some(r => r.warrants.length > 0) || xref.directWarrants.length > 0;
          const xrefHasOfac = xref.ofacSubjects.length > 0;
          if (xrefHasWarrants || xrefHasOfac) {
            playTone('warning');
          } else if (hasHit) {
            playTone('info');
          }
          break;
        }

        case 'QT': {
          // Phone number query — searches persons by phone
          const phoneData = await apiFetch<{
            type: string;
            results: Array<{
              person: NcicPerson;
              criminalHistory: NcicCriminalHistory[];
              warrants: NcicWarrant[];
            }>;
            query: string;
          }>(`/records/ncic-query?type=phone&query=${encodeURIComponent(queryText)}`);

          if (phoneData.results.length === 0) {
            response = formatNoRecord('PHONE', queryText);
          } else {
            response = phoneData.results
              .map(r => formatPersonResponse(r.person, r.criminalHistory, r.warrants))
              .join('\n\n');
            hasHit = true;

            const hasWarrants = phoneData.results.some(r => r.warrants.length > 0);
            if (hasWarrants) {
              playTone('warning');
            } else {
              playTone('info');
            }
          }
          break;
        }

        case 'QC': {
          // Utah Courts Xchange — opens browser tab with pre-filled search
          let courtLast = queryText.trim();
          let courtFirst: string | undefined;
          if (queryText.includes(',')) {
            const [l, f] = queryText.split(',').map(s => s.trim());
            courtLast = l;
            courtFirst = f || undefined;
          }
          openUtahCourtsXChange({ lastName: courtLast, firstName: courtFirst });
          const courtUrl = `https://www.utcourts.gov/xchange/CaseSearch?lastName=${encodeURIComponent(courtLast)}${courtFirst ? `&firstName=${encodeURIComponent(courtFirst)}` : ''}`;

          response = [
            '*** UTAH COURTS XCHANGE ***',
            '',
            `  OPENING BROWSER: ${courtUrl}`,
            `  SEARCH TERM: ${queryText.toUpperCase()}`,
            '',
            '  NOTE: Court records displayed in browser.',
            '  To save findings, use Criminal History > Add Record.',
            '',
            '*** END ***',
          ].join('\n');
          hasHit = true;
          break;
        }

        case 'QA': {
          // Address lookup — searches persons, calls, properties, trespass orders
          const addrData = await apiFetch<{
            type: string;
            persons: (NcicPerson & { active_warrants?: number })[];
            calls: any[];
            properties: any[];
            trespassOrders: any[];
            query: string;
          }>(`/records/ncic-query?type=address&query=${encodeURIComponent(queryText)}`);

          const addrResults: AddressLookupResults = {
            persons: addrData.persons || [],
            calls: addrData.calls || [],
            properties: addrData.properties || [],
            trespassOrders: addrData.trespassOrders || [],
          };

          const addrHasData = addrResults.persons.length > 0 || addrResults.calls.length > 0 ||
                              addrResults.properties.length > 0 || addrResults.trespassOrders.length > 0;

          if (!addrHasData) {
            response = formatNoRecord('ADDRESS', queryText);
          } else {
            response = formatAddressResponse(addrResults, queryText);
            hasHit = true;

            // Warning tone if warrants, trespass orders, or armed/DV history
            const addrHasWarnings = addrResults.persons.some(p => (p.active_warrants || 0) > 0) ||
              addrResults.trespassOrders.length > 0 ||
              addrResults.calls.some(c => c.weapons_involved || c.domestic_violence);
            if (addrHasWarnings) {
              playTone('warning');
            } else {
              playTone('info');
            }
          }
          break;
        }

        default:
          response = `UNKNOWN QUERY TYPE: ${verb}\nValid: QX (cross-ref), QH/QP (person), QV (vehicle), QW (warrant), QT (phone), QA (address), QD (DL), QO (OFAC), QC (courts)`;
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

  // Embedded mode: render as block element filling parent container
  if (embedded) {
    return (
      <div className="ncic-embedded flex flex-col h-full">
        {/* Terminal output area */}
        <div className="ncic-output flex-1" ref={scrollRef}>
          {entries.length === 0 && !loading && (
            <div className="ncic-welcome">
              <pre>{`╔══════════════════════════════════════════╗
║     NCIC / NLETS QUERY TERMINAL          ║
║     RMPG FLEX DISPATCH CAD               ║
╠══════════════════════════════════════════╣
║  COMMANDS:                               ║
║  QX <name>     Cross-Reference (ALL)     ║
║  QH <name>     Query Person / History    ║
║  QV <plate>    Query Vehicle             ║
║  QW <name>     Query Warrants            ║
║  QT <phone>    Query Phone Number        ║
║  QD <name/DL#> Query Driver's License    ║
║  QA <address>  Query Address / Premise   ║
║  QO <name>     Query OFAC Watchlist      ║
║  QC <name>     Query Utah Courts (web)  ║
╚══════════════════════════════════════════╝`}</pre>
            </div>
          )}
          {entries.map(entry => (
            <div key={entry.id} className="ncic-entry">
              <div className="ncic-entry-cmd">
                <span className="ncic-timestamp">[{entry.timestamp}]</span>
                <span className="ncic-cmd-text">&gt; {entry.command}</span>
              </div>
              <pre className="ncic-entry-response">
                {renderColorizedResponse(entry.response)}
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
            placeholder="QX SMITH, JOHN | QH NAME | QV PLATE | QT PHONE | QD DL#"
            spellCheck={false}
            autoComplete="off"
            disabled={loading}
          />
        </div>
      </div>
    );
  }

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

        {/* Terminal output area */}
        <div className="ncic-output" ref={scrollRef}>
          {entries.length === 0 && !loading && (
            <div className="ncic-welcome">
              <pre>{`╔══════════════════════════════════════════╗
║     NCIC / NLETS QUERY TERMINAL          ║
║     RMPG FLEX DISPATCH CAD               ║
╠══════════════════════════════════════════╣
║  COMMANDS:                               ║
║  QX <name>     Cross-Reference (ALL)     ║
║  QH <name>     Query Person / History    ║
║  QV <plate>    Query Vehicle             ║
║  QW <name>     Query Warrants            ║
║  QT <phone>    Query Phone Number        ║
║  QD <name/DL#> Query Driver's License    ║
║  QA <address>  Query Address / Premise   ║
║  QO <name>     Query OFAC Watchlist      ║
║  QC <name>     Query Utah Courts (web)  ║
╚══════════════════════════════════════════╝`}</pre>
            </div>
          )}

          {entries.map(entry => (
            <div key={entry.id} className="ncic-entry">
              <div className="ncic-entry-cmd">
                <span className="ncic-timestamp">[{entry.timestamp}]</span>
                <span className="ncic-cmd-text">&gt; {entry.command}</span>
              </div>
              <pre className="ncic-entry-response">
                {renderColorizedResponse(entry.response)}
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
            placeholder="QX SMITH, JOHN | QH NAME | QV PLATE | QT PHONE | QD DL#"
            spellCheck={false}
            autoComplete="off"
            disabled={loading}
          />
        </div>
      </div>
    </div>
  );
}
