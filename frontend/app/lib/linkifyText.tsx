import React from 'react'
import Link from 'next/link'
import { slugifyDrugName } from './slug'

type LinkTarget = {
  phrase: string
  href: string
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function slugifyConditionName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
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
    const slug = slugifyConditionName(condition)
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

  text.replace(regex, (match, leadingBoundary: string, phraseMatch: string, offset: number) => {
    if (offset > lastIndex) {
      pieces.push(text.slice(lastIndex, offset))
    }

    if (leadingBoundary) {
      pieces.push(leadingBoundary)
    }

    const target = targets.find((t) => t.phrase.toLowerCase() === phraseMatch.toLowerCase())
    if (target) {
      pieces.push(
        <Link key={`${offset}-${phraseMatch}`} href={target.href} className="text-sky-700 hover:underline">
          {phraseMatch}
        </Link>,
      )
    } else {
      pieces.push(phraseMatch)
    }

    lastIndex = offset + match.length
    return match
  })

  if (lastIndex < text.length) {
    pieces.push(text.slice(lastIndex))
  }

  return <>{pieces}</>
}

