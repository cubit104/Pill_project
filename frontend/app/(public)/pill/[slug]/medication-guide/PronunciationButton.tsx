'use client'

import { useEffect, useRef, useState } from 'react'

type PronunciationData = {
  drug_name: string
  pronunciation_text: string | null
  audio_url: string | null
  has_audio: boolean
}

type Props = {
  slug: string
  drugName: string
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || ''

export default function PronunciationButton({ slug, drugName }: Props) {
  const [data, setData] = useState<PronunciationData | null>(null)
  const [playing, setPlaying] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    if (!slug) return
    fetch(`${API_BASE}/api/pill/${encodeURIComponent(slug)}/pronunciation`)
      .then((r) => {
        if (!r.ok) {
          if (r.status !== 404) {
            console.error(`Pronunciation fetch failed: ${r.status}`)
          }
          return null
        }
        return r.json()
      })
      .then((d) => {
        setData(d)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [slug])

  if (!loaded) return null

  function cleanupAudioRef() {
    if (!audioRef.current) return
    audioRef.current.pause()
    audioRef.current.onplay = null
    audioRef.current.onended = null
    audioRef.current.onerror = null
    audioRef.current = null
  }

  function speakDrugName() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const utter = new SpeechSynthesisUtterance(drugName)
    utter.lang = 'en-US'
    utter.rate = 0.9
    utter.onstart = () => setPlaying(true)
    utter.onend = () => setPlaying(false)
    utter.onerror = () => setPlaying(false)
    window.speechSynthesis.speak(utter)
  }

  function handleClick() {
    // If we have an audio_url, play the MP3
    if (data?.audio_url) {
      if (playing) {
        cleanupAudioRef()
        setPlaying(false)
        return
      }
      // Dispose of any previous audio element before creating a new one
      cleanupAudioRef()
      const audio = new Audio(data.audio_url)
      audioRef.current = audio
      audio.onplay = () => setPlaying(true)
      audio.onended = () => setPlaying(false)
      audio.onerror = () => {
        setPlaying(false)
        // Fallback to speechSynthesis on audio error
        speakDrugName()
      }
      audio.play().catch(() => setPlaying(false))
      return
    }

    // Fallback: browser speechSynthesis
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      if (playing) {
        window.speechSynthesis.cancel()
        // cancel() does not reliably fire onend, so reset state immediately
        setPlaying(false)
        return
      }
      speakDrugName()
    }
  }

  const pronunciationText = data?.pronunciation_text

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        aria-label={`Pronounce ${drugName}`}
        title={pronunciationText ? `Pronunciation: ${pronunciationText}` : 'Hear pronunciation'}
        className={`inline-flex items-center justify-center rounded-full w-8 h-8 border transition-colors ${
          playing
            ? 'border-emerald-500 bg-emerald-50 text-emerald-600 animate-pulse'
            : 'border-slate-300 bg-white text-slate-500 hover:border-emerald-400 hover:text-emerald-700'
        }`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="w-4 h-4"
          aria-hidden="true"
        >
          <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 001.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06zM18.584 5.106a.75.75 0 011.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 01-1.06-1.06 8.25 8.25 0 000-11.668.75.75 0 010-1.06z" />
          <path d="M15.932 7.757a.75.75 0 011.061 0 6 6 0 010 8.486.75.75 0 01-1.06-1.061 4.5 4.5 0 000-6.364.75.75 0 010-1.061z" />
        </svg>
      </button>
      {pronunciationText && (
        <span className="text-sm text-slate-400 font-normal italic leading-none">
          {pronunciationText}
        </span>
      )}
    </span>
  )
}
