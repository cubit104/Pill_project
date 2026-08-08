/**
 * Reviewer registry for PillSeek E-E-A-T signals.
 *
 * IMPORTANT: Do NOT add fake named pharmacists, MDs, or other credentialed
 * individuals here. Fabricating reviewers on a medical site constitutes
 * misinformation and can trigger a Google manual action. Use the honest
 * "Editorial Team" placeholder below and replace it with a real, named,
 * licensed reviewer (PharmD / MD) once one has been hired and contracted.
 */

export interface Reviewer {
  id: string
  name: string
  credentials: string  // e.g. "PharmD, RPh" or "MD, Internal Medicine"
  role: 'author' | 'medical_reviewer' | 'editor'
  /**
   * Schema.org @type for the reviewedBy node. Use 'Organization' for team
   * entries and 'Person' for individually named reviewers.
   */
  schemaType: 'Person' | 'Organization'
  bio: string
  url: string          // /about#reviewer-{id} until individual pages exist
  sameAs?: string[]    // LinkedIn, ORCID, etc. — leave empty until accounts exist
}

export const REVIEWERS: Reviewer[] = [
  {
    id: 'pillseek-editorial',
    name: 'PillSeek Editorial Team',
    credentials: 'Editorial & Engineering',
    role: 'editor',
    schemaType: 'Organization',
    bio: 'The PillSeek editorial and engineering team curates content sourced directly from FDA NDC Directory, DailyMed, and RxNorm. All pill identification data is pulled verbatim from government sources — we do not author drug content.',
    url: '/about#editorial-team',
  },
]

export const DEFAULT_REVIEWER = REVIEWERS[0]

// ---------------------------------------------------------------------------
// DB-backed public reviewer types & fetch helpers
// ---------------------------------------------------------------------------

export interface PublicReviewer {
  id: string
  slug: string
  full_name: string
  credentials: string | null
  role: string | null
  specialty: string | null
  bio: string | null
  photo_url: string | null
  linkedin_url: string | null
  education: Array<{ degree?: string; institution?: string; location?: string; year?: string }> | null
  certifications: Array<{ title?: string; issuer?: string; year?: string }> | null
  affiliations: Array<{ organization?: string }> | null
  special_interests: string[] | null
  joined_at: string | null
  left_at: string | null
  created_at: string | null
  updated_at: string | null
}

export async function fetchPublicReviewers(apiBase: string): Promise<PublicReviewer[]> {
  try {
    const res = await fetch(`${apiBase}/api/editorial-team`, { cache: 'no-store' })
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}

export async function fetchPublicReviewer(apiBase: string, slug: string): Promise<PublicReviewer | null> {
  try {
    const res = await fetch(`${apiBase}/api/editorial-team/${slug}`, { cache: 'no-store' })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}
