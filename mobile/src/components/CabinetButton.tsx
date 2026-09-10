import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CabinetIcon, CheckIcon } from './Icons'
import { useToast } from './Toast'
import { useAccount } from '../lib/account'
import { useT } from '../lib/i18n'
import { hapticNotify, hapticTick } from '../lib/native'

/**
 * "Add to my cabinet" — one tap on any pill. Signed-out users are taken to
 * sign in and come back to the same pill afterwards.
 */
export default function CabinetButton({ slug, size = 'md' }: { slug: string; size?: 'sm' | 'md' }) {
  const t = useT()
  const account = useAccount()
  const navigate = useNavigate()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  if (!account.enabled) return null
  const saved = account.has(slug)

  const onPress = async () => {
    void hapticTick()
    if (!account.user) {
      navigate('/account')
      return
    }
    if (saved) {
      navigate('/cabinet')
      return
    }
    setBusy(true)
    try {
      await account.add(slug)
      void hapticNotify('success')
      toast.show(t('Added to your cabinet'), 'success')
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t('Could not add'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const cls = size === 'sm' ? 'min-h-[36px] px-3 text-[13px]' : 'min-h-[44px] px-4 text-[15px]'
  return (
    <button
      type="button"
      onClick={() => void onPress()}
      disabled={busy}
      aria-pressed={saved}
      className={`pressable inline-flex items-center gap-1.5 rounded-full font-semibold transition-colors ${cls} ${
        saved ? 'bg-brand-tint text-brand' : 'bg-brand text-brand-fg active:bg-brand-pressed'
      }`}
    >
      {saved ? <CheckIcon size={16} /> : <CabinetIcon size={18} />}
      {saved ? t('In my cabinet') : busy ? t('Adding…') : t('Add to my cabinet')}
    </button>
  )
}
