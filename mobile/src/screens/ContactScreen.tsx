import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import Card, { SectionLabel } from '../components/Card'
import Chip, { ChipRow } from '../components/Chip'
import { CheckIcon, ChevronRightIcon } from '../components/Icons'
import TextField from '../components/TextField'
import { ApiError, sendContactMessage } from '../lib/api'
import { useBackHandler } from '../lib/backstack'
import { hapticTick, hideKeyboard, isNative } from '../lib/native'

const SUBJECTS = [
  { value: 'general', label: 'Question' },
  { value: 'data-error', label: 'Data error' },
  { value: 'feedback', label: 'Feedback' },
  { value: 'other', label: 'Other' },
] as const

const EMAIL = 'contact@pillseek.com'

function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())
}

/** Native contact form; posts to the website's /api/contact (which emails the team). */
export default function ContactScreen() {
  const navigate = useNavigate()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [subject, setSubject] = useState<(typeof SUBJECTS)[number]['value']>('general')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate('/about', { replace: true }))
  useBackHandler(true, goBack)

  const canSend = name.trim().length > 0 && isValidEmail(email) && body.trim().length >= 10 && !sending

  const submit = async () => {
    if (!canSend) return
    void hapticTick()
    void hideKeyboard()
    setSending(true)
    setError(null)
    try {
      const msg = await sendContactMessage({ name: name.trim(), email: email.trim(), subject, body: body.trim() })
      setSent(msg)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to send your message right now. Please try again later.')
    } finally {
      setSending(false)
    }
  }

  const mailto = () => {
    void hapticTick()
    const url = `mailto:${EMAIL}?subject=${encodeURIComponent('PillSeek app')}`
    if (isNative()) window.open(url, '_system')
    else window.location.href = url
  }

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
        <p className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold text-ink">Contact</p>
        <span className="w-11" aria-hidden />
      </div>

      <main className="screen mx-auto max-w-lg space-y-4 px-4 pb-8 pt-2" style={{ paddingLeft: 'max(16px, var(--safe-left))', paddingRight: 'max(16px, var(--safe-right))' }}>
        <div className="px-1">
          <h1 className="text-[26px] font-bold leading-tight tracking-tight text-ink">Contact us</h1>
          <p className="mt-1 text-[15px] leading-relaxed text-muted">Found a data error, have a question, or want to report a problem? We usually reply within 2–3 business days.</p>
        </div>

        {sent ? (
          <Card tone="tint" className="flex flex-col items-center py-8 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand text-brand-fg">
              <CheckIcon size={28} />
            </span>
            <p className="mt-4 text-[18px] font-semibold text-ink">Message sent</p>
            <p className="mt-1 max-w-xs text-[15px] text-body">{sent}</p>
            <Button className="mt-5" variant="secondary" onClick={goBack}>
              Done
            </Button>
          </Card>
        ) : (
          <Card className="space-y-4">
            <div>
              <SectionLabel>Subject</SectionLabel>
              <ChipRow label="Subject">
                {SUBJECTS.map((s) => (
                  <Chip key={s.value} selected={subject === s.value} onClick={() => setSubject(s.value)}>
                    {s.label}
                  </Chip>
                ))}
              </ChipRow>
            </div>
            <TextField label="Your name" value={name} onChange={setName} placeholder="Your name" autoComplete="name" autoCapitalize="words" enterKeyHint="next" />
            <TextField label="Your email" value={email} onChange={setEmail} placeholder="your@email.com" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" enterKeyHint="next" />
            <textarea
              aria-label="Message"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={subject === 'data-error' ? 'Which pill, and what is wrong? Include the imprint if you can.' : 'How can we help?'}
              rows={6}
              maxLength={4000}
              className="w-full rounded-2xl border border-line bg-surface px-3 py-3 text-[17px] leading-relaxed text-ink placeholder:text-muted focus:border-brand"
            />
            {error && (
              <p className="text-[14px] text-danger" role="alert">
                {error}
              </p>
            )}
            <Button full loading={sending} disabled={!canSend} onClick={() => void submit()}>
              Send message
            </Button>
          </Card>
        )}

        <Card padded={false} className="overflow-hidden">
          <button type="button" onClick={mailto} className="pressable flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-brand-tint">
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] font-medium text-ink">Or email us directly</span>
              <span className="block text-[14px] text-brand">{EMAIL}</span>
            </span>
            <ChevronRightIcon size={20} className="flex-none text-muted" />
          </button>
        </Card>
      </main>
    </div>
  )
}
