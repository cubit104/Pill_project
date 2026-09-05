import { ShieldIcon } from './Icons'

export const DEFAULT_DISCLAIMER =
  'Results are informational only and not a medical identification. Always confirm with a pharmacist before taking any medication. If you suspect poisoning or overdose, call Poison Control at 1-800-222-1222.'

export default function Disclaimer({ text = DEFAULT_DISCLAIMER, compact = false }: { text?: string; compact?: boolean }) {
  return (
    <div
      role="note"
      className={`flex gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--warn)_35%,transparent)] bg-[var(--warn-tint)] ${
        compact ? 'p-3' : 'p-4'
      }`}
    >
      <ShieldIcon size={22} className="mt-0.5 flex-none text-[var(--warn)]" />
      <p className={`${compact ? 'text-[13px]' : 'text-[14px]'} leading-relaxed text-body`}>{text}</p>
    </div>
  )
}
