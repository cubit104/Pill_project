import { NavLink, useLocation } from 'react-router-dom'
import { CameraIcon, ClockIcon, HomeIcon, SearchIcon } from './Icons'
import { hapticTick } from '../lib/native'

export const TABS = [
  { to: '/home', label: 'Home', Icon: HomeIcon },
  { to: '/identify', label: 'Identify', Icon: CameraIcon },
  { to: '/search', label: 'Search', Icon: SearchIcon },
  { to: '/recent', label: 'Recent', Icon: ClockIcon },
] as const

export default function TabBar() {
  const location = useLocation()
  return (
    <nav
      aria-label="Main"
      className="tab-bar fixed inset-x-0 bottom-0 z-30"
      style={{ paddingBottom: 'var(--safe-bottom)', paddingLeft: 'var(--safe-left)', paddingRight: 'var(--safe-right)' }}
    >
      <ul className="mx-auto flex h-14 max-w-lg items-stretch">
        {TABS.map(({ to, label, Icon }) => {
          // About lives under Home (reached from its grid), so Home stays lit there.
          const active = location.pathname.startsWith(to) || (to === '/home' && location.pathname.startsWith('/about'))
          return (
            <li key={to} className="flex-1">
              <NavLink
                to={to}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  if (!active) void hapticTick()
                }}
                className={`pressable flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${
                  active ? 'text-brand' : 'text-muted'
                }`}
              >
                <Icon size={26} strokeWidth={active ? 2.3 : 1.8} />
                <span>{label}</span>
              </NavLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
