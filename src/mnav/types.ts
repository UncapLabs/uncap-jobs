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
	/** USDU remaining in stability pool after liquidations */
	usdu: Big;
	/** USDU yield gains from interest */
	usduYieldGain: Big;
	/** WBTC gains from liquidations - pending */
	collateralGain: Big;
	/** WBTC gains from liquidations - stashed from previous compounds */
	stashedColl: Big;
}

export interface UncapPositions {
	/** WBTC collateral deposited in Uncap trove */
	collateral: Big;
	/** USDU debt owed */
	debt: Big;
	/** Stability pool position */
	stabilityPool: StabilityPoolPosition;
}

export interface Positions {
	ethereum: EthereumPositions;
	starknet: StarknetWalletPositions;
	uncap: UncapPositions;
}

// ============================================
// Price Types
// ============================================

export interface Prices {
	/** WBTC/USD price */
	wbtcUsd: Big;
}

// ============================================
// Result Types (strings for JSON serialization)
// ============================================

export interface MnavResult {
	/** ISO 8601 timestamp of calculation */
	timestamp: string;
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

/** Positions serialized as strings for JSON storage */
export interface SerializedPositions {
	ethereum: { wbtc: string };
	starknet: { wbtc: string; usdu: string; usdc: string };
	uncap: {
		collateral: string;
		debt: string;
		stabilityPool: {
			usdu: string;
			usduYieldGain: string;
			collateralGain: string;
			stashedColl: string;
		};
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

export interface UncapPositionsResult {
	positions: UncapPositions;
	blockNumber: number;
}

export interface PricesResult {
	prices: Prices;
	blockNumber: number;
}

