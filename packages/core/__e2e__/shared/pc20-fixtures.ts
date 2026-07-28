/**
 * PC20 end-to-end fixtures.
 *
 * PC20 mappings are dynamic — there is no static table to read them from, and
 * the deployed testnet set is not fixed. Every address therefore comes from the
 * environment, and a suite that is missing what it needs skips loudly rather
 * than failing or, worse, silently asserting nothing.
 *
 * Required environment:
 *
 *   EVM_PRIVATE_KEY          signer, as for the other EVM E2E suites
 *   PC20_PUSH_TOKEN          Push-native PC20 on Donut (0x…)
 *   PC20_WRAPPER_SEPOLIA     deployed wrapper on Ethereum Sepolia (0x…)
 *   PC20_EXPORT_DEST_CHAIN   optional; CAIP-2 id, defaults to Sepolia
 *   PC20_UNDEPLOYED_TOKEN    optional; a Push PC20 never exported anywhere,
 *                            used to exercise the first-export path
 */

import { CHAIN } from '../../src/lib/constants/enums';

export type PC20Fixtures = {
  privateKey: `0x${string}`;
  pushToken: `0x${string}`;
  wrapperSepolia: `0x${string}`;
  exportDestChain: CHAIN;
  undeployedToken?: `0x${string}`;
};

/** Human-readable list of what is missing, for the skip message. */
export function missingPC20Env(): string[] {
  const missing: string[] = [];
  if (!process.env['EVM_PRIVATE_KEY']) missing.push('EVM_PRIVATE_KEY');
  if (!process.env['PC20_PUSH_TOKEN']) missing.push('PC20_PUSH_TOKEN');
  if (!process.env['PC20_WRAPPER_SEPOLIA']) missing.push('PC20_WRAPPER_SEPOLIA');
  return missing;
}

/** Fixtures, or `null` when the environment is not configured for PC20. */
export function getPC20Fixtures(): PC20Fixtures | null {
  if (missingPC20Env().length > 0) return null;

  return {
    privateKey: process.env['EVM_PRIVATE_KEY'] as `0x${string}`,
    pushToken: process.env['PC20_PUSH_TOKEN'] as `0x${string}`,
    wrapperSepolia: process.env['PC20_WRAPPER_SEPOLIA'] as `0x${string}`,
    exportDestChain:
      (process.env['PC20_EXPORT_DEST_CHAIN'] as CHAIN) ?? CHAIN.ETHEREUM_SEPOLIA,
    undeployedToken: process.env['PC20_UNDEPLOYED_TOKEN'] as
      | `0x${string}`
      | undefined,
  };
}

/**
 * Announce why a suite is skipping.
 *
 * A PC20 suite that quietly no-ops looks identical to one that passed, which is
 * the failure mode worth preventing — these are the tests that would catch a
 * misconfigured deployment.
 */
export function announcePC20Skip(suite: string): void {
  const missing = missingPC20Env();
  if (missing.length === 0) return;
  console.log(
    `[SKIP] ${suite} — PC20 environment not configured. Missing: ${missing.join(', ')}`
  );
}
