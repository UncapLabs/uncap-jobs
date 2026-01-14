/**
 * mNAV Calculator Type Definitions
 *
 * These types define the structure of positions, prices, and results
 * for the mNAV (market Net Asset Value) calculation.
 *
 * All amounts use Big.js for precise decimal arithmetic.
 */

import type Big from 'big.js';

// ============================================
// Block Information
// ============================================

export interface BlockNumbers {
	ethereum: number;
	starknet: number;
}

// ============================================
// Position Types (using Big for precision)
// ============================================

export interface EthereumPositions {
	/** WBTC balance in wallet (in WBTC units, 8 decimal precision) */
	wbtc: Big;
}

export interface StarknetWalletPositions {
	/** WBTC balance in wallet on Starknet (8 decimals) */
	wbtc: Big;
	/** USDU balance in wallet on Starknet (18 decimals) */
	usdu: Big;
	/** USDC balance in wallet on Starknet (6 decimals) */
	usdc: Big;
}

export interface StabilityPoolPosition {
	/** USDU remaining in stability pool after liquidations (18 decimals) */
	usdu: Big;
	/** USDU yield gains from interest (18 decimals) */
	usduYieldGain: Big;
	/** Collateral gains from liquidations - pending (18 decimals) */
	collateralGain: Big;
	/** Collateral gains from liquidations - stashed from previous compounds (18 decimals) */
	stashedColl: Big;
}

/** Position in a single Uncap branch (WWBTC, TBTC, or SOLVBTC) */
export interface BranchPosition {
	/** Branch name for identification */
	branchName: string;
	/** Collateral deposited in trove (18 decimals, wrapped) */
	collateral: Big;
	/** USDU debt owed (18 decimals) */
	debt: Big;
	/** Stability pool position in this branch */
	stabilityPool: StabilityPoolPosition;
}

/** Aggregated positions across all Uncap branches */
export interface UncapPositions {
	/** Individual branch positions */
	branches: {
		WWBTC: BranchPosition;
		TBTC: BranchPosition;
		SOLVBTC: BranchPosition;
	};
	/** Total collateral across all branches (for convenience) */
	totalCollateral: Big;
	/** Total debt across all branches (for convenience) */
	totalDebt: Big;
	/** Total stability pool USDU across all branches */
	totalSpUsdu: Big;
	/** Total stability pool yield gains across all branches */
	totalSpYieldGain: Big;
	/** Total stability pool collateral gains across all branches */
	totalSpCollGain: Big;
}

export interface ExtendedPosition {
	/** Value in USD (6 decimals like USDC) */
	valueUsd: Big;
}

export interface Positions {
	ethereum: EthereumPositions;
	starknet: StarknetWalletPositions;
	uncap: UncapPositions;
	extended: ExtendedPosition;
}

// ============================================
// Price Types
// ============================================

export interface Prices {
	/** WBTC/USD price (18 decimals) */
	wbtcUsd: Big;
}

// ============================================
// Result Types (strings for JSON serialization)
// ============================================

export interface MnavResult {
	/** ISO 8601 timestamp of calculation */
	timestamp: string;
	/** Network used for calculation */
	network: string;
	/** Block numbers used for calculation */
	blockNumbers: BlockNumbers;
	/** All positions (serialized as strings) */
	positions: SerializedPositions;
	/** Prices used for conversion */
	prices: SerializedPrices;

	// === LAGOON SUBMISSION ===
	/** Raw totalAssets value for Lagoon (WBTC with 8 decimals) - COPY THIS TO LAGOON */
	totalAssets: string;

	// === HUMAN-READABLE VALUES ===
	/** Formatted WBTC amount for human verification */
	totalAssetsFormatted: string;
	/** USD equivalent for sanity checking */
	totalValueUsd: string;

	/** Calculator version for tracking changes */
	calculationVersion: string;
	/** Any warnings generated during calculation */
	warnings: string[];
}

/** Serialized stability pool position */
export interface SerializedStabilityPool {
	usdu: string;
	usduYieldGain: string;
	collateralGain: string;
	stashedColl: string;
}

/** Serialized branch position */
export interface SerializedBranchPosition {
	branchName: string;
	collateral: string;
	debt: string;
	stabilityPool: SerializedStabilityPool;
}

/** Positions serialized as strings for JSON storage */
export interface SerializedPositions {
	ethereum: { wbtc: string };
	starknet: { wbtc: string; usdu: string; usdc: string };
	uncap: {
		branches: {
			WWBTC: SerializedBranchPosition;
			TBTC: SerializedBranchPosition;
			SOLVBTC: SerializedBranchPosition;
		};
		totals: {
			collateral: string;
			debt: string;
			spUsdu: string;
			spYieldGain: string;
			spCollGain: string;
		};
	};
	extended: {
		/** Value in USD (raw, 6 decimals) */
		valueUsd: string;
		/** Value in USD (human-readable) */
		valueUsdFormatted: string;
	};
}

/** Prices serialized for JSON storage */
export interface SerializedPrices {
	/** WBTC price in USD (human-readable, e.g. "91225.58") */
	wbtcUsd: string;
	/** Raw price with 18 decimals (for debugging) */
	wbtcUsdRaw: string;
}

// ============================================
// Fetcher Return Types
// ============================================

export interface EthereumWbtcResult {
	balance: Big;
	blockNumber: number;
}

export interface StarknetWalletResult {
	wbtc: Big;
	usdu: Big;
	usdc: Big;
	blockNumber: number;
}

/** Result from fetching a single branch's positions */
export interface BranchPositionResult {
	position: BranchPosition;
	blockNumber: number;
}

/** Result from fetching all Uncap positions across branches */
export interface UncapPositionsResult {
	positions: UncapPositions;
	blockNumber: number;
}

export interface PricesResult {
	prices: Prices;
	blockNumber: number;
}

export interface ExtendedPositionResult {
	/** Value in USD (6 decimals like USDC) */
	valueUsd: Big;
	/** Raw API response for debugging */
	rawResponse: unknown;
}

