import { UNAUTHED_ERR_MSG } from "@shared/const";
import { TRPCClientError } from "@trpc/client";

type RedirectLocation = Pick<Location, "pathname" | "replace">;

export function redirectToCustomLoginIfUnauthorized(
  error: unknown,
  location: RedirectLocation | undefined = typeof window === "undefined" ? undefined : window.location,
): boolean {
  if (!(error instanceof TRPCClientError)) return false;
  if (!location) return false;
  if (error.message !== UNAUTHED_ERR_MSG) return false;
  if (location.pathname === "/login") return false;

  location.replace("/login");
  return true;
}
