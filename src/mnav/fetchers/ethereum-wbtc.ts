/**
 * Ethereum WBTC Balance Fetcher
 *
 * Fetches WBTC balance for curator wallet on Ethereum Mainnet using viem.
 */

import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { ETHEREUM_ADDRESSES, WBTC_ERC20_ABI } from '../config';
import { Big, withRetry } from '../utils';
import type { EthereumWbtcResult } from '../types';

export async function fetchEthereumWbtcBalance(
	rpcUrl: string,
	curatorAddress: string
): Promise<EthereumWbtcResult> {
	console.log('[mnav] Fetching Ethereum WBTC balance...');

	// Validate inputs upfront - return zero balance if not configured (skip retries)
	if (!rpcUrl || rpcUrl.trim() === '') {
		console.warn('[mnav] Ethereum WBTC: Skipping - ETHEREUM_RPC_URL not configured');
		return { balance: Big(0), blockNumber: 0 };
	}
	if (!curatorAddress || !/^0x[a-fA-F0-9]{40}$/.test(curatorAddress)) {
		console.warn(`[mnav] Ethereum WBTC: Skipping - CURATOR_ETH_ADDRESS invalid ("${curatorAddress}")`);
		return { balance: Big(0), blockNumber: 0 };
	}

	const client = createPublicClient({
		chain: mainnet,
		transport: http(rpcUrl),
	});

	const [balance, blockNumber] = await withRetry(
		async () => {
			const bal = await client.readContract({
				address: ETHEREUM_ADDRESSES.WBTC,
				abi: WBTC_ERC20_ABI,
				functionName: 'balanceOf',
				args: [curatorAddress as `0x${string}`],
			});

			const block = await client.getBlockNumber();

			return [bal, block] as const;
		},
		'Ethereum WBTC balance'
	);

	console.log(`[mnav] Ethereum WBTC balance: ${balance.toString()} (block ${blockNumber})`);

	return {
		balance: Big(balance.toString()),
		blockNumber: Number(blockNumber),
	};
}
