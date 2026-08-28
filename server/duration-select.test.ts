import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const adminSource = readFileSync(
  new URL("../client/src/pages/Admin.tsx", import.meta.url),
  "utf8",
);

describe("Admin duration selector", () => {
  it("uses a native select for the license duration menu", () => {
    expect(adminSource).toContain('<select');
    expect(adminSource).toContain('aria-label={t("duration")}');
    expect(adminSource).toContain('onChange={(e) => setDuration(e.target.value)}');
    expect(adminSource).not.toContain('<Select value={duration} onValueChange={setDuration}>');
  });

  it("keeps all supported license durations", () => {
    for (const value of ["1", "3", "7", "30", "90", "365"]) {
      expect(adminSource).toContain(`<option value="${value}">`);
    }
  });

  it("guards generation and reports mutation errors instead of crashing the page", () => {
    expect(adminSource).toContain("const handleGenerate = () =>");
    expect(adminSource).toContain("setGenerationError(t(\"invalidPrefix\"))");
    expect(adminSource).toContain("setGenerationError(t(\"invalidCount\"))");
    expect(adminSource).toContain("onError: (error) =>");
    expect(adminSource).toContain("window.location.reload()");
    expect(adminSource).not.toContain("toast.success(t(\"generated\"");
    expect(adminSource).toContain('data-grammarly="false"');
  });
});
