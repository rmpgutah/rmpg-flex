// ============================================================
// ServeReceiptActions — the officer's MDT surface for the
// Acknowledgement of Service.
//
// Three steps, in the order they happen at a door:
//
//   1. INTAKE   The officer answers what they can see: who opened the
//               door, is this a house or a business, do they live or
//               work here. Those answers DERIVE the form variation —
//               the officer never picks a form off a list, because
//               picking a form is a legal judgement and answering
//               "is this a business?" is not.
//   2. HAND OFF Show the QR for the subject's own phone, or print the
//               matching blank for hand completion. Both carry the same
//               token, so whichever route is taken exactly one signed
//               record can exist.
//   3. OUTPUT   Once signed — including when the subject signed on their
//               own phone and the officer's device never saw it — pull
//               the completed instrument back and print it from the
//               vehicle.
//
// The officer's answers PRE-SELECT the variation and pre-fill the
// subject's form. They do not decide it: the declarations are the
// signer's own statements, so the signer's answers stay authoritative
// and any disagreement is recorded as variant_conflict rather than
// silently overwritten.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import {
  QrCode, Printer, Loader2, X, CheckCircle2, ExternalLink,
  ArrowLeft, AlertTriangle, FileDown, Ban, Camera,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import {
  generateReceiptOfService, RECEIPT_COPY_LABEL, RECEIPT_COPY_ORDER,
  type ReceiptOfServiceData, type ReceiptCopy,
} from '../../utils/servePdfGenerator';
import {
  resolveReceiptVariant, receiptFormTitle, attestationsFor, formatServiceAddress,
  VARIANT_LABEL, type ReceiptVariant,
} from '../../utils/serveReceiptVariant';

interface SignedReceipt {
  id: number;
  created_at: string;
  service_method: string;
  recipient_name: string;
  form_variant?: string | null;
  status: string;
}

export interface ServeReceiptJob {
  id: number;
  case_number?: string | null;
  court_name?: string | null;
  jurisdiction?: string | null;
  plaintiff_name?: string | null;
  defendant_name?: string | null;
  document_type?: string | null;
  recipient_name?: string | null;
  recipient_address?: string | null;
  recipient_city?: string | null;
  recipient_state?: string | null;
  recipient_zip?: string | null;
}

/**
 * Answers already given elsewhere — currently by the attempt modal, which
 * asks who was served and their relationship before this panel is ever
 * reached.
 *
 * Seeding PRE-ANSWERS the intake; it does not skip it. The attempt log
 * does not ask whether the address is a dwelling or whether the person
 * lives there, and those two answers are what separate a co-habitant from
 * a substitute. Jumping straight to the QR would mean deriving a form
 * from facts nobody established.
 */
export interface ServeReceiptSeed {
  isNamedParty?: boolean | null;
  recipientName?: string | null;
  relationship?: string | null;
  documents?: Array<{ title: string; copies: number }>;
}

interface Props {
  job: ServeReceiptJob;
  serverName?: string;
  serverBadge?: string;
  /** Compact renders as a single icon button for tight card footers. */
  compact?: boolean;
  /** Pre-answer the intake from a completed attempt. */
  seed?: ServeReceiptSeed;
  /** Render the panel already open — used when it IS the completion step. */
  autoOpen?: boolean;
  /** Label for the trigger when it is not the compact card button. */
  triggerLabel?: string;
}

type Step = 'intake' | 'handoff';

const RELATIONSHIPS = [
  'Spouse', 'Parent', 'Adult child', 'Sibling', 'Roommate / co-resident',
  'Employee', 'Manager / supervisor', 'Registered agent', 'Other',
];

// ── Presentational helpers ──────────────────────────────────

const inputCls =
  'w-full bg-surface-sunken border border-rmpg-700 rounded-[2px] px-2.5 py-2 '
  + 'text-[13px] text-rmpg-100 placeholder:text-fg-muted focus:outline-none focus:border-brand-400';

function Q({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="block text-[10px] font-bold uppercase tracking-wider text-fg-muted mb-1">{label}</span>
      {children}
    </div>
  );
}

function Choice<T extends string | boolean | null>({
  options, value, onChange,
}: { options: Array<{ v: T; label: string }>; value: T | undefined; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1.5">
      {options.map((o) => (
        <button
          key={String(o.v)}
          type="button"
          onClick={() => onChange(o.v)}
          className={`flex-1 py-2 rounded-[2px] border text-[12px] ${
            value === o.v
              ? 'border-brand-400 text-rmpg-100 bg-surface-sunken'
              : 'border-rmpg-700 text-fg-muted bg-surface-sunken'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function ServeReceiptActions({
  job, serverName, serverBadge, compact, seed, autoOpen, triggerLabel,
}: Props) {
  const [open, setOpen] = useState(!!autoOpen);
  const [step, setStep] = useState<Step>('intake');

  // ── Officer intake ─────────────────────────────────────────
  // undefined = not yet answered. null is a real answer ('unsure'), so it
  // cannot double as the unanswered state — the Choice would highlight
  // Unsure on open and the officer would submit a question they never read.
  const [isNamedParty, setIsNamedParty] = useState<boolean | null | undefined>(seed?.isNamedParty);
  const [premisesType, setPremisesType] = useState<'residence' | 'business' | 'other'>('residence');
  const [resides, setResides] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [recipientName, setRecipientName] = useState(seed?.recipientName ?? '');
  const [relationship, setRelationship] = useState(seed?.relationship ?? '');
  const [businessName, setBusinessName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [docTitles, setDocTitles] = useState(
    (seed?.documents ?? []).map((d) => d.title).join('\n'),
  );

  // ── Hand-off ───────────────────────────────────────────────
  const [url, setUrl] = useState<string | null>(null);
  // Case caption and assigned server, returned WITH the link. The card's
  // ServeJob carries no plaintiff or defendant, so printing from card
  // state alone would render a court caption with empty parties.
  const [caption, setCaption] = useState<{
    case_number: string | null; court_name: string | null; jurisdiction: string | null;
    plaintiff_name: string | null; defendant_name: string | null;
    document_type: string | null; recipient_name: string | null; service_address: string;
  } | null>(null);
  const [resolvedServer, setResolvedServer] = useState<{ name: string | null; badge: string | null } | null>(null);
  const [qrPng, setQrPng] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<SignedReceipt[]>([]);
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState<string | null>(null);
  // Index into RECEIPT_COPY_ORDER — which of the three copies is next.
  const [copyStep, setCopyStep] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [refusing, setRefusing] = useState(false);
  const [refusalReason, setRefusalReason] = useState('');
  const [docsLeft, setDocsLeft] = useState(true);
  const [refusalDone, setRefusalDone] = useState(false);
  const [paperMode, setPaperMode] = useState(false);
  const [paperImage, setPaperImage] = useState<string | null>(null);
  const [paperName, setPaperName] = useState('');
  const [paperRelationship, setPaperRelationship] = useState('');
  const [paperPhone, setPaperPhone] = useState('');
  const [paperEmail, setPaperEmail] = useState('');
  const [paperDone, setPaperDone] = useState(false);

  // Move focus INTO the panel on open, and close on Escape.
  //
  // Without this, focus stays on the trigger button behind the overlay,
  // so a Return keypress — routine after typing a document name on a
  // phone keyboard — activates whichever Yes/No button still holds focus
  // and silently resets the officer's answers. Observed live on
  // 2026-07-27: typing into the documents box wiped the intake and
  // reverted the derived form to (Individual).
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  const [error, setError] = useState<string | null>(null);

  const signed = receipts.filter((r) => r.status === 'signed');

  // The variation the officer's answers imply. Same resolver the
  // subject's answers go through on the phone, so the two are directly
  // comparable and a disagreement is meaningful rather than an artefact
  // of two different rule sets.
  const variant: ReceiptVariant = useMemo(() => resolveReceiptVariant({
    isNamedParty: isNamedParty === true,
    premisesType,
    residesAtAddress: resides,
    authorizedAgent: authorized,
  }), [isNamedParty, premisesType, resides, authorized]);

  const documents = useMemo(
    () => docTitles.split('\n').map((t) => t.trim()).filter(Boolean).map((title) => ({ title, copies: 1 })),
    [docTitles],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiFetch<SignedReceipt[]>(`/serve-receipts/${job.id}`)
      .then((r) => { if (!cancelled) setReceipts(Array.isArray(r) ? r : []); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [open, job.id]);

  /**
   * Commit the officer's answers and get the link back.
   *
   * One call does both: the endpoint mints a token if none is live, so
   * the officer never has to think about token lifecycle — they answer
   * the questions and get a QR.
   */
  const submitIntake = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{
        token: string; url: string; variant: ReceiptVariant;
        job: NonNullable<typeof caption>;
        server: { name: string | null; badge: string | null };
      }>(
        `/serve-receipts/${job.id}/prefill`,
        {
          method: 'POST',
          body: JSON.stringify({
            is_named_party: isNamedParty,
            premises_type: premisesType,
            resides_at_address: resides,
            authorized_agent: authorized,
            recipient_name: recipientName || null,
            recipient_relationship: relationship || null,
            business_name: businessName || null,
            recipient_job_title: jobTitle || null,
            documents,
            note: null,
          }),
        },
      );
      setUrl(res.url);
      setCaption(res.job ?? null);
      setResolvedServer(res.server ?? null);
      // Error correction H: scanned off a phone screen in daylight, and
      // often off a printed page that has been folded.
      setQrPng(await QRCode.toDataURL(res.url, { errorCorrectionLevel: 'H', margin: 1, scale: 8 }));
      setStep('handoff');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the signing link.');
    } finally {
      setBusy(false);
    }
  }, [job.id, isNamedParty, premisesType, resides, authorized, recipientName, relationship,
      businessName, jobTitle, documents]);

  const buildBlank = useCallback((v: ReceiptVariant): ReceiptOfServiceData => {
    // Server-returned caption wins over card state: the card's ServeJob
    // has no plaintiff/defendant, and an empty court caption on a printed
    // legal instrument is worse than no caption at all.
    const cap = caption;
    const defendant = cap?.defendant_name ?? job.defendant_name ?? null;
    const party = v === 'business'
      ? (businessName || defendant || 'the business named')
      : (defendant || cap?.recipient_name || job.recipient_name || 'the named party');
    return {
      receiptId: 0,
      blank: true,
      qrDataUrl: qrPng ?? undefined,
      formTitle: receiptFormTitle(v),
      variant: v,
      variantLabel: VARIANT_LABEL[v],
      courtName: cap?.court_name ?? job.court_name ?? '',
      caseNumber: cap?.case_number ?? job.case_number ?? '',
      jobId: job.id,
      jurisdiction: cap?.jurisdiction ?? job.jurisdiction ?? '',
      plaintiffName: cap?.plaintiff_name ?? job.plaintiff_name ?? '',
      defendantName: defendant ?? '',
      documentType: cap?.document_type ?? job.document_type ?? '',
      serviceAddress: formatServiceAddress({
        address: cap?.service_address || job.recipient_address,
        city: job.recipient_city,
        state: job.recipient_state,
        zip: job.recipient_zip,
      }),
      premisesType: premisesType === 'business' ? 'Business' : premisesType === 'other' ? 'Other' : 'Residence',
      serverName: resolvedServer?.name ?? serverName ?? '',
      serverBadge: resolvedServer?.badge ?? serverBadge ?? '',
      agency: 'Rocky Mountain Protective Group',
      recipientName: '',
      acceptingOnBehalfOf: v === 'individual' ? undefined : party,
      documents,
      attestations: attestationsFor(v, party).map((a) => ({ id: a.id, text: a.text, accepted: false })),
      signedAt: new Date().toISOString(),
      residesAtAddress: false,
      authorizedAgent: false,
    };
  }, [job, caption, resolvedServer, qrPng, serverName, serverBadge, premisesType, businessName, documents]);

  /**
   * autoPrint + a blob URL rather than a download: the officer is at a
   * door or in a vehicle and needs paper, not a file in Downloads.
   * Falls back to a save if the popup is blocked.
   */
  const printDoc = useCallback(async (data: ReceiptOfServiceData, name: string, key: string) => {
    setPrinting(key);
    setError(null);
    try {
      const doc = await generateReceiptOfService({ ...data, printTarget: 'mobile' });
      doc.autoPrint();
      const blobUrl = doc.output('bloburl') as unknown as string;
      const w = window.open(blobUrl, '_blank');
      if (!w) doc.save(name);
    } catch {
      setError('Could not render the form.');
    } finally {
      setPrinting(null);
    }
  }, []);

  /**
   * COMPLETION OUTPUT — print the signed instrument from the vehicle.
   *
   * The subject may have signed entirely on their own phone, so this
   * device has never held the signature, the answers, or the
   * attestations. The server returns a ready-to-render payload with the
   * case join already done, so the printed copy cannot disagree with the
   * stored record about what the caption says.
   */
  const printSigned = useCallback(async (receiptId: number, copy: ReceiptCopy, index: number) => {
    setPrinting(`signed-${copy}`);
    setError(null);
    try {
      const data = await apiFetch<ReceiptOfServiceData>(`/serve-receipts/receipt/${receiptId}/document`);
      const doc = await generateReceiptOfService({ ...data, copy, printTarget: 'mobile' });
      doc.autoPrint();
      const blobUrl = doc.output('bloburl') as unknown as string;
      const w = window.open(blobUrl, '_blank');
      if (!w) doc.save(`acknowledgement-${copy}-${receiptId}.pdf`);
      // Advance only on success — a failed render must not mark a copy
      // printed and let the officer skip past it.
      setCopyStep(index + 1);
    } catch {
      setError('Could not retrieve the signed instrument.');
    } finally {
      setPrinting(null);
    }
  }, []);

  /**
   * Record a refusal to sign, attested by the officer.
   *
   * Service is complete when the papers are LEFT, refusal or not — Utah
   * R. Civ. P. 4(d). Whether they were left is asked explicitly rather
   * than inferred, because that is the fact a court asks about and the
   * two outcomes are genuinely different: papers left is good service,
   * papers retained is a failed attempt.
   */
  const submitRefusal = useCallback(async () => {
    if (!refusalReason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/serve-receipts/${job.id}/refusal`, {
        method: 'POST',
        body: JSON.stringify({
          recipient_name: recipientName || null,
          reason: refusalReason.trim(),
          documents_left: docsLeft,
        }),
      });
      setRefusalDone(true);
      setRefusing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the refusal.');
    } finally {
      setBusy(false);
    }
  }, [job.id, recipientName, refusalReason, docsLeft]);

  /**
   * Downscale the photographed page before it leaves the device.
   *
   * A raw phone photo is several megabytes and this is going into a
   * database column, not object storage. 1600px on the long edge at 0.8
   * JPEG keeps a signature and printed body text plainly legible while
   * landing inside the same 500KB ceiling a drawn signature has.
   */
  const readPageImage = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
        setPaperImage(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }, []);

  const submitPaper = useCallback(async () => {
    if (!paperImage || !paperName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/serve-receipts/${job.id}/paper`, {
        method: 'POST',
        body: JSON.stringify({
          form_variant: variant,
          premises_type: premisesType,
          sub_resides_at_address: resides,
          sub_is_authorized_agent: authorized,
          sub_defendant_name: job.defendant_name,
          sub_agrees_to_deliver: variant !== 'individual',
          sub_release_acknowledged: variant !== 'individual',
          recipient_name: paperName.trim(),
          recipient_relationship: paperRelationship || null,
          recipient_phone: paperPhone || null,
          recipient_email: paperEmail || null,
          business_name: businessName || null,
          recipient_job_title: jobTitle || null,
          documents,
          // The wording the paper carried, so the stored attestations match
          // the sheet the person actually initialled rather than today's copy.
          attestations: attestationsFor(variant, job.defendant_name || 'the named party')
            .map((a) => ({ id: a.id, text: a.text, accepted: true })),
          signed_page_image: paperImage,
        }),
      });
      setPaperDone(true);
      setPaperMode(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the paper form.');
    } finally {
      setBusy(false);
    }
  }, [job, variant, premisesType, resides, authorized, paperImage, paperName,
      paperRelationship, paperPhone, paperEmail, businessName, jobTitle, documents]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); setStep('intake'); }}
        className={compact
          ? 'flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] font-bold text-fg-secondary hover:bg-surface-sunken/30 transition-colors focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-silver-400)]/50'
          : 'flex items-center gap-1.5 px-2 py-1.5 rounded-[2px] border border-rmpg-700 text-[11px] font-bold text-fg-secondary hover:bg-surface-sunken'}
        title="Acknowledgement of Service"
        aria-label={`Acknowledgement of service for ${job.recipient_name || `job ${job.id}`}`}
      >
        <QrCode className="w-3 h-3" />
        {triggerLabel ?? 'Receipt'}
      </button>
    );
  }

  const namedParty = job.defendant_name || job.recipient_name || 'the named party';

  // Portalled to document.body. Rendered inline it is a DOM descendant of
  // the job card, so its clicks and keystrokes bubble into the card's own
  // expand/select handlers even though it paints as a full-screen overlay.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Acknowledgement of service for ${job.recipient_name || `job ${job.id}`}`}
      className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-3"
      onClick={(e) => { e.stopPropagation(); setOpen(false); }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="w-full max-w-sm bg-surface-raised border border-rmpg-700 rounded-[2px] max-h-[92vh] overflow-y-auto focus:outline-none"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-3 py-2 border-b border-rmpg-700 sticky top-0 bg-surface-raised">
          <div className="flex items-center gap-2 min-w-0">
            {step === 'handoff' && (
              <button type="button" onClick={() => setStep('intake')} aria-label="Back to intake" className="p-1 text-fg-muted">
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div className="min-w-0">
              <h2 className="text-[13px] font-bold text-rmpg-100 truncate">Acknowledgement of Service</h2>
              <p className="text-[10px] text-fg-muted truncate">
                {job.case_number ? `Case ${job.case_number} · ` : ''}{job.recipient_name || `Job ${job.id}`}
              </p>
            </div>
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="p-1 text-fg-muted">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="p-3 space-y-4">
          {/* ── Completion output ── */}
          {signed.length > 0 && (
            <section className="p-2.5 rounded-[2px] border border-sev-ok/50 bg-surface-sunken space-y-2">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-sev-ok shrink-0 mt-0.5" />
                <div className="text-[11px] text-rmpg-100 leading-snug">
                  <strong>Signed.</strong>{' '}
                  {signed[0].recipient_name} signed the{' '}
                  {VARIANT_LABEL[(signed[0].form_variant as ReceiptVariant) ?? 'individual']} form.
                </div>
              </div>
              {/* Three copies, printed ONE AT A TIME in order.
                  A browser cannot detect when a print dialog is dismissed,
                  so chaining three automatically would fire three dialogs
                  at once — which is exactly what must not happen when a
                  roll printer is producing one sheet at a time. The officer
                  advances each step instead, which also lets them tear off
                  and set aside each copy before the next starts. */}
              <div className="space-y-1.5">
                {RECEIPT_COPY_ORDER.map((copy, i) => {
                  const done = i < copyStep;
                  const active = i === copyStep;
                  return (
                    <button
                      key={copy}
                      type="button"
                      onClick={() => printSigned(signed[0].id, copy, i)}
                      disabled={printing !== null || !active}
                      className={`w-full flex items-center gap-2 py-2.5 px-3 rounded-[2px] text-[12px] font-semibold disabled:opacity-50 ${
                        active
                          ? 'bg-brand-600 text-rmpg-50'
                          : 'border border-rmpg-700 text-fg-muted bg-surface-sunken'
                      }`}
                    >
                      {printing === `signed-${copy}`
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : done
                          ? <CheckCircle2 className="w-3.5 h-3.5 text-sev-ok" />
                          : <FileDown className="w-3.5 h-3.5" />}
                      <span className="flex-1 text-left">
                        {i + 1}. {RECEIPT_COPY_LABEL[copy]}
                      </span>
                      {done && <span className="text-[10px]">printed</span>}
                    </button>
                  );
                })}
              </div>
              {copyStep >= RECEIPT_COPY_ORDER.length ? (
                <p className="text-[10px] text-sev-ok leading-snug">
                  All three copies printed. Company record filed, subject copy
                  handed over, client copy for the return.
                </p>
              ) : (
                <p className="text-[10px] text-fg-muted leading-snug">
                  Prints one at a time in order — tear off each sheet before
                  starting the next. Pulls the completed instrument back from
                  the record, including a signature taken on the subject’s own
                  phone that this device never saw.
                </p>
              )}
            </section>
          )}

          {step === 'intake' && (
            <>
              <p className="text-[11px] text-fg-secondary leading-snug">
                {seed
                  ? 'Carried over from the attempt you just logged. Confirm the two '
                    + 'address questions — the attempt log does not ask them, and they '
                    + 'are what separate a co-habitant from a substitute.'
                  : 'Answer what you can see. These pick the right form and pre-fill '
                    + 'it — the person signing can still correct anything, because the '
                    + 'statements are theirs to make.'}
              </p>

              <Q label={`Is the person at the door ${namedParty}?`}>
                <Choice
                  value={isNamedParty}
                  onChange={setIsNamedParty}
                  options={[
                    { v: true, label: 'Yes' },
                    { v: false, label: 'No' },
                    { v: null, label: 'Unsure' },
                  ]}
                />
              </Q>

              <Q label="This address is a">
                <Choice
                  value={premisesType}
                  onChange={setPremisesType}
                  options={[
                    { v: 'residence' as const, label: 'Residence' },
                    { v: 'business' as const, label: 'Business' },
                    { v: 'other' as const, label: 'Other' },
                  ]}
                />
              </Q>

              {isNamedParty !== true && (
                <>
                  <Q label="Do they say they live here?">
                    <Choice
                      value={resides}
                      onChange={setResides}
                      options={[{ v: true, label: 'Yes' }, { v: false, label: 'No' }]}
                    />
                  </Q>
                  <Q label="Authorized to accept service here?">
                    <Choice
                      value={authorized}
                      onChange={setAuthorized}
                      options={[{ v: true, label: 'Yes' }, { v: false, label: 'No' }]}
                    />
                  </Q>
                  <Q label="Their name (optional — they can enter it)">
                    <input className={inputCls} value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="From ID, if shown" />
                  </Q>
                  <Q label="Relationship (optional)">
                    <select className={inputCls} value={relationship} onChange={(e) => setRelationship(e.target.value)}>
                      <option value="">Select…</option>
                      {RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </Q>
                  {premisesType === 'business' && (
                    <>
                      <Q label="Business name">
                        <input className={inputCls} value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Legal name of the business" />
                      </Q>
                      <Q label="Their title (optional)">
                        <input className={inputCls} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Office Manager" />
                      </Q>
                    </>
                  )}
                </>
              )}

              <Q label="Documents handed over (one per line)">
                <textarea
                  className={`${inputCls} h-20 resize-none`}
                  value={docTitles}
                  onChange={(e) => setDocTitles(e.target.value)}
                  placeholder={'Summons - Civil\nComplaint\nNotice of Hearing'}
                />
              </Q>

              <div className="p-2.5 rounded-[2px] border border-brand-600 bg-surface-sunken">
                <p className="text-[10px] uppercase tracking-wider text-fg-muted">Form selected</p>
                <p className="text-[13px] font-bold text-rmpg-100">{receiptFormTitle(variant)}</p>
              </div>

              <button
                type="button"
                onClick={submitIntake}
                disabled={busy || isNamedParty === undefined || documents.length === 0}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-[2px] bg-brand-600 text-rmpg-50 text-[13px] font-semibold disabled:opacity-50"
              >
                {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Preparing…</> : 'Continue'}
              </button>
              {(isNamedParty === undefined || documents.length === 0) && (
                <p className="text-[10px] text-sev-warn leading-snug">
                  {isNamedParty === undefined
                    ? 'Answer who is at the door to continue.'
                    : 'List at least one document handed over — it is the itemization the signer acknowledges.'}
                </p>
              )}
            </>
          )}

          {step === 'handoff' && (
            <>
              <div className="p-2.5 rounded-[2px] border border-rmpg-700 bg-surface-sunken">
                <p className="text-[10px] uppercase tracking-wider text-fg-muted">Prepared</p>
                <p className="text-[13px] font-bold text-rmpg-100">{receiptFormTitle(variant)}</p>
              </div>

              <section>
                <h3 className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--panel-header-color)' }}>
                  Have them scan
                </h3>
                <div className="bg-white p-3 rounded-[2px] flex items-center justify-center min-h-[180px]">
                  {qrPng
                    ? <img src={qrPng} alt="Scan to sign the acknowledgement of service" className="w-44 h-44" />
                    : <Loader2 className="w-6 h-6 animate-spin text-rmpg-700" />}
                </div>
                {url && (
                  <a href={url} target="_blank" rel="noopener noreferrer"
                    className="mt-2 flex items-center justify-center gap-1 text-[10px] text-fg-muted hover:text-rmpg-200">
                    <ExternalLink className="w-3 h-3" /> Open the form myself
                  </a>
                )}
              </section>

              <section>
                <h3 className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--panel-header-color)' }}>
                  Or print it
                </h3>
                <p className="text-[10px] text-fg-muted mb-2 leading-snug">
                  Same form, completed by hand. The QR is printed on it too, so
                  they can switch to their phone at any point — either way only
                  one signed record is created.
                </p>
                <button
                  type="button"
                  onClick={() => printDoc(buildBlank(variant), `acknowledgement-${variant}-${job.case_number || job.id}.pdf`, 'blank')}
                  disabled={printing !== null}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-[2px] border border-rmpg-600 text-rmpg-200 text-[12px] font-semibold disabled:opacity-50"
                >
                  {printing === 'blank' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
                  Print {VARIANT_LABEL[variant]} form
                </button>

                <details className="mt-2">
                  <summary className="text-[10px] text-fg-muted cursor-pointer">Print a different variation</summary>
                  <div className="mt-1.5 space-y-1.5">
                    {(['individual', 'co_habitant', 'business', 'substitute'] as ReceiptVariant[])
                      .filter((v) => v !== variant)
                      .map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => printDoc(buildBlank(v), `acknowledgement-${v}-${job.case_number || job.id}.pdf`, v)}
                          disabled={printing !== null}
                          className="w-full flex items-center gap-2 p-2 rounded-[2px] border border-rmpg-700 bg-surface-sunken text-[11px] text-rmpg-200 disabled:opacity-50"
                        >
                          {printing === v ? <Loader2 className="w-3 h-3 animate-spin" /> : <Printer className="w-3 h-3" />}
                          {VARIANT_LABEL[v]}
                        </button>
                      ))}
                  </div>
                </details>
              </section>

              {/* ── Paper form completed by hand ──
                  This path shipped as a dead end: a blank could be
                  printed and signed in ink with nowhere to put it. A
                  signed instrument sitting in a folder in a vehicle is
                  not a record. */}
              <section className="border-t border-rmpg-700 pt-3">
                {paperDone ? (
                  <p className="text-[11px] text-sev-ok leading-snug">
                    Paper form recorded. The photographed page is stored as the
                    signed original.
                  </p>
                ) : refusalDone ? null : paperMode ? (
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider"
                       style={{ color: 'var(--panel-header-color)' }}>
                      Record a hand-completed form
                    </p>
                    <label className="block">
                      <span className="text-[10px] text-fg-muted">Photograph the signed page</span>
                      <input
                        type="file" accept="image/*" capture="environment"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) readPageImage(f); }}
                        className="w-full text-[11px] text-fg-secondary mt-1"
                      />
                    </label>
                    {paperImage && (
                      <img src={paperImage} alt="Signed page" className="w-full rounded-[2px] border border-rmpg-700" />
                    )}
                    <input className={inputCls} value={paperName} onChange={(e) => setPaperName(e.target.value)}
                      placeholder="Name as signed on the paper" />
                    <input className={inputCls} value={paperRelationship} onChange={(e) => setPaperRelationship(e.target.value)}
                      placeholder="Relationship or title, as written" />
                    <div className="flex gap-2">
                      <input className={inputCls} value={paperPhone} onChange={(e) => setPaperPhone(e.target.value)}
                        placeholder="Phone" inputMode="tel" />
                      <input className={inputCls} value={paperEmail} onChange={(e) => setPaperEmail(e.target.value)}
                        placeholder="Email" inputMode="email" />
                    </div>
                    <p className="text-[10px] text-fg-muted leading-snug">
                      Transcribe what the paper says, not what you remember. Your
                      name is attached to the record as the person who saw both.
                    </p>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setPaperMode(false)}
                        className="flex-1 py-2 rounded-[2px] border border-rmpg-700 text-[12px] text-fg-secondary">
                        Cancel
                      </button>
                      <button type="button" onClick={submitPaper}
                        disabled={busy || !paperImage || !paperName.trim()}
                        className="flex-1 py-2 rounded-[2px] bg-brand-600 text-rmpg-50 text-[12px] font-semibold disabled:opacity-40">
                        {busy ? 'Recording…' : 'Record paper form'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setPaperMode(true)}
                    disabled={busy || refusing}
                    className="w-full flex items-center justify-center gap-2 py-2 text-[11px] font-semibold text-fg-secondary disabled:opacity-40">
                    <Camera className="w-3.5 h-3.5" />
                    They completed it on paper
                  </button>
                )}
              </section>

              {/* ── Refusal ──
                  A person who refuses to sign will not tap a phone either,
                  so the officer attests to it. Before this there was no
                  record at all and a refused service simply vanished —
                  even though the service itself is good once the papers
                  are left. */}
              <section className="border-t border-rmpg-700 pt-3">
                {refusalDone ? (
                  <p className="text-[11px] text-sev-ok leading-snug">
                    Refusal recorded{docsLeft ? ' — documents left, service complete.' : ' — documents retained, logged as an attempt.'}
                  </p>
                ) : paperDone ? null : refusing ? (
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider"
                       style={{ color: 'var(--panel-header-color)' }}>
                      Record a refusal
                    </p>
                    <textarea
                      className={`${inputCls} h-16 resize-none`}
                      value={refusalReason}
                      onChange={(e) => setRefusalReason(e.target.value)}
                      placeholder="What happened, in your words. e.g. Identified himself, read the caption, declined to sign and closed the door."
                    />
                    <label className="flex items-start gap-2 text-[11px] text-rmpg-100">
                      <input type="checkbox" checked={docsLeft} onChange={(e) => setDocsLeft(e.target.checked)} className="mt-0.5" />
                      <span>
                        I left the documents in their presence.
                        <span className="block text-[10px] text-fg-muted">
                          Service is complete when the papers are left, refusal or
                          not. Unchecked, this is logged as an attempt instead.
                        </span>
                      </span>
                    </label>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setRefusing(false)}
                        className="flex-1 py-2 rounded-[2px] border border-rmpg-700 text-[12px] text-fg-secondary">
                        Cancel
                      </button>
                      <button type="button" onClick={submitRefusal}
                        disabled={busy || !refusalReason.trim()}
                        className="flex-1 py-2 rounded-[2px] bg-sev-warn/20 border border-sev-warn text-[12px] font-semibold text-rmpg-100 disabled:opacity-40">
                        {busy ? 'Recording…' : 'Record refusal'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setRefusing(true)}
                    disabled={busy || paperMode}
                    className="w-full flex items-center justify-center gap-2 py-2 text-[11px] font-semibold text-fg-secondary disabled:opacity-40">
                    <Ban className="w-3.5 h-3.5" />
                    They refused to sign
                  </button>
                )}
              </section>

              <div className="flex items-start gap-2 p-2.5 rounded-[2px] border border-rmpg-700 bg-surface-sunken">
                <AlertTriangle className="w-3.5 h-3.5 text-sev-warn shrink-0 mt-0.5" />
                <p className="text-[10px] text-fg-secondary leading-snug">
                  If their answers differ from yours, theirs are recorded — the
                  declarations are their statements. The difference is flagged
                  for review rather than overwritten.
                </p>
              </div>
            </>
          )}

          {error && (
            <p className="text-[11px] text-sev-critical border border-sev-critical rounded-[2px] p-2">{error}</p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
