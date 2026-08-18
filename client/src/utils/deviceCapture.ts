// ============================================================
// deviceCapture.ts — full device + environment fingerprint bundle
//
// Extends DeviceSignals (deviceFingerprint.ts) with richer signals.
// Each capture is wrapped in its own try/catch — one failed API
// never blocks others. GPS is NOT captured here; it is a hard gate
// on Step 5 of the wizard and is handled separately there.
// ============================================================

import { collectDeviceSignals, type DeviceSignals } from './deviceFingerprint';

export interface DeviceCapture extends DeviceSignals {
  user_agent: string;
  network_type?: string;
  network_effective_type?: string;
  network_downlink?: number;
  network_rtt?: number;
  battery_level?: number;
  battery_charging?: boolean;
  webgl_renderer?: string;
  webgl_vendor?: string;
  canvas_fingerprint?: string;
  audio_fingerprint?: string;
  fonts_fingerprint?: string;
  page_visibility_hidden_count: number;
  page_visibility_hidden_ms: number;
  captured_at_ms: number;
}

// ── Page-visibility tracker (module-level, starts from import time) ──
let _hiddenCount = 0;
let _hiddenMs = 0;
let _hiddenSince: number | null = null;

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      _hiddenCount++;
      _hiddenSince = Date.now();
    } else if (_hiddenSince !== null) {
      _hiddenMs += Date.now() - _hiddenSince;
      _hiddenSince = null;
    }
  });
}

export async function collectDeviceCapture(): Promise<DeviceCapture> {
  const base = await collectDeviceSignals();

  const result: DeviceCapture = {
    ...base,
    user_agent: navigator.userAgent,
    page_visibility_hidden_count: _hiddenCount,
    page_visibility_hidden_ms:
      _hiddenMs + (_hiddenSince !== null ? Date.now() - _hiddenSince : 0),
    captured_at_ms: Date.now(),
  };

  // Network Information API
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conn = (navigator as any).connection
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      || (navigator as any).mozConnection
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      || (navigator as any).webkitConnection;
    if (conn) {
      result.network_type = conn.type;
      result.network_effective_type = conn.effectiveType;
      result.network_downlink = conn.downlink;
      result.network_rtt = conn.rtt;
    }
  } catch { /* best-effort */ }

  // Battery Status API
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const battery = await (navigator as any).getBattery?.();
    if (battery) {
      result.battery_level = battery.level;
      result.battery_charging = battery.charging;
    }
  } catch { /* best-effort */ }

  // WebGL renderer + vendor
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl')
      || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) {
        result.webgl_renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string;
        result.webgl_vendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) as string;
      }
    }
  } catch { /* best-effort */ }

  // Canvas fingerprint
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillStyle = '#f60';
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = '#069';
      ctx.fillText('RMPG AoS', 2, 15);
      ctx.fillStyle = 'rgba(102,204,0,0.7)';
      ctx.fillText('RMPG AoS', 4, 17);
      result.canvas_fingerprint = canvas.toDataURL().substring(0, 120);
    }
  } catch { /* best-effort */ }

  // Audio context fingerprint
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (AudioCtx) {
      const audioCtx = new AudioCtx();
      const oscillator = audioCtx.createOscillator();
      const analyser = audioCtx.createAnalyser();
      const gain = audioCtx.createGain();
      const scriptProcessor = audioCtx.createScriptProcessor(4096, 1, 1);
      gain.gain.value = 0;
      oscillator.type = 'triangle';
      oscillator.connect(analyser);
      analyser.connect(scriptProcessor);
      scriptProcessor.connect(gain);
      gain.connect(audioCtx.destination);
      oscillator.start(0);
      await new Promise<void>((resolve) => {
        scriptProcessor.onaudioprocess = (e) => {
          const data = e.inputBuffer.getChannelData(0);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += Math.abs(data[i]);
          result.audio_fingerprint = sum.toFixed(20);
          oscillator.disconnect();
          scriptProcessor.disconnect();
          analyser.disconnect();
          void audioCtx.close();
          resolve();
        };
      });
    }
  } catch { /* best-effort */ }

  // Installed font fingerprint via canvas probe
  try {
    const testFonts = [
      'Arial', 'Helvetica', 'Times New Roman', 'Courier New',
      'Georgia', 'Verdana', 'Comic Sans MS', 'Impact', 'Trebuchet MS',
    ];
    const testString = 'mmmmmmmmmmlli';
    const size = '72px';
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.font = `${size} monospace`;
      const base = ctx.measureText(testString).width;
      const present = testFonts.filter((font) => {
        ctx.font = `${size} '${font}', monospace`;
        return ctx.measureText(testString).width !== base;
      });
      result.fonts_fingerprint = present.join(',');
    }
  } catch { /* best-effort */ }

  return result;
}
