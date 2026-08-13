import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// Print a fresh throwaway EOA private key and its address. Signing in with this
// wallet on KeeperHub creates the account, its organization and the org wallet.
// It needs no funds for the zero-value first run. Keep the key out of source
// control (paste it into .env, which is gitignored).
const key = generatePrivateKey();
const account = privateKeyToAccount(key);
console.log(`ETH_PRIVATE_KEY=${key}`);
console.log(`# login address: ${account.address}`);
