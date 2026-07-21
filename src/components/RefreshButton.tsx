// Topbar refresh: re-reads the canonical facts from the live source and
// re-runs the decision engine. Workspace state (decisions, ledger, alerts,
// config, audit) is preserved. The popover shows when each upstream source
// last landed rows, so "fresh page" is never confused with "fresh data".
import { clsx } from 'clsx'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { fmtAgo, fmtDateTime } from '@/lib/format'
import { useApp } from '@/state/store'

const SOURCE_LABELS: Record<string, string> = {
  meta_ads: 'Meta Ads — spend',
  meta_ads_creative: 'Meta Ads — creatives',
  appsflyer: 'MMP / AppsFlyer — attribution',
  product_analytics: 'Product event stream',
  revenue_value: 'Purchase revenue value',
}

const STALE_HOURS = 26

export function RefreshButton() {
  const { refreshData, refreshing, dataset, realConnected, lastRefreshedAt } = useApp()
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

  // Newest landing per source (the log keeps one row per sync run)
  const syncs = dataset?.sync_log ?? []
  const bySource = new Map<string, number>()
  for (const s of syncs) {
    const ts = new Date(s.synced_at).getTime()
    if (!bySource.has(s.source) || ts > bySource.get(s.source)!) bySource.set(s.source, ts)
  }
  const rows = [...bySource.entries()].sort((a, b) => b[1] - a[1])
  const newest = rows.length > 0 ? rows[0][1] : null
  const stale = newest !== null && Date.now() - newest > STALE_HOURS * 3600_000

  return (
    <div className="relative" ref={ref}>
      <div className="flex items-center">
        <button
          onClick={() => void refreshData()}
          disabled={refreshing}
          className="flex items-center gap-2 bg-surface-2 border border-line rounded-l-lg px-3 py-1.5 hover:bg-surface-3 transition-colors disabled:opacity-60"
          title="Re-read data and re-evaluate recommendations"
          aria-label="Refresh data"
        >
          <RefreshCw size={14} className={clsx('shrink-0 text-brand-300', refreshing && 'animate-spin')} />
          <span className="text-[13px] font-semibold hidden md:inline">
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </span>
        </button>
        <button
          onClick={() => setOpen((v) => !v)}
          className="bg-surface-2 border border-l-0 border-line rounded-r-lg px-1.5 py-[7px] hover:bg-surface-3 transition-colors"
          aria-label="Data freshness details"
          aria-expanded={open}
        >
          <span className={clsx('block w-2 h-2 rounded-full', stale ? 'bg-warn-400 animate-pulse2' : realConnected ? 'bg-ok-400' : 'bg-ink-low')} />
        </button>
      </div>

      {open && (
        <div
          role="dialog"
          aria-label="Data freshness"
          className="absolute right-0 top-full mt-1.5 w-80 bg-surface-2 border border-line-strong rounded-xl shadow-pop p-3 animate-fade-in z-50"
        >
          <div className="label-2xs mb-2">Upstream sources — last landed rows</div>
          {rows.length === 0 ? (
            <p className="text-xs text-ink-low leading-relaxed">
              No ingestion log available. In simulation mode facts are generated locally on every refresh.
            </p>
          ) : (
            <div className="space-y-1 mb-3">
              {rows.map(([source, ts]) => (
                <div key={source} className="flex items-center justify-between gap-3 bg-surface-1 rounded-lg px-2.5 py-1.5">
                  <span className="text-xs text-ink-mid truncate">{SOURCE_LABELS[source] ?? source}</span>
                  <span
                    className={clsx('text-xs num font-semibold shrink-0', Date.now() - ts > STALE_HOURS * 3600_000 ? 'text-warn-400' : 'text-ink-hi')}
                    title={fmtDateTime(ts)}
                  >
                    {fmtAgo(ts)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {stale && (
            <div className="flex items-start gap-2 bg-warn-dim border border-warn-400/25 rounded-lg px-2.5 py-2 mb-3">
              <AlertTriangle size={13} className="text-warn-400 mt-0.5 shrink-0" />
              <p className="text-2xs text-warn-400 leading-relaxed">
                Upstream data is over {STALE_HOURS}h old. Refresh re-reads the warehouse but cannot pull new rows from
                the ad network or MMP — that requires a scheduled sync.
              </p>
            </div>
          )}

          <p className="text-2xs text-ink-low leading-relaxed">
            Refresh re-reads the canonical tables and re-runs the decision engine against the current thresholds.
            Your decisions, ledger, alert progress and config are preserved.
            {lastRefreshedAt && <> Last refreshed {fmtAgo(lastRefreshedAt)}.</>}
          </p>
        </div>
      )}
    </div>
  )
}
