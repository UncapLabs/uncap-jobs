# mNAV Calculator Implementation Plan

## Overview

Add an mNAV (market Net Asset Value) calculator to the existing Cloudflare Worker. The calculator computes the total value of a BTC yield vault by aggregating positions across Ethereum Mainnet and Starknet.

## Phase 1 Scope (Current Implementation)

- Ethereum WBTC wallet balance
- Starknet WBTC wallet balance
- Uncap positions (collateral, debt, stability pool)
- Price feeds from Uncap oracle

## Phase 2 (Later)

- Vesu USDC position
- Extended USDC position

---

## File Structure

```
src/
├── index.ts                          # MODIFY: add cron trigger + HTTP endpoint
├── db/
│   └── schema.ts                     # MODIFY: add mnavSnapshots table
│
└── mnav/
    ├── calculate-mnav.ts             # Main orchestrator
    ├── types.ts                      # Type definitions (using Big.js)
    ├── config.ts                     # Addresses, ABIs, constants
    ├── utils.ts                      # Big.js export + retry helper
    │
    ├── fetchers/
    │   ├── ethereum-wbtc.ts          # Fetch ETH WBTC balance (viem)
    │   ├── starknet-wbtc.ts          # Fetch Starknet WBTC balance
    │   └── uncap-positions.ts        # Fetch collateral, debt, SP positions
    │
    └── prices/
        └── uncap-oracle.ts           # Fetch prices from Uncap PriceFeed
```

---

## mNAV Calculation Formula

All values use Big.js for precision. Raw bigints from contracts are converted via `Big(value.toString())`.

```
mNAV (in WBTC) =
    + ethereum.wbtc                           # Wallet balance on Ethereum
    + starknet.wbtc                           # Wallet balance on Starknet
    + uncap.collateral                        # WBTC collateral in trove
    - uncap.debt / wbtcPrice                  # USDU debt converted to WBTC
    + uncap.stabilityPool.usdu / wbtcPrice    # SP USDU balance
    + uncap.stabilityPool.usduYieldGain / wbtcPrice  # SP yield gains
    + uncap.stabilityPool.collateralGain      # SP collateral from liquidations (pending)
    + uncap.stabilityPool.stashedColl         # SP collateral from liquidations (stashed)
```

---

## Dependencies

```json
{
  "dependencies": {
    "viem": "^2.x",
    "starknet": "^9.x",
    "big.js": "^6.x"
  }
}
```

---

## Contract Addresses

### Ethereum Mainnet
- WBTC: `0x2260fac5e5542a773aa44fbcfedf7c193bc2c599`

### Starknet Mainnet (WWBTC Branch)
From `src/contracts/mainnet_addresses.json`:

| Contract | Address |
|----------|---------|
| WBTC (underlying, 8 dec) | `0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac` |
| WWBTC (wrapped, 18 dec) | `0x75d9e518f46a9ca0404fb0a7d386ce056dadf57fd9a0e8659772cb517be4a18` |
| TroveManager | `0x586fc03b4e6901ef423890c19e8fcf528a269329ab23ff7cb2df975ec3d4d62` |
| StabilityPool | `0x1ba4a9e2e86a41c6ed15016eda0404d12bf7b01052cccff1ace84d818335c7` |
| PriceFeed | `0x6716836514e75e9f4eaa0fe93aa0448480a321b669041d6b5f27aa75374ac66` |

---

## Environment Variables Needed

```bash
# RPC Endpoints
ETHEREUM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
STARKNET_RPC_URL=https://starknet-mainnet.g.alchemy.com/v2/YOUR_KEY

# Curator Addresses (TBD)
CURATOR_ETH_ADDRESS=0x...
CURATOR_STARKNET_ADDRESS=0x...

# Curator's Trove ID in Uncap
CURATOR_TROVE_ID=...
```

---

## Contract Calls

### Ethereum (viem)
- `WBTC.balanceOf(curator)` → balance (8 decimals)

### Starknet (starknet.js)

**Wallet Balance:**
- `WBTC.balance_of(curator)` → balance (8 decimals)

**Trove Position (TroveManager):**
- `get_latest_trove_data(trove_id)` → returns struct with:
  - `entire_coll` (18 decimals, wrapped)
  - `entire_debt` (18 decimals, USDU)

**Stability Pool:**
- `get_compounded_usdu_deposit(curator)` → USDU balance (18 decimals)
- `get_depositor_yield_gain(curator)` → USDU yield (18 decimals)
- `get_depositor_coll_gain(curator)` → collateral gains pending (18 decimals)
- `get_stashed_coll(curator)` → collateral gains stashed (18 decimals)

**Price Feed:**
- `fetch_price()` → WBTC/USD price (18 decimals)

---

## Database Schema

Add to `src/db/schema.ts`:

```typescript
export const mnavSnapshots = sqliteTable('mnav_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  timestamp: text('timestamp').notNull(),
  ethereumBlock: integer('ethereum_block').notNull(),
  starknetBlock: integer('starknet_block').notNull(),
  positionsJson: text('positions_json').notNull(),
  pricesJson: text('prices_json').notNull(),
  totalValueWbtc: text('total_value_wbtc').notNull(),
  totalValueUsd: text('total_value_usd').notNull(),
  calculationVersion: text('calculation_version').notNull(),
  warningsJson: text('warnings_json'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .default(sql`(unixepoch() * 1000)`).notNull(),
}, (table) => ({
  timestampIdx: index('idx_mnav_timestamp').on(table.timestamp),
}));
```

---

## Worker Integration

### HTTP Endpoint
```
POST /admin/calculate-mnav
```

### Cron Schedule
```
0 12 * * *  (Daily at noon UTC)
```

---

## Implementation Checklist

- [x] Install dependencies (viem, starknet, big.js)
- [x] Create `src/mnav/types.ts` - Type definitions with Big.js
- [x] Create `src/mnav/config.ts` - Addresses and ABIs
- [x] Create `src/mnav/utils.ts` - Big.js export + retry helper
- [x] Create `src/mnav/fetchers/ethereum-wbtc.ts` - Ethereum balance
- [x] Create `src/mnav/fetchers/starknet-wbtc.ts` - Starknet balance
- [ ] Create `src/mnav/fetchers/uncap-positions.ts` - Trove + SP positions
- [ ] Create `src/mnav/prices/uncap-oracle.ts` - Price fetcher
- [ ] Create `src/mnav/calculate-mnav.ts` - Main orchestrator
- [ ] Add `mnavSnapshots` table to `src/db/schema.ts`
- [ ] Update `src/index.ts` with endpoint and cron
- [ ] Update `wrangler.jsonc` with new cron schedule
- [ ] Add environment variables to `.dev.vars`

---

## Reusable Code from `src/contracts/`

The existing `src/contracts/` folder contains:
- **ABIs**: TroveManager, StabilityPool, PriceFeed, UBTC (ERC20)
- **Mainnet addresses**: `mainnet_addresses.json`
- **Contract readers**: `calls.ts` has patterns for `contractRead.troveManager.getLatestTroveData()` and `contractRead.stabilityPool.getUserPosition()`

Note: The `calls.ts` imports from `~/lib/collateral` which is a frontend module - we adapt the patterns for the worker context.

---

## Decimal Handling

| Token | Decimals | Notes |
|-------|----------|-------|
| WBTC (Ethereum) | 8 | Native precision |
| WBTC (Starknet underlying) | 8 | Bridged from Ethereum |
| WWBTC (Starknet wrapped) | 18 | Used in Uncap protocol |
| USDU | 18 | Stablecoin |
| Prices | 18 | From oracle |

All values are stored as raw bigints, converted to Big.js for calculations, then serialized as strings for storage.
