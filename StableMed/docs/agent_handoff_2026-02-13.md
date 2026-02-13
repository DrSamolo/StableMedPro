# Agent Handoff - Maintenance & Upgrade Context
Date: 2026-02-13
Status: pre-prod ready baseline (pending formal 100k proof run)

## Scope of Recent Hardening
This repository includes recent hardening and scale-prep changes. A new agent should read this file first before touching auth/middleware/leads bulk/chat membership.

### Applied migrations (must exist in DB)
- `20260213_step5_14_security_performance_hardening.sql`
- `20260213_step5_15_bulk_leads_ops_and_edge_auth.sql`

If app behavior differs from expected, verify these two migrations are actually applied in the target environment.

## Key Architectural Notes
1. Auth + middleware contract
- Middleware now protects `/dashboard/*` (auth required) and `/admin/*` (admin role required).
- Browser Supabase client must be cookie-compatible for middleware session checks.
- File anchors:
  - `lib/supabase.ts` (uses `createBrowserClient`)
  - `middleware.ts`
  - `lib/server/admin-access.ts`

2. Invitations security model
- Public read policy by token was removed.
- Registration flow uses constrained RPC:
  - `get_invitation_signup_context(p_token)`
  - `consume_invitation_token(p_token)` with expiry checks.
- File anchors:
  - `components/auth/register-page.tsx`
  - migration `step5_14`

3. Leads bulk operations
- UI bulk assign/delete now call server RPCs (not N client updates/deletes):
  - `bulk_reassign_leads(UUID[], UUID[])`
  - `bulk_delete_leads(UUID[])`
- File anchors:
  - `components/leads/leads-page.tsx`
  - migration `step5_15`

4. Chat group member add
- Unsafe fallback direct upsert was removed.
- Add-members must pass via RPC access matrix.
- File anchor:
  - `components/chat/chat-conversation-view.tsx`

5. Edge function auth hardening
- `scan-inactive-leads` now requires authorized caller.
- Env var supported: `SCAN_INACTIVE_LEADS_TOKEN`.
- File anchor:
  - `supabase/functions/scan-inactive-leads/index.ts`

6. Web security headers
- Security headers are configured in `next.config.ts`.
- CSP is currently `Report-Only` (intentional, non-breaking stage).

## Maintenance Checklist (before changing auth/security/perf)
- Validate middleware/auth flow with a real login/logout cycle.
- Ensure `createBrowserClient` is not replaced with plain `createClient` in browser paths.
- Keep route handlers/server actions on shared API/error/auth conventions.
- For scale-sensitive changes, prefer DB-side RPCs over client-side loops.

## Upgrade Backlog (planned, non-blocking)
1. Run full 100k benchmark and capture p95/p99 evidence.
2. Move API rate limiting from in-memory to shared store (Redis/Upstash).
3. Move CSP from report-only to enforcing after report analysis.
4. Add periodic RLS regression checks in CI against latest migrations.
5. Add structured request-id correlation across middleware, API and edge logs.

## If Something Breaks (triage order)
1. Confirm migrations `step5_14` and `step5_15` applied.
2. Check browser client in `lib/supabase.ts` still uses `createBrowserClient`.
3. Check middleware matcher/decisions (`/dashboard`, `/admin`).
4. Check Supabase env vars and auth cookies in browser devtools.
5. Only then inspect feature-level components.
