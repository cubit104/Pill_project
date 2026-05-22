import Link from 'next/link'

const API_BASE = (process.env.API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '')

/**
 * Minimum total views across all pills before showing the section.
 * Override with NEXT_PUBLIC_TRENDING_MIN_VIEWS env var (e.g. set to 0 on
 * preview deployments to verify the layout without waiting for organic traffic).
 * Defaults to 50 to avoid showing a "dead" list with only a handful of views.
 */
const MIN_TOTAL_VIEWS = (() => {
  const raw = process.env.NEXT_PUBLIC_TRENDING_MIN_VIEWS
  if (raw !== undefined && raw !== '') {
    const parsed = parseInt(raw, 10)
    if (Number.isFinite(parsed) && parsed >= 0) return parsed
  }
  return 50
})()

interface TrendingPill {
  slug: string
  drug_name?: string | null
  strength?: string | null
  color?: string | null
  shape?: string | null
  view_count: number
  rank: number
}

interface TrendingResponse {
  pills?: TrendingPill[]
}

function fallbackName(slug: string) {
  const parts = slug.split('-')
  const cutoff = parts.findIndex((part) => /\d/.test(part))
  const nameParts = cutoff > 0 ? parts.slice(0, cutoff) : parts
  return nameParts.join(' ')
}

type TrendingLabelInput = Pick<TrendingPill, 'slug' | 'drug_name' | 'strength'>

function titleCasePreservingAcronyms(value: string) {
  return value
    .split(/(\s+|\/|-)/)
    .map((token) => {
      if (/^\s+$/.test(token) || token === '/' || token === '-') return token
      if (/^[A-Z0-9]{1,4}$/.test(token)) return token
      const lower = token.toLowerCase()
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join('')
}

function normalizeUnit(unit?: string | null) {
  return unit ? unit.toLowerCase() : ''
}

function parseDoseParts(value: string) {
  const parts = Array.from(
    value.matchAll(/(\d+(?:\.\d+)?)\s*(mg|mcg|ml|g|units?)?/gi),
    (match) => ({
      amount: match[1],
      unit: normalizeUnit(match[2]),
    })
  )

  return parts
}

function formatDoseParts(
  parts: Array<{ amount: string; unit: string }>,
  collapseSharedUnit: boolean
) {
  if (!parts.length) return ''
  const units = [...new Set(parts.map((part) => part.unit).filter(Boolean))]

  if (collapseSharedUnit && units.length === 1) {
    return `${parts.map((part) => part.amount).join('/')}${units[0] ? ` ${units[0]}` : ''}`.trim()
  }

  return parts.map((part) => `${part.amount}${part.unit ? ` ${part.unit}` : ''}`.trim()).join('/')
}

function extractIngredientName(segment: string) {
  return segment.split(/\d/, 1)[0]?.trim() ?? ''
}

function normalizeIngredient(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function isLikelyComboName(value: string) {
  return /\/|\b(and|with)\b/i.test(value)
}

function buildComboDose(strengthSegments: string[]) {
  const doseByBaseIngredient = new Map<string, { amount: string; unit: string; numeric: number }>()

  for (const segment of strengthSegments) {
    const dose = parseDoseParts(segment)[0]
    if (!dose) continue

    const ingredient = extractIngredientName(segment)
    const baseIngredient = normalizeIngredient(ingredient).split(' ')[0] || segment.toLowerCase()
    const numericAmount = Number.parseFloat(dose.amount)
    const existing = doseByBaseIngredient.get(baseIngredient)

    if (!existing || (!Number.isNaN(numericAmount) && numericAmount > existing.numeric)) {
      doseByBaseIngredient.set(baseIngredient, {
        amount: dose.amount,
        unit: dose.unit,
        numeric: Number.isNaN(numericAmount) ? 0 : numericAmount,
      })
    }
  }

  const compactDoses = Array.from(doseByBaseIngredient.values()).map(({ amount, unit }) => ({
    amount,
    unit,
  }))

  return formatDoseParts(compactDoses, true)
}

function formatStrengthDose(pill: TrendingLabelInput) {
  const strength = pill.strength?.trim()
  if (!strength) return ''

  const segments = strength
    .split(';')
    .map((segment) => segment.trim())
    .filter(Boolean)

  if (!segments.length) return ''

  if (segments.length === 1) {
    // Keep explicit units in each part for slash strengths, e.g. 1000 mg/62.5 mg.
    return formatDoseParts(parseDoseParts(segments[0]), false)
  }

  const drugName = pill.drug_name?.trim() ?? ''
  if (drugName && !isLikelyComboName(drugName)) {
    const normalizedDrugName = normalizeIngredient(drugName)
    const matchingSegment = segments.find((segment) => {
      const normalizedIngredient = normalizeIngredient(extractIngredientName(segment))
      return (
        normalizedIngredient === normalizedDrugName ||
        normalizedIngredient.startsWith(normalizedDrugName) ||
        normalizedDrugName.startsWith(normalizedIngredient)
      )
    })

    if (matchingSegment) {
      return formatDoseParts(parseDoseParts(matchingSegment), false)
    }
  }

  return buildComboDose(segments)
}

function formatComboDrugName(drugName: string) {
  if (!/\band\b/i.test(drugName)) return titleCasePreservingAcronyms(drugName)

  const words = drugName.split(/\s+/)
  const andIndex = words.findIndex((word) => word.toLowerCase() === 'and')
  if (andIndex <= 0 || andIndex >= words.length - 1) {
    return titleCasePreservingAcronyms(drugName)
  }

  const left = words.slice(0, andIndex)[0]
  const right = words.slice(andIndex + 1)[0]
  if (!left || !right) return titleCasePreservingAcronyms(drugName)

  return `${titleCasePreservingAcronyms(left)}/${titleCasePreservingAcronyms(right)}`
}

export function formatTrendingLabel(pill: TrendingLabelInput) {
  const rawName = (pill.drug_name && pill.drug_name.trim()) || fallbackName(pill.slug)
  const name = formatComboDrugName(rawName)
  const dose = formatStrengthDose(pill)
  return dose ? `${name} ${dose}`.replace(/[;,\s]+$/g, '') : name.replace(/[;,\s]+$/g, '')
}

function formatAttributeValue(value?: string | null) {
  if (!value) return ''
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function getColorDotClass(color?: string | null) {
  switch ((color ?? '').trim().toUpperCase()) {
    case 'WHITE':
      return 'bg-white border border-slate-300'
    case 'YELLOW':
      return 'bg-yellow-300'
    case 'PINK':
      return 'bg-pink-300'
    case 'BLUE':
      return 'bg-blue-400'
    case 'GREEN':
      return 'bg-green-400'
    case 'RED':
      return 'bg-red-400'
    case 'ORANGE':
      return 'bg-orange-400'
    case 'BROWN':
      return 'bg-amber-700'
    case 'PURPLE':
      return 'bg-purple-400'
    case 'BLACK':
      return 'bg-slate-900'
    case 'GRAY':
    case 'GREY':
      return 'bg-slate-400'
    default:
      return 'bg-slate-300'
  }
}

function getRankBadgeClass(rank: number) {
  if (rank === 1) return 'bg-gradient-to-br from-amber-300 to-amber-500 text-amber-950'
  if (rank === 2) return 'bg-gradient-to-br from-slate-300 to-slate-400 text-slate-900'
  if (rank === 3) return 'bg-gradient-to-br from-orange-300 to-orange-500 text-orange-950'
  return 'bg-emerald-50 text-emerald-700'
}

export default async function TrendingPills() {
  let pills: TrendingPill[] = []

  try {
    const response = await fetch(`${API_BASE}/api/trending?limit=20&days=7`, {
      next: { revalidate: 600 },
    })
    if (response.ok) {
      const payload = (await response.json()) as TrendingResponse
      pills = Array.isArray(payload.pills) ? payload.pills : []
    }
  } catch {
    return null
  }

  if (!pills.length) {
    return null
  }

  // Hide the entire section when total views are too low (looks dead)
  const totalViews = pills.reduce((sum, p) => sum + (p.view_count ?? 0), 0)
  if (totalViews < MIN_TOTAL_VIEWS) {
    return null
  }

  return (
    <section className="border-t border-emerald-100 bg-gradient-to-b from-emerald-50/60 via-white to-white px-4 py-10">
      <div className="max-w-6xl mx-auto">
        <div className="mb-5 flex flex-col items-center gap-2 text-center">
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
            🔥 Hot now
          </span>
          <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">Trending This Week</h2>
          <p className="text-xs text-slate-500">Real searches from PillSeek users · Updated every 10 minutes</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {pills.map((pill) => {
            const label = formatTrendingLabel(pill)
            const colorText = formatAttributeValue(pill.color)
            const shapeText = formatAttributeValue(pill.shape)
            const attributes = [colorText, shapeText].filter(Boolean).join(' · ')

            return (
              <Link
                key={pill.slug}
                href={`/pill/${pill.slug}`}
                className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-3 transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ${getRankBadgeClass(
                    pill.rank
                  )}`}
                  aria-label={`Rank ${pill.rank}`}
                >
                  {pill.rank}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold leading-tight text-slate-900">{label}</p>
                  {attributes ? (
                    <p className="mt-0.5 flex items-center gap-1 text-xs tracking-wide text-slate-400">
                      {colorText ? (
                        <span className={`inline-block h-2 w-2 rounded-full ${getColorDotClass(pill.color)}`} />
                      ) : null}
                      <span>{attributes}</span>
                    </p>
                  ) : null}
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </section>
  )
}
