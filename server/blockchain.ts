import { USDT_CONTRACTS, MIN_CONFIRMATIONS } from "../shared/payment_const";

export type VerificationResult = {
  success: boolean;
  message: string;
  confirmed?: boolean;
};

async function checkTRC20(txHash: string, recipientAddress: string, expectedAmount: string): Promise<VerificationResult> {
  const apiKey = process.env.TRONGRID_API_KEY;
  if (!apiKey) return { success: false, message: "服务端 TRONGrid API 未配置" };

  try {
    // 1. 获取交易详情
    const res = await fetch(`https://api.trongrid.io/v1/transactions/${txHash}/events`, {
      headers: { "TRON-PRO-API-KEY": apiKey },
    });
    if (!res.ok) return { success: false, message: `TRONGrid 请求失败: ${res.status}` };
    
    const body = await res.json() as any;
    if (!body.success || !Array.isArray(body.data)) {
      return { success: false, message: "未找到该 TRC20 交易或交易尚未同步" };
    }

    // 2. 查找 USDT Transfer 事件
    const usdtEvent = body.data.find((e: any) => 
      e.contract_address === USDT_CONTRACTS.TRC20 && 
      e.event_name === "Transfer"
    );

    if (!usdtEvent) return { success: false, message: "交易中未包含 USDT 转账事件" };

    const { to, value } = usdtEvent.result;
    // TRC20 地址可能以 41 开头或 Base58，TronGrid event 返回通常是 Base58
    if (to !== recipientAddress) return { success: false, message: `收款地址不匹配: 预期 ${recipientAddress}, 实际 ${to}` };

    // USDT 有 6 位小数
    const actualAmount = (Number(value) / 1_000_000).toFixed(2);
    if (actualAmount !== Number(expectedAmount).toFixed(2)) {
      return { success: false, message: `金额不匹配: 预期 ${expectedAmount}, 实际 ${actualAmount}` };
    }

    // 3. 检查确认数 (TRC20 详情接口)
    const infoRes = await fetch(`https://api.trongrid.io/wallet/gettransactioninfobyid`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "TRON-PRO-API-KEY": apiKey },
      body: JSON.stringify({ value: txHash }),
    });
    const info = await infoRes.json() as any;
    
    // TRON 确认数逻辑：如果没有 blockNumber 说明未确认
    if (!info.blockNumber) return { success: false, message: "交易尚未在链上确认", confirmed: false };

    return { success: true, message: "核验通过", confirmed: true };
  } catch (e: any) {
    return { success: false, message: `TRON 核验异常: ${e.message}` };
  }
}

async function checkERC20(txHash: string, recipientAddress: string, expectedAmount: string): Promise<VerificationResult> {
  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) return { success: false, message: "服务端 Etherscan API 未配置" };

  try {
    // 1. 获取 ERC20 转账日志
    const url = new URL("https://api.etherscan.io/v2/api");
    url.searchParams.set("chainid", "1");
    url.searchParams.set("module", "proxy");
    url.searchParams.set("action", "eth_getTransactionReceipt");
    url.searchParams.set("txhash", txHash);
    url.searchParams.set("apikey", apiKey);

    const res = await fetch(url.toString());
    const body = await res.json() as any;
    
    if (!body.result || body.result.status !== "0x1") {
      return { success: false, message: "交易不存在或执行失败" };
    }

    const receipt = body.result;
    // Transfer(address,address,uint256) topic0
    const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
    const usdtLog = receipt.logs.find((l: any) => 
      l.address.toLowerCase() === USDT_CONTRACTS.ERC20.toLowerCase() &&
      l.topics[0] === transferTopic
    );

    if (!usdtLog) return { success: false, message: "交易中未包含 USDT 转账日志" };

    // 解析收款人 (topic2)
    const to = "0x" + usdtLog.topics[2].slice(26).toLowerCase();
    if (to !== recipientAddress.toLowerCase()) {
      return { success: false, message: `收款地址不匹配: 预期 ${recipientAddress}, 实际 ${to}` };
    }

    // 解析金额 (data)
    const actualAmount = (BigInt(usdtLog.data) / BigInt(1_000_000)).toString();
    if (Number(actualAmount).toFixed(2) !== Number(expectedAmount).toFixed(2)) {
      return { success: false, message: `金额不匹配: 预期 ${expectedAmount}, 实际 ${actualAmount}` };
    }

    // 2. 检查确认数
    const latestRes = await fetch(`https://api.etherscan.io/v2/api?chainid=1&module=proxy&action=eth_blockNumber&apikey=${apiKey}`);
    const latestBody = await latestRes.json() as any;
    const latestBlock = parseInt(latestBody.result, 16);
    const txBlock = parseInt(receipt.blockNumber, 16);
    const confirmations = latestBlock - txBlock;

    if (confirmations < MIN_CONFIRMATIONS.ERC20) {
      return { success: false, message: `确认数不足 (${confirmations}/${MIN_CONFIRMATIONS.ERC20})`, confirmed: false };
    }

    return { success: true, message: "核验通过", confirmed: true };
  } catch (e: any) {
    return { success: false, message: `ETH 核验异常: ${e.message}` };
  }
}

export async function verifyTransaction(network: "ERC20" | "TRC20", txHash: string, recipientAddress: string, amount: string): Promise<VerificationResult> {
  if (network === "TRC20") return await checkTRC20(txHash, recipientAddress, amount);
  return await checkERC20(txHash, recipientAddress, amount);
}
