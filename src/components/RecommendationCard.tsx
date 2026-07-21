// Recommendation card + detail modal with the full approval workflow.
// Used by the Decision Queue, Command Center, and War Room.
import { clsx } from 'clsx'
import { ArrowRight, Check, ShieldAlert, Stethoscope, ThumbsDown, Timer, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { EvidenceItem, Recommendation } from '@/domain/types'
import { useApp } from '@/state/store'
import { fmtAgo, fmtDateTime } from '@/lib/format'
import {
  Button, Card, ConfidencePill, Modal, QualityBadge, RecTypePill, RiskPill, StageLightsRow,
} from './ui'

export function EvidenceTable({ evidence }: { evidence: EvidenceItem[] }) {
  return (
    <div className="rounded-lg border border-line overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-surface-2 text-left">
            <th className="label-2xs px-3 py-2">Metric</th>
            <th className="label-2xs px-3 py-2 text-right">Value</th>
            <th className="label-2xs px-3 py-2 text-right hidden sm:table-cell">Benchmark</th>
          </tr>
        </thead>
        <tbody>
          {evidence.map((e, i) => (
            <tr key={i} className="border-t border-line/60">
              <td className="px-3 py-1.5 text-ink-mid">{e.metric}</td>
              <td
                className={clsx(
                  'px-3 py-1.5 text-right num font-semibold',
                  e.verdict === 'good' && 'text-ok-400',
                  e.verdict === 'bad' && 'text-bad-400',
                  e.verdict === 'warn' && 'text-warn-400',
                  e.verdict === 'neutral' && 'text-ink-hi',
                )}
              >
                {e.value}
              </td>
              <td className="px-3 py-1.5 text-right text-ink-low num hidden sm:table-cell">{e.benchmark}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const STATUS_LABEL: Record<Recommendation['approval_status'], { label: string; cls: string }> = {
  proposed: { label: 'Awaiting decision', cls: 'text-brand-300 bg-brand-500/12' },
  approved: { label: 'Approved — ready to execute', cls: 'text-ok-400 bg-ok-dim' },
  rejected: { label: 'Rejected', cls: 'text-ink-low bg-surface-3' },
  executed: { label: 'Executed', cls: 'text-ok-400 bg-ok-dim' },
  monitored: { label: 'In monitoring window', cls: 'text-info-400 bg-info-dim' },
  closed: { label: 'Closed', cls: 'text-ink-low bg-surface-3' },
}

export function RecommendationCard({ rec, compact }: { rec: Recommendation; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Card className="p-4 card-hover" onClick={() => setOpen(true)}>
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <RecTypePill type={rec.recommendation_type} />
            <RiskPill risk={rec.risk_level} />
            <QualityBadge status={rec.data_quality} />
          </div>
          <span className="text-2xs text-ink-low whitespace-nowrap num" title={fmtDateTime(rec.created_at)}>{fmtAgo(rec.created_at)}</span>
        </div>
        <div className="font-bold text-[14px] leading-snug mb-1">{rec.title}</div>
        <div className="text-2xs text-ink-low mb-2">{rec.scope.label}</div>
        {!compact && <p className="text-[13px] text-ink-mid leading-relaxed line-clamp-2 mb-3">{rec.reason}</p>}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <StageLightsRow lights={rec.stage_lights} compact />
          <span className={clsx('text-2xs font-bold px-2 py-0.5 rounded-md', STATUS_LABEL[rec.approval_status].cls)}>
            {STATUS_LABEL[rec.approval_status].label}
          </span>
        </div>
      </Card>
      <RecommendationModal rec={rec} open={open} onClose={() => setOpen(false)} />
    </>
  )
}

export function RecommendationModal({ rec, open, onClose }: { rec: Recommendation; open: boolean; onClose: () => void }) {
  const app = useApp()
  const [note, setNote] = useState('')
  const [confirming, setConfirming] = useState<'approved' | 'rejected' | null>(null)
  const [noteError, setNoteError] = useState(false)

  const canApprove = app.hasPerm('approve_recommendation')
  const canReject = app.hasPerm('reject_recommendation')
  const canExecute = app.hasPerm('execute_action')
  const risky = rec.risk_level === 'high' || rec.risk_level === 'critical'

  const decide = (decision: 'approved' | 'rejected') => {
    // Risky approvals require a written note (governance guard, spec §14)
    if (decision === 'approved' && risky && note.trim().length < 5) {
      setNoteError(true)
      return
    }
    if (risky && confirming !== decision) {
      setConfirming(decision)
      return
    }
    app.decideRecommendation(rec.recommendation_id, decision, note.trim())
    setConfirming(null)
    setNote('')
    onClose()
  }

  return (
    <Modal open={open} onClose={() => { setConfirming(null); onClose() }} title={rec.title} wide>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <RecTypePill type={rec.recommendation_type} />
        <RiskPill risk={rec.risk_level} />
        <QualityBadge status={rec.data_quality} />
        <ConfidencePill level={rec.confidence} note={rec.confidence_note} />
        <span className={clsx('text-2xs font-bold px-2 py-0.5 rounded-md ml-auto', STATUS_LABEL[rec.approval_status].cls)}>
          {STATUS_LABEL[rec.approval_status].label}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div className="sm:col-span-2">
          <div className="label-2xs mb-1.5">Why</div>
          <p className="text-[13px] text-ink-mid leading-relaxed">{rec.reason}</p>
        </div>
        <div className="sm:col-span-2">
          <div className="label-2xs mb-1.5">Evidence</div>
          <EvidenceTable evidence={rec.evidence} />
        </div>
        <div>
          <div className="label-2xs mb-1.5">Suggested action</div>
          <p className="text-[13px] text-ink-hi leading-relaxed">{rec.suggested_action}</p>
        </div>
        <div>
          <div className="label-2xs mb-1.5">Expected impact</div>
          <p className="text-[13px] text-ink-mid leading-relaxed">{rec.expected_impact}</p>
        </div>
        <div>
          <div className="label-2xs mb-1.5">Stop / rollback condition</div>
          <p className="text-[13px] text-ink-mid leading-relaxed flex items-start gap-1.5">
            <ShieldAlert size={14} className="text-warn-400 mt-0.5 shrink-0" />
            {rec.stop_condition}
          </p>
        </div>
        <div>
          <div className="label-2xs mb-1.5">Monitoring</div>
          <p className="text-[13px] text-ink-mid leading-relaxed flex items-start gap-1.5">
            <Timer size={14} className="text-info-400 mt-0.5 shrink-0" />
            {rec.monitoring_window_days}-day window · next review {fmtDateTime(rec.next_review_at)}
            {rec.owner && <> · owner {rec.owner}</>}
          </p>
        </div>
        <div className="sm:col-span-2">
          <div className="label-2xs mb-1.5">Confidence factors</div>
          <p className="text-xs text-ink-low leading-relaxed">{rec.confidence_note}</p>
        </div>
      </div>

      {rec.scope.campaign_id && (
        <Link
          to={`/doctor/${rec.scope.campaign_id}`}
          onClick={onClose}
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-300 hover:text-brand-400 mb-4"
        >
          <Stethoscope size={14} /> Open in Campaign Doctor <ArrowRight size={13} />
        </Link>
      )}

      {rec.approval_status === 'proposed' && (
        <div className="border-t border-line pt-4">
          <label className="label-2xs block mb-1.5" htmlFor="decision-note">
            Decision note {risky && <span className="text-warn-400">(required for high-risk actions)</span>}
          </label>
          <textarea
            id="decision-note"
            value={note}
            onChange={(e) => { setNote(e.target.value); setNoteError(false) }}
            rows={2}
            placeholder="Rationale, conditions, or context for the ledger…"
            className={clsx(
              'w-full bg-surface-2 border rounded-lg px-3 py-2 text-[13px] text-ink-hi placeholder:text-ink-low outline-none transition-colors resize-none',
              noteError ? 'border-bad-400' : 'border-line focus:border-brand-400',
            )}
          />
          {noteError && <p className="text-2xs text-bad-400 mt-1">A written rationale (5+ characters) is required before approving a {rec.risk_level}-risk action.</p>}
          {confirming && (
            <div className="mt-2 bg-warn-dim border border-warn-400/30 rounded-lg px-3 py-2 text-xs text-warn-400 font-semibold animate-fade-in">
              This is a {rec.risk_level}-risk {confirming === 'approved' ? 'approval' : 'rejection'}. Click again to confirm — it will be recorded in the Decision Ledger.
            </div>
          )}
          <div className="flex items-center justify-end gap-2 mt-3">
            {!canApprove && !canReject && (
              <span className="text-2xs text-ink-low mr-auto">Your role ({app.currentUser().role}) can view but not decide.</span>
            )}
            {canReject && (
              <Button variant="ghost" onClick={() => decide('rejected')}>
                <ThumbsDown size={14} /> Reject
              </Button>
            )}
            {canApprove && (
              <Button variant={confirming === 'approved' ? 'danger' : 'primary'} onClick={() => decide('approved')}>
                <Check size={14} /> {confirming === 'approved' ? 'Confirm approval' : 'Approve'}
              </Button>
            )}
          </div>
        </div>
      )}

      {rec.approval_status === 'approved' && (
        <div className="border-t border-line pt-4 flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[13px] text-ink-mid">Approved by {rec.owner}. Execute applies the action and starts the monitoring window.</span>
          {canExecute ? (
            <Button variant="success" onClick={() => { app.executeRecommendation(rec.recommendation_id); onClose() }}>
              <Check size={14} /> Mark executed
            </Button>
          ) : (
            <span className="text-2xs text-ink-low">Execution requires an operator/lead role.</span>
          )}
        </div>
      )}

      {(rec.approval_status === 'rejected' || rec.approval_status === 'monitored' || rec.approval_status === 'closed' || rec.approval_status === 'executed') && (
        <div className="border-t border-line pt-4 flex items-center gap-2 text-[13px] text-ink-mid">
          <X size={0} className="hidden" />
          This recommendation is {STATUS_LABEL[rec.approval_status].label.toLowerCase()} — full history lives in the <Link to="/ledger" onClick={onClose} className="text-brand-300 font-semibold hover:text-brand-400">Decision Ledger</Link>.
        </div>
      )}
    </Modal>
  )
}
