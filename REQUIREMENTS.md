# mNAV Calculator Requirements

## Overview

This document outlines the requirements for an automated mNAV (market Net Asset Value) calculator for a BTC yield vault built on Lagoon Finance. The calculator will run as a scheduled Cloudflare Worker, fetching position data from multiple protocols across Ethereum Mainnet and Starknet to compute the total vault value.

---

## Table of Contents

1. [Product Context](#product-context)
2. [Lagoon Finance Mechanics](#lagoon-finance-mechanics)
3. [Vault Strategy](#vault-strategy)
4. [mNAV Calculation Requirements](#mnav-calculation-requirements)
5. [Data Sources](#data-sources)
6. [Technical Architecture](#technical-architecture)
7. [Protocol-Specific Details](#protocol-specific-details)
8. [Price Feeds](#price-feeds)
9. [Edge Cases](#edge-cases)
10. [Output Requirements](#output-requirements)

---

## Product Context

### What We're Building

A **BTC yield product** that allows users to deposit WBTC on Ethereum Mainnet and earn yield from DeFi strategies on Starknet. The product is structured as follows:

- **Vault Platform**: Lagoon Finance (Ethereum Mainnet)
- **Vault Asset**: WBTC
- **Curator**: 9Summits (manages the vault strategy)
- **Performance Fee**: 10% of yield to curator

### User Flow

1. User deposits WBTC into the Lagoon vault on Ethereum Mainnet
2. User receives vault shares representing their ownership
3. Curator bridges WBTC to Starknet
4. Curator deploys capital across DeFi protocols to generate yield
5. Yield accrues to the vault, increasing share value
6. User can request withdrawal at any time (processed asynchronously)

### Why mNAV Matters

The mNAV (market Net Asset Value) is **critical** because it determines:
- How many shares new depositors receive
- The redemption value for withdrawing users
- Performance fee calculations
- The market price displayed to users

An inaccurate mNAV could result in:
- New depositors receiving too many/few shares (dilution or overpayment)
- Withdrawing users receiving incorrect amounts
- Incorrect performance fee accrual

---

## Lagoon Finance Mechanics

### Overview

Lagoon is a permissionless on-chain vault technology built on the **ERC-7540 asynchronous vault standard**. It provides flexibility for curators to implement any strategy while maintaining security through role separation.

### Key Concepts

#### Asynchronous Deposits & Withdrawals

Unlike traditional vaults where deposits/withdrawals are instant, Lagoon uses an async model:

1. **Request Phase**: User calls `requestDeposit()` or `requestRedeem()`
   - Assets are transferred to a **pending silo** (separate contract)
   - Request is queued for the next settlement

2. **Settlement Phase**: Curator settles pending requests
   - Valuation Oracle proposes the current NAV
   - Curator approves and executes settlement
   - Shares are minted (deposits) or assets released (withdrawals)

3. **Claim Phase**: Users claim their shares/assets

#### The Pending Silo

The pending silo is a critical concept:
- Holds assets that are **pending** deposit (not yet converted to shares)
- Holds redemption requests (shares pending conversion to assets)
- These assets are **NOT** part of the vault's NAV

#### Valuation Rules

**Critical Rule**: The mNAV must **exclusively** account for positions held by the curating address. It must **exclude**:
- Pending deposit requests (in the silo)
- Pending redemption requests (in the silo)

Example:
```
Curating balance: 10 WBTC
Pending deposits: 5 WBTC (in silo)
Pending redemptions: 2 WBTC worth of shares
─────────────────────────
Expected mNAV: 10 WBTC ✓ (only curating balance)
```

#### Two-Step Verification

For security, valuations require approval from two separate parties:

1. **Valuation Oracle**: Proposes the NAV value
   - Can be an automated system or trusted party
   - Provides real-time market data

2. **Curator**: Validates and approves the proposed NAV
   - Reviews the valuation for accuracy
   - Executes settlement with `settleDeposit()` or `settleRedeem()`

This separation prevents any single party from manipulating valuations.

#### Epochs

Lagoon uses an epoch-based system:
- Each settlement creates a new epoch
- Users' requests are batched per epoch
- Share prices are fixed per epoch for fairness

#### Fee Structure

- **Management Fee**: Periodic fee on AUM (max 10%)
  - Formula: `(assets × rate / 10000) × (timeElapsed / 1 year)`

- **Performance Fee**: Fee on profits above high-water mark (max 50%)
  - Only charged on NEW profits
  - Uses high-water mark to prevent double-charging after losses
  - Formula: `(pricePerShare - highWaterMark) × totalSupply × rate / 10000`

- **Protocol Fee**: Lagoon takes 10% of vault-collected fees

Fees are distributed as newly minted shares to the `feeReceiver` address at each settlement.

---

## Vault Strategy

### Strategy Overview

The vault implements a **leveraged BTC yield strategy** across two chains:

```
Ethereum Mainnet                     Starknet
┌─────────────────┐                  ┌─────────────────────────────────┐
│                 │                  │                                 │
│  Lagoon Vault   │    Bridge        │  ┌─────────────────────────┐   │
│  (WBTC)         │ ──────────────>  │  │     Uncap Protocol      │   │
│                 │                  │  │  ┌─────────────────────┐│   │
└─────────────────┘                  │  │  │ WBTC Collateral     ││   │
                                     │  │  │ USDU Debt           ││   │
                                     │  │  └─────────────────────┘│   │
                                     │  │                         │   │
                                     │  │  ┌─────────────────────┐│   │
                                     │  │  │ Stability Pool      ││   │
                                     │  │  │ (USDU deposits)     ││   │
                                     │  │  └─────────────────────┘│   │
                                     │  └─────────────────────────┘   │
                                     │                                 │
                                     │  ┌─────────────────────────┐   │
                                     │  │   Vesu Protocol         │   │
                                     │  │   (USDC lending)        │   │
                                     │  └─────────────────────────┘   │
                                     │                                 │
                                     │  ┌─────────────────────────┐   │
                                     │  │   Extended Protocol     │   │
                                     │  │   (USDC vault)          │   │
                                     │  └─────────────────────────┘   │
                                     │                                 │
                                     └─────────────────────────────────┘
```

### Strategy Steps

1. **Bridge**: WBTC is bridged from Ethereum Mainnet to Starknet

2. **Collateralize**: WBTC is deposited into Uncap Protocol as collateral

3. **Borrow**: USDU (Uncap's stablecoin) is borrowed against the WBTC collateral

4. **Deploy Capital**: The borrowed USDU is split across yield strategies:

   **Strategy A - Uncap Stability Pool**:
   - Deposit USDU into Stability Pool(s)
   - Earn yield from:
     - Interest paid by borrowers
     - Liquidation profits (receive collateral at 5% discount)

   **Strategy B - External Protocols**:
   - Swap USDU to USDC
   - Deposit USDC into Vesu (lending) and/or Extended (vault)
   - Earn lending/vault yields

### Yield Sources

| Source | Protocol | Yield Type |
|--------|----------|------------|
| Stability Pool interest | Uncap | Borrower interest distribution |
| Liquidation profits | Uncap | Collateral received at discount |
| STRK collateral rewards | Uncap | 2% APR in STRK for WBTC depositors |
| STRK interest rebate | Uncap | Up to 40% of interest rebated in STRK |
| Lending yield | Vesu | Interest from borrowers |
| Vault yield | Extended | Strategy returns |

### STRK Incentive Program

Uncap currently runs an incentive program that distributes STRK rewards to users:

#### Collateral Rewards
- **Rate**: 2% APR equivalent distributed in STRK tokens
- **Eligibility**: WBTC depositors (collateral providers)
- **Distribution**: Weekly, claimable every Friday
- **Claim process**: Manual claim required

#### Interest Rate Rebate
- **Rate**: Up to 40% of interest paid is rebated in STRK
- **Eligibility**: Borrowers (those with USDU debt)
- **Distribution**: Weekly, claimable every Friday
- **Claim process**: Manual claim required

#### Impact on mNAV Calculation

**Simplified approach**: We do NOT track unclaimed STRK rewards (too complex to calculate). Instead:

1. Curator claims STRK rewards every Friday
2. Claimed STRK is **immediately swapped to WBTC**
3. The swapped WBTC appears in the curator's wallet balance
4. mNAV calculation simply includes the WBTC wallet balance (which now contains the converted STRK rewards)

This means no STRK price feeds or reward tracking is needed - the value is captured when it becomes WBTC.

### Risk Considerations

- **Liquidation risk**: If WBTC price drops, the Uncap position could be liquidated
- **Smart contract risk**: Multiple protocols involved
- **Bridge risk**: Assets cross-chain via bridge
- **Stablecoin risk**: USDU and USDC depeg risk
- **Stability Pool risk**: USDU is exchanged for collateral during liquidations

---

## mNAV Calculation Requirements

### Formula

The mNAV must be calculated in **WBTC terms** (the vault's base asset):

```
mNAV (in WBTC) =

  ┌─ ETHEREUM MAINNET ─────────────────────────────────────┐
  │ + WBTC_balance_on_ethereum                             │
  │   (any uninvested WBTC held by curator on Ethereum)    │
  └────────────────────────────────────────────────────────┘

  ┌─ STARKNET: UNCAP PROTOCOL ─────────────────────────────┐
  │ + WBTC_collateral                                      │
  │   (WBTC deposited as collateral in Uncap)              │
  │                                                        │
  │ - USDU_debt / WBTC_USD_price                           │
  │   (outstanding USDU debt, converted to WBTC)           │
  │                                                        │
  │ + SP_USDU_balance / WBTC_USD_price                     │
  │   (USDU remaining in Stability Pool)                   │
  │                                                        │
  │ + SP_WBTC_received                                     │
  │   (WBTC received from liquidations)                    │
  │                                                        │
  │ + SP_TBTC_received × TBTC_WBTC_ratio                   │
  │   (TBTC received from liquidations, converted)         │
  │                                                        │
  │ + SP_SOLVBTC_received × SOLVBTC_WBTC_ratio             │
  │   (SOLVBTC received from liquidations, converted)      │
  └────────────────────────────────────────────────────────┘

  ┌─ STARKNET: EXTERNAL PROTOCOLS ─────────────────────────┐
  │ + Vesu_USDC_position / WBTC_USD_price                  │
  │   (USDC deposited + accrued interest in Vesu)          │
  │                                                        │
  │ + Extended_USDC_position / WBTC_USD_price              │
  │   (USDC value in Extended vault)                       │
  └────────────────────────────────────────────────────────┘
```

### Calculation Frequency

- **Automated calculation**: Every 24 hours via Cloudflare scheduled worker
- **Settlement frequency**: Manual, approximately every 24-48 hours
- **On-demand**: Ability to trigger calculation manually if needed

### Accuracy Requirements

The mNAV calculation must be:

1. **Precise**: Account for all positions to the smallest unit
2. **Real-time**: Use current on-chain state, not stale data
3. **Consistent**: Same inputs should produce same outputs
4. **Auditable**: All data sources and calculations should be logged

### What to Include

- All assets held by the curator address on both chains
- All accrued but unclaimed yields
- All pending rewards in protocols
- Collateral received from Stability Pool liquidations

### What to Exclude

- Pending deposits in Lagoon's silo
- Pending redemptions in Lagoon's silo
- Assets held by any address other than the curator
- Gas tokens (ETH, STRK) used for operations

---

## Data Sources

### Approach

Use **direct RPC calls** to smart contracts for maximum accuracy and real-time data. Supplement with **protocol APIs/indexers** where available and beneficial.

### Available Data Sources

#### 1. Direct RPC Calls
- Most accurate, real-time data
- Required for Ethereum Mainnet
- Works for all Starknet protocols

#### 2. Uncap Protocol Indexer (GraphQL)
- **Endpoint**: `https://squid-app-cqw88.ondigitalocean.app/graphql`
- Provides indexed data for Uncap Protocol positions
- Can be used as primary source for Uncap data or as validation
- Useful for querying historical data and complex aggregations

#### 3. Voyager API
- Starknet block explorer API
- Can be used as fallback for contract reads
- Useful for transaction history and event parsing

### Data Source Matrix

| Data Point | Chain | Primary Source | Fallback |
|------------|-------|----------------|----------|
| WBTC balance (ETH) | Ethereum | RPC | Etherscan API |
| WBTC balance (Starknet) | Starknet | RPC | Voyager API |
| WBTC collateral | Starknet | Uncap Indexer | RPC |
| USDU debt | Starknet | Uncap Indexer | RPC |
| SP USDU balance | Starknet | Uncap Indexer | RPC |
| SP collateral gains | Starknet | Uncap Indexer | RPC |
| Vesu position | Starknet | RPC/API | - |
| Extended position | Starknet | RPC/API | - |
| WBTC price | Starknet | RPC (Uncap Oracle) | Pragma |
| BTC variant prices | Starknet | RPC (Uncap Oracle) | Pragma |

### RPC Providers

Required RPC access:
- **Ethereum Mainnet**: Alchemy, Infura, or similar
- **Starknet**: Alchemy, Infura, Blast, or similar

### Uncap Indexer Schema

The Uncap GraphQL indexer can be explored at the endpoint. Key entities likely include:
- Troves (borrowing positions)
- StabilityPool deposits
- Liquidation events
- Price updates

Query the GraphQL playground to discover available queries and fields.

---

## Technical Architecture

### System Design

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Cloudflare Scheduled Worker                       │
│                   (cron: every 24 hours)                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    Configuration                              │   │
│  │  - Curator addresses (ETH + Starknet)                        │   │
│  │  - Contract addresses                                         │   │
│  │  - RPC endpoints                                              │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    Data Fetchers                              │   │
│  │                                                               │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐             │   │
│  │  │  Ethereum   │ │   Uncap     │ │ Vesu/Ext    │             │   │
│  │  │  Fetcher    │ │  Fetcher    │ │  Fetcher    │             │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘             │   │
│  │                                                               │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    Price Oracle                               │   │
│  │  - Fetch WBTC/USD from Uncap oracle                          │   │
│  │  - Fetch BTC variant ratios                                   │   │
│  │  - Fetch USDC/USD (should be ~1.0)                           │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    Calculator                                 │   │
│  │  - Aggregate all positions                                    │   │
│  │  - Apply price conversions                                    │   │
│  │  - Compute final mNAV in WBTC                                │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    Output                                     │   │
│  │  - Store result (D1 database / KV)                           │   │
│  │  - Emit logs for auditing                                     │   │
│  │  - Optional: webhook notification                             │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Proposed File Structure

```
/mnav-calculator
├── src/
│   ├── index.ts                 # Cloudflare Worker entry point
│   ├── config.ts                # Addresses, ABIs, constants
│   ├── types.ts                 # TypeScript type definitions
│   │
│   ├── fetchers/
│   │   ├── ethereum.ts          # Fetch WBTC balance on Ethereum
│   │   ├── uncap/
│   │   │   ├── collateral.ts    # Fetch collateral position
│   │   │   ├── debt.ts          # Fetch USDU debt
│   │   │   └── stability-pool.ts # Fetch SP position + rewards
│   │   ├── vesu.ts              # Fetch Vesu USDC position
│   │   └── extended.ts          # Fetch Extended USDC position
│   │
│   ├── prices/
│   │   └── oracle.ts            # Price fetching from Uncap oracle
│   │
│   ├── calculator.ts            # mNAV calculation logic
│   └── utils.ts                 # Helper functions
│
├── wrangler.toml                # Cloudflare Worker config
├── package.json
├── tsconfig.json
└── README.md
```

### Technology Stack

- **Runtime**: Cloudflare Workers
- **Language**: TypeScript
- **Ethereum RPC**: viem or ethers.js
- **Starknet RPC**: starknet.js
- **Storage**: Cloudflare D1 (SQLite) or KV
- **Scheduling**: Cloudflare Cron Triggers

---

## Protocol-Specific Details

### Uncap Protocol

#### Overview

Uncap is a borrowing protocol on Starknet that allows users to deposit BTC-backed collateral (WBTC, TBTC, SOLVBTC) and borrow USDU stablecoin.

#### Key Contracts

| Contract | Purpose |
|----------|---------|
| TroveManager | Manages individual borrowing positions (troves) |
| ActivePool | Holds all active collateral |
| StabilityPool | Holds USDU deposits for liquidations |
| PriceFeed | Oracle for collateral prices |

#### Collateral Position Data

To fetch the curator's collateral position:
- Query TroveManager for the trove associated with curator address
- Get: collateral amount, debt amount, accrued interest

#### Stability Pool Data

The Stability Pool has unique mechanics:
- Users deposit USDU
- When liquidations occur:
  - USDU is used to repay liquidated debt
  - Depositors receive the liquidated collateral at ~5% discount
  - User's USDU balance decreases, collateral balance increases

Data needed from Stability Pool:
- Current USDU deposit balance
- Accumulated collateral gains (WBTC, TBTC, SOLVBTC)

**Important**: Each collateral type has its own Stability Pool branch. If depositing into multiple branches, query each one.

#### Liquidation Mechanics

When a borrower's LTV exceeds 86.96%:
1. Primary: Stability Pool absorbs the debt
2. Fallback: Redistribution to other borrowers

Stability Pool depositors:
- Lose USDU (used to repay debt)
- Gain collateral (at 5% discount to market value)
- Net effect is typically positive (profit from liquidation)

### Vesu Protocol

#### Overview

Vesu is a lending protocol on Starknet. Users can deposit assets to earn yield from borrowers.

#### Position Data

To fetch the curator's Vesu position:
- Query for deposited USDC amount
- Query for accrued interest
- Sum for total position value

#### Relevant Contracts

(To be determined - need to research Vesu's contract structure)

### Extended Protocol

#### Overview

Extended offers yield vaults on Starknet. Users deposit assets and receive vault shares.

#### Position Data

To fetch the curator's Extended position:
- Query vault share balance
- Query share price (assets per share)
- Calculate: shares × share_price = total USDC value

#### Relevant Contracts

(To be determined - need to research Extended's contract structure)

---

## Price Feeds

### Primary Price Source

Use **Uncap's on-chain oracle** as the primary price source for BTC and BTC variants. This ensures consistency with the protocol's own valuation.

### Required Prices

| Asset | Source | Notes |
|-------|--------|-------|
| WBTC/USD | Uncap Oracle | Primary BTC price |
| TBTC/WBTC | Uncap Oracle | For SP liquidation gains |
| SOLVBTC/WBTC | Uncap Oracle | For SP liquidation gains |
| USDC/USD | Assume 1.0 | Or use Pragma oracle |
| USDU/USD | Assume 1.0 | Or track if depegged |

### Price Calculation

All non-WBTC assets must be converted to WBTC:

```
WBTC_value = USD_value / WBTC_USD_price
```

For BTC variants received from liquidations:
```
WBTC_equivalent = TBTC_amount × TBTC_WBTC_ratio
```

### Handling Price Staleness

- Check oracle's last update timestamp
- If price is stale (>1 hour old), log warning
- Consider fallback to secondary oracle (Pragma, etc.)

---

## Edge Cases

### 1. Stability Pool Liquidation Rewards

**Scenario**: Curator's SP position receives liquidated collateral

**Handling**:
- Track all three collateral types (WBTC, TBTC, SOLVBTC)
- Convert non-WBTC to WBTC equivalent using oracle prices
- Include in total position value

### 2. Partially Filled Positions

**Scenario**: Some capital is "in transit" (swapped but not deposited)

**Handling**:
- Track intermediate token balances (USDC in wallet)
- Include all tokens held by curator address

### 3. Accrued but Unclaimed Rewards

**Scenario**: Yield has accrued but not been claimed/compounded

**Handling**:
- Query pending rewards from each protocol
- Include in position value even if unclaimed

### 4. Bridge Delays

**Scenario**: WBTC is being bridged between chains

**Handling**:
- Monitor bridge transactions
- Include bridged assets based on bridge state
- May need to query bridge contract for in-flight assets

### 5. Stablecoin Depeg

**Scenario**: USDU or USDC trades below $1

**Handling**:
- Use actual market price if available
- Log warning if significant depeg detected
- Consider circuit breaker if depeg exceeds threshold

### 6. Failed RPC Calls

**Scenario**: RPC provider returns error or timeout

**Handling**:
- Implement retry logic with exponential backoff
- Use fallback RPC provider if available
- Do NOT publish stale NAV - fail loudly

### 7. Contract Upgrades

**Scenario**: Protocol contracts are upgraded

**Handling**:
- Monitor for contract changes
- Use proxy-aware address resolution
- Maintain version compatibility

---

## Output Requirements

### Calculation Output

Each mNAV calculation should produce:

```typescript
interface MnavResult {
  // Timestamp of calculation
  timestamp: string;  // ISO 8601
  blockNumbers: {
    ethereum: number;
    starknet: number;
  };

  // Position breakdown
  positions: {
    ethereum: {
      wbtc: string;  // Decimal string
    };
    uncap: {
      collateral: string;
      debt: string;
      stabilityPool: {
        usdu: string;
        wbtcGains: string;
        tbtcGains: string;
        solvbtcGains: string;
      };
    };
    vesu: {
      usdc: string;
    };
    extended: {
      usdc: string;
    };
  };

  // Prices used
  prices: {
    wbtcUsd: string;
    tbtcWbtc: string;
    solvbtcWbtc: string;
    usdcUsd: string;
  };

  // Final calculation
  totalValueWbtc: string;  // The mNAV
  totalValueUsd: string;   // For reference

  // Metadata
  calculationVersion: string;
  warnings: string[];
}
```

### Storage

Store calculation results for:
- Historical tracking
- Audit trail
- Debugging

Options:
- Cloudflare D1 (SQLite database)
- Cloudflare KV (key-value store)
- External database

### Notifications

Optional webhook/notification when:
- Calculation completes successfully
- Calculation fails
- Significant position changes detected
- Price anomalies detected

---

## Implementation Phases

### Phase 1: Core Infrastructure
- Set up Cloudflare Worker project
- Implement configuration management
- Set up RPC connections (Ethereum + Starknet)

### Phase 2: Data Fetchers
- Implement Ethereum WBTC balance fetcher
- Implement Uncap position fetchers (collateral, debt, SP)
- Implement price oracle fetcher

### Phase 3: External Protocol Fetchers
- Implement Vesu position fetcher
- Implement Extended position fetcher

### Phase 4: Calculator & Output
- Implement mNAV calculation logic
- Implement storage (D1/KV)
- Implement logging and monitoring

### Phase 5: Testing & Validation
- Unit tests for each fetcher
- Integration tests with testnet
- Validation against manual calculations

### Phase 6: Production Deployment
- Deploy to Cloudflare
- Set up cron schedule
- Monitor initial runs

---

## Open Questions

1. **Curator Addresses**: What are the exact curator addresses on Ethereum and Starknet?

2. **Contract Addresses**: Need to document all relevant contract addresses for:
   - Uncap (TroveManager, StabilityPool, PriceFeed)
   - Vesu (lending pools)
   - Extended (vault contracts)

3. **Stability Pool Branches**: Which SP branches will be used (WBTC only, or multiple)?

4. **Bridge**: Which bridge will be used for ETH ↔ Starknet transfers?

5. **Vesu/Extended Details**: Need to research their contract interfaces

6. **Error Handling**: What should happen if calculation fails? Manual fallback?

7. **Notification System**: Where should alerts be sent? (Slack, Discord, email?)

---

## References

- [Lagoon Finance Docs](https://docs.lagoon.finance/)
- [ERC-7540 Specification](https://eips.ethereum.org/EIPS/eip-7540)
- [Uncap Protocol Docs](https://uncap.finance/resources/docs)
- [Uncap GraphQL Indexer](https://squid-app-cqw88.ondigitalocean.app/graphql)
- Vesu Protocol Docs (TBD)
- Extended Protocol Docs (TBD)
