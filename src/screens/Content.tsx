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
import { Clapperboard, Coins, Megaphone, TrendingDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Column, DataTable } from '@/components/DataTable'
import { Card, EmptyState, HelpTip, SectionTitle } from '@/components/ui'
import { fmtMoney, fmtNum, fmtPct } from '@/lib/format'
import { useApp } from '@/state/store'

const safe = (a: number, b: number) => (b > 0 ? a / b : 0)

interface SeriesRow {
  name: string
  starts: number
  completers: number
  epCompletes: number
  epsPerStarter: number
  holdRate: number
  paywallUsers: number
  unlocks: number
  purchases: number
  payRate: number
  advertised: string | null
  spend: number
}

export function Content() {
  const app = useApp()
  const ds = app.dataset!
  const [sort, setSort] = useState<'starts' | 'epsPerStarter' | 'payRate'>('starts')

  const series = ds.series ?? []
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

  const rows: SeriesRow[] = useMemo(() => series.map((s) => ({
    name: s.series_name,
    starts: s.starts,
    completers: s.completers,
    epCompletes: s.episode_completes,
    epsPerStarter: safe(s.episode_completes, s.starts),
    holdRate: safe(s.completers, s.starts),
    paywallUsers: s.paywall_users,
    unlocks: s.unlocks,
    purchases: s.purchases,
    payRate: safe(s.purchases, s.paywall_users),
    advertised: s.advertised_as,
    spend: s.advertised_as ? (spendByConcept.get(s.advertised_as) ?? 0) : 0,
  })), [series, spendByConcept])

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
    { key: 'hold', header: 'Hold rate', align: 'right', hideBelow: 'md', render: (r) => <span className="num">{fmtPct(r.holdRate, 0)}</span>, sortValue: (r) => r.holdRate },
    { key: 'paywall', header: 'Hit paywall', align: 'right', hideBelow: 'sm', render: (r) => <span className="num">{fmtNum(r.paywallUsers)}</span>, sortValue: (r) => r.paywallUsers },
    { key: 'unlocks', header: 'Unlocks', align: 'right', hideBelow: 'lg', render: (r) => <span className="num">{fmtNum(r.unlocks)}</span>, sortValue: (r) => r.unlocks },
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
          hint="Every series with playback in the window. Sort by eps/starter to find what holds, by paywall→pay to find what monetizes — they are not the same list."
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
          Binge depth and monetization diverge sharply. A series can be devoured and never charged for (all free episodes),
          or barely watched and convert well (a paywall placed where the story hurts to stop). Read both columns before
          commissioning or buying.
        </p>
      </Card>

      {/* Coin economy + product mix */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <SectionTitle
            title="Coin economy"
            hint="Coins are the soft currency between watching and paying. If the faucet outruns the sink, the paywall stops being a paywall."
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
