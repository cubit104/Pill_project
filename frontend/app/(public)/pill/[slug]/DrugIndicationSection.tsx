'use client'

import { useState } from 'react'
import type { DrugIndication } from '../../../types'

const COLLAPSE_THRESHOLD = 280

function getSourceLabel(source: string): string {
  switch (source) {
    case 'medlineplus': return 'MedlinePlus (NIH)'
    case 'openfda':     return 'openFDA'
    case 'manual':      return 'PillSeek editorial team'
    default:            return source
  }
}

interface DrugIndicationSectionProps {
  indication: DrugIndication
  drugName?: string
  imprint?: string
}

/**
 * Extracts the generic name from the start of the MedlinePlus indication text.
 * The text always begins with the generic name followed by " is used" or " are used".
 */
function extractGeneric(plainText: string): string {
  const match = plainText.match(/^([A-Za-z][A-Za-z\-]+(?:\s+and\s+[A-Za-z\-]+)?)/)
  return match ? match[1].toLowerCase() : ''
}

/**
 * Builds a smart lead-in sentence that bridges the user's search term (brand/imprint)
 * to the generic name used in the MedlinePlus indication text.
 */
function buildLeadIn(drugName: string | undefined, imprint: string | undefined, generic: string): string | null {
  if (!generic) return null

  const drug = (drugName ?? '').trim()
  const imp = (imprint ?? '').trim()

  // Derive the brand portion: everything in drugName before the generic name appears
  let brand = ''
  if (drug) {
    const genericIdx = drug.toLowerCase().indexOf(generic.toLowerCase())
    if (genericIdx > 0) {
      brand = drug.slice(0, genericIdx).trim()
    } else if (!drug.toLowerCase().startsWith(generic.toLowerCase())) {
      // generic doesn't appear in drugName at all — use first word as brand
      brand = drug.split(' ')[0]
    }
    // If drugName starts with generic → brand stays ''
  }

  const brandLower = brand.toLowerCase()
  const genericLower = generic.toLowerCase()
  const impLower = imp.toLowerCase()

  // All three are effectively the same → omit lead-in
  if (brandLower === genericLower && (impLower === genericLower || !imp)) {
    return null
  }

  if (brand && brandLower !== genericLower) {
    if (imp) {
      // Brand name ≠ generic, has imprint
      return `This pill, ${brand} (${imp}), contains ${generic}.`
    } else {
      // Brand name ≠ generic, no imprint
      return `This medication, ${brand}, contains ${generic}.`
    }
  } else {
    // Brand == generic (generic-only pill)
    if (imp) {
      return `This pill (${imp}) contains ${generic}.`
    }
    // No brand, no imprint — not useful
    return null
  }
}

export default function DrugIndicationSection({ indication, drugName, imprint }: DrugIndicationSectionProps) {
  const [expanded, setExpanded] = useState(false)
  const needsToggle = indication.plain_text.length > COLLAPSE_THRESHOLD
  const displayText =
    needsToggle && !expanded
      ? indication.plain_text.slice(0, COLLAPSE_THRESHOLD).trimEnd() + '…'
      : indication.plain_text

  const sourceLabel = getSourceLabel(indication.source)
  const isManual = indication.source === 'manual'

  const generic = extractGeneric(indication.plain_text)
  const leadIn = buildLeadIn(drugName, imprint, generic)

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6">
      <h2 className="text-base font-semibold text-slate-800 mb-3">What it&apos;s used for</h2>
      {leadIn && (
        <p className="text-sm text-slate-700 leading-relaxed mb-2">{leadIn}</p>
      )}
      <p className="text-sm text-slate-700 leading-relaxed">{displayText}</p>
      {needsToggle && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-sm text-emerald-700 hover:underline focus:outline-none focus:ring-2 focus:ring-emerald-500 rounded"
        >
          {expanded ? 'Show less ▴' : 'Read more ▾'}
        </button>
      )}
      <p className="mt-3 text-xs text-slate-500">
        {'Source: '}
        {isManual ? (
          sourceLabel
        ) : indication.source_url ? (
          <a
            href={indication.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sky-700 hover:underline"
            aria-label={`View source on ${sourceLabel} (opens in new tab)`}
          >
            {sourceLabel} ↗
          </a>
        ) : (
          sourceLabel
        )}
      </p>
    </section>
  )
}
