# AppReel Command Center

A decision operating system for AppReel user acquisition. Not a dashboard: data flows
through a **Data Quality Gate**, a layered **Decision Engine** turns certified metrics
into explained recommendations, every approval lands in an auditable **Decision Ledger**,
and read-only **agents** answer questions with cited evidence — or say when evidence is missing.

Built on the same architecture as the Growth Command Center, re-pointed at AppReel's own
sources and adapted to what AppReel can actually measure today.

## Run

```bash
npm install
npm run dev      # http://localhost:5274
npm run build    # production build (tsc + vite)
```

## Data sources

| Source | Status | What it provides |
|---|---|---|
| Meta Ads — account `AppReel UTC` (780499204349049) | **connected** | Spend, impressions, clicks, network-reported installs, purchase events, ad-level creatives |
| MMP / AppsFlyer | not connected | Attributed installs, cross-network de-duplication, cohort joins |
| Purchase revenue **value** | broken | Purchase events arrive, but `omni_purchase_values` is empty on every row |
| Product event stream | not connected | Retention, DAU, sessions, episode funnel |

Live facts are read from Supabase project `acukdxsdbkjdtnyrrjcm`, tables prefixed `ar_`:

```
ar_dim_campaign          campaign dimension
ar_fact_spend_daily      date × campaign → spend, impressions, clicks, installs, purchases
ar_dim_creative          ad-level creatives (drama title = concept)
ar_fact_spend_creative   campaign × creative window aggregate
ar_sync_log              per-source sync provenance
```

The overlay lives in `src/api/realSource.ts`; when Supabase is unreachable the app falls
back to the built-in simulation so no screen is ever broken.

## The measurement rule

`src/domain/measurement.ts` decides what this workspace can measure. A missing source is
never rendered as a zero — revenue, retention and ROAS modules are replaced by an explicit
"not measured" card that names the gap, what it unlocks, and how to close it. Metrics that
would be misleading (`d1`, `roas`, `arpu`, `quality_score`, CPI with no installs) resolve to
`NaN`, which every formatter renders as an em dash.

## Headline finding

Meta receives AppReel purchase events but no purchase **value**. That single gap blocks
revenue, ROAS, LTV, payback and whale detection — four screens and every scale decision.
Sending `value` + `currency` on the existing purchase call is the highest-leverage fix
available and requires no new integration.

## Screens

| Route | Screen |
|---|---|
| `/` | Command Center — KPIs, data health, decision queue preview, campaign portfolio |
| `/analytics` | Cohorts, cost efficiency, trends, breakdowns |
| `/product` | Product analytics — currently the event contract AppReel must implement |
| `/war-room` | Urgent alerts with owners, SLA and lifecycle |
| `/fresh` | Campaigns aged 0–7 days with explicit evidence bars |
| `/doctor/:id` | Campaign Doctor — full diagnostic per campaign |
| `/queue` `/ledger` | Decision queue and auditable ledger |
| `/creative` | Creative Intelligence by drama title, hook and fatigue |
| `/organic` | Store & Social (not connected) |
| `/tracking` | Tracking Health Center — the quality gate, per connector |
| `/copilot` | Read-only agent console |
| `/settings` | Versioned managed config, thresholds, contracts, RBAC |
