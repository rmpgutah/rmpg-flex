import React, { useState, useEffect, useCallback } from 'react';
import {
  X, MapPin, FileText, Camera, Send, CheckCircle, AlertTriangle,
  Loader2, Navigation, Trash2,
} from 'lucide-react';
import SignaturePad from '../SignaturePad';
import { apiFetch } from '../../hooks/useApi';
import type { ServeJob, ServeAttemptData } from '../../types';

// ─── Types ──────────────────────────────────────────────────────────────

interface ServeAttemptModalProps {
  isOpen: boolean;
  onClose: () => void;
  job: ServeJob;
  onSubmit: (attempt: ServeAttemptData) => Promise<{
    dueDiligenceComplete?: boolean;
    attemptNumber?: number;
    jobStatus?: string;
  }>;
  onGenerateAffidavit?: (jobId: number) => void;
}

interface GpsState {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  loading: boolean;
  error: string | null;
}

type AttemptType = 'personal' | 'substitute' | 'posting' | 'failed';
type FailedReason = 'no_answer' | 'refused' | 'wrong_address' | 'moved' | 'other';

const STEPS = ['Location', 'Type', 'Documentation', 'Submit'] as const;

const AGE_RANGES = ['Under 18', '18-25', '26-35', '36-45', '46-55', '56-65', 'Over 65'];
const HAIR_COLORS = ['Black', 'Brown', 'Blonde', 'Red', 'Gray', 'White', 'Bald', 'Other'];
const RELATIONSHIPS = ['Spouse', 'Roommate', 'Coworker', 'Family Member', 'Other'];

// ─── Haversine Distance ─────────────────────────────────────────────────

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Component ──────────────────────────────────────────────────────────

export default function ServeAttemptModal({
  isOpen,
  onClose,
  job,
  onSubmit,
  onGenerateAffidavit,
}: ServeAttemptModalProps) {
  const [step, setStep] = useState(0);

  // Step 1 — GPS
  const [gps, setGps] = useState<GpsState>({
    latitude: null, longitude: null, accuracy: null,
    loading: true, error: null,
  });

  // Step 2 — Type
  const [attemptType, setAttemptType] = useState<AttemptType | null>(null);
  const [failedReason, setFailedReason] = useState<FailedReason | null>(null);

  // Step 3 — Documentation
  const [photos, setPhotos] = useState<{ id: string; url: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [ageRange, setAgeRange] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [hairColor, setHairColor] = useState('');
  const [clothing, setClothing] = useState('');
  const [personServedName, setPersonServedName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [notes, setNotes] = useState('');

  // Step 4 — Signature & Submit
  const [signature, setSignature] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{
    dueDiligenceComplete?: boolean;
    attemptNumber?: number;
  } | null>(null);

  // ─── GPS Acquisition ────────────────────────────────────────────────

  const acquireGps = useCallback(() => {
    setGps({ latitude: null, longitude: null, accuracy: null, loading: true, error: null });
    if (!navigator.geolocation) {
      setGps(prev => ({ ...prev, loading: false, error: 'Geolocation not available' }));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
          loading: false,
          error: null,
        });
      },
      (err) => {
        setGps(prev => ({ ...prev, loading: false, error: err?.message || 'GPS error' }));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }, []);

  useEffect(() => {
    if (isOpen) {
      acquireGps();
      // Reset all state on open
      setStep(0);
      setAttemptType(null);
      setFailedReason(null);
      setPhotos([]);
      setAgeRange('');
      setHeight('');
      setWeight('');
      setHairColor('');
      setClothing('');
      setPersonServedName('');
      setRelationship('');
      setNotes('');
      setSignature(null);
      setSubmitting(false);
      setSubmitResult(null);
    }
  }, [isOpen, acquireGps]);

  // ─── Distance Warning ───────────────────────────────────────────────

  const distanceFromAddress = (() => {
    if (!gps.latitude || !gps.longitude || !job.recipient_lat || !job.recipient_lng) return null;
    return Math.round(haversineDistance(gps.latitude, gps.longitude, job.recipient_lat, job.recipient_lng));
  })();

  const showDistanceWarning = distanceFromAddress !== null && distanceFromAddress > 200;

  // ─── Photo Upload ──────────────────────────────────────────────────

  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const remaining = 5 - photos.length;
    const toUpload = Array.from(files).slice(0, remaining);
    if (toUpload.length === 0) return;

    setUploading(true);
    try {
      for (const file of toUpload) {
        const formData = new FormData();
        formData.append('file', file);
        const result = await apiFetch<{ id: string; url: string }>('/uploads', {
          method: 'POST',
          body: formData,
        });
        setPhotos(prev => [...prev, { id: result.id, url: result.url }]);
      }
    } catch {
      // upload failed silently — user can retry
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const removePhoto = (id: string) => {
    setPhotos(prev => prev.filter(p => p.id !== id));
  };

  // ─── Build Description String ──────────────────────────────────────

  const buildDescription = (): string => {
    const parts: string[] = [];
    if (ageRange) parts.push(`Age: ${ageRange}`);
    if (height) parts.push(`Height: ${height}`);
    if (weight) parts.push(`Weight: ${weight}`);
    if (hairColor) parts.push(`Hair: ${hairColor}`);
    if (clothing) parts.push(`Clothing: ${clothing}`);
    return parts.join(', ');
  };

  // ─── Submit ────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!attemptType) return;
    setSubmitting(true);
    try {
      const data: ServeAttemptData = {
        attempt_type: attemptType,
        result: attemptType === 'failed'
          ? (failedReason || 'other')
          : 'served',
        latitude: gps.latitude ?? undefined,
        longitude: gps.longitude ?? undefined,
        gps_accuracy: gps.accuracy ?? undefined,
        address_verified: !showDistanceWarning,
        photo_ids: photos.map(p => p.id),
        signature_data: signature ?? undefined,
        notes: notes || undefined,
      };

      if (attemptType === 'personal' || attemptType === 'substitute') {
        data.person_served_description = buildDescription() || undefined;
      }
      if (attemptType === 'substitute') {
        data.person_served_name = personServedName || undefined;
        data.person_served_relationship = relationship || undefined;
      }

      const result = await onSubmit(data);
      setSubmitResult(result);
    } catch {
      // error handled by parent
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  // ─── Step Indicator ────────────────────────────────────────────────

  const StepIndicator = () => (
    <div className="flex items-center justify-center gap-0 py-3 px-4">
      {STEPS.map((label, i) => (
        <React.Fragment key={label}>
          {i > 0 && (
            <div className={`h-0.5 w-8 sm:w-12 ${i <= step ? 'bg-green-500' : 'bg-rmpg-600'}`} />
          )}
          <div className="flex flex-col items-center gap-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
              i < step
                ? 'bg-green-600 border-green-500 text-white'
                : i === step
                  ? 'bg-brand-700 border-brand-500 text-white'
                  : 'bg-rmpg-700 border-rmpg-500 text-rmpg-400'
            }`}>
              {i < step ? <CheckCircle className="w-4 h-4" /> : i + 1}
            </div>
            <span className={`text-[10px] font-semibold ${
              i <= step ? 'text-rmpg-200' : 'text-rmpg-500'
            }`}>{label}</span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );

  // ─── Attempt Type Cards ────────────────────────────────────────────

  const typeCards: {
    type: AttemptType;
    icon: React.ReactNode;
    label: string;
    desc: string;
    disabled?: boolean;
    tooltip?: string;
  }[] = [
    { type: 'personal', icon: <Send className="w-5 h-5" />, label: 'Personal Service', desc: 'Handed directly to the named person' },
    { type: 'substitute', icon: <FileText className="w-5 h-5" />, label: 'Substitute Service', desc: 'Left with another person at the address' },
    {
      type: 'posting',
      icon: <MapPin className="w-5 h-5" />,
      label: 'Posting',
      desc: 'Affixed to door/premises',
      disabled: job.attempt_count < 2,
      tooltip: job.attempt_count < 2 ? 'Requires 2+ prior failed attempts' : undefined,
    },
    { type: 'failed', icon: <X className="w-5 h-5" />, label: 'Failed Attempt', desc: 'Unable to complete service' },
  ];

  // ─── Render Steps ──────────────────────────────────────────────────

  const renderStep = () => {
    switch (step) {
      // ─── Step 1: Location ──────────────────────────────────
      case 0:
        return (
          <div className="space-y-4 p-4">
            <h3 className="text-sm font-bold text-rmpg-200 flex items-center gap-2">
              <Navigation className="w-4 h-4 text-brand-400" />
              Arrival Confirmation
            </h3>

            {gps.loading ? (
              <div className="flex flex-col items-center gap-3 py-8 text-rmpg-400">
                <Loader2 className="w-8 h-8 animate-spin text-brand-400" />
                <span className="text-sm">Acquiring GPS position...</span>
              </div>
            ) : gps.error ? (
              <div className="bg-red-900/30 border border-red-700 rounded-sm p-3 text-sm text-red-300">
                <p>GPS Error: {gps.error}</p>
                <button
                  onClick={acquireGps}
                  className="mt-2 px-3 py-1 text-xs bg-red-800 hover:bg-red-700 text-red-200 rounded-sm"
                >
                  Retry
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-rmpg-800 border border-rmpg-600 rounded-sm p-2">
                    <div className="text-[10px] text-rmpg-400 uppercase font-semibold">Latitude</div>
                    <div className="text-sm text-rmpg-100 font-mono">{gps.latitude?.toFixed(6)}</div>
                  </div>
                  <div className="bg-rmpg-800 border border-rmpg-600 rounded-sm p-2">
                    <div className="text-[10px] text-rmpg-400 uppercase font-semibold">Longitude</div>
                    <div className="text-sm text-rmpg-100 font-mono">{gps.longitude?.toFixed(6)}</div>
                  </div>
                  <div className="bg-rmpg-800 border border-rmpg-600 rounded-sm p-2">
                    <div className="text-[10px] text-rmpg-400 uppercase font-semibold">Accuracy</div>
                    <div className="text-sm text-rmpg-100 font-mono">{gps.accuracy}m</div>
                  </div>
                </div>

                {showDistanceWarning && (
                  <div className="bg-yellow-900/30 border border-yellow-700 rounded-sm p-3 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                    <span className="text-sm text-yellow-300">
                      You appear to be {distanceFromAddress}m from the service address
                    </span>
                  </div>
                )}

                {distanceFromAddress !== null && !showDistanceWarning && (
                  <div className="bg-green-900/20 border border-green-800 rounded-sm p-3 flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                    <span className="text-sm text-green-300">
                      Location verified ({distanceFromAddress}m from service address)
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setStep(1)}
                disabled={gps.loading}
                className="px-4 py-2 text-sm font-semibold bg-brand-700 hover:bg-brand-600 text-white rounded-sm disabled:opacity-40 transition-colors"
              >
                Confirm Location
              </button>
            </div>
          </div>
        );

      // ─── Step 2: Type ──────────────────────────────────────
      case 1:
        return (
          <div className="space-y-4 p-4">
            <h3 className="text-sm font-bold text-rmpg-200">Select Attempt Type</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {typeCards.map((card) => (
                <div key={card.type} className="relative group">
                  <button
                    disabled={card.disabled}
                    onClick={() => {
                      setAttemptType(card.type);
                      if (card.type !== 'failed') setFailedReason(null);
                    }}
                    className={`w-full text-left p-3 rounded-sm border-2 transition-colors ${
                      card.disabled
                        ? 'opacity-40 cursor-not-allowed border-rmpg-700 bg-rmpg-800'
                        : attemptType === card.type
                          ? 'border-brand-500 bg-brand-900/30'
                          : 'border-rmpg-600 bg-rmpg-800 hover:border-rmpg-400'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className={attemptType === card.type ? 'text-brand-400' : 'text-rmpg-400'}>
                        {card.icon}
                      </span>
                      <span className="text-sm font-semibold text-rmpg-100">{card.label}</span>
                    </div>
                    <p className="text-xs text-rmpg-400">{card.desc}</p>
                  </button>
                  {card.tooltip && (
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:block bg-rmpg-900 text-rmpg-300 text-[10px] px-2 py-1 rounded-sm border border-rmpg-600 whitespace-nowrap z-10">
                      {card.tooltip}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {attemptType === 'failed' && (
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-rmpg-300 uppercase">Reason</label>
                <select
                  value={failedReason || ''}
                  onChange={(e) => setFailedReason(e.target.value as FailedReason)}
                  className="w-full bg-rmpg-800 border border-rmpg-600 rounded-sm px-3 py-2 text-sm text-rmpg-100 focus:outline-none focus:border-brand-500"
                >
                  <option value="">Select reason...</option>
                  <option value="no_answer">No Answer</option>
                  <option value="refused">Refused</option>
                  <option value="wrong_address">Wrong Address</option>
                  <option value="moved">Moved</option>
                  <option value="other">Other</option>
                </select>
              </div>
            )}

            <div className="flex justify-between pt-2">
              <button
                onClick={() => setStep(0)}
                className="px-4 py-2 text-sm font-semibold bg-rmpg-700 hover:bg-rmpg-600 text-rmpg-200 rounded-sm transition-colors"
              >
                Back
              </button>
              <button
                onClick={() => setStep(2)}
                disabled={!attemptType || (attemptType === 'failed' && !failedReason)}
                className="px-4 py-2 text-sm font-semibold bg-brand-700 hover:bg-brand-600 text-white rounded-sm disabled:opacity-40 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        );

      // ─── Step 3: Documentation ─────────────────────────────
      case 2:
        return (
          <div className="space-y-4 p-4 max-h-[60vh] overflow-y-auto">
            <h3 className="text-sm font-bold text-rmpg-200">Documentation</h3>

            {/* Camera input */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-rmpg-300 uppercase">Photos ({photos.length}/5)</label>
              <label className={`flex items-center justify-center gap-2 px-4 py-3 rounded-sm border-2 border-dashed cursor-pointer transition-colors ${
                photos.length >= 5
                  ? 'border-rmpg-700 text-rmpg-600 cursor-not-allowed'
                  : 'border-rmpg-500 text-rmpg-300 hover:border-brand-500 hover:text-brand-300'
              }`}>
                {uploading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Camera className="w-5 h-5" />
                )}
                <span className="text-sm font-semibold">
                  {uploading ? 'Uploading...' : 'Take Photo'}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  disabled={photos.length >= 5 || uploading}
                  onChange={handlePhotoCapture}
                  className="hidden"
                />
              </label>

              {photos.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {photos.map((photo) => (
                    <div key={photo.id} className="relative w-16 h-16 rounded-sm border border-rmpg-600 overflow-hidden group">
                      <img src={photo.url} alt="Attempt photo" className="w-full h-full object-cover" />
                      <button
                        onClick={() => removePhoto(photo.id)}
                        className="absolute top-0.5 right-0.5 w-4 h-4 bg-red-700 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-2.5 h-2.5 text-white" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Physical description for personal/substitute */}
            {(attemptType === 'personal' || attemptType === 'substitute') && (
              <fieldset className="space-y-3 border border-rmpg-600 rounded-sm p-3">
                <legend className="text-xs font-semibold text-rmpg-300 uppercase px-1">Physical Description</legend>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-rmpg-400 uppercase mb-0.5">Age Range</label>
                    <select
                      value={ageRange}
                      onChange={(e) => setAgeRange(e.target.value)}
                      className="w-full bg-rmpg-800 border border-rmpg-600 rounded-sm px-2 py-1.5 text-sm text-rmpg-100 focus:outline-none focus:border-brand-500"
                    >
                      <option value="">Select...</option>
                      {AGE_RANGES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-rmpg-400 uppercase mb-0.5">Hair Color</label>
                    <select
                      value={hairColor}
                      onChange={(e) => setHairColor(e.target.value)}
                      className="w-full bg-rmpg-800 border border-rmpg-600 rounded-sm px-2 py-1.5 text-sm text-rmpg-100 focus:outline-none focus:border-brand-500"
                    >
                      <option value="">Select...</option>
                      {HAIR_COLORS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-rmpg-400 uppercase mb-0.5">Height</label>
                    <input
                      type="text"
                      value={height}
                      onChange={(e) => setHeight(e.target.value)}
                      placeholder="e.g., 5'10"
                      className="w-full bg-rmpg-800 border border-rmpg-600 rounded-sm px-2 py-1.5 text-sm text-rmpg-100 focus:outline-none focus:border-brand-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-rmpg-400 uppercase mb-0.5">Weight</label>
                    <input
                      type="text"
                      value={weight}
                      onChange={(e) => setWeight(e.target.value)}
                      placeholder="e.g., 180 lbs"
                      className="w-full bg-rmpg-800 border border-rmpg-600 rounded-sm px-2 py-1.5 text-sm text-rmpg-100 focus:outline-none focus:border-brand-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] text-rmpg-400 uppercase mb-0.5">Clothing Description</label>
                  <input
                    type="text"
                    value={clothing}
                    onChange={(e) => setClothing(e.target.value)}
                    placeholder="Describe clothing worn"
                    className="w-full bg-rmpg-800 border border-rmpg-600 rounded-sm px-2 py-1.5 text-sm text-rmpg-100 focus:outline-none focus:border-brand-500"
                  />
                </div>
              </fieldset>
            )}

            {/* Substitute-only fields */}
            {attemptType === 'substitute' && (
              <fieldset className="space-y-3 border border-rmpg-600 rounded-sm p-3">
                <legend className="text-xs font-semibold text-rmpg-300 uppercase px-1">Person Served</legend>
                <div>
                  <label className="block text-[10px] text-rmpg-400 uppercase mb-0.5">
                    Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={personServedName}
                    onChange={(e) => setPersonServedName(e.target.value)}
                    placeholder="Full name of person served"
                    className="w-full bg-rmpg-800 border border-rmpg-600 rounded-sm px-2 py-1.5 text-sm text-rmpg-100 focus:outline-none focus:border-brand-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-rmpg-400 uppercase mb-0.5">Relationship</label>
                  <select
                    value={relationship}
                    onChange={(e) => setRelationship(e.target.value)}
                    className="w-full bg-rmpg-800 border border-rmpg-600 rounded-sm px-2 py-1.5 text-sm text-rmpg-100 focus:outline-none focus:border-brand-500"
                  >
                    <option value="">Select...</option>
                    {RELATIONSHIPS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </fieldset>
            )}

            {/* Notes */}
            <div>
              <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Observations about the location, people present, etc."
                rows={3}
                className="w-full bg-rmpg-800 border border-rmpg-600 rounded-sm px-3 py-2 text-sm text-rmpg-100 focus:outline-none focus:border-brand-500 resize-none"
              />
            </div>

            <div className="flex justify-between pt-2">
              <button
                onClick={() => setStep(1)}
                className="px-4 py-2 text-sm font-semibold bg-rmpg-700 hover:bg-rmpg-600 text-rmpg-200 rounded-sm transition-colors"
              >
                Back
              </button>
              <button
                onClick={() => setStep(3)}
                disabled={attemptType === 'substitute' && !personServedName.trim()}
                className="px-4 py-2 text-sm font-semibold bg-brand-700 hover:bg-brand-600 text-white rounded-sm disabled:opacity-40 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        );

      // ─── Step 4: Review & Signature ────────────────────────
      case 3:
        return (
          <div className="space-y-4 p-4 max-h-[60vh] overflow-y-auto">
            {submitResult ? (
              // Post-submit result
              <div className="space-y-4 text-center py-4">
                <CheckCircle className="w-12 h-12 text-green-400 mx-auto" />
                <h3 className="text-sm font-bold text-rmpg-100">
                  Attempt #{submitResult.attemptNumber} Recorded
                </h3>
                {submitResult.dueDiligenceComplete && (
                  <div className="bg-green-900/30 border border-green-700 rounded-sm p-3 space-y-2">
                    <p className="text-sm text-green-300 font-semibold">
                      Due Diligence Complete -- 3 attempts recorded
                    </p>
                    {onGenerateAffidavit && (
                      <button
                        onClick={() => onGenerateAffidavit(job.id)}
                        className="px-4 py-2 text-sm font-semibold bg-green-700 hover:bg-green-600 text-white rounded-sm transition-colors"
                      >
                        Generate Affidavit of Non-Service
                      </button>
                    )}
                  </div>
                )}
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-semibold bg-rmpg-700 hover:bg-rmpg-600 text-rmpg-200 rounded-sm transition-colors"
                >
                  Close
                </button>
              </div>
            ) : (
              <>
                <h3 className="text-sm font-bold text-rmpg-200">Review & Submit</h3>

                {/* Summary card */}
                <div className="bg-rmpg-800 border border-rmpg-600 rounded-sm p-3 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-rmpg-400">Recipient</span>
                    <span className="text-rmpg-100 font-semibold">{job.recipient_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-rmpg-400">Type</span>
                    <span className="text-rmpg-100 capitalize">{attemptType?.replace('_', ' ')}</span>
                  </div>
                  {attemptType === 'failed' && failedReason && (
                    <div className="flex justify-between">
                      <span className="text-rmpg-400">Reason</span>
                      <span className="text-rmpg-100 capitalize">{failedReason.replace('_', ' ')}</span>
                    </div>
                  )}
                  {gps.latitude != null && (
                    <div className="flex justify-between">
                      <span className="text-rmpg-400">GPS</span>
                      <span className="text-rmpg-100 font-mono text-xs">
                        {gps.latitude?.toFixed(6)}, {gps.longitude?.toFixed(6)} ({gps.accuracy}m)
                      </span>
                    </div>
                  )}
                  {distanceFromAddress !== null && (
                    <div className="flex justify-between">
                      <span className="text-rmpg-400">Distance</span>
                      <span className={`font-semibold ${showDistanceWarning ? 'text-yellow-400' : 'text-green-400'}`}>
                        {distanceFromAddress}m from address
                      </span>
                    </div>
                  )}
                  {photos.length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-rmpg-400">Photos</span>
                      <span className="text-rmpg-100">{photos.length} attached</span>
                    </div>
                  )}
                  {attemptType === 'substitute' && personServedName && (
                    <div className="flex justify-between">
                      <span className="text-rmpg-400">Served to</span>
                      <span className="text-rmpg-100">{personServedName}{relationship ? ` (${relationship})` : ''}</span>
                    </div>
                  )}
                  {buildDescription() && (
                    <div className="flex justify-between">
                      <span className="text-rmpg-400">Description</span>
                      <span className="text-rmpg-100 text-xs text-right max-w-[60%]">{buildDescription()}</span>
                    </div>
                  )}
                  {notes && (
                    <div>
                      <span className="text-rmpg-400 text-xs">Notes:</span>
                      <p className="text-rmpg-200 text-xs mt-0.5">{notes}</p>
                    </div>
                  )}
                </div>

                {/* Signature */}
                <SignaturePad
                  value={signature}
                  onChange={setSignature}
                  width={300}
                  height={150}
                  label="Officer Signature"
                />

                <div className="flex justify-between pt-2">
                  <button
                    onClick={() => setStep(2)}
                    className="px-4 py-2 text-sm font-semibold bg-rmpg-700 hover:bg-rmpg-600 text-rmpg-200 rounded-sm transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="px-4 py-2 text-sm font-semibold bg-green-700 hover:bg-green-600 text-white rounded-sm disabled:opacity-40 transition-colors flex items-center gap-2"
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Submit Attempt
                  </button>
                </div>
              </>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  // ─── Modal Shell ───────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#141e2b] panel-beveled rounded-sm w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-600">
          <h2 className="text-sm font-bold text-rmpg-100">
            Document Service Attempt — {job.recipient_name}
          </h2>
          <button
            onClick={onClose}
            className="text-rmpg-400 hover:text-rmpg-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step indicator */}
        <StepIndicator />

        {/* Step content */}
        <div className="flex-1 overflow-hidden">
          {renderStep()}
        </div>
      </div>
    </div>
  );
}
