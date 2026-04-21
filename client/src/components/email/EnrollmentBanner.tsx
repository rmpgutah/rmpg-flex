import { useState } from 'react';
import { apiFetch } from '../../hooks/useApi';

export default function EnrollmentBanner() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function connect() {
    setBusy(true); setError('');
    try {
      const r = await apiFetch<{ authorizationUrl: string }>('/api/email/oauth/authorize');
      window.location.href = r.authorizationUrl;
    } catch (err: any) {
      setError(err?.message || 'Failed to start OAuth');
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 space-y-4">
      <div className="text-2xl">📧</div>
      <div className="text-sm font-semibold text-[#d4a017]">CONNECT YOUR MICROSOFT 365 MAILBOX</div>
      <div className="text-xs text-gray-400 max-w-md text-center">
        To use email in RMPG Flex, you need to authorize access to your Microsoft 365 mailbox.
        Your email stays in Microsoft's servers — RMPG Flex only displays it.
      </div>
      <button
        onClick={connect}
        disabled={busy}
        className="px-4 py-2 border border-[#d4a017] text-[#d4a017] text-xs hover:bg-[#d4a017]/10 disabled:opacity-50"
      >
        {busy ? 'REDIRECTING...' : 'CONNECT MICROSOFT 365'}
      </button>
      {error && <div className="text-xs text-red-400">{error}</div>}
    </div>
  );
}
