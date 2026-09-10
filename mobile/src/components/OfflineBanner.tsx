import { useOnline } from '../lib/hooks'
import { useT } from '../lib/i18n'
import { WifiOffIcon } from './Icons'

export default function OfflineBanner() {
  const online = useOnline()
  const t = useT()
  if (online) return null
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-40 flex items-center justify-center gap-2 bg-ink px-4 py-2 text-[14px] font-medium text-canvas"
      style={{ paddingTop: 'calc(var(--safe-top) + 8px)' }}
    >
      <WifiOffIcon size={18} />
      {t('No internet connection')}
    </div>
  )
}
