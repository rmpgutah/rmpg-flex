// ============================================================
// RMPG Flex — NCIC/NLETS Query Terminal Panel
// Slide-out terminal that simulates NCIC queries against the
// local database. Black background, green monospace text.
// ============================================================

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Terminal, Loader2, Copy, Check } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
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
import { playTone } from '../utils/dispatchTones';

// ── Quick-query buttons shown on welcome screen ──────────────
const QUICK_QUERIES = [
  { label: 'XREF', prefix: 'QX ', desc: 'Cross-Reference (ALL)' },
  { label: 'PERSON', prefix: 'QH ', desc: 'Person / History' },
  { label: 'VEHICLE', prefix: 'QV ', desc: 'Vehicle / Plate' },
  { label: 'WARRANT', prefix: 'QW ', desc: 'Warrant Check' },
  { label: 'DL', prefix: 'QD ', desc: "Driver's License" },
  { label: 'BKGND', prefix: 'QB ', desc: 'Background Check' },
  { label: 'ADDRESS', prefix: 'QA ', desc: 'Premise Lookup' },
  { label: 'ARREST', prefix: 'QR ', desc: 'Arrest Records' },
] as const;

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
  const queryIdCounterRef = useRef(0);

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

    // Input validation: enforce length limits
    if (queryText.length > 200) {
      const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
      setEntries(prev => [...prev, {
        id: ++queryIdCounterRef.current, timestamp: ts, command,
        response: 'ERROR: QUERY TOO LONG — MAXIMUM 200 CHARACTERS', hasHit: false,
      }]);
      playTone('error');
      return;
    }

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
          // Vehicle query
          const data = await apiFetch<{
            type: string;
            results: NcicVehicle[];
            query: string;
          }>(`/records/ncic-query?type=vehicle&query=${encodeURIComponent(queryText)}`);

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
            const [last = '', first = ''] = queryText.split(',').map(s => s.trim());
            xrefBody.lastName = last;
            xrefBody.firstName = first;
          } else {
            const nameParts = queryText.trim().split(/\s+/);
            xrefBody.lastName = nameParts[0];
            if (nameParts.length > 1) xrefBody.firstName = nameParts.slice(1).join(' ');
          }

          // Fire all queries in parallel — allSettled so one failure doesn't block others
          const [personResult, warrantResult, dlResult, ofacResult, arrestResult, skipResult] = await Promise.allSettled([
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
            apiFetch<{ hit: boolean; records: NcicArrestRecord[] }>(
              `/arrests/search?name=${encodeURIComponent(queryText)}`
            ),
            apiFetch<{ PeopleDetails?: SkipTracerPerson[]; Records?: number }>(
              `/skiptracer/search/byname?name=${encodeURIComponent(queryText)}&page=1`
            ),
          ]);

          // Collect results, track errors
          const xref: CrossReferenceResults = {
            persons: [], directWarrants: [], dlSubjects: [], ofacSubjects: [], arrestRecords: [], skipTracerPeople: [], errors: [],
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

          if (arrestResult.status === 'fulfilled') {
            xref.arrestRecords = arrestResult.value.records || [];
          } else {
            xref.errors.push('ARREST QUERY FAILED');
          }

          if (skipResult.status === 'fulfilled') {
            xref.skipTracerPeople = skipResult.value.PeopleDetails || [];
          } else {
            xref.errors.push('SKIP TRACER QUERY FAILED');
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
          break;
        }

        case 'QS': {
          // Skip Tracer — RapidAPI skip tracing lookup
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
            response = formatNoRecord('SKIP TRACER', queryText);
          } else {
            response = formatSkipTracerResponse(stPeople, queryText, stData.Records, stType);
            hasHit = true;
            playTone('info');
          }
          break;
        }

        default:
          response = `UNKNOWN QUERY TYPE: ${verb}\nValid: QX (cross-ref), QH/QP (person), QV (vehicle), QW (warrant), QT (phone), QA (address), QD (DL), QO (OFAC), QR (arrests), QS (skip tracer), QC (courts), QB (background)`;
      }

      setEntries(prev => [...prev, {
        id: ++queryIdCounterRef.current,
        timestamp,
        command,
        response,
        hasHit,
      }]);
    } catch (err: any) {
      setEntries(prev => [...prev, {
        id: ++queryIdCounterRef.current,
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
║  QR <name>     Query Arrest Records      ║
║  QS <name>     Query Skip Tracer         ║
║  QB <name>     Query Background Check    ║
║  QC <name>     Query Utah Courts (web)   ║
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
            placeholder="QX SMITH, JOHN | QH NAME | QS NAME | QR NAME | QB NAME"
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
║  QR <name>     Query Arrest Records      ║
║  QS <name>     Query Skip Tracer         ║
║  QB <name>     Query Background Check    ║
║  QC <name>     Query Utah Courts (web)   ║
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
            placeholder="QX SMITH, JOHN | QH NAME | QS NAME | QV PLATE | QB NAME"
            maxLength={210}
            spellCheck={false}
            autoComplete="off"
            disabled={loading}
          />
        </div>
      </div>
    </div>
  );
}
