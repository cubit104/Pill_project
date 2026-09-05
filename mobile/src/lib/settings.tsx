/**
 * App-wide settings (persisted) and feature flags (from the API).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useFeatures, type FeaturesState } from './hooks'
import { loadConsent, saveConsent } from './storage'

interface SettingsApi extends FeaturesState {
  consent: boolean
  setConsent: (on: boolean) => void
  consentLoaded: boolean
}

const SettingsContext = createContext<SettingsApi | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const features = useFeatures()
  const [consent, setConsentState] = useState(true)
  const [consentLoaded, setConsentLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadConsent().then((v) => {
      if (cancelled) return
      setConsentState(v)
      setConsentLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const setConsent = useCallback((on: boolean) => {
    setConsentState(on)
    void saveConsent(on)
  }, [])

  const api = useMemo<SettingsApi>(
    () => ({ ...features, consent, setConsent, consentLoaded }),
    [features, consent, setConsent, consentLoaded],
  )
  return <SettingsContext.Provider value={api}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsApi {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider')
  return ctx
}
