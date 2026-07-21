// Main Command Center (spec §16): daily operating view — KPIs, data health,
// urgent items, recommendations, and the campaign portfolio table.
import { AlertTriangle, ArrowRight, Compass, Flame, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AreaTrend } from '@/components/charts'
import { Column, DataTable } from '@/components/DataTable'
import { RecommendationCard } from '@/components/RecommendationCard'
import {
  Button, Card, DeltaTag, HelpTip, Modal, QualityBadge, SearchInput, SectionTitle,
  Select, Sparkline, StatusLight,
} from '@/components/ui'
import type { DimCampaign } from '@/domain/types'
import { daysBetween, fmtMoney, fmtNum, fmtPct, fmtX, isoDaysAgo } from '@/lib/format'
import { useApp } from '@/state/store'

interface CampaignRow {
  campaign: DimCampaign
  channelName: string
  spend: number
  installs: number
  cpi: number
  d1: number
  roasPred: number
  quality: number
  gate: 'green' | 'yellow' | 'red'
  spendSeries: number[]
  spendTrend: number
}

export function CommandCenter() {
  const app = useApp()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [channelFilter, setChannelFilter] = useState<string>('all')
  const [welcomeOpen, setWelcomeOpen] = useState(() => !localStorage.getItem('arc.v1.welcomed'))

  const ds = app.dataset!
  const dismissWelcome = () => {
    localStorage.setItem('arc.v1.welcomed', '1')
    setWelcomeOpen(false)
  }

  const rows: CampaignRow[] = useMemo(() =>
    ds.campaigns
      .filter((c) => c.status === 'active')
      .map((c) => {
        const m = app.campaignMetrics(c.campaign_id)!
        return {
          campaign: c,
          channelName: ds.channels.find((ch) => ch.channel_id === c.channel_id)?.name ?? c.channel_id,
          spend: m.spend,
          installs: m.installs,
          cpi: m.cpi,
          d1: m.d1,
          roasPred: m.predicted_d30_roas.base,
          quality: m.quality_score,
          gate: m.quality_gate.status,
          spendSeries: m.daily.slice(-14).map((d) => d.spend),
          spendTrend: m.spend_trend,
        }
      }), [ds, app])

  const filtered = rows.filter((r) =>
    (channelFilter === 'all' || r.campaign.channel_id === channelFilter) &&
    (search === '' || r.campaign.name.toLowerCase().includes(search.toLowerCase()) || r.channelName.toLowerCase().includes(search.toLowerCase())),
  )

  // Revenue by CALENDAR day. Live source when connected (Aego truth: all users,
  // all days); otherwise derived from cohort curves (cohort_date + age = day).
  const calendarRevenue = useMemo(() => {
    const map = new Map<string, number>()
    if (ds.revenue_daily?.length) {
      for (const r of ds.revenue_daily) map.set(r.date, r.revenue_usd)
    } else {
      for (const c of ds.cohorts) {
        c.revenue_by_age.forEach((v, a) => {
          const d = new Date(c.cohort_date + 'T00:00:00')
          d.setDate(d.getDate() + a)
          const key = d.toISOString().slice(0, 10)
          map.set(key, (map.get(key) ?? 0) + v)
        })
      }
    }
    return map
  }, [ds])

  // KPI aggregates: selected range vs the preceding period of equal length
  const { from, to } = app.dateRange
  const rangeLen = Math.max(1, daysBetween(from, to) + 1)
  const prevTo = isoShift(from, -1)
  const prevFrom = isoShift(from, -rangeLen)
  const kpis = useMemo(() => {
    const inCur = (d: string) => d >= from && d <= to
    const inPrev = (d: string) => d >= prevFrom && d <= prevTo
    const spendCur = sumBy(ds.spend, (r) => (inCur(r.date) ? r.spend : 0))
    const spendPrev = sumBy(ds.spend, (r) => (inPrev(r.date) ? r.spend : 0))
    const instCur = sumBy(ds.cohorts, (r) => (inCur(r.cohort_date) ? r.installs : 0))
    const instPrev = sumBy(ds.cohorts, (r) => (inPrev(r.cohort_date) ? r.installs : 0))
    const revEntries = [...calendarRevenue.entries()]
    const revCur = sumBy(revEntries, ([d, v]) => (inCur(d) ? v : 0))
    const revPrev = sumBy(revEntries, ([d, v]) => (inPrev(d) ? v : 0))
    const d1Weighted = (rows: typeof ds.cohorts) => {
      const el = rows.filter((r) => r.cohort_date < isoDaysAgo(1))
      const inst = sumBy(el, (r) => r.installs)
      return inst > 0 ? sumBy(el, (r) => r.d1_retained) / inst : 0
    }
    const d1Cur = d1Weighted(ds.cohorts.filter((r) => inCur(r.cohort_date)))
    const d1Prev = d1Weighted(ds.cohorts.filter((r) => inPrev(r.cohort_date)))
    const purCur = sumBy(ds.cohorts, (r) => (inCur(r.cohort_date) ? r.payers : 0))
    const purPrev = sumBy(ds.cohorts, (r) => (inPrev(r.cohort_date) ? r.payers : 0))
    return {
      spend: { v: spendCur, d: spendPrev > 0 ? spendCur / spendPrev - 1 : 0 },
      installs: { v: instCur, d: instPrev > 0 ? instCur / instPrev - 1 : 0 },
      cpi: { v: instCur > 0 ? spendCur / instCur : 0, d: instPrev > 0 && spendPrev > 0 && instCur > 0 ? spendCur / instCur / (spendPrev / instPrev) - 1 : 0 },
      revenue: { v: revCur, d: revPrev > 0 ? revCur / revPrev - 1 : 0 },
      d1: { v: d1Cur, d: d1Cur - d1Prev },
      purchases: { v: purCur, d: purPrev > 0 ? purCur / purPrev - 1 : 0 },
      cpp: {
        v: purCur > 0 ? spendCur / purCur : 0,
        d: purPrev > 0 && purCur > 0 && spendPrev > 0 ? spendCur / purCur / (spendPrev / purPrev) - 1 : 0,
      },
    }
  }, [ds, calendarRevenue, from, to, prevFrom, prevTo])

  // Which measurements this workspace actually has. AppReel currently reports
  // purchase EVENTS through Meta but no revenue VALUE and no MMP/product feed,
  // so revenue and retention KPIs would render a misleading zero. When a source
  // is missing the strip falls back to what IS measured, and says why.
  const hasRevenue = kpis.revenue.v > 0 || (ds.revenue_daily?.length ?? 0) > 0
  const hasRetention = ds.cohorts.some((r) => r.d1_retained > 0)
  const mmpConnected = ds.cohorts.some((r) => r.matched_installs > 0)

  // Spend vs revenue daily trend — both axes on CALENDAR days, selected range
  const trendData = useMemo(() => {
    const byDate = new Map<string, { date: string; spend: number; revenue: number; installs: number }>()
    for (const r of ds.spend) {
      if (r.date < from || r.date > to) continue
      const e = byDate.get(r.date) ?? { date: r.date, spend: 0, revenue: 0, installs: 0 }
      e.spend += r.spend
      byDate.set(r.date, e)
    }
    for (const [date, v] of calendarRevenue) {
      if (date < from || date > to) continue
      const e = byDate.get(date) ?? { date, spend: 0, revenue: 0, installs: 0 }
      e.revenue += v
      byDate.set(date, e)
    }
    for (const c of ds.cohorts) {
      if (c.cohort_date < from || c.cohort_date > to) continue
      const e = byDate.get(c.cohort_date) ?? { date: c.cohort_date, spend: 0, revenue: 0, installs: 0 }
      e.installs += c.installs
      byDate.set(c.cohort_date, e)
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  }, [ds, calendarRevenue, from, to])

  const pendingRecs = app.recommendations.filter((r) => r.approval_status === 'proposed').slice(0, 3)
  const urgentAlerts = app.alerts.filter((a) => a.state !== 'resolved' && (a.severity === 'critical' || a.severity === 'high'))
  const redSources = ds.connectors.filter((c) => c.match_rate < app.config!.thresholds.min_match_rate || c.freshness_hours > c.freshness_sla_hours)

  const columns: Column<CampaignRow>[] = [
    {
      key: 'name',
      header: 'Campaign',
      render: (r) => (
        <div className="min-w-0">
          <div className="font-semibold text-ink-hi truncate max-w-[220px]">{r.campaign.name}</div>
          <div className="text-2xs text-ink-low">{r.channelName} · {r.campaign.geos.join(', ')}</div>
        </div>
      ),
      sortValue: (r) => r.campaign.name,
    },
    { key: 'gate', header: 'Data', align: 'center', render: (r) => <StatusLight status={r.gate} pulse />, sortValue: (r) => (r.gate === 'green' ? 2 : r.gate === 'yellow' ? 1 : 0) },
    { key: 'spend', header: 'Spend 14d', align: 'right', render: (r) => <span className="num font-semibold">{fmtMoney(r.spend)}</span>, sortValue: (r) => r.spend },
    { key: 'trend', header: 'Pace', align: 'right', hideBelow: 'lg', render: (r) => <Sparkline data={r.spendSeries} width={70} height={22} />, sortValue: (r) => r.spendTrend },
    { key: 'installs', header: 'Installs', align: 'right', hideBelow: 'sm', render: (r) => <span className="num">{fmtNum(r.installs)}</span>, sortValue: (r) => r.installs },
    { key: 'cpi', header: 'CPI', align: 'right', render: (r) => <span className="num">{fmtMoney(r.cpi, 2)}</span>, sortValue: (r) => r.cpi },
    { key: 'd1', header: 'D1', align: 'right', hideBelow: 'md', render: (r) => <span className={r.d1 >= app.config!.thresholds.min_d1 ? 'num text-ok-400' : 'num text-bad-400'}>{fmtPct(r.d1)}</span>, sortValue: (r) => r.d1 },
    { key: 'roas', header: 'Pred. D30 ROAS', align: 'right', hideBelow: 'md', render: (r) => <span className="num">{fmtX(r.roasPred)}</span>, sortValue: (r) => r.roasPred },
    {
      key: 'quality',
      header: <span className="inline-flex items-center gap-1">Quality <HelpTip text="Composite 0–100 score: activation, D1 retention, depth reach, and meaningful-session rate (spec §8)." /></span>,
      align: 'right',
      render: (r) => (
        <span className={`num font-bold ${!isFinite(r.quality) ? 'text-ink-low' : r.quality >= 60 ? 'text-ok-400' : r.quality >= 45 ? 'text-warn-400' : 'text-bad-400'}`}>{isFinite(r.quality) ? r.quality : '—'}</span>
      ),
      sortValue: (r) => r.quality,
    },
  ]

  return (
    <div className="animate-fade-in">
      <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">Command Center</h1>
          <p className="text-[13px] text-ink-mid">
            {pendingRecs.length > 0 || urgentAlerts.length > 0
              ? `${app.recommendations.filter((r) => r.approval_status === 'proposed').length} decisions waiting · ${urgentAlerts.length} urgent alerts · data ${redSources.length > 0 ? `degraded on ${redSources.length} source${redSources.length > 1 ? 's' : ''}` : 'healthy'}`
              : 'All clear — no pending decisions or urgent alerts.'}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setWelcomeOpen(true)}>
          <Compass size={14} /> Tour
        </Button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4 mb-5">
        <Kpi label="Spend" value={fmtMoney(kpis.spend.v)} delta={kpis.spend.d} hint="Total normalized spend across paid channels in the selected range vs the preceding equal period." />
        <Kpi
          label="Installs"
          value={fmtNum(kpis.installs.v)}
          delta={kpis.installs.d}
          hint={mmpConnected
            ? 'MMP-attributed installs (source of truth) — not network-reported.'
            : 'Network-reported by Meta. No MMP is connected, so these are self-attributed and typically run high. Connect AppsFlyer to replace them with attributed truth.'}
          caveat={mmpConnected ? undefined : 'Meta-reported'}
        />
        <Kpi
          label="Blended CPI"
          value={fmtMoney(kpis.cpi.v, 2)}
          delta={kpis.cpi.d}
          invert
          hint={mmpConnected
            ? 'Spend ÷ attributed installs. Lower is better.'
            : 'Spend ÷ Meta-reported installs. Real CPI is likely higher once an MMP de-duplicates the attribution.'}
          caveat={mmpConnected ? undefined : 'Meta-reported'}
        />
        {hasRevenue ? (
          <Kpi label="Ad Revenue" value={fmtMoney(kpis.revenue.v)} delta={kpis.revenue.d} hint="Ad revenue by calendar day (all users, all cohorts) — matches your monetization dashboard. Attributed cohort revenue lives in Analytics." />
        ) : (
          <Kpi
            label="Purchases"
            value={fmtNum(kpis.purchases.v)}
            delta={kpis.purchases.d}
            hint="Purchase EVENTS reported by Meta. No revenue value arrives with them (omni_purchase_values is empty on every row), so revenue, ROAS and LTV cannot be computed yet — only volume and cost."
            caveat="no revenue value"
          />
        )}
        {hasRetention ? (
          <Kpi label="D1 Retention" value={fmtPct(kpis.d1.v)} delta={kpis.d1.d} deltaAbs hint="Point-in-time D1 across cohorts old enough to measure." />
        ) : (
          <Kpi
            label="Cost / Purchase"
            value={kpis.cpp.v > 0 ? fmtMoney(kpis.cpp.v, 2) : '—'}
            delta={kpis.cpp.d}
            invert
            hint="Spend ÷ purchase events. The only monetization efficiency metric available until purchase revenue value is sent. Retention needs a product event source."
            caveat="proxy for ROAS"
          />
        )}
      </div>

      {/* Data health + urgent strip */}
      {(redSources.length > 0 || urgentAlerts.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
          {redSources.length > 0 && (
            <Link to="/tracking" className="card p-3.5 flex items-center gap-3 card-hover border-bad-400/30">
              <span className="w-9 h-9 rounded-lg bg-bad-dim flex items-center justify-center shrink-0"><AlertTriangle size={17} className="text-bad-400" /></span>
              <div className="min-w-0 flex-1">
                <div className="font-bold text-[13px]">Data quality gate is limiting decisions</div>
                <div className="text-2xs text-ink-mid truncate">{redSources.map((c) => c.name).join(', ')} below threshold — affected recommendations are blocked</div>
              </div>
              <ArrowRight size={15} className="text-ink-low shrink-0" />
            </Link>
          )}
          {urgentAlerts.length > 0 && (
            <Link to="/war-room" className="card p-3.5 flex items-center gap-3 card-hover border-warn-400/30">
              <span className="w-9 h-9 rounded-lg bg-warn-dim flex items-center justify-center shrink-0"><Flame size={17} className="text-warn-400" /></span>
              <div className="min-w-0 flex-1">
                <div className="font-bold text-[13px]">{urgentAlerts.length} issue{urgentAlerts.length > 1 ? 's' : ''} in the War Room</div>
                <div className="text-2xs text-ink-mid truncate">{urgentAlerts[0].title}</div>
              </div>
              <ArrowRight size={15} className="text-ink-low shrink-0" />
            </Link>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
        {/* Trend */}
        <Card className="p-4 lg:col-span-2">
          <SectionTitle
            title={hasRevenue ? 'Spend vs Ad Revenue' : 'Daily spend & installs'}
            hint={hasRevenue
              ? 'Daily spend against same-calendar-day ad revenue across all users. This is cash-view, not cohort-view — cohort ROAS lives in Analytics.'
              : 'No revenue source is connected, so this shows acquisition volume against cost. Once purchase value or ad revenue lands, this chart becomes spend vs revenue and ROAS unlocks everywhere.'}
          />
          <AreaTrend
            data={trendData}
            series={hasRevenue
              ? [
                { key: 'spend', name: 'Spend', color: '#5e8dff' },
                { key: 'revenue', name: 'Net revenue', color: '#34d399' },
              ]
              : [
                { key: 'spend', name: 'Spend ($)', color: '#5e8dff' },
                { key: 'installs', name: 'Installs', color: '#a78bfa' },
              ]}
            height={220}
            fmt={(v) => (hasRevenue ? fmtMoney(v) : fmtNum(v))}
            yFmt={(v) => (hasRevenue ? fmtMoney(v) : fmtNum(v))}
          />
          {!hasRevenue && (
            <p className="text-2xs text-ink-low mt-2 leading-relaxed">
              Spend is in dollars, installs in users — shown on one axis for shape comparison, not for a ratio. The blended
              CPI KPI is the correct efficiency read.
            </p>
          )}
        </Card>

        {/* Top decisions */}
        <div className="flex flex-col gap-3 min-w-0">
          <SectionTitle
            title="Needs a decision"
            right={<Link to="/queue" className="text-2xs font-bold text-brand-300 hover:text-brand-400 whitespace-nowrap">View queue →</Link>}
          />
          {pendingRecs.length === 0 ? (
            <Card className="p-5 text-center text-[13px] text-ink-mid">
              <Sparkles size={18} className="mx-auto mb-2 text-ok-400" />
              Queue is clear. New recommendations appear after each data refresh.
            </Card>
          ) : (
            pendingRecs.map((r) => <RecommendationCard key={r.recommendation_id} rec={r} compact />)
          )}
        </div>
      </div>

      {/* Campaign table */}
      <Card className="p-4">
        <SectionTitle
          title="Active campaigns"
          hint="14-day window. Click a row to open Campaign Doctor."
          right={
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <SearchInput value={search} onChange={setSearch} placeholder="Search campaigns…" className="w-44 sm:w-56" />
              <Select
                value={channelFilter}
                onChange={setChannelFilter}
                // Only channels this product actually runs on — an empty TikTok filter is noise
                options={[{ value: 'all', label: 'All channels' }, ...ds.channels
                  .filter((c) => c.kind === 'paid' && ds.campaigns.some((k) => k.channel_id === c.channel_id))
                  .map((c) => ({ value: c.channel_id, label: c.name }))]}
              />
            </div>
          }
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.campaign.campaign_id}
          onRowClick={(r) => navigate(`/doctor/${r.campaign.campaign_id}`)}
          defaultSort="spend"
          emptyTitle="No campaigns match"
          emptyMessage="Adjust the search or channel filter to see campaigns."
        />
      </Card>

      {/* First-run onboarding */}
      <Modal open={welcomeOpen} onClose={dismissWelcome} title="Welcome to the AppReel Command Center" wide>
        <div className="space-y-3 text-[13px] text-ink-mid leading-relaxed">
          <p>This is a <strong className="text-ink-hi">decision operating system</strong>, not a dashboard. Data flows through a quality gate, a decision engine turns it into explained recommendations, and every approval lands in an auditable ledger.</p>
          <ol className="space-y-2 list-none">
            {[
              ['1. Read the room', 'The Command Center shows KPIs, data health, and what needs a decision today.'],
              ['2. Decide', 'Open the Decision Queue — every recommendation carries evidence, confidence, risk, and a stop condition. Approve, reject, or dig deeper in Campaign Doctor.'],
              ['3. Handle incidents', 'The War Room manages urgent alerts with owners, SLA, and lifecycle.'],
              ['4. Learn', 'The Decision Ledger records outcomes and post-reviews so the team compounds learning.'],
              ['5. Ask', 'The Copilot answers questions with cited evidence — and says so when evidence is missing.'],
            ].map(([t, d]) => (
              <li key={t} className="flex gap-2.5">
                <span className="text-brand-300 font-bold whitespace-nowrap">{t.split('.')[0]}.</span>
                <span><strong className="text-ink-hi">{t.split('. ')[1]}.</strong> {d}</span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-ink-low border-t border-line pt-3">
            Tip: switch roles from the avatar menu (top-right) to see how RBAC changes what each team member can do.
          </p>
        </div>
        <div className="flex justify-end mt-4">
          <Button variant="primary" onClick={dismissWelcome}>Start operating</Button>
        </div>
      </Modal>
    </div>
  )
}

function Kpi({ label, value, delta, invert, deltaAbs, hint, caveat }: {
  label: string
  value: string
  delta: number
  invert?: boolean
  deltaAbs?: boolean
  hint: string
  /** Short badge naming the measurement limitation behind the number. */
  caveat?: string
}) {
  return (
    <Card className="p-3.5">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="label-2xs">{label}</span>
        <HelpTip text={hint} />
      </div>
      <div className="text-xl font-extrabold num tracking-tight">{value}</div>
      <div className="mt-0.5 flex items-center gap-1 flex-wrap">
        {caveat ? (
          <span className="text-2xs font-bold text-warn-400 bg-warn-dim rounded px-1.5 py-0.5">{caveat}</span>
        ) : (
          <>
            <DeltaTag value={delta} invert={invert} digits={deltaAbs ? 1 : 0} />
            <span className="text-2xs text-ink-low">vs prev. period</span>
          </>
        )}
      </div>
    </Card>
  )
}

const sumBy = <T,>(arr: T[], fn: (r: T) => number) => arr.reduce((a, r) => a + fn(r), 0)

const isoShift = (iso: string, days: number): string => {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
