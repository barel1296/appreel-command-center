// Campaign Doctor (spec §16): deep diagnosis for one campaign across the full
// chain — media → users → money → creative → store → data. Each tab renders
// verdicts against managed thresholds, with charts drilled from the same facts.
import { clsx } from 'clsx'
import { Stethoscope } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AreaTrend, BarsChart, TrendChart } from '@/components/charts'
import { RecommendationCard } from '@/components/RecommendationCard'
import {
  Card, ConfidencePill, EmptyState, HelpTip, QualityBadge, SectionTitle, Select,
  StageLightsRow, Tabs,
} from '@/components/ui'
import { computeCreativeMetrics } from '@/domain/metrics/compute'
import type { CampaignMetrics } from '@/domain/types'
import { fmtMoney, fmtNum, fmtPct, fmtX, isoDaysAgo } from '@/lib/format'
import { useApp } from '@/state/store'

type DocTab = 'media' | 'users' | 'money' | 'creative' | 'store' | 'data'

export function CampaignDoctor() {
  const app = useApp()
  const navigate = useNavigate()
  const { campaignId } = useParams()
  const [tab, setTab] = useState<DocTab>('media')
  const ds = app.dataset!
  const t = app.config!.thresholds

  const campaigns = ds.campaigns.filter((c) => c.product_id === app.productId)
  const selected = campaigns.find((c) => c.campaign_id === campaignId) ?? null

  if (!campaignId) {
    return (
      <div className="animate-fade-in">
        <Header />
        <Card className="mt-4">
          <EmptyState
            icon={<Stethoscope size={22} />}
            title="Pick a campaign to diagnose"
            message="The Doctor walks the full chain — media cost, user quality, monetization, creative capacity, store context, and data health — and explains where the story breaks."
            action={
              <Select
                value=""
                onChange={(v) => v && navigate(`/doctor/${v}`)}
                options={[{ value: '', label: 'Select campaign…' }, ...campaigns.map((c) => ({ value: c.campaign_id, label: c.name }))]}
              />
            }
          />
        </Card>
      </div>
    )
  }

  if (!selected) {
    return (
      <div className="animate-fade-in">
        <Header />
        <Card className="mt-4">
          <EmptyState
            title="Campaign not found"
            message={`No campaign with id "${campaignId}" exists for this product.`}
            action={
              <Select
                value=""
                onChange={(v) => v && navigate(`/doctor/${v}`)}
                options={[{ value: '', label: 'Select campaign…' }, ...campaigns.map((c) => ({ value: c.campaign_id, label: c.name }))]}
              />
            }
          />
        </Card>
      </div>
    )
  }

  const m = app.campaignMetrics(selected.campaign_id)!
  const rec = app.recommendations.find((r) => r.scope.campaign_id === selected.campaign_id)
  const channel = ds.channels.find((c) => c.channel_id === selected.channel_id)!

  return (
    <div className="animate-fade-in">
      <Header />
      <div className="flex items-center justify-between gap-3 flex-wrap mt-3 mb-4">
        <Select
          value={selected.campaign_id}
          onChange={(v) => navigate(`/doctor/${v}`)}
          options={campaigns.map((c) => ({ value: c.campaign_id, label: c.name }))}
        />
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-2xs text-ink-low">{channel.name} · {selected.geos.join(', ')} · {selected.platform} · age {m.age_days}d {selected.status === 'paused' && '· PAUSED'}</span>
          <QualityBadge status={m.quality_gate.status} />
          <ConfidencePill level={m.confidence} note={m.confidence_factors.map((f) => f.note).join(' · ')} />
        </div>
      </div>

      <Card className="p-4 mb-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <StageLightsRow lights={rec?.stage_lights ?? { media: 'green', quality: 'green', monetization: 'green', creative: 'green', data: m.quality_gate.status }} />
          <div className="flex items-center gap-4 text-[13px] flex-wrap">
            <Stat label="Spend 14d" v={fmtMoney(m.spend)} />
            <Stat label="Installs" v={fmtNum(m.installs)} />
            <Stat label="CPI" v={fmtMoney(m.cpi, 2)} />
            <Stat label="Quality" v={isFinite(m.quality_score) ? `${m.quality_score}/100` : '—'} />
            <Stat label="Pred. D30 ROAS" v={fmtX(m.predicted_d30_roas.base)} />
          </div>
        </div>
      </Card>

      {rec && rec.approval_status === 'proposed' && (
        <div className="mb-4">
          <RecommendationCard rec={rec} />
        </div>
      )}

      <Tabs<DocTab>
        tabs={[
          { id: 'media', label: 'Media' },
          { id: 'users', label: 'User Quality' },
          { id: 'money', label: 'Monetization' },
          { id: 'creative', label: 'Creative' },
          { id: 'store', label: 'Store Context' },
          { id: 'data', label: 'Data Health' },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="mt-4">
        {tab === 'media' && <MediaTab m={m} t={t} />}
        {tab === 'users' && <UsersTab m={m} t={t} campaignId={selected.campaign_id} />}
        {tab === 'money' && <MoneyTab m={m} t={t} campaignId={selected.campaign_id} />}
        {tab === 'creative' && <CreativeTab campaignId={selected.campaign_id} />}
        {tab === 'store' && <StoreTab geos={selected.geos} />}
        {tab === 'data' && <DataTab m={m} />}
      </div>
    </div>
  )
}

function Header() {
  return (
    <div>
      <h1 className="text-xl font-extrabold tracking-tight flex items-center gap-2">
        <Stethoscope size={20} className="text-brand-300" /> Campaign Doctor
      </h1>
      <p className="text-[13px] text-ink-mid">Deep diagnosis across the full media → user → money chain.</p>
    </div>
  )
}

function Stat({ label, v }: { label: string; v: string }) {
  return (
    <span className="inline-flex flex-col">
      <span className="label-2xs">{label}</span>
      <span className="num font-bold text-ink-hi">{v}</span>
    </span>
  )
}

function Verdict({ label, value, target, ok, warn, explain }: {
  label: string
  value: string
  target: string
  ok: boolean
  warn?: boolean
  explain: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-line/60 last:border-0">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', ok ? 'bg-ok-400' : warn ? 'bg-warn-400' : 'bg-bad-400')} />
        <span className="text-[13px] text-ink-mid truncate">{label}</span>
        <HelpTip text={explain} />
      </div>
      <div className="text-right shrink-0">
        <span className={clsx('num font-bold text-[13px]', ok ? 'text-ok-400' : warn ? 'text-warn-400' : 'text-bad-400')}>{value}</span>
        <span className="text-2xs text-ink-low ml-2 num">{target}</span>
      </div>
    </div>
  )
}

function MediaTab({ m, t }: { m: CampaignMetrics; t: any }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="p-4">
        <SectionTitle title="Is media bought well?" hint="The full media chain: auction cost → attention → click → install → scale capacity (spec §7)." />
        <Verdict label="CPM" value={fmtMoney(m.cpm, 2)} target="context" ok={true} explain="Auction cost per 1,000 impressions. Judged relative to geo and objective, not in isolation." />
        <Verdict label="CTR" value={fmtPct(m.ctr)} target={`min ${fmtPct(t.min_ctr)}`} ok={m.ctr >= t.min_ctr} explain="Creative attractiveness. Below minimum usually means creative, not audience." />
        <Verdict label="Click → install CVR" value={fmtPct(m.cvr_click_install)} target={`min ${fmtPct(t.min_cvr)}`} ok={m.cvr_click_install >= t.min_cvr} explain="Store/landing transition. Weak CVR with good CTR points at the store page." />
        <Verdict label="CPI" value={fmtMoney(m.cpi, 2)} target={`target ${fmtMoney(t.target_cpi, 2)}`} ok={m.cpi <= t.target_cpi} warn={m.cpi <= t.max_cpi} explain="Spend ÷ attributed installs (MMP truth)." />
        <Verdict label="Cost per activated user" value={fmtMoney(m.cost_per_activated, 2)} target="vs CPI" ok={m.cost_per_activated <= m.cpi * 2} explain="What a REAL user costs after activation filtering — the honest acquisition cost." />
        <Verdict label="Marginal CPI ratio" value={m.marginal_cpi_ratio.toFixed(2)} target={`max ${t.max_marginal_cpi_ratio}`} ok={m.marginal_cpi_ratio <= t.max_marginal_cpi_ratio} explain="Last-7d CPI vs window CPI. Rising ratio = saturation; scale headroom shrinks." />
        <Verdict label="Frequency (est.)" value={m.frequency.toFixed(1)} target="< 5.0" ok={m.frequency < 5} warn={m.frequency < 6.5} explain="Estimated impressions per reached user. High frequency accelerates fatigue." />
        <div className="mt-3 text-2xs text-ink-low">
          Scale headroom: <span className={clsx('font-bold uppercase', m.scale_headroom === 'high' ? 'text-ok-400' : m.scale_headroom === 'medium' ? 'text-warn-400' : 'text-bad-400')}>{m.scale_headroom}</span> · saturation index {(m.saturation_index * 100).toFixed(0)}%
        </div>
      </Card>
      <Card className="p-4">
        <SectionTitle title="CPI & spend trend" hint="Daily CPI against spend. Diverging lines (spend up, CPI up) signal saturation." />
        <TrendChart
          data={m.daily.map((d) => ({ date: d.date, cpi: Number(d.cpi.toFixed(2)), spend: Math.round(d.spend) }))}
          series={[
            { key: 'cpi', name: 'CPI', color: '#fbbf24' },
            { key: 'spend', name: 'Spend', color: '#5e8dff', dashed: true },
          ]}
          height={230}
          fmt={(v, k) => (k === 'cpi' ? fmtMoney(v, 2) : fmtMoney(v))}
          yFmt={(v) => String(v)}
        />
        <div className="mt-2 text-2xs text-ink-low">CPI trend over window: <span className={clsx('font-bold num', m.cpi_trend > 0.08 ? 'text-bad-400' : 'text-ok-400')}>{fmtPct(m.cpi_trend)}</span>{m.network_installs > m.installs && <> · network installs over-report by {fmtPct(m.network_installs / Math.max(m.installs, 1) - 1)} vs MMP</>}</div>
      </Card>
    </div>
  )
}

function UsersTab({ m, t, campaignId }: { m: CampaignMetrics; t: any; campaignId: string }) {
  const app = useApp()
  const ds = app.dataset!
  const cohorts = ds.cohorts.filter((c) => c.campaign_id === campaignId && c.cohort_date >= isoDaysAgo(21)).sort((a, b) => a.cohort_date.localeCompare(b.cohort_date))
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="p-4">
        <SectionTitle title="Did installs become users?" hint="Activation, depth, retention, and engagement separate curiosity from quality (spec §8)." />
        <Verdict label="Activation rate" value={fmtPct(m.activation_rate)} target={`min ${fmtPct(t.min_activation_rate)}`} ok={m.activation_rate >= t.min_activation_rate} explain="Install → meaningful first action (managed event mapping)." />
        <Verdict label="Meaningful session rate" value={fmtPct(m.meaningful_session_rate)} target="≥ 50%" ok={m.meaningful_session_rate >= 0.5} explain="Share of installs with at least one engaged session (not just an open)." />
        <Verdict label="D1 retention" value={fmtPct(m.d1)} target={`min ${fmtPct(t.min_d1)}`} ok={m.d1 >= t.min_d1} explain="Point-in-time: cohorts younger than 1 day are excluded, not assumed." />
        <Verdict label="D3 retention" value={fmtPct(m.d3)} target="curve" ok={m.d3 >= m.d1 * 0.5} explain="Healthy curves keep ≥50% of D1 by D3." />
        <Verdict label="D7 retention" value={fmtPct(m.d7)} target={`min ${fmtPct(t.min_d7)}`} ok={m.d7 >= t.min_d7} explain="Only cohorts ≥7 days old count." />
        <Verdict label="Depth L3 by D1" value={fmtPct(m.depth_l3_share)} target={`min ${fmtPct(t.min_depth_l3_share)}`} ok={m.depth_l3_share >= t.min_depth_l3_share} explain="Share reaching the configured 'Committed player' layer (product config, not hard-coded)." />
        <Verdict label="Sessions / user" value={m.sessions_per_user.toFixed(1)} target="≥ 2.0" ok={m.sessions_per_user >= 2} explain="Average day-0 sessions per install." />
      </Card>
      <Card className="p-4">
        <SectionTitle title="Cohort D1 by day" hint="Each bar is one daily cohort's D1. Consistency matters more than the average." />
        <BarsChart
          data={cohorts.filter((c) => c.cohort_date < isoDaysAgo(1)).map((c) => ({
            date: c.cohort_date.slice(5),
            d1: Number(((c.installs > 0 ? c.d1_retained / c.installs : 0) * 100).toFixed(1)),
          }))}
          xKey="date"
          bars={[{ key: 'd1', name: 'D1 %', color: '#5e8dff' }]}
          height={230}
          fmt={(v) => `${v}%`}
          yFmt={(v) => `${v}%`}
          colorBy={(row) => (Number(row.d1) >= t.min_d1 * 100 ? '#34d399' : '#f87171')}
        />
        <div className="mt-2 text-2xs text-ink-low">Green bars clear the configured D1 minimum ({fmtPct(t.min_d1)}); red bars miss it.</div>
      </Card>
    </div>
  )
}

function MoneyTab({ m, t, campaignId }: { m: CampaignMetrics; t: any; campaignId: string }) {
  const app = useApp()
  const ds = app.dataset!
  const curve = useMemo(() => {
    const agg: number[] = []
    for (const c of ds.cohorts.filter((c) => c.campaign_id === campaignId)) {
      c.revenue_by_age.forEach((v, a) => { agg[a] = (agg[a] ?? 0) + v })
    }
    let cum = 0
    return agg.slice(0, 31).map((v, a) => { cum += v; return { date: `D${a}`, daily: Number(v.toFixed(0)), cumulative: Number(cum.toFixed(0)) } })
  }, [ds, campaignId])
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="p-4">
        <SectionTitle title="Is revenue real and repeatable?" hint="Separates accidental early revenue from real cohort monetization (spec §9)." />
        <Verdict label="Payer rate" value={fmtPct(m.payer_rate)} target={`min ${fmtPct(t.min_payer_rate)}`} ok={m.payer_rate >= t.min_payer_rate} explain="Payers ÷ installs in window." />
        <Verdict label="Repeat payer rate" value={fmtPct(m.repeat_payer_rate)} target="≥ 30%" ok={m.repeat_payer_rate >= 0.3} explain="One-time payers inflate early ROAS; repeat payers carry LTV." />
        <Verdict label="ARPPU" value={fmtMoney(m.arppu, 2)} target="context" ok={true} explain="Net revenue per payer." />
        <Verdict label="D7 ROAS" value={fmtX(m.roas_d7)} target={`target ${fmtX(t.target_d7_roas)}`} ok={m.roas_d7 >= t.target_d7_roas} explain="Observed 7-day net revenue ÷ spend. An input to the forecast, never the whole story." />
        <Verdict label="Top payer share" value={fmtPct(m.top_payer_share)} target={`max ${fmtPct(t.max_top_payer_share)}`} ok={m.top_payer_share <= t.max_top_payer_share} explain="One-whale risk. Above threshold, headline ROAS is treated as distorted." />
        <Verdict label="Refund rate" value={fmtPct(m.refund_rate)} target="≤ 4%" ok={m.refund_rate <= 0.04} explain="Refunds restate against the original cohort (revenue contract)." />
        <Verdict label="Revenue volatility (CV)" value={m.revenue_volatility.toFixed(2)} target="≤ 1.00" ok={m.revenue_volatility <= 1} warn={m.revenue_volatility <= 1.6} explain="Coefficient of variation across daily cohort revenue. High = concentration or noise." />
        <div className="mt-3 p-3 bg-surface-2 rounded-lg">
          <div className="label-2xs mb-1.5">Predicted D30 ROAS (conservative / base / aggressive)</div>
          <div className="flex items-center gap-3 num font-bold">
            <span className="text-bad-400">{fmtX(m.predicted_d30_roas.low)}</span>
            <span className="text-ink-hi text-lg">{fmtX(m.predicted_d30_roas.base)}</span>
            <span className="text-ok-400">{fmtX(m.predicted_d30_roas.high)}</span>
            <span className="text-2xs text-ink-low font-normal ml-auto">floor {fmtX(t.min_predicted_d30_roas)}</span>
          </div>
        </div>
      </Card>
      <Card className="p-4">
        <SectionTitle title="Monetization curve" hint="Aggregated cohort revenue by age day. The slope, not D0, decides whether cohorts mature toward payback." />
        <AreaTrend
          data={curve}
          series={[
            { key: 'cumulative', name: 'Cumulative net revenue', color: '#34d399' },
            { key: 'daily', name: 'Daily', color: '#5e8dff' },
          ]}
          height={230}
          fmt={(v) => fmtMoney(v)}
          yFmt={(v) => fmtMoney(v)}
        />
        <div className="mt-2 text-2xs text-ink-low">LTV D30 forecast band: {fmtMoney(m.ltv_d30.low)} – {fmtMoney(m.ltv_d30.high)} (base {fmtMoney(m.ltv_d30.base)})</div>
      </Card>
    </div>
  )
}

function CreativeTab({ campaignId }: { campaignId: string }) {
  const app = useApp()
  const navigate = useNavigate()
  const ds = app.dataset!
  const t = app.config!.thresholds
  const campaign = ds.campaigns.find((c) => c.campaign_id === campaignId)!
  const rows = campaign.creative_ids.map((cid) => ({
    asset: ds.creatives.find((c) => c.creative_asset_id === cid)!,
    m: computeCreativeMetrics(ds, cid, t),
  })).sort((a, b) => b.m.spend - a.m.spend)
  return (
    <Card className="p-4">
      <SectionTitle title="Creative pool for this campaign" hint="A scale decision must include creative capacity — fatigued pools cannot sustain scale (spec §10)." />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {rows.map(({ asset, m }) => (
          <Card key={asset.creative_asset_id} className="p-3.5 card-hover" onClick={() => navigate(`/creative/${asset.creative_asset_id}`)}>
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <div className="min-w-0">
                <div className="font-bold text-[13px] truncate">{asset.name}</div>
                <div className="text-2xs text-ink-low">{asset.concept} · "{asset.hook}"</div>
              </div>
              <FatigueRing value={m.fatigue} />
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-center mt-2">
              <div className="bg-surface-2 rounded-md py-1.5">
                <div className="text-2xs text-ink-low">CTR</div>
                <div className="text-xs font-bold num">{fmtPct(m.ctr)}</div>
              </div>
              <div className="bg-surface-2 rounded-md py-1.5">
                <div className="text-2xs text-ink-low">CPI</div>
                <div className="text-xs font-bold num">{fmtMoney(m.cpi, 2)}</div>
              </div>
              <div className="bg-surface-2 rounded-md py-1.5">
                <div className="text-2xs text-ink-low">CTR decay</div>
                <div className={clsx('text-xs font-bold num', m.ctr_decay < -0.15 ? 'text-bad-400' : 'text-ink-hi')}>{fmtPct(m.ctr_decay)}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </Card>
  )
}

export function FatigueRing({ value }: { value: number }) {
  const r = 13
  const c = 2 * Math.PI * r
  const color = value >= 75 ? '#f87171' : value >= 55 ? '#fbbf24' : '#34d399'
  return (
    <span className="relative inline-flex items-center justify-center shrink-0" title={`Fatigue ${value}/100`}>
      <svg width="34" height="34" viewBox="0 0 34 34" className="-rotate-90">
        <circle cx="17" cy="17" r={r} fill="none" stroke="rgba(148,163,203,0.15)" strokeWidth="3" />
        <circle cx="17" cy="17" r={r} fill="none" stroke={color} strokeWidth="3" strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} strokeLinecap="round" />
      </svg>
      <span className="absolute text-2xs font-bold num" style={{ color }}>{value}</span>
    </span>
  )
}

function StoreTab({ geos }: { geos: string[] }) {
  const app = useApp()
  const ds = app.dataset!
  const tracked = geos.filter((g) => ds.store.some((r) => r.geo === g))
  if (tracked.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No store data for these geos"
          message={`Store performance is tracked for ${[...new Set(ds.store.map((r) => r.geo))].join(', ')} — this campaign's geos (${geos.join(', ')}) are outside store tracking coverage. Coverage gaps are visible, never silently filled.`}
        />
      </Card>
    )
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {tracked.map((geo) => {
        const rows = ds.store.filter((r) => r.geo === geo).sort((a, b) => a.date.localeCompare(b.date))
        const data = rows.map((r) => ({
          date: r.date,
          cvr: Number((((r.installs_organic + r.installs_paid) / Math.max(r.page_views, 1)) * 100).toFixed(1)),
          rating: r.rating,
        }))
        const last = rows[rows.length - 1]
        return (
          <Card key={geo} className="p-4">
            <SectionTitle
              title={`Store funnel · ${geo}`}
              hint="Paid clicks land on this page — store conversion multiplies every campaign metric downstream (spec §11)."
              right={<span className="text-2xs text-ink-low num">rating {last.rating.toFixed(1)} · neg. reviews {fmtPct(last.negative_review_share)}</span>}
            />
            <TrendChart
              data={data}
              series={[{ key: 'cvr', name: 'Page → install CVR %', color: '#c084fc' }]}
              height={180}
              fmt={(v) => `${v}%`}
              yFmt={(v) => `${v}%`}
            />
          </Card>
        )
      })}
    </div>
  )
}

function DataTab({ m }: { m: CampaignMetrics }) {
  const navigate = useNavigate()
  return (
    <Card className="p-4">
      <SectionTitle
        title="Can these numbers be trusted?"
        hint="The quality gate runs before every recommendation. Red blocks business decisions entirely (spec §13)."
        right={<QualityBadge status={m.quality_gate.status} />}
      />
      {m.quality_gate.blocked_reason && (
        <div className="bg-bad-dim border border-bad-400/30 rounded-lg px-3 py-2.5 mb-3 text-[13px] text-bad-400 font-semibold">
          {m.quality_gate.blocked_reason}
        </div>
      )}
      <div className="divide-y divide-line/60">
        {m.quality_gate.checks.map((ch) => (
          <div key={ch.id} className="py-2.5 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', ch.status === 'green' ? 'bg-ok-400' : ch.status === 'yellow' ? 'bg-warn-400' : 'bg-bad-400')} />
                <span className="text-[13px] font-semibold">{ch.label}</span>
              </div>
              <p className="text-2xs text-ink-low leading-relaxed mt-0.5 ml-3.5">{ch.detail}</p>
            </div>
            <div className="text-right shrink-0">
              <div className={clsx('num font-bold text-[13px]', ch.status === 'green' ? 'text-ok-400' : ch.status === 'yellow' ? 'text-warn-400' : 'text-bad-400')}>{ch.value}</div>
              <div className="text-2xs text-ink-low num">{ch.threshold}</div>
            </div>
          </div>
        ))}
      </div>
      <button onClick={() => navigate('/tracking')} className="mt-3 text-[13px] font-semibold text-brand-300 hover:text-brand-400">
        Open Tracking Health Center →
      </button>
    </Card>
  )
}
