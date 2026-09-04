// ============================================================
// RMPG Flex — NCIC/NLETS Query Terminal Panel
// Slide-out terminal that simulates NCIC queries against the
// local database. Black background, green monospace text.
// ============================================================

import React, { useState, useRef, useCallback, useEffect, useImperativeHandle, forwardRef } from 'react';
import { X, Terminal, Loader2, Download, Trash2 } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useContextMenu, type ContextMenuItem } from '../context/ContextMenuContext';
import { useMenuActions } from '../utils/contextMenuActions';
import {
  formatPersonResponse,
  formatVehicleResponse,
  formatWarrantResponse,
  formatDlResponse,
  formatOfacResponse,
  formatCrossReferenceResponse,
  formatAddressResponse,
  formatBackgroundResponse,
  formatArrestResponse,
  formatSkipTracerResponse,
  formatNoRecord,
  formatServiceUnavailable,
  getNcicLineClass,
  type NcicPerson,
  type NcicVehicle,
  type NcicCriminalHistory,
  type NcicWarrant,
  type NcicDlSubject,
  type NcicOfacSubject,
  type NcicArrestRecord,
  type SkipTracerPerson,
  type CrossReferenceResults,
  type AddressLookupResults,
  type BackgroundRecord,
} from '../utils/ncicFormatter';
import { lookupAnyCode, decode, type CodeHit } from '../constants/ncicCodes';
import { playTone } from '../utils/dispatchTones';
import { displayTimeZone } from '../utils/timeZoneMode';

// ── Quick-query buttons shown on welcome screen ──────────────
// Quick-query buttons rendered above the input. Clicking populates the input
// with the verb + a trailing space so the operator just types the term.
// Exported for unit testing.
export const QUICK_QUERIES = [
  { label: 'XREF', prefix: 'QX ', desc: 'Cross-Reference (ALL)' },
  { label: 'PERSON', prefix: 'QH ', desc: 'Person / History' },
  { label: 'VEHICLE', prefix: 'QV ', desc: 'Vehicle / Plate' },
  { label: 'WARRANT', prefix: 'QW ', desc: 'Warrant Check' },
  { label: 'DL', prefix: 'QD ', desc: "Driver's License" },
  { label: 'BKGND', prefix: 'QB ', desc: 'Background Check' },
  { label: 'ADDRESS', prefix: 'QA ', desc: 'Premise Lookup' },
  { label: 'ARREST', prefix: 'QR ', desc: 'Arrest Records' },
] as const;

// Welcome banner — same ASCII-box art for both embedded and overlay modes.
// Lifted to a single constant (previously the 18-line block was duplicated
// verbatim at both render sites, doubling theme-cleanup cost).
const WELCOME_BANNER = `╔══════════════════════════════════════════╗
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
║  QR <name>     Query Arrest Records      ║
║  QS <name>     Query Skip Tracker        ║
║  QB <name>     Query Background Check    ║
║  QC <name>     Query Utah Courts (web)   ║
║  QZ <code/term> Code Translation         ║
║                                          ║
║  HISTORY:  ↑ / ↓  navigate prior queries ║
╚══════════════════════════════════════════╝`;

/** History size cap — typical shift sees < 100 queries; 30 is plenty for the
 *  "I mistyped a plate, let me fix it" use case while bounding the array. */
const NCIC_HISTORY_CAP = 30;

export interface NcicQueryPanelHandle {
  focusInput: () => void;
  clearSession: () => void;
  exportSession: () => void;
}

interface NcicQueryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  initialQuery?: { type: 'person' | 'vehicle' | 'warrant' | 'xref' | 'phone' | 'address' | 'dl' | 'ofac'; query: string } | null;
  embedded?: boolean;
  canManage?: boolean;
}

interface QueryEntry {
  id: number;
  timestamp: string;
  command: string;
  response: string;
  hasHit: boolean;
}

// queryIdCounter moved to useRef inside component to avoid shared state across instances

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

    // Normal data lines — gold field-label tags (NAM/, DOB/, …) with the
    // values in the bright parchment tone, so the two-tone read (gold index,
    // bright data) is instantly scannable.
    const parts = line.split(/([A-Z]{2,5}\/)/g);
    if (parts.length <= 1) {
      // No field labels found — plain value text
      return <React.Fragment key={i}><span className="ncic-c-value">{line}</span>{'\n'}</React.Fragment>;
    }

    return (
      <React.Fragment key={i}>
        {parts.map((part, j) =>
          /^[A-Z]{2,5}\/$/.test(part)
            ? <span key={j} className="ncic-c-label">{part}</span>
            : part
              ? <span key={j} className="ncic-c-value">{part}</span>
              : <React.Fragment key={j}>{part}</React.Fragment>
        )}
        {'\n'}
      </React.Fragment>
    );
  });
}

const QZ_DOMAIN_LABEL: Record<string, string> = {
  RACE: 'RACE', ETHNICITY: 'ETHNICITY', SEX: 'SEX', EYE: 'EYE COLOR',
  HAIR: 'HAIR COLOR', VMA: 'VEHICLE MAKE', VCO: 'VEHICLE COLOR',
  VST: 'VEHICLE STYLE', STATE: 'STATE', DL_CLASS: 'DL CLASS',
  DL_RESTRICTION: 'DL RESTRICTION', DL_ENDORSEMENT: 'DL ENDORSEMENT',
};

/** Build the NCIC-style text block for a QZ code-translation query. */
function formatCodeDecode(term: string, hits: CodeHit[]): string {
  const hdr = [
    '*** NCIC RESPONSE ***',
    `ORI/RMPGFLEX01  MKE/QZ  QRY/CODE TRANSLATION`,
    '─'.repeat(60),
    '',
    `  CODE TRANSLATION: ${term.toUpperCase()}`,
    `  ${'─'.repeat(56)}`,
  ];
  if (hits.length === 0) {
    return [...hdr, '', '  NO MATCHING CODE FOUND', '', '─'.repeat(60), '*** END OF RECORD ***'].join('\n');
  }
  const body = hits.map(h => `  ${QZ_DOMAIN_LABEL[h.domain] || h.domain}: ${h.code} (${h.label.toUpperCase()})`);
  return [...hdr, '', ...body, '', `  SUMMARY: ${hits.length} CODE(S) FOUND`, '─'.repeat(60), '*** END OF RECORD ***'].join('\n');
}

const NcicQueryPanel = forwardRef<NcicQueryPanelHandle, NcicQueryPanelProps>(function NcicQueryPanel({ isOpen, onClose, initialQuery, embedded, canManage }, ref) {
  const [input, setInput] = useState('');
  const [entries, setEntries] = useState<QueryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryIdCounterRef = useRef(0);

  // In-memory query history — drives ↑/↓ arrow-key recall like a shell
  // terminal. `historyIdx` is the cursor: -1 means "live input" (typing new),
  // 0 = most recent prior query, history.length-1 = oldest kept. Bounded at
  // NCIC_HISTORY_CAP so a long shift can't grow this list unbounded.
  const historyRef = useRef<string[]>([]);
  const historyIdxRef = useRef<number>(-1);
  const draftRef = useRef<string>('');

  // Export + clear session handlers — exposed via imperative ref for parent shortcuts
  const clearSession = useCallback(() => { setEntries([]); }, []);
  const exportSession = useCallback(() => {
    if (entries.length === 0) return;
    const lines: string[] = [
      'RMPG FLEX — NCIC/NLETS TERMINAL SESSION EXPORT',
      `EXPORTED: ${new Date().toLocaleString('en-US', { timeZone: displayTimeZone() ?? undefined, hour12: false })}`,
      '═'.repeat(70),
      '',
    ];
    for (const e of entries) {
      lines.push(`[${e.timestamp}] > ${e.command}`);
      lines.push(e.response);
      lines.push('');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ncic-session-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [entries]);

  useImperativeHandle(ref, () => ({ focusInput: () => inputRef.current?.focus(), clearSession, exportSession }), [clearSession, exportSession]);

  // ── Right-click context menu (per result entry) ──
  const { openMenu } = useContextMenu();
  const m = useMenuActions();
  const buildEntryMenu = (entry: QueryEntry): ContextMenuItem[] => [
    m.copy('Copy command', entry.command),
    m.copy('Copy response', entry.response),
    m.copyId(entry.id),
  ];

  // Auto-focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Process initial query from command line
  useEffect(() => {
    if (initialQuery && isOpen) {
      const cmdMap: Record<string, string> = { person: 'QH', vehicle: 'QV', warrant: 'QW', dl: 'QD', ofac: 'QO', xref: 'QX', phone: 'QT', address: 'QA' };
      const cmd = `${cmdMap[initialQuery.type] || 'QH'} ${initialQuery.query}`;
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

    // Push to history (dedupe a back-to-back repeat — re-running the SAME
    // command shouldn't add two entries). Reset the cursor after every new
    // submission so ↑ always starts from the most recent.
    const trimmed = command.trim();
    if (trimmed && historyRef.current[0] !== trimmed) {
      historyRef.current.unshift(trimmed);
      if (historyRef.current.length > NCIC_HISTORY_CAP) {
        historyRef.current.length = NCIC_HISTORY_CAP;
      }
    }
    historyIdxRef.current = -1;
    draftRef.current = '';

    // Input validation: enforce length limits
    if (queryText.length > 200) {
      const ts = new Date().toLocaleTimeString('en-US', { hour12: false, timeZone: displayTimeZone() });
      setEntries(prev => [...prev, {
        id: ++queryIdCounterRef.current, timestamp: ts, command,
        response: 'ERROR: QUERY TOO LONG — MAXIMUM 200 CHARACTERS', hasHit: false,
      }]);
      playTone('error');
      return;
    }

    setLoading(true);
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false, timeZone: displayTimeZone() });

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

          if (!data.results || data.results.length === 0) {
            response = formatNoRecord('PERSON', queryText);
          } else {
            response = data.results
              .map(r => formatPersonResponse(r.person, r.criminalHistory, r.warrants))
              .join('\n\n');
            hasHit = true;

            // Check for warrants — play warning tone
            const hasWarrants = data.results.some(r => r.warrants?.length > 0);
            if (hasWarrants) {
              playTone('warning');
            } else {
              playTone('info');
            }
          }
          break;
        }

        case 'QV': {
          // Vehicle query. If the operator typed an NCIC make code (e.g. TOYT),
          // expand it to the make label so the server's `LIKE make` matches.
          const qvExpanded = decode('VMA', queryText.trim());
          const qvText = qvExpanded !== queryText.trim().toUpperCase() ? qvExpanded : queryText;
          const data = await apiFetch<{
            type: string;
            results: NcicVehicle[];
            query: string;
          }>(`/records/ncic-query?type=vehicle&query=${encodeURIComponent(qvText)}`);

          if (!data.results || data.results.length === 0) {
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
            utahResults?: any[];
            query: string;
          }>(`/records/ncic-query?type=warrant&query=${encodeURIComponent(queryText)}`);

          response = formatWarrantResponse(data.results || [], queryText, data.utahResults);
          hasHit = (data.results || []).length > 0 || (data.utahResults || []).length > 0;
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

          try {
            const dlData = await apiFetch<{
              hit: boolean;
              source: string;
              subjects: NcicDlSubject[];
              resultCount: number;
            }>('/microbilt/dl/search', {
              method: 'POST',
              body: JSON.stringify(body),
            });

            if (!dlData.hit || !dlData.subjects || dlData.subjects.length === 0) {
              response = formatNoRecord('DL SEARCH', queryText);
            } else {
              response = formatDlResponse(dlData.subjects, queryText);
              hasHit = true;
              playTone('info');
            }
          } catch {
            response = '*** DL SEARCH UNAVAILABLE ***\n\n  MicroBilt DL Search service is currently offline.\n  Try again later or use Records > DL Search.\n\n*** END ***';
            playTone('error');
          }
          break;
        }

        case 'QO': {
          // OFAC / SDN watchlist query
          // Parse: QO AL QAIDA  |  QO SMITH, JOHN
          const ofacBody: any = {};
          if (queryText.includes(',')) {
            const [last = '', first = ''] = queryText.split(',').map(s => s.trim());
            ofacBody.lastName = last;
            ofacBody.firstName = first;
          } else {
            ofacBody.fullName = queryText;
          }

          try {
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
          } catch {
            response = '*** OFAC SEARCH UNAVAILABLE ***\n\n  OFAC/SDN Watchlist service is currently offline.\n  Try again later.\n\n*** END ***';
            playTone('error');
          }
          break;
        }

        case 'QX': {
          // Cross-reference — fan out to ALL data sources in parallel
          // Parse name: "LAST, FIRST" or "LAST FIRST" or just "LAST"
          const xrefBody: any = {};
          if (queryText.includes(',')) {
            const [last = '', first = ''] = queryText.split(',').map(s => s.trim());
            xrefBody.lastName = last;
            xrefBody.firstName = first;
          } else {
            const nameParts = queryText.trim().split(/\s+/);
            xrefBody.lastName = nameParts[0];
            if (nameParts.length > 1) xrefBody.firstName = nameParts.slice(1).join(' ');
          }

          // Fire all queries in parallel — allSettled so one failure doesn't block others
          // Wrap each in a 15-second timeout to prevent infinite hang
          const withTimeout = <T,>(p: Promise<T>, label: string): Promise<T> =>
            Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timeout`)), 15000))]);
          const [personResult, warrantResult, dlResult, ofacResult, arrestResult, skipResult] = await Promise.allSettled([
            withTimeout(apiFetch<{ results: Array<{ person: NcicPerson; criminalHistory: NcicCriminalHistory[]; warrants: NcicWarrant[] }> }>(
              `/records/ncic-query?type=person&query=${encodeURIComponent(queryText)}`
            ), 'PERSON'),
            withTimeout(apiFetch<{ results: (NcicWarrant & { subject_first_name?: string; subject_last_name?: string; subject_dob?: string })[] }>(
              `/records/ncic-query?type=warrant&query=${encodeURIComponent(queryText)}`
            ), 'WARRANT'),
            withTimeout(apiFetch<{ hit: boolean; subjects: NcicDlSubject[] }>(
              '/microbilt/dl/search',
              { method: 'POST', body: JSON.stringify(xrefBody) }
            ), 'DL'),
            withTimeout(apiFetch<{ hit: boolean; subjects: NcicOfacSubject[] }>(
              '/microbilt/ofac/search',
              { method: 'POST', body: JSON.stringify(xrefBody.firstName ? { lastName: xrefBody.lastName, firstName: xrefBody.firstName } : { fullName: queryText }) }
            ), 'OFAC'),
            withTimeout(apiFetch<{ hit: boolean; records: NcicArrestRecord[] }>(
              `/arrests/search?name=${encodeURIComponent(queryText)}`
            ), 'ARREST'),
            withTimeout(apiFetch<{ PeopleDetails?: SkipTracerPerson[]; Records?: number }>(
              `/skiptracer/search/byname?name=${encodeURIComponent(queryText)}&page=1`
            ), 'SKIP'),
          ]);

          // Collect results, track errors. Local data sources (person/warrant/
          // arrest) failing is a real ERROR; external services (DL/OFAC/skip-
          // trace APIs) being unavailable is a soft SERVICE NOTE, not a fault.
          const xref: CrossReferenceResults = {
            persons: [], directWarrants: [], dlSubjects: [], ofacSubjects: [], arrestRecords: [], skipTracerPeople: [], errors: [], serviceWarnings: [],
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
            xref.serviceWarnings!.push('DRIVER LICENSE SERVICE UNAVAILABLE');
          }

          if (ofacResult.status === 'fulfilled') {
            xref.ofacSubjects = ofacResult.value.subjects || [];
          } else {
            xref.serviceWarnings!.push('OFAC SANCTIONS SERVICE UNAVAILABLE');
          }

          if (arrestResult.status === 'fulfilled') {
            xref.arrestRecords = arrestResult.value.records || [];
          } else {
            xref.errors.push('ARREST QUERY FAILED');
          }

          if (skipResult.status === 'fulfilled') {
            xref.skipTracerPeople = skipResult.value.PeopleDetails || [];
          } else {
            xref.serviceWarnings!.push('SKIP TRACER SERVICE UNAVAILABLE');
          }

          // ── Cross-load: enrich empty sections from person records ──
          if (xref.persons.length > 0) {
            // If DL search returned empty but person records have DL info, synthesize DL subjects
            if (xref.dlSubjects.length === 0) {
              const dlFromPersons = xref.persons
                .filter(r => r.person.drivers_license)
                .map(r => ({
                  first_name: r.person.first_name,
                  last_name: r.person.last_name,
                  middle_name: r.person.middle_name,
                  date_of_birth: r.person.date_of_birth,
                  gender: r.person.sex,
                  height: r.person.height,
                  weight: r.person.weight ? String(r.person.weight) : undefined,
                  eye_color: r.person.eye_color,
                  hair_color: r.person.hair_color,
                  race: r.person.race,
                  dl_number: r.person.drivers_license,
                  dl_state: r.person.dl_state || 'UT',
                  dl_status: 'SEE PERSON RECORD',
                  addresses: r.person.address ? [{ address: r.person.address }] : [],
                  source: 'PERSON_RECORD',
                  match_source: 'CROSS-LOADED FROM PERSON RECORD',
                }));
              if (dlFromPersons.length > 0) {
                xref.dlSubjects = dlFromPersons;
              }
            }

            // Cross-link: if arrest records found, match person records by name
            if (xref.arrestRecords.length > 0) {
              const personNames = new Set(
                xref.persons.map(r => `${(r.person.last_name || '').toLowerCase()},${(r.person.first_name || '').toLowerCase()}`)
              );
              for (const ar of xref.arrestRecords) {
                const arKey = `${(ar.last_name || '').toLowerCase()},${(ar.first_name || '').toLowerCase()}`;
                if (personNames.has(arKey) && !ar.cross_links) {
                  ar.cross_links = ar.cross_links || {};
                }
              }
            }
          }

          response = formatCrossReferenceResponse(xref, queryText);
          hasHit = xref.persons.length > 0 || xref.directWarrants.length > 0 ||
                   xref.dlSubjects.length > 0 || xref.ofacSubjects.length > 0 ||
                   xref.arrestRecords.length > 0 || xref.skipTracerPeople.length > 0;

          // Play appropriate tone based on severity
          const xrefHasWarrants = xref.persons.some(r => r.warrants.length > 0) || xref.directWarrants.length > 0;
          const xrefHasOfac = xref.ofacSubjects.length > 0;
          const xrefHasActiveArrests = xref.arrestRecords.some(
            r => r.status === 'active' || (r.cross_links?.warrants && r.cross_links.warrants.length > 0)
          );
          if (xrefHasWarrants || xrefHasOfac || xrefHasActiveArrests) {
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

          if (!phoneData.results || phoneData.results.length === 0) {
            response = formatNoRecord('PHONE', queryText);
          } else {
            response = phoneData.results
              .map(r => formatPersonResponse(r.person, r.criminalHistory, r.warrants))
              .join('\n\n');
            hasHit = true;

            const hasWarrants = phoneData.results.some(r => r.warrants?.length > 0);
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
          const courtBase = 'https://www.utcourts.gov/xchange/CaseSearch';
          const courtParams = new URLSearchParams();
          if (queryText.includes(',')) {
            const [last = '', first = ''] = queryText.split(',').map(s => s.trim());
            courtParams.set('lastName', last);
            if (first) courtParams.set('firstName', first);
          } else {
            courtParams.set('lastName', queryText.trim());
          }
          const courtUrl = courtParams.toString() ? `${courtBase}?${courtParams}` : courtBase;
          window.open(courtUrl, '_blank', 'noopener,noreferrer');

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

        case 'QB':
        case 'QB!': {
          // Background check — nationwide criminal records, court cases, sex offender
          const forceFresh = verb === 'QB!';
          const bgBody: any = { forceFresh };

          // Parse: QB FIRST LAST  |  QB LAST,FIRST  |  QB FIRST LAST MM/DD/YYYY
          if (queryText.includes(',')) {
            const [last = '', first = ''] = queryText.split(',').map(s => s.trim());
            bgBody.lastName = last;
            bgBody.firstName = first;
          } else {
            const bgParts = queryText.trim().split(/\s+/).filter(Boolean);
            if (bgParts.length >= 2) {
              // Check if last part looks like a date (DOB)
              const lastPart = bgParts[bgParts.length - 1];
              if (/^\d{2}[\/-]\d{2}[\/-]\d{4}$/.test(lastPart) || /^\d{8}$/.test(lastPart)) {
                bgBody.dob = lastPart;
                bgBody.firstName = bgParts[0];
                bgBody.lastName = bgParts.length > 2 ? bgParts[bgParts.length - 2] : bgParts[0];
              } else {
                bgBody.firstName = bgParts[0];
                bgBody.lastName = bgParts[bgParts.length - 1];
              }
            } else if (bgParts.length === 1) {
              bgBody.lastName = bgParts[0];
            }
          }

          const bgData = await apiFetch<{
            hit: boolean;
            sources: string[];
            records: BackgroundRecord[];
            resultCount: number;
            cached?: boolean;
            cachedAt?: string;
            searchId?: number;
            message?: string;
          }>('/microbilt/background/search', {
            method: 'POST',
            body: JSON.stringify(bgBody),
          });

          if (bgData.message && !bgData.hit && bgData.records?.length === 0) {
            // Service not enabled or other message
            response = [
              '*** BACKGROUND CHECK ***',
              '',
              `  ${bgData.message}`,
              '',
              '*** END ***',
            ].join('\n');
          } else if (!bgData.hit || !bgData.records?.length) {
            response = formatNoRecord('BACKGROUND CHECK', queryText);
          } else {
            response = formatBackgroundResponse(bgData.records, queryText, bgData.cached, bgData.cachedAt);
            hasHit = true;

            // Sex offender hits get warning tone, others get info
            const hasSexOffender = bgData.records.some(r => r.record_type === 'SEX_OFFENDER');
            playTone(hasSexOffender ? 'warning' : 'info');
          }
          break;
        }

        case 'QR': {
          // Arrest record query — JailBase county arrest records
          let arName = queryText;
          if (queryText.includes(',')) {
            const [last = '', first = ''] = queryText.split(',').map(s => s.trim());
            arName = `${first} ${last}`;
          }

          try {
            const arData = await apiFetch<{
              hit: boolean;
              records: NcicArrestRecord[];
              resultCount: number;
              cached: boolean;
            }>(`/arrests/search?name=${encodeURIComponent(arName)}`);

            if (!arData.hit || !arData.records?.length) {
              response = formatNoRecord('ARREST RECORDS', queryText);
            } else {
              response = formatArrestResponse(arData.records, queryText);
              hasHit = true;

              const hasActive = arData.records.some(r => r.status === 'active');
              const hasLinkedWarrants = arData.records.some(r => (r.cross_links?.warrants?.length || 0) > 0);
              playTone(hasActive || hasLinkedWarrants ? 'warning' : 'info');
            }
          } catch {
            response = '*** ARREST RECORDS UNAVAILABLE ***\n\n  JailBase arrest search service timed out.\n  Cached local records may still be available in Records.\n\n*** END ***';
            playTone('error');
          }
          break;
        }

        case 'QS': {
          // Skip Tracker — RapidAPI skip tracing lookup
          // Supports: QS NAME  |  QS ADDR:123 Main St  |  QS PHONE:8015551234  |  QS EMAIL:john@example.com
          let stPath = '/skiptracer/search/byname';
          let stParams: Record<string, string> = {};
          let stType = 'NAME';

          if (queryText.toUpperCase().startsWith('ADDR:')) {
            stPath = '/skiptracer/search/byaddress';
            stParams = { address: queryText.substring(5).trim() };
            stType = 'ADDRESS';
          } else if (queryText.toUpperCase().startsWith('PHONE:')) {
            stPath = '/skiptracer/search/byphone';
            stParams = { phone: queryText.substring(6).trim() };
            stType = 'PHONE';
          } else if (queryText.toUpperCase().startsWith('EMAIL:')) {
            stPath = '/skiptracer/search/byemail';
            stParams = { email: queryText.substring(6).trim() };
            stType = 'EMAIL';
          } else {
            stParams = { name: queryText.trim() };
          }

          const stQs = new URLSearchParams({ ...stParams, page: '1' }).toString();
          const stData = await apiFetch<{
            PeopleDetails?: SkipTracerPerson[];
            Records?: number;
            Status?: number;
          }>(`${stPath}?${stQs}`);

          const stPeople = stData.PeopleDetails || [];

          if (stPeople.length === 0) {
            response = formatNoRecord('SKIP TRACKER', queryText);
          } else {
            response = formatSkipTracerResponse(stPeople, queryText, stData.Records, stType);
            hasHit = true;
            playTone('info');
          }
          break;
        }

        case 'QZ': {
          // Code translation / decoder — no backend call
          const hits = lookupAnyCode(queryText);
          response = formatCodeDecode(queryText, hits);
          hasHit = hits.length > 0;
          playTone(hits.length > 0 ? 'info' : 'error');
          break;
        }

        default:
          response = `UNKNOWN QUERY TYPE: ${verb}\nValid: QX (cross-ref), QH/QP (person), QV (vehicle), QW (warrant), QT (phone), QA (address), QD (DL), QO (OFAC), QR (arrests), QS (skip tracer), QC (courts), QB (background), QZ (code decode)`;
      }

      setEntries(prev => [...prev, {
        id: ++queryIdCounterRef.current,
        timestamp,
        command,
        response,
        hasHit,
      }]);
    } catch (err) {
      // External paid-API commands (skip-trace / DL / OFAC / background) being
      // down or unconfigured is an advisory, not a system fault — render an
      // amber SERVICE NOTE instead of a red ERROR. Local-DB commands still
      // surface a real error.
      const EXTERNAL_SOURCES: Record<string, string> = {
        QS: 'SKIP TRACKER', QD: "DRIVER'S LICENSE", QL: "DRIVER'S LICENSE",
        QO: 'OFAC SANCTIONS', QB: 'BACKGROUND CHECK',
      };
      const source = EXTERNAL_SOURCES[verb];
      const reason = /timeout/i.test(err instanceof Error ? err instanceof Error ? err.message : 'Unknown error' : '') ? 'REQUEST TIMED OUT' : 'SERVICE UNAVAILABLE';
      const response = source
        ? formatServiceUnavailable(source, queryText, reason)
        : `ERROR: ${err instanceof Error ? err.message : 'Query failed'}`;
      setEntries(prev => [...prev, {
        id: ++queryIdCounterRef.current,
        timestamp,
        command,
        response,
        hasHit: false,
      }]);
      playTone(source ? 'info' : 'error');
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
      return;
    }
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    // ↑/↓ — terminal-style command-history recall. -1 is "live draft"; 0 is
    // most recent prior. Stepping past the oldest entry stays at the oldest;
    // stepping past -1 returns to whatever was typed before history began.
    if (e.key === 'ArrowUp') {
      if (historyRef.current.length === 0) return;
      e.preventDefault();
      if (historyIdxRef.current === -1) draftRef.current = input;
      const next = Math.min(historyRef.current.length - 1, historyIdxRef.current + 1);
      historyIdxRef.current = next;
      setInput(historyRef.current[next]);
      return;
    }
    if (e.key === 'ArrowDown') {
      if (historyIdxRef.current === -1) return;
      e.preventDefault();
      const next = historyIdxRef.current - 1;
      historyIdxRef.current = next;
      setInput(next === -1 ? draftRef.current : historyRef.current[next]);
      return;
    }
  }, [handleSubmit, onClose, input]);

  // Clicking a QUICK_QUERIES button populates the verb prefix and focuses
  // the input so the operator just types the search term. Reset history
  // cursor so a subsequent ↑ doesn't yank them out of the prefix.
  const insertQuickPrefix = useCallback((prefix: string) => {
    setInput(prefix);
    historyIdxRef.current = -1;
    draftRef.current = '';
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  // Shared quick-button row + welcome banner — rendered identically by both
  // embedded and overlay modes. Extracted so the markup (and its theme
  // tokens) live in exactly one place.
  const QuickButtons = (
    <div className="ncic-quick-row" role="toolbar" aria-label="Quick NCIC queries">
      {QUICK_QUERIES.map(({ label, prefix, desc }) => (
        <button
          key={label}
          type="button"
          className="ncic-quick-btn"
          onClick={() => insertQuickPrefix(prefix)}
          title={`${prefix.trim()} — ${desc}`}
          disabled={loading}
        >
          <span className="ncic-quick-verb">{prefix.trim()}</span>
          <span className="ncic-quick-label">{label}</span>
        </button>
      ))}
    </div>
  );
  const WelcomeBlock = (
    <div className="ncic-welcome"><pre>{WELCOME_BANNER}</pre></div>
  );

  if (!isOpen && !embedded) return null;

  // Embedded mode: render as block element filling parent container
  if (embedded) {
    return (
      <div className="ncic-embedded flex flex-col h-full">
        {/* Terminal output area */}
        <div className="ncic-output flex-1" ref={scrollRef}>
          {entries.length === 0 && !loading && WelcomeBlock}
          {entries.map(entry => (
            <div key={entry.id} className="ncic-entry" onContextMenu={(e) => openMenu(e, buildEntryMenu(entry))}>
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
        {QuickButtons}
        {/* Action bar — Export always visible; Clear gated to admin/manager */}
        <div className="flex items-center gap-1 px-2 py-1 border-t border-rmpg-800">
          <button
            type="button"
            onClick={exportSession}
            disabled={entries.length === 0}
            title="Export session as TXT"
            className="flex items-center gap-1 px-2 py-0.5 text-[9px] font-semibold tracking-wide text-brand-400 hover:text-brand-300 border border-rmpg-700 hover:border-brand-500 bg-surface-raised disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={10} />
            <span>EXPORT</span>
          </button>
          {canManage && (
            <button
              type="button"
              onClick={clearSession}
              disabled={entries.length === 0}
              title="Clear session (admin/manager only)"
              className="flex items-center gap-1 px-2 py-0.5 text-[9px] font-semibold tracking-wide text-red-400 hover:text-red-300 border border-rmpg-700 hover:border-red-800 bg-surface-raised disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trash2 size={10} />
              <span>CLEAR</span>
            </button>
          )}
        </div>
        {/* Input bar */}
        <div className="ncic-input-row">
          <span className="ncic-prompt">&gt;</span>
          <input id="ff-ncicquerypanel-0"
            ref={inputRef}
            type="text"
            className="ncic-input"
            value={input}
            onChange={e => setInput(e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
            placeholder="QX SMITH, JOHN | QV PLATE | QZ TOYT | QH NAME"
            maxLength={210}
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
            <Terminal style={{ width: 14, height: 14, color: 'var(--brand-gold)' }} />
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--brand-gold)', letterSpacing: '0.1em' }}>
              NCIC / NLETS Terminal
            </span>
            <span className="text-[7px] font-mono px-1.5 py-0.5 rounded-sm" style={{ background: 'rgb(var(--brand-gold-rgb) / 0.1)', color: 'var(--brand-gold)', border: '1px solid rgb(var(--brand-gold-rgb) / 0.2)' }}>SECURE</span>
          </div>
          <button type="button" onClick={onClose} className="ncic-close-btn" aria-label="Close terminal" title="Close terminal">
            <X style={{ width: 14, height: 14 }} />
          </button>
        </div>

        {/* Terminal output area */}
        <div className="ncic-output" ref={scrollRef}>
          {entries.length === 0 && !loading && WelcomeBlock}

          {entries.map(entry => (
            <div key={entry.id} className="ncic-entry" onContextMenu={(e) => openMenu(e, buildEntryMenu(entry))}>
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

        {QuickButtons}
        {/* Action bar — Export always visible; Clear gated to admin/manager */}
        <div className="flex items-center gap-1 px-2 py-1 border-t border-rmpg-800">
          <button
            type="button"
            onClick={exportSession}
            disabled={entries.length === 0}
            title="Export session as TXT"
            className="flex items-center gap-1 px-2 py-0.5 text-[9px] font-semibold tracking-wide text-brand-400 hover:text-brand-300 border border-rmpg-700 hover:border-brand-500 bg-surface-raised disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={10} />
            <span>EXPORT</span>
          </button>
          {canManage && (
            <button
              type="button"
              onClick={clearSession}
              disabled={entries.length === 0}
              title="Clear session (admin/manager only)"
              className="flex items-center gap-1 px-2 py-0.5 text-[9px] font-semibold tracking-wide text-red-400 hover:text-red-300 border border-rmpg-700 hover:border-red-800 bg-surface-raised disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trash2 size={10} />
              <span>CLEAR</span>
            </button>
          )}
        </div>
        {/* Input bar */}
        <div className="ncic-input-row">
          <span className="ncic-prompt">&gt;</span>
          <input id="ff-ncicquerypanel-1"
            ref={inputRef}
            type="text"
            className="ncic-input"
            value={input}
            onChange={e => setInput(e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
            placeholder="QX SMITH, JOHN | QV PLATE | QZ TOYT | QH NAME"
            maxLength={210}
            spellCheck={false}
            autoComplete="off"
            disabled={loading}
          />
        </div>
      </div>
    </div>
  );
});

export default NcicQueryPanel;
