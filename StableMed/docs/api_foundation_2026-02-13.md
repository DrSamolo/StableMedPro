# API Foundation (Enterprise Baseline)
Date: 2026-02-13

## Included
- `lib/api/errors.ts`: typed API errors.
- `lib/api/response.ts`: standard JSON response envelope + request id header.
- `lib/api/validation.ts`: zod validation helper.
- `lib/api/rate-limit.ts`: in-memory rate-limit (baseline, single-instance).
- `lib/api/auth.ts`: auth/admin guards for API routes.
- `lib/api/handler.ts`: route wrapper (request id, rate-limit, error normalization).
- `lib/api/audit-log.ts`: structured audit log helper.
- `app/api/health/route.ts`: public health endpoint example.
- `app/api/me/route.ts`: authenticated endpoint example.
- `lib/supabase/route-handler-client.ts`: Supabase client for route handlers.

## Response Contract
- Success:
```json
{ "ok": true, "request_id": "...", "data": {...} }
```
- Error:
```json
{ "ok": false, "request_id": "...", "error": { "code": "...", "message": "...", "details": {} } }
```

## Notes
- Current rate limit is process-memory and per-instance.
- For horizontal scale, replace with Redis/Upstash rate-limit.
- This foundation does not change existing business logic/UI.
