import { createDbClient, type DbClient } from "./db/client";
import { referrals, userPoints, userTotalPoints } from "./db/schema";
import { POINTS_CONFIG, REFERRAL_CONFIG } from "./points-config";
import { eq, sql } from "drizzle-orm";

/**
 * Scoring constants – tweak as needed.
 */
const WEEKLY_POINTS_POOL = 80_770;
const BORROW_WEIGHT = 1.0;
const STABILITY_POOL_WEIGHT = 0.2;
const LP_WEIGHT = 0.5;
const MAX_LTV = 0.8696;
const LTV_BONUS_FACTOR = 2;

type DuneRow = {
  owner: string;
  hour: string;
  collateral_usd: number | null;
  debt: number | null;
  in_stability_pool: number | null;
};

type DuneResult<T> = {
  result?: {
    rows?: T[];
  };
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

export async function calculateWeeklyPoints(env: Env): Promise<void> {
  console.log("[weekly-points] job starting");

  const duneEnv = env as Env & DuneBindings;
  const apiKey = duneEnv.DUNE_API_KEY;
  if (!apiKey) {
    throw new Error("Missing DUNE_API_KEY binding");
  }

  const db = createDbClient(env.DB);

  const weekStart = previousMondayISO();
  const weekEnd = nextMondayISO(weekStart);

  const alreadyCalculated = await db
    .select({ count: sql<number>`count(*)` })
    .from(userPoints)
    .where(eq(userPoints.weekStart, weekStart))
    .get();

  if (alreadyCalculated?.count) {
    console.log("[weekly-points] week already processed, skipping");
    return;
  }

  const seasonInfo = getSeasonInfo(weekStart);
  const weeklyPool =
    seasonInfo?.weekConfig?.totalPointsPool ?? WEEKLY_POINTS_POOL;

  const duneRows = await fetchDuneRows<DuneRow>(
    duneEnv.DUNE_QUERY_CDP_ID,
    apiKey,
    weekStart,
    weekEnd,
    "weekly-activity"
  );

  const scores = accumulateScores(duneRows, weekStart, weekEnd);
  if (scores.totalRaw === 0) {
    console.log("[weekly-points] no activity found for the week");
    return;
  }

  const normalization = weeklyPool / scores.totalRaw;
  const basePoints = new Map<string, number>();

  for (const [address, raw] of scores.byUser.entries()) {
    const totalRaw = raw.borrow + raw.stability + raw.liquidity;
    if (totalRaw <= 0) continue;
    basePoints.set(address, totalRaw * normalization);
  }

  if (basePoints.size === 0) {
    console.log("[weekly-points] nothing to award after normalization");
    return;
  }

  const referralBonuses = await computeReferralBonuses(db, basePoints);
  const addresses = new Set([...basePoints.keys(), ...referralBonuses.keys()]);

  const rowsToInsert = [];
  for (const address of addresses) {
    const base = basePoints.get(address) ?? 0;
    const bonus = referralBonuses.get(address) ?? 0;
    const total = base + bonus;
    if (total <= 0) continue;

    rowsToInsert.push({
      userAddress: address,
      weekStart,
      seasonNumber: seasonInfo?.seasonNumber ?? 1,
      weekNumber: seasonInfo?.weekNumber ?? 1,
      basePoints: base,
      referralBonus: bonus,
      totalPoints: total,
      calculatedAt: new Date(),
    });
  }

  if (rowsToInsert.length === 0) {
    console.log("[weekly-points] nothing to insert after referral bonuses");
    return;
  }

  const BATCH_SIZE = 500;
  for (let i = 0; i < rowsToInsert.length; i += BATCH_SIZE) {
    const batch = rowsToInsert.slice(i, i + BATCH_SIZE);
    await db.insert(userPoints).values(batch);
  }

  await updateTotals(db, seasonInfo?.seasonNumber ?? 1);

  console.log(
    `[weekly-points] complete – awarded ${rowsToInsert.length} users (pool ${weeklyPool})`
  );
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
  url.searchParams.set("limit", "5000");
  url.searchParams.set("filters[week_start]", weekStart);
  url.searchParams.set("filters[week_end]", weekEnd);

  const res = await fetch(url.toString(), {
    headers: { "X-Dune-API-Key": apiKey, Accept: "application/json" },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `[weekly-points] failed to fetch ${label} data: ${res.status} ${res.statusText} – ${body}`
    );
  }

  const json = (await res.json()) as DuneResult<T>;
  const rows = json.result?.rows ?? [];
  console.log(`[weekly-points] fetched ${rows.length} ${label} rows`);
  return rows;
}

/**
 * Scoring
 */
function accumulateScores(rows: DuneRow[], weekStart: string, weekEnd: string) {
  const byUser = new Map<string, RawScores>();
  let totalRaw = 0;

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
    if (!address || !inWeek(row.hour, weekStart, weekEnd)) continue;

    const collateralUsd = Math.max(Number(row.collateral_usd ?? 0), 0);
    const debtUsd = Math.max(Number(row.debt ?? 0), 0);
    const poolUsd = Math.max(Number(row.in_stability_pool ?? 0), 0);

    const entry = ensureEntry(address);

    if (collateralUsd > 0) {
      const currentLtv = debtUsd > 0 ? debtUsd / collateralUsd : 0;
      const normalized =
        MAX_LTV > 0 ? Math.min(Math.max(currentLtv / MAX_LTV, 0), 1) : 0;
      const multiplier = 1 + LTV_BONUS_FACTOR * normalized * normalized;
      const borrowScore = collateralUsd * BORROW_WEIGHT * multiplier;
      entry.borrow += borrowScore;
      totalRaw += borrowScore;
    }

    if (poolUsd > 0) {
      const stabilityScore = poolUsd * STABILITY_POOL_WEIGHT;
      entry.stability += stabilityScore;
      totalRaw += stabilityScore;
    }
  }

  return { byUser, totalRaw };
}

/**
 * Referral bonuses
 */
async function computeReferralBonuses(
  db: DbClient,
  basePoints: Map<string, number>
) {
  const results = await db.select().from(referrals).all();
  if (!results.length) return new Map<string, number>();

  const bonuses = new Map<string, number>();
  for (const referral of results) {
    const refereeScore =
      basePoints.get(referral.refereeAddress.toLowerCase()) ?? 0;
    if (refereeScore <= 0) continue;

    const bonus = refereeScore * REFERRAL_CONFIG.bonusRate;
    const referrer = referral.referrerAddress.toLowerCase();
    bonuses.set(referrer, (bonuses.get(referrer) ?? 0) + bonus);
  }
  return bonuses;
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
    const column =
      seasonNumber === 1
        ? "season1Points"
        : seasonNumber === 2
        ? "season2Points"
        : "season3Points";

    await db
      .insert(userTotalPoints)
      .values({
        userAddress: row.userAddress,
        [column]: row.seasonPoints,
      })
      .onConflictDoUpdate({
        target: userTotalPoints.userAddress,
        set: {
          [column]: row.seasonPoints,
          allTimePoints: sql`${userTotalPoints.season1Points} + ${userTotalPoints.season2Points} + ${userTotalPoints.season3Points}`,
          lastUpdated: new Date(),
        },
      });
  }
}

/**
 * Helper utilities
 */
function getSeasonInfo(weekStart: string) {
  for (const season of POINTS_CONFIG) {
    const index = season.weeks.findIndex((w) => w.startDate === weekStart);
    if (index !== -1) {
      return {
        seasonNumber: season.seasonNumber,
        weekNumber: index + 1,
        weekConfig: season.weeks[index],
      };
    }
  }
  return undefined;
}

function previousMondayISO(): string {
  const now = new Date();
  const utcToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const weekday = utcToday.getUTCDay();
  const diff = weekday === 0 ? 6 : weekday - 1;
  utcToday.setUTCDate(utcToday.getUTCDate() - diff);
  return utcToday.toISOString().split("T")[0];
}

function nextMondayISO(mondayISO: string): string {
  const monday = new Date(`${mondayISO}T00:00:00Z`);
  const nextMonday = new Date(monday);
  nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
  return nextMonday.toISOString().split("T")[0];
}

function inWeek(dayISO: string, weekStart: string, weekEnd: string): boolean {
  const day = new Date(`${dayISO}T00:00:00Z`);
  const start = new Date(`${weekStart}T00:00:00Z`);
  const end = new Date(`${weekEnd}T00:00:00Z`);
  return day >= start && day < end;
}
