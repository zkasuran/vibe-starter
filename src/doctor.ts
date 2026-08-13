import { privateKeyToAccount } from "viem/accounts";
import { createClient } from "./client";
import { readConfig } from "./config";

type Chain = {
  chainId: number;
  name: string;
  symbol: string;
  isTestnet: boolean;
  isEnabled: boolean;
  explorerUrl: string;
};

const ok = (s: string): string => `  ok   ${s}`;
const fail = (s: string): string => `  FAIL ${s}`;
const info = (s: string): string => `       ${s}`;

async function main(): Promise<void> {
  const cfg = readConfig();
  const { api } = createClient(cfg.base);
  let failures = 0;

  console.log("KeeperHub quickstart doctor");
  console.log(`base URL: ${cfg.base}`);
  console.log(`chain:    ${cfg.chainId}`);

  console.log("\n1. base URL shape");
  if (/\/api$/.test(cfg.base)) {
    failures += 1;
    console.log(fail("base URL ends with /api; documented paths already include it"));
    console.log(info("use https://app.keeperhub.com, not .../api"));
  } else {
    console.log(ok("no trailing /api"));
  }

  console.log("\n2. connectivity (GET /api/chains, public)");
  const chainsRes = await api<Chain[]>("/api/chains");
  if (chainsRes.status !== 200 || !Array.isArray(chainsRes.body)) {
    failures += 1;
    console.log(fail(`GET /api/chains -> ${chainsRes.status}`));
  } else {
    const chains = chainsRes.body;
    console.log(ok(`GET /api/chains -> 200, ${chains.length} chains`));
    const chosen = chains.find((c) => c.chainId === cfg.chainId);
    if (!chosen) {
      failures += 1;
      console.log(fail(`chain ${cfg.chainId} is not in the catalog`));
    } else if (!chosen.isEnabled) {
      failures += 1;
      console.log(fail(`chain ${chosen.name} (${chosen.chainId}) is not enabled`));
    } else {
      console.log(ok(`chain ${chosen.name} (${chosen.chainId}) enabled, testnet=${chosen.isTestnet}`));
      if (!chosen.isTestnet) {
        console.log(info("mainnet: the zero-value first run is safe, value transfers spend real funds"));
      }
    }
  }

  console.log("\n3. doubled /api/api prefix guard (GET /api/api/chains)");
  const doubled = await api<{ error?: string; hint?: string }>("/api/api/chains");
  if (doubled.status === 404 && doubled.body.error === "doubled_api_prefix") {
    console.log(ok("GET /api/api/chains -> 404 error=doubled_api_prefix"));
    if (doubled.body.hint) {
      console.log(info(doubled.body.hint));
    }
  } else {
    console.log(info(`GET /api/api/chains -> ${doubled.status} (guard shape may differ)`));
  }

  console.log("\n4. signing key");
  const pk = process.env.ETH_PRIVATE_KEY;
  if (!pk) {
    console.log(info("ETH_PRIVATE_KEY not set. doctor runs without it; the onboard run needs it"));
    console.log(info("make a throwaway one: npm run keygen"));
  } else {
    try {
      const account = privateKeyToAccount(pk as `0x${string}`);
      console.log(ok(`ETH_PRIVATE_KEY parses, login address ${account.address}`));
    } catch {
      failures += 1;
      console.log(fail("ETH_PRIVATE_KEY is not a valid 0x-prefixed 32-byte key"));
    }
  }

  console.log("");
  if (failures > 0) {
    console.log(`doctor: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("doctor: all checks passed. Next: npm start");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
