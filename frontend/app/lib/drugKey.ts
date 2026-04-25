/**
 * Server-side drug URL helpers.
 *
 * Uses the Node.js `crypto` module (SHA-1) to compute a stable 8-hex-char key
 * from a drug name.  The same algorithm is used in the Python backend so that
 * `/drug/<slug>?k=<hex8>` can be resolved back to the original medicine_name
 * without a DB schema change.
 *
 * Algorithm (must stay in sync with `routes/search.py::drug_key`):
 *   normalized = name.trim().toLowerCase()
 *   k = sha1(normalized).hexdigest()[0:8]
 *
 * This file MUST only be imported by server components / server-side code.
 * Do NOT import it from client components — use the `drugHref` prop pattern
 * instead (compute in the server component and pass down as a string prop).
 */
import { createHash } from 'crypto'
import { slugifyDrugName } from './slug'

/**
 * Return an 8-character lowercase hex key for the given drug name.
 * Deterministic: same name always → same key.
 */
export function drugKey(name: string): string {
  const normalized = name.trim().toLowerCase()
  return createHash('sha1').update(normalized, 'utf8').digest('hex').slice(0, 8)
}

/**
 * Build a clean `/drug/<slug>?k=<hex8>` href for a drug name.
 * Returns an empty string when the name is empty or unknown.
 */
export function buildDrugHref(drugName: string): string {
  if (!drugName || drugName === 'Unknown') return ''
  const slug = slugifyDrugName(drugName)
  if (!slug || slug === 'unknown') return ''
  const key = drugKey(drugName)
  return `/drug/${slug}?k=${key}`
}
