import { describe, expect, it } from "vitest";
import {
  getPlanNameByDuration,
  isSupportedPlanDuration,
  LICENSE_DURATION_DAYS,
} from "../shared/payment_const";

describe("subscription plan mapping", () => {
  it("maps every supported duration to its exact plan name", () => {
    expect(getPlanNameByDuration(1)).toBe("体验卡");
    expect(getPlanNameByDuration(3)).toBe("三天卡");
    expect(getPlanNameByDuration(7)).toBe("周卡");
    expect(getPlanNameByDuration(30)).toBe("月卡");
    expect(getPlanNameByDuration(90)).toBe("季卡");
    expect(getPlanNameByDuration(365)).toBe("年卡");
  });

  it("does not mislabel a nonstandard historical duration as an annual plan", () => {
    expect(getPlanNameByDuration(14)).toBe("14 天卡");
    expect(getPlanNameByDuration(undefined)).toBe("未知套餐");
  });

  it("accepts only durations listed in the canonical plan catalog", () => {
    expect(LICENSE_DURATION_DAYS).toEqual([1, 3, 7, 30, 90, 365]);
    expect(isSupportedPlanDuration(3)).toBe(true);
    expect(isSupportedPlanDuration(365)).toBe(true);
    expect(isSupportedPlanDuration(14)).toBe(false);
    expect(isSupportedPlanDuration(3.5)).toBe(false);
  });
});
