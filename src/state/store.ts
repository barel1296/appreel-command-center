// Global workspace store. Loads the snapshot from the API layer, exposes all
// workflow actions with RBAC checks, audit logging, persistence, and undo.
import { create } from 'zustand'
import { api, type WorkspaceSnapshot } from '@/api/backend'
import type { Dataset } from '@/domain/seed/generator'
import type {
  Alert, AlertState, ApprovalStatus, AuditEvent, CampaignMetrics, CopilotMessage,
  LedgerEntry, Recommendation, User,
} from '@/domain/types'
import { can, type ConfigVersion, type PermAction, type ProductConfig, type Thresholds } from '@/domain/config'
import { computeCampaignMetrics } from '@/domain/metrics/compute'
import { buildAgentContext, answerQuestion } from '@/domain/agents/copilot'
import { runDecisionEngine } from '@/domain/decision/engine'
import { useToasts } from './toasts'
import { fmtAgo } from '@/lib/format'

const DAY = 86400_000

interface AppState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  dataset: Dataset | null
  config: ProductConfig | null
  configVersions: ConfigVersion[]
  recommendations: Recommendation[]
  alerts: Alert[]
  ledger: LedgerEntry[]
  audit: AuditEvent[]
  currentUserId: string
  realConnected: boolean
  refreshing: boolean
  lastRefreshedAt: number | null
  dateRange: { from: string; to: string }
  // Empty array = all countries. Persisted like the date range.
  countries: string[]
  /** Global platform filter. 'all' = blended, matching the old behaviour. */
  platform: 'all' | 'ios' | 'android'
  revenueSource: 'ad' | 'ad_iap'
  copilotMessages: CopilotMessage[]
  copilotThinking: boolean
  metricsCache: Map<string, CampaignMetrics>
  productId: string

  init: () => Promise<void>
  retry: () => Promise<void>
  refreshData: () => Promise<void>
  resetWorkspace: () => Promise<void>
  currentUser: () => User
  hasPerm: (action: PermAction) => boolean
  switchUser: (userId: string) => void
  setDateRange: (from: string, to: string) => void
  setCountries: (c: string[]) => void
  setPlatform: (p: 'all' | 'ios' | 'android') => void
  setRevenueSource: (s: 'ad' | 'ad_iap') => void
  campaignMetrics: (campaignId: string) => CampaignMetrics | null

  decideRecommendation: (recId: string, decision: 'approved' | 'rejected', note: string) => void
  executeRecommendation: (recId: string) => void
  markOutcome: (decisionId: string, status: 'positive' | 'negative' | 'neutral', summary: string) => void
  undoDecision: (recId: string) => void

  setAlertState: (alertId: string, state: AlertState, note?: string) => void
  assignAlert: (alertId: string, ownerName: string) => void

  saveConfig: (thresholds: Thresholds, note: string) => void
  rollbackConfig: (version: number) => void

  setOnboardingStep: (productId: string, stepId: string, status: string) => void

  askCopilot: (question: string) => void
  clearCopilot: () => void

  logAudit: (action: string, target: string, detail: string) => void
}

let undoBuffer: { recId: string; prev: ApprovalStatus; prevOwner: string | null; ledgerId: string | null } | null = null

export const useApp = create<AppState>((set, get) => ({
  status: 'idle',
  error: null,
  dataset: null,
  config: null,
  configVersions: [],
  recommendations: [],
  alerts: [],
  ledger: [],
  audit: [],
  currentUserId: 'u-dana',
  realConnected: false,
  refreshing: false,
  lastRefreshedAt: null,
  dateRange: loadDateRange(),
  countries: loadJson<string[]>('arc.v1.countries', []),
  platform: loadJson<'all' | 'ios' | 'android'>('arc.v1.platform', 'all'),
  revenueSource: loadJson<'ad' | 'ad_iap'>('arc.v1.revenueSource', 'ad_iap'),
  copilotMessages: [],
  copilotThinking: false,
  metricsCache: new Map(),
  productId: 'appreel',

  init: async () => {
    if (get().status === 'loading') return
    set({ status: 'loading', error: null })
    try {
      const snap: WorkspaceSnapshot = await api.fetchWorkspace()
      // Merge persisted onboarding step states
      for (const p of snap.dataset.products) {
        const savedSteps = api.loadOnboarding(p.product_id)
        p.onboarding.steps = p.onboarding.steps.map((s) =>
          savedSteps[s.id] ? { ...s, status: savedSteps[s.id] as any } : s,
        )
      }
      set({
        status: 'ready',
        dataset: snap.dataset,
        config: snap.config,
        configVersions: snap.configVersions,
        recommendations: snap.recommendations,
        alerts: snap.alerts,
        ledger: snap.ledger,
        audit: snap.audit,
        currentUserId: snap.currentUserId,
        realConnected: snap.realConnected,
        copilotMessages: loadCopilot(),
        metricsCache: new Map(),
      })
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : 'Failed to load workspace' })
    }
  },

  retry: async () => {
    set({ status: 'idle' })
    await get().init()
  },

  // Re-pull canonical facts from the live source and re-run the decision
  // engine. Decisions, ledger, alert progress, config and audit survive —
  // they are workspace state, merged back on top of the fresh facts.
  refreshData: async () => {
    if (get().refreshing || get().status !== 'ready') return
    set({ refreshing: true })
    try {
      const snap: WorkspaceSnapshot = await api.refreshWorkspace()
      for (const p of snap.dataset.products) {
        const savedSteps = api.loadOnboarding(p.product_id)
        p.onboarding.steps = p.onboarding.steps.map((s) =>
          savedSteps[s.id] ? { ...s, status: savedSteps[s.id] as any } : s,
        )
      }
      set({
        dataset: snap.dataset,
        config: snap.config,
        configVersions: snap.configVersions,
        recommendations: snap.recommendations,
        alerts: snap.alerts,
        ledger: snap.ledger,
        realConnected: snap.realConnected,
        metricsCache: new Map(),
        refreshing: false,
        lastRefreshedAt: Date.now(),
      })
      const syncs = snap.dataset.sync_log ?? []
      const newest = syncs.length > 0
        ? Math.max(...syncs.map((s) => new Date(s.synced_at).getTime()))
        : null
      useToasts.getState().push({
        kind: 'success',
        title: 'Data refreshed',
        message: snap.realConnected
          ? `Canonical facts re-read and recommendations re-evaluated. Upstream sources last landed rows ${newest ? fmtAgo(newest) : 'unknown'}.`
          : 'Simulation regenerated; recommendations re-evaluated.',
      })
    } catch (e) {
      set({ refreshing: false })
      useToasts.getState().push({
        kind: 'error',
        title: 'Refresh failed',
        message: e instanceof Error ? e.message : 'Could not reach the data source. The previous data is still shown.',
      })
    }
  },

  resetWorkspace: async () => {
    await api.resetWorkspace()
    sessionStorage.removeItem('arc.copilot')
    set({ status: 'idle', copilotMessages: [] })
    await get().init()
  },

  currentUser: () => {
    const { dataset, currentUserId } = get()
    return dataset?.users.find((u) => u.user_id === currentUserId) ?? {
      user_id: 'u-view', name: 'Viewer', role: 'viewer', avatar_hue: 100,
    }
  },

  hasPerm: (action) => can(get().currentUser().role, action),

  setDateRange: (from, to) => {
    if (!from || !to || from > to) return
    set({ dateRange: { from, to } })
    try { localStorage.setItem('arc.v1.dateRange', JSON.stringify({ from, to })) } catch { /* ignore */ }
  },

  setCountries: (c) => {
    set({ countries: c })
    try { localStorage.setItem('arc.v1.countries', JSON.stringify(c)) } catch { /* ignore */ }
  },
  setPlatform: (p) => {
    set({ platform: p })
    try { localStorage.setItem('arc.v1.platform', JSON.stringify(p)) } catch { /* ignore */ }
  },

  setRevenueSource: (src) => {
    set({ revenueSource: src })
    try { localStorage.setItem('arc.v1.revenueSource', JSON.stringify(src)) } catch { /* ignore */ }
  },

  switchUser: (userId) => {
    set({ currentUserId: userId })
    api.persistUser(userId)
    const u = get().dataset?.users.find((x) => x.user_id === userId)
    get().logAudit('session.switch', u?.name ?? userId, `Active role now ${u?.role ?? 'unknown'}`)
  },

  campaignMetrics: (campaignId) => {
    const { dataset, config, metricsCache } = get()
    if (!dataset || !config) return null
    const key = `${campaignId}|${get().configVersions.length}`
    if (!metricsCache.has(key)) {
      metricsCache.set(key, computeCampaignMetrics(dataset, campaignId, config.thresholds))
    }
    return metricsCache.get(key)!
  },

  decideRecommendation: (recId, decision, note) => {
    const state = get()
    const perm: PermAction = decision === 'approved' ? 'approve_recommendation' : 'reject_recommendation'
    if (!state.hasPerm(perm)) {
      useToasts.getState().push({ kind: 'error', title: 'Not permitted', message: `Your role (${state.currentUser().role}) cannot ${decision === 'approved' ? 'approve' : 'reject'} recommendations.` })
      return
    }
    const rec = state.recommendations.find((r) => r.recommendation_id === recId)
    if (!rec || (rec.approval_status !== 'proposed')) return // duplicate-action guard

    const user = state.currentUser()
    const ledgerId = `dl-${String(state.ledger.length + 1).padStart(4, '0')}`
    undoBuffer = { recId, prev: rec.approval_status, prevOwner: rec.owner, ledgerId }

    const updatedRec: Recommendation = { ...rec, approval_status: decision, owner: user.name }
    const entry: LedgerEntry = {
      decision_id: ledgerId,
      recommendation: updatedRec,
      decided_by: user.name,
      decided_at: Date.now(),
      action: decision,
      note,
      outcome: {
        status: decision === 'approved' ? 'pending' : 'neutral',
        summary: decision === 'approved' ? 'Awaiting execution and monitoring window.' : 'Rejected — no action taken.',
        reviewed_at: null,
      },
      history: [
        { ts: rec.created_at, actor: 'system', event: `Recommendation proposed (priority ${rec.priority})` },
        { ts: Date.now(), actor: user.name, event: `${decision === 'approved' ? 'Approved' : 'Rejected'}${note ? ` — ${note}` : ''}` },
      ],
    }
    const recommendations = state.recommendations.map((r) => (r.recommendation_id === recId ? updatedRec : r))
    const ledger = [entry, ...state.ledger]
    set({ recommendations, ledger })
    api.persistRecommendations(recommendations)
    api.persistLedger(ledger)
    get().logAudit(`recommendation.${decision}`, rec.title, note || '(no note)')
    useToasts.getState().push({
      kind: 'success',
      title: decision === 'approved' ? 'Recommendation approved' : 'Recommendation rejected',
      message: `Recorded in the Decision Ledger as ${ledgerId}.`,
      undo: () => get().undoDecision(recId),
    })
  },

  undoDecision: (recId) => {
    const state = get()
    if (!undoBuffer || undoBuffer.recId !== recId) return
    const { prev, prevOwner, ledgerId } = undoBuffer
    undoBuffer = null
    const recommendations = state.recommendations.map((r) =>
      r.recommendation_id === recId ? { ...r, approval_status: prev, owner: prevOwner } : r,
    )
    const ledger = state.ledger.filter((l) => l.decision_id !== ledgerId)
    set({ recommendations, ledger })
    api.persistRecommendations(recommendations)
    api.persistLedger(ledger)
    get().logAudit('recommendation.undo', recId, 'Decision reverted within undo window')
    useToasts.getState().push({ kind: 'info', title: 'Decision undone', message: 'The recommendation is back in the queue.' })
  },

  executeRecommendation: (recId) => {
    const state = get()
    if (!state.hasPerm('execute_action')) {
      useToasts.getState().push({ kind: 'error', title: 'Not permitted', message: `Your role (${state.currentUser().role}) cannot execute actions.` })
      return
    }
    const rec = state.recommendations.find((r) => r.recommendation_id === recId)
    if (!rec || rec.approval_status !== 'approved') return
    const user = state.currentUser()
    const updated: Recommendation = { ...rec, approval_status: 'monitored', next_review_at: Date.now() + rec.monitoring_window_days * DAY }
    const recommendations = state.recommendations.map((r) => (r.recommendation_id === recId ? updated : r))
    const ledger = state.ledger.map((l) =>
      l.recommendation.recommendation_id === recId
        ? {
            ...l,
            action: 'executed' as const,
            recommendation: updated,
            outcome: { ...l.outcome, status: 'monitoring' as const, summary: `Executed; monitoring window of ${rec.monitoring_window_days}d is running. Stop condition: ${rec.stop_condition}` },
            history: [...l.history, { ts: Date.now(), actor: user.name, event: 'Executed — action applied in the external platform' }],
          }
        : l,
    )
    set({ recommendations, ledger })
    api.persistRecommendations(recommendations)
    api.persistLedger(ledger)
    get().logAudit('action.executed', rec.title, rec.suggested_action)
    useToasts.getState().push({ kind: 'success', title: 'Action executed', message: `Monitoring window (${rec.monitoring_window_days}d) started.` })
  },

  markOutcome: (decisionId, status, summary) => {
    const state = get()
    if (!state.hasPerm('approve_recommendation')) {
      useToasts.getState().push({ kind: 'error', title: 'Not permitted', message: 'Only growth leads and admins can record outcomes.' })
      return
    }
    const user = state.currentUser()
    const ledger = state.ledger.map((l) =>
      l.decision_id === decisionId
        ? {
            ...l,
            action: 'closed' as const,
            outcome: { status, summary, reviewed_at: Date.now() },
            recommendation: { ...l.recommendation, approval_status: 'closed' as ApprovalStatus },
            history: [...l.history, { ts: Date.now(), actor: user.name, event: `Outcome reviewed: ${status}. Closed.` }],
          }
        : l,
    )
    const target = state.ledger.find((l) => l.decision_id === decisionId)
    const recommendations = target
      ? state.recommendations.map((r) => (r.recommendation_id === target.recommendation.recommendation_id ? { ...r, approval_status: 'closed' as ApprovalStatus } : r))
      : state.recommendations
    set({ ledger, recommendations })
    api.persistLedger(ledger)
    api.persistRecommendations(recommendations)
    get().logAudit('decision.outcome', decisionId, `${status}: ${summary}`)
    useToasts.getState().push({ kind: 'success', title: 'Outcome recorded', message: 'Decision closed with post-review.' })
  },

  setAlertState: (alertId, newState, note) => {
    const state = get()
    const needsPerm = newState === 'resolved' ? 'resolve_alerts' : 'assign_alerts'
    if (!state.hasPerm(needsPerm as PermAction)) {
      useToasts.getState().push({ kind: 'error', title: 'Not permitted', message: `Your role (${state.currentUser().role}) cannot ${newState === 'resolved' ? 'resolve' : 'update'} alerts.` })
      return
    }
    const user = state.currentUser()
    const labels: Record<AlertState, string> = {
      created: 'Created', assigned: 'Assigned', acknowledged: 'Acknowledged',
      investigating: 'Investigation opened', action_proposed: 'Action proposed', resolved: 'Resolved',
    }
    const alerts = state.alerts.map((a) =>
      a.alert_id === alertId
        ? {
            ...a,
            state: newState,
            owner: a.owner ?? user.name,
            resolution_note: newState === 'resolved' ? (note ?? 'Resolved') : a.resolution_note,
            timeline: [...a.timeline, { ts: Date.now(), event: `${labels[newState]}${note ? ` — ${note}` : ''}`, actor: user.name }],
          }
        : a,
    )
    set({ alerts })
    api.persistAlerts(alerts)
    get().logAudit('alert.' + newState, state.alerts.find((a) => a.alert_id === alertId)?.title ?? alertId, note ?? '')
    if (newState === 'resolved') {
      useToasts.getState().push({ kind: 'success', title: 'Alert resolved', message: note ?? 'Closed with reason.' })
    }
  },

  assignAlert: (alertId, ownerName) => {
    const state = get()
    if (!state.hasPerm('assign_alerts')) {
      useToasts.getState().push({ kind: 'error', title: 'Not permitted', message: 'Your role cannot assign alerts.' })
      return
    }
    const user = state.currentUser()
    const alerts = state.alerts.map((a) =>
      a.alert_id === alertId
        ? {
            ...a,
            owner: ownerName,
            state: (a.state === 'created' ? 'assigned' : a.state) as AlertState,
            timeline: [...a.timeline, { ts: Date.now(), event: `Assigned to ${ownerName}`, actor: user.name }],
          }
        : a,
    )
    set({ alerts })
    api.persistAlerts(alerts)
    get().logAudit('alert.assigned', alertId, `Owner: ${ownerName}`)
  },

  saveConfig: (thresholds, note) => {
    const state = get()
    if (!state.hasPerm('edit_config')) {
      useToasts.getState().push({ kind: 'error', title: 'Not permitted', message: 'Your role cannot edit configuration.' })
      return
    }
    if (!state.config || !state.dataset) return
    const user = state.currentUser()
    const newConfig: ProductConfig = { ...state.config, thresholds }
    const version: ConfigVersion = {
      version: state.configVersions.length + 1,
      saved_at: Date.now(),
      saved_by: user.name,
      note,
      config: newConfig,
    }
    const configVersions = [...state.configVersions, version]
    // Config change re-runs the decision engine (thresholds drive recommendations)
    const engineRecs = runDecisionEngine(state.dataset, newConfig)
    const oldByid = new Map(state.recommendations.map((r) => [r.recommendation_id, r]))
    const recommendations = engineRecs.map((r) => {
      const old = oldByid.get(r.recommendation_id)
      return old && old.approval_status !== 'proposed' ? { ...r, approval_status: old.approval_status, owner: old.owner } : r
    })
    set({ config: newConfig, configVersions, recommendations, metricsCache: new Map() })
    api.persistConfigVersions(configVersions)
    api.persistRecommendations(recommendations)
    get().logAudit('config.save', `Thresholds v${version.version}`, note)
    useToasts.getState().push({ kind: 'success', title: `Configuration v${version.version} saved`, message: 'Decision engine re-evaluated all open recommendations.' })
  },

  rollbackConfig: (versionNum) => {
    const state = get()
    if (!state.hasPerm('rollback_config')) {
      useToasts.getState().push({ kind: 'error', title: 'Not permitted', message: 'Only admins can roll back configuration.' })
      return
    }
    const target = state.configVersions.find((v) => v.version === versionNum)
    if (!target || !state.dataset) return
    const user = state.currentUser()
    const version: ConfigVersion = {
      version: state.configVersions.length + 1,
      saved_at: Date.now(),
      saved_by: user.name,
      note: `Rollback to v${versionNum}`,
      config: target.config,
    }
    const configVersions = [...state.configVersions, version]
    const engineRecs = runDecisionEngine(state.dataset, target.config)
    const oldByid = new Map(state.recommendations.map((r) => [r.recommendation_id, r]))
    const recommendations = engineRecs.map((r) => {
      const old = oldByid.get(r.recommendation_id)
      return old && old.approval_status !== 'proposed' ? { ...r, approval_status: old.approval_status, owner: old.owner } : r
    })
    set({ config: target.config, configVersions, recommendations, metricsCache: new Map() })
    api.persistConfigVersions(configVersions)
    api.persistRecommendations(recommendations)
    get().logAudit('config.rollback', `→ v${versionNum} (as v${version.version})`, 'Restored previous threshold set')
    useToasts.getState().push({ kind: 'success', title: `Rolled back to v${versionNum}`, message: `Saved as new version v${version.version} (audit preserved).` })
  },

  setOnboardingStep: (productId, stepId, status) => {
    const state = get()
    if (!state.hasPerm('manage_onboarding')) {
      useToasts.getState().push({ kind: 'error', title: 'Not permitted', message: 'Your role cannot manage onboarding.' })
      return
    }
    if (!state.dataset) return
    const dataset = {
      ...state.dataset,
      products: state.dataset.products.map((p) =>
        p.product_id === productId
          ? { ...p, onboarding: { steps: p.onboarding.steps.map((s) => (s.id === stepId ? { ...s, status: status as any } : s)) } }
          : p,
      ),
    }
    set({ dataset })
    const stepStatuses: Record<string, string> = {}
    for (const s of dataset.products.find((p) => p.product_id === productId)!.onboarding.steps) stepStatuses[s.id] = s.status
    api.persistOnboarding(productId, stepStatuses)
    get().logAudit('onboarding.step', `${productId}/${stepId}`, `Status → ${status}`)
  },

  askCopilot: (question) => {
    const state = get()
    if (!state.dataset || !state.config || state.copilotThinking) return
    const userMsg: CopilotMessage = { id: `cm-${Date.now()}`, role: 'user', text: question, ts: Date.now() }
    set({ copilotMessages: [...state.copilotMessages, userMsg], copilotThinking: true })
    // Simulated agent latency; answer derives from certified metrics only
    setTimeout(() => {
      const s = get()
      if (!s.dataset || !s.config) return
      const ctx = buildAgentContext(s.dataset, s.config, s.recommendations)
      const answer = answerQuestion(ctx, question)
      const asst: CopilotMessage = {
        id: `cm-${Date.now()}-a`,
        role: 'assistant',
        text: answer.claim,
        answer,
        ts: Date.now(),
      }
      const copilotMessages = [...s.copilotMessages, asst]
      set({ copilotMessages, copilotThinking: false })
      saveCopilot(copilotMessages)
    }, 700 + Math.random() * 500)
  },

  clearCopilot: () => {
    set({ copilotMessages: [] })
    sessionStorage.removeItem('arc.copilot')
  },

  logAudit: (action, target, detail) => {
    const state = get()
    const ev: AuditEvent = {
      id: `au-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      ts: Date.now(),
      actor: state.currentUser().name,
      action,
      target,
      detail,
    }
    const audit = [...state.audit, ev]
    set({ audit })
    api.persistAudit(audit)
  },
}))

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function loadDateRange(): { from: string; to: string } {
  const today = new Date().toISOString().slice(0, 10)
  const d = new Date(); d.setDate(d.getDate() - 30)
  const fallback = { from: d.toISOString().slice(0, 10), to: today }
  try {
    const raw = localStorage.getItem('arc.v1.dateRange')
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return parsed.from && parsed.to && parsed.from <= parsed.to ? parsed : fallback
  } catch {
    return fallback
  }
}

const loadCopilot = (): CopilotMessage[] => {
  try {
    const raw = sessionStorage.getItem('arc.copilot')
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}
const saveCopilot = (msgs: CopilotMessage[]) => {
  try {
    sessionStorage.setItem('arc.copilot', JSON.stringify(msgs.slice(-60)))
  } catch { /* ignore */ }
}
