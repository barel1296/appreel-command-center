// War Room (spec §16, §18): urgent issue management with severity, owner,
// SLA countdown, dedupe count, lifecycle transitions, and linked evidence.
import { clsx } from 'clsx'
import { CheckCircle2, ChevronRight, Clock, Flame, Link2, UserPlus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { EvidenceTable, RecommendationModal } from '@/components/RecommendationCard'
import {
  Button, Card, EmptyState, Modal, SectionTitle, Select,
} from '@/components/ui'
import type { Alert, AlertSeverity, AlertState } from '@/domain/types'
import { fmtAgo, fmtDateTime } from '@/lib/format'
import { useApp } from '@/state/store'

const SEV_STYLE: Record<AlertSeverity, { cls: string; label: string }> = {
  critical: { cls: 'bg-bad-500 text-white', label: 'Critical' },
  high: { cls: 'bg-bad-dim text-bad-400', label: 'High' },
  medium: { cls: 'bg-warn-dim text-warn-400', label: 'Medium' },
  low: { cls: 'bg-surface-3 text-ink-mid', label: 'Low' },
}

const STATE_LABEL: Record<AlertState, string> = {
  created: 'New',
  assigned: 'Assigned',
  acknowledged: 'Acknowledged',
  investigating: 'Investigating',
  action_proposed: 'Action proposed',
  resolved: 'Resolved',
}

const NEXT_STATE: Partial<Record<AlertState, { to: AlertState; label: string }>> = {
  created: { to: 'acknowledged', label: 'Acknowledge' },
  assigned: { to: 'acknowledged', label: 'Acknowledge' },
  acknowledged: { to: 'investigating', label: 'Start investigation' },
  investigating: { to: 'action_proposed', label: 'Propose action' },
}

function slaInfo(a: Alert): { text: string; overdue: boolean } {
  if (a.state === 'resolved') return { text: 'closed', overdue: false }
  const deadline = a.created_at + a.sla_hours * 3600_000
  const remaining = deadline - Date.now()
  if (remaining < 0) return { text: `SLA breached ${fmtAgo(deadline)}`, overdue: true }
  const h = Math.floor(remaining / 3600_000)
  return { text: h >= 1 ? `${h}h left in SLA` : `${Math.max(1, Math.round(remaining / 60000))}m left in SLA`, overdue: false }
}

export function WarRoom() {
  const app = useApp()
  const navigate = useNavigate()
  const { alertId } = useParams()
  const [sevFilter, setSevFilter] = useState<'all' | AlertSeverity>('all')
  const [showResolved, setShowResolved] = useState<'open' | 'all'>('open')
  const [resolveFor, setResolveFor] = useState<Alert | null>(null)
  const [resolveNote, setResolveNote] = useState('')
  const [resolveError, setResolveError] = useState(false)
  const [linkedRecId, setLinkedRecId] = useState<string | null>(null)

  const selected = app.alerts.find((a) => a.alert_id === alertId) ?? null

  const filtered = useMemo(() =>
    app.alerts.filter((a) =>
      (sevFilter === 'all' || a.severity === sevFilter) &&
      (showResolved === 'all' || a.state !== 'resolved'),
    ), [app.alerts, sevFilter, showResolved])

  const openCount = app.alerts.filter((a) => a.state !== 'resolved').length
  const linkedRec = linkedRecId ? app.recommendations.find((r) => r.recommendation_id === linkedRecId) : null

  const doResolve = () => {
    if (resolveNote.trim().length < 5) {
      setResolveError(true)
      return
    }
    if (resolveFor) app.setAlertState(resolveFor.alert_id, 'resolved', resolveNote.trim())
    setResolveFor(null)
    setResolveNote('')
  }

  return (
    <div className="animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight flex items-center gap-2">
            <Flame size={20} className="text-warn-400" /> War Room
          </h1>
          <p className="text-[13px] text-ink-mid">{openCount} open issue{openCount === 1 ? '' : 's'} · alerts are deduped by root cause, owned, and tracked against SLA.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={sevFilter}
            onChange={setSevFilter}
            options={[
              { value: 'all', label: 'All severities' },
              { value: 'critical', label: 'Critical' },
              { value: 'high', label: 'High' },
              { value: 'medium', label: 'Medium' },
              { value: 'low', label: 'Low' },
            ]}
          />
          <Select
            value={showResolved}
            onChange={setShowResolved}
            options={[{ value: 'open', label: 'Open only' }, { value: 'all', label: 'Include resolved' }]}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CheckCircle2 size={22} />}
            title="War room is quiet"
            message={showResolved === 'open' ? 'No open issues match the current filters. Resolved issues are hidden — switch the filter to see history.' : 'No alerts match the current filters.'}
          />
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map((a) => {
            const sla = slaInfo(a)
            return (
              <Card
                key={a.alert_id}
                className={clsx('p-4 card-hover', a.severity === 'critical' && a.state !== 'resolved' && 'border-bad-400/40')}
                onClick={() => navigate(`/war-room/${a.alert_id}`)}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span className={clsx('text-2xs font-bold uppercase tracking-wide px-2 py-0.5 rounded-md', SEV_STYLE[a.severity].cls)}>{SEV_STYLE[a.severity].label}</span>
                      <span className="text-2xs font-semibold text-ink-mid bg-surface-3 px-2 py-0.5 rounded-md">{STATE_LABEL[a.state]}</span>
                      <span className="text-2xs text-ink-low">{a.category}</span>
                      {a.dedupe_count > 1 && (
                        <span className="text-2xs text-ink-low" title="Signals merged into this alert (same root cause)">×{a.dedupe_count} deduped</span>
                      )}
                    </div>
                    <div className="font-bold text-[14px] leading-snug">{a.title}</div>
                    <div className="text-[13px] text-ink-mid leading-relaxed line-clamp-2 mt-1">{a.summary}</div>
                    <div className="flex items-center gap-3 mt-2 text-2xs text-ink-low flex-wrap">
                      <span>{a.scope_label}</span>
                      <span>·</span>
                      <span>{a.owner ? `Owner: ${a.owner}` : 'Unassigned'}</span>
                      <span>·</span>
                      <span className={clsx('inline-flex items-center gap-1', sla.overdue && 'text-bad-400 font-bold')}>
                        <Clock size={11} /> {sla.text}
                      </span>
                      <span>·</span>
                      <span>{fmtAgo(a.created_at)}</span>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-ink-low shrink-0 mt-1" />
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Detail modal (deep-linkable) */}
      {selected && (
        <Modal open onClose={() => navigate('/war-room')} title={selected.title} wide>
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <span className={clsx('text-2xs font-bold uppercase px-2 py-0.5 rounded-md', SEV_STYLE[selected.severity].cls)}>{SEV_STYLE[selected.severity].label}</span>
            <span className="text-2xs font-semibold text-ink-mid bg-surface-3 px-2 py-0.5 rounded-md">{STATE_LABEL[selected.state]}</span>
            <span className="text-2xs text-ink-low">{selected.scope_label}</span>
            <span className={clsx('text-2xs ml-auto inline-flex items-center gap-1', slaInfo(selected).overdue ? 'text-bad-400 font-bold' : 'text-ink-low')}>
              <Clock size={11} /> {slaInfo(selected).text}
            </span>
          </div>
          <p className="text-[13px] text-ink-mid leading-relaxed mb-4">{selected.summary}</p>

          {selected.evidence.length > 0 && (
            <div className="mb-4">
              <div className="label-2xs mb-1.5">Evidence</div>
              <EvidenceTable evidence={selected.evidence} />
            </div>
          )}

          {selected.affected.length > 0 && (
            <div className="mb-4">
              <div className="label-2xs mb-1.5">Affected slices</div>
              <div className="flex flex-wrap gap-1.5">
                {selected.affected.map((s) => (
                  <span key={s} className="text-2xs font-medium bg-surface-3 text-ink-mid px-2 py-1 rounded-md">{s}</span>
                ))}
              </div>
            </div>
          )}

          {selected.linked_recommendation_id && (
            <button
              onClick={() => setLinkedRecId(selected.linked_recommendation_id)}
              className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-300 hover:text-brand-400 mb-4"
            >
              <Link2 size={14} /> View linked recommendation
            </button>
          )}

          <div className="mb-4">
            <div className="label-2xs mb-2">Timeline</div>
            <div className="space-y-0 relative">
              {selected.timeline.map((tl, i) => (
                <div key={i} className="flex gap-3 pb-3 relative">
                  {i < selected.timeline.length - 1 && <span className="absolute left-[5px] top-3.5 bottom-0 w-px bg-line" />}
                  <span className="w-[11px] h-[11px] rounded-full bg-surface-4 border-2 border-brand-400 mt-1 shrink-0 relative z-10" />
                  <div className="min-w-0">
                    <div className="text-[13px] text-ink-hi leading-snug">{tl.event}</div>
                    <div className="text-2xs text-ink-low">{tl.actor} · {fmtDateTime(tl.ts)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {selected.resolution_note && (
            <div className="bg-ok-dim border border-ok-400/25 rounded-lg px-3 py-2.5 mb-4">
              <div className="label-2xs text-ok-400 mb-1">Resolution</div>
              <p className="text-[13px] text-ink-hi leading-relaxed">{selected.resolution_note}</p>
            </div>
          )}

          {selected.state !== 'resolved' && (
            <div className="border-t border-line pt-4 flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2 mr-auto">
                <UserPlus size={14} className="text-ink-low" />
                <Select
                  value={selected.owner ?? ''}
                  onChange={(v) => app.assignAlert(selected.alert_id, v)}
                  options={[
                    ...(selected.owner ? [] : [{ value: '', label: 'Assign owner…' }]),
                    ...(app.dataset?.users.map((u) => ({ value: u.name, label: u.name })) ?? []),
                  ]}
                />
              </div>
              {NEXT_STATE[selected.state] && (
                <Button variant="secondary" onClick={() => app.setAlertState(selected.alert_id, NEXT_STATE[selected.state]!.to)}>
                  {NEXT_STATE[selected.state]!.label}
                </Button>
              )}
              <Button variant="success" onClick={() => { setResolveFor(selected); setResolveNote(''); setResolveError(false) }}>
                <CheckCircle2 size={14} /> Resolve
              </Button>
            </div>
          )}
        </Modal>
      )}

      {/* Resolve dialog (reason required) */}
      <Modal open={resolveFor !== null} onClose={() => setResolveFor(null)} title="Resolve alert">
        <p className="text-[13px] text-ink-mid leading-relaxed mb-3">
          Alerts close with a reason so the resolution is auditable and the detector can be tuned.
        </p>
        <textarea
          value={resolveNote}
          onChange={(e) => { setResolveNote(e.target.value); setResolveError(false) }}
          rows={3}
          autoFocus
          placeholder="What was the root cause and what fixed it?"
          className={clsx(
            'w-full bg-surface-2 border rounded-lg px-3 py-2 text-[13px] text-ink-hi placeholder:text-ink-low outline-none resize-none transition-colors',
            resolveError ? 'border-bad-400' : 'border-line focus:border-brand-400',
          )}
        />
        {resolveError && <p className="text-2xs text-bad-400 mt-1">A resolution reason (5+ characters) is required.</p>}
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={() => setResolveFor(null)}>Cancel</Button>
          <Button variant="success" onClick={doResolve}>Resolve with reason</Button>
        </div>
      </Modal>

      {linkedRec && (
        <RecommendationModal rec={linkedRec} open onClose={() => setLinkedRecId(null)} />
      )}

      {alertId && !selected && (
        <Card className="mt-4">
          <EmptyState
            title="Alert not found"
            message={`No alert with id "${alertId}" exists in this workspace.`}
            action={<Link to="/war-room" className="text-brand-300 font-semibold text-[13px]">Back to War Room</Link>}
          />
        </Card>
      )}
    </div>
  )
}
