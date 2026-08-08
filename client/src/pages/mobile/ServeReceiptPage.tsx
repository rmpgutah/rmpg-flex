// ============================================================
// ServeReceiptPage — /m/serve-receipt/:token
//
// The RECIPIENT's single-page Acknowledgement of Service Form. Reached
// by scanning the QR printed on the Call for Service report / run sheet
// before shift initiation. The :token path param IS the credential —
// this page is unauthenticated on purpose, because the signer is a
// member of the public (usually the defendant) and will never have an
// RMPG login.
//
// ONE page, FOUR printed variations — (Individual), (Co-Habitant),
// (Business), (Substitute Service). The variant is DERIVED from the
// signer's own answers by resolveReceiptVariant(), never chosen from a
// dropdown: a signer asked to self-classify picks wrong, and the variant
// is what decides which attestations are legally required. See
// utils/serveReceiptVariant.ts for the resolution rules and the
// attestation wording.
//
// UX constraints that drove the layout:
//   * The single most common reason a recipient refuses to sign is the
//     belief that signing admits something. The "signing does not mean
//     you agree" notice is therefore ABOVE everything, in plain
//     language, not buried in fine print.
//   * Phone-first, one column, large touch targets. Assume outdoor
//     daylight, a stranger's doorstep, and 30 seconds of patience.
//   * Nothing about the case beyond the caption is shown — the API
//     deliberately withholds narrative, notes, and prior attempts.
// ============================================================

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { Check, AlertTriangle, FileText, Loader2, Download, Printer, ShieldCheck, ScanLine } from 'lucide-react';
import SignaturePad from '../../components/SignaturePad';
import { enqueueSubmission, flushQueued, getQueued } from '../../utils/serveReceiptQueue';
import { decodePdf417 } from '../../utils/pdf417Decoder';
import { parseAamva } from '../../utils/aamvaParser';
import { generateReceiptOfService, type ReceiptOfServiceData } from '../../utils/servePdfGenerator';
import {
  resolveReceiptVariant, receiptFormTitle, attestationsFor, formatServiceAddress, isEntityName,
  VARIANT_LABEL, type ReceiptVariant,
} from '../../utils/serveReceiptVariant';
import { formatPhoneInput } from '../../utils/formatters';

// ── Types mirroring GET /api/serve-receipt/:token ────────────
interface ReceiptJob {
  id: number;
  case_number: string | null;
  court_name: string | null;
  jurisdiction: string | null;
  plaintiff_name: string | null;
  defendant_name: string | null;
  document_type: string | null;
  recipient_name: string | null;
  service_address: string | null;
  service_city: string | null;
  service_state: string | null;
  service_zip: string | null;
}

/** The officer's doorstep read, recorded on the MDT before hand-off. */
interface ReceiptPrefill {
  is_named_party: boolean | null;
  premises_type: 'residence' | 'business' | 'other';
  resides_at_address: boolean;
  authorized_agent: boolean;
  recipient_name: string | null;
  recipient_relationship: string | null;
  business_name: string | null;
  recipient_job_title: string | null;
  documents: Array<{ title: string; copies: number }>;
  variant: string | null;
}

interface ReceiptContext {
  ok: true;
  job: ReceiptJob;
  documents: Array<{ title: string; doc_type: string | null }>;
  server: { name: string | null; badge: string | null } | null;
  agency: string;
  prefill: ReceiptPrefill | null;
}

const RELATIONSHIPS = [
  'Spouse', 'Parent', 'Adult child', 'Sibling', 'Roommate / co-resident',
  'Employee', 'Manager / supervisor', 'Registered agent', 'Other',
];

// ── Small presentational helpers ─────────────────────────────

function Panel({ title, step, children }: { title: string; step?: number; children: React.ReactNode }) {
  return (
    <section className="bg-surface-raised border border-rmpg-700 rounded-[2px] mb-3">
      <header
        className="px-3 py-2 border-b border-rmpg-700 text-[11px] font-bold uppercase tracking-wider flex items-center gap-2"
        style={{ color: 'var(--panel-header-color)' }}
      >
        {step !== undefined && (
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-[2px] bg-surface-sunken text-rmpg-100 text-[10px]">
            {step}
          </span>
        )}
        {title}
      </header>
      <div className="p-3 space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

/** Inline "this is required" hint, shown next to the field it belongs to
 *  instead of in a single wall-of-text list at the bottom of the page. */
function RequiredHint({ text = 'This is required.' }: { text?: string }) {
  return (
    <p className="text-[12px] text-sev-critical mt-1 leading-snug flex items-center gap-1">
      <AlertTriangle size={12} className="shrink-0" /> {text}
    </p>
  );
}

const inputCls =
  'w-full bg-surface-sunken border border-rmpg-700 rounded-[2px] px-3 py-2.5 ' +
  'text-[15px] text-rmpg-100 placeholder:text-fg-muted focus:outline-none ' +
  'focus:border-brand-400';

/** Checkbox rows are the legally operative controls here, so they get a
 *  full-width tap target rather than a bare 16px box. */
function CheckRow({
  checked, onChange, children, required,
}: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; required?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className="w-full flex items-start gap-3 text-left p-2.5 rounded-[2px] bg-surface-sunken border border-rmpg-700 active:opacity-80"
    >
      <span
        className={`mt-0.5 shrink-0 w-5 h-5 rounded-[2px] border flex items-center justify-center ${
          checked ? 'bg-brand-500 border-brand-400' : 'border-rmpg-500'
        }`}
        aria-hidden
      >
        {checked && <Check size={14} className="text-rmpg-900" />}
      </span>
      <span className="text-[15px] leading-relaxed text-rmpg-100">
        {children}
        {required && <span className="text-sev-critical"> *</span>}
      </span>
    </button>
  );
}

function YesNo({
  label, value, onChange,
}: { label: string; value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div>
      <span className="field-label">{label}</span>
      <div className="flex gap-2">
        {[['Yes', true], ['No', false]].map(([txt, val]) => (
          <button
            key={String(txt)}
            type="button"
            onClick={() => onChange(val as boolean)}
            className={`flex-1 py-2.5 rounded-[2px] border text-[14px] ${
              value === val
                ? 'border-brand-400 text-rmpg-100 bg-surface-sunken'
                : 'border-rmpg-700 text-fg-muted bg-surface-sunken'
            }`}
          >
            {txt}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ServeReceiptPage() {
  const { token = '' } = useParams<{ token: string }>();
  const apiBase = useMemo(() => `/api/serve-receipt/${encodeURIComponent(token)}`, [token]);

  const [ctx, setCtx] = useState<ReceiptContext | null>(null);
  const [loadError, setLoadError] = useState<{ code: string; message: string } | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Variant-determining answers ────────────────────────────
  const [isNamedParty, setIsNamedParty] = useState<boolean | null>(null);
  const [premisesType, setPremisesType] = useState<'residence' | 'business' | 'other'>('residence');
  const [residesAtAddress, setResidesAtAddress] = useState(false);
  const [authorizedAgent, setAuthorizedAgent] = useState(false);

  // ── Identity ───────────────────────────────────────────────
  const [recipientName, setRecipientName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [docCopies, setDocCopies] = useState<Record<string, number>>({});
  const [expectedDelivery, setExpectedDelivery] = useState('');

  // ── Attestations, keyed by the ids in serveReceiptVariant.ts ──
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [signature, setSignature] = useState<string | null>(null);
  // Identity read off the barcode on the back of a licence.
  const [idScanning, setIdScanning] = useState(false);
  const [idScanError, setIdScanError] = useState<string | null>(null);
  const [idVerified, setIdVerified] = useState(false);
  const [idDescription, setIdDescription] = useState('');

  const [coords, setCoords] = useState<{ lat: number; lng: number; acc: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState<{ receiptId: number; emailStatus: string; variant: ReceiptVariant } | null>(null);
  // Signed, saved on this device, not yet accepted by the server.
  const [pending, setPending] = useState(false);

  // ── Load ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Drain first. If this device signed earlier and the submit failed,
      // the token may now be burned by our own replay — showing "already
      // signed" without trying would strand a signature we are holding.
      const carried = await getQueued(token).catch(() => null);
      if (carried) {
        const r = await flushQueued(token).catch(() => ({ status: 'offline' as const }));
        if (cancelled) return;
        if (r.status === 'sent') {
          setDone({ receiptId: r.body.receipt_id, emailStatus: r.body.email_status, variant: r.body.form_variant });
          setLoading(false);
          return;
        }
        if (r.status === 'offline') { setPending(true); setLoading(false); return; }
      }

      try {
        const res = await fetch(apiBase);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || !data?.ok) {
          setLoadError({ code: data?.code ?? 'error', message: data?.message ?? 'This link could not be opened.' });
        } else {
          setCtx(data as ReceiptContext);

          // ── Seed from the officer's MDT intake ──
          // Every seeded value stays EDITABLE. These are the signer's own
          // declarations; a pre-answered form they cannot correct would be
          // the officer's statement wearing the signer's signature.
          const pre: ReceiptPrefill | null = data.prefill ?? null;
          if (pre) {
            if (pre.is_named_party !== null) setIsNamedParty(pre.is_named_party);
            if (pre.premises_type) setPremisesType(pre.premises_type);
            if (pre.resides_at_address) setResidesAtAddress(true);
            if (pre.authorized_agent) setAuthorizedAgent(true);
            if (pre.recipient_name) setRecipientName(pre.recipient_name);
            if (pre.recipient_relationship) setRelationship(pre.recipient_relationship);
            if (pre.business_name) setBusinessName(pre.business_name);
            if (pre.recipient_job_title) setJobTitle(pre.recipient_job_title);
          }

          // The officer's itemization wins when present: they are the one
          // who counted the papers into the subject's hand. Fall back to
          // the intake document list otherwise.
          const officerDocs = pre?.documents?.length ? pre.documents : null;
          setDocCopies(officerDocs
            ? Object.fromEntries(officerDocs.map((d) => [d.title, d.copies || 1]))
            : Object.fromEntries((data.documents ?? []).map((d: any) => [d.title, 1])));
        }
      } catch {
        if (!cancelled) setLoadError({ code: 'network', message: 'Could not reach the server. Check your connection and try again.' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [apiBase]);

  // Light, high-contrast palette for this route only — see .public-form in
  // theme-palettes.css. Applied to <html> so it reaches portalled content,
  // and removed on unmount so the officer's console surfaces are untouched
  // one route away in the same session.
  useEffect(() => {
    document.documentElement.classList.add('public-form');
    // The app shell never sets lang, because it is only ever read by
    // staff. This page is read aloud by screen readers to members of the
    // public, and an unset lang makes a synthesiser guess the voice — on
    // a legal instrument, mispronounced.
    const priorLang = document.documentElement.lang;
    if (!priorLang) document.documentElement.lang = 'en-US';
    return () => {
      document.documentElement.classList.remove('public-form');
      if (!priorLang) document.documentElement.lang = priorLang;
    };
  }, []);

  // Best-effort GPS. Never blocks the form — a denied permission is
  // routine on a stranger's phone and must not stop a valid signature.
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setCoords({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      () => undefined,
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  }, []);

  // Retry the moment the browser reports a connection, and on refocus —
  // 'online' alone is unreliable on mobile, where a phone can report
  // online inside a dead zone.
  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    let timer = 0;
    const attempt = async () => {
      const r = await flushQueued(token)
        .catch(() => ({ status: 'offline' as const, retryInMs: 60_000 }));
      if (cancelled) return;
      if (r.status === 'offline') {
        // Reschedule on the delay the queue asked for. A fixed tick was
        // polling a dead network four times a minute, indefinitely, on
        // someone else's battery.
        window.clearTimeout(timer);
        timer = window.setTimeout(attempt, r.retryInMs);
        return;
      }
      if (r.status === 'expired') {
        setPending(false);
        setSubmitError('This link expired before your signature could be sent. '
          + 'Please ask the process server for a new one.');
        return;
      }
      if (r.status === 'sent') {
        setPending(false);
        setDone({ receiptId: r.body.receipt_id, emailStatus: r.body.email_status, variant: r.body.form_variant });
      } else {
        setPending(false);
        setSubmitError(r.status === 'already_signed'
          ? 'This receipt has already been signed.'
          : (r as { message: string }).message);
      }
    };
    // 'online' and 'focus' remain the real signals — a phone reports
    // online inside a dead zone, and a person picking the handset back up
    // is the best predictor of connectivity there is. The timer is only
    // the fallback.
    window.addEventListener('online', attempt);
    window.addEventListener('focus', attempt);
    void attempt();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener('online', attempt);
      window.removeEventListener('focus', attempt);
    };
  }, [pending, token]);

  const namedParty = ctx?.job.defendant_name || ctx?.job.recipient_name || 'the named party';
  // For the business variant the papers are directed at the entity, so
  // the "on behalf of" label is the business the signer names — falling
  // back to the case caption when they haven't typed one yet.
  const partyLabel = premisesType === 'business' && businessName.trim()
    ? businessName.trim()
    : namedParty;

  // "Are you <party>?" cannot truthfully be answered yes when the party is
  // a company. Seen on a live service: a registered agent answered yes for
  // "Chase Partners Ltd, ... SDP REIT LLC, ISAOA" and the form recorded him
  // as the party himself, capacity "PARTY NAMED". The question is withheld
  // entirely for an entity rather than left available to answer wrongly.
  const partyIsEntity = isEntityName(namedParty);

  const variant: ReceiptVariant = useMemo(() => resolveReceiptVariant({
    isNamedParty: !partyIsEntity && isNamedParty === true,
    premisesType,
    residesAtAddress,
    authorizedAgent,
  }), [partyIsEntity, isNamedParty, premisesType, residesAtAddress, authorizedAgent]);

  // A signer who ticks "authorized to accept" at a RESIDENCE resolves to
  // the Business variation — correct, that is a registered agent working
  // from home, and it is the one variation carrying the agent-authority
  // statement. But the business name field then sat empty and blocked
  // submission, demanding an entity name a house does not have. Seed it
  // from the party actually named in the process; the signer can correct
  // it, and the form is fillable instead of a dead end.
  useEffect(() => {
    if (variant !== 'business') return;
    setBusinessName((prev) => prev.trim() || namedParty);
  }, [variant, namedParty]);

  const attestations = useMemo(
    () => attestationsFor(variant, partyLabel),
    [variant, partyLabel],
  );
  const formTitle = receiptFormTitle(variant);

  // Prefill the signer's name once they say they ARE the named party;
  // clear it again if they change their mind, so a defendant's name is
  // never left sitting in a co-habitant's signature line.
  // Prefill the signer's name once they confirm they ARE the named
  // party; clear it again if they change their mind, so a defendant's
  // name is never left sitting on a co-habitant's signature line.
  //
  // Skips entirely when the officer already recorded a name from an ID —
  // overwriting a name read off a driver's licence with the case caption
  // would be a downgrade in evidence quality, not a convenience.
  // An entity can never be the signer, so the answer is settled on load.
  useEffect(() => {
    if (partyIsEntity) setIsNamedParty(false);
  }, [partyIsEntity]);

  const officerName = ctx?.prefill?.recipient_name ?? null;
  useEffect(() => {
    if (officerName) return;
    if (isNamedParty === true) setRecipientName(ctx?.job.recipient_name || namedParty);
    else if (isNamedParty === false) setRecipientName((prev) => (prev === namedParty || prev === ctx?.job.recipient_name ? '' : prev));
  }, [isNamedParty, ctx, namedParty, officerName]);

  // Attestation ids change with the variant. Drop accepted flags for
  // statements that are no longer on screen — carrying them forward
  // would record agreement to wording the signer never saw.
  useEffect(() => {
    setAccepted((prev) => {
      const ids = new Set(attestations.map((a) => a.id));
      const next: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(prev)) if (ids.has(k)) next[k] = v;
      return next;
    });
  }, [attestations]);

  // ── Client-side mirror of the server's validation ──────────
  // The server is the authority; this drives inline field hints instead
  // of a single dumped list, so the recipient sees what's wrong next to
  // where they'd fix it rather than reading a wall of quoted attestation
  // text at the bottom of the page.
  const fieldErrors = useMemo(() => {
    const missingAttestationIds = new Set(
      attestations.filter((a) => a.required && !accepted[a.id]).map((a) => a.id),
    );
    return {
      whoIsSigning: !partyIsEntity && isNamedParty === null,
      name: !recipientName.trim(),
      // Phone, email, and ID are all required, per operator instruction on
      // the 2026-07-27 service. A proof of service whose signer cannot be
      // reached afterwards — or verified — is hard to stand behind if the
      // service is ever contested.
      phone: !phone.trim(),
      email: !email.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()),
      id: !idVerified,
      businessName: variant === 'business' && !businessName.trim(),
      authority: isNamedParty === false && !residesAtAddress && !authorizedAgent && premisesType !== 'other',
      attestations: missingAttestationIds,
      signature: !signature,
    };
  }, [partyIsEntity, isNamedParty, recipientName, phone, email, idVerified, variant, businessName, residesAtAddress, authorizedAgent, premisesType, attestations, accepted, signature]);

  const missingCount = Object.values(fieldErrors).reduce(
    (n, v) => n + (v instanceof Set ? v.size : v ? 1 : 0), 0,
  );

  // Only nag with inline hints after the signer has tried to submit once —
  // a form covered in red before anyone has touched it reads as broken,
  // not helpful.
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const showHint = (broken: boolean) => attemptedSubmit && broken;

  const acceptedAttestations = useMemo(
    () => attestations.map((a) => ({ id: a.id, text: a.text, accepted: !!accepted[a.id] })),
    [attestations, accepted],
  );

  /**
   * Read the signer's identity from the PDF417 on the back of their
   * licence.
   *
   * Optional and offered, never demanded — nobody is obliged to produce
   * ID to accept papers, and a form that insists would stop a service
   * that is otherwise perfectly good.
   *
   * When it IS offered, it changes the evidentiary weight of the whole
   * instrument. "A man who said he was Andrew Peterson" and "Andrew Scott
   * Peterson, DOB 1974-03-11, per Utah DL scanned at the door" are
   * different facts, and the second is the one that survives a contested
   * hearing. It also fills recipient_description — sex, height, weight,
   * hair — which is the physical description an affidavit of service
   * conventionally carries and which nobody types by hand.
   *
   * Parsing is local. The barcode never leaves the device: the decoded
   * text is discarded and only the fields the form shows are kept, so a
   * licence number and address do not enter a record that did not ask
   * for them.
   */
  const scanId = useCallback(async (file: File) => {
    setIdScanning(true);
    setIdScanError(null);
    try {
      const outcome = await decodePdf417(file);
      if (!outcome) {
        setIdScanError('Could not read the barcode. Try again in better light, or just type your name.');
        return;
      }
      const dl = parseAamva(outcome.text);
      const full = [dl.first_name, dl.middle_name, dl.last_name, dl.suffix]
        .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      if (full) setRecipientName(full);
      setIdDescription([dl.gender, dl.height, dl.weight && `${dl.weight} lbs`, dl.hair_color, dl.eye_color]
        .filter(Boolean).join(', '));
      setIdVerified(true);
    } catch {
      setIdScanError('Could not read the barcode. Try again, or just type your name.');
    } finally {
      setIdScanning(false);
    }
  }, []);

  const buildPdfData = useCallback((receiptId: number): ReceiptOfServiceData => ({
    receiptId,
    formTitle,
    variant,
    variantLabel: VARIANT_LABEL[variant],
    courtName: ctx?.job.court_name ?? '',
    caseNumber: ctx?.job.case_number ?? '',
    jurisdiction: ctx?.job.jurisdiction ?? '',
    plaintiffName: ctx?.job.plaintiff_name ?? '',
    defendantName: ctx?.job.defendant_name ?? '',
    documentType: ctx?.job.document_type ?? '',
    serviceAddress: formatServiceAddress({
      address: ctx?.job.service_address, city: ctx?.job.service_city,
      state: ctx?.job.service_state, zip: ctx?.job.service_zip,
    }),
    premisesType,
    serverName: ctx?.server?.name ?? '',
    serverBadge: ctx?.server?.badge ?? '',
    agency: ctx?.agency ?? 'Rocky Mountain Protective Group',
    recipientName: recipientName.trim(),
    recipientRelationship: relationship || undefined,
    recipientJobTitle: jobTitle || undefined,
    businessName: businessName.trim() || undefined,
    recipientPhone: phone || undefined,
    acceptingOnBehalfOf: variant === 'individual' ? undefined : partyLabel,
    documents: Object.entries(docCopies).map(([title, copies]) => ({ title, copies })),
    attestations: acceptedAttestations,
    signedAt: new Date().toISOString(),
    gps: coords ? { lat: coords.lat, lng: coords.lng } : undefined,
    signature: signature ?? undefined,
    residesAtAddress,
    authorizedAgent,
    expectedDeliveryAt: expectedDelivery || undefined,
  }), [formTitle, variant, ctx, premisesType, recipientName, relationship, jobTitle, businessName,
      phone, partyLabel, docCopies, acceptedAttestations, coords, signature, residesAtAddress,
      authorizedAgent, expectedDelivery]);

  const downloadPdf = useCallback(async (receiptId: number) => {
    // Designated: this IS the subject's copy. Printed undesignated it fell
    // back to the generic footer, which is what the operator marked up by
    // hand as "Subject" on the 2026-07-27 service.
    const doc = await generateReceiptOfService({ ...buildPdfData(receiptId), copy: 'subject' });
    doc.save(`acknowledgement-of-service-${ctx?.job.case_number || receiptId}.pdf`);
  }, [buildPdfData, ctx]);

  /**
   * Print the recipient's paper copy on the process server's in-vehicle
   * Brother PJ-700. Rendered with printTarget: 'mobile' so the header
   * clears the roll printer's leading-edge dead zone — the office
   * layout prints with its banner clipped on that hardware.
   *
   * Opened via autoPrint + a blob URL rather than doc.save(): the
   * officer is standing at the door and needs the print dialog, not a
   * file in Downloads. Falls back to a download if the popup is blocked.
   */
  const printPdf = useCallback(async (receiptId: number) => {
    const doc = await generateReceiptOfService({ ...buildPdfData(receiptId), copy: 'subject', printTarget: 'mobile' });
    doc.autoPrint();
    const url = doc.output('bloburl') as unknown as string;
    const w = window.open(url, '_blank');
    if (!w) doc.save(`acknowledgement-of-service-${ctx?.job.case_number || receiptId}-mobile.pdf`);
  }, [buildPdfData, ctx]);

  // ── Submit ─────────────────────────────────────────────────
  const submit = useCallback(async () => {
    if (missingCount || submitting) return;
    setSubmitting(true);
    setSubmitError(null);

    const payload = {
          // Service method stays the coarse legal category the rest of
          // the serve subsystem already understands; form_variant is the
          // finer-grained printed variation.
          service_method: variant === 'individual' ? 'personal' : 'substitute',
          completion_channel: 'mobile',
          form_variant: variant,
          form_title: formTitle,
          attestations: acceptedAttestations,
          recipient_name: recipientName.trim(),
          recipient_role: variant,
          recipient_relationship: relationship || null,
          recipient_job_title: jobTitle || null,
          business_name: businessName.trim() || null,
          recipient_phone: phone || null,
          recipient_email: email || null,
          recipient_age_confirmed: !!accepted.adult,
          recipient_id_type: idVerified ? 'drivers_licence_scan' : null,
          recipient_id_verified: idVerified,
          recipient_description: idDescription || null,
          premises_type: premisesType,
          service_address: ctx?.job.service_address ?? null,
          service_city: ctx?.job.service_city ?? null,
          service_state: ctx?.job.service_state ?? null,
          service_zip: ctx?.job.service_zip ?? null,
          documents: Object.entries(docCopies).map(([title, copies]) => ({ title, copies })),
          sub_defendant_name: variant === 'individual' ? null : partyLabel,
          sub_resides_at_address: residesAtAddress,
          sub_is_authorized_agent: authorizedAgent,
          sub_agrees_to_deliver: !!accepted.deliver,
          sub_expected_delivery_at: expectedDelivery || null,
          sub_release_acknowledged: !!accepted.acceptance,
          ack_received_documents: !!accepted.received,
          ack_notice_read: !!accepted.explained,
          ack_information_true: !!accepted.truthful,
          recipient_signature: signature,
          latitude: coords?.lat ?? null,
          longitude: coords?.lng ?? null,
      accuracy_m: coords?.acc ?? null,
    };

    // Persist BEFORE the network is attempted. A signal that drops between
    // the tap and the response would otherwise lose a signature already
    // given, and the officer would have to ask a stranger to do all of it
    // again on a doorstep.
    // A persist failure is survivable but must not be silent: it means
    // the safety net is absent, and the signer should know that before
    // they walk away believing this is saved.
    let queued = true;
    try {
      await enqueueSubmission(token, payload);
    } catch {
      queued = false;
    }

    try {
      const r = await flushQueued(token);
      if (r.status === 'offline') {
        if (queued) {
          setPending(true);
        } else {
          // Nothing is holding this. Telling them it is saved would be a
          // lie, and "try again" is the only action that can still work.
          setSubmitError(
            'Your signature could not be sent and this browser will not hold it — '
            + 'private browsing blocks that. Stay on this page and try again when '
            + 'you have signal, or ask the process server for the paper form.',
          );
        }
        setSubmitting(false);
        return;
      }
      if (r.status === 'expired') {
        setSubmitError('This link expired before your signature could be sent. '
          + 'Please ask the process server for a new one.');
        setSubmitting(false);
        return;
      }
      if (r.status === 'already_signed') {
        setSubmitError('This receipt has already been signed.');
        setSubmitting(false);
        return;
      }
      if (r.status === 'rejected') {
        setSubmitError(r.message);
        setSubmitting(false);
        return;
      }
      const data = r.status === 'sent' ? r.body : {};
      const receiptId: number = data.receipt_id;
      setDone({ receiptId, emailStatus: data.email_status, variant });

      // Email the recipient their copy. jsPDF is client-side only, so the
      // browser renders and uploads the bytes; the Worker cannot make one.
      // Best-effort and deliberately AFTER the success state is shown —
      // a mail failure must never look like a failed signature.
      if (email) {
        try {
          const doc = await generateReceiptOfService({ ...buildPdfData(receiptId), copy: 'subject' });
          const b64 = doc.output('datauristring').split(',')[1] ?? '';
          await fetch(`${apiBase}/email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              receipt_id: receiptId,
              pdf_base64: b64,
              filename: `acknowledgement-of-service-${ctx?.job.case_number || receiptId}.pdf`,
            }),
          });
        } catch {
          await fetch(`${apiBase}/delivery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ receipt_id: receiptId, status: 'failed', error: 'PDF render failed on device' }),
          }).catch(() => undefined);
        }
      }
    } catch {
      // Already persisted above, so this is a delay rather than a loss.
      setPending(true);
    } finally {
      setSubmitting(false);
    }
  }, [missingCount, submitting, token, apiBase, variant, formTitle, acceptedAttestations, recipientName,
      relationship, jobTitle, businessName, phone, email, accepted, premisesType, ctx, docCopies,
      partyLabel, residesAtAddress, authorizedAgent, expectedDelivery, signature, coords, buildPdfData]);

  // ── Render: loading / error / done ─────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-surface-base flex items-center justify-center text-fg-secondary">
        <Loader2 className="animate-spin mr-2" size={18} /> Loading…
      </div>
    );
  }

  // Signed, held on this device, waiting for signal.
  //
  // Shown INSTEAD of an error, and deliberately reassuring: the person has
  // already done everything asked of them. The failure is ours, it is
  // recoverable, and telling them "try again" would be both wrong and
  // insulting — there is nothing for them to try.
  if (pending) {
    return (
      <div className="min-h-screen bg-surface-base p-6 flex items-center justify-center">
        <div className="max-w-sm w-full text-center">
          <div className="mx-auto mb-4 w-14 h-14 rounded-[2px] bg-sev-warn/20 flex items-center justify-center">
            <Loader2 className="text-sev-warn animate-spin" size={28} />
          </div>
          <h1 className="text-rmpg-100 text-lg font-semibold mb-2">Signed — saving</h1>
          <p className="text-fg-secondary text-[15px] leading-relaxed mb-3">
            Your signature is saved on this phone. There is no signal here, so
            it will be sent automatically as soon as there is.
          </p>
          <p className="text-fg-muted text-[13px] leading-relaxed">
            You can close this page. Nothing is lost — it will send the next
            time you open it with a connection. The process server has a record
            that you signed.
          </p>
        </div>
      </div>
    );
  }

  if (loadError || !ctx) {
    return (
      <div className="min-h-screen bg-surface-base p-6 flex items-center justify-center">
        <div className="max-w-sm text-center">
          <AlertTriangle className="mx-auto mb-3 text-sev-warn" size={32} />
          <h1 className="text-rmpg-100 text-lg font-semibold mb-2">This link can’t be opened</h1>
          <p className="text-fg-secondary text-sm">{loadError?.message}</p>
          <p className="text-fg-muted text-xs mt-4">Please ask the process server for a new link.</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-surface-base p-6 flex items-center justify-center">
        <div className="max-w-sm w-full text-center">
          <div className="mx-auto mb-4 w-14 h-14 rounded-[2px] bg-sev-ok/20 flex items-center justify-center">
            <ShieldCheck className="text-sev-ok" size={30} />
          </div>
          <h1 className="text-rmpg-100 text-lg font-semibold mb-1">Acknowledgement signed</h1>
          <p className="text-fg-secondary text-xs mb-2">{receiptFormTitle(done.variant)}</p>
          <p className="text-fg-secondary text-sm mb-1">
            Receipt #{done.receiptId}
            {ctx.job.case_number ? ` · Case ${ctx.job.case_number}` : ''}
          </p>
          <p className="text-fg-muted text-xs mb-6">
            {done.emailStatus === 'pending' || done.emailStatus === 'sent'
              ? `A copy is on its way to ${email}.`
              : 'Save a copy for your records below.'}
          </p>
          <button
            type="button"
            onClick={() => downloadPdf(done.receiptId)}
            className="w-full flex items-center justify-center gap-2 bg-brand-600 text-rmpg-50 py-3 rounded-[2px] font-semibold"
          >
            <Download size={16} /> Download my copy (PDF)
          </button>
          {/* Officer-operated: hands the phone back and prints the paper
              copy on the in-vehicle PJ-700 before leaving the door. */}
          <button
            type="button"
            onClick={() => printPdf(done.receiptId)}
            className="mt-2 w-full flex items-center justify-center gap-2 border border-rmpg-600 text-rmpg-200 py-3 rounded-[2px] font-semibold"
          >
            <Printer size={16} /> Print paper copy (mobile printer)
          </button>
        </div>
      </div>
    );
  }

  // ── Render: the form ───────────────────────────────────────
  const addressLine = formatServiceAddress({
    address: ctx.job.service_address, city: ctx.job.service_city,
    state: ctx.job.service_state, zip: ctx.job.service_zip,
  });
  const answeredWhoIsSigning = partyIsEntity || isNamedParty !== null;

  // How much of the form is behind them. Sections 1 and 3 are read-only,
  // so they count as done on arrival — claiming otherwise would show a
  // bar that never moves for the first third of the form.
  const sectionsDone = 2
    + (answeredWhoIsSigning && recipientName.trim() ? 1 : 0)
    + (attestations.filter((a) => a.required).every((a) => accepted[a.id]) ? 1 : 0)
    + (signature ? 1 : 0);

  return (
    <div className="min-h-screen bg-surface-base flex flex-col">
      <header className="px-4 py-4 border-b border-rmpg-700 bg-surface-sunken">
        <p className="text-[10px] uppercase tracking-widest text-fg-muted">{ctx.agency}</p>
        <h1 className="text-rmpg-50 text-lg font-bold leading-tight">Acknowledgement of Service</h1>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <p className="text-fg-secondary text-xs">
            {ctx.job.court_name || 'Court'}
            {ctx.job.case_number ? ` · Case ${ctx.job.case_number}` : ''}
          </p>
          {answeredWhoIsSigning && (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-[2px] border border-brand-500 text-brand-300">
              {VARIANT_LABEL[variant]}
            </span>
          )}
        </div>
        {/* Progress. A stranger on a doorstep has no idea how long this
            is, and a form of unknown length is one people abandon. */}
        <div className="flex items-center gap-1.5 mt-2" aria-hidden>
          {[1, 2, 3, 4, 5].map((n) => (
            <span
              key={n}
              className={`h-1 flex-1 rounded-[1px] ${
                n <= sectionsDone ? 'bg-brand-500' : 'bg-border-subtle'
              }`}
            />
          ))}
        </div>
        <p className="sr-only" role="status">
          Step {sectionsDone} of 5 complete.
        </p>
      </header>

      <div className="p-3 max-w-lg mx-auto w-full flex-1">
        {/* The single most important sentence on this page. Recipients
            refuse to sign because they think it concedes something; say
            plainly that it does not, before anything else is asked. */}
        <div className="mb-3 p-3 rounded-[2px] border border-brand-600 bg-surface-raised">
          <p className="text-[15px] text-rmpg-100 leading-relaxed">
            <strong>Signing below only confirms that you received these papers.</strong>{' '}
            It is not an admission, it is not an agreement with anything the
            documents say, and it does not give up any of your rights or any
            deadline you may have to respond.
          </p>
        </div>

        {/* ── 1. Case ─────────────────────────────────────── */}
        <Panel title="Case" step={1}>
          <div className="grid grid-cols-2 gap-3 text-[13px]">
            <div>
              <span className="field-label">Plaintiff / Petitioner</span>
              <p className="text-rmpg-100">{ctx.job.plaintiff_name || '—'}</p>
            </div>
            <div>
              <span className="field-label">Defendant / Respondent</span>
              <p className="text-rmpg-100">{ctx.job.defendant_name || '—'}</p>
            </div>
            <div className="col-span-2">
              <span className="field-label">Address of service</span>
              <p className="text-rmpg-100 whitespace-pre-line">{addressLine || '—'}</p>
            </div>
            {ctx.server?.name && (
              <div className="col-span-2">
                <span className="field-label">Served by</span>
                <p className="text-rmpg-100">
                  {ctx.server.name}{ctx.server.badge ? ` · Badge ${ctx.server.badge}` : ''}
                </p>
              </div>
            )}
          </div>
        </Panel>

        {/* ── 2. Who is signing — drives the variant ──────── */}
        <Panel title="Who is signing" step={2}>
          {partyIsEntity ? (
            // No yes/no here. The party is a company, so the only truthful
            // answer is "no" and offering the choice invites the error this
            // form was corrected for in pen: a registered agent recorded as
            // the party named.
            <div className="p-2.5 rounded-[2px] border border-rmpg-700 bg-surface-sunken">
              <span className="field-label">Who the papers are for</span>
              <p className="text-[13px] text-rmpg-100 leading-snug">{namedParty}</p>
              <p className="text-[11px] text-fg-muted mt-1 leading-snug">
                This is a business or organization, so you are accepting on its
                behalf. Tell us your role below.
              </p>
            </div>
          ) : (
            <>
              <YesNo
                label={`Are you ${namedParty}?`}
                value={isNamedParty}
                onChange={setIsNamedParty}
              />
              {showHint(fieldErrors.whoIsSigning) && <RequiredHint />}
            </>
          )}

          {(partyIsEntity || isNamedParty === false) && (
            <>
              <Field label="This address is a">
                <div className="flex gap-2">
                  {(['residence', 'business', 'other'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setPremisesType(t)}
                      className={`flex-1 py-2.5 rounded-[2px] border text-[13px] capitalize ${
                        premisesType === t
                          ? 'border-brand-400 text-rmpg-100 bg-surface-sunken'
                          : 'border-rmpg-700 text-fg-muted bg-surface-sunken'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </Field>

              <CheckRow checked={residesAtAddress} onChange={setResidesAtAddress}>
                I live at this address.
              </CheckRow>
              <CheckRow checked={authorizedAgent} onChange={setAuthorizedAgent}>
                I am authorized to accept legal papers at this address (for
                example, a registered agent, an office manager, or a
                manager on duty).
              </CheckRow>
              {showHint(fieldErrors.authority) && <RequiredHint text="Check one of the boxes above to continue." />}

              {premisesType === 'business' && (
                <>
                  <Field label="Business name">
                    <input
                      className={inputCls}
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      placeholder="Legal name of the business"
                    />
                    {showHint(fieldErrors.businessName) && <RequiredHint />}
                  </Field>
                  <Field label="Your job title">
                    <input
                      className={inputCls}
                      value={jobTitle}
                      onChange={(e) => setJobTitle(e.target.value)}
                      placeholder="e.g. Office Manager"
                    />
                  </Field>
                </>
              )}

              <Field label={`Your relationship to ${namedParty}`}>
                <select className={inputCls} value={relationship} onChange={(e) => setRelationship(e.target.value)}>
                  <option value="">Select…</option>
                  {RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </Field>

              <Field label="When do you expect to hand the documents over? (optional)">
                <input
                  type="date"
                  className={inputCls}
                  value={expectedDelivery}
                  onChange={(e) => setExpectedDelivery(e.target.value)}
                />
              </Field>
            </>
          )}

          <Field label="Your full legal name">
            <input
              className={inputCls}
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              autoComplete="name"
              placeholder="First and last name"
            />
            {showHint(fieldErrors.name) && <RequiredHint />}
          </Field>

          {/* Required, per operator instruction on the 2026-07-27 service —
              a proof of service is more defensible in a contested hearing
              when the signer's identity was verified against a photo ID
              rather than self-attested. */}
          {idVerified ? (
            <p className="text-[13px] text-sev-ok leading-relaxed flex items-center gap-1.5">
              <Check size={14} /> Identity read from your licence.
            </p>
          ) : (
            <label className="block">
              <span className="flex items-center gap-1.5 text-[13px] text-fg-secondary cursor-pointer">
                <ScanLine size={14} />
                {idScanning ? 'Reading…' : 'Required: scan the barcode on the back of your licence or state ID'}
                <span className="text-sev-critical">*</span>
              </span>
              <input
                type="file" accept="image/*" capture="environment" className="sr-only"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void scanId(f); }}
              />
              <span className="block text-[13px] text-fg-muted leading-relaxed mt-0.5">
                We need this to verify who signed. It also fills your name in
                for you.
              </span>
            </label>
          )}
          {idScanError && <p className="text-[13px] text-sev-warn leading-relaxed">{idScanError}</p>}
          {showHint(fieldErrors.id) && <RequiredHint />}

          <Field label="Phone number *">
            <input
              className={inputCls}
              value={phone}
              onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
              inputMode="tel"
              autoComplete="tel"
              placeholder="(801) 555-0100"
            />
            {showHint(fieldErrors.phone) && <RequiredHint />}
          </Field>

          {answeredWhoIsSigning && (
            <p className="text-[13px] text-fg-muted leading-relaxed">
              Based on your answers, you are signing the{' '}
              <strong className="text-rmpg-200">{formTitle}</strong>.
            </p>
          )}
        </Panel>

        {/* ── 3. Documents ────────────────────────────────── */}
        <Panel title="Documents received" step={3}>
          {Object.keys(docCopies).length === 0 ? (
            <p className="text-[15px] text-fg-secondary">
              {ctx.job.document_type || 'Court documents'} — 1 set.
            </p>
          ) : (
            <ul className="space-y-2">
              {Object.entries(docCopies).map(([title, copies]) => (
                <li key={title} className="flex items-center gap-3 p-2.5 rounded-[2px] bg-surface-sunken border border-rmpg-700">
                  <FileText size={16} className="shrink-0 text-fg-muted" />
                  <span className="flex-1 text-[15px] text-rmpg-100 leading-relaxed break-words">{title}</span>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={copies}
                    onChange={(e) =>
                      setDocCopies((prev) => ({ ...prev, [title]: Math.max(1, Number(e.target.value) || 1) }))
                    }
                    aria-label={`Copies of ${title}`}
                    className="w-14 bg-surface-base border border-rmpg-700 rounded-[2px] px-2 py-1.5 text-[13px] text-rmpg-100 text-center"
                  />
                </li>
              ))}
            </ul>
          )}
          <p className="text-[13px] text-fg-muted">
            If anything listed here was not handed to you, tell the process
            server before you sign.
          </p>
        </Panel>

        {/* ── 4. Attestations — variant-driven ───────────── */}
        <Panel title="Statements" step={4}>
          {!answeredWhoIsSigning ? (
            <p className="text-[13px] text-fg-muted">
              Answer “Who is signing” above and the statements you need to
              confirm will appear here.
            </p>
          ) : (
            <>
              {attestations.map((a) => (
                <Fragment key={a.id}>
                  <CheckRow
                    checked={!!accepted[a.id]}
                    onChange={(v) => setAccepted((prev) => ({ ...prev, [a.id]: v }))}
                    required={a.required}
                  >
                    {a.text}
                  </CheckRow>
                  {showHint(fieldErrors.attestations.has(a.id)) && <RequiredHint text="Check this box to continue." />}
                </Fragment>
              ))}
              <p className="text-[13px] text-fg-muted">
                Statements marked <span className="text-sev-critical">*</span> are required.
              </p>
            </>
          )}
        </Panel>

        {/* ── 5. Signature ────────────────────────────────── */}
        <Panel title="Signature" step={5}>
          <SignaturePad
            value={signature}
            onChange={setSignature}
            label="Sign here"
            width={340}
            height={140}
          />
          {showHint(fieldErrors.signature) && <RequiredHint />}

          <Field label="Your email address *">
            <input
              className={inputCls}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              required
            />
            {showHint(fieldErrors.email) && <RequiredHint text="A valid email address is required." />}
          </Field>
          <p className="text-[11px] text-fg-muted leading-snug -mt-1">
            Your phone and email are required. They are recorded with this
            acknowledgement so you can be reached about this service, and your
            copy is sent to the address you give.
          </p>

          <p className="text-[13px] text-fg-muted leading-relaxed">
            Your signature, the date and time, and your device’s approximate
            location (if you allowed it) are recorded with this form.
          </p>
        </Panel>

        {submitError && (
          <div className="mb-3 p-3 rounded-[2px] border border-sev-critical bg-surface-raised text-[13px] text-rmpg-100">
            {submitError}
          </div>
        )}
      </div>

      {/* Sticky submit — the form is long and the action must never be
          more than a thumb away on a doorstep. Kept in normal document
          flow (sticky, not fixed) so its real rendered height always
          reserves its own space — a fixed bar with a guessed height
          padding the page instead previously let a long "still needed"
          list grow taller than the guess and cover whatever had scrolled
          to the bottom of the page (the "who is signing" Yes/No buttons,
          in practice).

          No longer dumps every outstanding item as quoted attestation
          text here — that read as broken, not helpful. Each field now
          carries its own inline "Required" hint (see fieldErrors above),
          and this bar just says how many remain. */}
      <div className="sticky bottom-0 mt-auto border-t border-rmpg-700 bg-surface-sunken p-3">
        <div className="max-w-lg mx-auto">
          {attemptedSubmit && missingCount > 0 && (
            <p className="text-[12px] text-sev-warn mb-2 leading-snug text-center">
              {missingCount} required {missingCount === 1 ? 'item' : 'items'} above still need your attention.
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              if (missingCount > 0) { setAttemptedSubmit(true); return; }
              void submit();
            }}
            disabled={submitting}
            className="w-full py-3.5 rounded-[2px] font-semibold text-[15px] bg-brand-600 text-rmpg-50 disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {submitting ? <><Loader2 size={16} className="animate-spin" /> Submitting…</> : 'Sign and submit'}
          </button>
        </div>
      </div>
    </div>
  );
}
