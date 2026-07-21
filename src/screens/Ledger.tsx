// Decision Ledger (spec §16, §17): history of decisions with owner, outcome,
// post-review, and learnings. Outcomes can be recorded here, closing the loop.
import { clsx } from 'clsx'
import { BookOpenCheck, ChevronRight, History } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { EvidenceTable } from '@/components/RecommendationCard'
import {
  Button, Card, EmptyState, Modal, QualityBadge, RecTypePill, RiskPill, SearchInput,
  SectionTitle, Select,
} from '@/components/ui'
import type { LedgerEntry } from '@/domain/types'
import { fmtDateTime } from '@/lib/format'
import { useApp } from '@/state/store'

const OUTCOME_STYLE: Record<LedgerEntry['outcome']['status'], { label: string; cls: string }> = {
  pending: { label: 'Pending execution', cls: 'bg-surface-3 text-ink-mid' },
  monitoring: { label: 'Monitoring', cls: 'bg-info-dim text-info-400' },
  positive: { label: 'Positive outcome', cls: 'bg-ok-dim text-ok-400' },
  negative: { label: 'Negative outcome', cls: 'bg-bad-dim text-bad-400' },
  neutral: { label: 'Neutral / no action', cls: 'bg-surface-3 text-ink-mid' },
}

export function Ledger() {
  const app = useApp()
  const navigate = useNavigate()
  const { decisionId } = useParams()
  const [search, setSearch] = useState('')
  const [outcomeFilter, setOutcomeFilter] = useState<'all' | LedgerEntry['outcome']['status']>('all')
  const [outcomeForm, setOutcomeForm] = useState<{ id: string; status: 'positive' | 'negative' | 'neutral'; summary: string } | null>(null)
  const [formError, setFormError] = useState(false)

  const selected = app.ledger.find((l) => l.decision_id === decisionId) ?? null

  const rows = useMemo(() =>
    app.ledger.filter((l) =>
      (outcomeFilter === 'all' || l.outcome.status === outcomeFilter) &&
      (search === '' ||
        l.recommendation.title.toLowerCase().includes(search.toLowerCase()) ||
        l.decided_by.toLowerCase().includes(search.toLowerCase()) ||
        l.decision_id.toLowerCase().includes(search.toLowerCase())),
    ), [app.ledger, search, outcomeFilter])

  const closeOutcomeForm = () => { setOutcomeForm(null); setFormError(false) }
  const submitOutcome = () => {
    if (!outcomeForm) return
    if (outcomeForm.summary.trim().length < 10) {
      setFormError(true)
      return
    }
    app.markOutcome(outcomeForm.id, outcomeForm.status, outcomeForm.summary.trim())
    closeOutcomeForm()
    navigate('/ledger')
  }

  return (
    <div className="animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight flex items-center gap-2">
            <BookOpenCheck size={20} className="text-brand-300" /> Decision Ledger
          </h1>
          <p className="text-[13px] text-ink-mid">
            Every meaningful decision with its evidence, owner, and measured outcome. This is where the team's learning compounds.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Search decisions…" className="w-full sm:w-56" />
          <Select
            value={outcomeFilter}
            onChange={setOutcomeFilter}
            options={[
              { value: 'all', label: 'All outcomes' },
              { value: 'pending', label: 'Pending' },
              { value: 'monitoring', label: 'Monitoring' },
              { value: 'positive', label: 'Positive' },
              { value: 'negative', label: 'Negative' },
              { value: 'neutral', label: 'Neutral' },
            ]}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<History size={22} />}
            title={app.ledger.length === 0 ? 'No decisions yet' : 'Nothing matches'}
            message={
              app.ledger.length === 0
                ? 'Approve or reject a recommendation in the Decision Queue and it will be recorded here with full evidence and outcome tracking.'
                : 'No ledger entries match the current filters.'
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3">
          {rows.map((l) => (
            <Card key={l.decision_id} className="p-4 card-hover" onClick={() => navigate(`/ledger/${l.decision_id}`)}>
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <span className="text-2xs font-bold text-ink-low num">{l.decision_id}</span>
                    <RecTypePill type={l.recommendation.recommendation_type} />
                    <RiskPill risk={l.recommendation.risk_level} />
                    <span className={clsx('text-2xs font-bold px-2 py-0.5 rounded-md', OUTCOME_STYLE[l.outcome.status].cls)}>
                      {OUTCOME_STYLE[l.outcome.status].label}
                    </span>
                  </div>
                  <div className="font-bold text-[14px] leading-snug">{l.recommendation.title}</div>
                  <div className="text-2xs text-ink-low mt-1">
                    {l.action} by {l.decided_by} · {fmtDateTime(l.decided_at)} · {l.recommendation.scope.label}
                  </div>
                  {l.outcome.summary && (
                    <p className="text-[13px] text-ink-mid leading-relaxed mt-1.5 line-clamp-2">{l.outcome.summary}</p>
                  )}
                </div>
                <ChevronRight size={16} className="text-ink-low shrink-0 mt-1" />
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <Modal open onClose={() => navigate('/ledger')} title={selected.recommendation.title} wide>
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <span className="text-2xs font-bold text-ink-low num">{selected.decision_id}</span>
            <RecTypePill type={selected.recommendation.recommendation_type} />
            <RiskPill risk={selected.recommendation.risk_level} />
            <QualityBadge status={selected.recommendation.data_quality} />
            <span className={clsx('text-2xs font-bold px-2 py-0.5 rounded-md ml-auto', OUTCOME_STYLE[selected.outcome.status].cls)}>
              {OUTCOME_STYLE[selected.outcome.status].label}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <div className="label-2xs mb-1">Decision</div>
              <p className="text-[13px] text-ink-hi">{selected.action} by <strong>{selected.decided_by}</strong></p>
              <p className="text-2xs text-ink-low">{fmtDateTime(selected.decided_at)}</p>
              {selected.note && <p className="text-[13px] text-ink-mid leading-relaxed mt-1.5 italic">"{selected.note}"</p>}
            </div>
            <div>
              <div className="label-2xs mb-1">Outcome</div>
              <p className="text-[13px] text-ink-mid leading-relaxed">{selected.outcome.summary}</p>
              {selected.outcome.reviewed_at && <p className="text-2xs text-ink-low mt-1">Reviewed {fmtDateTime(selected.outcome.reviewed_at)}</p>}
            </div>
          </div>

          <div className="mb-4">
            <div className="label-2xs mb-1.5">Original reasoning</div>
            <p className="text-[13px] text-ink-mid leading-relaxed">{selected.recommendation.reason}</p>
          </div>

          <div className="mb-4">
            <div className="label-2xs mb-1.5">Evidence at decision time</div>
            <EvidenceTable evidence={selected.recommendation.evidence} />
          </div>

          <div className="mb-4">
            <SectionTitle title="History" />
            <div className="relative">
              {selected.history.map((h, i) => (
                <div key={i} className="flex gap-3 pb-3 relative">
                  {i < selected.history.length - 1 && <span className="absolute left-[5px] top-3.5 bottom-0 w-px bg-line" />}
                  <span className="w-[11px] h-[11px] rounded-full bg-surface-4 border-2 border-brand-400 mt-1 shrink-0 relative z-10" />
                  <div>
                    <div className="text-[13px] text-ink-hi leading-snug">{h.event}</div>
                    <div className="text-2xs text-ink-low">{h.actor} · {fmtDateTime(h.ts)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {(selected.outcome.status === 'monitoring' || selected.outcome.status === 'pending') && app.hasPerm('approve_recommendation') && (
            <div className="border-t border-line pt-4 flex items-center justify-between gap-3 flex-wrap">
              <span className="text-[13px] text-ink-mid">Close the loop: record what actually happened after this decision.</span>
              <Button variant="primary" onClick={() => setOutcomeForm({ id: selected.decision_id, status: 'positive', summary: '' })}>
                Record outcome
              </Button>
            </div>
          )}
        </Modal>
      )}

      {decisionId && !selected && (
        <Card className="mt-4">
          <EmptyState
            title="Decision not found"
            message={`No ledger entry with id "${decisionId}" exists.`}
            action={<Button variant="secondary" onClick={() => navigate('/ledger')}>Back to Ledger</Button>}
          />
        </Card>
      )}

      {/* Outcome form */}
      <Modal open={outcomeForm !== null} onClose={closeOutcomeForm} title="Record decision outcome">
        {outcomeForm && (
          <>
            <div className="label-2xs mb-1.5">Outcome</div>
            <div className="flex gap-2 mb-3">
              {(['positive', 'negative', 'neutral'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setOutcomeForm({ ...outcomeForm, status: s })}
                  className={clsx(
                    'flex-1 py-2 rounded-lg text-[13px] font-bold border transition-colors capitalize',
                    outcomeForm.status === s
                      ? s === 'positive' ? 'bg-ok-dim border-ok-400/50 text-ok-400'
                        : s === 'negative' ? 'bg-bad-dim border-bad-400/50 text-bad-400'
                        : 'bg-surface-3 border-line-strong text-ink-hi'
                      : 'border-line text-ink-low hover:text-ink-mid',
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
            <label className="label-2xs block mb-1.5" htmlFor="outcome-summary">Post-review summary</label>
            <textarea
              id="outcome-summary"
              value={outcomeForm.summary}
              onChange={(e) => { setOutcomeForm({ ...outcomeForm, summary: e.target.value }); setFormError(false) }}
              rows={3}
              autoFocus
              placeholder="What happened vs the expected impact? What was learned?"
              className={clsx(
                'w-full bg-surface-2 border rounded-lg px-3 py-2 text-[13px] text-ink-hi placeholder:text-ink-low outline-none resize-none transition-colors',
                formError ? 'border-bad-400' : 'border-line focus:border-brand-400',
              )}
            />
            {formError && <p className="text-2xs text-bad-400 mt-1">A post-review summary (10+ characters) is required — this is the learning record.</p>}
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="ghost" onClick={closeOutcomeForm}>Cancel</Button>
              <Button variant="primary" onClick={submitOutcome}>Save outcome & close decision</Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
