import Link from 'next/link'
import React, { type ReactNode } from 'react'
import { slugFromTag } from '../../../../lib/condition-utils'
import { slugifyDrugName } from '../../../../lib/slug'

export type LinkTarget = {
  term: string
  href: string
}

export type ConditionLink = {
  term: string
  slug: string
}

type ConditionListItemLike = {
  slug: string
  title: string
}

export const LINK_CLASSES = 'text-emerald-600 hover:underline'
/** Maximum number of times each individual keyword may be hyperlinked per page. */
export const MAX_LINKS_PER_TERM = 3
export const SAFE_INTERNAL_PATH_RE = /^\/(?:drug|condition)\/[a-z0-9]+(?:-[a-z0-9]+)*$/
export const CONDITION_TITLE_PREFIX_RE = /^Medications for\s+/i

// Keep plain-text heading detection conservative so normal sentence lines still linkify;
// short title-like lines (up to 80 chars) are treated as headings and skipped.
const MAX_PLAIN_TEXT_HEADING_LENGTH = 80
const PLAIN_TEXT_HEADING_RE = new RegExp(
  `^[A-Z][A-Za-z0-9\\s'(),./:;!?&\\-]{0,${MAX_PLAIN_TEXT_HEADING_LENGTH}}$`
)

/**
 * Per-term link counter — tracks how many times each term has been linked so far.
 * Pass the same instance across multiple linkify calls on the same page render
 * to enforce the per-term cap across the whole page.
 */
export type TermCounter = Map<string, number>

export function createTermCounter(): TermCounter {
  return new Map<string, number>()
}

function termCount(counter: TermCounter, termKey: string): number {
  return counter.get(termKey) ?? 0
}

function incrementTerm(counter: TermCounter, termKey: string): void {
  counter.set(termKey, (counter.get(termKey) ?? 0) + 1)
}

export function normalizeTerms(terms: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of terms) {
    const value = raw.trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out.sort((a, b) => b.length - a.length)
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function makeLinkRegex(terms: string[]): RegExp | null {
  if (terms.length === 0) return null
  return new RegExp(`(?<![A-Za-z0-9])(${terms.map(escapeRegex).join('|')})(?![A-Za-z0-9])`, 'gi')
}

export function splitBrandNames(value: string | null | undefined): string[] {
  if (!value) return []
  return value
    .split(/[;,/]/)
    .map((part) => part.trim())
    .filter(Boolean)
}

export function buildLinkTargets({
  drugNames,
  conditionLinks,
}: {
  drugNames: string[]
  conditionLinks: ConditionLink[]
}): LinkTarget[] {
  const targets: LinkTarget[] = []

  for (const name of normalizeTerms(drugNames)) {
    const slug = slugifyDrugName(name)
    if (!slug) continue
    targets.push({ term: name, href: `/drug/${slug}` })
  }

  for (const { term, slug } of conditionLinks) {
    if (!slug) continue
    targets.push({ term, href: `/condition/${slug}` })
  }

  const deduped = new Map<string, LinkTarget>()
  for (const target of targets) {
    const key = target.term.toLowerCase()
    if (!deduped.has(key)) deduped.set(key, target)
  }
  return Array.from(deduped.values()).sort((a, b) => b.term.length - a.term.length)
}

export function buildConditionLinks(conditions: ConditionListItemLike[]): ConditionLink[] {
  const links: ConditionLink[] = []
  for (const condition of conditions) {
    const term = condition.title.replace(CONDITION_TITLE_PREFIX_RE, '').trim()
    if (!term) continue
    links.push({
      term,
      slug: condition.slug || slugFromTag(term),
    })
  }
  return links
}

export function getSafeHref(href: string): string | null {
  try {
    const resolved = new URL(href, 'https://pillseek.com')
    if (resolved.origin !== 'https://pillseek.com') return null
    if (!SAFE_INTERNAL_PATH_RE.test(resolved.pathname)) return null
    return resolved.pathname
  } catch {
    return null
  }
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/**
 * Injects keyword hyperlinks into an HTML string.
 *
 * Rules:
 * - Each unique term is linked at most MAX_LINKS_PER_TERM (3) times across the page.
 * - Text inside <h1>–<h6> and existing <a> tags is never modified.
 * - Pass the same `termCounter` across multiple calls on the same page to enforce
 *   the per-term cap globally (e.g. boxed warning + medguide body share one counter).
 */
export function linkifyHtmlContent(
  content: string,
  targets: LinkTarget[],
  termCounter: TermCounter = createTermCounter()
): string {
  if (!content || targets.length === 0) return content

  const regex = makeLinkRegex(targets.map((target) => target.term))
  if (!regex) return content

  const targetByTerm = new Map(targets.map((target) => [target.term.toLowerCase(), target]))
  // Preserve existing anchors and heading blocks so heading text never receives injected links.
  const protectedChunks = content.split(/(<a\b[^>]*>[\s\S]*?<\/a>|<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>)/gi)

  return protectedChunks
    .map((chunk) => {
      if (/^<a\b/i.test(chunk) || /^<h[1-6]\b/i.test(chunk)) return chunk
      const tokens = chunk.split(/(<[^>]+>)/g)
      return tokens
        .map((token) => {
          if (token.startsWith('<')) return token
          return token.replace(regex, (match) => {
            const termKey = match.toLowerCase()
            const target = targetByTerm.get(termKey)
            const safeHref = target ? getSafeHref(target.href) : null
            if (!target || !safeHref) return match
            if (termCount(termCounter, termKey) >= MAX_LINKS_PER_TERM) return match
            incrementTerm(termCounter, termKey)
            return `<a href="${escapeHtml(safeHref)}" class="${LINK_CLASSES}">${escapeHtml(match)}</a>`
          })
        })
        .join('')
    })
    .join('')
}

/**
 * Injects keyword hyperlinks into a plain-text string, returning React nodes.
 *
 * Rules:
 * - Each unique term is linked at most MAX_LINKS_PER_TERM (3) times.
 * - Lines that look like headings (title-case, no trailing punctuation) are skipped.
 * - Pass the same `termCounter` across multiple calls on the same page render.
 */
export function linkifyText(
  text: string,
  drugName: string,
  conditionTags: string[],
  additionalDrugNames: string[],
  termCounter: TermCounter = createTermCounter()
): ReactNode {
  if (!text) return text

  const targets = buildLinkTargets({
    drugNames: [drugName, ...additionalDrugNames],
    conditionLinks: normalizeTerms(conditionTags).map((tag) => ({
      term: tag,
      slug: slugFromTag(tag),
    })),
  })
  const regex = makeLinkRegex(targets.map((target) => target.term))
  if (!regex) return text

  const targetByTerm = new Map(targets.map((target) => [target.term.toLowerCase(), target]))
  const linkifyLine = (line: string, lineIndex: number): ReactNode => {
    const trimmed = line.trim()
    const startsWithCapital = /^[A-Z]/.test(trimmed)
    const isHeadingLine =
      trimmed.length > 0 &&
      startsWithCapital &&
      !/[.!?]$/.test(trimmed) &&
      (trimmed.endsWith(':') || PLAIN_TEXT_HEADING_RE.test(trimmed))

    if (isHeadingLine) return line

    const parts: ReactNode[] = []
    let cursor = 0
    let linkKeyIndex = 0

    for (const match of line.matchAll(regex)) {
      if (match.index === undefined) continue
      const index = match.index
      if (index > cursor) parts.push(line.slice(cursor, index))

      const matchedText = match[0]
      const termKey = matchedText.toLowerCase()
      const target = targetByTerm.get(termKey)
      const safeHref = target ? getSafeHref(target.href) : null

      if (target && safeHref && termCount(termCounter, termKey) < MAX_LINKS_PER_TERM) {
        incrementTerm(termCounter, termKey)
        parts.push(
          <Link key={`link-${lineIndex}-${linkKeyIndex}-${safeHref}`} href={safeHref} className={LINK_CLASSES}>
            {matchedText}
          </Link>
        )
        linkKeyIndex += 1
      } else {
        parts.push(matchedText)
      }
      cursor = index + matchedText.length
    }

    if (cursor < line.length) parts.push(line.slice(cursor))
    return <>{parts}</>
  }

  const parts: ReactNode[] = []
  const lines = text.split('\n')
  lines.forEach((line, index) => {
    parts.push(linkifyLine(line, index))
    if (index < lines.length - 1) parts.push('\n')
  })
  return <>{parts}</>
}
