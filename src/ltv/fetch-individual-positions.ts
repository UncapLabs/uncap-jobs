/**
 * Individual Position Fetcher for LTV Monitoring
 *
 * Adapted from web app's position fetching logic.
 * Returns individual trove positions (not aggregated) for LTV alerts.
 */

import { RpcProvider, Contract } from 'starknet';
import {
	TROVE_MANAGER_ABI,
	MNAV_CONFIG,
	getAllBranches,
	type Network,
} from '../mnav/config';
import { Big, withRetry } from '../mnav/utils';

/** Display names for each collateral type */
export const COLLATERAL_DISPLAY_NAMES: Record<string, string> = {
	WWBTC: 'WBTC',
	TBTC: 'tBTC',
	SOLVBTC: 'SolvBTC',
};

/** Branch ID to internal name mapping */
const BRANCH_NAMES: Record<number, string> = {
	0: 'WWBTC',
	1: 'TBTC',
	2: 'SOLVBTC',
};

/** Individual trove position */
export interface TrovePosition {
	/** Unique identifier: "branchId:troveId" */
	id: string;
	/** Short display ID (last 8 chars of trove ID) */
	shortId: string;
	/** Internal branch name (WWBTC, TBTC, SOLVBTC) */
	branch: string;
	/** Display name (WBTC, tBTC, SolvBTC) */
	displayName: string;
	/** Collateral amount (Big.js, 18 decimals) */
	collateral: Big;
	/** Debt amount (Big.js, 18 decimals) */
	debt: Big;
}

export interface IndividualPositionsResult {
	positions: TrovePosition[];
	blockNumber: number;
}

interface IndexedTrove {
	troveId: string;
	status: string;
}

/**
 * Check if a string is a valid prefixed trove ID (format: "branchId:troveId")
 */
function isPrefixedTroveId(id: string | null | undefined): id is string {
	if (!id) return false;
	const parts = id.split(':');
	return parts.length === 2 && !isNaN(parseInt(parts[0], 10));
}

/**
 * Parse prefixed trove ID (format: "branchId:troveId").
 */
function parsePrefixedTroveId(prefixedId: string): { branchId: number; troveId: bigint; troveIdHex: string } {
	const parts = prefixedId.split(':');
	if (parts.length === 2) {
		return {
			branchId: parseInt(parts[0], 10),
			troveId: BigInt(parts[1]),
			troveIdHex: parts[1],
		};
	}
	return {
		branchId: 0,
		troveId: BigInt(prefixedId),
		troveIdHex: prefixedId,
	};
}

/**
 * Query GraphQL indexer to get all active trove IDs for a borrower.
 */
async function getIndexedTrovesByAccount(curatorAddress: string, network: Network): Promise<IndexedTrove[]> {
	const indexerName = network === 'mainnet' ? 'mainnet' : 'sepolia';

	// Query both as borrower and as previous owner (for liquidated positions)
	const query = `
		query TrovesAsBorrower($account: String!, $indexer: String!) {
			troves(
				where: { borrower: $account, _indexer: $indexer }
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
				indexer: indexerName,
			},
		}),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`GraphQL request failed: ${response.status} - ${text}`);
	}

	const data = (await response.json()) as { data?: { troves?: IndexedTrove[] }; errors?: unknown[] };

	if (data.errors) {
		throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
	}

	return data.data?.troves ?? [];
}

/**
 * Fetch individual trove positions for LTV monitoring.
 * Only fetches active troves (skips closed, liquidated, etc.)
 */
export async function fetchIndividualPositions(
	rpcUrl: string,
	curatorAddress: string,
	network: Network
): Promise<IndividualPositionsResult> {
	console.log(`[ltv-fetch] Fetching individual positions (${network})...`);

	if (!rpcUrl || rpcUrl.trim() === '') {
		console.warn('[ltv-fetch] Skipping - STARKNET_RPC_URL not configured');
		return { positions: [], blockNumber: 0 };
	}
	if (!curatorAddress || !/^0x[a-fA-F0-9]+$/.test(curatorAddress) || curatorAddress.length < 10) {
		console.warn(`[ltv-fetch] Skipping - CURATOR_STARKNET_ADDRESS invalid`);
		return { positions: [], blockNumber: 0 };
	}

	const provider = new RpcProvider({ nodeUrl: rpcUrl });
	const branches = getAllBranches(network);

	// Get all troves from indexer
	let allTroves: IndexedTrove[] = [];
	try {
		console.log('[ltv-fetch] Querying indexer for curator troves...');
		allTroves = await withRetry(() => getIndexedTrovesByAccount(curatorAddress, network), 'Indexer query');
		console.log(`[ltv-fetch] Found ${allTroves.length} total troves`);
	} catch (error) {
		console.warn('[ltv-fetch] Indexer failed:', error);
		return { positions: [], blockNumber: 0 };
	}

	// Filter to only active troves
	const activeTroves = allTroves.filter((t) => t.status === 'active');
	console.log(`[ltv-fetch] ${activeTroves.length} active troves (skipping ${allTroves.length - activeTroves.length} non-active)`);

	// Fetch on-chain data for each active trove
	const positions: TrovePosition[] = [];

	for (const trove of activeTroves) {
		const prefixedId = trove.troveId;

		if (!isPrefixedTroveId(prefixedId)) {
			console.warn(`[ltv-fetch] Invalid prefixed trove ID: ${prefixedId}`);
			continue;
		}

		const { branchId, troveId, troveIdHex } = parsePrefixedTroveId(prefixedId);
		const branchName = BRANCH_NAMES[branchId] || `UNKNOWN_${branchId}`;
		const branch = branches.find((b) => b.branchId === branchId);

		if (!branch?.troveManager) {
			console.warn(`[ltv-fetch] No trove manager for branch ${branchId}`);
			continue;
		}

		const troveManager = new Contract({
			abi: TROVE_MANAGER_ABI,
			address: branch.troveManager,
			providerOrAccount: provider,
		});

		try {
			const troveData = await withRetry(async () => {
				const result = await troveManager.call('get_latest_trove_data', [troveId]);
				return result as {
					entire_debt: bigint;
					entire_coll: bigint;
				};
			}, `Trove ${prefixedId} data`);

			// Skip positions with no debt and no collateral
			if (troveData.entire_debt === 0n && troveData.entire_coll === 0n) {
				console.log(`[ltv-fetch] Skipping ${prefixedId} - zero debt and collateral`);
				continue;
			}

			const shortId = troveIdHex.length > 8 ? troveIdHex.slice(-8) : troveIdHex;

			positions.push({
				id: prefixedId,
				shortId,
				branch: branchName,
				displayName: COLLATERAL_DISPLAY_NAMES[branchName] || branchName,
				collateral: Big(troveData.entire_coll.toString()),
				debt: Big(troveData.entire_debt.toString()),
			});

			const collFormatted = Big(troveData.entire_coll.toString()).div(Big(1e18)).toFixed(5);
			const debtFormatted = Big(troveData.entire_debt.toString()).div(Big(1e18)).toFixed(2);
			console.log(`[ltv-fetch] ${branchName} #${shortId} - coll: ${collFormatted}, debt: ${debtFormatted}`);
		} catch (error) {
			console.error(`[ltv-fetch] Failed to fetch trove ${prefixedId}:`, error);
		}
	}

	const blockNumber = await provider.getBlockNumber();

	console.log(`[ltv-fetch] Fetched ${positions.length} active positions`);

	return { positions, blockNumber };
}
