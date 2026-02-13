import { z } from "zod";

export const ALLOWED_PROFILE_ROLES = ["admin", "manager", "commercial"] as const;

const profileRoleSchema = z.enum(ALLOWED_PROFILE_ROLES);

const adminGuardInputSchema = z.object({
  pathname: z.string().min(1),
  isAuthenticated: z.boolean(),
  profileRole: z.unknown().optional(),
});

export type AdminGuardDecision = "allow" | "redirect_login" | "redirect_unauthorized";
export type RouteGuardDecision = "allow" | "redirect_login" | "redirect_unauthorized";

function normalizeRole(role: unknown): string | null {
  if (typeof role !== "string") {
    return null;
  }

  const normalized = role.trim().toLowerCase();
  if (normalized.length === 0) {
    return null;
  }

  return normalized;
}

export function isAdminRole(role: unknown): boolean {
  const normalized = normalizeRole(role);
  if (!normalized) {
    return false;
  }

  const parsedRole = profileRoleSchema.safeParse(normalized);
  return parsedRole.success && parsedRole.data === "admin";
}

export function resolveAdminGuardDecision(input: {
  pathname: string;
  isAuthenticated: boolean;
  profileRole?: unknown;
}): AdminGuardDecision {
  const parsed = adminGuardInputSchema.parse(input);

  if (!parsed.pathname.startsWith("/admin")) {
    return "allow";
  }

  if (!parsed.isAuthenticated) {
    return "redirect_login";
  }

  return isAdminRole(parsed.profileRole) ? "allow" : "redirect_unauthorized";
}

export function resolveProtectedRouteDecision(input: {
  pathname: string;
  isAuthenticated: boolean;
  profileRole?: unknown;
}): RouteGuardDecision {
  const parsed = adminGuardInputSchema.parse(input);

  if (parsed.pathname.startsWith("/admin")) {
    if (!parsed.isAuthenticated) {
      return "redirect_login";
    }

    return isAdminRole(parsed.profileRole) ? "allow" : "redirect_unauthorized";
  }

  if (parsed.pathname.startsWith("/dashboard")) {
    return parsed.isAuthenticated ? "allow" : "redirect_login";
  }

  return "allow";
}
