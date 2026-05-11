'use client'

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

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
  const medguideTabRef = useRef<HTMLButtonElement | null>(null)
  const proTabRef = useRef<HTMLButtonElement | null>(null)
  const tabs: TabId[] = hasMedguide ? ['consumer', 'pro'] : ['pro']

  const focusTab = (tab: TabId) => {
    if (tab === 'consumer') medguideTabRef.current?.focus()
    if (tab === 'pro') proTabRef.current?.focus()
  }

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentTab: TabId) => {
    if (tabs.length === 1) return
    const currentIndex = tabs.indexOf(currentTab)
    if (currentIndex < 0) return

    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      const direction = event.key === 'ArrowRight' ? 1 : -1
      const nextIndex = (currentIndex + direction + tabs.length) % tabs.length
      const nextTab = tabs[nextIndex]
      setActiveTab(nextTab)
      focusTab(nextTab)
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      const firstTab = tabs[0]
      setActiveTab(firstTab)
      focusTab(firstTab)
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      const lastTab = tabs[tabs.length - 1]
      setActiveTab(lastTab)
      focusTab(lastTab)
    }
  }

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
              tabIndex={activeTab === 'consumer' ? 0 : -1}
              ref={medguideTabRef}
              onClick={() => setActiveTab('consumer')}
              onKeyDown={(event) => handleTabKeyDown(event, 'consumer')}
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
            tabIndex={activeTab === 'pro' ? 0 : -1}
            ref={proTabRef}
            onClick={() => setActiveTab('pro')}
            onKeyDown={(event) => handleTabKeyDown(event, 'pro')}
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
