'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import type { DrugIndication } from '../../../types'
import { slugFromTag } from '../../../lib/condition-utils'

const COLLAPSE_THRESHOLD = 280

const FRONTEND_KEYWORD_MAP: Record<string, string[]> = {
  "heart attack":              ["heart attack", "myocardial infarction"],
  "stroke":                    ["stroke"],
  "high blood pressure":       ["high blood pressure", "hypertension", "elevated blood pressure"],
  "diabetes":                  ["type 2 diabetes", "type 1 diabetes", "diabetes mellitus", "diabetes", "blood glucose", "blood sugar"],
  "pain":                      ["moderate to severe pain", "mild to moderate pain", "chronic pain", "acute pain", "musculoskeletal pain", "neuropathic pain", "cancer pain"],
  "bacterial infection":       ["bacterial infections", "bacterial infection", "bacterial pneumonia", "bacterial sinusitis", "bacterial meningitis"],
  "high cholesterol":          ["high cholesterol", "elevated cholesterol", "hyperlipidemia", "hypercholesterolemia", "low-density lipoprotein", "ldl cholesterol", "triglycerides"],
  "anxiety":                   ["anxiety disorder", "generalized anxiety disorder", "panic disorder", "social anxiety disorder", "anxiety"],
  "depression":                ["major depressive disorder", "major depression", "depression"],
  "seizures":                  ["seizures", "epilepsy", "epileptic"],
  "blood clots":               ["blood clots", "deep vein thrombosis", "pulmonary embolism", "thrombosis", "dvt", "clotting", "clot"],
  "acid reflux":               ["acid reflux", "gastroesophageal reflux disease", "gerd", "heartburn", "stomach acid"],
  "allergies":                 ["seasonal allergies", "allergic rhinitis", "hay fever", "allergic reactions", "allergies", "allergy"],
  "asthma":                    ["asthma", "bronchospasm"],
  "thyroid disease":           ["hypothyroidism", "hyperthyroidism", "thyroid disease", "thyroid disorder"],
  "kidney disease":            ["chronic kidney disease", "kidney disease", "renal failure", "renal disease", "end-stage renal disease"],
  "osteoporosis":              ["osteoporosis", "bone loss"],
  "rheumatoid arthritis":      ["rheumatoid arthritis"],
  "osteoarthritis":            ["osteoarthritis"],
  "nausea":                    ["nausea and vomiting", "chemotherapy-induced nausea", "postoperative nausea", "nausea"],
  "insomnia":                  ["insomnia", "sleep disorder", "difficulty sleeping"],
  "adhd":                      ["attention deficit hyperactivity disorder", "adhd", "attention deficit disorder"],
  "bipolar disorder":          ["bipolar disorder", "manic episodes", "manic depression"],
  "schizophrenia":             ["schizophrenia", "schizoaffective disorder"],
  "parkinson's disease":       ["parkinson's disease", "parkinson disease", "parkinsonian symptoms"],
  "alzheimer's disease":       ["alzheimer's disease", "alzheimer disease", "dementia"],
  "hiv":                       ["hiv infection", "human immunodeficiency virus"],
  "hepatitis":                 ["hepatitis b", "hepatitis c", "chronic hepatitis"],
  "fungal infections":         ["fungal infections", "yeast infections", "candidiasis", "tinea"],
  "heart failure":             ["heart failure", "congestive heart failure", "cardiac failure"],
  "atrial fibrillation":       ["atrial fibrillation", "irregular heartbeat", "abnormal heart rhythm", "arrhythmia"],
  "peripheral artery disease": ["peripheral arterial disease", "peripheral artery disease", "poor blood flow"],
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function highlightText(text: string, conditionTags: string[]): React.ReactNode {
  // Collect all phrases for active tags, tracking which tag each phrase belongs to
  const phraseToTag: Map<string, string> = new Map()
  for (const tag of conditionTags) {
    const phrases = FRONTEND_KEYWORD_MAP[tag] ?? []
    for (const phrase of phrases) {
      if (!phraseToTag.has(phrase.toLowerCase())) {
        phraseToTag.set(phrase.toLowerCase(), tag)
      }
    }
  }

  const phrases = Array.from(phraseToTag.keys())
  if (phrases.length === 0) return text

  // Sort longest-first to prevent shorter phrases matching before longer ones
  phrases.sort((a, b) => b.length - a.length)

  const regex = new RegExp('\\b(' + phrases.map(escapeRegex).join('|') + ')\\b', 'gi')
  const parts = text.split(regex)

  return (
    <>
      {parts.map((part, i) => {
        const tag = phraseToTag.get(part.toLowerCase())
        if (tag) {
          const conditionSlug = slugFromTag(tag)
          return (
            <Link
              key={i}
              href={`/condition/${conditionSlug}`}
              className="font-semibold text-emerald-700 hover:underline"
              aria-label={`See other medications for ${tag}`}
            >
              {part}
            </Link>
          )
        }
        return <React.Fragment key={i}>{part}</React.Fragment>
      })}
    </>
  )
}

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
  conditionTags?: string[]
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
  // General: extract everything before " is/are used" (MedlinePlus) or " is/are indicated" (openFDA)
  const generalMatch = plainText.match(/^([A-Za-z][A-Za-z0-9\s\-,]+?) (?:is|are) (?:used|indicated)/i)
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

export default function DrugIndicationSection({ indication, drugName, imprint, conditionTags }: DrugIndicationSectionProps) {
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
      <p className="text-sm text-slate-700 leading-relaxed">
        {conditionTags && conditionTags.length > 0
          ? highlightText(displayText, conditionTags)
          : displayText}
      </p>
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
