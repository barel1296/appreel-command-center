// Global country filter (topbar) — multi-select, drives every analytic
// surface alongside the date range. Empty selection = all countries.
// Options come from the geo cube, ordered by install volume so the countries
// that matter are reachable first.
import { clsx } from 'clsx'
import { Check, ChevronDown, Globe } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { fmtNum } from '@/lib/format'
import { useApp } from '@/state/store'

export function CountryFilter() {
  const { dataset, countries, setCountries, dateRange } = useApp()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  // Options ranked by installs inside the active date range
  const options = useMemo(() => {
    const rows = (dataset?.geo_cohort ?? []).filter(
      (r) => r.cohort_date >= dateRange.from && r.cohort_date <= dateRange.to,
    )
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.country, (m.get(r.country) ?? 0) + r.installs)
    return [...m.entries()].map(([code, installs]) => ({ code, installs })).sort((a, b) => b.installs - a.installs)
  }, [dataset, dateRange])

  const available = options.length > 0
  const toggle = (code: string) => {
    setCountries(countries.includes(code) ? countries.filter((c) => c !== code) : [...countries, code])
  }

  const label = countries.length === 0
    ? 'All countries'
    : countries.length <= 2
      ? countries.join(', ')
      : `${countries.length} countries`

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={!available}
        className="flex items-center gap-2 bg-surface-2 border border-line rounded-lg px-3 py-1.5 hover:bg-surface-3 transition-colors disabled:opacity-50"
        title={available ? 'Filter every screen by country' : 'Country data requires the live source'}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Globe size={14} className={clsx('shrink-0', countries.length > 0 ? 'text-brand-300' : 'text-ink-low')} />
        <span className="text-[13px] font-semibold whitespace-nowrap hidden sm:inline">{label}</span>
        <ChevronDown size={13} className="text-ink-low shrink-0" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose countries"
          className="absolute right-0 top-full mt-1.5 w-64 bg-surface-2 border border-line-strong rounded-xl shadow-pop p-2 animate-fade-in z-50"
        >
          <div className="flex items-center justify-between px-1.5 pb-2">
            <span className="label-2xs">Countries · by installs</span>
            {countries.length > 0 && (
              <button onClick={() => setCountries([])} className="text-2xs font-bold text-brand-300 hover:text-brand-400">
                Clear
              </button>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto space-y-0.5">
            <button
              onClick={() => { setCountries([]); setOpen(false) }}
              className={clsx(
                'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors',
                countries.length === 0 ? 'bg-brand-500/15 text-brand-300' : 'hover:bg-surface-3',
              )}
            >
              <span className="w-4 h-4 rounded border border-line-strong flex items-center justify-center shrink-0">
                {countries.length === 0 && <Check size={11} className="text-brand-300" />}
              </span>
              <span className="text-[13px] font-semibold flex-1">All countries</span>
            </button>
            {options.map((o) => {
              const on = countries.includes(o.code)
              return (
                <button
                  key={o.code}
                  onClick={() => toggle(o.code)}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors',
                    on ? 'bg-brand-500/15' : 'hover:bg-surface-3',
                  )}
                >
                  <span className={clsx(
                    'w-4 h-4 rounded border flex items-center justify-center shrink-0',
                    on ? 'bg-brand-500 border-brand-500' : 'border-line-strong',
                  )}>
                    {on && <Check size={11} className="text-white" />}
                  </span>
                  <span className={clsx('text-[13px] font-semibold flex-1', on && 'text-brand-300')}>{o.code}</span>
                  <span className="text-2xs text-ink-low num">{fmtNum(o.installs)}</span>
                </button>
              )
            })}
          </div>
          <p className="text-2xs text-ink-low mt-2 px-1.5 leading-relaxed">
            Applies to Analytics and Product. Campaign-level screens stay unfiltered — a campaign is scoped to its own
            geos already.
          </p>
        </div>
      )}
    </div>
  )
}
