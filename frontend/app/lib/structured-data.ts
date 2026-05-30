import type { PillDetail } from '../types'
import type { Reviewer } from './reviewers'

/** Remove undefined values from an object so JSON-LD stays clean. */
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as Partial<T>
}

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com'
).replace(/\/$/, '')
const SITE_NAME = 'PillSeek'

/**
 * Safely serialize an object to a JSON-LD string, escaping characters that
 * could break out of a `<script>` tag (e.g., `</script>`).
 * This prevents XSS when injecting structured data via dangerouslySetInnerHTML.
 */
export function safeJsonLd(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, '\\u003c')
}

/**
 * Build a 2-sentence identification summary from real DB fields.
 * Used as: visible paragraph, meta description, and JSON-LD description.
 * Any missing field is silently omitted — never renders "undefined" or empty parens.
 */
export function buildIdentificationSummary(pill: PillDetail): string {
  const physical = [pill.color, pill.shape].filter(Boolean).join(' ')
  // Determine article based on the first character of the first word that will appear
  // in the sentence. Only matters when physical is non-empty.
  const article = physical && physical.length > 0
    ? ('aeiou'.includes(physical[0].toLowerCase()) ? 'an' : 'a')
    : 'a'

  const s1Base = physical
    ? `This is ${article} ${physical} pill`
    : 'This pill'

  const s1Imprint = pill.imprint ? ` with imprint ${pill.imprint}` : ''
  const s1Drug = pill.drug_name && pill.drug_name !== 'Unknown'
    ? `, identified as ${pill.drug_name}${pill.strength ? ` ${pill.strength}` : ''}`
    : ''
  const s1Mfr = pill.manufacturer ? ` manufactured by ${pill.manufacturer}` : ''

  const sentence1 = `${s1Base}${s1Imprint}${s1Drug}${s1Mfr}.`

  const s2Parts: string[] = []
  if (pill.dosage_form) s2Parts.push(`supplied as ${pill.dosage_form}`)
  if (pill.ndc) s2Parts.push(`distributed under NDC ${pill.ndc}`)

  const sentence2 = s2Parts.length > 0 ? `It is ${s2Parts.join(' and ')}.` : ''

  return [sentence1, sentence2].filter(Boolean).join(' ')
}

export function websiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/search?q={search_term_string}&type=imprint`,
      },
      'query-input': 'required name=search_term_string',
    },
  }
}

export function organizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    logo: {
      '@type': 'ImageObject',
      url: `${SITE_URL}/icon.png`,
    },
    description: 'PillSeek is a free pill identification service powered by FDA NDC Directory, DailyMed, and RxNorm data.',
    foundingDate: '2025',
    // Leave sameAs empty until official social accounts are created
    sameAs: [],
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: 'contact@pillseek.com',
      availableLanguage: ['English'],
      url: `${SITE_URL}/contact`,
    },
  }
}

export function breadcrumbSchema(
  items: Array<{ name: string; url: string }>
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url.startsWith('http')
        ? item.url
        : `${SITE_URL}${item.url}`,
    })),
  }
}

export function medicalWebPageSchema(
  pill: PillDetail,
  slug: string,
  opts?: {
    datePublished?: string  // ISO 8601
    dateModified?: string   // ISO 8601 — must be a real timestamp; do NOT pass new Date().toISOString()
    reviewer?: Reviewer
    description?: string    // pre-built identification summary; falls back to basic description
  }
) {
  const nameParts = [
    pill.color,
    pill.shape,
    pill.drug_name,
    pill.strength,
  ].filter(Boolean)
  const name = nameParts.join(' ')

  // Use the identification summary if provided; otherwise build a minimal fallback.
  const description = opts?.description ?? buildIdentificationSummary(pill)

  return stripUndefined({
    '@context': 'https://schema.org' as const,
    '@type': 'MedicalWebPage' as const,
    name,
    description,
    url: `${SITE_URL}/pill/${encodeURIComponent(slug)}`,
    inLanguage: 'en-US',
    isPartOf: { '@type': 'WebSite' as const, name: SITE_NAME, url: SITE_URL },
    datePublished: opts?.datePublished,
    // Only set dateModified / lastReviewed when we have a real timestamp.
    // Never pass new Date().toISOString() here — Google penalises fake freshness.
    dateModified: opts?.dateModified,
    lastReviewed: opts?.dateModified,
    reviewedBy: opts?.reviewer
      ? stripUndefined({
          '@type': opts.reviewer.schemaType,
          name: opts.reviewer.name,
          jobTitle: opts.reviewer.credentials,
          url: `${SITE_URL}${opts.reviewer.url}`,
          ...(opts.reviewer.sameAs && opts.reviewer.sameAs.length > 0
            ? { sameAs: opts.reviewer.sameAs }
            : {}),
        })
      : undefined,
    about: {
      '@type': 'MedicalEntity' as const,
      additionalType: 'https://schema.org/Drug',
      name: pill.drug_name,
      ...(pill.dosage_form && { dosageForm: pill.dosage_form }),
      ...(pill.ingredients && { activeIngredient: pill.ingredients }),
      ...(pill.manufacturer && {
        manufacturer: {
          '@type': 'Organization' as const,
          name: pill.manufacturer,
        },
      }),
    },
    audience: {
      '@type': 'Patient' as const,
    },
    medicalAudience: {
      '@type': 'MedicalAudience' as const,
      audienceType: 'Patient',
    },
    publisher: {
      '@type': 'Organization' as const,
      name: SITE_NAME,
      url: SITE_URL,
      logo: { '@type': 'ImageObject' as const, url: `${SITE_URL}/icon.png` },
    },
  })
}

/**
 * Build structured data for medication guide or professional information pages.
 * Includes MedicalWebPage + Drug identifier block.
 */
export function guidePageSchema(opts: {
  drugName: string
  slug: string
  pageType: 'medication-guide' | 'professional-information' | 'medication-summary' | 'dosage'
  rxcui?: string | null
  ndc?: string | null
  splSetId?: string | null
  genericName?: string | null
  brandName?: string | null
  fetchedAt?: string | null
}) {
  const { drugName, slug, pageType, rxcui, ndc, splSetId, genericName, brandName, fetchedAt } = opts

  const pagePath = pageType === 'medication-guide'
    ? `/pill/${encodeURIComponent(slug)}/medication-guide`
    : pageType === 'professional-information'
      ? `/pill/${encodeURIComponent(slug)}/professional-information`
      : pageType === 'dosage'
        ? `/pill/${encodeURIComponent(slug)}/dosage`
        : `/pill/${encodeURIComponent(slug)}/medication-summary`

  const pageName = pageType === 'medication-guide'
    ? `${drugName} Medication Guide`
    : pageType === 'professional-information'
      ? `${drugName} Professional Information`
      : pageType === 'dosage'
        ? `${drugName} Dosage & Administration`
        : `${drugName} Medication Summary`

  const audience = pageType === 'professional-information'
    ? { '@type': 'MedicalAudience' as const, audienceType: 'Clinician' }
    : { '@type': 'Patient' as const }

  type PropertyValue = { '@type': 'PropertyValue'; name: string; value: string }
  const identifier: PropertyValue[] = []
  if (rxcui?.trim()) identifier.push({ '@type': 'PropertyValue', name: 'RxCUI', value: rxcui.trim() })
  if (ndc?.trim()) identifier.push({ '@type': 'PropertyValue', name: 'NDC', value: ndc.trim() })
  if (splSetId?.trim()) identifier.push({ '@type': 'PropertyValue', name: 'SPL Set ID', value: splSetId.trim() })

  const about: Record<string, unknown> = { '@type': 'MedicalEntity', name: drugName }
  // MedicalEntity does not support `nonProprietaryName`; map generic and brand names to `alternateName`.
  const alternateNames: string[] = []
  if (genericName?.trim()) alternateNames.push(genericName.trim())
  if (brandName?.trim() && brandName.trim() !== genericName?.trim()) alternateNames.push(brandName.trim())
  if (alternateNames.length === 1) about['alternateName'] = alternateNames[0]
  else if (alternateNames.length > 1) about['alternateName'] = alternateNames
  if (identifier.length > 0) about['identifier'] = identifier

  return stripUndefined({
    '@context': 'https://schema.org' as const,
    '@type': 'MedicalWebPage' as const,
    name: pageName,
    url: `${SITE_URL}${pagePath}`,
    inLanguage: 'en-US',
    isPartOf: { '@type': 'WebSite' as const, name: SITE_NAME, url: SITE_URL },
    about,
    audience,
    dateModified: fetchedAt ?? undefined,
    lastReviewed: fetchedAt ?? undefined,
    publisher: {
      '@type': 'Organization' as const,
      name: SITE_NAME,
      url: SITE_URL,
      logo: { '@type': 'ImageObject' as const, url: `${SITE_URL}/icon.png` },
    },
  })
}

export function faqSchema(
  items: ReadonlyArray<{ readonly question: string; readonly answer: string }>
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  }
}

export function hubPageSchema(opts: {
  name: string
  description: string
  url: string
  dateModified?: string
}) {
  return stripUndefined({
    '@context': 'https://schema.org' as const,
    '@type': 'CollectionPage' as const,
    name: opts.name,
    description: opts.description,
    url: opts.url.startsWith('http') ? opts.url : `${SITE_URL}${opts.url}`,
    dateModified: opts.dateModified,
    isPartOf: {
      '@type': 'WebSite' as const,
      name: SITE_NAME,
      url: SITE_URL,
    },
  })
}

function buildImageDescription(pill: PillDetail): string {
  const imageAltText = pill.image_alt_text?.trim()
  if (imageAltText) return imageAltText

  const parts = [pill.color, pill.shape, pill.drug_name, pill.strength]
    .map((part) => (typeof part === 'string' ? part.trim() : part))
    .filter((part): part is string => Boolean(part))

  if (pill.imprint?.trim()) {
    parts.push(`pill imprinted ${pill.imprint.trim()}`)
  } else {
    parts.push('pill')
  }

  // Normalize any accidental double spaces from upstream data formatting.
  const combined = parts.join(' ').replace(/\s+/g, ' ').trim()
  return combined || buildIdentificationSummary(pill)
}

export function imageObjectSchema(
  pill: PillDetail,
  imageUrls: string[]
) {
  if (!Array.isArray(imageUrls) || imageUrls.length === 0) return null

  const imageDescription = buildImageDescription(pill)

  const schemas = imageUrls.map((imageUrl, index) =>
    stripUndefined({
      '@context': 'https://schema.org' as const,
      '@type': 'ImageObject' as const,
      contentUrl: imageUrl,
      url: imageUrl,
      caption: imageDescription,
      name: imageDescription,
      ...(index === 0 ? { representativeOfPage: true as const } : {}),
    })
  )

  return schemas.length === 1 ? schemas[0] : schemas
}
