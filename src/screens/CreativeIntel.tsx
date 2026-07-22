// Creative Intelligence (spec §10, §16): concepts, fatigue, lineage, winners,
// and per-asset drill-down with geo fit and decay curves.
import { clsx } from 'clsx'
import { GitBranch, Palette } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { TrendChart } from '@/components/charts'
import { Column, DataTable } from '@/components/DataTable'
import {
  Button, Card, EmptyState, HelpTip, Modal, SearchInput, SectionTitle, Select,
} from '@/components/ui'
import { FatigueRing } from './CampaignDoctor'
import { computeCreativeMetrics } from '@/domain/metrics/compute'
import type { CreativeMetrics, DimCreativeAsset } from '@/domain/types'
import { fmtMoney, fmtNum, fmtPct, fmtX, fmtDate } from '@/lib/format'
import { useApp } from '@/state/store'

interface CreativeRow {
  asset: DimCreativeAsset
  m: CreativeMetrics
}

export function CreativeIntel() {
  const app = useApp()
  const navigate = useNavigate()
  const { creativeId } = useParams()
  const [search, setSearch] = useState('')
  const [conceptFilter, setConceptFilter] = useState('all')
  const ds = app.dataset!
  const t = app.config!.thresholds

  const rows: CreativeRow[] = useMemo(() =>
    ds.creatives.map((asset) => ({ asset, m: computeCreativeMetrics(ds, asset.creative_asset_id, t) })),
    [ds, t])

  // A creative concept IS a drama title, so it joins straight to catalogue
  // performance. This is what makes a "winning" creative judgeable: cheap
  // installs into a series that never converts are not a win.
  const seriesByConcept = useMemo(() => {
    const m = new Map<string, { payRate: number; eps: number; starts: number; name: string }>()
    for (const s of ds.series ?? []) {
      if (!s.advertised_as) continue
      m.set(s.advertised_as, {
        name: s.series_name,
        payRate: s.paywall_users > 0 ? s.purchases / s.paywall_users : 0,
        eps: s.starts > 0 ? s.episode_completes / s.starts : 0,
        starts: s.starts,
      })
    }
    return m
  }, [ds])
  const seriesOf = (concept: string) => seriesByConcept.get(concept)

  const concepts = useMemo(() => {
    const byConcept = new Map<string, CreativeRow[]>()
    for (const r of rows) {
      byConcept.set(r.asset.concept, [...(byConcept.get(r.asset.concept) ?? []), r])
    }
    return [...byConcept.entries()].map(([concept, list]) => {
      const spend = list.reduce((a, r) => a + r.m.spend, 0)
      const installs = list.reduce((a, r) => a + r.m.installs, 0)
      const clicks = list.reduce((a, r) => a + r.m.clicks, 0)
      const impressions = list.reduce((a, r) => a + r.m.impressions, 0)
      const avgFatigue = list.reduce((a, r) => a + r.m.fatigue, 0) / list.length
      return {
        concept,
        assets: list.length,
        spend,
        cpi: installs > 0 ? spend / installs : 0,
        ctr: impressions > 0 ? clicks / impressions : 0,
        avgFatigue: Math.round(avgFatigue),
      }
    }).sort((a, b) => b.spend - a.spend)
  }, [rows])

  const filtered = rows.filter((r) =>
    (conceptFilter === 'all' || r.asset.concept === conceptFilter) &&
    (search === '' ||
      r.asset.name.toLowerCase().includes(search.toLowerCase()) ||
      r.asset.hook.toLowerCase().includes(search.toLowerCase()) ||
      r.asset.concept.toLowerCase().includes(search.toLowerCase())),
  )

  const selected = creativeId ? rows.find((r) => r.asset.creative_asset_id === creativeId) : null

  const columns: Column<CreativeRow>[] = [
    {
      key: 'name',
      header: 'Asset',
      render: (r) => (
        <div className="min-w-0">
          <div className="font-semibold truncate max-w-[230px]">{r.asset.name}</div>
          <div className="text-2xs text-ink-low truncate">{r.asset.concept} · {r.asset.format.replace('_', ' ')} · {r.asset.language}
            {r.asset.parent_id && <span className="text-purple-400"> · v{r.asset.iteration}</span>}
          </div>
        </div>
      ),
      sortValue: (r) => r.asset.name,
    },
    { key: 'status', header: 'Status', hideBelow: 'md', render: (r) => (
      <span className={clsx('text-2xs font-bold uppercase px-2 py-0.5 rounded-md',
        r.asset.status === 'live' ? 'bg-ok-dim text-ok-400' : r.asset.status === 'testing' ? 'bg-info-dim text-info-400' : 'bg-surface-3 text-ink-low')}>
        {r.asset.status}
      </span>
    ), sortValue: (r) => r.asset.status },
    { key: 'spend', header: 'Lifetime Spend', align: 'right', render: (r) => <span className="num font-semibold">{fmtMoney(r.m.spend)}</span>, sortValue: (r) => r.m.spend },
    { key: 'ctr', header: 'CTR', align: 'right', hideBelow: 'sm', render: (r) => <span className="num">{fmtPct(r.m.ctr)}</span>, sortValue: (r) => r.m.ctr },
    { key: 'cpi', header: 'CPI', align: 'right', render: (r) => <span className="num">{fmtMoney(r.m.cpi, 2)}</span>, sortValue: (r) => r.m.cpi },
    { key: 'decay', header: <span className="inline-flex items-center gap-1">CTR decay <HelpTip text="Trailing-week CTR vs first-week CTR. Sustained negative decay is the primary fatigue signal." /></span>, align: 'right', hideBelow: 'md', render: (r) => (
      <span className={clsx('num', r.m.ctr_decay < -0.15 ? 'text-bad-400' : r.m.ctr_decay < -0.05 ? 'text-warn-400' : 'text-ok-400')}>{fmtPct(r.m.ctr_decay)}</span>
    ), sortValue: (r) => r.m.ctr_decay },
    { key: 'age', header: 'Age', align: 'right', hideBelow: 'lg', render: (r) => <span className="num">{r.m.age_days}d</span>, sortValue: (r) => r.m.age_days },
    { key: 'fatigue', header: 'Fatigue', align: 'center', render: (r) => <FatigueRing value={r.m.fatigue} />, sortValue: (r) => r.m.fatigue },
  ]

  return (
    <div className="animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight flex items-center gap-2">
            <Palette size={20} className="text-brand-300" /> Creative Intelligence
          </h1>
          <p className="text-[13px] text-ink-mid">
            Each concept is a drama. Media performance sits next to how that series actually behaves in the app — a cheap
            install for a story nobody pays to finish is not a win.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <SearchInput value={search} onChange={setSearch} placeholder="Search assets, hooks…" className="w-full sm:w-56" />
          <Select
            value={conceptFilter}
            onChange={setConceptFilter}
            options={[{ value: 'all', label: 'All concepts' }, ...concepts.map((c) => ({ value: c.concept, label: c.concept }))]}
          />
        </div>
      </div>

      {/* Concept leaderboard */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
        {concepts.map((c) => {
          const s = seriesOf(c.concept)
          return (
            <Card key={c.concept} className="p-3.5 card-hover" onClick={() => setConceptFilter(c.concept === conceptFilter ? 'all' : c.concept)}>
              <div className={clsx('text-[13px] font-bold truncate', conceptFilter === c.concept && 'text-brand-300')}>{c.concept}</div>
              <div className="text-2xs text-ink-low mb-1.5">{c.assets} asset{c.assets > 1 ? 's' : ''}</div>
              <div className="text-[15px] font-extrabold num">{fmtMoney(c.spend)}</div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-2xs text-ink-low num">CPI {fmtMoney(c.cpi, 2)}</span>
                <span className={clsx('text-2xs font-bold num', c.avgFatigue >= 55 ? 'text-warn-400' : 'text-ok-400')}>F{c.avgFatigue}</span>
              </div>
              {s ? (
                <div className="mt-2 pt-2 border-t border-line flex items-center justify-between gap-1">
                  <span className="text-2xs text-ink-low">paywall→pay</span>
                  <span className={clsx('text-2xs font-bold num',
                    s.payRate >= 0.06 ? 'text-ok-400' : s.payRate > 0 ? 'text-warn-400' : 'text-bad-400')}>
                    {fmtPct(s.payRate, 1)}
                  </span>
                </div>
              ) : (
                <div className="mt-2 pt-2 border-t border-line text-2xs text-ink-low">no series match</div>
              )}
            </Card>
          )
        })}
      </div>

      <Card className="p-4">
        <SectionTitle title="Asset library" hint="Click an asset for lineage, geo fit, and decay analysis." />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.asset.creative_asset_id}
          onRowClick={(r) => navigate(`/creative/${r.asset.creative_asset_id}`)}
          defaultSort="spend"
          emptyTitle="No assets match"
          emptyMessage="Adjust the search or concept filter."
        />
      </Card>

      {/* Asset drill-down */}
      {selected && (
        <Modal open onClose={() => navigate('/creative')} title={selected.asset.name} wide>
          <AssetDetail row={selected} allRows={rows} />
        </Modal>
      )}
      {creativeId && !selected && (
        <Card className="mt-4">
          <EmptyState
            title="Creative not found"
            message={`No asset with id "${creativeId}" exists.`}
            action={<Button variant="secondary" onClick={() => navigate('/creative')}>Back to library</Button>}
          />
        </Card>
      )}
    </div>
  )
}

function AssetDetail({ row, allRows }: { row: CreativeRow; allRows: CreativeRow[] }) {
  const app = useApp()
  const navigate = useNavigate()
  const ds = app.dataset!
  const { asset, m } = row

  const lineage = useMemo(() => {
    // Walk to root, then collect the whole family in iteration order
    let rootId = asset.creative_asset_id
    const byId = new Map(allRows.map((r) => [r.asset.creative_asset_id, r]))
    while (byId.get(rootId)?.asset.parent_id) rootId = byId.get(rootId)!.asset.parent_id!
    const family: CreativeRow[] = []
    const collect = (id: string) => {
      const r = byId.get(id)
      if (!r) return
      family.push(r)
      allRows.filter((x) => x.asset.parent_id === id).forEach((x) => collect(x.asset.creative_asset_id))
    }
    collect(rootId)
    return family.sort((a, b) => a.asset.iteration - b.asset.iteration)
  }, [asset, allRows])

  const ctrSeries = useMemo(() => {
    const daily = new Map<string, { clicks: number; imps: number }>()
    for (const r of ds.spend.filter((s) => s.creative_asset_id === asset.creative_asset_id)) {
      const e = daily.get(r.date) ?? { clicks: 0, imps: 0 }
      e.clicks += r.clicks
      e.imps += r.impressions
      daily.set(r.date, e)
    }
    return [...daily.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, e]) => ({ date, ctr: Number(((e.clicks / Math.max(e.imps, 1)) * 100).toFixed(2)) }))
  }, [ds, asset])

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <span className="text-2xs font-semibold bg-surface-3 text-ink-mid px-2 py-1 rounded-md">{asset.concept}</span>
        <span className="text-2xs font-semibold bg-surface-3 text-ink-mid px-2 py-1 rounded-md">{asset.format.replace('_', ' ')}</span>
        <span className="text-2xs font-semibold bg-surface-3 text-ink-mid px-2 py-1 rounded-md">{asset.angle}</span>
        <span className="text-2xs font-semibold bg-surface-3 text-ink-mid px-2 py-1 rounded-md">{asset.language}</span>
        <span className="text-2xs text-ink-low ml-auto">launched {fmtDate(asset.launch_date)}</span>
      </div>
      <p className="text-[13px] text-ink-mid mb-4">Hook: <em className="text-ink-hi">"{asset.hook}"</em></p>

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
        {[
          ['Spend', fmtMoney(m.spend)],
          ['Installs', fmtNum(m.installs)],
          ['CTR', fmtPct(m.ctr)],
          ['CPI', fmtMoney(m.cpi, 2)],
          ['D7 ROAS', fmtX(m.roas_d7)],
          ['Fatigue', `${m.fatigue}/100`],
        ].map(([l, v]) => (
          <div key={l} className="bg-surface-2 rounded-lg py-2 text-center">
            <div className="text-2xs text-ink-low">{l}</div>
            <div className="text-[13px] font-bold num">{v}</div>
          </div>
        ))}
      </div>

      <div className="mb-4">
        <div className="label-2xs mb-1.5">CTR over time (fatigue signal)</div>
        <TrendChart data={ctrSeries} series={[{ key: 'ctr', name: 'CTR %', color: '#c084fc' }]} height={150} fmt={(v) => `${v}%`} yFmt={(v) => `${v}%`} />
      </div>

      {m.geo_fit.length > 0 && (
        <div className="mb-4">
          <div className="label-2xs mb-1.5 inline-flex items-center gap-1">Country × creative fit <HelpTip text="Same asset, different geos — global averages hide where a creative actually works (spec §10)." /></div>
          <div className="rounded-lg border border-line overflow-hidden">
            <table className="w-full text-xs">
              <thead><tr className="bg-surface-2 text-left">
                <th className="label-2xs px-3 py-2">Geo</th>
                <th className="label-2xs px-3 py-2 text-right">Est. spend</th>
                <th className="label-2xs px-3 py-2 text-right">CPI</th>
                <th className="label-2xs px-3 py-2 text-right">D1</th>
              </tr></thead>
              <tbody>
                {m.geo_fit.slice(0, 6).map((g) => (
                  <tr key={g.geo} className="border-t border-line/60">
                    <td className="px-3 py-1.5 font-semibold">{g.geo}</td>
                    <td className="px-3 py-1.5 text-right num">{fmtMoney(g.spend)}</td>
                    <td className="px-3 py-1.5 text-right num">{fmtMoney(g.cpi, 2)}</td>
                    <td className="px-3 py-1.5 text-right num">{fmtPct(g.d1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <div className="label-2xs mb-2 inline-flex items-center gap-1"><GitBranch size={12} /> Lineage — does iteration improve performance?</div>
        <div className="space-y-1.5">
          {lineage.map((r) => (
            <button
              key={r.asset.creative_asset_id}
              onClick={() => navigate(`/creative/${r.asset.creative_asset_id}`)}
              className={clsx(
                'w-full flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
                r.asset.creative_asset_id === asset.creative_asset_id
                  ? 'border-brand-400/50 bg-brand-500/10'
                  : 'border-line hover:bg-surface-2',
              )}
              style={{ marginLeft: (r.asset.iteration - 1) * 16 }}
            >
              <span className="text-2xs font-bold text-purple-400 num shrink-0">v{r.asset.iteration}</span>
              <span className="text-[13px] font-semibold truncate flex-1">{r.asset.name}</span>
              <span className="text-2xs text-ink-low num shrink-0">CPI {fmtMoney(r.m.cpi, 2)}</span>
              <span className={clsx('text-2xs font-bold num shrink-0', r.m.fatigue >= 55 ? 'text-warn-400' : 'text-ok-400')}>F{r.m.fatigue}</span>
            </button>
          ))}
        </div>
        {lineage.length > 1 && (
          <p className="text-2xs text-ink-low mt-2 leading-relaxed">
            {(() => {
              const parent = lineage.find((r) => r.asset.creative_asset_id === asset.parent_id)
              if (!parent) return 'Root asset of this lineage.'
              const better = m.cpi < parent.m.cpi
              return `vs parent: CPI ${better ? 'improved' : 'worsened'} ${fmtPct(Math.abs(m.cpi / Math.max(parent.m.cpi, 0.01) - 1))} — ${better ? 'the variant beats its parent; consider shifting spend' : 'the parent still wins; treat this variant as a fallback'}.`
            })()}
          </p>
        )}
      </div>

      <div className="mt-4 pt-3 border-t border-line text-2xs text-ink-low">
        Running in: {m.campaigns.map((cid) => ds.campaigns.find((c) => c.campaign_id === cid)?.name).filter(Boolean).join(', ') || 'no campaigns'}
      </div>
    </div>
  )
}
