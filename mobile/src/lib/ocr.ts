/**
 * On-device text recognition for pharmacy labels, on both platforms.
 *
 * iOS uses Apple's Vision framework through a small plugin that lives in the
 * iOS app target (ios/App/App/AppDelegate.swift → VisionOCRPlugin; the source
 * of truth is mobile/ios-extras-VisionOCR.swift). It is built into the system,
 * so it costs nothing in app size.
 *
 * Android uses Google's ML Kit. It only reads images from disk, so the frame is
 * written to the cache directory first and deleted afterwards.
 *
 * Both return the same shape: the printed lines, top to bottom, with `y`
 * normalised to 0–1 so lib/labelMerge can fold frames together the same way on
 * either platform.
 */
import { Capacitor, registerPlugin } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { TextRecognition } from '@capacitor-mlkit/text-recognition'
import type { OcrLine } from './labelParse'

interface VisionOcrPlugin {
  recognize(options: { base64: string }): Promise<{ lines: Array<{ text: string; confidence?: number; x?: number; y?: number; w?: number; h?: number }> }>
}

const VisionOCR = registerPlugin<VisionOcrPlugin>('VisionOCR')

function platform(): 'ios' | 'android' | 'web' {
  return Capacitor.getPlatform() as 'ios' | 'android' | 'web'
}

/** True when this device can read a label without a network round trip. */
export function ocrAvailable(): boolean {
  if (!Capacitor.isNativePlatform()) return false
  if (platform() === 'ios') return Capacitor.isPluginAvailable('VisionOCR')
  if (platform() === 'android') return Capacitor.isPluginAvailable('TextRecognition')
  return false
}

async function recognizeWithVision(base64: string): Promise<OcrLine[]> {
  const { lines } = await VisionOCR.recognize({ base64 })
  return lines.map((l) => ({ text: l.text, y: l.y, confidence: l.confidence }))
}

/** ML Kit reports pixel boxes; scale them to 0–1 so both platforms agree. */
async function recognizeWithMlKit(base64: string): Promise<OcrLine[]> {
  const name = `pillseek-ocr-${Date.now()}.jpg`
  let path: string | null = null
  try {
    await Filesystem.writeFile({ path: name, data: base64, directory: Directory.Cache })
    path = (await Filesystem.getUri({ path: name, directory: Directory.Cache })).uri
    const { blocks } = await TextRecognition.processImage({ path })
    const raw: { text: string; top: number; bottom: number }[] = []
    for (const block of blocks) {
      for (const line of block.lines) {
        const box = line.boundingBox ?? block.boundingBox
        raw.push({ text: line.text, top: box?.top ?? 0, bottom: box?.bottom ?? box?.top ?? 0 })
      }
    }
    const height = Math.max(1, ...raw.map((r) => r.bottom))
    return raw.map((r) => ({ text: r.text, y: r.top / height }))
  } finally {
    if (path) await Filesystem.deleteFile({ path: name, directory: Directory.Cache }).catch(() => {})
  }
}

/** Recognise printed text in a JPEG/PNG (base64, no data: prefix), top line first. */
export async function recognizeText(base64: string): Promise<OcrLine[]> {
  const lines = platform() === 'android' ? await recognizeWithMlKit(base64) : await recognizeWithVision(base64)
  return lines.sort((a, b) => (a.y ?? 0) - (b.y ?? 0))
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error('Could not read the photo'))
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.readAsDataURL(blob)
  })
}
