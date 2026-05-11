import React from 'react'
import Link from 'next/link'
import { slugifyDrugName } from './slug'
import { slugFromTag } from './condition-utils'

type LinkTarget = {
  phrase: string
  href: string
}

function escapeRegex(value: string): string {
  return value.replace(/[-\\|{}()[\]^$+*?.]/g, '\\$&')
}

function buildTargets(
  drugName?: string,
  conditionTags: string[] = [],
  mentionedDrugNames: string[] = [],
): LinkTarget[] {
  const targets: LinkTarget[] = []
  const seen = new Set<string>()

  const addTarget = (phrase: string, href: string) => {
    const cleaned = phrase.trim()
    if (!cleaned || !href) return
    const key = cleaned.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    targets.push({ phrase: cleaned, href })
  }

  if (drugName) {
    const slug = slugifyDrugName(drugName)
    addTarget(drugName, slug ? `/drug/${slug}` : '')
  }

  for (const name of mentionedDrugNames) {
    const slug = slugifyDrugName(name)
    addTarget(name, slug ? `/drug/${slug}` : '')
  }

  for (const condition of conditionTags) {
    const slug = slugFromTag(condition)
    addTarget(condition, slug ? `/condition/${slug}` : '')
  }

  targets.sort((a, b) => b.phrase.length - a.phrase.length)
  return targets
}

export function linkifyText(
  text: string,
  drugName?: string,
  conditionTags: string[] = [],
  mentionedDrugNames: string[] = [],
): React.ReactNode {
  if (!text) return text

  const targets = buildTargets(drugName, conditionTags, mentionedDrugNames)
  if (targets.length === 0) return text

  const regex = new RegExp(
    `(^|[^A-Za-z0-9])(${targets.map((t) => escapeRegex(t.phrase)).join('|')})(?=$|[^A-Za-z0-9])`,
    'gi',
  )

  const pieces: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null = regex.exec(text)

  while (match) {
    const [fullMatch, leadingBoundary = '', matchedPhrase = ''] = match
    const offset = match.index
    if (offset > lastIndex) {
      pieces.push(text.slice(lastIndex, offset))
    }

    if (leadingBoundary) {
      pieces.push(leadingBoundary)
    }

    const target = targets.find((t) => t.phrase.toLowerCase() === matchedPhrase.toLowerCase())
    if (target) {
      pieces.push(
        <Link key={`${offset}-${matchedPhrase}`} href={target.href} className="text-sky-700 hover:underline">
          {matchedPhrase}
        </Link>,
      )
    } else {
      pieces.push(matchedPhrase)
    }

    lastIndex = offset + fullMatch.length
    match = regex.exec(text)
  }

  if (lastIndex < text.length) {
    pieces.push(text.slice(lastIndex))
  }

  return <>{pieces}</>
}
