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

export default function DrugIndicationSection({ indication }: { indication: DrugIndication }) {
  const [expanded, setExpanded] = useState(false)
  const needsToggle = indication.plain_text.length > COLLAPSE_THRESHOLD
  const displayText =
    needsToggle && !expanded
      ? indication.plain_text.slice(0, COLLAPSE_THRESHOLD).trimEnd() + '…'
      : indication.plain_text

  const sourceLabel = getSourceLabel(indication.source)
  const isManual = indication.source === 'manual'

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6">
      <h2 className="text-base font-semibold text-slate-800 mb-3">What it&apos;s used for</h2>
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
