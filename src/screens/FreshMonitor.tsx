// Fresh Campaign Monitor (spec §16): campaigns/cohorts aged 0–7 days with
// stage lights, confidence, and explicit watch windows. Young slices get
// "watch, don't judge" framing until evidence accrues.
import { Rocket, ShieldQuestion } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { TrendChart } from '@/components/charts'
import {
  Button, Card, ConfidencePill, EmptyState, HelpTip, ProgressBar, SectionTitle,
  StageLightsRow,
} from '@/components/ui'
import { fmtMoney, fmtNum, fmtPct } from '@/lib/format'
import { useApp } from '@/state/store'

export function FreshMonitor() {
  const app = useApp()
  const navigate = useNavigate()
  const ds = app.dataset!
  const t = app.config!.thresholds

  const fresh = ds.campaigns
    .filter((c) => c.status === 'active')
    .map((c) => ({ c, m: app.campaignMetrics(c.campaign_id)! }))
    .filter(({ m }) => m.age_days <= 7)
    .sort((a, b) => a.m.age_days - b.m.age_days)

  const rec = (campaignId: string) =>
    app.recommendations.find((r) => r.scope.campaign_id === campaignId)

  return (
    <div className="animate-fade-in">
      <div className="mb-4">
        <h1 className="text-xl font-extrabold tracking-tight flex items-center gap-2">
          <Rocket size={20} className="text-brand-300" /> Fresh Campaign Monitor
        </h1>
        <p className="text-[13px] text-ink-mid">
          Campaigns aged 0–7 days. Young cohorts get wide confidence bands and explicit watch windows — the engine will not
          issue Scale/Pause verdicts before minimum evidence accrues (spec §16).
        </p>
      </div>

      {fresh.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Rocket size={22} />}
            title="No fresh campaigns"
            message="Nothing launched in the last 7 days. New launches appear here automatically with their evidence-accrual progress."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {fresh.map(({ c, m }) => {
            const installProgress = Math.min(1, m.installs / t.min_installs_for_decision)
            const spendProgress = Math.min(1, m.spend / t.min_spend_for_decision)
            const evidenceReady = installProgress >= 1 && spendProgress >= 1
            const r = rec(c.campaign_id)
            return (
              <Card key={c.campaign_id} className="p-4 flex flex-col">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="min-w-0">
                    <div className="font-bold text-[14px] truncate">{c.name}</div>
                    <div className="text-2xs text-ink-low">
                      {ds.channels.find((ch) => ch.channel_id === c.channel_id)?.name} · {c.geos.join(', ')} · day {m.age_days}
                    </div>
                  </div>
                  <span className="text-2xs font-bold bg-brand-500/15 text-brand-300 rounded-md px-2 py-1 whitespace-nowrap">AGE {m.age_days}d</span>
                </div>

                <div className="my-3">
                  <StageLightsRow lights={r?.stage_lights ?? { media: 'green', quality: 'yellow', monetization: 'yellow', creative: 'green', data: m.quality_gate.status }} />
                </div>

                <div className="grid grid-cols-3 gap-2 text-center mb-3">
                  <MiniStat label="Spend" value={fmtMoney(m.spend)} />
                  <MiniStat label="Installs" value={fmtNum(m.installs)} />
                  <MiniStat label="CPI" value={fmtMoney(m.cpi, 2)} />
                  <MiniStat label="Activation" value={fmtPct(m.activation_rate)} warn={m.activation_rate < t.min_activation_rate} />
                  <MiniStat label="D1" value={m.age_days >= 2 ? fmtPct(m.d1) : '—'} warn={m.age_days >= 2 && m.d1 < t.min_d1} />
                  <MiniStat label="Payers" value={String(Math.round(m.payer_rate * m.installs))} />
                </div>

                {m.daily.length >= 3 && (
                  <TrendChart
                    data={m.daily.map((d) => ({ date: d.date, cpi: Number(d.cpi.toFixed(2)) }))}
                    series={[{ key: 'cpi', name: 'CPI', color: '#8fb4ff' }]}
                    height={90}
                    fmt={(v) => fmtMoney(v, 2)}
                    yFmt={(v) => `$${v}`}
                  />
                )}

                <div className="mt-3 space-y-2">
                  <div>
                    <div className="flex justify-between text-2xs text-ink-low mb-1">
                      <span className="inline-flex items-center gap-1">
                        Evidence: installs <HelpTip text={`Decisions unlock at ${t.min_installs_for_decision} attributed installs (managed threshold).`} />
                      </span>
                      <span className="num">{fmtNum(m.installs)} / {fmtNum(t.min_installs_for_decision)}</span>
                    </div>
                    <ProgressBar value={installProgress} color={installProgress >= 1 ? '#10b981' : '#5e8dff'} />
                  </div>
                  <div>
                    <div className="flex justify-between text-2xs text-ink-low mb-1">
                      <span>Evidence: spend</span>
                      <span className="num">{fmtMoney(m.spend)} / {fmtMoney(t.min_spend_for_decision)}</span>
                    </div>
                    <ProgressBar value={spendProgress} color={spendProgress >= 1 ? '#10b981' : '#5e8dff'} />
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-line flex items-center justify-between gap-2 mt-auto">
                  <ConfidencePill level={m.confidence} note={m.confidence_factors.map((f) => f.note).join(' · ')} />
                  <Button size="sm" variant="secondary" onClick={() => navigate(`/doctor/${c.campaign_id}`)}>
                    Doctor →
                  </Button>
                </div>

                {!evidenceReady && (
                  <div className="mt-2.5 flex items-start gap-1.5 text-2xs text-ink-low leading-relaxed">
                    <ShieldQuestion size={12} className="mt-0.5 shrink-0 text-info-400" />
                    Watch window: verdicts are withheld until both evidence bars fill. Early metrics are directional only.
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

function MiniStat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="bg-surface-2 rounded-lg py-2 px-1">
      <div className="text-2xs text-ink-low">{label}</div>
      <div className={`text-[13px] font-bold num ${warn ? 'text-warn-400' : 'text-ink-hi'}`}>{value}</div>
    </div>
  )
}
