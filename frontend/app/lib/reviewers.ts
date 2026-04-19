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
    bio: 'The PillSeek editorial and engineering team curates content sourced directly from FDA NDC Directory, DailyMed, and RxNorm. All pill identification data is pulled verbatim from government sources — we do not author drug content.',
    url: '/about#editorial-team',
  },
]

export const DEFAULT_REVIEWER = REVIEWERS[0]
