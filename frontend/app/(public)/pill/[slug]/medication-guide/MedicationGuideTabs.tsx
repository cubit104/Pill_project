import Link from 'next/link'

type TabId = 'consumer' | 'dosage' | 'adverse' | 'interactions' | 'pro'

type TabItem = {
  id: TabId
  label: string
  href: string
}

function tabClasses(active: boolean, fullWidth = false): string {
  return [
    'inline-flex min-h-[3rem] items-center justify-center rounded-lg border px-3 py-2 text-center text-sm font-medium transition-colors',
    fullWidth ? 'col-span-2' : '',
    'sm:min-h-0 sm:justify-start sm:rounded-none sm:border-0 sm:border-b-2 sm:px-1 sm:py-3 sm:text-left sm:whitespace-nowrap',
    active
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 sm:border-emerald-700 sm:bg-transparent'
      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-800 sm:border-transparent sm:bg-transparent sm:text-slate-500 sm:hover:text-slate-700',
  ].filter(Boolean).join(' ')
}

export default function MedicationGuideTabs({
  activeTab,
  medicationGuideHref,
  summaryHref = null,
  dosageHref = null,
  adverseReactionsHref = null,
  interactionsHref = null,
  professionalHref,
}: {
  activeTab: TabId
  medicationGuideHref: string | null
  summaryHref?: string | null
  dosageHref?: string | null
  adverseReactionsHref?: string | null
  interactionsHref?: string | null
  professionalHref: string
}) {
  const leftTabHref = summaryHref ?? medicationGuideHref
  const leftTabLabel = summaryHref ? 'Medication Summary' : 'Medication Guide'

  const tabs: TabItem[] = [
    ...(leftTabHref ? [{ id: 'consumer' as const, label: leftTabLabel, href: leftTabHref }] : []),
    ...(dosageHref ? [{ id: 'dosage' as const, label: 'Dosage', href: dosageHref }] : []),
    ...(adverseReactionsHref ? [{ id: 'adverse' as const, label: 'Side Effects', href: adverseReactionsHref }] : []),
    ...(interactionsHref ? [{ id: 'interactions' as const, label: 'Interactions', href: interactionsHref }] : []),
    { id: 'pro' as const, label: 'Professional Information', href: professionalHref },
  ]

  const isFiveTabMobileLayout = tabs.length === 5

  return (
    <div className="no-print bg-white border border-slate-200 rounded-xl shadow-sm p-3 sm:px-6 sm:py-0">
      <nav
        role="navigation"
        className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-6 sm:border-b sm:border-slate-200"
        aria-label="Medication content tabs"
      >
        {tabs.map((tab, index) => {
          const isActive = activeTab === tab.id
          const fullWidth = isFiveTabMobileLayout && index === tabs.length - 1

          if (isActive) {
            return (
              <span key={tab.id} className={tabClasses(true, fullWidth)} aria-current="page">
                {tab.label}
              </span>
            )
          }

          return (
            <Link key={tab.id} href={tab.href} className={tabClasses(false, fullWidth)}>
              {tab.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
