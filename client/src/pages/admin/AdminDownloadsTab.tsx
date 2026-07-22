import React, { useEffect, useState } from 'react';
import { Monitor, Apple, Smartphone, Download, ExternalLink, HardDrive } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

type Platform = 'win' | 'mac' | 'android' | 'os';

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
  os?: InstallerMeta;
}

const PLATFORM_CONFIG: Record<Platform, { label: string; icon: React.ElementType }> = {
  win: { label: 'Windows', icon: Monitor },
  mac: { label: 'macOS', icon: Apple },
  android: { label: 'Android', icon: Smartphone },
  os: { label: 'Kiosk Linux OS', icon: HardDrive },
};

const PLATFORMS: Platform[] = ['win', 'mac', 'android', 'os'];

export default function AdminDownloadsTab() {
  const [info, setInfo] = useState<DownloadsInfo>({});
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    apiFetch<DownloadsInfo>('/api/downloads/info')
      .then((data) => {
        setInfo(data);
        setLoading(false);
      })
      .catch(() => {
        setFetchError(true);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="p-4 text-xs uppercase tracking-wider" style={{ color: 'var(--rmpg-500)' }}>
        Loading download info…
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="p-4 text-xs" style={{ color: 'var(--sev-critical, var(--rmpg-400))' }}>
        Could not load download info — check your connection and refresh.
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {PLATFORMS.map((p) => {
          const installer = info[p];
          const { label, icon: Icon } = PLATFORM_CONFIG[p];
          return (
            <div
              key={p}
              className="flex flex-col items-start p-3 gap-2"
              style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 2 }}
            >
              <div className="flex items-center gap-2">
                <Icon className="w-4 h-4" style={{ color: 'var(--brand-gold)' }} />
                <span className="text-xs font-bold uppercase tracking-wider text-rmpg-100">{label}</span>
              </div>
              {installer ? (
                <>
                  <span className="text-[11px]" style={{ color: 'var(--rmpg-500)' }}>
                    v{installer.version} — {installer.size}
                  </span>
                  <a
                    href={`/downloads/${encodeURIComponent(installer.filename)}`}
                    download={installer.filename}
                    aria-label={label}
                    className="inline-flex items-center gap-1.5 px-3 py-1 text-[11px] font-bold uppercase tracking-wider"
                    style={{ border: '1px solid var(--brand-gold)', color: 'var(--brand-gold)', borderRadius: 2 }}
                  >
                    <Download className="w-3 h-3" />
                    Download
                  </a>
                </>
              ) : (
                <span className="text-[11px]" style={{ color: 'var(--rmpg-500)' }}>Not available</span>
              )}
            </div>
          );
        })}
      </div>

      <a
        href="/downloads"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider"
        style={{ color: 'var(--rmpg-400)' }}
      >
        Open full Downloads page
        <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  );
}
