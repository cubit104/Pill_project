'use client'

import { useState, useMemo } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { fmtNumber, fmtPercent, fmtPosition } from '../lib/formatters'

interface Query {
  query: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

interface Props {
  data: Query[]
  title?: string
}

export default function TopQueriesTable({ data, title = 'Top Search Queries' }: Props) {
  const [sorting, setSorting] = useState<SortingState>([])

  const columns = useMemo<ColumnDef<Query>[]>(() => [
    {
      accessorKey: 'query',
      header: 'Query',
      cell: info => <span className="font-medium text-gray-800">{info.getValue<string>()}</span>,
      enableSorting: false,
    },
    {
      accessorKey: 'clicks',
      header: 'Clicks',
      cell: info => fmtNumber(info.getValue<number>()),
    },
    {
      accessorKey: 'impressions',
      header: 'Impressions',
      cell: info => fmtNumber(info.getValue<number>()),
    },
    {
      accessorKey: 'ctr',
      header: 'CTR',
      cell: info => fmtPercent(info.getValue<number>()),
    },
    {
      accessorKey: 'position',
      header: 'Position',
      cell: info => (
        <span className={`font-mono ${
          info.getValue<number>() <= 3 ? 'text-emerald-600 font-bold'
          : info.getValue<number>() <= 10 ? 'text-blue-600'
          : 'text-gray-500'
        }`}>
          {fmtPosition(info.getValue<number>())}
        </span>
      ),
    },
  ], [])

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
  })

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
      <div className="p-4 border-b border-gray-100">
        <h3 className="font-semibold text-gray-900 text-sm">{title}</h3>
      </div>
      {data.length === 0 ? (
        <p className="text-center text-gray-400 text-sm p-8">No query data available</p>
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

          {table.getPageCount() > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <span className="text-xs text-gray-500">
                Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
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
          )}
        </>
      )}
    </div>
  )
}
