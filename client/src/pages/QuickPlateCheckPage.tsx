import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Search, X, AlertTriangle, Car, User, MapPin, FileText, Clock, ChevronDown } from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import { apiFetch } from '../hooks/useApi';
import { parseTimestamp } from '../utils/dateUtils';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
  'NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
  'VT','VA','WA','WV','WI','WY',
];

const HISTORY_KEY = 'rmpg_plate_history';
const MAX_HISTORY = 10;

interface VehicleSighting {
  id: number;
  latitude: number;
  longitude: number;
  location_description?: string;
  created_at: string;
  officer_name?: string;
}

interface VehicleRecord {
  id: number;
  plate_number: string;
  plate_state?: string;
  year?: number;
  make?: string;
  model?: string;
  color_primary?: string;
  body_type?: string;
  owner_name?: string;
  registration_status?: string;
  registration_expiry?: string;
  is_stolen?: number | boolean;
  stolen_status?: string;
  warrant_count?: number;
  recent_sightings?: VehicleSighting[];
}

interface PlateHistoryEntry {
  plate: string;
  state: string;
  ts: number;
}

function loadHistory(): PlateHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as PlateHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(plate: string, state: string): void {
  const existing = loadHistory().filter(
    (e) => !(e.plate === plate && e.state === state)
  );
  const updated: PlateHistoryEntry[] = [
    { plate, state, ts: Date.now() },
    ...existing,
  ].slice(0, MAX_HISTORY);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch {
    // storage full — best effort
  }
}

function formatTs(ts: number): string {
  const d = new Date(ts); // new-date-ok — numeric Unix ms, not a D1 string
  return d.toLocaleTimeString('en-US', { timeZone: 'America/Denver', hour: '2-digit', minute: '2-digit' });
}

function formatSightingTs(raw: string): string {
  const d = parseTimestamp(raw);
  return d.toLocaleString('en-US', {
    timeZone: 'America/Denver',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function QuickPlateCheckPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [plate, setPlate] = useState('');
  const [state, setState] = useState('UT');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VehicleRecord | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<PlateHistoryEntry[]>([]);

  useEffect(() => {
    setHistory(loadHistory());
    inputRef.current?.focus();
  }, []);

  const runPlate = useCallback(
    async (plateVal: string, stateVal: string) => {
      const p = plateVal.trim().toUpperCase();
      if (!p) return;
      setLoading(true);
      setResult(null);
      setNotFound(false);
      setError(null);
      try {
        const data = await apiFetch<VehicleRecord>(
          `/records/vehicles?plate=${encodeURIComponent(p)}&state=${encodeURIComponent(stateVal)}`
        );
        if (data && data.id) {
          setResult(data);
          saveHistory(p, stateVal);
          setHistory(loadHistory());
        } else {
          setNotFound(true);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
          setNotFound(true);
        } else {
          setError(msg || 'Lookup failed');
        }
      } finally {
        setLoading(false);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    },
    []
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runPlate(plate, state);
  };

  const handleClear = () => {
    setPlate('');
    setResult(null);
    setNotFound(false);
    setError(null);
    inputRef.current?.focus();
  };

  const isStolen =
    result?.is_stolen === true ||
    result?.is_stolen === 1 ||
    (typeof result?.stolen_status === 'string' &&
      result.stolen_status.toLowerCase().includes('active') &&
      result.stolen_status.toLowerCase().includes('theft'));

  const regStatus = result?.registration_status?.toLowerCase() ?? '';
  const regColor =
    regStatus === 'valid'
      ? 'var(--sev-ok, var(--sev-ok))'
      : regStatus === 'expired'
      ? 'var(--sev-warn, var(--sev-warn))'
      : regStatus === 'suspended'
      ? 'var(--sev-critical, var(--sev-critical))'
      : 'var(--text-secondary)';

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--surface-base)',
        color: 'var(--text-primary)',
        padding: '0',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <PanelTitleBar title="QUICK PLATE CHECK" icon={Car} />

      <div
        style={{
          flex: 1,
          maxWidth: 780,
          width: '100%',
          margin: '0 auto',
          padding: '20px 16px 40px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {/* Search form */}
        <form onSubmit={handleSubmit}>
          <div
            style={{
              background: 'var(--surface-raised)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 2,
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
              {/* State selector */}
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <select
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  style={{
                    appearance: 'none',
                    background: 'var(--surface-sunken)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 2,
                    color: 'var(--text-primary)',
                    fontSize: 14,
                    fontWeight: 600,
                    height: '100%',
                    padding: '0 28px 0 10px',
                    cursor: 'pointer',
                    minWidth: 72,
                  }}
                >
                  {US_STATES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={12}
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    pointerEvents: 'none',
                    color: 'var(--text-secondary)',
                  }}
                />
              </div>

              {/* Plate input */}
              <div style={{ flex: 1, position: 'relative' }}>
                <input
                  ref={inputRef}
                  type="text"
                  value={plate}
                  onChange={(e) =>
                    setPlate(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                  }
                  placeholder="PLATE NUMBER"
                  maxLength={10}
                  autoComplete="off"
                  spellCheck={false}
                  style={{
                    width: '100%',
                    background: 'var(--surface-sunken)',
                    border: '2px solid var(--border-default)',
                    borderRadius: 2,
                    color: 'var(--text-primary)',
                    fontSize: 28,
                    fontWeight: 700,
                    letterSpacing: '0.15em',
                    padding: '10px 44px 10px 14px',
                    outline: 'none',
                    fontFamily: 'Arial, sans-serif',
                    boxSizing: 'border-box',
                    transition: 'border-color 0.15s',
                  }}
                  onFocus={(e) =>
                    (e.currentTarget.style.borderColor = 'var(--brand-400)')
                  }
                  onBlur={(e) =>
                    (e.currentTarget.style.borderColor = 'var(--border-default)')
                  }
                />
                {plate && (
                  <button
                    type="button"
                    onClick={handleClear}
                    style={{
                      position: 'absolute',
                      right: 10,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-secondary)',
                      padding: 4,
                      display: 'flex',
                      alignItems: 'center',
                    }}
                    aria-label="Clear plate input"
                  >
                    <X size={18} />
                  </button>
                )}
              </div>

              {/* Run button */}
              <button
                type="submit"
                disabled={!plate.trim() || loading}
                style={{
                  background:
                    !plate.trim() || loading
                      ? 'var(--surface-sunken)'
                      : 'var(--brand-600)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 2,
                  color:
                    !plate.trim() || loading
                      ? 'var(--text-secondary)'
                      : 'var(--text-primary)',
                  cursor: !plate.trim() || loading ? 'not-allowed' : 'pointer',
                  fontWeight: 700,
                  fontSize: 13,
                  letterSpacing: '0.08em',
                  padding: '0 24px',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  transition: 'background 0.15s',
                }}
              >
                <Search size={16} />
                {loading ? 'RUNNING…' : 'RUN PLATE'}
              </button>
            </div>

            <p style={{ margin: 0, fontSize: 11, color: 'var(--text-secondary)' }}>
              Enter key submits &middot; Letters and numbers only &middot; Auto-uppercased
            </p>
          </div>
        </form>

        {/* Error */}
        {error && (
          <div
            style={{
              background: 'color-mix(in srgb, var(--sev-critical) 12%, var(--surface-raised))',
              border: '1px solid var(--sev-critical)',
              borderRadius: 2,
              padding: '12px 16px',
              color: 'var(--sev-critical)',
              fontSize: 13,
              display: 'flex',
              gap: 8,
              alignItems: 'center',
            }}
          >
            <AlertTriangle size={15} />
            {error}
          </div>
        )}

        {/* Not found */}
        {notFound && (
          <div
            style={{
              background: 'var(--surface-raised)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 2,
              padding: '20px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              alignItems: 'center',
              textAlign: 'center',
            }}
          >
            <Car size={32} style={{ color: 'var(--text-secondary)' }} />
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)' }}>
              No record found — vehicle may not be in system.
            </p>
            <a
              href={`/records?plate=${encodeURIComponent(plate.trim())}`}
              style={{
                background: 'var(--surface-sunken)',
                border: '1px solid var(--border-default)',
                borderRadius: 2,
                color: 'var(--text-primary)',
                fontSize: 12,
                fontWeight: 600,
                padding: '6px 14px',
                textDecoration: 'none',
                letterSpacing: '0.05em',
              }}
            >
              + CREATE VEHICLE RECORD
            </a>
          </div>
        )}

        {/* Results */}
        {result && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Stolen banner */}
            {isStolen && (
              <div
                style={{
                  background: 'var(--sev-critical)',
                  borderRadius: 2,
                  padding: '14px 20px',
                  display: 'flex',
                  gap: 12,
                  alignItems: 'center',
                }}
              >
                <AlertTriangle size={22} style={{ color: '#fff', flexShrink: 0 }} />
                <span
                  style={{
                    color: '#fff',
                    fontWeight: 800,
                    fontSize: 16,
                    letterSpacing: '0.06em',
                  }}
                >
                  STOLEN — DO NOT APPROACH
                </span>
              </div>
            )}

            {/* Vehicle info */}
            <div
              style={{
                background: 'var(--surface-raised)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 2,
                padding: '16px 18px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Car size={15} style={{ color: 'var(--field-label-color)' }} />
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: 'var(--field-label-color)',
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                      }}
                    >
                      Vehicle
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span
                      style={{
                        fontFamily: 'Arial, sans-serif',
                        fontSize: 22,
                        fontWeight: 700,
                        letterSpacing: '0.12em',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {result.plate_number}
                    </span>
                    {result.plate_state && (
                      <span
                        style={{
                          fontSize: 12,
                          color: 'var(--text-secondary)',
                          fontWeight: 600,
                        }}
                      >
                        {result.plate_state}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 500 }}>
                    {[result.year, result.make, result.model]
                      .filter(Boolean)
                      .join(' ') || '—'}
                    {result.color_primary && (
                      <span style={{ color: 'var(--text-secondary)', marginLeft: 8 }}>
                        {result.color_primary}
                        {result.body_type ? ` · ${result.body_type}` : ''}
                      </span>
                    )}
                  </div>
                </div>

                <a
                  href={`/records?plate=${encodeURIComponent(result.plate_number)}`}
                  style={{
                    background: 'var(--surface-sunken)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 2,
                    color: 'var(--text-primary)',
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '6px 12px',
                    textDecoration: 'none',
                    letterSpacing: '0.06em',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    gap: 6,
                    alignItems: 'center',
                  }}
                >
                  <FileText size={12} />
                  OPEN FULL DOSSIER
                </a>
              </div>

              {/* Detail grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                  gap: '10px 20px',
                  marginTop: 16,
                  paddingTop: 14,
                  borderTop: '1px solid var(--border-subtle)',
                }}
              >
                {/* Owner */}
                <div>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: 'var(--field-label-color)',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      marginBottom: 3,
                    }}
                  >
                    Owner
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: 'var(--text-primary)',
                      display: 'flex',
                      gap: 5,
                      alignItems: 'center',
                    }}
                  >
                    <User size={11} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                    {result.owner_name || 'Unknown'}
                  </div>
                </div>

                {/* Registration */}
                <div>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: 'var(--field-label-color)',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      marginBottom: 3,
                    }}
                  >
                    Registration
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: regColor,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    {result.registration_status || 'Unknown'}
                    {result.registration_expiry && (
                      <span
                        style={{
                          fontWeight: 400,
                          fontSize: 11,
                          color: 'var(--text-secondary)',
                          marginLeft: 6,
                          textTransform: 'none',
                          letterSpacing: 0,
                        }}
                      >
                        exp {result.registration_expiry}
                      </span>
                    )}
                  </div>
                </div>

                {/* Warrants */}
                <div>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: 'var(--field-label-color)',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      marginBottom: 3,
                    }}
                  >
                    Warrant Hits
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color:
                        (result.warrant_count ?? 0) > 0
                          ? 'var(--sev-critical)'
                          : 'var(--text-secondary)',
                    }}
                  >
                    {result.warrant_count ?? 0}
                  </div>
                </div>
              </div>
            </div>

            {/* Recent sightings */}
            {result.recent_sightings && result.recent_sightings.length > 0 && (
              <div
                style={{
                  background: 'var(--surface-raised)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 2,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    padding: '10px 16px',
                    borderBottom: '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                  }}
                >
                  <MapPin size={13} style={{ color: 'var(--field-label-color)' }} />
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--field-label-color)',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                    }}
                  >
                    Recent Sightings
                  </span>
                </div>
                <div>
                  {result.recent_sightings.map((s, i) => (
                    <div
                      key={s.id ?? i}
                      style={{
                        padding: '8px 16px',
                        borderBottom:
                          i < (result.recent_sightings?.length ?? 0) - 1
                            ? '1px solid var(--border-subtle)'
                            : 'none',
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 12,
                        alignItems: 'center',
                      }}
                    >
                      <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                        {s.location_description ||
                          `${s.latitude?.toFixed(4)}, ${s.longitude?.toFixed(4)}`}
                        {s.officer_name && (
                          <span style={{ color: 'var(--text-secondary)', marginLeft: 8 }}>
                            · {s.officer_name}
                          </span>
                        )}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          color: 'var(--text-secondary)',
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                        }}
                      >
                        {formatSightingTs(s.created_at)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Search history */}
        {history.length > 0 && (
          <div
            style={{
              background: 'var(--surface-raised)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '10px 16px',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                gap: 7,
              }}
            >
              <Clock size={13} style={{ color: 'var(--field-label-color)' }} />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--field-label-color)',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                Recent Searches
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '10px 14px' }}>
              {history.map((h, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setPlate(h.plate);
                    setState(h.state);
                    runPlate(h.plate, h.state);
                  }}
                  style={{
                    background: 'var(--surface-sunken)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 2,
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontFamily: 'Arial, sans-serif',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    padding: '4px 10px',
                    display: 'flex',
                    gap: 5,
                    alignItems: 'center',
                  }}
                  title={`Run ${h.state} · ${h.plate} (${formatTs(h.ts)})`}
                >
                  <span style={{ color: 'var(--text-secondary)', fontWeight: 400, fontSize: 10 }}>
                    {h.state}
                  </span>
                  {h.plate}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
