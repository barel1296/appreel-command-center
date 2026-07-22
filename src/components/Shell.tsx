// App shell: sidebar (desktop), topbar with product + role switchers, alert
// bell, mobile drawer nav. Role switching demonstrates RBAC across the app.
import { clsx } from 'clsx'
import {
  Activity, AlertTriangle, BarChart3, Bell, BookOpenCheck, BrainCircuit, ClipboardList,
  Clapperboard, Database, Film, Flame, LayoutDashboard, Menu, Palette, Rocket, Settings2, Users,
  Sparkles, Stethoscope, X,
} from 'lucide-react'
import { ReactNode, useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useApp } from '@/state/store'
import { ROLE_LABELS } from '@/domain/config'
import { Avatar } from './ui'
import { DateRangePicker } from './DateRangePicker'
import { RefreshButton } from './RefreshButton'
import { CountryFilter } from './CountryFilter'
import { PlatformFilter } from './PlatformFilter'

const NAV = [
  { to: '/', label: 'Command Center', icon: LayoutDashboard, end: true },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/content', label: 'Content', icon: Clapperboard },
  { to: '/product', label: 'Product', icon: Film },
  { to: '/retention', label: 'Retention', icon: Users },
  { to: '/war-room', label: 'War Room', icon: Flame },
  { to: '/fresh', label: 'Fresh Campaigns', icon: Rocket },
  { to: '/doctor', label: 'Campaign Doctor', icon: Stethoscope },
  { to: '/queue', label: 'Decision Queue', icon: ClipboardList },
  { to: '/ledger', label: 'Decision Ledger', icon: BookOpenCheck },
  { to: '/creative', label: 'Creative Intel', icon: Palette },
  { to: '/organic', label: 'Store & Social', icon: Activity },
  { to: '/tracking', label: 'Tracking Health', icon: Database },
  { to: '/copilot', label: 'Copilot', icon: BrainCircuit },
  { to: '/settings', label: 'Settings', icon: Settings2 },
]

function NavItems({ onNavigate, alertCount, queueCount }: { onNavigate?: () => void; alertCount: number; queueCount: number }) {
  return (
    <nav className="flex flex-col gap-0.5 px-2" aria-label="Primary">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-semibold transition-colors',
              isActive ? 'bg-brand-500/15 text-brand-300' : 'text-ink-mid hover:text-ink-hi hover:bg-surface-2',
            )
          }
        >
          <item.icon size={16} className="shrink-0" />
          <span className="flex-1">{item.label}</span>
          {item.to === '/war-room' && alertCount > 0 && (
            <span className="text-2xs font-bold bg-bad-500 text-white rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">{alertCount}</span>
          )}
          {item.to === '/queue' && queueCount > 0 && (
            <span className="text-2xs font-bold bg-brand-500 text-white rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">{queueCount}</span>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

export function Shell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [userMenu, setUserMenu] = useState(false)
  const location = useLocation()
  const app = useApp()
  const user = app.currentUser()

  useEffect(() => setMobileOpen(false), [location.pathname])
  useEffect(() => {
    const close = () => setUserMenu(false)
    if (userMenu) {
      window.addEventListener('click', close)
      return () => window.removeEventListener('click', close)
    }
  }, [userMenu])

  const urgentAlerts = app.alerts.filter((a) => a.state !== 'resolved' && (a.severity === 'critical' || a.severity === 'high')).length
  const queueCount = app.recommendations.filter((r) => r.approval_status === 'proposed').length

  const product = app.dataset?.products.find((p) => p.product_id === app.productId)

  return (
    <div className="min-h-screen flex bg-surface-0">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-56 shrink-0 border-r border-line bg-surface-1/60 sticky top-0 h-screen">
        <div className="flex items-center gap-2.5 px-4 h-14 border-b border-line shrink-0">
          <Logo />
        </div>
        <div className="py-3 overflow-y-auto flex-1">
          <NavItems alertCount={urgentAlerts} queueCount={queueCount} />
        </div>
        <div className="px-4 py-3 border-t border-line text-2xs text-ink-low leading-relaxed">
          <div className="flex items-center gap-1.5 mb-1">
            <Sparkles size={11} className={app.realConnected ? 'text-ok-400' : app.liveError ? 'text-bad-400' : 'text-brand-300'} />
            <span className="font-semibold text-ink-mid">
              {app.realConnected ? 'Live data connected' : app.liveError ? 'Live connection FAILED' : 'Simulation workspace'}
            </span>
          </div>
          {app.realConnected
            ? 'AppsFlyer is the source of truth for cost, attributed installs and revenue across Meta, TikTok and organic; Mixpanel for in-app behaviour. Decisions, config and audit are local.'
            : app.liveError
              ? `Could not reach the live source, so every number on screen is SIMULATED and must not be acted on. ${app.liveError}`
              : 'Facts are generated by the built-in simulation source; decisions, config and audit are live.'}
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/60 animate-fade-in" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-64 bg-surface-1 border-r border-line-strong shadow-pop animate-slide-in-right flex flex-col">
            <div className="flex items-center justify-between px-4 h-14 border-b border-line">
              <Logo />
              <button onClick={() => setMobileOpen(false)} aria-label="Close navigation" className="text-ink-low hover:text-ink-hi p-1">
                <X size={18} />
              </button>
            </div>
            <div className="py-3 overflow-y-auto flex-1">
              <NavItems onNavigate={() => setMobileOpen(false)} alertCount={urgentAlerts} queueCount={queueCount} />
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-40 h-14 border-b border-line bg-surface-0/85 backdrop-blur-md flex items-center gap-3 px-4">
          <button className="lg:hidden text-ink-mid hover:text-ink-hi p-1 -ml-1" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu size={19} />
          </button>
          <div className="lg:hidden"><Logo compact /></div>

          {product && (
            <div className="hidden sm:flex items-center gap-2 bg-surface-2 border border-line rounded-lg px-3 py-1.5">
              <span aria-hidden>{product.icon}</span>
              <span className="text-[13px] font-semibold">{product.name}</span>
              <span className="text-2xs text-ok-400 font-bold uppercase">live</span>
            </div>
          )}

          <div className="flex-1" />

          <PlatformFilter />
          <CountryFilter />
          <DateRangePicker />
          <RefreshButton />

          <NavLink
            to="/war-room"
            className="relative p-2 rounded-lg text-ink-mid hover:text-ink-hi hover:bg-surface-2 transition-colors"
            aria-label={`War room — ${urgentAlerts} urgent alerts`}
          >
            <Bell size={17} />
            {urgentAlerts > 0 && (
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-bad-400 animate-pulse2" />
            )}
          </NavLink>

          {/* Role switcher (RBAC demo) */}
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setUserMenu((v) => !v) }}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2 transition-colors"
              aria-haspopup="menu"
              aria-expanded={userMenu}
            >
              <Avatar name={user.name} hue={user.avatar_hue} />
              <div className="hidden md:block text-left">
                <div className="text-xs font-bold leading-tight">{user.name}</div>
                <div className="text-2xs text-ink-low leading-tight">{ROLE_LABELS[user.role]}</div>
              </div>
            </button>
            {userMenu && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-1 w-64 bg-surface-2 border border-line-strong rounded-xl shadow-pop py-1.5 animate-fade-in"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="label-2xs px-3 pt-1 pb-2">Switch user (RBAC demo)</div>
                {app.dataset?.users.map((u) => (
                  <button
                    key={u.user_id}
                    role="menuitem"
                    onClick={() => { app.switchUser(u.user_id); setUserMenu(false) }}
                    className={clsx(
                      'w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-3 transition-colors',
                      u.user_id === user.user_id && 'bg-brand-500/10',
                    )}
                  >
                    <Avatar name={u.name} hue={u.avatar_hue} size={24} />
                    <div className="flex-1">
                      <div className="text-[13px] font-semibold">{u.name}</div>
                      <div className="text-2xs text-ink-low">{ROLE_LABELS[u.role]}</div>
                    </div>
                    {u.user_id === user.user_id && <span className="text-2xs text-brand-300 font-bold">active</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 px-4 sm:px-6 py-5 max-w-[1500px] w-full mx-auto">{children}</main>
      </div>
    </div>
  )
}

function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center shrink-0">
        <AlertTriangle size={0} className="hidden" />
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M4 16 L10 9 L14 12 L20 4" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="20" cy="4" r="2" fill="#34d399" />
        </svg>
      </span>
      {!compact && (
        <div className="leading-tight">
          <div className="font-extrabold text-[13px] tracking-tight">AppReel CC</div>
          <div className="text-2xs text-ink-low -mt-0.5">Command Center</div>
        </div>
      )}
    </div>
  )
}
