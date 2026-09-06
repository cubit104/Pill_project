import { useState } from 'react'
import { Camera } from '@capacitor/camera'
import Button from '../components/Button'
import { CameraIcon, SearchIcon, ShieldIcon, SparkleIcon } from '../components/Icons'
import { hapticTick, isNative } from '../lib/native'

const FEATURES = [
  { Icon: CameraIcon, title: 'Identify a pill from a photo', body: 'Snap both sides and PillSeek reads the imprint for you.' },
  { Icon: SearchIcon, title: 'Search by imprint, name or NDC', body: 'Every FDA-listed pill, with photos to compare.' },
  { Icon: SparkleIcon, title: 'Understand what you take', body: 'Dosage, side effects, guides, interactions and prices.' },
] as const

type Step = 'welcome' | 'camera'

/**
 * First-launch flow: a short welcome, then a plain-language camera permission
 * ask before the system prompt appears (so the system dialog is never a surprise).
 * Shown once; `onDone` is called after either step finishes.
 */
export default function WelcomeScreen({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>('welcome')
  const [asking, setAsking] = useState(false)

  const finish = () => {
    void hapticTick()
    onDone()
  }

  const allowCamera = async () => {
    void hapticTick()
    setAsking(true)
    try {
      if (isNative()) await Camera.requestPermissions({ permissions: ['camera'] })
    } catch {
      /* the Identify tab handles a denied camera with its own message */
    } finally {
      setAsking(false)
      onDone()
    }
  }

  return (
    <div
      className="flex h-full flex-col bg-canvas animate-fade-up"
      style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'calc(var(--safe-bottom) + 16px)', paddingLeft: 'max(20px, var(--safe-left))', paddingRight: 'max(20px, var(--safe-right))' }}
      role="dialog"
      aria-modal="true"
      aria-label={step === 'welcome' ? 'Welcome to PillSeek' : 'Camera access'}
    >
      {step === 'welcome' ? (
        <>
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <img src="/logo-mark.svg" alt="" width={88} height={88} className="h-[88px] w-[88px]" />
            <p className="mt-4 text-[34px] font-extrabold tracking-tight">
              <span className="text-ink">Pill</span>
              <span className="text-brand">Seek</span>
            </p>
            <p className="mt-1 text-[16px] text-muted">Identify. Understand. Be sure.</p>
            <ul className="mt-8 w-full max-w-sm space-y-4 text-left">
              {FEATURES.map(({ Icon, title, body }) => (
                <li key={title} className="flex items-start gap-3">
                  <span className="flex h-11 w-11 flex-none items-center justify-center rounded-2xl bg-brand-tint text-brand">
                    <Icon size={22} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[17px] font-semibold text-ink">{title}</span>
                    <span className="block text-[14px] leading-snug text-muted">{body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="mx-auto w-full max-w-sm space-y-3">
            <Button full size="lg" onClick={() => setStep('camera')}>
              Continue
            </Button>
            <p className="text-center text-[12px] leading-relaxed text-muted">
              Informational only, not medical advice. Always confirm with a pharmacist.
            </p>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <span className="flex h-24 w-24 items-center justify-center rounded-[32px] bg-brand-tint text-brand">
              <CameraIcon size={52} strokeWidth={1.6} />
            </span>
            <h1 className="mt-6 text-[28px] font-bold tracking-tight text-ink">Let PillSeek use the camera</h1>
            <p className="mt-3 max-w-sm text-[16px] leading-relaxed text-body">
              The camera is only used to photograph a pill when you tap Identify. Photos are analysed and discarded unless you choose to keep them.
            </p>
            <p className="mt-4 inline-flex items-center gap-1.5 text-[14px] text-muted">
              <ShieldIcon size={16} /> Nothing is recorded in the background.
            </p>
          </div>
          <div className="mx-auto w-full max-w-sm space-y-2">
            <Button full size="lg" loading={asking} onClick={() => void allowCamera()}>
              Allow camera access
            </Button>
            <Button full variant="ghost" onClick={finish}>
              Not now
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
