import { describe, expect, it } from "vitest";

const requestJson = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json() as Record<string, unknown>;
  return { response, body };
};

describe("blockchain API credentials", () => {
  it("validates the configured TronGrid API key with a read-only request", async () => {
    const apiKey = process.env.TRONGRID_API_KEY;
    expect(apiKey, "TRONGRID_API_KEY must be configured").toBeTruthy();

    const { response, body } = await requestJson(
      "https://api.trongrid.io/wallet/getnowblock",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "TRON-PRO-API-KEY": apiKey!,
        },
        body: "{}",
      },
    );

    expect(response.ok).toBe(true);
    expect(typeof body.blockID).toBe("string");
    expect(body).toHaveProperty("block_header");
  }, 15_000);

  it("validates the configured Etherscan API key with a read-only request", async () => {
    const apiKey = process.env.ETHERSCAN_API_KEY;
    expect(apiKey, "ETHERSCAN_API_KEY must be configured").toBeTruthy();

    const url = new URL("https://api.etherscan.io/v2/api");
    url.searchParams.set("chainid", "1");
    url.searchParams.set("module", "proxy");
    url.searchParams.set("action", "eth_blockNumber");
    url.searchParams.set("apikey", apiKey!);

    const { response, body } = await requestJson(url.toString());

    expect(response.ok).toBe(true);
    expect(body).toHaveProperty("jsonrpc", "2.0");
    expect(typeof body.result).toBe("string");
    expect(String(body.result)).toMatch(/^0x[0-9a-f]+$/i);
  }, 15_000);
});

export {};
