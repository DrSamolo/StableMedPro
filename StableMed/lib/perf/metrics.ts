type PerfSample = {
  name: string;
  duration: number;
  at: number;
  route: string;
};

type PerfSummary = {
  name: string;
  count: number;
  avg: number;
  p50: number;
  p95: number;
  min: number;
  max: number;
};

const marks = new Map<string, number>();
const PERF_STORAGE_KEY = "__stablemed_perf_samples_v1";
const NAV_RECORDED_KEY_PREFIX = "__stablemed_perf_nav_recorded__";
const MAX_SAMPLES = 1200;
let currentRoute = "unknown";
let initialized = false;

function isPerfEnabled() {
  return process.env.NODE_ENV !== "production" && typeof window !== "undefined";
}

function safeReadSamples(): PerfSample[] {
  if (!isPerfEnabled()) return [];
  try {
    const raw = window.localStorage.getItem(PERF_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PerfSample[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function safeWriteSamples(samples: PerfSample[]) {
  if (!isPerfEnabled()) return;
  try {
    window.localStorage.setItem(PERF_STORAGE_KEY, JSON.stringify(samples.slice(-MAX_SAMPLES)));
  } catch {
    // noop
  }
}

function percentile(sortedValues: number[], p: number) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.floor((p / 100) * (sortedValues.length - 1))),
  );
  return sortedValues[index] ?? 0;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

export function setPerfRoute(route: string) {
  if (!isPerfEnabled()) return;
  currentRoute = route || "unknown";
}

export function perfRecord(name: string, durationMs: number, route = currentRoute) {
  if (!isPerfEnabled()) return;
  const sample: PerfSample = {
    name,
    duration: round1(durationMs),
    at: Date.now(),
    route,
  };
  const samples = safeReadSamples();
  samples.push(sample);
  safeWriteSamples(samples);
  console.debug(`[perf] ${name}: ${sample.duration}ms route=${sample.route}`);
}

export function perfStart(name: string) {
  if (!isPerfEnabled()) return;
  marks.set(name, performance.now());
}

export function perfEnd(name: string) {
  if (!isPerfEnabled()) return;
  const start = marks.get(name);
  if (!start) return;
  const duration = performance.now() - start;
  marks.delete(name);
  perfRecord(name, duration);
}

export function clearPerfSamples() {
  if (!isPerfEnabled()) return;
  window.localStorage.removeItem(PERF_STORAGE_KEY);
  try {
    const keysToDelete: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const key = window.sessionStorage.key(i);
      if (key && key.startsWith(NAV_RECORDED_KEY_PREFIX)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach((key) => window.sessionStorage.removeItem(key));
  } catch {
    // noop
  }
}

export function getPerfSamples() {
  return safeReadSamples();
}

export function getPerfSummary() {
  const groups = new Map<string, number[]>();
  for (const sample of safeReadSamples()) {
    const values = groups.get(sample.name) ?? [];
    values.push(sample.duration);
    groups.set(sample.name, values);
  }

  const summary: PerfSummary[] = [];
  for (const [name, values] of groups.entries()) {
    const sorted = [...values].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, value) => acc + value, 0);
    summary.push({
      name,
      count: sorted.length,
      avg: round1(sum / sorted.length),
      p50: round1(percentile(sorted, 50)),
      p95: round1(percentile(sorted, 95)),
      min: round1(sorted[0] ?? 0),
      max: round1(sorted[sorted.length - 1] ?? 0),
    });
  }

  return summary.sort((a, b) => b.p95 - a.p95);
}

export function initPerfTools() {
  if (!isPerfEnabled() || initialized) return;
  initialized = true;
  if (typeof window !== "undefined" && window.location?.pathname) {
    currentRoute = window.location.pathname;
  }
  const api = {
    clear: clearPerfSamples,
    samples: getPerfSamples,
    summary: getPerfSummary,
  };
  (window as Window & { __stablemedPerf?: typeof api }).__stablemedPerf = api;
}

export function recordNavigationMetricsOnce(route = currentRoute) {
  if (!isPerfEnabled()) return;

  const navEntry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (!navEntry) return;

  const navId = `${NAV_RECORDED_KEY_PREFIX}${Math.round(navEntry.startTime)}-${Math.round(navEntry.responseStart)}`;
  try {
    if (window.sessionStorage.getItem(navId) === "1") {
      return;
    }
    window.sessionStorage.setItem(navId, "1");
  } catch {
    // Continue without dedupe if storage is unavailable.
  }

  perfRecord("nav.ttfb", navEntry.responseStart, route);
  perfRecord("nav.dom_content_loaded", navEntry.domContentLoadedEventEnd, route);
  perfRecord("nav.load_event", navEntry.loadEventEnd, route);
}
