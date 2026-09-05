import { hapticTick } from '../lib/native'

interface Option<T extends string> {
  value: T
  label: string
}

interface Props<T extends string> {
  options: readonly Option<T>[]
  value: T
  onChange: (value: T) => void
  label: string
}

export default function SegmentedControl<T extends string>({ options, value, onChange, label }: Props<T>) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  )
  return (
    <div role="tablist" aria-label={label} className="relative flex h-11 rounded-2xl bg-[color-mix(in_srgb,var(--border)_60%,transparent)] p-1">
      <div
        aria-hidden
        className="absolute bottom-1 top-1 rounded-xl bg-surface shadow-card transition-transform duration-base ease-out"
        style={{
          width: `calc((100% - 8px) / ${options.length})`,
          transform: `translateX(${index * 100}%)`,
          left: 4,
        }}
      />
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => {
              if (!active) {
                void hapticTick()
                onChange(o.value)
              }
            }}
            className={`relative z-10 flex-1 rounded-xl text-[15px] font-semibold transition-colors ${
              active ? 'text-ink' : 'text-muted'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
