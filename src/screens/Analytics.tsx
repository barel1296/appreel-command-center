// Analytics layer: deep exploration over the canonical facts — cohort table
// with heat-map, retention curves, metric trends, revenue-per-install /
// payback curve, and campaign/creative breakdowns. Everything derives from
// the same certified facts the decision engine reads (real data when the
// live connection is up, simulation otherwise).
import { clsx } from 'clsx'
import { BarChart3, Globe, LineChart, Table as TableIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TrendChart } from '@/components/charts'
import { Column, DataTable } from '@/components/DataTable'
import { Card, EmptyState, HelpTip, SectionTitle, Select, Tabs } from '@/components/ui'
import { MeasurementBanner, MeasurementGapCard } from '@/components/MeasurementGap'
import { measurement } from '@/domain/measurement'
import { computeCreativeMetrics } from '@/domain/metrics/compute'
import type { FactCohort } from '@/domain/types'
import { cpiOf, daysBetween, fmtMoney, fmtNum, fmtPct, fmtX, isoDaysAgo } from '@/lib/format'
import { useApp } from '@/state/store'

type TrendMetric = 'installs' | 'spend' | 'cpi' | 'purchases' | 'cpp' | 'd1' | 'revenue' | 'roas'

const TREND_LABELS: Record<TrendMetric, string> = {
  installs: 'Installs / day',
  spend: 'Spend / day',
  cpi: 'CPI / day',
  purchases: 'Purchase events / cohort',
  cpp: 'Cost per purchase / cohort',
  d1: 'D1 retention / cohort',
  revenue: 'Ad revenue',
  roas: 'Observed ROAS',
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)
const safe = (a: number, b: number) => (b > 0 ? a / b : 0)

export function Analytics() {
  const app = useApp()
  const navigate = useNavigate()
  const ds = app.dataset!
  const [campaignFilter, setCampaignFilter] = useState('all')
  const [trendMetric, setTrendMetric] = useState<TrendMetric>('installs')
  const [breakdownTab, setBreakdownTab] = useState<'campaign' | 'creative' | 'geo'>('campaign')
  // Revenue time axis: COHORT (dollars attributed back to the install date —
  // the ROAS/LTV view) vs ACTIVITY (dollars counted on the day they were
  // earned — the cash/live-ops view). Same dollars, different question.
  const [revenueMode, setRevenueMode] = useState<'cohort' | 'activity'>('cohort')
  const [roasView, setRoasView] = useState<'chart' | 'table'>('chart')

  const productCampaigns = ds.campaigns.filter((c) => c.product_id === app.productId)
  const { from: cutoff, to: cutTo } = app.dateRange
  const selectedIds = campaignFilter === 'all'
    ? new Set(productCampaigns.map((c) => c.campaign_id))
    : new Set([campaignFilter])

  const activityRows = useMemo(() =>
    (ds.revenue_activity_daily ?? []).filter((r) =>
      r.date >= cutoff && r.date <= cutTo &&
      (campaignFilter === 'all' || r.campaign_id === campaignFilter ||
        (campaignFilter === 'organic-unattributed' && r.campaign_id === 'organic'))),
    [ds, cutoff, cutTo, campaignFilter])
  const activityByDate = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of activityRows) m.set(r.date, (m.get(r.date) ?? 0) + r.revenue_usd)
    return m
  }, [activityRows])
  const hasActivity = (ds.revenue_activity_daily ?? []).length > 0

  // ── Country-filtered geo cube ─────────────────────────────────────────────
  const { countries, revenueSource } = app
  const inCountry = (c: string) => countries.length === 0 || countries.includes(c)
  const inCampaign = (cid: string) =>
    campaignFilter === 'all' || cid === campaignFilter ||
    (campaignFilter === 'organic-unattributed' && cid === 'organic')
  const geoRows = useMemo(() =>
    (ds.geo_cohort ?? []).filter((r) =>
      r.cohort_date >= cutoff && r.cohort_date <= cutTo && inCountry(r.country) && inCampaign(r.campaign_id)),
    [ds, cutoff, cutTo, countries, campaignFilter])
  const geoAgeRows = useMemo(() =>
    (ds.geo_cohort_age ?? []).filter((r) =>
      r.cohort_date >= cutoff && r.cohort_date <= cutTo && inCountry(r.country) && inCampaign(r.campaign_id)),
    [ds, cutoff, cutTo, countries, campaignFilter])
  const geoActive = countries.length > 0
  const hasGeo = (ds.geo_cohort ?? []).length > 0
  const revOf = (r: { ad_revenue: number; iap_revenue: number }) =>
    revenueSource === 'ad_iap' ? r.ad_revenue + r.iap_revenue : r.ad_revenue

  const roasHeat = (v: number | null) => {
    if (v === null) return {}
    if (v >= 1) return { background: `rgba(16,185,129,${Math.min(0.45, 0.2 + (v - 1) * 0.5)})` }
    const t = Math.max(0, Math.min(1, v))
    return t >= 0.6
      ? { background: `rgba(245,158,11,${0.08 + (t - 0.6) * 0.5})` }
      : { background: `rgba(239,68,68,${0.06 + (0.6 - t) * 0.35})` }
  }

  const iapAvailable = (ds.geo_cohort ?? []).some((r) => r.iap_revenue > 0)
  // What this workspace can measure. Revenue/retention modules are replaced by
  // an explicit gap card when their source is missing — never by a zero.
  const meas = useMemo(() => measurement(ds), [ds])

  const cohorts = useMemo(() =>
    ds.cohorts.filter((c) => selectedIds.has(c.campaign_id) && c.cohort_date >= cutoff && c.cohort_date <= cutTo),
    [ds, campaignFilter, cutoff, cutTo])
  const spendRows = useMemo(() =>
    ds.spend.filter((r) => selectedIds.has(r.campaign_id) && r.date >= cutoff && r.date <= cutTo),
    [ds, campaignFilter, cutoff, cutTo])

  // ── Daily ROAS by cohort: cumulative revenue ÷ spend, per cohort age ──────
  // Each series is one cohort's payback path; the bold line is the weighted
  // average across cohorts that are old enough to have that age.
  const roasCurves = useMemo(() => {
    const MAXA = 14
    const spendByCohort = new Map<string, number>()
    const revByCohortAge = new Map<string, Map<number, number>>()
    if (geoAgeRows.length > 0) {
      // Geo cube carries a per-age revenue grain — use it so the country filter
      // applies to the curve as well.
      for (const r of geoRows) spendByCohort.set(r.cohort_date, (spendByCohort.get(r.cohort_date) ?? 0) + r.spend)
      for (const r of geoAgeRows) {
        const m = revByCohortAge.get(r.cohort_date) ?? new Map<number, number>()
        m.set(r.age, (m.get(r.age) ?? 0) + revOf(r))
        revByCohortAge.set(r.cohort_date, m)
      }
    } else {
      // No geo-by-age grain: build the same curve from the cohort facts, which
      // carry revenue_by_age directly. Country filtering does not apply here.
      for (const r of spendRows) spendByCohort.set(r.date, (spendByCohort.get(r.date) ?? 0) + r.spend)
      for (const c of cohorts) {
        const m = revByCohortAge.get(c.cohort_date) ?? new Map<number, number>()
        c.revenue_by_age.forEach((v, age) => m.set(age, (m.get(age) ?? 0) + v))
        revByCohortAge.set(c.cohort_date, m)
      }
    }
    const cohortDates = [...spendByCohort.entries()]
      .filter(([, sp]) => sp > 0)
      .map(([d]) => d)
      .sort()
      .slice(-8) // most recent 8 spending cohorts stay readable
    if (cohortDates.length === 0) return null
    const maxAgeOf = (d: string) => daysBetween(d, isoDaysAgo(0))
    const data = Array.from({ length: MAXA + 1 }, (_, age) => {
      const row: Record<string, string | number | null> = { date: `D${age}` }
      let wRev = 0, wSpend = 0
      for (const d of cohortDates) {
        if (maxAgeOf(d) < age) { row[d] = null; continue }
        const sp = spendByCohort.get(d) ?? 0
        const m = revByCohortAge.get(d)
        let cum = 0
        for (let a = 0; a <= age; a++) cum += m?.get(a) ?? 0
        row[d] = sp > 0 ? Number((cum / sp).toFixed(3)) : null
        if (sp > 0) { wRev += cum; wSpend += sp }
      }
      row['avg'] = wSpend > 0 ? Number((wRev / wSpend).toFixed(3)) : null
      return row
    })
    const palette = ['#5e8dff', '#34d399', '#c084fc', '#fbbf24', '#f87171', '#60a5fa', '#8fb4ff', '#a78bfa']

    // Cohort-major view of the same numbers — the ROAS triangle.
    // Every spending cohort in range, newest first (not just the charted 8).
    const installsByCohort = new Map<string, number>()
    for (const r of geoRows) installsByCohort.set(r.cohort_date, (installsByCohort.get(r.cohort_date) ?? 0) + r.installs)
    const tableRows = [...spendByCohort.entries()]
      .filter(([, sp]) => sp > 0)
      .map(([d, sp]) => {
        const m = revByCohortAge.get(d)
        const maxA = maxAgeOf(d)
        let cum = 0
        const cells = Array.from({ length: MAXA + 1 }, (_, age) => {
          if (age > maxA) return null
          cum += m?.get(age) ?? 0
          return sp > 0 ? cum / sp : null
        })
        return { date: d, spend: sp, installs: installsByCohort.get(d) ?? 0, cells }
      })
      .sort((a, b) => b.date.localeCompare(a.date))
    // Spend-weighted average per age across cohorts old enough to have it
    const tableAvg = Array.from({ length: MAXA + 1 }, (_, age) => {
      const el = tableRows.filter((r) => r.cells[age] !== null)
      const sp = sum(el.map((r) => r.spend))
      return sp > 0 ? sum(el.map((r) => (r.cells[age] as number) * r.spend)) / sp : null
    })

    return {
      data,
      series: [
        ...cohortDates.map((d, i) => ({ key: d, name: d.slice(5), color: palette[i % palette.length] })),
        { key: 'avg', name: 'Weighted avg', color: '#eef2ff' },
      ],
      cohortCount: cohortDates.length,
      tableRows,
      tableAvg,
      maxAge: MAXA,
    }
  }, [geoAgeRows, geoRows, revenueSource, spendRows, cohorts])

  // ROAS heat: red below 0.5x, amber approaching, green past payback
  // ── Per-cohort-date aggregation (the cohort table rows) ────────────────────
  interface CohortRow {
    date: string
    age: number
    installs: number
    spend: number
    cpi: number
    d1: number | null
    d3: number | null
    d7: number | null
    revenue: number
    rpi: number
    roas: number
    /** Purchase events — the only monetization signal when value is missing. */
    purchases: number
    /** Spend ÷ purchase events. NaN when the cohort has no purchases yet. */
    cpp: number
  }
  const cohortTable: CohortRow[] = useMemo(() => {
    // With a country filter on, the geo cube is the source (it carries country);
    // otherwise the full cohort facts are used.
    if (geoActive && hasGeo) {
      const byDate = new Map<string, { installs: number; spend: number; rev: number }>()
      for (const r of geoRows) {
        const e = byDate.get(r.cohort_date) ?? { installs: 0, spend: 0, rev: 0 }
        e.installs += r.installs; e.spend += r.spend; e.rev += revOf(r)
        byDate.set(r.cohort_date, e)
      }
      return [...byDate.entries()].map(([date, e]) => ({
        date,
        age: daysBetween(date, isoDaysAgo(0)),
        installs: e.installs,
        spend: e.spend,
        cpi: cpiOf(e.spend, e.installs),
        d1: null, d3: null, d7: null, // retention has no country grain (product-level source)
        revenue: e.rev,
        rpi: safe(e.rev, e.installs),
        roas: e.spend > 0 ? e.rev / e.spend : NaN,
        purchases: 0,
        cpp: NaN,
      })).sort((a, b) => b.date.localeCompare(a.date))
    }
    const byDate = new Map<string, FactCohort[]>()
    for (const c of cohorts) byDate.set(c.cohort_date, [...(byDate.get(c.cohort_date) ?? []), c])
    const spendByDate = new Map<string, number>()
    for (const r of spendRows) spendByDate.set(r.date, (spendByDate.get(r.date) ?? 0) + r.spend)
    return [...byDate.entries()].map(([date, list]) => {
      const installs = sum(list.map((c) => c.installs))
      const spend = spendByDate.get(date) ?? 0
      const age = daysBetween(date, isoDaysAgo(0))
      const cohortRevenue = sum(list.map((c) => sum(c.revenue_by_age)))
      const revenue = revenueMode === 'activity' ? (activityByDate.get(date) ?? 0) : cohortRevenue
      const purchases = sum(list.map((c) => c.payers))
      return {
        date,
        age,
        installs,
        spend,
        cpi: cpiOf(spend, installs),
        d1: age >= 1 ? safe(sum(list.map((c) => c.d1_retained)), installs) : null,
        d3: age >= 3 ? safe(sum(list.map((c) => c.d3_retained)), installs) : null,
        d7: age >= 7 ? safe(sum(list.map((c) => c.d7_retained)), installs) : null,
        revenue,
        rpi: safe(revenue, installs),
        roas: spend > 0 ? revenue / spend : NaN,
        purchases,
        cpp: purchases > 0 ? spend / purchases : NaN,
      }
    }).sort((a, b) => b.date.localeCompare(a.date))
  }, [cohorts, spendRows, revenueMode, activityByDate, geoActive, hasGeo, geoRows, revenueSource])

  // ── Retention curve per campaign (D1/D3/D7, maturity-eligible) ─────────────
  const retentionCurves = useMemo(() => {
    const camps = campaignFilter === 'all'
      ? productCampaigns.filter((c) => ds.cohorts.some((k) => k.campaign_id === c.campaign_id && k.cohort_date >= cutoff))
      : productCampaigns.filter((c) => c.campaign_id === campaignFilter)
    const points = [{ day: 'D0', key: 0 }, { day: 'D1', key: 1 }, { day: 'D3', key: 3 }, { day: 'D7', key: 7 }]
    const data = points.map(({ day, key }) => {
      const row: Record<string, string | number> = { date: day }
      for (const c of camps.slice(0, 5)) {
        const el = ds.cohorts.filter((k) =>
          k.campaign_id === c.campaign_id && k.cohort_date >= cutoff && k.cohort_date <= cutTo &&
          daysBetween(k.cohort_date, isoDaysAgo(0)) >= key)
        const inst = sum(el.map((k) => k.installs))
        const ret = key === 0 ? inst
          : key === 1 ? sum(el.map((k) => k.d1_retained))
          : key === 3 ? sum(el.map((k) => k.d3_retained))
          : sum(el.map((k) => k.d7_retained))
        row[c.campaign_id] = Number((safe(ret, inst) * 100).toFixed(1))
      }
      return row
    })
    const palette = ['#5e8dff', '#34d399', '#c084fc', '#fbbf24', '#f87171']
    return {
      data,
      series: camps.slice(0, 5).map((c, i) => ({
        key: c.campaign_id,
        name: c.name.length > 26 ? c.name.slice(0, 25) + '…' : c.name,
        color: palette[i % palette.length],
      })),
    }
  }, [ds, campaignFilter, cutoff, cutTo])

  // ── Metric trend ───────────────────────────────────────────────────────────
  const trendData = useMemo(() => {
    const rows = [...cohortTable].sort((a, b) => a.date.localeCompare(b.date))
    return rows.map((r) => ({
      date: r.date,
      value: trendMetric === 'installs' ? r.installs
        : trendMetric === 'spend' ? Number(r.spend.toFixed(0))
        : trendMetric === 'cpi' ? Number(r.cpi.toFixed(2))
        : trendMetric === 'purchases' ? r.purchases
        : trendMetric === 'cpp' ? (isFinite(r.cpp) ? Number(r.cpp.toFixed(0)) : null)
        : trendMetric === 'd1' ? (r.d1 !== null ? Number((r.d1 * 100).toFixed(1)) : null)
        : trendMetric === 'revenue' ? Number(r.revenue.toFixed(0))
        : isFinite(r.roas) ? Number(r.roas.toFixed(2)) : null,
    }))
  }, [cohortTable, trendMetric])

  // ── Revenue-per-install curve by cohort age (payback view) ────────────────
  const rpiCurve = useMemo(() => {
    const maxAge = Math.min(30, Math.max(0, ...cohorts.map((c) => c.revenue_by_age.length - 1)))
    const out: { date: string; rpi: number; cpi: number }[] = []
    const totalSpend = sum(spendRows.map((r) => r.spend))
    const totalInstalls = sum(cohorts.map((c) => c.installs))
    const blendedCpi = safe(totalSpend, totalInstalls)
    for (let a = 0; a <= maxAge; a++) {
      const eligible = cohorts.filter((c) => daysBetween(c.cohort_date, isoDaysAgo(0)) >= a)
      if (eligible.length === 0) break
      const rev = sum(eligible.map((c) => sum(c.revenue_by_age.slice(0, a + 1))))
      const inst = sum(eligible.map((c) => c.installs))
      out.push({ date: `D${a}`, rpi: Number(safe(rev, inst).toFixed(3)), cpi: Number(blendedCpi.toFixed(3)) })
    }
    return out
  }, [cohorts, spendRows])
  const paybackDay = rpiCurve.find((p) => p.rpi >= p.cpi && p.cpi > 0)?.date ?? null

  // ── Breakdown tables ───────────────────────────────────────────────────────
  interface BreakRow {
    id: string
    name: string
    sub: string
    spend: number
    installs: number
    cpi: number
    ctr: number
    d1: number
    revenue: number
    roas: number
    purchases: number
    cpp: number
  }
  const campaignBreakdown: BreakRow[] = useMemo(() =>
    productCampaigns.map((c) => {
      const coh = ds.cohorts.filter((k) => k.campaign_id === c.campaign_id && k.cohort_date >= cutoff && k.cohort_date <= cutTo)
      const sp = ds.spend.filter((r) => r.campaign_id === c.campaign_id && r.date >= cutoff && r.date <= cutTo)
      const installs = sum(coh.map((k) => k.installs))
      const spend = sum(sp.map((r) => r.spend))
      const d1El = coh.filter((k) => daysBetween(k.cohort_date, isoDaysAgo(0)) >= 1)
      const revenue = revenueMode === 'activity'
        ? activityRows.filter((r) => r.campaign_id === c.campaign_id || (c.campaign_id === 'organic-unattributed' && r.campaign_id === 'organic'))
            .reduce((s2, r) => s2 + r.revenue_usd, 0)
        : sum(coh.map((k) => sum(k.revenue_by_age)))
      return {
        id: c.campaign_id,
        name: c.name,
        sub: `${ds.channels.find((ch) => ch.channel_id === c.channel_id)?.name ?? c.channel_id} · ${c.geos.join(', ')}`,
        spend,
        installs,
        cpi: cpiOf(spend, installs),
        // Organic has clicks (deep links, shares) but no ad impressions, so CTR
        // is undefined there rather than a nonsensical four-digit percentage.
        ctr: sum(sp.map((r) => r.impressions)) > 0
          ? sum(sp.map((r) => r.clicks)) / sum(sp.map((r) => r.impressions))
          : NaN,
        d1: safe(sum(d1El.map((k) => k.d1_retained)), sum(d1El.map((k) => k.installs))),
        revenue,
        roas: spend > 0 ? revenue / spend : NaN,
        purchases: sum(coh.map((k) => k.payers)),
        cpp: sum(coh.map((k) => k.payers)) > 0 ? spend / sum(coh.map((k) => k.payers)) : NaN,
      }
    }).filter((r) => r.installs > 0 || r.spend > 0),
    [ds, cutoff, cutTo, revenueMode, activityRows])

  const creativeBreakdown: BreakRow[] = useMemo(() =>
    ds.creatives.map((cr) => {
      const m = computeCreativeMetrics(ds, cr.creative_asset_id, app.config!.thresholds)
      return {
        id: cr.creative_asset_id,
        name: cr.name,
        sub: `${cr.concept} · fatigue ${m.fatigue}/100`,
        spend: m.spend,
        installs: m.installs,
        cpi: m.cpi,
        ctr: m.ctr,
        d1: m.d1,
        revenue: NaN, // revenue is attributed at campaign grain, not creative
        roas: m.roas_d7,
        purchases: NaN, // purchases are reported per campaign, not per ad
        cpp: NaN,
      }
    }).filter((r) => r.spend > 0),
    [ds, app.config])

  // Geo breakdown from AppsFlyer install-date × country facts (live source only)
  interface GeoBreakRow {
    country: string
    installs: number
    share: number
    paidShare: number
    revenue: number
    rpi: number
  }
  const geoBreakdown: GeoBreakRow[] = useMemo(() => {
    // Prefer the date-grained geo table; fall back to the geo cube, which is
    // window-total and channel-keyed (AppsFlyer will not return cost per
    // country per campaign per day). campaign_id there holds the CHANNEL.
    const daily = ds.geo_daily ?? []
    const rows = daily.length > 0
      ? daily
        .filter((g) => g.date >= cutoff && g.date <= cutTo &&
          (campaignFilter === 'all' || g.campaign_id === campaignFilter))
        .map((g) => ({ country: g.country, key: g.campaign_id, installs: g.installs, revenue: g.revenue_usd }))
      : (ds.geo_cohort ?? [])
        .filter((g) => campaignFilter === 'all' ||
          g.campaign_id === (productCampaigns.find((c) => c.campaign_id === campaignFilter)?.channel_id ?? ''))
        .map((g) => ({ country: g.country, key: g.campaign_id, installs: g.installs, revenue: g.ad_revenue + g.iap_revenue }))
    const byCountry = new Map<string, { installs: number; paid: number; revenue: number }>()
    for (const g of rows) {
      const e = byCountry.get(g.country) ?? { installs: 0, paid: 0, revenue: 0 }
      e.installs += g.installs
      if (g.key !== 'organic') e.paid += g.installs
      e.revenue += g.revenue
      byCountry.set(g.country, e)
    }
    const total = sum([...byCountry.values()].map((e) => e.installs))
    return [...byCountry.entries()].map(([country, e]) => ({
      country,
      installs: e.installs,
      share: safe(e.installs, total),
      paidShare: safe(e.paid, e.installs),
      revenue: e.revenue,
      rpi: safe(e.revenue, e.installs),
    })).filter((r) => r.installs > 0 || r.revenue > 0).sort((a, b) => b.installs - a.installs)
  }, [ds, cutoff, cutTo, campaignFilter, productCampaigns])

  const geoColumns: Column<GeoBreakRow>[] = [
    { key: 'country', header: 'Country', render: (r) => <span className="font-semibold">{r.country}</span>, sortValue: (r) => r.country },
    { key: 'installs', header: 'Installs', align: 'right', render: (r) => <span className="num font-semibold">{fmtNum(r.installs)}</span>, sortValue: (r) => r.installs },
    {
      key: 'share', header: 'Share', align: 'right',
      render: (r) => (
        <span className="inline-flex items-center gap-2 justify-end">
          <span className="hidden sm:block h-1.5 rounded-full bg-brand-400/70" style={{ width: Math.max(3, r.share * 90) }} />
          <span className="num">{fmtPct(r.share, 0)}</span>
        </span>
      ),
      sortValue: (r) => r.share,
    },
    { key: 'paid', header: <span className="inline-flex items-center gap-1">Paid share <HelpTip text="Share of this country's installs attributed to paid campaigns (vs organic/unattributed)." /></span>, align: 'right', hideBelow: 'sm', render: (r) => <span className="num">{fmtPct(r.paidShare, 0)}</span>, sortValue: (r) => r.paidShare },
    { key: 'revenue', header: 'Ad Revenue', align: 'right', render: (r) => <span className="num">{fmtMoney(r.revenue)}</span>, sortValue: (r) => r.revenue },
    {
      key: 'rpi', header: <span className="inline-flex items-center gap-1">Rev / Install <HelpTip text="Observed revenue ÷ installs for the window. Geo is available at country × channel grain only, so this is a channel-level read, not campaign-level." /></span>,
      align: 'right',
      render: (r) => <span className={clsx('num font-semibold', r.rpi >= 0.15 ? 'text-ok-400' : r.rpi >= 0.05 ? 'text-warn-400' : 'text-ink-low')}>{fmtMoney(r.rpi, 2)}</span>,
      sortValue: (r) => r.rpi,
    },
  ]

  const breakRows = breakdownTab === 'campaign' ? campaignBreakdown : creativeBreakdown
  const breakColumns: Column<BreakRow>[] = [
    {
      key: 'name', header: breakdownTab === 'campaign' ? 'Campaign' : 'Creative',
      render: (r) => (
        <div className="min-w-0">
          <div className="font-semibold truncate max-w-[240px]">{r.name}</div>
          <div className="text-2xs text-ink-low truncate">{r.sub}</div>
        </div>
      ),
      sortValue: (r) => r.name,
    },
    { key: 'spend', header: 'Spend', align: 'right', render: (r) => <span className="num font-semibold">{fmtMoney(r.spend)}</span>, sortValue: (r) => r.spend },
    { key: 'installs', header: 'Installs', align: 'right', render: (r) => <span className="num">{fmtNum(r.installs)}</span>, sortValue: (r) => r.installs },
    { key: 'cpi', header: 'CPI', align: 'right', render: (r) => <span className="num">{fmtMoney(r.cpi, 2)}</span>, sortValue: (r) => r.cpi },
    { key: 'ctr', header: 'CTR', align: 'right', hideBelow: 'sm', render: (r) => <span className="num">{fmtPct(r.ctr)}</span>, sortValue: (r) => r.ctr },
    ...(meas.hasRetention
      ? [{ key: 'd1', header: 'D1', align: 'right' as const, hideBelow: 'md' as const, render: (r: BreakRow) => <span className="num">{fmtPct(r.d1)}</span>, sortValue: (r: BreakRow) => r.d1 }]
      : [{
        key: 'purchases',
        header: <span className="inline-flex items-center gap-1">Purchases <HelpTip text="Purchase EVENTS reported by Meta at campaign grain. Ads do not carry a purchase breakdown, so the creative view shows a dash." /></span>,
        align: 'right' as const,
        hideBelow: 'md' as const,
        render: (r: BreakRow) => <span className="num">{isFinite(r.purchases) ? fmtNum(r.purchases) : <span className="text-ink-low">—</span>}</span>,
        sortValue: (r: BreakRow) => (isFinite(r.purchases) ? r.purchases : -1),
      }]),
    meas.hasRevenue
      ? {
        key: 'roas', header: <span className="inline-flex items-center gap-1">{breakdownTab === 'campaign' ? 'Obs. ROAS' : 'D7 ROAS'} <HelpTip text="Observed attributed net revenue ÷ spend in the window — not a forecast. Young cohorts under-state it." /></span>,
        align: 'right' as const,
        render: (r: BreakRow) => <span className={clsx('num font-semibold', !isFinite(r.roas) ? 'text-ink-low' : r.roas >= 0.7 ? 'text-ok-400' : r.roas >= 0.4 ? 'text-warn-400' : 'text-bad-400')}>{isFinite(r.roas) ? fmtX(r.roas) : '—'}</span>,
        sortValue: (r: BreakRow) => (isFinite(r.roas) ? r.roas : -1),
      }
      : {
        key: 'cpp', header: <span className="inline-flex items-center gap-1">Cost / Purchase <HelpTip text="Spend ÷ purchase events. Stands in for ROAS until purchase value is sent — it ranks campaigns by monetization efficiency without pretending to know revenue." /></span>,
        align: 'right' as const,
        render: (r: BreakRow) => <span className="num font-semibold">{isFinite(r.cpp) ? fmtMoney(r.cpp, 0) : <span className="text-ink-low">—</span>}</span>,
        sortValue: (r: BreakRow) => (isFinite(r.cpp) ? -r.cpp : -1e9),
      },
  ]

  const heat = (v: number | null, good: number, bad: number) => {
    if (v === null) return {}
    const t = Math.max(0, Math.min(1, (v - bad) / Math.max(good - bad, 0.0001)))
    return { background: `rgba(${t > 0.5 ? 16 : 239},${t > 0.5 ? 185 : 68},${t > 0.5 ? 129 : 68},${0.08 + 0.3 * Math.abs(t - 0.5) * 2})` }
  }

  if (cohorts.length === 0) {
    return (
      <div className="animate-fade-in">
        <Header campaignFilter={campaignFilter} setCampaignFilter={setCampaignFilter} campaigns={productCampaigns} />
        <Card className="mt-4">
          <EmptyState
            icon={<BarChart3 size={22} />}
            title="No cohorts in this range"
            message="Widen the date range (top bar) or change the campaign filter — cohorts appear here as soon as installs land."
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="animate-fade-in">
      <Header campaignFilter={campaignFilter} setCampaignFilter={setCampaignFilter} campaigns={productCampaigns} />

      {geoActive && (
        <div className="card border-brand-400/30 px-4 py-2.5 mt-4 flex items-center gap-2.5 text-[13px]">
          <Globe size={14} className="text-brand-300 shrink-0" />
          <span className="text-ink-mid">
            Filtered to <strong className="text-ink-hi">{countries.join(', ')}</strong>. Installs, spend and revenue are
            country-exact; retention columns are product-level and blank out under a country filter.
          </span>
        </div>
      )}

      <MeasurementBanner m={meas} />

      {/* Daily ROAS by cohort — only meaningful once revenue is measured. */}
      {!meas.hasRevenue ? (
        <Card className="p-4 mt-4 mb-4">
          <SectionTitle
            title="Cost efficiency by cohort"
            hint="ROAS needs revenue, which is not measured yet. Until then this is the honest efficiency read: what each install-day cohort cost, and what a purchase event cost inside it."
            right={<span className="text-2xs font-bold text-warn-400 bg-warn-dim rounded px-1.5 py-0.5">ROAS blocked · no revenue value</span>}
          />
          <TrendChart
            data={[...cohortTable].sort((a, b) => a.date.localeCompare(b.date)).map((r) => ({
              date: r.date.slice(5),
              cpi: Number(r.cpi.toFixed(2)),
              cpp: isFinite(r.cpp) ? Number(r.cpp.toFixed(0)) : null,
            }))}
            series={[
              { key: 'cpi', name: 'Cost per install', color: '#5e8dff' },
              { key: 'cpp', name: 'Cost per purchase event', color: '#fbbf24' },
            ]}
            height={260}
            fmt={(v) => fmtMoney(v, 2)}
            yFmt={(v) => `$${v}`}
          />
          <p className="text-2xs text-ink-low mt-3 leading-relaxed">
            Cost per purchase is plotted only on days that produced a purchase event — gaps are days with none, not zeros.
            The moment purchase value starts arriving, this card becomes the cumulative ROAS-by-cohort curve.
          </p>
        </Card>
      ) : (
      <Card className="p-4 mt-4 mb-4">
        <SectionTitle
          title="Daily ROAS by cohort"
          hint="Each line is one install-day cohort: cumulative attributed revenue ÷ that cohort's spend, day by day since install. Lines stop where the cohort runs out of age. The white line is the spend-weighted average — that is your real payback curve."
          right={
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <div className="flex items-center gap-1 bg-surface-2 border border-line rounded-lg p-0.5">
                {(['chart', 'table'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setRoasView(v)}
                    className={clsx(
                      'inline-flex items-center gap-1 text-2xs font-bold uppercase tracking-wide px-2.5 py-1 rounded-md transition-colors',
                      roasView === v ? 'bg-surface-4 text-ink-hi' : 'text-ink-mid hover:text-ink-hi',
                    )}
                    aria-pressed={roasView === v}
                  >
                    {v === 'chart' ? <LineChart size={11} /> : <TableIcon size={11} />}
                    {v}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 bg-surface-2 border border-line rounded-lg p-0.5">
                {(['ad', 'ad_iap'] as const).map((src) => (
                  <button
                    key={src}
                    onClick={() => app.setRevenueSource(src)}
                    disabled={src === 'ad_iap' && !iapAvailable}
                    title={src === 'ad_iap' && !iapAvailable ? 'No in-app purchases in this slice' : undefined}
                    className={clsx(
                      'text-2xs font-bold uppercase tracking-wide px-2.5 py-1 rounded-md transition-colors disabled:opacity-40',
                      revenueSource === src ? 'bg-brand-500 text-white' : 'text-ink-mid hover:text-ink-hi',
                    )}
                  >
                    {src === 'ad' ? 'Ad only' : 'Ad + IAP'}
                  </button>
                ))}
              </div>
            </div>
          }
        />
        {roasCurves === null ? (
          <p className="text-[13px] text-ink-low py-10 text-center">
            No spending cohorts in this slice. Widen the date range, or clear the country filter.
          </p>
        ) : (
          <>
            {roasView === 'chart' ? (
              <TrendChart
                data={roasCurves.data}
                series={roasCurves.series}
                height={260}
                fmt={(v) => fmtX(v)}
                yFmt={(v) => `${v}x`}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-line">
                      <th className="label-2xs py-2.5 px-2.5 text-left sticky left-0 bg-surface-1 z-10">Cohort</th>
                      <th className="label-2xs py-2.5 px-2.5 text-right">Installs</th>
                      <th className="label-2xs py-2.5 px-2.5 text-right">Spend</th>
                      {Array.from({ length: roasCurves.maxAge + 1 }, (_, i) => (
                        <th key={i} className="label-2xs py-2.5 px-1.5 text-right whitespace-nowrap">D{i}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {roasCurves.tableRows.map((r) => (
                      <tr key={r.date} className="border-b border-line/60 last:border-0">
                        <td className="py-2 px-2.5 font-semibold whitespace-nowrap sticky left-0 bg-surface-1">{r.date.slice(5)}</td>
                        <td className="py-2 px-2.5 text-right num text-ink-mid">{fmtNum(r.installs)}</td>
                        <td className="py-2 px-2.5 text-right num text-ink-mid">{fmtMoney(r.spend)}</td>
                        {r.cells.map((v, i) => (
                          <td
                            key={i}
                            className={clsx('py-2 px-1.5 text-right num text-2xs', v !== null && v >= 1 && 'font-bold text-ok-400')}
                            style={roasHeat(v)}
                          >
                            {v === null ? '' : v.toFixed(2)}
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr className="border-t-2 border-line-strong bg-surface-2/50">
                      <td className="py-2 px-2.5 font-bold sticky left-0 bg-surface-2">Weighted avg</td>
                      <td className="py-2 px-2.5 text-right num text-ink-mid">
                        {fmtNum(sum(roasCurves.tableRows.map((r) => r.installs)))}
                      </td>
                      <td className="py-2 px-2.5 text-right num text-ink-mid">
                        {fmtMoney(sum(roasCurves.tableRows.map((r) => r.spend)))}
                      </td>
                      {roasCurves.tableAvg.map((v, i) => (
                        <td key={i} className={clsx('py-2 px-1.5 text-right num text-2xs font-bold', v !== null && v >= 1 && 'text-ok-400')}>
                          {v === null ? '' : v.toFixed(2)}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-2xs text-ink-low mt-2 leading-relaxed">
              {roasView === 'chart'
                ? `Showing the ${roasCurves.cohortCount} most recent spending cohorts`
                : `All ${roasCurves.tableRows.length} spending cohorts in range · green cells have paid back (≥ 1.00x)`}
              {geoActive && <> · countries: {countries.join(', ')}</>}
              {' · '}revenue: {revenueSource === 'ad_iap' ? 'ad + in-app purchases' : 'ad only'}.
              A cohort crossing 1.0x has paid back. Curves flatten as cohorts mature — the slope after D3 is what
              separates a profitable cohort from one that merely started well.
            </p>
          </>
        )}
      </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Retention curves */}
        {!meas.hasRetention ? (
          <MeasurementGapCard
            title="Retention curves"
            needs="a product event source"
            unlocks="D1/D3/D7 retention per campaign is the earliest reliable signal of install quality — without it the engine cannot separate a cheap install from a good one."
            how="Meta reports acquisition only. Point the app's session events at a warehouse this platform can read, or connect an MMP that already receives them."
          />
        ) : (
        <Card className="p-4">
          <SectionTitle title="Retention curves" hint="Point-in-time D1/D3/D7 per campaign — only cohorts old enough to measure are counted (up to 5 campaigns shown)." />
          <TrendChart
            data={retentionCurves.data}
            series={retentionCurves.series}
            height={230}
            fmt={(v) => `${v}%`}
            yFmt={(v) => `${v}%`}
          />
        </Card>
        )}

        {/* RPI / payback */}
        {!meas.hasRevenue ? (
          <MeasurementGapCard
            title="Revenue per install by cohort age"
            needs="purchase revenue value"
            unlocks="Payback day, LTV curve and every scale/cut decision depend on cumulative revenue per install crossing CPI."
            how="Purchase events already reach Meta — they just arrive with an empty value. Send value + currency on the purchase event and this curve fills in retroactively for new cohorts."
          />
        ) : (
        <Card className="p-4">
          <SectionTitle
            title="Revenue per install by cohort age"
            hint="Cumulative attributed net revenue ÷ installs, by cohort age day, vs blended CPI. Where the lines cross is observed payback."
            right={paybackDay
              ? <span className="text-2xs font-bold bg-ok-dim text-ok-400 px-2 py-1 rounded-md whitespace-nowrap">Payback ≈ {paybackDay}</span>
              : <span className="text-2xs text-ink-low whitespace-nowrap">No payback in observed window yet</span>}
          />
          <TrendChart
            data={rpiCurve}
            series={[
              { key: 'rpi', name: 'Cumulative revenue / install', color: '#34d399' },
              { key: 'cpi', name: 'Blended CPI', color: '#f87171', dashed: true },
            ]}
            height={230}
            fmt={(v) => fmtMoney(v, 2)}
            yFmt={(v) => `$${v}`}
          />
        </Card>
        )}
      </div>

      {/* Metric trend */}
      <Card className="p-4 mb-4">
        <SectionTitle
          title="Trend"
          hint="Daily series for the selected metric in the window. Cohort metrics (D1, revenue, ROAS) are keyed to the cohort's install date."
          right={
            <Select
              value={trendMetric}
              onChange={setTrendMetric}
              options={(Object.keys(TREND_LABELS) as TrendMetric[])
                .filter((k) => (meas.hasRetention || k !== 'd1') && (meas.hasRevenue || (k !== 'revenue' && k !== 'roas')))
                .map((k) => ({ value: k, label: TREND_LABELS[k] }))}
            />
          }
        />
        <TrendChart
          data={trendData}
          series={[{ key: 'value', name: TREND_LABELS[trendMetric], color: '#5e8dff' }]}
          height={200}
          fmt={(v) => (trendMetric === 'd1' ? `${v}%` : trendMetric === 'cpi' || trendMetric === 'spend' || trendMetric === 'revenue' || trendMetric === 'cpp' ? fmtMoney(v, trendMetric === 'cpi' ? 2 : 0) : trendMetric === 'roas' ? fmtX(v) : fmtNum(v))}
          yFmt={(v) => String(v)}
        />
      </Card>

      {/* Cohort table */}
      <Card className="p-4 mb-4">
        <SectionTitle
          title={revenueMode === 'cohort' ? 'Cohort table' : 'Daily table (activity revenue)'}
          hint={!meas.hasRevenue && !meas.hasRetention
            ? 'One row per install-date cohort, limited to what Meta measures: cost, volume and purchase events. Revenue, retention and ROAS columns appear automatically once those sources are connected.'
            : revenueMode === 'cohort'
              ? 'One row per install-date cohort. Revenue is attributed BACK to the install date — this is the ROAS/LTV view. Retention cells are point-in-time; blanks mean the cohort is too young to measure.'
              : 'Same rows, but revenue is counted on the day it was EARNED by all users acquired that day or earlier — the cash view. Install/spend/retention columns stay cohort-based.'}
          right={!meas.hasRevenue ? null : (
            <div className="flex items-center gap-1 bg-surface-2 border border-line rounded-lg p-0.5">
              {(['cohort', 'activity'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setRevenueMode(m)}
                  disabled={m === 'activity' && !hasActivity}
                  title={m === 'activity' && !hasActivity ? 'Activity revenue requires the live source' : undefined}
                  className={clsx(
                    'text-2xs font-bold uppercase tracking-wide px-2.5 py-1 rounded-md transition-colors disabled:opacity-40',
                    revenueMode === m ? 'bg-brand-500 text-white' : 'text-ink-mid hover:text-ink-hi',
                  )}
                >
                  {m === 'cohort' ? 'Cohort revenue' : 'Activity revenue'}
                </button>
              ))}
            </div>
          )}
        />
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line">
                {(meas.hasRevenue || meas.hasRetention
                  ? ['Cohort', 'Age', 'Installs', 'Spend', 'CPI', 'D1', 'D3', 'D7',
                    revenueMode === 'cohort' ? 'Cohort Rev' : 'Earned Rev',
                    revenueMode === 'cohort' ? 'Rev/Install' : 'Rev/DAU-day',
                    revenueMode === 'cohort' ? 'Cohort ROAS' : 'Daily ROAS']
                  : ['Cohort', 'Age', 'Installs', 'Spend', 'CPI', 'Purchases', 'Cost / Purchase']
                ).map((h) => (
                  <th key={h} className={clsx('label-2xs py-2.5 px-2.5 whitespace-nowrap', h === 'Cohort' ? 'text-left' : 'text-right')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cohortTable.map((r) => (
                <tr key={r.date} className="border-b border-line/60 last:border-0">
                  <td className="py-2 px-2.5 font-semibold whitespace-nowrap">{r.date.slice(5)}</td>
                  <td className="py-2 px-2.5 text-right num text-ink-low">{r.age}d</td>
                  <td className="py-2 px-2.5 text-right num">{fmtNum(r.installs)}</td>
                  <td className="py-2 px-2.5 text-right num">{r.spend > 0 ? fmtMoney(r.spend) : '—'}</td>
                  <td className="py-2 px-2.5 text-right num">{r.spend > 0 ? fmtMoney(r.cpi, 2) : '—'}</td>
                  {meas.hasRevenue || meas.hasRetention ? (
                    <>
                      <td className="py-2 px-2.5 text-right num" style={heat(r.d1, 0.25, 0.05)}>{r.d1 !== null ? fmtPct(r.d1) : ''}</td>
                      <td className="py-2 px-2.5 text-right num" style={heat(r.d3, 0.15, 0.02)}>{r.d3 !== null ? fmtPct(r.d3) : ''}</td>
                      <td className="py-2 px-2.5 text-right num" style={heat(r.d7, 0.1, 0.01)}>{r.d7 !== null ? fmtPct(r.d7) : ''}</td>
                      <td className="py-2 px-2.5 text-right num">{fmtMoney(r.revenue)}</td>
                      <td className="py-2 px-2.5 text-right num">{fmtMoney(r.rpi, 2)}</td>
                      <td className={clsx('py-2 px-2.5 text-right num font-semibold', !isFinite(r.roas) ? 'text-ink-low' : r.roas >= 0.7 ? 'text-ok-400' : r.roas >= 0.4 ? 'text-warn-400' : 'text-bad-400')}>
                        {isFinite(r.roas) ? fmtX(r.roas) : '—'}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="py-2 px-2.5 text-right num">{r.purchases > 0 ? fmtNum(r.purchases) : <span className="text-ink-low">0</span>}</td>
                      <td className="py-2 px-2.5 text-right num font-semibold">{isFinite(r.cpp) ? fmtMoney(r.cpp, 0) : <span className="text-ink-low">—</span>}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-2xs text-ink-low mt-3 leading-relaxed">
          {!meas.hasRevenue && !meas.hasRetention
            ? 'Installs are Meta-reported (no MMP), and purchases are events without value. Cost per purchase is therefore an upper bound on efficiency, not a profitability read — a $0 revenue column would have been a lie, so it is not shown.'
            : revenueMode === 'cohort'
              ? 'Cohort view answers "did the users we bought on this day pay us back?" — the right lens for ROAS, LTV and scale decisions. Recent rows always look weak because their revenue has not accrued yet.'
              : 'Activity view answers "how much did we earn on this day?" — the right lens for cash, live-ops and week-over-week trend. It does not decay with cohort age, so recent days are directly comparable.'}
        </p>
      </Card>

      {/* Breakdowns */}
      <Card className="p-4">
        <SectionTitle title="Breakdown" hint="Window totals per campaign or per creative. Click a row to drill down." />
        <Tabs
          tabs={[
            { id: 'campaign' as const, label: 'By campaign' },
            { id: 'creative' as const, label: 'By creative' },
            // Geo needs a country grain; Meta ad-level reporting alone has none.
            ...(meas.hasGeo ? [{ id: 'geo' as const, label: 'By geo' }] : []),
          ]}
          active={breakdownTab}
          onChange={setBreakdownTab}
        />
        <div className="mt-3">
          {breakdownTab === 'geo' ? (
            <DataTable
              columns={geoColumns}
              rows={geoBreakdown}
              rowKey={(r) => r.country}
              defaultSort="installs"
              emptyTitle="No geo data"
              emptyMessage="No installs in the selected window or campaign."
            />
          ) : (
            <DataTable
              columns={breakColumns}
              rows={breakRows}
              rowKey={(r) => r.id}
              onRowClick={(r) => navigate(breakdownTab === 'campaign' ? `/doctor/${r.id}` : `/creative/${r.id}`)}
              defaultSort="spend"
              emptyTitle="Nothing to break down"
              emptyMessage={breakdownTab === 'creative' ? 'No creative-level spend in this workspace yet.' : 'No campaign activity in the window.'}
            />
          )}
        </div>
      </Card>
    </div>
  )
}

function Header({ campaignFilter, setCampaignFilter, campaigns }: {
  campaignFilter: string
  setCampaignFilter: (c: string) => void
  campaigns: { campaign_id: string; name: string }[]
}) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight flex items-center gap-2">
          <BarChart3 size={20} className="text-brand-300" /> Analytics
        </h1>
        <p className="text-[13px] text-ink-mid">Cohorts, retention, payback and breakdowns — the same certified facts the decision engine reads.</p>
      </div>
      <div className="flex items-center gap-2 flex-wrap justify-end">
        <Select
          value={campaignFilter}
          onChange={setCampaignFilter}
          options={[{ value: 'all', label: 'All campaigns' }, ...campaigns.map((c) => ({ value: c.campaign_id, label: c.name.length > 34 ? c.name.slice(0, 33) + '…' : c.name }))]}
        />
      </div>
    </div>
  )
}
