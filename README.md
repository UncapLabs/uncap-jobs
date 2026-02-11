# uncap-jobs

Internal tools for [Uncap](https://uncap.finance), running as scheduled Cloudflare Workers. Covers STRK reward distribution, points tracking, vault NAV computation, and position monitoring.

## What's in here

### STRK rewards

Computes per-user STRK reward allocations as part of the [Starknet Foundation rewards program](https://uncap.finance/claim). Fetches pool-level allocations from the SNF API and individual user positions from Dune, then distributes proportionally per collateral branch (WBTC, tBTC, SolvBTC). Outputs a JSON file to R2.

### Points & referrals

Tracks user activity across the protocol (borrowing, stability pool deposits, Ekubo LP) and computes weekly loyalty points. Relies on Dune queries for on-chain position data. Includes a referral system where referrers earn a bonus based on their referees' activity. Points are stored in D1 and exported as CSV snapshots to R2.

### Vault NAV (mNAV)

Uncap co-curates a vault on [Lagoon Finance](https://lagoon.finance) with 9Summits. This job computes the vault's Market Net Asset Value by aggregating positions across Ethereum (WBTC), Starknet (collateral, debt, stability pool, wallet balances), and Extended (USD positions). Snapshots are stored in R2 and served via API. A daily Telegram summary is sent with the full NAV breakdown and per-position details.

### Position monitoring

Hourly LTV checks on individual borrowing positions as part of vault curation. Sends Telegram alerts when any position crosses the 65% LTV threshold, with hysteresis to avoid repeated notifications.

## Stack

- **Runtime:** Cloudflare Workers
- **Database:** Cloudflare D1 (points, referrals)
- **Storage:** Cloudflare R2 (snapshots, rewards, mNAV history)
- **Cache:** Cloudflare KV (LTV alert state)
- **Data sources:** Dune Analytics, Starknet/Ethereum RPC (Alchemy), Extended API, SNF API

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.dev.vars.example` to `.dev.vars` and fill in your values:

```bash
cp .dev.vars.example .dev.vars
```

3. Run migrations:

```bash
npx wrangler d1 migrations apply uncap-points
```

## Development

```bash
npx wrangler dev --test-scheduled
```

Trigger a scheduled job locally:

```bash
curl "http://localhost:8787/__scheduled?cron=0+11+*+*+*"
```

Use `--remote` to run against production bindings (careful).

## Deployment

`.dev.vars` is only used for local development. For production, set secrets via Wrangler:

```bash
npx wrangler secret put DUNE_API_KEY
npx wrangler secret put ETHEREUM_RPC_URL
npx wrangler secret put STARKNET_RPC_URL
# ... etc, see .dev.vars.example for the full list
```

Then deploy:

```bash
npm run deploy
```

D1, R2, and KV bindings defined in `wrangler.jsonc` are created automatically on first deploy.

## Admin endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/__health` | Health check |
| `POST` | `/admin/run-weekly-points` | Trigger points calculation |
| `POST` | `/admin/generate-rewards` | Trigger STRK rewards generation |
| `POST` | `/admin/calculate-mnav` | Trigger mNAV calculation |
| `POST` | `/admin/check-ltv` | Trigger LTV check |
| `GET` | `/api/mnav` | Fresh mNAV (no storage) |
