'use client'

import { AlertCircle, RefreshCw } from 'lucide-react'

export default function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-5 flex items-start gap-3">
      <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-red-700">Failed to load data</p>
        <p className="text-xs text-red-500 mt-0.5 break-all">{message}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="shrink-0 text-red-600 hover:text-red-700 transition-colors"
          title="Retry"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
