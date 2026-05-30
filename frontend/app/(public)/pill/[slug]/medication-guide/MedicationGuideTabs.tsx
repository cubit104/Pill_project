import Link from 'next/link'

type TabId = 'consumer' | 'dosage' | 'pro'

function tabClasses(active: boolean): string {
  return `px-1 py-3 text-sm font-medium border-b-2 transition-colors ${
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
  professionalHref,
}: {
  activeTab: TabId
  medicationGuideHref: string | null
  summaryHref?: string | null
  dosageHref?: string | null
  professionalHref: string
}) {
  const leftTabHref = summaryHref ?? medicationGuideHref
  const leftTabLabel = summaryHref ? 'Medication Summary' : 'Medication Guide'

  return (
    <div className="no-print bg-white border border-slate-200 rounded-xl shadow-sm px-4 sm:px-6">
      <nav
        role="navigation"
        className="flex gap-4 sm:gap-6 border-b border-slate-200"
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
