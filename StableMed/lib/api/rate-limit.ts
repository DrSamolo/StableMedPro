type RateLimitKey = string;

type RateLimitState = {
  count: number;
  windowStart: number;
};

const rateLimitStore = new Map<RateLimitKey, RateLimitState>();

export function applyMemoryRateLimit(input: {
  key: string;
  max: number;
  windowMs: number;
}): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const existing = rateLimitStore.get(input.key);

  if (!existing || now - existing.windowStart >= input.windowMs) {
    rateLimitStore.set(input.key, { count: 1, windowStart: now });
    return { allowed: true, remaining: Math.max(input.max - 1, 0), resetAt: now + input.windowMs };
  }

  if (existing.count >= input.max) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.windowStart + input.windowMs,
    };
  }

  existing.count += 1;
  rateLimitStore.set(input.key, existing);

  return {
    allowed: true,
    remaining: Math.max(input.max - existing.count, 0),
    resetAt: existing.windowStart + input.windowMs,
  };
}
