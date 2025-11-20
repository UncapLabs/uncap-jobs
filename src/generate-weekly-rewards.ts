/**
 * Job to generate weekly STRK rewards and upload to R2
 * Runs weekly on Thursday at 1 PM UTC
 * Processes data for the previous week (Thursday-Wednesday)
 */

interface AggregatedItem {
	date: string;
	protocol: string;
	user_address: string;
	row_count: number;
	allocated_tokens: number | null;
}

interface AggregatedResponse {
	items: AggregatedItem[];
	total: number;
	page: number;
	size: number;
	pages: number;
}

interface RewardAllocation {
	address: string;
	amount: string; // 18 decimal format (wei)
}

const API_BASE_URL = "https://www.data-openblocklabs.com";
const PROTOCOL = "Uncap";
const PAGE_SIZE = 1000;

// Week 1 starts on Thursday Nov 13, 2025
const WEEK_1_START = new Date("2025-11-13T00:00:00Z");

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
 * Fetch all pages from the aggregated API endpoint
 */
async function fetchAllAllocations(): Promise<AggregatedItem[]> {
	const allItems: AggregatedItem[] = [];
	let currentPage = 1;
	let totalPages = 1;

	console.log("[weekly-rewards] Fetching allocations from OBL API...");

	while (currentPage <= totalPages) {
		const url = `${API_BASE_URL}/starknet/lending-incentives/aggregated/user-protocol?page=${currentPage}&size=${PAGE_SIZE}`;

		console.log(`[weekly-rewards] Fetching page ${currentPage}/${totalPages}...`);

		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`API request failed: ${response.status} ${response.statusText}`);
		}

		const data: AggregatedResponse = await response.json();

		if (currentPage === 1) {
			totalPages = data.pages;
			console.log(`[weekly-rewards] Total pages: ${totalPages}`);
		}

		const uncapItems = data.items.filter((item) => item.protocol === PROTOCOL);
		allItems.push(...uncapItems);

		currentPage++;
	}

	console.log(`[weekly-rewards] Fetched ${allItems.length} Uncap allocation entries`);
	return allItems;
}

/**
 * Filter allocations by date range
 */
function filterByDateRange(
	items: AggregatedItem[],
	startDate: string,
	endDate: string,
): AggregatedItem[] {
	const filtered = items.filter((item) => {
		return item.date >= startDate && item.date <= endDate;
	});

	console.log(`[weekly-rewards] Filtered to date range: ${startDate} to ${endDate}`);
	console.log(`[weekly-rewards] ${filtered.length} entries in date range`);

	return filtered;
}

/**
 * Aggregate allocations by user address
 */
function aggregateByUser(items: AggregatedItem[]): Map<string, number> {
	const userAllocations = new Map<string, number>();

	for (const item of items) {
		const { user_address, allocated_tokens } = item;

		if (allocated_tokens === null) continue;

		const currentTotal = userAllocations.get(user_address) || 0;
		userAllocations.set(user_address, currentTotal + allocated_tokens);
	}

	console.log(`[weekly-rewards] Aggregated to ${userAllocations.size} unique users`);
	return userAllocations;
}

/**
 * Generate reward allocation JSON
 */
function generateRewardJSON(userAllocations: Map<string, number>): RewardAllocation[] {
	const rewards: RewardAllocation[] = [];
	let totalSTRK = 0;

	for (const [address, amount] of userAllocations.entries()) {
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

		// Fetch all allocations
		const allItems = await fetchAllAllocations();

		// Filter by date range
		const filteredItems = filterByDateRange(allItems, startDate, endDate);

		// Aggregate by user
		const userAllocations = aggregateByUser(filteredItems);

		// Generate reward JSON
		const rewards = generateRewardJSON(userAllocations);

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
