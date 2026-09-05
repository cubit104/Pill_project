import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function base(size: number | undefined, props: IconProps): SVGProps<SVGSVGElement> {
  const { size: _s, ...rest } = props
  return {
    width: size ?? 24,
    height: size ?? 24,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: false,
    ...rest,
  }
}

export function CameraIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props)}>
      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2l1.1-1.6A1 1 0 0 1 9.6 4h4.8a1 1 0 0 1 .8.4L16.3 6h1.2A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" />
      <circle cx="12" cy="12.5" r="3.4" />
    </svg>
  )
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props)}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  )
}

export function ClockIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  )
}

export function InfoIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props)}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props)}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  )
}

export function FlashIcon(props: IconProps & { on?: boolean }) {
  const { on, ...rest } = props
  return (
    <svg {...base(rest.size, rest)} fill={on ? 'currentColor' : 'none'}>
      <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H13z" />
    </svg>
  )
}

export function ImagesIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props)}>
      <rect x="4" y="6" width="16" height="13" rx="2.5" />
      <path d="m4 16 4.2-4.2a1.5 1.5 0 0 1 2.1 0L14 15.5l1.6-1.6a1.5 1.5 0 0 1 2.1 0L20 16" />
      <circle cx="15" cy="10" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function RefreshIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props)}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v5h-5" />
    </svg>
  )
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props)}>
      <path d="M5 7h14M10 11v6M14 11v6M6.5 7l.8 11.2A2 2 0 0 0 9.3 20h5.4a2 2 0 0 0 2-1.8L17.5 7M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
    </svg>
  )
}

export function ThumbUpIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props)}>
      <path d="M7 11v9H4.5A1.5 1.5 0 0 1 3 18.5v-6A1.5 1.5 0 0 1 4.5 11z" />
      <path d="M7 11.5 11 4a2.2 2.2 0 0 1 2.2 2.6L12.6 10h5.1a2 2 0 0 1 2 2.4l-1.2 6a2 2 0 0 1-2 1.6H7" />
    </svg>
  )
}

export function ThumbDownIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props)}>
      <path d="M17 13V4h2.5A1.5 1.5 0 0 1 21 5.5v6a1.5 1.5 0 0 1-1.5 1.5z" />
      <path d="M17 12.5 13 20a2.2 2.2 0 0 1-2.2-2.6l.6-3.4H6.3a2 2 0 0 1-2-2.4l1.2-6a2 2 0 0 1 2-1.6H17" />
    </svg>
  )
}

export function FlipIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props)}>
      <path d="M12 3v18" strokeDasharray="2 2.5" />
      <path d="M9 6H6.5A2.5 2.5 0 0 0 4 8.5v7A2.5 2.5 0 0 0 6.5 18H9" />
      <path d="M15 6h2.5A2.5 2.5 0 0 1 20 8.5v7a2.5 2.5 0 0 1-2.5 2.5H15" />
    </svg>
  )
}

export function ShieldIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props)}>
      <path d="M12 3.5 5 6.2v5.3c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6.2z" />
      <path d="m9.5 12 1.8 1.8 3.5-3.6" />
    </svg>
  )
}

export function AlertIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props)}>
      <path d="M12 4 3.5 19h17z" />
      <path d="M12 10v4M12 16.5h.01" />
    </svg>
  )
}

export function WifiOffIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props)}>
      <path d="M3 3l18 18" />
      <path d="M5 10.5a11 11 0 0 1 4-2.4M8.5 14a6 6 0 0 1 2.4-1.3M12 18h.01M15.5 14a6 6 0 0 0-1.4-1M19 10.5a11 11 0 0 0-8.8-3.4" />
    </svg>
  )
}

export function SparkleIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props)}>
      <path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18.5l-1.8-5.9L4.5 10.8 10.2 9z" />
    </svg>
  )
}

export function PillIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props)}>
      <rect x="3.5" y="8.5" width="17" height="7" rx="3.5" transform="rotate(-35 12 12)" />
      <path d="m9.2 7.8 5.6 8.4" />
    </svg>
  )
}

export function ExternalIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props)}>
      <path d="M14 5h5v5M19 5l-8 8" />
      <path d="M17 13.5V17a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3.5" />
    </svg>
  )
}
