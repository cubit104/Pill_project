import { useEffect, useState, type ReactNode } from 'react'

interface Props {
  title: string
  subtitle?: string
  /** Element rendered on the right of the large title (e.g. a Clear button). */
  trailing?: ReactNode
  /** Content pinned under the title, inside the sticky bar (search field). */
  children?: ReactNode
  scrollRef: React.RefObject<HTMLDivElement | null>
}

/**
 * Large title that collapses into a compact bar when the screen scrolls.
 * The whole header is sticky; only the big title fades/shrinks.
 */
export default function ScreenHeader({ title, subtitle, trailing, children, scrollRef }: Props) {
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setCollapsed(el.scrollTop > 28))
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [scrollRef])

  return (
    <header
      className={`sticky top-0 z-20 bg-[color-mix(in_srgb,var(--canvas)_95%,transparent)] backdrop-blur transition-shadow duration-base ${
        collapsed ? 'shadow-[0_1px_0_var(--border)]' : ''
      }`}
      style={{ paddingTop: 'var(--safe-top)', paddingLeft: 'var(--safe-left)', paddingRight: 'var(--safe-right)' }}
    >
      <div className="relative mx-auto max-w-lg px-4">
        {/* Compact bar */}
        <div
          className={`flex h-11 items-center justify-center transition-opacity duration-fast ${
            collapsed ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
          aria-hidden={!collapsed}
        >
          <span className="text-[17px] font-semibold text-ink">{title}</span>
        </div>
        {/* Large title */}
        <div
          className={`flex items-end justify-between gap-3 overflow-hidden transition-all duration-base ${
            collapsed ? 'max-h-0 opacity-0' : 'max-h-24 pb-2 opacity-100'
          }`}
        >
          <div className="min-w-0">
            <h1 className="large-title truncate">{title}</h1>
            {subtitle && <p className="mt-0.5 text-[15px] text-muted">{subtitle}</p>}
          </div>
          {trailing && <div className="flex-none pb-0.5">{trailing}</div>}
        </div>
        {children && <div className="pb-3">{children}</div>}
      </div>
    </header>
  )
}
