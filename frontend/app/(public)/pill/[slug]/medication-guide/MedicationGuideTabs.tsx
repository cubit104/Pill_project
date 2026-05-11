import Link from 'next/link'

type TabId = 'consumer' | 'pro'

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
  professionalHref,
}: {
  activeTab: TabId
  medicationGuideHref: string | null
  professionalHref: string
}) {
  return (
    <div className="no-print bg-white border border-slate-200 rounded-xl shadow-sm px-4 sm:px-6">
      <nav
        role="navigation"
        className="flex gap-4 sm:gap-6 border-b border-slate-200"
        aria-label="Medication content tabs"
      >
        {medicationGuideHref && (
          activeTab === 'consumer' ? (
            <span className={tabClasses(true)} aria-current="page">
              Medication Guide
            </span>
          ) : (
            <Link href={medicationGuideHref} className={tabClasses(false)}>
              Medication Guide
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
