import { describe, expect, it } from "vitest";
import { languageMessages } from "../client/src/contexts/LanguageContext";

describe("admin language messages", () => {
  it("defaults to the simplified Chinese copy", () => {
    expect(languageMessages["zh-CN"].adminDashboard).toBe("管理后台");
    expect(languageMessages["zh-CN"].generate).toBe("生成激活码");
    expect(languageMessages["zh-CN"].licenses).toBe("授权码管理");
  });

  it("contains the same translation keys in Chinese and English", () => {
    const chineseKeys = Object.keys(languageMessages["zh-CN"]).sort();
    const englishKeys = Object.keys(languageMessages["en-US"]).sort();
    expect(englishKeys).toEqual(chineseKeys);
  });

  it("keeps dynamic generation copy ready for interpolation", () => {
    const template = languageMessages["zh-CN"].generated;
    expect(template.replace("{count}", "3")).toBe("成功生成 3 个激活码");
  });
});
