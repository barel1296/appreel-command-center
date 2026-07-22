// Global platform filter (topbar). iOS and Android behave differently enough
// in a short-drama app — different store economics, different paywall rules,
// different binge patterns — that a blended number often hides the answer.
import { clsx } from 'clsx'
import { Smartphone } from 'lucide-react'
import { useApp } from '@/state/store'

const OPTIONS = [
  { id: 'all' as const, label: 'All platforms', short: 'All' },
  { id: 'ios' as const, label: 'iOS', short: 'iOS' },
  { id: 'android' as const, label: 'Android', short: 'Android' },
]

export function PlatformFilter() {
  const { platform, setPlatform } = useApp()
  return (
    <div className="flex items-center gap-0.5 bg-surface-2 border border-line rounded-lg p-0.5" role="group" aria-label="Platform">
      <Smartphone size={13} className={clsx('ml-1.5 mr-0.5 shrink-0', platform === 'all' ? 'text-ink-low' : 'text-brand-300')} />
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          onClick={() => setPlatform(o.id)}
          aria-pressed={platform === o.id}
          title={`Show ${o.label}`}
          className={clsx(
            'text-2xs font-bold px-2 py-1 rounded-md transition-colors whitespace-nowrap',
            platform === o.id ? 'bg-brand-500 text-white' : 'text-ink-mid hover:text-ink-hi',
          )}
        >
          {o.short}
        </button>
      ))}
    </div>
  )
}
