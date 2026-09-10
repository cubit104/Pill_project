import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from './Button'
import Card from './Card'
import { ChevronRightIcon, TrashIcon } from './Icons'
import { PillThumb } from './PillRow'
import Sheet from './Sheet'
import TextField from './TextField'
import { useToast } from './Toast'
import { useAccount } from '../lib/account'
import type { CabinetItem } from '../lib/cabinet'
import { useLocale, useT } from '../lib/i18n'
import { scheduleFromSig } from '../lib/labelParse'
import { hapticTick } from '../lib/native'
import { ensureNotificationPermission } from '../lib/reminders'

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 px-1 text-[13px] font-semibold text-body">{label}</p>
      {children}
    </div>
  )
}

/**
 * Everything about one cabinet item that is not the pill itself: nickname,
 * directions as printed, Rx number, pharmacy (tap to call = request a refill),
 * prescriber, refills left, notes. Filled by the bottle scan or by hand.
 */
export default function ItemSheet({ item, name, image, onClose, onRemove }: { item: CabinetItem; name: string; image: string | null; onClose: () => void; onRemove: () => void }) {
  const t = useT()
  const locale = useLocale()
  const navigate = useNavigate()
  const account = useAccount()
  const toast = useToast()
  const [nickname, setNickname] = useState(item.nickname ?? '')
  const [directions, setDirections] = useState(item.directions ?? '')
  const [rx, setRx] = useState(item.rx_number ?? '')
  const [pharmacy, setPharmacy] = useState(item.pharmacy_name ?? '')
  const [phone, setPhone] = useState(item.pharmacy_phone ?? '')
  const [prescriber, setPrescriber] = useState(item.prescriber ?? '')
  const [refills, setRefills] = useState(item.refills_left === null ? '' : String(item.refills_left))
  const [notes, setNotes] = useState(item.notes ?? '')
  const [busy, setBusy] = useState(false)

  const dirty =
    nickname !== (item.nickname ?? '') ||
    directions !== (item.directions ?? '') ||
    rx !== (item.rx_number ?? '') ||
    pharmacy !== (item.pharmacy_name ?? '') ||
    phone !== (item.pharmacy_phone ?? '') ||
    prescriber !== (item.prescriber ?? '') ||
    refills !== (item.refills_left === null ? '' : String(item.refills_left)) ||
    notes !== (item.notes ?? '')

  const nul = (v: string) => (v.trim() ? v.trim() : null)

  // Offer a reminder built from the directions when the pill has none yet.
  const hasReminder = account.reminders.some((r) => r.cabinet_item_id === item.id)
  const offer = useMemo(() => (hasReminder ? null : scheduleFromSig(directions)), [directions, hasReminder])
  const fmt = (time: string) => {
    const [h, m] = time.split(':').map((x) => parseInt(x, 10))
    return new Date(2000, 0, 1, h ?? 0, m ?? 0).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
  }
  const [offerBusy, setOfferBusy] = useState(false)
  const acceptOffer = async () => {
    if (!offer || offer.times.length === 0) return
    void hapticTick()
    setOfferBusy(true)
    try {
      const granted = await ensureNotificationPermission()
      await account.upsertReminder({
        cabinet_item_id: item.id,
        times: offer.times,
        days: offer.days,
        dose: offer.dose,
        enabled: true,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
      })
      if (nul(directions) !== (item.directions ?? null)) await account.update(item.id, { directions: nul(directions) })
      toast.show(granted ? t('Reminder set') : t('Reminder saved. Turn on notifications in Settings to be alerted.'), granted ? 'success' : 'error')
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t('Could not set the reminder'), 'error')
    } finally {
      setOfferBusy(false)
    }
  }

  const save = async () => {
    void hapticTick()
    setBusy(true)
    try {
      const n = parseInt(refills, 10)
      await account.update(item.id, {
        nickname: nul(nickname),
        directions: nul(directions),
        rx_number: nul(rx),
        pharmacy_name: nul(pharmacy),
        pharmacy_phone: nul(phone),
        prescriber: nul(prescriber),
        refills_left: Number.isFinite(n) && n >= 0 ? Math.min(99, n) : null,
        notes: nul(notes),
      })
      toast.show(t('Saved'), 'success')
      onClose()
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t('Could not save'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const call = () => {
    void hapticTick()
    const digits = phone.replace(/[^\d+]/g, '')
    if (!digits) return
    window.location.href = `tel:${digits}`
  }

  return (
    <Sheet open onClose={onClose} title={name}>
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => {
            onClose()
            navigate(`/pill/${encodeURIComponent(item.slug)}`)
          }}
          className="pressable flex w-full items-center gap-3 rounded-2xl hairline bg-surface px-3 py-2 text-left"
        >
          <PillThumb src={image} alt="" size={44} />
          <span className="min-w-0 flex-1 text-[15px] font-medium text-ink">{t('Pill details, label and price')}</span>
          <ChevronRightIcon size={18} className="text-muted" />
        </button>

        {phone.trim() && (
          <Button full onClick={call}>
            {t('Call {pharmacy} to refill', { pharmacy: pharmacy.trim() || t('pharmacy') })}
            {rx.trim() ? ` · ${t('Rx {rx}', { rx: rx.trim() })}` : ''}
          </Button>
        )}

        <Labeled label={t('Nickname')}>
          <TextField label={t('Nickname')} value={nickname} onChange={setNickname} placeholder={t('e.g. morning pill')} />
        </Labeled>
        <Labeled label={t('Directions (as on the label)')}>
          <TextField label={t('Directions')} value={directions} onChange={setDirections} placeholder="e.g. Take 1 tablet twice daily" />
        </Labeled>
        {offer && offer.times.length > 0 && (
          <Card tone="tint" className="flex items-center gap-3 text-[14px] text-body">
            <span className="min-w-0 flex-1">
              {t('Set a reminder')}
              {offer.dose ? ` ${t('for {dose}', { dose: offer.dose })}` : ''} {t('at')} <span className="font-semibold text-ink">{offer.times.map(fmt).join(', ')}</span>
              {offer.days.length < 7 ? ` ${t('on selected days')}` : ''}?
            </span>
            <Button size="sm" loading={offerBusy} onClick={() => void acceptOffer()}>
              {t('Set')}
            </Button>
          </Card>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Labeled label={t('Rx number')}>
            <TextField label={t('Rx number')} value={rx} onChange={setRx} placeholder={t('e.g. 7206525')} />
          </Labeled>
          <Labeled label={t('Refills left')}>
            <TextField label={t('Refills left')} value={refills} onChange={setRefills} inputMode="numeric" placeholder={t('e.g. 2')} />
          </Labeled>
        </div>
        <Labeled label={t('Pharmacy')}>
          <TextField label={t('Pharmacy')} value={pharmacy} onChange={setPharmacy} placeholder={t('e.g. Walmart')} />
        </Labeled>
        <Labeled label={t('Pharmacy phone')}>
          <TextField label={t('Pharmacy phone')} value={phone} onChange={setPhone} inputMode="tel" placeholder={t('e.g. 469-675-8110')} />
        </Labeled>
        <Labeled label={t('Prescriber')}>
          <TextField label={t('Prescriber')} value={prescriber} onChange={setPrescriber} placeholder={t('e.g. Dr. Smith')} />
        </Labeled>
        <Labeled label={t('Notes')}>
          <TextField label={t('Notes')} value={notes} onChange={setNotes} placeholder={t('Anything else')} />
        </Labeled>

        <Button full loading={busy} disabled={!dirty} onClick={() => void save()}>
          {t('Save')}
        </Button>
        <button type="button" onClick={onRemove} className="pressable mx-auto flex min-h-[44px] items-center gap-1.5 px-3 text-[14px] font-semibold text-danger">
          <TrashIcon size={15} /> {t('Remove from cabinet')}
        </button>
      </div>
    </Sheet>
  )
}
