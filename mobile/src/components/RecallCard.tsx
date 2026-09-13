import { useState } from 'react'
import Card from './Card'
import { TextBadge } from './PillRow'
import { classText, type Recall } from '../lib/recalls'
import { useT } from '../lib/i18n'

/** One FDA recall: class, date, maker, product, lots, reason. Lots expand on tap. */
export default function RecallCard({ recall, showMatch = false }: { recall: Recall; showMatch?: boolean }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const tone = recall.cls === 'I' ? 'danger' : recall.cls === 'II' ? 'amber' : 'neutral'
  const ongoing = /ongoing/i.test(recall.status)
  return (
    <Card tone={recall.cls === 'I' ? 'danger' : 'surface'} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <TextBadge tone={tone}>{recall.cls ? t('Class {cls}', { cls: recall.cls }) : t('Recall')}</TextBadge>
        {showMatch && <TextBadge tone={recall.exact ? 'brand' : 'neutral'}>{recall.exact ? t('Your exact product') : t('Same drug, other maker')}</TextBadge>}
        <span className="ml-auto text-[13px] text-muted">{recall.date}</span>
      </div>
      <p className="text-[15px] font-semibold leading-snug text-ink">{recall.product}</p>
      <p className="text-[14px] text-muted">{t(classText(recall.cls))}</p>
      {recall.reason && (
        <p className="text-[15px] text-ink">
          <span className="font-semibold">{t('Why')}: </span>
          {recall.reason}
        </p>
      )}
      <p className="text-[14px] text-muted">
        {[recall.firm, ongoing ? t('Recall still open') : recall.status].filter(Boolean).join(' · ')}
      </p>
      {recall.lots && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="pressable text-left text-[14px] font-medium text-brand">
          {open ? t('Hide lot numbers') : t('Show lot numbers to compare with your bottle')}
        </button>
      )}
      {open && recall.lots && <p className="whitespace-pre-wrap break-words text-[13px] text-body">{recall.lots}</p>}
    </Card>
  )
}
