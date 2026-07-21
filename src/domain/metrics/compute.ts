// Semantic metrics layer (spec §3, §6): certified metric computation from
// canonical facts. Joins always go through explicit grains — spend at
// date×campaign×creative, cohorts at date×campaign — never naive merges.
import type { Dataset } from '../seed/generator'
import type {
  CampaignDaily, CampaignMetrics, ConfidenceFactor, ConfidenceLevel,
  CreativeMetrics, SourceId,
} from '../types'
import type { Thresholds } from '../config'
import { gateForCampaign } from '../quality/gate'
import { fitRevenueCurve, forecastD30Revenue } from '../forecast/ltv'
import { cpiOf, daysBetween, isoDaysAgo } from '@/lib/format'

const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0)
const safe = (a: number, b: number) => (b > 0 ? a / b : 0)

export function computeCampaignMetrics(
  ds: Dataset,
  campaignId: string,
  t: Thresholds,
  windowDays = 14,
): CampaignMetrics {
  const campaign = ds.campaigns.find((c) => c.campaign_id === campaignId)!
  const cutoff = isoDaysAgo(windowDays)
  const spendRows = ds.spend.filter((r) => r.campaign_id === campaignId && r.date >= cutoff)
  const cohortRows = ds.cohorts.filter((r) => r.campaign_id === campaignId && r.cohort_date >= cutoff)
  const allSpendRows = ds.spend.filter((r) => r.campaign_id === campaignId)

  const spend = sum(spendRows.map((r) => r.spend))
  const impressions = sum(spendRows.map((r) => r.impressions))
  const clicks = sum(spendRows.map((r) => r.clicks))
  const networkInstalls = sum(spendRows.map((r) => r.network_installs))
  const installs = sum(cohortRows.map((r) => r.installs))
  const matched = sum(cohortRows.map((r) => r.matched_installs))
  const activated = sum(cohortRows.map((r) => r.activated))
  const meaningful = sum(cohortRows.map((r) => r.meaningful_sessions))

  // Retention uses only cohorts old enough to have matured (point-in-time, spec §8)
  const d1Eligible = cohortRows.filter((r) => daysBetween(r.cohort_date, isoDaysAgo(0)) >= 1)
  const d3Eligible = cohortRows.filter((r) => daysBetween(r.cohort_date, isoDaysAgo(0)) >= 3)
  const d7Eligible = cohortRows.filter((r) => daysBetween(r.cohort_date, isoDaysAgo(0)) >= 7)
  // Workspace-level capability: with no product event source at all, retention
  // and engagement are UNKNOWN, not zero. NaN propagates to an em dash in every
  // formatter, so a missing source can never be read as bad performance.
  const retentionMeasured = ds.cohorts.some((r) => r.d1_retained > 0 || r.activated > 0)
  const unk = (v: number) => (retentionMeasured ? v : NaN)
  // Same rule for money: no revenue source means every revenue-derived metric
  // is unknown. Purchase COUNTS survive — only the dollar figures go dark.
  const revenueMeasured = ds.cohorts.some((r) => r.revenue_by_age.some((v) => v > 0)) || (ds.revenue_daily?.length ?? 0) > 0
  const unkRev = (v: number) => (revenueMeasured ? v : NaN)
  const d1 = unk(safe(sum(d1Eligible.map((r) => r.d1_retained)), sum(d1Eligible.map((r) => r.installs))))
  const d3 = unk(safe(sum(d3Eligible.map((r) => r.d3_retained)), sum(d3Eligible.map((r) => r.installs))))
  const d7 = unk(safe(sum(d7Eligible.map((r) => r.d7_retained)), sum(d7Eligible.map((r) => r.installs))))

  const payers = sum(cohortRows.map((r) => r.payers))
  const repeatPayers = sum(cohortRows.map((r) => r.repeat_payers))
  const revenue = sum(cohortRows.map((r) => sum(r.revenue_by_age)))
  const refunds = sum(cohortRows.map((r) => r.refunds))
  const revenueD0 = sum(cohortRows.map((r) => r.revenue_by_age[0] ?? 0))
  const revenueD7 = sum(cohortRows.map((r) => sum(r.revenue_by_age.slice(0, 8))))
  const topPayer = Math.max(0, ...cohortRows.map((r) => r.top_payer_revenue))

  // Marginal CPI: trailing 7d CPI vs window CPI (scale elasticity, spec §6)
  const recentCut = isoDaysAgo(7)
  const recentSpend = sum(spendRows.filter((r) => r.date >= recentCut).map((r) => r.spend))
  const recentInstalls = sum(cohortRows.filter((r) => r.cohort_date >= recentCut).map((r) => r.installs))
  const cpi = cpiOf(spend, installs)
  const recentCpi = safe(recentSpend, recentInstalls)
  const marginalRatio = cpi > 0 && recentCpi > 0 ? recentCpi / cpi : 1

  // Frequency proxy + saturation
  const reachProxy = impressions / Math.max(1, campaign.geos.length * 10_000_000)
  const frequency = Math.min(9, 1.2 + reachProxy * 6)
  const saturation = Math.min(1, Math.max(0, (frequency - 1.5) / 5 + (marginalRatio - 1) * 0.9))

  // Weighted creative fatigue across the campaign's spend
  const creativeMetrics = campaign.creative_ids.map((cid) => computeCreativeMetrics(ds, cid, t))
  const crSpendMap = new Map<string, number>()
  for (const r of spendRows) crSpendMap.set(r.creative_asset_id, (crSpendMap.get(r.creative_asset_id) ?? 0) + r.spend)
  const fatigueScore = (() => {
    let wsum = 0, acc = 0
    for (const cm of creativeMetrics) {
      const w = crSpendMap.get(cm.creative_asset_id) ?? 0
      wsum += w
      acc += cm.fatigue * w
    }
    return wsum > 0 ? acc / wsum : 0
  })()

  const activationRate = unk(safe(activated, installs))
  const payerRate = safe(payers, installs)
  const depthL3 = unk(installs > 0
    ? sum(cohortRows.map((r) => r.depth_l3_share * r.installs)) / installs
    : 0)

  // Quality score 0-100 (spec §8): activation, retention, depth, engagement blend
  const qualityScore = !retentionMeasured ? NaN : Math.round(
    100 * Math.min(1,
      0.3 * Math.min(1, activationRate / 0.7) +
      0.3 * Math.min(1, d1 / 0.42) +
      0.2 * Math.min(1, depthL3 / 0.35) +
      0.2 * Math.min(1, safe(meaningful, activated) / 0.85),
    ),
  )

  // Revenue volatility: cv of daily revenue
  const revByDate = new Map<string, number>()
  for (const r of cohortRows) revByDate.set(r.cohort_date, (revByDate.get(r.cohort_date) ?? 0) + sum(r.revenue_by_age))
  const revVals = [...revByDate.values()]
  const mean = revVals.length ? sum(revVals) / revVals.length : 0
  const volatility = mean > 0
    ? Math.sqrt(sum(revVals.map((v) => (v - mean) ** 2)) / revVals.length) / mean
    : 0

  // Forecast (spec §19): fit decay on the per-cohort AVERAGE curve (sums would
  // bias the tail down, since old ages only have old cohorts contributing),
  // then project each cohort to D30 by its own maturity.
  const aggCurve: number[] = []
  const aggCount: number[] = []
  for (const r of cohortRows) r.revenue_by_age.forEach((v, a) => {
    aggCurve[a] = (aggCurve[a] ?? 0) + v
    aggCount[a] = (aggCount[a] ?? 0) + 1
  })
  const avgCurve = aggCurve.map((v, a) => v / Math.max(1, aggCount[a]))
  const fit = fitRevenueCurve(avgCurve)
  const decayW = Array.from({ length: 31 }, (_, a) => Math.pow(a + 1, -fit.slope))
  const cumW = decayW.map(((s) => (w: number) => (s += w))(0))
  const projectedD30 = sum(cohortRows.map((r) => {
    const obs = sum(r.revenue_by_age) - (r.refunds ?? 0)
    const ageIdx = Math.min(30, Math.max(0, r.revenue_by_age.length - 1))
    return obs * (cumW[30] / cumW[ageIdx])
  }))
  const avgAge = cohortRows.length
    ? sum(cohortRows.map((r) => daysBetween(r.cohort_date, isoDaysAgo(0)))) / cohortRows.length
    : 0
  const ltv = forecastD30Revenue(projectedD30, { ...fit, d30Multiple: 1 }, payers, avgAge)
  const predictedRoas = {
    low: safe(ltv.low, spend),
    base: safe(ltv.base, spend),
    high: safe(ltv.high, spend),
  }

  // Confidence (spec §19 factors)
  const factors: ConfidenceFactor[] = []
  if (installs < t.min_installs_for_decision) factors.push({ factor: 'Sample size', effect: 'down', note: `${installs} installs < ${t.min_installs_for_decision} required` })
  else factors.push({ factor: 'Sample size', effect: 'up', note: `${installs} installs — adequate` })
  if (spend < t.min_spend_for_decision) factors.push({ factor: 'Spend threshold', effect: 'down', note: `$${Math.round(spend)} spend below $${t.min_spend_for_decision} floor` })
  if (payers < t.min_payers_for_ltv) factors.push({ factor: 'Payer count', effect: 'down', note: `${payers} payers — LTV forecast is thin` })
  else factors.push({ factor: 'Payer count', effect: 'up', note: `${payers} payers support the monetization curve` })
  const topPayerShare = safe(topPayer, revenue)
  if (topPayerShare > t.max_top_payer_share) factors.push({ factor: 'Revenue concentration', effect: 'down', note: `Top payer is ${(topPayerShare * 100).toFixed(0)}% of revenue` })
  const campMatchRate = safe(matched, installs)
  if (campMatchRate < t.min_match_rate) factors.push({ factor: 'Attribution quality', effect: 'down', note: `Match rate ${(campMatchRate * 100).toFixed(0)}% below ${(t.min_match_rate * 100).toFixed(0)}%` })
  if (avgAge < 5) factors.push({ factor: 'Cohort maturity', effect: 'down', note: `Cohorts average ${avgAge.toFixed(1)} days old — curve immature` })
  const downs = factors.filter((f) => f.effect === 'down').length
  const confidence: ConfidenceLevel = downs === 0 ? 'high' : downs <= 2 ? 'medium' : 'low'

  const channelSource = campaign.channel_id as SourceId
  const gate = gateForCampaign(channelSource, ds.connectors, campMatchRate, t)

  // Daily series for charts
  const daily: CampaignDaily[] = []
  const byDate = new Map<string, { spend: number; installs: number; clicks: number; impressions: number; rev0: number; d1r: number | null }>()
  for (const r of allSpendRows) {
    const e = byDate.get(r.date) ?? { spend: 0, installs: 0, clicks: 0, impressions: 0, rev0: 0, d1r: null }
    e.spend += r.spend; e.clicks += r.clicks; e.impressions += r.impressions
    byDate.set(r.date, e)
  }
  for (const r of ds.cohorts.filter((c) => c.campaign_id === campaignId)) {
    const e = byDate.get(r.cohort_date)
    if (e) {
      e.installs += r.installs
      e.rev0 += r.revenue_by_age[0] ?? 0
      e.d1r = r.installs > 0 ? r.d1_retained / r.installs : null
    }
  }
  const dates = [...byDate.keys()].sort()
  for (const date of dates) {
    const e = byDate.get(date)!
    daily.push({
      date,
      spend: e.spend,
      installs: e.installs,
      cpi: cpiOf(e.spend, e.installs),
      ctr: safe(e.clicks, e.impressions),
      revenue_d0: e.rev0,
      d1: e.d1r,
    })
  }

  const half = Math.floor(daily.length / 2)
  const spendTrend = half > 0
    ? safe(sum(daily.slice(half).map((r) => r.spend)), sum(daily.slice(0, half).map((r) => r.spend))) - 1
    : 0
  const cpiFirst = safe(sum(daily.slice(0, half).map((d) => d.spend)), sum(daily.slice(0, half).map((d) => d.installs)))
  const cpiLast = safe(sum(daily.slice(half).map((d) => d.spend)), sum(daily.slice(half).map((d) => d.installs)))
  const cpiTrend = cpiFirst > 0 ? cpiLast / cpiFirst - 1 : 0

  const headroom: CampaignMetrics['scale_headroom'] =
    saturation > 0.6 || marginalRatio > t.max_marginal_cpi_ratio ? 'low'
      : saturation > 0.35 || marginalRatio > 1.15 ? 'medium' : 'high'

  return {
    campaign_id: campaignId,
    window_days: windowDays,
    spend, impressions, clicks, installs,
    network_installs: networkInstalls,
    ctr: safe(clicks, impressions),
    cvr_click_install: safe(installs, clicks),
    cpm: safe(spend * 1000, impressions),
    cpc: safe(spend, clicks),
    cpi,
    ecpi: safe(spend, Math.max(installs, 1)),
    cost_per_activated: activated > 0 ? spend / activated : NaN,
    activation_rate: activationRate,
    meaningful_session_rate: unk(safe(meaningful, installs)),
    d1, d3, d7,
    sessions_per_user: cohortRows.length ? sum(cohortRows.map((r) => r.sessions_per_user * r.installs)) / Math.max(installs, 1) : 0,
    depth_l3_share: depthL3,
    payer_rate: payerRate,
    repeat_payer_rate: safe(repeatPayers, payers),
    arpu: unkRev(safe(revenue, installs)),
    arppu: unkRev(safe(revenue, payers)),
    revenue,
    refund_rate: unkRev(safe(refunds, revenue)),
    roas_d0: unkRev(safe(revenueD0, spend)),
    roas_d7: unkRev(safe(revenueD7, spend)),
    top_payer_share: topPayerShare,
    revenue_volatility: volatility,
    marginal_cpi_ratio: marginalRatio,
    frequency,
    saturation_index: saturation,
    scale_headroom: headroom,
    fatigue_score: fatigueScore,
    quality_score: qualityScore,
    spend_trend: spendTrend,
    cpi_trend: cpiTrend,
    age_days: daysBetween(campaign.start_date, isoDaysAgo(0)),
    match_rate: campMatchRate,
    predicted_d30_roas: revenueMeasured ? predictedRoas : { low: NaN, base: NaN, high: NaN },
    ltv_d30: revenueMeasured ? ltv : { ...ltv, low: NaN, base: NaN, high: NaN },
    confidence,
    confidence_factors: factors,
    quality_gate: gate,
    daily,
  }
}

export function computeCreativeMetrics(ds: Dataset, creativeId: string, _t: Thresholds): CreativeMetrics {
  const asset = ds.creatives.find((c) => c.creative_asset_id === creativeId)!
  const rows = ds.spend.filter((r) => r.creative_asset_id === creativeId)
  const spend = sum(rows.map((r) => r.spend))
  const impressions = sum(rows.map((r) => r.impressions))
  const clicks = sum(rows.map((r) => r.clicks))
  const installs = Math.round(sum(rows.map((r) => r.network_installs)))

  // CTR decay: trailing week vs first week of activity
  const dates = [...new Set(rows.map((r) => r.date))].sort()
  const firstWeek = new Set(dates.slice(0, 7))
  const lastWeek = new Set(dates.slice(-7))
  const ctrOf = (set: Set<string>) => {
    const rs = rows.filter((r) => set.has(r.date))
    return safe(sum(rs.map((r) => r.clicks)), sum(rs.map((r) => r.impressions)))
  }
  const windowCpi = (set: Set<string>) => {
    const rs = rows.filter((r) => set.has(r.date))
    return safe(sum(rs.map((r) => r.spend)), sum(rs.map((r) => r.network_installs)))
  }
  const ctrEarly = ctrOf(firstWeek)
  const ctrLate = ctrOf(lastWeek)
  const ctrDecay = ctrEarly > 0 ? ctrLate / ctrEarly - 1 : 0
  const cpiEarly = windowCpi(firstWeek)
  const cpiLate = windowCpi(lastWeek)
  const cpiDrift = cpiEarly > 0 ? cpiLate / cpiEarly - 1 : 0

  const ageDays = daysBetween(asset.launch_date, isoDaysAgo(0))
  // Fatigue 0-100: decay + drift + age + spend saturation (spec §10)
  const fatigue = Math.round(Math.min(100, Math.max(0,
    Math.max(0, -ctrDecay) * 130 +
    Math.max(0, cpiDrift) * 90 +
    Math.min(1, ageDays / 90) * 18 +
    Math.min(1, spend / 40000) * 12,
  )))

  // Quality metrics joined from cohorts of campaigns dominated by this creative —
  // approximation flagged at the bridge level (creative-level attribution join)
  const campaignIds = [...new Set(rows.map((r) => r.campaign_id))]
  const cohortRows = ds.cohorts.filter((c) => campaignIds.includes(c.campaign_id))
  const cInstalls = sum(cohortRows.map((r) => r.installs))
  const activation = safe(sum(cohortRows.map((r) => r.activated)), cInstalls)
  const d1 = safe(sum(cohortRows.map((r) => r.d1_retained)), cInstalls)
  const revenue7 = sum(cohortRows.map((r) => sum(r.revenue_by_age.slice(0, 8))))
  const campSpend = sum(ds.spend.filter((r) => campaignIds.includes(r.campaign_id)).map((r) => r.spend))

  // Geo fit from campaign geos weighted by spend
  const geoAgg = new Map<string, { spend: number; installs: number; d1w: number }>()
  for (const cid of campaignIds) {
    const camp = ds.campaigns.find((c) => c.campaign_id === cid)!
    const cSpend = sum(rows.filter((r) => r.campaign_id === cid).map((r) => r.spend))
    const cCoh = ds.cohorts.filter((c) => c.campaign_id === cid)
    const ci = sum(cCoh.map((r) => r.installs))
    const cd1 = safe(sum(cCoh.map((r) => r.d1_retained)), ci)
    for (const geo of camp.geos) {
      const e = geoAgg.get(geo) ?? { spend: 0, installs: 0, d1w: 0 }
      e.spend += cSpend / camp.geos.length
      e.installs += ci / camp.geos.length
      e.d1w = cd1
      geoAgg.set(geo, e)
    }
  }

  return {
    creative_asset_id: creativeId,
    spend, impressions, clicks, installs,
    ctr: safe(clicks, impressions),
    cpi: cpiOf(spend, installs),
    activation_rate: activation,
    d1,
    roas_d7: safe(revenue7, campSpend),
    fatigue,
    ctr_decay: ctrDecay,
    cpi_drift: cpiDrift,
    age_days: ageDays,
    spend_since_launch: spend,
    campaigns: campaignIds,
    geo_fit: [...geoAgg.entries()]
      .map(([geo, e]) => ({ geo, cpi: cpiOf(e.spend, e.installs), d1: e.d1w, spend: e.spend }))
      .sort((a, b) => b.spend - a.spend),
  }
}
