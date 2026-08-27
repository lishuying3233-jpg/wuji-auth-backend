import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  getAdminByUsername: vi.fn(),
  getAdminById: vi.fn(),
}));

import { appRouter } from "./routers";
import * as db from "./db";
import { sdk } from "./_core/sdk";

const admin = {
  id: 7,
  username: "test-admin",
  passwordHash: "test-password",
  role: "super" as const,
  permissions: "[\"generate\"]",
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeContext() {
  return {
    user: null,
    req: { protocol: "https", headers: {} },
    res: { cookie: vi.fn(), clearCookie: vi.fn() },
  } as any;
}

describe("independent administrator authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs in with the custom account and creates a session cookie", async () => {
    vi.mocked(db.getAdminByUsername).mockResolvedValue(admin as any);
    vi.mocked(db.getAdminById).mockResolvedValue(admin as any);
    const context = makeContext();
    const caller = appRouter.createCaller(context);

    const result = await caller.auth.login({ username: "test-admin", password: "test-password" });
    const token = context.res.cookie.mock.calls[0]?.[1];

    expect(result).toEqual({ success: true, user: { id: 7, username: "test-admin", role: "super" } });
    expect(token).toEqual(expect.any(String));
    expect(context.res.cookie).toHaveBeenCalledWith("app_session_id", token, expect.objectContaining({ httpOnly: true, path: "/", secure: true }),);

    const authenticated = await sdk.authenticateRequest({
      protocol: "https",
      headers: { cookie: `app_session_id=${token}` },
    } as any);
    expect((authenticated as any).username).toBe("test-admin");
    expect((authenticated as any).role).toBe("super");
  });

  it("rejects an unknown administrator without opening an OAuth flow", async () => {
    vi.mocked(db.getAdminByUsername).mockResolvedValue(undefined);
    const caller = appRouter.createCaller(makeContext());

    await expect(caller.auth.login({ username: "missing-admin", password: "wrong" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "账号不存在",
    });
  });

  it("clears the custom session cookie on logout", async () => {
    const context = makeContext();
    const caller = appRouter.createCaller(context);

    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
    expect(context.res.clearCookie).toHaveBeenCalledWith("app_session_id", expect.objectContaining({ path: "/" }));
  });
});
