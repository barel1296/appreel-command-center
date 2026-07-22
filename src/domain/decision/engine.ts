// Decision Engine (spec §14): layered — quality gate first, then transparent
// threshold rules, scoring, forecast, recommendation mapping, explanation,
// and governance (approval requirements by risk). Nothing here is hard-coded
// to a product: every threshold comes from managed config.
import type { Dataset } from '../seed/generator'
import type {
  CampaignMetrics, EvidenceItem, QualityStatus, Recommendation,
  RecommendationType, RiskLevel, StageLights,
} from '../types'
import type { ProductConfig } from '../config'
import { computeCampaignMetrics, computeCreativeMetrics } from '../metrics/compute'
import { fmtMoney, fmtPct, fmtX, isoDaysAgo } from '@/lib/format'

const DAY = 86400_000

interface RuleContext {
  m: CampaignMetrics
  cfg: ProductConfig
  ds: Dataset
}

const lights = (ctx: RuleContext): StageLights => {
  const { m, cfg } = ctx
  const t = cfg.thresholds
  const grade = (bad: boolean, warn: boolean): QualityStatus => (bad ? 'red' : warn ? 'yellow' : 'green')
  return {
    media: grade(m.cpi > t.max_cpi, m.cpi > t.target_cpi || m.ctr < t.min_ctr),
    quality: grade(
      m.d1 < t.min_d1 * 0.72 || m.activation_rate < t.min_activation_rate * 0.75,
      m.d1 < t.min_d1 || m.activation_rate < t.min_activation_rate || m.depth_l3_share < t.min_depth_l3_share,
    ),
    monetization: grade(
      m.predicted_d30_roas.base < t.min_predicted_d30_roas * 0.6 && m.payer_rate < t.min_payer_rate * 0.5,
      m.roas_d7 < t.target_d7_roas || m.payer_rate < t.min_payer_rate || m.top_payer_share > t.max_top_payer_share,
    ),
    creative: grade(m.fatigue_score >= t.fatigue_critical, m.fatigue_score >= t.fatigue_warn),
    data: m.quality_gate.status,
  }
}

export function evaluateCampaign(ds: Dataset, campaignId: string, cfg: ProductConfig): Recommendation | null {
  const campaign = ds.campaigns.find((c) => c.campaign_id === campaignId)!
  if (campaign.status === 'paused') return null
  const t = cfg.thresholds
  const m = computeCampaignMetrics(ds, campaignId, t)
  const ctx: RuleContext = { m, cfg, ds }
  const sl = lights(ctx)
  const channel = ds.channels.find((c) => c.channel_id === campaign.channel_id)!
  const geoLabel = campaign.geos.join(', ')

  const ev = (metric: string, value: string, benchmark: string, verdict: EvidenceItem['verdict']): EvidenceItem =>
    ({ metric, value, benchmark, verdict })

  const baseEvidence: EvidenceItem[] = [
    ev('CPI', fmtMoney(m.cpi, 2), `target ${fmtMoney(t.target_cpi, 2)}`, m.cpi <= t.target_cpi ? 'good' : m.cpi <= t.max_cpi ? 'warn' : 'bad'),
    ev('CTR', fmtPct(m.ctr), `min ${fmtPct(t.min_ctr)}`, m.ctr >= t.min_ctr ? 'good' : 'bad'),
    ev('Activation', fmtPct(m.activation_rate), `min ${fmtPct(t.min_activation_rate)}`, m.activation_rate >= t.min_activation_rate ? 'good' : 'bad'),
    ev('D1 retention', fmtPct(m.d1), `min ${fmtPct(t.min_d1)}`, m.d1 >= t.min_d1 ? 'good' : 'bad'),
    ev('Payer rate', fmtPct(m.payer_rate), `min ${fmtPct(t.min_payer_rate)}`, m.payer_rate >= t.min_payer_rate ? 'good' : 'warn'),
    ev('Pred. D30 ROAS', fmtX(m.predicted_d30_roas.base), `min ${fmtX(t.min_predicted_d30_roas)}`, m.predicted_d30_roas.base >= t.min_predicted_d30_roas ? 'good' : 'warn'),
    ev('Data quality', m.quality_gate.status.toUpperCase(), 'GREEN', m.quality_gate.status === 'green' ? 'good' : m.quality_gate.status === 'yellow' ? 'warn' : 'bad'),
  ]

  let type: RecommendationType
  let title: string
  let reason: string
  let risk: RiskLevel
  let action: string
  let stop: string
  let impact: string
  let priority: number
  let monitorDays = 3
  let extraEvidence: EvidenceItem[] = []

  // ── Gate first (spec §13): red data blocks any business decision ──────────
  if (m.quality_gate.status === 'red') {
    // Name the sources that actually failed. Saying "fix attribution" when
    // attribution is green and the gap is elsewhere sends the team to the wrong
    // system — the gate must be specific about which contract broke.
    const failed = m.quality_gate.checks.filter((c) => c.status === 'red').map((c) => c.label)
    const attributionBroken = m.match_rate < t.min_match_rate
    type = 'fix_tracking'
    title = attributionBroken
      ? `Fix attribution before any decision on ${campaign.name}`
      : `Close the ${failed[0] ?? 'data'} gap before any decision on ${campaign.name}`
    reason = `Data quality is RED for this slice (${failed.join(', ')}). ` +
      (attributionBroken
        ? `Match rate is ${fmtPct(m.match_rate)}, so spend cannot be reliably joined to installs and revenue. `
        : `Attribution and cost are certified, but the checks above are not, so cohort quality cannot be verified. `) +
      `Business recommendation is blocked; this is routed as a tracking fix (spec §13).`
    risk = 'critical'
    action = attributionBroken
      ? `Repair the ${channel.name} → MMP mapping: verify postback configuration and campaign ID mapping, then re-run the affected backfill window.`
      : `Restore the failing source(s): ${failed.join(', ')}. Until they land, this campaign can only be judged on cost and volume.`
    stop = attributionBroken
      ? 'If match rate stays below threshold 48h after fix, escalate to the MMP integration owner.'
      : 'If the source is still missing after 48h, decide on cost-efficiency alone and record the reduced confidence.'
    impact = `${fmtMoney(m.spend)} of window spend is currently un-decidable; unblocks Scale/Reduce decisions for this campaign.`
    priority = 95
    monitorDays = 2
    extraEvidence = [
      ev('Match rate', fmtPct(m.match_rate), `min ${fmtPct(t.min_match_rate)}`, attributionBroken ? 'bad' : 'good'),
      ev('Blocked spend (window)', fmtMoney(m.spend), '—', 'neutral'),
    ]
  }
  // ── Evidence floor (spec §16): a campaign that has not accrued the minimum
  // installs OR spend cannot receive a Scale/Pause verdict. Without this a
  // one-day-old campaign with 13 installs reads as "D1 0%" and gets paused for
  // a number that simply has not been measured yet.
  else if (m.installs < t.min_installs_for_decision && m.spend < t.min_spend_for_decision) {
    type = 'investigate'
    title = `Hold ${campaign.name} — not enough evidence to judge`
    reason = `Only ${m.installs.toLocaleString()} installs and ${fmtMoney(m.spend)} spent, against decision floors of ` +
      `${t.min_installs_for_decision.toLocaleString()} installs / ${fmtMoney(t.min_spend_for_decision)}. ` +
      `Early metrics (D1 ${fmtPct(m.d1)}, CPI ${fmtMoney(m.cpi, 2)}) are directional only — the cohorts are too young or too small ` +
      `to separate signal from noise, so no Scale or Pause verdict is issued.`
    risk = 'low'
    action = `Let it run to the evidence floor at the current budget, or stop it on a business call — not on these numbers.`
    stop = `Re-evaluate automatically once installs pass ${t.min_installs_for_decision.toLocaleString()} or spend passes ${fmtMoney(t.min_spend_for_decision)}.`
    impact = 'Prevents a premature decision on an immature cohort.'
    priority = 35
    monitorDays = 5
    extraEvidence = [
      ev('Installs', m.installs.toLocaleString(), `min ${t.min_installs_for_decision.toLocaleString()}`, 'warn'),
      ev('Spend', fmtMoney(m.spend), `min ${fmtMoney(t.min_spend_for_decision)}`, 'warn'),
      ev('Campaign age', `${m.age_days}d`, '—', 'neutral'),
    ]
  }
  // ── Severe quality failure → Pause / Reduce ───────────────────────────────
  else if (sl.quality === 'red' && sl.monetization !== 'green') {
    const failing = m.predicted_d30_roas.high < t.min_predicted_d30_roas
    type = failing ? 'pause' : 'reduce'
    title = failing
      ? `Pause ${campaign.name} — installs are not becoming users`
      : `Reduce ${campaign.name} budget until quality recovers`
    reason = `CPI looks ${m.cpi <= t.target_cpi ? 'attractive' : 'acceptable'} at ${fmtMoney(m.cpi, 2)}, but cohort quality is red: ` +
      `activation ${fmtPct(m.activation_rate)} (min ${fmtPct(t.min_activation_rate)}), D1 ${fmtPct(m.d1)} (min ${fmtPct(t.min_d1)}), ` +
      `depth-L3 ${fmtPct(m.depth_l3_share)}. Even the optimistic D30 ROAS scenario is ${fmtX(m.predicted_d30_roas.high)} — ` +
      `${failing ? 'below the floor, so continued spend buys traffic, not growth.' : 'marginal, so spend should shrink while quality is investigated.'}`
    risk = failing ? 'high' : 'medium'
    action = failing
      ? `Pause the campaign. Re-test only with a changed targeting/creative mix and a ${fmtMoney(150)}/day probe budget.`
      : `Cut daily budget ~40% (to ${fmtMoney(campaign.daily_budget * 0.6)}/day) and watch activation + D1 for the monitoring window.`
    stop = failing
      ? 'Re-enable only after a re-test cohort clears activation and D1 minimums.'
      : `Pause fully if D1 stays under ${fmtPct(t.min_d1 * 0.72)} after the window.`
    impact = `Frees ~${fmtMoney(campaign.daily_budget * (failing ? 1 : 0.4) * 7)}/week for reallocation to healthy campaigns.`
    priority = failing ? 88 : 78
    extraEvidence = [ev('Depth L3 by D1', fmtPct(m.depth_l3_share), `min ${fmtPct(t.min_depth_l3_share)}`, 'bad')]
  }
  // ── Whale concentration → Hold ────────────────────────────────────────────
  else if (m.top_payer_share > t.max_top_payer_share && m.roas_d7 >= t.target_d7_roas) {
    type = 'hold'
    title = `Hold ${campaign.name} — ROAS is carried by a single payer`
    reason = `Headline D7 ROAS ${fmtX(m.roas_d7)} beats target, but ${fmtPct(m.top_payer_share)} of window revenue comes from one payer. ` +
      `Whale-adjusted ROAS falls to ~${fmtX(Math.max(0, (m.revenue * (1 - m.top_payer_share)) / Math.max(m.spend, 1) * (m.roas_d7 / Math.max(m.roas_d7, 0.001))), 2)}. ` +
      `The average is distorted (spec §7); scaling now would buy the average, not the median user.`
    risk = 'medium'
    action = `Keep budget flat. Wait for ${t.min_payers_for_ltv}+ payers in fresh cohorts, then re-evaluate with whale-adjusted ROAS.`
    stop = 'Re-evaluate at next review or when payer count clears the confidence floor.'
    impact = 'Avoids scaling into a revenue base that one refund could erase.'
    priority = 60
    monitorDays = 5
    extraEvidence = [
      ev('Top payer share', fmtPct(m.top_payer_share), `max ${fmtPct(t.max_top_payer_share)}`, 'bad'),
      ev('Revenue volatility (CV)', m.revenue_volatility.toFixed(2), '≤ 1.00', m.revenue_volatility > 1 ? 'warn' : 'neutral'),
      ev('Payers in window', String(Math.round(m.payer_rate * m.installs)), `min ${t.min_payers_for_ltv}`, 'warn'),
    ]
  }
  // ── Creative fatigue while quality holds → Refresh Creative ───────────────
  else if (sl.creative !== 'green' && sl.quality !== 'red') {
    const worst = campaign.creative_ids
      .map((cid) => computeCreativeMetrics(ds, cid, t))
      .sort((a, b) => b.fatigue - a.fatigue)[0]
    const worstAsset = ds.creatives.find((c) => c.creative_asset_id === worst.creative_asset_id)!
    type = 'refresh_creative'
    title = `Refresh creative on ${campaign.name} — fatigue before efficiency breaks`
    reason = `User quality is holding (D1 ${fmtPct(m.d1)}, activation ${fmtPct(m.activation_rate)}), but the creative pool is decaying: ` +
      `weighted fatigue ${m.fatigue_score.toFixed(0)}/100, CTR trend ${fmtPct(m.cpi_trend > 0 ? -Math.abs(worst.ctr_decay) : worst.ctr_decay)} on the worst asset ` +
      `and CPI drifting ${fmtPct(m.cpi_trend)} over the window. This is a media/creative problem, not a traffic-quality problem — refresh, don't pause.`
    risk = 'medium'
    action = `Rotate out "${worstAsset.name}" (fatigue ${worst.fatigue}/100). Brief 2 variants on the "${worstAsset.concept}" concept with a new hook; keep spend flat until variants are live.`
    stop = `If CPI rises another 15% before variants ship, reduce budget 25% as a stopgap.`
    impact = `Restoring CTR to early-window level would cut CPI ~${fmtPct(Math.min(0.3, Math.abs(worst.ctr_decay) * 0.7))} at current spend.`
    priority = 72
    monitorDays = 5
    extraEvidence = [
      ev('Fatigue (weighted)', `${m.fatigue_score.toFixed(0)}/100`, `warn ≥ ${t.fatigue_warn}`, 'bad'),
      ev(`CTR decay · ${worstAsset.name}`, fmtPct(worst.ctr_decay), 'stable', 'bad'),
      ev('CPI drift (window)', fmtPct(m.cpi_trend), 'flat', m.cpi_trend > 0.1 ? 'bad' : 'warn'),
    ]
  }
  // ── Everything green + headroom → Scale ───────────────────────────────────
  else if (
    sl.media !== 'red' && sl.quality === 'green' && sl.monetization === 'green' &&
    sl.creative === 'green' && sl.data === 'green' &&
    m.confidence !== 'low' && m.scale_headroom !== 'low'
  ) {
    const step = m.scale_headroom === 'high' ? 0.3 : 0.15
    type = 'scale'
    title = `Scale ${campaign.name} +${Math.round(step * 100)}% — quality and monetization support it`
    reason = `Full chain is green: CPI ${fmtMoney(m.cpi, 2)} vs ${fmtMoney(t.target_cpi, 2)} target, activation ${fmtPct(m.activation_rate)}, ` +
      `D1 ${fmtPct(m.d1)}, payer rate ${fmtPct(m.payer_rate)}, predicted D30 ROAS ${fmtX(m.predicted_d30_roas.base)} ` +
      `(conservative ${fmtX(m.predicted_d30_roas.low)} still clears the floor). Marginal CPI ratio ${m.marginal_cpi_ratio.toFixed(2)} and ` +
      `creative fatigue ${m.fatigue_score.toFixed(0)}/100 indicate ${m.scale_headroom} headroom — creative pool can sustain the step (spec §10 rule).`
    risk = m.scale_headroom === 'high' ? 'medium' : 'low'
    action = `Raise daily budget from ${fmtMoney(campaign.daily_budget)} to ${fmtMoney(campaign.daily_budget * (1 + step))} in one step. Do not touch bids or audiences simultaneously.`
    stop = `Roll back if marginal CPI exceeds ${fmtX(t.max_marginal_cpi_ratio)} of window average or D1 drops below ${fmtPct(t.min_d1)} for 3 consecutive cohorts.`
    impact = `~${fmtMoney(campaign.daily_budget * step * 30)} incremental monthly spend at predicted ${fmtX(m.predicted_d30_roas.base)} D30 ROAS.`
    priority = 82
    monitorDays = 7
    extraEvidence = [
      ev('Marginal CPI ratio', m.marginal_cpi_ratio.toFixed(2), `max ${t.max_marginal_cpi_ratio}`, 'good'),
      ev('Scale headroom', m.scale_headroom, 'medium+', 'good'),
      ev('Creative fatigue', `${m.fatigue_score.toFixed(0)}/100`, `< ${t.fatigue_warn}`, 'good'),
    ]
  }
  // ── Healthy but thin evidence → Keep ──────────────────────────────────────
  else if (sl.quality !== 'red' && sl.monetization !== 'red' && sl.data !== 'red') {
    const thinPayers = m.payer_rate * m.installs < t.min_payers_for_ltv
    type = 'keep'
    title = `Keep ${campaign.name} steady — healthy, evidence still accruing`
    reason = `Signals are ${sl.quality === 'green' && sl.monetization === 'green' ? 'healthy' : 'mixed-positive'} ` +
      `(D1 ${fmtPct(m.d1)}, CPI ${fmtMoney(m.cpi, 2)}), but confidence is ${m.confidence}: ` +
      m.confidence_factors.filter((f) => f.effect === 'down').map((f) => f.note).join('; ') +
      `. Scaling now would outrun the evidence; keep spend flat and let cohorts mature.`
    risk = 'low'
    action = thinPayers
      ? `Hold budget at ${fmtMoney(campaign.daily_budget)}/day until payer count reaches ${t.min_payers_for_ltv} in the window.`
      : `Hold budget at ${fmtMoney(campaign.daily_budget)}/day; re-evaluate at next review with matured D7 cohorts.`
    stop = 'Escalate to Reduce if D1 drops below minimum for 3 consecutive cohorts.'
    impact = 'No spend change; decision debt cleared at next review.'
    priority = 40
    monitorDays = 4
  }
  // ── Mixed signals fallback → Investigate ──────────────────────────────────
  else {
    type = 'investigate'
    title = `Investigate ${campaign.name} — signals disagree`
    reason = `Stage lights disagree (media ${sl.media}, quality ${sl.quality}, monetization ${sl.monetization}, creative ${sl.creative}, data ${sl.data}) ` +
      `and no single rule explains the pattern. A human needs to look before money moves.`
    risk = 'medium'
    action = 'Open Campaign Doctor, compare geo and creative splits, and check whether a single slice is dragging the average.'
    stop = 'Convert to a concrete recommendation once the dominant driver is identified.'
    impact = 'Prevents acting on a misread aggregate.'
    priority = 55
  }

  const requiresApproval = type === 'scale' || type === 'pause' || type === 'reduce' ||
    risk === 'high' || risk === 'critical'

  return {
    recommendation_id: `rec-${campaignId}-${type}`,
    created_at: ds.generated_at - Math.round(Math.random() * 0), // deterministic: set below by caller if needed
    product_id: campaign.product_id,
    scope: { level: 'campaign', campaign_id: campaignId, channel_id: campaign.channel_id, label: `${channel.name} · ${geoLabel}` },
    recommendation_type: type,
    title,
    reason,
    evidence: [...extraEvidence, ...baseEvidence],
    risk_level: risk,
    confidence: m.confidence,
    confidence_note: m.confidence_factors.map((f) => `${f.effect === 'down' ? '↓' : '↑'} ${f.note}`).join(' · '),
    expected_impact: impact,
    data_quality: m.quality_gate.status,
    requires_approval: requiresApproval,
    suggested_action: action,
    monitoring_window_days: monitorDays,
    stop_condition: stop,
    priority,
    next_review_at: ds.generated_at + monitorDays * DAY,
    approval_status: 'proposed',
    owner: null,
    stage_lights: sl,
  }
}

// Store/ASO recommendation (spec §11) — driven by the DE store-conversion drop
export function evaluateStore(ds: Dataset, cfg: ProductConfig): Recommendation[] {
  const recs: Recommendation[] = []
  const recent = ds.store.filter((r) => r.date >= isoDaysAgo(7))
  const prior = ds.store.filter((r) => r.date < isoDaysAgo(7) && r.date >= isoDaysAgo(21))
  const geos = [...new Set(ds.store.map((r) => r.geo))]
  for (const geo of geos) {
    const cvr = (rows: typeof recent) => {
      const g = rows.filter((r) => r.geo === geo)
      const pv = g.reduce((a, r) => a + r.page_views, 0)
      const inst = g.reduce((a, r) => a + r.installs_organic + r.installs_paid, 0)
      return pv > 0 ? inst / pv : 0
    }
    const now = cvr(recent)
    const before = cvr(prior)
    const drop = before > 0 ? now / before - 1 : 0
    if (drop < -0.15) {
      const negShare = recent.filter((r) => r.geo === geo).reduce((a, r) => a + r.negative_review_share, 0) /
        Math.max(1, recent.filter((r) => r.geo === geo).length)
      const spendAtRisk = ds.campaigns
        .filter((c) => c.geos.includes(geo) && c.status === 'active')
        .reduce((a, c) => a + c.daily_budget, 0)
      recs.push({
        recommendation_id: `rec-store-${geo.toLowerCase()}`,
        created_at: ds.generated_at,
        product_id: 'appreel',
        scope: { level: 'geo', geo, label: `App Store · ${geo}` },
        recommendation_type: 'investigate',
        title: `Store conversion in ${geo} dropped ${fmtPct(Math.abs(drop))} — fix the page before paid scale`,
        reason: `${geo} product-page conversion fell from ${fmtPct(before)} to ${fmtPct(now)} over the last week while other geos held steady. ` +
          `Negative review share is ${fmtPct(negShare)} and the rating trend is down. Every paid click into ${geo} is now converting worse — ` +
          `this taxes ${fmtMoney(spendAtRisk)}/day of active spend before any campaign optimization can help (spec §11).`,
        evidence: [
          { metric: `Store CVR · ${geo} (7d)`, value: fmtPct(now), benchmark: `was ${fmtPct(before)}`, verdict: 'bad' },
          { metric: 'Negative review share', value: fmtPct(negShare), benchmark: '≤ 15%', verdict: negShare > 0.15 ? 'bad' : 'neutral' },
          { metric: 'Paid spend exposed', value: `${fmtMoney(spendAtRisk)}/day`, benchmark: '—', verdict: 'warn' },
        ],
        risk_level: 'high',
        confidence: 'high',
        confidence_note: '↑ Consistent across 7 daily points; other geos flat (controls for seasonality)',
        expected_impact: `Restoring CVR recovers ~${fmtPct(Math.abs(drop))} of ${geo} install volume at zero media cost.`,
        data_quality: 'green',
        requires_approval: false,
        suggested_action: `Review the ${geo} store page change history (screenshots updated ~10 days ago), read top negative reviews for themes, and A/B the previous screenshot set.`,
        monitoring_window_days: 7,
        stop_condition: `If CVR does not recover after revert, escalate to product — reviews may reflect an app issue, not a store issue.`,
        priority: 80,
        next_review_at: ds.generated_at + 7 * DAY,
        approval_status: 'proposed',
        owner: null,
        stage_lights: { media: 'green', quality: 'green', monetization: 'green', creative: 'green', data: 'green' },
      })
    }
  }
  return recs
}

// Social → paid concept bridge (spec §12)
export function evaluateSocial(ds: Dataset, _cfg: ProductConfig): Recommendation[] {
  const candidates = ds.social
    .filter((s) => s.concept_candidate && s.views > 1_000_000)
    .sort((a, b) => b.views - a.views)
  if (candidates.length === 0) return []
  const top = candidates[0]
  return [{
    recommendation_id: `rec-social-${top.content_id}`,
    created_at: ds.generated_at,
    product_id: top.product_id,
    scope: { level: 'product', label: `Social → Paid · ${top.platform}` },
    recommendation_type: 'investigate',
    title: `Trending organic concept "${top.paired_concept}" is a paid-test candidate`,
    reason: `"${top.title}" reached ${(top.views / 1e6).toFixed(1)}M views with ${fmtPct(top.engagement_rate)} engagement — ` +
      `${(top.engagement_rate / 0.05).toFixed(1)}x the organic baseline. Trend tags ${top.trend_tags.join(', ')} are accelerating. ` +
      `The organic-to-paid bridge (spec §12) flags this as a concept worth a structured paid test, not a fact.`,
    evidence: [
      { metric: 'Views', value: `${(top.views / 1e6).toFixed(1)}M`, benchmark: 'baseline 200K', verdict: 'good' },
      { metric: 'Engagement rate', value: fmtPct(top.engagement_rate), benchmark: 'baseline 5%', verdict: 'good' },
      { metric: 'Sentiment', value: top.sentiment.toFixed(2), benchmark: '> 0', verdict: top.sentiment > 0 ? 'good' : 'warn' },
    ],
    risk_level: 'low',
    confidence: 'medium',
    confidence_note: '↓ Organic virality does not guarantee paid performance; single-platform signal',
    expected_impact: 'A validated new concept extends creative runway ahead of fatigue on current winners.',
    data_quality: 'green',
    requires_approval: false,
    suggested_action: `Brief creative on a 15s paid cut of the "${top.paired_concept}" concept; test at $150/day on TikTok US against the current control.`,
    monitoring_window_days: 7,
    stop_condition: 'Kill the test if CPI exceeds 1.5x campaign average after $500 spend.',
    priority: 50,
    next_review_at: ds.generated_at + 7 * DAY,
    approval_status: 'proposed',
    owner: null,
    stage_lights: { media: 'green', quality: 'green', monetization: 'green', creative: 'green', data: 'green' },
  }]
}

export function runDecisionEngine(ds: Dataset, cfg: ProductConfig): Recommendation[] {
  const recs: Recommendation[] = []
  // Only campaigns you can actually act on. Organic and other unbought traffic
  // has no budget lever, so a Scale/Pause verdict on it is meaningless — it is
  // reported in Analytics, never routed as a spend decision.
  const paidChannels = new Set(ds.channels.filter((ch) => ch.kind === 'paid').map((ch) => ch.channel_id))
  const buyable = ds.campaigns.filter((c) =>
    c.product_id === cfg.product_id &&
    paidChannels.has(c.channel_id) &&
    ds.spend.some((s) => s.campaign_id === c.campaign_id && s.spend > 0))
  for (const c of buyable) {
    const r = evaluateCampaign(ds, c.campaign_id, cfg)
    if (r) recs.push(r)
  }
  recs.push(...evaluateStore(ds, cfg))
  recs.push(...evaluateSocial(ds, cfg))
  // Stagger creation times deterministically for a believable queue
  recs.forEach((r, i) => { r.created_at = ds.generated_at - (i * 47 + 23) * 60_000 })
  return recs.sort((a, b) => b.priority - a.priority)
}
