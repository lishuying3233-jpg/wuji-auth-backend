import { describe, expect, it, vi } from "vitest";
import { TRPCClientError } from "@trpc/client";
import { redirectToCustomLoginIfUnauthorized } from "../client/src/_core/authRedirect";

function makeLocation(pathname: string) {
  return { pathname, replace: vi.fn() } as any;
}

describe("independent admin auth redirect", () => {
  it("redirects an unauthenticated protected request from /admin to /login", () => {
    const location = makeLocation("/admin");
    const error = new TRPCClientError("Please login (10001)");

    expect(redirectToCustomLoginIfUnauthorized(error, location)).toBe(true);
    expect(location.replace).toHaveBeenCalledOnce();
    expect(location.replace).toHaveBeenCalledWith("/login");
  });

  it("does not redirect while already on the custom login page", () => {
    const location = makeLocation("/login");
    const error = new TRPCClientError("Please login (10001)");

    expect(redirectToCustomLoginIfUnauthorized(error, location)).toBe(false);
    expect(location.replace).not.toHaveBeenCalled();
  });

  it("does not redirect unrelated errors to any login provider", () => {
    const location = makeLocation("/admin");
    const error = new TRPCClientError("Database unavailable");

    expect(redirectToCustomLoginIfUnauthorized(error, location)).toBe(false);
    expect(location.replace).not.toHaveBeenCalled();
  });
});
