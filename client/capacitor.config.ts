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
      backgroundColor: '#000000',
      showSpinner: true,
      spinnerColor: '#9ca4ad',
      androidSpinnerStyle: 'small',
    },
    StatusBar: {
      style: 'LIGHT' as any,
      backgroundColor: '#000000',
    },
  },
  android: {
    backgroundColor: '#000000',
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    // Allow geolocation in the WebView (critical for GPS tracking)
    appendUserAgent: 'RMPGFlex/Android',
  },
  ios: {
    backgroundColor: '#000000',
    contentInset: 'always',
    allowsLinkPreview: false,
    appendUserAgent: 'RMPGFlex/iOS',
    preferredContentMode: 'mobile',
  },
};

export default config;
