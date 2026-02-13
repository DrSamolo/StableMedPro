import type { NextRequest } from "next/server";

import { withApiGuard } from "@/lib/api/handler";

export const GET = withApiGuard(
  {
    rateLimit: {
      max: 120,
      windowMs: 60_000,
      keyPrefix: "api:health",
    },
  },
  async (_ctx: { request: NextRequest; requestId: string }) => {
    return {
      status: "ok",
      service: "stablemed-crm",
      now: new Date().toISOString(),
    };
  },
);
