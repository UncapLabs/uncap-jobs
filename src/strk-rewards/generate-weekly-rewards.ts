/**
 * Job to generate weekly STRK rewards and upload to R2
 * Runs weekly on Thursday at 4 PM UTC
 * Processes data for the previous week (Thursday-Wednesday)
 *
 * Data sources:
 * - SNF API: Pool-level daily allocations for Uncap protocol
 * - Dune Query 6474138: Per-user daily positions
 */

// SNF API response types
interface SNFLendingItem {
	date: string;
	protocol: string;
	market_address: string;
	market_name: string;
	asset_symbol: string;
	total_supply_tokens: string;
	total_supply_usd: string;
	total_borrow_tokens: string;
	total_borrow_usd: string;
	incentive_usd: string;
	allocated_tokens: string;
	effective_apr: string;
}

interface SNFBorrowingItem {
	date: string;
	protocol: string;
	market_address: string;
	market_name: string;
	collateral_symbol: string | null;
	debt_asset_symbol: string;
	debt_asset: string;
	total_borrow_tokens: string;
	total_borrow_usd: string;
	total_supply_usd: string;
	interest_usd_daily: string;
	incentive_usd: string;
	allocated_tokens: string;
	effective_apr: string;
}

interface SNFResponse<T> {
	items: T[];
}

// Dune query response types
interface DuneUserPosition {
	branch_id?: string; // 'WBTC' | 'solvBTC' | 'tBTC'
	user: string;
	date: string;
	total_supplied_usd: number;
	interest_usd_daily: number;
}

interface DuneResult<T> {
	result?: {
		rows?: T[];
	};
}

interface RewardAllocation {
	address: string;
	amount: string; // 18 decimal format (wei)
}

// Pool daily data from SNF (allocations only - totals come from Dune)
// Map is keyed by "date|BRANCH" (e.g., "2026-01-19|WBTC")
interface PoolDailyData {
	supplyAllocation: number;
	borrowAllocation: number;
}

const SNF_LENDING_URL = "https://5xyjxn0qoe.execute-api.eu-west-1.amazonaws.com/prod/mm-lending";
const SNF_BORROWING_URL = "https://5xyjxn0qoe.execute-api.eu-west-1.amazonaws.com/prod/mm-borrowing";
const PROTOCOL = "Uncap";

// Week 1 starts on Thursday Nov 13, 2025
const WEEK_1_START = new Date("2025-11-13T00:00:00Z");

// TBTC and SOLVBTC positions are only included starting from this date
const MULTI_BRANCH_START_DATE = "2026-01-20";

type DuneBindings = {
	DUNE_API_KEY?: string;
	DUNE_QUERY_STRK_REWARDS_ID?: string;
};

/**
 * Calculate which week number we're currently in
 */
function getCurrentWeekNumber(now: Date): number {
	const diffMs = now.getTime() - WEEK_1_START.getTime();
	const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
	const weekNumber = Math.floor(diffDays / 7) + 1;
	return weekNumber;
}

/**
 * Calculate start and end dates for a given week number
 */
function getWeekDates(weekNumber: number): { startDate: string; endDate: string } {
	if (weekNumber < 1) {
		throw new Error("Week number must be >= 1");
	}

	const daysOffset = (weekNumber - 1) * 7;
	const startDate = new Date(WEEK_1_START);
	startDate.setUTCDate(WEEK_1_START.getUTCDate() + daysOffset);

	const endDate = new Date(startDate);
	endDate.setUTCDate(startDate.getUTCDate() + 6);

	const formatDate = (d: Date) => d.toISOString().split("T")[0];

	return {
		startDate: formatDate(startDate),
		endDate: formatDate(endDate),
	};
}

/**
 * Convert STRK amount to 18 decimal format (wei)
 */
function toWei(amount: number): string {
	const amountStr = amount.toString();
	const [whole = "0", fractional = ""] = amountStr.split(".");
	const fractionalPadded = fractional.padEnd(18, "0").slice(0, 18);
	const weiStr = whole + fractionalPadded;
	return BigInt(weiStr).toString();
}

/**
 * Fetch SNF data (both lending and borrowing)
 * Returns pool-level allocations for each day (totals come from Dune)
 */
async function fetchSNFPoolData(
	startDate: string,
	endDate: string,
): Promise<Map<string, PoolDailyData>> {
	console.log("[weekly-rewards] Fetching SNF pool data...");

	const [lendingRes, borrowRes] = await Promise.all([fetch(SNF_LENDING_URL), fetch(SNF_BORROWING_URL)]);

	if (!lendingRes.ok) {
		throw new Error(`SNF lending API failed: ${lendingRes.status} ${lendingRes.statusText}`);
	}
	if (!borrowRes.ok) {
		throw new Error(`SNF borrowing API failed: ${borrowRes.status} ${borrowRes.statusText}`);
	}

	const lendingData: SNFResponse<SNFLendingItem> = await lendingRes.json();
	const borrowData: SNFResponse<SNFBorrowingItem> = await borrowRes.json();

	// Build daily data map (allocations only)
	const poolData = new Map<string, PoolDailyData>();

	// Process lending data - keyed by date|branch using asset_symbol
	for (const item of lendingData.items) {
		if (item.protocol !== PROTOCOL) continue;
		if (item.date < startDate || item.date > endDate) continue;

		const branch = item.asset_symbol?.toUpperCase() || "WBTC";
		const key = `${item.date}|${branch}`;
		const existing = poolData.get(key) || {
			supplyAllocation: 0,
			borrowAllocation: 0,
		};
		existing.supplyAllocation += parseFloat(item.allocated_tokens);
		poolData.set(key, existing);
	}

	// Process borrowing data - keyed by date|branch using collateral_symbol
	for (const item of borrowData.items) {
		if (item.protocol !== PROTOCOL) continue;
		if (item.date < startDate || item.date > endDate) continue;

		const branch = item.collateral_symbol?.toUpperCase() || "WBTC";
		const key = `${item.date}|${branch}`;
		const existing = poolData.get(key) || {
			supplyAllocation: 0,
			borrowAllocation: 0,
		};
		existing.borrowAllocation += parseFloat(item.allocated_tokens);
		poolData.set(key, existing);
	}

	console.log(`[weekly-rewards] SNF pool data: ${poolData.size} days`);
	return poolData;
}

/**
 * Fetch per-user positions from Dune
 */
async function fetchUserPositions(
	queryId: string,
	apiKey: string,
	startDate: string,
	endDate: string,
): Promise<DuneUserPosition[]> {
	console.log("[weekly-rewards] Fetching user positions from Dune...");

	const url = new URL(`https://api.dune.com/api/v1/query/${queryId}/results`);
	url.searchParams.set("limit", "5000");

	const response = await fetch(url.toString(), {
		headers: {
			"X-Dune-API-Key": apiKey,
			Accept: "application/json",
		},
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Dune API failed: ${response.status} ${response.statusText} – ${body}`);
	}

	const data: DuneResult<DuneUserPosition> = await response.json();
	const allRows = data.result?.rows ?? [];

	// Filter by date range (client-side)
	const dateFilteredRows = allRows.filter((row) => row.date >= startDate && row.date <= endDate);

	// Filter TBTC and SOLVBTC positions: only include them starting from MULTI_BRANCH_START_DATE
	const filteredRows = dateFilteredRows.filter((row) => {
		const branchId = row.branch_id?.toUpperCase();
		// Always include WBTC positions (or positions without branch_id for backwards compatibility)
		if (!branchId || branchId === "WBTC") {
			return true;
		}
		// TBTC and SOLVBTC positions only included from MULTI_BRANCH_START_DATE onwards
		if (branchId === "TBTC" || branchId === "SOLVBTC") {
			return row.date >= MULTI_BRANCH_START_DATE;
		}
		// Include any other branch types by default
		return true;
	});

	console.log(
		`[weekly-rewards] Dune: fetched ${allRows.length} total rows, ${dateFilteredRows.length} in date range, ${filteredRows.length} after branch filtering`,
	);
	return filteredRows;
}

/**
 * Calculate per-user rewards based on proportional allocation
 * Uses Dune-summed totals as denominators (matching OBL methodology)
 * Now processes per date|branch to match SNF's per-collateral allocations
 */
function calculateUserRewards(
	poolData: Map<string, PoolDailyData>,
	userPositions: DuneUserPosition[],
): Map<string, number> {
	// Group user positions by date|branch key
	const positionsByKey = new Map<string, DuneUserPosition[]>();
	for (const pos of userPositions) {
		const branch = pos.branch_id?.toUpperCase() || "WBTC";
		const key = `${pos.date}|${branch}`;
		const existing = positionsByKey.get(key) || [];
		existing.push(pos);
		positionsByKey.set(key, existing);
	}

	// Compute totals per date|branch (used as denominators)
	const totalsByKey = new Map<string, { totalSupplyUsd: number; totalInterestUsd: number }>();
	for (const [key, positions] of positionsByKey) {
		let totalSupplyUsd = 0;
		let totalInterestUsd = 0;
		for (const pos of positions) {
			totalSupplyUsd += Math.max(pos.total_supplied_usd || 0, 0);
			totalInterestUsd += Math.max(pos.interest_usd_daily || 0, 0);
		}
		totalsByKey.set(key, { totalSupplyUsd, totalInterestUsd });
	}

	// Track total rewards per user
	const userRewards = new Map<string, number>();

	// Process each date|branch
	for (const [key, pool] of poolData) {
		const positions = positionsByKey.get(key) || [];
		const totals = totalsByKey.get(key);
		if (positions.length === 0 || !totals) {
			console.log(`[weekly-rewards] No user positions for ${key}, skipping`);
			continue;
		}

		console.log(
			`[weekly-rewards] ${key}: ${positions.length} users, supply_alloc=${pool.supplyAllocation.toFixed(2)}, borrow_alloc=${pool.borrowAllocation.toFixed(2)}, total_supply=$${totals.totalSupplyUsd.toFixed(2)}, total_interest=$${totals.totalInterestUsd.toFixed(2)}`,
		);

		// Calculate each user's share for this day/branch using Dune-summed totals
		for (const pos of positions) {
			const userSupplyUsd = Math.max(pos.total_supplied_usd || 0, 0);
			const userInterestUsd = Math.max(pos.interest_usd_daily || 0, 0);

			let reward = 0;

			// Supply reward: user_share = user_supply / total_supply
			if (pool.supplyAllocation > 0 && totals.totalSupplyUsd > 0 && userSupplyUsd > 0) {
				const supplyShare = userSupplyUsd / totals.totalSupplyUsd;
				reward += pool.supplyAllocation * supplyShare;
			}

			// Borrow reward: user_share = user_interest / total_interest
			if (pool.borrowAllocation > 0 && totals.totalInterestUsd > 0 && userInterestUsd > 0) {
				const borrowShare = userInterestUsd / totals.totalInterestUsd;
				reward += pool.borrowAllocation * borrowShare;
			}

			if (reward > 0) {
				const address = pos.user.toLowerCase();
				const current = userRewards.get(address) || 0;
				userRewards.set(address, current + reward);
			}
		}
	}

	console.log(`[weekly-rewards] Calculated rewards for ${userRewards.size} unique users`);
	return userRewards;
}

/**
 * Generate reward allocation JSON
 */
function generateRewardJSON(userRewards: Map<string, number>): RewardAllocation[] {
	const rewards: RewardAllocation[] = [];
	let totalSTRK = 0;

	for (const [address, amount] of userRewards.entries()) {
		if (amount <= 0) continue;

		rewards.push({
			address,
			amount: toWei(amount),
		});

		totalSTRK += amount;
	}

	rewards.sort((a, b) => a.address.localeCompare(b.address));

	console.log(`[weekly-rewards] Generated ${rewards.length} reward allocations`);
	console.log(`[weekly-rewards] Total STRK allocated: ${totalSTRK.toFixed(6)}`);

	return rewards;
}

/**
 * Format date for R2 object key
 */
function formatTimestampForKey(date: Date): string {
	return date.toISOString().replace(/[:\-\.]/g, "").replace("000Z", "Z");
}

type GenerateWeeklyRewardsOptions = {
	referenceDate?: Date;
};

/**
 * Main function to generate weekly rewards and upload to R2
 */
export async function generateWeeklyRewards(
	env: Env,
	options: GenerateWeeklyRewardsOptions = {},
): Promise<void> {
	try {
		const duneEnv = env as Env & DuneBindings;
		const apiKey = duneEnv.DUNE_API_KEY;
		const queryId = duneEnv.DUNE_QUERY_STRK_REWARDS_ID;

		if (!apiKey) {
			throw new Error("Missing DUNE_API_KEY binding");
		}
		if (!queryId) {
			throw new Error("Missing DUNE_QUERY_STRK_REWARDS_ID binding");
		}

		const now = options.referenceDate || new Date();
		const currentWeek = getCurrentWeekNumber(now);
		const previousWeek = currentWeek - 1;

		if (previousWeek < 1) {
			console.log("[weekly-rewards] No previous week to process yet");
			return;
		}

		const { startDate, endDate } = getWeekDates(previousWeek);

		console.log("[weekly-rewards] === STRK Weekly Rewards Generator ===");
		console.log(`[weekly-rewards] Week ${previousWeek}: ${startDate} to ${endDate}`);
		console.log(`[weekly-rewards] Generated at: ${now.toISOString()}`);

		// Fetch data from all sources in parallel
		const [poolData, userPositions] = await Promise.all([
			fetchSNFPoolData(startDate, endDate),
			fetchUserPositions(queryId, apiKey, startDate, endDate),
		]);

		// Calculate per-user rewards using SNF allocations and Dune-summed totals
		const userRewards = calculateUserRewards(poolData, userPositions);

		// Generate reward JSON
		const rewards = generateRewardJSON(userRewards);

		if (rewards.length === 0) {
			console.log("[weekly-rewards] No rewards to upload");
			return;
		}

		// Upload to R2
		const runLabel = formatTimestampForKey(now);
		const objectKey = `weekly-rewards/week-${previousWeek}-rewards-${runLabel}.json`;
		const jsonContent = JSON.stringify(rewards, null, 2);

		await env.POINTS_BACKUP_BUCKET.put(objectKey, jsonContent, {
			httpMetadata: { contentType: "application/json; charset=utf-8" },
		});

		console.log(`[weekly-rewards] ✓ Rewards file uploaded to R2: ${objectKey}`);
		console.log(`[weekly-rewards] File size: ${jsonContent.length} bytes`);
	} catch (error) {
		console.error("[weekly-rewards] Error generating rewards:", error);
		throw error;
	}
}
