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
    SystemBars: {
      // Capacitor 8 handles Android edge-to-edge here. 'css' keeps env(safe-area-inset-*)
      // correct (index.html sets viewport-fit=cover) and also injects --safe-area-inset-*.
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
    },
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
      // Overlay: the keyboard slides over the page instead of shrinking the WebView
      // (see native.ts installKeyboardListeners for the --kb padding).
      resize: KeyboardResize.None,
    },
  },
  ios: {
    contentInset: 'never',
    backgroundColor: '#f8fafc',
  },
  android: {
    backgroundColor: '#f8fafc',
    allowMixedContent: false,
  },
}

export default config
