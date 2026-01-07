/**
 * Uncap Price Feed Fetcher
 *
 * Fetches WBTC/USD price from Uncap's price feed oracle.
 */

import { RpcProvider, Contract } from 'starknet';
import { PRICE_FEED_ABI, STARKNET_ADDRESSES } from '../config';
import { Big, withRetry } from '../utils';
import type { PricesResult } from '../types';

export async function fetchPrices(rpcUrl: string): Promise<PricesResult> {
	console.log('[mnav] Fetching prices from Uncap oracle...');

	const provider = new RpcProvider({ nodeUrl: rpcUrl });

	const priceFeed = new Contract({
		abi: PRICE_FEED_ABI,
		address: STARKNET_ADDRESSES.WWBTC.priceFeed,
		providerOrAccount: provider,
	});

	const price = await withRetry(async () => {
		// get_price returns the cached price (view function)
		const result = await priceFeed.call('get_price', []);
		return result as bigint;
	}, 'WBTC price');

	const blockNumber = await provider.getBlockNumber();

	console.log(`[mnav] WBTC/USD price: ${price.toString()} (block ${blockNumber})`);

	return {
		prices: {
			wbtcUsd: Big(price.toString()),
		},
		blockNumber,
	};
}
