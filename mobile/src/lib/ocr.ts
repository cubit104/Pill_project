/**
 * On-device text recognition for pharmacy labels. iOS uses Apple's Vision
 * framework through a tiny plugin that lives in the iOS app target
 * (ios/App/App/AppDelegate.swift → VisionOCRPlugin). Android will get ML Kit
 * later; until then `ocrAvailable()` is false there and the scan entry hides.
 */
import { Capacitor, registerPlugin } from '@capacitor/core'
import type { OcrLine } from './labelParse'

interface VisionOcrPlugin {
  recognize(options: { base64: string }): Promise<{ lines: Array<{ text: string; confidence?: number; x?: number; y?: number; w?: number; h?: number }> }>
}

const VisionOCR = registerPlugin<VisionOcrPlugin>('VisionOCR')

export function ocrAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios' && Capacitor.isPluginAvailable('VisionOCR')
}

/** Recognise printed text in a JPEG/PNG (base64, no data: prefix). Lines come back top-to-bottom. */
export async function recognizeText(base64: string): Promise<OcrLine[]> {
  const { lines } = await VisionOCR.recognize({ base64 })
  return lines
    .map((l) => ({ text: l.text, y: l.y, confidence: l.confidence }))
    .sort((a, b) => (a.y ?? 0) - (b.y ?? 0))
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error('Could not read the photo'))
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.readAsDataURL(blob)
  })
}
