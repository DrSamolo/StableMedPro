import { performance } from "node:perf_hooks";

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const entry = argv[i];
    if (!entry.startsWith("--")) continue;
    const key = entry.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

export function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function nowMs() {
  return performance.now();
}

export function roundMs(value) {
  return Math.round(value * 100) / 100;
}

export function p95(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[idx];
}

export async function postgrest({ baseUrl, path, method = "GET", apikey, bearer, body, prefer }) {
  const url = `${baseUrl}${path}`;
  const headers = {
    apikey,
    Authorization: `Bearer ${bearer}`,
  };

  if (prefer) headers.Prefer = prefer;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let payload = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${JSON.stringify(payload)}`);
  }

  return { response, payload };
}

export async function getAdminAccessToken({ baseUrl, anonKey, email, password }) {
  const authUrl = `${baseUrl}/auth/v1/token?grant_type=password`;
  const response = await fetch(authUrl, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  const payload = await response.json();
  if (!response.ok || !payload?.access_token) {
    throw new Error(`Failed to get admin access token: ${JSON.stringify(payload)}`);
  }

  return payload.access_token;
}
