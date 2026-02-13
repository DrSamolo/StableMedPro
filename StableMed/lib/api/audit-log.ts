export function logApiEvent(input: {
  requestId: string;
  route: string;
  action: string;
  actorId?: string | null;
  ok: boolean;
  meta?: Record<string, unknown>;
}) {
  const payload = {
    ts: new Date().toISOString(),
    request_id: input.requestId,
    route: input.route,
    action: input.action,
    actor_id: input.actorId ?? null,
    ok: input.ok,
    meta: input.meta ?? {},
  };

  console.log(`[api-audit] ${JSON.stringify(payload)}`);
}
