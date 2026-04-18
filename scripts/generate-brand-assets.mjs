#!/usr/bin/env node
/**
 * PillSeek brand asset generator — root-level entry point.
 *
 * This script delegates to the actual generator in frontend/scripts/.
 * Run from the repo root:   node scripts/generate-brand-assets.mjs
 * Or from frontend/:        npm run generate-assets
 */
import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const frontendDir = resolve(__dirname, '..', 'frontend')

const child = spawn(
  process.execPath,
  ['scripts/generate-brand-assets.mjs'],
  { cwd: frontendDir, stdio: 'inherit' }
)

child.on('exit', (code) => process.exit(code ?? 0))
