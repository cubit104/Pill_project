import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { CloseIcon } from './Icons'

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: string
  onChange: (value: string) => void
  onClear?: () => void
  leading?: ReactNode
  label: string
}

const TextField = forwardRef<HTMLInputElement, Props>(function TextField({ value, onChange, onClear, leading, label, className = '', ...rest }, ref) {
  return (
    <div className={`flex h-12 items-center gap-2 rounded-2xl border border-line bg-surface px-3 focus-within:border-brand ${className}`}>
      {leading && <span className="flex-none text-muted">{leading}</span>}
      <input
        ref={ref}
        {...rest}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        className="h-full min-w-0 flex-1 bg-transparent text-[17px] text-ink placeholder:text-muted"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear"
          onClick={() => {
            onChange('')
            onClear?.()
          }}
          className="pressable -mr-1 flex h-11 w-11 flex-none items-center justify-center rounded-full text-muted"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-line text-ink">
            <CloseIcon size={12} strokeWidth={2.6} />
          </span>
        </button>
      )}
    </div>
  )
})

export default TextField
