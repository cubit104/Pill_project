import Link from 'next/link'

type TabId = 'consumer' | 'dosage' | 'adverse' | 'interactions' | 'pro'

type TabItem = {
  id: TabId
  label: string
  mobileLabel?: string
  href: string
}

function tabClasses(active: boolean): string {
  return [
    'inline-flex min-h-[2.5rem] items-center justify-center rounded-md border px-2 py-1 text-center text-[13px] font-medium leading-tight transition-colors',
    'whitespace-normal break-words sm:min-h-0 sm:justify-start sm:rounded-none sm:border-0 sm:border-b-2 sm:px-1 sm:py-3 sm:text-sm sm:text-left sm:leading-normal sm:whitespace-nowrap',
    active
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 sm:border-emerald-700 sm:bg-transparent'
      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-800 sm:border-transparent sm:bg-transparent sm:text-slate-500 sm:hover:text-slate-700',
  ].join(' ')
}

/**
 * Returns the grid column-span class for a tab in the mobile 2-row layout.
 *
 * With 5 tabs we use a 6-column grid:
 *   Row 1 – first 3 tabs each span 2 cols  → [Med Guide][Dosage][Side Fx]
 *   Row 2 – last  2 tabs each span 3 cols  → [Interact.][Pro Info]
 *
 * With ≤ 4 tabs we use the same 6-column grid but every tab spans 3 cols
 * so we always get at most 2 per row.
 */
function mobileColSpan(index: number, total: number): string {
  if (total <= 4) return 'col-span-3'
  return index < 3 ? 'col-span-2' : 'col-span-3'
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
    ...(leftTabHref ? [{ id: 'consumer' as const, label: leftTabLabel, mobileLabel: 'Med Guide', href: leftTabHref }] : []),
    ...(dosageHref ? [{ id: 'dosage' as const, label: 'Dosage', href: dosageHref }] : []),
    ...(adverseReactionsHref ? [{ id: 'adverse' as const, label: 'Side Effects', mobileLabel: 'Side Fx', href: adverseReactionsHref }] : []),
    ...(interactionsHref ? [{ id: 'interactions' as const, label: 'Interactions', mobileLabel: 'Interact.', href: interactionsHref }] : []),
    { id: 'pro' as const, label: 'Professional Information', mobileLabel: 'Pro Info', href: professionalHref },
  ]

  return (
    <div className="no-print bg-white border border-slate-200 rounded-xl shadow-sm p-3 sm:px-6 sm:py-0">
      {/* Mobile: 2-row grid — 3 tabs in row 1, 2 tabs in row 2 */}
      <nav
        role="navigation"
        className="grid grid-cols-6 gap-2 sm:hidden"
        aria-label="Medication content tabs"
      >
        {tabs.map((tab, idx) => {
          const isActive = activeTab === tab.id
          const label = tab.mobileLabel ?? tab.label
          const colClass = mobileColSpan(idx, tabs.length)

          if (isActive) {
            return (
              <span key={tab.id} className={`${tabClasses(true)} ${colClass}`} aria-current="page">
                {label}
              </span>
            )
          }

          return (
            <Link key={tab.id} href={tab.href} className={`${tabClasses(false)} ${colClass}`}>
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Desktop: horizontal tab bar */}
      <nav
        role="navigation"
        className="hidden sm:flex sm:flex-wrap sm:gap-6 sm:border-b sm:border-slate-200"
        aria-label="Medication content tabs"
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id

          if (isActive) {
            return (
              <span key={tab.id} className={tabClasses(true)} aria-current="page">
                {tab.label}
              </span>
            )
          }

          return (
            <Link key={tab.id} href={tab.href} className={tabClasses(false)}>
              {tab.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
