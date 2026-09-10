/**
 * Interface language. English is the source of truth: `t('Save to my cabinet')`
 * looks the English sentence up in the Spanish dictionary and falls back to the
 * English text itself, so untranslated strings never break. Drug content from
 * the FDA stays English; only the app's own words are translated.
 *
 * Dictionaries live in src/i18n/es/*.ts (one file per area); Vite's glob import
 * merges them, so new files just work.
 *
 * Placeholders: t('Take {dose}', { dose: '1 tablet' }).
 */
import { Preferences } from '@capacitor/preferences'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Lang = 'auto' | 'en' | 'es'
export type Resolved = 'en' | 'es'

const KEY = 'pillseek.lang.v1'

const esModules = import.meta.glob<{ default: Record<string, string> }>('../i18n/es/*.ts', { eager: true })
const ES: Record<string, string> = Object.assign({}, ...Object.values(esModules).map((m) => m.default))

function deviceLang(): Resolved {
  const tags = typeof navigator !== 'undefined' ? [...(navigator.languages ?? []), navigator.language] : []
  return tags.some((l) => /^es\b/i.test(l ?? '')) ? 'es' : 'en'
}

export function translate(lang: Resolved, text: string, vars?: Record<string, string | number>): string {
  let out = lang === 'es' ? (ES[text] ?? text) : text
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v))
  return out
}

/**
 * The language the app is currently showing, mirrored outside React so modules
 * with no hooks (notification scheduling) can translate too. LangProvider keeps
 * it in step.
 */
let current: Resolved = 'en'

/** Translate from a non-React module (notifications, background work). */
export function tr(text: string, vars?: Record<string, string | number>): string {
  return translate(current, text, vars)
}

interface LangApi {
  lang: Lang
  resolved: Resolved
  setLang: (l: Lang) => void
  t: (text: string, vars?: Record<string, string | number>) => string
}

const Ctx = createContext<LangApi | null>(null)

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('auto')
  useEffect(() => {
    void Preferences.get({ key: KEY }).then(({ value }) => {
      if (value === 'en' || value === 'es' || value === 'auto') setLangState(value)
    })
  }, [])
  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    void Preferences.set({ key: KEY, value: l })
  }, [])
  const resolved: Resolved = lang === 'auto' ? deviceLang() : lang
  current = resolved
  useEffect(() => {
    document.documentElement.lang = resolved
  }, [resolved])
  const t = useCallback((text: string, vars?: Record<string, string | number>) => translate(resolved, text, vars), [resolved])
  const api = useMemo<LangApi>(() => ({ lang, resolved, setLang, t }), [lang, resolved, setLang, t])
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useLang(): LangApi {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useLang must be used inside LangProvider')
  return ctx
}

/** Shorthand for components that only need the translator. */
export function useT(): LangApi['t'] {
  return useLang().t
}

/** Locale tag for Date/Number formatting. */
export function useLocale(): string {
  return useLang().resolved === 'es' ? 'es-US' : 'en-US'
}
