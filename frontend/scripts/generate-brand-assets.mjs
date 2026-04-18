#!/usr/bin/env node
/**
 * generate-brand-assets.mjs
 *
 * Rasterises the PillSeek SVG source files in frontend/public/ into all
 * required PNG and ICO assets.
 *
 * Usage (from the repo root):
 *   cd frontend && npm run generate-assets
 *
 * Or directly:
 *   node scripts/generate-brand-assets.mjs
 *
 * Outputs:
 *   frontend/public/icon.png            512×512  (for JSON-LD Organization.logo)
 *   frontend/public/icon-192.png        192×192  (PWA manifest)
 *   frontend/public/apple-touch-icon.png 180×180
 *   frontend/public/favicon-32.png       32×32
 *   frontend/public/favicon-16.png       16×16
 *   frontend/public/favicon.ico         multi-res 16/32/48
 *   frontend/public/og-image.png       1200×630  (social sharing)
 */

import { readFileSync, writeFileSync, copyFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const __dirname = dirname(fileURLToPath(import.meta.url))
// Script lives at frontend/scripts/ — so "frontend/" is one level up
const FRONTEND = resolve(__dirname, '..')
const PUBLIC = resolve(FRONTEND, 'public')

/** Rasterise an SVG file to PNG at the given dimensions. */
async function svgToPng(svgPath, outputPath, width, height) {
  const svg = readFileSync(svgPath)
  await sharp(svg)
    .resize(width, height)
    .png()
    .toFile(outputPath)
  console.log(`✓  ${outputPath.replace(FRONTEND + '/', 'frontend/')}  (${width}×${height})`)
}

async function main() {
  const markSvg = resolve(PUBLIC, 'logo-mark.svg')
  const ogSvg = resolve(PUBLIC, 'og-image.svg')

  // ── PNG exports from logo-mark.svg ──────────────────────────────────────
  await svgToPng(markSvg, resolve(PUBLIC, 'icon.png'),              512, 512)
  await svgToPng(markSvg, resolve(PUBLIC, 'icon-192.png'),          192, 192)
  await svgToPng(markSvg, resolve(PUBLIC, 'apple-touch-icon.png'),  180, 180)
  await svgToPng(markSvg, resolve(PUBLIC, 'favicon-32.png'),         32,  32)
  await svgToPng(markSvg, resolve(PUBLIC, 'favicon-16.png'),         16,  16)

  // ── OG image from og-image.svg ──────────────────────────────────────────
  await svgToPng(ogSvg,   resolve(PUBLIC, 'og-image.png'),         1200, 630)

  // ── favicon.ico — multi-resolution (16, 32, 48) ─────────────────────────
  const ico48 = await sharp(readFileSync(markSvg))
    .resize(48, 48)
    .png()
    .toBuffer()

  const icoBuffer = await pngToIco([
    resolve(PUBLIC, 'favicon-16.png'),
    resolve(PUBLIC, 'favicon-32.png'),
    ico48,
  ])

  const icoPath = resolve(PUBLIC, 'favicon.ico')
  writeFileSync(icoPath, icoBuffer)
  console.log(`✓  frontend/public/favicon.ico  (16/32/48)`)

  // ── Next.js app-dir file-convention icons ───────────────────────────────
  // Copies keep frontend/app/icon.png and app/apple-icon.png in sync so
  // Next.js auto-injects the correct <link> tags without manual markup.
  const APP = resolve(FRONTEND, 'app')
  copyFileSync(resolve(PUBLIC, 'icon.png'),             resolve(APP, 'icon.png'))
  copyFileSync(resolve(PUBLIC, 'apple-touch-icon.png'), resolve(APP, 'apple-icon.png'))
  console.log('✓  frontend/app/icon.png + apple-icon.png (Next.js file convention)')

  console.log('\nAll brand assets generated successfully.')
}

main().catch((err) => {
  console.error('Error generating brand assets:', err)
  process.exit(1)
})
