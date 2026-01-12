# mNAV Calculator Implementation Plan

## Overview

Add an mNAV (market Net Asset Value) calculator to the existing Cloudflare Worker. The calculator computes the total value of a BTC yield vault by aggregating positions across Ethereum Mainnet and Starknet.

## Phase 1 Scope (Current Implementation)

- Ethereum WBTC wallet balance
- Starknet WBTC/USDU/USDC wallet balances
- Uncap positions across **all 3 branches** (WWBTC, TBTC, SOLVBTC):
  - Trove collateral and debt
  - Stability pool deposits and gains
- Price feed from Uncap oracle (WBTC/USD)

## Phase 2 (Current)

- [x] Extended vault position (XVS)

## Phase 3 (Later)

- 0D Finance position (https://docs.0d.finance/0d/introduction)

---

## Key Simplifications

### BTC Variant Pricing
All BTC variants (WBTC, TBTC, SOLVBTC) are treated as **1:1 with WBTC**. Rationale: the curator claims and swaps collateral gains to WBTC immediately after liquidations, so we don't need separate price feeds.

### Stablecoin Pricing
USDU and USDC are assumed to be **$1.00**. No oracle check needed.

### What We Don't Track
- Bridge in-flight assets (not significant)
- Unclaimed STRK rewards (curator claims weekly and swaps to WBTC)

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
    │   ├── starknet-wallet.ts        # Fetch Starknet WBTC/USDU/USDC balances
    │   ├── uncap-positions.ts        # Fetch collateral, debt, SP positions (all branches)
    │   └── extended.ts               # Fetch Extended vault position (XVS)
    │
    └── prices/
        └── uncap-oracle.ts           # Fetch WBTC/USD price from Uncap PriceFeed
```

---

## mNAV Calculation Formula

All values use Big.js for precision. Raw bigints from contracts are converted via `Big(value.toString())`.

```
mNAV (in WBTC) =

  ┌─ WALLET BALANCES ─────────────────────────────────────┐
  │ + ethereum.wbtc                                       │
  │ + starknet.wbtc                                       │
  │ + starknet.usdu / wbtcPrice                           │
  │ + starknet.usdc / wbtcPrice                           │
  └───────────────────────────────────────────────────────┘

  ┌─ UNCAP: TROVE POSITIONS (all branches) ───────────────┐
  │ + wwbtc.collateral                                    │
  │ + tbtc.collateral      (treated as 1:1 WBTC)          │
  │ + solvbtc.collateral   (treated as 1:1 WBTC)          │
  │                                                       │
  │ - wwbtc.debt / wbtcPrice                              │
  │ - tbtc.debt / wbtcPrice                               │
  │ - solvbtc.debt / wbtcPrice                            │
  └───────────────────────────────────────────────────────┘

  ┌─ UNCAP: STABILITY POOL POSITIONS (all branches) ──────┐
  │ For each branch (WWBTC, TBTC, SOLVBTC):               │
  │   + sp.usdu / wbtcPrice                               │
  │   + sp.usduYieldGain / wbtcPrice                      │
  │   + sp.collateralGain   (treated as 1:1 WBTC)         │
  │   + sp.stashedColl      (treated as 1:1 WBTC)         │
  └───────────────────────────────────────────────────────┘

  ┌─ EXTENDED VAULT ──────────────────────────────────────┐
  │ + extended.valueUsd / wbtcPrice                       │
  └───────────────────────────────────────────────────────┘
```

---

## Contract Addresses

> **Current setup:** All addresses are **Sepolia testnet** for testing. Set `NETWORK=mainnet` and update addresses when ready for production.

### Starknet Sepolia - Tokens

| Token | Address | Decimals |
|-------|---------|----------|
| USDU | `0x31acb4c34a696fd8299458334688c4fa033789f2523545ddc32d2443079f752` | 18 |

### Uncap Protocol - All Branches (Sepolia)

#### WWBTC Branch
| Contract | Address |
|----------|---------|
| Collateral (WWBTC, 18 dec) | `0x2f2099951753de295a0c35f92e7b16b0c270a187b1ed25116dc10894d0098c8` |
| Underlying (WBTC, 8 dec) | `0x7949ea83decd19972b5ff333d1d5bcfd1883d9ea6625c7a319cf28b8aebde43` |
| AddressesRegistry | `0x821c815c69d5bf4258366a718913610ede38e78e2e3afd8f0f512c33f3d336` |
| TroveManager | `0x329667dd0d7920a59b7d9c240ca37e436efc50305cba697e51a0b0608512205` |
| StabilityPool | `0x39c87231ae004831a8b88161f0686de0a2c535c945ddcc3980cdbd26484ca1f` |
| PriceFeed | `0x1e6f31a6a446b2b74803211d973a174c82345a1b1bd596f8125c2cecd502d6f` |

#### TBTC Branch
| Contract | Address |
|----------|---------|
| Collateral | `0x0315e7b7903EB1D0bEcEBfc3cC5a056D7378883FB00D2400636c30BFef1EEf8c` |
| AddressesRegistry | `0x2eb409d9492e45e9abd09f0e1a47a2894104d5f2facc4d0639dedb8022aaf00` |
| TroveManager | `0x26877ec7c22ad5a0f36b050ac047d2d174f7f0c159eebf82d1a91a22e78f3b8` |
| StabilityPool | `0x6a60aedf5fa8bee82cc5eeade200d8221aa5e81be4c31cb558e0603d2d7c29` |
| PriceFeed | `0x3b83db36200a2083e94380f0c9cf2344a91198a200c563c188fd4f915718a50` |

#### SOLVBTC Branch
| Contract | Address |
|----------|---------|
| Collateral | `0x024f3eda4bEfeb9843C511b94C8EBA8929C7b3dFC3f8D05F5F0A91bF923D0977` |
| AddressesRegistry | `0x2fb257d6a4f47f800de836eeae64d0a36567fd69867939870d0da1ed7170b82` |
| TroveManager | `0x239a62bbd8a01324c99cd1d7210ee86f10c4e95a1ebce25cc5acab89567039c` |
| StabilityPool | `0x65ed413043f88a481b4337cae609c53e28cebc1ee9f549cb73dd1dd003bbcf8` |
| PriceFeed | `0x3f59f3fa4ff8da71e68866df7c55edad5b7ea4a55faa3419f980ee63fc09253` |

### Mainnet Addresses (TODO: Add when ready)

```typescript
// Will be populated when deploying to production
const MAINNET_ADDRESSES = {
  // ...
};
```

---

## Environment Variables Needed

```bash
# Network selection (sepolia | mainnet)
NETWORK=sepolia

# RPC Endpoints
ETHEREUM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
STARKNET_RPC_URL=https://starknet-sepolia.g.alchemy.com/v2/YOUR_KEY

# Curator Addresses (TBD)
CURATOR_ETH_ADDRESS=0x...
CURATOR_STARKNET_ADDRESS=0x...

# Extended API (get key from https://app.extended.exchange/api-management)
EXTENDED_API_KEY=your_api_key
```

**Notes:**
- Ethereum RPC always uses mainnet (WBTC contract only exists there). On Sepolia testing, Ethereum balance will be 0.
- Trove IDs are discovered dynamically via indexer. The indexer returns troves across all branches with a branch ID prefix (e.g., "0:troveId" for WWBTC, "1:troveId" for TBTC).

---

## Contract Calls

### Ethereum (viem)
- `WBTC.balanceOf(curator)` → balance (8 decimals)

### Starknet (starknet.js)

**Wallet Balances:**
- `WBTC.balance_of(curator)` → balance (8 decimals)
- `USDU.balance_of(curator)` → balance (18 decimals)
- `USDC.balance_of(curator)` → balance (6 decimals)

**Trove Position (TroveManager) - per branch:**
- `get_latest_trove_data(trove_id)` → returns struct with:
  - `entire_coll` (18 decimals, wrapped)
  - `entire_debt` (18 decimals, USDU)

**Stability Pool - per branch:**
- `get_compounded_usdu_deposit(curator)` → USDU balance (18 decimals)
- `get_depositor_yield_gain(curator)` → USDU yield (18 decimals)
- `get_depositor_coll_gain(curator)` → collateral gains pending (18 decimals)
- `get_stashed_coll(curator)` → collateral gains stashed (18 decimals)

**Price Feed (WWBTC branch only):**
- `get_price()` → WBTC/USD price (18 decimals)

### Extended API

**Base URL:** `https://api.starknet.extended.exchange`

**Authentication:**
- `X-Api-Key` header with API key from Extended UI
- `User-Agent` header required

**Endpoint:**
- `GET /api/v1/user/spot/balances` → returns vault position value in USD

Note: This endpoint is not publicly documented but was provided by the Extended team.

---

## Storage

Results are stored in **R2** (no database needed):

```
mnav-snapshots/
├── latest.json                      # Most recent calculation
└── YYYY-MM-DD/
    └── mnav-YYYYMMDDTHHMMSSZ.json   # Historical snapshots
```

Each snapshot contains the full `MnavResult` object with positions, prices, and calculated totals.

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

### Done - Core Implementation
- [x] Install dependencies (viem, starknet, big.js)
- [x] Create `src/mnav/types.ts` - Type definitions with Big.js
- [x] Create `src/mnav/config.ts` - Addresses and ABIs
- [x] Create `src/mnav/utils.ts` - Big.js export + retry helper
- [x] Create `src/mnav/fetchers/ethereum-wbtc.ts` - Ethereum balance
- [x] Create `src/mnav/fetchers/starknet-wallet.ts` - Starknet WBTC/USDU/USDC balances
- [x] Create `src/mnav/fetchers/uncap-positions.ts` - Trove + SP positions
- [x] Create `src/mnav/prices/uncap-oracle.ts` - Price fetcher
- [x] Create `src/mnav/calculate-mnav.ts` - Main orchestrator
- [x] R2 storage for snapshots

### Done - Multi-Branch Support
- [x] Add `NETWORK` env var support to `config.ts`
- [x] Update `config.ts` with Sepolia addresses for all 3 branches
- [x] Update `uncap-positions.ts` to fetch from all 3 branches (indexer + branch grouping)
- [x] Update `types.ts` to support multi-branch positions (`BranchPosition`, aggregated totals)
- [x] Update `calculate-mnav.ts` to aggregate all branches

### Done - Worker Integration
- [x] HTTP endpoint: `POST /admin/calculate-mnav`
- [x] Cron schedule: `0 11 * * *` (daily at 11 AM UTC)
- [x] Environment variables in `.dev.vars`

### Done - Extended Integration
- [x] Create `src/mnav/fetchers/extended.ts` - Extended API fetcher
- [x] Update `types.ts` with Extended position types
- [x] Update `config.ts` with Extended API configuration
- [x] Update `calculate-mnav.ts` to include Extended in mNAV calculation
- [x] Add `EXTENDED_API_KEY` environment variable

### TODO - Production Deployment
- [ ] Add mainnet addresses to `config.ts` (WWBTC, TBTC, SOLVBTC branches)
- [ ] Set `NETWORK=mainnet` in production environment
- [ ] Configure real curator addresses (`CURATOR_ETH_ADDRESS`, `CURATOR_STARKNET_ADDRESS`)
- [ ] Configure Extended API key (`EXTENDED_API_KEY`) via Cloudflare secrets
- [ ] Test with mainnet data

---

## Decimal Handling

| Token | Decimals | Notes |
|-------|----------|-------|
| WBTC (Ethereum) | 8 | Native precision |
| WBTC (Starknet underlying) | 8 | Bridged from Ethereum |
| WWBTC/TBTC/SOLVBTC (wrapped) | 18 | Used in Uncap protocol |
| USDU | 18 | Stablecoin (assume $1) |
| USDC | 6 | Stablecoin (assume $1) |
| Prices | 18 | From oracle |

All values are stored as raw bigints, converted to Big.js for calculations, then serialized as strings for storage.

---

## Multi-Branch Architecture

The Uncap protocol has separate "branches" for each BTC collateral type. Each branch has its own:
- TroveManager (manages borrowing positions)
- StabilityPool (absorbs liquidations)
- PriceFeed (oracle for that collateral)

The curator may have:
- Troves in multiple branches (collateral + debt)
- Stability pool deposits in multiple branches (USDU + collateral gains)

We query all 3 branches and sum the positions. All collateral types are treated as equivalent to WBTC (1:1 ratio).
