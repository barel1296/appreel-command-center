// ─────────────────────────────────────────────────────────────────────────────
// Measurement capability — what this workspace can actually MEASURE today.
//
// AppReel currently reports spend, installs and purchase EVENTS through Meta,
// but no revenue VALUE, no MMP attribution and no product event stream. Screens
// ask this module before rendering a metric so a missing source shows as
// "not measured" instead of a confident zero. A zero and an unknown are
// different numbers, and only one of them is a performance signal.
// ─────────────────────────────────────────────────────────────────────────────
import type { Dataset } from '@/domain/seed/generator'

export interface Measurement {
  /** Any revenue at all — ad revenue or purchase value. */
  hasRevenue: boolean
  /** Retention (D1/D3/D7) is observable per cohort. */
  hasRetention: boolean
  /** Product event stream (DAU, sessions, funnels). */
  hasProduct: boolean
  /** An MMP de-duplicates installs; otherwise they are network self-reported. */
  mmpConnected: boolean
  /** Purchase events arrive but carry no value — cost-per-purchase only. */
  purchaseEventsOnly: boolean
  /** Country grain exists (drives the country filter). */
  hasGeo: boolean
}

export function measurement(ds: Dataset): Measurement {
  const revFromCohorts = ds.cohorts.some((c) => c.revenue_by_age.some((v) => v > 0))
  const hasRevenue = revFromCohorts || (ds.revenue_daily?.length ?? 0) > 0 || (ds.revenue_activity_daily?.length ?? 0) > 0
  const purchases = ds.cohorts.reduce((a, c) => a + c.payers, 0)
  return {
    hasRevenue,
    hasRetention: ds.cohorts.some((c) => c.d1_retained > 0),
    hasProduct: (ds.product_daily?.length ?? 0) > 0,
    mmpConnected: ds.cohorts.some((c) => c.matched_installs > 0),
    purchaseEventsOnly: !hasRevenue && purchases > 0,
    hasGeo: (ds.geo_cohort?.length ?? 0) > 0 || (ds.geo_daily?.length ?? 0) > 0,
  }
}

/** The gaps, in the order they should be closed, for onboarding/empty states. */
export function missingSources(m: Measurement): { name: string; unlocks: string; how: string }[] {
  const out: { name: string; unlocks: string; how: string }[] = []
  if (!m.hasRevenue) {
    out.push({
      name: 'Purchase revenue value',
      unlocks: 'Revenue, ROAS, LTV, payback, whale detection — every scale decision',
      how: m.purchaseEventsOnly
        ? 'Purchase events already reach Meta but arrive with an empty value. Send value + currency on the purchase event in the SDK.'
        : 'Connect a revenue source (IAP receipts or an ad-revenue feed).',
    })
  }
  if (!m.mmpConnected) {
    out.push({
      name: 'MMP attribution',
      unlocks: 'Install truth, cross-network de-duplication, honest CPI and cohort joins',
      how: 'Connect AppsFlyer (or Adjust/Singular) for the AppReel apps and grant API access.',
    })
  }
  if (!m.hasProduct) {
    out.push({
      name: 'Product event stream',
      unlocks: 'Retention, DAU, session depth, episode funnels, quality score',
      how: 'Point the app’s analytics events at a warehouse the platform can read.',
    })
  }
  return out
}
