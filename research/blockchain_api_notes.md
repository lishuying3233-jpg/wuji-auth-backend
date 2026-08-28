# USDT 链上核验资料（2026-08-28）

## 官方资料

- TRONGrid 官方文档：https://developers.tron.network/docs/trongrid
- Etherscan API Key 官方文档：https://docs.etherscan.io/set-up-your-api-key
- Etherscan ERC20 transfer endpoint：https://docs.etherscan.io/api-reference/endpoint/tokentx
- Etherscan receipt endpoint：https://docs.etherscan.io/api-reference/endpoint/ethgettransactionreceipt

## 已确认事实

- TRONGrid 生产环境建议配置 API Key。Key 用于调用方识别、配额统计、限流和安全策略，不代表链上账户权限，也不会签名交易。
- TronGrid V1 API 可查询地址交易历史、TRC20 转账和交易事件；只读查询不需要钱包私钥。
- Etherscan API 需要普通账号创建 API Key；官方文档说明免费方案在大多数链上为每秒 3 次、每天最多 100,000 次调用。
- Etherscan V2 统一接口可通过 receipt/RPC 或 token transfer 接口读取交易回执和 ERC20 转账数据。

## 实现约束

- API Key 只放服务端环境变量，不能进入桌面端或前端。
- 订单核验必须同时匹配网络、USDT 合约地址、收款地址、精确金额、成功状态、确认数和唯一 TxHash。
- 核验过程必须幂等；同一 TxHash 不能给多个订单发码。
- 链上查询失败、未确认或金额不匹配时只更新订单状态和错误原因，不自动发码。
