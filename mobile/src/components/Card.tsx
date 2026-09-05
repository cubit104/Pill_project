import type { HTMLAttributes, ReactNode } from 'react'

interface Props extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  padded?: boolean
  tone?: 'surface' | 'tint' | 'danger' | 'warn'
}

const TONE = {
  surface: 'card',
  tint: 'rounded-card border border-[color-mix(in_srgb,var(--brand)_25%,transparent)] bg-brand-tint',
  danger: 'rounded-card border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[var(--danger-tint)]',
  warn: 'rounded-card border border-[color-mix(in_srgb,var(--warn)_30%,transparent)] bg-[var(--warn-tint)]',
}

export default function Card({ children, padded = true, tone = 'surface', className = '', ...rest }: Props) {
  return (
    <div {...rest} className={`${TONE[tone]} ${padded ? 'p-4' : ''} ${className}`}>
      {children}
    </div>
  )
}

export function SectionLabel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`section-label mb-2 px-1 ${className}`}>{children}</p>
}
