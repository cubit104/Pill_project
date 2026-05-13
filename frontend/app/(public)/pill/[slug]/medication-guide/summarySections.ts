type SummarySections = {
  overview?: string | null
  uses?: string | null
  dosage?: string | null
  how_to_take?: string | null
  side_effects?: string | null
  warnings?: string | null
  interactions?: string | null
  contraindications?: string | null
  special_populations?: string | null
  overdose?: string | null
  storage?: string | null
  pharmacology?: string | null
  manufacturer?: string | null
}

const SUMMARY_SECTION_KEYS: Array<keyof SummarySections> = [
  'overview',
  'uses',
  'dosage',
  'how_to_take',
  'side_effects',
  'warnings',
  'interactions',
  'contraindications',
  'special_populations',
  'overdose',
  'storage',
  'pharmacology',
  'manufacturer',
]

export function hasSummarySections(sections?: SummarySections | null): boolean {
  return SUMMARY_SECTION_KEYS.some((key) => Boolean(sections?.[key]?.trim()))
}
