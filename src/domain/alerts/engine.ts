// Alert engine (spec §18): derives operational alerts from the same facts the
// decision engine reads, with severity, dedupe, SLA, and lifecycle handled by
// the alert store. Alerts link to recommendations where one exists.
import type { Dataset } from '../seed/generator'
import type { Alert, Recommendation } from '../types'
import type { ProductConfig } from '../config'
import { gateForConnector } from '../quality/gate'
import { computeCampaignMetrics } from '../metrics/compute'
import { fmtMoney, fmtPct } from '@/lib/format'

const H = 3600_000

export function deriveAlerts(ds: Dataset, cfg: ProductConfig, recs: Recommendation[]): Alert[] {
  const alerts: Alert[] = []
  const t = cfg.thresholds
  const now = ds.generated_at
  const recFor = (pred: (r: Recommendation) => boolean) => recs.find(pred)?.recommendation_id ?? null

  // 1 ─ Connector incidents
  for (const c of ds.connectors) {
    const gate = gateForConnector(c, t)
    if (gate.status === 'red') {
      alerts.push({
        alert_id: `al-conn-${c.source_id}`,
        created_at: now - 5.5 * H,
        severity: 'critical',
        // Name the failure the connector actually has. A never-connected source
        // is not a "degraded pipeline" — calling it one sends the on-call to
        // debug an integration that was never stood up.
        title: c.last_sync_ts === 0
          ? `${c.name}: source not connected`
          : c.schema_drift
            ? `${c.name}: schema contract broken`
            : `${c.name}: pipeline degraded`,
        summary: c.last_sync_ts === 0
          ? `${c.name} has never delivered data to this workspace. Every metric that depends on it is withheld, and any decision needing it is blocked by the quality gate.`
          : `Match rate ${fmtPct(c.match_rate)}, freshness ${c.freshness_hours.toFixed(1)}h vs ${c.freshness_sla_hours}h SLA, ` +
            `${fmtPct(c.undefined_share)} of traffic undefined. All business decisions on this source are blocked by the quality gate.`,
        category: 'data',
        product_id: 'appreel',
        scope_label: c.name,
        affected: ds.campaigns.filter((cp) => cp.channel_id === c.source_id).map((cp) => cp.name),
        evidence: gate.checks.filter((ch) => ch.status !== 'green').map((ch) => ({
          metric: ch.label, value: ch.value, benchmark: ch.threshold, verdict: ch.status === 'red' ? 'bad' as const : 'warn' as const,
        })),
        state: 'investigating',
        owner: 'Yoni Bar',
        sla_hours: 4,
        dedupe_count: 3,
        linked_recommendation_id: recFor((r) => r.recommendation_type === 'fix_tracking' && r.scope.channel_id === c.source_id),
        resolution_note: null,
        timeline: [
          { ts: now - 5.5 * H, event: 'Alert created — match rate crossed red threshold', actor: 'system' },
          { ts: now - 5.1 * H, event: 'Deduped 2 duplicate signals into this alert (same root cause)', actor: 'system' },
          { ts: now - 4.6 * H, event: 'Assigned to Yoni Bar (data operator on-call)', actor: 'system' },
          { ts: now - 4.2 * H, event: 'Acknowledged; investigating postback configuration', actor: 'Yoni Bar' },
        ],
      })
    } else if (c.schema_drift) {
      alerts.push({
        alert_id: `al-drift-${c.source_id}`,
        created_at: now - 26 * H,
        severity: 'medium',
        title: `${c.name}: schema drift detected`,
        summary: c.schema_drift_note ?? 'Source changed fields or types.',
        category: 'data',
        product_id: 'appreel',
        scope_label: c.name,
        affected: ['Creative watch-rate metrics'],
        evidence: [{ metric: 'Schema', value: 'Drift', benchmark: 'Stable', verdict: 'warn' }],
        state: 'action_proposed',
        owner: 'Yoni Bar',
        sla_hours: 48,
        dedupe_count: 1,
        linked_recommendation_id: null,
        resolution_note: null,
        timeline: [
          { ts: now - 26 * H, event: 'Contract validation flagged renamed field', actor: 'system' },
          { ts: now - 20 * H, event: 'Mapper patched; backfill validation running', actor: 'Yoni Bar' },
        ],
      })
    }
  }

  // 2 ─ Young cohort burning budget with red quality
  for (const camp of ds.campaigns.filter((c) => c.status === 'active')) {
    const m = computeCampaignMetrics(ds, camp.campaign_id, t)
    if (m.age_days > 7 && m.quality_score < 45 && m.spend > t.min_spend_for_decision && m.quality_gate.status !== 'red') {
      alerts.push({
        alert_id: `al-burn-${camp.campaign_id}`,
        created_at: now - 9 * H,
        severity: 'high',
        title: `${camp.name} is buying installs that don't become users`,
        summary: `${fmtMoney(m.spend)} spent in ${m.window_days}d at quality score ${m.quality_score}/100 — ` +
          `activation ${fmtPct(m.activation_rate)}, D1 ${fmtPct(m.d1)}. Recommendation is queued for a decision today.`,
        category: 'quality',
        product_id: camp.product_id,
        scope_label: camp.name,
        affected: camp.geos,
        evidence: [
          { metric: 'Quality score', value: `${m.quality_score}/100`, benchmark: '≥ 60', verdict: 'bad' },
          { metric: 'D1 retention', value: fmtPct(m.d1), benchmark: `min ${fmtPct(t.min_d1)}`, verdict: 'bad' },
          { metric: 'Window spend', value: fmtMoney(m.spend), benchmark: '—', verdict: 'warn' },
        ],
        state: 'acknowledged',
        owner: 'Dana Peretz',
        sla_hours: 24,
        dedupe_count: 1,
        linked_recommendation_id: recFor((r) => r.scope.campaign_id === camp.campaign_id && (r.recommendation_type === 'pause' || r.recommendation_type === 'reduce')),
        resolution_note: null,
        timeline: [
          { ts: now - 9 * H, event: 'Quality score crossed high-severity threshold', actor: 'system' },
          { ts: now - 7 * H, event: 'Assigned to Dana Peretz (growth lead)', actor: 'system' },
          { ts: now - 6.4 * H, event: 'Acknowledged — pending queue decision', actor: 'Dana Peretz' },
        ],
      })
    }
    if (m.fatigue_score >= t.fatigue_critical) {
      alerts.push({
        alert_id: `al-fatigue-${camp.campaign_id}`,
        created_at: now - 14 * H,
        severity: 'high',
        title: `Severe creative fatigue on ${camp.name}`,
        summary: `Weighted fatigue ${m.fatigue_score.toFixed(0)}/100 with CPI drifting ${fmtPct(m.cpi_trend)}. Refresh recommendation is in the queue.`,
        category: 'creative',
        product_id: camp.product_id,
        scope_label: camp.name,
        affected: camp.creative_ids,
        evidence: [
          { metric: 'Fatigue', value: `${m.fatigue_score.toFixed(0)}/100`, benchmark: `< ${t.fatigue_critical}`, verdict: 'bad' },
          { metric: 'CPI trend', value: fmtPct(m.cpi_trend), benchmark: 'flat', verdict: 'bad' },
        ],
        state: 'action_proposed',
        owner: 'Lia Chen',
        sla_hours: 24,
        dedupe_count: 2,
        linked_recommendation_id: recFor((r) => r.scope.campaign_id === camp.campaign_id && r.recommendation_type === 'refresh_creative'),
        resolution_note: null,
        timeline: [
          { ts: now - 14 * H, event: 'Fatigue crossed critical threshold', actor: 'system' },
          { ts: now - 11 * H, event: 'Deduped CTR-decay signal into this alert', actor: 'system' },
          { ts: now - 8 * H, event: 'Assigned to Lia Chen (creative)', actor: 'system' },
          { ts: now - 3 * H, event: 'Refresh recommendation generated', actor: 'system' },
        ],
      })
    }
  }

  // 3 ─ Store conversion drop (mirrors store recommendation)
  const storeRec = recs.find((r) => r.recommendation_id.startsWith('rec-store-'))
  if (storeRec) {
    alerts.push({
      alert_id: `al-store-${storeRec.scope.geo}`,
      created_at: now - 32 * H,
      severity: 'high',
      title: `Store conversion drop in ${storeRec.scope.geo}`,
      summary: storeRec.reason.split('.')[0] + '.',
      category: 'store',
      product_id: storeRec.product_id,
      scope_label: `App Store · ${storeRec.scope.geo}`,
      affected: ds.campaigns.filter((c) => c.geos.includes(storeRec.scope.geo!)).map((c) => c.name),
      evidence: storeRec.evidence,
      state: 'investigating',
      owner: 'Omer Katz',
      sla_hours: 48,
      dedupe_count: 1,
      linked_recommendation_id: storeRec.recommendation_id,
      resolution_note: null,
      timeline: [
        { ts: now - 32 * H, event: 'CVR anomaly detected vs 14-day baseline', actor: 'system' },
        { ts: now - 28 * H, event: 'Assigned to Omer Katz', actor: 'system' },
        { ts: now - 20 * H, event: 'Correlated with screenshot update + review sentiment shift', actor: 'Omer Katz' },
      ],
    })
  }

  // 4 ─ Low: trend brief
  const trendRec = recs.find((r) => r.recommendation_id.startsWith('rec-social-'))
  if (trendRec) {
    alerts.push({
      alert_id: 'al-trend-brief',
      created_at: now - 3 * H,
      severity: 'low',
      title: 'Daily trend brief: organic concept spiking',
      summary: trendRec.title,
      category: 'creative',
      product_id: trendRec.product_id,
      scope_label: 'Social listening',
      affected: [],
      evidence: trendRec.evidence,
      state: 'created',
      owner: null,
      sla_hours: 72,
      dedupe_count: 1,
      linked_recommendation_id: trendRec.recommendation_id,
      resolution_note: null,
      timeline: [{ ts: now - 3 * H, event: 'Trend velocity crossed briefing threshold', actor: 'system' }],
    })
  }

  // 5 ─ Resolved example (shows full lifecycle)
  alerts.push({
    alert_id: 'al-resolved-spend',
    created_at: now - 70 * H,
    severity: 'medium',
    title: 'Abnormal overnight spend spike on Meta',
    summary: 'META_T1_Android_Install_Broad spent 2.4x its hourly pace between 02:00–05:00 UTC. Root cause: budget re-pacing after midnight budget reset — expected platform behavior.',
    category: 'spend',
    product_id: 'appreel',
    scope_label: 'META_T1_Android_Install_Broad',
    affected: ['US', 'UK', 'DE', 'AU'],
    evidence: [
      { metric: 'Hourly pace', value: '2.4x baseline', benchmark: '≤ 1.8x', verdict: 'warn' },
      { metric: 'Attribution present', value: 'Yes', benchmark: 'required', verdict: 'good' },
    ],
    state: 'resolved',
    owner: 'Dana Peretz',
    sla_hours: 24,
    dedupe_count: 1,
    linked_recommendation_id: null,
    resolution_note: 'Platform budget re-pacing after daily reset; installs and quality tracked normally. Added pace-window exception to the detector.',
    timeline: [
      { ts: now - 70 * H, event: 'Spend pace anomaly detected', actor: 'system' },
      { ts: now - 68 * H, event: 'Assigned to Dana Peretz', actor: 'system' },
      { ts: now - 66 * H, event: 'Acknowledged; checking attribution coverage', actor: 'Dana Peretz' },
      { ts: now - 47 * H, event: 'Resolved — expected re-pacing, detector tuned', actor: 'Dana Peretz' },
    ],
  })

  const sevRank = { critical: 0, high: 1, medium: 2, low: 3 }
  return alerts.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || b.created_at - a.created_at)
}
