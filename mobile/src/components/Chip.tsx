import type { ReactNode } from 'react'

interface Props {
  selected: boolean
  onClick: () => void
  children: ReactNode
  leading?: ReactNode
  label?: string
}

export default function Chip({ selected, onClick, children, leading, label }: Props) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      onClick={onClick}
      className={`pressable inline-flex h-11 flex-none items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[15px] font-medium transition-colors ${
        selected ? 'bg-brand text-brand-fg' : 'hairline bg-surface text-body active:bg-brand-tint'
      }`}
    >
      {leading}
      {children}
    </button>
  )
}

export function ColorDot({ hex, className = '' }: { hex: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-3.5 w-3.5 flex-none rounded-full border border-black/15 ${className}`}
      style={{ background: hex }}
    />
  )
}

/** Horizontal, edge-to-edge scrolling chip row. */
export function ChipRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-1">
      {children}
    </div>
  )
}
