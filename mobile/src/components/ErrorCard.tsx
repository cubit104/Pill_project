import { ApiError } from '../lib/api'
import Button from './Button'
import Card from './Card'
import { AlertIcon, RefreshIcon, WifiOffIcon } from './Icons'

interface Props {
  error: ApiError | Error
  onRetry?: () => void
  /** Optional alternative action, e.g. "Type the imprint instead". */
  secondary?: { label: string; onClick: () => void }
}

export default function ErrorCard({ error, onRetry, secondary }: Props) {
  const api = error instanceof ApiError ? error : null
  const title = api?.title ?? 'Something went wrong'
  const retryable = api ? api.retryable : true
  const tone = api?.kind === 'feature_off' || api?.kind === 'warming_up' ? 'warn' : 'danger'
  const Icon = api?.kind === 'offline' ? WifiOffIcon : AlertIcon
  return (
    <Card tone={tone} role="alert">
      <div className="flex gap-3">
        <Icon size={22} className={`mt-0.5 flex-none ${tone === 'warn' ? 'text-[var(--warn)]' : 'text-danger'}`} />
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-semibold text-ink">{title}</p>
          <p className="mt-1 text-[15px] leading-relaxed text-body">{error.message}</p>
          {(retryable && onRetry) || secondary ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {retryable && onRetry && (
                <Button size="sm" variant="secondary" icon={<RefreshIcon size={18} />} onClick={onRetry}>
                  Try again
                </Button>
              )}
              {secondary && (
                <Button size="sm" variant="ghost" onClick={secondary.onClick}>
                  {secondary.label}
                </Button>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  )
}
