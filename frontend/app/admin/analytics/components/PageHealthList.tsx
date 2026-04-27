'use client'

import { useState, useMemo } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { ChevronUp, ChevronDown, ChevronsUpDown, ExternalLink, AlertTriangle, AlertCircle, Info } from 'lucide-react'

interface Issue {
  id: string | null
  url: string
  issue_type: string
  severity: 'critical' | 'warning' | 'info'
  message: string
  field: string | null
  current_value: string | null
}

interface Props {
  issues: Issue[]
  totalPages: number
}

const SEVERITY_STYLE: Record<string, string> = {
  critical: 'bg-red-50 text-red-700 border-red-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  info: 'bg-blue-50 text-blue-700 border-blue-200',
}

const SEVERITY_ICON = {
  critical: AlertCircle,
  warning: AlertTriangle,
  info: Info,
}

const ISSUE_LABELS: Record<string, string> = {
  garbage_drug_name: 'Garbage drug name',
  missing_meta_title: 'Missing title',
  missing_meta_description: 'Missing description',
  short_meta_title: 'Title too short',
  long_meta_title: 'Title too long',
  short_meta_description: 'Description too short',
  long_meta_description: 'Description too long',
  duplicate_meta_title: 'Duplicate title',
  duplicate_meta_description: 'Duplicate description',
  noindex: 'Noindex set',
}

export default function PageHealthList({ issues, totalPages }: Props) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'severity', desc: true }])
  const [severityFilter, setSeverityFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')

  const filtered = useMemo(() => {
    let result = issues
    if (severityFilter !== 'all') result = result.filter(i => i.severity === severityFilter)
    if (typeFilter !== 'all') result = result.filter(i => i.issue_type === typeFilter)
    return result
  }, [issues, severityFilter, typeFilter])

  const columns = useMemo<ColumnDef<Issue>[]>(() => [
    {
      id: 'severity',
      accessorFn: row => ({ critical: 2, warning: 1, info: 0 }[row.severity] ?? -1),
      header: 'Severity',
      cell: ({ row }) => {
        const s = row.original.severity
        const Icon = SEVERITY_ICON[s] ?? Info
        return (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold ${SEVERITY_STYLE[s] ?? ''}`}>
            <Icon className="w-3 h-3" />
            {s}
          </span>
        )
      },
    },
    {
      id: 'issue_type',
      accessorKey: 'issue_type',
      header: 'Issue',
      cell: info => (
        <span className="font-medium text-gray-700 text-xs">
          {ISSUE_LABELS[info.getValue<string>()] ?? info.getValue<string>()}
        </span>
      ),
    },
    {
      id: 'url',
      accessorKey: 'url',
      header: 'Page',
      cell: info => (
        <a
          href={info.getValue<string>()}
          target="_blank"
          rel="noopener noreferrer"
          className="text-emerald-600 hover:underline flex items-center gap-1 max-w-[200px] truncate"
        >
          <span className="truncate">{info.getValue<string>()}</span>
          <ExternalLink className="w-3 h-3 shrink-0" />
        </a>
      ),
      enableSorting: false,
    },
    {
      id: 'message',
      accessorKey: 'message',
      header: 'Details',
      cell: info => <span className="text-xs text-gray-500 max-w-xs block">{info.getValue<string>()}</span>,
      enableSorting: false,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => row.original.id ? (
        <a
          href={`/admin/pills/${row.original.id}`}
          className="text-xs text-indigo-500 hover:text-indigo-700 font-medium whitespace-nowrap"
        >
          Edit →
        </a>
      ) : null,
      enableSorting: false,
    },
  ], [])

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 20 } },
  })

  const uniqueTypes = useMemo(() => Array.from(new Set(issues.map(i => i.issue_type))), [issues])

  const critCount = issues.filter(i => i.severity === 'critical').length
  const warnCount = issues.filter(i => i.severity === 'warning').length

  return (
    <div className="space-y-4">
      {/* Summary badges */}
      <div className="flex flex-wrap gap-3">
        <div className="px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-xs font-medium text-gray-600">
          {totalPages.toLocaleString()} pages checked
        </div>
        <div className="px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700">
          {critCount} critical
        </div>
        <div className="px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-xs font-medium text-amber-700">
          {warnCount} warnings
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select
          value={severityFilter}
          onChange={e => setSeverityFilter(e.target.value)}
          className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-emerald-400"
        >
          <option value="all">All severities</option>
          <option value="critical">Critical only</option>
          <option value="warning">Warnings only</option>
        </select>

        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-emerald-400"
        >
          <option value="all">All issue types</option>
          {uniqueTypes.map(t => (
            <option key={t} value={t}>{ISSUE_LABELS[t] ?? t}</option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        {filtered.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-emerald-600 font-medium">✓ No issues found</p>
            <p className="text-gray-400 text-xs mt-1">All filtered pages look healthy.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  {table.getHeaderGroups().map(hg => (
                    <tr key={hg.id} className="border-b border-gray-100 bg-gray-50">
                      {hg.headers.map(header => (
                        <th
                          key={header.id}
                          className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none whitespace-nowrap"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          <span className="flex items-center gap-1">
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {header.column.getCanSort() && (
                              header.column.getIsSorted() === 'asc'
                                ? <ChevronUp className="w-3 h-3" />
                                : header.column.getIsSorted() === 'desc'
                                ? <ChevronDown className="w-3 h-3" />
                                : <ChevronsUpDown className="w-3 h-3 opacity-30" />
                            )}
                          </span>
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map((row, idx) => (
                    <tr
                      key={row.id}
                      className={`border-b border-gray-50 hover:bg-emerald-50 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
                    >
                      {row.getVisibleCells().map(cell => (
                        <td key={cell.id} className="px-4 py-2.5 text-gray-700 whitespace-nowrap">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <span className="text-xs text-gray-500">
                {filtered.length} issues • Page {table.getState().pagination.pageIndex + 1} of {Math.max(1, table.getPageCount())}
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                  className="px-2.5 py-1 text-xs rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
                >
                  ‹ Prev
                </button>
                <button
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                  className="px-2.5 py-1 text-xs rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
                >
                  Next ›
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
