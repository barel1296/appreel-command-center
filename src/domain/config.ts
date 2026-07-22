// Versioned managed configuration (spec §2, §20, §21).
// Thresholds live here, never hard-coded in engine logic. The config store
// keeps a version history with rollback (see src/state/configStore.ts).

export interface Thresholds {
  // Acquisition
  target_cpi: number
  max_cpi: number
  min_ctr: number
  min_cvr: number
  // Quality
  min_activation_rate: number
  min_d1: number
  min_d7: number
  min_depth_l3_share: number
  // Monetization
  min_payer_rate: number
  target_d7_roas: number
  min_predicted_d30_roas: number
  max_top_payer_share: number
  // Creative
  fatigue_warn: number
  fatigue_critical: number
  // Scale / confidence
  min_installs_for_decision: number
  min_spend_for_decision: number
  min_payers_for_ltv: number
  max_marginal_cpi_ratio: number
  // Data quality gate
  max_freshness_ratio: number // freshness_hours / sla
  min_coverage: number
  min_match_rate: number
  max_undefined_share: number
  max_duplicate_rate: number
}

export interface GeoOverride {
  geo: string
  target_cpi: number
  min_d1: number
}

export interface DepthLayer {
  layer: string
  label: string
  event: string
}

export interface ProductConfig {
  product_id: string
  thresholds: Thresholds
  geo_overrides: GeoOverride[]
  depth_layers: DepthLayer[]
  revenue_rules: {
    source_of_truth: string
    net_definition: string
    refund_policy: string
    currency: string
  }
  attribution: {
    source_of_truth: string
    click_window_days: number
    view_window_hours: number
    organic_rule: string
  }
}

export interface ConfigVersion {
  version: number
  saved_at: number
  saved_by: string
  note: string
  config: ProductConfig
}

// Seeded from AppReel's own observed medians (Jul 2026), NOT from mid-core game
// benchmarks. Short-form drama retains and monetizes on a completely different
// curve — the stock 32% D1 / 55% activation defaults would fail every campaign
// by construction and make the engine useless. These are a starting point that
// still needs business sign-off; they live in versioned config, not in code.
export const DEFAULT_THRESHOLDS: Thresholds = {
  target_cpi: 8.0,   // observed blended CPI is $8.25
  max_cpi: 14.0,     // above this only the best-retaining geos are defensible
  min_ctr: 0.009,
  min_cvr: 0.1,
  min_activation_rate: 0.30, // reaching episode 3: 553 of 813 first-starters
  min_d1: 0.10,              // AppsFlyer D1 runs 11-16%; Mixpanel ~6%
  min_d7: 0.02,
  min_depth_l3_share: 0.05,
  min_payer_rate: 0.003,     // 38 payers against ~1,100 installs
  target_d7_roas: 0.05,
  min_predicted_d30_roas: 0.25,
  max_top_payer_share: 0.4,
  fatigue_warn: 55,
  fatigue_critical: 75,
  min_installs_for_decision: 400,
  min_spend_for_decision: 800,
  min_payers_for_ltv: 12,
  max_marginal_cpi_ratio: 1.35,
  max_freshness_ratio: 1.0,
  min_coverage: 0.92,
  min_match_rate: 0.82,
  max_undefined_share: 0.12,
  max_duplicate_rate: 0.02,
}

export const defaultProductConfig = (product_id: string): ProductConfig => ({
  product_id,
  thresholds: { ...DEFAULT_THRESHOLDS },
  geo_overrides: [
    { geo: 'US', target_cpi: 3.4, min_d1: 0.34 },
    { geo: 'DE', target_cpi: 2.4, min_d1: 0.33 },
    { geo: 'BR', target_cpi: 0.9, min_d1: 0.28 },
    { geo: 'IN', target_cpi: 0.45, min_d1: 0.24 },
  ],
  depth_layers: [
    { layer: 'L1', label: 'Tutorial complete', event: 'tutorial_complete' },
    { layer: 'L2', label: 'First core loop', event: 'level_3_complete' },
    { layer: 'L3', label: 'Committed player', event: 'level_10_complete' },
    { layer: 'L4', label: 'Feature adoption', event: 'booster_used' },
    { layer: 'L5', label: 'Social / meta', event: 'team_joined' },
  ],
  revenue_rules: {
    source_of_truth: 'Revenue backend (server receipts)',
    net_definition: 'Gross − store fee (30/15%) − VAT − refunds',
    refund_policy: 'Refunds restated against original cohort date',
    currency: 'USD (daily ECB normalization)',
  },
  attribution: {
    source_of_truth: 'MMP (AppsFlyer)',
    click_window_days: 7,
    view_window_hours: 24,
    organic_rule: 'No touch within window → organic',
  },
})

// Role permission matrix (spec §20). Actions checked across the UI.
export type PermAction =
  | 'approve_recommendation'
  | 'reject_recommendation'
  | 'execute_action'
  | 'edit_config'
  | 'rollback_config'
  | 'manage_connectors'
  | 'assign_alerts'
  | 'resolve_alerts'
  | 'manage_onboarding'
  | 'view'

import type { Role } from './types'

export const PERMISSIONS: Record<Role, PermAction[]> = {
  admin: [
    'approve_recommendation', 'reject_recommendation', 'execute_action', 'edit_config',
    'rollback_config', 'manage_connectors', 'assign_alerts', 'resolve_alerts',
    'manage_onboarding', 'view',
  ],
  growth_lead: [
    'approve_recommendation', 'reject_recommendation', 'execute_action',
    'edit_config', 'assign_alerts', 'resolve_alerts', 'manage_onboarding', 'view',
  ],
  analyst: ['reject_recommendation', 'assign_alerts', 'view'],
  creative: ['view'],
  viewer: ['view'],
  operator: ['manage_connectors', 'assign_alerts', 'resolve_alerts', 'view'],
}

export const can = (role: Role, action: PermAction): boolean =>
  PERMISSIONS[role]?.includes(action) ?? false

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  growth_lead: 'Growth Lead',
  analyst: 'Analyst',
  creative: 'Creative',
  viewer: 'Viewer',
  operator: 'Operator',
}
