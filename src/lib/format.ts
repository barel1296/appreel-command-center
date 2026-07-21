// Formatting helpers shared across all screens.

export const fmtMoney = (v: number, digits = 0): string => {
  if (!isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (abs >= 10_000) return `$${(v / 1000).toFixed(1)}K`
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, abs < 10 ? 2 : 0) })}`
}

// CPI with no installs is UNDEFINED, not $0 — web-to-app campaigns spend
// without a tracked install. NaN renders as an em dash everywhere.
export const cpiOf = (spend: number, installs: number): number => (installs > 0 ? spend / installs : NaN)

export const fmtNum = (v: number): string => {
  if (!isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`
  if (abs >= 10_000) return `${(v / 1000).toFixed(1)}K`
  return v.toLocaleString('en-US', { maximumFractionDigits: abs < 10 && !Number.isInteger(v) ? 2 : 0 })
}

export const fmtPct = (v: number, digits = 1): string =>
  isFinite(v) ? `${(v * 100).toFixed(digits)}%` : '—'

export const fmtX = (v: number, digits = 2): string => (isFinite(v) ? `${v.toFixed(digits)}x` : '—')

export const fmtDelta = (v: number, digits = 1): string => {
  if (!isFinite(v)) return '—'
  const s = (v * 100).toFixed(digits)
  return v > 0 ? `+${s}%` : `${s}%`
}

export const fmtDate = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export const fmtDateTime = (ts: number): string =>
  new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

export const fmtAgo = (ts: number): string => {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export const isoDaysAgo = (n: number): string => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

export const daysBetween = (isoA: string, isoB: string): number =>
  Math.round((new Date(isoB + 'T00:00:00').getTime() - new Date(isoA + 'T00:00:00').getTime()) / 86400000)

export const titleCase = (s: string): string =>
  s.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
