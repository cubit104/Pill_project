'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
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
  AlertTriangle,
  XCircle,
  FileText,
  ArrowRight,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

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
  slug: 'aspirin-500mg-bayer',
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

  const fileInputRef = useRef<HTMLInputElement>(null)
  const zipInputRef = useRef<HTMLInputElement>(null)

  // ── Derived state ──────────────────────────────────────────────────────────

  const rowMetas: RowMeta[] = rows.map(computeRowMeta)
  const readyCount = rowMetas.filter((m) => m.status === 'ready').length
  const warningCount = rowMetas.filter((m) => m.status === 'warning').length
  const errorCount = rowMetas.filter((m) => m.status === 'error').length

  // ── Handlers ───────────────────────────────────────────────────────────────

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
        setRows([]) // clear any previously loaded batch
        return
      }
      if (parsed.length === 0) {
        setParseError('No data rows found in the CSV file.')
        setRows([]) // clear any previously loaded batch
        return
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

      // Always send all rows — the backend handles skipping invalid rows when
      // publish=true, and returns the original row index in each result so the
      // results table correctly identifies which CSV rows succeeded or failed.

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
        setUploadProgress(80)
        const data = await res.json()
        if (!res.ok) {
          setUploadError(data.detail || 'Upload failed')
          return
        }
        setUploadResults(data.results)
        setUploadSummary({ total: data.total, succeeded: data.succeeded, failed: data.failed })
        setUploadProgress(100)
      } catch (err) {
        setUploadError(String(err))
      } finally {
        setUploading(false)
      }
    },
    [rows, getSession]
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
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
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
              <strong>{rows.length}</strong> row{rows.length !== 1 ? 's' : ''} parsed successfully. Click "Next" to preview.
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

  // ── Step 3: Upload Images ─────────────────────────────────────────────────

  function Step3() {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Upload Images <span className="text-sm font-normal text-gray-400">(Optional)</span></h2>
          <p className="text-sm text-gray-500">
            Optionally upload a ZIP file containing pill images. Name images to match the drug
            slug or NDC — e.g. <code className="bg-gray-100 px-1 rounded">aspirin-500mg.jpg</code> or{' '}
            <code className="bg-gray-100 px-1 rounded">12345678901.jpg</code>.
          </p>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-800">Bulk image upload — coming soon</p>
            <p className="text-xs text-amber-700 mt-1">
              ZIP image processing is not yet available. You can skip this step and upload images
              individually from each pill's edit page after import.
            </p>
          </div>
        </div>

        <div
          className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center opacity-50 cursor-not-allowed"
        >
          <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-700">ZIP file upload (coming soon)</p>
          <p className="text-xs text-gray-400 mt-1">Accept .zip files containing pill images</p>
          <input
            ref={zipInputRef}
            type="file"
            accept=".zip"
            className="hidden"
            disabled
            onChange={(e) => setZipFile(e.target.files?.[0] ?? null)}
          />
        </div>

        {zipFile && (
          <p className="text-sm text-gray-600">Selected: <strong>{zipFile.name}</strong></p>
        )}

        <div className="flex justify-between">
          <button
            onClick={() => setStep(2)}
            className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-5 py-2 rounded-md text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => setStep(4)}
              className="flex items-center gap-2 bg-white border border-gray-300 text-gray-600 px-5 py-2 rounded-md text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Skip
            </button>
            <button
              onClick={() => setStep(4)}
              className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2 rounded-md text-sm font-medium hover:bg-indigo-700 transition-colors"
            >
              Next <ChevronRight className="w-4 h-4" />
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
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 border-b">Details</th>
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
                            <CheckCircle className="w-3.5 h-3.5" /> Saved
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-red-600 text-xs font-medium">
                            <XCircle className="w-3.5 h-3.5" /> Failed
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-500">
                        {r.success ? (
                          <span className="text-gray-400">id: {r.id}</span>
                        ) : (
                          <span className="text-red-600">{r.error}</span>
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
                }}
                className="text-sm text-indigo-600 hover:underline"
              >
                Upload another batch
              </button>
              <Link
                href="/admin/pills"
                className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2 rounded-md text-sm font-medium hover:bg-indigo-700 transition-colors"
              >
                Go to Pills List <ArrowRight className="w-4 h-4" />
              </Link>
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
