import Link from 'next/link'

type TabId = 'consumer' | 'dosage' | 'adverse' | 'interactions' | 'pro'

function tabClasses(active: boolean): string {
  return [
    'inline-flex min-h-[3rem] items-center justify-center rounded-lg border px-3 py-2 text-center text-sm font-medium transition-colors',
    'whitespace-normal break-words sm:min-h-0 sm:justify-start sm:rounded-none sm:border-0 sm:border-b-2 sm:px-1 sm:py-3 sm:text-left sm:whitespace-nowrap',
    active
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 sm:border-emerald-700 sm:bg-transparent'
      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-800 sm:border-transparent sm:bg-transparent sm:text-slate-500 sm:hover:text-slate-700',
  ].join(' ')
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

  return (
    <div className="no-print bg-white border border-slate-200 rounded-xl shadow-sm p-3 sm:px-6 sm:py-0">
      <nav
        role="navigation"
        className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-6 sm:border-b sm:border-slate-200"
        aria-label="Medication content tabs"
      >
        {leftTabHref && (
          activeTab === 'consumer' ? (
            <span className={tabClasses(true)} aria-current="page">
              {leftTabLabel}
            </span>
          ) : (
            <Link href={leftTabHref} className={tabClasses(false)}>
              {leftTabLabel}
            </Link>
          )
        )}
        {dosageHref && (
          activeTab === 'dosage' ? (
            <span className={tabClasses(true)} aria-current="page">
              Dosage
            </span>
          ) : (
            <Link href={dosageHref} className={tabClasses(false)}>
              Dosage
            </Link>
          )
        )}
        {adverseReactionsHref && (
          activeTab === 'adverse' ? (
            <span className={tabClasses(true)} aria-current="page">
              Side Effects
            </span>
          ) : (
            <Link href={adverseReactionsHref} className={tabClasses(false)}>
              Side Effects
            </Link>
          )
        )}
        {interactionsHref && (
          activeTab === 'interactions' ? (
            <span className={tabClasses(true)} aria-current="page">
              Interactions
            </span>
          ) : (
            <Link href={interactionsHref} className={tabClasses(false)}>
              Interactions
            </Link>
          )
        )}
        {activeTab === 'pro' ? (
          <span className={tabClasses(true)} aria-current="page">
            Professional Information
          </span>
        ) : (
          <Link href={professionalHref} className={tabClasses(false)}>
            Professional Information
          </Link>
        )}
      </nav>
    </div>
  )
}
