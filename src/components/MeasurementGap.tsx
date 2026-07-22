// Honest empty states for metrics this workspace cannot measure yet.
// A missing source must never render as a zero — these two components make the
// gap legible and actionable instead: what is missing, what it unlocks, and the
// exact next step to close it.
import { PlugZap, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Measurement } from '@/domain/measurement'
import { missingSources } from '@/domain/measurement'
import { Card } from './ui'

/** Page-level strip listing every unconnected source. */
export function MeasurementBanner({ m }: { m: Measurement }) {
  const gaps = missingSources(m)
  if (gaps.length === 0) return null
  return (
    <div className="card border-warn-400/30 p-4 mt-4">
      <div className="flex items-start gap-3">
        <span className="w-8 h-8 rounded-lg bg-warn-dim flex items-center justify-center shrink-0">
          <PlugZap size={16} className="text-warn-400" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-bold text-[13px] mb-0.5">
            {gaps.length} source{gaps.length > 1 ? 's' : ''} not connected — those metrics are blank, not zero
          </div>
          <p className="text-2xs text-ink-mid leading-relaxed mb-2.5">
            Metrics that need a missing source are hidden rather than shown as $0, so nothing here can be mistaken for
            weak performance. Everything else on this page is certified.
          </p>
          <ul className="space-y-1.5">
            {gaps.map((g) => (
              <li key={g.name} className="text-2xs leading-relaxed">
                <span className="font-bold text-ink-hi">{g.name}</span>
                <span className="text-ink-low"> → unlocks {g.unlocks}</span>
              </li>
            ))}
          </ul>
        </div>
        <Link
          to="/tracking"
          className="text-2xs font-bold text-brand-300 hover:text-brand-400 whitespace-nowrap inline-flex items-center gap-1 shrink-0"
        >
          Fix tracking <ArrowRight size={12} />
        </Link>
      </div>
    </div>
  )
}

/** Drop-in replacement for a chart/table that has no source behind it. */
export function MeasurementGapCard({ title, needs, unlocks, how, className }: {
  title: string
  needs: string
  unlocks: string
  how: string
  className?: string
}) {
  return (
    <Card className={`p-4 ${className ?? ''}`}>
      <div className="flex items-center gap-1.5 mb-3">
        <h3 className="text-[13px] font-bold text-ink-mid">{title}</h3>
        <span className="text-2xs font-bold text-warn-400 bg-warn-dim rounded px-1.5 py-0.5">not measured</span>
      </div>
      <div className="border border-dashed border-line-strong rounded-xl p-5 text-center">
        <PlugZap size={20} className="mx-auto mb-2 text-ink-low" />
        <div className="text-[13px] font-semibold text-ink-hi mb-1">Needs {needs}</div>
        <p className="text-2xs text-ink-mid leading-relaxed max-w-md mx-auto mb-2">{unlocks}</p>
        <p className="text-2xs text-ink-low leading-relaxed max-w-md mx-auto">{how}</p>
      </div>
    </Card>
  )
}
