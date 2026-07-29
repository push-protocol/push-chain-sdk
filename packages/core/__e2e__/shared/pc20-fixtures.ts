/**
 * PC20 end-to-end fixtures.
 *
 * PC20 mappings are dynamic — there is no static table to read them from, and
 * the deployed testnet set is not fixed. Every address therefore comes from the
 * environment, and a suite that is missing what it needs skips loudly rather
 * than failing or, worse, silently asserting nothing.
 *
 * Requirements differ by suite, deliberately:
 *
 *   Read-only (registry lookups)  PC20_PUSH_TOKEN
 *   Funds-moving (inbound/export) PC20_PUSH_TOKEN + EVM_PRIVATE_KEY
 *
 * The registry suite needs no signer and moves nothing, so gating it behind a
 * private key would keep the one suite that can run today from running.
 *
 * Environment:
 *
 *   PC20_PUSH_TOKEN          Push-native PC20 on Donut (0x…)          [required]
 *   EVM_PRIVATE_KEY          signer; funds-moving suites only
 *   PC20_WRAPPER_SEPOLIA     deployed wrapper on Ethereum Sepolia     [optional]
 *   PC20_EXPORT_DEST_CHAIN   CAIP-2 id; defaults to Ethereum Sepolia  [optional]
 *   PC20_UNDEPLOYED_TOKEN    a Push PC20 never exported anywhere      [optional]
 *
 * `PC20_WRAPPER_SEPOLIA` is optional because it does not exist until a first
 * export creates it. Tests needing it skip individually and say so.
 */

import { CHAIN } from '../../src/lib/constants/enums';

export type PC20ReadFixtures = {
  pushToken: `0x${string}`;
  /** Absent until a first export has deployed one. */
  wrapperSepolia?: `0x${string}`;
  exportDestChain: CHAIN;
  undeployedToken?: `0x${string}`;
};

export type PC20Fixtures = PC20ReadFixtures & {
  privateKey: `0x${string}`;
};

function common(): PC20ReadFixtures | null {
  const pushToken = process.env['PC20_PUSH_TOKEN'] as `0x${string}` | undefined;
  if (!pushToken) return null;

  return {
    pushToken,
    wrapperSepolia: process.env['PC20_WRAPPER_SEPOLIA'] as `0x${string}` | undefined,
    exportDestChain:
      (process.env['PC20_EXPORT_DEST_CHAIN'] as CHAIN) ?? CHAIN.ETHEREUM_SEPOLIA,
    undeployedToken: process.env['PC20_UNDEPLOYED_TOKEN'] as `0x${string}` | undefined,
  };
}

/** Fixtures for read-only suites. No signer required. */
export function getPC20ReadFixtures(): PC20ReadFixtures | null {
  return common();
}

/** Fixtures for suites that sign and broadcast. */
export function getPC20Fixtures(): PC20Fixtures | null {
  const base = common();
  const privateKey = process.env['EVM_PRIVATE_KEY'] as `0x${string}` | undefined;
  if (!base || !privateKey) return null;
  return { ...base, privateKey };
}

/** Human-readable list of what is missing, for the skip message. */
export function missingPC20Env(requireSigner: boolean): string[] {
  const missing: string[] = [];
  if (!process.env['PC20_PUSH_TOKEN']) missing.push('PC20_PUSH_TOKEN');
  if (requireSigner && !process.env['EVM_PRIVATE_KEY']) missing.push('EVM_PRIVATE_KEY');
  return missing;
}

/**
 * Announce why a suite is skipping.
 *
 * A PC20 suite that quietly no-ops looks identical to one that passed, which is
 * the failure mode worth preventing — these are the tests that would catch a
 * misconfigured deployment.
 */
export function announcePC20Skip(suite: string, requireSigner = true): void {
  const missing = missingPC20Env(requireSigner);
  if (missing.length === 0) return;
  console.log(
    `[SKIP] ${suite} — PC20 environment not configured. Missing: ${missing.join(', ')}`
  );
}

/** Log an individual test skip so it is never mistaken for a pass. */
export function skipNote(what: string, reason: string): void {
  console.log(`[SKIP] ${what} — ${reason}`);
}

// ---------------------------------------------------------------------------
// Live-run helpers
// ---------------------------------------------------------------------------

/**
 * Await a PC20 inbound (wrapper burn) tolerating the KNOWN chain-side
 * fee-credit failure.
 *
 * Chain bug (reported): the prepaid-gas ETH attached to an EVM burn becomes a
 * second inbound whose `depositPRC20Token` credit fails ("intrinsic gas too
 * low" — actually a masked revert; see the chain-team report). The token
 * transfer itself succeeds and conserves value, but the UTX carries a FAILED
 * pcTx, so `wait()` throws `PushChainExecutionError`.
 *
 * Until the chain fix ships, suites assert on balances and treat exactly this
 * failure signature as tolerable. Any other error is rethrown — this must not
 * become a blanket error swallow. Flip `TOLERATE_FEE_CREDIT_BUG` to false once
 * the fix lands to make the suites strict again.
 */
export const TOLERATE_FEE_CREDIT_BUG = true;

function isKnownFeeCreditFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('depositPRC20Token') && msg.includes('intrinsic gas too low');
}

export async function waitToleratingFeeCreditBug(response: {
  wait: () => Promise<unknown>;
}): Promise<void> {
  try {
    await response.wait();
  } catch (err) {
    if (TOLERATE_FEE_CREDIT_BUG && isKnownFeeCreditFailure(err)) {
      console.log('[KNOWN-BUG] fee-credit pcTx failed; proceeding to balance assertions');
      return;
    }
    throw err;
  }
}

/**
 * Run a full send tolerating the fee-credit failure.
 *
 * The R1 funds flow throws the failure from `sendTransaction` itself (the send
 * path polls the UTX and surfaces the FAILED pcTx before returning), so
 * wrapping `wait()` alone is not enough — the caller never receives a response
 * object. By the time the error surfaces the funds credit HAS settled (the
 * error comes from the completed UTX), so balance assertions can run
 * immediately after.
 */
export async function sendToleratingFeeCreditBug<T extends { wait: () => Promise<unknown> }>(
  send: () => Promise<T>
): Promise<{ response?: T; tolerated: boolean }> {
  try {
    const response = await send();
    await waitToleratingFeeCreditBug(response);
    return { response, tolerated: false };
  } catch (err) {
    if (TOLERATE_FEE_CREDIT_BUG && isKnownFeeCreditFailure(err)) {
      console.log('[KNOWN-BUG] fee-credit pcTx failed in send; proceeding to balance assertions');
      return { response: undefined, tolerated: true };
    }
    throw err;
  }
}

/** Poll until `read()` equals `expected`, for post-settlement lag. */
export async function pollUntil(
  read: () => Promise<bigint>,
  expected: bigint,
  { timeoutMs = 120_000, intervalMs = 5_000 } = {}
): Promise<bigint> {
  const deadline = Date.now() + timeoutMs;
  let last = await read();
  while (last !== expected && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    last = await read();
  }
  return last;
}
