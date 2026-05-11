'use client'

import { useState, type ReactNode } from 'react'

type TabId = 'consumer' | 'pro'

export default function MedicationGuideTabs({
  hasMedguide,
  defaultTab,
  consumerContent,
  proContent,
}: {
  hasMedguide: boolean
  defaultTab: TabId
  consumerContent: ReactNode
  proContent: ReactNode
}) {
  const [activeTab, setActiveTab] = useState<TabId>(defaultTab)

  return (
    <div className="space-y-6">
      <div className="no-print bg-white border border-slate-200 rounded-xl shadow-sm px-4 sm:px-6">
        <div className="flex gap-4 sm:gap-6 border-b border-slate-200" role="tablist" aria-label="Guide type">
          {hasMedguide && (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'consumer'}
              aria-controls="medguide-panel"
              id="medguide-tab"
              onClick={() => setActiveTab('consumer')}
              className={`px-1 py-3 text-sm font-medium border-b-2 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 ${
                activeTab === 'consumer'
                  ? 'text-emerald-700 border-emerald-700'
                  : 'text-slate-500 border-transparent hover:text-slate-700'
              }`}
            >
              Medication Guide
            </button>
          )}
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'pro'}
            aria-controls="pro-panel"
            id="pro-tab"
            onClick={() => setActiveTab('pro')}
            className={`px-1 py-3 text-sm font-medium border-b-2 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 ${
              activeTab === 'pro'
                ? 'text-emerald-700 border-emerald-700'
                : 'text-slate-500 border-transparent hover:text-slate-700'
            }`}
          >
            Full Prescribing Information
          </button>
        </div>
      </div>

      {hasMedguide && (
        <div
          id="medguide-panel"
          role="tabpanel"
          aria-labelledby="medguide-tab"
          hidden={activeTab !== 'consumer'}
          className="transition-opacity duration-200"
        >
          {consumerContent}
        </div>
      )}

      <div
        id="pro-panel"
        role="tabpanel"
        aria-labelledby="pro-tab"
        hidden={activeTab !== 'pro'}
        className="transition-opacity duration-200"
      >
        {proContent}
      </div>
    </div>
  )
}
