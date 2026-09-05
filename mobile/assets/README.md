# PillSeek app icon & splash assets

Source artwork for the iOS/Android app icons and splash screens.

| File | Size | Purpose |
|---|---|---|
| `icon.svg` | 1024x1024 | Full-bleed app icon (iOS + Android legacy). Artwork sits inside the central 66% safe zone. |
| `icon-foreground.svg` | 1024x1024 | Android adaptive-icon foreground layer, transparent background, artwork inside the central 60%. |
| `icon-background.svg` | 1024x1024 | Android adaptive-icon background layer: flat emerald `#059669` with a subtle radial highlight. |
| `splash.svg` | 2732x2732 | Light splash (`#f8fafc` canvas), icon centered at ~20% width, "PillSeek" wordmark below. |
| `splash-dark.svg` | 2732x2732 | Dark splash (`#0b1220` canvas). |

Brand colors: emerald `#059669` (primary), `#047857` (deep), `#ecfdf5` (tint), ink `#0f172a`, white.

## Generating native assets with @capacitor/assets

`@capacitor/assets` looks for these exact file names in `<app>/assets/` (this folder, when run from `mobile/`):

```
assets/icon.svg              (or icon-only.png)
assets/icon-foreground.svg
assets/icon-background.svg
assets/splash.svg
assets/splash-dark.svg
```

From the `mobile/` folder:

```bash
npm install -D @capacitor/assets
npx capacitor-assets generate \
  --iconBackgroundColor '#059669' \
  --iconBackgroundColorDark '#059669' \
  --splashBackgroundColor '#f8fafc' \
  --splashBackgroundColorDark '#0b1220'
```

Add `--ios` / `--android` to limit output to one platform. The tool writes every required
icon size into `ios/App/App/Assets.xcassets` and `android/app/src/main/res/` (mipmap-*, drawable-*),
so run it after `npx cap add ios` / `npx cap add android` and before building.

## If the tool rejects SVG

Some versions of `@capacitor/assets` only accept PNG (or rasterize SVG poorly, e.g. the
`rgba()` fills or system-font text). If that happens, export PNGs at the same sizes and
file names (`icon.png`, `icon-foreground.png`, `icon-background.png`, `splash.png`,
`splash-dark.png`) and rerun the command. Any of these will do:

```bash
# librsvg
rsvg-convert -w 1024 -h 1024 icon.svg -o icon.png
rsvg-convert -w 2732 -h 2732 splash.svg -o splash.png

# Inkscape
inkscape icon.svg --export-type=png --export-width=1024 --export-filename=icon.png

# Node (sharp)
node -e "require('sharp')('icon.svg').resize(1024,1024).png().toFile('icon.png')"
```

The splash wordmark uses a system font stack; rasterize on a machine with a bold sans-serif
(macOS/Windows both fine) or convert the text to paths first if you want pixel-identical output.
