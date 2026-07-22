// ─────────────────────────────────────────────────────────────────────────────
// CONTENT — the screen a short-drama app needs and a game does not.
//
// For AppReel the catalogue IS the product: a series is the unit that acquires,
// retains and monetizes. This screen answers three questions the UA screens
// cannot:
//   1. Which series hold viewers (binge depth) vs merely get opened?
//   2. Which series convert a paywall into money?
//   3. Are we buying traffic for the series that actually perform?
// (3) is the loop that matters — creatives are clips of specific dramas, so
// spend and catalogue performance are directly comparable.
// ─────────────────────────────────────────────────────────────────────────────
import { clsx } from 'clsx'
import { Clapperboard, Coins, Megaphone, Smartphone, TrendingDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { TrendChart } from '@/components/charts'
import { Column, DataTable } from '@/components/DataTable'
import { Card, EmptyState, HelpTip, SectionTitle } from '@/components/ui'
import { fmtMoney, fmtNum, fmtPct } from '@/lib/format'
import { useApp } from '@/state/store'

const safe = (a: number, b: number) => (b > 0 ? a / b : 0)

interface SeriesRow {
  name: string
  starts: number
  completers: number | null
  epCompletes: number
  epsPerStarter: number
  holdRate: number | null
  paywallUsers: number
  unlocks: number | null
  purchases: number
  payRate: number
  advertised: string | null
  spend: number
}

export function Content() {
  const app = useApp()
  const ds = app.dataset!
  const [sort, setSort] = useState<'starts' | 'epsPerStarter' | 'payRate'>('starts')

  // Platform filter picks the matching grain: 'all' rows carry catalogue-wide
  // metrics (completers, unlocks) that Mixpanel only reports blended; the
  // ios/android rows carry the four metrics it does split by os.
  const platform = app.platform
  const series = (ds.series ?? []).filter((s) => s.platform === platform)
  const seriesEp = ds.series_episode ?? []
  const [pick, setPick] = useState<string>('')

  // Per-series episode curve + wall detection, built from the DATE-GRAINED
  // completion facts so the date picker genuinely narrows it. Completions are
  // total events and therefore additive across days; daily unique viewers are
  // not, which is why this is measured in completions.
  const { from, to } = app.dateRange
  const curves = useMemo(() => {
    const daily = ds.series_episode_daily ?? []
    const src = daily.length > 0
      ? daily.filter((r) => r.date >= from && r.date <= to)
        .map((r) => ({ series_name: r.series_name, episode: r.episode, viewers: r.completions }))
      : seriesEp
    const by = new Map<string, Map<number, number>>()
    for (const r of src) {
      const m = by.get(r.series_name) ?? new Map<number, number>()
      m.set(r.episode, (m.get(r.episode) ?? 0) + r.viewers)
      by.set(r.series_name, m)
    }
    return [...by.entries()].map(([name, m]) => {
      const maxEp = Math.max(...m.keys())
      const arr = Array.from({ length: maxEp }, (_, i) => ({ episode: i + 1, viewers: m.get(i + 1) ?? 0 }))
      let wall = { ep: 0, drop: 0 }
      for (let i = 1; i < arr.length; i++) {
        const prev = arr[i - 1].viewers
        if (prev < 10) continue
        const d = (prev - arr[i].viewers) / prev
        if (d > wall.drop) wall = { ep: arr[i - 1].episode, drop: d }
      }
      const peak = arr[0]?.viewers ?? 0
      const tail = arr[arr.length - 1]?.viewers ?? 0
      return { name, arr, wall, peak, survival: peak > 0 ? tail / peak : 0 }
    }).filter((c) => c.peak > 0).sort((a, b) => b.peak - a.peak)
  }, [ds, seriesEp, from, to])

  const active = curves.find((c) => c.name === pick) ?? curves[0]
  const coins = ds.coins ?? []
  const iap = ds.iap ?? []

  // Spend attributed to a series via the creative concept that promotes it.
  // Creative "concept" holds the drama title, so this join is exact for the
  // series we advertise and empty for the rest — which is itself the finding.
  const spendByConcept = useMemo(() => {
    const byCreative = new Map<string, number>()
    for (const s of ds.spend) byCreative.set(s.creative_asset_id, (byCreative.get(s.creative_asset_id) ?? 0) + s.spend)
    const m = new Map<string, number>()
    for (const c of ds.creatives) {
      m.set(c.concept, (m.get(c.concept) ?? 0) + (byCreative.get(c.creative_asset_id) ?? 0))
    }
    return m
  }, [ds])

  // Starts / completions narrow with the date picker when the daily grain is
  // available; paywall and purchase counts have no daily grain, so they stay at
  // window totals and the footnote says so.
  const dailyBySeries = useMemo(() => {
    const m = new Map<string, { starts: number; eps: number }>()
    for (const r of ds.series_daily ?? []) {
      if (r.date < from || r.date > to) continue
      const e = m.get(r.series_name) ?? { starts: 0, eps: 0 }
      e.starts += r.starts; e.eps += r.episode_completes
      m.set(r.series_name, e)
    }
    return m
  }, [ds, from, to])
  const narrowed = (ds.series_daily?.length ?? 0) > 0 && platform === 'all'

  const rows: SeriesRow[] = useMemo(() => series.map((s) => ({
    name: s.series_name,
    starts: narrowed ? (dailyBySeries.get(s.series_name)?.starts ?? 0) : s.starts,
    completers: s.completers,
    epCompletes: narrowed ? (dailyBySeries.get(s.series_name)?.eps ?? 0) : s.episode_completes,
    epsPerStarter: narrowed
      ? safe(dailyBySeries.get(s.series_name)?.eps ?? 0, dailyBySeries.get(s.series_name)?.starts ?? 0)
      : safe(s.episode_completes, s.starts),
    holdRate: s.completers === null ? null : safe(s.completers, s.starts),
    paywallUsers: s.paywall_users,
    unlocks: s.unlocks,
    purchases: s.purchases,
    payRate: safe(s.purchases, s.paywall_users),
    advertised: s.advertised_as,
    spend: s.advertised_as ? (spendByConcept.get(s.advertised_as) ?? 0) : 0,
  })).filter((r) => r.starts > 0 || r.epCompletes > 0), [series, spendByConcept, narrowed, dailyBySeries])

  const totals = useMemo(() => {
    const starts = rows.reduce((a, r) => a + r.starts, 0)
    const eps = rows.reduce((a, r) => a + r.epCompletes, 0)
    const pur = rows.reduce((a, r) => a + r.purchases, 0)
    const paywall = rows.reduce((a, r) => a + r.paywallUsers, 0)
    const advertisedStarts = rows.filter((r) => r.advertised).reduce((a, r) => a + r.starts, 0)
    return { starts, eps, pur, paywall, epsPerStarter: safe(eps, starts), advertisedShare: safe(advertisedStarts, starts) }
  }, [rows])

  const coin = (k: string) => coins.find((c) => c.metric === k)?.value ?? 0
  const coinsEarned = coin('earned')
  const coinsSpent = coin('spent')
  const burnRate = safe(coinsSpent, coinsEarned)

  // The gap that matters: series people watch heavily but we do not advertise,
  // and series we advertise that do not hold anyone.
  const unadvertisedWinners = [...rows]
    .filter((r) => !r.advertised && r.starts >= 40)
    .sort((a, b) => b.epsPerStarter - a.epsPerStarter)
    .slice(0, 4)
  const advertisedLaggards = [...rows]
    .filter((r) => r.advertised && r.spend > 0)
    .sort((a, b) => a.payRate - b.payRate)

  if (series.length === 0) {
    return (
      <div className="animate-fade-in">
        <Header />
        <Card className="mt-4">
          <EmptyState
            icon={<Clapperboard size={22} />}
            title="No catalogue data"
            message="Series-level facts come from the product event source (series_name on playback and paywall events). Connect it to see which dramas actually carry the business."
          />
        </Card>
      </div>
    )
  }

  const columns: Column<SeriesRow>[] = [
    {
      key: 'name',
      header: 'Series',
      render: (r) => (
        <div className="min-w-0">
          <div className="font-semibold text-ink-hi truncate max-w-[260px]">{r.name}</div>
          <div className="text-2xs text-ink-low">
            {r.advertised
              ? <span className="text-brand-300">advertised · {fmtMoney(r.spend)}</span>
              : <span>not advertised</span>}
          </div>
        </div>
      ),
      sortValue: (r) => r.name,
    },
    { key: 'starts', header: 'Starts', align: 'right', render: (r) => <span className="num font-semibold">{fmtNum(r.starts)}</span>, sortValue: (r) => r.starts },
    {
      key: 'epsPerStarter',
      header: <span className="inline-flex items-center gap-1">Eps / starter <HelpTip text="Episode completions ÷ viewers who started the series. The binge-depth metric: how much of the story a viewer actually consumes once they begin." /></span>,
      align: 'right',
      render: (r) => (
        <span className={clsx('num font-bold', r.epsPerStarter >= 8 ? 'text-ok-400' : r.epsPerStarter >= 4 ? 'text-warn-400' : 'text-ink-mid')}>
          {r.epsPerStarter.toFixed(1)}
        </span>
      ),
      sortValue: (r) => r.epsPerStarter,
    },
    { key: 'hold', header: 'Hold rate', align: 'right', hideBelow: 'md', render: (r) => <span className="num">{r.holdRate === null ? <span className="text-ink-low">—</span> : fmtPct(r.holdRate, 0)}</span>, sortValue: (r) => r.holdRate ?? -1 },
    { key: 'paywall', header: 'Hit paywall', align: 'right', hideBelow: 'sm', render: (r) => <span className="num">{fmtNum(r.paywallUsers)}</span>, sortValue: (r) => r.paywallUsers },
    { key: 'unlocks', header: 'Unlocks', align: 'right', hideBelow: 'lg', render: (r) => <span className="num">{r.unlocks === null ? <span className="text-ink-low">—</span> : fmtNum(r.unlocks)}</span>, sortValue: (r) => r.unlocks ?? -1 },
    { key: 'purchases', header: 'Purchases', align: 'right', render: (r) => <span className="num">{r.purchases > 0 ? fmtNum(r.purchases) : <span className="text-ink-low">—</span>}</span>, sortValue: (r) => r.purchases },
    {
      key: 'payRate',
      header: <span className="inline-flex items-center gap-1">Paywall → pay <HelpTip text="Purchases ÷ viewers who hit a paywall on this series. The cleanest read on whether a story is worth paying to continue." /></span>,
      align: 'right',
      render: (r) => (
        <span className={clsx('num font-semibold', r.payRate >= 0.06 ? 'text-ok-400' : r.payRate > 0 ? 'text-warn-400' : 'text-ink-low')}>
          {r.paywallUsers > 0 ? fmtPct(r.payRate, 1) : '—'}
        </span>
      ),
      sortValue: (r) => r.payRate,
    },
  ]

  return (
    <div className="animate-fade-in">
      <Header />

      {platform !== 'all' && (
        <div className="card border-brand-400/30 px-4 py-2.5 mt-4 flex items-center gap-2.5 text-[13px]">
          <Smartphone size={14} className="text-brand-300 shrink-0" />
          <span className="text-ink-mid">
            Showing <strong className="text-ink-hi">{platform === 'ios' ? 'iOS' : 'Android'}</strong> only. Hold rate and
            unlocks are reported catalogue-wide by the event source and blank out per platform. The episode drop-off curve
            below is blended across both.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mt-4 mb-4">
        <Kpi label="Series watched" value={fmtNum(series.length)} hint="Distinct series with playback in the selected window." />
        <Kpi label="Series starts" value={fmtNum(totals.starts)} hint="Viewers beginning a series. One viewer can start several." />
        <Kpi label="Eps / starter" value={totals.epsPerStarter.toFixed(1)} hint="Catalogue-wide binge depth: episode completions ÷ series starts." />
        <Kpi label="Advertised share" value={fmtPct(totals.advertisedShare, 0)} hint="Share of series starts going to titles we actually buy traffic for. The rest is catalogue pull we are not amplifying." />
        <Kpi label="Coin burn" value={fmtPct(burnRate, 0)} hint="Coins spent ÷ coins earned. Low burn means the faucet outruns the sink — viewers hold currency they never use." />
        <Kpi label="Purchases" value={fmtNum(totals.pur)} hint="Completed payments attributed to a series." />
      </div>

      {/* The UA ↔ content loop */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <Card className="p-4">
          <SectionTitle
            title="Winners we are not buying"
            hint="Series with real binge depth that no creative promotes. Each one is a ready-made creative brief — the audience already proved the story holds."
          />
          {unadvertisedWinners.length === 0 ? (
            <p className="text-[13px] text-ink-mid py-6 text-center">Every strong series already has a creative behind it.</p>
          ) : (
            <div className="space-y-2">
              {unadvertisedWinners.map((r) => (
                <div key={r.name} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
                  <span className="w-8 h-8 rounded-lg bg-ok-dim flex items-center justify-center shrink-0">
                    <Megaphone size={15} className="text-ok-400" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold truncate">{r.name}</div>
                    <div className="text-2xs text-ink-low">
                      {fmtNum(r.starts)} starts · {r.epsPerStarter.toFixed(1)} eps/starter · {r.purchases} purchases
                    </div>
                  </div>
                  <span className="text-2xs font-bold text-ok-400 shrink-0">no spend</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-4">
          <SectionTitle
            title="Spend vs paywall conversion"
            hint="Series we do buy, ranked by how poorly the paywall converts. Money at the top of this list is buying viewers for stories they will not pay to finish."
            right={<FixedWindow />}
          />
          {advertisedLaggards.length === 0 ? (
            <p className="text-[13px] text-ink-mid py-6 text-center">No advertised series with spend in this window.</p>
          ) : (
            <div className="space-y-2">
              {advertisedLaggards.map((r) => (
                <div key={r.name} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
                  <span className={clsx('w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                    r.payRate >= 0.06 ? 'bg-ok-dim' : 'bg-bad-dim')}>
                    <TrendingDown size={15} className={r.payRate >= 0.06 ? 'text-ok-400' : 'text-bad-400'} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold truncate">{r.name}</div>
                    <div className="text-2xs text-ink-low">
                      {fmtMoney(r.spend)} spent · {fmtNum(r.paywallUsers)} hit paywall · {r.purchases} paid
                    </div>
                  </div>
                  <span className={clsx('num text-[13px] font-bold shrink-0', r.payRate >= 0.06 ? 'text-ok-400' : 'text-bad-400')}>
                    {fmtPct(r.payRate, 1)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Catalogue table */}
      <Card className="p-4 mb-4">
        <SectionTitle
          title="Catalogue performance"
          hint="Every series with playback in range. Sort by eps/starter to find what holds, by paywall→pay to find what monetizes — they are not the same list."
          right={narrowed ? undefined : <FixedWindow />}
        />
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.name}
          defaultSort="starts"
          emptyTitle="No series"
          emptyMessage="No playback in the selected window."
        />
        <p className="text-2xs text-ink-low mt-3 leading-relaxed">
          <strong className="text-ink-hi">Starts and eps/starter follow the date picker</strong>; hold rate, paywall,
          unlocks and purchases have no daily grain and stay at window totals for Jul 8–21. Starts are daily-unique
          viewers summed, so a viewer returning to the same series on another day counts twice.
          Binge depth and monetization diverge sharply. A series can be devoured and never charged for (all free episodes),
          or barely watched and convert well (a paywall placed where the story hurts to stop). Read both columns before
          commissioning or buying.
        </p>
      </Card>

      {/* Per-series episode drop-off */}
      {curves.length > 0 && active && (
        <Card className="p-4 mb-4">
          <SectionTitle
            title="Episode drop-off by series"
            hint="Episode completions in the selected date range. The cliff is the paywall. It is not the same episode for every series, and where it lands early the series never recovers."
            right={
              <select
                value={active.name}
                onChange={(e) => setPick(e.target.value)}
                className="bg-surface-2 border border-line rounded-lg px-2.5 py-1.5 text-[13px] font-semibold max-w-[240px]"
              >
                {curves.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            }
          />
          <TrendChart
            data={active.arr.map((p) => ({ date: `Ep ${p.episode}`, viewers: p.viewers }))}
            series={[{ key: 'viewers', name: active.name, color: '#5e8dff' }]}
            height={220}
            fmt={(v) => fmtNum(v)}
            yFmt={(v) => fmtNum(v)}
          />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
            <MiniStat label="Ep 1 completions" value={fmtNum(active.peak)} />
            <MiniStat label="Wall at" value={active.wall.ep > 0 ? `Ep ${active.wall.ep} → ${active.wall.ep + 1}` : '—'} />
            <MiniStat label="Lost at wall" value={active.wall.drop > 0 ? `−${fmtPct(active.wall.drop, 0)}` : '—'} tone={active.wall.drop >= 0.6 ? 'bad' : active.wall.drop >= 0.45 ? 'warn' : 'ok'} />
            <MiniStat label="Reach Ep 20" value={fmtPct(active.survival, 0)} tone={active.survival >= 0.2 ? 'ok' : 'warn'} />
          </div>

          <div className="mt-4 overflow-x-auto">
            <div className="label-2xs mb-2">Episode-by-episode progression · {active.name}</div>
            <table className="w-full text-[13px] min-w-[520px]">
              <thead>
                <tr className="border-b border-line">
                  {['Episode', 'Completions', 'Continued from prev.', 'Lost', 'Still watching vs Ep 1'].map((h, i) => (
                    <th key={h} className={clsx('label-2xs py-2 px-2.5 whitespace-nowrap', i === 0 ? 'text-left' : 'text-right')}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {active.arr.map((p, i) => {
                  const prev = i > 0 ? active.arr[i - 1].viewers : p.viewers
                  const cont = prev > 0 ? p.viewers / prev : 1
                  const lost = prev - p.viewers
                  const vsFirst = active.peak > 0 ? p.viewers / active.peak : 0
                  const isWall = p.episode === active.wall.ep + 1 && active.wall.ep > 0
                  return (
                    <tr key={p.episode} className={clsx('border-b border-line/60 last:border-0', isWall && 'bg-bad-dim/40')}>
                      <td className="py-1.5 px-2.5 font-semibold whitespace-nowrap">
                        Ep {p.episode}
                        {isWall && <span className="ml-2 text-2xs font-bold text-bad-400">wall</span>}
                      </td>
                      <td className="py-1.5 px-2.5 text-right num font-semibold">{fmtNum(p.viewers)}</td>
                      <td className={clsx('py-1.5 px-2.5 text-right num', i === 0 ? 'text-ink-low' : cont < 0.6 ? 'text-bad-400 font-bold' : cont < 0.85 ? 'text-warn-400' : 'text-ok-400')}>
                        {i === 0 ? '—' : fmtPct(cont, 0)}
                      </td>
                      <td className="py-1.5 px-2.5 text-right num text-ink-mid">{i === 0 ? '—' : lost > 0 ? `−${fmtNum(lost)}` : '0'}</td>
                      <td className="py-1.5 px-2.5 text-right">
                        <span className="inline-flex items-center gap-2 justify-end">
                          <span className="hidden sm:block h-1.5 rounded-full bg-brand-400/70" style={{ width: Math.max(2, vsFirst * 80) }} />
                          <span className="num text-ink-mid w-10 text-right">{fmtPct(vsFirst, 0)}</span>
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4">
            <div className="label-2xs mb-2">Where every series hits its wall</div>
            <div className="space-y-1.5">
              {curves.map((c) => (
                <button
                  key={c.name}
                  onClick={() => setPick(c.name)}
                  className={clsx('w-full flex items-center gap-3 rounded-lg border px-3 py-1.5 text-left transition-colors',
                    c.name === active.name ? 'border-brand-400/40 bg-brand-500/10' : 'border-line hover:bg-surface-2')}
                >
                  <span className="text-[13px] font-semibold truncate flex-1 min-w-0">{c.name}</span>
                  <span className="text-2xs text-ink-low shrink-0 num">Ep {c.wall.ep}</span>
                  <div className="w-24 h-2 bg-surface-2 rounded-full overflow-hidden shrink-0 hidden sm:block">
                    <div className={clsx('h-full rounded-full', c.wall.drop >= 0.6 ? 'bg-bad-500' : c.wall.drop >= 0.45 ? 'bg-warn-500' : 'bg-ok-500')}
                      style={{ width: `${Math.min(100, c.wall.drop * 100)}%` }} />
                  </div>
                  <span className={clsx('num text-2xs font-bold w-12 text-right shrink-0',
                    c.wall.drop >= 0.6 ? 'text-bad-400' : c.wall.drop >= 0.45 ? 'text-warn-400' : 'text-ok-400')}>
                    −{fmtPct(c.wall.drop, 0)}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <p className="text-2xs text-ink-low mt-3 leading-relaxed">
            Measured in episode completions, not unique viewers — completions are additive so any date range sums
            correctly. The wall moves between episode 2 and episode 9 depending on the series, and the difference decides the title.
            I Married My Boss walls at episode 8 and only loses 42% — its curve then flattens and it converts 9.3%.
            My Dirty Little Secret walls at episode 6 and loses 75%; it is the second most-started series in the catalogue
            and converts 3.4%. Moving a wall later is a content-ops change, not a media buy, and it is almost certainly
            worth more than any budget shift available on the UA screens.
          </p>
        </Card>
      )}

      {/* Coin economy + product mix */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <SectionTitle
            title="Coin economy"
            hint="Coins are the soft currency between watching and paying. If the faucet outruns the sink, the paywall stops being a paywall."
            right={<FixedWindow />}
          />
          <div className="flex items-end gap-4 mb-3">
            <div>
              <div className="label-2xs mb-0.5">Earned</div>
              <div className="text-xl font-extrabold num">{fmtNum(coinsEarned)}</div>
            </div>
            <div className="text-ink-low text-lg pb-1">→</div>
            <div>
              <div className="label-2xs mb-0.5">Spent</div>
              <div className="text-xl font-extrabold num text-warn-400">{fmtNum(coinsSpent)}</div>
            </div>
            <div className="flex-1" />
            <div className="text-right">
              <div className="label-2xs mb-0.5">Burn rate</div>
              <div className={clsx('text-xl font-extrabold num', burnRate < 0.4 ? 'text-bad-400' : 'text-ok-400')}>{fmtPct(burnRate, 0)}</div>
            </div>
          </div>
          <div className="h-3 rounded-full bg-surface-2 overflow-hidden mb-3">
            <div className="h-full bg-warn-500/70 rounded-full" style={{ width: `${Math.min(100, burnRate * 100)}%` }} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {coins.filter((c) => c.metric !== 'earned' && c.metric !== 'spent').map((c) => (
              <div key={c.metric} className="rounded-lg border border-line px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-2xs text-ink-mid capitalize">{c.metric}</span>
                  <span className="num text-[13px] font-bold">{fmtNum(c.value)}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-2xs text-ink-low mt-3 leading-relaxed">
            {burnRate < 0.4
              ? `Only ${fmtPct(burnRate, 0)} of granted coins are ever spent, and ${fmtNum(coin('spenders'))} of ${fmtNum(coin('earners'))} earners spend at all. A balance that large means most viewers never face a real paywall — the sink needs to tighten before pricing work will move anything.`
              : 'The sink is keeping pace with the faucet — coins are functioning as a real gate.'}
          </p>
        </Card>

        <Card className="p-4">
          <SectionTitle
            title="What people actually buy"
            hint="Purchase mix by product. Coin packs and subscription behave differently — one is a top-up, the other is a commitment."
            right={<FixedWindow />}
          />
          <div className="space-y-2">
            {iap.map((p) => {
              const top = Math.max(...iap.map((x) => x.events), 1)
              return (
                <div key={p.product} className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center shrink-0">
                    <Coins size={14} className={p.kind === 'untracked' ? 'text-bad-400' : p.kind === 'subscription' ? 'text-brand-300' : 'text-warn-400'} />
                  </span>
                  <span className="text-[13px] font-semibold w-44 shrink-0 truncate">{p.product}</span>
                  <div className="flex-1 h-5 bg-surface-2 rounded-md overflow-hidden min-w-0">
                    <div
                      className={clsx('h-full rounded-md', p.kind === 'untracked' ? 'bg-bad-500/60' : p.kind === 'subscription' ? 'bg-brand-500/70' : 'bg-warn-500/60')}
                      style={{ width: `${Math.max(3, (p.events / top) * 100)}%` }}
                    />
                  </div>
                  <span className="num text-[13px] font-semibold w-10 text-right shrink-0">{p.events}</span>
                </div>
              )
            })}
          </div>
          <p className="text-2xs text-ink-low mt-3 leading-relaxed">
            {iap.some((p) => p.kind === 'untracked')
              ? `${iap.find((p) => p.kind === 'untracked')?.events} of ${iap.reduce((a, p) => a + p.events, 0)} purchases arrive with no product name attached — the single biggest blind spot in monetization reporting. Until the SDK sends product_purchased on every payment, price-point analysis is guesswork.`
              : 'Every purchase carries a product name.'}
          </p>
        </Card>
      </div>
    </div>
  )
}

function Header() {
  return (
    <div>
      <h1 className="text-xl font-extrabold tracking-tight flex items-center gap-2">
        <Clapperboard size={19} className="text-brand-300" /> Content
      </h1>
      <p className="text-[13px] text-ink-mid">
        The catalogue as a growth asset — which dramas hold viewers, which convert a paywall, and whether UA is buying the right ones.
      </p>
    </div>
  )
}

/** Marks a card whose source has no daily grain, so the date picker cannot
 *  narrow it. Better a visible badge than a control that silently does nothing. */
function FixedWindow() {
  return (
    <span className="text-2xs font-bold text-warn-400 bg-warn-dim rounded px-2 py-1 whitespace-nowrap">
      window total · not filtered by date
    </span>
  )
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className="rounded-lg border border-line px-3 py-2">
      <div className="label-2xs mb-0.5">{label}</div>
      <div className={clsx('num text-[15px] font-bold',
        tone === 'bad' ? 'text-bad-400' : tone === 'warn' ? 'text-warn-400' : tone === 'ok' ? 'text-ok-400' : 'text-ink-hi')}>
        {value}
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
