// Global date-range control (topbar) — drives every analytic surface:
// Command Center KPIs/charts, Analytics, and Product Analytics. Engine
// windows (Doctor/Queue recommendations) stay on the managed config window.
import { CalendarDays, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { fmtDate, isoDaysAgo } from '@/lib/format'
import { useApp } from '@/state/store'

const PRESETS = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 14 days', days: 14 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 60 days', days: 60 },
]

export function DateRangePicker() {
  const { dateRange, setDateRange } = useApp()
  const [open, setOpen] = useState(false)
  const [draftFrom, setDraftFrom] = useState(dateRange.from)
  const [draftTo, setDraftTo] = useState(dateRange.to)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setDraftFrom(dateRange.from)
    setDraftTo(dateRange.to)
  }, [dateRange])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const today = isoDaysAgo(0)
  const applyPreset = (days: number) => {
    setDateRange(isoDaysAgo(days), today)
    setOpen(false)
  }
  const applyCustom = () => {
    if (draftFrom && draftTo && draftFrom <= draftTo) {
      setDateRange(draftFrom, draftTo)
      setOpen(false)
    }
  }
  const invalid = !draftFrom || !draftTo || draftFrom > draftTo

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 bg-surface-2 border border-line rounded-lg px-3 py-1.5 hover:bg-surface-3 transition-colors"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Date range for analytics surfaces"
      >
        <CalendarDays size={14} className="text-brand-300 shrink-0" />
        <span className="text-[13px] font-semibold whitespace-nowrap num hidden xs:inline sm:inline">
          {fmtDate(dateRange.from)} – {fmtDate(dateRange.to)}
        </span>
        <ChevronDown size={13} className="text-ink-low shrink-0" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose date range"
          className="absolute right-0 top-full mt-1.5 w-72 bg-surface-2 border border-line-strong rounded-xl shadow-pop p-3 animate-fade-in z-50"
        >
          <div className="label-2xs mb-2">Presets</div>
          <div className="grid grid-cols-2 gap-1.5 mb-3">
            {PRESETS.map((p) => (
              <button
                key={p.days}
                onClick={() => applyPreset(p.days)}
                className="text-[13px] font-semibold bg-surface-3 hover:bg-surface-4 border border-line rounded-lg px-2 py-1.5 transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="label-2xs mb-2">Custom range</div>
          <div className="flex items-center gap-2 mb-3">
            <input
              type="date"
              value={draftFrom}
              max={draftTo || today}
              onChange={(e) => setDraftFrom(e.target.value)}
              aria-label="From date"
              className="flex-1 min-w-0 bg-surface-1 border border-line rounded-lg px-2 py-1.5 text-xs num text-ink-hi outline-none focus:border-brand-400 [color-scheme:dark]"
            />
            <span className="text-ink-low text-xs shrink-0">→</span>
            <input
              type="date"
              value={draftTo}
              min={draftFrom}
              max={today}
              onChange={(e) => setDraftTo(e.target.value)}
              aria-label="To date"
              className="flex-1 min-w-0 bg-surface-1 border border-line rounded-lg px-2 py-1.5 text-xs num text-ink-hi outline-none focus:border-brand-400 [color-scheme:dark]"
            />
          </div>
          {invalid && <p className="text-2xs text-bad-400 mb-2">Pick a valid range (from ≤ to).</p>}
          <button
            onClick={applyCustom}
            disabled={invalid}
            className="w-full text-[13px] font-bold bg-brand-500 hover:bg-brand-400 disabled:opacity-40 text-white rounded-lg py-1.5 transition-colors"
          >
            Apply
          </button>
          <p className="text-2xs text-ink-low mt-2 leading-relaxed">
            Applies to KPIs, charts and analytics tables. Decision-engine windows stay on the managed config.
          </p>
        </div>
      )}
    </div>
  )
}
