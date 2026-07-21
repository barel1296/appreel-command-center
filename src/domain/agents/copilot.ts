// AI Agents layer (spec §15) — read-only, proposal-only. Each "agent" is a
// deterministic analyzer over certified metrics; every answer carries claim,
// evidence citations, confidence, limitations, and a next action. When the
// data cannot support an answer, the agent says so explicitly (no invention).
import type { Dataset } from '../seed/generator'
import type { CampaignMetrics, CopilotAnswer, Recommendation } from '../types'
import type { ProductConfig } from '../config'
import { computeCampaignMetrics, computeCreativeMetrics } from '../metrics/compute'
import { fmtMoney, fmtPct, fmtX } from '@/lib/format'

interface AgentContext {
  ds: Dataset
  cfg: ProductConfig
  recs: Recommendation[]
  metrics: Map<string, CampaignMetrics>
}

export function buildAgentContext(ds: Dataset, cfg: ProductConfig, recs: Recommendation[]): AgentContext {
  const metrics = new Map<string, CampaignMetrics>()
  for (const c of ds.campaigns) metrics.set(c.campaign_id, computeCampaignMetrics(ds, c.campaign_id, cfg.thresholds))
  return { ds, cfg, recs, metrics }
}

const activeMetrics = (ctx: AgentContext) =>
  ctx.ds.campaigns.filter((c) => c.status === 'active').map((c) => ({ c, m: ctx.metrics.get(c.campaign_id)! }))

export function answerQuestion(ctx: AgentContext, q: string): CopilotAnswer {
  const lq = q.toLowerCase()
  // Try to bind the question to a specific campaign first
  const named = ctx.ds.campaigns.find((c) =>
    lq.includes(c.name.toLowerCase()) ||
    c.name.toLowerCase().split('_').filter((w) => w.length > 2).some((w) => lq.includes(w.toLowerCase())) &&
    (lq.includes(c.channel_id) || c.geos.some((g) => lq.includes(g.toLowerCase()))),
  )

  if (/(level|stuck|funnel|difficulty|dau|active users|session|player|engagement|ad format|ecpm|rewarded|interstitial|banner|app version|\u05e9\u05dc\u05d1|\u05e0\u05ea\u05e7\u05e2|\u05de\u05e9\u05ea\u05de\u05e9\u05d9\u05dd \u05e4\u05e2\u05d9\u05dc\u05d9\u05dd)/.test(lq)) return productAgent(ctx, lq)
  if (/(scale|increase budget|spend more|ramp)/.test(lq)) return scaleAgent(ctx, named?.campaign_id)
  if (/(fatigue|creative|refresh|hook|concept|asset)/.test(lq)) return creativeAgent(ctx)
  if (/(track|attribution|match rate|data (quality|health)|freshness|pipeline|connector)/.test(lq)) return dataAgent(ctx)
  if (/(roas|ltv|revenue|monetiz|payer|whale|arpu)/.test(lq)) return monetizationAgent(ctx, named?.campaign_id)
  if (/(retention|quality|activation|cohort|d1|d7|churn)/.test(lq)) return cohortAgent(ctx, named?.campaign_id)
  if (/(store|aso|keyword|rating|review|organic)/.test(lq)) return asoAgent(ctx)
  if (/(social|trend|tiktok content|viral|ugc)/.test(lq)) return socialAgent(ctx)
  if (/(cpi|cpm|cpc|cost|expensive|cheap|media)/.test(lq)) return performanceAgent(ctx, named?.campaign_id)
  if (/(best|worst|top|summary|overview|today|priorit|focus|what should)/.test(lq)) return briefAgent(ctx)
  if (named) return performanceAgent(ctx, named.campaign_id)

  return {
    agent: 'Router',
    claim: 'Not enough signal in the question to route to a specialist agent.',
    evidence: [],
    confidence: 'low',
    limitations: 'I only answer from certified metrics in this workspace — acquisition, cohorts, monetization, creative, data health, ASO, and social. I do not have evidence for topics outside those domains and will not invent any.',
    next_action: 'Try asking about a campaign, channel, metric, or one of the suggested prompts below.',
  }
}

function scaleAgent(ctx: AgentContext, campaignId?: string): CopilotAnswer {
  const t = ctx.cfg.thresholds
  if (campaignId) {
    const m = ctx.metrics.get(campaignId)!
    const c = ctx.ds.campaigns.find((x) => x.campaign_id === campaignId)!
    const rec = ctx.recs.find((r) => r.scope.campaign_id === campaignId)
    const blockers: string[] = []
    if (m.quality_gate.status !== 'green') blockers.push(`data quality is ${m.quality_gate.status}`)
    if (m.d1 < t.min_d1) blockers.push(`D1 ${fmtPct(m.d1)} below ${fmtPct(t.min_d1)}`)
    if (m.fatigue_score >= t.fatigue_warn) blockers.push(`creative fatigue ${m.fatigue_score.toFixed(0)}/100`)
    if (m.scale_headroom === 'low') blockers.push('scale headroom is low (marginal CPI rising)')
    if (m.confidence === 'low') blockers.push('confidence is low (thin evidence)')
    return {
      agent: 'Performance Agent',
      claim: blockers.length === 0
        ? `${c.name} can support a controlled budget increase.`
        : `${c.name} should NOT be scaled right now: ${blockers.join('; ')}.`,
      evidence: [
        { label: 'Predicted D30 ROAS (base)', value: fmtX(m.predicted_d30_roas.base), source: 'Forecast layer' },
        { label: 'Marginal CPI ratio', value: m.marginal_cpi_ratio.toFixed(2), source: 'Semantic metrics, 7d vs 14d' },
        { label: 'Creative fatigue', value: `${m.fatigue_score.toFixed(0)}/100`, source: 'Creative intelligence' },
        { label: 'Data quality', value: m.quality_gate.status.toUpperCase(), source: 'Quality gate' },
      ],
      confidence: m.confidence,
      limitations: `Forecast band is ${fmtX(m.predicted_d30_roas.low)}–${fmtX(m.predicted_d30_roas.high)}; scale steps beyond +30% are outside historical evidence.`,
      next_action: rec ? `Review the queued "${rec.recommendation_type}" recommendation in the Decision Queue.` : 'Run Campaign Doctor for the full chain.',
    }
  }
  const ready = activeMetrics(ctx).filter(({ m }) =>
    m.quality_gate.status === 'green' && m.scale_headroom !== 'low' && m.confidence !== 'low' &&
    m.d1 >= t.min_d1 && m.predicted_d30_roas.base >= t.min_predicted_d30_roas)
  return {
    agent: 'Performance Agent',
    claim: ready.length > 0
      ? `${ready.length} campaign(s) currently clear every scale precondition: ${ready.map(({ c }) => c.name).join(', ')}.`
      : 'No campaign currently clears all scale preconditions (quality, monetization, creative capacity, data green, adequate confidence).',
    evidence: ready.slice(0, 3).map(({ c, m }) => ({
      label: c.name,
      value: `pred. D30 ROAS ${fmtX(m.predicted_d30_roas.base)}, headroom ${m.scale_headroom}`,
      source: 'Decision engine input builder',
    })),
    confidence: ready.length > 0 ? 'high' : 'medium',
    limitations: 'Scale readiness is re-evaluated on every data refresh; a red quality gate on any source can revoke it.',
    next_action: ready.length > 0 ? 'Open the Decision Queue to approve the Scale recommendation with its stop condition.' : 'Re-check after the next cohort maturation window.',
  }
}

function performanceAgent(ctx: AgentContext, campaignId?: string): CopilotAnswer {
  const rows = activeMetrics(ctx)
  if (campaignId) {
    const m = ctx.metrics.get(campaignId)!
    const c = ctx.ds.campaigns.find((x) => x.campaign_id === campaignId)!
    const t = ctx.cfg.thresholds
    return {
      agent: 'Performance Agent',
      claim: `${c.name}: CPI ${fmtMoney(m.cpi, 2)} (${m.cpi <= t.target_cpi ? 'within' : 'above'} target ${fmtMoney(t.target_cpi, 2)}), ` +
        `CTR ${fmtPct(m.ctr)}, CVR ${fmtPct(m.cvr_click_install)}, ${fmtMoney(m.spend)} spent in ${m.window_days}d for ${m.installs.toLocaleString()} attributed installs.`,
      evidence: [
        { label: 'CPM', value: fmtMoney(m.cpm, 2), source: 'fact_spend (window)' },
        { label: 'CPI trend', value: fmtPct(m.cpi_trend), source: 'Semantic metrics' },
        { label: 'Network vs attributed installs', value: `${m.network_installs.toLocaleString()} vs ${m.installs.toLocaleString()}`, source: 'Bridge — networks over-report' },
      ],
      confidence: m.confidence,
      limitations: 'Network-reported installs are shown for reference only; attribution (MMP) is the source of truth.',
      next_action: `Open Campaign Doctor → ${c.name} for the full media→user→money chain.`,
    }
  }
  const totalSpend = rows.reduce((a, { m }) => a + m.spend, 0)
  const wCpi = totalSpend / Math.max(1, rows.reduce((a, { m }) => a + m.installs, 0))
  const sorted = [...rows].sort((a, b) => a.m.cpi - b.m.cpi)
  return {
    agent: 'Performance Agent',
    claim: `Blended CPI is ${fmtMoney(wCpi, 2)} across ${fmtMoney(totalSpend)} of active 14-day spend. ` +
      `Cheapest: ${sorted[0].c.name} (${fmtMoney(sorted[0].m.cpi, 2)}); most expensive: ${sorted[sorted.length - 1].c.name} (${fmtMoney(sorted[sorted.length - 1].m.cpi, 2)}).`,
    evidence: sorted.slice(0, 3).map(({ c, m }) => ({ label: c.name, value: `CPI ${fmtMoney(m.cpi, 2)} · quality ${m.quality_score}/100`, source: 'Semantic metrics' })),
    confidence: 'high',
    limitations: 'Blended CPI mixes geos with different targets; check geo overrides before comparing campaigns directly.',
    next_action: 'Cheap CPI with low quality score is a trap — cross-check the quality column in the campaign table.',
  }
}

function cohortAgent(ctx: AgentContext, campaignId?: string): CopilotAnswer {
  const t = ctx.cfg.thresholds
  const rows = campaignId
    ? activeMetrics(ctx).filter(({ c }) => c.campaign_id === campaignId)
    : activeMetrics(ctx)
  const weak = rows.filter(({ m }) => m.d1 < t.min_d1 || m.activation_rate < t.min_activation_rate)
  return {
    agent: 'Cohort Quality Agent',
    claim: weak.length === 0
      ? 'All evaluated campaigns clear activation and D1 retention minimums.'
      : `${weak.length} campaign(s) are below quality minimums: ${weak.map(({ c, m }) => `${c.name} (D1 ${fmtPct(m.d1)}, activation ${fmtPct(m.activation_rate)})`).join('; ')}.`,
    evidence: rows.slice(0, 4).map(({ c, m }) => ({
      label: c.name,
      value: `activation ${fmtPct(m.activation_rate)} · D1 ${fmtPct(m.d1)} · D7 ${fmtPct(m.d7)} · depth-L3 ${fmtPct(m.depth_l3_share)}`,
      source: 'fact_cohort (point-in-time retention)',
    })),
    confidence: rows.every(({ m }) => m.installs >= t.min_installs_for_decision) ? 'high' : 'medium',
    limitations: 'D7 uses only cohorts ≥7 days old; young campaigns are excluded from that metric, not assumed.',
    next_action: weak.length > 0 ? 'The Decision Queue holds Reduce/Pause recommendations for the weak slices.' : 'No action needed; next review at the standard window.',
  }
}

function monetizationAgent(ctx: AgentContext, campaignId?: string): CopilotAnswer {
  const t = ctx.cfg.thresholds
  const rows = campaignId
    ? activeMetrics(ctx).filter(({ c }) => c.campaign_id === campaignId)
    : activeMetrics(ctx)
  const whales = rows.filter(({ m }) => m.top_payer_share > t.max_top_payer_share)
  const totRev = rows.reduce((a, { m }) => a + m.revenue, 0)
  const totSpend = rows.reduce((a, { m }) => a + m.spend, 0)
  return {
    agent: 'Monetization Agent',
    claim: `Net attributed revenue is ${fmtMoney(totRev)} against ${fmtMoney(totSpend)} spend (blended ROAS ${fmtX(totRev / Math.max(totSpend, 1))}).` +
      (whales.length > 0
        ? ` Warning: ${whales.map(({ c, m }) => `${c.name} has ${fmtPct(m.top_payer_share)} of revenue from a single payer`).join('; ')} — headline ROAS there is distorted.`
        : ' No dangerous revenue concentration detected.'),
    evidence: rows.slice(0, 4).map(({ c, m }) => ({
      label: c.name,
      value: `payer rate ${fmtPct(m.payer_rate)} · ARPPU ${fmtMoney(m.arppu, 2)} · pred. D30 ROAS ${fmtX(m.predicted_d30_roas.base)}`,
      source: 'fact_revenue via certified bridge',
    })),
    confidence: whales.length > 0 ? 'medium' : 'high',
    limitations: 'Predicted ROAS uses curve extrapolation with a confidence band; conservative scenario should gate scale decisions. Revenue is net of fees, VAT and refunds.',
    next_action: whales.length > 0 ? 'Hold scaling on whale-distorted campaigns until payer counts clear the confidence floor.' : 'Monetization supports current budget levels.',
  }
}

function creativeAgent(ctx: AgentContext): CopilotAnswer {
  const t = ctx.cfg.thresholds
  const cms = ctx.ds.creatives
    .filter((c) => c.status !== 'retired')
    .map((c) => ({ c, m: computeCreativeMetrics(ctx.ds, c.creative_asset_id, t) }))
    .sort((a, b) => b.m.fatigue - a.m.fatigue)
  const tired = cms.filter(({ m }) => m.fatigue >= t.fatigue_warn)
  const fresh = [...cms].sort((a, b) => a.m.cpi - b.m.cpi).filter(({ m }) => m.fatigue < t.fatigue_warn && m.spend > 500)
  return {
    agent: 'Creative Agent',
    claim: tired.length > 0
      ? `${tired.length} asset(s) are fatigued: ${tired.slice(0, 3).map(({ c, m }) => `${c.name} (${m.fatigue}/100, CTR decay ${fmtPct(m.ctr_decay)})`).join('; ')}. ` +
        `Best healthy performer: ${fresh[0]?.c.name ?? '—'} on the "${fresh[0]?.c.concept ?? ''}" concept.`
      : 'No creative currently crosses the fatigue warning threshold.',
    evidence: cms.slice(0, 4).map(({ c, m }) => ({
      label: c.name,
      value: `fatigue ${m.fatigue}/100 · CPI ${fmtMoney(m.cpi, 2)} · ${fmtMoney(m.spend_since_launch)} lifetime spend`,
      source: 'Creative intelligence (lineage-aware)',
    })),
    confidence: 'high',
    limitations: 'Creative-level retention joins are approximated through campaign cohorts (bridge grain limitation).',
    next_action: tired.length > 0
      ? `Brief variants on winning concepts before pausing losers — the "${fresh[0]?.c.concept}" lineage has the best CPI-to-fatigue ratio.`
      : 'Keep the current rotation; next fatigue re-score on refresh.',
  }
}

function dataAgent(ctx: AgentContext): CopilotAnswer {
  const bad = ctx.ds.connectors.filter((c) => c.match_rate < ctx.cfg.thresholds.min_match_rate || c.freshness_hours > c.freshness_sla_hours || c.schema_drift)
  return {
    agent: 'Data Health Agent',
    claim: bad.length === 0
      ? 'All connectors are green: fresh, covered, and matching within thresholds.'
      : `${bad.length} source(s) need attention: ${bad.map((c) => c.name).join(', ')}. ` +
        bad.map((c) => c.match_rate < ctx.cfg.thresholds.min_match_rate
          ? `${c.name} match rate is ${fmtPct(c.match_rate)}`
          : c.freshness_hours > c.freshness_sla_hours
            ? `${c.name} is ${c.freshness_hours.toFixed(1)}h stale (SLA ${c.freshness_sla_hours}h)`
            : `${c.name} has schema drift`).join('; ') + '.',
    evidence: ctx.ds.connectors.slice(0, 6).map((c) => ({
      label: c.name,
      value: `fresh ${c.freshness_hours.toFixed(1)}h/${c.freshness_sla_hours}h · match ${fmtPct(c.match_rate)} · coverage ${fmtPct(c.coverage)}`,
      source: 'Connector health monitor',
    })),
    confidence: 'high',
    limitations: 'I can block recommendations on bad data but cannot fix sources — fixes route to the data operator.',
    next_action: bad.length > 0 ? 'Open Tracking Health for per-check breakdown; a Fix Tracking task is already queued where required.' : 'No action required.',
  }
}

function asoAgent(ctx: AgentContext): CopilotAnswer {
  const rec = ctx.recs.find((r) => r.recommendation_id.startsWith('rec-store-'))
  const kw = ctx.ds.keywords
  const risers = kw.filter((k) => k.rank < k.rank_prev_week)
  const fallers = kw.filter((k) => k.rank > k.rank_prev_week + 3)
  return {
    agent: 'ASO / Organic Agent',
    claim: (rec
      ? `${rec.scope.geo} store conversion dropped sharply after a screenshot update — the store page is currently taxing paid traffic. `
      : 'Store conversion is stable across tracked geos. ') +
      `Keyword movement: ${risers.length} rising (best: "${risers[0]?.keyword ?? '—'}"), ${fallers.length} falling sharply${fallers.length ? ` ("${fallers.map((k) => k.keyword).join('", "')}")` : ''}.`,
    evidence: [
      ...(rec ? rec.evidence.map((e) => ({ label: e.metric, value: e.value, source: 'fact_store_performance' })) : []),
      ...kw.slice(0, 3).map((k) => ({ label: `"${k.keyword}" (${k.geo})`, value: `rank ${k.rank} (was ${k.rank_prev_week})`, source: 'Keyword tracker' })),
    ],
    confidence: 'high',
    limitations: 'Organic uplift attribution is correlational; halo effects are estimated, not measured per-install.',
    next_action: rec ? rec.suggested_action : 'Prioritize the rising keyword cluster in the next metadata iteration.',
  }
}

function socialAgent(ctx: AgentContext): CopilotAnswer {
  const top = [...ctx.ds.social].sort((a, b) => b.views - a.views).slice(0, 3)
  const candidates = ctx.ds.social.filter((s) => s.concept_candidate)
  return {
    agent: 'Social / Trend Agent',
    claim: `Top organic content this window: "${top[0].title}" (${(top[0].views / 1e6).toFixed(1)}M views, ${fmtPct(top[0].engagement_rate)} engagement). ` +
      `${candidates.length} posts qualify as paid-concept candidates via the organic-to-paid bridge.`,
    evidence: top.map((s) => ({
      label: `${s.platform} · ${s.title.slice(0, 40)}${s.title.length > 40 ? '…' : ''}`,
      value: `${(s.views / 1e6).toFixed(1)}M views · ER ${fmtPct(s.engagement_rate)} · sentiment ${s.sentiment.toFixed(2)}`,
      source: 'fact_social_content',
    })),
    confidence: 'medium',
    limitations: 'One viral signal is not a fact (spec §15 boundary) — concept candidates need a structured paid test before conclusions.',
    next_action: 'The trending concept already has a paid-test recommendation in the queue.',
  }
}

function productAgent(ctx: AgentContext, lq: string): CopilotAnswer {
  const ds = ctx.ds
  const daily = ds.product_daily ?? []
  const funnel = ds.level_funnel ?? []
  if (daily.length === 0) {
    return {
      agent: 'Product Agent',
      claim: 'Product analytics are not available in this workspace — no product event source is connected.',
      evidence: [],
      confidence: 'low',
      limitations: 'The simulation source has no in-game event grain; I will not invent product metrics.',
      next_action: 'Connect the live workspace to unlock DAU, sessions, level funnel and ad economics.',
    }
  }
  const recent = daily.slice(-7)
  const dau = recent.reduce((s, r) => s + r.dau, 0) / Math.max(1, recent.length)
  const newShare = recent.reduce((s, r) => s + r.new_users, 0) / Math.max(1, recent.reduce((s, r) => s + r.dau, 0))
  const adsPerDau = recent.reduce((s, r) => s + r.ad_impressions, 0) / Math.max(1, recent.reduce((s, r) => s + r.dau, 0))

  // Difficulty hotspots (same scoring as the Product screen)
  const median = [...funnel.map((f) => f.avg_duration_s)].sort((a, b) => a - b)[Math.floor(funnel.length / 2)] ?? 0
  const hotspots = funnel
    .map((f, i, arr) => {
      const prev = i > 0 ? arr[i - 1].users_started : f.users_started
      const drop = prev > 0 ? 1 - f.users_started / prev : 0
      const completion = f.users_started > 0 ? f.users_completed / f.users_started : 0
      return { level: f.level, drop, completion, duration: f.avg_duration_s, reach: f.users_started }
    })
    .filter((p) => p.reach >= 50)
    .sort((a, b) => (b.drop * 3 + (1 - b.completion)) - (a.drop * 3 + (1 - a.completion)))
    .slice(0, 3)

  // Ad economics
  const fmtAgg = new Map<string, { imps: number; rev: number }>()
  for (const r of ds.ad_format_daily ?? []) {
    const e = fmtAgg.get(r.ad_format) ?? { imps: 0, rev: 0 }
    e.imps += r.impressions; e.rev += r.revenue_usd
    fmtAgg.set(r.ad_format, e)
  }
  const formats = [...fmtAgg.entries()]
    .map(([f, e]) => ({ f, ecpm: e.imps > 0 ? (e.rev * 1000) / e.imps : 0, rev: e.rev, imps: e.imps }))
    .sort((a, b) => b.rev - a.rev)

  const askAds = /(ad format|ecpm|rewarded|interstitial|banner|monetiz)/.test(lq)
  const askStuck = /(level|stuck|funnel|difficulty|\u05e9\u05dc\u05d1|\u05e0\u05ea\u05e7\u05e2)/.test(lq)

  if (askStuck && hotspots.length > 0) {
    return {
      agent: 'Product Agent',
      claim: `Players churn hardest at ${hotspots.map((h) => `level ${h.level} (−${(h.drop * 100).toFixed(1)}% of reach vs previous level)`).join(', ')}. ` +
        `These early walls feed directly into D1 retention — fixing them improves UA economics before touching any campaign.`,
      evidence: hotspots.map((h) => ({
        label: `Level ${h.level}`,
        value: `drop −${(h.drop * 100).toFixed(1)}% · completion ${(h.completion * 100).toFixed(0)}% · ${h.duration.toFixed(0)}s avg (median ${median.toFixed(0)}s)`,
        source: 'Product events (all-time funnel)',
      })),
      confidence: 'high',
      limitations: 'Funnel is all-time (all traffic mixes). Drop-off blends difficulty churn with natural session-end points — check solve time to tell them apart.',
      next_action: 'Open Product → Difficulty hotspots and A/B a tuned version of the worst step.',
    }
  }
  if (askAds && formats.length > 0) {
    const best = [...formats].sort((a, b) => b.ecpm - a.ecpm)[0]
    return {
      agent: 'Product Agent',
      claim: `Ad revenue mix: ${formats.map((f) => `${f.f} ${((f.rev / Math.max(0.01, formats.reduce((s, x) => s + x.rev, 0))) * 100).toFixed(0)}%`).join(', ')}. ` +
        `Highest eCPM is ${best.f} at $${best.ecpm.toFixed(2)} — ` +
        (best.imps < (formats[0]?.imps ?? 0) ? `it is under-served relative to other formats; adding ${best.f} placements is the highest-leverage move.` : 'and it already carries the volume.'),
      evidence: formats.map((f) => ({
        label: f.f,
        value: `$${f.rev.toFixed(2)} rev · ${f.imps.toLocaleString()} imps · eCPM $${f.ecpm.toFixed(2)}`,
        source: 'Ad revenue events by format',
      })),
      confidence: 'high',
      limitations: 'eCPM varies by geo and network; format-level view blends them.',
      next_action: 'Product → Ad monetization economics for the daily trend per format.',
    }
  }
  return {
    agent: 'Product Agent',
    claim: `Last 7 days: ~${Math.round(dau)} DAU (${(newShare * 100).toFixed(0)}% new — heavily UA-driven), ` +
      `${adsPerDau.toFixed(1)} ad impressions per DAU. ` +
      (hotspots.length > 0 ? `Biggest churn wall: level ${hotspots[0].level} (−${(hotspots[0].drop * 100).toFixed(1)}%).` : ''),
    evidence: [
      { label: 'DAU (7d avg)', value: String(Math.round(dau)), source: 'Product event stream' },
      { label: 'New-user share', value: `${(newShare * 100).toFixed(0)}%`, source: 'Product event stream' },
      { label: 'Ads / DAU', value: adsPerDau.toFixed(1), source: 'Product event stream' },
      ...(hotspots[0] ? [{ label: `Worst level (${hotspots[0].level})`, value: `−${(hotspots[0].drop * 100).toFixed(1)}% drop`, source: 'Level funnel' }] : []),
    ],
    confidence: 'high',
    limitations: 'Product metrics cover all users (paid + organic); campaign-level splits live in the marketing views.',
    next_action: 'Open the Product screen for retention curve, ad economics and the full funnel.',
  }
}

function briefAgent(ctx: AgentContext): CopilotAnswer {
  const pending = ctx.recs.filter((r) => r.approval_status === 'proposed')
  const critical = pending.filter((r) => r.risk_level === 'critical' || r.risk_level === 'high')
  const rows = activeMetrics(ctx)
  const spend = rows.reduce((a, { m }) => a + m.spend, 0)
  const rev = rows.reduce((a, { m }) => a + m.revenue, 0)
  const best = [...rows].sort((a, b) => b.m.quality_score - a.m.quality_score)[0]
  const worst = [...rows].sort((a, b) => a.m.quality_score - b.m.quality_score)[0]
  return {
    agent: 'Briefing Agent',
    claim: `${pending.length} recommendations await decisions (${critical.length} high/critical risk). ` +
      `14-day: ${fmtMoney(spend)} spend, ${fmtMoney(rev)} net revenue. ` +
      `Strongest campaign: ${best.c.name} (quality ${best.m.quality_score}/100). Weakest: ${worst.c.name} (${worst.m.quality_score}/100).`,
    evidence: pending.slice(0, 4).map((r) => ({
      label: r.recommendation_type.replace('_', ' ').toUpperCase(),
      value: r.title,
      source: `Decision engine · priority ${r.priority}`,
    })),
    confidence: 'high',
    limitations: 'This is an operational summary of queued items, not a new analysis.',
    next_action: critical.length > 0
      ? `Start with the ${critical[0].recommendation_type.replace('_', ' ')} item: "${critical[0].title}".`
      : 'Work the queue top-down by priority.',
  }
}

export const SUGGESTED_PROMPTS = [
  'What should I focus on today?',
  'Is our tracking healthy?',
  'Which creatives are fatigued?',
  'Which campaign has the cheapest purchases?',
  'Why can we not compute ROAS?',
  'Can we scale the Android purchase campaign?',
  'Which drama titles are winning?',
  'What is blocking every decision right now?',
]
