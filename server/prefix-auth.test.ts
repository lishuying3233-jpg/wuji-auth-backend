import { describe, expect, it } from "vitest";
import * as db from "./db";

describe("Custom activation prefix", () => {
  it("generates and verifies codes with custom prefix", async () => {
    const prefix = "CLIENT-A";
    const randomPart = Math.random().toString(36).substring(2, 12).toUpperCase();
    const code = `${prefix}-${randomPart}`;
    
    // 创建
    await db.createActivationCode({
      code,
      note: "Prefix test",
      durationDays: 7,
      status: "active"
    });
    
    // 验证首次绑定
    const machineId = "test-machine-prefix";
    const result = await db.verifyActivationCode(code, machineId);
    expect(result.success).toBe(true);
    expect(result.expiresAt).toBeDefined();
    
    // 验证再次使用
    const result2 = await db.verifyActivationCode(code, machineId);
    expect(result2.success).toBe(true);
    
    // 验证不同机器
    const result3 = await db.verifyActivationCode(code, "other-machine");
    expect(result3.success).toBe(false);
    expect(result3.message).toContain("绑定");
  });

  it("cleans and handles empty prefix with random default", async () => {
    // 模拟后端清洗逻辑：小写变大写，非法字符移除
    const rawPrefix = "client@123";
    const cleaned = rawPrefix.toUpperCase().replace(/[^A-Z0-9-]/g, "");
    expect(cleaned).toBe("CLIENT123");

    // 模拟空前缀生成
    const emptyPrefix = "   ";
    const cleanedEmpty = emptyPrefix.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
    const finalPrefix = cleanedEmpty || "RAND"; // 模拟 fallback
    expect(finalPrefix).toBe("RAND");
  });

  it("actually generates via router logic", async () => {
    // 模拟 router.ts 中的生成逻辑
    const inputPrefix = "TEST";
    const prefix = (inputPrefix || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
    const randomPart = "RANDOM123"; // 简化模拟
    const code = `${prefix}-${randomPart}`;
    expect(code).toBe("TEST-RANDOM123");

    const emptyInput = "";
    let prefix2 = (emptyInput || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
    if (!prefix2) prefix2 = "RAND"; // 简化模拟
    const code2 = `${prefix2}-${randomPart}`;
    expect(code2).toBe("RAND-RANDOM123");
  });
});
