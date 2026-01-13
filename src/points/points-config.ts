export type WeekConfig = {
	start: string;
	endExclusive?: string;
	totalPointsPool?: number;
	formula: {
		borrowWeight: number;
		// Place-holders for future activities.
		stabilityPoolWeight?: number;
		ekuboLiquidityWeight?: number;
	};
};

export type SeasonConfig = {
	seasonNumber: number;
	name: string;
	startDate: string;
	endDate: string;
	seasonTotalPoints?: number;
	weightTotal?: number;
	weeks: WeekConfig[];
};

export const POINTS_CONFIG: SeasonConfig[] = [
	{
		seasonNumber: 1,
		name: 'Season 1',
		startDate: '2025-10-10',
		endDate: '2026-01-09',
		seasonTotalPoints: 1_050_000,
		weightTotal: 18.817154,
		weeks: [
			{
				start: '2025-10-10T06:00:00Z',
				endExclusive: '2025-10-17T06:00:00Z',
				formula: {
					borrowWeight: 0.8,
					stabilityPoolWeight: 0.5,
					ekuboLiquidityWeight: 0.3,
				},
			},
			{
				start: '2025-10-17T06:00:00Z',
				endExclusive: '2025-10-24T06:00:00Z',
				formula: {
					borrowWeight: 0.7,
					stabilityPoolWeight: 0.2,
					ekuboLiquidityWeight: 0.5,
				},
			},
			{
				start: '2025-10-24T06:00:00Z',
				endExclusive: '2025-10-31T06:00:00Z',
				formula: {
					borrowWeight: 0.7,
					stabilityPoolWeight: 0.2,
					ekuboLiquidityWeight: 0.5,
				},
			},
			{
				start: '2025-10-31T06:00:00Z',
				endExclusive: '2025-11-07T06:00:00Z',
				formula: {
					borrowWeight: 0.7,
					stabilityPoolWeight: 0.2,
					ekuboLiquidityWeight: 0.5,
				},
			},
			{
				start: '2025-11-07T06:00:00Z',
				endExclusive: '2025-11-14T06:00:00Z',
				formula: {
					borrowWeight: 0.7,
					stabilityPoolWeight: 0.2,
					ekuboLiquidityWeight: 0.5,
				},
			},
			{
				start: '2025-11-14T06:00:00Z',
				endExclusive: '2025-11-21T06:00:00Z',
				formula: {
					borrowWeight: 0.7,
					stabilityPoolWeight: 0.2,
					ekuboLiquidityWeight: 0.5,
				},
			},
			{
				start: '2025-11-21T06:00:00Z',
				endExclusive: '2025-11-28T06:00:00Z',
				formula: {
					borrowWeight: 0.7,
					stabilityPoolWeight: 0.2,
					ekuboLiquidityWeight: 0.5,
				},
			},
			{
				start: '2025-11-28T06:00:00Z',
				endExclusive: '2025-12-05T06:00:00Z',
				formula: {
					borrowWeight: 0.7,
					stabilityPoolWeight: 0.2,
					ekuboLiquidityWeight: 0.5,
				},
			},
			{
				start: '2025-12-05T06:00:00Z',
				endExclusive: '2025-12-12T06:00:00Z',
				formula: {
					borrowWeight: 0.7,
					stabilityPoolWeight: 0.2,
					ekuboLiquidityWeight: 0.5,
				},
			},
			{
				start: '2025-12-12T06:00:00Z',
				endExclusive: '2025-12-19T06:00:00Z',
				formula: {
					borrowWeight: 0.7,
					stabilityPoolWeight: 0.2,
					ekuboLiquidityWeight: 0.5,
				},
			},
			{
				start: '2025-12-19T06:00:00Z',
				endExclusive: '2025-12-26T06:00:00Z',
				formula: {
					borrowWeight: 0.7,
					stabilityPoolWeight: 0.2,
					ekuboLiquidityWeight: 0.5,
				},
			},
			{
				start: '2025-12-26T06:00:00Z',
				endExclusive: '2026-01-02T06:00:00Z',
				formula: {
					borrowWeight: 0.7,
					stabilityPoolWeight: 0.2,
					ekuboLiquidityWeight: 0.5,
				},
			},
			{
				start: '2026-01-02T06:00:00Z',
				endExclusive: '2026-01-09T06:00:00Z',
				formula: {
					borrowWeight: 0.7,
					stabilityPoolWeight: 0.2,
					ekuboLiquidityWeight: 0.5,
				},
			},
		],
	},
	{
		seasonNumber: 2,
		name: 'Season 2',
		startDate: '2026-01-09',
		endDate: '2026-04-10',
		seasonTotalPoints: 1_890_000,
		weightTotal: 18.817154,
		weeks: [
			{
				start: '2026-01-09T06:00:00Z',
				endExclusive: '2026-01-16T06:00:00Z',
				formula: {
					borrowWeight: 0.7,
					stabilityPoolWeight: 0.2,
					ekuboLiquidityWeight: 0.5,
				},
			},
			{
				start: '2026-01-16T06:00:00Z',
				endExclusive: '2026-01-23T06:00:00Z',
				formula: {
					borrowWeight: 0.7,
					stabilityPoolWeight: 0.2,
					ekuboLiquidityWeight: 0.5,
				},
			},
			{
				start: '2026-01-23T06:00:00Z',
				endExclusive: '2026-01-30T06:00:00Z',
				formula: {
					borrowWeight: 0.7,
					stabilityPoolWeight: 0.2,
					ekuboLiquidityWeight: 0.5,
				},
			},
			{
				start: '2026-01-30T06:00:00Z',
				endExclusive: '2026-02-06T06:00:00Z',
				formula: {
					borrowWeight: 0.7,
					stabilityPoolWeight: 0.2,
					ekuboLiquidityWeight: 0.5,
				},
			},
			{
				start: '2026-02-06T06:00:00Z',
				endExclusive: '2026-02-13T06:00:00Z',
				formula: {
					borrowWeight: 0.7,
					stabilityPoolWeight: 0.2,
					ekuboLiquidityWeight: 0.5,
				},
			},
			{
				start: '2026-02-13T06:00:00Z',
				endExclusive: '2026-02-20T06:00:00Z',
				formula: {
					borrowWeight: 0.7,
					stabilityPoolWeight: 0.2,
					ekuboLiquidityWeight: 0.5,
				},
			},
			{
				start: '2026-02-20T06:00:00Z',
				endExclusive: '2026-02-27T06:00:00Z',
				formula: {
					borrowWeight: 0.7,
					stabilityPoolWeight: 0.2,
					ekuboLiquidityWeight: 0.5,
				},
			},
			{
				start: '2026-02-27T06:00:00Z',
				endExclusive: '2026-03-06T06:00:00Z',
				formula: {
					borrowWeight: 0.7,
					stabilityPoolWeight: 0.2,
					ekuboLiquidityWeight: 0.5,
				},
			},
			{
				start: '2026-03-06T06:00:00Z',
				endExclusive: '2026-03-13T06:00:00Z',
				formula: {
					borrowWeight: 0.7,
					stabilityPoolWeight: 0.2,
					ekuboLiquidityWeight: 0.5,
				},
			},
			{
				start: '2026-03-13T06:00:00Z',
				endExclusive: '2026-03-20T06:00:00Z',
				formula: {
					borrowWeight: 0.7,
					stabilityPoolWeight: 0.2,
					ekuboLiquidityWeight: 0.5,
				},
			},
			{
				start: '2026-03-20T06:00:00Z',
				endExclusive: '2026-03-27T06:00:00Z',
				formula: {
					borrowWeight: 0.7,
					stabilityPoolWeight: 0.2,
					ekuboLiquidityWeight: 0.5,
				},
			},
			{
				start: '2026-03-27T06:00:00Z',
				endExclusive: '2026-04-03T06:00:00Z',
				formula: {
					borrowWeight: 0.7,
					stabilityPoolWeight: 0.2,
					ekuboLiquidityWeight: 0.5,
				},
			},
			{
				start: '2026-04-03T06:00:00Z',
				endExclusive: '2026-04-10T06:00:00Z',
				formula: {
					borrowWeight: 0.7,
					stabilityPoolWeight: 0.2,
					ekuboLiquidityWeight: 0.5,
				},
			},
		],
	},
];

export const BLACKLISTED_ADDRESSES = new Set<string>([
	'0x0620c6622add9c6afd0577ec73584a3024448d955c64d3d6d7e2f99a600afc56',
]);

export const REFERRAL_CONFIG = {
	bonusRate: 0.1,
	minPointsForBonus: 0,
};
