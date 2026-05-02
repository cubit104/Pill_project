'use client'

import React, { useState } from 'react'
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
 * Handles combination texts ("The combination of X and Y is used...") and
 * multi-word generics ("Buprenorphine Transdermal Patch is used...").
 */
function extractGeneric(plainText: string): string {
  // Handle "The combination of X and Y is used..."
  const comboMatch = plainText.match(/^[Tt]he combination of ([A-Za-z][A-Za-z0-9\s\-,]+?) (?:is|are) used/)
  if (comboMatch) return comboMatch[1].trim().toLowerCase()
  // General: extract everything before " is used" / " are used"
  const generalMatch = plainText.match(/^([A-Za-z][A-Za-z0-9\s\-,]+?) (?:is|are) used/i)
  return generalMatch ? generalMatch[1].trim().toLowerCase() : ''
}

/**
 * Builds a smart lead-in sentence that bridges the user's search term (brand/imprint)
 * to the generic name used in the MedlinePlus indication text.
 * Returns React.ReactNode so the brand can be rendered in <strong>.
 */
function buildLeadIn(drugName: string | undefined, imprint: string | undefined, generic: string): React.ReactNode {
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

  // No brand or brand same as generic → generic-only pill
  if (!brand || brandLower === genericLower) {
    if (!imp) return null
    return <>This pill ({imp}) contains {generic}.</>
  }

  // Brand ≠ generic
  if (imp) {
    return <>This pill, <strong>{brand}</strong> ({imp}), contains {generic}.</>
  }
  return <>This medication, <strong>{brand}</strong>, contains {generic}.</>
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
