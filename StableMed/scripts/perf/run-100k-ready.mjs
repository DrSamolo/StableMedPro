import { spawn } from "node:child_process";

const steps = [
  ["node", ["scripts/perf/seed-leads.mjs", "--target", process.env.PERF_SEED_TARGET || "10000", "--batch", process.env.PERF_SEED_BATCH || "1000"]],
  ["node", ["scripts/perf/bench-leads.mjs", "--loops", process.env.PERF_BENCH_LOOPS || "20", "--page-size", "100", "--bulk-sample", process.env.PERF_BULK_SAMPLE || "1000"]],
];

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", shell: false, env: process.env });
    child.on("exit", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${cmd} ${args.join(" ")} exited with ${code}`));
    });
  });
}

async function main() {
  for (const [cmd, args] of steps) {
    console.log(`\\n[run-100k-ready] ${cmd} ${args.join(" ")}`);
    await run(cmd, args);
  }
  console.log("\\n[run-100k-ready] completed");
}

main().catch((error) => {
  console.error("[run-100k-ready] failed", error.message);
  process.exit(1);
});
