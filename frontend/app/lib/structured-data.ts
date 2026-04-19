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
    dateModified?: string   // ISO 8601
    reviewer?: Reviewer
  }
) {
  const nameParts = [
    pill.color,
    pill.shape,
    pill.drug_name,
    pill.strength,
  ].filter(Boolean)
  const name = nameParts.join(' ')

  // Build parenthetical safely so parentheses are always balanced
  const colorShape =
    pill.color && pill.shape
      ? `(${pill.color} ${pill.shape})`
      : pill.color
        ? `(${pill.color})`
        : pill.shape
          ? `(${pill.shape})`
          : null

  const description = [
    `Pill identification page for ${pill.drug_name}`,
    pill.imprint ? `with imprint ${pill.imprint}` : null,
    colorShape,
  ]
    .filter(Boolean)
    .join(' ')

  const fallbackDate = new Date().toISOString()

  return stripUndefined({
    '@context': 'https://schema.org' as const,
    '@type': 'MedicalWebPage' as const,
    name,
    description,
    url: `${SITE_URL}/pill/${encodeURIComponent(slug)}`,
    inLanguage: 'en-US',
    isPartOf: { '@type': 'WebSite' as const, name: SITE_NAME, url: SITE_URL },
    datePublished: opts?.datePublished,
    dateModified: opts?.dateModified ?? fallbackDate,
    lastReviewed: opts?.dateModified ?? fallbackDate,
    reviewedBy: opts?.reviewer
      ? stripUndefined({
          '@type': 'Person' as const,
          name: opts.reviewer.name,
          jobTitle: opts.reviewer.credentials,
          url: `${SITE_URL}${opts.reviewer.url}`,
          ...(opts.reviewer.sameAs && opts.reviewer.sameAs.length > 0
            ? { sameAs: opts.reviewer.sameAs }
            : {}),
        })
      : undefined,
    about: {
      '@type': 'Drug' as const,
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

export function faqSchema(items: Array<{ question: string; answer: string }>) {
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
