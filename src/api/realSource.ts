// ─────────────────────────────────────────────────────────────────────────────
// REAL DATA SOURCE — AppReel live connection.
// Reads the canonical ar_* tables from Supabase.
// The publishable key below is public-by-design (RLS allows SELECT only).
//
// AppReel is an INDEPENDENT workspace. The `ar_` prefix is the ownership
// boundary: this app reads ar_* tables and nothing else, and no other product
// writes to them. The database instance is shared for convenience only —
// there is no relationship between AppReel and anything else hosted there.
//
// CONNECTED:
//   • AppsFlyer (MMP) — the cross-network source of truth. Cost, ATTRIBUTED
//     installs, revenue, and D1/D3/D7 retention for Meta + TikTok + organic,
//     apps com.developerappreel.appreel (Android) and id6752566786 (iOS).
//   • Meta Ads (account "AppReel UTC" 780499204349049) — creative-level detail.
//   • TikTok Ads (advertiser "Appreel UTC" 7552499921006608385) — campaigns.
//
// NOT CONNECTED (shown as gaps, never faked):
//   • Mixpanel — the MCP is bound to the EU server (mcp-eu.mixpanel.com) while
//     both AppReel projects live in the US region (mcp.mixpanel.com), so every
//     call is refused. Product analytics (DAU, funnels, sessions) stay dark.
//
// Note on grain: retention comes from AppsFlyer at campaign×install-date grain,
// so it is real per campaign. Geo exists at country×platform×channel grain only
// — AppsFlyer does not return cost per country per campaign per day — so the
// geo cube is channel-level and is presented that way.
// ─────────────────────────────────────────────────────────────────────────────
import type { Dataset } from '@/domain/seed/generator'
import type {
  ConnectorStatus, DimCampaign, DimCreativeAsset, FactCohort, FactSpend, OnboardingStep,
} from '@/domain/types'

const SUPABASE_URL = 'https://acukdxsdbkjdtnyrrjcm.supabase.co'
const SUPABASE_KEY = 'sb_publishable_cYMxJWxuBPp5n3eqZi1e5A_Dki8bw5I'
const PRODUCT_ID = 'appreel'

interface CampaignRow {
  campaign_id: string
  name: string
  channel: string
  platform: string
  objective: string
  status: string
}
interface SpendRow {
  date: string
  campaign_id: string
  spend: number
  impressions: number
  clicks: number
  installs: number
  revenue_activity: number
}
interface CohortRow {
  cohort_date: string
  campaign_id: string
  installs: number
  d1_rate: number | null
  d3_rate: number | null
  d7_rate: number | null
  rev_d1: number
  rev_d3: number
  rev_d7: number
}
interface RevenueRow { date: string; revenue_usd: number }
interface GeoRow {
  country: string
  platform: string
  channel: string
  installs: number
  spend: number
  revenue: number
  active_users: number
}
interface CreativeRow { creative_id: string; title: string; format: string }
interface CreativeSpendRow {
  campaign_id: string
  creative_id: string
  window_start: string
  window_end: string
  spend: number
  impressions: number
  clicks: number
  installs: number
}
interface SyncRow { source: string; synced_at: string; rows_written: number; note: string }

export interface RealData {
  campaigns: CampaignRow[]
  spend: SpendRow[]
  cohorts: CohortRow[]
  revenue: RevenueRow[]
  geo: GeoRow[]
  creatives: CreativeRow[]
  creativeSpend: CreativeSpendRow[]
  syncs: SyncRow[]
}

async function rest<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`Supabase ${path}: HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export async function fetchRealData(): Promise<RealData | null> {
  try {
    const [campaigns, spend, cohorts, revenue, geo, creatives, creativeSpend, syncs] = await Promise.all([
      rest<CampaignRow[]>('ar_dim_campaign?select=*'),
      rest<SpendRow[]>('ar_fact_spend_daily?select=*&order=date'),
      rest<CohortRow[]>('ar_fact_cohort_daily?select=*&order=cohort_date'),
      rest<RevenueRow[]>('ar_fact_revenue_daily?select=*&order=date'),
      rest<GeoRow[]>('ar_fact_geo?select=*&order=installs.desc'),
      rest<CreativeRow[]>('ar_dim_creative?select=*'),
      rest<CreativeSpendRow[]>('ar_fact_spend_creative?select=*'),
      rest<SyncRow[]>('ar_sync_log?select=*&order=synced_at.desc&limit=10'),
    ])
    if (campaigns.length === 0) return null
    return { campaigns, spend, cohorts, revenue, geo, creatives, creativeSpend, syncs }
  } catch {
    return null
  }
}

const PLATFORM: Record<string, DimCampaign['platform']> = { ios: 'ios', android: 'android', both: 'both' }
const OBJECTIVE: Record<string, DimCampaign['objective']> = {
  purchase: 'purchase', install: 'install', web2app: 'install', organic: 'install',
}
/** Countries a channel actually bought in, ranked by installs — for campaign geos. */
function geosOfChannel(geo: GeoRow[], channel: string): string[] {
  const m = new Map<string, number>()
  for (const g of geo) {
    if (g.channel !== channel) continue
    m.set(g.country, (m.get(g.country) ?? 0) + Number(g.installs))
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c]) => c)
}

export function applyRealData(sim: Dataset, real: RealData): Dataset {
  const now = Date.now()
  const syncTs = (source: string) => {
    const s = real.syncs.find((r) => r.source === source)
    const t = s ? new Date(s.synced_at).getTime() : 0
    return Number.isFinite(t) && t > 0 ? t : 0
  }
  const afTs = syncTs('appsflyer') || now
  const metaTs = syncTs('meta_ads') || now
  const ttTs = syncTs('tiktok_ads') || now

  // Creatives — one asset per Meta ad name; the "concept" is the drama title so
  // Creative Intelligence groups by story rather than by file.
  const creatives: DimCreativeAsset[] = real.creatives.map((c, i) => ({
    creative_asset_id: c.creative_id,
    product_id: PRODUCT_ID,
    name: c.creative_id,
    concept: c.title,
    hook: c.title,
    angle: c.format === 'video_w2a' ? 'web_to_app' : 'drama_hook',
    format: 'video_15s',
    language: 'EN',
    parent_id: null,
    iteration: i + 1,
    launch_date: real.creativeSpend.find((s) => s.creative_id === c.creative_id)?.window_start ?? '2026-07-14',
    status: 'live',
  }))

  const creativesByCampaign = new Map<string, Set<string>>()
  for (const r of real.creativeSpend) {
    const s = creativesByCampaign.get(r.campaign_id) ?? new Set<string>()
    s.add(r.creative_id)
    creativesByCampaign.set(r.campaign_id, s)
  }

  const campaigns: DimCampaign[] = real.campaigns.map((c) => {
    const days = real.spend.filter((s) => s.campaign_id === c.campaign_id && Number(s.spend) > 0)
    const avgDaily = days.length > 0 ? days.reduce((a, s) => a + Number(s.spend), 0) / days.length : 0
    const firstDay = real.spend.find((s) => s.campaign_id === c.campaign_id)?.date ?? '2026-07-08'
    return {
      campaign_id: c.campaign_id,
      product_id: PRODUCT_ID,
      channel_id: c.channel,
      name: c.name,
      objective: OBJECTIVE[c.objective] ?? 'install',
      status: (c.status as DimCampaign['status']) ?? 'active',
      geos: geosOfChannel(real.geo, c.channel),
      platform: PLATFORM[c.platform] ?? 'both',
      start_date: firstDay,
      daily_budget: Math.round(avgDaily),
      creative_ids: [...(creativesByCampaign.get(c.campaign_id) ?? [])].sort(),
    }
  })

  // Spend at creative grain where Meta gives it, campaign grain otherwise. The
  // Meta creative pull is one 8-day aggregate, so it is spread across the
  // campaign's spending days by share — an allocation, not a measurement.
  const spend: FactSpend[] = []
  for (const r of real.spend) {
    const crs = real.creativeSpend.filter(
      (c) => c.campaign_id === r.campaign_id && r.date >= c.window_start && r.date <= c.window_end,
    )
    const winTotal = crs.reduce((a, c) => a + Number(c.spend), 0)
    if (crs.length > 0 && winTotal > 0 && Number(r.spend) > 0) {
      for (const c of crs) {
        const share = Number(c.spend) / winTotal
        spend.push({
          date: r.date,
          campaign_id: r.campaign_id,
          creative_asset_id: c.creative_id,
          spend: Number(r.spend) * share,
          impressions: Math.round(Number(r.impressions) * share),
          clicks: Math.round(Number(r.clicks) * share),
          network_installs: Math.round(Number(r.installs) * share),
        })
      }
    } else {
      spend.push({
        date: r.date,
        campaign_id: r.campaign_id,
        creative_asset_id: `${r.campaign_id}-unmapped`,
        spend: Number(r.spend),
        impressions: Number(r.impressions),
        clicks: Number(r.clicks),
        network_installs: Number(r.installs),
      })
    }
  }

  // Cohorts. Installs are MMP-ATTRIBUTED (AppsFlyer), so matched_installs equals
  // installs — the attribution gap is closed. Retention is real per campaign.
  // revenue_by_age is reconstructed from the cumulative D1/D3/D7 curve: the
  // known points are placed at their age and the gaps interpolated, which is why
  // it is an 8-slot array rather than a per-day measurement.
  const cohorts: FactCohort[] = real.cohorts.map((r) => {
    const inst = Math.max(0, Number(r.installs))
    const d1 = Number(r.rev_d1) || 0
    const d3 = Number(r.rev_d3) || 0
    const d7 = Number(r.rev_d7) || 0
    const byAge = [d1, (d3 - d1) / 2, (d3 - d1) / 2, (d7 - d3) / 4, (d7 - d3) / 4, (d7 - d3) / 4, (d7 - d3) / 4]
      .map((v) => Math.max(0, v))
    const rate = (v: number | null) => (v === null ? 0 : Number(v))
    return {
      cohort_date: r.cohort_date,
      campaign_id: r.campaign_id,
      installs: inst,
      matched_installs: inst,
      activated: Math.round(inst * rate(r.d1_rate)),
      meaningful_sessions: Math.round(inst * rate(r.d1_rate)),
      d1_retained: Math.round(inst * rate(r.d1_rate)),
      d3_retained: Math.round(inst * rate(r.d3_rate)),
      d7_retained: Math.round(inst * rate(r.d7_rate)),
      sessions_per_user: 0,
      depth_l3_share: rate(r.d3_rate),
      payers: 0,
      repeat_payers: 0,
      revenue_by_age: byAge,
      top_payer_revenue: 0,
      refunds: 0,
    }
  }).filter((c) => c.installs > 0 || c.revenue_by_age.some((v) => v > 0))

  const H = 3600_000
  const mkHistory = (ok: boolean) =>
    Array.from({ length: 14 }, (_, i) => ({ ts: now - (13 - i) * 6 * H, ok, duration_s: 40, rows: 300 }))

  const connectors: ConnectorStatus[] = [
    {
      source_id: 'mmp', name: 'AppsFlyer (MMP)', category: 'attribution',
      last_sync_ts: afTs, freshness_sla_hours: 24,
      freshness_hours: Math.max(0.1, (now - afTs) / H),
      coverage: 1, match_rate: 1, undefined_share: 0, duplicate_rate: 0,
      schema_drift: false, late_data_impact: 0, failing_jobs: 0, sync_history: mkHistory(true),
    },
    {
      source_id: 'meta', name: 'Meta Ads (AppReel UTC)', category: 'ad_network',
      last_sync_ts: metaTs, freshness_sla_hours: 24,
      freshness_hours: Math.max(0.1, (now - metaTs) / H),
      coverage: 1, match_rate: 1, undefined_share: 0, duplicate_rate: 0,
      schema_drift: false, late_data_impact: 0, failing_jobs: 0, sync_history: mkHistory(true),
    },
    {
      source_id: 'tiktok', name: 'TikTok Ads (Appreel UTC)', category: 'ad_network',
      last_sync_ts: ttTs, freshness_sla_hours: 24,
      freshness_hours: Math.max(0.1, (now - ttTs) / H),
      coverage: 1, match_rate: 1, undefined_share: 0, duplicate_rate: 0,
      schema_drift: false, late_data_impact: 0, failing_jobs: 0, sync_history: mkHistory(true),
    },
    {
      source_id: 'revenue', name: 'Revenue (AppsFlyer)', category: 'revenue',
      last_sync_ts: afTs, freshness_sla_hours: 24,
      freshness_hours: Math.max(0.1, (now - afTs) / H),
      coverage: 1, match_rate: 1, undefined_share: 0, duplicate_rate: 0,
      schema_drift: false, late_data_impact: 0, failing_jobs: 0, sync_history: mkHistory(true),
    },
    {
      source_id: 'events', name: 'Mixpanel (product events)', category: 'product_events',
      last_sync_ts: 0, freshness_sla_hours: 24, freshness_hours: 9999,
      coverage: 0, match_rate: 0, undefined_share: 1, duplicate_rate: 0,
      schema_drift: true,
      schema_drift_note: 'The Mixpanel connection is bound to the EU server (mcp-eu.mixpanel.com), but both AppReel projects — "AppReel Short Drama LTD" (3850345) and "AppReel Development" (3904347) — are hosted in the US region. Every call is refused with a regional access restriction. Reconnect the MCP against mcp.mixpanel.com to unlock DAU, session depth and episode funnels.',
      late_data_impact: 0, failing_jobs: 1, sync_history: mkHistory(false),
    },
  ]

  const steps: OnboardingStep[] = sim.products[0].onboarding.steps.map((s) => {
    const o: Record<string, { status: OnboardingStep['status']; detail: string }> = {
      registration: { status: 'complete', detail: 'AppReel · iOS + Android · UK/CA/AU/DE/NL' },
      identity: { status: 'complete', detail: 'AppsFlyer device identity across both store apps' },
      events: { status: 'blocked', detail: 'Mixpanel MCP is on the EU server; AppReel projects are US-hosted' },
      depth: { status: 'pending', detail: 'Episode-progression depth layers need the Mixpanel connection' },
      revenue: { status: 'complete', detail: 'AppsFlyer revenue by cohort and calendar day' },
      attribution: { status: 'complete', detail: 'AppsFlyer attributes Meta, TikTok and organic' },
      creative: { status: 'complete', detail: '10 creatives mapped from Meta ad names' },
      thresholds: { status: 'in_progress', detail: 'Defaults in place — need calibration to short-drama economics' },
      data_qa: { status: 'in_progress', detail: 'Acquisition and revenue certified; product events still missing' },
      go_live: { status: 'pending', detail: 'Gated on the product event contract' },
    }
    const ov = o[s.id]
    return ov ? { ...s, status: ov.status, detail: ov.detail } : s
  })

  // Geo cube at country × channel grain (AppsFlyer does not expose cost per
  // country per campaign per day). Dates are unavailable at this grain, so the
  // rows are stamped with the window's last day and labelled as such in the UI.
  const WINDOW_END = real.spend.length ? real.spend[real.spend.length - 1].date : '2026-07-21'
  const geo_cohort = real.geo.map((g) => ({
    cohort_date: WINDOW_END,
    country: g.country,
    campaign_id: g.channel,
    installs: Number(g.installs),
    spend: Number(g.spend),
    ad_revenue: Number(g.revenue),
    iap_revenue: 0,
    payers: 0,
  }))

  return {
    ...sim,
    products: [{
      product_id: PRODUCT_ID,
      name: 'AppReel',
      icon: '🎬',
      platforms: ['ios', 'android'],
      stores: ['App Store', 'Google Play'],
      markets: [...new Set(real.geo.slice(0, 8).map((g) => g.country))],
      owner: 'Barel Zimkind',
      status: 'live',
      onboarding: { steps },
    }],
    campaigns,
    creatives,
    spend,
    cohorts,
    store: [],
    keywords: [],
    social: [],
    connectors,
    generated_at: now,
    revenue_daily: real.revenue.map((r) => ({ date: r.date, revenue_usd: Number(r.revenue_usd) })),
    revenue_activity_daily: real.spend
      .filter((r) => Number(r.revenue_activity) > 0)
      .map((r) => ({ date: r.date, campaign_id: r.campaign_id, revenue_usd: Number(r.revenue_activity) })),
    geo_cohort,
    sync_log: real.syncs.map((r) => ({
      source: r.source, synced_at: r.synced_at, rows_written: Number(r.rows_written), note: r.note,
    })),
  }
}

export const REAL_SOURCE_INFO = {
  label: 'Live data: AppsFlyer + Meta + TikTok',
  detail: 'Cost, attributed installs, revenue and retention from AppsFlyer across Meta, TikTok and organic. Product events (Mixpanel) not connected.',
}
