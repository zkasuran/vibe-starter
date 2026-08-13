import { readFileSync } from "node:fs";

// Load a .env file into process.env without a dependency. Values already present
// in the environment win, so an exported var is never silently overridden.
export function loadEnv(path = ".env"): void {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq < 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) {
      continue;
    }
    let value = trimmed.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

// The base URL must not carry /api: the documented paths already include it, and
// a base of https://app.keeperhub.com/api produces /api/api and a 404.
export function readConfig() {
  loadEnv();
  const rawBase = process.env.KEEPERHUB_BASE_URL ?? "https://app.keeperhub.com";
  const base = rawBase.replace(/\/+$/, "");
  const chainId = Number(process.env.CHAIN_ID ?? "84532");
  const amount = process.env.AMOUNT ?? "0";
  const recipient = process.env.RECIPIENT ?? "";
  return { base, chainId, amount, recipient };
}
