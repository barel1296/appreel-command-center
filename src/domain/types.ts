// ─────────────────────────────────────────────────────────────────────────────
// Canonical data model (spec §4) + workflow/decision objects (spec §14, §17, §18).
// These types are the API contract: a real backend must serve exactly these
// shapes. The simulation layer in src/api/backend.ts implements them locally.
// ─────────────────────────────────────────────────────────────────────────────

export type ProductStatus = 'live' | 'onboarding' | 'paused'

export interface DimProduct {
  product_id: string
  name: string
  icon: string
  platforms: ('ios' | 'android')[]
  stores: string[]
  markets: string[]
  owner: string
  status: ProductStatus
  onboarding: OnboardingState
}

export type OnboardingStepId =
  | 'registration'
  | 'identity'
  | 'events'
  | 'depth'
  | 'revenue'
  | 'attribution'
  | 'creative'
  | 'thresholds'
  | 'data_qa'
  | 'go_live'

export interface OnboardingStep {
  id: OnboardingStepId
  label: string
  description: string
  status: 'complete' | 'in_progress' | 'blocked' | 'pending'
  detail?: string
}

export interface OnboardingState {
  steps: OnboardingStep[]
}

export type ChannelKind = 'paid' | 'organic' | 'social' | 'store'

export interface DimChannel {
  channel_id: string
  name: string
  kind: ChannelKind
  color: string
}

export type CampaignObjective = 'install' | 'purchase' | 'value' | 'retargeting'
export type CampaignStatus = 'active' | 'paused' | 'ended'

export interface DimCampaign {
  campaign_id: string
  product_id: string
  channel_id: string
  name: string
  objective: CampaignObjective
  status: CampaignStatus
  geos: string[]
  platform: 'ios' | 'android' | 'both'
  start_date: string // ISO date
  daily_budget: number
  creative_ids: string[]
}

export type CreativeFormat = 'video_15s' | 'video_30s' | 'playable' | 'static' | 'ugc_video'

export interface DimCreativeAsset {
  creative_asset_id: string
  product_id: string
  name: string
  concept: string
  hook: string
  angle: string
  format: CreativeFormat
  language: string
  parent_id: string | null
  iteration: number
  launch_date: string
  status: 'live' | 'testing' | 'retired'
}

// fact_spend: date × campaign × creative (join grain is explicit; spec §4 no-mixing rule)
export interface FactSpend {
  date: string
  campaign_id: string
  creative_asset_id: string
  spend: number
  impressions: number
  clicks: number
  network_installs: number // network-reported, NOT source of truth
}

// Cohort roll-up of fact_attribution_install + fact_user_event + fact_revenue,
// pre-joined through the certified bridge at cohort_date × campaign grain.
export interface FactCohort {
  cohort_date: string
  campaign_id: string
  installs: number // attributed installs (MMP source of truth)
  matched_installs: number // installs successfully joined to spend rows
  activated: number
  meaningful_sessions: number
  d1_retained: number
  d3_retained: number
  d7_retained: number
  sessions_per_user: number
  depth_l3_share: number // share reaching configured depth layer L3 by D1
  payers: number
  repeat_payers: number
  revenue_by_age: number[] // net revenue on cohort age day i (index 0 = D0)
  top_payer_revenue: number // largest single-payer net revenue in cohort
  refunds: number
}

export interface FactStoreDaily {
  date: string
  product_id: string
  geo: string
  impressions: number
  page_views: number
  installs_organic: number
  installs_paid: number
  rating: number
  reviews_count: number
  negative_review_share: number
}

export interface KeywordRank {
  keyword: string
  geo: string
  rank: number
  rank_prev_week: number
  impressions_share: number
}

export interface FactSocialContent {
  content_id: string
  product_id: string
  platform: 'tiktok' | 'instagram' | 'youtube'
  title: string
  posted_at: string
  views: number
  engagement_rate: number
  shares: number
  comments: number
  sentiment: number // -1..1
  trend_tags: string[]
  concept_candidate: boolean
  paired_concept: string | null
}

// ── Data quality (spec §13) ──────────────────────────────────────────────────

export type SourceId =
  | 'meta'
  | 'google'
  | 'tiktok'
  | 'applovin'
  | 'unity'
  | 'mmp'
  | 'events'
  | 'revenue'
  | 'store'
  | 'social'

export interface ConnectorStatus {
  source_id: SourceId
  name: string
  category: 'ad_network' | 'attribution' | 'product_events' | 'revenue' | 'store' | 'social'
  last_sync_ts: number
  freshness_sla_hours: number
  freshness_hours: number
  coverage: number // 0..1 share of expected slices present
  match_rate: number // 0..1 (attribution join quality)
  undefined_share: number // 0..1 traffic under unknown/undefined
  duplicate_rate: number
  schema_drift: boolean
  schema_drift_note?: string
  late_data_impact: number // 0..1 share of history restated in last backfill
  failing_jobs: number
  sync_history: { ts: number; ok: boolean; duration_s: number; rows: number }[]
}

export type QualityStatus = 'green' | 'yellow' | 'red'

export interface QualityCheck {
  id: string
  label: string
  status: QualityStatus
  value: string
  threshold: string
  detail: string
  source_id?: SourceId
}

export interface QualityGateResult {
  status: QualityStatus
  checks: QualityCheck[]
  blocked_reason?: string
}

// ── Metrics (spec §6) ────────────────────────────────────────────────────────

export interface CampaignMetrics {
  campaign_id: string
  window_days: number
  spend: number
  impressions: number
  clicks: number
  installs: number
  network_installs: number
  ctr: number
  cvr_click_install: number
  cpm: number
  cpc: number
  cpi: number
  ecpi: number
  cost_per_activated: number
  activation_rate: number
  meaningful_session_rate: number
  d1: number
  d3: number
  d7: number
  sessions_per_user: number
  depth_l3_share: number
  payer_rate: number
  repeat_payer_rate: number
  arpu: number
  arppu: number
  revenue: number
  refund_rate: number
  roas_d0: number
  roas_d7: number
  top_payer_share: number
  revenue_volatility: number
  marginal_cpi_ratio: number // marginal CPI vs average CPI (last week vs window)
  frequency: number
  saturation_index: number // 0..1
  scale_headroom: 'low' | 'medium' | 'high'
  fatigue_score: number // 0..100 weighted creative fatigue across spend
  quality_score: number // 0..100
  spend_trend: number // WoW spend delta
  cpi_trend: number
  age_days: number
  match_rate: number
  predicted_d30_roas: { low: number; base: number; high: number }
  ltv_d30: { low: number; base: number; high: number }
  confidence: ConfidenceLevel
  confidence_factors: ConfidenceFactor[]
  quality_gate: QualityGateResult
  daily: CampaignDaily[]
}

export interface CampaignDaily {
  date: string
  spend: number
  installs: number
  cpi: number
  ctr: number
  revenue_d0: number
  d1: number | null
}

export interface ConfidenceFactor {
  factor: string
  effect: 'up' | 'down' | 'neutral'
  note: string
}

export type ConfidenceLevel = 'low' | 'medium' | 'high'

export interface CreativeMetrics {
  creative_asset_id: string
  spend: number
  impressions: number
  clicks: number
  installs: number
  ctr: number
  cpi: number
  activation_rate: number
  d1: number
  roas_d7: number
  fatigue: number // 0..100
  ctr_decay: number // relative CTR change over trailing weeks
  cpi_drift: number
  age_days: number
  spend_since_launch: number
  campaigns: string[]
  geo_fit: { geo: string; cpi: number; d1: number; spend: number }[]
}

// ── Decision engine (spec §14, §17) ──────────────────────────────────────────

export type RecommendationType =
  | 'scale'
  | 'keep'
  | 'hold'
  | 'reduce'
  | 'pause'
  | 'refresh_creative'
  | 'fix_tracking'
  | 'investigate'

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export type ApprovalStatus =
  | 'proposed'
  | 'approved'
  | 'rejected'
  | 'executed'
  | 'monitored'
  | 'closed'

export interface EvidenceItem {
  metric: string
  value: string
  benchmark: string
  verdict: 'good' | 'bad' | 'neutral' | 'warn'
}

export interface Recommendation {
  recommendation_id: string
  created_at: number
  product_id: string
  scope: {
    level: 'campaign' | 'creative' | 'channel' | 'geo' | 'product' | 'source'
    campaign_id?: string
    creative_asset_id?: string
    channel_id?: string
    geo?: string
    source_id?: SourceId
    label: string
  }
  recommendation_type: RecommendationType
  title: string
  reason: string
  evidence: EvidenceItem[]
  risk_level: RiskLevel
  confidence: ConfidenceLevel
  confidence_note: string
  expected_impact: string
  data_quality: QualityStatus
  requires_approval: boolean
  suggested_action: string
  monitoring_window_days: number
  stop_condition: string
  priority: number // 0..100 for queue ordering
  next_review_at: number
  approval_status: ApprovalStatus
  owner: string | null
  stage_lights: StageLights
}

export interface StageLights {
  media: QualityStatus
  quality: QualityStatus
  monetization: QualityStatus
  creative: QualityStatus
  data: QualityStatus
}

export interface LedgerEntry {
  decision_id: string
  recommendation: Recommendation
  decided_by: string
  decided_at: number
  action: 'approved' | 'rejected' | 'executed' | 'closed'
  note: string
  outcome: {
    status: 'pending' | 'monitoring' | 'positive' | 'negative' | 'neutral'
    summary: string
    reviewed_at: number | null
  }
  history: { ts: number; actor: string; event: string }[]
}

// ── Alerts (spec §18) ────────────────────────────────────────────────────────

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low'
export type AlertState =
  | 'created'
  | 'assigned'
  | 'acknowledged'
  | 'investigating'
  | 'action_proposed'
  | 'resolved'

export interface Alert {
  alert_id: string
  created_at: number
  severity: AlertSeverity
  title: string
  summary: string
  category: 'data' | 'spend' | 'quality' | 'creative' | 'store' | 'monetization'
  product_id: string
  scope_label: string
  affected: string[]
  evidence: EvidenceItem[]
  state: AlertState
  owner: string | null
  sla_hours: number
  dedupe_count: number
  linked_recommendation_id: string | null
  resolution_note: string | null
  timeline: { ts: number; event: string; actor: string }[]
}

// ── RBAC / audit (spec §20) ──────────────────────────────────────────────────

export type Role = 'admin' | 'growth_lead' | 'analyst' | 'creative' | 'viewer' | 'operator'

export interface User {
  user_id: string
  name: string
  role: Role
  avatar_hue: number
}

export interface AuditEvent {
  id: string
  ts: number
  actor: string
  action: string
  target: string
  detail: string
}

// ── Copilot (spec §15) ───────────────────────────────────────────────────────

export interface CopilotCitation {
  label: string
  value: string
  source: string
}

export interface CopilotAnswer {
  claim: string
  evidence: CopilotCitation[]
  confidence: ConfidenceLevel
  limitations: string
  next_action: string
  agent: string
}

export interface CopilotMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  answer?: CopilotAnswer
  ts: number
}
