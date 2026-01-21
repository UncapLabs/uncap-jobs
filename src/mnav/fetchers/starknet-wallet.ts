/**
 * Starknet Wallet Balance Fetcher
 *
 * Fetches WBTC, USDU, USDC, and USDC.e balances for curator wallet on Starknet.
 */

import { RpcProvider, Contract } from 'starknet';
import { ERC20_ABI, getStarknetAddresses, type Network } from '../config';
import { Big, withRetry } from '../utils';
import type { StarknetWalletResult } from '../types';

export async function fetchStarknetWallet(
	rpcUrl: string,
	curatorAddress: string,
	network: Network
): Promise<StarknetWalletResult> {
	console.log(`[mnav] Fetching Starknet wallet balances (${network})...`);

	// Validate inputs upfront - return zero balances if not configured (skip retries)
	if (!rpcUrl || rpcUrl.trim() === '') {
		console.warn('[mnav] Starknet wallet: Skipping - STARKNET_RPC_URL not configured');
		return { wbtc: Big(0), usdu: Big(0), usdc: Big(0), usdcE: Big(0), blockNumber: 0 };
	}
	if (!curatorAddress || !/^0x[a-fA-F0-9]+$/.test(curatorAddress) || curatorAddress.length < 10) {
		console.warn(`[mnav] Starknet wallet: Skipping - CURATOR_STARKNET_ADDRESS invalid ("${curatorAddress}")`);
		return { wbtc: Big(0), usdu: Big(0), usdc: Big(0), usdcE: Big(0), blockNumber: 0 };
	}

	const addresses = getStarknetAddresses(network);
	const provider = new RpcProvider({ nodeUrl: rpcUrl });

	// Get underlying WBTC address (only available in WWBTC branch)
	const wbtcAddress = addresses.branches.WWBTC.underlying;
	if (!wbtcAddress) {
		console.warn('[mnav] Starknet wallet: No underlying WBTC address configured');
		return { wbtc: Big(0), usdu: Big(0), usdc: Big(0), usdcE: Big(0), blockNumber: 0 };
	}

	const result = await withRetry(
		async () => {
			// Create contracts for each token
			const wbtcContract = new Contract({
				abi: ERC20_ABI,
				address: wbtcAddress,
				providerOrAccount: provider,
			});

			const usduContract = new Contract({
				abi: ERC20_ABI,
				address: addresses.USDU,
				providerOrAccount: provider,
			});

			// USDC may not be available on sepolia
			let usdcBalance: bigint = BigInt(0);
			if (addresses.USDC) {
				const usdcContract = new Contract({
					abi: ERC20_ABI,
					address: addresses.USDC,
					providerOrAccount: provider,
				});
				usdcBalance = (await usdcContract.call('balance_of', [curatorAddress])) as bigint;
			}

			// USDC.e may not be available on sepolia
			let usdcEBalance: bigint = BigInt(0);
			if (addresses.USDC_E) {
				const usdcEContract = new Contract({
					abi: ERC20_ABI,
					address: addresses.USDC_E,
					providerOrAccount: provider,
				});
				usdcEBalance = (await usdcEContract.call('balance_of', [curatorAddress])) as bigint;
			}

			// Fetch balances
			const [wbtcBalance, usduBalance, block] = await Promise.all([
				wbtcContract.call('balance_of', [curatorAddress]),
				usduContract.call('balance_of', [curatorAddress]),
				provider.getBlockNumber(),
			]);

			return {
				wbtcBalance: wbtcBalance as bigint,
				usduBalance: usduBalance as bigint,
				usdcBalance,
				usdcEBalance,
				block,
			};
		},
		'Starknet wallet balances'
	);

	console.log(
		`[mnav] Starknet wallet - WBTC: ${result.wbtcBalance}, USDU: ${result.usduBalance}, USDC: ${result.usdcBalance}, USDC.e: ${result.usdcEBalance} (block ${result.block})`
	);

	return {
		wbtc: Big(result.wbtcBalance.toString()),
		usdu: Big(result.usduBalance.toString()),
		usdc: Big(result.usdcBalance.toString()),
		usdcE: Big(result.usdcEBalance.toString()),
		blockNumber: result.block,
	};
}
