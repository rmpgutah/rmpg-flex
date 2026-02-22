import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.rmpg.flex',
  appName: 'RMPG Flex',
  webDir: 'dist',
  server: {
    // Connect to the live production server
    // The Android app is a lightweight shell that loads the web UI from the server
    url: 'http://194.113.64.90',
    cleartext: true, // Allow HTTP fallback during development
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#0a0e14',
      showSpinner: true,
      spinnerColor: '#bc1010',
      androidSpinnerStyle: 'small',
    },
    StatusBar: {
      style: 'DARK' as any,
      backgroundColor: '#0a0e14',
    },
  },
  android: {
    backgroundColor: '#0a0e14',
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    // Allow geolocation in the WebView (critical for GPS tracking)
    appendUserAgent: 'RMPGFlex/Android',
  },
};

export default config;
