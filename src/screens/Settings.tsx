// Settings (spec §20, §21): managed versioned configuration with rollback,
// RBAC matrix, audit log, multi-product onboarding, and workspace controls.
import { clsx } from 'clsx'
import {
  AlertCircle, Check, History, ListTree, Lock, RotateCcw, Settings2, ShieldCheck,
  Trash2, Users,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Column, DataTable } from '@/components/DataTable'
import {
  Button, Card, ConfirmDialog, EmptyState, HelpTip, SearchInput, SectionTitle, Tabs,
} from '@/components/ui'
import { PERMISSIONS, ROLE_LABELS, type Thresholds } from '@/domain/config'
import type { AuditEvent, OnboardingStep, Role } from '@/domain/types'
import { fmtDateTime } from '@/lib/format'
import { useApp } from '@/state/store'

type SettingsTab = 'thresholds' | 'versions' | 'team' | 'audit' | 'products' | 'workspace'
const VALID_TABS: SettingsTab[] = ['thresholds', 'versions', 'team', 'audit', 'products', 'workspace']

export function Settings() {
  const navigate = useNavigate()
  const { tab: tabParam } = useParams()
  const tab: SettingsTab = VALID_TABS.includes(tabParam as SettingsTab) ? (tabParam as SettingsTab) : 'thresholds'

  return (
    <div className="animate-fade-in">
      <div className="mb-4">
        <h1 className="text-xl font-extrabold tracking-tight flex items-center gap-2">
          <Settings2 size={20} className="text-brand-300" /> Settings & Governance
        </h1>
        <p className="text-[13px] text-ink-mid">Versioned configuration, permissions, audit, and product onboarding. Nothing here is hard-coded — thresholds drive the decision engine live.</p>
      </div>
      <Tabs<SettingsTab>
        tabs={[
          { id: 'thresholds', label: 'Thresholds' },
          { id: 'versions', label: 'Config History' },
          { id: 'team', label: 'Team & RBAC' },
          { id: 'audit', label: 'Audit Log' },
          { id: 'products', label: 'Products & Onboarding' },
          { id: 'workspace', label: 'Workspace' },
        ]}
        active={tab}
        onChange={(t) => navigate(`/settings/${t}`)}
      />
      <div className="mt-4">
        {tab === 'thresholds' && <ThresholdsTab />}
        {tab === 'versions' && <VersionsTab />}
        {tab === 'team' && <TeamTab />}
        {tab === 'audit' && <AuditTab />}
        {tab === 'products' && <ProductsTab />}
        {tab === 'workspace' && <WorkspaceTab />}
      </div>
    </div>
  )
}

// ── Thresholds ───────────────────────────────────────────────────────────────

interface FieldDef {
  key: keyof Thresholds
  label: string
  group: string
  kind: 'money' | 'pct' | 'num'
  hint: string
  min: number
  max: number
}

const FIELDS: FieldDef[] = [
  { key: 'target_cpi', label: 'Target CPI', group: 'Acquisition', kind: 'money', hint: 'Blended CPI target; geo overrides refine it.', min: 0.1, max: 50 },
  { key: 'max_cpi', label: 'Max CPI', group: 'Acquisition', kind: 'money', hint: 'Above this, media stage light turns red.', min: 0.1, max: 100 },
  { key: 'min_ctr', label: 'Min CTR', group: 'Acquisition', kind: 'pct', hint: 'Below this, creative attractiveness is flagged.', min: 0.0001, max: 0.2 },
  { key: 'min_cvr', label: 'Min click→install CVR', group: 'Acquisition', kind: 'pct', hint: 'Below this, the store/landing transition is suspect.', min: 0.001, max: 0.9 },
  { key: 'min_activation_rate', label: 'Min activation rate', group: 'User Quality', kind: 'pct', hint: 'Install → meaningful first action.', min: 0.05, max: 0.99 },
  { key: 'min_d1', label: 'Min D1 retention', group: 'User Quality', kind: 'pct', hint: 'Point-in-time D1 floor.', min: 0.01, max: 0.9 },
  { key: 'min_d7', label: 'Min D7 retention', group: 'User Quality', kind: 'pct', hint: 'Point-in-time D7 floor.', min: 0.005, max: 0.8 },
  { key: 'min_depth_l3_share', label: 'Min depth-L3 share', group: 'User Quality', kind: 'pct', hint: 'Share reaching the configured committed layer by D1.', min: 0.01, max: 0.95 },
  { key: 'min_payer_rate', label: 'Min payer rate', group: 'Monetization', kind: 'pct', hint: 'Payers ÷ installs floor.', min: 0.0005, max: 0.5 },
  { key: 'target_d7_roas', label: 'Target D7 ROAS', group: 'Monetization', kind: 'num', hint: 'Observed 7-day ROAS target (e.g. 0.14 = 14%).', min: 0.01, max: 3 },
  { key: 'min_predicted_d30_roas', label: 'Min predicted D30 ROAS', group: 'Monetization', kind: 'num', hint: 'Forecast floor for scale decisions.', min: 0.05, max: 5 },
  { key: 'max_top_payer_share', label: 'Max top-payer share', group: 'Monetization', kind: 'pct', hint: 'Above this, revenue is whale-distorted.', min: 0.05, max: 0.95 },
  { key: 'fatigue_warn', label: 'Fatigue warning', group: 'Creative', kind: 'num', hint: '0–100 weighted fatigue warning line.', min: 10, max: 95 },
  { key: 'fatigue_critical', label: 'Fatigue critical', group: 'Creative', kind: 'num', hint: '0–100 critical line — triggers alerts.', min: 20, max: 100 },
  { key: 'min_installs_for_decision', label: 'Min installs for decision', group: 'Confidence', kind: 'num', hint: 'Evidence floor before verdicts unlock.', min: 10, max: 100000 },
  { key: 'min_spend_for_decision', label: 'Min spend for decision', group: 'Confidence', kind: 'money', hint: 'Spend floor before verdicts unlock.', min: 10, max: 1000000 },
  { key: 'min_payers_for_ltv', label: 'Min payers for LTV', group: 'Confidence', kind: 'num', hint: 'Payer count required to trust the LTV curve.', min: 1, max: 10000 },
  { key: 'max_marginal_cpi_ratio', label: 'Max marginal CPI ratio', group: 'Confidence', kind: 'num', hint: 'Recent CPI ÷ window CPI; above = saturation.', min: 1, max: 4 },
  { key: 'max_freshness_ratio', label: 'Max freshness ratio', group: 'Data Gate', kind: 'num', hint: 'freshness ÷ SLA; above 1 = stale.', min: 0.2, max: 3 },
  { key: 'min_coverage', label: 'Min coverage', group: 'Data Gate', kind: 'pct', hint: 'Expected data slices present.', min: 0.5, max: 1 },
  { key: 'min_match_rate', label: 'Min match rate', group: 'Data Gate', kind: 'pct', hint: 'Attribution join floor — below blocks decisions.', min: 0.3, max: 1 },
  { key: 'max_undefined_share', label: 'Max undefined share', group: 'Data Gate', kind: 'pct', hint: 'Unknown-traffic ceiling.', min: 0.01, max: 0.6 },
  { key: 'max_duplicate_rate', label: 'Max duplicate rate', group: 'Data Gate', kind: 'pct', hint: 'Duplicate-row ceiling before quarantine.', min: 0.001, max: 0.2 },
]

function ThresholdsTab() {
  const app = useApp()
  const canEdit = app.hasPerm('edit_config')
  const current = app.config!.thresholds
  const [draft, setDraft] = useState<Record<string, string>>(() => toDraft(current))
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const errors = useMemo(() => {
    const errs: Record<string, string> = {}
    for (const f of FIELDS) {
      const raw = draft[f.key]
      const num = parseDraft(f, raw)
      if (raw === '' || isNaN(num)) errs[f.key] = 'Required number'
      else if (num < f.min || num > f.max) errs[f.key] = `Must be ${fmtVal(f, f.min)}–${fmtVal(f, f.max)}`
    }
    const warn = parseDraft(FIELDS.find((f) => f.key === 'fatigue_warn')!, draft['fatigue_warn'])
    const crit = parseDraft(FIELDS.find((f) => f.key === 'fatigue_critical')!, draft['fatigue_critical'])
    if (!isNaN(warn) && !isNaN(crit) && warn >= crit) errs['fatigue_critical'] = 'Must exceed warning level'
    const tcpi = parseDraft(FIELDS[0], draft['target_cpi'])
    const mcpi = parseDraft(FIELDS[1], draft['max_cpi'])
    if (!isNaN(tcpi) && !isNaN(mcpi) && tcpi >= mcpi) errs['max_cpi'] = 'Must exceed target CPI'
    return errs
  }, [draft])

  const dirty = useMemo(() => FIELDS.some((f) => {
    const num = parseDraft(f, draft[f.key])
    return !isNaN(num) && Math.abs(num - current[f.key]) > 1e-9
  }), [draft, current])

  const save = () => {
    if (note.trim().length < 5) {
      setNoteError(true)
      return
    }
    const next = { ...current }
    for (const f of FIELDS) next[f.key] = parseDraft(f, draft[f.key])
    app.saveConfig(next, note.trim())
    setNote('')
    setConfirmOpen(false)
  }

  const groups = [...new Set(FIELDS.map((f) => f.group))]

  return (
    <div>
      {!canEdit && (
        <div className="card border-warn-400/30 px-4 py-3 mb-4 flex items-center gap-2.5 text-[13px] text-warn-400">
          <Lock size={15} className="shrink-0" />
          Your role ({ROLE_LABELS[app.currentUser().role]}) can view but not edit configuration. Switch to a Growth Lead or Admin to make changes.
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {groups.map((g) => (
          <Card key={g} className="p-4">
            <SectionTitle title={g} />
            <div className="space-y-3">
              {FIELDS.filter((f) => f.group === g).map((f) => (
                <div key={f.key}>
                  <label htmlFor={`th-${f.key}`} className="flex items-center gap-1.5 text-xs font-semibold text-ink-mid mb-1">
                    {f.label} <HelpTip text={f.hint} />
                  </label>
                  <div className="relative">
                    {f.kind === 'money' && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-low text-[13px]">$</span>}
                    <input
                      id={`th-${f.key}`}
                      type="number"
                      step="any"
                      inputMode="decimal"
                      disabled={!canEdit}
                      value={draft[f.key]}
                      onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                      className={clsx(
                        'w-full bg-surface-2 border rounded-lg py-1.5 text-[13px] num text-ink-hi outline-none transition-colors disabled:opacity-50',
                        f.kind === 'money' ? 'pl-7 pr-3' : f.kind === 'pct' ? 'pl-3 pr-8' : 'px-3',
                        errors[f.key] ? 'border-bad-400' : 'border-line focus:border-brand-400',
                      )}
                    />
                    {f.kind === 'pct' && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-low text-[13px]">%</span>}
                  </div>
                  {errors[f.key] && <p className="text-2xs text-bad-400 mt-0.5 flex items-center gap-1"><AlertCircle size={10} /> {errors[f.key]}</p>}
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {canEdit && (
        <Card className="p-4 mt-4 sticky bottom-3 border-line-strong shadow-pop">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-[220px]">
              <input
                value={note}
                onChange={(e) => { setNote(e.target.value); setNoteError(false) }}
                placeholder="Change note (required) — why are these thresholds changing?"
                aria-label="Configuration change note"
                className={clsx(
                  'w-full bg-surface-2 border rounded-lg px-3 py-2 text-[13px] text-ink-hi placeholder:text-ink-low outline-none transition-colors',
                  noteError ? 'border-bad-400' : 'border-line focus:border-brand-400',
                )}
              />
              {noteError && <p className="text-2xs text-bad-400 mt-1">A change note (5+ characters) is required — it becomes part of the version history.</p>}
            </div>
            <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(toDraft(current))}>
              Discard changes
            </Button>
            <Button variant="primary" disabled={!dirty || Object.keys(errors).length > 0} onClick={() => setConfirmOpen(true)}>
              <Check size={14} /> Save as v{app.configVersions.length + 1}
            </Button>
          </div>
          {dirty && Object.keys(errors).length === 0 && (
            <p className="text-2xs text-ink-low mt-2">Saving re-runs the decision engine — open recommendations will be re-evaluated against the new thresholds.</p>
          )}
        </Card>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={save}
        title="Save configuration version?"
        message={<>This creates <strong className="text-ink-hi">v{app.configVersions.length + 1}</strong> and immediately re-evaluates all open recommendations against the new thresholds. Existing decisions in the ledger are not modified. The change is audited and reversible via rollback.</>}
        confirmLabel="Save & re-evaluate"
      />
    </div>
  )
}

const toDraft = (t: Thresholds): Record<string, string> => {
  const d: Record<string, string> = {}
  for (const f of FIELDS) d[f.key] = f.kind === 'pct' ? String(round(t[f.key] * 100)) : String(t[f.key])
  return d
}
const parseDraft = (f: FieldDef, raw: string): number => {
  const n = parseFloat(raw)
  return f.kind === 'pct' ? n / 100 : n
}
const fmtVal = (f: FieldDef, v: number): string =>
  f.kind === 'pct' ? `${round(v * 100)}%` : f.kind === 'money' ? `$${v}` : String(v)
const round = (v: number) => Math.round(v * 10000) / 10000

// ── Versions ─────────────────────────────────────────────────────────────────

function VersionsTab() {
  const app = useApp()
  const canRollback = app.hasPerm('rollback_config')
  const [rollbackTo, setRollbackTo] = useState<number | null>(null)
  const versions = [...app.configVersions].reverse()
  return (
    <div>
      <Card className="p-4">
        <SectionTitle
          title="Configuration versions"
          hint="Every threshold change is a new immutable version. Rollback restores an old version as a NEW version, preserving the audit trail (spec §20)."
        />
        <div className="space-y-2">
          {versions.map((v, idx) => (
            <div key={v.version} className={clsx('flex items-center gap-3 rounded-lg border px-3.5 py-3', idx === 0 ? 'border-brand-400/40 bg-brand-500/5' : 'border-line')}>
              <History size={15} className="text-ink-low shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-[13px]">v{v.version}</span>
                  {idx === 0 && <span className="text-2xs font-bold bg-brand-500/15 text-brand-300 rounded-md px-1.5 py-0.5">ACTIVE</span>}
                  <span className="text-2xs text-ink-low">{v.saved_by} · {fmtDateTime(v.saved_at)}</span>
                </div>
                <p className="text-[13px] text-ink-mid truncate">{v.note}</p>
              </div>
              {idx !== 0 && canRollback && (
                <Button size="sm" variant="secondary" onClick={() => setRollbackTo(v.version)}>
                  <RotateCcw size={12} /> Rollback
                </Button>
              )}
            </div>
          ))}
        </div>
        {!canRollback && (
          <p className="text-2xs text-ink-low mt-3 flex items-center gap-1.5"><Lock size={11} /> Rollback requires the Admin role.</p>
        )}
      </Card>
      <ConfirmDialog
        open={rollbackTo !== null}
        onClose={() => setRollbackTo(null)}
        onConfirm={() => rollbackTo !== null && app.rollbackConfig(rollbackTo)}
        title={`Rollback to v${rollbackTo}?`}
        message="The old threshold set will be restored as a new version and the decision engine will re-evaluate all open recommendations. The full history is preserved."
        confirmLabel="Rollback"
        danger
      />
    </div>
  )
}

// ── Team & RBAC ──────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  approve_recommendation: 'Approve recommendations',
  reject_recommendation: 'Reject recommendations',
  execute_action: 'Execute approved actions',
  edit_config: 'Edit thresholds/config',
  rollback_config: 'Rollback configuration',
  manage_connectors: 'Manage connectors',
  assign_alerts: 'Assign/progress alerts',
  resolve_alerts: 'Resolve alerts',
  manage_onboarding: 'Manage product onboarding',
  view: 'View all surfaces',
}

function TeamTab() {
  const app = useApp()
  const users = app.dataset!.users
  const roles = Object.keys(PERMISSIONS) as Role[]
  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <Card className="p-4 lg:col-span-2">
        <SectionTitle title="Team" hint="Switch the active user from the avatar menu (top-right) to experience each role's permissions." />
        <div className="space-y-1.5">
          {users.map((u) => (
            <button
              key={u.user_id}
              onClick={() => app.switchUser(u.user_id)}
              className={clsx(
                'w-full flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                u.user_id === app.currentUserId ? 'border-brand-400/50 bg-brand-500/8' : 'border-line hover:bg-surface-2',
              )}
            >
              <span className="w-7 h-7 rounded-full font-bold text-white text-xs flex items-center justify-center shrink-0"
                style={{ background: `linear-gradient(135deg, hsl(${u.avatar_hue},62%,48%), hsl(${u.avatar_hue + 40},62%,38%))` }}>
                {u.name.split(' ').map((w) => w[0]).join('')}
              </span>
              <div className="flex-1">
                <div className="text-[13px] font-semibold">{u.name}</div>
                <div className="text-2xs text-ink-low">{ROLE_LABELS[u.role]}</div>
              </div>
              {u.user_id === app.currentUserId && <ShieldCheck size={15} className="text-brand-300" />}
            </button>
          ))}
        </div>
      </Card>
      <Card className="p-4 lg:col-span-3">
        <SectionTitle title="Permission matrix" hint="Permissions are enforced on every action across the app — try approving a recommendation as Viewer." />
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="label-2xs text-left py-2 pr-3">Action</th>
                {roles.map((r) => (
                  <th key={r} className="label-2xs text-center py-2 px-1.5 whitespace-nowrap">{ROLE_LABELS[r].split(' ')[0]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.keys(ACTION_LABELS).map((a) => (
                <tr key={a} className="border-t border-line/60">
                  <td className="py-2 pr-3 text-ink-mid">{ACTION_LABELS[a]}</td>
                  {roles.map((r) => (
                    <td key={r} className="text-center py-2 px-1.5">
                      {PERMISSIONS[r].includes(a as any)
                        ? <Check size={13} className="inline text-ok-400" />
                        : <span className="text-ink-low/40">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ── Audit ────────────────────────────────────────────────────────────────────

function AuditTab() {
  const app = useApp()
  const [search, setSearch] = useState('')
  const rows = useMemo(() =>
    [...app.audit].reverse().filter((a) =>
      search === '' ||
      a.actor.toLowerCase().includes(search.toLowerCase()) ||
      a.action.toLowerCase().includes(search.toLowerCase()) ||
      a.target.toLowerCase().includes(search.toLowerCase()),
    ), [app.audit, search])

  const columns: Column<AuditEvent>[] = [
    { key: 'ts', header: 'When', render: (a) => <span className="text-ink-low whitespace-nowrap num">{fmtDateTime(a.ts)}</span>, sortValue: (a) => a.ts },
    { key: 'actor', header: 'Actor', render: (a) => <span className="font-semibold">{a.actor}</span>, sortValue: (a) => a.actor },
    { key: 'action', header: 'Action', render: (a) => <span className="text-2xs font-bold bg-surface-3 text-ink-mid px-2 py-0.5 rounded-md whitespace-nowrap">{a.action}</span>, sortValue: (a) => a.action },
    { key: 'target', header: 'Target', hideBelow: 'sm', render: (a) => <span className="truncate block max-w-[200px]">{a.target}</span>, sortValue: (a) => a.target },
    { key: 'detail', header: 'Detail', hideBelow: 'md', render: (a) => <span className="text-ink-mid truncate block max-w-[280px]" title={a.detail}>{a.detail}</span> },
  ]

  return (
    <Card className="p-4">
      <SectionTitle
        title="Audit log"
        hint="Every config change, decision, approval, connector action, and session switch is logged (spec §20)."
        right={<SearchInput value={search} onChange={setSearch} placeholder="Filter events…" className="w-48 sm:w-64" />}
      />
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(a) => a.id}
        defaultSort="ts"
        pageSize={15}
        dense
        emptyTitle="No audit events"
        emptyMessage="No events match the filter."
      />
    </Card>
  )
}

// ── Products & onboarding ────────────────────────────────────────────────────

const STEP_STYLE: Record<OnboardingStep['status'], { label: string; cls: string }> = {
  complete: { label: 'Complete', cls: 'bg-ok-dim text-ok-400' },
  in_progress: { label: 'In progress', cls: 'bg-info-dim text-info-400' },
  blocked: { label: 'Blocked', cls: 'bg-bad-dim text-bad-400' },
  pending: { label: 'Pending', cls: 'bg-surface-3 text-ink-low' },
}

function ProductsTab() {
  const app = useApp()
  const canManage = app.hasPerm('manage_onboarding')
  const products = app.dataset!.products
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {products.map((p) => {
        const done = p.onboarding.steps.filter((s) => s.status === 'complete').length
        const total = p.onboarding.steps.length
        return (
          <Card key={p.product_id} className="p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2.5">
                <span className="text-xl" aria-hidden>{p.icon}</span>
                <div>
                  <div className="font-bold text-[15px]">{p.name}</div>
                  <div className="text-2xs text-ink-low">{p.platforms.join(' · ')} · {p.markets.length} markets · owner {p.owner}</div>
                </div>
              </div>
              <span className={clsx('text-2xs font-bold uppercase px-2 py-1 rounded-md',
                p.status === 'live' ? 'bg-ok-dim text-ok-400' : 'bg-info-dim text-info-400')}>
                {p.status}
              </span>
            </div>

            <div className="flex items-center gap-2 mb-3">
              <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden flex-1">
                <div className="h-full rounded-full bg-brand-400 transition-all duration-500" style={{ width: `${(done / total) * 100}%` }} />
              </div>
              <span className="text-2xs text-ink-low num">{done}/{total}</span>
            </div>

            <div className="space-y-1.5">
              {p.onboarding.steps.map((s, i) => (
                <div key={s.id} className="flex items-start gap-2.5 rounded-lg border border-line px-3 py-2">
                  <span className={clsx('w-5 h-5 rounded-full text-2xs font-bold flex items-center justify-center shrink-0 mt-0.5',
                    s.status === 'complete' ? 'bg-ok-500 text-white' : 'bg-surface-3 text-ink-low')}>
                    {s.status === 'complete' ? <Check size={11} /> : i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-semibold">{s.label}</span>
                      <span className={clsx('text-2xs font-bold px-1.5 py-0.5 rounded', STEP_STYLE[s.status].cls)}>{STEP_STYLE[s.status].label}</span>
                    </div>
                    <p className="text-2xs text-ink-low leading-relaxed">{s.detail ?? s.description}</p>
                  </div>
                  {canManage && p.status === 'onboarding' && s.status !== 'complete' && (
                    <div className="flex gap-1 shrink-0">
                      {s.status !== 'in_progress' && s.status !== 'blocked' && (
                        <Button size="sm" variant="ghost" onClick={() => app.setOnboardingStep(p.product_id, s.id, 'in_progress')} title="Mark in progress">Start</Button>
                      )}
                      <Button size="sm" variant="secondary" onClick={() => app.setOnboardingStep(p.product_id, s.id, 'complete')} title="Mark complete">
                        <Check size={12} /> Done
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {p.status === 'onboarding' && (
              <p className="text-2xs text-ink-low mt-3 flex items-start gap-1.5 leading-relaxed">
                <ListTree size={12} className="mt-0.5 shrink-0" />
                Data for this product stays out of decisions until all steps complete and go-live is signed off (spec §21). {!canManage && 'Managing steps requires Growth Lead or Admin.'}
              </p>
            )}
          </Card>
        )
      })}

      <Card className="p-4 lg:col-span-2">
        <SectionTitle title="Active data contracts · AppReel" hint="The managed contracts every source must satisfy — part of versioned product configuration." />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 text-[13px]">
          {Object.entries({
            'Revenue contract': [
              app.config!.revenue_rules.source_of_truth,
              app.config!.revenue_rules.net_definition,
              app.config!.revenue_rules.refund_policy,
            ],
            'Attribution contract': [
              app.config!.attribution.source_of_truth,
              `Click window ${app.config!.attribution.click_window_days}d · view ${app.config!.attribution.view_window_hours}h`,
              app.config!.attribution.organic_rule,
            ],
            'Depth mapping': app.config!.depth_layers.map((d) => `${d.layer} · ${d.label} (${d.event})`),
            'Geo CPI overrides': app.config!.geo_overrides.map((g) => `${g.geo}: target $${g.target_cpi} · min D1 ${Math.round(g.min_d1 * 100)}%`),
          }).map(([title, lines]) => (
            <div key={title} className="bg-surface-2 rounded-lg p-3">
              <div className="label-2xs mb-1.5">{title}</div>
              <ul className="space-y-1 text-xs text-ink-mid leading-relaxed">
                {(lines as string[]).map((l) => <li key={l}>{l}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

// ── Workspace ────────────────────────────────────────────────────────────────

function WorkspaceTab() {
  const app = useApp()
  const [confirmReset, setConfirmReset] = useState(false)
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="p-4">
        <SectionTitle title="Data layer" />
        <div className="text-[13px] text-ink-mid leading-relaxed space-y-2">
          <p>
            <strong className="text-ink-hi">Facts are simulated.</strong> Canonical facts (spend, attribution, events, revenue, store, social)
            come from a deterministic built-in generator that implements the full canonical model — the stand-in for real connectors.
            The API contract in <code className="text-2xs bg-surface-3 px-1.5 py-0.5 rounded">src/api/backend.ts</code> is what a production backend must serve.
          </p>
          <p>
            <strong className="text-ink-hi">Workspace state is real.</strong> Decisions, ledger entries, alert lifecycle, configuration versions,
            audit events, onboarding progress, and your session persist locally and survive reloads.
          </p>
        </div>
      </Card>
      <Card className="p-4 border-bad-400/25">
        <SectionTitle title="Danger zone" />
        <p className="text-[13px] text-ink-mid leading-relaxed mb-3">
          Reset clears all persisted workspace state — decisions, alert progress, config versions, audit history, and copilot conversation —
          and regenerates the simulation. This cannot be undone.
        </p>
        <Button variant="danger" onClick={() => setConfirmReset(true)}>
          <Trash2 size={14} /> Reset workspace
        </Button>
      </Card>
      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={() => void app.resetWorkspace()}
        title="Reset the entire workspace?"
        message="All decisions, ledger entries, alert progress, configuration versions and audit history will be permanently deleted, and the simulation will regenerate from seed. This cannot be undone."
        confirmLabel="Yes, reset everything"
        danger
      />
    </div>
  )
}
