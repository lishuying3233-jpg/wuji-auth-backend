import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import * as db from "./db";

describe("activation.generate duration flow", () => {
  it("writes every supported duration through the real router", async () => {
    const caller = appRouter.createCaller({
      user: { id: 1, username: "duration-test", role: "super" },
    } as any);
    const durations = [1, 3, 7, 30, 90, 365];

    for (const durationDays of durations) {
      const prefix = `D${Date.now().toString(36).toUpperCase()}${durationDays}`;
      const generated = await caller.activation.generate({
        prefix,
        note: "duration regression",
        durationDays,
        count: 1,
      });

      expect(generated.success).toBe(true);
      expect(generated.codes).toHaveLength(1);
      expect(generated.codes[0]).toMatch(new RegExp(`^${prefix}-[A-Z0-9]+$`));

      const rows = await db.getActivationCodes(generated.codes[0]);
      expect(rows).toHaveLength(1);
      expect(rows[0].durationDays).toBe(durationDays);
    }
  });

  it("returns unique codes for a real batch generation request", async () => {
    const caller = appRouter.createCaller({
      user: { id: 1, username: "batch-duration-test", role: "super" },
    } as any);
    const prefix = `B${Date.now().toString(36).toUpperCase()}`;
    const generated = await caller.activation.generate({
      prefix,
      note: "batch generation regression",
      durationDays: 30,
      count: 3,
    });

    expect(generated.success).toBe(true);
    expect(generated.codes).toHaveLength(3);
    expect(new Set(generated.codes).size).toBe(3);
    for (const code of generated.codes) {
      expect(code).toMatch(new RegExp(`^${prefix}-[A-Z0-9]+$`));
      const rows = await db.getActivationCodes(code);
      expect(rows).toHaveLength(1);
      expect(rows[0].durationDays).toBe(30);
    }
  });

  it("rejects invalid prefix characters instead of silently rewriting them", async () => {
    const caller = appRouter.createCaller({
      user: { id: 1, username: "prefix-test", role: "super" },
    } as any);

    await expect(
      caller.activation.generate({
        prefix: "CLIENT@NAME",
        note: "invalid prefix",
        durationDays: 7,
        count: 1,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("uses a random four-character prefix when prefix is blank", async () => {
    const caller = appRouter.createCaller({
      user: { id: 1, username: "fallback-test", role: "super" },
    } as any);
    const generated = await caller.activation.generate({
      prefix: "   ",
      note: "random prefix",
      durationDays: 1,
      count: 1,
    });

    expect(generated.codes[0]).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]+$/);
  });
});
