import Link from 'next/link'

type TabId = 'consumer' | 'dosage' | 'adverse' | 'interactions' | 'pro'

function tabClasses(active: boolean): string {
  return `inline-flex shrink-0 items-center whitespace-nowrap px-1 py-3 text-sm font-medium border-b-2 transition-colors ${
    active
      ? 'text-emerald-700 border-emerald-700'
      : 'text-slate-500 border-transparent hover:text-slate-700'
  }`
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
    <div className="no-print bg-white border border-slate-200 rounded-xl shadow-sm px-4 sm:px-6">
      <div className="-mx-4 overflow-x-auto border-b border-slate-200 px-4 sm:mx-0 sm:px-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <nav
          role="navigation"
          className="flex min-w-max gap-4 sm:gap-6"
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
    </div>
  )
}
