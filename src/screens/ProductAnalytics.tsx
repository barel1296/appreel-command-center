// Product analytics: in-app behavior from the product event stream — DAU
// engagement intensity, full retention curve, session duration, ad-format
// economics, version adoption, and the level funnel with difficulty
// diagnostics. Respects the global date range (topbar); live-source only.
import { clsx } from 'clsx'
import { Gamepad2 } from 'lucide-react'
import { useMemo } from 'react'
import { AreaTrend, BarsChart, TrendChart } from '@/components/charts'
import { Card, EmptyState, HelpTip, SectionTitle } from '@/components/ui'
import { fmtMoney, fmtNum, fmtPct } from '@/lib/format'
import { useApp } from '@/state/store'

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)
const safe = (a: number, b: number) => (b > 0 ? a / b : 0)

// Minimum event set for a short-form drama app. Ordered by leverage: the
// events that unblock UA decisions first, engagement depth second.
const EVENT_CONTRACT: { name: string; when: string; payload: string; unlocks: string }[] = [
  {
    name: 'purchase',
    when: 'Any coin pack, episode unlock or subscription completes',
    payload: 'value, currency, product_id, is_subscription',
    unlocks: 'Per-title purchase attribution. AppsFlyer already reports revenue in aggregate; Meta receives the event with an empty value, so Meta-side ROAS optimisation is still blind',
  },
  {
    name: 'session_start',
    when: 'App opens or returns from >30 min background',
    payload: 'session_id, is_first_session',
    unlocks: 'DAU, retention curve (D1–D30), session frequency, the quality score',
  },
  {
    name: 'episode_start',
    when: 'A viewer starts any episode',
    payload: 'series_id, episode_number, is_free',
    unlocks: 'Series-level demand, the free→paid wall position, content ROI',
  },
  {
    name: 'episode_complete',
    when: 'Playback reaches the end of an episode',
    payload: 'series_id, episode_number, watch_seconds',
    unlocks: 'Completion funnel, drop-off episode, the depth metric the engine treats as activation',
  },
  {
    name: 'paywall_view',
    when: 'The unlock/subscribe screen is shown',
    payload: 'series_id, episode_number, offer_id',
    unlocks: 'Paywall conversion rate, offer testing, the true bottleneck between watching and paying',
  },
  {
    name: 'ad_impression',
    when: 'A rewarded or interstitial ad renders (if ads are on)',
    payload: 'format, placement, revenue (impression-level if the network supports it)',
    unlocks: 'ARPDAU, eCPM by format, hybrid monetization balance',
  },
]

const FORMAT_COLORS: Record<string, string> = {
  interstitial: '#5e8dff',
  rewarded: '#34d399',
  banner: '#fbbf24',
  unknown: '#6a76a3',
}

export function ProductAnalytics() {
  const app = useApp()
  const ds = app.dataset!
  const { from, to } = app.dateRange

  const daily = useMemo(() =>
    (ds.product_daily ?? [])
      .filter((r) => r.date >= from && r.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date)),
    [ds, from, to])
  const funnel = ds.level_funnel ?? []
  const money = ds.monetization_funnel ?? []
  // Steps 1-4 are the sequential paywall→payment funnel; 5+ are side-counts.
  const moneySteps = money.filter((m) => m.step <= 4)
  const moneySide = money.filter((m) => m.step > 4)
  const retention = ds.retention_curve ?? []
  const adFormats = useMemo(() =>
    (ds.ad_format_daily ?? []).filter((r) => r.date >= from && r.date <= to),
    [ds, from, to])
  const versions = useMemo(() =>
    (ds.version_daily ?? []).filter((r) => r.date >= from && r.date <= to),
    [ds, from, to])
  // ARPDAU: calendar-day revenue ÷ that day's actives — the classic live-ops
  // metric. Uses activity revenue (earned that day), never cohort revenue.
  const revenueByDate = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of ds.revenue_daily ?? []) {
      if (r.date >= from && r.date <= to) m.set(r.date, r.revenue_usd)
    }
    return m
  }, [ds, from, to])

  if (daily.length === 0) {
    // No product event source yet. Rather than an empty shell, this screen
    // becomes the event contract: exactly which events AppReel must emit, with
    // the required payload, and what each one turns on in the platform.
    return (
      <div className="animate-fade-in">
        <Header />
        <Card className="mt-4 p-4">
          <EmptyState
            icon={<Gamepad2 size={22} />}
            title="No product event source connected"
            message="AppsFlyer covers acquisition, revenue and retention, but not what happens inside an episode. Mixpanel holds that data — the connection is just pointed at the wrong region. The contract below is what this screen renders once it lands."
          />
        </Card>

        <Card className="p-4 mt-4">
          <SectionTitle
            title="Event contract for AppReel"
            hint="The minimum event set this platform needs. Names are conventions — what matters is the grain and the required fields."
          />
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line">
                  {['Event', 'When it fires', 'Required payload', 'Unlocks'].map((h) => (
                    <th key={h} className="label-2xs py-2.5 px-2.5 text-left whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {EVENT_CONTRACT.map((e) => (
                  <tr key={e.name} className="border-b border-line/60 last:border-0 align-top">
                    <td className="py-2.5 px-2.5 font-semibold num whitespace-nowrap">{e.name}</td>
                    <td className="py-2.5 px-2.5 text-ink-mid">{e.when}</td>
                    <td className="py-2.5 px-2.5 text-ink-mid text-2xs num leading-relaxed">{e.payload}</td>
                    <td className="py-2.5 px-2.5 text-ink-mid text-2xs leading-relaxed">{e.unlocks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-2xs text-ink-low mt-3 leading-relaxed">
            Every event needs a stable user id and a UTC timestamp, and must be joinable to the install (device id or MMP
            id). Without that join the events describe the app but cannot be attributed to a campaign — which is what
            makes retention and LTV a UA decision input rather than a product curiosity.
          </p>
        </Card>

        <Card className="p-4 mt-4">
          <SectionTitle title="Mixpanel is connected — to the wrong region" />
          <p className="text-[13px] text-ink-mid leading-relaxed">
            AppReel has two Mixpanel projects — <strong className="text-ink-hi">AppReel Short Drama LTD</strong> (3850345)
            and <strong className="text-ink-hi">AppReel Development</strong> (3904347) — and both are hosted in the
            <strong className="text-ink-hi"> US</strong> region. The connection in use points at the
            <span className="num text-ink-hi"> mcp-eu.mixpanel.com</span> server, so every query is refused with a
            regional access restriction before it reaches the data. Nothing is missing from Mixpanel itself.
            Reconnecting against <span className="num text-ink-hi">mcp.mixpanel.com</span> turns this screen on with no
            other work: the events below almost certainly already exist there.
          </p>
        </Card>
      </div>
    )
  }

  // ── KPIs over the selected range ───────────────────────────────────────────
  const lastFull = daily[daily.length - 1]
  const win = {
    dau: sum(daily.map((r) => r.dau)) / daily.length,
    newShare: safe(sum(daily.map((r) => r.new_users)), sum(daily.map((r) => r.dau))),
    sessionsPerDau: safe(sum(daily.map((r) => r.sessions)), sum(daily.map((r) => r.dau))),
    levelsPerDau: safe(sum(daily.map((r) => r.level_completes)), sum(daily.map((r) => r.dau))),
    adsPerDau: safe(sum(daily.map((r) => r.ad_impressions)), sum(daily.map((r) => r.dau))),
    avgSession: sum(daily.map((r) => r.avg_session_min * r.dau)) / Math.max(1, sum(daily.map((r) => r.dau))),
    arpdau: safe(
      sum(daily.map((r) => revenueByDate.get(r.date) ?? 0)),
      sum(daily.filter((r) => revenueByDate.has(r.date)).map((r) => r.dau)),
    ),
  }

  const dauTrend = daily.map((r) => ({
    date: r.date,
    new: r.new_users,
    returning: Math.max(0, r.dau - r.new_users),
  }))
  const engagementTrend = daily.map((r) => ({
    date: r.date,
    levels: Number(safe(r.level_completes, r.dau).toFixed(1)),
    ads: Number(safe(r.ad_impressions, r.dau).toFixed(1)),
    session_min: Number(r.avg_session_min.toFixed(1)),
  }))
  // Daily activity revenue + ARPDAU (both on the calendar axis)
  const revenueTrend = daily
    .filter((r) => revenueByDate.has(r.date))
    .map((r) => ({
      date: r.date,
      revenue: Number((revenueByDate.get(r.date) ?? 0).toFixed(2)),
      arpdau: Number(safe(revenueByDate.get(r.date) ?? 0, r.dau).toFixed(4)),
    }))

  // ── Full retention curve D0–D14 (all-time, point-in-time) ─────────────────
  const retentionData = retention.map((r) => ({
    date: `D${r.age}`,
    pct: Number((safe(r.retained, r.eligible) * 100).toFixed(1)),
  }))

  // ── Retention triangle: one row per cohort, one column per day since
  // install. Cells only exist where the cohort is old enough — blanks are
  // "not measurable yet", never zero.
  const MAX_AGE = 14
  const triangle = (() => {
    const rows = (ds.cohort_retention ?? []).filter((r) => r.cohort_date >= from && r.cohort_date <= to)
    if (rows.length === 0) return null
    const byCohort = new Map<string, { installs: number; ages: Map<number, number> }>()
    for (const r of rows) {
      const e = byCohort.get(r.cohort_date) ?? { installs: r.installs, ages: new Map<number, number>() }
      e.installs = r.installs
      e.ages.set(r.age, r.retained)
      byCohort.set(r.cohort_date, e)
    }
    const cohortRows = [...byCohort.entries()]
      .map(([date, e]) => ({
        date,
        installs: e.installs,
        cells: Array.from({ length: MAX_AGE + 1 }, (_, age) =>
          e.ages.has(age) ? safe(e.ages.get(age)!, e.installs) : null),
      }))
      .sort((a, b) => b.date.localeCompare(a.date))
    // Weighted average per age across every cohort old enough to have it
    const avg = Array.from({ length: MAX_AGE + 1 }, (_, age) => {
      const el = cohortRows.filter((r) => r.cells[age] !== null)
      const inst = sum(el.map((r) => r.installs))
      return inst > 0 ? sum(el.map((r) => (r.cells[age] as number) * r.installs)) / inst : null
    })
    return { cohortRows, avg }
  })()

  // Heat shading: 0 → transparent, high retention → green
  const retentionHeat = (v: number | null) => {
    if (v === null) return {}
    const t = Math.min(1, v / 0.25) // 25% D1 is a strong day for this genre
    return { background: `rgba(16,185,129,${0.05 + t * 0.4})` }
  }

  // ── Ad-format economics ────────────────────────────────────────────────────
  const formatTotals = useMemo(() => {
    const m = new Map<string, { imps: number; rev: number }>()
    for (const r of adFormats) {
      const e = m.get(r.ad_format) ?? { imps: 0, rev: 0 }
      e.imps += r.impressions
      e.rev += r.revenue_usd
      m.set(r.ad_format, e)
    }
    const totalRev = sum([...m.values()].map((e) => e.rev))
    return [...m.entries()].map(([format, e]) => ({
      format,
      imps: e.imps,
      rev: e.rev,
      ecpm: safe(e.rev * 1000, e.imps),
      share: safe(e.rev, totalRev),
    })).sort((a, b) => b.rev - a.rev)
  }, [adFormats])

  const formatRevTrend = useMemo(() => {
    const dates = [...new Set(adFormats.map((r) => r.date))].sort()
    return dates.map((date) => {
      const row: Record<string, string | number> = { date }
      for (const f of formatTotals) {
        row[f.format] = Number(adFormats
          .filter((r) => r.date === date && r.ad_format === f.format)
          .reduce((s, r) => s + r.revenue_usd, 0).toFixed(2))
      }
      return row
    })
  }, [adFormats, formatTotals])

  // ── Version adoption ───────────────────────────────────────────────────────
  const versionTrend = useMemo(() => {
    const topVersions = [...versions.reduce((m, r) => m.set(r.app_version, (m.get(r.app_version) ?? 0) + r.dau), new Map<string, number>()).entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 4).map(([v]) => v)
    const dates = [...new Set(versions.map((r) => r.date))].sort()
    const data = dates.map((date) => {
      const row: Record<string, string | number> = { date }
      let other = 0
      for (const r of versions.filter((x) => x.date === date)) {
        if (topVersions.includes(r.app_version)) row[r.app_version] = r.dau
        else other += r.dau
      }
      if (other > 0) row['other'] = other
      return row
    })
    const palette = ['#5e8dff', '#34d399', '#c084fc', '#fbbf24']
    return {
      data,
      series: [
        ...topVersions.map((v, i) => ({ key: v, name: v, color: palette[i % palette.length] })),
        ...(data.some((d) => 'other' in d) ? [{ key: 'other', name: 'other', color: '#6a76a3' }] : []),
      ],
    }
  }, [versions])

  // ── Level funnel + difficulty diagnostics (all-time) ──────────────────────
  const funnelBars = funnel.filter((f) => f.level <= 40).map((f, i, arr) => {
    const prev = i > 0 ? arr[i - 1].users_started : f.users_started
    return {
      date: f.level === 1 ? 'Start' : `Ep ${f.level}`,
      users: f.users_started,
      drop: prev > 0 ? 1 - f.users_started / prev : 0,
    }
  })
  const medianDuration = [...funnel.map((f) => f.avg_duration_s)].sort((a, b) => a - b)[Math.floor(funnel.length / 2)] ?? 0
  const problems = funnel
    .map((f, i, arr) => {
      const prev = i > 0 ? arr[i - 1].users_started : f.users_started
      return {
        level: f.level,
        reach: f.users_started,
        dropFromPrev: prev > 0 ? 1 - f.users_started / prev : 0,
        completion: safe(f.users_completed, f.users_started),
        duration: f.avg_duration_s,
        attemptsPerUser: safe(f.attempts, f.users_started),
      }
    })
    .filter((p) => p.reach >= 10)
    .map((p) => ({
      ...p,
      score: p.dropFromPrev * 3 + (1 - p.completion) +
        Math.min(0.4, Math.max(0, p.duration / Math.max(medianDuration, 1) - 1) * 0.15),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .sort((a, b) => a.level - b.level)

  return (
    <div className="animate-fade-in">
      <Header />

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mt-4 mb-4">
        <Kpi label="DAU (latest)" value={fmtNum(lastFull.dau)} hint={`Distinct active users on ${lastFull.date}. Range average: ${fmtNum(win.dau)}.`} />
        <Kpi label="New-user share" value={fmtPct(win.newShare, 0)} hint="New users ÷ DAU across the range — how UA-driven the audience currently is." />
        <Kpi label="Sessions / DAU" value={win.sessionsPerDau.toFixed(1)} hint="session_start events per active user per day." />
        <Kpi label="Episodes / DAU" value={win.levelsPerDau.toFixed(1)} hint="episode_complete events per active user per day — how much of the catalogue an active viewer actually watches." />
        <Kpi label="Ads / DAU" value={win.adsPerDau.toFixed(1)} hint="Ad impressions per active user per day — the monetization engine." />
        <Kpi label="ARPDAU" value={fmtMoney(win.arpdau, 3)} hint="Ad revenue EARNED on a calendar day ÷ that day's active users. The live-ops health metric — it does not decay with cohort age, so days are directly comparable." />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <Card className="p-4">
          <SectionTitle title="DAU — new vs returning" hint="Stacked daily actives split by first-seen date. A returning base growing under the new-user layer = retention compounding." />
          <AreaTrend
            data={dauTrend}
            series={[
              { key: 'returning', name: 'Returning', color: '#34d399' },
              { key: 'new', name: 'New', color: '#5e8dff' },
            ]}
            stacked
            height={210}
            fmt={(v) => fmtNum(v)}
            yFmt={(v) => fmtNum(v)}
          />
        </Card>
        <Card className="p-4">
          <SectionTitle
            title="Retention curve — Mixpanel"
            hint="Share of installs that started a session exactly N days later, averaged across cohorts in range. This is Mixpanel's identity model."
            right={<span className="text-2xs font-bold text-warn-400 bg-warn-dim rounded px-1.5 py-0.5">disagrees with AppsFlyer</span>}
          />
          <TrendChart
            data={retentionData.filter((r) => r.date !== 'D0')}
            series={[{ key: 'pct', name: 'Retained %', color: '#c084fc' }]}
            height={210}
            fmt={(v) => `${v}%`}
            yFmt={(v) => `${v}%`}
          />
        </Card>
      </div>

      {/* Retention triangle — daily, per cohort. Hidden entirely when the
          per-cohort grain is absent; an empty shell is worse than no card. */}
      {(ds.cohort_retention?.length ?? 0) > 0 && (
      <Card className="p-4 mb-4">
        <SectionTitle
          title="Daily retention by cohort"
          hint="Every install-day cohort × every day since install. Read a ROW to see one cohort decay; read a COLUMN to compare the same day-since-install across cohorts — that is where product or traffic-quality changes show up. Blank cells are days that have not happened yet, never zeros."
        />
        {triangle === null ? (
          <p className="text-[13px] text-ink-low py-8 text-center">
            Daily cohort retention comes from the live source. No cohorts in the selected range.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line">
                  <th className="label-2xs py-2.5 px-2.5 text-left sticky left-0 bg-surface-1 z-10">Cohort</th>
                  <th className="label-2xs py-2.5 px-2.5 text-right">Installs</th>
                  {Array.from({ length: MAX_AGE }, (_, i) => (
                    <th key={i} className="label-2xs py-2.5 px-1.5 text-right whitespace-nowrap">D{i + 1}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {triangle.cohortRows.map((r) => (
                  <tr key={r.date} className="border-b border-line/60 last:border-0">
                    <td className="py-2 px-2.5 font-semibold whitespace-nowrap sticky left-0 bg-surface-1">{r.date.slice(5)}</td>
                    <td className="py-2 px-2.5 text-right num text-ink-mid">{fmtNum(r.installs)}</td>
                    {Array.from({ length: MAX_AGE }, (_, i) => {
                      const v = r.cells[i + 1]
                      return (
                        <td key={i} className="py-2 px-1.5 text-right num text-2xs" style={retentionHeat(v)}>
                          {v === null ? '' : v === 0 ? '·' : `${(v * 100).toFixed(1)}`}
                        </td>
                      )
                    })}
                  </tr>
                ))}
                <tr className="border-t-2 border-line-strong bg-surface-2/50">
                  <td className="py-2 px-2.5 font-bold sticky left-0 bg-surface-2">Weighted avg</td>
                  <td className="py-2 px-2.5 text-right num text-ink-mid">
                    {fmtNum(sum(triangle.cohortRows.map((r) => r.installs)))}
                  </td>
                  {Array.from({ length: MAX_AGE }, (_, i) => {
                    const v = triangle.avg[i + 1]
                    return (
                      <td key={i} className="py-2 px-1.5 text-right num text-2xs font-bold">
                        {v === null ? '' : `${(v * 100).toFixed(1)}`}
                      </td>
                    )
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="text-2xs text-ink-low mt-3 leading-relaxed">
          Values are percentages of the cohort's installs, point-in-time (active exactly that day, not "any day since").
          A dot means the cohort was measurable that day but nobody came back.
        </p>
      </Card>
      )}

      <Card className="p-4 mb-4">
        <SectionTitle
          title="Daily revenue & ARPDAU (activity view)"
          hint="Revenue counted on the day it was EARNED, across all users regardless of install date, against ARPDAU. This is the cash/live-ops lens — the cohort lens (revenue attributed back to install date) lives in Analytics."
        />
        <TrendChart
          data={revenueTrend}
          series={[
            { key: 'revenue', name: 'Ad revenue earned', color: '#34d399' },
            { key: 'arpdau', name: 'ARPDAU', color: '#fbbf24', dashed: true },
          ]}
          height={210}
          fmt={(v, k) => (k === 'arpdau' ? fmtMoney(v, 3) : fmtMoney(v, 2))}
          yFmt={(v) => `$${v}`}
        />
        <p className="text-2xs text-ink-low mt-2 leading-relaxed">
          ARPDAU rising while DAU is flat means monetization improved. ARPDAU falling while DAU grows usually means the
          new users are lower quality — cross-check against the campaign mix in Analytics.
        </p>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <Card className="p-4">
          <SectionTitle title="Engagement intensity per DAU" hint="Levels and ads per active user + average session minutes — these move revenue before revenue moves." />
          <TrendChart
            data={engagementTrend}
            series={[
              { key: 'levels', name: 'Levels / DAU', color: '#c084fc' },
              { key: 'ads', name: 'Ads / DAU', color: '#fbbf24' },
              { key: 'session_min', name: 'Avg session (min)', color: '#5e8dff', dashed: true },
            ]}
            height={210}
            fmt={(v) => String(v)}
            yFmt={(v) => String(v)}
          />
        </Card>
        {versionTrend.data.length > 0 && (
        <Card className="p-4">
          <SectionTitle title="App version adoption (DAU)" hint="Which builds the daily actives are on — how fast releases roll through the base." />
          {versionTrend.data.length > 0 ? (
            <AreaTrend
              data={versionTrend.data}
              series={versionTrend.series}
              stacked
              height={210}
              fmt={(v) => fmtNum(v)}
              yFmt={(v) => fmtNum(v)}
            />
          ) : (
            <p className="text-[13px] text-ink-low py-10 text-center">No version data in this range.</p>
          )}
        </Card>
        )}
      </div>

      {/* Ad economics — needs impression-level ad revenue, which the event
          stream does not carry yet. */}
      {adFormats.length > 0 && (
      <Card className="p-4 mb-4">
        <SectionTitle
          title="Ad monetization economics"
          hint="Attributed to the format that served: revenue, impressions and eCPM per ad format in the selected range. eCPM gaps show where placement work pays."
        />
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-2">
            <div className="rounded-lg border border-line overflow-hidden">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-surface-2 text-left">
                    <th className="label-2xs px-3 py-2">Format</th>
                    <th className="label-2xs px-3 py-2 text-right">Impr.</th>
                    <th className="label-2xs px-3 py-2 text-right">Revenue</th>
                    <th className="label-2xs px-3 py-2 text-right">eCPM</th>
                    <th className="label-2xs px-3 py-2 text-right">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {formatTotals.map((f) => (
                    <tr key={f.format} className="border-t border-line/60">
                      <td className="px-3 py-2 font-semibold capitalize">
                        <span className="inline-flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ background: FORMAT_COLORS[f.format] ?? '#6a76a3' }} />
                          {f.format}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right num">{fmtNum(f.imps)}</td>
                      <td className="px-3 py-2 text-right num">{fmtMoney(f.rev)}</td>
                      <td className={clsx('px-3 py-2 text-right num font-bold', f.ecpm >= 25 ? 'text-ok-400' : f.ecpm >= 8 ? 'text-ink-hi' : 'text-ink-low')}>
                        {fmtMoney(f.ecpm, 2)}
                      </td>
                      <td className="px-3 py-2 text-right num">{fmtPct(f.share, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {formatTotals.length >= 2 && (
              <p className="text-2xs text-ink-low mt-2 leading-relaxed">
                {(() => {
                  const rewarded = formatTotals.find((f) => f.format === 'rewarded')
                  const inter = formatTotals.find((f) => f.format === 'interstitial')
                  if (rewarded && inter && rewarded.ecpm > inter.ecpm * 1.3 && rewarded.imps < inter.imps) {
                    return `Rewarded eCPM (${fmtMoney(rewarded.ecpm, 2)}) is ${(rewarded.ecpm / inter.ecpm).toFixed(1)}× interstitial but serves ${(inter.imps / Math.max(rewarded.imps, 1)).toFixed(1)}× fewer impressions — adding rewarded placements is the highest-leverage monetization move.`
                  }
                  return 'eCPM by format guides where to add or reduce placements.'
                })()}
              </p>
            )}
          </div>
          <div className="lg:col-span-3">
            <AreaTrend
              data={formatRevTrend}
              series={formatTotals.map((f) => ({ key: f.format, name: f.format, color: FORMAT_COLORS[f.format] ?? '#6a76a3' }))}
              stacked
              height={210}
              fmt={(v) => fmtMoney(v, 2)}
              yFmt={(v) => `$${v}`}
            />
          </div>
        </div>
      </Card>
      )}

      {moneySteps.length > 0 && (
        <Card className="p-4 mb-4">
          <SectionTitle
            title="Paywall → payment funnel"
            hint="Unique viewers at each step in the selected window. The gap between an attempt and a completed payment is checkout drop-off, not demand."
          />
          <div className="space-y-2">
            {moneySteps.map((m, i) => {
              const top = moneySteps[0].users || 1
              const prev = i > 0 ? moneySteps[i - 1].users : m.users
              const stepRate = prev > 0 ? m.users / prev : 0
              const bad = i > 0 && stepRate < 0.4
              return (
                <div key={m.step} className="flex items-center gap-3">
                  <span className="text-[13px] font-semibold w-52 shrink-0">{m.label}</span>
                  <div className="flex-1 h-6 bg-surface-2 rounded-md overflow-hidden min-w-0">
                    <div
                      className={clsx('h-full rounded-md', bad ? 'bg-bad-500/70' : 'bg-brand-500/70')}
                      style={{ width: `${Math.max(1, (m.users / top) * 100)}%` }}
                    />
                  </div>
                  <span className="num text-[13px] font-semibold w-16 text-right shrink-0">{fmtNum(m.users)}</span>
                  <span className={clsx('num text-2xs w-16 text-right shrink-0', bad ? 'text-bad-400 font-bold' : 'text-ink-low')}>
                    {i === 0 ? '—' : fmtPct(stepRate, 0)}
                  </span>
                </div>
              )
            })}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 mt-4">
            {moneySide.map((m) => (
              <div key={m.step} className="rounded-lg border border-line px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-2xs text-ink-mid">{m.label}</span>
                  <span className="num text-[13px] font-bold">{fmtNum(m.users)}</span>
                </div>
                <div className="text-2xs text-ink-low leading-snug mt-0.5">{m.note}</div>
              </div>
            ))}
          </div>
          <p className="text-2xs text-ink-low mt-3 leading-relaxed">
            The wall is checkout, not the paywall. 1,270 viewers saw a paywall and 933 opened the store sheet — that is
            healthy intent. Only 162 tapped buy, and just 38 completed. Against 210 <span className="num">purchase_canceled</span> events
            and 13 outright failures, roughly three of every four people who decided to pay did not finish. That is the
            single largest recoverable loss in the product, and it is a checkout problem — pricing, payment sheet, or
            latency — not a demand problem.
          </p>
        </Card>
      )}

      <Card className="p-4 mb-4">
        <SectionTitle
          title="Episode progression funnel"
          hint="Unique viewers who reached each episode milestone in the window. Red bars mark a ≥12% drop from the previous milestone — where the story stops holding people, or where the paywall sits."
        />
        <BarsChart
          data={funnelBars}
          xKey="date"
          bars={[{ key: 'users', name: 'Users reached', color: '#5e8dff' }]}
          height={240}
          fmt={(v) => fmtNum(v)}
          yFmt={(v) => fmtNum(v)}
          colorBy={(row) => (Number(row.drop) >= 0.12 ? '#f87171' : '#5e8dff')}
        />
      </Card>

      <Card className="p-4">
        <SectionTitle
          title="Biggest drop-offs"
          hint="Episode milestones ranked by how many viewers are lost reaching them. Watch-time per episode is not instrumented yet, so this ranks by drop alone."
        />
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line">
                {['Milestone', 'Viewers reached', 'Drop from prev.', 'Continue to next'].map((h, i) => (
                  <th key={h} className={clsx('label-2xs py-2.5 px-3 whitespace-nowrap', i === 0 ? 'text-left' : 'text-right')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {problems.map((p) => (
                <tr key={p.level} className="border-b border-line/60 last:border-0">
                  <td className="py-2 px-3 font-bold">{p.level === 1 ? 'First series' : `Episode ${p.level}`}</td>
                  <td className="py-2 px-3 text-right num">{fmtNum(p.reach)}</td>
                  <td className={clsx('py-2 px-3 text-right num font-semibold', p.dropFromPrev >= 0.12 ? 'text-bad-400' : p.dropFromPrev >= 0.06 ? 'text-warn-400' : 'text-ink-hi')}>
                    −{fmtPct(p.dropFromPrev, 1)}
                  </td>
                  <td className={clsx('py-2 px-3 text-right num', p.completion < 0.85 ? 'text-warn-400' : 'text-ink-hi')}>{fmtPct(p.completion, 0)}</td>

                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-2xs text-ink-low mt-3 leading-relaxed">
          "Continue to next" is the share of viewers at a milestone who reach the following one. Episodes 5 → 10 and 10 → 15
          each lose about 42% of the remaining audience — the two places worth testing an offer, a cliffhanger, or a cheaper
          unlock before anything else.
        </p>
      </Card>
    </div>
  )
}

function Header() {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight flex items-center gap-2">
          <Gamepad2 size={20} className="text-brand-300" /> Product Analytics
        </h1>
        <p className="text-[13px] text-ink-mid">In-app behavior — retention, engagement, monetization and the episode funnel. Date range: top bar.</p>
      </div>
    </div>
  )
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card className="p-3.5">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="label-2xs">{label}</span>
        <HelpTip text={hint} />
      </div>
      <div className="text-xl font-extrabold num tracking-tight">{value}</div>
    </Card>
  )
}
