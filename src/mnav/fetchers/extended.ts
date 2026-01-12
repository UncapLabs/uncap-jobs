/**
 * Extended Vault Position Fetcher
 *
 * Fetches the curator's position value from Extended exchange.
 * Extended is a perpetuals exchange on Starknet with a vault (XVS) product.
 *
 * API: https://api.starknet.extended.exchange/api/v1/user/spot/balances
 * Auth: X-Api-Key header
 */

import { Big } from '../utils';
import { DECIMALS, EXTENDED_CONFIG } from '../config';
import type { ExtendedPositionResult } from '../types';

/**
 * Expected response format from Extended API.
 * Note: This endpoint is not publicly documented, so we handle multiple formats.
 */
interface ExtendedBalanceResponse {
	// Format 1: Simple balance object
	balance?: string | number;
	// Format 2: Array of balances
	balances?: Array<{
		asset?: string;
		currency?: string;
		balance?: string | number;
		amount?: string | number;
		value?: string | number;
	}>;
	// Format 3: Nested data
	data?: {
		balance?: string | number;
		balances?: Array<{
			asset?: string;
			currency?: string;
			balance?: string | number;
			amount?: string | number;
			value?: string | number;
		}>;
	};
	// Common fields
	total?: string | number;
	totalValue?: string | number;
	equity?: string | number;
}

/**
 * Fetch the curator's position value from Extended exchange.
 *
 * @param apiKey - Extended API key for authentication
 * @returns Position value in USD (6 decimals)
 */
export async function fetchExtendedPosition(apiKey: string): Promise<ExtendedPositionResult> {
	if (!apiKey) {
		console.log('[extended] No API key provided, skipping Extended position');
		return { valueUsd: Big(0), rawResponse: null };
	}

	const url = `${EXTENDED_CONFIG.API_BASE}${EXTENDED_CONFIG.SPOT_BALANCES_ENDPOINT}`;
	console.log(`[extended] Fetching spot balances from ${url}`);

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

	const data = (await response.json()) as ExtendedBalanceResponse;
	console.log('[extended] Raw response:', JSON.stringify(data, null, 2));

	// Parse the response - try multiple formats since endpoint is undocumented
	const valueUsd = parseExtendedBalance(data);

	console.log(`[extended] Parsed value: ${valueUsd.toFixed(DECIMALS.USDC)} USD`);

	return {
		valueUsd,
		rawResponse: data,
	};
}

/**
 * Parse Extended API response to extract USD value.
 * Handles multiple possible response formats.
 */
function parseExtendedBalance(data: ExtendedBalanceResponse): Big {
	// Try direct total/equity fields first
	if (data.totalValue !== undefined) {
		return parseToBig(data.totalValue);
	}
	if (data.total !== undefined) {
		return parseToBig(data.total);
	}
	if (data.equity !== undefined) {
		return parseToBig(data.equity);
	}
	if (data.balance !== undefined) {
		return parseToBig(data.balance);
	}

	// Try nested data object
	if (data.data) {
		if (data.data.balance !== undefined) {
			return parseToBig(data.data.balance);
		}
		if (data.data.balances && data.data.balances.length > 0) {
			return sumBalances(data.data.balances);
		}
	}

	// Try balances array
	if (data.balances && data.balances.length > 0) {
		return sumBalances(data.balances);
	}

	console.warn('[extended] Could not parse balance from response, returning 0');
	return Big(0);
}

/**
 * Sum balances from an array, filtering for USD-denominated assets.
 */
function sumBalances(
	balances: Array<{
		asset?: string;
		currency?: string;
		balance?: string | number;
		amount?: string | number;
		value?: string | number;
	}>
): Big {
	let total = Big(0);

	for (const item of balances) {
		const asset = (item.asset || item.currency || '').toUpperCase();
		// Include USDC, USD, XVS (vault shares), or any USD-denominated value
		if (asset === 'USDC' || asset === 'USD' || asset === 'XVS' || asset === '') {
			const value = item.value ?? item.balance ?? item.amount;
			if (value !== undefined) {
				total = total.plus(parseToBig(value));
			}
		}
	}

	return total;
}

/**
 * Parse string or number to Big, handling decimals appropriately.
 * Assumes value is in human-readable format (e.g., "1000.50" for $1000.50).
 * Converts to 6-decimal raw format for consistency with USDC.
 */
function parseToBig(value: string | number): Big {
	const num = Big(value.toString());
	// Convert to 6 decimal raw format (like USDC)
	return num.times(Big(10).pow(DECIMALS.USDC));
}
