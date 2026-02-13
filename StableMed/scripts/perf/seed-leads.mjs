import { parseArgs, postgrest, requiredEnv } from "./common.mjs";

const PROFESSIONS = Array.from({ length: 260 }, (_, i) => `Profession ${String(i + 1).padStart(3, "0")}`);
const CITIES = ["Paris", "Lyon", "Marseille", "Nantes", "Lille", "Toulouse", "Nice", "Bordeaux", "Rennes", "Strasbourg"];
const STATUSES = ["new", "contacted", "qualified", "closed", "lost"];

function pick(list, i) {
  return list[i % list.length];
}

function leadRow(idx, ownerId, runId) {
  const first = `Lead${runId}${idx}`;
  const last = `User${idx}`;
  const status = pick(STATUSES, idx);

  return {
    user_id: ownerId,
    name: `${first} ${last}`,
    first_name: first,
    last_name: last,
    profession: pick(PROFESSIONS, idx),
    specialty: pick(PROFESSIONS, idx + 17),
    location: pick(CITIES, idx + 3),
    email: `lead_${runId}_${idx}@example.test`,
    phone: `+336${String(10000000 + (idx % 89999999)).slice(0, 8)}`,
    status,
    is_pipeline: false,
    client_reference: `REF-${runId}-${idx}`,
  };
}

async function resolveOwnerId({ baseUrl, apikey, bearer, explicitOwnerId }) {
  if (explicitOwnerId) return explicitOwnerId;

  const { payload } = await postgrest({
    baseUrl,
    path: "/rest/v1/profiles?select=id,role&order=created_at.asc&limit=1",
    apikey,
    bearer,
  });

  if (!Array.isArray(payload) || payload.length === 0 || !payload[0]?.id) {
    throw new Error("No profiles found. Provide --owner-id explicitly.");
  }

  return payload[0].id;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = Number(args.target ?? 10000);
  const batch = Number(args.batch ?? 1000);

  if (!Number.isFinite(target) || target <= 0) throw new Error("--target must be > 0");
  if (!Number.isFinite(batch) || batch <= 0 || batch > 5000) throw new Error("--batch must be between 1 and 5000");

  const baseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRole = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const ownerId = await resolveOwnerId({
    baseUrl,
    apikey: serviceRole,
    bearer: serviceRole,
    explicitOwnerId: args["owner-id"],
  });

  const runId = Date.now().toString(36);
  let inserted = 0;

  console.log(`[seed] target=${target} batch=${batch} owner=${ownerId} run=${runId}`);

  while (inserted < target) {
    const size = Math.min(batch, target - inserted);
    const rows = Array.from({ length: size }, (_, i) => leadRow(inserted + i + 1, ownerId, runId));

    await postgrest({
      baseUrl,
      path: "/rest/v1/leads",
      method: "POST",
      apikey: serviceRole,
      bearer: serviceRole,
      body: rows,
      prefer: "return=minimal",
    });

    inserted += size;
    console.log(`[seed] inserted ${inserted}/${target}`);
  }

  console.log(`[seed] done. inserted=${inserted}`);
}

main().catch((error) => {
  console.error("[seed] failed", error);
  process.exit(1);
});
