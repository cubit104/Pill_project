# PillSeek mobile app

Native iOS / Android app for [PillSeek](https://pillseek.com): identify a pill from two photos
(imprint reader + 14,000-pill catalogue) or search by imprint, drug name or NDC.

Built as a small **Vite 6 + React 19 + TypeScript** app wrapped with **Capacitor 7**. It is
_not_ a WebView of the website: the UI is native-feeling (large titles, tab bar, bottom
sheets, haptics, safe areas, dark mode) and only the pill detail pages open the website in an
in-app browser.

```
mobile/
  capacitor.config.ts     appId com.pillseek.app, webDir dist
  index.html              viewport-fit=cover, theme-color
  src/
    main.tsx / App.tsx    router, providers, Android back button, deep links, splash
    styles.css            design tokens (CSS variables, light + dark) and primitives
    lib/
      api.ts              typed API client (timeouts, error mapping, /filters vs /api/*)
      crop.ts             pure circle-guide crop math (unit-tested)
      camera.ts           native preview + crop, system-camera / file-picker fallbacks
      storage.ts          @capacitor/preferences: recent list, consent, last tab
      native.ts           Browser / Haptics / StatusBar / SplashScreen / Keyboard wrappers
      settings.tsx        consent + /api/features context
      backstack.tsx       Android back-button handler stack
      hooks.ts            useOnline, useFeatures, useDebouncedValue, useElementSize
    components/           Button, Card, Chip, Sheet, Toast, Skeleton, ProgressRing,
                          EmptyState, Disclaimer, TabBar, ScreenHeader, SegmentedControl,
                          TextField, Toggle, OfflineBanner, ErrorCard, PillRow, Icons
    screens/              IdentifyScreen, CameraScreen, SearchScreen, RecentScreen, AboutScreen
    test/                 vitest: crop math + API error mapping
  assets/                 icon.svg / splash.svg sources for @capacitor/assets
  public/logo-mark.svg
```

## API

Base URL is `https://pillseek.com` on device (Vercel proxies `/api/*` to the FastAPI backend).
Endpoints used, with the exact paths:

| Method | Path                     | Used by                                   |
| ------ | ------------------------ | ----------------------------------------- |
| GET    | `/api/features`          | reader on/off state (Identify, About)     |
| GET    | `/filters`               | colour / shape chips (**not** `/api/filters`) |
| GET    | `/api/search`            | Search tab                                |
| POST   | `/api/identify`          | manual imprint fallback                   |
| POST   | `/api/identify/photo`    | two-side photo identification (60 s timeout) |
| POST   | `/api/identify/feedback` | 👍 / 👎 feedback                           |

`src/lib/api.ts` maps HTTP errors to friendly copy: 404 on the photo endpoint = feature paused,
413 too large, 422 unreadable image, 429 rate limited (30/hour), 503 warming up, plus offline
and timeout.

### CORS (backend)

The WebView origin is `capacitor://localhost` on iOS and `https://localhost` on Android.
The backend (and Vercel proxy) must allow those origins for the paths above, including the
multipart `POST /api/identify/photo`. Do **not** set `server.hostname` in
`capacitor.config.ts` to `pillseek.com`: that would intercept the API calls.

pillseek.com sits behind Cloudflare. Its bot protection answers non-browser clients (and,
occasionally, the very first burst of requests from a fresh browser context) with a
`403` challenge page. The app surfaces that as "Request failed (403)" with a Try again
button; if it shows up on devices, add a Cloudflare WAF skip rule for `/api/*` and
`/filters` (or for the app's User-Agent).

## Run in a browser

```bash
cd mobile
npm install
npm run dev          # http://localhost:5180
```

The Vite dev server proxies `/api/*` and `/filters` to production, so search and manual
identification work in the browser. The native camera preview is not available on the web:
"Open camera" falls back to a file input (`capture=environment`), so on a phone browser you
still get the system camera, and on a desktop you get a file picker.

Other scripts:

```bash
npm test             # vitest (crop math, error mapping)
npm run typecheck    # tsc --noEmit
npm run build        # tsc + vite build -> dist/
npm run sync         # build + npx cap sync
```

## Build for iOS (macOS only)

```bash
npm run build
npx cap add ios --packagemanager SPM      # first time only
npx cap sync ios
```

Add these keys to `ios/App/App/Info.plist` (Xcode: Info tab, or edit the file):

```xml
<key>NSCameraUsageDescription</key>
<string>PillSeek uses the camera to photograph both sides of a pill so it can read the imprint and identify it.</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>PillSeek can identify a pill from photos you already have in your library.</string>
<key>NSPhotoLibraryAddUsageDescription</key>
<string>PillSeek can save pill photos you take to your library.</string>
```

Also add `pillseek.com` under Associated Domains (`applinks:pillseek.com`) if you want
website links to open the app (App.tsx handles `/search?...` and `/identify` deep links).

Open in Xcode with `npx cap open ios`, set your Team under Signing & Capabilities, then run
on a device. Command-line archive/export with automatic signing:

```bash
cd ios/App
xcodebuild -workspace App.xcworkspace -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/App.xcarchive \
  -allowProvisioningUpdates DEVELOPMENT_TEAM=YOUR_TEAM_ID archive

cat > build/ExportOptions.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>signingStyle</key><string>automatic</string>
  <key>teamID</key><string>YOUR_TEAM_ID</string>
  <key>uploadSymbols</key><true/>
</dict></plist>
EOF

xcodebuild -exportArchive -archivePath build/App.xcarchive \
  -exportOptionsPlist build/ExportOptions.plist -exportPath build/export \
  -allowProvisioningUpdates
```

The camera preview plugin (`@capacitor-community/camera-preview`) needs a real device; the
simulator has no camera, so the app falls back to the photo picker there.

## Build for Android

```bash
npm run build
npx cap add android        # first time only
npx cap sync android
cd android && ./gradlew assembleDebug        # -> app/build/outputs/apk/debug/app-debug.apk
```

`npx cap sync` merges the `CAMERA` permission from the plugins into `AndroidManifest.xml`.
For a release build create a keystore, add `signingConfigs` to `android/app/build.gradle`
and run `./gradlew bundleRelease`. Open in Android Studio with `npx cap open android`.

## Icons and splash screens

Sources live in `mobile/assets` (`icon.svg`, `icon-foreground.svg`, `icon-background.svg`,
`splash.svg`, `splash-dark.svg`). After the native projects exist:

```bash
npm run assets
# = npx capacitor-assets generate --iconBackgroundColor #ffffff --iconBackgroundColorDark #0b1220 \
#     --splashBackgroundColor #ffffff --splashBackgroundColorDark #0b1220
```

`@capacitor/assets` is a dev dependency; it writes into `ios/` and `android/`, so it only
works once `npx cap add ios|android` has been run. If it fails on your machine (it needs
`sharp`), generate the icons with any tool from `assets/icon.svg` (1024x1024) and
`assets/splash.svg` (2732x2732) and drop them into the native projects.

## Native behaviour notes

- **Camera flow**: `CameraScreen` starts `CameraPreview` behind the WebView (`toBack: true`,
  rear camera, pinch zoom, audio off). The overlay dims everything outside a circle that is
  68 % of the shorter side. On shutter the full-resolution frame is captured, the circle
  region (+12 % padding) is cropped with the same object-fit-cover maths as the website's
  `CameraCapture.tsx` (`src/lib/crop.ts`), downscaled to 1600 px and encoded as JPEG 0.9.
  Side 1 then side 2 are captured in one session; the request is sent when both exist.
- **Fallbacks**: preview unavailable (simulator, denied permission, web) →
  `@capacitor/camera` `getPhoto` (system camera / library) → on the web, a file input.
- **Consent**: the "Keep my photos to improve the reader" toggle (About tab, default on) is
  sent as `consent=1` with each photo request.
- **Recent**: last 20 identifications and searches in `@capacitor/preferences` with a
  200 px JPEG thumbnail; swipe left or long-press to delete, "Clear all" in the header.
- **Android back button**: closes the camera / sheet first, then navigates back, then exits.
- **Offline**: a banner shows while `navigator.onLine` is false and requests fail fast.
- **Theme**: CSS variables in `styles.css` switch with `prefers-color-scheme`; the status bar
  style follows.

## Android camera permission

The camera plugins do not declare the CAMERA permission themselves. `android/app/src/main/AndroidManifest.xml` must contain
`<uses-permission android:name="android.permission.CAMERA" />` (already added); re-add it if you regenerate the Android project.
