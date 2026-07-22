// ─────────────────────────────────────────────────────────────────────────────
// SIMULATED DATA SOURCE — deterministic generator standing in for the real
// ingestion + normalization layers (spec §5). Every entity matches the
// canonical model contract in src/domain/types.ts, so swapping this module
// for real connectors requires no change elsewhere. Narrative "profiles" are
// injected per campaign so the decision engine derives realistic findings
// from the numbers themselves (nothing downstream is hard-coded).
// ─────────────────────────────────────────────────────────────────────────────
import { mulberry32, jitter, randInt, type Rng } from './rng'
import { isoDaysAgo } from '@/lib/format'
import type {
  DimProduct, DimChannel, DimCampaign, DimCreativeAsset,
  FactSpend, FactCohort, FactStoreDaily, KeywordRank, FactSocialContent,
  ConnectorStatus, User,
} from '../types'

export interface Dataset {
  products: DimProduct[]
  channels: DimChannel[]
  campaigns: DimCampaign[]
  creatives: DimCreativeAsset[]
  spend: FactSpend[]
  cohorts: FactCohort[]
  store: FactStoreDaily[]
  keywords: KeywordRank[]
  social: FactSocialContent[]
  connectors: ConnectorStatus[]
  users: User[]
  generated_at: number
  // Install-date × country × campaign attribution facts (live AppsFlyer source
  // only — the simulation has no geo grain, and absence is shown, not faked)
  geo_daily?: { date: string; country: string; campaign_id: string; installs: number; revenue_usd: number }[]
  // Calendar-day revenue truth (live source only); when absent it is derived
  // from cohort curves (cohort_date + age = calendar day)
  revenue_daily?: { date: string; revenue_usd: number }[]
  // ACTIVITY revenue: earned on a calendar day, split by acquiring campaign
  // (same dollars as the cohort curves — different time axis)
  revenue_activity_daily?: { date: string; campaign_id: string; revenue_usd: number }[]
  // Ingestion audit: when each upstream source last landed rows
  sync_log?: { source: string; synced_at: string; rows_written: number; note: string }[]
  // Product analytics facts (live product event source only)
  product_daily?: { date: string; dau: number; new_users: number; sessions: number; level_starts: number; level_completes: number; ad_impressions: number; interstitials: number; avg_session_min: number }[]
  level_funnel?: { level: number; users_started: number; users_completed: number; attempts: number; avg_duration_s: number }[]
  retention_curve?: { age: number; eligible: number; retained: number }[]
  // Per-cohort DAILY retention (the retention triangle) — exact, product-level
  cohort_retention?: { cohort_date: string; age: number; installs: number; retained: number }[]
  // Geo cube — powers country filtering across every analytic surface
  geo_cohort?: { cohort_date: string; country: string; campaign_id: string; installs: number; spend: number; ad_revenue: number; iap_revenue: number; payers: number }[]
  geo_cohort_age?: { cohort_date: string; country: string; campaign_id: string; age: number; ad_revenue: number; iap_revenue: number }[]
  ad_format_daily?: { date: string; ad_format: string; impressions: number; revenue_usd: number }[]
  // Paywall → payment funnel from the product event source. Steps 1-4 are the
  // sequential funnel; the rest are named side-counts (cancels, failures).
  monetization_funnel?: { step: number; label: string; users: number; note: string }[]
  // ── Short-drama content layer ──────────────────────────────────────────────
  // The catalogue IS the product. `advertised_as` links a series to the creative
  // concept that promotes it, which closes the loop between what UA buys and
  // what viewers actually watch and pay for.
  series?: {
    series_name: string; platform: string; starts: number; completers: number | null
    episode_completes: number; paywall_users: number; unlocks: number | null
    purchases: number; advertised_as: string | null
  }[]
  // Date × platform acquisition + retention, so the platform filter and the
  // date picker both bite on the same facts.
  platform_daily?: { date: string; platform: string; installs: number; cost: number; revenue: number; d1: number | null; d3: number | null; d7: number | null }[]
  iap?: { product: string; events: number; users: number; kind: string }[]
  // Per-series episode curve: unique viewers completing each episode. The
  // paywall sits where the curve cliffs, and it is NOT the same episode for
  // every series — that variance is the point.
  series_episode?: { series_name: string; episode: number; viewers: number }[]
  // Date-grained content facts. Episode COMPLETIONS are total events, which are
  // additive, so any date range sums correctly — unlike daily unique viewers.
  series_episode_daily?: { series_name: string; episode: number; date: string; completions: number }[]
  series_daily?: { series_name: string; date: string; starts: number; episode_completes: number }[]
  // Retention breakdowns. AppsFlyer is the ONLY source of install retention;
  // Mixpanel's curve is deliberately not used, so one number means one thing.
  retention_geo?: { country: string; installs: number; cost: number; revenue: number; d1: number | null; d3: number | null; d7: number | null }[]
  retention_creative?: { creative: string; installs: number; cost: number; d1: number | null; d3: number | null; d7: number | null }[]
  coins?: { metric: string; value: number; note: string }[]
  ad_network?: { network: string; impressions: number; revenue: number }[]
  version_daily?: { date: string; app_version: string; dau: number }[]
}

const WINDOW_DAYS = 60

// Per-campaign narrative profile. All downstream findings emerge from these.
interface CampaignProfile {
  id: string
  name: string
  channel: string
  geos: string[]
  platform: 'ios' | 'android' | 'both'
  objective: 'install' | 'purchase' | 'value' | 'retargeting'
  ageDays: number
  dailyBudget: number
  cpi: number // blended attributed CPI target for this campaign
  ctr: number
  cvr: number // click → install
  d30Roas: number // realistic D30 net ROAS this campaign converges to
  activation: number
  d1: number
  d7ratio: number // d7 = d1 * ratio
  depthL3: number
  payerRate: number
  revSlope: number // monetization curve steepness (1 = healthy)
  whale: boolean // inject single-payer concentration
  fatigued: boolean // CTR decays + CPI drifts over window
  matchRate: number
  scaling: 'ramping' | 'flat' | 'declining'
  creatives: string[]
  status?: 'active' | 'paused'
}

const P = 'appreel'

const PROFILES: CampaignProfile[] = [
  // 1 ─ Hero: strong on every axis → SCALE
  { id: 'c-meta-us-core', name: 'META_US_iOS_Purchase_Core', channel: 'meta', geos: ['US'], platform: 'ios', objective: 'purchase', ageDays: 48, dailyBudget: 1800, cpi: 2.9, ctr: 0.021, cvr: 0.16, d30Roas: 0.78, activation: 0.68, d1: 0.41, d7ratio: 0.38, depthL3: 0.37, payerRate: 0.034, revSlope: 1.25, whale: false, fatigued: false, matchRate: 0.93, scaling: 'ramping', creatives: ['cr-hook-fail', 'cr-hook-fail-v2', 'cr-asmr-reveal', 'cr-ugc-sarah'] },
  // 2 ─ Healthy but young-ish evidence → KEEP
  { id: 'c-meta-ww-android', name: 'META_T1_Android_Install_Broad', channel: 'meta', geos: ['US', 'UK', 'DE', 'AU'], platform: 'android', objective: 'install', ageDays: 26, dailyBudget: 700, cpi: 2.05, ctr: 0.017, cvr: 0.14, d30Roas: 0.62, activation: 0.62, d1: 0.36, d7ratio: 0.33, depthL3: 0.3, payerRate: 0.021, revSlope: 1.05, whale: false, fatigued: false, matchRate: 0.91, scaling: 'flat', creatives: ['cr-asmr-reveal', 'cr-satisfying-30', 'cr-static-puzzle'] },
  // 3 ─ Severe creative fatigue while quality holds → REFRESH CREATIVE
  { id: 'c-tiktok-us-scale', name: 'TT_US_iOS_Scale_UGC', channel: 'tiktok', geos: ['US'], platform: 'ios', objective: 'install', ageDays: 55, dailyBudget: 1200, cpi: 2.2, ctr: 0.014, cvr: 0.12, d30Roas: 0.6, activation: 0.6, d1: 0.35, d7ratio: 0.34, depthL3: 0.29, payerRate: 0.019, revSlope: 0.98, whale: false, fatigued: true, matchRate: 0.9, scaling: 'flat', creatives: ['cr-ugc-sarah', 'cr-ugc-mike', 'cr-trend-sound'] },
  // 4 ─ Cheap installs, terrible quality → REDUCE/PAUSE
  { id: 'c-applovin-t3', name: 'AL_T3_Android_Volume', channel: 'applovin', geos: ['BR', 'IN', 'ID'], platform: 'android', objective: 'install', ageDays: 33, dailyBudget: 550, cpi: 0.55, ctr: 0.011, cvr: 0.22, d30Roas: 0.17, activation: 0.38, d1: 0.19, d7ratio: 0.22, depthL3: 0.11, payerRate: 0.004, revSlope: 0.6, whale: false, fatigued: false, matchRate: 0.88, scaling: 'ramping', creatives: ['cr-playable-v1', 'cr-static-puzzle'] },
  // 5 ─ Whale-distorted ROAS → HOLD with concentration warning
  { id: 'c-google-de', name: 'GG_DE_UAC_Value', channel: 'google', geos: ['DE'], platform: 'both', objective: 'value', ageDays: 30, dailyBudget: 480, cpi: 2.45, ctr: 0.013, cvr: 0.13, d30Roas: 0.42, activation: 0.58, d1: 0.33, d7ratio: 0.32, depthL3: 0.27, payerRate: 0.012, revSlope: 0.9, whale: true, fatigued: false, matchRate: 0.9, scaling: 'flat', creatives: ['cr-satisfying-30', 'cr-playable-v1', 'cr-static-puzzle'] },
  // 6 ─ Attribution breakage → FIX TRACKING (gate red, decisions blocked)
  { id: 'c-unity-row', name: 'UN_ROW_Android_Install', channel: 'unity', geos: ['MX', 'TR', 'PL'], platform: 'android', objective: 'install', ageDays: 41, dailyBudget: 380, cpi: 0.95, ctr: 0.012, cvr: 0.18, d30Roas: 0.5, activation: 0.55, d1: 0.3, d7ratio: 0.3, depthL3: 0.24, payerRate: 0.013, revSlope: 0.92, whale: false, fatigued: false, matchRate: 0.61, scaling: 'flat', creatives: ['cr-playable-v1', 'cr-satisfying-30'] },
  // 7-9 ─ Fresh campaigns (age 0-7) for the Fresh Monitor
  { id: 'c-tiktok-jp-test', name: 'TT_JP_iOS_Test_Anime', channel: 'tiktok', geos: ['JP'], platform: 'ios', objective: 'install', ageDays: 3, dailyBudget: 250, cpi: 2.5, ctr: 0.019, cvr: 0.11, d30Roas: 0.85, activation: 0.64, d1: 0.38, d7ratio: 0.34, depthL3: 0.32, payerRate: 0.024, revSlope: 1.1, whale: false, fatigued: false, matchRate: 0.92, scaling: 'ramping', creatives: ['cr-anime-cut', 'cr-trend-sound'] },
  { id: 'c-meta-fr-test', name: 'META_FR_iOS_Test_Broad', channel: 'meta', geos: ['FR'], platform: 'ios', objective: 'install', ageDays: 6, dailyBudget: 180, cpi: 3.2, ctr: 0.012, cvr: 0.1, d30Roas: 0.34, activation: 0.5, d1: 0.27, d7ratio: 0.3, depthL3: 0.19, payerRate: 0.009, revSlope: 0.8, whale: false, fatigued: false, matchRate: 0.9, scaling: 'flat', creatives: ['cr-hook-fail-v2', 'cr-static-puzzle'] },
  { id: 'c-google-us-ret', name: 'GG_US_Retargeting_Lapsed', channel: 'google', geos: ['US'], platform: 'both', objective: 'retargeting', ageDays: 5, dailyBudget: 120, cpi: 1.7, ctr: 0.028, cvr: 0.3, d30Roas: 1.25, activation: 0.8, d1: 0.52, d7ratio: 0.45, depthL3: 0.5, payerRate: 0.05, revSlope: 1.3, whale: false, fatigued: false, matchRate: 0.94, scaling: 'ramping', creatives: ['cr-comeback', 'cr-satisfying-30'] },
  // 10 ─ Paused reference campaign (history in ledger)
  { id: 'c-tiktok-t2-old', name: 'TT_T2_Android_Broad_v1', channel: 'tiktok', geos: ['MX', 'TH', 'VN'], platform: 'android', objective: 'install', ageDays: 58, dailyBudget: 0, cpi: 0.85, ctr: 0.009, cvr: 0.13, d30Roas: 0.2, activation: 0.42, d1: 0.21, d7ratio: 0.24, depthL3: 0.13, payerRate: 0.005, revSlope: 0.65, whale: false, fatigued: true, matchRate: 0.87, scaling: 'declining', creatives: ['cr-ugc-mike', 'cr-static-puzzle'], status: 'paused' },
]

const CREATIVE_DEFS: Array<Omit<DimCreativeAsset, 'product_id'>> = [
  { creative_asset_id: 'cr-hook-fail', name: 'Fail_Hook_Reveal_15s', concept: 'Fail → Reveal', hook: 'Almost nobody solves this', angle: 'challenge', format: 'video_15s', language: 'EN', parent_id: null, iteration: 1, launch_date: isoDaysAgo(70), status: 'live' },
  { creative_asset_id: 'cr-hook-fail-v2', name: 'Fail_Hook_Reveal_15s_v2_FastCut', concept: 'Fail → Reveal', hook: 'Almost nobody solves this', angle: 'challenge', format: 'video_15s', language: 'EN', parent_id: 'cr-hook-fail', iteration: 2, launch_date: isoDaysAgo(34), status: 'live' },
  { creative_asset_id: 'cr-asmr-reveal', name: 'ASMR_Scratch_Reveal_30s', concept: 'ASMR Satisfy', hook: 'Most satisfying reveal', angle: 'relaxation', format: 'video_30s', language: 'EN', parent_id: null, iteration: 1, launch_date: isoDaysAgo(52), status: 'live' },
  { creative_asset_id: 'cr-satisfying-30', name: 'Satisfying_Clear_30s', concept: 'ASMR Satisfy', hook: 'Watch it all clear', angle: 'relaxation', format: 'video_30s', language: 'EN', parent_id: 'cr-asmr-reveal', iteration: 2, launch_date: isoDaysAgo(40), status: 'live' },
  { creative_asset_id: 'cr-ugc-sarah', name: 'UGC_Sarah_Addicted_15s', concept: 'UGC Testimonial', hook: "I can't stop playing this", angle: 'social_proof', format: 'ugc_video', language: 'EN', parent_id: null, iteration: 1, launch_date: isoDaysAgo(60), status: 'live' },
  { creative_asset_id: 'cr-ugc-mike', name: 'UGC_Mike_Challenge_15s', concept: 'UGC Testimonial', hook: 'My girlfriend beat my score', angle: 'social_proof', format: 'ugc_video', language: 'EN', parent_id: 'cr-ugc-sarah', iteration: 2, launch_date: isoDaysAgo(58), status: 'live' },
  { creative_asset_id: 'cr-playable-v1', name: 'Playable_Level3_Demo', concept: 'Playable Demo', hook: 'Try level 3 now', angle: 'interactive', format: 'playable', language: 'EN', parent_id: null, iteration: 1, launch_date: isoDaysAgo(45), status: 'live' },
  { creative_asset_id: 'cr-static-puzzle', name: 'Static_Puzzle_Grid', concept: 'Minimal Static', hook: 'Can you spot it?', angle: 'challenge', format: 'static', language: 'EN', parent_id: null, iteration: 1, launch_date: isoDaysAgo(66), status: 'live' },
  { creative_asset_id: 'cr-trend-sound', name: 'Trend_Sound_Mashup_15s', concept: 'Trend Rider', hook: 'That sound + this game', angle: 'trend', format: 'video_15s', language: 'EN', parent_id: null, iteration: 1, launch_date: isoDaysAgo(20), status: 'live' },
  { creative_asset_id: 'cr-anime-cut', name: 'JP_Anime_Cut_15s', concept: 'Localized Anime', hook: '日本限定チャレンジ', angle: 'localization', format: 'video_15s', language: 'JA', parent_id: 'cr-hook-fail', iteration: 3, launch_date: isoDaysAgo(4), status: 'testing' },
  { creative_asset_id: 'cr-comeback', name: 'Comeback_NewLevels_15s', concept: 'Comeback', hook: '50 new levels since you left', angle: 'retargeting', format: 'video_15s', language: 'EN', parent_id: null, iteration: 1, launch_date: isoDaysAgo(6), status: 'testing' },
]

const CHANNELS: DimChannel[] = [
  { channel_id: 'meta', name: 'Meta', kind: 'paid', color: '#5e8dff' },
  { channel_id: 'google', name: 'Google Ads', kind: 'paid', color: '#34d399' },
  { channel_id: 'tiktok', name: 'TikTok', kind: 'paid', color: '#c084fc' },
  { channel_id: 'applovin', name: 'AppLovin', kind: 'paid', color: '#fbbf24' },
  { channel_id: 'unity', name: 'Unity Ads', kind: 'paid', color: '#f87171' },
  { channel_id: 'organic', name: 'Organic', kind: 'organic', color: '#60a5fa' },
]

const USERS: User[] = [
  { user_id: 'u-dana', name: 'Dana Peretz', role: 'growth_lead', avatar_hue: 210 },
  { user_id: 'u-omer', name: 'Omer Katz', role: 'analyst', avatar_hue: 150 },
  { user_id: 'u-lia', name: 'Lia Chen', role: 'creative', avatar_hue: 280 },
  { user_id: 'u-yoni', name: 'Yoni Bar', role: 'operator', avatar_hue: 30 },
  { user_id: 'u-admin', name: 'Alex Morgan', role: 'admin', avatar_hue: 0 },
  { user_id: 'u-view', name: 'Noa Levi', role: 'viewer', avatar_hue: 100 },
]

const dayFactor = (iso: string): number => {
  // Weekend uplift typical for casual gaming
  const dow = new Date(iso + 'T00:00:00').getDay()
  return dow === 0 || dow === 6 ? 1.14 : 1
}

export function generateDataset(): Dataset {
  const rng = mulberry32(20260720)
  const now = Date.now()

  const products: DimProduct[] = [
    {
      product_id: P, name: 'AppReel', icon: '🎬',
      platforms: ['ios', 'android'], stores: ['App Store', 'Google Play'],
      markets: ['US', 'UK', 'DE', 'FR', 'JP', 'BR', 'IN', 'MX'],
      owner: 'Dana Peretz', status: 'live',
      onboarding: { steps: onboardingComplete() },
    },
    {
      product_id: 'slide-out', name: 'Slide Out', icon: '🎯',
      platforms: ['ios'], stores: ['App Store'],
      markets: ['US', 'UK'], owner: 'Omer Katz', status: 'onboarding',
      onboarding: { steps: onboardingPartial() },
    },
  ]

  const creatives: DimCreativeAsset[] = CREATIVE_DEFS.map((c) => ({ ...c, product_id: P }))

  const campaigns: DimCampaign[] = PROFILES.map((p) => ({
    campaign_id: p.id,
    product_id: P,
    channel_id: p.channel,
    name: p.name,
    objective: p.objective,
    status: p.status ?? 'active',
    geos: p.geos,
    platform: p.platform,
    start_date: isoDaysAgo(p.ageDays),
    daily_budget: p.dailyBudget,
    creative_ids: p.creatives,
  }))

  const spend: FactSpend[] = []
  const cohorts: FactCohort[] = []

  for (const p of PROFILES) {
    const activeDays = Math.min(p.ageDays, WINDOW_DAYS)
    for (let d = activeDays; d >= 1; d--) {
      const date = isoDaysAgo(d)
      const ageFrac = 1 - d / Math.max(activeDays, 1) // 0 at launch → 1 today
      // Spend ramp narrative
      let budgetMult = 1
      if (p.scaling === 'ramping') budgetMult = 0.45 + 0.75 * ageFrac
      if (p.scaling === 'declining') budgetMult = 1.15 - 0.9 * ageFrac
      if (p.status === 'paused' && d <= 10) budgetMult = 0 // paused 10 days ago
      const daySpendTotal = p.dailyBudget * budgetMult * dayFactor(date) * jitter(rng, 1, 0.12)
      if (daySpendTotal < 1) continue

      // Fatigue narrative: CPI drifts up and CTR decays over the window
      const fatigueCpiMult = p.fatigued ? 1 + 0.42 * ageFrac : 1
      const effCpi = p.cpi * fatigueCpiMult * jitter(rng, 1, 0.07)
      const effCtr = p.ctr * (p.fatigued ? 1 - 0.4 * ageFrac : 1)

      const dayInstalls = daySpendTotal / effCpi
      const weights = p.creatives.map((_, i) => 1 / (i + 1.2))
      const wSum = weights.reduce((a, b) => a + b, 0)
      p.creatives.forEach((cr, i) => {
        const share = weights[i] / wSum
        const crSpend = daySpendTotal * share
        // The oldest creative in a fatigued campaign decays hardest
        const crCtr = effCtr * (p.fatigued && i === 0 ? 0.85 : 1) * jitter(rng, 1, 0.08)
        const crInstalls = dayInstalls * share * (p.fatigued && i === 0 ? 0.92 : 1) * jitter(rng, 1, 0.1)
        const clicks = crInstalls / p.cvr
        const impressions = clicks / Math.max(crCtr, 0.001)
        spend.push({
          date,
          campaign_id: p.id,
          creative_asset_id: cr,
          spend: round2(crSpend),
          impressions: Math.round(impressions),
          clicks: Math.round(clicks),
          network_installs: Math.round(crInstalls * 1.08), // networks over-report
        })
      })

      // Cohort facts (attribution + events + revenue source of truth)
      const installs = Math.max(1, Math.round(dayInstalls * jitter(rng, 0.97, 0.05)))
      const activated = Math.round(installs * jitter(rng, p.activation, 0.08))
      const d1r = jitter(rng, p.d1, 0.09)
      const cohortAge = d
      const payersBase = installs * p.payerRate * jitter(rng, 1, 0.25)
      const payers = cohortAge >= 1 ? Math.round(payersBase) : Math.round(payersBase * 0.55)
      // Monetization curve: cohort converges to spend × d30Roas, distributed
      // over a power-law decay shaped by revSlope; only elapsed days observed.
      const maxAge = Math.min(cohortAge, 31)
      const k = 1.6 - 0.45 * p.revSlope
      const decayWeights = Array.from({ length: 31 }, (_, a) => Math.pow(a + 1, -k))
      const decaySum = decayWeights.reduce((a, b) => a + b, 0)
      const cohortRevD30 = daySpendTotal * p.d30Roas * jitter(rng, 1, 0.18)
      const revenueByAge: number[] = []
      let whaleRevenue = 0
      for (let a = 0; a < maxAge; a++) {
        revenueByAge.push(round2((cohortRevD30 * decayWeights[a] / decaySum) * jitter(rng, 1, 0.2)))
      }
      // Whale narrative: one cohort ~12 days ago gets a single massive payer
      if (p.whale && d === 12) {
        whaleRevenue = 1450
        if (revenueByAge.length > 2) revenueByAge[2] += whaleRevenue
        else if (revenueByAge.length > 0) revenueByAge[0] += whaleRevenue
      }
      const totalRev = revenueByAge.reduce((a, b) => a + b, 0)
      cohorts.push({
        cohort_date: date,
        campaign_id: p.id,
        installs,
        matched_installs: Math.round(installs * jitter(rng, p.matchRate, 0.03)),
        activated,
        meaningful_sessions: Math.round(activated * jitter(rng, 0.82, 0.06)),
        d1_retained: Math.round(installs * d1r),
        d3_retained: Math.round(installs * d1r * 0.62),
        d7_retained: Math.round(installs * jitter(rng, p.d1 * p.d7ratio, 0.12)),
        sessions_per_user: round2(jitter(rng, 1.4 + p.d1 * 3.5, 0.1)),
        depth_l3_share: round4(jitter(rng, p.depthL3, 0.1)),
        payers,
        repeat_payers: Math.round(payers * jitter(rng, 0.42, 0.2)),
        revenue_by_age: revenueByAge,
        top_payer_revenue: round2(whaleRevenue > 0 ? whaleRevenue : totalRev * jitter(rng, 0.12, 0.5)),
        refunds: round2(totalRev * jitter(rng, 0.015, 0.6)),
      })
    }
  }

  // Store performance: DE conversion drop narrative in last 10 days
  const store: FactStoreDaily[] = []
  const storeGeos = ['US', 'UK', 'DE', 'JP', 'BR']
  for (let d = 30; d >= 1; d--) {
    const date = isoDaysAgo(d)
    for (const geo of storeGeos) {
      const base = geo === 'US' ? 52000 : geo === 'DE' ? 15000 : geo === 'JP' ? 11000 : geo === 'UK' ? 13000 : 20000
      const impressions = Math.round(base * dayFactor(date) * jitter(rng, 1, 0.1))
      let cvrPage = geo === 'JP' ? 0.34 : 0.29
      // DE narrative: store conversion drops after a bad screenshot update 10 days ago
      if (geo === 'DE' && d <= 10) cvrPage *= 0.68
      const pageViews = Math.round(impressions * jitter(rng, 0.31, 0.08))
      const installsTotal = Math.round(pageViews * jitter(rng, cvrPage, 0.07))
      const paidShare = geo === 'US' ? 0.62 : 0.45
      const negShare = geo === 'DE' && d <= 10 ? 0.31 : 0.12
      store.push({
        date,
        product_id: P,
        geo,
        impressions,
        page_views: pageViews,
        installs_organic: Math.round(installsTotal * (1 - paidShare)),
        installs_paid: Math.round(installsTotal * paidShare),
        rating: round2(geo === 'DE' && d <= 10 ? 4.1 : 4.6),
        reviews_count: randInt(rng, 25, 90),
        negative_review_share: round4(jitter(rng, negShare, 0.2)),
      })
    }
  }

  const keywords: KeywordRank[] = [
    { keyword: 'puzzle games', geo: 'US', rank: 14, rank_prev_week: 17, impressions_share: 0.062 },
    { keyword: 'brain games', geo: 'US', rank: 22, rank_prev_week: 21, impressions_share: 0.031 },
    { keyword: 'satisfying games', geo: 'US', rank: 4, rank_prev_week: 9, impressions_share: 0.19 },
    { keyword: 'reveal puzzle', geo: 'US', rank: 1, rank_prev_week: 1, impressions_share: 0.64 },
    { keyword: 'puzzle spiele', geo: 'DE', rank: 31, rank_prev_week: 18, impressions_share: 0.018 },
    { keyword: 'rätsel spiele', geo: 'DE', rank: 27, rank_prev_week: 16, impressions_share: 0.022 },
    { keyword: 'パズルゲーム', geo: 'JP', rank: 19, rank_prev_week: 24, impressions_share: 0.041 },
  ]

  // Social content with a trending concept candidate
  const socialTitles: Array<[string, FactSocialContent['platform'], number, number, string[], boolean]> = [
    ['POV: you finally solve the impossible level', 'tiktok', 2_400_000, 0.11, ['#satisfying', '#puzzletok'], true],
    ['Rating viral puzzle games until I find a good one', 'tiktok', 890_000, 0.084, ['#gamereview', '#puzzletok'], true],
    ['ASMR reveal compilation (part 7)', 'tiktok', 410_000, 0.062, ['#asmr', '#satisfying'], false],
    ['Speedrunning AppReel level 40', 'youtube', 156_000, 0.048, ['#speedrun'], false],
    ['My grandma is better at this than me', 'tiktok', 1_150_000, 0.096, ['#family', '#challenge'], true],
    ['Puzzle setup that lives in my head rent free', 'instagram', 220_000, 0.055, ['#aesthetic'], false],
    ['Trying the "impossible" level everyone talks about', 'tiktok', 640_000, 0.071, ['#challenge', '#puzzletok'], false],
    ['Behind the scenes: how levels get designed', 'youtube', 89_000, 0.052, ['#gamedev'], false],
    ['This sound + this game = addiction', 'tiktok', 1_780_000, 0.104, ['#trendsound', '#satisfying'], true],
    ['AppReel vs the clone apps (honest review)', 'youtube', 134_000, 0.058, ['#comparison'], false],
  ]
  const social: FactSocialContent[] = socialTitles.map(([title, platform, views, er, tags, cand], i) => ({
    content_id: `sc-${i + 1}`,
    product_id: P,
    platform,
    title,
    posted_at: isoDaysAgo(randInt(rng, 1, 21)),
    views: Math.round(views * jitter(rng, 1, 0.1)),
    engagement_rate: round4(jitter(rng, er, 0.1)),
    shares: Math.round(views * er * 0.2),
    comments: Math.round(views * er * 0.35),
    sentiment: round2(jitter(rng, i === 1 ? 0.2 : 0.62, 0.3)),
    trend_tags: tags,
    concept_candidate: cand,
    paired_concept: cand ? (i === 8 ? 'Trend Rider' : i === 4 ? 'Family Challenge' : 'Fail → Reveal') : null,
  }))

  // Connector health — Unity attribution incident + TikTok schema drift narrative
  const mkHistory = (okAll: boolean, failCount = 0) =>
    Array.from({ length: 14 }, (_, i) => ({
      ts: now - (13 - i) * 6 * 3600_000,
      ok: okAll ? true : i < 14 - failCount,
      duration_s: randInt(rng, 40, 300),
      rows: randInt(rng, 8_000, 220_000),
    }))

  const connectors: ConnectorStatus[] = [
    { source_id: 'meta', name: 'Meta Marketing API', category: 'ad_network', last_sync_ts: now - 1.2 * 3600_000, freshness_sla_hours: 6, freshness_hours: 1.2, coverage: 0.99, match_rate: 0.93, undefined_share: 0.03, duplicate_rate: 0.002, schema_drift: false, late_data_impact: 0.01, failing_jobs: 0, sync_history: mkHistory(true) },
    { source_id: 'google', name: 'Google Ads API', category: 'ad_network', last_sync_ts: now - 2.1 * 3600_000, freshness_sla_hours: 6, freshness_hours: 2.1, coverage: 0.98, match_rate: 0.9, undefined_share: 0.05, duplicate_rate: 0.001, schema_drift: false, late_data_impact: 0.02, failing_jobs: 0, sync_history: mkHistory(true) },
    { source_id: 'tiktok', name: 'TikTok Ads API', category: 'ad_network', last_sync_ts: now - 3.4 * 3600_000, freshness_sla_hours: 6, freshness_hours: 3.4, coverage: 0.95, match_rate: 0.9, undefined_share: 0.06, duplicate_rate: 0.004, schema_drift: true, schema_drift_note: 'Field `video_watched_2s` renamed to `video_views_p2s` in v1.3 — mapper patched, validating backfill', late_data_impact: 0.03, failing_jobs: 0, sync_history: mkHistory(false, 1) },
    { source_id: 'applovin', name: 'AppLovin Reporting', category: 'ad_network', last_sync_ts: now - 4.8 * 3600_000, freshness_sla_hours: 8, freshness_hours: 4.8, coverage: 0.97, match_rate: 0.88, undefined_share: 0.08, duplicate_rate: 0.003, schema_drift: false, late_data_impact: 0.02, failing_jobs: 0, sync_history: mkHistory(true) },
    { source_id: 'unity', name: 'Unity Ads Reporting', category: 'ad_network', last_sync_ts: now - 11.5 * 3600_000, freshness_sla_hours: 8, freshness_hours: 11.5, coverage: 0.84, match_rate: 0.61, undefined_share: 0.24, duplicate_rate: 0.006, schema_drift: false, late_data_impact: 0.08, failing_jobs: 2, sync_history: mkHistory(false, 3) },
    { source_id: 'mmp', name: 'AppsFlyer (MMP)', category: 'attribution', last_sync_ts: now - 0.8 * 3600_000, freshness_sla_hours: 3, freshness_hours: 0.8, coverage: 0.99, match_rate: 0.91, undefined_share: 0.07, duplicate_rate: 0.002, schema_drift: false, late_data_impact: 0.02, failing_jobs: 0, sync_history: mkHistory(true) },
    { source_id: 'events', name: 'Product Events Stream', category: 'product_events', last_sync_ts: now - 0.3 * 3600_000, freshness_sla_hours: 2, freshness_hours: 0.3, coverage: 0.99, match_rate: 0.96, undefined_share: 0.02, duplicate_rate: 0.005, schema_drift: false, late_data_impact: 0.01, failing_jobs: 0, sync_history: mkHistory(true) },
    { source_id: 'revenue', name: 'Revenue Backend', category: 'revenue', last_sync_ts: now - 1.6 * 3600_000, freshness_sla_hours: 4, freshness_hours: 1.6, coverage: 0.99, match_rate: 0.97, undefined_share: 0.01, duplicate_rate: 0.001, schema_drift: false, late_data_impact: 0.01, failing_jobs: 0, sync_history: mkHistory(true) },
    { source_id: 'store', name: 'App Store / Play Console', category: 'store', last_sync_ts: now - 9 * 3600_000, freshness_sla_hours: 24, freshness_hours: 9, coverage: 0.96, match_rate: 1, undefined_share: 0.0, duplicate_rate: 0.0, schema_drift: false, late_data_impact: 0.04, failing_jobs: 0, sync_history: mkHistory(true) },
    { source_id: 'social', name: 'Social Listening', category: 'social', last_sync_ts: now - 5 * 3600_000, freshness_sla_hours: 12, freshness_hours: 5, coverage: 0.9, match_rate: 1, undefined_share: 0.0, duplicate_rate: 0.008, schema_drift: false, late_data_impact: 0.02, failing_jobs: 0, sync_history: mkHistory(true) },
  ]

  return {
    products, channels: CHANNELS, campaigns, creatives, spend, cohorts,
    store, keywords, social, connectors, users: USERS, generated_at: now,
  }
}

function onboardingComplete() {
  const labels: [string, string, string][] = [
    ['registration', 'Product Registration', 'product_id, platforms, stores, markets, owners'],
    ['identity', 'Identity Contract', 'ID merge rules, reinstall behavior'],
    ['events', 'Event Taxonomy', 'Event names, required fields, versioning'],
    ['depth', 'Depth Mapping', 'L1–L5 product layers'],
    ['revenue', 'Revenue Contract', 'Source of truth, net/gross, refunds'],
    ['attribution', 'Attribution Contract', 'MMP mapping, windows, organic rules'],
    ['creative', 'Creative Mapping', 'Creative IDs, concepts, lineage'],
    ['thresholds', 'Threshold Configuration', 'Country/channel guardrails'],
    ['data_qa', 'Data QA', 'Freshness, coverage, reconciliation'],
    ['go_live', 'Go-Live Approval', 'Owner sign-off, monitoring window'],
  ]
  return labels.map(([id, label, description]) => ({
    id: id as any, label, description, status: 'complete' as const,
  }))
}

function onboardingPartial() {
  const done = new Set(['registration', 'identity', 'events'])
  const inProg = new Set(['depth'])
  const blocked = new Set(['revenue'])
  return onboardingComplete().map((s) => ({
    ...s,
    status: done.has(s.id) ? ('complete' as const)
      : inProg.has(s.id) ? ('in_progress' as const)
      : blocked.has(s.id) ? ('blocked' as const)
      : ('pending' as const),
    detail: s.id === 'revenue' ? 'Waiting for finance to confirm net revenue definition (VAT handling)' :
      s.id === 'depth' ? 'L3/L4 events instrumented, awaiting validation window' : undefined,
  }))
}

const round2 = (v: number) => Math.round(v * 100) / 100
const round4 = (v: number) => Math.round(v * 10000) / 10000
