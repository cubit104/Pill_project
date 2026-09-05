import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'md' | 'lg' | 'sm'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  loading?: boolean
  full?: boolean
}

const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand text-brand-fg active:bg-brand-pressed shadow-[0_6px_16px_-8px_rgba(5,150,105,0.7)]',
  secondary: 'bg-surface text-ink hairline active:bg-brand-tint',
  ghost: 'bg-transparent text-brand active:bg-brand-tint',
  danger: 'bg-transparent text-danger active:bg-[var(--danger-tint)]',
}

const SIZE: Record<Size, string> = {
  sm: 'min-h-[44px] px-4 text-[15px]',
  md: 'min-h-[48px] px-5 text-[17px]',
  lg: 'min-h-[54px] px-6 text-[17px]',
}

export default function Button({ variant = 'primary', size = 'md', icon, loading, full, className = '', children, disabled, ...rest }: Props) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`pressable inline-flex items-center justify-center gap-2 rounded-2xl font-semibold ${VARIANT[variant]} ${SIZE[size]} ${
        full ? 'w-full' : ''
      } disabled:opacity-50 disabled:pointer-events-none ${className}`}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  )
}

export function Spinner({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={`spin ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  tone?: 'default' | 'light'
}

export function IconButton({ label, tone = 'default', className = '', children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      {...rest}
      className={`pressable inline-flex h-11 w-11 items-center justify-center rounded-full ${
        tone === 'light' ? 'bg-white/15 text-white active:bg-white/25' : 'text-muted active:bg-brand-tint'
      } ${className}`}
    >
      {children}
    </button>
  )
}
