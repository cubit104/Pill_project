import type { CapacitorConfig } from '@capacitor/cli'
import { KeyboardResize } from '@capacitor/keyboard'

const config: CapacitorConfig = {
  appId: 'com.pillseek.app',
  appName: 'PillSeek',
  webDir: 'dist',
  // Default server config on purpose: the WebView serves the bundle from
  // capacitor://localhost (iOS) / https://localhost (Android) and the app calls
  // https://pillseek.com directly. Do NOT set server.hostname to pillseek.com;
  // it would intercept the API calls.
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: false,
      backgroundColor: '#f8fafc',
      showSpinner: false,
    },
    StatusBar: {
      // iOS draws under the status bar (safe-area insets handle it); Android
      // gets a solid themed bar at runtime (see native.ts applyStatusBar).
      overlaysWebView: true,
      style: 'DEFAULT',
    },
    Keyboard: {
      resize: KeyboardResize.Native,
      resizeOnFullScreen: true,
    },
  },
  ios: {
    contentInset: 'never',
    backgroundColor: '#f8fafc',
  },
  android: {
    backgroundColor: '#f8fafc',
    allowMixedContent: false,
    // Android 15+ enforces edge-to-edge; let Capacitor add the system-bar margins.
    adjustMarginsForEdgeToEdge: 'auto',
  },
}

export default config
