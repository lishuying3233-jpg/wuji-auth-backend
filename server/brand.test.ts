import { describe, expect, it } from "vitest";

describe("M7 brand configuration", () => {
  it("serves a reachable app endpoint with the configured brand title", async () => {
    expect(process.env.VITE_APP_TITLE).toBe("M7社媒助手");

    const response = await fetch("http://127.0.0.1:3000/");
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).toContain("M7社媒助手");
  }, 10_000);
});
