# Load Plan - 100k Leads
Date: 2026-02-13
Goal: validate CRM behavior at 100,000 leads with enterprise-grade UX/performance.

## Target SLOs
- List page first load (p95): <= 1.2s server query + <= 2.0s full paint.
- Pagination next/prev (p95): <= 700ms.
- Search by name (p95): <= 800ms.
- Filter by status/profession (p95): <= 700ms.
- Bulk reassign/delete 1,000 leads (p95): <= 6s end-to-end.
- Error rate under nominal load: < 1%.

## Preconditions
- Migrations applied: `step5_14`, `step5_15`.
- Relevant indexes present (created_at/status/user/profession/specialty/trgm name).
- App running in production mode (`next build && next start`).
- Supabase project sizing aligned (CPU/memory/storage baseline).

## Executable Toolkit Added
- `scripts/perf/seed-leads.mjs`
- `scripts/perf/bench-leads.mjs`
- `scripts/perf/run-100k-ready.mjs`

NPM shortcuts:
- `npm run perf:seed`
- `npm run perf:bench`
- `npm run perf:100k:run`

## Required Environment Variables
Mandatory:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Recommended for full benchmark + fast seed:
- `SUPABASE_SERVICE_ROLE_KEY`

For bulk RPC benchmark with admin context:
- Option A: `PERF_ADMIN_ACCESS_TOKEN`
- Option B: `PERF_ADMIN_EMAIL` + `PERF_ADMIN_PASSWORD`

## Runbook (10k -> 50k -> 100k)
1. 10k smoke
```bash
npm run perf:seed -- --target 10000 --batch 1000
npm run perf:bench -- --loops 20 --page-size 100 --bulk-sample 1000
```

2. 50k intermediate
```bash
npm run perf:seed -- --target 50000 --batch 1000
npm run perf:bench -- --loops 30 --page-size 100 --bulk-sample 1000
```

3. 100k final
```bash
npm run perf:seed -- --target 100000 --batch 1000
npm run perf:bench -- --loops 40 --page-size 100 --bulk-sample 1000
```

Orchestrated run:
```bash
PERF_SEED_TARGET=100000 PERF_BENCH_LOOPS=40 npm run perf:100k:run
```

## Measurement Matrix
### Read Path
- R1: list page query (`created_at desc`, page size 100).
- R2: search on name (`ilike`).
- R3: status filter.
- R4: profession filter.

### Write Path
- W1: bulk assign 1000 via RPC (`bulk_reassign_leads`).
- W2: bulk delete benchmark is validated through same server-side path in app (RPC already integrated).

### Concurrency (manual / external tool)
- C1: 10 concurrent users browsing/filtering.
- C2: 25 concurrent users mixed read/write.
- C3: 50 concurrent users peak read-only.

## Output Interpretation
`perf:bench` prints JSON summary:
- `read.list_p95_ms`
- `read.search_p95_ms`
- `read.filter_status_p95_ms`
- `read.filter_profession_p95_ms`
- `bulk.bulkAssignMs` (if admin token available)

Compare against SLO thresholds above.

## Exit Criteria (Go/No-Go)
Go if all are true:
- SLOs met at 100k for R1-R4 and W1-W2.
- No P0/P1 security issue open.
- Error budget respected (<1% app errors, <0.1% auth errors).
- Backup/restore drill validated.

No-Go if one is false.

## Notes
- Seed script appends synthetic leads; use dedicated staging project.
- In-memory rate-limit in API foundation is a baseline only; for multi-instance use Redis/Upstash.
