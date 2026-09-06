import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Card from '../components/Card'
import { AlertIcon, ChevronRightIcon, ExternalIcon } from '../components/Icons'
import { useBackHandler } from '../lib/backstack'
import { LEGAL, type LegalBlock, type LegalKind } from '../content/legal'
import { hapticTick, openUrl } from '../lib/native'

function Block({ block, onNavigate }: { block: LegalBlock; onNavigate: (to: string) => void }) {
  switch (block.type) {
    case 'h':
      return <h2 className="mt-5 text-[19px] font-bold tracking-tight text-ink first:mt-0">{block.text}</h2>
    case 'p':
      return <p className="selectable mt-2 text-[15px] leading-relaxed text-body">{block.text}</p>
    case 'list':
      return (
        <ul className="mt-2 space-y-1.5 pl-5 text-[15px] leading-relaxed text-body marker:text-brand" style={{ listStyle: 'disc' }}>
          {block.items.map((it) => (
            <li key={it}>{it}</li>
          ))}
        </ul>
      )
    case 'callout':
      return (
        <Card tone={block.tone} className="mt-3 flex items-start gap-3">
          <AlertIcon size={20} className={`mt-0.5 flex-none ${block.tone === 'danger' ? 'text-danger' : 'text-[var(--warn)]'}`} />
          <p className="text-[15px] leading-relaxed text-body">{block.text}</p>
        </Card>
      )
    case 'link':
      return (
        <button
          type="button"
          onClick={() => {
            void hapticTick()
            if (block.to.startsWith('/')) onNavigate(block.to)
            else void openUrl(block.to)
          }}
          className="pressable mt-2 inline-flex min-h-[40px] items-center gap-1 text-[15px] font-semibold text-brand"
        >
          {block.text}
          {block.to.startsWith('/') ? <ChevronRightIcon size={16} /> : <ExternalIcon size={14} />}
        </button>
      )
    case 'faq':
      return (
        <div className="mt-3 space-y-3">
          {block.items.map((qa) => (
            <Card key={qa.q}>
              <p className="text-[16px] font-semibold text-ink">{qa.q}</p>
              <p className="mt-1 text-[15px] leading-relaxed text-body">{qa.a}</p>
            </Card>
          ))}
        </div>
      )
  }
}

/** Privacy policy, terms of use and medical disclaimer, rendered natively from content/legal.ts. */
export default function LegalScreen({ kind }: { kind: LegalKind }) {
  const navigate = useNavigate()
  const scrollRef = useRef<HTMLDivElement>(null)
  const doc = LEGAL[kind]

  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate('/about', { replace: true }))
  useBackHandler(true, goBack)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [kind])

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-canvas animate-fade-up">
      <div
        className="sticky top-0 z-20 flex items-center gap-2 bg-[color-mix(in_srgb,var(--canvas)_95%,transparent)] px-2 pb-2 backdrop-blur"
        style={{ paddingTop: 'calc(var(--safe-top) + 6px)', paddingLeft: 'max(8px, var(--safe-left))', paddingRight: 'max(8px, var(--safe-right))' }}
      >
        <button type="button" onClick={goBack} aria-label="Back" className="pressable flex h-11 min-w-[44px] items-center gap-0.5 rounded-full px-2 text-[17px] font-medium text-brand">
          <ChevronRightIcon size={22} className="rotate-180" />
          Back
        </button>
        <p className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold text-ink">{doc.title}</p>
        <span className="w-11" aria-hidden />
      </div>

      <main className="screen mx-auto max-w-lg px-4 pb-8 pt-2" style={{ paddingLeft: 'max(16px, var(--safe-left))', paddingRight: 'max(16px, var(--safe-right))' }}>
        <div className="px-1">
          <h1 className="text-[26px] font-bold leading-tight tracking-tight text-ink">{doc.title}</h1>
          {doc.lastUpdated && <p className="mt-1 text-[14px] text-muted">Last updated: {doc.lastUpdated}</p>}
        </div>
        <Card className="mt-4">
          {doc.blocks.map((b, i) => (
            <Block key={i} block={b} onNavigate={(to) => navigate(to)} />
          ))}
        </Card>
      </main>
    </div>
  )
}
