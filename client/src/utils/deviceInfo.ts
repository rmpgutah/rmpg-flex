import { useEffect, useState } from 'react';

export interface DeviceInfo {
  browser: string;
  os: string;
  deviceType: string;
  /** Physical screen size, e.g. "2056×1329". Effectively constant. */
  screen: string;
  /** Current window size, e.g. "1235×727". Changes on every resize. */
  viewport: string;
  touchEnabled: boolean;
  online: boolean;
}

/**
 * Sample the current device/browser environment.
 *
 * `viewport` and `online` are live values — read them at the moment you need
 * them, never cache them for the lifetime of a component. Prefer
 * `useDeviceInfo()`, which keeps them current.
 */
export function getDeviceInfo(): DeviceInfo {
  const ua = navigator.userAgent;
  let browser = 'Unknown';
  if (ua.includes('Electron')) browser = 'RMPG Desktop';
  else if (ua.includes('Edg/')) browser = 'Edge';
  else if (ua.includes('Chrome/') && !ua.includes('Edg/')) browser = 'Chrome';
  else if (ua.includes('Firefox/')) browser = 'Firefox';
  else if (ua.includes('Safari/') && !ua.includes('Chrome')) browser = 'Safari';

  let os = 'Unknown';
  if (ua.includes('Windows NT 10')) os = 'Windows 10/11';
  else if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac OS X')) os = 'macOS';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
  else if (ua.includes('Linux')) os = 'Linux';

  let deviceType = 'Desktop';
  if (/Mobi|Android/i.test(ua)) deviceType = 'Mobile';
  else if (/Tablet|iPad/i.test(ua)) deviceType = 'Tablet';

  return {
    browser,
    os,
    deviceType,
    screen: `${window.screen.width}×${window.screen.height}`,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    touchEnabled: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
    online: navigator.onLine,
  };
}

/**
 * Device info that stays current.
 *
 * A mount-time snapshot goes stale in two ways that matter operationally:
 *   - `viewport` reads 0×0 when the window is sized after mount (Electron,
 *     restored windows), and never corrects.
 *   - `online` keeps reporting "Online" after a patrol Toughbook drops its
 *     connection — actively misleading on a login screen.
 */
export function useDeviceInfo(): DeviceInfo {
  const [device, setDevice] = useState<DeviceInfo>(getDeviceInfo);

  useEffect(() => {
    const resample = () => setDevice(getDeviceInfo());
    window.addEventListener('resize', resample);
    window.addEventListener('online', resample);
    window.addEventListener('offline', resample);
    return () => {
      window.removeEventListener('resize', resample);
      window.removeEventListener('online', resample);
      window.removeEventListener('offline', resample);
    };
  }, []);

  return device;
}
