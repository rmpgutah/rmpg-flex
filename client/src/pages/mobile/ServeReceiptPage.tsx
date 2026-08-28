// ============================================================
// ServeReceiptPage — /m/serve-receipt/:token
//
// The RECIPIENT's 5-step Acknowledgement of Service wizard. Reached
// by scanning the QR printed on the Call for Service report / run sheet.
// This page is unauthenticated — the signer is a member of the public
// and will never have an RMPG login.
//
// This file is the wizard controller: it owns all state, step routing,
// and submit logic. Each step receives only the props it reads and
// setters it writes. No step imports from another step.
//
// The loading/error/done/pending screens are unchanged from the
// single-page version — only the form UI structure changes.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { Check, AlertTriangle, Loader2, Download, Printer, ShieldCheck } from 'lucide-react';
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
import { collectDeviceCapture, type DeviceCapture } from '../../utils/deviceCapture';

// Step components
import WizardShell from './steps/WizardShell';
import Step1WhoIsSigning from './steps/Step1WhoIsSigning';
import Step2Identity from './steps/Step2Identity';
import Step3Documents from './steps/Step3Documents';
import Step4Statements from './steps/Step4Statements';
import Step5SignSubmit, { type GpsStatus } from './steps/Step5SignSubmit';

// ── Types mirroring GET /api/serve-receipt/:token ─────────────────────
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

// ── Utility: SignaturePad is imported but only used in Step5 props ─────
// Re-export so the import stays live and TypeScript doesn't prune it.
const _keepSignaturePad = SignaturePad; void _keepSignaturePad;

// ── Main component ────────────────────────────────────────────────────

export default function ServeReceiptPage() {
  const { token = '' } = useParams<{ token: string }>();
  const apiBase = useMemo(() => `/api/serve-receipt/${encodeURIComponent(token)}`, [token]);

  const [ctx, setCtx] = useState<ReceiptContext | null>(null);
  const [loadError, setLoadError] = useState<{ code: string; message: string } | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Step routing ───────────────────────────────────────────
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // ── Step 1: Who Is Signing ─────────────────────────────────
  const [isNamedParty, setIsNamedParty] = useState<boolean | null>(null);
  const [premisesType, setPremisesType] = useState<'residence' | 'business' | 'other'>('residence');
  const [residesAtAddress, setResidesAtAddress] = useState(false);
  const [authorizedAgent, setAuthorizedAgent] = useState(false);
  const [relationship, setRelationship] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [expectedDelivery, setExpectedDelivery] = useState('');

  // ── Step 2: Identity ───────────────────────────────────────
  const [recipientName, setRecipientName] = useState('');
  const [idScanning, setIdScanning] = useState(false);
  const [idScanError, setIdScanError] = useState<string | null>(null);
  const [idVerified, setIdVerified] = useState(false);
  const [idDescription, setIdDescription] = useState('');
  const [aamvaResult, setAamvaResult] = useState<Record<string, unknown> | null>(null);
  const [manualFirstName, setManualFirstName] = useState('');
  const [manualLastName, setManualLastName] = useState('');
  const [manualMiddleName, setManualMiddleName] = useState('');
  const [manualDob, setManualDob] = useState('');
  const [manualDlNumber, setManualDlNumber] = useState('');
  const [manualDlState, setManualDlState] = useState('');
  const [manualGender, setManualGender] = useState('');
  const [manualHeight, setManualHeight] = useState('');
  const [manualWeight, setManualWeight] = useState('');
  const [manualEyeColor, setManualEyeColor] = useState('');
  const [manualHairColor, setManualHairColor] = useState('');
  const [idFrontImage, setIdFrontImage] = useState<string | null>(null);
  const [idBackImage, setIdBackImage] = useState<string | null>(null);
  // 'photo' added to the method union for the wizard's photo card
  const [idScanMethod, setIdScanMethod] = useState<'barcode' | 'photo' | 'manual' | null>(null);
  const [activeCard, setActiveCard] = useState<'barcode' | 'photo' | 'manual' | null>(null);
  const [addressCurrent, setAddressCurrent] = useState(true);
  const [currentAddress, setCurrentAddress] = useState('');
  const [currentCity, setCurrentCity] = useState('');
  const [currentState, setCurrentState] = useState('');
  const [currentZip, setCurrentZip] = useState('');

  // ── Step 3: Documents ──────────────────────────────────────
  const [docCopies, setDocCopies] = useState<Record<string, number>>({});

  // ── Step 4: Statements ─────────────────────────────────────
  const [allConfirmed, setAllConfirmed] = useState(false);

  // ── Step 5: Sign & Submit ──────────────────────────────────
  const [signature, setSignature] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>('pending');
  const [coords, setCoords] = useState<{ lat: number; lng: number; acc: number } | null>(null);

  // ── Shared submit state ────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState<{ receiptId: number; emailStatus: string; variant: ReceiptVariant } | null>(null);
  const [pending, setPending] = useState(false);

  // Device fingerprint — collected in background, does not block UX.
  const [deviceCapture, setDeviceCapture] = useState<DeviceCapture | null>(null);
  useEffect(() => {
    collectDeviceCapture().then(setDeviceCapture).catch(() => undefined);
  }, []);

  // ── Light theme for this public-facing route ───────────────
  useEffect(() => {
    document.documentElement.classList.add('public-form');
    const priorLang = document.documentElement.lang;
    if (!priorLang) document.documentElement.lang = 'en-US';
    return () => {
      document.documentElement.classList.remove('public-form');
      if (!priorLang) document.documentElement.lang = priorLang;
    };
  }, []);

  // ── Load ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Drain any queued submission from a prior session on this device first.
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

          // Seed from the officer's MDT intake — every value stays editable.
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

          const officerDocs = pre?.documents?.length ? pre.documents : null;
          setDocCopies(officerDocs
            ? Object.fromEntries(officerDocs.map((d) => [d.title, d.copies || 1]))
            : Object.fromEntries((data.documents ?? []).map((d: { title: string }) => [d.title, 1])));
        }
      } catch {
        if (!cancelled) setLoadError({ code: 'network', message: 'Could not reach the server. Check your connection and try again.' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [apiBase, token]);

  // ── Pending retry (offline → online) ──────────────────────
  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    let timer = 0;
    const attempt = async () => {
      const r = await flushQueued(token)
        .catch(() => ({ status: 'offline' as const, retryInMs: 60_000 }));
      if (cancelled) return;
      if (r.status === 'offline') {
        window.clearTimeout(timer);
        timer = window.setTimeout(attempt, r.retryInMs);
        return;
      }
      if (r.status === 'expired') {
        setPending(false);
        setSubmitError('This link expired before your signature could be sent. Please ask the process server for a new one.');
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

  // ── Derived values ─────────────────────────────────────────
  const namedParty = ctx?.job.defendant_name || ctx?.job.recipient_name || 'the named party';
  const partyLabel = premisesType === 'business' && businessName.trim()
    ? businessName.trim()
    : namedParty;
  const partyIsEntity = isEntityName(namedParty);

  const variant: ReceiptVariant = useMemo(() => resolveReceiptVariant({
    isNamedParty: !partyIsEntity && isNamedParty === true,
    premisesType,
    residesAtAddress,
    authorizedAgent,
  }), [partyIsEntity, isNamedParty, premisesType, residesAtAddress, authorizedAgent]);

  const attestations = useMemo(
    () => attestationsFor(variant, partyLabel),
    [variant, partyLabel],
  );

  const formTitle = receiptFormTitle(variant);

  const addressLine = ctx ? formatServiceAddress({
    address: ctx.job.service_address, city: ctx.job.service_city,
    state: ctx.job.service_state, zip: ctx.job.service_zip,
  }) : '';

  // If the named party is an entity, automatically set isNamedParty = false
  useEffect(() => {
    if (partyIsEntity) setIsNamedParty(false);
  }, [partyIsEntity]);

  // Auto-fill recipient name when signer confirms they ARE the named party
  const officerName = ctx?.prefill?.recipient_name ?? null;
  useEffect(() => {
    if (officerName) return;
    if (isNamedParty === true) setRecipientName(ctx?.job.recipient_name || namedParty);
    else if (isNamedParty === false) setRecipientName((prev) => (prev === namedParty || prev === ctx?.job.recipient_name ? '' : prev));
  }, [isNamedParty, ctx, namedParty, officerName]);

  // Seed businessName from named party when variant resolves to 'business'
  useEffect(() => {
    if (variant !== 'business') return;
    setBusinessName((prev) => prev.trim() || namedParty);
  }, [variant, namedParty]);

  // Build accepted map from the single allConfirmed flag (for payload compat)
  const accepted = useMemo(() => {
    if (!allConfirmed) return {} as Record<string, boolean>;
    return Object.fromEntries(attestations.map((a) => [a.id, true]));
  }, [allConfirmed, attestations]);

  const fieldErrors = useMemo(() => ({
    idNotVerified: !idVerified && idFrontImage === null,
  }), [idVerified, idFrontImage]);

  const acceptedAttestations = useMemo(
    () => attestations.map((a) => ({ id: a.id, text: a.text, accepted: !!accepted[a.id] })),
    [attestations, accepted],
  );

  // ── Step validation ────────────────────────────────────────
  const step1Valid = useMemo(() => {
    if (!partyIsEntity && isNamedParty === null) return false;
    if (partyIsEntity || isNamedParty === false) {
      // At least one of resides/authorized must be checked, unless "other"
      if (premisesType !== 'other' && !residesAtAddress && !authorizedAgent) return false;
    }
    return true;
  }, [partyIsEntity, isNamedParty, premisesType, residesAtAddress, authorizedAgent]);

  const step2Valid = useMemo(() => {
    const idCompleted = idVerified || idFrontImage !== null;
    return recipientName.trim().length > 0 && idCompleted;
  }, [recipientName, idVerified, idFrontImage]);

  const step3Valid = true;

  const step4Valid = allConfirmed;

  const step5Valid = useMemo(() => {
    if (gpsStatus !== 'granted') return false;
    if (!signature) return false;
    if (phone.replace(/\D/g, '').length < 10) return false;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return false;
    return true;
  }, [gpsStatus, signature, phone, email]);

  const stepValid = [false, step1Valid, step2Valid, step3Valid, step4Valid, step5Valid];

  // ── ID handlers ────────────────────────────────────────────
  const scanId = useCallback(async (file: File) => {
    setIdScanning(true);
    setIdScanError(null);
    try {
      const outcome = await decodePdf417(file);
      if (!outcome) {
        setIdScanError('Could not read the barcode. You can enter your ID information manually below.');
        return;
      }
      const dl = parseAamva(outcome.text);
      const full = [dl.first_name, dl.middle_name, dl.last_name, dl.suffix]
        .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      if (full) setRecipientName(full);
      setIdDescription([dl.gender, dl.race, dl.height, dl.weight && `${dl.weight} lbs`, dl.hair_color, dl.eye_color]
        .filter(Boolean).join(', '));
      setAamvaResult(dl as unknown as Record<string, unknown>);
      setIdScanMethod('barcode');
      setIdVerified(true);
      setActiveCard(null);
    } catch (err) {
      console.error('[aos] barcode scan error:', err);
      setIdScanError('Could not read the barcode. You can enter your ID information manually below.');
    } finally {
      setIdScanning(false);
    }
  }, []);

  const captureIdPhoto = useCallback((file: File, side: 'front' | 'back') => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        if (side === 'front') {
          setIdFrontImage(dataUrl);
          setIdScanMethod('photo');
        } else {
          setIdBackImage(dataUrl);
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }, []);

  const completeManualId = useCallback(() => {
    if (!manualFirstName.trim() || !manualLastName.trim()) return;
    const full = [manualFirstName, manualMiddleName, manualLastName]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    setRecipientName(full);
    setIdDescription([manualGender, manualHeight, manualWeight && `${manualWeight} lbs`, manualHairColor, manualEyeColor]
      .filter(Boolean).join(', '));
    setIdScanMethod('manual');
    setIdVerified(true);
    setActiveCard(null);
  }, [manualFirstName, manualMiddleName, manualLastName, manualGender, manualHeight, manualWeight, manualHairColor, manualEyeColor]);

  // ── PDF helpers ────────────────────────────────────────────
  const buildPdfData = useCallback((receiptId: number): ReceiptOfServiceData => ({
    receiptId,
    formTitle,
    variant,
    variantLabel: VARIANT_LABEL[variant],
    courtName: ctx?.job.court_name ?? '',
    caseNumber: ctx?.job.case_number ?? '',
    jobId: ctx?.job.id,
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
    recipientGender: (aamvaResult?.gender as string) || manualGender || undefined,
    recipientRace: (aamvaResult?.race as string) || undefined,
    recipientHeight: (aamvaResult?.height as string) || manualHeight || undefined,
    recipientWeight: (aamvaResult?.weight as string) || manualWeight || undefined,
    recipientHairColor: (aamvaResult?.hair_color as string) || manualHairColor || undefined,
    recipientEyeColor: (aamvaResult?.eye_color as string) || manualEyeColor || undefined,
    recipientDlNumber: (aamvaResult?.dl_number as string) || manualDlNumber || undefined,
    recipientDlState: (aamvaResult?.dl_state as string) || manualDlState || undefined,
    recipientDlClass: (aamvaResult?.dl_class as string) || undefined,
    recipientDlExpiry: (aamvaResult?.dl_expiry as string) || undefined,
    recipientIsRealId: aamvaResult?.is_real_id != null ? aamvaResult.is_real_id as boolean : null,
    idScanMethod: idScanMethod === 'photo' ? null : idScanMethod,
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
      authorizedAgent, expectedDelivery, aamvaResult, manualGender, manualHeight, manualWeight,
      manualHairColor, manualEyeColor, manualDlNumber, manualDlState, idScanMethod]);

  const downloadPdf = useCallback(async (receiptId: number) => {
    const doc = await generateReceiptOfService({ ...buildPdfData(receiptId), copy: 'subject' });
    doc.save(`acknowledgement-of-service-${ctx?.job.case_number || receiptId}.pdf`);
  }, [buildPdfData, ctx]);

  const printPdf = useCallback(async (receiptId: number) => {
    const doc = await generateReceiptOfService({ ...buildPdfData(receiptId), copy: 'subject', printTarget: 'mobile' });
    doc.autoPrint();
    const url = doc.output('bloburl') as unknown as string;
    const w = window.open(url, '_blank');
    if (!w) doc.save(`acknowledgement-of-service-${ctx?.job.case_number || receiptId}-mobile.pdf`);
  }, [buildPdfData, ctx]);

  // ── Submit ─────────────────────────────────────────────────
  const submit = useCallback(async () => {
    if (!step5Valid || submitting) return;
    setSubmitting(true);
    setSubmitError(null);

    const payload = {
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
      id_scan_method: idScanMethod,
      aamva_data: aamvaResult,
      manual_id: idScanMethod === 'manual' ? {
        first_name: manualFirstName.trim(),
        last_name: manualLastName.trim(),
        middle_name: manualMiddleName.trim() || null,
        dob: manualDob || null,
        dl_number: manualDlNumber || null,
        dl_state: manualDlState || null,
        gender: manualGender || null,
        height: manualHeight || null,
        weight: manualWeight || null,
        eye_color: manualEyeColor || null,
        hair_color: manualHairColor || null,
      } : null,
      id_front_image: idFrontImage,
      id_back_image: idBackImage,
      recipient_address_current: !addressCurrent ? {
        address: currentAddress, city: currentCity,
        state: currentState, zip: currentZip,
      } : null,
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
      // DeviceCapture fields (additive to existing DeviceSignals)
      device_fingerprint: deviceCapture?.fingerprint ?? null,
      screen_resolution: deviceCapture?.screen_resolution ?? null,
      color_depth: deviceCapture?.color_depth ?? null,
      timezone: deviceCapture?.timezone ?? null,
      language: deviceCapture?.language ?? null,
      languages: deviceCapture?.languages ?? null,
      platform: deviceCapture?.platform ?? null,
      hardware_concurrency: deviceCapture?.hardware_concurrency ?? null,
      device_memory: deviceCapture?.device_memory ?? null,
      max_touch_points: deviceCapture?.max_touch_points ?? null,
      timezone_offset: deviceCapture?.timezone_offset ?? null,
      // Extended DeviceCapture signals
      user_agent: deviceCapture?.user_agent ?? null,
      network_type: deviceCapture?.network_type ?? null,
      network_effective_type: deviceCapture?.network_effective_type ?? null,
      battery_level: deviceCapture?.battery_level ?? null,
      battery_charging: deviceCapture?.battery_charging ?? null,
      webgl_renderer: deviceCapture?.webgl_renderer ?? null,
      webgl_vendor: deviceCapture?.webgl_vendor ?? null,
      canvas_fingerprint: deviceCapture?.canvas_fingerprint ?? null,
      audio_fingerprint: deviceCapture?.audio_fingerprint ?? null,
      fonts_fingerprint: deviceCapture?.fonts_fingerprint ?? null,
      page_visibility_hidden_count: deviceCapture?.page_visibility_hidden_count ?? null,
      page_visibility_hidden_ms: deviceCapture?.page_visibility_hidden_ms ?? null,
      captured_at_ms: deviceCapture?.captured_at_ms ?? null,
    };

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
        setSubmitError('This link expired before your signature could be sent. Please ask the process server for a new one.');
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
      setPending(true);
    } finally {
      setSubmitting(false);
    }
  }, [step5Valid, submitting, token, apiBase, variant, formTitle, acceptedAttestations, recipientName,
      relationship, jobTitle, businessName, phone, email, accepted, premisesType, ctx, docCopies,
      partyLabel, residesAtAddress, authorizedAgent, expectedDelivery, signature, coords, buildPdfData,
      idScanMethod, aamvaResult, manualFirstName, manualLastName, manualMiddleName, manualDob,
      manualDlNumber, manualDlState, manualGender, manualHeight, manualWeight, manualEyeColor,
      manualHairColor, idFrontImage, idBackImage, addressCurrent, currentAddress, currentCity,
      currentState, currentZip, idVerified, idDescription, deviceCapture]);

  // ── Terminal screens (unchanged from single-page version) ──

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center text-gray-400">
        <Loader2 className="animate-spin mr-2" size={18} /> Loading…
      </div>
    );
  }

  if (pending) {
    return (
      <div className="min-h-screen bg-white p-6 flex items-center justify-center">
        <div className="max-w-sm w-full text-center">
          <div className="mx-auto mb-4 w-14 h-14 rounded-sm bg-amber-50 border border-amber-200 flex items-center justify-center">
            <Loader2 className="text-amber-500 animate-spin" size={28} />
          </div>
          <h1 className="text-gray-800 text-lg font-semibold mb-2">Signed — saving</h1>
          <p className="text-gray-500 text-[15px] leading-relaxed mb-3">
            Your signature is saved on this phone. There is no signal here, so it will
            be sent automatically as soon as there is.
          </p>
          <p className="text-gray-400 text-[13px] leading-relaxed">
            You can close this page. Nothing is lost — it will send the next time you
            open it with a connection. The process server has a record that you signed.
          </p>
        </div>
      </div>
    );
  }

  if (loadError || !ctx) {
    return (
      <div className="min-h-screen bg-white p-6 flex items-center justify-center">
        <div className="max-w-sm text-center">
          <AlertTriangle className="mx-auto mb-3 text-amber-400" size={32} />
          <h1 className="text-gray-800 text-lg font-semibold mb-2">This link can't be opened</h1>
          <p className="text-gray-500 text-sm">{loadError?.message}</p>
          <p className="text-gray-400 text-xs mt-4">Please ask the process server for a new link.</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-white p-6 flex items-center justify-center">
        <div className="max-w-sm w-full text-center">
          <div className="mx-auto mb-4 w-14 h-14 rounded-sm bg-green-50 border border-green-200 flex items-center justify-center">
            <ShieldCheck className="text-green-500" size={30} />
          </div>
          <h1 className="text-gray-800 text-lg font-semibold mb-1">Acknowledgement signed</h1>
          <p className="text-gray-400 text-xs mb-2">{receiptFormTitle(done.variant)}</p>
          <p className="text-gray-500 text-sm mb-1">
            Receipt #{done.receiptId}
            {ctx.job.case_number ? ` · Case ${ctx.job.case_number}` : ''}
          </p>
          <p className="text-gray-400 text-xs mb-6">
            {done.emailStatus === 'pending' || done.emailStatus === 'sent'
              ? `A copy is on its way to ${email}.`
              : 'Save a copy for your records below.'}
          </p>
          <button
            type="button"
            onClick={() => downloadPdf(done.receiptId)}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-3 rounded-sm font-semibold"
          >
            <Download size={16} /> Download my copy (PDF)
          </button>
          <button
            type="button"
            onClick={() => printPdf(done.receiptId)}
            className="mt-2 w-full flex items-center justify-center gap-2 border border-gray-300 text-gray-600 py-3 rounded-sm font-semibold"
          >
            <Printer size={16} /> Print paper copy (mobile printer)
          </button>
        </div>
      </div>
    );
  }

  // ── Wizard steps ───────────────────────────────────────────
  // Steps 1 and 3 require nothing from the signer so they count as pre-solved.
  // Steps 2, 4, and 5 each add 1 once the signer has moved past them.
  const sectionsDone = 2 + (step > 2 ? 1 : 0) + (step > 3 ? 1 : 0) + (step > 4 ? 1 : 0);
  const goBack = step > 1 ? () => setStep((s) => (s - 1) as 1 | 2 | 3 | 4 | 5) : undefined;
  const goNext = () => {
    if (step < 5) setStep((s) => (s + 1) as 1 | 2 | 3 | 4 | 5);
    else void submit();
  };

  return (
    <>
      {/* Screen-reader live region — announces step progress without relying on colour */}
      <span role="status" className="sr-only">Step {sectionsDone} of 5 complete</span>
    <WizardShell
      currentStep={step}
      sectionsDone={sectionsDone}
      onBack={goBack}
      onContinue={goNext}
      continueEnabled={stepValid[step]}
      continueLabel={step === 5 ? 'Sign and submit' : 'Continue'}
      continueLoading={step === 5 && submitting}
    >
      {/* Screen-reader progress companion — paired with the visual bar in WizardShell */}
      <div role="status" aria-live="polite" className="sr-only">
        Step {sectionsDone} of 5 complete
      </div>
      {step === 1 && (
        <Step1WhoIsSigning
          plaintiffName={ctx.job.plaintiff_name}
          defendantName={ctx.job.defendant_name}
          addressLine={addressLine}
          serverName={ctx.server?.name ?? null}
          serverBadge={ctx.server?.badge ?? null}
          agency={ctx.agency}
          namedParty={namedParty}
          partyIsEntity={partyIsEntity}
          isNamedParty={isNamedParty}
          setIsNamedParty={setIsNamedParty}
          premisesType={premisesType}
          setPremisesType={setPremisesType}
          residesAtAddress={residesAtAddress}
          setResidesAtAddress={setResidesAtAddress}
          authorizedAgent={authorizedAgent}
          setAuthorizedAgent={setAuthorizedAgent}
          relationship={relationship}
          setRelationship={setRelationship}
          businessName={businessName}
          setBusinessName={setBusinessName}
          jobTitle={jobTitle}
          setJobTitle={setJobTitle}
          expectedDelivery={expectedDelivery}
          setExpectedDelivery={setExpectedDelivery}
        />
      )}

      {step === 2 && (
        <Step2Identity
          scanIdLabel="Scan ID barcode"
          recipientName={recipientName}
          setRecipientName={setRecipientName}
          idScanning={idScanning}
          idScanError={idScanError}
          idVerified={idVerified}
          idDescription={idDescription}
          idScanMethod={idScanMethod}
          idFrontImage={idFrontImage}
          idBackImage={idBackImage}
          manualFirstName={manualFirstName} setManualFirstName={setManualFirstName}
          manualLastName={manualLastName} setManualLastName={setManualLastName}
          manualMiddleName={manualMiddleName} setManualMiddleName={setManualMiddleName}
          manualDob={manualDob} setManualDob={setManualDob}
          manualDlNumber={manualDlNumber} setManualDlNumber={setManualDlNumber}
          manualDlState={manualDlState} setManualDlState={setManualDlState}
          manualGender={manualGender} setManualGender={setManualGender}
          manualHeight={manualHeight} setManualHeight={setManualHeight}
          manualWeight={manualWeight} setManualWeight={setManualWeight}
          manualEyeColor={manualEyeColor} setManualEyeColor={setManualEyeColor}
          manualHairColor={manualHairColor} setManualHairColor={setManualHairColor}
          hasServiceAddress={!!ctx.job.service_address}
          addressCurrent={addressCurrent}
          setAddressCurrent={setAddressCurrent}
          currentAddress={currentAddress} setCurrentAddress={setCurrentAddress}
          currentCity={currentCity} setCurrentCity={setCurrentCity}
          currentState={currentState} setCurrentState={setCurrentState}
          currentZip={currentZip} setCurrentZip={setCurrentZip}
          onScanId={scanId}
          onCapturePhoto={captureIdPhoto}
          onCompleteManual={completeManualId}
          activeCard={activeCard}
          setActiveCard={setActiveCard}
        />
      )}

      {step === 3 && (
        <Step3Documents
          docCopies={docCopies}
          setDocCopies={setDocCopies}
          documentType={ctx.job.document_type}
        />
      )}

      {step === 4 && (
        <Step4Statements
          attestations={attestations}
          formTitle={formTitle}
          allConfirmed={allConfirmed}
          setAllConfirmed={setAllConfirmed}
        />
      )}

      {step === 5 && (
        <Step5SignSubmit
          gpsStatus={gpsStatus}
          setGpsStatus={setGpsStatus}
          setCoords={setCoords}
          signature={signature}
          setSignature={setSignature}
          phone={phone}
          setPhone={setPhone}
          email={email}
          setEmail={setEmail}
          submitError={submitError}
        />
      )}
    </WizardShell>
    </>
  );
}
