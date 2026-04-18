#!/usr/bin/env node
/**
 * PillSeek brand asset generator
 *
 * Rasterises SVG source files from frontend/public/ into PNG and ICO binaries
 * required by the app (favicons, PWA icons, OG image).
 *
 * Run from the frontend/ directory:
 *   npm run generate-assets
 *
 * Dependencies (in frontend/devDependencies):
 *   sharp    – SVG→PNG rasterisation (uses libvips)
 *   png-to-ico – PNG→ICO packaging
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// This script lives in frontend/scripts/ so public/ is one level up
const publicDir = resolve(__dirname, '..', 'public')

// Lazy-load sharp and png-to-ico so the error message is clear if not installed
let sharp
let pngToIco

try {
  const sharpMod = await import('sharp')
  sharp = sharpMod.default
} catch {
  console.error(
    '❌  sharp is not installed. Run: npm install --save-dev sharp'
  )
  process.exit(1)
}

try {
  const icoMod = await import('png-to-ico')
  pngToIco = icoMod.default
} catch {
  console.error(
    '❌  png-to-ico is not installed. Run: npm install --save-dev png-to-ico'
  )
  process.exit(1)
}

/** Read an SVG file from frontend/public/ and return its buffer. */
function svgBuf(filename) {
  return readFileSync(resolve(publicDir, filename))
}

/** Resize an SVG buffer to a PNG buffer using sharp. */
async function rasterize(svgBuffer, size) {
  return sharp(svgBuffer).resize(size, size).png().toBuffer()
}

async function main() {
  console.log('🎨  Generating PillSeek brand assets…\n')

  const markSvg = svgBuf('logo-mark.svg')
  const ogSvg = svgBuf('og-image.svg')

  // ── App icon sizes (all from logo-mark.svg, dark-on-light variant) ──
  const sizes = [
    { file: 'icon.png', size: 512 },
    { file: 'icon-192.png', size: 192 },
    { file: 'apple-touch-icon.png', size: 180 },
    { file: 'favicon-32.png', size: 32 },
    { file: 'favicon-16.png', size: 16 },
  ]

  const pngBuffers = {}

  for (const { file, size } of sizes) {
    const buf = await rasterize(markSvg, size)
    writeFileSync(resolve(publicDir, file), buf)
    pngBuffers[size] = buf
    console.log(`  ✅  ${file}  (${size}×${size})`)
  }

  // ── favicon.ico — generated from a 256×256 PNG ──
  // png-to-ico expects a file path to a 256×256 PNG
  const ico256Buf = await rasterize(markSvg, 256)
  const tmpIcoPath = resolve(publicDir, '_favicon-256-tmp.png')
  writeFileSync(tmpIcoPath, ico256Buf)
  const icoBuffer = await pngToIco(tmpIcoPath)
  writeFileSync(resolve(publicDir, 'favicon.ico'), icoBuffer)
  // Clean up temp file
  try { (await import('node:fs')).unlinkSync(tmpIcoPath) } catch { /* ok */ }
  console.log('  ✅  favicon.ico  (16×16, 32×32, 48×48 via png-to-ico)')

  // ── OG image (1200×630, from og-image.svg) ──
  const ogBuffer = await sharp(ogSvg)
    .resize(1200, 630, { fit: 'fill' })
    .png()
    .toBuffer()
  writeFileSync(resolve(publicDir, 'og-image.png'), ogBuffer)
  console.log('  ✅  og-image.png  (1200×630)')

  console.log('\n🚀  All brand assets generated successfully.')
}

main().catch((err) => {
  console.error('❌  Asset generation failed:', err)
  process.exit(1)
})
