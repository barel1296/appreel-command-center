// Tracking Health Center (spec §13, §16): operational status of every data
// source — freshness vs SLA, coverage, match rate, schema drift, failing jobs,
// sync history — with per-source drill-down.
import { clsx } from 'clsx'
import { Database, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Card, EmptyState, Modal, QualityBadge, SectionTitle } from '@/components/ui'
import { gateForConnector } from '@/domain/quality/gate'
import type { ConnectorStatus } from '@/domain/types'
import { fmtAgo, fmtDateTime, fmtPct } from '@/lib/format'
import { useApp } from '@/state/store'
import { useToasts } from '@/state/toasts'

const CATEGORY_LABEL: Record<ConnectorStatus['category'], string> = {
  ad_network: 'Ad Network',
  attribution: 'Attribution / MMP',
  product_events: 'Product Events',
  revenue: 'Revenue',
  store: 'Store / ASO',
  social: 'Social',
}

export function TrackingHealth() {
  const app = useApp()
  const navigate = useNavigate()
  const { sourceId } = useParams()
  const [syncing, setSyncing] = useState<string | null>(null)
  const ds = app.dataset!
  const t = app.config!.thresholds

  const withGates = ds.connectors.map((c) => ({ c, gate: gateForConnector(c, t) }))
  const red = withGates.filter((x) => x.gate.status === 'red').length
  const yellow = withGates.filter((x) => x.gate.status === 'yellow').length

  const selected = withGates.find((x) => x.c.source_id === sourceId) ?? null

  const triggerSync = (c: ConnectorStatus) => {
    if (!app.hasPerm('manage_connectors')) {
      useToasts.getState().push({ kind: 'error', title: 'Not permitted', message: `Your role (${app.currentUser().role}) cannot trigger connector syncs — operator or admin required.` })
      return
    }
    if (syncing) return
    setSyncing(c.source_id)
    app.logAudit('connector.sync', c.name, 'Manual sync triggered')
    setTimeout(() => {
      setSyncing(null)
      useToasts.getState().push({
        kind: 'info',
        title: `${c.name} sync queued`,
        message: 'The connector run was enqueued. Freshness updates when the job lands (simulated source — metrics refresh on reload).',
      })
    }, 1400)
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-4">
        <h1 className="text-xl font-extrabold tracking-tight flex items-center gap-2">
          <Database size={20} className="text-brand-300" /> Tracking Health Center
        </h1>
        <p className="text-[13px] text-ink-mid">
          {red > 0 ? `${red} source${red > 1 ? 's' : ''} RED — business decisions on affected slices are blocked by the quality gate. ` : ''}
          {yellow > 0 ? `${yellow} source${yellow > 1 ? 's' : ''} degraded. ` : ''}
          {red === 0 && yellow === 0 ? 'All sources green. ' : ''}
          Freshness, coverage, match rate, and schema contracts per connector.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {withGates.map(({ c, gate }) => {
          const freshRatio = c.freshness_hours / c.freshness_sla_hours
          // last_sync_ts === 0 means the source was never connected. "20655d ago"
          // is technically the epoch and reads as a bug — say what is true.
          const neverSynced = c.last_sync_ts === 0
          return (
            <Card
              key={c.source_id}
              className={clsx('p-4 card-hover', gate.status === 'red' && 'border-bad-400/40')}
              onClick={() => navigate(`/tracking/${c.source_id}`)}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <div className="font-bold text-[14px] truncate">{c.name}</div>
                  <div className="text-2xs text-ink-low">{CATEGORY_LABEL[c.category]}</div>
                </div>
                <QualityBadge status={gate.status} />
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px] mb-3">
                <HealthRow label="Freshness" value={neverSynced ? 'never synced' : `${c.freshness_hours.toFixed(1)}h / ${c.freshness_sla_hours}h`} bad={freshRatio > 1} warn={freshRatio > 0.8} />
                <HealthRow label="Coverage" value={fmtPct(c.coverage)} bad={c.coverage < t.min_coverage - 0.06} warn={c.coverage < t.min_coverage} />
                <HealthRow label="Match rate" value={fmtPct(c.match_rate)} bad={c.match_rate < t.min_match_rate - 0.12} warn={c.match_rate < t.min_match_rate} />
                <HealthRow label="Undefined" value={fmtPct(c.undefined_share)} bad={c.undefined_share > t.max_undefined_share * 1.6} warn={c.undefined_share > t.max_undefined_share} />
              </div>

              {/* Sync history strip */}
              <div className="flex items-center gap-[3px] mb-2" title="Last 14 sync runs (6h cadence)">
                {c.sync_history.map((h, i) => (
                  <span
                    key={i}
                    className={clsx('h-4 flex-1 rounded-sm', h.ok ? 'bg-ok-400/50' : 'bg-bad-400')}
                    title={`${fmtDateTime(h.ts)} · ${h.ok ? 'OK' : 'FAILED'} · ${h.rows.toLocaleString()} rows in ${h.duration_s}s`}
                  />
                ))}
              </div>
              <div className="flex items-center justify-between text-2xs text-ink-low">
                <span>{neverSynced ? 'Not connected' : `Last sync ${fmtAgo(c.last_sync_ts)}`}</span>
                {c.failing_jobs > 0
                  ? <span className="text-bad-400 font-bold">{c.failing_jobs} failing job{c.failing_jobs > 1 ? 's' : ''}</span>
                  : c.schema_drift
                    ? <span className="text-warn-400 font-bold">schema drift</span>
                    : <span className="text-ok-400">jobs healthy</span>}
              </div>
            </Card>
          )
        })}
      </div>

      {/* Source drill-down */}
      {selected && (
        <Modal open onClose={() => navigate('/tracking')} title={selected.c.name} wide>
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <QualityBadge status={selected.gate.status} />
            <span className="text-2xs text-ink-low">{CATEGORY_LABEL[selected.c.category]} · {selected.c.last_sync_ts === 0 ? 'not connected' : `last sync ${fmtAgo(selected.c.last_sync_ts)}`}</span>
            <div className="ml-auto">
              <Button
                size="sm"
                variant="secondary"
                disabled={syncing === selected.c.source_id}
                onClick={() => triggerSync(selected.c)}
              >
                <RefreshCw size={13} className={syncing === selected.c.source_id ? 'animate-spin' : ''} />
                {syncing === selected.c.source_id ? 'Queuing…' : 'Trigger sync'}
              </Button>
            </div>
          </div>

          {selected.gate.blocked_reason && (
            <div className="bg-bad-dim border border-bad-400/30 rounded-lg px-3 py-2.5 mb-4 text-[13px] text-bad-400 font-semibold">
              {selected.gate.blocked_reason}
            </div>
          )}

          <div className="divide-y divide-line/60 mb-4">
            {selected.gate.checks.map((ch) => (
              <div key={ch.id} className="py-2.5 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', ch.status === 'green' ? 'bg-ok-400' : ch.status === 'yellow' ? 'bg-warn-400' : 'bg-bad-400')} />
                    <span className="text-[13px] font-semibold">{ch.label}</span>
                  </div>
                  <p className="text-2xs text-ink-low leading-relaxed mt-0.5 ml-3.5">{ch.detail}</p>
                </div>
                <div className="text-right shrink-0">
                  <div className={clsx('num font-bold text-[13px]', ch.status === 'green' ? 'text-ok-400' : ch.status === 'yellow' ? 'text-warn-400' : 'text-bad-400')}>{ch.value}</div>
                  <div className="text-2xs text-ink-low num">{ch.threshold}</div>
                </div>
              </div>
            ))}
          </div>

          <SectionTitle title="Sync log" hint="Most recent connector runs — duration, rows landed, and status." />
          <div className="rounded-lg border border-line overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-surface-2 text-left">
                  <th className="label-2xs px-3 py-2">Run</th>
                  <th className="label-2xs px-3 py-2 text-right">Rows</th>
                  <th className="label-2xs px-3 py-2 text-right">Duration</th>
                  <th className="label-2xs px-3 py-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {[...selected.c.sync_history].reverse().slice(0, 8).map((h, i) => (
                  <tr key={i} className="border-t border-line/60">
                    <td className="px-3 py-1.5 text-ink-mid">{fmtDateTime(h.ts)}</td>
                    <td className="px-3 py-1.5 text-right num">{h.rows.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right num">{h.duration_s}s</td>
                    <td className={clsx('px-3 py-1.5 text-right font-bold', h.ok ? 'text-ok-400' : 'text-bad-400')}>{h.ok ? 'OK' : 'FAILED'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {sourceId && !selected && (
        <Card className="mt-4">
          <EmptyState
            title="Source not found"
            message={`No connector with id "${sourceId}" exists.`}
            action={<Button variant="secondary" onClick={() => navigate('/tracking')}>Back to Tracking Health</Button>}
          />
        </Card>
      )}
    </div>
  )
}

function HealthRow({ label, value, bad, warn }: { label: string; value: string; bad?: boolean; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-2xs text-ink-low">{label}</span>
      <span className={clsx('num font-semibold text-xs', bad ? 'text-bad-400' : warn ? 'text-warn-400' : 'text-ink-hi')}>{value}</span>
    </div>
  )
}
