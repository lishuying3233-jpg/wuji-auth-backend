import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import * as db from "./db";
import {
  canSelectVisibleLicenses,
  clearLicenseSelection,
  selectedVisibleLicenseCount,
  toggleLicenseSelection,
  toggleVisibleLicenseSelection,
} from "../client/src/lib/licenseSelection";

describe("批量删除授权码", () => {
  const caller = () => appRouter.createCaller({
    user: { id: 1, username: "batch-delete-test", role: "super" },
  } as any);

  it("实际调用受保护的 deleteMany tRPC 路由并传递 ID 列表", async () => {
    const deleteSpy = vi.spyOn(db, "deleteActivationCodes").mockResolvedValue(undefined);
    try {
      const result = await caller().activation.deleteMany({ ids: [101, 102, 102] });
      expect(result).toEqual({ success: true, deleted: 2 });
      expect(deleteSpy).toHaveBeenCalledWith([101, 102, 102]);
    } finally {
      deleteSpy.mockRestore();
    }
  });

  it("在 tRPC 输入层拒绝空列表、非正整数和超过 1000 个 ID", async () => {
    await expect(caller().activation.deleteMany({ ids: [] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().activation.deleteMany({ ids: [0] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().activation.deleteMany({ ids: Array.from({ length: 1001 }, (_, index) => index + 1) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("清空选择会返回空数组，供按钮、筛选、搜索和刷新共用", () => {
    const selectedIds = [7, 8, 9];
    expect(clearLicenseSelection()).toEqual([]);
    expect(clearLicenseSelection()).not.toBe(selectedIds);
  });

  it("执行前端单选、当前列表全选、取消选择和上限逻辑", () => {
    expect(toggleLicenseSelection([], 7, true)).toEqual([7]);
    expect(toggleLicenseSelection([7, 8], 7, false)).toEqual([8]);
    expect(toggleVisibleLicenseSelection([1], [2, 3], true)).toEqual([1, 2, 3]);
    expect(toggleVisibleLicenseSelection([1, 2, 3], [2, 3], false)).toEqual([1]);
    expect(selectedVisibleLicenseCount([1, 3], [1, 2, 3])).toBe(2);
    expect(canSelectVisibleLicenses([1], [2, 3])).toBe(true);
    expect(canSelectVisibleLicenses([], Array.from({ length: 1001 }, (_, index) => index + 1))).toBe(false);
  });
});
