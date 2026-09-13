/** "What's missing?" tags a reviewer can leave on an unpublished pill. */
export const MISSING_OPTIONS = [
  { key: 'images', label: 'Images' },
  { key: 'meds_use', label: 'Meds use' },
  { key: 'imprint', label: 'Imprint' },
  { key: 'other', label: 'Other' },
] as const

export type MissingKey = (typeof MISSING_OPTIONS)[number]['key']

export interface ReviewFlags {
  missing: string[]
  note: string | null
  flagged_by: string | null
  flagged_at: string | null
}

export function missingLabel(key: string): string {
  return MISSING_OPTIONS.find((o) => o.key === key)?.label ?? key
}
