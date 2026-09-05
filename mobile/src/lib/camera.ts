/**
 * Camera layer: native full-screen preview (with circle crop), then
 * fall back to the system camera, then to a file picker on the web.
 */
import { Capacitor } from '@capacitor/core'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import { CameraPreview } from '@capacitor-community/camera-preview'
import type { CameraPreviewOptions } from '@capacitor-community/camera-preview'
import { computeCoverCrop, downscaleFactor, JPEG_QUALITY, MAX_SIDE } from './crop'

export { computeCoverCrop, downscaleFactor, guideDiameter, GUIDE_FRACTION, CROP_PAD, MAX_SIDE } from './crop'

export interface CapturedPhoto {
  blob: Blob
  /** Object URL or data URL for display. */
  previewUrl: string
  width: number
  height: number
}

export type CameraFailureReason = 'unsupported' | 'permission' | 'error'

export class CameraUnavailableError extends Error {
  readonly reason: CameraFailureReason
  constructor(reason: CameraFailureReason, message: string) {
    super(message)
    this.name = 'CameraUnavailableError'
    this.reason = reason
  }
}

// ---- Image helpers ---------------------------------------------------------

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode the photo'))
    img.src = src
  })
}

export function canvasToJpeg(canvas: HTMLCanvasElement, quality = JPEG_QUALITY): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the photo'))),
      'image/jpeg',
      quality,
    )
  })
}

/** Draw `img` region into a new canvas of `outSide` and return a CapturedPhoto. */
async function cropToPhoto(img: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, outW: number, outH: number): Promise<CapturedPhoto> {
  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH)
  const blob = await canvasToJpeg(canvas)
  return { blob, previewUrl: URL.createObjectURL(blob), width: outW, height: outH }
}

/** Shrink any image (file picker, system camera) to MAX_SIDE JPEG. */
export async function shrinkForUpload(source: Blob | string): Promise<CapturedPhoto> {
  const url = typeof source === 'string' ? source : URL.createObjectURL(source)
  try {
    const img = await loadImage(url)
    const f = downscaleFactor(img.naturalWidth, img.naturalHeight, MAX_SIDE)
    const outW = Math.max(1, Math.round(img.naturalWidth * f))
    const outH = Math.max(1, Math.round(img.naturalHeight * f))
    return await cropToPhoto(img, 0, 0, img.naturalWidth, img.naturalHeight, outW, outH)
  } finally {
    if (typeof source !== 'string') URL.revokeObjectURL(url)
  }
}

/** Small square thumbnail (data URL) for the Recent list. */
export async function makeThumbnail(source: Blob | string, size = 200): Promise<string> {
  const url = typeof source === 'string' ? source : URL.createObjectURL(source)
  try {
    const img = await loadImage(url)
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    const sx = (img.naturalWidth - side) / 2
    const sy = (img.naturalHeight - side) / 2
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)
    return canvas.toDataURL('image/jpeg', 0.7)
  } finally {
    if (typeof source !== 'string') URL.revokeObjectURL(url)
  }
}

// ---- Native preview --------------------------------------------------------

export interface PreviewRect {
  x: number
  y: number
  width: number
  height: number
}

let previewRunning = false
// In-flight start(), so a stop() requested during startup can wait for it
// and shut the camera down instead of leaving it running behind a hidden app.
let startPromise: Promise<void> | null = null
let stopRequested = false

export function isPreviewSupported(): boolean {
  // The community plugin has a web implementation but it is limited; on the
  // web we prefer the picker fallback for reliability.
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('CameraPreview')
}

export function isPreviewRunning(): boolean {
  return previewRunning
}

export async function startPreview(rect: PreviewRect): Promise<void> {
  if (!isPreviewSupported()) {
    throw new CameraUnavailableError('unsupported', 'Live preview is not available on this device')
  }
  const perm = await Camera.requestPermissions({ permissions: ['camera'] }).catch(() => null)
  if (perm && perm.camera === 'denied') {
    throw new CameraUnavailableError('permission', 'Camera permission was denied. You can enable it in Settings.')
  }
  const options: CameraPreviewOptions = {
    position: 'rear',
    parent: 'camera-preview-root',
    className: 'camera-preview',
    toBack: true,
    enableZoom: true,
    disableAudio: true,
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    storeToFile: false,
    enableHighResolution: true,
    // The crop math assumes the preview rect it was started with; keep the
    // orientation fixed while the camera is open (iOS is portrait-only via Info.plist).
    lockAndroidOrientation: true,
  }
  stopRequested = false
  try {
    startPromise = CameraPreview.start(options)
    await startPromise
    if (stopRequested) {
      // Closed while the camera was starting: shut it straight down.
      await CameraPreview.stop().catch(() => {})
      return
    }
    previewRunning = true
    document.documentElement.classList.add('camera-open')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const reason: CameraFailureReason = /permission|denied|authoriz/i.test(message) ? 'permission' : 'error'
    throw new CameraUnavailableError(reason, message || 'Could not start the camera')
  } finally {
    startPromise = null
  }
}

export async function stopPreview(): Promise<void> {
  document.documentElement.classList.remove('camera-open')
  stopRequested = true
  if (startPromise) {
    // Let a pending start() finish (it sees stopRequested and stops itself).
    await startPromise.catch(() => {})
  }
  const wasRunning = previewRunning
  previewRunning = false
  if (!wasRunning && !Capacitor.isNativePlatform()) return
  try {
    await CameraPreview.stop()
  } catch {
    /* already stopped */
  }
}

export async function setTorch(on: boolean): Promise<boolean> {
  if (!previewRunning) return false
  try {
    await CameraPreview.setFlashMode({ flashMode: on ? 'torch' : 'off' })
    return true
  } catch {
    return false
  }
}

export async function torchAvailable(): Promise<boolean> {
  if (!previewRunning) return false
  try {
    const res = await CameraPreview.getSupportedFlashModes()
    return res.result.includes('torch')
  } catch {
    return false
  }
}

export interface PreviewCaptureInput {
  /** Preview rect in CSS pixels (what the user sees). */
  dispW: number
  dispH: number
  /** Guide circle diameter in CSS pixels. */
  guidePx: number
}

/**
 * Capture the current native frame and crop the guide-circle region.
 * Pinch zoom is handled by the camera itself (enableZoom), so the captured
 * frame already reflects the zoom and the digital factor is 1.
 */
export async function capturePreview(input: PreviewCaptureInput): Promise<CapturedPhoto> {
  if (!previewRunning) throw new Error('Camera is not running')
  const result = await CameraPreview.capture({ quality: 92 })
  const base64 = result.value
  if (!base64) throw new Error('Empty capture')
  const img = await loadImage(`data:image/jpeg;base64,${base64}`)
  const crop = computeCoverCrop({
    natW: img.naturalWidth,
    natH: img.naturalHeight,
    dispW: input.dispW,
    dispH: input.dispH,
    guidePx: input.guidePx,
    zoom: 1,
  })
  return cropToPhoto(img, crop.sx, crop.sy, crop.side, crop.side, crop.outSide, crop.outSide)
}

// ---- Fallback: system camera / photo library -------------------------------

export async function takeSystemPhoto(source: 'camera' | 'photos'): Promise<CapturedPhoto | null> {
  try {
    const photo = await Camera.getPhoto({
      source: source === 'camera' ? CameraSource.Camera : CameraSource.Photos,
      resultType: CameraResultType.Uri,
      quality: 90,
      correctOrientation: true,
      allowEditing: false,
      saveToGallery: false,
      promptLabelHeader: 'Pill photo',
      promptLabelPhoto: 'Choose from library',
      promptLabelPicture: 'Take photo',
    })
    const src = photo.webPath ?? (photo.dataUrl ?? null)
    if (!src) return null
    return await shrinkForUpload(src)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // User backed out of the picker: not an error.
    if (/cancel/i.test(message)) return null
    if (/permission|denied/i.test(message)) {
      throw new CameraUnavailableError('permission', 'Camera permission was denied. You can enable it in Settings.')
    }
    throw new CameraUnavailableError('error', message || 'Could not open the camera')
  }
}

/** Web-only: open a file input and return the chosen image. */
export function pickFileFromWeb(useCamera: boolean): Promise<CapturedPhoto | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    if (useCamera) input.setAttribute('capture', 'environment')
    input.style.display = 'none'
    document.body.appendChild(input)
    const cleanup = () => input.remove()
    input.onchange = () => {
      const file = input.files?.[0] ?? null
      cleanup()
      if (!file) return resolve(null)
      shrinkForUpload(file).then(resolve, reject)
    }
    // Some browsers do not fire change on cancel; resolve on focus return.
    const onFocus = () => {
      window.removeEventListener('focus', onFocus)
      setTimeout(() => {
        if (document.body.contains(input) && !input.files?.length) {
          cleanup()
          resolve(null)
        }
      }, 800)
    }
    window.addEventListener('focus', onFocus)
    input.click()
  })
}

/**
 * The "get me one photo" entry point used by the fallback path:
 * native -> Capacitor Camera; web -> file picker.
 */
export function getFallbackPhoto(source: 'camera' | 'photos'): Promise<CapturedPhoto | null> {
  if (Capacitor.isNativePlatform()) return takeSystemPhoto(source)
  return pickFileFromWeb(source === 'camera')
}
