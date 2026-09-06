import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import Card, { SectionLabel } from '../components/Card'
import Chip, { ChipRow, ColorDot } from '../components/Chip'
import Disclaimer from '../components/Disclaimer'
import EmptyState from '../components/EmptyState'
import ErrorCard from '../components/ErrorCard'
import { CameraIcon, CheckIcon, FlipIcon, ImagesIcon, RefreshIcon, SparkleIcon, ThumbDownIcon, ThumbUpIcon } from '../components/Icons'
import PillRow, { ScoreBadge, TextBadge } from '../components/PillRow'
import ProgressRing from '../components/ProgressRing'
import ScreenHeader from '../components/ScreenHeader'
import Sheet from '../components/Sheet'
import { ListSkeleton } from '../components/Skeleton'
import TextField from '../components/TextField'
import { useToast } from '../components/Toast'
import {
  ApiError,
  getFilters,
  identify,
  identifyPhoto,
  sendFeedback,
  tokenizeImprint,
  type FiltersResponse,
  type IdentifyResponse,
  type PhotoIdentifyResponse,
} from '../lib/api'
import { CameraUnavailableError, getFallbackPhoto, isPreviewSupported, makeThumbnail, type CapturedPhoto } from '../lib/camera'
import { hapticNotify } from '../lib/native'
import { useSettings } from '../lib/settings'
import { addRecent, newId } from '../lib/storage'
import CameraScreen, { type Side } from './CameraScreen'

type Phase = 'idle' | 'identifying' | 'results' | 'error'

interface Sides {
  1: CapturedPhoto | null
  2: CapturedPhoto | null
}

const QUALITY_LABEL = { exact: 'Best match', strong: 'Likely', partial: 'Possible' } as const
const QUALITY_TONE = { exact: 'brand', strong: 'amber', partial: 'neutral' } as const

export default function IdentifyScreen({ active = true }: { active?: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const toast = useToast()
  const { features, loading: featuresLoading, error: featuresError, reload: reloadFeatures, consent, consentLoaded } = useSettings()

  const [sides, setSides] = useState<Sides>({ 1: null, 2: null })
  const sidesRef = useRef(sides)
  sidesRef.current = sides
  const [camera, setCamera] = useState<Side | null>(null)
  const [previewBroken, setPreviewBroken] = useState(!isPreviewSupported())
  const [phase, setPhase] = useState<Phase>('idle')
  const [result, setResult] = useState<PhotoIdentifyResponse | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null)
  const [chosenSlug, setChosenSlug] = useState<string | null>(null)
  const [cameraDenied, setCameraDenied] = useState(false)
  const [feedbackBusy, setFeedbackBusy] = useState(false)
  const [noneSheet, setNoneSheet] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // Manual imprint fallback
  const [manualOpen, setManualOpen] = useState(false)
  const [imprintText, setImprintText] = useState('')
  const [filters, setFilters] = useState<FiltersResponse>({ colors: [], shapes: [] })
  const [color, setColor] = useState('')
  const [shape, setShape] = useState('')
  const [manualBusy, setManualBusy] = useState(false)
  const [manualResult, setManualResult] = useState<IdentifyResponse | null>(null)
  const [manualError, setManualError] = useState<ApiError | null>(null)

  useEffect(() => {
    if (!manualOpen || filters.colors.length) return
    const ctrl = new AbortController()
    getFilters(ctrl.signal)
      .then(setFilters)
      .catch(() => {})
    return () => ctrl.abort()
  }, [manualOpen, filters.colors.length])

  const enabled = features?.photo_id_enabled ?? false

  const reset = useCallback(() => {
    abortRef.current?.abort()
    Object.values(sidesRef.current).forEach((p) => p && URL.revokeObjectURL(p.previewUrl))
    setSides({ 1: null, 2: null })
    setResult(null)
    setError(null)
    setFeedback(null)
    setChosenSlug(null)
    setPhase('idle')
    setManualOpen(false)
    setManualResult(null)
    setManualError(null)
    setImprintText('')
  }, [])

  const runIdentify = useCallback(
    async (s1: CapturedPhoto, s2: CapturedPhoto) => {
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setPhase('identifying')
      setResult(null)
      setError(null)
      setFeedback(null)
      setChosenSlug(null)
      setManualResult(null)
      try {
        // Never claim consent before the stored preference has been read.
        const data = await identifyPhoto(s1.blob, s2.blob, consentLoaded ? consent : false, ctrl.signal)
        if (ctrl.signal.aborted) return
        setResult(data)
        setImprintText(data.imprint_read ?? '')
        setPhase('results')
        void hapticNotify(data.matches.length ? 'success' : 'warning')
        const top = data.matches[0]
        const thumb = await makeThumbnail(s1.blob).catch(() => null)
        void addRecent({
          id: newId(),
          kind: 'photo',
          at: Date.now(),
          thumb,
          imprintRead: data.imprint_read ?? '',
          topName: top?.medicine_name ?? null,
          topSlug: top?.slug ?? null,
          topScore: top?.similarity ?? null,
          matchCount: data.matches.length,
        })
      } catch (err) {
        if (ctrl.signal.aborted) return
        const e = err instanceof ApiError ? err : new ApiError('unknown', err instanceof Error ? err.message : 'Unknown error')
        if (e.kind === 'cancelled') return
        setError(e)
        setPhase('error')
        void hapticNotify('error')
      }
    },
    [consent, consentLoaded],
  )

  const setSide = useCallback(
    (side: Side, photo: CapturedPhoto) => {
      const prev = sidesRef.current[side]
      if (prev) URL.revokeObjectURL(prev.previewUrl)
      const next: Sides = { ...sidesRef.current, [side]: photo }
      sidesRef.current = next
      setSides(next)
      if (next[1] && next[2]) void runIdentify(next[1], next[2])
      else setPhase('idle')
    },
    [runIdentify],
  )

  const onCameraCapture = useCallback(
    (side: Side, photo: CapturedPhoto) => {
      setSide(side, photo)
      const other: Side = side === 1 ? 2 : 1
      if (!sidesRef.current[other]) setCamera(other)
      else setCamera(null)
    },
    [setSide],
  )

  const fallbackCapture = useCallback(
    async (source: 'camera' | 'photos', startSide: Side) => {
      try {
        const p1 = await getFallbackPhoto(source)
        if (!p1) return
        setSide(startSide, p1)
        const other: Side = startSide === 1 ? 2 : 1
        if (sidesRef.current[other]) return
        toast.show(source === 'camera' ? 'Now flip the pill and take side 2' : 'Now choose the photo of side 2')
        const p2 = await getFallbackPhoto(source)
        if (!p2) return
        setSide(other, p2)
      } catch (err) {
        if (err instanceof CameraUnavailableError && err.reason === 'permission') {
          setCameraDenied(true)
          return
        }
        const msg = err instanceof CameraUnavailableError ? err.message : 'Could not open the camera'
        toast.show(msg, 'error')
      }
    },
    [setSide, toast],
  )

  const openCamera = useCallback(
    (side: Side) => {
      if (previewBroken) {
        void fallbackCapture('camera', side)
        return
      }
      setCamera(side)
    },
    [previewBroken, fallbackCapture],
  )

  const onCameraUnavailable = useCallback(
    (err: CameraUnavailableError) => {
      const side = camera ?? 1
      setCamera(null)
      if (err.reason === 'permission') {
        // Persistent state on the screen (not just a toast); the system picker still works for library photos.
        setCameraDenied(true)
        return
      }
      // Only an unsupported device disables the live preview for the session;
      // a one-off start failure just falls back to the system camera this time.
      if (err.reason === 'unsupported') setPreviewBroken(true)
      void fallbackCapture('camera', side)
    },
    [camera, fallbackCapture],
  )

  const submitFeedback = useCallback(
    async (verdict: 'up' | 'down', chosenSlug: string | null) => {
      if (!result?.capture_id || feedback || feedbackBusy) return
      setFeedbackBusy(true)
      try {
        const corrected = imprintText.trim() !== (result.imprint_read ?? '').trim() ? imprintText.trim().slice(0, 80) : null
        await sendFeedback({ capture_id: result.capture_id, verdict, chosen_slug: chosenSlug, corrected_imprint: corrected || null })
        setFeedback(verdict)
        setChosenSlug(chosenSlug)
        void hapticNotify('success')
        toast.show('Thanks — your feedback helps the reader learn.', 'success')
      } catch (err) {
        toast.show(err instanceof ApiError ? err.message : "Couldn't save your feedback. Tap again to retry.", 'error')
      } finally {
        setFeedbackBusy(false)
      }
    },
    [result, feedback, feedbackBusy, imprintText, toast],
  )

  const runManual = useCallback(async () => {
    const tokens = tokenizeImprint(imprintText)
    if (!tokens.length && !color && !shape) {
      setManualError(new ApiError('bad_request', 'Type the imprint, or pick a colour or shape first.'))
      return
    }
    setManualBusy(true)
    setManualError(null)
    setManualResult(null)
    try {
      const data = await identify({ imprintTokens: tokens, color: color || null, shape: shape || null, limit: 10 })
      setManualResult(data)
      void hapticNotify(data.candidates.length ? 'success' : 'warning')
    } catch (err) {
      setManualError(err instanceof ApiError ? err : new ApiError('unknown', 'Something went wrong.'))
    } finally {
      setManualBusy(false)
    }
  }, [imprintText, color, shape])

  const bothSides = Boolean(sides[1] && sides[2])
  void active

  // ---- Render helpers ------------------------------------------------------

  const renderSideTiles = () => (
    <div className="grid grid-cols-2 gap-3">
      {([1, 2] as const).map((side) => {
        const photo = sides[side]
        return (
          <button
            key={side}
            type="button"
            onClick={() => openCamera(side)}
            disabled={phase === 'identifying'}
            aria-label={photo ? `Retake side ${side}` : `Take photo of side ${side}`}
            className={`pressable relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded-card border-2 ${
              photo ? 'border-brand bg-surface' : 'border-dashed border-line bg-surface active:bg-brand-tint'
            }`}
          >
            {photo ? (
              <>
                <img src={photo.previewUrl} alt={`Pill side ${side}`} className="h-full w-full object-cover" />
                <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-brand px-2 py-0.5 text-[12px] font-semibold text-brand-fg">
                  <CheckIcon size={12} strokeWidth={3} /> Side {side}
                </span>
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 pb-2 pt-6 text-center text-[13px] font-medium text-white">
                  Tap to retake
                </span>
              </>
            ) : (
              <>
                <span className="flex h-16 w-16 items-center justify-center rounded-full border-[3px] border-[color-mix(in_srgb,var(--brand)_50%,transparent)] text-brand">
                  {side === 1 ? <CameraIcon size={28} /> : <FlipIcon size={28} />}
                </span>
                <span className="mt-3 text-[15px] font-semibold text-ink">{side === 1 ? 'Side 1' : 'Side 2'}</span>
                <span className="mt-0.5 text-[13px] text-muted">{side === 1 ? 'Tap to capture' : 'Flip the pill'}</span>
              </>
            )}
          </button>
        )
      })}
    </div>
  )

  const renderResults = () => {
    if (!result) return null
    const matches = result.matches
    const canFeedback = Boolean(result.capture_id) && !feedback
    return (
      <div className="space-y-4">
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="section-label">Read from photo</p>
              <p className="selectable mt-1 text-[22px] font-bold tracking-tight text-ink">
                {result.imprint_read ? result.imprint_read : <span className="text-muted">No imprint found</span>}
              </p>
              {result.attrs_guess?.shape && (
                <p className="mt-0.5 text-[14px] text-muted">
                  Looks {result.attrs_guess.shape.toLowerCase()}
                  {result.attrs_guess.color ? `, ${result.attrs_guess.color.toLowerCase()}` : ''}
                </p>
              )}
            </div>
            <Button size="sm" variant="secondary" onClick={() => setManualOpen(true)}>
              Edit
            </Button>
          </div>
        </Card>

        {matches.length === 0 ? (
          <Card padded={false}>
            <EmptyState
              art="pill"
              title="No confident matches"
              body="Try a closer, sharper photo in good light, or type the imprint yourself."
              action={
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" icon={<RefreshIcon size={18} />} onClick={reset}>
                    Retake
                  </Button>
                  <Button size="sm" onClick={() => setManualOpen(true)}>
                    Type imprint
                  </Button>
                </div>
              }
            />
          </Card>
        ) : (
          <>
            <SectionLabel>
              {matches.length} {matches.length === 1 ? 'match' : 'matches'} · compare with your pill
            </SectionLabel>
            <div className="card divide-y divide-line overflow-hidden">
              {matches.map((m) => (
                <PillRow
                  key={m.slug}
                  image={m.image_urls[0] ?? null}
                  name={m.medicine_name}
                  strength={m.strength}
                  imprint={m.splimprint}
                  color={m.color}
                  shape={m.shape}
                  badge={
                    <ScoreBadge
                      value={m.similarity}
                      label={m.source === 'imprint' ? 'Imprint' : 'Visual'}
                      tone={m.source === 'imprint' ? 'brand' : 'neutral'}
                    />
                  }
                  onPress={() => navigate(`/pill/${encodeURIComponent(m.slug)}`)}
                  footer={
                    result.capture_id && (!feedback || chosenSlug === m.slug) ? (
                      <button
                        type="button"
                        disabled={!canFeedback || feedbackBusy}
                        onClick={() => void submitFeedback('up', m.slug)}
                        className={`pressable inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 text-[14px] font-semibold ${
                          chosenSlug === m.slug ? 'bg-brand text-brand-fg' : 'hairline bg-surface text-brand active:bg-brand-tint'
                        } disabled:opacity-60`}
                      >
                        <ThumbUpIcon size={18} />
                        {chosenSlug === m.slug ? 'Thanks — marked as your pill' : 'This is my pill'}
                      </button>
                    ) : null
                  }
                />
              ))}
            </div>
            {result.capture_id && (
              <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                {feedback ? (
                  <p className="text-[14px] text-muted">Thanks — your feedback helps us improve.</p>
                ) : (
                  <button
                    type="button"
                    disabled={feedbackBusy}
                    onClick={() => setNoneSheet(true)}
                    className="pressable inline-flex min-h-[44px] items-center gap-2 text-[15px] font-medium text-muted"
                  >
                    <ThumbDownIcon size={18} /> None of these
                  </button>
                )}
                <Button variant="ghost" size="sm" icon={<RefreshIcon size={18} />} onClick={reset}>
                  Start over
                </Button>
              </div>
            )}
          </>
        )}
        <Disclaimer text={result.disclaimer} />
      </div>
    )
  }

  const renderManual = () => (
    <Card>
      <p className="section-label">Imprint</p>
      <p className="mt-1 text-[14px] text-muted">Letters and numbers on the pill, either side. Separate parts with a space.</p>
      <div className="mt-3">
        <TextField
          label="Imprint"
          value={imprintText}
          onChange={setImprintText}
          placeholder="e.g. S 10"
          autoCapitalize="characters"
          autoCorrect="off"
          enterKeyHint="search"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runManual()
          }}
        />
      </div>
      {filters.colors.length > 0 && (
        <>
          <p className="section-label mt-4">Colour</p>
          <ChipRow label="Colour">
            <Chip selected={color === ''} onClick={() => setColor('')}>
              Any
            </Chip>
            {filters.colors.map((c) => (
              <Chip key={c.name} selected={color === c.name} onClick={() => setColor(c.name)} leading={<ColorDot hex={c.hex} />}>
                {c.name}
              </Chip>
            ))}
          </ChipRow>
          <p className="section-label mt-3">Shape</p>
          <ChipRow label="Shape">
            <Chip selected={shape === ''} onClick={() => setShape('')}>
              Any
            </Chip>
            {filters.shapes.map((s) => (
              <Chip key={s.name} selected={shape === s.name} onClick={() => setShape(s.name)} leading={<span aria-hidden>{s.icon}</span>}>
                {s.name}
              </Chip>
            ))}
          </ChipRow>
        </>
      )}
      <div className="mt-4">
        <Button full loading={manualBusy} icon={<SparkleIcon size={20} />} onClick={() => void runManual()}>
          Identify
        </Button>
      </div>
      {manualError && (
        <div className="mt-3">
          <ErrorCard error={manualError} onRetry={() => void runManual()} />
        </div>
      )}
      {manualResult && (
        <div className="mt-4">
          {manualResult.candidates.length === 0 ? (
            <EmptyState art="search" title="No matches" body="Try fewer imprint characters, or check the colour and shape." />
          ) : (
            <>
              <SectionLabel>Possible matches</SectionLabel>
              <div className="card divide-y divide-line overflow-hidden">
                {manualResult.candidates.map((c) => (
                  <PillRow
                    key={c.slug}
                    image={c.image_urls[0] ?? null}
                    name={c.medicine_name}
                    strength={c.strength}
                    imprint={c.splimprint}
                    color={c.color}
                    shape={c.shape}
                    badge={<TextBadge tone={QUALITY_TONE[c.match_quality]}>{QUALITY_LABEL[c.match_quality]}</TextBadge>}
                    onPress={() => navigate(`/pill/${encodeURIComponent(c.slug)}`)}
                  />
                ))}
              </div>
              <div className="mt-3">
                <Disclaimer text={manualResult.disclaimer} compact />
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  )

  // ---- Screen --------------------------------------------------------------

  let body: React.ReactNode
  if (featuresLoading) {
    body = <ListSkeleton rows={2} />
  } else if (featuresError) {
    body = (
      <ErrorCard
        error={new ApiError('offline', "We couldn't reach PillSeek to check the photo reader. You can still search by imprint.")}
        onRetry={reloadFeatures}
        secondary={{ label: 'Go to Search', onClick: () => navigate('/search') }}
      />
    )
  } else if (!enabled) {
    body = (
      <Card padded={false}>
        <EmptyState
          art="paused"
          title="Photo identification is paused"
          body="We're tuning the pill reader right now. You can still search by imprint, drug name or NDC."
          action={
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" icon={<RefreshIcon size={18} />} onClick={reloadFeatures}>
                Check again
              </Button>
              <Button size="sm" onClick={() => navigate('/search')}>
                Search instead
              </Button>
            </div>
          }
        />
      </Card>
    )
  } else if (phase === 'identifying') {
    body = (
      <div className="space-y-4">
        {renderSideTiles()}
        <Card>
          <ProgressRing active expectedSeconds={8} />
          <div className="flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                abortRef.current?.abort()
                setPhase('idle')
              }}
            >
              Cancel
            </Button>
          </div>
        </Card>
      </div>
    )
  } else if (phase === 'error' && error) {
    body = (
      <div className="space-y-4">
        {renderSideTiles()}
        <ErrorCard
          error={error}
          onRetry={() => sides[1] && sides[2] && void runIdentify(sides[1], sides[2])}
          secondary={
            error.kind === 'feature_off'
              ? { label: 'Go to Search', onClick: () => navigate('/search') }
              : { label: 'Type the imprint instead', onClick: () => setManualOpen(true) }
          }
        />
        {manualOpen && renderManual()}
      </div>
    )
  } else if (phase === 'results') {
    body = (
      <div className="space-y-4">
        {renderSideTiles()}
        {renderResults()}
        {manualOpen && renderManual()}
      </div>
    )
  } else {
    body = (
      <div className="space-y-4">
        <Card className="overflow-hidden">
          <div className="flex items-start gap-3">
            <span className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl bg-brand-tint text-brand">
              <CameraIcon size={26} />
            </span>
            <div className="min-w-0">
              <h2 className="text-[20px] font-bold tracking-tight text-ink">Identify a pill by photo</h2>
              <p className="mt-1 text-[15px] leading-relaxed text-muted">
                Snap both sides in good light. Our reader decodes the imprint and matches it against 14,000 pills.
              </p>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {bothSides ? (
              <>
                <Button full size="lg" icon={<SparkleIcon size={22} />} onClick={() => sides[1] && sides[2] && void runIdentify(sides[1], sides[2])}>
                  Identify these photos
                </Button>
                <Button
                  full
                  variant="secondary"
                  icon={<CameraIcon size={22} />}
                  onClick={() => {
                    reset()
                    openCamera(1)
                  }}
                >
                  Retake both sides
                </Button>
              </>
            ) : (
              <>
                <Button full size="lg" icon={<CameraIcon size={22} />} onClick={() => openCamera(sides[1] ? 2 : 1)}>
                  {sides[1] ? 'Take side 2' : 'Open camera'}
                </Button>
                <Button full variant="secondary" icon={<ImagesIcon size={22} />} onClick={() => void fallbackCapture('photos', sides[1] ? 2 : 1)}>
                  Choose photos
                </Button>
              </>
            )}
          </div>
        </Card>
        {cameraDenied && (
          <ErrorCard
            error={new ApiError('unknown', 'Camera access is off for PillSeek. Turn it on in your phone Settings → PillSeek → Camera, then try again. You can still choose photos from your library.', { title: 'Camera access needed', retryable: true })}
            onRetry={() => {
              setCameraDenied(false)
              openCamera(sides[1] ? 2 : 1)
            }}
            secondary={{ label: 'Choose photos', onClick: () => void fallbackCapture('photos', sides[1] ? 2 : 1) }}
          />
        )}
        {renderSideTiles()}
        <p className="px-1 text-[13px] leading-snug text-muted">
          {consentLoaded && consent
            ? 'Photos you take are kept, without personal details, to improve the reader. Change this under About.'
            : 'Photos are analysed and not kept.'}
        </p>
        {sides[1] && !sides[2] && (
          <Card tone="tint" className="flex items-center gap-3">
            <FlipIcon size={22} className="flex-none text-brand" />
            <p className="text-[15px] text-body">
              <span className="font-semibold text-ink">Now flip the pill</span> and capture side 2 — we identify once we have both.
            </p>
          </Card>
        )}
        {(sides[1] || sides[2]) && (
          <div className="flex justify-end px-1">
            <Button variant="ghost" size="sm" onClick={reset}>
              Clear photos
            </Button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setManualOpen((v) => !v)}
          className="pressable mx-auto flex min-h-[44px] items-center gap-1.5 text-[15px] font-medium text-brand"
        >
          {manualOpen ? 'Hide manual search' : 'Prefer to type the imprint?'}
        </button>
        {manualOpen && renderManual()}
        <Disclaimer compact />
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      <ScreenHeader title="Identify" subtitle="Photograph both sides of a pill" scrollRef={scrollRef} />
      <main className="screen mx-auto max-w-lg px-4 pt-2" style={{ paddingLeft: 'max(16px, var(--safe-left))', paddingRight: 'max(16px, var(--safe-right))' }}>
        {body}
      </main>

      {camera && (
        <CameraScreen
          side={camera}
          previous={camera === 2 ? sides[1] : null}
          onCapture={onCameraCapture}
          onClose={() => setCamera(null)}
          onUnavailable={onCameraUnavailable}
        />
      )}

      <Sheet open={noneSheet} onClose={() => setNoneSheet(false)} title="None of these?">
        <p className="text-[15px] leading-relaxed text-muted">
          We'll log this so the reader improves. If the imprint we read was wrong, correct it first so we learn the right text.
        </p>
        <div className="mt-3">
          <TextField label="Corrected imprint" value={imprintText} onChange={setImprintText} placeholder="Imprint on the pill" autoCapitalize="characters" />
        </div>
        <div className="mt-4 space-y-2">
          <Button
            full
            loading={feedbackBusy}
            icon={<ThumbDownIcon size={20} />}
            onClick={async () => {
              await submitFeedback('down', null)
              setNoneSheet(false)
            }}
          >
            Send feedback
          </Button>
          <Button
            full
            variant="secondary"
            onClick={() => {
              setNoneSheet(false)
              setManualOpen(true)
            }}
          >
            Search by imprint instead
          </Button>
        </div>
      </Sheet>
    </div>
  )
}
