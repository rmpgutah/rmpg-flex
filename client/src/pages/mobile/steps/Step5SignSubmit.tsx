// Step 5 — Sign & Submit
//
// GPS hard gate: on mount, requests location. If denied, shows a full-screen
// block — there is no way past it. If granted, shows the signature pad,
// phone field, email field, and a "Sign and submit" button.

import { useEffect } from 'react';
import { MapPin, AlertTriangle } from 'lucide-react';
import SignaturePad from '../../../components/SignaturePad';
import { formatPhoneInput } from '../../../utils/formatters';

export type GpsStatus = 'pending' | 'granted' | 'denied';

export interface Step5Props {
  gpsStatus: GpsStatus;
  setGpsStatus: (v: GpsStatus) => void;
  setCoords: (v: { lat: number; lng: number; acc: number }) => void;

  signature: string | null;
  setSignature: (v: string | null) => void;

  phone: string;
  setPhone: (v: string) => void;

  email: string;
  setEmail: (v: string) => void;

  submitError: string | null;
}

const inputCls =
  'w-full bg-white border border-gray-600 rounded-sm px-3 py-2.5 ' +
  'text-[15px] text-white placeholder:text-gray-500 focus:outline-none ' +
  'focus:border-blue-400';

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="block text-[12px] font-medium text-gray-500 uppercase tracking-wider mb-1">
      {children}
      {required && <span className="text-red-500 ml-0.5">*</span>}
    </span>
  );
}

export default function Step5SignSubmit({
  gpsStatus, setGpsStatus, setCoords,
  signature, setSignature,
  phone, setPhone,
  email, setEmail,
  submitError,
}: Step5Props) {
  // Request GPS on mount. Best-effort high accuracy with a reasonable timeout.
  useEffect(() => {
    if (!navigator.geolocation) { setGpsStatus('denied'); return; }
    if (gpsStatus !== 'pending') return;

    navigator.geolocation.getCurrentPosition(
      (p) => {
        setCoords({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy });
        setGpsStatus('granted');
      },
      () => setGpsStatus('denied'),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── GPS denied — full-screen hard block ──────────────────────────────
  if (gpsStatus === 'denied') {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-sm w-full text-center space-y-4">
          <div className="mx-auto w-14 h-14 rounded-sm bg-amber-900 border border-amber-700 flex items-center justify-center">
            <MapPin size={26} className="text-amber-400" />
          </div>
          <h3 className="text-lg font-bold text-white">Location access required</h3>
          <p className="text-[15px] text-gray-300 leading-relaxed">
            Location access is required to complete this form online. Please allow
            location access in your browser settings, or ask the process server for
            the paper form.
          </p>
          <button
            type="button"
            onClick={() => {
              setGpsStatus('pending');
              navigator.geolocation?.getCurrentPosition(
                (p) => {
                  setCoords({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy });
                  setGpsStatus('granted');
                },
                () => setGpsStatus('denied'),
                { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
              );
            }}
            className="w-full py-3 rounded-sm border border-gray-500 text-[14px] text-gray-300 font-medium active:opacity-60"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  // ── GPS pending ───────────────────────────────────────────────────────
  if (gpsStatus === 'pending') {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <MapPin size={28} className="mx-auto text-blue-400 animate-pulse" />
          <p className="text-[15px] text-gray-400">Requesting location…</p>
          <p className="text-[13px] text-gray-500">
            Please allow location access when your browser asks.
          </p>
        </div>
      </div>
    );
  }

  // ── GPS granted — show the form ───────────────────────────────────────
  return (
    <div className="p-4 pb-6 max-w-lg mx-auto space-y-5">
      <div className="flex items-center gap-2">
        <MapPin size={15} className="text-green-400 shrink-0" />
        <p className="text-[13px] text-green-400">Location recorded</p>
      </div>

      <div>
        <h2 className="text-xl font-bold text-white mb-1">Sign &amp; Submit</h2>
        <p className="text-[14px] text-gray-400 leading-relaxed">
          Draw your signature below, then fill in your contact details.
        </p>
      </div>

      {/* Signature pad — explicit white background so ink is visible */}
      <div>
        <FieldLabel required>Sign here</FieldLabel>
        <div
          className="border-2 border-gray-500 rounded-sm overflow-hidden"
          style={{ backgroundColor: '#ffffff' }}
        >
          <SignaturePad
            value={signature}
            onChange={setSignature}
            label="Sign here"
            width={340}
            height={160}
          />
        </div>
        {signature && (
          <button
            type="button"
            onClick={() => setSignature(null)}
            className="mt-1 text-[12px] text-gray-400 active:opacity-60"
          >
            Clear signature
          </button>
        )}
      </div>

      {/* Phone */}
      <div>
        <FieldLabel required>Phone number</FieldLabel>
        <input
          className={inputCls}
          value={phone}
          onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
          inputMode="tel"
          autoComplete="tel"
          placeholder="(801) 555-0100"
        />
      </div>

      {/* Email */}
      <div>
        <FieldLabel required>Email address</FieldLabel>
        <input
          className={inputCls}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
        />
        <p className="mt-1 text-[11px] text-gray-400 leading-snug">
          Your phone and email are required. They are recorded with this acknowledgement
          and your copy is sent to the address you give.
        </p>
      </div>

      {/* Submit error */}
      {submitError && (
        <div className="p-3 rounded-sm border border-red-800 bg-red-900 flex gap-2">
          <AlertTriangle size={15} className="text-red-400 shrink-0 mt-0.5" />
          <p className="text-[13px] text-red-300 leading-snug">{submitError}</p>
        </div>
      )}

      {/* Privacy notice */}
      <p className="text-[12px] text-gray-400 leading-relaxed">
        Your signature, the date and time, and your device's approximate location are
        recorded with this form.
      </p>
    </div>
  );
}
