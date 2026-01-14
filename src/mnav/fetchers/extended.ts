/**
 * Extended Vault Position Fetcher
 *
 * Fetches the curator's position value from Extended exchange.
 * Extended is a perpetuals exchange on Starknet with a vault (XVS) product.
 *
 * API Docs: https://api.docs.extended.exchange/
 * Auth: X-Api-Key header
 */

import { Big } from '../utils';
import { DECIMALS, EXTENDED_CONFIG, getExtendedApiBase, type Network } from '../config';
import type { ExtendedPositionResult } from '../types';

/** Response from Extended /api/v1/user/spot/balances endpoint */
interface ExtendedSpotBalancesResponse {
	status: string;
	data: Array<{
		asset: string;
		notionalValue: string;
	}>;
}

/** Assets to include when summing balances */
const INCLUDED_ASSETS = ['USD', 'USDC', 'XVS'];

/**
 * Fetch the curator's position value from Extended exchange.
 *
 * @param apiKey - Extended API key for authentication
 * @param network - Network to fetch from (mainnet or sepolia)
 * @returns Position value in USD (6 decimals)
 */
export async function fetchExtendedPosition(apiKey: string, network: Network = 'mainnet'): Promise<ExtendedPositionResult> {
	if (!apiKey) {
		console.log('[extended] No API key provided, skipping Extended position');
		return { valueUsd: Big(0), rawResponse: null };
	}

	const baseUrl = getExtendedApiBase(network);
	const url = `${baseUrl}${EXTENDED_CONFIG.SPOT_BALANCES_ENDPOINT}`;
	console.log(`[extended] Fetching spot balances from ${url} (network: ${network})`);

	const response = await fetch(url, {
		method: 'GET',
		headers: {
			'X-Api-Key': apiKey,
			'User-Agent': 'mNAV-Calculator/1.0',
			Accept: 'application/json',
		},
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Extended API error ${response.status}: ${errorText}`);
	}

	const data = (await response.json()) as ExtendedSpotBalancesResponse;
	console.log('[extended] Raw response:', JSON.stringify(data, null, 2));

	// Sum notionalValue for USD, USDC, and XVS assets
	let totalUsd = Big(0);
	for (const balance of data.data) {
		if (INCLUDED_ASSETS.includes(balance.asset)) {
			totalUsd = totalUsd.plus(Big(balance.notionalValue));
		}
	}

	// Convert to 6-decimal raw format (like USDC)
	const valueUsd = totalUsd.times(Big(10).pow(DECIMALS.USDC));
	console.log(`[extended] Total value: ${totalUsd.toFixed(2)} USD`);

	return {
		valueUsd,
		rawResponse: data,
	};
}
