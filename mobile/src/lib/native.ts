/**
 * Thin wrappers around Capacitor plugins so screens never need to know
 * whether they run natively or in a browser.
 */
import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'
import { StatusBar, Style } from '@capacitor/status-bar'
import { SplashScreen } from '@capacitor/splash-screen'
import { Keyboard } from '@capacitor/keyboard'

export const isNative = (): boolean => Capacitor.isNativePlatform()
export const platform = (): 'ios' | 'android' | 'web' => Capacitor.getPlatform() as 'ios' | 'android' | 'web'

export async function openUrl(url: string): Promise<void> {
  try {
    await Browser.open({ url, presentationStyle: 'popover', toolbarColor: prefersDark() ? '#0b1220' : '#ffffff' })
  } catch {
    window.open(url, '_blank', 'noopener')
  }
}

export async function hapticTick(): Promise<void> {
  if (!isNative()) return
  try {
    await Haptics.selectionStart()
    await Haptics.selectionChanged()
    await Haptics.selectionEnd()
  } catch {
    /* no haptics */
  }
}

export async function hapticImpact(style: 'light' | 'medium' = 'light'): Promise<void> {
  if (!isNative()) return
  try {
    await Haptics.impact({ style: style === 'light' ? ImpactStyle.Light : ImpactStyle.Medium })
  } catch {
    /* no haptics */
  }
}

export async function hapticNotify(kind: 'success' | 'warning' | 'error'): Promise<void> {
  if (!isNative()) return
  const map = { success: NotificationType.Success, warning: NotificationType.Warning, error: NotificationType.Error }
  try {
    await Haptics.notification({ type: map[kind] })
  } catch {
    /* no haptics */
  }
}

export function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** Match the status bar to the current theme (or force light-on-dark for the camera). */
export async function applyStatusBar(mode: 'auto' | 'camera'): Promise<void> {
  if (!isNative()) return
  try {
    const dark = mode === 'camera' || prefersDark()
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light })
    if (platform() === 'android') {
      // Android's WebView reports no safe-area inset for the status bar, so do
      // not draw under it: give it its own themed strip instead.
      await StatusBar.setOverlaysWebView({ overlay: false })
      await StatusBar.setBackgroundColor({ color: mode === 'camera' ? '#000000' : dark ? '#0b1220' : '#f8fafc' })
    }
  } catch {
    /* status bar not available */
  }
}

export async function hideSplash(): Promise<void> {
  if (!isNative()) return
  try {
    await SplashScreen.hide({ fadeOutDuration: 200 })
  } catch {
    /* ignore */
  }
}

export async function hideKeyboard(): Promise<void> {
  if (!isNative()) return
  try {
    await Keyboard.hide()
  } catch {
    /* ignore */
  }
}

export function appVersion(): string {
  const v = import.meta.env.VITE_APP_VERSION as string | undefined
  return v || '1.0.0'
}

/**
 * Keyboard overlay mode: the WebView keeps its size (capacitor.config.ts sets
 * resize: None) so the page never jumps; instead we publish the keyboard height
 * as a CSS variable (--kb) that scroll containers add as bottom padding, and
 * nudge the focused field into view.
 */
export function installKeyboardListeners(): () => void {
  if (!isNative()) return () => {}
  const root = document.documentElement
  const set = (px: number) => root.style.setProperty('--kb', `${Math.max(0, Math.round(px))}px`)
  const subs = [
    Keyboard.addListener('keyboardWillShow', (info) => set(info.keyboardHeight)),
    Keyboard.addListener('keyboardDidShow', (info) => {
      set(info.keyboardHeight)
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        requestAnimationFrame(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }))
      }
    }),
    Keyboard.addListener('keyboardWillHide', () => set(0)),
    Keyboard.addListener('keyboardDidHide', () => set(0)),
  ]
  return () => {
    for (const s of subs) void s.then((h) => h.remove())
    set(0)
  }
}
