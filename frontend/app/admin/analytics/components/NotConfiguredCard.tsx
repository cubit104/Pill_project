'use client'

import { Settings } from 'lucide-react'

interface NotConfiguredCardProps {
  service: string
  message: string
  steps?: string[]
}

export default function NotConfiguredCard({ service, message, steps }: NotConfiguredCardProps) {
  const defaultSteps: Record<string, string[]> = {
    GA4: [
      'Create a Google Analytics 4 property at analytics.google.com',
      'Create a service account in GCP console with Analytics Viewer role',
      'Download the service account JSON key',
      'Set GA4_PROPERTY_ID and GA4_SERVICE_ACCOUNT_JSON in your .env',
      'See docs/admin-analytics.md for full instructions',
    ],
    'Search Console': [
      'Verify your site in Google Search Console (search.google.com/search-console)',
      'Grant your service account access as a Restricted User',
      'Set SEARCH_CONSOLE_SITE_URL (must match exact verified URL)',
      'Set GA4_SERVICE_ACCOUNT_JSON with the same service account used for GA4',
    ],
    'PageSpeed Insights': [
      'Get a free API key at https://developers.google.com/speed/docs/insights/v5/get-started',
      'Set PAGESPEED_API_KEY in your .env',
    ],
  }

  const displaySteps = steps ?? defaultSteps[service] ?? []

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
          <Settings className="w-5 h-5 text-amber-600" />
        </div>
        <div>
          <h3 className="font-semibold text-amber-800 text-sm">{service} not configured</h3>
          <p className="text-xs text-amber-600 mt-0.5">{message}</p>
        </div>
      </div>

      {displaySteps.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-amber-700 mb-2 uppercase tracking-wide">Setup steps</p>
          <ol className="space-y-1.5">
            {displaySteps.map((step, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-amber-700">
                <span className="shrink-0 w-5 h-5 rounded-full bg-amber-200 text-amber-800 flex items-center justify-center text-xs font-bold">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}
