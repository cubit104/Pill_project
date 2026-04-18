import type { PillDetail } from '../types'

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://idmypills.com'
).replace(/\/$/, '')
const SITE_NAME = 'IDMyPills'

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
    sameAs: [],
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: 'contact@idmypills.com',
      availableLanguage: 'English',
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

export function medicalWebPageSchema(pill: PillDetail, slug: string) {
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

  return {
    '@context': 'https://schema.org',
    '@type': 'MedicalWebPage',
    name,
    description,
    url: `${SITE_URL}/pill/${encodeURIComponent(slug)}`,
    about: {
      '@type': 'Drug',
      name: pill.drug_name,
      ...(pill.dosage_form && { dosageForm: pill.dosage_form }),
      ...(pill.ingredients && { activeIngredient: pill.ingredients }),
      ...(pill.manufacturer && {
        manufacturer: {
          '@type': 'Organization',
          name: pill.manufacturer,
        },
      }),
    },
    audience: {
      '@type': 'Patient',
    },
    medicalAudience: {
      '@type': 'MedicalAudience',
      audienceType: 'Patient',
    },
  }
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
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: opts.name,
    description: opts.description,
    url: opts.url.startsWith('http') ? opts.url : `${SITE_URL}${opts.url}`,
    isPartOf: {
      '@type': 'WebSite',
      name: SITE_NAME,
      url: SITE_URL,
    },
  }
}
