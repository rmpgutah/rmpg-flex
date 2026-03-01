import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.rmpg.flex',
  appName: 'RMPG Flex',
  webDir: 'dist',
  server: {
    // Connect to the live production server over HTTPS
    // The Android app is a lightweight shell that loads the web UI from the server
    url: 'https://rmpgutah.us',
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
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    // Allow geolocation in the WebView (critical for GPS tracking)
    appendUserAgent: 'RMPGFlex/Android',
  },
  ios: {
    backgroundColor: '#0a0e14',
    contentInset: 'always',
    allowsLinkPreview: false,
    appendUserAgent: 'RMPGFlex/iOS',
    preferredContentMode: 'mobile',
  },
};

export default config;
