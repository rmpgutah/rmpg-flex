// ============================================================
// RMPG Flex — Officer Safety Auto-Screening
// Automatically screens names entered during call creation
// against warrants, criminal history, and caution flags.
// Displays prominent warning banners for officer safety.
// ============================================================

import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, Shield, FileWarning, User, Scale, Ban, MapPin } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { playTone } from '../utils/dispatchTones';
import { announceScreeningAlerts } from '../utils/voiceAlerts';

interface ScreeningPerson {
  person: {
    id: number;
    first_name: string;
    last_name: string;
    dob?: string;
    gender?: string;
    race?: string;
    caution_flags?: string;
    is_sex_offender?: boolean;
    has_criminal_history?: boolean;
  };
  warrants: Array<{
    id: number;
    warrant_type: string;
    charge_description: string;
    offense_level: string;
    bail_amount?: number;
    status: string;
  }>;
  criminalHistory: Array<{
    id: number;
    charge: string;
    charge_date: string;
    disposition?: string;
  }>;
}

interface ScreeningResult {
  persons: ScreeningPerson[];
  directWarrantHits: Array<{
    id: number;
    subject_first_name: string;
    subject_last_name: string;
    warrant_type: string;
    charge_description: string;
    offense_level: string;
    bail_amount?: number;
  }>;
  ofacHits: Array<{
    name: string;
    type: string;
    program: string;
    source_list: string;
  }>;
  utahWarrantHits: Array<{
    name: string;
    first_name: string;
    last_name: string;
    middle_name?: string;
    age?: number;
    city?: string;
    warrant_id: string;
    issue_date?: string;
    court_name?: string;
    case_id?: string;
    charges?: string;
  }>;
  premiseWarnings: string[];
  hasWarnings: boolean;
}

interface SafetyScreeningProps {
  callerName?: string;
  subjectDescription?: string;
}

export default function SafetyScreening({ callerName, subjectDescription }: SafetyScreeningProps) {
  const [result, setResult] = useState<ScreeningResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedPerson, setExpandedPerson] = useState<number | null>(null);
  const tonePlayedRef = useRef<string>('');

  // Extract a potential name from the subject description (e.g., "Male, 5'10, dark hoodie" → skip)
  // Only search if the description contains what looks like a name
  const extractedName = callerName?.trim() || '';

  useEffect(() => {
    const searchName = extractedName;
    if (!searchName || searchName.length < 3) {
      setResult(null);
      return;
    }

    const debounce = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await apiFetch<ScreeningResult>(
          `/dispatch/safety-screen?name=${encodeURIComponent(searchName)}`
        );
        setResult(data);

        // Play warning tone + voice alert once per unique search that has hits
        if (data.hasWarnings && tonePlayedRef.current !== searchName) {
          tonePlayedRef.current = searchName;
          playTone('warning');
          announceScreeningAlerts(data);
        }
      } catch {
        setResult(null);
      } finally {
        setLoading(false);
      }
    }, 500);

    return () => clearTimeout(debounce);
  }, [extractedName]);

  if (!extractedName || extractedName.length < 3) return null;
  if (loading) {
    return (
      <div className="safety-screening">
        <span className="animate-pulse text-[10px] text-rmpg-400 font-mono">SCREENING NAME...</span>
      </div>
    );
  }
  if (!result || (!result.hasWarnings && result.persons.length === 0)) return null;

  const hasActiveWarrants = result.persons.some(p => p.warrants.length > 0) || result.directWarrantHits.length > 0;
  const hasCautionFlags = result.persons.some(p => p.person.caution_flags);
  const hasSexOffender = result.persons.some(p => p.person.is_sex_offender);
  const hasOfac = (result.ofacHits || []).length > 0;
  const hasUtahWarrants = (result.utahWarrantHits || []).length > 0;
  const hasPremise = (result.premiseWarnings || []).length > 0;

  return (
    <div className={`safety-screening ${result.hasWarnings ? 'safety-screening-alert' : ''}`}>
      {/* Main warning banner */}
      {result.hasWarnings && (
        <div className="safety-warning-banner">
          <Shield style={{ width: 12, height: 12 }} />
          <span className="font-bold">OFFICER SAFETY ALERT</span>
          {hasActiveWarrants && <span className="safety-tag safety-tag-warrant">ACTIVE WARRANT</span>}
          {hasOfac && <span className="safety-tag safety-tag-ofac">OFAC SANCTIONS</span>}
          {hasUtahWarrants && <span className="safety-tag safety-tag-warrant">UTAH STATE WARRANT</span>}
          {hasCautionFlags && <span className="safety-tag safety-tag-caution">CAUTION FLAGS</span>}
          {hasSexOffender && <span className="safety-tag safety-tag-sex-offender">SEX OFFENDER</span>}
          {hasPremise && <span className="safety-tag safety-tag-premise">PREMISE HISTORY</span>}
        </div>
      )}

      {/* Person hits */}
      {result.persons.map((item) => (
        <div key={item.person.id} className="safety-person-hit">
          <div
            className="safety-person-header"
            onClick={() => setExpandedPerson(
              expandedPerson === item.person.id ? null : item.person.id
            )}
          >
            <div className="flex items-center gap-1.5">
              <User style={{ width: 10, height: 10, color: item.warrants.length > 0 ? '#ef4444' : '#f59e0b' }} />
              <span className="text-[11px] font-bold text-white">
                {item.person.last_name}, {item.person.first_name}
              </span>
              {item.person.dob && (
                <span className="text-[10px] text-rmpg-400">
                  DOB: {new Date(item.person.dob).toLocaleDateString()}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {item.warrants.length > 0 && (
                <span className="text-[9px] font-bold text-red-400 bg-red-900/30 px-1 border border-red-700/50">
                  {item.warrants.length} WARRANT{item.warrants.length !== 1 ? 'S' : ''}
                </span>
              )}
              {item.person.caution_flags && (
                <span className="text-[9px] font-bold text-amber-400 bg-amber-900/30 px-1 border border-amber-700/50">
                  CAUTION
                </span>
              )}
              {item.person.is_sex_offender && (
                <span className="text-[9px] font-bold text-purple-400 bg-purple-900/30 px-1 border border-purple-700/50">
                  RSO
                </span>
              )}
            </div>
          </div>

          {/* Expanded details */}
          {expandedPerson === item.person.id && (
            <div className="safety-person-detail">
              {/* Caution flags */}
              {item.person.caution_flags && (
                <div className="flex items-start gap-1.5 text-[10px] text-amber-300">
                  <AlertTriangle style={{ width: 10, height: 10, flexShrink: 0, marginTop: 1 }} />
                  <span>{item.person.caution_flags}</span>
                </div>
              )}

              {/* Warrants */}
              {item.warrants.map((w) => (
                <div key={w.id} className="flex items-start gap-1.5 text-[10px]">
                  <Scale style={{ width: 10, height: 10, color: '#ef4444', flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <span className="text-red-400 font-bold uppercase">{w.offense_level}</span>
                    <span className="text-rmpg-300 ml-1">{w.charge_description}</span>
                    {w.bail_amount && (
                      <span className="text-rmpg-500 ml-1">Bail: ${w.bail_amount.toLocaleString()}</span>
                    )}
                  </div>
                </div>
              ))}

              {/* Criminal history (first 3) */}
              {item.criminalHistory.length > 0 && (
                <div className="text-[10px] text-rmpg-400 mt-0.5">
                  <FileWarning style={{ width: 9, height: 9, display: 'inline', marginRight: 4 }} />
                  <span className="font-bold">Criminal History:</span>
                  {item.criminalHistory.slice(0, 3).map((ch) => (
                    <div key={ch.id} className="ml-4 text-rmpg-300">
                      {ch.charge} {ch.disposition && `— ${ch.disposition}`}
                    </div>
                  ))}
                  {item.criminalHistory.length > 3 && (
                    <div className="ml-4 text-rmpg-500">+ {item.criminalHistory.length - 3} more</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Direct warrant hits (not linked to a person record) */}
      {result.directWarrantHits.map((w) => (
        <div key={w.id} className="safety-warrant-direct">
          <Scale style={{ width: 10, height: 10, color: '#ef4444' }} />
          <span className="text-[10px] text-red-400 font-bold uppercase">{w.offense_level} WARRANT</span>
          <span className="text-[10px] text-white">
            {w.subject_last_name}, {w.subject_first_name}
          </span>
          <span className="text-[10px] text-rmpg-300">{w.charge_description}</span>
        </div>
      ))}

      {/* OFAC / U.S. Treasury Sanctions Hits */}
      {hasOfac && (
        <div className="safety-ofac-section">
          <div className="safety-ofac-header">
            <Ban style={{ width: 11, height: 11 }} />
            <span className="font-bold">OFAC SANCTIONS MATCH — {result.ofacHits.length} HIT(S)</span>
          </div>
          {result.ofacHits.map((hit, idx) => (
            <div key={idx} className="safety-ofac-entry">
              <span className="text-[10px] text-red-300 font-bold">{hit.name}</span>
              <span className="text-[9px] text-red-400/80">{hit.program}</span>
              <span className="text-[9px] text-rmpg-400">{hit.source_list} — {hit.type}</span>
            </div>
          ))}
        </div>
      )}

      {/* Utah State Warrant Hits */}
      {hasUtahWarrants && (
        <div className="safety-ofac-section">
          <div className="safety-ofac-header">
            <Scale style={{ width: 11, height: 11 }} />
            <span className="font-bold">UTAH STATE WARRANT — {result.utahWarrantHits.length} HIT(S)</span>
          </div>
          {result.utahWarrantHits.map((hit, idx) => {
            let chargeList: string[] = [];
            try { chargeList = JSON.parse(hit.charges || '[]'); } catch { /* non-JSON */ }
            return (
              <div key={idx} className="safety-ofac-entry">
                <span className="text-[10px] text-red-300 font-bold">
                  {hit.last_name}, {hit.first_name}{hit.middle_name ? ` ${hit.middle_name}` : ''}
                </span>
                {hit.age && <span className="text-[9px] text-rmpg-400">Age {hit.age}</span>}
                {hit.city && <span className="text-[9px] text-rmpg-400">{hit.city}</span>}
                {hit.court_name && (
                  <span className="text-[9px] text-red-400/80">{hit.court_name}</span>
                )}
                {hit.case_id && (
                  <span className="text-[9px] text-rmpg-400">Case #{hit.case_id}</span>
                )}
                {hit.issue_date && (
                  <span className="text-[9px] text-rmpg-500">Issued: {hit.issue_date}</span>
                )}
                {chargeList.length > 0 && (
                  <div className="text-[9px] text-red-400/90 mt-0.5">
                    {chargeList.map((c, ci) => <div key={ci}>• {c}</div>)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Premise History Warnings */}
      {hasPremise && (
        <div className="safety-premise-section">
          <div className="safety-premise-header">
            <MapPin style={{ width: 10, height: 10 }} />
            <span className="font-bold">PREMISE HISTORY</span>
          </div>
          <div className="flex flex-wrap gap-1 px-2 pb-1">
            {result.premiseWarnings.map((w, idx) => (
              <span key={idx} className="safety-premise-tag">
                {w === 'ARMED_HISTORY' ? '⚠ PRIOR ARMED CALLS' :
                 w === 'DV_HISTORY' ? '⚠ PRIOR DV CALLS' :
                 w === 'DRUGS_HISTORY' ? '⚠ PRIOR DRUG ACTIVITY' : w}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
