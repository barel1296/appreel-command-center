// Data Quality Gate (spec §13): runs BEFORE the decision engine. Red blocks
// business recommendations entirely — the output becomes a Fix Tracking task.
import type { ConnectorStatus, QualityCheck, QualityGateResult, QualityStatus, SourceId } from '../types'
import type { Thresholds } from '../config'

const worst = (a: QualityStatus, b: QualityStatus): QualityStatus =>
  a === 'red' || b === 'red' ? 'red' : a === 'yellow' || b === 'yellow' ? 'yellow' : 'green'

export function gateForConnector(c: ConnectorStatus, t: Thresholds): QualityGateResult {
  const checks: QualityCheck[] = []
  const freshRatio = c.freshness_hours / c.freshness_sla_hours
  checks.push({
    id: `${c.source_id}-freshness`,
    label: 'Freshness',
    status: freshRatio > 1.25 ? 'red' : freshRatio > t.max_freshness_ratio ? 'yellow' : 'green',
    value: `${c.freshness_hours.toFixed(1)}h`,
    threshold: `SLA ${c.freshness_sla_hours}h`,
    detail: freshRatio > 1 ? 'Data older than SLA — recommendations on this source are stale' : 'Within SLA',
    source_id: c.source_id,
  })
  checks.push({
    id: `${c.source_id}-coverage`,
    label: 'Coverage',
    status: c.coverage < t.min_coverage - 0.06 ? 'red' : c.coverage < t.min_coverage ? 'yellow' : 'green',
    value: pct(c.coverage),
    threshold: `≥ ${pct(t.min_coverage)}`,
    detail: c.coverage < t.min_coverage ? 'Expected slices missing (spend/installs/revenue gaps)' : 'All expected slices present',
    source_id: c.source_id,
  })
  checks.push({
    id: `${c.source_id}-match`,
    label: 'Match Rate',
    status: c.match_rate < t.min_match_rate - 0.12 ? 'red' : c.match_rate < t.min_match_rate ? 'yellow' : 'green',
    value: pct(c.match_rate),
    threshold: `≥ ${pct(t.min_match_rate)}`,
    detail: c.match_rate < t.min_match_rate ? 'Installs/events not joining to campaign/creative — attribution gap' : 'Attribution joins healthy',
    source_id: c.source_id,
  })
  checks.push({
    id: `${c.source_id}-undefined`,
    label: 'Undefined Share',
    status: c.undefined_share > t.max_undefined_share * 1.6 ? 'red' : c.undefined_share > t.max_undefined_share ? 'yellow' : 'green',
    value: pct(c.undefined_share),
    threshold: `≤ ${pct(t.max_undefined_share)}`,
    detail: c.undefined_share > t.max_undefined_share ? 'Too much traffic under unknown/undefined — scale decisions stopped' : 'Unknown traffic within tolerance',
    source_id: c.source_id,
  })
  checks.push({
    id: `${c.source_id}-dupes`,
    label: 'Duplicates',
    status: c.duplicate_rate > t.max_duplicate_rate * 2 ? 'red' : c.duplicate_rate > t.max_duplicate_rate ? 'yellow' : 'green',
    value: pct(c.duplicate_rate),
    threshold: `≤ ${pct(t.max_duplicate_rate)}`,
    detail: c.duplicate_rate > t.max_duplicate_rate ? 'Duplicate rows quarantined pending dedupe' : 'No duplication detected',
    source_id: c.source_id,
  })
  checks.push({
    id: `${c.source_id}-schema`,
    label: 'Schema Drift',
    status: c.schema_drift ? 'yellow' : 'green',
    value: c.schema_drift ? 'Drift detected' : 'Stable',
    threshold: 'No drift',
    detail: c.schema_drift_note ?? 'Source schema matches contract',
    source_id: c.source_id,
  })
  checks.push({
    id: `${c.source_id}-late`,
    label: 'Late Data',
    status: c.late_data_impact > 0.06 ? 'yellow' : 'green',
    value: pct(c.late_data_impact),
    threshold: '≤ 6% restated',
    detail: c.late_data_impact > 0.06 ? 'Backfills restating history — affected decisions queued for recompute' : 'Backfill impact negligible',
    source_id: c.source_id,
  })

  const status = checks.reduce<QualityStatus>((acc, ch) => worst(acc, ch.status), 'green')
  return {
    status,
    checks,
    blocked_reason: status === 'red'
      ? 'Data quality RED — business decisions on this source are blocked (spec §13)'
      : undefined,
  }
}

// Campaign-level gate: combines its channel connector + MMP + campaign-specific match rate.
export function gateForCampaign(
  channelSource: SourceId,
  connectors: ConnectorStatus[],
  campaignMatchRate: number,
  t: Thresholds,
): QualityGateResult {
  const relevant = connectors.filter((c) =>
    c.source_id === channelSource || ['mmp', 'events', 'revenue'].includes(c.source_id),
  )
  const checks: QualityCheck[] = []
  for (const c of relevant) {
    const g = gateForConnector(c, t)
    // Surface only non-green source checks plus a source summary
    checks.push({
      id: `src-${c.source_id}`,
      label: c.name,
      status: g.status,
      value: g.status.toUpperCase(),
      threshold: 'green',
      detail: g.checks.filter((ch) => ch.status !== 'green').map((ch) => `${ch.label}: ${ch.detail}`).join('; ') || 'All checks green',
      source_id: c.source_id,
    })
  }
  checks.push({
    id: 'campaign-match',
    label: 'Campaign Match Rate',
    status: campaignMatchRate < t.min_match_rate - 0.12 ? 'red' : campaignMatchRate < t.min_match_rate ? 'yellow' : 'green',
    value: pct(campaignMatchRate),
    threshold: `≥ ${pct(t.min_match_rate)}`,
    detail: campaignMatchRate < t.min_match_rate
      ? 'Attributed installs not joining to spend rows for this campaign'
      : 'Spend↔attribution bridge healthy',
  })
  const status = checks.reduce<QualityStatus>((acc, ch) => worst(acc, ch.status), 'green')
  return {
    status,
    checks,
    blocked_reason: status === 'red'
      ? 'Data quality RED — no business decision allowed; routed as tracking fix (spec §13)'
      : undefined,
  }
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`
