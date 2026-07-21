// Store/ASO + Social/Trend Intelligence (spec §11, §12): store funnel by geo,
// keyword ranks, ratings, organic uplift, social content winners, trend brief,
// and the organic-to-paid concept bridge.
import { clsx } from 'clsx'
import { Activity, ArrowDownRight, ArrowUpRight, Minus, Sparkles, Store, TrendingUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { AreaTrend, TrendChart } from '@/components/charts'
import { Column, DataTable } from '@/components/DataTable'
import { RecommendationModal } from '@/components/RecommendationCard'
import { Card, EmptyState, HelpTip, SectionTitle, Select, Tabs } from '@/components/ui'
import type { FactSocialContent } from '@/domain/types'
import { fmtNum, fmtPct, isoDaysAgo } from '@/lib/format'
import { useApp } from '@/state/store'

export function OrganicIntel() {
  const [tab, setTab] = useState<'store' | 'social'>('store')
  return (
    <div className="animate-fade-in">
      <div className="mb-4">
        <h1 className="text-xl font-extrabold tracking-tight flex items-center gap-2">
          <Activity size={20} className="text-brand-300" /> Store & Social Intelligence
        </h1>
        <p className="text-[13px] text-ink-mid">Growth beyond paid: store funnel, keyword visibility, ratings, organic uplift, and social signals feeding the creative engine.</p>
      </div>
      <Tabs
        tabs={[
          { id: 'store' as const, label: 'Store & ASO' },
          { id: 'social' as const, label: 'Social & Trends' },
        ]}
        active={tab}
        onChange={setTab}
      />
      <div className="mt-4">{tab === 'store' ? <StoreTab /> : <SocialTab />}</div>
    </div>
  )
}

function StoreTab() {
  const app = useApp()
  const ds = app.dataset!
  const geos = [...new Set(ds.store.map((r) => r.geo))]
  if (geos.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Store size={22} />}
          title="Store source not connected"
          message="App Store Connect / Play Console are not wired up for this product yet. Connect them in product onboarding to see store funnel, keyword ranks and review sentiment here — coverage gaps are shown, never silently filled."
        />
      </Card>
    )
  }
  const [geo, setGeo] = useState('DE')

  const geoStats = useMemo(() => geos.map((g) => {
    const recent = ds.store.filter((r) => r.geo === g && r.date >= isoDaysAgo(7))
    const prior = ds.store.filter((r) => r.geo === g && r.date < isoDaysAgo(7) && r.date >= isoDaysAgo(21))
    const cvr = (rows: typeof recent) => {
      const pv = rows.reduce((a, r) => a + r.page_views, 0)
      return pv > 0 ? rows.reduce((a, r) => a + r.installs_organic + r.installs_paid, 0) / pv : 0
    }
    const now = cvr(recent)
    const before = cvr(prior)
    const organicShare = recent.reduce((a, r) => a + r.installs_organic, 0) /
      Math.max(1, recent.reduce((a, r) => a + r.installs_organic + r.installs_paid, 0))
    return {
      geo: g,
      cvr: now,
      delta: before > 0 ? now / before - 1 : 0,
      rating: recent.length ? recent[recent.length - 1].rating : 0,
      organicShare,
      impressions: recent.reduce((a, r) => a + r.impressions, 0),
    }
  }), [ds, geos])

  const series = useMemo(() =>
    ds.store.filter((r) => r.geo === geo).sort((a, b) => a.date.localeCompare(b.date)).map((r) => ({
      date: r.date,
      organic: r.installs_organic,
      paid: r.installs_paid,
      cvr: Number((((r.installs_organic + r.installs_paid) / Math.max(r.page_views, 1)) * 100).toFixed(1)),
    })), [ds, geo])

  const storeRec = app.recommendations.find((r) => r.recommendation_id === `rec-store-${geo.toLowerCase()}`)
  const [recOpen, setRecOpen] = useState(false)

  const kwColumns: Column<(typeof ds.keywords)[number]>[] = [
    { key: 'kw', header: 'Keyword', render: (k) => <span className="font-semibold">{k.keyword}</span>, sortValue: (k) => k.keyword },
    { key: 'geo', header: 'Geo', render: (k) => k.geo, sortValue: (k) => k.geo },
    {
      key: 'rank', header: 'Rank', align: 'right',
      render: (k) => (
        <span className="inline-flex items-center gap-1.5 num font-bold">
          #{k.rank}
          {k.rank < k.rank_prev_week ? <ArrowUpRight size={13} className="text-ok-400" /> :
            k.rank > k.rank_prev_week ? <ArrowDownRight size={13} className="text-bad-400" /> :
            <Minus size={12} className="text-ink-low" />}
        </span>
      ),
      sortValue: (k) => -k.rank,
    },
    { key: 'prev', header: 'Last week', align: 'right', hideBelow: 'sm', render: (k) => <span className="num text-ink-low">#{k.rank_prev_week}</span>, sortValue: (k) => -k.rank_prev_week },
    { key: 'share', header: 'Impr. share', align: 'right', render: (k) => <span className="num">{fmtPct(k.impressions_share)}</span>, sortValue: (k) => k.impressions_share },
  ]

  return (
    <div>
      {/* Geo cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {geoStats.map((g) => (
          <Card
            key={g.geo}
            className={clsx('p-3.5 card-hover', geo === g.geo && 'border-brand-400/50 bg-brand-500/5')}
            onClick={() => setGeo(g.geo)}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-bold text-[13px]">{g.geo}</span>
              <span className={clsx('text-2xs font-bold num', g.delta < -0.1 ? 'text-bad-400' : g.delta > 0.03 ? 'text-ok-400' : 'text-ink-low')}>
                {g.delta > 0 ? '+' : ''}{(g.delta * 100).toFixed(0)}%
              </span>
            </div>
            <div className="text-lg font-extrabold num">{fmtPct(g.cvr)}</div>
            <div className="text-2xs text-ink-low">page → install</div>
            <div className="flex justify-between mt-1.5 text-2xs text-ink-low">
              <span>★ {g.rating.toFixed(1)}</span>
              <span>{fmtPct(g.organicShare, 0)} organic</span>
            </div>
          </Card>
        ))}
      </div>

      {storeRec && (
        <button
          onClick={() => setRecOpen(true)}
          className="w-full card p-3.5 mb-4 flex items-center gap-3 card-hover border-warn-400/40 text-left"
        >
          <Store size={17} className="text-warn-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-bold text-[13px]">{storeRec.title}</div>
            <div className="text-2xs text-ink-mid">Open the recommendation for evidence and the suggested fix</div>
          </div>
        </button>
      )}
      {storeRec && <RecommendationModal rec={storeRec} open={recOpen} onClose={() => setRecOpen(false)} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <Card className="p-4">
          <SectionTitle
            title={`Installs by source · ${geo}`}
            hint="Paid vs organic install split from store data. Organic uplift alongside paid pushes suggests halo; divergence suggests cannibalization."
          />
          <AreaTrend
            data={series}
            series={[
              { key: 'paid', name: 'Paid installs', color: '#5e8dff' },
              { key: 'organic', name: 'Organic installs', color: '#34d399' },
            ]}
            stacked
            height={210}
            fmt={(v) => fmtNum(v)}
            yFmt={(v) => fmtNum(v)}
          />
        </Card>
        <Card className="p-4">
          <SectionTitle title={`Store conversion trend · ${geo}`} hint="Product-page view → install. A drop here taxes every paid campaign into this geo." />
          <TrendChart
            data={series}
            series={[{ key: 'cvr', name: 'CVR %', color: '#c084fc' }]}
            height={210}
            fmt={(v) => `${v}%`}
            yFmt={(v) => `${v}%`}
          />
        </Card>
      </div>

      <Card className="p-4">
        <SectionTitle title="Keyword visibility" hint="Tracked keyword ranks with week-over-week movement and impression share." />
        <DataTable
          columns={kwColumns}
          rows={ds.keywords}
          rowKey={(k) => `${k.keyword}-${k.geo}`}
          defaultSort="share"
          emptyTitle="No keywords tracked"
          emptyMessage="Add keywords to the tracker via product onboarding."
        />
      </Card>
    </div>
  )
}

function SocialTab() {
  const app = useApp()
  const ds = app.dataset!
  const [platform, setPlatform] = useState<'all' | FactSocialContent['platform']>('all')
  const [recOpen, setRecOpen] = useState(false)

  const rows = ds.social
    .filter((s) => platform === 'all' || s.platform === platform)
    .sort((a, b) => b.views - a.views)

  const trendRec = app.recommendations.find((r) => r.recommendation_id.startsWith('rec-social-'))

  const tagStats = useMemo(() => {
    const m = new Map<string, { views: number; count: number }>()
    for (const s of ds.social) {
      for (const t of s.trend_tags) {
        const e = m.get(t) ?? { views: 0, count: 0 }
        e.views += s.views
        e.count++
        m.set(t, e)
      }
    }
    return [...m.entries()].map(([tag, e]) => ({ tag, ...e })).sort((a, b) => b.views - a.views)
  }, [ds])

  const columns: Column<FactSocialContent>[] = [
    {
      key: 'title', header: 'Content',
      render: (s) => (
        <div className="min-w-0 max-w-[280px]">
          <div className="font-semibold truncate">{s.title}</div>
          <div className="text-2xs text-ink-low">{s.platform} · {s.trend_tags.join(' ')}</div>
        </div>
      ),
      sortValue: (s) => s.title,
    },
    { key: 'views', header: 'Views', align: 'right', render: (s) => <span className="num font-semibold">{fmtNum(s.views)}</span>, sortValue: (s) => s.views },
    { key: 'er', header: 'Engagement', align: 'right', render: (s) => <span className="num">{fmtPct(s.engagement_rate)}</span>, sortValue: (s) => s.engagement_rate },
    { key: 'shares', header: 'Shares', align: 'right', hideBelow: 'md', render: (s) => <span className="num">{fmtNum(s.shares)}</span>, sortValue: (s) => s.shares },
    {
      key: 'sent', header: <span className="inline-flex items-center gap-1">Sentiment <HelpTip text="Comment-level sentiment score, −1 to +1. Low sentiment on high reach deserves a read of the actual comments." /></span>,
      align: 'right', hideBelow: 'sm',
      render: (s) => (
        <span className={clsx('num font-semibold', s.sentiment > 0.4 ? 'text-ok-400' : s.sentiment > 0 ? 'text-warn-400' : 'text-bad-400')}>
          {s.sentiment.toFixed(2)}
        </span>
      ),
      sortValue: (s) => s.sentiment,
    },
    {
      key: 'candidate', header: 'Paid candidate', align: 'center',
      render: (s) => s.concept_candidate
        ? <span className="text-2xs font-bold bg-purple-dim text-purple-400 px-2 py-0.5 rounded-md whitespace-nowrap">{s.paired_concept}</span>
        : <span className="text-2xs text-ink-low">—</span>,
      sortValue: (s) => (s.concept_candidate ? 1 : 0),
    },
  ]

  return (
    <div>
      {trendRec && (
        <button
          onClick={() => setRecOpen(true)}
          className="w-full card p-3.5 mb-4 flex items-center gap-3 card-hover border-purple-400/40 text-left"
        >
          <Sparkles size={17} className="text-purple-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-bold text-[13px]">{trendRec.title}</div>
            <div className="text-2xs text-ink-mid">Organic-to-paid bridge flagged this concept for a structured paid test</div>
          </div>
          <TrendingUp size={15} className="text-ink-low shrink-0" />
        </button>
      )}
      {trendRec && <RecommendationModal rec={trendRec} open={recOpen} onClose={() => setRecOpen(false)} />}

      <div className="flex items-center gap-2 flex-wrap mb-4">
        {tagStats.map((t) => (
          <span key={t.tag} className="text-2xs font-semibold bg-surface-2 border border-line text-ink-mid px-2.5 py-1 rounded-full">
            {t.tag} · <span className="num text-ink-hi">{fmtNum(t.views)}</span>
          </span>
        ))}
        <div className="ml-auto">
          <Select
            value={platform}
            onChange={setPlatform}
            options={[
              { value: 'all', label: 'All platforms' },
              { value: 'tiktok', label: 'TikTok' },
              { value: 'instagram', label: 'Instagram' },
              { value: 'youtube', label: 'YouTube' },
            ]}
          />
        </div>
      </div>

      <Card className="p-4">
        <SectionTitle title="Content performance" hint="Organic and creator content across platforms. Winners feed the organic-to-paid concept bridge (spec §12)." />
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(s) => s.content_id}
          defaultSort="views"
          emptyTitle="No content tracked"
          emptyMessage="No posts match the platform filter."
        />
      </Card>
    </div>
  )
}
