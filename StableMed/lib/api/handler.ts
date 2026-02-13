import type { NextRequest } from "next/server";

import { ApiError } from "./errors";
import { applyMemoryRateLimit } from "./rate-limit";
import { createRequestId, jsonError, jsonOk } from "./response";

type ApiHandler<T> = (ctx: {
  request: NextRequest;
  requestId: string;
}) => Promise<T>;

export function withApiGuard<T>(
  options: {
    rateLimit?: {
      max: number;
      windowMs: number;
      keyPrefix: string;
    };
  },
  handler: ApiHandler<T>,
) {
  return async function guarded(request: NextRequest) {
    const requestId = createRequestId();

    try {
      if (options.rateLimit) {
        const forwardedFor = request.headers.get("x-forwarded-for") ?? "anon";
        const ip = forwardedFor.split(",")[0]?.trim() || "anon";
        const key = `${options.rateLimit.keyPrefix}:${ip}`;

        const rate = applyMemoryRateLimit({
          key,
          max: options.rateLimit.max,
          windowMs: options.rateLimit.windowMs,
        });

        if (!rate.allowed) {
          throw new ApiError(429, "TOO_MANY_REQUESTS", "Trop de requetes");
        }
      }

      const data = await handler({ request, requestId });
      return jsonOk(data, requestId);
    } catch (error) {
      return jsonError(error, requestId);
    }
  };
}
