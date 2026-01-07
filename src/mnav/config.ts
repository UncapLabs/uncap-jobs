/**
 * mNAV Calculator Configuration
 *
 * Contract addresses, ABIs, and constants for mNAV calculation.
 */

import type { Abi } from 'starknet';

// Import ABIs from JSON files
import StabilityPoolAbi from './abis/StabilityPool.json';
import TroveManagerAbi from './abis/TroveManager.json';
import TroveNFTAbi from './abis/TroveNFT.json';
import PriceFeedAbi from './abis/WBTCPriceFeed.json';
import UBTCAbi from './abis/UBTC.json';

// Export ABIs with proper typing
export const STABILITY_POOL_ABI = StabilityPoolAbi as Abi;
export const TROVE_MANAGER_ABI = TroveManagerAbi as Abi;
export const TROVE_NFT_ABI = TroveNFTAbi as Abi;
export const PRICE_FEED_ABI = PriceFeedAbi as Abi;
export const ERC20_ABI = UBTCAbi as Abi;

// ============================================
// Ethereum Contract Addresses
// ============================================

export const ETHEREUM_ADDRESSES = {
	/** WBTC token on Ethereum Mainnet */
	WBTC: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599' as const,
} as const;

// ============================================
// Starknet Contract Addresses (Mainnet)
// ============================================

export const STARKNET_ADDRESSES = {
	/** USDU stablecoin (18 decimals) */
	USDU: '0x2f94539f80158f9a48a7acf3747718dfbec9b6f639e2742c1fb44ae7ab5aa04',

	/** USDC stablecoin (6 decimals) */
	USDC: '0x33068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb',

	/** WWBTC Branch (Wrapped WBTC) */
	WWBTC: {
		/** Wrapped WBTC token (18 decimals) */
		collateral: '0x75d9e518f46a9ca0404fb0a7d386ce056dadf57fd9a0e8659772cb517be4a18',
		/** Underlying WBTC (8 decimals) - bridged from Ethereum */
		underlying: '0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac',
		/** Addresses registry */
		addressesRegistry: '0x42a37aa9263b01191286f0f800cc85c676441fb9d27d74bbf3ebcbf4e373d81',
		/** Borrower operations */
		borrowerOperations: '0x7346e65e80eb61cdfcc56f6f21de07b312e93fe770fb17a6e43c1950acfdbab',
		/** Trove manager - manages borrowing positions */
		troveManager: '0x586fc03b4e6901ef423890c19e8fcf528a269329ab23ff7cb2df975ec3d4d62',
		/** Stability pool - holds USDU for liquidations */
		stabilityPool: '0x1ba4a9e2e86a41c6ed15016eda0404d12bf7b01052cccff1ace84d818335c7',
		/** Price feed oracle */
		priceFeed: '0x6716836514e75e9f4eaa0fe93aa0448480a321b669041d6b5f27aa75374ac66',
		/** Active pool - holds collateral */
		activePool: '0x780627de12ac84a7887b7f83496a8ece5ea3c5eb7170f9f00587dabfdbe18d1',
		/** Collateral surplus pool */
		collSurplusPool: '0xd978e3fd1f8225407da3decd0baf7199904a49306cdf0f0820f67b4cec690f',
	},
} as const;

// ============================================
// Token Decimals
// ============================================

export const DECIMALS = {
	/** WBTC on Ethereum (8 decimals) */
	WBTC_ETH: 8,
	/** Wrapped WBTC on Starknet (18 decimals) */
	WWBTC_STARKNET: 18,
	/** Underlying WBTC on Starknet (8 decimals) */
	WBTC_STARKNET: 8,
	/** USDU stablecoin (18 decimals) */
	USDU: 18,
	/** USDC stablecoin (6 decimals) */
	USDC: 6,
	/** Price precision (18 decimals) */
	PRICE: 18,
} as const;

// ============================================
// Calculator Constants
// ============================================

export const MNAV_CONFIG = {
	/** Current calculation version */
	CALCULATION_VERSION: '1.0.0',

	/** Price staleness threshold in milliseconds (1 hour) */
	PRICE_STALENESS_THRESHOLD_MS: 60 * 60 * 1000,

	/** Uncap GraphQL indexer URL (fallback) */
	UNCAP_GRAPHQL_URL: 'https://squid-app-cqw88.ondigitalocean.app/graphql',

	/** Maximum retry attempts for RPC calls */
	MAX_RETRIES: 3,

	/** Initial delay between retries in ms */
	RETRY_DELAY_MS: 1000,
} as const;

// ============================================
// Viem ABI for Ethereum WBTC (ERC20)
// ============================================

export const WBTC_ERC20_ABI = [
	{
		name: 'balanceOf',
		type: 'function',
		stateMutability: 'view',
		inputs: [{ name: 'account', type: 'address' }],
		outputs: [{ name: '', type: 'uint256' }],
	},
	{
		name: 'decimals',
		type: 'function',
		stateMutability: 'view',
		inputs: [],
		outputs: [{ name: '', type: 'uint8' }],
	},
] as const;
