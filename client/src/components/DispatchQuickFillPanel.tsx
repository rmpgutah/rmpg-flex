// ============================================================
// RMPG Flex — Dispatch Quick-Fill Panel
//
// Standalone popover panel exposing a curated library of
// dispatch phrase templates organized by operational category:
//   - Status Updates       (radio chatter shorthand)
//   - Traffic Stops        (consent-to-search, plates, etc.)
//   - BOLO Callouts        (subject descriptions, vehicle desc)
//   - Narrative Starters   (incident report opening lines)
//   - Disposition Closers  (cleared-by codes, referral language)
//   - Custody / Jail Intake
//   - Mutual Aid / Resource
//
// Designed as a CALLABLE component — caller passes a target
// callback (`onInsert`) and the panel fires it with the
// selected phrase. Caller decides whether to insert into a
// textarea, copy to clipboard, dispatch to a unit, etc. This
// keeps the panel reusable across DispatchPage.tsx, narrative
// fields on incident forms, and any future surface that needs
// quick-fill access.
//
// Component is dormant until a parent renders it. Wiring into
// DispatchPage / IncidentFormModal / etc. is a separate small
// edit per surface (~5 lines each).
// ============================================================

import { useState, useMemo } from 'react';
import { Search, Copy, ChevronDown, ChevronRight, X } from 'lucide-react';

export interface DispatchPhrase {
  /** Short label shown in the chip list. */
  label: string;
  /** The actual phrase that gets inserted/copied. May contain
   *  `{}` placeholder slots that callers can substitute. */
  phrase: string;
}

export interface DispatchPhraseCategory {
  id: string;
  title: string;
  /** Helps the user know what this category is for at a glance. */
  hint?: string;
  phrases: DispatchPhrase[];
}

// ── Phrase library ──────────────────────────────────────────
//
// Curated for RMPG Flex's Utah deployment. Every phrase is
// either operationally common (e.g. "Code 4, no further units
// needed") or addresses a frequent friction point (typing the
// same Miranda warning twice in a 12-hour shift). Add to this
// list rather than maintaining one elsewhere — the goal is a
// single library shared across dispatch + incident forms.
export const DEFAULT_PHRASE_LIBRARY: DispatchPhraseCategory[] = [
  {
    id: 'status',
    title: 'Status Updates',
    hint: 'Common dispatch / unit status calls',
    phrases: [
      { label: 'Code 4',     phrase: 'Code 4, no further units needed.' },
      { label: 'En Route',   phrase: 'En route to scene.' },
      { label: 'On Scene',   phrase: 'On scene, ETA on backup units?' },
      { label: 'Clear',      phrase: 'Clearing scene, returning to service.' },
      { label: 'Out at...',  phrase: 'Out at {location}, conducting investigation.' },
      { label: 'Stand-By',   phrase: 'Standing by for further information.' },
      { label: 'Need Backup', phrase: 'Requesting backup, code 3.' },
      { label: 'Need EMS',   phrase: 'Requesting EMS to my location.' },
    ],
  },
  {
    id: 'traffic',
    title: 'Traffic Stops',
    hint: 'Stop initiation + consent + result phrasing',
    phrases: [
      { label: 'Stop Initiate', phrase: 'Initiating traffic stop, plate {plate}, {state}, vehicle is a {color} {make} {model}.' },
      { label: 'Stop Reason',   phrase: 'Stop reason: {violation}.' },
      { label: 'Consent Q',     phrase: 'Consent to search vehicle was {granted/denied}.' },
      { label: 'Verbal Warn',   phrase: 'Verbal warning issued for {violation}, no citation issued.' },
      { label: 'Citation',      phrase: 'Citation {citation_number} issued for {statute_citation}.' },
      { label: 'Tow Vehicle',   phrase: 'Vehicle towed to {tow_location} by {tow_company}, hold for {reason}.' },
      { label: 'No Hits',       phrase: 'No outstanding warrants or stolen status returns.' },
      { label: 'Pursuit',       phrase: 'Vehicle failed to stop, initiating pursuit. Direction of travel: {direction}.' },
    ],
  },
  {
    id: 'bolo',
    title: 'BOLO Callouts',
    hint: 'Be On The Lookout descriptions',
    phrases: [
      { label: 'Subject Desc', phrase: 'BOLO: {race} {gender}, approximately {age} years old, {height} tall, {weight} lbs, wearing {clothing}.' },
      { label: 'Vehicle Desc', phrase: 'BOLO vehicle: {color} {year} {make} {model}, plate {plate}, {state}.' },
      { label: 'Last Seen',    phrase: 'Last seen at {location} at approximately {time}, headed {direction}.' },
      { label: 'Armed',        phrase: 'Subject is reported to be armed with {weapon}. Use caution.' },
      { label: 'Mental Health', phrase: 'Subject is in apparent mental health crisis. Approach with verbal de-escalation.' },
      { label: 'Wanted For',   phrase: 'Subject is wanted in connection with {offense}. Probable cause to detain.' },
    ],
  },
  {
    id: 'narrative',
    title: 'Narrative Starters',
    hint: 'Incident report opening boilerplate',
    phrases: [
      { label: 'Dispatch Open', phrase: 'On {date} at approximately {time} hours, I, Officer {last_name}, was dispatched to {location} reference a {incident_type}.' },
      { label: 'Self Init',     phrase: 'On {date} at approximately {time} hours, I, Officer {last_name}, observed {observation} at {location}.' },
      { label: 'Witness Seen',  phrase: 'I made contact with {witness_name}, who advised the following:' },
      { label: 'No Suspects',   phrase: 'At time of report, no suspects were located. Case to be referred for follow-up.' },
      { label: 'Photos Taken',  phrase: 'Photographs of the scene were taken with my body-worn camera and uploaded to evidence.' },
      { label: 'Body Cam Active', phrase: 'My body-worn camera was active for the duration of this incident.' },
      { label: 'Refused Statement', phrase: 'Subject was advised of their rights and elected to remain silent.' },
    ],
  },
  {
    id: 'disposition',
    title: 'Disposition Closers',
    hint: 'How the call ended — clear-codes',
    phrases: [
      { label: 'Report Taken',  phrase: 'Cleared by report. Case referred to {assigned_unit} for follow-up.' },
      { label: 'Arrest Made',   phrase: 'Cleared by arrest. Subject {subject_name} booked into {jail} on charges of {charges}.' },
      { label: 'Citation',      phrase: 'Cleared by citation issued.' },
      { label: 'Verbal Warn',   phrase: 'Cleared by verbal warning. No further action required.' },
      { label: 'Mediated',      phrase: 'Parties mediated and separated voluntarily. No further police action.' },
      { label: 'Civil Matter',  phrase: 'Determined to be a civil matter. Parties advised to seek civil remedy.' },
      { label: 'Unfounded',     phrase: 'Investigation revealed no criminal activity. Cleared as unfounded.' },
      { label: 'GOA',           phrase: 'Gone on arrival. Area checked, unable to locate suspect.' },
      { label: 'RP Cancelled',  phrase: 'Cancelled by reporting party prior to arrival.' },
    ],
  },
  {
    id: 'custody',
    title: 'Custody / Jail Intake',
    hint: 'Booking + Miranda + medical screening',
    phrases: [
      { label: 'Miranda',       phrase: 'I advised {subject_name} of their Miranda rights from a department-issued card. Subject acknowledged understanding by stating "{acknowledgment}".' },
      { label: 'Search Incid',  phrase: 'Search incident to arrest yielded the following: {items}.' },
      { label: 'Medical Clear', phrase: 'Subject was medically cleared by EMS at {location} prior to transport.' },
      { label: 'Refused Med',   phrase: 'Subject refused medical treatment despite advisement. Refusal documented.' },
      { label: 'Transport',     phrase: 'Transported subject to {jail} via marked patrol unit. Mileage start: {start_miles}, end: {end_miles}.' },
      { label: 'Booked',        phrase: 'Subject booked into {jail} as booking #{booking_number}, charges accepted.' },
      { label: 'Charges Refused', phrase: 'Charges refused by booking deputy citing {reason}. Subject released or transferred.' },
    ],
  },
  {
    id: 'mutual_aid',
    title: 'Mutual Aid / Resource',
    hint: 'Inter-agency requests',
    phrases: [
      { label: 'Request K9',    phrase: 'Requesting K9 unit to my location for {purpose}.' },
      { label: 'Request UAV',   phrase: 'Requesting UAV / drone overflight for {purpose}.' },
      { label: 'Request Air',   phrase: 'Requesting air support to {location} for {purpose}.' },
      { label: 'LE Notified',   phrase: 'Notified {agency} per protocol. Their case # is {agency_case_number}.' },
      { label: 'Fire Notified', phrase: 'Notified Fire/EMS, responding under {agency_case_number}.' },
      { label: 'CYS Notified',  phrase: 'Child welfare services notified, intake # {intake_number}.' },
      { label: 'Animal Ctrl',   phrase: 'Animal control notified, response time approximately {eta}.' },
    ],
  },
];

interface DispatchQuickFillPanelProps {
  /** Called when the user picks a phrase. The caller decides
   *  what to do with it (insert into textarea, copy to clipboard,
   *  dispatch, etc.). */
  onInsert: (phrase: string) => void;
  /** Called when the user closes the panel. */
  onClose?: () => void;
  /** Override the default phrase library. */
  library?: DispatchPhraseCategory[];
  /** If true, renders inline (not as a popover overlay). */
  inline?: boolean;
}

export default function DispatchQuickFillPanel({
  onInsert,
  onClose,
  library = DEFAULT_PHRASE_LIBRARY,
  inline = false,
}: DispatchQuickFillPanelProps) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    () => Object.fromEntries(library.map(c => [c.id, true])),
  );

  // Filter phrases by search term — searches both label and full
  // phrase text so an officer can find phrases by either the
  // shorthand or by typing words from the body of the phrase.
  const filtered = useMemo(() => {
    if (!search.trim()) return library;
    const q = search.toLowerCase();
    return library
      .map(cat => ({
        ...cat,
        phrases: cat.phrases.filter(
          p => p.label.toLowerCase().includes(q) || p.phrase.toLowerCase().includes(q),
        ),
      }))
      .filter(cat => cat.phrases.length > 0);
  }, [library, search]);

  const toggleCategory = (id: string) => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCopy = async (phrase: string) => {
    try {
      await navigator.clipboard.writeText(phrase);
    } catch {
      /* fallback: caller's onInsert will handle */
    }
  };

  const containerCls = inline
    ? 'bg-surface-base border border-rmpg-600 rounded-sm flex flex-col max-h-[500px]'
    : 'fixed top-16 right-4 w-96 bg-surface-base border border-rmpg-600 rounded-sm shadow-2xl z-[9000] flex flex-col max-h-[80vh]';

  return (
    <div className={containerCls} role="dialog" aria-label="Dispatch quick-fill phrase library">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-rmpg-700 bg-surface-sunken flex-shrink-0">
        <div className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Quick Fill</div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-0.5 hover:bg-rmpg-700 text-rmpg-400 hover:text-rmpg-200 transition-colors"
            aria-label="Close quick-fill panel"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-rmpg-700 flex-shrink-0">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Search phrases..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-dark text-[11px] w-full pl-7"
          />
        </div>
      </div>

      {/* Categories */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="px-3 py-4 text-[10px] text-rmpg-500 italic text-center">
            No phrases match &quot;{search}&quot;.
          </div>
        )}
        {filtered.map(cat => (
          <div key={cat.id} className="border-b border-rmpg-800">
            <button
              type="button"
              onClick={() => toggleCategory(cat.id)}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-surface-sunken transition-colors text-left"
              aria-expanded={!!expanded[cat.id]}
            >
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                {expanded[cat.id] ? (
                  <ChevronDown className="w-3 h-3 text-rmpg-400 flex-shrink-0" />
                ) : (
                  <ChevronRight className="w-3 h-3 text-rmpg-400 flex-shrink-0" />
                )}
                <span className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">
                  {cat.title}
                </span>
                <span className="text-[9px] text-rmpg-500">({cat.phrases.length})</span>
              </div>
            </button>
            {expanded[cat.id] && (
              <div className="px-2 pb-2 space-y-0.5">
                {cat.hint && (
                  <div className="text-[9px] text-rmpg-500 italic px-1 pb-1">{cat.hint}</div>
                )}
                {cat.phrases.map((p, idx) => (
                  <div
                    key={idx}
                    className="group flex items-start gap-1 p-1 hover:bg-surface-sunken rounded-sm"
                  >
                    <button
                      type="button"
                      onClick={() => onInsert(p.phrase)}
                      className="flex-1 text-left min-w-0"
                      title={p.phrase}
                    >
                      <div className="text-[10px] font-bold text-brand-400 mb-0.5">{p.label}</div>
                      <div className="text-[9px] text-rmpg-300 leading-tight line-clamp-2">{p.phrase}</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopy(p.phrase)}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-rmpg-700 text-rmpg-400 hover:text-rmpg-200 transition-all"
                      title="Copy to clipboard"
                      aria-label={`Copy phrase: ${p.label}`}
                    >
                      <Copy className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-1.5 border-t border-rmpg-700 bg-surface-sunken text-[9px] text-rmpg-500 flex-shrink-0">
        <span className="text-brand-400">Click</span> phrase to insert ·{' '}
        <span className="text-brand-400">Copy</span> icon to clipboard ·{' '}
        <span className="font-mono text-rmpg-400">{'{slot}'}</span> are placeholders to fill in
      </div>
    </div>
  );
}
