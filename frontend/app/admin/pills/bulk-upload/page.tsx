'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import JSZip from 'jszip'
import { createClient } from '../../lib/supabase'
import {
  FIELD_SCHEMA,
  computeCompleteness,
  type FieldSchemaEntry,
} from '../../lib/fieldSchema'
import {
  Upload,
  Download,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  XCircle,
  FileText,
  ArrowRight,
  Info,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

type ParsedRow = Record<string, string>

interface RowMeta {
  status: 'ready' | 'warning' | 'error'
  missingRequired: string[]
  missingWarning: string[]
}

interface BulkResult {
  index: number
  success: boolean
  id?: string
  drug_name: string
  error?: string
  imageStatus?: 'uploaded' | 'failed' | 'none'
}

interface ZipMatchEntry {
  filename: string
  blob: Blob
  objectUrl: string
}

// ── CSV helpers ───────────────────────────────────────────────────────────────

const FIELD_KEYS = FIELD_SCHEMA.map((f: FieldSchemaEntry) => f.key)

const CSV_EXAMPLE: Record<string, string> = {
  medicine_name: 'Aspirin',
  author: 'Bayer',
  spl_strength: '500 mg',
  splimprint: 'BAYER',
  splcolor_text: 'White',
  splshape_text: 'Round',
  slug: 'aspirin-500-mg',
  ndc9: '12345678',
  ndc11: '12345678901',
  dosage_form: 'Tablet',
  route: 'Oral',
  spl_ingredients: 'Aspirin 500 mg',
  spl_inactive_ing: 'Starch; Cellulose',
  dea_schedule_name: 'N/A',
  status_rx_otc: 'OTC',
  image_alt_text: '',
  brand_names: 'Aspirin',
  splsize: '11',
  meta_title: '',
  meta_description: '',
  pharmclass_fda_epc: '',
  rxcui: '1191',
  rxcui_1: '',
  imprint_status: 'Engraved',
  tags: 'pain relief',
}

// ── Client-side ZIP matching helpers ─────────────────────────────────────────

/**
 * Slugify a string the same way the backend `_generate_slug` does.
 * Lowercases, strips diacritics, replaces any non-[a-z0-9] run with '-',
 * and trims leading/trailing dashes.
 */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Convert a drug name + strength to a URL-safe slug.
 */
function generateSlug(medicineName: string, strength: string): string {
  const combined = [medicineName, strength].filter(Boolean).join(' ')
  if (!combined) return ''
  return slugify(combined)
}

/**
 * Strip variant suffixes like `-1`, `-2`, or bare trailing digits from a stem.
 */
function stripVariantSuffix(stem: string): string {
  return stem.replace(/-\d+$/, '').replace(/\d+$/, '').replace(/-+$/, '')
}

/**
 * Match an image filename stem to a CSV row index.
 * Tries both the raw stem and the variant-stripped version, matching by
 * NDC11, slug, or slugified medicine_name — same priority as the backend.
 */
function matchImageToRow(stem: string, rows: ParsedRow[]): number | null {
  const candidates = [stem, stripVariantSuffix(stem)]
  for (const s of candidates) {
    const slugged = slugify(s)
    // NDC11 match (11 consecutive digits after stripping hyphens)
    const ndc = s.replace(/-/g, '')
    if (/^\d{11}$/.test(ndc)) {
      const idx = rows.findIndex((r) => r.ndc11?.replace(/-/g, '') === ndc)
      if (idx !== -1) return idx
    }
    // slug match
    const idx1 = rows.findIndex((r) => r.slug && slugify(r.slug) === slugged)
    if (idx1 !== -1) return idx1
    // medicine_name slugified match
    const idx2 = rows.findIndex(
      (r) => r.medicine_name && slugify(r.medicine_name) === slugged,
    )
    if (idx2 !== -1) return idx2
  }
  return null
}

/**
 * Parse a full CSV text into rows. Handles:
 * - UTF-8 BOM (Excel/Google Sheets export artifact)
 * - Quoted fields that may contain embedded commas, double-quotes, or newlines
 * - Windows (\r\n), Unix (\n), and legacy Mac (\r) line endings
 */
function parseCSV(text: string): { rows: ParsedRow[]; errors: string[] } {
  // Strip UTF-8 BOM if present (common in Excel/Google Sheets exports)
  const content = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  const allRows: string[][] = []
  let currentRow: string[] = []
  let currentField = ''
  let inQuotes = false

  for (let i = 0; i < content.length; i++) {
    const ch = content[i]
    const next = content[i + 1]

    if (ch === '"') {
      if (inQuotes && next === '"') {
        // Escaped double-quote inside a quoted field
        currentField += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      currentRow.push(currentField)
      currentField = ''
    } else if (ch === '\r' && next === '\n' && !inQuotes) {
      // Windows \r\n line ending
      currentRow.push(currentField)
      currentField = ''
      allRows.push(currentRow)
      currentRow = []
      i++ // skip the \n
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      // Unix \n or legacy Mac \r line ending
      currentRow.push(currentField)
      currentField = ''
      allRows.push(currentRow)
      currentRow = []
    } else {
      // Regular character (including newlines inside quoted fields)
      currentField += ch
    }
  }

  // Handle final field/row when file has no trailing newline
  currentRow.push(currentField)
  if (currentRow.some((f) => f.trim() !== '')) {
    allRows.push(currentRow)
  }

  if (allRows.length < 2) {
    return { rows: [], errors: ['CSV file appears to be empty or has no data rows.'] }
  }

  const headers = allRows[0].map((h) => h.trim().toLowerCase())
  const rows: ParsedRow[] = []

  for (let i = 1; i < allRows.length; i++) {
    const values = allRows[i]
    if (values.every((v) => v.trim() === '')) continue // skip blank rows
    const row: ParsedRow = {}
    headers.forEach((h, idx) => {
      row[h] = (values[idx] ?? '').trim()
    })
    rows.push(row)
  }

  return { rows, errors: [] }
}

function computeRowMeta(row: ParsedRow): RowMeta {
  const comp = computeCompleteness(row)
  const hasTier1Errors = comp.missing_required.length > 0
  const hasTier2Warnings = comp.needs_na_confirmation.length > 0
  return {
    status: hasTier1Errors ? 'error' : hasTier2Warnings ? 'warning' : 'ready',
    missingRequired: comp.missing_required,
    missingWarning: comp.needs_na_confirmation,
  }
}

function downloadCSVTemplate() {
  const headerRow = FIELD_KEYS.join(',')
  const exampleRow = FIELD_KEYS.map((k) => {
    const val = CSV_EXAMPLE[k] ?? ''
    return val.includes(',') ? `"${val}"` : val
  }).join(',')
  const csv = `${headerRow}\n${exampleRow}\n`
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'pill-bulk-upload-template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// ── Stepper component ─────────────────────────────────────────────────────────

const STEPS = [
  { n: 1, label: 'Upload CSV' },
  { n: 2, label: 'Preview & Verify' },
  { n: 3, label: 'Images (Optional)' },
  { n: 4, label: 'Save & Publish' },
]

function Stepper({ current }: { current: number }) {
  return (
    <nav className="flex items-center gap-0 mb-8">
      {STEPS.map((step, idx) => (
        <div key={step.n} className="flex items-center">
          <div className="flex items-center gap-2">
            <span
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 ${
                current === step.n
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : current > step.n
                  ? 'bg-indigo-100 border-indigo-400 text-indigo-600'
                  : 'bg-white border-gray-300 text-gray-400'
              }`}
            >
              {current > step.n ? '✓' : step.n}
            </span>
            <span
              className={`text-sm font-medium hidden sm:block ${
                current === step.n
                  ? 'text-indigo-700'
                  : current > step.n
                  ? 'text-indigo-500'
                  : 'text-gray-400'
              }`}
            >
              {step.label}
            </span>
          </div>
          {idx < STEPS.length - 1 && (
            <div
              className={`mx-3 flex-1 h-px w-8 sm:w-16 ${
                current > step.n ? 'bg-indigo-400' : 'bg-gray-200'
              }`}
            />
          )}
        </div>
      ))}
    </nav>
  )
}

// ── Main page component ───────────────────────────────────────────────────────

export default function BulkUploadPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [parseError, setParseError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [zipFile, setZipFile] = useState<File | null>(null)
  const [uploadResults, setUploadResults] = useState<BulkResult[] | null>(null)
  const [uploadSummary, setUploadSummary] = useState<{ total: number; succeeded: number; failed: number } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadError, setUploadError] = useState('')
  const [editCell, setEditCell] = useState<{ rowIdx: number; key: string } | null>(null)
  const [lastPublishMode, setLastPublishMode] = useState<boolean>(false)

  // ZIP image match state (Step 3 — client-side only)
  const [zipDragOver, setZipDragOver] = useState(false)
  const [zipProcessing, setZipProcessing] = useState(false)
  const [zipProgress, setZipProgress] = useState(0)
  const [zipError, setZipError] = useState('')
  const [zipMatches, setZipMatches] = useState<Map<number, ZipMatchEntry[]>>(new Map())
  const [zipMatchSummary, setZipMatchSummary] = useState<{ matched: number; unmatched: string[] } | null>(null)

  // Keep a ref to zipMatches for use in the unmount cleanup
  const zipMatchesRef = useRef<Map<number, ZipMatchEntry[]>>(new Map())
  useEffect(() => {
    zipMatchesRef.current = zipMatches
  }, [zipMatches])

  // Revoke all objectUrls when the component unmounts
  useEffect(() => {
    return () => {
      for (const entries of zipMatchesRef.current.values()) {
        for (const { objectUrl } of entries) URL.revokeObjectURL(objectUrl)
      }
    }
  }, [])

  const fileInputRef = useRef<HTMLInputElement>(null)
  const zipInputRef = useRef<HTMLInputElement>(null)

  // ── Derived state ─────────────────────────────────────────────────────────

  const rowMetas: RowMeta[] = rows.map(computeRowMeta)
  const readyCount = rowMetas.filter((m) => m.status === 'ready').length
  const warningCount = rowMetas.filter((m) => m.status === 'warning').length
  const errorCount = rowMetas.filter((m) => m.status === 'error').length

  // ── Handlers ──────────────────────────────────────────────────────────────

  const getSession = useCallback(async () => {
    const supabase = createClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    return session
  }, [])

  // Auth guard: redirect to /admin/login on mount if no session
  useEffect(() => {
    getSession().then((session) => {
      if (!session) router.push('/admin/login')
    })
  }, [getSession, router])

  // Shared file-parsing logic used by both the input change handler and drop handler
  const handleFileParsing = useCallback((file: File) => {
    setParseError('')
    const reader = new FileReader()
    reader.onload = (evt) => {
      const text = evt.target?.result as string
      const { rows: parsed, errors } = parseCSV(text)
      if (errors.length > 0) {
        setParseError(errors.join(' '))
        setRows([])
        return
      }
      if (parsed.length === 0) {
        setParseError('No data rows found in the CSV file.')
        setRows([])
        return
      }
      // Auto-generate slugs for rows that don't have one, with duplicate disambiguation
      const usedSlugs = new Set<string>()
      // First pass: register all existing slugs to detect collisions
      for (const row of parsed) {
        if (row.slug && row.slug.trim() !== '') {
          usedSlugs.add(row.slug.trim().toLowerCase())
        }
      }
      // Second pass: auto-generate missing slugs
      for (const row of parsed) {
        if (!row.slug || row.slug.trim() === '') {
          const medicineName = row.medicine_name || ''
          const strength = row.spl_strength || ''
          // Fix doubled slug: strip medicine_name prefix from spl_strength if present
          const nameLower = medicineName.toLowerCase().trim()
          const strengthClean =
            nameLower && strength.toLowerCase().startsWith(nameLower)
              ? strength.slice(nameLower.length).trim()
              : strength
          const base = generateSlug(medicineName, strengthClean)
          if (!base) continue // skip if both fields are empty
          let candidate = base
          let counter = 2
          while (usedSlugs.has(candidate)) {
            candidate = `${base}-${counter}`
            counter++
          }
          usedSlugs.add(candidate)
          row.slug = candidate
        }
      }
      setRows(parsed)
    }
    reader.readAsText(file)
  }, [])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    handleFileParsing(file)
  }, [handleFileParsing])

  const handleCellEdit = useCallback(
    (rowIdx: number, key: string, value: string) => {
      setRows((prev) => {
        const next = [...prev]
        next[rowIdx] = { ...next[rowIdx], [key]: value }
        return next
      })
    },
    []
  )

  const handleBulkSave = useCallback(
    async (publish: boolean) => {
      const session = await getSession()
      if (!session) {
        setUploadError('Not authenticated. Please log in again.')
        return
      }

      setUploading(true)
      setUploadProgress(10)
      setUploadError('')
      setUploadResults(null)
      setLastPublishMode(publish)

      try {
        setUploadProgress(30)
        const res = await fetch('/api/admin/pills/bulk', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ pills: rows, publish }),
        })
        setUploadProgress(60)
        const data = await res.json()
        if (!res.ok) {
          setUploadError(data.detail || 'Upload failed')
          return
        }

        const results: BulkResult[] = data.results

        // Upload matched images for each successfully created pill
        const successfulWithMatch = results.filter(
          (r) => r.success && r.id && zipMatches.has(r.index),
        )
        const totalMatchedImages = successfulWithMatch.reduce(
          (sum, r) => sum + (zipMatches.get(r.index)?.length ?? 0),
          0,
        )
        const imageStatuses: Record<number, BulkResult['imageStatus']> = {}
        let imgDone = 0

        for (const r of results) {
          if (!r.success || !r.id) {
            imageStatuses[r.index] = 'none'
            continue
          }
          const matches = zipMatches.get(r.index)
          if (!matches || matches.length === 0) {
            imageStatuses[r.index] = 'none'
            continue
          }
          // POST each image blob to the single-image upload endpoint in order
          let anyOk = false
          let anyFail = false
          for (const m of matches) {
            const formData = new FormData()
            formData.append('file', m.blob, m.filename)
            try {
              const imgRes = await fetch(`/api/admin/pills/${r.id}/images`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${session.access_token}` },
                body: formData,
              })
              if (imgRes.ok) anyOk = true; else anyFail = true
            } catch {
              anyFail = true
            } finally {
              URL.revokeObjectURL(m.objectUrl)
            }

            // Update progress proportionally across all image uploads
            imgDone++
            if (totalMatchedImages > 0) {
              setUploadProgress(
                60 + Math.round((imgDone / totalMatchedImages) * 35),
              )
            }
          }
          imageStatuses[r.index] = anyFail ? (anyOk ? 'uploaded' : 'failed') : 'uploaded'
        }

        // Merge imageStatus into results
        const enriched = results.map((r) => ({
          ...r,
          imageStatus: imageStatuses[r.index] ?? 'none',
        }))

        setUploadResults(enriched)
        setUploadSummary({ total: data.total, succeeded: data.succeeded, failed: data.failed })
        setUploadProgress(100)
      } catch (err) {
        setUploadError(String(err))
      } finally {
        setUploading(false)
      }
    },
    [rows, zipMatches, getSession],
  )

  const handleZipMatch = useCallback(
    async (zipFileArg?: File) => {
      const f = zipFileArg ?? zipFile
      if (!f) return

      setZipProcessing(true)
      setZipProgress(10)
      setZipError('')
      // Revoke old objectUrls before replacing matches
      for (const entries of zipMatches.values()) {
        for (const { objectUrl } of entries) URL.revokeObjectURL(objectUrl)
      }
      setZipMatches(new Map())
      setZipMatchSummary(null)

      try {
        setZipProgress(20)
        const zip = await JSZip.loadAsync(f)
        const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

        const entries = Object.entries(zip.files).filter(([, entry]) => !entry.dir)
        const imageEntries = entries.filter(([name]) => {
          const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
          return IMAGE_EXTS.has(ext)
        })

        setZipProgress(40)

        const matched = new Map<number, ZipMatchEntry[]>()
        const unmatched: string[] = []

        for (let i = 0; i < imageEntries.length; i++) {
          const [fullName, entry] = imageEntries[i]
          // Strip directory prefix and extension to get the stem
          const basename = fullName.replace(/^.*\//, '')
          const dotIdx = basename.lastIndexOf('.')
          const stem = dotIdx !== -1 ? basename.slice(0, dotIdx) : basename

          // First try: match by image_filename column in CSV row
          let rowIdx: number | null = null
          for (let j = 0; j < rows.length; j++) {
            const csvImages = rows[j].image_filename
              ?.split(',')
              .map((f) => f.trim())
              .filter(Boolean) || []
            if (csvImages.some((f) => f.toLowerCase() === basename.toLowerCase())) {
              rowIdx = j
              break
            }
          }
          // Fall back to stem-based matching (NDC11 / slug / medicine_name)
          if (rowIdx === null) {
            rowIdx = matchImageToRow(stem, rows)
          }

          if (rowIdx !== null) {
            const blob = await entry.async('blob')
            const objectUrl = URL.createObjectURL(blob)
            const existing = matched.get(rowIdx) ?? []
            matched.set(rowIdx, [...existing, { filename: basename, blob, objectUrl }])
          } else {
            unmatched.push(basename)
          }

          // Update progress as we process each image
          setZipProgress(40 + Math.round(((i + 1) / imageEntries.length) * 55))
        }

        const totalImages = Array.from(matched.values()).reduce((s, a) => s + a.length, 0)
        setZipMatches(matched)
        setZipMatchSummary({ matched: totalImages, unmatched })
        setZipProgress(100)
      } catch (err) {
        setZipError(String(err))
      } finally {
        setZipProcessing(false)
      }
    },
    [zipFile, rows, zipMatches],
  )

  // ── Step 1: Upload CSV ────────────────────────────────────────────────────

  function Step1() {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Upload CSV File</h2>
          <p className="text-sm text-gray-500">
            Select a <code className="bg-gray-100 px-1 rounded">.csv</code> file with up to 500 drug rows.
            Column headers must match the field keys (download the template below).
            Slugs are auto-generated from drug name + strength if not provided.
          </p>
        </div>

        {/* Template download */}
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 flex items-start gap-3">
          <FileText className="w-5 h-5 text-indigo-500 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-indigo-800">Need a template?</p>
            <p className="text-xs text-indigo-600 mt-0.5">
              Download a pre-filled CSV with all {FIELD_SCHEMA.length} field headers and one example row.
            </p>
          </div>
          <button
            onClick={downloadCSVTemplate}
            className="flex items-center gap-1.5 bg-indigo-600 text-white px-3 py-1.5 rounded-md text-xs font-medium hover:bg-indigo-700 transition-colors shrink-0"
          >
            <Download className="w-3.5 h-3.5" /> Download Template
          </button>
        </div>

        {/* File picker / dropzone */}
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
            dragOver
              ? 'border-indigo-500 bg-indigo-50'
              : 'border-gray-300 hover:border-indigo-400'
          }`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); if (!dragOver) setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const file = e.dataTransfer.files?.[0]
            if (file) handleFileParsing(file)
          }}
        >
          <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-700">Click or drag a CSV file here</p>
          <p className="text-xs text-gray-400 mt-1">Supports .csv files</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>

        {parseError && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            {parseError}
          </div>
        )}

        {rows.length > 0 && (
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex items-center gap-2 text-sm text-green-700">
            <CheckCircle className="w-4 h-4 shrink-0" />
            <span>
              <strong>{rows.length}</strong> row{rows.length !== 1 ? 's' : ''} parsed successfully. Click &quot;Next&quot; to preview.
            </span>
          </div>
        )}

        <div className="flex justify-end">
          <button
            onClick={() => setStep(2)}
            disabled={rows.length === 0}
            className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2 rounded-md text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    )
  }

  // ── Step 2: Preview & Verify ──────────────────────────────────────────────

  function Step2() {
    const statusIcon = (status: RowMeta['status']) => {
      if (status === 'ready') return <span aria-label="Ready: all required fields filled" role="img" className="text-green-500">✅</span>
      if (status === 'warning') return <span aria-label="Warning: required-or-N/A fields missing" role="img" className="text-yellow-500">⚠️</span>
      return <span aria-label="Error: required fields missing" role="img" className="text-red-500">❌</span>
    }

    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Preview &amp; Verify</h2>
          <p className="text-sm text-gray-500">
            Click any cell to edit it inline. Rows with ❌ are missing required fields and will be skipped when publishing.
          </p>
        </div>

        {/* Summary bar */}
        <div className="flex gap-4 text-sm bg-white border border-gray-200 rounded-lg px-4 py-3">
          <span className="text-green-600 font-medium"><span role="img" aria-label="Ready">✅</span> {readyCount} ready</span>
          <span className="text-yellow-600 font-medium"><span role="img" aria-label="Warning">⚠️</span> {warningCount} warnings</span>
          <span className="text-red-600 font-medium"><span role="img" aria-label="Error">❌</span> {errorCount} errors</span>
          <span className="text-gray-500 ml-auto">{rows.length} total rows</span>
        </div>

        {/* Table */}
        <div className="overflow-auto max-h-[500px] rounded-lg border border-gray-200 shadow-sm">
          <table className="min-w-max text-xs">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="px-2 py-2 text-left font-medium text-gray-500 border-b border-gray-200 w-10">#</th>
                <th className="px-2 py-2 text-left font-medium text-gray-500 border-b border-gray-200 w-8">✓</th>
                {FIELD_SCHEMA.map((f: FieldSchemaEntry) => (
                  <th
                    key={f.key}
                    className={`px-2 py-2 text-left font-medium border-b border-gray-200 whitespace-nowrap ${
                      f.tier === 'required'
                        ? 'text-red-600'
                        : f.tier === 'required_or_na'
                        ? 'text-amber-600'
                        : 'text-gray-500'
                    }`}
                  >
                    {f.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => {
                const meta = rowMetas[rIdx]
                return (
                  <tr
                    key={rIdx}
                    className={`border-b border-gray-100 ${
                      meta.status === 'error'
                        ? 'bg-red-50'
                        : meta.status === 'warning'
                        ? 'bg-yellow-50'
                        : 'bg-white hover:bg-gray-50'
                    }`}
                  >
                    <td className="px-2 py-1 text-gray-400 font-mono">{rIdx + 1}</td>
                    <td className="px-2 py-1">{statusIcon(meta.status)}</td>
                    {FIELD_SCHEMA.map((f: FieldSchemaEntry) => {
                      const isEditing = editCell?.rowIdx === rIdx && editCell?.key === f.key
                      const isMissingReq = meta.missingRequired.includes(f.key)
                      const isMissingWarn = meta.missingWarning.includes(f.key)
                      return (
                        <td
                          key={f.key}
                          className={`px-1 py-0.5 max-w-[140px] ${
                            isMissingReq
                              ? 'bg-red-100'
                              : isMissingWarn
                              ? 'bg-yellow-100'
                              : ''
                          }`}
                          onClick={() => !isEditing && setEditCell({ rowIdx: rIdx, key: f.key })}
                        >
                          {isEditing ? (
                            <input
                              autoFocus
                              className="w-full min-w-[80px] border border-indigo-400 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              defaultValue={row[f.key] ?? ''}
                              onBlur={(e) => {
                                handleCellEdit(rIdx, f.key, e.target.value)
                                setEditCell(null)
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === 'Escape') {
                                  if (e.key === 'Enter') {
                                    handleCellEdit(rIdx, f.key, (e.target as HTMLInputElement).value)
                                  }
                                  setEditCell(null)
                                }
                              }}
                            />
                          ) : (
                            <span
                              className={`block truncate cursor-pointer hover:bg-indigo-50 rounded px-1 py-0.5 ${
                                !row[f.key] ? 'text-gray-300 italic' : 'text-gray-800'
                              }`}
                              title={row[f.key] || '(empty)'}
                            >
                              {row[f.key] || '—'}
                            </span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="flex justify-between">
          <button
            onClick={() => setStep(1)}
            className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-5 py-2 rounded-md text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <button
            onClick={() => setStep(3)}
            className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2 rounded-md text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    )
  }

  // ── Step 3: Match Images ──────────────────────────────────────────────────

  function Step3() {
    const hasMatches = zipMatchSummary !== null

    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Images <span className="text-sm font-normal text-gray-400">(Optional)</span></h2>
          <p className="text-sm text-gray-500">
            Upload a ZIP of pill images. Each image is matched to a CSV row <strong>in your browser</strong> —
            no server call yet. When you save in Step 4 each pill will receive its image immediately.
            Name images by slug, NDC11, or drug name — e.g.{' '}
            <code className="bg-gray-100 px-1 rounded">aspirin-500-mg.jpg</code> or{' '}
            <code className="bg-gray-100 px-1 rounded">12345678901.jpg</code>.
            Variant suffixes like <code className="bg-gray-100 px-1 rounded">-1</code>, <code className="bg-gray-100 px-1 rounded">-2</code> are stripped automatically.
          </p>
        </div>

        {/* Info banner */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-blue-800">Images stay in browser memory until Step 4</p>
            <p className="text-xs text-blue-700 mt-1">
              Clicking &quot;Match Images&quot; reads the ZIP locally and pairs each image with its CSV row.
              No data is sent to the server until you save pills in Step 4.
            </p>
          </div>
        </div>

        {/* Dropzone — always visible so user can change the ZIP */}
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
            zipDragOver
              ? 'border-indigo-500 bg-indigo-50'
              : zipFile
              ? 'border-green-400 bg-green-50'
              : 'border-gray-300 hover:border-indigo-400'
          }`}
          onClick={() => zipInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); if (!zipDragOver) setZipDragOver(true) }}
          onDragLeave={() => setZipDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setZipDragOver(false)
            const f = e.dataTransfer.files?.[0]
            if (f) {
              setZipFile(f)
              setZipError('')
              setZipMatchSummary(null)
              for (const entries of zipMatches.values()) for (const { objectUrl } of entries) URL.revokeObjectURL(objectUrl)
              setZipMatches(new Map())
            }
          }}
        >
          <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
          {zipFile ? (
            <>
              <p className="text-sm font-medium text-green-700">{zipFile.name}</p>
              <p className="text-xs text-green-600 mt-1">{(zipFile.size / 1024 / 1024).toFixed(1)} MB — click to change</p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-gray-700">Click or drag a ZIP file here</p>
              <p className="text-xs text-gray-400 mt-1">Accepts .zip · .jpg .jpeg .png .webp inside</p>
            </>
          )}
          <input
            ref={zipInputRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) {
                setZipFile(f)
                setZipError('')
                setZipMatchSummary(null)
                for (const entries of zipMatches.values()) for (const { objectUrl } of entries) URL.revokeObjectURL(objectUrl)
                setZipMatches(new Map())
              }
            }}
          />
        </div>

        {/* Progress bar */}
        {zipProcessing && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-gray-500">
              <span>Matching images…</span>
              <span>{zipProgress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${zipProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Error */}
        {zipError && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            {zipError}
          </div>
        )}

        {/* Match results */}
        {hasMatches && zipMatchSummary && (
          <div className="space-y-4">
            {/* Summary counts */}
            <div className="grid grid-cols-2 gap-3 text-center text-xs">
              <div className="border rounded-lg p-3 bg-green-50 border-green-200 text-green-700">
                <div className="text-xl font-bold">{zipMatchSummary.matched}</div>
                <div className="mt-0.5">Matched</div>
              </div>
              <div className="border rounded-lg p-3 bg-amber-50 border-amber-200 text-amber-700">
                <div className="text-xl font-bold">{zipMatchSummary.unmatched.length}</div>
                <div className="mt-0.5">Unmatched</div>
              </div>
            </div>

            {/* Matched thumbnails table */}
            {zipMatchSummary.matched > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-600 mb-2">Matched images ({zipMatchSummary.matched}):</p>
                <div className="overflow-auto max-h-64 rounded-lg border border-gray-200">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-500 border-b">Row</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500 border-b">Drug Name</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500 border-b">Image</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500 border-b">Preview</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from(zipMatches.entries()).flatMap(([rowIdx, matchArr]) =>
                        matchArr.map((match, imgIdx) => (
                          <tr key={`${rowIdx}-${imgIdx}`} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="px-3 py-2 text-gray-400 font-mono">{imgIdx === 0 ? rowIdx + 1 : ''}</td>
                            <td className="px-3 py-2 text-gray-700 font-medium">{imgIdx === 0 ? rows[rowIdx]?.medicine_name || '—' : ''}</td>
                            <td className="px-3 py-2 font-mono text-gray-600">{match.filename}</td>
                            <td className="px-3 py-2">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={match.objectUrl}
                                alt={match.filename}
                                className="h-10 w-10 object-cover rounded border border-gray-200"
                              />
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Unmatched files */}
            {zipMatchSummary.unmatched.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-600 mb-2">
                  Unmatched files ({zipMatchSummary.unmatched.length}) — no CSV row found:
                </p>
                <div className="overflow-auto max-h-32 rounded-lg border border-gray-200 bg-amber-50 px-3 py-2">
                  {zipMatchSummary.unmatched.map((name, i) => (
                    <p key={i} className="text-xs font-mono text-amber-800">{name}</p>
                  ))}
                </div>
              </div>
            )}

            {zipMatchSummary.matched > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex items-center gap-2 text-sm text-green-700">
                <CheckCircle className="w-4 h-4 shrink-0" />
                <span>
                  <strong>{zipMatchSummary.matched}</strong> image{zipMatchSummary.matched !== 1 ? 's' : ''} ready — they will be uploaded in Step 4 after each pill is saved.
                </span>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-between">
          <button
            onClick={() => setStep(2)}
            className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-5 py-2 rounded-md text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <div className="flex gap-2">
            {/* Match Images button — only shown when a file is selected and matching isn't done yet */}
            {zipFile && !hasMatches && (
              <button
                onClick={() => handleZipMatch()}
                disabled={zipProcessing}
                className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2 rounded-md text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Upload className="w-4 h-4" />
                {zipProcessing ? 'Matching…' : 'Match Images'}
              </button>
            )}
            <button
              onClick={() => setStep(4)}
              disabled={zipProcessing}
              className="flex items-center gap-2 bg-white border border-gray-300 text-gray-600 px-5 py-2 rounded-md text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-40"
            >
              {hasMatches ? <>Next <ChevronRight className="w-4 h-4" /></> : 'Skip'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Step 4: Save & Publish ────────────────────────────────────────────────

  function Step4() {
    const validForPublish = rows.filter((_, i) => rowMetas[i].status !== 'error').length

    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Save &amp; Publish</h2>
          <p className="text-sm text-gray-500">
            Review the summary below and choose how to save your data.
          </p>
        </div>

        {/* Pre-upload summary */}
        {!uploadResults && (
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-green-700">{readyCount}</div>
              <div className="text-xs text-green-600 mt-1">Ready rows</div>
            </div>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-yellow-700">{warningCount}</div>
              <div className="text-xs text-yellow-600 mt-1">Warning rows</div>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-red-700">{errorCount}</div>
              <div className="text-xs text-red-600 mt-1">Error rows (skipped when publishing)</div>
            </div>
          </div>
        )}

        {/* Action buttons */}
        {!uploadResults && !uploading && (
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => handleBulkSave(false)}
              className="flex-1 flex items-center justify-center gap-2 bg-gray-600 text-white px-5 py-3 rounded-md text-sm font-medium hover:bg-gray-700 transition-colors"
            >
              Save All as Drafts
              <span className="text-gray-300 text-xs">({rows.length} rows)</span>
            </button>
            <button
              onClick={() => handleBulkSave(true)}
              disabled={validForPublish === 0}
              className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 text-white px-5 py-3 rounded-md text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Save &amp; Publish All Valid
              <span className="text-emerald-200 text-xs">({validForPublish} rows)</span>
            </button>
          </div>
        )}

        {/* Progress bar */}
        {uploading && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-gray-500">
              <span>Uploading…</span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        {uploadError && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            {uploadError}
          </div>
        )}

        {/* Results */}
        {uploadResults && uploadSummary && (
          <div className="space-y-4">
            <div className="flex gap-4 text-sm bg-white border border-gray-200 rounded-lg px-4 py-3">
              <span className="text-green-600 font-medium"><span role="img" aria-label="Success">✅</span> {uploadSummary.succeeded} saved</span>
              <span className="text-red-600 font-medium"><span role="img" aria-label="Failed">❌</span> {uploadSummary.failed} failed</span>
              <span className="text-gray-500 ml-auto">{uploadSummary.total} total</span>
            </div>

            <div className="overflow-auto max-h-[400px] rounded-lg border border-gray-200">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 border-b">#</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 border-b">Drug Name</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 border-b">Status</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 border-b">Image</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 border-b">Details</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 border-b">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {uploadResults.map((r) => (
                    <tr key={r.index} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-400 font-mono text-xs">{r.index + 1}</td>
                      <td className="px-4 py-2 text-gray-800 font-medium">{r.drug_name}</td>
                      <td className="px-4 py-2">
                        {r.success ? (
                          <span className="flex items-center gap-1 text-green-600 text-xs font-medium">
                            <CheckCircle className="w-3.5 h-3.5" /> {lastPublishMode ? 'Published' : 'Draft saved'}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-red-600 text-xs font-medium">
                            <XCircle className="w-3.5 h-3.5" /> Failed
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {r.imageStatus === 'uploaded' && (
                          <span aria-label="Image uploaded" role="img" className="text-green-600">✅</span>
                        )}
                        {r.imageStatus === 'failed' && (
                          <span aria-label="Image upload failed" role="img" className="text-red-500">❌</span>
                        )}
                        {(r.imageStatus === 'none' || !r.imageStatus) && (
                          <span className="text-gray-300" aria-label="No image">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-500">
                        {r.success ? (
                          <span className="text-gray-400">id: {r.id}</span>
                        ) : (
                          <span className="text-red-600">{r.error}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {r.success && r.id && (
                          <Link
                            href={`/admin/pills/${r.id}`}
                            className="flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-medium"
                          >
                            <FileText className="w-3 h-3" /> Edit
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between items-center pt-2">
              <button
                onClick={() => {
                  setStep(1)
                  setRows([])
                  setUploadResults(null)
                  setUploadSummary(null)
                  setUploadProgress(0)
                  setZipFile(null)
                  for (const entries of zipMatches.values()) for (const { objectUrl } of entries) URL.revokeObjectURL(objectUrl)
                  setZipMatches(new Map())
                  setZipMatchSummary(null)
                  setZipProgress(0)
                  setZipError('')
                  if (zipInputRef.current) zipInputRef.current.value = ''
                }}
                className="text-sm text-indigo-600 hover:underline"
              >
                Upload another batch
              </button>
              <div className="flex gap-3">
                {!lastPublishMode && (
                  <Link
                    href="/admin/drafts"
                    className="flex items-center gap-2 bg-gray-600 text-white px-5 py-2 rounded-md text-sm font-medium hover:bg-gray-700 transition-colors"
                  >
                    View Drafts
                  </Link>
                )}
                <Link
                  href="/admin/pills"
                  className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2 rounded-md text-sm font-medium hover:bg-indigo-700 transition-colors"
                >
                  Go to Pills List <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </div>
        )}

        {!uploadResults && (
          <div className="flex justify-start">
            <button
              onClick={() => setStep(3)}
              disabled={uploading}
              className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-5 py-2 rounded-md text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
          </div>
        )}
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/admin/pills"
          className="text-sm text-indigo-600 hover:underline flex items-center gap-1"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Pills
        </Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-xl font-bold text-gray-900">Bulk Upload</h1>
      </div>

      <Stepper current={step} />

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        {step === 1 && <Step1 />}
        {step === 2 && <Step2 />}
        {step === 3 && <Step3 />}
        {step === 4 && <Step4 />}
      </div>
    </div>
  )
}
