/**
 * Starknet Wallet Balance Fetcher
 *
 * Fetches WBTC, USDU, and USDC balances for curator wallet on Starknet.
 */

import { RpcProvider, Contract } from 'starknet';
import { ERC20_ABI, STARKNET_ADDRESSES } from '../config';
import { Big, withRetry } from '../utils';
import type { StarknetWalletResult } from '../types';

export async function fetchStarknetWallet(
	rpcUrl: string,
	curatorAddress: string
): Promise<StarknetWalletResult> {
	console.log('[mnav] Fetching Starknet wallet balances...');

	// Validate inputs upfront - return zero balances if not configured (skip retries)
	if (!rpcUrl || rpcUrl.trim() === '') {
		console.warn('[mnav] Starknet wallet: Skipping - STARKNET_RPC_URL not configured');
		return { wbtc: Big(0), usdu: Big(0), usdc: Big(0), blockNumber: 0 };
	}
	if (!curatorAddress || !/^0x[a-fA-F0-9]+$/.test(curatorAddress) || curatorAddress.length < 10) {
		console.warn(`[mnav] Starknet wallet: Skipping - CURATOR_STARKNET_ADDRESS invalid ("${curatorAddress}")`);
		return { wbtc: Big(0), usdu: Big(0), usdc: Big(0), blockNumber: 0 };
	}

	const provider = new RpcProvider({ nodeUrl: rpcUrl });

	const result = await withRetry(
		async () => {
			// Create contracts for each token
			const wbtcContract = new Contract({
				abi: ERC20_ABI,
				address: STARKNET_ADDRESSES.WWBTC.underlying,
				providerOrAccount: provider,
			});

			const usduContract = new Contract({
				abi: ERC20_ABI,
				address: STARKNET_ADDRESSES.USDU,
				providerOrAccount: provider,
			});

			const usdcContract = new Contract({
				abi: ERC20_ABI,
				address: STARKNET_ADDRESSES.USDC,
				providerOrAccount: provider,
			});

			// Fetch all balances in parallel
			const [wbtcBalance, usduBalance, usdcBalance, block] = await Promise.all([
				wbtcContract.call('balance_of', [curatorAddress]),
				usduContract.call('balance_of', [curatorAddress]),
				usdcContract.call('balance_of', [curatorAddress]),
				provider.getBlockNumber(),
			]);

			return { wbtcBalance, usduBalance, usdcBalance, block };
		},
		'Starknet wallet balances'
	);

	console.log(`[mnav] Starknet wallet - WBTC: ${result.wbtcBalance}, USDU: ${result.usduBalance}, USDC: ${result.usdcBalance} (block ${result.block})`);

	return {
		wbtc: Big(result.wbtcBalance.toString()),
		usdu: Big(result.usduBalance.toString()),
		usdc: Big(result.usdcBalance.toString()),
		blockNumber: result.block,
	};
}
