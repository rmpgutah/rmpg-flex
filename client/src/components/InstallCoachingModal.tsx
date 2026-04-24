import { useState } from 'react';
import { useStandalone } from '../hooks/useStandalone';

const STORAGE_KEY = 'rmpg_install_dismissed_at';
const SUPPRESS_DAYS = 30;
const SUPPRESS_MS = SUPPRESS_DAYS * 24 * 60 * 60 * 1000;

export function InstallCoachingModal() {
  const { isStandalone, isIOS, isMobileViewport } = useStandalone();
  const [dismissed, setDismissed] = useState(() => {
    const at = Number(localStorage.getItem(STORAGE_KEY) ?? 0);
    return at > 0 && Date.now() - at < SUPPRESS_MS;
  });

  if (isStandalone || !isIOS || !isMobileViewport || dismissed) return null;

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
    setDismissed(true);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/60 safe-pb">
      <div className="w-full max-w-md bg-[#141414] border-t border-[#222] p-4 rounded-t-sm">
        <h2 className="text-[#d4a017] text-sm font-bold tracking-widest mb-2">
          INSTALL RMPG FLEX
        </h2>
        <p className="text-white text-sm mb-3">
          Install this app for full-screen access, faster launch, and offline maps.
        </p>
        <ol className="text-gray-300 text-xs space-y-1 mb-4 list-decimal list-inside">
          <li>Tap the Share icon at the bottom of Safari.</li>
          <li>Scroll and tap <span className="text-[#d4a017]">Add to Home Screen</span>.</li>
          <li>Tap <span className="text-[#d4a017]">Add</span> in the top-right.</li>
        </ol>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="w-full h-11 bg-[#1a1a1a] border border-[#222] text-gray-300 text-xs uppercase tracking-widest"
        >
          Not Now
        </button>
      </div>
    </div>
  );
}
