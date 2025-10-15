export type WeekConfig = {
  startDate: string;
  endDate: string;
  totalPointsPool: number;
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
  weeks: WeekConfig[];
};

export const POINTS_CONFIG: SeasonConfig[] = [
  {
    seasonNumber: 1,
    name: "Season 1",
    startDate: "2025-01-13",
    endDate: "2025-02-21",
    weeks: [
      {
        startDate: "2025-01-13",
        endDate: "2025-01-19",
        totalPointsPool: 80_770,
        formula: { borrowWeight: 1 },
      },
      {
        startDate: "2025-01-20",
        endDate: "2025-01-26",
        totalPointsPool: 80_770,
        formula: { borrowWeight: 1 },
      },
      {
        startDate: "2025-01-27",
        endDate: "2025-02-02",
        totalPointsPool: 80_770,
        formula: { borrowWeight: 1 },
      },
      {
        startDate: "2025-02-03",
        endDate: "2025-02-09",
        totalPointsPool: 80_770,
        formula: { borrowWeight: 1 },
      },
      {
        startDate: "2025-02-10",
        endDate: "2025-02-16",
        totalPointsPool: 80_770,
        formula: { borrowWeight: 1 },
      },
      {
        startDate: "2025-02-17",
        endDate: "2025-02-21",
        totalPointsPool: 80_770,
        formula: { borrowWeight: 1 },
      },
    ],
  },
];

export const REFERRAL_CONFIG = {
  bonusRate: 0.15,
  minPointsForBonus: 0,
};

export function getWeekConfig(weekStart: string): WeekConfig | undefined {
  for (const season of POINTS_CONFIG) {
    const week = season.weeks.find((w) => w.startDate === weekStart);
    if (week) return week;
  }
  return undefined;
}
