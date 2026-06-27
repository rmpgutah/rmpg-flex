// ============================================================
// RMPG Flex — NSOPW Nationwide SOR Cross-Reference panel.
// ------------------------------------------------------------
// Direct user-facing component for the user's stated requirement:
// "nationwide SOR pull, cross-ref name and DOB."
//
// Mounted on NsopwLookupPage at /nsopw — the canonical Sex Offender
// Registry tab. (The legacy Utah-only and RMPG-internal SOR pages
// were consolidated into this surface.)
//
// Talks to /api/nsopw/* — the dedicated route, NOT the generic
// /api/screening/search. That route accepts `dob` end-to-end so
// the strict-match policy (auto-confirm only on name + DOB) can
// actually fire.
// ============================================================

import { useState, useCallback, useEffect, useRef } from 'react';
import { Search, Loader2, Shield, AlertTriangle, MapPin, User, RefreshCw, Building, Printer } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from './PanelTitleBar';
import { openOffenderRegistrationCardPdf } from '../utils/offenderRegistrationCardPdf';
import { useAuth } from '../context/AuthContext';
import { useToast } from './ToastProvider';

interface OffenderCard {
  nsopwOffenderId: string;
  jurisdiction: string;
  jurisdictionLabel: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  dateOfBirth: string | null;
  sex: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  offense: string | null;
  riskLevel: string | null;
  tier: number | null;
  registrationStatus: string | null;
  photoUrl: string | null;
  /** Worker-served URL for the locally persisted photo (R2-backed). When
   *  set, the client prefers this over the upstream `photoUrl` so we serve
   *  our copy, not the state SOR site. */
  localPhotoUrl: string | null;
  rowId: number | null;
  /** Auto-created (or matched) canonical persons.id. Deep-links to the
   *  Records UI. */
  personId: number | null;
  /** Auto-created (or matched) canonical properties.id per non-transient
   *  location. The UI exposes each with a "View Property" button. */
  linkedProperties: Array<{
    propertyId: number;
    locationType: string;
    locationName: string | null;
  }>;
  detailUrl: string | null;
  raw?: unknown;
}

interface Classified {
  offender: OffenderCard;
  classification: 'confirmed' | 'possible' | 'excluded';
  score: number;
  matchedFields: string[];
  reason: string;
}

interface NsopwResult {
  query: { surname: string; forename: string; dob?: string };
  configured: boolean;
  cacheHit: boolean;
  confirmed: Classified[];
  possible: Classified[];
  excluded: number;
  jurisdictionCoverage: Record<string, string>;
  runId: number | null;
  error?: string;
}

interface Props {
  initialSurname?: string;
  initialForename?: string;
  initialDob?: string;
  /** When set, fetch + render this single offender on mount (deep-link from
   *  another page or a saved URL). Accepted on /nsopw + the legacy
   *  /offender-registry + /sex-offender-registry routes (all redirect here
   *  with the query param preserved). */
  initialOffenderId?: string;
  /** When true, auto-fire the search on mount (e.g. when embedded in a
   *  person dossier flow). Defaults to false. */
  autoSearch?: boolean;
  /** Compact mode trims spacing for embedding inside another panel. */
  compact?: boolean;
  /** Called after the deep-link offender_id is consumed so the parent can
   *  strip it from the URL via setSearchParams (constraint: no window.history). */
  onClearOffenderId?: () => void;
}

export default function NsopwSearchPanel({
  initialSurname = '', initialForename = '', initialDob = '', initialOffenderId,
  autoSearch = false, compact = false, onClearOffenderId,
}: Props) {
  const { user } = useAuth();
  const { addToast } = useToast();
  // canPrint: admin/manager/supervisor may print court-ready offender cards.
  const canPrint = !!(
    user?.role === 'admin' || user?.role === 'manager' || user?.role === 'supervisor'
  );

  const [surname, setSurname] = useState(initialSurname);
  const [forename, setForename] = useState(initialForename);
  const [dob, setDob] = useState(initialDob);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<NsopwResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Set when a deep-link by offender_id resolved to a single offender — we
   *  render it inline as a synthetic single-card "possible" panel so the
   *  print + person-record links work the same as the normal flow. */
  const [deepLinkOffender, setDeepLinkOffender] = useState<Classified | null>(null);

  const search = useCallback(async () => {
    if (!surname.trim() || !forename.trim()) {
      setError('Last name and first name are required.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        name: surname.trim(),
        forename: forename.trim(),
      });
      if (dob.trim()) params.set('dob', dob.trim());
      const r = await apiFetch<NsopwResult>(`/nsopw/search?${params.toString()}`);
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [surname, forename, dob]);

  // Optional auto-fire on mount. Guarded against React strict-mode
  // double-invoke with a ref. The server is idempotent on cache hits
  // anyway, but this avoids the spurious 2x run-log row in dev.
  const autoFiredRef = useRef(false);
  useEffect(() => {
    if (autoSearch && !autoFiredRef.current && initialSurname && initialForename) {
      autoFiredRef.current = true;
      void search();
    }
  }, [autoSearch, initialSurname, initialForename, search]);

  // Deep-link by offender_id. Fetches the raw national_sex_offenders row from
  // /api/nsopw/offender/:id and renders it as a single-card "possible" match
  // (no classification info is available outside the screening pipeline; the
  // operator can see the full record + print, which is the operational point).
  // Strips the param after applying so a refresh doesn't loop.
  const deepLinkFiredRef = useRef(false);
  useEffect(() => {
    if (deepLinkFiredRef.current || !initialOffenderId) return;
    deepLinkFiredRef.current = true;
    const id = initialOffenderId;
    let cancelled = false;
    (async () => {
      try {
        const row = await apiFetch<Record<string, unknown>>(`/nsopw/offender/${encodeURIComponent(id)}`);
        if (cancelled || !row || typeof row !== 'object') return;
        const offender = mapRowToOffenderCard(row);
        setDeepLinkOffender({
          offender,
          classification: 'possible',
          score: 0,
          matchedFields: [],
          reason: `direct offender_id=${id} load`,
        });
        addToast(`Offender #${id} loaded from deep link`, 'info');
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : `failed to load offender ${id}`;
          setError(msg);
          addToast(`Offender #${id} not found`, 'error');
        }
      } finally {
        if (!cancelled) {
          // Notify parent to strip offender_id from URL via setSearchParams
          // (constraint: no window.history.replaceState).
          onClearOffenderId?.();
        }
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOffenderId]);

  // N shortcut — focus Last Name field when not typing in a form element.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        document.getElementById('ff-nsopw-surname')?.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  // Esc cascade — clears error → results → deep-link offender card in order.
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (error) { e.stopPropagation(); setError(null); return; }
      if (result) { e.stopPropagation(); setResult(null); return; }
      if (deepLinkOffender) { e.stopPropagation(); setDeepLinkOffender(null); return; }
    };
    document.addEventListener('keydown', handleEsc, true);
    return () => document.removeEventListener('keydown', handleEsc, true);
  }, [error, result, deepLinkOffender]);

  const sp = compact ? 'space-y-2' : 'space-y-3';
  return (
    <div className={`${sp} text-[11px]`}>
      {!compact && (
        <PanelTitleBar title="NSOPW NATIONWIDE CROSS-REFERENCE" icon={Shield} />
      )}

      {/* Search form ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <div>
          <label htmlFor="ff-nsopw-surname"
            className="text-[9px] uppercase text-rmpg-400 font-bold">Last Name *</label>
          <input id="ff-nsopw-surname" type="text" value={surname}
            onChange={(e) => setSurname(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            className="w-full bg-surface-sunken border border-border-subtle px-2 py-1 text-[11px]" />
        </div>
        <div>
          <label htmlFor="ff-nsopw-forename"
            className="text-[9px] uppercase text-rmpg-400 font-bold">First Name *</label>
          <input id="ff-nsopw-forename" type="text" value={forename}
            onChange={(e) => setForename(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            className="w-full bg-surface-sunken border border-border-subtle px-2 py-1 text-[11px]" />
        </div>
        <div>
          <label htmlFor="ff-nsopw-dob"
            className="text-[9px] uppercase text-rmpg-400 font-bold">DOB (recommended)</label>
          <input id="ff-nsopw-dob" type="text" value={dob}
            onChange={(e) => setDob(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="YYYY-MM-DD"
            className="w-full bg-surface-sunken border border-border-subtle px-2 py-1 text-[11px]" />
        </div>
        <div className="flex items-end">
          <button onClick={() => void search()} disabled={loading}
            className="flex items-center gap-1 bg-brand-700 hover:bg-brand-600 disabled:opacity-50 px-3 py-1 text-[11px] uppercase font-bold">
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
            {loading ? 'Searching all 50 states…' : 'Cross-reference'}
          </button>
        </div>
      </div>

      {/* DOB caveat ─────────────────────────────────────── */}
      {!dob.trim() && (
        <div className="text-[10px] text-amber-400 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" />
          Without DOB, no candidate can auto-confirm. All matches will surface as
          &ldquo;possible&rdquo; for review.
        </div>
      )}

      {error && (
        <div className="bg-red-950/40 border border-red-700/50 text-red-300 px-2 py-1 text-[11px]">
          {error}
        </div>
      )}

      {/* Deep-link single offender — rendered above ResultView when set. */}
      {deepLinkOffender && (
        <Section title="OFFENDER (DEEP LINK)" tone="amber"
          subtitle="Loaded directly by URL — operator review required (no name/DOB cross-check was performed).">
          <OffenderRow c={deepLinkOffender} queryContext={{ surname, forename, dob }} canPrint={canPrint} />
        </Section>
      )}

      {result && (
        <ResultView result={result} onRetry={() => void search()}
          queryContext={{ surname, forename, dob }} canPrint={canPrint} />
      )}

      {/* First-load empty state — distinguishes "no search yet" from
          "search ran with zero matches" (which lives inside ResultView). */}
      {!result && !deepLinkOffender && !loading && !error && (
        <div className="bg-surface-raised border border-border-subtle px-2 py-3 text-[11px] text-rmpg-300 flex items-start gap-2">
          <Search className="w-3 h-3 mt-0.5 flex-shrink-0 text-rmpg-400" />
          <div>
            <div className="font-bold text-rmpg-200">Enter a subject name to cross-reference.</div>
            <div className="text-[10px] text-rmpg-400">
              The search federates across all 50 states + territories + tribes
              in one query. DOB enables strict-match auto-confirmation; without
              it everything surfaces as &ldquo;possible&rdquo; for review.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Maps a raw national_sex_offenders DB row (returned by GET /api/nsopw/offender/:id)
// to the OffenderCard shape the rest of the panel expects. Snake-case columns
// → camelCase fields; nullable string columns → null when blank; numeric
// jurisdiction tier passes through. Kept separate from the panel render so
// the deep-link path doesn't duplicate the search-result mapping.
function mapRowToOffenderCard(row: Record<string, unknown>): OffenderCard {
  const s = (k: string): string | null => {
    const v = row[k];
    return typeof v === 'string' && v.trim() ? v : null;
  };
  const n = (k: string): number | null => {
    const v = row[k];
    return typeof v === 'number' ? v : null;
  };
  return {
    nsopwOffenderId: s('nsopw_offender_id') ?? '',
    jurisdiction: s('jurisdiction') ?? '',
    jurisdictionLabel: s('jurisdiction_label') ?? '',
    firstName: s('first_name') ?? '',
    middleName: s('middle_name'),
    lastName: s('last_name') ?? '',
    dateOfBirth: s('date_of_birth'),
    sex: s('sex'),
    address: s('address'),
    city: s('city'),
    state: s('state'),
    zip: s('zip'),
    offense: s('offense'),
    riskLevel: s('risk_level'),
    tier: n('tier'),
    registrationStatus: s('registration_status'),
    photoUrl: s('photo_url'),
    localPhotoUrl: s('local_photo_url'),
    rowId: n('id'),
    personId: n('person_id'),
    linkedProperties: [],
    detailUrl: s('detail_url'),
  };
}

// ────────────────────────────────────────────────────────────

function ResultView({ result, onRetry, queryContext, canPrint }: {
  result: NsopwResult;
  onRetry: () => void;
  queryContext?: { surname?: string; forename?: string; dob?: string };
  canPrint?: boolean;
}) {
  if (!result.configured) {
    return (
      <div className="bg-amber-950/40 border border-amber-700/50 text-amber-300 px-2 py-2 text-[11px]">
        <div className="font-bold flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" /> NSOPW is not configured.
        </div>
        <div className="mt-1">
          The DOJ NSOPW Web Service requires a Memorandum of Understanding. Once
          the MOU is in place and <code>NSOPW_API_KEY</code> is set on the Worker,
          this panel will federate searches across all 50 states + territories +
          tribes. A blank result here right now <strong>CANNOT</strong> confirm
          that a subject is not nationally registered.
        </div>
      </div>
    );
  }

  if (result.error) {
    return (
      <div className="bg-red-950/40 border border-red-700/50 text-red-300 px-2 py-2 text-[11px]">
        NSOPW error: {result.error}
        <button onClick={onRetry}
          className="ml-2 underline text-red-200">retry</button>
      </div>
    );
  }

  const total = result.confirmed.length + result.possible.length;

  return (
    <div className="space-y-2">
      {/* Summary line */}
      <div className="flex items-center gap-3 text-[11px] border-b border-border-subtle pb-1">
        <span className={`font-bold ${result.confirmed.length > 0 ? 'text-red-400' :
          result.possible.length > 0 ? 'text-amber-400' : 'text-green-400'}`}>
          {result.confirmed.length} confirmed · {result.possible.length} possible
          {result.excluded > 0 && ` · ${result.excluded} excluded`}
        </span>
        {result.cacheHit && (
          <span className="text-[10px] text-rmpg-400">
            (cached · <button onClick={onRetry} className="underline">re-query live</button>)
          </span>
        )}
        <button onClick={onRetry}
          className="ml-auto flex items-center gap-1 text-[10px] text-rmpg-300 hover:text-white">
          <RefreshCw className="w-3 h-3" /> Re-query
        </button>
      </div>

      {/* Coverage warnings */}
      <CoverageBar coverage={result.jurisdictionCoverage} />

      {/* Confirmed (red) */}
      {result.confirmed.length > 0 && (
        <Section title="CONFIRMED MATCHES" tone="red"
          subtitle="Name + DOB matched exactly. High confidence.">
          {result.confirmed.map((c) => (
            <OffenderRow key={`${c.offender.jurisdiction}:${c.offender.nsopwOffenderId}`} c={c}
              queryContext={queryContext} canPrint={canPrint} />
          ))}
        </Section>
      )}

      {/* Possible (amber) */}
      {result.possible.length > 0 && (
        <Section title="POSSIBLE MATCHES" tone="amber"
          subtitle="Borderline — needs officer review (no DOB, phonetic name, or partial match).">
          {result.possible.map((c) => (
            <OffenderRow key={`${c.offender.jurisdiction}:${c.offender.nsopwOffenderId}`} c={c}
              queryContext={queryContext} canPrint={canPrint} />
          ))}
        </Section>
      )}

      {total === 0 && (
        <div className="bg-green-950/40 border border-green-700/50 text-green-300 px-2 py-2 text-[11px]">
          <div className="font-bold flex items-center gap-1">
            <Shield className="w-3 h-3" />
            No nationwide SOR matches for the cross-reference at this time.
          </div>
          <div className="mt-1 text-[10px]">
            This is a point-in-time result. Subjects newly registered after the
            most recent jurisdiction sync (within 7 days for most states) may
            not yet be reflected.
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, subtitle, tone, children }: {
  title: string; subtitle?: string; tone: 'red' | 'amber';
  children: React.ReactNode;
}) {
  const border = tone === 'red' ? 'border-red-700/60' : 'border-amber-700/60';
  const bar = tone === 'red' ? 'bg-red-950/40' : 'bg-amber-950/40';
  return (
    <div className={`border ${border} ${bar}`}>
      <div className={`px-2 py-1 border-b ${border}`}>
        <div className="font-bold text-[10px] uppercase tracking-wider">{title}</div>
        {subtitle && <div className="text-[9px] text-rmpg-300">{subtitle}</div>}
      </div>
      <div className="divide-y divide-border-subtle">{children}</div>
    </div>
  );
}

function OffenderRow({ c, queryContext, canPrint }: {
  c: Classified;
  queryContext?: { surname?: string; forename?: string; dob?: string };
  canPrint?: boolean;
}) {
  const o = c.offender;
  // Prefer the locally persisted photo (worker-served from R2) over the
  // upstream state-SOR host. If the local copy 404s (e.g. download still
  // in-flight from the just-issued query), fall back to upstream.
  return (
    <div className="px-2 py-2 grid grid-cols-[auto_1fr_auto] gap-2 items-start">
      {(o.localPhotoUrl || o.photoUrl) ? (
        <PhotoWithFallback
          local={o.localPhotoUrl}
          remote={o.photoUrl}
          className="w-16 h-20 object-cover bg-surface-sunken"
        />
      ) : (
        <div className="w-16 h-20 bg-surface-sunken flex items-center justify-center">
          <User className="w-6 h-6 text-rmpg-400" />
        </div>
      )}
      <div className="text-[11px] space-y-0.5">
        <div className="font-bold">
          {[o.firstName, o.middleName, o.lastName].filter(Boolean).join(' ')}
          {o.dateOfBirth && (
            <span className="ml-2 text-rmpg-300 font-normal">DOB {o.dateOfBirth}</span>
          )}
          {o.sex && (
            <span className="ml-2 text-rmpg-300 font-normal">{o.sex}</span>
          )}
        </div>
        <div className="text-rmpg-200">
          <span className="text-rmpg-400">{o.jurisdictionLabel || o.jurisdiction}</span>
          {o.riskLevel && (
            <span className="ml-2 text-amber-300">Tier: {o.riskLevel}</span>
          )}
          {o.registrationStatus && (
            <span className="ml-2 text-rmpg-300">· {o.registrationStatus}</span>
          )}
        </div>
        {o.offense && <div className="text-rmpg-200">{o.offense}</div>}
        {(o.address || o.city) && (
          <div className="text-rmpg-300 flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            {[o.address, o.city, o.state, o.zip].filter(Boolean).join(', ')}
          </div>
        )}
        <div className="text-[10px] text-rmpg-400 italic">
          Match: {c.matchedFields.join(', ') || 'none'} · score {c.score.toFixed(2)} · {c.reason}
        </div>
        {/* Canonical records links — auto-created if missing. */}
        {(o.personId || (o.linkedProperties && o.linkedProperties.length > 0)) && (
          <div className="flex flex-wrap gap-1 mt-1">
            {o.personId && (
              <a href={`/records?tab=persons&personId=${o.personId}`}
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-surface-raised border border-border-subtle hover:bg-surface-sunken"
                title="Open this person's RMPG record">
                <User className="w-2.5 h-2.5" /> Person Record
              </a>
            )}
            {(o.linkedProperties ?? []).map((p) => (
              <a key={p.propertyId} href={`/records?tab=properties&propertyId=${p.propertyId}`}
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-surface-raised border border-border-subtle hover:bg-surface-sunken"
                title={`Open property record (${p.locationType.toLowerCase()})`}>
                <Building className="w-2.5 h-2.5" />
                {p.locationType === 'RESIDENCE' ? 'Residence'
                  : p.locationType === 'WORK' ? 'Work'
                  : p.locationType === 'STUDENT' ? 'School'
                  : 'Property'}
              </a>
            ))}
          </div>
        )}
      </div>
      <div className="text-right flex flex-col items-end gap-1">
        {canPrint && (
          <button
            type="button"
            onClick={() => void printOffenderCard(c, queryContext)}
            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-surface-raised border border-border-subtle hover:bg-surface-sunken"
            title="Print court-ready Offender Identification Card"
            aria-label="Print Offender Identification Card"
          >
            <Printer className="w-3 h-3" /> Print
          </button>
        )}
        {o.detailUrl && (
          <a href={o.detailUrl} target="_blank" rel="noopener noreferrer"
            className="text-[10px] underline text-rmpg-300 hover:text-white">
            jurisdiction record →
          </a>
        )}
      </div>
    </div>
  );
}

// Wires the inline Print button to the court-ready PDF generator. Best-effort
// photo embed: prefers the locally persisted R2-served photo (private, auth-
// gated) so the PDF doesn't depend on the upstream state-SOR host being up.
// On any fetch / decode failure the PDF falls back to a "no photo on file"
// placeholder — we never block the print path on photo availability.
async function printOffenderCard(
  c: Classified,
  queryContext?: { surname?: string; forename?: string; dob?: string },
): Promise<void> {
  const o = c.offender;
  let photoDataUrl: string | null = null;
  // Prefer the local (R2-backed) URL so the PDF embeds bytes we control.
  const src = o.localPhotoUrl || o.photoUrl;
  if (src) {
    try {
      photoDataUrl = await fetchImageAsDataUrl(src);
    } catch {
      photoDataUrl = null;
    }
  }
  openOffenderRegistrationCardPdf({
    offender: {
      nsopwOffenderId: o.nsopwOffenderId,
      jurisdiction: o.jurisdiction,
      jurisdictionLabel: o.jurisdictionLabel,
      firstName: o.firstName,
      middleName: o.middleName,
      lastName: o.lastName,
      dateOfBirth: o.dateOfBirth,
      sex: o.sex,
      address: o.address,
      city: o.city,
      state: o.state,
      zip: o.zip,
      offense: o.offense,
      riskLevel: o.riskLevel,
      tier: o.tier,
      registrationStatus: o.registrationStatus,
      detailUrl: o.detailUrl,
      rowId: o.rowId,
      personId: o.personId,
      linkedProperties: o.linkedProperties ?? [],
    },
    classification: c.classification,
    score: c.score,
    matchedFields: c.matchedFields,
    reason: c.reason,
    photoDataUrl,
    queryContext: queryContext ?? null,
  });
}

// Fetch an image URL into a base64 data URL so jsPDF can embed the bytes
// without a cross-origin <img> handshake. Uses apiFetch's same-origin cookies
// when the URL is a same-origin worker route (e.g. /api/nsopw/photo/...);
// falls back to a plain fetch for the upstream state-SOR URL. 5s timeout so
// a slow state SOR host can't hang the operator's Print click.
async function fetchImageAsDataUrl(url: string): Promise<string> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { credentials: 'same-origin', signal: controller.signal });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error('reader error'));
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.readAsDataURL(blob);
    });
  } finally {
    clearTimeout(t);
  }
}

// Renders the locally persisted photo first; on load error (e.g. local copy
// not in R2 yet), falls back to the upstream state-SOR URL. Keeps the
// graceful behavior even right after a fresh query while photoStore is
// still writing to R2 in the background.
function PhotoWithFallback({ local, remote, className }: {
  local: string | null; remote: string | null; className: string;
}) {
  const [src, setSrc] = useState(local || remote || '');
  if (!src) return <div className={className} />;
  return (
    <img src={src} alt="" className={className}
      onError={() => {
        if (local && src !== remote && remote) setSrc(remote);
      }} />
  );
}

function CoverageBar({ coverage }: { coverage: Record<string, string> }) {
  const entries = Object.entries(coverage);
  if (entries.length === 0) return null;
  const ok = entries.filter(([, v]) => v === 'ok').length;
  const total = entries.length;
  const failures = entries.filter(([, v]) => v !== 'ok' && v !== 'no_data');
  if (failures.length === 0) {
    return (
      <div className="text-[10px] text-rmpg-400">
        Jurisdictions covered: {ok}/{total} ok.
      </div>
    );
  }
  return (
    <div className="text-[10px] bg-amber-950/40 border border-amber-700/50 text-amber-300 px-2 py-1 flex items-start gap-1">
      <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
      <div>
        <span className="font-bold">Coverage incomplete:</span>{' '}
        {failures.map(([j, s]) => `${j}=${s}`).join(', ')}. A clear result is NOT a
        clearance for these jurisdictions.
      </div>
    </div>
  );
}
