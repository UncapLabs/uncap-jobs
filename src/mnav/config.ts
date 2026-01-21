/**
 * mNAV Calculator Configuration
 *
 * Contract addresses, ABIs, and constants for mNAV calculation.
 * Supports both Sepolia (testing) and Mainnet (production).
 */

import type { Abi } from 'starknet';

// Import ABIs from JSON files
import StabilityPoolAbi from './abis/StabilityPool.json';
import TroveManagerAbi from './abis/TroveManager.json';
import TroveNFTAbi from './abis/TroveNFT.json';
import PriceFeedAbi from './abis/WBTCPriceFeed.json';
import UBTCAbi from './abis/UBTC.json';
import AddressesRegistryAbi from './abis/AddressesRegistry.json';

// Export ABIs with proper typing
export const STABILITY_POOL_ABI = StabilityPoolAbi as Abi;
export const TROVE_MANAGER_ABI = TroveManagerAbi as Abi;
export const TROVE_NFT_ABI = TroveNFTAbi as Abi;
export const PRICE_FEED_ABI = PriceFeedAbi as Abi;
export const ERC20_ABI = UBTCAbi as Abi;
export const ADDRESSES_REGISTRY_ABI = AddressesRegistryAbi as Abi;

// ============================================
// Network Type
// ============================================

export type Network = 'sepolia' | 'mainnet';

// ============================================
// Branch Configuration Type
// ============================================

export interface BranchAddresses {
	/** Branch identifier (0 = WWBTC, 1 = TBTC, 2 = SOLVBTC) */
	branchId: number;
	/** Wrapped collateral token (18 decimals) */
	collateral: string;
	/** Underlying token (8 decimals) - only for WWBTC */
	underlying?: string;
	/** Addresses registry */
	addressesRegistry: string;
	/** Trove manager - manages borrowing positions */
	troveManager: string;
	/** Stability pool - holds USDU for liquidations */
	stabilityPool: string;
	/** Price feed oracle */
	priceFeed: string;
}

export interface StarknetAddresses {
	/** USDU stablecoin (18 decimals) */
	USDU: string;
	/** USDC stablecoin (6 decimals) - only on mainnet */
	USDC?: string;
	/** USDC.e bridged stablecoin (6 decimals) */
	USDC_E?: string;
	/** All collateral branches */
	branches: {
		WWBTC: BranchAddresses;
		TBTC: BranchAddresses;
		SOLVBTC: BranchAddresses;
	};
}

// ============================================
// Ethereum Contract Addresses (Always Mainnet)
// ============================================

export const ETHEREUM_ADDRESSES = {
	/** WBTC token on Ethereum Mainnet */
	WBTC: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599' as const,
} as const;

// ============================================
// Starknet Sepolia Addresses
// ============================================

const SEPOLIA_ADDRESSES: StarknetAddresses = {
	USDU: '0x31acb4c34a696fd8299458334688c4fa033789f2523545ddc32d2443079f752',

	branches: {
		WWBTC: {
			branchId: 0,
			collateral: '0x2f2099951753de295a0c35f92e7b16b0c270a187b1ed25116dc10894d0098c8',
			underlying: '0x7949ea83decd19972b5ff333d1d5bcfd1883d9ea6625c7a319cf28b8aebde43',
			addressesRegistry: '0x821c815c69d5bf4258366a718913610ede38e78e2e3afd8f0f512c33f3d336',
			troveManager: '0x329667dd0d7920a59b7d9c240ca37e436efc50305cba697e51a0b0608512205',
			stabilityPool: '0x39c87231ae004831a8b88161f0686de0a2c535c945ddcc3980cdbd26484ca1f',
			priceFeed: '0x1e6f31a6a446b2b74803211d973a174c82345a1b1bd596f8125c2cecd502d6f',
		},
		TBTC: {
			branchId: 1,
			collateral: '0x0315e7b7903EB1D0bEcEBfc3cC5a056D7378883FB00D2400636c30BFef1EEf8c',
			addressesRegistry: '0x2eb409d9492e45e9abd09f0e1a47a2894104d5f2facc4d0639dedb8022aaf00',
			troveManager: '0x26877ec7c22ad5a0f36b050ac047d2d174f7f0c159eebf82d1a91a22e78f3b8',
			stabilityPool: '0x6a60aedf5fa8bee82cc5eeade200d8221aa5e81be4c31cb558e0603d2d7c29',
			priceFeed: '0x3b83db36200a2083e94380f0c9cf2344a91198a200c563c188fd4f915718a50',
		},
		SOLVBTC: {
			branchId: 2,
			collateral: '0x024f3eda4bEfeb9843C511b94C8EBA8929C7b3dFC3f8D05F5F0A91bF923D0977',
			addressesRegistry: '0x2fb257d6a4f47f800de836eeae64d0a36567fd69867939870d0da1ed7170b82',
			troveManager: '0x239a62bbd8a01324c99cd1d7210ee86f10c4e95a1ebce25cc5acab89567039c',
			stabilityPool: '0x65ed413043f88a481b4337cae609c53e28cebc1ee9f549cb73dd1dd003bbcf8',
			priceFeed: '0x3f59f3fa4ff8da71e68866df7c55edad5b7ea4a55faa3419f980ee63fc09253',
		},
	},
};

// ============================================
// Starknet Mainnet Addresses
// ============================================

const MAINNET_ADDRESSES: StarknetAddresses = {
	USDU: '0x2f94539f80158f9a48a7acf3747718dfbec9b6f639e2742c1fb44ae7ab5aa04',
	USDC: '0x33068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb',
	USDC_E: '0x53c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8',

	branches: {
		WWBTC: {
			branchId: 0,
			collateral: '0x75d9e518f46a9ca0404fb0a7d386ce056dadf57fd9a0e8659772cb517be4a18',
			underlying: '0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac',
			addressesRegistry: '0x42a37aa9263b01191286f0f800cc85c676441fb9d27d74bbf3ebcbf4e373d81',
			troveManager: '0x586fc03b4e6901ef423890c19e8fcf528a269329ab23ff7cb2df975ec3d4d62',
			stabilityPool: '0x1ba4a9e2e86a41c6ed15016eda0404d12bf7b01052cccff1ace84d818335c7',
			priceFeed: '0x6716836514e75e9f4eaa0fe93aa0448480a321b669041d6b5f27aa75374ac66',
		},
		TBTC: {
			branchId: 1,
			// TODO: Replace with mainnet addresses when available
			collateral: '',
			addressesRegistry: '',
			troveManager: '',
			stabilityPool: '',
			priceFeed: '',
		},
		SOLVBTC: {
			branchId: 2,
			// TODO: Replace with mainnet addresses when available
			collateral: '',
			addressesRegistry: '',
			troveManager: '',
			stabilityPool: '',
			priceFeed: '',
		},
	},
};

// ============================================
// Network Address Selector
// ============================================

/**
 * Get Starknet addresses for the specified network.
 */
export function getStarknetAddresses(network: Network): StarknetAddresses {
	return network === 'mainnet' ? MAINNET_ADDRESSES : SEPOLIA_ADDRESSES;
}

/**
 * Get all branch configurations as an array for iteration.
 */
export function getAllBranches(network: Network): BranchAddresses[] {
	const addresses = getStarknetAddresses(network);
	return [addresses.branches.WWBTC, addresses.branches.TBTC, addresses.branches.SOLVBTC];
}

/**
 * Get branch name from branch ID.
 */
export function getBranchName(branchId: number): string {
	switch (branchId) {
		case 0:
			return 'WWBTC';
		case 1:
			return 'TBTC';
		case 2:
			return 'SOLVBTC';
		default:
			return `Unknown(${branchId})`;
	}
}

// ============================================
// Token Decimals
// ============================================

export const DECIMALS = {
	/** WBTC on Ethereum (8 decimals) */
	WBTC_ETH: 8,
	/** Wrapped collateral on Starknet (18 decimals) */
	WRAPPED_COLL: 18,
	/** Underlying WBTC on Starknet (8 decimals) */
	WBTC_STARKNET: 8,
	/** USDU stablecoin (18 decimals) */
	USDU: 18,
	/** USDC stablecoin (6 decimals) */
	USDC: 6,
	/** USDC.e bridged stablecoin (6 decimals) */
	USDC_E: 6,
	/** Price precision (18 decimals) */
	PRICE: 18,
} as const;

// ============================================
// Calculator Constants
// ============================================

export const MNAV_CONFIG = {
	/** Current calculation version */
	CALCULATION_VERSION: '1.2.0',

	/** Price staleness threshold in milliseconds (1 hour) */
	PRICE_STALENESS_THRESHOLD_MS: 60 * 60 * 1000,

	/** Uncap GraphQL indexer URL */
	UNCAP_GRAPHQL_URL: 'https://squid-app-cqw88.ondigitalocean.app/graphql',

	/** Maximum retry attempts for RPC calls */
	MAX_RETRIES: 3,

	/** Initial delay between retries in ms */
	RETRY_DELAY_MS: 1000,
} as const;

// ============================================
// Extended API Configuration
// ============================================

export const EXTENDED_CONFIG = {
	/** Extended API base URLs by network */
	API_BASE: {
		mainnet: 'https://api.starknet.extended.exchange',
		sepolia: 'https://api.starknet.sepolia.extended.exchange',
	} as const,

	/** Spot balances endpoint */
	SPOT_BALANCES_ENDPOINT: '/api/v1/user/spot/balances',
} as const;

/**
 * Get Extended API base URL for the specified network.
 */
export function getExtendedApiBase(network: Network): string {
	return EXTENDED_CONFIG.API_BASE[network];
}

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
