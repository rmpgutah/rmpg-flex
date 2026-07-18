// Application version — reads the Vite build-time define (sourced from
// package.json) so this never drifts from the value StatusBar/LoginPage use.
// A hand-maintained literal here previously fell out of sync (showed 5.8.4
// while package.json/StatusBar had moved to 5.8.5).
export const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
