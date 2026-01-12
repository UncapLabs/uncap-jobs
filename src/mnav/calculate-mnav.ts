/**
 * mNAV Calculator
 *
 * Main orchestrator that fetches all positions and calculates the mNAV.
 * Supports multiple Uncap branches (WWBTC, TBTC, SOLVBTC) with all BTC variants
 * treated as 1:1 with WBTC.
 */

import { fetchEthereumWbtcBalance } from './fetchers/ethereum-wbtc';
import { fetchStarknetWallet } from './fetchers/starknet-wallet';
import { fetchUncapPositions } from './fetchers/uncap-positions';
import { fetchExtendedPosition } from './fetchers/extended';
import { fetchPrices } from './prices/uncap-oracle';
import { Big } from './utils';
import { MNAV_CONFIG, DECIMALS, type Network } from './config';
import type {
	MnavResult,
	Positions,
	Prices,
	SerializedPositions,
	SerializedPrices,
	BranchPosition,
	SerializedBranchPosition,
	UncapPositions,
	ExtendedPosition,
} from './types';

/**
 * Calculate mNAV from positions and prices.
 *
 * All values are converted to WBTC with 8 decimals, then summed.
 *
 * Formula:
 *   mNAV = ethereum.wbtc (8 dec)
 *        + starknet.wbtc (8 dec)
 *        + starknet.usdu (18 dec) / price (18 dec) * 10^8 -> 8 dec
 *        + starknet.usdc (6 dec) / price (18 dec) * 10^8 * 10^12 -> 8 dec
 *        + uncap.totalCollateral (18 dec) / 10^10 -> 8 dec
 *        - uncap.totalDebt (18 dec) / price (18 dec) * 10^8 -> 8 dec
 *        + uncap.totalSpUsdu (18 dec) / price (18 dec) * 10^8 -> 8 dec
 *        + uncap.totalSpYieldGain (18 dec) / price (18 dec) * 10^8 -> 8 dec
 *        + uncap.totalSpCollGain (18 dec) / 10^10 -> 8 dec (all BTC variants treated as 1:1)
 *        + extended.valueUsd (6 dec) / price (18 dec) * 10^8 * 10^12 -> 8 dec
 */
function calculateMnavValue(positions: Positions, prices: Prices): { totalWbtc: Big; totalUsd: Big } {
	const price = prices.wbtcUsd; // 18 decimals
	const scale18to8 = Big(10).pow(10); // 10^10 to convert 18 decimals to 8
	const scale0to8 = Big(10).pow(DECIMALS.WBTC_ETH); // 10^8 to add 8 decimals
	const scale6to18 = Big(10).pow(DECIMALS.USDU - DECIMALS.USDC); // 10^12 to convert USDC 6 dec to 18 dec

	// Ethereum WBTC (already 8 decimals)
	const ethWbtc = positions.ethereum.wbtc;

	// Starknet WBTC (already 8 decimals)
	const starknetWbtc = positions.starknet.wbtc;

	// Starknet USDU wallet balance -> WBTC (18 dec / 18 dec * 10^8 = 8 dec)
	const starknetUsduWbtc = positions.starknet.usdu.div(price).times(scale0to8);

	// Starknet USDC wallet balance -> WBTC (6 dec * 10^12 = 18 dec, then / 18 dec * 10^8 = 8 dec)
	const starknetUsdcWbtc = positions.starknet.usdc.times(scale6to18).div(price).times(scale0to8);

	// Uncap collateral (18 dec -> 8 dec) - all BTC variants treated as 1:1
	const uncapColl = positions.uncap.totalCollateral.div(scale18to8);

	// Uncap debt (18 dec USDU -> WBTC 8 dec)
	const uncapDebtWbtc = positions.uncap.totalDebt.div(price).times(scale0to8);

	// Stability pool USDU -> WBTC
	const spUsduWbtc = positions.uncap.totalSpUsdu.div(price).times(scale0to8);
	const spYieldWbtc = positions.uncap.totalSpYieldGain.div(price).times(scale0to8);

	// SP collateral gains (18 dec -> 8 dec) - all BTC variants treated as 1:1
	const spCollGainWbtc = positions.uncap.totalSpCollGain.div(scale18to8);

	// Extended vault position (6 dec * 10^12 = 18 dec, then / 18 dec * 10^8 = 8 dec)
	const extendedWbtc = positions.extended.valueUsd.times(scale6to18).div(price).times(scale0to8);

	// Total mNAV in WBTC (8 decimals)
	const totalWbtc = ethWbtc
		.plus(starknetWbtc)
		.plus(starknetUsduWbtc)
		.plus(starknetUsdcWbtc)
		.plus(uncapColl)
		.minus(uncapDebtWbtc)
		.plus(spUsduWbtc)
		.plus(spYieldWbtc)
		.plus(spCollGainWbtc)
		.plus(extendedWbtc);

	// USD value: convert totalWbtc to actual WBTC amount, then multiply by USD price
	const totalUsd = totalWbtc.times(price).div(Big(10).pow(DECIMALS.WBTC_ETH + DECIMALS.PRICE));

	return { totalWbtc, totalUsd };
}

/**
 * Serialize a branch position for JSON storage.
 */
function serializeBranchPosition(branch: BranchPosition): SerializedBranchPosition {
	return {
		branchName: branch.branchName,
		collateral: branch.collateral.toFixed(0),
		debt: branch.debt.toFixed(0),
		stabilityPool: {
			usdu: branch.stabilityPool.usdu.toFixed(0),
			usduYieldGain: branch.stabilityPool.usduYieldGain.toFixed(0),
			collateralGain: branch.stabilityPool.collateralGain.toFixed(0),
			stashedColl: branch.stabilityPool.stashedColl.toFixed(0),
		},
	};
}

/**
 * Serialize positions for JSON storage.
 */
function serializePositions(positions: Positions): SerializedPositions {
	// Format Extended USD value for human readability
	const extendedUsdHuman = positions.extended.valueUsd.div(Big(10).pow(DECIMALS.USDC)).toFixed(2);

	return {
		ethereum: { wbtc: positions.ethereum.wbtc.toFixed(0) },
		starknet: {
			wbtc: positions.starknet.wbtc.toFixed(0),
			usdu: positions.starknet.usdu.toFixed(0),
			usdc: positions.starknet.usdc.toFixed(0),
		},
		uncap: {
			branches: {
				WWBTC: serializeBranchPosition(positions.uncap.branches.WWBTC),
				TBTC: serializeBranchPosition(positions.uncap.branches.TBTC),
				SOLVBTC: serializeBranchPosition(positions.uncap.branches.SOLVBTC),
			},
			totals: {
				collateral: positions.uncap.totalCollateral.toFixed(0),
				debt: positions.uncap.totalDebt.toFixed(0),
				spUsdu: positions.uncap.totalSpUsdu.toFixed(0),
				spYieldGain: positions.uncap.totalSpYieldGain.toFixed(0),
				spCollGain: positions.uncap.totalSpCollGain.toFixed(0),
			},
		},
		extended: {
			valueUsd: positions.extended.valueUsd.toFixed(0),
			valueUsdFormatted: `$${extendedUsdHuman}`,
		},
	};
}

/**
 * Serialize prices for JSON storage.
 */
function serializePrices(prices: Prices): SerializedPrices {
	const priceUsd = prices.wbtcUsd.div(Big(10).pow(DECIMALS.PRICE));
	return {
		wbtcUsd: priceUsd.toFixed(2),
		wbtcUsdRaw: prices.wbtcUsd.toFixed(0),
	};
}

/**
 * Create empty Uncap positions for fallback.
 */
function createEmptyUncapPositions(): UncapPositions {
	const emptyBranch = (name: string): BranchPosition => ({
		branchName: name,
		collateral: Big(0),
		debt: Big(0),
		stabilityPool: {
			usdu: Big(0),
			usduYieldGain: Big(0),
			collateralGain: Big(0),
			stashedColl: Big(0),
		},
	});

	return {
		branches: {
			WWBTC: emptyBranch('WWBTC'),
			TBTC: emptyBranch('TBTC'),
			SOLVBTC: emptyBranch('SOLVBTC'),
		},
		totalCollateral: Big(0),
		totalDebt: Big(0),
		totalSpUsdu: Big(0),
		totalSpYieldGain: Big(0),
		totalSpCollGain: Big(0),
	};
}

export async function calculateMnav(env: Env): Promise<MnavResult> {
	console.log('[mnav] === mNAV Calculation Starting ===');
	const startTime = Date.now();
	const warnings: string[] = [];

	// Get network from env (default to sepolia for safety)
	const network: Network = (env.NETWORK as Network) || 'sepolia';
	console.log(`[mnav] Network: ${network}`);

	try {
		// Helper to safely fetch with fallback
		const safeFetch = async <T>(
			name: string,
			fetcher: () => Promise<T>,
			fallback: T
		): Promise<{ result: T; failed: boolean }> => {
			try {
				const result = await fetcher();
				return { result, failed: false };
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				console.warn(`[mnav] ${name} failed: ${errorMsg}`);
				warnings.push(`${name} failed: ${errorMsg}`);
				return { result: fallback, failed: true };
			}
		};

		// Default values for fallbacks
		const defaultEthWbtc = { balance: Big(0), blockNumber: 0 };
		const defaultStarknetWallet = { wbtc: Big(0), usdu: Big(0), usdc: Big(0), blockNumber: 0 };
		const defaultUncap = {
			positions: createEmptyUncapPositions(),
			blockNumber: 0,
		};
		const defaultExtended = { valueUsd: Big(0), rawResponse: null };

		// Fetch all in parallel - prices are critical, others can fail gracefully
		console.log('[mnav] Fetching positions and prices...');
		const [ethResult, starknetResult, uncapResult, extendedResult, pricesResult] = await Promise.all([
			safeFetch(
				'Ethereum WBTC balance',
				() => fetchEthereumWbtcBalance(env.ETHEREUM_RPC_URL, env.CURATOR_ETH_ADDRESS),
				defaultEthWbtc
			),
			safeFetch(
				'Starknet wallet',
				() => fetchStarknetWallet(env.STARKNET_RPC_URL, env.CURATOR_STARKNET_ADDRESS, network),
				defaultStarknetWallet
			),
			safeFetch(
				'Uncap positions',
				() => fetchUncapPositions(env.STARKNET_RPC_URL, env.CURATOR_STARKNET_ADDRESS, network),
				defaultUncap
			),
			safeFetch('Extended position', () => fetchExtendedPosition(env.EXTENDED_API_KEY), defaultExtended),
			fetchPrices(env.STARKNET_RPC_URL, network), // Prices are critical - let this throw if it fails
		]);

		// Track skipped components
		if (ethResult.result.blockNumber === 0 && !ethResult.failed) {
			warnings.push('Ethereum WBTC balance skipped (invalid or missing config)');
		}
		if (starknetResult.result.blockNumber === 0 && !starknetResult.failed) {
			warnings.push('Starknet wallet skipped (invalid or missing config)');
		}
		if (uncapResult.result.blockNumber === 0 && !uncapResult.failed) {
			warnings.push('Uncap positions skipped (invalid or missing config)');
		}

		// Assemble positions
		const positions: Positions = {
			ethereum: { wbtc: ethResult.result.balance },
			starknet: {
				wbtc: starknetResult.result.wbtc,
				usdu: starknetResult.result.usdu,
				usdc: starknetResult.result.usdc,
			},
			uncap: uncapResult.result.positions,
			extended: { valueUsd: extendedResult.result.valueUsd },
		};

		const prices: Prices = pricesResult.prices;

		// Track block numbers
		const starknetBlocks = [
			starknetResult.result.blockNumber,
			uncapResult.result.blockNumber,
			pricesResult.blockNumber,
		].filter((b) => b > 0);

		const blockNumbers = {
			ethereum: ethResult.result.blockNumber,
			starknet: starknetBlocks.length > 0 ? Math.max(...starknetBlocks) : 0,
		};

		// Calculate mNAV
		const { totalWbtc, totalUsd } = calculateMnavValue(positions, prices);

		// Format values for output
		const totalAssetsRaw = totalWbtc.round(0, Big.roundHalfUp).toFixed(0);
		const totalWbtcHuman = totalWbtc.div(Big(10).pow(DECIMALS.WBTC_ETH)).toFixed(8);
		const totalUsdNum = Number(totalUsd.toFixed(2));
		const totalUsdFormatted = `$${totalUsdNum.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

		// Build result
		const now = new Date();
		const result: MnavResult = {
			timestamp: now.toISOString(),
			network,
			blockNumbers,
			positions: serializePositions(positions),
			prices: serializePrices(prices),
			totalAssets: totalAssetsRaw,
			totalAssetsFormatted: `${totalWbtcHuman} WBTC`,
			totalValueUsd: totalUsdFormatted,
			calculationVersion: MNAV_CONFIG.CALCULATION_VERSION,
			warnings,
		};

		// Store in R2
		const dateStr = now.toISOString().slice(0, 10);
		const timestampStr = now.toISOString().replace(/[:\-\.]/g, '').replace('000Z', 'Z');
		const snapshotKey = `mnav-snapshots/${network}/${dateStr}/mnav-${timestampStr}.json`;
		const latestKey = `mnav-snapshots/${network}/latest.json`;

		const jsonContent = JSON.stringify(result, null, 2);
		await Promise.all([
			env.POINTS_BACKUP_BUCKET.put(snapshotKey, jsonContent, {
				httpMetadata: { contentType: 'application/json' },
			}),
			env.POINTS_BACKUP_BUCKET.put(latestKey, jsonContent, {
				httpMetadata: { contentType: 'application/json' },
			}),
		]);
		console.log(`[mnav] Saved snapshot to ${snapshotKey}`);

		const elapsed = Date.now() - startTime;
		console.log(`[mnav] === mNAV Calculation Complete (${elapsed}ms) ===`);
		console.log(`[mnav] Total Assets: ${result.totalAssets} (${result.totalAssetsFormatted}, ${result.totalValueUsd})`);

		if (warnings.length > 0) {
			console.warn(`[mnav] Completed with ${warnings.length} warning(s):`);
			warnings.forEach((w) => console.warn(`[mnav]   - ${w}`));
		}

		return result;
	} catch (error) {
		console.error('[mnav] CRITICAL: mNAV calculation failed:', error);
		throw error;
	}
}
