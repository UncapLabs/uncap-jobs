import { asc } from "drizzle-orm";
import { createDbClient } from "./db/client";
import {
	referralCodes,
	referralPointBreakdowns,
	referrals,
	userPoints,
	userTotalPoints,
} from "./db/schema";

type SnapshotOptions = {
	referenceDate?: Date;
};

export async function exportPointsSnapshot(
	env: Env,
	options: SnapshotOptions = {},
): Promise<void> {
	const db = createDbClient(env.DB);

	const [pointsRows, breakdownRows, referralRows, referralCodeRows, totalsRows] =
		await Promise.all([
			db
				.select({
					userAddress: userPoints.userAddress,
					weekStart: userPoints.weekStart,
					seasonNumber: userPoints.seasonNumber,
					weekNumber: userPoints.weekNumber,
					basePoints: userPoints.basePoints,
					referralBonus: userPoints.referralBonus,
					totalPoints: userPoints.totalPoints,
					calculationMetadata: userPoints.calculationMetadata,
					calculatedAt: userPoints.calculatedAt,
					createdAt: userPoints.createdAt,
				})
				.from(userPoints)
				.orderBy(asc(userPoints.weekStart), asc(userPoints.userAddress))
				.all(),
			db
				.select({
					referrerAddress: referralPointBreakdowns.referrerAddress,
					refereeAddress: referralPointBreakdowns.refereeAddress,
					weekStart: referralPointBreakdowns.weekStart,
					seasonNumber: referralPointBreakdowns.seasonNumber,
					weekNumber: referralPointBreakdowns.weekNumber,
					refereeBasePoints: referralPointBreakdowns.refereeBasePoints,
					bonusPoints: referralPointBreakdowns.bonusPoints,
					calculatedAt: referralPointBreakdowns.calculatedAt,
					createdAt: referralPointBreakdowns.createdAt,
				})
				.from(referralPointBreakdowns)
				.orderBy(
					asc(referralPointBreakdowns.weekStart),
					asc(referralPointBreakdowns.referrerAddress),
					asc(referralPointBreakdowns.refereeAddress),
				)
				.all(),
			db
				.select({
					referrerAddress: referrals.referrerAddress,
					refereeAddress: referrals.refereeAddress,
					refereeAnonymousName: referrals.refereeAnonymousName,
					referralCode: referrals.referralCode,
					appliedAt: referrals.appliedAt,
					appliedRetroactively: referrals.appliedRetroactively,
				})
				.from(referrals)
				.orderBy(asc(referrals.referrerAddress), asc(referrals.refereeAddress))
				.all(),
			db
				.select({
					userAddress: referralCodes.userAddress,
					referralCode: referralCodes.referralCode,
					createdAt: referralCodes.createdAt,
				})
				.from(referralCodes)
				.orderBy(asc(referralCodes.userAddress))
				.all(),
			db
				.select({
					userAddress: userTotalPoints.userAddress,
					season1Points: userTotalPoints.season1Points,
					season2Points: userTotalPoints.season2Points,
					season3Points: userTotalPoints.season3Points,
					allTimePoints: userTotalPoints.allTimePoints,
					lastUpdated: userTotalPoints.lastUpdated,
				})
				.from(userTotalPoints)
				.orderBy(asc(userTotalPoints.userAddress))
				.all(),
		]);

	const now = options.referenceDate ? new Date(options.referenceDate) : new Date();
	const snapshotLabel = formatDate(now);
	const runLabel = formatTimestampForKey(now);
	const folderKey = `points-snapshots/${snapshotLabel}/`;

	const outputs: Array<{
		table: string;
		rows: string[][];
	}> = [
		{
			table: "user_points",
			rows: [
				[
					"user_address",
					"week_start",
					"season_number",
					"week_number",
					"base_points",
					"referral_bonus",
					"total_points",
					"calculation_metadata",
					"calculated_at",
					"created_at",
				],
				...pointsRows.map((row) => [
					row.userAddress ?? "",
					row.weekStart ?? "",
					toString(row.seasonNumber),
					toString(row.weekNumber),
					toNumeric(row.basePoints),
					toNumeric(row.referralBonus),
					toNumeric(row.totalPoints),
					row.calculationMetadata ?? "",
					toTimestamp(row.calculatedAt),
					toTimestamp(row.createdAt),
				]),
			],
		},
		{
			table: "referral_point_breakdowns",
			rows: [
				[
					"referrer_address",
					"referee_address",
					"week_start",
					"season_number",
					"week_number",
					"referee_base_points",
					"bonus_points",
					"calculated_at",
					"created_at",
				],
				...breakdownRows.map((row) => [
					row.referrerAddress ?? "",
					row.refereeAddress ?? "",
					row.weekStart ?? "",
					toString(row.seasonNumber),
					toString(row.weekNumber),
					toNumeric(row.refereeBasePoints),
					toNumeric(row.bonusPoints),
					toTimestamp(row.calculatedAt),
					toTimestamp(row.createdAt),
				]),
			],
		},
		{
			table: "referrals",
			rows: [
				[
					"referrer_address",
					"referee_address",
					"referee_anonymous_name",
					"referral_code",
					"applied_at",
					"applied_retroactively",
				],
				...referralRows.map((row) => [
					row.referrerAddress ?? "",
					row.refereeAddress ?? "",
					row.refereeAnonymousName ?? "",
					row.referralCode ?? "",
					toTimestamp(row.appliedAt),
					toBoolean(row.appliedRetroactively),
				]),
			],
		},
		{
			table: "referral_codes",
			rows: [
				["user_address", "referral_code", "created_at"],
				...referralCodeRows.map((row) => [
					row.userAddress ?? "",
					row.referralCode ?? "",
					toTimestamp(row.createdAt),
				]),
			],
		},
		{
			table: "user_total_points",
			rows: [
				[
					"user_address",
					"season_1_points",
					"season_2_points",
					"season_3_points",
					"all_time_points",
					"last_updated",
				],
				...totalsRows.map((row) => [
					row.userAddress ?? "",
					toNumeric(row.season1Points),
					toNumeric(row.season2Points),
					toNumeric(row.season3Points),
					toNumeric(row.allTimePoints),
					toTimestamp(row.lastUpdated),
				]),
			],
		},
	];

	let totalRows = 0;

	for (const output of outputs) {
		const csv = rowsToCsv(output.rows);
		const objectKey = `${folderKey}${output.table}-${runLabel}.csv`;
		await env.POINTS_BACKUP_BUCKET.put(objectKey, csv, {
			httpMetadata: { contentType: "text/csv; charset=utf-8" },
		});
		const rowCount = Math.max(0, output.rows.length - 1);
		totalRows += rowCount;
		console.log(
			`[weekly-points] snapshot exported ${output.table} – ${rowCount} rows → ${objectKey}`,
		);
	}

	console.log(
		`[weekly-points] snapshot complete – ${totalRows} total table rows saved`,
	);
}

function rowsToCsv(rows: string[][]): string {
	return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

function csvEscape(value: unknown): string {
	if (value === null || value === undefined) return "";
	const str = String(value);
	if (/[",\n]/.test(str)) {
		return `"${str.replace(/"/g, '""')}"`;
	}
	return str;
}

function toString(value: unknown): string {
	if (value === null || value === undefined) return "";
	return String(value);
}

function toNumeric(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (value instanceof Date) return toTimestamp(value);
	if (typeof value === "number") {
		return Number.isFinite(value) ? String(value) : "";
	}
	const asNumber = Number(value);
	return Number.isFinite(asNumber) ? String(asNumber) : String(value);
}

function toBoolean(value: unknown): string {
	if (typeof value === "boolean") return value ? "true" : "false";
	if (value === null || value === undefined) return "";
	if (typeof value === "number") return value !== 0 ? "true" : "false";
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (!normalized) return "";
		return normalized === "true" || normalized === "1" ? "true" : "false";
	}
	return "";
}

function toTimestamp(value: unknown): string {
	if (!value) return "";
	if (value instanceof Date) return canonicalIso(value);
	if (typeof value === "number" && Number.isFinite(value)) {
		return canonicalIso(new Date(value));
	}
	if (typeof value === "string") {
		const asNumber = Number(value);
		if (Number.isFinite(asNumber)) {
			return canonicalIso(new Date(asNumber));
		}
		const parsed = new Date(value);
		if (!Number.isNaN(parsed.getTime())) {
			return canonicalIso(parsed);
		}
	}
	return "";
}

function formatDate(date: Date): string {
	return date.toISOString().slice(0, 10);
}

function formatTimestampForKey(date: Date): string {
	return canonicalIso(date).replace(/[:\-]/g, "").replace(".000Z", "Z");
}

function canonicalIso(date: Date): string {
	return date.toISOString().replace(".000Z", "Z");
}
