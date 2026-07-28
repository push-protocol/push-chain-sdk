/**
 * Outbound transaction sync: polling helpers that wait for outbound
 * transactions to complete on external chains.
 *
 * Extracted from Orchestrator.waitForOutboundTx / waitForAllOutboundTxsV2.
 */

import { resolvePC20WrapperForReceipt } from './pc20/tracking';
import { createPublicClient, fallback, http } from 'viem';
import { CHAIN_INFO, VM_NAMESPACE } from '../../constants/chain';
import { CHAIN, VM } from '../../constants/enums';
import { UniversalTxStatus } from '../../generated/uexecutor/v1/types';
import { OutboundStatus } from '../../generated/uexecutor/v2/types';
import { normalizePcInsufficientFundsError } from '../../formatters';
import type {
  CascadeHopInfo,
  WaitForOutboundOptions,
  OutboundTxDetails,
  TransactionRouteType,
} from '../orchestrator.types';
import type { OrchestratorContext } from './context';
import { printLog } from './context';
import { chainFromNamespace, toExternalTxHashDisplay } from './helpers';
import {
  extractUniversalSubTxIdFromTx,
  extractAllUniversalSubTxIds,
  computeUniversalTxId,
} from './outbound-tracker';

// ============================================================================
// Outbound sync configuration constants
// ============================================================================

/** Initial wait before the first poll (ms). */
export const OUTBOUND_INITIAL_WAIT_MS = 15000; // 15s

/** Interval between consecutive polls (ms). */
export const OUTBOUND_POLL_INTERVAL_MS = 3000; // 3s

/** Maximum total timeout for the outbound polling loop (ms). */
export const OUTBOUND_MAX_TIMEOUT_MS = 300000; // 300s (5 min)

/** Maximum total timeout for the R3 inbound round-trip polling loop (ms). */
export const INBOUND_MAX_TIMEOUT_MS = 300000; // 300s (5 min) — covers R3 inbound latency on testnet

/** Initial wait before the first inbound poll (ms). Validator observation + Push commit + indexer ingestion realistically take 15-25 s on testnet (esp. SVM source), so polling immediately just burns RPC on guaranteed-empty results. */
export const INBOUND_INITIAL_WAIT_MS = 15000;

// ============================================================================
// Typed errors
// ============================================================================

/**
 * Thrown by `waitForOutboundTx` when the polling loop exceeds the configured
 * timeout without observing an external tx hash. Callers can `instanceof`
 * check to distinguish between timeout (→ 299-03) and terminal failure
 * (→ 299-02) without resorting to error-message prefix matching.
 */
export class OutboundTimeoutError extends Error {
  readonly code = 'OUTBOUND_TIMEOUT' as const;
  readonly pushChainTxHash: string;
  readonly elapsedMs: number;
  constructor(pushChainTxHash: string, elapsedMs: number, timeoutMs: number) {
    super(
      `Timeout waiting for outbound transaction. Push Chain TX: ${pushChainTxHash}. Timeout: ${timeoutMs}ms. The relay may still be processing.`
    );
    this.name = 'OutboundTimeoutError';
    this.pushChainTxHash = pushChainTxHash;
    this.elapsedMs = elapsedMs;
  }
}

/**
 * Thrown by `waitForOutboundTx` when the universal tx reaches a terminal
 * failure state or an outbound leg reports REVERTED status. Distinguishes
 * a *failure* (→ 299-02) from a *timeout* (→ 299-03).
 */
export class OutboundFailedError extends Error {
  readonly code = 'OUTBOUND_FAILED' as const;
  readonly pushChainTxHash: string;
  readonly destinationChain?: string;
  /** Observed tx hash on the destination chain (when available). Lets the
   * receipt expose the reverted external tx so consumers can link to the
   * explorer without parsing the error message. */
  readonly externalTxHash?: string;
  constructor(
    message: string,
    pushChainTxHash: string,
    destinationChain?: string,
    externalTxHash?: string
  ) {
    super(message);
    this.name = 'OutboundFailedError';
    this.pushChainTxHash = pushChainTxHash;
    this.destinationChain = destinationChain;
    this.externalTxHash = externalTxHash;
  }
}

// ============================================================================
// waitForOutboundTx
// ============================================================================

/**
 * Source-chain RPC tiebreaker.
 *
 * Cosmos sometimes populates `observedTx.txHash` while the relayer is still
 * voting on the outboundStatus update. The Push indexer can stay at
 * UNSPECIFIED for the full timeout budget even though the destination tx mined
 * minutes earlier. To avoid those false timeouts we ask the destination
 * chain's own RPC: if it has a confirmed receipt with status=success, we
 * trust it and return FOUND; if status=reverted, we throw OutboundFailedError
 * (preserves the silent-success bug fix); if no receipt yet or RPC failure,
 * we keep polling.
 *
 * EVM-only — SVM tiebreaker would need a separate signature lookup path.
 */
async function verifyExternalEvmReceipt(
  ctx: OrchestratorContext,
  destinationChain: CHAIN,
  externalTxHash: string
): Promise<'success' | 'reverted' | 'pending' | 'unsupported'> {
  const chainInfo = CHAIN_INFO[destinationChain];
  if (!chainInfo || chainInfo.vm !== VM.EVM) {
    return 'unsupported';
  }
  // Guard against unit-test contexts that don't pass a real rpcUrls map —
  // we'd otherwise hit live testnet RPC inside Jest.
  if (!ctx.rpcUrls) return 'unsupported';
  const rpcUrls =
    ctx.rpcUrls?.[destinationChain] && ctx.rpcUrls[destinationChain]!.length > 0
      ? ctx.rpcUrls[destinationChain]!
      : chainInfo.defaultRPC;
  if (!rpcUrls?.length) return 'unsupported';

  try {
    const client = createPublicClient({
      transport: fallback(rpcUrls.map((url) => http(url))),
    });
    const receipt = await client.getTransactionReceipt({
      hash: externalTxHash as `0x${string}`,
    });
    if (!receipt) return 'pending';
    if (receipt.status === 'success') return 'success';
    if (receipt.status === 'reverted') return 'reverted';
    return 'pending';
  } catch (err) {
    // viem throws TransactionReceiptNotFoundError when the tx isn't mined
    // yet — treat as 'pending' rather than 'unsupported' so we keep polling.
    const msg = err instanceof Error ? err.message : String(err);
    if (/not found|TransactionReceiptNotFound|could not be found/i.test(msg)) {
      return 'pending';
    }
    printLog(
      ctx,
      `[verifyExternalEvmReceipt] RPC error for ${destinationChain} tx ${externalTxHash}: ${msg}`
    );
    return 'pending';
  }
}

/**
 * Wait for outbound transaction to complete and return external chain details.
 * @internal Used by .wait() for outbound routes - not part of public API.
 * Uses polling with configurable initial wait, interval, and timeout.
 *
 * Default strategy: 15s initial wait, then poll every 3s, 300s total timeout.
 *
 * @param ctx - Orchestrator context
 * @param pushChainTxHash - The Push Chain transaction hash
 * @param options - Polling configuration options
 * @returns External chain tx details
 * @throws Error on timeout
 */
export async function waitForOutboundTx(
  ctx: OrchestratorContext,
  pushChainTxHash: string,
  options: WaitForOutboundOptions = {}
): Promise<OutboundTxDetails> {
  const {
    initialWaitMs = OUTBOUND_INITIAL_WAIT_MS,
    pollingIntervalMs = OUTBOUND_POLL_INTERVAL_MS,
    timeout = OUTBOUND_MAX_TIMEOUT_MS,
    progressHook,
    _resolvedSubTxId,
    _expectedDestinationChain,
    _outboundIndex,
  } = options;

  // Terminal failure states — fail fast instead of polling until timeout
  const TERMINAL_FAILURE_STATES = new Set([
    UniversalTxStatus.OUTBOUND_FAILED,
    UniversalTxStatus.PC_EXECUTED_FAILED,
    UniversalTxStatus.CANCELED,
  ]);

  const startTime = Date.now();

  printLog(
    ctx,
    `[waitForOutboundTx] Starting | txHash: ${pushChainTxHash} | initialWait: ${initialWaitMs}ms | pollInterval: ${pollingIntervalMs}ms | timeout: ${timeout}ms`
  );

  progressHook?.({ status: 'waiting', elapsed: 0 });

  // Clamp the initial wait to the configured timeout so a short per-call
  // `outboundTimeoutMs` (e.g. from `tx.wait({ outboundTimeoutMs })`) isn't
  // blocked by the default 20s settle-time. Mirrors the equivalent
  // Math.min(initialWaitMs, timeout) clamp in inbound-tracker.ts.
  const effectiveInitialWaitMs = Math.min(initialWaitMs, timeout);
  printLog(
    ctx,
    `[waitForOutboundTx] Initial wait of ${effectiveInitialWaitMs}ms (configured: ${initialWaitMs}ms, clamped to timeout ${timeout}ms)...`
  );
  await new Promise((resolve) => setTimeout(resolve, effectiveInitialWaitMs));

  // Fast-exit: if the clamped initial wait already consumed the full budget,
  // skip the poll loop and go straight to the timeout throw below.
  if (Date.now() - startTime >= timeout) {
    const elapsedMs = Date.now() - startTime;
    printLog(
      ctx,
      `[waitForOutboundTx] Timeout reached during initial wait (elapsed: ${elapsedMs}ms / ${timeout}ms)`
    );
    progressHook?.({ status: 'timeout', elapsed: elapsedMs });
    throw new OutboundTimeoutError(pushChainTxHash, elapsedMs, timeout);
  }

  // Start polling
  printLog(
    ctx,
    `[waitForOutboundTx] Initial wait done. Starting polling. Elapsed: ${
      Date.now() - startTime
    }ms`
  );
  progressHook?.({ status: 'polling', elapsed: Date.now() - startTime });

  // Cache the universalSubTxId after first extraction to avoid redundant receipt fetches.
  // If a pre-resolved ID was provided (cascade per-hop tracking), use it directly.
  let cachedUniversalSubTxId: string | undefined = _resolvedSubTxId;

  let pollCount = 0;
  while (Date.now() - startTime < timeout) {
    pollCount++;
    const pollStart = Date.now();
    printLog(
      ctx,
      `[waitForOutboundTx] Poll #${pollCount} | Elapsed: ${
        pollStart - startTime
      }ms / ${timeout}ms`
    );

    if (!cachedUniversalSubTxId) {
      cachedUniversalSubTxId =
        (await extractUniversalSubTxIdFromTx(ctx, pushChainTxHash)) ??
        undefined;
      if (!cachedUniversalSubTxId) {
        cachedUniversalSubTxId = computeUniversalTxId(
          ctx.pushNetwork,
          pushChainTxHash
        );
      }
      printLog(
        ctx,
        `[waitForOutboundTx] Extracted & cached universalSubTxId: ${cachedUniversalSubTxId}`
      );
    }

    // Query with cached ID
    const queryId = cachedUniversalSubTxId.startsWith('0x')
      ? cachedUniversalSubTxId.slice(2)
      : cachedUniversalSubTxId;

    try {
      const utxResponse = await ctx.pushClient.getUniversalTxByIdV2(queryId);

      const statusNum = utxResponse?.universalTx?.universalStatus as number;
      const statusName = UniversalTxStatus[statusNum] ?? statusNum;
      const outbounds = utxResponse?.universalTx?.outboundTx || [];
      const firstOutbound = outbounds[0];
      const firstOutboundChain = firstOutbound?.destinationChain
        ? chainFromNamespace(firstOutbound.destinationChain)
        : undefined;
      const firstDisplayTxHash =
        toExternalTxHashDisplay(
          firstOutboundChain ?? undefined,
          firstOutbound?.observedTx?.txHash
        ) ??
        firstOutbound?.observedTx?.txHash ??
        '';
      printLog(
        ctx,
        `[waitForOutboundTx] Poll #${pollCount} | status: ${statusNum} (${statusName}) | outboundTx count: ${
          outbounds.length
        } | first txHash: '${firstDisplayTxHash}' | first dest: '${
          firstOutbound?.destinationChain || ''
        }'`
      );

      // Check for terminal failure states — fail fast
      if (TERMINAL_FAILURE_STATES.has(statusNum)) {
        printLog(
          ctx,
          `[waitForOutboundTx] Terminal failure state: ${statusName}`
        );
        progressHook?.({ status: 'failed', elapsed: Date.now() - startTime });
        throw new OutboundFailedError(
          `Outbound transaction failed with status ${statusName}. Push Chain TX: ${pushChainTxHash}.`,
          pushChainTxHash
        );
      }

      const pcTxs = utxResponse?.universalTx?.pcTx || [];
      const failedPcTx = pcTxs.find((pcTx) => {
        const status = String(pcTx.status || '').toUpperCase();
        return status === 'FAILED' || Boolean(pcTx.errorMsg);
      });
      if (failedPcTx) {
        const failedTxHash = failedPcTx.txHash || pushChainTxHash;
        const reason = failedPcTx.errorMsg
          ? normalizePcInsufficientFundsError(failedPcTx.errorMsg)
          : 'Push Chain execution failed';
        printLog(
          ctx,
          `[waitForOutboundTx] Push Chain execution failed before outbound emission: ${reason}`
        );
        progressHook?.({ status: 'failed', elapsed: Date.now() - startTime });
        throw new OutboundFailedError(
          `Push Chain execution failed before outbound emission: ${reason}. Push Chain TX: ${failedTxHash}.`,
          pushChainTxHash,
          undefined,
          failedPcTx.txHash || undefined
        );
      }

      // Iterate V2 outbound array. For cascade tracking, multiple outbound
      // entries can target the same destination chain (for example R2 BSC
      // followed by R3 BSC -> Push). `_outboundIndex` disambiguates those
      // same-chain entries by order after `_expectedDestinationChain` filtering.
      let matchingOutboundIndex = 0;
      for (const ob of outbounds) {
        // If a destination chain filter is set, skip outbound entries that don't match.
        if (
          _expectedDestinationChain &&
          ob.destinationChain !== _expectedDestinationChain
        ) {
          printLog(
            ctx,
            `[waitForOutboundTx] Poll #${pollCount} | outbound chain '${ob.destinationChain}' does not match expected '${_expectedDestinationChain}', skipping`
          );
          continue;
        }

        const currentOutboundIndex = matchingOutboundIndex;
        matchingOutboundIndex += 1;
        if (
          _outboundIndex !== undefined &&
          currentOutboundIndex !== _outboundIndex
        ) {
          printLog(
            ctx,
            `[waitForOutboundTx] Poll #${pollCount} | outbound index ${currentOutboundIndex} for '${ob.destinationChain}' does not match expected index ${_outboundIndex}, skipping`
          );
          continue;
        }

        // Fail fast on per-outbound REVERTED status
        if (ob.outboundStatus === OutboundStatus.REVERTED) {
          printLog(
            ctx,
            `[waitForOutboundTx] Outbound to ${ob.destinationChain} REVERTED`
          );
          progressHook?.({ status: 'failed', elapsed: Date.now() - startTime });
          throw new OutboundFailedError(
            `Outbound to ${ob.destinationChain} reverted: ${
              ob.observedTx?.errorMsg || 'Unknown'
            }. Push Chain TX: ${pushChainTxHash}.`,
            pushChainTxHash,
            ob.destinationChain,
            ob.observedTx?.txHash
          );
        }

        // FOUND gating logic:
        //   1. Primary path — cosmos has transitioned to OBSERVED (the
        //      authoritative success signal from the indexer).
        //   2. Tiebreaker — cosmos has the txHash but outboundStatus is
        //      still UNSPECIFIED/PENDING (indexer lag). We ask the
        //      destination chain's own RPC: if its receipt is success,
        //      treat as FOUND; if reverted, throw OutboundFailedError.
        //      Pending receipts keep polling.
        if (ob.observedTx?.txHash) {
          const chain = chainFromNamespace(ob.destinationChain);
          if (!chain) continue;

          const isCosmosObserved =
            ob.outboundStatus === OutboundStatus.OBSERVED;
          if (!isCosmosObserved) {
            // Tiebreaker: ask the destination-chain RPC directly.
            const verdict = await verifyExternalEvmReceipt(
              ctx,
              chain,
              ob.observedTx.txHash
            );
            if (verdict === 'reverted') {
              printLog(
                ctx,
                `[waitForOutboundTx] Source-chain RPC reports REVERTED for ${
                  ob.destinationChain
                } tx ${ob.observedTx.txHash} (cosmos still ${
                  UniversalTxStatus[statusNum] ?? statusNum
                })`
              );
              progressHook?.({
                status: 'failed',
                elapsed: Date.now() - startTime,
              });
              throw new OutboundFailedError(
                `Outbound to ${ob.destinationChain} reverted on source-chain RPC (tx: ${ob.observedTx.txHash}). Push Chain TX: ${pushChainTxHash}.`,
                pushChainTxHash,
                ob.destinationChain,
                ob.observedTx.txHash
              );
            }
            if (verdict !== 'success') {
              // 'pending' or 'unsupported' — keep polling, cosmos will catch up.
              continue;
            }
            printLog(
              ctx,
              `[waitForOutboundTx] Source-chain RPC tiebreaker: ${chain} tx ${
                ob.observedTx.txHash
              } succeeded; treating as FOUND despite cosmos status ${
                UniversalTxStatus[statusNum] ?? statusNum
              }`
            );
          }

          {
            const explorerBaseUrl = CHAIN_INFO[chain]?.explorerUrl;
            const isSvm = CHAIN_INFO[chain]?.vm === VM.SVM;
            const displayTxHash =
              toExternalTxHashDisplay(chain, ob.observedTx.txHash) ??
              ob.observedTx.txHash;
            let explorerUrl = '';
            if (isSvm) {
              const cluster =
                chain === CHAIN.SOLANA_DEVNET
                  ? '?cluster=devnet'
                  : chain === CHAIN.SOLANA_TESTNET
                  ? '?cluster=testnet'
                  : '';
              explorerUrl = explorerBaseUrl
                ? `${explorerBaseUrl}/tx/${displayTxHash}${cluster}`
                : '';
            } else {
              explorerUrl = explorerBaseUrl
                ? `${explorerBaseUrl}/tx/${displayTxHash}`
                : '';
            }

            // OutboundTxDetails carries the raw `0x`-hex form so internal
            // consumers (R3 inbound tracker in response-builder.ts:786 →
            // findChildUtxIdFromExternalTx → Cosmos query) keep working.
            // The base58 display form is applied at every user-facing
            // boundary via `toExternalTxHashDisplay` (helpers.ts).
            // PC20: `externalAssetAddr` is empty when the outbound is first
            // created, and a repeat export deploys no wrapper so nothing is
            // ever observed to backfill it. Resolve from UniversalCore instead,
            // keyed by the Push-native source token.
            const pc20Wrapper = await resolvePC20WrapperForReceipt(
              ctx,
              ob,
              { network: ctx.pushNetwork, rpcUrls: ctx.rpcUrls }
            );
            const details: OutboundTxDetails = {
              externalTxHash: ob.observedTx.txHash,
              destinationChain: chain,
              explorerUrl,
              recipient: ob.recipient,
              amount: ob.amount,
              assetAddr: pc20Wrapper ?? ob.externalAssetAddr,
            };
            printLog(
              ctx,
              `[waitForOutboundTx] FOUND on poll #${pollCount} | elapsed: ${
                Date.now() - startTime
              }ms | externalTxHash: ${displayTxHash}`
            );
            progressHook?.({
              status: 'found',
              elapsed: Date.now() - startTime,
            });
            return details;
          }
        }
      }
    } catch (error) {
      // Re-throw typed terminal failure so the caller can classify it as
      // 299-02. Transient errors (RPC hiccups, deserialization) are logged
      // and the loop continues polling until timeout.
      if (error instanceof OutboundFailedError) {
        throw error;
      }
      printLog(
        ctx,
        `[waitForOutboundTx] Poll #${pollCount} ERROR: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    printLog(
      ctx,
      `[waitForOutboundTx] Poll #${pollCount} not ready yet (${
        Date.now() - pollStart
      }ms). Waiting ${pollingIntervalMs}ms...`
    );

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollingIntervalMs));
  }

  const elapsedMs = Date.now() - startTime;
  printLog(
    ctx,
    `[waitForOutboundTx] TIMEOUT after ${pollCount} polls | elapsed: ${elapsedMs}ms`
  );
  progressHook?.({ status: 'timeout', elapsed: elapsedMs });

  throw new OutboundTimeoutError(pushChainTxHash, elapsedMs, timeout);
}

// ============================================================================
// waitForAllOutboundTxsV2
// ============================================================================

/**
 * Tracks ALL outbound transactions for a cascade with multiple outbound hops
 * (e.g., BNB + Solana). Uses V2 API which returns outboundTx[] with per-outbound
 * status tracking, matching each outbound to the correct hop by destination chain.
 */
export async function waitForAllOutboundTxsV2(
  ctx: OrchestratorContext,
  pushChainTxHash: string,
  outboundHops: CascadeHopInfo[],
  options: {
    initialWaitMs: number;
    pollingIntervalMs: number;
    timeout: number;
    _resolvedSubTxId?: string;
    _outboundIndexByHop?: Map<number, number>;
    progressHook?: (event: {
      hopIndex: number;
      route: TransactionRouteType;
      chain: CHAIN;
      status: string;
      txHash?: string;
    }) => void;
  }
): Promise<{ success: boolean; failedAt?: number }> {
  const {
    initialWaitMs,
    pollingIntervalMs,
    timeout,
    progressHook,
    _resolvedSubTxId,
    _outboundIndexByHop,
  } = options;
  const startTime = Date.now();

  // Build maps for matching outbound entries. When the cascade composer merged
  // multiple logical hops into one outbound request, `_outboundIndexByHop` maps
  // those hops to the same outbound ordinal.
  const chainToHops = new Map<string, Map<number, CascadeHopInfo[]>>();
  for (const hop of outboundHops) {
    const chainInfo = CHAIN_INFO[hop.executionChain];
    if (chainInfo) {
      const namespace = `${VM_NAMESPACE[chainInfo.vm]}:${chainInfo.chainId}`;
      const existingByOrdinal = chainToHops.get(namespace) || new Map();
      const fallbackOrdinal = [...existingByOrdinal.values()].reduce(
        (count, hopsForOrdinal) => count + hopsForOrdinal.length,
        0
      );
      const outboundOrdinal =
        _outboundIndexByHop?.get(hop.hopIndex) ?? fallbackOrdinal;
      const existing = existingByOrdinal.get(outboundOrdinal) || [];
      existing.push(hop);
      existingByOrdinal.set(outboundOrdinal, existing);
      chainToHops.set(namespace, existingByOrdinal);
    }
  }

  const expectedChains = [...chainToHops.keys()];
  printLog(
    ctx,
    `[waitForAllOutboundTxsV2] Starting | txHash: ${pushChainTxHash} | expectedChains: ${expectedChains.join(
      ', '
    )} | timeout: ${timeout}ms`
  );

  // Emit initial waiting status for all outbound hops
  for (const hop of outboundHops) {
    progressHook?.({
      hopIndex: hop.hopIndex,
      route: hop.route,
      chain: hop.executionChain,
      status: 'waiting',
    });
  }

  // Initial wait before first poll
  const waitMs = Math.min(initialWaitMs, timeout);
  printLog(ctx, `[waitForAllOutboundTxsV2] Initial wait of ${waitMs}ms...`);
  await new Promise((resolve) => setTimeout(resolve, waitMs));

  // Emit polling status for all hops
  for (const hop of outboundHops) {
    progressHook?.({
      hopIndex: hop.hopIndex,
      route: hop.route,
      chain: hop.executionChain,
      status: 'polling',
    });
  }

  // Extract sub-tx ID for V2 query
  let cachedQueryId: string | undefined = _resolvedSubTxId
    ? _resolvedSubTxId.startsWith('0x')
      ? _resolvedSubTxId.slice(2)
      : _resolvedSubTxId
    : undefined;

  let pollCount = 0;
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 10;
  while (Date.now() - startTime < timeout) {
    pollCount++;
    const elapsed = Date.now() - startTime;
    printLog(
      ctx,
      `[waitForAllOutboundTxsV2] Poll #${pollCount} | Elapsed: ${elapsed}ms / ${timeout}ms`
    );

    // Resolve query ID on first poll
    if (!cachedQueryId) {
      const allSubTxIds = await extractAllUniversalSubTxIds(
        ctx,
        pushChainTxHash
      );
      const subTxId =
        allSubTxIds.length > 0
          ? allSubTxIds[0]
          : computeUniversalTxId(ctx.pushNetwork, pushChainTxHash);
      cachedQueryId = subTxId.startsWith('0x') ? subTxId.slice(2) : subTxId;
      printLog(
        ctx,
        `[waitForAllOutboundTxsV2] Resolved queryId: ${cachedQueryId}`
      );
    }

    try {
      const v2Response = await ctx.pushClient.getUniversalTxByIdV2(
        cachedQueryId
      );
      consecutiveErrors = 0; // Reset on successful RPC call
      const utx = v2Response?.universalTx;
      const statusNum = utx?.universalStatus as number;
      const statusName = UniversalTxStatus[statusNum] ?? statusNum;

      printLog(
        ctx,
        `[waitForAllOutboundTxsV2] Poll #${pollCount} | status: ${statusNum} (${statusName}) | outboundTx count: ${
          utx?.outboundTx?.length ?? 0
        }`
      );

      if (utx?.outboundTx?.length) {
        const outboundOrdinalByChain = new Map<string, number>();
        for (const ob of utx.outboundTx) {
          const destChain = ob.destinationChain;
          const hopsByOrdinal = chainToHops.get(destChain);
          if (!hopsByOrdinal) continue;

          const outboundOrdinal = outboundOrdinalByChain.get(destChain) ?? 0;
          outboundOrdinalByChain.set(destChain, outboundOrdinal + 1);

          const targetHops = hopsByOrdinal.get(outboundOrdinal) || [];
          const pendingTargetHops = targetHops.filter(
            (hop) => hop.status !== 'confirmed' && hop.status !== 'failed'
          );
          if (pendingTargetHops.length === 0) continue;
          const primaryTargetHop = pendingTargetHops[0];

          const externalTxHash = ob.observedTx?.txHash;
          const hasObservedTxHash =
            !!externalTxHash && externalTxHash !== 'EMPTY';
          const observedFailure =
            hasObservedTxHash &&
            ob.observedTx?.success === false &&
            Boolean(
              ob.observedTx?.errorMsg ||
                ob.abortReason ||
                (ob.outboundStatus as number) >= OutboundStatus.REVERTED
            );

          // Fail fast on per-outbound REVERTED or observed destination failure.
          if (
            ob.outboundStatus === OutboundStatus.REVERTED ||
            observedFailure
          ) {
            for (const targetHop of pendingTargetHops) {
              targetHop.status = 'failed';
              progressHook?.({
                hopIndex: targetHop.hopIndex,
                route: targetHop.route,
                chain: targetHop.executionChain,
                status: 'failed',
              });
            }
            printLog(
              ctx,
              `[waitForAllOutboundTxsV2] Outbound to ${destChain} REVERTED | outboundIndex ${outboundOrdinal} | hops ${pendingTargetHops
                .map((hop) => hop.hopIndex)
                .join(', ')} | error: ${
                ob.abortReason || ob.observedTx?.errorMsg || 'Unknown'
              }`
            );
            return { success: false, failedAt: primaryTargetHop.hopIndex };
          }

          // Check for observed tx hash. Cosmos may lag the status transition,
          // so EVM destinations are verified against the destination receipt.
          if (hasObservedTxHash && externalTxHash) {
            const chain = chainFromNamespace(destChain);
            if (!chain) continue;

            const isCosmosObserved =
              ob.outboundStatus === OutboundStatus.OBSERVED;
            if (!isCosmosObserved) {
              const verdict = await verifyExternalEvmReceipt(
                ctx,
                chain,
                externalTxHash
              );
              if (verdict === 'reverted') {
                for (const targetHop of pendingTargetHops) {
                  targetHop.status = 'failed';
                  progressHook?.({
                    hopIndex: targetHop.hopIndex,
                    route: targetHop.route,
                    chain: targetHop.executionChain,
                    status: 'failed',
                  });
                }
                printLog(
                  ctx,
                  `[waitForAllOutboundTxsV2] Source-chain RPC reports REVERTED for ${destChain} tx ${externalTxHash} | outboundIndex ${outboundOrdinal} | hops ${pendingTargetHops
                    .map((hop) => hop.hopIndex)
                    .join(', ')}`
                );
                return { success: false, failedAt: primaryTargetHop.hopIndex };
              }
              if (verdict !== 'success') {
                continue;
              }
            }

            // Build the display form for SVM (base58) used in `hop.txHash` /
            // `hop.outboundDetails.externalTxHash` / the progressHook event —
            // these are USER-FACING. The internal raw-hex form stays only
            // inside this function; it's not exposed to consumers from the
            // cascade path (cascade.ts doesn't call findChildUtxIdFromExternalTx
            // for the cascade outbound hash).
            const displayTxHash =
              toExternalTxHashDisplay(chain ?? undefined, externalTxHash) ??
              externalTxHash;
            let explorerUrl = '';
            if (chain && externalTxHash) {
              const explorerBaseUrl = CHAIN_INFO[chain]?.explorerUrl;
              const isSvm = CHAIN_INFO[chain]?.vm === VM.SVM;
              if (isSvm) {
                const cluster =
                  chain === CHAIN.SOLANA_DEVNET
                    ? '?cluster=devnet'
                    : chain === CHAIN.SOLANA_TESTNET
                    ? '?cluster=testnet'
                    : '';
                explorerUrl = explorerBaseUrl
                  ? `${explorerBaseUrl}/tx/${displayTxHash}${cluster}`
                  : '';
              } else {
                explorerUrl = explorerBaseUrl
                  ? `${explorerBaseUrl}/tx/${displayTxHash}`
                  : '';
              }
            }

            // Same PC20 fallback as the single-outbound path above.
            const hopPc20Wrapper = await resolvePC20WrapperForReceipt(ctx, ob, {
              network: ctx.pushNetwork,
              rpcUrls: ctx.rpcUrls,
            });

            for (const targetHop of pendingTargetHops) {
              targetHop.status = 'confirmed';
              targetHop.txHash = displayTxHash;
              targetHop.outboundDetails = {
                externalTxHash: displayTxHash,
                destinationChain: chain || targetHop.executionChain,
                explorerUrl,
                recipient: ob.recipient,
                amount: ob.amount,
                assetAddr: hopPc20Wrapper ?? ob.externalAssetAddr,
              };

              progressHook?.({
                hopIndex: targetHop.hopIndex,
                route: targetHop.route,
                chain: targetHop.executionChain,
                status: 'confirmed',
                txHash: displayTxHash,
              });
            }

            printLog(
              ctx,
              `[waitForAllOutboundTxsV2] FOUND outbound for ${destChain} | outboundIndex ${outboundOrdinal} | hops ${pendingTargetHops
                .map((hop) => hop.hopIndex)
                .join(', ')} | externalTxHash: ${displayTxHash}`
            );
          }
        }
      }

      // Check if all hops are now confirmed
      if (outboundHops.every((h) => h.status === 'confirmed')) {
        printLog(
          ctx,
          `[waitForAllOutboundTxsV2] All ${outboundHops.length} hops confirmed via V2`
        );
        return { success: true };
      }

      // If PC_EXECUTED_SUCCESS but some hops still unresolved, check outbound status.
      // Only auto-confirm if there are NO pending outbound txs (status=1 with empty hash).
      // Pending outbounds are still in flight on the relay — keep polling for their hashes.
      if (statusNum === UniversalTxStatus.PC_EXECUTED_SUCCESS) {
        const stillUnresolved = outboundHops.filter(
          (h) => h.status !== 'confirmed'
        );
        if (stillUnresolved.length > 0) {
          const hasPendingOutbound = utx?.outboundTx?.some(
            (ob) =>
              ob.outboundStatus === OutboundStatus.PENDING &&
              (!ob.observedTx?.txHash || ob.observedTx.txHash === 'EMPTY')
          );

          if (!hasPendingOutbound) {
            // No pending outbounds — safe to auto-confirm remaining hops
            for (const hop of stillUnresolved) {
              hop.status = 'confirmed';
              printLog(
                ctx,
                `[waitForAllOutboundTxsV2] Auto-confirmed hop ${hop.hopIndex} (${hop.executionChain}) based on PC_EXECUTED_SUCCESS (no pending outbounds)`
              );
              progressHook?.({
                hopIndex: hop.hopIndex,
                route: hop.route,
                chain: hop.executionChain,
                status: 'confirmed',
              });
            }
            return { success: true };
          }
          // Pending outbound txs still in flight — continue polling
          printLog(
            ctx,
            `[waitForAllOutboundTxsV2] ${stillUnresolved.length} hop(s) unresolved, pending outbound txs in flight — continuing to poll`
          );
        }
      }
    } catch (error) {
      consecutiveErrors++;
      printLog(
        ctx,
        `[waitForAllOutboundTxsV2] Poll #${pollCount} ERROR (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        printLog(
          ctx,
          `[waitForAllOutboundTxsV2] Aborting — ${MAX_CONSECUTIVE_ERRORS} consecutive RPC errors`
        );
        break;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollingIntervalMs));
  }

  // Timeout: fail any unresolved hops
  const timedOutHops = outboundHops.filter((h) => h.status !== 'confirmed');
  if (timedOutHops.length > 0) {
    printLog(
      ctx,
      `[waitForAllOutboundTxsV2] TIMEOUT after ${pollCount} polls | ${timedOutHops.length} hop(s) unresolved`
    );
    for (const hop of timedOutHops) {
      hop.status = 'failed';
      progressHook?.({
        hopIndex: hop.hopIndex,
        route: hop.route,
        chain: hop.executionChain,
        status: 'failed',
      });
    }
    return { success: false, failedAt: timedOutHops[0].hopIndex };
  }

  return { success: true };
}
