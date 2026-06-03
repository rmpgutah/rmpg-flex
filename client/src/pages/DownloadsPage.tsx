import React, { useEffect, useState } from 'react';
import { Monitor, Apple, Smartphone, Download, ArrowLeft, ChevronRight } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

type Platform = 'win' | 'mac' | 'android';

interface InstallerMeta {
  filename: string;
  version: string;
  size: string;
  bytes: number;
  releaseDate?: string;
}

interface DownloadsInfo {
  mac?: InstallerMeta;
  win?: InstallerMeta;
  android?: InstallerMeta;
}

const PLATFORM_CONFIG: Record<Platform, {
  label: string;
  arch: string;
  icon: React.ElementType;
  ext: string;
  buttonLabel: string;
}> = {
  win: {
    label: 'Windows',
    arch: '64-bit (x64)',
    icon: Monitor,
    ext: '.zip',
    buttonLabel: 'Download .zip',
  },
  mac: {
    label: 'macOS',
    arch: 'Apple Silicon (M1/M2/M3/M4)',
    icon: Apple,
    ext: '.dmg',
    buttonLabel: 'Download .dmg',
  },
  android: {
    label: 'Android',
    arch: 'Android 8.0+ (ARM/x86)',
    icon: Smartphone,
    ext: '.zip',
    buttonLabel: 'Download .zip',
  },
};

function getRecommendedPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('android')) return 'android';
  if (ua.includes('mac')) return 'mac';
  return 'win';
}

export default function DownloadsPage() {
  const [info, setInfo] = useState<DownloadsInfo>({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Platform>(getRecommendedPlatform());
  const recommended = getRecommendedPlatform();

  useEffect(() => {
    apiFetch<DownloadsInfo>('/api/downloads/info')
      .then((data) => {
        setInfo(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  const platforms: Platform[] = ['win', 'mac', 'android'];

  const STEPS: Record<Platform, { title: string; steps: string[]; warning?: string }> = {
    win: {
      title: 'Windows',
      steps: [
        'Download the Windows .zip package using the button above.',
        'Right-click the downloaded .zip file and select "Extract All...".',
        'Open the extracted folder and double-click "RMPG Flex Setup 5.8.0.exe" to install.',
        'If Windows SmartScreen appears, click "More info" then "Run anyway" to finish.',
      ],
      warning: 'Windows SmartScreen note: Because Windows SmartScreen heavily flags raw executable files (.exe) downloaded directly, we bundle the installer in a .zip archive to bypass SmartScreen and browser security protocols automatically. If Windows Defender still prompts, simply select "More info" followed by "Run anyway".',
    },
    mac: {
      title: 'macOS',
      steps: [
        'Download the .dmg file using the button above.',
        'Open Terminal (Cmd+Space, type "Terminal") and run: xattr -d com.apple.quarantine ~/Downloads/RMPG\\ Flex-*.dmg',
        'Open the .dmg file and drag RMPG Flex into the Applications folder.',
        'Run: sudo xattr -cr /Applications/RMPG\\ Flex.app (enter your password)',
        'Right-click the app → Open → click Open. Future launches work normally.',
      ],
      warning: 'Getting "damaged and can\'t be opened"? Run both: xattr -d com.apple.quarantine ~/Downloads/RMPG\\ Flex-*.dmg and sudo xattr -cr /Applications/RMPG\\ Flex.app',
    },
    android: {
      title: 'Android',
      steps: [
        'Download the Android installation package .zip file above.',
        'Extract the zip package using your phone\'s Files/My Files manager app.',
        'Tap and open the extracted "RMPG Flex-5.8.0.apk" file.',
        'Enable "Install from Unknown Sources" for your browser/file explorer if prompted, then tap Install.',
      ],
      warning: 'Since this app is distributed internally rather than through the Google Play Store, Android requires bundling the app (.apk) inside a .zip to bypass browser protocol blocks. Safe Browsing will let you extract and run it seamlessly.',
    },
  };

  return (
    <div className="min-h-screen" style={{ background: '#0a0a0a' }}>
      {/* Header */}
      <div className="border-b" style={{ borderColor: '#222', background: '#0d0d0d' }}>
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-4">
          <img
            src="/rmpg flex.png"
            alt="RMPG Flex"
            className="w-10 h-10 rounded-full"
            style={{ objectFit: 'contain' }}
          />
          <div>
            <h1 className="text-sm font-bold uppercase tracking-wider text-white">RMPG Flex</h1>
            <span className="text-[10px] uppercase tracking-wider" style={{ color: '#666' }}>
              CAD / RMS Dispatch System
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-12">
        {/* Hero */}
        <div className="text-center mb-12">
          <div
            className="inline-block text-[11px] font-bold uppercase tracking-wider px-3 py-1 mb-4"
            style={{
              background: '#1a1a1a',
              border: '1px solid #333',
              color: '#d4a017',
              borderRadius: 2,
            }}
          >
            {loading ? 'Loading...' : info.win ? `v${info.win.version}` : info.mac ? `v${info.mac.version}` : 'v5.8.0'}
          </div>
          <h2 className="text-3xl font-bold text-white mb-3">Download RMPG Flex</h2>
          <p className="text-sm max-w-lg mx-auto leading-relaxed" style={{ color: '#888' }}>
            Install RMPG Flex on your computer or phone. The full CAD/RMS dispatch system — available as a
            desktop app, Android app, or in any web browser.
          </p>
        </div>

        {/* Download Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
          {platforms.map((p) => {
            const config = PLATFORM_CONFIG[p];
            const installer = info[p as keyof DownloadsInfo];
            const isRecommended = p === recommended && !!installer;
            const Icon = config.icon;

            return (
              <div
                key={p}
                className="relative flex flex-col items-center p-6 text-center transition-colors"
                style={{
                  background: '#141414',
                  border: isRecommended ? '1px solid #d4a017' : '1px solid #222',
                  borderRadius: 2,
                }}
              >
                {isRecommended && (
                  <span
                    className="absolute -top-3 left-1/2 -translate-x-1/2 text-[9px] font-bold uppercase tracking-wider px-3 py-0.5"
                    style={{
                      background: '#d4a017',
                      color: '#0a0a0a',
                      borderRadius: 2,
                    }}
                  >
                    Recommended
                  </span>
                )}

                <Icon className="w-10 h-10 mb-3" style={{ color: '#d4a017' }} />
                <h3 className="text-base font-bold text-white mb-1">{config.label}</h3>
                <span className="text-[11px] mb-3" style={{ color: '#666' }}>{config.arch}</span>

                {loading ? (
                  <span className="text-xs" style={{ color: '#555' }}>Loading...</span>
                ) : installer ? (
                  <>
                    <span className="text-[11px] mb-4" style={{ color: '#555' }}>
                      v{installer.version} — {installer.size}
                    </span>
                    <a
                      href={`/downloads/${encodeURIComponent(installer.filename)}`}
                      download={installer.filename}
                      className="inline-flex items-center gap-2 px-5 py-2 text-xs font-bold uppercase tracking-wider transition-colors"
                      style={{
                        background: 'linear-gradient(180deg, #1a1a1a 0%, #141414 100%)',
                        border: '1px solid #d4a017',
                        color: '#d4a017',
                        borderRadius: 2,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'linear-gradient(180deg, #242424 0%, #1a1a1a 100%)';
                        e.currentTarget.style.borderColor = '#e8b52a';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'linear-gradient(180deg, #1a1a1a 0%, #141414 100%)';
                        e.currentTarget.style.borderColor = '#d4a017';
                      }}
                    >
                      <Download className="w-3.5 h-3.5" />
                      {config.buttonLabel}
                    </a>
                  </>
                ) : (
                  <span className="text-xs mt-4" style={{ color: '#555' }}>Not available</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Web App Banner */}
        <div
          className="flex items-center justify-between gap-4 p-4 mb-8"
          style={{ background: '#111', border: '1px solid #222', borderRadius: 2 }}
        >
          <div>
            <h4 className="text-sm font-bold text-white mb-1">Use in Browser</h4>
            <p className="text-xs" style={{ color: '#666' }}>
              No download needed. Open the full RMPG Flex web app in any browser on any device.
            </p>
          </div>
          <a
            href="/"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors whitespace-nowrap"
            style={{
              background: '#1a1a1a',
              border: '1px solid #333',
              color: '#ccc',
              borderRadius: 2,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#242424'; e.currentTarget.style.borderColor = '#555'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#1a1a1a'; e.currentTarget.style.borderColor = '#333'; }}
          >
            Open Web App
            <ChevronRight className="w-3.5 h-3.5" />
          </a>
        </div>

        {/* Features */}
        <div
          className="p-5 mb-8"
          style={{ background: '#111', border: '1px solid #222', borderRadius: 2 }}
        >
          <h4 className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: '#d4a017' }}>
            What's Included
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            {[
              'Full CAD/RMS dispatch system',
              'Real-time WebSocket dispatch updates',
              'Mapbox GL JS + OpenLayers tactical map integration',
              'Incident, records, warrants, citations management',
              'Fleet management & patrol checkpoints',
              'Personnel, training & equipment tracking',
              'Reports, analytics & audit trail',
              'Automatic updates — always stay on the latest version',
            ].map((feature, i) => (
              <div key={i} className="flex items-center gap-2 text-xs" style={{ color: '#999' }}>
                <span style={{ color: '#4ade80' }}>&#10003;</span>
                {feature}
              </div>
            ))}
          </div>
        </div>

        {/* Installation Guide */}
        <div
          className="p-5 mb-8"
          style={{ background: '#111', border: '1px solid #222', borderRadius: 2 }}
        >
          <h4 className="text-[11px] font-bold uppercase tracking-wider mb-4" style={{ color: '#d4a017' }}>
            Installation Guide
          </h4>

          {/* Platform tabs */}
          <div className="flex border-b mb-4" style={{ borderColor: '#222' }}>
            {platforms.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setActiveTab(p)}
                className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider transition-colors"
                style={{
                  color: activeTab === p ? '#d4a017' : '#666',
                  borderBottom: activeTab === p ? '2px solid #d4a017' : '2px solid transparent',
                }}
              >
                {PLATFORM_CONFIG[p].label}
              </button>
            ))}
          </div>

          {/* Steps */}
          <div className="space-y-0">
            {STEPS[activeTab].steps.map((step, i) => (
              <div key={i} className="flex gap-3 py-2.5 border-b last:border-b-0" style={{ borderColor: '#1a1a1a' }}>
                <span
                  className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-[11px] font-bold"
                  style={{
                    background: '#1f1f1f',
                    color: '#d4a017',
                    borderRadius: 2,
                  }}
                >
                  {i + 1}
                </span>
                <span className="text-xs leading-relaxed" style={{ color: '#999' }}>
                  {step}
                </span>
              </div>
            ))}
            {STEPS[activeTab].warning && (
              <div
                className="mt-3 p-3 text-xs leading-relaxed"
                style={{
                  background: '#1a1700',
                  border: '1px solid #4a3f00',
                  color: '#f59e0b',
                  borderRadius: 2,
                }}
              >
                <strong style={{ color: '#fbbf24' }}>Note:</strong> {STEPS[activeTab].warning}
              </div>
            )}
          </div>
        </div>

        {/* System Requirements */}
        <div
          className="p-5"
          style={{ background: '#111', border: '1px solid #222', borderRadius: 2 }}
        >
          <h4 className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: '#666' }}>
            System Requirements
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="text-xs leading-relaxed" style={{ color: '#777' }}>
              <strong style={{ color: '#aaa' }}>Windows:</strong> Windows 10 or later<br />
              64-bit (x64) processor
            </div>
            <div className="text-xs leading-relaxed" style={{ color: '#777' }}>
              <strong style={{ color: '#aaa' }}>macOS:</strong> macOS 10.15 (Catalina) or later<br />
              Apple Silicon (M1/M2/M3/M4) or Intel
            </div>
            <div className="text-xs leading-relaxed" style={{ color: '#777' }}>
              <strong style={{ color: '#aaa' }}>Android:</strong> Android 8.0 (Oreo) or later<br />
              Any modern smartphone or tablet
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center py-8 text-[10px] tracking-wider" style={{ color: '#444' }}>
        <span id="footer-version">
          RMPG Flex v
          {loading ? '...' : info.win ? info.win.version : info.mac ? info.mac.version : '5.8.0'}
        </span>
        {' — '}Rocky Mountain Protective Group, LLC<br />
        <a href="/" className="no-underline" style={{ color: '#666' }}>Open Flex Web App</a>
      </div>
    </div>
  );
}
