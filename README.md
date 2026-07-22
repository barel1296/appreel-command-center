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
| AppsFlyer (MMP) | **connected** | Cost, attributed installs, revenue, D1/D3/D7 retention across every channel |
| Meta Ads — `AppReel UTC` (780499204349049) | **connected** | Ad-level creatives |
| TikTok Ads — `Appreel UTC` (7552499921006608385) | **connected** | Campaign spend and delivery |
| Mixpanel — `AppReel Short Drama LTD` (3850345, US region) | **connected** | DAU, sessions, episode depth, series catalogue, paywall funnel, coin economy |

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

## This is a short-drama app, not a game

The catalogue is the product. A series is the unit that acquires, retains and monetizes, so
the platform models episodes as depth layers, series as the content asset, and creative
concepts as drama titles — which lets spend and catalogue performance be compared directly.

## Headline findings

**The wall is checkout, not the paywall.** 1,270 viewers saw a paywall, 933 opened the store
sheet, 162 tapped buy, 38 completed — against 210 `purchase_canceled` events. Roughly three of
every four people who decided to pay did not finish.

**Not a hybrid business.** Ads contribute 3.7% of revenue ($10.93 of $294) at a $2.77 blended
eCPM. Ad yield will not move ROAS; pricing, paywall placement and checkout will.

**UA is buying the wrong dramas.** Cinderella Trials takes $490 of spend and converts 1.8% of
its paywalls; I Married My Boss takes $613 and converts 9.3%. My Dirty Little Secret is the
second most-started series in the catalogue and has no creative behind it at all.

**The coin faucet outruns the sink.** 300,320 coins granted, 82,300 spent (27%), and only 131
of 510 earners ever spend. Most viewers hold a balance large enough that the paywall never
binds — tighten the faucet before testing price.

**Two retention numbers disagree.** AppsFlyer reports D1 ~11.7%, Mixpanel ~6%. Different
identity models. Both are shown, labelled by source, and never averaged.

## Screens

| Route | Screen |
|---|---|
| `/` | Command Center — KPIs, data health, decision queue preview, campaign portfolio |
| `/analytics` | Cohorts, cost efficiency, trends, breakdowns |
| `/content` | Catalogue performance, UA↔content loop, coin economy, purchase mix |
| `/product` | DAU, retention, episode funnel, paywall→payment funnel |
| `/war-room` | Urgent alerts with owners, SLA and lifecycle |
| `/fresh` | Campaigns aged 0–7 days with explicit evidence bars |
| `/doctor/:id` | Campaign Doctor — full diagnostic per campaign |
| `/queue` `/ledger` | Decision queue and auditable ledger |
| `/creative` | Creative Intelligence by drama title, hook and fatigue |
| `/organic` | Store & Social (not connected) |
| `/tracking` | Tracking Health Center — the quality gate, per connector |
| `/copilot` | Read-only agent console |
| `/settings` | Versioned managed config, thresholds, contracts, RBAC |
