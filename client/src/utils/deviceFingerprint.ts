export interface DeviceSignals {
  fingerprint: string;
  screen_resolution: string;
  color_depth: number;
  timezone: string;
  language: string;
  languages: string;
  platform: string;
  hardware_concurrency: number | null;
  device_memory: number | null;
  max_touch_points: number;
  timezone_offset: number;
}

export async function collectDeviceSignals(): Promise<DeviceSignals> {
  const raw = [
    navigator.userAgent,
    navigator.language,
    navigator.languages?.join(',') || '',
    screen.width + 'x' + screen.height,
    screen.colorDepth?.toString() || '',
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.hardwareConcurrency?.toString() || '',
    (navigator as any).deviceMemory?.toString() || '',
    navigator.maxTouchPoints?.toString() || '0',
    new Date().getTimezoneOffset().toString(),
  ].join('|');

  let fingerprint: string;
  try {
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    fingerprint = Array.from(new Uint8Array(buffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      hash = ((hash << 5) - hash) + raw.charCodeAt(i);
      hash |= 0;
    }
    fingerprint = Math.abs(hash).toString(16);
  }

  return {
    fingerprint,
    screen_resolution: `${screen.width}x${screen.height}`,
    color_depth: screen.colorDepth ?? 0,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
    languages: navigator.languages?.join(',') || navigator.language,
    platform: navigator.userAgent,
    hardware_concurrency: navigator.hardwareConcurrency ?? null,
    device_memory: (navigator as any).deviceMemory ?? null,
    max_touch_points: navigator.maxTouchPoints ?? 0,
    timezone_offset: new Date().getTimezoneOffset(),
  };
}
