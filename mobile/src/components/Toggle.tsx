import { hapticTick } from '../lib/native'

interface Props {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: string
}

export default function Toggle({ checked, onChange, label, description }: Props) {
  return (
    <label className="flex min-h-[44px] items-center justify-between gap-4 py-2">
      <span className="min-w-0">
        <span className="block text-[17px] text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-[14px] leading-snug text-muted">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className="switch"
        onClick={() => {
          void hapticTick()
          onChange(!checked)
        }}
      />
    </label>
  )
}
