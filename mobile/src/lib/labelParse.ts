/**
 * Pharmacy label parser: turns OCR lines from a prescription bottle into the
 * fields the cabinet needs. Pure text rules, no network, unit-tested.
 *
 * US labels are required to show: pharmacy name/phone, Rx number, patient,
 * drug name + strength, directions ("SIG"), quantity, fill date, refills,
 * prescriber. Layout varies by chain, so every rule is a tolerant pattern and
 * anything unmatched simply stays empty for the user to fill in.
 */

export interface OcrLine {
  text: string
  /** 0–1, top of the image = 0. Used only to keep reading order. */
  y?: number
  confidence?: number
}

export interface ParsedLabel {
  /** Drug name as printed, e.g. "ATORVASTATIN" or "Lipitor". */
  drugName: string | null
  /** Strength as printed, e.g. "20 MG". */
  strength: string | null
  /** Dosage form if printed, e.g. "TABLET", "CAPSULE". */
  form: string | null
  /** The directions sentence, e.g. "TAKE 1 TABLET BY MOUTH TWICE DAILY". */
  directions: string | null
  /** Pill count dispensed. */
  quantity: number | null
  rxNumber: string | null
  refills: number | null
  fillDate: string | null
  pharmacyName: string | null
  pharmacyPhone: string | null
  prescriber: string | null
}

const FORMS = ['TABLET', 'TAB', 'TABS', 'CAPSULE', 'CAP', 'CAPS', 'SOFTGEL', 'ER', 'XR', 'SR', 'DR', 'ODT', 'CHEWABLE', 'SOLUTION', 'SUSPENSION', 'INHALER', 'PATCH']
const STRENGTH_RE = /(\d+(?:[.,]\d+)?(?:-\d+(?:[.,]\d+)?)?)\s*(MG|MCG|G|ML|MEQ|IU|UNITS?|%)(?:\s*\/\s*(\d+(?:[.,]\d+)?)\s*(MG|MCG|ML))?/i
const SIG_START = /^(TAKE|APPLY|USE|INSTILL|INHALE|CHEW|PLACE|INJECT|GIVE|DISSOLVE|SWALLOW)\b/i
const NOISE = /^(PATIENT|DR\.?|MD|DOB|DATE OF BIRTH|DISCARD|EXP|CAUTION|FEDERAL|WARNING|KEEP|STORE|GENERIC FOR|MFR|MFG|NDC|LOT|NO REFILLS|QTY)/i

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** Chain names we recognise; anything else falls back to the first line that looks like a business name with a phone. */
const PHARMACIES = ['CVS', 'WALGREENS', 'WALMART', 'RITE AID', 'KROGER', 'PUBLIX', 'COSTCO', 'SAFEWAY', 'H-E-B', 'HEB', 'MEIJER', 'TARGET', 'SAM\'S CLUB', 'DUANE READE', 'WEGMANS', 'GIANT', 'STOP & SHOP', 'ALBERTSONS', 'HY-VEE', 'FRED MEYER', 'EXPRESS SCRIPTS', 'OPTUMRX', 'AMAZON PHARMACY', 'PHARMACY']

export function parseLabel(input: OcrLine[] | string[]): ParsedLabel {
  const lines = (input as Array<OcrLine | string>)
    .map((l) => (typeof l === 'string' ? { text: l } : l))
    .map((l) => ({ ...l, text: clean(l.text) }))
    .filter((l) => l.text.length > 0)
    .sort((a, b) => (a.y ?? 0) - (b.y ?? 0))
  const texts = lines.map((l) => l.text)
  const upper = texts.map((t) => t.toUpperCase())
  const all = upper.join('\n')

  const out: ParsedLabel = {
    drugName: null,
    strength: null,
    form: null,
    directions: null,
    quantity: null,
    rxNumber: null,
    refills: null,
    fillDate: null,
    pharmacyName: null,
    pharmacyPhone: null,
    prescriber: null,
  }

  // Rx number: "RX# 1234567", "RX 1234567-01", "Rx No. 1234567", "#1234567" near "RX".
  // OCR turns 'Rx#' into 'Rx*', 'Rx:' or 'Rx.'; accept any short junk between RX and the digits.
  const rx = /\bRX\s*(?:NO\.?|NUMBER)?[^A-Z0-9\n]{0,4}(\d{5,12}(?:-\d{1,3})?)/i.exec(all)
  if (rx) out.rxNumber = rx[1] ?? null

  // Quantity: "QTY: 30", "QTY 30 TABS", "QUANTITY: 90", "#30".
  const qty = /(?:QTY|QUANTITY)\s*[:#.]?\s*(\d{1,4})\b/i.exec(all) ?? /(?:^|\n)\s*#\s*(\d{1,4})\b/.exec(all)
  if (qty) out.quantity = parseInt(qty[1] ?? '', 10) || null

  // Refills: "REFILLS: 2", "2 REFILLS", "NO REFILLS", "REFILLS REMAINING 3", "RF 2".
  const rf = /(?:REFILLS?(?:\s+REMAINING|\s+LEFT)?|RF)\s*[:#.]?\s*(\d{1,2})\b/i.exec(all) ?? /(\d{1,2})\s+REFILLS?\b/i.exec(all)
  if (rf) out.refills = parseInt(rf[1] ?? '', 10)
  else if (/NO\s+REFILLS/i.test(all)) out.refills = 0

  // Fill date: "FILLED: 09/02/2026", "DATE FILLED 09/02/26", "FILL DATE: 2026-09-02".
  const date = /(?:FILLED|FILL DATE|DATE FILLED|DATE|FILLED ON)\s*[:#.]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i.exec(all)
  if (date) out.fillDate = date[1] ?? null

  // Phone: first US phone number on the label is nearly always the pharmacy's.
  const phone = /\(?\b(\d{3})\)?[\s.-]?(\d{3})[\s.-](\d{4})\b/.exec(all)
  if (phone) out.pharmacyPhone = `${phone[1]}-${phone[2]}-${phone[3]}`

  // Pharmacy: a known chain name anywhere; else the first line containing "PHARMACY".
  for (const name of PHARMACIES) {
    const idx = upper.findIndex((t) => t.includes(name))
    if (idx >= 0) {
      const line = texts[idx] ?? ''
      // Short chain names stay as printed (CVS, HEB); longer ones read better in title case.
      out.pharmacyName = name === 'PHARMACY' ? clean(line.replace(/\d[\d\s().-]{6,}/g, '')) : name.length <= 4 ? name : titleCase(name)
      break
    }
  }

  // Prescriber: "DR. JANE SMITH", "PRESCRIBER: J SMITH MD", "SMITH, JANE MD".
  const doc = /(?:DR\.?|PRESCRIBER|PRESCRIBED BY|PHYSICIAN|PROVIDER)\s*[:#.]?\s*([A-Z][A-Z .,'-]{3,40}?)(?=\s*(?:MD|DO|NP|PA|DDS|\n|$))/i.exec(all) ?? /\n([A-Z][A-Z' -]{2,30},\s*[A-Z][A-Z' -]{2,30})\s+(?:MD|DO|NP|PA)\b/i.exec(all)
  if (doc) out.prescriber = titleCase(clean(doc[1] ?? ''))

  // Directions: the line starting with an action verb, plus the following line when it continues the sentence.
  const sigIdx = upper.findIndex((t) => SIG_START.test(t))
  if (sigIdx >= 0) {
    let sig = texts[sigIdx] ?? ''
    const next = texts[sigIdx + 1]
    const continues = next !== undefined && (/^[a-z(]/.test(next) || /^(DAILY|TWICE|EVERY|AT|WITH|FOR|AS|IN THE|ONCE|THREE|TIMES|BEFORE|AFTER|BY MOUTH|ORALLY)\b/i.test(next))
    if (next && continues && !NOISE.test(next) && !STRENGTH_RE.test(next) && !/RX|QTY|REFILL|DATE|PHONE|\d{3}[-.]\d{4}/i.test(next)) {
      sig = `${sig} ${next}`
    }
    out.directions = clean(sig)
  }

  // Drug line: the first line with a strength that is not the directions and not noise.
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i] ?? ''
    const u = upper[i] ?? ''
    if (i === sigIdx || NOISE.test(u) || /^(QTY|RX|REFILL|GENERIC)/i.test(u)) continue
    const m = STRENGTH_RE.exec(t)
    if (!m) continue
    const strength = `${m[1]} ${(m[2] ?? '').toUpperCase()}${m[3] ? `/${m[3]} ${(m[4] ?? '').toUpperCase()}` : ''}`.replace(',', '.')
    let name = clean(t.slice(0, m.index))
    // "LISINOPRIL 10 MG TAB" → name before the strength; form after it.
    const after = clean(t.slice(m.index + m[0].length)).toUpperCase()
    const form = FORMS.find((f) => new RegExp(`\\b${f}\\b`).test(after)) ?? null
    // Name may sit on the previous line ("ATORVASTATIN CALCIUM" / "20 MG TABLET").
    if (!name && i > 0 && !NOISE.test(upper[i - 1] ?? '') && (i - 1) !== sigIdx) name = texts[i - 1] ?? ''
    name = name.replace(/\b(GENERIC FOR|GENERIC EQUIVALENT (TO|FOR))\b.*$/i, '').replace(/[:*]+$/, '').trim()
    if (name) {
      out.drugName = titleCase(name)
      out.strength = strength.replace(/\.0(?=\s)/, '')
      out.form = form ? normaliseForm(form) : null
      break
    }
  }

  return out
}

function normaliseForm(f: string): string {
  if (/^(TAB|TABS|TABLET)$/.test(f)) return 'tablet'
  if (/^(CAP|CAPS|CAPSULE)$/.test(f)) return 'capsule'
  return f.toLowerCase()
}

// ---- Pharmacy shorthand -----------------------------------------------------------

/** Abbreviations pharmacies print on labels, longest first so "K CLAV" wins over "CLAV". */
const SHORTHAND: Array<[RegExp, string]> = [
  [/\bAMOX\s*\/?\s*K\s*CLAV\b/i, 'amoxicillin clavulanate'],
  [/\bAMOX[\/-]?CLAV\b/i, 'amoxicillin clavulanate'],
  [/\bK\s*CLAV\b/i, 'clavulanate'],
  [/\bAMOX\b/i, 'amoxicillin'],
  [/\bSMZ\s*[\/-]?\s*TMP\b/i, 'sulfamethoxazole trimethoprim'],
  [/\bSMX\s*[\/-]?\s*TMP\b/i, 'sulfamethoxazole trimethoprim'],
  [/\bHCTZ\b/i, 'hydrochlorothiazide'],
  [/\bHYDROCO(?:D)?\s*[\/-]?\s*APAP\b/i, 'hydrocodone acetaminophen'],
  [/\bOXYCO(?:D)?\s*[\/-]?\s*APAP\b/i, 'oxycodone acetaminophen'],
  [/\bAPAP\b/i, 'acetaminophen'],
  [/\bMTX\b/i, 'methotrexate'],
  [/\bASA\b/i, 'aspirin'],
  [/\bPCN\b/i, 'penicillin'],
  [/\bAZITHRO\b/i, 'azithromycin'],
  [/\bCIPRO\b/i, 'ciprofloxacin'],
  [/\bDOXY\b/i, 'doxycycline'],
  [/\bMETFORM\b/i, 'metformin'],
  [/\bATORVA\b/i, 'atorvastatin'],
  [/\bLISINO\b/i, 'lisinopril'],
  [/\bLEVOTHYROX\b/i, 'levothyroxine'],
  [/\bOMEP\b/i, 'omeprazole'],
  [/\bPREDNIS\b/i, 'prednisone'],
  [/\bIBU\b/i, 'ibuprofen'],
  [/\bNAPROX\b/i, 'naproxen'],
  [/\bCLONAZ\b/i, 'clonazepam'],
  [/\bALPRAZ\b/i, 'alprazolam'],
  [/\bLORAZ\b/i, 'lorazepam'],
  [/\bSERTRA\b/i, 'sertraline'],
  [/\bESCITALO\b/i, 'escitalopram'],
  [/\bBUPROP\b/i, 'bupropion'],
  [/\bGABAP\b/i, 'gabapentin'],
  [/\bMONTELU\b/i, 'montelukast'],
  [/\bPANTOP\b/i, 'pantoprazole'],
  [/\bLOSART\b/i, 'losartan'],
  [/\bAMLOD\b/i, 'amlodipine'],
  [/\bMETOP\b/i, 'metoprolol'],
  [/\bCARVED\b/i, 'carvedilol'],
  [/\bFUROS\b/i, 'furosemide'],
  [/\bTAMSUL\b/i, 'tamsulosin'],
  [/\bDILT\b/i, 'diltiazem'],
  [/\bER\b|\bXR\b|\bSR\b|\bDR\b|\bCR\b|\bODT\b|\bHCL\b|\bHCT\b/i, ''],
]

/** Expand label shorthand into a name our drug lookup understands. */
export function expandShorthand(name: string): string {
  let s = ` ${name} `
  for (const [re, full] of SHORTHAND) s = s.replace(re, ` ${full} `)
  return s.replace(/[\/,;:]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Names to try in order until the lookup finds something: full, expanded, first ingredient, each word. */
export function drugNameCandidates(name: string | null | undefined): string[] {
  if (!name) return []
  const out: string[] = []
  const push = (v: string) => {
    const t = v.replace(/\s+/g, ' ').trim()
    if (t.length >= 3 && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t)
  }
  push(name)
  const expanded = expandShorthand(name)
  push(expanded)
  const first = expanded.split(' ')[0] ?? ''
  push(first)
  for (const w of expanded.split(' ')) if (w.length >= 5 && !/^\d/.test(w)) push(w)
  return out
}

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(' ')
    .map((w) => (w.length > 2 ? w[0]?.toUpperCase() + w.slice(1) : w.toUpperCase()))
    .join(' ')
    .replace(/\bMg\b/g, 'mg')
}

// ---- Directions → schedule -----------------------------------------------------

export interface SigSchedule {
  /** Local clock times, "HH:MM". Empty when the drug is "as needed". */
  times: string[]
  /** 0 = Sunday … 6 = Saturday. */
  days: number[]
  /** "1 tablet", "2 capsules", "1/2 tablet". */
  dose: string | null
  /** Pills consumed per day, for refill tracking. */
  pillsPerDay: number | null
  asNeeded: boolean
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, half: 0.5 }
const TIMES_BY_COUNT: Record<number, string[]> = {
  1: ['08:00'],
  2: ['08:00', '20:00'],
  3: ['08:00', '14:00', '20:00'],
  4: ['08:00', '12:00', '16:00', '20:00'],
}

/** Best-effort reminder schedule from the printed directions; null when nothing usable. */
export function scheduleFromSig(directions: string | null | undefined): SigSchedule | null {
  if (!directions) return null
  const s = directions.toLowerCase().replace(/\s+/g, ' ')

  // Dose: "take 1 tablet", "take one (1) capsule", "1/2 tablet", "2 tabs".
  let doseCount: number | null = null
  let unit = 'tablet'
  const dm = /(?:take|chew|swallow|give|use|apply|instill)?\s*(\d+\s*\/\s*\d+|\d+(?:\.\d+)?|one|two|three|four|half)\s*(?:\(\d+\)\s*)?(tablets?|tabs?|capsules?|caps?|softgels?|pills?|drops?|puffs?|patch(?:es)?|ml|teaspoons?)/.exec(s)
  if (dm) {
    const raw = dm[1] ?? '1'
    const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(raw)
    doseCount = frac ? parseInt(frac[1] ?? '1', 10) / parseInt(frac[2] ?? '1', 10) : (WORD_NUM[raw] ?? parseFloat(raw))
    const u = dm[2] ?? 'tablet'
    unit = /^cap/.test(u) ? 'capsule' : /^tab/.test(u) ? 'tablet' : u.replace(/s$/, '')
  }

  const asNeeded = /\b(as needed|prn|when needed|if needed)\b/.test(s)

  // Frequency → number of times per day.
  let perDay: number | null = null
  let times: string[] | null = null
  const every = /every\s+(\d+|one|two|three|four|six|eight|twelve|twenty[- ]four)\s*(?:\(\d+\)\s*)?(hours?|hrs?|h)\b/.exec(s)
  const hourWords: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, six: 6, eight: 8, twelve: 12, 'twenty four': 24, 'twenty-four': 24 }
  if (every) {
    const h = hourWords[every[1] ?? ''] ?? parseInt(every[1] ?? '0', 10)
    if (h >= 1 && h <= 24) perDay = Math.max(1, Math.round(24 / h))
  } else if (/\b(four times|4 times|qid)\b/.test(s)) perDay = 4
  else if (/\b(three times|3 times|tid)\b/.test(s)) perDay = 3
  else if (/\b(twice|two times|2 times|bid)\b/.test(s)) perDay = 2
  else if (/\b(once|one time|1 time|daily|every day|each day|qd|per day)\b/.test(s)) perDay = 1

  // Named times of day override the evenly spaced defaults.
  const morning = /\b(morning|am\b|breakfast)/.test(s)
  const noon = /\b(noon|lunch|midday)/.test(s)
  const evening = /\b(evening|dinner|supper|pm\b)/.test(s)
  const bedtime = /\b(bedtime|at night|nightly|hs\b|before bed|at bed)/.test(s)
  const named = [morning && '08:00', noon && '12:00', evening && '18:00', bedtime && '22:00'].filter((x): x is string => Boolean(x))
  if (named.length) {
    times = named
    perDay = perDay ?? named.length
  } else if (perDay) {
    times = TIMES_BY_COUNT[Math.min(4, perDay)] ?? ['08:00']
  }

  // Days: "every other day", "on mondays", weekly.
  let days = ALL_DAYS
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const onDays = dayNames.map((d, i) => (new RegExp(`\\b${d}s?\\b`).test(s) ? i : -1)).filter((i) => i >= 0)
  if (onDays.length) days = onDays
  else if (/\b(once a week|weekly|every week|once weekly)\b/.test(s)) days = [1]

  // A day rule with no frequency word ("every Monday", "once a week") is one dose that day.
  if (!times && days !== ALL_DAYS) {
    times = ['08:00']
    perDay = perDay ?? 1
  }

  if (asNeeded && !times) return { times: [], days, dose: doseCount ? doseLabel(doseCount, unit) : null, pillsPerDay: null, asNeeded: true }
  if (!times) return doseCount ? { times: [], days, dose: doseLabel(doseCount, unit), pillsPerDay: null, asNeeded } : null
  const dose = doseCount ? doseLabel(doseCount, unit) : null
  const pillsPerDay = doseCount && perDay ? doseCount * perDay * (days.length / 7) : null
  return { times, days, dose, pillsPerDay: pillsPerDay ? Math.round(pillsPerDay * 100) / 100 : null, asNeeded }
}

function doseLabel(count: number, unit: string): string {
  const n = count === 0.5 ? '1/2' : Number.isInteger(count) ? String(count) : String(count)
  const plural = count > 1 && !/^(ml)$/.test(unit) ? `${unit}s` : unit
  return `${n} ${plural}`
}
