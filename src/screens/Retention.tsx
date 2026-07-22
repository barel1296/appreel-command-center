// ─────────────────────────────────────────────────────────────────────────────
// RETENTION — AppsFlyer only, by design.
//
// Two sources can measure retention here and they disagree by ~2x (AppsFlyer
// D1 ~11.7%, Mixpanel ~6%) because they resolve identity and "a return"
// differently. Mixing them produces a number that means nothing, so this screen
// uses AppsFlyer exclusively and says so. Mixpanel answers a different question
// — does a viewer come back to THIS story — which lives on Content as series
// continuation, never labelled "retention".
//
// Slices: campaign (from cohort facts), country and creative (AppsFlyer
// breakdowns). Creative is the one that changes UA decisions fastest: the ad
// sets the expectation, and a mismatched promise shows up as dead D1.
// ─────────────────────────────────────────────────────────────────────────────
import { clsx } from 'clsx'
import { Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { TrendChart } from '@/components/charts'
import { Column, DataTable } from '@/components/DataTable'
import { Card, EmptyState, HelpTip, SectionTitle, Tabs } from '@/components/ui'
import { fmtMoney, fmtNum, fmtPct } from '@/lib/format'
import { useApp } from '@/state/store'

const safe = (a: number, b: number) => (b > 0 ? a / b : 0)

interface Row {
  key: string
  label: string
  sub: string
  installs: number
  cost: number
  d1: number | null
  d3: number | null
  d7: number | null
}

export function Retention() {
  const app = useApp()
  const ds = app.dataset!
  const [tab, setTab] = useState<'creative' | 'country' | 'campaign'>('creative')
  const { from, to } = app.dateRange

  // Campaign slice comes from the cohort facts (install-date grain), so it
  // respects the global date range. Country and creative are AppsFlyer window
  // aggregates and do not — that is stated on the screen rather than hidden.
  const campaignRows: Row[] = useMemo(() => {
    const by = new Map<string, { inst: number; d1: number; d3: number; d7: number; e1: number; e3: number; e7: number; spend: number }>()
    for (const c of ds.cohorts) {
      if (c.cohort_date < from || c.cohort_date > to) continue
      const e = by.get(c.campaign_id) ?? { inst: 0, d1: 0, d3: 0, d7: 0, e1: 0, e3: 0, e7: 0, spend: 0 }
      e.inst += c.installs
      if (c.d1_retained > 0 || c.installs > 0) { e.d1 += c.d1_retained; e.e1 += c.installs }
      if (c.d3_retained > 0) { e.d3 += c.d3_retained; e.e3 += c.installs }
      if (c.d7_retained > 0) { e.d7 += c.d7_retained; e.e7 += c.installs }
      by.set(c.campaign_id, e)
    }
    for (const s of ds.spend) {
      if (s.date < from || s.date > to) continue
      const e = by.get(s.campaign_id)
      if (e) e.spend += s.spend
    }
    return [...by.entries()].map(([id, e]) => {
      const c = ds.campaigns.find((x) => x.campaign_id === id)
      return {
        key: id,
        label: c?.name ?? id,
        sub: `${ds.channels.find((ch) => ch.channel_id === c?.channel_id)?.name ?? ''} · ${fmtNum(e.inst)} installs`,
        installs: e.inst,
        cost: e.spend,
        d1: e.e1 > 0 ? safe(e.d1, e.e1) : null,
        d3: e.e3 > 0 ? safe(e.d3, e.e3) : null,
        d7: e.e7 > 0 ? safe(e.d7, e.e7) : null,
      }
    }).filter((r) => r.installs > 0).sort((a, b) => b.installs - a.installs)
  }, [ds, from, to])

  const countryRows: Row[] = useMemo(() => (ds.retention_geo ?? []).map((g) => ({
    key: g.country,
    label: g.country,
    sub: `${fmtNum(g.installs)} installs · ${fmtMoney(g.revenue, 2)} revenue`,
    installs: g.installs,
    cost: g.cost,
    d1: g.d1, d3: g.d3, d7: g.d7,
  })), [ds])

  const creativeRows: Row[] = useMemo(() => (ds.retention_creative ?? []).map((c) => ({
    key: c.creative,
    label: c.creative.replace(/_9X16.*$/, '').replace(/\.mp4$/, ''),
    sub: c.creative,
    installs: c.installs,
    cost: c.cost,
    d1: c.d1, d3: c.d3, d7: c.d7,
  })), [ds])

  const rows = tab === 'creative' ? creativeRows : tab === 'country' ? countryRows : campaignRows
  const measured = rows.filter((r) => r.d1 !== null && r.installs >= 20)
  const best = [...measured].sort((a, b) => (b.d1 ?? 0) - (a.d1 ?? 0))[0]
  const worst = [...measured].sort((a, b) => (a.d1 ?? 0) - (b.d1 ?? 0))[0]

  // Blended curve across everything measured in the slice
  const curve = useMemo(() => {
    const pt = (k: 'd1' | 'd3' | 'd7') => {
      const el = rows.filter((r) => r[k] !== null && r.installs > 0)
      const inst = el.reduce((a, r) => a + r.installs, 0)
      return inst > 0 ? el.reduce((a, r) => a + (r[k] as number) * r.installs, 0) / inst : null
    }
    return [
      { date: 'D0', value: 100 },
      { date: 'D1', value: pt('d1') !== null ? Number(((pt('d1') as number) * 100).toFixed(1)) : null },
      { date: 'D3', value: pt('d3') !== null ? Number(((pt('d3') as number) * 100).toFixed(1)) : null },
      { date: 'D7', value: pt('d7') !== null ? Number(((pt('d7') as number) * 100).toFixed(1)) : null },
    ]
  }, [rows])

  const cell = (v: number | null, good: number) =>
    v === null
      ? <span className="text-ink-low">—</span>
      : <span className={clsx('num font-semibold', v >= good ? 'text-ok-400' : v >= good * 0.6 ? 'text-warn-400' : 'text-bad-400')}>{fmtPct(v, 1)}</span>

  const columns: Column<Row>[] = [
    {
      key: 'label',
      header: tab === 'creative' ? 'Creative' : tab === 'country' ? 'Country' : 'Campaign',
      render: (r) => (
        <div className="min-w-0">
          <div className="font-semibold text-ink-hi truncate max-w-[260px]">{r.label}</div>
          <div className="text-2xs text-ink-low truncate max-w-[260px]">{r.sub}</div>
        </div>
      ),
      sortValue: (r) => r.label,
    },
    { key: 'installs', header: 'Installs', align: 'right', render: (r) => <span className="num font-semibold">{fmtNum(r.installs)}</span>, sortValue: (r) => r.installs },
    { key: 'cost', header: 'Spend', align: 'right', hideBelow: 'sm', render: (r) => <span className="num">{r.cost > 0 ? fmtMoney(r.cost) : '—'}</span>, sortValue: (r) => r.cost },
    { key: 'd1', header: 'D1', align: 'right', render: (r) => cell(r.d1, 0.12), sortValue: (r) => r.d1 ?? -1 },
    { key: 'd3', header: 'D3', align: 'right', hideBelow: 'sm', render: (r) => cell(r.d3, 0.05), sortValue: (r) => r.d3 ?? -1 },
    { key: 'd7', header: 'D7', align: 'right', hideBelow: 'md', render: (r) => cell(r.d7, 0.02), sortValue: (r) => r.d7 ?? -1 },
    {
      key: 'cpr',
      header: <span className="inline-flex items-center gap-1">Cost / retained D1 <HelpTip text="Spend ÷ (installs × D1). What one viewer who actually came back the next day costs — the honest efficiency metric for a content app, where a non-returning install is worth nothing." /></span>,
      align: 'right',
      render: (r) => {
        const ret = r.d1 !== null ? r.installs * r.d1 : 0
        return <span className="num font-bold">{ret >= 1 && r.cost > 0 ? fmtMoney(r.cost / ret, 2) : <span className="text-ink-low font-normal">—</span>}</span>
      },
      sortValue: (r) => (r.d1 !== null && r.installs * r.d1 >= 1 && r.cost > 0 ? -(r.cost / (r.installs * r.d1)) : -1e9),
    },
  ]

  if ((ds.retention_geo?.length ?? 0) === 0 && campaignRows.length === 0) {
    return (
      <div className="animate-fade-in">
        <Header />
        <Card className="mt-4">
          <EmptyState icon={<Users size={22} />} title="No retention data" message="Retention comes from AppsFlyer. Connect the MMP to populate this screen." />
        </Card>
      </div>
    )
  }

  return (
    <div className="animate-fade-in">
      <Header />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4 mb-4">
        <Card className="p-4 lg:col-span-1">
          <SectionTitle title="Blended curve" hint="Install-weighted D1/D3/D7 across everything measured in the active slice." />
          <TrendChart
            data={curve}
            series={[{ key: 'value', name: 'Retained', color: '#5e8dff' }]}
            height={180}
            fmt={(v) => `${v}%`}
            yFmt={(v) => `${v}%`}
          />
        </Card>
        <Card className="p-4 lg:col-span-2">
          <SectionTitle title="Best and worst in this slice" hint="Only rows with at least 20 installs are ranked — below that D1 is one or two people." />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[{ r: best, tone: 'ok' as const, label: 'Best D1' }, { r: worst, tone: 'bad' as const, label: 'Worst D1' }].map(({ r, tone, label }) => (
              <div key={label} className={clsx('rounded-xl border p-3', tone === 'ok' ? 'border-ok-400/30 bg-ok-dim/30' : 'border-bad-400/30 bg-bad-dim/30')}>
                <div className="label-2xs mb-1">{label}</div>
                {r ? (
                  <>
                    <div className="text-[13px] font-bold truncate">{r.label}</div>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className={clsx('text-xl font-extrabold num', tone === 'ok' ? 'text-ok-400' : 'text-bad-400')}>{fmtPct(r.d1 ?? 0, 1)}</span>
                      <span className="text-2xs text-ink-low">{fmtNum(r.installs)} installs · {fmtMoney(r.cost)}</span>
                    </div>
                  </>
                ) : <div className="text-[13px] text-ink-mid">Not enough volume to rank.</div>}
              </div>
            ))}
          </div>
          {best && worst && (best.d1 ?? 0) > 0 && (
            <p className="text-2xs text-ink-low mt-3 leading-relaxed">
              {best.label} retains {((best.d1 ?? 0) / Math.max(0.0001, worst.d1 ?? 0)).toFixed(1)}× better than {worst.label} on
              day one. In a content app the ad sets the expectation — a viewer who arrives on a promise the catalogue does not
              keep churns before the paywall ever loads, so spend on the bottom row is buying installs that cannot convert.
            </p>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <SectionTitle
          title="Retention by slice"
          hint="AppsFlyer is the only source used here. Campaign respects the global date range; country and creative are AppsFlyer window aggregates for Jul 8–21."
          right={<span className="text-2xs font-bold text-brand-300 bg-brand-500/10 rounded px-2 py-1">source: AppsFlyer</span>}
        />
        <Tabs
          tabs={[
            { id: 'creative' as const, label: 'By creative' },
            { id: 'country' as const, label: 'By country' },
            { id: 'campaign' as const, label: 'By campaign' },
          ]}
          active={tab}
          onChange={setTab}
        />
        <div className="mt-3">
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.key}
            defaultSort="installs"
            emptyTitle="Nothing to show"
            emptyMessage="No installs in this slice."
          />
        </div>
        <p className="text-2xs text-ink-low mt-3 leading-relaxed">
          Blank cells are cohorts too young to have reached that age, never zeros. Mixpanel also measures retention and
          reports roughly half these values — a different identity model and a different definition of a return. That number
          is deliberately excluded here so one metric means one thing.
        </p>
      </Card>
    </div>
  )
}

function Header() {
  return (
    <div>
      <h1 className="text-xl font-extrabold tracking-tight flex items-center gap-2">
        <Users size={19} className="text-brand-300" /> Retention
      </h1>
      <p className="text-[13px] text-ink-mid">
        Who comes back, sliced by the things you can act on — creative, country and campaign. AppsFlyer only.
      </p>
    </div>
  )
}
