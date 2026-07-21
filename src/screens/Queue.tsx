// Recommendation Queue (spec §16, §17): every recommendation requiring a
// decision, ordered by priority, filterable by type/status/risk.
import { ClipboardList, ListChecks } from 'lucide-react'
import { useMemo, useState } from 'react'
import { RecommendationCard } from '@/components/RecommendationCard'
import { Card, EmptyState, SearchInput, Select } from '@/components/ui'
import type { ApprovalStatus, RecommendationType, RiskLevel } from '@/domain/types'
import { useApp } from '@/state/store'

export function Queue() {
  const app = useApp()
  const [typeFilter, setTypeFilter] = useState<'all' | RecommendationType>('all')
  const [statusFilter, setStatusFilter] = useState<'open' | 'all' | ApprovalStatus>('open')
  const [riskFilter, setRiskFilter] = useState<'all' | RiskLevel>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'priority' | 'newest' | 'risk'>('priority')

  const riskRank: Record<RiskLevel, number> = { critical: 3, high: 2, medium: 1, low: 0 }

  const rows = useMemo(() => {
    let r = app.recommendations.filter((rec) =>
      (typeFilter === 'all' || rec.recommendation_type === typeFilter) &&
      (statusFilter === 'all' ? true : statusFilter === 'open' ? rec.approval_status === 'proposed' : rec.approval_status === statusFilter) &&
      (riskFilter === 'all' || rec.risk_level === riskFilter) &&
      (search === '' || rec.title.toLowerCase().includes(search.toLowerCase()) || rec.scope.label.toLowerCase().includes(search.toLowerCase())),
    )
    if (sort === 'priority') r = [...r].sort((a, b) => b.priority - a.priority)
    if (sort === 'newest') r = [...r].sort((a, b) => b.created_at - a.created_at)
    if (sort === 'risk') r = [...r].sort((a, b) => riskRank[b.risk_level] - riskRank[a.risk_level])
    return r
  }, [app.recommendations, typeFilter, statusFilter, riskFilter, search, sort])

  const openCount = app.recommendations.filter((r) => r.approval_status === 'proposed').length
  const needApproval = app.recommendations.filter((r) => r.approval_status === 'proposed' && r.requires_approval).length

  return (
    <div className="animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight flex items-center gap-2">
            <ClipboardList size={20} className="text-brand-300" /> Decision Queue
          </h1>
          <p className="text-[13px] text-ink-mid">
            {openCount} open · {needApproval} require formal approval. Every decision is recorded in the ledger with owner and outcome tracking.
          </p>
        </div>
        <SearchInput value={search} onChange={setSearch} placeholder="Search recommendations…" className="w-full sm:w-64" />
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-4">
        <Select
          value={typeFilter}
          onChange={setTypeFilter}
          options={[
            { value: 'all', label: 'All types' },
            { value: 'scale', label: 'Scale' },
            { value: 'keep', label: 'Keep' },
            { value: 'hold', label: 'Hold' },
            { value: 'reduce', label: 'Reduce' },
            { value: 'pause', label: 'Pause' },
            { value: 'refresh_creative', label: 'Refresh Creative' },
            { value: 'fix_tracking', label: 'Fix Tracking' },
            { value: 'investigate', label: 'Investigate' },
          ]}
        />
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'open', label: 'Awaiting decision' },
            { value: 'approved', label: 'Approved' },
            { value: 'monitored', label: 'Monitoring' },
            { value: 'rejected', label: 'Rejected' },
            { value: 'closed', label: 'Closed' },
            { value: 'all', label: 'All statuses' },
          ]}
        />
        <Select
          value={riskFilter}
          onChange={setRiskFilter}
          options={[
            { value: 'all', label: 'All risk levels' },
            { value: 'critical', label: 'Critical' },
            { value: 'high', label: 'High' },
            { value: 'medium', label: 'Medium' },
            { value: 'low', label: 'Low' },
          ]}
        />
        <div className="ml-auto">
          <Select
            value={sort}
            onChange={setSort}
            label="Sort"
            options={[
              { value: 'priority', label: 'Priority' },
              { value: 'newest', label: 'Newest' },
              { value: 'risk', label: 'Risk' },
            ]}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ListChecks size={22} />}
            title={statusFilter === 'open' ? 'Queue is clear' : 'Nothing matches'}
            message={
              statusFilter === 'open'
                ? 'No recommendations are awaiting a decision. New ones are generated on every data refresh when the engine finds something actionable.'
                : 'No recommendations match the current filters — try widening them.'
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rows.map((rec) => (
            <RecommendationCard key={rec.recommendation_id} rec={rec} />
          ))}
        </div>
      )}
    </div>
  )
}
