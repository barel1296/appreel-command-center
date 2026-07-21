import { clsx } from 'clsx'
import { AlertTriangle, CheckCircle2, ChevronDown, Info, Loader2, RefreshCw, Search, X } from 'lucide-react'
import { ReactNode, useEffect, useId, useRef, useState } from 'react'
import type { ConfidenceLevel, QualityStatus, RecommendationType, RiskLevel, StageLights } from '@/domain/types'

// ── Primitives ───────────────────────────────────────────────────────────────

export function Card({ className, children, onClick }: { className?: string; children: ReactNode; onClick?: () => void }) {
  return (
    <div
      className={clsx('card', onClick && 'card-hover', className)}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {children}
    </div>
  )
}

export function SectionTitle({ title, hint, right }: { title: string; hint?: string; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
      <div className="flex items-center gap-2 min-w-0">
        <h2 className="text-[15px] font-bold text-ink-hi truncate">{title}</h2>
        {hint && <HelpTip text={hint} />}
      </div>
      {right}
    </div>
  )
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'

export function Button({
  variant = 'secondary', size = 'md', disabled, onClick, children, className, title, type = 'button',
}: {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  disabled?: boolean
  onClick?: (e: React.MouseEvent) => void
  children: ReactNode
  className?: string
  title?: string
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 font-semibold rounded-lg transition-all duration-100 select-none',
        'active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100',
        size === 'sm' ? 'text-xs px-2.5 py-1.5' : 'text-[13px] px-3.5 py-2',
        variant === 'primary' && 'bg-brand-500 hover:bg-brand-400 text-white shadow-sm',
        variant === 'secondary' && 'bg-surface-3 hover:bg-surface-4 text-ink-hi border border-line-strong',
        variant === 'ghost' && 'bg-transparent hover:bg-surface-3 text-ink-mid hover:text-ink-hi',
        variant === 'danger' && 'bg-bad-500/90 hover:bg-bad-500 text-white',
        variant === 'success' && 'bg-ok-500/90 hover:bg-ok-500 text-white',
        className,
      )}
    >
      {children}
    </button>
  )
}

// ── Status / semantic pills ──────────────────────────────────────────────────

export function StatusLight({ status, size = 8, pulse }: { status: QualityStatus; size?: number; pulse?: boolean }) {
  const color = status === 'green' ? 'bg-ok-400' : status === 'yellow' ? 'bg-warn-400' : 'bg-bad-400'
  return (
    <span className="relative inline-flex" title={`Data quality: ${status}`}>
      <span className={clsx('rounded-full', color, pulse && status !== 'green' && 'animate-pulse2')} style={{ width: size, height: size }} />
    </span>
  )
}

export function QualityBadge({ status }: { status: QualityStatus }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wide px-2 py-0.5 rounded-md',
        status === 'green' && 'bg-ok-dim text-ok-400',
        status === 'yellow' && 'bg-warn-dim text-warn-400',
        status === 'red' && 'bg-bad-dim text-bad-400',
      )}
    >
      <StatusLight status={status} size={6} />
      {status}
    </span>
  )
}

const REC_STYLES: Record<RecommendationType, { label: string; cls: string }> = {
  scale: { label: 'Scale', cls: 'bg-ok-dim text-ok-400' },
  keep: { label: 'Keep', cls: 'bg-info-dim text-info-400' },
  hold: { label: 'Hold', cls: 'bg-purple-dim text-purple-400' },
  reduce: { label: 'Reduce', cls: 'bg-warn-dim text-warn-400' },
  pause: { label: 'Pause', cls: 'bg-bad-dim text-bad-400' },
  refresh_creative: { label: 'Refresh Creative', cls: 'bg-warn-dim text-warn-400' },
  fix_tracking: { label: 'Fix Tracking', cls: 'bg-bad-dim text-bad-400' },
  investigate: { label: 'Investigate', cls: 'bg-info-dim text-info-400' },
}

export function RecTypePill({ type }: { type: RecommendationType }) {
  const s = REC_STYLES[type]
  return <span className={clsx('inline-flex text-2xs font-bold uppercase tracking-wide px-2 py-1 rounded-md whitespace-nowrap', s.cls)}>{s.label}</span>
}

export function RiskPill({ risk }: { risk: RiskLevel }) {
  const cls = {
    low: 'bg-surface-3 text-ink-mid',
    medium: 'bg-warn-dim text-warn-400',
    high: 'bg-bad-dim text-bad-400',
    critical: 'bg-bad-500 text-white',
  }[risk]
  return <span className={clsx('inline-flex text-2xs font-bold uppercase tracking-wide px-2 py-0.5 rounded-md', cls)} title={`Risk level: ${risk}`}>{risk}</span>
}

export function ConfidencePill({ level, note }: { level: ConfidenceLevel; note?: string }) {
  const cls = {
    high: 'text-ok-400 border-ok-400/40',
    medium: 'text-warn-400 border-warn-400/40',
    low: 'text-bad-400 border-bad-400/40',
  }[level]
  const bars = level === 'high' ? 3 : level === 'medium' ? 2 : 1
  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-2xs font-semibold border rounded-md px-2 py-0.5', cls)} title={note ?? `Confidence: ${level}`}>
      <span className="flex items-end gap-[2px]" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} className={clsx('w-[3px] rounded-sm', i <= bars ? 'bg-current' : 'bg-current opacity-25')} style={{ height: 3 + i * 2.5 }} />
        ))}
      </span>
      {level} confidence
    </span>
  )
}

const STAGE_LABELS: Record<keyof StageLights, string> = {
  media: 'Media', quality: 'User Quality', monetization: 'Monetization', creative: 'Creative', data: 'Data',
}

export function StageLightsRow({ lights, compact }: { lights: StageLights; compact?: boolean }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {(Object.keys(STAGE_LABELS) as (keyof StageLights)[]).map((k) => (
        <span key={k} className="inline-flex items-center gap-1" title={`${STAGE_LABELS[k]}: ${lights[k]}`}>
          <StatusLight status={lights[k]} size={compact ? 6 : 7} />
          {!compact && <span className="text-2xs text-ink-low">{STAGE_LABELS[k]}</span>}
        </span>
      ))}
    </div>
  )
}

export function Avatar({ name, hue, size = 26 }: { name: string; hue: number; size?: number }) {
  const initials = name.split(' ').map((w) => w[0]).slice(0, 2).join('')
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-bold text-white shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.38, background: `linear-gradient(135deg, hsl(${hue},62%,48%), hsl(${hue + 40},62%,38%))` }}
      title={name}
    >
      {initials}
    </span>
  )
}

// ── Tooltip ──────────────────────────────────────────────────────────────────

export function HelpTip({ text }: { text: string }) {
  return (
    <span className="group/tip relative inline-flex" tabIndex={0}>
      <Info size={13} className="text-ink-low group-hover/tip:text-ink-mid cursor-help" />
      <span
        role="tooltip"
        className="pointer-events-none hidden group-hover/tip:block group-focus/tip:block absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-56 max-w-[72vw] z-40 rounded-lg bg-surface-4 border border-line-strong px-3 py-2 text-xs text-ink-hi leading-relaxed shadow-pop animate-fade-in"
      >
        {text}
      </span>
    </span>
  )
}

// ── Feedback states ──────────────────────────────────────────────────────────

export function EmptyState({ icon, title, message, action }: { icon?: ReactNode; title: string; message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6 animate-fade-in">
      <div className="w-12 h-12 rounded-2xl bg-surface-3 flex items-center justify-center text-ink-low mb-4">
        {icon ?? <CheckCircle2 size={22} />}
      </div>
      <div className="font-bold text-ink-hi mb-1">{title}</div>
      <p className="text-ink-mid text-[13px] max-w-sm leading-relaxed mb-4">{message}</p>
      {action}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6 animate-fade-in">
      <div className="w-12 h-12 rounded-2xl bg-bad-dim flex items-center justify-center text-bad-400 mb-4">
        <AlertTriangle size={22} />
      </div>
      <div className="font-bold text-ink-hi mb-1">Something went wrong</div>
      <p className="text-ink-mid text-[13px] max-w-sm leading-relaxed mb-4">{message}</p>
      {onRetry && (
        <Button variant="primary" onClick={onRetry}>
          <RefreshCw size={14} /> Retry
        </Button>
      )}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse2 rounded-lg bg-surface-3', className)} />
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin text-ink-mid" />
}

// ── Inputs ───────────────────────────────────────────────────────────────────

export function SearchInput({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={clsx('relative', className)}>
      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-low pointer-events-none" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'Search…'}
        aria-label={placeholder ?? 'Search'}
        className="w-full bg-surface-2 border border-line rounded-lg pl-8 pr-7 py-1.5 text-[13px] text-ink-hi placeholder:text-ink-low focus:border-brand-400 outline-none transition-colors"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-low hover:text-ink-hi"
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
}

export function Select<T extends string>({ value, onChange, options, label, className }: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  label?: string
  className?: string
}) {
  const id = useId()
  return (
    <div className={clsx('relative inline-flex items-center', className)}>
      {label && <label htmlFor={id} className="label-2xs mr-2">{label}</label>}
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          className="appearance-none bg-surface-2 border border-line rounded-lg pl-3 pr-8 py-1.5 text-[13px] font-medium text-ink-hi focus:border-brand-400 outline-none cursor-pointer hover:bg-surface-3 transition-colors"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-low pointer-events-none" />
      </div>
    </div>
  )
}

// ── Modal / Drawer / Confirm ─────────────────────────────────────────────────

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/60 animate-fade-in" onClick={onClose} />
      <div
        ref={ref}
        tabIndex={-1}
        className={clsx(
          'relative w-full bg-surface-1 border border-line-strong sm:rounded-2xl rounded-t-2xl shadow-pop animate-slide-up max-h-[92vh] flex flex-col outline-none',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
        )}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-line shrink-0">
          <h3 className="font-bold text-[15px] text-ink-hi pr-4">{title}</h3>
          <button onClick={onClose} aria-label="Close dialog" className="text-ink-low hover:text-ink-hi p-1 rounded-md hover:bg-surface-3 transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel, danger }: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: ReactNode
  confirmLabel: string
  danger?: boolean
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="text-[13px] text-ink-mid leading-relaxed mb-5">{message}</div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={() => { onConfirm(); onClose() }}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}

// ── Misc ─────────────────────────────────────────────────────────────────────

export function ProgressBar({ value, color, className }: { value: number; color?: string; className?: string }) {
  return (
    <div className={clsx('h-1.5 rounded-full bg-surface-3 overflow-hidden', className)} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${Math.min(100, Math.max(0, value * 100))}%`, background: color ?? '#3d6dff' }}
      />
    </div>
  )
}

export function DeltaTag({ value, invert, digits = 1 }: { value: number; invert?: boolean; digits?: number }) {
  if (!isFinite(value) || Math.abs(value) < 0.0005) {
    return <span className="text-2xs text-ink-low num">±0.0%</span>
  }
  const good = invert ? value < 0 : value > 0
  return (
    <span className={clsx('text-2xs font-semibold num', good ? 'text-ok-400' : 'text-bad-400')}>
      {value > 0 ? '▲' : '▼'} {Math.abs(value * 100).toFixed(digits)}%
    </span>
  )
}

export function Sparkline({ data, width = 90, height = 26, color = '#5e8dff' }: { data: number[]; width?: number; height?: number; color?: string }) {
  if (data.length < 2) return <span className="text-2xs text-ink-low">—</span>
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - 2 - ((v - min) / range) * (height - 4)}`).join(' ')
  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
    </svg>
  )
}

export function Tabs<T extends string>({ tabs, active, onChange }: { tabs: { id: T; label: ReactNode }[]; active: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="flex items-center gap-1 border-b border-line overflow-x-auto scrollbar-none -mx-1 px-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={clsx(
            'px-3 py-2 text-[13px] font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors',
            active === t.id
              ? 'text-brand-300 border-brand-400'
              : 'text-ink-low border-transparent hover:text-ink-mid',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
