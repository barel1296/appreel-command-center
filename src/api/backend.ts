// ─────────────────────────────────────────────────────────────────────────────
// API layer. `GrowthApi` is the contract a real backend must implement; the
// exported `api` object is the SIMULATED implementation: canonical facts come
// from the deterministic generator (clearly marked simulation), while all
// workspace state (decisions, ledger, alerts, config versions, audit, copilot
// history, session) is REAL and persisted to localStorage. Network latency is
// simulated so loading states behave like production.
// ─────────────────────────────────────────────────────────────────────────────
import { generateDataset, type Dataset } from '@/domain/seed/generator'
import { applyRealData, fetchRealData, lastFetchError } from './realSource'
import { runDecisionEngine } from '@/domain/decision/engine'
import { deriveAlerts } from '@/domain/alerts/engine'
import { defaultProductConfig, type ConfigVersion, type ProductConfig } from '@/domain/config'
import type {
  Alert, AuditEvent, LedgerEntry, Recommendation, User,
} from '@/domain/types'

// v2: workspace state namespace bumped when the live AppReel connection
// landed, so decisions made against simulated campaigns don't bleed into the
// real workspace. (v1 keys are simply orphaned.)
const LS_PREFIX = 'arc.v1.'
const DAY = 86400_000

const load = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
const save = (key: string, value: unknown) => {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value))
  } catch {
    // Quota/private-mode failures degrade to in-memory only
  }
}

const latency = (ms = 300) => new Promise<void>((res) => setTimeout(res, ms + Math.random() * 200))

export interface WorkspaceSnapshot {
  dataset: Dataset
  config: ProductConfig
  configVersions: ConfigVersion[]
  recommendations: Recommendation[]
  alerts: Alert[]
  ledger: LedgerEntry[]
  audit: AuditEvent[]
  currentUserId: string
  realConnected: boolean
  /** Non-null when the live source was tried and failed. */
  liveError: string | null
}

class SimulatedBackend {
  private dataset: Dataset | null = null
  private realConnected = false
  private liveError: string | null = null

  private async ensureDataset(): Promise<Dataset> {
    if (!this.dataset) {
      const sim = generateDataset()
      // Try the live AppReel connection (Meta Ads via Supabase);
      // fall back to full simulation when unreachable.
      const real = await fetchRealData()
      if (real) {
        this.dataset = applyRealData(sim, real)
        this.realConnected = true
      } else {
        this.dataset = sim
        this.realConnected = false
        this.liveError = lastFetchError
      }
    }
    return this.dataset
  }

  async fetchWorkspace(): Promise<WorkspaceSnapshot> {
    await latency(650)
    const ds = await this.ensureDataset()

    let configVersions = load<ConfigVersion[]>('configVersions', [])
    if (configVersions.length === 0) {
      configVersions = [{
        version: 1,
        saved_at: ds.generated_at - 21 * DAY,
        saved_by: 'Alex Morgan',
        note: 'Initial thresholds from onboarding sign-off',
        config: defaultProductConfig('appreel'),
      }]
      save('configVersions', configVersions)
    }
    const config = configVersions[configVersions.length - 1].config

    // Engine outputs are recomputed on load (they derive from facts + config);
    // workflow state on top of them is merged from persistence.
    const engineRecs = runDecisionEngine(ds, config)
    const savedRecState = load<Record<string, Partial<Recommendation>>>('recState', {})
    const recommendations = engineRecs.map((r) => ({ ...r, ...savedRecState[r.recommendation_id] }))

    const engineAlerts = deriveAlerts(ds, config, recommendations)
    const savedAlertState = load<Record<string, Partial<Alert>>>('alertState', {})
    const alerts = engineAlerts.map((a) => ({ ...a, ...savedAlertState[a.alert_id] }))

    // Demo history is only seeded in pure-simulation mode; with live data the
    // ledger/audit start from the real decisions made in this workspace.
    let ledger = load<LedgerEntry[]>('ledger', [])
    if (ledger.length === 0 && !this.realConnected) {
      ledger = seedLedger(ds)
      save('ledger', ledger)
    }
    let audit = load<AuditEvent[]>('audit', [])
    if (audit.length === 0) {
      audit = this.realConnected
        ? [{ id: 'au-1', ts: ds.generated_at, actor: 'system', action: 'workspace.connect', target: 'AppReel', detail: 'Live source attached: Meta Ads — account AppReel UTC (780499204349049). No MMP, revenue-value or product event source connected yet.' }]
        : seedAudit(ds)
      save('audit', audit)
    }

    return {
      dataset: ds,
      config,
      configVersions,
      recommendations,
      alerts,
      ledger,
      audit,
      currentUserId: load<string>('currentUser', 'u-dana'),
      realConnected: this.realConnected,
      liveError: this.liveError,
    }
  }

  // Persist deltas (workflow state only — facts are derived)
  persistRecommendations(recs: Recommendation[]) {
    const state: Record<string, Partial<Recommendation>> = {}
    for (const r of recs) {
      state[r.recommendation_id] = {
        approval_status: r.approval_status,
        owner: r.owner,
        next_review_at: r.next_review_at,
      }
    }
    save('recState', state)
  }

  persistAlerts(alerts: Alert[]) {
    const state: Record<string, Partial<Alert>> = {}
    for (const a of alerts) {
      state[a.alert_id] = {
        state: a.state,
        owner: a.owner,
        resolution_note: a.resolution_note,
        timeline: a.timeline,
      }
    }
    save('alertState', state)
  }

  persistLedger(ledger: LedgerEntry[]) { save('ledger', ledger) }
  persistAudit(audit: AuditEvent[]) { save('audit', audit.slice(-400)) }
  persistUser(userId: string) { save('currentUser', userId) }
  persistConfigVersions(versions: ConfigVersion[]) { save('configVersions', versions) }
  persistOnboarding(productId: string, stepStatuses: Record<string, string>) {
    save('onboarding.' + productId, stepStatuses)
  }
  loadOnboarding(productId: string): Record<string, string> {
    return load('onboarding.' + productId, {})
  }

  // Re-pull the canonical facts from the live source. Workspace state
  // (decisions, ledger, alerts, config, audit) is untouched — it is merged
  // back on top in fetchWorkspace.
  async refreshWorkspace(): Promise<WorkspaceSnapshot> {
    this.dataset = null
    return this.fetchWorkspace()
  }

  async resetWorkspace(): Promise<void> {
    await latency(200)
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(LS_PREFIX)) localStorage.removeItem(k)
    }
    this.dataset = null
  }
}

// Pre-existing decision history so the ledger demonstrates outcomes/post-mortems
function seedLedger(ds: Dataset): LedgerEntry[] {
  const t0 = ds.generated_at
  const paused = ds.campaigns.find((c) => c.campaign_id === 'c-tiktok-t2-old')
  const entries: LedgerEntry[] = []
  if (paused) {
    entries.push({
      decision_id: 'dl-0001',
      recommendation: {
        recommendation_id: 'rec-c-tiktok-t2-old-pause',
        created_at: t0 - 11 * DAY,
        product_id: 'appreel',
        scope: { level: 'campaign', campaign_id: paused.campaign_id, channel_id: 'tiktok', label: 'TikTok · MX, TH, VN' },
        recommendation_type: 'pause',
        title: 'Pause TT_T2_Android_Broad_v1 — quality below floor across all geos',
        reason: 'Activation 42% and D1 21% stayed under minimums for 3 consecutive weeks while CPI drifted up 22%. Optimistic D30 ROAS scenario 0.31x — below the 0.55x floor.',
        evidence: [
          { metric: 'D1 retention', value: '21.0%', benchmark: 'min 32%', verdict: 'bad' },
          { metric: 'Pred. D30 ROAS (high)', value: '0.31x', benchmark: 'min 0.55x', verdict: 'bad' },
          { metric: 'CPI drift', value: '+22%', benchmark: 'flat', verdict: 'bad' },
        ],
        risk_level: 'high',
        confidence: 'high',
        confidence_note: '↑ 3 weeks of consistent evidence, adequate sample',
        expected_impact: 'Frees ~$3.1K/week for reallocation',
        data_quality: 'green',
        requires_approval: true,
        suggested_action: 'Pause; re-test only with new creative mix',
        monitoring_window_days: 7,
        stop_condition: 'Re-test after new T2 creative batch ships',
        priority: 85,
        next_review_at: t0 - 3 * DAY,
        approval_status: 'closed',
        owner: 'Dana Peretz',
        stage_lights: { media: 'yellow', quality: 'red', monetization: 'red', creative: 'yellow', data: 'green' },
      },
      decided_by: 'Dana Peretz',
      decided_at: t0 - 10 * DAY,
      action: 'approved',
      note: 'Agreed — reallocating budget to META_T1. Re-test gated on the new UGC batch.',
      outcome: {
        status: 'positive',
        summary: 'Post-review at +7d: reallocated spend to META_T1_Android delivered blended D1 +9pp at equal CPI. Pause validated.',
        reviewed_at: t0 - 3 * DAY,
      },
      history: [
        { ts: t0 - 11 * DAY, actor: 'system', event: 'Recommendation proposed (priority 85)' },
        { ts: t0 - 10 * DAY, actor: 'Dana Peretz', event: 'Approved with note' },
        { ts: t0 - 10 * DAY + 3600_000, actor: 'Yoni Bar', event: 'Executed — campaign paused in TikTok Ads' },
        { ts: t0 - 3 * DAY, actor: 'Dana Peretz', event: 'Outcome reviewed: positive. Closed.' },
      ],
    })
    entries.push({
      decision_id: 'dl-0002',
      recommendation: {
        recommendation_id: 'rec-hist-meta-scale-1',
        created_at: t0 - 6 * DAY,
        product_id: 'appreel',
        scope: { level: 'campaign', campaign_id: 'c-meta-us-core', channel_id: 'meta', label: 'Meta · US' },
        recommendation_type: 'scale',
        title: 'Scale META_US_iOS_Purchase_Core +20%',
        reason: 'All stage lights green, predicted D30 ROAS 0.71x base with conservative 0.58x above floor. Marginal CPI stable.',
        evidence: [
          { metric: 'Pred. D30 ROAS', value: '0.71x', benchmark: 'min 0.55x', verdict: 'good' },
          { metric: 'D1 retention', value: '40.8%', benchmark: 'min 32%', verdict: 'good' },
        ],
        risk_level: 'medium',
        confidence: 'high',
        confidence_note: '↑ Adequate sample and payer base',
        expected_impact: '+$9K/month spend at 0.71x predicted D30',
        data_quality: 'green',
        requires_approval: true,
        suggested_action: 'Raise daily budget $1,500 → $1,800',
        monitoring_window_days: 7,
        stop_condition: 'Roll back if marginal CPI > 1.35x window average',
        priority: 80,
        next_review_at: t0 + 1 * DAY,
        approval_status: 'monitored',
        owner: 'Dana Peretz',
        stage_lights: { media: 'green', quality: 'green', monetization: 'green', creative: 'green', data: 'green' },
      },
      decided_by: 'Dana Peretz',
      decided_at: t0 - 5 * DAY,
      action: 'executed',
      note: 'Executed in one step per playbook; bids untouched.',
      outcome: {
        status: 'monitoring',
        summary: 'Day 5 of 7 monitoring window: CPI +4% (within tolerance), D1 stable at 41%. On track.',
        reviewed_at: null,
      },
      history: [
        { ts: t0 - 6 * DAY, actor: 'system', event: 'Recommendation proposed (priority 80)' },
        { ts: t0 - 5 * DAY, actor: 'Dana Peretz', event: 'Approved' },
        { ts: t0 - 5 * DAY + 7200_000, actor: 'Yoni Bar', event: 'Executed — budget raised in Meta Ads Manager' },
        { ts: t0 - 2 * DAY, actor: 'system', event: 'Monitoring check 1: within stop-condition bounds' },
      ],
    })
  }
  return entries
}

function seedAudit(ds: Dataset): AuditEvent[] {
  const t0 = ds.generated_at
  return [
    { id: 'au-1', ts: t0 - 21 * DAY, actor: 'Alex Morgan', action: 'config.create', target: 'Thresholds v1', detail: 'Initial thresholds from onboarding sign-off' },
    { id: 'au-2', ts: t0 - 14 * DAY, actor: 'Alex Morgan', action: 'rbac.grant', target: 'Dana Peretz', detail: 'Role growth_lead granted (approve/execute scope)' },
    { id: 'au-3', ts: t0 - 11 * DAY, actor: 'system', action: 'recommendation.proposed', target: 'TT_T2_Android_Broad_v1', detail: 'Pause recommendation, priority 85' },
    { id: 'au-4', ts: t0 - 10 * DAY, actor: 'Dana Peretz', action: 'recommendation.approved', target: 'TT_T2_Android_Broad_v1', detail: 'Pause approved with reallocation note' },
    { id: 'au-5', ts: t0 - 10 * DAY + 3600_000, actor: 'Yoni Bar', action: 'action.executed', target: 'TT_T2_Android_Broad_v1', detail: 'Campaign paused in TikTok Ads' },
    { id: 'au-6', ts: t0 - 6 * DAY, actor: 'system', action: 'connector.incident', target: 'Unity Ads Reporting', detail: 'Match rate degradation first detected (warning level)' },
    { id: 'au-7', ts: t0 - 5 * DAY, actor: 'Dana Peretz', action: 'recommendation.approved', target: 'META_US_iOS_Purchase_Core', detail: 'Scale +20% approved' },
    { id: 'au-8', ts: t0 - 2 * DAY, actor: 'system', action: 'model.monitor', target: 'Early LTV v1.2', detail: 'Weekly calibration check passed (Brier 0.11)' },
  ]
}

export const api = new SimulatedBackend()
