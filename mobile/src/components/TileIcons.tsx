import type { ReactNode } from 'react'

/**
 * Duotone icons for the Home grid: an ink outline plus a lighter accent shape,
 * in the style of the big drug-reference apps. Colours come from CSS variables
 * set by `.tile-icon` (see styles.css) so they adapt to dark mode and to the
 * filled "Photo ID" tile.
 */
export interface TileIconProps {
  size?: number
}

function Duo({ size = 34, children }: TileIconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke="var(--ti-ink)"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable={false}
    >
      {children}
    </svg>
  )
}

const FILL = 'var(--ti-fill)'
const ACCENT = 'var(--ti-accent)'
const HOLE = 'var(--ti-hole)'

export function CameraTile(p: TileIconProps) {
  return (
    <Duo {...p}>
      <path d="M7 17.5A4.5 4.5 0 0 1 11.5 13H16l2.6-3.6A2 2 0 0 1 20.2 8.5h7.6a2 2 0 0 1 1.6.9L32 13h4.5A4.5 4.5 0 0 1 41 17.5v17A4.5 4.5 0 0 1 36.5 39h-25A4.5 4.5 0 0 1 7 34.5z" fill={FILL} />
      <circle cx="24" cy="26" r="7.5" fill={HOLE} />
      <circle cx="24" cy="26" r="3.5" stroke={ACCENT} />
      <circle cx="35" cy="18.5" r="1.6" fill={ACCENT} stroke="none" />
    </Duo>
  )
}

export function ImprintTile(p: TileIconProps) {
  return (
    <Duo {...p}>
      <path d="M13 16h11v16H13a8 8 0 0 1 0-16z" fill={FILL} stroke="none" />
      <rect x="5" y="16" width="38" height="16" rx="8" />
      <path d="M24 16v16" stroke={ACCENT} />
      <path d="M11 27v-4.5a2.5 2.5 0 0 1 5 0V27M11 24.5h5" />
      <path d="M30 20v8h3.4a2 2 0 0 0 0-4H30h3a2 2 0 0 0 0-4z" />
    </Duo>
  )
}

export function DrugNameTile(p: TileIconProps) {
  return (
    <Duo {...p}>
      <circle cx="21" cy="21" r="13" fill={FILL} />
      <path d="M31 31l10 10" strokeWidth="3.2" />
      <rect x="13.5" y="17.5" width="15" height="7" rx="3.5" fill={HOLE} stroke={ACCENT} transform="rotate(-30 21 21)" />
      <path d="M21 17.4v7.2" stroke={ACCENT} transform="rotate(-30 21 21)" />
    </Duo>
  )
}

export function NdcTile(p: TileIconProps) {
  return (
    <Duo {...p}>
      <rect x="6" y="10" width="36" height="28" rx="4.5" fill={FILL} />
      <path d="M12 16v16M17 16v16M22 16v16M31 16v16M36 16v16" />
      <path d="M26.5 16v16" strokeWidth="3.6" />
      <path d="M6 24h36" stroke={ACCENT} strokeDasharray="3 3" />
    </Duo>
  )
}

export function SideEffectsTile(p: TileIconProps) {
  return (
    <Duo {...p}>
      <path d="M21.4 8.9a3 3 0 0 1 5.2 0l15.6 27.3A3 3 0 0 1 39.6 40.7H8.4a3 3 0 0 1-2.6-4.5z" fill={FILL} />
      <path d="M24 19v9" strokeWidth="3" />
      <circle cx="24" cy="33.5" r="1.8" fill="var(--ti-ink)" stroke="none" />
      <path d="M24 12.5l-11 19" stroke={ACCENT} strokeWidth="1.6" opacity="0.6" />
    </Duo>
  )
}

export function DosageTile(p: TileIconProps) {
  return (
    <Duo {...p}>
      <circle cx="19" cy="22" r="12.5" fill={FILL} />
      <path d="M19 9.5v25" stroke={ACCENT} />
      <circle cx="34.5" cy="33.5" r="8.5" fill={HOLE} />
      <path d="M34.5 29v4.5l3 2" stroke={ACCENT} />
    </Duo>
  )
}

export function MedGuideTile(p: TileIconProps) {
  return (
    <Duo {...p}>
      <path d="M9 12a4 4 0 0 1 4-4h26v30H13a4 4 0 0 0-4 4z" fill={FILL} />
      <path d="M13 38h26" />
      <path d="M29 8v12l-3.5-2.6L22 20V8z" fill={ACCENT} stroke="none" />
      <path d="M15 27h14M15 32h9" stroke={ACCENT} />
    </Duo>
  )
}

export function ProInfoTile(p: TileIconProps) {
  return (
    <Duo {...p}>
      <rect x="10" y="10" width="28" height="32" rx="4" fill={FILL} />
      <rect x="18" y="6" width="12" height="7" rx="2" fill={HOLE} />
      <path d="M18 34V21h5a3.2 3.2 0 0 1 0 6.4h-5M23 27.4 30 34M30 27.4 23 34" />
    </Duo>
  )
}

export function PriceTile(p: TileIconProps) {
  return (
    <Duo {...p}>
      <path d="M8 9.5h13.5a3 3 0 0 1 2.1.9l16.6 16.6a3 3 0 0 1 0 4.2l-9.9 9.9a3 3 0 0 1-4.2 0L9.5 24.5A3 3 0 0 1 8.6 22.4V9.5z" fill={FILL} />
      <circle cx="15.5" cy="16.5" r="2.5" fill={HOLE} />
      <path d="M26.5 20.5l-5.4 5.4M24.3 18.3c-1-1-2.9-.9-3.6.2-.8 1.1.2 2.4 1.5 3.5s2.3 2.4 1.5 3.5c-.7 1.1-2.6 1.2-3.6.2" stroke={ACCENT} />
    </Duo>
  )
}

export function InteractionsTile(p: TileIconProps) {
  return (
    <Duo {...p}>
      <rect x="5" y="21" width="24" height="11" rx="5.5" fill={FILL} transform="rotate(-32 17 26.5)" />
      <path d="M17 21v11" stroke={ACCENT} transform="rotate(-32 17 26.5)" />
      <rect x="19" y="21" width="24" height="11" rx="5.5" fill={HOLE} transform="rotate(32 31 26.5)" />
      <circle cx="37.5" cy="11.5" r="6" fill={ACCENT} stroke="none" />
      <path d="M37.5 8.5v3.4M37.5 14.7h.01" stroke={HOLE} strokeWidth="2.2" />
    </Duo>
  )
}

export function RecentTile(p: TileIconProps) {
  return (
    <Duo {...p}>
      <circle cx="24" cy="24" r="16" fill={FILL} />
      <path d="M24 14.5V24l6.5 4" />
      <path d="M8.6 20.5A16 16 0 0 1 14 12" stroke={ACCENT} />
    </Duo>
  )
}

export function AboutTile(p: TileIconProps) {
  return (
    <Duo {...p}>
      <circle cx="24" cy="24" r="16" fill={FILL} />
      <path d="M24 22v11" strokeWidth="3" />
      <circle cx="24" cy="15.5" r="1.9" fill="var(--ti-ink)" stroke="none" />
      <path d="M8.6 20.5A16 16 0 0 1 14 12" stroke={ACCENT} />
    </Duo>
  )
}

/** Medicine box with a capsule: my cabinet. */
export function CabinetTile(p: TileIconProps) {
  return (
    <Duo {...p}>
      <rect x="6" y="15" width="36" height="25" rx="5" fill={FILL} />
      <path d="M6 23h36M17 15v-3.5A3.5 3.5 0 0 1 20.5 8h7a3.5 3.5 0 0 1 3.5 3.5V15" />
      <rect x="15.5" y="27.5" width="17" height="8" rx="4" fill={HOLE} stroke={ACCENT} transform="rotate(-20 24 31.5)" />
      <path d="M24 27.5v8" stroke={ACCENT} transform="rotate(-20 24 31.5)" />
    </Duo>
  )
}
