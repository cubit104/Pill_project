import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from './Button'
import { ChevronRightIcon } from './Icons'
import { PillThumb } from './PillRow'
import Sheet from './Sheet'
import TextField from './TextField'
import { useToast } from './Toast'
import { useAccount } from '../lib/account'
import type { CabinetItem } from '../lib/cabinet'
import { hapticTick } from '../lib/native'

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
export default function ItemSheet({ item, name, image, onClose }: { item: CabinetItem; name: string; image: string | null; onClose: () => void }) {
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
      toast.show('Saved', 'success')
      onClose()
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Could not save', 'error')
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
          <span className="min-w-0 flex-1 text-[15px] font-medium text-ink">Pill details, label and price</span>
          <ChevronRightIcon size={18} className="text-muted" />
        </button>

        {phone.trim() && (
          <Button full variant="secondary" onClick={call}>
            Call {pharmacy.trim() || 'pharmacy'} to refill{rx.trim() ? ` · Rx ${rx.trim()}` : ''}
          </Button>
        )}

        <Labeled label="Nickname">
          <TextField label="Nickname" value={nickname} onChange={setNickname} placeholder="e.g. morning pill" />
        </Labeled>
        <Labeled label="Directions (as on the label)">
          <TextField label="Directions" value={directions} onChange={setDirections} placeholder="e.g. Take 1 tablet twice daily" />
        </Labeled>
        <div className="grid grid-cols-2 gap-2">
          <Labeled label="Rx number">
            <TextField label="Rx number" value={rx} onChange={setRx} placeholder="e.g. 7206525" />
          </Labeled>
          <Labeled label="Refills left">
            <TextField label="Refills left" value={refills} onChange={setRefills} inputMode="numeric" placeholder="e.g. 2" />
          </Labeled>
        </div>
        <Labeled label="Pharmacy">
          <TextField label="Pharmacy" value={pharmacy} onChange={setPharmacy} placeholder="e.g. Walmart" />
        </Labeled>
        <Labeled label="Pharmacy phone">
          <TextField label="Pharmacy phone" value={phone} onChange={setPhone} inputMode="tel" placeholder="e.g. 469-675-8110" />
        </Labeled>
        <Labeled label="Prescriber">
          <TextField label="Prescriber" value={prescriber} onChange={setPrescriber} placeholder="e.g. Dr. Smith" />
        </Labeled>
        <Labeled label="Notes">
          <TextField label="Notes" value={notes} onChange={setNotes} placeholder="Anything else" />
        </Labeled>

        <Button full loading={busy} disabled={!dirty} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </Sheet>
  )
}
