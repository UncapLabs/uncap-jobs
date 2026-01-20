import { createDbClient, type DbClient } from '../db/client';
import { referralPointBreakdowns, referrals, userPoints, userTotalPoints } from '../db/schema';
import { BLACKLISTED_ADDRESSES, POINTS_CONFIG, REFERRAL_CONFIG, type WeekConfig, type SeasonConfig } from './points-config';
import { eq, sql } from 'drizzle-orm';

/**
 * Scoring constants – tweak as needed.
 */
const WEEKLY_POINTS_POOL = 80_770;
const BORROW_WEIGHT = 0.7;
const STABILITY_POOL_WEIGHT = 0.2;
const EKUBO_LIQUIDITY_WEIGHT = 0.5;
const MAX_LTV = 0.8696;
const LTV_MULTIPLIER_FACTOR = 2;
const WEIGHT_DIVISOR = 12;

type DuneRow = {
	branch_id?: string; // 'WBTC' | 'solvBTC' | 'tBTC' | 'LP'
	owner: string;
	hour?: string;
	snapshot_time?: string;
	collateral_usd: number | null;
	debt: number | null;
	in_stability_pool: number | null;
	lp_value_usd?: number | null;
	usdu_in_lp?: number | null;
	usdc_in_lp?: number | null;
};

type DuneResult<T> = {
	result?: {
		rows?: T[];
	};
};

type SeasonInfo = {
	season: SeasonConfig;
	seasonNumber: number;
	weekNumber: number;
	weekConfig: WeekConfig;
};

type RawScores = {
	borrow: number;
	stability: number;
	liquidity: number;
};

type DuneBindings = {
	DUNE_API_KEY?: string;
	DUNE_QUERY_CDP_ID?: string;
};

type CalculationOptions = {
	referenceDate?: Date;
	force?: boolean;
};

type ReferralBreakdown = {
	referrer: string;
	referee: string;
	refereeBasePoints: number;
	bonusPoints: number;
};

function isBlacklistedAddress(address: string): boolean {
	return BLACKLISTED_ADDRESSES.has(address.toLowerCase());
}

export async function calculateWeeklyPoints(env: Env, options: CalculationOptions = {}): Promise<void> {
	console.log('[weekly-points] job starting');

	const duneEnv = env as Env & DuneBindings;
	const apiKey = duneEnv.DUNE_API_KEY;
	if (!apiKey) {
		throw new Error('Missing DUNE_API_KEY binding');
	}

	const db = createDbClient(env.DB);

	const seasonInfo = getLastCompletedWeek(options.referenceDate);
	if (!seasonInfo) {
		console.log('[weekly-points] no completed weeks found');
		return;
	}

	const { start: weekStart, endExclusive: weekEndExclusive } = resolveWeekBounds(seasonInfo.weekConfig);

	console.log(
		`[weekly-points] calculating season ${seasonInfo.seasonNumber} week ${seasonInfo.weekNumber} (${weekStart} → ${weekEndExclusive})`
	);

	const alreadyCalculated = await db
		.select({ count: sql<number>`count(*)` })
		.from(userPoints)
		.where(eq(userPoints.weekStart, weekStart))
		.get();

	if (!options.force && alreadyCalculated?.count) {
		console.log('[weekly-points] week already processed, skipping');
		return;
	}

	const weeklyPool = determineWeeklyPool(seasonInfo) ?? WEEKLY_POINTS_POOL;

	const duneRows = await fetchDuneRows<DuneRow>(duneEnv.DUNE_QUERY_CDP_ID, apiKey, weekStart, weekEndExclusive, 'weekly-activity');

	if (duneRows.length) {
		console.log('[weekly-points] sample row', JSON.stringify(duneRows[0]));
	}
	const scores = accumulateScores(duneRows, weekStart, weekEndExclusive, seasonInfo.weekConfig);
	if (scores.totalRaw === 0) {
		console.log('[weekly-points] no activity found for the week');
		return;
	}

	const normalization = weeklyPool / scores.totalRaw;
	const basePoints = new Map<string, number>();

	for (const [address, raw] of scores.byUser.entries()) {
		if (isBlacklistedAddress(address)) continue;

		const totalRaw = raw.borrow + raw.stability + raw.liquidity;
		if (totalRaw <= 0) continue;
		basePoints.set(address, totalRaw * normalization);
	}

	if (basePoints.size === 0) {
		console.log('[weekly-points] nothing to award after normalization');
		return;
	}

	const referralBonusResult = await computeReferralBonuses(db, basePoints, weekStart, weekEndExclusive);
	const referralBonuses = referralBonusResult.totals;
	const referralBreakdown = referralBonusResult.breakdown;
	const addresses = new Set([...basePoints.keys(), ...referralBonuses.keys()]);

	const rowsToInsert = [];
	const calculationTime = new Date();
	for (const address of addresses) {
		if (isBlacklistedAddress(address)) continue;

		const base = basePoints.get(address) ?? 0;
		const bonus = referralBonuses.get(address) ?? 0;
		const total = base + bonus;
		if (total <= 0) continue;

		rowsToInsert.push({
			userAddress: address,
			weekStart,
			seasonNumber: seasonInfo.seasonNumber,
			weekNumber: seasonInfo.weekNumber,
			basePoints: base,
			referralBonus: bonus,
			totalPoints: total,
			calculatedAt: calculationTime,
		});
	}

	if (rowsToInsert.length === 0) {
		console.log('[weekly-points] nothing to insert after referral bonuses');
		return;
	}

	const BATCH_SIZE = 5;
	for (let i = 0; i < rowsToInsert.length; i += BATCH_SIZE) {
		const batch = rowsToInsert.slice(i, i + BATCH_SIZE);
		console.log(`[weekly-points] inserting batch of ${batch.length}`);
		await db.insert(userPoints).values(batch);
	}

	if (referralBreakdown.length) {
		await db.delete(referralPointBreakdowns).where(eq(referralPointBreakdowns.weekStart, weekStart));

		const referralRows = referralBreakdown.map((entry) => ({
			referrerAddress: entry.referrer,
			refereeAddress: entry.referee,
			weekStart,
			seasonNumber: seasonInfo.seasonNumber,
			weekNumber: seasonInfo.weekNumber,
			refereeBasePoints: entry.refereeBasePoints,
			bonusPoints: entry.bonusPoints,
			calculatedAt: calculationTime,
		}));

		for (let i = 0; i < referralRows.length; i += BATCH_SIZE) {
			const batch = referralRows.slice(i, i + BATCH_SIZE);
			await db.insert(referralPointBreakdowns).values(batch);
		}
	}

	await updateTotals(db, seasonInfo.seasonNumber);

	console.log(`[weekly-points] complete – awarded ${rowsToInsert.length} users (pool ${weeklyPool})`);
}

/**
 * Query helpers
 */
async function fetchDuneRows<T>(
	queryId: string | undefined,
	apiKey: string,
	weekStart: string,
	weekEnd: string,
	label: string
): Promise<T[]> {
	if (!queryId) {
		console.warn(`[weekly-points] skipping ${label} – query ID not configured`);
		return [];
	}

	const url = new URL(`https://api.dune.com/api/v1/query/${queryId}/results`);
	url.searchParams.set('limit', '5000');
	url.searchParams.set('filters[week_start]', weekStart);
	url.searchParams.set('filters[week_end]', weekEnd);

	const res = await fetch(url.toString(), {
		headers: { 'X-Dune-API-Key': apiKey, Accept: 'application/json' },
	});

	if (!res.ok) {
		const body = await res.text();
		throw new Error(`[weekly-points] failed to fetch ${label} data: ${res.status} ${res.statusText} – ${body}`);
	}

	const json = (await res.json()) as DuneResult<T>;
	const rows = json.result?.rows ?? [];
	console.log(`[weekly-points] fetched ${rows.length} ${label} rows`);
	return rows;
}

/**
 * Scoring
 */
function accumulateScores(rows: DuneRow[], weekStart: string, weekEndExclusive: string, weekConfig: WeekConfig) {
	const byUser = new Map<string, RawScores>();
	let totalRaw = 0;

	const borrowWeight = weekConfig.formula.borrowWeight ?? BORROW_WEIGHT;
	const stabilityWeight = weekConfig.formula.stabilityPoolWeight ?? STABILITY_POOL_WEIGHT;
	const ekuboLiquidityWeight = weekConfig.formula.ekuboLiquidityWeight ?? EKUBO_LIQUIDITY_WEIGHT;

	const ensureEntry = (address: string) => {
		const key = address.toLowerCase();
		const existing = byUser.get(key);
		if (existing) return existing;
		const created: RawScores = { borrow: 0, stability: 0, liquidity: 0 };
		byUser.set(key, created);
		return created;
	};

	for (const row of rows) {
		const address = row.owner?.toLowerCase();
		const timestamp = row.hour ?? row.snapshot_time;
		if (!address || !timestamp || !inWeek(timestamp, weekStart, weekEndExclusive) || isBlacklistedAddress(address)) {
			continue;
		}

		const collateralUsd = Math.max(Number(row.collateral_usd ?? 0), 0);
		const debtUsd = Math.max(Number(row.debt ?? 0), 0);
		const poolUsd = Math.max(Number(row.in_stability_pool ?? 0), 0);
		const lpUsd = Math.max(Number(row.lp_value_usd ?? 0), 0);

		const entry = ensureEntry(address);

		if (borrowWeight > 0 && collateralUsd > 0) {
			const currentLtv = debtUsd > 0 ? debtUsd / collateralUsd : 0;
			const normalized = MAX_LTV > 0 ? Math.min(Math.max(currentLtv / MAX_LTV, 0), 1) : 0;
			const multiplier = 1 + LTV_MULTIPLIER_FACTOR * Math.pow(normalized, 4);
			const borrowScore = collateralUsd * borrowWeight * multiplier;
			if (borrowScore > 0) {
				entry.borrow += borrowScore;
				totalRaw += borrowScore;
			}
		}

		if (stabilityWeight > 0 && poolUsd > 0) {
			const stabilityScore = poolUsd * stabilityWeight;
			entry.stability += stabilityScore;
			totalRaw += stabilityScore;
		}

		if (ekuboLiquidityWeight > 0 && lpUsd > 0) {
			const liquidityScore = lpUsd * ekuboLiquidityWeight;
			entry.liquidity += liquidityScore;
			totalRaw += liquidityScore;
		}
	}

	return { byUser, totalRaw };
}

/**
 * Referral bonuses
 */
async function computeReferralBonuses(
	db: DbClient,
	basePoints: Map<string, number>,
	weekStartIso: string,
	weekEndIso: string
): Promise<{ totals: Map<string, number>; breakdown: ReferralBreakdown[] }> {
	const results = await db.select().from(referrals).all();
	if (!results.length) return { totals: new Map(), breakdown: [] };

	const minPoints = REFERRAL_CONFIG.minPointsForBonus ?? 0;
	const weekStartTime = parseUtc(weekStartIso).getTime();
	const weekEndTime = parseUtc(weekEndIso).getTime();
	const hasValidBounds = Number.isFinite(weekStartTime) && Number.isFinite(weekEndTime);
	const isWithinWeek = (timestamp: number) =>
		!hasValidBounds || (Number.isFinite(timestamp) && timestamp >= weekStartTime && timestamp < weekEndTime);

	const bonuses = new Map<string, number>();
	const breakdown: ReferralBreakdown[] = [];
	for (const referral of results) {
		const referee = referral.refereeAddress.toLowerCase();
		if (isBlacklistedAddress(referee)) continue;

		const appliedAtRaw = referral.appliedAt;
		const appliedAtMs = appliedAtRaw instanceof Date ? appliedAtRaw.getTime() : Number(appliedAtRaw ?? NaN);
		const appliedRetroactively = Boolean(referral.appliedRetroactively);

		if (!appliedRetroactively && Number.isFinite(appliedAtMs)) {
			if (!isWithinWeek(appliedAtMs)) continue;
		}

		const refereeScore = basePoints.get(referee) ?? 0;
		if (refereeScore < minPoints) continue;

		const bonus = refereeScore * REFERRAL_CONFIG.bonusRate;
		const referrer = referral.referrerAddress.toLowerCase();
		if (isBlacklistedAddress(referrer)) continue;

		bonuses.set(referrer, (bonuses.get(referrer) ?? 0) + bonus);
		breakdown.push({
			referrer,
			referee,
			refereeBasePoints: refereeScore,
			bonusPoints: bonus,
		});
	}
	return { totals: bonuses, breakdown };
}

/**
 * Aggregate totals for the leaderboards.
 */
async function updateTotals(db: DbClient, seasonNumber: number) {
	const totals = await db
		.select({
			userAddress: userPoints.userAddress,
			seasonPoints: sql<number>`SUM(${userPoints.totalPoints})`,
		})
		.from(userPoints)
		.where(eq(userPoints.seasonNumber, seasonNumber))
		.groupBy(userPoints.userAddress)
		.all();

	if (!totals.length) return;

	for (const row of totals) {
		const column = seasonNumber === 1 ? 'season1Points' : seasonNumber === 2 ? 'season2Points' : 'season3Points';
		const now = new Date();
		const insertValues = {
			userAddress: row.userAddress,
			season1Points: column === 'season1Points' ? row.seasonPoints : 0,
			season2Points: column === 'season2Points' ? row.seasonPoints : 0,
			season3Points: column === 'season3Points' ? row.seasonPoints : 0,
			allTimePoints: row.seasonPoints,
			lastUpdated: now,
		} as const;

		const allTimeExpression =
			seasonNumber === 1
				? sql`excluded.season_1_points + ${userTotalPoints.season2Points} + ${userTotalPoints.season3Points}`
				: seasonNumber === 2
				? sql`${userTotalPoints.season1Points} + excluded.season_2_points + ${userTotalPoints.season3Points}`
				: sql`${userTotalPoints.season1Points} + ${userTotalPoints.season2Points} + excluded.season_3_points`;

		const setFields: Record<string, unknown> = {
			allTimePoints: allTimeExpression,
			lastUpdated: now,
		};

		if (seasonNumber === 1) {
			setFields.season1Points = row.seasonPoints;
		}
		if (seasonNumber === 2) {
			setFields.season2Points = row.seasonPoints;
		}
		if (seasonNumber === 3) {
			setFields.season3Points = row.seasonPoints;
		}

		await db.insert(userTotalPoints).values(insertValues).onConflictDoUpdate({
			target: userTotalPoints.userAddress,
			set: setFields,
		});
	}
}

/**
 * Helper utilities
 */
function determineWeeklyPool(seasonInfo?: SeasonInfo): number | undefined {
	if (!seasonInfo) return undefined;

	const { season, weekNumber, weekConfig } = seasonInfo;
	const weekIndex = Math.max(0, weekNumber - 1);

	if (season.seasonTotalPoints) {
		const totalWeight = season.weightTotal ?? sumWeights(season.weeks.length);
		if (totalWeight > 0) {
			const weekWeight = Math.pow(2, weekIndex / WEIGHT_DIVISOR);
			return (weekWeight / totalWeight) * season.seasonTotalPoints;
		}
	}

	if (weekConfig.totalPointsPool !== undefined) {
		return weekConfig.totalPointsPool;
	}

	return undefined;
}

function sumWeights(weeks: number): number {
	let total = 0;
	for (let i = 0; i < weeks; i++) {
		total += Math.pow(2, i / WEIGHT_DIVISOR);
	}
	return total;
}

function getLastCompletedWeek(reference: Date = new Date()): SeasonInfo | undefined {
	let latest: SeasonInfo | undefined;
	let latestStart = -Infinity;

	for (const season of POINTS_CONFIG) {
		for (let index = 0; index < season.weeks.length; index++) {
			const week = season.weeks[index];
			const { start, endExclusive } = resolveWeekBounds(week);
			const endDate = parseUtc(endExclusive);
			if (endDate > reference) {
				continue;
			}

			const startTime = parseUtc(start).getTime();
			if (startTime > latestStart) {
				latestStart = startTime;
				latest = {
					season,
					seasonNumber: season.seasonNumber,
					weekNumber: index + 1,
					weekConfig: week,
				};
			}
		}
	}

	return latest;
}

function resolveWeekBounds(week: WeekConfig): { start: string; endExclusive: string } {
	const start = week.start;
	const endExclusive = week.endExclusive ?? addDaysToIso(start, 7);
	return { start, endExclusive };
}

function addDaysToIso(timestamp: string, days: number): string {
	const date = parseUtc(timestamp);
	date.setUTCDate(date.getUTCDate() + days);
	return canonicalIso(date);
}

function canonicalIso(date: Date): string {
	return date.toISOString().replace('.000Z', 'Z');
}

function inWeek(dayISO: string, weekStart: string, weekEndExclusive: string): boolean {
	const day = parseUtc(dayISO);
	const start = parseUtc(weekStart);
	const end = parseUtc(weekEndExclusive);
	return day >= start && day < end;
}

function parseUtc(timestamp: string): Date {
	if (!timestamp) return new Date(NaN);

	const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(timestamp);
	const hasTimeDelimiter = timestamp.includes('T') || timestamp.includes(' ');
	const withT = timestamp.replace(' ', 'T');
	const normalized = hasTimeDelimiter ? withT : `${withT}T00:00:00`;

	return hasTimezone ? new Date(normalized) : new Date(`${normalized}Z`);
}
