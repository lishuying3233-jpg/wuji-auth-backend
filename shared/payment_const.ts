export const USDT_CONTRACTS = {
  ERC20: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  TRC20: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
} as const;

export const PLANS = [
  { name: "体验卡", durationDays: 1, price: "1.99" },
  { name: "三天卡", durationDays: 3, price: "2.99" },
  { name: "周卡", durationDays: 7, price: "3.99" },
  { name: "月卡", durationDays: 30, price: "5.88" },
  { name: "季卡", durationDays: 90, price: "19.88" },
  { name: "年卡", durationDays: 365, price: "58.88" },
] as const;

/**
 * 所有可售套餐的合法期限。生成、下单和存量授权码纠正都必须使用此列表。
 */
export const LICENSE_DURATION_DAYS = PLANS.map((plan) => plan.durationDays) as readonly number[];

export function isSupportedPlanDuration(durationDays: number): boolean {
  return Number.isInteger(durationDays) && LICENSE_DURATION_DAYS.includes(durationDays);
}

/**
 * 卡种名称只允许从唯一套餐目录精确查找，绝不能按“天数阈值”猜测。
 * 对历史上存在的非标准期限，明确展示实际天数而非误显示为年卡。
 */
export function getPlanNameByDuration(durationDays: number | null | undefined): string {
  const plan = PLANS.find((item) => item.durationDays === durationDays);
  if (plan) return plan.name;
  return Number.isInteger(durationDays) && (durationDays as number) > 0
    ? `${durationDays} 天卡`
    : "未知套餐";
}

export const MIN_CONFIRMATIONS = {
  ERC20: 2, // Ethereum 2 确认通常认为安全
  TRC20: 19, // TRON 19 确认（约 1 分钟）为不可逆状态
} as const;
