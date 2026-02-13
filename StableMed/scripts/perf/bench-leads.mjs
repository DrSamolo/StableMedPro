import { getAdminAccessToken, nowMs, p95, parseArgs, postgrest, requiredEnv, roundMs } from "./common.mjs";

function qs(params) {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    search.set(k, String(v));
  }
  return search.toString();
}

async function fetchSampleLeadIds({ baseUrl, apikey, bearer, limit = 1000 }) {
  const query = qs({ select: "id", order: "created_at.desc", limit });
  const { payload } = await postgrest({
    baseUrl,
    path: `/rest/v1/leads?${query}`,
    apikey,
    bearer,
  });
  if (!Array.isArray(payload)) return [];
  return payload.map((r) => r.id).filter(Boolean);
}

async function fetchSampleTargetUsers({ baseUrl, apikey, bearer, limit = 5 }) {
  const query = qs({ select: "id", order: "created_at.asc", limit });
  const { payload } = await postgrest({
    baseUrl,
    path: `/rest/v1/profiles?${query}`,
    apikey,
    bearer,
  });
  if (!Array.isArray(payload)) return [];
  return payload.map((r) => r.id).filter(Boolean);
}

async function timed(fn) {
  const t0 = nowMs();
  await fn();
  return nowMs() - t0;
}

async function benchReadPath({ baseUrl, apikey, bearer, loops, pageSize }) {
  const timings = {
    list: [],
    search: [],
    filter_status: [],
    filter_profession: [],
  };

  for (let i = 0; i < loops; i += 1) {
    timings.list.push(
      await timed(async () => {
        const query = qs({
          select: "id,user_id,name,profession,specialty,location,status,created_at",
          order: "created_at.desc",
          limit: pageSize,
          offset: i * pageSize,
        });
        await postgrest({ baseUrl, path: `/rest/v1/leads?${query}`, apikey, bearer });
      }),
    );

    timings.search.push(
      await timed(async () => {
        const query = qs({
          select: "id,name",
          name: "ilike.*Lead*",
          order: "created_at.desc",
          limit: pageSize,
        });
        await postgrest({ baseUrl, path: `/rest/v1/leads?${query}`, apikey, bearer });
      }),
    );

    timings.filter_status.push(
      await timed(async () => {
        const query = qs({
          select: "id,status",
          status: "eq.new",
          order: "created_at.desc",
          limit: pageSize,
        });
        await postgrest({ baseUrl, path: `/rest/v1/leads?${query}`, apikey, bearer });
      }),
    );

    timings.filter_profession.push(
      await timed(async () => {
        const query = qs({
          select: "id,profession",
          profession: "eq.Profession 001",
          order: "created_at.desc",
          limit: pageSize,
        });
        await postgrest({ baseUrl, path: `/rest/v1/leads?${query}`, apikey, bearer });
      }),
    );
  }

  return timings;
}

async function benchBulkPath({ baseUrl, anonKey, adminToken, sampleSize }) {
  if (!adminToken) {
    return {
      skipped: true,
      reason: "No admin token available (set PERF_ADMIN_EMAIL/PERF_ADMIN_PASSWORD or PERF_ADMIN_ACCESS_TOKEN)",
    };
  }

  const leadIds = await fetchSampleLeadIds({
    baseUrl,
    apikey: anonKey,
    bearer: adminToken,
    limit: sampleSize,
  });
  const targetUsers = await fetchSampleTargetUsers({
    baseUrl,
    apikey: anonKey,
    bearer: adminToken,
    limit: 3,
  });

  if (leadIds.length === 0 || targetUsers.length === 0) {
    return { skipped: true, reason: "Insufficient leads/users for bulk benchmark" };
  }

  const assignMs = await timed(async () => {
    await postgrest({
      baseUrl,
      path: "/rest/v1/rpc/bulk_reassign_leads",
      method: "POST",
      apikey: anonKey,
      bearer: adminToken,
      body: {
        p_lead_ids: leadIds,
        p_target_user_ids: targetUsers,
      },
    });
  });

  return {
    skipped: false,
    sampleSize: leadIds.length,
    bulkAssignMs: roundMs(assignMs),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const loops = Number(args.loops ?? 20);
  const pageSize = Number(args["page-size"] ?? 100);
  const bulkSample = Number(args["bulk-sample"] ?? 1000);

  const baseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const readBearer = serviceRole || anonKey;

  let adminToken = process.env.PERF_ADMIN_ACCESS_TOKEN || null;
  if (!adminToken && process.env.PERF_ADMIN_EMAIL && process.env.PERF_ADMIN_PASSWORD) {
    adminToken = await getAdminAccessToken({
      baseUrl,
      anonKey,
      email: process.env.PERF_ADMIN_EMAIL,
      password: process.env.PERF_ADMIN_PASSWORD,
    });
  }

  console.log(`[bench] loops=${loops} pageSize=${pageSize} bulkSample=${bulkSample}`);

  const readTimings = await benchReadPath({
    baseUrl,
    apikey: serviceRole || anonKey,
    bearer: readBearer,
    loops,
    pageSize,
  });

  const bulkTimings = await benchBulkPath({
    baseUrl,
    anonKey,
    adminToken,
    sampleSize: bulkSample,
  });

  const summary = {
    read: {
      list_p95_ms: roundMs(p95(readTimings.list)),
      search_p95_ms: roundMs(p95(readTimings.search)),
      filter_status_p95_ms: roundMs(p95(readTimings.filter_status)),
      filter_profession_p95_ms: roundMs(p95(readTimings.filter_profession)),
      list_runs: readTimings.list.length,
    },
    bulk: bulkTimings,
  };

  console.log("[bench] summary");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error("[bench] failed", error);
  process.exit(1);
});
