import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import Card, { SectionLabel } from '../components/Card'
import { CheckIcon, ChevronRightIcon, ShieldIcon, UserIcon } from '../components/Icons'
import TextField from '../components/TextField'
import { useToast } from '../components/Toast'
import { useAccount } from '../lib/account'
import { requestEmailCode, verifyEmailCode } from '../lib/auth'
import { useBackHandler } from '../lib/backstack'
import { hapticNotify, hapticTick, hideKeyboard } from '../lib/native'

function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())
}

/**
 * Sign in with a 6-digit emailed code (no password), plus account management
 * when signed in: sign out and the store-required "delete my account".
 */
export default function AccountScreen() {
  const navigate = useNavigate()
  const toast = useToast()
  const account = useAccount()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate('/cabinet', { replace: true }))
  useBackHandler(true, goBack)

  const sendCode = async () => {
    if (!isValidEmail(email)) return
    void hapticTick()
    void hideKeyboard()
    setBusy(true)
    setError(null)
    try {
      await requestEmailCode(email)
      setStep('code')
      toast.show('Code sent. Check your email.', 'success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the code')
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    if (code.replace(/\D/g, '').length < 6) return
    void hapticTick()
    void hideKeyboard()
    setBusy(true)
    setError(null)
    try {
      await verifyEmailCode(email, code)
      void hapticNotify('success')
      toast.show('Signed in', 'success')
      goBack()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify the code')
    } finally {
      setBusy(false)
    }
  }

  const header = (
    <div
      className="sticky top-0 z-20 flex items-center gap-2 bg-[color-mix(in_srgb,var(--canvas)_95%,transparent)] px-2 pb-2 backdrop-blur"
      style={{ paddingTop: 'calc(var(--safe-top) + 6px)', paddingLeft: 'max(8px, var(--safe-left))', paddingRight: 'max(8px, var(--safe-right))' }}
    >
      <button type="button" onClick={goBack} aria-label="Back" className="pressable flex h-11 min-w-[44px] items-center gap-0.5 rounded-full px-2 text-[17px] font-medium text-brand">
        <ChevronRightIcon size={22} className="rotate-180" />
        Back
      </button>
      <p className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold text-ink">Account</p>
      <span className="w-11" aria-hidden />
    </div>
  )

  if (!account.enabled) {
    return (
      <div ref={scrollRef} className="h-full overflow-y-auto bg-canvas animate-fade-up">
        {header}
        <main className="screen mx-auto max-w-lg px-4 pt-2">
          <Card tone="warn" className="text-[15px] text-body">
            Accounts are not available in this build.
          </Card>
        </main>
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-canvas animate-fade-up">
      {header}
      <main className="screen mx-auto max-w-lg space-y-4 px-4 pb-8 pt-2" style={{ paddingLeft: 'max(16px, var(--safe-left))', paddingRight: 'max(16px, var(--safe-right))' }}>
        {account.user ? (
          <>
            <Card className="flex items-center gap-3">
              <span className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-brand-tint text-brand">
                <UserIcon size={24} />
              </span>
              <span className="min-w-0">
                <span className="block text-[17px] font-semibold text-ink">Signed in</span>
                <span className="block truncate text-[14px] text-muted">{account.user.email}</span>
              </span>
            </Card>
            <Card className="flex items-start gap-3">
              <ShieldIcon size={20} className="mt-0.5 flex-none text-brand" />
              <p className="text-[14px] leading-relaxed text-body">
                Your cabinet and reminders are stored under this account and only you can see them. Sign in on pillseek.com with the same email to see them there too.
              </p>
            </Card>
            <Button full variant="secondary" onClick={() => void account.signOut().then(goBack)}>
              Sign out
            </Button>
            <section>
              <SectionLabel>Danger zone</SectionLabel>
              <Card tone="danger" className="space-y-3">
                <p className="text-[14px] leading-relaxed text-body">Deleting your account removes your cabinet, reminders and dose history permanently.</p>
                {confirmDelete ? (
                  <div className="flex gap-2">
                    <Button
                      variant="danger"
                      size="sm"
                      loading={busy}
                      onClick={() => {
                        setBusy(true)
                        void account
                          .deleteAccount()
                          .then(() => {
                            toast.show('Account deleted', 'success')
                            navigate('/home', { replace: true })
                          })
                          .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not delete'))
                          .finally(() => setBusy(false))
                      }}
                    >
                      Yes, delete everything
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>
                      Keep my account
                    </Button>
                  </div>
                ) : (
                  <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
                    Delete my account
                  </Button>
                )}
                {error && <p className="text-[14px] text-danger">{error}</p>}
              </Card>
            </section>
          </>
        ) : (
          <>
            <div className="px-1">
              <h1 className="text-[26px] font-bold leading-tight tracking-tight text-ink">Sign in or create account</h1>
              <p className="mt-1 text-[15px] leading-relaxed text-muted">No password or sign-up form. We email you a 6-digit code; a new account is created the first time.</p>
            </div>
            <Card className="space-y-3">
              {step === 'email' ? (
                <>
                  <TextField
                    label="Email"
                    value={email}
                    onChange={setEmail}
                    placeholder="you@example.com"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    enterKeyHint="send"
                    onKeyDown={(e) => e.key === 'Enter' && void sendCode()}
                  />
                  <Button full loading={busy} disabled={!isValidEmail(email)} onClick={() => void sendCode()}>
                    Email me a code
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-[14px] text-body">
                    We sent a code to <span className="font-semibold text-ink">{email.trim()}</span>.
                  </p>
                  <TextField
                    label="6-digit code"
                    value={code}
                    onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    enterKeyHint="done"
                    onKeyDown={(e) => e.key === 'Enter' && void verify()}
                    className="tabular font-mono text-[22px] tracking-[0.3em]"
                  />
                  <Button full loading={busy} disabled={code.length < 6} icon={<CheckIcon size={18} />} onClick={() => void verify()}>
                    Sign in
                  </Button>
                  <button
                    type="button"
                    onClick={() => {
                      setStep('email')
                      setCode('')
                      setError(null)
                    }}
                    className="pressable w-full py-2 text-center text-[14px] font-semibold text-brand"
                  >
                    Use a different email
                  </button>
                </>
              )}
              {error && (
                <p className="text-[14px] text-danger" role="alert">
                  {error}
                </p>
              )}
            </Card>
            <p className="px-2 text-center text-[12px] leading-relaxed text-muted">
              By signing in you agree to the Terms of Use and Privacy Policy. Your cabinet is private and never shared.
            </p>
          </>
        )}
      </main>
    </div>
  )
}
