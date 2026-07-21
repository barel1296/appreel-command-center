// Forecast layer (spec §19). Power-law revenue curve extrapolation with
// conservative/base/aggressive bands. Transparent by design — no black box:
// the fitted slope and inputs are surfaced in confidence factors.

export interface CurveFit {
  slope: number // fitted decay exponent (higher = better tail)
  d30Multiple: number // projected D30 revenue as multiple of observed
}

// Fit r(a) = r0 * (a+1)^-k on observed per-age revenue, project to day 30.
export function fitRevenueCurve(revenueByAge: number[]): CurveFit {
  const observed = revenueByAge.filter((v) => v >= 0)
  if (observed.length < 3) return { slope: 1.4, d30Multiple: 1.8 }
  // Log-log least squares on non-zero points
  const pts = observed
    .map((v, a) => ({ x: Math.log(a + 1), y: Math.log(Math.max(v, 0.01)) }))
  const n = pts.length
  const sx = pts.reduce((s, p) => s + p.x, 0)
  const sy = pts.reduce((s, p) => s + p.y, 0)
  const sxx = pts.reduce((s, p) => s + p.x * p.x, 0)
  const sxy = pts.reduce((s, p) => s + p.x * p.y, 0)
  const denom = n * sxx - sx * sx
  const slopeRaw = denom !== 0 ? (n * sxy - sx * sy) / denom : -1.4
  const k = Math.min(2.2, Math.max(0.5, -slopeRaw))
  const r0 = Math.exp((sy + k * sx) / n)
  const observedTotal = observed.reduce((a, b) => a + b, 0)
  let projected = observedTotal
  for (let a = observed.length; a <= 30; a++) projected += r0 * Math.pow(a + 1, -k)
  return {
    slope: k,
    d30Multiple: observedTotal > 0 ? projected / observedTotal : 1.5,
  }
}

export interface LtvForecast {
  low: number
  base: number
  high: number
}

// Band width scales with evidence thinness (payer count + cohort maturity).
export function forecastD30Revenue(
  observedRevenue: number,
  fit: CurveFit,
  payers: number,
  avgCohortAgeDays: number,
): LtvForecast {
  const base = observedRevenue * fit.d30Multiple
  const evidence = Math.min(1, payers / 40) * Math.min(1, avgCohortAgeDays / 14)
  const width = 0.5 - 0.32 * evidence // 18%..50% band
  return {
    low: base * (1 - width),
    base,
    high: base * (1 + width * 0.8),
  }
}
