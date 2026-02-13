import type { NextRequest } from "next/server";

import { requireApiUser } from "@/lib/api/auth";
import { withApiGuard } from "@/lib/api/handler";
import { logApiEvent } from "@/lib/api/audit-log";

export const GET = withApiGuard(
  {
    rateLimit: {
      max: 60,
      windowMs: 60_000,
      keyPrefix: "api:me",
    },
  },
  async ({ requestId }: { request: NextRequest; requestId: string }) => {
    const { supabase, user } = await requireApiUser();
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id,email,full_name,role,team_id")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      logApiEvent({
        requestId,
        route: "/api/me",
        action: "read_profile",
        actorId: user.id,
        ok: false,
        meta: { error: error.message },
      });
      throw new Error(error.message);
    }

    logApiEvent({
      requestId,
      route: "/api/me",
      action: "read_profile",
      actorId: user.id,
      ok: true,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
      },
      profile,
    };
  },
);
