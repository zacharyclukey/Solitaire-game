import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.facedown.game',
  appName: 'Facedown',
  webDir: 'dist',
  // The game is entirely local; no network permissions are needed at runtime.
  server: { androidScheme: 'https' },
  backgroundColor: '#0c0a1cff',
  ios: {
    contentInset: 'never',
    backgroundColor: '#0c0a1cff',
    limitsNavigationsToAppBoundDomains: true,
    preferredContentMode: 'mobile',
  },
  android: {
    backgroundColor: '#0c0a1cff',
    allowMixedContent: false,
    captureInput: false,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#0c0a1cff',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0c0a1c',
      overlaysWebView: true,
    },
  },
};

export default config;
