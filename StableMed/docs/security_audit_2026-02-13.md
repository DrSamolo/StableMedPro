# Security Audit - StableMed CRM
Date: 2026-02-13
Scope: frontend, middleware, server actions, Supabase SQL/RLS/RPC, edge functions.
Target: production-ready, enterprise-grade baseline.

## Executive Summary
- Security posture has improved significantly with recent hardening (`step5_14`, `step5_15`, edge auth guard).
- No critical unauthenticated data-write path was found in current app flows.
- Main residual risks are around operational controls (secrets lifecycle, abuse/rate-limit, monitoring), and rollout discipline (ensuring new migrations are applied everywhere).

## Findings by Severity

### P0 (Critical)
- None currently open in inspected code after applied hardening.

### P1 (High)
1. Edge function access depends on token/JWT hygiene.
- File: `supabase/functions/scan-inactive-leads/index.ts`
- Risk: if `SCAN_INACTIVE_LEADS_TOKEN` is weak/reused/leaked, scheduled automation endpoint can be abused.
- Status: mitigated in code (auth required), operational hardening pending.
- Action:
  - use 32+ random bytes token,
  - rotate quarterly,
  - store only in secret manager,
  - alert on 401/5xx spikes for this endpoint.

2. Middleware guard was admin-only; dashboard was not server-enforced.
- File: `middleware.ts` (now fixed)
- Risk: unauthorized users could reach dashboard route shell before client-side checks.
- Status: fixed (`/dashboard/:path*` now requires auth in middleware).

### P2 (Medium)
1. CSP is report-only, not enforcing.
- File: `next.config.ts`
- Risk: protection is observability-first; not yet blocking XSS vectors.
- Action: run report-only 1-2 weeks, then switch to enforce mode with explicit allowlist.

2. Missing explicit API route security baseline because no `app/api/*` currently exists.
- Risk: future API routes may be implemented inconsistently.
- Action: create route template (authn/authz, zod validation, rate-limit, audit log) before first API route goes live.

3. Server actions rely on Supabase auth + RLS (good), but no centralized abuse limits.
- Files: `app/dashboard/*/actions.ts`
- Risk: brute-force/high-frequency action abuse.
- Action: add per-user rate caps at middleware/edge gateway.

### P3 (Low)
1. Security headers are present, but no request-id correlation in responses/logs.
- Action: inject/request-propagate correlation ID for incident forensics.

## Verified Hardening Already Applied
- Invitations:
  - Removed public token read policy.
  - Added constrained RPC `get_invitation_signup_context`.
  - `consume_invitation_token` checks expiration.
  - Files: `supabase/migrations/20260213_step5_14_security_performance_hardening.sql`, `components/auth/register-page.tsx`.
- Chat:
  - Removed unsafe direct fallback upsert for participant addition.
  - File: `components/chat/chat-conversation-view.tsx`.
- Leads bulk operations:
  - Moved mass assign/delete logic to definer RPCs with role/team checks.
  - Files: `supabase/migrations/20260213_step5_15_bulk_leads_ops_and_edge_auth.sql`, `components/leads/leads-page.tsx`.
- Edge function auth:
  - Caller authorization enforced.
  - File: `supabase/functions/scan-inactive-leads/index.ts`.
- Web headers baseline:
  - Added strict headers + CSP report-only.
  - File: `next.config.ts`.
- Middleware:
  - `/dashboard/*` now requires authenticated session; `/admin/*` keeps role enforcement.
  - Files: `middleware.ts`, `lib/server/admin-access.ts`.

## Prod Readiness Security Checklist
- [ ] Apply migrations `step5_14` and `step5_15` in all environments.
- [ ] Configure `SCAN_INACTIVE_LEADS_TOKEN` and rotation policy.
- [ ] Enable alerting: auth failures, RPC errors, edge 401/5xx.
- [ ] Introduce rate-limits for auth-sensitive/write-heavy endpoints.
- [ ] Review CSP reports and move to enforcing CSP.
- [ ] Add periodic RLS regression tests in CI against migration head.
