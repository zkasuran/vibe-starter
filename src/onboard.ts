import { privateKeyToAccount } from "viem/accounts";
import { createClient, must } from "./client";
import { readConfig } from "./config";

// Zero to a first verified onchain transaction through KeeperHub, no browser.
// The path follows the documented headless flow:
//   SIWE sign-in (also signs up) -> create org key -> find org wallet
//   -> simulate -> execute -> poll status for the authoritative tx hash.

type NonceResponse = { nonce: string };
type KeyChallenge = { code?: string; challenge?: string; error?: string };
type KeyCreated = { key: string };
type User = { walletAddress: string | null; email?: string };
type SimResult = { success?: boolean; wouldRevert?: boolean; from?: string };
type ExecResult = { executionId: string; status: string };
type StatusResult = {
  executionId: string;
  status: string;
  transactionHash?: string;
  transactionLink?: string;
  sponsored?: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const cfg = readConfig();
  const pk = process.env.ETH_PRIVATE_KEY;
  if (!pk) {
    throw new Error("ETH_PRIVATE_KEY is not set. Run `npm run keygen`, paste it into .env, then retry.");
  }
  const account = privateKeyToAccount(pk as `0x${string}`);
  const { base, api } = createClient(cfg.base);
  console.log(`login address: ${account.address}`);
  console.log(`base: ${base}  chain: ${cfg.chainId}`);

  // 1. Sign in with Ethereum. For an unseen wallet, signing in also signs up.
  // The Chain ID here is part of the login assertion only; it does not decide
  // which chain you execute on.
  const nonce = must(
    await api<NonceResponse>("/api/auth/siwe/nonce", {
      method: "POST",
      body: JSON.stringify({ walletAddress: account.address, chainId: 1 }),
    }),
    "siwe nonce"
  );
  const message = [
    `${new URL(base).host} wants you to sign in with your Ethereum account:`,
    account.address,
    "",
    "Sign in to KeeperHub",
    "",
    `URI: ${base}`,
    "Version: 1",
    "Chain ID: 1",
    `Nonce: ${nonce.nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join("\n");
  must(
    await api("/api/auth/siwe/verify", {
      method: "POST",
      body: JSON.stringify({
        message,
        signature: await account.signMessage({ message }),
        walletAddress: account.address,
        chainId: 1,
      }),
    }),
    "siwe verify"
  );
  console.log("signed in");

  // 2. Create an organization API key. The first POST answers 401 with a
  // challenge to sign. Sign THAT challenge (its nonce is single-use) and repeat.
  const name = `quickstart-${Date.now()}`;
  const first = await api<KeyChallenge>("/api/keys", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  if (first.body.code !== "signature_required" || !first.body.challenge) {
    throw new Error(`expected a signature challenge, got ${first.status} ${JSON.stringify(first.body)}`);
  }
  const created = must(
    await api<KeyCreated>("/api/keys", {
      method: "POST",
      body: JSON.stringify({
        name,
        signature: await account.signMessage({ message: first.body.challenge }),
      }),
    }),
    "create key"
  );
  const auth = { Authorization: `Bearer ${created.key}` };
  console.log(`created org key ${created.key.slice(0, 6)}... (kept in memory only)`);

  // 3. The wallet to fund is the organization wallet, not the login address.
  // Provisioning runs in the background, so walletAddress can be null briefly.
  let user = must(await api<User>("/api/user"), "user");
  for (let i = 0; !user.walletAddress && i < 20; i += 1) {
    await sleep(1500);
    user = must(await api<User>("/api/user"), "user");
  }
  if (!user.walletAddress) {
    throw new Error("no organization wallet provisioned yet, retry shortly");
  }
  console.log(`org wallet: ${user.walletAddress}`);

  // 4. Simulate first, then execute once with an idempotency key. amount "0"
  // by default: an empty org wallet still lands a zero-value self-transfer
  // because the relayer pays the gas on the sponsored chains.
  const recipient = cfg.recipient === "" ? user.walletAddress : cfg.recipient;
  const transfer = { chainId: cfg.chainId, recipientAddress: recipient, amount: cfg.amount };
  const sim = await api<SimResult>("/api/execute/transfer", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ ...transfer, simulate: true }),
  });
  if (sim.status >= 400 || sim.body.success !== true || sim.body.wouldRevert === true) {
    throw new Error(`simulation says this would fail: ${sim.status} ${JSON.stringify(sim.body)}`);
  }
  console.log(`simulated ok (from ${sim.body.from ?? "?"})`);

  const exec = must(
    await api<ExecResult>("/api/execute/transfer", {
      method: "POST",
      headers: { ...auth, "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(transfer),
    }),
    "execute"
  );
  console.log(`execution ${exec.executionId} -> ${exec.status}`);

  // 5. Poll status until terminal. Honor X-Poll-Interval-Hint (0 = terminal),
  // rather than a fixed timer, so a status added after this shipped still works.
  let status: StatusResult | undefined;
  for (let i = 0; i < 40; i += 1) {
    const res = await api<StatusResult>(`/api/execute/${exec.executionId}/status`, { headers: auth });
    if (res.status >= 400) {
      throw new Error(`status: ${res.status} ${JSON.stringify(res.body)}`);
    }
    status = res.body;
    const hint = Number(res.headers.get("X-Poll-Interval-Hint") ?? "2");
    if (hint === 0) {
      break;
    }
    await sleep(Math.max(hint, 1) * 1000);
  }
  if (!status) {
    throw new Error("no status response");
  }

  console.log("");
  console.log(`final status: ${status.status}`);
  console.log(`sponsored: ${status.sponsored ?? "unknown"}`);
  if (status.transactionHash) {
    console.log(`tx hash: ${status.transactionHash}`);
  }
  if (status.transactionLink) {
    console.log(`tx link: ${status.transactionLink}`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
