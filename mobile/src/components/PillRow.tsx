import { useState, type ReactNode } from 'react'
import { useT } from '../lib/i18n'
import { ChevronRightIcon, PillIcon } from './Icons'

interface Props {
  image: string | null
  name: string
  strength?: string | null
  imprint?: string | null
  color?: string | null
  shape?: string | null
  /** Right-aligned badge (match %, quality, etc.). */
  badge?: ReactNode
  /** Row rendered below the main line (feedback buttons). */
  footer?: ReactNode
  onPress: () => void
  ariaLabel?: string
}

export function PillThumb({ src, alt, size = 64 }: { src: string | null; alt: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return (
      <div
        className="flex flex-none items-center justify-center rounded-xl bg-canvas text-muted hairline"
        style={{ width: size, height: size }}
        aria-hidden
      >
        <PillIcon size={size * 0.45} />
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="flex-none rounded-xl bg-white object-cover hairline"
      style={{ width: size, height: size }}
    />
  )
}

/** A tappable result row used by search, identify and recent lists. */
export default function PillRow({ image, name, strength, imprint, color, shape, badge, footer, onPress, ariaLabel }: Props) {
  const t = useT()
  const attrs = [color, shape].filter((v): v is string => Boolean(v && v.trim())).map(titleCase)
  return (
    <div className="bg-surface">
      <button
        type="button"
        onClick={onPress}
        aria-label={ariaLabel ?? t('{name}, open details', { name: strength ? `${name} ${strength}` : name })}
        className="pressable flex w-full items-center gap-3 px-4 py-3 text-left active:bg-brand-tint"
      >
        <PillThumb src={image} alt="" />
        <div className="min-w-0 flex-1">
          <p className="selectable truncate text-[17px] font-semibold leading-snug text-ink">
            {name}
            {strength && <span className="ml-1.5 font-normal text-muted">{strength}</span>}
          </p>
          <p className="selectable mt-0.5 truncate text-[14px] text-body">
            <span className="text-muted">{t('Imprint')}</span> {imprint && imprint.trim() ? imprint : '—'}
          </p>
          {attrs.length > 0 && <p className="mt-0.5 truncate text-[13px] text-muted">{attrs.join(' · ')}</p>}
        </div>
        <div className="flex flex-none items-center gap-1.5">
          {badge}
          <ChevronRightIcon size={20} className="text-line" />
        </div>
      </button>
      {footer && <div className="px-4 pb-3">{footer}</div>}
    </div>
  )
}

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/([;,/\s]+)/)
    .map((part) => (part.match(/^[;,/\s]+$/) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('')
}

export function ScoreBadge({ value, label, tone = 'brand' }: { value: number; label?: string; tone?: 'brand' | 'neutral' | 'amber' }) {
  const styles = {
    brand: 'bg-brand-tint text-brand',
    neutral: 'bg-[color-mix(in_srgb,var(--border)_70%,transparent)] text-body',
    amber: 'bg-[var(--warn-tint)] text-[var(--warn)]',
    danger: 'bg-[var(--danger-tint)] text-danger',
  }
  return (
    <span className={`flex flex-col items-end rounded-xl px-2.5 py-1.5 ${styles[tone]}`}>
      <span className="tabular text-[15px] font-bold leading-none">{Math.round(value * 100)}%</span>
      {label && <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide leading-none">{label}</span>}
    </span>
  )
}

export function TextBadge({ children, tone = 'brand' }: { children: ReactNode; tone?: 'brand' | 'neutral' | 'amber' | 'danger' }) {
  const styles = {
    brand: 'bg-brand-tint text-brand',
    neutral: 'bg-[color-mix(in_srgb,var(--border)_70%,transparent)] text-body',
    amber: 'bg-[var(--warn-tint)] text-[var(--warn)]',
    danger: 'bg-[var(--danger-tint)] text-danger',
  }
  return <span className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${styles[tone]}`}>{children}</span>
}
