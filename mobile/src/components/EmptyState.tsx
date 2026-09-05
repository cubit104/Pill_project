import type { ReactNode } from 'react'

type Art = 'pill' | 'search' | 'clock' | 'offline' | 'paused'

interface Props {
  art?: Art
  title: string
  body?: string
  action?: ReactNode
}

/** Inline SVG illustrations: small, brand-tinted, no external assets. */
function Illustration({ art }: { art: Art }) {
  const common = { width: 132, height: 96, viewBox: '0 0 132 96', fill: 'none', 'aria-hidden': true } as const
  switch (art) {
    case 'search':
      return (
        <svg {...common}>
          <ellipse cx="66" cy="84" rx="44" ry="6" fill="var(--brand-tint)" />
          <circle cx="58" cy="42" r="24" stroke="var(--brand)" strokeWidth="4" />
          <circle cx="58" cy="42" r="15" fill="var(--brand-tint)" />
          <path d="M76 60l18 18" stroke="var(--brand)" strokeWidth="6" strokeLinecap="round" />
          <rect x="49" y="37" width="18" height="10" rx="5" fill="var(--surface)" stroke="var(--brand)" strokeWidth="2.5" transform="rotate(-25 58 42)" />
        </svg>
      )
    case 'clock':
      return (
        <svg {...common}>
          <ellipse cx="66" cy="84" rx="44" ry="6" fill="var(--brand-tint)" />
          <circle cx="66" cy="44" r="28" fill="var(--brand-tint)" stroke="var(--brand)" strokeWidth="4" />
          <path d="M66 26v18l12 8" stroke="var(--brand)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="66" cy="44" r="3" fill="var(--brand)" />
        </svg>
      )
    case 'offline':
      return (
        <svg {...common}>
          <ellipse cx="66" cy="84" rx="44" ry="6" fill="var(--brand-tint)" />
          <path d="M30 40c20-18 52-18 72 0" stroke="var(--border)" strokeWidth="5" strokeLinecap="round" />
          <path d="M42 52c14-12 34-12 48 0" stroke="var(--border)" strokeWidth="5" strokeLinecap="round" />
          <path d="M54 64c7-6 17-6 24 0" stroke="var(--muted)" strokeWidth="5" strokeLinecap="round" />
          <circle cx="66" cy="74" r="4" fill="var(--muted)" />
          <path d="M36 24l60 56" stroke="var(--danger)" strokeWidth="5" strokeLinecap="round" />
        </svg>
      )
    case 'paused':
      return (
        <svg {...common}>
          <ellipse cx="66" cy="84" rx="44" ry="6" fill="var(--brand-tint)" />
          <rect x="34" y="28" width="64" height="44" rx="10" fill="var(--surface)" stroke="var(--muted)" strokeWidth="3.5" />
          <circle cx="66" cy="50" r="12" stroke="var(--muted)" strokeWidth="3.5" />
          <rect x="58" y="44" width="5" height="12" rx="1.5" fill="var(--muted)" />
          <rect x="69" y="44" width="5" height="12" rx="1.5" fill="var(--muted)" />
          <rect x="52" y="20" width="28" height="10" rx="4" fill="var(--muted)" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <ellipse cx="66" cy="84" rx="44" ry="6" fill="var(--brand-tint)" />
          <g transform="rotate(-32 66 48)">
            <rect x="30" y="34" width="72" height="28" rx="14" fill="var(--surface)" stroke="var(--brand)" strokeWidth="4" />
            <path d="M66 34v28" stroke="var(--brand)" strokeWidth="4" />
            <rect x="32" y="36" width="34" height="24" rx="12" fill="var(--brand)" opacity="0.9" />
          </g>
          <circle cx="104" cy="28" r="4" fill="var(--brand)" opacity="0.5" />
          <circle cx="26" cy="66" r="3" fill="var(--brand)" opacity="0.4" />
        </svg>
      )
  }
}

export default function EmptyState({ art = 'pill', title, body, action }: Props) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <Illustration art={art} />
      <h3 className="mt-4 text-[20px] font-bold tracking-tight text-ink">{title}</h3>
      {body && <p className="mt-1.5 max-w-xs text-[15px] leading-relaxed text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
