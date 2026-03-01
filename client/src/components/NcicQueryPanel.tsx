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
  formatNoRecord,
  type NcicPerson,
  type NcicVehicle,
  type NcicCriminalHistory,
  type NcicWarrant,
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
      const cmdMap = { person: 'QH', vehicle: 'QV', warrant: 'QW' };
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

        default:
          response = `UNKNOWN QUERY TYPE: ${verb}\nValid: QH/QP (person), QV (vehicle), QW (warrant)`;
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
║  QH <name>     Query Person / History    ║
║  QV <plate>    Query Vehicle             ║
║  QW <name>     Query Warrants            ║
╚══════════════════════════════════════════╝`}</pre>
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
            placeholder="QH SMITH, JOHN  |  QV ABC1234  |  QW DOE"
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
║  QH <name>     Query Person / History    ║
║  QV <plate>    Query Vehicle             ║
║  QW <name>     Query Warrants            ║
╚══════════════════════════════════════════╝`}</pre>
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
            placeholder="QH SMITH, JOHN  |  QV ABC1234  |  QW DOE"
            spellCheck={false}
            autoComplete="off"
            disabled={loading}
          />
        </div>
      </div>
    </div>
  );
}
