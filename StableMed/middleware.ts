import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { resolveAdminGuardDecision } from "./lib/server/admin-access";
import { createSupabaseMiddlewareClient } from "./lib/supabase/middleware-client";

const LOGIN_PATH = "/login";
const UNAUTHORIZED_PATH = "/unauthorized";

function redirectWithSupabaseCookies(
  req: NextRequest,
  responseWithCookies: NextResponse,
  destinationPath: string,
): NextResponse {
  const redirectResponse = NextResponse.redirect(new URL(destinationPath, req.url));

  for (const cookie of responseWithCookies.cookies.getAll()) {
    redirectResponse.cookies.set(cookie);
  }

  return redirectResponse;
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { supabase, getResponse } = createSupabaseMiddlewareClient(req);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const unauthenticatedDecision = resolveAdminGuardDecision({
    pathname: req.nextUrl.pathname,
    isAuthenticated: Boolean(user),
  });

  if (unauthenticatedDecision === "redirect_login") {
    return redirectWithSupabaseCookies(req, getResponse(), LOGIN_PATH);
  }

  if (unauthenticatedDecision === "allow") {
    return getResponse();
  }

  if (!user?.id) {
    return redirectWithSupabaseCookies(req, getResponse(), LOGIN_PATH);
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    return redirectWithSupabaseCookies(req, getResponse(), UNAUTHORIZED_PATH);
  }

  const decision = resolveAdminGuardDecision({
    pathname: req.nextUrl.pathname,
    isAuthenticated: true,
    profileRole: (profile as { role?: string | null } | null)?.role,
  });

  if (decision === "allow") {
    return getResponse();
  }

  return redirectWithSupabaseCookies(req, getResponse(), UNAUTHORIZED_PATH);
}

export const config = {
  matcher: ["/admin/:path*"],
};
