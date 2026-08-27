import { describe, expect, it, beforeAll } from "vitest";
import { appRouter } from "./routers";
import * as db from "./db";

describe("activation.verify", () => {
  const testCode = "TEST-CODE-123";
  const testMachineId = "MACHINE-ABC-789";

  it("should fail if code does not exist", async () => {
    const caller = appRouter.createCaller({ user: null } as any);
    const result = await caller.auth.verify({ code: "NON-EXISTENT", machineId: testMachineId });
    expect(result.success).toBe(false);
    expect(result.message).toBe("激活码不存在");
  });

  it("should bind and succeed on first use", async () => {
    // Manually create a code in DB for testing
    await db.createActivationCode({ code: testCode, note: "Test" });
    
    const caller = appRouter.createCaller({ user: null } as any);
    const result = await caller.auth.verify({ code: testCode, machineId: testMachineId });
    
    expect(result.success).toBe(true);
    expect(result.message).toBe("激活成功");
    
    // Verify it's bound in DB
    const codes = await db.getActivationCodes(testCode);
    expect(codes[0].machineId).toBe(testMachineId);
  });

  it("should fail if bound to another machine", async () => {
    const caller = appRouter.createCaller({ user: null } as any);
    const result = await caller.auth.verify({ code: testCode, machineId: "OTHER-MACHINE" });
    expect(result.success).toBe(false);
    expect(result.message).toBe("激活码已绑定到其他设备");
  });

  it("should succeed if same machine verifies again", async () => {
    const caller = appRouter.createCaller({ user: null } as any);
    const result = await caller.auth.verify({ code: testCode, machineId: testMachineId });
    expect(result.success).toBe(true);
  });
});
