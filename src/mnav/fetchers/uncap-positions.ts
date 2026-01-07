/**
 * Uncap Protocol Positions Fetcher
 *
 * Fetches trove positions (collateral + debt) and stability pool position.
 * Uses indexer to find curator's troves, with full scan fallback.
 * Always fetches fresh position data via RPC.
 */

import { RpcProvider, Contract } from 'starknet';
import {
	TROVE_MANAGER_ABI,
	TROVE_NFT_ABI,
	STABILITY_POOL_ABI,
	STARKNET_ADDRESSES,
	MNAV_CONFIG,
} from '../config';
import { Big, withRetry } from '../utils';
import type { UncapPositionsResult } from '../types';

// Import AddressesRegistry ABI for getting TroveNFT address
import AddressesRegistryAbi from '../abis/AddressesRegistry.json';
import type { Abi } from 'starknet';
const ADDRESSES_REGISTRY_ABI = AddressesRegistryAbi as Abi;

interface TroveFromIndexer {
	troveId: string;
	status: string;
}

/**
 * Convert a bigint to a 0x-prefixed hex string (Starknet address format).
 */
function bigintToHex(value: bigint): string {
	return '0x' + value.toString(16);
}

/**
 * Parse prefixed trove ID (format: "branchId:troveId") and return just the trove ID as bigint.
 */
function parseTroveId(prefixedId: string): bigint {
	// Format: "0:0x247d565f..." -> extract the hex part after the colon
	const parts = prefixedId.split(':');
	const troveIdHex = parts.length > 1 ? parts[1] : prefixedId;
	return BigInt(troveIdHex);
}

/**
 * Query GraphQL indexer to get all active trove IDs for a borrower.
 */
async function getTroveIdsFromIndexer(curatorAddress: string): Promise<string[]> {
	// Query format matching frontend: uses borrower field and indexer parameter
	const query = `
		query TrovesAsBorrower($account: String!, $indexer: String!) {
			troves(
				where: { borrower: $account, status_in: ["active", "redeemed"], _indexer: $indexer }
			) {
				troveId
				status
			}
		}
	`;

	const response = await fetch(MNAV_CONFIG.UNCAP_GRAPHQL_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			query,
			variables: {
				account: curatorAddress.toLowerCase(),
				indexer: 'mainnet', // Assuming mainnet, adjust if needed
			},
		}),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`GraphQL request failed: ${response.status} - ${text}`);
	}

	const data = (await response.json()) as { data?: { troves?: TroveFromIndexer[] }; errors?: unknown[] };

	if (data.errors) {
		throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
	}

	const troves = data.data?.troves ?? [];
	// Only return active troves (status === 'active')
	return troves.filter((t) => t.status === 'active').map((t) => t.troveId);
}

/**
 * Full scan fallback: iterate through all troves and find ones owned by curator.
 */
async function getTroveIdsByFullScan(
	provider: RpcProvider,
	troveManager: Contract,
	troveNftAddress: string,
	curatorAddress: string
): Promise<string[]> {
	const troveNft = new Contract({
		abi: TROVE_NFT_ABI,
		address: troveNftAddress,
		providerOrAccount: provider,
	});

	// Get total trove count
	const count = await troveManager.call('get_trove_ids_count', []);
	const totalTroves = Number(count);
	console.log(`[mnav] Full scan: checking ${totalTroves} troves...`);

	const curatorTroveIds: string[] = [];
	const normalizedCurator = curatorAddress.toLowerCase();

	for (let i = 0; i < totalTroves; i++) {
		// Get trove ID at this index
		const troveId = await troveManager.call('get_trove_from_trove_ids_array', [i]);
		const troveIdStr = (troveId as bigint).toString();

		// Check owner - RPC returns bigint, convert to hex for comparison
		const ownerRaw = await troveNft.call('get_trove_owner', [troveIdStr]);
		const ownerHex = bigintToHex(ownerRaw as bigint).toLowerCase();

		if (ownerHex === normalizedCurator) {
			curatorTroveIds.push(troveIdStr);
			console.log(`[mnav] Found curator trove: ${troveIdStr}`);
		}
	}

	return curatorTroveIds;
}

export async function fetchUncapPositions(
	rpcUrl: string,
	curatorAddress: string
): Promise<UncapPositionsResult> {
	console.log('[mnav] Fetching Uncap positions...');

	// Validate inputs upfront - return empty positions if not configured (skip retries)
	if (!rpcUrl || rpcUrl.trim() === '') {
		console.warn('[mnav] Uncap positions: Skipping - STARKNET_RPC_URL not configured');
		return {
			positions: {
				collateral: Big(0),
				debt: Big(0),
				stabilityPool: { usdu: Big(0), usduYieldGain: Big(0), collateralGain: Big(0), stashedColl: Big(0) },
			},
			blockNumber: 0,
		};
	}
	if (!curatorAddress || !/^0x[a-fA-F0-9]+$/.test(curatorAddress) || curatorAddress.length < 10) {
		console.warn(`[mnav] Uncap positions: Skipping - CURATOR_STARKNET_ADDRESS invalid ("${curatorAddress}")`);
		return {
			positions: {
				collateral: Big(0),
				debt: Big(0),
				stabilityPool: { usdu: Big(0), usduYieldGain: Big(0), collateralGain: Big(0), stashedColl: Big(0) },
			},
			blockNumber: 0,
		};
	}

	const provider = new RpcProvider({ nodeUrl: rpcUrl });

	const troveManager = new Contract({
		abi: TROVE_MANAGER_ABI,
		address: STARKNET_ADDRESSES.WWBTC.troveManager,
		providerOrAccount: provider,
	});

	const stabilityPool = new Contract({
		abi: STABILITY_POOL_ABI,
		address: STARKNET_ADDRESSES.WWBTC.stabilityPool,
		providerOrAccount: provider,
	});

	// Try indexer first, fall back to full scan
	let troveIds: string[] = [];

	try {
		console.log('[mnav] Trying indexer to find curator troves...');
		troveIds = await withRetry(() => getTroveIdsFromIndexer(curatorAddress), 'Indexer query');
		console.log(`[mnav] Indexer found ${troveIds.length} troves`);
	} catch (indexerError) {
		console.warn('[mnav] Indexer failed, falling back to full scan:', indexerError);
	}

	// If indexer returned nothing, try full scan
	if (troveIds.length === 0) {
		console.log('[mnav] No troves from indexer, attempting full scan...');

		// Get TroveNFT address from AddressesRegistry
		const addressesRegistry = new Contract({
			abi: ADDRESSES_REGISTRY_ABI,
			address: STARKNET_ADDRESSES.WWBTC.addressesRegistry,
			providerOrAccount: provider,
		});

		const troveNftAddressRaw = await addressesRegistry.call('get_trove_nft', []);
		const troveNftAddress = bigintToHex(troveNftAddressRaw as bigint);
		console.log(`[mnav] TroveNFT address: ${troveNftAddress}`);

		troveIds = await getTroveIdsByFullScan(provider, troveManager, troveNftAddress, curatorAddress);
	}

	console.log(`[mnav] Total troves to fetch: ${troveIds.length}`);

	// Fetch fresh position data for each trove via RPC
	let totalCollateral = Big(0);
	let totalDebt = Big(0);

	for (const troveId of troveIds) {
		// Parse the prefixed trove ID (format: "branchId:troveIdHex") to get the actual trove ID as bigint
		const troveIdBigInt = parseTroveId(troveId);

		const troveData = await withRetry(async () => {
			const result = await troveManager.call('get_latest_trove_data', [troveIdBigInt]);
			return result as {
				entire_debt: bigint;
				entire_coll: bigint;
			};
		}, `Trove ${troveId} data`);

		console.log(`[mnav] Trove ${troveId} (parsed: ${troveIdBigInt}) - coll: ${troveData.entire_coll}, debt: ${troveData.entire_debt}`);

		totalCollateral = totalCollateral.plus(Big(troveData.entire_coll.toString()));
		totalDebt = totalDebt.plus(Big(troveData.entire_debt.toString()));
	}

	// Fetch stability pool position (always by address, not trove)
	const spData = await withRetry(async () => {
		const deposit = await stabilityPool.call('get_compounded_usdu_deposit', [curatorAddress]);
		const yieldGain = await stabilityPool.call('get_depositor_yield_gain', [curatorAddress]);
		const collGain = await stabilityPool.call('get_depositor_coll_gain', [curatorAddress]);
		const stashedColl = await stabilityPool.call('get_stashed_coll', [curatorAddress]);

		return {
			deposit: deposit as bigint,
			yieldGain: yieldGain as bigint,
			collGain: collGain as bigint,
			stashedColl: stashedColl as bigint,
		};
	}, 'Stability pool data');

	const blockNumber = await provider.getBlockNumber();

	console.log(`[mnav] Total troves - collateral: ${totalCollateral}, debt: ${totalDebt}`);
	console.log(`[mnav] SP - deposit: ${spData.deposit}, yieldGain: ${spData.yieldGain}, collGain: ${spData.collGain}`);

	return {
		positions: {
			collateral: totalCollateral,
			debt: totalDebt,
			stabilityPool: {
				usdu: Big(spData.deposit.toString()),
				usduYieldGain: Big(spData.yieldGain.toString()),
				collateralGain: Big(spData.collGain.toString()),
				stashedColl: Big(spData.stashedColl.toString()),
			},
		},
		blockNumber,
	};
}
