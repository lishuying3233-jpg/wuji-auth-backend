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

export const MIN_CONFIRMATIONS = {
  ERC20: 2, // Ethereum 2 确认通常认为安全
  TRC20: 19, // TRON 19 确认（约 1 分钟）为不可逆状态
} as const;
