import { useRef } from 'react'
import Card, { SectionLabel } from '../components/Card'
import Disclaimer from '../components/Disclaimer'
import { CameraIcon, ChevronRightIcon, ExternalIcon, RefreshIcon, SearchIcon, SparkleIcon } from '../components/Icons'
import ScreenHeader from '../components/ScreenHeader'
import Toggle from '../components/Toggle'
import { SITE_URL } from '../lib/api'
import { appVersion, openUrl, platform } from '../lib/native'
import { useSettings } from '../lib/settings'

const STEPS = [
  { Icon: CameraIcon, title: 'Photograph both sides', body: 'Fit the pill in the circle guide, in good light.' },
  { Icon: SparkleIcon, title: 'We read the imprint', body: 'Our own reader decodes the letters and numbers, plus colour and shape.' },
  { Icon: SearchIcon, title: 'Matched against 14,000 pills', body: 'Ranked candidates from FDA labelling data, with photos to compare.' },
] as const

const LINKS = [
  { label: 'Privacy policy', url: `${SITE_URL}/privacy` },
  { label: 'Terms of use', url: `${SITE_URL}/terms` },
  { label: 'Medical disclaimer', url: `${SITE_URL}/disclaimer` },
  { label: 'Contact us', url: `${SITE_URL}/contact` },
] as const

export default function AboutScreen() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { features, loading, error, reload, consent, setConsent } = useSettings()

  const readerStatus = loading
    ? { label: 'Checking…', tone: 'text-muted', dot: 'bg-line' }
    : error
      ? { label: 'Unreachable', tone: 'text-danger', dot: 'bg-danger' }
      : features?.photo_id_enabled
        ? { label: `Online · ${features.photo_id_reader_mode} mode`, tone: 'text-brand', dot: 'bg-brand' }
        : { label: 'Paused', tone: 'text-[var(--warn)]', dot: 'bg-[var(--warn)]' }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      <ScreenHeader title="About" scrollRef={scrollRef} />
      <main className="screen mx-auto max-w-lg space-y-6 px-4 pt-2" style={{ paddingLeft: 'max(16px, var(--safe-left))', paddingRight: 'max(16px, var(--safe-right))' }}>
        <Card className="flex flex-col items-center py-7 text-center">
          <img src="/logo-mark.svg" alt="" width={72} height={72} className="h-[72px] w-[72px]" />
          <p className="mt-3 text-[30px] font-extrabold tracking-tight">
            <span className="text-ink">Pill</span>
            <span className="text-brand">Seek</span>
          </p>
          <p className="mt-2 max-w-xs text-[15px] leading-relaxed text-muted">
            PillSeek identifies pills from photos and by imprint, colour and shape, using FDA labelling data and a catalogue
            of 14,000 pill images. Free, ad-light and built for the moment you need an answer.
          </p>
        </Card>

        <section>
          <SectionLabel>How it works</SectionLabel>
          <Card padded={false} className="divide-y divide-line">
            {STEPS.map(({ Icon, title, body }, i) => (
              <div key={title} className="flex items-start gap-3 px-4 py-3.5">
                <span className="relative flex h-11 w-11 flex-none items-center justify-center rounded-2xl bg-brand-tint text-brand">
                  <Icon size={22} />
                  <span className="absolute -left-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-brand-fg">
                    {i + 1}
                  </span>
                </span>
                <div className="min-w-0">
                  <p className="text-[17px] font-semibold text-ink">{title}</p>
                  <p className="mt-0.5 text-[14px] leading-snug text-muted">{body}</p>
                </div>
              </div>
            ))}
          </Card>
        </section>

        <section>
          <SectionLabel>Settings</SectionLabel>
          <Card className="divide-y divide-line !py-1">
            <Toggle
              checked={consent}
              onChange={setConsent}
              label="Keep my photos to improve the reader"
              description="Photos are stored without any personal details and used only to train PillSeek's imprint reader. Turn off to keep them private."
            />
            <div className="flex min-h-[44px] items-center justify-between gap-4 py-2.5">
              <span className="text-[17px] text-ink">Reader status</span>
              <button type="button" onClick={reload} className={`pressable flex items-center gap-2 text-[15px] font-medium ${readerStatus.tone}`} aria-label={`Reader status: ${readerStatus.label}. Refresh`}>
                <span className={`h-2.5 w-2.5 rounded-full ${readerStatus.dot}`} aria-hidden />
                {readerStatus.label}
                <RefreshIcon size={16} className="text-muted" />
              </button>
            </div>
          </Card>
        </section>

        <section>
          <SectionLabel>Legal</SectionLabel>
          <Card padded={false} className="divide-y divide-line">
            {LINKS.map((l) => (
              <button
                key={l.url}
                type="button"
                onClick={() => void openUrl(l.url)}
                className="pressable flex min-h-[48px] w-full items-center justify-between px-4 text-left text-[17px] text-ink active:bg-brand-tint"
              >
                <span>{l.label}</span>
                <span className="flex items-center gap-1 text-muted">
                  <ExternalIcon size={16} />
                  <ChevronRightIcon size={18} className="text-line" />
                </span>
              </button>
            ))}
          </Card>
        </section>

        <Disclaimer />

        <p className="pb-2 text-center text-[13px] leading-relaxed text-muted">
          PillSeek {appVersion()} · {platform() === 'web' ? 'web preview' : platform()}
          <br />
          Made in the USA with FDA data.
        </p>
      </main>
    </div>
  )
}
